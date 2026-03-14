import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { dispatchTaskToAgent } from '@/lib/dispatch';
import type { Agent, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/system/repair - Create a repair task and dispatch to agent "main"
 *
 * Finds the "main" agent (or first orchestrator), creates a repair task
 * with the provided prompt, assigns it, and dispatches immediately.
 *
 * Body: { check_name: string, repair_prompt: string, workspace_id?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { check_name, repair_prompt, workspace_id = 'default' } = body;

    if (!check_name || !repair_prompt) {
      return NextResponse.json(
        { error: 'check_name and repair_prompt are required' },
        { status: 400 },
      );
    }

    // Find the "main" agent — try by name first, then fall back to first orchestrator
    let agent = queryOne<Agent>(
      'SELECT * FROM agents WHERE name = ? AND status != ?',
      ['main', 'offline'],
    );

    if (!agent) {
      agent = queryOne<Agent>(
        `SELECT * FROM agents WHERE role = 'orchestrator' AND status != 'offline' ORDER BY created_at ASC LIMIT 1`,
      );
    }

    if (!agent) {
      // Last resort: any non-offline agent
      agent = queryOne<Agent>(
        `SELECT * FROM agents WHERE status != 'offline' ORDER BY created_at ASC LIMIT 1`,
      );
    }

    if (!agent) {
      return NextResponse.json(
        { error: 'No available agent found to handle repair. Ensure at least one agent is online.' },
        { status: 503 },
      );
    }

    // Create the repair task
    const taskId = uuidv4();
    const now = new Date().toISOString();

     run(
       `INSERT INTO tasks (id, title, description, status, priority, task_type, assigned_agent_id, workspace_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
       [
         taskId,
         `System Repair: ${check_name}`,
         repair_prompt,
         'assigned',
         'high',
         'chore',
         agent.id,
         workspace_id,
         now,
         now,
       ],
     );

    // Log event
    run(
      `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), 'task_created', null, taskId, `System repair task created: ${check_name}`, now],
    );

    // Broadcast task creation
    const task = queryOne<Task>(
      `SELECT t.*, a.name as assigned_agent_name
       FROM tasks t
       LEFT JOIN agents a ON t.assigned_agent_id = a.id
       WHERE t.id = ?`,
      [taskId],
    );

    if (task) {
      broadcast({ type: 'task_created', payload: task });
    }

    // Dispatch immediately to the agent
    const dispatchResult = await dispatchTaskToAgent(taskId);

    return NextResponse.json({
      success: dispatchResult.success,
      task_id: taskId,
      agent_id: agent.id,
      agent_name: agent.name,
      dispatch_result: {
        success: dispatchResult.success,
        error: dispatchResult.error,
        session_id: dispatchResult.sessionId,
      },
    }, { status: dispatchResult.success ? 201 : 207 });
  } catch (error) {
    console.error('Repair task creation failed:', error);
    return NextResponse.json(
      { error: 'Failed to create repair task', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
