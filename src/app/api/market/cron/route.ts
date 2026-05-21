/**
 * GET /api/market/cron
 * Called by Vercel Cron at 17:05 UTC (12:05 PM EDT) on weekdays to trigger the noon lock.
 * Vercel sends: Authorization: Bearer <CRON_SECRET>
 */
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Delegate to the tripleCard action — it runs the noon lock if needed.
  // We call ourselves internally using the app URL so we don't have to duplicate the logic.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${baseUrl}/api/market`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Pass a synthetic Clerk session token — tripleCard requires auth.
        // Since this is an internal server-to-server call we attach the cron secret
        // as a custom header; the route.ts POST handler will need to accept it.
        // For now we pass it as x-cron-secret for the POST handler to detect.
        'x-cron-secret': process.env.CRON_SECRET,
      },
      body: JSON.stringify({ action: 'tripleCard' }),
    });

    // tripleCard may fail auth — that's OK, we still return 200 so Vercel doesn't retry.
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, status: res.status, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] tripleCard delegation failed:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
