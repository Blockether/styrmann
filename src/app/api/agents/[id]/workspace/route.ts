import { NextRequest, NextResponse } from 'next/server';
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'fs';
import { join, resolve, sep } from 'path';
import { queryOne } from '@/lib/db';
import type { Agent } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Scope = 'workspace' | 'agent';

interface WorkspaceEntry {
  name: string;
  relative_path: string;
  type: 'file' | 'directory';
  is_symlink: boolean;
  size: number | null;
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${sep}`);
}

function listDirectory(rootPath: string, requestedPath: string): WorkspaceEntry[] {
  const rootRealPath = realpathSync(rootPath);
  const targetPath = resolve(rootPath, requestedPath || '.');

  if (!existsSync(targetPath)) {
    throw new Error('Path not found');
  }

  const targetRealPath = realpathSync(targetPath);
  if (!isWithinRoot(rootRealPath, targetRealPath)) {
    throw new Error('Path escapes agent root');
  }

  const targetStat = statSync(targetRealPath);
  if (!targetStat.isDirectory()) {
    throw new Error('Path is not a directory');
  }

  return readdirSync(targetRealPath, { withFileTypes: true })
    .map((entry) => {
      const entryPath = join(targetRealPath, entry.name);
      const entryLstat = lstatSync(entryPath);
      const entryStat = entryLstat.isSymbolicLink() ? statSync(entryPath) : entryLstat;
      return {
        name: entry.name,
        relative_path: resolve(targetRealPath, entry.name).replace(`${rootRealPath}${sep}`, ''),
        type: entryStat.isDirectory() ? 'directory' : 'file',
        is_symlink: entryLstat.isSymbolicLink(),
        size: entryStat.isDirectory() ? null : entryStat.size,
      } satisfies WorkspaceEntry;
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const scope = (request.nextUrl.searchParams.get('scope') || 'workspace') as Scope;
    const requestedPath = request.nextUrl.searchParams.get('path') || '.';

    if (scope !== 'workspace' && scope !== 'agent') {
      return NextResponse.json({ error: 'scope must be workspace or agent' }, { status: 400 });
    }

    const agent = queryOne<Pick<Agent, 'id' | 'name' | 'source' | 'gateway_agent_id' | 'agent_dir' | 'agent_workspace_path'>>(
      'SELECT id, name, source, gateway_agent_id, agent_dir, agent_workspace_path FROM agents WHERE id = ?',
      [id],
    );

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const rootPath = scope === 'workspace' ? agent.agent_workspace_path : agent.agent_dir;
    if (!rootPath) {
      return NextResponse.json({ error: `No ${scope} path configured for this agent` }, { status: 404 });
    }

    if (!existsSync(rootPath)) {
      return NextResponse.json({ error: `${scope} path does not exist on disk` }, { status: 404 });
    }

    const entries = listDirectory(rootPath, requestedPath);

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        source: agent.source,
        gateway_agent_id: agent.gateway_agent_id || null,
        agent_dir: agent.agent_dir || null,
        agent_workspace_path: agent.agent_workspace_path || null,
        default_workspace: agent.gateway_agent_id === 'main',
      },
      scope,
      root_path: rootPath,
      requested_path: requestedPath,
      entries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to browse agent workspace';
    const status = /not found|does not exist/i.test(message) ? 404 : /escapes|must be|not a directory/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
