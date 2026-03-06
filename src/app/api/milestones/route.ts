import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { CreateMilestoneSchema } from '@/lib/validation';
import type { Milestone } from '@/lib/types';

type MilestoneWithCoordinatorColumns = Milestone & {
  coordinator_agent_name: string | null;
  coordinator_agent_role: string | null;
};

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const status = request.nextUrl.searchParams.get('status');
  const sprintId = request.nextUrl.searchParams.get('sprint_id');

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }

  if (status && status !== 'open' && status !== 'closed') {
    return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
  }

  try {
    const db = getDb();

    let sql = `SELECT m.*,
      (SELECT COALESCE(SUM(effort), 0) FROM tasks WHERE milestone_id = m.id) as story_points,
      a.name as coordinator_agent_name, a.role as coordinator_agent_role
      FROM milestones m
      LEFT JOIN agents a ON m.coordinator_agent_id = a.id
      WHERE m.workspace_id = ?`;
    const values: unknown[] = [workspaceId];

    if (status) {
      sql += ' AND m.status = ?';
      values.push(status);
    }

    if (sprintId) {
      sql += ' AND m.sprint_id = ?';
      values.push(sprintId);
    }

    sql += ' ORDER BY m.created_at DESC';

    const milestones = db.prepare(sql).all(...values) as MilestoneWithCoordinatorColumns[];
    const response = milestones.map((milestone) => {
      const { coordinator_agent_name, coordinator_agent_role, ...milestoneBase } = milestone;
      if (!coordinator_agent_name) {
        return milestoneBase;
      }

      return {
        ...milestoneBase,
        coordinator: {
          id: milestoneBase.coordinator_agent_id ?? null,
          name: coordinator_agent_name,
          role: coordinator_agent_role,
        },
      };
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to fetch milestones:', error);
    return NextResponse.json({ error: 'Failed to fetch milestones' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = CreateMilestoneSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const data = validation.data;
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const coordinatorAgentId = data.coordinator_agent_id ?? null;
    const sprintId = data.sprint_id ?? null;
    const priority = data.priority ?? null;

    db.prepare(`
      INSERT INTO milestones (id, workspace_id, sprint_id, name, description, due_date, coordinator_agent_id, priority, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.workspace_id,
      sprintId,
      data.name,
      data.description || null,
      data.due_date || null,
      coordinatorAgentId,
      priority,
      'open',
      now,
      now
    );

    const milestone = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone | undefined;
    return NextResponse.json(milestone, { status: 201 });
  } catch (error) {
    console.error('Failed to create milestone:', error);
    return NextResponse.json({ error: 'Failed to create milestone' }, { status: 500 });
  }
}
