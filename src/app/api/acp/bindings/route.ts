import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { resolveDefaultAcpAgent } from '@/lib/openclaw/config';

export const dynamic = 'force-dynamic';

type CreateBindingBody = {
  workspace_id?: unknown;
  discord_thread_id?: unknown;
  discord_channel_id?: unknown;
  acp_session_key?: unknown;
  acp_agent_id?: unknown;
  agent_id?: unknown;
  task_id?: unknown;
  cwd?: unknown;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id');
    const status = searchParams.get('status');
    const agentId = searchParams.get('agent_id');
    const discordThreadId = searchParams.get('discord_thread_id');

    let sql = 'SELECT * FROM acp_bindings WHERE 1=1';
    const params: string[] = [];

    if (workspaceId) {
      sql += ' AND workspace_id = ?';
      params.push(workspaceId);
    }

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (agentId) {
      sql += ' AND agent_id = ?';
      params.push(agentId);
    }

    if (discordThreadId) {
      sql += ' AND discord_thread_id = ?';
      params.push(discordThreadId);
    }

    sql += ' ORDER BY created_at DESC';

    const db = getDb();
    const bindings = db.prepare(sql).all(...params);
    return NextResponse.json(bindings);
  } catch (error) {
    console.error('Failed to list ACP bindings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateBindingBody;

    if (typeof body.workspace_id !== 'string' || body.workspace_id.trim().length === 0) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    if (typeof body.discord_thread_id !== 'string' || body.discord_thread_id.trim().length === 0) {
      return NextResponse.json({ error: 'discord_thread_id is required' }, { status: 400 });
    }

    if (typeof body.acp_session_key !== 'string' || body.acp_session_key.trim().length === 0) {
      return NextResponse.json({ error: 'acp_session_key is required' }, { status: 400 });
    }

    const db = getDb();
    const workspaceId = body.workspace_id.trim();
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as { id: string } | undefined;
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO acp_bindings (
        id,
        workspace_id,
        discord_thread_id,
        discord_channel_id,
        acp_session_key,
        acp_agent_id,
        agent_id,
        task_id,
        cwd,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      workspaceId,
      body.discord_thread_id.trim(),
      typeof body.discord_channel_id === 'string' && body.discord_channel_id.trim().length > 0
        ? body.discord_channel_id.trim()
        : null,
      body.acp_session_key.trim(),
      typeof body.acp_agent_id === 'string' && body.acp_agent_id.trim().length > 0
        ? body.acp_agent_id.trim()
        : resolveDefaultAcpAgent(),
      typeof body.agent_id === 'string' && body.agent_id.trim().length > 0
        ? body.agent_id.trim()
        : null,
      typeof body.task_id === 'string' && body.task_id.trim().length > 0
        ? body.task_id.trim()
        : null,
      typeof body.cwd === 'string' && body.cwd.trim().length > 0
        ? body.cwd.trim()
        : '/root/.openclaw/workspace',
      now,
      now
    );

    const created = db.prepare('SELECT * FROM acp_bindings WHERE id = ?').get(id);

    broadcast({
      type: 'acp_binding_created',
      payload: created,
    } as any);

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Failed to create ACP binding:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
