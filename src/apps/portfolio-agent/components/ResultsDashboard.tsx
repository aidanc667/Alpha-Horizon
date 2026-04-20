'use client';

import { useState } from 'react';
import type { V3Plan } from '@/lib/agents/types';
import { ClientProfileSection } from './sections/ClientProfileSection';
import { PortfolioAllocationSection } from './sections/PortfolioAllocationSection';
import { StatisticsSection } from './sections/StatisticsSection';
import { MonteCarloSection } from './sections/MonteCarloSection';
import { TaxOptimizationSection } from './sections/TaxOptimizationSection';
import { RiskAnalysisSection } from './sections/RiskAnalysisSection';

interface ResultsDashboardProps {
  plan: V3Plan;
  onBack: () => void;
}

type TabId = 'analysis' | 'overview' | 'allocation' | 'projections' | 'tax' | 'risk';

const SCORE_COLOR = (s: number) =>
  s >= 85 ? 'text-emerald-400' :
  s >= 75 ? 'text-green-400' :
  s >= 60 ? 'text-amber-400' : 'text-red-400';

export default function ResultsDashboard({ plan, onBack }: ResultsDashboardProps) {
  const hasSynthesis = Boolean(plan.synthesis);
  const [activeTab, setActiveTab] = useState<TabId>(hasSynthesis ? 'analysis' : 'overview');
  const score = plan.criticScore.scores.overall;

  const TABS: { id: TabId; label: string }[] = [
    ...(hasSynthesis ? [{ id: 'analysis' as TabId, label: 'Analysis' }] : []),
    { id: 'overview',    label: 'Overview' },
    { id: 'allocation',  label: 'Allocation' },
    { id: 'projections', label: 'Projections' },
    { id: 'tax',         label: 'Tax Strategy' },
    { id: 'risk',        label: 'Risk Analysis' },
  ];

  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-white/8 rounded-2xl p-5 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-bold text-base">Portfolio Plan</span>
            <span className={`font-bold font-mono text-sm ${SCORE_COLOR(score)}`}>
              {score}/100
            </span>
            {!plan.criticScore.passesThreshold && (
              <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                review suggested
              </span>
            )}
          </div>
          <div className="flex gap-3 text-xs text-slate-500 flex-wrap">
            <span>{plan.portfolio.allocation.length} holdings</span>
            <span>·</span>
            <span>{(plan.portfolio.statistics.expectedReturn * 100).toFixed(1)}% exp. return</span>
            <span>·</span>
            <span>Sharpe {plan.portfolio.statistics.sharpeRatio.toFixed(2)}</span>
            <span>·</span>
            <span className="capitalize">{plan.riskAnalysis.riskLevel} risk</span>
            <span>·</span>
            <span className={plan.economicIntel.dataSource === 'live' ? 'text-green-500' : 'text-slate-500'}>
              {plan.economicIntel.dataSource === 'live' ? '● live market data' : '● cached data'}
            </span>
          </div>
        </div>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-white/6 hover:bg-white/10 text-slate-300 rounded-xl transition-all text-sm border border-white/8 flex-shrink-0"
        >
          New Analysis
        </button>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-slate-900 border border-white/8 rounded-xl p-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}

      {activeTab === 'analysis' && plan.synthesis && (
        <div className="space-y-5">
          {/* Narrative */}
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <h2 className="text-lg font-semibold mb-4">Your Personalised Analysis</h2>
            <div className="text-sm text-zinc-300 leading-relaxed space-y-3">
              {plan.synthesis.portfolioNarrative.split('\n').filter(Boolean).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </div>

          {/* Key insights */}
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
            <h3 className="text-sm font-semibold mb-4">Key Personalisation Decisions</h3>
            <ul className="space-y-2">
              {plan.synthesis.keyInsights.map((insight, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                  <span className="text-cyan-400 mt-0.5 flex-shrink-0">→</span>
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Primary risk + next steps side-by-side on wide screens */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-zinc-900 rounded-lg border border-red-900/40 p-6">
              <h3 className="text-sm font-semibold text-red-400 mb-3">Primary Risk</h3>
              <p className="text-sm text-zinc-300 leading-relaxed">{plan.synthesis.primaryRisk}</p>
            </div>

            <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
              <h3 className="text-sm font-semibold mb-3">Next Steps</h3>
              <ol className="space-y-3">
                {plan.synthesis.actionableNextSteps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                    <span className="text-cyan-400 font-mono font-bold flex-shrink-0">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Market context note */}
          <div className="bg-zinc-900 rounded-lg border border-zinc-700/50 p-4">
            <p className="text-xs text-zinc-500">
              <span className={plan.economicIntel.dataSource === 'live' ? 'text-green-500' : 'text-zinc-500'}>
                {plan.economicIntel.dataSource === 'live' ? '● ' : '○ '}
              </span>
              {plan.economicIntel.regime.narrative}
            </p>
          </div>
        </div>
      )}

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <StatisticsSection portfolio={plan.portfolio} critic={plan.criticScore} />
          <ClientProfileSection profile={plan.clientProfile} />
          <PortfolioAllocationSection
            allocation={plan.portfolio.allocation}
            statistics={plan.portfolio.statistics}
          />
        </div>
      )}

      {activeTab === 'allocation' && (
        <PortfolioAllocationSection
          allocation={plan.portfolio.allocation}
          statistics={plan.portfolio.statistics}
          etfRationale={plan.portfolio.etfRationale}
          detailed
        />
      )}

      {activeTab === 'projections' && (
        <MonteCarloSection monteCarlo={plan.monteCarlo} />
      )}

      {activeTab === 'tax' && (
        <TaxOptimizationSection
          taxOptimization={plan.taxOptimization}
          clientProfile={plan.clientProfile}
        />
      )}

      {activeTab === 'risk' && (
        <RiskAnalysisSection
          riskAnalysis={plan.riskAnalysis}
          portfolio={plan.portfolio}
        />
      )}
    </div>
  );
}
