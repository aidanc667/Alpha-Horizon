'use client';

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
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-500/15 border border-purple-500/30 rounded-full mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-purple-300">Live Intelligence</span>
          </div>
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
              title: 'Elite 6 Indicators',
              desc: 'SPY movement, volatility turbulence, institutional flow, market breadth, asset of the day, top sector — on every card.',
              color: 'text-purple-400',
              bg: 'bg-purple-500/8 border-purple-500/20',
            },
            {
              icon: Zap,
              title: 'Triple-Card System',
              desc: 'Yesterday\'s receipt with accuracy score, today\'s live pulse, and tomorrow\'s locked predictions — all in one view.',
              color: 'text-amber-400',
              bg: 'bg-amber-500/8 border-amber-500/20',
            },
            {
              icon: Lock,
              title: 'Noon Lock & Accuracy',
              desc: 'Predictions lock at 12 PM ET daily. Every forecast is scored against actual closes and tracked in a trust ledger.',
              color: 'text-blue-400',
              bg: 'bg-blue-500/8 border-blue-500/20',
            },
            {
              icon: TrendingUp,
              title: 'Daily Edge Board',
              desc: 'Top 5 assets with statistical edge today and bottom 5 to avoid — grounded with real search data every morning.',
              color: 'text-emerald-400',
              bg: 'bg-emerald-500/8 border-emerald-500/20',
            },
            {
              icon: Target,
              title: "Today's Positioning",
              desc: 'Overweight, neutral, and underweight calls updated daily based on institutional flow and macro conditions.',
              color: 'text-rose-400',
              bg: 'bg-rose-500/8 border-rose-500/20',
            },
            {
              icon: RefreshCw,
              title: 'AI Feedback Loop',
              desc: 'When accuracy drops, the system analyzes what it missed and adjusts its weights — building a genuine trust score over time.',
              color: 'text-cyan-400',
              bg: 'bg-cyan-500/8 border-cyan-500/20',
            },
          ].map(({ icon: Icon, title, desc, color, bg }) => (
            <div
              key={title}
              className={`border rounded-2xl p-5 space-y-2 ${bg}`}
            >
              <Icon className={`w-5 h-5 ${color}`} />
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
              { step: '① Today', desc: 'Live brief: 5 What/Why/Impact bullets, Elite 6, Edge Board, weather gauge', color: 'text-amber-400' },
              { step: '② Noon Lock', desc: 'AI predictions for tomorrow\'s Elite 6 sealed at 12 PM ET', color: 'text-blue-400' },
              { step: '③ Yesterday', desc: 'Predictions scored vs actual closes, accuracy ledger updated', color: 'text-purple-400' },
            ].map(({ step, desc, color }, i) => (
              <div key={i} className="flex items-start md:items-center gap-4 flex-1">
                <div className="space-y-1">
                  <p className={`text-sm font-bold ${color}`}>{step}</p>
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
              background: 'linear-gradient(135deg, rgba(168,85,247,0.25) 0%, rgba(139,92,246,0.15) 100%)',
              border: '1px solid rgba(168,85,247,0.4)',
              color: '#c084fc',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(168,85,247,0.35) 0%, rgba(139,92,246,0.25) 100%)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(168,85,247,0.25) 0%, rgba(139,92,246,0.15) 100%)';
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
