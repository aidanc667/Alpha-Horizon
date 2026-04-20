import { calculateAllETFReturns, calculateETFVolatility } from '@/lib/data/calculateETFReturns';
import { ETF_UNIVERSE } from '@/lib/data/etfUniverse';
import type { AllocationSlice, AllocationCategory, AccountPlacement } from '@/lib/agents/types';

export { calculateAllETFReturns, calculateETFVolatility };

// ─── Internal lookups ─────────────────────────────────────────────────────────

/** Maps ETFCategory → AllocationCategory for the 3-bucket framework. */
const CATEGORY_MAP: Record<string, AllocationCategory> = {
  us_equity:   'growth',
  intl_equity: 'growth',
  bonds:       'income',
  cash:        'safety',
  real_assets: 'alternative',
};

/** O(1) ticker → ETF metadata lookup. */
const ETF_META = Object.fromEntries(ETF_UNIVERSE.map((e) => [e.ticker, e]));

// ─── Equity template lookup tables ────────────────────────────────────────────

const EQUITY_TEMPLATES = {
  conservative: { VTI: 0.50, SCHD: 0.30, VXUS: 0.20 },
  moderate:     { VTI: 0.40, AVUV: 0.20, VXUS: 0.25, AVDV: 0.15 },
  aggressive:   { VTI: 0.30, AVUV: 0.25, AVDV: 0.20, VXUS: 0.20, VWO: 0.05 },
} as const;

function riskTier(riskScore: number): keyof typeof EQUITY_TEMPLATES {
  if (riskScore <= 3) return 'conservative';
  if (riskScore <= 6) return 'moderate';
  return 'aggressive';
}

// ─── 1. deriveTargetAllocation ────────────────────────────────────────────────

/**
 * Derives the high-level equity/bond/cash split from client profile inputs.
 * Pure arithmetic — no LLM, executes in <1ms.
 *
 * @returns Decimals summing to 1.0
 */
export function deriveTargetAllocation(
  riskScore: number,
  yearsToGoal: number,
  regime: string,
  fundedStatus: number,
  hasEmergencyFund: boolean,
): { equityTarget: number; bondTarget: number; cashTarget: number } {
  // Base equity from risk score (score 5 → 50%)
  let equityTarget = riskScore * 0.10;

  // Horizon adjustment
  if      (yearsToGoal < 5)  equityTarget *= 0.60;
  else if (yearsToGoal < 10) equityTarget *= 0.80;
  else if (yearsToGoal > 20) equityTarget  = Math.min(equityTarget * 1.20, 1.0);
  // 10–20 yr: no adjustment

  // Macro regime overlay
  if (regime === 'risk_off') equityTarget *= 0.90;

  // Funded status overlay (LDI approach)
  if      (fundedStatus < 0.70) equityTarget *= 0.85;
  else if (fundedStatus > 1.20) equityTarget  = Math.min(equityTarget * 1.10, 1.0);

  // Clamp [0, 1]
  equityTarget = Math.max(0, Math.min(1, equityTarget));

  const cashTarget = hasEmergencyFund ? 0 : 0.10;
  const bondTarget = Math.max(0, 1.0 - equityTarget - cashTarget);

  return { equityTarget, bondTarget, cashTarget };
}

// ─── 3. determineAccountPlacement ────────────────────────────────────────────

/**
 * Returns the optimal account type for a given ETF based on tax efficiency rules.
 * Called internally by selectETFsForAllocation.
 */
export function determineAccountPlacement(
  ticker: string,
  availableAccounts: string[],
): AccountPlacement {
  const has = (acct: string) =>
    availableAccounts.some(a => a.toLowerCase().includes(acct));

  // Tax-exempt bond ETFs — exemption only valuable in taxable
  if (['VTEB', 'CMF'].includes(ticker)) return 'taxable';

  // High-growth factor ETFs — highest compounding value inside Roth
  if (['AVUV', 'AVDV', 'VWO'].includes(ticker)) return has('roth') ? 'roth' : 'taxable';

  // Interest-generating ETFs — deferred in Traditional avoids ordinary income drag
  if (['BND', 'SCHD'].includes(ticker)) return has('traditional') ? 'traditional' : 'taxable';

  // VTI, VXUS, SGOV — tax-efficient broad equity and T-bills default to taxable
  return 'taxable';
}

// ─── 2. selectETFsForAllocation ───────────────────────────────────────────────

/**
 * Builds an AllocationSlice array from pre-derived targets using lookup tables.
 * No optimization loops — executes in <10ms.
 *
 * Validates that weights sum to 1.0 (±0.01) after normalization.
 */
export function selectETFsForAllocation(
  equityTarget: number,
  bondTarget: number,
  cashTarget: number,
  riskScore: number,
  taxBracket: number,
  accounts: string[],
): AllocationSlice[] {
  const template = EQUITY_TEMPLATES[riskTier(riskScore)];
  const slices: AllocationSlice[] = [];

  // ── Equity sleeves ─────────────────────────────────────────────────────────
  for (const [ticker, templateWeight] of Object.entries(template)) {
    const weight = (templateWeight as number) * equityTarget;
    if (weight < 0.005) continue; // drop negligible positions

    const meta = ETF_META[ticker];
    slices.push({
      ticker,
      weight,
      category: CATEGORY_MAP[meta?.category ?? 'us_equity'] ?? 'growth',
      accountPlacement: determineAccountPlacement(ticker, accounts),
    });
  }

  // ── Bond sleeve ────────────────────────────────────────────────────────────
  if (bondTarget > 0.005) {
    // VTEB: tax-exempt muni yield beats BND after-tax at ≥24% marginal rate
    // only when investor has a taxable account to hold it in
    const hasTaxable  = accounts.some(a => /taxable|brokerage/i.test(a));
    const bondTicker  = taxBracket >= 0.24 && hasTaxable ? 'VTEB' : 'BND';
    slices.push({
      ticker: bondTicker,
      weight: bondTarget,
      category: 'income',
      accountPlacement: determineAccountPlacement(bondTicker, accounts),
    });
  }

  // ── Cash / safety sleeve ───────────────────────────────────────────────────
  if (cashTarget > 0.005) {
    slices.push({
      ticker: 'SGOV',
      weight: cashTarget,
      category: 'safety',
      accountPlacement: 'taxable', // T-bills: state-tax-exempt, always liquid
    });
  }

  // ── Normalize weights to sum exactly to 1.0 ────────────────────────────────
  const total = slices.reduce((s, x) => s + x.weight, 0);
  if (total > 0) slices.forEach(s => { s.weight = s.weight / total; });

  // ── Validate ───────────────────────────────────────────────────────────────
  const sum = slices.reduce((s, x) => s + x.weight, 0);
  if (Math.abs(sum - 1.0) > 0.01) {
    throw new Error(
      `portfolioRules: weights sum to ${sum.toFixed(4)}, expected 1.0 ±0.01`,
    );
  }

  return slices;
}
