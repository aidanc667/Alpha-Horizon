'use client';
import React, { useState } from 'react';
import { BarChart3, Loader2, AlertTriangle } from 'lucide-react';
import type { NearTermIntelligence, LiveBriefing } from '@/types/market';
import type { RiskProfile, TimeHorizon, ContextStatus, SessionCtx } from './types';
import { RiskHorizonControls } from './RiskHorizonControls';

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

export function BestStrategyPanel({
  nearTermData,
  liveData,
  sessionCtx,
  contextStatus,
  onSessionCtxUpdate,
}: {
  nearTermData: NearTermIntelligence | null;
  liveData: LiveBriefing | null;
  sessionCtx: SessionCtx;
  contextStatus: ContextStatus;
  onSessionCtxUpdate: (bestTickers: string) => void;
}) {
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('Moderate');
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>('1 year');
  const [result, setResult] = useState<BestStrategyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch('/api/market', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bestStrategy', riskProfile, timeHorizon: timeHorizon, nearTermContext: nearTermData, liveContext: liveData, sessionCtx }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data);
        const tickers = ((data.data?.allocations || []) as StrategyAllocation[]).slice(0, 5)
          .map(a => `${a.ticker}(${a.weight}%)`).join(', ');
        if (tickers) onSessionCtxUpdate(tickers);
      } else {
        setError(data.error || 'Generation failed');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e.message || 'Error generating portfolio');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-6 mb-6">
        <div className="flex flex-wrap items-end gap-6">
          <RiskHorizonControls riskProfile={riskProfile} setRiskProfile={setRiskProfile} timeHorizon={timeHorizon} setTimeHorizon={setTimeHorizon} />
          <button
            onClick={generate}
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

          <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-4 text-sm text-orange-900 leading-relaxed">
            <span className="font-bold">Macro Alignment: </span>{result.macroAlignment}
          </div>

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

          <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-900 leading-relaxed">
            <span className="font-bold">Rebalancing: </span>{result.rebalancingGuidance}
          </div>

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
