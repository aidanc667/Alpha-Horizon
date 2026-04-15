// ─── Statistical Utilities for Alpha Horizon ─────────────────────────────────
// Pure computation — no API calls, no side effects.

// ── Bootstrap Resampling ──────────────────────────────────────────────────────

export interface BootstrapResult {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
  iterations: number;
}

/**
 * Bootstrap resampling: shuffle daily returns 1,000 times to build a
 * distribution of terminal wealth ratios.  Shows how much of the actual
 * backtest result depended on the specific sequence of returns (luck)
 * vs the underlying return distribution (skill).
 *
 * Returns wealth *multiples* (e.g. 2.4 = portfolio grew 140%).
 */
export function runBootstrap(
  dailyReturns: number[],
  iterations = 1000,
): BootstrapResult {
  const n = dailyReturns.length;
  if (n < 10) return { p5: 1, p25: 1, p50: 1, p75: 1, p95: 1, mean: 1, iterations: 0 };

  const endings: number[] = [];
  for (let iter = 0; iter < iterations; iter++) {
    let val = 1.0;
    for (let d = 0; d < n; d++) {
      val *= (1 + dailyReturns[Math.floor(Math.random() * n)]);
    }
    endings.push(val);
  }

  endings.sort((a, b) => a - b);
  const pct = (p: number) =>
    endings[Math.max(0, Math.min(endings.length - 1, Math.floor((p / 100) * endings.length)))];
  const mean = endings.reduce((s, v) => s + v, 0) / endings.length;

  return { p5: pct(5), p25: pct(25), p50: pct(50), p75: pct(75), p95: pct(95), mean, iterations };
}

// ── Annual Consistency (Period Sensitivity) ───────────────────────────────────

export interface AnnualYearStat {
  year: number;
  portReturn: number;   // % TWR
  benchReturn: number;  // % TWR
  beat: boolean;
  sharpe: number;
  maxDD: number;        // % peak-to-trough
  vol: number;          // annualised %
}

export interface AnnualConsistencyResult {
  years: AnnualYearStat[];
  beatPct: number;       // % of years outperforming benchmark
  avgSharpe: number;
  sharpeSd: number;      // standard deviation of annual Sharpes — lower = more consistent
  worstYear: number;     // worst annual return %
  bestYear: number;      // best annual return %
}

/**
 * Break the backtest into calendar years and compute per-year statistics.
 * Answers: "Was this portfolio consistently good, or did one great year carry it?"
 */
export function computeAnnualConsistency(
  dailyData: { date: string; portfolioValue: number; benchmarkValue: number }[],
): AnnualConsistencyResult {
  const byYear = new Map<number, typeof dailyData>();
  for (const d of dailyData) {
    const yr = new Date(d.date).getUTCFullYear();
    if (!byYear.has(yr)) byYear.set(yr, []);
    byYear.get(yr)!.push(d);
  }

  const years: AnnualYearStat[] = [];

  for (const [year, days] of byYear) {
    if (days.length < 20) continue; // skip stub years at edges

    const portRet = ((days[days.length - 1].portfolioValue / days[0].portfolioValue) - 1) * 100;
    const benchRet = ((days[days.length - 1].benchmarkValue / days[0].benchmarkValue) - 1) * 100;

    // Daily returns for vol & Sharpe
    const dRets: number[] = [];
    for (let i = 1; i < days.length; i++) {
      dRets.push((days[i].portfolioValue / days[i - 1].portfolioValue) - 1);
    }
    const mean = dRets.reduce((s, r) => s + r, 0) / dRets.length;
    const variance = dRets.reduce((s, r) => s + (r - mean) ** 2, 0) / dRets.length;
    const vol = Math.sqrt(variance) * Math.sqrt(252) * 100;
    const sharpe = vol > 0 ? ((portRet / 100 - 0.02) / (vol / 100)) : 0;

    // Annual max drawdown
    let peak = days[0].portfolioValue;
    let maxDD = 0;
    for (const d of days) {
      if (d.portfolioValue > peak) peak = d.portfolioValue;
      const dd = ((peak - d.portfolioValue) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }

    years.push({ year, portReturn: portRet, benchReturn: benchRet, beat: portRet > benchRet, sharpe, maxDD, vol });
  }

  years.sort((a, b) => a.year - b.year);

  if (years.length === 0) {
    return { years: [], beatPct: 0, avgSharpe: 0, sharpeSd: 0, worstYear: 0, bestYear: 0 };
  }

  const sharpes = years.map(y => y.sharpe);
  const avgSharpe = sharpes.reduce((s, v) => s + v, 0) / sharpes.length;
  const sharpeSd = Math.sqrt(sharpes.reduce((s, v) => s + (v - avgSharpe) ** 2, 0) / sharpes.length);
  const beatCount = years.filter(y => y.beat).length;
  const rets = years.map(y => y.portReturn);

  return {
    years,
    beatPct: (beatCount / years.length) * 100,
    avgSharpe,
    sharpeSd,
    worstYear: Math.min(...rets),
    bestYear: Math.max(...rets),
  };
}

// ── Correlation Matrix ────────────────────────────────────────────────────────

export interface CorrelationMatrix {
  tickers: string[];
  matrix: number[][];  // [i][j] = Pearson correlation between ticker i and j
}

export function computeCorrelationMatrix(
  perTickerReturns: Record<string, number[]>,
): CorrelationMatrix {
  const tickers = Object.keys(perTickerReturns);
  const n = tickers.length;
  if (n < 2) return { tickers, matrix: [[1]] };

  const nDays = perTickerReturns[tickers[0]].length;
  const means = tickers.map(t => {
    const r = perTickerReturns[t];
    return r.reduce((a, b) => a + b, 0) / r.length;
  });
  const stds = tickers.map((t, i) => {
    const r = perTickerReturns[t];
    return Math.sqrt(r.reduce((s, v) => s + (v - means[i]) ** 2, 0) / r.length);
  });

  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { matrix[i][j] = 1; continue; }
      if (stds[i] < 1e-10 || stds[j] < 1e-10) { matrix[i][j] = 0; continue; }
      let cov = 0;
      for (let d = 0; d < nDays; d++) {
        cov += (perTickerReturns[tickers[i]][d] - means[i]) * (perTickerReturns[tickers[j]][d] - means[j]);
      }
      matrix[i][j] = (cov / nDays) / (stds[i] * stds[j]);
    }
  }
  return { tickers, matrix };
}

// ── Mean-Variance Optimization (Markowitz Efficient Frontier) ─────────────────

export interface PortfolioPoint {
  volatility: number;       // annualized %
  expectedReturn: number;   // annualized %
  sharpe: number;
}

export interface MVOResult {
  all: PortfolioPoint[];        // sampled random portfolios for scatter (capped at 600)
  frontier: PortfolioPoint[];   // Pareto-efficient subset
  maxSharpe: PortfolioPoint & { weights: Record<string, number> };
  minVariance: PortfolioPoint & { weights: Record<string, number> };
  current: PortfolioPoint;
  tickers: string[];
}

export function computeMVO(
  perTickerReturns: Record<string, number[]>,
  currentWeights: { ticker: string; percentage: number }[],
  rfRate = 0.02,
  nSim = 3000,
): MVOResult | null {
  const tickers = Object.keys(perTickerReturns);
  const n = tickers.length;
  if (n < 2) return null;

  const nDays = perTickerReturns[tickers[0]].length;
  if (nDays < 30) return null;

  // Annualized mean returns
  const means = tickers.map(t => {
    const r = perTickerReturns[t];
    return (r.reduce((a, b) => a + b, 0) / r.length) * 252;
  });

  // Annualized covariance matrix
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const mi = means[i] / 252;
      const mj = means[j] / 252;
      let c = 0;
      for (let d = 0; d < nDays; d++) {
        c += (perTickerReturns[tickers[i]][d] - mi) * (perTickerReturns[tickers[j]][d] - mj);
      }
      cov[i][j] = cov[j][i] = (c / nDays) * 252;
    }
  }

  const portStats = (weights: number[]): PortfolioPoint => {
    const ret = weights.reduce((s, w, i) => s + w * means[i], 0) * 100;
    let variance = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) variance += weights[i] * weights[j] * cov[i][j];
    const vol = Math.sqrt(Math.max(0, variance)) * 100;
    return { expectedReturn: ret, volatility: vol, sharpe: vol > 0 ? (ret / 100 - rfRate) / (vol / 100) : 0 };
  };

  // Dirichlet random weights
  const randomWeights = (): number[] => {
    const raw = tickers.map(() => -Math.log(Math.random() + 1e-10));
    const sum = raw.reduce((a, b) => a + b, 0);
    return raw.map(v => v / sum);
  };

  // Simulate
  const allWeights: number[][] = [];
  const all: PortfolioPoint[] = [];
  for (let s = 0; s < nSim; s++) {
    const w = randomWeights();
    allWeights.push(w);
    all.push(portStats(w));
  }

  // Efficient frontier: Pareto filter sorted by volatility
  const sorted = all.map((p, i) => ({ ...p, idx: i })).sort((a, b) => a.volatility - b.volatility);
  let maxRet = -Infinity;
  const frontier: PortfolioPoint[] = [];
  for (const p of sorted) {
    if (p.expectedReturn > maxRet) { maxRet = p.expectedReturn; frontier.push(p); }
  }

  // Max Sharpe
  let maxSharpeIdx = 0;
  for (let i = 1; i < all.length; i++) if (all[i].sharpe > all[maxSharpeIdx].sharpe) maxSharpeIdx = i;
  const maxSharpeWeightMap: Record<string, number> = {};
  tickers.forEach((t, i) => { maxSharpeWeightMap[t] = Math.round(allWeights[maxSharpeIdx][i] * 1000) / 10; });

  // Min Variance
  let minVarIdx = 0;
  for (let i = 1; i < all.length; i++) if (all[i].volatility < all[minVarIdx].volatility) minVarIdx = i;
  const minVarWeightMap: Record<string, number> = {};
  tickers.forEach((t, i) => { minVarWeightMap[t] = Math.round(allWeights[minVarIdx][i] * 1000) / 10; });

  // Current portfolio
  const cwMap: Record<string, number> = {};
  currentWeights.forEach(a => { cwMap[a.ticker] = (a.percentage ?? 0) / 100; });
  const currentWs = tickers.map(t => cwMap[t] ?? 0);
  const sumW = currentWs.reduce((a, b) => a + b, 0);
  const normWs = sumW > 0 ? currentWs.map(w => w / sumW) : currentWs.map(() => 1 / n);

  return {
    all: all.slice(0, 600),
    frontier,
    maxSharpe: { ...all[maxSharpeIdx], weights: maxSharpeWeightMap },
    minVariance: { ...all[minVarIdx], weights: minVarWeightMap },
    current: portStats(normWs),
    tickers,
  };
}
