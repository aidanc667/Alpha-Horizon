'use client';

import React, { useMemo, useEffect, useState } from 'react';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import type { ActiveTab } from '@/types';

interface HomeLandingProps {
  onNavigate: (tab: ActiveTab) => void;
}

// ── helpers ────────────────────────────────────────────────────────────────

function isMarketOpen(): boolean {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const hm = et.getHours() * 60 + et.getMinutes();
  return hm >= 570 && hm < 960;
}

// ── ticker ─────────────────────────────────────────────────────────────────

interface TickerPrice { symbol: string; price: number | null; change: number | null }

function fmtPrice(p: number | null, sym: string): string {
  if (p === null) return '—';
  if (sym === 'BTC-USD' || sym === 'ETH-USD') return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (sym === '^TNX') return p.toFixed(3) + '%';
  return p.toFixed(2);
}

function fmtChg(c: number | null): string {
  if (c === null) return '';
  return (c >= 0 ? '+' : '') + c.toFixed(2) + '%';
}

// ── app definitions ────────────────────────────────────────────────────────

const APPS = [
  {
    id: 'planner' as ActiveTab,
    label: 'Portfolio Planner',
    sub: 'Multi-Agent Construction',
    desc: 'Build a personalized, tax-optimized ETF portfolio using a 7-agent AI pipeline.',
    cta: 'Build a plan',
    accentHex: '#16a34a',
    paleBg: '#f0fdf4',
    paleBorder: '#bbf7d0',
    emoji: '📊',
  },
  {
    id: 'lab' as ActiveTab,
    label: 'Backtesting Lab',
    sub: 'Historical Simulations',
    desc: 'Backtest any portfolio strategy against historical data with full risk metrics.',
    cta: 'Open lab',
    accentHex: '#6366f1',
    paleBg: '#eef2ff',
    paleBorder: '#c7d2fe',
    emoji: '🧪',
  },
  {
    id: 'market-home' as ActiveTab,
    label: 'Market Analysis',
    sub: 'Real-Time Intelligence',
    desc: 'Daily AI predictions on SPY, VIX, and top movers — scored against actuals with a full accuracy history.',
    cta: 'Read the desk',
    accentHex: '#7c3aed',
    paleBg: '#f5f3ff',
    paleBorder: '#ddd6fe',
    emoji: '📈',
  },
  {
    id: 'advisor' as ActiveTab,
    label: 'Silas Advisor',
    sub: 'AI Wealth Advisor',
    desc: 'Your AI wealth advisor for personalized investment guidance and portfolio insights.',
    cta: 'Ask Silas',
    accentHex: '#C9A84C',
    paleBg: '#fefce8',
    paleBorder: '#fde68a',
    emoji: '🤖',
  },
  {
    id: 'arena' as ActiveTab,
    label: 'Strategy Arena',
    sub: 'Unlimited Paper Trading',
    desc: 'Test trading strategies risk-free in a paper trading simulator with live data.',
    cta: 'Enter arena',
    accentHex: '#b91c1c',
    paleBg: '#fff1f2',
    paleBorder: '#fecdd3',
    emoji: '⚔️',
  },
] as const;

// ── types ──────────────────────────────────────────────────────────────────

interface SectorInfo {
  name: string;
  ticker: string;
  change: number;
}

interface HomeBrief {
  brief: string;
  leadingSector: SectorInfo;
  laggingSector: SectorInfo;
}

// ── sub-components ─────────────────────────────────────────────────────────

function TickerBar() {
  const [prices, setPrices] = useState<TickerPrice[]>([]);

  useEffect(() => {
    fetch('/api/ticker-prices')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setPrices(data); })
      .catch(() => {});
  }, []);

  // Duplicate for seamless loop
  const items = prices.length ? [...prices, ...prices] : [];

  return (
    <div
      className="flex-shrink-0 flex items-center overflow-hidden"
      style={{ height: 34, background: '#120d08', borderBottom: '1px solid #1e1610' }}
    >
      {items.length === 0 ? (
        <span className="font-mono text-[10px] px-4" style={{ color: '#5a4535' }}>Loading market data…</span>
      ) : (
        <div className="ticker-track">
          {items.map((t, i) => {
            const chg = t.change;
            return (
              <span key={i} className="inline-flex items-center gap-1.5 px-4 whitespace-nowrap">
                <span className="font-mono text-[12px] font-semibold" style={{ color: '#e8d0a8' }}>
                  {t.symbol.replace('-USD', '').replace('^TNX', '10Y').replace('^', '')}
                </span>
                <span className="font-mono text-[12px]" style={{ color: '#a89070' }}>
                  {fmtPrice(t.price, t.symbol)}
                </span>
                {chg !== null && (
                  <span className="font-mono text-[11px] font-semibold" style={{ color: chg >= 0 ? '#22c55e' : '#f87171' }}>
                    {fmtChg(chg)}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppTile({ app, onNavigate }: { app: typeof APPS[number]; onNavigate: (tab: ActiveTab) => void }) {
  return (
    <button
      onClick={() => onNavigate(app.id)}
      className="group text-left rounded-[10px] transition-all border"
      style={{ padding: '18px 20px', background: '#ffffff', borderColor: '#ebe4d8' }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = app.accentHex;
        e.currentTarget.style.boxShadow = `0 0 0 3px ${app.paleBg}`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#ebe4d8';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Top accent strip */}
      <div className="h-[3px] rounded-full mb-4" style={{ background: app.accentHex, width: 28 }} />

      <div className="flex items-start gap-3 mb-3">
        <div
          className="flex-shrink-0 flex items-center justify-center rounded-[8px] text-[18px]"
          style={{ width: 36, height: 36, background: app.paleBg, border: `1px solid ${app.paleBorder}` }}
        >
          {app.emoji}
        </div>
        <div className="flex-1 min-w-0" style={{ height: 54 }}>
          <div className="font-display font-semibold leading-tight whitespace-nowrap" style={{ fontSize: 12.5, color: '#1a1008' }}>
            {app.label}
          </div>
          <div className="font-sans uppercase mt-1" style={{ fontSize: 9, letterSpacing: '0.12em', fontWeight: 600, color: app.accentHex, lineHeight: 1.4 }}>
            {app.sub}
          </div>
        </div>
      </div>

      <p className="font-sans text-[11.5px] leading-relaxed mb-4" style={{ color: '#6b5840', minHeight: 72 }}>
        {app.desc}
      </p>

      <div className="font-sans text-[11px] font-semibold" style={{ color: app.accentHex }}>
        {app.cta} →
      </div>
    </button>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export default function HomeLanding({ onNavigate }: HomeLandingProps) {
  const now = useMemo(() => new Date(), []);
  const marketOpen = useMemo(() => isMarketOpen(), []);

  const [brief, setBrief] = useState<HomeBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);

  useEffect(() => {
    fetch('/api/home-brief')
      .then(async r => {
        const data = await r.json();
        if (!r.ok) {
          console.error('[home-brief] HTTP', r.status, data);
          setBriefLoading(false);
          return;
        }
        setBrief(data);
        setBriefLoading(false);
      })
      .catch(e => {
        console.error('[home-brief] fetch error:', e);
        setBriefLoading(false);
      });
  }, []);

  const fmtChange = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

  return (
    <div className="flex flex-col min-h-full" style={{ background: '#faf8f3' }}>

      {/* Page header */}
      <div className="px-8 pt-7 pb-2 flex items-center justify-between">
        <p className="font-mono" style={{ fontSize: 12, color: '#6b5840' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        {marketOpen ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: '#f0fdf4' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#16a34a' }} />
            <span className="font-mono font-semibold uppercase" style={{ fontSize: 10, letterSpacing: '0.08em', color: '#15803d' }}>Markets open</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: '#fff1f2' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#b91c1c' }} />
            <span className="font-mono font-semibold uppercase" style={{ fontSize: 10, letterSpacing: '0.08em', color: '#991b1b' }}>Markets closed</span>
          </div>
        )}
      </div>

      {/* Ticker bar */}
      <TickerBar />

      {/* Body */}
      <div>
        <div className="px-8 pt-4 pb-9">

          {/* Top bento: hero + brief */}
          <div className="grid grid-cols-6 gap-3.5" style={{ gridAutoRows: '170px' }}>

            {/* ── ALPHA HORIZON hero tile — col-span-4 row-span-2 ── */}
            <div
              className="relative overflow-hidden col-span-4 row-span-2 rounded-[18px] p-[22px] flex flex-col"
              style={{ background: 'linear-gradient(135deg, #0a0d12 0%, #0f1419 40%, #141d27 100%)' }}
            >
              <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
              <div className="absolute pointer-events-none" style={{ top: -60, right: -40, width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(228,201,126,0.14), transparent 68%)' }} />
              <div className="absolute pointer-events-none" style={{ bottom: -80, left: -40, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(37,99,235,0.12), transparent 68%)' }} />

              <div className="relative z-10 flex-1 flex flex-col justify-center">
                <div className="font-brand font-extrabold text-white leading-none tracking-[-0.02em]" style={{ fontSize: '52px' }}>
                  ALPHA HORIZON
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <div className="h-px flex-shrink-0 w-8" style={{ background: '#e4c97e' }} />
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: '#e4c97e' }}>AI Investment Platform</span>
                  <div className="h-px flex-1" style={{ background: 'linear-gradient(to right, #e4c97e, transparent)' }} />
                </div>
                <p className="mt-5 text-[14px] leading-[1.65] max-w-[480px]" style={{ color: 'rgba(241,244,248,0.55)' }}>
                  Five institutional-grade tools built for serious investors: personalized portfolio construction, strategy backtesting, live market intelligence, AI wealth advisory, and paper trading. Everything you need to research, analyze, and act with conviction.
                </p>
              </div>
            </div>

            {/* ── Today's Brief — col-span-2 row-span-2 ── */}
            <div
              className="relative overflow-hidden col-span-2 row-span-2 rounded-[18px] p-[22px] flex flex-col text-[#f1f4f8]"
              style={{ background: 'linear-gradient(160deg, #1c2733 0%, #0f1419 100%)' }}
            >
              <div className="absolute pointer-events-none" style={{ top: -80, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(201,168,76,0.18), transparent 70%)' }} />

              {/* Header */}
              <div className="relative z-10 flex items-center gap-2 flex-shrink-0">
                <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'rgba(201,168,76,0.18)' }}>
                  <Sparkles className="w-[12px] h-[12px]" style={{ color: '#e4c97e' }} />
                </div>
                <span className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: '#e4c97e' }}>
                  Today&apos;s brief · Silas
                </span>
              </div>

              {/* Brief text — scrollable so long briefs never get clipped */}
              <div className="relative z-10 mt-4 flex-1 overflow-y-auto min-h-0">
                {briefLoading ? (
                  <div className="space-y-2">
                    {[100, 90, 95, 80].map((w, i) => (
                      <div key={i} className="h-3 rounded" style={{ width: `${w}%`, background: 'rgba(255,255,255,0.08)' }} />
                    ))}
                  </div>
                ) : (
                  <p className="text-[12.5px] leading-[1.65] tracking-[-0.01em]" style={{ color: 'rgba(241,244,248,0.88)' }}>
                    {brief?.brief ?? 'Market brief unavailable — check that GEMINI_API_KEY is set.'}
                  </p>
                )}
              </div>

              {/* Sector strip — always pinned to bottom */}
              <div className="relative z-10 mt-3 pt-3 border-t border-[rgba(255,255,255,0.08)] flex flex-col gap-2 flex-shrink-0">
                {[
                  { label: 'Leading', data: brief?.leadingSector, Icon: TrendingUp, color: '#7ee2b0' },
                  { label: 'Lagging', data: brief?.laggingSector, Icon: TrendingDown, color: '#f0a4a4' },
                ].map(({ label, data, Icon, color }) => (
                  <div key={label} className="flex items-center gap-2">
                    <Icon className="w-[13px] h-[13px] flex-shrink-0" style={{ color }} strokeWidth={2} />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: 'rgba(231,234,238,0.4)' }}>{label} sector</div>
                      <div className="text-[12px] font-medium truncate" style={{ color: '#f1f4f8' }}>
                        {briefLoading ? '—' : (data?.name ?? '—')}
                      </div>
                    </div>
                    <span className="font-mono text-[12px] font-medium tabular-nums flex-shrink-0" style={{ color: briefLoading ? '#9aa3ad' : color }}>
                      {briefLoading ? '—' : (data ? fmtChange(data.change) : '—')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* App tiles — 5 in a row */}
          <div className="grid grid-cols-5 gap-3.5 mt-3.5">
            {APPS.map(app => (
              <AppTile key={app.id} app={app} onNavigate={onNavigate} />
            ))}
          </div>

          {/* Footer */}
          <div className="mt-[22px] flex items-center gap-4 text-[11px]" style={{ color: '#6b5840' }}>
            <span>© 2026 Alpha Horizon · For informational use only — not financial, investment, or tax advice.</span>
            <span className="flex-1" />
            <span className="font-mono text-[10px]">v3.4.1 · last sync {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
