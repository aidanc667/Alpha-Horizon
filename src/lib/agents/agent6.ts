import { buildDrawdownThresholds } from './agent4';
import type {
  Agent1Output,
  Agent3Output,
  Agent4Output,
  Agent5Output,
  Agent6Output,
  CriticScores,
} from './types';

// ─── Scoring weights ──────────────────────────────────────────────────────────

const WEIGHTS = {
  alignment:      0.25,
  diversification: 0.20,
  taxEfficiency:  0.20,
  costEfficiency: 0.15,
  riskManagement: 0.20,
} as const;

// ─── Dimension scorers ────────────────────────────────────────────────────────

function scoreAlignment(portfolio: Agent3Output, client: Agent1Output): number {
  let score = 100;

  // Risk score vs actual portfolio volatility
  const vol = portfolio.statistics.expectedVolatility;
  const riskScore = client.riskProfile.riskScore;
  const volOk =
    (riskScore <= 3 && vol <= 0.12) ||
    (riskScore <= 6 && vol <= 0.18) ||
    riskScore >= 7;
  if (!volOk) score -= 10;

  // Time horizon vs equity allocation
  const equityPct = portfolio.allocation
    .filter((s) => s.category === 'growth')
    .reduce((sum, s) => sum + s.weight, 0);
  const years = client.timeHorizon.yearsToGoal;
  if (years < 5 && equityPct > 0.50) score -= 10;
  if (years < 10 && equityPct > 0.70) score -= 10;

  // Goal feasibility
  const { feasibility } = client.goalAnalysis;
  if (feasibility === 'requires_adjustment') score -= 10;
  else if (feasibility === 'stretch') score -= 5;

  // Drawdown phase guard
  if (client.timeHorizon.isInDrawdownPhase && equityPct > 0.40) score -= 10;

  return Math.max(0, score);
}

function scoreDiversification(portfolio: Agent3Output): number {
  let score = 100;
  const { allocation } = portfolio;

  // Holding count — 5-7 is optimal
  const n = allocation.length;
  if (n < 4) score -= 20;
  else if (n < 5 || n > 8) score -= 10;

  // Single-position concentration
  const maxWeight = Math.max(...allocation.map((s) => s.weight));
  if (maxWeight > 0.40) score -= 20;
  else if (maxWeight > 0.30) score -= 10;

  // Top-3 concentration
  const sorted = [...allocation].sort((a, b) => b.weight - a.weight);
  const top3 = sorted.slice(0, 3).reduce((sum, s) => sum + s.weight, 0);
  if (top3 > 0.75) score -= 15;
  else if (top3 > 0.65) score -= 5;

  // Category spread — penalise missing income or safety sleeves
  const categories = new Set(allocation.map((s) => s.category));
  if (!categories.has('income') && !categories.has('safety')) score -= 10;

  return Math.max(0, score);
}

function scoreTaxEfficiency(
  portfolio: Agent3Output,
  client: Agent1Output,
  tax: Agent5Output,
): number {
  let score = 0;
  const heldTickers = new Set(portfolio.allocation.map((s) => s.ticker));
  const combinedRate = client.taxProfile.combinedMarginalRate;
  const hasTaxable = client.accountStructure.availableAccounts.some((a) =>
    /taxable|brokerage/i.test(a),
  );

  // Muni bonds used when bracket warrants it (+20)
  if (combinedRate >= 0.24 && hasTaxable) {
    score += heldTickers.has('VTEB') ? 20 : 0;
  } else {
    score += 20; // not applicable — full credit
  }

  // Asset location optimized (+30) — deduct proportionally for misplacements
  const locationRec = tax.recommendations.find((r) => r.type === 'asset_location');
  const isLocationOptimized =
    !locationRec || locationRec.title.toLowerCase().includes('already optimized');
  score += isLocationOptimized ? 30 : 15;

  // TLH pairs available (+20)
  score += tax.tlhPairs.length > 0 ? 20 : 10;

  // Low-turnover ETFs (+30) — proxy: no actively managed high-ER funds
  const weightedER = portfolio.statistics.weightedExpenseRatio;
  score += weightedER < 0.003 ? 30 : weightedER < 0.005 ? 20 : 10;

  return Math.min(100, score);
}

function scoreCostEfficiency(portfolio: Agent3Output): number {
  // 100 at ≤0.20% ER; -20 per 0.05% above that
  const er = portfolio.statistics.weightedExpenseRatio;
  const excessBps = Math.max(0, er - 0.002) / 0.0005; // each 0.05% above 0.20%
  return Math.max(0, Math.round(100 - excessBps * 20));
}

function scoreRiskManagement(
  portfolio: Agent3Output,
  client: Agent1Output,
  risk: Agent4Output,
  marketContext?: { regime: string; cape: number },
): number {
  // Start from warning count (0 warnings = 100, each -20)
  let score = Math.max(0, 100 - risk.warnings.length * 20);

  // Drawdown acceptability (±20) — uses same regime-adjusted thresholds as agent4
  // so the critic never disagrees with the risk agent on whether drawdown is acceptable.
  const drawdown = portfolio.statistics.maxDrawdownEstimate;
  const thresholds = buildDrawdownThresholds(
    marketContext?.regime ?? 'risk_on',
    marketContext?.cape   ?? 25,
  );
  const threshold = thresholds[client.riskProfile.riskCapacity] ?? 0.30;
  if (drawdown <= threshold * 0.80) score = Math.min(100, score + 20); // comfortably within
  else if (drawdown > threshold)    score = Math.max(0,   score - 20); // over limit

  return score;
}

// ─── Improvement suggestions ──────────────────────────────────────────────────

function topSuggestions(
  scores: Omit<CriticScores, 'overall'>,
  portfolio: Agent3Output,
  tax: Agent5Output,
): string[] {
  const ranked = (
    [
      ['alignment',       scores.alignment],
      ['diversification', scores.diversification],
      ['taxEfficiency',   scores.taxEfficiency],
      ['costEfficiency',  scores.costEfficiency],
      ['riskManagement',  scores.riskManagement],
    ] as [string, number][]
  )
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3);

  return ranked.map(([dim]) => {
    switch (dim) {
      case 'alignment':
        return 'Adjust equity allocation to better match your risk score and time horizon.';
      case 'diversification': {
        const maxSlice = [...portfolio.allocation].sort((a, b) => b.weight - a.weight)[0];
        return `Reduce ${maxSlice?.ticker ?? 'top holding'} concentration — spread weight across more positions.`;
      }
      case 'taxEfficiency': {
        const topTaxRec = tax.recommendations[0];
        return topTaxRec
          ? topTaxRec.title
          : 'Review asset location and consider tax-exempt bonds for taxable accounts.';
      }
      case 'costEfficiency':
        return `Weighted expense ratio is ${(portfolio.statistics.weightedExpenseRatio * 100).toFixed(2)}% — replace any high-cost funds with lower-cost equivalents.`;
      case 'riskManagement':
        return 'Address risk warnings: review position concentration and drawdown exposure.';
      default:
        return 'Review portfolio construction for improvement opportunities.';
    }
  });
}

// ─── Agent 6: Critic ──────────────────────────────────────────────────────────

/**
 * Deterministic portfolio critic. No LLM, no I/O. Target: <20ms.
 *
 * Scores five dimensions, computes a weighted composite, and decides whether
 * the pipeline should trigger a revision pass (MVP: always false).
 */
export function agent6_critic(input: {
  portfolio: Agent3Output;
  clientProfile: Agent1Output;
  riskAnalysis: Agent4Output;
  taxOptimization: Agent5Output;
  marketContext?: { regime: string; cape: number };
}): Agent6Output {
  const startTime = Date.now();

  const { portfolio, clientProfile, riskAnalysis, taxOptimization } = input;

  const alignment      = scoreAlignment(portfolio, clientProfile);
  const diversification = scoreDiversification(portfolio);
  const taxEfficiency  = scoreTaxEfficiency(portfolio, clientProfile, taxOptimization);
  const costEfficiency = scoreCostEfficiency(portfolio);
  const riskManagement = scoreRiskManagement(portfolio, clientProfile, riskAnalysis, input.marketContext);

  const overall = Math.round(
    alignment      * WEIGHTS.alignment      +
    diversification * WEIGHTS.diversification +
    taxEfficiency  * WEIGHTS.taxEfficiency  +
    costEfficiency * WEIGHTS.costEfficiency +
    riskManagement * WEIGHTS.riskManagement,
  );

  const scores: CriticScores = {
    alignment, diversification, taxEfficiency, costEfficiency, riskManagement, overall,
  };

  const passesThreshold  = overall >= 85;
  const requiresRevision = !passesThreshold;

  const improvementSuggestions = passesThreshold
    ? []
    : topSuggestions({ alignment, diversification, taxEfficiency, costEfficiency, riskManagement }, portfolio, taxOptimization);

  const executionTimeMs = Date.now() - startTime;
  console.log(
    `Agent 6: ${executionTimeMs}ms - Score: ${overall}/100 ${requiresRevision ? 'REVISION NEEDED' : 'APPROVED'}`,
  );

  return {
    agentName: 'critic',
    timestamp: new Date().toISOString(),
    executionTimeMs,
    scores,
    requiresRevision,
    passesThreshold,
    improvementSuggestions,
    performance: {
      targetLatencyMs: 20,
      actualLatencyMs: executionTimeMs,
      withinSLA: executionTimeMs <= 20,
    },
  };
}
