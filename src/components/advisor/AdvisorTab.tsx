'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Brain, MessageSquare, PieChart, Zap, GitCompare, Star,
  Plus, Trash2, Send, Loader2, Activity, AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';
import type { NearTermIntelligence, LiveBriefing } from '@/types/market';
import { useAppContext } from '@/lib/appContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdvisorMode = 'chat' | 'portfolio' | 'thesis' | 'compare' | 'best-assets';
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
  { id: 'chat',        label: 'Intelligence Chat',  Icon: MessageSquare },
  { id: 'portfolio',   label: 'Portfolio Analyzer', Icon: PieChart },
  { id: 'thesis',      label: 'Stress Tester',      Icon: Zap },
  { id: 'compare',     label: 'Asset Comparison',   Icon: GitCompare },
  { id: 'best-assets', label: 'Best Stocks Now',    Icon: Star },
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
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');

  // Generation (best-assets)
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('Moderate');
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('1 year');
  const [bestAssetsResult, setBestAssetsResult] = useState<BestAssetsResult | null>(null);
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

  // ── Load market context + chat history on mount ───────────────────────────
  useEffect(() => {
    const load = async () => {
      const [nearRes, liveRes, polygonRes, historyRes] = await Promise.allSettled([
        fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'nearTerm' }) }),
        fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'liveUpdate' }) }),
        fetch('/api/market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'polygonContext' }) }),
        fetch('/api/silas/messages'),
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
      if (polygonRes.status === 'fulfilled' && polygonRes.value.ok) {
        const d = await polygonRes.value.json();
        if (d.success) setPolygonCtx(d.data);
      }
      if (historyRes.status === 'fulfilled' && historyRes.value.ok) {
        const d = await historyRes.value.json();
        if (d.messages?.length) setMessages(d.messages);
      }
      setContextStatus(nearOk && liveOk ? 'ready' : nearOk || liveOk ? 'partial' : 'failed');
    };
    load();
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

    // Placeholder assistant message that gets filled incrementally
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

      // Persist to DB (fire-and-forget)
      fetch('/api/silas/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: text }) });
      fetch('/api/silas/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'assistant', content: fullText }) });
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
    if (!compareA.trim() || !compareB.trim()) return;
    setMode('chat');
    sendChat(`Compare ${compareA.trim()} vs ${compareB.trim()} right now. Which do you own in this macro regime and why?`);
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
            {/* Clear history */}
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

              {messages.filter(msg => msg.text).map((msg, i) => (
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

              {chatLoading && messages[messages.length - 1]?.text === '' && (
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
            <ComparePanel compareA={compareA} compareB={compareB} setCompareA={setCompareA} setCompareB={setCompareB} onCompare={compareAssets} loading={chatLoading} />
            <div className="flex-1 flex items-center justify-center px-6 py-8 text-center">
              <div>
                <MessageSquare className="w-10 h-10 text-zinc-200 mx-auto mb-3" />
                <p className="text-sm text-zinc-400 font-medium">Comparison streams into Intelligence Chat</p>
                <p className="text-xs text-zinc-400 mt-1">Enter two assets above, then click Compare in Chat</p>
              </div>
            </div>
          </div>
        ) : (
          /* ── Generation modes ─────────────────────────────────────────── */
          <GenerationPanel
            riskProfile={riskProfile}
            setRiskProfile={setRiskProfile}
            timeHorizon={timeHorizon}
            setTimeHorizon={setTimeHorizon}
            onGenerate={generateBestAssets}
            loading={genLoading}
            error={genError}
            bestAssetsResult={bestAssetsResult}
            contextStatus={contextStatus}
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
    const ticker = r.asset.trim();
    const p = prices[ticker];
    if (p?.price && !r.amount.trim()) return s; // price known but no shares/amount entered
    return s + (parseFloat(r.amount.replace(/,/g, '')) || 0);
  }, 0);

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
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
        {loading ? 'Testing...' : 'Stress Test in Chat'}
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
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
          {loading ? 'Comparing...' : 'Compare in Chat'}
        </button>
      </div>
    </div>
  );
}

// ─── Generation Panel (Best Assets Now) ──────────────────────────────────────

function GenerationPanel({
  riskProfile, setRiskProfile, timeHorizon, setTimeHorizon,
  onGenerate, loading, error, bestAssetsResult, contextStatus,
}: {
  riskProfile: RiskProfile; setRiskProfile: (r: RiskProfile) => void;
  timeHorizon: TimeHorizon; setTimeHorizon: (h: TimeHorizon) => void;
  onGenerate: () => void; loading: boolean; error: string | null;
  bestAssetsResult: BestAssetsResult | null;
  contextStatus: ContextStatus;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
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

          <button
            onClick={onGenerate}
            disabled={loading}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-200 text-white disabled:text-zinc-400 px-6 py-2.5 rounded-xl text-sm font-bold transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
            {loading ? 'Generating...' : 'Generate Best Stocks'}
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

      {bestAssetsResult && <BestAssetsDisplay result={bestAssetsResult} />}

      {!loading && !error && !bestAssetsResult && (
        <div className="text-center py-16 text-zinc-400">
          <div className="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center mx-auto mb-4">
            <Star className="w-8 h-8 text-orange-300" />
          </div>
          <p className="font-semibold text-zinc-500 mb-2 text-base">Best Stocks Now</p>
          <p className="text-sm max-w-sm mx-auto leading-relaxed">
            Select your risk profile and time horizon, then generate forward-looking top asset picks grounded in today&apos;s market conditions.
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

