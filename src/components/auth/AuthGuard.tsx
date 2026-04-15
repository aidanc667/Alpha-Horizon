'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAuth, useClerk } from '@clerk/nextjs';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Determines if this page load is a genuine new visit (not a reload).
 * - 'navigate' = fresh URL entry, link click, or browser restore → require login
 * - 'reload'   = F5 / Cmd+R → allow through without re-login
 */
function isFreshNavigation(): boolean {
  try {
    const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (entries.length > 0) return entries[0].type === 'navigate';
  } catch {}
  return true;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [tabSessionOk, setTabSessionOk] = useState<boolean | null>(null);
  // Ensures the freshNav / flag check runs exactly once per component mount.
  // Without this, Clerk's signOut reference changing on re-renders would
  // re-trigger the effect, hit freshNav=true after ah_just_authed was already
  // consumed, and kick the user back to sign-in immediately after landing.
  const sessionChecked = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;

    // Always react to a sign-out — if Clerk says not signed in, redirect.
    if (!isSignedIn) {
      window.location.href = '/sign-in';
      return;
    }

    // Only run the one-time session validation once per mount.
    if (sessionChecked.current) return;
    sessionChecked.current = true;

    // One-time post-sign-in bypass: SessionInit sets 'ah_just_authed' right
    // before router.replace('/').  Consuming it here skips the freshNav check
    // so the post-auth redirect isn't mistaken for a Chrome tab-restore.
    const justAuthed = sessionStorage.getItem('ah_just_authed');
    if (justAuthed) {
      sessionStorage.removeItem('ah_just_authed');
      setTabSessionOk(true);
      return;
    }

    const flag = sessionStorage.getItem('ah_tab_session');
    const freshNav = isFreshNavigation();

    if (!flag || freshNav) {
      // No session flag OR fresh navigation (new tab / browser restore) → re-login.
      sessionStorage.removeItem('ah_tab_session');
      signOut().then(() => {
        window.location.href = '/sign-in';
      });
      return;
    }

    setTabSessionOk(true);
  }, [isLoaded, isSignedIn, signOut]);

  if (!isLoaded || tabSessionOk === null) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <p className="text-sm text-zinc-500 font-mono">Loading…</p>
        </div>
      </div>
    );
  }

  if (!tabSessionOk) return null;

  return <>{children}</>;
}
