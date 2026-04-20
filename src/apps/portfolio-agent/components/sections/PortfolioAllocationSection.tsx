'use client';

import type { Agent3Output, AllocationSlice, EtfRationaleEntry, AllocationCategory } from '@/lib/agents/types';

const CATEGORY_COLOR: Record<AllocationCategory, string> = {
  safety:      'bg-blue-500',
  growth:      'bg-emerald-500',
  income:      'bg-amber-500',
  alternative: 'bg-purple-500',
};

interface PortfolioAllocationSectionProps {
  allocation: AllocationSlice[];
  statistics: Agent3Output['statistics'];
  etfRationale?: Record<string, EtfRationaleEntry>;
  detailed?: boolean;
}

export function PortfolioAllocationSection({
  allocation,
  statistics,
  etfRationale,
  detailed = false,
}: PortfolioAllocationSectionProps) {
  // Group by category
  const byCategory = allocation.reduce<Record<string, number>>((acc, slice) => {
    acc[slice.category] = (acc[slice.category] ?? 0) + slice.weight;
    return acc;
  }, {});

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
      <h2 className="text-lg font-semibold mb-6">Portfolio Allocation</h2>

      {/* Category bars */}
      <div className="mb-8">
        <p className="text-sm text-zinc-400 mb-3">By Asset Class</p>
        <div className="space-y-2">
          {Object.entries(byCategory).map(([category, weight]) => (
            <div key={category} className="flex items-center gap-3">
              <span className="text-sm text-zinc-300 w-24 capitalize">
                {category.replace(/_/g, ' ')}
              </span>
              <div className="flex-1 bg-zinc-800 rounded-full h-6">
                <div
                  className={`h-6 rounded-full flex items-center justify-end pr-2 ${
                    CATEGORY_COLOR[category as AllocationCategory] ?? 'bg-zinc-500'
                  }`}
                  style={{ width: `${weight * 100}%` }}
                >
                  <span className="text-xs font-semibold text-white">
                    {(weight * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Holdings table */}
      <div>
        <p className="text-sm text-zinc-400 mb-3">Holdings ({allocation.length})</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800">
              <tr className="text-left text-zinc-500">
                <th className="pb-2 font-medium">Ticker</th>
                <th className="pb-2 font-medium">Allocation</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">Account</th>
                {detailed && <th className="pb-2 font-medium">Rationale</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {allocation.map((slice) => (
                <tr key={slice.ticker} className="text-zinc-300">
                  <td className="py-3 font-semibold text-blue-400">{slice.ticker}</td>
                  <td className="py-3 font-mono">{(slice.weight * 100).toFixed(2)}%</td>
                  <td className="py-3 text-zinc-400 capitalize text-xs">
                    {slice.category.replace(/_/g, ' ')}
                  </td>
                  <td className="py-3 text-zinc-400 capitalize text-xs">
                    {slice.accountPlacement}
                  </td>
                  {detailed && (
                    <td className="py-3 text-zinc-400 text-xs max-w-md">
                      {etfRationale?.[slice.ticker]?.rationale ?? '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
