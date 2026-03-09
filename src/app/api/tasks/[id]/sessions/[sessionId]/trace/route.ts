import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { queryOne, queryAll, run } from '@/lib/db';
import type { InputProvenance, SourceReceipt } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; sessionId: string }> };

type TraceMessage = { role: string; content: string; tool_calls?: { name: string; input?: string }[]; tool_result?: string; timestamp?: string; provenance?: InputProvenance | null; receipt?: SourceReceipt | null };

const SOURCE_RECEIPT_RE = /\[Source Receipt\]\n([\s\S]*?)\n\[\/?Source Receipt\]/;

function parseSourceReceipt(content: string): SourceReceipt | null {
  const match = SOURCE_RECEIPT_RE.exec(content);
  if (!match) return null;
  const data: SourceReceipt = {};
  for (const line of match[1].split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      data[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
    }
  }
  return Object.keys(data).length > 0 ? data : null;
}

function extractProvenance(msg: Record<string, unknown>): InputProvenance | null {
  const prov = msg.provenance as Record<string, unknown> | undefined;
  if (!prov || typeof prov !== 'object') return null;
  const kind = String(prov.kind || '');
  if (!['external_user', 'inter_session', 'internal_system'].includes(kind)) return null;
  return {
    kind: kind as InputProvenance['kind'],
    originSessionId: prov.originSessionId ? String(prov.originSessionId) : undefined,
    sourceSessionKey: prov.sourceSessionKey ? String(prov.sourceSessionKey) : undefined,
    sourceChannel: prov.sourceChannel ? String(prov.sourceChannel) : undefined,
    sourceTool: prov.sourceTool ? String(prov.sourceTool) : undefined,
  };
}

function normalizeMessage(raw: unknown): TraceMessage {
  const msg = raw as Record<string, unknown>;
  let content = '';
  const toolCalls: { name: string; input?: string }[] = [];
  let toolResult: string | undefined;

  if (Array.isArray(msg.content)) {
    const blocks = msg.content as Array<Record<string, unknown>>;
    const textParts: string[] = [];
    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        textParts.push(String(block.text));
      } else if (block.type === 'tool_use' || block.type === 'toolUse') {
        toolCalls.push({
          name: String(block.name || block.toolName || 'unknown'),
          input: block.input ? (typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2)) : undefined,
        });
      } else if (block.type === 'tool_result' || block.type === 'toolResult') {
        const resultContent = block.content || block.output || block.text || '';
        toolResult = typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent, null, 2);
      }
    }
    content = textParts.join('\n');
  } else {
    content = String(msg.content || '');
  }

  // Fallback: check top-level tool_use / tool_result fields
  if (msg.tool_use && typeof msg.tool_use === 'object' && toolCalls.length === 0) {
    const tu = msg.tool_use as Record<string, unknown>;
    toolCalls.push({ name: String(tu.name || 'unknown'), input: tu.input ? JSON.stringify(tu.input, null, 2) : undefined });
  }
  if (!toolResult && msg.tool_result) {
    toolResult = typeof msg.tool_result === 'string' ? msg.tool_result : JSON.stringify(msg.tool_result, null, 2);
  }

  const timestamp =
    typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : (msg.timestamp as string | undefined);

  const provenance = extractProvenance(msg);
  const receipt = parseSourceReceipt(content);

  return {
    role: String(msg.role || 'unknown'),
    content,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(toolResult ? { tool_result: toolResult } : {}),
    timestamp,
    provenance,
    receipt,
  };
}

function extractSessionMetadata(taskId: string, sessionId: string): {
  session_id: string;
  session_key: string;
  output_directory: string;
  invocation: string;
  created_at: string;
} | null {
  const invocationRows = queryAll<{ metadata: string; created_at: string }>(
    `SELECT metadata, created_at
     FROM task_activities
     WHERE task_id = ? AND activity_type = 'dispatch_invocation'
     ORDER BY created_at DESC`,
    [taskId],
  );

  return invocationRows
    .map((row) => {
      try {
        const parsed = JSON.parse(row.metadata || '{}') as Record<string, unknown>;
        return {
          created_at: row.created_at,
          session_id: String(parsed.openclaw_session_id || ''),
          session_key: String(parsed.session_key || ''),
          output_directory: String(parsed.output_directory || ''),
          invocation: String(parsed.invocation || ''),
        };
      } catch {
        return null;
      }
    })
    .find((row) => row && row.session_id === sessionId) || null;
}

function buildTraceSummary(history: TraceMessage[], invocation: string | null) {
  const roleCounts = history.reduce<Record<string, number>>((acc, item) => {
    acc[item.role] = (acc[item.role] || 0) + 1;
    return acc;
  }, {});

  const timestamps = history
    .map((item) => item.timestamp)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  const startedAt = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null;
  const endedAt = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
  const durationSeconds = startedAt && endedAt
    ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
    : null;

  const stageMatches = invocation
    ? Array.from(invocation.matchAll(/\*\*([^*\n]{3,120})\*\*/g)).map((match) => match[1].trim())
    : [];

  const stageFlow = Array.from(
    new Set(stageMatches.filter((item) => item.length > 0).slice(0, 12)),
  );

  const highlights = history
    .filter((item) => item.role === 'assistant')
    .map((item) => item.content.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((item) => (item.length > 180 ? `${item.slice(0, 180)}...` : item));

  return {
    message_count: history.length,
    role_counts: roleCounts,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    stage_flow: stageFlow,
    highlights,
  };
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { id: taskId, sessionId: rawSessionId } = await params;
    const sessionId = decodeURIComponent(rawSessionId);

    let session = queryOne<{
      id: string;
      openclaw_session_id: string;
      task_id?: string | null;
      agent_name?: string;
      session_key_prefix?: string;
    }>(
      `SELECT s.id, s.openclaw_session_id, s.task_id, a.name as agent_name, a.session_key_prefix
       FROM openclaw_sessions s
       LEFT JOIN agents a ON s.agent_id = a.id
       WHERE s.task_id = ? AND (s.openclaw_session_id = ? OR s.id = ?)
       LIMIT 1`,
      [taskId, sessionId, sessionId],
    );

    const invocation = extractSessionMetadata(taskId, sessionId);

    if (!session) {
      const bySession = queryOne<{
        id: string;
        openclaw_session_id: string;
        task_id?: string | null;
        agent_name?: string;
        session_key_prefix?: string;
      }>(
        `SELECT s.id, s.openclaw_session_id, s.task_id, a.name as agent_name, a.session_key_prefix
         FROM openclaw_sessions s
         LEFT JOIN agents a ON s.agent_id = a.id
         WHERE s.openclaw_session_id = ? OR s.id = ?
         LIMIT 1`,
        [sessionId, sessionId],
      );

      if (bySession && invocation) {
        if (!bySession.task_id) {
          run('UPDATE openclaw_sessions SET task_id = ?, session_type = ?, updated_at = datetime(\'now\') WHERE id = ?', [taskId, 'subagent', bySession.id]);
        }
        session = {
          ...bySession,
          task_id: taskId,
        };
      }
    }

    if (!session) {
      return NextResponse.json({ error: 'Task session not found' }, { status: 404 });
    }

    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    const candidateKeys = Array.from(
      new Set([
        invocation?.session_key,
        `${session.session_key_prefix || 'agent:main:'}${session.openclaw_session_id}`,
        sessionId,
        session.openclaw_session_id,
      ].filter(Boolean)),
    ) as string[];

    let history: TraceMessage[] = [];
    let resolvedSessionKey: string | null = null;

    for (const key of candidateKeys) {
      try {
        const rawMessages = await client.getSessionHistory(key);
        history = rawMessages.map(normalizeMessage);
        resolvedSessionKey = key;
        break;
      } catch {
      }
    }

    // Extract and store provenance records from history
    const provenanceEntries = history
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => msg.provenance || msg.receipt);

    if (provenanceEntries.length > 0) {
      const existingCount = queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM task_provenance WHERE task_id = ? AND session_id = ?',
        [taskId, session.openclaw_session_id],
      );
      if (!existingCount || existingCount.cnt === 0) {
        for (const { msg, idx } of provenanceEntries) {
          const prov = msg.provenance;
          run(
            `INSERT INTO task_provenance (id, task_id, session_id, kind, origin_session_id, source_session_key, source_channel, source_tool, receipt_text, receipt_data, message_role, message_index)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              crypto.randomUUID(),
              taskId,
              session.openclaw_session_id,
              prov?.kind || 'external_user',
              prov?.originSessionId || msg.receipt?.originSessionId || null,
              prov?.sourceSessionKey || msg.receipt?.targetSession || null,
              prov?.sourceChannel || null,
              prov?.sourceTool || msg.receipt?.bridge || null,
              msg.receipt ? `[Source Receipt]\n${Object.entries(msg.receipt).map(([k, v]) => `${k}=${v}`).join('\n')}\n[/Source Receipt]` : null,
              msg.receipt ? JSON.stringify(msg.receipt) : null,
              msg.role,
              idx,
            ],
          );
        }
      }
    }


    return NextResponse.json({
      task_id: taskId,
      openclaw_session_id: session.openclaw_session_id,
      agent_name: session.agent_name || null,
      session_key: resolvedSessionKey,
      invocation,
      summary: buildTraceSummary(history, invocation?.invocation || null),
      provenance: provenanceEntries.map(({ msg, idx }) => ({
        kind: msg.provenance?.kind || 'external_user',
        origin_session_id: msg.provenance?.originSessionId || msg.receipt?.originSessionId || null,
        source_channel: msg.provenance?.sourceChannel || null,
        source_tool: msg.provenance?.sourceTool || msg.receipt?.bridge || null,
        receipt: msg.receipt || null,
        message_role: msg.role,
        message_index: idx,
      })),
      history,
    });
  } catch (error) {
    console.error('Failed to fetch task session trace:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
