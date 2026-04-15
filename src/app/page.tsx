'use client';

import React from 'react';
import AuthGuard from '@/components/auth/AuthGuard';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PlannerTab from '@/components/planner/PlannerTab';
import LabTab from '@/components/lab/LabTab';
import { AppContextProvider } from '@/lib/appContext';
import type { ActiveTab } from '@/types';

export default function HomePage() {
  return (
    <AuthGuard>
      <AppContextProvider>
        <DashboardLayout>
          {(activeTab: ActiveTab) => (
            <>
              {activeTab === 'planner' && <PlannerTab />}
              {activeTab === 'lab'     && <LabTab />}
            </>
          )}
        </DashboardLayout>
      </AppContextProvider>
    </AuthGuard>
  );
}
