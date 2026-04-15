'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, RotateCcw, ShieldCheck, TrendingUp, Shield } from 'lucide-react';
import OnboardingFlow from './OnboardingFlow';
import PlanResults from './PlanResults';
import type { PersonalizedPlan, OnboardingResponses } from '@/types';
import { useAppContext } from '@/lib/appContext';

type ViewState = 'welcome' | 'onboarding' | 'results';

const LOADING_STEPS = [
  'Accessing 2026 Capital Market Assumptions...',
  'Analyzing BlackRock & Vanguard projections...',
  'Optimizing 3-Bucket Allocation Model...',
  'Calculating success probability...',
  'Finalizing institutional strategy...',
];

function LoadingScreen() {
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStepIdx(i => (i + 1) % LOADING_STEPS.length), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] gap-6">
      {/* Thin animated progress bar */}
      <div className="w-full max-w-xs h-0.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-600 rounded-full" style={{animation: 'progress-bar 18s linear forwards'}} />
      </div>
      <style>{`@keyframes progress-bar { from { width: 0% } to { width: 100% } }`}</style>
      {/* Bar-style loader */}
      <div className="w-1 h-8 bg-emerald-600 rounded-full animate-pulse" />
      <div className="text-center space-y-2 max-w-xs">
        <p className="text-lg font-bold text-gray-900">Building Your Strategy...</p>
        <div className="space-y-1">
          {LOADING_STEPS.map((step, i) => (
            <p key={i} className={i === stepIdx ? 'text-sm font-semibold text-gray-900' : 'text-xs text-gray-400'}>
              {step}
            </p>
          ))}
        </div>
        <p className="text-xs text-gray-600 italic">Institutional-grade analysis takes 8–12 seconds.</p>
      </div>
    </div>
  );
}

export default function PlannerTab() {
  const { setPlannerSnapshot } = useAppContext();

  const [view, setView]         = useState<ViewState>('welcome');
  const [plan, setPlan]         = useState<PersonalizedPlan | null>(null);
  const [responses, setResponses] = useState<OnboardingResponses>({});
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [taxLoading, setTaxLoading] = useState(false);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Debounce ref for auto-save
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Save plan to DB (Neon via /api/plans) ─────────────────────────────────
  const savePlanToDB = async (planData: PersonalizedPlan, resp: OnboardingResponses, planId: string | null) => {
    // Also keep localStorage as offline fallback
    try { localStorage.setItem('fp_plan', JSON.stringify(planData)); localStorage.setItem('fp_responses', JSON.stringify(resp)); } catch {}
    try {
      setSaveStatus('saving');
      const goal = String(resp.goalAmount || '').replace(/,/g, '');
      const name = goal ? `${resp.riskTolerance || 'Moderate'} — $${Number(goal).toLocaleString('en-US', { maximumFractionDigits: 0 })} goal` : 'My Financial Plan';
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: planId, name, plan: planData, responses: resp }),
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

  // Restore saved plan — try DB first, fall back to localStorage
  useEffect(() => {
    const restore = async () => {
      try {
        // Try DB first (requires auth)
        const res = await fetch('/api/plans');
        if (res.ok) {
          const { plans } = await res.json();
          if (plans && plans.length > 0) {
            // Load the most recent plan
            const latest = plans[0];
            const detailRes = await fetch(`/api/plans/${latest.id}`);
            if (detailRes.ok) {
              const { plan: p, responses: r } = await detailRes.json();
              if (p && r) {
                setPlan(p); setResponses(r); setCurrentPlanId(latest.id); setView('results');
                return;
              }
            }
          }
        }
      } catch {}
      // Fallback to localStorage
      try {
        const savedPlan = localStorage.getItem('fp_plan');
        const savedResp = localStorage.getItem('fp_responses');
        if (savedPlan && savedResp) {
          setPlan(JSON.parse(savedPlan));
          setResponses(JSON.parse(savedResp));
          setView('results');
        }
      } catch {}
    };
    restore();
  }, []);

  // ── Publish plan snapshot to cross-tab context ──────────────────────────────
  useEffect(() => {
    if (!plan || !responses || Object.keys(responses).length === 0) return;

    const parseNum = (v: unknown) => Number(String(v || '').replace(/,/g, '')) || 0;

    // Bucket allocation string
    const b = plan.summary?.bucketSizes;
    const buckets = b
      ? `Safety ${b.shortTerm?.percent ?? 0}% / Growth ${b.longTerm?.percent ?? 0}% / Retirement ${b.retirement?.percent ?? 0}%`
      : 'N/A';

    // Collect top tickers across all three buckets
    const allAssets: string[] = [
      ...((plan.shortTermStrategy as any)?.assets ?? []),
      ...((plan.longTermStrategy as any)?.assets ?? []),
      ...(((plan.retirementStrategy as any)?.allocation?.assets) ?? []),
    ].map((a: any) => a?.ticker).filter(Boolean);
    const uniqueTickers = [...new Set(allAssets)].slice(0, 8);

    // Tax brackets — prefer taxAlphaData if available, else use raw profile
    const taxProfile = plan.taxAlphaData?.taxProfile;
    const marginalFederal = taxProfile?.marginalFederal ? `${taxProfile.marginalFederal}%` : 'N/A';
    const marginalCA      = taxProfile?.marginalCA      ? `${taxProfile.marginalCA}%`      : 'N/A';

    const goal        = parseNum(responses.goalAmount) || 1_000_000;
    const monthlyC    = parseNum(responses.monthlyContribution);
    const timeline    = Number(responses.timeline) || 10;
    const riskProfile = String(responses.riskTolerance || plan.riskProfile?.summary?.split(' ')[0] || 'Moderate');

    const fmt$ = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

    setPlannerSnapshot({
      riskProfile,
      timeline:       `${timeline} years`,
      goal:           fmt$(goal),
      monthlyContrib: fmt$(monthlyC),
      buckets,
      marginalFederal,
      marginalCA,
      topHoldings:    uniqueTickers.join(', ') || 'N/A',
      updatedAt:      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  }, [plan, responses, setPlannerSnapshot]);

  const handleOnboardingComplete = async (resp: OnboardingResponses) => {
    setLoading(true);
    setError(null);
    setResponses(resp);
    setView('results');

    try {
      // ── Step 1: Generate core allocation (fast) ───────────────────────────
      const planRes = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generatePlan', responses: resp }),
      });
      if (!planRes.ok) {
        const err = await planRes.json();
        throw new Error(err.error || 'Failed to generate plan');
      }
      const { plan: planData } = await planRes.json();
      setPlan(planData);
      setLoading(false);

      // ── Steps 2 & 3: Run tax enrichment + report stream CONCURRENTLY ──────
      const [taxResult] = await Promise.allSettled([
        // Tax enrichment
        fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generateTaxEnrichment', responses: resp, plan: planData }),
        }).then(async (res) => {
          if (!res.ok) return;
          const { taxData } = await res.json();
          if (taxData) {
            setPlan(prev => prev ? { ...prev, taxAlphaData: taxData } : null);
          }
        }),

        // Full report stream
        fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generateReport', responses: resp, plan: planData }),
        }).then(async (reportRes) => {
          if (!reportRes.body) return;
          const reader = reportRes.body.getReader();
          const decoder = new TextDecoder();
          let fullReport = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullReport += decoder.decode(value, { stream: true });
            setPlan(prev => prev ? { ...prev, fullReport } : null);
          }
          const completePlan = { ...planData, fullReport };
          // Auto-save complete plan to DB (debounced to avoid hammering on stream updates)
          if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
          autoSaveTimer.current = setTimeout(() => {
            savePlanToDB(completePlan, resp, currentPlanId);
          }, 1500);
        }),
      ]);

    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      setLoading(false);
    }
  };

  const handleReset = () => {
    localStorage.removeItem('fp_plan');
    localStorage.removeItem('fp_responses');
    setCurrentPlanId(null);
    setSaveStatus('idle');
    setPlan(null); setResponses({}); setView('welcome'); setError(null);
  };

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
            <p className="text-xs text-gray-600">Your Personal AI Portfolio Architect</p>
          </div>
        </div>
        {(view === 'results' || view === 'onboarding') && (
          <div className="flex items-center gap-3">
            {saveStatus === 'saving' && <span className="text-xs text-gray-400 animate-pulse">Saving…</span>}
            {saveStatus === 'saved'  && <span className="text-xs text-emerald-600 font-semibold">✓ Saved to cloud</span>}
            {saveStatus === 'error'  && <span className="text-xs text-red-400">Save failed (offline fallback active)</span>}
            <button onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-700 bg-gray-100 rounded-lg transition-colors">
              <RotateCcw className="w-3 h-3" />
              New Plan
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 p-4 bg-red-900/20 border border-red-800/40 rounded-xl text-sm text-red-300">
            {error}
          </div>
        )}

        {view === 'welcome' && (
          <div className="flex flex-col animate-fade-in -mx-6 -mt-6">
            {/* Dark hero banner */}
            <div className="relative overflow-hidden px-8 pt-12 pb-10 text-center" style={{background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f2b1f 100%)'}}>
              <div className="absolute inset-0 opacity-10" style={{backgroundImage: 'radial-gradient(circle at 20% 50%, #10b981 0%, transparent 50%), radial-gradient(circle at 80% 20%, #6366f1 0%, transparent 40%)'}} />
              <div className="relative z-10 max-w-2xl mx-auto space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-600 text-xs font-semibold uppercase tracking-widest mb-2">
                  <Sparkles className="w-3 h-3" />
                  AI-Powered · Tax-Optimized · Institutional Grade
                </div>
                <h1 className="text-3xl font-black tracking-tight text-white">Build Your Investment Plan</h1>
                <p className="text-slate-300 text-sm leading-relaxed max-w-lg mx-auto">
                  Answer 10 simple questions and receive a personalized 3-bucket allocation strategy with California tax optimization, forward-looking projections, and a full institutional report.
                </p>
                {/* Stats row */}
                <div className="flex items-center justify-center gap-8 pt-2">
                  {[
                    { value: '10', label: 'Questions' },
                    { value: '3', label: 'Buckets' },
                    { value: 'AI', label: 'Tax Alpha' },
                    { value: 'CMA', label: '2026 Data' },
                  ].map(s => (
                    <div key={s.label} className="text-center">
                      <p className="text-xl font-black font-mono text-emerald-600">{s.value}</p>
                      <p className="text-xs text-slate-400 uppercase tracking-wider">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Content below banner */}
            <div className="px-6 py-8 flex flex-col items-center gap-6">
              {/* Bucket cards */}
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
                    label: 'Retirement Bucket',
                    desc: 'Roth IRA & 401k optimization for lifetime compounding',
                    color: 'text-purple-700',
                    iconColor: 'text-purple-600',
                    bg: 'bg-white border-purple-200',
                    iconBg: 'bg-purple-50',
                    bar: 'bg-purple-400',
                    Icon: Sparkles,
                  },
                ].map(f => (
                  <div key={f.label} className={`p-4 border rounded-xl ${f.bg} flex flex-col gap-3`}>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-xl ${f.iconBg} flex items-center justify-center flex-shrink-0`}>
                        <f.Icon className={`w-4 h-4 ${f.iconColor}`} />
                      </div>
                      <p className={`text-xs font-bold uppercase tracking-wide ${f.color}`}>{f.label}</p>
                    </div>
                    <div className={`h-0.5 w-8 rounded-full ${f.bar}`} />
                    <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>

              {/* Feature list */}
              <div className="grid grid-cols-2 gap-2 w-full max-w-2xl">
                {[
                  'Forward-looking 2026 CMA projections',
                  'California after-tax yield optimization',
                  'Roth IRA vs 401k comparison',
                  'Institutional tax-alpha analysis',
                  'Success probability & gap analysis',
                  'Full AI institutional report',
                ].map(f => (
                  <div key={f} className="flex items-center gap-2 text-xs text-gray-600 bg-white border border-gray-100 rounded-lg px-3 py-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-600 flex-shrink-0" />
                    {f}
                  </div>
                ))}
              </div>

              <button onClick={() => setView('onboarding')}
                className="px-10 py-3.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-bold text-sm transition-all active:scale-95 shadow-lg flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Start Planning →
              </button>

              {/* Disclaimer */}
              <p className="text-xs text-slate-500 max-w-lg text-center leading-relaxed px-4">
                © 2026 Alpha Horizon. For informational and educational purposes only. Not financial, investment, or tax advice.
                Consult a licensed financial advisor before making any investment decisions.
              </p>
            </div>
          </div>
        )}

        {view === 'onboarding' && (
          <div className="max-w-xl mx-auto">
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <OnboardingFlow onComplete={handleOnboardingComplete} isLoading={false} />
            </div>
          </div>
        )}

        {view === 'results' && loading && <LoadingScreen />}

        {view === 'results' && !loading && plan && (
          <PlanResults plan={plan} responses={responses} taxLoading={!plan.taxAlphaData} />
        )}
      </div>
    </div>
  );
}
