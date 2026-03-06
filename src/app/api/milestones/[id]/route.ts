import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { UpdateMilestoneSchema } from '@/lib/validation';
import type { Milestone } from '@/lib/types';

type MilestoneWithCoordinatorColumns = Milestone & {
  coordinator_agent_name: string | null;
  coordinator_agent_role: string | null;
};

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();
    const milestone = db.prepare(
      `SELECT m.*,
       (SELECT COALESCE(SUM(effort), 0) FROM tasks WHERE milestone_id = m.id) as story_points,
       a.name as coordinator_agent_name, a.role as coordinator_agent_role
       FROM milestones m
       LEFT JOIN agents a ON m.coordinator_agent_id = a.id
       WHERE m.id = ?`
    ).get(id) as MilestoneWithCoordinatorColumns | undefined;

    if (!milestone) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });
    }

    const { coordinator_agent_name, coordinator_agent_role, ...milestoneBase } = milestone;
    const response = coordinator_agent_name
      ? {
          ...milestoneBase,
          coordinator: {
            id: milestoneBase.coordinator_agent_id ?? null,
            name: coordinator_agent_name,
            role: coordinator_agent_role,
          },
        }
      : milestoneBase;

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to fetch milestone:', error);
    return NextResponse.json({ error: 'Failed to fetch milestone' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const validation = UpdateMilestoneSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const data = validation.data;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM milestones WHERE id = ?').get(id) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }
    if (data.due_date !== undefined) {
      updates.push('due_date = ?');
      values.push(data.due_date);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }
    if (data.coordinator_agent_id !== undefined) {
      updates.push('coordinator_agent_id = ?');
      values.push(data.coordinator_agent_id);
    }
    if (data.sprint_id !== undefined) {
      updates.push('sprint_id = ?');
      values.push(data.sprint_id);
    }
    if (data.priority !== undefined) {
      updates.push('priority = ?');
      values.push(data.priority);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(`UPDATE milestones SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const milestone = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone | undefined;
    return NextResponse.json(milestone);
  } catch (error) {
    console.error('Failed to update milestone:', error);
    return NextResponse.json({ error: 'Failed to update milestone' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const existing = db.prepare('SELECT id FROM milestones WHERE id = ?').get(id) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });
    }

    const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE milestone_id = ?').get(id) as { count: number };
    if (taskCount.count > 0) {
      return NextResponse.json(
        { error: 'Cannot delete milestone with related tasks', taskCount: taskCount.count },
        { status: 400 }
      );
    }

    db.prepare('DELETE FROM milestones WHERE id = ?').run(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete milestone:', error);
    return NextResponse.json({ error: 'Failed to delete milestone' }, { status: 500 });
  }
}
