import type { Agent1Output, Agent3Output, MonteCarloOutput, ProjectionPoint } from '@/lib/agents/types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Standard normal quantiles for the 10th and 90th percentiles. */
const Z_10 = -1.2816;
const Z_90 =  1.2816;

/** Projection checkpoints (years from today). */
const PROJECTION_YEARS = [1, 5, 10, 20, 30] as const;

// ─── Math helpers ─────────────────────────────────────────────────────────────

/**
 * Lognormal percentile for a buy-and-hold position (no contributions).
 *
 *   P = V₀ × exp((μ − ½σ²) × T + σ × √T × Z)
 *
 * @param v0  - Initial portfolio value (USD)
 * @param mu  - Expected annual return (decimal, e.g. 0.07)
 * @param sig - Annual volatility (decimal, e.g. 0.14)
 * @param t   - Horizon in years
 * @param z   - Standard normal quantile (Z_10 or Z_90; 0 for median)
 */
function lognormalPercentile(v0: number, mu: number, sig: number, t: number, z: number): number {
  return v0 * Math.exp((mu - 0.5 * sig * sig) * t + sig * Math.sqrt(t) * z);
}

/**
 * Future value of a level monthly contribution stream.
 *
 *   FV = PMT × ((1 + r_m)^n − 1) / r_m
 *
 * where r_m = (1 + annualRate)^(1/12) − 1  (monthly equivalent).
 * Falls back to PMT × n when annualRate ≈ 0 to avoid division by zero.
 *
 * @param pmt        - Monthly contribution (USD)
 * @param annualRate - Expected annual return (decimal)
 * @param years      - Number of years
 */
function contributionFV(pmt: number, annualRate: number, years: number): number {
  if (pmt === 0) return 0;
  const n  = years * 12;
  const rm = Math.pow(1 + annualRate, 1 / 12) - 1;
  if (rm < 1e-9) return pmt * n; // zero-rate edge case
  return pmt * ((Math.pow(1 + rm, n) - 1) / rm);
}

/**
 * Analytical normal CDF approximation (Abramowitz & Stegun §26.2.17).
 * Max absolute error < 7.5 × 10⁻⁸ — sufficient for goal-probability display.
 */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t * (0.319381530 +
    t * (-0.356563782 +
    t * (1.781477937 +
    t * (-1.821255978 +
    t * 1.330274429))));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Closed-form lognormal Monte Carlo approximation.
 *
 * Combines a lognormal percentile model for the invested lump sum with a
 * deterministic future-value formula for ongoing contributions. Runs in
 * pure arithmetic — no simulation loop — targeting <5ms.
 *
 * @param portfolio     - Agent 3 output supplying μ and σ
 * @param clientProfile - Agent 1 output supplying capital, contributions, horizon
 * @param years         - Override projection horizon (default 30)
 */
export function runMonteCarlo(
  portfolio: Agent3Output,
  clientProfile: Agent1Output,
  years: number = 30,
): MonteCarloOutput {
  const startTime = Date.now();

  const mu  = portfolio.statistics.expectedReturn;    // annual expected return
  const sig = portfolio.statistics.expectedVolatility; // annual volatility
  const v0  = clientProfile.startingCapital;
  const pmt = clientProfile.monthlyContribution;

  // ── Percentile projections at each checkpoint ──────────────────────────────
  const projections: ProjectionPoint[] = PROJECTION_YEARS
    .filter((y) => y <= years)
    .map((y) => {
      // Lump-sum component: three percentiles from the lognormal formula
      const lumpP10 = lognormalPercentile(v0, mu, sig, y, Z_10);
      const lumpP50 = lognormalPercentile(v0, mu, sig, y, 0);
      const lumpP90 = lognormalPercentile(v0, mu, sig, y, Z_90);

      // Contribution component: deterministic FV added to each percentile.
      // Contribution stream modelled at the expected return (median path);
      // volatility around contributions is second-order for planning purposes.
      const contribFv = contributionFV(pmt, mu, y);

      return {
        year: y,
        p10: Math.round(lumpP10 + contribFv),
        p50: Math.round(lumpP50 + contribFv),
        p90: Math.round(lumpP90 + contribFv),
      };
    });

  // ── Goal success probability ───────────────────────────────────────────────
  // P(terminal wealth ≥ goalAmount) at yearsToGoal using the lognormal CDF.
  // Terminal log-return is N((μ − ½σ²)T, σ²T).
  const goalAmount = clientProfile.goalAnalysis.goalAmount;
  const T          = clientProfile.timeHorizon.yearsToGoal;
  const contribAtGoal = contributionFV(pmt, mu, T);
  // Effective lump-sum target net of contribution growth
  const lumpTarget = Math.max(1, goalAmount - contribAtGoal);
  const drift      = (mu - 0.5 * sig * sig) * T;
  const spread     = sig * Math.sqrt(T);
  // z-score: how many std-devs above the current wealth's median path is the target?
  const z = spread > 0 ? (Math.log(lumpTarget / v0) - drift) / spread : -Infinity;
  const goalSuccessProbability = Math.min(1, Math.max(0, normCdf(-z)));

  const executionTimeMs = Date.now() - startTime;

  return {
    projections,
    goalSuccessProbability,
    inputs: {
      initialValue: v0,
      monthlyContribution: pmt,
      annualReturn: mu,
      annualVolatility: sig,
      years,
    },
    executionTimeMs,
  };
}
