import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import YahooFinanceCls from 'yahoo-finance2';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YahooFinanceCls as any)();

const SYMBOLS = [
  'SPY', 'QQQ', 'IWM', 'DIA',
  'TLT', 'HYG', '^TNX',
  '^VIX',
  'GLD', 'USO',
  'EFA', 'EEM',
  'BTC-USD', 'ETH-USD',
];

interface PriceEntry {
  symbol: string;
  price: number | null;
  change: number | null;
}

// 2-minute in-process cache
let cache: { data: PriceEntry[]; ts: number } | null = null;
const CACHE_TTL = 2 * 60 * 1000;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  const results = await Promise.allSettled(
    SYMBOLS.map(sym => (yf.quote(sym) as Promise<any>).catch(() => null))
  );

  const data: PriceEntry[] = results.map((r, i) => {
    const q = r.status === 'fulfilled' ? r.value : null;
    return {
      symbol: SYMBOLS[i],
      price: q?.regularMarketPrice ?? null,
      change: q?.regularMarketChangePercent ?? null,
    };
  });

  cache = { data, ts: Date.now() };
  return NextResponse.json(data);
}
