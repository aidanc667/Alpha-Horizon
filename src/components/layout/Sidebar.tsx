'use client';

import React from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import type { ActiveTab } from '@/types';

interface SidebarProps {
  activeTab: ActiveTab | null;
  onTabChange: (tab: ActiveTab) => void;
  onHome: () => void;
}

const NAV_ITEMS = [
  {
    id: 'planner' as ActiveTab,
    label: 'Portfolio Planner',
    desc: 'Multi-agent construction',
    emoji: '📊',
    accentRgb: '22,163,74',
  },
  {
    id: 'lab' as ActiveTab,
    label: 'Backtesting Lab',
    desc: 'Persona simulation',
    emoji: '🧪',
    accentRgb: '99,102,241',
  },
  {
    id: 'market-home' as ActiveTab,
    label: 'Market Analysis',
    desc: 'Live signals & regime',
    emoji: '📈',
    accentRgb: '124,58,237',
  },
  {
    id: 'advisor' as ActiveTab,
    label: 'Silas Advisor',
    desc: 'AI advisor & watchlist',
    emoji: '🤖',
    accentRgb: '201,168,76',
  },
  {
    id: 'arena' as ActiveTab,
    label: 'Strategy Arena',
    desc: 'Simulation battles',
    emoji: '⚔️',
    accentRgb: '185,28,28',
  },
] as const;

export default function Sidebar({ activeTab, onTabChange, onHome }: SidebarProps) {
  const { signOut } = useClerk();
  const { user } = useUser();

  const handleSignOut = async () => {
    sessionStorage.removeItem('ah_tab_session');
    await signOut();
    window.location.href = '/sign-in';
  };

  const initials =
    user?.firstName?.[0] ??
    user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ??
    'A';

  return (
    <aside
      className="flex-shrink-0 h-full flex flex-col"
      style={{ width: 228, background: '#120d08', borderRight: '1px solid #1e1610' }}
    >
      {/* Brand */}
      <button
        onClick={onHome}
        className="w-full text-left transition-colors"
        style={{ padding: '20px 18px 16px', borderBottom: '1px solid #1e1610' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div className="font-display italic text-white" style={{ fontSize: 24, letterSpacing: '0.01em', lineHeight: 1.1 }}>
          Alpha <span style={{ color: '#C9A84C' }}>Horizon</span>
        </div>
      </button>

      {/* Nav */}
      <nav className="flex-1 p-2 flex flex-col gap-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const isActive =
            activeTab === item.id ||
            (item.id === 'market-home' &&
              (activeTab === 'market-long' || activeTab === 'market-near'));

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className="w-full text-left flex items-center gap-2.5 rounded-[6px] transition-colors"
              style={{
                padding: '9px 10px',
                background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = isActive
                  ? 'rgba(255,255,255,0.08)'
                  : 'transparent';
              }}
            >
              {/* Icon badge */}
              <div
                className="flex-shrink-0 flex items-center justify-center rounded-[6px] text-[13px]"
                style={{
                  width: 28,
                  height: 28,
                  background: `rgba(${item.accentRgb},${isActive ? 0.18 : 0.12})`,
                }}
              >
                {item.emoji}
              </div>
              {/* Text */}
              <div className="flex-1 min-w-0">
                <div
                  className="font-sans truncate"
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1.2,
                    color: isActive ? '#ffffff' : '#e8d8c0',
                  }}
                >
                  {item.label}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      {/* User footer */}
      <div
        className="flex items-center gap-2.5"
        style={{ padding: '12px 14px', borderTop: '1px solid #1e1610' }}
      >
        <div className="relative flex-shrink-0">
          <div
            className="font-display flex items-center justify-center rounded-full"
            style={{
              width: 30,
              height: 30,
              background: '#2a1e14',
              fontSize: 12,
              color: '#C9A84C',
            }}
          >
            {initials}
          </div>
          {/* Online dot */}
          <div
            className="absolute"
            style={{
              bottom: 1,
              right: 1,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#16a34a',
              border: '1.5px solid #120d08',
            }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <button
            onClick={handleSignOut}
            className="font-sans text-left transition-colors"
            style={{ fontSize: 11, color: '#c8b090', fontWeight: 500 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#c8b090')}
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
