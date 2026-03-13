import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import type { Agent, AgentStatus, CreateAgentRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    const agents = queryAll<Agent>(`
      SELECT * FROM agents ORDER BY CASE WHEN role = 'orchestrator' THEN 0 ELSE 1 END, name ASC
    `);
    for (const agent of agents) {
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
        if (agent.status !== 'working') {
          agent.status = 'working' as AgentStatus;
          run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?',
            ['working', new Date().toISOString(), agent.id]);
        }
      } else if (activeTasks.length > 0 && agent.status === 'standby') {
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

    const agentId = uuidv4();
    const now = new Date().toISOString();

    run(
      `INSERT INTO agents (id, name, role, model, soul_md, user_md, agents_md, memory_md, status, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'standby', 'local', ?, ?)`,
      [agentId, body.name, body.role, body.model || null, body.soul_md || null, body.user_md || null, body.agents_md || null, body.memory_md || null, now, now]
    );

    run(
      `INSERT INTO events (id, type, agent_id, message, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), 'agent_joined', agentId, `${body.name} created`, now]
    );

    const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agentId]);
    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error('Failed to create agent:', error);
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}
