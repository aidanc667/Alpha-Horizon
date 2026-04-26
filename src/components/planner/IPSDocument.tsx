'use client';

import React from 'react';
import type { IPSDocument } from '@/types';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const fmt$ = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

const fmtPct = (v: number, decimals = 1) => `${(v * 100).toFixed(decimals)}%`;

// ─── Section wrapper ───────────────────────────────────────────────────────────

function Section({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-3 pb-2 border-b border-gray-200">
        <span className="font-mono text-xs text-gray-400 w-5 flex-shrink-0">{num}.</span>
        <h2 className="font-serif text-lg font-semibold text-gray-900 tracking-tight">{title}</h2>
      </div>
      <div className="pl-8">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="text-xs text-gray-900 font-mono text-right max-w-[60%]">{value}</span>
    </div>
  );
}

// ─── Unavailable state ─────────────────────────────────────────────────────────

function IPSUnavailable() {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-slate-50 p-10 text-center">
      <p className="text-sm font-semibold text-gray-500 mb-1">IPS not available</p>
      <p className="text-xs text-gray-400">
        The Investment Policy Statement requires a Gemini API key. Configure{' '}
        <code className="font-mono bg-gray-100 px-1 rounded">GEMINI_API_KEY</code> and regenerate
        your plan.
      </p>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface Props {
  ips: IPSDocument;
}

export default function IPSDocumentTab({ ips }: Props) {
  const {
    generatedDate,
    clientProfile,
    investmentObjective,
    constraints,
    targetAllocation,
    riskParameters,
    taxStrategy,
    benchmarks,
    executiveSummary,
    criticScore,
    disclaimer,
  } = ips;

  const criticColor =
    criticScore >= 90 ? '#10b981' : criticScore >= 80 ? '#f59e0b' : '#ef4444';

  return (
    <div className="max-w-4xl mx-auto">
      {/* Document header */}
      <div className="rounded-xl bg-slate-900 text-white px-8 py-6 mb-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-mono text-slate-400 uppercase tracking-widest mb-1">
              Investment Policy Statement
            </p>
            <h1 className="font-serif text-2xl font-bold text-white leading-tight">
              Personal Portfolio Policy
            </h1>
            <p className="text-xs text-slate-400 mt-2 font-mono">
              Generated {new Date(generatedDate).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </p>
          </div>
          <div className="text-right flex-shrink-0 ml-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">Critic Score</p>
            <p className="font-mono text-3xl font-black" style={{ color: criticColor }}>
              {criticScore}
            </p>
            <p className="text-xs text-slate-500 font-mono">/ 100</p>
          </div>
        </div>

        {executiveSummary && (
          <p className="mt-4 text-sm text-slate-300 border-t border-slate-700 pt-4 leading-relaxed">
            {executiveSummary}
          </p>
        )}

        {/* Download placeholder */}
        <div className="mt-4 flex justify-end">
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 text-slate-400 text-xs font-semibold cursor-not-allowed opacity-60"
            title="PDF export coming soon"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            Download PDF
          </button>
        </div>
      </div>

      {/* Document body */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm px-8 py-8">

        {/* 1. Investment Objective */}
        <Section num={1} title="Investment Objective">
          <p className="text-sm text-gray-700 leading-relaxed">{investmentObjective}</p>
        </Section>

        {/* 2. Client Profile */}
        <Section num={2} title="Client Profile">
          <div className="rounded-lg border border-gray-100 bg-slate-50 px-4 py-3">
            <Row label="Risk Score" value={`${clientProfile.riskScore} / 10`} />
            <Row label="Risk Tolerance" value={clientProfile.derivedRiskTolerance} />
            <Row label="Time Horizon" value={`${clientProfile.horizon} years`} />
            <Row label="Primary Goal" value={clientProfile.primaryGoal.replace(/_/g, ' ')} />
            <Row label="State of Residence" value={clientProfile.state} />
            <Row label="Filing Status" value={clientProfile.filingStatus.replace(/_/g, ' ')} />
            <Row
              label="Effective Marginal Rate"
              value={fmtPct(clientProfile.effectiveMarginalRate)}
            />
            {clientProfile.goalAmount != null && (
              <Row label="Target Goal Amount" value={fmt$(clientProfile.goalAmount)} />
            )}
          </div>
        </Section>

        {/* 3. Constraints */}
        <Section num={3} title="Investment Constraints">
          <div className="rounded-lg border border-gray-100 bg-slate-50 px-4 py-3">
            <Row label="Liquidity Requirement" value={constraints.liquidityRequirement} />
            <Row label="Tax Considerations" value={constraints.taxConsiderations} />
            <Row label="Rebalancing Policy" value={constraints.rebalancingPolicy} />
            <Row label="Review Schedule" value={constraints.reviewSchedule} />
          </div>
          {constraints.restrictions.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Restrictions</p>
              <ul className="space-y-1">
                {constraints.restrictions.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                    <span className="text-gray-300 flex-shrink-0 mt-0.5">—</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {/* 4. Asset Allocation */}
        <Section num={4} title="Target Asset Allocation">
          {targetAllocation.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-gray-200">
                    <th className="text-left font-semibold text-gray-500 py-2 px-3 uppercase tracking-wide">Bucket</th>
                    <th className="text-right font-semibold text-gray-500 py-2 px-3 uppercase tracking-wide">Target</th>
                    <th className="text-right font-semibold text-gray-500 py-2 px-3 uppercase tracking-wide">Range</th>
                    <th className="text-left font-semibold text-gray-500 py-2 px-3 uppercase tracking-wide">Holdings</th>
                  </tr>
                </thead>
                <tbody>
                  {targetAllocation.map((bucket, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-gray-900">{bucket.bucketName}</td>
                      <td className="py-2.5 px-3 font-mono text-right text-gray-900">
                        {bucket.targetPct.toFixed(0)}%
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-gray-500 whitespace-nowrap">
                        {bucket.rangeLow.toFixed(0)}%–{bucket.rangeHigh.toFixed(0)}%
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {bucket.holdings.map((h, j) => (
                            <span
                              key={j}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-700"
                              title={`${h.name} — ${(h.weight * 100).toFixed(0)}% — ${h.accountPlacement}`}
                            >
                              {h.ticker}
                              <span className="text-gray-400">{(h.weight * 100).toFixed(0)}%</span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No allocation buckets specified.</p>
          )}
        </Section>

        {/* 5. Risk Parameters */}
        <Section num={5} title="Risk Parameters">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: 'Max Drawdown Tolerance', value: riskParameters.maxDrawdownTolerance },
              { label: 'Concentration Limit', value: riskParameters.concentrationLimit },
              { label: 'Sequence Risk', value: riskParameters.sequenceRisk },
              { label: 'Expected Volatility', value: riskParameters.expectedVolatility },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-gray-100 bg-slate-50 px-4 py-3">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">{label}</p>
                <p className="text-xs text-gray-800 leading-snug">{value}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* 6. Tax Strategy */}
        <Section num={6} title="Tax Strategy">
          <div className="rounded-lg border border-gray-100 bg-slate-50 px-4 py-3 mb-3">
            <Row
              label="Est. Annual Tax Alpha"
              value={
                <span className="text-emerald-600 font-bold">
                  {fmt$(taxStrategy.estimatedAnnualTaxAlpha)}/yr
                </span>
              }
            />
            <Row
              label="Muni Bonds Suitable"
              value={taxStrategy.muniBondSuitable ? 'Yes' : 'No'}
            />
            <Row
              label="Roth Conversion Opportunity"
              value={taxStrategy.rothConversionOpportunity ? 'Yes' : 'No'}
            />
          </div>

          {taxStrategy.assetLocationSummary && (
            <p className="text-xs text-gray-700 leading-relaxed mb-3">
              {taxStrategy.assetLocationSummary}
            </p>
          )}

          {taxStrategy.keyTaxActions.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Key Actions</p>
              <ul className="space-y-1.5">
                {taxStrategy.keyTaxActions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                    <span className="text-emerald-500 flex-shrink-0 mt-0.5 font-bold">→</span>
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {/* 7. Benchmarks */}
        <Section num={7} title="Performance Benchmarks">
          <div className="rounded-lg border border-gray-100 bg-slate-50 px-4 py-3">
            <Row label="Primary Benchmark" value={benchmarks.primary} />
            <Row label="Secondary Benchmark" value={benchmarks.secondary} />
            <Row
              label="Expected Return vs Benchmark"
              value={
                <span className={benchmarks.expectedReturnVsBenchmark >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                  {benchmarks.expectedReturnVsBenchmark >= 0 ? '+' : ''}
                  {fmtPct(benchmarks.expectedReturnVsBenchmark)}
                </span>
              }
            />
            <Row
              label="Sharpe vs Benchmark"
              value={
                <span className={benchmarks.sharpeVsBenchmark >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                  {benchmarks.sharpeVsBenchmark >= 0 ? '+' : ''}
                  {benchmarks.sharpeVsBenchmark.toFixed(2)}
                </span>
              }
            />
          </div>
        </Section>

        {/* 8. Governance & Disclaimer */}
        <Section num={8} title="Governance & Disclaimer">
          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 mb-4">
            <p className="text-[10px] text-amber-700 uppercase tracking-wide font-semibold mb-1">Review Schedule</p>
            <p className="text-xs text-amber-800">{constraints.reviewSchedule}</p>
          </div>
          <p className="text-[10px] text-gray-400 leading-relaxed">{disclaimer}</p>
        </Section>
      </div>
    </div>
  );
}

// Named export for when IPS may be undefined (used in PlanResults)
export function IPSTab({ ips }: { ips: IPSDocument | undefined }) {
  if (!ips) return <IPSUnavailable />;
  return <IPSDocumentTab ips={ips} />;
}
