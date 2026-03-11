import { NextRequest, NextResponse } from 'next/server';
import { queryAll, queryOne, run } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspaces/[id]/knowledge/[entryId]/links
 * List all linked knowledge entries (bidirectional)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id: workspaceId, entryId } = await params;

  try {
    const entry = queryOne<{ id: string; workspace_id: string }>(
      'SELECT id, workspace_id FROM knowledge_entries WHERE id = ?', [entryId]
    );
    if (!entry || entry.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Knowledge entry not found' }, { status: 404 });
    }

    const links = queryAll<{
      id: string; source_id: string; target_id: string; link_type: string; created_at: string;
      linked_id: string; linked_title: string; linked_category: string;
    }>(`
      SELECT kl.id, kl.source_id, kl.target_id, kl.link_type, kl.created_at,
        ke.id as linked_id, ke.title as linked_title, ke.category as linked_category
      FROM knowledge_links kl
      JOIN knowledge_entries ke ON ke.id = CASE WHEN kl.source_id = ? THEN kl.target_id ELSE kl.source_id END
      WHERE kl.source_id = ? OR kl.target_id = ?
    `, [entryId, entryId, entryId]);

    return NextResponse.json(links.map(link => ({
      id: link.id,
      source_id: link.source_id,
      target_id: link.target_id,
      link_type: link.link_type,
      created_at: link.created_at,
      linked_entry: {
        id: link.linked_id,
        title: link.linked_title,
        category: link.linked_category,
      },
    })));
  } catch (error) {
    console.error('Failed to fetch knowledge links:', error);
    return NextResponse.json({ error: 'Failed to fetch links' }, { status: 500 });
  }
}

/**
 * POST /api/workspaces/[id]/knowledge/[entryId]/links
 * Link this entry to another knowledge entry
 * Body: { target_id: string, link_type?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id: workspaceId, entryId } = await params;

  try {
    const body = await request.json();
    const { target_id, link_type = 'related' } = body;

    if (!target_id || typeof target_id !== 'string') {
      return NextResponse.json({ error: 'target_id is required' }, { status: 400 });
    }

    if (target_id === entryId) {
      return NextResponse.json({ error: 'Cannot link entry to itself' }, { status: 400 });
    }

    const source = queryOne<{ id: string; workspace_id: string }>(
      'SELECT id, workspace_id FROM knowledge_entries WHERE id = ?', [entryId]
    );
    if (!source || source.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Source entry not found' }, { status: 404 });
    }

    const target = queryOne<{ id: string; workspace_id: string }>(
      'SELECT id, workspace_id FROM knowledge_entries WHERE id = ?', [target_id]
    );
    if (!target) {
      return NextResponse.json({ error: 'Target entry not found' }, { status: 404 });
    }

    // Check for existing link (bidirectional)
    const existing = queryOne<{ id: string }>(`
      SELECT id FROM knowledge_links
      WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
    `, [entryId, target_id, target_id, entryId]);

    if (existing) {
      return NextResponse.json({ error: 'Link already exists', id: existing.id }, { status: 409 });
    }

    const id = crypto.randomUUID();
    run(
      `INSERT INTO knowledge_links (id, source_id, target_id, link_type, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [id, entryId, target_id, link_type]
    );

    return NextResponse.json({ id, source_id: entryId, target_id, link_type }, { status: 201 });
  } catch (error) {
    console.error('Failed to create knowledge link:', error);
    return NextResponse.json({ error: 'Failed to create link' }, { status: 500 });
  }
}

/**
 * DELETE /api/workspaces/[id]/knowledge/[entryId]/links
 * Remove a link. Body: { link_id: string }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { entryId } = await params;

  try {
    const body = await request.json();
    const { link_id } = body;

    if (!link_id || typeof link_id !== 'string') {
      return NextResponse.json({ error: 'link_id is required' }, { status: 400 });
    }

    const link = queryOne<{ id: string; source_id: string; target_id: string }>(
      'SELECT id, source_id, target_id FROM knowledge_links WHERE id = ?', [link_id]
    );
    if (!link || (link.source_id !== entryId && link.target_id !== entryId)) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }

    run('DELETE FROM knowledge_links WHERE id = ?', [link_id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete knowledge link:', error);
    return NextResponse.json({ error: 'Failed to delete link' }, { status: 500 });
  }
}
