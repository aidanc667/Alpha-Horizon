'use client';

// ─── PortfolioPlanCard ────────────────────────────────────────────────────────

import React, { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import type { PortfolioPlan, AgentRunState, IntakeAnswers, AllocationSlice } from '../types';
import PortfolioPerformanceChart from './PortfolioPerformanceChart';

interface PortfolioPlanCardProps {
  plan: PortfolioPlan;
  runState: AgentRunState;
  answers: IntakeAnswers;
  onReset: () => void;
}

type TabKey = 'summary' | 'allocation' | 'benchmark' | 'risk' | 'tax' | 'manual' | 'macro';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'summary',    label: 'Summary' },
  { key: 'allocation', label: 'Allocation' },
  { key: 'benchmark',  label: 'vs Benchmark' },
  { key: 'risk',       label: 'Risk' },
  { key: 'tax',        label: 'Tax Plan' },
  { key: 'manual',     label: 'Owner Manual' },
  { key: 'macro',      label: 'Macro' },
];

const BUCKET_COLORS: Record<AllocationSlice['bucket'], string> = {
  safety:      'bg-blue-500/80',
  growth:      'bg-emerald-500/80',
  income:      'bg-amber-500/80',
  alternative: 'bg-purple-500/80',
};

const BUCKET_HEX: Record<AllocationSlice['bucket'], string> = {
  safety:      '#3b82f6',
  growth:      '#10b981',
  income:      '#f59e0b',
  alternative: '#a855f7',
};

const BUCKET_BADGE: Record<AllocationSlice['bucket'], string> = {
  safety:      'bg-blue-500/15 text-blue-300 border-blue-500/20',
  growth:      'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
  income:      'bg-amber-500/15 text-amber-300 border-amber-500/20',
  alternative: 'bg-purple-500/15 text-purple-300 border-purple-500/20',
};

function fmt(n: number, decimals = 1) {
  return n.toFixed(decimals);
}

function fmtDollar(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

function ScoreRing({ score }: { score: number }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color =
    score >= 85 ? '#10b981' :
    score >= 75 ? '#22c55e' :
    score >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <svg width="120" height="120" viewBox="0 0 100 100" className="flex-shrink-0">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#1e293b" strokeWidth="10" />
      <circle
        cx="50" cy="50" r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="46" textAnchor="middle" fill="white" fontSize="20" fontWeight="bold" fontFamily="monospace">{score}</text>
      <text x="50" y="60" textAnchor="middle" fill="#64748b" fontSize="9">/100</text>
    </svg>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white/4 border border-white/8 rounded-xl p-4">
      <div className="text-slate-400 text-xs mb-1">{label}</div>
      <div className="text-white font-bold text-xl font-mono">{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────
function SummaryTab({ plan, answers }: { plan: PortfolioPlan; answers: IntakeAnswers }) {

  return (
    <div className="space-y-6">
      {/* Executive summary + score */}
      <div className="bg-slate-900 border border-white/8 rounded-2xl p-6 flex gap-5 items-start">
        <ScoreRing score={plan.criticScore.total} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-slate-400">Overall Score</span>
            {plan.criticScore.hardFail && (
              <span className="text-xs bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">Hard Fail</span>
            )}
          </div>
          <p className="text-slate-200 text-sm leading-relaxed">{plan.executiveSummary}</p>
          <div className="flex gap-3 mt-3 text-xs text-slate-500">
            <span>Iterations: {plan.iterationsRan}</span>
            <span>·</span>
            <span>Generated {new Date(plan.generatedAt).toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      {/* Critic score breakdown */}
      <div className="bg-slate-900 border border-white/8 rounded-2xl p-6">
        <h3 className="text-white font-semibold mb-4 text-sm">Score Breakdown</h3>
        <div className="space-y-2">
          {([
            { label: 'Suitability', score: plan.criticScore.suitability, max: 30 },
            { label: 'Risk Alignment', score: plan.criticScore.riskAlignment, max: 25 },
            { label: 'Goal Feasibility', score: plan.criticScore.goalFeasibility, max: 20 },
            { label: 'Tax Efficiency', score: plan.criticScore.taxEfficiency, max: 15 },
            { label: 'Diversification', score: plan.criticScore.diversification, max: 10 },
          ]).map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <div className="w-28 text-slate-400 text-xs text-right">{item.label}</div>
              <div className="flex-1 h-2 bg-white/8 rounded-full overflow-hidden">
                <div
                  className="h-2 rounded-full bg-cyan-500"
                  style={{ width: `${(item.score / item.max) * 100}%` }}
                />
              </div>
              <div className="w-14 text-slate-300 text-xs font-mono text-right">{item.score}/{item.max}</div>
            </div>
          ))}
        </div>
        {plan.criticScore.commentary && (
          <p className="text-slate-400 text-xs mt-4 italic">&quot;{plan.criticScore.commentary}&quot;</p>
        )}
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Expected Return" value={`${fmt(plan.expectedReturn * 100)}%`} sub="10-yr CMA annualized" />
        <StatCard label="Volatility" value={`${fmt(plan.expectedVolatility * 100)}%`} sub="Annualized σ" />
        <StatCard label="Max Drawdown Est." value={`-${fmt((plan.riskAssessment?.maxDrawdownEstimate ?? 0) * 100)}%`} sub="Severe bear scenario" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Sharpe Ratio"
          value={plan.sharpeEstimate.toFixed(2)}
          sub={
            plan.sharpeEstimate >= 0.35 ? 'Excellent (2026 env.)' :
            plan.sharpeEstimate >= 0.22 ? 'Good (2026 env.)' :
            plan.sharpeEstimate >= 0.14 ? 'Acceptable — beats VT' :
            'Below VT benchmark'
          }
        />
        <StatCard label="vs VT Sharpe" value={`${plan.benchmarkComparison?.sharpeAlpha >= 0 ? '+' : ''}${plan.benchmarkComparison?.sharpeAlpha?.toFixed(2) ?? '—'}`} sub="Risk-adj. advantage" />
        <StatCard label="Risk-Free Rate" value={`${((plan.benchmarkComparison?.vtSharpe != null ? (plan.expectedReturn - plan.sharpeEstimate * plan.expectedVolatility) : 0.042) * 100).toFixed(1)}%`} sub="Live 10-yr Treasury" />
      </div>

      {/* Historical + Forward chart */}
      <PortfolioPerformanceChart plan={plan} answers={answers} />
    </div>
  );
}

// ─── Allocation Tab ───────────────────────────────────────────────────────────
function AllocationTab({ plan }: { plan: PortfolioPlan }) {
  const allocation = Array.isArray(plan.allocation) ? plan.allocation : [];
  const pieData = allocation.map(s => ({
    name: s.ticker,
    value: Math.round(s.weight * 100),
    bucket: s.bucket,
    fullName: s.name,
  }));

  return (
    <div className="space-y-6">
      {/* Pie chart */}
      <div className="bg-slate-900 border border-white/8 rounded-2xl p-6">
        <h3 className="text-white font-semibold mb-4 text-sm">Portfolio Weights</h3>
        <div className="flex items-center gap-6">
          <ResponsiveContainer width={220} height={220}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={BUCKET_HEX[entry.bucket]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 12 }}
                formatter={(v, _n, props) => [`${v}%`, props.payload.fullName]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {pieData.map((entry, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: BUCKET_HEX[entry.bucket] }} />
                <span className="text-slate-300 font-mono text-xs font-bold w-12">{entry.name}</span>
                <span className="text-slate-500 text-xs flex-1 truncate">{entry.fullName}</span>
                <span className="text-slate-300 font-mono text-xs">{entry.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detailed table */}
      <div className="bg-slate-900 border border-white/8 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-white/8">
          <h3 className="text-white font-semibold text-sm">Holding Details</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/8">
                <th className="text-left text-slate-400 font-medium px-4 py-3">Ticker</th>
                <th className="text-left text-slate-400 font-medium px-4 py-3">Asset Class</th>
                <th className="text-right text-slate-400 font-medium px-4 py-3">Weight</th>
                <th className="text-center text-slate-400 font-medium px-4 py-3">Bucket</th>
                <th className="text-right text-slate-400 font-medium px-4 py-3">Exp. Return</th>
                <th className="text-center text-slate-400 font-medium px-4 py-3">Account</th>
              </tr>
            </thead>
            <tbody>
              {allocation.map((s, i) => (
                <tr key={s.ticker} className={`border-b border-white/4 ${i % 2 === 0 ? '' : 'bg-white/2'}`}>
                  <td className="px-4 py-3">
                    <div className="text-white font-bold font-mono">{s.ticker}</div>
                    <div className="text-slate-500 text-xs">{s.name}</div>
                    {s.rationale && (
                      <div className="text-slate-500 text-xs mt-1 italic leading-relaxed max-w-xs">{s.rationale}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{s.assetClass}</td>
                  <td className="px-4 py-3 text-right text-white font-mono font-bold">{(s.weight * 100).toFixed(0)}%</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`border px-2 py-0.5 rounded-full text-xs capitalize ${BUCKET_BADGE[s.bucket]}`}>
                      {s.bucket}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-mono">{(s.expectedAnnualReturn * 100).toFixed(1)}%</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-slate-400 capitalize">{s.accountPlacement}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Risk Tab ─────────────────────────────────────────────────────────────────
function RiskTab({ plan }: { plan: PortfolioPlan }) {
  const r = plan.riskAssessment;
  return (
    <div className="space-y-4">
      {/* Drawdown stat */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Max Drawdown Estimate"
          value={`-${fmt(r.maxDrawdownEstimate * 100)}%`}
          sub="Severe bear market scenario"
        />
        <StatCard
          label="Risk Agent Verdict"
          value={r.approved ? 'Approved ✓' : 'Flagged ✗'}
          sub={r.approved ? 'Risks within tolerance' : 'Adjustments applied'}
        />
      </div>

      {/* Risk grid */}
      <div className="bg-slate-900 border border-white/8 rounded-2xl p-6 space-y-4">
        {([
          { label: 'Concentration Risk', value: r.concentrationRisk },
          { label: 'Sequence Risk', value: r.sequenceRisk },
          { label: 'Inflation Sensitivity', value: r.inflationSensitivity },
          { label: 'Liquidity Risk', value: r.liquidityRisk },
          { label: 'Duration Risk', value: r.durationRisk },
        ]).map(item => (
          <div key={item.label}>
            <div className="text-slate-400 text-xs font-medium mb-1">{item.label}</div>
            <p className="text-slate-200 text-sm">{item.value}</p>
          </div>
        ))}
      </div>

    </div>
  );
}

// ─── Tax Tab ──────────────────────────────────────────────────────────────────
function TaxTab({ plan, answers }: { plan: PortfolioPlan; answers: IntakeAnswers }) {
  const t = plan.taxPlan;
  // Tax-alpha: annual tax savings as % of total deployed capital (year-1 AUM)
  const aum = answers.startingCapital + answers.monthlyContribution * 12;
  const taxAlpha = aum > 0 ? (t.estimatedAnnualTaxSaving / aum) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Est. Annual Tax Saving"
          value={fmtDollar(t.estimatedAnnualTaxSaving)}
          sub={`Tax-alpha: +${taxAlpha.toFixed(2)}% of AUM`}
        />
        <StatCard
          label="Roth Conversion"
          value={t.rothConversionOpportunity ? 'Opportunity' : 'N/A'}
          sub={t.muniBondSuitable ? 'Muni bonds suitable' : 'Standard ETFs optimal'}
        />
      </div>

      {/* Asset location map */}
      {Object.keys(t.assetLocationMap).length > 0 && (
        <div className="bg-slate-900 border border-white/8 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-white/8">
            <h3 className="text-white font-semibold text-sm">Asset Location Map</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/8">
                <th className="text-left text-slate-400 font-medium px-4 py-2">Ticker</th>
                <th className="text-left text-slate-400 font-medium px-4 py-2">Optimal Account</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(t.assetLocationMap).map(([ticker, acct]) => (
                <tr key={ticker} className="border-b border-white/4">
                  <td className="px-4 py-2 text-white font-mono font-bold">{ticker}</td>
                  <td className="px-4 py-2 text-cyan-300 capitalize">{acct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-slate-900 border border-white/8 rounded-2xl p-5 space-y-3">
        <div>
          <div className="text-slate-400 text-xs font-medium mb-1">Tax-Loss Harvesting Strategy</div>
          <p className="text-slate-200 text-sm">{t.harvesting}</p>
        </div>
        <div>
          <div className="text-slate-400 text-xs font-medium mb-1">HSA Strategy</div>
          <p className="text-slate-200 text-sm">{t.hsaStrategy}</p>
        </div>
      </div>

      {t.implementationSteps?.length > 0 && (
        <div className="bg-slate-900 border border-white/8 rounded-2xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-3 uppercase tracking-wide">Implementation Steps</div>
          <ol className="space-y-2">
            {t.implementationSteps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="text-cyan-500 font-mono text-xs font-bold flex-shrink-0 mt-0.5">{i + 1}.</span>
                <span className="text-slate-200 text-sm">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ─── Owner Manual Tab ─────────────────────────────────────────────────────────
function ManualTab({ plan }: { plan: PortfolioPlan }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-2">
      {plan.ownerManual.map((section, i) => (
        <div key={i} className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-5 py-4 text-left"
            onClick={() => setOpen(open === i ? null : i)}
          >
            <div className="flex items-center gap-3">
              <span className="text-white font-semibold text-sm">{section.title}</span>
              {section.frequency && (
                <span className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full capitalize">
                  {section.frequency}
                </span>
              )}
            </div>
            <span className="text-slate-500 text-sm">{open === i ? '▲' : '▼'}</span>
          </button>
          {open === i && (
            <div className="px-5 pb-5">
              <p className="text-slate-300 text-sm leading-relaxed">{section.body}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Macro Tab ────────────────────────────────────────────────────────────────
function MacroTab({ plan }: { plan: PortfolioPlan }) {
  const m = plan.macroContext;
  const regimeBadge = {
    risk_on:     'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    risk_off:    'bg-red-500/15 text-red-300 border-red-500/20',
    transitional:'bg-amber-500/15 text-amber-300 border-amber-500/20',
  }[m.regime];

  return (
    <div className="space-y-4">
      {/* Live data */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Fed Funds Rate" value={m.fedFundsRate} />
        <StatCard label="10-Year Yield" value={m.tenYearYield} />
        <StatCard label="CPI (YoY)" value={m.cpi} />
      </div>

      <div className="bg-slate-900 border border-white/8 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-slate-400 text-xs mb-1">Market Regime</div>
            <span className={`border px-3 py-1 rounded-full text-sm capitalize ${regimeBadge}`}>
              {m.regime.replace('_', ' ')}
            </span>
          </div>
          <div>
            <div className="text-slate-400 text-xs mb-1">Equity Valuation</div>
            <span className="text-white text-sm capitalize">{m.equityValuation}</span>
          </div>
          <div>
            <div className="text-slate-400 text-xs mb-1">Bond Opportunity</div>
            <span className="text-white text-sm capitalize">{m.bondOpportunity}</span>
          </div>
        </div>
        <div>
          <div className="text-slate-400 text-xs font-medium mb-2">Macro Narrative</div>
          <p className="text-slate-200 text-sm leading-relaxed">{m.narrative}</p>
        </div>
        <div>
          <div className="text-slate-400 text-xs font-medium mb-2">CMA Summary (10-yr forward)</div>
          <p className="text-slate-200 text-sm leading-relaxed">{m.cmaSummary}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-white/8 rounded-2xl p-5">
          <div className="text-red-400 text-xs font-medium mb-3 uppercase tracking-wide">Key Risks</div>
          <div className="space-y-2">
            {m.keyRisks?.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-red-400 flex-shrink-0">▸</span>
                <span className="text-slate-300 text-sm">{r}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-slate-900 border border-white/8 rounded-2xl p-5">
          <div className="text-emerald-400 text-xs font-medium mb-3 uppercase tracking-wide">Tailwinds</div>
          <div className="space-y-2">
            {m.tailwinds?.map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-emerald-400 flex-shrink-0">▸</span>
                <span className="text-slate-300 text-sm">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {m.sources?.length > 0 && (
        <div className="bg-slate-900 border border-white/8 rounded-2xl p-4">
          <div className="text-slate-500 text-xs font-medium mb-2 uppercase tracking-wide">Data Sources</div>
          <div className="flex flex-wrap gap-2">
            {m.sources.map((s, i) => (
              <span key={i} className="text-xs text-slate-400 bg-white/4 px-2 py-0.5 rounded">{s}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Benchmark Tab ────────────────────────────────────────────────────────────
function BenchmarkTab({ plan, answers }: { plan: PortfolioPlan; answers: IntakeAnswers }) {
  const b = plan.benchmarkComparison;
  if (!b) return <div className="text-slate-500 text-sm p-6">Benchmark data not available.</div>;

  const portfolioReturn = plan.expectedReturn * 100;
  const vtReturn        = b.vtExpectedReturn * 100;
  const portfolioSharpe = plan.sharpeEstimate;
  const vtSharpe        = b.vtSharpe;
  const portfolioVol    = plan.expectedVolatility * 100;
  const vtVol           = b.vtVolatility * 100;

  const winColor  = 'text-emerald-400';
  const loseColor = 'text-red-400';
  const tieColor  = 'text-slate-300';

  function cmp(portfolio: number, vt: number, higher = true) {
    if (higher) return portfolio > vt ? winColor : portfolio < vt ? loseColor : tieColor;
    return portfolio < vt ? winColor : portfolio > vt ? loseColor : tieColor;
  }

  // Side-by-side bar chart data
  const comparisonBars = [
    { metric: 'Return %',  portfolio: +portfolioReturn.toFixed(2), vt: +vtReturn.toFixed(2) },
    { metric: 'Sharpe',    portfolio: +portfolioSharpe.toFixed(2),  vt: +vtSharpe.toFixed(2) },
    { metric: 'Vol %',     portfolio: +portfolioVol.toFixed(1),     vt: +vtVol.toFixed(1) },
  ];

  const totalAlphaBps = b.alphaAttribution.reduce((s, a) => s + a.bps, 0);
  const sharpeWins = portfolioSharpe > vtSharpe;

  return (
    <div className="space-y-5">
      {/* Hero verdict */}
      <div className={`rounded-2xl p-5 border ${sharpeWins ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-amber-500/8 border-amber-500/25'}`}>
        <div className="flex items-center gap-3 mb-2">
          <span className={`text-2xl font-bold font-mono ${sharpeWins ? 'text-emerald-400' : 'text-amber-400'}`}>
            {sharpeWins ? '✓ Beats 100% VT Benchmark' : '≈ Near Parity with VT Benchmark'}
          </span>
          <span className="text-slate-400 text-sm">on risk-adjusted basis</span>
        </div>
        <p className="text-slate-300 text-sm leading-relaxed">
          Your portfolio targets <span className="text-white font-mono font-bold">{portfolioReturn.toFixed(1)}% return</span> at{' '}
          <span className="text-white font-mono font-bold">{portfolioVol.toFixed(1)}% vol</span> (Sharpe{' '}
          <span className={`font-mono font-bold ${sharpeWins ? 'text-emerald-400' : 'text-amber-400'}`}>{portfolioSharpe.toFixed(2)}</span>
          ) vs VT&apos;s {vtReturn.toFixed(1)}% return at {vtVol.toFixed(1)}% vol (Sharpe{' '}
          <span className="font-mono text-slate-400">{vtSharpe.toFixed(2)}</span>
          ). A personalized factor-tilted portfolio targets better risk-adjusted outcomes than a single undifferentiated global ETF.
        </p>
      </div>

      {/* Side-by-side stat grid */}
      <div className="bg-slate-900 border border-white/8 rounded-2xl p-5">
        <h3 className="text-white font-semibold text-sm mb-4">Head-to-Head Comparison</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Expected Return', portfolio: `${portfolioReturn.toFixed(2)}%`,  vt: `${vtReturn.toFixed(2)}%`,  higherWins: true,  pVal: portfolioReturn,  vtVal: vtReturn },
            { label: 'Sharpe Ratio',    portfolio: portfolioSharpe.toFixed(2),         vt: vtSharpe.toFixed(2),        higherWins: true,  pVal: portfolioSharpe,  vtVal: vtSharpe },
            { label: 'Volatility',      portfolio: `${portfolioVol.toFixed(1)}%`,      vt: `${vtVol.toFixed(1)}%`,     higherWins: false, pVal: portfolioVol,     vtVal: vtVol },
            { label: 'After-Tax Return', portfolio: `${((b.afterTaxAlpha + b.vtAfterTaxReturn)*100).toFixed(2)}%`, vt: `${(b.vtAfterTaxReturn*100).toFixed(2)}%`, higherWins: true, pVal: b.afterTaxAlpha, vtVal: 0 },
            { label: 'Max Drawdown',    portfolio: `-${(plan.riskAssessment?.maxDrawdownEstimate*100 ?? 0).toFixed(0)}%`, vt: '~-35%', higherWins: false, pVal: plan.riskAssessment?.maxDrawdownEstimate ?? 0, vtVal: 0.35 },
            { label: 'Factor Tilt',     portfolio: plan.allocation.some(s => ['AVUV','AVDV'].includes(s.ticker)) ? 'SCV + Intl SCV' : 'Market Weight', vt: 'None (cap-weighted)', higherWins: true, pVal: 1, vtVal: 0 },
          ].map(item => (
            <div key={item.label} className="bg-white/3 border border-white/6 rounded-xl p-3">
              <div className="text-slate-400 text-xs mb-2">{item.label}</div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">Your Portfolio</div>
                  <div className={`font-mono font-bold text-base ${cmp(item.pVal, item.vtVal, item.higherWins)}`}>{item.portfolio}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500 mb-0.5">VT Benchmark</div>
                  <div className="font-mono text-slate-400 text-base">{item.vt}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Historical + forward chart */}
      <PortfolioPerformanceChart plan={plan} answers={answers} />

      {/* Alpha bar chart */}
      <div className="bg-slate-900 border border-white/8 rounded-2xl p-5">
        <h3 className="text-white font-semibold text-sm mb-1">Alpha Attribution</h3>
        <p className="text-slate-500 text-xs mb-4">
          Estimated {totalAlphaBps > 0 ? '+' : ''}{totalAlphaBps}bps total annual advantage vs VT — broken down by source
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={b.alphaAttribution} layout="vertical" margin={{ left: 0, right: 20 }}>
            <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} unit="bps" />
            <YAxis type="category" dataKey="source" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} width={110} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 11 }}
              formatter={(v) => [`${v as number > 0 ? '+' : ''}${v}bps`, 'Alpha']}
            />
            <Bar dataKey="bps" fill="#06b6d4" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="space-y-2 mt-3">
          {b.alphaAttribution.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`font-mono text-xs font-bold flex-shrink-0 w-16 ${a.bps >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {a.bps >= 0 ? '+' : ''}{a.bps}bps
              </span>
              <div>
                <span className="text-slate-300 text-xs font-medium">{a.source} — </span>
                <span className="text-slate-500 text-xs">{a.description}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Methodology note */}
      <div className="bg-white/3 border border-white/6 rounded-xl p-4">
        <p className="text-slate-500 text-xs leading-relaxed">
          <span className="text-slate-400 font-medium">Methodology:</span> VT baseline: 6.3% CMA (2026 consensus), 15% historical vol.
          Portfolio statistics: 2026 institutional CMAs (Vanguard/BlackRock/JPMorgan consensus) + true covariance-based volatility (√(wᵀΣw)).
          Historical chart: actual ETF total returns 2010–2024; pre-inception proxies validated vs Ken French factor library.
          Forward projection: CMA-based bear/base/bull (±½σ) — not Monte Carlo. Alpha attribution is forward-looking based on factor premium evidence — actual results will vary.
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PortfolioPlanCard({ plan, runState, answers, onReset }: PortfolioPlanCardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('summary');

  // Defensive guard — allocation must always be a valid array before any render
  const safeAllocation = Array.isArray(plan.allocation) ? plan.allocation : [];

  const goalLabel = {
    financial_independence: 'Financial Independence',
    major_purchase: 'Major Purchase',
    max_growth: 'Max Growth',
    legacy: 'Legacy',
  }[answers.primaryGoal];

  const horizonLabel = `${answers.yearsUntilWithdrawal}yr Horizon`;

  const scoreColor =
    plan.criticScore.total >= 85 ? 'text-emerald-400' :
    plan.criticScore.total >= 75 ? 'text-green-400' :
    plan.criticScore.total >= 60 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-slate-900 border border-white/8 rounded-2xl p-5 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-bold text-base">{goalLabel} · {horizonLabel}</span>
            <span className={`font-bold font-mono text-sm ${scoreColor}`}>{plan.criticScore.total}/100</span>
          </div>
          <div className="flex gap-3 text-xs text-slate-500">
            <span>{safeAllocation.length} holdings</span>
            <span>·</span>
            <span>{(plan.expectedReturn * 100).toFixed(1)}% return</span>
            <span>·</span>
            <span>Sharpe {plan.sharpeEstimate.toFixed(2)}</span>
            {plan.benchmarkComparison && (
              <>
                <span>·</span>
                <span className={plan.benchmarkComparison.sharpeAlpha >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {plan.benchmarkComparison.sharpeAlpha >= 0 ? '▲' : '▼'} vs VT Sharpe {plan.benchmarkComparison.vtSharpe.toFixed(2)}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={onReset}
          className="px-4 py-2 bg-white/6 hover:bg-white/10 text-slate-300 rounded-xl transition-all text-sm border border-white/8 flex-shrink-0"
        >
          New Analysis
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-900 border border-white/8 rounded-xl p-1">
        {TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — safePlan guarantees allocation is always an array */}
      {(() => {
        const safePlan = { ...plan, allocation: safeAllocation };
        return (
          <>
            {activeTab === 'summary'    && <SummaryTab plan={safePlan} answers={answers} />}
            {activeTab === 'allocation' && <AllocationTab plan={safePlan} />}
            {activeTab === 'benchmark'  && <BenchmarkTab plan={safePlan} answers={answers} />}
            {activeTab === 'risk'       && <RiskTab plan={safePlan} />}
            {activeTab === 'tax'        && <TaxTab plan={safePlan} answers={answers} />}
            {activeTab === 'manual'     && <ManualTab plan={safePlan} />}
            {activeTab === 'macro'      && <MacroTab plan={safePlan} />}
          </>
        );
      })()}
    </div>
  );
}
