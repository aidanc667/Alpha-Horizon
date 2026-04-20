// ─── Intake Validation & Transformation ───────────────────────────────────────

import type {
  IntakeAnswers,
  PrimaryGoal,
  FilingStatus,
  RiskLevel,
  IncomeStabilityLevel,
  InvestmentPreferences,
} from '../agents/types';
import { INTAKE_QUESTIONS } from './questions/index';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Strip currency formatting and parse to a number. Returns 0 on failure. */
function parseCurrencyValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseFloat(value.replace(/[$,\s]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

const QUESTION_MAP = Object.fromEntries(INTAKE_QUESTIONS.map(q => [q.id, q]));

// ─── Option → typed-value lookup maps ────────────────────────────────────────

const GOAL_MAP: Record<string, PrimaryGoal> = {
  'Retirement (Financial Independence)': 'financial_independence',
  'Major Purchase (home, education, etc.)': 'major_purchase',
  'Wealth Accumulation (no specific target)': 'max_growth',
  'Legacy/Estate Planning': 'legacy',
};

const FILING_STATUS_MAP: Record<string, FilingStatus> = {
  'Single': 'single',
  'Married Filing Jointly': 'married_filing_jointly',
  'Head of Household': 'head_of_household',
};

const RISK_CAPACITY_MAP: Record<string, RiskLevel> = {
  'Be financially devastated — need to sell to cover expenses': 'low',
  'Be uncomfortable but could weather it — no forced selling': 'medium',
  'Be fine — have other income/assets to sustain lifestyle': 'high',
  'Be opportunistic — would invest more': 'high',
};

const RISK_WILLINGNESS_MAP: Record<string, RiskLevel> = {
  'Panic and sell to "stop the bleeding"': 'low',
  'Do nothing and wait for recovery': 'medium',
  'Buy more — "stocks are on sale"': 'high',
  'Not check my portfolio — long-term focused': 'high',
};

const INCOME_STABILITY_MAP: Record<string, IncomeStabilityLevel> = {
  'Very stable — salaried W-2, tenure >5 years': 5,
  'Stable — salaried but <5 years tenure, or contract role': 4,
  'Variable — sales/commission/bonus-heavy (30%+ of income)': 3,
  'Highly variable — freelance/self-employed/seasonal': 2,
  'Retired — living on portfolio/Social Security/pension': 3,
};

/** Midpoint years for each Q3 time-horizon bucket — used as a fallback. */
const TIME_HORIZON_YEARS: Record<string, number> = {
  'Less than 3 years (short-term)': 2,
  '3-7 years (medium-term)': 5,
  '7-15 years (long-term)': 11,
  '15+ years (very long-term)': 20,
  'Never — this is legacy/perpetual wealth': 40,
};

// ─── Required IntakeAnswers fields → originating question ID ─────────────────
//
// Used by validateIntakeAnswers to report missing fields using the wizard's
// question IDs rather than internal IntakeAnswers property names.

const REQUIRED_FIELD_TO_QUESTION_ID: Array<{
  field: keyof IntakeAnswers;
  questionId: string;
}> = [
  { field: 'goal',               questionId: 'q1_goal' },
  { field: 'timeHorizon',        questionId: 'q3_timeHorizon' },
  { field: 'startingCapital',    questionId: 'q4_startingCapital' },
  { field: 'monthlyContribution',questionId: 'q5_monthlyContribution' },
  { field: 'financialSnapshot',  questionId: 'q6_financialSnapshot' },
  { field: 'filingStatus',       questionId: 'q7_taxSituation' },
  { field: 'annualIncome',       questionId: 'q7_taxSituation' },
  { field: 'state',              questionId: 'q7_taxSituation' },
  { field: 'age',                questionId: 'q7_taxSituation' },
  { field: 'existingAccounts',   questionId: 'q7_taxSituation' },
  { field: 'riskCapacity',       questionId: 'q8_riskCapacity' },
  { field: 'riskWillingness',    questionId: 'q9_riskWillingness' },
  { field: 'incomeStability',    questionId: 'q10_incomeStability' },
  { field: 'availableAccounts',  questionId: 'q11_availableAccounts' },
];

// ─── Validation result type ───────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ─── 1. validateQuestion ──────────────────────────────────────────────────────

/**
 * Validates a single wizard answer against the question's type rules.
 *
 * For multi_part questions, pass the entire answer object as `value`
 * (e.g. `{ amount: 50000, hasExistingPortfolio: false }`).
 *
 * Rules applied:
 *   - currency type   → value > 0  (exception: monthly contribution allows 0)
 *   - number type     → must be numeric; age fields must be 18–120
 *   - single_select   → must be a listed option
 *   - multi_select    → must be a non-empty array
 *   - multi_part      → each required Part must pass its own type rule
 *   - required field  → value !== null && value !== undefined && value !== ''
 */
export function validateQuestion(questionId: string, value: unknown): ValidationResult {
  const question = QUESTION_MAP[questionId];

  // Required check — applies to all types
  const isEmpty = value === null || value === undefined || value === '';
  if (isEmpty) {
    if (question?.required) {
      return { valid: false, error: 'This field is required' };
    }
    return { valid: true };
  }

  if (!question) return { valid: true };

  switch (question.type) {
    case 'currency': {
      const n = parseCurrencyValue(value);
      if (n <= 0) return { valid: false, error: 'Must be greater than $0' };
      break;
    }

    case 'number': {
      const n = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(n)) return { valid: false, error: 'Must be a valid number' };
      break;
    }

    case 'single_select': {
      if (question.options && !question.options.includes(String(value))) {
        return { valid: false, error: 'Please select a valid option' };
      }
      break;
    }

    case 'multi_select': {
      if (!Array.isArray(value) || value.length === 0) {
        return { valid: false, error: 'Please select at least one option' };
      }
      break;
    }

    case 'multi_part': {
      if (typeof value !== 'object' || value === null) {
        return { valid: false, error: 'Invalid answer format' };
      }
      const obj = value as Record<string, unknown>;

      for (const part of question.parts ?? []) {
        // Respect showIf — skip validation for hidden parts
        if (part.showIf) {
          const [siblingId, expectedVal] = Object.entries(part.showIf)[0];
          if (obj[siblingId] !== expectedVal) continue;
        }

        const partVal = obj[part.id];
        const partEmpty = partVal === null || partVal === undefined || partVal === '';

        if (partEmpty) {
          if (part.required) {
            return { valid: false, error: `"${part.label}" is required` };
          }
          continue;
        }

        if (part.type === 'currency') {
          // Monthly contribution (q5) may be 0 — only validate format, not > 0
          const isMonthlyContribution = questionId === 'q5_monthlyContribution' && part.id === 'amount';
          const n = parseCurrencyValue(partVal);
          if (isNaN(n)) return { valid: false, error: `"${part.label}" must be a valid currency amount` };
          if (!isMonthlyContribution && n <= 0) {
            return { valid: false, error: `"${part.label}" must be greater than $0` };
          }
        }

        if (part.type === 'number') {
          const n = typeof partVal === 'number' ? partVal : parseFloat(String(partVal));
          if (isNaN(n)) return { valid: false, error: `"${part.label}" must be a valid number` };
          if (part.id === 'age') {
            if (n < 18 || n > 120) {
              return { valid: false, error: 'Age must be between 18 and 120' };
            }
          }
        }
      }
      break;
    }

    case 'optional_multi_part':
      // No required parts — always valid
      break;

    default:
      break;
  }

  return { valid: true };
}

// ─── 2. validateIntakeAnswers ─────────────────────────────────────────────────

/**
 * Checks that all required IntakeAnswers fields are present.
 *
 * Returns `{ valid: true }` when the intake is complete, or
 * `{ valid: false, missingFields: string[] }` with the originating question IDs
 * of any unanswered required questions.
 *
 * Note: multiple IntakeAnswers fields may originate from the same wizard question
 * (e.g. filingStatus, annualIncome, state, age all come from q7_taxSituation).
 * In that case the question ID is reported once per missing field.
 */
export function validateIntakeAnswers(
  answers: Partial<IntakeAnswers>,
): { valid: boolean; missingFields: string[] } {
  const missingFields: string[] = [];
  const reportedQuestions = new Set<string>();

  for (const { field, questionId } of REQUIRED_FIELD_TO_QUESTION_ID) {
    const val = answers[field];
    const isMissing = val === null || val === undefined || val === '';

    if (isMissing && !reportedQuestions.has(questionId)) {
      missingFields.push(questionId);
      reportedQuestions.add(questionId);
    }
  }

  // availableAccounts is an array — empty array counts as missing
  if (
    (answers.availableAccounts === undefined ||
      (Array.isArray(answers.availableAccounts) && answers.availableAccounts.length === 0)) &&
    !reportedQuestions.has('q11_availableAccounts')
  ) {
    missingFields.push('q11_availableAccounts');
  }

  return { valid: missingFields.length === 0, missingFields };
}

// ─── 3. transformAnswersToIntakeAnswers ───────────────────────────────────────

/**
 * Converts raw wizard answers to a fully-typed IntakeAnswers object.
 *
 * Expected rawAnswers shape (all keys are wizard question IDs):
 * ```
 * {
 *   q1_goal:              string                         // single_select answer
 *   q2_goalDetails:       Record<string, number>         // conditional sub-fields
 *   q3_timeHorizon:       string                         // single_select bucket
 *   q4_startingCapital:   { amount, hasExistingPortfolio, existingPortfolioValue?, existingPortfolioType? }
 *   q5_monthlyContribution: { amount, contributionConfidence }
 *   q6_financialSnapshot: string[]                       // multi_select selections
 *   q6_plannedExpenseAmount?: number | string            // followup — planned expense
 *   q6_homePurchaseYears?:  number                       // followup — home purchase
 *   q7_taxSituation:      { filingStatus, annualIncome, state, age, traditionalBalance?, rothBalance?, hsaBalance? }
 *   q8_riskCapacity:      string
 *   q9_riskWillingness:   string
 *   q10_incomeStability:  string
 *   q11_availableAccounts: string[]
 *   q12_preferences?:     { noPreferences?, avoidInternational?, dividendFocus?, indexOnly?, esg?, other? }
 * }
 * ```
 *
 * Conditional logic for timeHorizon:
 *   - Retirement  → targetRetirementAge − current age (from q7)
 *   - Major Purchase / Legacy → yearsToGoal from q2_goalDetails
 *   - Wealth Accumulation → Q3 bucket midpoint (goalAmount has no implied horizon)
 *   - Fallback    → Q3 bucket midpoint when specific years are unavailable
 */
export function transformAnswersToIntakeAnswers(
  rawAnswers: Record<string, unknown>,
): IntakeAnswers {
  // ── Destructure raw answers ──────────────────────────────────────────────────
  const goalRaw = String(rawAnswers.q1_goal ?? '');
  const goalDetails = (rawAnswers.q2_goalDetails ?? {}) as Record<string, unknown>;
  const timeHorizonBucket = String(rawAnswers.q3_timeHorizon ?? '');
  const startingCapitalParts = (rawAnswers.q4_startingCapital ?? {}) as Record<string, unknown>;
  const monthlyContribParts = (rawAnswers.q5_monthlyContribution ?? {}) as Record<string, unknown>;
  const financialSelections = (rawAnswers.q6_financialSnapshot ?? []) as string[];
  const taxParts = (rawAnswers.q7_taxSituation ?? {}) as Record<string, unknown>;
  const riskCapacityRaw = String(rawAnswers.q8_riskCapacity ?? '');
  const riskWillingnessRaw = String(rawAnswers.q9_riskWillingness ?? '');
  const incomeStabilityRaw = String(rawAnswers.q10_incomeStability ?? '');
  const availableAccountsRaw = (rawAnswers.q11_availableAccounts ?? []) as string[];
  const prefsRaw = (rawAnswers.q12_preferences ?? {}) as Record<string, unknown>;

  // ── Goal ─────────────────────────────────────────────────────────────────────
  const goal: PrimaryGoal = GOAL_MAP[goalRaw] ?? 'max_growth';

  // ── Goal amount ───────────────────────────────────────────────────────────────
  const goalAmountRaw = goalDetails.goalAmount;
  const goalAmount = goalAmountRaw != null ? parseCurrencyValue(goalAmountRaw) : undefined;

  // ── Age (needed for retirement time horizon) ─────────────────────────────────
  const age = typeof taxParts.age === 'number'
    ? taxParts.age
    : parseFloat(String(taxParts.age ?? '0'));

  // ── Time horizon (years) ──────────────────────────────────────────────────────
  let timeHorizon: number;

  if (goal === 'financial_independence' && goalDetails.targetRetirementAge != null) {
    const retirementAge = parseCurrencyValue(goalDetails.targetRetirementAge);
    timeHorizon = Math.max(0, retirementAge - age);
  } else if (
    (goal === 'major_purchase' || goal === 'legacy') &&
    goalDetails.yearsToGoal != null
  ) {
    timeHorizon = parseCurrencyValue(goalDetails.yearsToGoal);
  } else {
    // Fallback: derive from Q3 bucket midpoint
    timeHorizon = TIME_HORIZON_YEARS[timeHorizonBucket] ?? 10;
  }

  // ── Starting capital ──────────────────────────────────────────────────────────
  const startingCapital = parseCurrencyValue(startingCapitalParts.amount);

  // ── Monthly contribution ──────────────────────────────────────────────────────
  // Intentionally allows 0 — lump-sum investors enter $0/month
  const monthlyContribution = parseCurrencyValue(monthlyContribParts.amount);

  // ── Financial snapshot ────────────────────────────────────────────────────────
  const hasEmergencyFund = financialSelections.includes(
    'I have 3-6 months of expenses in emergency savings',
  );
  const hasHighInterestDebt = financialSelections.includes(
    'I have high-interest debt (credit cards, personal loans >8% APR)',
  );
  const hasPlannedExpense = financialSelections.includes(
    'I have a planned large expense in the next 3 years',
  );
  const plannedExpenseRaw = rawAnswers.q6_plannedExpenseAmount;
  const plannedExpense =
    hasPlannedExpense && plannedExpenseRaw != null
      ? parseCurrencyValue(plannedExpenseRaw)
      : undefined;

  // ── Tax situation ─────────────────────────────────────────────────────────────
  const filingStatus: FilingStatus =
    FILING_STATUS_MAP[String(taxParts.filingStatus ?? '')] ?? 'single';
  const annualIncome = parseCurrencyValue(taxParts.annualIncome);
  const state = String(taxParts.state ?? '');
  const existingAccounts = {
    traditional: parseCurrencyValue(taxParts.traditionalBalance ?? 0),
    roth: parseCurrencyValue(taxParts.rothBalance ?? 0),
    hsa: parseCurrencyValue(taxParts.hsaBalance ?? 0),
  };

  // ── Risk profile ──────────────────────────────────────────────────────────────
  const riskCapacity: RiskLevel = RISK_CAPACITY_MAP[riskCapacityRaw] ?? 'medium';
  const riskWillingness: RiskLevel = RISK_WILLINGNESS_MAP[riskWillingnessRaw] ?? 'medium';

  // ── Income stability ──────────────────────────────────────────────────────────
  const incomeStability: IncomeStabilityLevel =
    INCOME_STABILITY_MAP[incomeStabilityRaw] ?? 3;

  // ── Investment preferences ────────────────────────────────────────────────────
  let investmentPreferences: InvestmentPreferences | undefined;
  if (!prefsRaw.noPreferences) {
    const avoidedParts: string[] = [];
    if (prefsRaw.avoidInternational) avoidedParts.push('international stocks');
    if (prefsRaw.esg) avoidedParts.push('fossil fuels, tobacco, controversial weapons');

    const other = typeof prefsRaw.other === 'string' && prefsRaw.other.trim()
      ? prefsRaw.other.trim()
      : undefined;

    const prefs: InvestmentPreferences = {
      esgOnly: Boolean(prefsRaw.esg),
      ...(avoidedParts.length > 0 && { avoidedSectors: avoidedParts.join(', ') }),
      ...(other && { favoredSectors: other }),
    };

    // Only attach preferences object when at least one preference was stated
    if (prefs.esgOnly || prefs.avoidedSectors || prefs.favoredSectors) {
      investmentPreferences = prefs;
    }
  }

  // ── Assemble final IntakeAnswers ───────────────────────────────────────────────
  return {
    goal,
    ...(goalAmount != null && goalAmount > 0 && { goalAmount }),
    timeHorizon,
    startingCapital,
    monthlyContribution,
    financialSnapshot: {
      hasEmergencyFund,
      hasHighInterestDebt,
      ...(plannedExpense != null && { plannedExpense }),
    },
    filingStatus,
    annualIncome,
    state,
    age,
    existingAccounts,
    riskCapacity,
    riskWillingness,
    incomeStability,
    availableAccounts: availableAccountsRaw,
    ...(investmentPreferences && { investmentPreferences }),
  };
}
