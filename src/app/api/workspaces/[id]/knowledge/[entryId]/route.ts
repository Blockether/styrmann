import { NextRequest, NextResponse } from 'next/server';
import { queryAll, queryOne, run } from '@/lib/db';
import { deleteKnowledgeVector, upsertKnowledgeVector } from '@/lib/memory-search';
import { syncAgentKnowledgeArtifacts } from '@/lib/openclaw-memory';

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
    deleteKnowledgeVector(entryId);

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
    const routingAgentIds: string[] | null = Array.isArray(body.routing_agent_ids)
      ? Array.from(new Set((body.routing_agent_ids as unknown[])
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
      : null;

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

    if (updates.length === 0 && routingAgentIds === null) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    if (updates.length > 0) {
      values.push(entryId);
      run(
        `UPDATE knowledge_entries SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
      upsertKnowledgeVector(entryId);
    }

    if (routingAgentIds !== null) {
      const previousSelected = queryAll<{ agent_id: string | null }>(
        `SELECT agent_id
         FROM knowledge_routing_decisions
         WHERE knowledge_id = ? AND selected = 1`,
        [entryId],
      )
        .map((row) => row.agent_id)
        .filter((id): id is string => Boolean(id));

      run('UPDATE knowledge_routing_decisions SET selected = 0 WHERE knowledge_id = ?', [entryId]);

      for (const targetAgentId of routingAgentIds) {
        const existingDecision = queryOne<{ id: string }>(
          `SELECT id FROM knowledge_routing_decisions
           WHERE knowledge_id = ? AND agent_id = ?
           LIMIT 1`,
          [entryId, targetAgentId],
        );

        if (existingDecision) {
          run(
            `UPDATE knowledge_routing_decisions
             SET selected = 1, reasons = ?
             WHERE id = ?`,
            [JSON.stringify(['Manual routing override from Knowledge UI.']), existingDecision.id],
          );
        } else {
          run(
            `INSERT INTO knowledge_routing_decisions
             (id, knowledge_id, workspace_id, agent_id, score, selected, reasons, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
              crypto.randomUUID(),
              entryId,
              workspaceId,
              targetAgentId,
              100,
              1,
              JSON.stringify(['Manual routing override from Knowledge UI.']),
            ],
          );
        }
      }

      const agentsToSync = Array.from(new Set([...previousSelected, ...routingAgentIds]));
      for (const targetAgentId of agentsToSync) {
        try {
          await syncAgentKnowledgeArtifacts(targetAgentId);
        } catch (error) {
          console.error(`Failed to sync agent knowledge after routing override (${targetAgentId}):`, error);
        }
      }
    }

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

    const attachments = queryAll<{
      id: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      source_url: string | null;
      created_at: string;
    }>(
      `SELECT id, file_name, mime_type, size_bytes, source_url, created_at
       FROM knowledge_attachments
       WHERE knowledge_id = ?
       ORDER BY created_at DESC`,
      [entryId],
    );

    const routing = queryAll<{
      id: string;
      agent_id: string | null;
      agent_name: string | null;
      agent_role: string | null;
      score: number;
      selected: number;
      reasons: string;
      created_at: string;
    }>(
      `SELECT krd.id, krd.agent_id, a.name as agent_name, a.role as agent_role, krd.score, krd.selected, krd.reasons, krd.created_at
       FROM knowledge_routing_decisions krd
       LEFT JOIN agents a ON a.id = krd.agent_id
       WHERE krd.knowledge_id = ?
       ORDER BY krd.score DESC, krd.created_at DESC`,
      [entryId],
    ).map((row) => {
      let reasons: string[] = [];
      try {
        const parsed = JSON.parse(row.reasons);
        if (Array.isArray(parsed)) {
          reasons = parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        reasons = [];
      }
      return {
        id: row.id,
        agent_id: row.agent_id,
        agent_name: row.agent_name,
        agent_role: row.agent_role,
        score: row.score,
        selected: row.selected === 1,
        reasons,
        created_at: row.created_at,
      };
    });

    return NextResponse.json({
      ...updated,
      tags: updated?.tags ? JSON.parse(updated.tags) : [],
      attachments,
      routing_decisions: routing,
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

    const attachments = queryAll<{
      id: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      source_url: string | null;
      created_at: string;
    }>(
      `SELECT id, file_name, mime_type, size_bytes, source_url, created_at
       FROM knowledge_attachments
       WHERE knowledge_id = ?
       ORDER BY created_at DESC`,
      [entryId],
    );

    const routing = queryAll<{
      id: string;
      agent_id: string | null;
      agent_name: string | null;
      agent_role: string | null;
      score: number;
      selected: number;
      reasons: string;
      created_at: string;
    }>(
      `SELECT krd.id, krd.agent_id, a.name as agent_name, a.role as agent_role, krd.score, krd.selected, krd.reasons, krd.created_at
       FROM knowledge_routing_decisions krd
       LEFT JOIN agents a ON a.id = krd.agent_id
       WHERE krd.knowledge_id = ?
       ORDER BY krd.score DESC, krd.created_at DESC`,
      [entryId],
    ).map((row) => {
      let reasons: string[] = [];
      try {
        const parsed = JSON.parse(row.reasons);
        if (Array.isArray(parsed)) {
          reasons = parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        reasons = [];
      }
      return {
        id: row.id,
        agent_id: row.agent_id,
        agent_name: row.agent_name,
        agent_role: row.agent_role,
        score: row.score,
        selected: row.selected === 1,
        reasons,
        created_at: row.created_at,
      };
    });

    return NextResponse.json({
      ...entry,
      tags: entry.tags ? JSON.parse(entry.tags) : [],
      attachments,
      routing_decisions: routing,
    });
  } catch (error) {
    console.error('Failed to fetch knowledge entry:', error);
    return NextResponse.json({ error: 'Failed to fetch entry' }, { status: 500 });
  }
}
