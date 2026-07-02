import { describe, it, expect } from 'vitest';
import {
  scoreAccuracy,
  buildWeather,
  computePredictionSignals,
  rowToRecord,
} from '../scoring';

// ─── scoreAccuracy ────────────────────────────────────────────────────────────

describe('scoreAccuracy', () => {
  // ── SPY component ──────────────────────────────────────────────────────────

  it('gives 100 on spy when direction matches and magnitude within 0.3%', () => {
    const { breakdown } = scoreAccuracy(
      { spyDirection: 'Up', spyChangePercent: 0.5 },
      { spyDirection: 'Up', spyChangePercent: 0.7 },
    );
    expect(breakdown.spy).toBe(100); // magDiff = 0.2 <= 0.3 → 60+40
  });

  it('gives 85 on spy when direction matches and magnitude within 0.7%', () => {
    const { breakdown } = scoreAccuracy(
      { spyDirection: 'Up', spyChangePercent: 0.5 },
      { spyDirection: 'Up', spyChangePercent: 1.0 },
    );
    expect(breakdown.spy).toBe(85); // magDiff = 0.5 → 60+25
  });

  it('gives 70 on spy when direction matches and magnitude within 1.5%', () => {
    const { breakdown } = scoreAccuracy(
      { spyDirection: 'Up', spyChangePercent: 0.5 },
      { spyDirection: 'Up', spyChangePercent: 1.8 },
    );
    expect(breakdown.spy).toBe(70); // magDiff = 1.3 → 60+10
  });

  it('gives 60 on spy when direction matches but magnitude far off', () => {
    const { breakdown } = scoreAccuracy(
      { spyDirection: 'Up', spyChangePercent: 0.5 },
      { spyDirection: 'Up', spyChangePercent: 3.0 },
    );
    expect(breakdown.spy).toBe(60); // magDiff = 2.5 > 1.5 → 60+0
  });

  it('gives 0 on spy when direction does not match', () => {
    const { breakdown } = scoreAccuracy(
      { spyDirection: 'Up', spyChangePercent: 0.5 },
      { spyDirection: 'Down', spyChangePercent: -0.5 },
    );
    expect(breakdown.spy).toBe(0);
  });

  // ── VIX component ──────────────────────────────────────────────────────────

  it('gives 100 on vix when direction matches and magnitude within 5%', () => {
    const { breakdown } = scoreAccuracy(
      { vixDirection: 'Down', vixChangePercent: -8 },
      { vixDirection: 'Down', vixChangePercent: -10 },
    );
    expect(breakdown.vix).toBe(100); // magDiff = 2 <= 5 → 60+40
  });

  it('gives 85 on vix when direction matches and magnitude within 15%', () => {
    const { breakdown } = scoreAccuracy(
      { vixDirection: 'Up', vixChangePercent: 5 },
      { vixDirection: 'Up', vixChangePercent: 15 },
    );
    expect(breakdown.vix).toBe(85); // magDiff = 10 → 60+25
  });

  it('gives 0 on vix when direction does not match', () => {
    const { breakdown } = scoreAccuracy(
      { vixDirection: 'Up', vixChangePercent: 5 },
      { vixDirection: 'Down', vixChangePercent: -5 },
    );
    expect(breakdown.vix).toBe(0);
  });

  it('gives 0 on vix when missing from both pred and actual', () => {
    const { breakdown } = scoreAccuracy({}, {});
    expect(breakdown.vix).toBe(0);
  });

  // ── Top Mover component ────────────────────────────────────────────────────

  it('gives 100 on topMover when direction matches and ticker moved ≥5% and was top3', () => {
    const { breakdown } = scoreAccuracy(
      { topMover: { ticker: 'NVDA', direction: 'Up', changePercent: 4.5 } },
      { topMover: { predictedTickerChange: 6.2, predictedTickerWasTop3: true } },
    );
    expect(breakdown.topMover).toBe(100); // 50+40+10 = 100
  });

  it('gives 90 on topMover when direction matches and ticker moved ≥5% but not top3', () => {
    const { breakdown } = scoreAccuracy(
      { topMover: { ticker: 'NVDA', direction: 'Up', changePercent: 4.5 } },
      { topMover: { predictedTickerChange: 5.5, predictedTickerWasTop3: false } },
    );
    expect(breakdown.topMover).toBe(90); // 50+40+0 = 90
  });

  it('gives 80 on topMover when direction matches and ticker moved ≥3%', () => {
    const { breakdown } = scoreAccuracy(
      { topMover: { ticker: 'NVDA', direction: 'Up', changePercent: 3.5 } },
      { topMover: { predictedTickerChange: 3.8, predictedTickerWasTop3: false } },
    );
    expect(breakdown.topMover).toBe(80); // 50+30+0 = 80
  });

  it('gives 0 on topMover when direction is wrong', () => {
    const { breakdown } = scoreAccuracy(
      { topMover: { ticker: 'NVDA', direction: 'Up', changePercent: 4.5 } },
      { topMover: { predictedTickerChange: -3.0, predictedTickerWasTop3: false } },
    );
    expect(breakdown.topMover).toBe(0);
  });

  it('gives 0 on topMover when actual ticker change is null (no data)', () => {
    const { breakdown } = scoreAccuracy(
      { topMover: { ticker: 'NVDA', direction: 'Up', changePercent: 4.5 } },
      { topMover: { predictedTickerChange: null } },
    );
    expect(breakdown.topMover).toBe(0);
  });

  // ── Overall score ───────────────────────────────────────────────────────────

  it('computes overall score as the rounded average of spy, vix, topMover', () => {
    // spy: dir match + magDiff 0.2 → 100; vix: dir mismatch → 0; topMover: no data → 0
    const { score, breakdown } = scoreAccuracy(
      { spyDirection: 'Up', spyChangePercent: 0.5, vixDirection: 'Up', topMover: { direction: 'Up' } },
      { spyDirection: 'Up', spyChangePercent: 0.7, vixDirection: 'Down', topMover: { predictedTickerChange: null } },
    );
    expect(breakdown.spy).toBe(100);
    expect(breakdown.vix).toBe(0);
    expect(breakdown.topMover).toBe(0);
    expect(score).toBe(Math.round((100 + 0 + 0) / 3)); // 33
  });

  it('returns 0 when all three components score 0', () => {
    const { score } = scoreAccuracy(
      { spyDirection: 'Up', vixDirection: 'Up', topMover: { direction: 'Up' } },
      { spyDirection: 'Down', vixDirection: 'Down', topMover: { predictedTickerChange: -2.0 } },
    );
    expect(score).toBe(0);
  });
});

// ─── buildWeather ─────────────────────────────────────────────────────────────

describe('buildWeather', () => {
  it('returns sunny when SPY is up ≥ +0.5%', () => {
    const { condition, emoji, label } = buildWeather(0.5, 55);
    expect(condition).toBe('sunny');
    expect(emoji).toBe('☀️');
    expect(label).toBe('Sunny');
  });

  it('returns sunny when SPY is positive and F&G ≥ 65 (greed + green)', () => {
    const { condition } = buildWeather(0.3, 70);
    expect(condition).toBe('sunny');
  });

  it('returns stormy when SPY is down ≤ −0.5%', () => {
    const { condition, emoji, label } = buildWeather(-0.5, 55);
    expect(condition).toBe('stormy');
    expect(emoji).toBe('⛈️');
    expect(label).toBe('Stormy');
  });

  it('returns stormy when SPY is negative and F&G ≤ 30 (fear + red)', () => {
    const { condition } = buildWeather(-0.2, 25);
    expect(condition).toBe('stormy');
  });

  it('returns overcast for a flat SPY with neutral F&G', () => {
    const { condition, emoji, label } = buildWeather(0, 50);
    expect(condition).toBe('overcast');
    expect(emoji).toBe('☁️');
    expect(label).toBe('Overcast');
  });

  it('returns overcast when SPY is slightly positive but F&G is below greed threshold', () => {
    // pct > 0 but fgScore < 65 — not enough for sunny
    const { condition } = buildWeather(0.2, 60);
    expect(condition).toBe('overcast');
  });

  it('treats null SPY as 0 (overcast at neutral F&G)', () => {
    const { condition } = buildWeather(null, 50);
    expect(condition).toBe('overcast');
  });

  it('treats null SPY as 0 (still stormy if F&G is extreme fear — fails stormy condition since pct=0 not <0)', () => {
    // null SPY → pct = 0, 0 <= -0.5 is false, 0 < 0 is false → overcast
    const { condition } = buildWeather(null, 15);
    expect(condition).toBe('overcast');
  });

  it('includes F&G label Extreme Fear in description when score ≤ 20', () => {
    const { description } = buildWeather(-0.6, 15);
    expect(description).toContain('Extreme Fear');
  });

  it('includes F&G label Extreme Greed in description when score > 80', () => {
    const { description } = buildWeather(0.8, 85);
    expect(description).toContain('Extreme Greed');
  });

  it('includes sector context in description when both sectors provided', () => {
    const leader = { ticker: 'XLK', sector: 'Technology', changePercent: 1.2 };
    const lagger = { ticker: 'XLE', sector: 'Energy', changePercent: -0.8 };
    const { description } = buildWeather(0.6, 60, leader, lagger);
    expect(description).toContain('Technology');
    expect(description).toContain('Energy');
  });

  it('omits sector context when sectors are not provided', () => {
    const { description } = buildWeather(0.6, 60);
    expect(description).not.toContain('leads');
  });

  it('stormy description says "selling" not "buying"', () => {
    const { description } = buildWeather(-0.8, 40);
    expect(description).toContain('selling');
    expect(description).not.toContain('buying');
  });
});

// ─── computePredictionSignals ─────────────────────────────────────────────────

// A neutral "base" spy: above both MAs, no strong momentum, put/call in neutral zone,
// F&G neutral, no day-of-week effect (use a Wednesday so tomorrow is Thursday).
const WEDNESDAY = new Date('2025-01-08T15:00:00Z'); // Wed Jan 8 2025

const neutralSpy = { changePercent: 0.1, above200MA: true, above50MA: true };

describe('computePredictionSignals', () => {
  // ── Bias calculation ────────────────────────────────────────────────────────

  it('returns Bullish bias when bull signals outnumber bear signals', () => {
    // above both MAs (+1 bull), F&G extreme fear (+1 bull), put/call very low (+1 bull)
    const { bias } = computePredictionSignals(
      { changePercent: 0, above200MA: true, above50MA: true },
      15,  // Extreme Fear → +1 bull (mean reversion)
      0,   // no delta signal
      0.55, // < 0.65 → +1 bull
      WEDNESDAY,
    );
    expect(bias).toBe('Bullish');
  });

  it('returns Bearish bias when bear signals outnumber bull signals', () => {
    // below both MAs (+1 bear), F&G extreme greed (+1 bear), elevated puts (+1 bear)
    const { bias } = computePredictionSignals(
      { changePercent: 0, above200MA: false, above50MA: false },
      85,  // Extreme Greed → +1 bear
      0,
      1.2, // >= 1.1 → +1 bear
      WEDNESDAY,
    );
    expect(bias).toBe('Bearish');
  });

  it('returns Neutral when bull and bear counts are equal', () => {
    // above both MAs (+1 bull) vs elevated puts (+1 bear) — everything else neutral
    const { bias } = computePredictionSignals(
      { changePercent: 0.3, above200MA: true, above50MA: true },
      50,  // neutral F&G
      0,   // no delta
      1.2, // >= 1.1 → +1 bear
      WEDNESDAY,
    );
    expect(bias).toBe('Neutral'); // bull=1 (MAs), bear=1 (puts)
  });

  // ── Confidence thresholds ───────────────────────────────────────────────────

  it('returns High confidence when |diff| ≥ 3', () => {
    // above MAs (+1 bull), extreme fear (+1 bull), low put/call (+1 bull),
    // F&G rising 10 pts (+1 bull) → bull=4, bear=0, diff=4
    const { confidence } = computePredictionSignals(
      { changePercent: 0, above200MA: true, above50MA: true },
      15,  // Extreme Fear → +1 bull
      10,  // F&G rising → +1 bull
      0.5, // < 0.65 → +1 bull
      WEDNESDAY,
    );
    expect(confidence).toBe('High'); // bull=4, diff=4 >= 3
  });

  it('returns High confidence when weighted |diff| is exactly 2.0', () => {
    // above both MAs (+1.0) + low put/call (+1.0) with default weights → score=2.0 → High
    const { confidence } = computePredictionSignals(
      { changePercent: 0, above200MA: true, above50MA: true },
      50,   // neutral
      0,    // no delta
      0.55, // < 0.65 → +1 bull
      WEDNESDAY,
    );
    expect(confidence).toBe('High'); // bullScore=2.0 >= 2.0 threshold
  });

  it('returns Moderate confidence when weighted |diff| is 1.0', () => {
    // only put/call signal fires at default weight 1.0 → score=1.0 → Moderate (≥0.9)
    const { confidence } = computePredictionSignals(
      { changePercent: 0, above200MA: null, above50MA: null },
      50,
      0,
      0.5, // +1 bull
      WEDNESDAY,
    );
    expect(confidence).toBe('Moderate'); // bullScore=1.0 >= 0.9 threshold
  });

  // ── Individual signal triggers ──────────────────────────────────────────────

  it('adds a bullish signal when F&G delta rises > 5', () => {
    const { bullCount, signals } = computePredictionSignals(
      neutralSpy, 50, 8, 0.75, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('F&G rising'))).toBe(true);
    expect(bullCount).toBeGreaterThanOrEqual(1);
  });

  it('adds a bearish signal when F&G delta falls < −5', () => {
    const { bearCount, signals } = computePredictionSignals(
      neutralSpy, 50, -8, 0.75, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('F&G falling'))).toBe(true);
    expect(bearCount).toBeGreaterThanOrEqual(1);
  });

  it('adds a bearish signal when F&G score is ≥ 80 (Extreme Greed → mean reversion risk)', () => {
    const { bearCount, signals } = computePredictionSignals(
      neutralSpy, 82, 0, 0.75, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('Extreme Greed'))).toBe(true);
    expect(bearCount).toBeGreaterThanOrEqual(1);
  });

  it('adds a bullish signal when F&G score is ≤ 20 (Extreme Fear → bounce potential)', () => {
    const { bullCount, signals } = computePredictionSignals(
      neutralSpy, 18, 0, 0.75, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('Extreme Fear'))).toBe(true);
    expect(bullCount).toBeGreaterThanOrEqual(1);
  });

  it('adds a bullish MA signal when SPY is above both 200MA and 50MA', () => {
    const { signals } = computePredictionSignals(
      { changePercent: 0, above200MA: true, above50MA: true },
      50, 0, 0.75, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('above both 200MA'))).toBe(true);
  });

  it('adds a bearish MA signal when SPY is below both 200MA and 50MA', () => {
    const { signals } = computePredictionSignals(
      { changePercent: 0, above200MA: false, above50MA: false },
      50, 0, 0.75, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('below both 200MA'))).toBe(true);
  });

  it('adds no MA signal when MA data is null', () => {
    const before = computePredictionSignals(
      { changePercent: 0, above200MA: null, above50MA: null },
      50, 0, 0.75, WEDNESDAY,
    );
    expect(before.signals.every(s => !s.includes('200MA'))).toBe(true);
  });

  it('adds a bullish put/call signal when ratio is < 0.65', () => {
    const { bullCount, signals } = computePredictionSignals(
      neutralSpy, 50, 0, 0.60, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('heavy call buying'))).toBe(true);
    expect(bullCount).toBeGreaterThanOrEqual(1);
  });

  it('adds a bearish put/call signal when ratio is ≥ 0.9 but < 1.1', () => {
    const { bearCount, signals } = computePredictionSignals(
      neutralSpy, 50, 0, 0.95, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('hedging picking up'))).toBe(true);
    expect(bearCount).toBeGreaterThanOrEqual(1);
  });

  it('adds a stronger bearish put/call signal when ratio is ≥ 1.1', () => {
    const { bearCount, signals } = computePredictionSignals(
      neutralSpy, 50, 0, 1.2, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('elevated put buying'))).toBe(true);
    expect(bearCount).toBeGreaterThanOrEqual(1);
  });

  it('adds a bearish day-of-week signal on Thursday (tomorrow is Friday)', () => {
    const thursday = new Date('2025-01-09T15:00:00Z');
    const { signals } = computePredictionSignals(neutralSpy, 50, 0, 0.75, thursday);
    expect(signals.some(s => s.includes('Friday'))).toBe(true);
  });

  it('adds a bullish day-of-week signal on Sunday (tomorrow is Monday)', () => {
    const sunday = new Date('2025-01-12T15:00:00Z');
    const { signals } = computePredictionSignals(neutralSpy, 50, 0, 0.75, sunday);
    expect(signals.some(s => s.includes('Monday'))).toBe(true);
  });

  it('adds a bullish momentum signal when SPY is up > 1%', () => {
    const { signals } = computePredictionSignals(
      { changePercent: 1.5, above200MA: null, above50MA: null },
      50, 0, 0.75, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('strong momentum'))).toBe(true);
  });

  it('adds a bearish momentum signal when SPY is down < −1%', () => {
    const { signals } = computePredictionSignals(
      { changePercent: -1.5, above200MA: null, above50MA: null },
      50, 0, 0.75, WEDNESDAY,
    );
    expect(signals.some(s => s.includes('strong selling'))).toBe(true);
  });
});

// ─── rowToRecord ──────────────────────────────────────────────────────────────

describe('rowToRecord', () => {
  const fullRow = {
    record_date: '2025-06-10',
    is_noon_locked: true,
    noon_locked_at: '2025-06-10T16:05:00Z',
    elite6_actual: { fearGreed: { score: 62 } },
    brief_bullets: [{ what: 'test', why: 'because', impact: 'big' }],
    outlier: 'Unusual put volume on NVDA',
    catalyst: 'CPI print at 8:30 AM ET',
    weather: { condition: 'sunny', emoji: '☀️', label: 'Sunny', description: 'Nice day' },
    live_headlines: [{ headline: 'Fed holds', source: 'Reuters', impactScore: 8, category: 'Fed/Rates', timestamp: '2025-06-10T14:00:00Z' }],
    tomorrow_predictions: { fearGreed: { score: 65 } },
    tomorrow_outlook: 'Continuation likely',
    accuracy_score: '78.50',
    accuracy_breakdown: { fearGreed: 90, spyTrend: 80, sectorRotation: 50, optionsPulse: 100 },
    accuracy_calculated_at: '2025-06-11T09:00:00Z',
    edge_board: { top5: [], bottom5: [], generatedAt: '2025-06-10T15:00:00Z' },
    positioning: { overweight: [], neutral: [], underweight: [] },
    user_spy_prediction: 'Up',
    user_prediction_locked_at: '2025-06-10T15:55:00Z',
    user_accuracy_correct: true,
  };

  it('maps all fields from a fully populated row', () => {
    const record = rowToRecord(fullRow);
    expect(record.recordDate).toBe('2025-06-10');
    expect(record.isNoonLocked).toBe(true);
    expect(record.noonLockedAt).toBe('2025-06-10T16:05:00Z');
    expect(record.elite6Actual).toEqual({ fearGreed: { score: 62 } });
    expect(record.briefBullets).toHaveLength(1);
    expect(record.outlier).toBe('Unusual put volume on NVDA');
    expect(record.catalyst).toBe('CPI print at 8:30 AM ET');
    expect(record.weather?.condition).toBe('sunny');
    expect(record.liveHeadlines).toHaveLength(1);
    expect(record.tomorrowPredictions).toEqual({ fearGreed: { score: 65 } });
    expect(record.tomorrowOutlook).toBe('Continuation likely');
    expect(record.accuracyScore).toBe(78.5);
    expect(record.accuracyBreakdown?.fearGreed).toBe(90);
    expect(record.accuracyCalculatedAt).toBe('2025-06-11T09:00:00Z');
    expect(record.edgeBoard).toBeDefined();
    expect(record.positioning).toBeDefined();
    expect(record.userSpyPrediction).toBe('Up');
    expect(record.userPredictionLockedAt).toBe('2025-06-10T15:55:00Z');
    expect(record.userAccuracyCorrect).toBe(true);
  });

  it('coerces accuracy_score string to a Number', () => {
    const record = rowToRecord({ ...fullRow, accuracy_score: '92.75' });
    expect(typeof record.accuracyScore).toBe('number');
    expect(record.accuracyScore).toBe(92.75);
  });

  it('coerces user_accuracy_correct to boolean', () => {
    expect(rowToRecord({ ...fullRow, user_accuracy_correct: 1 }).userAccuracyCorrect).toBe(true);
    expect(rowToRecord({ ...fullRow, user_accuracy_correct: 0 }).userAccuracyCorrect).toBe(false);
    expect(rowToRecord({ ...fullRow, user_accuracy_correct: false }).userAccuracyCorrect).toBe(false);
  });

  it('slices Date objects for recordDate to YYYY-MM-DD', () => {
    const record = rowToRecord({ ...fullRow, record_date: new Date('2025-06-10T00:00:00Z') });
    expect(record.recordDate).toBe('2025-06-10');
  });

  it('slices date strings that include time components', () => {
    const record = rowToRecord({ ...fullRow, record_date: '2025-06-10T00:00:00.000Z' });
    expect(record.recordDate).toBe('2025-06-10');
  });

  it('returns null for accuracyScore when accuracy_score is null', () => {
    const record = rowToRecord({ ...fullRow, accuracy_score: null });
    expect(record.accuracyScore).toBeNull();
  });

  it('returns null for userAccuracyCorrect when field is null', () => {
    const record = rowToRecord({ ...fullRow, user_accuracy_correct: null });
    expect(record.userAccuracyCorrect).toBeNull();
  });

  it('returns null for noonLockedAt when field is null', () => {
    const record = rowToRecord({ ...fullRow, noon_locked_at: null });
    expect(record.noonLockedAt).toBeNull();
  });

  it('uses empty array as default for briefBullets when missing', () => {
    const record = rowToRecord({ record_date: '2025-06-10' });
    expect(record.briefBullets).toEqual([]);
    expect(record.liveHeadlines).toEqual([]);
  });

  it('uses empty string defaults for text fields when missing', () => {
    const record = rowToRecord({ record_date: '2025-06-10' });
    expect(record.outlier).toBe('');
    expect(record.catalyst).toBe('');
    expect(record.tomorrowOutlook).toBe('');
  });

  it('defaults isNoonLocked to false when missing', () => {
    const record = rowToRecord({ record_date: '2025-06-10' });
    expect(record.isNoonLocked).toBe(false);
  });

  it('returns null for elite6Actual on a sparse row (old schema)', () => {
    const record = rowToRecord({ record_date: '2025-06-10', is_noon_locked: false });
    expect(record.elite6Actual).toBeNull();
    expect(record.tomorrowPredictions).toBeNull();
    expect(record.weather).toBeNull();
  });
});
