/**
 * src/lib/data/etfUniverse.ts
 *
 * Core ETF universe for the v2 agent pipeline (20 ETFs; will expand to 35).
 *
 * ── Relationship to src/lib/assets.ts ─────────────────────────────────────
 * assets.ts is the v1 pipeline's ETF store: rich ETFMeta shape with overlap
 * pairs, correlation matrix, LLM prompt strings, and bestFor guidance.
 * This file is a clean v2 replacement with a consumer-facing shape designed
 * for the new typed agent pipeline. Import from this file — not assets.ts —
 * when building v2 portfolio logic.
 *
 * ── Return / vol sources ──────────────────────────────────────────────────
 * expectedReturn: user-specified values for the 12 explicitly listed ETFs;
 *   cmaStore.getCMAReturn() anchors for the remaining 8 additions.
 * volatility: user-specified for 12; assets.ts volEstimate for the rest.
 * expenseRatios: pulled from assets.ts (authoritative) for all 20.
 */

// ─── Type ─────────────────────────────────────────────────────────────────────

/** Asset-class category used in the v2 3-bucket construction framework. */
export type ETFCategory =
  | 'cash'        // T-bills, floating-rate Treasury — ultra-low duration
  | 'bonds'       // Investment-grade, TIPS, munis, high-yield, international
  | 'us_equity'   // US domestic equity across style and factor tilts
  | 'intl_equity' // Developed and emerging markets ex-US
  | 'real_assets';// REITs, gold, commodities, utilities

/**
 * Relative tax efficiency of holding this ETF in a taxable brokerage account.
 *   excellent — minimal taxable events (short-term T-bills, tax-exempt munis)
 *   good      — mostly qualified dividends + long-term capital gains (broad equity)
 *   fair      — some ordinary income; consider tax-deferred first
 *   poor      — heavy ordinary income or collectible treatment; use tax-deferred/Roth
 */
export type TaxEfficiency = 'excellent' | 'good' | 'fair' | 'poor';

/**
 * Fama-French-inspired factor exposure scores (0–1 scale, higher = stronger tilt).
 * Scores below zero signal a deliberate tilt away from the factor (e.g., growth
 * ETFs have negative value scores because they systematically exclude cheap stocks).
 * These are qualitative estimates, not regression betas.
 */
export interface FactorExposures {
  /**
   * Value factor loading — degree to which the ETF tilts toward cheap stocks
   * relative to the market (high B/P, E/P, or cash-flow yield).
   * 0 = market-weight; positive = value tilt; negative = growth tilt.
   */
  value: number;

  /**
   * Size factor loading — degree to which the ETF overweights smaller companies.
   * 0 = large-cap only; 1 = heavily small-cap tilted.
   */
  size: number;

  /**
   * Quality / profitability factor loading — degree to which the ETF screens
   * for high gross profitability, low leverage, and earnings stability.
   * 0 = no quality screen; 1 = very high quality filter (e.g., SCHD).
   */
  quality: number;
}

/** A single ETF entry in the v2 universe. */
export interface ETF {
  /** Ticker symbol exactly as it trades on US exchanges. */
  ticker: string;

  /** Full legal fund name. */
  name: string;

  /** Asset-class category for bucket assignment during portfolio construction. */
  category: ETFCategory;

  /**
   * Annual expense ratio as a decimal (e.g. 0.0003 = 0.03%).
   * Source: fund prospectus / ETF.com, as of 2026-Q1.
   */
  expenseRatio: number;

  /**
   * 10-year forward annualized expected return as a decimal (e.g. 0.055 = 5.5%).
   * Source: user-specified CMAs for the 12 core ETFs; cmaStore/assets.ts
   * consensus anchors for the remaining 8. All values as of 2026.
   * Note: these are gross returns before expenses; net = expectedReturn − expenseRatio.
   */
  expectedReturn: number;

  /**
   * Estimated annual volatility (σ) as a decimal (e.g. 0.16 = 16%).
   * Source: user-specified for core 12; assets.ts volEstimate for remaining 8.
   * Based on rolling 10-year historical vol, adjusted for current rate regime.
   */
  volatility: number;

  /**
   * Tax efficiency when held in a taxable brokerage account.
   * Drives the asset location recommendation in the Tax & Implementation agent.
   */
  taxEfficiency: TaxEfficiency;

  /**
   * Qualitative factor exposure scores on a 0–1 scale (see FactorExposures).
   * Non-equity ETFs (cash, bonds) carry zeros — they don't express equity factors.
   */
  factorExposures: FactorExposures;

  /**
   * Hard cap on the maximum weight this ETF may hold in the total portfolio (0–1 decimal).
   * Enforced after Sharpe optimization to prevent any single position from dominating.
   * Core broad-market ETFs have high caps (0.50–0.70); satellite/factor-tilt ETFs
   * are capped at 0.05–0.15 to mirror what a CFP/RIA model portfolio would allow.
   */
  maxTotalWeight: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Zero factor exposures — used for all non-equity asset classes. */
const NO_FACTORS: FactorExposures = { value: 0, size: 0, quality: 0 };

// ─── Universe ─────────────────────────────────────────────────────────────────

/**
 * 20-ETF core universe for the v2 portfolio construction agent.
 *
 * Distribution:
 *   cash        —  2 (SGOV, USFR)
 *   bonds       —  6 (BND, SCHP, VTEB, HYG, VCIT, BNDX)
 *   us_equity   —  5 (VTI, AVUV, SCHD, QQQM, MTUM)
 *   intl_equity —  4 (VXUS, AVDV, VWO, VEA)
 *   real_assets —  3 (VNQ, IAU, VPU)
 *
 * Expansion to 35 planned: will add VBR, SPLV, VIG, VGT, VT, VOO, CMF,
 * MUB, VPU (already here), VB, AGG, TLT, GLD, PDBC, and sector ETFs.
 */
export const ETF_UNIVERSE: ETF[] = [

  // ── Cash / Short-Duration Treasury ────────────────────────────────────────

  {
    ticker: 'SGOV',
    name: 'iShares 0-3 Month Treasury Bond ETF',
    category: 'cash',
    expenseRatio: 0.0009,
    expectedReturn: 0.048,
    volatility: 0.010,
    taxEfficiency: 'excellent',
    factorExposures: NO_FACTORS,
    maxTotalWeight: 0.20,
  },

  {
    ticker: 'USFR',
    name: 'WisdomTree Floating Rate Treasury ETF',
    category: 'cash',
    expenseRatio: 0.0015,
    expectedReturn: 0.047,
    volatility: 0.008,
    taxEfficiency: 'excellent',
    factorExposures: NO_FACTORS,
    maxTotalWeight: 0.15,
  },

  // ── Bonds / Fixed Income ──────────────────────────────────────────────────

  {
    ticker: 'BND',
    name: 'Vanguard Total Bond Market ETF',
    category: 'bonds',
    expenseRatio: 0.0003,
    expectedReturn: 0.050,
    volatility: 0.050,
    taxEfficiency: 'fair',
    factorExposures: NO_FACTORS,
    maxTotalWeight: 0.50,
  },

  {
    ticker: 'SCHP',
    name: 'Schwab U.S. TIPS ETF',
    category: 'bonds',
    expenseRatio: 0.0003,
    expectedReturn: 0.047,
    volatility: 0.040,
    taxEfficiency: 'fair',
    factorExposures: NO_FACTORS,
    maxTotalWeight: 0.15,
  },

  {
    ticker: 'VTEB',
    name: 'Vanguard Tax-Exempt Bond ETF',
    category: 'bonds',
    expenseRatio: 0.0005,
    expectedReturn: 0.032,
    volatility: 0.050,
    taxEfficiency: 'excellent',
    factorExposures: NO_FACTORS,
    maxTotalWeight: 0.40,
  },

  {
    ticker: 'HYG',
    name: 'iShares iBoxx $ High Yield Corporate Bond ETF',
    category: 'bonds',
    expenseRatio: 0.0049,
    expectedReturn: 0.065,
    volatility: 0.120,
    taxEfficiency: 'poor',
    factorExposures: { value: 0, size: 0, quality: -0.10 },
    maxTotalWeight: 0.10,
  },

  {
    ticker: 'VCIT',
    name: 'Vanguard Intermediate-Term Corporate Bond ETF',
    category: 'bonds',
    expenseRatio: 0.0004,
    expectedReturn: 0.056,
    volatility: 0.072,
    taxEfficiency: 'poor',
    factorExposures: { value: 0, size: 0, quality: 0.05 },
    maxTotalWeight: 0.20,
  },

  {
    ticker: 'BNDX',
    name: 'Vanguard Total International Bond ETF',
    category: 'bonds',
    expenseRatio: 0.0007,
    expectedReturn: 0.045,
    volatility: 0.070,
    taxEfficiency: 'fair',
    factorExposures: NO_FACTORS,
    maxTotalWeight: 0.15,
  },

  // ── US Equity ─────────────────────────────────────────────────────────────

  {
    ticker: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    category: 'us_equity',
    expenseRatio: 0.0003,
    expectedReturn: 0.069,
    volatility: 0.155,
    taxEfficiency: 'good',
    factorExposures: { value: 0.02, size: -0.05, quality: 0.20 },
    maxTotalWeight: 0.60,
  },

  {
    ticker: 'VT',
    name: 'Vanguard Total World Stock ETF',
    category: 'intl_equity',
    expenseRatio: 0.0007,
    expectedReturn: 0.072,
    volatility: 0.163,
    taxEfficiency: 'good',
    factorExposures: { value: 0.06, size: 0.04, quality: 0.12 },
    maxTotalWeight: 0.70,
  },

  {
    ticker: 'VTI',
    name: 'Vanguard Total Stock Market ETF',
    category: 'us_equity',
    expenseRatio: 0.0003,
    expectedReturn: 0.055,
    volatility: 0.160,
    taxEfficiency: 'good',
    factorExposures: { value: 0.05, size: 0.10, quality: 0.15 },
    maxTotalWeight: 0.60,
  },

  {
    ticker: 'AVUV',
    name: 'Avantis U.S. Small Cap Value ETF',
    category: 'us_equity',
    expenseRatio: 0.0025,
    expectedReturn: 0.075,
    volatility: 0.200,
    taxEfficiency: 'good',
    factorExposures: { value: 0.65, size: 0.75, quality: 0.20 },
    maxTotalWeight: 0.15,
  },

  {
    ticker: 'SCHD',
    name: 'Schwab U.S. Dividend Equity ETF',
    category: 'us_equity',
    expenseRatio: 0.0006,
    expectedReturn: 0.062,
    volatility: 0.140,
    taxEfficiency: 'fair',
    factorExposures: { value: 0.25, size: 0.00, quality: 0.60 },
    maxTotalWeight: 0.20,
  },

  {
    ticker: 'QQQM',
    name: 'Invesco NASDAQ-100 ETF',
    category: 'us_equity',
    expenseRatio: 0.0015,
    expectedReturn: 0.065,
    volatility: 0.180,
    taxEfficiency: 'good',
    factorExposures: { value: -0.20, size: 0.00, quality: 0.35 },
    maxTotalWeight: 0.10,
  },

  {
    ticker: 'MTUM',
    name: 'iShares MSCI USA Momentum Factor ETF',
    category: 'us_equity',
    expenseRatio: 0.0015,
    // Revised to 5.5%: quarterly reconstitution creates real turnover cost drag not
    // captured by the expense ratio alone; 50bps additional haircut applied.
    expectedReturn: 0.055,
    volatility: 0.170,
    taxEfficiency: 'fair',
    factorExposures: { value: -0.10, size: 0.00, quality: 0.30 },
    maxTotalWeight: 0.08,
  },

  // ── International Equity ──────────────────────────────────────────────────

  {
    ticker: 'VXUS',
    name: 'Vanguard Total International Stock ETF',
    category: 'intl_equity',
    expenseRatio: 0.0007,
    expectedReturn: 0.070,
    volatility: 0.170,
    taxEfficiency: 'good',
    factorExposures: { value: 0.08, size: 0.05, quality: 0.10 },
    maxTotalWeight: 0.40,
  },

  {
    ticker: 'AVDV',
    name: 'Avantis International Small Cap Value ETF',
    category: 'intl_equity',
    expenseRatio: 0.0036,
    expectedReturn: 0.070,
    volatility: 0.210,
    taxEfficiency: 'good',
    factorExposures: { value: 0.60, size: 0.70, quality: 0.25 },
    maxTotalWeight: 0.15,
  },

  {
    ticker: 'VWO',
    name: 'Vanguard Emerging Markets ETF',
    category: 'intl_equity',
    expenseRatio: 0.0008,
    expectedReturn: 0.082,
    volatility: 0.220,
    taxEfficiency: 'fair',
    factorExposures: { value: 0.15, size: 0.05, quality: 0.05 },
    maxTotalWeight: 0.10,
  },

  {
    ticker: 'VEA',
    name: 'Vanguard Developed Markets ETF',
    category: 'intl_equity',
    expenseRatio: 0.0005,
    expectedReturn: 0.078,
    volatility: 0.160,
    taxEfficiency: 'good',
    factorExposures: { value: 0.10, size: 0.05, quality: 0.12 },
    maxTotalWeight: 0.25,
  },

  // ── Real Assets ───────────────────────────────────────────────────────────

  {
    ticker: 'VNQ',
    name: 'Vanguard Real Estate ETF',
    category: 'real_assets',
    expenseRatio: 0.0012,
    expectedReturn: 0.065,
    volatility: 0.190,
    taxEfficiency: 'poor',
    factorExposures: { value: 0.20, size: 0.10, quality: 0.15 },
    maxTotalWeight: 0.08,
  },

  {
    ticker: 'IAU',
    name: 'iShares Gold Trust',
    category: 'real_assets',
    expenseRatio: 0.0025,
    expectedReturn: 0.040,
    volatility: 0.180,
    taxEfficiency: 'poor',
    factorExposures: NO_FACTORS,
    maxTotalWeight: 0.05,
  },

  {
    ticker: 'VPU',
    name: 'Vanguard Utilities ETF',
    category: 'real_assets',
    expenseRatio: 0.0010,
    expectedReturn: 0.055,
    volatility: 0.120,
    taxEfficiency: 'fair',
    factorExposures: { value: 0.10, size: 0.00, quality: 0.30 },
    maxTotalWeight: 0.10,
  },

];

// ─── Derived lookups (convenience) ───────────────────────────────────────────

/**
 * O(1) lookup map: ticker → ETF.
 * Use when you need a single ETF by ticker rather than filtering the array.
 *
 * @example
 * const vti = ETF_BY_TICKER['VTI'];
 */
export const ETF_BY_TICKER: Readonly<Record<string, ETF>> = Object.fromEntries(
  ETF_UNIVERSE.map(e => [e.ticker, e]),
);

/**
 * All tickers in the universe as a Set.
 * Use for O(1) membership checks (e.g. "is this ticker whitelisted?").
 */
export const ETF_TICKERS: ReadonlySet<string> = new Set(ETF_UNIVERSE.map(e => e.ticker));

/**
 * ETFs grouped by category.
 * Use when the construction agent needs to enumerate all candidates in a bucket.
 *
 * @example
 * const equityPool = ETF_BY_CATEGORY.us_equity;
 */
export const ETF_BY_CATEGORY: Readonly<Record<ETFCategory, ETF[]>> = {
  cash:        ETF_UNIVERSE.filter(e => e.category === 'cash'),
  bonds:       ETF_UNIVERSE.filter(e => e.category === 'bonds'),
  us_equity:   ETF_UNIVERSE.filter(e => e.category === 'us_equity'),
  intl_equity: ETF_UNIVERSE.filter(e => e.category === 'intl_equity'),
  real_assets: ETF_UNIVERSE.filter(e => e.category === 'real_assets'),
};
