import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { checkRateLimit } from '@/lib/rateLimit';
import { scoreAccuracy, buildWeather, computePredictionSignals, rowToRecord } from '@/lib/market/scoring';
import type { SectorQuote } from '@/lib/market/scoring';
import YahooFinanceCls from 'yahoo-finance2';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yahooFinance = new (YahooFinanceCls as any)();

// ─── Server-side response cache ───────────────────────────────────────────────
interface CacheEntry { data: unknown; ts: number }
const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL: Record<string, number> = {
  nearTerm: 20 * 60 * 1000,       // 20 minutes
  liveUpdate: 10 * 60 * 1000,     // 10 minutes
  outlook: 2 * 60 * 60 * 1000,    // 2 hours
  polygonContext: 5 * 60 * 1000,  // 5 minutes
  portfolioAdvice: 0,              // never cache (personalized)
  // Market data fetchers — shared across concurrent requests
  fearAndGreed: 10 * 60 * 1000,   // 10 minutes
  spyData: 5 * 60 * 1000,         // 5 minutes
  sectorData: 10 * 60 * 1000,     // 10 minutes
  marketMovers: 10 * 60 * 1000,   // 10 minutes
  putCallRatio: 5 * 60 * 1000,    // 5 minutes
};
function getCached(key: string): unknown | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  const ttl = CACHE_TTL[key.split(':')[0]] ?? 0;
  if (ttl === 0) return null;
  if (Date.now() - entry.ts > ttl) { responseCache.delete(key); return null; }
  return entry.data;
}
function setCache(key: string, data: unknown) {
  const ttl = CACHE_TTL[key.split(':')[0]] ?? 0;
  if (ttl > 0) responseCache.set(key, { data, ts: Date.now() });
}

// ─── API key lives ONLY on the server ────────────────────────────────────────
function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set in server environment.');
  return key;
}

const getCurrentDate = () =>
  new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// Returns today's date in ET timezone as YYYY-MM-DD
function getTodayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

// Returns true if current time is past noon ET
function isAfterNoonET(): boolean {
  const etHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date())
  );
  return etHour >= 12;
}

// Returns yesterday's date in ET as YYYY-MM-DD
function getYesterdayET(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

// rowToRecord, scoreAccuracy, buildWeather, computePredictionSignals and SECTOR_CATS
// are imported from @/lib/market/scoring — see that file for implementations.

async function fetchSPYPutCallRatio(): Promise<number | null> {
  const cached = getCached('putCallRatio') as number | null | undefined;
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (yahooFinance as any).options('SPY');
    let totalPuts = 0;
    let totalCalls = 0;
    // Only include expirations within the next 7 days (current week's 0DTE + weeklies).
    // Long-dated puts (>7 days) are mostly institutional portfolio hedges that dilute the
    // daily sentiment signal. Current-week options represent active speculative positioning.
    const cutoff = Date.now() + 7 * 24 * 60 * 60 * 1000;
    for (const exp of (result.options ?? [])) {
      const expDate = exp.expirationDate instanceof Date
        ? exp.expirationDate.getTime()
        : new Date(exp.expirationDate ?? 0).getTime();
      if (expDate > cutoff) continue;
      for (const p of exp.puts ?? []) totalPuts += p.volume ?? 0;
      for (const c of exp.calls ?? []) totalCalls += c.volume ?? 0;
    }
    if (totalCalls === 0) { setCache('putCallRatio', null); return null; }
    const ratio = Math.round((totalPuts / totalCalls) * 100) / 100;
    setCache('putCallRatio', ratio);
    return ratio;
  } catch {
    return null;
  }
}

interface SPYData {
  changePercent: number | null;   // e.g. -0.24
  direction: 'Up' | 'Down' | 'Flat';
  above200MA: boolean | null;
  above50MA: boolean | null;
  volumeRatio: number | null;     // today vol / 3-month avg vol
}

async function fetchSPYData(): Promise<SPYData> {
  const cached = getCached('spyData') as SPYData | undefined;
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote = await (yahooFinance as any).quote('SPY');
    const price: number | null = quote?.regularMarketPrice ?? null;
    const changePct: number | null = quote?.regularMarketChangePercent != null
      ? Math.round(quote.regularMarketChangePercent * 100) / 100
      : null;
    const ma50: number | null = quote?.fiftyDayAverage ?? null;
    const ma200: number | null = quote?.twoHundredDayAverage ?? null;
    const vol: number | null = quote?.regularMarketVolume ?? null;
    const avg: number | null = quote?.averageVolume ?? quote?.averageDailyVolume3Month ?? null;

    const direction: 'Up' | 'Down' | 'Flat' =
      changePct == null ? 'Flat' :
      changePct > 0.3 ? 'Up' :
      changePct < -0.3 ? 'Down' : 'Flat';

    const result: SPYData = {
      changePercent: changePct,
      direction,
      above200MA: price != null && ma200 != null ? price > ma200 : null,
      above50MA: price != null && ma50 != null ? price > ma50 : null,
      volumeRatio: vol && avg && avg > 0 ? Math.round((vol / avg) * 10) / 10 : null,
    };
    setCache('spyData', result);
    return result;
  } catch {
    return { changePercent: null, direction: 'Flat', above200MA: null, above50MA: null, volumeRatio: null };
  }
}

// ─── Fear & Greed fetch ───────────────────────────────────────────────────────
interface FearGreedData {
  score: number;
  label: 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';
  delta: number;
  previousClose: number;
}

async function fetchFearAndGreed(): Promise<FearGreedData | null> {
  const cached = getCached('fearAndGreed') as FearGreedData | null | undefined;
  if (cached !== undefined) return cached;
  try {
    const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const fg = data?.fear_and_greed;
    if (!fg?.score) return null;
    const score = Math.round(fg.score);
    const prev = Math.round(fg.previous_close ?? fg.score);
    const label: FearGreedData['label'] =
      score <= 20 ? 'Extreme Fear' :
      score <= 40 ? 'Fear' :
      score <= 60 ? 'Neutral' :
      score <= 80 ? 'Greed' : 'Extreme Greed';
    const fgResult = { score, label, delta: score - prev, previousClose: prev };
    setCache('fearAndGreed', fgResult);
    return fgResult;
  } catch {
    return null;
  }
}

// ─── Sector ETF fetch ─────────────────────────────────────────────────────────
const SECTOR_ETFS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC'];
const SECTOR_NAMES: Record<string, string> = {
  XLK: 'Technology', XLF: 'Financials', XLE: 'Energy', XLV: 'Health Care',
  XLI: 'Industrials', XLY: 'Consumer Disc.', XLP: 'Consumer Staples',
  XLU: 'Utilities', XLB: 'Materials', XLRE: 'Real Estate', XLC: 'Comm. Services',
};

async function fetchSectorData(): Promise<{ leader: SectorQuote; lagger: SectorQuote } | null> {
  const cached = getCached('sectorData') as { leader: SectorQuote; lagger: SectorQuote } | null | undefined;
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quotes = await (yahooFinance as any).quote(SECTOR_ETFS);
    const results: SectorQuote[] = (Array.isArray(quotes) ? quotes : [quotes])
      .filter((q: Record<string, unknown>) => q?.symbol != null)
      .map((q: Record<string, unknown>) => ({
        ticker: String(q.symbol),
        sector: SECTOR_NAMES[String(q.symbol)] ?? String(q.symbol),
        changePercent: q.regularMarketChangePercent != null
          ? Math.round(Number(q.regularMarketChangePercent) * 100) / 100
          : 0,
      }));
    if (results.length < 2) { setCache('sectorData', null); return null; }
    results.sort((a, b) => b.changePercent - a.changePercent);
    const sectorResult = { leader: results[0], lagger: results[results.length - 1] };
    setCache('sectorData', sectorResult);
    return sectorResult;
  } catch {
    return null;
  }
}

// ─── Market movers fetch ──────────────────────────────────────────────────────
interface MoverQuote { ticker: string; name: string; changePercent: number; change: string; }

async function fetchMarketMovers(): Promise<{ gainers: MoverQuote[]; losers: MoverQuote[] }> {
  const cached = getCached('marketMovers') as { gainers: MoverQuote[]; losers: MoverQuote[] } | undefined;
  if (cached) return cached;
  try {
    const [gainersResult, losersResult] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (yahooFinance as any).screener({ scrIds: 'day_gainers', count: 10 }).catch(() => null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (yahooFinance as any).screener({ scrIds: 'day_losers', count: 10 }).catch(() => null),
    ]);

    const toMover = (q: Record<string, unknown>): MoverQuote => {
      const pct = Math.round(Number(q.regularMarketChangePercent) * 100) / 100;
      return {
        ticker: String(q.symbol),
        name: String(q.shortName ?? q.longName ?? q.symbol),
        changePercent: pct,
        change: `${pct >= 0 ? '+' : ''}${pct}%`,
      };
    };

    const gainers: MoverQuote[] = ((gainersResult?.quotes ?? gainersResult ?? []) as Record<string, unknown>[])
      .filter((q) => q?.regularMarketChangePercent != null)
      .slice(0, 5)
      .map(toMover);

    const losers: MoverQuote[] = ((losersResult?.quotes ?? losersResult ?? []) as Record<string, unknown>[])
      .filter((q) => q?.regularMarketChangePercent != null)
      .slice(0, 5)
      .map(toMover);

    const moversResult = { gainers, losers };
    setCache('marketMovers', moversResult);
    return moversResult;
  } catch {
    return { gainers: [], losers: [] };
  }
}

// ─── POST /api/market ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Allow internal cron calls to bypass Clerk auth
  const cronSecret = req.headers.get('x-cron-secret');
  const isCronCall = cronSecret && process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;

  let currentUserId: string | null = null;
  if (!isCronCall) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    currentUserId = userId;
    if (!await checkRateLimit(currentUserId, 'market', 30)) {
      return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });
    }
  }

  try {
    const body = await req.json();
    const { action } = body;
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const model = 'gemini-2.5-flash';

    // ── nearTerm ─────────────────────────────────────────────────────────────
    if (action === 'nearTerm') {
      const cached = getCached('nearTerm');
      if (cached) return NextResponse.json({ success: true, data: cached });
      const prompt = `
    You are a professional macro market strategist at a top-tier institutional research firm (e.g., Goldman Sachs, J.P. Morgan, BlackRock).
    Generate a high-precision, decision-focused market briefing based on the latest real-world data as of today, ${getCurrentDate()}.

    Follow this 🏦 AI-Powered Investment Workflow (Professional Level):

    Step 1: Macro Pillars (Real-Time Indicators)
    - Goal: Provide real-time accurate values and directions for these 5 pillars:
      1. Interest Rates: US 10Y Treasury Yield
      2. Inflation: Core PCE (MoM)
      3. Sentiment: VIX Index + Daily SPY put/call ratio (volume)
      4. Growth: ISM Manufacturing PMI
      5. Liquidity: Net Liquidity
    - For each, provide the name (e.g., "SENTIMENT"), the indicator description (e.g., "VIX + Daily SPY put/call ratio (volume) using current day Total SPY put volume ÷ total SPY call volume"), the current real-time value, the direction (Up, Down, Neutral) backed by expert analysis, and the specific source name where you found the data (e.g., "CBOE", "Nasdaq", "Bloomberg").
    - CRITICAL for Sentiment: The value MUST include BOTH the current VIX Index level AND the Daily SPY put/call ratio (volume), formatted as "VIX / Ratio" (e.g., "14.20 / 0.85"). The ratio MUST be calculated as (Total SPY put volume today ÷ total SPY call volume today). You MUST search for these specific real-time values. Do NOT provide a single number or a placeholder like "1".
    - CRITICAL for Liquidity: The value for "Net Liquidity" should NOT be a number. It must be exactly one of: "Increasing", "Neutral", or "Decreasing".
    - For each pillar, provide a "reasoning" field that briefly explains the current value and why the direction was chosen, referencing recent data points.
    - For each pillar, provide a "source" field that specifies exactly where the data was found.
    - For each pillar, provide a "percentile" field (integer 0–100) representing where the current reading sits in its 20-year historical distribution. 0 = all-time low, 50 = median, 100 = all-time high. Example: VIX at 24 ≈ 65th percentile; 10Y yield at 4.4% in today's context ≈ 70th percentile.

    Step 2: Market Snapshot (What's happening?)
    - Goal: Give the current market regime, key drivers in the last 24 hours, and overall sentiment.
    - Look for: Risk-on vs risk-off; Inflation, interest rates, sentiment, and economic growth direction; Sector leadership; Volatility changes.
    - Output: 5–7 bullet points max.

    Step 3: Causal Analysis (Why is it happening?)
    - Goal: Explain why each of these drivers is happening and what changed recently.
    - Build edge by connecting macro -> market behavior (e.g., Inflation expectations rising? -> why? Yields moving? -> growth or Fed expectations? Tech rallying? -> earnings or liquidity?).
    - Provide EXACTLY 6 distinct causal analysis items.

    Step 4: Transmission Mechanism (What This Means for Investors?)
    - Goal: What does this mean for specific asset classes over the next 1–3 months?
    - You MUST provide analysis for exactly these 5 categories:
      1. Equities (Broad market and sectors)
      2. Cash/Fixed Income (Yields, duration, credit spreads)
      3. Real Assets (Commodities, Real Estate, Infrastructure)
      4. Alternatives (Hedge funds, Private Equity, Cryptocurrencies)
      5. Currencies (USD, EUR, JPY, EM FX)
    - For each category, provide a HIGHLY DETAILED "Impact Analysis" (at least 3-5 sentences).
    - Ensure the information is accurate, data-driven, and references specific macro drivers or institutional research.
    - Build a timeline and clear cause -> effect (e.g., "Higher yields -> pressure on tech valuations (immediate)", "Stronger USD -> headwinds for EM and multinationals (1 month)").
    - Provide clear investor guidance for each.

    Step 5: Asset/Sector Analysis (Positioning)
    - Goal: Based on the above, what are the highest conviction positioning ideas?
    - Provide exactly 3 Overweight and 3 Underweight examples.
    - For each, list the SPECIFIC name of the asset or sector ETF (e.g., "Energy Select Sector SPDR Fund (XLE)", "Vanguard Long-Term Treasury ETF (VGLT)").
    - Provide a detailed rationale backed by evidence and consistent with the macro analysis.

    Step 5: Risks & Counterarguments
    - Goal: What could invalidate this thesis? What are we missing?
    - Always provide a bear case for the bull case.

    Step 6: Upcoming Catalysts
    - Goal: What are the 3–5 key events in the next 7 days that could change this outlook?
    - Focus on CPI, Fed speakers, earnings, etc.

    Step 7: Sources
    - Goal: List the names of the sources used for this analysis (e.g., Bloomberg, Reuters, FT).
    - Provide ONLY the names of the sources. No URLs, headlines, or descriptions are needed.

    CRITICAL: You MUST use the Google Search tool to find ACTUAL, REAL-WORLD LIVE data as of today, ${getCurrentDate()}.
    DO NOT rely on internal knowledge for current prices, yields, or market levels.

    ANTI-HALLUCINATION PROTOCOL:
    1. SEARCH FIRST: Perform a broad search for "market news ${getCurrentDate()}" and specific asset searches.
    2. VERIFY TREND REVERSALS: Actively look for news about "crashes", "sell-offs", "rallies", or "plunges" in major assets before reporting any level.
    3. FACT CHECK ALL MAJOR ASSETS: Search for the current price of Gold, S&P 500, 10Y Treasury yield, and Oil. Report what your search finds TODAY — never assume a previous high or low is still valid.
    4. PRIORITIZE RECENCY: Use data from the last 24 hours over data from earlier in the week. If an asset moved significantly, report the move.
    5. INSTITUTIONAL SOURCES: Prioritize Bloomberg, Reuters, FT, and WSJ.

    If you find conflicting information, prioritize the most recent data from institutional sources.
    FACT CHECK: Specifically verify major asset levels (e.g., Gold, S&P 500, 10Y Yields) before outputting.
    Never anchor to a previously known price — always search for today's actual level.
    Focus on institutional-grade sources: Bloomberg, Reuters, Financial Times, Wall Street Journal.
    Keep the analysis concise and focused to ensure rapid generation (aim for under 20 seconds).

    Ensure all generated text has proper word spacing.
  `;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              timestamp: { type: Type.STRING },
              macroPillars: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    indicator: { type: Type.STRING },
                    value: { type: Type.STRING },
                    direction: { type: Type.STRING, enum: ['Up', 'Down', 'Neutral'] },
                    reasoning: { type: Type.STRING },
                    source: { type: Type.STRING },
                    percentile: { type: Type.INTEGER },
                  },
                  required: ['name', 'indicator', 'value', 'direction', 'reasoning', 'source'],
                },
              },
              marketSnapshot: {
                type: Type.OBJECT,
                properties: {
                  bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
                  sentiment: { type: Type.STRING, enum: ['Risk-On', 'Neutral', 'Risk-Off'] },
                  regime: { type: Type.STRING },
                  confidence: { type: Type.STRING, enum: ['High', 'Moderate', 'Low'] },
                },
                required: ['bullets', 'sentiment', 'regime', 'confidence'],
              },
              causalAnalysis: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    driver: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    connection: { type: Type.STRING },
                  },
                  required: ['driver', 'explanation', 'connection'],
                },
              },
              transmissionMechanism: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    assetClass: { type: Type.STRING },
                    impact: { type: Type.STRING },
                    timeline: { type: Type.STRING },
                    investorGuidance: { type: Type.STRING },
                  },
                  required: ['assetClass', 'impact', 'timeline', 'investorGuidance'],
                },
              },
              positioning: {
                type: Type.OBJECT,
                properties: {
                  overweight: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        idea: { type: Type.STRING },
                        rationale: { type: Type.STRING },
                      },
                      required: ['idea', 'rationale'],
                    },
                  },
                  underweight: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        idea: { type: Type.STRING },
                        rationale: { type: Type.STRING },
                      },
                      required: ['idea', 'rationale'],
                    },
                  },
                },
                required: ['overweight', 'underweight'],
              },
              risks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    risk: { type: Type.STRING },
                    counterArgument: { type: Type.STRING },
                  },
                  required: ['risk', 'counterArgument'],
                },
              },
              catalysts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    event: { type: Type.STRING },
                    date: { type: Type.STRING },
                    significance: { type: Type.STRING },
                  },
                  required: ['event', 'date', 'significance'],
                },
              },
              sources: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                  },
                  required: ['name'],
                },
              },
            },
            required: [
              'macroPillars',
              'marketSnapshot',
              'causalAnalysis',
              'transmissionMechanism',
              'positioning',
              'risks',
              'catalysts',
              'sources',
            ],
          },
        },
      });

      const result = JSON.parse(response.text || '{}');
      setCache('nearTerm', result);
      return NextResponse.json({ success: true, data: result });
    }

    // ── liveUpdate ────────────────────────────────────────────────────────────
    if (action === 'liveUpdate') {
      const cached = getCached('liveUpdate');
      if (cached) return NextResponse.json({ success: true, data: cached });
      const prompt = `
    You are a real-time market intelligence analyst at a top-tier investment bank.
    Today is ${getCurrentDate()}. Use Google Search RIGHT NOW to find the 8 most market-moving financial news stories breaking in the last few hours.

    SOURCES TO SEARCH (in priority order):
    1. Bloomberg (bloomberg.com)
    2. Reuters (reuters.com)
    3. Financial Times (ft.com)
    4. The Wall Street Journal (wsj.com)
    5. MarketWatch (marketwatch.com)
    6. Barron's (barrons.com)

    TASK:
    Search each of these sources and identify the TOP 8 headlines that are most likely to move markets, affect investment decisions, or change the macro outlook RIGHT NOW. Synthesize across all 6 sources to ensure the best coverage.

    CRITERIA for selecting the top 8:
    - Breaking news about Fed, interest rates, or monetary policy
    - Major earnings surprises or guidance changes from large-cap companies
    - Geopolitical developments affecting energy, commodities, or global trade
    - Significant economic data releases (CPI, jobs, GDP, PMI)
    - Large moves in major assets (S&P 500, 10Y Treasury, Gold, Oil, USD)
    - Central bank decisions or statements from other major economies

    DO NOT include: opinion pieces, analyst upgrades/downgrades of individual small-cap stocks, lifestyle/business profiles, or non-market news.

    ANTI-HALLUCINATION: Search first. Do NOT invent headlines. Every headline must come from one of the 6 sources listed above from TODAY or the last 24 hours.

    For each of the 8 headlines, provide:
    - headline: the actual headline text as it appears (or closely paraphrased)
    - source: EXACTLY one of: "Bloomberg", "Reuters", "Financial Times", "Wall Street Journal", "MarketWatch", "Barron's"
    - impact: ONE sentence explaining why this matters for investors right now

    Also provide a brief 1-2 sentence overall market summary based on these 8 stories.
    Set timestamp to the current time (e.g., "March 31, 2026 — 2:45 PM ET").

    Ensure all generated text has proper word spacing. Aim for rapid generation (under 10 seconds).
  `;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              newsHeadlines: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    headline: { type: Type.STRING },
                    source: { type: Type.STRING, enum: ['Bloomberg', 'Reuters', 'Financial Times', 'Wall Street Journal', 'MarketWatch', "Barron's"] },
                    impact: { type: Type.STRING },
                  },
                  required: ['headline', 'source', 'impact'],
                },
              },
              timestamp: { type: Type.STRING },
            },
            required: ['summary', 'newsHeadlines', 'timestamp'],
          },
        },
      });

      const result = JSON.parse(response.text || '{}');
      setCache('liveUpdate', result);
      return NextResponse.json({ success: true, data: result });
    }

    // ── outlook ───────────────────────────────────────────────────────────────
    if (action === 'outlook') {
      const { horizon } = body;
      const outlookCacheKey = 'outlook:' + horizon;
      const cached = getCached(outlookCacheKey);
      if (cached) return NextResponse.json({ success: true, data: cached });

      let horizonSpecificInstructions = '';

      switch (horizon) {
        case '6 months':
        case '1 year':
          horizonSpecificInstructions = `
        HORIZON: ${horizon} (Tactical)
        Include ONLY firms that publish short-term market outlooks:
        - Goldman Sachs
        - BlackRock
        - Morgan Stanley
        - Bank of America
        - Citi
        ${horizon === '1 year' ? '- Morningstar (ONLY if explicit 12-month valuation commentary exists)' : ''}

        Use: Year-ahead outlooks, Macro views, Equity targets, Tactical asset allocation.
        DO NOT include: Vanguard, JP Morgan CMA, BNY CMA, or any 10-year assumptions.
        TAG all data points as [Tactical].
      `;
          break;
        case '3-5 years':
          horizonSpecificInstructions = `
        HORIZON: 3-5 years (Intermediate / Derived)
        Include:
        - BlackRock (if medium-term views exist)
        - Morningstar (valuation-based expected returns)
        - OPTIONAL: Derived estimates from 10-year CMAs (must be explicitly labeled)

        Rules:
        - You MAY interpolate from 10-year CMAs IF explicitly labeled: [Derived]
        - Do NOT present these as precise forecasts.
        TAG data points as [Derived] or [Tactical] as appropriate.
      `;
          break;
        case '10 years':
          horizonSpecificInstructions = `
        HORIZON: 10 years (Core CMA Horizon)
        Include ALL major CMA providers:
        - Vanguard (VEMO)
        - BlackRock
        - JP Morgan
        - BNY Mellon
        - Morningstar
        - Research Affiliates
        - Schwab (if available)

        This is the PRIMARY and MOST IMPORTANT dataset.
        TAG all data points as [Strategic CMA].
      `;
          break;
        case '20-30 years':
          horizonSpecificInstructions = `
        HORIZON: 20-30 years (Extended Strategic)
        Use:
        - Vanguard
        - JP Morgan
        - BlackRock
        - Any long-duration institutional models

        Rules:
        - Extend 10-year assumptions using mean reversion, inflation assumptions, and long-term equilibrium returns.
        TAG all data points as [Strategic CMA].
      `;
          break;
      }

      const prompt = `
    You are an Institutional Portfolio Strategist and Risk Reviewer at a top-tier global investment bank.
    Your task is to generate a comprehensive market outlook for the following time horizon: ${horizon}.

    CRITICAL OBJECTIVE:
    Transform the analysis into a realistic, credible, and decision-useful investment outlook that a professional RIA or portfolio manager would trust.

    STEP 1: REMOVE SOFT HALLUCINATIONS & OVERCONFIDENCE
    - Identify and fix statements that present opinions as "consensus".
    - Replace "institutional consensus shows..." with "many institutions expect..." or "base case assumption is...".
    - Avoid definitive claims about uncertain macro outcomes.
    - Use ranges (e.g., "2.2% – 2.7%") instead of point estimates (e.g., "2.7%").

    STEP 2: ENFORCE INTERNAL CONSISTENCY
    - Ensure Macro -> Market -> Positioning logic is perfectly aligned.
    - Example: If the Fed is expected to cut rates and inflation is cooling, long-duration bonds should NOT be underweight.
    - Example: If growth is strong, equities should generally be supported over defensive assets.
    - Every overweight/underweight must have a clear macro justification and no contradictions.

    STEP 3: TIME HORIZON DISCIPLINE (${horizon})
    - Focus ONLY on factors impactful within this specific horizon.
    - For 1-year outlooks, focus on: Rates, Inflation, Earnings, Liquidity, and Geopolitics.
    - Downgrade long-term structural themes (e.g., 10-year AI productivity shifts) unless they affect near-term earnings.

    STEP 4: CALIBRATE REALISM
    - Bull case must be plausible, not extreme.
    - Bear case severity must match its narrative.
    - Base case must reflect the current macro environment accurately.
    - Avoid "perfect" outcomes (e.g., inflation exactly 2.0%).

    STEP 5: INSTITUTIONAL TONE
    - Use "likely", "expected to", "could" instead of "will".
    - Avoid emotional or narrative-heavy language.
    - Ensure causal links are clear.

    EXPERT RESEARCH STACK:
    - J.P. Morgan (LTCMA 2026 / 30th Edition)
    - Vanguard (VCMM 2026 Outlook)
    - BlackRock (2026 Investment Institute Guide)
    - Goldman Sachs (2026 Market Pulse)
    - Morningstar (Q1 2026 Capital Market Assumptions)
    - BNY Mellon (2026 Endurance under Pressure)

    You MUST use Google Search and Gemini AI to verify these numbers and ensure they are up-to-date for ${getCurrentDate()}.
    Keep the analysis concise and focused to ensure rapid generation (aim for under 20 seconds).

    SECTIONS TO GENERATE:
    1. STRATEGIC REGIME:
    - Regime Classification (clean, realistic).
    - Narrative Anchor (core theme).
    - Structural Drivers (relevant to ${horizon}).
    - Market Outlook: A clear, institutional explanation of the expected path.

    2. CONSENSUS SUMMARY DASHBOARD (Exactly 8 Asset Classes):
    - Asset Classes: U.S. Large Cap, U.S. Small/Mid Cap, International Developed Equities, Emerging Markets, Fixed Income (U.S. Core), Real Assets (Commodities/REITs), Alternatives (Private Equity/Credit), Cash/Money Markets.
    - Provide: Estimated Return Range, Estimated Volatility Range, and Status (Overweight, Neutral, Underweight).

    3. KEY STRATEGIC INSIGHTS:
    - Provide EXACTLY 6 highly useful, horizon-specific insights.

    4. PORTFOLIO IMPLICATIONS:
    - List specific assets/sectors (e.g., "U.S. Quality Growth", "Short-Duration IG Credit").
    - Ensure decisions are backed by the Expert Research Stack.

    5. ASSET/SECTOR ANALYSIS (Top 5 & Bottom 5):
    - Identify specific assets/sectors (e.g., "NVIDIA", "U.S. 10Y Treasury").
    - List tickers (e.g., "SPY, IVV") as examples for broad categories.
    - Provide specific "Reasoning".

    6. SECTOR IMPACT:
    - Analysis of sector-level tailwinds and headwinds.

    7. SCENARIO FRAMEWORK:
    - Define 3 scenarios: "Base Case", "Bull Case", and "Bear Case". Probabilities must sum to 100%.
    - Must be realistic, probabilistically sound, and directly useful for investment decisions.
    - Provide GDP and Inflation projections for each, backed by the research stack.

    8. TAIL RISKS & CATALYSTS:
    - Primary Tail Risk Scenario: 1-2 sentences. Must include a clear trigger (e.g., geopolitical escalation), a transmission mechanism (e.g., Energy -> Inflation -> Fed -> Markets), and the impact on the current base case.
    - Key Risks & Catalysts: For each risk, use the structure "[Risk Name]: [Clear trigger] -> [Market implication]". Add a "Market Impact" line (e.g., "Equities ↓ / Rates ↑ / Volatility ↑").

    9. HISTORICAL ANALOG:
    - Period: Identify a historical period (e.g., 1995–1996) that matches the current cycle stage, inflation trend, and policy backdrop.
    - Context: Explain what happened then and why it matters now.
    - Differences from Today: 1 sentence explaining structural differences (e.g., higher inflation, fiscal deficits, geopolitical risk).
    - Strategic Lesson: Include a market behavior insight, a risk to monitor, and an investment implication.
    - Investment Takeaway: Provide an actionable positioning takeaway (e.g., "Favor broad equity exposure over narrow concentration").

    Return the result in JSON format matching the provided schema.
  `;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              strategicOutlook: {
                type: Type.OBJECT,
                properties: {
                  regime: { type: Type.STRING },
                  narrativeAnchor: { type: Type.STRING },
                  marketOutlook: { type: Type.STRING },
                  structuralDrivers: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['regime', 'narrativeAnchor', 'marketOutlook', 'structuralDrivers'],
              },
              assetSectorAnalysis: {
                type: Type.OBJECT,
                properties: {
                  top5: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        asset: { type: Type.STRING },
                        ticker: { type: Type.STRING },
                        reasoning: { type: Type.STRING },
                      },
                      required: ['asset', 'reasoning'],
                    },
                  },
                  bottom5: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        asset: { type: Type.STRING },
                        ticker: { type: Type.STRING },
                        reasoning: { type: Type.STRING },
                      },
                      required: ['asset', 'reasoning'],
                    },
                  },
                },
                required: ['top5', 'bottom5'],
              },
              sectorImpact: {
                type: Type.OBJECT,
                properties: {
                  positiveTailwinds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  headwinds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  macroDrivers: { type: Type.STRING },
                  confidence: { type: Type.STRING, enum: ['High', 'Moderate', 'Low'] },
                },
                required: ['positiveTailwinds', 'headwinds', 'macroDrivers', 'confidence'],
              },
              cmaDashboard: {
                type: Type.OBJECT,
                properties: {
                  horizonType: { type: Type.STRING, enum: ['Tactical', 'Intermediate', 'Strategic'] },
                  consensusSummary: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        assetClass: {
                          type: Type.STRING,
                          enum: [
                            'U.S. Large Cap',
                            'U.S. Small/Mid Cap',
                            'International Developed Equities',
                            'Emerging Markets',
                            'Fixed Income',
                            'Real Assets',
                            'Alternatives',
                            'Cash/Money Markets',
                          ],
                        },
                        returnRange: { type: Type.STRING },
                        volatilityRange: { type: Type.STRING },
                        status: { type: Type.STRING, enum: ['Overweight', 'Neutral', 'Underweight'] },
                        narrative: { type: Type.STRING },
                      },
                      required: ['assetClass', 'returnRange', 'volatilityRange', 'status', 'narrative'],
                    },
                  },
                  keyInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
                  portfolioImplications: {
                    type: Type.OBJECT,
                    properties: {
                      overweight: { type: Type.ARRAY, items: { type: Type.STRING } },
                      neutral: { type: Type.ARRAY, items: { type: Type.STRING } },
                      underweight: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['overweight', 'neutral', 'underweight'],
                  },
                },
                required: ['horizonType', 'consensusSummary', 'keyInsights', 'portfolioImplications'],
              },
              scenarioFramework: {
                type: Type.OBJECT,
                properties: {
                  scenarios: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING, enum: ['Base Case', 'Bull Case', 'Bear Case'] },
                        probability: { type: Type.NUMBER },
                        description: { type: Type.STRING },
                        gdpGrowth: { type: Type.STRING },
                        inflation: { type: Type.STRING },
                      },
                      required: ['name', 'probability', 'description', 'gdpGrowth', 'inflation'],
                    },
                  },
                  keyRisks: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        riskName: { type: Type.STRING },
                        description: { type: Type.STRING },
                        marketImpact: { type: Type.STRING },
                      },
                      required: ['riskName', 'description', 'marketImpact'],
                    },
                  },
                  primaryTailRisk: { type: Type.STRING },
                  historicalAnalog: {
                    type: Type.OBJECT,
                    properties: {
                      period: { type: Type.STRING },
                      context: { type: Type.STRING },
                      differences: { type: Type.STRING },
                      lessonLearned: { type: Type.STRING },
                      investmentImplication: { type: Type.STRING },
                    },
                    required: ['period', 'context', 'differences', 'lessonLearned', 'investmentImplication'],
                  },
                },
                required: ['scenarios', 'keyRisks', 'primaryTailRisk', 'historicalAnalog'],
              },
              sources: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    report: { type: Type.STRING },
                    date: { type: Type.STRING },
                  },
                  required: ['name', 'report', 'date'],
                },
              },
            },
            required: [
              'strategicOutlook',
              'assetSectorAnalysis',
              'cmaDashboard',
              'scenarioFramework',
              'sectorImpact',
              'sources',
            ],
          },
        },
      });

      const result = JSON.parse(response.text || '{}');
      setCache(outlookCacheKey, result);
      return NextResponse.json({ success: true, data: result });
    }

    // ── portfolioAdvice ───────────────────────────────────────────────────────
    if (action === 'portfolioAdvice') {
      const { history, context } = body;

      const chat = ai.chats.create({
        model,
        config: {
          tools: [{ googleSearch: {} }],
          systemInstruction: `
        You are a Senior Investment Analyst and Portfolio Manager at a top-tier institutional asset management firm.
        Your expertise is in macro-driven portfolio construction, risk management, and tactical asset allocation.

        YOUR MISSION:
        Provide sophisticated, data-driven investment advice and portfolio analysis based on the current market analysis dashboard.

        CURRENT MARKET ANALYSIS DASHBOARD DATA:
        ${JSON.stringify(context)}

        GUIDELINES:
        1. USE THE DASHBOARD: Always reference the specific Macro Pillars (Rates, Inflation, Sentiment, Growth, Liquidity), Market Snapshot, and Positioning Signals provided in the context.
        2. PORTFOLIO ANALYSIS: If the user describes their portfolio, analyze it through the lens of the current "Market Regime" and "Transmission Mechanisms" identified in the dashboard.
        3. RISK MANAGEMENT: Prioritize identifying tail risks and suggesting specific hedging strategies (e.g., duration adjustments, volatility hedges, sector rotations).
        4. TACTICAL ADVICE: Provide actionable overweight/underweight recommendations that align with the "Positioning" section of the dashboard.
        5. REAL-TIME VERIFICATION: Use the Google Search tool to verify any real-time market data (today is ${getCurrentDate()}).

        SPECIFIC CONTEXT:
        - Gold: Verify current price action. Reports indicate a recent peak above $5,200 followed by a crash through $5,000.
        - Sentiment: Reference the VIX and SPY Put/Call ratio from the dashboard.

        TONE:
        Professional, institutional, precise, and objective. Avoid generic advice; be specific to the data provided.

        Keep responses concise and focused to ensure rapid generation (aim for under 15 seconds).
      `,
        },
      });

      const lastMessage = history[history.length - 1].text;
      const response = await chat.sendMessage({ message: lastMessage });

      return NextResponse.json({ success: true, data: response.text || "I'm sorry, I couldn't generate a response." });
    }

    // ── polygonTicker — single ticker lookup (watchlist + portfolio analyzer) ───
    if (action === 'polygonTicker') {
      const { ticker } = body;
      if (!ticker || typeof ticker !== 'string') {
        return NextResponse.json({ error: 'ticker required' }, { status: 400 });
      }
      const clean = ticker.toUpperCase().replace(/[^A-Z0-9.^=-]/g, '').slice(0, 10);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const quote: any = await yahooFinance.quote(clean);
        const price: number | null = quote.regularMarketPrice ?? null;
        const changePct: number | null = quote.regularMarketChangePercent ?? null;
        if (!price) return NextResponse.json({ error: 'Price not available' }, { status: 404 });
        return NextResponse.json({ success: true, data: { ticker: clean, price, changePct, name: quote.shortName || clean } });
      } catch {
        return NextResponse.json({ error: 'Ticker not found' }, { status: 404 });
      }
    }

    // ── priceContext — real-time price snapshot via Yahoo Finance + FRED macro ──
    if (action === 'polygonContext') {
      const cached = getCached('polygonContext');
      if (cached) return NextResponse.json({ success: true, data: cached });

      const fredKey = process.env.FRED_API_KEY;
      const TICKERS = ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'HYG', 'UUP', 'XLK', 'XLF', 'XLE', 'XLV', 'VIXY'];

      const [yahooResults, fredRates, fredCpi, fredUnrate, fredSpread] = await Promise.allSettled([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Promise.all(TICKERS.map(t => (yahooFinance.quote(t) as Promise<any>).catch(() => null))),
        fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=DFF&api_key=${fredKey}&limit=1&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
        fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=${fredKey}&limit=13&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
        fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE&api_key=${fredKey}&limit=1&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
        fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=T10Y2Y&api_key=${fredKey}&limit=1&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
      ]);

      const priceMap: Record<string, { price: number; change1d: number; changePct1d: number }> = {};
      if (yahooResults.status === 'fulfilled') {
        for (const quote of yahooResults.value) {
          if (quote?.symbol && quote.regularMarketPrice) {
            priceMap[quote.symbol] = {
              price: quote.regularMarketPrice,
              change1d: quote.regularMarketChange ?? 0,
              changePct1d: quote.regularMarketChangePercent ?? 0,
            };
          }
        }
      }

      const getFredLatest = async (res: PromiseSettledResult<Response>): Promise<number | null> => {
        if (res.status !== 'fulfilled' || !res.value.ok) return null;
        const j = await res.value.json();
        const obs = j.observations?.filter((o: any) => o.value !== '.') ?? [];
        return obs.length ? parseFloat(obs[0].value) : null;
      };

      const getFredYoY = async (res: PromiseSettledResult<Response>): Promise<number | null> => {
        if (res.status !== 'fulfilled' || !res.value.ok) return null;
        const j = await res.value.json();
        const obs = (j.observations ?? []).filter((o: any) => o.value !== '.');
        if (obs.length < 13) return null;
        const latest = parseFloat(obs[0].value);
        const yearAgo = parseFloat(obs[12].value);
        return ((latest - yearAgo) / yearAgo) * 100;
      };

      const [fedFunds, cpiYoY, unrate, yieldSpread] = await Promise.all([
        getFredLatest(fredRates),
        getFredYoY(fredCpi),
        getFredLatest(fredUnrate),
        getFredLatest(fredSpread),
      ]);

      const snapshot = {
        fetchedAt: new Date().toISOString(),
        prices: priceMap,
        macro: {
          fedFundsRate: fedFunds,
          cpiYoY: cpiYoY ? Math.round(cpiYoY * 100) / 100 : null,
          unemployment: unrate,
          yieldCurve10y2y: yieldSpread,
        },
      };

      setCache('polygonContext', snapshot);
      return NextResponse.json({ success: true, data: snapshot });
    }

    // ── Shared context builders (used by advisorChat, bestAssets, bestStrategy) ─
    const buildSessionBlock = (ctx: any): string => {
      if (!ctx) return '';
      const lines = [
        ctx.portfolio        ? `- User portfolio this session: ${ctx.portfolio}` : '',
        ctx.portfolioFindings ? `- Portfolio analysis found: ${ctx.portfolioFindings}` : '',
        ctx.thesis           ? `- Thesis tested: "${ctx.thesis}"` : '',
        ctx.bestTickers      ? `- Previously suggested assets: ${ctx.bestTickers}` : '',
      ].filter(Boolean);

      // Cross-tab context from Lab + Planner tabs (injected automatically)
      const crossTabBlock = ctx.crossTabContext
        ? `\nCROSS-TAB CONTEXT (user's recent work in other parts of Alpha Horizon — use this to give personalised, coherent advice):\n${ctx.crossTabContext}\n`
        : '';

      if (!lines.length && !crossTabBlock) return '';
      const sessionLines = lines.length
        ? `\nUSER SESSION CONTEXT (maintain consistency with all prior analysis this session):\n${lines.join('\n')}\n`
        : '';
      return sessionLines + crossTabBlock;
    };

    const buildMarketStance = (ctx: any): string => ctx ? `
AUTHORITATIVE MARKET STANCE (all recommendations must align with this — no contradictions):
- Regime: ${ctx.marketSnapshot?.regime || 'Unknown'} | Sentiment: ${ctx.marketSnapshot?.sentiment || 'Unknown'}
- Overweight NOW: ${(ctx.positioning?.overweight || []).map((p: any) => p.idea).join(', ') || 'none'}
- Underweight NOW: ${(ctx.positioning?.underweight || []).map((p: any) => p.idea).join(', ') || 'none'}
` : '';

    // ── advisorChat ────────────────────────────────────────────────────────────
    if (action === 'advisorChat') {
      const { history, nearTermContext, liveContext, polygonCtx, sessionCtx } = body;

      // On-demand live price fetch: extract tickers mentioned in the user message,
      // fetch any not already in polygonCtx, inject fresh prices into the system prompt
      const STOP_WORDS = new Set(['I','A','AM','PM','AI','BE','MY','WE','US','DO','GO','IF','VS','SO','NO','UP','EM',
        'THE','AND','AND','FOR','NOT','ARE','WAS','HAS','HAD','CAN','DID','GET','GOT','LET','PUT',
        'CPI','NFP','GDP','YOY','QOQ','YTD','ETF','IPO','FED','SEC','NOW','NEW','OLD','BIG','ALL','ANY','TOP','OUT','OFF']);
      const lastUserMsg: string = (history as Array<{ role: string; text: string }>)[history.length - 1]?.text || '';
      const mentionedTickers = [...new Set((lastUserMsg.match(/\b[A-Z]{2,5}\b/g) || [])
        .filter(t => !STOP_WORDS.has(t) && !((polygonCtx?.prices || {})[t])))]
        .slice(0, 6);

      let liveTickerContext = '';
      if (mentionedTickers.length > 0) {
        const results = await Promise.allSettled(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mentionedTickers.map(t => yahooFinance.quote(t) as Promise<any>)
        );
        const fetched: string[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value?.regularMarketPrice) {
            const q = r.value;
            const chg = q.regularMarketChangePercent;
            fetched.push(`${q.symbol} $${q.regularMarketPrice.toFixed(2)} (${chg != null ? (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%' : 'n/a'} today)`);
          }
        }
        if (fetched.length) {
          liveTickerContext = `\nLIVE PRICES FETCHED NOW FOR THIS QUERY (Yahoo Finance, real-time — use these, not training data):\n${fetched.join(' | ')}\n`;
        }
      }

      const macroSummary = nearTermContext ? `
LIVE MARKET CONTEXT (${getCurrentDate()}):
- Regime: ${nearTermContext.marketSnapshot?.regime || 'Unknown'} | Sentiment: ${nearTermContext.marketSnapshot?.sentiment || 'Unknown'}
- Macro Pillars: ${(nearTermContext.macroPillars || []).map((p: any) => `${p.name}: ${p.value} (${p.direction})`).join(' | ')}
- Key Drivers: ${(nearTermContext.marketSnapshot?.bullets || []).slice(0, 3).join(' | ')}
- Overweight: ${(nearTermContext.positioning?.overweight || []).map((p: any) => p.idea).join(', ')}
- Underweight: ${(nearTermContext.positioning?.underweight || []).map((p: any) => p.idea).join(', ')}
- Upcoming Catalysts: ${(nearTermContext.catalysts || []).slice(0, 3).map((c: any) => `${c.event} (${c.date})`).join(', ')}
` : 'No pre-loaded macro context — rely on Google Search for current data.';

      const liveSummary = liveContext ? `
LIVE HEADLINES (${getCurrentDate()}):
${(liveContext.newsHeadlines || []).map((h: any) => `• [${h.source}] ${h.headline} — ${h.impact}`).join('\n')}
Summary: ${liveContext.summary}
` : '';

      const polygonSummary = polygonCtx ? (() => {
        const p = polygonCtx.prices || {};
        const m = polygonCtx.macro || {};
        const fmt = (t: string) => p[t] ? `${t} $${p[t].price.toFixed(2)} (${p[t].changePct1d >= 0 ? '+' : ''}${p[t].changePct1d.toFixed(2)}%)` : null;
        const prices = ['SPY','QQQ','IWM','TLT','GLD','HYG','XLK','XLF','XLE','VIXY'].map(fmt).filter(Boolean).join(' | ');
        const macro = [
          m.fedFundsRate != null ? `Fed Funds: ${m.fedFundsRate}%` : null,
          m.cpiYoY != null ? `CPI YoY: ${m.cpiYoY}%` : null,
          m.unemployment != null ? `Unemployment: ${m.unemployment}%` : null,
          m.yieldCurve10y2y != null ? `10Y-2Y Spread: ${m.yieldCurve10y2y.toFixed(2)}%` : null,
        ].filter(Boolean).join(' | ');
        return `\nREAL-TIME PRICES (Polygon.io as of ${polygonCtx.fetchedAt}):\n${prices}\nFRED MACRO DATA: ${macro}\n`;
      })() : '';

      const chatHistory = (history as Array<{ role: string; text: string }>)
        .slice(0, -1)
        .map(m => ({
          role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
          parts: [{ text: m.text }],
        }));

      const chat = ai.chats.create({
        model,
        config: {
          tools: [{ googleSearch: {} }],
          systemInstruction: `You are Silas — a top 0.1% wealth manager and markets expert. You have spent 25 years at the highest levels of institutional finance: Goldman Sachs macro strategy, Tiger Global, Bridgewater. You know every asset class (equities, fixed income, commodities, alternatives, crypto, private equity), every macro regime, every tax optimization strategy, and every sector rotation playbook.

You have been loaded with real-time market intelligence below. Treat it as ground truth — it supersedes your training data.

${macroSummary}
${polygonSummary}
${liveTickerContext}
${liveSummary}
${buildMarketStance(nearTermContext)}
${buildSessionBlock(sessionCtx)}

YOUR COMMUNICATION STYLE — these are hard rules, not suggestions:
- Every single response is 3-4 sentences. No exceptions. Not 5. Not a paragraph followed by bullets. 3-4 sentences, full stop.
- After your 3-4 sentence answer, ask ONE relevant follow-up question to keep the conversation going — something that would help you give better advice or that the user should be thinking about.
- Write in plain conversational prose. No bullet points. No markdown headers. No bold text. No numbered lists. Talk like a human.
- Lead with the answer immediately. Never say "Great question!", "Certainly!", "Of course!" or any preamble. Just answer.
- Name specific tickers, weights, and time horizons. Never say "consider diversifying" without naming what to buy.
- When the question is vague or missing key context, ask your clarifying question instead of guessing — but still give a 1-2 sentence directional take first.
- Push back when the user's idea has a flaw. Say "The problem with that thesis is..." not "That's interesting, but..."
- Cite real numbers when you have them from the market data above. Use Google Search if you need a price or yield you don't have.
- Acknowledge uncertainty plainly: "Honestly, nobody knows — here's what the data suggests."
- Reference what the user told you earlier in the conversation when it's relevant.
- Give real opinions. You are an advisor, not a disclaimer machine. One disclaimer per conversation at most.`,
        },
        history: chatHistory,
      });

      const lastMessage = (history as Array<{ role: string; text: string }>)[history.length - 1].text;
      const stream = await chat.sendMessageStream({ message: lastMessage });

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          for await (const chunk of stream) {
            const text = chunk.text;
            if (text) controller.enqueue(encoder.encode(text));
          }
          controller.close();
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // ── bestAssets ─────────────────────────────────────────────────────────────
    if (action === 'bestAssets') {
      const { riskProfile, timeHorizon, nearTermContext, liveContext, sessionCtx } = body;

      const contextStr = nearTermContext ? `
Current Regime: ${nearTermContext.marketSnapshot?.regime} | Sentiment: ${nearTermContext.marketSnapshot?.sentiment}
Macro Pillars: ${(nearTermContext.macroPillars || []).map((p: any) => `${p.name}=${p.value}(${p.direction})`).join(', ')}
Live Headlines: ${(liveContext?.newsHeadlines || []).slice(0, 5).map((h: any) => h.headline).join(' | ')}
` : `Today is ${getCurrentDate()}. No pre-loaded context — use Google Search for current market data.`;

      const prompt = `
You are a world-class institutional portfolio strategist. Today is ${getCurrentDate()}.

MARKET CONTEXT:
${contextStr}
${buildMarketStance(nearTermContext)}
${buildSessionBlock(sessionCtx)}
TASK: Identify the TOP 8 best INDIVIDUAL STOCKS to own RIGHT NOW for a ${riskProfile} investor with a ${timeHorizon} time horizon.

CRITICAL: Individual stocks ONLY. No ETFs, no index funds, no mutual funds. Every pick must be a single company stock (e.g. NVDA, MSFT, JPM). If you include an ETF, the response is invalid.

SELECTION CRITERIA:
- Forward-looking expected returns grounded in current macro regime and company fundamentals
- Risk-adjusted conviction (earnings visibility, balance sheet strength, sector tailwinds)
- Current macro regime alignment — explicitly connect each pick to the regime context above
- Mix of sectors — do not cluster all picks in one sector
- Diversification across market cap (large, mid)

For each of the 8 assets:
- rank (1-8, where 1 is highest conviction)
- ticker (ETF/stock ticker symbol)
- name (full name)
- category (e.g., "US Large Cap Equity", "Short-Duration Fixed Income", "Commodity")
- suggestedWeight (allocation % — must sum to 100 across all 8)
- forwardReturn (estimated annualized return range, e.g., "6–9%")
- rationale (2-3 sentences connecting to current macro conditions)
- risk ("Low", "Medium", or "High")
- expenseRatio (e.g., "0.03%", "N/A" for individual stocks)

Also provide:
- regime: one-line description of current market regime
- generatedAt: current date/time string
- macroAlignment: 2-3 sentences explaining how this portfolio aligns with today's macro environment

IMPORTANT: suggestedWeights MUST sum to exactly 100.
      `;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              regime: { type: Type.STRING },
              generatedAt: { type: Type.STRING },
              macroAlignment: { type: Type.STRING },
              assets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    rank: { type: Type.NUMBER },
                    ticker: { type: Type.STRING },
                    name: { type: Type.STRING },
                    category: { type: Type.STRING },
                    suggestedWeight: { type: Type.NUMBER },
                    forwardReturn: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    risk: { type: Type.STRING, enum: ['Low', 'Medium', 'High'] },
                    expenseRatio: { type: Type.STRING },
                  },
                  required: ['rank', 'ticker', 'name', 'category', 'suggestedWeight', 'forwardReturn', 'rationale', 'risk', 'expenseRatio'],
                },
              },
            },
            required: ['regime', 'generatedAt', 'macroAlignment', 'assets'],
          },
        },
      });

      const result = JSON.parse(response.text || '{}');
      return NextResponse.json({ success: true, data: result });
    }

    // ── bestStrategy ───────────────────────────────────────────────────────────
    if (action === 'bestStrategy') {
      const { riskProfile, timeHorizon, nearTermContext, liveContext, sessionCtx } = body;

      const contextStr = nearTermContext ? `
Current Regime: ${nearTermContext.marketSnapshot?.regime} | Sentiment: ${nearTermContext.marketSnapshot?.sentiment}
Macro Pillars: ${(nearTermContext.macroPillars || []).map((p: any) => `${p.name}=${p.value}(${p.direction})`).join(', ')}
Live Headlines: ${(liveContext?.newsHeadlines || []).slice(0, 5).map((h: any) => h.headline).join(' | ')}
` : `Today is ${getCurrentDate()}. No pre-loaded context — use Google Search for current market data.`;

      const prompt = `
You are the world's best portfolio manager. Today is ${getCurrentDate()}.

MARKET CONTEXT:
${contextStr}
${buildMarketStance(nearTermContext)}
${buildSessionBlock(sessionCtx)}
TASK: Construct the OPTIMAL investment portfolio for a ${riskProfile} investor with a ${timeHorizon || '1 year'} time horizon in TODAY'S market environment.

REQUIREMENTS:
- Modern Portfolio Theory principles: maximize Sharpe ratio for ${riskProfile} risk tolerance
- Calibrate for ${timeHorizon || '1 year'} time horizon: shorter horizons need more capital preservation and liquidity; longer horizons support higher equity allocation and illiquidity premium capture
- Weights MUST sum to exactly 100%
- 6-12 positions for proper diversification
- Account for expense ratios in expected return calculations
- Align with current macro regime (explicitly stated in context)
- Be actionable: use specific ETFs/tickers where possible
- Consider: US equity, international, fixed income, real assets, cash/alternatives as appropriate
${buildSessionBlock(sessionCtx)}

Use Google Search to verify current yields, valuations, and market conditions.

Provide:
- strategyName: creative but professional name for this portfolio
- riskProfile: confirm the risk profile
- expectedReturn: annualized expected return range (e.g., "6.5–8.5%")
- expectedVolatility: annualized volatility estimate (e.g., "10–13%")
- sharpeEstimate: estimated Sharpe ratio (e.g., "0.65–0.80")
- macroAlignment: 3-4 sentences explaining WHY this portfolio is optimal for today's conditions
- rebalancingGuidance: when and how to rebalance (specific trigger conditions)
- allocations: each with ticker, name, weight (%), category, rationale (2-3 sentences), expenseRatio
- riskWarnings: 3-5 specific risks to this strategy given current conditions

CRITICAL: allocation weights MUST sum to exactly 100.
      `;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              strategyName: { type: Type.STRING },
              riskProfile: { type: Type.STRING },
              expectedReturn: { type: Type.STRING },
              expectedVolatility: { type: Type.STRING },
              sharpeEstimate: { type: Type.STRING },
              macroAlignment: { type: Type.STRING },
              rebalancingGuidance: { type: Type.STRING },
              allocations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    ticker: { type: Type.STRING },
                    name: { type: Type.STRING },
                    weight: { type: Type.NUMBER },
                    category: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    expenseRatio: { type: Type.STRING },
                  },
                  required: ['ticker', 'name', 'weight', 'category', 'rationale', 'expenseRatio'],
                },
              },
              riskWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['strategyName', 'riskProfile', 'expectedReturn', 'expectedVolatility', 'sharpeEstimate', 'macroAlignment', 'rebalancingGuidance', 'allocations', 'riskWarnings'],
          },
        },
      });

      const result = JSON.parse(response.text || '{}');
      return NextResponse.json({ success: true, data: result });
    }

    // ── generateArenaAllocation ───────────────────────────────────────────────
    if (action === 'generateArenaAllocation') {
      const { riskScore, balance, horizon } = body;

      const riskTier = riskScore <= 2 ? 'ultra-conservative'
        : riskScore <= 4 ? 'conservative'
        : riskScore <= 6 ? 'moderate'
        : riskScore <= 8 ? 'aggressive'
        : 'ultra-aggressive';

      const horizonLabel = horizon === 'short' ? '1–3 years' : horizon === 'long' ? '10+ years' : '3–10 years';
      const balanceFormatted = `$${Number(balance).toLocaleString()}`;

      const prompt = `You are a senior institutional portfolio strategist at a top-tier asset management firm (think Vanguard, Dimensional, or AQR). Today is ${getCurrentDate()}.

YOUR MANDATE: Construct the single best long-term, buy-and-hold ETF portfolio for this investor profile.

━━━ INVESTOR PROFILE ━━━
- Risk Score: ${riskScore}/10 (${riskTier})
- Investment Amount: ${balanceFormatted}
- Time Horizon: ${horizonLabel}

━━━ STEP 1: GATHER CURRENT MARKET INTELLIGENCE ━━━
Use Google Search RIGHT NOW to find:
1. Current 10-Year Treasury yield (exact number)
2. Current Fed Funds rate and most recent FOMC statement direction
3. Current SGOV and VUSXX 7-day SEC yields (for cash/safety bucket)
4. Current VTI, VXUS, BND, QQQM, AVUV valuations and YTD performance
5. Current inflation (Core PCE) and whether real rates are positive or negative
6. Current market breadth and any major macro risks (recession odds, credit spreads)

━━━ STEP 2: OPTIMIZATION FRAMEWORK ━━━
You must optimize for the HIGHEST RISK-ADJUSTED RETURN (Sharpe ratio) for this risk level — NOT the highest raw return.

Apply these portfolio construction principles:
- DIVERSIFICATION: Spread across asset classes (US equity, intl equity, fixed income, real assets, cash), geographies, and factor exposures. Never concentrate >65% in any single asset class.
- FACTOR EXPOSURE: For equity, tilt toward factors with long-term evidence: value (AVUV, AVDV), momentum (MTUM), quality, small-cap where appropriate for the risk level.
- FIXED INCOME LADDER: Match bond duration to time horizon. Short horizon → short-duration (SGOV, USFR, BIL). Long horizon → intermediate (BND, SCHP).
- TAX-ALPHA ASSETS: For safety/cash allocations, ALWAYS prefer SGOV or VUSXX over HYSA equivalents — their Treasury income is exempt from state income tax, generating meaningful tax alpha on an after-tax basis. Include these when risk score is 1-6 or balance warrants a safety buffer.
- REAL ASSETS: Include a modest GLD or VNQI/VNQ allocation for inflation hedging when horizon > 3 years and risk ≥ 4.
- INTERNATIONAL: ALWAYS include VXUS or AVDV for geographic diversification unless risk score is 1-3 (capital preservation only). US-only portfolios carry unnecessary concentration risk.
- REBALANCING DISCIPLINE: Weights should represent a strategic long-term target, not a tactical trade. This portfolio should look virtually identical if generated yesterday or tomorrow — it represents the OPTIMAL long-term strategic allocation, not a reaction to this week's news.

━━━ APPROVED ASSET UNIVERSE ━━━
Safety/Cash (state-tax-exempt): SGOV, VUSXX, USFR, BIL, IBTG
Short bonds: SHY, SCHO
Intermediate bonds: BND, AGG, SCHZ
Inflation-protected: SCHP, TIPS
Muni (tax-exempt): MUB, CMF, VTEB
US Total Market: VTI, FSKAX
US Large Growth: QQQM, SCHG, VUG
US Small Value (factor): AVUV, VBR
Dividend/Quality: SCHD, VIG, VYM, JEPI
International Developed: VXUS, VEA, AVDV
Emerging Markets: VWO, AVEM
Real Estate: VNQ, VNQI
Gold/Commodities: GLD, IAU, PDBC
Balanced: AOR, AOM, AOA

━━━ ALLOCATION RULES BY RISK TIER ━━━
Risk 1-2 (Ultra-Conservative): 60-80% safety/short bonds (SGOV, VUSXX, BIL), 10-20% intermediate bonds, 0-20% equity. Max Sharpe via capital preservation.
Risk 3-4 (Conservative): 30-50% bonds/safety (include SGOV for tax-alpha), 10-20% intl, 30-40% US equity, consider SCHP for inflation hedge.
Risk 5-6 (Moderate): 15-30% bonds (BND + SGOV for yield/safety), 50-60% equity (VTI + VXUS), 5-10% factor tilt (AVUV), 5% real assets.
Risk 7-8 (Aggressive): 70-80% equity (VTI, VXUS, AVUV), 5-10% small-cap/factor, 5-10% GLD, minimal bonds unless horizon < 5 years.
Risk 9-10 (Ultra-Aggressive): 85-100% equity across US/intl/factor, maximum growth tilt (QQQM, AVUV, VWO), no bonds.

━━━ HOLDINGS REQUIREMENTS ━━━
- Minimum 4 holdings, maximum 8 holdings
- Weights must sum to EXACTLY 1.0
- Each holding must serve a distinct diversification purpose — no redundancy
- For balances under $10,000: simplify to 4-5 core holdings
- For balances over $100,000: use full 6-8 holdings with factor tilts

━━━ OUTPUT ━━━
Return a strategic allocation with a 2-sentence rationale per holding explaining its specific role in maximizing risk-adjusted returns for this investor.`;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: 0,  // Deterministic — same inputs → same allocation today/tomorrow/yesterday
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              allocation: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    ticker: { type: Type.STRING },
                    weight: { type: Type.NUMBER },
                    rationale: { type: Type.STRING },
                  },
                  required: ['ticker', 'weight', 'rationale'],
                },
              },
            },
            required: ['allocation'],
          },
          tools: [{ googleSearch: {} }],
        },
      });

      // Safe JSON extraction — strips any leaked thinking text before/after the JSON object
      const rawText = response.text || '{}';
      const jsonStart = rawText.indexOf('{');
      const jsonEnd = rawText.lastIndexOf('}');
      const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? rawText.slice(jsonStart, jsonEnd + 1) : '{}';
      const result = JSON.parse(jsonStr);
      if (!result.allocation?.length) {
        return NextResponse.json({ error: 'AI did not return a valid allocation. Please try again.' }, { status: 500 });
      }
      return NextResponse.json({ success: true, allocation: result.allocation });
    }

    // ── tripleCard ────────────────────────────────────────────────────────────
    if (action === 'tripleCard') {
      const sql = db();
      const todayET = getTodayET();
      const yesterdayET = getYesterdayET();

      // Ensure today's record exists, then load both in parallel
      await sql`INSERT INTO market_daily_records (record_date) VALUES (${todayET}) ON CONFLICT (record_date) DO NOTHING`;
      const [todayResult, yesterdayResult] = await Promise.all([
        sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`,
        sql`SELECT * FROM market_daily_records WHERE record_date = ${yesterdayET}`,
      ]);
      let todayRow = todayResult[0];
      const yesterdayRow = yesterdayResult[0] ?? null;

      // Invalidate old-schema data: if elite6_actual exists but lacks the 'spyTrend' field
      // introduced in the DailyIndicators v2 migration, clear it so we regenerate with the new schema.
      if (todayRow.elite6_actual && !(todayRow.elite6_actual as Record<string, unknown>).spyTrend) {
        await sql`UPDATE market_daily_records SET elite6_actual = NULL, updated_at = NULL WHERE record_date = ${todayET}`;
        todayRow = { ...todayRow, elite6_actual: null, updated_at: null };
      }
      // Invalidate old-schema tomorrow_predictions (pre-DailyIndicators v2 migration)
      if (todayRow.tomorrow_predictions && !(todayRow.tomorrow_predictions as Record<string, unknown>).spyTrend) {
        await sql`UPDATE market_daily_records SET tomorrow_predictions = NULL, is_noon_locked = false, noon_locked_at = NULL WHERE record_date = ${todayET}`;
        todayRow = { ...todayRow, tomorrow_predictions: null, is_noon_locked: false, noon_locked_at: null };
      }

      const updatedAt = todayRow.updated_at ? new Date(todayRow.updated_at).getTime() : 0;
      const twentyMinAgo = Date.now() - 20 * 60 * 1000;
      const isLiveDataStale = !todayRow.elite6_actual || updatedAt < twentyMinAgo;
      // Noon lock needs to fire even if live data is fresh — don't let it slip between refresh windows
      const noonLockPending = isAfterNoonET() && !todayRow.is_noon_locked;

      // If we have any data, return it immediately — client will call refreshLive for stale/pending work
      if (todayRow.elite6_actual) {
        // Single query for both rolling accuracy and streaks
        const hist30 = await sql`
          SELECT accuracy_breakdown, user_accuracy_correct
          FROM market_daily_records
          WHERE record_date < ${todayET}
          ORDER BY record_date DESC LIMIT 30
        `;
        const rolling: Record<string, number[]> = { fearGreed: [], spyTrend: [], sectorRotation: [], optionsPulse: [] };
        let modelStreakEarly = 0;
        let userStreakEarly = 0;
        let modelStreakBroken = false;
        let userStreakBrokenEarly = false;
        for (const r of hist30) {
          const ab = r.accuracy_breakdown as Record<string, number> | null;
          if (ab) {
            for (const key of Object.keys(rolling)) {
              if (ab[key] != null) rolling[key].push(Number(ab[key]));
            }
            if (!modelStreakBroken) {
              if (ab.spyTrend != null && ab.spyTrend >= 60) modelStreakEarly++;
              else modelStreakBroken = true;
            }
          } else if (!modelStreakBroken) {
            modelStreakBroken = true;
          }
          if (!userStreakBrokenEarly) {
            if (r.user_accuracy_correct === true) userStreakEarly++;
            else if (r.user_accuracy_correct === false) userStreakBrokenEarly = true;
          }
        }
        const rollingAccuracy = {
          fearGreed: rolling.fearGreed.length ? Math.round(rolling.fearGreed.reduce((a,b)=>a+b,0)/rolling.fearGreed.length) : null,
          spyTrend: rolling.spyTrend.length ? Math.round(rolling.spyTrend.reduce((a,b)=>a+b,0)/rolling.spyTrend.length) : null,
          sectorRotation: rolling.sectorRotation.length ? Math.round(rolling.sectorRotation.reduce((a,b)=>a+b,0)/rolling.sectorRotation.length) : null,
          optionsPulse: rolling.optionsPulse.length ? Math.round(rolling.optionsPulse.reduce((a,b)=>a+b,0)/rolling.optionsPulse.length) : null,
          daysScored: hist30.filter(r => r.accuracy_breakdown).length,
        };
        return NextResponse.json({
          success: true,
          data: {
            yesterday: yesterdayRow ? rowToRecord(yesterdayRow) : null,
            today: rowToRecord(todayRow),
            isLiveDataStale,
            needsRefresh: isLiveDataStale || noonLockPending,
            lastRefreshed: todayRow.updated_at ? String(todayRow.updated_at) : new Date().toISOString(),
            rollingAccuracy,
            modelStreak: modelStreakEarly,
            userStreak: userStreakEarly,
          },
        });
      }

      // ── First-ever load: generate data synchronously ──────────────────────────
      // (accuracy calc omitted here — only runs via refreshLive once we have data)

      // Auto accuracy calculation: if yesterday exists with predictions but no accuracy score
      if (yesterdayRow && yesterdayRow.tomorrow_predictions && yesterdayRow.accuracy_score == null && todayRow.elite6_actual) {
        try {
          const { score, breakdown } = scoreAccuracy(
            yesterdayRow.tomorrow_predictions as Record<string, unknown>,
            todayRow.elite6_actual as Record<string, unknown>
          );
          await sql`
            UPDATE market_daily_records
            SET accuracy_score = ${score},
                accuracy_breakdown = ${JSON.stringify(breakdown)},
                accuracy_calculated_at = now()
            WHERE record_date = ${yesterdayET}
          `;
          const refreshedYesterday = await sql`SELECT * FROM market_daily_records WHERE record_date = ${yesterdayET}`;
          if (refreshedYesterday[0]) {
            // yesterdayRow is now updated in DB; we'll re-fetch below
          }
          // Score user prediction too
          if (yesterdayRow.user_spy_prediction && todayRow.elite6_actual) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actualDirection = (todayRow.elite6_actual as any)?.spyTrend?.direction;
            if (actualDirection) {
              const userCorrect = yesterdayRow.user_spy_prediction === actualDirection;
              await sql`UPDATE market_daily_records SET user_accuracy_correct = ${userCorrect} WHERE record_date = ${yesterdayET}`;
            }
          }
        } catch (accErr) {
          console.error('[tripleCard] Accuracy calc error:', accErr);
        }
      }

      // Auto noon lock: generate tomorrow predictions if past noon and not yet locked
      if (isAfterNoonET() && !todayRow.is_noon_locked) {
        try {
          // Build self-improvement calibration context from recent performance
          const recentScores = await sql`
            SELECT accuracy_breakdown FROM market_daily_records
            WHERE accuracy_breakdown IS NOT NULL
            ORDER BY record_date DESC LIMIT 7
          `;
          const avgBreakdown: Record<string, number[]> = { fearGreed: [], spyTrend: [], sectorRotation: [], optionsPulse: [] };
          for (const r of recentScores) {
            const ab = r.accuracy_breakdown as Record<string, number> | null;
            if (!ab) continue;
            for (const key of Object.keys(avgBreakdown)) {
              if (ab[key] != null) avgBreakdown[key].push(Number(ab[key]));
            }
          }
          const calibration = recentScores.length >= 3
            ? `\nCALIBRATION (your recent 7-day accuracy — self-correct for known biases):\n- Fear & Greed: ${avgBreakdown.fearGreed.length ? Math.round(avgBreakdown.fearGreed.reduce((a,b)=>a+b)/avgBreakdown.fearGreed.length) : 'N/A'}% accurate\n- SPY Trend: ${avgBreakdown.spyTrend.length ? Math.round(avgBreakdown.spyTrend.reduce((a,b)=>a+b)/avgBreakdown.spyTrend.length) : 'N/A'}% accurate\n- Sector: ${avgBreakdown.sectorRotation.length ? Math.round(avgBreakdown.sectorRotation.reduce((a,b)=>a+b)/avgBreakdown.sectorRotation.length) : 'N/A'}% accurate\n- Options Pulse: ${avgBreakdown.optionsPulse.length ? Math.round(avgBreakdown.optionsPulse.reduce((a,b)=>a+b)/avgBreakdown.optionsPulse.length) : 'N/A'}% accurate\nAdjust your predictions to compensate for any indicator where accuracy is below 60%.\n`
            : '';

          // Real data for prediction signals — fetch fresh
          const predSpyData = await fetchSPYData();
          const predFgData = await fetchFearAndGreed();
          const predPcRatio = await fetchSPYPutCallRatio() ?? 0.74;
          const predSectors = await fetchSectorData();
          const predSignals = computePredictionSignals(
            predSpyData,
            predFgData?.score ?? 50,
            predFgData?.delta ?? 0,
            predPcRatio,
          );

          const predPrompt = `You are a market prediction engine. Today is ${getCurrentDate()}.

REAL TODAY DATA (already fetched — do NOT re-search these numbers):
- SPY: ${predSpyData.changePercent != null ? `${predSpyData.changePercent > 0 ? '+' : ''}${predSpyData.changePercent}%` : 'flat'}, direction: ${predSpyData.direction}, above 200MA: ${predSpyData.above200MA}, above 50MA: ${predSpyData.above50MA}, volume: ${predSpyData.volumeRatio != null ? `${predSpyData.volumeRatio}x avg` : 'normal'}
- Fear & Greed: ${predFgData?.score ?? 50}/100 (${predFgData?.label ?? 'Neutral'}), delta ${predFgData?.delta ?? 0} from yesterday
- Sector leader today: ${predSectors?.leader ? `${predSectors.leader.ticker} ${predSectors.leader.changePercent > 0 ? '+' : ''}${predSectors.leader.changePercent}%` : 'N/A'}
- Sector lagger today: ${predSectors?.lagger ? `${predSectors.lagger.ticker} ${predSectors.lagger.changePercent > 0 ? '+' : ''}${predSectors.lagger.changePercent}%` : 'N/A'}
- SPY put/call ratio: ${predPcRatio}

QUANTITATIVE SIGNALS (anchor your predictions to these):
${predSignals.signals.map(s => `- ${s}`).join('\n')}
SIGNAL BALANCE: ${predSignals.bullCount} bullish vs ${predSignals.bearCount} bearish → ${predSignals.confidence} Conviction ${predSignals.bias}

${calibration}
Using these signals as your foundation, search for any additional context (upcoming catalysts, news) and predict tomorrow's 4 key indicators. Return ONLY valid JSON:
{
  "tomorrowPredictions": {
    "fearGreed": {
      "score": 65,
      "label": "Greed",
      "delta": -3,
      "description": "Why this F&G prediction — cite signals above"
    },
    "spyTrend": {
      "direction": "Up",
      "changePercent": 0.5,
      "above200MA": ${predSpyData.above200MA ?? true},
      "above50MA": ${predSpyData.above50MA ?? true},
      "volumeRatio": null,
      "description": "Why this SPY prediction — cite signals above"
    },
    "sectorRotation": {
      "leader": { "sector": "Technology", "ticker": "XLK", "performance": "predicted +1.0%" },
      "lagger": { "sector": "Energy", "ticker": "XLE", "performance": "predicted -0.5%" },
      "implication": "Why this sector rotation — cite momentum or macro"
    },
    "optionsPulse": {
      "putCallRatio": 0.80,
      "lean": "Neutral",
      "description": "Why this options prediction"
    }
  },
  "tomorrowOutlook": "2-3 sentence narrative anchored in the signals above"
}
Rules:
- fearGreed.label: "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
- spyTrend.direction: "Up" | "Down" | "Flat" (bias toward ${predSignals.bias === 'Bullish' ? 'Up' : predSignals.bias === 'Bearish' ? 'Down' : 'Flat'} based on signals)
- spyTrend.above200MA and above50MA: use current values unless you have strong reason to predict change
- sectorRotation: use sector ETF tickers (XLK, XLF, XLE, XLV, XLI, XLY, XLP, XLU, XLB, XLRE, XLC)
- optionsPulse.lean: "Bullish" | "Neutral" | "Bearish"
- ANCHOR predictions to the quantitative signals — only override with strong search-based evidence`;

          const predResp = await ai.models.generateContent({
            model,
            contents: predPrompt,
            config: {
              tools: [{ googleSearch: {} }],
              temperature: 0.3,
            },
          });

          const predRaw = predResp.text || '{}';
          const predJson = predRaw.slice(predRaw.indexOf('{'), predRaw.lastIndexOf('}') + 1);
          const predResult = JSON.parse(predJson);

          if (predResult.tomorrowPredictions) {
            predResult.tomorrowPredictions.confidence = predSignals.confidence;
            predResult.tomorrowPredictions.signals = predSignals.signals;
            await sql`
              UPDATE market_daily_records
              SET is_noon_locked = true,
                  noon_locked_at = now(),
                  tomorrow_predictions = ${JSON.stringify(predResult.tomorrowPredictions)},
                  tomorrow_outlook = ${predResult.tomorrowOutlook ?? ''},
                  updated_at = now()
              WHERE record_date = ${todayET}
            `;
            // Refresh today row
            const freshToday = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
            if (freshToday[0]) todayRow = freshToday[0];
          }
        } catch (predErr) {
          console.error('[tripleCard] Noon lock error:', predErr);
        }
      }

      // Live data refresh: only reaches here when elite6_actual is null (first-ever load)
      const needsLiveRefresh = true;

      if (needsLiveRefresh) {
        try {
          // ── Fetch all real market data in parallel ──────────────────────────────
          const [realPutCall, spyDataLive, fearGreedData, sectorData, movers] = await Promise.all([
            fetchSPYPutCallRatio(),
            fetchSPYData(),
            fetchFearAndGreed(),
            fetchSectorData(),
            fetchMarketMovers(),
          ]);

          // ── Build elite6 from real data (no AI for these numbers) ──────────────
          const fgScore = fearGreedData?.score ?? 50;
          const fgLabel = fearGreedData?.label ?? 'Neutral';
          const fgDelta = fearGreedData?.delta ?? 0;
          const pcRatio = realPutCall ?? 0.74;
          const pcLean = pcRatio < 0.65 ? 'Bullish' : pcRatio >= 0.9 ? 'Bearish' : 'Neutral';
          const leaderSector = sectorData?.leader;
          const laggerSector = sectorData?.lagger;
          const topMover = movers.gainers[0] ?? movers.losers[0] ?? null;

          // ── Build real edge board (reasons filled after AI call below) ─────────
          const buildEdgeBoard = (reasons: Record<string, string>) => ({
            top5: movers.gainers.map((m, i) => ({
              rank: i + 1,
              ticker: m.ticker,
              name: m.name,
              change: m.change,
              edge: reasons[m.ticker] ?? `+${m.changePercent}% — top gainer today`,
              sector: 'Equities',
            })),
            bottom5: movers.losers.map((m, i) => ({
              rank: i + 1,
              ticker: m.ticker,
              name: m.name,
              change: m.change,
              edge: reasons[m.ticker] ?? `${m.changePercent}% — bottom mover today`,
              sector: 'Equities',
            })),
            generatedAt: new Date().toISOString(),
          });

          // ── AI prompt: only generates narrative sections ──────────────────────
          const narrativePrompt = `You are a market intelligence analyst. Today is ${getCurrentDate()}.

REAL MARKET DATA (fetched from Yahoo Finance & CNN — DO NOT change these numbers):
- SPY: ${spyDataLive.changePercent != null ? `${spyDataLive.changePercent > 0 ? '+' : ''}${spyDataLive.changePercent}%` : 'flat'} today, ${spyDataLive.direction}, above 200MA: ${spyDataLive.above200MA}, above 50MA: ${spyDataLive.above50MA}, volume: ${spyDataLive.volumeRatio != null ? `${spyDataLive.volumeRatio}x average` : 'normal'}
- Fear & Greed Index: ${fgScore}/100 (${fgLabel}), changed ${fgDelta > 0 ? '+' : ''}${fgDelta} from yesterday
- Top sector: ${leaderSector ? `${leaderSector.ticker} (${leaderSector.sector}) ${leaderSector.changePercent > 0 ? '+' : ''}${leaderSector.changePercent}%` : 'N/A'}
- Bottom sector: ${laggerSector ? `${laggerSector.ticker} (${laggerSector.sector}) ${laggerSector.changePercent > 0 ? '+' : ''}${laggerSector.changePercent}%` : 'N/A'}
- SPY put/call ratio: ${pcRatio} (${pcLean} lean)
- Today's top gainers: ${movers.gainers.map(m => `${m.ticker} ${m.change}`).join(', ') || 'N/A'}
- Today's top losers: ${movers.losers.map(m => `${m.ticker} ${m.change}`).join(', ') || 'N/A'}

Using this real data as your foundation, search for today's market news and generate the following. Return ONLY valid JSON:
{
  "briefBullets": [
    {
      "what": "Short headline naming the specific event (5-8 words, include actual ticker/number if relevant)",
      "why": "The precise data/catalyst that caused it with real numbers",
      "impact": "2-3 sentences: which sectors/ETFs win or lose, what this changes for Fed/earnings outlooks, what a practical investor should watch"
    },
    // ... repeat same structure for bullets 2-5
  ],
  "outlier": "One genuinely surprising or counter-intuitive data point from today — must cite a real ticker or real number from the data above",
  "catalyst": "The single most important event to watch in next 24 hours — be specific with timing and why it matters",
  "liveHeadlines": [
    { "headline": "exact headline from today", "source": "Bloomberg/Reuters/WSJ/etc", "impactScore": 7, "category": "Macro", "timestamp": "${new Date().toISOString()}" }
  ],
  "bigStory": {
    "ticker": "${topMover?.ticker ?? 'SPY'}",
    "name": "${topMover?.name ?? 'SPDR S&P 500 ETF'}",
    "changePercent": "${topMover?.change ?? (spyDataLive.changePercent != null ? `${spyDataLive.changePercent > 0 ? '+' : ''}${spyDataLive.changePercent}%` : '0%')}",
    "direction": "${topMover ? (topMover.changePercent >= 0 ? 'Up' : 'Down') : spyDataLive.direction === 'Down' ? 'Down' : 'Up'}",
    "reason": "Search for the specific reason this stock moved today — cite earnings, news, or macro catalyst with real numbers"
  },
  "nextCatalyst": {
    "time": "8:30 AM ET",
    "event": "The single most market-moving scheduled event in the next 24 hours with consensus estimate",
    "implication": "1-2 sentences: what a hot vs in-line vs cool result means for markets"
  },
  "positioning": {
    "overweight": [
      { "asset": "Sector or asset name", "ticker": "ETF ticker", "rationale": "10-word reason grounded in today's real data" }
    ],
    "neutral": [
      { "asset": "...", "ticker": "...", "rationale": "..." }
    ],
    "underweight": [
      { "asset": "...", "ticker": "...", "rationale": "..." }
    ]
  },
  "edgeBoardReasons": {
    "TICKER1": "10-word specific catalyst — earnings, news, or macro event",
    "TICKER2": "..."
  }
}

Rules:
- briefBullets: exactly 5 bullets — use the real numbers from the data above, search for additional context
- outlier: must reference a real ticker or real number, not generic commentary
- liveHeadlines: 5-8 headlines, only impactScore >= 6, use real headlines from today
- bigStory: the ticker is already set above — write only the reason field by searching for news
- nextCatalyst: check economic calendar for the next 24 hours
- positioning: 1-3 items per category, grounded in the real sector data above
- edgeBoardReasons: for EVERY ticker in today's top gainers and top losers, search and write a specific ~10-word catalyst (earnings beat, guidance raise, FDA approval, macro sensitivity, etc.) — not just "top gainer today"
- DO NOT invent prices, percentages, or market levels — use only the real data provided above`;

          const narrativeResp = await ai.models.generateContent({
            model,
            contents: narrativePrompt,
            config: {
              tools: [{ googleSearch: {} }],
              temperature: 0.2,
            },
          });

          const narrativeRaw = narrativeResp.text || '{}';
          const narrativeJson = narrativeRaw.slice(narrativeRaw.indexOf('{'), narrativeRaw.lastIndexOf('}') + 1);
          const narrative = JSON.parse(narrativeJson);

          // ── Assemble full elite6 from real data + AI narrative ─────────────────
          const elite6 = {
            fearGreed: {
              score: fgScore,
              label: fgLabel,
              delta: fgDelta,
              description: `CNN Fear & Greed: ${fgScore}/100 — ${fgLabel}`,
            },
            spyTrend: {
              direction: spyDataLive.direction,
              changePercent: spyDataLive.changePercent ?? 0,
              above200MA: spyDataLive.above200MA ?? true,
              above50MA: spyDataLive.above50MA ?? true,
              volumeRatio: spyDataLive.volumeRatio,
              description: `SPY ${spyDataLive.changePercent != null ? `${spyDataLive.changePercent > 0 ? '+' : ''}${spyDataLive.changePercent}%` : 'flat'} today`,
            },
            sectorRotation: leaderSector && laggerSector ? {
              leader: {
                sector: leaderSector.sector,
                ticker: leaderSector.ticker,
                performance: `${leaderSector.changePercent > 0 ? '+' : ''}${leaderSector.changePercent}%`,
              },
              lagger: {
                sector: laggerSector.sector,
                ticker: laggerSector.ticker,
                performance: `${laggerSector.changePercent > 0 ? '+' : ''}${laggerSector.changePercent}%`,
              },
              implication: `${leaderSector.sector} leads, ${laggerSector.sector} lags`,
            } : null,
            optionsPulse: {
              putCallRatio: pcRatio,
              lean: pcLean as 'Bullish' | 'Neutral' | 'Bearish',
              description: `SPY put/call ${pcRatio} — ${pcLean} lean`,
            },
            bigStory: narrative.bigStory ?? (topMover ? {
              ticker: topMover.ticker,
              name: topMover.name,
              changePercent: topMover.change,
              direction: topMover.changePercent >= 0 ? 'Up' : 'Down',
              reason: 'Top market mover today',
            } : null),
            nextCatalyst: narrative.nextCatalyst ?? null,
          };

          const weather = buildWeather(spyDataLive.changePercent, fgScore, leaderSector, laggerSector);

          if (elite6.spyTrend) {
            await sql`
              UPDATE market_daily_records
              SET elite6_actual = ${JSON.stringify(elite6)},
                  brief_bullets = ${JSON.stringify(narrative.briefBullets ?? [])},
                  outlier = ${narrative.outlier ?? ''},
                  catalyst = ${narrative.catalyst ?? ''},
                  weather = ${JSON.stringify(weather)},
                  live_headlines = ${JSON.stringify(narrative.liveHeadlines ?? [])},
                  edge_board = ${JSON.stringify(buildEdgeBoard((narrative.edgeBoardReasons as Record<string, string>) ?? {}))}::jsonb,
                  positioning = ${narrative.positioning ? JSON.stringify(narrative.positioning) : null}::jsonb,
                  updated_at = now()
              WHERE record_date = ${todayET}
            `;
            const freshToday2 = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
            if (freshToday2[0]) todayRow = freshToday2[0];
          }
        } catch (liveErr) {
          console.error('[tripleCard] Live data error:', liveErr);
        }
      }

      // Re-read today's row after AI writes
      const refreshedResult = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
      const finalRow = refreshedResult[0] ?? todayRow;
      const finalUpdatedAt = finalRow.updated_at ? new Date(finalRow.updated_at).getTime() : 0;
      const finalIsStale = !finalRow.elite6_actual || finalUpdatedAt < twentyMinAgo;

      // Single query for both rolling accuracy and streaks
      const hist30Final = await sql`
        SELECT accuracy_breakdown, user_accuracy_correct
        FROM market_daily_records
        WHERE record_date < ${todayET}
        ORDER BY record_date DESC LIMIT 30
      `;
      const rollingFinal: Record<string, number[]> = { fearGreed: [], spyTrend: [], sectorRotation: [], optionsPulse: [] };
      let modelStreakFinal = 0;
      let userStreakFinal = 0;
      let modelStreakBrokenFinal = false;
      let userStreakBrokenFinal = false;
      for (const r of hist30Final) {
        const ab = r.accuracy_breakdown as Record<string, number> | null;
        if (ab) {
          for (const key of Object.keys(rollingFinal)) {
            if (ab[key] != null) rollingFinal[key].push(Number(ab[key]));
          }
          if (!modelStreakBrokenFinal) {
            if (ab.spyTrend != null && ab.spyTrend >= 60) modelStreakFinal++;
            else modelStreakBrokenFinal = true;
          }
        } else if (!modelStreakBrokenFinal) {
          modelStreakBrokenFinal = true;
        }
        if (!userStreakBrokenFinal) {
          if (r.user_accuracy_correct === true) userStreakFinal++;
          else if (r.user_accuracy_correct === false) userStreakBrokenFinal = true;
        }
      }
      const rollingAccuracyFinal = {
        fearGreed: rollingFinal.fearGreed.length ? Math.round(rollingFinal.fearGreed.reduce((a,b)=>a+b,0)/rollingFinal.fearGreed.length) : null,
        spyTrend: rollingFinal.spyTrend.length ? Math.round(rollingFinal.spyTrend.reduce((a,b)=>a+b,0)/rollingFinal.spyTrend.length) : null,
        sectorRotation: rollingFinal.sectorRotation.length ? Math.round(rollingFinal.sectorRotation.reduce((a,b)=>a+b,0)/rollingFinal.sectorRotation.length) : null,
        optionsPulse: rollingFinal.optionsPulse.length ? Math.round(rollingFinal.optionsPulse.reduce((a,b)=>a+b,0)/rollingFinal.optionsPulse.length) : null,
        daysScored: hist30Final.filter(r => r.accuracy_breakdown).length,
      };

      return NextResponse.json({
        success: true,
        data: {
          yesterday: yesterdayRow ? rowToRecord(yesterdayRow) : null,
          today: rowToRecord(finalRow),
          isLiveDataStale: finalIsStale,
          needsRefresh: false,
          lastRefreshed: finalRow.updated_at ? String(finalRow.updated_at) : new Date().toISOString(),
          rollingAccuracy: rollingAccuracyFinal,
          modelStreak: modelStreakFinal,
          userStreak: userStreakFinal,
        },
      });
    }

    // ── refreshLive ────────────────────────────────────────────────────────────
    if (action === 'refreshLive') {
      const sql = db();
      const todayET = getTodayET();
      const yesterdayET = getYesterdayET();

      const [todayResult, yesterdayResult] = await Promise.all([
        sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`,
        sql`SELECT * FROM market_daily_records WHERE record_date = ${yesterdayET}`,
      ]);
      let todayRow = todayResult[0];
      const yesterdayRow = yesterdayResult[0] ?? null;

      if (!todayRow) {
        return NextResponse.json({ success: false, error: 'No record for today' }, { status: 404 });
      }

      const twentyMinAgo = Date.now() - 20 * 60 * 1000;

      // Invalidate old-schema data (pre-DailyIndicators v2 migration)
      if (todayRow.elite6_actual && !(todayRow.elite6_actual as Record<string, unknown>).spyTrend) {
        await sql`UPDATE market_daily_records SET elite6_actual = NULL, updated_at = NULL WHERE record_date = ${todayET}`;
        todayRow = { ...todayRow, elite6_actual: null, updated_at: null };
      }
      if (todayRow.tomorrow_predictions && !(todayRow.tomorrow_predictions as Record<string, unknown>).spyTrend) {
        await sql`UPDATE market_daily_records SET tomorrow_predictions = NULL, is_noon_locked = false, noon_locked_at = NULL WHERE record_date = ${todayET}`;
        todayRow = { ...todayRow, tomorrow_predictions: null, is_noon_locked: false, noon_locked_at: null };
      }

      // Accuracy calculation
      if (yesterdayRow && yesterdayRow.tomorrow_predictions && yesterdayRow.accuracy_score == null && todayRow.elite6_actual) {
        try {
          const { score, breakdown } = scoreAccuracy(
            yesterdayRow.tomorrow_predictions as Record<string, unknown>,
            todayRow.elite6_actual as Record<string, unknown>
          );
          await sql`
            UPDATE market_daily_records
            SET accuracy_score = ${score},
                accuracy_breakdown = ${JSON.stringify(breakdown)},
                accuracy_calculated_at = now()
            WHERE record_date = ${yesterdayET}
          `;
          const refreshedYesterday = await sql`SELECT * FROM market_daily_records WHERE record_date = ${yesterdayET}`;
          if (refreshedYesterday[0]) {
            // yesterdayRow is now updated in DB; we'll re-fetch below
          }
          // Score user prediction too
          if (yesterdayRow.user_spy_prediction && todayRow.elite6_actual) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const actualDirectionRL = (todayRow.elite6_actual as any)?.spyTrend?.direction;
            if (actualDirectionRL) {
              const userCorrectRL = yesterdayRow.user_spy_prediction === actualDirectionRL;
              await sql`UPDATE market_daily_records SET user_accuracy_correct = ${userCorrectRL} WHERE record_date = ${yesterdayET}`;
            }
          }
        } catch (accErr) {
          console.error('[refreshLive] Accuracy calc error:', accErr);
        }
      }

      // Noon lock
      if (isAfterNoonET() && !todayRow.is_noon_locked) {
        try {
          // Build self-improvement calibration context from recent performance
          const recentScoresRL = await sql`
            SELECT accuracy_breakdown FROM market_daily_records
            WHERE accuracy_breakdown IS NOT NULL
            ORDER BY record_date DESC LIMIT 7
          `;
          const avgBreakdownRL: Record<string, number[]> = { fearGreed: [], spyTrend: [], sectorRotation: [], optionsPulse: [] };
          for (const r of recentScoresRL) {
            const ab = r.accuracy_breakdown as Record<string, number> | null;
            if (!ab) continue;
            for (const key of Object.keys(avgBreakdownRL)) {
              if (ab[key] != null) avgBreakdownRL[key].push(Number(ab[key]));
            }
          }
          const calibrationRL = recentScoresRL.length >= 3
            ? `\nCALIBRATION (your recent 7-day accuracy — self-correct for known biases):\n- Fear & Greed: ${avgBreakdownRL.fearGreed.length ? Math.round(avgBreakdownRL.fearGreed.reduce((a,b)=>a+b)/avgBreakdownRL.fearGreed.length) : 'N/A'}% accurate\n- SPY Trend: ${avgBreakdownRL.spyTrend.length ? Math.round(avgBreakdownRL.spyTrend.reduce((a,b)=>a+b)/avgBreakdownRL.spyTrend.length) : 'N/A'}% accurate\n- Sector: ${avgBreakdownRL.sectorRotation.length ? Math.round(avgBreakdownRL.sectorRotation.reduce((a,b)=>a+b)/avgBreakdownRL.sectorRotation.length) : 'N/A'}% accurate\n- Options Pulse: ${avgBreakdownRL.optionsPulse.length ? Math.round(avgBreakdownRL.optionsPulse.reduce((a,b)=>a+b)/avgBreakdownRL.optionsPulse.length) : 'N/A'}% accurate\nAdjust your predictions to compensate for any indicator where accuracy is below 60%.\n`
            : '';

          // Real data for prediction signals — reuse RL-suffixed vars fetched below if available,
          // otherwise fetch fresh (noon lock may run before or after live refresh)
          const predSpyDataRL = await fetchSPYData();
          const predFgDataRL = await fetchFearAndGreed();
          const predPcRatioRL = await fetchSPYPutCallRatio() ?? 0.74;
          const predSectorsRL = await fetchSectorData();
          const predSignalsRL = computePredictionSignals(
            predSpyDataRL,
            predFgDataRL?.score ?? 50,
            predFgDataRL?.delta ?? 0,
            predPcRatioRL,
          );

          const predPrompt = `You are a market prediction engine. Today is ${getCurrentDate()}.

REAL TODAY DATA (already fetched — do NOT re-search these numbers):
- SPY: ${predSpyDataRL.changePercent != null ? `${predSpyDataRL.changePercent > 0 ? '+' : ''}${predSpyDataRL.changePercent}%` : 'flat'}, direction: ${predSpyDataRL.direction}, above 200MA: ${predSpyDataRL.above200MA}, above 50MA: ${predSpyDataRL.above50MA}, volume: ${predSpyDataRL.volumeRatio != null ? `${predSpyDataRL.volumeRatio}x avg` : 'normal'}
- Fear & Greed: ${predFgDataRL?.score ?? 50}/100 (${predFgDataRL?.label ?? 'Neutral'}), delta ${predFgDataRL?.delta ?? 0} from yesterday
- Sector leader today: ${predSectorsRL?.leader ? `${predSectorsRL.leader.ticker} ${predSectorsRL.leader.changePercent > 0 ? '+' : ''}${predSectorsRL.leader.changePercent}%` : 'N/A'}
- Sector lagger today: ${predSectorsRL?.lagger ? `${predSectorsRL.lagger.ticker} ${predSectorsRL.lagger.changePercent > 0 ? '+' : ''}${predSectorsRL.lagger.changePercent}%` : 'N/A'}
- SPY put/call ratio: ${predPcRatioRL}

QUANTITATIVE SIGNALS (anchor your predictions to these):
${predSignalsRL.signals.map(s => `- ${s}`).join('\n')}
SIGNAL BALANCE: ${predSignalsRL.bullCount} bullish vs ${predSignalsRL.bearCount} bearish → ${predSignalsRL.confidence} Conviction ${predSignalsRL.bias}

${calibrationRL}
Using these signals as your foundation, search for any additional context (upcoming catalysts, news) and predict tomorrow's 4 key indicators. Return ONLY valid JSON:
{
  "tomorrowPredictions": {
    "fearGreed": {
      "score": 65,
      "label": "Greed",
      "delta": -3,
      "description": "Why this F&G prediction — cite signals above"
    },
    "spyTrend": {
      "direction": "Up",
      "changePercent": 0.5,
      "above200MA": ${predSpyDataRL.above200MA ?? true},
      "above50MA": ${predSpyDataRL.above50MA ?? true},
      "volumeRatio": null,
      "description": "Why this SPY prediction — cite signals above"
    },
    "sectorRotation": {
      "leader": { "sector": "Technology", "ticker": "XLK", "performance": "predicted +1.0%" },
      "lagger": { "sector": "Energy", "ticker": "XLE", "performance": "predicted -0.5%" },
      "implication": "Why this sector rotation — cite momentum or macro"
    },
    "optionsPulse": {
      "putCallRatio": 0.80,
      "lean": "Neutral",
      "description": "Why this options prediction"
    }
  },
  "tomorrowOutlook": "2-3 sentence narrative anchored in the signals above"
}
Rules:
- fearGreed.label: "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
- spyTrend.direction: "Up" | "Down" | "Flat" (bias toward ${predSignalsRL.bias === 'Bullish' ? 'Up' : predSignalsRL.bias === 'Bearish' ? 'Down' : 'Flat'} based on signals)
- spyTrend.above200MA and above50MA: use current values unless you have strong reason to predict change
- sectorRotation: use sector ETF tickers (XLK, XLF, XLE, XLV, XLI, XLY, XLP, XLU, XLB, XLRE, XLC)
- optionsPulse.lean: "Bullish" | "Neutral" | "Bearish"
- ANCHOR predictions to the quantitative signals — only override with strong search-based evidence`;

          const predResp = await ai.models.generateContent({
            model,
            contents: predPrompt,
            config: { tools: [{ googleSearch: {} }], temperature: 0.3 },
          });
          const predRaw = predResp.text || '{}';
          const predJson = predRaw.slice(predRaw.indexOf('{'), predRaw.lastIndexOf('}') + 1);
          const predResult = JSON.parse(predJson);
          if (predResult.tomorrowPredictions) {
            predResult.tomorrowPredictions.confidence = predSignalsRL.confidence;
            predResult.tomorrowPredictions.signals = predSignalsRL.signals;
            await sql`
              UPDATE market_daily_records
              SET is_noon_locked = true,
                  noon_locked_at = now(),
                  tomorrow_predictions = ${JSON.stringify(predResult.tomorrowPredictions)},
                  tomorrow_outlook = ${predResult.tomorrowOutlook ?? ''},
                  updated_at = now()
              WHERE record_date = ${todayET}
            `;
            const freshToday = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
            if (freshToday[0]) todayRow = freshToday[0];
          }
        } catch (predErr) {
          console.error('[refreshLive] Noon lock error:', predErr);
        }
      }

      // Live data refresh
      const updatedAt = todayRow.updated_at ? new Date(todayRow.updated_at).getTime() : 0;
      const needsLiveRefresh = !todayRow.elite6_actual || updatedAt < twentyMinAgo;
      if (needsLiveRefresh) {
        try {
          // ── Fetch all real market data in parallel ──────────────────────────────
          const [realPutCallRL, spyDataRL, fearGreedDataRL, sectorDataRL, moversRL] = await Promise.all([
            fetchSPYPutCallRatio(),
            fetchSPYData(),
            fetchFearAndGreed(),
            fetchSectorData(),
            fetchMarketMovers(),
          ]);

          // ── Build elite6 from real data (no AI for these numbers) ──────────────
          const fgScoreRL = fearGreedDataRL?.score ?? 50;
          const fgLabelRL = fearGreedDataRL?.label ?? 'Neutral';
          const fgDeltaRL = fearGreedDataRL?.delta ?? 0;
          const pcRatioRL = realPutCallRL ?? 0.74;
          const pcLeanRL = pcRatioRL < 0.65 ? 'Bullish' : pcRatioRL >= 0.9 ? 'Bearish' : 'Neutral';
          const leaderSectorRL = sectorDataRL?.leader;
          const laggerSectorRL = sectorDataRL?.lagger;
          const topMoverRL = moversRL.gainers[0] ?? moversRL.losers[0] ?? null;

          // ── Build real edge board (reasons filled after AI call below) ─────────
          const buildEdgeBoardRL = (reasons: Record<string, string>) => ({
            top5: moversRL.gainers.map((m, i) => ({
              rank: i + 1,
              ticker: m.ticker,
              name: m.name,
              change: m.change,
              edge: reasons[m.ticker] ?? `+${m.changePercent}% — top gainer today`,
              sector: 'Equities',
            })),
            bottom5: moversRL.losers.map((m, i) => ({
              rank: i + 1,
              ticker: m.ticker,
              name: m.name,
              change: m.change,
              edge: reasons[m.ticker] ?? `${m.changePercent}% — bottom mover today`,
              sector: 'Equities',
            })),
            generatedAt: new Date().toISOString(),
          });

          // ── AI prompt: only generates narrative sections ──────────────────────
          const narrativePromptRL = `You are a market intelligence analyst. Today is ${getCurrentDate()}.

REAL MARKET DATA (fetched from Yahoo Finance & CNN — DO NOT change these numbers):
- SPY: ${spyDataRL.changePercent != null ? `${spyDataRL.changePercent > 0 ? '+' : ''}${spyDataRL.changePercent}%` : 'flat'} today, ${spyDataRL.direction}, above 200MA: ${spyDataRL.above200MA}, above 50MA: ${spyDataRL.above50MA}, volume: ${spyDataRL.volumeRatio != null ? `${spyDataRL.volumeRatio}x average` : 'normal'}
- Fear & Greed Index: ${fgScoreRL}/100 (${fgLabelRL}), changed ${fgDeltaRL > 0 ? '+' : ''}${fgDeltaRL} from yesterday
- Top sector: ${leaderSectorRL ? `${leaderSectorRL.ticker} (${leaderSectorRL.sector}) ${leaderSectorRL.changePercent > 0 ? '+' : ''}${leaderSectorRL.changePercent}%` : 'N/A'}
- Bottom sector: ${laggerSectorRL ? `${laggerSectorRL.ticker} (${laggerSectorRL.sector}) ${laggerSectorRL.changePercent > 0 ? '+' : ''}${laggerSectorRL.changePercent}%` : 'N/A'}
- SPY put/call ratio: ${pcRatioRL} (${pcLeanRL} lean)
- Today's top gainers: ${moversRL.gainers.map(m => `${m.ticker} ${m.change}`).join(', ') || 'N/A'}
- Today's top losers: ${moversRL.losers.map(m => `${m.ticker} ${m.change}`).join(', ') || 'N/A'}

Using this real data as your foundation, search for today's market news and generate the following. Return ONLY valid JSON:
{
  "briefBullets": [
    {
      "what": "Short headline naming the specific event (5-8 words, include actual ticker/number if relevant)",
      "why": "The precise data/catalyst that caused it with real numbers",
      "impact": "2-3 sentences: which sectors/ETFs win or lose, what this changes for Fed/earnings outlooks, what a practical investor should watch"
    },
    // ... repeat same structure for bullets 2-5
  ],
  "outlier": "One genuinely surprising or counter-intuitive data point from today — must cite a real ticker or real number from the data above",
  "catalyst": "The single most important event to watch in next 24 hours — be specific with timing and why it matters",
  "liveHeadlines": [
    { "headline": "exact headline from today", "source": "Bloomberg/Reuters/WSJ/etc", "impactScore": 7, "category": "Macro", "timestamp": "${new Date().toISOString()}" }
  ],
  "bigStory": {
    "ticker": "${topMoverRL?.ticker ?? 'SPY'}",
    "name": "${topMoverRL?.name ?? 'SPDR S&P 500 ETF'}",
    "changePercent": "${topMoverRL?.change ?? (spyDataRL.changePercent != null ? `${spyDataRL.changePercent > 0 ? '+' : ''}${spyDataRL.changePercent}%` : '0%')}",
    "direction": "${topMoverRL ? (topMoverRL.changePercent >= 0 ? 'Up' : 'Down') : spyDataRL.direction === 'Down' ? 'Down' : 'Up'}",
    "reason": "Search for the specific reason this stock moved today — cite earnings, news, or macro catalyst with real numbers"
  },
  "nextCatalyst": {
    "time": "8:30 AM ET",
    "event": "The single most market-moving scheduled event in the next 24 hours with consensus estimate",
    "implication": "1-2 sentences: what a hot vs in-line vs cool result means for markets"
  },
  "positioning": {
    "overweight": [
      { "asset": "Sector or asset name", "ticker": "ETF ticker", "rationale": "10-word reason grounded in today's real data" }
    ],
    "neutral": [
      { "asset": "...", "ticker": "...", "rationale": "..." }
    ],
    "underweight": [
      { "asset": "...", "ticker": "...", "rationale": "..." }
    ]
  },
  "edgeBoardReasons": {
    "TICKER1": "10-word specific catalyst — earnings, news, or macro event",
    "TICKER2": "..."
  }
}

Rules:
- briefBullets: exactly 5 bullets — use the real numbers from the data above, search for additional context
- outlier: must reference a real ticker or real number, not generic commentary
- liveHeadlines: 5-8 headlines, only impactScore >= 6, use real headlines from today
- bigStory: the ticker is already set above — write only the reason field by searching for news
- nextCatalyst: check economic calendar for the next 24 hours
- positioning: 1-3 items per category, grounded in the real sector data above
- edgeBoardReasons: for EVERY ticker in today's top gainers and top losers, search and write a specific ~10-word catalyst (earnings beat, guidance raise, FDA approval, macro sensitivity, etc.) — not just "top gainer today"
- DO NOT invent prices, percentages, or market levels — use only the real data provided above`;

          const narrativeRespRL = await ai.models.generateContent({
            model,
            contents: narrativePromptRL,
            config: {
              tools: [{ googleSearch: {} }],
              temperature: 0.2,
            },
          });

          const narrativeRawRL = narrativeRespRL.text || '{}';
          const narrativeJsonRL = narrativeRawRL.slice(narrativeRawRL.indexOf('{'), narrativeRawRL.lastIndexOf('}') + 1);
          const narrativeRL = JSON.parse(narrativeJsonRL);

          // ── Assemble full elite6 from real data + AI narrative ─────────────────
          const elite6RL = {
            fearGreed: {
              score: fgScoreRL,
              label: fgLabelRL,
              delta: fgDeltaRL,
              description: `CNN Fear & Greed: ${fgScoreRL}/100 — ${fgLabelRL}`,
            },
            spyTrend: {
              direction: spyDataRL.direction,
              changePercent: spyDataRL.changePercent ?? 0,
              above200MA: spyDataRL.above200MA ?? true,
              above50MA: spyDataRL.above50MA ?? true,
              volumeRatio: spyDataRL.volumeRatio,
              description: `SPY ${spyDataRL.changePercent != null ? `${spyDataRL.changePercent > 0 ? '+' : ''}${spyDataRL.changePercent}%` : 'flat'} today`,
            },
            sectorRotation: leaderSectorRL && laggerSectorRL ? {
              leader: {
                sector: leaderSectorRL.sector,
                ticker: leaderSectorRL.ticker,
                performance: `${leaderSectorRL.changePercent > 0 ? '+' : ''}${leaderSectorRL.changePercent}%`,
              },
              lagger: {
                sector: laggerSectorRL.sector,
                ticker: laggerSectorRL.ticker,
                performance: `${laggerSectorRL.changePercent > 0 ? '+' : ''}${laggerSectorRL.changePercent}%`,
              },
              implication: `${leaderSectorRL.sector} leads, ${laggerSectorRL.sector} lags`,
            } : null,
            optionsPulse: {
              putCallRatio: pcRatioRL,
              lean: pcLeanRL as 'Bullish' | 'Neutral' | 'Bearish',
              description: `SPY put/call ${pcRatioRL} — ${pcLeanRL} lean`,
            },
            bigStory: narrativeRL.bigStory ?? (topMoverRL ? {
              ticker: topMoverRL.ticker,
              name: topMoverRL.name,
              changePercent: topMoverRL.change,
              direction: topMoverRL.changePercent >= 0 ? 'Up' : 'Down',
              reason: 'Top market mover today',
            } : null),
            nextCatalyst: narrativeRL.nextCatalyst ?? null,
          };

          const weatherRL = buildWeather(spyDataRL.changePercent, fgScoreRL, leaderSectorRL, laggerSectorRL);

          if (elite6RL.spyTrend) {
            await sql`
              UPDATE market_daily_records
              SET elite6_actual = ${JSON.stringify(elite6RL)},
                  brief_bullets = ${JSON.stringify(narrativeRL.briefBullets ?? [])},
                  outlier = ${narrativeRL.outlier ?? ''},
                  catalyst = ${narrativeRL.catalyst ?? ''},
                  weather = ${JSON.stringify(weatherRL)},
                  live_headlines = ${JSON.stringify(narrativeRL.liveHeadlines ?? [])},
                  edge_board = ${JSON.stringify(buildEdgeBoardRL((narrativeRL.edgeBoardReasons as Record<string, string>) ?? {}))}::jsonb,
                  positioning = ${narrativeRL.positioning ? JSON.stringify(narrativeRL.positioning) : null}::jsonb,
                  updated_at = now()
              WHERE record_date = ${todayET}
            `;
            const freshToday2 = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
            if (freshToday2[0]) todayRow = freshToday2[0];
          }
        } catch (liveErr) {
          console.error('[refreshLive] Live data error:', liveErr);
        }
      }

      // Return updated data
      const freshResult = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
      const freshRow = freshResult[0] ?? todayRow;
      const freshUpdatedAt = freshRow.updated_at ? new Date(freshRow.updated_at).getTime() : 0;
      const freshIsStale = !freshRow.elite6_actual || freshUpdatedAt < twentyMinAgo;

      const freshYestResult = await sql`SELECT * FROM market_daily_records WHERE record_date = ${yesterdayET}`;
      const freshYestRow = freshYestResult[0] ?? yesterdayRow;

      // Compute rolling 30-day accuracy per indicator
      const last30RowsRL = await sql`
        SELECT accuracy_breakdown FROM market_daily_records
        WHERE accuracy_breakdown IS NOT NULL
        ORDER BY record_date DESC LIMIT 30
      `;
      const rollingRL: Record<string, number[]> = { fearGreed: [], spyTrend: [], sectorRotation: [], optionsPulse: [] };
      for (const r of last30RowsRL) {
        const ab = r.accuracy_breakdown as Record<string, number> | null;
        if (!ab) continue;
        for (const key of Object.keys(rollingRL)) {
          if (ab[key] != null) rollingRL[key].push(Number(ab[key]));
        }
      }
      const rollingAccuracyRL = {
        fearGreed: rollingRL.fearGreed.length ? Math.round(rollingRL.fearGreed.reduce((a,b)=>a+b,0)/rollingRL.fearGreed.length) : null,
        spyTrend: rollingRL.spyTrend.length ? Math.round(rollingRL.spyTrend.reduce((a,b)=>a+b,0)/rollingRL.spyTrend.length) : null,
        sectorRotation: rollingRL.sectorRotation.length ? Math.round(rollingRL.sectorRotation.reduce((a,b)=>a+b,0)/rollingRL.sectorRotation.length) : null,
        optionsPulse: rollingRL.optionsPulse.length ? Math.round(rollingRL.optionsPulse.reduce((a,b)=>a+b,0)/rollingRL.optionsPulse.length) : null,
        daysScored: last30RowsRL.length,
      };

      // Compute model and user streaks
      const streakRowsRL = await sql`
        SELECT accuracy_breakdown, user_accuracy_correct
        FROM market_daily_records
        WHERE record_date < ${todayET}
        ORDER BY record_date DESC
        LIMIT 30
      `;
      let modelStreakRL = 0;
      let userStreakRL = 0;
      for (const r of streakRowsRL) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ab = r.accuracy_breakdown as Record<string, number> | null;
        const modelCorrect = ab?.spyTrend != null && ab.spyTrend >= 60;
        if (modelCorrect) modelStreakRL++; else break;
      }
      let userStreakBrokenRL = false;
      for (const r of streakRowsRL) {
        if (r.user_accuracy_correct === true) { if (!userStreakBrokenRL) userStreakRL++; }
        else if (r.user_accuracy_correct === false) { userStreakBrokenRL = true; break; }
      }

      return NextResponse.json({
        success: true,
        data: {
          yesterday: freshYestRow ? rowToRecord(freshYestRow) : null,
          today: rowToRecord(freshRow),
          isLiveDataStale: freshIsStale,
          needsRefresh: false,
          lastRefreshed: freshRow.updated_at ? String(freshRow.updated_at) : new Date().toISOString(),
          rollingAccuracy: rollingAccuracyRL,
          modelStreak: modelStreakRL,
          userStreak: userStreakRL,
        },
      });
    }

    if (action === 'history') {
      const sql = db();
      const rows = await sql`
        SELECT record_date, accuracy_score, user_accuracy_correct
        FROM market_daily_records
        WHERE accuracy_score IS NOT NULL
        ORDER BY record_date DESC LIMIT 90
      `;
      return NextResponse.json({
        success: true,
        data: rows.map(r => ({
          date: String(r.record_date).slice(0, 10),
          score: Number(r.accuracy_score),
          userCorrect: r.user_accuracy_correct as boolean | null,
        })),
      });
    }

    if (action === 'userPredict') {
      if (!currentUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      if (!await checkRateLimit(currentUserId, 'userPredict', 5)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }
      const sql = db();
      const { date, prediction } = body as { date: string; prediction: 'Up' | 'Down' | 'Flat' };
      if (!date || !['Up', 'Down', 'Flat'].includes(prediction)) {
        return NextResponse.json({ error: 'Invalid prediction' }, { status: 400 });
      }
      await sql`
        UPDATE market_daily_records
        SET user_spy_prediction = ${prediction},
            user_prediction_locked_at = now()
        WHERE record_date = ${date}
          AND user_spy_prediction IS NULL
      `;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error';
    console.error('[/api/market] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
