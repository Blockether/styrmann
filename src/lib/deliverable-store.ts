import pathModule from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import type Database from 'better-sqlite3';

const MAX_STORE_FILE_SIZE = 10 * 1024 * 1024;

export interface StoredDeliverableFile {
  content: Buffer;
  fileName: string;
  fileSize: number;
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
  _taskId: string,
  _deliverableId: string,
  sourcePath: string,
): StoredDeliverableFile | null {
  if (!existsSync(sourcePath)) return null;

  let fileSize = 0;
  try {
    const stats = statSync(sourcePath);
    if (!stats.isFile() || stats.size > MAX_STORE_FILE_SIZE) return null;
    fileSize = stats.size;
  } catch {
    return null;
  }

  try {
    const content = readFileSync(sourcePath);
    const fileName = pathModule.basename(sourcePath);
    return {
      content,
      fileName,
      fileSize,
    };
  } catch {
    return null;
  }
}

export function getDeliverableContent(
  db: Database.Database,
  deliverableId: string,
): StoredDeliverableFile | null {
  const row = db.prepare(
    `SELECT content, file_name, file_size
     FROM task_deliverables
     WHERE id = ? AND content IS NOT NULL
     LIMIT 1`
  ).get(deliverableId) as {
    content?: Buffer | Uint8Array | null;
    file_name?: string | null;
    file_size?: number | null;
  } | undefined;

  if (!row?.content) return null;
  const content = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
  return {
    content,
    fileName: row.file_name || '',
    fileSize: typeof row.file_size === 'number' ? row.file_size : content.length,
  };
}
