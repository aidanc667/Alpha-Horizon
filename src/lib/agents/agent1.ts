import type {
  IntakeAnswers,
  Agent1Output,
  DerivedRiskProfile,
  DerivedTaxProfile,
  DerivedTimeHorizon,
  GoalAnalysis,
  LiquidityNeeds,
  AccountStructure,
  AgentConstraints,
  TimeHorizonBucket,
  FilingStatus,
} from './types';

// ─── 2026 State income tax rates ──────────────────────────────────────────────
const STATE_TAX: Record<string, number> = {
  AL:0.05,  AK:0,     AZ:0.025, AR:0.044, CA:0.093, CO:0.044,
  CT:0.069, DE:0.066, FL:0,     GA:0.055, HI:0.11,  ID:0.058,
  IL:0.0495,IN:0.0315,IA:0.057, KS:0.057, KY:0.045, LA:0.06,
  ME:0.075, MD:0.0575,MA:0.05,  MI:0.0425,MN:0.0985,MS:0.05,
  MO:0.054, MT:0.069, NE:0.0664,NV:0,     NH:0,     NJ:0.1075,
  NM:0.059, NY:0.109, NC:0.0449,ND:0.029, OH:0.035, OK:0.05,
  OR:0.099, PA:0.0307,RI:0.0599,SC:0.07,  SD:0,     TN:0,
  TX:0,     UT:0.0465,VT:0.0875,VA:0.0575,WA:0,     WV:0.065,
  WI:0.0765,WY:0,     DC:0.1075,
};

// ─── 2026 Federal brackets ────────────────────────────────────────────────────
function fedRate(income: number, status: FilingStatus): number {
  const mfj = status === 'married_filing_jointly';
  if (income > (mfj ? 751600  : 626350)) return 0.37;
  if (income > (mfj ? 487450  : 250525)) return 0.35;
  if (income > (mfj ? 394600  : 197300)) return 0.32;
  if (income > (mfj ? 206700  : 103350)) return 0.24;
  if (income > (mfj ? 96950   : 48475))  return 0.22;
  if (income > (mfj ? 23850   : 11925))  return 0.12;
  return 0.10;
}

function ltcgRate(income: number, status: FilingStatus): number {
  const mfj = status === 'married_filing_jointly';
  if (income > (mfj ? 583750 : 533400)) return 0.20;
  if (income > (mfj ? 96700  : 48350))  return 0.15;
  return 0;
}

// ─── Risk score derivation ────────────────────────────────────────────────────
const RISK_LEVEL_PTS: Record<string, number> = { low: 1, medium: 2, high: 3 };

function deriveRiskScore(
  riskCapacity: string,
  riskWillingness: string,
  incomeStability: number,
  yearsToGoal: number,
): number {
  // Capacity weighted 3×, willingness 2×, stability 1× (max raw = 3+3+2+2+5 = 15... skip horizon for score)
  // Conservative override: final score floored by the lower of capacity/willingness
  const capPts  = RISK_LEVEL_PTS[riskCapacity]  ?? 2;
  const willPts = RISK_LEVEL_PTS[riskWillingness] ?? 2;
  const effective = Math.min(capPts, willPts); // conservative override
  const horizonBonus = yearsToGoal >= 20 ? 1 : yearsToGoal < 5 ? -1 : 0;
  const raw = effective * 3 + Math.min(incomeStability, 5) + horizonBonus; // 3–15
  return Math.min(10, Math.max(1, Math.round(((raw - 3) / 12) * 9 + 1)));
}

function maxEquity(riskScore: number, bucket: TimeHorizonBucket): number {
  const base = riskScore * 0.10;
  if (bucket === 'short')     return Math.min(base, 0.50);
  if (bucket === 'very_long') return Math.min(base * 1.10, 1.0);
  return base;
}

function horizonBucket(years: number): TimeHorizonBucket {
  if (years < 5)  return 'short';
  if (years < 15) return 'medium';
  if (years < 25) return 'long';
  return 'very_long';
}

// ─── Goal analysis ────────────────────────────────────────────────────────────

const PROJECTION_RATE = 0.07; // 7% blended planning rate for FV projections

function annuityFV(pmt: number, annualRate: number, years: number): number {
  if (pmt === 0 || years === 0) return 0;
  const n  = years * 12;
  const rm = Math.pow(1 + annualRate, 1 / 12) - 1;
  if (rm < 1e-9) return pmt * n;
  return pmt * ((Math.pow(1 + rm, n) - 1) / rm);
}

function deriveGoalAnalysis(
  goalAmount: number | undefined,
  startingCapital: number,
  monthlyContribution: number,
  yearsToGoal: number,
): GoalAnalysis {
  const goal = goalAmount ?? 0;

  const futureValueOfCapital       = Math.round(startingCapital * Math.pow(1 + PROJECTION_RATE, yearsToGoal));
  const futureValueOfContributions = Math.round(annuityFV(monthlyContribution, PROJECTION_RATE, yearsToGoal));
  const totalProjectedValue        = futureValueOfCapital + futureValueOfContributions;

  if (goal === 0) {
    return {
      goalAmount: 0,
      presentValue: 0,
      futureValueOfCapital,
      futureValueOfContributions,
      totalProjectedValue,
      fundedStatus: 1,
      feasibility: 'achievable',
    };
  }

  const presentValue = Math.round(goal / Math.pow(1 + PROJECTION_RATE, yearsToGoal));
  const fundedStatus = goal > 0 ? totalProjectedValue / goal : 1;
  const feasibility =
    fundedStatus >= 1.0 ? 'achievable' :
    fundedStatus >= 0.7 ? 'stretch' :
    'requires_adjustment';

  return {
    goalAmount: goal,
    presentValue,
    futureValueOfCapital,
    futureValueOfContributions,
    totalProjectedValue,
    fundedStatus,
    feasibility,
  };
}

// ─── Agent 1: Client Profile ──────────────────────────────────────────────────

/**
 * Deterministic client profile derivation. No LLM, no I/O. Target: <2ms.
 *
 * Transforms raw IntakeAnswers into normalized typed signals consumed by
 * Agents 2–6 and the Monte Carlo engine.
 */
export function agent1_clientProfile(input: {
  intakeAnswers: IntakeAnswers;
}): Agent1Output {
  const startTime = Date.now();
  const a = input.intakeAnswers;

  // ── Tax profile ───────────────────────────────────────────────────────────
  const federalMarginalRate  = fedRate(a.annualIncome, a.filingStatus);
  const stateMarginalRate    = STATE_TAX[a.state?.toUpperCase()] ?? 0;
  const combinedMarginalRate = Math.min(0.60, federalMarginalRate + stateMarginalRate);
  // IRC §1411: 3.8% NIIT applies to investment income above $200K (single) / $250K (MFJ)
  const niitApplies =
    (a.filingStatus === 'married_filing_jointly' && a.annualIncome > 250_000) ||
    (a.filingStatus !== 'married_filing_jointly' && a.annualIncome > 200_000);
  const investmentIncomeMarginalRate = Math.min(0.60,
    combinedMarginalRate + (niitApplies ? 0.038 : 0),
  );
  const taxProfile: DerivedTaxProfile = {
    federalMarginalRate,
    stateMarginalRate,
    combinedMarginalRate,
    investmentIncomeMarginalRate,
    ltcgRate: ltcgRate(a.annualIncome, a.filingStatus),
  };

  // ── Time horizon ──────────────────────────────────────────────────────────
  const yearsToGoal = Math.max(0, a.timeHorizon);
  const bucket      = horizonBucket(yearsToGoal);
  const timeHorizon: DerivedTimeHorizon = {
    yearsToGoal,
    bucket,
    isInDrawdownPhase: yearsToGoal <= 0,
    isNearDrawdown: yearsToGoal <= 5,
  };

  // ── Risk profile ──────────────────────────────────────────────────────────
  const riskScore = deriveRiskScore(a.riskCapacity, a.riskWillingness, a.incomeStability, yearsToGoal);
  const effectiveRiskTolerance =
    riskScore >= 8 ? 'very_aggressive' :
    riskScore >= 6 ? 'aggressive' :
    riskScore >= 4 ? 'moderate' :
    'conservative';
  const riskProfile: DerivedRiskProfile = {
    riskScore,
    riskCapacity: a.riskCapacity,
    riskWillingness: a.riskWillingness,
    effectiveRiskTolerance,
    maxEquityAllowed: maxEquity(riskScore, bucket),
  };

  // ── Goal analysis (uses 7% blended planning rate, includes contributions) ──
  const goalAnalysis = deriveGoalAnalysis(a.goalAmount, a.startingCapital, a.monthlyContribution, yearsToGoal);

  // ── Liquidity needs ───────────────────────────────────────────────────────
  const hasEmergencyFund = a.financialSnapshot.hasEmergencyFund;
  const monthsRequired   =
    !hasEmergencyFund          ? 6  :
    a.incomeStability <= 2     ? 3  :
    0;
  const liquidityNeeds: LiquidityNeeds = {
    monthsRequired,
    ...(a.financialSnapshot.plannedExpense != null && { plannedExpense: a.financialSnapshot.plannedExpense }),
  };

  // ── Account structure ─────────────────────────────────────────────────────
  const accountStructure: AccountStructure = {
    availableAccounts: a.availableAccounts,
    existingBalances: a.existingAccounts,
    hasExistingPortfolio:
      a.existingAccounts.traditional + a.existingAccounts.roth + a.existingAccounts.hsa > 0,
  };

  // ── Constraints ───────────────────────────────────────────────────────────
  const hardStops: string[] = [];
  const warnings: string[]  = [];

  if (a.age < 18) {
    hardStops.push('Investor is under 18 — portfolio requires custodial account structure (UGMA/UTMA); consult a financial adviser before proceeding');
  }
  if (timeHorizon.isInDrawdownPhase) {
    hardStops.push('Client is in drawdown phase — equity capped at 40%, no illiquid alts');
  }
  if (a.financialSnapshot.hasHighInterestDebt) {
    warnings.push('High-interest debt present — consider paying down before investing aggressively');
  }
  if (goalAnalysis.feasibility === 'requires_adjustment') {
    let goalWarning = 'Goal requires significant adjustment — increase savings rate or reduce target';
    if (goalAnalysis.goalAmount > 0 && yearsToGoal > 0) {
      const fvCapital = a.startingCapital * Math.pow(1 + PROJECTION_RATE, yearsToGoal);
      const gap = goalAnalysis.goalAmount - fvCapital;
      let minimumContribution = 0;
      if (gap > 0) {
        const rm = Math.pow(1 + PROJECTION_RATE, 1 / 12) - 1;
        minimumContribution = gap * rm / (Math.pow(1 + rm, yearsToGoal * 12) - 1);
      }
      const achievableGoal = Math.round(goalAnalysis.totalProjectedValue / 1000) * 1000;
      goalWarning =
        `Goal of $${goalAnalysis.goalAmount.toLocaleString()} is not achievable at the current savings rate. ` +
        `To reach your target, increase monthly contributions to at least $${Math.ceil(minimumContribution).toLocaleString()}, ` +
        `or reduce your target to $${achievableGoal.toLocaleString()} (achievable at current rate).`;
    }
    warnings.push(goalWarning);
  }
  const constraints: AgentConstraints = { hardStops, warnings };

  const executionTimeMs = Date.now() - startTime;

  return {
    agentName: 'clientProfile',
    timestamp: new Date().toISOString(),
    executionTimeMs,
    riskProfile,
    taxProfile,
    timeHorizon,
    goalAnalysis,
    liquidityNeeds,
    accountStructure,
    constraints,
    startingCapital: a.startingCapital,
    monthlyContribution: a.monthlyContribution,
    investmentPreferences: a.investmentPreferences,
    performance: {
      targetLatencyMs: 2,
      actualLatencyMs: executionTimeMs,
      withinSLA: executionTimeMs <= 2,
    },
  };
}
