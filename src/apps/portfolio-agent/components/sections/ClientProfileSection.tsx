'use client';

import type { Agent1Output } from '@/lib/agents/types';

interface ClientProfileSectionProps {
  profile: Agent1Output;
}

export function ClientProfileSection({ profile }: ClientProfileSectionProps) {
  const { riskProfile, taxProfile, timeHorizon, goalAnalysis, constraints } = profile;

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
      <h2 className="text-lg font-semibold mb-4">Your Profile</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Risk Profile */}
        <div>
          <p className="text-sm text-zinc-400 mb-2">Risk Profile</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-blue-400">
              {riskProfile.riskScore}
            </span>
            <span className="text-zinc-500">/10</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1 capitalize">
            {riskProfile.effectiveRiskTolerance.replace('_', ' ')}
          </p>
        </div>

        {/* Tax Situation */}
        <div>
          <p className="text-sm text-zinc-400 mb-2">Tax Rate</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {(taxProfile.combinedMarginalRate * 100).toFixed(1)}
            </span>
            <span className="text-zinc-500">%</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {(taxProfile.federalMarginalRate * 100).toFixed(0)}% federal +{' '}
            {(taxProfile.stateMarginalRate * 100).toFixed(0)}% state
          </p>
        </div>

        {/* Time Horizon */}
        <div>
          <p className="text-sm text-zinc-400 mb-2">Time Horizon</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {timeHorizon.yearsToGoal}
            </span>
            <span className="text-zinc-500">years</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1 capitalize">
            {timeHorizon.bucket.replace('_', ' ')}
            {timeHorizon.isInDrawdownPhase ? ' · drawdown phase' : ''}
          </p>
        </div>
      </div>

      {/* Goal Analysis */}
      <div className="mt-6 pt-6 border-t border-zinc-800">
        <p className="text-sm text-zinc-400 mb-3">Goal Analysis</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {goalAnalysis.goalAmount > 0 && (
            <div>
              <p className="text-zinc-500">Target</p>
              <p className="font-semibold text-zinc-200">
                ${(goalAnalysis.goalAmount / 1_000_000).toFixed(2)}M
              </p>
            </div>
          )}
          {goalAnalysis.totalProjectedValue > 0 && (
            <div>
              <p className="text-zinc-500">Projected</p>
              <p className="font-semibold text-zinc-200">
                ${(goalAnalysis.totalProjectedValue / 1_000_000).toFixed(2)}M
              </p>
            </div>
          )}
          <div>
            <p className="text-zinc-500">Funded Status</p>
            <p className={`font-semibold ${
              goalAnalysis.fundedStatus >= 1   ? 'text-green-400' :
              goalAnalysis.fundedStatus >= 0.7 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {(goalAnalysis.fundedStatus * 100).toFixed(0)}%
            </p>
          </div>
          <div>
            <p className="text-zinc-500">Feasibility</p>
            <p className={`font-semibold capitalize ${
              goalAnalysis.feasibility === 'achievable'          ? 'text-green-400' :
              goalAnalysis.feasibility === 'stretch'             ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {goalAnalysis.feasibility.replace('_', ' ')}
            </p>
          </div>
        </div>
      </div>

      {/* Hard Stops */}
      {constraints.hardStops.length > 0 && (
        <div className="mt-4 p-4 bg-red-950/30 border border-red-900/50 rounded-lg">
          <p className="text-sm font-semibold text-red-400 mb-2">⚠ Action Required</p>
          <ul className="text-sm text-red-300 space-y-1">
            {constraints.hardStops.map((stop, i) => (
              <li key={i}>• {stop}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {constraints.warnings.length > 0 && (
        <div className="mt-4 p-4 bg-yellow-950/20 border border-yellow-900/40 rounded-lg">
          <p className="text-sm font-semibold text-yellow-400 mb-2">Notices</p>
          <ul className="text-sm text-yellow-300/80 space-y-1">
            {constraints.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
