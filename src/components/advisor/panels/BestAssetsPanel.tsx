'use client';
import React, { useState } from 'react';
import { Star, Loader2, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import type { NearTermIntelligence, LiveBriefing } from '@/types/market';

type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';
type TimeHorizon = '6 months' | '1 year' | '3-5 years' | '10 years';
type ContextStatus = 'loading' | 'ready' | 'partial' | 'failed';

interface SessionCtx {
  portfolio: string;
  portfolioFindings: string;
  thesis: string;
  bestTickers: string;
  crossTabContext: string;
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
