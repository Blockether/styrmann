import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { queryOne } from '@/lib/db';
import type { Agent } from '@/lib/types';

const START_MARKER = '<!-- mission-control:agent-learnings:start -->';
const END_MARKER = '<!-- mission-control:agent-learnings:end -->';
const MANAGED_BLOCK_REGEX = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`, 'g');

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

function removeManagedBlock(existing: string): string {
  return existing.replace(MANAGED_BLOCK_REGEX, '').replace(/\n{3,}/g, '\n\n').trimEnd();
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

  const memoryPath = join(agent.agent_workspace_path, 'MEMORY.md');
  const existing = existsSync(memoryPath) ? readFileSync(memoryPath, 'utf-8') : '';
  const content = ensureMemoryHeader(removeManagedBlock(existing));
  writeFileSync(memoryPath, `${content.trimEnd()}\n`, 'utf-8');

  return { updated: true, entryCount: 0 };
}
