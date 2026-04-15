import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { deriveInvestorProfile } from '@/lib/deterministicProfile';
import { getCachedPlan, setCachedPlan } from '@/lib/agentResponseCache';
import { ETF_UNIVERSE, truePortfolioVol, CMA_ANCHORS, WHITELISTED_TICKERS, OVERLAP_PAIRS } from '@/lib/assets';
import { db } from '@/lib/db';
import type {
  IntakeAnswers, PortfolioPlan, InvestorProfile, MacroContext,
  PortfolioDraft, RiskAssessment, TaxPlan, CriticScore,
  AllocationSlice, OwnerManualSection, BenchmarkComparison,
} from '@/apps/portfolio-agent/types';
import { CRITIC_PASS_THRESHOLD, CRITIC_MIN_GAIN, MAX_ITERATIONS, serializeBaseline } from '@/apps/portfolio-agent/constants';
import { derivePortfolioPolicy, deriveAccountFlags } from '@/lib/portfolioPolicy';
import type { AccountFlags } from '@/lib/portfolioPolicy';

// Allow up to 120 seconds server-side (client aborts at 90s and shows error)
export const maxDuration = 120;

// ─── Constants ────────────────────────────────────────────────────────────────
const MODEL = 'gemini-2.5-flash';

// ─── Ticker Classification Sets ───────────────────────────────────────────────
// Defined once here; shared by deriveRiskAssessment, deriveTaxPlan, deriveCriticScore.
const CASH_TICKERS         = new Set(['SGOV','BIL','USFR','VUSXX','VMFXX']);
const BOND_TICKERS         = new Set(['BND','BNDX','SCHP','VCIT','HYG','VTEB','CMF','MUB']);
const CORE_BOND_TICKERS    = new Set(['BND','BNDX','SCHP','VCIT','HYG']); // excludes munis — for tax-deferred placement logic
const MUNI_TICKERS         = new Set(['VTEB','CMF','MUB']);
const REIT_TICKERS         = new Set(['VNQ','VPU']);
const INTL_TICKERS         = new Set(['VEA','VWO','VXUS','AVDV']);
const HIGHGROWTH_TICKERS   = new Set(['AVUV','AVDV','VWO','VBR','MTUM','QQQM','VGT']);
const TAX_DRAG_TICKERS     = new Set(['VNQ','HYG','VCIT','IAU']); // tax-inefficient in taxable accounts

// ─── Formatting Helpers ───────────────────────────────────────────────────────
const pct   = (n: number) => `${(n * 100).toFixed(1)}%`;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;


function getApiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  return key;
}

// Walk the string tracking brace depth + string state to find the first complete
// JSON object. Unlike lastIndexOf('}'), this correctly ignores } inside strings
// and stops at the matching close — so trailing commentary (even with braces) is safe.
function extractFirstCompleteJSON(text: string): string {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape)             { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"')         { inString = !inString; continue; }
    if (inString)           { continue; }
    if (ch === '{')         { if (depth === 0) start = i; depth++; }
    else if (ch === '}')    { depth--; if (depth === 0 && start !== -1) return text.slice(start, i + 1); }
  }
  throw new Error('No complete JSON object found in response');
}

function extractJSON<T>(raw: string): T {
  // responseMimeType:'application/json' forces clean JSON from Gemini,
  // but strip any accidental markdown fences as a safety net
  const stripped = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Fallback: brace-depth walker finds the first complete JSON object even when
    // Gemini appends trailing commentary (possibly containing its own { } chars)
    try {
      return JSON.parse(extractFirstCompleteJSON(stripped)) as T;
    } catch (inner) {
      console.error('[extractJSON] Unparseable response:', stripped.slice(0, 400));
      throw new Error(`JSON parse failed: ${inner instanceof Error ? inner.message : inner} — raw: ${stripped.slice(0, 120)}`);
    }
  }
}

const getDate = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ─── Shared allocation normalizer ─────────────────────────────────────────────
// Called everywhere an LLM returns an allocation — construction agent, risk agent,
// or anywhere else. Converts keyed-object → array, drops invalid slices, normalizes
// weights, and caps any single holding at 40%.
function normalizeAllocation(raw: unknown): AllocationSlice[] {
  let arr: AllocationSlice[];

  if (Array.isArray(raw)) {
    arr = raw as AllocationSlice[];
  } else if (raw && typeof raw === 'object') {
    // Gemini returned {TICKER: {weight, ...}} — convert to array
    arr = Object.entries(raw as Record<string, Partial<AllocationSlice>>).map(
      ([ticker, data]) => ({
        ticker,
        name: ticker,
        weight: 0,
        assetClass: '',
        bucket: 'growth' as const,
        expectedAnnualReturn: 0.06,
        rationale: '',
        accountPlacement: 'taxable' as const,
        ...data,
      })
    );
  } else {
    throw new Error('Allocation is null/undefined — LLM returned no allocation data');
  }

  // Drop slices with missing ticker or non-positive weight
  arr = arr.filter(s => s.ticker && typeof s.weight === 'number' && s.weight > 0);
  if (arr.length === 0) throw new Error('All allocation slices were invalid after filtering');

  // ── Whitelist enforcement ──────────────────────────────────────────────────
  // Drop any ticker not in the vetted ETF universe. Prevents hallucinated or
  // unsupported funds from reaching the output (e.g. SCHB, VTSAX, made-up symbols).
  const before = arr.length;
  arr = arr.filter(s => WHITELISTED_TICKERS.has(s.ticker));
  if (arr.length < before) {
    console.warn(`[normalizeAllocation] Dropped ${before - arr.length} non-whitelisted ticker(s)`);
  }
  if (arr.length === 0) throw new Error('No whitelisted tickers remain after ETF whitelist check');

  // ── Overlap enforcement ────────────────────────────────────────────────────
  // If both members of a known substitution pair are present, drop the inferior one.
  // Deterministic: the preferred ticker (first in OVERLAP_PAIRS) always wins.
  for (const [preferred, inferior] of OVERLAP_PAIRS) {
    if (arr.some(s => s.ticker === preferred) && arr.some(s => s.ticker === inferior)) {
      arr = arr.filter(s => s.ticker !== inferior);
      console.warn(`[normalizeAllocation] Dropped overlap duplicate: ${inferior} (kept ${preferred})`);
    }
  }

  // Normalize weights to sum exactly to 1.0
  const total = arr.reduce((sum, s) => sum + s.weight, 0);
  if (total <= 0) throw new Error('Allocation total weight is zero — cannot normalize');
  arr = arr.map(s => ({ ...s, weight: s.weight / total }));

  // Cap any single holding over 40% and renormalize
  if (Math.max(...arr.map(s => s.weight)) > 0.45) {
    arr = arr.map(s => ({ ...s, weight: Math.min(s.weight, 0.40) }));
    const cappedTotal = arr.reduce((sum, s) => sum + s.weight, 0);
    if (cappedTotal <= 0) throw new Error('All weights zeroed out after cap — cannot renormalize');
    arr = arr.map(s => ({ ...s, weight: s.weight / cappedTotal }));
  }

  return arr;
}

function compactAlloc(allocation: AllocationSlice[]): string {
  if (!Array.isArray(allocation) || allocation.length === 0) {
    throw new Error('compactAlloc called with empty or non-array allocation');
  }
  return allocation.map(a =>
    `${a.ticker} ${(a.weight * 100).toFixed(0)}% ${a.bucket}/${a.accountPlacement}`
  ).join(' | ');
}

function compactProfile(p: InvestorProfile, a: IntakeAnswers): string {
  return `risk ${p.riskScore}/10 (${p.derivedRiskTolerance}) | ${a.yearsUntilWithdrawal}yr horizon | ` +
    `${(p.effectiveMarginalRate * 100).toFixed(0)}% marginal rate | ` +
    `${a.hasEmergencyFund ? 'fund ✓' : 'fund ✗'} | ` +
    `${a.hasLargeExpense && a.largeExpenseAmount ? `expense $${a.largeExpenseAmount.toLocaleString()}` : 'no large expense'}`;
}

// Per-call timeout: if Gemini doesn't respond within N seconds, throw instead of hanging.
// Callers pass stage-specific timeoutMs; defaults: 60s (search) / 40s (JSON).
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s — Gemini API may be slow, please retry`)), ms)
    ),
  ]);
}

// Strict JSON schema for the portfolio construction response.
// responseSchema + responseMimeType together enforce structured output at the API level,
// eliminating the class of failures where Gemini returns narrative text or malformed JSON.
// NOTE: responseSchema is incompatible with Google Search grounding — only used on non-search calls.
const PORTFOLIO_DRAFT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    allocation: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticker:               { type: 'string' },
          weight:               { type: 'number' },
          expectedAnnualReturn: { type: 'number' },
          rationale:            { type: 'string' },
          accountPlacement:     { type: 'string' },
        },
        required: ['ticker', 'weight', 'rationale', 'accountPlacement'],  // expectedAnnualReturn omitted — filled from CMA_ANCHORS server-side
      },
    },
    constructionRationale: { type: 'string' },
  },
  required: ['allocation', 'constructionRationale'],
};

async function callGemini(ai: GoogleGenAI, prompt: string, useSearch = false, temperature = 0.3, timeoutMs?: number, schema?: Record<string, unknown>): Promise<string> {
  // NOTE: responseMimeType:'application/json' is incompatible with Google Search grounding.
  // Search calls must rely on prompt-level JSON instruction instead.
  const config: Record<string, unknown> = {
    temperature,
    ...(useSearch
      ? { tools: [{ googleSearch: {} }] }                                            // search: no responseMimeType
      : { responseMimeType: 'application/json', ...(schema && { responseSchema: schema }) }), // non-search: structured output
  };
  const effectiveTimeout = timeoutMs ?? (useSearch ? 60_000 : 40_000);
  const res = await withTimeout(
    ai.models.generateContent({ model: MODEL, contents: prompt, config }),
    effectiveTimeout,
    useSearch ? 'Capital Markets search' : 'Gemini call'
  );
  const text = res.text?.trim() ?? '';
  if (!text) throw new Error('Empty response from Gemini — model returned no text');
  return text;
}

/** True for timeout / transient network errors — safe to retry once. Not for logic/parse failures. */
function isTransientGeminiError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.message.includes('timed out') || /ECONNRESET|fetch failed|network error|socket hang/i.test(e.message);
}


// ─── Two-Level Macro Cache ────────────────────────────────────────────────────
// Macro context is the same for ALL users. Fetching it on every cold start wastes
// 10–20s of Google Search latency. Two cache levels:
//
//   Level 1 — Lambda process memory (~0ms, lost on cold start)
//   Level 2 — Neon Postgres (~50ms, survives cold starts across all instances)
//   Level 3 — Live Gemini + Google Search (10–20s, fires only on full cache miss)
//
// Run runMacroCacheMigration() from src/lib/db.ts once to create the table.
const MACRO_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let _macroCacheEntry: { data: MacroContext; fetchedAt: number } | null = null;

function getMemMacro(): MacroContext | null {
  if (!_macroCacheEntry) return null;
  if (Date.now() - _macroCacheEntry.fetchedAt > MACRO_CACHE_TTL_MS) {
    _macroCacheEntry = null;
    return null;
  }
  return _macroCacheEntry.data;
}

async function getNeonMacro(): Promise<MacroContext | null> {
  try {
    const sql = db();
    const rows = await sql`
      SELECT data FROM macro_cache
      WHERE cache_key = 'global'
        AND fetched_at > NOW() - INTERVAL '6 hours'
      LIMIT 1
    ` as Array<{ data: MacroContext }>;
    return rows.length > 0 ? rows[0].data : null;
  } catch {
    // Table may not exist yet (migration not run) — fail open, fall through to live call.
    return null;
  }
}

function setNeonMacro(macro: MacroContext): void {
  // Fire-and-forget — never blocks the request path.
  (async () => {
    try {
      const sql = db();
      // JSON.stringify produces a plain string; cast for the tagged-template driver.
      const dataStr = JSON.stringify(macro);
      await sql`
        INSERT INTO macro_cache (cache_key, data, fetched_at)
        VALUES ('global', ${dataStr}::jsonb, NOW())
        ON CONFLICT (cache_key) DO UPDATE
          SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at
      `;
    } catch (e) {
      console.error('[macro cache] Neon write failed:', e);
    }
  })();
}

// ─── Agent 2: Capital Markets ─────────────────────────────────────────────────
async function runCapitalMarketsAgent(ai: GoogleGenAI): Promise<MacroContext> {
  // Level 1: Lambda process memory — fastest, ~0ms
  const mem = getMemMacro();
  if (mem) return mem;

  // Level 2: Neon Postgres — survives cold starts, ~50ms vs 10–20s Google Search
  const neon = await getNeonMacro();
  if (neon) {
    _macroCacheEntry = { data: neon, fetchedAt: Date.now() }; // warm memory cache too
    return neon;
  }

  // Level 3: Live Gemini + Google Search — only fires on full cache miss
  const prompt = `Capital Markets Agent. ${getDate()}. Use Google Search.
Search for CURRENT values: Fed Funds Rate, 10Y Treasury yield, CPI YoY, S&P 500 Shiller CAPE.
Classify regime: risk_on (CAPE<28, CPI<3%), risk_off (CAPE>32, CPI>4%), else transitional.
Equity valuation: expensive (CAPE>30), fair (25-30), cheap (<25).
Bond opportunity: attractive if 10Y real yield >1.5%, unattractive if <0.5%, else neutral.
In cmaSummary (2 sentences): which asset classes look better/worse than long-run averages right now and why.
In narrative (2 sentences): current macro regime and what it means for portfolios.
Return ONLY valid JSON — no markdown:
{"fedFundsRate":"","tenYearYield":"","cpi":"","regime":"risk_on|risk_off|transitional","equityValuation":"expensive|fair|cheap","bondOpportunity":"attractive|neutral|unattractive","keyRisks":["","",""],"tailwinds":["","",""],"cmaSummary":"","narrative":"","sources":[""]}`;

  const text = await callGemini(ai, prompt, true, 0.2, 60_000);
  const macro = extractJSON<MacroContext>(text);

  // Populate both cache levels (Neon write is fire-and-forget)
  _macroCacheEntry = { data: macro, fetchedAt: Date.now() };
  setNeonMacro(macro);
  return macro;
}

// ─── Live Risk-Free Rate Parser ───────────────────────────────────────────────
// The Capital Markets agent retrieves the current 10-yr Treasury yield via Google Search
// and stores it as a string (e.g. "4.35%", "4.2", "~4.4%"). This parses it into a
// decimal so Sharpe calculations, the optimizer, and benchmark comparison all use the
// actual live yield rather than a hardcoded constant.
function parseRiskFreeRate(tenYearYield: string, fallback = 0.042): number {
  const cleaned = tenYearYield.replace(/[%~≈\s]/g, '');
  const parsed  = parseFloat(cleaned);
  if (!isFinite(parsed) || parsed <= 0) return fallback;
  // Gemini may return "4.35" (percent) or "0.0435" (decimal) — handle both
  const rate = parsed > 1 ? parsed / 100 : parsed;
  // Sanity-clamp: 10-yr yield should be between 1% and 10% in any realistic scenario
  return Math.min(0.10, Math.max(0.01, rate));
}

// ─── Server-side Sharpe Optimizer (gradient ascent, ~2ms) ────────────────────
// Runs after every LLM construction pass. Uses the true covariance-based portfolio
// vol and the live risk-free rate from the Capital Markets agent.
// Only adjusts weights — never adds or removes ETFs. LR=0.004, max 60 steps.
// Typical improvement: +0.02–0.05 Sharpe over the raw LLM weights.
function optimizeWeightsForSharpe(
  allocation: AllocationSlice[],
  etfMetaMap: Record<string, { cma2026: number; volEstimate: number }>,
  rf: number,          // live 10-yr Treasury yield from Capital Markets agent
  maxIter = 60,
  lr = 0.004,
  minW = 0.03,
  maxW = 0.40
): AllocationSlice[] {
  if (allocation.length < 2) return allocation;

  const tickers = allocation.map(s => s.ticker);
  const returns = allocation.map(s => etfMetaMap[s.ticker]?.cma2026 ?? s.expectedAnnualReturn);
  const volMap  = Object.fromEntries(
    allocation.map(s => [s.ticker, etfMetaMap[s.ticker]?.volEstimate ?? 0.15])
  );
  let w = allocation.map(s => s.weight);
  const RF = rf;
  const n = w.length;

  // Sharpe using true covariance-based portfolio vol (replaces weighted-avg × D-factor)
  function sharpeOf(weights: number[]): number {
    const ret = weights.reduce((sum, wi, i) => sum + wi * returns[i], 0);
    const vol = truePortfolioVol(weights, tickers, volMap);
    return (ret - RF) / Math.max(0.01, vol);
  }

  // Project onto constrained simplex: clamp each to [minW, maxW], then renormalize
  function project(weights: number[]): number[] {
    const clamped = weights.map(wi => Math.max(minW, Math.min(maxW, wi)));
    const s = clamped.reduce((a, b) => a + b, 0);
    return clamped.map(wi => wi / s);
  }

  const eps = 0.001;
  for (let iter = 0; iter < maxIter; iter++) {
    const base = sharpeOf(w);
    const grad: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const wPlus = [...w]; wPlus[i] += eps;
      grad[i] = (sharpeOf(project(wPlus)) - base) / eps;
    }
    const candidate = project(w.map((wi, i) => wi + lr * grad[i]));
    if (sharpeOf(candidate) > base + 1e-5) {
      w = candidate;
    } else {
      break; // converged
    }
  }

  return allocation.map((s, i) => ({ ...s, weight: w[i] }));
}

// ─── Monte Carlo Simulation ───────────────────────────────────────────────────
// Box-Muller log-normal paths. Used by both portfolio construction and benchmark
// comparison — defined once here to avoid duplication.
interface MonteCarloResult { p10: number; p50: number; p90: number; successProbability: number; }

function runMonteCarlo(
  annualReturn: number,
  annualVol: number,
  startingCapital: number,
  monthlyContribution: number,
  years: number,
  inflationAdjustedTarget: number,
  n = 1000,
): MonteCarloResult {
  const mu    = annualReturn / 12;
  const sigma = annualVol / Math.sqrt(12);
  const steps = Math.max(years, 1) * 12;
  const paths: number[] = [];
  for (let i = 0; i < n; i++) {
    let v = startingCapital;
    for (let m = 0; m < steps; m++) {
      const u1 = Math.random(), u2 = Math.random();
      const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = (v + monthlyContribution) * (1 + mu + sigma * z);
    }
    paths.push(v);
  }
  paths.sort((a, b) => a - b);
  return {
    p10: paths[Math.floor(n * 0.10)],
    p50: paths[Math.floor(n * 0.50)],
    p90: paths[Math.floor(n * 0.90)],
    successProbability: paths.filter(v => v > inflationAdjustedTarget).length / n,
  };
}

// ─── Portfolio Construction ───────────────────────────────────────────────────
async function runPortfolioConstructionAgent(
  ai: GoogleGenAI,
  answers: IntakeAnswers,
  profile: InvestorProfile,
  macro: MacroContext,
  rf: number,                  // live 10-yr Treasury yield (parsed from Capital Markets agent)
  flags: AccountFlags,
  criticFeedback?: string[],  // Top deficiencies from prior iteration — undefined on first pass
  brief = false,              // Compact mode: shorter rationales; used on retry to reduce output tokens
): Promise<PortfolioDraft> {
  const policy = derivePortfolioPolicy(answers, profile, macro, flags);

  const iterationBlock = criticFeedback && criticFeedback.length > 0
    ? `\nCRITIC FEEDBACK — fix these specific deficiencies in this revision:\n${criticFeedback.map(d => `• ${d}`).join('\n')}\nAddress every item above. This is a targeted improvement pass, not a full rebuild.\n`
    : '';

  const prompt = `Portfolio Construction Agent. ${getDate()}.
You have a pre-built EQUITY-ONLY baseline. Your job: adjust it for the investor's situation, then add exactly the bond/safety sleeves specified in the directives below.

EQUITY BASELINE (${profile.derivedRiskTolerance} risk profile) — equity only, weights sum to 1.0 before adding fixed income:
${serializeBaseline(policy.baseline)}

INVESTOR: ${compactProfile(profile, answers)}
MACRO: ${macro.cmaSummary}

DIRECTIVES — apply ALL of the following (bond/safety sleeves replace equity proportionally):
${policy.adjustments.length > 0 ? policy.adjustments.map(a => `• ${a}`).join('\n') : '• No adjustments needed — return baseline as-is with rationale added'}
${iterationBlock}
${policy.filteredGuide}

RULES:
- Keep 4–6 ETFs total. Fewer is better — each ETF must earn its slot. You may swap ETFs or reweight ±20% from baseline. Respect overlap pairs.
- Weights must sum to exactly 1.0. No single holding >40%.
- Add rationale (1 sentence) to each holding explaining why it fits this investor.

Return ONLY valid JSON:
{"allocation":[{"ticker":"","weight":0,"expectedAnnualReturn":0,"rationale":"","accountPlacement":"taxable"}],"constructionRationale":""}`;

  // Revision pass gets 75s (shorter critic-feedback context); first pass gets 90s (full prompt).
  // On retry (brief=true), append a compact-mode instruction to reduce output token count.
  const stageTimeout = criticFeedback ? 75_000 : 90_000;
  const finalPrompt = brief ? prompt + '\nBRIEF: keep each holding rationale under 10 words.' : prompt;
  console.log(JSON.stringify({ stage: 'construction_start', temperature: 0, structuredOutputEnabled: true, model: MODEL, brief, timeoutMs: stageTimeout }));
  const rawText = await callGemini(ai, finalPrompt, false, 0, stageTimeout, PORTFOLIO_DRAFT_SCHEMA);
  const draft = extractJSON<PortfolioDraft>(rawText);

  // Normalize via shared helper — handles array/object/keyed-object, weight normalization, 40% cap
  draft.allocation = normalizeAllocation(draft.allocation);

  // ── Emergency fund enforcement ────────────────────────────────────────────────
  // Critic hard-fails any plan without a liquid safety sleeve when hasEmergencyFund=false.
  // Guarantee it server-side so the LLM can never accidentally omit it.
  if (!answers.hasEmergencyFund) {
    const SAFETY_TICKERS = ['SGOV', 'BIL', 'USFR', 'VUSXX', 'VMFXX'];
    const safetyIdx = draft.allocation.findIndex(s => SAFETY_TICKERS.includes(s.ticker));

    if (safetyIdx === -1) {
      // SGOV not present — inject at 10%, scale all others down proportionally
      const TARGET = 0.10;
      draft.allocation = draft.allocation.map(s => ({ ...s, weight: s.weight * (1 - TARGET) }));
      draft.allocation.push({
        ticker: 'SGOV',
        name: 'iShares 0-3 Month Treasury Bond ETF',
        weight: TARGET,
        assetClass: 'Cash / Short-Term Treasury',
        bucket: 'safety',
        expectedAnnualReturn: 0.042,
        rationale: 'Mandatory liquid safety sleeve — emergency fund not yet established; SGOV earns ~4.2% while capital remains fully accessible.',
        accountPlacement: 'taxable',
      });
    } else if (draft.allocation[safetyIdx].weight < 0.10) {
      // Safety ticker exists but undersized — top it up to 10%
      const deficit = 0.10 - draft.allocation[safetyIdx].weight;
      const othersTotal = draft.allocation.reduce((sum, s, i) => i !== safetyIdx ? sum + s.weight : sum, 0);
      if (othersTotal > 0) {
        draft.allocation = draft.allocation.map((s, i) => {
          if (i === safetyIdx) return { ...s, weight: 0.10 };
          return { ...s, weight: s.weight - (s.weight / othersTotal) * deficit };
        });
      }
    }

    // Re-normalize to remove floating point drift after injection
    const efTotal = draft.allocation.reduce((sum, s) => sum + s.weight, 0);
    if (efTotal > 0) draft.allocation = draft.allocation.map(s => ({ ...s, weight: s.weight / efTotal }));
  }

  // ── Gradient-ascent Sharpe optimizer (server-side, ~2ms, zero LLM cost) ─────
  // Nudges the LLM-chosen weights toward maximum Sharpe without changing which ETFs
  // are in the portfolio. This is what the LLM is bad at (numerical optimization)
  // but a simple gradient loop handles perfectly.
  const etfMetaMap = Object.fromEntries(ETF_UNIVERSE.map(e => [e.ticker, e]));
  draft.allocation = optimizeWeightsForSharpe(draft.allocation, etfMetaMap, rf);

  // ── Server-side portfolio statistics ─────────────────────────────────────────
  // Override LLM-generated return/vol/sharpe with values computed from CMA data.

  // Stamp each slice with authoritative metadata from ETF_UNIVERSE:
  //   expectedAnnualReturn — CMA anchor (LLM value discarded; server-side override)
  //   name, assetClass, bucket — derived here; LLM is no longer asked to produce these
  draft.allocation = draft.allocation.map(s => {
    const meta = etfMetaMap[s.ticker];
    return {
      ...s,
      name:       meta?.name        ?? s.name       ?? s.ticker,
      assetClass: meta?.subCategory ?? s.assetClass ?? 'Equity',
      bucket:     CASH_TICKERS.has(s.ticker) ? 'safety'
                : BOND_TICKERS.has(s.ticker) ? 'income'
                : (REIT_TICKERS.has(s.ticker) || s.ticker === 'IAU' || s.ticker === 'GLD') ? 'alternative'
                : (s.ticker === 'SCHD' || s.ticker === 'VIG' || s.ticker === 'VYM') ? 'income'
                : 'growth',
      expectedAnnualReturn: CMA_ANCHORS[s.ticker] ?? 0.055,  // server-authoritative; LLM value discarded
    };
  });

  // Portfolio expected return = weighted average of CMA anchors
  draft.expectedReturn = draft.allocation.reduce(
    (sum, s) => sum + s.weight * s.expectedAnnualReturn, 0
  );

  // True portfolio volatility via full covariance matrix: σ_p = √(wᵀ Σ w)
  // Uses the pairwise ETF correlation matrix in assets.ts — no approximation factor needed.
  const allocVolMap = Object.fromEntries(
    draft.allocation.map(s => [s.ticker, etfMetaMap[s.ticker]?.volEstimate ?? 0.15])
  );
  draft.expectedVolatility = Math.max(
    0.03,
    truePortfolioVol(
      draft.allocation.map(s => s.weight),
      draft.allocation.map(s => s.ticker),
      allocVolMap,
    )
  );

  // Sharpe = (return - risk-free) / vol  [rf = live 10-yr Treasury yield from Capital Markets agent]
  draft.sharpeEstimate = (draft.expectedReturn - rf) / draft.expectedVolatility;

  const mc = runMonteCarlo(
    draft.expectedReturn,
    draft.expectedVolatility,
    answers.startingCapital,
    answers.monthlyContribution,
    answers.yearsUntilWithdrawal,
    answers.startingCapital * Math.pow(1.028, answers.yearsUntilWithdrawal),
  );
  draft.monteCarloP10      = mc.p10;
  draft.monteCarloP50      = mc.p50;
  draft.monteCarloP90      = mc.p90;
  draft.successProbability = mc.successProbability;

  return draft;
}

// ─── Risk Assessment ──────────────────────────────────────────────────────────
function deriveRiskAssessment(
  allocation: AllocationSlice[],
  profile: InvestorProfile,
  answers: IntakeAnswers,
  expectedVol: number,
): RiskAssessment {

  const equityPct = allocation.filter(s => !CASH_TICKERS.has(s.ticker) && !BOND_TICKERS.has(s.ticker) && !REIT_TICKERS.has(s.ticker)).reduce((s, x) => s + x.weight, 0);
  const bondPct   = allocation.filter(s => BOND_TICKERS.has(s.ticker)).reduce((s, x) => s + x.weight, 0);
  const cashPct   = allocation.filter(s => CASH_TICKERS.has(s.ticker)).reduce((s, x) => s + x.weight, 0);

  const sorted = [...allocation].sort((a, b) => b.weight - a.weight);
  const top = sorted[0];
  const maxWeight = top?.weight ?? 0;

  // Max drawdown: equity historically ~55% peak-to-trough (2008), bonds ~15%, cash ~0%
  const maxDrawdownEstimate = Math.min(0.60, equityPct * 0.55 + bondPct * 0.15 + cashPct * 0.01);

  const flags: string[] = [];
  if (maxWeight > 0.40) flags.push(`${top.ticker} at ${(maxWeight*100).toFixed(0)}% exceeds 40% single-holding cap`);
  if (!answers.hasEmergencyFund && cashPct < 0.08) flags.push('No emergency fund and <8% cash sleeve — liquidity risk');
  if (answers.yearsUntilWithdrawal < 5 && equityPct > 0.70) flags.push(`Short horizon (${answers.yearsUntilWithdrawal}yr) with ${(equityPct*100).toFixed(0)}% equity — sequence-of-returns risk`);
  if (bondPct === 0 && profile.derivedRiskTolerance === 'conservative') flags.push('Conservative profile with zero fixed income allocation');
  if (expectedVol > 0.22 && profile.riskScore <= 4) flags.push(`Portfolio vol ${(expectedVol*100).toFixed(1)}% may exceed conservative investor tolerance`);

  const approved = !flags.some(f => f.includes('No emergency fund') || f.includes('exceeds 40%'));

  return {
    approved,
    maxDrawdownEstimate,
    concentrationRisk: maxWeight > 0.35
      ? `Elevated — ${top.ticker} is ${(maxWeight*100).toFixed(0)}% of portfolio; consider trimming to ≤30% for better diversification`
      : `Low — largest holding ${top?.ticker ?? ''} at ${(maxWeight*100).toFixed(0)}%; well-diversified`,
    sequenceRisk: answers.yearsUntilWithdrawal < 5
      ? `High — ${answers.yearsUntilWithdrawal}-year horizon leaves little recovery time; a bear market in year 1-2 materially impairs outcomes`
      : answers.yearsUntilWithdrawal < 10
        ? `Moderate — within 10 years of withdrawal; monitor equity drift and consider glide path toward lower vol`
        : `Low — ${answers.yearsUntilWithdrawal}-year horizon provides full recovery time from historical bear markets (avg recovery 3.5 years)`,
    inflationSensitivity: bondPct > 0.30
      ? `Elevated — ${(bondPct*100).toFixed(0)}% fixed income loses real value if inflation exceeds bond yield; consider SCHP (TIPS) as partial hedge`
      : `Low — equity-heavy portfolio historically outpaces inflation; real assets (VNQ, IAU) can supplement if CPI spikes`,
    liquidityRisk: cashPct > 0.08
      ? `Low — ${(cashPct*100).toFixed(0)}% in cash/T-bills provides adequate near-term liquidity`
      : answers.hasEmergencyFund
        ? `Low — external emergency fund covers near-term needs; portfolio is fully invested for long-term growth`
        : `Elevated — no emergency fund and only ${(cashPct*100).toFixed(0)}% cash; any unexpected expense may force selling equities at inopportune time`,
    durationRisk: bondPct > 0.15
      ? `Moderate — bond allocation (avg duration ~6yr for BND/VTEB) loses ~6% in value per 100bps rate rise; mitigated by short horizon positioning`
      : `Minimal — low bond weighting limits interest rate sensitivity`,
    flags,
    adjustedAllocation: undefined,
  };
}

// ─── Tax Plan ─────────────────────────────────────────────────────────────────
function deriveTaxPlan(
  allocation: AllocationSlice[],
  profile: InvestorProfile,
  answers: IntakeAnswers,
  flags: AccountFlags,
): TaxPlan {
  const { hasTaxable, hasRoth, hasTrad, hasHSA } = flags;
  const rate = profile.effectiveMarginalRate;

  // Asset location — rules from IRS + Bogleheads best practices
  const assetLocationMap: Record<string, string> = {};
  for (const s of allocation) {
    const t = s.ticker;
    if (CASH_TICKERS.has(t)) {
      assetLocationMap[t] = hasHSA ? 'hsa' : 'taxable';
    } else if (MUNI_TICKERS.has(t)) {
      assetLocationMap[t] = 'taxable'; // tax-exempt yield — only valuable in taxable
    } else if (CORE_BOND_TICKERS.has(t)) {
      assetLocationMap[t] = hasTrad ? 'traditional' : hasRoth ? 'roth' : 'taxable';
    } else if (REIT_TICKERS.has(t)) {
      assetLocationMap[t] = hasTrad ? 'traditional' : hasRoth ? 'roth' : 'taxable';
    } else if (HIGHGROWTH_TICKERS.has(t)) {
      assetLocationMap[t] = hasRoth ? 'roth' : hasTrad ? 'traditional' : 'taxable';
    } else if (INTL_TICKERS.has(t)) {
      assetLocationMap[t] = 'taxable'; // foreign tax credit only available in taxable
    } else {
      assetLocationMap[t] = 'taxable'; // VTI, VOO, SCHD — tax-efficient, taxable is fine
    }
  }

  // Estimated annual tax saving
  const aum = answers.startingCapital + answers.monthlyContribution * 12;
  const muniPct = allocation.filter(s => MUNI_TICKERS.has(s.ticker)).reduce((s, x) => s + x.weight, 0);
  const muniSaving = muniPct > 0 ? Math.round(muniPct * aum * 0.032 * rate) : 0;
  const locationSaving = (hasTrad || hasRoth) ? Math.round(aum * 0.002) : 0;
  const estimatedAnnualTaxSaving = muniSaving + locationSaving;

  const muniBondSuitable = rate >= 0.22 && hasTaxable;
  const rothConversionOpportunity = hasTrad && answers.annualIncome < 160_000;

  const steps: string[] = [];
  steps.push(hasTaxable
    ? `Fund taxable account with tax-efficient ETFs first: ${allocation.filter(s => assetLocationMap[s.ticker] === 'taxable').map(s => s.ticker).join(', ') || 'VTI, VEA'}.`
    : 'All investments in tax-advantaged accounts — prioritize maxing these before any taxable investing.');
  if (hasRoth) steps.push(`Max Roth IRA ($7,000/yr or $8,000 if age 50+). Place highest-growth holdings here: ${allocation.filter(s => assetLocationMap[s.ticker] === 'roth').map(s => s.ticker).join(', ') || 'AVUV, AVDV'} — tax-free compounding on factor premiums is the highest-value use of Roth space.`);
  if (hasTrad) steps.push(`Place bond/REIT holdings in Traditional/401k: ${allocation.filter(s => assetLocationMap[s.ticker] === 'traditional').map(s => s.ticker).join(', ') || 'BND'} — defers ordinary income until withdrawal at (likely lower) retirement rate.`);
  if (muniBondSuitable) steps.push(`VTEB${answers.state === 'CA' ? '/CMF' : ''} in taxable: tax-exempt yield at your ${(rate*100).toFixed(0)}% marginal rate = TEY ${(0.032/(1-rate)*100).toFixed(1)}%, which beats BND after-tax. Never place munis in tax-deferred (wastes the exemption).`);
  if (hasTaxable) steps.push('Tax-loss harvest each November/December: sell positions with unrealized losses, immediately reinvest in a correlated ETF (e.g. VTI→SCHB, VEA→EFA) to preserve factor exposure while resetting cost basis. Apply losses against capital gains first, then up to $3,000/yr ordinary income.');
  if (rothConversionOpportunity) steps.push(`Roth conversion window: each January, evaluate converting Traditional IRA funds up to the top of your ${(rate*100).toFixed(0)}% bracket before year's income is known. Especially valuable if income drops in any year.`);
  if (hasHSA) steps.push('Max HSA ($4,300 single / $8,550 family for 2026). Triple tax advantage: pre-tax contributions, tax-free growth, tax-free medical withdrawals. Invest in VTI or SGOV — never use as a spending account.');
  steps.push(`Rebalance using new contributions first (zero tax cost). Only sell to rebalance in tax-advantaged accounts. Set calendar reminder: ${answers.yearsUntilWithdrawal > 10 ? 'annual' : 'semi-annual'} rebalancing review.`);

  return {
    assetLocationMap,
    estimatedAnnualTaxSaving,
    harvesting: hasTaxable
      ? `Tax-loss harvest annually Nov/Dec. Target unrealized losses >$500. Swap pairs: VTI↔SCHB, VEA↔EFA, AVUV↔VBR, BND↔AGG. 30-day wash-sale rule applies — do not repurchase the same ETF within 30 days.`
      : 'No taxable account — tax-loss harvesting not applicable to your current account structure.',
    rothConversionOpportunity,
    muniBondSuitable,
    hsaStrategy: hasHSA
      ? 'Max HSA annually. Invest in SGOV (liquid, earns ~4.2%) or VTI for long-term growth. Pay medical expenses out-of-pocket now; save receipts indefinitely for future tax-free reimbursement — this makes the HSA an additional stealth retirement account.'
      : 'No HSA currently. If you have access to an HSA-eligible high-deductible health plan, the triple tax advantage (deduction + growth + withdrawal) is the single most tax-efficient account available — consider switching.',
    implementationSteps: steps,
  };
}

// ─── Critic Scoring ───────────────────────────────────────────────────────────
function deriveCriticScore(
  draft: PortfolioDraft,
  profile: InvestorProfile,
  answers: IntakeAnswers,
  taxPlan: TaxPlan,
  riskAssessment: RiskAssessment,
): CriticScore {
  const equityPct  = draft.allocation.filter(s => !CASH_TICKERS.has(s.ticker) && !BOND_TICKERS.has(s.ticker)).reduce((s, x) => s + x.weight, 0);
  const cashPct    = draft.allocation.filter(s => CASH_TICKERS.has(s.ticker)).reduce((s, x) => s + x.weight, 0);
  const maxWeight  = Math.max(...draft.allocation.map(s => s.weight));
  const hasForeign = draft.allocation.some(s => ['VEA','VWO','VXUS','AVDV'].includes(s.ticker));
  const hasFactor  = draft.allocation.some(s => ['AVUV','AVDV','VBR','MTUM'].includes(s.ticker));
  const hasLiquidity = answers.hasEmergencyFund || cashPct >= 0.08;
  const maxEquityAllowed = Math.min(1.0, profile.riskScore * 0.10 + 0.15);
  const taxDragInTaxable = draft.allocation.some(s => TAX_DRAG_TICKERS.has(s.ticker) && s.accountPlacement === 'taxable');

  // ── Hard fails ────────────────────────────────────────────────────────────────
  const hardFailReasons: string[] = [];
  if (equityPct > maxEquityAllowed + 0.05) hardFailReasons.push(`Equity ${(equityPct*100).toFixed(0)}% exceeds max ${(maxEquityAllowed*100).toFixed(0)}% for risk score ${profile.riskScore}/10`);
  if (!answers.hasEmergencyFund && cashPct < 0.05) hardFailReasons.push('No emergency fund and no liquid safety sleeve in portfolio');
  if (draft.expectedReturn < 0.038) hardFailReasons.push(`Expected return ${(draft.expectedReturn*100).toFixed(1)}% below risk-free rate — no justification for market risk`);
  if (hardFailReasons.length > 0) {
    return { suitability:0, riskAlignment:0, goalFeasibility:0, taxEfficiency:0, diversification:0, total:0, hardFail:true, hardFailReasons, top3Deficiencies: hardFailReasons.slice(0,3), shouldRevise:true, commentary:`Hard fail: ${hardFailReasons[0]}` };
  }

  // ── Suitability /30 ──────────────────────────────────────────────────────────
  const riskMatch     = Math.abs(equityPct - Math.min(1, profile.riskScore / 10)) < 0.20;
  const horizonMatch  = profile.timeHorizonBucket === 'very_long' ? equityPct > 0.55
                      : profile.timeHorizonBucket === 'short' ? equityPct < 0.55 : true;
  const suitability   = Math.min(30, (riskMatch ? 20 : 12) + (hasLiquidity ? 6 : 0) + (horizonMatch ? 4 : 0));

  // ── Risk Alignment /25 ───────────────────────────────────────────────────────
  const sharpe = draft.sharpeEstimate;
  const riskAlignment = sharpe >= 0.22 ? 25 : sharpe >= 0.16 ? 23 : sharpe >= 0.12 ? 20 : sharpe >= 0.08 ? 16 : 10;

  // ── Goal Feasibility /20 ─────────────────────────────────────────────────────
  const targetFV  = answers.startingCapital * Math.pow(1.06, answers.yearsUntilWithdrawal)
                  + answers.monthlyContribution * 12 * answers.yearsUntilWithdrawal;
  const p50ratio  = draft.monteCarloP50 / Math.max(1, targetFV);
  const goalFeasibility = p50ratio >= 1.5 ? 20 : p50ratio >= 1.0 ? 17 : p50ratio >= 0.7 ? 13 : 8;

  // ── Tax Efficiency /15 ───────────────────────────────────────────────────────
  const hasTaxAdv     = answers.accounts.some(a => /roth|401|ira|hsa/i.test(a));
  const munisCorrect  = !draft.allocation.some(s => ['VTEB','CMF','MUB'].includes(s.ticker)) || taxPlan.muniBondSuitable;
  const taxEfficiency = Math.min(15, (taxDragInTaxable ? 6 : 12) + (munisCorrect ? 2 : 0) + (hasTaxAdv ? 1 : 0));

  // ── Diversification /10 ──────────────────────────────────────────────────────
  const concScore = maxWeight < 0.25 ? 4 : maxWeight < 0.35 ? 3 : maxWeight < 0.45 ? 1 : 0;
  const geoScore  = hasForeign ? 3 : 0;
  const factorScore = hasFactor ? 2 : 1;
  const cntBonus  = draft.allocation.length >= 4 ? 1 : 0;
  const diversification = Math.min(10, concScore + geoScore + factorScore + cntBonus);

  const total = Math.min(100, suitability + riskAlignment + goalFeasibility + taxEfficiency + diversification);

  // ── Deficiencies ─────────────────────────────────────────────────────────────
  const deficiencies: string[] = [];
  if (suitability < 22)      deficiencies.push(`Suitability (${suitability}/30): adjust equity % closer to ${(Math.min(1,profile.riskScore/10)*100).toFixed(0)}% target for risk score ${profile.riskScore}`);
  if (riskAlignment < 18)    deficiencies.push(`Risk/Sharpe (${riskAlignment}/25): current Sharpe ${sharpe.toFixed(2)} — reduce max position below 30% and increase AVUV/AVDV weight for higher expected return`);
  if (goalFeasibility < 14)  deficiencies.push(`Goal feasibility (${goalFeasibility}/20): P50 projection below target — increase expected return via factor tilts or reduce bond allocation`);
  if (taxEfficiency < 10)    deficiencies.push(`Tax efficiency (${taxEfficiency}/15): ${taxDragInTaxable ? 'tax-inefficient assets in taxable account' : 'sub-optimal asset location'}`);
  if (diversification < 6)   deficiencies.push(`Diversification (${diversification}/10): max holding ${(maxWeight*100).toFixed(0)}% — reduce concentration${!hasForeign ? ' and add international exposure' : ''}`);

  // Trigger a second LLM pass only when a core dimension is structurally broken —
  // not when the plan is merely imperfect. A plan scoring 80–87 with sound fundamentals
  // does not benefit enough from a second pass to justify the 15–25s latency cost.
  //
  // criticalFailure thresholds (each is ~53% of dimension max):
  //   suitability  < 16/30 → equity/risk fit genuinely wrong for this investor
  //   riskAlignment < 14/25 → Sharpe below ~0.08 — construction quality too low
  //   goalFeasibility < 10/20 → P50 projection badly misses target
  //
  // CRITIC_PASS_THRESHOLD = 80 (in constants.ts) — both conditions must be true to revise.
  const criticalFailure = suitability < 16 || riskAlignment < 14 || goalFeasibility < 10;
  const shouldRevise = total < CRITIC_PASS_THRESHOLD && criticalFailure && deficiencies.length > 0;

  const commentary = total >= 90 ? 'Excellent — all five fiduciary dimensions met.'
    : total >= 80 ? `Strong plan (${total}/100) — minor optimizations available but suitable for investor goals.`
    : `Score ${total}/100 — ${deficiencies[0] ?? 'review dimension scores above'}.`;

  return { suitability, riskAlignment, goalFeasibility, taxEfficiency, diversification, total, hardFail:false, hardFailReasons:[], top3Deficiencies: deficiencies.slice(0,3), shouldRevise, commentary };
}

// ─── Owner Manual ─────────────────────────────────────────────────────────────
function buildOwnerManual(
  answers: IntakeAnswers,
  profile: InvestorProfile,
  macro: MacroContext,
  draft: PortfolioDraft,
  taxPlan: TaxPlan,
  criticScore: CriticScore,
  iterations: number,
  flags: AccountFlags,
): { ownerManual: OwnerManualSection[]; executiveSummary: string } {
  const tol = profile.derivedRiskTolerance.replace('_', '-');
  const goalLabel = answers.primaryGoal.replace(/_/g, ' ');

  // ── Executive Summary ──────────────────────────────────────────────────────
  const macroColor = macro.regime === 'risk_on' ? 'constructive risk-on' : macro.regime === 'risk_off' ? 'defensive risk-off' : 'transitional';
  const scoreNote = criticScore.total >= 90 ? 'passed all fiduciary criteria' : criticScore.total >= 80 ? 'passed fiduciary review' : 'meets core fiduciary standards';
  const executiveSummary =
    `A ${tol} portfolio targeting ${pct(draft.expectedReturn)} annual return with ${pct(draft.expectedVolatility)} volatility (Sharpe ${draft.sharpeEstimate.toFixed(2)}), ` +
    `optimized for ${goalLabel} over ${answers.yearsUntilWithdrawal} years across ${draft.allocation.length} ETFs — ${scoreNote} (${criticScore.total}/100) after ${iterations} pass${iterations > 1 ? 'es' : ''} in a ${macroColor} macro environment. ` +
    `Adding ${money(answers.monthlyContribution)}/month to a ${money(answers.startingCapital)} base, the median ${answers.yearsUntilWithdrawal}-year projection reaches ${money(draft.monteCarloP50)} with ${Math.round(draft.successProbability * 100)}% probability of beating inflation.`;

  // ── Rebalancing Schedule ───────────────────────────────────────────────────
  const driftThreshold = profile.riskScore >= 7 ? '5%' : '3%';
  const rebalFreq = profile.riskScore >= 7 ? 'semi-annually or after a >15% market move' : 'quarterly';
  const rebalAction =
    profile.derivedRiskTolerance === 'conservative' || profile.derivedRiskTolerance === 'moderate'
      ? 'Trim equity when it drifts above target — resist the urge to let winners run beyond your risk budget.'
      : 'Rebalance into drawdowns — dips in AVUV/AVDV are the systematic buy signal; do not rebalance away from factor tilts during normal volatility.';
  const rebalancing: OwnerManualSection = {
    title: 'Rebalancing Schedule',
    frequency: 'quarterly',
    body: `Review allocation ${rebalFreq} and rebalance any holding that drifts more than ${driftThreshold} from its target weight. Use new contributions to rebalance first (zero transaction cost). ${rebalAction}`,
  };

  // ── Tax Calendar ──────────────────────────────────────────────────────────
  const { hasTaxable, hasRoth } = flags;
  const decemberHarvest = hasTaxable ? 'Scan for tax-loss harvesting opportunities each November/December — pair realized losses against any capital gains.' : '';
  const rothNote = taxPlan.rothConversionOpportunity
    ? ' Evaluate a Roth conversion each January before income is known — convert up to the top of your current bracket.'
    : hasRoth ? ' Max Roth contributions by April 15 of the following year.' : '';
  const taxCalendar: OwnerManualSection = {
    title: 'Tax Calendar',
    frequency: 'annually',
    body: `File tax forms for any harvested losses and apply to offset gains. ${decemberHarvest}${rothNote} Estimated annual tax savings from current asset location: $${taxPlan.estimatedAnnualTaxSaving.toLocaleString()}/yr.`,
  };

  // ── Behavioral Guardrails ─────────────────────────────────────────────────
  const biasType = answers.marketDropReaction;
  let guardrailBody: string;
  if (biasType === 'panic') {
    guardrailBody =
      'You identified as likely to sell during drawdowns — this is the #1 wealth destroyer. Write down your portfolio rationale today and re-read it before making any sell decision during a market decline. ' +
      'Set a rule: no selling during a drawdown of less than 30% unless your financial situation has fundamentally changed. The SGOV sleeve exists precisely to fund near-term needs so you never have to sell equities at lows.';
  } else if (biasType === 'aggressive') {
    guardrailBody =
      'You tend to buy more during dips — a strength, but overconfidence during sharp selloffs can lead to over-leverage or premature averaging into a falling knife. ' +
      'Cap additional dip-buying to 10% of your cash reserves per event, and never margin-borrow for this portfolio. Stick to the target weights; do not double down on a single ETF beyond 40%.';
  } else {
    guardrailBody =
      'Inertia is your main risk — prolonged drawdowns may tempt you to "wait for recovery" before rebalancing, which delays buying low. ' +
      'Automate contributions and set calendar reminders for quarterly reviews so action is scheduled, not emotion-driven. If a holding is down >20%, that is the rebalance signal to buy more, not to wait.';
  }
  const guardrails: OwnerManualSection = {
    title: 'Behavioral Guardrails',
    frequency: 'as-needed',
    body: guardrailBody,
  };

  // ── Crash Playbook ────────────────────────────────────────────────────────
  let crashBody: string;
  if (profile.derivedRiskTolerance === 'conservative') {
    crashBody =
      `A 20–30% equity market crash reduces your ${pct(1 - (draft.allocation.find(s => s.bucket === 'safety' || s.bucket === 'income')?.weight ?? 0))} equity sleeve by that amount — your bond/cash sleeve buffers total portfolio damage. ` +
      'Do not rebalance bonds into equity during a crash unless your time horizon is still >7 years. Your primary defense is your existing fixed-income allocation; do not abandon it chasing a market recovery.';
  } else if (profile.derivedRiskTolerance === 'moderate') {
    crashBody =
      `A 30% equity crash drops your portfolio by roughly 20–22% given your bond allocation. This is expected and within your risk budget. ` +
      'Rebalance: shift 3–5% from bonds to equity at -20% and another 3–5% at -35% — these systematic moves are the mechanical version of "buy low." Do not sell anything.';
  } else {
    crashBody =
      `A 40% equity crash is possible and within your risk budget as an ${tol} investor — your ${answers.yearsUntilWithdrawal}-year horizon gives full recovery time based on all post-1929 bear markets. ` +
      'Your playbook: do nothing at -15%, add 5% of cash reserves at -25%, add another 5% at -40%. AVUV and AVDV historically recover faster than the broad market post-crash due to small-cap mean reversion.';
  }
  const crashPlaybook: OwnerManualSection = {
    title: 'Crash Playbook',
    frequency: 'as-needed',
    body: crashBody,
  };

  return {
    executiveSummary,
    ownerManual: [rebalancing, taxCalendar, guardrails, crashPlaybook],
  };
}

// ─── Benchmark Comparison (deterministic — no LLM needed) ────────────────────
// VT (Vanguard Total World Stock ETF) is the passive global-market benchmark.
// A fiduciary portfolio should beat VT on RISK-ADJUSTED (Sharpe) and after-tax basis.
const VT_RETURN = 0.063;  // 2026 CMA consensus for total world equity
const VT_VOL    = 0.150;  // ~15% annualized historical vol

function computeBenchmarkComparison(
  answers: IntakeAnswers,
  profile: InvestorProfile,
  draft: PortfolioDraft,
  taxPlan: TaxPlan,
  rf: number,            // live 10-yr Treasury yield from Capital Markets agent
  flags: AccountFlags,
): BenchmarkComparison {
  const VT_SHARPE = (VT_RETURN - rf) / VT_VOL;
  const inflAdj = answers.startingCapital * Math.pow(1.028, answers.yearsUntilWithdrawal);
  const vtMC = runMonteCarlo(VT_RETURN, VT_VOL, answers.startingCapital, answers.monthlyContribution, answers.yearsUntilWithdrawal, inflAdj);

  // ── VT after-tax return ──
  // VT dividend yield ~1.9%; qualified dividends taxed at LTCG rate.
  // In taxable accounts this creates ~0.3–0.5% annual tax drag.
  const { hasTaxable } = flags;
  const vtTaxDrag = hasTaxable ? 0.019 * profile.capitalGainsRate : 0;
  const vtAfterTaxReturn = VT_RETURN - vtTaxDrag;

  // ── Portfolio after-tax return ──
  // Tax alpha from asset location + muni bonds (computed by Tax agent) reduces drag.
  const aum = answers.startingCapital + answers.monthlyContribution * 12;
  const portfolioTaxAlphaPct = aum > 0 ? taxPlan.estimatedAnnualTaxSaving / aum : 0;
  const portfolioAfterTaxReturn = draft.expectedReturn + portfolioTaxAlphaPct - vtTaxDrag;

  // ── Alpha attribution ──
  const factorAlphaBps  = Math.round((draft.expectedReturn - VT_RETURN) * 10000);
  const taxAlphaBps     = Math.round(portfolioTaxAlphaPct * 10000);
  const rebalanceBps    = 35; // ~0.35% rebalancing premium (academic consensus)
  const volDiff         = VT_VOL - draft.expectedVolatility;
  const sharpeFromVol   = volDiff > 0 ? `Portfolio vol ${(draft.expectedVolatility*100).toFixed(1)}% vs VT 15% — lower vol improves Sharpe` : `Broad factor diversification matches VT vol`;

  return {
    vtExpectedReturn:      VT_RETURN,
    vtVolatility:          VT_VOL,
    vtSharpe:              VT_SHARPE,
    vtMonteCarloP10:       vtMC.p10,
    vtMonteCarloP50:       vtMC.p50,
    vtMonteCarloP90:       vtMC.p90,
    vtSuccessProbability:  vtMC.successProbability,
    vtAfterTaxReturn,
    returnAlpha:           draft.expectedReturn - VT_RETURN,
    sharpeAlpha:           draft.sharpeEstimate - VT_SHARPE,
    afterTaxAlpha:         portfolioAfterTaxReturn - vtAfterTaxReturn,
    alphaAttribution: [
      {
        source: 'Factor Premiums',
        bps: factorAlphaBps,
        description: `Small-cap value (AVUV 7.5%), intl small value (AVDV 8.5%), and momentum tilt generate ${factorAlphaBps > 0 ? '+' : ''}${factorAlphaBps}bps vs VT's market-cap-weighted 6.3% CMA`,
      },
      {
        source: 'Tax Alpha',
        bps: taxAlphaBps,
        description: `Asset location + ${taxPlan.muniBondSuitable ? 'muni bonds + ' : ''}tax-loss harvesting saves ~$${taxPlan.estimatedAnnualTaxSaving.toLocaleString()}/yr; VT in taxable provides no location optimization`,
      },
      {
        source: 'Volatility / Sharpe',
        bps: Math.round(volDiff * 10000),
        description: sharpeFromVol,
      },
      {
        source: 'Rebalancing Premium',
        bps: rebalanceBps,
        description: 'Systematic quarterly rebalancing between negatively-correlated asset classes captures ~0.35%/yr; VT never rebalances its factor exposures',
      },
    ],
  };
}

// ─── Main Route Handler (Streaming NDJSON) ───────────────────────────────────
// Responses are streamed as newline-delimited JSON so the frontend can render
// the first plan as soon as Portfolio Construction finishes — without waiting
// for the optional revision pass or the cache write to complete.
//
// Chunk types emitted on the stream:
//   { type: 'log',   message: string }               — progress updates
//   { type: 'plan',  plan: PortfolioPlan, logs: [] } — renderable plan (may arrive twice if revised)
//   { type: 'error', error: string }                 — fatal error
//   { type: 'done' }                                 — stream complete
export async function POST(req: NextRequest) {
  // ── Parse body + auth synchronously before streaming starts ─────────────────
  // HTTP-level errors (401, 400) must return before the stream opens so the
  // client sees a non-200 status it can handle without reading the body.
  let answers: IntakeAnswers;
  try {
    const body = await req.json();
    answers = (body as { answers: IntakeAnswers }).answers;
    if (!answers) return NextResponse.json({ error: 'Missing answers' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // push() serialises a chunk and enqueues it — silently ignores writes to a
      // closed stream (e.g. if the client disconnected mid-stream).
      const push = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch { /* closed */ }
      };

      try {
        // ── Plan cache check ───────────────────────────────────────────────────
        // Cache hit: stream the plan immediately and close — zero Gemini cost.
        const cached = await getCachedPlan(answers as unknown as Record<string, unknown>);
        if (cached) {
          push({ type: 'plan', plan: cached.plan, logs: cached.logs });
          controller.close();
          return;
        }

        const ai = new GoogleGenAI({ apiKey: getApiKey() });
        const logs: string[] = [];
        const log = (msg: string) => { logs.push(msg); push({ type: 'log', message: msg }); };

        log('Starting Portfolio Agent pipeline...');

        // ── Agent 1: deterministic (~0ms) ──────────────────────────────────────
        log('Agent 1/6: Deriving investor profile (deterministic)...');
        const profile = deriveInvestorProfile(answers);
        const flags   = deriveAccountFlags(answers.accounts);
        log(`Profile: ${profile.derivedRiskTolerance} investor | risk ${profile.riskScore}/10 | ${answers.yearsUntilWithdrawal}yr horizon`);

        // ── Agent 2: Capital Markets (two-level cache → live search) ──────────
        log('Agent 2/6: Researching live market conditions...');
        const macroT0 = Date.now();
        let macroRetried = false;
        const macro = await runCapitalMarketsAgent(ai).catch(async (e: unknown) => {
          if (!isTransientGeminiError(e)) throw e;
          macroRetried = true;
          log('⚠ Market data timeout — retrying...');
          await new Promise(r => setTimeout(r, 2_000));
          return runCapitalMarketsAgent(ai);
        });
        const liveRF = parseRiskFreeRate(macro.tenYearYield);
        console.log(JSON.stringify({ stage: 'capital_markets', model: MODEL, timeoutMs: 60_000, durationMs: Date.now() - macroT0, retried: macroRetried, usedFallback: false }));
        log(`Market context: ${macro.regime} | equity ${macro.equityValuation} | bonds ${macro.bondOpportunity} | rf ${(liveRF * 100).toFixed(2)}%`);

        // ── Inner pipeline: Construction → Risk → Tax → Critic ─────────────────
        type PipelineResult = { draft: PortfolioDraft; riskAssessment: RiskAssessment; taxPlan: TaxPlan; criticScore: CriticScore };

        async function runOnePipeline(criticFeedback?: string[], brief = false): Promise<PipelineResult> {
          const d = await runPortfolioConstructionAgent(ai, answers, profile, macro, liveRF, flags, criticFeedback, brief);
          const risk = deriveRiskAssessment(d.allocation, profile, answers, d.expectedVolatility);
          const tax = deriveTaxPlan(d.allocation, profile, answers, flags);
          if (!Array.isArray(d.allocation) || d.allocation.length === 0) {
            throw new Error('draft.allocation is not a valid array before tax location mapping');
          }
          d.allocation = d.allocation.map(slice => ({
            ...slice,
            accountPlacement: (tax.assetLocationMap[slice.ticker] as AllocationSlice['accountPlacement']) ?? slice.accountPlacement,
          }));
          log('Validating portfolio...');
          const cs = deriveCriticScore(d, profile, answers, tax, risk);
          return { draft: d, riskAssessment: risk, taxPlan: tax, criticScore: cs };
        }

        // assemblePlan() is pure deterministic synthesis — ~0ms, called once per
        // emitted plan chunk (at most twice: after pass 1 and after a successful revision).
        function assemblePlan(r: PipelineResult, iters: number): PortfolioPlan {
          const allocation = normalizeAllocation(r.draft.allocation);
          const draftWithNorm = { ...r.draft, allocation };
          const synthesis = buildOwnerManual(answers, profile, macro, draftWithNorm, r.taxPlan, r.criticScore, iters, flags);
          const benchmarkComparison = computeBenchmarkComparison(answers, profile, draftWithNorm, r.taxPlan, liveRF, flags);
          log(`Benchmark vs VT: return ${benchmarkComparison.returnAlpha >= 0 ? '+' : ''}${(benchmarkComparison.returnAlpha * 100).toFixed(2)}% | Sharpe ${benchmarkComparison.sharpeAlpha >= 0 ? '+' : ''}${benchmarkComparison.sharpeAlpha.toFixed(2)} vs VT`);
          return {
            allocation,
            expectedReturn: r.draft.expectedReturn,
            expectedVolatility: r.draft.expectedVolatility,
            sharpeEstimate: r.draft.sharpeEstimate,
            monteCarloP10: r.draft.monteCarloP10,
            monteCarloP50: r.draft.monteCarloP50,
            monteCarloP90: r.draft.monteCarloP90,
            successProbability: r.draft.successProbability,
            macroContext: macro,
            taxPlan: r.taxPlan,
            riskAssessment: r.riskAssessment,
            criticScore: r.criticScore,
            iterationsRan: iters,
            investorProfile: profile,
            ownerManual: synthesis.ownerManual,
            executiveSummary: synthesis.executiveSummary,
            generatedAt: new Date().toISOString(),
            benchmarkComparison,
          };
        }

        // ── Pass 1 ─────────────────────────────────────────────────────────────
        log('Agent 3/6: Building portfolio...');
        const constT0 = Date.now();
        let constRetried = false;
        let result = await runOnePipeline().catch(async (e: unknown) => {
          if (!isTransientGeminiError(e)) throw e;
          constRetried = true;
          log('⚠ Construction timeout — retrying with compact prompt...');
          await new Promise(r => setTimeout(r, 2_000));
          return runOnePipeline(undefined, true);
        });
        console.log(JSON.stringify({ stage: 'construction_pass1', model: MODEL, timeoutMs: 90_000, durationMs: Date.now() - constT0, retried: constRetried, usedFallback: constRetried }));
        log(`Pass 1: ${result.criticScore.total}/100 | Sharpe ${result.draft.sharpeEstimate.toFixed(2)}`);

        if (result.criticScore.hardFail) {
          const reasons = result.criticScore.hardFailReasons.join('; ');
          log(`Hard fail: ${reasons}`);
          push({ type: 'error', error: `Portfolio failed structural validation: ${reasons}` });
          controller.close();
          return;
        }

        let best = result;
        let iterations = 1;

        // ── STREAM PASS-1 PLAN IMMEDIATELY ────────────────────────────────────
        // The user sees the full plan output now (15–25s) rather than waiting for
        // the optional revision pass (which adds another 15–25s on top).
        log('Finalizing recommendation...');
        push({ type: 'plan', plan: assemblePlan(result, 1), logs: [...logs] });

        // ── Optional revision pass (runs AFTER first plan is already streamed) ─
        // The user is reading results while the server runs this improvement pass.
        // Hard cap: if revision doesn't complete within REVISION_CAP_MS, fall back to the
        // original validated plan. Any failure (timeout or parse error) is treated the same
        // way — the stream never errors out because of a revision miss.
        const REVISION_CAP_MS = 65_000;
        while (result.criticScore.shouldRevise && iterations < MAX_ITERATIONS) {
          iterations++;
          const deficiencies = result.criticScore.top3Deficiencies?.filter(Boolean) ?? [];
          const sharpeCtx = `Current Sharpe: ${result.draft.sharpeEstimate.toFixed(2)} — improve by reducing max position below 30% and tilting toward AVUV (7.5%) / AVDV (8.5%)`;
          const feedback = [sharpeCtx, ...deficiencies];
          log(`Pass ${iterations}: Refining plan — fixing: ${deficiencies[0] ?? 'top deficiencies'}...`);
          const revT0 = Date.now();
          let revRetried = false;

          // Race the full revision attempt (including one transient retry) against the cap.
          // resolve(null) on timeout or any non-transient error — never rejects.
          const revisionResult = await Promise.race([
            runOnePipeline(feedback).catch(async (e: unknown) => {
              if (!isTransientGeminiError(e)) {
                console.log(JSON.stringify({ stage: 'construction_revision', model: MODEL, durationMs: Date.now() - revT0, error: e instanceof Error ? e.message.slice(0, 120) : String(e) }));
                return null;
              }
              revRetried = true;
              log('⚠ Revision error — retrying...');
              await new Promise(r => setTimeout(r, 2_000));
              return runOnePipeline(feedback, true).catch(() => null);
            }),
            new Promise<null>(resolve => setTimeout(() => resolve(null), REVISION_CAP_MS)),
          ]);

          const revDurationMs = Date.now() - revT0;
          const timedOut = revisionResult === null;
          console.log(JSON.stringify({ stage: 'construction_revision', model: MODEL, timeoutMs: 75_000, durationMs: revDurationMs, retried: revRetried, timedOut }));

          if (timedOut) {
            log('⚠ Revision timed out — finalizing with original validated plan');
            break;
          }

          result = revisionResult;
          log(`Pass ${iterations}: ${result.criticScore.total}/100${result.criticScore.total > best.criticScore.total ? ' ↑ improved' : ''}`);
          if (result.criticScore.total > best.criticScore.total) {
            best = result;
            // Stream the improved plan — frontend swaps to the updated version.
            push({ type: 'plan', plan: assemblePlan(best, iterations), logs: [...logs] });
          }
        }

        log(`Final plan: ${best.criticScore.total}/100 after ${iterations} pass${iterations > 1 ? 'es' : ''}`);

        // ── Cache write (fire-and-forget — never blocks response) ─────────────
        const finalPlan = assemblePlan(best, iterations);
        setCachedPlan(answers as unknown as Record<string, unknown>, finalPlan, logs)
          .catch(e => console.error('[portfolio-agent] cache write failed:', e));

        push({ type: 'done' });
        controller.close();

      } catch (e: unknown) {
        console.error('[POST /api/portfolio-agent]', e);
        push({ type: 'error', error: e instanceof Error ? e.message : 'Server error' });
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      // Disable nginx/Vercel edge proxy buffering so chunks flush immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}
