import { NextRequest, NextResponse } from 'next/server';
import { queryAll, queryOne, run, getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/[id]/roles
 * List role assignments for a task
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  try {
    const roles = queryAll<{
      id: string; task_id: string; role: string; agent_id: string;
      created_at: string; agent_name: string;
    }>(
      `SELECT tr.*, a.name as agent_name
       FROM task_roles tr
       JOIN agents a ON tr.agent_id = a.id
       WHERE tr.task_id = ?
       ORDER BY tr.created_at ASC`,
      [taskId]
    );

    return NextResponse.json(roles);
  } catch (error) {
    console.error('Failed to fetch task roles:', error);
    return NextResponse.json({ error: 'Failed to fetch roles' }, { status: 500 });
  }
}

/**
 * PUT /api/tasks/[id]/roles
 * Assign roles for a task (replaces all existing role assignments)
 * Body: { roles: [{ role: "builder", agent_id: "..." }, ...] }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  try {
    const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Task role assignments are orchestrator-managed and cannot be edited manually.' },
      { status: 403 },
    );
  } catch (error) {
    console.error('Failed to update task roles:', error);
    return NextResponse.json({ error: 'Failed to update roles' }, { status: 500 });
  }
}
