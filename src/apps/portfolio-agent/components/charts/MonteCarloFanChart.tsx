'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { MonteCarloOutput } from '@/lib/agents/types';

function fmtDollar(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

interface MonteCarloFanChartProps {
  monteCarlo: MonteCarloOutput;
}

interface ChartPoint {
  year: number;
  p10: number;
  p10ToP50: number;
  p50ToP90: number;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number }>; label?: number }) {
  if (!active || !payload?.length) return null;
  const p10 = payload[0]?.value ?? 0;
  const p50 = p10 + (payload[1]?.value ?? 0);
  const p90 = p50 + (payload[2]?.value ?? 0);
  return (
    <div className="bg-[#0D1B2A] border border-[#1A2E45] rounded-lg px-3 py-2.5 text-xs shadow-xl space-y-1">
      <p className="text-[#94A3B8] font-medium mb-1.5">Year {label}</p>
      <p className="text-red-400">Pessimistic: {fmtDollar(p10)}</p>
      <p className="text-indigo-400">Median: {fmtDollar(p50)}</p>
      <p className="text-[#3DD68C]">Optimistic: {fmtDollar(p90)}</p>
    </div>
  );
}

export function MonteCarloFanChart({ monteCarlo }: MonteCarloFanChartProps) {
  const { projections } = monteCarlo;

  const data: ChartPoint[] = projections.map(p => ({
    year: p.year,
    p10: p.p10,
    p10ToP50: p.p50 - p.p10,
    p50ToP90: p.p90 - p.p50,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fanP50dark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4F46E5" stopOpacity={0.30} />
            <stop offset="100%" stopColor="#4F46E5" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="fanP90dark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3DD68C" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#3DD68C" stopOpacity={0.04} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="#1A2E45" vertical={false} />
        <XAxis
          dataKey="year"
          tick={{ fill: '#94A3B8', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => `Yr ${v}`}
        />
        <YAxis
          tick={{ fill: '#94A3B8', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => fmtDollar(v)}
          width={60}
        />
        <Tooltip content={<CustomTooltip />} />

        {/* P10 base (transparent floor) */}
        <Area
          type="monotone"
          dataKey="p10"
          stackId="fan"
          stroke="#EF4444"
          strokeWidth={1.5}
          fill="transparent"
          dot={false}
          isAnimationActive={false}
          name="p10"
        />
        {/* P10→P50 band */}
        <Area
          type="monotone"
          dataKey="p10ToP50"
          stackId="fan"
          stroke="#4F46E5"
          strokeWidth={1.5}
          fill="url(#fanP50dark)"
          dot={false}
          isAnimationActive={false}
          name="p50"
          legendType="none"
        />
        {/* P50→P90 band */}
        <Area
          type="monotone"
          dataKey="p50ToP90"
          stackId="fan"
          stroke="#3DD68C"
          strokeWidth={1.5}
          fill="url(#fanP90dark)"
          dot={false}
          isAnimationActive={false}
          name="p90"
          legendType="none"
        />

        {projections.length > 0 && (
          <ReferenceLine
            x={projections[projections.length - 1].year}
            stroke="#1A2E45"
            strokeDasharray="4 3"
            label={{ value: 'Goal', position: 'top', fill: '#94A3B8', fontSize: 10 }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
