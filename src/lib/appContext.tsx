'use client';

// ─── Cross-Tab Application Context ──────────────────────────────────────────
// Lightweight shared state so Portfolio Intelligence AI (AdvisorTab) knows what
// the user has run in the Portfolio Growth Lab (LabTab) and Financial Planner
// (PlannerTab).  All snapshots are plain strings — easy to serialize into
// AI system prompts.

import React, { createContext, useContext, useState, useCallback } from 'react';

// ── Lab snapshot (from LabTab after simulation) ───────────────────────────────
export interface LabSnapshot {
  allocations: string;   // "SPY 60%, QQQ 30%, BND 10%"
  period: string;        // "2021-01-01 → 2025-12-31"
  cagr: string;          // "+15.2%"
  sharpe: string;        // "1.42"
  maxDD: string;         // "-22.3%"
  alpha: string;         // "+4.8%"
  score: number | null;  // AHPS score (0–100) or null
  updatedAt: string;     // ISO timestamp
}

// ── Planner snapshot (from PlannerTab after plan generation) ─────────────────
export interface PlannerSnapshot {
  riskProfile: string;      // "Moderate"
  timeline: string;         // "15 years"
  goal: string;             // "$1,500,000"
  monthlyContrib: string;   // "$2,500"
  buckets: string;          // "Safety 20% / Growth 60% / Retirement 20%"
  marginalFederal: string;  // "22%"
  marginalCA: string;       // "9.3%"
  topHoldings: string;      // "VTI, SCHD, BND, TIPS"
  updatedAt: string;
}

// ── Context shape ─────────────────────────────────────────────────────────────
interface AppContextValue {
  labSnapshot: LabSnapshot | null;
  plannerSnapshot: PlannerSnapshot | null;
  setLabSnapshot: (snap: LabSnapshot) => void;
  setPlannerSnapshot: (snap: PlannerSnapshot) => void;
  /** Human-readable context string ready to inject into an AI system prompt */
  buildAdvisorContext: () => string;
  /** Navigate to the Advisor tab from any tab — registered by DashboardLayout */
  navigateToAdvisor: () => void;
  /** Called by DashboardLayout to register the navigation handler */
  registerAdvisorNav: (fn: () => void) => void;
  /** Navigate to the Lab tab from any tab — registered by DashboardLayout */
  navigateToLab: () => void;
  /** Called by DashboardLayout to register the lab navigation handler */
  registerLabNav: (fn: () => void) => void;
}

const AppContext = createContext<AppContextValue>({
  labSnapshot: null,
  plannerSnapshot: null,
  setLabSnapshot: () => {},
  setPlannerSnapshot: () => {},
  buildAdvisorContext: () => '',
  navigateToAdvisor: () => {},
  registerAdvisorNav: () => {},
  navigateToLab: () => {},
  registerLabNav: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────
export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [labSnapshot,     setLabSnapshotState]     = useState<LabSnapshot | null>(null);
  const [plannerSnapshot, setPlannerSnapshotState] = useState<PlannerSnapshot | null>(null);
  const advisorNavRef = React.useRef<(() => void) | null>(null);
  const labNavRef     = React.useRef<(() => void) | null>(null);

  const setLabSnapshot     = useCallback((snap: LabSnapshot)     => setLabSnapshotState(snap),     []);
  const setPlannerSnapshot = useCallback((snap: PlannerSnapshot) => setPlannerSnapshotState(snap), []);
  const registerAdvisorNav = useCallback((fn: () => void) => { advisorNavRef.current = fn; },      []);
  const navigateToAdvisor  = useCallback(() => { advisorNavRef.current?.(); },                     []);
  const registerLabNav     = useCallback((fn: () => void) => { labNavRef.current = fn; },          []);
  const navigateToLab      = useCallback(() => { labNavRef.current?.(); },                         []);

  /** Formats both snapshots into a system-prompt block for the AI. */
  const buildAdvisorContext = useCallback((): string => {
    const parts: string[] = [];

    if (labSnapshot) {
      parts.push(`[PORTFOLIO GROWTH LAB — last run ${labSnapshot.updatedAt}]`);
      parts.push(`Holdings: ${labSnapshot.allocations}`);
      parts.push(`Period: ${labSnapshot.period}`);
      parts.push(`CAGR: ${labSnapshot.cagr} | Sharpe: ${labSnapshot.sharpe} | Max Drawdown: ${labSnapshot.maxDD} | Alpha vs benchmark: ${labSnapshot.alpha}`);
      if (labSnapshot.score !== null) parts.push(`AHPS Score: ${labSnapshot.score}/100`);
    }

    if (plannerSnapshot) {
      if (parts.length) parts.push('');
      parts.push(`[FINANCIAL PLANNER — last run ${plannerSnapshot.updatedAt}]`);
      parts.push(`Risk Profile: ${plannerSnapshot.riskProfile} | Timeline: ${plannerSnapshot.timeline} | Goal: ${plannerSnapshot.goal} | Monthly Contribution: ${plannerSnapshot.monthlyContrib}`);
      parts.push(`Bucket Allocation: ${plannerSnapshot.buckets}`);
      parts.push(`Top Holdings Recommended: ${plannerSnapshot.topHoldings}`);
      parts.push(`Tax Brackets: Federal ${plannerSnapshot.marginalFederal} marginal | CA ${plannerSnapshot.marginalCA} marginal`);
    }

    return parts.join('\n');
  }, [labSnapshot, plannerSnapshot]);

  return (
    <AppContext.Provider value={{ labSnapshot, plannerSnapshot, setLabSnapshot, setPlannerSnapshot, buildAdvisorContext, navigateToAdvisor, registerAdvisorNav, navigateToLab, registerLabNav }}>
      {children}
    </AppContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useAppContext() {
  return useContext(AppContext);
}
