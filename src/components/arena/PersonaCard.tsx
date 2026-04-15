'use client';

import React from 'react';
import { TrendingUp, TrendingDown, Target, Trash2 } from 'lucide-react';
import type { Persona, PersonaSnapshot } from '@/types';

interface PersonaCardProps {
  persona: Persona;
  snapshot: PersonaSnapshot | null;
  onClick: () => void;
  onDelete: () => void;
}

const BENCHMARK_LABELS: Record<string, string> = { '60/40': '60/40' };
const benchLabel = (t: string) => BENCHMARK_LABELS[t] || t;

export default function PersonaCard({ persona, snapshot, onClick, onDelete }: PersonaCardProps) {
  const currentValue = snapshot ? Number(snapshot.portfolio_value) : Number(persona.starting_balance);
  const benchmarkValue = snapshot ? Number(snapshot.benchmark_value) : Number(persona.starting_balance);
  const totalReturn = (currentValue / Number(persona.starting_balance) - 1) * 100;
  const benchReturn = (benchmarkValue / Number(persona.starting_balance) - 1) * 100;
  const alpha = totalReturn - benchReturn;

  const todayReturn = snapshot?.holdings_detail_json
    ? snapshot.holdings_detail_json.reduce((sum, h) => sum + (h.todayChangePct * h.weightCurrent), 0) * 100
    : 0;

  const inceptionDate = new Date(persona.inception_date);
  const daysRunning = Math.floor((Date.now() - inceptionDate.getTime()) / 86400000);

  const riskLabel = persona.risk_score <= 3 ? 'Conservative' : persona.risk_score <= 6 ? 'Moderate' : 'Aggressive';
  const riskColor = persona.risk_score <= 3 ? 'text-emerald-400' : persona.risk_score <= 6 ? 'text-amber-400' : 'text-red-400';

  return (
    <div
      onClick={onClick}
      className="group relative bg-slate-900 border border-white/8 rounded-2xl p-5 cursor-pointer hover:border-amber-500/30 hover:bg-amber-500/4 transition-all duration-200"
    >
      {/* Delete button — always visible */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-white/6 hover:bg-red-500/20 flex items-center justify-center transition-all"
        title="Delete persona"
      >
        <Trash2 className="w-3.5 h-3.5 text-slate-500 group-hover:text-red-400 transition-colors" />
      </button>

      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
          <span className="text-amber-400 font-bold text-base">{persona.name.charAt(0).toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate">{persona.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs font-semibold ${riskColor}`}>{riskLabel}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500 text-xs">vs {benchLabel(persona.benchmark_ticker)}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500 text-xs">{daysRunning}d</span>
          </div>
        </div>
      </div>

      {/* Value */}
      <div className="mb-3">
        <p className="text-2xl font-bold text-white font-mono">${currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        <div className="flex items-center gap-1.5 mt-1">
          {totalReturn >= 0
            ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
          <span className={`text-sm font-bold ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}%
          </span>
          <span className="text-slate-500 text-xs">since inception</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white/4 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Today</p>
          <p className={`text-xs font-bold ${todayReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {todayReturn >= 0 ? '+' : ''}{todayReturn.toFixed(2)}%
          </p>
        </div>
        <div className="bg-white/4 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">vs {benchLabel(persona.benchmark_ticker)}</p>
          <div className="flex items-center justify-center gap-0.5">
            <Target className={`w-2.5 h-2.5 ${alpha >= 0 ? 'text-emerald-400' : 'text-red-400'}`} />
            <p className={`text-xs font-bold ${alpha >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {alpha >= 0 ? '+' : ''}{alpha.toFixed(2)}%
            </p>
          </div>
        </div>
        <div className="bg-white/4 rounded-lg p-2 text-center">
          <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Balance</p>
          <p className="text-xs font-bold text-slate-300">${(Number(persona.starting_balance) / 1000).toFixed(0)}k</p>
        </div>
      </div>

      {/* Holdings pills */}
      <div className="flex gap-1.5 flex-wrap mt-3">
        {persona.allocation_json.slice(0, 4).map(h => (
          <span key={h.ticker} className="px-2 py-0.5 bg-white/6 border border-white/8 rounded-md text-xs text-slate-400 font-mono">
            {h.ticker} {(h.weight * 100).toFixed(0)}%
          </span>
        ))}
        {persona.allocation_json.length > 4 && (
          <span className="px-2 py-0.5 bg-white/6 border border-white/8 rounded-md text-xs text-slate-500">+{persona.allocation_json.length - 4}</span>
        )}
      </div>
    </div>
  );
}
