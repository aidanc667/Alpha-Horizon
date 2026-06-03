// ─── Shared Platform Types ──────────────────────────────────────────────────

export type ActiveTab = 'planner' | 'lab' | 'market-home' | 'market-long' | 'market-near' | 'advisor' | 'arena';

// ─── Financial Planner Types ─────────────────────────────────────────────────

export enum RiskTolerance {
  CONSERVATIVE = 'Conservative',
  MODERATE = 'Moderate',
  AGGRESSIVE = 'Aggressive',
}

export interface OnboardingResponses {
  [key: string]: string | number | string[] | undefined;
}

export interface AssetAllocation {
  name: string;
  ticker: string;
  percentage: number;
  rationale: string;
  projectedCAGR: number;
  projectedVolatility: number;
}

export interface HysaComparison {
  hysa_gross_rate: number;
  hysa_after_tax_rate: number;
  recommended_asset_rate: number;
  recommended_asset_name: string;
  advantage_basis_points: number;
  rationale: string;
}

export interface StrategyBucket {
  name: string;
  allocationPercent: number;
  estimatedDollarAmount: number;
  assets: AssetAllocation[];
  explanation: string;
}

export interface SafetyStrategyBucket extends StrategyBucket {
  cash_allocation_pct: number;
  cash_rationale: string;
  hysa_comparison: HysaComparison;
}

export interface TaxLocationEntry {
  accountType: string;
  assets: string[];
  percentage: number;
  reasoning: string;
}

export interface PaycheckWaterfallStep {
  rank: number;
  name: string;
  percentage: number;
  description: string;
  reasoning: string;
}

export interface TaxAlphaMapping {
  account: string;
  assets: string[];
  rationale: string;
}

export interface TaxAlphaCalculation {
  asset: string;
  nominalYield: number;
  taxEquivalentYield: number;
  advantage: string;
}

export interface AssetPlacementAccount {
  accountType: string;   // e.g. "Taxable Brokerage", "Roth IRA", "Traditional 401k"
  accentColor: string;   // e.g. "emerald", "blue", "purple", "amber"
  assets: { ticker: string; reason: string }[];
  strategy: string;      // 1-2 sentence explanation
}

export interface CaAfterTaxYield {
  ticker: string;
  name: string;
  nominalYield: number;    // as percentage e.g. 4.5
  afterTaxYield: number;   // as percentage e.g. 2.9
  taxType: string;         // e.g. "Fully Taxable", "CA State Exempt", "Fully Tax-Exempt"
  recommendation: string;  // "Best", "Good", "Avoid" or "N/A"
}

export interface RothVs401kRow {
  factor: string;
  roth: string;
  traditional401k: string;
}

export interface TaxAlphaData {
  totalAlphaPct: number;         // e.g. 0.82
  explanation: string;
  assetPlacementMatrix: AssetPlacementAccount[];
  caAfterTaxYields: CaAfterTaxYield[];
  rothVs401k: {
    recommendation: string;      // "both" | "roth_first" | "401k_first"
    headline: string;
    comparisonRows: RothVs401kRow[];
    reasoning: string;
    actionPlan: string;
  };
  taxProfile: {
    marginalFederal: number;
    marginalCA: number;
    effectiveRate: number;
    estimatedAnnualTax: number;
    analysis: string;
    federalQDRate?: number;
    estimatedFederalTax?: number;
    estimatedCATax?: number;
    taxableIncome?: number;
    standardDeduction2026?: string;
  };
  locationReasoningNarrative: string;  // 2-3 paragraph explanation of why these locations maximize tax-alpha
}

export interface PersonalizedPlan {
  summary: {
    bucketSizes: {
      shortTerm:  { percent: number; dollar: number };
      longTerm:   { percent: number; dollar: number };
      retirement: { percent: number; dollar: number };
    };
    keyTakeaways: string[];
    projectedOutcome?: number;
    successProbability?: number;
  };
  marketGroundedRates: {
    shortTerm:  { rate: number; volatility: number };
    longTerm:   { rate: number; volatility: number };
    retirement: { rate: number; volatility: number };
  };
  shortTermStrategy:  SafetyStrategyBucket;
  longTermStrategy:   StrategyBucket;
  retirementStrategy: {
    allocation: StrategyBucket;
    assetLocationGuidance: string;
  };
  taxLocationOptimizer: TaxLocationEntry[];
  taxProfile?: {
    marginalBracket: string;
    effectiveRate: string;
    estimatedTaxDollar: number;
    explanation: string;
  };
  taxAlphaOptimization?: {
    engineName: string;
    assetLocationStrategy: {
      title: string;
      description: string;
      mapping: TaxAlphaMapping[];
    };
    taxEquivalentYieldAnalysis: {
      title: string;
      description: string;
      calculations: TaxAlphaCalculation[];
    };
    totalEstimatedAlpha: string;
  };
  paycheckWaterfall: PaycheckWaterfallStep[];
  taxAlphaData?: TaxAlphaData;
  gapRecoveryStrategies?: { title: string; impact: string; description: string }[];
  assumptions: string[];
  riskProfile: {
    summary: string;
    capacity: string;
    tolerance: string;
    horizon: string;
  };
  actionChecklist: {
    step: string;
    action: string;
    details: string;
    priority: string;
  }[];
  safetyBucketVsHysa?: {
    hysaRate: number;
    safetyAssetRate: number;
    advantageDescription: string;
  };
  fullReport?: string;
  sources?: { uri: string; title: string }[];
}

export interface IPSTargetAllocation {
  bucketName: string;
  targetPct: number;
  rangeLow: number;
  rangeHigh: number;
  holdings: { ticker: string; name: string; weight: number; accountPlacement: string }[];
}

export interface IPSDocument {
  generatedDate: string;
  clientProfile: {
    riskScore: number;
    derivedRiskTolerance: string;
    effectiveMarginalRate: number;
    horizon: number;
    state: string;
    filingStatus: string;
    primaryGoal: string;
    goalAmount?: number;
  };
  investmentObjective: string;
  constraints: {
    liquidityRequirement: string;
    taxConsiderations: string;
    restrictions: string[];
    rebalancingPolicy: string;
    reviewSchedule: string;
  };
  targetAllocation: IPSTargetAllocation[];
  riskParameters: {
    maxDrawdownTolerance: string;
    concentrationLimit: string;
    sequenceRisk: string;
    expectedVolatility: string;
  };
  taxStrategy: {
    assetLocationSummary: string;
    keyTaxActions: string[];
    estimatedAnnualTaxAlpha: number;
    rothConversionOpportunity: boolean;
    muniBondSuitable: boolean;
  };
  benchmarks: { primary: string; secondary: string; expectedReturnVsBenchmark: number; sharpeVsBenchmark: number };
  executiveSummary: string;
  criticScore: number;
  disclaimer: string;
}

// ─── Portfolio Lab Types ──────────────────────────────────────────────────────

export interface TickerAllocation {
  ticker: string;
  percentage: number;
}

export interface SimulationInput {
  startDate: string;
  endDate: string;
  initialInvestment: number;
  monthlyContribution: number;
  allocations: TickerAllocation[];
  annualRebalance: boolean;
}

export interface DailyPrice {
  date: string;
  close: number;
}

export interface SimulationResult {
  dailyData: {
    date: string;
    portfolioValue: number;
    benchmarkValue: number;
    totalContributed: number;
  }[];
  yearEndSummary: {
    year: number;
    endValue: number;
    totalContributed: number;
    annualReturn: number;
    benchmarkAnnualReturn: number;
  }[];
  metrics: {
    endingValue: number;
    totalContributed: number;
    netProfit: number;
    totalReturnPct: number;
    cagr: number;
    volatility: number;
    sharpeRatio: number;
    sortinoRatio: number;
    informationRatio: number;
    maxDrawdown: number;
    maxDrawdownFromContributions: number;
    alpha: number;
    beta: number;
    trackingError: number;
    benchmarkCagr: number;
    benchmarkVolatility: number;
    benchmarkSharpeRatio: number;
    benchmarkMaxDrawdown: number;
    calmarRatio: number;
    maxDrawdownDuration: number;
    cumulativeTwr: number;
  };
  twrReturns: { year: number; return: number }[];
  audit: { date: string; amount: number; type: 'Initial' | 'Monthly' }[];
  dailyPortfolioReturns: number[];
  warnings: string[];
  perTickerDailyReturns: Record<string, number[]>;
}

// ─── Strategy Arena Types ─────────────────────────────────────────────────────

export interface PersonaHolding {
  ticker: string;
  weight: number;        // 0-1, e.g. 0.6
  shares: number;        // locked at inception
  inceptionPrice: number; // price at persona creation
}

export interface BenchmarkComponent {
  ticker: string;
  weight: number;       // 0-1, e.g. 0.6
  inceptionPrice: number;
  shares: number;
}

export interface Persona {
  id: string;
  user_id: string;
  name: string;
  risk_score: number;       // 1-10
  starting_balance: number;
  allocation_method: 'manual' | 'ai_optimized' | 'template';
  allocation_json: PersonaHolding[];
  benchmark_ticker: string;
  benchmark_inception_price: number;
  benchmark_shares?: number;
  benchmark_component_json?: { components: BenchmarkComponent[] } | null;
  thesis: string | null;
  inception_date: string;
  created_at: string;
}

export interface PersonaSnapshotHolding {
  ticker: string;
  shares: number;
  inceptionPrice: number;
  currentPrice: number;
  currentValue: number;
  gainLoss: number;
  gainLossPct: number;
  todayChangePct: number;
  weightCurrent: number;
}

export interface PersonaSnapshot {
  id: string;
  persona_id: string;
  snapshot_date: string;
  portfolio_value: number;
  benchmark_value: number;
  holdings_detail_json: PersonaSnapshotHolding[];
  ai_briefing: string | null;
  ai_briefing_generated_at: string | null;
  created_at: string;
  updated_at: string;
}
