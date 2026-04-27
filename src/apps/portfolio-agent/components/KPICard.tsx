'use client';

interface KPICardProps {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  icon?: React.ReactNode;
}

export function KPICard({ label, value, sub, valueColor = 'text-[#E8EDF2]', icon }: KPICardProps) {
  return (
    <div className="rounded-xl border border-[#1A2E45] bg-[#0D1B2A] p-5">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">{label}</p>
        {icon && <span className="text-[#94A3B8]">{icon}</span>}
      </div>
      <p className={`text-3xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-[#94A3B8] mt-1">{sub}</p>}
    </div>
  );
}
