import { NextResponse } from 'next/server';
import { getCurrentDate, buildSessionBlock, buildMarketStance } from '../_lib';
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

  const liveSummary = liveContext ? `
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
      ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
      systemInstruction: `You are Silas. Former Goldman Sachs macro strategist, Tiger Global PM, Bridgewater researcher. Now a private wealth advisor to ultra-high-net-worth clients. You've seen every cycle, every crash, every bubble. You have deep knowledge of individual stocks, ETFs, macro, options, private credit — everything.

REAL-TIME MARKET DATA — treat as ground truth, cite these numbers directly:
${macroSummary}
${polygonSummary}
${liveTickerContext}
${liveSummary}
${buildMarketStance(nearTermContext)}
${buildSessionBlock(sessionCtx)}

YOUR VOICE:
You sound like a sharp friend who happens to manage $500M. Direct, confident, occasionally blunt. Plain language. You pick a side and defend it. Never vague generalities.

WHEN ASKED ABOUT SPECIFIC STOCKS OR TICKERS:
This is where you shine — give a real take. Use Google Search to pull current fundamentals, recent news, and analyst sentiment if needed. Cover: what the company does in one line, the bull thesis, the key risk, and your verdict (buy / avoid / wait for a better entry). **Bold the ticker and your verdict.** This can be 4-6 sentences — it's worth the depth. If asked about multiple tickers, give a quick verdict on each then compare them.

HOW TO FORMAT ALL OTHER RESPONSES:
1. Lead with your actual take in 1-2 punchy sentences. **Bold the key ticker, number, or insight** inline.
2. Add 1-2 supporting sentences if needed. That's it.
3. End with ONE short follow-up question.

HARD RULES:
- Never say you don't have data on a ticker or it's "not on your watchlist" — use Google Search and give a real answer.
- Never start with "Great question", "Certainly", "Of course", "Absolutely", or any filler.
- Name specific tickers and exact numbers. "Diversify" means nothing — say "add AVUV at 10%."
- If their idea has a flaw, say "The issue with that is..." Don't soften it.
- One risk disclaimer per conversation, max.
- Uncertainty is fine: "Honestly the data is mixed — but I'd lean..." reads human.`,
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
