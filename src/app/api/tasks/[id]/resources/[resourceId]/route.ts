import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> }
) {
  const { id, resourceId } = await params;

  try {
    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const result = db.prepare('DELETE FROM task_resources WHERE id = ? AND task_id = ?').run(resourceId, id);
    if (result.changes === 0) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete task resource:', error);
    return NextResponse.json({ error: 'Failed to delete task resource' }, { status: 500 });
  }
}
