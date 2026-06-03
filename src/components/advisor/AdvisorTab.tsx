'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Brain, MessageSquare, PieChart, Zap, GitCompare, Star,
  Plus, Trash2, Send, Loader2, Activity, AlertTriangle,
  CalendarDays, Eye, TrendingUp, TrendingDown, RefreshCw, X, BarChart3,
} from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import type { NearTermIntelligence, LiveBriefing } from '@/types/market';
import { useAppContext } from '@/lib/appContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdvisorMode = 'chat' | 'portfolio' | 'thesis' | 'compare' | 'best-assets' | 'best-strategy' | 'macro-calendar' | 'watchlist';
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

interface StrategyAllocation {
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
  allocations: StrategyAllocation[];
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
  "Should I rebalance my portfolio right now?",
  "What's the right asset allocation for someone in their 40s?",
  "How much should I keep in cash vs. invested?",
  "What's the biggest risk to my portfolio over the next 12 months?",
  "How do I protect against a downturn without leaving the market?",
  "What should I do with a $50,000 windfall right now?",
];

const MODES: { id: AdvisorMode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'chat',          label: 'Intelligence Chat',   Icon: MessageSquare },
  { id: 'portfolio',     label: 'Portfolio Analysis',  Icon: PieChart },
  { id: 'thesis',        label: 'Stress Test',         Icon: Zap },
  { id: 'compare',       label: 'Compare Assets',      Icon: GitCompare },
  { id: 'best-assets',   label: 'Best Stocks',         Icon: Star },
  { id: 'best-strategy', label: 'Optimal Portfolio',   Icon: BarChart3 },
  { id: 'macro-calendar', label: 'Macro Calendar',     Icon: CalendarDays },
  { id: 'watchlist',     label: 'Watchlist',           Icon: Eye },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdvisorTab() {
  const { labSnapshot, plannerSnapshot, buildAdvisorContext } = useAppContext();

  // Context
  const [nearTermData, setNearTermData] = useState<NearTermIntelligence | null>(null);
  const [liveData, setLiveData]         = useState<LiveBriefing | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [polygonCtx, setPolygonCtx]     = useState<any | null>(null);
  const [contextStatus, setContextStatus] = useState<ContextStatus>('loading');

  // UI
  const [mode, setMode] = useState<AdvisorMode>('chat');

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
  const [compareItems, setCompareItems] = useState<string[]>(['', '']);

  // Best Stocks
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('Moderate');
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('1 year');
  const [bestAssetsResult, setBestAssetsResult] = useState<BestAssetsResult | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError]     = useState<string | null>(null);

  // Optimal Portfolio
  const [strategyRiskProfile, setStrategyRiskProfile] = useState<RiskProfile>('Moderate');
  const [strategyHorizon, setStrategyHorizon]         = useState<TimeHorizon>('1 year');
  const [bestStrategyResult, setBestStrategyResult]   = useState<BestStrategyResult | null>(null);
  const [strategyLoading, setStrategyLoading]         = useState(false);
  const [strategyError, setStrategyError]             = useState<string | null>(null);

  // Watchlist
  const [watchlistTickers, setWatchlistTickers] = useState<string[]>([]);
  const [watchlistPrices, setWatchlistPrices] = useState<Record<string, { price: number | null; changePct: number | null; loading: boolean }>>({});
  const [watchlistInput, setWatchlistInput] = useState('');
  const [watchlistAdding, setWatchlistAdding] = useState(false);

  // Session context — accumulates across tool uses so all modes stay consistent
  const [sessionCtx, setSessionCtx] = useState({
    portfolio: '',
    portfolioFindings: '',
    thesis: '',
    bestTickers: '',
    crossTabContext: '',
  });

  const [dismissedLab, setDismissedLab] = useState(false);
  const [dismissedPlanner, setDismissedPlanner] = useState(false);

  // Reset dismissed state when a new snapshot arrives
  useEffect(() => { setDismissedLab(false); }, [labSnapshot]);
  useEffect(() => { setDismissedPlanner(false); }, [plannerSnapshot]);

  // ── Sync cross-tab snapshots into sessionCtx, respecting dismissals ─────────
  useEffect(() => {
    const parts: string[] = [];
    if (labSnapshot && !dismissedLab) {
      parts.push(`[PORTFOLIO GROWTH LAB — last run ${labSnapshot.updatedAt}]`);
      parts.push(`Holdings: ${labSnapshot.allocations}`);
      parts.push(`Period: ${labSnapshot.period}`);
      parts.push(`CAGR: ${labSnapshot.cagr} | Sharpe: ${labSnapshot.sharpe} | Max Drawdown: ${labSnapshot.maxDD} | Alpha vs benchmark: ${labSnapshot.alpha}`);
      if (labSnapshot.score !== null) parts.push(`AHPS Score: ${labSnapshot.score}/100`);
    }
    if (plannerSnapshot && !dismissedPlanner) {
      if (parts.length) parts.push('');
      parts.push(`[FINANCIAL PLANNER — last run ${plannerSnapshot.updatedAt}]`);
      parts.push(`Risk Profile: ${plannerSnapshot.riskProfile} | Timeline: ${plannerSnapshot.timeline} | Goal: ${plannerSnapshot.goal} | Monthly Contribution: ${plannerSnapshot.monthlyContrib}`);
      parts.push(`Bucket Allocation: ${plannerSnapshot.buckets}`);
      parts.push(`Top Holdings Recommended: ${plannerSnapshot.topHoldings}`);
      parts.push(`Tax Brackets: Federal ${plannerSnapshot.marginalFederal} marginal | CA ${plannerSnapshot.marginalCA} marginal`);
    }
    setSessionCtx(prev => ({ ...prev, crossTabContext: parts.join('\n') }));
  }, [labSnapshot, plannerSnapshot, dismissedLab, dismissedPlanner]);

  // ── Watchlist helpers ─────────────────────────────────────────────────────
  const fetchWatchlistPrice = async (ticker: string) => {
    setWatchlistPrices(prev => ({ ...prev, [ticker]: { price: null, changePct: null, loading: true } }));
    try {
      const res = await fetch('/api/market', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'polygonTicker', ticker }),
      });
      const data = await res.json();
      if (data.success) {
        setWatchlistPrices(prev => ({ ...prev, [ticker]: { price: data.data.price, changePct: data.data.changePct, loading: false } }));
      } else {
        setWatchlistPrices(prev => ({ ...prev, [ticker]: { price: null, changePct: null, loading: false } }));
      }
    } catch {
      setWatchlistPrices(prev => ({ ...prev, [ticker]: { price: null, changePct: null, loading: false } }));
    }
  };

  const fetchAllWatchlistPrices = (tickers: string[]) => {
    tickers.forEach(t => fetchWatchlistPrice(t));
  };

  const [watchlistError, setWatchlistError] = useState<string | null>(null);

  const addToWatchlist = async () => {
    const t = watchlistInput.trim().toUpperCase();
    if (!t || watchlistTickers.length >= 20) return;
    setWatchlistAdding(true);
    setWatchlistError(null);
    try {
      const res = await fetch('/api/silas/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: t }) });
      if (res.status === 409) {
        setWatchlistError(`${t} is already in your watchlist`);
        return;
      }
      if (!res.ok) {
        const d = await res.json();
        setWatchlistError(d.error || 'Failed to add ticker');
        return;
      }
      setWatchlistTickers(prev => [...prev, t]);
      fetchWatchlistPrice(t);
      setWatchlistInput('');
    } finally {
      setWatchlistAdding(false);
    }
  };

  const removeFromWatchlist = async (ticker: string) => {
    await fetch('/api/silas/watchlist', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker }) });
    setWatchlistTickers(prev => prev.filter(t => t !== ticker));
    setWatchlistPrices(prev => { const n = { ...prev }; delete n[ticker]; return n; });
  };

  // ── Auto-refresh watchlist prices every 60s when on watchlist tab and visible ─
  useEffect(() => {
    if (mode !== 'watchlist' || watchlistTickers.length === 0) return;
    const tick = () => { if (!document.hidden) fetchAllWatchlistPrices(watchlistTickers); };
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, watchlistTickers]);

  // ── Load market context + chat history on mount ───────────────────────────
  useEffect(() => {
    const CACHE_KEY = 'silas_mkt_ctx';
    const CACHE_TTL = 60_000;

    const load = async () => {
      // Use sessionStorage cache to avoid re-fetching market context on tab switches
      let nearOk = false, liveOk = false;
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          const { ts, near, live, polygon } = JSON.parse(cached);
          if (Date.now() - ts < CACHE_TTL) {
            if (near)    { setNearTermData(near); nearOk = true; }
            if (live)    { setLiveData(live); liveOk = true; }
            if (polygon) setPolygonCtx(polygon);
            setContextStatus(nearOk && liveOk ? 'ready' : nearOk || liveOk ? 'partial' : 'failed');
          }
        } catch { /* stale/corrupt cache, refetch */ }
      }

      const [nearRes, liveRes, polygonRes, historyRes, wRes] = await Promise.allSettled([
        fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'nearTerm' }) }),
        fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'liveUpdate' }) }),
        fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'polygonContext' }) }),
        fetch('/api/silas/messages'),
        fetch('/api/silas/watchlist'),
      ]);

      let near = null, live = null, polygon = null;
      nearOk = false; liveOk = false;
      if (nearRes.status === 'fulfilled' && nearRes.value.ok) {
        const d = await nearRes.value.json();
        if (d.success) { setNearTermData(d.data); near = d.data; nearOk = true; }
      }
      if (liveRes.status === 'fulfilled' && liveRes.value.ok) {
        const d = await liveRes.value.json();
        if (d.success) { setLiveData(d.data); live = d.data; liveOk = true; }
      }
      if (polygonRes.status === 'fulfilled' && polygonRes.value.ok) {
        const d = await polygonRes.value.json();
        if (d.success) { setPolygonCtx(d.data); polygon = d.data; }
      }
      if (historyRes.status === 'fulfilled' && historyRes.value.ok) {
        const d = await historyRes.value.json();
        if (d.messages?.length) setMessages(d.messages);
      }
      if (wRes.status === 'fulfilled' && wRes.value.ok) {
        const wd = await wRes.value.json();
        if (wd.tickers?.length) {
          setWatchlistTickers(wd.tickers);
          wd.tickers.forEach((t: string) => fetchWatchlistPrice(t));
        }
      }
      setContextStatus(nearOk && liveOk ? 'ready' : nearOk || liveOk ? 'partial' : 'failed');
      if (near || live || polygon) {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), near, live, polygon }));
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scroll chat to bottom ──────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // ── Send chat message (streaming) ─────────────────────────────────────────
  const sendChat = async (text: string) => {
    if (!text.trim() || chatLoading) return;
    const userMsg: Message = { role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);
    setMessages(prev => [...prev, { role: 'assistant', text: '' }]);

    try {
      const historyForAPI = [...messages, userMsg].map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        text: m.text,
      }));
      const res = await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'advisorChat', history: historyForAPI, nearTermContext: nearTermData, liveContext: liveData, polygonCtx, sessionCtx }),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', text: fullText };
          return updated;
        });
      }

      // Persist sequentially to avoid race with clear-history
      await fetch('/api/silas/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: text }) });
      await fetch('/api/silas/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'assistant', content: fullText }) });
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', text: 'Error getting response. Please try again.' };
        return updated;
      });
    } finally {
      setChatLoading(false);
    }
  };

  // ── Analyze portfolio ──────────────────────────────────────────────────────
  const analyzePortfolio = () => {
    const valid = portfolioRows.filter(r => r.asset.trim() && r.amount.trim());
    if (!valid.length) return;
    const holdings = valid.map(r => `${r.asset}: $${Number(r.amount).toLocaleString()} in ${r.accountType}`).join(', ');
    setSessionCtx(prev => ({ ...prev, portfolio: holdings }));
    setMode('chat');
    sendChat(`Analyze my portfolio — ${holdings}. Give me macro alignment, concentration risks, tax placement efficiency, and your top improvement suggestions.`);
  };

  // ── Stress test thesis ─────────────────────────────────────────────────────
  const stressTestThesis = () => {
    if (!thesis.trim()) return;
    const t = thesis.trim();
    setSessionCtx(prev => ({ ...prev, thesis: t.slice(0, 150) }));
    setMode('chat');
    sendChat(`Stress test this thesis against today's market: "${t}". What kills it, what confirms it, and what's the probability-weighted verdict?`);
  };

  // ── Compare assets ─────────────────────────────────────────────────────────
  const compareAssets = () => {
    const valid = compareItems.map(s => s.trim()).filter(Boolean);
    if (valid.length < 2) return;
    setMode('chat');
    sendChat(`Compare ${valid.join(' vs ')} right now. Which do you own in this macro regime and why?`);
  };

  // ── Generate Best Stocks ───────────────────────────────────────────────────
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tickers = ((data.data?.assets || []) as any[]).slice(0, 5)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((a: any) => `${a.ticker}(${a.suggestedWeight}%)`).join(', ');
        if (tickers) setSessionCtx(prev => ({ ...prev, bestTickers: tickers }));
      } else {
        setGenError(data.error || 'Generation failed');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setGenError(e.message || 'Error generating best assets');
    } finally {
      setGenLoading(false);
    }
  };

  // ── Generate Optimal Portfolio ─────────────────────────────────────────────
  const generateBestStrategy = async () => {
    setStrategyLoading(true); setStrategyError(null); setBestStrategyResult(null);
    try {
      const res = await fetch('/api/market', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bestStrategy', riskProfile: strategyRiskProfile, timeHorizon: strategyHorizon, nearTermContext: nearTermData, liveContext: liveData, sessionCtx }),
      });
      const data = await res.json();
      if (data.success) {
        setBestStrategyResult(data.data);
        const tickers = ((data.data?.allocations || []) as StrategyAllocation[]).slice(0, 5)
          .map(a => `${a.ticker}(${a.weight}%)`).join(', ');
        if (tickers) setSessionCtx(prev => ({ ...prev, bestTickers: tickers }));
      } else {
        setStrategyError(data.error || 'Generation failed');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setStrategyError(e.message || 'Error generating portfolio');
    } finally {
      setStrategyLoading(false);
    }
  };

  // Suppress unused warning — buildAdvisorContext used by other tabs via context
  void buildAdvisorContext;

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
              <h1 className="text-lg font-bold text-zinc-900 leading-tight">Silas</h1>
              <p className="text-xs text-zinc-500">Expert Wealth Advisor</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {messages.length > 0 && (
              <button
                onClick={async () => {
                  setMessages([]);
                  await fetch('/api/silas/messages', { method: 'DELETE' });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-zinc-200 text-zinc-500 hover:text-red-500 hover:border-red-200 transition-colors"
                title="Clear conversation history"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            )}
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
      {((labSnapshot && !dismissedLab) || (plannerSnapshot && !dismissedPlanner)) && (
        <div className="flex-shrink-0 flex items-start gap-3 px-6 py-2.5 bg-orange-50 border-b border-orange-100">
          <div className="w-4 h-4 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Activity className="w-2.5 h-2.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-orange-800 mb-0.5">Cross-tab context loaded — AI has full awareness of your other sessions</p>
            <div className="flex flex-wrap gap-3">
              {labSnapshot && !dismissedLab && (
                <span className="inline-flex items-center gap-1 text-xs text-orange-700 font-mono bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-lg whitespace-nowrap">
                  📊 Lab: {labSnapshot.allocations.split(', ').slice(0, 3).join(', ')}{labSnapshot.allocations.split(', ').length > 3 ? '…' : ''} · CAGR {labSnapshot.cagr} · Score {labSnapshot.score ?? '—'}/100
                  <button onClick={() => setDismissedLab(true)} className="ml-0.5 text-orange-400 hover:text-orange-700 transition-colors leading-none">✕</button>
                </span>
              )}
              {plannerSnapshot && !dismissedPlanner && (
                <span className="inline-flex items-center gap-1 text-xs text-orange-700 font-mono bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-lg whitespace-nowrap">
                  🗺 Plan: {plannerSnapshot.goal} goal · {plannerSnapshot.timeline} · {plannerSnapshot.riskProfile} · Fed {plannerSnapshot.marginalFederal}
                  <button onClick={() => setDismissedPlanner(true)} className="ml-0.5 text-orange-400 hover:text-orange-700 transition-colors leading-none">✕</button>
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
                      : 'Ask me anything — I have expert investment knowledge'}
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

              {messages.filter(msg => msg.text).map((msg, i) => (
                <div key={i} className={clsx('flex items-start gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shrink-0 mt-0.5">
                      <Brain className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className={clsx(
                    'rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-[85%]',
                    msg.role === 'user'
                      ? 'bg-zinc-900 text-white rounded-tr-sm'
                      : 'bg-zinc-50 text-zinc-800 border border-zinc-200 rounded-tl-sm'
                  )}>
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown
                        components={{
                          p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul:     ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                          ol:     ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                          li:     ({ children }) => <li className="text-sm">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
                          h3:     ({ children }) => <h3 className="font-bold text-zinc-900 mt-3 mb-1">{children}</h3>,
                          h4:     ({ children }) => <h4 className="font-semibold text-zinc-800 mt-2 mb-1">{children}</h4>,
                          code:   ({ children }) => <code className="font-mono text-xs bg-zinc-200 px-1 py-0.5 rounded">{children}</code>,
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    ) : msg.text}
                  </div>
                </div>
              ))}

              {chatLoading && !messages[messages.length - 1]?.text && (
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
          <div className="flex flex-col flex-1 min-h-0">
            <PortfolioBuilderPanel rows={portfolioRows} setRows={setPortfolioRows} onAnalyze={analyzePortfolio} loading={chatLoading} />
            <div className="flex-1 flex items-center justify-center px-6 py-8 text-center">
              <div>
                <MessageSquare className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                <p className="text-sm text-zinc-400 font-medium">Analysis streams into Intelligence Chat</p>
                <p className="text-xs text-zinc-400 mt-1">Add your holdings above, then click Analyze in Chat</p>
              </div>
            </div>
          </div>
        ) : mode === 'thesis' ? (
          <div className="flex flex-col flex-1 min-h-0">
            <ThesisPanel thesis={thesis} setThesis={setThesis} onStressTest={stressTestThesis} loading={chatLoading} />
            <div className="flex-1 flex items-center justify-center px-6 py-8 text-center">
              <div>
                <MessageSquare className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                <p className="text-sm text-zinc-400 font-medium">Stress test streams into Intelligence Chat</p>
                <p className="text-xs text-zinc-400 mt-1">Enter your thesis above, then click Stress Test in Chat</p>
              </div>
            </div>
          </div>
        ) : mode === 'compare' ? (
          <div className="flex flex-col flex-1 min-h-0">
            <ComparePanel items={compareItems} setItems={setCompareItems} onCompare={compareAssets} loading={chatLoading} />
            <div className="flex-1 flex items-center justify-center px-6 py-8 text-center">
              <div>
                <MessageSquare className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                <p className="text-sm text-zinc-400 font-medium">Comparison streams into Intelligence Chat</p>
                <p className="text-xs text-zinc-400 mt-1">Enter two assets above, then click Compare in Chat</p>
              </div>
            </div>
          </div>
        ) : mode === 'best-assets' ? (
          <BestAssetsPanel
            riskProfile={riskProfile}
            setRiskProfile={setRiskProfile}
            timeHorizon={timeHorizon}
            setTimeHorizon={setTimeHorizon}
            onGenerate={generateBestAssets}
            loading={genLoading}
            error={genError}
            result={bestAssetsResult}
            contextStatus={contextStatus}
          />
        ) : mode === 'best-strategy' ? (
          <BestStrategyPanel
            riskProfile={strategyRiskProfile}
            setRiskProfile={setStrategyRiskProfile}
            timeHorizon={strategyHorizon}
            setTimeHorizon={setStrategyHorizon}
            onGenerate={generateBestStrategy}
            loading={strategyLoading}
            error={strategyError}
            result={bestStrategyResult}
            contextStatus={contextStatus}
          />
        ) : mode === 'macro-calendar' ? (
          <MacroCalendarPanel onAskSilas={(prompt) => { setMode('chat'); sendChat(prompt); }} />
        ) : (
          <WatchlistPanel
            tickers={watchlistTickers}
            prices={watchlistPrices}
            input={watchlistInput}
            setInput={setWatchlistInput}
            adding={watchlistAdding}
            addError={watchlistError}
            onClearError={() => setWatchlistError(null)}
            onAdd={addToWatchlist}
            onRemove={removeFromWatchlist}
            onRefresh={fetchWatchlistPrice}
            onAskSilas={(prompt) => { setMode('chat'); sendChat(prompt); }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Portfolio Builder Panel ──────────────────────────────────────────────────

interface TickerPrice { price: number | null; changePct: number | null; loading: boolean }

function PortfolioBuilderPanel({
  rows, setRows, onAnalyze, loading,
}: {
  rows: PortfolioRow[];
  setRows: React.Dispatch<React.SetStateAction<PortfolioRow[]>>;
  onAnalyze: () => void;
  loading: boolean;
}) {
  const [prices, setPrices] = React.useState<Record<string, TickerPrice>>({});

  const addRow = () => setRows(r => [...r, { id: Date.now().toString(), asset: '', amount: '', accountType: 'Taxable Brokerage' }]);
  const removeRow = (id: string) => setRows(r => r.filter(row => row.id !== id));
  const updateRow = (id: string, field: keyof PortfolioRow, value: string) =>
    setRows(r => r.map(row => row.id === id ? { ...row, [field]: value } : row));

  const lookupTicker = React.useCallback(async (ticker: string) => {
    if (!ticker || ticker.length < 1) return;
    setPrices(prev => ({ ...prev, [ticker]: { price: null, changePct: null, loading: true } }));
    try {
      const res = await fetch('/api/market', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'polygonTicker', ticker }),
      });
      const data = await res.json();
      if (data.success) {
        setPrices(prev => ({ ...prev, [ticker]: { price: data.data.price, changePct: data.data.changePct, loading: false } }));
      } else {
        setPrices(prev => ({ ...prev, [ticker]: { price: null, changePct: null, loading: false } }));
      }
    } catch {
      setPrices(prev => ({ ...prev, [ticker]: { price: null, changePct: null, loading: false } }));
    }
  }, []);

  const totalValue = rows.reduce((s, r) => {
    return s + (parseFloat(r.amount.replace(/,/g, '')) || 0);
  }, 0);

  return (
    <div className="flex-shrink-0 border-b border-zinc-200 px-6 py-4 bg-zinc-50">
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <PieChart className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-bold text-zinc-900">Portfolio Analysis</span>
            {totalValue > 0 && (
              <span className="text-xs text-zinc-500 font-medium">Total: ${totalValue.toLocaleString()}</span>
            )}
          </div>
          <button onClick={addRow} className="flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add Asset
          </button>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">Enter your holdings and get a macro alignment score, concentration risks, tax placement efficiency, and specific improvement suggestions.</p>
      </div>

      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
        {rows.map(row => {
          const p = prices[row.asset.trim()];
          return (
            <div key={row.id} className="flex items-center gap-2">
              <div className="w-36 flex flex-col gap-0.5">
                <input
                  value={row.asset}
                  onChange={e => updateRow(row.id, 'asset', e.target.value.toUpperCase())}
                  onBlur={e => { if (e.target.value.trim()) lookupTicker(e.target.value.trim()); }}
                  placeholder="TICKER"
                  className="bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-orange-400 uppercase font-mono w-full"
                />
                {row.asset.trim() && p && !p.loading && p.price !== null && (
                  <span className={clsx('text-[10px] font-mono px-1', p.changePct != null && p.changePct >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                    ${p.price.toFixed(2)} {p.changePct != null ? `(${p.changePct >= 0 ? '+' : ''}${p.changePct.toFixed(2)}%)` : ''}
                  </span>
                )}
                {row.asset.trim() && p?.loading && (
                  <span className="text-[10px] text-zinc-400 px-1">Looking up…</span>
                )}
              </div>
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
          );
        })}
      </div>

      <button
        onClick={onAnalyze}
        disabled={loading || rows.every(r => !r.asset.trim())}
        className="mt-3 w-full bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 text-white disabled:text-zinc-400 text-xs font-bold py-2 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
        {loading ? 'Analyzing...' : 'Analyze in Chat'}
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
      <div className="mb-2">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-bold text-zinc-900">Stress Test</span>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">Describe an investment thesis and Silas will stress-test it against current macro conditions — what kills it, what confirms it, and a probability-weighted verdict.</p>
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
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
        {loading ? 'Testing...' : 'Stress Test in Chat'}
      </button>
    </div>
  );
}

// ─── Compare Panel ────────────────────────────────────────────────────────────

function ComparePanel({ items, setItems, onCompare, loading }: {
  items: string[];
  setItems: React.Dispatch<React.SetStateAction<string[]>>;
  onCompare: () => void;
  loading: boolean;
}) {
  const updateItem = (i: number, val: string) =>
    setItems(prev => prev.map((v, idx) => idx === i ? val.toUpperCase() : v));
  const addItem = () => setItems(prev => [...prev, '']);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const validCount = items.filter(s => s.trim()).length;

  return (
    <div className="flex-shrink-0 border-b border-zinc-200 px-6 py-4 bg-zinc-50">
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-bold text-zinc-900">Compare Assets</span>
          </div>
          {items.length < 5 && (
            <button onClick={addItem} className="flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Asset
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">Compare 2–5 assets side-by-side. Silas gives you the risk-adjusted winner for the current regime with a clear buy/hold/avoid on each.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {items.map((val, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-xs font-bold text-zinc-400">vs</span>}
            <div className="flex items-center gap-1">
              <input
                value={val}
                onChange={e => updateItem(i, e.target.value)}
                placeholder={`Asset ${String.fromCharCode(65 + i)}`}
                className="w-28 bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 uppercase font-mono focus:outline-none focus:border-orange-400"
              />
              {items.length > 2 && (
                <button onClick={() => removeItem(i)} className="p-1 text-zinc-300 hover:text-red-500 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
      <button
        onClick={onCompare}
        disabled={loading || validCount < 2}
        className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 text-white disabled:text-zinc-400 text-xs font-bold py-2 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
        {loading ? 'Comparing...' : 'Compare in Chat'}
      </button>
    </div>
  );
}

// ─── Shared controls (risk + horizon selectors) ───────────────────────────────

function RiskHorizonControls({ riskProfile, setRiskProfile, timeHorizon, setTimeHorizon }: {
  riskProfile: RiskProfile; setRiskProfile: (r: RiskProfile) => void;
  timeHorizon: TimeHorizon; setTimeHorizon: (h: TimeHorizon) => void;
}) {
  return (
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
    </div>
  );
}

// ─── Best Stocks Panel ────────────────────────────────────────────────────────

function BestAssetsPanel({ riskProfile, setRiskProfile, timeHorizon, setTimeHorizon, onGenerate, loading, error, result, contextStatus }: {
  riskProfile: RiskProfile; setRiskProfile: (r: RiskProfile) => void;
  timeHorizon: TimeHorizon; setTimeHorizon: (h: TimeHorizon) => void;
  onGenerate: () => void; loading: boolean; error: string | null;
  result: BestAssetsResult | null; contextStatus: ContextStatus;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-6 mb-6">
        <div className="flex flex-wrap items-end gap-6">
          <RiskHorizonControls riskProfile={riskProfile} setRiskProfile={setRiskProfile} timeHorizon={timeHorizon} setTimeHorizon={setTimeHorizon} />
          <button
            onClick={onGenerate}
            disabled={loading}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 text-white disabled:text-zinc-400 px-6 py-2.5 rounded-xl text-sm font-bold transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
            {loading ? 'Generating...' : 'Generate Best Stocks'}
          </button>
        </div>
        {contextStatus === 'loading' && (
          <p className="text-xs text-amber-600 mt-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            Market context still loading — results will improve once ready.
          </p>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">{error}</div>}

      {result ? (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Top Stocks Right Now</h2>
            <p className="text-sm text-zinc-500 mt-0.5">{result.generatedAt} · Regime: <span className="font-medium text-zinc-700">{result.regime}</span></p>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-4 text-sm text-orange-900 leading-relaxed">
            <span className="font-bold">Macro Alignment: </span>{result.macroAlignment}
          </div>
          <div className="space-y-3">
            {(result.assets || []).map((asset, i) => (
              <div key={i} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-start gap-4 hover:border-orange-200 transition-colors">
                <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 font-bold text-sm flex items-center justify-center shrink-0">{asset.rank}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-base font-bold text-zinc-900 font-mono">{asset.ticker}</span>
                    <span className="text-sm text-zinc-600">{asset.name}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{asset.category}</span>
                    <span className={clsx('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
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
          <p className="text-[10px] text-zinc-400 leading-relaxed">For informational and educational purposes only. Not financial advice. © 2026 Alpha Horizon</p>
        </div>
      ) : !loading && !error && (
        <div className="text-center py-16 text-zinc-400">
          <div className="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center mx-auto mb-4">
            <Star className="w-8 h-8 text-orange-300" />
          </div>
          <p className="font-semibold text-zinc-500 mb-2 text-base">Best Stocks</p>
          <p className="text-sm max-w-sm mx-auto leading-relaxed">
            Select your risk profile and time horizon, then generate forward-looking top stock picks grounded in today&apos;s market conditions.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Optimal Portfolio Panel ──────────────────────────────────────────────────

function BestStrategyPanel({ riskProfile, setRiskProfile, timeHorizon, setTimeHorizon, onGenerate, loading, error, result, contextStatus }: {
  riskProfile: RiskProfile; setRiskProfile: (r: RiskProfile) => void;
  timeHorizon: TimeHorizon; setTimeHorizon: (h: TimeHorizon) => void;
  onGenerate: () => void; loading: boolean; error: string | null;
  result: BestStrategyResult | null; contextStatus: ContextStatus;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-6 mb-6">
        <div className="flex flex-wrap items-end gap-6">
          <RiskHorizonControls riskProfile={riskProfile} setRiskProfile={setRiskProfile} timeHorizon={timeHorizon} setTimeHorizon={setTimeHorizon} />
          <button
            onClick={onGenerate}
            disabled={loading}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 text-white disabled:text-zinc-400 px-6 py-2.5 rounded-xl text-sm font-bold transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
            {loading ? 'Building...' : 'Build Optimal Portfolio'}
          </button>
          {loading && (
            <p className="text-xs text-zinc-400 mt-2 animate-pulse">
              Analyzing market regime · Optimizing allocations · Calculating risk metrics…
            </p>
          )}
        </div>
        {contextStatus === 'loading' && (
          <p className="text-xs text-amber-600 mt-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            Market context still loading — results will improve once ready.
          </p>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">{error}</div>}

      {result ? (
        <div className="space-y-5">
          {/* Header */}
          <div>
            <h2 className="text-xl font-bold text-zinc-900">{result.strategyName}</h2>
            <div className="flex flex-wrap gap-3 mt-2">
              {[
                { label: 'Expected Return', value: result.expectedReturn },
                { label: 'Volatility', value: result.expectedVolatility },
                { label: 'Sharpe', value: result.sharpeEstimate },
              ].map(({ label, value }) => (
                <div key={label} className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-center">
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">{label}</p>
                  <p className="text-sm font-bold text-zinc-900 mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Macro alignment */}
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-4 text-sm text-orange-900 leading-relaxed">
            <span className="font-bold">Macro Alignment: </span>{result.macroAlignment}
          </div>

          {/* Allocations */}
          <div>
            <h3 className="text-sm font-bold text-zinc-700 uppercase tracking-wider mb-3">Allocations</h3>
            <div className="space-y-2">
              {(result.allocations || []).map((alloc, i) => (
                <div key={i} className="bg-white border border-zinc-200 rounded-xl p-4 flex items-start gap-4 hover:border-orange-200 transition-colors">
                  <div className="w-12 text-center shrink-0">
                    <p className="text-lg font-bold text-orange-600">{alloc.weight}%</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-bold text-zinc-900 font-mono">{alloc.ticker}</span>
                      <span className="text-sm text-zinc-600">{alloc.name}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{alloc.category}</span>
                    </div>
                    <p className="text-xs text-zinc-600 leading-relaxed">{alloc.rationale}</p>
                    <p className="text-[10px] text-zinc-400 mt-1">ER: {alloc.expenseRatio}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rebalancing */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-900 leading-relaxed">
            <span className="font-bold">Rebalancing: </span>{result.rebalancingGuidance}
          </div>

          {/* Risk warnings */}
          {result.riskWarnings?.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-zinc-700 uppercase tracking-wider mb-2">Risk Warnings</h3>
              <ul className="space-y-1.5">
                {result.riskWarnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-zinc-600">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-zinc-400 leading-relaxed">For informational and educational purposes only. Not financial advice. © 2026 Alpha Horizon</p>
        </div>
      ) : !loading && !error && (
        <div className="text-center py-16 text-zinc-400">
          <div className="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="w-8 h-8 text-orange-300" />
          </div>
          <p className="font-semibold text-zinc-500 mb-2 text-base">Optimal Portfolio</p>
          <p className="text-sm max-w-sm mx-auto leading-relaxed">
            Sharpe-optimized ETF portfolio built for your risk profile and time horizon. Uses MPT principles calibrated to today&apos;s macro regime.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Macro Calendar Data ──────────────────────────────────────────────────────

const MACRO_EVENTS = [
  // ── FOMC (Fed publishes full schedule a year in advance) ──────────────────
  { date: '2026-06-17', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2026-07-29', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2026-09-16', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2026-10-28', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2026-12-09', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2027-01-27', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2027-03-17', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2027-05-05', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2027-06-16', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2027-07-28', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2027-09-15', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2027-10-27', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  { date: '2027-12-08', label: 'FOMC Meeting', detail: 'Fed rate decision + press conference', type: 'fomc' as const },
  // ── CPI (BLS publishes release schedule annually) ─────────────────────────
  { date: '2026-06-11', label: 'CPI Release', detail: 'May Consumer Price Index', type: 'cpi' as const },
  { date: '2026-07-15', label: 'CPI Release', detail: 'June Consumer Price Index', type: 'cpi' as const },
  { date: '2026-08-13', label: 'CPI Release', detail: 'July Consumer Price Index', type: 'cpi' as const },
  { date: '2026-09-11', label: 'CPI Release', detail: 'August Consumer Price Index', type: 'cpi' as const },
  { date: '2026-10-15', label: 'CPI Release', detail: 'September Consumer Price Index', type: 'cpi' as const },
  { date: '2026-11-13', label: 'CPI Release', detail: 'October Consumer Price Index', type: 'cpi' as const },
  { date: '2026-12-11', label: 'CPI Release', detail: 'November Consumer Price Index', type: 'cpi' as const },
  { date: '2027-01-15', label: 'CPI Release', detail: 'December Consumer Price Index', type: 'cpi' as const },
  { date: '2027-02-12', label: 'CPI Release', detail: 'January Consumer Price Index', type: 'cpi' as const },
  { date: '2027-03-12', label: 'CPI Release', detail: 'February Consumer Price Index', type: 'cpi' as const },
  { date: '2027-04-14', label: 'CPI Release', detail: 'March Consumer Price Index', type: 'cpi' as const },
  { date: '2027-05-14', label: 'CPI Release', detail: 'April Consumer Price Index', type: 'cpi' as const },
  // ── NFP (BLS — first Friday of the month) ─────────────────────────────────
  { date: '2026-07-02', label: 'Jobs Report (NFP)', detail: 'June Non-Farm Payrolls', type: 'nfp' as const },
  { date: '2026-08-07', label: 'Jobs Report (NFP)', detail: 'July Non-Farm Payrolls', type: 'nfp' as const },
  { date: '2026-09-04', label: 'Jobs Report (NFP)', detail: 'August Non-Farm Payrolls', type: 'nfp' as const },
  { date: '2026-10-02', label: 'Jobs Report (NFP)', detail: 'September Non-Farm Payrolls', type: 'nfp' as const },
  { date: '2026-11-06', label: 'Jobs Report (NFP)', detail: 'October Non-Farm Payrolls', type: 'nfp' as const },
  { date: '2026-12-04', label: 'Jobs Report (NFP)', detail: 'November Non-Farm Payrolls', type: 'nfp' as const },
  { date: '2027-01-08', label: 'Jobs Report (NFP)', detail: 'December Non-Farm Payrolls', type: 'nfp' as const },
  { date: '2027-02-05', label: 'Jobs Report (NFP)', detail: 'January Non-Farm Payrolls', type: 'nfp' as const },
  { date: '2027-03-05', label: 'Jobs Report (NFP)', detail: 'February Non-Farm Payrolls', type: 'nfp' as const },
  { date: '2027-04-02', label: 'Jobs Report (NFP)', detail: 'March Non-Farm Payrolls', type: 'nfp' as const },
  { date: '2027-05-07', label: 'Jobs Report (NFP)', detail: 'April Non-Farm Payrolls', type: 'nfp' as const },
  // ── Earnings (Q2 2026 + Q3 2026) ──────────────────────────────────────────
  { date: '2026-07-14', label: 'JPMorgan (JPM) Earnings', detail: 'Q2 2026 results', type: 'earnings' as const },
  { date: '2026-07-17', label: 'Netflix (NFLX) Earnings', detail: 'Q2 2026 results', type: 'earnings' as const },
  { date: '2026-07-22', label: 'Tesla (TSLA) Earnings', detail: 'Q2 2026 results', type: 'earnings' as const },
  { date: '2026-07-28', label: 'Alphabet (GOOGL) Earnings', detail: 'Q2 2026 results', type: 'earnings' as const },
  { date: '2026-07-29', label: 'Meta (META) Earnings', detail: 'Q2 2026 results', type: 'earnings' as const },
  { date: '2026-07-30', label: 'Apple (AAPL) Earnings', detail: 'Q2 2026 results', type: 'earnings' as const },
  { date: '2026-07-30', label: 'Microsoft (MSFT) Earnings', detail: 'Q2 2026 results', type: 'earnings' as const },
  { date: '2026-08-01', label: 'Amazon (AMZN) Earnings', detail: 'Q2 2026 results', type: 'earnings' as const },
  { date: '2026-08-20', label: 'NVIDIA (NVDA) Earnings', detail: 'Q2 2026 results', type: 'earnings' as const },
  { date: '2026-10-13', label: 'JPMorgan (JPM) Earnings', detail: 'Q3 2026 results', type: 'earnings' as const },
  { date: '2026-10-16', label: 'Netflix (NFLX) Earnings', detail: 'Q3 2026 results', type: 'earnings' as const },
  { date: '2026-10-21', label: 'Tesla (TSLA) Earnings', detail: 'Q3 2026 results', type: 'earnings' as const },
  { date: '2026-10-27', label: 'Alphabet (GOOGL) Earnings', detail: 'Q3 2026 results', type: 'earnings' as const },
  { date: '2026-10-28', label: 'Meta (META) Earnings', detail: 'Q3 2026 results', type: 'earnings' as const },
  { date: '2026-10-29', label: 'Apple (AAPL) Earnings', detail: 'Q3 2026 results', type: 'earnings' as const },
  { date: '2026-10-29', label: 'Microsoft (MSFT) Earnings', detail: 'Q3 2026 results', type: 'earnings' as const },
  { date: '2026-10-30', label: 'Amazon (AMZN) Earnings', detail: 'Q3 2026 results', type: 'earnings' as const },
  { date: '2026-11-19', label: 'NVIDIA (NVDA) Earnings', detail: 'Q3 2026 results', type: 'earnings' as const },
].sort((a, b) => a.date.localeCompare(b.date));

type EventType = 'fomc' | 'cpi' | 'nfp' | 'earnings';

const EVENT_COLORS: Record<EventType, { bg: string; text: string; dot: string; badge: string }> = {
  fomc:     { bg: 'bg-orange-50',  text: 'text-orange-800',  dot: 'bg-orange-500',  badge: 'bg-orange-100 text-orange-700' },
  cpi:      { bg: 'bg-blue-50',    text: 'text-blue-800',    dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-700' },
  nfp:      { bg: 'bg-emerald-50', text: 'text-emerald-800', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  earnings: { bg: 'bg-purple-50',  text: 'text-purple-800',  dot: 'bg-purple-500',  badge: 'bg-purple-100 text-purple-700' },
};

const EVENT_LABELS: Record<EventType, string> = {
  fomc: 'FOMC', cpi: 'CPI', nfp: 'NFP', earnings: 'Earnings',
};

// ─── Macro Calendar Panel ─────────────────────────────────────────────────────

function MacroCalendarPanel({ onAskSilas }: { onAskSilas: (prompt: string) => void }) {
  const today = new Date();

  const upcomingEvents = MACRO_EVENTS.filter(e => new Date(e.date) >= today).slice(0, 24);

  const daysUntil = (dateStr: string) =>
    Math.ceil((new Date(dateStr).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });

  const buildPrompt = (event: typeof MACRO_EVENTS[0]) => {
    const days = daysUntil(event.date);
    if (event.type === 'fomc') return `FOMC meeting is in ${days} days (${formatDate(event.date)}). What is the market expecting and how should I position my portfolio ahead of this?`;
    if (event.type === 'cpi') return `CPI release is in ${days} days (${formatDate(event.date)}). What are expectations, how does it shape the Fed's path, and what trades make sense around this print?`;
    if (event.type === 'nfp') return `Jobs report (NFP) is in ${days} days (${formatDate(event.date)}). What number does the market need to see, and what's the playbook if it surprises in either direction?`;
    return `${event.label} reports in ${days} days (${formatDate(event.date)}). What's the setup, what are expectations, and how would you trade around this?`;
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
      {/* Legend + schedule note */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {(['fomc', 'cpi', 'nfp', 'earnings'] as EventType[]).map(type => (
            <span key={type} className={clsx('text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full', EVENT_COLORS[type].badge)}>
              {EVENT_LABELS[type]}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-zinc-400 font-medium">Scheduled through May 2027 · Dates approximate for earnings</span>
      </div>

      <div className="space-y-2">
        {upcomingEvents.map((event, i) => {
          const days = daysUntil(event.date);
          const colors = EVENT_COLORS[event.type];
          const isNext = i === 0;
          return (
            <div key={i} className={clsx(
              'flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all',
              isNext ? `${colors.bg} border-current border-opacity-20` : 'bg-white border-zinc-200 hover:border-zinc-300'
            )}>
              <div className="w-14 text-center flex-shrink-0">
                <p className="text-[10px] font-semibold text-zinc-500 uppercase">{new Date(event.date).toLocaleDateString('en-US', { month: 'short' })}</p>
                <p className="text-xl font-bold text-zinc-900 leading-none">{new Date(event.date).getDate()}</p>
              </div>
              <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', colors.dot)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={clsx('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full', colors.badge)}>
                    {EVENT_LABELS[event.type]}
                  </span>
                  <p className="text-sm font-semibold text-zinc-900">{event.label}</p>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">{event.detail}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={clsx(
                  'text-xs font-bold px-2.5 py-1 rounded-full',
                  days <= 7 ? 'bg-red-100 text-red-700' : days <= 21 ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-500'
                )}>
                  {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}
                </span>
                <button
                  onClick={() => onAskSilas(buildPrompt(event))}
                  className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap"
                >
                  Ask Silas
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Watchlist Panel ──────────────────────────────────────────────────────────

function WatchlistPanel({
  tickers, prices, input, setInput, adding, addError, onClearError, onAdd, onRemove, onRefresh, onAskSilas,
}: {
  tickers: string[];
  prices: Record<string, { price: number | null; changePct: number | null; loading: boolean }>;
  input: string;
  setInput: (s: string) => void;
  adding: boolean;
  addError: string | null;
  onClearError: () => void;
  onAdd: () => void;
  onRemove: (t: string) => void;
  onRefresh: (t: string) => void;
  onAskSilas: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-shrink-0 border-b border-zinc-200 px-6 py-4 bg-zinc-50">
        <div className="flex items-center gap-2 mb-1">
          <Eye className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-bold text-zinc-900">Watchlist</span>
          <span className="text-[10px] text-zinc-400 font-medium ml-1">Auto-refreshes every 60s</span>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed mb-3">Track your favorite tickers with live prices and daily change. Hit &quot;Ask Silas&quot; on any position to get a real-time read.</p>
        <div className="flex items-center gap-3">
          <div className={clsx('flex items-center gap-2 flex-1 bg-white border rounded-xl px-4 py-2.5 focus-within:ring-2 focus-within:ring-orange-100 transition-all',
            addError ? 'border-red-300 focus-within:border-red-400' : 'border-zinc-200 focus-within:border-orange-400'
          )}>
            <Eye className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            <input
              value={input}
              onChange={e => { setInput(e.target.value.toUpperCase()); onClearError(); }}
              onKeyDown={e => { if (e.key === 'Enter') onAdd(); }}
              placeholder="Add ticker (e.g. AAPL, NVDA, SPY)"
              className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none uppercase font-mono"
              disabled={adding || tickers.length >= 20}
            />
          </div>
          <button
            onClick={onAdd}
            disabled={adding || !input.trim() || tickers.length >= 20}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 text-white disabled:text-zinc-400 text-xs font-bold px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </div>
        {addError && <p className="text-xs text-red-500 mt-1.5">{addError}</p>}
        {!addError && tickers.length >= 20 && <p className="text-xs text-zinc-400 mt-2">Maximum 20 tickers reached.</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
        {tickers.length === 0 ? (
          <div className="text-center py-16">
            <Eye className="w-12 h-12 text-zinc-200 mx-auto mb-4" />
            <p className="text-sm font-semibold text-zinc-500 mb-2">Your watchlist is empty</p>
            <p className="text-xs text-zinc-400 max-w-xs mx-auto leading-relaxed">Add tickers above to track live prices and get Silas&apos;s take on any position.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tickers.map(ticker => {
              const p = prices[ticker];
              const isUp = p?.changePct != null && p.changePct >= 0;
              return (
                <div key={ticker} className="flex items-center gap-4 bg-white border border-zinc-200 hover:border-zinc-300 rounded-xl px-4 py-3.5 transition-all group">
                  <div className="w-20 flex-shrink-0">
                    <p className="text-sm font-bold text-zinc-900 font-mono">{ticker}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    {p?.loading ? (
                      <p className="text-xs text-zinc-400">Loading…</p>
                    ) : p?.price != null ? (
                      <div className="flex items-center gap-3">
                        <span className="text-base font-bold text-zinc-900">${p.price.toFixed(2)}</span>
                        {p.changePct != null && (
                          <span className={clsx(
                            'flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
                            isUp ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          )}>
                            {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {isUp ? '+' : ''}{p.changePct.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-400">Price unavailable</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onRefresh(ticker)}
                      className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors"
                      title="Refresh price"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onAskSilas(`Give me your read on ${ticker} right now — current price action, what I should know, and whether you'd be adding, holding, or trimming at these levels.`)}
                      className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap"
                    >
                      Ask Silas
                    </button>
                    <button
                      onClick={() => onRemove(ticker)}
                      className="p-1.5 text-zinc-300 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
