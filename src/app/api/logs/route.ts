import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/logs - Query agent logs with rich filtering
 *
 * Query params:
 *   agent_id       - Filter by agent
 *   session_id     - Filter by agent session ID
 *   role           - Filter by role (user|assistant|system)
 *   workspace_id   - Filter by workspace
 *   search         - Full-text search in content
 *   from           - Start date (ISO 8601)
 *   to             - End date (ISO 8601)
 *   limit          - Page size (default 50, max 200)
 *   offset         - Pagination offset (default 0)
 *   order          - Sort order: 'asc' | 'desc' (default 'desc')
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const url = request.nextUrl;

    const agentId = url.searchParams.get('agent_id');
    const sessionId = url.searchParams.get('session_id');
    const role = url.searchParams.get('role');
    const workspaceId = url.searchParams.get('workspace_id');
    const search = url.searchParams.get('search');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const order = url.searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (agentId) {
      conditions.push('l.agent_id = ?');
      params.push(agentId);
    }
    if (sessionId) {
      conditions.push('l.openclaw_session_id = ?');
      params.push(sessionId);
    }
    if (role && ['user', 'assistant', 'system'].includes(role)) {
      conditions.push('l.role = ?');
      params.push(role);
    }
    if (workspaceId) {
      conditions.push('l.workspace_id = ?');
      params.push(workspaceId);
    }
    if (search) {
      conditions.push('l.content LIKE ?');
      params.push(`%${search}%`);
    }
    if (from) {
      conditions.push('l.created_at >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('l.created_at <= ?');
      params.push(to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count for pagination
    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM agent_logs l ${where}`
    ).get(...params) as { total: number };

    // Get paginated results with agent join
    const logs = db.prepare(`
      SELECT
        l.id,
        l.agent_id,
        l.openclaw_session_id,
        l.role,
        l.content,
        l.content_hash,
        l.workspace_id,
        l.created_at,
        a.name as agent_name,
        a.role as agent_role
      FROM agent_logs l
      LEFT JOIN agents a ON l.agent_id = a.id
      ${where}
      ORDER BY l.created_at ${order}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return NextResponse.json({
      logs,
      total: countRow.total,
      limit,
      offset,
      hasMore: offset + limit < countRow.total,
    });
  } catch (error) {
    console.error('Failed to query agent logs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/logs - Cleanup stale logs
 *
 * Query params:
 *   days - Delete logs older than N days (default 60)
 */
export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const url = request.nextUrl;
    const days = parseInt(url.searchParams.get('days') || '60', 10) || 60;

    const result = db.prepare(
      `DELETE FROM agent_logs WHERE created_at < datetime('now', ? || ' days')`
    ).run(`-${days}`);

    return NextResponse.json({
      deleted: result.changes,
      olderThan: `${days} days`,
    });
  } catch (error) {
    console.error('Failed to cleanup agent logs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
