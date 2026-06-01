'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, Loader2, Lock, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
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
    fgLabel === 'Extreme Fear' ? 'text-red-400' :
    fgLabel === 'Fear' ? 'text-orange-400' :
    fgLabel === 'Neutral' ? 'text-slate-300' :
    fgLabel === 'Greed' ? 'text-emerald-400' :
    fgLabel === 'Extreme Greed' ? 'text-green-300' : 'text-slate-500';
  const deltaColor = fgDelta > 0 ? 'text-emerald-400' : fgDelta < 0 ? 'text-red-400' : 'text-slate-500';

  // ── SPY Trend ──
  const spyTrend = ind.spyTrend as DailyIndicators['spyTrend'] | undefined;
  const spyPct = spyTrend?.changePercent ?? null;
  // Choppy/sideways if move is less than 0.3% either way
  const spyMoveType = spyPct == null ? null : spyPct > 0.3 ? 'Up' : spyPct < -0.3 ? 'Down' : 'Sideways';
  const spyArrow = spyMoveType === 'Up' ? '↑' : spyMoveType === 'Down' ? '↓' : '→';
  const spyArrowColor = spyMoveType === 'Up' ? 'text-emerald-400' : spyMoveType === 'Down' ? 'text-red-400' : 'text-slate-400';
  const spyMoveLabel = spyMoveType === 'Sideways' ? 'Choppy' : (spyMoveType ?? '—');
  const spyPctStr = spyPct != null ? `${spyPct > 0 ? '+' : ''}${spyPct}% today` : '—';

  // ── Sector Rotation ──
  const sectorRot = ind.sectorRotation as DailyIndicators['sectorRotation'] | undefined;

  // ── Options Pulse ──
  const optPulse = ind.optionsPulse as DailyIndicators['optionsPulse'] | undefined;
  const pcRatio = optPulse?.putCallRatio ?? null;
  const pcLean = optPulse?.lean ?? null;
  const pcColor = pcRatio != null
    ? (pcRatio < 0.65 ? 'text-emerald-400' : pcRatio >= 0.9 ? 'text-red-400' : 'text-slate-300')
    : 'text-slate-500';
  const leanBadge = pcLean === 'Bullish'
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    : pcLean === 'Bearish'
    ? 'bg-red-500/20 text-red-300 border-red-500/30'
    : 'bg-slate-500/20 text-slate-300 border-slate-500/30';

  // ── Next Catalyst ──

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
          Market Intelligence
        </span>
        {variant === 'predicted' && (
          <span className="px-1.5 py-0.5 bg-violet-500/15 border border-violet-500/30 text-violet-400 text-[9px] rounded font-bold uppercase tracking-wide">
            Predicted
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">

        {/* 1 — Market Sentiment (Fear & Greed) */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">{fgEmoji}</div>
          <p className={`text-base font-bold ${fgColor}`}>{fgLabel ?? '—'}</p>
          <p className="text-slate-400 text-[10px] font-mono mt-0.5">{fg?.score != null ? `${fg.score} / 100` : '—'}</p>
          <p className={`text-[10px] font-bold mt-0.5 ${deltaColor}`}>
            {fgDelta !== 0 ? (fgDelta > 0 ? `↑${fgDelta} today` : `↓${Math.abs(fgDelta)} today`) : '→ flat'}
          </p>
          <p className="text-slate-300 text-[10px] mt-2 font-semibold uppercase tracking-wide">Fear & Greed</p>
        </div>

        {/* 2 — S&P 500 Today */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className={`text-2xl font-bold mb-1 ${spyArrowColor}`}>{spyArrow}</div>
          <p className={`text-base font-bold ${spyArrowColor}`}>{spyMoveLabel}</p>
          <p className={`text-[10px] font-mono mt-0.5 ${spyArrowColor}`}>{spyPctStr}</p>
          <div className="flex justify-center gap-1 mt-1.5">
            <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded ${spyTrend?.above200MA ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
              200MA {spyTrend?.above200MA ? '✓' : '✗'}
            </span>
            <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded ${spyTrend?.above50MA ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
              50MA {spyTrend?.above50MA ? '✓' : '✗'}
            </span>
          </div>
          {spyTrend?.volumeRatio != null && (
            <p className={`text-[9px] font-semibold mt-1 ${
              spyTrend.volumeRatio >= 1.5 ? 'text-amber-400' :
              spyTrend.volumeRatio <= 0.7 ? 'text-slate-500' : 'text-slate-400'
            }`}>
              {spyTrend.volumeRatio}x avg vol
            </p>
          )}
          <p className="text-slate-300 text-[10px] mt-2 font-semibold uppercase tracking-wide">S&P 500 Today</p>
        </div>

        {/* 3 — Sector Leaders */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">🔄</div>
          <div className="flex items-center justify-center gap-1 mt-0.5">
            <span className="text-emerald-400 text-[10px] font-bold font-mono">↑</span>
            <p className="text-[10px] font-bold font-mono text-emerald-400 leading-tight">
              {sectorRot?.leader?.ticker ?? '—'} <span className="opacity-80">{sectorRot?.leader?.performance ?? ''}</span>
            </p>
          </div>
          <div className="flex items-center justify-center gap-1 mt-1">
            <span className="text-red-400 text-[10px] font-bold font-mono">↓</span>
            <p className="text-[10px] font-bold font-mono text-red-400 leading-tight">
              {sectorRot?.lagger?.ticker ?? '—'} <span className="opacity-80">{sectorRot?.lagger?.performance ?? ''}</span>
            </p>
          </div>
          <p className="text-slate-300 text-[10px] mt-2 font-semibold uppercase tracking-wide">Sector Leaders</p>
        </div>

        {/* 4 — Options Flow */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">📊</div>
          <p className={`text-base font-bold font-mono ${pcColor}`}>{pcRatio != null ? pcRatio.toFixed(2) : '—'}</p>
          <p className="text-slate-400 text-[9px] mt-0.5">SPY put / call ratio</p>
          {pcLean && (
            <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border mt-1 ${leanBadge}`}>
              {pcLean}
            </span>
          )}
          <p className="text-slate-300 text-[10px] mt-2 font-semibold uppercase tracking-wide">Options Flow</p>
        </div>

      </div>
    </div>
  );
}

// ─── PredictedGrid ────────────────────────────────────────────────────────────

function PredictedGrid({ predictions }: { predictions: TomorrowPredictions }) {
  const pred = predictions as Record<string, unknown> & TomorrowPredictions;

  // ── Fear & Greed ──
  const fg = pred.fearGreed as TomorrowPredictions['fearGreed'] | undefined;
  const fgLabel = fg?.label ?? null;
  const fgDelta = fg?.delta ?? 0;
  const fgEmoji =
    fgLabel === 'Extreme Fear' ? '😱' : fgLabel === 'Fear' ? '😨' :
    fgLabel === 'Neutral' ? '😐' : fgLabel === 'Greed' ? '😀' :
    fgLabel === 'Extreme Greed' ? '🤑' : '⏳';
  const fgColor =
    fgLabel === 'Extreme Fear' ? 'text-red-400' : fgLabel === 'Fear' ? 'text-orange-400' :
    fgLabel === 'Neutral' ? 'text-slate-300' : fgLabel === 'Greed' ? 'text-emerald-400' :
    fgLabel === 'Extreme Greed' ? 'text-green-300' : 'text-slate-500';
  const deltaColor = fgDelta > 0 ? 'text-emerald-400' : fgDelta < 0 ? 'text-red-400' : 'text-slate-500';

  // ── SPY Trend ──
  const spyTrend = pred.spyTrend as TomorrowPredictions['spyTrend'] | undefined;
  const spyDir = spyTrend?.direction ?? null;
  const spyEmoji = spyDir === 'Up' ? '↑' : spyDir === 'Down' ? '↓' : '→';
  const spyColor = spyDir === 'Up' ? 'text-emerald-400' : spyDir === 'Down' ? 'text-red-400' : 'text-slate-400';
  const spyPct = spyTrend?.changePercent ?? null;
  const spyPctStr = spyPct != null ? `${spyPct > 0 ? '+' : ''}${spyPct}%` : '—';

  // ── Sector Rotation ──
  const sectorRot = pred.sectorRotation as TomorrowPredictions['sectorRotation'] | undefined;

  // ── Options Pulse ──
  const optPulse = pred.optionsPulse as TomorrowPredictions['optionsPulse'] | undefined;
  const pcRatio = optPulse?.putCallRatio ?? null;
  const pcLean = optPulse?.lean ?? null;
  const pcColor = pcRatio != null
    ? (pcRatio < 0.65 ? 'text-emerald-400' : pcRatio >= 0.9 ? 'text-red-400' : 'text-slate-300')
    : 'text-slate-500';
  const leanBadge = pcLean === 'Bullish'
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    : pcLean === 'Bearish'
    ? 'bg-red-500/20 text-red-300 border-red-500/30'
    : 'bg-slate-500/20 text-slate-300 border-slate-500/30';

  const confidence = (pred.confidence as TomorrowPredictions['confidence']) ?? null;
  const signals = (pred.signals as string[] | undefined) ?? [];
  const confidenceBadge =
    confidence === 'High' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' :
    confidence === 'Moderate' ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' :
    confidence === 'Low' ? 'bg-slate-500/15 border-slate-500/30 text-slate-400' : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Predicted for Tomorrow</span>
        <span className="px-1.5 py-0.5 bg-violet-500/15 border border-violet-500/30 text-violet-400 text-[9px] rounded font-bold uppercase tracking-wide">
          Locked
        </span>
        {confidence && confidenceBadge && (
          <span className={`px-1.5 py-0.5 border text-[9px] rounded font-bold uppercase tracking-wide ${confidenceBadge}`}>
            {confidence} Conviction
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">

        {/* 1 — Fear & Greed */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">{fgEmoji}</div>
          <p className={`text-sm font-bold font-mono ${fgColor}`}>{fg?.score != null ? fg.score : '—'}</p>
          <p className={`text-[9px] font-bold mt-0.5 ${deltaColor}`}>
            {fgDelta !== 0 ? (fgDelta > 0 ? `↑${fgDelta}` : `↓${Math.abs(fgDelta)}`) : '→ flat'}
          </p>
          <p className="text-slate-500 text-[9px] mt-1 font-semibold uppercase tracking-wide">Fear & Greed</p>
        </div>

        {/* 2 — SPY Trend */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className={`text-base mb-1 font-bold ${spyColor}`}>{spyEmoji}</div>
          <p className={`text-sm font-bold font-mono ${spyColor}`}>{spyDir ?? '—'}</p>
          <p className="text-slate-400 text-[9px] mt-0.5 font-mono">{spyPctStr}</p>
          <p className="text-slate-500 text-[9px] mt-1 font-semibold uppercase tracking-wide">SPY Trend</p>
        </div>

        {/* 3 — Sector Rotation */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">🔄</div>
          <p className="text-[9px] font-bold font-mono text-emerald-400 leading-tight">
            {sectorRot?.leader?.ticker ?? '—'} <span className="opacity-70">{sectorRot?.leader?.performance ?? ''}</span>
          </p>
          <p className="text-[9px] font-bold font-mono text-red-400 leading-tight mt-0.5">
            {sectorRot?.lagger?.ticker ?? '—'} <span className="opacity-70">{sectorRot?.lagger?.performance ?? ''}</span>
          </p>
          <p className="text-slate-500 text-[9px] mt-1 font-semibold uppercase tracking-wide">Sectors</p>
        </div>

        {/* 4 — Options Pulse */}
        <div className="bg-white/4 border border-white/8 rounded-xl p-3 text-center">
          <div className="text-base mb-1">📊</div>
          <p className={`text-sm font-bold font-mono ${pcColor}`}>{pcRatio != null ? pcRatio.toFixed(2) : '—'}</p>
          {pcLean && (
            <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border mt-0.5 ${leanBadge}`}>
              {pcLean}
            </span>
          )}
          <p className="text-slate-500 text-[9px] mt-1 font-semibold uppercase tracking-wide">Options P/C</p>
        </div>

      </div>
      {signals.length > 0 && (
        <div className="mt-3 p-3 bg-white/3 border border-white/6 rounded-xl">
          <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-2">Quantitative Signals</p>
          <ul className="space-y-1">
            {signals.map((s, i) => (
              <li key={i} className="text-[10px] text-slate-400 flex items-start gap-1.5">
                <span className="text-violet-400 mt-0.5 flex-shrink-0">›</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[10px] text-slate-600 mt-2 text-center">
        Big Story &amp; Next Catalyst are not predicted — reported live each day
      </p>
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

// ─── Accuracy Calendar Heatmap ───────────────────────────────────────────────

interface HistoryDay { date: string; score: number; userCorrect: boolean | null }

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
    if (!d) return 'bg-white/4 border-white/6';
    if (d.score >= 75) return 'bg-emerald-500/70 border-emerald-400/50';
    if (d.score >= 55) return 'bg-amber-500/60 border-amber-400/50';
    return 'bg-red-500/60 border-red-400/50';
  }

  return (
    <div className="mt-4 pt-3 border-t border-white/6">
      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-3">
        90-Day Accuracy Calendar
      </p>

      {/* Day-of-week header */}
      <div className="flex gap-[3px] mb-1">
        {DOW_LABELS.map((l, i) => (
          <div key={i} className="w-5 text-center text-[8px] text-slate-600 font-bold uppercase">
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
                  className={`w-5 h-5 rounded-sm border cursor-default transition-opacity hover:opacity-80 ${cellColor(cell.iso)}`}
                  onMouseEnter={() => setTooltip(d ?? null)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="mt-2 bg-slate-800 border border-white/10 rounded-lg p-2 text-xs">
          <p className="text-slate-300 font-semibold">{tooltip.date}</p>
          <p className="text-slate-400 mt-0.5">
            Model: <span className={tooltip.score >= 75 ? 'text-emerald-400' : tooltip.score >= 55 ? 'text-amber-400' : 'text-red-400'}>
              {tooltip.score}%
            </span>
            {tooltip.userCorrect != null && (
              <span className="ml-2">You: {tooltip.userCorrect ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>}</span>
            )}
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2">
        {[
          { color: 'bg-emerald-500/70', label: '≥75%' },
          { color: 'bg-amber-500/60', label: '55–74%' },
          { color: 'bg-red-500/60', label: '<55%' },
          { color: 'bg-white/4', label: 'No data' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm border border-white/10 ${color}`} />
            <span className="text-[9px] text-slate-600">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Yesterday Card ───────────────────────────────────────────────────────────

function YesterdayCard({
  record,
  todayRecord,
  rollingAccuracy,
  modelStreak,
  userStreak,
  historyDays,
}: {
  record: DailyMarketRecord | null | undefined;
  todayRecord?: DailyMarketRecord;
  rollingAccuracy?: RollingAccuracy;
  modelStreak?: number;
  userStreak?: number;
  historyDays?: HistoryDay[];
}) {
  if (!record || !record.tomorrowPredictions) {
    return (
      <div className="bg-white/4 border border-white/8 rounded-2xl p-8 text-center">
        <Lock className="w-6 h-6 text-slate-600 mx-auto mb-2" />
        <p className="text-slate-400 text-sm font-semibold">No prediction on record yet</p>
        <p className="text-slate-500 text-xs mt-1">Yesterday&apos;s call will appear here after the first noon lock completes.</p>
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
  const breakdown = record.accuracyBreakdown;

  // Helper to get icon and color from a score
  function scoreIcon(score: number | null | undefined) {
    if (score == null) return { icon: '—', color: 'text-slate-500' };
    if (score >= 70) return { icon: '✓', color: 'text-emerald-400' };
    if (score >= 40) return { icon: '≈', color: 'text-amber-400' };
    return { icon: '✗', color: 'text-red-400' };
  }

  const indicators = [
    {
      key: 'fearGreed' as const,
      label: 'Fear & Greed',
      predicted: pred?.fearGreed?.score != null ? String(pred.fearGreed.score) : '—',
      actual: actual?.fearGreed?.score != null ? String(actual.fearGreed.score) : '—',
    },
    {
      key: 'spyTrend' as const,
      label: 'SPY Trend',
      predicted: pred?.spyTrend?.direction ?? '—',
      actual: actual?.spyTrend?.direction ?? '—',
    },
    {
      key: 'sectorRotation' as const,
      label: 'Sector Leader',
      predicted: pred?.sectorRotation?.leader?.ticker ?? '—',
      actual: actual?.sectorRotation?.leader?.ticker ?? '—',
    },
    {
      key: 'optionsPulse' as const,
      label: 'Options Pulse',
      predicted: pred?.optionsPulse?.lean ?? '—',
      actual: actual?.optionsPulse?.lean ?? '—',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Proof-of-lock header */}
      <div className="bg-blue-500/8 border border-blue-500/25 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">
            Yesterday&apos;s Call · {record.recordDate}
          </span>
        </div>
        <p className="text-white font-semibold text-sm">What we predicted for today</p>
        {lockedAt && (
          <p className="text-slate-500 text-xs mt-1">
            🔒 Locked {lockedAt} · immutable record
          </p>
        )}
      </div>

      {/* How did we do — comparison table */}
      <div className="bg-white/4 border border-blue-500/20 rounded-2xl p-5">
        <p className="text-[10px] text-blue-400 uppercase tracking-widest font-bold mb-3">How Did We Do?</p>
        <div className="space-y-2">
          {indicators.map(({ key, label, predicted, actual: act }) => {
            const { icon, color } = scoreIcon(breakdown?.[key] as number | null | undefined);
            return (
              <div key={key} className="flex items-center gap-3 py-2 border-b border-white/6 last:border-0">
                <span className="text-slate-500 text-[10px] w-24 flex-shrink-0 font-semibold">{label}</span>
                <span className="text-slate-300 text-[10px] font-mono flex-1">
                  <span className="text-slate-500">Predicted:</span> {predicted}
                </span>
                <span className="text-slate-400 text-[10px]">→</span>
                <span className="text-slate-300 text-[10px] font-mono flex-1">
                  <span className="text-slate-500">Actual:</span> {act}
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
          <p className="text-slate-500 text-[10px] mt-3 text-center">
            Accuracy scoring pending — calculated when today&apos;s data is confirmed
          </p>
        )}

        {/* Rolling accuracy */}
        {rollingAccuracy && rollingAccuracy.daysScored > 0 && (
          <div className="mt-4 pt-3 border-t border-white/6">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">
              Rolling Accuracy (last {rollingAccuracy.daysScored} days)
            </p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'F&G', value: rollingAccuracy.fearGreed },
                { label: 'SPY', value: rollingAccuracy.spyTrend },
                { label: 'Sector', value: rollingAccuracy.sectorRotation },
                { label: 'Options', value: rollingAccuracy.optionsPulse },
              ].map(({ label, value }) => {
                const pctColor = value == null ? 'text-slate-600' :
                  value >= 70 ? 'text-emerald-400' :
                  value >= 50 ? 'text-amber-400' : 'text-red-400';
                return (
                  <div key={label} className="text-center">
                    <p className={`text-sm font-bold font-mono ${pctColor}`}>
                      {value != null ? `${value}%` : 'N/A'}
                    </p>
                    <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">{label}</p>
                  </div>
                );
              })}
            </div>

            {/* Streaks */}
            {((modelStreak != null && modelStreak > 0) || (userStreak != null && userStreak > 0)) && (
              <div className="mt-3 pt-3 border-t border-white/6 grid grid-cols-2 gap-3">
                {modelStreak != null && modelStreak > 0 && (
                  <div className="text-center">
                    <p className="text-sm font-bold font-mono text-emerald-400">🔥 {modelStreak}</p>
                    <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">Model SPY Streak</p>
                  </div>
                )}
                {userStreak != null && userStreak > 0 && (
                  <div className="text-center">
                    <p className="text-sm font-bold font-mono text-violet-400">⚡ {userStreak}</p>
                    <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">Your SPY Streak</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {historyDays && historyDays.length > 0 && (
          <AccuracyCalendar days={historyDays} />
        )}
      </div>

      {/* The frozen prediction — never modified after lock */}
      <div className="bg-white/4 border border-blue-500/15 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">Predicted Indicators</span>
          <span className="px-1.5 py-0.5 bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[9px] rounded font-bold uppercase tracking-wide">Frozen at Noon</span>
        </div>
        <PredictedGrid predictions={record.tomorrowPredictions} />
      </div>

      {/* Yesterday's outlook narrative */}
      {record.tomorrowOutlook && (
        <div className="bg-white/4 border border-blue-500/15 rounded-2xl p-5">
          <p className="text-[10px] text-blue-400 uppercase tracking-widest font-bold mb-2">Yesterday&apos;s Written Thesis</p>
          <p className="text-slate-200 text-sm leading-relaxed">{record.tomorrowOutlook}</p>
        </div>
      )}

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

function TomorrowCard({
  record,
  onUserPredict,
}: {
  record: DailyMarketRecord;
  onUserPredict?: (prediction: 'Up' | 'Down' | 'Flat') => Promise<void>;
}) {
  const [timeToNoon, setTimeToNoon] = useState('');
  const [predicting, setPredicting] = useState(false);

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
          <PredictedGrid predictions={record.tomorrowPredictions} />
        </div>
      ) : (
        <div className="bg-white/4 border border-white/8 rounded-2xl p-8 text-center">
          <Lock className="w-6 h-6 text-slate-600 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">
            Predictions will be generated and locked at noon ET.
          </p>
        </div>
      )}

      {/* Next Catalyst from today's live data */}
      {record.elite6Actual?.nextCatalyst && (
        <div className="bg-white/4 border border-amber-500/20 rounded-2xl p-5">
          <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-2">Next Catalyst (Live)</p>
          <div className="flex items-start gap-3">
            <span className="text-amber-400 font-mono text-xs font-bold flex-shrink-0">
              {record.elite6Actual.nextCatalyst.time}
            </span>
            <div>
              <p className="text-white text-sm font-semibold">{record.elite6Actual.nextCatalyst.event}</p>
              <p className="text-slate-400 text-xs mt-1 leading-relaxed">{record.elite6Actual.nextCatalyst.implication}</p>
            </div>
          </div>
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

      {/* User prediction */}
      <div className="bg-white/4 border border-violet-500/20 rounded-2xl p-5">
        <p className="text-[10px] text-violet-400 uppercase tracking-widest font-bold mb-1">Beat the Model</p>
        <p className="text-slate-400 text-xs mb-3">
          Where do you think SPY closes tomorrow? Your pick is locked until scored against actuals.
        </p>
        {record.userSpyPrediction ? (
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-[10px] text-violet-400 font-semibold uppercase tracking-wide">
              Your call: SPY {record.userSpyPrediction}
            </span>
            {record.userAccuracyCorrect != null && (
              <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                record.userAccuracyCorrect
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-red-500/20 text-red-400 border-red-500/30'
              }`}>
                {record.userAccuracyCorrect ? '✓ Correct' : '✗ Wrong'}
              </span>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            {(['Up', 'Down', 'Flat'] as const).map((dir) => {
              const Icon = dir === 'Up' ? TrendingUp : dir === 'Down' ? TrendingDown : Minus;
              const style =
                dir === 'Up' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20' :
                dir === 'Down' ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20' :
                'bg-slate-500/10 border-slate-500/30 text-slate-400 hover:bg-slate-500/20';
              return (
                <button
                  key={dir}
                  disabled={predicting || !onUserPredict}
                  onClick={async () => {
                    if (!onUserPredict) return;
                    setPredicting(true);
                    try { await onUserPredict(dir); } finally { setPredicting(false); }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-xs font-semibold transition-all disabled:opacity-50 ${style}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {dir}
                </button>
              );
            })}
          </div>
        )}
      </div>

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

  const handleUserPredict = useCallback(async (prediction: 'Up' | 'Down' | 'Flat') => {
    if (!data?.today.recordDate) return;
    try {
      await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'userPredict', date: data.today.recordDate, prediction }),
      });
      // Optimistically update local state
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          today: { ...prev.today, userSpyPrediction: prediction, userPredictionLockedAt: new Date().toISOString() },
        };
      });
    } catch {
      // Non-critical
    }
  }, [data?.today.recordDate]);

  const CARDS = [
    {
      label: "Yesterday's Call",
      sublabel: 'Did we nail our prediction?',
      icon: '📋',
      activeColor: 'text-blue-400 bg-blue-500/15 border-blue-500/40',
      inactiveColor: 'text-slate-500 bg-white/4 border-white/8',
    },
    {
      label: 'Live Pulse',
      sublabel: 'Right now',
      icon: '⚡',
      activeColor: 'text-amber-400 bg-amber-500/15 border-amber-500/40',
      inactiveColor: 'text-slate-500 bg-white/4 border-white/8',
    },
    {
      label: "Tomorrow's Call",
      sublabel: 'Our prediction',
      icon: '🔮',
      activeColor: 'text-violet-400 bg-violet-500/15 border-violet-500/40',
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
            <h1 className="text-xl font-bold text-white">Market Analysis</h1>
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
            {backgroundRefreshing && (
              <span className="text-slate-500 text-xs flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" /> Updating...
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing || backgroundRefreshing}
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
            {activeCard === 0 && <YesterdayCard record={data?.yesterday} todayRecord={data?.today} rollingAccuracy={data?.rollingAccuracy} modelStreak={data?.modelStreak} userStreak={data?.userStreak} historyDays={historyDays} />}
            {activeCard === 1 && data?.today && (
              <TodayCard record={data.today} isStale={data.isLiveDataStale ?? false} />
            )}
            {activeCard === 2 && data?.today && <TomorrowCard record={data.today} onUserPredict={handleUserPredict} />}
          </>
        )}
      </div>
    </div>
  );
}
