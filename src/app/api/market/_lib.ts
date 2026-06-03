// Shared utilities for /api/market handlers

import { GoogleGenAI } from '@google/genai';
import { db } from '@/lib/db';
import type { SectorQuote } from '@/lib/market/scoring';
import YahooFinanceCls from 'yahoo-finance2';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const yahooFinance = new (YahooFinanceCls as any)();

// ─── Handler context ──────────────────────────────────────────────────────────
export interface HandlerCtx {
  body: Record<string, unknown>;
  ai: GoogleGenAI;
  model: string;
  currentUserId: string | null;
}

// ─── In-process response cache ────────────────────────────────────────────────
interface CacheEntry { data: unknown; ts: number }
const responseCache = new Map<string, CacheEntry>();
export const CACHE_TTL: Record<string, number> = {
  nearTerm:       20 * 60 * 1000,
  liveUpdate:     10 * 60 * 1000,
  outlook:         2 * 60 * 60 * 1000,
  polygonContext:  5 * 60 * 1000,
  portfolioAdvice: 0,
  fearAndGreed:   10 * 60 * 1000,
  spyData:         5 * 60 * 1000,
  sectorData:     10 * 60 * 1000,
  marketMovers:   10 * 60 * 1000,
  putCallRatio:    5 * 60 * 1000,
};

export function getCached(key: string): unknown {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  const ttl = CACHE_TTL[key.split(':')[0]] ?? 0;
  if (ttl === 0) return undefined;
  if (Date.now() - entry.ts > ttl) { responseCache.delete(key); return undefined; }
  return entry.data;
}
export function setCache(key: string, data: unknown) {
  const ttl = CACHE_TTL[key.split(':')[0]] ?? 0;
  if (ttl > 0) responseCache.set(key, { data, ts: Date.now() });
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export const getCurrentDate = () =>
  new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export function getTodayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}
export function getYesterdayET(): string {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}
export function isAfterNoonET(): boolean {
  const etHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date())
  );
  return etHour >= 12;
}

export function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set in server environment.');
  return key;
}

// ─── Market data fetchers ─────────────────────────────────────────────────────

export async function fetchSPYPutCallRatio(): Promise<number | null> {
  const cached = getCached('putCallRatio') as number | null | undefined;
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (yahooFinance as any).options('SPY');
    let totalPuts = 0, totalCalls = 0;
    const cutoff = Date.now() + 7 * 24 * 60 * 60 * 1000;
    for (const exp of (result.options ?? [])) {
      const expDate = exp.expirationDate instanceof Date
        ? exp.expirationDate.getTime()
        : new Date(exp.expirationDate ?? 0).getTime();
      if (expDate > cutoff) continue;
      for (const p of exp.puts  ?? []) totalPuts  += p.volume ?? 0;
      for (const c of exp.calls ?? []) totalCalls += c.volume ?? 0;
    }
    if (totalCalls === 0) { setCache('putCallRatio', null); return null; }
    const ratio = Math.round((totalPuts / totalCalls) * 100) / 100;
    setCache('putCallRatio', ratio);
    return ratio;
  } catch { return null; }
}

export interface SPYData {
  changePercent: number | null;
  direction: 'Up' | 'Down' | 'Flat';
  above200MA: boolean | null;
  above50MA: boolean | null;
  volumeRatio: number | null;
}
export async function fetchSPYData(): Promise<SPYData> {
  const cached = getCached('spyData') as SPYData | undefined;
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote = await (yahooFinance as any).quote('SPY');
    const price: number | null = quote?.regularMarketPrice ?? null;
    const changePct: number | null = quote?.regularMarketChangePercent != null
      ? Math.round(quote.regularMarketChangePercent * 100) / 100 : null;
    const ma50:  number | null = quote?.fiftyDayAverage ?? null;
    const ma200: number | null = quote?.twoHundredDayAverage ?? null;
    const vol:   number | null = quote?.regularMarketVolume ?? null;
    const avg:   number | null = quote?.averageVolume ?? quote?.averageDailyVolume3Month ?? null;
    const direction: 'Up' | 'Down' | 'Flat' =
      changePct == null ? 'Flat' : changePct > 0.3 ? 'Up' : changePct < -0.3 ? 'Down' : 'Flat';
    const result: SPYData = {
      changePercent: changePct, direction,
      above200MA: price != null && ma200 != null ? price > ma200 : null,
      above50MA:  price != null && ma50  != null ? price > ma50  : null,
      volumeRatio: vol && avg && avg > 0 ? Math.round((vol / avg) * 10) / 10 : null,
    };
    setCache('spyData', result);
    return result;
  } catch {
    return { changePercent: null, direction: 'Flat', above200MA: null, above50MA: null, volumeRatio: null };
  }
}

export interface FearGreedData {
  score: number;
  label: 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';
  delta: number;
  previousClose: number;
}

/** Fetch CNN Fear & Greed. Falls back to last-known value stored in macro_cache. */
export async function fetchFearAndGreed(): Promise<FearGreedData | null> {
  const cached = getCached('fearAndGreed') as FearGreedData | null | undefined;
  if (cached !== undefined) return cached;
  try {
    const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`CNN F&G returned ${res.status}`);
    const data = await res.json();
    const fg = data?.fear_and_greed;
    if (!fg?.score) throw new Error('Missing score in CNN F&G response');
    const score = Math.round(fg.score);
    const prev  = Math.round(fg.previous_close ?? fg.score);
    const label: FearGreedData['label'] =
      score <= 20 ? 'Extreme Fear' : score <= 40 ? 'Fear' :
      score <= 60 ? 'Neutral' : score <= 80 ? 'Greed' : 'Extreme Greed';
    const fgResult: FearGreedData = { score, label, delta: score - prev, previousClose: prev };
    setCache('fearAndGreed', fgResult);
    // Persist as fallback for future cold starts / CNN outages
    try {
      const sql = db();
      await sql`
        INSERT INTO macro_cache (cache_key, data, fetched_at)
        VALUES ('fear_greed_fallback', ${JSON.stringify(fgResult)}, now())
        ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at
      `;
    } catch { /* non-fatal */ }
    return fgResult;
  } catch {
    // CNN is down or blocked — use last DB-persisted value
    try {
      const sql = db();
      const rows = await sql`SELECT data FROM macro_cache WHERE cache_key = 'fear_greed_fallback'`;
      if (rows[0]?.data) {
        const fallback = rows[0].data as FearGreedData;
        setCache('fearAndGreed', fallback);
        return fallback;
      }
    } catch { /* ignore */ }
    return null;
  }
}

export interface MoverQuote { ticker: string; name: string; changePercent: number; change: string }

const SECTOR_ETFS = ['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC'];
const SECTOR_NAMES: Record<string, string> = {
  XLK: 'Technology', XLF: 'Financials', XLE: 'Energy', XLV: 'Health Care',
  XLI: 'Industrials', XLY: 'Consumer Disc.', XLP: 'Consumer Staples',
  XLU: 'Utilities', XLB: 'Materials', XLRE: 'Real Estate', XLC: 'Comm. Services',
};
export async function fetchSectorData(): Promise<{ leader: SectorQuote; lagger: SectorQuote } | null> {
  const cached = getCached('sectorData') as { leader: SectorQuote; lagger: SectorQuote } | null | undefined;
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quotes = await (yahooFinance as any).quote(SECTOR_ETFS);
    const results: SectorQuote[] = (Array.isArray(quotes) ? quotes : [quotes])
      .filter((q: Record<string, unknown>) => q?.symbol != null)
      .map((q: Record<string, unknown>) => ({
        ticker:        String(q.symbol),
        sector:        SECTOR_NAMES[String(q.symbol)] ?? String(q.symbol),
        changePercent: q.regularMarketChangePercent != null
          ? Math.round(Number(q.regularMarketChangePercent) * 100) / 100 : 0,
      }));
    if (results.length < 2) { setCache('sectorData', null); return null; }
    results.sort((a, b) => b.changePercent - a.changePercent);
    const sectorResult = { leader: results[0], lagger: results[results.length - 1] };
    setCache('sectorData', sectorResult);
    return sectorResult;
  } catch { return null; }
}

export async function fetchMarketMovers(): Promise<{ gainers: MoverQuote[]; losers: MoverQuote[] }> {
  const cached = getCached('marketMovers') as { gainers: MoverQuote[]; losers: MoverQuote[] } | undefined;
  if (cached) return cached;
  try {
    const [gainersResult, losersResult] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (yahooFinance as any).screener({ scrIds: 'day_gainers', count: 10 }).catch(() => null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (yahooFinance as any).screener({ scrIds: 'day_losers',  count: 10 }).catch(() => null),
    ]);
    const toMover = (q: Record<string, unknown>): MoverQuote => {
      const pct = Math.round(Number(q.regularMarketChangePercent) * 100) / 100;
      return { ticker: String(q.symbol), name: String(q.shortName ?? q.longName ?? q.symbol),
               changePercent: pct, change: `${pct >= 0 ? '+' : ''}${pct}%` };
    };
    const gainers: MoverQuote[] = ((gainersResult?.quotes ?? gainersResult ?? []) as Record<string, unknown>[])
      .filter(q => q?.regularMarketChangePercent != null).slice(0, 5).map(toMover);
    const losers: MoverQuote[] = ((losersResult?.quotes ?? losersResult ?? []) as Record<string, unknown>[])
      .filter(q => q?.regularMarketChangePercent != null).slice(0, 5).map(toMover);
    const moversResult = { gainers, losers };
    setCache('marketMovers', moversResult);
    return moversResult;
  } catch { return { gainers: [], losers: [] }; }
}

// ─── Shared prompt builders ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSessionBlock(ctx: any): string {
  if (!ctx) return '';
  const lines = [
    ctx.portfolio         ? `- User portfolio this session: ${ctx.portfolio}` : '',
    ctx.portfolioFindings ? `- Portfolio analysis found: ${ctx.portfolioFindings}` : '',
    ctx.thesis            ? `- Thesis tested: "${ctx.thesis}"` : '',
    ctx.bestTickers       ? `- Previously suggested assets: ${ctx.bestTickers}` : '',
  ].filter(Boolean);
  const crossTabBlock = ctx.crossTabContext
    ? `\nCROSS-TAB CONTEXT (user's recent work in other parts of Alpha Horizon):\n${ctx.crossTabContext}\n`
    : '';
  if (!lines.length && !crossTabBlock) return '';
  const sessionLines = lines.length
    ? `\nUSER SESSION CONTEXT:\n${lines.join('\n')}\n` : '';
  return sessionLines + crossTabBlock;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMarketStance(ctx: any): string {
  if (!ctx) return '';
  return `
AUTHORITATIVE MARKET STANCE:
- Regime: ${ctx.marketSnapshot?.regime || 'Unknown'} | Sentiment: ${ctx.marketSnapshot?.sentiment || 'Unknown'}
- Overweight NOW: ${(ctx.positioning?.overweight || []).map((p: any) => p.idea).join(', ') || 'none'}
- Underweight NOW: ${(ctx.positioning?.underweight || []).map((p: any) => p.idea).join(', ') || 'none'}
`;
}

// ─── Shared rolling accuracy calculator (deduplicates tripleCard + refreshLive) ──
export function computeRollingAccuracy(rows: Array<{ accuracy_breakdown: unknown; user_accuracy_correct: unknown }>) {
  const rolling: Record<string, number[]> = { fearGreed: [], spyTrend: [], sectorRotation: [], optionsPulse: [] };
  let modelStreak = 0, userStreak = 0, modelBroken = false, userBroken = false;
  for (const r of rows) {
    const ab = r.accuracy_breakdown as Record<string, number> | null;
    if (ab) {
      for (const key of Object.keys(rolling)) {
        if (ab[key] != null) rolling[key].push(Number(ab[key]));
      }
      if (!modelBroken) {
        if (ab.spyTrend != null && ab.spyTrend >= 60) modelStreak++;
        else modelBroken = true;
      }
    } else if (!modelBroken) {
      modelBroken = true;
    }
    if (!userBroken) {
      if (r.user_accuracy_correct === true)        userStreak++;
      else if (r.user_accuracy_correct === false)  userBroken = true;
    }
  }
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  return {
    rollingAccuracy: {
      fearGreed:      avg(rolling.fearGreed),
      spyTrend:       avg(rolling.spyTrend),
      sectorRotation: avg(rolling.sectorRotation),
      optionsPulse:   avg(rolling.optionsPulse),
      daysScored: rows.filter(r => r.accuracy_breakdown).length,
    },
    modelStreak,
    userStreak,
  };
}

// ─── Shared edge board builder (deduplicates tripleCard + refreshLive) ────────
export function buildEdgeBoard(
  movers: { gainers: MoverQuote[]; losers: MoverQuote[] },
  reasons: Record<string, string>,
) {
  return {
    top5: movers.gainers.map((m, i) => ({
      rank: i + 1, ticker: m.ticker, name: m.name, change: m.change,
      edge: reasons[m.ticker] ?? `+${m.changePercent}% — top gainer today`, sector: 'Equities',
    })),
    bottom5: movers.losers.map((m, i) => ({
      rank: i + 1, ticker: m.ticker, name: m.name, change: m.change,
      edge: reasons[m.ticker] ?? `${m.changePercent}% — bottom mover today`, sector: 'Equities',
    })),
    generatedAt: new Date().toISOString(),
  };
}
