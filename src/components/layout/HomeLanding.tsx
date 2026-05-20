'use client';

import React, { useMemo, useEffect, useState } from 'react';
import {
  ShieldCheck,
  FlaskConical,
  Globe,
  Brain,
  Swords,
  ArrowRight,
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
    label: 'AI Financial Planner',
    sub: 'Portfolio Architect',
    desc: 'Build a personalized, tax-optimized ETF portfolio using a 7-agent AI pipeline.',
    cta: 'Build a plan',
    accentHex: '#0d9e60',
    softHex: '#d8f3e6',
    icon: ShieldCheck,
  },
  {
    id: 'lab' as ActiveTab,
    label: 'Portfolio Growth Lab',
    sub: 'Advanced Backtesting',
    desc: 'Backtest any portfolio strategy against historical data with full risk metrics.',
    cta: 'Open lab',
    accentHex: '#2563eb',
    softHex: '#dbe7fb',
    icon: FlaskConical,
  },
  {
    id: 'market-home' as ActiveTab,
    label: 'Market Analysis',
    sub: 'Daily Intelligence',
    desc: 'Institutional-grade macro intelligence with sector analysis and live market data.',
    cta: 'Read the desk',
    accentHex: '#7c3aed',
    softHex: '#e6dcfb',
    icon: Globe,
  },
  {
    id: 'advisor' as ActiveTab,
    label: 'Silas',
    sub: 'Wealth Advisor',
    desc: 'Your AI wealth advisor for personalized investment guidance and portfolio insights.',
    cta: 'Ask Silas',
    accentHex: '#d97706',
    softHex: '#fbe7c8',
    icon: Brain,
  },
  {
    id: 'arena' as ActiveTab,
    label: 'Strategy Arena',
    sub: 'Paper Trading',
    desc: 'Test trading strategies risk-free in a paper trading simulator with live data.',
    cta: 'Enter arena',
    accentHex: '#b45309',
    softHex: '#f5e0c8',
    icon: Swords,
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
    <div className="h-8 border-b border-[rgba(15,20,25,0.05)] bg-white/40 overflow-hidden flex items-center flex-shrink-0">
      {items.length === 0 ? (
        <span className="font-mono text-[10px] text-[#9aa3ad] px-4">Loading market data…</span>
      ) : (
        <div className="ticker-track">
          {items.map((t, i) => {
            const chg = t.change;
            const color = chg === null ? '#9aa3ad' : chg >= 0 ? '#0d9e60' : '#dc2626';
            return (
              <span key={i} className="flex items-center gap-2 px-4 border-r border-[rgba(15,20,25,0.05)] whitespace-nowrap">
                <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-[#3a4452]">{t.symbol.replace('^', '')}</span>
                <span className="font-mono text-[10px] text-[#1a2330]">{fmtPrice(t.price, t.symbol)}</span>
                {chg !== null && (
                  <span className="font-mono text-[10px]" style={{ color }}>{fmtChg(chg)}</span>
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
  const Icon = app.icon;
  return (
    <button
      onClick={() => onNavigate(app.id)}
      className="relative overflow-hidden rounded-[18px] p-[18px] bg-white border border-[rgba(15,20,25,0.06)] flex flex-col text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-16px_rgba(15,20,25,0.18)] cursor-pointer"
      style={{ boxShadow: '0 1px 0 rgba(15,20,25,0.02), 0 8px 24px -16px rgba(15,20,25,0.12)' }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(135deg, ${app.softHex}88 0%, transparent 55%)` }} />
      <div className="relative flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ background: app.softHex, color: app.accentHex }}>
          <Icon className="w-[18px] h-[18px]" strokeWidth={1.6} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold tracking-[-0.01em] text-[#0f1419] truncate">{app.label}</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#6a7480] mt-0.5">{app.sub}</div>
        </div>
      </div>
      <p className="relative text-[11px] leading-[1.55] text-[#6a7480] flex-1">{app.desc}</p>
      <div className="relative flex items-center mt-3">
        <span className="text-[11px] font-semibold flex items-center gap-1" style={{ color: app.accentHex }}>
          {app.cta}
          <ArrowRight className="w-[11px] h-[11px]" strokeWidth={2} />
        </span>
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
    <div className="flex flex-col min-h-full" style={{ background: '#eef0f3' }}>

      {/* Topbar */}
      <header className="px-8 py-5 flex items-center gap-3.5 border-b border-[rgba(15,20,25,0.05)] bg-white/60 backdrop-blur-xl sticky top-0 z-10">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#6a7480]">Home</span>
        <span className="text-[#cbd2da]">›</span>
        <span className="text-[13px] font-medium text-[#0f1419]">Overview</span>
        <span className="flex-1" />
        {marketOpen ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#e8f5ee] rounded-md">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0d9e60]" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0d6e44]">Markets open</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#fee2e2] rounded-md">
            <span className="w-1.5 h-1.5 rounded-full bg-[#dc2626]" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#991b1b]">Markets closed</span>
          </div>
        )}
      </header>

      {/* Ticker bar */}
      <TickerBar />

      {/* Body */}
      <div>
        <div className="px-8 pt-7 pb-9">

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
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: '#e4c97e' }}>AI Finance Terminal</span>
                  <div className="h-px flex-1" style={{ background: 'linear-gradient(to right, #e4c97e, transparent)' }} />
                </div>
                <p className="mt-5 text-[14px] leading-[1.65] max-w-[480px]" style={{ color: 'rgba(241,244,248,0.55)' }}>
                  An all-in-one investment platform that streamlines complex market research and portfolio analysis. Experience five institutional-grade apps — spanning personalized portfolio construction, backtesting, live market analysis, wealth advisory, and adversarial paper trading — designed to help you master the market and expand your investing knowledge.
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
          <div className="mt-[22px] flex items-center gap-4 text-[11px] text-[#6a7480]">
            <span>© 2026 Alpha Horizon · For informational use only — not financial, investment, or tax advice.</span>
            <span className="flex-1" />
            <span className="font-mono text-[10px]">v3.4.1 · last sync {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
