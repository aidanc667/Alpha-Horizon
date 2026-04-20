import { ETF_BY_TICKER } from '@/lib/data/etfUniverse';
import type {
  Agent1Output,
  Agent3Output,
  Agent4Output,
  RiskCheck,
  RiskCheckLevel,
} from './types';

// ─── Drawdown tolerance thresholds by riskCapacity ────────────────────────────
const MAX_DRAWDOWN_BY_CAPACITY: Record<string, number> = {
  low:    0.15,  // conservative — can absorb up to −15%
  medium: 0.30,  // moderate     — can absorb up to −30%
  high:   0.50,  // aggressive   — can absorb up to −50%
};

// ─── US equity tickers (ETFCategory === 'us_equity') ─────────────────────────
// Drives the geography concentration check without importing the full array.
const US_EQUITY_TICKERS = new Set(['VTI', 'AVUV', 'SCHD', 'QQQM', 'MTUM']);

// ─── Helper ───────────────────────────────────────────────────────────────────

function check(name: string, level: RiskCheckLevel, detail: string): RiskCheck {
  return { name, level, detail };
}

// ─── Agent 4: Risk Analysis ───────────────────────────────────────────────────

/**
 * Deterministic portfolio risk analysis. No LLM, no I/O. Target: <10ms.
 *
 * Runs 5 risk dimensions and aggregates them into a single verdict:
 *   1. Concentration risk (single position & top-3 weight)
 *   2. Correlation / geography & asset-class concentration
 *   3. Drawdown analysis vs. client riskCapacity
 *   4. Volatility vs. riskScore mismatch
 *   5. Liquidity adequacy
 */
export function agent4_riskAnalysis(input: {
  portfolio: Agent3Output;
  clientProfile: Agent1Output;
}): Agent4Output {
  const startTime = Date.now();

  const { portfolio, clientProfile } = input;
  const { allocation, statistics } = portfolio;
  const { riskProfile, liquidityNeeds, timeHorizon } = clientProfile;

  const checks: RiskCheck[] = [];
  const warnings: string[] = [];

  // ── 1. Concentration risk ─────────────────────────────────────────────────
  const sorted = [...allocation].sort((a, b) => b.weight - a.weight);
  const maxWeight = sorted[0]?.weight ?? 0;
  const top3Weight = sorted.slice(0, 3).reduce((s, x) => s + x.weight, 0);
  const maxTicker = sorted[0]?.ticker ?? '';

  if (maxWeight > 0.35) {
    const msg = `${maxTicker} is ${(maxWeight * 100).toFixed(0)}% of the portfolio — exceeds 35% single-position limit.`;
    checks.push(check('concentration', 'flag', msg));
    warnings.push(msg);
  } else if (maxWeight > 0.25) {
    const msg = `${maxTicker} is ${(maxWeight * 100).toFixed(0)}% of the portfolio — consider trimming below 25%.`;
    checks.push(check('concentration', 'warn', msg));
    warnings.push(msg);
  } else {
    checks.push(check('concentration', 'pass', ''));
  }

  if (top3Weight > 0.70) {
    const names = sorted.slice(0, 3).map((s) => s.ticker).join(', ');
    const msg = `Top 3 positions (${names}) account for ${(top3Weight * 100).toFixed(0)}% — portfolio is highly concentrated.`;
    checks.push(check('top3_concentration', 'warn', msg));
    warnings.push(msg);
  } else {
    checks.push(check('top3_concentration', 'pass', ''));
  }

  // ── 2. Correlation / geography & asset-class concentration ────────────────
  const totalWeight = allocation.reduce((s, x) => s + x.weight, 0) || 1;

  const usPct = allocation
    .filter((s) => US_EQUITY_TICKERS.has(s.ticker))
    .reduce((s, x) => s + x.weight, 0) / totalWeight;

  const intlPct = allocation
    .filter((s) => {
      const meta = ETF_BY_TICKER[s.ticker];
      return meta?.category === 'intl_equity';
    })
    .reduce((s, x) => s + x.weight, 0) / totalWeight;

  if (usPct > 0.80) {
    const msg = `${(usPct * 100).toFixed(0)}% allocated to US equities — consider adding international diversification.`;
    checks.push(check('geography', 'warn', msg));
    warnings.push(msg);
  } else if (intlPct > 0.80) {
    const msg = `${(intlPct * 100).toFixed(0)}% allocated to international equities — heavy non-US concentration.`;
    checks.push(check('geography', 'warn', msg));
    warnings.push(msg);
  } else {
    checks.push(check('geography', 'pass', ''));
  }

  // Asset-class concentration by AllocationCategory
  const categoryTotals = new Map<string, number>();
  for (const s of allocation) {
    categoryTotals.set(s.category, (categoryTotals.get(s.category) ?? 0) + s.weight);
  }
  const maxCategoryPct = Math.max(...categoryTotals.values()) / totalWeight;

  if (maxCategoryPct > 0.90) {
    const dominantCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const msg = `${(maxCategoryPct * 100).toFixed(0)}% in a single asset class (${dominantCategory}) — dangerously undiversified.`;
    checks.push(check('asset_class', 'warn', msg));
    warnings.push(msg);
  } else {
    checks.push(check('asset_class', 'pass', ''));
  }

  // ── 3. Drawdown analysis vs. riskCapacity ─────────────────────────────────
  const maxDrawdown = statistics.maxDrawdownEstimate; // positive decimal e.g. 0.28
  const capacityThreshold = MAX_DRAWDOWN_BY_CAPACITY[riskProfile.riskCapacity] ?? 0.30;

  if (maxDrawdown > capacityThreshold) {
    const msg = `Estimated max drawdown (${(maxDrawdown * 100).toFixed(0)}%) exceeds your ${riskProfile.riskCapacity}-capacity threshold (${(capacityThreshold * 100).toFixed(0)}%).`;
    checks.push(check('drawdown', 'flag', msg));
    warnings.push(msg);
  } else {
    checks.push(check('drawdown', 'pass', ''));
  }

  // ── 4. Volatility vs. riskScore mismatch ─────────────────────────────────
  const vol = statistics.expectedVolatility;
  const score = riskProfile.riskScore;

  let volMismatch = false;
  let volMsg = '';

  if (score <= 3 && vol > 0.12) {
    volMismatch = true;
    volMsg = `Portfolio volatility (${(vol * 100).toFixed(0)}%) is too high for a conservative risk score of ${score} — target <12%.`;
  } else if (score <= 6 && vol > 0.18) {
    volMismatch = true;
    volMsg = `Portfolio volatility (${(vol * 100).toFixed(0)}%) exceeds the moderate-profile ceiling of 18% for risk score ${score}.`;
  }

  if (volMismatch) {
    checks.push(check('volatility', 'warn', volMsg));
    warnings.push(volMsg);
  } else {
    checks.push(check('volatility', 'pass', ''));
  }

  // ── 5. Liquidity adequacy ─────────────────────────────────────────────────
  const cashPct = allocation
    .filter((s) => s.category === 'safety')
    .reduce((s, x) => s + x.weight, 0);

  if (liquidityNeeds.monthsRequired > 6 && cashPct < 0.10) {
    const msg = `You need ${liquidityNeeds.monthsRequired} months of cash reserves but the portfolio holds only ${(cashPct * 100).toFixed(0)}% in liquid assets — increase cash sleeve to ≥10%.`;
    checks.push(check('liquidity', 'warn', msg));
    warnings.push(msg);
  } else {
    checks.push(check('liquidity', 'pass', ''));
  }

  if (liquidityNeeds.plannedExpense != null && timeHorizon.yearsToGoal < 3) {
    const conservativePct = allocation
      .filter((s) => s.category === 'income' || s.category === 'safety')
      .reduce((s, x) => s + x.weight, 0);

    if (conservativePct < 0.50) {
      const msg = `A large planned expense is due within ${timeHorizon.yearsToGoal} year(s) but bonds + cash total only ${(conservativePct * 100).toFixed(0)}% — consider shifting ≥50% to capital-stable assets.`;
      checks.push(check('planned_expense', 'flag', msg));
      warnings.push(msg);
    } else {
      checks.push(check('planned_expense', 'pass', ''));
    }
  }

  // ── Aggregate verdict ─────────────────────────────────────────────────────
  const hasFlag = checks.some((c) => c.level === 'flag');
  const hasWarn = checks.some((c) => c.level === 'warn');
  const riskLevel = hasFlag ? 'high' : hasWarn ? 'medium' : 'low';
  const passesRiskCheck = !hasFlag;

  const executionTimeMs = Date.now() - startTime;
  console.log(`Agent 4: ${executionTimeMs}ms - ${warnings.length} warnings`);

  return {
    agentName: 'riskAnalysis',
    timestamp: new Date().toISOString(),
    executionTimeMs,
    riskLevel,
    warnings,
    passesRiskCheck,
    checks,
    performance: {
      targetLatencyMs: 10,
      actualLatencyMs: executionTimeMs,
      withinSLA: executionTimeMs <= 10,
    },
  };
}
