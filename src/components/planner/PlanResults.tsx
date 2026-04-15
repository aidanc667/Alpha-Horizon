'use client';

import React, { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis } from 'recharts';
import { TrendingUp, ShieldCheck, Sparkles, Target, BookOpen, ListChecks, ChevronRight, Info, Shield, Download, Brain } from 'lucide-react';
import Markdown from 'react-markdown';
import type { PersonalizedPlan, OnboardingResponses } from '@/types';
import { BUCKET_RATES } from '@/lib/constants';
import clsx from 'clsx';
import { computeTaxBreakdown } from '@/lib/taxEngine';
import type { FilingStatus } from '@/lib/taxEngine';
import { useAppContext } from '@/lib/appContext';

const COLORS = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#06b6d4'];
const fmt$ = (v: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
const fmtPct = (v: number) => v.toFixed(1)+'%';

type Tab = 'summary' | 'shortTerm' | 'longTerm' | 'retirement' | 'tax' | 'checklist' | 'report';
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'summary',    label: 'Summary',    icon: Target },
  { id: 'shortTerm',  label: 'Safety',     icon: ShieldCheck },
  { id: 'longTerm',   label: 'Growth',     icon: TrendingUp },
  { id: 'retirement', label: 'Retirement', icon: Sparkles },
  { id: 'tax',        label: 'Tax Plan',   icon: BookOpen },
  { id: 'checklist',  label: 'Checklist',  icon: ListChecks },
  { id: 'report',     label: 'AI Report',  icon: Sparkles },
];

// ─── HYSA Comparison Card ────────────────────────────────────────────────────
function HysaComparisonCard({ hysa_comparison }: { hysa_comparison: any }) {
  if (!hysa_comparison) return null;
  const { hysa_gross_rate, hysa_after_tax_rate, recommended_asset_rate, recommended_asset_name, advantage_basis_points, rationale } = hysa_comparison;
  const maxRate = Math.max(hysa_gross_rate, recommended_asset_rate) * 1.2;
  const hysaGrossWidth = Math.round((hysa_gross_rate / maxRate) * 100);
  const hysaAfterTaxWidth = Math.round((hysa_after_tax_rate / maxRate) * 100);
  const recommendedWidth = Math.round((recommended_asset_rate / maxRate) * 100);

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-emerald-600" />
        <p className="text-sm font-bold text-gray-900">Safety Bucket vs. Standard HYSA</p>
      </div>

      <div className="space-y-4">
        {/* HYSA row */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Standard HYSA (Est. 2026)</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">{hysa_gross_rate?.toFixed(1)}% gross</p>
              <p className="text-sm font-bold font-mono text-red-400">{hysa_after_tax_rate?.toFixed(1)}% after-tax</p>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gray-300 rounded-full" style={{ width: `${hysaGrossWidth}%` }} />
              </div>
              <span className="text-xs text-gray-400 w-12 text-right">{hysa_gross_rate?.toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-red-300 rounded-full" style={{ width: `${hysaAfterTaxWidth}%` }} />
              </div>
              <span className="text-xs text-red-400 w-12 text-right">{hysa_after_tax_rate?.toFixed(1)}%</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 italic">After federal 22% + CA 9.3% state taxes</p>
        </div>

        {/* Divider */}
        <div className="border-t border-dashed border-gray-200" />

        {/* Recommended asset row */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Recommended: {recommended_asset_name}</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-black font-mono text-emerald-600">{recommended_asset_rate?.toFixed(1)}% after-tax</p>
              <p className="text-xs text-emerald-600">+{advantage_basis_points} bps advantage</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-3 bg-emerald-50 rounded-full overflow-hidden border border-emerald-100">
              <div className="h-full bg-emerald-600 rounded-full transition-all duration-700" style={{ width: `${recommendedWidth}%` }} />
            </div>
            <span className="text-xs text-emerald-600 font-bold font-mono w-12 text-right">{recommended_asset_rate?.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Rationale */}
      <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
        <p className="text-xs text-emerald-700 leading-relaxed italic">"{rationale}"</p>
      </div>
    </div>
  );
}

// ─── Gap Recovery Strategies ─────────────────────────────────────────────────
function GapRecoveryCard({ plan, goal, projOut, initContrib, initYears }: {
  plan: PersonalizedPlan;
  goal: number;
  projOut: number;
  initContrib: number;
  initYears: number;
}) {
  const gap = goal - projOut;
  if (gap <= 0) return null;

  const r = plan.marketGroundedRates;
  const b = plan.summary?.bucketSizes;

  // Estimate extra monthly needed to close gap
  let extraMonthly = 0;
  if (r && b) {
    const toD2 = (v: number) => (v > 1 ? v / 100 : v);
    const blendedRate = (
      (b.shortTerm.percent / 100) * toD2(r.shortTerm.rate) +
      (b.longTerm.percent / 100) * toD2(r.longTerm.rate) +
      (b.retirement.percent / 100) * toD2(r.retirement.rate)
    );
    const rM = blendedRate / 12;
    const months = initYears * 12;
    const fvFactor = rM > 0 ? ((Math.pow(1 + rM, months) - 1) / rM) * (1 + rM) : months;
    extraMonthly = fvFactor > 0 ? Math.round(gap / fvFactor) : 0;
  }

  // +3 years impact estimate
  const extendedYears = initYears + 3;
  let extendedValue = projOut;
  if (r && b) {
    const toD = (v: number) => (v > 1 ? v / 100 : v);
    const calc = (init: number, rate: number, mo: number, yrs: number) => {
      const m = yrs * 12, rm = toD(rate) / 12;
      if (!rm) return init + mo * m;
      const gf = Math.pow(1 + rm, m);
      return init * gf + mo * ((gf - 1) / rm) * (1 + rm);
    };
    const p1 = b.shortTerm.percent / 100, p2 = b.longTerm.percent / 100, p3 = b.retirement.percent / 100;
    extendedValue = Math.round(
      calc(b.shortTerm.dollar,  r.shortTerm.rate,  initContrib * p1, extendedYears) +
      calc(b.longTerm.dollar,   r.longTerm.rate,   initContrib * p2, extendedYears) +
      calc(b.retirement.dollar, r.retirement.rate, initContrib * p3, extendedYears)
    );
  }
  const extendImpact = extendedValue - projOut;

  const strategies = [
    {
      title: 'Increased Savings Rate',
      description: `Add ${fmt$(extraMonthly)}/mo to close the ${fmt$(gap)} gap by your target date. Even a partial increase compounds significantly over time.`,
      impact: `+${fmt$(extraMonthly)}/mo closes gap`,
      color: 'emerald',
    },
    {
      title: 'Tax-Loss Harvesting',
      description: 'CA residents pay up to 37.1% combined on capital gains. Harvesting losses in taxable accounts can save $500–$3,000+/year and be reinvested to close the gap.',
      impact: 'Save $500–$3K+/yr in taxes',
      color: 'blue',
    },
    {
      title: 'Roth Conversion Ladder',
      description: 'Converting pre-tax 401(k) to Roth in lower-income years avoids future CA state taxes on withdrawals, potentially saving tens of thousands in retirement.',
      impact: 'Avoid future CA state taxes',
      color: 'purple',
    },
    {
      title: 'Asset Allocation Optimization',
      description: 'Shift 5–10% from safety bucket to growth (VTI/QQQ) if your risk tolerance allows. Higher expected CAGR on growth assets can meaningfully close a funding gap.',
      impact: 'Higher CAGR on reallocation',
      color: 'amber',
    },
    {
      title: `Extend Time Horizon +3 Years`,
      description: `Extending your horizon from ${initYears}y to ${extendedYears}y with the same contributions projects an additional ${fmt$(extendImpact)} — potentially closing your gap without any behavioral change.`,
      impact: `+${fmt$(extendImpact)} projected`,
      color: 'cyan',
    },
  ];

  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    blue:    'bg-blue-50 border-blue-200 text-blue-700',
    purple:  'bg-purple-50 border-purple-200 text-purple-700',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
    cyan:    'bg-cyan-50 border-cyan-200 text-cyan-700',
  };
  const impactColorMap: Record<string, string> = {
    emerald: 'text-emerald-600 bg-emerald-100',
    blue:    'text-blue-600 bg-blue-100',
    purple:  'text-purple-600 bg-purple-100',
    amber:   'text-amber-600 bg-amber-100',
    cyan:    'text-cyan-600 bg-cyan-100',
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">Gap Recovery Strategies</p>
        <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{fmt$(gap)} gap</span>
      </div>
      <p className="text-xs text-gray-500">Your projected outcome is {fmt$(gap)} short of your {fmt$(goal)} goal. Here are 5 actionable paths to close it:</p>
      <div className="space-y-2">
        {strategies.map((s, i) => (
          <div key={i} className="flex gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
            <div className="w-7 h-7 rounded-lg bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">{i+1}</div>
            <div className="flex-1 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-gray-900">{s.title}</p>
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600 flex-shrink-0">{s.impact}</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{s.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Bucket Strategy Card ────────────────────────────────────────────────────
function BucketCard({ strategy, rates, accent, isSafety = false }: { strategy: any; rates?: any; accent: string; isSafety?: boolean }) {
  if (!strategy) return null;

  // Build pie data — for safety, add cash slice if cash_allocation_pct present
  const assetSlices = (strategy.assets || []).map((a: any) => ({ name: a.ticker, value: a.percentage }));
  let pieData = assetSlices;
  if (isSafety && strategy.cash_allocation_pct > 0) {
    // Scale existing assets down proportionally to accommodate cash
    const cashPct = strategy.cash_allocation_pct;
    const nonCashTotal = assetSlices.reduce((s: number, a: any) => s + a.value, 0);
    const scaled = nonCashTotal > 0
      ? assetSlices.map((a: any) => ({ ...a, value: Math.round(a.value * (100 - cashPct) / nonCashTotal) }))
      : assetSlices;
    pieData = [...scaled, { name: 'CASH', value: cashPct }];
  }

  const allColors = isSafety
    ? [...COLORS, '#94a3b8'] // slate for cash
    : COLORS;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Banner — Item 3: all text white and fully opaque */}
      <div className={`p-6 rounded-xl border bg-gradient-to-br ${accent}`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-white mb-1">{strategy.name}</p>
            <p className="text-2xl font-bold text-white">{fmt$(strategy.estimatedDollarAmount)}</p>
            <p className="text-sm text-white mt-1">{strategy.allocationPercent}% of portfolio</p>
          </div>
          {rates && (
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-white">Proj. Rate</p>
              <p className="text-xl font-bold text-white">{fmtPct(rates.rate > 1 ? rates.rate : rates.rate * 100)}</p>
              <p className="text-xs text-white/90">vol: {fmtPct(rates.volatility > 1 ? rates.volatility : rates.volatility * 100)}</p>
            </div>
          )}
        </div>
        <p className="text-sm text-white/90 leading-relaxed">{strategy.explanation}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Assets — Item 7: show cash allocation as separate line item */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Holdings &amp; Allocation</p>
          {(strategy.assets || []).filter((a: any) => a.ticker !== 'CASH').map((a: any, i: number) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-gray-200 last:border-0">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                <div>
                  <span className="text-sm font-bold text-gray-900 font-mono">{a.ticker}</span>
                  <p className="text-xs text-gray-600">{a.name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-gray-900">{a.percentage}%</p>
                <p className="text-xs text-gray-600">{fmtPct(a.projectedCAGR > 1 ? a.projectedCAGR : a.projectedCAGR * 100)} CAGR</p>
              </div>
            </div>
          ))}
          {/* Cash line item for safety bucket */}
          {isSafety && strategy.cash_allocation_pct > 0 && (
            <div className="flex items-center justify-between py-2 border-t border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full flex-shrink-0 bg-slate-400" />
                <div>
                  <span className="text-sm font-bold text-gray-900 font-mono">CASH</span>
                  <p className="text-xs text-gray-600">FDIC Savings / HYSA — Emergency Access</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-gray-900">{strategy.cash_allocation_pct}%</p>
                <p className="text-xs text-gray-500 italic">Immediate liquidity</p>
              </div>
            </div>
          )}
          {isSafety && strategy.cash_rationale && (
            <p className="text-xs text-gray-500 italic pt-1">{strategy.cash_rationale}</p>
          )}
        </div>

        {/* Pie chart */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Allocation</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} strokeWidth={2} stroke="#0F1117">
                {pieData.map((_: any, i: number) => <Cell key={i} fill={allColors[i % allColors.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#161820', border: '1px solid #252836', borderRadius: 8, fontSize: 11 }}
                formatter={(v: any, n: any) => [`${v}%`, n]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* HYSA Comparison — Item 4: only shown for safety bucket */}
      {isSafety && strategy.hysa_comparison && (
        <HysaComparisonCard hysa_comparison={strategy.hysa_comparison} />
      )}

      {/* Rationales */}
      <div className="space-y-3">
        {(strategy.assets || []).map((a: any, i: number) => (
          <div key={i} className="flex gap-3 p-4 bg-white rounded-xl border border-gray-200">
            <div className="w-1 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
            <div>
              <p className="text-xs font-bold text-gray-900 mb-1">{a.ticker} — Why this asset?</p>
              <p className="text-xs text-gray-600 leading-relaxed">{a.rationale}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Results Component ──────────────────────────────────────────────────
interface Props {
  plan: PersonalizedPlan;
  responses: OnboardingResponses;
  taxLoading?: boolean;
}

export default function PlanResults({ plan, responses, taxLoading }: Props) {
  const [tab, setTab] = useState<Tab>('summary');
  // Strip commas before parsing (user input stored as "200,000" etc.)
  const parseNum = (v: any) => Number(String(v || '').replace(/,/g, '')) || 0;
  const goal = parseNum(responses.goalAmount) || 1_000_000;
  const projOut = plan.summary?.projectedOutcome || 0;
  const successProb = Math.round((plan.summary?.successProbability || 0) * 100);
  const isOnTrack = projOut >= goal;
  const initContrib    = parseNum(responses.monthlyContribution);
  const initYears      = Number(responses.timeline) || 10;
  const startingAmount = parseNum(responses.startingAmount);
  const [contrib, setContrib] = useState(initContrib);
  const [years,   setYears]   = useState(initYears);

  const whatIfValue = useMemo(() => {
    if (contrib === initContrib && years === initYears) return projOut;
    const r = plan.marketGroundedRates;
    const b = plan.summary?.bucketSizes;
    if (!r || !b) return projOut;
    const toD = (v: number) => (v > 1 ? v / 100 : v); // handle pct vs decimal
    const calc = (init: number, rate: number, mo: number, yrs: number) => {
      const m = yrs * 12, rm = toD(rate) / 12;
      if (!rm) return init + mo * m;
      const gf = Math.pow(1 + rm, m);
      return init * gf + mo * ((gf - 1) / rm) * (1 + rm);
    };
    const p1 = b.shortTerm.percent / 100, p2 = b.longTerm.percent / 100, p3 = b.retirement.percent / 100;
    return Math.round(
      calc(b.shortTerm.dollar,  r.shortTerm.rate,  contrib * p1, years) +
      calc(b.longTerm.dollar,   r.longTerm.rate,   contrib * p2, years) +
      calc(b.retirement.dollar, r.retirement.rate, contrib * p3, years)
    );
  }, [contrib, years, plan, initContrib, initYears, projOut]);

  const progressPct = Math.min(100, Math.round((whatIfValue / goal) * 100));

  const taxBreakdown = useMemo(() => {
    const taxableIncome = plan.taxAlphaData?.taxProfile?.taxableIncome;
    if (!taxableIncome || taxableIncome <= 0) return null;
    const statusRaw = String(responses.taxFilingStatus || 'Single').toLowerCase();
    const filingStatus: FilingStatus = statusRaw.includes('married') ? 'mfj' : 'single';
    return computeTaxBreakdown(taxableIncome, filingStatus);
  }, [plan.taxAlphaData, responses.taxFilingStatus]);

  const { navigateToAdvisor } = useAppContext();
  const handlePrint = () => window.print();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero */}
      <div className="rounded-2xl p-6 border border-gray-200" style={{background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 50%, #f0f9ff 100%)'}}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 mb-1">Strategy Generated</p>
            <h2 className="text-xl font-bold text-gray-900">Your 3-Bucket Allocation Plan</h2>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={navigateToAdvisor}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
            >
              <Brain className="w-3.5 h-3.5" />
              Send to PIA
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Export PDF
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Projected Outcome', value: fmt$(projOut), sub: `${successProb}% success prob.`, color: 'text-emerald-600', bg: 'bg-white border border-emerald-100' },
            { label: 'Goal Target', value: fmt$(goal), sub: isOnTrack ? '✓ On Track' : '⚠ Gap Identified', color: isOnTrack ? 'text-emerald-600' : 'text-amber-600', bg: 'bg-white border border-gray-100' },
            { label: 'Timeline', value: `${initYears}y`, sub: plan.riskProfile?.summary || 'Custom Profile', color: 'text-blue-600', bg: 'bg-white border border-blue-100' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-4`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{s.label}</p>
              <p className={`text-xl font-black font-mono ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 overflow-x-auto scrollbar-none border-b border-gray-200 mb-6">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={clsx('flex items-center gap-1.5 px-3 text-xs whitespace-nowrap transition-colors flex-shrink-0',
                tab === t.id
                  ? 'text-gray-900 font-semibold border-b-2 border-gray-900 pb-2'
                  : 'text-gray-500 hover:text-gray-700 pb-2 border-b-2 border-transparent font-medium')}>
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {/* SUMMARY */}
        {tab === 'summary' && (
          <div className="space-y-5 animate-fade-in">
            {/* What-If */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-gray-900">What-If Strategy Lab</p>
                <span className={clsx('text-xs font-mono px-2 py-0.5 rounded-full', whatIfValue >= goal ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
                  {whatIfValue >= goal ? 'On Track' : 'Gap Identified'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-5">
                {[
                  { label: 'Monthly Contribution', val: fmt$(contrib), min: 0, max: 25000, step: 100, value: contrib, onChange: setContrib },
                  { label: 'Time Horizon (Years)', val: `${years}y`,   min: 1, max: 50,    step: 1,   value: years,   onChange: setYears },
                ].map(s => (
                  <div key={s.label} className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{s.label}</span>
                      <span className="text-xs font-bold font-mono text-emerald-600">{s.val}</span>
                    </div>
                    <input type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                      onChange={e => s.onChange(Number(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-emerald-500" />
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t border-gray-200">
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Total User Contributed</p>
                    <p className="text-sm font-bold text-gray-700">{fmt$(startingAmount + contrib * years * 12)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-0.5">Projected Outcome</p>
                    <p className="text-lg font-black font-mono text-gray-900">{fmt$(whatIfValue)}</p>
                  </div>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className={clsx('h-full rounded-full transition-all duration-500', whatIfValue >= goal ? 'bg-emerald-600' : 'bg-amber-600')}
                    style={{ width: `${progressPct}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                  <p className="text-xs text-gray-500">Goal: {fmt$(goal)}</p>
                  <p className="text-xs text-gray-500">Success Probability: <span className={clsx('font-bold', successProb >= 70 ? 'text-emerald-600' : successProb >= 40 ? 'text-amber-600' : 'text-red-500')}>{successProb}%</span></p>
                </div>
              </div>
            </div>

            {/* Bucket overview */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Safety Bucket',     ...plan.summary.bucketSizes.shortTerm,  color: 'text-emerald-600' },
                { label: 'Growth Bucket',     ...plan.summary.bucketSizes.longTerm,   color: 'text-blue-600' },
                { label: 'Retirement Bucket', ...plan.summary.bucketSizes.retirement, color: 'text-purple-700' },
              ].map(b => (
                <div key={b.label} className="bg-white border border-gray-100 rounded-xl shadow-md p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{b.label}</p>
                  <p className={`text-xl font-black font-mono ${b.color}`}>{b.percent}%</p>
                  <p className="text-xs font-mono text-gray-600">{fmt$(b.dollar)}</p>
                </div>
              ))}
            </div>

            {/* Takeaways */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-3">
              <p className="text-xs font-bold text-gray-900">Key Strategic Takeaways</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(plan.summary.keyTakeaways || []).map((t, i) => (
                  <div key={i} className="flex gap-3 p-3 bg-slate-50 rounded-xl">
                    <div className="w-5 h-5 rounded-full bg-emerald-600/10 text-emerald-600 flex items-center justify-center text-xs font-bold flex-shrink-0">{i+1}</div>
                    <p className="text-xs text-gray-600 leading-relaxed">{t}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk profile */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
              <p className="text-xs font-bold text-gray-900 mb-3">Risk Profile</p>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Capacity</p>
                  <p className="text-gray-700">{plan.riskProfile?.capacity}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Tolerance</p>
                  <p className="text-gray-700">{plan.riskProfile?.tolerance}</p>
                </div>
                <div className="col-span-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <p className="text-emerald-700 italic">"{plan.riskProfile?.summary}"</p>
                </div>
              </div>
            </div>

            {/* Gap Recovery Strategies — at the bottom of summary */}
            <GapRecoveryCard
              plan={plan}
              goal={goal}
              projOut={whatIfValue}
              initContrib={contrib}
              initYears={years}
            />
          </div>
        )}

        {tab === 'shortTerm' && (
          <BucketCard
            strategy={plan.shortTermStrategy}
            rates={plan.marketGroundedRates?.shortTerm}
            accent="from-emerald-900/50 to-[#161820] border-emerald-900/30"
            isSafety={true}
          />
        )}
        {tab === 'longTerm' && <BucketCard strategy={plan.longTermStrategy} rates={plan.marketGroundedRates?.longTerm} accent="from-blue-900/50 to-[#161820] border-blue-900/30" />}
        {tab === 'retirement' && (
          <div className="space-y-5 animate-fade-in">
            <BucketCard strategy={plan.retirementStrategy?.allocation} rates={plan.marketGroundedRates?.retirement} accent="from-purple-900/50 to-[#161820] border-purple-900/30" />
            {plan.retirementStrategy?.assetLocationGuidance && (
              <div className="flex gap-3 p-4 bg-white rounded-xl border border-purple-900/30">
                <Info className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-600 leading-relaxed italic">{plan.retirementStrategy.assetLocationGuidance}</p>
              </div>
            )}
          </div>
        )}

        {/* TAX PLAN */}
        {tab === 'tax' && (
          <div className="space-y-5 animate-fade-in">
            {taxLoading && (
              <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="text-sm text-blue-700 font-medium">Generating tax optimization analysis...</p>
              </div>
            )}

            {/* Tax Alpha Header Banner */}
            {plan.taxAlphaData && (
              <div className="rounded-xl p-6 border border-emerald-200" style={{background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'}}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                      </div>
                      <p className="text-sm font-bold text-emerald-800">Institutional Tax-Alpha Engine</p>
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 mb-2">Institutional Asset Location &amp; TEY Logic</p>
                    <p className="text-xs text-emerald-700 max-w-lg leading-relaxed">{plan.taxAlphaData.explanation}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-6">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 mb-1">Estimated Tax Alpha</p>
                    <p className="text-3xl font-extrabold font-mono text-emerald-600">+{plan.taxAlphaData.totalAlphaPct?.toFixed(2)}%</p>
                    <p className="text-xs text-emerald-600">annually vs 60% VOO / 40% BND benchmark</p>
                  </div>
                </div>
              </div>
            )}

            {/* Tax-Efficient Placement Matrix */}
            {plan.taxAlphaData?.assetPlacementMatrix && (
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
                <div>
                  <p className="text-sm font-bold text-gray-900">Tax-Efficient Placement Matrix</p>
                  <p className="text-xs text-gray-500 mt-0.5">Where to place each asset for maximum after-tax wealth accumulation.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {plan.taxAlphaData.assetPlacementMatrix.map((account: any, i: number) => {
                    const colorMap: Record<string, {bg: string, border: string, label: string, badge: string, tickerBg: string}> = {
                      emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700', tickerBg: 'bg-white border border-emerald-200 text-emerald-800' },
                      blue:    { bg: 'bg-blue-50',    border: 'border-blue-200',    label: 'text-blue-700',    badge: 'bg-blue-100 text-blue-700',    tickerBg: 'bg-white border border-blue-200 text-blue-800' },
                      purple:  { bg: 'bg-purple-50',  border: 'border-purple-200',  label: 'text-purple-700',  badge: 'bg-purple-100 text-purple-700',  tickerBg: 'bg-white border border-purple-200 text-purple-800' },
                      amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',   label: 'text-amber-700',   badge: 'bg-amber-100 text-amber-700',   tickerBg: 'bg-white border border-amber-200 text-amber-800' },
                    };
                    const c = colorMap[account.accentColor] || colorMap.emerald;
                    return (
                      <div key={i} className={`rounded-xl p-4 border ${c.bg} ${c.border} space-y-3`}>
                        <p className={`text-xs font-semibold uppercase tracking-wide ${c.label}`}>{account.accountType}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(account.assets || []).map((a: any, j: number) => (
                            <span key={j} className={`text-xs font-mono font-bold px-2 py-1 rounded-lg ${c.tickerBg}`}>{a.ticker}</span>
                          ))}
                        </div>
                        <p className="text-xs text-gray-600 italic leading-relaxed">{account.strategy}</p>
                        {(account.assets || []).map((a: any, j: number) => (
                          <div key={j} className="flex gap-2 text-xs text-gray-600">
                            <span className={`font-mono font-bold flex-shrink-0 ${c.label}`}>{a.ticker}:</span>
                            <span className="leading-relaxed">{a.reason}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* CA After-Tax Yield Comparison Table */}
            {plan.taxAlphaData?.caAfterTaxYields && (
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
                <div>
                  <p className="text-sm font-bold text-gray-900">2026 After-Tax Yield Comparison — California Resident</p>
                  <p className="text-xs text-gray-500 mt-0.5">All yields adjusted for your federal {plan.taxAlphaData.taxProfile?.marginalFederal}% + CA {plan.taxAlphaData.taxProfile?.marginalCA}% marginal brackets. Every basis point counts.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 pr-4 font-semibold uppercase text-gray-500 tracking-wide">Asset</th>
                        <th className="text-right py-2 px-3 font-semibold uppercase text-gray-500 tracking-wide">Nominal</th>
                        <th className="text-right py-2 px-3 font-semibold uppercase text-gray-500 tracking-wide">After-Tax (CA)</th>
                        <th className="text-center py-2 pl-3 font-semibold uppercase text-gray-500 tracking-wide">Rating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {plan.taxAlphaData.caAfterTaxYields.map((row: any, i: number) => {
                        const recColor = row.recommendation === 'Best' ? 'bg-emerald-100 text-emerald-700' :
                                         row.recommendation === 'Good' ? 'bg-blue-100 text-blue-700' :
                                         row.recommendation === 'Avoid' || row.recommendation?.startsWith('Avoid') ? 'bg-red-100 text-red-700' :
                                         row.recommendation === 'Hold in Tax-Adv' ? 'bg-amber-100 text-amber-700' :
                                         'bg-gray-100 text-gray-600';
                        const afterTaxColor = row.afterTaxYield >= 3.5 ? 'text-emerald-600 font-bold' :
                                              row.afterTaxYield >= 2.5 ? 'text-blue-600 font-semibold' :
                                              'text-red-500';
                        return (
                          <tr key={i} className="hover:bg-gray-50 transition-colors">
                            <td className="py-2.5 pr-4">
                              <span className="font-mono font-bold text-gray-900">{row.ticker}</span>
                              <span className="text-gray-400 ml-2">{row.name}</span>
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-600">{row.nominalYield?.toFixed(2)}%</td>
                            <td className={`py-2.5 px-3 text-right ${afterTaxColor}`}>{row.afterTaxYield?.toFixed(2)}%</td>
                            <td className="py-2.5 pl-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${recColor}`}>{row.recommendation}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400 italic">* Yields for income-producing assets. Equity CAGR projections shown in bucket tabs. After-tax calculated using marginal rates.</p>
              </div>
            )}

            {/* Roth IRA vs 401k Comparison */}
            {plan.taxAlphaData?.rothVs401k && (
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Roth IRA vs. Traditional 401k — Which is Better For You?</p>
                    <p className="text-xs text-gray-500 mt-0.5">{plan.taxAlphaData.rothVs401k.headline}</p>
                  </div>
                  <span className={`flex-shrink-0 ml-4 text-xs font-bold px-3 py-1.5 rounded-full ${
                    plan.taxAlphaData.rothVs401k.recommendation === 'both' ? 'bg-emerald-100 text-emerald-700' :
                    plan.taxAlphaData.rothVs401k.recommendation === 'roth_first' ? 'bg-blue-100 text-blue-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {plan.taxAlphaData.rothVs401k.recommendation === 'both' ? 'Use Both' :
                     plan.taxAlphaData.rothVs401k.recommendation === 'roth_first' ? 'Roth First' : '401k First'}
                  </span>
                </div>

                {/* Comparison table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 pr-4 font-semibold uppercase text-gray-500 tracking-wide w-1/3">Factor</th>
                        <th className="text-left py-2 px-3 font-semibold uppercase text-blue-600 tracking-wide w-1/3">Roth IRA</th>
                        <th className="text-left py-2 pl-3 font-semibold uppercase text-purple-700 tracking-wide w-1/3">Traditional 401k</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {plan.taxAlphaData.rothVs401k.comparisonRows.map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="py-2.5 pr-4 font-semibold text-gray-700">{row.factor}</td>
                          <td className="py-2.5 px-3 text-gray-600 leading-relaxed">{row.roth}</td>
                          <td className="py-2.5 pl-3 text-gray-600 leading-relaxed">{row.traditional401k}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Reasoning */}
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-2">
                  <p className="text-xs font-bold text-blue-800">Why This Recommendation For You</p>
                  <p className="text-xs text-blue-700 leading-relaxed">{plan.taxAlphaData.rothVs401k.reasoning}</p>
                </div>
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl space-y-2">
                  <p className="text-xs font-bold text-emerald-800">Your Action Plan</p>
                  <p className="text-xs text-emerald-700 leading-relaxed">{plan.taxAlphaData.rothVs401k.actionPlan}</p>
                </div>
              </div>
            )}

            {/* Paycheck Waterfall */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
              <div>
                <p className="text-sm font-bold text-gray-900">Paycheck Waterfall</p>
                <p className="text-xs text-gray-500 mt-0.5">The optimal order to deploy every dollar you earn for maximum after-tax wealth.</p>
              </div>
              <div className="space-y-2">
                {(plan.paycheckWaterfall || []).map((step, i) => (
                  <div key={i} className="flex gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200 hover:border-emerald-200 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">{step.rank}</div>
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-gray-900">{step.name}</p>
                      </div>
                      <p className="text-xs text-gray-600">{step.description}</p>
                      <p className="text-xs text-emerald-600 italic">{step.reasoning}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Location Reasoning Narrative */}
            {plan.taxAlphaData?.locationReasoningNarrative && (
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-700" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 013 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.249-8.25-3.286z"/></svg>
                  <p className="text-sm font-bold text-gray-900">Why Asset Location Matters — Your Strategy Explained</p>
                </div>
                <div className="p-4 bg-purple-50 border border-purple-100 rounded-xl">
                  <p className="text-xs text-purple-800 leading-relaxed whitespace-pre-line">{plan.taxAlphaData.locationReasoningNarrative}</p>
                </div>
              </div>
            )}

            {/* Tax Profile Analysis */}
            {plan.taxAlphaData?.taxProfile && (
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Tax Profile Analysis</p>
                    <p className="text-xs text-gray-500 mt-0.5">Estimated 2026 tax impact based on your profile.</p>
                  </div>
                  <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700 uppercase tracking-wide">
                    {responses.taxFilingStatus || 'Single'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Federal Marginal Bracket', value: `${plan.taxAlphaData.taxProfile.marginalFederal}%`, color: 'text-gray-900' },
                    { label: 'CA Marginal Bracket', value: `${plan.taxAlphaData.taxProfile.marginalCA}%`, color: 'text-gray-900' },
                    { label: 'Qualified Dividend Rate', value: `${plan.taxAlphaData.taxProfile.federalQDRate ?? 15}% Fed / ${plan.taxAlphaData.taxProfile.marginalCA}% CA`, color: 'text-emerald-700' },
                    { label: 'Combined Effective Rate', value: `${plan.taxAlphaData.taxProfile.effectiveRate?.toFixed(1)}%`, color: 'text-gray-900' },
                    { label: 'Est. Federal Income Tax', value: fmt$(plan.taxAlphaData.taxProfile.estimatedFederalTax ?? Math.round(plan.taxAlphaData.taxProfile.estimatedAnnualTax * 0.65)), color: 'text-red-500' },
                    { label: 'Est. CA State Tax', value: fmt$(plan.taxAlphaData.taxProfile.estimatedCATax ?? Math.round(plan.taxAlphaData.taxProfile.estimatedAnnualTax * 0.35)), color: 'text-orange-500' },
                  ].map(item => (
                    <div key={item.label} className="bg-gray-50 rounded-xl p-4 border border-gray-100 shadow-md">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{item.label}</p>
                      <p className={`text-lg font-black font-mono leading-tight ${item.color}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
                {plan.taxAlphaData.taxProfile.taxableIncome && (
                  <div className="flex gap-4 text-xs text-gray-500 px-1">
                    <span>Taxable Income: <span className="font-mono font-semibold text-gray-700">{fmt$(plan.taxAlphaData.taxProfile.taxableIncome)}</span></span>
                    <span>Standard Deduction: <span className="font-mono font-semibold text-gray-700">{plan.taxAlphaData.taxProfile.standardDeduction2026 ?? '—'}</span></span>
                  </div>
                )}
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-1">Analysis</p>
                  <p className="text-xs text-blue-800 leading-relaxed">{plan.taxAlphaData.taxProfile.analysis}</p>
                </div>
              </div>
            )}

            {/* Marginal Tax Bracket Breakdown */}
            {taxBreakdown && (
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-5">
                <div>
                  <p className="text-sm font-bold text-gray-900">Marginal Tax Bracket Breakdown — 2026</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    How your ${taxBreakdown.taxableIncome.toLocaleString('en-US', {maximumFractionDigits:0})} taxable income flows through each bracket.
                  </p>
                </div>

                {/* Rate summary pills */}
                <div className="flex flex-wrap gap-3">
                  {[
                    { label: 'Marginal Federal', value: `${(taxBreakdown.federal.marginalRate * 100).toFixed(0)}%`, color: 'bg-blue-100 text-blue-800' },
                    { label: 'Effective Federal', value: `${(taxBreakdown.federal.effectiveRate * 100).toFixed(1)}%`, color: 'bg-blue-50 text-blue-700' },
                    { label: 'Marginal CA', value: `${(taxBreakdown.california.marginalRate * 100).toFixed(1)}%`, color: 'bg-amber-100 text-amber-800' },
                    { label: 'Combined Effective', value: `${(taxBreakdown.combined.effectiveRate * 100).toFixed(1)}%`, color: 'bg-gray-100 text-gray-700' },
                    { label: 'QD / LTCG Rate', value: `${(taxBreakdown.qdRate * 100).toFixed(0)}%`, color: 'bg-emerald-100 text-emerald-700' },
                  ].map(p => (
                    <div key={p.label} className={`px-3 py-2 rounded-xl ${p.color}`}>
                      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{p.label}</p>
                      <p className="text-lg font-black font-mono">{p.value}</p>
                    </div>
                  ))}
                </div>

                {/* Federal bracket waterfall */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Federal Bracket Waterfall</p>
                  {taxBreakdown.federal.tiers.map((tier, i) => {
                    const bracketColors = [
                      'bg-emerald-500', 'bg-teal-500', 'bg-blue-500', 'bg-indigo-500',
                      'bg-violet-500', 'bg-orange-500', 'bg-red-500',
                    ];
                    const barColor = bracketColors[i] || 'bg-gray-500';
                    const widthPct = Math.round((tier.incomeInBracket / taxBreakdown.taxableIncome) * 100);
                    const fmt$ = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
                    return (
                      <div key={i} className={`p-3 rounded-xl border ${tier.isMarginal ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-black font-mono px-2 py-0.5 rounded-lg text-white ${barColor}`}>
                              {(tier.rate * 100).toFixed(0)}%
                            </span>
                            <span className="text-xs text-gray-600">{fmt$(tier.from)} – {tier.to === Infinity ? '∞' : fmt$(tier.to)}</span>
                            {tier.isMarginal && <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">← Marginal</span>}
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-bold text-gray-700">{fmt$(tier.taxInBracket)} tax</span>
                            <span className="text-xs text-gray-400 ml-2">on {fmt$(tier.incomeInBracket)}</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(2, widthPct)}%`, opacity: tier.isMarginal ? 1 : 0.5 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Roth conversion headroom */}
                {taxBreakdown.federal.rothHeadroom > 0 && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
                    <svg className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    <div>
                      <p className="text-xs font-bold text-emerald-800">Roth Conversion Opportunity</p>
                      <p className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
                        You have <span className="font-bold font-mono">${taxBreakdown.federal.rothHeadroom.toLocaleString('en-US', {maximumFractionDigits:0})}</span> of room left in the <span className="font-bold">{(taxBreakdown.federal.marginalRate * 100).toFixed(0)}% bracket</span> before crossing into {(taxBreakdown.federal.nextBracketRate * 100).toFixed(0)}%.
                        Converting this amount from a Traditional IRA/401k to Roth now locks in today's lower rate and permanently eliminates future CA state tax on that growth.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* CHECKLIST */}
        {tab === 'checklist' && (
          <div className="space-y-3 animate-fade-in">
            {(plan.actionChecklist || []).map((item, i) => (
              <div key={i} className="flex gap-4 p-4 bg-white rounded-xl border border-gray-200">
                <div className="w-7 h-7 rounded-lg bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">{i+1}</div>
                <div className="space-y-1.5 flex-1">
                  <p className="text-sm font-bold text-gray-900">{item.action}</p>
                  <p className="text-xs text-gray-600 leading-relaxed">{item.details}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* AI REPORT */}
        {tab === 'report' && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 animate-fade-in">
            {plan.fullReport ? (
              <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-headings:font-bold prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2 prose-p:text-gray-700 prose-p:leading-relaxed prose-p:mb-4 prose-strong:text-gray-900 prose-strong:font-semibold prose-code:text-emerald-700 prose-code:bg-emerald-50 prose-li:text-gray-700 prose-a:text-emerald-600 prose-blockquote:text-gray-700 prose-blockquote:border-emerald-400">
                <Markdown>{plan.fullReport}</Markdown>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-12">
                <div className="w-8 h-8 border-2 border-emerald-600/20 border-t-emerald-600 rounded-full animate-spin" />
                <p className="text-sm text-gray-600">Generating your investment report...</p>
              </div>
            )}
          </div>
        )}

        {/* Global disclaimer */}
        <div className="mt-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl flex items-start gap-2.5">
          <Info className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500 leading-relaxed">
            <span className="font-semibold text-gray-600">© 2026 Alpha Horizon. For informational and educational purposes only. Not financial, investment, or tax advice.</span>{' '}
            Forward-looking projections are AI-synthesized estimates grounded in 2026 Capital Market Assumptions from J.P. Morgan, Vanguard, BlackRock, and Goldman Sachs, and historical factor data — they are not guaranteed returns. Past performance does not predict future results. Consult a licensed financial advisor (RIA/CFP) before making any investment decisions.
          </p>
        </div>
      </div>

      {/* ── Print-only view (hidden in browser, shown during window.print()) ── */}
      <div id="ah-print-view" className="hidden">
        <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', color: '#111827', lineHeight: '1.5', fontSize: '12px' }}>

          {/* Print Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '16px', marginBottom: '20px', borderBottom: '2px solid #059669' }}>
            <div>
              <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#059669', margin: '0 0 2px' }}>Alpha Horizon</h1>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>Personalized Financial Plan</p>
            </div>
            <div style={{ textAlign: 'right', fontSize: '10px', color: '#9ca3af' }}>
              <p style={{ margin: '0 0 2px' }}>Generated {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
              <p style={{ margin: 0 }}>© 2026 Alpha Horizon</p>
            </div>
          </div>

          {/* Summary Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginBottom: '20px' }}>
            {[
              { label: 'Projected Outcome', value: fmt$(projOut), sub: `${successProb}% success probability`, border: '#d1fae5', bg: '#f0fdf4', color: '#059669' },
              { label: 'Goal Target', value: fmt$(goal), sub: isOnTrack ? '✓ On Track' : '⚠ Gap Identified', border: '#e5e7eb', bg: '#ffffff', color: '#111827' },
              { label: 'Timeline', value: `${initYears} years`, sub: plan.riskProfile?.summary?.slice(0, 60) ?? '', border: '#dbeafe', bg: '#eff6ff', color: '#2563eb' },
            ].map(s => (
              <div key={s.label} style={{ border: `1px solid ${s.border}`, borderRadius: '8px', padding: '10px', background: s.bg }}>
                <p style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', margin: '0 0 3px', fontWeight: 600 }}>{s.label}</p>
                <p style={{ fontSize: '18px', fontWeight: '800', color: s.color, margin: '0 0 2px', fontFamily: 'monospace' }}>{s.value}</p>
                <p style={{ fontSize: '10px', color: '#6b7280', margin: 0 }}>{s.sub}</p>
              </div>
            ))}
          </div>

          {/* 3-Bucket Allocation */}
          <h2 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 8px', paddingBottom: '5px', borderBottom: '1px solid #e5e7eb' }}>3-Bucket Allocation</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginBottom: '20px' }}>
            {([
              { label: 'Safety Bucket', ...(plan.summary?.bucketSizes?.shortTerm ?? {}), color: '#059669' },
              { label: 'Growth Bucket', ...(plan.summary?.bucketSizes?.longTerm ?? {}), color: '#2563eb' },
              { label: 'Retirement Bucket', ...(plan.summary?.bucketSizes?.retirement ?? {}), color: '#7c3aed' },
            ] as Array<{ label: string; percent?: number; dollar?: number; color: string }>).map(b => (
              <div key={b.label} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px' }}>
                <p style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', margin: '0 0 3px', fontWeight: 600 }}>{b.label}</p>
                <p style={{ fontSize: '20px', fontWeight: '800', color: b.color, margin: '0 0 2px', fontFamily: 'monospace' }}>{b.percent ?? 0}%</p>
                <p style={{ fontSize: '11px', color: '#6b7280', margin: 0, fontFamily: 'monospace' }}>{fmt$(b.dollar ?? 0)}</p>
              </div>
            ))}
          </div>

          {/* Key Takeaways */}
          {(plan.summary?.keyTakeaways ?? []).length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 8px', paddingBottom: '5px', borderBottom: '1px solid #e5e7eb' }}>Key Strategic Takeaways</h2>
              <ol style={{ margin: 0, paddingLeft: '18px' }}>
                {(plan.summary.keyTakeaways || []).map((t, i) => (
                  <li key={i} style={{ fontSize: '11px', color: '#374151', marginBottom: '4px', lineHeight: '1.5' }}>{t}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Per-Bucket Holdings */}
          {([
            { label: 'Safety Bucket — Holdings', strategy: plan.shortTermStrategy, color: '#059669' },
            { label: 'Growth Bucket — Holdings', strategy: plan.longTermStrategy, color: '#2563eb' },
            { label: 'Retirement Bucket — Holdings', strategy: (plan.retirementStrategy as any)?.allocation, color: '#7c3aed' },
          ] as Array<{ label: string; strategy: any; color: string }>)
            .filter(b => Array.isArray(b.strategy?.assets) && b.strategy.assets.length > 0)
            .map(b => (
              <div key={b.label} style={{ marginBottom: '16px', pageBreakInside: 'avoid' }}>
                <h3 style={{ fontSize: '12px', fontWeight: '700', color: b.color, margin: '0 0 6px' }}>{b.label}</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '3px 8px 3px 0', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', fontSize: '9px' }}>Ticker</th>
                      <th style={{ textAlign: 'right', padding: '3px 10px 3px 0', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', fontSize: '9px' }}>Weight</th>
                      <th style={{ textAlign: 'left', padding: '3px 0', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', fontSize: '9px' }}>Rationale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(b.strategy.assets as any[]).map((a, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '4px 8px 4px 0', fontFamily: 'monospace', fontWeight: '700', color: b.color }}>{a.ticker}</td>
                        <td style={{ padding: '4px 10px 4px 0', textAlign: 'right', fontFamily: 'monospace', color: '#374151' }}>{a.percentage ?? a.weight ?? '—'}%</td>
                        <td style={{ padding: '4px 0', color: '#374151', lineHeight: '1.4' }}>{a.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {/* ── TAX PLAN ── */}
          <div style={{ pageBreakBefore: 'always' }}>

          {/* Tax Alpha Banner */}
          {plan.taxAlphaData && (
            <div style={{ background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '1px solid #6ee7b7', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '11px', fontWeight: '700', color: '#065f46', margin: '0 0 2px' }}>Institutional Tax-Alpha Engine</p>
                <p style={{ fontSize: '9px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#059669', margin: '0 0 6px' }}>Institutional Asset Location &amp; TEY Logic</p>
                <p style={{ fontSize: '10px', color: '#047857', margin: 0, lineHeight: '1.5', maxWidth: '480px' }}>{plan.taxAlphaData.explanation}</p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '16px' }}>
                <p style={{ fontSize: '9px', fontWeight: '600', textTransform: 'uppercase', color: '#059669', margin: '0 0 2px' }}>Estimated Tax Alpha</p>
                <p style={{ fontSize: '26px', fontWeight: '800', color: '#059669', margin: '0 0 2px', fontFamily: 'monospace' }}>+{plan.taxAlphaData.totalAlphaPct?.toFixed(2)}%</p>
                <p style={{ fontSize: '9px', color: '#6b7280', margin: 0 }}>annually vs 60% VOO / 40% BND</p>
              </div>
            </div>
          )}

          {/* Deterministic Tax Profile (from 2026 brackets) */}
          {taxBreakdown && (
            <div style={{ marginBottom: '16px', pageBreakInside: 'avoid' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 8px', paddingBottom: '5px', borderBottom: '1px solid #e5e7eb' }}>Tax Profile — 2026 ({responses.taxFilingStatus || 'Single'})</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '6px', marginBottom: '10px' }}>
                {[
                  { label: 'Federal Marginal', value: `${(taxBreakdown.federal.marginalRate * 100).toFixed(0)}%` },
                  { label: 'Federal Effective', value: `${(taxBreakdown.federal.effectiveRate * 100).toFixed(1)}%` },
                  { label: 'CA Marginal', value: `${(taxBreakdown.california.marginalRate * 100).toFixed(1)}%` },
                  { label: 'Combined Effective', value: `${(taxBreakdown.combined.effectiveRate * 100).toFixed(1)}%` },
                  { label: 'LTCG / QD Rate', value: `${(taxBreakdown.qdRate * 100).toFixed(0)}%` },
                ].map(p => (
                  <div key={p.label} style={{ border: '1px solid #e5e7eb', borderRadius: '6px', padding: '7px', textAlign: 'center' }}>
                    <p style={{ fontSize: '9px', color: '#6b7280', margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase' }}>{p.label}</p>
                    <p style={{ fontSize: '14px', fontWeight: '800', color: '#111827', margin: 0, fontFamily: 'monospace' }}>{p.value}</p>
                  </div>
                ))}
              </div>
              {taxBreakdown.federal.rothHeadroom > 0 && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '8px 12px' }}>
                  <p style={{ fontSize: '10px', fontWeight: '700', color: '#065f46', margin: '0 0 2px' }}>⚡ Roth Conversion Opportunity</p>
                  <p style={{ fontSize: '10px', color: '#047857', margin: 0 }}>
                    {fmt$(taxBreakdown.federal.rothHeadroom)} remaining in the {(taxBreakdown.federal.marginalRate * 100).toFixed(0)}% bracket before crossing to {(taxBreakdown.federal.nextBracketRate * 100).toFixed(0)}%. Converting Traditional IRA/401k to Roth now locks in today&apos;s lower rate permanently.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Asset Placement Matrix */}
          {plan.taxAlphaData?.assetPlacementMatrix && (
            <div style={{ marginBottom: '16px', pageBreakInside: 'avoid' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 8px', paddingBottom: '5px', borderBottom: '1px solid #e5e7eb' }}>Tax-Efficient Asset Placement Matrix</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '8px' }}>
                {plan.taxAlphaData.assetPlacementMatrix.map((account: any, i: number) => (
                  <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px' }}>
                    <p style={{ fontSize: '10px', fontWeight: '700', color: '#374151', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{account.accountType}</p>
                    <p style={{ fontSize: '10px', color: '#6b7280', margin: '0 0 6px', fontStyle: 'italic' }}>{account.strategy}</p>
                    {(account.assets || []).map((a: any, j: number) => (
                      <div key={j} style={{ display: 'flex', gap: '6px', marginBottom: '3px', fontSize: '10px' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: '700', color: '#059669', flexShrink: 0 }}>{a.ticker}:</span>
                        <span style={{ color: '#374151', lineHeight: '1.4' }}>{a.reason}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CA After-Tax Yield Comparison */}
          {plan.taxAlphaData?.caAfterTaxYields && (
            <div style={{ marginBottom: '16px', pageBreakInside: 'avoid' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 4px', paddingBottom: '5px', borderBottom: '1px solid #e5e7eb' }}>2026 After-Tax Yield Comparison — California Resident</h2>
              <p style={{ fontSize: '10px', color: '#6b7280', margin: '0 0 8px' }}>All yields adjusted for your federal {plan.taxAlphaData.taxProfile?.marginalFederal}% + CA {plan.taxAlphaData.taxProfile?.marginalCA}% marginal brackets.</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    {['Asset', 'Nominal', 'After-Tax (CA)', 'Rating'].map(h => (
                      <th key={h} style={{ padding: '3px 6px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', fontSize: '9px', textAlign: h === 'Asset' ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.taxAlphaData.caAfterTaxYields.map((row: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontWeight: '700' }}>{row.ticker} <span style={{ fontFamily: 'sans-serif', fontWeight: 400, color: '#6b7280', fontSize: '9px' }}>{row.name}</span></td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', color: '#374151' }}>{row.nominalYield?.toFixed(2)}%</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: '700', color: row.afterTaxYield >= 3.5 ? '#059669' : row.afterTaxYield >= 2.5 ? '#2563eb' : '#ef4444' }}>{row.afterTaxYield?.toFixed(2)}%</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontSize: '9px', color: row.recommendation === 'Best' ? '#059669' : row.recommendation === 'Avoid' ? '#ef4444' : '#6b7280' }}>{row.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Roth vs 401k */}
          {plan.taxAlphaData?.rothVs401k && (
            <div style={{ marginBottom: '16px', pageBreakInside: 'avoid' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 8px', paddingBottom: '5px', borderBottom: '1px solid #e5e7eb' }}>
                Roth IRA vs. Traditional 401k — Recommendation:{' '}
                <span style={{ color: '#059669' }}>
                  {plan.taxAlphaData.rothVs401k.recommendation === 'both' ? 'Use Both' : plan.taxAlphaData.rothVs401k.recommendation === 'roth_first' ? 'Roth First' : '401k First'}
                </span>
              </h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', marginBottom: '8px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', fontSize: '9px' }}>Factor</th>
                    <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600, color: '#2563eb', textTransform: 'uppercase', fontSize: '9px' }}>Roth IRA</th>
                    <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600, color: '#7c3aed', textTransform: 'uppercase', fontSize: '9px' }}>Traditional 401k</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.taxAlphaData.rothVs401k.comparisonRows?.map((row: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '3px 6px', fontWeight: '600', color: '#374151' }}>{row.factor}</td>
                      <td style={{ padding: '3px 6px', color: '#374151' }}>{row.roth}</td>
                      <td style={{ padding: '3px 6px', color: '#374151' }}>{row.traditional401k}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '8px 10px', marginBottom: '6px' }}>
                <p style={{ fontSize: '10px', fontWeight: '700', color: '#1e40af', margin: '0 0 2px' }}>Why This Recommendation For You</p>
                <p style={{ fontSize: '10px', color: '#1d4ed8', margin: 0 }}>{plan.taxAlphaData.rothVs401k.reasoning}</p>
              </div>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '8px 10px' }}>
                <p style={{ fontSize: '10px', fontWeight: '700', color: '#065f46', margin: '0 0 2px' }}>Your Action Plan</p>
                <p style={{ fontSize: '10px', color: '#047857', margin: 0 }}>{plan.taxAlphaData.rothVs401k.actionPlan}</p>
              </div>
            </div>
          )}

          {/* Paycheck Waterfall */}
          {(plan.paycheckWaterfall ?? []).length > 0 && (
            <div style={{ marginBottom: '16px', pageBreakInside: 'avoid' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 8px', paddingBottom: '5px', borderBottom: '1px solid #e5e7eb' }}>Paycheck Waterfall — Optimal Dollar Deployment Order</h2>
              {plan.paycheckWaterfall.map((step: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '6px', padding: '8px', background: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                  <div style={{ width: '22px', height: '22px', borderRadius: '6px', background: '#059669', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', flexShrink: 0 }}>{step.rank}</div>
                  <div>
                    <p style={{ fontSize: '11px', fontWeight: '700', color: '#111827', margin: '0 0 1px' }}>{step.name}</p>
                    <p style={{ fontSize: '10px', color: '#374151', margin: '0 0 1px' }}>{step.description}</p>
                    <p style={{ fontSize: '10px', color: '#059669', margin: 0, fontStyle: 'italic' }}>{step.reasoning}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Location Reasoning Narrative */}
          {plan.taxAlphaData?.locationReasoningNarrative && (
            <div style={{ marginBottom: '16px', pageBreakInside: 'avoid' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 8px', paddingBottom: '5px', borderBottom: '1px solid #e5e7eb' }}>Why Asset Location Matters — Your Strategy Explained</h2>
              <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: '8px', padding: '10px 12px' }}>
                <p style={{ fontSize: '10px', color: '#6b21a8', margin: 0, lineHeight: '1.6', whiteSpace: 'pre-line' }}>{plan.taxAlphaData.locationReasoningNarrative}</p>
              </div>
            </div>
          )}

          </div>{/* end tax plan page */}

          {/* Action Checklist */}
          {(plan.actionChecklist ?? []).length > 0 && (
            <div style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
              <h2 style={{ fontSize: '13px', fontWeight: '700', margin: '0 0 8px', paddingBottom: '5px', borderBottom: '1px solid #e5e7eb' }}>Action Plan</h2>
              <ol style={{ margin: 0, paddingLeft: '18px' }}>
                {(plan.actionChecklist || []).map((item: any, i: number) => (
                  <li key={i} style={{ fontSize: '11px', color: '#374151', marginBottom: '6px', lineHeight: '1.5' }}>
                    <span style={{ fontWeight: '700', color: '#111827' }}>{item.action}</span>
                    {item.details ? <span style={{ color: '#6b7280' }}> — {item.details}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Disclaimer */}
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '10px', marginTop: '8px' }}>
            <p style={{ fontSize: '9px', color: '#9ca3af', lineHeight: '1.6', margin: 0 }}>
              © 2026 Alpha Horizon. For informational and educational purposes only. Not financial, investment, or tax advice. Forward-looking projections are AI-synthesized estimates grounded in 2026 Capital Market Assumptions from J.P. Morgan, Vanguard, BlackRock, and Goldman Sachs — not guaranteed returns. Past performance does not predict future results. Consult a licensed financial advisor (RIA/CFP) before making any investment decisions.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
