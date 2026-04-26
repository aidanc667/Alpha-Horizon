'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, RotateCcw, ShieldCheck, TrendingUp, Shield } from 'lucide-react';
import OnboardingFlow from './OnboardingFlow';
import AgentStreamPanel from './AgentStreamPanel';
import PlanResults from './PlanResults';
import type { IntakeAnswers } from '@/apps/portfolio-agent/types';
import type { V3Plan } from '@/lib/agents/types';
import type { IPSDocument, SimulationResult } from '@/types';
import { runSimulation } from '@/lib/simulationEngine';
import { useAppContext } from '@/lib/appContext';

type ViewState = 'welcome' | 'onboarding' | 'active';

export interface BacktestState {
  result: SimulationResult | null;
  loading: boolean;
  worstCalendarYear: { year: number; return: number } | null;
}

// ─── Plan summary card (shown after generation, until Prompt 9 rewrites PlanResults) ──

function PlanSummaryCard({
  plan,
  backtest,
}: {
  plan: V3Plan;
  backtest: BacktestState;
}) {
  const overallScore = plan.criticScore?.scores?.overall ?? 0;
  const scoreColor =
    overallScore >= 90 ? '#10b981' : overallScore >= 80 ? '#f59e0b' : '#ef4444';

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const stats = plan.portfolio?.statistics;
  const alloc = plan.portfolio?.allocation ?? [];

  return (
    <div className="space-y-4">
      {/* Executive summary */}
      <div className="rounded-xl border border-gray-100 bg-slate-800 p-5 text-white shadow-sm">
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6 mb-4">
          {[
            { label: 'Critic Score', value: overallScore ? `${overallScore}/100` : '—', color: scoreColor },
            { label: 'Exp. Return', value: stats?.expectedReturn ? pct(stats.expectedReturn) : '—', color: '#10b981' },
            { label: 'Sharpe', value: stats?.sharpeRatio?.toFixed(2) ?? '—', color: '#10b981' },
            {
              label: 'Success Prob.',
              value: plan.monteCarlo?.goalSuccessProbability != null
                ? pct(plan.monteCarlo.goalSuccessProbability)
                : '—',
              color: '#3b82f6',
            },
            {
              label: 'Max Drawdown',
              value: backtest.loading
                ? '—'
                : backtest.result
                ? `-${backtest.result.metrics.maxDrawdown.toFixed(1)}%`
                : stats?.maxDrawdownEstimate
                ? `-${(stats.maxDrawdownEstimate * 100).toFixed(0)}%`
                : '—',
              color: '#f59e0b',
            },
            {
              label: 'Tax Alpha',
              value: plan.taxOptimization?.estimatedAnnualSavings
                ? `${plan.taxOptimization.estimatedAnnualSavings} bps/yr`
                : '—',
              color: '#10b981',
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <p className="text-2xl font-black font-mono" style={{ color }}>{value}</p>
              <p className="text-xs text-slate-400 uppercase tracking-wide mt-1">{label}</p>
            </div>
          ))}
        </div>
        {plan.synthesis?.portfolioNarrative && (
          <p className="text-slate-300 text-xs leading-relaxed border-t border-white/10 pt-3">
            {plan.synthesis.portfolioNarrative.slice(0, 300)}…
          </p>
        )}
      </div>

      {/* Allocation bars */}
      {alloc.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wide">Portfolio Allocation</h3>
          <div className="space-y-3">
            {alloc.map((s) => (
              <div key={s.ticker} className="flex items-center gap-3">
                <span className="font-mono text-xs font-bold text-gray-900 w-10 flex-shrink-0">{s.ticker}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full"
                    style={{ width: `${(s.weight * 100).toFixed(1)}%` }}
                  />
                </div>
                <span className="font-mono text-xs text-gray-500 w-10 text-right flex-shrink-0">
                  {(s.weight * 100).toFixed(0)}%
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 w-20 text-center flex-shrink-0 hidden sm:block">
                  {s.accountPlacement}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Backtest loading notice */}
      {backtest.loading && (
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm text-center">
          <p className="text-xs text-gray-500 animate-pulse">Running historical backtest (Jan 2014 → present)…</p>
        </div>
      )}

      {/* Backtest worst year */}
      {!backtest.loading && backtest.worstCalendarYear && (
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm flex items-center justify-between">
          <span className="text-xs text-gray-600">
            Worst calendar year ({backtest.worstCalendarYear.year})
          </span>
          <span className="font-mono text-sm font-bold text-red-500">
            {backtest.worstCalendarYear.return.toFixed(1)}%
          </span>
        </div>
      )}

      {/* Placeholder for full dashboard (Prompt 9) */}
      <div className="rounded-xl border border-dashed border-gray-200 bg-slate-50 p-6 text-center">
        <p className="text-xs text-gray-400">Full dashboard (Portfolio · Analysis · Tax · IPS tabs) coming in the next update.</p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PlannerTab() {
  const { setPlannerSnapshot } = useAppContext();

  const [view, setView] = useState<ViewState>('welcome');
  const [answers, setAnswers] = useState<IntakeAnswers | null>(null);
  const [plan, setPlan] = useState<V3Plan | null>(null);
  const [ips, setIps] = useState<IPSDocument | undefined>(undefined);
  const [backtest, setBacktest] = useState<BacktestState>({
    result: null,
    loading: false,
    worstCalendarYear: null,
  });
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Save plan to DB ──────────────────────────────────────────────────────────
  const savePlanToDB = async (planData: V3Plan, ans: IntakeAnswers, planId: string | null) => {
    try {
      localStorage.setItem('fp_v3_plan', JSON.stringify(planData));
      localStorage.setItem('fp_v3_answers', JSON.stringify(ans));
    } catch {}
    try {
      setSaveStatus('saving');
      const name = ans.goalAmount
        ? `Portfolio — $${ans.goalAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} goal`
        : 'My Portfolio Plan';
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: planId, name, plan: planData, responses: ans }),
      });
      if (res.ok) {
        const data = await res.json();
        if (!planId && data.id) setCurrentPlanId(data.id);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }
  };

  // ── Restore saved plan (V3 format only) ─────────────────────────────────────
  useEffect(() => {
    const restore = async () => {
      try {
        const res = await fetch('/api/plans');
        if (res.ok) {
          const { plans } = await res.json();
          if (plans?.length > 0) {
            const detailRes = await fetch(`/api/plans/${plans[0].id}`);
            if (detailRes.ok) {
              const { plan: p, responses: r } = await detailRes.json();
              if (p?.allocation && r?.startingCapital !== undefined) {
                setPlan(p as V3Plan);
                setAnswers(r as IntakeAnswers);
                setCurrentPlanId(plans[0].id);
                setView('active');
                return;
              }
            }
          }
        }
      } catch {}
      try {
        const sp = localStorage.getItem('fp_v3_plan');
        const sa = localStorage.getItem('fp_v3_answers');
        if (sp && sa) {
          const p = JSON.parse(sp);
          const r = JSON.parse(sa);
          if (p?.allocation && r?.startingCapital !== undefined) {
            setPlan(p as V3Plan);
            setAnswers(r as IntakeAnswers);
            setView('active');
          }
        }
      } catch {}
    };
    restore();
  }, []);

  // ── Cross-tab planner snapshot ───────────────────────────────────────────────
  useEffect(() => {
    if (!plan || !answers) return;
    const fmt$ = (v: number) =>
      v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const riskProfile = plan.clientProfile?.riskProfile;
    const taxProfile = plan.clientProfile?.taxProfile;
    setPlannerSnapshot({
      riskProfile: riskProfile?.effectiveRiskTolerance ?? 'Moderate',
      timeline: `${answers.yearsUntilWithdrawal} years`,
      goal: answers.goalAmount ? fmt$(answers.goalAmount) : 'N/A',
      monthlyContrib: fmt$(answers.monthlyContribution),
      buckets: 'N/A',
      marginalFederal: taxProfile?.combinedMarginalRate != null
        ? `${Math.round(taxProfile.combinedMarginalRate * 100)}%`
        : 'N/A',
      marginalCA: 'N/A',
      topHoldings: plan.portfolio?.allocation?.slice(0, 6).map((a) => a.ticker).join(', ') ?? 'N/A',
      updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  }, [plan, answers, setPlannerSnapshot]);

  // ── Backtest trigger ─────────────────────────────────────────────────────────
  const triggerBacktest = async (newPlan: V3Plan, ans: IntakeAnswers) => {
    if (!newPlan.portfolio?.allocation?.length) return;
    setBacktest({ result: null, loading: true, worstCalendarYear: null });
    try {
      const today = new Date().toISOString().split('T')[0];
      const result = await runSimulation({
        allocations: newPlan.portfolio.allocation.map((s) => ({
          ticker: s.ticker,
          percentage: s.weight * 100,
        })),
        startDate: '2014-01-01',
        endDate: today,
        initialInvestment: ans.startingCapital,
        monthlyContribution: ans.monthlyContribution,
        annualRebalance: true,
      });
      const yearSummary = result.yearEndSummary;
      const worstYear =
        yearSummary.length > 0
          ? yearSummary.reduce((w, yr) => (yr.annualReturn < w.annualReturn ? yr : w))
          : null;
      setBacktest({
        result,
        loading: false,
        worstCalendarYear: worstYear
          ? { year: worstYear.year, return: worstYear.annualReturn }
          : null,
      });
    } catch (e) {
      console.error('Backtest failed:', e);
      setBacktest({ result: null, loading: false, worstCalendarYear: null });
    }
  };

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleOnboardingComplete = (ans: IntakeAnswers) => {
    setAnswers(ans);
    setPlan(null);
    setIps(undefined);
    setBacktest({ result: null, loading: false, worstCalendarYear: null });
    setView('active');
  };

  const handleAgentComplete = (newPlan: V3Plan, newIps?: IPSDocument) => {
    setPlan(newPlan);
    setIps(newIps);
    if (answers) {
      triggerBacktest(newPlan, answers);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        savePlanToDB(newPlan, answers, currentPlanId);
      }, 500);
    }
  };

  const handleReset = () => {
    localStorage.removeItem('fp_v3_plan');
    localStorage.removeItem('fp_v3_answers');
    setCurrentPlanId(null);
    setSaveStatus('idle');
    setPlan(null);
    setAnswers(null);
    setIps(undefined);
    setBacktest({ result: null, loading: false, worstCalendarYear: null });
    setView('welcome');
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* Tab header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-600/10 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">AI Financial Planner</p>
            <p className="text-xs text-gray-600">7-Agent Institutional Portfolio Analysis</p>
          </div>
        </div>
        {(view === 'active' || view === 'onboarding') && (
          <div className="flex items-center gap-3">
            {saveStatus === 'saving' && <span className="text-xs text-gray-400 animate-pulse">Saving…</span>}
            {saveStatus === 'saved' && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
            {saveStatus === 'error' && <span className="text-xs text-red-400">Save failed</span>}
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-700 bg-gray-100 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              New Plan
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* ── Welcome ── */}
        {view === 'welcome' && (
          <div className="flex flex-col animate-fade-in -mx-6 -mt-6">
            <div
              className="relative overflow-hidden px-8 pt-12 pb-10 text-center"
              style={{
                background:
                  'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f2b1f 100%)',
              }}
            >
              <div
                className="absolute inset-0 opacity-10"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 20% 50%, #10b981 0%, transparent 50%), radial-gradient(circle at 80% 20%, #6366f1 0%, transparent 40%)',
                }}
              />
              <div className="relative z-10 max-w-2xl mx-auto space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-600 text-xs font-semibold uppercase tracking-widest mb-2">
                  <Sparkles className="w-3 h-3" />
                  7-Agent AI · Tax-Optimized · Institutional Grade
                </div>
                <h1 className="text-3xl font-black tracking-tight text-white">
                  Build Your Investment Plan
                </h1>
                <p className="text-slate-300 text-sm leading-relaxed max-w-lg mx-auto">
                  Answer 8 questions and receive a personalized ETF portfolio built by 7 specialized
                  AI agents — with live agent transparency, formal Investment Policy Statement, and
                  historical backtest analysis.
                </p>
                <div className="flex items-center justify-center gap-8 pt-2">
                  {[
                    { value: '8', label: 'Questions' },
                    { value: '7', label: 'AI Agents' },
                    { value: 'IPS', label: 'Document' },
                    { value: 'CMA', label: '2026 Data' },
                  ].map((s) => (
                    <div key={s.label} className="text-center">
                      <p className="text-xl font-black font-mono text-emerald-600">{s.value}</p>
                      <p className="text-xs text-slate-400 uppercase tracking-wider">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-8 flex flex-col items-center gap-6">
              <div className="grid grid-cols-3 gap-4 w-full max-w-2xl">
                {[
                  {
                    label: 'Safety Bucket',
                    desc: 'Emergency reserves & liquid capital — your financial foundation',
                    color: 'text-emerald-700',
                    iconColor: 'text-emerald-600',
                    bg: 'bg-white border-emerald-200',
                    iconBg: 'bg-emerald-50',
                    bar: 'bg-emerald-400',
                    Icon: Shield,
                  },
                  {
                    label: 'Growth Bucket',
                    desc: 'Tax-efficient equity compounding for long-term wealth building',
                    color: 'text-blue-700',
                    iconColor: 'text-blue-600',
                    bg: 'bg-white border-blue-200',
                    iconBg: 'bg-blue-50',
                    bar: 'bg-blue-400',
                    Icon: TrendingUp,
                  },
                  {
                    label: 'IPS Document',
                    desc: 'Formal Investment Policy Statement — the standard for $5M+ advisor clients',
                    color: 'text-purple-700',
                    iconColor: 'text-purple-600',
                    bg: 'bg-white border-purple-200',
                    iconBg: 'bg-purple-50',
                    bar: 'bg-purple-400',
                    Icon: Sparkles,
                  },
                ].map((f) => (
                  <div
                    key={f.label}
                    className={`p-4 border rounded-xl ${f.bg} flex flex-col gap-3`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-xl ${f.iconBg} flex items-center justify-center flex-shrink-0`}
                      >
                        <f.Icon className={`w-4 h-4 ${f.iconColor}`} />
                      </div>
                      <p className={`text-xs font-bold uppercase tracking-wide ${f.color}`}>
                        {f.label}
                      </p>
                    </div>
                    <div className={`h-0.5 w-8 rounded-full ${f.bar}`} />
                    <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 w-full max-w-2xl">
                {[
                  'Live 7-agent reasoning chain',
                  'Formal Investment Policy Statement',
                  'Sharpe optimizer · 28-ETF universe',
                  'California + federal tax optimization',
                  'Historical backtest Jan 2014 → present',
                  '15-year Monte Carlo projection',
                ].map((f) => (
                  <div
                    key={f}
                    className="flex items-center gap-2 text-xs text-gray-600 bg-white border border-gray-100 rounded-lg px-3 py-2"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-600 flex-shrink-0" />
                    {f}
                  </div>
                ))}
              </div>

              <button
                onClick={() => setView('onboarding')}
                className="px-10 py-3.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-bold text-sm transition-all active:scale-95 shadow-lg flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Start Planning →
              </button>

              <p className="text-xs text-slate-500 max-w-lg text-center leading-relaxed px-4">
                © 2026 Alpha Horizon. For informational and educational purposes only. Not
                financial, investment, or tax advice. Consult a licensed financial advisor before
                making any investment decisions.
              </p>
            </div>
          </div>
        )}

        {/* ── Onboarding ── */}
        {view === 'onboarding' && (
          <div className="max-w-xl mx-auto">
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <OnboardingFlow onComplete={handleOnboardingComplete} />
            </div>
          </div>
        )}

        {/* ── Active: streaming overlay + results ── */}
        {view === 'active' && answers && (
          <div className="space-y-4">
            {/* AgentStreamPanel: full-screen overlay during generation, accordion after */}
            <AgentStreamPanel
              answers={answers}
              onComplete={handleAgentComplete}
              onReset={handleReset}
            />
            {/* Full dashboard — shown once plan arrives */}
            {plan && answers && (
              <PlanResults plan={plan} backtest={backtest} answers={answers} ips={ips} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
