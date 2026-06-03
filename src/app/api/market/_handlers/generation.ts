import { NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { getCurrentDate, buildSessionBlock, buildMarketStance } from '../_lib';
import type { HandlerCtx } from '../_lib';

export async function handleBestAssets(ctx: HandlerCtx): Promise<NextResponse> {
  const { body, ai, model } = ctx;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { riskProfile, timeHorizon, nearTermContext, liveContext, sessionCtx } = body as Record<string, any>;

  const contextStr = nearTermContext ? `
Current Regime: ${nearTermContext.marketSnapshot?.regime} | Sentiment: ${nearTermContext.marketSnapshot?.sentiment}
Macro Pillars: ${(nearTermContext.macroPillars || []).map((p: any) => `${p.name}=${p.value}(${p.direction})`).join(', ')} // eslint-disable-line @typescript-eslint/no-explicit-any
Live Headlines: ${(liveContext?.newsHeadlines || []).slice(0, 5).map((h: any) => h.headline).join(' | ')} // eslint-disable-line @typescript-eslint/no-explicit-any
` : `Today is ${getCurrentDate()}. No pre-loaded context — use Google Search for current market data.`;

  const prompt = `
You are a world-class institutional portfolio strategist. Today is ${getCurrentDate()}.

MARKET CONTEXT:
${contextStr}
${buildMarketStance(nearTermContext)}
${buildSessionBlock(sessionCtx)}
TASK: Identify the TOP 8 best INDIVIDUAL STOCKS to own RIGHT NOW for a ${riskProfile} investor with a ${timeHorizon} time horizon.

CRITICAL: Individual stocks ONLY. No ETFs, no index funds, no mutual funds. Every pick must be a single company stock (e.g. NVDA, MSFT, JPM). If you include an ETF, the response is invalid.

SELECTION CRITERIA:
- Forward-looking expected returns grounded in current macro regime and company fundamentals
- Risk-adjusted conviction (earnings visibility, balance sheet strength, sector tailwinds)
- Current macro regime alignment — explicitly connect each pick to the regime context above
- Mix of sectors — do not cluster all picks in one sector
- Diversification across market cap (large, mid)

For each of the 8 assets:
- rank (1-8, where 1 is highest conviction)
- ticker (ETF/stock ticker symbol)
- name (full name)
- category (e.g., "US Large Cap Equity", "Short-Duration Fixed Income", "Commodity")
- suggestedWeight (allocation % — must sum to 100 across all 8)
- forwardReturn (estimated annualized return range, e.g., "6–9%")
- rationale (2-3 sentences connecting to current macro conditions)
- risk ("Low", "Medium", or "High")
- expenseRatio (e.g., "0.03%", "N/A" for individual stocks)

Also provide:
- regime: one-line description of current market regime
- generatedAt: current date/time string
- macroAlignment: 2-3 sentences explaining how this portfolio aligns with today's macro environment

IMPORTANT: suggestedWeights MUST sum to exactly 100.
      `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
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

  const result = JSON.parse(response.text || '{}');
  return NextResponse.json({ success: true, data: result });
}

export async function handleBestStrategy(ctx: HandlerCtx): Promise<NextResponse> {
  const { body, ai, model } = ctx;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { riskProfile, timeHorizon, nearTermContext, liveContext, sessionCtx } = body as Record<string, any>;

  const contextStr = nearTermContext ? `
Current Regime: ${nearTermContext.marketSnapshot?.regime} | Sentiment: ${nearTermContext.marketSnapshot?.sentiment}
Macro Pillars: ${(nearTermContext.macroPillars || []).map((p: any) => `${p.name}=${p.value}(${p.direction})`).join(', ')} // eslint-disable-line @typescript-eslint/no-explicit-any
Live Headlines: ${(liveContext?.newsHeadlines || []).slice(0, 5).map((h: any) => h.headline).join(' | ')} // eslint-disable-line @typescript-eslint/no-explicit-any
` : `Today is ${getCurrentDate()}. No pre-loaded context — use Google Search for current market data.`;

  const prompt = `
You are the world's best portfolio manager. Today is ${getCurrentDate()}.

MARKET CONTEXT:
${contextStr}
${buildMarketStance(nearTermContext)}
${buildSessionBlock(sessionCtx)}
TASK: Construct the OPTIMAL investment portfolio for a ${riskProfile} investor with a ${timeHorizon || '1 year'} time horizon in TODAY'S market environment.

REQUIREMENTS:
- Modern Portfolio Theory principles: maximize Sharpe ratio for ${riskProfile} risk tolerance
- Calibrate for ${timeHorizon || '1 year'} time horizon: shorter horizons need more capital preservation and liquidity; longer horizons support higher equity allocation and illiquidity premium capture
- Weights MUST sum to exactly 100%
- 6-12 positions for proper diversification
- Account for expense ratios in expected return calculations
- Align with current macro regime (explicitly stated in context)
- Be actionable: use specific ETFs/tickers where possible
- Consider: US equity, international, fixed income, real assets, cash/alternatives as appropriate
${buildSessionBlock(sessionCtx)}

Use Google Search to verify current yields, valuations, and market conditions.

Provide:
- strategyName: creative but professional name for this portfolio
- riskProfile: confirm the risk profile
- expectedReturn: annualized expected return range (e.g., "6.5–8.5%")
- expectedVolatility: annualized volatility estimate (e.g., "10–13%")
- sharpeEstimate: estimated Sharpe ratio (e.g., "0.65–0.80")
- macroAlignment: 3-4 sentences explaining WHY this portfolio is optimal for today's conditions
- rebalancingGuidance: when and how to rebalance (specific trigger conditions)
- allocations: each with ticker, name, weight (%), category, rationale (2-3 sentences), expenseRatio
- riskWarnings: 3-5 specific risks to this strategy given current conditions

CRITICAL: allocation weights MUST sum to exactly 100.
      `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
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

  const result = JSON.parse(response.text || '{}');
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
