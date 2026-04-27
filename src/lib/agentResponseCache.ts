/**
 * agentResponseCache.ts
 *
 * Two-level plan cache — mirrors the macro cache architecture.
 *
 *   L1 — Lambda process memory (~0ms, lost on cold start)
 *   L2 — Neon Postgres (~50ms, survives cold starts across all instances)
 *
 * Cache key: PLAN_CACHE_VERSION prefix + SHA-256 of sorted IntakeAnswers JSON.
 * Bump PLAN_CACHE_VERSION whenever the pipeline logic changes enough to invalidate
 * prior results (e.g. new policy rules, schema additions).
 *
 * TTL: 24 hours (market conditions refresh daily via Capital Markets agent).
 * Only final validated plans are cached — never partial drafts.
 *
 * Requires: plan_cache table in Neon (run runPlanCacheMigration() once per env).
 * Fail-open: if Neon is unavailable, L1 still works; on full miss the live pipeline runs.
 */

import type { PortfolioPlan } from '@/apps/portfolio-agent/types';
import { db } from '@/lib/db';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Bump this string to invalidate all cached plans (e.g. after pipeline logic changes).
const PLAN_CACHE_VERSION = 'v2';

interface CacheEntry {
  plan: PortfolioPlan;
  logs: string[];
  createdAt: number;
}

// L1: in-memory store (fast on warm Lambda, lost on cold start)
const store = new Map<string, CacheEntry>();

/** Deterministic SHA-256 hash of intake answers (deep-sorted keys, version-prefixed). */
async function hashIntake(obj: Record<string, unknown>): Promise<string> {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  const data = new TextEncoder().encode(JSON.stringify(sorted));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${PLAN_CACHE_VERSION}:${hex}`;
}

// ── L2: Neon helpers (fire-and-forget writes, fail-open reads) ────────────────

async function getNeonCachedPlan(key: string): Promise<{ plan: PortfolioPlan; logs: string[] } | null> {
  try {
    const sql = db();
    const rows = await sql`
      SELECT plan_json, logs_json FROM plan_cache
      WHERE cache_key = ${key}
        AND created_at > NOW() - INTERVAL '24 hours'
      LIMIT 1
    ` as Array<{ plan_json: PortfolioPlan; logs_json: string[] }>;
    if (rows.length === 0) return null;
    console.log(JSON.stringify({ stage: 'plan_cache', hit: true, level: 'neon' }));
    return { plan: rows[0].plan_json, logs: rows[0].logs_json ?? [] };
  } catch (e) {
    console.log(JSON.stringify({ stage: 'plan_cache', neon_read_error: true, error: e instanceof Error ? e.message.slice(0, 80) : String(e) }));
    return null;
  }
}

function setNeonCachedPlan(key: string, plan: PortfolioPlan, logs: string[]): void {
  // Fire-and-forget — never blocks the request path.
  (async () => {
    try {
      const sql = db();
      const planStr = JSON.stringify(plan);
      const logsStr = JSON.stringify(logs);
      await sql`
        INSERT INTO plan_cache (cache_key, plan_json, logs_json, created_at)
        VALUES (${key}, ${planStr}::jsonb, ${logsStr}::jsonb, NOW())
        ON CONFLICT (cache_key) DO UPDATE
          SET plan_json = EXCLUDED.plan_json,
              logs_json = EXCLUDED.logs_json,
              created_at = EXCLUDED.created_at
      `;
      console.log(JSON.stringify({ stage: 'plan_cache', neon_write: 'ok' }));
    } catch (e) {
      console.error('[plan cache] Neon write failed:', e instanceof Error ? e.message : e);
    }
  })();
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getCachedPlan(
  answers: Record<string, unknown>
): Promise<{ plan: PortfolioPlan; logs: string[] } | null> {
  const key = await hashIntake(answers);

  // L1: in-memory
  const entry = store.get(key);
  if (entry) {
    if (Date.now() - entry.createdAt <= CACHE_TTL_MS) {
      console.log(JSON.stringify({ stage: 'plan_cache', hit: true, level: 'memory' }));
      return { plan: entry.plan, logs: [...entry.logs, '[cache] Served from memory cache.'] };
    }
    store.delete(key);
  }

  // L2: Neon
  const neon = await getNeonCachedPlan(key);
  if (neon) {
    store.set(key, { plan: neon.plan, logs: neon.logs, createdAt: Date.now() }); // warm L1
    return { plan: neon.plan, logs: [...neon.logs, '[cache] Served from persistent cache.'] };
  }

  console.log(JSON.stringify({ stage: 'plan_cache', hit: false }));
  return null;
}

export async function setCachedPlan(
  answers: Record<string, unknown>,
  plan: PortfolioPlan,
  logs: string[]
): Promise<void> {
  const key = await hashIntake(answers);

  // L1: in-memory
  store.set(key, { plan, logs, createdAt: Date.now() });

  // Prune expired L1 entries (simple GC — runs on every write)
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (now - v.createdAt > CACHE_TTL_MS) store.delete(k);
  }

  // L2: Neon (fire-and-forget)
  setNeonCachedPlan(key, plan, logs);
}

/** For admin/debug: returns L1 cache size. */
export function getCacheStats() {
  return { size: store.size, keys: [...store.keys()].map(k => k.slice(0, 12) + '...') };
}
