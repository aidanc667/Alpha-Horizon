'use client';

/**
 * PortfolioPerformanceChart
 *
 * A single continuous chart spanning 15 years of historical performance
 * (left) through today (center line) into a forward projection (right).
 *
 * Historical side: blended annual returns from pre-computed table (no API needed).
 *   - Portfolio: user's actual allocation weights × each ETF's real annual return
 *   - VT benchmark: 100% VT annual return (same methodology)
 *   - Contributions floor: starting capital + monthly contributions compounded at 0%
 *
 * Forward side: CMA-based deterministic projection (bear/base/bull = ±1σ).
 *   - Same three series continued as dashed lines
 *   - Light shaded band between bear and bull shows the uncertainty range
 *
 * A vertical "TODAY" reference line separates the two halves.
 */

import React from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import type { AllocationSlice, PortfolioPlan, IntakeAnswers } from '../types';
import { blendedReturn, HISTORY_START_YEAR, HISTORY_END_YEAR } from '@/lib/historicalReturns';

interface Props {
  plan: PortfolioPlan;
  answers: IntakeAnswers;
}

interface ChartPoint {
  label: string;
  calYear: number;
  portfolio: number | null;
  vt: number | null;
  contributions: number;
  // Future only
  portfolioBase: number | null;
  portfolioBull: number | null;
  portfolioBear: number | null;
  vtForward: number | null;
  // Band helper: recharts fills Area from dataKey down to 0,
  // so we use [bearValue, bullValue] via a stacked trick.
  // Instead: we pass bandLow + bandHeight separately.
  bandLow: number | null;
  bandHeight: number | null;
  isFuture: boolean;
}

function fmtDollar(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function buildChartData(
  allocation: AllocationSlice[],
  answers: IntakeAnswers,
  plan: PortfolioPlan,
): ChartPoint[] {
  const { startingCapital, monthlyContribution, yearsUntilWithdrawal } = answers;
  const annualContrib = monthlyContribution * 12;
  const currentYear = new Date().getFullYear(); // 2026 per memory
  const histStart = HISTORY_START_YEAR;         // 2010
  const histEnd   = HISTORY_END_YEAR;           // 2024
  // How many historical years to show (cap at 15)
  const histYears = Math.min(15, histEnd - histStart + 1);
  const chartHistStart = histEnd - histYears + 1; // e.g. 2010

  const points: ChartPoint[] = [];

  // ── Historical side ─────────────────────────────────────────────────────────
  // Imagine the investor started with their exact capital & monthly contributions
  // 15 years ago, invested in today's allocation. Show what would have happened.
  let portfolioVal  = startingCapital;
  let vtVal         = startingCapital;
  let contribVal    = startingCapital;

  for (let yr = chartHistStart; yr <= histEnd; yr++) {
    const portRet = blendedReturn(allocation, yr);
    const vtRet   = blendedReturn([{ ticker: 'VT', weight: 1 }], yr);

    // Add annual contribution at start of year then compound
    portfolioVal = (portfolioVal + annualContrib) * (1 + portRet);
    vtVal        = (vtVal        + annualContrib) * (1 + vtRet);
    contribVal   = contribVal   + annualContrib;  // no growth — raw floor

    const yearsAgo = histEnd - yr;
    const label = yr === histEnd
      ? `${yr} (Today)`
      : `${yr}`;

    points.push({
      label,
      calYear: yr,
      portfolio: Math.round(portfolioVal),
      vt:        Math.round(vtVal),
      contributions: Math.round(contribVal),
      portfolioBase: null,
      portfolioBull: null,
      portfolioBear: null,
      vtForward: null,
      bandLow: null,
      bandHeight: null,
      isFuture: false,
    });

    void yearsAgo; // suppress unused warning
  }

  // ── Today anchor point ────────────────────────────────────────────────────────
  // The last historical point doubles as the "today" anchor for forward lines.
  const todayPortfolio  = portfolioVal;
  const todayVT         = vtVal;
  const todayContrib    = contribVal;

  // ── Forward side ──────────────────────────────────────────────────────────────
  // Use CMA-based annual returns. Bear = return−vol, Base = return, Bull = return+vol.
  const portReturn = plan.expectedReturn;
  const portVol    = plan.expectedVolatility;
  const vtReturn   = plan.benchmarkComparison?.vtExpectedReturn ?? 0.063;
  const vtVol      = plan.benchmarkComparison?.vtVolatility     ?? 0.150;

  // Annualized ±1σ around CMA
  const portBull = portReturn + portVol * 0.5;
  const portBear = portReturn - portVol * 0.5;
  const vtBull   = vtReturn   + vtVol   * 0.5;
  const vtBear   = vtReturn   - vtVol   * 0.5;

  let fwdBase = todayPortfolio;
  let fwdBull = todayPortfolio;
  let fwdBear = todayPortfolio;
  let fwdVT   = todayVT;
  let fwdVTBull = todayVT;
  let fwdVTBear = todayVT;
  let fwdContrib = todayContrib;

  const horizonYears = Math.max(1, yearsUntilWithdrawal);

  for (let y = 1; y <= horizonYears; y++) {
    fwdBase  = (fwdBase  + annualContrib) * (1 + portReturn);
    fwdBull  = (fwdBull  + annualContrib) * (1 + portBull);
    fwdBear  = (fwdBear  + annualContrib) * (1 + portBear);
    fwdVT    = (fwdVT    + annualContrib) * (1 + vtReturn);
    fwdVTBull = (fwdVTBull + annualContrib) * (1 + vtBull);
    fwdVTBear = (fwdVTBear + annualContrib) * (1 + vtBear);
    fwdContrib = fwdContrib + annualContrib;

    const calYr = histEnd + y;
    const label = y === horizonYears
      ? `${calYr} (Goal)`
      : `${calYr}`;

    // Band: recharts stacked Area trick — bandLow = bear, bandHeight = bull - bear
    const bandLow    = Math.round(fwdBear);
    const bandHeight = Math.round(Math.max(0, fwdBull - fwdBear));

    points.push({
      label,
      calYear: calYr,
      portfolio: null,
      vt: null,
      contributions: Math.round(fwdContrib),
      portfolioBase: Math.round(fwdBase),
      portfolioBull: Math.round(fwdBull),
      portfolioBear: Math.round(fwdBear),
      vtForward: Math.round(fwdVT),
      bandLow,
      bandHeight,
      isFuture: true,
    });
  }

  void currentYear; // suppress
  void vtBull; void vtBear; // suppress (VT cone not shown to keep chart clean)
  return points;
}

// Custom dot: only render on the last historical point ("today") and last future point
function TodayDot(props: Record<string, unknown>) {
  const { cx, cy, index, data } = props as {
    cx: number; cy: number; index: number;
    data: ChartPoint[];
  };
  if (!data) return null;
  const point = data[index];
  if (!point) return null;
  // Show a dot only at the "today" boundary (last non-future point)
  const isToday = !point.isFuture && (data[index + 1]?.isFuture ?? false);
  if (!isToday) return null;
  return <circle cx={cx} cy={cy} r={4} fill="#06b6d4" stroke="#0f172a" strokeWidth={2} />;
}

// Custom tooltip
function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const relevant = payload.filter(p => p.value != null && p.value > 0 && !['bandLow','bandHeight'].includes(p.name));
  return (
    <div className="bg-slate-900 border border-white/10 rounded-xl p-3 text-xs shadow-xl">
      <p className="text-slate-400 mb-2 font-medium">{label}</p>
      {relevant.map((p, i) => (
        <div key={i} className="flex items-center gap-2 mb-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="font-mono font-bold text-white">{fmtDollar(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function PortfolioPerformanceChart({ plan, answers }: Props) {
  const allocation = Array.isArray(plan.allocation) ? plan.allocation : [];
  if (allocation.length === 0) return null;

  const data = buildChartData(allocation, answers, plan);

  // Index of the last historical point (the "today" divider)
  const todayIdx = data.findLastIndex(d => !d.isFuture);
  const todayLabel = data[todayIdx]?.label ?? 'Today';

  return (
    <div className="bg-slate-900 border border-white/8 rounded-2xl p-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-white font-semibold text-sm">15-Year Historical + Forward Projection</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            Past: actual blended ETF returns (2010–2024) · Future: CMA-based bear/base/bull (±½σ)
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500 flex-shrink-0 ml-4 mt-0.5">
          <span className="flex items-center gap-1.5">
            <span className="w-6 h-0.5 bg-cyan-400 inline-block rounded" />Your Portfolio
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-6 h-0.5 bg-slate-500 inline-block rounded" />100% VT
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-6 h-0.5 bg-amber-600/70 inline-block rounded border-dashed" />Contributions
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            {/* Shaded cone between bear and bull */}
            <linearGradient id="coneGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.03} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />

          <XAxis
            dataKey="label"
            tick={{ fill: '#475569', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={Math.floor(data.length / 8)}
          />
          <YAxis
            tick={{ fill: '#475569', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => fmtDollar(v)}
            width={65}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* TODAY reference line */}
          <ReferenceLine
            x={todayLabel}
            stroke="#334155"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            label={{ value: 'TODAY', position: 'top', fill: '#475569', fontSize: 10 }}
          />

          {/* ── Uncertainty cone (future only) ──────────────────────────────── */}
          {/* Stacked area trick: transparent base up to bear, then colored band to bull */}
          <Area
            type="monotone"
            dataKey="bandLow"
            stroke="none"
            fill="transparent"
            legendType="none"
            isAnimationActive={false}
            dot={false}
            activeDot={false}
            name="bandLow"
            stackId="cone"
          />
          <Area
            type="monotone"
            dataKey="bandHeight"
            stroke="none"
            fill="url(#coneGrad)"
            legendType="none"
            isAnimationActive={false}
            dot={false}
            activeDot={false}
            name="bandHeight"
            stackId="cone"
          />

          {/* ── Contributions floor ─────────────────────────────────────────── */}
          <Line
            type="monotone"
            dataKey="contributions"
            name="Contributions"
            stroke="#92400e"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 3, fill: '#92400e' }}
            legendType="none"
            isAnimationActive={false}
          />

          {/* ── Historical: VT benchmark ────────────────────────────────────── */}
          <Line
            type="monotone"
            dataKey="vt"
            name="VT (Historical)"
            stroke="#64748b"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: '#64748b' }}
            connectNulls={false}
            legendType="none"
            isAnimationActive={false}
          />

          {/* ── Historical: Portfolio ───────────────────────────────────────── */}
          <Line
            type="monotone"
            dataKey="portfolio"
            name="Portfolio (Historical)"
            stroke="#06b6d4"
            strokeWidth={2}
            dot={<TodayDot data={data} />}
            activeDot={{ r: 3, fill: '#06b6d4' }}
            connectNulls={false}
            legendType="none"
            isAnimationActive={false}
          />

          {/* ── Forward: VT base case ───────────────────────────────────────── */}
          <Line
            type="monotone"
            dataKey="vtForward"
            name="VT (Projected)"
            stroke="#475569"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 3, fill: '#475569' }}
            connectNulls={false}
            legendType="none"
            isAnimationActive={false}
          />

          {/* ── Forward: Portfolio base case ────────────────────────────────── */}
          <Line
            type="monotone"
            dataKey="portfolioBase"
            name="Portfolio (Projected)"
            stroke="#22d3ee"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            activeDot={{ r: 3, fill: '#22d3ee' }}
            connectNulls={false}
            legendType="none"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend row */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-0.5 bg-cyan-400 inline-block" />
          <span className="w-5 h-0.5 bg-cyan-300 inline-block border-t border-dashed border-cyan-300" style={{ background: 'none', borderTopWidth: 2, borderTopStyle: 'dashed', borderTopColor: '#22d3ee', display: 'inline-block' }} />
          Your portfolio (past · projected)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-0.5 bg-slate-500 inline-block" />
          <span className="inline-block w-5" style={{ borderTop: '2px dashed #475569' }} />
          100% VT (past · projected)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5" style={{ borderTop: '2px dashed #92400e' }} />
          Contributions only (no returns)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-3 rounded-sm" style={{ background: 'rgba(6,182,212,0.12)' }} />
          Projection range (±½σ)
        </span>
      </div>

      {/* Data note */}
      <p className="text-slate-600 text-xs mt-3 leading-relaxed">
        Historical data 2010–2024: actual ETF total returns. Pre-inception proxies: AVUV → IJS (iShares S&P 600 Small Cap Value, validates vs Ken French US Small Value factor); AVDV → DLS (WisdomTree Intl SmallCap Dividend); SGOV → 3-mo T-bill (Fed H.15). Forward: CMA-based deterministic projection — not Monte Carlo. Assumes same allocation weights held throughout. Past performance does not guarantee future results.
      </p>
    </div>
  );
}
