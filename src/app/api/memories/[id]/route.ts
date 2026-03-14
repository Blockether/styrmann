import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { Memory } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/memories/[id] - Single memory with linked entity_links
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory | undefined;
    if (!memory) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    }

    // Fetch outgoing and incoming entity links
    const outgoing_links = db.prepare(
      'SELECT * FROM entity_links WHERE from_entity_id = ? ORDER BY created_at DESC'
    ).all(id);
    const incoming_links = db.prepare(
      'SELECT * FROM entity_links WHERE to_entity_id = ? ORDER BY created_at DESC'
    ).all(id);

    const result = {
      ...memory,
      metadata: JSON.parse(memory.metadata || '{}'),
      tags: JSON.parse(memory.tags || '[]'),
      outgoing_links,
      incoming_links,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch memory:', error);
    return NextResponse.json({ error: 'Failed to fetch memory' }, { status: 500 });
  }
}

// PATCH /api/memories/[id] - Update memory fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const db = getDb();

    const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.title !== undefined) {
      updates.push('title = ?');
      values.push(body.title);
    }
    if (body.summary !== undefined) {
      updates.push('summary = ?');
      values.push(body.summary);
    }
    if (body.body !== undefined) {
      updates.push('body = ?');
      values.push(body.body);
    }
    if (body.status !== undefined) {
      updates.push('status = ?');
      values.push(body.status);
    }
    if (body.tags !== undefined) {
      updates.push('tags = ?');
      values.push(JSON.stringify(body.tags));
    }
    if (body.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(body.metadata));
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE memories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory;
    const result = {
      ...memory,
      metadata: JSON.parse(memory.metadata || '{}'),
      tags: JSON.parse(memory.tags || '[]'),
    };

    broadcast({ type: 'memory_updated', payload: result as unknown as Memory });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to update memory:', error);
    return NextResponse.json({ error: 'Failed to update memory' }, { status: 500 });
  }
}

// DELETE /api/memories/[id] - Delete memory (CASCADE on FTS triggers handles cleanup)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(id) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM memories WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete memory:', error);
    return NextResponse.json({ error: 'Failed to delete memory' }, { status: 500 });
  }
}
