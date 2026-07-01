import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { auth } from '@clerk/nextjs/server';
import { CURATED_ASSETS } from '@/lib/assets';
import { checkRateLimit } from '@/lib/rateLimit';

// ─── Typed interfaces for Gemini plan responses ───────────────────────────────
interface BucketRates {
  rate: number;
  volatility: number;
}

interface GeminiMarketRates {
  shortTerm: BucketRates;
  longTerm: BucketRates;
  retirement: BucketRates;
}

interface BucketSize {
  percent: number;
  dollar: number;
}

interface GeminiPlanSummary {
  bucketSizes: {
    shortTerm: BucketSize;
    longTerm: BucketSize;
    retirement: BucketSize;
  };
  projectedOutcome?: number;
  successProbability?: number;
  monteCarlo?: {
    paths: number;
    p10: number;
    p50: number;
    p90: number;
    successProbability: number;
  };
  keyTakeaways?: string[];
}

interface BucketAsset {
  ticker: string;
  [key: string]: unknown;
}

interface BucketStrategy {
  assets: BucketAsset[];
  [key: string]: unknown;
}

interface RetirementStrategy {
  allocation: BucketStrategy;
  [key: string]: unknown;
}

interface GeminiPlanResponse {
  summary: GeminiPlanSummary;
  marketGroundedRates: GeminiMarketRates;
  shortTermStrategy?: BucketStrategy;
  longTermStrategy?: BucketStrategy;
  retirementStrategy?: RetirementStrategy;
  [key: string]: unknown;
}

type GeminiResponses = Record<string, unknown>;

// ─── API key lives ONLY on the server ────────────────────────────────────────
function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set in server environment.');
  return key;
}

// ─── POST /api/gemini ─────────────────────────────────────────────────────────
// Body: { action: 'generatePlan' | 'generateReport', responses, plan? }
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await checkRateLimit(userId, 'gemini', 30)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { action, responses, plan } = body;
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    // ── 1. Generate structured plan ──────────────────────────────────────────
    if (action === 'generatePlan') {
      // Strip commas from all numeric string fields (from comma-formatted inputs)
      const cleanedResponses = { ...responses };
      ['goalAmount','startingAmount','monthlyExpenses','monthlyContribution','annualIncome','majorExpenseCost'].forEach(k => {
        if (typeof cleanedResponses[k] === 'string') cleanedResponses[k] = (cleanedResponses[k] as string).replace(/,/g, '');
      });
      Object.assign(responses, cleanedResponses);
      const dataPrompt = buildCoreAllocationPrompt(responses);

      const dataResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: dataPrompt,
        config: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: getPlanSchema(),
        },
      });

      const jsonText = (dataResponse.text || '').trim();
      const parsed = JSON.parse(jsonText);

      // Client-side math synthesis
      const enriched = enrichWithProjections(parsed, responses);

      return NextResponse.json({ success: true, plan: enriched });
    }

    // ── 1b. Generate tax enrichment (separate fast pass) ─────────────────────
    if (action === 'generateTaxEnrichment') {
      const { plan: planData } = body;
      const prompt = buildTaxEnrichmentPrompt(planData, responses);

      const taxResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: getTaxEnrichmentSchema(),
        },
      });

      const jsonText = (taxResponse.text || '').trim();
      const parsed = JSON.parse(jsonText);
      const taxData = parsed.taxAlphaData || parsed;

      // ── Server-side backfill: patch any empty traditional401k values ──────────
      const CANONICAL_401K: Record<string, string> = {
        'Tax Treatment':                 'Pre-tax contributions, taxable withdrawals at ordinary income rate',
        '2026 Contribution Limit':       '$23,500 ($31,000 if 50+)',
        'Required Minimum Distributions':'Required starting at age 73',
        'Early Withdrawal Rules':        '10% penalty + taxes before 59½ (exceptions apply)',
        'CA State Treatment':            'CA taxes 401k distributions as ordinary income',
        'Best Assets to Hold':           'Tax-inefficient assets (BND, VNQ) — defer ordinary income',
        'Income Limits':                 'No income limit to contribute; deductibility phases out $79k–$89k (single with workplace plan)',
        'Employer Match Eligibility':    'Yes — always capture full employer match first (free money)',
      };
      if (taxData?.rothVs401k?.comparisonRows) {
        taxData.rothVs401k.comparisonRows = taxData.rothVs401k.comparisonRows.map((row: any) => {
          const val = row.traditional401k || row.traditional || '';
          const canonical = CANONICAL_401K[row.factor] || '';
          return { ...row, traditional401k: val || canonical };
        });
      }

      return NextResponse.json({ success: true, taxData });
    }

    // ── 2. Generate streaming report ─────────────────────────────────────────
    if (action === 'generateReport') {
      const prompt = buildReportPrompt(plan, responses);

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const result = await ai.models.generateContentStream({
              model: 'gemini-2.5-flash',
              contents: prompt,
              config: {
                temperature: 0.4,
                tools: [{ googleSearch: {} }],
              },
            });
            for await (const chunk of result) {
              const text = chunk.text || '';
              if (text) controller.enqueue(encoder.encode(text));
            }
          } catch (err) {
            controller.error(err);
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // ── 3. Generate AI Commentary for Portfolio Lab ───────────────────────────
    if (action === 'portfolioCommentary') {
      const { simResult, startDate, endDate, initialInvestment, monthlyContribution, allocations, ahpsScore, ahpsDimensions, beatPct } = body;
      const formatCurrency = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
      const formatPct = (v: number) => v.toFixed(2) + '%';

      if (!body.simResult?.dailyData?.length) {
        return NextResponse.json({ error: 'simResult.dailyData is empty or missing' }, { status: 400 });
      }
      const benchmarkPerformance = simResult.dailyData[simResult.dailyData.length - 1].benchmarkValue;
      const diff = simResult.metrics.endingValue - benchmarkPerformance;
      const benchmarkName = startDate >= '2010-09-07' ? 'VOO/BND (60/40)' : 'VFINX/VBMFX (60/40)';
      const scoreLabel = ahpsScore >= 70 ? 'Institutional Grade' : ahpsScore >= 55 ? 'Solid Strategy' : ahpsScore >= 40 ? 'Average' : 'Weak';

      const prompt = `You are a senior portfolio analyst. Write a tight, professional 3-paragraph commentary on this backtest. Do NOT use markdown, headers, or bullet points — plain paragraphs only.

PORTFOLIO: ${allocations.map((a: any) => `${a.ticker} (${a.percentage}%)`).join(', ')}
PERIOD: ${startDate} to ${endDate} | Initial: ${formatCurrency(initialInvestment)} | Monthly: ${formatCurrency(monthlyContribution)}

PORTFOLIO RESULTS:
- Ending Value: ${formatCurrency(simResult.metrics.endingValue)} vs Benchmark ${formatCurrency(benchmarkPerformance)} (${diff >= 0 ? '+' : ''}${formatCurrency(diff)})
- CAGR: ${formatPct(simResult.metrics.cagr)} vs Benchmark CAGR: ${formatPct(simResult.metrics.benchmarkCagr)}
- Volatility: ${formatPct(simResult.metrics.volatility)} vs Benchmark: ${formatPct(simResult.metrics.benchmarkVolatility)}
- Sortino Ratio: ${simResult.metrics.sortinoRatio.toFixed(2)} | Calmar Ratio: ${simResult.metrics.calmarRatio.toFixed(2)}
- Beta: ${simResult.metrics.beta.toFixed(2)} | Alpha (CAPM): ${simResult.metrics.alpha >= 0 ? '+' : ''}${formatPct(simResult.metrics.alpha)}
- Information Ratio: ${simResult.metrics.informationRatio.toFixed(2)}
- Max Drawdown: -${formatPct(simResult.metrics.maxDrawdown)} vs Benchmark: -${formatPct(simResult.metrics.benchmarkMaxDrawdown)}
- Beat benchmark in ${beatPct}% of years

AHPS SCORE: ${ahpsScore}/100 — ${scoreLabel}
Score breakdown (each 0–100):
- Downside-Adjusted Return (30% weight): ${ahpsDimensions?.sortinoScore} — driven by Sortino of ${simResult.metrics.sortinoRatio.toFixed(2)}
- Excess Alpha (25% weight): ${ahpsDimensions?.alphaScore} — driven by CAPM alpha of ${simResult.metrics.alpha >= 0 ? '+' : ''}${formatPct(simResult.metrics.alpha)}
- Drawdown Efficiency (20% weight): ${ahpsDimensions?.calmarScore} — driven by Calmar of ${simResult.metrics.calmarRatio.toFixed(2)}
- Annual Consistency (15% weight): ${ahpsDimensions?.consistencyScore} — beat benchmark ${beatPct}% of years
- Active Return Efficiency (10% weight): ${ahpsDimensions?.irScore} — driven by IR of ${simResult.metrics.informationRatio.toFixed(2)}

WRITING INSTRUCTIONS:
Paragraph 1 — What happened & why: Set the market context for this period and explain how this allocation's specific tickers drove performance vs the ${benchmarkName} benchmark. Reference the CAGR gap and alpha directly.
Paragraph 2 — Risk analysis: Analyze the risk profile using Sortino, Calmar, max drawdown, and volatility. Compare against the benchmark's drawdown and volatility. Explain what the numbers reveal about how the portfolio held up during down periods.
Paragraph 3 — Score verdict: Explain the AHPS score of ${ahpsScore}/100 (${scoreLabel}) by walking through which dimensions scored well and which held it back. Be direct about whether this was a good strategy, referencing the beat-rate of ${beatPct}% of years and the weakest scoring dimension. Give a clear, honest conclusion.
Write in confident analytical prose. Each paragraph 3–4 sentences. No markdown, no lists.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      return NextResponse.json({ success: true, commentary: response.text || '' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    console.error('[/api/gemini] Error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

// ─── Prompt builders ──────────────────────────────────────────────────────────
function buildCoreAllocationPrompt(responses: GeminiResponses): string {
  const str = (v: unknown): string => (v == null ? '' : String(v));
  return `You are a World-Class Institutional Portfolio Strategist — CFA charterholder, quantitative researcher, and tax expert. Generate the OPTIMAL 3-Bucket Allocation Plan for this specific user that maximizes RISK-ADJUSTED AFTER-TAX RETURNS.

FOCUS: This call generates ONLY the core asset allocation. Be precise, fast, and personalized.

═══════════════════════════════════════════════════════
INVESTMENT FRAMEWORK
═══════════════════════════════════════════════════════

1. FACTOR INVESTING & MPT:
   - Maximize Sharpe ratio for the user's specific risk tolerance
   - Factor premia in order of evidence strength: Market Beta > Value (AVUV) > Quality (SCHD) > Momentum > Low-Vol
   - Fama-French: small-cap value outperforms by 3-5% annually over 15+ year horizons
   - Diversify across uncorrelated assets to reduce vol without sacrificing return

2. EXPENSE RATIO DISCIPLINE:
   - Every basis point matters: 0.5% higher ER = ~$8,000 lost per $100K over 10 years at 7%
   - Always prefer lowest-cost fund for each asset class

3. TAX OPTIMIZATION — CALIFORNIA RESIDENT:
   - CA top marginal: 13.3% state + up to 37% federal = 50.3% combined
   - CA taxes ALL capital gains as ordinary income (no preferential rate)
   - After-tax yield hierarchy for CA residents (March 2026 actual yields):
     * HYSA: 4.10% gross → ~2.65% after-tax (WORST — avoid as primary)
     * VUSXX: 4.05% → ~3.05% after-tax (CA state-exempt, 7-day SEC yield)
     * SGOV: 4.05% → ~3.05% after-tax (CA state-exempt, T-bill ETF)
     * CMF: 2.97% → ~2.97% after-tax (BEST net for high-bracket CA — fully exempt federal + CA)

4. ASSET LOCATION:
   - ROTH IRA: Highest-growth assets (QQQM, AVUV, VGT) — tax-free compounding forever
   - TRADITIONAL 401k: Tax-inefficient assets (BND, VNQ) — shelter ordinary income
   - TAXABLE: Tax-efficient assets (VTI, VXUS, SCHD) — qualified divs + harvesting
   - CA Munis (CMF) best in TAXABLE — already tax-exempt, don't waste shelter

═══════════════════════════════════════════════════════
2026 FORWARD-LOOKING CMA BENCHMARKS
═══════════════════════════════════════════════════════
CASH/MONEY MARKET (March 2026 actual yields — sourced from fund fact sheets):
- VUSXX: 4.05% yield, vol 0.1%, ER 0.09% | CA state-exempt (7-day SEC yield)
- SGOV: 4.05% yield, vol 0.2%, ER 0.09% | CA state-exempt (T-bill ETF, same Treasury exposure)
- JAAA: 5.5–6.0% yield, vol 1%, ER 0.21% | Fully taxable, CLO AAA-rated

BONDS (March 2026 actual yields):
- CMF: 2.97% yield, vol 4%, ER 0.05% | Fully exempt federal + CA (iShares CA Muni)
- MUB: 3.20% yield, vol 4%, ER 0.05% | Federal exempt only (national muni)
- BND: 3.80% yield, vol 5%, ER 0.03% | Fully taxable — 401k/IRA only
- SCHP: 3.65% yield, vol 4%, ER 0.04% | TIPS — phantom income, tax-adv only
- BNDX: 3.30% yield, vol 5%, ER 0.07% | International bonds, taxable

US EQUITY:
- VTI: 9.5–11.0% CAGR, vol 15%, ER 0.03% | Broad, tax-efficient
- VOO/FXAIX: 9.0–10.5% CAGR, vol 15%, ER 0.015–0.03% | S&P 500 core
- SCHD: 9.0–10.5% CAGR, vol 12%, ER 0.06% | Quality factor, lower vol, qualified divs
- QQQM: 11.0–14.0% CAGR, vol 20%, ER 0.15% | Growth/tech tilt
- VGT: 12.0–15.0% CAGR, vol 22%, ER 0.10% | Concentrated tech
- AVUV: 11.0–14.0% CAGR, vol 20%, ER 0.25% | US small-cap value (Fama-French)
- VBR: 10.0–12.0% CAGR, vol 19%, ER 0.07% | Cheap small-cap value

INTERNATIONAL:
- VXUS: 6.5–8.5% CAGR, vol 16%, ER 0.07% | Total international
- AVDV: 8.0–11.0% CAGR, vol 21%, ER 0.36% | Intl small-cap value
- VEA: 6.0–8.0% CAGR, vol 15%, ER 0.05% | Developed markets only
- VWO: 7.0–10.0% CAGR, vol 22%, ER 0.08% | Emerging markets

REAL ASSETS:
- VNQ: 7.5–9.0% CAGR, vol 18%, ER 0.12% | REITs — non-qualified divs, 401k/IRA only
- GLD: 4.0–6.0% CAGR, vol 15%, ER 0.40% | Inflation hedge
- IBIT: 15.0–30.0% CAGR, vol 65%, ER 0.12% | Bitcoin — extreme risk only

CRITICAL:
- ALL projectedCAGR as PERCENTAGE NUMBERS (4.5 = 4.5%, 10.5 = 10.5%), NEVER 0 or decimals
- Asset percentages in each bucket MUST sum to exactly 100% (cash counts)

═══════════════════════════════════════════════════════
AVAILABLE ASSETS:
${CURATED_ASSETS.map((a: any) => `${a.ticker}: ${a.name} (${a.category})`).join(', ')}

USER PROFILE:
- Goal Type: ${str(responses.primaryGoal)}
- Target Amount: $${str(responses.goalAmount)}
- Timeline: ${str(responses.timeline)} years
- Current Age: ${str(responses.currentAge) || 'Not provided'}
- Target Retirement Age: ${str(responses.retirementAge) || 'Not provided'}
- Annual Income: $${str(responses.annualIncome)} (${str(responses.taxFilingStatus)})
- Starting Capital: $${str(responses.startingAmount)}
- Monthly Expenses: $${str(responses.monthlyExpenses)}
- Monthly Contribution: $${str(responses.monthlyContribution)}
- Income Stability: ${str(responses.employmentStability) || 'Not provided'}
- Major Planned Expense: ${str(responses.majorExpense) || 'None'}${responses.majorExpenseCost ? ` (~$${str(responses.majorExpenseCost)})` : ''}
- Stress/Risk Response: ${str(responses.riskThreshold) || str(responses.downturnBehavior) || 'Not provided'}
- State: California
- Tax-Advantaged Accounts: ${Array.isArray(responses.taxAdvantagedAccounts) ? responses.taxAdvantagedAccounts.join(', ') : 'None'}
- Employer Match: ${str(responses.employerMatch) || '0'}%
- Roth IRA Available: ${str(responses.rothOption) || 'No'}

═══════════════════════════════════════════════════════
BUCKET CONSTRUCTION — DECISION FRAMEWORK
═══════════════════════════════════════════════════════

━━━━ SAFETY BUCKET ━━━━
Size rules — use MOST conservative applicable:
  - "Sell everything" risk response OR income is Variable/Transitioning → 6 months of expenses
  - "Reduce exposure" OR income is Moderate/Freelance → 4–5 months
  - "Hold steady" OR "Invest more" AND Stable/Very Stable income → 3 months
  - Major planned expense in next 5 years → add 1–2 extra months

Cash component (ticker "CASH"): FDIC-insured, day-1 liquidity. Size it based on user's specific stability profile:
  - Variable/Transitioning income OR "Sell everything" risk → CASH = 20%  (maximum liquidity buffer)
  - Moderate/Freelance income OR "Reduce exposure" risk   → CASH = 15%
  - Stable income AND "Hold steady" risk                  → CASH = 12%
  - Very Stable income AND "Invest more" risk             → CASH = 10%  (minimum — confident earner)
  - Has major planned expense within 2 years              → Add +5% to CASH (near-term draw needs)

Safety bucket investable selection — VUSXX IS THE DEFAULT ANCHOR:
  VUSXX = Vanguard Treasury MMF. $1 stable NAV. Zero price risk. CA state-exempt. ~3.7% after-tax. Best after-tax yield for CA.
  SGOV  = Acceptable alternative to VUSXX (ETF format, same T-bill exposure, CA state-exempt). Prefer if user holds at brokerage vs. Vanguard.

  ⚠ DO NOT USE CMF AS PRIMARY — CMF is a ~7-year duration bond ETF. Rates rise 1% → CMF drops ~7%.
    Emergency funds that can lose 7% of value defeat the purpose. This is a critical planning error.

  CMF secondary allocation ONLY if BOTH conditions met:
    - User is in 37%+ federal bracket (income > $500k single / $600k MFJ) AND
    - It is labeled as "near-term reserve" NOT day-1 emergency access
    - Max CMF = 20%; VUSXX must remain ≥60% of investable assets

  DYNAMIC CONSTRUCTION — pick based on user profile above:
    Very Stable income + "Invest more" risk:    VUSXX 90% + CASH 10%
    Stable income + "Hold steady":              VUSXX 88% + CASH 12%
    Moderate/Freelance + "Reduce exposure":     VUSXX 85% + CASH 15%
    Variable/Transitioning + "Sell everything": VUSXX 80% + CASH 20%
    Very high earner (37% bracket, stable):     VUSXX 65% + CMF 20% + CASH 15%
    With major expense < 2 years (any tier):    Shift +5% from VUSXX → CASH

  Use SGOV instead of VUSXX if user's brokerage is not Vanguard (ETF easier to hold at Schwab/Fidelity/etc.)
  NEVER recommend HYSA as primary — always inferior after-tax for CA residents (state taxes the full yield)

CRITICAL — CASH HANDLING:
- Do NOT include "CASH" as an entry in the assets array — cash is handled separately via cash_allocation_pct field
- assets array = investable securities only (VUSXX, CMF, SGOV, etc.)
- assets percentages + cash_allocation_pct MUST sum to exactly 100%
- Example: assets=[{VUSXX: 85%}], cash_allocation_pct=15 → total = 100% ✓
- Do NOT assign a CAGR to cash — it will be shown as "Immediate liquidity" separately

━━━━ GROWTH BUCKET — DYNAMIC SELECTION, CANDIDATE-POOL APPROACH ━━━━

Do NOT hardcode any fixed ticker combination. Select the OPTIMAL 2–4 assets for THIS specific user from the candidate pools below, based on their risk tier, goal, timeline, age, income, employment stability, and tax situation. Make the selection feel personalized, not templated.

GROWTH BUCKET CANDIDATE POOL (taxable account — must be tax-efficient):
  US Broad Market:       VTI (low-cost total market core — most tax-efficient, lowest ER, best default anchor)
                         VOO (S&P 500 core — virtually identical to VTI, use if user prefers S&P 500 focus)
  US Large Growth:       QQQM (NASDAQ-100 growth/tech tilt, minimal dividends — use timeline >10yr, growth goal; Roth preferred)
                         SCHG (large-cap growth, similar to QQQM, lower ER, broader — good alternative)
  US Small-Cap Value:    AVUV (Fama-French SCV premium — high turnover, Roth preferred; taxable OK if no Roth)
                         VBR  (cheap SCV alternative — lower ER than AVUV, less pure factor exposure)
  US Quality Dividend:   SCHD (qualified dividends, quality-screened, lower vol — income goals or moderate risk)
                         VIG  (dividend growth, very tax-efficient, low yield — conservative growth profiles)
                         VYM  (high dividend yield, broader than SCHD — use for income-first goals)
  International Dev:     VXUS (total international, FTC benefit in taxable — add if timeline >7yr for diversification)
                         AVDV (intl small-cap value, higher return potential — deeper factor tilt vs VXUS)
                         VEA  (developed markets only — lower vol than VXUS, no EM exposure)
  CA Muni Bond:          CMF  (fully exempt federal + CA — use for conservative profiles, capital preservation)
  Bonds (taxable-ok):    BND  (only if no 401k and moderate/conservative — otherwise keep bonds in 401k)

SELECTION CRITERIA — reason through each candidate for this specific user:
  1. Core US equity anchor: Use VTI for total market breadth OR VOO for S&P 500 focus
     - VTI preferred: broad diversification, includes small/mid cap premium
     - VOO preferred: goal is matching S&P 500, user is familiar with S&P 500 benchmark
     - Both are equally tax-efficient; do NOT use both simultaneously
  2. International: Add VXUS (or AVDV for deeper factor) if timeline > 7 years
     - VXUS provides FTC in taxable, uncorrelated returns, valuation diversification
     - AVDV: higher expected return via small-cap value factor, higher vol — use if aggressive
     - VEA: alternative for developed-only exposure (exclude EM if user is very conservative)
  3. Factor/style tilt — pick ONE based on user profile:
     - Young (< 40) + aggressive + long timeline → AVUV or VBR (value premium compounds over decades)
     - Maximum growth goal + moderate-aggressive → QQQM or SCHG (growth factor, minimal distributions)
     - Income goal or moderate risk → SCHD (quality dividend) or VIG (dividend growth, lower vol)
     - Conservative or near goal → CMF (tax-exempt, capital preservation) or VIG
  4. DO NOT use AVUV or QQQM in taxable if user has Roth IRA (save best growth assets for tax-free)
  5. DIVERSIFICATION: growth bucket tickers must NOT appear in retirement bucket
  6. Limit to 3–4 tickers — beyond that adds complexity without meaningful risk reduction
  7. NEVER select duplicate tickers within the same bucket or across growth/retirement buckets

STEP 1 — Risk tier percentage ranges (use as guidance, optimize for user):

  ULTRA-AGGRESSIVE (timeline 15+ yrs, "Rebalance to target" or "Invest more"):
    → Heavy factor tilts, maximize international, minimize bonds
    → US core 40–55% + factor tilt 25–35% + international 15–25%

  AGGRESSIVE (timeline 10–15 yrs, or "Hold steady" with 15+ yrs):
    → Single factor tilt, moderate international
    → US core 50–60% + one tilt 15–25% + international 15–20%

  MODERATE-AGGRESSIVE (timeline 7–12 yrs, "Hold steady"):
    → Quality dividend + broad market, reduce high-vol tilts
    → US core 40–50% + SCHD/VIG 20–30% + international 15–20%

  MODERATE (timeline 5–10 yrs, "Reduce exposure"):
    → Dividend anchor + core equity + defensive
    → SCHD/VIG 25–35% + VTI 30–40% + CMF or BND 20–30%

  CONSERVATIVE (timeline < 5 yrs or "Sell everything"):
    → Capital preservation first
    → SCHD 30–40% + CMF/BND 35–45% + VTI 15–20%

STEP 2 — Adjust for GOAL TYPE:
  "Generate Passive Income / Cash Flow": Weight SCHD 40–50%, add VNQ only if in 401k, qualify dividends as primary metric
  "Capital Preservation / Safety": Move one full tier more conservative than risk tier suggests
  "Save for a Major Purchase" with timeline < 5 yrs: Add 20–30% CMF/BND regardless of risk tier; liquidity first
  "Retirement / Financial Independence": Apply glidepath — reduce equity 5% per year in final 5 years before retirement age
  "Maximum Long-Term Growth": Maximize factor tilts, skip income assets, pure accumulation — no glidepath

STEP 3 — Asset placement by account type (CRITICAL — no contradictions):
  If user HAS Roth IRA or 401k:
    → High-turnover/high-growth (AVUV, QQQM, VGT) → Roth IRA ONLY
    → Income-generating (BND, VNQ, SCHP) → 401k ONLY
    → Growth bucket taxable: VTI, VXUS, AVDV, SCHD, VIG, CMF ONLY
    → NEVER put AVUV, QQQM in taxable if Roth is available
  If user has NO tax-advantaged accounts (selected "None of the above" or left blank):
    → ⚠️ RETIREMENT BUCKET MUST BE 0%: Set retirementStrategy.allocation.percent = 0 and retirementStrategy.allocation.assets = []
    → Redistribute all retirement allocation into the GROWTH BUCKET (growth bucket absorbs 100% of investable minus safety)
    → AVUV and QQQM are acceptable in taxable (no Roth available — best option given no shelter)
    → Avoid BND, VNQ entirely in taxable (no 401k to shelter them — too tax-inefficient)
    → Tax-loss harvesting critical — VTI + SCHB make good harvest pairs

STEP 4 — Glidepath if within 7 years of goal:
  6–7 years: Reduce equity 10%, shift to BND/SCHD
  4–5 years: Reduce equity 20%
  < 3 years: Reduce equity 30–40%, heavy BND/SCHP

STEP 5 — Adjust for MAJOR PLANNED EXPENSE (if not "No major purchases planned"):
  Major expense within 5 years: Carve out a separate pool (increase safety bucket by 1.5–2x the expense amount)
  Home purchase planned: Reduce growth equity 10–15%, add CMF/BND as "down payment reserve"
  Note the major expense in strategy rationale and key takeaways

━━━━ RETIREMENT BUCKET — DYNAMIC SELECTION ━━━━
${(!Array.isArray(responses.taxAdvantagedAccounts) || responses.taxAdvantagedAccounts.length === 0 || responses.taxAdvantagedAccounts.every((a: string) => a.toLowerCase().includes('none'))) ? '⛔ STOP — USER HAS NO TAX-ADVANTAGED ACCOUNTS. MANDATORY: retirementStrategy.allocation.percent = 0, retirementStrategy.allocation.assets = []. Do NOT allocate anything to retirement. Increase growth bucket by whatever would have gone here. Skip the rest of this section.\n' : ''}ACCOUNT PRIORITY (always in this order):
  1. 401k up to match (${responses.employerMatch || '0'}% = guaranteed 100% return, highest priority)
  2. HSA if available (triple tax-advantaged)
  3. Roth IRA if eligible (tax-free compounding)
  4. Max 401k beyond match
  5. Taxable overflow

RETIREMENT BUCKET CANDIDATE POOL:
  Roth IRA candidates (HIGHEST growth, HIGHEST tax-cost — tax-free forever):
    QQQM (growth tilt, near-zero distributions — ideal Roth asset)
    AVUV (small-cap value premium, higher turnover — most valuable in Roth)
    VGT (tech sector, high growth potential — aggressive profiles only)
    SCHG (large-cap growth, alternative to QQQM)
    VTI (acceptable if above are already in growth bucket — avoid duplicate)

  401k candidates (TAX-INEFFICIENT income assets — defer ordinary income):
    BND (bond income, fully taxable ordinarily — shelter in 401k)
    VNQ (REIT dividends, ~70% ordinary income — highest benefit from 401k shelter)
    SCHP (TIPS phantom income — avoid taxable at all costs)
    BNDX (international bonds, currency-hedged income)
    SCHD (dividend income, acceptable in 401k for moderate profiles)

  HSA candidates (triple tax-advantaged — invest most aggressively):
    VTI + QQQM (aggressive), VTI + SCHD (moderate)
    Pay medical costs out-of-pocket; let HSA compound for decades

SELECTION RULES:
  1. Roth IRA: NEVER use BND, SCHP, VNQ — these waste tax-free compounding on low-return assets
  2. 401k: NEVER use QQQM or AVUV alone — shelter income-generating assets, not growth assets
  3. DIVERSIFICATION RULE: Choose tickers for retirement bucket that DO NOT appear in growth bucket
     - If VTI is in growth bucket → use QQQM + AVUV in Roth instead of VTI
     - If SCHD is in growth bucket → use BND + VNQ in 401k, not SCHD again
  4. Customize allocations to the user's age and timeline:
     - Under 40 → Roth: 70-80% QQQM + 20-30% AVUV (maximum growth in tax-free)
     - 40-55 → Roth: 50-60% QQQM + 20-30% AVUV + 10-20% VTI (balance growth)
     - Over 55 → Roth: 40% QQQM + 40% VTI + 20% SCHD (reduce concentration)
  5. 401k bond allocation scales with age: under 40 → 20-30% bonds; 40-55 → 30-40%; over 55 → 40-50%

  Taxable overflow → Tax-efficient only (NEVER repeat growth bucket tickers):
    Choose from: AVDV, VIG, or a tax-efficient asset not already in growth bucket
    → CMF instead of bonds (already tax-exempt, no need for 401k shelter)

CRITICAL: The retirement bucket MUST contain at least 2–3 different assets across the sub-accounts.
NEVER allocate 100% to a single asset. Show the breakdown per account type in the assets array.
Each asset entry should note which account it belongs to in its rationale.

ROTH vs TRADITIONAL for this user:
  Income > $100k in CA: Traditional 401k preferred (reduce high current marginal rate)
  Income < $60k: Roth preferred (lock in low rate, tax-free growth)
  Has employer match: ALWAYS take match first (100% guaranteed return)

PROXIMITY TO GOAL glidepath:
  < 3 years: 70–80% stable/bonds, 20–30% equity
  3–7 years: 50–60% equity, 40–50% bonds
  7–15 years: 80% equity, 20% bonds
  > 15 years: 90–100% equity, bonds as stabilizer only

═══════════════════════════════════════════════════════
QUALITY REQUIREMENTS
═══════════════════════════════════════════════════════

ASSET RATIONALE: 3–4 sentences per asset:
1. What it is and expense ratio
2. Why it fits THIS user's specific risk tolerance, timeline, goal type, and drawdown tolerance
3. Why it beats alternatives for this user (reference specific rejected alternatives)
4. Sharpe ratio contribution and after-tax advantage

KEY TAKEAWAYS: EXACTLY 4 — most impactful insights referencing specific dollar amounts, tickers, tax savings. No generic advice.

ACTION CHECKLIST: 8–12 HIGHLY SPECIFIC steps in priority order. Each step must name specific tickers, dollar amounts, and account types from this user's profile. NEVER generic advice.

FORWARD-LOOKING: ALL CAGR/volatility are 2026 CMA estimates from Vanguard/BlackRock/JPM/Schwab. NOT historical performance.

TASK: Return JSON matching schema exactly. Every number realistic and non-zero. Be SPECIFIC to this user's profile — no generic defaults.`;
}

function buildTaxEnrichmentPrompt(plan: GeminiPlanResponse, responses: GeminiResponses): string {
  const str = (v: unknown): string => (v == null ? '' : String(v));
  const hasRoth = responses.rothOption === 'Yes' || (Array.isArray(responses.taxAdvantagedAccounts) && responses.taxAdvantagedAccounts.some((a: string) => a.toLowerCase().includes('roth')));
  const has401k = Array.isArray(responses.taxAdvantagedAccounts) && responses.taxAdvantagedAccounts.some((a: string) => a.toLowerCase().includes('401'));
  const hasHSA = Array.isArray(responses.taxAdvantagedAccounts) && responses.taxAdvantagedAccounts.some((a: string) => a.toLowerCase().includes('hsa'));
  const hasAnyRetirement = hasRoth || has401k || hasHSA;

  return `You are an expert CFA charterholder and CA tax attorney. Generate a comprehensive tax optimization analysis for this investor.

USER PROFILE:
- Income: $${str(responses.annualIncome)} (${str(responses.taxFilingStatus)})
- State: California
- Timeline: ${str(responses.timeline)} years
- Tax-Advantaged Accounts: ${Array.isArray(responses.taxAdvantagedAccounts) ? responses.taxAdvantagedAccounts.join(', ') : 'None'}
- Employer Match: ${str(responses.employerMatch) || '0'}%
- Has Roth: ${hasRoth}
- Has 401k: ${has401k}
- Has HSA: ${hasHSA}

ALLOCATED ASSETS (from core plan):
- Safety: ${JSON.stringify(plan.shortTermStrategy?.assets?.map((a: BucketAsset) => a.ticker) || [])}
- Growth: ${JSON.stringify(plan.longTermStrategy?.assets?.map((a: BucketAsset) => a.ticker) || [])}
- Retirement: ${JSON.stringify(plan.retirementStrategy?.allocation?.assets?.map((a: BucketAsset) => a.ticker) || [])}

GENERATE THE FOLLOWING (return as JSON matching the taxAlphaData schema):

1. totalAlphaPct: Calculate the EXACT annualized tax-alpha of this plan vs the BENCHMARK PORTFOLIO.

   BENCHMARK PORTFOLIO (the comparison point — a naive investor with no tax strategy):
     60% VOO in taxable brokerage: 1.20% dividend yield, ~100% qualified dividends
     40% BND in taxable brokerage: 3.80% yield, 100% fully taxable ordinary income

   STEP 1 — Calculate benchmark annual after-tax income yield using this user's EXACT brackets:
     VOO component:  0.60 × 1.20% × (1 - federalQDRate - caMarginal)
     BND component:  0.40 × 3.80% × (1 - federalMarginal - caMarginal)
     Benchmark total = sum of both components

   STEP 2 — Calculate this plan's after-tax income yield for EACH actual asset at its correct location:
     For each asset in the plan, compute: allocationPct × yield × (1 - applicable_tax_rate)
     Apply the correct tax treatment per asset and location:
     - VUSXX/SGOV/USFR in taxable: yield × (1 - federalMarginal)           [CA exempt]
     - CMF in taxable: yield × 1.0                                           [fully exempt]
     - BND/VNQ in 401k: yield × 0 for current-year drag                     [deferred = no annual drag]
     - QQQM/AVUV in Roth: expectedReturn × 0 for ongoing tax drag            [forever tax-free]
     - VTI/VXUS/SCHD in taxable: yield × (1 - federalQDRate - caMarginal)   [qualified dividends]
     - Roth compounding shield: add (allocationPct × expectedReturn × marginalRate × horizonFactor)
       horizonFactor = 0.25 for 20-30yr, 0.15 for 10-20yr, 0.08 for <10yr

   STEP 3 — Tax Alpha = Plan after-tax yield − Benchmark after-tax yield
     Express as decimal percentage (e.g. 0.65 = 0.65% alpha). Can range from 0.1% to 1.5%+.
     Must be specific to THIS user's brackets, allocations, and account types.

   ${!hasAnyRetirement ? '⚠️ USER HAS NO RETIREMENT ACCOUNTS: Skip Roth compounding (Source C) and bond shelter (Source A). Alpha comes only from CA-exempt cash (VUSXX/SGOV), muni TEY (CMF), and VXUS FTC. Expected alpha range: 0.05%–0.35%.' : ''}

2. explanation: 2-3 sentences explaining specifically how THIS plan beats the 60% VOO / 40% BND taxable benchmark, quantifying the key sources of advantage for this user's bracket and account types.

3. assetPlacementMatrix: For each account the user HAS (always include Taxable Brokerage; add Roth IRA if hasRoth=${hasRoth}; add 401k if has401k=${has401k}; add HSA if hasHSA=${hasHSA}):
   - accountType, accentColor (emerald=taxable, blue=roth, purple=401k, amber=HSA)
   - assets: list with concise reason each
   - strategy: 1-2 sentence account strategy
   ${!hasAnyRetirement ? '⚠️ USER HAS NO RETIREMENT ACCOUNTS: Include ONLY Taxable Brokerage in the matrix. Do NOT include Roth IRA, 401k, or HSA columns. The strategy note should explain that without tax-advantaged accounts, tax efficiency must come entirely from asset selection and CA-exempt instruments.' : ''}
   CRITICAL CONSISTENCY RULES:
   - Taxable Brokerage MUST contain ALL assets from the Growth Bucket: ${JSON.stringify(plan.longTermStrategy?.assets?.map((a: BucketAsset) => a.ticker) || [])}
   - Taxable Brokerage also contains Safety Bucket assets: ${JSON.stringify(plan.shortTermStrategy?.assets?.map((a: BucketAsset) => a.ticker) || [])}
   ${hasAnyRetirement ? `- Roth IRA and 401k contain Retirement Bucket assets only: ${JSON.stringify(plan.retirementStrategy?.allocation?.assets?.map((a: BucketAsset) => a.ticker) || [])}` : '- No retirement bucket assets exist — all assets are in taxable brokerage'}
   - NEVER place a growth bucket ticker in Roth/401k column — it contradicts the bucket structure

4. caAfterTaxYields: Table of the TOP 10 assets ranked by HIGHEST after-tax yield for this user's specific bracket.
   Include EXACTLY these 10 assets, ordered from highest to lowest after-tax yield:
   VUSXX, SGOV, USFR, CMF, MUB, HYSA, SCHD, BND, VNQ, VXUS
   For each: ticker, nominalYield (use these EXACT March 2026 verified yields), afterTaxYield, taxTreatment, recommendation
   VERIFIED March 2026 nominal yields (do not deviate by more than 0.2%):
   - VUSXX: 4.05% (7-day SEC yield, CA state-exempt Treasury money market)
   - SGOV:  4.05% (30-day SEC yield, CA state-exempt short-term T-bills, ETF format)
   - USFR:  4.00% (7-day SEC yield, WisdomTree floating rate Treasury, CA state-exempt)
   - CMF:   2.97% (30-day SEC yield, fully federal+CA exempt iShares CA muni)
   - MUB:   3.20% (30-day SEC yield, iShares national muni, federal exempt — CA still taxes)
   - HYSA:  4.10% (top competitive HYSA rate, fully taxable ordinary income)
   - SCHD:  3.42% (forward yield, ~100% qualified dividends, Schwab Dividend ETF)
   - BND:   3.80% (30-day SEC yield, fully taxable ordinary income, Vanguard Total Bond)
   - VNQ:   3.75% (dividend yield, ~70% ordinary non-qualified REIT income)
   - VXUS:  3.00% (dividend yield, ~75% qualified + foreign tax credit in taxable)
   CRITICAL after-tax calculation rules — CA taxes ALL income at ordinary rates regardless of federal treatment:
   - ORDINARY INCOME assets (HYSA, BND, VNQ): afterTax = nominal × (1 - federalMarginal - caMarginal)
   - QUALIFIED DIVIDEND assets (SCHD, VXUS): afterTax = nominal × (1 - federalQDRate - caMarginal)
     where federalQDRate = 0% if income <$47,025 single/$94,050 MFJ | 15% if $47,025–$518,900 single | 20% above
     CA does NOT recognize qualified dividend rates — always use CA ordinary marginal rate
   - CA-STATE-EXEMPT (VUSXX, SGOV, USFR — US Treasury interest): afterTax = nominal × (1 - federalMarginal)
   - FULLY EXEMPT federal+CA (CMF only — CA muni): afterTax = nominal (no reduction at any bracket)
   - MUB: federal-exempt but CA still taxes as ordinary: afterTax = nominal × (1 - caMarginal)
   - VXUS: add ~0.10% foreign tax credit benefit if held in taxable brokerage (not IRA/401k)
   Order the output array from HIGHEST afterTaxYield to LOWEST after computing all values.

5. rothVs401k:
   ${!hasAnyRetirement ? '⚠️ USER HAS NO TAX-ADVANTAGED ACCOUNTS: Set recommendation = "roth_first" (educational — they should open one). For all 8 comparisonRows, populate both columns normally (educational value) but set reasoning to explain they currently have no accounts and should consider opening a Roth IRA as first step. Set actionPlan to steps for opening their first tax-advantaged account.' : ''}
   - recommendation: "both" | "roth_first" | "401k_first"
   - comparisonRows: array of {factor, roth, traditional401k} — field name MUST be "traditional401k" (not "traditional"). Include ALL 8 factors with COMPLETE non-empty values for BOTH roth and traditional401k columns:
     * "Tax Treatment" — roth: "Post-tax contributions, tax-free growth and withdrawals" | traditional401k: "Pre-tax contributions, taxable withdrawals at ordinary income rate"
     * "2026 Contribution Limit" — roth: "$7,000 ($8,000 if 50+)" | traditional401k: "$23,500 ($31,000 if 50+)"
     * "Required Minimum Distributions" — roth: "None during lifetime" | traditional401k: "Required starting at age 73"
     * "Early Withdrawal Rules" — roth: "Contributions anytime penalty-free; earnings at 59½" | traditional401k: "10% penalty + taxes before 59½ (exceptions apply)"
     * "CA State Treatment" — roth: "CA conforms to federal — tax-free in retirement" | traditional401k: "CA taxes 401k distributions as ordinary income"
     * "Best Assets to Hold" — roth: "Highest-growth assets (QQQM, AVUV) — tax-free compounding" | traditional401k: "Tax-inefficient assets (BND, VNQ) — defer ordinary income"
     * "Income Limits" — roth: "Phases out $150k–$165k (single), $236k–$246k (married) for 2025/2026" | traditional401k: "No income limit to contribute; deductibility phases out $79k–$89k (single with workplace plan)"
     * "Employer Match Eligibility" — roth: "Yes via Roth 401k (if offered); Roth IRA is separate" | traditional401k: "Yes — always capture full employer match first (free money)"
   Customize the "Best Assets to Hold" row to match the actual tickers in this user's plan.
   - reasoning: 3-4 sentences specific to this user's income, bracket, CA situation
   - actionPlan: specific dollar amounts and order of operations for this user

6. taxProfile: Calculate precisely using 2026 official tax brackets:
   2026 FEDERAL BRACKETS — Single:
     10%: $0–$11,925 | 12%: $11,925–$48,475 | 22%: $48,475–$103,350
     24%: $103,350–$197,300 | 32%: $197,300–$250,525 | 35%: $250,525–$626,350 | 37%: $626,350+
   2026 FEDERAL BRACKETS — Married Filing Jointly:
     10%: $0–$23,850 | 12%: $23,850–$96,950 | 22%: $96,950–$206,700
     24%: $206,700–$394,600 | 32%: $394,600–$501,050 | 35%: $501,050–$751,600 | 37%: $751,600+
   2026 QUALIFIED DIVIDEND RATES — Single: 0% under $47,025 | 15%: $47,025–$518,900 | 20%: above
   2026 CA BRACKETS (same for single and MFJ, adjusted):
     1%: $0–$10,756 | 2%: $10,756–$25,499 | 4%: $25,499–$40,245 | 6%: $40,245–$55,866
     8%: $55,866–$70,606 | 9.3%: $70,606–$360,659 | 10.3%: $360,659–$432,787
     11.3%: $432,787–$721,314 | 12.3%: $721,314–$1,000,000 | 13.3%: $1,000,000+
   CA SDI: 1.1% on all wages (no cap as of 2024+)
   Return:
   - marginalFederal: exact federal marginal rate for this income/filing status
   - marginalCA: exact CA marginal rate for this income
   - federalQDRate: qualified dividend rate (0%, 15%, or 20%)
   - effectiveRate: estimated COMBINED effective rate (calculate actual tax / gross income)
   - estimatedFederalTax: calculated federal income tax using bracket math
   - estimatedCATax: calculated CA income tax using bracket math
   - estimatedAnnualTax: estimatedFederalTax + estimatedCATax (show both components)
   - standardDeduction2026: $15,000 single / $30,000 MFJ (federal) | $5,540 single / $11,080 MFJ (CA)
   - taxableIncome: annualIncome minus standard deduction (use standard deduction unless user specified itemizing)
   - analysis: 2-3 sentences citing their exact bracket, effective rate, and the #1 tax opportunity for them specifically

7. locationReasoningNarrative: 3 paragraphs:
   1. Why specific asset locations maximize after-tax wealth for this user
   2. CA-specific advantages vs naive approach (quantify the difference)
   3. Roth vs 401k decision rationale for this user's income/timeline

8. paycheckWaterfall: Array of steps in priority order for how this user should allocate each paycheck:
   Each step: { priority: number, label: string, amount: string, reason: string, accountType: string }
   Examples: "Max HSA ($4,300/yr)", "401k to match ($X/mo)", "Roth IRA ($7,000/yr)", "Max 401k ($X remaining)", "Taxable VTI/SCHD"

Return ONLY valid JSON with a top-level "taxAlphaData" key containing all the above fields.`;
}

function buildReportPrompt(plan: GeminiPlanResponse, responses: GeminiResponses): string {
  const str = (v: unknown): string => (v == null ? '' : String(v));
  return `You are a Senior Institutional Portfolio Manager. Generate a concise, high-impact Investment Strategy Report.

CRITICAL: Use the GOOGLE SEARCH tool to verify the latest "2026 Capital Market Assumptions" from Vanguard, BlackRock, J.P. Morgan, and Schwab.

PLAN DATA:
${JSON.stringify({ summary: plan.summary, shortTerm: plan.shortTermStrategy, longTerm: plan.longTermStrategy, retirement: plan.retirementStrategy }, null, 2)}

USER CONTEXT:
- Primary Goal: ${str(responses.primaryGoal)}
- Target: $${str(responses.goalAmount)}
- Timeline: ${str(responses.timeline)}y
- Age: ${str(responses.currentAge) || 'N/A'} (retire at ${str(responses.retirementAge) || 'N/A'})
- Risk Response: ${str(responses.riskThreshold) || str(responses.downturnBehavior) || 'N/A'}
- Income Stability: ${str(responses.employmentStability) || 'N/A'}
- Major Planned Expense: ${str(responses.majorExpense) || 'None'}
- Income: $${str(responses.annualIncome)} (${str(responses.taxFilingStatus)})

REPORT REQUIREMENTS:
1. START DIRECTLY with "## Executive Summary"
2. Explain the 3-bucket allocation in depth for this specific user
3. Detail tax optimization strategy and account placement
4. Safety bucket analysis vs HYSA
5. Conclusion

FORMAT: Markdown. Professional, data-driven.`;
}

// Box-Muller transform — produces a standard normal N(0,1) sample
function boxMuller(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 1,000-path Monte Carlo simulation
// Uses log-normal monthly returns: ln(1+r_month) ~ N(μ - σ²/2, σ)
function runMonteCarlo(
  startingAmount: number,
  monthlyContrib: number,
  annualReturn: number,   // decimal e.g. 0.07
  annualVolatility: number, // decimal e.g. 0.15
  years: number,
  goalAmount: number,
  paths = 1000
): { successProbability: number; p10: number; p50: number; p90: number } {
  const months = Math.round(years * 12);
  const μM = annualReturn / 12;
  const σM = annualVolatility / Math.sqrt(12);
  const drift = μM - (σM * σM) / 2; // log-normal drift correction

  const finals: number[] = new Array(paths);
  for (let i = 0; i < paths; i++) {
    let pv = startingAmount;
    for (let m = 0; m < months; m++) {
      const shock = drift + σM * boxMuller();
      pv = pv * Math.exp(shock) + monthlyContrib;
    }
    finals[i] = pv;
  }

  finals.sort((a, b) => a - b);
  const successCount = finals.filter(v => v >= goalAmount).length;
  return {
    successProbability: successCount / paths,
    p10: finals[Math.floor(paths * 0.10)],
    p50: finals[Math.floor(paths * 0.50)],
    p90: finals[Math.floor(paths * 0.90)],
  };
}

function enrichWithProjections(parsed: GeminiPlanResponse, responses: GeminiResponses) {
  const stripCommas = (v: unknown) => Number(String(v || '0').replace(/,/g, '')) || 0;
  const n = Number(responses.timeline) || 10;
  const monthlyContrib = stripCommas(responses.monthlyContribution);
  const goalAmount     = stripCommas(responses.goalAmount) || 1000000;
  const startingAmount = stripCommas(responses.startingAmount);

  const r = parsed.marketGroundedRates;
  const s = parsed.summary?.bucketSizes;

  if (r?.shortTerm?.rate == null || r?.longTerm?.rate == null || r?.retirement?.rate == null) {
    throw new Error('enrichWithProjections: LLM response missing marketGroundedRates rates');
  }
  if (r?.shortTerm?.volatility == null || r?.longTerm?.volatility == null || r?.retirement?.volatility == null) {
    throw new Error('enrichWithProjections: LLM response missing marketGroundedRates volatility');
  }
  if (!s?.shortTerm || !s?.longTerm || !s?.retirement) {
    throw new Error('enrichWithProjections: LLM response missing summary.bucketSizes');
  }

  // rates come back as percentage numbers (e.g. 9.5 = 9.5%), convert to decimal
  const toDecimal = (v: number) => (v > 1 ? v / 100 : v);

  // Deterministic compound math per bucket (for projected outcome display)
  const calc = (initial: number, rate: number, monthly: number, years: number) => {
    const rDec = toDecimal(rate);
    const months = years * 12;
    const rM = rDec / 12;
    if (rM === 0) return initial + monthly * months;
    const gf = Math.pow(1 + rM, months);
    return initial * gf + monthly * ((gf - 1) / rM) * (1 + rM);
  };

  const p1 = s.shortTerm.percent / 100, p2 = s.longTerm.percent / 100, p3 = s.retirement.percent / 100;
  const f1 = calc(s.shortTerm.dollar,  r.shortTerm.rate,  monthlyContrib * p1, n);
  const f2 = calc(s.longTerm.dollar,   r.longTerm.rate,   monthlyContrib * p2, n);
  const f3 = calc(s.retirement.dollar, r.retirement.rate, monthlyContrib * p3, n);
  const totalOutcome = Math.round(f1 + f2 + f3);

  // Portfolio blended return and volatility (weighted average)
  const blendedReturn = p1 * toDecimal(r.shortTerm.rate) + p2 * toDecimal(r.longTerm.rate) + p3 * toDecimal(r.retirement.rate);
  const vol1 = toDecimal(r.shortTerm.volatility);
  const vol2 = toDecimal(r.longTerm.volatility);
  const vol3 = toDecimal(r.retirement.volatility);
  const blendedVol = Math.sqrt(
    Math.pow(p1 * vol1, 2) + Math.pow(p2 * vol2, 2) + Math.pow(p3 * vol3, 2)
  );

  // Run 1,000-path Monte Carlo on the blended portfolio
  const mc = runMonteCarlo(
    startingAmount,
    monthlyContrib,
    blendedReturn,
    blendedVol,
    n,
    goalAmount,
    1000
  );

  parsed.summary.projectedOutcome = totalOutcome;
  parsed.summary.successProbability = mc.successProbability;
  parsed.summary.monteCarlo = {
    paths: 1000,
    p10: Math.round(mc.p10),
    p50: Math.round(mc.p50),
    p90: Math.round(mc.p90),
    successProbability: mc.successProbability,
  };
  return { ...parsed, sources: [] };
}

// ─── JSON Schema for tax enrichment ──────────────────────────────────────────
function getTaxEnrichmentSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      taxAlphaData: {
        type: Type.OBJECT,
        properties: {
          totalAlphaPct:  { type: Type.NUMBER },
          explanation:    { type: Type.STRING },
          assetPlacementMatrix: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                accountType:  { type: Type.STRING },
                accentColor:  { type: Type.STRING },
                assets: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { ticker: { type: Type.STRING }, reason: { type: Type.STRING } }, required: ['ticker','reason'] } },
                strategy:     { type: Type.STRING },
              },
              required: ['accountType','accentColor','assets','strategy'],
            },
          },
          caAfterTaxYields: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                ticker:         { type: Type.STRING },
                nominalYield:   { type: Type.NUMBER },
                afterTaxYield:  { type: Type.NUMBER },
                taxTreatment:   { type: Type.STRING },
                recommendation: { type: Type.STRING },
              },
              required: ['ticker','nominalYield','afterTaxYield','taxTreatment','recommendation'],
            },
          },
          rothVs401k: {
            type: Type.OBJECT,
            properties: {
              recommendation:  { type: Type.STRING },
              comparisonRows: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { factor: { type: Type.STRING }, roth: { type: Type.STRING }, traditional401k: { type: Type.STRING } }, required: ['factor','roth','traditional401k'] } },
              reasoning:      { type: Type.STRING },
              actionPlan:     { type: Type.STRING },
            },
            required: ['recommendation','comparisonRows','reasoning','actionPlan'],
          },
          taxProfile: {
            type: Type.OBJECT,
            properties: {
              marginalFederal:     { type: Type.NUMBER },
              marginalCA:          { type: Type.NUMBER },
              effectiveRate:       { type: Type.NUMBER },
              estimatedAnnualTax:  { type: Type.NUMBER },
              analysis:            { type: Type.STRING },
            },
            required: ['marginalFederal','marginalCA','effectiveRate','estimatedAnnualTax','analysis'],
          },
          locationReasoningNarrative: { type: Type.STRING },
          paycheckWaterfall: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                priority:    { type: Type.NUMBER },
                label:       { type: Type.STRING },
                amount:      { type: Type.STRING },
                reason:      { type: Type.STRING },
                accountType: { type: Type.STRING },
              },
              required: ['priority','label','amount','reason','accountType'],
            },
          },
        },
        required: ['totalAlphaPct','explanation','assetPlacementMatrix','caAfterTaxYields','rothVs401k','taxProfile','locationReasoningNarrative','paycheckWaterfall'],
      },
    },
  };
}

// ─── JSON Schema for plan ────────────────────────────────────────────────────
function getPlanSchema() {
  const bucketAsset = {
    type: Type.OBJECT,
    properties: {
      name:               { type: Type.STRING },
      ticker:             { type: Type.STRING },
      percentage:         { type: Type.NUMBER },
      rationale:          { type: Type.STRING },
      projectedCAGR:      { type: Type.NUMBER },
      projectedVolatility:{ type: Type.NUMBER },
    },
    required: ['name','ticker','percentage','rationale','projectedCAGR','projectedVolatility'],
  };

  const bucketStrategy = {
    type: Type.OBJECT,
    properties: {
      name:                  { type: Type.STRING },
      allocationPercent:     { type: Type.NUMBER },
      estimatedDollarAmount: { type: Type.NUMBER },
      assets:                { type: Type.ARRAY, items: bucketAsset },
      explanation:           { type: Type.STRING },
    },
    required: ['name','allocationPercent','estimatedDollarAmount','assets','explanation'],
  };

  const hysaComparison = {
    type: Type.OBJECT,
    properties: {
      hysa_gross_rate:          { type: Type.NUMBER },
      hysa_after_tax_rate:      { type: Type.NUMBER },
      recommended_asset_rate:   { type: Type.NUMBER },
      recommended_asset_name:   { type: Type.STRING },
      advantage_basis_points:   { type: Type.NUMBER },
      rationale:                { type: Type.STRING },
    },
    required: ['hysa_gross_rate','hysa_after_tax_rate','recommended_asset_rate','recommended_asset_name','advantage_basis_points','rationale'],
  };

  const safetyBucketStrategy = {
    type: Type.OBJECT,
    properties: {
      name:                  { type: Type.STRING },
      allocationPercent:     { type: Type.NUMBER },
      estimatedDollarAmount: { type: Type.NUMBER },
      assets:                { type: Type.ARRAY, items: bucketAsset },
      explanation:           { type: Type.STRING },
      cash_allocation_pct:   { type: Type.NUMBER },
      cash_rationale:        { type: Type.STRING },
      hysa_comparison:       hysaComparison,
    },
    required: ['name','allocationPercent','estimatedDollarAmount','assets','explanation','cash_allocation_pct','cash_rationale','hysa_comparison'],
  };

  return {
    type: Type.OBJECT,
    properties: {
      summary: {
        type: Type.OBJECT,
        properties: {
          bucketSizes: {
            type: Type.OBJECT,
            properties: {
              shortTerm:  { type: Type.OBJECT, properties: { percent: { type: Type.NUMBER }, dollar: { type: Type.NUMBER } }, required: ['percent','dollar'] },
              longTerm:   { type: Type.OBJECT, properties: { percent: { type: Type.NUMBER }, dollar: { type: Type.NUMBER } }, required: ['percent','dollar'] },
              retirement: { type: Type.OBJECT, properties: { percent: { type: Type.NUMBER }, dollar: { type: Type.NUMBER } }, required: ['percent','dollar'] },
            },
            required: ['shortTerm','longTerm','retirement'],
          },
          keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: 4, maxItems: 4 },
        },
        required: ['bucketSizes','keyTakeaways'],
      },
      marketGroundedRates: {
        type: Type.OBJECT,
        properties: {
          shortTerm:  { type: Type.OBJECT, properties: { rate: { type: Type.NUMBER }, volatility: { type: Type.NUMBER } }, required: ['rate','volatility'] },
          longTerm:   { type: Type.OBJECT, properties: { rate: { type: Type.NUMBER }, volatility: { type: Type.NUMBER } }, required: ['rate','volatility'] },
          retirement: { type: Type.OBJECT, properties: { rate: { type: Type.NUMBER }, volatility: { type: Type.NUMBER } }, required: ['rate','volatility'] },
        },
        required: ['shortTerm','longTerm','retirement'],
      },
      shortTermStrategy:  safetyBucketStrategy,
      longTermStrategy:   bucketStrategy,
      retirementStrategy: {
        type: Type.OBJECT,
        properties: {
          allocation: bucketStrategy,
          assetLocationGuidance: { type: Type.STRING },
        },
        required: ['allocation','assetLocationGuidance'],
      },
      taxLocationOptimizer: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            accountType: { type: Type.STRING },
            assets:      { type: Type.ARRAY, items: { type: Type.STRING } },
            percentage:  { type: Type.NUMBER },
            reasoning:   { type: Type.STRING },
          },
          required: ['accountType','assets','percentage','reasoning'],
        },
      },
      paycheckWaterfall: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            rank:        { type: Type.NUMBER },
            name:        { type: Type.STRING },
            percentage:  { type: Type.NUMBER },
            description: { type: Type.STRING },
            reasoning:   { type: Type.STRING },
          },
          required: ['rank','name','percentage','description','reasoning'],
        },
      },
      riskProfile: {
        type: Type.OBJECT,
        properties: {
          summary:   { type: Type.STRING },
          capacity:  { type: Type.STRING },
          tolerance: { type: Type.STRING },
          horizon:   { type: Type.STRING },
        },
        required: ['summary','capacity','tolerance','horizon'],
      },
      actionChecklist: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            step:     { type: Type.STRING },
            action:   { type: Type.STRING },
            details:  { type: Type.STRING },
            priority: { type: Type.STRING },
          },
          required: ['step','action','details','priority'],
        },
      },
      assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['summary','marketGroundedRates','shortTermStrategy','longTermStrategy','retirementStrategy','taxLocationOptimizer','paycheckWaterfall','riskProfile','actionChecklist','assumptions'],
  };
}
