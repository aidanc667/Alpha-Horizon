'use client';

import React from 'react';
import Image from 'next/image';
import {
  ShieldCheck,
  FlaskConical,
  Globe,
  Brain,
  Swords,
  LogOut,
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
    icon: ShieldCheck,
    accentHex: '#0d9e60',
    softHex: '#d8f3e6',
  },
  {
    id: 'lab' as ActiveTab,
    label: 'Portfolio Growth Lab',
    icon: FlaskConical,
    accentHex: '#2563eb',
    softHex: '#dbe7fb',
  },
  {
    id: 'market-home' as ActiveTab,
    label: 'Market Analysis',
    icon: Globe,
    accentHex: '#7c3aed',
    softHex: '#e6dcfb',
  },
  {
    id: 'advisor' as ActiveTab,
    label: 'Silas',
    icon: Brain,
    accentHex: '#d97706',
    softHex: '#fbe7c8',
  },
  {
    id: 'arena' as ActiveTab,
    label: 'Strategy Arena',
    icon: Swords,
    accentHex: '#b45309',
    softHex: '#f5e0c8',
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
    <aside className="w-56 flex-shrink-0 h-full bg-white flex flex-col border-r border-[rgba(15,20,25,0.06)]">
      {/* Brand row */}
      <button
        onClick={onHome}
        className="px-[18px] py-5 flex items-center gap-[11px] w-full text-left border-b border-[rgba(15,20,25,0.06)] hover:bg-[#f4f6f8] transition-colors"
      >
        <Image src="/logo.png" alt="Alpha Horizon" width={34} height={34} className="object-contain flex-shrink-0" />
        <div>
          <div className="font-brand text-[11px] font-extrabold text-[#0f1419] tracking-[0.22em]">ALPHA HORIZON</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#6a7480] mt-0.5">AI Finance Terminal</div>
        </div>
      </button>

      {/* APPS section */}
      <div className="px-[18px] pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9aa3ad]">Apps</div>
      <nav className="px-2.5 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive =
            activeTab !== null &&
            (activeTab === item.id ||
              (item.id === 'market-home' &&
                (activeTab === 'market-long' || activeTab === 'market-near')));
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className="relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg w-full text-left transition-colors hover:bg-[#f4f6f8]"
              style={isActive ? { background: '#f4f6f8' } : undefined}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-full"
                  style={{ background: item.accentHex }}
                />
              )}
              <div
                className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center flex-shrink-0"
                style={{ background: item.softHex, color: item.accentHex }}
              >
                <Icon className="w-[14px] h-[14px]" strokeWidth={1.6} />
              </div>
              <span className="text-[13px] font-medium text-[#1a2330] flex-1 truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Sign out */}
      <div className="p-3 border-t border-[rgba(15,20,25,0.06)]">
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-[#fee2e2] group transition-colors"
        >
          <LogOut className="w-[14px] h-[14px] text-[#9aa3ad] group-hover:text-[#dc2626] flex-shrink-0 transition-colors" strokeWidth={1.6} />
          <span className="text-[13px] text-[#6a7480] group-hover:text-[#dc2626] transition-colors">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
