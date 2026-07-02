'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import HomeLanding from './HomeLanding';
import MarketTab from '@/components/market/MarketTab';
import AdvisorTab from '@/components/advisor/AdvisorTab';
import ArenaTab from '@/components/arena/ArenaTab';
import ErrorBoundary from './ErrorBoundary';
import { useAppContext } from '@/lib/appContext';
import type { ActiveTab } from '@/types';

type AppView = 'home' | ActiveTab;

interface DashboardLayoutProps {
  children: (activeTab: ActiveTab) => React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [view, setView] = useState<AppView>('home');
  const { registerAdvisorNav, registerLabNav } = useAppContext();

  // Register navigation handlers so any tab can call navigateToAdvisor() / navigateToLab()
  useEffect(() => {
    registerAdvisorNav(() => setView('advisor'));
    registerLabNav(() => setView('lab'));
  }, [registerAdvisorNav, registerLabNav]);

  const activeTab = view === 'home' ? null : view;

  return (
    <div className="flex h-screen overflow-hidden bg-[#faf8f3]">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab as ActiveTab}
        onTabChange={(tab) => setView(tab)}
        onHome={() => setView('home')}
      />

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto bg-[#faf8f3]">
        {view === 'home' ? (
          <HomeLanding onNavigate={(tab) => setView(tab)} />
        ) : view === 'market-home' ? (
          <ErrorBoundary label="Market tab failed to load"><MarketTab key="market-home" initialView="home" onBack={() => setView('home')} onNavigate={(v) => setView(v as ActiveTab)} /></ErrorBoundary>
        ) : view === 'market-near' || view === 'market-long' ? (
          <ErrorBoundary label="Market tab failed to load"><MarketTab key="market-near" initialView="near-term" onBack={() => setView('market-home')} onNavigate={(v) => setView(v as ActiveTab)} /></ErrorBoundary>
        ) : view === 'advisor' ? (
          <ErrorBoundary label="Silas failed to load"><AdvisorTab /></ErrorBoundary>
        ) : view === 'arena' ? (
          <ErrorBoundary label="Arena failed to load"><ArenaTab /></ErrorBoundary>
        ) : (
          children(view as ActiveTab)
        )}
      </main>
    </div>
  );
}
