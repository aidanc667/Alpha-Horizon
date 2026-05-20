import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import YahooFinanceCls from 'yahoo-finance2';
// v3 requires instantiation (v2 exported a singleton; v3 exports the class)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yahooFinance = new (YahooFinanceCls as any)();

const SECTOR_ETFS: Record<string, string> = {
  XLK:  'Technology',
  XLV:  'Health Care',
  XLE:  'Energy',
  XLF:  'Financials',
  XLI:  'Industrials',
  XLY:  'Consumer Disc.',
  XLP:  'Consumer Staples',
  XLB:  'Materials',
  XLRE: 'Real Estate',
  XLU:  'Utilities',
  XLC:  'Comm. Services',
};

interface BriefCacheEntry {
  data: HomeBriefResponse;
  ts: number;
}

interface HomeBriefResponse {
  brief: string;
  leadingSector: { name: string; ticker: string; change: number };
  laggingSector: { name: string; ticker: string; change: number };
}

const briefCache = new Map<string, BriefCacheEntry>();
const BRIEF_TTL = 30 * 60 * 1000; // 30 minutes

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cacheKey = `brief:${userId}:${new Date().toISOString().slice(0, 13)}`; // hourly bucket
  const cached = briefCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < BRIEF_TTL) {
    return NextResponse.json(cached.data);
  }

  // ── Fetch sector ETF quotes ────────────────────────────────────────────────
  const tickers = Object.keys(SECTOR_ETFS);
  const quotes = await Promise.allSettled(
    tickers.map(t => (yahooFinance.quote(t) as Promise<any>).catch(() => null))
  );

  const sectorResults: { ticker: string; name: string; change: number }[] = [];
  quotes.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) {
      const q = result.value;
      sectorResults.push({
        ticker: tickers[i],
        name: SECTOR_ETFS[tickers[i]],
        change: q.regularMarketChangePercent ?? 0,
      });
    }
  });

  sectorResults.sort((a, b) => b.change - a.change);
  const leading = sectorResults[0] ?? { ticker: 'XLK', name: 'Technology', change: 0 };
  const lagging = sectorResults[sectorResults.length - 1] ?? { ticker: 'XLE', name: 'Energy', change: 0 };

  // ── Generate AI brief ──────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  console.log('[home-brief] apiKey present:', !!apiKey, '| sectors found:', sectorResults.length);
  let brief = 'Market data is loading. Check back shortly for your morning brief.';

  if (apiKey) {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const sectorSummary = sectorResults
      .slice(0, 5)
      .map(s => `${s.name} (${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%)`)
      .join(', ');

    const prompt = `You are Silas, an institutional wealth advisor AI. Write a 3-4 sentence morning market brief for ${today}.

Today's sector performance (best to worst): ${sectorSummary}. Leading sector: ${leading.name} (${leading.change >= 0 ? '+' : ''}${leading.change.toFixed(2)}%). Lagging sector: ${lagging.name} (${lagging.change.toFixed(2)}%).

Rules:
- Be specific and accurate — reference actual market dynamics for today
- Mention the leading and lagging sectors naturally
- Note any significant macro context (Fed policy, earnings season, macro data releases this week)
- End with a brief statement about portfolio positioning (e.g. whether defensives/growth/cyclicals are favored)
- Write in plain, direct prose — no bullet points, no markdown, no headers
- Exactly 3-4 sentences, ~60-80 words total`;

    try {
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      brief = result.text?.trim() ?? brief;
    } catch {
      // fall through to default brief
    }
  }

  const data: HomeBriefResponse = { brief, leadingSector: leading, laggingSector: lagging };
  briefCache.set(cacheKey, { data, ts: Date.now() });
  return NextResponse.json(data);
}
