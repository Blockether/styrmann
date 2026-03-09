import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import path from 'path';
import { getDb } from '@/lib/db';
import { getWorkspaceRepoPath, isGitWorkTree } from '@/lib/git-repo';

export const dynamic = 'force-dynamic';

interface CommitInfo {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

interface BranchDetail {
  name: string;
  local: boolean;
  remote: boolean;
}

function extractBranchNames(metadataRaw: string | null | undefined): string[] {
  if (!metadataRaw) return [];
  try {
    const metadata = JSON.parse(metadataRaw) as { branch?: unknown; git_branch?: unknown; base_branch?: unknown };
    const values = [metadata.branch, metadata.git_branch, metadata.base_branch]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
    return Array.from(new Set(values));
  } catch {
    return [];
  }
}

function parseGitLog(raw: string): CommitInfo[] {
  if (!raw.trim()) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, author, date] = line.split('\t');
      return {
        hash: hash || '',
        subject: subject || '',
        author: author || '',
        date: date || '',
      };
    })
    .filter((row) => row.hash);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: taskId } = await params;
    const db = getDb();

    const task = db
      .prepare(
        `SELECT t.id, t.title, t.created_at, t.workspace_id, w.name as workspace_name, w.slug as workspace_slug,
                w.organization as workspace_org, w.github_repo as workspace_repo
         FROM tasks t
         LEFT JOIN workspaces w ON w.id = t.workspace_id
         WHERE t.id = ?`,
      )
      .get(taskId) as
      | {
          id: string;
          title: string;
          created_at: string;
          workspace_id: string;
          workspace_name?: string;
          workspace_slug?: string;
          workspace_org?: string;
          workspace_repo?: string;
        }
      | undefined;

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const deliverables = db
      .prepare(
        `SELECT id, deliverable_type, title, path, created_at
         FROM task_deliverables
         WHERE task_id = ?
         ORDER BY created_at DESC`,
      )
      .all(taskId) as Array<{
      id: string;
      deliverable_type: string;
      title: string;
      path?: string;
      created_at: string;
    }>;

    let sessions = db
      .prepare(
        `SELECT id, openclaw_session_id, status, created_at, ended_at
         FROM openclaw_sessions
         WHERE task_id = ?
         ORDER BY created_at DESC`,
      )
      .all(taskId);

    if (!Array.isArray(sessions) || sessions.length === 0) {
      const fallbackSessions = db
        .prepare(
          `SELECT
             json_extract(metadata, '$.openclaw_session_id') as openclaw_session_id,
             MAX(created_at) as created_at
           FROM task_activities
           WHERE task_id = ?
             AND activity_type = 'dispatch_invocation'
             AND metadata IS NOT NULL
           GROUP BY json_extract(metadata, '$.openclaw_session_id')`,
        )
        .all(taskId) as Array<{ openclaw_session_id?: string | null; created_at?: string | null }>;

      sessions = fallbackSessions
        .filter((row) => typeof row.openclaw_session_id === 'string' && row.openclaw_session_id.length > 0)
        .map((row) => ({
          id: `fallback-${row.openclaw_session_id}`,
          openclaw_session_id: row.openclaw_session_id,
          status: 'active',
          created_at: row.created_at,
          ended_at: null,
          inferred: true,
        }));
    }

    const branchMetadataRows = db
      .prepare(
        `SELECT metadata
         FROM task_activities
         WHERE task_id = ? AND metadata IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all(taskId) as Array<{ metadata: string | null }>;

    let branches = Array.from(
      new Set(
        branchMetadataRows.flatMap((row) => extractBranchNames(row.metadata)),
      ),
    );

    const repoPath = getWorkspaceRepoPath(task.workspace_repo || null);
    const hasRepo = Boolean(repoPath && isGitWorkTree(repoPath));

    const changedFiles = Array.from(
      new Set(
        deliverables
          .filter((d) => d.deliverable_type === 'file' && d.path)
          .map((d) => {
            const filePath = String(d.path);
            if (!repoPath || !path.isAbsolute(filePath)) {
              return filePath;
            }
            const relativePath = path.relative(repoPath, filePath);
            if (!relativePath || relativePath.startsWith('..')) {
              return filePath;
            }
            return relativePath;
          }),
      ),
    );

    let commits: CommitInfo[] = [];
    const diagnostics: {
      branch_source: 'metadata' | 'git_discovery' | 'none';
      files_source: 'deliverables' | 'git_diff' | 'none';
      commits_source: 'task_since' | 'branch_scoped' | 'none';
      repo_found: boolean;
    } = {
      branch_source: branches.length > 0 ? 'metadata' : 'none',
      files_source: changedFiles.length > 0 ? 'deliverables' : 'none',
      commits_source: 'none',
      repo_found: hasRepo,
    };

    const branchDetails = new Map<string, BranchDetail>();

    const resolveDefaultBranch = (): string => {
      if (!repoPath) return 'main';
      try {
        execFileSync('git', ['rev-parse', '--verify', 'main'], { cwd: repoPath, encoding: 'utf8', timeout: 3000 });
        return 'main';
      } catch {
        return 'master';
      }
    };

    if (hasRepo && repoPath) {
      const defaultBranch = resolveDefaultBranch();

      if (branches.length === 0) {
        try {
          const raw = execFileSync(
            'git',
            ['branch', '--list', `task/${task.id}*`, `mc/${task.id}*`, '--format=%(refname:short)'],
            { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
          );
          const discovered = raw
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
          if (discovered.length > 0) {
            branches = Array.from(new Set(discovered));
            diagnostics.branch_source = 'git_discovery';
          }
        } catch {
        }
      }

      for (const branch of branches) {
        let local = false;
        let remote = false;
        try {
          execFileSync('git', ['show-ref', '--verify', `refs/heads/${branch}`], { cwd: repoPath, encoding: 'utf8', timeout: 3000 });
          local = true;
        } catch {
        }
        try {
          const lsRemote = execFileSync('git', ['ls-remote', '--heads', 'origin', branch], { cwd: repoPath, encoding: 'utf8', timeout: 5000 });
          remote = lsRemote.trim().length > 0;
        } catch {
        }
        branchDetails.set(branch, { name: branch, local, remote });
      }

      if (changedFiles.length === 0) {
        const localBranch = Array.from(branchDetails.values()).find((item) => item.local)?.name;
        if (localBranch) {
          try {
            const raw = execFileSync(
              'git',
              ['diff', '--name-only', `${defaultBranch}...${localBranch}`],
              { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
            );
            const diffFiles = raw
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean);
            if (diffFiles.length > 0) {
              changedFiles.push(...diffFiles);
              diagnostics.files_source = 'git_diff';
            }
          } catch {
          }
        }
      }

      try {
        const localBranch = Array.from(branchDetails.values()).find((item) => item.local)?.name;
        if (localBranch) {
          const raw = execFileSync(
            'git',
            ['log', `${defaultBranch}...${localBranch}`, '--pretty=format:%h%x09%s%x09%an%x09%ad', '--date=short', '-n', '30'],
            { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
          );
          commits = parseGitLog(raw);
          diagnostics.commits_source = 'branch_scoped';
        }

        if (commits.length === 0) {
          const raw = execFileSync(
            'git',
            ['log', `--since=${task.created_at}`, '--pretty=format:%h%x09%s%x09%an%x09%ad', '--date=short', '-n', '30'],
            { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
          );
          commits = parseGitLog(raw);
          if (commits.length > 0) diagnostics.commits_source = 'task_since';
        }
      } catch (error) {
        console.error('Failed to read git commits for task changes:', error);
      }
    }

    const uniqueChangedFiles = Array.from(new Set(changedFiles));
    if (uniqueChangedFiles.length === 0 && diagnostics.files_source === 'none' && deliverables.length > 0) {
      diagnostics.files_source = 'deliverables';
    }

    return NextResponse.json({
      task: {
        id: task.id,
        title: task.title,
        created_at: task.created_at,
      },
      workspace: {
        id: task.workspace_id,
        name: task.workspace_name || null,
        slug: task.workspace_slug || null,
        organization: task.workspace_org || null,
        repo: task.workspace_repo || null,
        repo_path: hasRepo ? repoPath : null,
      },
      summary: {
        sessions_count: Array.isArray(sessions) ? sessions.length : 0,
        deliverables_count: deliverables.length,
        changed_files_count: uniqueChangedFiles.length,
        commits_count: commits.length,
        branch_count: branches.length,
      },
      diagnostics,
      branches,
      branch_details: Array.from(branchDetails.values()),
      changed_files: uniqueChangedFiles,
      commits,
      sessions,
      deliverables,
    });
  } catch (error) {
    console.error('Failed to fetch task changes:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
