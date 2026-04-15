// ─── Portfolio Agent — Types ──────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'running' | 'complete' | 'error';

export type AgentName =
  | 'clientProfile'
  | 'capitalMarkets'
  | 'portfolioConstruction'
  | 'riskAgent'
  | 'taxImplementation'
  | 'criticEvaluator';

export interface AgentResult<T = unknown> {
  agent: AgentName;
  status: AgentStatus;
  output: T;
  error?: string;
  durationMs?: number;
}

export interface AgentRunState {
  status: AgentStatus;
  currentAgent: AgentName | null;
  iteration: number;
  results: Partial<Record<AgentName, AgentResult>>;
  criticScore?: CriticScore;
  completedAt?: string;
  logs: string[];
}

// ─── Intake (11 Questions) ────────────────────────────────────────────────────

export interface IntakeAnswers {
  // Q1
  primaryGoal: 'financial_independence' | 'major_purchase' | 'max_growth' | 'legacy';
  // Q2
  startingCapital: number;
  // Q3
  monthlyContribution: number;
  // Q4
  yearsUntilWithdrawal: number;
  // Q5
  incomeStability: 1 | 2 | 3 | 4 | 5;
  // Q6
  marketDropReaction: 'panic' | 'passive' | 'aggressive';
  // Q7
  hasEmergencyFund: boolean;
  // Q8
  hasLargeExpense: boolean;
  largeExpenseAmount?: number;
  // Q9
  state: string;
  annualIncome: number;
  // Q10
  accounts: string[];
  // Q11
  hasSectorPreferences: boolean;
  favoredSectors?: string;
  avoidedSectors?: string;
}

// ─── Agent Outputs ────────────────────────────────────────────────────────────

export interface InvestorProfile {
  riskScore: number;            // 1–10 derived
  derivedRiskTolerance: 'conservative' | 'moderate' | 'aggressive' | 'very_aggressive';
  effectiveMarginalRate: number;
  capitalGainsRate: number;
  liquidityNeedMonths: number;
  timeHorizonBucket: 'short' | 'medium' | 'long' | 'very_long';
  goalFeasibility: 'achievable' | 'stretch' | 'requires_adjustment';
  behavioralBias: string;       // e.g. "loss-averse, needs guardrails"
  constraints: string[];
  narrative: string;
}

export interface MacroContext {
  fedFundsRate: string;
  tenYearYield: string;
  cpi: string;
  regime: 'risk_on' | 'risk_off' | 'transitional';
  equityValuation: 'expensive' | 'fair' | 'cheap';
  bondOpportunity: 'attractive' | 'neutral' | 'unattractive';
  keyRisks: string[];
  tailwinds: string[];
  cmaSummary: string;
  narrative: string;
  sources: string[];
}

export interface AllocationSlice {
  ticker: string;
  name: string;
  weight: number;               // 0–1
  assetClass: string;
  bucket: 'safety' | 'growth' | 'income' | 'alternative';
  expectedAnnualReturn: number; // decimal
  rationale: string;
  accountPlacement: 'taxable' | 'traditional' | 'roth' | 'hsa' | 'any';
}

export interface PortfolioDraft {
  allocation: AllocationSlice[];
  expectedReturn: number;
  expectedVolatility: number;
  sharpeEstimate: number;
  monteCarloP10: number;
  monteCarloP50: number;
  monteCarloP90: number;
  successProbability: number;
  constructionRationale: string;
}

export interface RiskAssessment {
  approved: boolean;
  maxDrawdownEstimate: number;
  concentrationRisk: string;
  sequenceRisk: string;
  inflationSensitivity: string;
  liquidityRisk: string;
  durationRisk: string;
  flags: string[];
  adjustedAllocation?: AllocationSlice[];
}

export interface TaxPlan {
  assetLocationMap: Record<string, string>;
  estimatedAnnualTaxSaving: number;
  harvesting: string;
  rothConversionOpportunity: boolean;
  muniBondSuitable: boolean;
  hsaStrategy: string;
  implementationSteps: string[];
}

export interface CriticScore {
  suitability: number;          // /30
  riskAlignment: number;        // /25
  goalFeasibility: number;      // /20
  taxEfficiency: number;        // /15
  diversification: number;      // /10
  total: number;                // /100
  hardFail: boolean;
  hardFailReasons: string[];
  top3Deficiencies: string[];
  shouldRevise: boolean;
  commentary: string;
}

// ─── Benchmark Comparison ─────────────────────────────────────────────────────

export interface AlphaSource {
  source: string;         // e.g. "Factor Premiums", "Tax Alpha"
  bps: number;            // basis points of contribution (100 bps = 1%)
  description: string;
}

export interface BenchmarkComparison {
  // VT (Vanguard Total World) stats — the passive global-market benchmark
  vtExpectedReturn: number;
  vtVolatility: number;
  vtSharpe: number;
  vtMonteCarloP10: number;
  vtMonteCarloP50: number;
  vtMonteCarloP90: number;
  vtSuccessProbability: number;
  vtAfterTaxReturn: number;
  // Portfolio outperformance
  returnAlpha: number;      // portfolio return − VT return
  sharpeAlpha: number;      // portfolio Sharpe − VT Sharpe
  afterTaxAlpha: number;    // portfolio after-tax return − VT after-tax return
  // Where the alpha comes from
  alphaAttribution: AlphaSource[];
}

// ─── Final Plan ───────────────────────────────────────────────────────────────

export interface PortfolioPlan {
  allocation: AllocationSlice[];
  expectedReturn: number;
  expectedVolatility: number;
  sharpeEstimate: number;
  monteCarloP10: number;
  monteCarloP50: number;
  monteCarloP90: number;
  successProbability: number;
  macroContext: MacroContext;
  taxPlan: TaxPlan;
  riskAssessment: RiskAssessment;
  criticScore: CriticScore;
  iterationsRan: number;
  investorProfile: InvestorProfile;
  ownerManual: OwnerManualSection[];
  executiveSummary: string;
  generatedAt: string;
  benchmarkComparison: BenchmarkComparison;
}

export interface OwnerManualSection {
  title: string;
  body: string;
  frequency?: string;
}

