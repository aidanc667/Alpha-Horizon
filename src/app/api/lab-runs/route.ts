import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = db();
    const rows = await sql`
      SELECT id, name, allocations, metrics_json, created_at
      FROM lab_runs
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ runs: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { name, allocations, config, metrics } = await req.json();
    const sql = db();
    const rows = await sql`
      INSERT INTO lab_runs (user_id, name, allocations, config_json, metrics_json)
      VALUES (${userId}, ${name || 'Backtest'}, ${JSON.stringify(allocations)}, ${JSON.stringify(config)}, ${JSON.stringify(metrics)})
      RETURNING id
    `;
    return NextResponse.json({ success: true, id: rows[0].id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
