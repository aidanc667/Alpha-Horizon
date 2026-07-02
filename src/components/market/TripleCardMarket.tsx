'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, Loader2, Lock, AlertCircle } from 'lucide-react';
import type { TripleCardData, DailyMarketRecord, DailyIndicators, TomorrowPredictions, RollingAccuracy } from '@/types/market';

interface TripleCardMarketProps {
  onBack?: () => void;
}

// ─── Elite6Grid ───────────────────────────────────────────────────────────────

function Elite6Grid({
  indicators,
  variant,
}: {
  indicators: DailyIndicators;
  variant: 'actual' | 'predicted';
}) {
  // Guard: stale DB records may have old schema
  const ind = indicators as Record<string, unknown> & DailyIndicators;

  // ── Fear & Greed ──
  const fg = ind.fearGreed as DailyIndicators['fearGreed'] | undefined;
  const fgLabel = fg?.label ?? null;
  const fgDelta = fg?.delta ?? 0;
  const fgEmoji =
    fgLabel === 'Extreme Fear' ? '😱' :
    fgLabel === 'Fear' ? '😨' :
    fgLabel === 'Neutral' ? '😐' :
    fgLabel === 'Greed' ? '😀' :
    fgLabel === 'Extreme Greed' ? '🤑' : '⏳';
  const fgColor =
    fgLabel === 'Extreme Fear' ? 'text-red-500' :
    fgLabel === 'Fear' ? 'text-orange-500' :
    fgLabel === 'Neutral' ? 'text-zinc-600' :
    fgLabel === 'Greed' ? 'text-emerald-600' :
    fgLabel === 'Extreme Greed' ? 'text-emerald-700' : 'text-zinc-400';
  const deltaColor = fgDelta > 0 ? 'text-emerald-600' : fgDelta < 0 ? 'text-red-500' : 'text-zinc-400';

  // ── SPY Trend ──
  const spyTrend = ind.spyTrend as DailyIndicators['spyTrend'] | undefined;
  const spyPct = spyTrend?.changePercent ?? null;
  // Choppy/sideways if move is less than 0.3% either way
  const spyMoveType = spyPct == null ? null : spyPct > 0.3 ? 'Up' : spyPct < -0.3 ? 'Down' : 'Sideways';
  const spyArrow = spyMoveType === 'Up' ? '↑' : spyMoveType === 'Down' ? '↓' : '→';
  const spyArrowColor = spyMoveType === 'Up' ? 'text-emerald-600' : spyMoveType === 'Down' ? 'text-red-500' : 'text-zinc-400';
  const spyMoveLabel = spyMoveType === 'Sideways' ? 'Choppy' : (spyMoveType ?? '—');
  const spyPctStr = spyPct != null ? `${spyPct > 0 ? '+' : ''}${spyPct}% today` : '—';

  // ── Sector Rotation ──

  // ── Next Catalyst ──

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#b09060' }}>
          Market Intelligence
        </span>
        {variant === 'predicted' && (
          <span className="px-1.5 py-0.5 bg-violet-50 border border-violet-200 text-violet-700 text-[9px] rounded font-bold uppercase tracking-wide">
            Predicted
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">

        {/* 1 — Market Sentiment (Fear & Greed) */}
        <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
          <div className="text-base mb-1">{fgEmoji}</div>
          <p className={`text-base font-bold ${fgColor}`}>{fgLabel ?? '—'}</p>
          <p className="text-[10px] font-mono mt-0.5" style={{ color: '#b09060' }}>{fg?.score != null ? `${fg.score} / 100` : '—'}</p>
          <p className={`text-[10px] font-bold mt-0.5 ${deltaColor}`}>
            {fgDelta !== 0 ? (fgDelta > 0 ? `↑${fgDelta} today` : `↓${Math.abs(fgDelta)} today`) : '→ flat'}
          </p>
          <p className="text-[10px] mt-2 font-semibold uppercase tracking-wide" style={{ color: '#6b5840' }}>Fear & Greed</p>
        </div>

        {/* 2 — S&P 500 Today */}
        <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
          <div className={`text-2xl font-bold mb-1 ${spyArrowColor}`}>{spyArrow}</div>
          <p className={`text-base font-bold ${spyArrowColor}`}>{spyMoveLabel}</p>
          <p className={`text-[10px] font-mono mt-0.5 ${spyArrowColor}`}>{spyPctStr}</p>
          <div className="flex justify-center gap-1 mt-1.5">
            <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded ${spyTrend?.above200MA ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              200MA {spyTrend?.above200MA ? '✓' : '✗'}
            </span>
            <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded ${spyTrend?.above50MA ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              50MA {spyTrend?.above50MA ? '✓' : '✗'}
            </span>
          </div>
          {spyTrend?.volumeRatio != null && (
            <p className={`text-[9px] font-semibold mt-1 ${
              spyTrend.volumeRatio >= 1.5 ? 'text-amber-600' :
              spyTrend.volumeRatio <= 0.7 ? 'text-zinc-400' : 'text-zinc-500'
            }`}>
              {spyTrend.volumeRatio}x avg vol
            </p>
          )}
          <p className="text-[10px] mt-2 font-semibold uppercase tracking-wide" style={{ color: '#6b5840' }}>S&P 500 Today</p>
        </div>

        {/* 3 — VIX Today */}
        {(() => {
          const vixDir = (ind.vixDirection as 'Up' | 'Down' | null | undefined) ?? null;
          const vixPct = (ind.vixChangePercent as number | null | undefined) ?? null;
          const vixDirColor = vixDir === 'Up' ? 'text-red-500' : vixDir === 'Down' ? 'text-emerald-600' : 'text-zinc-400';
          const vixDirArrow = vixDir === 'Up' ? '↑' : vixDir === 'Down' ? '↓' : '→';
          return (
            <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
              <div className={`text-2xl font-bold mb-1 ${vixDirColor}`}>{vixDirArrow}</div>
              <p className={`text-base font-bold ${vixDirColor}`}>{vixDir ?? '—'}</p>
              {vixPct != null && (
                <p className={`text-[10px] font-mono mt-0.5 ${vixDirColor}`}>
                  {vixPct > 0 ? '+' : ''}{vixPct.toFixed(1)}%
                </p>
              )}
              <p className="text-[10px] mt-2 font-semibold uppercase tracking-wide" style={{ color: '#6b5840' }}>VIX Today</p>
            </div>
          );
        })()}

        {/* 4 — Top Mover Today */}
        {(() => {
          const topTicker = (ind as Record<string, unknown>).topMoverActualTop1 as string | null | undefined;
          const topChange = (ind as Record<string, unknown>).topMoverActualTop1
            ? ((ind as Record<string, unknown>).topMover as Record<string, unknown> | null)?.actualTopChange as number | null | undefined
            : null;
          const topColor = topChange != null ? (topChange >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-zinc-400';
          const topArrow = topChange != null ? (topChange >= 0 ? '↑' : '↓') : '';
          return (
            <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
              <div className="text-base mb-1">🚀</div>
              {topTicker ? (
                <>
                  <p className={`text-base font-bold font-mono ${topColor}`}>{topTicker}</p>
                  {topChange != null && (
                    <p className={`text-[10px] font-mono mt-0.5 font-semibold ${topColor}`}>
                      {topArrow} {topChange > 0 ? '+' : ''}{topChange.toFixed(1)}%
                    </p>
                  )}
                </>
              ) : (
                <p className="text-base font-bold text-zinc-400">—</p>
              )}
              <p className="text-[10px] mt-2 font-semibold uppercase tracking-wide" style={{ color: '#6b5840' }}>Top Mover</p>
            </div>
          );
        })()}

      </div>
    </div>
  );
}

// ─── PredictedGrid ────────────────────────────────────────────────────────────

function PredictedGrid({ predictions }: { predictions: TomorrowPredictions }) {
  const pred = predictions as Record<string, unknown> & TomorrowPredictions;

  // ── Detect new shape (has topMover) vs previous shape (spyDirection only) vs legacy (fearGreed) ──
  const isNewShape = 'topMover' in pred;
  const isPreviousShape = !isNewShape && 'spyDirection' in pred;

  // ── New shape fields ──
  const spyDirection = (isNewShape || isPreviousShape) ? (pred.spyDirection as string | undefined) : null;
  const spyChangePercent = isNewShape ? (pred.spyChangePercent as number | undefined) : null;
  const spyDirColor = spyDirection === 'Up' ? 'text-emerald-600' : spyDirection === 'Down' ? 'text-red-500' : 'text-zinc-400';
  const spyDirArrow = spyDirection === 'Up' ? '↑' : spyDirection === 'Down' ? '↓' : '→';
  const spyPctStr = spyChangePercent != null
    ? `${spyChangePercent > 0 ? '+' : ''}${spyChangePercent.toFixed(1)}%`
    : null;

  const vixDirection = (isNewShape || isPreviousShape) ? (pred.vixDirection as string | undefined) : null;
  const vixChangePercent = isNewShape ? (pred.vixChangePercent as number | undefined) : null;
  const vixColor = vixDirection === 'Up' ? 'text-red-500' : vixDirection === 'Down' ? 'text-emerald-600' : 'text-zinc-500';
  const vixArrow = vixDirection === 'Up' ? '↑' : vixDirection === 'Down' ? '↓' : '→';
  const vixPctStr = vixChangePercent != null
    ? `${vixChangePercent > 0 ? '+' : ''}${vixChangePercent.toFixed(1)}%`
    : null;

  const topMoverPred = isNewShape ? (pred.topMover as TomorrowPredictions['topMover'] | undefined) : null;
  const topMoverColor = topMoverPred?.direction === 'Up' ? 'text-emerald-600' : topMoverPred?.direction === 'Down' ? 'text-red-500' : 'text-zinc-400';
  const topMoverArrow = topMoverPred?.direction === 'Up' ? '↑' : topMoverPred?.direction === 'Down' ? '↓' : '';
  const topMoverPctStr = topMoverPred?.changePercent != null
    ? `${topMoverPred.changePercent > 0 ? '+' : ''}${topMoverPred.changePercent.toFixed(1)}%`
    : null;

  // ── Previous shape (spyDirection/sectorCategory/vixDirection, no topMover) ──
  const sectorCat = isPreviousShape ? (pred.sectorCategory as { category?: string; leaderTicker?: string } | undefined) : null;

  // ── Legacy shape fields (fearGreed / spyTrend / sectorRotation / optionsPulse) ──
  const isLegacy = !isNewShape && !isPreviousShape;
  const fg = isLegacy ? (pred.fearGreed as TomorrowPredictions['fearGreed'] | undefined) : undefined;
  const legacySpyTrend = isLegacy ? (pred.spyTrend as TomorrowPredictions['spyTrend'] | undefined) : undefined;
  const legacySector = isLegacy ? (pred.sectorRotation as TomorrowPredictions['sectorRotation'] | undefined) : undefined;
  const legacyOptions = isLegacy ? (pred.optionsPulse as TomorrowPredictions['optionsPulse'] | undefined) : undefined;

  const confidence = (pred.confidence as TomorrowPredictions['confidence']) ?? null;
  const signals = (pred.signals as string[] | undefined) ?? [];
  const confidenceBadge =
    confidence === 'High' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
    confidence === 'Moderate' ? 'bg-amber-50 border-amber-200 text-amber-700' :
    confidence === 'Low' ? 'bg-zinc-100 border-zinc-200 text-zinc-600' : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#b09060' }}>Predicted for Tomorrow</span>
        <span className="px-1.5 py-0.5 bg-violet-50 border border-violet-200 text-violet-700 text-[9px] rounded font-bold uppercase tracking-wide">
          Locked
        </span>
        {confidence && confidenceBadge && (
          <span className={`px-1.5 py-0.5 border text-[9px] rounded font-bold uppercase tracking-wide ${confidenceBadge}`}>
            {confidence} Conviction
          </span>
        )}
      </div>

      {isNewShape ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* 1 — SPY */}
          <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
            <div className={`text-2xl font-bold mb-1 ${spyDirColor}`}>{spyDirArrow}</div>
            <p className={`text-base font-bold ${spyDirColor}`}>{spyDirection ?? '—'}</p>
            {spyPctStr && (
              <p className={`text-[11px] font-mono mt-0.5 font-semibold ${spyDirColor}`}>{spyPctStr}</p>
            )}
            <p className="text-[9px] mt-1 font-semibold uppercase tracking-wide" style={{ color: '#b09060' }}>SPY Tomorrow</p>
          </div>

          {/* 2 — VIX */}
          <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
            <div className={`text-2xl font-bold mb-1 ${vixColor}`}>{vixArrow}</div>
            <p className={`text-sm font-bold ${vixColor}`}>{vixDirection ? `${vixDirection}` : '—'}</p>
            {vixPctStr && (
              <p className={`text-[11px] font-mono mt-0.5 font-semibold ${vixColor}`}>{vixPctStr}</p>
            )}
            <p className="text-[9px] mt-1 font-semibold uppercase tracking-wide" style={{ color: '#b09060' }}>VIX Tomorrow</p>
          </div>

          {/* 3 — Top Mover */}
          <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
            {topMoverPred ? (
              <>
                <p className={`text-base font-bold font-mono ${topMoverColor}`}>{topMoverPred.ticker}</p>
                <p className={`text-[11px] font-semibold mt-0.5 ${topMoverColor}`}>
                  {topMoverArrow} {topMoverPctStr ?? topMoverPred.direction}
                </p>
                {topMoverPred.name && (
                  <p className="text-[9px] mt-0.5 truncate" style={{ color: '#6b5840' }}>{topMoverPred.name}</p>
                )}
              </>
            ) : (
              <p className="text-sm font-bold text-zinc-400">—</p>
            )}
            <p className="text-[9px] mt-1 font-semibold uppercase tracking-wide" style={{ color: '#b09060' }}>Top Mover Pick</p>
          </div>
        </div>
      ) : isPreviousShape ? (
        /* Previous 3-indicator layout (spyDirection/sectorCategory/vixDirection) */
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
            <div className={`text-2xl font-bold mb-1 ${spyDirColor}`}>{spyDirArrow}</div>
            <p className={`text-base font-bold ${spyDirColor}`}>{spyDirection ?? '—'}</p>
            <p className="text-[9px] mt-1 font-semibold uppercase tracking-wide" style={{ color: '#b09060' }}>SPY Direction</p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
            <div className="text-base mb-1">🔄</div>
            <p className="text-sm font-bold text-violet-600">
              {sectorCat?.category ? sectorCat.category.charAt(0).toUpperCase() + sectorCat.category.slice(1) : '—'}
            </p>
            {sectorCat?.leaderTicker && (
              <p className="text-[10px] font-mono mt-0.5" style={{ color: '#6b5840' }}>{sectorCat.leaderTicker}</p>
            )}
            <p className="text-[9px] mt-1 font-semibold uppercase tracking-wide" style={{ color: '#b09060' }}>Sector Category</p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
            <div className={`text-2xl font-bold mb-1 ${vixColor}`}>{vixArrow}</div>
            <p className={`text-sm font-bold ${vixColor}`}>{vixDirection ?? '—'}</p>
            <p className="text-[9px] mt-1 font-semibold uppercase tracking-wide" style={{ color: '#b09060' }}>VIX Direction</p>
          </div>
        </div>
      ) : (
        /* Legacy 4-indicator layout */
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
            <p className="text-sm font-bold font-mono text-zinc-600">{fg?.score != null ? fg.score : '—'}</p>
            <p className="text-[9px] mt-1 font-semibold uppercase tracking-wide" style={{ color: '#b09060' }}>Fear & Greed</p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
            <p className={`text-sm font-bold font-mono ${legacySpyTrend?.direction === 'Up' ? 'text-emerald-600' : legacySpyTrend?.direction === 'Down' ? 'text-red-500' : 'text-zinc-400'}`}>
              {legacySpyTrend?.direction ?? '—'}
            </p>
            <p className="text-[9px] mt-1 font-semibold uppercase tracking-wide" style={{ color: '#b09060' }}>SPY Trend</p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
            <p className="text-[9px] font-bold font-mono text-emerald-600">{legacySector?.leader?.ticker ?? '—'}</p>
            <p className="text-[9px] mt-1 font-semibold uppercase tracking-wide" style={{ color: '#b09060' }}>Sector</p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-xl p-3 text-center">
            <p className="text-[9px] font-bold font-mono text-zinc-600">{legacyOptions?.lean ?? '—'}</p>
            <p className="text-[9px] mt-1 font-semibold uppercase tracking-wide" style={{ color: '#b09060' }}>Options</p>
          </div>
        </div>
      )}

      {signals.length > 0 && (
        <div className="mt-3 p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
          <p className="text-[9px] uppercase tracking-widest font-bold mb-2" style={{ color: '#b09060' }}>Quantitative Signals</p>
          <ul className="space-y-1">
            {signals.map((s, i) => (
              <li key={i} className="text-[10px] flex items-start gap-1.5" style={{ color: '#6b5840' }}>
                <span className="text-violet-600 mt-0.5 flex-shrink-0">›</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[10px] mt-2 text-center" style={{ color: '#b09060' }}>
        Big Story &amp; Next Catalyst are not predicted — reported live each day
      </p>
    </div>
  );
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
      <p className="text-sm" style={{ color: '#6b5840' }}>Loading market intelligence...</p>
    </div>
  );
}

// ─── Accuracy Calendar Heatmap ───────────────────────────────────────────────

interface HistoryDay {
  date: string;
  score: number;
  userCorrect: boolean | null;
  confidence?: string | null;
  isMisfire?: boolean;
}

function AccuracyCalendar({ days }: { days: HistoryDay[] }) {
  const [tooltip, setTooltip] = React.useState<HistoryDay | null>(null);

  // Build a map for O(1) lookup
  const map = React.useMemo(() => {
    const m: Record<string, HistoryDay> = {};
    for (const d of days) m[d.date] = d;
    return m;
  }, [days]);

  // Generate the last 90 calendar days ending today
  const cells = React.useMemo(() => {
    const result: { date: string; iso: string }[] = [];
    const now = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
      const display = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      result.push({ date: display, iso });
    }
    return result;
  }, []);

  // Group into weeks (rows of 7)
  const weeks: { date: string; iso: string }[][] = [];
  // Pad so grid starts on Sunday
  const firstDow = new Date(cells[0].iso).getDay(); // 0=Sun
  const padded: ({ date: string; iso: string } | null)[] = [
    ...Array(firstDow).fill(null),
    ...cells,
  ];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7) as { date: string; iso: string }[]);
  }

  const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  function cellColor(iso: string) {
    const d = map[iso];
    if (!d) return 'bg-zinc-100 border-zinc-200';
    if (d.score >= 75) return 'bg-emerald-400 border-emerald-300';
    if (d.score >= 55) return 'bg-amber-400 border-amber-300';
    return 'bg-red-400 border-red-300';
  }

  function isMisfireDay(iso: string) {
    return map[iso]?.isMisfire === true;
  }

  return (
    <div className="mt-4 pt-3 border-t border-zinc-200">
      <p className="text-[10px] uppercase tracking-widest font-bold mb-3" style={{ color: '#b09060' }}>
        90-Day Accuracy Calendar
      </p>

      {/* Day-of-week header */}
      <div className="flex gap-[3px] mb-1">
        {DOW_LABELS.map((l, i) => (
          <div key={i} className="w-5 text-center text-[8px] font-bold uppercase" style={{ color: '#b09060' }}>
            {l}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex flex-col gap-[3px]" onMouseLeave={() => setTooltip(null)}>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex gap-[3px]">
            {week.map((cell, di) => {
              if (!cell) return <div key={di} className="w-5 h-5" />;
              const d = map[cell.iso];
              return (
                <div
                  key={di}
                  className={`relative w-5 h-5 rounded-sm border cursor-default transition-opacity hover:opacity-80 ${cellColor(cell.iso)}`}
                  onMouseEnter={() => setTooltip(d ?? null)}
                >
                  {isMisfireDay(cell.iso) && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400 border border-black text-[6px] flex items-center justify-center font-bold text-black leading-none">!</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="mt-2 bg-white border border-zinc-200 rounded-lg p-2 text-xs" style={{ color: '#1a1008' }}>
          <p className="font-semibold" style={{ color: '#1a1008' }}>{tooltip.date}</p>
          <p className="mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: '#6b5840' }}>
            <span>Model: <span className={tooltip.score >= 75 ? 'text-emerald-600' : tooltip.score >= 55 ? 'text-amber-600' : 'text-red-500'}>{tooltip.score}%</span></span>
            {tooltip.confidence && <span style={{ color: '#b09060' }}>{tooltip.confidence} Conviction</span>}
            {tooltip.isMisfire && <span className="text-orange-500 font-bold">⚠ Misfire</span>}
            {tooltip.userCorrect != null && (
              <span>You: {tooltip.userCorrect ? <span className="text-emerald-600">✓</span> : <span className="text-red-500">✗</span>}</span>
            )}
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        {[
          { color: 'bg-emerald-400', label: '≥75%' },
          { color: 'bg-amber-400', label: '55–74%' },
          { color: 'bg-red-400', label: '<55%' },
          { color: 'bg-zinc-100', label: 'No data' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm border border-zinc-300 ${color}`} />
            <span className="text-[9px]" style={{ color: '#b09060' }}>{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-orange-400 flex items-center justify-center text-[6px] font-bold text-white">!</span>
          <span className="text-[9px]" style={{ color: '#b09060' }}>High Conviction Misfire</span>
        </div>
      </div>
    </div>
  );
}

// ─── Weekly Accuracy Sparkline ────────────────────────────────────────────────

// ─── Yesterday Card ───────────────────────────────────────────────────────────

function YesterdayCard({
  record,
  todayRecord,
  rollingAccuracy,
  historyDays,
}: {
  record: DailyMarketRecord | null | undefined;
  todayRecord?: DailyMarketRecord;
  rollingAccuracy?: RollingAccuracy;
  historyDays?: HistoryDay[];
}) {
  if (!record || !record.tomorrowPredictions) {
    return (
      <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center">
        <Lock className="w-6 h-6 text-zinc-300 mx-auto mb-2" />
        <p className="text-sm font-semibold" style={{ color: '#6b5840' }}>No prediction on record yet</p>
        <p className="text-xs mt-1" style={{ color: '#b09060' }}>Yesterday&apos;s call will appear here after the first noon lock completes.</p>
      </div>
    );
  }

  const lockedAt = record.noonLockedAt
    ? new Date(record.noonLockedAt).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      })
    : null;

  const pred = record.tomorrowPredictions;
  const actual = todayRecord?.elite6Actual;
  const breakdown = record.accuracyBreakdown as Record<string, number> | null;

  // Detect shape: new (topMover), previous (spyDirection/sectorCategory), legacy (fearGreed)
  const isNewPredShape = pred != null && 'topMover' in (pred as Record<string, unknown>);
  const isPreviousPredShape = !isNewPredShape && pred != null && 'spyDirection' in (pred as Record<string, unknown>);

  // Helper to get icon and color from a score
  function scoreIcon(score: number | null | undefined) {
    if (score == null) return { icon: '—', color: 'text-slate-500' };
    if (score >= 70) return { icon: '✓', color: 'text-emerald-400' };
    if (score >= 40) return { icon: '≈', color: 'text-amber-400' };
    return { icon: '✗', color: 'text-red-400' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const predAny = pred as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actualAny = actual as any;

  // New model: SPY, VIX, Top Mover
  const newIndicators = isNewPredShape ? [
    {
      key: 'spy',
      label: 'SPY',
      predicted: predAny?.spyDirection
        ? `${predAny.spyDirection}${predAny.spyChangePercent != null ? ` ${predAny.spyChangePercent > 0 ? '+' : ''}${Number(predAny.spyChangePercent).toFixed(1)}%` : ''}`
        : '—',
      actual: actualAny?.spyDirection
        ? `${actualAny.spyDirection}${actualAny.spyChangePercent != null ? ` ${actualAny.spyChangePercent > 0 ? '+' : ''}${Number(actualAny.spyChangePercent).toFixed(1)}%` : ''}`
        : '—',
    },
    {
      key: 'vix',
      label: 'VIX',
      predicted: predAny?.vixDirection
        ? `${predAny.vixDirection}${predAny.vixChangePercent != null ? ` ${predAny.vixChangePercent > 0 ? '+' : ''}${Number(predAny.vixChangePercent).toFixed(1)}%` : ''}`
        : '—',
      actual: actualAny?.vixDirection
        ? `${actualAny.vixDirection}${actualAny.vixChangePercent != null ? ` ${actualAny.vixChangePercent > 0 ? '+' : ''}${Number(actualAny.vixChangePercent).toFixed(1)}%` : ''}`
        : '—',
    },
    {
      key: 'topMover',
      label: 'Top Mover',
      predicted: predAny?.topMover?.ticker
        ? `${predAny.topMover.ticker} ${predAny.topMover.direction} ${predAny.topMover.changePercent != null ? `${predAny.topMover.changePercent > 0 ? '+' : ''}${Number(predAny.topMover.changePercent).toFixed(1)}%` : ''}`
        : '—',
      actual: actualAny?.topMover?.predictedTickerChange != null
        ? `${predAny?.topMover?.ticker ?? '?'} actual: ${actualAny.topMover.predictedTickerChange > 0 ? '+' : ''}${Number(actualAny.topMover.predictedTickerChange).toFixed(1)}%${actualAny.topMover.predictedTickerWasTop3 ? ' (top 3)' : ''}`
        : '—',
    },
  ] : null;

  // Previous model: spyDirection/sectorCategory/vixDirection
  const previousIndicators = isPreviousPredShape ? [
    {
      key: 'spyDirection',
      label: 'SPY Direction',
      predicted: predAny?.spyDirection ?? '—',
      actual: actualAny?.spyDirection ?? '—',
    },
    {
      key: 'sectorCategory',
      label: 'Sector Category',
      predicted: predAny?.sectorCategory?.leaderTicker
        ? `${predAny.sectorCategory.category} / ${predAny.sectorCategory.leaderTicker}`
        : '—',
      actual: actualAny?.sectorCategory?.leaderTicker
        ? `${actualAny.sectorCategory.category} / ${actualAny.sectorCategory.leaderTicker}`
        : '—',
    },
    {
      key: 'vixDirection',
      label: 'VIX Direction',
      predicted: predAny?.vixDirection ?? '—',
      actual: actualAny?.vixDirection ?? '—',
    },
  ] : null;

  const legacyIndicators = (!isNewPredShape && !isPreviousPredShape) ? [
    {
      key: 'fearGreed',
      label: 'Fear & Greed',
      predicted: predAny?.fearGreed?.score != null ? String(predAny.fearGreed.score) : '—',
      actual: actualAny?.fearGreed?.score != null ? String(actualAny.fearGreed.score) : '—',
    },
    {
      key: 'spyTrend',
      label: 'SPY Trend',
      predicted: predAny?.spyTrend?.direction ?? '—',
      actual: actualAny?.spyTrend?.direction ?? '—',
    },
    {
      key: 'sectorRotation',
      label: 'Sector Leader',
      predicted: predAny?.sectorRotation?.leader?.ticker ?? '—',
      actual: actualAny?.sectorRotation?.leader?.ticker ?? '—',
    },
    {
      key: 'optionsPulse',
      label: 'Options Pulse',
      predicted: predAny?.optionsPulse?.lean ?? '—',
      actual: actualAny?.optionsPulse?.lean ?? '—',
    },
  ] : null;

  const indicators = newIndicators ?? previousIndicators ?? legacyIndicators ?? [];

  return (
    <div className="space-y-4">
      {/* Proof-of-lock header */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-[10px] text-blue-600 font-bold uppercase tracking-widest">
            Yesterday&apos;s Call · {record.recordDate}
          </span>
        </div>
        <p className="font-semibold text-sm" style={{ color: '#1a1008' }}>What we predicted for today</p>
        {lockedAt && (
          <p className="text-xs mt-1" style={{ color: '#b09060' }}>
            🔒 Locked {lockedAt} · immutable record
          </p>
        )}
      </div>

      {/* AI recap brief */}
      {record.accuracyBrief ? (
        <div className="bg-white border border-blue-100 rounded-2xl p-5">
          <p className="text-[10px] text-blue-600 uppercase tracking-widest font-bold mb-2">What Happened</p>
          <p className="text-sm leading-relaxed" style={{ color: '#1a1008' }}>{record.accuracyBrief}</p>
        </div>
      ) : record.accuracyScore != null ? null : (
        <div className="bg-white border border-blue-100 rounded-2xl p-5">
          <p className="text-[10px] text-blue-600 uppercase tracking-widest font-bold mb-1">What Happened</p>
          <p className="text-xs" style={{ color: '#b09060' }}>Recap generated after market close.</p>
        </div>
      )}

      {/* How did we do — comparison table */}
      <div className="bg-white border border-blue-100 rounded-2xl p-5">
        <p className="text-[10px] text-blue-600 uppercase tracking-widest font-bold mb-3">How Did We Do?</p>
        {(isPreviousPredShape || (!isNewPredShape && !isPreviousPredShape)) && (
          <div className="mb-3 p-2 bg-zinc-50 border border-zinc-200 rounded-lg">
            <p className="text-[10px] text-zinc-500 text-center">Legacy prediction — scored under previous model</p>
          </div>
        )}
        <div className="space-y-2">
          {indicators.map(({ key, label, predicted, actual: act }) => {
            const { icon, color } = scoreIcon(breakdown?.[key] as number | null | undefined);
            return (
              <div key={key} className="flex items-center gap-3 py-2 border-b border-zinc-100 last:border-0">
                <span className="text-[10px] w-24 flex-shrink-0 font-semibold" style={{ color: '#b09060' }}>{label}</span>
                <span className="text-[10px] font-mono flex-1" style={{ color: '#1a1008' }}>
                  <span style={{ color: '#b09060' }}>Predicted:</span> {predicted}
                </span>
                <span className="text-[10px]" style={{ color: '#b09060' }}>→</span>
                <span className="text-[10px] font-mono flex-1" style={{ color: '#1a1008' }}>
                  <span style={{ color: '#b09060' }}>Actual:</span> {act}
                </span>
                <span className={`text-sm font-bold w-4 text-center ${color}`}>{icon}</span>
                {breakdown?.[key] != null && (
                  <span className={`text-[9px] font-mono w-8 text-right ${color}`}>
                    {Number(breakdown[key]).toFixed(0)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {record.accuracyScore == null && (
          <p className="text-[10px] mt-3 text-center" style={{ color: '#b09060' }}>
            Accuracy scoring pending — calculated when today&apos;s data is confirmed
          </p>
        )}

        {/* Rolling accuracy */}
        {rollingAccuracy && rollingAccuracy.daysScored > 0 && (
          <div className="mt-4 pt-3 border-t border-zinc-200">
            <p className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color: '#b09060' }}>
              Rolling Accuracy (last {rollingAccuracy.daysScored} days)
            </p>
            {/* Support new (spy/vix/topMover), previous (spyDirection/sectorCategory/vixDirection), and legacy rolling accuracy shapes */}
            {(() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const ra = rollingAccuracy as any;
              const isNewRolling = ra.spy != null || ra.vix != null || ra.topMover != null;
              const isPrevRolling = !isNewRolling && (ra.spyDirection != null || ra.sectorCategory != null);
              const cols = isNewRolling
                ? [
                    { label: 'SPY', value: ra.spy as number | null },
                    { label: 'VIX', value: ra.vix as number | null },
                    { label: 'Top Mover', value: ra.topMover as number | null },
                  ]
                : isPrevRolling
                ? [
                    { label: 'SPY Dir', value: ra.spyDirection as number | null },
                    { label: 'Sector', value: ra.sectorCategory as number | null },
                    { label: 'VIX', value: ra.vixDirection as number | null },
                  ]
                : [
                    { label: 'F&G', value: ra.fearGreed as number | null },
                    { label: 'SPY', value: ra.spyTrend as number | null },
                    { label: 'Sector', value: ra.sectorRotation as number | null },
                    { label: 'Options', value: ra.optionsPulse as number | null },
                  ];
              return (
            <div className={`grid gap-2 grid-cols-${cols.length}`}>
              {cols.map(({ label, value }) => {
                const pctColor = value == null ? 'text-zinc-300' :
                  value >= 70 ? 'text-emerald-600' :
                  value >= 50 ? 'text-amber-600' : 'text-red-500';
                return (
                  <div key={label} className="text-center">
                    <p className={`text-sm font-bold font-mono ${pctColor}`}>
                      {value != null ? `${value}%` : 'N/A'}
                    </p>
                    <p className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: '#b09060' }}>{label}</p>
                  </div>
                );
              })}
            </div>
              );
            })()}

          </div>
        )}

        {historyDays && historyDays.length > 0 && (
          <AccuracyCalendar days={historyDays} />
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
    sunny: 'bg-amber-50 border-amber-200 text-amber-700',
    overcast: 'bg-zinc-100 border-zinc-200 text-zinc-600',
    stormy: 'bg-red-50 border-red-200 text-red-700',
  };

  return (
    <div className="space-y-4">
      {/* Live status + weather */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 bg-white border border-amber-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[10px] text-amber-700 font-bold uppercase tracking-widest">
              Live Pulse · Today
            </span>
            {isStale && (
              <span className="flex items-center gap-1 text-[9px] text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">
                <AlertCircle className="w-3 h-3" />
                Data may be stale
              </span>
            )}
          </div>
          <p className="text-xs" style={{ color: '#6b5840' }}>
            {record.recordDate} · Auto-refreshes every 20 minutes
          </p>
        </div>

        {record.weather && (
          <div
            className={`flex items-center gap-3 border rounded-2xl p-5 ${
              weatherColors[record.weather.condition] ??
              'bg-zinc-100 border-zinc-200 text-zinc-600'
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
        <div className="bg-white border border-zinc-200 rounded-2xl p-5">
          <Elite6Grid indicators={record.elite6Actual} variant="actual" />
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center">
          <Loader2 className="w-6 h-6 text-violet-500 animate-spin mx-auto mb-2" />
          <p className="text-sm" style={{ color: '#6b5840' }}>Generating live analysis...</p>
        </div>
      )}

      {/* Brief bullets */}
      {record.briefBullets && record.briefBullets.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-5">
          <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: '#1a1008' }}>
            Daily Brief
          </p>
          <div className="space-y-3">
            {record.briefBullets.map((bullet, i) => (
              <div key={i} className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 text-[10px] font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="border-l-2 border-zinc-300 pl-3">
                    <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#6b5840' }}>What Happened</p>
                    <p className="text-sm font-semibold leading-snug" style={{ color: '#1a1008' }}>{bullet.what}</p>
                  </div>
                  <div className="border-l-2 border-blue-300 pl-3">
                    <p className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-1.5">Why Did it Happen</p>
                    <p className="text-sm leading-relaxed" style={{ color: '#1a1008' }}>{bullet.why}</p>
                  </div>
                  <div className="border-l-2 border-amber-400 pl-3">
                    <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1.5">Impact on Investments</p>
                    <p className="text-sm leading-relaxed" style={{ color: '#1a1008' }}>{bullet.impact}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live headlines */}
      {record.liveHeadlines && record.liveHeadlines.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#b09060' }}>
            Live Headlines
          </p>
          <div className="space-y-2">
            {[...record.liveHeadlines]
              .sort((a, b) => b.impactScore - a.impactScore)
              .map((headline, i) => {
                const impactColor =
                  headline.impactScore >= 9
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : headline.impactScore >= 7
                    ? 'bg-orange-100 text-orange-700 border-orange-200'
                    : 'bg-amber-100 text-amber-700 border-amber-200';
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 bg-zinc-50 rounded-xl border border-zinc-200"
                  >
                    <span
                      className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${impactColor}`}
                    >
                      {headline.impactScore}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="text-[9px] bg-zinc-100 px-1.5 py-0.5 rounded font-semibold" style={{ color: '#6b5840' }}>
                          {headline.source}
                        </span>
                        <span className="text-[9px] bg-zinc-50 px-1.5 py-0.5 rounded" style={{ color: '#b09060' }}>
                          {headline.category}
                        </span>
                      </div>
                      <p className="text-xs font-medium leading-snug" style={{ color: '#1a1008' }}>{headline.headline}</p>
                      {headline.impact && (
                        <p className="text-[10px] leading-snug mt-1" style={{ color: '#b09060' }}>{headline.impact}</p>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Daily Edge Board */}
      {record.edgeBoard && (
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm" style={{ color: '#1a1008' }}>Daily Edge Board</h3>
              <p className="text-xs mt-0.5" style={{ color: '#b09060' }}>Statistical edge &amp; assets to avoid today</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEdgeBoardView('top')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${edgeBoardView === 'top' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'hover:text-zinc-700'}`}
                style={edgeBoardView !== 'top' ? { color: '#b09060' } : {}}
              >▲ Top 5</button>
              <button
                onClick={() => setEdgeBoardView('bottom')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${edgeBoardView === 'bottom' ? 'bg-red-50 text-red-700 border border-red-200' : 'hover:text-zinc-700'}`}
                style={edgeBoardView !== 'bottom' ? { color: '#b09060' } : {}}
              >▼ Bottom 5</button>
            </div>
          </div>
          <div className="divide-y divide-zinc-100">
            {(edgeBoardView === 'top' ? record.edgeBoard.top5 : record.edgeBoard.bottom5).map((asset, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-50 transition-colors">
                <span className="text-xs font-bold w-4" style={{ color: '#b09060' }}>{asset.rank}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono font-bold text-sm" style={{ color: '#1a1008' }}>{asset.ticker}</span>
                    <span className="text-xs truncate" style={{ color: '#6b5840' }}>{asset.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 rounded" style={{ color: '#b09060' }}>{asset.sector}</span>
                  </div>
                  <p className="text-xs" style={{ color: '#b09060' }}>{asset.edge}</p>
                </div>
                <span className={`font-mono font-bold text-sm flex-shrink-0 ${
                  asset.change.startsWith('+') ? 'text-emerald-600' : asset.change.startsWith('-') ? 'text-red-500' : 'text-zinc-400'
                }`}>{asset.change}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's Positioning */}
      {record.positioning && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-4" style={{ color: '#1a1008' }}>Today&apos;s Positioning</h3>
          <div className="space-y-3">
            {record.positioning.overweight.map((p, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide mt-0.5 w-20 flex-shrink-0">Overweight</span>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm" style={{ color: '#1a1008' }}>{p.asset}</span>
                  <span className="font-mono text-xs ml-2" style={{ color: '#6b5840' }}>{p.ticker}</span>
                  <p className="text-xs mt-0.5" style={{ color: '#6b5840' }}>{p.rationale}</p>
                </div>
              </div>
            ))}
            {record.positioning.neutral.map((p, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mt-0.5 w-20 flex-shrink-0">Neutral</span>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm" style={{ color: '#1a1008' }}>{p.asset}</span>
                  <span className="font-mono text-xs ml-2" style={{ color: '#6b5840' }}>{p.ticker}</span>
                  <p className="text-xs mt-0.5" style={{ color: '#6b5840' }}>{p.rationale}</p>
                </div>
              </div>
            ))}
            {record.positioning.underweight.map((p, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
                <span className="text-[10px] font-bold text-red-700 uppercase tracking-wide mt-0.5 w-20 flex-shrink-0">Underweight</span>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm" style={{ color: '#1a1008' }}>{p.asset}</span>
                  <span className="font-mono text-xs ml-2" style={{ color: '#6b5840' }}>{p.ticker}</span>
                  <p className="text-xs mt-0.5" style={{ color: '#6b5840' }}>{p.rationale}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outlier + Catalyst */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {record.outlier && (
          <div className="bg-white border border-amber-200 rounded-2xl p-4">
            <p className="text-[10px] text-amber-700 uppercase tracking-widest font-bold mb-1">
              Outlier
            </p>
            <p className="text-sm leading-relaxed" style={{ color: '#1a1008' }}>{record.outlier}</p>
          </div>
        )}
        {record.catalyst && (
          <div className="bg-white border border-violet-200 rounded-2xl p-4">
            <p className="text-[10px] text-violet-700 uppercase tracking-widest font-bold mb-1">
              #1 Catalyst to Watch
            </p>
            <p className="text-sm leading-relaxed" style={{ color: '#1a1008' }}>{record.catalyst}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tomorrow Card ────────────────────────────────────────────────────────────

function TomorrowCard({
  record,
}: {
  record: DailyMarketRecord;
}) {
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
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-violet-50 border-violet-200'
        }`}
      >
        <div className="flex items-center gap-3 mb-2">
          <Lock
            className={`w-4 h-4 ${
              record.isNoonLocked ? 'text-emerald-600' : 'text-violet-600'
            }`}
          />
          <span
            className={`text-xs font-bold uppercase tracking-widest ${
              record.isNoonLocked ? 'text-emerald-700' : 'text-violet-700'
            }`}
          >
            {record.isNoonLocked ? 'Noon Lock Active' : 'Pre-Lock · Tomorrow Outlook'}
          </span>
        </div>

        {record.isNoonLocked ? (
          <p className="text-xs" style={{ color: '#6b5840' }}>
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
          <p className="text-xs" style={{ color: '#6b5840' }}>
            Predictions will be locked at 12:00 PM ET today.
            {timeToNoon && (
              <span className="text-violet-600 font-semibold ml-1">
                ({timeToNoon} remaining)
              </span>
            )}
          </p>
        )}
      </div>

      {/* Predictions */}
      {record.tomorrowPredictions ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-5">
          <PredictedGrid predictions={record.tomorrowPredictions} />
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center">
          <Lock className="w-6 h-6 text-zinc-300 mx-auto mb-2" />
          <p className="text-sm" style={{ color: '#b09060' }}>
            Predictions will be generated and locked at noon ET.
          </p>
        </div>
      )}

      {/* Next Catalyst from today's live data */}
      {record.elite6Actual?.nextCatalyst && (
        <div className="bg-white border border-amber-200 rounded-2xl p-5">
          <p className="text-[10px] text-amber-700 uppercase tracking-widest font-bold mb-2">Next Catalyst (Live)</p>
          <div className="flex items-start gap-3">
            <span className="text-amber-700 font-mono text-xs font-bold flex-shrink-0">
              {record.elite6Actual.nextCatalyst.time}
            </span>
            <div>
              <p className="text-sm font-semibold" style={{ color: '#1a1008' }}>{record.elite6Actual.nextCatalyst.event}</p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: '#6b5840' }}>{record.elite6Actual.nextCatalyst.implication}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tomorrow outlook narrative */}
      {record.tomorrowOutlook && (
        <div className="bg-white border border-violet-200 rounded-2xl p-5">
          <p className="text-[10px] text-violet-700 uppercase tracking-widest font-bold mb-2">
            Tomorrow&apos;s Outlook
          </p>
          <p className="text-sm leading-relaxed" style={{ color: '#1a1008' }}>{record.tomorrowOutlook}</p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="flex items-start gap-2 p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#b09060' }} />
        <p className="text-[11px] leading-relaxed" style={{ color: '#b09060' }}>
          These predictions are locked at noon ET and scored against tomorrow&apos;s actuals. Past
          accuracy scores are shown in the Yesterday card.
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TripleCardMarket(_props: TripleCardMarketProps) {
  const [activeCard, setActiveCard] = useState(1); // 0=Yesterday, 1=Today, 2=Tomorrow
  const [data, setData] = useState<TripleCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [historyDays, setHistoryDays] = useState<HistoryDay[]>([]);

  const triggerBackgroundRefresh = useCallback(async () => {
    setBackgroundRefreshing(true);
    try {
      const res = await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refreshLive' }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data as TripleCardData);
      }
    } catch {
      // Non-critical — stale data remains displayed
    } finally {
      setBackgroundRefreshing(false);
    }
  }, []);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tripleCard' }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load triple card data');
      setData(json.data as TripleCardData);
      // If data is stale, kick off background refresh without blocking the UI
      if (json.data.needsRefresh) {
        void triggerBackgroundRefresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load market data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [triggerBackgroundRefresh]);

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

  // Lazy-load history when Yesterday tab is opened
  useEffect(() => {
    if (activeCard !== 0 || historyDays.length > 0) return;
    fetch('/api/market', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'history' }),
    })
      .then(r => r.json())
      .then(json => { if (json.success) setHistoryDays(json.data); })
      .catch(() => {});
  }, [activeCard, historyDays.length]);

  const handleRefresh = () => loadData(true);



  const CARDS = [
    {
      label: "Yesterday's Call",
      sublabel: 'Did we nail our prediction?',
      icon: '📋',
      activeColor: 'text-blue-700 bg-blue-50 border-blue-300',
      inactiveColor: 'bg-white border-zinc-200',
    },
    {
      label: 'Live Pulse',
      sublabel: 'Right now',
      icon: '⚡',
      activeColor: 'text-amber-700 bg-amber-50 border-amber-300',
      inactiveColor: 'bg-white border-zinc-200',
    },
    {
      label: "Tomorrow's Call",
      sublabel: 'Our prediction',
      icon: '🔮',
      activeColor: 'text-violet-700 bg-violet-50 border-violet-300',
      inactiveColor: 'bg-white border-zinc-200',
    },
  ];

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ background: '#faf8f3' }}
    >
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#1a1008' }}>Market Analysis</h1>
            <p className="text-xs mt-0.5" style={{ color: '#b09060' }}>
              Triple-Card Intelligence System · Noon Lock Active
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data?.today.isNoonLocked ? (
              <span className="px-2 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-lg font-semibold">
                🔒 Noon Locked
              </span>
            ) : (
              <span className="px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg font-semibold">
                ⏳ Pre-Lock
              </span>
            )}
            {backgroundRefreshing && (
              <span className="text-xs flex items-center gap-1" style={{ color: '#b09060' }}>
                <RefreshCw className="w-3 h-3 animate-spin" /> Updating...
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing || backgroundRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-zinc-50 border border-zinc-200 rounded-lg text-xs font-semibold transition-all"
              style={{ color: '#6b5840' }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Card Navigation */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setActiveCard(Math.max(0, activeCard - 1))}
            disabled={activeCard === 0}
            className="w-9 h-9 rounded-full bg-white hover:bg-zinc-50 border border-zinc-200 flex items-center justify-center disabled:opacity-30 transition-all"
            style={{ color: '#6b5840' }}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex gap-2">
            {CARDS.map((card, i) => (
              <button
                key={i}
                onClick={() => setActiveCard(i)}
                style={activeCard !== i ? { color: '#6b5840' } : {}}
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
            className="w-9 h-9 rounded-full bg-white hover:bg-zinc-50 border border-zinc-200 flex items-center justify-center disabled:opacity-30 transition-all"
            style={{ color: '#6b5840' }}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Active Card Content */}
        {loading ? (
          <LoadingState />
        ) : (
          <>
            {activeCard === 0 && <YesterdayCard record={data?.yesterday} todayRecord={data?.today} rollingAccuracy={data?.rollingAccuracy} historyDays={historyDays} />}
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
