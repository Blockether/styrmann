import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { readAgentMdFromDisk, readAgentDescriptionFromDisk } from '@/lib/openclaw/config';
import { ensureSynced } from '@/lib/openclaw/sync';
import type { Agent, CreateAgentRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';
// GET /api/agents - List all agents
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    ensureSynced();

    let agents: Agent[];
    if (workspaceId) {
      agents = queryAll<Agent>(`
        SELECT * FROM agents WHERE workspace_id = ? OR source = 'synced'
        ORDER BY role ASC, name ASC
      `, [workspaceId]);
    } else {
      agents = queryAll<Agent>(`
        SELECT * FROM agents ORDER BY role ASC, name ASC
      `);
    }
    for (const agent of agents) {
      if (agent.source === 'synced') {
        const mdFiles = readAgentMdFromDisk(agent.agent_workspace_path);
        agent.soul_md = mdFiles.soul_md ?? undefined;
        agent.user_md = mdFiles.user_md ?? undefined;
        agent.agents_md = mdFiles.agents_md ?? undefined;
        const systemMd = readAgentDescriptionFromDisk(agent.agent_dir);
        if (systemMd) agent.description = systemMd;
      }
    }
    return NextResponse.json(agents);
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

// POST /api/agents - Disabled: agents are created via OpenClaw sync only
export async function POST(request: NextRequest) {
  try {
    const body: CreateAgentRequest = await request.json();

    if (!(body as { source?: string }).source || (body as { source?: string }).source !== 'synced') {
      return NextResponse.json({ error: 'Standalone agent creation is disabled. Agents are synced from OpenClaw Gateway.' }, { status: 403 });
    }

    if (!body.name || !body.role) {
      return NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
    }

    // Enforce single orchestrator per workspace
    if (body.role === 'orchestrator') {
      const workspaceId = (body as { workspace_id?: string }).workspace_id || 'default';
      const existingOrchestrator = queryOne<{ id: string }>(
        'SELECT id FROM agents WHERE workspace_id = ? AND role = ?',
        [workspaceId, 'orchestrator']
      );
      if (existingOrchestrator) {
        return NextResponse.json(
          { error: 'An Orchestrator already exists for this workspace' },
          { status: 409 }
        );
      }
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    run(
      `INSERT INTO agents (id, name, role, description, workspace_id, soul_md, user_md, agents_md, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        body.role,
        body.description || null,
        (body as { workspace_id?: string }).workspace_id || 'default',
        body.soul_md || null,
        body.user_md || null,
        body.agents_md || null,
        body.model || null,
        now,
        now,
      ]
    );

    // Log event
    run(
      `INSERT INTO events (id, type, agent_id, message, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), 'agent_joined', id, `${body.name} joined the team`, now]
    );

    const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [id]);
    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error('Failed to create agent:', error);
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}
