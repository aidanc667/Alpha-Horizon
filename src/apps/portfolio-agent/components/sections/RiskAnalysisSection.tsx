'use client';

import type { Agent4Output, Agent3Output, RiskCheckLevel } from '@/lib/agents/types';

interface RiskAnalysisSectionProps {
  riskAnalysis: Agent4Output;
  portfolio:    Agent3Output;
}

const RISK_LEVEL_COLOR: Record<string, string> = {
  low:    'text-green-400',
  medium: 'text-yellow-400',
  high:   'text-red-400',
};

const CHECK_DOT: Record<RiskCheckLevel, string> = {
  pass: 'bg-green-500',
  warn: 'bg-yellow-500',
  flag: 'bg-red-500',
};

const CHECK_LABEL: Record<RiskCheckLevel, string> = {
  pass: 'text-green-400',
  warn: 'text-yellow-400',
  flag: 'text-red-400',
};

export function RiskAnalysisSection({ riskAnalysis, portfolio }: RiskAnalysisSectionProps) {
  const { riskLevel, passesRiskCheck, warnings, checks } = riskAnalysis;
  const stats = portfolio.statistics;

  return (
    <div className="space-y-6">
      {/* Verdict + key metrics */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Risk Assessment</h2>

        <div className="flex items-start gap-8 mb-6">
          <div>
            <p className="text-sm text-zinc-400 mb-1">Overall Risk Level</p>
            <p className={`text-3xl font-bold capitalize ${RISK_LEVEL_COLOR[riskLevel] ?? 'text-zinc-300'}`}>
              {riskLevel}
            </p>
          </div>
          <div>
            <p className="text-sm text-zinc-400 mb-1">Risk Check</p>
            {passesRiskCheck ? (
              <p className="text-sm font-semibold text-green-400">✓ Passes all checks</p>
            ) : (
              <p className="text-sm font-semibold text-yellow-400">⚠ Review warnings below</p>
            )}
          </div>
        </div>

        {/* Stats grid derived from portfolio */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-zinc-800">
          <div>
            <p className="text-xs text-zinc-500 mb-1">Max Drawdown</p>
            <p className="text-sm font-semibold text-red-400">
              -{(stats.maxDrawdownEstimate * 100).toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Volatility</p>
            <p className="text-sm font-semibold">
              {(stats.expectedVolatility * 100).toFixed(2)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Holdings</p>
            <p className="text-sm font-semibold">{portfolio.allocation.length}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Checks run</p>
            <p className="text-sm font-semibold">{checks.length}</p>
          </div>
        </div>
      </div>

      {/* Per-check results */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
        <h3 className="text-sm font-semibold mb-4">Risk Checks</h3>
        <div className="divide-y divide-zinc-800/50">
          {checks.map((check, i) => (
            <div key={i} className="py-3 flex items-start gap-3">
              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${CHECK_DOT[check.level]}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-300 font-medium">{check.name}</span>
                  <span className={`text-xs capitalize ${CHECK_LABEL[check.level]}`}>
                    {check.level}
                  </span>
                </div>
                {check.detail && (
                  <p className="text-xs text-zinc-500 mt-0.5">{check.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-zinc-900 rounded-lg border border-yellow-900/50 p-6">
          <h3 className="text-sm font-semibold text-yellow-400 mb-4">
            ⚠ Warnings ({warnings.length})
          </h3>
          <div className="space-y-3">
            {warnings.map((warning, i) => (
              <div key={i} className="p-3 bg-yellow-950/20 rounded border border-yellow-900/30">
                <p className="text-sm text-yellow-200">{warning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {warnings.length === 0 && riskLevel === 'low' && (
        <div className="bg-zinc-900 rounded-lg border border-green-900/40 p-6 text-center">
          <p className="text-green-400 text-sm">
            No material risk issues identified — portfolio is within tolerance.
          </p>
        </div>
      )}
    </div>
  );
}
