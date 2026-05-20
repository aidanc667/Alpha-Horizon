import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { checkRateLimit } from '@/lib/rateLimit';

// ─── Server-side response cache ───────────────────────────────────────────────
interface CacheEntry { data: unknown; ts: number }
const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL: Record<string, number> = {
  nearTerm: 20 * 60 * 1000,       // 20 minutes
  liveUpdate: 10 * 60 * 1000,     // 10 minutes
  outlook: 2 * 60 * 60 * 1000,    // 2 hours
  polygonContext: 5 * 60 * 1000,  // 5 minutes
  portfolioAdvice: 0,              // never cache (personalized)
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

// Maps a snake_case DB row to a DailyMarketRecord camelCase object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRecord(row: any) {
  return {
    recordDate: row.record_date instanceof Date
      ? row.record_date.toISOString().slice(0, 10)
      : String(row.record_date).slice(0, 10),
    isNoonLocked: row.is_noon_locked ?? false,
    noonLockedAt: row.noon_locked_at ? String(row.noon_locked_at) : null,
    elite6Actual: row.elite6_actual ?? null,
    briefBullets: row.brief_bullets ?? [],
    outlier: row.outlier ?? '',
    catalyst: row.catalyst ?? '',
    weather: row.weather ?? null,
    liveHeadlines: row.live_headlines ?? [],
    tomorrowPredictions: row.tomorrow_predictions ?? null,
    tomorrowOutlook: row.tomorrow_outlook ?? '',
    accuracyScore: row.accuracy_score != null ? Number(row.accuracy_score) : null,
    accuracyBreakdown: row.accuracy_breakdown ?? null,
    accuracyCalculatedAt: row.accuracy_calculated_at ? String(row.accuracy_calculated_at) : null,
    edgeBoard: row.edge_board || null,
    positioning: row.positioning || null,
  };
}

// ─── POST /api/market ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await checkRateLimit(userId, 'market', 30)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });
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

    // ── polygonTicker — single ticker lookup for Portfolio Analyzer ───────────
    if (action === 'polygonTicker') {
      const { ticker } = body;
      if (!ticker || typeof ticker !== 'string') {
        return NextResponse.json({ error: 'ticker required' }, { status: 400 });
      }
      const polygonKey = process.env.POLYGON_API_KEY;
      if (!polygonKey) return NextResponse.json({ error: 'POLYGON_API_KEY not set' }, { status: 500 });

      const clean = ticker.toUpperCase().replace(/[^A-Z0-9.^=-]/g, '').slice(0, 10);
      const res = await fetch(
        `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${clean}?apiKey=${polygonKey}`,
        { next: { revalidate: 60 } }
      );
      if (!res.ok) return NextResponse.json({ error: `Polygon error ${res.status}` }, { status: res.status });
      const data = await res.json();
      const t = data.ticker;
      if (!t) return NextResponse.json({ error: 'Ticker not found' }, { status: 404 });
      return NextResponse.json({
        success: true,
        data: {
          ticker: t.ticker,
          price: t.day?.c ?? t.prevDay?.c ?? null,
          changePct: t.todaysChangePerc ?? null,
          name: t.ticker,
        },
      });
    }

    // ── polygonContext — real-time price snapshot from Polygon.io + FRED macro ──
    if (action === 'polygonContext') {
      const cached = getCached('polygonContext');
      if (cached) return NextResponse.json({ success: true, data: cached });

      const polygonKey = process.env.POLYGON_API_KEY;
      const fredKey    = process.env.FRED_API_KEY;

      const TICKERS = ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'HYG', 'UUP', 'XLK', 'XLF', 'XLE', 'XLV', 'VIXY'];

      const [polygonRes, fredRates, fredCpi, fredUnrate, fredSpread] = await Promise.allSettled([
        polygonKey
          ? fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${TICKERS.join(',')}&apiKey=${polygonKey}`)
          : Promise.reject('No POLYGON_API_KEY'),
        fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=DFF&api_key=${fredKey}&limit=1&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
        fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=${fredKey}&limit=13&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
        fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE&api_key=${fredKey}&limit=1&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
        fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=T10Y2Y&api_key=${fredKey}&limit=1&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
      ]);

      const priceMap: Record<string, { price: number; change1d: number; changePct1d: number }> = {};
      if (polygonRes.status === 'fulfilled' && polygonRes.value.ok) {
        const pData = await polygonRes.value.json();
        for (const t of (pData.tickers || [])) {
          priceMap[t.ticker] = {
            price: t.day?.c ?? t.prevDay?.c ?? 0,
            change1d: (t.day?.c ?? 0) - (t.prevDay?.c ?? 0),
            changePct1d: t.todaysChangePerc ?? 0,
          };
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
${liveSummary}
${buildMarketStance(nearTermContext)}
${buildSessionBlock(sessionCtx)}

YOUR COMMUNICATION STYLE — follow these rules exactly:
- Lead with the answer, never with a preamble. Never say "Great question!" or "Certainly!" Just answer.
- Write in short paragraphs of 3-4 sentences. No bullet points. No markdown headers. No bold text. Plain prose only.
- Calibrate length to complexity: a simple yes/no gets 2-3 sentences; a complex portfolio question gets 3-4 paragraphs max.
- Name specific tickers, weights, and time horizons. Never say "consider diversifying" or "it depends" without following up with a specific take.
- When the user's question is vague or missing key context (tax bracket, time horizon, account type), ask one clarifying question before giving a full answer.
- Push back when the user's idea has a flaw. Say "The problem with that is..." not "That's interesting, but..."
- Cite specific numbers when you have them: index levels, yields, spreads, CPI prints. If you don't have a number, use Google Search to get it.
- Acknowledge uncertainty plainly: "Honestly, nobody knows — here's what the data suggests" beats false confidence.
- Remember everything the user has told you in this conversation and reference it when relevant.
- Connect every recommendation to the current macro regime. If the regime makes a trade worse, say so.
- Cover what happened in the past to explain the present, and give your best probabilistic view of what comes next.
- You are an advisor, not a disclaimer machine. Give real opinions. End responses with the standard disclaimer only once per conversation, not on every message.`,
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
TASK: Identify the TOP 8 best assets to own RIGHT NOW for a ${riskProfile} investor with a ${timeHorizon} time horizon.

SELECTION CRITERIA:
- Forward-looking expected returns (NOT historical), grounded in current macro regime
- Risk-adjusted (Sharpe ratio consideration for each pick)
- Current macro regime alignment (explicitly connect each pick to the regime context above)
- Fee efficiency — prefer low-cost ETFs where applicable
- Diversification across asset classes

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

      // Ensure today's record exists
      const todayRows = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
      if (todayRows.length === 0) {
        await sql`INSERT INTO market_daily_records (record_date) VALUES (${todayET}) ON CONFLICT (record_date) DO NOTHING`;
      }

      // Load today's record
      const todayResult = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
      let todayRow = todayResult[0];

      // Load yesterday's record
      const yesterdayResult = await sql`SELECT * FROM market_daily_records WHERE record_date = ${yesterdayET}`;
      const yesterdayRow = yesterdayResult[0] ?? null;

      // Auto accuracy calculation: if yesterday exists with predictions but no accuracy score
      if (yesterdayRow && yesterdayRow.tomorrow_predictions && yesterdayRow.accuracy_score == null && todayRow.elite6_actual) {
        try {
          const accuracyPrompt = `You are a market prediction accuracy auditor. Date being scored: ${yesterdayET}.

YESTERDAY'S PREDICTIONS (made at noon):
${JSON.stringify(yesterdayRow.tomorrow_predictions, null, 2)}

TODAY'S ACTUAL RESULTS:
${JSON.stringify(todayRow.elite6_actual, null, 2)}

Score each prediction category 0-100 based on accuracy. Return ONLY valid JSON:
{
  "accuracyBreakdown": {
    "spyDirection": 0,
    "spyMagnitude": 0,
    "vibeCheck": 0,
    "assetOfDay": 0,
    "marketHealth": 0,
    "whaleActivity": 0,
    "hotSector": 0
  },
  "overallScore": 0,
  "commentary": "One sentence: what the prediction got right and wrong"
}

Scoring rules:
- spyDirection: 100 if direction correct, 50 if flat/unknown predicted, 0 if wrong
- spyMagnitude: 100 if actual within predicted range, 80 if within 0.5%, 60 if within 1%, 0 if off by >2%
- vibeCheck: 100 if same label (e.g. both Greed), 75 if adjacent (e.g. Greed vs Extreme Greed), 25 if opposite end
- assetOfDay: 100 if predicted bias (Bullish/Bearish) matched actual performance, 50 if neutral/flat, 0 if wrong
- marketHealth: 100 if same status (Healthy/Mixed/Fragile), 50 if off by one, 0 if completely wrong
- whaleActivity: 100 if signal direction correct (Accumulating/Distributing), 50 if Neutral predicted, 0 if wrong
- hotSector: 100 if same sector led, 70 if same broad theme, 0 if completely different`;

          const accResp = await ai.models.generateContent({
            model,
            contents: accuracyPrompt,
            config: {
              temperature: 0.3,
            },
          });

          const accRaw = accResp.text || '{}';
          const accJson = accRaw.slice(accRaw.indexOf('{'), accRaw.lastIndexOf('}') + 1);
          const accResult = JSON.parse(accJson);

          if (accResult.accuracyBreakdown) {
            await sql`
              UPDATE market_daily_records
              SET accuracy_score = ${accResult.overallScore ?? null},
                  accuracy_breakdown = ${JSON.stringify(accResult.accuracyBreakdown)},
                  accuracy_calculated_at = now(),
                  updated_at = now()
              WHERE record_date = ${yesterdayET}
            `;
            // Refresh yesterday row
            const freshYest = await sql`SELECT * FROM market_daily_records WHERE record_date = ${yesterdayET}`;
            if (freshYest[0]) Object.assign(yesterdayRow, freshYest[0]);
          }
        } catch (accErr) {
          console.error('[tripleCard] Accuracy calc error:', accErr);
        }
      }

      // Auto noon lock: generate tomorrow predictions if past noon and not yet locked
      if (isAfterNoonET() && !todayRow.is_noon_locked) {
        try {
          const predPrompt = `You are a predictive market analyst. Today is ${getCurrentDate()}, time is 12:00 PM ET (noon lock).

Search for current market conditions. Generate predictions for TOMORROW's market. Return ONLY valid JSON:
{
  "tomorrowPredictions": {
    "spyMovement": { "value": "predicted range e.g. '-0.5% to +0.3%'", "direction": "up|down|flat|unknown", "label": "Predicted: -0.5% to +0.3%" },
    "vibeCheck": { "score": 50, "label": "Neutral", "description": "Expected sentiment based on upcoming catalysts and current options flow" },
    "assetOfDay": { "ticker": "SYMBOL", "name": "Full Name", "bias": "Bullish", "change": "Predicted +1.5% to +2.0%", "conviction": "10-word reason for the bullish/bearish call tomorrow" },
    "marketHealth": { "status": "Healthy", "label": "Healthy / Broad", "description": "Expected breadth based on overnight futures and catalyst calendar" },
    "whaleActivity": { "signal": "Accumulating", "magnitude": "moderate", "description": "Expected institutional flow based on options positioning and dark pool trends" },
    "hotSector": { "sector": "Technology", "ticker": "XLK", "performance": "Projected to lead", "catalyst": "reason this sector leads tomorrow" }
  },
  "tomorrowOutlook": "2-3 sentence narrative: key risk, key opportunity, overall thesis for tomorrow"
}

Rules:
- Base predictions on: current options flow, scheduled economic releases, Fed calendar, earnings calendar, technical levels
- Be specific: name the economic data releases and exact times
- Volatility prediction: factor in VIX term structure and any overnight risk events`;

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

      // Live data refresh: if elite6_actual is null OR updated_at > 20 min ago
      const updatedAt = todayRow.updated_at ? new Date(todayRow.updated_at).getTime() : 0;
      const twentyMinAgo = Date.now() - 20 * 60 * 1000;
      const needsLiveRefresh = !todayRow.elite6_actual || updatedAt < twentyMinAgo;

      if (needsLiveRefresh) {
        try {
          const livePrompt = `You are a real-time market intelligence engine. Today is ${getCurrentDate()}.

Search for today's market data RIGHT NOW. Return ONLY valid JSON:
{
  "elite6": {
    "spyMovement": { "value": "+1.2%", "direction": "up", "label": "Real-time: +1.2%" },
    "vibeCheck": { "score": 55, "label": "Greed", "description": "VIX 14.2 falling, put/call 0.72 — options market pricing in complacency" },
    "assetOfDay": { "ticker": "NVDA", "name": "NVIDIA Corp", "bias": "Bullish", "change": "+3.2%", "conviction": "AI chip demand surge, unusual call option volume at open" },
    "marketHealth": { "status": "Healthy", "label": "Healthy / Broad", "description": "72% of S&P 500 constituents advancing — broad-based rally with small-caps participating" },
    "whaleActivity": { "signal": "Accumulating", "magnitude": "moderate", "description": "Dark pool net buying $2.3B today, concentrated in mega-cap tech and semis" },
    "hotSector": { "sector": "Technology", "ticker": "XLK", "performance": "+2.1% leading all sectors", "catalyst": "AI earnings cycle + FOMC dovish lean" }
  },
  "briefBullets": [
    {
      "what": "Short headline naming the specific event (5-8 words, e.g. 'S&P 500 Drops 1.2% on Hot PPI')",
      "why": "The precise data/catalyst that caused it with real numbers (e.g. 'PPI printed 0.4% MoM vs 0.2% expected, energy component +1.8%')",
      "impact": "2-3 sentences covering: (1) which specific sectors, ETFs, or assets win or lose, (2) what this changes for Fed/rate expectations or earnings outlooks, and (3) what a practical investor should consider doing or watching as a result."
    },
    { "what": "event 2", "why": "cause with numbers 2", "impact": "2-3 sentence investment impact 2" },
    { "what": "event 3", "why": "cause with numbers 3", "impact": "2-3 sentence investment impact 3" },
    { "what": "event 4", "why": "cause with numbers 4", "impact": "2-3 sentence investment impact 4" },
    { "what": "event 5", "why": "cause with numbers 5", "impact": "2-3 sentence investment impact 5" }
  ],
  "outlier": "One weird/defying-logic stat or move from today with the actual numbers",
  "catalyst": "The single most important event to watch in next 24 hours — be specific with timing",
  "weather": {
    "condition": "overcast",
    "emoji": "☁️",
    "label": "Overcast",
    "description": "One sentence: why this weather based on institutional flow + breadth"
  },
  "liveHeadlines": [
    { "headline": "exact headline", "source": "Bloomberg", "impactScore": 7, "category": "Macro", "timestamp": "2024-01-01T12:00:00Z" }
  ],
  "edgeBoard": {
    "top5": [
      { "rank": 1, "ticker": "SYMBOL", "name": "Full Name", "change": "+X.X%", "edge": "10-word statistical edge or catalyst", "sector": "Sector Name" },
      { "rank": 2, "ticker": "SYMBOL", "name": "Full Name", "change": "+X.X%", "edge": "10-word statistical edge or catalyst", "sector": "Sector Name" },
      { "rank": 3, "ticker": "SYMBOL", "name": "Full Name", "change": "+X.X%", "edge": "10-word statistical edge or catalyst", "sector": "Sector Name" },
      { "rank": 4, "ticker": "SYMBOL", "name": "Full Name", "change": "+X.X%", "edge": "10-word statistical edge or catalyst", "sector": "Sector Name" },
      { "rank": 5, "ticker": "SYMBOL", "name": "Full Name", "change": "+X.X%", "edge": "10-word statistical edge or catalyst", "sector": "Sector Name" }
    ],
    "bottom5": [
      { "rank": 1, "ticker": "SYMBOL", "name": "Full Name", "change": "-X.X%", "edge": "10-word reason to avoid today", "sector": "Sector Name" },
      { "rank": 2, "ticker": "SYMBOL", "name": "Full Name", "change": "-X.X%", "edge": "10-word reason to avoid today", "sector": "Sector Name" },
      { "rank": 3, "ticker": "SYMBOL", "name": "Full Name", "change": "-X.X%", "edge": "10-word reason to avoid today", "sector": "Sector Name" },
      { "rank": 4, "ticker": "SYMBOL", "name": "Full Name", "change": "-X.X%", "edge": "10-word reason to avoid today", "sector": "Sector Name" },
      { "rank": 5, "ticker": "SYMBOL", "name": "Full Name", "change": "-X.X%", "edge": "10-word reason to avoid today", "sector": "Sector Name" }
    ]
  },
  "positioning": {
    "overweight": [
      { "asset": "Sector/Asset Name", "ticker": "ETF or Symbol", "rationale": "10-word evidence-based reason" }
    ],
    "neutral": [
      { "asset": "...", "ticker": "...", "rationale": "..." }
    ],
    "underweight": [
      { "asset": "...", "ticker": "...", "rationale": "..." }
    ]
  }
}

Rules:
- Use REAL search data — cite actual numbers (VIX level, SPY price, sector %s)
- briefBullets: provide exactly 5 bullets — "why" must have SPECIFIC numbers (data prints, %, basis points); "impact" must be 2-3 full sentences that name specific winning/losing sectors or ETFs, explain the macro chain reaction (e.g. rate implications, earnings risk), and give a practical takeaway for an investor (what to watch, buy, or avoid)
- Volatility score: 1-3 = calm, 4-5 = moderate, 6-7 = elevated, 8-9 = high, 10 = extreme
- Weather: sunny = broad buying + low vol, overcast = mixed signals, stormy = selling + high vol
- liveHeadlines: only headlines with impactScore >= 6, max 8 headlines
- direction must be exactly one of: "up", "down", "flat", "unknown"
- vibeCheck label must be exactly one of: "Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"
- vibeCheck score: 0-20 = Extreme Fear, 21-40 = Fear, 41-60 = Neutral, 61-80 = Greed, 81-100 = Extreme Greed
- assetOfDay bias must be exactly one of: "Bullish", "Bearish"
- marketHealth status must be exactly one of: "Healthy", "Mixed", "Fragile"
- whaleActivity signal must be exactly one of: "Accumulating", "Distributing", "Neutral"
- whaleActivity magnitude must be exactly one of: "light", "moderate", "heavy"
- weather condition must be exactly one of: "sunny", "overcast", "stormy"
- edgeBoard: use real search data — actual movers today with specific numbers
- top5: assets with the clearest statistical edge RIGHT NOW (momentum, catalyst, unusual flow)
- bottom5: assets showing weakness, technical breakdown, or macro headwind today
- positioning: 1-3 items per category, based on today's institutional flow + macro
- All tickers must be real, tradeable securities`;

          const liveResp = await ai.models.generateContent({
            model,
            contents: livePrompt,
            config: {
              tools: [{ googleSearch: {} }],
              temperature: 0.3,
            },
          });

          const liveRaw = liveResp.text || '{}';
          const liveJson = liveRaw.slice(liveRaw.indexOf('{'), liveRaw.lastIndexOf('}') + 1);
          const liveResult = JSON.parse(liveJson);

          if (liveResult.elite6) {
            const { edgeBoard, positioning } = liveResult;
            await sql`
              UPDATE market_daily_records
              SET elite6_actual = ${JSON.stringify(liveResult.elite6)},
                  brief_bullets = ${JSON.stringify(liveResult.briefBullets ?? [])},
                  outlier = ${liveResult.outlier ?? ''},
                  catalyst = ${liveResult.catalyst ?? ''},
                  weather = ${JSON.stringify(liveResult.weather ?? null)},
                  live_headlines = ${JSON.stringify(liveResult.liveHeadlines ?? [])},
                  edge_board = ${edgeBoard ? JSON.stringify(edgeBoard) : null}::jsonb,
                  positioning = ${positioning ? JSON.stringify(positioning) : null}::jsonb,
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

      const finalUpdatedAt = todayRow.updated_at ? new Date(todayRow.updated_at).getTime() : 0;
      const isLiveDataStale = !todayRow.elite6_actual || finalUpdatedAt < twentyMinAgo;

      return NextResponse.json({
        success: true,
        data: {
          yesterday: yesterdayRow ? rowToRecord(yesterdayRow) : null,
          today: rowToRecord(todayRow),
          isLiveDataStale,
          lastRefreshed: todayRow.updated_at ? String(todayRow.updated_at) : new Date().toISOString(),
        },
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error';
    console.error('[/api/market] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
