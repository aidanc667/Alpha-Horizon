import { NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { getCurrentDate, buildSessionBlock, buildMarketStance, getDbCache, setDbCache } from '../_lib';
import type { HandlerCtx } from '../_lib';

// Cache TTL: 24 hours — picks are strategic, not tactical; same inputs → same output
const BEST_ASSETS_TTL_MS = 24 * 60 * 60 * 1000;
const BEST_STRATEGY_TTL_MS = 24 * 60 * 60 * 1000;
const cacheKey = (prefix: string, riskProfile: string, timeHorizon: string) =>
  `${prefix}_${riskProfile.toLowerCase().replace(/\s+/g, '_')}_${timeHorizon.toLowerCase().replace(/\s+/g, '_')}_v1`;

export async function handleBestAssets(ctx: HandlerCtx): Promise<NextResponse> {
  const { body, ai, model } = ctx;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { riskProfile, timeHorizon, nearTermContext, liveContext, sessionCtx } = body as Record<string, any>;

  // Cache by risk+horizon — strategic picks should be stable for 24h
  const key = cacheKey('best_assets', riskProfile ?? 'moderate', timeHorizon ?? '1y');
  const cached = await getDbCache(key, BEST_ASSETS_TTL_MS);
  if (cached) return NextResponse.json({ success: true, data: cached, fromCache: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contextStr = nearTermContext ? `
Current Regime: ${nearTermContext.marketSnapshot?.regime} | Sentiment: ${nearTermContext.marketSnapshot?.sentiment}
Macro Pillars: ${(nearTermContext.macroPillars || []).map((p: any) => `${p.name}=${p.value}(${p.direction})`).join(', ')}
Live Headlines: ${(liveContext?.newsHeadlines || []).slice(0, 5).map((h: any) => h.headline).join(' | ')}
` : `Today is ${getCurrentDate()}. Use Google Search for current macro conditions.`;

  const prompt = `
You are a Managing Director-level equity strategist at a top-tier global asset management firm (think BlackRock, Bridgewater, or Baupost). You are in the top 0.1% of investment professionals globally. Today is ${getCurrentDate()}.

MARKET CONTEXT (use as macro anchor):
${contextStr}
${buildMarketStance(nearTermContext)}
${buildSessionBlock(sessionCtx)}

━━━ YOUR MANDATE ━━━
Identify the TOP 8 highest-conviction INDIVIDUAL STOCKS for a ${riskProfile} investor with a ${timeHorizon} time horizon.

CRITICAL RULES:
- Individual stocks ONLY. Every pick must be a single-company stock (e.g. NVDA, MSFT, JPM). No ETFs, no funds — the response is invalid if any ETF is included.
- FORWARD-LOOKING ONLY. Base conviction on: (1) forward earnings estimates and revision momentum, (2) free cash flow yield vs. current rates, (3) structural secular tailwinds, (4) balance sheet positioning for the current rate environment. Do NOT cite past 1-year or 3-year returns as a reason to own — that is hindsight bias.
- STABILITY: This list represents your highest-conviction strategic views. It should be virtually identical if run again tomorrow with the same macro context. Do NOT let minor daily market fluctuations change your core picks.
- SECTOR DIVERSIFICATION: Maximum 2 picks from any single sector. Cover at least 4 distinct GICS sectors.
- MACRO ALIGNMENT: Every pick must have an explicit, specific connection to the current macro regime stated above.

USE GOOGLE SEARCH to verify:
1. Current forward P/E and EPS estimate revision trend for each candidate
2. Recent earnings quality (beat rate, guidance trajectory)
3. Any material negative catalysts in the last 30 days (SEC filings, litigation, credit events)

For each of the 8 stocks:
- rank (1–8, 1 = highest conviction)
- ticker
- name (full company name)
- category (sector/sub-sector, e.g. "Semiconductors", "Money Center Banks")
- suggestedWeight (%, must sum to exactly 100)
- forwardReturn (forward expected annualized return estimate, e.g. "11–15%", based on FCF yield + growth + multiple expansion/compression)
- rationale (3 sentences: (1) why this company wins in the CURRENT macro environment, (2) forward earnings/FCF catalyst, (3) key risk to this thesis)
- risk ("Low", "Medium", or "High")
- expenseRatio ("N/A" for individual stocks)

Also provide:
- regime: 1-sentence description of the current macro regime
- generatedAt: today's date
- macroAlignment: 3 sentences explaining the portfolio's collective forward-looking thesis and how it is positioned for the next 12 months, not the last 12 months

WEIGHTS must sum to exactly 100.
`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0,
      tools: [{ googleSearch: {} }],
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          regime: { type: Type.STRING },
          generatedAt: { type: Type.STRING },
          macroAlignment: { type: Type.STRING },
          assets: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                rank: { type: Type.NUMBER },
                ticker: { type: Type.STRING },
                name: { type: Type.STRING },
                category: { type: Type.STRING },
                suggestedWeight: { type: Type.NUMBER },
                forwardReturn: { type: Type.STRING },
                rationale: { type: Type.STRING },
                risk: { type: Type.STRING, enum: ['Low', 'Medium', 'High'] },
                expenseRatio: { type: Type.STRING },
              },
              required: ['rank', 'ticker', 'name', 'category', 'suggestedWeight', 'forwardReturn', 'rationale', 'risk', 'expenseRatio'],
            },
          },
        },
        required: ['regime', 'generatedAt', 'macroAlignment', 'assets'],
      },
    },
  });

  let result;
  try {
    result = JSON.parse(response.text || '{}');
  } catch {
    return NextResponse.json({ error: 'AI returned invalid JSON. Please try again.' }, { status: 500 });
  }
  if (!result.assets?.length) {
    return NextResponse.json({ error: 'AI did not return valid stock picks. Please try again.' }, { status: 500 });
  }
  await setDbCache(key, result);
  return NextResponse.json({ success: true, data: result });
}

export async function handleBestStrategy(ctx: HandlerCtx): Promise<NextResponse> {
  const { body, ai, model } = ctx;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { riskProfile, timeHorizon, nearTermContext, liveContext, sessionCtx } = body as Record<string, any>;

  // Cache by risk+horizon — strategic allocations should be stable for 24h
  const key = cacheKey('best_strategy', riskProfile ?? 'moderate', timeHorizon ?? '1y');
  const cached = await getDbCache(key, BEST_STRATEGY_TTL_MS);
  if (cached) return NextResponse.json({ success: true, data: cached, fromCache: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contextStr = nearTermContext ? `
Current Regime: ${nearTermContext.marketSnapshot?.regime} | Sentiment: ${nearTermContext.marketSnapshot?.sentiment}
Macro Pillars: ${(nearTermContext.macroPillars || []).map((p: any) => `${p.name}=${p.value}(${p.direction})`).join(', ')}
Live Headlines: ${(liveContext?.newsHeadlines || []).slice(0, 5).map((h: any) => h.headline).join(' | ')}
` : `Today is ${getCurrentDate()}. Use Google Search for current macro conditions.`;

  const prompt = `
You are a Chief Investment Officer at a $50B+ institutional asset manager — the top 0.1% of portfolio construction professionals globally. Today is ${getCurrentDate()}.

MARKET CONTEXT (use as macro anchor for positioning):
${contextStr}
${buildMarketStance(nearTermContext)}
${buildSessionBlock(sessionCtx)}

━━━ YOUR MANDATE ━━━
Construct the OPTIMAL ETF portfolio for a ${riskProfile} investor with a ${timeHorizon || '1 year'} time horizon.

This portfolio represents your STRATEGIC CONVICTION — the allocation that maximizes risk-adjusted returns (Sharpe ratio) for this risk level and horizon. It should look virtually identical if generated again tomorrow. Do NOT let this week's headlines flip your strategic positioning.

USE GOOGLE SEARCH to verify:
1. Current 10-Year Treasury yield and real yield (TIPS spread)
2. Current Fed Funds rate and forward rate market expectations (SOFR futures)
3. Current S&P 500 forward P/E vs. 10-year average
4. Current VIX and credit spreads (IG and HY OAS)
5. Current international equity valuations vs. US (CAPE ratios)

━━━ PORTFOLIO CONSTRUCTION PRINCIPLES ━━━
1. FORWARD-LOOKING ONLY: Estimate expected returns using current yields, forward earnings, and factor premia. NEVER cite trailing returns as a reason to allocate.
2. MEAN-VARIANCE OPTIMIZATION: Select weights that explicitly maximize Sharpe ratio. Show your reasoning in macroAlignment.
3. HORIZON CALIBRATION: ${timeHorizon || '1 year'} horizon — match fixed income duration to this horizon. Short horizon → short duration + cash. Long horizon → capture illiquidity and term premia.
4. GEOGRAPHIC DIVERSIFICATION: Include international exposure (VXUS, VEA, or AVDV) unless the portfolio is explicitly capital-preservation only.
5. FACTOR TILTS: For equity sleeves, tilt toward factors with long-term evidence: value (AVUV), quality, momentum where appropriate.
6. TAX EFFICIENCY: Prefer SGOV/USFR over cash for fixed income safety sleeve — Treasury income is state-tax-exempt.

━━━ REQUIREMENTS ━━━
- 6–10 positions for proper diversification
- Weights must sum to EXACTLY 100
- Use specific, liquid ETF tickers from the approved universe (VTI, VXUS, BND, AVUV, SCHD, QQQ, GLD, SGOV, SCHP, VNQ, etc.)
- Each position must serve a distinct diversification role — no redundant exposure

Provide:
- strategyName: professional name for this portfolio
- riskProfile: confirmed risk profile
- expectedReturn: forward annualized return estimate (e.g., "6.5–8.5%") — based on current yields + equity risk premium, NOT trailing returns
- expectedVolatility: annualized vol estimate (e.g., "10–13%")
- sharpeEstimate: estimated Sharpe ratio
- macroAlignment: 4 sentences — (1) current macro regime characterization, (2) how positioning captures forward opportunity, (3) what risks are hedged, (4) what would change this allocation
- rebalancingGuidance: specific trigger conditions (threshold-based, not calendar-based)
- allocations: each with ticker, name, weight, category, rationale (2 sentences: forward-looking role + macro alignment), expenseRatio
- riskWarnings: exactly 4 forward-looking risks specific to this portfolio and current conditions

CRITICAL: weights must sum to exactly 100.
`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0,
      tools: [{ googleSearch: {} }],
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          strategyName: { type: Type.STRING },
          riskProfile: { type: Type.STRING },
          expectedReturn: { type: Type.STRING },
          expectedVolatility: { type: Type.STRING },
          sharpeEstimate: { type: Type.STRING },
          macroAlignment: { type: Type.STRING },
          rebalancingGuidance: { type: Type.STRING },
          allocations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                ticker: { type: Type.STRING },
                name: { type: Type.STRING },
                weight: { type: Type.NUMBER },
                category: { type: Type.STRING },
                rationale: { type: Type.STRING },
                expenseRatio: { type: Type.STRING },
              },
              required: ['ticker', 'name', 'weight', 'category', 'rationale', 'expenseRatio'],
            },
          },
          riskWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['strategyName', 'riskProfile', 'expectedReturn', 'expectedVolatility', 'sharpeEstimate', 'macroAlignment', 'rebalancingGuidance', 'allocations', 'riskWarnings'],
      },
    },
  });

  let result;
  try {
    result = JSON.parse(response.text || '{}');
  } catch {
    return NextResponse.json({ error: 'AI returned invalid JSON. Please try again.' }, { status: 500 });
  }
  if (!result.allocations?.length) {
    return NextResponse.json({ error: 'AI did not return a valid portfolio. Please try again.' }, { status: 500 });
  }
  await setDbCache(key, result);
  return NextResponse.json({ success: true, data: result });
}

export async function handleGenerateArenaAllocation(ctx: HandlerCtx): Promise<NextResponse> {
  const { body, ai, model } = ctx;
  const { riskScore, balance, horizon } = body as { riskScore: number; balance: number; horizon: string };

  const riskTier = riskScore <= 2 ? 'ultra-conservative'
    : riskScore <= 4 ? 'conservative'
    : riskScore <= 6 ? 'moderate'
    : riskScore <= 8 ? 'aggressive'
    : 'ultra-aggressive';

  const horizonLabel = horizon === 'short' ? '1–3 years' : horizon === 'long' ? '10+ years' : '3–10 years';
  const balanceFormatted = `$${Number(balance).toLocaleString()}`;

  const prompt = `You are a senior institutional portfolio strategist at a top-tier asset management firm (think Vanguard, Dimensional, or AQR). Today is ${getCurrentDate()}.

YOUR MANDATE: Construct the single best long-term, buy-and-hold ETF portfolio for this investor profile.

━━━ INVESTOR PROFILE ━━━
- Risk Score: ${riskScore}/10 (${riskTier})
- Investment Amount: ${balanceFormatted}
- Time Horizon: ${horizonLabel}

━━━ STEP 1: GATHER CURRENT MARKET INTELLIGENCE ━━━
Use Google Search RIGHT NOW to find:
1. Current 10-Year Treasury yield (exact number)
2. Current Fed Funds rate and most recent FOMC statement direction
3. Current SGOV and VUSXX 7-day SEC yields (for cash/safety bucket)
4. Current VTI, VXUS, BND, QQQM, AVUV valuations and YTD performance
5. Current inflation (Core PCE) and whether real rates are positive or negative
6. Current market breadth and any major macro risks (recession odds, credit spreads)

━━━ STEP 2: OPTIMIZATION FRAMEWORK ━━━
You must optimize for the HIGHEST RISK-ADJUSTED RETURN (Sharpe ratio) for this risk level — NOT the highest raw return.

Apply these portfolio construction principles:
- DIVERSIFICATION: Spread across asset classes (US equity, intl equity, fixed income, real assets, cash), geographies, and factor exposures. Never concentrate >65% in any single asset class.
- FACTOR EXPOSURE: For equity, tilt toward factors with long-term evidence: value (AVUV, AVDV), momentum (MTUM), quality, small-cap where appropriate for the risk level.
- FIXED INCOME LADDER: Match bond duration to time horizon. Short horizon → short-duration (SGOV, USFR, BIL). Long horizon → intermediate (BND, SCHP).
- TAX-ALPHA ASSETS: For safety/cash allocations, ALWAYS prefer SGOV or VUSXX over HYSA equivalents — their Treasury income is exempt from state income tax, generating meaningful tax alpha on an after-tax basis. Include these when risk score is 1-6 or balance warrants a safety buffer.
- REAL ASSETS: Include a modest GLD or VNQI/VNQ allocation for inflation hedging when horizon > 3 years and risk ≥ 4.
- INTERNATIONAL: ALWAYS include VXUS or AVDV for geographic diversification unless risk score is 1-3 (capital preservation only). US-only portfolios carry unnecessary concentration risk.
- REBALANCING DISCIPLINE: Weights should represent a strategic long-term target, not a tactical trade. This portfolio should look virtually identical if generated yesterday or tomorrow — it represents the OPTIMAL long-term strategic allocation, not a reaction to this week's news.

━━━ APPROVED ASSET UNIVERSE ━━━
Safety/Cash (state-tax-exempt): SGOV, VUSXX, USFR, BIL, IBTG
Short bonds: SHY, SCHO
Intermediate bonds: BND, AGG, SCHZ
Inflation-protected: SCHP, TIPS
Muni (tax-exempt): MUB, CMF, VTEB
US Total Market: VTI, FSKAX
US Large Growth: QQQM, SCHG, VUG
US Small Value (factor): AVUV, VBR
Dividend/Quality: SCHD, VIG, VYM, JEPI
International Developed: VXUS, VEA, AVDV
Emerging Markets: VWO, AVEM
Real Estate: VNQ, VNQI
Gold/Commodities: GLD, IAU, PDBC
Balanced: AOR, AOM, AOA

━━━ ALLOCATION RULES BY RISK TIER ━━━
Risk 1-2 (Ultra-Conservative): 60-80% safety/short bonds (SGOV, VUSXX, BIL), 10-20% intermediate bonds, 0-20% equity. Max Sharpe via capital preservation.
Risk 3-4 (Conservative): 30-50% bonds/safety (include SGOV for tax-alpha), 10-20% intl, 30-40% US equity, consider SCHP for inflation hedge.
Risk 5-6 (Moderate): 15-30% bonds (BND + SGOV for yield/safety), 50-60% equity (VTI + VXUS), 5-10% factor tilt (AVUV), 5% real assets.
Risk 7-8 (Aggressive): 70-80% equity (VTI, VXUS, AVUV), 5-10% small-cap/factor, 5-10% GLD, minimal bonds unless horizon < 5 years.
Risk 9-10 (Ultra-Aggressive): 85-100% equity across US/intl/factor, maximum growth tilt (QQQM, AVUV, VWO), no bonds.

━━━ HOLDINGS REQUIREMENTS ━━━
- Minimum 4 holdings, maximum 8 holdings
- Weights must sum to EXACTLY 1.0
- Each holding must serve a distinct diversification purpose — no redundancy
- For balances under $10,000: simplify to 4-5 core holdings
- For balances over $100,000: use full 6-8 holdings with factor tilts

━━━ OUTPUT ━━━
Return a strategic allocation with a 2-sentence rationale per holding explaining its specific role in maximizing risk-adjusted returns for this investor.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          allocation: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                ticker: { type: Type.STRING },
                weight: { type: Type.NUMBER },
                rationale: { type: Type.STRING },
              },
              required: ['ticker', 'weight', 'rationale'],
            },
          },
        },
        required: ['allocation'],
      },
      tools: [{ googleSearch: {} }],
    },
  });

  const rawText = response.text || '{}';
  const jsonStart = rawText.indexOf('{');
  const jsonEnd = rawText.lastIndexOf('}');
  const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? rawText.slice(jsonStart, jsonEnd + 1) : '{}';
  const result = JSON.parse(jsonStr);
  if (!result.allocation?.length) {
    return NextResponse.json({ error: 'AI did not return a valid allocation. Please try again.' }, { status: 500 });
  }
  return NextResponse.json({ success: true, allocation: result.allocation });
}
