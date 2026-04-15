'use client';

import React from 'react';
import Image from 'next/image';
import clsx from 'clsx';
import {
  ShieldCheck,
  FlaskConical,
  ChevronRight,
  Globe,
  LogOut,
  Brain,
  Swords,
  Bot,
} from 'lucide-react';
import { useClerk } from '@clerk/nextjs';
import type { ActiveTab } from '@/types';

interface SidebarProps {
  activeTab: ActiveTab | null;
  onTabChange: (tab: ActiveTab) => void;
  onHome: () => void;
}

const NAV_ITEMS = [
  {
    id: 'planner' as ActiveTab,
    label: 'AI Financial Planner',
    sublabel: 'AI Portfolio Architect',
    icon: ShieldCheck,
    dotColor: 'bg-emerald-400',
    activeBg: 'bg-emerald-500/20',
    activeBorder: 'border-emerald-500/40',
    activeText: 'text-emerald-300',
    activeIcon: 'text-emerald-400',
    hoverBg: 'hover:bg-white/8',
  },
  {
    id: 'lab' as ActiveTab,
    label: 'Portfolio Growth Lab',
    sublabel: 'Advanced Backtesting',
    icon: FlaskConical,
    dotColor: 'bg-blue-400',
    activeBg: 'bg-blue-500/20',
    activeBorder: 'border-blue-500/40',
    activeText: 'text-blue-300',
    activeIcon: 'text-blue-400',
    hoverBg: 'hover:bg-white/8',
  },
  {
    id: 'market-home' as ActiveTab,
    label: 'Current Market Analysis',
    sublabel: 'Daily Intelligence System',
    icon: Globe,
    dotColor: 'bg-purple-400',
    activeBg: 'bg-purple-500/20',
    activeBorder: 'border-purple-500/40',
    activeText: 'text-purple-300',
    activeIcon: 'text-purple-400',
    hoverBg: 'hover:bg-white/8',
  },
  {
    id: 'advisor' as ActiveTab,
    label: 'Portfolio Intelligence AI',
    sublabel: 'AI Market Advisor',
    icon: Brain,
    dotColor: 'bg-orange-400',
    activeBg: 'bg-orange-500/20',
    activeBorder: 'border-orange-500/40',
    activeText: 'text-orange-300',
    activeIcon: 'text-orange-400',
    hoverBg: 'hover:bg-white/8',
  },
  {
    id: 'arena' as ActiveTab,
    label: 'Strategy Arena',
    sublabel: 'Paper Trading Simulator',
    icon: Swords,
    dotColor: 'bg-amber-400',
    activeBg: 'bg-amber-500/20',
    activeBorder: 'border-amber-500/40',
    activeText: 'text-amber-300',
    activeIcon: 'text-amber-400',
    hoverBg: 'hover:bg-white/8',
  },
  {
    id: 'portfolio-agent' as ActiveTab,
    label: 'Portfolio Agent',
    sublabel: 'Multi-Agent Construction',
    icon: Bot,
    dotColor: 'bg-cyan-400',
    activeBg: 'bg-cyan-500/20',
    activeBorder: 'border-cyan-500/40',
    activeText: 'text-cyan-300',
    activeIcon: 'text-cyan-400',
    hoverBg: 'hover:bg-white/8',
  },
] as const;

export default function Sidebar({ activeTab, onTabChange, onHome }: SidebarProps) {
  const { signOut } = useClerk();

  const handleSignOut = async () => {
    sessionStorage.removeItem('ah_tab_session');
    await signOut();
    window.location.href = '/sign-in';
  };
  return (
    <aside
      className="w-64 flex-shrink-0 flex flex-col h-full"
      style={{
        background: 'linear-gradient(180deg, #0f172a 0%, #1a2744 60%, #1e293b 100%)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Logo — click to go home */}
      <button
        onClick={onHome}
        className="px-5 py-5 text-left w-full transition-all hover:bg-white/5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex-shrink-0">
            <Image src="/logo.png" alt="Alpha Horizon" width={40} height={40} className="w-full h-full object-contain" />
          </div>
          <div>
            <p className="font-brand text-sm font-extrabold tracking-widest text-white uppercase">Alpha Horizon</p>
            <p className="text-[11px] text-slate-400 tracking-wide uppercase">AI Finance App</p>
          </div>
        </div>
      </button>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto min-h-0">
        <p className="px-3 pt-3 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Apps
        </p>

        {NAV_ITEMS.map((item) => {
          const isActive =
            activeTab !== null &&
            (activeTab === item.id ||
              (item.id === 'market-home' &&
                (activeTab === 'market-long' || activeTab === 'market-near' || activeTab === 'market-home')));
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-all duration-200 text-left group',
                isActive
                  ? `${item.activeBg} ${item.activeBorder}`
                  : `border-transparent ${item.hoverBg}`
              )}
            >
              {/* Icon */}
              <div className={clsx(
                'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors',
                isActive ? item.activeBg : 'bg-white/10'
              )}>
                <Icon className={clsx('w-4 h-4 transition-colors', isActive ? item.activeIcon : 'text-slate-400')} />
              </div>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <p className={clsx('text-[11px] font-semibold truncate transition-colors leading-tight', isActive ? item.activeText : 'text-slate-300 group-hover:text-white')}>
                  {item.label}
                </p>
                <p className="text-[10px] text-slate-500 truncate">{item.sublabel}</p>
              </div>

              {/* Chevron / Active dot */}
              {isActive ? (
                <div className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', item.dotColor)} />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 flex-shrink-0 transition-colors" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:bg-white/8 transition-all duration-200 group"
        >
          <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
            <LogOut className="w-4 h-4 text-slate-400 group-hover:text-red-400 transition-colors" />
          </div>
          <span className="text-xs font-semibold text-slate-400 group-hover:text-red-400 transition-colors">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
