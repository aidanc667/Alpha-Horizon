'use client';

import React, { useState, useMemo } from 'react';
import {
  AreaChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ScatterChart, Scatter
} from 'recharts';
import {
  TrendingUp, Plus, Trash2, RefreshCw, AlertTriangle,
  Calendar, PieChart, BarChart3, Activity, Download, Info, FlaskConical
} from 'lucide-react';
import clsx from 'clsx';
import { runSimulation } from '@/lib/simulationEngine';
import type { SimulationResult, TickerAllocation } from '@/types';
import { computeAnnualConsistency, computeCorrelationMatrix, computeMVO } from '@/lib/statsUtils';
import type { AnnualConsistencyResult, CorrelationMatrix, MVOResult } from '@/lib/statsUtils';
import { Brain } from 'lucide-react';
import { useAppContext } from '@/lib/appContext';

const fmt$ = (v: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
const fmtPct = (v: number) => v.toFixed(2)+'%';
const today = new Date().toISOString().split('T')[0];

const DEFAULT_ALLOCS: TickerAllocation[] = [{ ticker: 'SPY', percentage: 100 }];

export default function LabTab() {
  const { setLabSnapshot, navigateToAdvisor } = useAppContext();

  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [result, setResult]       = useState<SimulationResult | null>(null);
  const [commentary, setCommentary] = useState<string | null>(null);
  const [genAI, setGenAI]         = useState(false);

  // Form
  const [startDate, setStartDate]   = useState('2021-01-01');
  const [endDate, setEndDate]       = useState('2025-12-31');
  const [initInvest, setInitInvest] = useState(10000);
  const [monthlyC, setMonthlyC]     = useState(500);
  const [allocs, setAllocs]         = useState<TickerAllocation[]>(DEFAULT_ALLOCS);
  const [rebalance, setRebalance]   = useState(true);

  const totalAlloc = useMemo(() => allocs.reduce((s, a) => s + a.percentage, 0), [allocs]);

  const addTicker    = () => setAllocs(a => [...a, { ticker: '', percentage: 0 }]);
  const removeTicker = (i: number) => setAllocs(a => a.filter((_, idx) => idx !== i));
  const updateTicker = (i: number, field: keyof TickerAllocation, val: string | number) => {
    setAllocs(a => { const n = [...a]; if (field === 'ticker') n[i].ticker = (val as string).toUpperCase(); else n[i].percentage = Number(val); return n; });
  };

  const runSim = async () => {
    if (totalAlloc !== 100) { setError('Total allocation must equal 100%'); return; }
    if (allocs.some(a => !a.ticker)) { setError('All tickers must be filled'); return; }
    setLoading(true); setError(null); setCommentary(null);
    try {
      const sim = await runSimulation({ startDate, endDate, initialInvestment: initInvest, monthlyContribution: monthlyC, allocations: allocs, annualRebalance: rebalance });
      setResult(sim);
      generateCommentary(sim);

      // ── Publish to cross-tab context ──────────────────────────────────────
      const allocStr = allocs.map(a => `${a.ticker} ${a.percentage}%`).join(', ');
      const m = sim.metrics;
      // Compute AHPS score inline for context snapshot
      const _consistency = computeAnnualConsistency(sim.dailyData);
      const _sortinoS  = Math.min(100, Math.max(0, m.sortinoRatio * 40));
      const _alphaS    = Math.min(100, Math.max(0, 50 + m.alpha * 3.5));
      const _calmarS   = Math.min(100, Math.max(0, 25 + m.calmarRatio * 50));
      const _bPct      = _consistency?.beatPct  ?? 50;
      const _sharpeSd  = _consistency?.sharpeSd ?? 1.0;
      const _consS     = Math.min(100, (_bPct * 0.5) + Math.max(0, 50 - _sharpeSd * 12));
      const _irS       = Math.min(100, Math.max(0, 50 + m.informationRatio * 20));
      const _score     = Math.round(_sortinoS * 0.30 + _alphaS * 0.25 + _calmarS * 0.20 + _consS * 0.15 + _irS * 0.10);
      setLabSnapshot({
        allocations: allocStr,
        period:      `${startDate} → ${endDate}`,
        cagr:        `${m.cagr >= 0 ? '+' : ''}${m.cagr.toFixed(2)}%`,
        sharpe:      m.sortinoRatio.toFixed(2),
        maxDD:       `-${m.maxDrawdown.toFixed(2)}%`,
        alpha:       `${m.alpha >= 0 ? '+' : ''}${m.alpha.toFixed(2)}%`,
        score:       _score,
        updatedAt:   new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });

      // ── Persist run to Neon (best-effort, non-blocking) ───────────────────
      fetch('/api/lab-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        `${allocStr} · ${startDate.slice(0,4)}–${endDate.slice(0,4)}`,
          allocations: allocs,
          config:      { startDate, endDate, initialInvestment: initInvest, monthlyContribution: monthlyC, annualRebalance: rebalance },
          metrics:     { cagr: m.cagr, sharpe: m.sortinoRatio, maxDD: m.maxDrawdown, alpha: m.alpha, score: _score },
        }),
      }).catch(() => {}); // silent — user may not be logged in yet
    } catch (e: any) {
      setError(e.message || 'Simulation error');
    } finally {
      setLoading(false);
    }
  };

  const generateCommentary = async (sim: SimulationResult) => {
    setGenAI(true);
    try {
      // Compute AHPS score inline (useMemo hasn't run yet at this point)
      const consistency = computeAnnualConsistency(sim.dailyData);
      const m = sim.metrics;
      const sortinoScore    = Math.min(100, Math.max(0, m.sortinoRatio * 40));
      const alphaScore      = Math.min(100, Math.max(0, 50 + m.alpha * 3.5));
      const calmarScore     = Math.min(100, Math.max(0, 25 + m.calmarRatio * 50));
      const beatPctLocal    = consistency?.beatPct  ?? 50;
      const sharpeSdLocal   = consistency?.sharpeSd ?? 1.0;
      const consistencyScore = Math.min(100, (beatPctLocal * 0.5) + Math.max(0, 50 - sharpeSdLocal * 12));
      const irScore         = Math.min(100, Math.max(0, 50 + m.informationRatio * 20));
      const computedScore   = Math.round(sortinoScore * 0.30 + alphaScore * 0.25 + calmarScore * 0.20 + consistencyScore * 0.15 + irScore * 0.10);

      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'portfolioCommentary',
          simResult: sim, startDate, endDate,
          initialInvestment: initInvest, monthlyContribution: monthlyC, allocations: allocs,
          ahpsScore: computedScore,
          ahpsDimensions: {
            sortinoScore: Math.round(sortinoScore),
            alphaScore: Math.round(alphaScore),
            calmarScore: Math.round(calmarScore),
            consistencyScore: Math.round(consistencyScore),
            irScore: Math.round(irScore),
          },
          beatPct: Math.round(beatPctLocal),
        }),
      });
      if (!res.ok) throw new Error('Commentary API error');
      const { commentary: c } = await res.json();
      setCommentary(c || '');
    } catch (e: any) {
      setCommentary(`Error generating commentary: ${e.message}`);
    } finally {
      setGenAI(false);
    }
  };

  const benchmarkName = startDate >= '2010-09-07' ? 'VOO/BND' : 'VFINX/VBMFX';

  const annualConsistency = useMemo((): AnnualConsistencyResult | null => {
    if (!result || result.dailyData.length < 20) return null;
    return computeAnnualConsistency(result.dailyData);
  }, [result]);

  const correlationMatrix = useMemo((): CorrelationMatrix | null => {
    if (!result?.perTickerDailyReturns) return null;
    const tickers = Object.keys(result.perTickerDailyReturns);
    if (tickers.length < 2) return null;
    return computeCorrelationMatrix(result.perTickerDailyReturns);
  }, [result]);

  const mvoResult = useMemo((): MVOResult | null => {
    if (!result?.perTickerDailyReturns) return null;
    const tickers = Object.keys(result.perTickerDailyReturns);
    if (tickers.length < 2) return null;
    return computeMVO(result.perTickerDailyReturns, allocs);
  }, [result, allocs]);

  // ── Alpha Horizon Performance Score (AHPS) ─────────────────────────────────
  // 5 orthogonal dimensions — each 0–100, no double-counting.
  const score = useMemo(() => {
    if (!result) return null;
    const m = result.metrics;

    // 1. Downside-Adjusted Return (30%) — Sortino rewards return per unit of BAD vol only
    const sortinoScore = Math.min(100, Math.max(0, m.sortinoRatio * 40));

    // 2. Excess Return Generation (25%) — alpha vs benchmark with diminishing returns
    //    alpha is stored in %; 50 pts at alpha=0, 100 pts at ~+14.3%, 0 pts at ~-14.3%
    const alphaScore = Math.min(100, Math.max(0, 50 + m.alpha * 3.5));

    // 3. Drawdown Efficiency (20%) — Calmar ratio: return per unit of max pain
    //    Baseline of 0.5 (typical equity) maps to 50 pts; 1.5 maps to 100 pts
    const calmarScore = Math.min(100, Math.max(0, 25 + m.calmarRatio * 50));

    // 4. Consistency (15%) — was it reliable year-to-year, or one-hit wonder?
    //    Beat benchmark rate + Sharpe stability (low σ = consistent)
    const beatPct  = annualConsistency?.beatPct  ?? 50;
    const sharpeSd = annualConsistency?.sharpeSd ?? 1.0;
    const consistencyScore = Math.min(100, (beatPct * 0.5) + Math.max(0, 50 - sharpeSd * 12));

    // 5. Active Return Efficiency (10%) — Information Ratio: alpha per unit of tracking risk
    //    IR 0 = 50 pts; IR 2.0 = 90 pts; IR -2.0 = 10 pts
    const irScore = Math.min(100, Math.max(0, 50 + m.informationRatio * 20));

    const total = sortinoScore * 0.30 + alphaScore * 0.25 + calmarScore * 0.20
                + consistencyScore * 0.15 + irScore * 0.10;
    return Math.round(total);
  }, [result, annualConsistency]);

  const scoreColor = score !== null
    ? score >= 70 ? 'text-emerald-600'
    : score >= 55 ? 'text-blue-600'
    : score >= 40 ? 'text-amber-600'
    : 'text-red-400'
    : '';
  const scoreLabel = score !== null
    ? score >= 70 ? 'Institutional Grade'
    : score >= 55 ? 'Solid Strategy'
    : score >= 40 ? 'Average'
    : 'Weak — Reconsider'
    : '';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-600/10 flex items-center justify-center">
            <FlaskConical className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Portfolio Growth Lab</p>
            <p className="text-xs text-gray-600">Advanced Backtesting Engine</p>
          </div>
        </div>
        <button onClick={runSim} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all active:scale-95">
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
          {loading ? 'Running...' : 'Run Simulation'}
        </button>
      </div>

      {/* Body: sidebar + results */}
      <div className="flex-1 overflow-hidden flex">
        {/* Controls sidebar */}
        <aside className="w-72 flex-shrink-0 border-r border-gray-100 overflow-y-auto p-4 space-y-4">
          {/* Timeframe */}
          <section className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
              <Calendar className="w-3 h-3" /> Timeframe & Capital
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Start', val: startDate, set: setStartDate },
                { label: 'End',   val: endDate,   set: setEndDate },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 block mb-1">{f.label} Date</label>
                  <input type="date" value={f.val} min="1986-01-01" max={today}
                    onChange={e => f.set(e.target.value)}
                    className="w-full bg-slate-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500/60 transition-colors" />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {[
                { label: 'Initial Investment', val: initInvest, set: setInitInvest },
                { label: 'Monthly Contribution', val: monthlyC, set: setMonthlyC },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 block mb-1">{f.label}</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 text-xs">$</span>
                    <input type="number" value={f.val} onChange={e => f.set(Number(e.target.value))}
                      className="w-full bg-slate-50 border border-gray-200 rounded-lg pl-6 pr-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500/60 transition-colors" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Allocation */}
          <section className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                <PieChart className="w-3 h-3" /> Asset Allocation
              </p>
              <button onClick={addTicker} className="p-1 hover:bg-blue-600/10 text-blue-600 rounded-lg transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {allocs.map((a, i) => (
                <div key={i} className="flex gap-1.5 items-end">
                  <div className="flex-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 block mb-1">Ticker</label>
                    <input type="text" placeholder="SPY" value={a.ticker}
                      onChange={e => updateTicker(i, 'ticker', e.target.value)}
                      className="w-full bg-slate-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-700 focus:outline-none focus:border-blue-500/60 uppercase transition-colors" />
                  </div>
                  <div className="w-16">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 block mb-1">Weight %</label>
                    <input type="number" value={a.percentage}
                      onChange={e => updateTicker(i, 'percentage', e.target.value)}
                      className="w-full bg-slate-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500/60 transition-colors" />
                  </div>
                  <button onClick={() => removeTicker(i)} className="p-1.5 text-gray-300 hover:text-red-400 transition-colors mb-0.5">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total</p>
                <p className={clsx('text-base font-bold font-mono', totalAlloc === 100 ? 'text-emerald-600' : 'text-red-400')}>{totalAlloc}%</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Annual Rebalance</span>
                <button onClick={() => setRebalance(r => !r)}
                  className={clsx('w-9 h-5 rounded-full relative transition-colors', rebalance ? 'bg-blue-600' : 'bg-gray-200')}>
                  <div className={clsx('absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow', rebalance ? 'left-4' : 'left-0.5')} />
                </button>
              </div>
            </div>
          </section>

          {error && (
            <div className="flex gap-2 p-3 bg-red-900/20 border border-red-800/40 rounded-xl text-red-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="text-xs">{error}</p>
            </div>
          )}
        </aside>

        {/* Results area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!result && !loading && (
            <div className="flex flex-col items-center justify-center h-full min-h-[500px] gap-6 text-center">
              <div className="w-16 h-16 bg-blue-600/10 rounded-xl flex items-center justify-center">
                <BarChart3 className="w-8 h-8 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Ready to Analyze</h3>
                <p className="text-sm text-gray-600 max-w-xs">Configure a custom portfolio and run the simulation to generate advanced performance metrics and detailed commentary.</p>
              </div>
              <div className="grid grid-cols-3 gap-6">
                {[
                  { label: 'Yahoo Finance', sub: 'Real historical data' },
                  { label: 'Risk Metrics',  sub: 'Sharpe, Drawdown, β' },
                  { label: `${benchmarkName}`,         sub: '60/40 benchmark' },
                ].map(s => (
                  <div key={s.label} className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{s.label}</p>
                    <p className="text-xs text-gray-700">{s.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center min-h-[500px] gap-4">
              <div className="relative">
                <div className="w-14 h-14 border-2 border-blue-600/20 border-t-blue-600 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                </div>
              </div>
              <p className="text-sm font-bold text-gray-900">Fetching Data & Calculating...</p>
              <p className="text-xs text-gray-600">Running Monte Carlo-style simulations.</p>
            </div>
          )}

          {result && !loading && (
            <div className="space-y-5 animate-fade-in">

              {/* Send to PIA CTA */}
              <div className="flex items-center justify-between p-4 bg-orange-50 border border-orange-200 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-orange-500 flex items-center justify-center flex-shrink-0">
                    <Brain className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-orange-900">Send to Silas</p>
                    <p className="text-xs text-orange-700">Your backtest results will be pre-loaded into the AI advisor as context</p>
                  </div>
                </div>
                <button
                  onClick={navigateToAdvisor}
                  className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold transition-all active:scale-95 flex-shrink-0 ml-4"
                >
                  <Brain className="w-3.5 h-3.5" />
                  Send to PIA
                </button>
              </div>

              {/* Metric cards */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Ending Value', value: fmt$(result.metrics.endingValue), color: 'text-gray-900' },
                  { label: 'Total Contributed', value: fmt$(result.metrics.totalContributed), color: 'text-gray-700' },
                  { label: 'Net Profit', value: fmt$(result.metrics.netProfit), color: result.metrics.netProfit >= 0 ? 'text-emerald-600' : 'text-red-400' },
                  { label: 'Total Return', value: fmtPct(result.metrics.totalReturnPct), color: result.metrics.totalReturnPct >= 0 ? 'text-emerald-600' : 'text-red-400' },
                ].map(s => (
                  <div key={s.label} className="bg-white border border-gray-100 rounded-xl shadow-md p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{s.label}</p>
                    <p className={`text-xl font-black font-mono ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Growth chart */}
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Portfolio Growth</p>
                    <p className="text-xs text-gray-600">vs {benchmarkName} 60/40 Benchmark</p>
                  </div>
                  <div className="flex gap-4">
                    {[
                      { label: 'Portfolio', color: '#10b981' },
                      { label: benchmarkName, color: '#3b82f6' },
                      { label: 'Contributed', color: '#f59e0b' },
                    ].map(l => (
                      <div key={l.label} className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
                        <span className="text-xs text-gray-600">{l.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={result.dailyData}>
                    <defs>
                      <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.06} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#f0f0f0" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="date" hide axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false}
                      tick={{ fontSize: 10, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                      formatter={(v: unknown, name: unknown) => {
                        const labels: Record<string, string> = { portfolioValue: 'Portfolio Value', benchmarkValue: 'Benchmark', totalContributed: 'Total Contributed' };
                        return [fmt$(v as number), labels[name as string] ?? name];
                      }}
                      labelFormatter={l => new Date(l as string).toLocaleDateString()} />
                    <Area type="monotone" dataKey="portfolioValue" name="portfolioValue" stroke="#10b981" strokeWidth={2.5} fill="url(#pg)" fillOpacity={0.06} />
                    <Line type="monotone" dataKey="benchmarkValue" name="benchmarkValue" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="totalContributed" name="totalContributed" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Risk metrics + Score */}
              <div className="grid grid-cols-2 gap-5">
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                    <Activity className="w-3 h-3" /> Risk and Return Metrics
                  </p>
                  {[
                    { label: 'CAGR (Time-Weighted)',      value: fmtPct(result.metrics.cagr) },
                    { label: 'Annualized Volatility',     value: fmtPct(result.metrics.volatility) },
                    { label: 'Sortino Ratio',             value: result.metrics.sortinoRatio.toFixed(2) },
                    { label: 'Beta vs Benchmark',         value: result.metrics.beta.toFixed(2) },
                    { label: 'Alpha vs Benchmark',        value: (result.metrics.alpha >= 0 ? '+' : '') + result.metrics.alpha.toFixed(2) + '%', color: result.metrics.alpha >= 0 ? 'text-emerald-600' : 'text-red-400' },
                    { label: 'Information Ratio',         value: result.metrics.informationRatio.toFixed(2), color: result.metrics.informationRatio >= 0 ? 'text-emerald-600' : 'text-red-400' },
                    { label: 'Max Drawdown',              value: '-' + fmtPct(result.metrics.maxDrawdown), color: 'text-red-400' },
                    { label: 'Max DD from Contributions', value: result.metrics.maxDrawdownFromContributions > 0 ? '-' + fmtPct(result.metrics.maxDrawdownFromContributions) : 'Never below', color: result.metrics.maxDrawdownFromContributions > 0 ? 'text-red-400' : 'text-emerald-600' },
                    { label: 'Calmar Ratio',                value: result.metrics.calmarRatio.toFixed(2), color: result.metrics.calmarRatio >= 0.5 ? 'text-emerald-600' : result.metrics.calmarRatio >= 0.3 ? 'text-amber-600' : 'text-red-400' },
                  ].map(r => (
                    <div key={r.label} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                      <span className="text-xs text-gray-600">{r.label}</span>
                      <span className={clsx('text-xs font-bold', r.color || 'text-gray-700')}>{r.value}</span>
                    </div>
                  ))}
                </div>

                {/* Score */}
                {score !== null && (
                  <div className="bg-white border border-gray-100 rounded-xl shadow-md p-5 flex flex-col items-center gap-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 self-start">Portfolio Score</p>
                    <div className={clsx('w-24 h-24 rounded-full border-4 flex items-center justify-center', score >= 75 ? 'border-emerald-600/30 bg-emerald-600/5' : score >= 50 ? 'border-blue-600/30 bg-blue-600/5' : 'border-amber-600/30 bg-amber-600/5')}>
                      <span className={clsx('text-3xl font-black font-mono', scoreColor)}>{score}</span>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-gray-900">{scoreLabel}</p>
                      <p className="text-xs text-gray-500 mt-1 text-center leading-relaxed">
                        AHPS — 5 dimensions: downside-adjusted return (30%), excess alpha (25%), drawdown efficiency (20%), annual consistency (15%), active return efficiency (10%).
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Year-end summary */}
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Year-End Summary</p>
                    <p className="text-xs text-gray-600">Historical performance breakdown</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    <span className="flex items-center gap-1"><span className="text-emerald-500 font-bold">↑</span> Beat Benchmark</span>
                    <span className="flex items-center gap-1"><span className="text-red-400 font-bold">↓</span> Trailed Benchmark</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50">
                        {['Year','End Value','Contributed','Annual TWR'].map(h => (
                          <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.yearEndSummary.map(row => {
                        const beatBench = row.annualReturn > row.benchmarkAnnualReturn;
                        return (
                          <tr key={row.year} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-3 text-sm font-bold font-mono text-gray-700">{row.year}</td>
                            <td className="px-5 py-3 text-sm font-mono text-gray-700">{fmt$(row.endValue)}</td>
                            <td className="px-5 py-3 text-sm font-mono text-gray-600">{fmt$(row.totalContributed)}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className={clsx('text-sm font-bold font-mono', row.annualReturn >= 0 ? 'text-emerald-600' : 'text-red-400')}>
                                  {row.annualReturn >= 0 ? '+' : ''}{fmtPct(row.annualReturn)}
                                </span>
                                <span
                                  className={clsx('text-xs font-bold', beatBench ? 'text-emerald-500' : 'text-red-400')}
                                  title={beatBench ? `Beat benchmark (${row.benchmarkAnnualReturn >= 0 ? '+' : ''}${fmtPct(row.benchmarkAnnualReturn)})` : `Trailed benchmark (${row.benchmarkAnnualReturn >= 0 ? '+' : ''}${fmtPct(row.benchmarkAnnualReturn)})`}
                                >
                                  {beatBench ? '↑' : '↓'}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Correlation Matrix — only shown for 2+ tickers */}
              {correlationMatrix && correlationMatrix.tickers.length >= 2 && (
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Correlation Matrix</p>
                    <p className="text-xs text-gray-500 mt-0.5">Pearson correlation of daily returns between holdings. Values near +1 move together; near −1 move opposite; near 0 are uncorrelated.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="w-16 p-2" />
                          {correlationMatrix.tickers.map(t => (
                            <th key={t} className="p-2 text-center font-mono font-bold text-gray-700 min-w-[64px]">{t}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {correlationMatrix.tickers.map((rowT, i) => (
                          <tr key={rowT}>
                            <td className="p-2 font-mono font-bold text-gray-700 text-right pr-3">{rowT}</td>
                            {correlationMatrix.tickers.map((colT, j) => {
                              const c = correlationMatrix.matrix[i][j];
                              const isDiag = i === j;
                              const bg = isDiag
                                ? '#1e40af'
                                : c >= 0.7  ? '#3b82f6'
                                : c >= 0.4  ? '#93c5fd'
                                : c >= 0.1  ? '#dbeafe'
                                : c >= -0.1 ? '#f9fafb'
                                : c >= -0.4 ? '#fee2e2'
                                : c >= -0.7 ? '#fca5a5'
                                : '#ef4444';
                              const textColor = isDiag || c >= 0.7 || c <= -0.7 ? 'text-white' : 'text-gray-700';
                              return (
                                <td key={colT} className="p-1">
                                  <div
                                    className={`w-16 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-xs ${textColor}`}
                                    style={{ background: bg }}
                                    title={`${rowT} vs ${colT}: ${c.toFixed(3)}`}
                                  >
                                    {isDiag ? '—' : c.toFixed(2)}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mr-1">Legend:</p>
                    {[
                      { color: '#3b82f6', label: 'High +corr' },
                      { color: '#93c5fd', label: 'Moderate +' },
                      { color: '#f9fafb', label: 'Neutral', border: true },
                      { color: '#fca5a5', label: 'Moderate −' },
                      { color: '#ef4444', label: 'High −corr' },
                    ].map(l => (
                      <div key={l.label} className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded" style={{ background: l.color, border: l.border ? '1px solid #e5e7eb' : undefined }} />
                        <span className="text-xs text-gray-500">{l.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Efficient Frontier (MVO) */}
              {mvoResult && (
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-bold text-gray-900">Efficient Frontier — Markowitz MVO</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        3,000 random weight combinations from your asset universe. The blue curve is the efficient frontier (Pareto-optimal portfolios).
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 text-right flex-shrink-0 ml-4">
                      {[
                        { color: 'bg-slate-300', label: 'Random portfolios' },
                        { color: 'bg-blue-500', label: 'Efficient frontier' },
                        { color: 'bg-amber-400', label: 'Max Sharpe' },
                        { color: 'bg-emerald-500', label: 'Min Variance' },
                        { color: 'bg-red-500', label: 'Your portfolio' },
                      ].map(l => (
                        <div key={l.label} className="flex items-center gap-1.5 justify-end">
                          <span className="text-xs text-gray-500">{l.label}</span>
                          <div className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={320}>
                    <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                      <CartesianGrid stroke="#f0f0f0" strokeDasharray="4 4" />
                      <XAxis
                        type="number" dataKey="volatility" name="Volatility"
                        label={{ value: 'Annualized Volatility (%)', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#9ca3af' }}
                        tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                        tickFormatter={(v: number) => v.toFixed(1)}
                      />
                      <YAxis
                        type="number" dataKey="expectedReturn" name="Return"
                        label={{ value: 'Expected Return (%)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11, fill: '#9ca3af' }}
                        tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                        tickFormatter={(v: number) => v.toFixed(1)}
                      />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={(value: any) => [`${Number(value ?? 0).toFixed(2)}%`] as any}
                      />
                      {/* Random portfolios (gray cloud) */}
                      <Scatter name="Random" data={mvoResult.all} fill="#cbd5e1" opacity={0.35} />
                      {/* Efficient frontier */}
                      <Scatter name="Frontier" data={mvoResult.frontier} fill="#3b82f6" opacity={0.7} />
                      {/* Max Sharpe */}
                      <Scatter name="Max Sharpe" data={[mvoResult.maxSharpe]} fill="#f59e0b" />
                      {/* Min Variance */}
                      <Scatter name="Min Variance" data={[mvoResult.minVariance]} fill="#10b981" />
                      {/* Current portfolio */}
                      <Scatter name="Your Portfolio" data={[mvoResult.current]} fill="#ef4444" />
                    </ScatterChart>
                  </ResponsiveContainer>

                  {/* Max Sharpe weights */}
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Max Sharpe Portfolio
                      </p>
                      <p className="text-xs text-gray-500">Return: <span className="font-bold text-gray-700">{mvoResult.maxSharpe.expectedReturn.toFixed(1)}%</span> · Vol: <span className="font-bold text-gray-700">{mvoResult.maxSharpe.volatility.toFixed(1)}%</span> · Sharpe: <span className="font-bold text-gray-700">{mvoResult.maxSharpe.sharpe.toFixed(2)}</span></p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(mvoResult.maxSharpe.weights).map(([t, w]) => (
                          <span key={t} className="text-xs font-mono bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 rounded-lg">{t}: {w}%</span>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Min Variance Portfolio
                      </p>
                      <p className="text-xs text-gray-500">Return: <span className="font-bold text-gray-700">{mvoResult.minVariance.expectedReturn.toFixed(1)}%</span> · Vol: <span className="font-bold text-gray-700">{mvoResult.minVariance.volatility.toFixed(1)}%</span> · Sharpe: <span className="font-bold text-gray-700">{mvoResult.minVariance.sharpe.toFixed(2)}</span></p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(mvoResult.minVariance.weights).map(([t, w]) => (
                          <span key={t} className="text-xs font-mono bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-lg">{t}: {w}%</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-gray-400 italic border-t border-gray-100 pt-3">
                    Efficient frontier is backward-looking — optimized on historical data from the backtest period. Past optimal weights do not predict future performance. Use as a reference point, not a prescription.
                  </p>
                </div>
              )}

              {/* Contribution Audit + Data Quality */}
              <div className="grid grid-cols-2 gap-5">
                {/* Contribution Audit */}
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                    <Download className="w-3.5 h-3.5 text-gray-600" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contribution Audit</p>
                  </div>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-left">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          {['Date','Type','Amount'].map(h => (
                            <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.audit.map((row, i) => (
                          <tr key={i} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-2.5 text-xs text-gray-700">{new Date(row.date).toLocaleDateString()}</td>
                            <td className="px-5 py-2.5">
                              <span className={clsx('text-xs font-mono px-2 py-0.5 rounded-full', row.type === 'Initial' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700')}>
                                {row.type.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-5 py-2.5 text-xs font-bold text-gray-900">{fmt$(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Data Quality */}
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                    <Info className="w-3 h-3" /> Data Quality
                  </p>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Source</p>
                    <p className="text-sm font-semibold text-gray-900">Yahoo Finance (Adjusted Close)</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Status</p>
                    <p className="text-sm font-semibold text-emerald-600 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" /> Live Connection
                    </p>
                  </div>
                  {result.warnings.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-red-500 mb-2">Warnings</p>
                      <div className="space-y-1">
                        {result.warnings.map((w, i) => (
                          <p key={i} className="text-xs text-red-500 flex items-start gap-1.5">• {w}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* AI Commentary */}
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <RefreshCw className={clsx('w-4 h-4 text-blue-600', genAI && 'animate-spin')} />
                    Portfolio Strategy AI Commentary
                  </p>
                  {genAI && <span className="text-xs text-blue-600 animate-pulse-soft uppercase">Analyzing...</span>}
                </div>
                {commentary ? (
                  <div className="space-y-3">
                    {commentary.includes('Error') ? (
                      <p className="text-xs text-red-300 p-3 bg-red-900/20 rounded-xl">{commentary}</p>
                    ) : (
                      commentary.split('\n\n').map((p, i) => <p key={i} className="text-sm text-gray-600 leading-relaxed">{p}</p>)
                    )}
                  </div>
                ) : genAI ? (
                  <div className="space-y-2">
                    {[100, 90, 95, 80].map((w, i) => (
                      <div key={i} className="h-3 bg-gray-200 rounded-full animate-pulse" style={{ width: `${w}%`, animationDelay: `${i*150}ms` }} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 italic">AI insights will appear after simulation completes.</p>
                )}
              </div>
            </div>
          )}

          {/* Global disclaimer — always visible at bottom of results area */}
          <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl flex items-start gap-2.5">
            <Info className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-500 leading-relaxed">
              <span className="font-semibold text-gray-600">© 2026 Alpha Horizon. For informational and educational purposes only. Not financial or investment advice.</span>{' '}
              Backtests use historical price data from Yahoo Finance and do not account for taxes, transaction costs, or behavioral factors. Historical performance does not guarantee future results. Consult a licensed financial advisor before making any investment decisions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
