'use client';

import type { MonteCarloOutput } from '@/lib/agents/types';

interface MonteCarloSectionProps {
  monteCarlo: MonteCarloOutput;
}

function fmtDollar(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  return `$${Math.round(n / 1000)}K`;
}

const TARGET_YEARS = [1, 5, 10, 20, 30];

export function MonteCarloSection({ monteCarlo }: MonteCarloSectionProps) {
  const { projections, goalSuccessProbability, inputs } = monteCarlo;

  // projections is ProjectionPoint[] — look up each target year
  const rows = TARGET_YEARS.map(y => ({
    year: y,
    data: projections.find(p => p.year === y),
  })).filter(r => r.data !== undefined) as { year: number; data: NonNullable<(typeof projections)[number]> }[];

  const maxP90 = projections.at(-1)?.p90 ?? 1;

  const successPct = (goalSuccessProbability * 100).toFixed(0);
  const successColor =
    goalSuccessProbability >= 0.8  ? 'text-green-400' :
    goalSuccessProbability >= 0.6  ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
        <div className="flex justify-between items-start mb-2">
          <h2 className="text-lg font-semibold">Portfolio Projections</h2>
          <div className="text-right">
            <p className="text-xs text-zinc-500">Goal success probability</p>
            <p className={`text-2xl font-bold ${successColor}`}>{successPct}%</p>
          </div>
        </div>
        <p className="text-sm text-zinc-400 mb-6">
          Analytical Monte Carlo (lognormal) showing likely portfolio values over time
        </p>

        {/* Projection table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800">
              <tr className="text-left text-zinc-500">
                <th className="pb-3 font-medium">Year</th>
                <th className="pb-3 font-medium text-right">Pessimistic (p10)</th>
                <th className="pb-3 font-medium text-right">Median (p50)</th>
                <th className="pb-3 font-medium text-right">Optimistic (p90)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {rows.map(({ year, data }) => (
                <tr key={year} className="text-zinc-300">
                  <td className="py-3 font-semibold">{year}</td>
                  <td className="py-3 text-right font-mono text-red-400">
                    {fmtDollar(data.p10)}
                  </td>
                  <td className="py-3 text-right font-mono text-blue-400 font-semibold">
                    {fmtDollar(data.p50)}
                  </td>
                  <td className="py-3 text-right font-mono text-green-400">
                    {fmtDollar(data.p90)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Visual range bars */}
        <div className="mt-8">
          <p className="text-sm text-zinc-400 mb-4">Projection Range (relative to {fmtDollar(maxP90)} max)</p>
          <div className="space-y-3">
            {rows.map(({ year, data }) => (
              <div key={year} className="flex items-center gap-3">
                <span className="text-xs text-zinc-500 w-8">{year}y</span>
                <div className="flex-1 relative h-8 bg-zinc-800 rounded">
                  {/* P10–P90 band */}
                  <div
                    className="absolute h-8 bg-gradient-to-r from-red-500/30 via-blue-500/30 to-green-500/30 rounded"
                    style={{
                      left:  `${(data.p10 / maxP90) * 100}%`,
                      width: `${((data.p90 - data.p10) / maxP90) * 100}%`,
                    }}
                  />
                  {/* P50 marker */}
                  <div
                    className="absolute top-0 h-8 w-0.5 bg-blue-400"
                    style={{ left: `${(data.p50 / maxP90) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-400 w-20 text-right font-mono">
                  {fmtDollar(data.p50)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Methodology */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
        <h3 className="text-sm font-semibold mb-3">Methodology</h3>
        <p className="text-sm text-zinc-400 leading-relaxed">
          Projections use analytical Monte Carlo (lognormal distribution) based on your
          portfolio&apos;s expected return ({(inputs.annualReturn * 100).toFixed(2)}%)
          and volatility ({(inputs.annualVolatility * 100).toFixed(2)}%).
          Includes monthly contributions of ${inputs.monthlyContribution.toLocaleString()}.
          Results show 10th, 50th, and 90th percentile outcomes.
        </p>
      </div>
    </div>
  );
}
