import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

// GET /api/history?ticker=SPY&from=2020-01-01&to=2024-12-31
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  const from   = searchParams.get('from');
  const to     = searchParams.get('to');

  if (!ticker || !from || !to) {
    return NextResponse.json({ error: 'Missing required params: ticker, from, to' }, { status: 400 });
  }

  const TICKER_RE = /^[A-Z0-9.^=\-]{1,10}$/;
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: 'Invalid ticker format' }, { status: 400 });
  }
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }

  try {
    const startTs = Math.floor(new Date(from).getTime() / 1000);
    const endTs   = Math.floor(new Date(to).getTime()   / 1000);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${startTs}&period2=${endTs}&interval=1d`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      next: { revalidate: 3600 }, // Cache for 1 hour on the server
    });

    if (!response.ok) {
      console.error(`[/api/history] Yahoo Finance error for ${ticker}: ${response.status}`);
      return NextResponse.json(
        { error: `Yahoo Finance returned ${response.status}`, ticker },
        { status: response.status }
      );
    }

    const json: any = await response.json();
    const result = json.chart?.result?.[0];

    if (!result?.timestamp || !result?.indicators?.adjclose?.[0]?.adjclose) {
      return NextResponse.json(
        { error: `No data returned for ${ticker}` },
        { status: 404 }
      );
    }

    const timestamps = result.timestamp as number[];
    const adjCloses  = result.indicators.adjclose[0].adjclose as (number | null)[];

    const data = timestamps
      .map((ts, i) => {
        const close = adjCloses[i];
        if (close === null || close === undefined) return null;
        return { date: new Date(ts * 1000).toISOString().split('T')[0], close };
      })
      .filter(Boolean);

    return NextResponse.json({ ticker, data });
  } catch (err: any) {
    console.error(`[/api/history] Error for ${ticker}:`, err.message);
    return NextResponse.json({ error: err.message, ticker }, { status: 500 });
  }
}
