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

type TabId = 'overview' | 'allocation' | 'projections' | 'tax' | 'risk';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview',    label: 'Overview' },
  { id: 'allocation',  label: 'Allocation' },
  { id: 'projections', label: 'Projections' },
  { id: 'tax',         label: 'Tax Strategy' },
  { id: 'risk',        label: 'Risk Analysis' },
];

const SCORE_COLOR = (s: number) =>
  s >= 85 ? 'text-emerald-400' :
  s >= 75 ? 'text-green-400' :
  s >= 60 ? 'text-amber-400' : 'text-red-400';

export default function ResultsDashboard({ plan, onBack }: ResultsDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const score = plan.criticScore.scores.overall;

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
          <div className="flex gap-3 text-xs text-slate-500">
            <span>{plan.portfolio.allocation.length} holdings</span>
            <span>·</span>
            <span>{(plan.portfolio.statistics.expectedReturn * 100).toFixed(1)}% exp. return</span>
            <span>·</span>
            <span>Sharpe {plan.portfolio.statistics.sharpeRatio.toFixed(2)}</span>
            <span>·</span>
            <span className="capitalize">{plan.riskAnalysis.riskLevel} risk</span>
            <span>·</span>
            <span>{plan.economicIntel.dataSource === 'live' ? '🟢 live data' : '📦 cached data'}</span>
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
      <div className="flex gap-1 bg-slate-900 border border-white/8 rounded-xl p-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
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
