import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { readAgentMdFromDisk, createAgentInOpenClawConfig, readOpenClawConfig, resolveAgents } from '@/lib/openclaw/config';
import { ensureSynced } from '@/lib/openclaw/sync';
import { syncAgentsWithRpcCheck } from '@/lib/openclaw/sync';
import type { Agent, AgentStatus, CreateAgentRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';
// GET /api/agents - List all agents
export async function GET(_request: NextRequest) {
  try {
    ensureSynced();
    const agents = queryAll<Agent>(`
      SELECT * FROM agents ORDER BY CASE WHEN role = 'orchestrator' THEN 0 ELSE 1 END, name ASC
    `);
for (const agent of agents) {
      if (agent.source === 'synced') {
const mdFiles = readAgentMdFromDisk(agent.agent_workspace_path, agent.gateway_agent_id);
agent.soul_md = mdFiles.soul_md ?? undefined;
agent.user_md = mdFiles.user_md ?? undefined;
agent.agents_md = mdFiles.agents_md ?? undefined;
agent.memory_md = mdFiles.memory_md ?? undefined;
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

function normalizeAgentIdPart(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'agent';
}

function nextGatewayAgentId(baseName: string): string {
  const config = readOpenClawConfig();
  const existingIds = new Set<string>();

  if (config) {
    for (const agent of resolveAgents(config)) {
      existingIds.add(agent.id);
    }
  }

  const base = normalizeAgentIdPart(baseName);
  if (!existingIds.has(base)) return base;

  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }

  return `${base}-${Date.now()}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as (CreateAgentRequest & { source?: string });

    if (!body.name || !body.role) {
      return NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
    }

    if (body.source) {
      return NextResponse.json({ error: 'source cannot be provided by clients' }, { status: 400 });
    }

    if (body.role === 'orchestrator') {
      const existingOrchestrator = queryOne<{ id: string }>(
        'SELECT id FROM agents WHERE role = ?',
        ['orchestrator']
      );
      if (existingOrchestrator) {
        return NextResponse.json(
          { error: 'An Orchestrator already exists' },
          { status: 409 }
        );
      }
    }

    const gatewayAgentId = nextGatewayAgentId(body.name);
    const created = createAgentInOpenClawConfig({
      id: gatewayAgentId,
      name: body.name,
      role: body.role,
      model: body.model,
      soulMd: body.soul_md,
      userMd: body.user_md,
      agentsMd: body.agents_md,
      memoryMd: body.memory_md,
    });

    if (!created.ok) {
      return NextResponse.json({ error: created.error || 'Failed to create OpenClaw agent' }, { status: 500 });
    }

    await syncAgentsWithRpcCheck();

    const agent = queryOne<Agent>('SELECT * FROM agents WHERE gateway_agent_id = ?', [gatewayAgentId]);
    if (!agent) {
      return NextResponse.json({ error: 'Agent created in OpenClaw config but not synced to Mission Control' }, { status: 500 });
    }

    run(
      `INSERT INTO events (id, type, agent_id, message, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), 'agent_joined', agent.id, `${body.name} created in OpenClaw and synced`, new Date().toISOString()]
    );

    return NextResponse.json({ ...agent, created_via: 'openclaw_config_sync' }, { status: 201 });
  } catch (error) {
    console.error('Failed to create agent:', error);
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}
