import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { ids: string[] };

    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }

    const placeholders = body.ids.map(() => '?').join(',');
    run(
      `UPDATE discord_messages SET completion_notified = 1 WHERE id IN (${placeholders})`,
      body.ids,
    );

    return NextResponse.json({ acknowledged: body.ids.length });
  } catch (error) {
    console.error('[Discord Completions Ack] Failed:', error);
    return NextResponse.json({ error: 'Failed to acknowledge' }, { status: 500 });
  }
}
