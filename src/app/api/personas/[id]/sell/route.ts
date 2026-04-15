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

// POST /api/personas/[id]/sell
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json() as { ticker: string; sell_amount: number };
    const { ticker, sell_amount } = body;

    if (!ticker || !sell_amount || sell_amount <= 0) {
      return NextResponse.json({ error: 'ticker and sell_amount (> 0) are required' }, { status: 400 });
    }

    const sql = db();
    const rows = await sql`SELECT * FROM personas WHERE id = ${id} AND user_id = ${userId}`;
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const persona = rows[0];
    const allocation: PersonaHolding[] = persona.allocation_json;

    // Find the holding
    const holding = allocation.find((h: PersonaHolding) => h.ticker === ticker);
    if (!holding) {
      return NextResponse.json({ error: `Ticker ${ticker} not found in portfolio` }, { status: 404 });
    }

    // Fetch current price
    const currentPrice = ticker === 'CASH' ? 1.0 : await fetchLivePrice(ticker);

    // Calculate shares to sell, capped at current holding
    let sharesToSell = sell_amount / currentPrice;
    if (sharesToSell > holding.shares) {
      sharesToSell = holding.shares;
    }

    const actualSellDollars = sharesToSell * currentPrice;

    // Update allocation
    let newAllocation: PersonaHolding[];

    if (sharesToSell >= holding.shares * 0.999) {
      // Remove holding entirely (selling ≥ 99.9% of shares)
      newAllocation = allocation.filter((h: PersonaHolding) => h.ticker !== ticker);
    } else {
      // Reduce shares
      newAllocation = allocation.map((h: PersonaHolding) =>
        h.ticker === ticker
          ? { ...h, shares: h.shares - sharesToSell }
          : h
      );
    }

    // Get existing CASH holding, remove it, re-add with updated total
    const existingCash = newAllocation.find((h: PersonaHolding) => h.ticker === 'CASH');
    const existingCashShares = existingCash ? existingCash.shares : 0;
    const newCashTotal = existingCashShares + actualSellDollars;

    // Filter out any existing CASH
    newAllocation = newAllocation.filter((h: PersonaHolding) => h.ticker !== 'CASH');

    // Re-add CASH holding
    const cashHolding: PersonaHolding = {
      ticker: 'CASH',
      weight: 0,
      shares: newCashTotal,
      inceptionPrice: 1.0,
    };
    newAllocation.push(cashHolding);

    await sql`
      UPDATE personas SET allocation_json = ${JSON.stringify(newAllocation)} WHERE id = ${id} AND user_id = ${userId}
    `;

    return NextResponse.json({
      success: true,
      soldShares: sharesToSell,
      soldAmount: actualSellDollars,
      newCashPosition: newCashTotal,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[POST /api/personas/[id]/sell]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
