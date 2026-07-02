'use client';
import React, { useState } from 'react';
import { Star, Loader2, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import type { NearTermIntelligence, LiveBriefing } from '@/types/market';
import type { RiskProfile, TimeHorizon, ContextStatus, SessionCtx } from './types';
import { RiskHorizonControls } from './RiskHorizonControls';

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

export function BestAssetsPanel({
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
  const [result, setResult] = useState<BestAssetsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch('/api/market', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bestAssets', riskProfile, timeHorizon, nearTermContext: nearTermData, liveContext: liveData, sessionCtx }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tickers = ((data.data?.assets || []) as any[]).slice(0, 5)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((a: any) => `${a.ticker}(${a.suggestedWeight}%)`).join(', ');
        if (tickers) onSessionCtxUpdate(tickers);
      } else {
        setError(data.error || 'Generation failed');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e.message || 'Error generating best assets');
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
            className="flex items-center gap-2 disabled:bg-zinc-200 text-white disabled:text-zinc-400 px-6 py-2.5 rounded-xl text-sm font-bold transition-colors"
            style={{ background: '#C9A84C' }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
            {loading ? 'Generating...' : 'Generate Best Stocks'}
          </button>
        </div>
        {contextStatus === 'loading' && (
          <p className="text-xs mt-3 flex items-center gap-1.5" style={{ color: '#C9A84C' }}>
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
          <div className="rounded-xl px-5 py-4 text-sm leading-relaxed" style={{ background: '#fefce8', border: '1px solid #fde68a', color: '#78590a' }}>
            <span className="font-bold">Macro Alignment: </span>{result.macroAlignment}
          </div>
          <div className="space-y-3">
            {(result.assets || []).map((asset, i) => (
              <div key={i} className="bg-white border border-zinc-200 rounded-xl p-5 flex items-start gap-4 transition-colors" style={{ ['--tw-border-opacity' as string]: '1' }} onMouseEnter={e => (e.currentTarget.style.borderColor = '#fde68a')} onMouseLeave={e => (e.currentTarget.style.borderColor = '')}>
                <div className="w-8 h-8 rounded-full font-bold text-sm flex items-center justify-center shrink-0" style={{ background: '#fefce8', color: '#C9A84C', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{asset.rank}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-base font-bold text-zinc-900 font-mono">{asset.ticker}</span>
                    <span className="text-sm text-zinc-600">{asset.name}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{asset.category}</span>
                    <span className={clsx('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
                      asset.risk === 'Low' ? 'bg-emerald-100 text-emerald-700' :
                      asset.risk === 'Medium' ? 'bg-[#fefce8] text-[#C9A84C]' : 'bg-red-100 text-red-700'
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
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: '#fefce8' }}>
            <Star className="w-8 h-8" style={{ color: '#C9A84C', opacity: 0.6 }} />
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
