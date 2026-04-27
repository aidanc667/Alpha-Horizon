'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { AllocationSlice, AllocationCategory } from '@/lib/agents/types';

const CATEGORY_COLOR: Record<AllocationCategory, string> = {
  safety:      '#4F46E5',
  growth:      '#3DD68C',
  income:      '#C9A84C',
  alternative: '#8B5CF6',
};

const CATEGORY_LABEL: Record<AllocationCategory, string> = {
  safety:      'Safety',
  growth:      'Growth',
  income:      'Income',
  alternative: 'Alternative',
};

interface AllocationDonutChartProps {
  allocation: AllocationSlice[];
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="bg-[#0D1B2A] border border-[#1A2E45] rounded-lg px-3 py-2 text-sm shadow-xl">
      <p className="font-semibold text-[#E8EDF2]">{item.name}</p>
      <p className="text-[#94A3B8]">{item.value.toFixed(1)}%</p>
    </div>
  );
}

export function AllocationDonutChart({ allocation }: AllocationDonutChartProps) {
  const byCategory = allocation.reduce<Record<string, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] ?? 0) + s.weight * 100;
    return acc;
  }, {});

  const data = Object.entries(byCategory).map(([cat, pct]) => ({
    name: CATEGORY_LABEL[cat as AllocationCategory] ?? cat,
    value: Number(pct.toFixed(1)),
    color: CATEGORY_COLOR[cat as AllocationCategory] ?? '#94A3B8',
  }));

  return (
    <div className="flex items-center gap-6">
      <ResponsiveContainer width={160} height={160}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={72}
            paddingAngle={2}
            dataKey="value"
            isAnimationActive={false}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>

      <div className="space-y-2.5">
        {data.map((entry, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-sm text-[#94A3B8] w-24">{entry.name}</span>
            <span className="text-sm font-semibold text-[#E8EDF2] font-mono">{entry.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
