import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import type { PersonaHolding, BenchmarkComponent } from '@/types';

async function fetchLivePrice(ticker: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Failed to fetch price for ${ticker}`);
  const json: unknown = await res.json();
  const data = json as { chart?: { result?: Array<{ meta: { regularMarketPrice: number } }> } };
  const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!price) throw new Error(`No price data for ${ticker}`);
  return price;
}

// POST /api/personas/[id]/add-position
// Body: { ticker: string, amount: number }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { ticker, amount } = body;

    if (!ticker || !amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'ticker and amount are required' }, { status: 400 });
    }

    const sql = db();
    const rows = await sql`SELECT * FROM personas WHERE id = ${id} AND user_id = ${userId}`;
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const persona = rows[0];
    const cleanTicker = String(ticker).trim().toUpperCase();
    const dollarAmount = Number(amount);

    const isCompositeBenchmark = !!persona.benchmark_component_json?.components;

    // Fetch prices: new ticker + benchmark component tickers (or benchmark itself)
    const benchmarkComponents: BenchmarkComponent[] | null =
      persona.benchmark_component_json?.components ?? null;
    const benchmarkFetchTickers = benchmarkComponents
      ? benchmarkComponents.map((c: BenchmarkComponent) => c.ticker)
      : [persona.benchmark_ticker];
    const allFetchTickers = [...new Set([cleanTicker, ...benchmarkFetchTickers])];

    const prices = await Promise.all(allFetchTickers.map(async t => {
      try { return { ticker: t, price: await fetchLivePrice(t) }; }
      catch { return { ticker: t, price: 0 }; }
    }));
    const priceMap: Record<string, number> = {};
    prices.forEach(p => { priceMap[p.ticker] = p.price; });

    const tickerPrice = priceMap[cleanTicker];
    if (!tickerPrice) throw new Error(`Could not get price for ${cleanTicker}`);

    // Calculate new shares
    const newShares = dollarAmount / tickerPrice;

    // Update allocation_json — add new lot entry
    const allocation: PersonaHolding[] = persona.allocation_json;
    const newLot: PersonaHolding = {
      ticker: cleanTicker,
      weight: 0, // recalculated dynamically on display
      shares: newShares,
      inceptionPrice: tickerPrice,
    };
    const updatedAllocation = [...allocation, newLot];

    // Update starting_balance (total invested)
    const newStartingBalance = Number(persona.starting_balance) + dollarAmount;

    let newBenchmarkShares: number | null = null;
    let updatedComponentJson: { components: BenchmarkComponent[] } | null = null;

    if (isCompositeBenchmark && benchmarkComponents) {
      // Add proportional dollar amounts to each component
      const updatedComponents: BenchmarkComponent[] = benchmarkComponents.map((c: BenchmarkComponent) => {
        const price = priceMap[c.ticker] ?? c.inceptionPrice;
        const additionalShares = (dollarAmount * c.weight) / price;
        return { ...c, shares: c.shares + additionalShares };
      });
      updatedComponentJson = { components: updatedComponents };
    } else {
      const benchmarkPrice = priceMap[persona.benchmark_ticker];
      if (!benchmarkPrice) throw new Error(`Could not get price for benchmark ${persona.benchmark_ticker}`);
      const currentBenchmarkShares: number = persona.benchmark_shares
        ? Number(persona.benchmark_shares)
        : Number(persona.starting_balance) / Number(persona.benchmark_inception_price);
      newBenchmarkShares = currentBenchmarkShares + dollarAmount / benchmarkPrice;
    }

    await sql`
      UPDATE personas
      SET
        allocation_json = ${JSON.stringify(updatedAllocation)},
        benchmark_shares = ${newBenchmarkShares},
        benchmark_component_json = ${updatedComponentJson ? JSON.stringify(updatedComponentJson) : persona.benchmark_component_json ? JSON.stringify(persona.benchmark_component_json) : null},
        starting_balance = ${newStartingBalance}
      WHERE id = ${id} AND user_id = ${userId}
    `;

    return NextResponse.json({
      success: true,
      ticker: cleanTicker,
      shares: newShares,
      inceptionPrice: tickerPrice,
      newStartingBalance,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[POST /api/personas/[id]/add-position]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
