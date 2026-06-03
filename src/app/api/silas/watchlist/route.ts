import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

const MAX_TICKERS = 20;

// GET /api/silas/watchlist — fetch user's watchlist tickers
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = db();
  const rows = await sql`
    SELECT ticker
    FROM silas_watchlist
    WHERE user_id = ${userId}
    ORDER BY added_at ASC
  `;

  return NextResponse.json({ tickers: rows.map(r => r.ticker as string) });
}

// POST /api/silas/watchlist — add ticker (upsert, max 20)
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ticker } = await req.json();
  if (!ticker || typeof ticker !== 'string' || !ticker.trim()) {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
  }

  const t = ticker.trim().toUpperCase();
  const sql = db();

  // Check count
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM silas_watchlist WHERE user_id = ${userId}
  `;
  if ((count as number) >= MAX_TICKERS) {
    return NextResponse.json({ error: 'Maximum 20 tickers reached' }, { status: 400 });
  }

  const [existing] = await sql`
    SELECT 1 FROM silas_watchlist WHERE user_id = ${userId} AND ticker = ${t}
  `;
  if (existing) {
    return NextResponse.json({ error: 'Ticker already in watchlist', duplicate: true }, { status: 409 });
  }

  await sql`
    INSERT INTO silas_watchlist (user_id, ticker) VALUES (${userId}, ${t})
  `;

  return NextResponse.json({ success: true });
}

// DELETE /api/silas/watchlist — remove ticker
export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ticker } = await req.json();
  if (!ticker || typeof ticker !== 'string') {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
  }

  const t = ticker.trim().toUpperCase();
  const sql = db();
  await sql`
    DELETE FROM silas_watchlist WHERE user_id = ${userId} AND ticker = ${t}
  `;

  return NextResponse.json({ success: true });
}
