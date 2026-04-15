'use client';

import React, { useState } from 'react';
import {
  Bot, TrendingUp, Shield, Repeat2, Search, ChevronRight,
  Sparkles, UserCircle, PieChart, Calculator, Star, BarChart3,
} from 'lucide-react';
import IntakeWizard from './components/IntakeWizard';
import AgentStatusPanel from './components/AgentStatusPanel';
import PortfolioPlanCard from './components/PortfolioPlanCard';
import { APP_NAME, APP_TAGLINE } from './constants';
import type { IntakeAnswers, PortfolioPlan, AgentRunState } from './types';

type PageView = 'home' | 'intake' | 'running' | 'results';

const AGENTS = [
  {
    icon: UserCircle,
    number: '01',
    title: 'Client Profile',
    description: 'Builds your complete investor profile — risk score, time horizon, tax bracket, and behavioral biases — instantly from your answers.',
    color: '#06b6d4',
    bg: 'rgba(6,182,212,0.07)',
    border: 'rgba(6,182,212,0.18)',
  },
  {
    icon: Search,
    number: '02',
    title: 'Capital Markets',
    description: 'Searches the web in real time for current Fed Funds Rate, 10Y Treasury yield, CPI, S&P P/E ratios, and macro regime classification.',
    color: '#818cf8',
    bg: 'rgba(129,140,248,0.07)',
    border: 'rgba(129,140,248,0.18)',
  },
  {
    icon: PieChart,
    number: '03',
    title: 'Portfolio Construction',
    description: 'Designs your allocation across the 3-bucket system (Safety / Growth / Income) using 28 curated ETFs, a gradient-ascent Sharpe optimizer, and a full covariance matrix.',
    color: '#34d399',
    bg: 'rgba(52,211,153,0.07)',
    border: 'rgba(52,211,153,0.18)',
  },
  {
    icon: Shield,
    number: '04',
    title: 'Risk Analysis',
    description: 'Stress-tests the portfolio for max drawdown, sequence risk, concentration, duration, and inflation sensitivity. Flags issues and adjusts if needed.',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.07)',
    border: 'rgba(245,158,11,0.18)',
  },
  {
    icon: Calculator,
    number: '05',
    title: 'Tax & Implementation',
    description: 'Optimizes asset location across Taxable, Roth, and Traditional accounts. Calculates tax-alpha, harvesting opportunities, and Roth conversion windows.',
    color: '#fb7185',
    bg: 'rgba(251,113,133,0.07)',
    border: 'rgba(251,113,133,0.18)',
  },
  {
    icon: Star,
    number: '06',
    title: 'Critic & Evaluator',
    description: 'Scores the plan across 5 weighted dimensions (suitability, risk, feasibility, tax efficiency, diversification). If below 88/100, the pipeline reruns with targeted feedback.',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.07)',
    border: 'rgba(167,139,250,0.18)',
  },
];

export default function PortfolioAgentPage() {
  const [view, setView] = useState<PageView>('home');
  const [answers, setAnswers] = useState<IntakeAnswers | null>(null);
  const [runState, setRunState] = useState<AgentRunState | null>(null);
  const [plan, setPlan] = useState<PortfolioPlan | null>(null);

  const handleIntakeComplete = (data: IntakeAnswers) => {
    setAnswers(data);
    setView('running');
  };

  const handleRunComplete = (finalPlan: PortfolioPlan, state: AgentRunState) => {
    setPlan(finalPlan);
    setRunState(state);
    setView('results');
  };

  const handleReset = () => {
    setView('home');
    setAnswers(null);
    setRunState(null);
    setPlan(null);
  };

  return (
    <div className="overflow-y-auto" style={{ background: 'linear-gradient(160deg, #060b16 0%, #0a0f1e 60%, #0d1117 100%)', minHeight: '100%' }}>
      {view === 'home' && (
        <div className="max-w-4xl mx-auto px-6 pb-24" style={{ paddingTop: '7rem' }}>

          {/* Hero */}
          <div className="text-center" style={{ marginBottom: '2.5rem' }}>
            <div className="flex justify-center" style={{ marginBottom: '1.25rem' }}>
              <div className="relative">
                <div className="absolute inset-0 rounded-3xl blur-2xl opacity-40" style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)' }} />
                <div className="relative rounded-3xl border flex items-center justify-center"
                  style={{ width: '6rem', height: '6rem', background: 'linear-gradient(135deg, rgba(6,182,212,0.18) 0%, rgba(6,182,212,0.04) 100%)', borderColor: 'rgba(6,182,212,0.35)' }}>
                  <Bot className="text-cyan-400" style={{ width: '3rem', height: '3rem' }} />
                </div>
              </div>
            </div>

            <h1 style={{
              fontSize: '4rem',
              fontWeight: 900,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              marginBottom: '0.75rem',
              background: 'linear-gradient(135deg, #ffffff 30%, #67e8f9 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              {APP_NAME}
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '1rem', maxWidth: '36rem', margin: '0 auto', letterSpacing: '0.01em' }}>
              {APP_TAGLINE}
            </p>
          </div>

          {/* CTA */}
          <div className="flex flex-col items-center" style={{ gap: '0.75rem', marginBottom: '2.5rem' }}>
            <button
              onClick={() => setView('intake')}
              style={{ backgroundColor: '#06b6d4', color: '#000', padding: '0.875rem 2.5rem' }}
              className="group flex items-center gap-2 font-bold rounded-2xl transition-all text-base shadow-2xl hover:opacity-90 hover:scale-[1.02] active:scale-[0.99]"
            >
              Create My Plan
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <p style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.05em' }}>The 6 Speciality Agents Pipeline:</p>
          </div>

          {/* Divider */}
          <div className="h-px mb-10" style={{ background: 'rgba(255,255,255,0.05)' }} />

          {/* Agent Cards — 3 col grid */}
          <div className="grid grid-cols-3 gap-4 mb-12">
            {AGENTS.map((agent) => {
              const Icon = agent.icon;
              return (
                <div
                  key={agent.number}
                  className="rounded-2xl p-5 flex flex-col gap-3 border"
                  style={{ background: agent.bg, borderColor: agent.border }}
                >
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center border"
                      style={{ background: agent.bg, borderColor: agent.border }}>
                      <Icon style={{ width: 18, height: 18, color: agent.color }} />
                    </div>
                    <span className="text-xs font-mono font-bold" style={{ color: agent.color, opacity: 0.6 }}>{agent.number}</span>
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-sm mb-1.5">{agent.title} Agent</h3>
                    <p className="text-slate-400 text-xs leading-relaxed">{agent.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Disclaimer */}
          <div className="rounded-2xl border p-5 text-center" style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', marginTop: '0.5rem' }}>
            <p style={{ color: '#475569', fontSize: '0.72rem', lineHeight: 1.7, maxWidth: '640px', margin: '0 auto' }}>
              © 2026 Alpha Horizon. For informational and educational purposes only. Not financial, investment, or tax advice.
              Past performance does not predict future results. Consult a licensed financial advisor (RIA/CFP) before making any investment decisions.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 space-y-8" style={{ paddingTop: view !== 'home' ? '3.5rem' : 0, paddingBottom: view !== 'home' ? '5rem' : 0 }}>
        {view === 'intake' && (
          <IntakeWizard onComplete={handleIntakeComplete} onBack={() => setView('home')} />
        )}

        {view === 'running' && answers && (
          <AgentStatusPanel answers={answers} onComplete={handleRunComplete} onReset={handleReset} />
        )}

        {view === 'results' && plan && runState && answers && (
          <PortfolioPlanCard plan={plan} runState={runState} answers={answers} onReset={handleReset} />
        )}
      </div>
    </div>
  );
}
