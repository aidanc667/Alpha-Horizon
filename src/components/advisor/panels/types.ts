export type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';
export type TimeHorizon = '6 months' | '1 year' | '3-5 years' | '10 years';
export type ContextStatus = 'loading' | 'ready' | 'partial' | 'failed';

export interface SessionCtx {
  portfolio: string;
  portfolioFindings: string;
  thesis: string;
  bestTickers: string;
  crossTabContext: string;
}
