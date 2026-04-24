/**
 * calculateETFReturns.ts
 *
 * Computes expected returns and volatility for all ETFs by composing
 * institutional CMA forecasts with per-ETF factor adjustments and expenses.
 *
 * ── Calculation pipeline ──────────────────────────────────────────────────────
 *   1. Weighted blend of primary (and optional secondary) asset-class CMAs
 *   2. + factorPremiumAdjustment  (size, value, momentum — see etfAssetClassMapping.ts)
 *   3. − expenseRatio             (annual fee drag)
 *   4. TEY adjustment for muni bonds when taxBracket is supplied
 *
 * ── Muni bond tax-equivalent yield (TEY) ─────────────────────────────────────
 *   TEY = nominal_yield / (1 − marginal_tax_rate)
 *   e.g. VTEB at 3.2% nominal, 35% bracket → 3.2% / 0.65 = 4.92% TEY
 *   This makes muni returns comparable to taxable bond yields for high-bracket
 *   investors who hold munis in a taxable account. Do NOT apply TEY when munis
 *   are held in a tax-deferred account (the tax exemption is already captured
 *   by the account wrapper).
 *
 * ── Volatility note ───────────────────────────────────────────────────────────
 *   calculateETFVolatility() returns a simple weighted average of asset-class
 *   standard deviations — not a true portfolio vol (which requires correlations).
 *   For single-ETF sigma estimates this is adequate; for multi-asset portfolios
 *   use truePortfolioVol() in src/lib/assets.ts instead.
 *
 * @example
 * // Pre-calculate returns for all ETFs at a 35% marginal rate
 * const returns = calculateAllETFReturns(0.35);
 * console.log(returns['AVUV']); // ~0.0915  (9.15% — small-cap value factor premium)
 * console.log(returns['VTEB']); // ~0.0492  (4.92% tax-equivalent at 35% bracket)
 * console.log(returns['VTI']);  // ~0.0647  (6.47% net of 0.03% ER)
 */

import { INSTITUTIONAL_CMAS } from './institutionalCMAs';
import { ETF_TO_ASSET_CLASS }  from './etfAssetClassMapping';

// ─── Market rates (live from FRED via Agent 2) ────────────────────────────────

/**
 * Live market rates passed from Agent 2 (FRED) into the return calculation.
 * When provided, bond and cash returns are anchored to current yields rather
 * than the static 2026 CMA baseline.
 */
export interface MarketRates {
  /** Current 10-Year Treasury yield (e.g. 0.0435 = 4.35%). Used for bond sleeve. */
  riskFreeRate: number;
  /** Current Effective Federal Funds Rate. Used for cash sleeve (SGOV, USFR). */
  fedFundsRate: number;
  /**
   * Shiller CAPE ratio for the US equity market (e.g. 32).
   * When provided, US equity ETF returns are computed via the CAPE build-up model:
   *   expectedReturn = (1/CAPE) + REAL_EPS_GROWTH + cpiYoY + classPremium
   * instead of the static 2026 institutional CMA. This makes equity return
   * estimates responsive to current market valuations.
   * Source: agent2 macroData.shillerCAPE (updated annually via FRED/manual).
   */
  shillerCAPE?: number;
  /**
   * Current CPI year-over-year inflation rate (e.g. 0.028 = 2.8%).
   * Used with shillerCAPE in the build-up model — inflation is the nominal
   * component of expected equity returns above the real earnings yield.
   * Source: agent2 macroData.cpiYoY (live from FRED CPIAUCSL).
   */
  cpiYoY?: number;
}

// ─── Rate constants ───────────────────────────────────────────────────────────

/**
 * 10-Year Treasury yield assumed when the 2026 institutional CMAs were published
 * (JPMorgan LTCMA 2026 baseline). When live rates differ, bond/cash returns are
 * adjusted by the delta so the model reflects current market conditions.
 */
export const BASELINE_RF = 0.0435;

/**
 * Typical yield ratio of muni bonds to equivalent-maturity Treasuries.
 * Updated to 0.80 — the 0.75 value reflected pre-2022 conditions; the
 * post-2022 muni/treasury ratio has stabilised closer to 0.80 as higher
 * absolute yields reduced the relative demand premium for tax-exempt income.
 */
const MUNI_TREASURY_RATIO = 0.80;

/**
 * Derives the pre-expense nominal yield for a muni bond ETF (VTEB/CMF) from
 * the current 10-Year Treasury yield.
 *
 * Single canonical implementation shared by calculateETFReturns.ts and agent5.ts
 * so both modules always use the same muni/treasury ratio. Pass BASELINE_RF when
 * live market rates are not available.
 *
 * Source: Bloomberg BVAL Muni indices — post-2022 muni/treasury ratio ≈ 0.80.
 */
export function deriveMuniNominalYield(rfr: number): number {
  return MUNI_TREASURY_RATIO * rfr;
}

// Asset class sets — used to route each ETF to its rate-adjustment logic
const BOND_CLASSES  = new Set(['US_AGGREGATE_BONDS', 'US_TIPS', 'US_HIGH_YIELD']);
const CASH_CLASSES  = new Set(['US_TREASURY_SHORT']);
const MUNI_CLASSES  = new Set(['US_MUNI_BONDS']);

// ─── CAPE build-up model for US equity ───────────────────────────────────────
//
// Formula (Shiller / Damodaran):
//   expectedReturn = (1 / CAPE) + REAL_EPS_GROWTH + cpiYoY + classPremium
//
// Where:
//   1/CAPE           = cyclically-adjusted earnings yield (current valuation signal)
//   REAL_EPS_GROWTH  = 1.3% long-run real US EPS growth net of share dilution
//                      Source: Dimson, Marsh, Staunton, "Credit Suisse Global Investment
//                      Returns Yearbook 2024", US data 1900–2023 (~1.3% per year)
//   cpiYoY           = current inflation from FRED — converts real to nominal
//   classPremium     = size/style premium relative to US large-cap (from Fama-French)
//
// Calibration check — at CAPE=32, CPI=2.8% (the 2026 CMA baseline):
//   US_LARGE_CAP:    1/32 + 1.3% + 2.8% + 0.0%  = 7.23% ≈ 7.2% CMA  ✓
//   US_MID_CAP:      1/32 + 1.3% + 2.8% + 0.3%  = 7.53% ≈ 7.5% CMA  ✓
//   US_SMALL_CAP:    1/32 + 1.3% + 2.8% + 0.5%  = 7.73% ≈ 7.7% CMA  ✓
//   US_SMALL_VALUE:  1/32 + 1.3% + 2.8% + 1.2%  = 8.43% ≈ 8.4% CMA  ✓
//   US_LARGE_GROWTH: 1/32 + 1.3% + 2.8% − 0.2%  = 7.03% ≈ 7.0% CMA  ✓
//
// When CAPE drops to 25 (cheaper market), US_LARGE_CAP → 8.1% (+90bps)
// When CAPE rises to 40 (richer market), US_LARGE_CAP → 6.6% (−60bps)

// Source: Dimson, Marsh, Staunton, "Credit Suisse Global Investment Returns Yearbook 2024"
const REAL_EPS_GROWTH = 0.013;

/** US equity asset class keys — these use the CAPE build-up model when live data available. */
const US_EQUITY_CLASSES = new Set([
  'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP', 'US_SMALL_VALUE', 'US_LARGE_GROWTH',
]);

/**
 * Size/style premium of each US equity class relative to US_LARGE_CAP.
 * Calibrated against Fama-French factor research and the 2026 institutional CMAs.
 * The CAPE model applies these on top of the base earnings-yield return.
 */
const US_EQUITY_CLASS_PREMIUM: Record<string, number> = {
  US_LARGE_CAP:     0.000,  // baseline — no premium
  US_MID_CAP:       0.003,  // +30bps size premium (small-cap lite)
  US_SMALL_CAP:     0.005,  // +50bps size premium (Fama-French SMB)
  US_SMALL_VALUE:   0.012,  // +120bps size + value premium; AQR Capital Management (2023), "Value is Alive," p.8: SMB+HML ~1.1% annualized
  US_LARGE_GROWTH:  -0.002, // −20bps growth discount (premium P/E, lower earnings yield)
};

// ─── Expected Return ──────────────────────────────────────────────────────────

/**
 * Calculates the net expected annualized return for a single ETF.
 *
 * @param ticker     - Ticker symbol (must exist in ETF_TO_ASSET_CLASS)
 * @param taxBracket - Combined marginal tax rate as a decimal (e.g. 0.35 = 35%).
 *                     Only affects muni-bond ETFs (US_MUNI_BONDS primary class).
 *                     Pass undefined when the ETF is held in a tax-deferred account.
 * @returns Net expected annualized return as a decimal (e.g. 0.065 = 6.5%)
 * @throws  When ticker is not found in ETF_TO_ASSET_CLASS
 */
export function calculateETFExpectedReturn(
  ticker: string,
  taxBracket?: number,
): number {
  const mapping = ETF_TO_ASSET_CLASS[ticker];
  if (!mapping) {
    throw new Error(`ETF "${ticker}" not found in ETF_TO_ASSET_CLASS mapping`);
  }

  // Step 1: Weighted blend of primary (+ optional secondary) asset-class CMA
  const primaryCMA = INSTITUTIONAL_CMAS[mapping.primaryAssetClass];
  if (!primaryCMA) {
    throw new Error(
      `Asset class "${mapping.primaryAssetClass}" for ETF "${ticker}" not found in INSTITUTIONAL_CMAS`,
    );
  }
  let baseReturn = primaryCMA.return * mapping.weight;

  if (mapping.secondaryAssetClass && mapping.secondaryWeight != null) {
    const secondaryCMA = INSTITUTIONAL_CMAS[mapping.secondaryAssetClass];
    if (secondaryCMA) {
      baseReturn += secondaryCMA.return * mapping.secondaryWeight;
    }
  }

  // Step 2: Factor premium adjustment (value, size, momentum, contango drag, etc.)
  if (mapping.factorPremiumAdjustment != null) {
    baseReturn += mapping.factorPremiumAdjustment;
  }

  // Step 3: Expense ratio drag
  const afterFeeReturn = baseReturn - mapping.expenseRatio;

  // Step 4: Municipal bond TEY — only when muni is held in a taxable account
  if (mapping.primaryAssetClass === 'US_MUNI_BONDS' && taxBracket != null) {
    // TEY = nominal_yield / (1 - marginal_rate)
    // Ensures muni return is comparable to equivalent taxable yield
    return afterFeeReturn / (1 - taxBracket);
  }

  return afterFeeReturn;
}

// ─── Market-grounded single-ETF return ────────────────────────────────────────

/**
 * Computes an expected return for one ETF, anchoring bond and cash ETFs to
 * live market yields when `marketRates` is provided.
 *
 * Rate-adjustment logic by asset class:
 *   • Cash (US_TREASURY_SHORT)  — return ≈ current Fed Funds Rate - ER
 *   • Munis (US_MUNI_BONDS)     — pre-tax yield ≈ MUNI_TREASURY_RATIO × 10Y,
 *                                  TEY applied when taxBracket is provided
 *   • Bonds (US_AGGREGATE_BONDS / US_TIPS / US_HIGH_YIELD)
 *                                — static CMA shifted by (live10Y - BASELINE_RF)
 *   • Equity / Real assets       — static CMA unchanged (10-yr forecasts are
 *                                  structurally driven, not rate-sensitive short-term)
 */
function computeMarketGroundedReturn(
  ticker: string,
  taxBracket?: number,
  marketRates?: MarketRates,
): number {
  const mapping = ETF_TO_ASSET_CLASS[ticker];
  if (!mapping) return 0;

  // Without live rates, fall back to static CMA calculation unchanged
  if (!marketRates) return calculateETFExpectedReturn(ticker, taxBracket);

  const { riskFreeRate, fedFundsRate } = marketRates;
  const primaryClass = mapping.primaryAssetClass;

  // ── Cash sleeve: T-bills track Fed Funds Rate ─────────────────────────────
  if (CASH_CLASSES.has(primaryClass)) {
    return Math.max(0, fedFundsRate - mapping.expenseRatio);
  }

  // ── Muni bonds: pre-tax yield = deriveMuniNominalYield(10Y) ─────────────
  if (MUNI_CLASSES.has(primaryClass)) {
    const muniPreTaxNet = deriveMuniNominalYield(riskFreeRate) - mapping.expenseRatio;
    if (taxBracket != null) {
      // TEY makes muni return comparable to taxable yield for the investor's bracket
      return muniPreTaxNet / (1 - taxBracket);
    }
    return muniPreTaxNet;
  }

  // ── Investment-grade / high-yield bonds: shift by yield delta ────────────
  if (BOND_CLASSES.has(primaryClass)) {
    const staticReturn = calculateETFExpectedReturn(ticker, undefined); // no TEY for non-munis
    const rateShift = riskFreeRate - BASELINE_RF;
    return staticReturn + rateShift;
  }

  // ── US equity: CAPE build-up model (live valuation-sensitive) ───────────
  //
  // When shillerCAPE and cpiYoY are available, replace the static institutional
  // CMA with a live CAPE-derived return. This makes equity forecasts respond to
  // actual market valuations instead of being frozen at January 2026 levels.
  //
  // Example — if CAPE drops from 32 to 25 (market correction):
  //   VTI: 6.94% → 7.94%  (+100bps — equities become cheaper, expected return rises)
  //   AVUV: 9.35% → 10.35% (same +100bps base shift, factor premium unchanged)
  if (US_EQUITY_CLASSES.has(primaryClass) && marketRates.shillerCAPE && marketRates.cpiYoY != null) {
    const usLargeCapBase = (1 / marketRates.shillerCAPE) + REAL_EPS_GROWTH + marketRates.cpiYoY;

    // Primary class: CAPE base + size/style premium, scaled by exposure weight
    const primaryPremium = US_EQUITY_CLASS_PREMIUM[primaryClass] ?? 0;
    let baseReturn = (usLargeCapBase + primaryPremium) * mapping.weight;

    // Secondary class (e.g. VTI's small-cap sleeve, VT's international sleeve)
    if (mapping.secondaryAssetClass && mapping.secondaryWeight != null) {
      const secClass = mapping.secondaryAssetClass;
      if (US_EQUITY_CLASSES.has(secClass)) {
        // Also US equity — apply CAPE model to the secondary sleeve too
        const secPremium = US_EQUITY_CLASS_PREMIUM[secClass] ?? 0;
        baseReturn += (usLargeCapBase + secPremium) * mapping.secondaryWeight;
      } else {
        // International / bonds — use institutional CMA (no live foreign CAPE from FRED)
        const secCMA = INSTITUTIONAL_CMAS[secClass];
        if (secCMA) baseReturn += secCMA.return * mapping.secondaryWeight;
      }
    }

    const factor = mapping.factorPremiumAdjustment ?? 0;
    return baseReturn + factor - mapping.expenseRatio;
  }

  // ── International equity + real assets: static institutional CMA ─────────
  // No live international CAPE available from FRED — institutional CMAs
  // (JPM/Vanguard/BlackRock) already embed current valuations for these markets.
  return calculateETFExpectedReturn(ticker, taxBracket);
}

// ─── Batch Helper ─────────────────────────────────────────────────────────────

/**
 * Pre-calculates expected returns for every ETF in the universe in one pass.
 * Use this at the start of each agent run rather than calling
 * calculateETFExpectedReturn() inside a loop — avoids repeated map lookups.
 *
 * When `marketRates` is provided (live 10Y yield + Fed Funds from FRED):
 *   • Cash ETFs  track the current Fed Funds Rate
 *   • Muni ETFs  use muni/treasury ratio × 10Y, with TEY applied
 *   • Bond ETFs  shift proportionally with the live 10Y yield
 *   • Equity ETFs remain anchored to 2026 institutional CMAs (10-yr structural forecasts)
 *
 * @param taxBracket  - Optional combined marginal rate; applied to muni TEY.
 * @param marketRates - Optional live yields from Agent 2 (FRED). Without this,
 *                      returns use the static 2026 CMA baseline.
 * @returns Map of ticker → net expected annualized return
 *
 * @example
 * // Static CMAs only
 * const returns = calculateAllETFReturns(0.35);
 *
 * // Market-grounded (live FRED rates from agent2)
 * const returns = calculateAllETFReturns(0.35, {
 *   riskFreeRate: economicIntel.assetClassOutlook.riskFreeRate,
 *   fedFundsRate: economicIntel.macroData.fedFundsRate,
 * });
 */
export function calculateAllETFReturns(
  taxBracket?: number,
  marketRates?: MarketRates,
): Record<string, number> {
  const returns: Record<string, number> = {};

  for (const ticker in ETF_TO_ASSET_CLASS) {
    returns[ticker] = computeMarketGroundedReturn(ticker, taxBracket, marketRates);
  }

  return returns;
}

// ─── Volatility ───────────────────────────────────────────────────────────────

/**
 * Estimates annualized volatility for a single ETF by weighted-averaging the
 * standard deviations of its constituent asset classes.
 *
 * ⚠  This is a single-ETF approximation only. For multi-position portfolios,
 *    use truePortfolioVol() (src/lib/assets.ts) which applies the full
 *    covariance matrix (σ_p = √(wᵀ Σ w)).
 *
 * @param ticker - Ticker symbol (must exist in ETF_TO_ASSET_CLASS)
 * @returns Estimated annualized volatility as a decimal (e.g. 0.17 = 17%)
 * @throws  When ticker or asset-class key is not found
 */
export function calculateETFVolatility(ticker: string): number {
  const mapping = ETF_TO_ASSET_CLASS[ticker];
  if (!mapping) {
    throw new Error(`ETF "${ticker}" not found in ETF_TO_ASSET_CLASS mapping`);
  }

  const primaryCMA = INSTITUTIONAL_CMAS[mapping.primaryAssetClass];
  if (!primaryCMA) {
    throw new Error(
      `Asset class "${mapping.primaryAssetClass}" for ETF "${ticker}" not found in INSTITUTIONAL_CMAS`,
    );
  }
  let volatility = primaryCMA.volatility * mapping.weight;

  if (mapping.secondaryAssetClass && mapping.secondaryWeight != null) {
    const secondaryCMA = INSTITUTIONAL_CMAS[mapping.secondaryAssetClass];
    if (secondaryCMA) {
      volatility += secondaryCMA.volatility * mapping.secondaryWeight;
    }
  }

  return volatility;
}

// ─── Batch volatility ─────────────────────────────────────────────────────────

/**
 * Pre-calculates estimated volatility for every ETF in the universe.
 * Mirrors calculateAllETFReturns() for use in construction agent setup.
 *
 * @returns Map of ticker → estimated annualized volatility
 */
export function calculateAllETFVolatilities(): Record<string, number> {
  const vols: Record<string, number> = {};

  for (const ticker in ETF_TO_ASSET_CLASS) {
    vols[ticker] = calculateETFVolatility(ticker);
  }

  return vols;
}
