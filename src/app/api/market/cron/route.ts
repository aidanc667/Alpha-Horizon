/**
 * GET /api/market/cron?type=noon-lock   → called at 12:05 PM ET (17:05 UTC) on weekdays
 * GET /api/market/cron?type=close-score → called at 5:05 PM ET (21:05 UTC) on weekdays
 * Vercel sends: Authorization: Bearer <CRON_SECRET>
 */
import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { db } from '@/lib/db';
import { getApiKey } from '../_lib';
import { scorePreviousDay } from '../_handlers/triple-card';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? 'noon-lock';

  if (type === 'close-score') {
    // After-close scoring: score yesterday's prediction against today's actuals
    try {
      const sql = db();
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const result = await scorePreviousDay(sql, ai, 'gemini-2.5-flash');
      return NextResponse.json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[cron/close-score] Error:', message);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  }

  // Default: noon-lock — delegate to the tripleCard action
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${baseUrl}/api/market`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET,
      },
      body: JSON.stringify({ action: 'tripleCard' }),
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, status: res.status, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron/noon-lock] tripleCard delegation failed:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
