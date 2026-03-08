import { execFileSync } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';
import { queryOne } from '@/lib/db';
import { getProjectsPath } from '@/lib/config';

type TaskEvidenceRow = {
  id: string;
  created_at: string;
  workspace_id: string;
  workspace_repo?: string | null;
};

export type BuilderEvidenceCheck = {
  ok: boolean;
  has_commit: boolean;
  has_workspace_file: boolean;
};

function hasRepoCommitSince(repoPath: string, sinceIso: string): boolean {
  try {
    const output = execFileSync(
      'git',
      ['log', `--since=${sinceIso}`, '--pretty=format:%h', '-n', '1'],
      { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
    ).trim();
    return Boolean(output);
  } catch {
    return false;
  }
}

export function checkBuilderEvidence(taskId: string): BuilderEvidenceCheck {
  const task = queryOne<TaskEvidenceRow>(
    `SELECT t.id, t.created_at, t.workspace_id, w.github_repo as workspace_repo
     FROM tasks t
     LEFT JOIN workspaces w ON w.id = t.workspace_id
     WHERE t.id = ?`,
    [taskId],
  );

  if (!task) {
    return { ok: false, has_commit: false, has_workspace_file: false };
  }

  const workspaceFile = queryOne<{ id: string }>(
    `SELECT id
     FROM task_deliverables
     WHERE task_id = ? AND deliverable_type = 'file' AND path IS NOT NULL AND TRIM(path) != ''
     LIMIT 1`,
    [taskId],
  );
  const hasWorkspaceFile = Boolean(workspaceFile);

  let hasCommit = false;
  const projectsPath = getProjectsPath();
  const repoRel = task.workspace_repo || '';
  if (repoRel) {
    const repoPath = path.join(projectsPath, repoRel);
    if (existsSync(repoPath) && existsSync(path.join(repoPath, '.git'))) {
      hasCommit = hasRepoCommitSince(repoPath, task.created_at);
    }
  }

  return {
    ok: hasWorkspaceFile || hasCommit,
    has_commit: hasCommit,
    has_workspace_file: hasWorkspaceFile,
  };
}
