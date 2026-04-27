'use client';

import {
  LayoutDashboard, TrendingUp, PieChart, Target, Receipt, ShieldCheck, Sparkles, Layers, BarChart2,
} from 'lucide-react';
import type { V3Plan } from '@/lib/agents/types';

export type SectionId = 'overview' | 'performance' | 'allocation' | 'holdings' | 'projections' | 'tax' | 'risk' | 'benchmark' | 'insights';

interface NavItem {
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview',    label: 'Overview',     icon: LayoutDashboard },
  { id: 'performance', label: 'Performance',  icon: TrendingUp },
  { id: 'allocation',  label: 'Allocation',   icon: PieChart },
  { id: 'holdings',   label: 'Holdings',     icon: Layers },
  { id: 'projections', label: 'Projections',  icon: Target },
  { id: 'tax',         label: 'Tax Strategy', icon: Receipt },
  { id: 'risk',        label: 'Risk',         icon: ShieldCheck },
  { id: 'benchmark',   label: 'Benchmark',    icon: BarChart2 },
];

function scoreLabel(s: number) {
  if (s >= 85) return { color: 'text-[#3DD68C]',  ring: 'border-[#3DD68C]/30',  label: 'Excellent' };
  if (s >= 75) return { color: 'text-indigo-400', ring: 'border-indigo-500/30', label: 'Good' };
  if (s >= 60) return { color: 'text-amber-400',  ring: 'border-amber-500/30',  label: 'Fair' };
  return             { color: 'text-red-400',    ring: 'border-red-500/30',    label: 'Review' };
}

interface DashboardSidebarProps {
  plan: V3Plan;
  active: SectionId;
  onSelect: (id: SectionId) => void;
  onReset: () => void;
}

export function DashboardSidebar({ plan, active, onSelect, onReset }: DashboardSidebarProps) {
  const score = plan.criticScore.scores.overall;
  const { color, ring, label: scoreText } = scoreLabel(score);
  const isLive = plan.economicIntel.dataSource === 'live';
  const items = plan.synthesis
    ? [...NAV_ITEMS, { id: 'insights' as SectionId, label: 'AI Insights', icon: Sparkles }]
    : NAV_ITEMS;

  return (
    <aside
      className="w-64 flex-shrink-0 flex flex-col h-full border-r border-[#1A2E45]"
      style={{ backgroundColor: '#0A1628' }}
    >
      {/* Branding */}
      <div className="px-6 py-5 border-b border-[#1A2E45]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#C9A84C20', border: '1px solid #C9A84C40' }}>
            <TrendingUp className="w-4 h-4" style={{ color: '#C9A84C' }} />
          </div>
          <div>
            <span className="font-bold text-[#E8EDF2] text-sm tracking-tight">Alpha Horizon</span>
            <span className="block text-[10px] text-[#94A3B8] tracking-widest uppercase font-medium">Institutional</span>
          </div>
        </div>
      </div>

      {/* Score card */}
      <div className="px-4 py-4 border-b border-[#1A2E45]">
        <div className={`rounded-xl p-4 border ${ring}`} style={{ backgroundColor: '#060D1A' }}>
          <p className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-widest mb-2">Portfolio Score</p>
          <div className="flex items-baseline gap-1">
            <span className={`text-4xl font-bold ${color}`}>{score}</span>
            <span className="text-[#94A3B8] text-sm font-medium">/100</span>
          </div>
          <span className={`text-xs font-semibold ${color} mt-0.5 block`}>{scoreText}</span>

          <div className="mt-3 pt-3 border-t border-[#1A2E45] space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-[#94A3B8]">{plan.portfolio.allocation.length} holdings</span>
              <span className={`font-medium capitalize ${
                plan.riskAnalysis.riskLevel === 'low' ? 'text-[#3DD68C]' :
                plan.riskAnalysis.riskLevel === 'medium' ? 'text-amber-400' : 'text-red-400'
              }`}>{plan.riskAnalysis.riskLevel} risk</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#94A3B8]">{(plan.portfolio.statistics.expectedReturn * 100).toFixed(1)}% return</span>
              <span className="text-[#94A3B8]">Sharpe {plan.portfolio.statistics.sharpeRatio.toFixed(2)}</span>
            </div>
          </div>

          <div className={`mt-3 flex items-center gap-1.5 text-xs ${isLive ? 'text-[#3DD68C]' : 'text-[#94A3B8]'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-[#3DD68C]' : 'bg-[#94A3B8]'}`} />
            {isLive ? 'Live market data' : 'Cached data'}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {items.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left ${
                isActive
                  ? 'text-[#C9A84C]'
                  : 'text-[#94A3B8] hover:text-[#E8EDF2]'
              }`}
              style={isActive ? { backgroundColor: '#C9A84C15' } : undefined}
            >
              <Icon className={`w-4 h-4 flex-shrink-0`} style={{ color: isActive ? '#C9A84C' : undefined }} />
              {label}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-[#1A2E45]">
        <button
          onClick={onReset}
          className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg transition-all"
          style={{ color: '#C9A84C', border: '1px solid #C9A84C40', backgroundColor: '#C9A84C0D' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#C9A84C20')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#C9A84C0D')}
        >
          New Analysis
        </button>
        <p className="text-[10px] text-[#94A3B8] text-center mt-3 leading-relaxed">
          For informational purposes only.<br />Not investment advice.
        </p>
      </div>
    </aside>
  );
}
