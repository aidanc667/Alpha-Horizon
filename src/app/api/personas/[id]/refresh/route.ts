import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import type { PersonaHolding, PersonaSnapshotHolding, BenchmarkComponent } from '@/types';

interface YahooQuoteResult {
  regularMarketPrice: number;
  regularMarketChangePercent: number;
  marketState?: string; // 'REGULAR' | 'CLOSED' | 'PRE' | 'POST' | 'PREPRE'
}
interface YahooQuoteResponse { quoteResponse?: { result?: YahooQuoteResult[] } }

async function fetchPrice(ticker: string): Promise<{ price: number; todayChangePct: number; isMarketOpen: boolean }> {
  if (ticker === 'CASH') return { price: 1.0, todayChangePct: 0, isMarketOpen: false };
  // Use the quote endpoint — it returns regularMarketChangePercent directly (same source as Google Finance).
  // The chart endpoint's computed change from adjclose diverges due to dividend adjustments.
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=regularMarketPrice,regularMarketChangePercent,marketState`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${ticker}`);
  const json = (await res.json()) as YahooQuoteResponse;
  const result = json.quoteResponse?.result?.[0];
  if (!result) throw new Error(`No quote data for ${ticker}`);
  const price: number = result.regularMarketPrice ?? 0;
  const isMarketOpen = result.marketState === 'REGULAR';
  // Zero out today's change only in pre-market (market hasn't opened yet for the regular session).
  const isPreMarket = result.marketState === 'PRE' || result.marketState === 'PREPRE';
  const todayChangePct = !isPreMarket ? (result.regularMarketChangePercent ?? 0) / 100 : 0;
  return { price, todayChangePct, isMarketOpen };
}

// POST /api/personas/[id]/refresh
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const sql = db();
    const rows = await sql`SELECT * FROM personas WHERE id = ${id} AND user_id = ${userId}`;
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const persona = rows[0];
    const allocation: PersonaHolding[] = persona.allocation_json;

    // Determine which tickers to fetch for the benchmark
    const benchmarkComponents: BenchmarkComponent[] | null =
      persona.benchmark_component_json?.components ?? null;
    const benchmarkTickersToFetch: string[] = benchmarkComponents
      ? benchmarkComponents.map((c: BenchmarkComponent) => c.ticker)
      : [persona.benchmark_ticker];

    const holdingTickers = allocation.map((h: PersonaHolding) => h.ticker);
    const allTickers = [...new Set([...holdingTickers, ...benchmarkTickersToFetch])];

    // Fetch all prices in parallel
    let anyMarketOpen = false;
    const priceMap: Record<string, { price: number; todayChangePct: number }> = {
      CASH: { price: 1.0, todayChangePct: 0 },
    };
    const tickersToFetch = allTickers.filter(t => t !== 'CASH');
    const priceResults = await Promise.all(tickersToFetch.map(async (t: string) => {
      try {
        const result = await fetchPrice(t);
        if (result.isMarketOpen) anyMarketOpen = true;
        return { ticker: t, ...result };
      }
      catch { return { ticker: t, price: allocation.find((h: PersonaHolding) => h.ticker === t)?.inceptionPrice || 0, todayChangePct: 0, isMarketOpen: false }; }
    }));
    priceResults.forEach(r => { priceMap[r.ticker] = { price: r.price, todayChangePct: r.todayChangePct }; });

    // Build holdings detail
    let totalValue = 0;
    const holdings: PersonaSnapshotHolding[] = allocation.map((h: PersonaHolding) => {
      const { price, todayChangePct } = priceMap[h.ticker] || { price: h.inceptionPrice, todayChangePct: 0 };
      const currentValue = h.shares * price;
      const gainLoss = currentValue - (h.shares * h.inceptionPrice);
      const gainLossPct = (price / h.inceptionPrice) - 1;
      totalValue += currentValue;
      return { ticker: h.ticker, shares: h.shares, inceptionPrice: h.inceptionPrice, currentPrice: price, currentValue, gainLoss, gainLossPct, todayChangePct, weightCurrent: 0 };
    });
    // Calculate current weights
    holdings.forEach(h => { h.weightCurrent = totalValue > 0 ? h.currentValue / totalValue : 0; });

    // Benchmark value — composite (60/40) uses per-component shares, simple uses benchmark_shares
    let benchmarkValue: number;
    if (benchmarkComponents) {
      // Sum each component's shares × current price
      benchmarkValue = benchmarkComponents.reduce((sum: number, c: BenchmarkComponent) => {
        const currentPrice = priceMap[c.ticker]?.price ?? c.inceptionPrice;
        return sum + c.shares * currentPrice;
      }, 0);
    } else {
      const benchPrice = priceMap[persona.benchmark_ticker]?.price || Number(persona.benchmark_inception_price);
      const benchmarkShares: number = persona.benchmark_shares
        ? Number(persona.benchmark_shares)
        : Number(persona.starting_balance) / Number(persona.benchmark_inception_price);
      benchmarkValue = benchmarkShares * benchPrice;
    }

    const today = new Date().toISOString().split('T')[0];

    let snapshot;
    const existing = await sql`SELECT id FROM persona_snapshots WHERE persona_id = ${id} AND snapshot_date = ${today}`;

    if (existing.length > 0) {
      const updated = await sql`
        UPDATE persona_snapshots
        SET portfolio_value = ${totalValue}, benchmark_value = ${benchmarkValue}, holdings_detail_json = ${JSON.stringify(holdings)}
        WHERE persona_id = ${id} AND snapshot_date = ${today}
        RETURNING *
      `;
      snapshot = updated[0];
    } else {
      const inserted = await sql`
        INSERT INTO persona_snapshots (persona_id, snapshot_date, portfolio_value, benchmark_value, holdings_detail_json)
        VALUES (${id}, ${today}, ${totalValue}, ${benchmarkValue}, ${JSON.stringify(holdings)})
        ON CONFLICT (persona_id, snapshot_date) DO UPDATE
          SET portfolio_value = EXCLUDED.portfolio_value,
              benchmark_value = EXCLUDED.benchmark_value,
              holdings_detail_json = EXCLUDED.holdings_detail_json
        RETURNING *
      `;
      snapshot = inserted[0];
    }

    return NextResponse.json({ snapshot, priceMap, isMarketHours: anyMarketOpen });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[POST /api/personas/[id]/refresh]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
