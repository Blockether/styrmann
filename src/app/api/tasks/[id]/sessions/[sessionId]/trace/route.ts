import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { queryOne, queryAll, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { InputProvenance, SourceReceipt } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; sessionId: string }> };

type TraceMessage = { role: string; content: string; tool_calls?: { id?: string; name: string; input?: string }[]; tool_result?: string; tool_name?: string; tool_call_id?: string; is_error?: boolean; timestamp?: string; provenance?: InputProvenance | null; receipt?: SourceReceipt | null };
type AutoDeliverableCandidate = { path: string; title: string; sourceTool: string };

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
  const toolCalls: { id?: string; name: string; input?: string }[] = [];
  let toolResult: string | undefined;

  if (Array.isArray(msg.content)) {
    const blocks = msg.content as Array<Record<string, unknown>>;
    const textParts: string[] = [];
    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        textParts.push(String(block.text));
      } else if (block.type === 'tool_use' || block.type === 'toolUse' || block.type === 'toolCall') {
        toolCalls.push({
          id: block.id ? String(block.id) : undefined,
          name: String(block.name || block.toolName || 'unknown'),
          input: block.input || block.arguments
            ? (typeof (block.input || block.arguments) === 'string'
              ? String(block.input || block.arguments)
              : JSON.stringify(block.input || block.arguments, null, 2))
            : undefined,
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
    toolCalls.push({ id: tu.id ? String(tu.id) : undefined, name: String(tu.name || 'unknown'), input: tu.input ? JSON.stringify(tu.input, null, 2) : undefined });
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

  // Extract tool correlation fields from toolResult messages (gateway pi-ai format)
  const toolName = msg.toolName ? String(msg.toolName) : undefined;
  const toolCallId = msg.toolCallId ? String(msg.toolCallId) : undefined;
  const isError = typeof msg.isError === 'boolean' ? msg.isError : undefined;

  return {
    role: String(msg.role || 'unknown'),
    content,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(toolResult ? { tool_result: toolResult } : {}),
    ...(toolName ? { tool_name: toolName } : {}),
    ...(toolCallId ? { tool_call_id: toolCallId } : {}),
    ...(isError !== undefined ? { is_error: isError } : {}),
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

function tableHasColumn(table: string, column: string): boolean {
  try {
    const rows = queryAll<{ name: string }>(`PRAGMA table_info(${table})`);
    return rows.some((row) => row.name === column);
  } catch {
    return false;
  }
}

function parseToolInputObject(input?: string): Record<string, unknown> | null {
  if (!input || input.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
  }
  return null;
}

function isWriteTool(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === 'write'
    || name.endsWith('.write')
    || name.includes('write_file')
    || name.includes('writefile');
}

function extractFilePathFromToolInput(input?: string): string | null {
  const obj = parseToolInputObject(input);
  if (!obj) return null;
  const keys = ['filePath', 'file_path', 'path', 'targetPath', 'target_path', 'filename'];
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function titleFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || filePath;
}

function extractAutoDeliverableCandidates(history: TraceMessage[]): AutoDeliverableCandidate[] {
  const byPath = new Map<string, AutoDeliverableCandidate>();
  for (const msg of history) {
    if (msg.role !== 'assistant' || !msg.tool_calls || msg.tool_calls.length === 0) continue;
    for (const call of msg.tool_calls) {
      if (!isWriteTool(call.name)) continue;
      const filePath = extractFilePathFromToolInput(call.input);
      if (!filePath) continue;
      if (!byPath.has(filePath)) {
        byPath.set(filePath, {
          path: filePath,
          title: titleFromPath(filePath),
          sourceTool: call.name,
        });
      }
    }
  }
  return Array.from(byPath.values());
}

function buildTraceSummary(
  history: TraceMessage[],
  invocation: string | null,
  opts?: {
    fallbackStartedAt?: string | null;
    fallbackEndedAt?: string | null;
    liveWhenActive?: boolean;
    emptyHighlights?: string[];
  },
) {
  const roleCounts = history.reduce<Record<string, number>>((acc, item) => {
    acc[item.role] = (acc[item.role] || 0) + 1;
    return acc;
  }, {});

  const timestamps = history
    .map((item) => item.timestamp)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  const startedAtFromHistory = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null;
  const endedAtFromHistory = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
  const startedAt = startedAtFromHistory || opts?.fallbackStartedAt || null;
  const endedAt = endedAtFromHistory
    || opts?.fallbackEndedAt
    || (opts?.liveWhenActive && startedAt ? new Date().toISOString() : null);
  const durationSeconds = startedAt && endedAt
    ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
    : null;

  const stageMatches = invocation
    ? Array.from(invocation.matchAll(/\*\*([^*\n]{3,120})\*\*/g)).map((match) => match[1].trim())
    : [];

  const stageNoise = /^(title|description|priority|task id|planning specification|your instructions|output directory|important|branch rule|workspace rule)$/i;
  const stageSignal = /(stage|phase|step|review|verify|verification|test|testing|build|dispatch|planning|explore|consolidate|done|in_progress|assigned)/i;
  const stageFlow = Array.from(
    new Set(stageMatches
      .map((item) => item.replace(/[\s:.-]+$/g, '').trim())
      .filter((item) => item.length > 0 && !stageNoise.test(item) && stageSignal.test(item))
      .slice(0, 12)),
  );

  const assistantHighlights = history
    .filter((item) => item.role === 'assistant')
    .map((item) => item.content.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((item) => (item.length > 180 ? `${item.slice(0, 180)}...` : item));
  const highlights = assistantHighlights.length > 0
    ? assistantHighlights
    : (opts?.emptyHighlights || []);

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
      status?: string | null;
      session_type?: string | null;
      channel?: string | null;
      created_at?: string | null;
      ended_at?: string | null;
    }>(
      `SELECT s.id, s.openclaw_session_id, s.task_id, s.status, s.session_type, s.channel, s.created_at, s.ended_at,
              a.name as agent_name, a.session_key_prefix
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
        status?: string | null;
        session_type?: string | null;
        channel?: string | null;
        created_at?: string | null;
        ended_at?: string | null;
      }>(
        `SELECT s.id, s.openclaw_session_id, s.task_id, s.status, s.session_type, s.channel, s.created_at, s.ended_at,
                a.name as agent_name, a.session_key_prefix
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
        if (rawMessages.length > 0) {
          history = rawMessages.map(normalizeMessage);
          resolvedSessionKey = key;
          break;
        }
        // Track first key even if empty (fallback)
        if (!resolvedSessionKey) resolvedSessionKey = key;
      } catch {
        // Key not found in gateway, try next
      }
    }

    const emptyHighlights: string[] = [];
    if (history.length === 0) {
      emptyHighlights.push('No messages were returned from OpenClaw history for this session key.');
      if (!invocation) {
        emptyHighlights.push('No dispatch invocation record exists for this task/session pair.');
      }
      emptyHighlights.push(`Session row exists (${session.status || 'unknown'} / ${session.session_type || 'unknown'}) via ${session.channel || 'unknown'} channel.`);
    }

    // Post-process: correlate toolResult messages with preceding tool_call blocks
    // Build a map of tool_call_id -> tool_name from assistant messages
    const toolCallMap = new Map<string, string>();
    for (const msg of history) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.id) toolCallMap.set(tc.id, tc.name);
        }
      }
    }
    // Backfill tool_name on toolResult messages that don't have it
    for (const msg of history) {
      if ((msg.role === 'toolResult' || msg.role === 'tool') && msg.tool_call_id && !msg.tool_name) {
        const name = toolCallMap.get(msg.tool_call_id);
        if (name) msg.tool_name = name;
      }
    }

    const hasSessionIdColumn = tableHasColumn('task_deliverables', 'openclaw_session_id');
    const autoDeliverableCandidates = extractAutoDeliverableCandidates(history);
    for (const candidate of autoDeliverableCandidates) {
      const existing = hasSessionIdColumn
        ? queryOne<{ id: string }>(
          'SELECT id FROM task_deliverables WHERE task_id = ? AND openclaw_session_id = ? AND path = ? LIMIT 1',
          [taskId, session.openclaw_session_id, candidate.path],
        )
        : queryOne<{ id: string }>(
          'SELECT id FROM task_deliverables WHERE task_id = ? AND path = ? LIMIT 1',
          [taskId, candidate.path],
        );
      if (existing) continue;

      const deliverableId = crypto.randomUUID();
      if (hasSessionIdColumn) {
        run(
          `INSERT INTO task_deliverables
            (id, task_id, deliverable_type, title, path, description, openclaw_session_id)
           VALUES (?, ?, 'file', ?, ?, ?, ?)`,
          [
            deliverableId,
            taskId,
            candidate.title,
            candidate.path,
            `Auto-captured from trace write operation (${candidate.sourceTool})`,
            session.openclaw_session_id,
          ],
        );
      } else {
        run(
          `INSERT INTO task_deliverables
            (id, task_id, deliverable_type, title, path, description)
           VALUES (?, ?, 'file', ?, ?, ?)`,
          [
            deliverableId,
            taskId,
            candidate.title,
            candidate.path,
            `Auto-captured from trace write operation (${candidate.sourceTool})`,
          ],
        );
      }

      const created = queryOne<{
        id: string;
        task_id: string;
        deliverable_type: string;
        title: string;
        path: string | null;
        description: string | null;
        openclaw_session_id?: string | null;
        created_at: string;
      }>('SELECT * FROM task_deliverables WHERE id = ?', [deliverableId]);

      if (created) {
        broadcast({
          type: 'deliverable_added',
          payload: created,
        });
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
      session: {
        id: session.id,
        status: session.status || null,
        session_type: session.session_type || null,
        channel: session.channel || null,
        created_at: session.created_at || null,
        ended_at: session.ended_at || null,
      },
      diagnostics: {
        candidate_session_keys: candidateKeys,
        resolved_session_key: resolvedSessionKey,
        history_source: history.length > 0 ? 'gateway' : 'none',
      },
      invocation,
      summary: buildTraceSummary(history, invocation?.invocation || null, {
        fallbackStartedAt: invocation?.created_at || session.created_at || null,
        fallbackEndedAt: session.ended_at || null,
        liveWhenActive: session.status === 'active',
        emptyHighlights,
      }),
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
