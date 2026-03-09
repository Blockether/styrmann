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
        WHERE s.task_id = ?
        ORDER BY s.created_at DESC`,
      )
      .all(taskId) as Array<Record<string, unknown>>;

    const sessionsWithTrace = sessions.map((session) => ({
      ...session,
      trace_url: `/api/tasks/${taskId}/sessions/${encodeURIComponent(String(session.openclaw_session_id))}/trace`,
    }));

    return NextResponse.json(sessionsWithTrace);
  } catch (error) {
    console.error('Error fetching task sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch task sessions' }, { status: 500 });
  }
}
