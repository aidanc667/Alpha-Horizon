'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import HomeLanding from './HomeLanding';
import MarketTab from '@/components/market/MarketTab';
import AdvisorTab from '@/components/advisor/AdvisorTab';
import ArenaTab from '@/components/arena/ArenaTab';
import PortfolioAgentPage from '@/apps/portfolio-agent/page';
import { useAppContext } from '@/lib/appContext';
import type { ActiveTab } from '@/types';

type AppView = 'home' | ActiveTab;

interface DashboardLayoutProps {
  children: (activeTab: ActiveTab) => React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [view, setView] = useState<AppView>('home');
  const { registerAdvisorNav } = useAppContext();

  // Register the navigation handler so any tab can call navigateToAdvisor()
  useEffect(() => {
    registerAdvisorNav(() => setView('advisor'));
  }, [registerAdvisorNav]);

  const activeTab = view === 'home' ? null : view;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab as ActiveTab}
        onTabChange={(tab) => setView(tab)}
        onHome={() => setView('home')}
      />

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto bg-slate-50">
        {view === 'home' ? (
          <HomeLanding onNavigate={(tab) => setView(tab)} />
        ) : view === 'market-home' ? (
          <MarketTab key="market-home" initialView="home" onBack={() => setView('home')} onNavigate={(v) => setView(v as ActiveTab)} />
        ) : view === 'market-near' || view === 'market-long' ? (
          <MarketTab key="market-near" initialView="near-term" onBack={() => setView('market-home')} onNavigate={(v) => setView(v as ActiveTab)} />
        ) : view === 'advisor' ? (
          <AdvisorTab />
        ) : view === 'arena' ? (
          <ArenaTab />
        ) : view === 'portfolio-agent' ? (
          <PortfolioAgentPage />
        ) : (
          children(view as ActiveTab)
        )}
      </main>
    </div>
  );
}
