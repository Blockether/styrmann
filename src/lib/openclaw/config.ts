import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
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
    const systemMd = agentDir ? readFileSafe(join(agentDir, 'system.md')) : null;

    const name = agent.identity?.name || agent.name || agent.id;
    const model = agent.model || defaultModel;
    const role = extractRoleFromSystemMd(systemMd, name);

    return {
      id: agent.id,
      name,
      model,
      agentDir,
      workspacePath,
      soulMd,
      userMd,
      agentsMd,
      systemMd,
      role,
    };
  });
}

export function readAgentMdFromDisk(workspacePath: string | null | undefined): {
  soul_md: string | null;
  user_md: string | null;
  agents_md: string | null;
} {
  if (!workspacePath) return { soul_md: null, user_md: null, agents_md: null };
  return {
    soul_md: readFileSafe(join(workspacePath, 'SOUL.md')),
    user_md: readFileSafe(join(workspacePath, 'USER.md')),
    agents_md: readFileSafe(join(workspacePath, 'AGENTS.md')),
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
