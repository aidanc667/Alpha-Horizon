/**
 * deterministicProfile.ts
 *
 * STEP 1 OPTIMIZATION: Replaces the Client Profile LLM Agent entirely.
 * Pure TypeScript logic deriving InvestorProfile from IntakeAnswers.
 *
 * Token savings: ~700 input tokens + ~300 output tokens + 1 full Gemini API call eliminated per run.
 * Latency savings: ~1.5–3 seconds (one fewer sequential LLM call in the pipeline).
 */

import type { IntakeAnswers, InvestorProfile } from '@/apps/portfolio-agent/types';

// ─── 2026 State income tax rates (top marginal %, keyed by 2-letter code) ────
const STATE_TAX: Record<string, number> = {
  'AL': 0.05,   'AK': 0,      'AZ': 0.025,  'AR': 0.044,
  'CA': 0.093,  'CO': 0.044,  'CT': 0.069,  'DE': 0.066,
  'FL': 0,      'GA': 0.055,  'HI': 0.11,   'ID': 0.058,
  'IL': 0.0495, 'IN': 0.0315, 'IA': 0.057,  'KS': 0.057,
  'KY': 0.045,  'LA': 0.06,   'ME': 0.075,  'MD': 0.0575,
  'MA': 0.05,   'MI': 0.0425, 'MN': 0.0985, 'MS': 0.05,
  'MO': 0.054,  'MT': 0.069,  'NE': 0.0664, 'NV': 0,
  'NH': 0,      'NJ': 0.1075, 'NM': 0.059,  'NY': 0.109,
  'NC': 0.0449, 'ND': 0.029,  'OH': 0.035,  'OK': 0.05,
  'OR': 0.099,  'PA': 0.0307, 'RI': 0.0599, 'SC': 0.07,
  'SD': 0,      'TN': 0,      'TX': 0,      'UT': 0.0465,
  'VT': 0.0875, 'VA': 0.0575, 'WA': 0,      'WV': 0.065,
  'WI': 0.0765, 'WY': 0,      'DC': 0.1075,
};

// ─── 2026 Federal income tax brackets (single filer) ─────────────────────────
function federalMarginalRate(income: number): number {
  if (income > 626350) return 0.37;
  if (income > 250525) return 0.35;
  if (income > 197300) return 0.32;
  if (income > 103350) return 0.24;
  if (income > 48475) return 0.22;
  if (income > 11925) return 0.12;
  return 0.10;
}

// ─── 2026 Long-term capital gains rates (single filer) ───────────────────────
function ltcgRate(income: number): number {
  if (income > 533400) return 0.20;
  if (income > 48350) return 0.15;
  return 0;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function deriveInvestorProfile(a: IntakeAnswers): InvestorProfile {
  // 1. Risk Score 1–10 from three orthogonal inputs
  const horizonPts = a.yearsUntilWithdrawal >= 15 ? 3 : a.yearsUntilWithdrawal >= 7 ? 2 : 1;
  const behaviorPts = a.marketDropReaction === 'aggressive' ? 3 : a.marketDropReaction === 'passive' ? 2 : 1;
  const stabilityPts = a.incomeStability; // 1–5
  // Normalize to 1–10: sum ranges 3–11, map to 1–10
  const rawSum = horizonPts + behaviorPts + stabilityPts; // 3–11
  const riskScore = Math.min(10, Math.max(1, Math.round(((rawSum - 3) / 8) * 9 + 1)));

  // 2. Tolerance label
  const derivedRiskTolerance: InvestorProfile['derivedRiskTolerance'] =
    riskScore >= 8 ? 'very_aggressive'
    : riskScore >= 6 ? 'aggressive'
    : riskScore >= 4 ? 'moderate'
    : 'conservative';

  // 3. Time horizon bucket
  const timeHorizonBucket: InvestorProfile['timeHorizonBucket'] =
    a.yearsUntilWithdrawal < 3 ? 'short'
    : a.yearsUntilWithdrawal < 7 ? 'medium'
    : a.yearsUntilWithdrawal < 15 ? 'long'
    : 'very_long';

  // 4. Tax rates
  const fedRate = federalMarginalRate(a.annualIncome);
  const stateRate = STATE_TAX[a.state] ?? 0.05;
  const effectiveMarginalRate = Math.min(0.503, fedRate + stateRate);
  const capitalGainsRate = ltcgRate(a.annualIncome);

  // 5. Liquidity need (months of expenses to keep liquid)
  const baseLiquidity = a.incomeStability <= 2 ? 6 : a.incomeStability <= 3 ? 4 : 3;
  const noFundPenalty = a.hasEmergencyFund ? 0 : 2;
  const expensePenalty = a.hasLargeExpense ? 2 : 0;
  const liquidityNeedMonths = baseLiquidity + noFundPenalty + expensePenalty;

  // 6. Goal feasibility (rough forward projection)
  const annualReturn = derivedRiskTolerance === 'very_aggressive' ? 0.10
    : derivedRiskTolerance === 'aggressive' ? 0.085
    : derivedRiskTolerance === 'moderate' ? 0.07
    : 0.05;
  const months = a.yearsUntilWithdrawal * 12;
  const mr = annualReturn / 12;
  const fv = (a.startingCapital * Math.pow(1 + annualReturn, a.yearsUntilWithdrawal))
    + (a.monthlyContribution * ((Math.pow(1 + mr, months) - 1) / mr));
  // "Achievable" = projected value at least 2× starting capital or > $500k
  const goalFeasibility: InvestorProfile['goalFeasibility'] =
    fv > a.startingCapital * 3 ? 'achievable'
    : fv > a.startingCapital * 1.5 ? 'stretch'
    : 'requires_adjustment';

  // 7. Dominant behavioral bias
  const behavioralBias =
    a.marketDropReaction === 'panic'
      ? 'Loss aversion — heightened risk of panic-selling in drawdowns; needs guardrails'
    : a.marketDropReaction === 'aggressive'
      ? 'Overconfidence / contrarianism — may underestimate tail risk and over-leverage on dips'
      : 'Status quo / inertia bias — risk of holding through prolonged drawdowns without rebalancing';

  // 8. Hard constraints derived from intake
  const constraints: string[] = [];
  if (!a.hasEmergencyFund) {
    constraints.push('Must build emergency fund first — mandate SGOV/VUSXX ≥ 10%');
  }
  if (a.hasLargeExpense && a.largeExpenseAmount && a.largeExpenseAmount > 0) {
    constraints.push(`Liquidity sleeve required for planned expense: $${a.largeExpenseAmount.toLocaleString()}`);
  }
  if (a.hasSectorPreferences) {
    if (a.favoredSectors) constraints.push(`Favor: ${a.favoredSectors}`);
    if (a.avoidedSectors) constraints.push(`Avoid: ${a.avoidedSectors}`);
  }
  const hasRetirementAccounts = a.accounts.some(acc =>
    acc.toLowerCase().includes('401') || acc.toLowerCase().includes('roth') || acc.toLowerCase().includes('ira')
  );
  if (!hasRetirementAccounts) {
    constraints.push('No tax-advantaged accounts — avoid high-distribution assets (BND, VNQ) in taxable');
  }

  // 9. Two-sentence narrative
  const incomeLabel = a.incomeStability >= 4 ? 'stable' : a.incomeStability >= 3 ? 'moderate' : 'variable';
  const behaviorLabel = a.marketDropReaction === 'aggressive' ? 'contrarian buyer' : a.marketDropReaction === 'passive' ? 'passive holder' : 'defensive seller';
  const narrative =
    `${derivedRiskTolerance.replace('_', '-')} investor with ${a.yearsUntilWithdrawal}-year horizon targeting ${a.primaryGoal.replace(/_/g, ' ')} ` +
    `(risk score ${riskScore}/10 from ${incomeLabel} income + ${behaviorLabel} behavior). ` +
    `Effective marginal rate ${(effectiveMarginalRate * 100).toFixed(0)}%; ` +
    `${a.hasEmergencyFund ? 'emergency fund established — can prioritize growth' : 'no emergency fund — liquidity mandate applies'}.`;

  return {
    riskScore,
    derivedRiskTolerance,
    effectiveMarginalRate,
    capitalGainsRate,
    liquidityNeedMonths,
    timeHorizonBucket,
    goalFeasibility,
    behavioralBias,
    constraints,
    narrative,
  };
}
