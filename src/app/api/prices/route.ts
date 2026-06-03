import { NextRequest, NextResponse } from 'next/server';

// In-memory cache: ticker → { price, ts }
const priceCache = new Map<string, { price: number; prevClose: number; ts: number }>();
const CACHE_MS = 15 * 60 * 1000; // 15 minutes

async function fetchPrice(ticker: string): Promise<{ price: number; prevClose: number }> {
  const cached = priceCache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    return { price: cached.price, prevClose: cached.prevClose };
  }

  // Use chartPreviousClose from meta (unadjusted) instead of adjclose array.
  // adjclose is dividend-adjusted and diverges from the actual daily % change on ex-dividend days.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) throw new Error(`Yahoo Finance ${res.status} for ${ticker}`);
  const json: unknown = await res.json();
  const data = json as { chart?: { result?: Array<{ meta: { regularMarketPrice: number; chartPreviousClose?: number; previousClose?: number } }> } };
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const price: number = result.meta.regularMarketPrice;
  const prevClose: number = result.meta.chartPreviousClose ?? result.meta.previousClose ?? price;

  priceCache.set(ticker, { price, prevClose, ts: Date.now() });
  return { price, prevClose };
}

// GET /api/prices?tickers=VTI,BND,SPY
export async function GET(req: NextRequest) {
  const tickersParam = req.nextUrl.searchParams.get('tickers');
  if (!tickersParam) return NextResponse.json({ error: 'Missing tickers param' }, { status: 400 });

  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  if (tickers.length > 50) {
    return NextResponse.json({ error: 'Too many tickers — max 50' }, { status: 400 });
  }
  const TICKER_RE = /^[A-Z0-9.^=\-]{1,10}$/;
  const invalid = tickers.find(t => !TICKER_RE.test(t));
  if (invalid) {
    return NextResponse.json({ error: `Invalid ticker: ${invalid}` }, { status: 400 });
  }

  const results: Record<string, { price: number; prevClose: number }> = {};
  const errors: string[] = [];

  await Promise.all(tickers.map(async (t) => {
    try {
      results[t] = await fetchPrice(t);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${t}: ${msg}`);
      results[t] = { price: 0, prevClose: 0 };
    }
  }));

  const isMarketHours = (() => {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay();
    const h = et.getHours();
    const m = et.getMinutes();
    const mins = h * 60 + m;
    return day >= 1 && day <= 5 && mins >= 570 && mins <= 960; // 9:30–16:00 ET
  })();

  return NextResponse.json({ results, isMarketHours, errors, updatedAt: new Date().toISOString() });
}
