'use client';

import type { Agent5Output, Agent1Output } from '@/lib/agents/types';

interface TaxOptimizationSectionProps {
  taxOptimization: Agent5Output;
  clientProfile: Agent1Output;
}

const PRIORITY_BORDER: Record<string, string> = {
  high:   'border-red-900/50',
  medium: 'border-yellow-900/40',
  low:    'border-zinc-700/50',
};

const PRIORITY_LABEL: Record<string, string> = {
  high:   'text-red-400',
  medium: 'text-yellow-400',
  low:    'text-zinc-400',
};

export function TaxOptimizationSection({ taxOptimization, clientProfile }: TaxOptimizationSectionProps) {
  const { recommendations, estimatedAnnualSavings, tlhPairs } = taxOptimization;

  // Dollar estimate: bps / 10000 × starting capital (use startingCapital as AUM proxy)
  const aum = clientProfile.startingCapital + clientProfile.monthlyContribution * 12;
  const dollarSavings = Math.round((estimatedAnnualSavings / 10000) * aum);

  return (
    <div className="space-y-6">
      {/* Savings summary */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Tax Optimization</h2>
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-4xl font-bold text-green-400">
            {estimatedAnnualSavings}
          </span>
          <span className="text-zinc-400">basis points / year</span>
        </div>
        {dollarSavings > 0 && (
          <p className="text-sm text-zinc-400">
            Estimated annual tax savings: ~${dollarSavings.toLocaleString()} on ${Math.round(aum / 1000)}K deployed
          </p>
        )}
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <h3 className="text-sm font-semibold mb-4">Recommendations</h3>
          <div className="space-y-4">
            {recommendations.map((rec, i) => (
              <div
                key={i}
                className={`p-4 bg-zinc-800/50 rounded-lg border ${PRIORITY_BORDER[rec.priority] ?? 'border-zinc-700/50'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-blue-400">{rec.title}</p>
                  <span className={`text-xs capitalize ${PRIORITY_LABEL[rec.priority] ?? 'text-zinc-400'}`}>
                    {rec.priority} priority
                  </span>
                </div>
                <p className="text-sm text-zinc-300">{rec.detail}</p>
                {rec.estimatedSavingsBps > 0 && (
                  <p className="text-xs text-green-400 mt-2 font-mono">
                    +{rec.estimatedSavingsBps}bps / year
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TLH pairs */}
      {tlhPairs.length > 0 && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <h3 className="text-sm font-semibold mb-2">Tax-Loss Harvesting Pairs</h3>
          <p className="text-sm text-zinc-400 mb-4">
            Swap these pairs to harvest losses while maintaining similar market exposure
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {tlhPairs.map((pair, i) => (
              <div key={i} className="p-3 bg-zinc-800/50 rounded border border-zinc-700/50">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono font-semibold text-blue-400">{pair.ticker}</span>
                  <span className="text-zinc-500">↔</span>
                  <span className="font-mono text-zinc-300">{pair.substitute}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recommendations.length === 0 && tlhPairs.length === 0 && (
        <div className="bg-zinc-900 rounded-lg border border-green-900/40 p-6 text-center">
          <p className="text-green-400 text-sm">
            Portfolio is already well tax-optimized — no significant improvements identified.
          </p>
        </div>
      )}
    </div>
  );
}
