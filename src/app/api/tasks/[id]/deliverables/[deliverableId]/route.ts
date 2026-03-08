import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { TaskDeliverable } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/[id]/deliverables/[deliverableId]
 * Retrieve a single deliverable by ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; deliverableId: string }> }
) {
  try {
    const { id: taskId, deliverableId } = await params;

    const deliverable = queryOne<TaskDeliverable>(
      'SELECT * FROM task_deliverables WHERE id = ? AND task_id = ?',
      [deliverableId, taskId]
    );

    if (!deliverable) {
      return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
    }

    return NextResponse.json(deliverable);
  } catch (error) {
    console.error('Failed to fetch deliverable:', error);
    return NextResponse.json({ error: 'Failed to fetch deliverable' }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id]/deliverables/[deliverableId]
 * Remove a deliverable from a task
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; deliverableId: string }> }
) {
  try {
    const { id: taskId, deliverableId } = await params;

    // Verify deliverable exists and belongs to this task
    const deliverable = queryOne<TaskDeliverable>(
      'SELECT * FROM task_deliverables WHERE id = ? AND task_id = ?',
      [deliverableId, taskId]
    );

    if (!deliverable) {
      return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
    }

    // Delete the deliverable
    run('DELETE FROM task_deliverables WHERE id = ?', [deliverableId]);

    // Broadcast deletion to SSE clients
    broadcast({
      type: 'deliverable_deleted',
      payload: { id: deliverableId, task_id: taskId },
    });

    return NextResponse.json({ message: 'Deliverable deleted', id: deliverableId });
  } catch (error) {
    console.error('Failed to delete deliverable:', error);
    return NextResponse.json({ error: 'Failed to delete deliverable' }, { status: 500 });
  }
}

/**
 * PATCH /api/tasks/[id]/deliverables/[deliverableId]
 * Update a deliverable. Supports partial updates.
 *
 * Updatable fields: title, description, path
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; deliverableId: string }> }
) {
  try {
    const { id: taskId, deliverableId } = await params;

    // Verify deliverable exists and belongs to this task
    const deliverable = queryOne<TaskDeliverable>(
      'SELECT * FROM task_deliverables WHERE id = ? AND task_id = ?',
      [deliverableId, taskId]
    );

    if (!deliverable) {
      return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
    }

    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];

    // Build dynamic update query based on provided fields
    if (body.title !== undefined) {
      updates.push('title = ?');
      values.push(body.title);
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      values.push(body.description);
    }
    if (body.path !== undefined) {
      updates.push('path = ?');
      values.push(body.path);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    values.push(deliverableId);
    run(
      `UPDATE task_deliverables SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // Return the updated deliverable
    const updated = queryOne<TaskDeliverable>(
      'SELECT * FROM task_deliverables WHERE id = ?',
      [deliverableId]
    );

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update deliverable:', error);
    return NextResponse.json({ error: 'Failed to update deliverable' }, { status: 500 });
  }
}
