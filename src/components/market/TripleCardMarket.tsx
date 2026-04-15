'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, Loader2, Lock, AlertCircle } from 'lucide-react';
import type { TripleCardData, DailyMarketRecord, Elite6Indicators } from '@/types/market';

interface TripleCardMarketProps {
  onBack?: () => void;
}

// ─── Accuracy Score Ring ──────────────────────────────────────────────────────

function AccuracyScoreRing({ score }: { score: number }) {
  const color =
    score >= 85 ? '#10b981' : score >= 70 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  const label =
    score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Learning';

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="8"
          />
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={`${2.51 * score} 251`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white font-mono">{score.toFixed(0)}</span>
          <span className="text-[10px] text-slate-500">/ 100</span>
        </div>
      </div>
      <p className="text-xs font-semibold mt-1" style={{ color }}>
        {label}
      </p>
      <p className="text-[10px] text-slate-500 mt-0.5">Predictive Accuracy</p>
    </div>
  );
}

// ─── Elite6Grid ───────────────────────────────────────────────────────────────

function Elite6Grid({
  indicators,
  variant,
}: {
  indicators: Elite6Indicators;
  variant: 'actual' | 'predicted';
}) {
  // Guard: stale DB records may have old schema — cast to access unknown fields safely
  const ind = indicators as Record<string, unknown> & Elite6Indicators;

  // ── Vibe Check (may be missing on old records) ──
  const vibeLabel = ind.vibeCheck?.label ?? null;
  const vibeScore = ind.vibeCheck?.score ?? null;

  const vibeEmoji =
    vibeLabel === 'Extreme Fear' ? '😱' :
    vibeLabel === 'Fear' ? '😨' :
    vibeLabel === 'Neutral' ? '😐' :
    vibeLabel === 'Greed' ? '😀' :
    vibeLabel === 'Extreme Greed' ? '🤑' : '⏳';

  const vibeColor =
    vibeLabel === 'Extreme Fear' ? 'text-red-400' :
    vibeLabel === 'Fear' ? 'text-orange-400' :
    vibeLabel === 'Neutral' ? 'text-slate-300' :
    vibeLabel === 'Greed' ? 'text-emerald-400' :
    vibeLabel === 'Extreme Greed' ? 'text-green-300' : 'text-slate-500';

  // ── Asset of Day ──
  const assetBias = ind.assetOfDay?.bias ?? null;
  const biasBadge = assetBias === 'Bullish'
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    : assetBias === 'Bearish'
    ? 'bg-red-500/20 text-red-300 border-red-500/30'
    : 'bg-slate-500/20 text-slate-300 border-slate-500/30';

  // ── Market Health ──
  const healthStatus = ind.marketHealth?.status ?? null;
  const healthColor =
    healthStatus === 'Healthy' ? 'text-emerald-400' :
    healthStatus === 'Mixed' ? 'text-amber-400' :
    healthStatus === 'Fragile' ? 'text-red-400' : 'text-slate-500';

  // ── Whale Activity ──
  const whaleSignal = ind.whaleActivity?.signal ?? null;
  const whaleColor =
    whaleSignal === 'Accumulating' ? 'text-emerald-400' :
    whaleSignal === 'Distributing' ? 'text-red-400' : 'text-slate-400';

  const whaleEmoji =
    whaleSignal === 'Accumulating' ? '🐋🟢' :
    whaleSignal === 'Distributing' ? '🐋🔴' : '🐋';

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
          The Big 6
        </span>
        {variant === 'predicted' && (
          <span className="px-1.5 py-0.5 bg-violet-500/15 border border-violet-500/30 text-violet-400 text-[9px] rounded font-bold uppercase tracking-wide">
            Predicted
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">

        {/* 1 — SPY Movement */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">
            {indicators.spyMovement.direction === 'up' ? '📈' : indicators.spyMovement.direction === 'down' ? '📉' : '➡️'}
          </div>
          <p className={`text-sm font-bold font-mono ${
            indicators.spyMovement.direction === 'up' ? 'text-emerald-400' :
            indicators.spyMovement.direction === 'down' ? 'text-red-400' : 'text-slate-300'
          }`}>{indicators.spyMovement.value}</p>
          <p className="text-slate-500 text-[9px] mt-0.5 leading-tight">{indicators.spyMovement.label}</p>
          <p className="text-slate-500 text-[9px] mt-1 font-semibold uppercase tracking-wide">SPY %</p>
        </div>

        {/* 2 — Vibe Check */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">{vibeEmoji}</div>
          <p className={`text-xs font-bold leading-tight ${vibeColor}`}>{vibeLabel ?? '—'}</p>
          <p className="text-slate-500 text-[9px] mt-0.5">{vibeScore != null ? `${vibeScore}/100` : '—'}</p>
          <p className="text-slate-500 text-[9px] mt-1 font-semibold uppercase tracking-wide">Vibe Check</p>
        </div>

        {/* 3 — Asset of the Day */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">⭐</div>
          <p className="text-sm font-bold font-mono text-white">{ind.assetOfDay?.ticker ?? '—'}</p>
          <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border mt-0.5 ${biasBadge}`}>
            {assetBias ?? '—'}
          </span>
          <p className="text-slate-500 text-[9px] mt-1 font-semibold uppercase tracking-wide">Asset of Day</p>
        </div>

        {/* 4 — Market Health */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">
            {healthStatus === 'Healthy' ? '💚' : healthStatus === 'Mixed' ? '🟡' : healthStatus === 'Fragile' ? '🔴' : '⏳'}
          </div>
          <p className={`text-xs font-bold leading-tight ${healthColor}`}>{ind.marketHealth?.label ?? '—'}</p>
          <p className="text-slate-500 text-[9px] mt-1 font-semibold uppercase tracking-wide">Mkt Health</p>
        </div>

        {/* 5 — Whale Activity */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-sm mb-1">{whaleEmoji}</div>
          <p className={`text-xs font-bold leading-tight ${whaleColor}`}>{whaleSignal ?? '—'}</p>
          <p className="text-slate-500 text-[9px] mt-0.5 capitalize">{ind.whaleActivity?.magnitude ?? '—'}</p>
          <p className="text-slate-500 text-[9px] mt-1 font-semibold uppercase tracking-wide">Whale Activity</p>
        </div>

        {/* 6 — Hot Sector */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">🚀</div>
          <p className="text-sm font-bold font-mono text-white">{ind.hotSector?.ticker ?? '—'}</p>
          <p className="text-slate-500 text-[9px] mt-0.5 leading-tight truncate">{ind.hotSector?.performance ?? '—'}</p>
          <p className="text-slate-500 text-[9px] mt-1 font-semibold uppercase tracking-wide">Hot Sector</p>
        </div>

      </div>
    </div>
  );
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
      <p className="text-slate-400 text-sm">Loading market intelligence...</p>
    </div>
  );
}

// ─── Yesterday Card ───────────────────────────────────────────────────────────

function YesterdayCard({ record }: { record: DailyMarketRecord | null | undefined }) {
  if (!record) {
    return (
      <div className="bg-white/4 border border-white/8 rounded-2xl p-8 text-center">
        <p className="text-slate-400 text-sm">
          Yesterday&apos;s record will appear here after the first noon lock.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Accuracy hero */}
      <div className="bg-white/4 border border-blue-500/20 rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {record.accuracyScore != null ? (
            <AccuracyScoreRing score={record.accuracyScore} />
          ) : (
            <div className="flex flex-col items-center">
              <div className="w-28 h-28 rounded-full border-2 border-dashed border-white/10 flex items-center justify-center">
                <span className="text-slate-500 text-xs text-center px-2">Pending Score</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Predictive Accuracy</p>
            </div>
          )}
          <div className="flex-1 text-center sm:text-left">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">
              Yesterday · {record.recordDate}
            </p>
            <h2 className="text-xl font-bold text-white mb-2">The Receipt</h2>
            {record.accuracyScore != null && record.accuracyBreakdown && (
              <div className="grid grid-cols-3 sm:grid-cols-7 gap-1 mt-3">
                {Object.entries(record.accuracyBreakdown).map(([key, val]) => (
                  <div key={key} className="text-center">
                    <p
                      className={`text-xs font-bold font-mono ${
                        Number(val) >= 70
                          ? 'text-emerald-400'
                          : Number(val) >= 50
                          ? 'text-amber-400'
                          : 'text-red-400'
                      }`}
                    >
                      {Number(val).toFixed(0)}
                    </p>
                    <p className="text-[8px] text-slate-600 uppercase tracking-wide leading-tight mt-0.5">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Elite6 actual */}
      {record.elite6Actual && (
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
          <Elite6Grid indicators={record.elite6Actual} variant="actual" />
        </div>
      )}

      {/* Brief bullets */}
      {record.briefBullets && record.briefBullets.length > 0 && (
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-200 mb-4">
            Daily Brief
          </p>
          <div className="space-y-3">
            {record.briefBullets.map((bullet, i) => (
              <div key={i} className="bg-white/3 border border-white/6 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-[10px] font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="border-l-2 border-slate-500/50 pl-3">
                    <p className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-1.5">What Happened</p>
                    <p className="text-white text-sm font-semibold leading-snug">{bullet.what}</p>
                  </div>
                  <div className="border-l-2 border-blue-500/50 pl-3">
                    <p className="text-xs font-bold text-blue-400 uppercase tracking-wide mb-1.5">Why Did it Happen</p>
                    <p className="text-slate-100 text-sm leading-relaxed">{bullet.why}</p>
                  </div>
                  <div className="border-l-2 border-amber-500/60 pl-3">
                    <p className="text-xs font-bold text-amber-400 uppercase tracking-wide mb-1.5">Impact on Investments</p>
                    <p className="text-slate-100 text-sm leading-relaxed">{bullet.impact}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outlier + Catalyst */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {record.outlier && (
          <div className="bg-white/4 border border-amber-500/20 rounded-2xl p-4">
            <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-1">
              Outlier
            </p>
            <p className="text-slate-200 text-sm leading-relaxed">{record.outlier}</p>
          </div>
        )}
        {record.catalyst && (
          <div className="bg-white/4 border border-violet-500/20 rounded-2xl p-4">
            <p className="text-[10px] text-violet-400 uppercase tracking-widest font-bold mb-1">
              Key Catalyst
            </p>
            <p className="text-slate-200 text-sm leading-relaxed">{record.catalyst}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Today Card ───────────────────────────────────────────────────────────────

function TodayCard({
  record,
  isStale,
}: {
  record: DailyMarketRecord;
  isStale: boolean;
}) {
  const [edgeBoardView, setEdgeBoardView] = useState<'top' | 'bottom'>('top');
  const weatherColors: Record<string, string> = {
    sunny: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
    overcast: 'bg-slate-500/10 border-slate-500/30 text-slate-300',
    stormy: 'bg-red-500/10 border-red-500/30 text-red-300',
  };

  return (
    <div className="space-y-4">
      {/* Live status + weather */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 bg-white/4 border border-amber-500/20 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">
              Live Pulse · Today
            </span>
            {isStale && (
              <span className="flex items-center gap-1 text-[9px] text-orange-400 bg-orange-400/10 border border-orange-400/20 rounded px-1.5 py-0.5">
                <AlertCircle className="w-3 h-3" />
                Data may be stale
              </span>
            )}
          </div>
          <p className="text-slate-400 text-xs">
            {record.recordDate} · Auto-refreshes every 20 minutes
          </p>
        </div>

        {record.weather && (
          <div
            className={`flex items-center gap-3 border rounded-2xl p-5 ${
              weatherColors[record.weather.condition] ??
              'bg-slate-500/10 border-slate-500/30 text-slate-300'
            }`}
          >
            <span className="text-4xl">{record.weather.emoji}</span>
            <div>
              <p className="font-bold text-sm">{record.weather.label}</p>
              <p className="text-[11px] opacity-80 leading-tight max-w-xs">
                {record.weather.description}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Elite6 */}
      {record.elite6Actual ? (
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
          <Elite6Grid indicators={record.elite6Actual} variant="actual" />
        </div>
      ) : (
        <div className="bg-white/4 border border-white/8 rounded-2xl p-8 text-center">
          <Loader2 className="w-6 h-6 text-amber-400 animate-spin mx-auto mb-2" />
          <p className="text-slate-400 text-sm">Generating live analysis...</p>
        </div>
      )}

      {/* Brief bullets */}
      {record.briefBullets && record.briefBullets.length > 0 && (
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-200 mb-4">
            Daily Brief
          </p>
          <div className="space-y-3">
            {record.briefBullets.map((bullet, i) => (
              <div key={i} className="bg-white/3 border border-white/6 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-[10px] font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="border-l-2 border-slate-500/50 pl-3">
                    <p className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-1.5">What Happened</p>
                    <p className="text-white text-sm font-semibold leading-snug">{bullet.what}</p>
                  </div>
                  <div className="border-l-2 border-blue-500/50 pl-3">
                    <p className="text-xs font-bold text-blue-400 uppercase tracking-wide mb-1.5">Why Did it Happen</p>
                    <p className="text-slate-100 text-sm leading-relaxed">{bullet.why}</p>
                  </div>
                  <div className="border-l-2 border-amber-500/60 pl-3">
                    <p className="text-xs font-bold text-amber-400 uppercase tracking-wide mb-1.5">Impact on Investments</p>
                    <p className="text-slate-100 text-sm leading-relaxed">{bullet.impact}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live headlines */}
      {record.liveHeadlines && record.liveHeadlines.length > 0 && (
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
            Live Headlines
          </p>
          <div className="space-y-2">
            {record.liveHeadlines
              .filter((h) => h.impactScore >= 6)
              .map((headline, i) => {
                const impactColor =
                  headline.impactScore >= 10
                    ? 'bg-red-500/20 text-red-400 border-red-500/30'
                    : headline.impactScore >= 8
                    ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                    : 'bg-amber-500/20 text-amber-400 border-amber-500/30';
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 bg-white/3 rounded-xl border border-white/5"
                  >
                    <span
                      className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${impactColor}`}
                    >
                      {headline.impactScore}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="text-[9px] bg-white/8 text-slate-400 px-1.5 py-0.5 rounded font-semibold">
                          {headline.source}
                        </span>
                        <span className="text-[9px] text-slate-500 bg-white/4 px-1.5 py-0.5 rounded">
                          {headline.category}
                        </span>
                      </div>
                      <p className="text-slate-200 text-xs font-medium leading-snug">
                        {headline.headline}
                      </p>
                      <p className="text-[10px] text-slate-600 mt-0.5">{headline.timestamp}</p>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Daily Edge Board */}
      {record.edgeBoard && (
        <div className="bg-slate-900 border border-white/8 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/6 flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold text-sm">Daily Edge Board</h3>
              <p className="text-slate-500 text-xs mt-0.5">Statistical edge &amp; assets to avoid today</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEdgeBoardView('top')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${edgeBoardView === 'top' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-500 hover:text-slate-300'}`}
              >▲ Top 5</button>
              <button
                onClick={() => setEdgeBoardView('bottom')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${edgeBoardView === 'bottom' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'text-slate-500 hover:text-slate-300'}`}
              >▼ Bottom 5</button>
            </div>
          </div>
          <div className="divide-y divide-white/4">
            {(edgeBoardView === 'top' ? record.edgeBoard.top5 : record.edgeBoard.bottom5).map((asset, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-white/2 transition-colors">
                <span className="text-slate-600 text-xs font-bold w-4">{asset.rank}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-white font-mono font-bold text-sm">{asset.ticker}</span>
                    <span className="text-slate-400 text-xs truncate">{asset.name}</span>
                    <span className="text-slate-600 text-[10px] px-1.5 py-0.5 bg-white/4 rounded">{asset.sector}</span>
                  </div>
                  <p className="text-slate-500 text-xs">{asset.edge}</p>
                </div>
                <span className={`font-mono font-bold text-sm flex-shrink-0 ${
                  asset.change.startsWith('+') ? 'text-emerald-400' : asset.change.startsWith('-') ? 'text-red-400' : 'text-slate-400'
                }`}>{asset.change}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's Positioning */}
      {record.positioning && (
        <div className="bg-slate-900 border border-white/8 rounded-2xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4">Today&apos;s Positioning</h3>
          <div className="space-y-3">
            {record.positioning.overweight.map((p, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-emerald-500/6 border border-emerald-500/15 rounded-xl">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide mt-0.5 w-20 flex-shrink-0">Overweight</span>
                <div className="flex-1 min-w-0">
                  <span className="text-white font-bold text-sm">{p.asset}</span>
                  <span className="text-slate-400 font-mono text-xs ml-2">{p.ticker}</span>
                  <p className="text-slate-400 text-xs mt-0.5">{p.rationale}</p>
                </div>
              </div>
            ))}
            {record.positioning.neutral.map((p, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-amber-500/6 border border-amber-500/15 rounded-xl">
                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wide mt-0.5 w-20 flex-shrink-0">Neutral</span>
                <div className="flex-1 min-w-0">
                  <span className="text-white font-bold text-sm">{p.asset}</span>
                  <span className="text-slate-400 font-mono text-xs ml-2">{p.ticker}</span>
                  <p className="text-slate-400 text-xs mt-0.5">{p.rationale}</p>
                </div>
              </div>
            ))}
            {record.positioning.underweight.map((p, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-red-500/6 border border-red-500/15 rounded-xl">
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-wide mt-0.5 w-20 flex-shrink-0">Underweight</span>
                <div className="flex-1 min-w-0">
                  <span className="text-white font-bold text-sm">{p.asset}</span>
                  <span className="text-slate-400 font-mono text-xs ml-2">{p.ticker}</span>
                  <p className="text-slate-400 text-xs mt-0.5">{p.rationale}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outlier + Catalyst */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {record.outlier && (
          <div className="bg-white/4 border border-amber-500/20 rounded-2xl p-4">
            <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-1">
              Outlier
            </p>
            <p className="text-slate-200 text-sm leading-relaxed">{record.outlier}</p>
          </div>
        )}
        {record.catalyst && (
          <div className="bg-white/4 border border-violet-500/20 rounded-2xl p-4">
            <p className="text-[10px] text-violet-400 uppercase tracking-widest font-bold mb-1">
              #1 Catalyst to Watch
            </p>
            <p className="text-slate-200 text-sm leading-relaxed">{record.catalyst}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tomorrow Card ────────────────────────────────────────────────────────────

function TomorrowCard({ record }: { record: DailyMarketRecord }) {
  const [timeToNoon, setTimeToNoon] = useState('');

  useEffect(() => {
    if (record.isNoonLocked) return;

    function calcCountdown() {
      const now = new Date();
      const etFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      });
      const etParts = etFormatter.formatToParts(now);
      const etHour = parseInt(etParts.find((p) => p.type === 'hour')?.value ?? '0');
      const etMin = parseInt(etParts.find((p) => p.type === 'minute')?.value ?? '0');

      if (etHour >= 12) {
        setTimeToNoon('');
        return;
      }

      const totalMinutes = (12 - etHour) * 60 - etMin;
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      setTimeToNoon(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }

    calcCountdown();
    const interval = setInterval(calcCountdown, 60_000);
    return () => clearInterval(interval);
  }, [record.isNoonLocked]);

  return (
    <div className="space-y-4">
      {/* Lock status */}
      <div
        className={`border rounded-2xl p-5 ${
          record.isNoonLocked
            ? 'bg-emerald-500/8 border-emerald-500/25'
            : 'bg-violet-500/8 border-violet-500/25'
        }`}
      >
        <div className="flex items-center gap-3 mb-2">
          <Lock
            className={`w-4 h-4 ${
              record.isNoonLocked ? 'text-emerald-400' : 'text-violet-400'
            }`}
          />
          <span
            className={`text-xs font-bold uppercase tracking-widest ${
              record.isNoonLocked ? 'text-emerald-400' : 'text-violet-400'
            }`}
          >
            {record.isNoonLocked ? 'Noon Lock Active' : 'Pre-Lock · Tomorrow Outlook'}
          </span>
        </div>

        {record.isNoonLocked ? (
          <p className="text-slate-400 text-xs">
            Predictions locked at{' '}
            {record.noonLockedAt
              ? new Date(record.noonLockedAt).toLocaleString('en-US', {
                  timeZone: 'America/New_York',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                  timeZoneName: 'short',
                })
              : 'noon ET'}
            . Scored against tomorrow&apos;s actuals.
          </p>
        ) : (
          <p className="text-slate-400 text-xs">
            Predictions will be locked at 12:00 PM ET today.
            {timeToNoon && (
              <span className="text-violet-400 font-semibold ml-1">
                ({timeToNoon} remaining)
              </span>
            )}
          </p>
        )}
      </div>

      {/* Predictions */}
      {record.tomorrowPredictions ? (
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
          <Elite6Grid indicators={record.tomorrowPredictions} variant="predicted" />
        </div>
      ) : (
        <div className="bg-white/4 border border-white/8 rounded-2xl p-8 text-center">
          <Lock className="w-6 h-6 text-slate-600 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">
            Predictions will be generated and locked at noon ET.
          </p>
        </div>
      )}

      {/* Tomorrow outlook narrative */}
      {record.tomorrowOutlook && (
        <div className="bg-white/4 border border-violet-500/20 rounded-2xl p-5">
          <p className="text-[10px] text-violet-400 uppercase tracking-widest font-bold mb-2">
            Tomorrow&apos;s Outlook
          </p>
          <p className="text-slate-200 text-sm leading-relaxed">{record.tomorrowOutlook}</p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="flex items-start gap-2 p-3 bg-white/3 border border-white/6 rounded-xl">
        <AlertCircle className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-500 leading-relaxed">
          These predictions are locked at noon ET and scored against tomorrow&apos;s actuals. Past
          accuracy scores are shown in the Yesterday card.
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TripleCardMarket({ onBack: _onBack }: TripleCardMarketProps) {
  const [activeCard, setActiveCard] = useState(1); // 0=Yesterday, 1=Today, 2=Tomorrow
  const [data, setData] = useState<TripleCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      // Ensure migration ran
      await fetch('/api/market/migrate', { method: 'POST' });

      const res = await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tripleCard' }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load triple card data');
      setData(json.data as TripleCardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load market data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh every 5 minutes when on Today card
  useEffect(() => {
    if (activeCard !== 1) return;
    const interval = setInterval(() => loadData(true), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [activeCard, loadData]);

  const handleRefresh = () => loadData(true);

  const CARDS = [
    {
      label: 'Yesterday',
      sublabel: 'The Receipt',
      icon: '📋',
      activeColor:
        'text-blue-400 bg-blue-500/15 border-blue-500/40',
      inactiveColor: 'text-slate-500 bg-white/4 border-white/8',
    },
    {
      label: 'Today',
      sublabel: 'Live Pulse',
      icon: '⚡',
      activeColor:
        'text-amber-400 bg-amber-500/15 border-amber-500/40',
      inactiveColor: 'text-slate-500 bg-white/4 border-white/8',
    },
    {
      label: 'Tomorrow',
      sublabel: 'The Outlook',
      icon: '🔮',
      activeColor:
        'text-violet-400 bg-violet-500/15 border-violet-500/40',
      inactiveColor: 'text-slate-500 bg-white/4 border-white/8',
    },
  ];

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: 'linear-gradient(135deg, #050a14 0%, #0a0f1e 50%, #0d1117 100%)',
      }}
    >
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Current Market Analysis</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              Triple-Card Intelligence System · Noon Lock Active
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data?.today.isNoonLocked ? (
              <span className="px-2 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs rounded-lg font-semibold">
                🔒 Noon Locked
              </span>
            ) : (
              <span className="px-2 py-1 bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs rounded-lg font-semibold">
                ⏳ Pre-Lock
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/6 hover:bg-white/10 border border-white/10 rounded-lg text-slate-400 text-xs font-semibold transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Card Navigation */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setActiveCard(Math.max(0, activeCard - 1))}
            disabled={activeCard === 0}
            className="w-9 h-9 rounded-full bg-white/6 hover:bg-white/12 border border-white/10 flex items-center justify-center text-slate-400 disabled:opacity-30 transition-all"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex gap-2">
            {CARDS.map((card, i) => (
              <button
                key={i}
                onClick={() => setActiveCard(i)}
                className={`px-4 py-2 rounded-xl border text-xs font-semibold transition-all ${
                  activeCard === i ? card.activeColor : card.inactiveColor
                }`}
              >
                <span className="mr-1">{card.icon}</span>
                {card.label}
                <span className="block text-[9px] opacity-70 mt-0.5">{card.sublabel}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setActiveCard(Math.min(2, activeCard + 1))}
            disabled={activeCard === 2}
            className="w-9 h-9 rounded-full bg-white/6 hover:bg-white/12 border border-white/10 flex items-center justify-center text-slate-400 disabled:opacity-30 transition-all"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Active Card Content */}
        {loading ? (
          <LoadingState />
        ) : (
          <>
            {activeCard === 0 && <YesterdayCard record={data?.yesterday} />}
            {activeCard === 1 && data?.today && (
              <TodayCard record={data.today} isStale={data.isLiveDataStale ?? false} />
            )}
            {activeCard === 2 && data?.today && <TomorrowCard record={data.today} />}
          </>
        )}
      </div>
    </div>
  );
}
