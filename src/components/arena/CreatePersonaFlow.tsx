'use client';

import React, { useState } from 'react';
import { X, ChevronRight, Sparkles, SlidersHorizontal, Layers, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';

interface TickerWeight { ticker: string; weight: number; }

interface CreatePersonaFlowProps {
  onClose: () => void;
  onCreated: (personaId: string) => void;
}

const PRESET_TEMPLATES = [
  { name: 'The Boglehead', tickers: [{ ticker: 'VTI', weight: 0.8 }, { ticker: 'BND', weight: 0.2 }], risk: 4 },
  { name: 'Dividend Hunter', tickers: [{ ticker: 'SCHD', weight: 0.5 }, { ticker: 'VYM', weight: 0.3 }, { ticker: 'JEPI', weight: 0.2 }], risk: 4 },
  { name: 'Aggressive Growth', tickers: [{ ticker: 'QQQ', weight: 0.5 }, { ticker: 'VTI', weight: 0.3 }, { ticker: 'VXUS', weight: 0.2 }], risk: 8 },
  { name: '60/40 Classic', tickers: [{ ticker: 'VTI', weight: 0.5 }, { ticker: 'VXUS', weight: 0.1 }, { ticker: 'BND', weight: 0.4 }], risk: 5 },
  { name: 'S&P Core', tickers: [{ ticker: 'SPY', weight: 1.0 }], risk: 6 },
];

const BENCHMARKS = ['SPY', 'VT', 'QQQ', 'BND', 'SGOV', '60/40'];
const BENCHMARK_LABELS: Record<string, string> = {
  'SPY': 'SPY — S&P 500',
  'VT': 'VT — Total World',
  'QQQ': 'QQQ — Nasdaq 100',
  'BND': 'BND — Total Bond',
  'SGOV': 'SGOV — T-Bills',
  '60/40': '60/40 VOO+BND',
};

type Step = 'method' | 'configure' | 'review';
type Method = 'manual' | 'ai_optimized' | 'template';

export default function CreatePersonaFlow({ onClose, onCreated }: CreatePersonaFlowProps) {
  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<Method>('manual');

  // Shared
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [benchmark, setBenchmark] = useState('SPY');
  const [riskScore, setRiskScore] = useState(5);

  // Manual
  const [manualTickers, setManualTickers] = useState<TickerWeight[]>([{ ticker: '', weight: 50 }, { ticker: '', weight: 50 }]);

  // AI Optimized
  const [horizon, setHorizon] = useState<'short' | 'medium' | 'long'>('medium');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAllocation, setAiAllocation] = useState<TickerWeight[] | null>(null);
  const [aiError, setAiError] = useState('');

  // Template
  const [selectedTemplate, setSelectedTemplate] = useState<typeof PRESET_TEMPLATES[0] | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const totalWeight = manualTickers.reduce((s, t) => s + (Number(t.weight) || 0), 0);
  const isWeightValid = Math.abs(totalWeight - 100) < 0.5;

  const activeTickers: TickerWeight[] =
    method === 'manual' ? manualTickers
    : method === 'template' ? (selectedTemplate?.tickers.map(t => ({ ticker: t.ticker, weight: t.weight * 100 })) || [])
    : (aiAllocation || []);

  const canProceedToReview = () => {
    if (!name.trim() || !balance || Number(balance) <= 0) return false;
    if (method === 'manual') return isWeightValid && manualTickers.every(t => t.ticker.trim());
    if (method === 'template') return selectedTemplate !== null;
    if (method === 'ai_optimized') return aiAllocation !== null && aiAllocation.length > 0;
    return false;
  };

  const handleAddTicker = () => setManualTickers(prev => [...prev, { ticker: '', weight: 0 }]);
  const handleRemoveTicker = (i: number) => setManualTickers(prev => prev.filter((_, idx) => idx !== i));
  const handleTickerChange = (i: number, field: 'ticker' | 'weight', val: string) => {
    setManualTickers(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: field === 'weight' ? Number(val) : val.toUpperCase() } : t));
  };

  const handleGenerateAI = async () => {
    if (!balance || Number(balance) <= 0) { setAiError('Please enter a starting balance first'); return; }
    setAiLoading(true);
    setAiError('');
    try {
      const res = await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generateArenaAllocation', riskScore, balance: Number(balance), horizon }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Generation failed');
      setAiAllocation(data.allocation.map((a: { ticker: string; weight: number }) => ({ ticker: a.ticker, weight: a.weight * 100 })));
      if (!name) setName(`${riskScore <= 3 ? 'Conservative' : riskScore <= 6 ? 'Balanced' : 'Aggressive'} ${horizon === 'short' ? 'Short-Term' : horizon === 'long' ? 'Long-Term' : 'Growth'} Portfolio`);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const tickersWeights = activeTickers.map(t => ({ ticker: t.ticker.trim().toUpperCase(), weight: t.weight / 100 }));
      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          risk_score: method === 'template' ? selectedTemplate!.risk : riskScore,
          starting_balance: Number(balance),
          allocation_method: method,
          tickers_weights: tickersWeights,
          benchmark_ticker: benchmark,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Creation failed');
      onCreated(data.persona.id);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Creation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const STEPS: Step[] = ['method', 'configure', 'review'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.1) 0%, transparent 100%)' }}>
          <div>
            <h2 className="text-white font-bold text-lg">Create New Persona</h2>
            <p className="text-slate-400 text-xs mt-0.5">
              {step === 'method' ? 'Choose an allocation method' : step === 'configure' ? 'Configure your portfolio' : 'Review and confirm'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="flex gap-0 px-6 pt-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === s ? 'bg-amber-500 text-black' :
                (STEPS.indexOf(step) > i) ? 'bg-amber-500/30 text-amber-300' :
                'bg-white/8 text-slate-500'
              }`}>{i + 1}</div>
              {i < 2 && <div className={`h-0.5 w-12 mx-1 rounded ${(STEPS.indexOf(step) > i) ? 'bg-amber-500/40' : 'bg-white/8'}`} />}
            </div>
          ))}
        </div>

        <div className="p-6 max-h-[60vh] overflow-y-auto">

          {/* STEP 1: Method */}
          {step === 'method' && (
            <div className="space-y-3">
              {[
                { id: 'manual' as Method, icon: SlidersHorizontal, label: 'Manual Allocation', desc: 'Pick your own tickers and weights' },
                { id: 'ai_optimized' as Method, icon: Sparkles, label: 'AI Optimized', desc: 'AI generates an allocation based on your risk and market conditions' },
                { id: 'template' as Method, icon: Layers, label: 'Use a Template', desc: 'Start from a proven strategy preset' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setMethod(opt.id)}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                    method === opt.id
                      ? 'border-amber-500/40 bg-amber-500/10'
                      : 'border-white/8 bg-white/4 hover:bg-white/8'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${method === opt.id ? 'bg-amber-500/20' : 'bg-white/8'}`}>
                    <opt.icon className={`w-5 h-5 ${method === opt.id ? 'text-amber-400' : 'text-slate-400'}`} />
                  </div>
                  <div>
                    <p className={`font-semibold text-sm ${method === opt.id ? 'text-amber-300' : 'text-white'}`}>{opt.label}</p>
                    <p className="text-slate-400 text-xs mt-0.5">{opt.desc}</p>
                  </div>
                  {method === opt.id && <div className="ml-auto w-2 h-2 rounded-full bg-amber-400" />}
                </button>
              ))}
            </div>
          )}

          {/* STEP 2: Configure */}
          {step === 'configure' && (
            <div className="space-y-5">
              {/* Name + Balance */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 block">Persona Name</label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Aggressive Alex"
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 block">Starting Balance ($)</label>
                  <input
                    type="number"
                    value={balance}
                    onChange={e => setBalance(e.target.value)}
                    placeholder="e.g. 100000"
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              {/* Benchmark */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 block">Benchmark</label>
                <div className="flex gap-2 flex-wrap">
                  {BENCHMARKS.map(b => (
                    <button
                      key={b}
                      onClick={() => setBenchmark(b)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        benchmark === b ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-white/6 border-white/10 text-slate-400 hover:text-white'
                      }`}
                    >{BENCHMARK_LABELS[b] || b}</button>
                  ))}
                </div>
              </div>

              {/* Risk Score (shown for manual and ai) */}
              {method !== 'template' && (
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 block">
                    Risk Tolerance Level: <span className="text-amber-400">{riskScore}/10</span>
                    <span className="text-slate-500 ml-2 normal-case font-normal">
                      {riskScore <= 3 ? '— Conservative' : riskScore <= 6 ? '— Moderate' : '— Aggressive'}
                    </span>
                  </label>
                  <input type="range" min="1" max="10" value={riskScore} onChange={e => setRiskScore(Number(e.target.value))}
                    className="w-full accent-amber-500" />
                </div>
              )}

              {/* MANUAL: Ticker builder */}
              {method === 'manual' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Holdings</label>
                    <span className={`text-xs font-mono ${isWeightValid ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {totalWeight.toFixed(1)}% / 100%
                    </span>
                  </div>
                  <div className="space-y-2">
                    {manualTickers.map((t, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          value={t.ticker}
                          onChange={e => handleTickerChange(i, 'ticker', e.target.value)}
                          placeholder="TICKER"
                          className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500/50 font-mono uppercase"
                        />
                        <input
                          type="number"
                          value={t.weight}
                          onChange={e => handleTickerChange(i, 'weight', e.target.value)}
                          placeholder="%"
                          className="w-20 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                        />
                        <span className="flex items-center text-slate-500 text-sm">%</span>
                        {manualTickers.length > 1 && (
                          <button onClick={() => handleRemoveTicker(i)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/6 hover:bg-red-500/20 transition-colors mt-0.5">
                            <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-400" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button onClick={handleAddTicker} className="mt-2 flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors">
                    <Plus className="w-3.5 h-3.5" />Add ticker
                  </button>
                </div>
              )}

              {/* AI OPTIMIZED */}
              {method === 'ai_optimized' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 block">Time Horizon</label>
                    <div className="flex gap-2">
                      {(['short', 'medium', 'long'] as const).map(h => (
                        <button key={h} onClick={() => setHorizon(h)}
                          className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
                            horizon === h ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-white/6 border-white/10 text-slate-400 hover:text-white'
                          }`}
                        >{h === 'short' ? '1–3 Years' : h === 'medium' ? '3–10 Years' : '10+ Years'}</button>
                      ))}
                    </div>
                  </div>

                  {aiError && (
                    <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                      <p className="text-red-300 text-xs">{aiError}</p>
                    </div>
                  )}

                  {aiAllocation ? (
                    <div>
                      <p className="text-xs font-semibold text-emerald-400 mb-2">✓ AI Generated Allocation</p>
                      <div className="space-y-1.5">
                        {aiAllocation.map((a, i) => (
                          <div key={i} className="flex items-center justify-between py-1.5 px-3 bg-white/4 rounded-lg">
                            <span className="text-white font-mono text-sm font-semibold">{a.ticker}</span>
                            <span className="text-amber-400 text-sm font-bold">{a.weight.toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                      <button onClick={handleGenerateAI} className="mt-2 text-xs text-slate-400 hover:text-amber-400 transition-colors">↻ Regenerate</button>
                    </div>
                  ) : (
                    <button
                      onClick={handleGenerateAI}
                      disabled={aiLoading || !balance}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-xl text-amber-300 font-semibold text-sm transition-all disabled:opacity-50"
                    >
                      {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {aiLoading ? 'Generating AI Allocation...' : 'Generate AI Allocation'}
                    </button>
                  )}
                </div>
              )}

              {/* TEMPLATE */}
              {method === 'template' && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block">Choose Template</label>
                  {PRESET_TEMPLATES.map(t => (
                    <button
                      key={t.name}
                      onClick={() => { setSelectedTemplate(t); if (!name) setName(t.name); setRiskScore(t.risk); }}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all ${
                        selectedTemplate?.name === t.name ? 'border-amber-500/40 bg-amber-500/10' : 'border-white/8 bg-white/4 hover:bg-white/8'
                      }`}
                    >
                      <div>
                        <p className={`text-sm font-semibold ${selectedTemplate?.name === t.name ? 'text-amber-300' : 'text-white'}`}>{t.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{t.tickers.map(tk => `${tk.ticker} ${(tk.weight * 100).toFixed(0)}%`).join(' · ')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Risk {t.risk}/10</span>
                        {selectedTemplate?.name === t.name && <div className="w-2 h-2 rounded-full bg-amber-400" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Review */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-500/8 border border-amber-500/20 rounded-xl">
                <h3 className="text-amber-300 font-bold text-base mb-3">{name}</h3>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="text-center">
                    <p className="text-slate-400 text-xs">Starting Balance</p>
                    <p className="text-white font-bold text-sm">${Number(balance).toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-slate-400 text-xs">Benchmark</p>
                    <p className="text-white font-bold text-sm">{benchmark}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-slate-400 text-xs">Risk Score</p>
                    <p className="text-white font-bold text-sm">{method === 'template' ? selectedTemplate?.risk : riskScore}/10</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {activeTickers.map((t, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-slate-300 font-mono text-sm">{t.ticker}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-1.5 rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-amber-500" style={{ width: `${t.weight}%` }} />
                        </div>
                        <span className="text-amber-400 font-bold text-sm w-12 text-right">{t.weight.toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-white/4 border border-white/8 rounded-xl">
                <p className="text-slate-400 text-xs mb-1">ⓘ Inception prices will be locked at current market prices when you confirm</p>
                <p className="text-slate-500 text-xs">Performance is calculated from this exact moment forward</p>
              </div>

              {submitError && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-red-300 text-xs">{submitError}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/8 bg-white/2">
          <button
            onClick={() => {
              if (step === 'method') onClose();
              else if (step === 'configure') setStep('method');
              else setStep('configure');
            }}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            {step === 'method' ? 'Cancel' : '← Back'}
          </button>

          {step !== 'review' ? (
            <button
              onClick={() => {
                if (step === 'method') setStep('configure');
                else if (step === 'configure' && canProceedToReview()) setStep('review');
              }}
              disabled={step === 'configure' && !canProceedToReview()}
              className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm rounded-xl transition-all disabled:opacity-40"
            >
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Creating...</> : <>Launch Persona ✓</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
