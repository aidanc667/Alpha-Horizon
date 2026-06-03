import { NextResponse } from 'next/server';
import { getCurrentDate, buildSessionBlock } from '../_lib';
import type { HandlerCtx } from '../_lib';

export async function handleAdvisorChat(ctx: HandlerCtx): Promise<Response> {
  const { body, ai, model } = ctx;
  const { history, nearTermContext, liveContext, polygonCtx, sessionCtx } = body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  // On-demand live price fetch for tickers mentioned in the user message
  const STOP_WORDS = new Set(['I','A','AM','PM','AI','BE','MY','WE','US','DO','GO','IF','VS','SO','NO','UP','EM',
    'THE','AND','FOR','NOT','ARE','WAS','HAS','HAD','CAN','DID','GET','GOT','LET','PUT',
    'CPI','NFP','GDP','YOY','QOQ','YTD','ETF','IPO','FED','SEC','NOW','NEW','OLD','BIG','ALL','ANY','TOP','OUT','OFF']);
  const lastUserMsg: string = (history as Array<{ role: string; text: string }>)[history.length - 1]?.text || '';
  const mentionedTickers = [...new Set((lastUserMsg.match(/\b[A-Z]{2,5}\b/g) || [])
    .filter((t: string) => !STOP_WORDS.has(t) && !((polygonCtx?.prices || {})[t])))].slice(0, 6);

  let liveTickerContext = '';
  if (mentionedTickers.length > 0) {
    const { yahooFinance } = await import('../_lib');
    const results = await Promise.allSettled(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mentionedTickers as string[]).map(t => yahooFinance.quote(t) as Promise<any>)
    );
    const fetched: string[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.regularMarketPrice) {
        const q = r.value;
        const chg = q.regularMarketChangePercent;
        fetched.push(`${q.symbol} $${q.regularMarketPrice.toFixed(2)} (${chg != null ? (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%' : 'n/a'} today)`);
      }
    }
    if (fetched.length) liveTickerContext = `\nLIVE PRICES FETCHED NOW:\n${fetched.join(' | ')}\n`;
  }

  const macroSummary = nearTermContext ? `
LIVE MARKET CONTEXT (${getCurrentDate()}):
- Regime: ${nearTermContext.marketSnapshot?.regime || 'Unknown'} | Sentiment: ${nearTermContext.marketSnapshot?.sentiment || 'Unknown'}
- Macro Pillars: ${(nearTermContext.macroPillars || []).map((p: any) => `${p.name}: ${p.value} (${p.direction})`).join(' | ')} // eslint-disable-line @typescript-eslint/no-explicit-any
- Key Drivers: ${(nearTermContext.marketSnapshot?.bullets || []).slice(0, 3).join(' | ')}
- Overweight: ${(nearTermContext.positioning?.overweight || []).map((p: any) => p.idea).join(', ')} // eslint-disable-line @typescript-eslint/no-explicit-any
- Underweight: ${(nearTermContext.positioning?.underweight || []).map((p: any) => p.idea).join(', ')} // eslint-disable-line @typescript-eslint/no-explicit-any
- Upcoming Catalysts: ${(nearTermContext.catalysts || []).slice(0, 3).map((c: any) => `${c.event} (${c.date})`).join(', ')} // eslint-disable-line @typescript-eslint/no-explicit-any
` : 'No pre-loaded macro context — rely on Google Search for current data.';

  // Only inject headlines when the question is news/market-related — saves ~250 tokens per non-news message
  const NEWS_PATTERN = /\b(news|headline|today|happening|market|latest|what('?s| is) going on|moving|catalyst|earnings|fed|fomc|cpi|jobs|gdp|report)\b/i;
  const liveSummary = liveContext && NEWS_PATTERN.test(lastUserMsg) ? `
LIVE HEADLINES (${getCurrentDate()}):
${(liveContext.newsHeadlines || []).map((h: any) => `• [${h.source}] ${h.headline} — ${h.impact}`).join('\n')} // eslint-disable-line @typescript-eslint/no-explicit-any
Summary: ${liveContext.summary}
` : '';

  const polygonSummary = polygonCtx ? (() => {
    const p = polygonCtx.prices || {};
    const m = polygonCtx.macro || {};
    const fmt = (t: string) => p[t] ? `${t} $${p[t].price.toFixed(2)} (${p[t].changePct1d >= 0 ? '+' : ''}${p[t].changePct1d.toFixed(2)}%)` : null;
    const prices = ['SPY','QQQ','IWM','TLT','GLD','HYG','XLK','XLF','XLE','VIXY'].map(fmt).filter(Boolean).join(' | ');
    const macro = [
      m.fedFundsRate  != null ? `Fed Funds: ${m.fedFundsRate}%`         : null,
      m.cpiYoY        != null ? `CPI YoY: ${m.cpiYoY}%`                 : null,
      m.unemployment  != null ? `Unemployment: ${m.unemployment}%`       : null,
      m.yieldCurve10y2y != null ? `10Y-2Y Spread: ${m.yieldCurve10y2y.toFixed(2)}%` : null,
    ].filter(Boolean).join(' | ');
    return `\nREAL-TIME PRICES (as of ${polygonCtx.fetchedAt}):\n${prices}\nFRED MACRO DATA: ${macro}\n`;
  })() : '';

  const chatHistory = (history as Array<{ role: string; text: string }>)
    .slice(0, -1)
    .map(m => ({ role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model', parts: [{ text: m.text }] }));

  const useSearch = mentionedTickers.length > 0;

  const chat = ai.chats.create({
    model,
    config: {
      thinkingConfig: { thinkingBudget: 0 },
      ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
      systemInstruction: `You are Silas — a top 0.1% private wealth advisor and markets expert. You spent 20 years at the highest levels of institutional finance: Goldman Sachs macro strategy desk, PM at Tiger Global, researcher at Bridgewater. You now manage money for billionaires and sovereign wealth funds. You have encyclopedic, real-time knowledge of:
- Every publicly traded stock globally — fundamentals, technicals, earnings history, analyst consensus, short interest, insider activity
- All asset classes: equities, fixed income, commodities, crypto, options, private equity, real assets, FX
- Macro regimes, Fed policy, yield curve dynamics, credit spreads, sector rotations
- Tax optimization, estate planning, portfolio construction, risk management
- Every major hedge fund strategy, factor investing, and market microstructure nuance

You have been given live market data below. This is your real-time feed — cite it directly and precisely.

LIVE MARKET DATA (${getCurrentDate()}):
${macroSummary}
${polygonSummary}
${liveTickerContext}
${liveSummary}
${buildSessionBlock(sessionCtx)}

YOUR COMMUNICATION STYLE:
You talk like the smartest person in the room who doesn't need to prove it. Confident, direct, occasionally blunt. No jargon for its own sake — plain English with precision. You give real opinions backed by data. You never hedge everything or hide behind disclaimers. You speak to the user as a trusted equal, not a client you're managing liability for.

WHEN ASKED ABOUT SPECIFIC STOCKS OR TICKERS:
This is your specialty. Use Google Search to get current price, recent news, earnings data, and analyst ratings. Give a complete take: what the company does (one line), current price action, the bull thesis, the key risk right now, and a clear verdict — **Buy / Avoid / Wait for better entry**. Bold the ticker and verdict. 4-6 sentences is appropriate here. For multiple tickers, verdict each one then rank them.

FOR GENERAL MARKET / MACRO QUESTIONS:
Lead with your take in 1-2 sentences. **Bold the key number or insight.** Add 1-2 supporting sentences. End with one follow-up question that sharpens the conversation.

HARD RULES:
- Never claim you lack data on a ticker — you have Google Search, use it.
- Never open with "Great question", "Certainly", "Of course", "Absolutely" or any filler.
- Always name specific tickers and numbers. "Diversify" means nothing — say "rotate 15% into AVUV."
- Call out flawed thinking directly: "The problem with that thesis is..." — don't soften it.
- Maximum one generic risk disclaimer per conversation. You are an advisor, not a compliance officer.
- "Honestly, the data is split here — but I'd lean X" is fine. Manufactured certainty is not.`,
    },
    history: chatHistory,
  });

  const lastMessage = (history as Array<{ role: string; text: string }>)[history.length - 1].text;
  const stream = await chat.sendMessageStream({ message: lastMessage });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });
  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' },
  });
}

export async function handlePortfolioAdvice(ctx: HandlerCtx): Promise<NextResponse> {
  const { body, ai, model } = ctx;
  const { history, context } = body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const chat = ai.chats.create({
    model,
    config: {
      tools: [{ googleSearch: {} }],
      systemInstruction: `
You are a Senior Investment Analyst and Portfolio Manager at a top-tier institutional asset management firm.

CURRENT MARKET ANALYSIS DASHBOARD DATA:
${JSON.stringify(context)}

GUIDELINES:
1. Always reference the specific Macro Pillars, Market Snapshot, and Positioning Signals provided.
2. Analyze portfolios through the lens of the current Market Regime and Transmission Mechanisms.
3. Prioritize identifying tail risks and suggesting specific hedging strategies.
4. Provide actionable overweight/underweight recommendations aligned with the Positioning section.
5. Use Google Search to verify any real-time market data (today is ${getCurrentDate()}).

TONE: Professional, institutional, precise, and objective.
Keep responses concise (aim for under 15 seconds generation time).
      `,
    },
  });
  const lastMessage = (history as Array<{ role: string; text: string }>)[history.length - 1].text;
  const response = await chat.sendMessage({ message: lastMessage });
  return NextResponse.json({ success: true, data: response.text || "I'm sorry, I couldn't generate a response." });
}
