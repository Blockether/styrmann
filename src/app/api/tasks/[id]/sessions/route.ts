import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: taskId } = await params;
    const db = getDb();
    const nowMs = Date.now();
    const staleThresholdMs = Number.parseInt(process.env.MC_SESSION_STALE_THRESHOLD_MS || '300000', 10);

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

    const completedAgentIds = new Set<string>(
      (db.prepare(
        `SELECT DISTINCT agent_id FROM task_activities
         WHERE task_id = ? AND (activity_type = 'completed' OR message LIKE '%TASK_COMPLETE%')`,
      ).all(taskId) as Array<{ agent_id: string }>).map(r => r.agent_id).filter(Boolean)
    );

    const sessionsWithTrace = sessions.map((session) => {
      const rawStatus = String(session.status || 'active');
      const hasEndedAt = Boolean(session.ended_at);
      const updatedAtRaw = String(session.updated_at || session.created_at || '');
      const updatedAtMs = Number.isFinite(new Date(updatedAtRaw).getTime()) ? new Date(updatedAtRaw).getTime() : 0;
      const staleByInactivity = rawStatus === 'active' && updatedAtMs > 0 && (nowMs - updatedAtMs) >= staleThresholdMs;
      const inactivityMinutes = updatedAtMs > 0 ? Math.max(0, Math.floor((nowMs - updatedAtMs) / 60000)) : null;

      let effectiveStatus = rawStatus;
      if (rawStatus === 'active' && hasEndedAt) {
        effectiveStatus = 'completed';
      } else if (rawStatus === 'active' && staleByInactivity) {
        effectiveStatus = 'interrupted';
      } else if (rawStatus === 'active' && (taskDone || completedAgentIds.has(String(session.agent_id || '')))) {
        effectiveStatus = 'stale';
      }
      return {
        ...session,
        status: effectiveStatus,
        is_active: effectiveStatus === 'active',
        inactivity_minutes: inactivityMinutes,
        trace_url: `/api/tasks/${taskId}/sessions/${encodeURIComponent(String(session.openclaw_session_id))}/trace`,
      };
    });

    return NextResponse.json(sessionsWithTrace);
  } catch (error) {
    console.error('Error fetching task sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch task sessions' }, { status: 500 });
  }
}
