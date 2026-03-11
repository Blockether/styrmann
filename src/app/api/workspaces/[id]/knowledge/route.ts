import { NextRequest, NextResponse } from 'next/server';
import { queryAll, run } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspaces/[id]/knowledge
 * Query knowledge entries for a workspace
 * Supports query params: category, tags, limit
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workspaceId } = await params;
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const agentId = searchParams.get('agent_id');
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  try {
    let sql = 'SELECT * FROM knowledge_entries WHERE workspace_id = ?';
    const sqlParams: unknown[] = [workspaceId];

    if (category) {
      sql += ' AND category = ?';
      sqlParams.push(category);
    }

    if (agentId) {
      sql += ` AND (
        agent_id = ?
        OR EXISTS (
          SELECT 1 FROM knowledge_routing_decisions krd
          WHERE krd.knowledge_id = knowledge_entries.id
            AND krd.agent_id = ?
            AND krd.selected = 1
        )
      )`;
      sqlParams.push(agentId, agentId);
    }

    sql += ' ORDER BY confidence DESC, created_at DESC LIMIT ?';
    sqlParams.push(limit);

    const entries = queryAll<{
      id: string; workspace_id: string; task_id: string; category: string;
      title: string; content: string; tags: string; confidence: number;
      created_by_agent_id: string; created_at: string;
    }>(sql, sqlParams);

    const entryIds = entries.map((entry) => entry.id);

    const placeholders = entryIds.map(() => '?').join(', ');
    const attachments = entryIds.length > 0
      ? queryAll<{
          id: string;
          knowledge_id: string;
          file_name: string;
          mime_type: string | null;
          size_bytes: number | null;
          source_url: string | null;
          created_at: string;
        }>(
          `SELECT id, knowledge_id, file_name, mime_type, size_bytes, source_url, created_at
           FROM knowledge_attachments
           WHERE knowledge_id IN (${placeholders})
           ORDER BY created_at DESC`,
          entryIds,
        )
      : [];

    const routingDecisions = entryIds.length > 0
      ? queryAll<{
          id: string;
          knowledge_id: string;
          agent_id: string | null;
          agent_name: string | null;
          agent_role: string | null;
          score: number;
          selected: number;
          reasons: string;
          created_at: string;
        }>(
          `SELECT krd.id, krd.knowledge_id, krd.agent_id, a.name as agent_name, a.role as agent_role, krd.score, krd.selected, krd.reasons, krd.created_at
           FROM knowledge_routing_decisions krd
           LEFT JOIN agents a ON a.id = krd.agent_id
           WHERE knowledge_id IN (${placeholders})
           ORDER BY krd.score DESC, krd.created_at DESC`,
          entryIds,
        )
      : [];

    const attachmentsByEntry = attachments.reduce<Record<string, Array<{
      id: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      source_url: string | null;
      created_at: string;
    }>>>((acc, attachment) => {
      if (!acc[attachment.knowledge_id]) acc[attachment.knowledge_id] = [];
      acc[attachment.knowledge_id].push({
        id: attachment.id,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
        source_url: attachment.source_url,
        created_at: attachment.created_at,
      });
      return acc;
    }, {});

    const routingByEntry = routingDecisions.reduce<Record<string, Array<{
      id: string;
      agent_id: string | null;
      agent_name: string | null;
      agent_role: string | null;
      score: number;
      selected: boolean;
      reasons: string[];
      created_at: string;
    }>>>((acc, decision) => {
      if (!acc[decision.knowledge_id]) acc[decision.knowledge_id] = [];
      let reasons: string[] = [];
      try {
        const parsed = JSON.parse(decision.reasons);
        if (Array.isArray(parsed)) {
          reasons = parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        reasons = [];
      }
      acc[decision.knowledge_id].push({
        id: decision.id,
        agent_id: decision.agent_id,
        agent_name: decision.agent_name,
        agent_role: decision.agent_role,
        score: decision.score,
        selected: decision.selected === 1,
        reasons,
        created_at: decision.created_at,
      });
      return acc;
    }, {});

    const parsed = entries.map(e => ({
      ...e,
      tags: e.tags ? JSON.parse(e.tags) : [],
      attachments: attachmentsByEntry[e.id] || [],
      routing_decisions: routingByEntry[e.id] || [],
    }));

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Failed to fetch knowledge entries:', error);
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }
}

/**
 * POST /api/workspaces/[id]/knowledge
 * Create a knowledge entry (used by Learner agent)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workspaceId } = await params;

  try {
    const body = await request.json();
    const { task_id, agent_id, category, title, content, tags, confidence, created_by_agent_id } = body;

    if (!category || !title || !content) {
      return NextResponse.json(
        { error: 'category, title, and content are required' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();

    run(
      `INSERT INTO knowledge_entries (id, workspace_id, task_id, agent_id, category, title, content, tags, confidence, created_by_agent_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        id, workspaceId, task_id || null, agent_id || null, category, title, content,
        tags ? JSON.stringify(tags) : null,
        confidence ?? 0.5,
        created_by_agent_id || null
      ]
    );

    const routingDecisions: Array<{
      agent_id: string;
      score: number;
      selected: boolean;
      reasons: string[];
    }> = [];

    const selectedDecisions = routingDecisions.filter((decision) => decision.selected);
    const finalSelectedDecisions = selectedDecisions.length > 0
      ? selectedDecisions
      : (routingDecisions.length > 0
        ? [{ ...routingDecisions[0], selected: true }]
        : []);
    const targetAgentIds = agent_id
      ? [agent_id]
      : finalSelectedDecisions.map((decision) => decision.agent_id);

    if (!agent_id && routingDecisions.length > 0) {
      for (const decision of routingDecisions) {
        const overridden = finalSelectedDecisions.some((selected) => selected.agent_id === decision.agent_id);
        run(
          `INSERT INTO knowledge_routing_decisions (id, knowledge_id, workspace_id, agent_id, score, selected, reasons, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            crypto.randomUUID(),
            id,
            workspaceId,
            decision.agent_id,
            decision.score,
            overridden ? 1 : 0,
            JSON.stringify(decision.reasons || []),
          ],
        );
      }
    }

    if (agent_id) {
      run(
        `INSERT INTO knowledge_routing_decisions (id, knowledge_id, workspace_id, agent_id, score, selected, reasons, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          crypto.randomUUID(),
          id,
          workspaceId,
          agent_id,
          100,
          1,
          JSON.stringify(['Entry explicitly targeted this agent via agent_id.']),
        ],
      );
    }

    const syncResults: Array<{
      agent_id: string;
      memory_sync: { updated: boolean; reason?: string; entryCount?: number } | null;
      soul_sync: { updated: boolean; reason?: string; entryCount?: number } | null;
      agents_sync: { updated: boolean; reason?: string; entryCount?: number } | null;
      user_sync: { updated: boolean; reason?: string; entryCount?: number } | null;
    }> = [];

    for (const targetAgentId of targetAgentIds) {
      let memorySync: { updated: boolean; reason?: string; entryCount?: number } | null = null;
      let soulSync: { updated: boolean; reason?: string; entryCount?: number } | null = null;
      let agentsSync: { updated: boolean; reason?: string; entryCount?: number } | null = null;
      let userSync: { updated: boolean; reason?: string; entryCount?: number } | null = null;

      syncResults.push({
        agent_id: targetAgentId,
        memory_sync: memorySync,
        soul_sync: soulSync,
        agents_sync: agentsSync,
        user_sync: userSync,
      });
    }

    return NextResponse.json({
      id,
      message: 'Knowledge entry created',
      routed_agent_ids: targetAgentIds,
      routing_decisions: finalSelectedDecisions,
      sync_results: syncResults,
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to create knowledge entry:', error);
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
}
