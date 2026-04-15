/**
 * cmaStore.ts — Source-tagged Capital Market Assumptions
 *
 * Two-level return resolution for every ETF in the universe:
 *
 *   Level 1 — Bucket consensus (primary)
 *     Institutional source values from cmaData.json.
 *     Consensus = median of non-null sources (JPMorgan, Vanguard, BlackRock, Morningstar).
 *     ETF mapped to its closest asset-class bucket; small deterministic factor adjustments
 *     applied in code for ETFs whose bucket is an imperfect proxy.
 *
 *   Level 2 — CMA_STORE internal estimates (fallback)
 *     Used only for tickers with no bucket coverage: SCHP, BNDX, VTEB, CMF, VPU.
 *     Internal best-effort estimates; update when institutional data becomes available.
 *
 * To update CMA data: edit cmaData.json only. No other code changes needed.
 * To add a new ETF: add it to ETF_BUCKET_MAP and (if needed) ETF_FACTOR_ADJUSTMENTS.
 */

import cmaData from './cmaData.json';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CMASource = 'internal' | 'jpmorgan' | 'vanguard' | 'blackrock' | 'morningstar' | 'blended';

export interface CMAEntry {
  ticker:         string;
  assetClass:     string;
  expectedReturn: number;
  source:         CMASource;
  asOfDate:       string;      // 'YYYY-MM'
  placeholder:    boolean;
  notes?:         string;
}

type BucketKey = keyof typeof cmaData.buckets;

// ─── Bucket Consensus ─────────────────────────────────────────────────────────
// Median of non-null institutional source values per the JSON's consensusMethod.
// Falls back to bucket.internalFallback when all external sources are null.

function bucketConsensus(key: BucketKey): number {
  const bucket = cmaData.buckets[key];
  const vals   = Object.values(bucket.sources).filter((v): v is number => v !== null);
  if (vals.length === 0) return bucket.internalFallback;
  const s = [...vals].sort((a, b) => a - b);
  return s.length % 2 === 1
    ? s[Math.floor(s.length / 2)]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// Pre-compute all bucket consensuses at module load — pure arithmetic, ~0ms.
const BC = Object.fromEntries(
  (Object.keys(cmaData.buckets) as BucketKey[]).map(k => [k, bucketConsensus(k)])
) as Record<BucketKey, number>;

// ─── ETF → Bucket Map ─────────────────────────────────────────────────────────
// Maps each whitelisted ETF ticker to its CMA bucket.
//   null  = no bucket coverage → falls through to CMA_STORE internal entry
//   'BLEND_VT'   = weighted composite: ~60% US + 40% Developed_ExUS
//   'BLEND_VXUS' = weighted composite: ~75% Developed_ExUS + 25% EM

type BucketMapping = BucketKey | 'BLEND_VT' | 'BLEND_VXUS' | null;

const ETF_BUCKET_MAP: Record<string, BucketMapping> = {
  // Safety / Cash — 10-yr forward; lower than current Fed Funds Rate (reflects normalisation)
  SGOV: 'Cash',
  BIL:  'Cash',
  USFR: 'Cash',

  // US Equity — all variants anchor to US_Large_Cap bucket; factor adjustments below
  VTI:  'US_Large_Cap_Equity',
  VOO:  'US_Large_Cap_Equity',
  AVUV: 'US_Small_Value',
  VBR:  'US_Small_Value',
  SCHD: 'US_Large_Cap_Equity',
  VIG:  'US_Large_Cap_Equity',
  MTUM: 'US_Large_Cap_Equity',
  QQQM: 'US_Large_Cap_Equity',
  VGT:  'US_Large_Cap_Equity',
  SPLV: 'US_Large_Cap_Equity',

  // Blended multi-region
  VT:   'BLEND_VT',    // ~60% US large-cap + 40% developed ex-US (FTSE All-World weights)
  VXUS: 'BLEND_VXUS',  // ~75% developed ex-US + 25% EM (FTSE Global All Cap ex-US weights)

  // International Equity
  VEA:  'Developed_ExUS_Equity',
  AVDV: 'Developed_ExUS_Small_Value',  // all sources null → uses bucket internalFallback (0.075)
  VWO:  'Emerging_Markets_Equity',

  // Fixed Income — direct bucket matches
  BND:  'US_Core_Bonds',
  VCIT: 'US_Investment_Grade_Credit',
  HYG:  'US_High_Yield',

  // Real Assets
  VNQ:  'REITs',
  IAU:  'Gold',

  // No bucket coverage — these fall through to CMA_STORE internal entries
  SCHP: null,   // TIPS: inflation-linked; no institutional bucket in this dataset
  BNDX: null,   // International bonds: no institutional bucket
  VTEB: null,   // National muni bonds: no institutional bucket
  CMF:  null,   // CA muni bonds: no institutional bucket
  VPU:  null,   // US utilities: no institutional bucket
};

// ─── ETF-Specific Factor Adjustments ─────────────────────────────────────────
// Applied on top of bucket consensus only where the bucket is a meaningful proxy mismatch.
// Magnitudes are conservative and documented with rationale.
// These are the ONLY values in this file that are not directly sourced from institutions.

const ETF_FACTOR_ADJUSTMENTS: Partial<Record<string, number>> = {
  QQQM: -0.005,  // NASDAQ-100 tech concentration adds vol without proportional return; lower CAPE-adj return than broad market
  VGT:  -0.007,  // More concentrated than QQQM; single-sector warrant a larger discount over total-market
  MTUM: +0.003,  // Momentum factor premium; Fama-French 5-factor validated, ~+0.3% over market
  SCHD: +0.003,  // Quality + value screen; historically ~+30bps over cap-weight net of turnover
  VIG:  +0.002,  // Dividend growth quality screen; marginal premium over VTI
  SPLV: -0.002,  // Low-vol factor intentionally trades return for drawdown reduction
};

// ─── Bucket Return Resolver ───────────────────────────────────────────────────

function resolveBucketReturn(ticker: string): number | undefined {
  const mapping = ETF_BUCKET_MAP[ticker];
  if (mapping === undefined) return undefined;  // not in map at all
  if (mapping === null)      return undefined;  // explicitly no coverage; use CMA_STORE

  let base: number;
  if (mapping === 'BLEND_VT') {
    base = 0.60 * BC.US_Large_Cap_Equity + 0.40 * BC.Developed_ExUS_Equity;
  } else if (mapping === 'BLEND_VXUS') {
    base = 0.75 * BC.Developed_ExUS_Equity + 0.25 * BC.Emerging_Markets_Equity;
  } else {
    base = BC[mapping];
  }

  return base + (ETF_FACTOR_ADJUSTMENTS[ticker] ?? 0);
}

// ─── CMA_STORE — Fallback for Uncovered Tickers ───────────────────────────────
// Only tickers with null in ETF_BUCKET_MAP live here.
// Internal best-effort estimates; replace when institutional bucket data is added.

export const CMA_STORE: CMAEntry[] = [
  { ticker: 'SCHP', assetClass: 'TIPS',             expectedReturn: 0.044, source: 'internal', asOfDate: '2026-01', placeholder: false, notes: 'Real yield ~2% + 2.2% expected inflation; no institutional bucket in cmaData.json' },
  { ticker: 'BNDX', assetClass: 'International Bond',expectedReturn: 0.045, source: 'internal', asOfDate: '2026-01', placeholder: false, notes: 'Currency-hedged developed sovereign yield proxy; no institutional bucket in cmaData.json' },
  { ticker: 'VTEB', assetClass: 'National Muni Bond', expectedReturn: 0.032, source: 'internal', asOfDate: '2026-01', placeholder: false, notes: 'Pre-tax yield; TEY = 0.032/(1-rate); no institutional muni bucket in cmaData.json' },
  { ticker: 'CMF',  assetClass: 'CA Muni Bond',       expectedReturn: 0.030, source: 'internal', asOfDate: '2026-01', placeholder: false, notes: 'CA double-exempt yield proxy; no institutional muni bucket in cmaData.json' },
  { ticker: 'VPU',  assetClass: 'US Utilities',        expectedReturn: 0.055, source: 'internal', asOfDate: '2026-01', placeholder: false, notes: 'Regulated utility earnings yield + rate-base growth; no institutional bucket in cmaData.json' },
];

const SOURCE_PRIORITY: Record<CMASource, number> = {
  blended:     0,
  jpmorgan:    1,
  vanguard:    1,
  blackrock:   1,
  morningstar: 1,
  internal:    2,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the best available expected return for a ticker.
 *
 * Resolution:
 *   1. Bucket consensus from cmaData.json (institutional median of non-null sources).
 *   2. CMA_STORE internal estimate (SCHP, BNDX, VTEB, CMF, VPU only).
 *   3. undefined → assets.ts CMA_ANCHORS falls back to ETF_UNIVERSE.cma2026.
 */
export function getCMAReturn(ticker: string): number | undefined {
  const bucketReturn = resolveBucketReturn(ticker);
  if (bucketReturn !== undefined) return bucketReturn;

  const candidates = CMA_STORE
    .filter(e => e.ticker === ticker && !e.placeholder)
    .sort((a, b) => {
      const p = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
      return p !== 0 ? p : b.asOfDate.localeCompare(a.asOfDate);
    });
  return candidates[0]?.expectedReturn;
}

/** All active CMA_STORE entries for a ticker (for audit/display). */
export function getCMAEntries(ticker: string): CMAEntry[] {
  return CMA_STORE
    .filter(e => e.ticker === ticker && !e.placeholder)
    .sort((a, b) => {
      const p = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
      return p !== 0 ? p : b.asOfDate.localeCompare(a.asOfDate);
    });
}

/**
 * Summary for logging / admin.
 * Shows resolved return per ETF, bucket source counts, and fallback tickers.
 */
export function getCMAStoreSummary() {
  const bucketCoverage = Object.fromEntries(
    (Object.keys(cmaData.buckets) as BucketKey[]).map(k => {
      const sourceCount = Object.values(cmaData.buckets[k].sources).filter(v => v !== null).length;
      return [k, { consensus: Number(BC[k].toFixed(4)), sourceCount }];
    })
  );

  // Show resolved return for every mapped ETF (useful for spot-checking)
  const resolvedETFs = Object.fromEntries(
    Object.keys(ETF_BUCKET_MAP)
      .map(t => [t, Number((getCMAReturn(t) ?? 0).toFixed(4))])
  );

  return {
    asOfDate:       cmaData.asOfDate,
    bucketCount:    Object.keys(cmaData.buckets).length,
    bucketCoverage,
    resolvedETFs,
    fallbackTickers: CMA_STORE.filter(e => !e.placeholder).map(e => e.ticker),
  };
}
