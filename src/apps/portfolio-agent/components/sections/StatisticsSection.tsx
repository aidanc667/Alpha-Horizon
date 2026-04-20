'use client';

import type { Agent3Output, Agent6Output, CriticScores } from '@/lib/agents/types';

interface StatisticsSectionProps {
  portfolio: Agent3Output;
  critic: Agent6Output;
}

const SCORE_DIMS: { key: Exclude<keyof CriticScores, 'overall'>; label: string }[] = [
  { key: 'alignment',       label: 'Alignment' },
  { key: 'diversification', label: 'Diversification' },
  { key: 'taxEfficiency',   label: 'Tax Efficiency' },
  { key: 'costEfficiency',  label: 'Cost Efficiency' },
  { key: 'riskManagement',  label: 'Risk Management' },
];

export function StatisticsSection({ portfolio, critic }: StatisticsSectionProps) {
  const stats = portfolio.statistics;

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
      <div className="flex justify-between items-start mb-6">
        <h2 className="text-lg font-semibold">Portfolio Statistics</h2>
        <div className="text-right">
          <p className="text-sm text-zinc-400">Portfolio Score</p>
          <p className="text-2xl font-bold text-blue-400">
            {critic.scores.overall}/100
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
        <div>
          <p className="text-sm text-zinc-400 mb-1">Expected Return</p>
          <p className="text-2xl font-bold text-green-400">
            {(stats.expectedReturn * 100).toFixed(2)}%
          </p>
          <p className="text-xs text-zinc-500 mt-1">10-year annualized</p>
        </div>

        <div>
          <p className="text-sm text-zinc-400 mb-1">Volatility</p>
          <p className="text-2xl font-bold">
            {(stats.expectedVolatility * 100).toFixed(2)}%
          </p>
          <p className="text-xs text-zinc-500 mt-1">Standard deviation</p>
        </div>

        <div>
          <p className="text-sm text-zinc-400 mb-1">Sharpe Ratio</p>
          <p className="text-2xl font-bold text-blue-400">
            {stats.sharpeRatio.toFixed(3)}
          </p>
          <p className="text-xs text-zinc-500 mt-1">Risk-adjusted return</p>
        </div>

        <div>
          <p className="text-sm text-zinc-400 mb-1">Max Drawdown</p>
          <p className="text-2xl font-bold text-red-400">
            -{(stats.maxDrawdownEstimate * 100).toFixed(1)}%
          </p>
          <p className="text-xs text-zinc-500 mt-1">Estimated worst case</p>
        </div>

        <div>
          <p className="text-sm text-zinc-400 mb-1">Expense Ratio</p>
          <p className="text-2xl font-bold">
            {(stats.weightedExpenseRatio * 100).toFixed(3)}%
          </p>
          <p className="text-xs text-zinc-500 mt-1">Annual cost</p>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="mt-6 pt-6 border-t border-zinc-800">
        <p className="text-sm text-zinc-400 mb-3">Score Breakdown</p>
        <div className="space-y-2">
          {SCORE_DIMS.map(({ key, label }) => {
            const score = critic.scores[key];
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-sm text-zinc-400 w-32">{label}</span>
                <div className="flex-1 bg-zinc-800 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      score >= 90 ? 'bg-green-500' :
                      score >= 75 ? 'bg-blue-500' :
                      score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${score}%` }}
                  />
                </div>
                <span className="text-sm font-semibold w-8 text-right font-mono">
                  {score}
                </span>
              </div>
            );
          })}
        </div>

        {critic.improvementSuggestions.length > 0 && (
          <div className="mt-4 space-y-1">
            {critic.improvementSuggestions.map((s, i) => (
              <p key={i} className="text-xs text-zinc-500 italic">· {s}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
