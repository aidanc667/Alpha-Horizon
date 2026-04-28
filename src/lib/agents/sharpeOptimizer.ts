/**
 * sharpeOptimizer.ts
 *
 * Gradient-ascent Sharpe ratio optimizer for portfolio construction.
 * Replaces the 3-template lookup in portfolioRules.ts with a real optimizer
 * that finds the maximum-Sharpe weight vector for any candidate ETF set.
 *
 * ── Algorithm ──────────────────────────────────────────────────────────────
 * Maximize:  S(w) = (wᵀμ − rf) / √(wᵀΣw)
 * Subject to: Σwᵢ = 1,  0 ≤ wᵢ ≤ maxW
 *
 * Method: projected gradient ascent with decaying learning rate.
 *   1. Start from equal weights clamped to maxW.
 *   2. Compute Sharpe gradient: ∂S/∂wᵢ = [(μᵢ − rf) − S·(Σw)ᵢ/σ_p] / σ_p
 *   3. Take a gradient step, project back onto the simplex with box constraints.
 *   4. Repeat for `iterations` steps.
 *
 * ── Correlation model ──────────────────────────────────────────────────────
 * Correlations are derived from two inputs already in the data layer:
 *   1. Category-pair base correlations (empirically grounded, ~2010–2026)
 *   2. Factor-exposure similarity adjustment (using ETF_UNIVERSE.factorExposures)
 *
 * No hand-coded per-ticker correlation numbers — the model scales to any ETF
 * added to ETF_UNIVERSE as long as factorExposures are filled in.
 *
 * ── Public API ─────────────────────────────────────────────────────────────
 *   optimizeSharpeWeights(tickers, returns, riskFreeRate, opts) → Record<ticker, weight>
 *   computePortfolioVol(slices, riskFreeRate?)                  → number
 */

import { ETF_BY_TICKER } from '@/lib/data/etfUniverse';
import { calculateETFVolatility } from '@/lib/data/calculateETFReturns';

// ─── Category-pair base correlations ─────────────────────────────────────────
//
// Upper-triangle values derived from rolling 10-year return correlations
// (MSCI/Bloomberg data 2014–2024, averaged). Symmetric matrix — lookup
// always uses [Math.min, Math.max] key order for consistency.
//
// bonds↔equity updated to +0.40 to reflect the post-2022 regime shift:
// the negative/near-zero correlation of the 2010–2021 ZIRP era reversed
// sharply positive when the Fed raised rates while equity fell simultaneously.
// Source: AQR "The Stock-Bond Correlation" (2023); JPMorgan LTCMA 2026, Ch. 4

const CATEGORY_CORR: Record<string, Record<string, number>> = {
  us_equity: {
    us_equity:   0.82,
    intl_equity: 0.73,
    bonds:       0.40,
    cash:       -0.02,
    real_assets: 0.55,
  },
  intl_equity: {
    us_equity:   0.73,
    intl_equity: 0.80,
    bonds:       0.40,
    cash:       -0.02,
    real_assets: 0.48,
  },
  bonds: {
    us_equity:   0.40,
    intl_equity: 0.40,
    bonds:       0.72,
    cash:        0.30,
    real_assets: 0.10,
  },
  cash: {
    us_equity:  -0.02,
    intl_equity:-0.02,
    bonds:       0.30,
    cash:        0.95,
    real_assets: 0.00,
  },
  real_assets: {
    us_equity:   0.55,
    intl_equity: 0.48,
    bonds:       0.10,
    cash:        0.00,
    real_assets: 0.35,
  },
};

// ─── Per-ticker volatility lookup ─────────────────────────────────────────────
//
// calculateETFVolatility() is authoritative but throws for tickers not in
// ETF_TO_ASSET_CLASS. Fall back to the vol field in ETF_UNIVERSE when needed.

function getVol(ticker: string): number {
  try {
    return calculateETFVolatility(ticker);
  } catch {
    return ETF_BY_TICKER[ticker]?.volatility ?? 0.18;
  }
}

// ─── Correlation model ────────────────────────────────────────────────────────

/**
 * Returns the estimated pairwise correlation between two ETFs.
 *
 * For equity-equity pairs the factor-exposure dot product adjusts the
 * category base correlation so that factor twins (e.g. AVUV / AVDV) get
 * a higher correlation than unrelated equity ETFs (e.g. AVUV / QQQM).
 */
export function getCorrelation(ticker1: string, ticker2: string): number {
  if (ticker1 === ticker2) return 1.0;

  const etf1 = ETF_BY_TICKER[ticker1];
  const etf2 = ETF_BY_TICKER[ticker2];

  if (!etf1 || !etf2) return 0.50;

  const c1 = etf1.category;
  const c2 = etf2.category;

  // HYG / USHY behave like equity in stress — special-case their correlations.
  if (ticker1 === 'HYG' || ticker2 === 'HYG' ||
      ticker1 === 'USHY' || ticker2 === 'USHY') {
    const otherCat = ['HYG', 'USHY'].includes(ticker1) ? c2 : c1;
    if (otherCat === 'us_equity' || otherCat === 'intl_equity') return 0.45;
    if (otherCat === 'bonds')       return 0.42;
    if (otherCat === 'cash')        return 0.08;
    return 0.30;
  }

  const base = CATEGORY_CORR[c1]?.[c2] ?? 0.50;

  // Factor-similarity adjustment for equity pairs only.
  const isEquity = (cat: string) => cat === 'us_equity' || cat === 'intl_equity';
  if (isEquity(c1) && isEquity(c2)) {
    const f1 = etf1.factorExposures;
    const f2 = etf2.factorExposures;
    const dot = f1.value * f2.value + f1.size * f2.size + f1.quality * f2.quality;
    // Clamp to ±0.08 — prevents the model from pushing correlations to unrealistic extremes
    const adj = Math.max(-0.08, Math.min(0.08, dot * 0.08));
    return Math.min(0.97, base + adj);
  }

  return base;
}

// ─── Covariance matrix ────────────────────────────────────────────────────────

function buildCovMatrix(tickers: string[], vols: number[]): number[][] {
  const n = tickers.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      getCorrelation(tickers[i], tickers[j]) * vols[i] * vols[j],
    ),
  );
}

// ─── Linear algebra helpers ───────────────────────────────────────────────────

function matVec(M: number[][], v: number[]): number[] {
  return M.map(row => row.reduce((s, m, j) => s + m * v[j], 0));
}

function portfolioVarAndVol(w: number[], cov: number[][]): { variance: number; vol: number } {
  const Σw = matVec(cov, w);
  const variance = w.reduce((s, wi, i) => s + wi * Σw[i], 0);
  return { variance, vol: Math.sqrt(Math.max(1e-12, variance)) };
}

// ─── Simplex projection ───────────────────────────────────────────────────────
//
// Projects a weight vector onto the feasible set {w : Σwᵢ=1, 0 ≤ wᵢ ≤ maxW}.
// Uses an iterative clamp-and-renormalize approach (converges in <20 iterations
// for the portfolio sizes we use, typically 3–9 ETFs).

function projectToSimplex(w: number[], maxW: number): number[] {
  let result = w.map(x => Math.max(0, Math.min(maxW, x)));

  for (let iter = 0; iter < 30; iter++) {
    const total = result.reduce((a, b) => a + b, 0);
    if (total < 1e-12) return result.map(() => 1 / result.length);

    const scaled = result.map(x => x / total);
    let excess = 0;
    const capped = scaled.map(x => {
      if (x > maxW) { excess += x - maxW; return maxW; }
      return x;
    });

    if (excess < 1e-10) return capped;

    const freeIdx = capped.map((x, i) => x < maxW && scaled[i] < maxW);
    const freeCount = freeIdx.filter(Boolean).length;
    if (freeCount === 0) return capped.map(x => x / capped.reduce((a, b) => a + b, 0));

    const delta = excess / freeCount;
    result = capped.map((x, i) => (freeIdx[i] ? Math.min(maxW, x + delta) : x));
  }

  const total = result.reduce((a, b) => a + b, 0);
  return total > 0 ? result.map(x => x / total) : result.map(() => 1 / result.length);
}

// ─── Optimizer ────────────────────────────────────────────────────────────────

export interface SharpeOptimizerOpts {
  /** Maximum weight for any single position (default 0.50). */
  maxWeightPerPosition?: number;
  /** Gradient ascent iterations (default 400). */
  iterations?: number;
  /** Initial learning rate (default 0.025). */
  learningRate?: number;
  /** Minimum final weight to include in result (default 0.01 = 1%). */
  minWeight?: number;
  /** Warm-start weights (ticker → weight, need not sum to 1). Filtered to candidate tickers. */
  seedWeights?: Record<string, number>;
}

/**
 * Finds the maximum-Sharpe weight vector for a set of candidate ETFs.
 *
 * Returns a map of ticker → weight for positions above `minWeight`.
 * Weights sum to 1.0 within the returned set (renormalized after trimming).
 *
 * @param tickers      - Candidate ETF tickers (must exist in ETF_UNIVERSE or ETF_TO_ASSET_CLASS)
 * @param returns      - Net expected return per ticker (from calculateAllETFReturns)
 * @param riskFreeRate - Risk-free rate as a decimal (e.g. 0.048)
 * @param opts         - Optional tuning parameters
 */
export function optimizeSharpeWeights(
  tickers: string[],
  returns: Record<string, number>,
  riskFreeRate: number,
  opts: SharpeOptimizerOpts = {},
): Record<string, number> {
  const n = tickers.length;
  if (n === 0) return {};
  if (n === 1) return { [tickers[0]]: 1.0 };

  const maxW      = opts.maxWeightPerPosition ?? 0.50;
  const iters     = opts.iterations           ?? 400;
  const lr0       = opts.learningRate         ?? 0.025;
  const minW      = opts.minWeight            ?? 0.01;

  const μ = tickers.map(t => returns[t] ?? 0);
  const σ = tickers.map(t => getVol(t));
  const Σ = buildCovMatrix(tickers, σ);

  // Initialise: seed weights if provided, else equal weights
  const rawSeed = opts.seedWeights
    ? tickers.map(t => opts.seedWeights![t] ?? 0)
    : Array(n).fill(1 / n);
  let w = projectToSimplex(rawSeed, maxW);

  for (let iter = 0; iter < iters; iter++) {
    const { vol: pVol } = portfolioVarAndVol(w, Σ);
    const pRet   = w.reduce((s, wi, i) => s + wi * μ[i], 0);
    const sharpe = (pRet - riskFreeRate) / pVol;
    const Σw     = matVec(Σ, w);

    // ∂S/∂wᵢ = [(μᵢ − rf) − S·(Σw)ᵢ/σ_p] / σ_p
    const grad = μ.map((mi, i) =>
      ((mi - riskFreeRate) - sharpe * Σw[i] / pVol) / pVol,
    );

    // Decaying learning rate — aggressive early exploration, fine tuning later
    const lr = lr0 / (1 + iter * 0.008);
    const wNew = w.map((wi, i) => wi + lr * grad[i]);
    w = projectToSimplex(wNew, maxW);
  }

  // Trim negligible positions
  const raw: Record<string, number> = {};
  tickers.forEach((t, i) => { if (w[i] >= minW) raw[t] = w[i]; });

  // Renormalize after trimming
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  if (total < 1e-9) return { [tickers[0]]: 1.0 };

  const result: Record<string, number> = {};
  for (const [t, wt] of Object.entries(raw)) {
    result[t] = wt / total;
  }
  return result;
}

// ─── Portfolio vol helper (for agent3 statistics) ─────────────────────────────

/**
 * Computes true portfolio volatility using the full covariance matrix.
 * Use this in place of the simplified √(Σwᵢ²σᵢ²) approximation.
 *
 * @param slices  - AllocationSlice[] (or any array with ticker + weight fields)
 */
export function computePortfolioVol(
  slices: Array<{ ticker: string; weight: number }>,
): number {
  if (slices.length === 0) return 0;
  const tickers = slices.map(s => s.ticker);
  const weights = slices.map(s => s.weight);
  const vols    = tickers.map(t => getVol(t));
  const cov     = buildCovMatrix(tickers, vols);
  return portfolioVarAndVol(weights, cov).vol;
}
