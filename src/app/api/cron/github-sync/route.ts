import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDb } from '@/lib/db';
import { extractOwnerRepo } from '@/lib/github';
import { broadcast } from '@/lib/events';
import type { Workspace } from '@/lib/types';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';

interface GhLabel {
  name: string;
  color: string;
}

interface GhAssignee {
  login: string;
}

interface GhIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  stateReason: string | null;
  labels: GhLabel[];
  assignees: GhAssignee[];
  url: string;
  author: { login: string } | null;
  createdAt: string;
  updatedAt: string;
}

export async function GET(request: NextRequest) {
  // Security: only localhost or valid Bearer token
  const authHeader = request.headers.get('authorization');
  const apiToken = process.env.MC_API_TOKEN;
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const isLocalhost =
    forwarded === '' ||
    forwarded.startsWith('127.') ||
    forwarded.startsWith('::1');

  if (!isLocalhost && apiToken && authHeader !== `Bearer ${apiToken}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const workspaces = db
    .prepare(
      `SELECT * FROM workspaces WHERE github_repo IS NOT NULL AND github_repo != ''`
    )
    .all() as Workspace[];

  let totalIssues = 0;
  let syncedWorkspaces = 0;
  const errors: string[] = [];

  for (const workspace of workspaces) {
    const parsed = extractOwnerRepo(workspace.github_repo!);
    if (!parsed) {
      errors.push(`${workspace.id}: Failed to parse github_repo`);
      continue;
    }

    try {
      const { stdout } = await execFileAsync('gh', [
        'issue',
        'list',
        '--repo',
        `${parsed.owner}/${parsed.repo}`,
        '--json',
        'number,title,state,body,labels,assignees,createdAt,updatedAt,url,author,id,stateReason',
        '--limit',
        '200',
        '--state',
        'all',
      ]);

      const issues = JSON.parse(stdout) as GhIssue[];
      const now = new Date().toISOString();

      const upsert = db.prepare(`
        INSERT INTO github_issues (id, workspace_id, github_id, issue_number, title, body, state, state_reason, labels, assignees, github_url, author, created_at_github, updated_at_github, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, issue_number) DO UPDATE SET
          title = excluded.title, body = excluded.body, state = excluded.state,
          state_reason = excluded.state_reason, labels = excluded.labels,
          assignees = excluded.assignees, github_url = excluded.github_url,
          author = excluded.author, updated_at_github = excluded.updated_at_github,
          synced_at = excluded.synced_at
      `);

      db.transaction(() => {
        for (const issue of issues) {
          upsert.run(
            crypto.randomUUID(),
            workspace.id,
            issue.id,
            issue.number,
            issue.title,
            issue.body ?? null,
            issue.state.toLowerCase(),
            issue.stateReason ?? null,
            JSON.stringify(issue.labels ?? []),
            JSON.stringify((issue.assignees ?? []).map((a: GhAssignee) => a.login)),
            issue.url,
            issue.author?.login ?? null,
            issue.createdAt ?? null,
            issue.updatedAt ?? null,
            now
          );
        }
      })();

      broadcast({
        type: 'github_issues_synced',
        payload: { workspace_id: workspace.id },
      });
      totalIssues += issues.length;
      syncedWorkspaces++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${workspace.id}: ${msg}`);
    }
  }

  return NextResponse.json({
    synced_workspaces: syncedWorkspaces,
    total_issues: totalIssues,
    errors: errors.length > 0 ? errors : undefined,
  });
}
