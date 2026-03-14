import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { CreateEntityLinkSchema } from '@/lib/validation';
import { getDirectLinks } from '@/lib/db/entity-links';
import type { EntityLink } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/entity-links - List links for an entity
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from_entity_id = searchParams.get('from_entity_id');
    const to_entity_id = searchParams.get('to_entity_id');
    const link_type = searchParams.get('link_type');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!from_entity_id && !to_entity_id) {
      return NextResponse.json(
        { error: 'At least one of from_entity_id or to_entity_id is required' },
        { status: 400 }
      );
    }

    const db = getDb();

    // If we have a single entity_id, use the helper
    if ((from_entity_id && !to_entity_id) || (!from_entity_id && to_entity_id)) {
      const entityId = (from_entity_id || to_entity_id)!;
      const direction = from_entity_id ? 'outgoing' : 'incoming';
      let { links } = getDirectLinks(db, entityId, direction);

      if (link_type) {
        links = links.filter((l: EntityLink) => l.link_type === link_type);
      }

      return NextResponse.json(links);
    }

    // Both provided — filter by specific pair
    let query = 'SELECT * FROM entity_links WHERE from_entity_id = ? AND to_entity_id = ?';
    const params: unknown[] = [from_entity_id, to_entity_id];

    if (link_type) {
      query += ' AND link_type = ?';
      params.push(link_type);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const links = db.prepare(query).all(...params);
    return NextResponse.json(links);
  } catch (error) {
    console.error('Failed to fetch entity links:', error);
    return NextResponse.json({ error: 'Failed to fetch entity links' }, { status: 500 });
  }
}

// POST /api/entity-links - Create a new entity link
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateEntityLinkSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const {
      from_entity_type,
      from_entity_id,
      to_entity_type,
      to_entity_id,
      link_type,
      explanation,
    } = parsed.data;

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO entity_links (
        id, from_entity_type, from_entity_id, to_entity_type, to_entity_id,
        link_type, explanation, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      from_entity_type,
      from_entity_id,
      to_entity_type,
      to_entity_id,
      link_type,
      explanation ?? null,
    );

    // Special: if link_type is 'resolved_by', mark the from memory as resolved
    if (link_type === 'resolved_by') {
      db.prepare("UPDATE memories SET status = 'resolved', updated_at = datetime('now') WHERE id = ?").run(from_entity_id);
    }

    const link = db.prepare('SELECT * FROM entity_links WHERE id = ?').get(id) as EntityLink;

    broadcast({ type: 'entity_linked', payload: link as unknown as EntityLink });

    return NextResponse.json(link, { status: 201 });
  } catch (error) {
    console.error('Failed to create entity link:', error);
    return NextResponse.json({ error: 'Failed to create entity link' }, { status: 500 });
  }
}
