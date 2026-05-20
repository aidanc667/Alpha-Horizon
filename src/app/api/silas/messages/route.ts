import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

const MAX_HISTORY = 100;

// GET /api/silas/messages — fetch last N messages for the current user
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = db();
  const rows = await sql`
    SELECT id, role, content, created_at
    FROM silas_messages
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
    LIMIT ${MAX_HISTORY}
  `;

  return NextResponse.json({
    messages: rows.map(r => ({ id: r.id, role: r.role, text: r.content })),
  });
}

// POST /api/silas/messages — append a message
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { role, content } = await req.json();
  if (!role || !content || !['user', 'assistant'].includes(role)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const sql = db();
  await sql`
    INSERT INTO silas_messages (user_id, role, content)
    VALUES (${userId}, ${role}, ${content})
  `;

  return NextResponse.json({ success: true });
}

// DELETE /api/silas/messages — clear conversation history
export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = db();
  await sql`DELETE FROM silas_messages WHERE user_id = ${userId}`;

  return NextResponse.json({ success: true });
}
