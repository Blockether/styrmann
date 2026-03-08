import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { queryOne, queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; sessionId: string }> };

function normalizeMessage(raw: unknown): { role: string; content: string; timestamp?: string } {
  const msg = raw as Record<string, unknown>;
  let content: string;
  if (Array.isArray(msg.content)) {
    content = (msg.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');
  } else {
    content = String(msg.content || '');
  }

  const timestamp =
    typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : (msg.timestamp as string | undefined);

  return { role: String(msg.role || 'unknown'), content, timestamp };
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { id: taskId, sessionId } = await params;

    const session = queryOne<{
      openclaw_session_id: string;
      agent_name?: string;
      session_key_prefix?: string;
    }>(
      `SELECT s.openclaw_session_id, a.name as agent_name, a.session_key_prefix
       FROM openclaw_sessions s
       LEFT JOIN agents a ON s.agent_id = a.id
       WHERE s.task_id = ? AND s.openclaw_session_id = ?
       LIMIT 1`,
      [taskId, sessionId],
    );

    if (!session) {
      return NextResponse.json({ error: 'Task session not found' }, { status: 404 });
    }

    const invocationRows = queryAll<{ metadata: string; created_at: string }>(
      `SELECT metadata, created_at
       FROM task_activities
       WHERE task_id = ? AND activity_type = 'dispatch_invocation'
       ORDER BY created_at DESC`,
      [taskId],
    );

    const invocation = invocationRows
      .map((row) => {
        try {
          const parsed = JSON.parse(row.metadata || '{}') as Record<string, unknown>;
          return {
            created_at: row.created_at,
            session_id: String(parsed.openclaw_session_id || ''),
            session_key: String(parsed.session_key || ''),
            output_directory: String(parsed.output_directory || ''),
            invocation: String(parsed.invocation || ''),
          };
        } catch {
          return null;
        }
      })
      .find((row) => row && row.session_id === sessionId) || null;

    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    const candidateKeys = Array.from(
      new Set([
        invocation?.session_key,
        `${session.session_key_prefix || 'agent:main:'}${sessionId}`,
        sessionId,
      ].filter(Boolean)),
    ) as string[];

    let history: Array<{ role: string; content: string; timestamp?: string }> = [];
    let resolvedSessionKey: string | null = null;

    for (const key of candidateKeys) {
      try {
        const rawMessages = await client.getSessionHistory(key);
        history = rawMessages.map(normalizeMessage);
        resolvedSessionKey = key;
        break;
      } catch {
      }
    }

    return NextResponse.json({
      task_id: taskId,
      openclaw_session_id: sessionId,
      agent_name: session.agent_name || null,
      session_key: resolvedSessionKey,
      invocation,
      history,
    });
  } catch (error) {
    console.error('Failed to fetch task session trace:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
