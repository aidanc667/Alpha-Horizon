import { NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { getCached, setCache, getCurrentDate } from '../_lib';
import type { HandlerCtx } from '../_lib';

export async function handleOutlook(ctx: HandlerCtx): Promise<NextResponse> {
  const { body, ai, model } = ctx;
  const { horizon } = body as { horizon: string };
  const outlookCacheKey = 'outlook:' + horizon;
  const cached = getCached(outlookCacheKey);
  if (cached) return NextResponse.json({ success: true, data: cached });

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
                      enum: ['U.S. Large Cap', 'U.S. Small/Mid Cap', 'International Developed Equities', 'Emerging Markets', 'Fixed Income', 'Real Assets', 'Alternatives', 'Cash/Money Markets'],
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
        required: ['strategicOutlook', 'assetSectorAnalysis', 'cmaDashboard', 'scenarioFramework', 'sectorImpact', 'sources'],
      },
    },
  });

  const result = JSON.parse(response.text || '{}');
  setCache(outlookCacheKey, result);
  return NextResponse.json({ success: true, data: result });
}
