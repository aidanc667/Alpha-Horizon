'use client';

import { BarChart2, Zap, TrendingUp, Target, RefreshCw, Newspaper, AlertTriangle, Calendar, ArrowRight, CheckCircle } from 'lucide-react';
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
    <div className="h-full overflow-y-auto" style={{ background: '#faf8f3' }}>

      {/* Hero */}
      <div className="px-10 pt-10 pb-8" style={{ borderBottom: '1px solid #ebe4d8' }}>
        <p className="font-sans uppercase mb-3" style={{ fontSize: 9.5, letterSpacing: '0.16em', fontWeight: 600, color: '#7c3aed' }}>
          ● Market Analysis
        </p>
        <div className="flex items-end justify-between gap-8">
          <div>
            <h1 className="font-display font-bold leading-none" style={{ fontSize: '2.6rem', color: '#1a1008' }}>
              Understand the market today.<br />
              <span style={{ color: '#7c3aed' }}>Forecast what comes next.</span>
            </h1>
            <p className="font-sans mt-3 max-w-lg" style={{ fontSize: 13.5, lineHeight: 1.7, color: '#6b5840' }}>
              Every morning the AI publishes locked predictions for SPY, VIX, and the day&apos;s top mover — including exact percentage targets. After close, it scores itself, explains what happened, and sharpens the next call. No other tool holds its own forecasts accountable like this.
            </p>
          </div>
          <button
            onClick={() => onNavigate?.('market-near')}
            className="flex-shrink-0 flex items-center gap-2 font-sans font-semibold rounded-xl transition-all hover:opacity-90 active:scale-95"
            style={{ background: '#7c3aed', color: '#fff', padding: '11px 24px', fontSize: 13 }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#6d28d9'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#7c3aed'; }}
          >
            <Zap className="w-4 h-4" />
            Open Daily Brief
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4" style={{ borderBottom: '1px solid #ebe4d8' }}>
        {[
          { value: '3', label: 'Scored indicators', sub: 'SPY · VIX · Top Mover' },
          { value: '5+', label: 'Daily brief bullets', sub: 'grounded in real prices' },
          { value: 'Explains', label: 'What happened & Why', sub: 'impact on your investments' },
          { value: '12 p.m.', label: 'Prediction lock', sub: 'ET · scored at close' },
        ].map((s, i) => (
          <div
            key={s.label}
            className="py-5 px-6 flex flex-col gap-0.5"
            style={{ borderRight: i < 3 ? '1px solid #ebe4d8' : 'none' }}
          >
            <p className="font-mono font-bold" style={{ fontSize: 22, color: '#7c3aed', lineHeight: 1 }}>{s.value}</p>
            <p className="font-sans font-medium" style={{ fontSize: 11, color: '#1a1008', marginTop: 4 }}>{s.label}</p>
            <p className="font-sans" style={{ fontSize: 10, color: '#b09060' }}>{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="px-10 py-8 max-w-4xl">

        {/* What makes this different */}
        <p className="font-sans uppercase mb-5" style={{ fontSize: 9.5, letterSpacing: '0.14em', fontWeight: 600, color: '#b09060' }}>
          What makes this different
        </p>
        <div className="rounded-xl border overflow-hidden mb-8" style={{ borderColor: '#ebe4d8' }}>
          {[
            {
              headline: 'Predictions with a paper trail',
              body: 'Every noon-locked call is immutable — direction and exact percentage target for SPY, VIX, and a named top mover. You can see exactly what was predicted before the market opened, not a vague retroactive narrative.',
            },
            {
              headline: 'Self-scoring AI',
              body: 'After close each day, the system fetches real prices, computes a 0–100 accuracy score per indicator with partial credit for magnitude, then writes a plain-English recap explaining why it was right or wrong and what drove the session.',
            },
            {
              headline: 'Rolling accuracy ledger',
              body: 'A full history of every prediction and score is stored and displayed as a calendar heatmap. You can see how the model performs over time — not cherry-picked wins, but every single day on record.',
            },
          ].map(({ headline, body }, i) => (
            <div
              key={headline}
              className="flex items-start gap-4 px-5 py-4"
              style={{ borderBottom: i < 2 ? '1px solid #ebe4d8' : 'none', background: '#ffffff' }}
            >
              <div className="flex-shrink-0 mt-0.5">
                <CheckCircle style={{ width: 15, height: 15, color: '#7c3aed' }} />
              </div>
              <div>
                <p className="font-sans font-semibold mb-0.5" style={{ fontSize: 12, color: '#1a1008' }}>{headline}</p>
                <p className="font-sans" style={{ fontSize: 11.5, lineHeight: 1.6, color: '#6b5840' }}>{body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* What's in the daily brief */}
        <p className="font-sans uppercase mb-5" style={{ fontSize: 9.5, letterSpacing: '0.14em', fontWeight: 600, color: '#b09060' }}>
          What&apos;s in the daily brief
        </p>
        <div className="grid grid-cols-2 gap-3 mb-8">
          {([
            {
              Icon: BarChart2,
              title: '3 Scored Indicators',
              desc: 'SPY direction + % target, VIX direction + % target, and a named top mover with a predicted move — all locked at noon and graded after close.',
            },
            {
              Icon: Newspaper,
              title: '6–8 Live Headlines',
              desc: 'Top market-moving news sourced from Bloomberg, Reuters, WSJ, FT, and CNBC. Each headline is impact-scored and ranked.',
            },
            {
              Icon: TrendingUp,
              title: 'Edge Board',
              desc: 'Top 5 assets with statistical edge and bottom 5 to avoid — based on price momentum, volume, and sector flow.',
            },
            {
              Icon: Target,
              title: 'Positioning Calls',
              desc: 'Overweight, neutral, and underweight calls based on institutional flow, macro regime, and today\'s live indicator readings.',
            },
            {
              Icon: AlertTriangle,
              title: 'Outlier Detection',
              desc: 'One counter-intuitive data point flagged daily — a ticker moving with no obvious catalyst, or a sector contradicting the macro narrative.',
            },
            {
              Icon: RefreshCw,
              title: 'Weather Gauge',
              desc: 'A single-line market sentiment summary derived from SPY momentum, VIX level, and sector rotation — a quick pulse for the day.',
            },
          ] as const).map(({ Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-3 rounded-xl p-4 border"
              style={{ background: '#ffffff', borderColor: '#ebe4d8' }}
            >
              <div
                className="flex-shrink-0 flex items-center justify-center rounded-lg"
                style={{ width: 34, height: 34, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)' }}
              >
                <Icon style={{ width: 15, height: 15, color: '#7c3aed' }} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-sans font-semibold mb-1" style={{ fontSize: 12, color: '#1a1008' }}>{title}</h3>
                <p className="font-sans" style={{ fontSize: 11, lineHeight: 1.55, color: '#6b5840' }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* How the loop works */}
        <p className="font-sans uppercase mb-4" style={{ fontSize: 9.5, letterSpacing: '0.14em', fontWeight: 600, color: '#b09060' }}>
          How the prediction loop works
        </p>
        <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: '#ebe4d8' }}>
          {[
            {
              step: '① Morning',
              desc: 'Live brief generated with real prices, headlines, edge board, and positioning calls. The previous day\'s accuracy recap appears in Yesterday\'s Call.',
            },
            {
              step: '② Noon lock',
              desc: 'At 12 PM ET, tomorrow\'s predictions are sealed — direction and exact % target for SPY, VIX, and one named top mover stock. The record is immutable from this point.',
            },
            {
              step: '③ After close',
              desc: 'Real closing prices are fetched, every indicator is scored 0–100 (partial credit for how close the magnitude was), and a plain-English recap is written explaining what happened and why.',
            },
          ].map(({ step, desc }, i) => (
            <div
              key={step}
              className="flex items-start gap-4 px-5 py-4"
              style={{ borderBottom: i < 2 ? '1px solid #ebe4d8' : 'none', background: '#ffffff' }}
            >
              <span className="font-sans font-bold flex-shrink-0 mt-0.5" style={{ fontSize: 12, color: '#7c3aed', minWidth: 90 }}>{step}</span>
              <p className="font-sans" style={{ fontSize: 11.5, lineHeight: 1.6, color: '#6b5840' }}>{desc}</p>
            </div>
          ))}
        </div>

        {/* Near-term analysis callout */}
        <div
          className="rounded-xl border p-5 flex items-start gap-4"
          style={{ background: 'rgba(124,58,237,0.04)', borderColor: 'rgba(124,58,237,0.18)' }}
        >
          <div
            className="flex-shrink-0 flex items-center justify-center rounded-lg"
            style={{ width: 36, height: 36, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}
          >
            <Calendar style={{ width: 16, height: 16, color: '#7c3aed' }} />
          </div>
          <div>
            <p className="font-sans font-semibold mb-1" style={{ fontSize: 12, color: '#1a1008' }}>On-demand deep analysis</p>
            <p className="font-sans" style={{ fontSize: 11.5, lineHeight: 1.6, color: '#6b5840' }}>
              Full What / Why / Impact breakdown across 5 asset classes — Equities, Fixed Income, Commodities, FX, and Real Assets — plus a 7-day catalyst calendar of key events that could shift the thesis.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
