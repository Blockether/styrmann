import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getDb } from '@/lib/db';
import { dispatchToOpenCode } from '@/lib/acp/client';
import { createTaskActivity } from '@/lib/task-activity';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; sessionId: string }> };

type DispatchMetadata = {
  session_id?: unknown;
  session_key?: unknown;
  worktree_path?: unknown;
  output_directory?: unknown;
};

function parseDispatchMetadata(raw: string | null): DispatchMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DispatchMetadata;
    return parsed;
  } catch {
    return null;
  }
}

function resolveCwd(metadata: DispatchMetadata | null): string | undefined {
  if (!metadata) return undefined;
  if (typeof metadata.worktree_path === 'string' && metadata.worktree_path.trim().length > 0) {
    return metadata.worktree_path.trim();
  }
  if (typeof metadata.output_directory === 'string' && metadata.output_directory.trim().length > 0) {
    const value = metadata.output_directory.trim();
    const marker = `${path.sep}.mission-control${path.sep}tasks${path.sep}`;
    const idx = value.indexOf(marker);
    if (idx > 0) return value.slice(0, idx);
  }
  return undefined;
}

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { id: taskId, sessionId: rawSessionId } = await params;
    const sessionId = decodeURIComponent(rawSessionId);
    const db = getDb();
    const now = new Date().toISOString();

    const session = db.prepare(
      `SELECT s.id, s.agent_id, s.session_id, s.status, s.task_id, a.name as agent_name, a.session_key_prefix
       FROM sessions s
       LEFT JOIN agents a ON a.id = s.agent_id
       WHERE s.task_id = ? AND (s.session_id = ? OR s.id = ?)
       LIMIT 1`,
    ).get(taskId, sessionId, sessionId) as {
      id: string;
      agent_id: string | null;
      session_id: string;
      status: string | null;
      task_id: string;
      agent_name: string | null;
      session_key_prefix: string | null;
    } | undefined;

    if (!session) {
      return NextResponse.json({ error: 'Task session not found' }, { status: 404 });
    }

    const task = db.prepare('SELECT id, title, status FROM tasks WHERE id = ?').get(taskId) as {
      id: string;
      title: string;
      status: string;
    } | undefined;

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    db.prepare('UPDATE sessions SET status = ?, ended_at = NULL, updated_at = ? WHERE id = ?').run('active', now, session.id);

    const dispatchRow = db.prepare(
      `SELECT metadata
       FROM task_activities
       WHERE task_id = ? AND activity_type = 'dispatch_invocation' AND metadata LIKE ?
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(taskId, `%${session.session_id}%`) as { metadata: string | null } | undefined;

    const metadata = parseDispatchMetadata(dispatchRow?.metadata || null);
    const sessionKey =
      (typeof metadata?.session_key === 'string' && metadata.session_key.trim().length > 0)
        ? metadata.session_key.trim()
        : `${session.session_key_prefix || 'agent:main:'}${session.session_id}`;

    const resumeMessage = `[Styrmann] Resume previous interrupted session for task "${task.title}" and continue from the latest context. Do not restart from scratch; continue the active iteration and report progress.`;

    const result = await dispatchToOpenCode({
      sessionKey,
      message: resumeMessage,
      cwd: resolveCwd(metadata),
      timeoutMs: 30000,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to resume OpenCode session' },
        { status: 502 },
      );
    }

    createTaskActivity({
      taskId,
      activityType: 'status_changed',
      agentId: session.agent_id || undefined,
      message: `Resumed interrupted session for ${session.agent_name || 'agent'} (session continuation mode)`,
      metadata: {
        workflow_step: task.status || 'in_progress',
        decision_event: true,
        session_id: session.session_id,
        resume_mode: 'session_continue',
        pid: result.pid,
      },
    });

    const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
    return NextResponse.json({
      success: true,
      session: updated,
      resume: {
        session_key: sessionKey,
        pid: result.pid,
      },
    });
  } catch (error) {
    console.error('Failed to resume task session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
