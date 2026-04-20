import type {
  Agent1Output,
  Agent3Output,
  Agent5Output,
  TaxRecommendation,
} from './types';

// ─── Static data ──────────────────────────────────────────────────────────────

/** Tax-loss harvesting substitute pairs (held → wash-sale-safe swap). */
const TLH_PAIRS: { ticker: string; substitute: string }[] = [
  { ticker: 'VTI',  substitute: 'SCHD'  }, // US equity
  { ticker: 'VXUS', substitute: 'VEA'   }, // international
  { ticker: 'AVUV', substitute: 'DFSV'  }, // small-cap value
  { ticker: 'BND',  substitute: 'VGIT'  }, // investment-grade bonds
];

/** Ideal account placement by ticker (matches portfolioRules logic). */
const IDEAL_PLACEMENT: Record<string, string> = {
  VTEB: 'taxable', CMF: 'taxable',
  VTI:  'taxable', VXUS: 'taxable', SGOV: 'taxable',
  AVUV: 'roth', AVDV: 'roth', VWO: 'roth',
  BND:  'traditional', SCHD: 'traditional',
};

// Reference yields for savings calculations
const VTEB_NOMINAL_YIELD = 0.032;
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

  const combinedRate  = taxProfile.combinedMarginalRate;
  const accounts      = accountStructure.availableAccounts;
  const hasTaxable    = accounts.some((a) => /taxable|brokerage/i.test(a));
  const hasRoth       = accounts.some((a) => /roth/i.test(a));
  const hasTraditional = accounts.some((a) => /traditional|401k|ira/i.test(a));

  const heldTickers = new Set(allocation.map((s) => s.ticker));
  const recommendations: TaxRecommendation[] = [];

  // ── 1. Muni bond check ────────────────────────────────────────────────────
  if (combinedRate >= 0.24 && hasTaxable) {
    // After-tax comparison: VTEB nominal vs BND × (1 − rate)
    const muniAdvantage = VTEB_NOMINAL_YIELD - BND_YIELD * (1 - combinedRate);
    const muniSavingsBps = Math.max(0, Math.round(muniAdvantage * 10_000));

    if (heldTickers.has('BND') && !heldTickers.has('VTEB')) {
      // Portfolio holds BND but qualifies for munis
      const teyPct = ((VTEB_NOMINAL_YIELD / (1 - combinedRate)) * 100).toFixed(1);
      recommendations.push({
        type: 'muni_bond',
        priority: 'high',
        title: 'Switch BND → VTEB in taxable account',
        detail: `At your ${(combinedRate * 100).toFixed(0)}% combined rate, VTEB's ${(VTEB_NOMINAL_YIELD * 100).toFixed(1)}% tax-exempt yield equals a ${teyPct}% taxable equivalent — ${muniAdvantage >= 0 ? 'above' : 'near'} BND's ${(BND_YIELD * 100).toFixed(1)}% yield.`,
        estimatedSavingsBps: muniSavingsBps,
      });
    } else if (heldTickers.has('VTEB')) {
      const teyPct = ((VTEB_NOMINAL_YIELD / (1 - combinedRate)) * 100).toFixed(1);
      recommendations.push({
        type: 'muni_bond',
        priority: 'low',
        title: 'VTEB already optimized for your bracket',
        detail: `VTEB's ${teyPct}% tax-equivalent yield is appropriate for your ${(combinedRate * 100).toFixed(0)}% combined rate.`,
        estimatedSavingsBps: muniSavingsBps,
      });
    }
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
    taxProfile.federalMarginalRate < 0.24 &&
    timeHorizon.yearsToGoal > 15;

  if (hasConversionOpportunity) {
    const conversionSavingsBps = 40; // Conservative estimate for bracket arbitrage
    recommendations.push({
      type: 'roth_conversion',
      priority: 'high',
      title: 'Roth conversion window open',
      detail: `You're in the ${(taxProfile.federalMarginalRate * 100).toFixed(0)}% federal bracket with ${timeHorizon.yearsToGoal} years until your goal. Converting traditional IRA funds to Roth now locks in the lower rate and eliminates future RMDs. Consider converting annually up to the top of your current bracket.`,
      estimatedSavingsBps: conversionSavingsBps,
    });
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
