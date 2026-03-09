import { NextRequest, NextResponse } from 'next/server';
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync } from 'fs';
import { join, resolve, sep } from 'path';
import { queryOne } from '@/lib/db';
import type { Agent } from '@/lib/types';

export const dynamic = 'force-dynamic';

function normalizeSkillName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Invalid skill name');
  }
  return trimmed;
}

function ensureWithin(root: string, path: string): void {
  const rootReal = realpathSync(root);
  const pathReal = realpathSync(path);
  if (!(pathReal === rootReal || pathReal.startsWith(`${rootReal}${sep}`))) {
    throw new Error('Path escapes root');
  }
}

function listSkillDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((entry) => {
    const full = join(root, entry);
    try {
      const st = statSync(full);
      return st.isDirectory();
    } catch {
      return false;
    }
  }).sort((a, b) => a.localeCompare(b));
}

function resolveSharedRoot(): string {
  const mainAgent = queryOne<Pick<Agent, 'agent_workspace_path'>>(
    `SELECT agent_workspace_path
     FROM agents
     WHERE source = 'synced' AND gateway_agent_id = 'main'
     LIMIT 1`,
  );
  const preferred = mainAgent?.agent_workspace_path ? join(mainAgent.agent_workspace_path, 'skills') : null;
  if (preferred && existsSync(preferred)) return preferred;
  return '/root/.openclaw/workspace/skills';
}

function inspectSkills(agent: Pick<Agent, 'id' | 'name' | 'source' | 'gateway_agent_id' | 'agent_workspace_path'>) {
  const sharedRoot = resolveSharedRoot();
  const availableShared = listSkillDirs(sharedRoot);
  const isMain = agent.gateway_agent_id === 'main';
  const agentSkillsRoot = agent.agent_workspace_path ? join(agent.agent_workspace_path, 'skills') : null;

  const installed: Array<{
    name: string;
    source: 'shared' | 'linked' | 'local';
    is_symlink: boolean;
    linked_target: string | null;
  }> = [];

  if (isMain) {
    for (const skillName of availableShared) {
      installed.push({
        name: skillName,
        source: 'shared',
        is_symlink: false,
        linked_target: null,
      });
    }
  } else if (agentSkillsRoot && existsSync(agentSkillsRoot)) {
    for (const entry of readdirSync(agentSkillsRoot)) {
      const full = join(agentSkillsRoot, entry);
      const lst = lstatSync(full);
      if (!(lst.isDirectory() || lst.isSymbolicLink())) continue;

      let source: 'linked' | 'local' = 'local';
      let target: string | null = null;
      if (lst.isSymbolicLink()) {
        const rawTarget = readlinkSync(full);
        const resolvedTarget = resolve(agentSkillsRoot, rawTarget);
        target = resolvedTarget;
        if (existsSync(resolvedTarget) && existsSync(sharedRoot)) {
          try {
            ensureWithin(sharedRoot, resolvedTarget);
            source = 'linked';
          } catch {
            source = 'local';
          }
        }
      }

      installed.push({
        name: entry,
        source,
        is_symlink: lst.isSymbolicLink(),
        linked_target: target,
      });
    }
  }

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      source: agent.source,
      gateway_agent_id: agent.gateway_agent_id || null,
      is_main: isMain,
    },
    shared_root: sharedRoot,
    agent_skills_root: agentSkillsRoot,
    available_shared: availableShared,
    installed,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = queryOne<Pick<Agent, 'id' | 'name' | 'source' | 'gateway_agent_id' | 'agent_workspace_path'>>(
      'SELECT id, name, source, gateway_agent_id, agent_workspace_path FROM agents WHERE id = ?',
      [id],
    );
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    if (agent.source !== 'synced') {
      return NextResponse.json({ error: 'Skill linking is available for synced OpenClaw agents only' }, { status: 400 });
    }
    return NextResponse.json(inspectSkills(agent));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to inspect skills' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const action = String(body.action || '');
    const skillName = body.skill_name ? normalizeSkillName(String(body.skill_name)) : null;

    const agent = queryOne<Pick<Agent, 'id' | 'name' | 'source' | 'gateway_agent_id' | 'agent_workspace_path'>>(
      'SELECT id, name, source, gateway_agent_id, agent_workspace_path FROM agents WHERE id = ?',
      [id],
    );
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    if (agent.source !== 'synced') {
      return NextResponse.json({ error: 'Skill linking is available for synced OpenClaw agents only' }, { status: 400 });
    }
    if (agent.gateway_agent_id === 'main') {
      return NextResponse.json({ error: 'Main agent is the shared skill source and cannot link from itself' }, { status: 400 });
    }
    if (!agent.agent_workspace_path) {
      return NextResponse.json({ error: 'Agent workspace path is not configured' }, { status: 400 });
    }

    const sharedRoot = resolveSharedRoot();
    const agentSkillsRoot = join(agent.agent_workspace_path, 'skills');
    if (!existsSync(sharedRoot)) {
      return NextResponse.json({ error: `Shared skills root not found: ${sharedRoot}` }, { status: 404 });
    }
    mkdirSync(agentSkillsRoot, { recursive: true });

    const linkOne = (name: string, replaceLocal: boolean) => {
      const source = join(sharedRoot, name);
      if (!existsSync(source) || !statSync(source).isDirectory()) {
        throw new Error(`Shared skill not found: ${name}`);
      }
      const dest = join(agentSkillsRoot, name);
      if (existsSync(dest)) {
        const dstLstat = lstatSync(dest);
        if (dstLstat.isSymbolicLink()) {
          const currentTarget = resolve(agentSkillsRoot, readlinkSync(dest));
          if (currentTarget === source) return;
          if (!replaceLocal) throw new Error(`Skill ${name} already linked to another target`);
          rmSync(dest, { recursive: true, force: true });
        } else {
          if (!replaceLocal) throw new Error(`Skill ${name} already exists as local copy`);
          rmSync(dest, { recursive: true, force: true });
        }
      }
      symlinkSync(source, dest, 'dir');
    };

    if (action === 'link') {
      if (!skillName) return NextResponse.json({ error: 'skill_name is required for link' }, { status: 400 });
      linkOne(skillName, false);
    } else if (action === 'replace_with_link') {
      if (!skillName) return NextResponse.json({ error: 'skill_name is required for replace_with_link' }, { status: 400 });
      linkOne(skillName, true);
    } else if (action === 'unlink') {
      if (!skillName) return NextResponse.json({ error: 'skill_name is required for unlink' }, { status: 400 });
      const dest = join(agentSkillsRoot, skillName);
      if (!existsSync(dest)) return NextResponse.json({ ok: true, message: 'Skill not linked', data: inspectSkills(agent) });
      const dstLstat = lstatSync(dest);
      if (!dstLstat.isSymbolicLink()) {
        return NextResponse.json({ error: `Skill ${skillName} exists as local copy; use replace_with_link to convert` }, { status: 409 });
      }
      rmSync(dest, { recursive: true, force: true });
    } else if (action === 'sync_all') {
      const available = listSkillDirs(sharedRoot);
      for (const name of available) {
        try {
          linkOne(name, false);
        } catch {
          continue;
        }
      }
    } else {
      return NextResponse.json({ error: 'Unsupported action. Use link, unlink, replace_with_link, or sync_all' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: inspectSkills(agent) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to manage skills' }, { status: 500 });
  }
}
