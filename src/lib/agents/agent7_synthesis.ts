/**
 * agent7_synthesis.ts
 *
 * LLM synthesis agent — the only agent in the v3 pipeline that makes an AI call.
 * All other agents are deterministic TypeScript functions. This agent reads their
 * combined output and produces the human-readable narrative layer.
 *
 * Model: gemini-2.5-flash (fast, low latency, sufficient for structured output)
 * Expected latency: 2–5 seconds
 * Requires: GEMINI_API_KEY environment variable
 *
 * If the API key is not set or the call fails, the route returns the plan without
 * a synthesis field — all other sections still work normally.
 */

import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  Agent1Output,
  Agent2Output,
  Agent3Output,
  Agent4Output,
  Agent5Output,
  Agent6Output,
  Agent7Output,
} from './types';

// ─── Response schema ──────────────────────────────────────────────────────────

const SYNTHESIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    portfolioNarrative: {
      type: Type.STRING,
      description:
        '2-3 paragraphs in plain English explaining why this specific portfolio was built for this user. ' +
        'Reference their actual inputs: risk score, time horizon, tax bracket, goals. ' +
        'Explain the key construction decisions and how current market conditions influenced them. ' +
        'No bullet points — flowing prose only.',
    },
    keyInsights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        '3-5 concise bullet points (no bullet character — just the text) summarising the most ' +
        'important personalisation decisions. Each under 20 words. Examples: ' +
        '"High tax bracket — VTEB municipal bonds selected over BND for taxable account." ' +
        '"Aggressive risk profile — 80% equity allocation with small-cap value tilt (AVUV, AVDV)."',
    },
    primaryRisk: {
      type: Type.STRING,
      description:
        'The single biggest risk to the plan. 1-2 sentences. Specific to this user\'s situation, ' +
        'not a generic disclaimer. Could be sequence-of-returns risk, concentration, inflation, etc.',
    },
    actionableNextSteps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Exactly 3 concrete next steps the user should take to implement this plan. ' +
        'Start each with a verb. Reference specific tickers or account types where relevant. ' +
        'Example: "Open a Roth IRA at Fidelity and purchase AVUV and AVDV — these factor ETFs ' +
        'compound best inside a tax-free wrapper."',
    },
  },
  required: ['portfolioNarrative', 'keyInsights', 'primaryRisk', 'actionableNextSteps'],
};

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(input: {
  clientProfile:   Agent1Output;
  economicIntel:   Agent2Output;
  portfolio:       Agent3Output;
  riskAnalysis:    Agent4Output;
  taxOptimization: Agent5Output;
  criticScore:     Agent6Output;
}): string {
  const { clientProfile, economicIntel, portfolio, riskAnalysis, taxOptimization, criticScore } = input;
  const p = clientProfile;
  const rf = p.riskProfile;
  const tx = p.taxProfile;
  const th = p.timeHorizon;
  const goal = p.goalAnalysis;
  const stats = portfolio.statistics;

  const holdingsSummary = portfolio.allocation
    .map(s => `  ${s.ticker.padEnd(6)} ${(s.weight * 100).toFixed(1).padStart(5)}%  [${s.category}] → ${s.accountPlacement}`)
    .join('\n');

  const rationale = Object.entries(portfolio.etfRationale ?? {})
    .map(([t, r]) => `  ${t}: ${r.rationale}`)
    .join('\n');

  const warnings = riskAnalysis.warnings.length > 0
    ? riskAnalysis.warnings.map(w => `  • ${w}`).join('\n')
    : '  None';

  const improvements = criticScore.improvementSuggestions.length > 0
    ? criticScore.improvementSuggestions.map(s => `  • ${s}`).join('\n')
    : '  None — plan passes all thresholds.';

  const taxRecs = taxOptimization.recommendations.length > 0
    ? taxOptimization.recommendations.map(r => `  • [${r.priority}] ${r.title}: ${r.detail}`).join('\n')
    : '  None significant.';

  return `You are an expert portfolio analyst writing a personalised plan summary for a specific investor.
Write for someone who is financially literate but not a professional. Be specific — reference their actual numbers.

═══════════════════════════════════════════
CLIENT PROFILE
═══════════════════════════════════════════
Risk score:       ${rf.riskScore}/10 (capacity: ${rf.riskCapacity}, willingness: ${rf.riskWillingness})
Time horizon:     ${th.yearsToGoal} years to goal (${th.bucket})
Goal:             feasibility: ${goal.feasibility} | funded: ${(goal.fundedStatus * 100).toFixed(0)}%
Tax bracket:      ${(tx.combinedMarginalRate * 100).toFixed(0)}% combined (${(tx.federalMarginalRate * 100).toFixed(0)}% federal, ${(tx.stateMarginalRate * 100).toFixed(0)}% state)
Accounts:         ${clientProfile.accountStructure.availableAccounts.join(', ')}
Starting capital: $${p.startingCapital.toLocaleString()}
Monthly contrib:  $${p.monthlyContribution.toLocaleString()}
In drawdown:      ${th.isInDrawdownPhase ? 'yes' : 'no'}

═══════════════════════════════════════════
MARKET CONDITIONS (live FRED data)
═══════════════════════════════════════════
Regime:           ${economicIntel.regime.current}
10Y Treasury:     ${(economicIntel.macroData.treasury10Y * 100).toFixed(2)}% (risk-free rate in Sharpe calculations)
Fed Funds Rate:   ${(economicIntel.macroData.fedFundsRate * 100).toFixed(2)}%
CPI YoY:          ${(economicIntel.macroData.cpiYoY * 100).toFixed(1)}%
Equity valuation: ${economicIntel.assetClassOutlook.equityValuation}
Bond opportunity: ${economicIntel.assetClassOutlook.bondOpportunity}
Data source:      ${economicIntel.dataSource}

═══════════════════════════════════════════
CONSTRUCTED PORTFOLIO
═══════════════════════════════════════════
Holdings (Sharpe-optimised):
${holdingsSummary}

Statistics:
  Expected return:    ${(stats.expectedReturn * 100).toFixed(2)}%
  Expected vol:       ${(stats.expectedVolatility * 100).toFixed(2)}%
  Sharpe ratio:       ${stats.sharpeRatio.toFixed(2)}
  Max drawdown est:   -${(stats.maxDrawdownEstimate * 100).toFixed(1)}%
  Weighted expense:   ${(stats.weightedExpenseRatio * 100).toFixed(3)}%

Rationale for each position:
${rationale}

═══════════════════════════════════════════
RISK ANALYSIS
═══════════════════════════════════════════
Overall risk level: ${riskAnalysis.riskLevel}
Passes risk check:  ${riskAnalysis.passesRiskCheck ? 'yes' : 'no'}
Warnings:
${warnings}

═══════════════════════════════════════════
TAX OPTIMISATION
═══════════════════════════════════════════
Estimated savings:  ${taxOptimization.estimatedAnnualSavings} bps/year
Recommendations:
${taxRecs}

═══════════════════════════════════════════
CRITIC SCORE
═══════════════════════════════════════════
Overall: ${criticScore.scores.overall}/100
  Alignment:       ${criticScore.scores.alignment}/100
  Diversification: ${criticScore.scores.diversification}/100
  Tax efficiency:  ${criticScore.scores.taxEfficiency}/100
  Cost efficiency: ${criticScore.scores.costEfficiency}/100
  Risk management: ${criticScore.scores.riskManagement}/100

Suggested improvements:
${improvements}

═══════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════
Write a synthesis for this specific investor. Be precise and personal — avoid generic financial advice.
Reference actual numbers, actual ticker symbols, and actual decisions made for them.
Do not repeat the data tables back — synthesise and explain the reasoning.`;
}

// ─── Agent 7 ──────────────────────────────────────────────────────────────────

export async function agent7_synthesis(input: {
  clientProfile:   Agent1Output;
  economicIntel:   Agent2Output;
  portfolio:       Agent3Output;
  riskAnalysis:    Agent4Output;
  taxOptimization: Agent5Output;
  criticScore:     Agent6Output;
}): Promise<Agent7Output | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    console.warn('[agent7] GEMINI_API_KEY not set — skipping synthesis');
    return null;
  }

  const startTime = Date.now();

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = buildPrompt(input);

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.4,        // slightly creative for narrative quality
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, // speed over depth
        responseMimeType: 'application/json',
        responseSchema: SYNTHESIS_SCHEMA,
      },
    });

    const jsonText = (response.text ?? '').trim();
    if (!jsonText) return null;

    const parsed = JSON.parse(jsonText) as {
      portfolioNarrative: string;
      keyInsights: string[];
      primaryRisk: string;
      actionableNextSteps: string[];
    };

    const executionTimeMs = Date.now() - startTime;
    console.log(`Agent 7: ${executionTimeMs}ms`);

    return {
      agentName: 'synthesis',
      timestamp: new Date().toISOString(),
      executionTimeMs,
      portfolioNarrative:  parsed.portfolioNarrative,
      keyInsights:         parsed.keyInsights,
      primaryRisk:         parsed.primaryRisk,
      actionableNextSteps: parsed.actionableNextSteps,
      performance: {
        targetLatencyMs: 5000,
        actualLatencyMs: executionTimeMs,
        withinSLA: executionTimeMs <= 5000,
      },
    };
  } catch (e) {
    console.error('[agent7] synthesis failed:', e);
    return null;
  }
}
