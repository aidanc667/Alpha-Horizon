import { NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { getCached, setCache, getCurrentDate, getDbCache, setDbCache } from '../_lib';
import type { HandlerCtx } from '../_lib';

const LIVE_UPDATE_DB_KEY = 'live_update_v1';
const LIVE_UPDATE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function handleLiveUpdate(ctx: HandlerCtx): Promise<NextResponse> {
  const { ai, model } = ctx;
  // L1: in-process (~0ms)
  const cached = getCached('liveUpdate');
  if (cached) return NextResponse.json({ success: true, data: cached });

  // L2: DB cache (survives cold starts, ~80ms)
  const dbCached = await getDbCache(LIVE_UPDATE_DB_KEY, LIVE_UPDATE_TTL_MS);
  if (dbCached) {
    setCache('liveUpdate', dbCached);
    return NextResponse.json({ success: true, data: dbCached });
  }

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
  setDbCache(LIVE_UPDATE_DB_KEY, result); // persist across cold starts
  return NextResponse.json({ success: true, data: result });
}
