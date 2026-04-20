// ─── Portfolio Agent v2 — Agent Pipeline Types ────────────────────────────────
//
// Self-contained type definitions for the revamped 3-agent pipeline.
// No imports from src/apps/portfolio-agent/types — intentionally standalone
// so this layer can be consumed by any route, worker, or test without
// pulling in UI-layer concerns.

// ─── Shared primitives ────────────────────────────────────────────────────────

/** Tax filing status — determines bracket thresholds and standard deduction. */
export type FilingStatus =
  | 'single'
  | 'married_filing_jointly'
  | 'married_filing_separately'
  | 'head_of_household';

/**
 * Coarse three-bucket rating used for both risk capacity and risk willingness.
 * Kept intentionally broad — granular scores live inside agent outputs.
 */
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Income stability on a 1–5 scale.
 *   1 = Highly variable (freelance / gig)
 *   2 = Somewhat variable (self-employed / contract)
 *   3 = Moderate (private sector, at-will)
 *   4 = Stable (established company, tenured)
 *   5 = Very stable (government / academic / pension)
 */
export type IncomeStabilityLevel = 1 | 2 | 3 | 4 | 5;

/** Primary investment goal driving the entire plan. */
export type PrimaryGoal =
  | 'financial_independence'  // Cash-flow / FIRE target
  | 'major_purchase'          // House, business, education
  | 'max_growth'              // Long-horizon wealth accumulation
  | 'legacy';                 // Tax-efficient wealth transfer

/** Investor time-horizon bucket derived from raw years-to-goal. */
export type TimeHorizonBucket = 'short' | 'medium' | 'long' | 'very_long';

/**
 * Overall feasibility of reaching the stated goal given current inputs.
 *   achievable       — on track with modest assumptions
 *   stretch          — reachable but requires above-average returns or savings
 *   requires_adjustment — gap too large; plan must change
 */
export type FeasibilityRating = 'achievable' | 'stretch' | 'requires_adjustment';

/** Allocation bucket — how a holding is classified in the 3-bucket framework. */
export type AllocationCategory = 'safety' | 'growth' | 'income' | 'alternative';

/** Which account type an ETF position should be held in for tax efficiency. */
export type AccountPlacement = 'taxable' | 'traditional' | 'roth' | 'hsa' | 'any';

/**
 * Where macro data was sourced from this run.
 *   live       — fresh web-search result (preferred)
 *   cache_l2   — served from the agentResponseCache (≤ TTL)
 *   fallback   — static baseline values used when live + cache both fail
 */
export type MacroDataSource = 'live' | 'cache_l2' | 'fallback';

/** Current broad market regime used to tilt expected return assumptions. */
export type MarketRegime = 'risk_on' | 'risk_off';

// ─── Shared sub-types ─────────────────────────────────────────────────────────

/**
 * Latency / SLA telemetry attached to every agent output.
 * Used to surface slow agents in the status panel and flag SLA breaches.
 */
export interface AgentPerformance {
  /** Hard SLA target agreed at pipeline design time (ms). */
  targetLatencyMs: number;
  /** Actual wall-clock time from agent invocation to structured output (ms). */
  actualLatencyMs: number;
  /** True when actualLatencyMs ≤ targetLatencyMs. */
  withinSLA: boolean;
}

// ─── 1. IntakeAnswers (12 questions) ──────────────────────────────────────────

/**
 * Balances held in existing tax-advantaged accounts at intake time.
 * All values in USD. Zero when the account type is not held.
 */
export interface ExistingAccountBalances {
  /** Pre-tax IRA or 401(k) balance. Withdrawals taxed as ordinary income. */
  traditional: number;
  /** After-tax Roth IRA or Roth 401(k) balance. Qualified withdrawals tax-free. */
  roth: number;
  /** Health Savings Account balance. Triple-tax-advantaged. */
  hsa: number;
}

/**
 * A snapshot of the investor's near-term financial obligations and buffers.
 * Feeds the liquidity sleeve calculation in Agent 1.
 */
export interface FinancialSnapshot {
  /** True when 3–6 months of expenses are held in liquid cash outside this portfolio. */
  hasEmergencyFund: boolean;
  /**
   * True when the investor carries high-interest debt (credit cards, personal loans
   * above ~7%). Triggers a warning — agent may recommend paying down debt first.
   */
  hasHighInterestDebt: boolean;
  /**
   * Known large cash need within the next 5 years (down payment, tuition, etc.).
   * USD amount — undefined when no major expense is planned.
   */
  plannedExpense?: number;
}

/**
 * Optional sector / ESG preferences that constrain the ETF universe.
 * All fields are optional — omitting them means no preference (pure quant mode).
 */
export interface InvestmentPreferences {
  /** Free-text sectors or themes to tilt toward (e.g. "clean energy, healthcare"). */
  favoredSectors?: string;
  /** Free-text sectors or companies to exclude (e.g. "fossil fuels, tobacco"). */
  avoidedSectors?: string;
  /**
   * When true, restricts the ETF universe to ESG-screened funds only.
   * May reduce Sharpe ratio — agent will note the trade-off.
   */
  esgOnly?: boolean;
}

/**
 * Complete set of intake answers collected by the IntakeWizard (12 questions).
 *
 * Q1  — goal + goalAmount
 * Q2  — timeHorizon
 * Q3  — startingCapital
 * Q4  — monthlyContribution
 * Q5  — financialSnapshot
 * Q6  — filingStatus
 * Q7  — annualIncome
 * Q8  — state
 * Q9  — age
 * Q10 — existingAccounts
 * Q11 — riskCapacity + riskWillingness
 * Q12 — incomeStability
 *
 * Plus non-question fields collected during the wizard:
 *   availableAccounts, investmentPreferences
 */
export interface IntakeAnswers {
  // ── Q1: Goal ────────────────────────────────────────────────────────────────

  /** Primary investment objective driving portfolio construction. */
  goal: PrimaryGoal;

  /**
   * Target portfolio value at the end of the time horizon (USD).
   * Required for goal feasibility analysis. Optional for `max_growth` goals
   * where the investor has no specific number in mind.
   */
  goalAmount?: number;

  // ── Q2: Time Horizon ────────────────────────────────────────────────────────

  /** Years until the investor needs to begin drawing from this portfolio. */
  timeHorizon: number;

  // ── Q3: Starting Capital ─────────────────────────────────────────────────────

  /** Total investable assets available to deploy today (USD). */
  startingCapital: number;

  // ── Q4: Monthly Contribution ─────────────────────────────────────────────────

  /**
   * Regular monthly savings added to the portfolio (USD).
   * Enter 0 for lump-sum-only investors.
   */
  monthlyContribution: number;

  // ── Q5: Financial Snapshot ───────────────────────────────────────────────────

  /**
   * Near-term financial health indicators.
   * Determines whether a liquidity sleeve or debt-payoff note is included.
   */
  financialSnapshot: FinancialSnapshot;

  // ── Q6: Filing Status ────────────────────────────────────────────────────────

  /**
   * Federal tax filing status.
   * Combined with annualIncome to derive marginal rates and LTCG brackets.
   */
  filingStatus: FilingStatus;

  // ── Q7: Annual Income ────────────────────────────────────────────────────────

  /**
   * Annual gross household income before deductions (USD).
   * For MFJ filers this should be combined household income.
   */
  annualIncome: number;

  // ── Q8: State ────────────────────────────────────────────────────────────────

  /**
   * Two-letter US state code (e.g. "CA", "TX").
   * Used to look up the state marginal income tax rate.
   */
  state: string;

  // ── Q9: Age ──────────────────────────────────────────────────────────────────

  /**
   * Investor's current age (years).
   * Affects Social Security timing, RMD planning, and Roth conversion windows.
   */
  age: number;

  // ── Q10: Existing Accounts ───────────────────────────────────────────────────

  /**
   * Balances in existing tax-advantaged accounts.
   * Informs asset location and whether new contributions flow to a new vs.
   * existing account.
   */
  existingAccounts: ExistingAccountBalances;

  // ── Q11: Risk ────────────────────────────────────────────────────────────────

  /**
   * Financial ability to absorb losses without materially harming the plan.
   * Driven by income stability, time horizon, and emergency fund status —
   * NOT by emotional preference. High-income, long-horizon investors have
   * high capacity regardless of how they feel about volatility.
   */
  riskCapacity: RiskLevel;

  /**
   * Behavioral / emotional tolerance for portfolio drawdowns.
   * Derived from the "market drops 30%" scenario question.
   * May be lower than riskCapacity — the agent resolves conflicts conservatively.
   */
  riskWillingness: RiskLevel;

  // ── Q12: Income Stability ────────────────────────────────────────────────────

  /**
   * How predictable the investor's income is.
   * Lower values → larger liquidity buffer, smaller illiquid positions.
   */
  incomeStability: IncomeStabilityLevel;

  // ── Supporting fields (collected during wizard, not numbered questions) ───────

  /**
   * Account types the investor can contribute to going forward.
   * Drives the asset location feasibility check in Agent 1.
   * Common values: "Taxable Brokerage", "Traditional 401(k)", "Roth IRA", "HSA".
   */
  availableAccounts: string[];

  /**
   * Optional sector or ESG tilts to constrain the ETF universe.
   * When undefined or all fields omitted, the agent uses pure quant optimization.
   */
  investmentPreferences?: InvestmentPreferences;
}

// ─── 2. Agent1Output (Client Profile Agent) ───────────────────────────────────

/**
 * Structured risk profile derived deterministically from IntakeAnswers.
 * Replaces the raw intake fields with normalized scores the downstream
 * construction agent can consume directly.
 */
export interface DerivedRiskProfile {
  /**
   * Composite risk score on a 1–10 scale.
   * 1–3 = conservative, 4–5 = moderate, 6–7 = aggressive, 8–10 = very aggressive.
   * Computed as a weighted blend of riskCapacity, riskWillingness, and time horizon.
   */
  riskScore: number;

  /** Investor's financial ability to absorb losses (capacity dimension). */
  riskCapacity: RiskLevel;

  /** Investor's behavioral tolerance for drawdowns (willingness dimension). */
  riskWillingness: RiskLevel;

  /**
   * Single authoritative risk tolerance label used to select the construction template.
   * When capacity < willingness, the lower dimension wins (conservative override).
   */
  effectiveRiskTolerance: 'conservative' | 'moderate' | 'aggressive' | 'very_aggressive';

  /**
   * Hard ceiling on equity allocation (0–1 decimal).
   * e.g. 0.65 means no more than 65% of the portfolio can be in equities.
   * Derived from effectiveRiskTolerance and time horizon bucket.
   */
  maxEquityAllowed: number;
}

/**
 * Marginal tax rates derived from annualIncome, filingStatus, and state.
 * All values are decimals (e.g. 0.22 = 22%).
 */
export interface DerivedTaxProfile {
  /** 2026 federal marginal income tax rate. */
  federalMarginalRate: number;
  /** State marginal income tax rate. 0 for states with no income tax. */
  stateMarginalRate: number;
  /** federalMarginalRate + stateMarginalRate. Used for ordinary income decisions. */
  combinedMarginalRate: number;
  /**
   * Long-term capital gains rate (0, 0.15, or 0.20).
   * Determined by taxable income vs. LTCG bracket thresholds for the filing status.
   */
  ltcgRate: number;
}

/**
 * Normalized time horizon derived from raw yearsToGoal.
 * The bucket drives construction template selection independent of the
 * raw year count.
 */
export interface DerivedTimeHorizon {
  /** Raw years until the investor needs to begin withdrawals. */
  yearsToGoal: number;
  /**
   * Categorical bucket:
   *   short     < 5 years
   *   medium    5–14 years
   *   long      15–24 years
   *   very_long ≥ 25 years
   */
  bucket: TimeHorizonBucket;
  /**
   * True when the investor is already taking withdrawals (yearsToGoal ≤ 0).
   * Triggers a sequence-of-returns risk guard and shifts to income-heavy templates.
   */
  isInDrawdownPhase: boolean;
}

/**
 * Assessment of whether the stated goal is achievable given current inputs.
 */
export interface GoalAnalysis {
  /** Target portfolio value at end of time horizon (USD). 0 if no goal was stated. */
  goalAmount: number;
  /**
   * Present value of the goal amount discounted at the expected real return.
   * Compared against startingCapital to derive fundedStatus.
   */
  presentValue: number;
  /**
   * Future value of the lump-sum starting capital compounded at 7% for yearsToGoal (USD).
   * Zero when no goal is stated.
   */
  futureValueOfCapital: number;
  /**
   * Future value of all monthly contributions compounded at 7% for yearsToGoal (USD).
   * Uses the standard annuity FV formula. Zero when no goal or no contributions.
   */
  futureValueOfContributions: number;
  /**
   * futureValueOfCapital + futureValueOfContributions — total projected wealth at goal year.
   * This is the primary input to fundedStatus (replaces the PV-only approach).
   */
  totalProjectedValue: number;
  /**
   * Ratio of totalProjectedValue to goalAmount (0–1+).
   * > 1.0 = overfunded, 1.0 = exactly on track, < 1.0 = underfunded.
   * Accounts for both current capital and ongoing monthly contributions.
   */
  fundedStatus: number;
  /** Human-readable feasibility verdict. */
  feasibility: FeasibilityRating;
}

/**
 * Near-term liquidity requirements that must be ring-fenced before investing.
 */
export interface LiquidityNeeds {
  /**
   * Months of expenses that should be held in cash / money market outside
   * the invested portfolio. Higher for low-incomeStability or no emergency fund.
   */
  monthsRequired: number;
  /**
   * Dollar value of a known upcoming large expense.
   * When set, a separate liquidity sleeve of this amount is reserved.
   */
  plannedExpense?: number;
}

/**
 * Summary of the investor's current account infrastructure.
 */
export interface AccountStructure {
  /** Account types available for future contributions. */
  availableAccounts: string[];
  /** Current balances in existing tax-advantaged accounts. */
  existingBalances: ExistingAccountBalances;
  /**
   * True when existingBalances.traditional + roth + hsa > 0,
   * indicating an existing portfolio to consider for tax-lot harvesting.
   */
  hasExistingPortfolio: boolean;
}

/**
 * Hard constraints and soft warnings the downstream agents must respect.
 */
export interface AgentConstraints {
  /**
   * Rules that may never be violated (e.g. "max equity 40% — drawdown phase",
   * "no illiquid alts — short horizon"). Construction agent treats these as
   * knock-out criteria during Sharpe optimization.
   */
  hardStops: string[];
  /**
   * Non-blocking flags surfaced in the owner manual (e.g. "high-interest debt
   * present — consider paying down before investing aggressively").
   */
  warnings: string[];
}

/**
 * Output of Agent 1 — Client Profile.
 *
 * Transforms raw IntakeAnswers into normalized, typed signals consumed by
 * Agents 2 and 3. Runs deterministically (no LLM call) in the current pipeline.
 */
export interface Agent1Output {
  /** Always "clientProfile" — used for log routing. */
  agentName: 'clientProfile';
  /** ISO 8601 timestamp when the agent completed. */
  timestamp: string;
  /** Wall-clock duration of this agent's execution (ms). */
  executionTimeMs: number;

  /** Normalized risk scores and equity ceiling. */
  riskProfile: DerivedRiskProfile;

  /** Marginal tax rates derived from income, filing status, and state. */
  taxProfile: DerivedTaxProfile;

  /** Categorical time horizon with drawdown-phase flag. */
  timeHorizon: DerivedTimeHorizon;

  /** Goal feasibility and funded-status analysis. */
  goalAnalysis: GoalAnalysis;

  /** Cash reserves that must be held outside the invested portfolio. */
  liquidityNeeds: LiquidityNeeds;

  /** Investor's existing account infrastructure summary. */
  accountStructure: AccountStructure;

  /** Hard stops and soft warnings for downstream agents. */
  constraints: AgentConstraints;

  /**
   * Total investable assets available at intake time (USD).
   * Passed through from IntakeAnswers.startingCapital for use by
   * downstream agents (Monte Carlo, goal feasibility).
   */
  startingCapital: number;

  /**
   * Regular monthly savings added to the portfolio (USD).
   * Passed through from IntakeAnswers.monthlyContribution.
   */
  monthlyContribution: number;

  /** Latency / SLA telemetry. */
  performance: AgentPerformance;
}

// ─── 3. Agent2Output (Capital Markets Agent) ──────────────────────────────────

/**
 * Raw macro data points fetched or cached for this run.
 * All rate fields are decimals (e.g. 0.0525 = 5.25%).
 */
export interface MacroDataPoints {
  /**
   * Current Federal Funds target rate (upper bound of the FOMC target range).
   * Primary driver of money-market and short-duration bond expected returns.
   */
  fedFundsRate: number;
  /**
   * 10-Year US Treasury constant-maturity yield.
   * Used as the risk-free rate in Sharpe ratio calculations.
   */
  treasury10Y: number;
  /**
   * Consumer Price Index — year-over-year change.
   * Informs real (inflation-adjusted) return expectations.
   */
  cpiYoY: number;
  /**
   * Shiller Cyclically Adjusted P/E ratio (CAPE10).
   * Used to classify equity valuation as expensive / fair / cheap.
   */
  shillerCAPE: number;
}

/**
 * Current market regime and narrative context for portfolio tilting.
 */
export interface MarketRegimeContext {
  /** Binary regime — risk_on favors equities, risk_off favors safety assets. */
  current: MarketRegime;
  /**
   * One-paragraph human-readable explanation of current conditions
   * (rate direction, credit spreads, growth vs. recession signals).
   * Surfaced verbatim in the Macro tab.
   */
  narrative: string;
}

/**
 * Actionable outlook by asset class, derived from macroData and regime.
 */
export interface AssetClassOutlook {
  /** Whether equities are priced expensively relative to earnings history. */
  equityValuation: 'expensive' | 'fair' | 'cheap';
  /** Whether fixed income offers compelling real yields. */
  bondOpportunity: 'attractive' | 'neutral' | 'unattractive';
  /**
   * The risk-free rate used in Sharpe calculations for this run — equals
   * treasury10Y. Stored explicitly so downstream agents don't re-fetch.
   */
  riskFreeRate: number;
}

/**
 * Output of Agent 2 — Capital Markets.
 *
 * Provides the macro backdrop for portfolio construction. Sourced from a
 * live web-search call; falls back to a cache hit or static baseline when
 * the search is unavailable or too slow.
 */
export interface Agent2Output {
  /** Always "capitalMarkets" — used for log routing. */
  agentName: 'capitalMarkets';
  /** ISO 8601 timestamp when the agent completed. */
  timestamp: string;
  /** Wall-clock duration of this agent's execution (ms). */
  executionTimeMs: number;

  /**
   * Where the macro data came from.
   * The UI may surface a "live data" badge when this is "live".
   */
  dataSource: MacroDataSource;

  /** Numeric macro data points for this run. */
  macroData: MacroDataPoints;

  /** Regime classification and explanatory narrative. */
  regime: MarketRegimeContext;

  /** Per-asset-class directional outlook. */
  assetClassOutlook: AssetClassOutlook;

  /** Latency / SLA telemetry. */
  performance: AgentPerformance;
}

// ─── 4. AllocationSlice ───────────────────────────────────────────────────────

/**
 * A single position in the constructed portfolio.
 *
 * Note: this type lives in the agents layer (not the UI layer) and uses
 * `category` instead of `bucket` to avoid naming collisions with the existing
 * UI-layer AllocationSlice in src/apps/portfolio-agent/types.ts.
 */
export interface AllocationSlice {
  /**
   * ETF ticker symbol (e.g. "VTI", "AVUV", "BND").
   * Must be present in the whitelisted ETF universe.
   */
  ticker: string;

  /**
   * Portfolio weight as a decimal (0–1).
   * All weights in a valid allocation must sum to 1.0 (±0.001 rounding tolerance).
   */
  weight: number;

  /**
   * Functional role in the 3-bucket framework.
   *   safety      — capital preservation, short-duration bonds, money market
   *   growth      — equity appreciation (domestic, international, factor)
   *   income      — dividend / coupon cash flow
   *   alternative — inflation protection, real assets, diversifiers
   */
  category: AllocationCategory;

  /**
   * Optimal account type for this holding to minimize tax drag.
   *   taxable     — tax-efficient (low turnover, qualified dividends)
   *   traditional — tax-inefficient (high yield, REITs, bond funds)
   *   roth        — high-growth equities (maximize tax-free compounding)
   *   hsa         — assigned only when hsa balance > 0
   *   any         — negligible tax consequence, place anywhere
   */
  accountPlacement: AccountPlacement;
}

// ─── 5. Agent3Output (Portfolio Construction Agent) ───────────────────────────

/**
 * Portfolio-level statistics computed from the final allocation.
 * All rate fields are decimals. Sharpe uses the risk-free rate from Agent2Output.
 */
export interface PortfolioStatistics {
  /**
   * Blended 10-year Capital Market Assumption (CMA) annualized return.
   * Computed as the weighted sum of each ETF's forward expected return.
   */
  expectedReturn: number;

  /**
   * Annualized portfolio volatility (σ) from the full covariance matrix.
   * Computed as √(wᵀΣw) — not a simple weighted average.
   */
  expectedVolatility: number;

  /**
   * Sharpe ratio = (expectedReturn − riskFreeRate) / expectedVolatility.
   * Higher is better. The primary optimization objective.
   */
  sharpeRatio: number;

  /**
   * Estimated maximum peak-to-trough drawdown in a severe bear market.
   * Derived from historical stress scenarios, not Monte Carlo.
   * Expressed as a positive decimal (e.g. 0.28 = −28% drawdown).
   */
  maxDrawdownEstimate: number;

  /**
   * Asset-weighted average expense ratio across all holdings.
   * Lower is better — directly subtracts from net return.
   */
  weightedExpenseRatio: number;
}

/**
 * Per-ETF rationale entry explaining why a position was included,
 * its final weight, and where it should be held.
 */
export interface EtfRationaleEntry {
  /**
   * Final portfolio weight as a decimal (0–1).
   * Matches the corresponding AllocationSlice.weight.
   */
  allocation: number;

  /**
   * One-to-two sentence explanation of the position's role
   * (factor exposure, macro fit, diversification contribution, etc.).
   * Surfaced in the Allocation tab's holding detail rows.
   */
  rationale: string;

  /**
   * Recommended account type for this ETF.
   * Matches the corresponding AllocationSlice.accountPlacement.
   */
  accountPlacement: AccountPlacement;
}

/**
 * Output of Agent 3 — Portfolio Construction.
 *
 * Produces the final allocation array, computed statistics, and per-position
 * rationale. The allocation is guaranteed to pass the critic score threshold
 * or the pipeline will flag it for revision.
 */
export interface Agent3Output {
  /** Always "portfolioConstruction" — used for log routing. */
  agentName: 'portfolioConstruction';
  /** ISO 8601 timestamp when the agent completed. */
  timestamp: string;
  /** Wall-clock duration of this agent's execution (ms). */
  executionTimeMs: number;

  /**
   * Final allocation array.
   * Weights sum to 1.0. Each entry also appears as a key in etfRationale.
   */
  allocation: AllocationSlice[];

  /**
   * Aggregate portfolio statistics computed from allocation + covariance matrix.
   * Used by the Sharpe optimizer and surfaced in the Summary and Benchmark tabs.
   */
  statistics: PortfolioStatistics;

  /**
   * Per-ticker rationale map.
   * Keys are ticker symbols (e.g. "VTI"), values explain the position.
   * Every ticker in `allocation` must have a corresponding entry here.
   */
  etfRationale: Record<string, EtfRationaleEntry>;

  /** Latency / SLA telemetry. */
  performance: AgentPerformance;
}

// ─── 6. Agent4Output (Risk Analysis Agent) ────────────────────────────────────

/** Severity level of an individual risk check. */
export type RiskCheckLevel = 'pass' | 'warn' | 'flag';

/** Result of a single risk dimension check. */
export interface RiskCheck {
  /** Short label identifying the check (e.g. "concentration", "drawdown"). */
  name: string;
  /** Outcome of the check. */
  level: RiskCheckLevel;
  /** Human-readable detail shown in the risk panel. Empty string when passing. */
  detail: string;
}

/**
 * Output of Agent 4 — Risk Analysis.
 *
 * Runs entirely deterministically against Agent 3 output — no LLM, no I/O.
 * Produces a risk verdict, per-check results, and actionable warnings.
 */
export interface Agent4Output {
  /** Always "riskAnalysis" — used for log routing. */
  agentName: 'riskAnalysis';
  /** ISO 8601 timestamp when the agent completed. */
  timestamp: string;
  /** Wall-clock duration of this agent's execution (ms). */
  executionTimeMs: number;

  /**
   * Aggregate risk verdict across all checks.
   *   low    — no meaningful risks detected
   *   medium — at least one warn-level check
   *   high   — at least one flag-level check
   */
  riskLevel: 'low' | 'medium' | 'high';

  /**
   * Actionable warning strings surfaced in the UI risk panel.
   * Empty array when riskLevel is 'low'.
   */
  warnings: string[];

  /**
   * True when the portfolio can proceed to the output step without revision.
   * False when riskLevel is 'high' — triggers a construction revision pass.
   */
  passesRiskCheck: boolean;

  /** Granular per-check results for the risk detail panel. */
  checks: RiskCheck[];

  /** Latency / SLA telemetry. */
  performance: AgentPerformance;
}

// ─── 7. Agent5Output (Tax Optimization Agent) ────────────────────────────────

/** Category of tax optimization action. */
export type TaxRecommendationType =
  | 'muni_bond'       // VTEB vs BND selection based on bracket
  | 'asset_location'  // account-type placement swaps
  | 'tlh'             // tax-loss harvesting opportunity
  | 'roth_conversion';// traditional → Roth conversion window

/**
 * A single actionable tax optimization recommendation.
 */
export interface TaxRecommendation {
  /** Category of the recommendation. */
  type: TaxRecommendationType;
  /** Triage priority — determines display order in the tax panel. */
  priority: 'high' | 'medium' | 'low';
  /** Short heading shown in the recommendation card. */
  title: string;
  /** 1–2 sentence explanation with specific numbers where available. */
  detail: string;
  /** Estimated annual saving from this action alone (basis points, ≥ 0). */
  estimatedSavingsBps: number;
}

/**
 * Output of Agent 5 — Tax Optimization.
 *
 * Deterministic — no LLM, no I/O. Scans the portfolio and client profile
 * for tax inefficiencies and quantifies the improvement opportunity.
 */
export interface Agent5Output {
  /** Always "taxOptimization" — used for log routing. */
  agentName: 'taxOptimization';
  /** ISO 8601 timestamp when the agent completed. */
  timestamp: string;
  /** Wall-clock duration of this agent's execution (ms). */
  executionTimeMs: number;

  /** Ordered list of actionable tax recommendations. */
  recommendations: TaxRecommendation[];

  /**
   * Sum of estimatedSavingsBps across all recommendations.
   * Represents the annual return uplift from implementing every suggestion.
   */
  estimatedAnnualSavings: number;

  /**
   * Tax-loss harvesting pairs available given the current portfolio.
   * Each entry lists the held ticker and a wash-sale-safe substitute.
   */
  tlhPairs: { ticker: string; substitute: string }[];

  /** Latency / SLA telemetry. */
  performance: AgentPerformance;
}

// ─── 8. Agent6Output (Critic Agent) ──────────────────────────────────────────

/** Per-dimension scores contributing to the overall portfolio score. */
export interface CriticScores {
  /** Risk/horizon/goal alignment with client profile (0–100). */
  alignment: number;
  /** Geographic and asset-class spread (0–100). */
  diversification: number;
  /** Tax-efficiency of structure and placement (0–100). */
  taxEfficiency: number;
  /** Expense ratio competitiveness (0–100). */
  costEfficiency: number;
  /** Risk check outcomes and drawdown safety (0–100). */
  riskManagement: number;
  /** Weighted composite across all five dimensions (0–100). */
  overall: number;
}

/**
 * Output of Agent 6 — Critic.
 *
 * Scores the assembled portfolio across five dimensions and decides whether
 * the pipeline should trigger a revision pass. For MVP, revision is always
 * disabled (requiresRevision is hard-coded false until the iteration loop
 * is wired up).
 */
export interface Agent6Output {
  /** Always "critic" — used for log routing. */
  agentName: 'critic';
  /** ISO 8601 timestamp when the agent completed. */
  timestamp: string;
  /** Wall-clock duration of this agent's execution (ms). */
  executionTimeMs: number;

  /** Dimension and composite scores. */
  scores: CriticScores;

  /**
   * True when overallScore < 85 OR Agent 4 flagged HIGH risk.
   * Always false in MVP — revision loop not yet implemented.
   */
  requiresRevision: boolean;

  /**
   * True when overallScore ≥ 85.
   * Used by the pipeline to gate whether the plan is surfaced to the user.
   */
  passesThreshold: boolean;

  /**
   * Up to 3 concrete improvement suggestions ranked by impact.
   * Empty when passesThreshold is true and requiresRevision is false.
   */
  improvementSuggestions: string[];

  /** Latency / SLA telemetry. */
  performance: AgentPerformance;
}

// ─── 9. MonteCarloOutput ─────────────────────────────────────────────────────


/** Projected portfolio values at a single future point in time. */
export interface ProjectionPoint {
  /** Year from today (e.g. 1, 5, 10, 20, 30). */
  year: number;
  /** 10th percentile outcome — poor market sequence (USD). */
  p10: number;
  /** 50th percentile outcome — median expectation (USD). */
  p50: number;
  /** 90th percentile outcome — favorable market sequence (USD). */
  p90: number;
}

/**
 * Output of the analytical Monte Carlo approximation.
 *
 * Uses a closed-form lognormal model — no simulation loop.
 * Projections include contributions compounded via future-value formula.
 */
export interface MonteCarloOutput {
  /** Projected values at years 1, 5, 10, 20, and 30. */
  projections: ProjectionPoint[];
  /** Probability of reaching the stated goal amount by yearsToGoal (0–1). */
  goalSuccessProbability: number;
  /** Inputs used for this projection run (for transparency / caching). */
  inputs: {
    initialValue: number;
    monthlyContribution: number;
    annualReturn: number;
    annualVolatility: number;
    years: number;
  };
  /** Wall-clock execution time in ms. */
  executionTimeMs: number;
}

// ─── 10. Agent7Output (LLM synthesis) ────────────────────────────────────────

/**
 * Output of Agent 7: the LLM synthesis agent.
 * Provides the human-readable narrative layer on top of the quantitative plan.
 */
export interface Agent7Output {
  agentName: 'synthesis';
  timestamp: string;
  executionTimeMs: number;

  /**
   * 2–3 paragraph narrative explaining why this specific portfolio was built
   * for this specific user — written in plain English, not financial jargon.
   */
  portfolioNarrative: string;

  /**
   * 3–5 concise bullet points summarising the most important personalisation
   * decisions made for this user (e.g. "High tax bracket → VTEB over BND").
   */
  keyInsights: string[];

  /**
   * The single biggest risk the user should understand about their plan.
   */
  primaryRisk: string;

  /**
   * 3 concrete actionable next steps the user should take to implement the plan.
   */
  actionableNextSteps: string[];

  performance: AgentPerformance;
}

// ─── 11. V3Plan (full pipeline output) ───────────────────────────────────────

/**
 * Complete output of the v3 portfolio agent pipeline.
 * Assembled in the POST /api/portfolio-agent route and cached in Neon.
 */
export interface V3Plan {
  version: 'v3';
  /** ISO 8601 timestamp when the plan was assembled. */
  generatedAt: string;
  clientProfile:   Agent1Output;
  economicIntel:   Agent2Output;
  portfolio:       Agent3Output;
  riskAnalysis:    Agent4Output;
  taxOptimization: Agent5Output;
  criticScore:     Agent6Output;
  monteCarlo:      MonteCarloOutput;
  /** LLM-generated narrative. Present when GEMINI_API_KEY is configured. */
  synthesis?:      Agent7Output;
}
