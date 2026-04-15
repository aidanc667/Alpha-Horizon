import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { runMigrations } from '@/lib/db';

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await runMigrations();
    return NextResponse.json({ success: true, message: 'Migrations complete' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
