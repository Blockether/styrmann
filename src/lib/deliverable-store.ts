import pathModule from 'path';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs';
import type Database from 'better-sqlite3';

const MAX_STORE_FILE_SIZE = 10 * 1024 * 1024;

function getStoreBaseDir(): string {
const dbPath = process.env.STYRMAN_DATABASE_PATH || pathModule.join(process.cwd(), 'styrman.db');
  return pathModule.join(pathModule.dirname(pathModule.resolve(dbPath)), 'deliverable-store');
}

export function getDeliverableStoreDir(): string {
  return getStoreBaseDir();
}

export function resolveDeliverablePath(
  db: Database.Database,
  taskId: string,
  rawPath: string,
): string {
  const expanded = rawPath.replace(/^~/, process.env.HOME || '');

  if (expanded.startsWith('/')) return expanded;

  const sessionMeta = db.prepare(
    `SELECT json_extract(metadata, '$.worktree_path') as worktree_path
     FROM sessions
     WHERE task_id = ? AND json_extract(metadata, '$.worktree_path') IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(taskId) as { worktree_path?: string } | undefined;

  if (sessionMeta?.worktree_path) {
    return pathModule.resolve(sessionMeta.worktree_path, expanded);
  }

  const taskRow = db.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(taskId) as { workspace_id?: string } | undefined;
  if (taskRow?.workspace_id) {
    const workspace = db.prepare(
      'SELECT local_path, github_repo FROM workspaces WHERE id = ?'
    ).get(taskRow.workspace_id) as { local_path?: string; github_repo?: string } | undefined;
    const repoBase = workspace?.local_path || workspace?.github_repo;
    if (repoBase) {
      return pathModule.resolve(repoBase.replace(/^~/, process.env.HOME || ''), expanded);
    }
  }

  return expanded;
}

export function storeDeliverableFile(
  taskId: string,
  deliverableId: string,
  sourcePath: string,
): string | null {
  if (!existsSync(sourcePath)) return null;

  try {
    const stats = statSync(sourcePath);
    if (!stats.isFile() || stats.size > MAX_STORE_FILE_SIZE) return null;
  } catch {
    return null;
  }

  const storeDir = pathModule.join(getStoreBaseDir(), taskId);
  mkdirSync(storeDir, { recursive: true });

  const fileName = pathModule.basename(sourcePath);
  const destPath = pathModule.join(storeDir, `${deliverableId}_${fileName}`);
  copyFileSync(sourcePath, destPath);

  return destPath;
}
