import { deriveTargetAllocation, selectETFsForAllocation } from './portfolioRules';
import { calculateAllETFReturns, calculateETFVolatility } from '@/lib/data/calculateETFReturns';
import { computePortfolioVol } from './sharpeOptimizer';
import { ETF_UNIVERSE } from '@/lib/data/etfUniverse';
import type { Agent1Output, Agent2Output, Agent3Output, EtfRationaleEntry } from './types';

// O(1) expense ratio lookup — built once, shared across the function
const ETF_ER = Object.fromEntries(ETF_UNIVERSE.map((e) => [e.ticker, e.expenseRatio]));

// ─── Agent 3: Portfolio Construction ─────────────────────────────────────────

/**
 * Deterministic portfolio construction agent.
 * Runs entirely in-process — no LLM call, no I/O. Target: <30ms.
 *
 * Pipeline:
 *   1. Derive equity/bond/cash split from client profile
 *   2. Select specific ETFs via lookup-table templates
 *   3. Compute portfolio statistics (return, vol, Sharpe, drawdown, ER)
 *   4. Generate per-holding rationale strings
 */
export function agent3_portfolioConstruction(input: {
  clientProfile: Agent1Output;
  economicIntel: Agent2Output;
}): Agent3Output {
  const startTime = Date.now();

  const { clientProfile, economicIntel } = input;

  // ── Step 1: Derive target allocation split (deterministic, <1ms) ──────────
  //
  // hasEmergencyFund: not a direct field on Agent1Output.liquidityNeeds —
  // infer from monthsRequired: 0 means no additional liquidity sleeve needed,
  // i.e. the client already has an emergency fund outside this portfolio.
  const hasEmergencyFund = clientProfile.liquidityNeeds.monthsRequired === 0;

  const { equityTarget, bondTarget, cashTarget } = deriveTargetAllocation(
    clientProfile.riskProfile.riskScore,
    clientProfile.timeHorizon.yearsToGoal,
    economicIntel.regime.current,
    clientProfile.goalAnalysis.fundedStatus,
    hasEmergencyFund,
  );

  // ── Step 2: Select ETFs via optimizer (<50ms) ────────────────────────────
  const riskFreeRate = economicIntel.assetClassOutlook.riskFreeRate;

  // Live market rates from FRED (via agent2) — anchors bond/cash returns to
  // current yields instead of static 2026 CMA baseline.
  const marketRates = {
    riskFreeRate,
    fedFundsRate: economicIntel.macroData.fedFundsRate,
    // CAPE + CPI enable the live equity build-up model in calculateETFReturns:
    //   US equity expected return = (1/CAPE) + 1.0% real growth + CPI + class premium
    // At current CAPE=32, CPI=2.8% this reproduces the 2026 institutional CMAs exactly.
    // As CAPE/CPI move, every US equity ETF's expected return updates automatically.
    shillerCAPE: economicIntel.macroData.shillerCAPE,
    cpiYoY:      economicIntel.macroData.cpiYoY,
  };

  const allocation = selectETFsForAllocation(
    equityTarget,
    bondTarget,
    cashTarget,
    clientProfile.riskProfile.riskScore,
    clientProfile.taxProfile.combinedMarginalRate,
    clientProfile.accountStructure.availableAccounts,
    riskFreeRate,
    marketRates,
  );

  // ── Step 3: Portfolio statistics ──────────────────────────────────────────
  const taxBracket = clientProfile.taxProfile.combinedMarginalRate;
  // Same market-grounded rates used here so expected-return stats are consistent
  // with the optimizer inputs that selected the holdings.
  const etfReturns = calculateAllETFReturns(taxBracket, marketRates);

  // Weighted-average expected return
  const expectedReturn = allocation.reduce(
    (sum, s) => sum + s.weight * (etfReturns[s.ticker] ?? 0),
    0,
  );

  // True portfolio volatility via full covariance matrix (σᵢσⱼρᵢⱼ correlations)
  const expectedVolatility = computePortfolioVol(allocation);

  // Sharpe ratio
  const sharpeRatio =
    expectedVolatility > 0 ? (expectedReturn - riskFreeRate) / expectedVolatility : 0;

  // Max drawdown estimate — positive decimal (0.28 = −28% peak-to-trough)
  const equityPct = allocation
    .filter((s) => s.category === 'growth')
    .reduce((sum, s) => sum + s.weight, 0);
  const bondPct = allocation
    .filter((s) => s.category === 'income')
    .reduce((sum, s) => sum + s.weight, 0);
  const cashPct = allocation
    .filter((s) => s.category === 'safety')
    .reduce((sum, s) => sum + s.weight, 0);
  const maxDrawdownEstimate = Math.abs(
    -0.55 * equityPct - 0.15 * bondPct - 0.01 * cashPct,
  );

  // Asset-weighted expense ratio
  const weightedExpenseRatio = allocation.reduce(
    (sum, s) => sum + s.weight * (ETF_ER[s.ticker] ?? 0),
    0,
  );

  // ── Step 4: Per-holding rationale ─────────────────────────────────────────
  const etfRationale: Record<string, EtfRationaleEntry> = {};

  for (const slice of allocation) {
    let rationale: string;

    switch (slice.ticker) {
      case 'VOO':
        rationale = `S&P 500 ETF covering the 500 largest US companies. At the current Shiller CAPE of ${economicIntel.macroData.shillerCAPE}, the earnings yield (${(100 / economicIntel.macroData.shillerCAPE).toFixed(1)}%) signals an expected return of ${(etfReturns['VOO'] * 100).toFixed(1)}%. Same 0.03% ER as VTI but without the small-cap sleeve.`;
        break;
      case 'VT':
        rationale = `Total world stock ETF combining ~60% US and ~40% international in a single fund. International markets trade at a significant valuation discount to US (lower CAPE → higher earnings yield), contributing to the ${(etfReturns['VT'] * 100).toFixed(1)}% blended expected return. One-fund global diversification at 0.07% ER.`;
        break;
      case 'VTI':
        rationale =
          'US total market core holding providing broad diversification across 3,500+ stocks. Low-cost (0.03% ER) and tax-efficient.';
        break;
      case 'AVUV':
        rationale = `Small-cap value ETF targeting the highest expected returns (${(etfReturns['AVUV'] * 100).toFixed(1)}% CMA). Provides size and value factor premiums historically validated by Fama-French.`;
        break;
      case 'SCHD':
        rationale =
          'Quality dividend equity screening for high-yielding, fundamentally sound companies. Adds value and quality factor tilts with lower drawdowns than broad market.';
        break;
      case 'VXUS':
        rationale =
          'Total international stock providing geographic diversification beyond US markets. Reduces portfolio concentration and captures valuation discount in developed and emerging markets.';
        break;
      case 'AVDV':
        rationale = `International small-cap value ETF targeting the highest expected returns in the intl universe (${(etfReturns['AVDV'] * 100).toFixed(1)}% CMA). Adds both size and value premiums across non-US markets.`;
        break;
      case 'VWO':
        rationale =
          'Emerging markets exposure capturing higher structural growth and deeper valuation discounts relative to developed markets. Kept at a small satellite weight to manage EM volatility.';
        break;
      case 'BND':
        rationale =
          'US investment-grade bond core providing stability and income. Low correlation with equities cushions the portfolio during equity drawdowns.';
        break;
      case 'VTEB':
        rationale = `Tax-exempt municipal bonds. At your ${(taxBracket * 100).toFixed(0)}% combined rate, the ${(etfReturns['VTEB'] * 100).toFixed(1)}% tax-equivalent yield exceeds equivalent taxable bonds.`;
        break;
      case 'SGOV':
        rationale =
          'Treasury bills providing liquidity and capital preservation for short-term needs. Earns the risk-free rate with near-zero volatility and is held outside your emergency fund.';
        break;
      case 'VEA':
        rationale =
          'Developed markets ex-US providing international diversification at lower volatility than VXUS by excluding emerging market exposure. Captures valuation discount in European and Japanese markets.';
        break;
      case 'MTUM':
        rationale = `Momentum factor ETF overweighting recent 12-month winners (${(etfReturns['MTUM'] * 100).toFixed(1)}% CMA). Quarterly rebalance captures trend persistence — held in Roth to minimize turnover tax drag.`;
        break;
      case 'VNQ':
        rationale =
          'US REIT ETF providing real estate exposure and inflation linkage. Low correlation with bonds and partial equity diversification; REIT dividends are ordinary income so always held in tax-deferred accounts.';
        break;
      case 'IAU':
        rationale =
          'Gold bullion ETF serving as a tail-risk hedge and inflation store of value. Near-zero correlation with equities in normal markets; historically spikes during stress events and currency crises.';
        break;
      case 'SCHP':
        rationale = `TIPS ETF providing inflation-linked real return (${(etfReturns['SCHP'] * 100).toFixed(1)}% CMA). Phantom income from inflation accruals makes it unsuitable for taxable accounts — held in tax-deferred only.`;
        break;
      case 'VCIT':
        rationale = `Intermediate investment-grade corporate bonds adding a credit premium above Treasuries (${(etfReturns['VCIT'] * 100).toFixed(1)}% CMA). Corporate coupon income is taxable as ordinary income — tax-deferred placement required.`;
        break;
      case 'HYG':
        rationale = `High-yield corporate bond ETF targeting the credit risk premium (${(etfReturns['HYG'] * 100).toFixed(1)}% CMA). Equity-like behavior in stress periods; ordinary income distributions make taxable placement inefficient.`;
        break;
      case 'BNDX':
        rationale =
          'Currency-hedged international investment-grade bonds adding geographic diversification to the bond sleeve. Low correlation with US bonds; hedging cost is reflected in the lower expected return.';
        break;
      case 'VPU':
        rationale =
          'US utilities sector ETF providing defensive equity exposure with low beta (~0.5). Regulated monopoly cash flows offer stability; partial ordinary income from rate-regulated profits warrants tax-deferred placement.';
        break;
      default:
        rationale = `${slice.ticker} — expected return: ${((etfReturns[slice.ticker] ?? 0) * 100).toFixed(1)}%, weight: ${(slice.weight * 100).toFixed(1)}%.`;
    }

    etfRationale[slice.ticker] = {
      allocation: slice.weight,
      rationale,
      accountPlacement: slice.accountPlacement,
    };
  }

  // ── Telemetry & SLA logging ───────────────────────────────────────────────
  const executionTimeMs = Date.now() - startTime;

  console.log(`Agent 3: ${executionTimeMs}ms`);
  if (executionTimeMs > 50) {
    console.warn(`Agent 3 WARNING: exceeded 50ms SLA (${executionTimeMs}ms)`);
  }

  return {
    agentName: 'portfolioConstruction',
    timestamp: new Date().toISOString(),
    executionTimeMs,
    allocation,
    statistics: {
      expectedReturn,
      expectedVolatility,
      sharpeRatio,
      maxDrawdownEstimate,
      weightedExpenseRatio,
    },
    etfRationale,
    performance: {
      targetLatencyMs: 30,
      actualLatencyMs: executionTimeMs,
      withinSLA: executionTimeMs <= 30,
    },
  };
}
