import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const MAX_CONFIG_SIZE_BYTES = 1024 * 1024;
const MAX_MD_FILE_SIZE_BYTES = 512 * 1024;

let lastConfigMtimeMs = 0;

export function hasConfigChanged(): boolean {
  try {
    const configPath = join(homedir(), '.openclaw', 'openclaw.json');
    if (!existsSync(configPath)) return false;
    const mtime = statSync(configPath).mtimeMs;
    if (mtime !== lastConfigMtimeMs) {
      lastConfigMtimeMs = mtime;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface OpenClawAgentConfig {
  id: string;
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: string;
  identity?: {
    name?: string;
  };
}

export interface OpenClawFullConfig {
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: string[];
      };
      workspace?: string;
    };
    list?: OpenClawAgentConfig[];
  };
  acp?: {
    defaultAgent?: string;
  };
  [key: string]: unknown;
}

export interface ResolvedAgent {
  id: string;
  name: string;
  model: string | null;
  agentDir: string | null;
  workspacePath: string | null;
  soulMd: string | null;
  userMd: string | null;
  agentsMd: string | null;
  memoryMd: string | null;
  systemMd: string | null;
  role: string;
}

function getConfigPath(): string {
  return join(homedir(), '.openclaw', 'openclaw.json');
}

function readFileSafe(path: string, maxSize: number = MAX_MD_FILE_SIZE_BYTES): string | null {
  try {
    if (!existsSync(path)) return null;
    const stats = statSync(path);
    if (stats.size > maxSize) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

export function readOpenClawConfig(): OpenClawFullConfig | null {
  const configPath = getConfigPath();
  try {
    if (!existsSync(configPath)) return null;
    const stats = statSync(configPath);
    if (stats.size > MAX_CONFIG_SIZE_BYTES) return null;
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as OpenClawFullConfig;
  } catch (err) {
    console.error('[openclaw-config] Failed to read config:', err);
    return null;
  }
}

const DEFAULT_ACP_AGENT = 'opencode';

/**
 * Resolve the default ACP agent id.
 * Priority: ACP_DEFAULT_AGENT env var > openclaw.json acp.defaultAgent > 'opencode'
 */
export function resolveDefaultAcpAgent(): string {
  const fromEnv = process.env.ACP_DEFAULT_AGENT?.trim();
  if (fromEnv) return fromEnv;
  const config = readOpenClawConfig();
  return config?.acp?.defaultAgent?.trim() || DEFAULT_ACP_AGENT;
}

function resolveWorkspacePath(agent: OpenClawAgentConfig, defaults: OpenClawFullConfig['agents']): string | null {
  if (agent.workspace) return agent.workspace;
  if (agent.id === 'main') {
    return defaults?.defaults?.workspace || join(homedir(), '.openclaw', 'workspace');
  }
  return join(homedir(), '.openclaw', 'workspaces', agent.id);
}

function resolveAgentDir(agent: OpenClawAgentConfig): string | null {
  if (agent.agentDir) return agent.agentDir;
  return join(homedir(), '.openclaw', 'agents', agent.id, 'agent');
}

function extractRoleFromSystemMd(systemMd: string | null, agentName: string): string {
  if (!systemMd) return agentName;
  const frontmatterMatch = systemMd.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const roleMatch = frontmatterMatch[1].match(/role:\s*"?([^"\n]+)"?/);
    if (roleMatch) return roleMatch[1].trim();
    const descMatch = frontmatterMatch[1].match(/description:\s*"?([^"\n]+)"?/);
    if (descMatch) return descMatch[1].trim();
  }
  const headingMatch = systemMd.match(/^#\s+(.+)/m);
  if (headingMatch) return headingMatch[1].trim();
  return agentName;
}

export function resolveAgents(config: OpenClawFullConfig): ResolvedAgent[] {
  const agents = config.agents?.list;
  if (!agents || !Array.isArray(agents)) return [];

  const defaultModel = config.agents?.defaults?.model?.primary || null;

  return agents.map((agent) => {
    const workspacePath = resolveWorkspacePath(agent, config.agents);
    const agentDir = resolveAgentDir(agent);

    const soulMd = workspacePath ? readFileSafe(join(workspacePath, 'SOUL.md')) : null;
    const userMd = workspacePath ? readFileSafe(join(workspacePath, 'USER.md')) : null;
    const agentsMd = workspacePath ? readFileSafe(join(workspacePath, 'AGENTS.md')) : null;
    const memoryMd = workspacePath ? readFileSafe(join(workspacePath, 'MEMORY.md')) : null;
    const systemMd = agentDir ? readFileSafe(join(agentDir, 'system.md')) : null;

    const name = agent.identity?.name || agent.name || agent.id;
    const model = agent.model || defaultModel;
    const role = agent.id === 'main' ? 'orchestrator' : extractRoleFromSystemMd(systemMd, name);

    return {
      id: agent.id,
      name,
      model,
      agentDir,
      workspacePath,
      soulMd,
      userMd,
      agentsMd,
      memoryMd,
      systemMd,
      role,
    };
  });
}

export function readAgentMdFromDisk(workspacePath: string | null | undefined): {
  soul_md: string | null;
  user_md: string | null;
  agents_md: string | null;
  memory_md: string | null;
} {
  if (!workspacePath) return { soul_md: null, user_md: null, agents_md: null, memory_md: null };
  return {
    soul_md: readFileSafe(join(workspacePath, 'SOUL.md')),
    user_md: readFileSafe(join(workspacePath, 'USER.md')),
    agents_md: readFileSafe(join(workspacePath, 'AGENTS.md')),
    memory_md: readFileSafe(join(workspacePath, 'MEMORY.md')),
  };
}

export function readAgentDescriptionFromDisk(agentDir: string | null | undefined): string | null {
  if (!agentDir) return null;
  return readFileSafe(join(agentDir, 'system.md'));
}

export function writeAgentFieldToConfig(
  agentId: string,
  field: 'model' | 'identity.name',
  value: string
): boolean {
  const configPath = getConfigPath();
  try {
    const config = readOpenClawConfig();
    if (!config?.agents?.list) return false;

    const agent = config.agents.list.find((a) => a.id === agentId);
    if (!agent) return false;

    if (field === 'model') {
      agent.model = value;
    } else if (field === 'identity.name') {
      if (!agent.identity) agent.identity = {};
      agent.identity.name = value;
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`[openclaw-config] Failed to write ${field} for ${agentId}:`, err);
    return false;
  }
}

export function writeAgentMdFile(
  dirPath: string,
  filename: string,
  content: string
): boolean {
  try {
    const filePath = join(dirPath, filename);
    writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error(`[openclaw-config] Failed to write ${filename} to ${dirPath}:`, err);
    return false;
  }
}

interface CreateOpenClawAgentInput {
  id: string;
  name: string;
  role: string;
  model?: string;
  soulMd?: string;
  userMd?: string;
  agentsMd?: string;
  memoryMd?: string;
  systemMd?: string;
}

export function createAgentInOpenClawConfig(input: CreateOpenClawAgentInput): {
  ok: boolean;
  error?: string;
  workspacePath?: string;
  agentDir?: string;
} {
  const configPath = getConfigPath();
  try {
    const config = readOpenClawConfig();
    if (!config) {
      return { ok: false, error: 'OpenClaw config not found' };
    }

    if (!config.agents) config.agents = {};
    if (!Array.isArray(config.agents.list)) config.agents.list = [];

    const alreadyExists = config.agents.list.some((agent) => agent.id === input.id);
    if (alreadyExists) {
      return { ok: false, error: `Agent id already exists: ${input.id}` };
    }

    const workspacePath = join(homedir(), '.openclaw', 'workspaces', input.id);
    const agentDir = join(homedir(), '.openclaw', 'agents', input.id, 'agent');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    const model = input.model || config.agents.defaults?.model?.primary || undefined;

    config.agents.list.push({
      id: input.id,
      name: input.name,
      workspace: workspacePath,
      agentDir,
      model,
      identity: { name: input.name },
    });

    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const soulMd = input.soulMd || `# ${input.name}\n\nYou are ${input.name}. Work clearly, safely, and with strong execution discipline.`;
    const userMd = input.userMd || '# USER\n\nContext about the human operator.';
    const agentsMd = input.agentsMd || '# AGENTS\n\nTeam coordination notes.';
    const memoryMd = input.memoryMd || '# MEMORY\n\nDurable lessons learned and stable operating preferences.';
    const systemMd = input.systemMd || `---\nrole: ${input.role}\n---\n\n# ${input.role}\n\nYou are ${input.name}. Execute tasks accurately and report verifiable outcomes.`;

    writeFileSync(join(workspacePath, 'SOUL.md'), soulMd, 'utf-8');
    writeFileSync(join(workspacePath, 'USER.md'), userMd, 'utf-8');
    writeFileSync(join(workspacePath, 'AGENTS.md'), agentsMd, 'utf-8');
    writeFileSync(join(workspacePath, 'MEMORY.md'), memoryMd, 'utf-8');
    writeFileSync(join(agentDir, 'system.md'), systemMd, 'utf-8');

    return { ok: true, workspacePath, agentDir };
  } catch (err) {
    console.error('[openclaw-config] Failed to create agent in config:', err);
    return { ok: false, error: 'Failed to create OpenClaw agent' };
  }
}
