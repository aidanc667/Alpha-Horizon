import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

// GET /api/plans — list user's saved plans
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = db();
    const rows = await sql`
      SELECT id, name, created_at, updated_at,
             responses_json->>'goalAmount' as goal,
             responses_json->>'timeline' as timeline
      FROM saved_plans
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ plans: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/plans — save or update a plan
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id, name, plan, responses } = await req.json();
    const sql = db();

    if (id) {
      // Update existing
      await sql`
        UPDATE saved_plans
        SET name = ${name || 'My Financial Plan'},
            plan_json = ${JSON.stringify(plan)},
            responses_json = ${JSON.stringify(responses)},
            updated_at = NOW()
        WHERE id = ${id} AND user_id = ${userId}
      `;
      return NextResponse.json({ success: true, id });
    } else {
      // Create new
      const rows = await sql`
        INSERT INTO saved_plans (user_id, name, plan_json, responses_json)
        VALUES (${userId}, ${name || 'My Financial Plan'}, ${JSON.stringify(plan)}, ${JSON.stringify(responses)})
        RETURNING id
      `;
      return NextResponse.json({ success: true, id: rows[0].id });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
