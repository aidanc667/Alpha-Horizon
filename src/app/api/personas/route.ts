import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { GoogleGenAI } from '@google/genai';
import type { PersonaHolding, BenchmarkComponent } from '@/types';

// Composite benchmark definitions (ticker → [{ ticker, weight }])
const COMPOSITE_BENCHMARKS: Record<string, { ticker: string; weight: number }[]> = {
  '60/40': [{ ticker: 'VOO', weight: 0.6 }, { ticker: 'BND', weight: 0.4 }],
};

function getApiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  return key;
}

const getCurrentDate = () =>
  new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

async function fetchLivePrice(ticker: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`Failed to fetch price for ${ticker}`);
  const json: unknown = await res.json();
  const data = json as { chart?: { result?: Array<{ meta: { regularMarketPrice: number } }> } };
  const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!price) throw new Error(`No price data for ${ticker}`);
  return price;
}

async function generateThesis(
  name: string,
  riskScore: number,
  balance: number,
  allocation: PersonaHolding[],
  benchmark: string,
  method: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const allocationStr = allocation.map(h => `${h.ticker} ${(h.weight * 100).toFixed(0)}%`).join(', ');
  const prompt = `Write a 2-3 sentence investment thesis for a hypothetical investor persona with these characteristics:
- Name: ${name}
- Risk Score: ${riskScore}/10
- Starting Balance: $${balance.toLocaleString()}
- Allocation: ${allocationStr}
- Benchmark: ${benchmark}
- Method: ${method === 'ai_optimized' ? 'AI-optimized for current market conditions' : 'manually selected'}
- Date: ${getCurrentDate()}

The thesis should explain why this allocation suits the risk profile and current market environment. Be specific and professional. 2-3 sentences only.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { temperature: 0.4 },
  });
  return response.text?.trim() || `${name} uses a ${riskScore}/10 risk-scored allocation benchmarked against ${benchmark}.`;
}

// GET /api/personas — list all personas for user
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sql = db();
    const rows = await sql`
      SELECT p.*,
        COALESCE(
          (SELECT row_to_json(s) FROM persona_snapshots s
           WHERE s.persona_id = p.id
           ORDER BY s.snapshot_date DESC LIMIT 1),
          NULL
        ) AS latest_snapshot
      FROM personas p
      WHERE p.user_id = ${userId}
      ORDER BY p.created_at DESC
    `;
    return NextResponse.json({ personas: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/personas — create new persona
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { name, risk_score, starting_balance, allocation_method, tickers_weights, benchmark_ticker } = body;
    // tickers_weights: Array<{ ticker: string; weight: number }> — weights 0-1 summing to 1

    if (!name || !starting_balance || !tickers_weights?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const benchmark = benchmark_ticker || 'SPY';
    const isComposite = benchmark in COMPOSITE_BENCHMARKS;

    // Determine which tickers to price-fetch (composite benchmarks use their components, not the benchmark key itself)
    const benchmarkTickersToFetch = isComposite
      ? COMPOSITE_BENCHMARKS[benchmark].map(c => c.ticker)
      : [benchmark];
    const allTickers: string[] = [...tickers_weights.map((t: { ticker: string; weight: number }) => t.ticker), ...benchmarkTickersToFetch];
    // Deduplicate
    const uniqueTickers = [...new Set(allTickers)];

    const priceResults = await Promise.all(uniqueTickers.map(async (t: string) => {
      try { return { ticker: t, price: await fetchLivePrice(t) }; }
      catch { return { ticker: t, price: 0 }; }
    }));
    const priceMap: Record<string, number> = {};
    priceResults.forEach(r => { priceMap[r.ticker] = r.price; });

    // Build allocation with shares
    const allocation: PersonaHolding[] = tickers_weights.map((tw: { ticker: string; weight: number }) => {
      const inceptionPrice = priceMap[tw.ticker];
      if (!inceptionPrice) throw new Error(`Could not get price for ${tw.ticker}`);
      const dollarAmount = tw.weight * starting_balance;
      const shares = dollarAmount / inceptionPrice;
      return { ticker: tw.ticker, weight: tw.weight, shares, inceptionPrice };
    });

    // Build benchmark data — composite or simple
    let benchmarkInceptionPrice: number;
    let benchmarkShares: number;
    let benchmarkComponentJson: { components: BenchmarkComponent[] } | null = null;

    if (isComposite) {
      const components = COMPOSITE_BENCHMARKS[benchmark];
      const compDetails: BenchmarkComponent[] = components.map(c => {
        const price = priceMap[c.ticker];
        if (!price) throw new Error(`Could not get price for benchmark component ${c.ticker}`);
        const dollars = starting_balance * c.weight;
        return { ticker: c.ticker, weight: c.weight, inceptionPrice: price, shares: dollars / price };
      });
      benchmarkComponentJson = { components: compDetails };
      // Blended inception price (for reference/display)
      benchmarkInceptionPrice = compDetails.reduce((s, c) => s + c.weight * c.inceptionPrice, 0);
      // benchmark_shares stored as effective shares of the blended "unit"
      benchmarkShares = starting_balance / benchmarkInceptionPrice;
    } else {
      benchmarkInceptionPrice = priceMap[benchmark];
      if (!benchmarkInceptionPrice) return NextResponse.json({ error: `Could not fetch price for benchmark ${benchmark}` }, { status: 400 });
      benchmarkShares = starting_balance / benchmarkInceptionPrice;
    }

    // Generate thesis
    const thesis = await generateThesis(name, risk_score || 5, starting_balance, allocation, benchmark, allocation_method || 'manual');

    const sql = db();
    const rows = await sql`
      INSERT INTO personas (user_id, name, risk_score, starting_balance, allocation_method, allocation_json, benchmark_ticker, benchmark_inception_price, benchmark_shares, benchmark_component_json, thesis)
      VALUES (${userId}, ${name}, ${risk_score || 5}, ${starting_balance}, ${allocation_method || 'manual'}, ${JSON.stringify(allocation)}, ${benchmark}, ${benchmarkInceptionPrice}, ${benchmarkShares}, ${benchmarkComponentJson ? JSON.stringify(benchmarkComponentJson) : null}, ${thesis})
      RETURNING *
    `;

    return NextResponse.json({ persona: rows[0] }, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[POST /api/personas]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
