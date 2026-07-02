'use client';

import React from 'react';
import { BarChart2, Zap, Lock, TrendingUp, Target, RefreshCw, ChevronRight } from 'lucide-react';
import TripleCardMarket from '@/components/market/TripleCardMarket';

interface MarketTabProps {
  initialView?: 'home' | 'near-term' | 'long-term' | string;
  onBack?: () => void;
  onNavigate?: (view: string) => void;
}

export default function MarketTab({ initialView = 'home', onBack, onNavigate }: MarketTabProps) {
  if (initialView !== 'home') {
    return <TripleCardMarket onBack={onBack} />;
  }

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ background: 'linear-gradient(135deg, #0a0d12 0%, #0f1419 40%, #141d27 100%)' }}
    >
      <div className="max-w-4xl mx-auto px-6 py-16 space-y-12">

        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-2" style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#7c3aed' }} />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#c4b5fd' }}>Live Intelligence</span>
          </div>
          <p className="font-sans uppercase mb-1" style={{ fontSize: 9.5, letterSpacing: '0.16em', fontWeight: 600, color: '#7c3aed' }}>
            ● Market Analysis
          </p>
          <h1 className="font-brand font-extrabold text-white tracking-[-0.02em] leading-none" style={{ fontSize: '2.75rem' }}>
            MARKET ANALYSIS
          </h1>
          <p className="text-slate-400 text-[14px] leading-[1.65] max-w-xl mx-auto" style={{ color: 'rgba(241,244,248,0.5)' }}>
            A daily intelligence loop — live briefings, noon-locked predictions, and an AI accuracy ledger that learns from every miss.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            {
              icon: BarChart2,
              title: 'Core 4 Indicators',
              desc: 'Fear & Greed sentiment, SPY direction + MAs, sector rotation leader/lagger, and options put/call lean — tracked and scored daily.',
              iconColor: '#7c3aed' as string | null,
              bg: 'border rounded-2xl p-5 space-y-2',
              bgStyle: { background: 'rgba(124,58,237,0.08)', borderColor: 'rgba(124,58,237,0.2)' } as React.CSSProperties | undefined,
            },
            {
              icon: Zap,
              title: 'Triple-Card System',
              desc: 'Yesterday\'s receipt with accuracy score, today\'s live pulse, and tomorrow\'s locked predictions — all in one view.',
              iconColor: null,
              bg: 'border rounded-2xl p-5 space-y-2 bg-amber-500/8 border-amber-500/20',
              bgStyle: undefined,
            },
            {
              icon: Lock,
              title: 'Noon Lock & Accuracy',
              desc: 'Predictions lock at 12 PM ET daily. Every forecast is scored against actual closes and tracked in a trust ledger.',
              iconColor: null,
              bg: 'border rounded-2xl p-5 space-y-2 bg-blue-500/8 border-blue-500/20',
              bgStyle: undefined,
            },
            {
              icon: TrendingUp,
              title: 'Daily Edge Board',
              desc: 'Top 5 assets with statistical edge today and bottom 5 to avoid — grounded with real search data every morning.',
              iconColor: null,
              bg: 'border rounded-2xl p-5 space-y-2 bg-emerald-500/8 border-emerald-500/20',
              bgStyle: undefined,
            },
            {
              icon: Target,
              title: "Today's Positioning",
              desc: 'Overweight, neutral, and underweight calls updated daily based on institutional flow and macro conditions.',
              iconColor: null,
              bg: 'border rounded-2xl p-5 space-y-2 bg-rose-500/8 border-rose-500/20',
              bgStyle: undefined,
            },
            {
              icon: RefreshCw,
              title: 'Adaptive Signal Weights',
              desc: 'After each scored day, the system auto-adjusts how much it trusts each signal type. Underperforming signals get down-weighted in real-time.',
              iconColor: null,
              bg: 'border rounded-2xl p-5 space-y-2 bg-cyan-500/8 border-cyan-500/20',
              bgStyle: undefined,
            },
          ].map(({ icon: Icon, title, desc, iconColor, bg, bgStyle }) => (
            <div
              key={title}
              className={bg}
              style={bgStyle}
            >
              <Icon className="w-5 h-5" style={iconColor ? { color: iconColor } : undefined} />
              <p className="text-white font-semibold text-sm">{title}</p>
              <p className="text-slate-500 text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        {/* How it works strip */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] mb-5" style={{ color: 'rgba(241,244,248,0.3)' }}>How It Works</p>
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-0">
            {[
              { step: '① Today', desc: 'Live brief: 5 What/Why/Impact bullets, Core 4 indicators, Edge Board, weather gauge', color: 'text-amber-400' },
              { step: '② Noon Lock', desc: 'AI predictions for tomorrow\'s Core 4 sealed at 12 PM ET — self-weighted by past accuracy', color: 'text-blue-400' },
              { step: '③ Yesterday', desc: 'Predictions scored vs actual closes, accuracy ledger updated', color: '', violetStep: true },
            ].map(({ step, desc, color, violetStep }, i) => (
              <div key={i} className="flex items-start md:items-center gap-4 flex-1">
                <div className="space-y-1">
                  <p className={`text-sm font-bold ${color}`} style={violetStep ? { color: '#7c3aed' } : undefined}>{step}</p>
                  <p className="text-slate-400 text-xs leading-relaxed">{desc}</p>
                </div>
                {i < 2 && (
                  <ChevronRight className="w-4 h-4 text-slate-700 flex-shrink-0 hidden md:block" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Launch button */}
        <div className="flex justify-center">
          <button
            onClick={() => onNavigate?.('market-near')}
            className="group flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-base transition-all duration-200"
            style={{
              background: 'linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(124,58,237,0.15) 100%)',
              border: '1px solid rgba(124,58,237,0.4)',
              color: '#c4b5fd',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(124,58,237,0.35) 0%, rgba(124,58,237,0.25) 100%)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(124,58,237,0.15) 100%)';
            }}
          >
            <Zap className="w-5 h-5" />
            Launch Daily Intelligence
            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

      </div>
    </div>
  );
}
