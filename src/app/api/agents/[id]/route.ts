import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, run } from '@/lib/db';
import { writeAgentFieldToConfig, writeAgentMdFile, readAgentMdFromDisk, readAgentDescriptionFromDisk } from '@/lib/openclaw/config';
import type { Agent, UpdateAgentRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';
// GET /api/agents/[id] - Get a single agent
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [id]);

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (agent.source === 'synced') {
      const mdFiles = readAgentMdFromDisk(agent.agent_workspace_path);
      agent.soul_md = mdFiles.soul_md ?? undefined;
      agent.user_md = mdFiles.user_md ?? undefined;
      agent.agents_md = mdFiles.agents_md ?? undefined;
      agent.memory_md = mdFiles.memory_md ?? undefined;
      const systemMd = readAgentDescriptionFromDisk(agent.agent_dir);
      if (systemMd) agent.description = systemMd;
    }

    return NextResponse.json(agent);
  } catch (error) {
    console.error('Failed to fetch agent:', error);
    return NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 });
  }
}

// PATCH /api/agents/[id] - Update an agent
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: UpdateAgentRequest = await request.json();
    const isSystemStatusUpdate = request.headers.get('x-mc-system') === 'daemon';

    const existing = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Block orchestrator demotion
    if (body.role !== undefined && existing.role === 'orchestrator' && body.role !== 'orchestrator') {
      return NextResponse.json(
        { error: 'Cannot demote Orchestrator. Delete and recreate the agent to change its role.' },
        { status: 400 }
      );
    }

    // Block duplicate orchestrator promotion
    if (body.role === 'orchestrator' && existing.role !== 'orchestrator') {
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

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name);
    }
    if (body.role !== undefined) {
      updates.push('role = ?');
      values.push(body.role);
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      values.push(body.description);
    }
    if (body.status !== undefined) {
      if (!isSystemStatusUpdate) {
        return NextResponse.json(
          { error: 'Agent status is system-managed and cannot be updated manually' },
          { status: 403 },
        );
      }

      updates.push('status = ?');
      values.push(body.status);

      // Log status change event
      const now = new Date().toISOString();
      run(
        `INSERT INTO events (id, type, agent_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), 'agent_status_changed', id, `${existing.name} is now ${body.status}`, now]
      );
    }
    const isSynced = existing.source === 'synced';
    if (body.soul_md !== undefined && !isSynced) {
      updates.push('soul_md = ?');
      values.push(body.soul_md);
    }
    if (body.user_md !== undefined && !isSynced) {
      updates.push('user_md = ?');
      values.push(body.user_md);
    }
    if (body.agents_md !== undefined && !isSynced) {
      updates.push('agents_md = ?');
      values.push(body.agents_md);
    }
    if (body.memory_md !== undefined && !isSynced) {
      updates.push('memory_md = ?');
      values.push(body.memory_md);
    }
    if (body.model !== undefined) {
      updates.push('model = ?');
      values.push(body.model);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    run(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`, values);

    if (existing.source === 'synced' && existing.gateway_agent_id) {
      const gatewayId = existing.gateway_agent_id;

      if (body.name !== undefined) {
        writeAgentFieldToConfig(gatewayId, 'identity.name', body.name);
      }
      if (body.model !== undefined) {
        writeAgentFieldToConfig(gatewayId, 'model', body.model);
      }

      const workspacePath = existing.agent_workspace_path;
      if (workspacePath) {
        if (body.soul_md !== undefined) {
          writeAgentMdFile(workspacePath, 'SOUL.md', body.soul_md);
        }
        if (body.user_md !== undefined) {
          writeAgentMdFile(workspacePath, 'USER.md', body.user_md);
        }
        if (body.agents_md !== undefined) {
          writeAgentMdFile(workspacePath, 'AGENTS.md', body.agents_md);
        }
        if (body.memory_md !== undefined) {
          writeAgentMdFile(workspacePath, 'MEMORY.md', body.memory_md);
        }
      }
    }

    const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [id]);
    if (agent && agent.source === 'synced') {
      const mdFiles = readAgentMdFromDisk(agent.agent_workspace_path);
      agent.soul_md = mdFiles.soul_md ?? undefined;
      agent.user_md = mdFiles.user_md ?? undefined;
      agent.agents_md = mdFiles.agents_md ?? undefined;
      agent.memory_md = mdFiles.memory_md ?? undefined;
      const systemMd = readAgentDescriptionFromDisk(agent.agent_dir);
      if (systemMd) agent.description = systemMd;
    }
    return NextResponse.json(agent);
  } catch (error) {
    console.error('Failed to update agent:', error);
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}

// DELETE /api/agents/[id] - Delete an agent
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [id]);

    if (!existing) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Delete or nullify related records first (foreign key constraints)
    run('DELETE FROM openclaw_sessions WHERE agent_id = ?', [id]);
    run('DELETE FROM events WHERE agent_id = ?', [id]);
    run('DELETE FROM messages WHERE sender_agent_id = ?', [id]);
    run('DELETE FROM conversation_participants WHERE agent_id = ?', [id]);
    run('DELETE FROM task_roles WHERE agent_id = ?', [id]);
    run('DELETE FROM agent_heartbeats WHERE agent_id = ?', [id]);
    run('DELETE FROM agent_logs WHERE agent_id = ?', [id]);
    run('UPDATE tasks SET assigned_agent_id = NULL WHERE assigned_agent_id = ?', [id]);
    run('UPDATE tasks SET created_by_agent_id = NULL WHERE created_by_agent_id = ?', [id]);
    run('UPDATE task_activities SET agent_id = NULL WHERE agent_id = ?', [id]);
    run('UPDATE task_run_results SET agent_id = NULL WHERE agent_id = ?', [id]);
    run('UPDATE knowledge_entries SET agent_id = NULL WHERE agent_id = ?', [id]);
    run('UPDATE knowledge_entries SET created_by_agent_id = NULL WHERE created_by_agent_id = ?', [id]);
    run('UPDATE milestones SET coordinator_agent_id = NULL WHERE coordinator_agent_id = ?', [id]);
    run('UPDATE acp_bindings SET agent_id = NULL WHERE agent_id = ?', [id]);

    // Now delete the agent
    run('DELETE FROM agents WHERE id = ?', [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete agent:', error);
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}
