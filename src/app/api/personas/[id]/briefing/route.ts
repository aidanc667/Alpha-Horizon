import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { GoogleGenAI } from '@google/genai';
import type { PersonaHolding, PersonaSnapshotHolding } from '@/types';

function getApiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  return key;
}

const getCurrentDate = () =>
  new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// POST /api/personas/[id]/briefing
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const sql = db();
    const rows = await sql`SELECT * FROM personas WHERE id = ${id} AND user_id = ${userId}`;
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const persona = rows[0];
    const today = new Date().toISOString().split('T')[0];

    // Check if today's briefing already exists
    const existing = await sql`
      SELECT ai_briefing, ai_briefing_generated_at FROM persona_snapshots
      WHERE persona_id = ${id} AND snapshot_date = ${today} AND ai_briefing IS NOT NULL
    `;
    if (existing.length > 0 && existing[0].ai_briefing) {
      let cachedBriefing: unknown = existing[0].ai_briefing;
      try {
        cachedBriefing = JSON.parse(existing[0].ai_briefing as string);
      } catch {
        // keep as string
      }
      return NextResponse.json({ briefing: cachedBriefing, generated_at: existing[0].ai_briefing_generated_at, cached: true });
    }

    // Get latest snapshot for context
    const snapRows = await sql`
      SELECT * FROM persona_snapshots WHERE persona_id = ${id} ORDER BY snapshot_date DESC LIMIT 1
    `;

    const allocation: PersonaHolding[] = persona.allocation_json;
    const holdings: PersonaSnapshotHolding[] = snapRows[0]?.holdings_detail_json || [];
    const portfolioValue = snapRows[0]?.portfolio_value || persona.starting_balance;
    const totalReturn = ((Number(portfolioValue) / Number(persona.starting_balance)) - 1) * 100;

    const holdingsStr = holdings.map((h: PersonaSnapshotHolding) =>
      `${h.ticker}: ${(h.weightCurrent * 100).toFixed(1)}% of portfolio, today ${h.todayChangePct >= 0 ? '+' : ''}${(h.todayChangePct * 100).toFixed(2)}%, total ${h.gainLossPct >= 0 ? '+' : ''}${(h.gainLossPct * 100).toFixed(2)}%`
    ).join('\n');

    const riskLabel = persona.risk_score <= 3 ? 'conservative' : persona.risk_score <= 6 ? 'moderate' : 'aggressive';

    // Benchmark return and alpha
    const benchmarkValue = snapRows[0]?.benchmark_value || persona.starting_balance;
    const benchReturn = ((Number(benchmarkValue) / Number(persona.starting_balance)) - 1) * 100;
    const alpha = totalReturn - benchReturn;

    // Suppress unused variable warning — allocation used for context
    void allocation;

    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const prompt = `You are a portfolio intelligence system for a paper trading simulator. Today is ${getCurrentDate()}.

PERSONA: "${persona.name}" — ${riskLabel} investor (risk ${persona.risk_score}/10)
PORTFOLIO VALUE: $${Number(portfolioValue).toLocaleString('en-US')} (${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}% since inception)
BENCHMARK (${persona.benchmark_ticker}): ${benchReturn >= 0 ? '+' : ''}${benchReturn.toFixed(2)}% | ALPHA: ${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%

TODAY'S HOLDINGS:
${holdingsStr || 'Positions not yet refreshed today'}

INVESTMENT THESIS: ${persona.thesis || 'N/A'}

Search for today's market news/data. Then return ONLY valid JSON, no other text:
{
  "summary": "One sentence portfolio status and key insight",
  "signals": [
    {
      "type": "TRIM|ADD|HOLD|WATCH|SELL|REBALANCE",
      "ticker": "TICKER or PORTFOLIO",
      "action": "Specific recommendation in 8 words max",
      "reason": "Evidence with real numbers in 12 words max"
    }
  ],
  "macro": "One sentence: today's key macro event relevant to this portfolio",
  "health": "OVERWEIGHT_RISK|BALANCED|UNDERWEIGHT_RISK|CASH_DRAG"
}

Signal rules:
- Generate 3-5 signals ordered by urgency (most urgent first)
- Use real search data: RSI, yield %, sector moves, earnings dates, Fed statements
- All tickers must be holdings this persona actually has
- Be brutally specific: "RSI 78, up 22% YTD" not vague "seems overvalued"
- health: OVERWEIGHT_RISK = too risky for their risk score, UNDERWEIGHT_RISK = too conservative, CASH_DRAG = >15% cash, BALANCED otherwise`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.5,
        tools: [{ googleSearch: {} }],
      },
    });

    const rawText = response.text?.trim() || '{}';
    const jsonStr = rawText.slice(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);

    let parsedJSON: unknown;
    try {
      parsedJSON = JSON.parse(jsonStr);
    } catch {
      parsedJSON = rawText; // fallback to raw string
    }

    const briefingToStore = typeof parsedJSON === 'string' ? parsedJSON : JSON.stringify(parsedJSON);
    const now = new Date().toISOString();

    // Upsert briefing into today's snapshot
    await sql`
      INSERT INTO persona_snapshots (persona_id, snapshot_date, portfolio_value, benchmark_value, holdings_detail_json, ai_briefing, ai_briefing_generated_at)
      VALUES (${id}, ${today}, ${portfolioValue}, ${snapRows[0]?.benchmark_value || persona.starting_balance}, ${JSON.stringify(holdings)}, ${briefingToStore}, ${now})
      ON CONFLICT (persona_id, snapshot_date) DO UPDATE
        SET ai_briefing = EXCLUDED.ai_briefing, ai_briefing_generated_at = EXCLUDED.ai_briefing_generated_at
    `;

    return NextResponse.json({ briefing: parsedJSON, generated_at: now, cached: false });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[POST /api/personas/[id]/briefing]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
