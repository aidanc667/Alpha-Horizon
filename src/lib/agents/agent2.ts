import { db } from '@/lib/db';
import type { Agent2Output } from './types';

// ─── Static 2026 fallback baseline ───────────────────────────────────────────
// Used when Neon cache is cold. Values are consensus institutional forecasts
// from JPMorgan LTCMA 2026, Vanguard Market Outlook 2026, BlackRock CMA 2026.
const FALLBACK: Omit<Agent2Output, 'agentName' | 'timestamp' | 'executionTimeMs' | 'performance'> = {
  dataSource: 'fallback',
  macroData: {
    fedFundsRate: 0.0425,   // Fed normalising from 5.25% peak; 4.25% mid-cycle
    treasury10Y:  0.0435,   // 10Y yield — used as risk-free rate
    cpiYoY:       0.028,    // CPI moderating toward 2% target
    shillerCAPE:  32,       // Elevated but below 2021 peak of 38
  },
  regime: {
    current: 'risk_on',
    narrative:
      'Macro backdrop is moderately constructive: Fed cutting cycle underway, ' +
      'inflation trending toward target, credit spreads near historical medians. ' +
      'Risk-on regime favors equities with tactical diversification into bonds as ' +
      'yields remain attractive relative to prior decade.',
  },
  assetClassOutlook: {
    equityValuation: 'expensive',   // CAPE 32 implies modest forward returns
    bondOpportunity: 'attractive',  // Real yields positive; best entry in 15 years
    riskFreeRate:    0.0435,        // 10Y Treasury used in Sharpe calculations
  },
};

// ─── Neon persistence ─────────────────────────────────────────────────────────
// Re-uses the existing macro_cache table (same schema as the v1 pipeline).
// Key 'global_v3' separates v3 entries from v1's 'global' key.

async function readNeonMacro(): Promise<Agent2Output | null> {
  try {
    const sql = db();
    const rows = await sql`
      SELECT data FROM macro_cache
      WHERE cache_key = 'global_v3'
        AND fetched_at > NOW() - INTERVAL '6 hours'
      LIMIT 1
    ` as Array<{ data: Agent2Output }>;
    return rows.length > 0 ? rows[0].data : null;
  } catch {
    return null; // table missing or unreachable — fail open
  }
}

function writeNeonMacro(output: Agent2Output): void {
  // Fire-and-forget — never blocks the request path
  void (async () => {
    try {
      const sql = db();
      await sql`
        INSERT INTO macro_cache (cache_key, data, fetched_at)
        VALUES ('global_v3', ${JSON.stringify(output)}::jsonb, NOW())
        ON CONFLICT (cache_key) DO UPDATE
          SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at
      `;
    } catch (e) {
      console.error('[agent2] Neon write failed:', e);
    }
  })();
}

// ─── In-process L1 cache (warm Lambda) ───────────────────────────────────────
const MACRO_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let _l1: { data: Agent2Output; fetchedAt: number } | null = null;

// ─── Agent 2: Economic Intelligence ──────────────────────────────────────────

/**
 * Returns the macro backdrop for portfolio construction.
 *
 * Cache hierarchy (fastest to slowest):
 *   L1 — lambda process memory        (~0ms, lost on cold start)
 *   L2 — Neon Postgres macro_cache    (~50ms, survives cold starts)
 *   L3 — static 2026 fallback         (~0ms, stale but always available)
 *
 * Live web-search is intentionally removed — the pipeline is fully
 * deterministic. Update FALLBACK when institutional CMAs refresh (Jan each year).
 */
export async function agent2_economicIntelligence(input: {
  requestDate: string;
}): Promise<Agent2Output> {
  const startTime = Date.now();

  // L1: in-process memory
  if (_l1 && Date.now() - _l1.fetchedAt < MACRO_TTL_MS) {
    return _l1.data;
  }

  // L2: Neon Postgres
  const neon = await readNeonMacro();
  if (neon) {
    _l1 = { data: neon, fetchedAt: Date.now() };
    return neon;
  }

  // L3: static fallback — build and persist for future requests
  const executionTimeMs = Date.now() - startTime;
  const output: Agent2Output = {
    agentName: 'capitalMarkets',
    timestamp: input.requestDate,
    executionTimeMs,
    ...FALLBACK,
    performance: {
      targetLatencyMs: 50,
      actualLatencyMs: executionTimeMs,
      withinSLA: executionTimeMs <= 50,
    },
  };

  _l1 = { data: output, fetchedAt: Date.now() };
  writeNeonMacro(output);

  return output;
}
