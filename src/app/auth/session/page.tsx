'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

/**
 * Session activator — Clerk redirects here after sign-in.
 * Sets a sessionStorage flag then sends the user to the dashboard.
 * sessionStorage clears when the tab is closed but survives reloads,
 * so closing + reopening the tab forces a new login.
 */
export default function SessionInit() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      // Set BOTH flags before navigating:
      // ah_tab_session  = ongoing tab session (survives reloads, cleared on tab close)
      // ah_just_authed  = one-time flag so AuthGuard knows this is a fresh sign-in,
      //                   not a Chrome tab-restore, and skips the freshNav check.
      sessionStorage.setItem('ah_tab_session', '1');
      sessionStorage.setItem('ah_just_authed', '1');
      router.replace('/');
      return;
    }
    // Not signed in yet — give Clerk up to 2 s to finish hydrating the session
    // before giving up and redirecting back to sign-in. This prevents a flash
    // redirect when isLoaded briefly becomes true before isSignedIn catches up.
    const timer = setTimeout(() => {
      router.replace('/sign-in');
    }, 2000);
    return () => clearTimeout(timer);
  }, [isLoaded, isSignedIn, router]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );
}
