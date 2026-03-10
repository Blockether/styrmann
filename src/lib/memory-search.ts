import { queryAll, queryOne, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';

const VECTOR_DIMENSION = 96;

type KnowledgeEntryRow = {
  id: string;
  workspace_id: string;
  agent_id?: string | null;
  category: string;
  title: string;
  content: string;
  tags?: string | null;
};

type VectorRow = {
  knowledge_id: string;
  workspace_id: string;
  agent_id?: string | null;
  vector_json: string;
  title: string;
  content: string;
  category: string;
  tags?: string | null;
  confidence: number;
  created_at: string;
};

function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2)
    .slice(0, 800);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

export function buildVectorFromText(text: string): number[] {
  const vector = new Array<number>(VECTOR_DIMENSION).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const index = hashToken(token) % VECTOR_DIMENSION;
    vector[index] += 1;
  }
  return normalize(vector);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

function buildEntryText(entry: KnowledgeEntryRow): string {
  const tags = parseTags(entry.tags).join(' ');
  return `${entry.category} ${entry.title} ${entry.content} ${tags}`;
}

export function upsertKnowledgeVector(knowledgeId: string): { updated: boolean; reason?: string } {
  const entry = queryOne<KnowledgeEntryRow>(
    `SELECT id, workspace_id, agent_id, category, title, content, tags
     FROM knowledge_entries WHERE id = ? LIMIT 1`,
    [knowledgeId],
  );
  if (!entry) return { updated: false, reason: 'knowledge_not_found' };

  const vector = buildVectorFromText(buildEntryText(entry));
  run(
    `INSERT INTO knowledge_vectors (knowledge_id, workspace_id, agent_id, model, dimension, vector_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(knowledge_id) DO UPDATE SET
       workspace_id = excluded.workspace_id,
       agent_id = excluded.agent_id,
       model = excluded.model,
       dimension = excluded.dimension,
       vector_json = excluded.vector_json,
       updated_at = excluded.updated_at`,
    [entry.id, entry.workspace_id, entry.agent_id || null, 'hash96-v1', VECTOR_DIMENSION, JSON.stringify(vector)],
  );

  return { updated: true };
}

export function deleteKnowledgeVector(knowledgeId: string): void {
  run('DELETE FROM knowledge_vectors WHERE knowledge_id = ?', [knowledgeId]);
}

export function semanticSearchKnowledge(query: string, opts: {
  workspaceId?: string;
  agentId?: string;
  limit?: number;
}): Array<{
  knowledge_id: string;
  score: number;
  workspace_id: string;
  agent_id?: string | null;
  category: string;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  created_at: string;
}> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.workspaceId) {
    where.push('(kv.workspace_id = ? OR kv.workspace_id = ?)');
    params.push(opts.workspaceId, 'default');
  }
  if (opts.agentId) {
    where.push('(kv.agent_id = ? OR kv.agent_id IS NULL)');
    params.push(opts.agentId);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = queryAll<VectorRow>(
    `SELECT kv.knowledge_id, kv.workspace_id, kv.agent_id, kv.vector_json,
            ke.title, ke.content, ke.category, ke.tags, ke.confidence, ke.created_at
     FROM knowledge_vectors kv
     JOIN knowledge_entries ke ON ke.id = kv.knowledge_id
     ${whereSql}
     ORDER BY ke.confidence DESC, ke.created_at DESC
     LIMIT 1000`,
    params,
  );

  const queryVector = buildVectorFromText(query);
  const ranked = rows
    .map((row) => {
      let vector: number[] = [];
      try {
        vector = JSON.parse(row.vector_json) as number[];
      } catch {
        vector = [];
      }
      return {
        knowledge_id: row.knowledge_id,
        score: cosineSimilarity(queryVector, vector),
        workspace_id: row.workspace_id,
        agent_id: row.agent_id,
        category: row.category,
        title: row.title,
        content: row.content,
        tags: parseTags(row.tags),
        confidence: row.confidence,
        created_at: row.created_at,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit || 12);

  return ranked;
}

async function searchViaOpenClaw(query: string, opts: { workspaceId?: string; agentId?: string; limit?: number }) {
  const client = getOpenClawClient();
  if (!client.isConnected()) {
    await client.connect();
  }

  const methods = ['memory.search', 'memory.query', 'search.memory'];
  for (const method of methods) {
    try {
      const result = await client.call<unknown>(method, {
        query,
        workspaceId: opts.workspaceId,
        agentId: opts.agentId,
        limit: opts.limit || 12,
      });

      const records = Array.isArray(result)
        ? result
        : (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).results)
          ? ((result as Record<string, unknown>).results as unknown[])
          : []);

      const normalized = records.map((record, index) => {
        const item = record as Record<string, unknown>;
        return {
          knowledge_id: String(item.id || item.knowledge_id || `openclaw-${index}`),
          score: typeof item.score === 'number' ? item.score : 0,
          workspace_id: String(item.workspace_id || opts.workspaceId || 'default'),
          agent_id: item.agent_id ? String(item.agent_id) : null,
          category: String(item.category || 'memory'),
          title: String(item.title || item.summary || 'OpenClaw memory result'),
          content: String(item.content || item.text || ''),
          tags: Array.isArray(item.tags) ? item.tags.filter((x): x is string => typeof x === 'string') : [],
          confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
          created_at: String(item.created_at || new Date().toISOString()),
          source: 'openclaw' as const,
        };
      });

      if (normalized.length > 0) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return [] as Array<{
    knowledge_id: string;
    score: number;
    workspace_id: string;
    agent_id?: string | null;
    category: string;
    title: string;
    content: string;
    tags: string[];
    confidence: number;
    created_at: string;
    source: 'openclaw';
  }>;
}

export async function semanticSearchMemory(query: string, opts: {
  workspaceId?: string;
  agentId?: string;
  limit?: number;
}): Promise<Array<{
  knowledge_id: string;
  score: number;
  workspace_id: string;
  agent_id?: string | null;
  category: string;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  created_at: string;
  source: 'openclaw' | 'mission-control';
}>> {
  try {
    const openClawResults = await searchViaOpenClaw(query, opts);
    if (openClawResults.length > 0) {
      return openClawResults;
    }
  } catch {}

  return semanticSearchKnowledge(query, opts).map((item) => ({ ...item, source: 'mission-control' as const }));
}

export function rebuildKnowledgeVectors(workspaceId?: string): { indexed: number } {
  const entries = workspaceId
    ? queryAll<{ id: string }>('SELECT id FROM knowledge_entries WHERE workspace_id = ? OR workspace_id = ?', [workspaceId, 'default'])
    : queryAll<{ id: string }>('SELECT id FROM knowledge_entries');

  for (const entry of entries) {
    upsertKnowledgeVector(entry.id);
  }
  return { indexed: entries.length };
}
