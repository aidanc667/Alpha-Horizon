import { deriveTargetAllocation, selectETFsForAllocation } from './portfolioRules';
import { calculateAllETFReturns, calculateETFVolatility } from '@/lib/data/calculateETFReturns';
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

  // ── Step 2: Select ETFs via lookup tables (<10ms) ─────────────────────────
  const allocation = selectETFsForAllocation(
    equityTarget,
    bondTarget,
    cashTarget,
    clientProfile.riskProfile.riskScore,
    clientProfile.taxProfile.combinedMarginalRate,
    clientProfile.accountStructure.availableAccounts,
  );

  // ── Step 3: Portfolio statistics ──────────────────────────────────────────
  const taxBracket = clientProfile.taxProfile.combinedMarginalRate;
  const etfReturns = calculateAllETFReturns(taxBracket);

  // Weighted-average expected return
  const expectedReturn = allocation.reduce(
    (sum, s) => sum + s.weight * (etfReturns[s.ticker] ?? 0),
    0,
  );

  // Simplified volatility: √(Σ wᵢ² σᵢ²)  — no cross-correlations (MVP)
  const variance = allocation.reduce((sum, s) => {
    const vol = calculateETFVolatility(s.ticker);
    return sum + s.weight * s.weight * vol * vol;
  }, 0);
  const expectedVolatility = Math.sqrt(variance);

  // Sharpe ratio
  const riskFreeRate = economicIntel.assetClassOutlook.riskFreeRate;
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
