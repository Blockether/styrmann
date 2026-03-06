import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface LogEntry {
  id: string;
  agent_id: string | null;
  openclaw_session_id: string;
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

    const insert = db.prepare(`
      INSERT OR IGNORE INTO agent_logs (id, agent_id, openclaw_session_id, role, content, content_hash, workspace_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let stored = 0;

    const insertAll = db.transaction(() => {
      for (const entry of entries) {
        if (!entry.content || !entry.role || !validRoles.includes(entry.role)) continue;
        if (!entry.content_hash || !entry.openclaw_session_id) continue;

        const result = insert.run(
          entry.id,
          entry.agent_id || null,
          entry.openclaw_session_id,
          entry.role,
          entry.content,
          entry.content_hash,
          entry.workspace_id || 'default',
          entry.created_at || new Date().toISOString()
        );

        if (result.changes > 0) stored++;
      }
    });

    insertAll();

    return NextResponse.json({ stored, total: entries.length });
  } catch (error) {
    console.error('Failed to ingest agent logs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
