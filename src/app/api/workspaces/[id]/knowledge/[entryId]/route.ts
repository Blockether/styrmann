import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/workspaces/[id]/knowledge/[entryId]
 * Remove a knowledge entry from the workspace knowledge base.
 *
 * Used by agents and learner workflows to clean up obsolete or incorrect entries.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id: workspaceId, entryId } = await params;

  try {
    // Verify entry exists and belongs to this workspace
    const entry = queryOne<{ id: string; workspace_id: string }>(
      'SELECT id, workspace_id FROM knowledge_entries WHERE id = ?',
      [entryId]
    );

    if (!entry) {
      return NextResponse.json({ error: 'Knowledge entry not found' }, { status: 404 });
    }

    if (entry.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Knowledge entry not found in this workspace' }, { status: 404 });
    }

    // Delete the entry
    run('DELETE FROM knowledge_entries WHERE id = ?', [entryId]);

    return NextResponse.json({ message: 'Knowledge entry deleted' });
  } catch (error) {
    console.error('Failed to delete knowledge entry:', error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}

/**
 * PATCH /api/workspaces/[id]/knowledge/[entryId]
 * Update a knowledge entry. Supports partial updates.
 *
 * Used by agents to refine knowledge entries after validation.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id: workspaceId, entryId } = await params;

  try {
    // Verify entry exists and belongs to this workspace
    const entry = queryOne<{ id: string; workspace_id: string }>(
      'SELECT id, workspace_id FROM knowledge_entries WHERE id = ?',
      [entryId]
    );

    if (!entry) {
      return NextResponse.json({ error: 'Knowledge entry not found' }, { status: 404 });
    }

    if (entry.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Knowledge entry not found in this workspace' }, { status: 404 });
    }

    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];

    // Build dynamic update query based on provided fields
    if (body.category !== undefined) {
      updates.push('category = ?');
      values.push(body.category);
    }
    if (body.title !== undefined) {
      updates.push('title = ?');
      values.push(body.title);
    }
    if (body.content !== undefined) {
      updates.push('content = ?');
      values.push(body.content);
    }
    if (body.tags !== undefined) {
      updates.push('tags = ?');
      values.push(JSON.stringify(body.tags));
    }
    if (body.confidence !== undefined) {
      updates.push('confidence = ?');
      values.push(body.confidence);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    values.push(entryId);
    run(
      `UPDATE knowledge_entries SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // Return the updated entry
    const updated = queryOne<{
      id: string;
      workspace_id: string;
      task_id: string;
      category: string;
      title: string;
      content: string;
      tags: string;
      confidence: number;
      created_by_agent_id: string;
      created_at: string;
    }>(
      'SELECT * FROM knowledge_entries WHERE id = ?',
      [entryId]
    );

    return NextResponse.json({
      ...updated,
      tags: updated?.tags ? JSON.parse(updated.tags) : [],
    });
  } catch (error) {
    console.error('Failed to update knowledge entry:', error);
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
  }
}

/**
 * GET /api/workspaces/[id]/knowledge/[entryId]
 * Fetch a single knowledge entry by ID.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id: workspaceId, entryId } = await params;

  try {
    const entry = queryOne<{
      id: string;
      workspace_id: string;
      task_id: string;
      category: string;
      title: string;
      content: string;
      tags: string;
      confidence: number;
      created_by_agent_id: string;
      created_at: string;
    }>(
      'SELECT * FROM knowledge_entries WHERE id = ? AND workspace_id = ?',
      [entryId, workspaceId]
    );

    if (!entry) {
      return NextResponse.json({ error: 'Knowledge entry not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...entry,
      tags: entry.tags ? JSON.parse(entry.tags) : [],
    });
  } catch (error) {
    console.error('Failed to fetch knowledge entry:', error);
    return NextResponse.json({ error: 'Failed to fetch entry' }, { status: 500 });
  }
}
