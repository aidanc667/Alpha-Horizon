import { calculateAllETFReturns, calculateETFVolatility } from '@/lib/data/calculateETFReturns';
import type { MarketRates } from '@/lib/data/calculateETFReturns';
import { ETF_UNIVERSE } from '@/lib/data/etfUniverse';
import { OVERLAP_PAIRS } from '@/lib/assets';
import { optimizeSharpeWeights } from './sharpeOptimizer';
import type { AllocationSlice, AllocationCategory, AccountPlacement, InvestmentPreferences } from '@/lib/agents/types';

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

// ESG exclusion set: real-asset and credit ETFs with higher ESG controversy.
// Broad market index funds (VTI, VXUS, VT, AVUV, AVDV) are retained — they use
// passive cap-weighted indices with no active sector tilts.
const ESG_EXCLUDED = new Set(['VNQ', 'IAU', 'HYG', 'VCIT']);

function filterByPreferences(tickers: string[], prefs?: InvestmentPreferences): string[] {
  if (!prefs) return tickers;
  let out = tickers;
  if (prefs.esgOnly) {
    out = out.filter((t) => !ESG_EXCLUDED.has(t));
  }
  if (prefs.avoidedSectors) {
    const avoided = prefs.avoidedSectors.toLowerCase();
    // REITs (VNQ) have energy REIT sub-sector exposure
    if (avoided.includes('fossil') || avoided.includes('energy')) {
      out = out.filter((t) => t !== 'VNQ');
    }
    // Gold if commodities/materials avoided
    if (avoided.includes('gold') || avoided.includes('commodit')) {
      out = out.filter((t) => t !== 'IAU');
    }
  }
  return out;
}

function buildEquitySleeveSpec(riskScore: number, taxBracket: number, preferences?: InvestmentPreferences): SleeveSpec {
  const tickers: string[] = [];

  // ── Core: one framework — never hold VTI+VT simultaneously ──────────────
  // VT is 60% US + 40% international. Holding VT + VTI double-counts US equity,
  // producing an incoherent split (e.g. VTI 5% + VT 10% = 11% US from two funds,
  // only 4% international). A professional would never hold both.
  //
  // Choice: risk ≥ 5 → VTI + VXUS (separate sleeves; allows independent factor
  // satellites on each leg). risk < 5 → VT alone (single-fund simplicity for
  // conservative profiles that don't need explicit factor tilts).
  if (riskScore >= 5) {
    tickers.push('VTI', 'VXUS');   // explicit US + international sleeves
  } else {
    tickers.push('VT');             // single global core, lower complexity
  }

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

  // Per-position cap: 25% of equity sleeve max (was 40%).
  // At 80% equity target this limits any single factor tilt to 20% of total portfolio,
  // and combined AVUV+AVDV to ≤40% — defensible but not reckless.
  return { tickers: filterByPreferences(tickers, preferences), maxWeightPerPosition: 0.25 };
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

  if (['VTEB', 'CMF'].includes(ticker)) {
    if (has('taxable') || has('brokerage')) return 'taxable';
    return has('traditional') ? 'traditional' : 'taxable';
  }
  // HSA: triple-tax advantage (deduction + tax-free growth + medical withdrawal)
  // Place highest-expected-return assets here first. IRS Publication 969.
  if (['AVUV', 'AVDV', 'QQQM'].includes(ticker) && has('hsa')) return 'hsa';
  if (['AVUV', 'AVDV', 'VWO', 'MTUM'].includes(ticker))
    return has('roth') ? 'roth' : 'taxable';
  if (['BND', 'SCHD', 'SCHP', 'VCIT', 'BNDX', 'HYG', 'VNQ'].includes(ticker))
    return has('traditional') ? 'traditional' : 'taxable';
  if (ticker === 'IAU')
    return has('roth') ? 'roth' : has('traditional') ? 'traditional' : 'taxable';

  return 'taxable';
}

// ─── ETF hard-cap enforcement ─────────────────────────────────────────────────
//
// Clamps any ETF that exceeds its maxTotalWeight and redistributes the surplus
// to uncapped positions proportionally. Runs up to 3 passes until stable.

function enforceETFCaps(slices: AllocationSlice[]): AllocationSlice[] {
  let result = slices.map(s => ({ ...s }));

  for (let pass = 0; pass < 3; pass++) {
    let surplus = 0;
    const cappedIdx = new Set<number>();

    result = result.map((s, i) => {
      const cap = ETF_META[s.ticker]?.maxTotalWeight ?? 1.0;
      if (s.weight > cap + 0.001) {
        surplus += s.weight - cap;
        cappedIdx.add(i);
        return { ...s, weight: cap };
      }
      return s;
    });

    if (surplus < 0.001) break;

    const freeTotal = result
      .filter((_, i) => !cappedIdx.has(i))
      .reduce((sum, s) => sum + s.weight, 0);

    if (freeTotal < 0.001) break;

    result = result.map((s, i) =>
      cappedIdx.has(i) ? s : { ...s, weight: s.weight + surplus * (s.weight / freeTotal) },
    );
  }

  return result;
}

// ─── Core-satellite enforcement ───────────────────────────────────────────────
//
// Ensures broad-market core ETFs (VTI, VXUS, VT) hold at least 50% of the
// equity sleeve. If satellites have crowded them out, weight is shifted back
// proportionally. Bonds, cash, and alternatives are untouched.

const CORE_EQUITY = new Set(['VTI', 'VXUS', 'VT']);

function enforceCoreSatellite(slices: AllocationSlice[], equityTarget: number): AllocationSlice[] {
  if (equityTarget < 0.01) return slices;

  const equitySlices    = slices.filter(s => s.category === 'growth');
  const nonEquitySlices = slices.filter(s => s.category !== 'growth');

  const coreSlices      = equitySlices.filter(s =>  CORE_EQUITY.has(s.ticker));
  const satelliteSlices = equitySlices.filter(s => !CORE_EQUITY.has(s.ticker));

  const equityTotal = equitySlices.reduce((sum, s) => sum + s.weight, 0);
  const coreTotal   = coreSlices.reduce((sum, s) => sum + s.weight, 0);
  const minCore     = equityTotal * 0.50;

  if (coreTotal >= minCore - 0.001) return slices; // already fine

  const deficit       = minCore - coreTotal;
  const satelliteTotal = satelliteSlices.reduce((sum, s) => sum + s.weight, 0);
  if (satelliteTotal <= deficit + 0.001) return slices; // not enough to shift

  const scaleSatellite = (satelliteTotal - deficit) / satelliteTotal;
  const adjusted: AllocationSlice[] = [
    ...nonEquitySlices,
    ...coreSlices.map(s => ({
      ...s,
      weight: s.weight + deficit * (s.weight / coreTotal),
    })),
    ...satelliteSlices.map(s => ({ ...s, weight: s.weight * scaleSatellite })),
  ];

  return adjusted;
}

// ─── Portfolio consolidation ──────────────────────────────────────────────────
//
// Enforces two constraints:
//   1. At most maxPositions ETFs total (drops smallest, merges weight into same-
//      category neighbour or the overall largest).
//   2. Every position ≥ minWeight of the total portfolio (repeatedly merges the
//      lightest holding until the constraint is satisfied).
//
// These two passes are applied after all cap/core-satellite/overlap enforcement
// and before rounding, so the final rounded portfolio has 3–5 meaningful holdings.

function consolidatePortfolio(
  slices: AllocationSlice[],
  maxPositions = 5,
  minWeight = 0.20,
): AllocationSlice[] {
  if (slices.length === 0) return slices;

  const normalize = (arr: AllocationSlice[]): AllocationSlice[] => {
    const total = arr.reduce((s, x) => s + x.weight, 0);
    return total > 0 ? arr.map(s => ({ ...s, weight: s.weight / total })) : arr;
  };

  const mergeInto = (arr: AllocationSlice[], victim: AllocationSlice): AllocationSlice[] => {
    const remaining = arr.filter(s => s !== victim);
    const sameCategory = remaining.filter(s => s.category === victim.category);
    const target = (sameCategory.length > 0 ? sameCategory : remaining)
      .reduce((a, b) => a.weight > b.weight ? a : b);
    return remaining.map(s =>
      s === target ? { ...s, weight: s.weight + victim.weight } : s,
    );
  };

  let result = [...slices].sort((a, b) => b.weight - a.weight);

  // Pass 1 — trim to maxPositions
  while (result.length > maxPositions) {
    const smallest = result[result.length - 1];
    result = mergeInto(result, smallest);
    result = normalize(result).sort((a, b) => b.weight - a.weight);
  }

  // Pass 2 — eliminate sub-minWeight positions (never below 3 holdings)
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    result.sort((a, b) => b.weight - a.weight);
    const below = result.find(s => s.weight < minWeight - 0.001);
    if (!below) break;
    changed = true;
    result = normalize(mergeInto(result, below));
  }

  return result;
}

// ─── Weight rounding ──────────────────────────────────────────────────────────
//
// Rounds each position to the nearest 5% increment (e.g. 30.85% → 30%, 32.5% → 35%).
// Uses the largest-remainder algorithm so rounded weights always sum to exactly 100%.
// Any position that would round to 0% gets a floor of 5% so no holding disappears.

function roundWeightsToFive(slices: AllocationSlice[]): AllocationSlice[] {
  if (slices.length === 0) return slices;

  // Work in 5%-unit integers (multiply by 20) to avoid floating-point drift
  const units = slices.map(s => ({
    idx:       slices.indexOf(s),
    floored:   Math.max(1, Math.floor(s.weight * 20)), // floor, min 1 unit (5%)
    remainder: (s.weight * 20) % 1,
  }));

  const totalFloored = units.reduce((sum, u) => sum + u.floored, 0);
  let deficit = 20 - totalFloored; // 20 units = 100%

  // Award deficit units to positions with the largest fractional remainder
  units.sort((a, b) => b.remainder - a.remainder);
  for (const u of units) {
    if (deficit <= 0) break;
    u.floored += 1;
    deficit -= 1;
  }

  const result = [...slices];
  for (const u of units) {
    result[u.idx] = { ...result[u.idx], weight: u.floored / 20 };
  }
  return result;
}

// ─── Overlap pair enforcement ─────────────────────────────────────────────────
// If the optimizer selects both members of an OVERLAP_PAIRS entry (e.g. BND+VTEB,
// VTI+VOO), consolidate into the preferred ticker by merging weights. This prevents
// the portfolio from holding two near-identical funds simultaneously.
function enforceOverlapPairs(slices: AllocationSlice[]): AllocationSlice[] {
  const result = slices.map(s => ({ ...s }));
  for (const [preferred, deprecated] of OVERLAP_PAIRS) {
    const prefIdx  = result.findIndex(s => s.ticker === preferred);
    const deprIdx  = result.findIndex(s => s.ticker === deprecated);
    if (prefIdx === -1 || deprIdx === -1) continue;
    // Merge deprecated weight into preferred, then remove deprecated
    result[prefIdx] = { ...result[prefIdx], weight: result[prefIdx].weight + result[deprIdx].weight };
    result.splice(deprIdx, 1);
  }
  return result;
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
  preferences?: InvestmentPreferences,
  overrides?: { maxEquityWeightPerPosition?: number; seedAllocation?: Record<string, number> },
): AllocationSlice[] {
  // calculateAllETFReturns applies TEY for muni bonds and, when marketRates is
  // provided, anchors bond/cash returns to live FRED yields instead of static CMAs.
  const etfReturns = calculateAllETFReturns(taxBracket, marketRates);
  const slices: AllocationSlice[] = [];

  // equityTarget captured here so enforceCoreSatellite can use it below
  const capturedEquityTarget = equityTarget;

  // ── Equity + real assets sleeve ───────────────────────────────────────────
  if (equityTarget > 0.005) {
    const { tickers, maxWeightPerPosition: defaultCap } = buildEquitySleeveSpec(riskScore, taxBracket, preferences);
    const maxWeightPerPosition = overrides?.maxEquityWeightPerPosition ?? defaultCap;
    const returns = Object.fromEntries(tickers.map(t => [t, etfReturns[t] ?? 0]));

    const equitySeed = overrides?.seedAllocation
      ? Object.fromEntries(
          tickers
            .filter(t => (overrides.seedAllocation![t] ?? 0) > 0)
            .map(t => [t, overrides.seedAllocation![t]]),
        )
      : undefined;
    const weights = optimizeSharpeWeights(tickers, returns, riskFreeRate, {
      maxWeightPerPosition,
      iterations: 500,
      minWeight: 0.02,
      regularization: equitySeed ? 0.15 : 0,
      ...(equitySeed && Object.keys(equitySeed).length > 0 ? { seedWeights: equitySeed } : {}),
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

    const bondSeed = overrides?.seedAllocation
      ? Object.fromEntries(
          tickers
            .filter(t => (overrides.seedAllocation![t] ?? 0) > 0)
            .map(t => [t, overrides.seedAllocation![t]]),
        )
      : undefined;
    const weights = optimizeSharpeWeights(tickers, returns, riskFreeRate, {
      maxWeightPerPosition,
      iterations: 400,
      minWeight: 0.03,
      regularization: bondSeed ? 0.15 : 0,
      ...(bondSeed && Object.keys(bondSeed).length > 0 ? { seedWeights: bondSeed } : {}),
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

  // ── Enforce overlap pairs (merge deprecated ticker weight into preferred) ──
  const deduped = enforceOverlapPairs(slices);

  // ── Normalize ─────────────────────────────────────────────────────────────
  const total = deduped.reduce((s, x) => s + x.weight, 0);
  if (total > 0) deduped.forEach(s => { s.weight = s.weight / total; });

  // ── Enforce per-ETF caps (e.g. AVUV ≤ 15%, MTUM ≤ 8%, IAU ≤ 5%) ─────────
  let result = enforceETFCaps(deduped);

  // ── Enforce core-satellite (broad-market core ≥ 50% of equity sleeve) ─────
  result = enforceCoreSatellite(result, capturedEquityTarget);

  // ── Re-normalize after cap adjustments ───────────────────────────────────
  const adjTotal = result.reduce((s, x) => s + x.weight, 0);
  if (adjTotal > 0) result.forEach(s => { s.weight = s.weight / adjTotal; });

  const sum = result.reduce((s, x) => s + x.weight, 0);
  if (Math.abs(sum - 1.0) > 0.01) {
    throw new Error(`portfolioRules: weights sum to ${sum.toFixed(4)}, expected 1.0 ±0.01`);
  }

  // ── Consolidate to 3–6 holdings with ≥ 10% each ──────────────────────────
  // 10% minimum matches baseline seed minimums so factor tilts (AVUV, AVDV)
  // and diversifiers (VXUS, SCHP) are not absorbed into dominant positions.
  result = consolidatePortfolio(result, 6, 0.10);

  // ── Re-normalize after consolidation ─────────────────────────────────────
  const finalTotal = result.reduce((s, x) => s + x.weight, 0);
  if (finalTotal > 0) result.forEach(s => { s.weight = s.weight / finalTotal; });

  // ── Round to nearest 5% (largest-remainder) ───────────────────────────────
  return roundWeightsToFive(result);
}
