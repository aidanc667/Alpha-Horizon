import { getCMAReturn } from '@/lib/cmaStore';

// Curated institutional ETF list — full candidate pool for dynamic selection
export const CURATED_ASSETS = [
  // ── Safety / Cash ───────────────────────────────────────────────────────────
  { ticker: 'CASH',  name: 'Cash / FDIC-Insured Savings',            category: 'Safety' },
  { ticker: 'VUSXX', name: 'Vanguard Treasury Money Market Fund',    category: 'Safety' },
  { ticker: 'SGOV',  name: 'iShares 0-3 Month Treasury Bond ETF',   category: 'Safety' },
  { ticker: 'USFR',  name: 'WisdomTree Floating Rate Treasury ETF',  category: 'Safety' },
  { ticker: 'BIL',   name: 'SPDR Bloomberg 1-3 Month T-Bill ETF',   category: 'Safety' },
  { ticker: 'SWVXX', name: 'Schwab Value Advantage Money Fund',      category: 'Safety' },
  { ticker: 'IBTG',  name: 'iShares iBonds Dec 2026 Term Treasury', category: 'Safety' },

  // ── Bonds / Fixed Income ────────────────────────────────────────────────────
  { ticker: 'BND',   name: 'Vanguard Total Bond Market ETF',         category: 'Bond' },
  { ticker: 'BNDX',  name: 'Vanguard Total International Bond ETF',  category: 'Bond' },
  { ticker: 'SCHP',  name: 'Schwab U.S. TIPS ETF',                   category: 'Bond' },
  { ticker: 'MUB',   name: 'iShares National Muni Bond ETF',         category: 'Bond' },
  { ticker: 'CMF',   name: 'iShares California Muni Bond ETF',       category: 'Bond' },
  { ticker: 'VTEB',  name: 'Vanguard Tax-Exempt Bond ETF',           category: 'Bond' },

  // ── US Equity — Core ────────────────────────────────────────────────────────
  { ticker: 'VTI',   name: 'Vanguard Total Stock Market ETF',        category: 'Core' },
  { ticker: 'VOO',   name: 'Vanguard S&P 500 ETF',                   category: 'Core' },
  { ticker: 'FXAIX', name: 'Fidelity 500 Index Fund',                category: 'Core' },

  // ── US Equity — Factor / Style ──────────────────────────────────────────────
  { ticker: 'QQQM',  name: 'Invesco NASDAQ-100 ETF',                 category: 'Growth' },
  { ticker: 'VGT',   name: 'Vanguard Information Technology ETF',    category: 'Growth' },
  { ticker: 'SCHG',  name: 'Schwab U.S. Large-Cap Growth ETF',       category: 'Growth' },
  { ticker: 'AVUV',  name: 'Avantis U.S. Small Cap Value ETF',       category: 'Growth' },
  { ticker: 'VBR',   name: 'Vanguard Small-Cap Value ETF',           category: 'Growth' },
  { ticker: 'SCHD',  name: 'Schwab U.S. Dividend Equity ETF',        category: 'Income' },
  { ticker: 'VIG',   name: 'Vanguard Dividend Appreciation ETF',     category: 'Income' },
  { ticker: 'VYM',   name: 'Vanguard High Dividend Yield ETF',       category: 'Income' },

  // ── International ────────────────────────────────────────────────────────────
  { ticker: 'VXUS',  name: 'Vanguard Total International Stock ETF', category: 'International' },
  { ticker: 'AVDV',  name: 'Avantis Intl Small Cap Value ETF',       category: 'International' },
  { ticker: 'VEA',   name: 'Vanguard Developed Markets ETF',         category: 'International' },
  { ticker: 'VWO',   name: 'Vanguard Emerging Markets ETF',          category: 'International' },

  // ── Real Assets ──────────────────────────────────────────────────────────────
  { ticker: 'VNQ',   name: 'Vanguard Real Estate ETF',               category: 'Real Assets' },
  { ticker: 'GLD',   name: 'SPDR Gold Shares',                       category: 'Real Assets' },
];

// ─── Rich ETF Metadata ────────────────────────────────────────────────────────
// Used by Portfolio Agent construction prompt for systematic ETF selection.
// Each entry specifies: expense ratio, 2026 CMA return anchor, volatility estimate,
// tax efficiency, overlap relationships, factor exposures, and selection guidance.
// This drives data-based ETF choice rather than LLM guessing.

export interface ETFMeta {
  ticker: string;
  name: string;
  subCategory: string;
  er: number;            // expense ratio (decimal, e.g. 0.0003 = 0.03%)
  cma2026: number;       // 10-yr forward return anchor from CMA consensus (decimal)
  volEstimate: number;   // approximate annual volatility (decimal)
  taxEfficiency: 'high' | 'medium' | 'low';
  overlapsWith: string[]; // tickers with >60% holdings overlap — never hold both
  factors: string[];      // factor exposures this ETF provides
  bestFor: string;        // one-line selection rule for the construction agent
}

export const ETF_UNIVERSE: ETFMeta[] = [
  // ── Safety / Cash Equivalents ─────────────────────────────────────────────
  {
    ticker: 'SGOV', name: 'iShares 0-3 Month Treasury Bond ETF',
    subCategory: 'Cash Equivalent',
    er: 0.0009, cma2026: 0.042, volEstimate: 0.005,
    taxEfficiency: 'high',
    overlapsWith: ['BIL', 'USFR', 'VUSXX'],
    factors: ['liquidity'],
    bestFor: 'Preferred cash/safety sleeve: lowest duration risk, T-Bill backed. Use over BIL (lower ER).',
  },
  {
    ticker: 'BIL', name: 'SPDR Bloomberg 1-3 Month T-Bill ETF',
    subCategory: 'Cash Equivalent',
    er: 0.0014, cma2026: 0.042, volEstimate: 0.005,
    taxEfficiency: 'high',
    overlapsWith: ['SGOV', 'USFR'],
    factors: ['liquidity'],
    bestFor: 'Fallback if SGOV unavailable. Higher ER than SGOV — prefer SGOV.',
  },
  {
    ticker: 'USFR', name: 'WisdomTree Floating Rate Treasury ETF',
    subCategory: 'Cash Equivalent',
    er: 0.0015, cma2026: 0.042, volEstimate: 0.003,
    taxEfficiency: 'high',
    overlapsWith: ['SGOV', 'BIL'],
    factors: ['liquidity', 'rate-floating'],
    bestFor: 'Use when Fed rate cuts are expected — floats with rate. Otherwise prefer SGOV.',
  },

  // ── Fixed Income — Core ───────────────────────────────────────────────────
  {
    ticker: 'BND', name: 'Vanguard Total Bond Market ETF',
    subCategory: 'US Aggregate Bond',
    er: 0.0003, cma2026: 0.050, volEstimate: 0.065,
    taxEfficiency: 'low',
    overlapsWith: ['AGG'],
    factors: ['duration', 'credit'],
    bestFor: 'Core fixed income. Broadest US bond exposure, lowest ER. Always prefer over AGG (same index, cheaper). Place in Traditional/tax-deferred.',
  },
  {
    ticker: 'SCHP', name: 'Schwab U.S. TIPS ETF',
    subCategory: 'Inflation-Protected Bond',
    er: 0.0003, cma2026: 0.044, volEstimate: 0.070,
    taxEfficiency: 'low',
    overlapsWith: ['TIP'],
    factors: ['inflation-protection', 'duration'],
    bestFor: 'Add when CPI >3% or inflation risk is high. Not a BND replacement — inflation hedge supplement.',
  },
  {
    ticker: 'VCIT', name: 'Vanguard Intermediate-Term Corporate Bond ETF',
    subCategory: 'Investment Grade Corporate',
    er: 0.0004, cma2026: 0.056, volEstimate: 0.072,
    taxEfficiency: 'low',
    overlapsWith: ['LQD', 'HYG'],
    factors: ['credit', 'duration'],
    bestFor: 'Higher yield than BND via investment-grade credit premium. Add for income or aggressive investors. ALWAYS place in Traditional/Roth — NEVER taxable (high interest distributions). Pairs with HYG if credit risk can be tolerated.',
  },
  {
    ticker: 'HYG', name: 'iShares iBoxx $ High Yield Corporate Bond ETF',
    subCategory: 'High Yield Bond',
    er: 0.0049, cma2026: 0.065, volEstimate: 0.120,
    taxEfficiency: 'low',
    overlapsWith: ['VCIT'],
    factors: ['credit', 'income'],
    bestFor: 'High-yield credit premium — 200–300 bps above investment-grade. Use for aggressive income portfolios. ALWAYS place in Traditional/Roth, NEVER taxable. Limit to 5–10% max. Avoid in risk_off macro regime (credit spreads widen). Pairs with VCIT or BND for full fixed-income spectrum.',
  },
  {
    ticker: 'BNDX', name: 'Vanguard Total International Bond ETF',
    subCategory: 'International Bond',
    er: 0.0007, cma2026: 0.045, volEstimate: 0.070,
    taxEfficiency: 'medium',
    overlapsWith: [],
    factors: ['global-diversification', 'duration'],
    bestFor: 'International fixed income diversification — currency hedged, reduces FX risk. Pairs with BND for a complete global bond allocation. Use when global diversification is a priority. Acceptable in taxable or tax-deferred accounts.',
  },

  // ── Fixed Income — Municipal (Tax-Exempt) ─────────────────────────────────
  {
    ticker: 'VTEB', name: 'Vanguard Tax-Exempt Bond ETF',
    subCategory: 'National Municipal Bond',
    er: 0.0005, cma2026: 0.032, volEstimate: 0.050,
    taxEfficiency: 'high',
    overlapsWith: ['MUB'],
    factors: ['tax-exempt-income'],
    bestFor: 'Tax-exempt munis — use in taxable account when marginal rate ≥24%. TEY = 3.2%/(1−rate): 32% → 4.71%, 37% → 5.08%. At 32%+ TEY beats BND after-tax (5.0%×0.68=3.4%). Prefer over MUB (lower ER 0.05% vs 0.07%). Duration 5.3yr — appropriate for medium-term bond allocation, not emergency fund.',
  },
  {
    ticker: 'CMF', name: 'iShares California Muni Bond ETF',
    subCategory: 'State Municipal Bond',
    er: 0.0025, cma2026: 0.030, volEstimate: 0.045,
    taxEfficiency: 'high',
    overlapsWith: ['VTEB', 'MUB'],
    factors: ['tax-exempt-income', 'state-tax-exempt'],
    bestFor: 'California residents ONLY in 32%+ bracket. Exempt from federal AND CA state tax. Use over VTEB for CA residents.',
  },

  // ── US Equity — Total Market / Large Cap Core ─────────────────────────────
  {
    ticker: 'VTI', name: 'Vanguard Total Stock Market ETF',
    subCategory: 'US Total Market',
    er: 0.0003, cma2026: 0.055, volEstimate: 0.160,
    taxEfficiency: 'high',
    overlapsWith: ['VOO', 'SCHB', 'VT'],
    factors: ['market', 'size', 'value'],
    bestFor: 'PREFERRED US core holding. Covers 4,000+ stocks (large+mid+small cap). More diversified than VOO. Same ER. Always prefer VTI over VOO unless S&P 500 specifically required.',
  },
  {
    ticker: 'VOO', name: 'Vanguard S&P 500 ETF',
    subCategory: 'US Large Cap',
    er: 0.0003, cma2026: 0.055, volEstimate: 0.155,
    taxEfficiency: 'high',
    overlapsWith: ['VTI', 'SCHB', 'VT'],
    factors: ['market'],
    bestFor: 'Use ONLY if investor specifically wants S&P 500 exposure. VTI is superior for diversification at same cost. Never hold both VTI and VOO.',
  },
  {
    ticker: 'VT', name: 'Vanguard Total World Stock ETF',
    subCategory: 'Global Total Market',
    er: 0.0007, cma2026: 0.063, volEstimate: 0.150,
    taxEfficiency: 'medium',
    overlapsWith: ['VTI', 'VOO', 'VEA', 'VWO', 'VXUS'],
    factors: ['market', 'global-diversification'],
    bestFor: 'Single-fund global solution (~60% US, ~30% Developed Intl, ~10% EM). If VT is selected, DO NOT also add VEA, VWO, or VXUS — it already contains them.',
  },

  // ── US Equity — Factor / Style ────────────────────────────────────────────
  {
    ticker: 'AVUV', name: 'Avantis U.S. Small Cap Value ETF',
    subCategory: 'US Small Cap Value',
    er: 0.0025, cma2026: 0.075, volEstimate: 0.220,
    taxEfficiency: 'medium',
    overlapsWith: ['VBR'],
    factors: ['size', 'value', 'profitability'],
    bestFor: 'PREFERRED small cap value. Actively managed factor targeting (size+value+profitability). Higher ER than VBR but more pure factor exposure and better expected return. Use in Roth (high growth, tax-free).',
  },
  {
    ticker: 'VBR', name: 'Vanguard Small-Cap Value ETF',
    subCategory: 'US Small Cap Value',
    er: 0.0007, cma2026: 0.072, volEstimate: 0.200,
    taxEfficiency: 'medium',
    overlapsWith: ['AVUV'],
    factors: ['size', 'value'],
    bestFor: 'Passive small cap value. Use over AVUV only if cost is primary concern. Never hold both.',
  },
  {
    ticker: 'QQQM', name: 'Invesco NASDAQ-100 ETF',
    subCategory: 'US Large Growth / Tech',
    er: 0.0015, cma2026: 0.050, volEstimate: 0.190,
    taxEfficiency: 'high',
    overlapsWith: ['VGT', 'SCHG', 'MTUM'],
    factors: ['growth', 'tech'],
    bestFor: 'CAUTION: CMA 5.0% is BELOW VTI (5.5%) with HIGHER volatility (19% vs 16%) — you pay a concentration penalty for no extra return. Only use if investor explicitly wants NASDAQ-100 / tech-sector tilt despite valuation headwind. Limit 10% max. Use in Roth only. Never combine with VGT (80%+ overlap). Consider MTUM (momentum factor) instead for a growth tilt with better risk-adjusted expectations.',
  },
  {
    ticker: 'VGT', name: 'Vanguard Information Technology ETF',
    subCategory: 'US Tech Sector',
    er: 0.0010, cma2026: 0.048, volEstimate: 0.220,
    taxEfficiency: 'high',
    overlapsWith: ['QQQM', 'SCHG'],
    factors: ['growth', 'tech'],
    bestFor: 'CAUTION: Concentrated tech sector — 22% vol with only 4.8% CMA return. Even more concentrated than QQQM. Use ONLY for deliberate tech overweight under 8%. Never hold with QQQM. Prefer MTUM for growth-factor exposure.',
  },
  {
    ticker: 'MTUM', name: 'iShares MSCI USA Momentum Factor ETF',
    subCategory: 'US Momentum Factor',
    er: 0.0015, cma2026: 0.058, volEstimate: 0.170,
    taxEfficiency: 'medium',
    overlapsWith: ['QQQM'],
    factors: ['momentum', 'growth'],
    bestFor: 'PREFERRED growth-tilt ETF over QQQM. Momentum factor = Fama-French 5-factor validated premium. Holds recent 12-month winners; rotates quarterly. Higher CMA (5.8%) than QQQM (5.0%) with similar vol. Uncorrelated with value factor (AVUV) — excellent diversifier in factor portfolios. Limit 10–15% max. Use in Roth (higher turnover). Aggressive/long-horizon investors.',
  },
  {
    ticker: 'SPLV', name: 'Invesco S&P 500 Low Volatility ETF',
    subCategory: 'US Low Volatility Factor',
    er: 0.0025, cma2026: 0.050, volEstimate: 0.115,
    taxEfficiency: 'high',
    overlapsWith: ['SCHD', 'VIG'],
    factors: ['low-beta', 'quality', 'income'],
    bestFor: 'Defensive equity factor — holds 100 lowest-volatility S&P 500 stocks. Significantly reduces drawdown vs VTI in bear markets (historically ~30% less drawdown). Use for conservative/moderate investors who want equity exposure with meaningful downside protection. Lower expected return than VTI but much smoother ride. Never combine with SCHD (quality/yield overlap). Place in taxable (tax-efficient).',
  },
  {
    ticker: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF',
    subCategory: 'US Dividend / Quality',
    er: 0.0006, cma2026: 0.058, volEstimate: 0.140,
    taxEfficiency: 'high',
    overlapsWith: ['VIG', 'VYM'],
    factors: ['value', 'quality', 'income'],
    bestFor: 'PREFERRED dividend ETF. Quality+value factor tilt with income. Lower vol than broad market. Good for income-focused or moderate-risk investors. Never combine with VIG (high overlap).',
  },
  {
    ticker: 'VIG', name: 'Vanguard Dividend Appreciation ETF',
    subCategory: 'US Dividend Growth',
    er: 0.0006, cma2026: 0.057, volEstimate: 0.130,
    taxEfficiency: 'high',
    overlapsWith: ['SCHD', 'VYM'],
    factors: ['quality', 'growth', 'income'],
    bestFor: 'Dividend GROWTH focus (not yield). Lower yield than SCHD but more growth. Use over SCHD for growth-oriented income investors. Never hold both VIG and SCHD.',
  },

  // ── International Equity ──────────────────────────────────────────────────
  {
    ticker: 'VEA', name: 'Vanguard Developed Markets ETF',
    subCategory: 'International Developed',
    er: 0.0005, cma2026: 0.078, volEstimate: 0.160,
    taxEfficiency: 'medium',
    overlapsWith: ['VXUS', 'VT'],
    factors: ['global-diversification', 'value'],
    bestFor: 'PREFERRED developed markets. Europe+Japan+Australia. Foreign tax credit eligible in taxable. Higher CMA than US due to valuation discount. Use with VWO for full international.',
  },
  {
    ticker: 'VWO', name: 'Vanguard Emerging Markets ETF',
    subCategory: 'Emerging Markets',
    er: 0.0008, cma2026: 0.082, volEstimate: 0.210,
    taxEfficiency: 'medium',
    overlapsWith: ['VXUS', 'VT'],
    factors: ['global-diversification', 'growth'],
    bestFor: 'Emerging markets (China, India, Brazil etc). Highest CMA return but highest vol. Keep under 15% except for aggressive profiles. Combine with VEA for full international coverage.',
  },
  {
    ticker: 'VXUS', name: 'Vanguard Total International Stock ETF',
    subCategory: 'Total International',
    er: 0.0007, cma2026: 0.079, volEstimate: 0.170,
    taxEfficiency: 'medium',
    overlapsWith: ['VEA', 'VWO', 'VT', 'AVDV'],
    factors: ['global-diversification'],
    bestFor: 'Single-fund international solution (VEA+VWO combined). If VXUS selected, DO NOT also add VEA or VWO. Use when simplicity is preferred over granular control.',
  },
  {
    ticker: 'AVDV', name: 'Avantis International Small Cap Value ETF',
    subCategory: 'International Small Cap Value',
    er: 0.0036, cma2026: 0.085, volEstimate: 0.220,
    taxEfficiency: 'medium',
    overlapsWith: ['VXUS'],
    factors: ['size', 'value', 'profitability', 'global-diversification'],
    bestFor: 'International factor premium. Pairs with VEA (not a replacement). Highest expected return in international universe. Aggressive/long-horizon investors only. Place in Roth.',
  },

  // ── Real Assets ───────────────────────────────────────────────────────────
  {
    ticker: 'VNQ', name: 'Vanguard Real Estate ETF',
    subCategory: 'US REITs',
    er: 0.0012, cma2026: 0.068, volEstimate: 0.190,
    taxEfficiency: 'low',
    overlapsWith: [],
    factors: ['real-assets', 'income', 'inflation-hedge'],
    bestFor: 'Real estate exposure + inflation hedge. High distributions = tax-INEFFICIENT. ALWAYS place in Traditional or Roth, NEVER taxable. Limit 5–10% of portfolio.',
  },
  {
    ticker: 'VPU', name: 'Vanguard Utilities ETF',
    subCategory: 'US Utilities',
    er: 0.0010, cma2026: 0.055, volEstimate: 0.120,
    taxEfficiency: 'medium',
    overlapsWith: [],
    factors: ['income', 'inflation-hedge', 'low-beta'],
    bestFor: 'Defensive dividend equity — distinct from REITs (regulated utilities, NOT real estate). Inflation-linked cash flows. Low beta (~0.5) reduces portfolio drawdown. Use for income-focused or conservative investors. Pairs with VNQ for broader real assets. Acceptable in taxable or tax-deferred.',
  },
  {
    ticker: 'IAU', name: 'iShares Gold Trust',
    subCategory: 'Commodities / Gold',
    er: 0.0025, cma2026: 0.040, volEstimate: 0.180,
    taxEfficiency: 'low',
    overlapsWith: ['GLD'],
    factors: ['real-assets', 'inflation-hedge', 'uncorrelated'],
    bestFor: 'PREFERRED gold ETF — identical exposure to GLD at 0.25% ER vs GLD\'s 0.40% (saves 150 bps/yr, ~38% cheaper). Non-correlated crisis hedge. Low expected return but meaningfully reduces portfolio drawdown in equity crashes. Use 3–8% max for tail risk mitigation only. Taxed as collectible — place in IRA if available. Not for growth-focused portfolios.',
  },
];

// ─── Deterministic Return Anchors ────────────────────────────────────────────
// Keyed by ticker — server-authoritative 10-yr forward CMA return estimates.
// These are the ONLY source of expectedAnnualReturn used at runtime.
// LLM-generated return assumptions are always discarded and replaced by these values.
// Values come from cmaStore.getCMAReturn() — source-tagged with explicit provenance.
// Falls back to ETF_UNIVERSE.cma2026 if no store entry exists for a ticker.
// To activate an institutional source: set placeholder:false in cmaStore.ts; no other change needed.
export const CMA_ANCHORS: Record<string, number> = Object.fromEntries(
  ETF_UNIVERSE.map(e => [e.ticker, getCMAReturn(e.ticker) ?? e.cma2026])
);

// ─── ETF Whitelist ────────────────────────────────────────────────────────────
// The only tickers construction is allowed to produce. Any ticker returned by the
// LLM that is not in this set is dropped by normalizeAllocation before the plan
// is assembled. Prevents hallucinated or unsupported ETFs from reaching the output.
export const WHITELISTED_TICKERS: Set<string> = new Set(ETF_UNIVERSE.map(e => e.ticker));

// ─── Overlap Pairs ────────────────────────────────────────────────────────────
// [preferred, inferior] — if both appear in an LLM allocation, the inferior is
// dropped deterministically before weight normalization. Order matters: the
// preferred ticker is always the first element.
// Source of truth for substitution rules — mirrors the PREFER hints in the prompt
// but is now enforced server-side rather than relying on LLM compliance.
export const OVERLAP_PAIRS: Array<[string, string]> = [
  ['VTI',  'VOO'],   // VTI covers 4000+ stocks vs S&P 500, same ER
  ['VTI',  'SCHB'],  // SCHB tracks CRSP US Total Market — same index as VTI
  ['AVUV', 'VBR'],   // AVUV = active factor targeting; better factor purity than passive VBR
  ['SCHD', 'VIG'],   // SCHD: lower ER, stronger quality+value screen than VIG
  ['SCHD', 'VYM'],   // SCHD dominates VYM on quality + yield + factor loading
  ['VTEB', 'MUB'],   // VTEB: lower ER (0.05% vs 0.07%), same national muni index
  ['SGOV', 'BIL'],   // SGOV: lower ER (0.09% vs 0.14%), state-tax-exempt
  ['MTUM', 'QQQM'],  // MTUM: diversified momentum factor vs concentrated tech bet
  ['IAU',  'GLD'],   // IAU: lower ER (0.25% vs 0.40%), identical gold exposure
  ['BND',  'AGG'],   // BND: lower ER, same US aggregate bond index
];

// ─── Pairwise ETF Correlation Matrix ─────────────────────────────────────────
// Historical 5-10yr rolling correlations (2015-2024 window, includes 2022 rate shock).
// Stored as upper triangle — getCorrelation() handles both orderings + self (1.0).
// Unknown pairs fall back to asset-class defaults in getCorrelation().
const ETF_CORR: Record<string, Record<string, number>> = {
  VTI:  { VOO:0.99, VT:0.97, VXUS:0.86, VEA:0.84, VWO:0.73, AVUV:0.83, VBR:0.91, AVDV:0.75, SCHD:0.88, VIG:0.89, MTUM:0.89, QQQM:0.92, VGT:0.88, SPLV:0.82, VNQ:0.73, IAU:-0.02, VPU:0.57, BND:0.05, SCHP:0.01, VTEB:0.02, CMF:0.02, MUB:0.02, SGOV:-0.05, BIL:-0.05, USFR:-0.04, HYG:0.56, VCIT:0.22, BNDX:0.10 },
  VOO:  { VT:0.96, VXUS:0.85, VEA:0.83, VWO:0.72, AVUV:0.82, VBR:0.90, AVDV:0.74, SCHD:0.87, VIG:0.89, MTUM:0.90, QQQM:0.93, VGT:0.89, SPLV:0.81, VNQ:0.71, IAU:-0.02, VPU:0.55, BND:0.04, SCHP:0.01, VTEB:0.02, CMF:0.02, MUB:0.02, SGOV:-0.05, BIL:-0.05, USFR:-0.04, HYG:0.55, VCIT:0.21, BNDX:0.09 },
  VT:   { VXUS:0.97, VEA:0.94, VWO:0.84, AVUV:0.82, VBR:0.89, AVDV:0.83, SCHD:0.88, VIG:0.88, MTUM:0.87, QQQM:0.89, VGT:0.86, SPLV:0.80, VNQ:0.72, IAU:-0.01, VPU:0.56, BND:0.06, SCHP:0.02, VTEB:0.03, CMF:0.03, MUB:0.03, SGOV:-0.05, BIL:-0.05, USFR:-0.04, HYG:0.56, VCIT:0.22, BNDX:0.13 },
  VXUS: { VEA:0.97, VWO:0.89, AVUV:0.70, VBR:0.73, AVDV:0.83, SCHD:0.79, VIG:0.79, MTUM:0.76, QQQM:0.79, VGT:0.75, SPLV:0.70, VNQ:0.65, IAU:0.01, VPU:0.49, BND:0.06, SCHP:0.02, VTEB:0.03, CMF:0.03, MUB:0.03, SGOV:-0.04, BIL:-0.04, USFR:-0.03, HYG:0.51, VCIT:0.18, BNDX:0.15 },
  VEA:  { VWO:0.80, AVUV:0.68, VBR:0.71, AVDV:0.89, SCHD:0.77, VIG:0.77, MTUM:0.74, QQQM:0.76, VGT:0.72, SPLV:0.68, VNQ:0.64, IAU:0.01, VPU:0.47, BND:0.06, SCHP:0.02, VTEB:0.03, CMF:0.03, MUB:0.03, SGOV:-0.04, BIL:-0.04, USFR:-0.03, HYG:0.49, VCIT:0.16, BNDX:0.16 },
  VWO:  { AVUV:0.61, VBR:0.63, AVDV:0.69, SCHD:0.68, VIG:0.68, MTUM:0.65, QQQM:0.69, VGT:0.66, SPLV:0.59, VNQ:0.59, IAU:0.04, VPU:0.44, BND:0.03, SCHP:0.01, VTEB:0.01, CMF:0.01, MUB:0.01, SGOV:-0.03, BIL:-0.03, USFR:-0.02, HYG:0.48, VCIT:0.14, BNDX:0.13 },
  AVUV: { VBR:0.97, AVDV:0.71, SCHD:0.81, VIG:0.79, MTUM:0.77, QQQM:0.79, VGT:0.75, SPLV:0.74, VNQ:0.69, IAU:-0.01, VPU:0.51, BND:0.04, SCHP:0.01, VTEB:0.02, CMF:0.02, MUB:0.02, SGOV:-0.04, BIL:-0.04, USFR:-0.03, HYG:0.52, VCIT:0.18, BNDX:0.08 },
  VBR:  { AVDV:0.69, SCHD:0.82, VIG:0.80, MTUM:0.78, QQQM:0.81, VGT:0.77, SPLV:0.75, VNQ:0.71, IAU:-0.01, VPU:0.53, BND:0.05, SCHP:0.01, VTEB:0.02, CMF:0.02, MUB:0.02, SGOV:-0.04, BIL:-0.04, USFR:-0.03, HYG:0.53, VCIT:0.19, BNDX:0.08 },
  AVDV: { SCHD:0.73, VIG:0.73, MTUM:0.69, QQQM:0.71, VGT:0.67, SPLV:0.63, VNQ:0.61, IAU:0.02, VPU:0.45, BND:0.04, SCHP:0.02, VTEB:0.02, CMF:0.02, MUB:0.02, SGOV:-0.03, BIL:-0.03, USFR:-0.02, HYG:0.46, VCIT:0.15, BNDX:0.11 },
  SCHD: { VIG:0.91, MTUM:0.81, QQQM:0.83, VGT:0.79, SPLV:0.79, VNQ:0.73, IAU:-0.02, VPU:0.61, BND:0.11, SCHP:0.03, VTEB:0.05, CMF:0.05, MUB:0.05, SGOV:-0.04, BIL:-0.04, USFR:-0.03, HYG:0.51, VCIT:0.23, BNDX:0.09 },
  VIG:  { MTUM:0.81, QQQM:0.84, VGT:0.81, SPLV:0.79, VNQ:0.71, IAU:-0.02, VPU:0.61, BND:0.11, SCHP:0.03, VTEB:0.05, CMF:0.05, MUB:0.05, SGOV:-0.04, BIL:-0.04, USFR:-0.03, HYG:0.51, VCIT:0.23, BNDX:0.09 },
  MTUM: { QQQM:0.89, VGT:0.85, SPLV:0.73, VNQ:0.66, IAU:-0.02, VPU:0.51, BND:0.03, SCHP:0.01, VTEB:0.02, CMF:0.02, MUB:0.02, SGOV:-0.04, BIL:-0.04, USFR:-0.03, HYG:0.49, VCIT:0.16, BNDX:0.08 },
  QQQM: { VGT:0.92, SPLV:0.75, VNQ:0.64, IAU:-0.02, VPU:0.49, BND:0.01, SCHP:-0.01, VTEB:0.01, CMF:0.01, MUB:0.01, SGOV:-0.05, BIL:-0.05, USFR:-0.04, HYG:0.51, VCIT:0.16, BNDX:0.07 },
  VGT:  { SPLV:0.69, VNQ:0.61, IAU:-0.03, VPU:0.46, BND:0.00, SCHP:-0.01, VTEB:0.00, CMF:0.00, MUB:0.00, SGOV:-0.05, BIL:-0.05, USFR:-0.04, HYG:0.48, VCIT:0.14, BNDX:0.07 },
  SPLV: { VNQ:0.69, IAU:0.01, VPU:0.66, BND:0.16, SCHP:0.05, VTEB:0.07, CMF:0.07, MUB:0.07, SGOV:-0.03, BIL:-0.03, USFR:-0.02, HYG:0.49, VCIT:0.26, BNDX:0.13 },
  VNQ:  { IAU:0.03, VPU:0.56, BND:0.41, SCHP:0.16, VTEB:0.26, CMF:0.26, MUB:0.26, SGOV:-0.03, BIL:-0.03, USFR:-0.02, HYG:0.53, VCIT:0.36, BNDX:0.21 },
  IAU:  { VPU:0.09, BND:0.06, SCHP:0.13, VTEB:0.05, CMF:0.05, MUB:0.05, SGOV:0.01, BIL:0.01, USFR:0.01, HYG:0.06, VCIT:0.06, BNDX:0.09 },
  VPU:  { BND:0.31, SCHP:0.11, VTEB:0.21, CMF:0.21, MUB:0.21, SGOV:-0.02, BIL:-0.02, USFR:-0.01, HYG:0.41, VCIT:0.31, BNDX:0.16 },
  BND:  { SCHP:0.76, VTEB:0.61, CMF:0.59, MUB:0.63, SGOV:-0.10, BIL:-0.10, USFR:-0.08, HYG:0.56, VCIT:0.76, BNDX:0.73 },
  SCHP: { VTEB:0.46, CMF:0.44, MUB:0.47, SGOV:-0.05, BIL:-0.05, USFR:-0.04, HYG:0.31, VCIT:0.56, BNDX:0.61 },
  VTEB: { CMF:0.93, MUB:0.98, SGOV:-0.08, BIL:-0.08, USFR:-0.07, HYG:0.39, VCIT:0.51, BNDX:0.49 },
  CMF:  { MUB:0.94, SGOV:-0.08, BIL:-0.08, USFR:-0.07, HYG:0.36, VCIT:0.49, BNDX:0.47 },
  MUB:  { SGOV:-0.08, BIL:-0.08, USFR:-0.07, HYG:0.39, VCIT:0.51, BNDX:0.49 },
  SGOV: { BIL:0.99, USFR:0.95, HYG:-0.02, VCIT:-0.05, BNDX:-0.08 },
  BIL:  { USFR:0.95, HYG:-0.02, VCIT:-0.05, BNDX:-0.08 },
  USFR: { HYG:-0.01, VCIT:-0.04, BNDX:-0.07 },
  HYG:  { VCIT:0.81, BNDX:0.36 },
  VCIT: { BNDX:0.53 },
};

// Asset-class sets for default correlation fallback
const _EQ   = new Set(['VTI','VOO','VT','VXUS','VEA','VWO','AVUV','VBR','AVDV','SCHD','VIG','MTUM','QQQM','VGT','SPLV','VNQ','VPU']);
const _BOND = new Set(['BND','SCHP','VCIT','HYG','BNDX','VTEB','CMF','MUB']);
const _CASH = new Set(['SGOV','BIL','USFR']);

/** Symmetric pairwise correlation lookup with asset-class defaults for unknown pairs. */
export function getCorrelation(a: string, b: string): number {
  if (a === b) return 1.0;
  return ETF_CORR[a]?.[b] ?? ETF_CORR[b]?.[a]
    ?? (_CASH.has(a) || _CASH.has(b) ? 0.00
      : _EQ.has(a) && _EQ.has(b) ? 0.70
      : _BOND.has(a) && _BOND.has(b) ? 0.50
      : 0.05);  // equity vs bond default
}

/**
 * True portfolio volatility using the full covariance matrix.
 *   σ_p = √(wᵀ Σ w)  where  Σ[i][j] = ρ[i][j] × σ_i × σ_j
 * Replaces the weighted-average-vol × diversification-factor approximation.
 * @param weights  Array of portfolio weights (must sum to ~1)
 * @param tickers  Corresponding ticker symbols
 * @param volMap   Annual volatility for each ticker (decimal, e.g. 0.16 = 16%)
 */
export function truePortfolioVol(
  weights: number[],
  tickers: string[],
  volMap: Record<string, number>,
): number {
  const n = weights.length;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const vi = volMap[tickers[i]] ?? 0.15;
    for (let j = 0; j < n; j++) {
      const vj = volMap[tickers[j]] ?? 0.15;
      variance += weights[i] * weights[j] * vi * vj * getCorrelation(tickers[i], tickers[j]);
    }
  }
  return Math.sqrt(Math.max(0.0001, variance));
}

// ─── ETF Selection Guide Generator ───────────────────────────────────────────
// Ultra-compact — just ticker:CMA pairs + overlap list.
// Verbose guides cause Gemini response truncation and JSON parse failures.
export function buildETFSelectionGuide(): string {
  const cmaPairs = ETF_UNIVERSE
    .map(e => `${e.ticker}:${(e.cma2026 * 100).toFixed(1)}%`)
    .join(' ');

  const seen = new Set<string>();
  const overlaps: string[] = [];
  for (const etf of ETF_UNIVERSE) {
    for (const other of etf.overlapsWith) {
      const key = [etf.ticker, other].sort().join('+');
      if (!seen.has(key)) { seen.add(key); overlaps.push(`${etf.ticker}/${other}`); }
    }
  }

  return `ETF CMA ANCHORS (use as expectedAnnualReturn): ${cmaPairs}
OVERLAP PAIRS (pick one, never both): ${overlaps.join(' ')}
PREFER: VTI>VOO | AVUV>VBR | SCHD>VIG | SGOV>BIL (BIL is dominated — never use BIL when SGOV is available) | MTUM>QQQM for growth tilt | IAU>GLD | VXUS replaces VEA+VWO | VT replaces VEA+VWO+VTI
BOND/CASH TAX ALPHA: SGOV=best safety/cash (state-exempt Treasury) | BND ONLY in tax-deferred (ordinary income drag) | VTEB in taxable for 24%+ brackets (federal-exempt, TEY beats BND after-tax) | CA residents: CMF beats VTEB (also state-exempt)
TAX (NEVER in taxable): VNQ HYG VCIT IAU — ALWAYS in Traditional/Roth
DEFENSIVE EQUITY: use SPLV (low-vol factor) for conservative/moderate instead of QQQM/VGT`;
}

/**
 * Filtered ETF selection guide — includes only tickers relevant to this specific request
 * plus their overlap partners. Reduces prompt size by ~40% vs the full 28-ETF guide,
 * cutting Gemini latency by 3–8s per call.
 *
 * relevantTickers: baseline equity ETFs + bond/safety sleeve directive tickers.
 * Overlap partners are automatically expanded so NEVER-BOTH rules stay accurate.
 */
export function buildFilteredETFGuide(relevantTickers: Set<string>): string {
  // Expand to include overlap partners of all relevant tickers
  // so the model sees the full substitution set for any ETF it might pick.
  const expanded = new Set(relevantTickers);
  for (const etf of ETF_UNIVERSE) {
    if (relevantTickers.has(etf.ticker)) {
      etf.overlapsWith.forEach(t => expanded.add(t));
    }
  }

  const filteredUniverse = ETF_UNIVERSE.filter(e => expanded.has(e.ticker));

  const seen = new Set<string>();
  const overlaps: string[] = [];
  for (const etf of filteredUniverse) {
    for (const other of etf.overlapsWith) {
      if (!expanded.has(other)) continue;
      const key = [etf.ticker, other].sort().join('+');
      if (!seen.has(key)) { seen.add(key); overlaps.push(`${etf.ticker}/${other}`); }
    }
  }

  return `OVERLAP PAIRS (pick one, never both): ${overlaps.length > 0 ? overlaps.join(' ') : 'none for this portfolio'}
PREFER: VTI>VOO | AVUV>VBR | SCHD>VIG | SGOV>BIL | MTUM>QQQM for growth tilt | IAU>GLD | VXUS replaces VEA+VWO | VT replaces VEA+VWO+VTI
TAX (NEVER in taxable): VNQ HYG VCIT IAU — ALWAYS in Traditional/Roth
DEFENSIVE EQUITY: use SPLV (low-vol factor) for conservative/moderate instead of QQQM/VGT`;
}
