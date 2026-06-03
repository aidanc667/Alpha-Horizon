import { NextResponse } from 'next/server';
import { yahooFinance, getCached, setCache, fetchSPYData, fetchSectorData, fetchMarketMovers, fetchFearAndGreed, fetchSPYPutCallRatio } from '../_lib';
import type { HandlerCtx } from '../_lib';

export async function handlePolygonTicker(ctx: HandlerCtx): Promise<NextResponse> {
  const { ticker } = ctx.body;
  if (!ticker || typeof ticker !== 'string') {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  }
  const clean = (ticker as string).toUpperCase().replace(/[^A-Z0-9.^=-]/g, '').slice(0, 10);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote: any = await yahooFinance.quote(clean);
    const price: number | null = quote.regularMarketPrice ?? null;
    const changePct: number | null = quote.regularMarketChangePercent ?? null;
    if (!price) return NextResponse.json({ error: 'Price not available' }, { status: 404 });
    return NextResponse.json({ success: true, data: { ticker: clean, price, changePct, name: quote.shortName || clean } });
  } catch {
    return NextResponse.json({ error: 'Ticker not found' }, { status: 404 });
  }
}

export async function handlePolygonContext(_ctx: HandlerCtx): Promise<NextResponse> {
  const cached = getCached('polygonContext');
  if (cached) return NextResponse.json({ success: true, data: cached });

  const fredKey = process.env.FRED_API_KEY;
  const TICKERS = ['SPY','QQQ','IWM','TLT','GLD','HYG','UUP','XLK','XLF','XLE','XLV','VIXY'];

  const [yahooResults, fredRates, fredCpi, fredUnrate, fredSpread] = await Promise.allSettled([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Promise.all(TICKERS.map(t => (yahooFinance.quote(t) as Promise<any>).catch(() => null))),
    fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=DFF&api_key=${fredKey}&limit=1&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
    fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=${fredKey}&limit=13&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
    fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE&api_key=${fredKey}&limit=1&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
    fredKey ? fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=T10Y2Y&api_key=${fredKey}&limit=1&sort_order=desc&file_type=json`) : Promise.reject('no fred'),
  ]);

  const priceMap: Record<string, { price: number; change1d: number; changePct1d: number }> = {};
  if (yahooResults.status === 'fulfilled') {
    for (const quote of yahooResults.value) {
      if (quote?.symbol && quote.regularMarketPrice) {
        priceMap[quote.symbol] = {
          price: quote.regularMarketPrice,
          change1d: quote.regularMarketChange ?? 0,
          changePct1d: quote.regularMarketChangePercent ?? 0,
        };
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getFredLatest = async (res: PromiseSettledResult<Response>): Promise<number | null> => {
    if (res.status !== 'fulfilled' || !res.value.ok) return null;
    const j = await res.value.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obs = j.observations?.filter((o: any) => o.value !== '.') ?? [];
    return obs.length ? parseFloat(obs[0].value) : null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getFredYoY = async (res: PromiseSettledResult<Response>): Promise<number | null> => {
    if (res.status !== 'fulfilled' || !res.value.ok) return null;
    const j = await res.value.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obs = (j.observations ?? []).filter((o: any) => o.value !== '.');
    if (obs.length < 13) return null;
    const latest  = parseFloat(obs[0].value);
    const yearAgo = parseFloat(obs[12].value);
    return ((latest - yearAgo) / yearAgo) * 100;
  };

  const [fedFunds, cpiYoY, unrate, yieldSpread] = await Promise.all([
    getFredLatest(fredRates),
    getFredYoY(fredCpi),
    getFredLatest(fredUnrate),
    getFredLatest(fredSpread),
  ]);

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    prices: priceMap,
    macro: {
      fedFundsRate: fedFunds,
      cpiYoY: cpiYoY ? Math.round(cpiYoY * 100) / 100 : null,
      unemployment: unrate,
      yieldCurve10y2y: yieldSpread,
    },
  };
  setCache('polygonContext', snapshot);
  return NextResponse.json({ success: true, data: snapshot });
}

// Re-export fetchers used by tripleCard / refreshLive handlers
export { fetchSPYData, fetchSectorData, fetchMarketMovers, fetchFearAndGreed, fetchSPYPutCallRatio };
