import { NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { getCached, setCache, getCurrentDate } from '../_lib';
import type { HandlerCtx } from '../_lib';

export async function handleNearTerm(ctx: HandlerCtx): Promise<NextResponse> {
  const { ai, model } = ctx;
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
        required: ['macroPillars', 'marketSnapshot', 'causalAnalysis', 'transmissionMechanism', 'positioning', 'risks', 'catalysts', 'sources'],
      },
    },
  });

  const result = JSON.parse(response.text || '{}');
  setCache('nearTerm', result);
  return NextResponse.json({ success: true, data: result });
}
