import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { CreateMemorySchema } from '@/lib/validation';
import type { Memory } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/memories - List memories with optional filters and FTS5 search
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organization_id = searchParams.get('organization_id');
    const workspace_id = searchParams.get('workspace_id');
    const memory_type = searchParams.get('memory_type');
    const search = searchParams.get('search');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    const db = getDb();

    if (search) {
      // FTS5 search — escape double-quotes to prevent injection
      const safeQuery = search.replace(/"/g, ' ').trim();
      if (!safeQuery) {
        return NextResponse.json([]);
      }

      let query = `
        SELECT m.*, bm25(memories_fts) as rank
        FROM memories_fts
        JOIN memories m ON m.rowid = memories_fts.rowid
        WHERE memories_fts MATCH ?
      `;
      const params: unknown[] = [`"${safeQuery}"`];

      if (organization_id) {
        query += ' AND m.organization_id = ?';
        params.push(organization_id);
      }
      if (workspace_id) {
        query += ' AND m.workspace_id = ?';
        params.push(workspace_id);
      }
      if (memory_type) {
        query += ' AND m.memory_type = ?';
        params.push(memory_type);
      }

      query += ' ORDER BY rank LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const memories = db.prepare(query).all(...params) as (Memory & { rank: number })[];
      const result = memories.map(m => ({
        ...m,
        metadata: JSON.parse(m.metadata || '{}'),
        tags: JSON.parse(m.tags || '[]'),
      }));

      return NextResponse.json(result);
    }

    // Standard filtered listing
    let query = 'SELECT * FROM memories WHERE 1=1';
    const params: unknown[] = [];

    if (organization_id) {
      query += ' AND organization_id = ?';
      params.push(organization_id);
    }
    if (workspace_id) {
      query += ' AND workspace_id = ?';
      params.push(workspace_id);
    }
    if (memory_type) {
      query += ' AND memory_type = ?';
      params.push(memory_type);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const memories = db.prepare(query).all(...params) as Memory[];
    const result = memories.map(m => ({
      ...m,
      metadata: JSON.parse(m.metadata || '{}'),
      tags: JSON.parse(m.tags || '[]'),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch memories:', error);
    return NextResponse.json({ error: 'Failed to fetch memories' }, { status: 500 });
  }
}

// POST /api/memories - Create a new memory
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateMemorySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const {
      organization_id,
      workspace_id,
      memory_type,
      title,
      summary,
      body: memoryBody,
      source,
      source_ref,
      confidence,
      tags,
      metadata,
    } = parsed.data;

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO memories (
        id, organization_id, workspace_id, memory_type, title, summary, body,
        source, source_ref, confidence, status, metadata, tags, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, datetime('now'), datetime('now'))
    `).run(
      id,
      organization_id ?? null,
      workspace_id ?? null,
      memory_type,
      title,
      summary ?? null,
      memoryBody ?? null,
      source ?? null,
      source_ref ?? null,
      confidence ?? null,
      JSON.stringify(metadata),
      JSON.stringify(tags),
    );

    if (organization_id) {
      db.prepare(`
        UPDATE knowledge_articles 
        SET status = 'stale', updated_at = datetime('now')
        WHERE organization_id = ? AND status = 'published'
      `).run(organization_id);
    }

    const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory;
    const result = {
      ...memory,
      metadata: JSON.parse(memory.metadata || '{}'),
      tags: JSON.parse(memory.tags || '[]'),
    };

    broadcast({ type: 'memory_created', payload: result as unknown as Memory });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Failed to create memory:', error);
    return NextResponse.json({ error: 'Failed to create memory' }, { status: 500 });
  }
}
