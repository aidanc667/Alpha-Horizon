import type { Agent1Output, Agent3Output, MonteCarloOutput, ProjectionPoint } from '@/lib/agents/types';

// ─── Simulated median maximum drawdown ───────────────────────────────────────

/**
 * Simulates N monthly-step paths for a GBM portfolio and returns the median
 * peak-to-trough maximum drawdown across all paths (P50 MDD).
 *
 * Each path uses independent standard-normal draws so there is no shared
 * state between simulations. The result is the drawdown magnitude a typical
 * investor should expect to experience at some point during the horizon.
 *
 * Runs in <30ms for N=500, T=30 (180 000 arithmetic ops).
 *
 * @param mu     - annual expected return (decimal)
 * @param sig    - annual volatility (decimal)
 * @param years  - investment horizon in years
 * @param N      - number of simulated paths (default 500)
 */
export function simulateMedianMaxDrawdown(
  mu: number,
  sig: number,
  years: number,
  N = 500,
): number {
  if (years <= 0 || sig <= 0) return 0;

  const months    = Math.round(years * 12);
  const muM       = mu  / 12;               // monthly drift
  const sigM      = sig / Math.sqrt(12);    // monthly vol
  const logDrift  = muM - 0.5 * sigM * sigM;

  // Box-Muller transform: produces pairs of independent standard normals
  // deterministically seeded via counter to avoid crypto/random dependency
  let seed = 1.234567; // arbitrary fixed seed — same answers on every call
  function nextNormal(): number {
    // LCG to produce u1, u2 in (0,1)
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const u1 = (seed / 4294967296) * 0.9998 + 0.0001;
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const u2 = (seed / 4294967296) * 0.9998 + 0.0001;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  const mdds: number[] = new Array(N);

  for (let i = 0; i < N; i++) {
    let value = 1.0;
    let peak  = 1.0;
    let mdd   = 0.0;

    for (let t = 0; t < months; t++) {
      value *= Math.exp(logDrift + sigM * nextNormal());
      if (value > peak) peak = value;
      const dd = (peak - value) / peak;
      if (dd > mdd) mdd = dd;
    }

    mdds[i] = mdd;
  }

  // Return the median (P50) — sort and take the middle value
  mdds.sort((a, b) => a - b);
  return mdds[Math.floor(N / 2)];
}

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

      // Stochastic contribution FV — midpoint-horizon approximation.
      // Contributions are spread evenly over [0, y], so the average dollar is
      // invested for ~y/2 years. Applying sigma×√(y/2) as the spread prevents
      // P10≈P50≈P90 collapse for contribution-heavy portfolios (e.g. $2K initial /
      // $200/mo where contributions exceed 95% of terminal wealth at year 40).
      // Median path is unchanged; only the tails diverge realistically.
      const contribFvBase = contributionFV(pmt, mu, y);
      const halfSigSqrtY  = sig * Math.sqrt(y / 2);
      const contribP10    = contribFvBase * Math.exp(halfSigSqrtY * Z_10);
      const contribP50    = contribFvBase;
      const contribP90    = contribFvBase * Math.exp(halfSigSqrtY * Z_90);

      return {
        year: y,
        p10: Math.round(lumpP10 + contribP10),
        p50: Math.round(lumpP50 + contribP50),
        p90: Math.round(lumpP90 + contribP90),
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
