import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { queryAll, queryOne } from '@/lib/db';
import type { Agent, KnowledgeEntry } from '@/lib/types';

const START_MARKER = '<!-- mission-control:agent-learnings:start -->';
const END_MARKER = '<!-- mission-control:agent-learnings:end -->';
const MAX_AGENT_LEARNINGS = 24;

type KnowledgeRow = KnowledgeEntry & { tags?: string | string[] | null };

function parseTags(tags: string | string[] | null | undefined): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

function ensureMemoryHeader(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '# MEMORY\n\n';
  }

  if (/^#\s+MEMORY\b/m.test(trimmed)) {
    return `${trimmed}\n`;
  }

  return `# MEMORY\n\n${trimmed}\n`;
}

function buildManagedBlock(agentName: string, entries: KnowledgeRow[]): string {
  if (entries.length === 0) {
    return `${START_MARKER}\n## Mission Control Learnings\n\nNo durable agent-scoped learnings recorded yet.\n${END_MARKER}`;
  }

  const lines = entries.map((entry, index) => {
    const tags = parseTags(entry.tags);
    const tagSuffix = tags.length > 0 ? ` [tags: ${tags.join(', ')}]` : '';
    const confidence = `${Math.round((entry.confidence || 0) * 100)}% confidence`;
    return `${index + 1}. **${entry.title}** (${entry.category}, ${confidence})${tagSuffix}\n   ${entry.content}`;
  }).join('\n\n');

  return `${START_MARKER}\n## Mission Control Learnings\n\nDurable, agent-scoped learnings for ${agentName}. Mission Control refreshes this block automatically from verified learner output.\n\n${lines}\n${END_MARKER}`;
}

function upsertManagedBlock(existing: string, block: string): string {
  if (existing.includes(START_MARKER) && existing.includes(END_MARKER)) {
    return existing.replace(new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`), block);
  }

  const base = existing.trimEnd();
  return `${base}\n\n${block}`.trimStart();
}

export function syncAgentLearningsToMemory(agentId: string): { updated: boolean; reason?: string; entryCount?: number } {
  const agent = queryOne<Agent>(
    'SELECT * FROM agents WHERE id = ? LIMIT 1',
    [agentId],
  );

  if (!agent) {
    return { updated: false, reason: 'agent_not_found' };
  }

  if (!agent.agent_workspace_path) {
    return { updated: false, reason: 'agent_workspace_missing' };
  }

  const entries = queryAll<KnowledgeRow>(
    `SELECT * FROM knowledge_entries
     WHERE agent_id = ?
     ORDER BY confidence DESC, created_at DESC
     LIMIT ?`,
    [agentId, MAX_AGENT_LEARNINGS],
  );

  const memoryPath = join(agent.agent_workspace_path, 'MEMORY.md');
  const existing = existsSync(memoryPath) ? readFileSync(memoryPath, 'utf-8') : '';
  const content = ensureMemoryHeader(upsertManagedBlock(existing, buildManagedBlock(agent.name, entries)));
  writeFileSync(memoryPath, `${content.trimEnd()}\n`, 'utf-8');

  return { updated: true, entryCount: entries.length };
}
