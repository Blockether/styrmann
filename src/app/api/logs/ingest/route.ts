import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface LogEntry {
  id: string;
  agent_id: string | null;
  openclaw_session_id: string;
  task_id?: string | null;
  role: string;
  content: string;
  content_hash: string;
  workspace_id: string;
  created_at: string;
}

/**
 * POST /api/logs/ingest - Bulk insert log entries (daemon use)
 *
 * Body: { entries: LogEntry[] }
 * Deduplicates by content_hash (UNIQUE index).
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const entries: LogEntry[] = body.entries;

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'entries array required' }, { status: 400 });
    }

    const validRoles = ['user', 'assistant', 'system'];

    // Prepare task_id lookup from agent sessions
    const lookupTaskId = db.prepare(`
      SELECT task_id FROM openclaw_sessions
      WHERE openclaw_session_id = ? AND task_id IS NOT NULL
      LIMIT 1
    `);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO agent_logs (id, agent_id, openclaw_session_id, task_id, role, content, content_hash, workspace_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const touchSession = db.prepare('UPDATE openclaw_sessions SET updated_at = ? WHERE openclaw_session_id = ?');

    let stored = 0;

    const insertAll = db.transaction(() => {
      for (const entry of entries) {
        if (!entry.content || !entry.role || !validRoles.includes(entry.role)) continue;
        if (!entry.content_hash || !entry.openclaw_session_id) continue;

        // Resolve task_id: use provided value, or look up from openclaw_sessions
        let taskId = entry.task_id || null;
        if (!taskId) {
          const session = lookupTaskId.get(entry.openclaw_session_id) as { task_id: string } | undefined;
          if (session) taskId = session.task_id;
        }

        const result = insert.run(
          entry.id,
          entry.agent_id || null,
          entry.openclaw_session_id,
          taskId,
          entry.role,
          entry.content,
          entry.content_hash,
          entry.workspace_id || 'default',
          entry.created_at || new Date().toISOString()
        );

        if (result.changes > 0) stored++;

        touchSession.run(entry.created_at || new Date().toISOString(), entry.openclaw_session_id);
      }
    });

    insertAll();

    return NextResponse.json({ stored, total: entries.length });
  } catch (error) {
    console.error('Failed to ingest agent logs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
