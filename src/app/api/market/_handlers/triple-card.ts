import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { scoreAccuracy, buildWeather, computePredictionSignals, computeWeightAdjustment } from '@/lib/market/scoring';
import { rowToRecord } from '@/lib/market/scoring';
import {
  fetchSPYPutCallRatio, fetchSPYData, fetchFearAndGreed, fetchSectorData, fetchMarketMovers,
  getTodayET, getYesterdayET, isAfterNoonET, getCurrentDate,
  computeRollingAccuracy, buildEdgeBoard, loadSignalWeights, saveSignalWeights,
} from '../_lib';
import type { HandlerCtx } from '../_lib';

// ── Shared helper: accuracy calculation ──────────────────────────────────────
async function runAccuracyCalc(
  sql: ReturnType<typeof db>,
  yesterdayRow: Record<string, unknown>,
  todayRow: Record<string, unknown>,
  yesterdayET: string,
) {
  if (!yesterdayRow?.tomorrow_predictions || yesterdayRow.accuracy_score != null || !todayRow?.elite6_actual) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const predConfidence = (yesterdayRow.tomorrow_predictions as any)?.confidence as 'High' | 'Moderate' | 'Low' | undefined;
    const { score, breakdown } = scoreAccuracy(
      yesterdayRow.tomorrow_predictions as Record<string, unknown>,
      todayRow.elite6_actual as Record<string, unknown>,
      predConfidence,
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
    const avgBreakdown: Record<string, number[]> = { fearGreed: [], spyTrend: [], sectorRotation: [], optionsPulse: [] };
    for (const r of recentScores) {
      const ab = r.accuracy_breakdown as Record<string, number> | null;
      if (!ab) continue;
      for (const key of Object.keys(avgBreakdown)) {
        if (ab[key] != null) avgBreakdown[key].push(Number(ab[key]));
      }
    }
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b) / arr.length) : null;
    const calibration = recentScores.length >= 3
      ? `\nCALIBRATION (your recent 7-day accuracy — self-correct for known biases):\n- Fear & Greed: ${avg(avgBreakdown.fearGreed) ?? 'N/A'}% accurate\n- SPY Trend: ${avg(avgBreakdown.spyTrend) ?? 'N/A'}% accurate\n- Sector: ${avg(avgBreakdown.sectorRotation) ?? 'N/A'}% accurate\n- Options Pulse: ${avg(avgBreakdown.optionsPulse) ?? 'N/A'}% accurate\nAdjust your predictions to compensate for any indicator where accuracy is below 60%.\nADAPTIVE WEIGHTS (system-computed from accuracy history):\n- Fear & Greed signals: ${(currentWeights.fearGreed * 100).toFixed(0)}% weight\n- SPY Trend signals: ${(currentWeights.spyTrend * 100).toFixed(0)}% weight\n- Options Flow signals: ${(currentWeights.optionsPulse * 100).toFixed(0)}% weight\nSignals below 80% weight are underperforming historically — be more skeptical of them.\n`
      : '';

    const predSpyData = await fetchSPYData();
    const predFgData = await fetchFearAndGreed();
    const predPcRatio = await fetchSPYPutCallRatio() ?? 0.74;
    const predSectors = await fetchSectorData();
    const predSignals = computePredictionSignals(predSpyData, predFgData?.score ?? 50, predFgData?.delta ?? 0, predPcRatio, new Date(), currentWeights);

    const predPrompt = `You are a market prediction engine. Today is ${getCurrentDate()}.

REAL TODAY DATA (already fetched — do NOT re-search these numbers):
- SPY: ${predSpyData.changePercent != null ? `${predSpyData.changePercent > 0 ? '+' : ''}${predSpyData.changePercent}%` : 'flat'}, direction: ${predSpyData.direction}, above 200MA: ${predSpyData.above200MA}, above 50MA: ${predSpyData.above50MA}, volume: ${predSpyData.volumeRatio != null ? `${predSpyData.volumeRatio}x avg` : 'normal'}
- Fear & Greed: ${predFgData?.score ?? 50}/100 (${predFgData?.label ?? 'Neutral'}), delta ${predFgData?.delta ?? 0} from yesterday
- Sector leader today: ${predSectors?.leader ? `${predSectors.leader.ticker} ${predSectors.leader.changePercent > 0 ? '+' : ''}${predSectors.leader.changePercent}%` : 'N/A'}
- Sector lagger today: ${predSectors?.lagger ? `${predSectors.lagger.ticker} ${predSectors.lagger.changePercent > 0 ? '+' : ''}${predSectors.lagger.changePercent}%` : 'N/A'}
- SPY put/call ratio: ${predPcRatio}

QUANTITATIVE SIGNALS (anchor your predictions to these):
${predSignals.signals.map((s: string) => `- ${s}`).join('\n')}
SIGNAL BALANCE: ${predSignals.bullCount} bullish vs ${predSignals.bearCount} bearish → ${predSignals.confidence} Conviction ${predSignals.bias}

${calibration}
Using these signals as your foundation, search for any additional context (upcoming catalysts, news) and predict tomorrow's 4 key indicators. Return ONLY valid JSON:
{
  "tomorrowPredictions": {
    "fearGreed": { "score": 65, "label": "Greed", "delta": -3, "description": "Why this F&G prediction — cite signals above" },
    "spyTrend": { "direction": "Up", "changePercent": 0.5, "above200MA": ${predSpyData.above200MA ?? true}, "above50MA": ${predSpyData.above50MA ?? true}, "volumeRatio": null, "description": "Why this SPY prediction — cite signals above" },
    "sectorRotation": { "leader": { "sector": "Technology", "ticker": "XLK", "performance": "predicted +1.0%" }, "lagger": { "sector": "Energy", "ticker": "XLE", "performance": "predicted -0.5%" }, "implication": "Why this sector rotation — cite momentum or macro" },
    "optionsPulse": { "putCallRatio": 0.80, "lean": "Neutral", "description": "Why this options prediction" }
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
      model, contents: predPrompt,
      config: { tools: [{ googleSearch: {} }], temperature: 0.3 },
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
    const [realPutCall, spyData, fearGreedData, sectorData, movers] = await Promise.all([
      fetchSPYPutCallRatio(), fetchSPYData(), fetchFearAndGreed(), fetchSectorData(), fetchMarketMovers(),
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
    { "what": "Short headline naming the specific event (5-8 words, include actual ticker/number if relevant)", "why": "The precise data/catalyst that caused it with real numbers", "impact": "2-3 sentences: which sectors/ETFs win or lose, what this changes for Fed/earnings outlooks, what a practical investor should watch" }
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
- briefBullets: exactly 5 bullets — use the real numbers from the data above, search for additional context
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
    const narrativeJson = narrativeRaw.slice(narrativeRaw.indexOf('{'), narrativeRaw.lastIndexOf('}') + 1);
    const narrative = JSON.parse(narrativeJson);

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
  const yesterdayET = getYesterdayET();

  await sql`INSERT INTO market_daily_records (record_date) VALUES (${todayET}) ON CONFLICT (record_date) DO NOTHING`;
  const [todayResult, yesterdayResult] = await Promise.all([
    sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`,
    sql`SELECT * FROM market_daily_records WHERE record_date = ${yesterdayET}`,
  ]);
  let todayRow = todayResult[0];
  const yesterdayRow = yesterdayResult[0] ?? null;

  // Schema invalidation
  if (todayRow.elite6_actual && !(todayRow.elite6_actual as Record<string, unknown>).spyTrend) {
    await sql`UPDATE market_daily_records SET elite6_actual = NULL, updated_at = NULL WHERE record_date = ${todayET}`;
    todayRow = { ...todayRow, elite6_actual: null, updated_at: null };
  }
  if (todayRow.tomorrow_predictions && !(todayRow.tomorrow_predictions as Record<string, unknown>).spyTrend) {
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
  const yesterdayET = getYesterdayET();

  const [todayResult, yesterdayResult] = await Promise.all([
    sql`SELECT * FROM market_daily_records WHERE record_date = ${todayET}`,
    sql`SELECT * FROM market_daily_records WHERE record_date = ${yesterdayET}`,
  ]);
  let todayRow = todayResult[0];
  const yesterdayRow = yesterdayResult[0] ?? null;

  if (!todayRow) return NextResponse.json({ success: false, error: 'No record for today' }, { status: 404 });

  const twentyMinAgo = Date.now() - 20 * 60 * 1000;

  // Schema invalidation
  if (todayRow.elite6_actual && !(todayRow.elite6_actual as Record<string, unknown>).spyTrend) {
    await sql`UPDATE market_daily_records SET elite6_actual = NULL, updated_at = NULL WHERE record_date = ${todayET}`;
    todayRow = { ...todayRow, elite6_actual: null, updated_at: null };
  }
  if (todayRow.tomorrow_predictions && !(todayRow.tomorrow_predictions as Record<string, unknown>).spyTrend) {
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
