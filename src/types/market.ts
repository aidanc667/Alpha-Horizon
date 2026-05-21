export type TimeHorizon = '6 months' | '1 year' | '3-5 years' | '10 years' | '20-30 years';
export type ConfidenceLevel = 'High' | 'Moderate' | 'Low';

export interface StrategicIntelligenceEvent {
  summary: string;
  marketInterpretation: 'Bullish' | 'Neutral' | 'Bearish';
  sectorImpact: {
    benefits: string[];
    headwinds: string[];
  };
  marketSentiment: string;
  confidence: ConfidenceLevel;
}

export interface SectorImpact {
  positiveTailwinds: string[];
  headwinds: string[];
  macroDrivers: string;
  confidence: ConfidenceLevel;
}

export interface FactorExposure {
  factor: string;
  favorability: string;
  explanation: string;
  confidence: ConfidenceLevel;
}

export interface PositioningSignal {
  summary: string;
  implications: string;
  confidence: ConfidenceLevel;
}

export interface RiskIndicator {
  indicator: string;
  currentValue: string;
  trendDirection: 'Rising' | 'Falling' | 'Stable';
  interpretation: string;
  confidence: ConfidenceLevel;
}

export interface MacroRegime {
  currentRegime: string;
  historicalContext: string;
  typicalAssetPerformance: string;
  monetaryPolicy: string;
  fiscalBackdrop: string;
  globalLiquidity: string;
  confidence: ConfidenceLevel;
}

export interface HistoricalAnalog {
  period: string;
  similarities: string;
  differences: string;
  historicalAssetPerformance: string;
  confidence: ConfidenceLevel;
}

export interface EventCalendarItem {
  event: string;
  date: string;
  implications: string;
  confidence: ConfidenceLevel;
}

export interface AssetRanking {
  asset: string;
  ticker: string;
  score: number;
  expectedReturnRange: string;
  uncertaintyBand: string;
  category: 'Most Attractive' | 'Least Attractive';
  reasoning: string;
  confidence: ConfidenceLevel;
}

export interface AssetAllocation {
  assetClass: string;
  weighting: 'Overweight' | 'Neutral' | 'Underweight';
  rationale: string;
}

export interface Scenario {
  name: 'Base Case' | 'Bull Case' | 'Bear Case';
  probability: number;
  description: string;
  gdpGrowth: string;
  inflation: string;
}

export interface Megatrend {
  trend: string;
  description: string;
  beneficiaries: string[];
  atRisk: string[];
}

export interface AIMarketOutlook {
  macroThemes: string[];
  keyRisks: string[];
  favoredSectors: string[];
  headwinds: string[];
  summary: string;
  confidence: ConfidenceLevel;
}

export interface Source {
  name: string;
  url?: string;
  headline?: string;
  relevance?: string;
}

export interface MacroPillar {
  name: string;
  indicator: string;
  value: string;
  direction: 'Up' | 'Down' | 'Neutral';
  reasoning: string;
  source?: string;
  percentile?: number;  // 0–100: where this reading sits in its 20-year historical distribution
}

export interface NearTermIntelligence {
  timestamp: string;
  macroPillars: MacroPillar[];
  marketSnapshot: {
    bullets: string[];
    sentiment: 'Risk-On' | 'Neutral' | 'Risk-Off';
    regime: string;
    confidence: ConfidenceLevel;
  };
  causalAnalysis: {
    driver: string;
    explanation: string;
    connection: string;
  }[];
  transmissionMechanism: {
    assetClass: string;
    impact: string;
    timeline: string;
    investorGuidance: string;
  }[];
  positioning: {
    overweight: { idea: string; rationale: string }[];
    underweight: { idea: string; rationale: string }[];
  };
  risks: {
    risk: string;
    counterArgument: string;
  }[];
  catalysts: {
    event: string;
    date: string;
    significance: string;
  }[];
  sources?: Source[];
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface NewsHeadline {
  headline: string;
  source: string;
  impact: string;
}

export interface LiveBriefing {
  summary: string;
  newsHeadlines: NewsHeadline[];
  timestamp: string;
}

export interface StrategicOutlook {
  regime: string;
  narrativeAnchor: string;
  marketOutlook: string;
  structuralDrivers: string[];
}

export interface AssetSectorAnalysis {
  asset: string;
  ticker?: string;
  reasoning: string;
}

export interface CapitalMarketExpectation {
  source: string;
  assetClass: string;
  expectedReturn: string;
  volatility: string;
  sharpeRatio: string;
}

export interface StrategicAllocation {
  assetClass: string;
  weighting: 'Overweight' | 'Underweight' | 'Neutral';
  rationale: string;
}

export interface CMAValues {
  expectedReturn: string;
  volatility: string;
  sharpeRatio: string;
  tag: '[Tactical]' | '[Derived]' | '[Strategic CMA]';
  notes?: string;
}

export interface InstitutionEstimate {
  institution: string;
  values: CMAValues;
}

export interface AssetClassCMA {
  assetClass: string;
  estimates: InstitutionEstimate[];
  consensus: CMAValues;
}

export interface ConsensusSummary {
  assetClass: 'U.S. Large Cap' | 'U.S. Small/Mid Cap' | 'International Developed Equities' | 'Emerging Markets' | 'Fixed Income' | 'Real Assets' | 'Alternatives' | 'Cash/Money Markets';
  returnRange: string;
  volatilityRange: string;
  status: 'Overweight' | 'Neutral' | 'Underweight';
  narrative: string;
}

export interface UncertaintyDispersion {
  assetClass: string;
  observation: string;
  level: 'High' | 'Moderate' | 'Low';
}

export interface CMADashboard {
  horizonType: 'Tactical' | 'Intermediate' | 'Strategic';
  consensusSummary: ConsensusSummary[];
  keyInsights: string[];
  portfolioImplications: {
    overweight: string[];
    neutral: string[];
    underweight: string[];
  };
}

export interface KeyRisk {
  riskName: string;
  description: string;
  marketImpact: string;
}

export interface LongTermHistoricalAnalog {
  period: string;
  context: string;
  differences: string;
  lessonLearned: string;
  investmentImplication: string;
}

export interface LongTermOutlook {
  strategicOutlook: StrategicOutlook;
  assetSectorAnalysis: {
    top5: AssetSectorAnalysis[];
    bottom5: AssetSectorAnalysis[];
  };
  cmaDashboard: CMADashboard;
  strategicAssetAllocation: {
    allocations: StrategicAllocation[];
    convictionScore: number;
  };
  scenarioFramework: {
    scenarios: Scenario[];
    keyRisks: KeyRisk[];
    primaryTailRisk: string;
    historicalAnalog: LongTermHistoricalAnalog;
  };
  factorExposures?: FactorExposure[];
  positioningSignals?: PositioningSignal;
  aiMarketOutlook?: AIMarketOutlook;
  sectorImpact?: SectorImpact;
  sources?: Source[];
}

export interface ComprehensiveMarketData extends LongTermOutlook {
  sectorImpact?: SectorImpact;
  factorExposures?: FactorExposure[];
  positioningSignals?: PositioningSignal;
  riskDashboard?: RiskIndicator[];
  macroRegime?: MacroRegime;
  aiMarketOutlook?: AIMarketOutlook;
  structuralMegatrends?: Megatrend[];
}

// ─── Triple-Card Market System ───────────────────────────────────────────────

export interface DailyIndicators {
  // ── Predicted (scored in Yesterday's Call) ──
  fearGreed: {
    score: number;           // 0-100
    label: 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';
    delta: number;           // change from yesterday
    description: string;
  };
  spyTrend: {
    direction: 'Up' | 'Down' | 'Flat';
    changePercent: number;   // e.g. 1.2 = +1.2%
    above200MA: boolean;
    above50MA: boolean;
    volumeRatio: number | null;  // today's volume / 3-month avg volume
    description: string;
  };
  sectorRotation: {
    leader: { sector: string; ticker: string; performance: string; };
    lagger: { sector: string; ticker: string; performance: string; };
    implication: string;
  };
  optionsPulse: {
    putCallRatio: number;    // e.g. 0.74
    lean: 'Bullish' | 'Neutral' | 'Bearish';
    description: string;
  };
  // ── Facts (reported today, not scored) ──
  bigStory: {
    ticker: string;
    name: string;
    changePercent: string;   // e.g. "+4.1%"
    reason: string;
    direction: 'Up' | 'Down';
  };
  nextCatalyst: {
    time: string;
    event: string;
    implication: string;
  };
}

/** @deprecated Use DailyIndicators */
export type Elite6Indicators = DailyIndicators;

export interface TomorrowPredictions {
  fearGreed: DailyIndicators['fearGreed'];
  spyTrend: DailyIndicators['spyTrend'];
  sectorRotation: DailyIndicators['sectorRotation'];
  optionsPulse: DailyIndicators['optionsPulse'];
  confidence?: 'High' | 'Moderate' | 'Low';
  signals?: string[];
}

export interface DailyBriefBullet {
  what: string;
  why: string;
  impact: string;
}

export type WeatherCondition = 'sunny' | 'overcast' | 'stormy';

export interface MacroWeather {
  condition: WeatherCondition;
  emoji: '☀️' | '☁️' | '⛈️';
  label: 'Sunny' | 'Overcast' | 'Stormy';
  description: string;    // one sentence explanation
}

export interface LiveHeadline {
  headline: string;
  source: string;
  impactScore: number;    // 1-10
  category: string;       // 'Fed/Rates' | 'Earnings' | 'Macro' | 'Geopolitical' | 'Sector' | 'Crypto'
  timestamp: string;
}

export interface AccuracyBreakdown {
  fearGreed: number;       // 0-100
  spyTrend: number;        // 0-100
  sectorRotation: number;  // 0-100
  optionsPulse: number;    // 0-100
}

export interface RollingAccuracy {
  fearGreed: number | null;
  spyTrend: number | null;
  sectorRotation: number | null;
  optionsPulse: number | null;
  daysScored: number;
}

export interface DailyMarketRecord {
  recordDate: string;           // YYYY-MM-DD
  isNoonLocked: boolean;
  noonLockedAt: string | null;  // ISO timestamp
  // Today's live data
  elite6Actual: Elite6Indicators | null;
  briefBullets: DailyBriefBullet[];
  outlier: string;
  catalyst: string;             // #1 event to watch next 24h
  weather: MacroWeather | null;
  liveHeadlines: LiveHeadline[];
  // Tomorrow predictions (locked at noon)
  tomorrowPredictions: TomorrowPredictions | null;
  tomorrowOutlook: string;      // brief narrative
  // Accuracy scoring (filled next day)
  accuracyScore: number | null; // 0-100
  accuracyBreakdown: AccuracyBreakdown | null;
  accuracyCalculatedAt: string | null;
  // Daily Edge Board & Positioning
  edgeBoard: DailyEdgeBoard | null;
  positioning: TodayPositioning | null;
  // User prediction
  userSpyPrediction?: 'Up' | 'Down' | 'Flat' | null;
  userPredictionLockedAt?: string | null;
  userAccuracyCorrect?: boolean | null;
}

export interface TripleCardData {
  yesterday: DailyMarketRecord | null;
  today: DailyMarketRecord;
  isLiveDataStale: boolean;
  needsRefresh: boolean;
  lastRefreshed: string;
  rollingAccuracy?: RollingAccuracy;
  modelStreak?: number;
  userStreak?: number;
}

export interface DailyEdgeAsset {
  rank: number;
  ticker: string;
  name: string;
  change: string;        // e.g. "+3.2%" or "-1.4%"
  edge: string;          // reason for edge in ~10 words
  sector: string;
}

export interface DailyEdgeBoard {
  top5: DailyEdgeAsset[];
  bottom5: DailyEdgeAsset[];
  generatedAt: string;
}

export interface PositioningBullet {
  asset: string;          // e.g. "Technology"
  ticker: string;         // e.g. "XLK"
  rationale: string;      // ~10 words
}

export interface TodayPositioning {
  overweight: PositioningBullet[];
  neutral: PositioningBullet[];
  underweight: PositioningBullet[];
}
