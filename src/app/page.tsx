'use client';

import React from 'react';
import AuthGuard from '@/components/auth/AuthGuard';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PlannerTab from '@/components/planner/PlannerTab';
import LabTab from '@/components/lab/LabTab';
import ErrorBoundary from '@/components/layout/ErrorBoundary';
import { AppContextProvider } from '@/lib/appContext';
import type { ActiveTab } from '@/types';

export default function HomePage() {
  return (
    <AuthGuard>
      <AppContextProvider>
        <DashboardLayout>
          {(activeTab: ActiveTab) => (
            <>
              {activeTab === 'planner' && <ErrorBoundary label="Planner failed to load"><PlannerTab /></ErrorBoundary>}
              {activeTab === 'lab'     && <ErrorBoundary label="Lab failed to load"><LabTab /></ErrorBoundary>}
            </>
          )}
        </DashboardLayout>
      </AppContextProvider>
    </AuthGuard>
  );
}
