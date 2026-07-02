import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { scoreAccuracy, buildWeather, computePredictionSignals, computeWeightAdjustment } from '@/lib/market/scoring';
import { rowToRecord } from '@/lib/market/scoring';
import {
  fetchSPYPutCallRatio, fetchSPYData, fetchFearAndGreed, fetchSectorData, fetchMarketMovers, fetchVIXData,
  getTodayET, getYesterdayET, isAfterNoonET, getCurrentDate,
  computeRollingAccuracy, buildEdgeBoard, loadSignalWeights, saveSignalWeights,
} from '../_lib';
import type { HandlerCtx } from '../_lib';

// ── Zod schemas for LLM response validation ───────────────────────────────────
const TomorrowPredictionsSchema = z.object({
  spyDirection: z.enum(['Up', 'Down']),
  spyChangePercent: z.number(),
  vixDirection: z.enum(['Up', 'Down']),
  vixChangePercent: z.number(),
  topMover: z.object({
    ticker: z.string(),
    name: z.string(),
    direction: z.enum(['Up', 'Down']),
    changePercent: z.number(),
  }),
  confidence: z.enum(['High', 'Moderate', 'Low']).optional(),
  rationale: z.string().optional(),
}).passthrough();

const LiveNarrativeSchema = z.object({
  briefBullets: z.array(
    z.object({ what: z.string(), why: z.string(), impact: z.string() }).passthrough()
  ).length(5),
  liveHeadlines: z.array(
    z.object({ headline: z.string(), source: z.string(), impactScore: z.number() }).passthrough()
  ).min(6),
}).passthrough();

// ── Shared helper: accuracy calculation ──────────────────────────────────────
async function runAccuracyCalc(
  sql: ReturnType<typeof db>,
  yesterdayRow: Record<string, unknown>,
  todayRow: Record<string, unknown>,
  yesterdayET: string,
) {
  if (!yesterdayRow?.tomorrow_predictions || yesterdayRow.accuracy_score != null || !todayRow?.elite6_actual) return;
  try {
    const { score, breakdown } = scoreAccuracy(
      yesterdayRow.tomorrow_predictions as Record<string, unknown>,
      todayRow.elite6_actual as Record<string, unknown>,
    );
    await sql`
      UPDATE market_daily_records
      SET accuracy_score = ${score},
          accuracy_breakdown = ${JSON.stringify(breakdown)},
          accuracy_calculated_at = now()
      WHERE record_date = ${yesterdayET}
    `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actualDirection = (todayRow.elite6_actual as any)?.spyTrend?.direction;
    if (yesterdayRow.user_spy_prediction && actualDirection) {
      const userCorrect = yesterdayRow.user_spy_prediction === actualDirection;
      await sql`UPDATE market_daily_records SET user_accuracy_correct = ${userCorrect} WHERE record_date = ${yesterdayET}`;
    }

    // Recompute rolling accuracy and update adaptive signal weights
    const hist7 = await sql`
      SELECT accuracy_breakdown FROM market_daily_records
      WHERE accuracy_breakdown IS NOT NULL AND record_date <= ${yesterdayET}
      ORDER BY record_date DESC LIMIT 7
    `;
    const rolling7 = computeRollingAccuracy(hist7 as Array<{ accuracy_breakdown: unknown; user_accuracy_correct: unknown }>);
    const newWeights = computeWeightAdjustment(rolling7.rollingAccuracy);
    await saveSignalWeights(sql, newWeights);
  } catch (err) {
    console.error('[tripleCard] Accuracy calc error:', err);
  }
}

// ── Shared helper: noon lock (prediction generation) ─────────────────────────
async function runNoonLock(
  sql: ReturnType<typeof db>,
  todayET: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ai: any,
  model: string,
): Promise<Record<string, unknown> | null> {
  try {
    const [recentScores, currentWeights] = await Promise.all([
      sql`
        SELECT accuracy_breakdown FROM market_daily_records
        WHERE accuracy_breakdown IS NOT NULL
        ORDER BY record_date DESC LIMIT 7
      `,
      loadSignalWeights(sql),
    ]);
    const avgBreakdown: Record<string, number[]> = { spy: [], vix: [], topMover: [] };
    for (const r of recentScores) {
      const ab = r.accuracy_breakdown as Record<string, number> | null;
      if (!ab) continue;
      for (const key of Object.keys(avgBreakdown)) {
        if (ab[key] != null) avgBreakdown[key].push(Number(ab[key]));
      }
    }
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b) / arr.length) : null;
    const calibration = recentScores.length >= 3
      ? `\nCALIBRATION (your recent 7-day accuracy — self-correct for known biases):\n- SPY Score: ${avg(avgBreakdown.spy) ?? 'N/A'}% (direction + magnitude)\n- VIX Score: ${avg(avgBreakdown.vix) ?? 'N/A'}% (direction + magnitude)\n- Top Mover Score: ${avg(avgBreakdown.topMover) ?? 'N/A'}% (direction + ticker move)\nAdjust your predictions to compensate for any indicator where accuracy is below 60%.\nADAPTIVE WEIGHTS (system-computed from accuracy history):\n- SPY Trend signals: ${(currentWeights.spyTrend * 100).toFixed(0)}% weight\n- Options Flow signals: ${(currentWeights.optionsPulse * 100).toFixed(0)}% weight\nSignals below 80% weight are underperforming historically — be more skeptical of them.\n`
      : '';

    const predSpyData = await fetchSPYData();
    const predFgData = await fetchFearAndGreed();
    const predPcRatio = await fetchSPYPutCallRatio() ?? 0.74;
    const predSectors = await fetchSectorData();
    const predVixData = await fetchVIXData();
    const predSignals = computePredictionSignals(predSpyData, predFgData?.score ?? 50, predFgData?.delta ?? 0, predPcRatio, new Date(), currentWeights);

    const predMovers = await fetchMarketMovers();
    const predPrompt = `You are a market prediction engine. Today is ${getCurrentDate()}.

REAL TODAY DATA (already fetched — do NOT re-search these numbers):
- SPY: ${predSpyData.changePercent != null ? `${predSpyData.changePercent > 0 ? '+' : ''}${predSpyData.changePercent}%` : 'flat'}, direction: ${predSpyData.direction}, above 200MA: ${predSpyData.above200MA}, above 50MA: ${predSpyData.above50MA}, volume: ${predSpyData.volumeRatio != null ? `${predSpyData.volumeRatio}x avg` : 'normal'}
- Fear & Greed: ${predFgData?.score ?? 50}/100 (${predFgData?.label ?? 'Neutral'}), delta ${predFgData?.delta ?? 0} from yesterday
- Sector leader today: ${predSectors?.leader ? `${predSectors.leader.ticker} ${predSectors.leader.changePercent > 0 ? '+' : ''}${predSectors.leader.changePercent}%` : 'N/A'}
- Sector lagger today: ${predSectors?.lagger ? `${predSectors.lagger.ticker} ${predSectors.lagger.changePercent > 0 ? '+' : ''}${predSectors.lagger.changePercent}%` : 'N/A'}
- SPY put/call ratio: ${predPcRatio}
- VIX: ${predVixData?.level ?? 'N/A'} (${predVixData?.direction === 'Up' ? 'rising' : predVixData?.direction === 'Down' ? 'falling' : 'flat'} from yesterday's close of ${predVixData?.previousClose ?? 'N/A'})
- Today's top gainers: ${predMovers.gainers.map(m => `${m.ticker} ${m.change}`).join(', ') || 'N/A'}
- Today's top losers: ${predMovers.losers.map(m => `${m.ticker} ${m.change}`).join(', ') || 'N/A'}

QUANTITATIVE SIGNALS (anchor your predictions to these):
${predSignals.signals.map((s: string) => `- ${s}`).join('\n')}
SIGNAL BALANCE: ${predSignals.bullCount} bullish vs ${predSignals.bearCount} bearish → ${predSignals.confidence} Conviction ${predSignals.bias}

${calibration}
Using these signals as your foundation, search for upcoming catalysts, earnings, and news to predict tomorrow's 3 key indicators. Return ONLY valid JSON:
{
  "tomorrowPredictions": {
    "spyDirection": "Up",
    "spyChangePercent": 0.6,
    "vixDirection": "Down",
    "vixChangePercent": -4.5,
    "topMover": {
      "ticker": "NVDA",
      "name": "NVIDIA Corp",
      "direction": "Up",
      "changePercent": 3.5
    },
    "confidence": "${predSignals.confidence}",
    "rationale": "2 sentences explaining all predictions citing today's signals"
  },
  "tomorrowOutlook": "2-3 sentence narrative anchored in the signals above"
}
Rules:
- spyDirection: "Up" or "Down" only (bias toward ${predSignals.bias === 'Bullish' ? 'Up' : predSignals.bias === 'Bearish' ? 'Down' : 'Up'} based on signals)
- spyChangePercent: predicted % move for SPY — positive for Up, negative for Down (e.g. 0.6 not 60; e.g. -1.2)
- vixDirection: "Up" (volatility rising, fear increasing) | "Down" (volatility falling, calm/greed)
- vixChangePercent: predicted % change in VIX level — positive = rising VIX, negative = falling VIX (e.g. if VIX is ${predVixData?.level ?? 18} and you expect it to fall to ${predVixData?.level ? Math.round(predVixData.level * 0.9) : 16}, that's roughly -10%)
- topMover: pick ONE stock with high conviction for a notable move tomorrow. Search today's news for earnings (pre/post market), FDA decisions, major analyst calls, macro-sensitive names. Pick a liquid, well-known name (S&P 500 or Nasdaq 100 preferred). Include the full company name.
- topMover.changePercent: predicted % move — positive for Up, negative for Down
- ANCHOR predictions to the quantitative signals — only override with strong search-based evidence`;

    const predResp = await ai.models.generateContent({
      model, contents: predPrompt,
      config: { tools: [{ googleSearch: {} }], temperature: 0.3 },
    });
    const predRaw = predResp.text || '{}';
    const predJsonMatch = predRaw.match(/```(?:json)?\s*([\s\S]*?)```/)
      ?? predRaw.match(/(\{[\s\S]*\})/);
    if (!predJsonMatch) {
      console.error('[runNoonLock] No JSON block in LLM response:', predRaw.slice(0, 300));
      throw new Error('runNoonLock: LLM response contained no JSON block');
    }
    const parsedPred = JSON.parse(predJsonMatch[1]);
    const predTarget = parsedPred.tomorrowPredictions ?? parsedPred;
    const predValidation = TomorrowPredictionsSchema.safeParse(predTarget);
    if (!predValidation.success) {
      console.error('[runNoonLock] Schema validation failed:', predValidation.error.format(), '\nRaw:', predRaw.slice(0, 500));
      throw new Error(`runNoonLock: invalid prediction shape — ${predValidation.error.issues[0]?.message}`);
    }
    const predResult = { tomorrowPredictions: predValidation.data };
    if (predResult.tomorrowPredictions) {
      (predResult.tomorrowPredictions as Record<string, unknown>).confidence = predSignals.confidence;
      (predResult.tomorrowPredictions as Record<string, unknown>).signals = predSignals.signals;
      await sql`
        UPDATE market_daily_records
        SET is_noon_locked = true,
            noon_locked_at = now(),
            tomorrow_predictions = ${JSON.stringify(predResult.tomorrowPredictions)},
            tomorrow_outlook = ${(parsedPred.tomorrowOutlook as string | undefined) ?? ''},
            updated_at = now()
        WHERE record_date = ${todayET}
      `;
      return predResult.tomorrowPredictions;
    }
  } catch (err) {
    console.error('[tripleCard] Noon lock error:', err);
  }
  return null;
}

// ── Shared helper: live data refresh ─────────────────────────────────────────
async function runLiveRefresh(
  sql: ReturnType<typeof db>,
  todayET: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ai: any,
  model: string,
): Promise<void> {
  try {
    const [realPutCall, spyData, fearGreedData, sectorData, movers, vixData] = await Promise.all([
      fetchSPYPutCallRatio(), fetchSPYData(), fetchFearAndGreed(), fetchSectorData(), fetchMarketMovers(), fetchVIXData(),
    ]);

    const fgScore = fearGreedData?.score ?? 50;
    const fgLabel = fearGreedData?.label ?? 'Neutral';
    const fgDelta = fearGreedData?.delta ?? 0;
    const pcRatio = realPutCall ?? 0.74;
    const pcLean = pcRatio < 0.65 ? 'Bullish' : pcRatio >= 0.9 ? 'Bearish' : 'Neutral';
    const leaderSector = sectorData?.leader;
    const laggerSector = sectorData?.lagger;
    const topMover = movers.gainers[0] ?? movers.losers[0] ?? null;

    const narrativePrompt = `You are a market intelligence analyst. Today is ${getCurrentDate()}.

REAL MARKET DATA (fetched from Yahoo Finance & CNN — DO NOT change these numbers):
- SPY: ${spyData.changePercent != null ? `${spyData.changePercent > 0 ? '+' : ''}${spyData.changePercent}%` : 'flat'} today, ${spyData.direction}, above 200MA: ${spyData.above200MA}, above 50MA: ${spyData.above50MA}, volume: ${spyData.volumeRatio != null ? `${spyData.volumeRatio}x average` : 'normal'}
- Fear & Greed Index: ${fgScore}/100 (${fgLabel}), changed ${fgDelta > 0 ? '+' : ''}${fgDelta} from yesterday
- Top sector: ${leaderSector ? `${leaderSector.ticker} (${leaderSector.sector}) ${leaderSector.changePercent > 0 ? '+' : ''}${leaderSector.changePercent}%` : 'N/A'}
- Bottom sector: ${laggerSector ? `${laggerSector.ticker} (${laggerSector.sector}) ${laggerSector.changePercent > 0 ? '+' : ''}${laggerSector.changePercent}%` : 'N/A'}
- SPY put/call ratio: ${pcRatio} (${pcLean} lean)
- Today's top gainers: ${movers.gainers.map(m => `${m.ticker} ${m.change}`).join(', ') || 'N/A'}
- Today's top losers: ${movers.losers.map(m => `${m.ticker} ${m.change}`).join(', ') || 'N/A'}

Using this real data as your foundation, search for today's market news and generate the following. Return ONLY valid JSON:
{
  "briefBullets": [
    { "what": "Search for actual top story — e.g. 'Fed holds rates at 4.5%, signals cuts delayed'", "why": "Specific data/catalyst from today's news with real numbers", "impact": "2-3 sentences: which sectors/ETFs win or lose, what a practical investor should do or watch" }
  ],
  "outlier": "One genuinely surprising or counter-intuitive data point NOT already covered in briefBullets — must reference a specific ticker with a real number (e.g. a stock moving 10%+ with no obvious catalyst, or a sector move that contradicts the macro narrative). Do NOT repeat the SPY move or volume observation already in the brief.",
  "catalyst": "The single most important event to watch in next 24 hours — include: exact time (e.g. '8:30 AM ET'), event name, consensus estimate vs prior reading, and a one-sentence stake (what a beat/miss means for the market)",
  "liveHeadlines": [
    { "headline": "exact headline from today", "source": "Bloomberg/Reuters/WSJ/FT/CNBC/AP/Fed/Treasury", "impactScore": 7, "category": "Macro|Fed/Rates|Earnings|Geopolitical|Sector|Crypto", "timestamp": "approximate publish time if known, else omit — do NOT fabricate times", "impact": "One sentence explaining why this matters to investors and what to watch for" }
  ],
  "bigStory": {
    "ticker": "${topMover?.ticker ?? 'SPY'}",
    "name": "${topMover?.name ?? 'SPDR S&P 500 ETF'}",
    "changePercent": "${topMover?.change ?? (spyData.changePercent != null ? `${spyData.changePercent > 0 ? '+' : ''}${spyData.changePercent}%` : '0%')}",
    "direction": "${topMover ? (topMover.changePercent >= 0 ? 'Up' : 'Down') : spyData.direction === 'Down' ? 'Down' : 'Up'}",
    "reason": "Search for the specific reason this stock moved today — cite earnings, news, or macro catalyst with real numbers"
  },
  "nextCatalyst": { "time": "8:30 AM ET", "event": "The single most market-moving scheduled event in the next 24 hours with consensus estimate", "implication": "1-2 sentences: what a hot vs in-line vs cool result means for markets" },
  "positioning": {
    "overweight": [{ "asset": "Sector or asset name", "ticker": "ETF ticker", "rationale": "10-word reason grounded in today's real data" }],
    "neutral": [{ "asset": "...", "ticker": "...", "rationale": "..." }],
    "underweight": [{ "asset": "...", "ticker": "...", "rationale": "..." }]
  },
  "edgeBoardReasons": { "TICKER1": "10-word specific catalyst — earnings, news, or macro event" }
}

Rules:
- briefBullets: exactly 5 bullets. Search for today's TOP 5 most market-moving investment news stories (not just the indicators above). Rank by investor impact: Fed decisions/macro data > major earnings > sector catalysts > individual stocks. For each story, write: what = short specific headline with ticker/number (5-8 words); why = precise catalyst with real data; impact = 2-3 sentences on which sectors/ETFs win or lose, what it means for portfolios. These should be NEWS-DRIVEN, not just restatements of the indicator data above. The indicators provide context but the 5 bullets should be the 5 biggest stories of the day.
- outlier: must reference a real ticker or real number, not generic commentary
- liveHeadlines: HARD MINIMUM 6, TARGET 8. Search broadly for today's top market and investment news. Accept any reputable financial source — Bloomberg, Reuters, WSJ, FT, CNBC, AP, MarketWatch, Yahoo Finance, Barron's, Forbes, Seeking Alpha, The Economist, NPR Markets, etc. ONLY exclude obvious spam/PR: PR Newswire, Stock Titan, GuruFocus, GlobeNewsWire company press releases. Impact score — be GENEROUS, most real market news scores 6+: 9-10 = Fed decision, CPI/jobs/GDP print, major geopolitical shock affecting markets; 7-8 = earnings from any S&P 500 company, macro economic data, sector-wide catalyst, rate/yield move, commodity shock; 5-6 = notable individual stock move, mid-cap earnings, analyst upgrade/downgrade on major name. Score 5 minimum for any headline that would appear in a morning market briefing. DO NOT self-filter — return all 6-8 sorted by impactScore descending. Each must have a one-sentence "impact" field. No url field
- bigStory: the ticker is already set above — write only the reason field by searching for news
- nextCatalyst: check economic calendar for the next 24 hours
- positioning: 1-3 items per category, grounded in the real sector data above
- edgeBoardReasons: for EVERY ticker in today's top gainers and top losers, you MUST search "[TICKER] stock news today" before writing a reason. Write a specific ~10-word catalyst with a real number or event name. Only use "No public catalyst found" if you searched and found nothing — never skip the search step
- DO NOT invent prices, percentages, or market levels — use only the real data provided above`;

    const narrativeResp = await ai.models.generateContent({
      model, contents: narrativePrompt,
      config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
    });
    const narrativeRaw = narrativeResp.text || '{}';
    const narrativeJsonMatch = narrativeRaw.match(/```(?:json)?\s*([\s\S]*?)```/)
      ?? narrativeRaw.match(/(\{[\s\S]*\})/);
    if (!narrativeJsonMatch) {
      console.error('[runLiveRefresh] No JSON block in LLM response:', narrativeRaw.slice(0, 300));
      throw new Error('runLiveRefresh: LLM response contained no JSON block');
    }
    const parsedNarrative = JSON.parse(narrativeJsonMatch[1]);
    const narrativeValidation = LiveNarrativeSchema.safeParse(parsedNarrative);
    if (!narrativeValidation.success) {
      console.error('[runLiveRefresh] Schema validation failed:', narrativeValidation.error.format(), '\nRaw:', narrativeRaw.slice(0, 500));
      throw new Error(`runLiveRefresh: invalid narrative shape — ${narrativeValidation.error.issues[0]?.message}`);
    }
    const narrative = narrativeValidation.data;

    // Derive scoring fields
    const spyDirection: 'Up' | 'Down' = (spyData.changePercent ?? 0) >= 0 ? 'Up' : 'Down';
    const vixChangeActual = vixData?.level != null && vixData?.previousClose != null && vixData.previousClose !== 0
      ? Math.round(((vixData.level - vixData.previousClose) / vixData.previousClose) * 10000) / 100
      : null;
    const elite6 = {
      fearGreed: { score: fgScore, label: fgLabel, delta: fgDelta, description: `Market Sentiment: ${fgScore}/100 — ${fgLabel}` },
      spyTrend: {
        direction: spyData.direction,
        changePercent: spyData.changePercent ?? 0,
        above200MA: spyData.above200MA ?? true,
        above50MA: spyData.above50MA ?? true,
        volumeRatio: spyData.volumeRatio,
        description: `SPY ${spyData.changePercent != null ? `${spyData.changePercent > 0 ? '+' : ''}${spyData.changePercent}%` : 'flat'} today`,
      },
      sectorRotation: leaderSector && laggerSector ? {
        leader: { sector: leaderSector.sector, ticker: leaderSector.ticker, performance: `${leaderSector.changePercent > 0 ? '+' : ''}${leaderSector.changePercent}%` },
        lagger: { sector: laggerSector.sector, ticker: laggerSector.ticker, performance: `${laggerSector.changePercent > 0 ? '+' : ''}${laggerSector.changePercent}%` },
        implication: `${leaderSector.sector} leads, ${laggerSector.sector} lags`,
      } : null,
      optionsPulse: { putCallRatio: pcRatio, lean: pcLean as 'Bullish' | 'Neutral' | 'Bearish', description: `SPY put/call ${pcRatio} — ${pcLean} lean` },
      // Scoring fields
      spyDirection,
      spyChangePercent: spyData.changePercent ?? 0,
      vixDirection: vixData?.direction ?? null,
      vixChangePercent: vixChangeActual,
      // topMover actual data — predictedTickerChange/predictedTickerWasTop3 filled in by scorePreviousDay
      topMover: {
        actualTopTicker: movers.gainers[0]?.ticker ?? null,
        actualTopChange: movers.gainers[0]?.changePercent ?? null,
        actualTopLoser: movers.losers[0]?.ticker ?? null,
      },
      // Top 3 gainers for "was top 3" check in scorePreviousDay
      topMoverActualTop1: movers.gainers[0]?.ticker ?? null,
      topMoverActualTop2: movers.gainers[1]?.ticker ?? null,
      topMoverActualTop3: movers.gainers[2]?.ticker ?? null,
      bigStory: narrative.bigStory ?? (topMover ? { ticker: topMover.ticker, name: topMover.name, changePercent: topMover.change, direction: topMover.changePercent >= 0 ? 'Up' : 'Down', reason: 'Top market mover today' } : null),
      nextCatalyst: narrative.nextCatalyst ?? null,
    };

    const weather = buildWeather(spyData.changePercent, fgScore, leaderSector, laggerSector, spyData.volumeRatio);

    if (elite6.spyTrend) {
      await sql`
        UPDATE market_daily_records
        SET elite6_actual = ${JSON.stringify(elite6)},
            brief_bullets = ${JSON.stringify(narrative.briefBullets ?? [])},
            outlier = ${narrative.outlier ?? ''},
            catalyst = ${narrative.catalyst ?? ''},
            weather = ${JSON.stringify(weather)},
            live_headlines = ${JSON.stringify(narrative.liveHeadlines ?? [])},
            edge_board = ${JSON.stringify(buildEdgeBoard(movers, (narrative.edgeBoardReasons as Record<string, string>) ?? {}))}::jsonb,
            positioning = ${narrative.positioning ? JSON.stringify(narrative.positioning) : null}::jsonb,
            updated_at = now()
        WHERE record_date = ${todayET}
      `;
    }
  } catch (err) {
    console.error('[tripleCard] Live data error:', err);
  }
}

// ── Handler: tripleCard ───────────────────────────────────────────────────────
export async function handleTripleCard(ctx: HandlerCtx): Promise<NextResponse> {
  const { ai, model } = ctx;
  const sql = db();
  const todayET = getTodayET();

  await sql`INSERT INTO market_daily_records (record_date) VALUES (${todayET}) ON CONFLICT (record_date) DO NOTHING`;
  const [todayResult, prevResult] = await Promise.all([
    sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`,
    sql`SELECT * FROM market_daily_records WHERE record_date < ${todayET} AND is_noon_locked = true ORDER BY record_date DESC LIMIT 1`,
  ]);
  const yesterdayResult = prevResult;
  const yesterdayET: string = prevResult[0]?.record_date ? String(prevResult[0].record_date).slice(0, 10) : getYesterdayET();
  let todayRow = todayResult[0];
  const yesterdayRow = yesterdayResult[0] ?? null;

  // Schema invalidation — detect rows that lack topMover field (previous schema)
  if (todayRow.elite6_actual && !(todayRow.elite6_actual as Record<string, unknown>).topMoverActualTop1) {
    await sql`UPDATE market_daily_records SET elite6_actual = NULL, updated_at = NULL, brief_bullets = NULL, live_headlines = NULL WHERE record_date = ${todayET}`;
    todayRow = { ...todayRow, elite6_actual: null, updated_at: null, brief_bullets: null, live_headlines: null };
  }
  if (todayRow.tomorrow_predictions && !(todayRow.tomorrow_predictions as Record<string, unknown>).topMover) {
    await sql`UPDATE market_daily_records SET tomorrow_predictions = NULL, is_noon_locked = false, noon_locked_at = NULL WHERE record_date = ${todayET}`;
    todayRow = { ...todayRow, tomorrow_predictions: null, is_noon_locked: false, noon_locked_at: null };
  }
  // Force refresh if headlines are missing or fewer than 5 (bad prior generation)
  const storedHeadlines = todayRow.live_headlines as unknown[] | null;
  if (todayRow.elite6_actual && (!storedHeadlines || storedHeadlines.length < 5)) {
    await sql`UPDATE market_daily_records SET updated_at = NULL WHERE record_date = ${todayET}`;
    todayRow = { ...todayRow, updated_at: null };
  }

  const updatedAt = todayRow.updated_at ? new Date(todayRow.updated_at).getTime() : 0;
  const twentyMinAgo = Date.now() - 20 * 60 * 1000;
  const missingSectorData = !!(todayRow.elite6_actual && !(todayRow.elite6_actual as Record<string, unknown>).sectorRotation);
  const isLiveDataStale = !todayRow.elite6_actual || updatedAt < twentyMinAgo || missingSectorData;
  const noonLockPending = isAfterNoonET() && !todayRow.is_noon_locked;

  // Early return if data exists — client calls refreshLive for stale/pending work
  if (todayRow.elite6_actual) {
    const hist30 = await sql`
      SELECT accuracy_breakdown, user_accuracy_correct
      FROM market_daily_records
      WHERE record_date < ${todayET}
      ORDER BY record_date DESC LIMIT 30
    `;
    const { rollingAccuracy, modelStreak, userStreak } = computeRollingAccuracy(hist30 as Array<{ accuracy_breakdown: unknown; user_accuracy_correct: unknown }>);
    return NextResponse.json({
      success: true,
      data: {
        yesterday: yesterdayRow ? rowToRecord(yesterdayRow) : null,
        today: rowToRecord(todayRow),
        isLiveDataStale,
        needsRefresh: isLiveDataStale || noonLockPending,
        lastRefreshed: todayRow.updated_at ? String(todayRow.updated_at) : new Date().toISOString(),
        rollingAccuracy,
        modelStreak,
        userStreak,
      },
    });
  }

  // First-ever load: run everything synchronously
  await runAccuracyCalc(sql, yesterdayRow, todayRow, yesterdayET);

  if (isAfterNoonET() && !todayRow.is_noon_locked) {
    await runNoonLock(sql, todayET, ai, model);
    const fresh = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
    if (fresh[0]) todayRow = fresh[0];
  }

  await runLiveRefresh(sql, todayET, ai, model);

  const refreshedResult = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
  const finalRow = refreshedResult[0] ?? todayRow;
  const finalUpdatedAt = finalRow.updated_at ? new Date(finalRow.updated_at).getTime() : 0;
  const finalIsStale = !finalRow.elite6_actual || finalUpdatedAt < twentyMinAgo;

  const hist30Final = await sql`
    SELECT accuracy_breakdown, user_accuracy_correct
    FROM market_daily_records
    WHERE record_date < ${todayET}
    ORDER BY record_date DESC LIMIT 30
  `;
  const { rollingAccuracy: rollingAccuracyFinal, modelStreak: modelStreakFinal, userStreak: userStreakFinal } = computeRollingAccuracy(hist30Final as Array<{ accuracy_breakdown: unknown; user_accuracy_correct: unknown }>);

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

// ── Handler: refreshLive ──────────────────────────────────────────────────────
export async function handleRefreshLive(ctx: HandlerCtx): Promise<NextResponse> {
  const { ai, model } = ctx;
  const sql = db();
  const todayET = getTodayET();

  const [todayResult, prevResult2] = await Promise.all([
    sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`,
    sql`SELECT * FROM market_daily_records WHERE record_date < ${todayET} AND is_noon_locked = true ORDER BY record_date DESC LIMIT 1`,
  ]);
  const yesterdayResult = prevResult2;
  const yesterdayET: string = prevResult2[0]?.record_date ? String(prevResult2[0].record_date).slice(0, 10) : getYesterdayET();
  let todayRow = todayResult[0];
  const yesterdayRow = yesterdayResult[0] ?? null;

  if (!todayRow) return NextResponse.json({ success: false, error: 'No record for today' }, { status: 404 });

  const twentyMinAgo = Date.now() - 20 * 60 * 1000;

  // Schema invalidation — detect rows that lack topMover field (previous schema)
  if (todayRow.elite6_actual && !(todayRow.elite6_actual as Record<string, unknown>).topMoverActualTop1) {
    await sql`UPDATE market_daily_records SET elite6_actual = NULL, updated_at = NULL, brief_bullets = NULL, live_headlines = NULL WHERE record_date = ${todayET}`;
    todayRow = { ...todayRow, elite6_actual: null, updated_at: null, brief_bullets: null, live_headlines: null };
  }
  if (todayRow.tomorrow_predictions && !(todayRow.tomorrow_predictions as Record<string, unknown>).topMover) {
    await sql`UPDATE market_daily_records SET tomorrow_predictions = NULL, is_noon_locked = false, noon_locked_at = NULL WHERE record_date = ${todayET}`;
    todayRow = { ...todayRow, tomorrow_predictions: null, is_noon_locked: false, noon_locked_at: null };
  }
  // Force refresh if headlines are missing or fewer than 5 (bad prior generation)
  const storedHeadlines2 = todayRow.live_headlines as unknown[] | null;
  if (todayRow.elite6_actual && (!storedHeadlines2 || storedHeadlines2.length < 5)) {
    await sql`UPDATE market_daily_records SET updated_at = NULL WHERE record_date = ${todayET}`;
    todayRow = { ...todayRow, updated_at: null };
  }

  await runAccuracyCalc(sql, yesterdayRow, todayRow, yesterdayET);

  if (isAfterNoonET() && !todayRow.is_noon_locked) {
    await runNoonLock(sql, todayET, ai, model);
    const fresh = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
    if (fresh[0]) todayRow = fresh[0];
  }

  const updatedAt = todayRow.updated_at ? new Date(todayRow.updated_at).getTime() : 0;
  const missingSectorData = !!(todayRow.elite6_actual && !(todayRow.elite6_actual as Record<string, unknown>).sectorRotation);
  const needsLiveRefresh = !todayRow.elite6_actual || updatedAt < twentyMinAgo || missingSectorData;
  if (needsLiveRefresh) {
    await runLiveRefresh(sql, todayET, ai, model);
  }

  const freshResult = await sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`;
  const freshRow = freshResult[0] ?? todayRow;
  const freshUpdatedAt = freshRow.updated_at ? new Date(freshRow.updated_at).getTime() : 0;
  const freshIsStale = !freshRow.elite6_actual || freshUpdatedAt < twentyMinAgo;

  const freshYestResult = await sql`SELECT * FROM market_daily_records WHERE record_date = ${yesterdayET}`;
  const freshYestRow = freshYestResult[0] ?? yesterdayRow;

  // Rolling accuracy + streaks
  const last30 = await sql`
    SELECT accuracy_breakdown, user_accuracy_correct
    FROM market_daily_records
    WHERE record_date < ${todayET}
    ORDER BY record_date DESC LIMIT 30
  `;
  const { rollingAccuracy, modelStreak, userStreak } = computeRollingAccuracy(last30 as Array<{ accuracy_breakdown: unknown; user_accuracy_correct: unknown }>);

  return NextResponse.json({
    success: true,
    data: {
      yesterday: freshYestRow ? rowToRecord(freshYestRow) : null,
      today: rowToRecord(freshRow),
      isLiveDataStale: freshIsStale,
      needsRefresh: false,
      lastRefreshed: freshRow.updated_at ? String(freshRow.updated_at) : new Date().toISOString(),
      rollingAccuracy,
      modelStreak,
      userStreak,
    },
  });
}

// ── Exported: score yesterday's prediction against today's actuals ─────────────
// Called by the after-close cron (21:05 UTC / 5:05 PM ET) directly — no HTTP round-trip.
export async function scorePreviousDay(
  sql: ReturnType<typeof db>,
  ai?: import('@google/genai').GoogleGenAI,
  model?: string,
): Promise<{ scored: boolean; date?: string; score?: number }> {
  const todayET = getTodayET();
  const [todayResult, prevTradingResult] = await Promise.all([
    sql`SELECT elite6_actual FROM market_daily_records WHERE record_date = ${todayET}`,
    sql`SELECT record_date, tomorrow_predictions, accuracy_score FROM market_daily_records WHERE record_date < ${todayET} AND is_noon_locked = true ORDER BY record_date DESC LIMIT 1`,
  ]);
  const todayRow = todayResult[0];
  const yesterdayRow = prevTradingResult[0];
  if (!yesterdayRow?.tomorrow_predictions || yesterdayRow.accuracy_score != null || !todayRow?.elite6_actual) {
    return { scored: false };
  }
  const yesterdayET: string = String(yesterdayRow.record_date).slice(0, 10);

  const pred = yesterdayRow.tomorrow_predictions as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual: Record<string, unknown> = { ...(todayRow.elite6_actual as any) };

  // Fetch the predicted ticker's actual closing performance and enrich topMover actual
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const predTopMover = pred.topMover as any;
  const predTicker = predTopMover?.ticker as string | undefined;
  if (predTicker) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const yahooFinance = require('yahoo-finance2').default;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const quote = await (yahooFinance.quote(predTicker) as Promise<any>).catch(() => null);
      const tickerChange = quote?.regularMarketChangePercent != null
        ? Math.round(quote.regularMarketChangePercent * 100) / 100
        : null;
      const top3Tickers = [
        actual.topMoverActualTop1,
        actual.topMoverActualTop2,
        actual.topMoverActualTop3,
      ].filter(Boolean) as string[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      actual.topMover = {
        ...((actual.topMover as Record<string, unknown>) ?? {}),
        predictedTickerChange: tickerChange,
        predictedTickerWasTop3: top3Tickers.includes(predTicker),
      };
    } catch {
      // scoring without ticker data — topMover will score 0
    }
  }

  const { score, breakdown } = scoreAccuracy(pred, actual);

  // Generate a brief recap of what happened and why predictions were right/wrong
  let accuracyBrief: string | null = null;
  if (ai && model) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = pred as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = actual as any;
      const spyPredDir = p.spyDirection ?? '?';
      const spyPredPct = p.spyChangePercent != null ? `${p.spyChangePercent > 0 ? '+' : ''}${Number(p.spyChangePercent).toFixed(1)}%` : '?';
      const spyActualDir = a.spyDirection ?? '?';
      const spyActualPct = a.spyChangePercent != null ? `${a.spyChangePercent > 0 ? '+' : ''}${Number(a.spyChangePercent).toFixed(1)}%` : '?';
      const vixPredDir = p.vixDirection ?? '?';
      const vixPredPct = p.vixChangePercent != null ? `${p.vixChangePercent > 0 ? '+' : ''}${Number(p.vixChangePercent).toFixed(1)}%` : '?';
      const vixActualDir = a.vixDirection ?? '?';
      const vixActualPct = a.vixChangePercent != null ? `${a.vixChangePercent > 0 ? '+' : ''}${Number(a.vixChangePercent).toFixed(1)}%` : '?';
      const topMoverTicker = p.topMover?.ticker ?? '?';
      const topMoverPredDir = p.topMover?.direction ?? '?';
      const topMoverPredPct = p.topMover?.changePercent != null ? `${p.topMover.changePercent > 0 ? '+' : ''}${Number(p.topMover.changePercent).toFixed(1)}%` : '?';
      const topMoverActualPct = a.topMover?.predictedTickerChange != null ? `${a.topMover.predictedTickerChange > 0 ? '+' : ''}${Number(a.topMover.predictedTickerChange).toFixed(1)}%` : 'N/A';
      const topMoverWasTop3 = a.topMover?.predictedTickerWasTop3 ? 'yes' : 'no';
      const overallScore = score;
      const spyScore = (breakdown as Record<string, number>).spy ?? 0;
      const vixScore = (breakdown as Record<string, number>).vix ?? 0;
      const topMoverScore = (breakdown as Record<string, number>).topMover ?? 0;

      const briefPrompt = `You are writing a brief market recap for ${yesterdayET} (the trading day just closed).

Our predictions vs actuals:
- SPY: predicted ${spyPredDir} ${spyPredPct} → actual ${spyActualDir} ${spyActualPct} (score: ${spyScore}/100)
- VIX: predicted ${vixPredDir} ${vixPredPct} → actual ${vixActualDir} ${vixActualPct} (score: ${vixScore}/100)
- Top Mover (${topMoverTicker}): predicted ${topMoverPredDir} ${topMoverPredPct} → actual ${topMoverActualPct}, was top-3 mover: ${topMoverWasTop3} (score: ${topMoverScore}/100)
- Overall accuracy score: ${overallScore}/100

Write 2-3 sentences (no lists, no headers) that:
1. Briefly state what the market did (SPY direction/magnitude, any notable VIX move)
2. Explain why our predictions were right or wrong on each indicator
3. Mention any major market driver that influenced the session (earnings surprise, Fed comment, macro data, geopolitical, etc.) if it explains the moves

Be concise, factual, and written in the tone of a professional market analyst. Do not mention scores or numbers from the scoring system. Do not start with "Today" or "Yesterday" — start with the actual driver or market action.`;

      const resp = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: briefPrompt }] }],
      });
      accuracyBrief = resp.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
    } catch {
      // brief is non-critical — scoring still saves without it
    }
  }

  await sql`
    UPDATE market_daily_records
    SET accuracy_score = ${score},
        accuracy_breakdown = ${JSON.stringify(breakdown)},
        accuracy_calculated_at = NOW()
        ${accuracyBrief != null ? sql`, accuracy_brief = ${accuracyBrief}` : sql``}
    WHERE record_date = ${yesterdayET}
  `;
  return { scored: true, date: yesterdayET, score };
}
