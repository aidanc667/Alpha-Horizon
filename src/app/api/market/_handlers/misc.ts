import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { HandlerCtx } from '../_lib';

export async function handleHistory(_ctx: HandlerCtx): Promise<NextResponse> {
  const sql = db();
  const rows = await sql`
    SELECT record_date, accuracy_score, user_accuracy_correct
    FROM market_daily_records
    WHERE accuracy_score IS NOT NULL
    ORDER BY record_date DESC LIMIT 90
  `;
  return NextResponse.json({
    success: true,
    data: rows.map(r => ({
      date: String(r.record_date).slice(0, 10),
      score: Number(r.accuracy_score),
      userCorrect: r.user_accuracy_correct as boolean | null,
    })),
  });
}

export async function handleUserPredict(ctx: HandlerCtx): Promise<NextResponse> {
  const { body, currentUserId } = ctx;
  if (!currentUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sql = db();
  const { date, prediction } = body as { date: string; prediction: 'Up' | 'Down' | 'Flat' };
  if (!date || !['Up', 'Down', 'Flat'].includes(prediction)) {
    return NextResponse.json({ error: 'Invalid prediction' }, { status: 400 });
  }
  await sql`
    UPDATE market_daily_records
    SET user_spy_prediction = ${prediction},
        user_prediction_locked_at = now()
    WHERE record_date = ${date}
      AND user_spy_prediction IS NULL
  `;
  return NextResponse.json({ success: true });
}
