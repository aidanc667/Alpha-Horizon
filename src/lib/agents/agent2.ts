import { db } from '@/lib/db';
import type { Agent2Output } from './types';

// ─── Static fallback baseline ─────────────────────────────────────────────────
// Used when FRED_API_KEY is not set or FRED is unreachable.
// Values are consensus institutional forecasts from JPMorgan LTCMA 2026,
// Vanguard Market Outlook 2026, BlackRock CMA 2026.
const FALLBACK: Omit<Agent2Output, 'agentName' | 'timestamp' | 'executionTimeMs' | 'performance' | 'macroFetchedAt' | 'dataAge'> = {
  dataSource: 'fallback',
  macroData: {
    fedFundsRate:  0.0425,
    treasury10Y:   0.0435,
    cpiYoY:        0.028,
    shillerCAPE:   32,
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
    equityValuation: 'expensive',
    bondOpportunity: 'attractive',
    riskFreeRate:    0.0435,
  },
};

// ─── FRED API ─────────────────────────────────────────────────────────────────
//
// All series used here are from the Federal Reserve Bank of St. Louis.
// API key: free at https://fred.stlouisfed.org/docs/api/api_key.html
// Set FRED_API_KEY in .env.local (and in Vercel dashboard for production).
//
// Series:
//   DGS10          — 10-Year Treasury Constant Maturity Rate
//   DGS2           — 2-Year Treasury Constant Maturity Rate
//   DFF            — Effective Federal Funds Rate
//   CPIAUCSL       — CPI All Items (need 13 obs to compute YoY)
//   T10YIE         — 10-Year Breakeven Inflation Rate (inflation expectations)
//   BAMLH0A0HYM2   — ICE BofA US High Yield Option-Adjusted Spread
//   CAPE           — Shiller CAPE ratio (Robert Shiller dataset via FRED, monthly)

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

interface FredObs { date: string; value: string }
interface FredResponse { observations: FredObs[] }

async function fetchFred(seriesId: string, limit: number, apiKey: string): Promise<number | null> {
  const url =
    `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}` +
    `&limit=${limit}&sort_order=desc&file_type=json`;

  const res = await fetch(url, { next: { revalidate: 86400 } }); // 24h CDN cache
  if (!res.ok) return null;

  const json = (await res.json()) as FredResponse;
  // FRED returns "." for missing values (weekends, holidays) — skip them
  const valid = json.observations.find(o => o.value !== '.' && o.value !== '');
  if (!valid) return null;

  return parseFloat(valid.value) / 100; // FRED stores rates as percentages (4.23 → 0.0423)
}

async function fetchFredRaw(seriesId: string, limit: number, apiKey: string): Promise<number | null> {
  // Like fetchFred but does NOT divide by 100 (for CAPE, spreads already in bps or index)
  const url =
    `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}` +
    `&limit=${limit}&sort_order=desc&file_type=json`;

  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) return null;

  const json = (await res.json()) as FredResponse;
  const valid = json.observations.find(o => o.value !== '.' && o.value !== '');
  if (!valid) return null;

  return parseFloat(valid.value);
}

async function fetchCpiYoY(apiKey: string): Promise<number | null> {
  // Need 13 months of data to compute year-over-year change
  const url =
    `${FRED_BASE}?series_id=CPIAUCSL&api_key=${apiKey}` +
    `&limit=14&sort_order=desc&file_type=json`;

  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) return null;

  const json = (await res.json()) as FredResponse;
  const valid = json.observations.filter(o => o.value !== '.' && o.value !== '');
  if (valid.length < 13) return null;

  const latest = parseFloat(valid[0].value);
  const yearAgo = parseFloat(valid[12].value);
  return (latest - yearAgo) / yearAgo; // YoY decimal (0.028 = 2.8%)
}

// ─── Derive macro regime from live data ───────────────────────────────────────
//
// Regime classification:
//   risk_on  — credit markets calm, yield curve not severely inverted, inflation under control
//   risk_off — HY spreads spiking, yield curve warning, inflation elevated
//
// HY spread (BAMLH0A0HYM2) thresholds:
//   < 300bps  → tight / risk-on
//   300–500   → neutral (lean risk-on)
//   > 500bps  → stress / risk-off
//
// Yield curve (2Y vs 10Y): deep inversion (>75bps) is a recession signal

function deriveRegime(data: {
  treasury10Y:   number;
  treasury2Y:    number;
  fedFundsRate:  number;
  cpiYoY:        number;
  hySpreadBps:   number;
  inflationExp:  number;
}): { current: 'risk_on' | 'risk_off'; narrative: string } {
  const { treasury10Y, treasury2Y, cpiYoY, hySpreadBps, inflationExp } = data;
  const curveInverted = treasury2Y - treasury10Y > 0.0075; // 2Y > 10Y by > 75bps
  const hyStressed    = hySpreadBps > 500;
  const hyElevated    = hySpreadBps > 350;
  const inflationHot  = cpiYoY > 0.04;
  const realYield     = treasury10Y - inflationExp; // positive = real return available

  const isRiskOff = hyStressed || (curveInverted && hyElevated) || (inflationHot && hyElevated);
  const current: 'risk_on' | 'risk_off' = isRiskOff ? 'risk_off' : 'risk_on';

  const hyParts: string[] = [];
  if (hySpreadBps < 300)       hyParts.push('credit spreads tight');
  else if (hySpreadBps < 500)  hyParts.push(`credit spreads moderately elevated (${hySpreadBps.toFixed(0)}bps)`);
  else                         hyParts.push(`credit spreads stressed (${hySpreadBps.toFixed(0)}bps)`);

  const curvePart = curveInverted
    ? `yield curve inverted (2Y ${(treasury2Y * 100).toFixed(2)}% > 10Y ${(treasury10Y * 100).toFixed(2)}%)`
    : `yield curve normal (10Y ${(treasury10Y * 100).toFixed(2)}%, 2Y ${(treasury2Y * 100).toFixed(2)}%)`;

  const realPart = realYield > 0.015
    ? `Real yields positive at ${(realYield * 100).toFixed(2)}% — bonds offer genuine return above inflation`
    : realYield > 0
    ? `Real yields marginally positive at ${(realYield * 100).toFixed(2)}%`
    : `Real yields negative — inflation eroding purchasing power of bonds`;

  const inflationPart = inflationHot
    ? `CPI elevated at ${(cpiYoY * 100).toFixed(1)}% — TIPS and real assets add inflation protection`
    : `CPI moderating at ${(cpiYoY * 100).toFixed(1)}%`;

  const narrative = [
    current === 'risk_off'
      ? 'Risk-off regime: elevated credit stress and/or macro headwinds warrant defensive positioning.'
      : 'Risk-on regime: constructive macro backdrop supports diversified equity exposure.',
    hyParts[0] + ', ' + curvePart + '.',
    realPart + '.',
    inflationPart + '.',
  ].join(' ');

  return { current, narrative };
}

function deriveEquityValuation(
  treasury10Y: number,
  inflationExp: number,
): 'cheap' | 'fair' | 'expensive' {
  const realYield = treasury10Y - inflationExp;
  // High real yields mean bonds compete with equities — equities are relatively expensive
  if (realYield > 0.025) return 'expensive';
  if (realYield > 0.010) return 'fair';
  return 'cheap';
}

// ─── Live fetch ───────────────────────────────────────────────────────────────

async function fetchLiveMacro(apiKey: string): Promise<
  Omit<Agent2Output, 'agentName' | 'timestamp' | 'executionTimeMs' | 'performance' | 'macroFetchedAt' | 'dataAge'> | null
> {
  try {
    const [treasury10Y, treasury2Y, fedFundsRate, cpiYoY, inflationExp, hySpread, capeRaw] =
      await Promise.all([
        fetchFred('DGS10', 5, apiKey),
        fetchFred('DGS2', 5, apiKey),
        fetchFred('DFF', 5, apiKey),
        fetchCpiYoY(apiKey),
        fetchFred('T10YIE', 5, apiKey),
        fetchFredRaw('BAMLH0A0HYM2', 5, apiKey), // already in bps (3.45 = 345bps)
        fetchFredRaw('CAPE', 2, apiKey),           // Robert Shiller CAPE — FRED series CAPE (monthly)
      ]);

    // Require at least the 10Y yield — everything else has fallbacks
    if (treasury10Y === null) return null;

    const t10y = treasury10Y;
    const t2y  = treasury2Y  ?? t10y * 0.95;  // rough fallback
    const ff   = fedFundsRate ?? t2y;
    const cpi  = cpiYoY      ?? FALLBACK.macroData.cpiYoY;
    const ie   = inflationExp ?? 0.024;         // historical avg breakeven
    // 450bps: conservative fallback above long-run ICE BofA US HY OAS mean (~400–450bps, 1996–2025).
    // Intentionally slightly risk-averse: a FRED outage during a stress event should not
    // falsely classify elevated spreads as risk-on.
    const hyBps = hySpread !== null ? hySpread * 100 : 450;

    const regime = deriveRegime({
      treasury10Y:  t10y,
      treasury2Y:   t2y,
      fedFundsRate: ff,
      cpiYoY:       cpi,
      hySpreadBps:  hyBps,
      inflationExp: ie,
    });

    return {
      dataSource: 'live',
      macroData: {
        fedFundsRate: ff,
        treasury10Y:  t10y,
        cpiYoY:       cpi,
        shillerCAPE:  capeRaw ?? FALLBACK.macroData.shillerCAPE, // FRED series CAPE (monthly, Shiller)
      },
      regime,
      assetClassOutlook: {
        equityValuation: deriveEquityValuation(t10y, ie),
        bondOpportunity: t10y > 0.04 ? 'attractive' : 'neutral',
        riskFreeRate:    t10y, // 10Y Treasury is the risk-free rate used in Sharpe calculations
      },
    };
  } catch (e) {
    console.warn('[agent2] FRED fetch failed:', e);
    return null;
  }
}

// ─── Neon persistence (L2 cache) ─────────────────────────────────────────────

async function readNeonMacro(): Promise<Agent2Output | null> {
  try {
    const sql = db();
    const rows = await sql`
      SELECT data FROM macro_cache
      WHERE cache_key = 'global_v3'
        AND fetched_at > NOW() - INTERVAL '24 hours'
      LIMIT 1
    ` as Array<{ data: Agent2Output }>;
    return rows.length > 0 ? rows[0].data : null;
  } catch {
    return null;
  }
}

function writeNeonMacro(output: Agent2Output): void {
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

// ─── In-process L1 cache (warm serverless instance) ─────────────────────────
const MACRO_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let _l1: { data: Agent2Output; fetchedAt: number } | null = null;

// ─── Data-age helper (L6) ─────────────────────────────────────────────────────
// Recomputes `dataAge` from `macroFetchedAt` at read time so cache hits always
// return an accurate staleness value rather than the stale `dataAge: 0` stored
// when the data was originally fetched.
function withDataAge(output: Agent2Output): Agent2Output {
  const dataAge = Math.floor((Date.now() - Date.parse(output.macroFetchedAt)) / 1000);
  return { ...output, dataAge };
}

// ─── Agent 2: Economic Intelligence ──────────────────────────────────────────
//
// Cache hierarchy (fastest to slowest):
//   L1 — lambda process memory                    (~0ms, lost on cold start)
//   L2 — Neon Postgres macro_cache                (~50ms, survives cold starts)
//   L3 — FRED API (live market data)              (~300ms, requires FRED_API_KEY)
//   L4 — static 2026 fallback                     (~0ms, always available)
//
// The live FRED fetch refreshes the Neon cache so subsequent requests are fast.

export async function agent2_economicIntelligence(input: {
  requestDate: string;
}): Promise<Agent2Output> {
  const startTime = Date.now();

  // L1: in-process memory
  if (_l1 && Date.now() - _l1.fetchedAt < MACRO_TTL_MS) {
    return withDataAge(_l1.data);
  }

  // L2: Neon Postgres
  const neon = await readNeonMacro();
  if (neon) {
    _l1 = { data: neon, fetchedAt: Date.now() };
    return withDataAge(neon);
  }

  // L3: Live FRED data (requires FRED_API_KEY env var)
  const fredKey = process.env.FRED_API_KEY;
  let liveData: Omit<Agent2Output, 'agentName' | 'timestamp' | 'executionTimeMs' | 'performance' | 'macroFetchedAt' | 'dataAge'> | null = null;

  if (fredKey) {
    liveData = await fetchLiveMacro(fredKey);
    if (liveData) {
      console.log('[agent2] Live FRED data fetched successfully');
    } else {
      console.warn('[agent2] FRED fetch returned null — falling back to static data');
    }
  } else {
    console.warn('[agent2] FRED_API_KEY not set — using static fallback. Set it at fred.stlouisfed.org/docs/api/api_key.html');
  }

  const executionTimeMs = Date.now() - startTime;
  const source = liveData ?? FALLBACK;
  const macroFetchedAt = new Date().toISOString();

  const output: Agent2Output = {
    agentName: 'capitalMarkets',
    timestamp: input.requestDate,
    executionTimeMs,
    ...source,
    macroFetchedAt,
    dataAge: 0, // will be recomputed via withDataAge on subsequent cache reads
    performance: {
      targetLatencyMs: 500,
      actualLatencyMs: executionTimeMs,
      withinSLA: executionTimeMs <= 500,
    },
  };

  _l1 = { data: output, fetchedAt: Date.now() };
  writeNeonMacro(output);

  return output;
}
