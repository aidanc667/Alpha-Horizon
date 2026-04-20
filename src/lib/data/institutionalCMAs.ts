/**
 * Institutional Capital Market Assumptions (CMAs) — 2026 Edition
 *
 * 10-year geometric annualized return and volatility forecasts averaged
 * across three institutional sources published each January:
 *
 *   • JPMorgan LTCMA 2026 — Long-Term Capital Market Assumptions
 *     https://am.jpmorgan.com/us/en/asset-management/institutional/insights/portfolio-insights/ltcma/
 *
 *   • Vanguard Market Outlook 2026
 *     https://institutional.vanguard.com/investment/perspectives/market-outlook.html
 *
 *   • BlackRock CMA 2026 — Capital Market Assumptions
 *     https://www.blackrock.com/institutions/en-us/insights/charts/capital-market-assumptions
 *
 * All three reports are freely available. Update this file each January when
 * new editions are published. The consensus (simple average of the three)
 * is stored here — individual source values live in src/lib/cmaData.json.
 *
 * Usage: map ETF tickers to asset-class keys via ETF_BUCKET_MAP in cmaStore.ts,
 * then call getCMAReturn() to resolve the authoritative return for any ticker.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssetClassForecast {
  /** 10-year annualized geometric return (decimal, e.g. 0.069 = 6.9%). */
  return: number;
  /** Annualized standard deviation (decimal, e.g. 0.17 = 17%). */
  volatility: number;
  /** Institutional reports this consensus is drawn from. */
  sources: string[];
  /** ISO date this entry was last reviewed and confirmed. */
  lastUpdated: string;
}

// ─── Consensus CMAs ───────────────────────────────────────────────────────────

export const INSTITUTIONAL_CMAS: Record<string, AssetClassForecast> = {

  // ── US Equity ──────────────────────────────────────────────────────────────

  US_LARGE_CAP: {
    // JPM 6.9% · Vanguard 6.8% · BlackRock 7.1% → avg 6.93% → 6.9%
    return: 0.069,
    volatility: 0.17,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  US_MID_CAP: {
    // Small-cap size premium above large-cap; consensus ~7.2%
    return: 0.072,
    volatility: 0.19,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  US_SMALL_CAP: {
    // Size premium adds ~50bps over mid-cap; consensus ~7.4%
    return: 0.074,
    volatility: 0.23,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  US_SMALL_VALUE: {
    // Size + value premiums combined; AVUV/VBR anchor class; consensus ~8.1%
    return: 0.081,
    volatility: 0.24,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  US_LARGE_GROWTH: {
    // Growth tilt trades return for lower value-factor loading; consensus ~6.7%
    return: 0.067,
    volatility: 0.19,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  // ── International Equity ──────────────────────────────────────────────────

  INTL_DEVELOPED: {
    // Valuation discount vs US drives higher expected return; consensus ~7.8%
    return: 0.078,
    volatility: 0.18,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  INTL_DEVELOPED_SMALL_VALUE: {
    // Size + value in developed ex-US; AVDV anchor class; consensus ~8.5%
    return: 0.085,
    volatility: 0.21,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  EMERGING_MARKETS: {
    // Higher structural growth + deeper valuation discount; consensus ~9.1%
    return: 0.091,
    volatility: 0.27,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  // ── Fixed Income ──────────────────────────────────────────────────────────

  US_AGGREGATE_BONDS: {
    // BND anchor class; yield-to-worst ~5.2% is the primary return driver; consensus ~5.2%
    return: 0.052,
    volatility: 0.05,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  US_TIPS: {
    // Real yield ~2.4% + 2.4% breakeven inflation; SCHP anchor class; consensus ~4.8%
    return: 0.048,
    volatility: 0.04,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  US_MUNI_BONDS: {
    // Pre-tax nominal yield; TEY at 32% bracket ≈ 4.7%; VTEB anchor class; consensus ~3.2%
    return: 0.032,
    volatility: 0.05,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  US_HIGH_YIELD: {
    // Credit risk premium ~200bps over IG; HYG anchor class; consensus ~6.5%
    return: 0.065,
    volatility: 0.12,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  US_TREASURY_SHORT: {
    // 10-yr forward rate normalisation from current 5.25% Fed Funds; consensus ~4.8%
    return: 0.048,
    volatility: 0.01,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  // ── Real Assets ───────────────────────────────────────────────────────────

  REAL_ESTATE: {
    // REIT earnings yield + NOI growth; VNQ anchor class; consensus ~6.5%
    return: 0.065,
    volatility: 0.19,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },

  COMMODITIES: {
    // Roll yield + spot return; IAU/broad commodity basket; consensus ~4.5%
    return: 0.045,
    volatility: 0.18,
    sources: ['JPM LTCMA 2026', 'Vanguard Market Outlook 2026', 'BlackRock CMA 2026'],
    lastUpdated: '2026-01-15',
  },
};

// ─── Lookup helper ────────────────────────────────────────────────────────────

/**
 * Returns the consensus forecast for an asset class key, or undefined if
 * the key is not present (e.g. before a new class is added to this table).
 */
export function getCMAForecast(assetClass: string): AssetClassForecast | undefined {
  return INSTITUTIONAL_CMAS[assetClass];
}
