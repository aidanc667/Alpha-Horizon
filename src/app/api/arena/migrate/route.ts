import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { runArenaMigrations } from '@/lib/db';

export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await runArenaMigrations();
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
