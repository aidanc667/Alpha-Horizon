// ─── Pure market-scoring helpers ─────────────────────────────────────────────
// Extracted from route.ts so they can be unit-tested without Next.js/Clerk deps.

// ─── Adaptive signal weights ──────────────────────────────────────────────────
// Updated automatically after each accuracy calculation. Lower weight = system
// has learned this signal category has been underperforming recently.
export interface SignalWeights {
  fearGreed: number;    // 0.4–1.4
  spyTrend: number;
  optionsPulse: number;
}

export const DEFAULT_SIGNAL_WEIGHTS: SignalWeights = {
  fearGreed: 1.0,
  spyTrend: 1.0,
  optionsPulse: 1.0,
};

export function computeWeightAdjustment(rolling: {
  // New model fields
  spy?: number | null;
  vix?: number | null;
  topMover?: number | null;
  // Legacy fields (still accepted for backward compat)
  fearGreed?: number | null;
  spyTrend?: number | null;
  optionsPulse?: number | null;
  daysScored: number;
}): SignalWeights {
  if (rolling.daysScored < 5) return DEFAULT_SIGNAL_WEIGHTS;

  const adjust = (acc: number | null | undefined): number => {
    if (acc == null) return 1.0;
    if (acc < 35) return 0.4;
    if (acc < 45) return 0.6;
    if (acc < 55) return 0.8;
    if (acc < 65) return 1.0;
    if (acc < 75) return 1.2;
    return 1.4;
  };

  return {
    fearGreed:    adjust(rolling.fearGreed ?? null),
    spyTrend:     adjust(rolling.spy ?? rolling.spyTrend ?? null),
    optionsPulse: adjust(rolling.optionsPulse ?? null),
  };
}

export interface SectorQuote {
  ticker: string;
  sector: string;
  changePercent: number;
}

// ─── scoreAccuracy ────────────────────────────────────────────────────────────
// All inputs are typed loosely (any) to match what comes out of the DB.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scoreAccuracy(
  pred: any,
  actual: any,
): {
  score: number;
  breakdown: { spy: number; vix: number; topMover: number };
} {
  // ── SPY (0–100) ───────────────────────────────────────────────────────────
  const spyDirMatch = pred.spyDirection === actual.spyDirection;
  let spy = 0;
  if (spyDirMatch) {
    const magDiff = Math.abs((pred.spyChangePercent ?? 0) - (actual.spyChangePercent ?? 0));
    spy = 60 + (magDiff <= 0.3 ? 40 : magDiff <= 0.7 ? 25 : magDiff <= 1.5 ? 10 : 0);
  }

  // ── VIX (0–100) ──────────────────────────────────────────────────────────
  const vixDirMatch = !!pred.vixDirection && pred.vixDirection === actual.vixDirection;
  let vix = 0;
  if (vixDirMatch) {
    const magDiff = Math.abs((pred.vixChangePercent ?? 0) - (actual.vixChangePercent ?? 0));
    vix = 60 + (magDiff <= 5 ? 40 : magDiff <= 15 ? 25 : magDiff <= 30 ? 10 : 0);
  }

  // ── Top Mover (0–100) ────────────────────────────────────────────────────
  // actual.topMover contains: { actualTopTicker, actualChangePercent, predictedTickerChange, predictedTickerWasTop3 }
  let topMover = 0;
  const predDir = pred.topMover?.direction;
  const actualChange = actual.topMover?.predictedTickerChange ?? null;
  if (predDir && actualChange != null) {
    const actualDir = actualChange >= 0 ? 'Up' : 'Down';
    if (predDir === actualDir) {
      const magnitude = Math.abs(actualChange);
      const magScore = magnitude >= 5 ? 40 : magnitude >= 3 ? 30 : magnitude >= 1.5 ? 15 : 5;
      const bonusTop3 = actual.topMover?.predictedTickerWasTop3 ? 10 : 0;
      topMover = Math.min(100, 50 + magScore + bonusTop3);
    }
  }

  const score = Math.round((spy + vix + topMover) / 3);
  return { score, breakdown: { spy, vix, topMover } };
}

// ─── buildWeather ─────────────────────────────────────────────────────────────
// Conditions:
//   Sunny  — SPY ≥ +0.5% with normal+ volume, or SPY > 0 & F&G ≥ 65
//   Stormy — SPY ≤ −0.5% with normal+ volume, or SPY < 0 & F&G ≤ 30
//   Overcast — everything else (includes low-volume drifts either direction)
export function buildWeather(
  spyPct: number | null,
  fgScore: number,
  leaderSector?: SectorQuote,
  laggerSector?: SectorQuote,
  volumeRatio?: number | null,
): { condition: 'sunny' | 'overcast' | 'stormy'; emoji: '☀️' | '☁️' | '⛈️'; label: 'Sunny' | 'Overcast' | 'Stormy'; description: string } {
  const pct = spyPct ?? 0;
  // Low-volume moves (< 0.75x avg) are drifts, not broad advances or selloffs
  const hasVolume = volumeRatio == null || volumeRatio >= 0.75;
  const isSunny = (pct >= 0.5 && hasVolume) || (pct > 0 && fgScore >= 65);
  const isStormy = (pct <= -0.5 && hasVolume) || (pct < 0 && fgScore <= 30);

  const fgLabel =
    fgScore <= 20 ? 'Extreme Fear' :
    fgScore <= 40 ? 'Fear' :
    fgScore <= 60 ? 'Neutral' :
    fgScore <= 80 ? 'Greed' : 'Extreme Greed';

  const spyStr = pct === 0 ? 'flat' : `${pct > 0 ? '+' : ''}${pct}%`;
  const volStr = volumeRatio != null ? ` on ${volumeRatio}x average volume` : '';
  const sectorStr = leaderSector && laggerSector
    ? `${leaderSector.sector} leads (${leaderSector.changePercent > 0 ? '+' : ''}${leaderSector.changePercent}%), ${laggerSector.sector} lags (${laggerSector.changePercent > 0 ? '+' : ''}${laggerSector.changePercent}%)`
    : '';

  if (isSunny) {
    const desc = sectorStr
      ? `SPY ${spyStr}${volStr} with broad buying; ${sectorStr}; Fear & Greed at ${fgScore} (${fgLabel}).`
      : `SPY ${spyStr}${volStr} with broad buying pressure; Fear & Greed at ${fgScore} (${fgLabel}).`;
    return { condition: 'sunny', emoji: '☀️', label: 'Sunny', description: desc };
  }
  if (isStormy) {
    const desc = sectorStr
      ? `SPY ${spyStr}${volStr} with broad selling; ${sectorStr}; Fear & Greed at ${fgScore} (${fgLabel}).`
      : `SPY ${spyStr}${volStr} with broad selling pressure; Fear & Greed at ${fgScore} (${fgLabel}).`;
    return { condition: 'stormy', emoji: '⛈️', label: 'Stormy', description: desc };
  }
  const driftDesc = volumeRatio != null && volumeRatio < 0.75 ? `low-conviction drift${volStr}` : 'mixed signals';
  const desc = sectorStr
    ? `SPY ${spyStr}, ${driftDesc}; ${sectorStr}; Fear & Greed at ${fgScore} (${fgLabel}).`
    : `SPY ${spyStr}, ${driftDesc}; Fear & Greed at ${fgScore} (${fgLabel}).`;
  return { condition: 'overcast', emoji: '☁️', label: 'Overcast', description: desc };
}

// ─── computePredictionSignals ─────────────────────────────────────────────────
export interface PredictionSignals {
  signals: string[];
  bias: 'Bullish' | 'Bearish' | 'Neutral';
  confidence: 'High' | 'Moderate' | 'Low';
  bullCount: number;
  bearCount: number;
}

export function computePredictionSignals(
  spyData: { changePercent: number | null; above200MA: boolean | null; above50MA: boolean | null },
  fgScore: number,
  fgDelta: number,
  pcRatio: number,
  // Injected for testability; defaults to current time in production
  now: Date = new Date(),
  weights: SignalWeights = DEFAULT_SIGNAL_WEIGHTS,
): PredictionSignals {
  const signals: string[] = [];
  let bullScore = 0, bearScore = 0;
  let bullCount = 0, bearCount = 0;

  // F&G momentum (delta from yesterday) — weighted by fearGreed accuracy
  if (fgDelta > 5) {
    signals.push(`F&G rising +${fgDelta} pts → momentum continuation`);
    bullScore += weights.fearGreed; bullCount++;
  } else if (fgDelta < -5) {
    signals.push(`F&G falling ${fgDelta} pts → momentum continuation`);
    bearScore += weights.fearGreed; bearCount++;
  }

  // F&G extremes → mean reversion
  if (fgScore >= 80) {
    signals.push(`F&G at ${fgScore} (Extreme Greed) → mean reversion risk`);
    bearScore += weights.fearGreed; bearCount++;
  } else if (fgScore <= 20) {
    signals.push(`F&G at ${fgScore} (Extreme Fear) → bounce potential`);
    bullScore += weights.fearGreed; bullCount++;
  }

  // SPY MA position — weighted by spyTrend accuracy
  if (spyData.above200MA && spyData.above50MA) {
    signals.push('SPY above both 200MA & 50MA → uptrend intact');
    bullScore += weights.spyTrend; bullCount++;
  } else if (spyData.above200MA === false && spyData.above50MA === false) {
    signals.push('SPY below both 200MA & 50MA → downtrend in force');
    bearScore += weights.spyTrend; bearCount++;
  } else if (spyData.above200MA && spyData.above50MA === false) {
    signals.push('SPY below 50MA but above 200MA → consolidation zone');
  }

  // Put/call ratio signal — weighted by optionsPulse accuracy
  if (pcRatio < 0.65) {
    signals.push(`Put/call ${pcRatio} — heavy call buying, complacency signal (bullish)`);
    bullScore += weights.optionsPulse; bullCount++;
  } else if (pcRatio >= 0.9 && pcRatio < 1.1) {
    signals.push(`Put/call ${pcRatio} — hedging picking up, mildly bearish lean`);
    bearScore += weights.optionsPulse; bearCount++;
  } else if (pcRatio >= 1.1) {
    signals.push(`Put/call ${pcRatio} — elevated put buying, fear/protection signal (bearish)`);
    bearScore += weights.optionsPulse; bearCount++;
  }

  // Day of week (fixed 1.0 — not tied to category accuracy)
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dow = tomorrow.getDay();
  if (dow === 5) { signals.push('Tomorrow is Friday → profit-taking and position-squaring risk'); bearScore += 1.0; bearCount++; }
  else if (dow === 1) { signals.push('Tomorrow is Monday → fresh week positioning often risk-on'); bullScore += 1.0; bullCount++; }

  // Today's SPY momentum — weighted by spyTrend accuracy
  const pct = spyData.changePercent ?? 0;
  if (pct > 1.0) {
    signals.push(`SPY up +${pct}% today → strong momentum, continuation bias`);
    bullScore += weights.spyTrend; bullCount++;
  } else if (pct < -1.0) {
    signals.push(`SPY down ${pct}% today → strong selling, continuation risk`);
    bearScore += weights.spyTrend; bearCount++;
  }

  const diff = bullScore - bearScore;
  const bias: PredictionSignals['bias'] = diff > 0.3 ? 'Bullish' : diff < -0.3 ? 'Bearish' : 'Neutral';
  const absDiff = Math.abs(diff);
  const confidence: PredictionSignals['confidence'] =
    absDiff >= 2.0 ? 'High' : absDiff >= 0.9 ? 'Moderate' : 'Low';

  return { signals, bias, confidence, bullCount, bearCount };
}

// ─── rowToRecord ──────────────────────────────────────────────────────────────
// Maps a snake_case DB row to a camelCase DailyMarketRecord.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToRecord(row: any) {
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
    accuracyBrief: row.accuracy_brief ?? null,
    edgeBoard: row.edge_board ?? null,
    positioning: row.positioning ?? null,
    userSpyPrediction: row.user_spy_prediction ?? null,
    userPredictionLockedAt: row.user_prediction_locked_at ? String(row.user_prediction_locked_at) : null,
    userAccuracyCorrect: row.user_accuracy_correct != null ? Boolean(row.user_accuracy_correct) : null,
  };
}
