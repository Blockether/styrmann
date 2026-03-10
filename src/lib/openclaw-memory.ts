import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { queryAll, queryOne, run } from '@/lib/db';
import { createAgentInOpenClawConfig } from '@/lib/openclaw/config';
import { syncAgentsWithRpcCheck } from '@/lib/openclaw/sync';
import type { Agent } from '@/lib/types';

const MEMORY_START_MARKER = '<!-- mission-control:agent-learnings:start -->';
const MEMORY_END_MARKER = '<!-- mission-control:agent-learnings:end -->';
const SOUL_START_MARKER = '<!-- mission-control:agent-guidance:start -->';
const SOUL_END_MARKER = '<!-- mission-control:agent-guidance:end -->';
const AGENTS_START_MARKER = '<!-- mission-control:team-guidance:start -->';
const AGENTS_END_MARKER = '<!-- mission-control:team-guidance:end -->';
const USER_START_MARKER = '<!-- mission-control:user-guidance:start -->';
const USER_END_MARKER = '<!-- mission-control:user-guidance:end -->';
const LEGACY_META_START_MARKER = '<!-- mission-control:openclaw-memory:start -->';
const LEGACY_META_END_MARKER = '<!-- mission-control:openclaw-memory:end -->';

export interface MemoryPipelineConfig {
  id: string;
  enabled: number;
  llm_enabled: number;
  schedule_cron: string;
  top_k: number;
  llm_model: string;
  llm_base_url: string;
  summary_prompt: string;
  updated_at: string;
}

type KnowledgeRecord = {
  id?: string;
  agent_id?: string | null;
  workspace_id: string;
  category: string;
  title: string;
  content: string;
  tags?: string | null;
  confidence: number;
  created_at: string;
};

export type ResponsibilityRoutingDecision = {
  agent_id: string;
  agent_name: string;
  agent_role: string;
  score: number;
  reasons: string[];
  selected: boolean;
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

function ensureHeader(content: string, title: string): string {
  const trimmed = content.trim();
  if (!trimmed) return `# ${title}\n\n`;
  if (new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm').test(trimmed)) {
    return `${trimmed}\n`;
  }
  return `# ${title}\n\n${trimmed}\n`;
}

function upsertManagedBlock(existing: string, startMarker: string, endMarker: string, block: string): string {
  if (existing.includes(startMarker) && existing.includes(endMarker)) {
    return existing.replace(new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`), block);
  }
  const base = existing.trimEnd();
  return `${base}\n\n${block}`.trimStart();
}

function trimLine(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}...`;
}

function responsibilityAnalysis(agent: Agent, entry: KnowledgeRecord): { score: number; reasons: string[] } {
  if (entry.agent_id && entry.agent_id === agent.id) {
    return { score: 100, reasons: ['Entry explicitly targets this agent (agent_id match).'] };
  }

  const text = `${agent.role || ''} ${agent.name || ''} ${agent.description || ''}`.toLowerCase();
  const lowerCategory = entry.category.toLowerCase();
  const lowerTitle = entry.title.toLowerCase();
  const lowerContent = entry.content.toLowerCase();
  const tags = parseTags(entry.tags).map((tag) => tag.toLowerCase());

  let score = 0;
  const reasons: string[] = [];

  if (text.includes('builder')) {
    if (['fix', 'pattern', 'checklist', 'failure'].includes(lowerCategory)) {
      score += 4;
      reasons.push('Builder profile matches implementation/fix-oriented category.');
    }
    if (lowerTitle.includes('implementation') || lowerContent.includes('implementation')) {
      score += 2;
      reasons.push('Implementation-focused wording matches builder responsibilities.');
    }
  }

  if (text.includes('learner')) {
    score += 3;
    reasons.push('Learner role gets baseline score for knowledge handling.');
  }

  if (text.includes('review') || text.includes('guardian') || text.includes('correctness') || text.includes('tester')) {
    if (['checklist', 'failure', 'pattern'].includes(lowerCategory)) {
      score += 4;
      reasons.push('Review/guardian/test role matches verification-oriented category.');
    }
    if (lowerTitle.includes('validation') || lowerContent.includes('verification')) {
      score += 2;
      reasons.push('Validation/verification wording aligns with quality responsibilities.');
    }
  }

  if (text.includes('orchestrator') || text.includes('product') || text.includes('consolidator')) {
    if (['pattern', 'checklist', 'research'].includes(lowerCategory)) {
      score += 3;
      reasons.push('Orchestrator/product/consolidator role matches cross-cutting guidance category.');
    }
  }

  const roleTokens = text
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .slice(0, 10);

  for (const token of roleTokens) {
    if (lowerTitle.includes(token) || lowerContent.includes(token) || tags.some((tag) => tag.includes(token))) {
      score += 1;
      reasons.push(`Role token match: "${token}" found in entry content/tags.`);
    }
  }

  if (entry.workspace_id === agent.workspace_id) {
    score += 1;
    reasons.push('Workspace-specific match with agent workspace.');
  }
  if (entry.workspace_id === 'default') {
    score += 1;
    reasons.push('Default workspace knowledge is considered globally relevant.');
  }

  return { score, reasons: reasons.slice(0, 8) };
}

function responsibilityScore(agent: Agent, entry: KnowledgeRecord): number {
  return responsibilityAnalysis(agent, entry).score;
}

function selectEntriesBySection(entries: KnowledgeRecord[], section: 'memory' | 'soul' | 'agents' | 'user'): KnowledgeRecord[] {
  if (section === 'memory') return entries;

  return entries.filter((entry) => {
    const text = `${entry.title} ${entry.content}`.toLowerCase();
    const tags = parseTags(entry.tags).map((tag) => tag.toLowerCase());

    if (section === 'soul') {
      return ['pattern', 'checklist', 'failure', 'fix'].includes(entry.category.toLowerCase());
    }
    if (section === 'agents') {
      return text.includes('handoff') || text.includes('review') || text.includes('team') || tags.some((tag) => ['team', 'handoff', 'workflow', 'review'].includes(tag));
    }
    return text.includes('user') || text.includes('human') || text.includes('preference') || tags.some((tag) => ['user', 'human', 'preference', 'communication'].includes(tag));
  });
}

function formatEntries(entries: KnowledgeRecord[]): string {
  if (entries.length === 0) {
    return 'No durable guidance yet.';
  }

  return entries.map((entry, index) => {
    const confidence = Math.round((entry.confidence || 0) * 100);
    return `${index + 1}. **${trimLine(entry.title, 96)}** (${entry.category}, ${confidence}% confidence)\n   ${trimLine(entry.content, 220)}`;
  }).join('\n\n');
}

async function summarizeWithLLM(
  section: 'memory' | 'soul' | 'agents' | 'user',
  agent: Agent,
  entries: KnowledgeRecord[],
  config: MemoryPipelineConfig,
): Promise<string | null> {
  if (!config.llm_enabled) return null;

  const apiKey = process.env.MEMORY_PIPELINE_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const objective = section === 'memory'
    ? 'Consolidate durable technical learnings for the agent memory.'
    : section === 'soul'
      ? 'Consolidate operational behavior rules for the agent SOUL guidance.'
      : section === 'agents'
        ? 'Consolidate collaboration and handoff protocols for AGENTS guidance.'
        : 'Consolidate user interaction preferences and communication rules for USER guidance.';

  const payload = {
    model: config.llm_model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: `${config.summary_prompt}\n\nReturn only a markdown bullet list. Max 8 bullets. No introduction.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          objective,
          agent: { id: agent.id, name: agent.name, role: agent.role, description: agent.description || '' },
          entries: entries.map((entry) => ({
            category: entry.category,
            title: entry.title,
            content: entry.content,
            tags: parseTags(entry.tags),
            confidence: entry.confidence,
            workspace_id: entry.workspace_id,
          })),
        }),
      },
    ],
  };

  try {
    const response = await fetch(`${config.llm_base_url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    return content;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function getRelevantEntriesForAgent(agent: Agent, limit: number): KnowledgeRecord[] {
  const entries = queryAll<KnowledgeRecord>(
    `SELECT id, agent_id, workspace_id, category, title, content, tags, confidence, created_at
     FROM knowledge_entries
     WHERE (agent_id = ?)
        OR (agent_id IS NULL AND (workspace_id = ? OR workspace_id = 'default'))
     ORDER BY confidence DESC, created_at DESC
     LIMIT 240`,
    [agent.id, agent.workspace_id],
  );

  const entryIds = entries
    .map((entry) => entry.id)
    .filter((id): id is string => Boolean(id));

  const placeholders = entryIds.map(() => '?').join(', ');
  const routingRows = entryIds.length > 0
    ? queryAll<{ knowledge_id: string; agent_id: string | null; selected: number }>(
        `SELECT knowledge_id, agent_id, selected
         FROM knowledge_routing_decisions
         WHERE knowledge_id IN (${placeholders})`,
        entryIds,
      )
    : [];

  const hasRouting = new Set<string>();
  const selectedForAgent = new Set<string>();
  for (const row of routingRows) {
    hasRouting.add(row.knowledge_id);
    if (row.agent_id === agent.id && row.selected === 1) {
      selectedForAgent.add(row.knowledge_id);
    }
  }

  return entries
    .map((entry) => ({ entry, score: responsibilityScore(agent, entry) }))
    .filter(({ score, entry }) => {
      if (entry.agent_id === agent.id) return true;
      const id = entry.id || '';
      if (id && selectedForAgent.has(id)) return true;
      if (id && hasRouting.has(id)) return false;
      return score >= 4;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.entry.confidence || 0) !== (a.entry.confidence || 0)) {
        return (b.entry.confidence || 0) - (a.entry.confidence || 0);
      }
      return String(b.entry.created_at).localeCompare(String(a.entry.created_at));
    })
    .slice(0, limit)
    .map(({ entry }) => entry);
}

async function writeSection(
  agent: Agent,
  fileName: 'MEMORY.md' | 'SOUL.md' | 'AGENTS.md' | 'USER.md',
  markerStart: string,
  markerEnd: string,
  sectionTitle: string,
  sectionObjective: 'memory' | 'soul' | 'agents' | 'user',
  config: MemoryPipelineConfig,
): Promise<{ updated: boolean; reason?: string; entryCount?: number }> {
  if (!agent.agent_workspace_path) return { updated: false, reason: 'agent_workspace_missing' };

  const allEntries = getRelevantEntriesForAgent(agent, config.top_k || 24);
  const sectionEntries = selectEntriesBySection(allEntries, sectionObjective);
  const summary = await summarizeWithLLM(sectionObjective, agent, sectionEntries, config);
  const contentBody = summary || formatEntries(sectionEntries);

  const block = `${markerStart}\n## ${sectionTitle}\n\n${contentBody}\n${markerEnd}`;
  const fullPath = join(agent.agent_workspace_path, fileName);
  const existing = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : '';
  const headerTitle = fileName.replace('.md', '');
  const content = ensureHeader(upsertManagedBlock(existing, markerStart, markerEnd, block), headerTitle);
  writeFileSync(fullPath, `${content.trimEnd()}\n`, 'utf-8');

  return { updated: true, entryCount: sectionEntries.length };
}

function clearLegacySharedMetaMemoryBlock(): void {
  const metaMemoryPath = join(homedir(), '.openclaw', 'MEMORY.md');
  if (!existsSync(metaMemoryPath)) return;
  const existing = readFileSync(metaMemoryPath, 'utf-8');
  if (!existing.includes(LEGACY_META_START_MARKER) || !existing.includes(LEGACY_META_END_MARKER)) return;
  const cleaned = existing
    .replace(new RegExp(`${LEGACY_META_START_MARKER}[\\s\\S]*?${LEGACY_META_END_MARKER}`), '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  writeFileSync(metaMemoryPath, `${cleaned}\n`, 'utf-8');
}

function defaultConfig(): MemoryPipelineConfig {
  return {
    id: 'default',
    enabled: 1,
    llm_enabled: 1,
    schedule_cron: '0 * * * *',
    top_k: 24,
    llm_model: 'gpt-4o-mini',
    llm_base_url: 'https://api.openai.com/v1',
    summary_prompt: 'Summarize durable learnings into concise operational rules for MEMORY, SOUL, AGENTS, and USER artifacts. Keep output factual and directly actionable.',
    updated_at: new Date().toISOString(),
  };
}

export function getMemoryPipelineConfig(): MemoryPipelineConfig {
  const row = queryOne<MemoryPipelineConfig>('SELECT * FROM memory_pipeline_config WHERE id = ? LIMIT 1', ['default']);
  if (row) return row;

  const fallback = defaultConfig();
  run(
    `INSERT INTO memory_pipeline_config (id, enabled, llm_enabled, schedule_cron, top_k, llm_model, llm_base_url, summary_prompt, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO NOTHING`,
    [fallback.id, fallback.enabled, fallback.llm_enabled, fallback.schedule_cron, fallback.top_k, fallback.llm_model, fallback.llm_base_url, fallback.summary_prompt],
  );
  return fallback;
}

export function updateMemoryPipelineConfig(patch: Partial<MemoryPipelineConfig>): MemoryPipelineConfig {
  const current = getMemoryPipelineConfig();
  const next: MemoryPipelineConfig = {
    ...current,
    ...patch,
    id: 'default',
  };

  run(
    `UPDATE memory_pipeline_config
     SET enabled = ?, llm_enabled = ?, schedule_cron = ?, top_k = ?, llm_model = ?, llm_base_url = ?, summary_prompt = ?, updated_at = datetime('now')
     WHERE id = 'default'`,
    [next.enabled, next.llm_enabled, next.schedule_cron, next.top_k, next.llm_model, next.llm_base_url, next.summary_prompt],
  );

  return getMemoryPipelineConfig();
}

export function getResponsibilityTargetAgentIds(workspaceId: string, category: string, title: string, content: string, limit = 5): string[] {
  return getResponsibilityRoutingDecisions(workspaceId, category, title, content, limit)
    .filter((decision) => decision.selected)
    .map((decision) => decision.agent_id);
}

export function getResponsibilityRoutingDecisions(
  workspaceId: string,
  category: string,
  title: string,
  content: string,
  limit = 5,
): ResponsibilityRoutingDecision[] {
  const entry: KnowledgeRecord = {
    workspace_id: workspaceId,
    category,
    title,
    content,
    confidence: 0.6,
    created_at: new Date().toISOString(),
  };

  const agents = queryAll<Agent>(
    `SELECT * FROM agents
     WHERE source IN ('synced', 'gateway')
       AND agent_workspace_path IS NOT NULL
       AND (workspace_id = ? OR workspace_id = 'default')
     ORDER BY updated_at DESC`,
    [workspaceId],
  );

  const ranked = agents
    .map((agent) => {
      const analysis = responsibilityAnalysis(agent, entry);
      return {
        agent,
        score: analysis.score,
        reasons: analysis.reasons,
      };
    })
    .sort((a, b) => b.score - a.score);

  const selectedIds = new Set(
    ranked
      .filter(({ score }) => score >= 4)
      .slice(0, limit)
      .map(({ agent }) => agent.id),
  );

  return ranked.slice(0, Math.max(limit, 8)).map(({ agent, score, reasons }) => ({
    agent_id: agent.id,
    agent_name: agent.name,
    agent_role: agent.role,
    score,
    reasons,
    selected: selectedIds.has(agent.id),
  }));
}

export async function syncAgentKnowledgeArtifacts(agentId: string): Promise<{
  memory_sync: { updated: boolean; reason?: string; entryCount?: number };
  soul_sync: { updated: boolean; reason?: string; entryCount?: number };
  agents_sync: { updated: boolean; reason?: string; entryCount?: number };
  user_sync: { updated: boolean; reason?: string; entryCount?: number };
}> {
  const config = getMemoryPipelineConfig();
  const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ? LIMIT 1', [agentId]);
  if (!agent) {
    const missing = { updated: false, reason: 'agent_not_found' };
    return { memory_sync: missing, soul_sync: missing, agents_sync: missing, user_sync: missing };
  }

  const memory_sync = await writeSection(agent, 'MEMORY.md', MEMORY_START_MARKER, MEMORY_END_MARKER, 'Mission Control Learnings', 'memory', config);
  const soul_sync = await writeSection(agent, 'SOUL.md', SOUL_START_MARKER, SOUL_END_MARKER, 'Mission Control Operational Guidance', 'soul', config);
  const agents_sync = await writeSection(agent, 'AGENTS.md', AGENTS_START_MARKER, AGENTS_END_MARKER, 'Mission Control Team Coordination', 'agents', config);
  const user_sync = await writeSection(agent, 'USER.md', USER_START_MARKER, USER_END_MARKER, 'Mission Control User Preferences', 'user', config);

  return { memory_sync, soul_sync, agents_sync, user_sync };
}

export async function ensureConsolidatorAgent(): Promise<{ created: boolean; agentId?: string; reason?: string }> {
  const existing = queryOne<{ id: string }>(
    `SELECT id FROM agents
     WHERE gateway_agent_id = 'arch-consolidator'
        OR LOWER(name) LIKE '%consolidator%'
     LIMIT 1`,
  );
  if (existing) return { created: false, agentId: existing.id };

  const created = createAgentInOpenClawConfig({
    id: 'arch-consolidator',
    name: 'Robert | Consolidator',
    role: 'consolidator',
    model: 'zai-coding-plan/glm-5',
    systemMd: '# Robert | Consolidator\n\nConsolidate verified learnings into durable per-agent MEMORY, SOUL, AGENTS, and USER guidance. Route workspace-scoped knowledge by responsibility.',
  });

  if (!created.ok) {
    return { created: false, reason: created.error || 'create_failed' };
  }

  await syncAgentsWithRpcCheck();
  const synced = queryOne<{ id: string }>('SELECT id FROM agents WHERE gateway_agent_id = ? LIMIT 1', ['arch-consolidator']);
  return { created: true, agentId: synced?.id };
}

export async function runOpenClawMemoryConsolidation(): Promise<{
  syncedAgents: number;
  memoryUpdated: number;
  soulUpdated: number;
  agentsUpdated: number;
  userUpdated: number;
}> {
  const config = getMemoryPipelineConfig();
  if (!config.enabled) {
    return { syncedAgents: 0, memoryUpdated: 0, soulUpdated: 0, agentsUpdated: 0, userUpdated: 0 };
  }

  clearLegacySharedMetaMemoryBlock();

  const agents = queryAll<Agent>(
    `SELECT * FROM agents
     WHERE source IN ('synced', 'gateway')
       AND agent_workspace_path IS NOT NULL
     ORDER BY updated_at DESC`,
  );

  let memoryUpdated = 0;
  let soulUpdated = 0;
  let agentsUpdated = 0;
  let userUpdated = 0;

  for (const agent of agents) {
    const result = await syncAgentKnowledgeArtifacts(agent.id);
    if (result.memory_sync.updated) memoryUpdated += 1;
    if (result.soul_sync.updated) soulUpdated += 1;
    if (result.agents_sync.updated) agentsUpdated += 1;
    if (result.user_sync.updated) userUpdated += 1;
  }

  return {
    syncedAgents: agents.length,
    memoryUpdated,
    soulUpdated,
    agentsUpdated,
    userUpdated,
  };
}

function countManagedItems(content: string, markerStart: string, markerEnd: string): number {
  const start = content.indexOf(markerStart);
  const end = content.indexOf(markerEnd);
  if (start === -1 || end === -1 || end <= start) return 0;
  const block = content.slice(start, end);
  const matches = block.match(/^\d+\.\s+/gm);
  return matches ? matches.length : 0;
}

export function getMemoryPipelineAgentsStatus(): Array<{
  id: string;
  name: string;
  role: string;
  workspace_id: string;
  memory_items: number;
  soul_items: number;
  agents_items: number;
  user_items: number;
  workspace_path?: string;
}> {
  const agents = queryAll<Agent>(
    `SELECT * FROM agents
     WHERE source IN ('synced', 'gateway')
       AND agent_workspace_path IS NOT NULL
     ORDER BY name ASC`,
  );

  return agents.map((agent) => {
    const workspacePath = agent.agent_workspace_path || '';
    const read = (file: string) => {
      const path = join(workspacePath, file);
      return existsSync(path) ? readFileSync(path, 'utf-8') : '';
    };
    const memory = read('MEMORY.md');
    const soul = read('SOUL.md');
    const agentsMd = read('AGENTS.md');
    const user = read('USER.md');

    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      workspace_id: agent.workspace_id,
      memory_items: countManagedItems(memory, MEMORY_START_MARKER, MEMORY_END_MARKER),
      soul_items: countManagedItems(soul, SOUL_START_MARKER, SOUL_END_MARKER),
      agents_items: countManagedItems(agentsMd, AGENTS_START_MARKER, AGENTS_END_MARKER),
      user_items: countManagedItems(user, USER_START_MARKER, USER_END_MARKER),
      workspace_path: workspacePath,
    };
  });
}
