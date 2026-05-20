'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, RotateCcw, ShieldCheck, UserCircle, Search, PieChart, Shield, Calculator, Star } from 'lucide-react';
import OnboardingFlow from './OnboardingFlow';
import AgentStreamPanel from './AgentStreamPanel';
import PlanResults from './PlanResults';
import type { IntakeAnswers } from '@/lib/agents/types';
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
      timeline: `${answers.timeHorizon} years`,
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
      {/* Tab header — hidden on welcome to preserve dark immersion */}
      {view !== 'welcome' && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-600/10 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">AI Financial Planner</p>
              <p className="text-xs text-gray-600">6-Agent Institutional Portfolio Analysis</p>
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
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* ── Welcome ── */}
        {view === 'welcome' && (
          <div
            className="flex flex-col animate-fade-in -mx-6 -mt-6 min-h-full"
            style={{ background: 'linear-gradient(135deg, #0a0d12 0%, #0f1419 40%, #141d27 100%)' }}
          >
            {/* Depth orbs */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ background: 'radial-gradient(ellipse 60% 40% at 15% 20%, rgba(6,182,212,0.05) 0%, transparent 70%)' }} />
            <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ background: 'radial-gradient(ellipse 50% 40% at 85% 80%, rgba(52,211,153,0.04) 0%, transparent 70%)' }} />

            {/* Hero */}
            <div className="relative px-8 pt-12 pb-10 text-center">
              <div className="relative z-10 max-w-2xl mx-auto space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border mb-2"
                  style={{ background: 'rgba(6,182,212,0.1)', borderColor: 'rgba(6,182,212,0.25)' }}>
                  <Sparkles className="w-3 h-3" style={{ color: '#06b6d4' }} />
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#06b6d4' }}>6 AI Agents · Tax-Optimized · Institutional Grade</span>
                </div>
                <h1 className="font-brand font-extrabold text-white tracking-[-0.02em] leading-none" style={{
                  fontSize: '3.25rem',
                  background: 'linear-gradient(135deg, #ffffff 30%, #67e8f9 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  AI FINANCIAL PLANNER
                </h1>
                <p className="text-[14px] leading-[1.65] max-w-lg mx-auto" style={{ color: 'rgba(241,244,248,0.5)' }}>
                  Six specialized agents. One institutional-grade portfolio — built, stress-tested, and refined around your goals.
                </p>
                <div className="flex items-center justify-center gap-8 pt-2">
                  {[
                    { value: '12', label: 'Questions' },
                    { value: '6', label: 'AI Agents' },
                    { value: 'IPS', label: 'Document' },
                    { value: 'CMA', label: '2026 Data' },
                  ].map((s) => (
                    <div key={s.label} className="text-center">
                      <p className="text-xl font-black font-mono" style={{ color: '#06b6d4' }}>{s.value}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: 'rgba(241,244,248,0.35)' }}>{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="mx-8 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />

            {/* Agent cards */}
            <div className="px-8 py-8 flex flex-col items-center gap-6">
              <div className="grid grid-cols-3 gap-4 w-full max-w-2xl">
                {([
                  {
                    Icon: UserCircle, number: '01', title: 'Client Profile Agent',
                    description: 'Scores your risk tolerance, time horizon, and tax bracket instantly.',
                    color: '#06b6d4', bg: 'rgba(6,182,212,0.07)', border: 'rgba(6,182,212,0.18)',
                  },
                  {
                    Icon: Search, number: '02', title: 'Capital Markets Agent',
                    description: 'Pulls live macro data to classify the current investment regime.',
                    color: '#818cf8', bg: 'rgba(129,140,248,0.07)', border: 'rgba(129,140,248,0.18)',
                  },
                  {
                    Icon: PieChart, number: '03', title: 'Portfolio Construction Agent',
                    description: 'Sharpe-optimizes across 28 institutional ETFs and 3 buckets.',
                    color: '#34d399', bg: 'rgba(52,211,153,0.07)', border: 'rgba(52,211,153,0.18)',
                  },
                  {
                    Icon: Shield, number: '04', title: 'Risk Analysis Agent',
                    description: 'Stress-tests for drawdown, sequence risk, and inflation sensitivity.',
                    color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.18)',
                  },
                  {
                    Icon: Calculator, number: '05', title: 'Tax & Implementation Agent',
                    description: 'Maximizes after-tax returns across Taxable, Roth, and Traditional.',
                    color: '#fb7185', bg: 'rgba(251,113,133,0.07)', border: 'rgba(251,113,133,0.18)',
                  },
                  {
                    Icon: Star, number: '06', title: 'Critic & Evaluator Agent',
                    description: 'Reruns the pipeline until your plan scores above 85/100.',
                    color: '#a78bfa', bg: 'rgba(167,139,250,0.07)', border: 'rgba(167,139,250,0.18)',
                  },
                ] as const).map((agent) => (
                  <div
                    key={agent.number}
                    className="rounded-2xl p-5 flex flex-col gap-3 border"
                    style={{ background: agent.bg, borderColor: agent.border }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center border"
                        style={{ background: agent.bg, borderColor: agent.border }}>
                        <agent.Icon style={{ width: 18, height: 18, color: agent.color }} />
                      </div>
                      <span className="text-xs font-mono font-bold" style={{ color: agent.color, opacity: 0.6 }}>{agent.number}</span>
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-sm mb-1.5">{agent.title}</h3>
                      <p className="text-slate-400 text-xs leading-relaxed">{agent.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <button
                onClick={() => setView('onboarding')}
                className="group flex items-center gap-2 px-10 py-3.5 rounded-xl font-bold text-sm transition-all active:scale-95 shadow-2xl hover:opacity-90 hover:scale-[1.02]"
                style={{ backgroundColor: '#06b6d4', color: '#000' }}
              >
                <Sparkles className="w-4 h-4" />
                Start Planning →
              </button>

              {/* Disclaimer */}
              <div className="rounded-2xl border p-4 text-center w-full max-w-2xl" style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                <p style={{ color: '#475569', fontSize: '0.72rem', lineHeight: 1.7 }}>
                  © 2026 Alpha Horizon. For informational and educational purposes only. Not financial, investment, or tax advice.
                  Past performance does not predict future results. Consult a licensed financial advisor (RIA/CFP) before making any investment decisions.
                </p>
              </div>
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
