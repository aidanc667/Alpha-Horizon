/**
 * instrumentation.ts
 *
 * Runs once when the Next.js server starts (both dev and production).
 * Used to create database tables that must exist before any request is served.
 *
 * Without these tables:
 *   macro_cache missing → Capital Markets agent re-runs Google Search every cold start (~20s)
 *   plan_cache missing  → Plan cache never works; every request hits the full pipeline
 */
export async function register() {
  // Only run on the Node.js server runtime — not in the Edge runtime or client.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { runMigrations } = await import('@/lib/db');
    await runMigrations();
    console.log('[instrumentation] DB migrations complete (macro_cache + plan_cache ready)');
  } catch (e) {
    // Log but never crash the server — app works without cache, just slower.
    console.error('[instrumentation] DB migration failed — cache tables may be missing:', e);
  }
}
