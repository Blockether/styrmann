import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/logs/sessions - Get distinct sessions with log counts
 * Used by the UI session filter dropdown.
 *
 * Query params:
 *   workspace_id - Filter by workspace
 *   agent_id     - Filter by agent
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const url = request.nextUrl;

    const workspaceId = url.searchParams.get('workspace_id');
    const agentId = url.searchParams.get('agent_id');

    const conditions: string[] = [];
    const params: string[] = [];

    if (workspaceId) {
      conditions.push('l.workspace_id = ?');
      params.push(workspaceId);
    }
    if (agentId) {
      conditions.push('l.agent_id = ?');
      params.push(agentId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sessions = db.prepare(`
      SELECT
        l.session_id,
        l.agent_id,
        a.name as agent_name,
        COUNT(*) as log_count,
        MIN(l.created_at) as first_log_at,
        MAX(l.created_at) as last_log_at
      FROM agent_logs l
      LEFT JOIN agents a ON l.agent_id = a.id
      ${where}
      GROUP BY l.session_id
      ORDER BY MAX(l.created_at) DESC
    `).all(...params);

    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Failed to query log sessions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
