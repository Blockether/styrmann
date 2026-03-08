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
