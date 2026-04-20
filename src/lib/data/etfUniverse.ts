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
    // User-specified: 4.8%
    expectedReturn: 0.048,
    // User-specified: 1%
    volatility: 0.010,
    // State-tax-exempt T-bills; no capital gains distributions; minimal income events
    taxEfficiency: 'excellent',
    factorExposures: NO_FACTORS,
  },

  {
    ticker: 'USFR',
    name: 'WisdomTree Floating Rate Treasury ETF',
    category: 'cash',
    expenseRatio: 0.0015,
    // Floats with Fed Funds Rate; slightly below SGOV on 10-yr average (rate normalisation)
    expectedReturn: 0.047,
    // Floating-rate mechanism tightly anchors duration — lower vol than fixed T-bills
    volatility: 0.008,
    // Treasury floating-rate notes; state-tax-exempt; same excellent profile as SGOV
    taxEfficiency: 'excellent',
    factorExposures: NO_FACTORS,
  },

  // ── Bonds / Fixed Income ──────────────────────────────────────────────────

  {
    ticker: 'BND',
    name: 'Vanguard Total Bond Market ETF',
    category: 'bonds',
    expenseRatio: 0.0003,
    // User-specified: 5.0%
    expectedReturn: 0.050,
    // User-specified: 5% (total bond market duration ~6yr; moderate rate sensitivity)
    volatility: 0.050,
    // Taxable interest income; hold in tax-deferred accounts for efficiency
    taxEfficiency: 'fair',
    factorExposures: NO_FACTORS,
  },

  {
    ticker: 'SCHP',
    name: 'Schwab U.S. TIPS ETF',
    category: 'bonds',
    expenseRatio: 0.0003,
    // User-specified: 4.4% (real yield ~2% + 2.2% expected inflation)
    expectedReturn: 0.044,
    // User-specified: 4% (TIPS duration ~7yr; modest rate sensitivity offset by inflation linkage)
    volatility: 0.040,
    // Phantom income from inflation accruals taxed annually — inefficient in taxable
    taxEfficiency: 'fair',
    factorExposures: NO_FACTORS,
  },

  {
    ticker: 'VTEB',
    name: 'Vanguard Tax-Exempt Bond ETF',
    category: 'bonds',
    expenseRatio: 0.0005,
    // User-specified: 3.2% (pre-tax yield; TEY at 32% bracket = 4.71%)
    expectedReturn: 0.032,
    // User-specified: 5% (~5.3yr duration, similar to BND)
    volatility: 0.050,
    // Federal income tax-exempt distributions; ideal for taxable at ≥24% marginal rate
    taxEfficiency: 'excellent',
    factorExposures: NO_FACTORS,
  },

  {
    ticker: 'HYG',
    name: 'iShares iBoxx $ High Yield Corporate Bond ETF',
    category: 'bonds',
    expenseRatio: 0.0049,
    // assets.ts cma2026: 6.5%; credit premium ~200–300bps over IG
    expectedReturn: 0.065,
    // Historical rolling vol ~12%; high-yield correlates with equities in stress
    volatility: 0.120,
    // High ordinary income distributions; NEVER in taxable — always tax-deferred/Roth
    taxEfficiency: 'poor',
    // Sub-investment-grade issuers; negative quality loading
    factorExposures: { value: 0, size: 0, quality: -0.10 },
  },

  {
    ticker: 'VCIT',
    name: 'Vanguard Intermediate-Term Corporate Bond ETF',
    category: 'bonds',
    expenseRatio: 0.0004,
    // assets.ts cma2026: 5.6% (investment-grade credit premium over Treasury)
    expectedReturn: 0.056,
    // Historical rolling vol ~7.2%; IG credit, ~6yr effective duration
    volatility: 0.072,
    // Taxable interest income from corporate coupons; tax-deferred preferred
    taxEfficiency: 'poor',
    // Slightly positive quality vs junk; no meaningful equity factor exposure
    factorExposures: { value: 0, size: 0, quality: 0.05 },
  },

  {
    ticker: 'BNDX',
    name: 'Vanguard Total International Bond ETF',
    category: 'bonds',
    expenseRatio: 0.0007,
    // assets.ts cma2026 / CMA_STORE: 4.5% (currency-hedged developed sovereign proxy)
    expectedReturn: 0.045,
    // Historical rolling vol ~7%; currency-hedged; similar duration to BND
    volatility: 0.070,
    // Taxable interest income; foreign source may complicate reporting; fair efficiency
    taxEfficiency: 'fair',
    factorExposures: NO_FACTORS,
  },

  // ── US Equity ─────────────────────────────────────────────────────────────

  {
    ticker: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    category: 'us_equity',
    expenseRatio: 0.0003,
    // CAPE build-up at CAPE=32, CPI=2.8%: 1/32 + 1.0% + 2.8% - 0.03% = 6.90%
    // Slightly lower than VTI — lacks the small-cap return premium (~+10bps)
    expectedReturn: 0.069,
    // Pure large-cap: less volatile than VTI (no small/mid-cap exposure)
    volatility: 0.155,
    taxEfficiency: 'good',
    // Large-cap only; slight quality loading from S&P 500 profitability screen;
    // negative size (explicitly excludes small-caps vs VTI's full market coverage)
    factorExposures: { value: 0.02, size: -0.05, quality: 0.20 },
  },

  {
    ticker: 'VT',
    name: 'Vanguard Total World Stock ETF',
    category: 'intl_equity',
    expenseRatio: 0.0007,
    // CAPE build-up: 60% US (6.93%) + 40% Intl Developed CMA (7.8%) − 0.07% ER = 7.19%
    // Higher than VTI because international markets trade at a valuation discount to US
    expectedReturn: 0.072,
    // Blend of US (0.160) and international (0.170) vol; geographic correlation benefit
    volatility: 0.163,
    // Foreign tax credit eligible from intl sleeve; mostly qualified dividends
    taxEfficiency: 'good',
    // ~60% US + ~30% developed ex-US + ~10% EM; intl sleeve adds value tilt
    // (global markets trade at cheaper CAPE than US); modest size from broad market coverage
    factorExposures: { value: 0.06, size: 0.04, quality: 0.12 },
  },

  {
    ticker: 'VTI',
    name: 'Vanguard Total Stock Market ETF',
    category: 'us_equity',
    expenseRatio: 0.0003,
    // User-specified: 5.5%
    expectedReturn: 0.055,
    // User-specified: 16%
    volatility: 0.160,
    // Mostly qualified dividends; very low turnover — minimal capital gains distributions
    taxEfficiency: 'good',
    // User-specified
    factorExposures: { value: 0.05, size: 0.10, quality: 0.15 },
  },

  {
    ticker: 'AVUV',
    name: 'Avantis U.S. Small Cap Value ETF',
    category: 'us_equity',
    expenseRatio: 0.0025,
    // User-specified: 7.5%
    expectedReturn: 0.075,
    // User-specified: 20%
    volatility: 0.200,
    // Qualified dividends; moderate turnover from active factor screens; hold in Roth when possible
    taxEfficiency: 'good',
    // User-specified
    factorExposures: { value: 0.65, size: 0.75, quality: 0.20 },
  },

  {
    ticker: 'SCHD',
    name: 'Schwab U.S. Dividend Equity ETF',
    category: 'us_equity',
    expenseRatio: 0.0006,
    // User-specified: 6.2% (quality + value screen adds ~30bps over market-weight)
    expectedReturn: 0.062,
    // User-specified: 14% (lower vol due to quality / value tilt)
    volatility: 0.140,
    // High qualified dividend yield; hold in taxable only if investor needs income;
    // otherwise tax-deferred preferred (distributions taxed at ordinary rates if not QDI)
    taxEfficiency: 'fair',
    // User-specified
    factorExposures: { value: 0.25, size: 0.00, quality: 0.60 },
  },

  {
    ticker: 'QQQM',
    name: 'Invesco NASDAQ-100 ETF',
    category: 'us_equity',
    expenseRatio: 0.0015,
    // User-specified: 6.5% (user override; note assets.ts has 5.0% — valuation discount)
    expectedReturn: 0.065,
    // User-specified: 18% (concentrated mega-cap tech; higher vol than broad VTI)
    volatility: 0.180,
    // Low dividend yield; mostly capital gains; tax-efficient but concentrated risk
    taxEfficiency: 'good',
    // Negative value (growth/tech tilt); no small-cap; modest quality via large-cap screen
    factorExposures: { value: -0.20, size: 0.00, quality: 0.35 },
  },

  {
    ticker: 'MTUM',
    name: 'iShares MSCI USA Momentum Factor ETF',
    category: 'us_equity',
    expenseRatio: 0.0015,
    // assets.ts cma2026 + factor adjustment: 5.8% (momentum premium ~+30bps over market)
    expectedReturn: 0.058,
    // assets.ts volEstimate: 17%; momentum rebalances into recent winners
    volatility: 0.170,
    // Quarterly rebalancing generates short-term gains; fair tax efficiency vs VTI
    taxEfficiency: 'fair',
    // Recent winners often growth-tilted (negative value); no size screen; quality neutral
    factorExposures: { value: -0.10, size: 0.00, quality: 0.30 },
  },

  // ── International Equity ──────────────────────────────────────────────────

  {
    ticker: 'VXUS',
    name: 'Vanguard Total International Stock ETF',
    category: 'intl_equity',
    expenseRatio: 0.0007,
    // User-specified: 7.0%
    expectedReturn: 0.070,
    // User-specified: 17%
    volatility: 0.170,
    // Foreign tax credit eligible in taxable; mostly qualified dividends from developed markets
    taxEfficiency: 'good',
    // Market-weight international; minimal deliberate factor tilt
    factorExposures: { value: 0.08, size: 0.05, quality: 0.10 },
  },

  {
    ticker: 'AVDV',
    name: 'Avantis International Small Cap Value ETF',
    category: 'intl_equity',
    expenseRatio: 0.0036,
    // User-specified: 8.5%
    expectedReturn: 0.085,
    // User-specified: 21%
    volatility: 0.210,
    // Foreign dividends; active screens increase turnover vs passive; Roth preferred
    taxEfficiency: 'good',
    // Mirror of AVUV for international: strong value + size + profitability
    factorExposures: { value: 0.60, size: 0.70, quality: 0.25 },
  },

  {
    ticker: 'VWO',
    name: 'Vanguard Emerging Markets ETF',
    category: 'intl_equity',
    expenseRatio: 0.0008,
    // User-specified: 8.2%
    expectedReturn: 0.082,
    // User-specified: 22% (EM vol driven by currency + political risk)
    volatility: 0.220,
    // Foreign dividends from EM not always qualified; modest tax efficiency
    taxEfficiency: 'fair',
    // Light value tilt (state-owned enterprises and cheap EM sectors); minimal size/quality
    factorExposures: { value: 0.15, size: 0.05, quality: 0.05 },
  },

  {
    ticker: 'VEA',
    name: 'Vanguard Developed Markets ETF',
    category: 'intl_equity',
    expenseRatio: 0.0005,
    // assets.ts cma2026: 7.8% (valuation discount in European + Japanese markets)
    expectedReturn: 0.078,
    // assets.ts volEstimate: 16%; developed market volatility, similar to US broad market
    volatility: 0.160,
    // Foreign tax credit eligible; mostly qualified dividends
    taxEfficiency: 'good',
    // Slight value tilt vs US (CAPE discount); no size premium in market-weight fund
    factorExposures: { value: 0.10, size: 0.05, quality: 0.12 },
  },

  // ── Real Assets ───────────────────────────────────────────────────────────

  {
    ticker: 'VNQ',
    name: 'Vanguard Real Estate ETF',
    category: 'real_assets',
    expenseRatio: 0.0012,
    // User-specified: 6.5%
    expectedReturn: 0.065,
    // User-specified: 19%
    volatility: 0.190,
    // Non-qualified REIT dividends taxed as ordinary income; ALWAYS tax-deferred/Roth
    taxEfficiency: 'poor',
    // REITs: value + income characteristics; meaningful size tilt vs market-cap equity
    factorExposures: { value: 0.20, size: 0.10, quality: 0.15 },
  },

  {
    ticker: 'IAU',
    name: 'iShares Gold Trust',
    category: 'real_assets',
    expenseRatio: 0.0025,
    // assets.ts cma2026: 4.0% (low structural return; held as tail-risk hedge)
    expectedReturn: 0.040,
    // assets.ts volEstimate: 18%; gold vol is driven by USD strength and crisis demand
    volatility: 0.180,
    // Taxed as collectible at 28% max rate — materially worse than equity cap gains
    taxEfficiency: 'poor',
    // Gold has no earnings; no equity factor exposure by design
    factorExposures: NO_FACTORS,
  },

  {
    ticker: 'VPU',
    name: 'Vanguard Utilities ETF',
    category: 'real_assets',
    expenseRatio: 0.0010,
    // assets.ts cma2026: 5.5% (regulated utility earnings yield + rate-base growth)
    expectedReturn: 0.055,
    // assets.ts volEstimate: 12%; low-beta sector (~0.5 beta to SPX)
    volatility: 0.120,
    // Utility dividends partially qualified; ordinary income portion from rate-regulated profits
    taxEfficiency: 'fair',
    // Regulated monopolies: high cash flow quality; modest value tilt; no size exposure
    factorExposures: { value: 0.10, size: 0.00, quality: 0.30 },
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
