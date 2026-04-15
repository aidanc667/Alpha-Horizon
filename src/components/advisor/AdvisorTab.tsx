'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Brain, MessageSquare, PieChart, Zap, GitCompare, Star, Target,
  Plus, Trash2, Send, Loader2, Activity, RefreshCw, CheckCircle,
  AlertTriangle, Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import type { NearTermIntelligence, LiveBriefing } from '@/types/market';
import { useAppContext } from '@/lib/appContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdvisorMode = 'chat' | 'portfolio' | 'thesis' | 'compare' | 'best-assets' | 'best-strategy';
type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';
type TimeHorizon = '6 months' | '1 year' | '3-5 years' | '10 years';
type ContextStatus = 'loading' | 'ready' | 'partial' | 'failed';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

interface PortfolioRow {
  id: string;
  asset: string;
  amount: string;
  accountType: string;
}

interface BestAsset {
  rank: number;
  ticker: string;
  name: string;
  category: string;
  suggestedWeight: number;
  forwardReturn: string;
  rationale: string;
  risk: 'Low' | 'Medium' | 'High';
  expenseRatio: string;
}

interface BestAssetsResult {
  regime: string;
  generatedAt: string;
  assets: BestAsset[];
  macroAlignment: string;
}

interface AllocationRow {
  ticker: string;
  name: string;
  weight: number;
  category: string;
  rationale: string;
  expenseRatio: string;
}

interface BestStrategyResult {
  strategyName: string;
  riskProfile: string;
  expectedReturn: string;
  expectedVolatility: string;
  sharpeEstimate: string;
  macroAlignment: string;
  rebalancingGuidance: string;
  allocations: AllocationRow[];
  riskWarnings: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES = [
  'Taxable Brokerage',
  'Roth IRA',
  'Traditional 401k',
  'Traditional IRA',
  'HSA',
  '529 Plan',
  'Cash / Savings',
];

const SUGGESTED_PROMPTS = [
  "What's the best hedge against rising rates right now?",
  "Where is smart money tilting in this regime?",
  "Should I extend or shorten duration today?",
  "Which sectors are most exposed to current macro risks?",
  "How should I position cash in this environment?",
  "Is this a good time to increase EM exposure?",
  "What does the yield curve say about the next 6 months?",
  "Best defensive plays if volatility spikes from here?",
];

const MODES: { id: AdvisorMode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'chat',          label: 'Intelligence Chat',   Icon: MessageSquare },
  { id: 'portfolio',     label: 'Portfolio Analyzer',  Icon: PieChart },
  { id: 'thesis',        label: 'Stress Tester',       Icon: Zap },
  { id: 'compare',       label: 'Asset Comparison',    Icon: GitCompare },
  { id: 'best-assets',   label: 'Best Assets Now',     Icon: Star },
  { id: 'best-strategy', label: 'Optimal Portfolio',   Icon: Target },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdvisorTab() {
  const { labSnapshot, plannerSnapshot, buildAdvisorContext } = useAppContext();

  // Home screen gate
  const [hasStarted, setHasStarted] = useState(false);

  // Context
  const [nearTermData, setNearTermData] = useState<NearTermIntelligence | null>(null);
  const [liveData, setLiveData]         = useState<LiveBriefing | null>(null);
  const [contextStatus, setContextStatus] = useState<ContextStatus>('loading');

  // UI
  const [mode, setMode]         = useState<AdvisorMode>('chat');
  const [quickMode, setQuickMode] = useState(false);

  // Chat (shared across chat/portfolio/thesis/compare modes)
  const [messages, setMessages]   = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Portfolio builder
  const [portfolioRows, setPortfolioRows] = useState<PortfolioRow[]>([
    { id: '1', asset: '', amount: '', accountType: 'Taxable Brokerage' },
  ]);

  // Thesis
  const [thesis, setThesis] = useState('');

  // Compare
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');

  // Tool-specific results (portfolio / thesis / compare — each has its own result area, no shared chat)
  const [portfolioResult, setPortfolioResult] = useState<string | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [thesisResult, setThesisResult] = useState<string | null>(null);
  const [thesisLoading, setThesisLoading] = useState(false);
  const [compareResult, setCompareResult] = useState<string | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // Generation (best-assets / best-strategy)
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('Moderate');
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('1 year');
  const [bestAssetsResult, setBestAssetsResult]     = useState<BestAssetsResult | null>(null);
  const [bestStrategyResult, setBestStrategyResult] = useState<BestStrategyResult | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError]     = useState<string | null>(null);

  // Session context — accumulates across tool uses so all modes stay consistent
  const [sessionCtx, setSessionCtx] = useState({
    portfolio: '',          // e.g. "SPY 60%, BND 40% in Taxable Brokerage"
    portfolioFindings: '',  // first 300 chars of portfolio analysis result
    thesis: '',             // last stress-tested thesis
    bestTickers: '',        // top tickers from last Best Assets or Optimal Portfolio run
    crossTabContext: '',    // snapshot injected from Lab + Planner tabs
  });

  // ── Sync cross-tab snapshots into sessionCtx whenever they update ───────────
  useEffect(() => {
    const ctx = buildAdvisorContext();
    if (!ctx) return;
    setSessionCtx(prev => ({ ...prev, crossTabContext: ctx }));
  }, [labSnapshot, plannerSnapshot, buildAdvisorContext]);

  // ── Load market context after user clicks Start ────────────────────────────
  useEffect(() => {
    if (!hasStarted) return;
    const load = async () => {
      const [nearRes, liveRes] = await Promise.allSettled([
        fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'nearTerm' }) }),
        fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'liveUpdate' }) }),
      ]);
      let nearOk = false, liveOk = false;
      if (nearRes.status === 'fulfilled' && nearRes.value.ok) {
        const d = await nearRes.value.json();
        if (d.success) { setNearTermData(d.data); nearOk = true; }
      }
      if (liveRes.status === 'fulfilled' && liveRes.value.ok) {
        const d = await liveRes.value.json();
        if (d.success) { setLiveData(d.data); liveOk = true; }
      }
      setContextStatus(nearOk && liveOk ? 'ready' : nearOk || liveOk ? 'partial' : 'failed');
    };
    load();
  }, [hasStarted]);

  // ── Scroll chat to bottom ──────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // ── Send chat message ──────────────────────────────────────────────────────
  const sendChat = async (text: string) => {
    if (!text.trim() || chatLoading) return;
    const userMsg: Message = { role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);
    try {
      const historyForAPI = [...messages, userMsg].map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        text: m.text,
      }));
      const res = await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'advisorChat', history: historyForAPI, nearTermContext: nearTermData, liveContext: liveData, quickMode, sessionCtx }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', text: data.data || 'No response generated.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Error getting response. Please try again.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Shared helper: call advisorChat API and return text ───────────────────
  const callAdvisorChat = async (prompt: string): Promise<string> => {
    const res = await fetch('/api/market', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'advisorChat',
        history: [{ role: 'user', text: prompt }],
        nearTermContext: nearTermData,
        liveContext: liveData,
        quickMode,
        sessionCtx,
      }),
    });
    const data = await res.json();
    return data.data || 'No response generated.';
  };

  // ── Analyze portfolio ──────────────────────────────────────────────────────
  const analyzePortfolio = async () => {
    const valid = portfolioRows.filter(r => r.asset.trim() && r.amount.trim());
    if (!valid.length) return;
    const holdings = valid.map(r => `${r.asset}: $${Number(r.amount).toLocaleString()} in ${r.accountType}`).join('\n');
    const prompt = `Analyze my investment portfolio with institutional precision:\n\n${holdings}\n\nProvide: (1) Macro regime alignment score, (2) Concentration risks, (3) Tax efficiency of account placement, (4) Specific improvement suggestions with tickers and weights, (5) Forward-looking outlook and overall grade.`;
    setPortfolioLoading(true);
    setPortfolioResult(null);
    try {
      const result = await callAdvisorChat(prompt);
      setPortfolioResult(result);
      const holdingsStr = valid.map(r => `${r.asset}: $${Number(r.amount).toLocaleString()} in ${r.accountType}`).join(', ');
      setSessionCtx(prev => ({
        ...prev,
        portfolio: holdingsStr,
        portfolioFindings: result.slice(0, 300).replace(/\n/g, ' '),
      }));
    } catch {
      setPortfolioResult('Error getting response. Please try again.');
    } finally {
      setPortfolioLoading(false);
    }
  };

  // ── Stress test thesis ─────────────────────────────────────────────────────
  const stressTestThesis = async () => {
    if (!thesis.trim()) return;
    const t = thesis;
    const prompt = `Stress test this investment thesis against today's market conditions:\n\n"${t}"\n\nProvide: (1) Bear case — which macro scenarios invalidate this? (2) Bull case — what strengthens it? (3) Top 3 risks with current data, (4) Probability-weighted verdict, (5) Recommended position sizing if you had to bet.`;
    setThesisLoading(true);
    setThesisResult(null);
    try {
      const result = await callAdvisorChat(prompt);
      setThesisResult(result);
      setSessionCtx(prev => ({ ...prev, thesis: t.slice(0, 150) }));
    } catch {
      setThesisResult('Error getting response. Please try again.');
    } finally {
      setThesisLoading(false);
    }
  };

  // ── Compare assets ─────────────────────────────────────────────────────────
  const compareAssets = async () => {
    if (!compareA.trim() || !compareB.trim()) return;
    const prompt = `Compare ${compareA} vs ${compareB} for the current macro environment. Provide: (1) Forward-looking return outlook for each given today's regime, (2) Risk-adjusted comparison (Sharpe, drawdown risk), (3) Which is better to own RIGHT NOW and why, (4) Recommended holding period, (5) Scenario where the losing pick wins.`;
    setCompareLoading(true);
    setCompareResult(null);
    try {
      setCompareResult(await callAdvisorChat(prompt));
    } catch {
      setCompareResult('Error getting response. Please try again.');
    } finally {
      setCompareLoading(false);
    }
  };

  // ── Generate Best Assets ───────────────────────────────────────────────────
  const generateBestAssets = async () => {
    setGenLoading(true); setGenError(null); setBestAssetsResult(null);
    try {
      const res = await fetch('/api/market', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bestAssets', riskProfile, timeHorizon, nearTermContext: nearTermData, liveContext: liveData, sessionCtx }),
      });
      const data = await res.json();
      if (data.success) {
        setBestAssetsResult(data.data);
        const tickers = ((data.data?.assets || []) as any[]).slice(0, 5)
          .map((a: any) => `${a.ticker}(${a.suggestedWeight}%)`).join(', ');
        if (tickers) setSessionCtx(prev => ({ ...prev, bestTickers: tickers }));
      } else {
        setGenError(data.error || 'Generation failed');
      }
    } catch (e: any) {
      setGenError(e.message || 'Error generating best assets');
    } finally {
      setGenLoading(false);
    }
  };

  // ── Generate Best Strategy ─────────────────────────────────────────────────
  const generateBestStrategy = async () => {
    setGenLoading(true); setGenError(null); setBestStrategyResult(null);
    try {
      const res = await fetch('/api/market', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bestStrategy', riskProfile, timeHorizon, nearTermContext: nearTermData, liveContext: liveData, sessionCtx }),
      });
      const data = await res.json();
      if (data.success) {
        setBestStrategyResult(data.data);
        const tickers = ((data.data?.allocations || []) as any[]).slice(0, 5)
          .map((a: any) => `${a.ticker}(${a.weight}%)`).join(', ');
        if (tickers) setSessionCtx(prev => ({ ...prev, bestTickers: tickers }));
      } else {
        setGenError(data.error || 'Generation failed');
      }
    } catch (e: any) {
      setGenError(e.message || 'Error generating best strategy');
    } finally {
      setGenLoading(false);
    }
  };

  // ── Home splash screen ─────────────────────────────────────────────────────
  if (!hasStarted) {
    return (
      <div className="min-h-full flex flex-col bg-white">
        {/* Tab header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
              <Brain className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Portfolio Intelligence AI</p>
              <p className="text-xs text-gray-600">Real-Time Market-Grounded Advisor</p>
            </div>
          </div>
        </div>

        {/* Hero Banner — orange theme */}
        <div className="relative overflow-hidden px-8 pt-12 pb-10 text-center" style={{background: 'linear-gradient(135deg, #1a0a00 0%, #2d1200 50%, #1a0c00 100%)'}}>
          <div className="absolute inset-0 opacity-10" style={{backgroundImage: 'radial-gradient(circle at 20% 50%, #f97316 0%, transparent 50%), radial-gradient(circle at 80% 20%, #fb923c 0%, transparent 40%)'}} />
          <div className="relative z-10 max-w-2xl mx-auto space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-500/30 text-orange-400 text-xs font-semibold uppercase tracking-widest mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
              AI-Powered · Live Market Grounding · Real-Time Data
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">Portfolio Intelligence AI</h1>
            <p className="text-slate-300 text-sm leading-relaxed max-w-lg mx-auto">
              Institutional-grade AI advisor grounded in real-time market data. Analyze your portfolio, stress-test theses, compare assets, and discover optimal allocations — all powered by live market context.
            </p>
            {/* Stats row */}
            <div className="flex items-center justify-center gap-8 pt-2">
              {[
                { value: 'Live', label: 'Market Data' },
                { value: 'AI', label: 'Grounded' },
                { value: '6', label: 'Features' },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <p className="text-xl font-black font-mono text-orange-400">{s.value}</p>
                  <p className="text-xs text-slate-400 uppercase tracking-wider">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Feature cards + CTA */}
        <div className="flex-1 px-6 py-8 max-w-4xl mx-auto w-full flex flex-col items-center gap-6">
          {/* Feature grid */}
          <div className="grid grid-cols-3 gap-4 w-full max-w-2xl">
            {[
              { label: 'Intelligence Chat',  desc: 'Real-time market Q&A grounded in live macro data',       Icon: MessageSquare, color: 'text-orange-700', iconColor: 'text-orange-600', bg: 'bg-white border-orange-200', iconBg: 'bg-orange-50', bar: 'bg-orange-400' },
              { label: 'Portfolio Analyzer', desc: 'Analyze holdings with macro regime alignment scoring',     Icon: PieChart,      color: 'text-orange-700', iconColor: 'text-orange-600', bg: 'bg-white border-orange-200', iconBg: 'bg-orange-50', bar: 'bg-orange-400' },
              { label: 'Stress Tester',      desc: 'Test investment theses against current market conditions', Icon: Zap,           color: 'text-orange-700', iconColor: 'text-orange-600', bg: 'bg-white border-orange-200', iconBg: 'bg-orange-50', bar: 'bg-orange-400' },
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
              'Asset comparison vs current macro regime',
              'Best assets now based on live market signals',
              'Optimal portfolio allocation strategy',
              'Suggested prompts for institutional insights',
              'Quick & detailed response modes',
              'Live data from Bloomberg, Reuters, FT, WSJ',
            ].map(f => (
              <div key={f} className="flex items-center gap-2 text-xs text-gray-600 bg-white border border-gray-100 rounded-lg px-3 py-2">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />
                {f}
              </div>
            ))}
          </div>

          <button
            onClick={() => setHasStarted(true)}
            className="px-10 py-3.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-sm transition-all active:scale-95 shadow-lg shadow-orange-500/25 flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Start Portfolio Intelligence →
          </button>

          <p className="text-xs text-slate-500 max-w-lg text-center leading-relaxed px-4">
            © 2026 Alpha Horizon. For informational and educational purposes only. Not financial, investment, or tax advice.
            Consult a licensed financial advisor before making any investment decisions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-zinc-200 px-6 pt-5 pb-0 bg-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center shadow-sm">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-zinc-900 leading-tight">Portfolio Intelligence AI</h1>
              <p className="text-xs text-zinc-500">Real-time market-grounded AI advisor</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Context status pill */}
            <div className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border',
              contextStatus === 'ready'   ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              contextStatus === 'partial' ? 'bg-amber-50  text-amber-700  border-amber-200'  :
              contextStatus === 'loading' ? 'bg-blue-50   text-blue-700   border-blue-200'   :
                                           'bg-zinc-100  text-zinc-500   border-zinc-200'
            )}>
              {contextStatus === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> :
               contextStatus === 'ready'   ? <CheckCircle className="w-3 h-3" /> :
                                             <AlertTriangle className="w-3 h-3" />}
              {contextStatus === 'loading' ? 'Loading market context...' :
               contextStatus === 'ready'   ? 'Market context ready' :
               contextStatus === 'partial' ? 'Partial context' : 'Context unavailable'}
            </div>

            {/* Quick / Detailed toggle */}
            <div className="flex items-center gap-0.5 bg-zinc-100 rounded-lg p-1 border border-zinc-200">
              <button onClick={() => setQuickMode(false)} className={clsx('px-3 py-1 rounded-md text-xs font-semibold transition-all', !quickMode ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700')}>
                Detailed
              </button>
              <button onClick={() => setQuickMode(true)} className={clsx('px-3 py-1 rounded-md text-xs font-semibold transition-all', quickMode ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700')}>
                Quick
              </button>
            </div>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 overflow-x-auto pb-0">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-all border-b-2 -mb-px',
                mode === id
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* ── Cross-tab context banner ────────────────────────────────────────── */}
      {(labSnapshot || plannerSnapshot) && (
        <div className="flex-shrink-0 flex items-start gap-3 px-6 py-2.5 bg-orange-50 border-b border-orange-100">
          <div className="w-4 h-4 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Activity className="w-2.5 h-2.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-orange-800 mb-0.5">Cross-tab context loaded — AI has full awareness of your other sessions</p>
            <div className="flex flex-wrap gap-3">
              {labSnapshot && (
                <span className="text-xs text-orange-700 font-mono bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-lg whitespace-nowrap">
                  📊 Lab: {labSnapshot.allocations.split(', ').slice(0, 3).join(', ')}{labSnapshot.allocations.split(', ').length > 3 ? '…' : ''} · CAGR {labSnapshot.cagr} · Score {labSnapshot.score ?? '—'}/100
                </span>
              )}
              {plannerSnapshot && (
                <span className="text-xs text-orange-700 font-mono bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-lg whitespace-nowrap">
                  🗺 Plan: {plannerSnapshot.goal} goal · {plannerSnapshot.timeline} · {plannerSnapshot.riskProfile} · Fed {plannerSnapshot.marginalFederal}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {mode === 'chat' ? (
          <>
            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
              {messages.length === 0 && (
                <div className="pt-6">
                  <p className="text-center text-zinc-400 text-sm mb-6 leading-relaxed">
                    {contextStatus === 'ready'
                      ? 'Market context loaded — ask me anything about investments, markets, and portfolio strategy.'
                      : contextStatus === 'loading'
                      ? 'Loading real-time market context in the background...'
                      : 'Ask me anything — I have broad investment knowledge.'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl mx-auto">
                    {SUGGESTED_PROMPTS.map(p => (
                      <button key={p} onClick={() => sendChat(p)}
                        className="text-left text-xs text-zinc-600 bg-zinc-50 hover:bg-orange-50 hover:text-orange-700 hover:border-orange-200 border border-zinc-200 rounded-xl px-4 py-3 transition-all leading-relaxed"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={clsx('flex items-start gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shrink-0 mt-0.5">
                      <Brain className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className={clsx(
                    'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-zinc-900 text-white rounded-tr-sm'
                      : 'bg-zinc-50 text-zinc-800 border border-zinc-200 rounded-tl-sm whitespace-pre-wrap'
                  )}>
                    {msg.text}
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex items-start gap-3 justify-start">
                  <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
                    <Brain className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-zinc-50 border border-zinc-200 rounded-2xl rounded-tl-sm px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce [animation-delay:0ms]" />
                      <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce [animation-delay:150ms]" />
                      <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div className="flex-shrink-0 border-t border-zinc-200 px-6 py-4 bg-white">
              <div className="flex items-center gap-3 bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100 transition-all">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(chatInput); } }}
                  placeholder="Ask about markets, assets, strategies, positioning..."
                  className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none"
                  disabled={chatLoading}
                />
                <button
                  onClick={() => sendChat(chatInput)}
                  disabled={chatLoading || !chatInput.trim()}
                  className="w-8 h-8 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 flex items-center justify-center transition-colors"
                >
                  <Send className="w-3.5 h-3.5 text-white" />
                </button>
              </div>
              <p className="text-[10px] text-zinc-400 mt-2 text-center">
                {nearTermData
                  ? `Macro data as of ${nearTermData.timestamp}`
                  : 'Market context loading...'
                }{liveData ? ` · ${liveData.newsHeadlines?.length || 0} live headlines` : ''}
                {' · For informational purposes only · © 2026 Alpha Horizon'}
              </p>
            </div>
          </>
        ) : mode === 'portfolio' ? (
          <>
            <PortfolioBuilderPanel rows={portfolioRows} setRows={setPortfolioRows} onAnalyze={analyzePortfolio} loading={portfolioLoading} />
            <ToolResultArea result={portfolioResult} loading={portfolioLoading} emptyText="Add your holdings above and click Analyze Portfolio." />
          </>
        ) : mode === 'thesis' ? (
          <>
            <ThesisPanel thesis={thesis} setThesis={setThesis} onStressTest={stressTestThesis} loading={thesisLoading} />
            <ToolResultArea result={thesisResult} loading={thesisLoading} emptyText="Enter your investment thesis above and click Stress Test." />
          </>
        ) : mode === 'compare' ? (
          <>
            <ComparePanel compareA={compareA} compareB={compareB} setCompareA={setCompareA} setCompareB={setCompareB} onCompare={compareAssets} loading={compareLoading} />
            <ToolResultArea result={compareResult} loading={compareLoading} emptyText="Enter two assets above and click Compare." />
          </>
        ) : (
          /* ── Generation modes ─────────────────────────────────────────── */
          <GenerationPanel
            mode={mode}
            riskProfile={riskProfile}
            setRiskProfile={setRiskProfile}
            timeHorizon={timeHorizon}
            setTimeHorizon={setTimeHorizon}
            onGenerate={mode === 'best-assets' ? generateBestAssets : generateBestStrategy}
            loading={genLoading}
            error={genError}
            bestAssetsResult={bestAssetsResult}
            bestStrategyResult={bestStrategyResult}
            contextStatus={contextStatus}
          />
        )}
      </div>
    </div>
  );
}

// ─── Tool Result Area ─────────────────────────────────────────────────────────

function ToolResultArea({ result, loading, emptyText }: {
  result: string | null;
  loading: boolean;
  emptyText: string;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
      {loading && (
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
            <Brain className="w-4 h-4 text-white" />
          </div>
          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl rounded-tl-sm px-4 py-3.5">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce [animation-delay:0ms]" />
              <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce [animation-delay:150ms]" />
              <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}
      {!loading && result && (
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shrink-0 mt-0.5">
            <Brain className="w-4 h-4 text-white" />
          </div>
          <div className="bg-zinc-50 text-zinc-800 border border-zinc-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap max-w-[85%]">
            {result}
          </div>
        </div>
      )}
      {!loading && !result && (
        <div className="text-center py-12 text-zinc-400 text-sm">
          {emptyText}
        </div>
      )}
    </div>
  );
}

// ─── Portfolio Builder Panel ──────────────────────────────────────────────────

function PortfolioBuilderPanel({
  rows, setRows, onAnalyze, loading,
}: {
  rows: PortfolioRow[];
  setRows: React.Dispatch<React.SetStateAction<PortfolioRow[]>>;
  onAnalyze: () => void;
  loading: boolean;
}) {
  const addRow = () => setRows(r => [...r, { id: Date.now().toString(), asset: '', amount: '', accountType: 'Taxable Brokerage' }]);
  const removeRow = (id: string) => setRows(r => r.filter(row => row.id !== id));
  const updateRow = (id: string, field: keyof PortfolioRow, value: string) =>
    setRows(r => r.map(row => row.id === id ? { ...row, [field]: value } : row));

  const totalValue = rows.reduce((s, r) => s + (parseFloat(r.amount.replace(/,/g, '')) || 0), 0);

  return (
    <div className="flex-shrink-0 border-b border-zinc-200 px-6 py-4 bg-zinc-50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <PieChart className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-bold text-zinc-900">Portfolio Holdings</span>
          {totalValue > 0 && (
            <span className="text-xs text-zinc-500 font-medium">
              Total: ${totalValue.toLocaleString()}
            </span>
          )}
        </div>
        <button onClick={addRow} className="flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Asset
        </button>
      </div>

      <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
        {rows.map(row => (
          <div key={row.id} className="flex items-center gap-2">
            <input
              value={row.asset}
              onChange={e => updateRow(row.id, 'asset', e.target.value.toUpperCase())}
              placeholder="TICKER or Name"
              className="w-32 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-orange-400 uppercase font-mono"
            />
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">$</span>
              <input
                value={row.amount}
                onChange={e => updateRow(row.id, 'amount', e.target.value)}
                placeholder="Amount"
                className="w-28 bg-white border border-zinc-200 rounded-lg pl-6 pr-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-orange-400"
              />
            </div>
            <select
              value={row.accountType}
              onChange={e => updateRow(row.id, 'accountType', e.target.value)}
              className="flex-1 bg-white border border-zinc-200 rounded-lg px-2 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-orange-400"
            >
              {ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            {rows.length > 1 && (
              <button onClick={() => removeRow(row.id)} className="p-1.5 text-zinc-300 hover:text-red-500 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={onAnalyze}
        disabled={loading || rows.every(r => !r.asset.trim())}
        className="mt-3 w-full bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 text-white disabled:text-zinc-400 text-xs font-bold py-2 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
        Analyze Portfolio
      </button>
    </div>
  );
}

// ─── Thesis Panel ─────────────────────────────────────────────────────────────

function ThesisPanel({ thesis, setThesis, onStressTest, loading }: {
  thesis: string; setThesis: (s: string) => void; onStressTest: () => void; loading: boolean;
}) {
  return (
    <div className="flex-shrink-0 border-b border-zinc-200 px-6 py-4 bg-zinc-50">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-4 h-4 text-orange-500" />
        <span className="text-sm font-bold text-zinc-900">Investment Thesis</span>
      </div>
      <textarea
        value={thesis}
        onChange={e => setThesis(e.target.value)}
        placeholder='e.g. "I think tech will outperform over the next 6 months because AI capex is still accelerating and the Fed is done hiking"'
        className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 text-xs text-zinc-900 placeholder-zinc-400 resize-none h-20 focus:outline-none focus:border-orange-400 leading-relaxed"
      />
      <button
        onClick={onStressTest}
        disabled={loading || !thesis.trim()}
        className="mt-2 w-full bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 text-white disabled:text-zinc-400 text-xs font-bold py-2 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        Stress Test Thesis
      </button>
    </div>
  );
}

// ─── Compare Panel ────────────────────────────────────────────────────────────

function ComparePanel({ compareA, compareB, setCompareA, setCompareB, onCompare, loading }: {
  compareA: string; compareB: string;
  setCompareA: (s: string) => void; setCompareB: (s: string) => void;
  onCompare: () => void; loading: boolean;
}) {
  return (
    <div className="flex-shrink-0 border-b border-zinc-200 px-6 py-4 bg-zinc-50">
      <div className="flex items-center gap-2 mb-3">
        <GitCompare className="w-4 h-4 text-orange-500" />
        <span className="text-sm font-bold text-zinc-900">Asset Comparison</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          value={compareA}
          onChange={e => setCompareA(e.target.value.toUpperCase())}
          placeholder="Asset A (e.g., QQQ)"
          className="flex-1 bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-xs text-zinc-900 placeholder-zinc-400 uppercase font-mono focus:outline-none focus:border-orange-400"
        />
        <span className="text-sm font-bold text-zinc-400">vs</span>
        <input
          value={compareB}
          onChange={e => setCompareB(e.target.value.toUpperCase())}
          placeholder="Asset B (e.g., SPY)"
          className="flex-1 bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-xs text-zinc-900 placeholder-zinc-400 uppercase font-mono focus:outline-none focus:border-orange-400"
        />
        <button
          onClick={onCompare}
          disabled={loading || !compareA.trim() || !compareB.trim()}
          className="bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 text-white disabled:text-zinc-400 text-xs font-bold px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCompare className="w-3.5 h-3.5" />}
          Compare
        </button>
      </div>
    </div>
  );
}

// ─── Generation Panel (Best Assets / Best Strategy) ───────────────────────────

function GenerationPanel({
  mode, riskProfile, setRiskProfile, timeHorizon, setTimeHorizon,
  onGenerate, loading, error, bestAssetsResult, bestStrategyResult, contextStatus,
}: {
  mode: AdvisorMode;
  riskProfile: RiskProfile; setRiskProfile: (r: RiskProfile) => void;
  timeHorizon: TimeHorizon; setTimeHorizon: (h: TimeHorizon) => void;
  onGenerate: () => void; loading: boolean; error: string | null;
  bestAssetsResult: BestAssetsResult | null;
  bestStrategyResult: BestStrategyResult | null;
  contextStatus: ContextStatus;
}) {
  const isBestAssets = mode === 'best-assets';

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
      {/* Controls */}
      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-6 mb-6">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Risk Profile</p>
            <div className="flex gap-2">
              {(['Conservative', 'Moderate', 'Aggressive'] as RiskProfile[]).map(r => (
                <button key={r} onClick={() => setRiskProfile(r)}
                  className={clsx('px-4 py-2 rounded-xl text-xs font-semibold border transition-all',
                    riskProfile === r ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-zinc-600 border-zinc-200 hover:border-orange-300'
                  )}
                >{r}</button>
              ))}
            </div>
          </div>

          {isBestAssets && (
            <div>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Time Horizon</p>
              <div className="flex gap-2">
                {(['6 months', '1 year', '3-5 years', '10 years'] as TimeHorizon[]).map(h => (
                  <button key={h} onClick={() => setTimeHorizon(h)}
                    className={clsx('px-3 py-2 rounded-xl text-xs font-semibold border transition-all',
                      timeHorizon === h ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-zinc-600 border-zinc-200 hover:border-orange-300'
                    )}
                  >{h}</button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onGenerate}
            disabled={loading}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 text-white disabled:text-zinc-400 px-6 py-2.5 rounded-xl text-sm font-bold transition-colors"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : isBestAssets ? <Star className="w-4 h-4" /> : <Target className="w-4 h-4" />}
            {loading ? 'Generating...' : isBestAssets ? 'Generate Best Assets' : 'Generate Optimal Portfolio'}
          </button>
        </div>

        {contextStatus !== 'ready' && (
          <p className="text-xs text-amber-600 mt-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            {contextStatus === 'loading'
              ? 'Market context still loading — results will improve once ready.'
              : 'Market context unavailable — results based on training data only.'}
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">{error}</div>
      )}

      {isBestAssets && bestAssetsResult && <BestAssetsDisplay result={bestAssetsResult} />}
      {!isBestAssets && bestStrategyResult && <BestStrategyDisplay result={bestStrategyResult} />}

      {!loading && !error && !bestAssetsResult && !bestStrategyResult && (
        <div className="text-center py-16 text-zinc-400">
          <div className="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center mx-auto mb-4">
            {isBestAssets ? <Star className="w-8 h-8 text-orange-300" /> : <Target className="w-8 h-8 text-orange-300" />}
          </div>
          <p className="font-semibold text-zinc-500 mb-2 text-base">
            {isBestAssets ? 'Best Assets Now' : 'Optimal Portfolio Strategy'}
          </p>
          <p className="text-sm max-w-sm mx-auto leading-relaxed">
            {isBestAssets
              ? 'Select your risk profile and time horizon, then generate forward-looking top asset picks grounded in today\'s market conditions.'
              : 'Select your risk profile and generate a fully optimized, macro-aligned portfolio allocation for today\'s environment.'}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Best Assets Display ──────────────────────────────────────────────────────

function BestAssetsDisplay({ result }: { result: BestAssetsResult }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">Top Assets Right Now</h2>
          <p className="text-sm text-zinc-500 mt-0.5">{result.generatedAt} · Regime: <span className="font-medium text-zinc-700">{result.regime}</span></p>
        </div>
      </div>

      <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-4 text-sm text-orange-900 leading-relaxed">
        <span className="font-bold">Macro Alignment: </span>{result.macroAlignment}
      </div>

      <div className="space-y-3">
        {(result.assets || []).map((asset, i) => (
          <div key={i} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-start gap-4 hover:border-orange-200 transition-colors">
            <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 font-bold text-sm flex items-center justify-center shrink-0">
              {asset.rank}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-base font-bold text-zinc-900 font-mono">{asset.ticker}</span>
                <span className="text-sm text-zinc-600">{asset.name}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{asset.category}</span>
                <span className={clsx(
                  'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
                  asset.risk === 'Low' ? 'bg-emerald-100 text-emerald-700' :
                  asset.risk === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                )}>{asset.risk} Risk</span>
              </div>
              <p className="text-sm text-zinc-600 leading-relaxed mb-3">{asset.rationale}</p>
              <div className="flex items-center gap-6 text-xs text-zinc-500 flex-wrap">
                <span><strong className="text-zinc-700">Weight:</strong> {asset.suggestedWeight}%</span>
                <span><strong className="text-zinc-700">Fwd Return:</strong> {asset.forwardReturn}</span>
                <span><strong className="text-zinc-700">ER:</strong> {asset.expenseRatio}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-zinc-400 leading-relaxed">
        For informational and educational purposes only. Not financial advice. Past performance does not guarantee future results. © 2026 Alpha Horizon
      </p>
    </div>
  );
}

// ─── Best Strategy Display ────────────────────────────────────────────────────

function BestStrategyDisplay({ result }: { result: BestStrategyResult }) {
  const totalWeight = (result.allocations || []).reduce((s, a) => s + (a.weight || 0), 0);

  return (
    <div className="space-y-6">
      {/* Strategy header card */}
      <div className="bg-zinc-900 text-white rounded-2xl p-8">
        <div className="flex items-start justify-between gap-6 flex-wrap mb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-1">Optimal Strategy</p>
            <h2 className="text-2xl font-bold leading-tight">{result.strategyName}</h2>
            <p className="text-zinc-400 text-sm mt-1">{result.riskProfile} · Generated {new Date().toLocaleDateString()}</p>
          </div>
          <div className="flex gap-8">
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Expected Return</p>
              <p className="text-2xl font-bold text-emerald-400">{result.expectedReturn}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Volatility</p>
              <p className="text-2xl font-bold text-amber-400">{result.expectedVolatility}</p>
            </div>
            {result.sharpeEstimate && (
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Sharpe Est.</p>
                <p className="text-2xl font-bold text-blue-400">{result.sharpeEstimate}</p>
              </div>
            )}
          </div>
        </div>
        <p className="text-zinc-300 text-sm leading-relaxed">{result.macroAlignment}</p>
      </div>

      {/* Allocations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Allocations</h3>
          <span className={clsx('text-xs font-bold', Math.abs(totalWeight - 100) < 1 ? 'text-emerald-600' : 'text-amber-600')}>
            Total: {totalWeight.toFixed(1)}%
          </span>
        </div>
        <div className="space-y-3">
          {(result.allocations || []).map((alloc, i) => (
            <div key={i} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-start gap-4 hover:border-orange-200 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-base font-bold text-zinc-900 font-mono">{alloc.ticker}</span>
                  <span className="text-sm text-zinc-600">{alloc.name}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">{alloc.category}</span>
                  <span className="text-[10px] text-zinc-400">ER: {alloc.expenseRatio}</span>
                </div>
                <p className="text-sm text-zinc-600 leading-relaxed">{alloc.rationale}</p>
              </div>
              <div className="shrink-0 text-right min-w-[60px]">
                <div className="text-2xl font-bold text-zinc-900">{alloc.weight}%</div>
                <div className="w-14 h-1.5 bg-zinc-100 rounded-full mt-1.5 ml-auto overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full" style={{ width: `${Math.min(alloc.weight, 100)}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Guidance + warnings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <div className="flex items-center gap-1.5 mb-2">
            <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-700">Rebalancing Guidance</h4>
          </div>
          <p className="text-sm text-blue-800 leading-relaxed">{result.rebalancingGuidance}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-700">Risk Warnings</h4>
          </div>
          <ul className="space-y-2">
            {(result.riskWarnings || []).map((w, i) => (
              <li key={i} className="text-xs text-amber-800 flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-[10px] text-zinc-400 leading-relaxed">
        For informational and educational purposes only. Not financial advice. Consult a licensed financial advisor before investing. © 2026 Alpha Horizon
      </p>
    </div>
  );
}
