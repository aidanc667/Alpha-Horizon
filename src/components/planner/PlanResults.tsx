'use client';

import React, { useState, useMemo } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts';
import type { V3Plan } from '@/lib/agents/types';
import type { BacktestState } from './PlannerTab';
import type { IntakeAnswers } from '@/apps/portfolio-agent/types';
import { generateProjectionSeries } from '@/lib/projectionSeries';

// ─── Format helpers ────────────────────────────────────────────────────────────

const fmt$ = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtY = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1_000).toFixed(0)}k`;

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatCell({
  label,
  value,
  color = '#10b981',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="text-center px-2">
      <p className="text-2xl font-black font-mono leading-tight" style={{ color }}>
        {value}
      </p>
      <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">{label}</p>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-slate-50 px-4 py-3">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="font-mono text-sm font-bold text-gray-900">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const ACCOUNT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  taxable:     { bg: 'bg-slate-100',  text: 'text-slate-600',  label: 'Taxable' },
  roth:        { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Roth IRA' },
  traditional: { bg: 'bg-blue-50',    text: 'text-blue-700',   label: '401(k)' },
  hsa:         { bg: 'bg-amber-50',   text: 'text-amber-700',  label: 'HSA' },
  any:         { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Any' },
};

// ─── Tab 1 — Portfolio ─────────────────────────────────────────────────────────

function PortfolioTab({
  plan,
  backtest,
  answers,
}: {
  plan: V3Plan;
  backtest: BacktestState;
  answers: IntakeAnswers;
}) {
  const macro = plan.economicIntel;
  const stats = plan.portfolio.statistics;
  const alloc = plan.portfolio.allocation;
  const overall = plan.criticScore.scores.overall;
  const scoreColor = overall >= 90 ? '#10b981' : overall >= 80 ? '#f59e0b' : '#ef4444';

  const taxAlphaBps = plan.taxOptimization.estimatedAnnualSavings;
  const taxAlpha$ = Math.round((taxAlphaBps * answers.startingCapital) / 10_000);
  const weightedERBps = (stats.weightedExpenseRatio * 10_000).toFixed(0);

  // ── Backtest chart data (downsample to ~monthly)
  const backtestChartData = useMemo(() => {
    if (!backtest.result) return [];
    const daily = backtest.result.dailyData;
    return daily
      .filter((_, i) => i % 21 === 0)
      .map((d) => ({
        date: d.date.slice(0, 7),
        portfolio: Math.round(d.portfolioValue),
        benchmark: Math.round(d.benchmarkValue),
        contributed: Math.round(d.totalContributed),
      }));
  }, [backtest.result]);

  // ── Projection chart data
  const projData = useMemo(
    () =>
      generateProjectionSeries(
        answers.startingCapital,
        answers.monthlyContribution,
        stats.expectedReturn,
        stats.expectedVolatility,
        15,
      ).map((d) => ({
        ...d,
        bandBase: d.p10,
        bandWidth: d.p90 - d.p10,
        innerBase: d.p10,
        innerWidth: d.p50 - d.p10,
      })),
    [
      answers.startingCapital,
      answers.monthlyContribution,
      stats.expectedReturn,
      stats.expectedVolatility,
    ],
  );

  const p50final = projData.at(-1)?.p50 ?? 0;
  const p10final = projData.at(-1)?.p10 ?? 0;
  const bt = backtest.result;
  const btMaxDD = bt ? bt.metrics.maxDrawdown : null;
  const btBeta = bt ? bt.metrics.beta.toFixed(2) : null;
  const btAlphaPct = bt ? `${(bt.metrics.alpha * 100).toFixed(2)}%/yr` : null;
  const btVtFinal = bt ? bt.dailyData.at(-1)?.benchmarkValue ?? 0 : 0;
  const btAlphaDlr = bt ? fmt$(bt.metrics.endingValue - btVtFinal) : null;
  const btReturn = bt ? `+${bt.metrics.totalReturnPct.toFixed(0)}%` : null;

  const macroDate = macro.macroFetchedAt
    ? new Date(macro.macroFetchedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';

  return (
    <div className="space-y-4">
      {/* ── Macro context strip */}
      <div className="rounded-lg bg-slate-900 px-4 py-2.5 text-slate-300 text-[11px] font-mono flex flex-wrap gap-x-4 gap-y-1 items-center">
        <span>CAPE {macro.macroData.shillerCAPE.toFixed(1)}</span>
        <span className="text-slate-600">·</span>
        <span>Fed {fmtPct(macro.macroData.fedFundsRate)}</span>
        <span className="text-slate-600">·</span>
        <span>10Y {fmtPct(macro.macroData.treasury10Y)}</span>
        <span className="text-slate-600">·</span>
        <span>CPI {fmtPct(macro.macroData.cpiYoY)}</span>
        <span className="text-slate-600">·</span>
        <span className={macro.regime.current === 'risk_on' ? 'text-emerald-400' : 'text-red-400'}>
          Regime: {macro.regime.current.replace('_', '-').toUpperCase()}
        </span>
        <span className="text-slate-600">·</span>
        <span>Equity: {macro.assetClassOutlook.equityValuation.toUpperCase()}</span>
        <span className="text-slate-600">·</span>
        <span>Bonds: {macro.assetClassOutlook.bondOpportunity.toUpperCase()}</span>
        <span className="ml-auto text-slate-500 text-[10px]">as of {macroDate}</span>
      </div>

      {/* ── Executive summary */}
      <div className="rounded-xl border border-gray-100 bg-slate-800 p-5 text-white shadow-sm">
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6 mb-4">
          <StatCell label="Critic Score" value={`${overall}/100`} color={scoreColor} />
          <StatCell label="Exp. Return" value={fmtPct(stats.expectedReturn)} color="#10b981" />
          <StatCell label="Sharpe Ratio" value={stats.sharpeRatio.toFixed(2)} color="#10b981" />
          <StatCell
            label="Success Prob."
            value={
              plan.monteCarlo.goalSuccessProbability != null
                ? fmtPct(plan.monteCarlo.goalSuccessProbability)
                : '—'
            }
            color="#3b82f6"
          />
          <StatCell label="Expense Ratio" value={`${weightedERBps} bps`} color="#f59e0b" />
          <StatCell
            label="Est. Tax Alpha"
            value={taxAlpha$ > 0 ? `${fmt$(taxAlpha$)}/yr` : `${taxAlphaBps} bps`}
            color="#10b981"
          />
        </div>
        {plan.synthesis?.portfolioNarrative && (
          <p className="text-slate-300 text-xs leading-relaxed border-t border-white/10 pt-3">
            {plan.synthesis.portfolioNarrative.slice(0, 280)}…
          </p>
        )}
      </div>

      {/* ── Allocation + risk metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-4">
        {/* Allocation bars */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4">
            Portfolio Allocation
          </h3>
          <div className="space-y-3">
            {alloc.map((s) => {
              const pctVal = (s.weight * 100).toFixed(0);
              const dollars = fmt$(Math.round(s.weight * answers.startingCapital));
              const acc = ACCOUNT_COLORS[s.accountPlacement] ?? ACCOUNT_COLORS.any;
              return (
                <div key={s.ticker} className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold text-gray-900 w-10 flex-shrink-0">
                    {s.ticker}
                  </span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 rounded-full"
                      style={{ width: `${pctVal}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs text-gray-700 w-8 text-right flex-shrink-0">
                    {pctVal}%
                  </span>
                  <span className="font-mono text-xs text-gray-400 w-16 text-right flex-shrink-0 hidden sm:block">
                    {dollars}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${acc.bg} ${acc.text} w-16 text-center flex-shrink-0 hidden md:block`}
                  >
                    {acc.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Risk metrics */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4">
            Risk Metrics
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Exp. Annual Return" value={fmtPct(stats.expectedReturn)} />
            <MetricCard label="Annual Volatility" value={fmtPct(stats.expectedVolatility)} />
            <MetricCard label="Sharpe Ratio" value={stats.sharpeRatio.toFixed(2)} />
            <MetricCard
              label="Beta vs VT"
              value={btBeta ?? '—'}
              sub={backtest.loading ? 'calculating…' : undefined}
            />
            <MetricCard
              label="Historical Max DD"
              value={btMaxDD != null ? `-${btMaxDD.toFixed(1)}%` : '—'}
              sub={
                backtest.loading
                  ? 'running backtest…'
                  : backtest.worstCalendarYear
                  ? `Worst yr ${backtest.worstCalendarYear.year}: ${backtest.worstCalendarYear.return.toFixed(1)}%`
                  : undefined
              }
            />
            <MetricCard
              label="Alpha vs VT"
              value={btAlphaPct ?? '—'}
              sub={backtest.loading ? 'calculating…' : undefined}
            />
          </div>
        </div>
      </div>

      {/* ── Graph 1: Historical backtest */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3">
          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest">
            Historical Performance — Jan 2014 → Present
          </h3>
          {bt && (
            <div className="flex flex-wrap gap-3 mt-2">
              {[
                { label: 'Final Value', value: fmt$(bt.metrics.endingValue) },
                { label: 'Total Return', value: btReturn! },
                { label: 'vs VT', value: btAlphaDlr! },
              ].map(({ label, value }) => (
                <span
                  key={label}
                  className="text-[11px] font-mono bg-slate-50 border border-gray-100 rounded-md px-2 py-0.5"
                >
                  <span className="text-gray-500">{label}:</span>{' '}
                  <span className="font-bold text-gray-800">{value}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {backtest.loading && (
          <div className="h-[320px] flex items-center justify-center">
            <p className="text-xs text-gray-400 animate-pulse">
              Running historical backtest (Jan 2014 → present)…
            </p>
          </div>
        )}
        {!backtest.loading && backtestChartData.length === 0 && (
          <div className="h-[320px] flex items-center justify-center">
            <p className="text-xs text-gray-400">Backtest unavailable.</p>
          </div>
        )}
        {!backtest.loading && backtestChartData.length > 0 && (
          <>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart
                data={backtestChartData}
                margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
              >
                <defs>
                  <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => (v.endsWith('-01') ? v.slice(0, 4) : '')}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  minTickGap={30}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={fmtY}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1e293b',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 11,
                    color: '#e2e8f0',
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, name: any) => {
                    const labels: Record<string, string> = {
                      portfolio: 'Portfolio',
                      benchmark: 'VT Benchmark',
                      contributed: 'Contributed',
                    };
                    return [fmt$(value as number), labels[name as string] ?? name];
                  }}
                  labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                />
                <ReferenceArea
                  x1="2020-02"
                  x2="2020-04"
                  fill="#ef4444"
                  fillOpacity={0.06}
                  label={{
                    value: 'COVID −34%',
                    position: 'insideTop',
                    fontSize: 9,
                    fill: '#ef4444',
                  }}
                />
                <ReferenceArea
                  x1="2022-01"
                  x2="2022-12"
                  fill="#ef4444"
                  fillOpacity={0.06}
                  label={{
                    value: '2022 Bear −19%',
                    position: 'insideTop',
                    fontSize: 9,
                    fill: '#ef4444',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="contributed"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  strokeOpacity={0.7}
                />
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  dot={false}
                  strokeOpacity={0.8}
                />
                <Area
                  type="monotone"
                  dataKey="portfolio"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#portGrad)"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2 justify-center">
              {[
                { color: '#10b981', label: 'Portfolio', dash: false },
                { color: '#3b82f6', label: 'VT Benchmark', dash: false },
                { color: '#f59e0b', label: 'Contributed', dash: true },
              ].map(({ color, label, dash }) => (
                <div key={label} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <svg width="16" height="8">
                    <line
                      x1="0"
                      y1="4"
                      x2="16"
                      y2="4"
                      stroke={color}
                      strokeWidth={2}
                      strokeDasharray={dash ? '4 2' : undefined}
                    />
                  </svg>
                  {label}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Graph 2: Forward projection */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3">
          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest">
            15-Year Projection
          </h3>
          <div className="flex flex-wrap gap-3 mt-2">
            {[
              { label: 'P50 at 15yr', value: fmt$(p50final) },
              {
                label: 'Success Prob.',
                value:
                  plan.monteCarlo.goalSuccessProbability != null
                    ? fmtPct(plan.monteCarlo.goalSuccessProbability)
                    : '—',
              },
              { label: 'P10 at 15yr', value: fmt$(p10final) },
            ].map(({ label, value }) => (
              <span
                key={label}
                className="text-[11px] font-mono bg-slate-50 border border-gray-100 rounded-md px-2 py-0.5"
              >
                <span className="text-gray-500">{label}:</span>{' '}
                <span className="font-bold text-gray-800">{value}</span>
              </span>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={projData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="p50Grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.12} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="year"
              tickFormatter={(v: number) => `Yr ${v}`}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              interval={4}
            />
            <YAxis
              tickFormatter={fmtY}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={54}
            />
            <Tooltip
              contentStyle={{
                background: '#1e293b',
                border: 'none',
                borderRadius: 8,
                fontSize: 11,
                color: '#e2e8f0',
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => {
                const n = name as string;
                if (['bandBase', 'bandWidth', 'innerBase', 'innerWidth'].includes(n))
                  return [null, ''];
                const labels: Record<string, string> = {
                  p50: 'P50 Median',
                  p90: 'P90 Optimistic',
                  contributed: 'Contributed',
                };
                return [fmt$(value as number), labels[n] ?? n];
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              labelFormatter={(v: any) => `Year ${v}`}
              labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
            />
            {answers.goalAmount != null && answers.goalAmount > 0 && (
              <ReferenceLine
                y={answers.goalAmount}
                stroke="#ef4444"
                strokeDasharray="4 2"
                strokeWidth={1.5}
                label={{
                  value: `Goal: ${fmt$(answers.goalAmount)}`,
                  position: 'insideTopRight',
                  fontSize: 9,
                  fill: '#ef4444',
                }}
              />
            )}
            {/* Outer P10–P90 band */}
            <Area
              type="monotone"
              dataKey="bandBase"
              stackId="outer"
              fill="transparent"
              stroke="none"
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="bandWidth"
              stackId="outer"
              fill="#10b981"
              fillOpacity={0.08}
              stroke="none"
              dot={false}
            />
            {/* Inner P10–P50 band */}
            <Area
              type="monotone"
              dataKey="innerBase"
              stackId="inner"
              fill="transparent"
              stroke="none"
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="innerWidth"
              stackId="inner"
              fill="#10b981"
              fillOpacity={0.14}
              stroke="none"
              dot={false}
            />
            {/* Contributions dashed amber */}
            <Line
              type="monotone"
              dataKey="contributed"
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={false}
              strokeOpacity={0.7}
            />
            {/* P90 dashed */}
            <Line
              type="monotone"
              dataKey="p90"
              stroke="#10b981"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              strokeOpacity={0.5}
              dot={false}
            />
            {/* P50 median solid */}
            <Area
              type="monotone"
              dataKey="p50"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#p50Grad)"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>

        <div className="flex gap-4 mt-2 justify-center flex-wrap">
          {[
            { color: '#10b981', label: 'P50 Median', dash: false },
            { color: '#10b981', label: 'P90 Optimistic', dash: true },
            { color: '#f59e0b', label: 'Contributed', dash: true },
          ].map(({ color, label, dash }) => (
            <div key={label} className="flex items-center gap-1.5 text-[10px] text-gray-500">
              <svg width="16" height="8">
                <line
                  x1="0"
                  y1="4"
                  x2="16"
                  y2="4"
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={dash ? '4 2' : undefined}
                />
              </svg>
              {label}
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <div className="w-4 h-3 rounded-sm bg-emerald-500 opacity-20" />
            P10–P90 range
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stub tabs ─────────────────────────────────────────────────────────────────

function StubTab({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-slate-50 p-10 text-center">
      <p className="text-sm text-gray-400 font-medium">{label}</p>
      <p className="text-xs text-gray-300 mt-1">Coming in the next update.</p>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

type TabId = 'portfolio' | 'analysis' | 'tax' | 'ips';

const TABS: { id: TabId; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'tax', label: 'Tax & Planning' },
  { id: 'ips', label: 'IPS Document' },
];

interface Props {
  plan: V3Plan;
  backtest: BacktestState;
  answers: IntakeAnswers;
}

export default function PlanResults({ plan, backtest, answers }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('portfolio');

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'portfolio' && (
        <PortfolioTab plan={plan} backtest={backtest} answers={answers} />
      )}
      {activeTab === 'analysis' && <StubTab label="Analysis" />}
      {activeTab === 'tax' && <StubTab label="Tax & Planning" />}
      {activeTab === 'ips' && <StubTab label="IPS Document" />}
    </div>
  );
}
