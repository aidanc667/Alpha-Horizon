import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import type { PersonaHolding } from '@/types';

async function fetchLivePrice(ticker: string): Promise<number> {
  if (ticker === 'CASH') return 1.0;
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

// POST /api/personas/[id]/rebalance
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json() as { new_weights: Array<{ ticker: string; weight: number }> };
    const { new_weights } = body;

    if (!Array.isArray(new_weights) || new_weights.length === 0) {
      return NextResponse.json({ error: 'new_weights must be a non-empty array' }, { status: 400 });
    }

    // Validate weights sum to ~1.0 (±0.01)
    const totalWeight = new_weights.reduce((sum, w) => sum + w.weight, 0);
    if (Math.abs(totalWeight - 1) > 0.01) {
      return NextResponse.json({ error: `Weights must sum to 1.0 (got ${totalWeight.toFixed(4)})` }, { status: 400 });
    }

    const sql = db();
    const rows = await sql`SELECT * FROM personas WHERE id = ${id} AND user_id = ${userId}`;
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const persona = rows[0];

    // Get current portfolio value from latest snapshot, fallback to starting_balance
    const snapRows = await sql`
      SELECT portfolio_value FROM persona_snapshots WHERE persona_id = ${id} ORDER BY snapshot_date DESC LIMIT 1
    `;
    const currentPortfolioValue = snapRows[0]?.portfolio_value
      ? Number(snapRows[0].portfolio_value)
      : Number(persona.starting_balance);

    // Fetch live prices for all non-CASH tickers
    const tickersToFetch = new_weights.map(w => w.ticker);
    const priceEntries = await Promise.all(
      tickersToFetch.map(async (ticker) => {
        const price = await fetchLivePrice(ticker);
        return { ticker, price };
      })
    );
    const priceMap: Record<string, number> = {};
    priceEntries.forEach(({ ticker, price }) => { priceMap[ticker] = price; });

    // Build new allocation_json
    const newAllocation: PersonaHolding[] = new_weights.map(({ ticker, weight }) => {
      if (ticker === 'CASH') {
        const cashAmount = currentPortfolioValue * weight;
        return {
          ticker: 'CASH',
          weight,
          shares: cashAmount, // CASH: shares = dollar amount
          inceptionPrice: 1.0,
        };
      }
      const currentPrice = priceMap[ticker];
      const shares = (currentPortfolioValue * weight) / currentPrice;
      return {
        ticker,
        weight,
        shares,
        inceptionPrice: currentPrice, // reset cost basis to rebalance date
      };
    });

    await sql`
      UPDATE personas SET allocation_json = ${JSON.stringify(newAllocation)} WHERE id = ${id} AND user_id = ${userId}
    `;

    return NextResponse.json({
      success: true,
      newAllocation,
      portfolioValue: currentPortfolioValue,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[POST /api/personas/[id]/rebalance]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
