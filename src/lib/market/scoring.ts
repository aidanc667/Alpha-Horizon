// ─── Pure market-scoring helpers ─────────────────────────────────────────────
// Extracted from route.ts so they can be unit-tested without Next.js/Clerk deps.

export const SECTOR_CATS: Record<string, string> = {
  XLK: 'growth', XLC: 'growth', XLY: 'growth',
  XLF: 'value',  XLI: 'value',  XLB: 'value',  XLE: 'value',
  XLV: 'defensive', XLP: 'defensive', XLU: 'defensive', XLRE: 'defensive',
};

export interface SectorQuote {
  ticker: string;
  sector: string;
  changePercent: number;
}

// ─── scoreAccuracy ────────────────────────────────────────────────────────────
// All inputs are typed loosely (any) to match what comes out of the DB.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scoreAccuracy(pred: any, actual: any): {
  score: number;
  breakdown: { fearGreed: number; spyTrend: number; sectorRotation: number; optionsPulse: number };
} {
  // Fear & Greed: proximity (100 - abs diff), min 0
  const fearGreed = Math.max(0, 100 - Math.abs((pred.fearGreed?.score ?? 50) - (actual.fearGreed?.score ?? 50)));

  // SPY Trend: direction 60pts + magnitude proximity 40pts
  const dirMatch = pred.spyTrend?.direction === actual.spyTrend?.direction;
  const magDiff = Math.abs((pred.spyTrend?.changePercent ?? 0) - (actual.spyTrend?.changePercent ?? 0));
  const spyTrend = (dirMatch ? 60 : 0) + (magDiff <= 0.5 ? 40 : magDiff <= 1.0 ? 20 : 0);

  // Sector Rotation leader: exact ticker = 100, same category = 50, miss = 0
  const predLeader = pred.sectorRotation?.leader?.ticker ?? '';
  const actLeader = actual.sectorRotation?.leader?.ticker ?? '';
  const sectorRotation = predLeader === actLeader ? 100 :
    (SECTOR_CATS[predLeader] === SECTOR_CATS[actLeader] && SECTOR_CATS[predLeader] ? 50 : 0);

  // Options Pulse lean: exact = 100, adjacent = 50, opposite = 0
  const LEANS = ['Bullish', 'Neutral', 'Bearish'];
  const predLean = pred.optionsPulse?.lean ?? 'Neutral';
  const actLean = actual.optionsPulse?.lean ?? 'Neutral';
  const leanDiff = Math.abs(LEANS.indexOf(predLean) - LEANS.indexOf(actLean));
  const optionsPulse = leanDiff === 0 ? 100 : leanDiff === 1 ? 50 : 0;

  return {
    score: Math.round((fearGreed + spyTrend + sectorRotation + optionsPulse) / 4),
    breakdown: { fearGreed, spyTrend, sectorRotation, optionsPulse },
  };
}

// ─── buildWeather ─────────────────────────────────────────────────────────────
// Conditions:
//   Sunny  — SPY ≥ +0.5% (broad advance), or SPY > 0 & F&G ≥ 65 (greed + green)
//   Stormy — SPY ≤ −0.5% (broad decline), or SPY < 0 & F&G ≤ 30 (fear + red)
//   Overcast — everything else
export function buildWeather(
  spyPct: number | null,
  fgScore: number,
  leaderSector?: SectorQuote,
  laggerSector?: SectorQuote,
): { condition: 'sunny' | 'overcast' | 'stormy'; emoji: '☀️' | '☁️' | '⛈️'; label: 'Sunny' | 'Overcast' | 'Stormy'; description: string } {
  const pct = spyPct ?? 0;
  const isSunny = pct >= 0.5 || (pct > 0 && fgScore >= 65);
  const isStormy = pct <= -0.5 || (pct < 0 && fgScore <= 30);

  const fgLabel =
    fgScore <= 20 ? 'Extreme Fear' :
    fgScore <= 40 ? 'Fear' :
    fgScore <= 60 ? 'Neutral' :
    fgScore <= 80 ? 'Greed' : 'Extreme Greed';

  const spyStr = pct === 0 ? 'flat' : `${pct > 0 ? '+' : ''}${pct}%`;
  const sectorStr = leaderSector && laggerSector
    ? `${leaderSector.sector} leads (${leaderSector.changePercent > 0 ? '+' : ''}${leaderSector.changePercent}%), ${laggerSector.sector} lags (${laggerSector.changePercent > 0 ? '+' : ''}${laggerSector.changePercent}%)`
    : '';

  if (isSunny) {
    const desc = sectorStr
      ? `SPY ${spyStr} with broad buying; ${sectorStr}; Fear & Greed at ${fgScore} (${fgLabel}).`
      : `SPY ${spyStr} with broad buying pressure; Fear & Greed at ${fgScore} (${fgLabel}).`;
    return { condition: 'sunny', emoji: '☀️', label: 'Sunny', description: desc };
  }
  if (isStormy) {
    const desc = sectorStr
      ? `SPY ${spyStr} with broad selling; ${sectorStr}; Fear & Greed at ${fgScore} (${fgLabel}).`
      : `SPY ${spyStr} with broad selling pressure; Fear & Greed at ${fgScore} (${fgLabel}).`;
    return { condition: 'stormy', emoji: '⛈️', label: 'Stormy', description: desc };
  }
  const desc = sectorStr
    ? `SPY ${spyStr}, mixed signals; ${sectorStr}; Fear & Greed at ${fgScore} (${fgLabel}).`
    : `SPY ${spyStr}, mixed signals; Fear & Greed at ${fgScore} (${fgLabel}).`;
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
): PredictionSignals {
  const signals: string[] = [];
  let bullCount = 0;
  let bearCount = 0;

  // F&G momentum (delta from yesterday)
  if (fgDelta > 5) { signals.push(`F&G rising +${fgDelta} pts → momentum continuation`); bullCount++; }
  else if (fgDelta < -5) { signals.push(`F&G falling ${fgDelta} pts → momentum continuation`); bearCount++; }

  // F&G extremes → mean reversion
  if (fgScore >= 80) { signals.push(`F&G at ${fgScore} (Extreme Greed) → mean reversion risk`); bearCount++; }
  else if (fgScore <= 20) { signals.push(`F&G at ${fgScore} (Extreme Fear) → bounce potential`); bullCount++; }

  // SPY MA position
  if (spyData.above200MA && spyData.above50MA) {
    signals.push('SPY above both 200MA & 50MA → uptrend intact'); bullCount++;
  } else if (spyData.above200MA === false && spyData.above50MA === false) {
    signals.push('SPY below both 200MA & 50MA → downtrend in force'); bearCount++;
  } else if (spyData.above200MA && spyData.above50MA === false) {
    signals.push('SPY below 50MA but above 200MA → consolidation zone');
  }

  // Put/call ratio signal (SPY-adjusted: baseline ~0.75–0.90, not 1.0)
  if (pcRatio < 0.65) { signals.push(`Put/call ${pcRatio} — heavy call buying, complacency signal (bullish)`); bullCount++; }
  else if (pcRatio >= 0.9 && pcRatio < 1.1) { signals.push(`Put/call ${pcRatio} — hedging picking up, mildly bearish lean`); bearCount++; }
  else if (pcRatio >= 1.1) { signals.push(`Put/call ${pcRatio} — elevated put buying, fear/protection signal (bearish)`); bearCount++; }

  // Day of week (what day is tomorrow)
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dow = tomorrow.getDay(); // 0=Sun,1=Mon,...5=Fri,6=Sat
  if (dow === 5) { signals.push('Tomorrow is Friday → profit-taking and position-squaring risk'); bearCount++; }
  else if (dow === 1) { signals.push('Tomorrow is Monday → fresh week positioning often risk-on'); bullCount++; }

  // Today's SPY momentum
  const pct = spyData.changePercent ?? 0;
  if (pct > 1.0) { signals.push(`SPY up +${pct}% today → strong momentum, continuation bias`); bullCount++; }
  else if (pct < -1.0) { signals.push(`SPY down ${pct}% today → strong selling, continuation risk`); bearCount++; }

  const diff = bullCount - bearCount;
  const bias: PredictionSignals['bias'] = diff > 0 ? 'Bullish' : diff < 0 ? 'Bearish' : 'Neutral';
  const confidence: PredictionSignals['confidence'] =
    Math.abs(diff) >= 3 ? 'High' : Math.abs(diff) >= 2 ? 'Moderate' : 'Low';

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
    edgeBoard: row.edge_board ?? null,
    positioning: row.positioning ?? null,
    userSpyPrediction: row.user_spy_prediction ?? null,
    userPredictionLockedAt: row.user_prediction_locked_at ? String(row.user_prediction_locked_at) : null,
    userAccuracyCorrect: row.user_accuracy_correct != null ? Boolean(row.user_accuracy_correct) : null,
  };
}
