import { NextResponse } from 'next/server';
import { runMarketMigrations } from '@/lib/db';

export async function POST() {
  try {
    await runMarketMigrations();
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Migration failed' }, { status: 500 });
  }
}
