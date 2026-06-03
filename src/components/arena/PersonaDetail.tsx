'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown, Target, Sparkles, Loader2, ChevronDown, ChevronUp, Plus, X, AlertCircle, Trash2, Scale, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { Persona, PersonaSnapshot } from '@/types';

interface PersonaDetailProps {
  personaId: string;
  onBack: () => void;
  onDelete?: (id: string) => void;
}

type Period = '6m' | '1w' | '1m' | 'all';

export default function PersonaDetail({ personaId, onBack, onDelete }: PersonaDetailProps) {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [snapshots, setSnapshots] = useState<PersonaSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefing, setBriefing] = useState<unknown>(null);
  const [briefingTime, setBriefingTime] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [failedTickers, setFailedTickers] = useState<string[]>([]);
  const [showThesis, setShowThesis] = useState(false);
  const [isMarketHours, setIsMarketHours] = useState(false);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [addTicker, setAddTicker] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  // Sell state
  const [showSell, setShowSell] = useState<string | null>(null);
  const [sellAmount, setSellAmount] = useState('');
  const [sellLoading, setSellLoading] = useState(false);
  const [sellError, setSellError] = useState('');

  // Rebalance state
  const [showRebalance, setShowRebalance] = useState(false);
  const [rebalanceWeights, setRebalanceWeights] = useState<Array<{ ticker: string; weight: number }>>([]);
  const [rebalanceLoading, setRebalanceLoading] = useState(false);
  const [rebalanceError, setRebalanceError] = useState('');

  const loadPersona = useCallback(async () => {
    try {
      const res = await fetch(`/api/personas/${personaId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPersona(data.persona);
      setSnapshots(data.snapshots || []);

      // Check if today's briefing exists
      const today = new Date().toISOString().split('T')[0];
      const todaySnap = data.snapshots?.find((s: PersonaSnapshot) => s.snapshot_date === today);
      if (todaySnap?.ai_briefing) {
        let parsed: unknown = todaySnap.ai_briefing;
        try {
          parsed = JSON.parse(todaySnap.ai_briefing as string);
        } catch {
          // keep as string
        }
        setBriefing(parsed);
        setBriefingTime(todaySnap.ai_briefing_generated_at);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load persona');
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/personas/${personaId}/refresh`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIsMarketHours(data.isMarketHours ?? false);
      setFailedTickers(data.failedTickers ?? []);
      await loadPersona();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [personaId, loadPersona]);

  const handleGetBriefing = async () => {
    setBriefingLoading(true);
    try {
      const res = await fetch(`/api/personas/${personaId}/briefing`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBriefing(data.briefing);
      setBriefingTime(data.generated_at);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Briefing failed');
    } finally {
      setBriefingLoading(false);
    }
  };

  const handleAddPosition = async () => {
    if (!addTicker.trim() || !addAmount || Number(addAmount) <= 0) {
      setAddError('Enter a valid ticker and dollar amount');
      return;
    }
    setAddLoading(true);
    setAddError('');
    try {
      const res = await fetch(`/api/personas/${personaId}/add-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: addTicker.trim().toUpperCase(), amount: Number(addAmount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add position');
      setShowAddPosition(false);
      setAddTicker('');
      setAddAmount('');
      await loadPersona();
      await handleRefresh();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Failed to add position');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${persona?.name}"? This cannot be undone.`)) return;
    try {
      await fetch(`/api/personas/${personaId}`, { method: 'DELETE' });
      if (onDelete) onDelete(personaId);
      onBack();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const handleSell = async () => {
    if (!showSell || !sellAmount || Number(sellAmount) <= 0) {
      setSellError('Enter a valid dollar amount');
      return;
    }
    setSellLoading(true);
    setSellError('');
    try {
      const res = await fetch(`/api/personas/${personaId}/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: showSell, sell_amount: Number(sellAmount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sell');
      setShowSell(null);
      setSellAmount('');
      await loadPersona();
      await handleRefresh();
    } catch (e: unknown) {
      setSellError(e instanceof Error ? e.message : 'Failed to sell');
    } finally {
      setSellLoading(false);
    }
  };

  const openRebalance = () => {
    const holdings = latestSnapshot?.holdings_detail_json || [];
    const totalVal = holdings.reduce((s, h) => s + h.currentValue, 0) || startingBalance;
    const weights = holdings.map(h => ({
      ticker: h.ticker,
      weight: Math.round((h.currentValue / totalVal) * 1000) / 1000,
    }));
    setRebalanceWeights(weights);
    setRebalanceError('');
    setShowRebalance(true);
  };

  const handleRebalance = async () => {
    const totalW = rebalanceWeights.reduce((s, w) => s + w.weight, 0);
    if (Math.abs(totalW - 1) > 0.011) {
      setRebalanceError(`Weights must sum to 100% (currently ${(totalW * 100).toFixed(1)}%)`);
      return;
    }
    setRebalanceLoading(true);
    setRebalanceError('');
    try {
      const res = await fetch(`/api/personas/${personaId}/rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_weights: rebalanceWeights }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rebalance failed');
      setShowRebalance(false);
      await loadPersona();
      await handleRefresh();
    } catch (e: unknown) {
      setRebalanceError(e instanceof Error ? e.message : 'Rebalance failed');
    } finally {
      setRebalanceLoading(false);
    }
  };

  useEffect(() => {
    loadPersona().then(() => handleRefresh());
  }, [personaId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
    </div>
  );

  if (error || !persona) return (
    <div className="flex items-center justify-center h-full flex-col gap-3">
      <p className="text-red-400">{error || 'Persona not found'}</p>
      <button onClick={onBack} className="text-amber-400 text-sm hover:underline">← Back to roster</button>
    </div>
  );

  const latestSnapshot = snapshots[0];
  const currentValue = latestSnapshot ? Number(latestSnapshot.portfolio_value) : Number(persona.starting_balance);
  const benchmarkValue = latestSnapshot ? Number(latestSnapshot.benchmark_value) : Number(persona.starting_balance);
  const startingBalance = Number(persona.starting_balance);
  const totalReturn = (currentValue / startingBalance - 1) * 100;
  const totalReturnDollar = currentValue - startingBalance;
  const benchReturn = (benchmarkValue / startingBalance - 1) * 100;
  const alpha = totalReturn - benchReturn;

  const todayReturn = latestSnapshot?.holdings_detail_json
    ? latestSnapshot.holdings_detail_json.reduce((sum, h) => sum + (h.todayChangePct * h.weightCurrent), 0) * 100
    : 0;
  const todayDollar = currentValue * (todayReturn / 100);

  const inceptionDate = new Date(persona.inception_date);
  const daysRunning = Math.floor((Date.now() - inceptionDate.getTime()) / 86400000);

  // Chart data — both indexed to starting_balance
  const chartData = [...snapshots].reverse().map(s => ({
    // Append T12:00:00 so the date parses in local time, not UTC midnight (which shifts the label back one day in US timezones)
    date: new Date(s.snapshot_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    portfolio: Number(s.portfolio_value),
    benchmark: Number(s.benchmark_value),
  }));
  if (chartData.length === 0 && latestSnapshot) {
    chartData.push({
      date: 'Today',
      portfolio: currentValue,
      benchmark: benchmarkValue,
    });
  }

  const filteredChart = (() => {
    if (period === 'all' || chartData.length === 0) return chartData;
    const days = period === '6m' ? 180 : period === '1w' ? 7 : 30;
    return chartData.slice(Math.max(0, chartData.length - days));
  })();

  // Performance attribution
  const attribution = latestSnapshot?.holdings_detail_json?.map(h => ({
    ticker: h.ticker,
    contribution: ((h.gainLoss) / startingBalance) * 100,
    gainLossPct: h.gainLossPct * 100,
    currentValue: h.currentValue,
    weightCurrent: h.weightCurrent * 100,
    todayPct: h.todayChangePct * 100,
  })) || [];

  const formatTime = (ts: string | null) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
  };

  const PERIODS: Period[] = ['1w', '1m', '6m', 'all'];

  // Compute portfolio intelligence metrics from snapshot history
  const computeMetrics = () => {
    if (snapshots.length < 2) return null;
    const chronological = [...snapshots].reverse(); // oldest first
    const dailyPortfolio: number[] = [];
    const dailyBenchmark: number[] = [];
    for (let i = 1; i < chronological.length; i++) {
      dailyPortfolio.push(Number(chronological[i].portfolio_value) / Number(chronological[i - 1].portfolio_value) - 1);
      dailyBenchmark.push(Number(chronological[i].benchmark_value) / Number(chronological[i - 1].benchmark_value) - 1);
    }
    const n = dailyPortfolio.length;
    if (n < 1) return null;

    const RISK_FREE_DAILY = 0.045 / 252;

    // Annualized return
    const annualizedReturn = daysRunning > 0
      ? Math.pow(currentValue / startingBalance, 365 / daysRunning) - 1
      : 0;

    // Volatility
    const mean = dailyPortfolio.reduce((s, r) => s + r, 0) / n;
    const variance = dailyPortfolio.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
    const annualizedVol = Math.sqrt(variance * 252) * 100;

    // Sharpe
    const excessReturn = annualizedReturn - 0.045;
    const sharpe = annualizedVol > 0 ? excessReturn / (annualizedVol / 100) : 0;

    // Sortino (downside only)
    const downside = dailyPortfolio.filter(r => r < RISK_FREE_DAILY);
    const downsideVar = downside.length > 0
      ? downside.reduce((s, r) => s + (r - RISK_FREE_DAILY) ** 2, 0) / downside.length
      : 0;
    const annualizedDownside = Math.sqrt(downsideVar * 252);
    const sortino = annualizedDownside > 0 ? (annualizedReturn - 0.045) / annualizedDownside : 0;

    // Max Drawdown
    let peak = Number(chronological[0].portfolio_value);
    let maxDD = 0;
    for (const s of chronological) {
      const val = Number(s.portfolio_value);
      if (val > peak) peak = val;
      const dd = peak > 0 ? (peak - val) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }

    // Beta
    let beta = 1;
    if (n > 1) {
      const bMean = dailyBenchmark.reduce((s, r) => s + r, 0) / n;
      const pMean = mean;
      const cov = dailyPortfolio.reduce((s, r, i) => s + (r - pMean) * (dailyBenchmark[i] - bMean), 0) / n;
      const bVar = dailyBenchmark.reduce((s, r) => s + (r - bMean) ** 2, 0) / n;
      beta = bVar > 0 ? cov / bVar : 1;
    }

    // Win rate vs benchmark
    const wins = dailyPortfolio.filter((r, i) => r > dailyBenchmark[i]).length;
    const winRate = (wins / n) * 100;

    return { annualizedVol, sharpe, sortino, maxDD: maxDD * 100, beta, winRate, n };
  };
  const metrics = computeMetrics();

  return (
    <>
    <div className="h-full overflow-y-auto" style={{ background: 'linear-gradient(135deg, #0a0f1e 0%, #0f172a 50%, #111827 100%)' }}>
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* Back + Header */}
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-amber-400 transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />Back to Arena
          </button>
          <div className="flex items-center gap-3">
            {!isMarketHours && (
              <span className="text-xs text-slate-500 px-2 py-1 bg-white/4 rounded-lg">Market Closed</span>
            )}
            <button
              onClick={() => { setShowAddPosition(true); setAddError(''); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs font-semibold transition-all"
            >
              <Plus className="w-3.5 h-3.5" />Add Position
            </button>
            <button
              onClick={openRebalance}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 rounded-lg text-blue-400 text-xs font-semibold transition-all"
            >
              <Scale className="w-3.5 h-3.5" />Rebalance
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 text-xs font-semibold transition-all"
              title="Delete this persona"
            >
              <Trash2 className="w-3.5 h-3.5" />Delete
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-lg text-amber-400 text-xs font-semibold transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh Prices'}
            </button>
          </div>
        </div>

        {/* Hero Stats */}
        <div className="bg-slate-900 border border-white/8 rounded-2xl p-6" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.06) 0%, rgba(15,23,42,0.98) 100%)' }}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-white">{persona.name}</h1>
              <p className="text-slate-400 text-sm mt-0.5">
                Risk {persona.risk_score}/10 · vs {persona.benchmark_ticker} · {daysRunning} days running
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-white font-mono">
                ${currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-slate-400 text-xs mt-0.5">
                Started: ${startingBalance.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/4 border border-white/6 rounded-xl p-3">
              <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Today</p>
              <div className="flex items-center gap-1">
                {todayReturn >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
                <p className={`text-lg font-bold font-mono ${todayReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {todayReturn >= 0 ? '+' : ''}{todayReturn.toFixed(2)}%
                </p>
              </div>
              <p className={`text-xs mt-0.5 ${todayDollar >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {todayDollar >= 0 ? '+' : ''}${todayDollar.toFixed(2)}
              </p>
            </div>

            <div className="bg-white/4 border border-white/6 rounded-xl p-3">
              <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Since Inception</p>
              <div className="flex items-center gap-1">
                {totalReturn >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
                <p className={`text-lg font-bold font-mono ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}%
                </p>
              </div>
              <p className={`text-xs mt-0.5 ${totalReturnDollar >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {totalReturnDollar >= 0 ? '+' : ''}${totalReturnDollar.toFixed(2)}
              </p>
            </div>

            <div className="bg-white/4 border border-white/6 rounded-xl p-3">
              <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">{persona.benchmark_ticker} Return</p>
              <p className={`text-lg font-bold font-mono ${benchReturn >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                {benchReturn >= 0 ? '+' : ''}{benchReturn.toFixed(2)}%
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Benchmark</p>
            </div>

            <div className="bg-white/4 border border-white/6 rounded-xl p-3">
              <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Alpha</p>
              <div className="flex items-center gap-1">
                <Target className={`w-4 h-4 ${alpha >= 0 ? 'text-amber-400' : 'text-red-400'}`} />
                <p className={`text-lg font-bold font-mono ${alpha >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                  {alpha >= 0 ? '+' : ''}{alpha.toFixed(2)}%
                </p>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">vs {persona.benchmark_ticker}</p>
            </div>
          </div>
        </div>

        {/* Portfolio Intelligence Metrics */}
        <div className="bg-slate-900 border border-white/8 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-blue-400" />
            <h3 className="text-white font-semibold text-sm">Portfolio Intelligence</h3>
          </div>
          {metrics ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {/* Volatility */}
                <div className="bg-white/4 border border-white/6 rounded-xl p-3">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Volatility</p>
                  <p className={`text-xl font-bold font-mono ${
                    metrics.annualizedVol < 15 ? 'text-slate-300' :
                    metrics.annualizedVol < 25 ? 'text-amber-400' : 'text-red-400'
                  }`}>{metrics.annualizedVol.toFixed(1)}%</p>
                  <p className="text-slate-500 text-[10px] mt-0.5">annualized std dev</p>
                </div>
                {/* Sharpe */}
                <div className="bg-white/4 border border-white/6 rounded-xl p-3">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Sharpe Ratio</p>
                  <p className={`text-xl font-bold font-mono ${
                    metrics.sharpe < 0 ? 'text-red-400' :
                    metrics.sharpe < 1 ? 'text-amber-400' :
                    metrics.sharpe < 2 ? 'text-emerald-400' : 'text-emerald-300'
                  }`}>{metrics.sharpe.toFixed(2)}</p>
                  <p className="text-slate-500 text-[10px] mt-0.5">risk-adj return (4.5% rf)</p>
                </div>
                {/* Sortino */}
                <div className="bg-white/4 border border-white/6 rounded-xl p-3">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Sortino Ratio</p>
                  <p className={`text-xl font-bold font-mono ${
                    metrics.sortino < 0 ? 'text-red-400' :
                    metrics.sortino < 1 ? 'text-amber-400' :
                    metrics.sortino < 2 ? 'text-emerald-400' : 'text-emerald-300'
                  }`}>{metrics.sortino.toFixed(2)}</p>
                  <p className="text-slate-500 text-[10px] mt-0.5">downside risk only</p>
                </div>
                {/* Max Drawdown */}
                <div className="bg-white/4 border border-white/6 rounded-xl p-3">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Max Drawdown</p>
                  <p className={`text-xl font-bold font-mono ${
                    metrics.maxDD < 5 ? 'text-emerald-400' :
                    metrics.maxDD < 15 ? 'text-amber-400' : 'text-red-400'
                  }`}>-{metrics.maxDD.toFixed(1)}%</p>
                  <p className="text-slate-500 text-[10px] mt-0.5">peak-to-trough</p>
                </div>
                {/* Beta */}
                <div className="bg-white/4 border border-white/6 rounded-xl p-3">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Beta</p>
                  <p className={`text-xl font-bold font-mono ${
                    metrics.beta < 0.8 ? 'text-blue-400' :
                    metrics.beta < 1.2 ? 'text-slate-300' :
                    metrics.beta < 1.6 ? 'text-amber-400' : 'text-red-400'
                  }`}>{metrics.beta.toFixed(2)}</p>
                  <p className="text-slate-500 text-[10px] mt-0.5">vs benchmark sensitivity</p>
                </div>
                {/* Win Rate */}
                <div className="bg-white/4 border border-white/6 rounded-xl p-3">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Win Rate</p>
                  <p className={`text-xl font-bold font-mono ${
                    metrics.winRate < 40 ? 'text-red-400' :
                    metrics.winRate < 55 ? 'text-amber-400' : 'text-emerald-400'
                  }`}>{metrics.winRate.toFixed(0)}%</p>
                  <p className="text-slate-500 text-[10px] mt-0.5">{metrics.n} trading days</p>
                </div>
              </div>
              <p className="text-slate-600 text-xs mt-3">
                Based on {metrics.n} daily snapshots{metrics.n < 20 ? ' — stabilizes at 20+' : ''}
              </p>
            </>
          ) : (
            <div className="text-center py-6">
              <Activity className="w-8 h-8 text-blue-500/30 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">Metrics available after 2+ daily snapshots</p>
              <p className="text-slate-600 text-xs mt-1">Refresh prices daily to build your history</p>
            </div>
          )}
        </div>

        {/* Investment Thesis (collapsible) */}
        {persona.thesis && (
          <div className="bg-slate-900 border border-white/8 rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowThesis(!showThesis)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/4 transition-colors"
            >
              <span className="text-sm font-semibold text-slate-300">Investment Thesis</span>
              {showThesis ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {showThesis && (
              <div className="px-5 pb-4 border-t border-white/6">
                <p className="text-slate-300 text-sm leading-relaxed mt-3 italic">&quot;{persona.thesis}&quot;</p>
              </div>
            )}
          </div>
        )}

        {/* Chart */}
        <div className="bg-slate-900 border border-white/8 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-sm">Benchmark Race</h3>
            <div className="flex gap-1">
              {PERIODS.map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    period === p ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {p === '1w' ? '1W' : p === '1m' ? '1M' : p === '6m' ? '6M' : 'All'}
                </button>
              ))}
            </div>
          </div>
          {filteredChart.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={filteredChart} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  formatter={(val, name) => [`$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name === 'portfolio' ? persona.name : persona.benchmark_ticker]}
                />
                <Legend formatter={(val) => val === 'portfolio' ? persona.name : persona.benchmark_ticker} wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                <Line type="monotone" dataKey="portfolio" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="benchmark" stroke="#60a5fa" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center">
              <p className="text-slate-500 text-sm">Chart will populate as daily snapshots accumulate</p>
            </div>
          )}
        </div>

        {/* Price fetch warning */}
        {failedTickers.length > 0 && (
          <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/25 rounded-2xl">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 text-sm font-semibold">Price fetch failed for: {failedTickers.join(', ')}</p>
              <p className="text-red-400/70 text-xs mt-0.5">These positions are showing inception prices. Yahoo Finance may be temporarily unavailable — try refreshing again in a moment.</p>
            </div>
          </div>
        )}

        {/* Holdings Table */}
        {latestSnapshot && latestSnapshot.holdings_detail_json.length > 0 && (
          <div className="bg-slate-900 border border-white/8 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/6">
              <h3 className="text-white font-semibold text-sm">Holdings</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/6">
                    {['Ticker', 'Inception Price', 'Current Price', 'Today', 'Started With', 'Current Value', 'Total Return', '% of Portfolio', 'Action'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {latestSnapshot.holdings_detail_json.map((h, i) => (
                    <tr key={i} className="border-b border-white/4 hover:bg-white/2 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-white text-sm">{h.ticker}</td>
                      <td className="px-4 py-3 text-slate-400 text-sm font-mono">${h.inceptionPrice.toFixed(2)}</td>
                      <td className="px-4 py-3 text-white text-sm font-mono font-semibold">${h.currentPrice.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-sm font-bold font-mono ${h.todayChangePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {h.todayChangePct >= 0 ? '+' : ''}{(h.todayChangePct * 100).toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-sm font-mono">${(h.shares * h.inceptionPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-white text-sm font-mono">${h.currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className={`px-4 py-3 text-sm font-bold font-mono ${h.gainLossPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {h.gainLossPct >= 0 ? '+' : ''}{(h.gainLossPct * 100).toFixed(2)}%
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-white/8">
                            <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${(h.weightCurrent * 100).toFixed(1)}%` }} />
                          </div>
                          <span className="text-slate-300 text-xs">{(h.weightCurrent * 100).toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {h.ticker !== 'CASH' && (
                          <button
                            onClick={() => { setShowSell(h.ticker); setSellAmount(''); setSellError(''); }}
                            className="px-2.5 py-1 text-xs font-semibold text-slate-400 hover:text-red-400 border border-white/8 hover:border-red-500/30 hover:bg-red-500/10 rounded-lg transition-all"
                          >
                            Sell
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Performance Attribution */}
        {attribution.length > 0 && (
          <div className="bg-slate-900 border border-white/8 rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-3">Performance Attribution</h3>
            <p className="text-slate-400 text-xs mb-3">
              Of {persona.name}&apos;s {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}% total return:
            </p>
            <div className="space-y-2">
              {attribution.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).map((a, i) => {
                const maxContribution = Math.max(...attribution.map(x => Math.abs(x.contribution)));
                return (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-slate-300 font-mono text-sm w-16">{a.ticker}</span>
                    <div className="flex-1 mx-3">
                      <div className="h-1.5 rounded-full bg-white/8 relative">
                        <div
                          className={`h-full rounded-full ${a.contribution >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.min(100, maxContribution > 0 ? Math.abs(a.contribution) / maxContribution * 100 : 0)}%` }}
                        />
                      </div>
                    </div>
                    <span className={`text-xs font-bold font-mono w-16 text-right ${a.contribution >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {a.contribution >= 0 ? '+' : ''}{a.contribution.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI Daily Briefing */}
        <div className="bg-slate-900 border border-white/8 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/6 flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold text-sm">AI Daily Briefing</h3>
              {briefingTime && (
                <p className="text-slate-500 text-xs mt-0.5">Last analyzed: today at {formatTime(briefingTime)}</p>
              )}
            </div>
            <button
              onClick={handleGetBriefing}
              disabled={briefingLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-lg text-amber-400 text-xs font-semibold transition-all disabled:opacity-50"
            >
              {briefingLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {briefingLoading ? 'Analyzing...' : briefing ? 'Refresh Analysis' : 'Get AI Analysis'}
            </button>
          </div>
          <div className="p-5">
            {briefing ? (() => {
              try {
                const b = typeof briefing === 'string' ? JSON.parse(briefing as string) : briefing as {
                  summary?: string;
                  signals?: Array<{ type: string; ticker: string; action: string; reason: string }>;
                  macro?: string;
                  health?: string;
                };
                const SIGNAL_STYLES: Record<string, string> = {
                  TRIM: 'bg-red-500/15 border-red-500/30 text-red-300',
                  SELL: 'bg-red-500/15 border-red-500/30 text-red-300',
                  ADD: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
                  BUY: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
                  HOLD: 'bg-slate-500/15 border-slate-500/30 text-slate-300',
                  WATCH: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
                  REBALANCE: 'bg-blue-500/15 border-blue-500/30 text-blue-300',
                };
                const HEALTH_STYLES: Record<string, { bg: string; label: string }> = {
                  OVERWEIGHT_RISK: { bg: 'bg-red-500/15 border-red-500/30 text-red-300', label: 'Overweight Risk' },
                  BALANCED: { bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', label: 'Balanced' },
                  UNDERWEIGHT_RISK: { bg: 'bg-blue-500/15 border-blue-500/30 text-blue-300', label: 'Underweight Risk' },
                  CASH_DRAG: { bg: 'bg-amber-500/15 border-amber-500/30 text-amber-300', label: 'Cash Drag' },
                };
                const healthStyle = HEALTH_STYLES[b.health ?? ''] || HEALTH_STYLES.BALANCED;
                return (
                  <div className="space-y-4">
                    {b.summary && <p className="text-slate-200 text-sm leading-relaxed">{b.summary}</p>}
                    {b.signals && b.signals.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Signals</p>
                        {b.signals.map((sig: { type: string; ticker: string; action: string; reason: string }, i: number) => (
                          <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${SIGNAL_STYLES[sig.type] || 'bg-white/4 border-white/8 text-slate-300'}`}>
                            <span className="text-[10px] font-bold uppercase tracking-wide mt-0.5 flex-shrink-0 w-16">{sig.type}</span>
                            <div className="flex-1 min-w-0">
                              <span className="font-mono font-bold text-xs">{sig.ticker}</span>
                              <span className="text-xs ml-2">{sig.action}</span>
                              <p className="text-[10px] opacity-70 mt-0.5">{sig.reason}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {b.macro && (
                      <div className="p-3 bg-white/4 border border-white/6 rounded-xl">
                        <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Macro Context</p>
                        <p className="text-slate-300 text-xs">{b.macro}</p>
                      </div>
                    )}
                    {b.health && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-xs">Portfolio Health:</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border ${healthStyle.bg}`}>{healthStyle.label}</span>
                      </div>
                    )}
                  </div>
                );
              } catch {
                return <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-line">{String(briefing)}</p>;
              }
            })() : (
              <div className="text-center py-6">
                <Sparkles className="w-8 h-8 text-amber-500/40 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Click &quot;Get AI Analysis&quot; to generate today&apos;s briefing</p>
                <p className="text-slate-600 text-xs mt-1">Generated once per day · Cached for 24h</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>

    {/* Add Position Modal */}
    {showAddPosition && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/8"
            style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, transparent 100%)' }}>
            <div>
              <h3 className="text-white font-bold text-sm">Add Position</h3>
              <p className="text-slate-400 text-xs mt-0.5">Price locked at time of submission</p>
            </div>
            <button onClick={() => setShowAddPosition(false)}
              className="w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 block">Ticker Symbol</label>
              <input
                value={addTicker}
                onChange={e => setAddTicker(e.target.value.toUpperCase())}
                placeholder="e.g. AAPL"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 font-mono uppercase"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 block">Dollar Amount ($)</label>
              <input
                type="number"
                value={addAmount}
                onChange={e => setAddAmount(e.target.value)}
                placeholder="e.g. 5000"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="p-3 bg-white/4 border border-white/8 rounded-xl">
              <p className="text-slate-400 text-xs">The same dollar amount will also be added to the {persona?.benchmark_ticker} benchmark for a fair comparison.</p>
            </div>

            {addError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-xs">{addError}</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-5 py-4 border-t border-white/8 bg-white/2">
            <button onClick={() => setShowAddPosition(false)}
              className="text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
            <button
              onClick={handleAddPosition}
              disabled={addLoading || !addTicker.trim() || !addAmount}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {addLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {addLoading ? 'Adding...' : 'Add Position'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Sell Modal */}
    {showSell && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/8"
            style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, transparent 100%)' }}>
            <div>
              <h3 className="text-white font-bold text-sm">Sell Position — {showSell}</h3>
              <p className="text-slate-400 text-xs mt-0.5">Proceeds convert to CASH (tracked at $1/share)</p>
            </div>
            <button onClick={() => setShowSell(null)} className="w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            {(() => {
              const h = latestSnapshot?.holdings_detail_json?.find(x => x.ticker === showSell);
              if (!h) return null;
              return (
                <div className="p-3 bg-white/4 border border-white/6 rounded-xl">
                  <p className="text-slate-400 text-xs mb-1">Current Position</p>
                  <p className="text-white font-mono text-sm font-bold">{h.shares.toFixed(4)} shares @ ${h.currentPrice.toFixed(2)}</p>
                  <p className="text-slate-400 text-xs">= ${h.currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  <button
                    onClick={() => setSellAmount(h.currentValue.toFixed(2))}
                    className="mt-2 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                  >Sell all →</button>
                </div>
              );
            })()}
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 block">Dollar Amount to Sell ($)</label>
              <input
                type="number"
                value={sellAmount}
                onChange={e => setSellAmount(e.target.value)}
                placeholder="e.g. 2500"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-red-500/50"
              />
            </div>
            <div className="p-3 bg-amber-500/6 border border-amber-500/15 rounded-xl">
              <p className="text-amber-300/80 text-xs">Benchmark is NOT reduced when you sell — this lets you see the opportunity cost of holding cash.</p>
            </div>
            {sellError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-xs">{sellError}</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-5 py-4 border-t border-white/8 bg-white/2">
            <button onClick={() => setShowSell(null)} className="text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
            <button
              onClick={handleSell}
              disabled={sellLoading || !sellAmount || Number(sellAmount) <= 0}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-400 text-white font-bold text-sm rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sellLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {sellLoading ? 'Selling...' : 'Confirm Sell'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Rebalance Modal */}
    {showRebalance && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, transparent 100%)' }}>
            <div>
              <h3 className="text-white font-bold text-sm">Rebalance Portfolio</h3>
              <p className="text-slate-400 text-xs mt-0.5">
                Portfolio value: ${currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <button onClick={() => setShowRebalance(false)} className="w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center hover:bg-white/15 transition-colors">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
          <div className="p-5 space-y-3 overflow-y-auto flex-1">
            {/* Weight total indicator */}
            {(() => {
              const totalW = rebalanceWeights.reduce((s, w) => s + w.weight, 0);
              const isValid = Math.abs(totalW - 1) <= 0.011;
              return (
                <div className={`flex items-center justify-between p-3 rounded-xl border ${isValid ? 'bg-emerald-500/8 border-emerald-500/20' : 'bg-red-500/8 border-red-500/20'}`}>
                  <span className="text-xs text-slate-400">Total Weight</span>
                  <span className={`font-mono font-bold text-sm ${isValid ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(totalW * 100).toFixed(1)}% {isValid ? '✓' : `(need 100%)`}
                  </span>
                </div>
              );
            })()}

            {/* Weight inputs */}
            {rebalanceWeights.map((rw, i) => {
              const currentHolding = latestSnapshot?.holdings_detail_json?.find(h => h.ticker === rw.ticker);
              const currentHoldingValue = currentHolding?.currentValue || 0;
              const targetValue = currentValue * rw.weight;
              const diff = targetValue - currentHoldingValue;
              return (
                <div key={rw.ticker} className="flex items-center gap-3 p-3 bg-white/4 border border-white/6 rounded-xl">
                  <span className="font-mono font-bold text-white text-sm w-16 flex-shrink-0">{rw.ticker}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={(rw.weight * 100).toFixed(1)}
                        onChange={e => {
                          const newW = Number(e.target.value) / 100;
                          setRebalanceWeights(prev => prev.map((w, j) => j === i ? { ...w, weight: newW } : w));
                        }}
                        className="w-20 bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500/50 font-mono"
                      />
                      <span className="text-slate-400 text-xs">%</span>
                    </div>
                    <p className="text-slate-500 text-[10px] mt-1">
                      Target: ${targetValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      {currentHoldingValue > 0 && (
                        <span className={diff >= 0 ? 'text-emerald-500 ml-1' : 'text-red-500 ml-1'}>
                          ({diff >= 0 ? 'Buy' : 'Sell'} ${Math.abs(diff).toLocaleString('en-US', { maximumFractionDigits: 0 })})
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })}

            <div className="p-3 bg-white/4 border border-white/6 rounded-xl">
              <p className="text-slate-400 text-xs">Inception prices reset to today&apos;s prices. Overall portfolio return history is preserved.</p>
            </div>

            {rebalanceError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-xs">{rebalanceError}</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-5 py-4 border-t border-white/8 bg-white/2 flex-shrink-0">
            <button onClick={() => setShowRebalance(false)} className="text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
            <button
              onClick={handleRebalance}
              disabled={rebalanceLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white font-bold text-sm rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {rebalanceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
              {rebalanceLoading ? 'Rebalancing...' : 'Confirm Rebalance'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
