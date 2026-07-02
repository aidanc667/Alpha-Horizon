'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, RotateCcw, ShieldCheck, UserCircle, TrendingUp, PieChart, Shield, Calculator, CheckCircle, Brain, FileText, ArrowRight } from 'lucide-react';
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function PlannerTab() {
  const { setPlannerSnapshot, navigateToAdvisor } = useAppContext();

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
              <p className="text-sm font-bold text-gray-900">Portfolio Planner</p>
              <p className="text-xs text-gray-600">7-Agent Institutional Portfolio Construction</p>
            </div>
          </div>
          {(view === 'active' || view === 'onboarding') && (
            <div className="flex items-center gap-3">
              {saveStatus === 'saving' && <span className="text-xs text-gray-400 animate-pulse">Saving…</span>}
              {saveStatus === 'saved' && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
              {plan && (
                <button
                  onClick={navigateToAdvisor}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors"
                >
                  <Brain className="w-3 h-3" />
                  Monitor with Silas
                </button>
              )}
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
            style={{ background: '#faf8f3' }}
          >
            {/* Hero */}
            <div className="px-10 pt-10 pb-8" style={{ borderBottom: '1px solid #ebe4d8' }}>
              <p className="font-sans uppercase mb-3" style={{ fontSize: 9.5, letterSpacing: '0.16em', fontWeight: 600, color: '#16a34a' }}>
                ● Portfolio Planner
              </p>
              <div className="flex items-end justify-between gap-8">
                <div>
                  <h1 className="font-display font-bold leading-none" style={{ fontSize: '2.6rem', color: '#1a1008' }}>
                    Build your portfolio.<br />
                    <span style={{ color: '#16a34a' }}>In minutes.</span>
                  </h1>
                  <p className="font-sans mt-3 max-w-md" style={{ fontSize: 13.5, lineHeight: 1.7, color: '#6b5840' }}>
                    Answer 16 questions across 7 topics. Seven specialized agents run in sequence to construct, stress-test, and tax-optimize an institutional-grade portfolio around your goals.
                  </p>
                </div>
                <button
                  onClick={() => setView('onboarding')}
                  className="flex-shrink-0 flex items-center gap-2 font-sans font-semibold rounded-xl transition-all hover:opacity-90 active:scale-95"
                  style={{ background: '#16a34a', color: '#fff', padding: '11px 24px', fontSize: 13 }}
                >
                  <Sparkles className="w-4 h-4" />
                  Build My Portfolio
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-4" style={{ borderBottom: '1px solid #ebe4d8' }}>
              {[
                { value: '16', label: 'Intake questions', sub: 'across 7 topics' },
                { value: '7', label: 'AI agents', sub: 'run in sequence' },
                { value: '<5ms', label: 'Projection engine', sub: 'closed-form lognormal' },
                { value: '80+', label: 'Quality threshold', sub: 'critic re-runs if below' },
              ].map((s, i) => (
                <div
                  key={s.label}
                  className="py-5 px-6 flex flex-col gap-0.5"
                  style={{ borderRight: i < 3 ? '1px solid #ebe4d8' : 'none' }}
                >
                  <p className="font-mono font-bold" style={{ fontSize: 22, color: '#16a34a', lineHeight: 1 }}>{s.value}</p>
                  <p className="font-sans font-medium" style={{ fontSize: 11, color: '#1a1008', marginTop: 4 }}>{s.label}</p>
                  <p className="font-sans" style={{ fontSize: 10, color: '#b09060' }}>{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Agent pipeline */}
            <div className="px-10 py-8 max-w-4xl">
              <p className="font-sans uppercase mb-5" style={{ fontSize: 9.5, letterSpacing: '0.14em', fontWeight: 600, color: '#b09060' }}>
                The 7-agent pipeline
              </p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  {
                    Icon: UserCircle, number: '01', title: 'Client Profile',
                    description: 'Derives risk score, effective tax rate, and goal classification from your 16 answers.',
                  },
                  {
                    Icon: TrendingUp, number: '02', title: 'Capital Markets',
                    description: 'Fetches live CAPE ratio, 10Y yield, and macro regime via FRED — or falls back to JPM/Vanguard/BlackRock 2026 CMAs.',
                  },
                  {
                    Icon: PieChart, number: '03', title: 'Portfolio Construction',
                    description: 'Gradient-ascent Sharpe optimizer selects from 22 institutional ETFs across 3 account buckets.',
                  },
                  {
                    Icon: Shield, number: '04', title: 'Risk Analysis',
                    description: 'Runs parallel stress tests: max drawdown, sequence-of-returns risk, and inflation sensitivity.',
                  },
                  {
                    Icon: Calculator, number: '05', title: 'Tax & Placement',
                    description: 'Assigns holdings across Taxable, Traditional, and Roth accounts to maximize after-tax returns.',
                  },
                  {
                    Icon: CheckCircle, number: '06', title: 'Critic & Evaluator',
                    description: 'Scores 5 dimensions — alignment, diversification, risk, tax efficiency, feasibility. Re-runs if overall score is below 85.',
                  },
                  {
                    Icon: Brain, number: '07', title: 'Narrative Synthesis',
                    description: 'Gemini LLM writes a plain-English investment rationale summarizing the full plan and key trade-offs.',
                  },
                ] as const).map((agent, idx) => (
                  <div
                    key={agent.number}
                    className="flex items-start gap-3 rounded-xl p-4 border"
                    style={{ background: '#ffffff', borderColor: '#ebe4d8', gridColumn: idx === 6 ? 'span 2' : undefined }}
                  >
                    <div
                      className="flex-shrink-0 flex items-center justify-center rounded-lg"
                      style={{ width: 34, height: 34, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)' }}
                    >
                      <agent.Icon style={{ width: 15, height: 15, color: '#16a34a' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[10px] font-bold" style={{ color: '#16a34a', opacity: 0.6 }}>{agent.number}</span>
                        <h3 className="font-sans font-semibold" style={{ fontSize: 12, color: '#1a1008' }}>{agent.title}</h3>
                      </div>
                      <p className="font-sans" style={{ fontSize: 11, lineHeight: 1.55, color: '#6b5840' }}>{agent.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Output strip */}
            <div className="mx-10 mb-8 rounded-xl border overflow-hidden" style={{ borderColor: '#ebe4d8' }}>
              <div className="px-5 py-3" style={{ background: '#f0ece4', borderBottom: '1px solid #ebe4d8' }}>
                <p className="font-sans uppercase" style={{ fontSize: 9.5, letterSpacing: '0.14em', fontWeight: 600, color: '#b09060' }}>What you receive</p>
              </div>
              <div className="grid grid-cols-4" style={{ background: '#ffffff' }}>
                {[
                  { Icon: PieChart, label: 'ETF Allocation', desc: 'Weighted portfolio across 28 tickers' },
                  { Icon: FileText, label: 'IPS Document', desc: 'Investment policy statement' },
                  { Icon: Shield, label: 'Stress Test Report', desc: 'Drawdown & sequence risk analysis' },
                  { Icon: Calculator, label: 'Tax Placement Map', desc: 'Account-by-account holding plan' },
                ].map(({ Icon, label, desc }, i) => (
                  <div key={label} className="px-5 py-4 flex items-start gap-3" style={{ borderRight: i < 3 ? '1px solid #ebe4d8' : 'none' }}>
                    <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#16a34a' }} />
                    <div>
                      <p className="font-sans font-semibold" style={{ fontSize: 11, color: '#1a1008' }}>{label}</p>
                      <p className="font-sans" style={{ fontSize: 10, color: '#b09060', marginTop: 2 }}>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Disclaimer */}
            <div className="px-10 pb-8">
              <p style={{ color: '#b09060', fontSize: '0.68rem', lineHeight: 1.8 }}>
                For informational and educational purposes only. Not financial, investment, or tax advice. Past performance does not predict future results. Consult a licensed financial advisor (RIA/CFP) before making any investment decisions. © 2026 Alpha Horizon.
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
