'use client';

interface PortfolioScoreRingProps {
  score: number; // 0–100
  size?: number;
}

function scoreColor(s: number) {
  if (s >= 85) return { stroke: '#3DD68C', text: 'text-[#3DD68C]',  label: 'Excellent' };
  if (s >= 75) return { stroke: '#4F46E5', text: 'text-indigo-400', label: 'Good' };
  if (s >= 60) return { stroke: '#F59E0B', text: 'text-amber-400',  label: 'Fair' };
  return             { stroke: '#EF4444', text: 'text-red-400',    label: 'Needs Review' };
}

export function PortfolioScoreRing({ score, size = 160 }: PortfolioScoreRingProps) {
  const r = 58;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const arcLength = circumference * 0.75;
  const filled = arcLength * (score / 100);
  const gap = arcLength - filled;
  const { stroke, text, label } = scoreColor(score);

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} style={{ transform: 'rotate(135deg)' }}>
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="#1A2E45"
          strokeWidth={10}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={10}
          strokeDasharray={`${filled} ${gap + (circumference - arcLength)}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="flex flex-col items-center" style={{ marginTop: -(size * 0.62) }}>
        <span className={`text-4xl font-bold ${text}`}>{score}</span>
        <span className="text-sm text-[#94A3B8] font-medium">/100</span>
        <span className={`text-xs font-semibold mt-0.5 ${text}`}>{label}</span>
      </div>
      <div style={{ height: size * 0.38 - 8 }} />
    </div>
  );
}
