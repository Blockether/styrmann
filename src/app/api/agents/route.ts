import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { readAgentMdFromDisk, readAgentDescriptionFromDisk } from '@/lib/openclaw/config';
import { ensureSynced } from '@/lib/openclaw/sync';
import type { Agent, AgentStatus, CreateAgentRequest } from '@/lib/types';

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
        ORDER BY CASE WHEN role = 'orchestrator' THEN 0 ELSE 1 END, name ASC
      `, [workspaceId]);
    } else {
      agents = queryAll<Agent>(`
        SELECT * FROM agents ORDER BY CASE WHEN role = 'orchestrator' THEN 0 ELSE 1 END, name ASC
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
      // Get active tasks for this agent (with workspace name + deliverable count)
      const activeTasks = queryAll<{
        id: string;
        title: string;
        status: string;
        workspace_id: string;
        workspace_name: string;
        workspace_slug: string;
        deliverable_count: number;
      }>(
        `SELECT t.id, t.title, t.status, t.workspace_id,
                w.name as workspace_name, w.slug as workspace_slug,
                (SELECT COUNT(*) FROM task_deliverables td WHERE td.task_id = t.id) as deliverable_count
         FROM tasks t
         LEFT JOIN workspaces w ON w.id = t.workspace_id
         WHERE t.assigned_agent_id = ?
         AND t.status IN ('in_progress', 'assigned', 'testing', 'review', 'verification')
         ORDER BY CASE WHEN t.status = 'in_progress' THEN 0 ELSE 1 END, t.updated_at DESC`,
        [agent.id]
      );
      agent.active_task_count = activeTasks.length;
      agent.active_tasks = activeTasks;
      const hasInProgress = activeTasks.some(t => t.status === 'in_progress');
      if (hasInProgress) {
        agent.current_task_title = activeTasks.find(t => t.status === 'in_progress')!.title;
        // Reconcile: if agent has in_progress tasks, status must be 'working'
        if (agent.status !== 'working') {
          agent.status = 'working' as AgentStatus;
          run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?',
            ['working', new Date().toISOString(), agent.id]);
        }
      } else if (activeTasks.length > 0 && agent.status === 'standby') {
        // Has assigned/testing/review tasks but not in_progress — still working
        agent.status = 'working' as AgentStatus;
        run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?',
          ['working', new Date().toISOString(), agent.id]);
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

    // Reject all external POST requests - agents are synced from OpenClaw Gateway only
    // The 'source' field must never be accepted from external callers
    if ((body as { source?: string }).source) {
      return NextResponse.json({ error: 'Standalone agent creation is disabled. Agents are synced from OpenClaw Gateway.' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Standalone agent creation is disabled. Agents are synced from OpenClaw Gateway.' }, { status: 403 });

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
