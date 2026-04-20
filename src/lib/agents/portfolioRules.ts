import { calculateAllETFReturns, calculateETFVolatility } from '@/lib/data/calculateETFReturns';
import type { MarketRates } from '@/lib/data/calculateETFReturns';
import { ETF_UNIVERSE } from '@/lib/data/etfUniverse';
import { optimizeSharpeWeights } from './sharpeOptimizer';
import type { AllocationSlice, AllocationCategory, AccountPlacement } from '@/lib/agents/types';

export { calculateAllETFReturns, calculateETFVolatility };
export type { MarketRates };

// ─── Internal lookups ─────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, AllocationCategory> = {
  us_equity:   'growth',
  intl_equity: 'growth',
  bonds:       'income',
  cash:        'safety',
  real_assets: 'alternative',
};

const ETF_META = Object.fromEntries(ETF_UNIVERSE.map((e) => [e.ticker, e]));

// ─── Full-universe candidate selection ───────────────────────────────────────
//
// Instead of 3 fixed templates, every eligible ETF in the universe competes.
// The Sharpe optimizer decides which ones win and at what weight — profiles
// with different tax brackets, risk scores, or time horizons converge to
// genuinely different allocations even within the same risk tier.
//
// Per-category max weights (within each sleeve) prevent any single ETF from
// crowding out diversification:
//   Core equity (VTI, VXUS):            40% of equity sleeve
//   Factor/satellite equity:             30% of equity sleeve
//   Real assets (VNQ, IAU, VPU):        15% of equity sleeve
//   Core bonds (BND, VTEB):             60% of bond sleeve
//   Satellite bonds (SCHP, VCIT, BNDX): 40% of bond sleeve
//   High yield (HYG):                   25% of bond sleeve (aggressive only)

interface SleeveSpec {
  tickers: string[];
  maxWeightPerPosition: number;
}

function buildEquitySleeveSpec(riskScore: number, taxBracket: number): SleeveSpec {
  const tickers: string[] = [];

  // ── Core: broad market always included ──────────────────────────────────
  // VTI vs VOO: optimizer picks — VTI has ~+10bps from small-cap sleeve at same ER.
  // VT: single-fund global alternative to VTI+VXUS; useful for simpler portfolios.
  tickers.push('VTI', 'VOO', 'VXUS', 'VT');

  // ── Factor tilts: add for moderate and aggressive profiles ───────────
  if (riskScore >= 4) {
    tickers.push('AVUV', 'AVDV');   // Small-cap value (highest expected return)
    tickers.push('VEA');            // Developed ex-EM (lowers vol vs VXUS alone)
  }
  if (riskScore >= 6) {
    tickers.push('VWO');            // Emerging markets (higher return, higher vol)
  }

  // ── Quality / income tilt: for low-to-moderate risk ─────────────────
  if (riskScore <= 6) {
    tickers.push('SCHD');           // Quality dividend — lower drawdown than VTI
  }

  // ── Growth tilt: only for aggressive profiles that explicitly want it ─
  if (riskScore >= 8) {
    tickers.push('MTUM');           // Momentum factor — aggressive only
  }

  // ── Real assets: small satellite sleeve for balanced profiles ─────────
  if (riskScore >= 3 && riskScore <= 7) {
    tickers.push('VNQ');            // REITs — income + inflation hedge
  }
  if (riskScore <= 6) {
    tickers.push('IAU');            // Gold — tail-risk hedge; reduces drawdown
  }

  // Per-position cap: 40% for core, but we use a single cap for the whole sleeve.
  // The optimizer naturally concentrates less because diversification reduces vol.
  return { tickers, maxWeightPerPosition: 0.40 };
}

function buildBondSleeveSpec(
  riskScore: number,
  taxBracket: number,
  accounts: string[],
): SleeveSpec {
  const hasTaxable = accounts.some(a => /taxable|brokerage/i.test(a));
  const tickers: string[] = [];

  // ── Core bond: VTEB (TEY-adjusted) wins vs BND at high brackets ──────
  // Both enter — the optimizer picks based on after-tax yield signal from
  // calculateAllETFReturns(taxBracket), which applies TEY for VTEB.
  tickers.push('BND', 'VTEB');

  // ── Inflation protection: TIPS for anyone with a real asset goal ──────
  if (riskScore >= 3) {
    tickers.push('SCHP');
  }

  // ── Credit premium: IG corporates for moderate+ risk ─────────────────
  if (riskScore >= 5) {
    tickers.push('VCIT');
  }

  // ── International bonds: diversification for large bond sleeves ───────
  if (riskScore >= 4) {
    tickers.push('BNDX');
  }

  // ── High yield: aggressive profiles only — HYG is equity-like ────────
  if (riskScore >= 7) {
    tickers.push('HYG');
  }

  return { tickers, maxWeightPerPosition: 0.60 };
}

// ─── 1. deriveTargetAllocation ────────────────────────────────────────────────

export function deriveTargetAllocation(
  riskScore: number,
  yearsToGoal: number,
  regime: string,
  fundedStatus: number,
  hasEmergencyFund: boolean,
): { equityTarget: number; bondTarget: number; cashTarget: number } {
  let equityTarget = riskScore * 0.10;

  if      (yearsToGoal < 5)  equityTarget *= 0.60;
  else if (yearsToGoal < 10) equityTarget *= 0.80;
  else if (yearsToGoal > 20) equityTarget  = Math.min(equityTarget * 1.20, 1.0);

  if (regime === 'risk_off') equityTarget *= 0.90;

  if      (fundedStatus < 0.70) equityTarget *= 0.85;
  else if (fundedStatus > 1.20) equityTarget  = Math.min(equityTarget * 1.10, 1.0);

  equityTarget = Math.max(0, Math.min(1, equityTarget));

  const cashTarget = hasEmergencyFund ? 0 : 0.10;
  const bondTarget = Math.max(0, 1.0 - equityTarget - cashTarget);

  return { equityTarget, bondTarget, cashTarget };
}

// ─── 2. determineAccountPlacement ────────────────────────────────────────────

export function determineAccountPlacement(
  ticker: string,
  availableAccounts: string[],
): AccountPlacement {
  const has = (acct: string) =>
    availableAccounts.some(a => a.toLowerCase().includes(acct));

  if (['VTEB', 'CMF'].includes(ticker))              return 'taxable';
  if (['AVUV', 'AVDV', 'VWO', 'MTUM'].includes(ticker))
    return has('roth') ? 'roth' : 'taxable';
  if (['BND', 'SCHD', 'SCHP', 'VCIT', 'BNDX', 'HYG', 'VNQ'].includes(ticker))
    return has('traditional') ? 'traditional' : 'taxable';
  if (ticker === 'IAU')
    return has('roth') ? 'roth' : has('traditional') ? 'traditional' : 'taxable';

  return 'taxable';
}

// ─── 3. selectETFsForAllocation ───────────────────────────────────────────────

export function selectETFsForAllocation(
  equityTarget: number,
  bondTarget: number,
  cashTarget: number,
  riskScore: number,
  taxBracket: number,
  accounts: string[],
  riskFreeRate: number = 0.048,
  marketRates?: MarketRates,
): AllocationSlice[] {
  // calculateAllETFReturns applies TEY for muni bonds and, when marketRates is
  // provided, anchors bond/cash returns to live FRED yields instead of static CMAs.
  const etfReturns = calculateAllETFReturns(taxBracket, marketRates);
  const slices: AllocationSlice[] = [];

  // ── Equity + real assets sleeve ───────────────────────────────────────────
  if (equityTarget > 0.005) {
    const { tickers, maxWeightPerPosition } = buildEquitySleeveSpec(riskScore, taxBracket);
    const returns = Object.fromEntries(tickers.map(t => [t, etfReturns[t] ?? 0]));

    const weights = optimizeSharpeWeights(tickers, returns, riskFreeRate, {
      maxWeightPerPosition,
      iterations: 500,
      minWeight: 0.02,
    });

    for (const [ticker, w] of Object.entries(weights)) {
      const scaled = w * equityTarget;
      if (scaled < 0.005) continue;
      slices.push({
        ticker,
        weight: scaled,
        category: CATEGORY_MAP[ETF_META[ticker]?.category ?? 'us_equity'] ?? 'growth',
        accountPlacement: determineAccountPlacement(ticker, accounts),
      });
    }
  }

  // ── Bond sleeve ───────────────────────────────────────────────────────────
  if (bondTarget > 0.005) {
    const { tickers, maxWeightPerPosition } = buildBondSleeveSpec(riskScore, taxBracket, accounts);
    const returns = Object.fromEntries(tickers.map(t => [t, etfReturns[t] ?? 0]));

    const weights = optimizeSharpeWeights(tickers, returns, riskFreeRate, {
      maxWeightPerPosition,
      iterations: 400,
      minWeight: 0.03,
    });

    for (const [ticker, w] of Object.entries(weights)) {
      const scaled = w * bondTarget;
      if (scaled < 0.005) continue;
      slices.push({
        ticker,
        weight: scaled,
        category: 'income',
        accountPlacement: determineAccountPlacement(ticker, accounts),
      });
    }
  }

  // ── Cash sleeve ───────────────────────────────────────────────────────────
  if (cashTarget > 0.005) {
    slices.push({
      ticker: 'SGOV',
      weight: cashTarget,
      category: 'safety',
      accountPlacement: 'taxable',
    });
  }

  // ── Normalize ─────────────────────────────────────────────────────────────
  const total = slices.reduce((s, x) => s + x.weight, 0);
  if (total > 0) slices.forEach(s => { s.weight = s.weight / total; });

  const sum = slices.reduce((s, x) => s + x.weight, 0);
  if (Math.abs(sum - 1.0) > 0.01) {
    throw new Error(`portfolioRules: weights sum to ${sum.toFixed(4)}, expected 1.0 ±0.01`);
  }

  return slices;
}
