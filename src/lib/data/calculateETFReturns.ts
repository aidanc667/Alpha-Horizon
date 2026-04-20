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

// ─── Batch Helper ─────────────────────────────────────────────────────────────

/**
 * Pre-calculates expected returns for every ETF in the universe in one pass.
 * Use this at the start of each agent run rather than calling
 * calculateETFExpectedReturn() inside a loop — avoids repeated map lookups.
 *
 * @param taxBracket - Optional combined marginal rate; passed through to muni TEY.
 * @returns Map of ticker → net expected annualized return
 *
 * @example
 * const returns = calculateAllETFReturns(0.35);
 * console.log(returns['AVUV']); // ~0.0915
 * console.log(returns['VTEB']); // ~0.0492 (TEY at 35%)
 */
export function calculateAllETFReturns(taxBracket?: number): Record<string, number> {
  const returns: Record<string, number> = {};

  for (const ticker in ETF_TO_ASSET_CLASS) {
    returns[ticker] = calculateETFExpectedReturn(ticker, taxBracket);
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
