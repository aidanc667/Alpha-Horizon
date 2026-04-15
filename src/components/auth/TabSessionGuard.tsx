'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * TabSessionGuard
 * Checks sessionStorage on every page load. sessionStorage is cleared when
 * a tab is closed but survives page reloads — so this forces re-login on
 * tab close without logging out on reload.
 */
export default function TabSessionGuard() {
  const router = useRouter();

  useEffect(() => {
    const tabActive = sessionStorage.getItem('alpha_tab_active');
    if (!tabActive) {
      // Tab was closed and reopened — clear the cookie and redirect to login
      fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
        router.replace('/login');
      });
    }
  }, [router]);

  return null;
}
