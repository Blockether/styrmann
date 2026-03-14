import { NextRequest, NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/db';
import type { DiscordMessage } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const workspace = queryOne<{ id: string }>(
    'SELECT id FROM workspaces WHERE id = ? OR slug = ?',
    [workspaceId, workspaceId],
  );
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const { searchParams } = new URL(_request.url);
  const classification = searchParams.get('classification');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  const conditions = ['dm.workspace_id = ?'];
  const queryParams: unknown[] = [workspace.id];

  if (classification && ['task', 'conversation', 'clarification'].includes(classification)) {
    conditions.push('dm.classification = ?');
    queryParams.push(classification);
  }

  const where = conditions.join(' AND ');

  const rows = queryAll<DiscordMessage>(
    `SELECT dm.*, t.title as task_title, t.status as task_status
     FROM discord_messages dm
     LEFT JOIN tasks t ON dm.task_id = t.id
     WHERE ${where}
     ORDER BY dm.created_at DESC
     LIMIT ?`,
    [...queryParams, limit],
  );

  return NextResponse.json(rows);
}
