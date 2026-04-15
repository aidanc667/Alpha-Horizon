// ─── Portfolio Agent — Constants ─────────────────────────────────────────────

import type { AgentName, AllocationSlice } from './types';

export const APP_NAME = 'Portfolio Agent';
export const APP_TAGLINE = 'Institutional-Grade Multi-Agent Portfolio Construction';

export const AGENT_PIPELINE: AgentName[] = [
  'clientProfile',
  'capitalMarkets',
  'portfolioConstruction',
  'riskAgent',
  'taxImplementation',
  'criticEvaluator',
];

export const AGENT_LABELS: Record<AgentName, string> = {
  clientProfile:          'Client Profile Agent',
  capitalMarkets:         'Capital Markets Agent',
  portfolioConstruction:  'Portfolio Construction Agent',
  riskAgent:              'Risk Agent',
  taxImplementation:      'Tax & Implementation Agent',
  criticEvaluator:        'Critic / Evaluator Agent',
};

export const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  clientProfile:          'Parsing goals, time horizon, liquidity needs, risk capacity, and behavioral constraints',
  capitalMarkets:         'Gathering live market assumptions, valuation context, yield levels, and regime signals',
  portfolioConstruction:  'Building candidate allocation using your profile and current macro framework',
  riskAgent:              'Stress testing drawdown, concentration, liquidity, duration, and sequence risk',
  taxImplementation:      'Optimizing asset location, tax efficiency, rebalancing strategy, and ETF selection',
  criticEvaluator:        'Scoring the plan 0–100 across 5 dimensions and identifying top deficiencies',
};

export const AGENT_ICONS: Record<AgentName, string> = {
  clientProfile:          '🧬',
  capitalMarkets:         '🌍',
  portfolioConstruction:  '📐',
  riskAgent:              '🛡️',
  taxImplementation:      '⚖️',
  criticEvaluator:        '🔴',
};

export const CRITIC_PASS_THRESHOLD = 80;   // Revision only on genuinely broken plans — see deriveCriticScore() for criticalFailure thresholds
export const CRITIC_MIN_GAIN = 3;
export const MAX_ITERATIONS = 2;           // 2 passes max: each pass = 1 LLM call (~8–15s); 3 passes risks hitting the 45s timeout

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

export const ACCOUNT_OPTIONS = [
  'Standard Taxable Brokerage',
  'Workplace 401(k) or 403(b)',
  'Roth IRA or Traditional IRA',
  'HSA (Health Savings Account)',
  'None yet',
];

// ─── Construction Templates ───────────────────────────────────────────────────
// Defines what is structurally valid for each risk profile.
// Used server-side only — not injected into the LLM prompt.
// equityMin/Max are post-bond, post-safety-sleeve bounds for validation.
// allowedAssetClasses constrains what categories the LLM may select from.
//
// Hook for future CMA store: swap allowedAssetClasses or equityMin/Max here
// when a source-tagged update changes permitted vehicles for a given profile.
export interface ConstructionTemplate {
  equityMin: number;          // minimum equity fraction of total portfolio
  equityMax: number;          // maximum equity fraction (hard cap, validated post-construction)
  allowedAssetClasses: string[]; // categories permitted for this profile; others are anomalies
}

export const CONSTRUCTION_TEMPLATES: Record<string, ConstructionTemplate> = {
  conservative: {
    equityMin: 0.25, equityMax: 0.65,
    allowedAssetClasses: ['US Equity', 'Dividend', 'Low Volatility', 'International Developed', 'Bond', 'Safety/Cash'],
  },
  moderate: {
    equityMin: 0.50, equityMax: 0.85,
    allowedAssetClasses: ['US Equity', 'US Small Value', 'International Developed', 'International Small Value', 'Dividend', 'Bond', 'Safety/Cash'],
  },
  aggressive: {
    equityMin: 0.70, equityMax: 1.00,
    allowedAssetClasses: ['US Equity', 'US Small Value', 'International Developed', 'International Small Value', 'Emerging Markets', 'Growth', 'Momentum', 'Safety/Cash'],
  },
  // taxable_efficient_growth: intentionally omitted in this pass.
  // Future hook: add here when a taxable-optimized sleeve variant is needed.
};

// ─── Baseline Portfolios ──────────────────────────────────────────────────────
// Pure equity templates — no bonds, no cash, no SGOV.
// Bond and safety sleeves are fully handled by directives in runPortfolioConstructionAgent().
// 3 baselines: conservative, moderate, aggressive (very_aggressive falls back to aggressive).
export type BaselineSlice = Omit<AllocationSlice, 'rationale'>;

export const BASELINES: Record<string, BaselineSlice[]> = {
  conservative: [
    // Defensive equity: US core + quality/dividend tilt + international.
    // VEA carries the highest individual Sharpe (7.8% CMA / 16% vol = 0.225) of any equity here.
    // SCHD provides quality+value defensive tilt at lower vol (14%) than VTI (16%).
    // Bond directive adds 35–50%; these three equity positions scale down proportionally.
    { ticker: 'VTI',  name: 'Vanguard Total Stock Market', weight: 0.40, assetClass: 'US Equity',      bucket: 'growth', expectedAnnualReturn: 0.055, accountPlacement: 'taxable' },
    { ticker: 'SCHD', name: 'Schwab Dividend Equity',      weight: 0.30, assetClass: 'US Dividend',    bucket: 'income', expectedAnnualReturn: 0.058, accountPlacement: 'taxable' },
    { ticker: 'VEA',  name: 'Vanguard Developed Markets',  weight: 0.30, assetClass: 'Intl Developed', bucket: 'growth', expectedAnnualReturn: 0.078, accountPlacement: 'taxable' },
  ],
  moderate: [
    // Factor-tilted global equity. Uses VEA (not VXUS) to avoid the AVDV/VXUS overlap rule,
    // allowing AVUV + AVDV + VEA to coexist cleanly.
    // Bond directive adds 15–25%; scales these down proportionally.
    { ticker: 'VTI',  name: 'Vanguard Total Stock Market',  weight: 0.30, assetClass: 'US Equity',       bucket: 'growth', expectedAnnualReturn: 0.055, accountPlacement: 'taxable' },
    { ticker: 'AVUV', name: 'Avantis US Small Cap Value',   weight: 0.22, assetClass: 'US Small Value',  bucket: 'growth', expectedAnnualReturn: 0.075, accountPlacement: 'roth'    },
    { ticker: 'AVDV', name: 'Avantis Intl Small Cap Value', weight: 0.18, assetClass: 'Intl Small Value', bucket: 'growth', expectedAnnualReturn: 0.085, accountPlacement: 'roth'    },
    { ticker: 'VEA',  name: 'Vanguard Developed Markets',   weight: 0.30, assetClass: 'Intl Developed',  bucket: 'growth', expectedAnnualReturn: 0.078, accountPlacement: 'taxable' },
  ],
  aggressive: [
    // Max factor premium. AVDV has lowest US correlation (0.75 vs VTI) and highest CMA (8.5%).
    // Merged from prior aggressive/very_aggressive — no bonds ever, pure equity.
    { ticker: 'VTI',  name: 'Vanguard Total Stock Market',  weight: 0.20, assetClass: 'US Equity',       bucket: 'growth', expectedAnnualReturn: 0.055, accountPlacement: 'taxable' },
    { ticker: 'AVUV', name: 'Avantis US Small Cap Value',   weight: 0.25, assetClass: 'US Small Value',  bucket: 'growth', expectedAnnualReturn: 0.075, accountPlacement: 'roth'    },
    { ticker: 'AVDV', name: 'Avantis Intl Small Cap Value', weight: 0.25, assetClass: 'Intl Small Value', bucket: 'growth', expectedAnnualReturn: 0.085, accountPlacement: 'roth'    },
    { ticker: 'VEA',  name: 'Vanguard Developed Markets',   weight: 0.20, assetClass: 'Intl Developed',  bucket: 'growth', expectedAnnualReturn: 0.078, accountPlacement: 'taxable' },
    { ticker: 'VWO',  name: 'Vanguard Emerging Markets',    weight: 0.10, assetClass: 'Emerging Markets', bucket: 'growth', expectedAnnualReturn: 0.082, accountPlacement: 'taxable' },
  ],
};

export function serializeBaseline(slices: BaselineSlice[]): string {
  return slices.map(s =>
    `${s.ticker} ${(s.weight * 100).toFixed(0)}% ${s.bucket}/${s.accountPlacement}`
  ).join(' | ');
}

