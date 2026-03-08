import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: taskId } = await params;
    const db = getDb();

    const sessions = db
      .prepare(
        `SELECT
          s.*,
          a.name as agent_name
        FROM openclaw_sessions s
        LEFT JOIN agents a ON s.agent_id = a.id
        WHERE s.task_id = ? AND s.session_type = 'subagent'
        ORDER BY s.created_at DESC`,
      )
      .all(taskId);

    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Error fetching task sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch task sessions' }, { status: 500 });
  }
}
