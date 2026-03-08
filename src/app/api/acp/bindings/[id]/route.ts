import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';

export const dynamic = 'force-dynamic';

type UpdateBindingBody = {
  status?: unknown;
  acp_session_key?: unknown;
  task_id?: unknown;
};

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();
    const binding = db.prepare('SELECT * FROM acp_bindings WHERE id = ?').get(id);

    if (!binding) {
      return NextResponse.json({ error: 'Binding not found' }, { status: 404 });
    }

    return NextResponse.json(binding);
  } catch (error) {
    console.error('Failed to fetch ACP binding:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json()) as UpdateBindingBody;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM acp_bindings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Binding not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !['active', 'paused', 'closed'].includes(body.status)) {
        return NextResponse.json({ error: 'status must be one of: active, paused, closed' }, { status: 400 });
      }
      updates.push('status = ?');
      values.push(body.status);
    }

    if (body.acp_session_key !== undefined) {
      if (typeof body.acp_session_key !== 'string' || body.acp_session_key.trim().length === 0) {
        return NextResponse.json({ error: 'acp_session_key must be a non-empty string' }, { status: 400 });
      }
      updates.push('acp_session_key = ?');
      values.push(body.acp_session_key.trim());
    }

    if (body.task_id !== undefined) {
      if (body.task_id !== null && (typeof body.task_id !== 'string' || body.task_id.trim().length === 0)) {
        return NextResponse.json({ error: 'task_id must be a non-empty string or null' }, { status: 400 });
      }
      updates.push('task_id = ?');
      values.push(typeof body.task_id === 'string' ? body.task_id.trim() : null);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    db.prepare(`UPDATE acp_bindings SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM acp_bindings WHERE id = ?').get(id);

    if (body.status === 'closed') {
      broadcast({
        type: 'acp_binding_closed',
        payload: updated,
      } as any);
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update ACP binding:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM acp_bindings WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Binding not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM acp_bindings WHERE id = ?').run(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete ACP binding:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
