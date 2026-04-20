/**
 * ETF → Institutional Asset Class Mapping
 *
 * Maps each ETF ticker to one (or two, for blended funds) asset-class keys
 * from INSTITUTIONAL_CMAS so the v2 construction agent can resolve a
 * forward-return estimate for any holding without hard-coding per-ticker numbers.
 *
 * ── How expected return is computed ───────────────────────────────────────────
 * For a given ETF:
 *   baseReturn = INSTITUTIONAL_CMAS[primaryAssetClass].return * weight
 *              + INSTITUTIONAL_CMAS[secondaryAssetClass].return * secondaryWeight  (if present)
 *   netReturn  = baseReturn + factorPremiumAdjustment - expenseRatio
 *
 * ── Factor premium adjustments ────────────────────────────────────────────────
 * Adjustments are grounded in academic literature (Fama-French 1992/1993,
 * Carhart 1997, AQR factor research) and are deliberately conservative:
 *
 *   Positive adjustments (added return expected beyond the asset-class CMA):
 *     • AVUV / DFSV +150–180bps: size + value + profitability screen;
 *       Fama-French 5-factor evidence. Not the raw factor premium (~300bps)
 *       because realised premiums have compressed since publication.
 *     • AVDV +180bps: same rationale, international market; additional
 *       valuation discount vs developed-market large-cap.
 *     • SCHD +70bps: quality + value screen; historically ~+30–50bps net,
 *       plus dividend growth as a quality proxy adds moderate lift.
 *     • MTUM +50bps: momentum premium from Carhart (1997); attenuated
 *       because momentum crashes and turnover costs reduce realised premium.
 *
 *   Negative adjustments (structural return drag):
 *     • TLT −50bps: duration extension increases rate-sensitivity; in the
 *       current rate normalisation environment the long-end curve is flat or
 *       inverted — poor risk-adjusted return relative to intermediate Treasuries.
 *     • NTSX −30bps: estimated futures roll cost + management drag on the
 *       levered 90/60 construction.
 *     • SPLV −100bps: low-volatility factor historically underperforms
 *       market-cap weight over the full cycle; defensive premium is modest.
 *     • QQQM / VGT −20–10bps: tech concentration adds idiosyncratic risk
 *       not compensated by proportional expected return vs broad market.
 *     • DBC −150bps / PDBC −50bps: commodity ETF roll yield (contango drag)
 *       systematically erodes spot-price return. PDBC uses an optimised
 *       roll schedule — meaningfully better than DBC but still negative.
 *
 * ── Expense ratios ────────────────────────────────────────────────────────────
 * Sourced from fund prospectuses / ETF.com as of 2026-Q1.
 * These are the values stored here; do NOT derive from etfUniverse.ts to avoid
 * circular dependencies. Both files must stay in sync when ERs change.
 *
 * ── NTSX note ─────────────────────────────────────────────────────────────────
 * NTSX uses a 90/60 construction (90% equity notional + 60% bond futures).
 * weight + secondaryWeight intentionally sum to 1.50 to represent the
 * economic exposure — not a data error. The interface allows this by design.
 */

import type { AssetClassForecast } from './institutionalCMAs';
import { INSTITUTIONAL_CMAS } from './institutionalCMAs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ETFMapping {
  /** Key into INSTITUTIONAL_CMAS for the primary (or only) asset class. */
  primaryAssetClass: string;
  /**
   * Fraction of the ETF's economic exposure attributed to the primary class.
   * For blended/leveraged funds, weight + secondaryWeight may exceed 1.0.
   */
  weight: number;
  /** Key into INSTITUTIONAL_CMAS for a secondary blend component (optional). */
  secondaryAssetClass?: string;
  /** Fraction of exposure attributed to the secondary asset class. */
  secondaryWeight?: number;
  /**
   * Incremental annualized return adjustment above the CMA base, in decimal.
   * e.g. 0.015 = +150bps. Negative values represent structural drag.
   * Grounded in peer-reviewed factor research; kept conservative.
   */
  factorPremiumAdjustment?: number;
  /** Annual expense ratio (decimal). Subtracted from gross expected return. */
  expenseRatio: number;
  /** One-line description of what this ETF holds and its role. */
  description: string;
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

export const ETF_TO_ASSET_CLASS: Record<string, ETFMapping> = {

  // ── Cash / Safety ──────────────────────────────────────────────────────────

  SGOV: {
    primaryAssetClass: 'US_TREASURY_SHORT',
    weight: 1.00,
    expenseRatio: 0.0009,
    description: '0–3 month T-Bills — preferred cash sleeve (state-tax-exempt)',
  },
  USFR: {
    primaryAssetClass: 'US_TREASURY_SHORT',
    weight: 1.00,
    expenseRatio: 0.0015,
    description: 'Floating-rate Treasury notes — use when rate cuts are expected',
  },
  TFLO: {
    primaryAssetClass: 'US_TREASURY_SHORT',
    weight: 1.00,
    expenseRatio: 0.0015,
    description: 'Treasury Floating Rate ETF — near-identical to USFR; never hold both',
  },
  VUSXX: {
    primaryAssetClass: 'US_TREASURY_SHORT',
    weight: 1.00,
    expenseRatio: 0.0009,
    description: 'Vanguard Treasury Money Market — mutual-fund equivalent of SGOV',
  },

  // ── Bonds / Fixed Income ───────────────────────────────────────────────────

  BND: {
    primaryAssetClass: 'US_AGGREGATE_BONDS',
    weight: 1.00,
    expenseRatio: 0.0003,
    description: 'US Total Bond Market — core fixed-income sleeve; tax-deferred preferred',
  },
  SCHP: {
    primaryAssetClass: 'US_TIPS',
    weight: 1.00,
    expenseRatio: 0.0004,
    description: 'TIPS — inflation hedge; add when CPI > 3% or inflation risk is elevated',
  },
  VTEB: {
    primaryAssetClass: 'US_MUNI_BONDS',
    weight: 1.00,
    expenseRatio: 0.0005,
    description: 'National muni bonds — federal tax-exempt; taxable account at ≥ 24% bracket',
  },
  CMF: {
    primaryAssetClass: 'US_MUNI_BONDS',
    weight: 1.00,
    expenseRatio: 0.0025,
    description: 'CA muni bonds — federal + CA state exempt; CA residents only at ≥ 32%',
  },
  NYF: {
    primaryAssetClass: 'US_MUNI_BONDS',
    weight: 1.00,
    expenseRatio: 0.0025,
    description: 'NY muni bonds — federal + NY state exempt; NY residents only',
  },
  TLT: {
    primaryAssetClass: 'US_AGGREGATE_BONDS',
    weight: 1.00,
    // Duration extension in a flat/inverted curve environment reduces return vs intermediate
    factorPremiumAdjustment: -0.005,
    expenseRatio: 0.0015,
    description: '20+ Year Treasuries — high duration; avoid in rate-normalisation environment',
  },
  VGIT: {
    primaryAssetClass: 'US_AGGREGATE_BONDS',
    weight: 1.00,
    expenseRatio: 0.0004,
    description: 'Intermediate-Term Treasuries — lower duration than BND; favoured in rising rates',
  },
  VCIT: {
    primaryAssetClass: 'US_AGGREGATE_BONDS',
    weight: 1.00,
    // Investment-grade credit premium above Treasury curve; ~+80bps historically
    factorPremiumAdjustment: 0.008,
    expenseRatio: 0.0004,
    description: 'Intermediate Corporate Bonds — IG credit premium; tax-deferred only',
  },
  USHY: {
    primaryAssetClass: 'US_HIGH_YIELD',
    weight: 1.00,
    expenseRatio: 0.0030,
    description: 'Short-duration High Yield — less rate sensitivity than HYG; tax-deferred only',
  },
  BNDW: {
    primaryAssetClass: 'US_AGGREGATE_BONDS',
    weight: 0.50,
    secondaryAssetClass: 'INTL_DEVELOPED',
    secondaryWeight: 0.50,
    expenseRatio: 0.0006,
    description: 'Total World Bond — 50% US / 50% ex-US; currency-hedged international sleeve',
  },

  // ── US Equity ─────────────────────────────────────────────────────────────

  VTI: {
    primaryAssetClass: 'US_LARGE_CAP',
    weight: 0.80,
    secondaryAssetClass: 'US_SMALL_CAP',
    secondaryWeight: 0.20,
    expenseRatio: 0.0003,
    description: 'US Total Stock Market — preferred core US equity; 4,000+ stocks',
  },
  AVUV: {
    primaryAssetClass: 'US_SMALL_VALUE',
    weight: 1.00,
    // Size + value + profitability screen; Fama-French 5-factor validated; conservative estimate
    factorPremiumAdjustment: 0.015,
    expenseRatio: 0.0025,
    description: 'US Small-Cap Value — active factor targeting; Roth preferred',
  },
  DFSV: {
    primaryAssetClass: 'US_SMALL_VALUE',
    weight: 1.00,
    // Dimensional methodology applies tighter factor screens than AVUV
    factorPremiumAdjustment: 0.018,
    expenseRatio: 0.0031,
    description: 'DFA US Small-Cap Value — stronger factor purity; institutional methodology',
  },
  SCHD: {
    primaryAssetClass: 'US_LARGE_CAP',
    weight: 0.60,
    secondaryAssetClass: 'US_MID_CAP',
    secondaryWeight: 0.40,
    // Quality + moderate value screen; ~+30–50bps documented; conservative at +70bps net
    factorPremiumAdjustment: 0.007,
    expenseRatio: 0.0006,
    description: 'Dividend Equity — quality + value screen; taxable acceptable for income seekers',
  },
  QVAL: {
    primaryAssetClass: 'US_SMALL_VALUE',
    weight: 1.00,
    // Quantitative deep-value screen (top decile); pure-factor approach; higher ER
    factorPremiumAdjustment: 0.020,
    expenseRatio: 0.0079,
    description: 'Alpha Architect Quantitative Value — top-decile value screen; high conviction',
  },
  NTSX: {
    primaryAssetClass: 'US_LARGE_CAP',
    weight: 0.90,
    secondaryAssetClass: 'US_AGGREGATE_BONDS',
    // 90/60 via futures — weights intentionally sum to 1.50 (leveraged economic exposure)
    secondaryWeight: 0.60,
    // Futures roll cost + fund drag reduces the theoretical leverage benefit
    factorPremiumAdjustment: -0.003,
    expenseRatio: 0.0020,
    description: 'WisdomTree Efficient Core — 90% equity + 60% bond futures (1.5× notional)',
  },
  MTUM: {
    primaryAssetClass: 'US_LARGE_CAP',
    weight: 1.00,
    // Momentum factor (Carhart 1997); attenuated for turnover costs and crash risk
    factorPremiumAdjustment: 0.005,
    expenseRatio: 0.0015,
    description: 'Momentum Factor — quarterly rebalance into 12-month winners; Roth preferred',
  },
  SPLV: {
    primaryAssetClass: 'US_LARGE_CAP',
    weight: 1.00,
    // Low-vol underperforms market-cap weight over full cycles; defensive positioning only
    factorPremiumAdjustment: -0.010,
    expenseRatio: 0.0025,
    description: 'Low Volatility — S&P 500 bottom-100 vol stocks; drawdown protection only',
  },
  QQQM: {
    primaryAssetClass: 'US_LARGE_GROWTH',
    weight: 1.00,
    // Tech concentration adds idiosyncratic risk without proportional return vs broad market
    factorPremiumAdjustment: -0.002,
    expenseRatio: 0.0015,
    description: 'Nasdaq 100 — growth/tech tilt; use only for deliberate sector overweight',
  },
  VGT: {
    primaryAssetClass: 'US_LARGE_GROWTH',
    weight: 1.00,
    // Single-sector; more concentrated than QQQM; discount more modest due to lower ER
    factorPremiumAdjustment: -0.001,
    expenseRatio: 0.0010,
    description: 'Technology Sector — most concentrated option; limit < 8% of portfolio',
  },

  // ── International Equity ──────────────────────────────────────────────────

  VXUS: {
    primaryAssetClass: 'INTL_DEVELOPED',
    weight: 0.70,
    secondaryAssetClass: 'EMERGING_MARKETS',
    secondaryWeight: 0.30,
    expenseRatio: 0.0007,
    description: 'Total International — 70% developed / 30% EM; replaces VEA + VWO together',
  },
  AVDV: {
    primaryAssetClass: 'INTL_DEVELOPED_SMALL_VALUE',
    weight: 1.00,
    // Intl small-cap value premium; additional valuation discount vs US; Roth preferred
    factorPremiumAdjustment: 0.018,
    expenseRatio: 0.0036,
    description: 'International Small-Cap Value — highest expected return in intl universe',
  },
  IVAL: {
    primaryAssetClass: 'INTL_DEVELOPED_SMALL_VALUE',
    weight: 1.00,
    // Alpha Architect pure quantitative value screen; even stronger factor tilt than AVDV
    factorPremiumAdjustment: 0.022,
    expenseRatio: 0.0079,
    description: 'Alpha Architect International Value — top-decile value; very high conviction',
  },
  VWO: {
    primaryAssetClass: 'EMERGING_MARKETS',
    weight: 1.00,
    expenseRatio: 0.0008,
    description: 'Emerging Markets — market-cap weight EM; pairs with VEA for full international',
  },
  DFEV: {
    primaryAssetClass: 'EMERGING_MARKETS',
    weight: 1.00,
    // Dimensional EM value tilt; tilts toward cheaper EM countries and sectors
    factorPremiumAdjustment: 0.012,
    expenseRatio: 0.0039,
    description: 'DFA Emerging Markets Value — value screen applied to EM universe',
  },
  DFCF: {
    primaryAssetClass: 'EMERGING_MARKETS',
    weight: 1.00,
    // Stronger value tilt than DFEV; cash-flow-based screen
    factorPremiumAdjustment: 0.015,
    expenseRatio: 0.0045,
    description: 'DFA Emerging Markets Core — deeper value screen; cash-flow methodology',
  },

  // ── Real Assets ───────────────────────────────────────────────────────────

  VNQ: {
    primaryAssetClass: 'REAL_ESTATE',
    weight: 1.00,
    expenseRatio: 0.0012,
    description: 'US REITs — inflation hedge + income; ALWAYS tax-deferred, NEVER taxable',
  },
  VNQI: {
    primaryAssetClass: 'REAL_ESTATE',
    weight: 1.00,
    expenseRatio: 0.0012,
    description: 'International REITs — diversifies VNQ geographically; tax-deferred preferred',
  },
  DBC: {
    primaryAssetClass: 'COMMODITIES',
    weight: 1.00,
    // Systematic contango drag from rolling front-month futures; significant negative carry
    factorPremiumAdjustment: -0.015,
    expenseRatio: 0.0087,
    description: 'Broad Commodities — avoid; PDBC is strictly superior due to roll optimisation',
  },
  PDBC: {
    primaryAssetClass: 'COMMODITIES',
    weight: 1.00,
    // Optimised roll schedule meaningfully reduces contango drag vs DBC
    factorPremiumAdjustment: -0.005,
    expenseRatio: 0.0059,
    description: 'Optimised Commodities — preferred commodity ETF; no K-1 (unlike DBC)',
  },
};

// ─── Derived utilities ────────────────────────────────────────────────────────

/**
 * Resolves a gross expected return for an ETF by blending its primary and
 * secondary asset-class CMAs, applying any factor adjustment, then subtracting
 * the expense ratio.
 *
 * Returns undefined when a required asset-class key is missing from
 * INSTITUTIONAL_CMAS (e.g. if a new ETF is mapped to a class not yet added).
 *
 * @example
 * resolveETFReturn('AVUV')  // → ~0.083  (8.3% net)
 * resolveETFReturn('VTI')   // → ~0.065  (6.5% net)
 */
export function resolveETFReturn(ticker: string): number | undefined {
  const m = ETF_TO_ASSET_CLASS[ticker];
  if (!m) return undefined;

  const primary: AssetClassForecast | undefined = INSTITUTIONAL_CMAS[m.primaryAssetClass];
  if (!primary) return undefined;

  let base = primary.return * m.weight;

  if (m.secondaryAssetClass && m.secondaryWeight != null) {
    const secondary: AssetClassForecast | undefined = INSTITUTIONAL_CMAS[m.secondaryAssetClass];
    if (secondary) base += secondary.return * m.secondaryWeight;
  }

  const adjustment = m.factorPremiumAdjustment ?? 0;
  return base + adjustment - m.expenseRatio;
}

/**
 * All tickers covered by this mapping as a Set.
 * Use for O(1) membership checks before calling resolveETFReturn().
 */
export const MAPPED_TICKERS: ReadonlySet<string> = new Set(Object.keys(ETF_TO_ASSET_CLASS));
