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
    const staleThresholdMs = Number.parseInt(process.env.MC_SESSION_STALE_THRESHOLD_MS || '900000', 10);

    const sessions = db
      .prepare(
        `SELECT
          s.*,
          a.name as agent_name,
          (
            SELECT MAX(ta.created_at)
            FROM task_activities ta
            WHERE ta.task_id = s.task_id
              AND ta.activity_type = 'status_changed'
              AND ta.metadata LIKE '%"resume_mode":"session_continue"%'
              AND ta.metadata LIKE ('%"openclaw_session_id":"' || s.openclaw_session_id || '"%')
          ) as resumed_at
        FROM openclaw_sessions s
        LEFT JOIN agents a ON s.agent_id = a.id
        WHERE s.task_id = ?
        ORDER BY s.created_at DESC`,
      )
      .all(taskId) as Array<Record<string, unknown>>;

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
        effectiveStatus = 'stale';
      }
      return {
        ...session,
        status: effectiveStatus,
        is_active: effectiveStatus === 'active',
        inactivity_minutes: inactivityMinutes,
        resumed_via_session_continuation: Boolean(session.resumed_at),
        resumed_at: session.resumed_at || null,
        trace_url: `/api/tasks/${taskId}/sessions/${encodeURIComponent(String(session.openclaw_session_id))}/trace`,
      };
    });

    return NextResponse.json(sessionsWithTrace);
  } catch (error) {
    console.error('Error fetching task sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch task sessions' }, { status: 500 });
  }
}
