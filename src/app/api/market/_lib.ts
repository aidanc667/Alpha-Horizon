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
  const todayET = getTodayET(); // YYYY-MM-DD in ET timezone
  // Parse as noon UTC so getDay() is stable regardless of local machine timezone
  const d = new Date(todayET + 'T12:00:00Z');
  // Skip back to the last trading day: Monday → Friday (−3), Sunday → Friday (−2), else −1
  const dow = d.getDay(); // 0=Sun, 1=Mon
  const daysBack = dow === 1 ? 3 : dow === 0 ? 2 : 1;
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
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

async function getCachedL1L2<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  // L1: in-process map
  // Casts are safe within a single deploy: keys are typed by caller convention.
  // L2 data could theoretically be stale across a schema change — cache key
  // bumps in agentResponseCache.ts handle this at the plan level.
  const l1 = getCached(key) as T | undefined;
  if (l1 !== undefined) return l1;

  // L2: Neon DB
  const l2 = await getDbCache(key, ttlMs) as T | null;
  if (l2 !== null) {
    setCache(key, l2); // warm L1
    return l2;
  }

  // Network fetch
  const fresh = await fetcher();
  setCache(key, fresh);          // always write L1
  if (fresh !== null) {
    await setDbCache(key, fresh); // only write L2 for real data
  }
  return fresh;
}

export async function fetchSPYPutCallRatio(): Promise<number | null> {
  return getCachedL1L2<number | null>('putCallRatio', CACHE_TTL.putCallRatio, async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (yahooFinance as any).options('SPY');
      let totalPuts = 0, totalCalls = 0;
      // Use expirations within the next 30 days — captures broader market hedging sentiment,
      // not just short-term weekly traders (7-day window was too noisy)
      const cutoff = Date.now() + 30 * 24 * 60 * 60 * 1000;
      for (const exp of (result.options ?? [])) {
        const expDate = exp.expirationDate instanceof Date
          ? exp.expirationDate.getTime()
          : new Date(exp.expirationDate ?? 0).getTime();
        if (expDate > cutoff) continue;
        for (const p of exp.puts  ?? []) totalPuts  += p.volume ?? 0;
        for (const c of exp.calls ?? []) totalCalls += c.volume ?? 0;
      }
      if (totalCalls === 0) return null;
      return Math.round((totalPuts / totalCalls) * 100) / 100;
    } catch { return null; }
  });
}

export interface SPYData {
  changePercent: number | null;
  direction: 'Up' | 'Down' | 'Flat';
  above200MA: boolean | null;
  above50MA: boolean | null;
  volumeRatio: number | null;
}
export async function fetchSPYData(): Promise<SPYData> {
  return getCachedL1L2<SPYData>('spyData', CACHE_TTL.spyData, async () => {
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
      return {
        changePercent: changePct, direction,
        above200MA: price != null && ma200 != null ? price > ma200 : null,
        above50MA:  price != null && ma50  != null ? price > ma50  : null,
        volumeRatio: vol && avg && avg > 0 ? Math.round((vol / avg) * 10) / 10 : null,
      };
    } catch {
      return { changePercent: null, direction: 'Flat', above200MA: null, above50MA: null, volumeRatio: null };
    }
  });
}

export interface FearGreedData {
  score: number;
  label: 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';
  delta: number;
  previousClose: number;
}

/**
 * Composite market sentiment score (0–100) built entirely from Yahoo Finance data.
 * Replaces CNN Fear & Greed (blocked as of 2026 with HTTP 418).
 *
 * Four equally-weighted components (0–25 each):
 *   1. VIX level          — lower VIX → more greed
 *   2. SPY put/call ratio — lower PCR → more greed
 *   3. SPY MA position    — above 50MA + 200MA → greed; below both → fear
 *   4. SPY daily momentum — positive day → greed; negative → fear
 */
export async function fetchFearAndGreed(): Promise<FearGreedData | null> {
  return getCachedL1L2<FearGreedData | null>('fearAndGreed', CACHE_TTL.fearAndGreed, async () => {
  try {
    // Fetch VIX + SPY data + put/call in parallel
    const [vixQuote, spyData, pcRatio] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (yahooFinance as any).quote('^VIX').catch(() => null),
      fetchSPYData(),
      fetchSPYPutCallRatio(),
    ]);

    const vix: number | null = vixQuote?.regularMarketPrice ?? null;
    const pcr: number | null = pcRatio;
    const chg: number | null = spyData.changePercent;
    const above50  = spyData.above50MA;
    const above200 = spyData.above200MA;

    // ── Component 1: VIX (0–25, lower VIX = more greed) ──────────────────────
    const vixScore =
      vix == null ? 13 :  // neutral fallback
      vix < 12   ? 25 :
      vix < 15   ? 21 :
      vix < 18   ? 17 :
      vix < 22   ? 12 :
      vix < 28   ?  6 :
      vix < 35   ?  2 : 0;

    // ── Component 2: Put/Call ratio (0–25, lower PCR = more greed) ───────────
    const pcrScore =
      pcr == null ? 13 :  // neutral fallback
      pcr < 0.50  ? 25 :
      pcr < 0.65  ? 21 :
      pcr < 0.75  ? 16 :
      pcr < 0.85  ? 12 :
      pcr < 1.00  ?  7 :
      pcr < 1.20  ?  3 : 0;

    // ── Component 3: SPY vs moving averages (0–25) ────────────────────────────
    const maScore =
      above50 == null && above200 == null ? 13 :  // neutral fallback
      above50 && above200 ? 25 :
      above200            ? 13 :
      above50             ? 10 : 0;

    // ── Component 4: SPY daily momentum (0–25) ────────────────────────────────
    const momScore =
      chg == null  ? 13 :  // neutral fallback
      chg >  1.5   ? 25 :
      chg >  0.5   ? 20 :
      chg >  0     ? 15 :
      chg > -0.5   ? 10 :
      chg > -1.5   ?  4 : 0;

    const score = vixScore + pcrScore + maScore + momScore;

    const label: FearGreedData['label'] =
      score <= 20 ? 'Extreme Fear' :
      score <= 40 ? 'Fear' :
      score <= 60 ? 'Neutral' :
      score <= 80 ? 'Greed' : 'Extreme Greed';

    // Delta vs yesterday's close (keyed by date so intra-day refreshes don't reset delta)
    // Use getTodayET/getYesterdayET to avoid midnight-UTC timezone bug
    const todayKey = getTodayET();
    const yesterdayKey = getYesterdayET();
    let previousClose = score;
    try {
      const sql = db();
      // Read yesterday's stored close; fall back to today's if missing (first-ever run)
      const rows = await sql`SELECT data FROM macro_cache WHERE cache_key = ${'sentiment_prev_' + yesterdayKey} OR cache_key = ${'sentiment_prev_' + todayKey} ORDER BY fetched_at DESC LIMIT 2`;
      const yesterday = rows.find((r: Record<string, unknown>) => (r as { cache_key: string }).cache_key === 'sentiment_prev_' + yesterdayKey);
      if (yesterday?.data) previousClose = (yesterday.data as { score: number }).score ?? score;
      // Only write today's score once per calendar day (first write wins — intra-day stable delta)
      const todayExists = rows.find((r: Record<string, unknown>) => (r as { cache_key: string }).cache_key === 'sentiment_prev_' + todayKey);
      if (!todayExists) {
        await sql`
          INSERT INTO macro_cache (cache_key, data, fetched_at)
          VALUES (${'sentiment_prev_' + todayKey}, ${JSON.stringify({ score })}, now())
          ON CONFLICT (cache_key) DO NOTHING
        `;
      }
    } catch { /* non-fatal */ }

    return { score, label, delta: score - previousClose, previousClose };
  } catch {
    return null;
  }
  });
}

export interface MoverQuote { ticker: string; name: string; changePercent: number; change: string }

const SECTOR_ETFS = ['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC'];
const SECTOR_NAMES: Record<string, string> = {
  XLK: 'Technology', XLF: 'Financials', XLE: 'Energy', XLV: 'Health Care',
  XLI: 'Industrials', XLY: 'Consumer Disc.', XLP: 'Consumer Staples',
  XLU: 'Utilities', XLB: 'Materials', XLRE: 'Real Estate', XLC: 'Comm. Services',
};
export async function fetchSectorData(): Promise<{ leader: SectorQuote; lagger: SectorQuote } | null> {
  return getCachedL1L2<{ leader: SectorQuote; lagger: SectorQuote } | null>('sectorData', CACHE_TTL.sectorData, async () => {
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
      if (results.length < 2) return null;
      results.sort((a, b) => b.changePercent - a.changePercent);
      return { leader: results[0], lagger: results[results.length - 1] };
    } catch { return null; }
  });
}

export async function fetchMarketMovers(): Promise<{ gainers: MoverQuote[]; losers: MoverQuote[] }> {
  return getCachedL1L2<{ gainers: MoverQuote[]; losers: MoverQuote[] }>('marketMovers', CACHE_TTL.marketMovers, async () => {
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
      return { gainers, losers };
    } catch { return { gainers: [], losers: [] }; }
  });
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

// ─── DB-backed cache (survives cold starts) ───────────────────────────────────
// Unlike the in-process Map, these persist in Neon across serverless cold starts.
// Use for expensive Gemini calls (nearTerm, liveUpdate) that shouldn't re-run every request.

export async function getDbCache(key: string, maxAgeMs: number): Promise<unknown | null> {
  try {
    const sql = db();
    const rows = await sql`
      SELECT data, fetched_at FROM macro_cache
      WHERE cache_key = ${key}
        AND fetched_at > now() - (${maxAgeMs} * interval '1 millisecond')
      LIMIT 1
    `;
    return rows[0]?.data ?? null;
  } catch { return null; }
}

export async function setDbCache(key: string, data: unknown): Promise<void> {
  try {
    const sql = db();
    await sql`
      INSERT INTO macro_cache (cache_key, data, fetched_at)
      VALUES (${key}, ${JSON.stringify(data)}, now())
      ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at
    `;
  } catch { /* non-fatal */ }
}

// ─── Adaptive signal weight persistence ──────────────────────────────────────
import type { SignalWeights } from '@/lib/market/scoring';
import { DEFAULT_SIGNAL_WEIGHTS } from '@/lib/market/scoring';

export async function loadSignalWeights(sql: ReturnType<typeof db>): Promise<SignalWeights> {
  try {
    const rows = await sql`SELECT data FROM macro_cache WHERE cache_key = 'signal_weights'`;
    if (rows[0]?.data) return rows[0].data as SignalWeights;
  } catch { /* non-fatal */ }
  return DEFAULT_SIGNAL_WEIGHTS;
}

export async function saveSignalWeights(sql: ReturnType<typeof db>, weights: SignalWeights): Promise<void> {
  try {
    await sql`
      INSERT INTO macro_cache (cache_key, data, fetched_at)
      VALUES ('signal_weights', ${JSON.stringify(weights)}, now())
      ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at
    `;
  } catch { /* non-fatal */ }
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
