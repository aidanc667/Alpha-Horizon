import { deriveMuniNominalYield, BASELINE_RF } from '@/lib/data/calculateETFReturns';
import type {
  Agent1Output,
  Agent3Output,
  Agent5Output,
  TaxRecommendation,
} from './types';

// ─── Static data ──────────────────────────────────────────────────────────────

/** Tax-loss harvesting substitute pairs (held → wash-sale-safe swap). */
const TLH_PAIRS: { ticker: string; substitute: string }[] = [
  { ticker: 'VTI',  substitute: 'ITOT'  }, // US equity — different index (S&P vs CRSP), not substantially identical
  { ticker: 'VXUS', substitute: 'VEA'   }, // international
  { ticker: 'AVUV', substitute: 'VBR'   }, // small-cap value — Vanguard index, not substantially identical to AQR
  { ticker: 'BND',  substitute: 'VGIT'  }, // investment-grade bonds
];

/** Ideal account placement by ticker (matches portfolioRules logic). */
const IDEAL_PLACEMENT: Record<string, string> = {
  VTEB: 'taxable', CMF: 'taxable',
  VTI:  'taxable', VXUS: 'taxable', SGOV: 'taxable',
  AVUV: 'roth', AVDV: 'roth', VWO: 'roth',
  BND:  'traditional', SCHD: 'traditional',
};

// Reference yields for savings calculations.
// VTEB_NOMINAL_YIELD is derived from the shared muni/treasury formula so it stays
// consistent with the yield used by calculateETFReturns (same ratio, same baseline rfr).
const VTEB_NOMINAL_YIELD = deriveMuniNominalYield(BASELINE_RF);
const BND_YIELD          = 0.050;

// ─── Agent 5: Tax Optimization ────────────────────────────────────────────────

/**
 * Deterministic tax optimization agent. No LLM, no I/O. Target: <15ms.
 *
 * Scans 4 tax dimensions:
 *   1. Muni bond suitability (VTEB vs BND at current bracket)
 *   2. Asset location — account placement vs ideal
 *   3. Tax-loss harvesting pairs available in the portfolio
 *   4. Roth conversion window (traditional balance + low bracket + long horizon)
 */
export function agent5_taxOptimization(input: {
  portfolio: Agent3Output;
  clientProfile: Agent1Output;
}): Agent5Output {
  const startTime = Date.now();

  const { portfolio, clientProfile } = input;
  const { allocation } = portfolio;
  const { taxProfile, accountStructure, timeHorizon } = clientProfile;

  const combinedRate    = taxProfile.combinedMarginalRate;
  const investmentRate  = taxProfile.investmentIncomeMarginalRate;
  const accounts      = accountStructure.availableAccounts;
  const hasTaxable    = accounts.some((a) => /taxable|brokerage/i.test(a));
  const hasRoth       = accounts.some((a) => /roth/i.test(a));
  const hasTraditional = accounts.some((a) => /traditional|401k|ira/i.test(a));

  const heldTickers = new Set(allocation.map((s) => s.ticker));
  const recommendations: TaxRecommendation[] = [];

  // ── 1. Muni bond check ────────────────────────────────────────────────────
  if (combinedRate >= 0.24 && hasTaxable) {
    // TEY uses investmentRate (includes 3.8% NIIT for high earners) so the
    // comparison reflects the investor's true cost of holding taxable bond income.
    const muniAdvantage  = VTEB_NOMINAL_YIELD - BND_YIELD * (1 - investmentRate);
    const muniSavingsBps = Math.max(0, Math.round(muniAdvantage * 10_000));

    if (heldTickers.has('BND') && !heldTickers.has('VTEB')) {
      const teyPct = ((VTEB_NOMINAL_YIELD / (1 - investmentRate)) * 100).toFixed(1);
      recommendations.push({
        type: 'muni_bond',
        priority: 'high',
        title: 'Switch BND → VTEB in taxable account',
        detail: `At your ${(combinedRate * 100).toFixed(0)}% combined rate, VTEB's ${(VTEB_NOMINAL_YIELD * 100).toFixed(1)}% tax-exempt yield equals a ${teyPct}% taxable equivalent — ${muniAdvantage >= 0 ? 'above' : 'near'} BND's ${(BND_YIELD * 100).toFixed(1)}% yield.`,
        estimatedSavingsBps: muniSavingsBps,
      });
    } else if (heldTickers.has('VTEB')) {
      const teyPct = ((VTEB_NOMINAL_YIELD / (1 - investmentRate)) * 100).toFixed(1);
      recommendations.push({
        type: 'muni_bond',
        priority: 'low',
        title: 'VTEB already optimized for your bracket',
        detail: `VTEB's ${teyPct}% tax-equivalent yield is appropriate for your ${(combinedRate * 100).toFixed(0)}% combined rate.`,
        estimatedSavingsBps: muniSavingsBps,
      });
    }
  }

  // ── 1b. State-muni upgrade (CMF for high state-tax investors) ────────────
  // CMF (iShares CA Muni) is exempt from both federal and CA state income tax;
  // VTEB is federal-only. At ≥7% state rate the extra exemption is material.
  if (taxProfile.stateMarginalRate >= 0.07 && hasTaxable && heldTickers.has('VTEB')) {
    const stateExemptSavingsBps = Math.round(taxProfile.stateMarginalRate * VTEB_NOMINAL_YIELD * 10_000);
    recommendations.push({
      type: 'muni_bond',
      priority: 'medium',
      title: 'Consider CMF for additional state-tax savings',
      detail: `Your state rate is ${(taxProfile.stateMarginalRate * 100).toFixed(1)}%. VTEB is federally exempt only; CMF (iShares CA Muni) also exempts California state income tax, saving an estimated ${stateExemptSavingsBps}bps annually on the bond sleeve. Consider blending VTEB + CMF rather than a full swap to retain geographic diversification.`,
      estimatedSavingsBps: stateExemptSavingsBps,
    });
  }

  // ── 2. Asset location optimization ───────────────────────────────────────
  const misplacedSlices = allocation.filter((s) => {
    const ideal = IDEAL_PLACEMENT[s.ticker];
    if (!ideal) return false;                                  // unknown ticker — skip
    if (ideal === 'roth' && !hasRoth) return false;           // can't improve without Roth
    if (ideal === 'traditional' && !hasTraditional) return false;
    return s.accountPlacement !== ideal;
  });

  if (misplacedSlices.length > 0) {
    const swaps = misplacedSlices
      .map((s) => `${s.ticker} (currently ${s.accountPlacement} → move to ${IDEAL_PLACEMENT[s.ticker]})`)
      .join('; ');
    // Location drag estimate: 30bps base + 10bps per additional misplaced position
    const locationSavingsBps = 30 + (misplacedSlices.length - 1) * 10;
    recommendations.push({
      type: 'asset_location',
      priority: misplacedSlices.length >= 2 ? 'high' : 'medium',
      title: `${misplacedSlices.length} holding(s) in suboptimal accounts`,
      detail: `Relocating improves after-tax return by shielding high-turnover and income-generating ETFs from taxable drag. Suggested swaps: ${swaps}.`,
      estimatedSavingsBps: locationSavingsBps,
    });
  } else {
    recommendations.push({
      type: 'asset_location',
      priority: 'low',
      title: 'Asset location is already optimized',
      detail: 'All holdings are placed in the most tax-efficient account type given your current account structure.',
      estimatedSavingsBps: 0,
    });
  }

  // ── 2b. Tax-drag warning for taxable-only investors ──────────────────────
  // SCHP (TIPS), VNQ (REITs), HYG (high yield), VCIT (IG corp) all generate
  // ordinary income; in a taxable-only account that income is fully taxable each year.
  const TAX_INEFFICIENT_TICKERS = ['SCHP', 'VNQ', 'HYG', 'VCIT'];
  const taxableOnlyDragTickers = (!hasRoth && !hasTraditional)
    ? allocation.filter((s) => TAX_INEFFICIENT_TICKERS.includes(s.ticker)).map((s) => s.ticker)
    : [];

  if (taxableOnlyDragTickers.length > 0) {
    const dragBps = taxableOnlyDragTickers.length * 15;
    recommendations.push({
      type: 'asset_location',
      priority: 'medium',
      title: `${taxableOnlyDragTickers.length} tax-inefficient holding(s) in taxable account`,
      detail: `${taxableOnlyDragTickers.join(', ')} generate ordinary income that is fully taxable each year in a brokerage account. Opening a traditional IRA or Roth IRA to shelter these positions would eliminate that annual drag. Estimated drag at current rates: ~${dragBps}bps/year.`,
      estimatedSavingsBps: dragBps,
    });
  }

  // ── 3. Tax-loss harvesting pairs ──────────────────────────────────────────
  const availablePairs = TLH_PAIRS.filter((p) => heldTickers.has(p.ticker));

  if (availablePairs.length > 0) {
    const pairList = availablePairs.map((p) => `${p.ticker} → ${p.substitute}`).join(', ');
    // TLH benefit: 50bps base, +10bps per additional pair (capped at 100bps)
    const tlhSavingsBps = Math.min(50 + (availablePairs.length - 1) * 10, 100);
    recommendations.push({
      type: 'tlh',
      priority: 'medium',
      title: `${availablePairs.length} tax-loss harvesting pair(s) available`,
      detail: `When these positions are at a loss, harvest and swap to a wash-sale-safe substitute for 30 days. Pairs: ${pairList}. Estimated annual benefit if actively harvested: ${tlhSavingsBps}bps.`,
      estimatedSavingsBps: tlhSavingsBps,
    });
  }

  // ── 4. Roth conversion analysis ───────────────────────────────────────────
  const traditionalBalance = accountStructure.existingBalances.traditional;
  const hasConversionOpportunity =
    traditionalBalance > 0 &&
    taxProfile.federalMarginalRate <= 0.24 &&
    timeHorizon.yearsToGoal > 15;

  if (hasConversionOpportunity) {
    const conversionSavingsBps = 40; // Conservative estimate for bracket arbitrage
    recommendations.push({
      type: 'roth_conversion',
      priority: 'high',
      title: 'Roth conversion window open',
      detail: `You're in the ${(taxProfile.federalMarginalRate * 100).toFixed(0)}% federal bracket with ${timeHorizon.yearsToGoal} years until your goal. Converting traditional IRA funds to Roth now locks in the lower rate and eliminates future RMDs. Consider converting annually up to the top of your current bracket. Note: a large single-year conversion may trigger Medicare IRMAA surcharges — consider spreading conversions across multiple years to stay below the Part B threshold (~$106K MAGI single / ~$212K MFJ in 2026). Source: CMS Medicare Part B IRMAA tables 2026.`,
      estimatedSavingsBps: conversionSavingsBps,
    });
  }

  // ── 5. HSA optimization ───────────────────────────────────────────────────
  // HSA = triple-tax advantage: pre-tax contribution + tax-free growth + tax-free
  // qualified medical withdrawal. Highest after-tax compounding of any US account type.
  const hsaBalance = accountStructure.existingBalances.hsa;
  const hasHSA = accounts.some((a) => /hsa/i.test(a));

  if (hasHSA || hsaBalance > 0) {
    const highGrowthInHSA = allocation.some(
      (s) => ['AVUV', 'AVDV', 'QQQM'].includes(s.ticker) && s.accountPlacement === 'hsa',
    );
    if (!highGrowthInHSA) {
      recommendations.push({
        type: 'asset_location',
        priority: 'high',
        title: 'Prioritize high-growth assets in HSA',
        detail: `Your HSA offers triple tax advantage: pre-tax contribution, tax-free growth, and tax-free qualified medical withdrawal — the highest after-tax compounding of any US account type. Placing high-expected-return ETFs (AVUV, AVDV) in the HSA maximizes this benefit. Max contributions first: $4,300 single / $8,550 family in 2026. Source: IRS Publication 969.`,
        estimatedSavingsBps: 25,
      });
    }
  }

  // ── Aggregate savings & finalize ──────────────────────────────────────────
  const estimatedAnnualSavings = recommendations.reduce(
    (sum, r) => sum + r.estimatedSavingsBps,
    0,
  );

  // Sort: high priority first, then by savings descending
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort(
    (a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      b.estimatedSavingsBps - a.estimatedSavingsBps,
  );

  const executionTimeMs = Date.now() - startTime;
  console.log(`Agent 5: ${executionTimeMs}ms - ${estimatedAnnualSavings}bps savings`);

  return {
    agentName: 'taxOptimization',
    timestamp: new Date().toISOString(),
    executionTimeMs,
    recommendations,
    estimatedAnnualSavings,
    tlhPairs: availablePairs,
    performance: {
      targetLatencyMs: 15,
      actualLatencyMs: executionTimeMs,
      withinSLA: executionTimeMs <= 15,
    },
  };
}
