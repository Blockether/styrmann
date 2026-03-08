import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import { getDb } from '@/lib/db';
import { getWorkspaceRepoPath, isGitWorkTree } from '@/lib/git-repo';

export const dynamic = 'force-dynamic';

interface CommitInfo {
  hash: string;
  subject: string;
  author: string;
  date: string;
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

    const sessions = db
      .prepare(
        `SELECT id, openclaw_session_id, status, created_at, ended_at
         FROM openclaw_sessions
         WHERE task_id = ? AND session_type = 'subagent'
         ORDER BY created_at DESC`,
      )
      .all(taskId);

    const repoPath = getWorkspaceRepoPath(task.workspace_repo || null);
    const hasRepo = Boolean(repoPath && isGitWorkTree(repoPath));

    let commits: CommitInfo[] = [];
    if (hasRepo && repoPath) {
      try {
        const raw = execFileSync(
          'git',
          [
            'log',
            `--since=${task.created_at}`,
            '--pretty=format:%h%x09%s%x09%an%x09%ad',
            '--date=short',
            '-n',
            '30',
          ],
          { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
        );
        commits = parseGitLog(raw);
      } catch (error) {
        console.error('Failed to read git commits for task changes:', error);
      }
    }

    const changedFiles = Array.from(
      new Set(
        deliverables
          .filter((d) => d.deliverable_type === 'file' && d.path)
          .map((d) => d.path as string),
      ),
    );

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
        changed_files_count: changedFiles.length,
        commits_count: commits.length,
      },
      changed_files: changedFiles,
      commits,
      sessions,
      deliverables,
    });
  } catch (error) {
    console.error('Failed to fetch task changes:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
