'use client';

import React from 'react';
import Image from 'next/image';
import { Info } from 'lucide-react';
import type { ActiveTab } from '@/types';

interface HomeLandingProps {
  onNavigate: (tab: ActiveTab) => void;
}

export default function HomeLanding({ onNavigate }: HomeLandingProps) {
  return (
    <div className="flex flex-col items-center min-h-full px-8 text-center relative overflow-y-auto py-16" style={{background: 'linear-gradient(160deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)'}}>

      {/* Subtle depth orbs */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{background: 'radial-gradient(ellipse 60% 40% at 20% 20%, rgba(99,102,241,0.06) 0%, transparent 70%)'}} />
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{background: 'radial-gradient(ellipse 50% 40% at 80% 80%, rgba(16,185,129,0.06) 0%, transparent 70%)'}} />

      {/* Logo */}
      <div className="mb-6 drop-shadow-2xl">
        <Image src="/logo.png" alt="Alpha Horizon" width={180} height={180} className="" />
      </div>

      {/* Brand name */}
      <h1 className="font-brand text-4xl font-extrabold tracking-widest text-gray-900 uppercase mb-2">
        Alpha Horizon
      </h1>
      <p className="text-sm tracking-[0.3em] uppercase text-gray-400 mb-10">
        AI Finance App
      </p>

      {/* Tagline */}
      <p className="text-base text-gray-500 max-w-md leading-relaxed mb-12">
        An all-in-one investment platform that streamlines complex market research and portfolio analysis.
      </p>

      {/* App cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-xl mb-5">
        <button
          onClick={() => onNavigate('planner')}
          className="group p-6 border border-gray-100 border-t-2 border-t-emerald-600 rounded-xl text-left shadow-sm hover:shadow-md transition-shadow duration-200" style={{background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(12px)'}}
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-600/10 flex items-center justify-center mb-4">
            <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 013 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.249-8.25-3.286z" />
            </svg>
          </div>
          <p className="text-sm font-bold text-gray-900">AI Financial Planner</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">Personalized 3-bucket strategy with tax optimization and institutional reporting.</p>
          <p className="text-xs text-emerald-600 font-semibold mt-3 group-hover:translate-x-1 transition-transform">Get Started →</p>
        </button>

        <button
          onClick={() => onNavigate('lab')}
          className="group p-6 border border-gray-100 border-t-2 border-t-blue-600 rounded-xl text-left shadow-sm hover:shadow-md transition-shadow duration-200" style={{background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(12px)'}}
        >
          <div className="w-10 h-10 rounded-xl bg-blue-600/10 flex items-center justify-center mb-4">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 15M19.8 15a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 15m15.3 0v3.75A2.25 2.25 0 0117.55 21H6.45A2.25 2.25 0 014.2 18.75V15" />
            </svg>
          </div>
          <p className="text-sm font-bold text-gray-900">Portfolio Growth Lab</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">Advanced backtesting with risk metrics, benchmarking, and AI commentary.</p>
          <p className="text-xs text-blue-600 font-semibold mt-3 group-hover:translate-x-1 transition-transform">Explore →</p>
        </button>
      </div>

      {/* Market Horizon Outlook card */}
      <div className="w-full max-w-xl mb-12">
        <div className="group p-6 border border-gray-100 border-t-2 border-t-purple-700 rounded-xl text-left shadow-sm hover:shadow-md transition-shadow duration-200" style={{background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(12px)'}}>
          <div className="w-10 h-10 rounded-xl bg-purple-700/10 flex items-center justify-center mb-4">
            <svg className="w-5 h-5 text-purple-700" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <p className="text-sm font-bold text-gray-900">Market Horizon Outlook</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed mb-4">
            Institutional-grade macro intelligence with multi-horizon outlook, sector analysis, and live market intelligence.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => onNavigate('market-home')}
              className="flex-1 text-xs bg-purple-700/10 text-purple-700 font-semibold px-4 py-2 rounded-xl hover:bg-purple-700/20 transition-colors"
            >
              Open App →
            </button>
          </div>
        </div>
      </div>

      {/* Global disclaimer */}
      <div className="mt-6 flex items-start gap-2.5 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
        <Info className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-gray-500 leading-relaxed">
          <span className="font-semibold text-gray-600">© 2026 Alpha Horizon. For informational and educational purposes only. Not financial, investment, or tax advice.</span>{' '}
          AI-generated analysis and forward-looking projections are based on institutional research and historical data — not guaranteed outcomes. Consult a licensed financial advisor (RIA/CFP) before making any investment decisions.
        </p>
      </div>
    </div>
  );
}
