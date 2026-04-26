/**
 * Generates year-by-year P10/P50/P90 projection data for the forward chart.
 *
 * Uses the same closed-form lognormal + contribution FV model as
 * analyticalMonteCarlo.ts. Runs in <1ms — no simulation loop.
 */

const Z_10 = -1.2816;
const Z_90 = 1.2816;

function lognormalPercentile(v0: number, mu: number, sig: number, t: number, z: number): number {
  return v0 * Math.exp((mu - 0.5 * sig * sig) * t + sig * Math.sqrt(t) * z);
}

function contributionFV(pmt: number, annualRate: number, years: number): number {
  if (pmt === 0) return 0;
  const n = years * 12;
  const rm = Math.pow(1 + annualRate, 1 / 12) - 1;
  if (rm < 1e-9) return pmt * n;
  return pmt * ((Math.pow(1 + rm, n) - 1) / rm);
}

export interface ProjectionPoint {
  year: number;
  p10: number;
  p50: number;
  p90: number;
  contributed: number;
}

export function generateProjectionSeries(
  startingCapital: number,
  monthlyContribution: number,
  expectedReturn: number,
  volatility: number,
  years: number = 15,
): ProjectionPoint[] {
  const results: ProjectionPoint[] = [];

  for (let y = 1; y <= years; y++) {
    const lumpP10 = lognormalPercentile(startingCapital, expectedReturn, volatility, y, Z_10);
    const lumpP50 = lognormalPercentile(startingCapital, expectedReturn, volatility, y, 0);
    const lumpP90 = lognormalPercentile(startingCapital, expectedReturn, volatility, y, Z_90);

    const contribFvBase = contributionFV(monthlyContribution, expectedReturn, y);
    const halfSigSqrtY = volatility * Math.sqrt(y / 2);
    const contribP10 = contribFvBase * Math.exp(halfSigSqrtY * Z_10);
    const contribP90 = contribFvBase * Math.exp(halfSigSqrtY * Z_90);

    const contributed = Math.round(startingCapital + monthlyContribution * 12 * y);

    results.push({
      year: y,
      p10: Math.round(lumpP10 + contribP10),
      p50: Math.round(lumpP50 + contribFvBase),
      p90: Math.round(lumpP90 + contribP90),
      contributed,
    });
  }

  return results;
}
