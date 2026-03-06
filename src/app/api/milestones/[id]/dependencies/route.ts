import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { CreateMilestoneDependencySchema } from '@/lib/validation';
import type { MilestoneDependency } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
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

    const dependencies = db.prepare(
      'SELECT * FROM milestone_dependencies WHERE milestone_id = ?'
    ).all(id) as MilestoneDependency[];

    return NextResponse.json(dependencies);
  } catch (error) {
    console.error('Failed to fetch milestone dependencies:', error);
    return NextResponse.json({ error: 'Failed to fetch milestone dependencies' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const validation = CreateMilestoneDependencySchema.safeParse(body);

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

    // Reject self-dependency
    if (data.depends_on_milestone_id === id) {
      return NextResponse.json({ error: 'A milestone cannot depend on itself' }, { status: 400 });
    }

    // Check for duplicate
    const duplicate = db.prepare(
      `SELECT id FROM milestone_dependencies
       WHERE milestone_id = ?
       AND depends_on_milestone_id IS ?
       AND depends_on_task_id IS ?`
    ).get(id, data.depends_on_milestone_id ?? null, data.depends_on_task_id ?? null) as { id: string } | undefined;

    if (duplicate) {
      return NextResponse.json({ error: 'Dependency already exists' }, { status: 409 });
    }

    const depId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO milestone_dependencies (id, milestone_id, depends_on_milestone_id, depends_on_task_id, dependency_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      depId,
      id,
      data.depends_on_milestone_id ?? null,
      data.depends_on_task_id ?? null,
      data.dependency_type
    );

    const dependency = db.prepare('SELECT * FROM milestone_dependencies WHERE id = ?').get(depId) as MilestoneDependency | undefined;
    return NextResponse.json(dependency, { status: 201 });
  } catch (error) {
    console.error('Failed to create milestone dependency:', error);
    return NextResponse.json({ error: 'Failed to create milestone dependency' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const dependsOnMilestoneId = request.nextUrl.searchParams.get('depends_on_milestone_id');
    const dependsOnTaskId = request.nextUrl.searchParams.get('depends_on_task_id');

    if (!dependsOnMilestoneId && !dependsOnTaskId) {
      return NextResponse.json(
        { error: 'depends_on_milestone_id or depends_on_task_id query parameter is required' },
        { status: 400 }
      );
    }

    let result;
    if (dependsOnMilestoneId) {
      result = db.prepare(
        'DELETE FROM milestone_dependencies WHERE milestone_id = ? AND depends_on_milestone_id = ?'
      ).run(id, dependsOnMilestoneId);
    } else {
      result = db.prepare(
        'DELETE FROM milestone_dependencies WHERE milestone_id = ? AND depends_on_task_id = ?'
      ).run(id, dependsOnTaskId);
    }

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Dependency not found' }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete milestone dependency:', error);
    return NextResponse.json({ error: 'Failed to delete milestone dependency' }, { status: 500 });
  }
}
