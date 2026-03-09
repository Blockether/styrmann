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

    // Get task status to infer session completion
    const task = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as { status: string } | undefined;
    const taskDone = task && ['done', 'review', 'testing', 'verification', 'cancelled', 'archived'].includes(task.status);

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

    // Check for TASK_COMPLETE in activities to detect finished sessions
    const completedAgentIds = new Set<string>(
      (db.prepare(
        `SELECT DISTINCT agent_id FROM task_activities
         WHERE task_id = ? AND (activity_type = 'completed' OR message LIKE '%TASK_COMPLETE%')`,
      ).all(taskId) as Array<{ agent_id: string }>).map(r => r.agent_id).filter(Boolean)
    );

    const sessionsWithTrace = sessions.map((session) => {
      // Infer effective status: mark as completed if task is done or agent reported completion
      let effectiveStatus = String(session.status || 'active');
      if (effectiveStatus === 'active') {
        if (taskDone || completedAgentIds.has(String(session.agent_id || ''))) {
          effectiveStatus = 'completed';
        }
      }
      return {
        ...session,
        status: effectiveStatus,
        trace_url: `/api/tasks/${taskId}/sessions/${encodeURIComponent(String(session.openclaw_session_id))}/trace`,
      };
    });

    return NextResponse.json(sessionsWithTrace);
  } catch (error) {
    console.error('Error fetching task sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch task sessions' }, { status: 500 });
  }
}
