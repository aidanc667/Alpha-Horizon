'use client';

import React, { useState, useMemo } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
  PieChart, Pie, Cell,
} from 'recharts';
import type { V3Plan } from '@/lib/agents/types';
import type { BacktestState } from './PlannerTab';
import type { IntakeAnswers } from '@/lib/agents/types';
import type { IPSDocument } from '@/types';
import { IPSTab } from './IPSDocument';
import { generateProjectionSeries } from '@/lib/projectionSeries';

// ─── Format helpers ────────────────────────────────────────────────────────────

const fmt$ = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtY = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1_000).toFixed(0)}k`;

// ─── Math helpers (Abramowitz & Stegun 7.1.26, max error 1.5e-7) ──────────────

function erfApprox(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const r = 1 - p * Math.exp(-x * x);
  return x >= 0 ? r : -r;
}
const normalCDF = (z: number) => 0.5 * (1 + erfApprox(z / Math.SQRT2));
const normalPDF = (z: number) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);

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

const SLICE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#64748b'];

const ACCOUNT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  taxable:     { bg: 'bg-slate-100',  text: 'text-slate-600',  label: 'Taxable' },
  roth:        { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Roth IRA' },
  traditional: { bg: 'bg-blue-50',    text: 'text-blue-700',   label: '401(k)' },
  hsa:         { bg: 'bg-amber-50',   text: 'text-amber-700',  label: 'HSA' },
  any:         { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Any' },
};

// ─── Tab 1 — Portfolio ─────────────────────────────────────────────────────────

function MonteCarloTable({ plan, stats, answers }: { plan: V3Plan; stats: V3Plan['portfolio']['statistics']; answers: IntakeAnswers }) {
  const [mcExpanded, setMcExpanded] = useState(false);
  const mcProj = plan.monteCarlo.projections;
  const horizon = answers.timeHorizon;

  // Build 5–6 milestone years that span the horizon without duplicates
  function buildMilestones(h: number): number[] {
    if (h <= 5)  return [1, 2, 3, Math.max(4, h - 1), h].filter((y, i, a) => y > 0 && a.indexOf(y) === i);
    if (h <= 10) return [1, 3, 5, Math.round(h * 0.75), h].filter((y, i, a) => a.indexOf(y) === i);
    if (h <= 20) return [1, 3, 5, 10, Math.round(h * 0.75), h].filter((y, i, a) => a.indexOf(y) === i);
    if (h <= 30) return [1, 5, 10, 15, Math.round(h * 0.75), h].filter((y, i, a) => a.indexOf(y) === i);
    return [1, 5, 10, 20, Math.round(h * 0.5), Math.round(h * 0.75), h].filter((y, i, a) => a.indexOf(y) === i);
  }

  const milestones = buildMilestones(horizon);
  const mcRows = milestones.map(yr => {
    const exact   = mcProj.find(p => p.year === yr);
    const nearest = mcProj.reduce((best, p) =>
      Math.abs(p.year - yr) < Math.abs(best.year - yr) ? p : best
    );
    return { ...(exact ?? nearest), displayYear: yr };
  });
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 text-left"
        onClick={() => setMcExpanded(x => !x)}
      >
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest">
          Monte Carlo Projection Table
        </h3>
        <span className="text-gray-400 text-xs">{mcExpanded ? '▲ Collapse' : '▼ Expand'}</span>
      </button>
      {mcExpanded && (
        <div className="px-5 pb-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="text-left pb-2 font-medium">Year</th>
                <th className="text-right pb-2 font-medium">P10 (Bear)</th>
                <th className="text-right pb-2 font-medium">P50 (Median)</th>
                <th className="text-right pb-2 font-medium">P90 (Bull)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {mcRows.map(row => {
                const isGoal = row.displayYear === horizon;
                return (
                  <tr key={row.displayYear} className={isGoal ? 'bg-emerald-50' : ''}>
                    <td className="py-2 font-mono font-bold text-gray-700">
                      Yr {row.displayYear}
                      {isGoal && (
                        <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600 bg-emerald-100 px-1 py-0.5 rounded">
                          Goal
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right font-mono text-red-500">{fmt$(row.p10)}</td>
                    <td className={`py-2 text-right font-mono font-bold ${isGoal ? 'text-emerald-700' : 'text-gray-900'}`}>{fmt$(row.p50)}</td>
                    <td className="py-2 text-right font-mono text-emerald-600">{fmt$(row.p90)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-gray-400 mt-3">
            Analytical lognormal model · µ={fmtPct(stats.expectedReturn)} σ={fmtPct(stats.expectedVolatility)} ·
            Includes ${answers?.monthlyContribution ?? 0}/mo contributions
          </p>
        </div>
      )}
    </div>
  );
}

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

  // ── Projection chart data — capped at 40 years for readability
  const projectionYears = Math.min(Math.max(answers.timeHorizon, 5), 40);
  const projData = useMemo(
    () =>
      generateProjectionSeries(
        answers.startingCapital,
        answers.monthlyContribution,
        stats.expectedReturn,
        stats.expectedVolatility,
        projectionYears,
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
      projectionYears,
    ],
  );

  const p50final = projData.at(-1)?.p50 ?? 0;
  const p10final = projData.at(-1)?.p10 ?? 0;
  const bt = backtest.result;

  // ── Strategy Analytics base values (needed by contribSensitivity below) ───
  const T   = answers.timeHorizon;
  const mu  = stats.expectedReturn;
  const sig = stats.expectedVolatility;

  // ── Contribution sensitivity — P(success) at +$250, +$500, +$1000/mo ─────
  const goalAmt = plan.monteCarlo.inputs.initialValue > 0 ? (answers.goalAmount ?? 0) : 0;
  const contribSensitivity = useMemo(() => {
    if (!goalAmt || goalAmt <= 0) return null;
    const v0 = answers.startingCapital;
    const driftAdj = (mu - 0.5 * sig * sig) * T;
    const spread   = sig * Math.sqrt(T);
    if (spread <= 0 || T <= 0) return null;

    function successProb(pmt: number): number {
      const rm = Math.pow(1 + mu, 1 / 12) - 1;
      const contribFV = rm < 1e-9 ? pmt * T * 12 : pmt * ((Math.pow(1 + rm, T * 12) - 1) / rm);
      const lumpTarget = Math.max(1, goalAmt - contribFV);
      const z = (Math.log(lumpTarget / Math.max(1, v0)) - driftAdj) / spread;
      // normal CDF via erfApprox
      const cdf = (x: number) => 0.5 * (1 + erfApprox(x / Math.SQRT2));
      return Math.min(1, Math.max(0, cdf(-z)));
    }

    const base = successProb(answers.monthlyContribution);
    if (base >= 0.85) return null; // already on track — no nudge needed
    return [
      { label: 'Current', extra: 0,    prob: base },
      { label: '+$250/mo', extra: 250,  prob: successProb(answers.monthlyContribution + 250) },
      { label: '+$500/mo', extra: 500,  prob: successProb(answers.monthlyContribution + 500) },
      { label: '+$1K/mo',  extra: 1000, prob: successProb(answers.monthlyContribution + 1000) },
    ];
  }, [goalAmt, answers.startingCapital, answers.monthlyContribution, mu, sig, T]);
  const btVtFinal = bt ? bt.dailyData.at(-1)?.benchmarkValue ?? 0 : 0;
  const btAlphaDlr = bt ? fmt$(bt.metrics.endingValue - btVtFinal) : null;
  const btReturn = bt ? `+${bt.metrics.totalReturnPct.toFixed(0)}%` : null;

  // ── Strategy Analytics: forward-looking, analytically computed ────────────
  const rf = macro.macroData.treasury10Y;
  const maxDD = stats.maxDrawdownEstimate;
  // Sortino semi-deviation: E[min(R-rf, 0)^2] for normal N(mu, sig^2).
  // Using rfExcess = rf - mu (i.e. -delta) so that normalCDF(rfExcess/sig)
  // = Phi(-delta/sig) and the product term flips sign correctly.
  // Verified: identical result to the canonical delta-form.
  const rfExcess = rf - mu;
  const zS = sig > 0 ? rfExcess / sig : 0;
  const semiDevSq = (rfExcess * rfExcess + sig * sig) * normalCDF(zS) + rfExcess * sig * normalPDF(zS);
  const semiDev = Math.sqrt(Math.max(semiDevSq, 0));
  const sortinoRatio = semiDev > 0 ? (mu - rf) / semiDev : 0;

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

      </div>

      {/* ── Allocation + risk metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-4">
        {/* Allocation pie + bars */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4">
            Portfolio Allocation
          </h3>
          <div className="flex gap-5 items-center">
            {/* Pie chart */}
            <div className="w-28 h-28 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={alloc.map((s) => ({ name: s.ticker, value: Math.round(s.weight * 100) }))}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    outerRadius={52}
                    innerRadius={20}
                    strokeWidth={2}
                    stroke="#fff"
                  >
                    {alloc.map((_, i) => (
                      <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val) => [`${val}%`, '']}
                    contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Bars */}
            <div className="flex-1 space-y-3 min-w-0">
              {alloc.map((s, i) => {
                const color = SLICE_COLORS[i % SLICE_COLORS.length];
                const pctVal = (s.weight * 100).toFixed(0);
                const dollars = fmt$(Math.round(s.weight * answers.startingCapital));
                const acc = ACCOUNT_COLORS[s.accountPlacement] ?? ACCOUNT_COLORS.any;
                return (
                  <div key={s.ticker} className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-mono text-xs font-bold text-gray-900 w-10 flex-shrink-0">
                      {s.ticker}
                    </span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pctVal}%`, backgroundColor: color }}
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
        </div>

        {/* Financial Metrics */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4">
            Financial Metrics
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="Expected CAGR"
              value={`+${(mu * 100).toFixed(1)}%/yr`}
              sub="from CMAs — weighted by allocation"
            />
            <MetricCard
              label="Real Return (inflation-adj.)"
              value={`+${Math.max(0, (mu - macro.macroData.cpiYoY) * 100).toFixed(1)}%/yr`}
              sub={`after ${(macro.macroData.cpiYoY * 100).toFixed(1)}% CPI — actual purchasing power gain`}
            />
            <MetricCard
              label="Annual Volatility"
              value={`${(sig * 100).toFixed(1)}%/yr`}
              sub="from covariance matrix — 1σ band"
            />
            <MetricCard
              label="Sharpe Ratio"
              value={stats.sharpeRatio.toFixed(2)}
              sub="excess return per unit of total risk"
            />
            <MetricCard
              label="Est. Max Drawdown"
              value={`-${(maxDD * 100).toFixed(1)}%`}
              sub={`simulated P50 — deepest trough over ${plan.clientProfile.timeHorizon.yearsToGoal}yr horizon`}
            />
            <MetricCard
              label="Sortino Ratio"
              value={sortinoRatio.toFixed(2)}
              sub="excess return per unit of downside risk"
            />
          </div>
        </div>
      </div>

      {/* ── 401k Contribution + Match Callout */}
      {(() => {
        const has401k = answers.availableAccounts.some((a: string) => a.toLowerCase().includes('401'));
        if (!has401k) return null;

        const limit401k = (answers.age ?? 35) >= 50 ? 30500 : 23500;
        const matchPct = answers.employerMatchPct ?? 0;
        const matchDollar = matchPct > 0 ? Math.round(answers.annualIncome * matchPct / 100) : 0;

        // Check whether the optimizer actually placed any assets in a traditional/401k account
        const traditional401kAlloc = alloc.filter((s: { accountPlacement: string }) =>
          s.accountPlacement === 'traditional'
        );
        const has401kHoldings = traditional401kAlloc.length > 0;

        if (!has401kHoldings) {
          // Nothing placed in 401k — explain why and what to do with 401k contributions
          return (
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">401(k) — No Holdings Placed</p>
              <p className="text-xs text-blue-700">
                Your portfolio is all-equity with no bond ETFs. Bonds (e.g. BND) are the ideal 401(k) candidate because their interest income gets shielded from taxes. With this aggressive allocation, the optimizer placed everything in Taxable or Roth IRA instead.
              </p>
              <p className="text-xs text-blue-600">
                <strong>What to buy in your 401k:</strong> Contribute enough to capture your employer match, then buy the closest available equivalent to your equity allocation (typically a broad US index fund). Mirror the same percentages across all your accounts combined.
              </p>
              {matchDollar > 0 && (
                <div className="rounded-lg px-3 py-2 text-xs font-medium mt-1 bg-amber-100 text-amber-800">
                  ⚠ Make sure you&apos;re contributing at least {matchPct}% of salary (~{fmt$(Math.ceil(answers.annualIncome * matchPct / 100 / 12))}/mo) to capture your ~{fmt$(matchDollar)}/yr employer match — that&apos;s a 100% instant return.
                </div>
              )}
            </div>
          );
        }

        // Assets ARE placed in 401k — show the contribution pace tracker
        // Only count contributions proportional to 401k allocation weight
        const traditional401kWeight = traditional401kAlloc.reduce(
          (sum: number, s: { weight: number }) => sum + s.weight, 0
        );
        const est401kAnnual = Math.round(answers.monthlyContribution * 12 * traditional401kWeight);
        const gap = limit401k - est401kAnnual;
        const gapPerMonth = Math.max(0, Math.ceil(gap / 12));
        const contributingToMatch = matchPct > 0 && est401kAnnual >= answers.annualIncome * matchPct / 100;
        return (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">401(k) Contribution Tracker</p>
            <div className="flex flex-wrap gap-4 text-xs">
              <div>
                <span className="text-blue-400">Est. 401(k) pace</span>
                <span className="ml-2 font-mono font-bold text-blue-900">{fmt$(est401kAnnual)}/yr</span>
              </div>
              <div>
                <span className="text-blue-400">IRS limit{(answers.age ?? 35) >= 50 ? ' (catch-up)' : ''}</span>
                <span className="ml-2 font-mono font-bold text-blue-900">{fmt$(limit401k)}</span>
              </div>
              {gap > 0 && (
                <div>
                  <span className="text-blue-400">To max out</span>
                  <span className="ml-2 font-mono font-bold text-blue-900">+{fmt$(gapPerMonth)}/mo</span>
                </div>
              )}
            </div>
            {matchDollar > 0 && (
              <div className={`rounded-lg px-3 py-2 text-xs font-medium mt-1 ${contributingToMatch ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {contributingToMatch
                  ? `✓ You're capturing the full ${matchPct}% employer match (~${fmt$(matchDollar)}/yr in free money).`
                  : `⚠ You're leaving ~${fmt$(matchDollar)}/yr in employer match on the table. Increase contributions to ${fmt$(Math.ceil(answers.annualIncome * matchPct / 100 / 12))}/mo to capture it.`}
              </div>
            )}
            {gap <= 0 && (
              <p className="text-[11px] text-emerald-700 font-semibold">✓ You&apos;re maxing your 401(k) — excellent tax efficiency.</p>
            )}
          </div>
        );
      })()}

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
                <ReferenceArea x1="2020-02" x2="2020-04" fill="#ef4444" fillOpacity={0.06} />
                <ReferenceArea x1="2022-01" x2="2022-12" fill="#ef4444" fillOpacity={0.06} />
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
            {projectionYears}-Year Projection
          </h3>
          <div className="flex flex-wrap gap-3 mt-2">
            {(() => {
              const successProb = plan.monteCarlo.goalSuccessProbability;
              const probVal = successProb != null ? fmtPct(successProb) : '—';
              const goalGap = goalAmt > 0 && p50final > 0
                ? p50final >= goalAmt
                  ? `+${fmt$(Math.round(p50final - goalAmt))} surplus`
                  : `-${fmt$(Math.round(goalAmt - p50final))} gap`
                : null;
              return [
                { label: `P50 (yr ${projectionYears})`, value: fmt$(p50final) },
                { label: 'Success Prob.', value: probVal, highlight: successProb != null && successProb < 0.5 },
                ...(goalAmt > 0 ? [{ label: `Goal (${fmt$(goalAmt)}) gap`, value: goalGap ?? '—', highlight: false }] : []),
                { label: `P10 (yr ${projectionYears})`, value: fmt$(p10final), highlight: false },
              ].map(({ label, value, highlight }) => (
                <span
                  key={label}
                  className={`text-[11px] font-mono border rounded-md px-2 py-0.5 ${highlight ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-gray-100'}`}
                >
                  <span className="text-gray-500">{label}:</span>{' '}
                  <span className={`font-bold ${highlight ? 'text-amber-700' : 'text-gray-800'}`}>{value}</span>
                </span>
              ));
            })()}
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

      {/* ── Monte Carlo Projection Table */}
      <MonteCarloTable plan={plan} stats={stats} answers={answers} />

      {/* ── Contribution Sensitivity */}
      {contribSensitivity && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-blue-900 uppercase tracking-widest">
              Boost Your Success Probability
            </h3>
            <span className="text-[10px] font-mono text-blue-400">Goal: {fmt$(goalAmt)}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {contribSensitivity.map(({ label, extra, prob }) => (
              <div
                key={label}
                className={`rounded-lg p-3 text-center ${extra === 0 ? 'bg-white border border-blue-200' : 'bg-blue-600 text-white'}`}
              >
                <p className={`text-lg font-black font-mono ${extra === 0 ? 'text-blue-700' : 'text-white'}`}>
                  {fmtPct(prob)}
                </p>
                <p className={`text-[10px] font-semibold mt-0.5 ${extra === 0 ? 'text-blue-400' : 'text-blue-200'}`}>
                  {label}
                </p>
                {extra > 0 && (
                  <p className="text-[9px] text-blue-300 mt-0.5">+{fmt$(extra * 12)}/yr</p>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-blue-400 mt-2">
            Based on {fmt$(answers.monthlyContribution)}/mo current contributions · lognormal model · {answers.timeHorizon}-year horizon
          </p>
        </div>
      )}

      {/* ── Catch-up contribution callout */}
      {(answers.age ?? 35) >= 50 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
          <span className="text-lg flex-shrink-0">🎯</span>
          <div>
            <p className="text-xs font-bold text-emerald-800">Catch-up contributions available (age {answers.age})</p>
            <p className="text-[11px] text-emerald-700 mt-0.5">
              You can contribute <strong>$30,500/yr</strong> to your 401k (vs $23,500) and <strong>$8,000/yr</strong> to your IRA (vs $7,000).
              {' '}That&apos;s an extra <strong>$8,000/yr</strong> in tax-advantaged space — apply it in the savings waterfall below.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 2 — Analysis ─────────────────────────────────────────────────────────

// Static factor classification for known ETF tickers
const FACTOR_BUCKET: Record<string, 'growth' | 'value' | 'intl' | 'fixed'> = {
  VOO: 'growth', VTI: 'growth', QQQM: 'growth', MTUM: 'growth',
  AVUV: 'value', SCHD: 'value', AVDV: 'value',
  VEA: 'intl', VWO: 'intl', VXUS: 'intl', VT: 'intl', BNDX: 'intl',
  BND: 'fixed', VTEB: 'fixed', SCHP: 'fixed', HYG: 'fixed', VCIT: 'fixed',
  SGOV: 'fixed', USFR: 'fixed', VNQ: 'fixed', IAU: 'fixed', VPU: 'fixed',
};

// VT benchmark constants (from ETF universe CMAs)
const VT_RETURN    = 0.072;
const VT_VOL       = 0.163;
const VT_MAX_DD    = 34.0; // COVID drawdown pct

function AnalysisTab({
  plan,
  backtest,
}: {
  plan: V3Plan;
  backtest: BacktestState;
}) {
  const stats    = plan.portfolio.statistics;
  const alloc    = plan.portfolio.allocation;
  const taxOpt   = plan.taxOptimization;
  const riskFree = plan.economicIntel.assetClassOutlook.riskFreeRate;
  const bt       = backtest.result;

  // ── VaR 95th percentile (analytical)
  const var95 = stats.expectedReturn - 1.645 * stats.expectedVolatility;

  // ── Alpha attribution
  const valueTickers = new Set(['AVUV', 'AVDV', 'SCHD']);
  const intlTickers  = new Set(['VEA', 'VWO', 'VXUS', 'VT', 'AVDV', 'BNDX']);

  const factorWeight = alloc.filter(s => valueTickers.has(s.ticker)).reduce((a, s) => a + s.weight, 0);
  const factorBps    = Math.round(factorWeight * 150 * 100); // 150bps annualised SCV premium

  const taxBps = Math.round(taxOpt.estimatedAnnualSavings);

  const intlWeight = alloc.filter(s => intlTickers.has(s.ticker)).reduce((a, s) => a + s.weight, 0);
  const intlBps    = Math.round(intlWeight * 40 * 100); // 40bps diversification premium

  const muniRecs  = taxOpt.recommendations.filter(r => r.type === 'muni_bond');
  const bondBps   = muniRecs.reduce((a, r) => a + r.estimatedSavingsBps, 0);

  const costBps   = Math.round((0.0030 - stats.weightedExpenseRatio) * 10_000); // vs 30bps typical active

  const alphaRows = [
    { source: 'Factor Premium (est.)', bps: factorBps, desc: 'Historical Fama-French SCV premium — long-run estimate, not forward-looking' },
    { source: 'Tax Alpha', bps: taxBps, desc: 'Optimal asset location & muni bond selection' },
    { source: 'Intl. Diversification (est.)', bps: intlBps, desc: 'Historical diversification premium — compresses in high-valuation environments' },
    { source: 'Bond Efficiency', bps: bondBps, desc: 'Muni bond yield advantage for your bracket' },
    { source: 'Low-Cost Advantage', bps: Math.max(0, costBps), desc: 'vs 30bps average active fund expense ratio' },
  ].filter(r => r.bps > 0);

  const totalAlphaBps = alphaRows.reduce((a, r) => a + r.bps, 0);

  // ── Benchmark comparison
  const vtSharpe   = (VT_RETURN - riskFree) / VT_VOL;
  const portSharpe = stats.sharpeRatio;
  const portMaxDD  = bt ? bt.metrics.maxDrawdown : stats.maxDrawdownEstimate * 100;
  const vtMaxDDVal = bt ? (bt.dailyData.length > 0
    ? (() => {
        let peak = -Infinity;
        let dd = 0;
        for (const d of bt.dailyData) {
          if (d.benchmarkValue > peak) peak = d.benchmarkValue;
          const cur = ((peak - d.benchmarkValue) / peak) * 100;
          if (cur > dd) dd = cur;
        }
        return dd;
      })()
    : VT_MAX_DD)
    : VT_MAX_DD;

  const taxProfile  = plan.clientProfile.taxProfile;
  const afterTaxPort = stats.expectedReturn * (1 - taxProfile.ltcgRate * 0.5); // rough blended rate
  const afterTaxVT   = VT_RETURN * (1 - taxProfile.ltcgRate * 0.5);
  const afterTaxDelta = afterTaxPort - afterTaxVT;

  // ── Factor exposure bar
  const buckets = { growth: 0, value: 0, intl: 0, fixed: 0 };
  for (const s of alloc) {
    const bucket = FACTOR_BUCKET[s.ticker] ?? (
      s.category === 'safety' || s.category === 'income' ? 'fixed' : 'growth'
    );
    buckets[bucket] += s.weight;
  }
  const total = Object.values(buckets).reduce((a, v) => a + v, 0) || 1;
  const factorBars = [
    { label: 'GROWTH', weight: buckets.growth / total, color: '#10b981' },
    { label: 'VALUE',  weight: buckets.value  / total, color: '#8b5cf6' },
    { label: 'INTL',   weight: buckets.intl   / total, color: '#3b82f6' },
    { label: 'FIXED',  weight: buckets.fixed  / total, color: '#f59e0b' },
  ].filter(b => b.weight > 0.005);

  return (
    <div className="space-y-4">
      {/* ── VaR Card */}
      <div className="rounded-xl border border-red-100 bg-red-50 p-4">
        <p className="text-[10px] uppercase tracking-widest text-red-500 font-bold mb-1">
          95th Percentile 1-Year Loss (VaR)
        </p>
        <p className="font-mono text-2xl font-black text-red-600">
          {(var95 * 100).toFixed(1)}%
        </p>
        <p className="text-xs text-red-400 mt-1">
          In a bad year (95th percentile), this portfolio could lose approximately{' '}
          <span className="font-semibold">{Math.abs(var95 * 100).toFixed(1)}%</span>.
          Computed as: E[R] − 1.645σ = {fmtPct(stats.expectedReturn)} − 1.645 × {fmtPct(stats.expectedVolatility)}.
        </p>
      </div>

      {/* ── Alpha Attribution */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest">
            Alpha Attribution
          </h3>
          <span className="font-mono text-sm font-bold text-emerald-600">
            +{totalAlphaBps} bps/yr total edge
          </span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
              <th className="text-left pb-2 font-medium">Source</th>
              <th className="text-right pb-2 font-medium w-20">Basis Pts</th>
              <th className="text-left pb-2 pl-4 font-medium hidden sm:table-cell">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {alphaRows.map(r => (
              <tr key={r.source}>
                <td className="py-2 font-medium text-gray-800">{r.source}</td>
                <td className="py-2 text-right font-mono font-bold text-emerald-600">
                  +{r.bps}
                </td>
                <td className="py-2 pl-4 text-gray-400 hidden sm:table-cell">{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Benchmark Comparison */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-3">
          Benchmark Comparison — vs VT (Total World)
        </h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
              <th className="text-left pb-2 font-medium">Metric</th>
              <th className="text-right pb-2 font-medium">This Portfolio</th>
              <th className="text-right pb-2 font-medium">VT (World)</th>
              <th className="text-right pb-2 font-medium text-emerald-600">Delta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {[
              {
                label: 'Expected Return',
                port: fmtPct(stats.expectedReturn),
                vt: fmtPct(VT_RETURN),
                delta: (stats.expectedReturn - VT_RETURN) * 100,
                fmt: (d: number) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`,
              },
              {
                label: 'Volatility',
                port: fmtPct(stats.expectedVolatility),
                vt: fmtPct(VT_VOL),
                delta: (stats.expectedVolatility - VT_VOL) * 100,
                fmt: (d: number) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`,
                invertColor: true,
              },
              {
                label: 'Sharpe Ratio',
                port: portSharpe.toFixed(2),
                vt: vtSharpe.toFixed(2),
                delta: portSharpe - vtSharpe,
                fmt: (d: number) => `${d >= 0 ? '+' : ''}${d.toFixed(2)}`,
              },
              {
                label: 'Max Drawdown',
                port: `−${portMaxDD.toFixed(1)}%`,
                vt: `−${vtMaxDDVal.toFixed(1)}%`,
                delta: vtMaxDDVal - portMaxDD,
                fmt: (d: number) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`,
                sub: bt ? 'from backtest' : 'estimated',
              },
              {
                label: 'After-Tax Return',
                port: fmtPct(afterTaxPort),
                vt: fmtPct(afterTaxVT),
                delta: afterTaxDelta * 100,
                fmt: (d: number) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`,
              },
            ].map(({ label, port, vt, delta, fmt, invertColor, sub }) => {
              const positive = invertColor ? delta <= 0 : delta >= 0;
              return (
                <tr key={label}>
                  <td className="py-2 text-gray-700">
                    {label}
                    {sub && <span className="ml-1 text-[9px] text-gray-400">({sub})</span>}
                  </td>
                  <td className="py-2 text-right font-mono font-semibold text-gray-900">{port}</td>
                  <td className="py-2 text-right font-mono text-gray-500">{vt}</td>
                  <td
                    className={`py-2 text-right font-mono font-bold ${
                      positive ? 'text-emerald-600' : 'text-red-500'
                    }`}
                  >
                    {fmt(delta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!bt && (
          <p className="text-[10px] text-gray-400 mt-2">
            Max drawdown is a parametric estimate. Run complete for historical figure.
          </p>
        )}
      </div>

      {/* ── Factor Exposure bar */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4">
          Factor Exposure
        </h3>
        <div className="flex h-5 rounded-full overflow-hidden gap-0.5 mb-3">
          {factorBars.map(b => (
            <div
              key={b.label}
              style={{ width: `${b.weight * 100}%`, backgroundColor: b.color }}
              className="transition-all"
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {factorBars.map(b => (
            <div key={b.label} className="flex items-center gap-1.5 text-xs text-gray-600">
              <div
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: b.color }}
              />
              <span className="font-mono font-bold text-[10px] uppercase tracking-wider">
                {b.label}
              </span>
              <span className="font-mono text-gray-500">
                {(b.weight * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Risk Parameters */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4">
          Risk Parameters
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              label: 'Max Drawdown Tolerance',
              value: `${(plan.clientProfile.riskProfile.maxEquityAllowed * 0.55 * 100).toFixed(0)}%`,
              sub: `${(plan.clientProfile.riskProfile.maxEquityAllowed * 100).toFixed(0)}% max equity → ~${(plan.clientProfile.riskProfile.maxEquityAllowed * 55).toFixed(0)}% DD capacity`,
            },
            {
              label: 'Concentration Risk',
              value: alloc.length <= 4 ? 'Moderate' : alloc.length <= 6 ? 'Low' : 'Minimal',
              sub: `${alloc.length} positions; largest ${(Math.max(...alloc.map(s => s.weight)) * 100).toFixed(0)}%`,
            },
            {
              label: 'Sequence Risk',
              value: plan.clientProfile.timeHorizon.isNearDrawdown ? 'HIGH' : plan.clientProfile.timeHorizon.isInDrawdownPhase ? 'CRITICAL' : 'Low',
              sub: `${plan.clientProfile.timeHorizon.yearsToGoal}yr horizon (${plan.clientProfile.timeHorizon.bucket})`,
            },
            {
              label: 'Inflation Sensitivity',
              value: (() => {
                const tipWeight = alloc.filter(s => ['SCHP', 'VNQ', 'IAU'].includes(s.ticker)).reduce((a, s) => a + s.weight, 0);
                return tipWeight >= 0.10 ? 'Well-hedged' : tipWeight >= 0.05 ? 'Partial hedge' : 'Unhedged';
              })(),
              sub: `Real assets + TIPS allocation`,
            },
          ].map(({ label, value, sub }) => (
            <MetricCard key={label} label={label} value={value} sub={sub} />
          ))}
        </div>
      </div>

    </div>
  );
}

// ─── Tab 3 — Tax & Planning ────────────────────────────────────────────────────

function TaxPlanningTab({
  plan,
  answers,
}: {
  plan: V3Plan;
  answers: IntakeAnswers;
}) {
  const taxOpt     = plan.taxOptimization;
  const taxProfile = plan.clientProfile.taxProfile;
  const alloc      = plan.portfolio.allocation;

  // ── Tax alpha dollar estimate
  const taxAlpha$ = Math.round((taxOpt.estimatedAnnualSavings * answers.startingCapital) / 10_000);

  // ── Asset location rationale
  const PLACEMENT_WHY: Record<string, string> = {
    taxable:     'Tax-efficient; qualified dividends taxed at LTCG rates',
    roth:        'High-growth; maximize tax-free compounding',
    traditional: 'Tax-inefficient income; shelter from ordinary rates',
    hsa:         'Triple tax-advantaged — best account for any holding',
    any:         'Minimal tax consequence; place in any available account',
  };
  const PLACEMENT_BENEFIT: Record<string, string> = {
    taxable:     '~0 drag',
    roth:        '~15–20% drag saved on growth',
    traditional: '~10–15% drag saved on distributions',
    hsa:         'Full triple tax benefit',
    any:         'Minimal',
  };

  // ── Paycheck waterfall (priority-ranked)
  const accts = answers.availableAccounts.map((a: string) => a.toLowerCase());
  const hasHSA    = accts.some((a: string) => a.includes('hsa'));
  const has401k   = accts.some((a: string) => a.includes('401k') || a.includes('401(k)') || a.includes('traditional'));
  const hasRoth   = accts.some((a: string) => a.includes('roth'));

  type WfStep = { label: string; reason: string; badge: string; badgeColor: string; pct: number };
  const waterfall: WfStep[] = [];

  if (!answers.financialSnapshot?.hasEmergencyFund) {
    waterfall.push({ label: 'Emergency Fund (3–6 months)', reason: 'Prevents forced selling in a downturn', badge: 'CRITICAL', badgeColor: 'bg-red-100 text-red-700', pct: 20 });
  }
  if (answers.financialSnapshot?.hasHighInterestDebt) {
    waterfall.push({ label: 'High-Interest Debt Payoff', reason: 'Guaranteed 8–24% return; beats any portfolio', badge: 'CRITICAL', badgeColor: 'bg-red-100 text-red-700', pct: 20 });
  }
  if (hasHSA) {
    waterfall.push({ label: 'HSA Max ($4,300/yr)', reason: 'Triple tax-advantaged: deductible, grows tax-free, tax-free withdrawal', badge: 'HIGH', badgeColor: 'bg-amber-100 text-amber-700', pct: 5 });
  }
  if (has401k) {
    waterfall.push({ label: '401(k) to Employer Match', reason: '100% guaranteed return on matched dollars', badge: 'HIGH', badgeColor: 'bg-amber-100 text-amber-700', pct: 6 });
  }
  if (hasRoth && taxProfile.federalMarginalRate <= 0.24) {
    waterfall.push({ label: 'Roth IRA Max ($7,000/yr)', reason: 'Current bracket favorable for Roth; lock in today\'s rate', badge: 'HIGH', badgeColor: 'bg-amber-100 text-amber-700', pct: 7 });
  }
  if (has401k) {
    waterfall.push({ label: '401(k) to $23,500 limit', reason: 'Pre-tax reduction lowers current year tax bill', badge: 'MEDIUM', badgeColor: 'bg-blue-100 text-blue-700', pct: 15 });
  }
  waterfall.push({ label: 'Taxable Brokerage', reason: 'Index ETFs are highly tax-efficient in taxable accounts', badge: 'STANDARD', badgeColor: 'bg-gray-100 text-gray-600', pct: 100 });

  // ── Roth vs Traditional analysis (only shown when agent flagged a conversion opportunity)
  const rothConversionOpportunity = taxOpt.recommendations.some(r => r.type === 'roth_conversion');
  const currentRate = taxProfile.federalMarginalRate;
  const mc = plan.monteCarlo;
  const finalP50 = mc.projections.at(-1)?.p50 ?? 0;
  const annualWithdrawal = finalP50 * 0.04;
  const projRetirementRate =
    annualWithdrawal > 500_000 ? 0.35
    : annualWithdrawal > 200_000 ? 0.32
    : annualWithdrawal > 100_000 ? 0.24
    : annualWithdrawal > 47_150  ? 0.22
    : 0.12;
  const rothAdvantaged = currentRate < projRetirementRate;
  const breakEvenYrs   = Math.abs(currentRate - projRetirementRate) < 0.02 ? 0 :
    Math.round(20 * Math.abs(currentRate - projRetirementRate) / 0.03);

  // ── Action plan (from tax recommendations + risk warnings)
  type ActionItem = { badge: string; badgeColor: string; action: string; why: string; impact: string };
  const actions: ActionItem[] = [
    ...taxOpt.recommendations.map(r => ({
      badge: r.priority === 'high' ? 'HIGH' : r.priority === 'medium' ? 'MEDIUM' : 'LOW',
      badgeColor: r.priority === 'high' ? 'bg-amber-100 text-amber-700'
        : r.priority === 'medium' ? 'bg-blue-100 text-blue-700'
        : 'bg-gray-100 text-gray-600',
      action: r.title,
      why: r.detail,
      impact: `~${r.estimatedSavingsBps} bps/yr`,
    })),
    ...plan.riskAnalysis.warnings.slice(0, 3).map(w => ({
      badge: 'MEDIUM',
      badgeColor: 'bg-blue-100 text-blue-700',
      action: w,
      why: 'Flagged by risk analysis agent',
      impact: 'Risk reduction',
    })),
  ];

  // ── Tax profile table data ────────────────────────────────────────────────
  const niitApplies = taxProfile.investmentIncomeMarginalRate > taxProfile.combinedMarginalRate;
  const niitRate    = niitApplies ? taxProfile.investmentIncomeMarginalRate - taxProfile.combinedMarginalRate : 0;

  // Estimate tax drag comparison: optimized placement vs all-assets-in-taxable-brokerage
  const bondAlloc   = alloc.filter(s => s.category === 'income' || s.category === 'safety');
  const equityAlloc = alloc.filter(s => s.category === 'growth' || s.category === 'alternative');
  const bondWeight  = bondAlloc.reduce((s, x) => s + x.weight, 0);
  const equityWeight = equityAlloc.reduce((s, x) => s + x.weight, 0);
  const assumedBondYield = 0.045;
  const assumedDividendYield = 0.016;
  const annualCapital = answers.startingCapital;
  const mu = plan.portfolio.statistics.expectedReturn;

  // Baseline: ALL assets in taxable brokerage (no account optimization)
  // Bonds: interest taxed at ordinary income rate
  // Equity: dividends at LTCG + annual turnover/gains at LTCG (ETFs ~1% turnover)
  const dragAllTaxable = Math.round(
    annualCapital * (
      bondWeight * assumedBondYield * taxProfile.investmentIncomeMarginalRate +
      equityWeight * (assumedDividendYield * taxProfile.ltcgRate + 0.01 * mu * taxProfile.ltcgRate)
    )
  );

  // Optimized: actual placement
  const sheltered = alloc.filter(s => s.accountPlacement === 'traditional' || s.accountPlacement === 'hsa');
  const shelteredWeight = sheltered.reduce((s, x) => s + x.weight, 0);
  const rothHeld = alloc.filter(s => s.accountPlacement === 'roth');
  const rothWeight = rothHeld.reduce((s, x) => s + x.weight, 0);
  const taxableHeld = alloc.filter(s => s.accountPlacement === 'taxable' || s.accountPlacement === 'any');
  const taxableWeight = taxableHeld.reduce((s, x) => s + x.weight, 0);
  // Taxable: equity dividends at LTCG (index ETFs have near-zero turnover)
  const taxableDrag = annualCapital * taxableWeight * assumedDividendYield * taxProfile.ltcgRate;
  // Roth: dividends AND eventual growth are tax-free — annual equivalent benefit vs taxable
  const rothGrowthBenefit = annualCapital * rothWeight * (assumedDividendYield * taxProfile.ltcgRate + mu * taxProfile.ltcgRate * 0.45);
  // Sheltered (trad/HSA): bond income deferred — no current-year tax
  const shelteredBenefit = annualCapital * shelteredWeight * assumedBondYield * taxProfile.investmentIncomeMarginalRate;
  const dragOptimized = Math.max(0, Math.round(taxableDrag));
  const locationSaving$ = Math.max(0, Math.round(dragAllTaxable - taxableDrag + rothGrowthBenefit + shelteredBenefit));

  // ── Estimated annual income tax ──────────────────────────────────────────────
  function estimateFederalTax(income: number, filing: string): number {
    const stdDed = filing === 'married_filing_jointly' ? 30_000 : 15_000;
    const taxable = Math.max(0, income - stdDed);
    const brackets = filing === 'married_filing_jointly'
      ? [[23_850, 0.10], [96_950, 0.12], [206_700, 0.22], [394_600, 0.24], [501_050, 0.32], [751_600, 0.35], [Infinity, 0.37]]
      : [[11_925, 0.10], [48_475, 0.12], [103_350, 0.22], [197_300, 0.24], [250_525, 0.32], [626_350, 0.35], [Infinity, 0.37]];
    let tax = 0, remaining = taxable, prev = 0;
    for (const [ceil, rate] of brackets) {
      const inBracket = Math.min(remaining, (ceil as number) - prev);
      tax += inBracket * (rate as number);
      remaining -= inBracket;
      if (remaining <= 0) break;
      prev = ceil as number;
    }
    return Math.round(tax);
  }
  const estFederalTax = estimateFederalTax(answers.annualIncome, answers.filingStatus);
  const estStateTax = Math.round(answers.annualIncome * taxProfile.stateMarginalRate * 0.7);
  // SS wage base: $176,100 for 2025; 2026 SSA announcement expected Oct 2025.
  // Update this constant each October when SSA publishes the following year's limit.
  const SS_WAGE_BASE_2026 = 176_100; // TODO: update annually from https://www.ssa.gov/oact/cola/cbb.html
  const estFicaTax = Math.round(Math.min(answers.annualIncome, SS_WAGE_BASE_2026) * 0.0765);
  const estTotalAnnualTax = estFederalTax + estStateTax + estFicaTax;

  type RateRow = { label: string; rate: string; applies: boolean; highlight?: boolean; note?: string };
  const rateRows: RateRow[] = [
    {
      label: `Federal Income Tax`,
      rate: `${(taxProfile.federalMarginalRate * 100).toFixed(0)}%`,
      applies: true,
      note: 'Marginal rate on ordinary income',
    },
    {
      label: `${answers.state} State Tax`,
      rate: taxProfile.stateMarginalRate === 0 ? 'None' : `${(taxProfile.stateMarginalRate * 100).toFixed(1)}%`,
      applies: true,
      note: taxProfile.stateMarginalRate === 0 ? 'No state income tax' : 'Marginal state rate',
    },
    {
      label: 'Combined Marginal Rate',
      rate: `${(taxProfile.combinedMarginalRate * 100).toFixed(0)}%`,
      applies: true,
      highlight: true,
      note: 'Federal + state — applies to bond interest & dividends',
    },
    {
      label: 'Long-Term Capital Gains',
      rate: taxProfile.ltcgRate === 0 ? '0%' : `${(taxProfile.ltcgRate * 100).toFixed(0)}%`,
      applies: true,
      note: 'ETF appreciation held >1 year — lower than ordinary income',
    },
    {
      label: 'Net Investment Income Tax (§1411)',
      rate: `${(niitRate * 100).toFixed(1)}%`,
      applies: niitApplies,
      note: `Added on investment income above $${answers.filingStatus === 'married_filing_jointly' ? '250K' : '200K'} AGI`,
    },
    {
      label: 'Effective Investment Income Rate',
      rate: `${(taxProfile.investmentIncomeMarginalRate * 100).toFixed(1)}%`,
      applies: niitApplies,
      highlight: true,
      note: 'Combined + NIIT — applies to bond interest in taxable accounts',
    },
  ];

  return (
    <div className="space-y-4">
      {/* ── Tax Profile Table */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4">
          Your Tax Profile
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-6">
          {/* Rate table */}
          <div className="space-y-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-2 font-medium">Tax Type</th>
                  <th className="text-right pb-2 font-medium">Your Rate</th>
                  <th className="text-left pb-2 pl-3 font-medium hidden sm:table-cell">Applies to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rateRows.filter(r => r.applies).map(row => (
                  <tr key={row.label} className={row.highlight ? 'bg-slate-50' : ''}>
                    <td className={`py-2 ${row.highlight ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                      {row.label}
                    </td>
                    <td className={`py-2 text-right font-mono font-bold ${row.highlight ? 'text-gray-900' : 'text-gray-700'}`}>
                      {row.rate}
                    </td>
                    <td className="py-2 pl-3 text-gray-400 hidden sm:table-cell">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Estimated annual tax bill */}
            <div className="rounded-lg border border-gray-100 bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold mb-2">
                Estimated Annual Tax Bill
              </p>
              <div className="space-y-1.5">
                {[
                  { label: 'Federal Income Tax', value: estFederalTax },
                  { label: `${answers.state} State Tax`, value: estStateTax },
                  { label: 'FICA / Payroll Tax', value: estFicaTax },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-gray-500">{label}</span>
                    <span className="font-mono font-semibold text-gray-700">−{fmt$(value)}</span>
                  </div>
                ))}
                <div className="border-t border-gray-200 pt-1.5 flex justify-between text-xs">
                  <span className="font-semibold text-gray-800">Total Est. Annual Taxes</span>
                  <span className="font-mono font-black text-red-500">−{fmt$(estTotalAnnualTax)}</span>
                </div>
                <p className="text-[9px] text-gray-400 pt-0.5">
                  Includes standard deduction · excludes retirement contributions · FICA capped at {fmt$(SS_WAGE_BASE_2026)} SS wage base
                </p>
              </div>
            </div>
          </div>

          {/* Asset location impact */}
          <div className="rounded-lg bg-slate-50 p-4 flex flex-col justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold mb-3">
                Asset Location Impact
              </p>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">All assets in taxable</span>
                  <span className="font-mono text-xs font-bold text-red-500">−{fmt$(dragAllTaxable)}/yr</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">With asset location</span>
                  <span className="font-mono text-xs font-bold text-gray-700">−{fmt$(dragOptimized)}/yr</span>
                </div>
                <div className="border-t border-gray-200 pt-2 flex justify-between items-center">
                  <span className="text-xs font-semibold text-emerald-700">You save</span>
                  <span className="font-mono text-sm font-black text-emerald-600">+{fmt$(locationSaving$)}/yr</span>
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-[10px] text-gray-400">
              {shelteredWeight > 0 && (
                <p>• {(shelteredWeight * 100).toFixed(0)}% sheltered in tax-deferred accounts</p>
              )}
              {rothWeight > 0 && (
                <p>• {(rothWeight * 100).toFixed(0)}% in Roth for tax-free growth</p>
              )}
              {taxableWeight > 0 && (
                <p>• {(taxableWeight * 100).toFixed(0)}% in taxable (index ETFs — low turnover)</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tax Alpha Callout */}
      <div className="rounded-xl bg-emerald-600 p-4 text-white">
        <p className="text-[10px] uppercase tracking-widest text-emerald-200 font-bold mb-1">
          Estimated Annual Tax Savings
        </p>
        <p className="font-mono text-3xl font-black">
          {taxAlpha$ > 0 ? `${fmt$(taxAlpha$)}/yr` : `${taxOpt.estimatedAnnualSavings} bps/yr`}
        </p>
        <p className="text-emerald-100 text-xs mt-1">
          Through optimal asset location and{' '}
          {muniText(taxOpt)}
        </p>
      </div>

      {/* ── Asset Location Matrix */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-3">
          Asset Location Matrix
        </h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
              <th className="text-left pb-2 font-medium">Ticker</th>
              <th className="text-right pb-2 font-medium">Wt</th>
              <th className="text-left pb-2 pl-3 font-medium">Account</th>
              <th className="text-left pb-2 pl-3 font-medium hidden md:table-cell">Why</th>
              <th className="text-right pb-2 font-medium hidden sm:table-cell">Tax Benefit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {alloc.map(s => {
              const acc = ACCOUNT_COLORS[s.accountPlacement] ?? ACCOUNT_COLORS.any;
              return (
                <tr key={s.ticker}>
                  <td className="py-2 font-mono font-bold text-gray-900">{s.ticker}</td>
                  <td className="py-2 text-right font-mono text-gray-500">
                    {(s.weight * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 pl-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${acc.bg} ${acc.text}`}>
                      {acc.label}
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-gray-400 hidden md:table-cell">
                    {PLACEMENT_WHY[s.accountPlacement]}
                  </td>
                  <td className="py-2 text-right text-gray-500 hidden sm:table-cell">
                    {PLACEMENT_BENEFIT[s.accountPlacement]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Paycheck Waterfall */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4">
          Savings Priority Order
        </h3>
        <div className="space-y-2.5">
          {waterfall.map((step, i) => (
            <div key={step.label} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-slate-500">{i + 1}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-gray-800">{step.label}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ${step.badgeColor}`}>
                    {step.badge}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400">{step.reason}</p>
                <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${Math.min(step.pct, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Roth vs Traditional */}
      {rothConversionOpportunity && <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-3">
          Roth vs. Traditional Analysis
        </h3>
        <table className="w-full text-xs mb-3">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
              <th className="text-left pb-2 font-medium">Dimension</th>
              <th className="text-right pb-2 font-medium">Current</th>
              <th className="text-right pb-2 font-medium">Est. Retirement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            <tr>
              <td className="py-2 text-gray-700">Federal Marginal Rate</td>
              <td className="py-2 text-right font-mono font-bold text-gray-900">
                {(currentRate * 100).toFixed(0)}%
              </td>
              <td className="py-2 text-right font-mono text-gray-700">
                ~{(projRetirementRate * 100).toFixed(0)}%
              </td>
            </tr>
            <tr>
              <td className="py-2 text-gray-700">Est. Annual Withdrawal</td>
              <td className="py-2 text-right font-mono text-gray-500">—</td>
              <td className="py-2 text-right font-mono text-gray-700">
                {fmt$(Math.round(annualWithdrawal))}
              </td>
            </tr>
            <tr>
              <td className="py-2 text-gray-700">Break-even Year</td>
              <td className="py-2 text-right font-mono text-gray-500">—</td>
              <td className="py-2 text-right font-mono font-bold text-gray-900">
                {breakEvenYrs > 0 ? `~${breakEvenYrs} yrs` : 'Clear advantage now'}
              </td>
            </tr>
          </tbody>
        </table>
        <div className={`rounded-lg px-3 py-2 text-xs font-medium ${
          rothAdvantaged ? 'bg-emerald-50 text-emerald-800' : 'bg-blue-50 text-blue-800'
        }`}>
          <span className="font-bold">{rothAdvantaged ? 'Roth recommended: ' : 'Traditional recommended: '}</span>
          {rothAdvantaged
            ? `Current ${(currentRate * 100).toFixed(0)}% bracket is below your projected retirement rate of ${(projRetirementRate * 100).toFixed(0)}%. Pay tax now at the lower rate.`
            : `Current ${(currentRate * 100).toFixed(0)}% bracket is at or above retirement rate. Defer tax with traditional contributions.`
          }
        </div>
      </div>}

      {/* ── Action Plan */}
      {actions.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4">
            Action Plan
          </h3>
          <div className="space-y-3">
            {actions.map((item, i) => (
              <div key={i} className="flex gap-3 items-start">
                <span className={`text-[9px] px-2 py-1 rounded font-bold uppercase tracking-wide flex-shrink-0 mt-0.5 ${item.badgeColor}`}>
                  {item.badge}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800">{item.action}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{item.why}</p>
                </div>
                <span className="text-[10px] font-mono text-emerald-600 font-bold flex-shrink-0 mt-0.5">
                  {item.impact}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* ── Withdrawal Sequencing */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-3">
          Retirement Withdrawal Sequencing
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          When you retire, the order you withdraw from accounts has a significant tax impact. The conventional sequence minimizes lifetime taxes:
        </p>
        <ol className="space-y-2">
          {[
            { step: '1', label: 'Taxable Brokerage First', detail: 'Qualified dividends and long-term gains taxed at 0–20%. Use tax-loss harvesting to offset gains. Lets tax-deferred accounts compound longer.' },
            { step: '2', label: 'Traditional 401(k) / IRA', detail: 'Withdrawals taxed as ordinary income. Take Required Minimum Distributions (RMDs) starting at age 73 — plan contributions to keep future RMDs manageable.' },
            { step: '3', label: 'Roth IRA Last', detail: 'Qualified withdrawals are completely tax-free with no RMDs. Let this compound as long as possible — it\'s your most valuable tax shelter in retirement.' },
          ].map(({ step, label, detail }) => (
            <li key={step} className="flex gap-3 items-start">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center mt-0.5">{step}</span>
              <div>
                <p className="text-xs font-semibold text-gray-800">{label}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-[10px] text-gray-400 mt-3 border-t border-gray-50 pt-2">
          This is general guidance — optimal sequencing depends on your future tax bracket, Social Security timing, and Roth conversion strategy. Consult a tax advisor for personalized withdrawal planning.
        </p>
      </div>
    </div>
  );
}

function muniText(taxOpt: V3Plan['taxOptimization']): string {
  const hasMuni = taxOpt.recommendations.some(r => r.type === 'muni_bond');
  return hasMuni ? 'muni bond selection.' : 'tax-efficient fund placement.';
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
  ips?: IPSDocument;
}

export default function PlanResults({ plan, backtest, answers, ips }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('portfolio');
  const belowThreshold = plan.criticScore.scores.overall < 80;

  return (
    <div className="space-y-4">
      {/* Quality warning banner */}
      {belowThreshold && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <span className="text-amber-500 text-base leading-none mt-0.5">⚠</span>
          <div>
            <p className="text-xs font-bold text-amber-800">
              Portfolio scored {plan.criticScore.scores.overall}/100 — below the 80/100 quality threshold
            </p>
            <p className="text-[11px] text-amber-700 mt-0.5">
              {plan.criticScore.improvementSuggestions[0] ?? 'Consider adjusting your risk tolerance or time horizon inputs and re-running the planner.'}
            </p>
          </div>
        </div>
      )}
      {/* Legal disclaimer */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 flex items-start gap-2.5">
        <span className="text-slate-400 text-xs leading-none mt-0.5 flex-shrink-0">ⓘ</span>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          <span className="font-semibold text-slate-600">For educational purposes only. Not investment advice.</span>{' '}
          This analysis is generated by an automated system and does not constitute a recommendation to buy or sell any security.
          Consult a licensed financial advisor before implementing any investment strategy.
          Past performance does not guarantee future results.
        </p>
      </div>

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
      {activeTab === 'analysis' && (
        <AnalysisTab plan={plan} backtest={backtest} />
      )}
      {activeTab === 'tax' && <TaxPlanningTab plan={plan} answers={answers} />}
      {activeTab === 'ips' && <IPSTab ips={ips ?? plan.ips} />}
    </div>
  );
}
