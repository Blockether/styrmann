import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { queryAll, queryOne, run, transaction } from '@/lib/db';
import type { Task, TaskActivity, TaskDeliverable } from '@/lib/types';

const MAX_TEXT_CAPTURE_BYTES = 1024 * 1024;
const MAX_BINARY_CAPTURE_BYTES = 256 * 1024;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.log': 'text/plain',
};

const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.csv', '.log', '.json', '.xml', '.yaml', '.yml',
  '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.py', '.rb', '.go', '.rs',
  '.java', '.c', '.cpp', '.h', '.sh', '.bash', '.zsh', '.fish', '.toml', '.ini',
  '.cfg', '.conf', '.env.example', '.gitignore', '.dockerfile', '.sql', '.clj',
  '.cljs', '.cljc', '.edn', '.ex', '.exs', '.hs', '.lua', '.r', '.swift', '.html', '.htm',
]);

type TaskRunResultRow = {
  id: string;
  task_id: string;
  run_number: number;
  status: string;
  summary?: string | null;
  agent_id?: string | null;
  session_id?: string | null;
  completed_activity_id?: string | null;
  metadata?: string | null;
  created_at: string;
};

export type StoredTaskRunArtifact = {
  id: string;
  task_run_result_id: string;
  task_id: string;
  deliverable_id?: string | null;
  title: string;
  path?: string | null;
  normalized_path?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  encoding?: string | null;
  content_text?: string | null;
  content_base64?: string | null;
  metadata?: string | null;
  created_at: string;
};

function normalizeFilePath(filePath: string): string {
  return path.normalize(filePath.replace(/^~/, process.env.HOME || ''));
}

function captureArtifact(deliverable: TaskDeliverable) {
  const rawPath = deliverable.path || null;
  if (!rawPath) {
    return {
      normalizedPath: null,
      contentType: null,
      sizeBytes: null,
      encoding: 'none',
      contentText: null,
      contentBase64: null,
      metadata: JSON.stringify({ source_status: 'missing_path' }),
    };
  }

  const normalizedPath = normalizeFilePath(rawPath);
  if (!existsSync(normalizedPath)) {
    return {
      normalizedPath,
      contentType: null,
      sizeBytes: null,
      encoding: 'none',
      contentText: null,
      contentBase64: null,
      metadata: JSON.stringify({ source_status: 'file_missing' }),
    };
  }

  const stats = statSync(normalizedPath);
  if (stats.isDirectory()) {
    return {
      normalizedPath,
      contentType: null,
      sizeBytes: null,
      encoding: 'none',
      contentText: null,
      contentBase64: null,
      metadata: JSON.stringify({ source_status: 'directory' }),
    };
  }

  const ext = path.extname(normalizedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const isText = TEXT_EXTENSIONS.has(ext)
    || contentType.startsWith('text/')
    || contentType === 'application/json'
    || contentType === 'application/javascript'
    || contentType === 'application/xml'
    || contentType === 'application/yaml';

  if (isText) {
    if (stats.size > MAX_TEXT_CAPTURE_BYTES) {
      return {
        normalizedPath,
        contentType,
        sizeBytes: stats.size,
        encoding: 'none',
        contentText: null,
        contentBase64: null,
        metadata: JSON.stringify({ source_status: 'too_large', max_bytes: MAX_TEXT_CAPTURE_BYTES }),
      };
    }

    return {
      normalizedPath,
      contentType,
      sizeBytes: stats.size,
      encoding: 'utf-8',
      contentText: readFileSync(normalizedPath, 'utf-8'),
      contentBase64: null,
      metadata: JSON.stringify({ source_status: 'captured' }),
    };
  }

  if (stats.size > MAX_BINARY_CAPTURE_BYTES) {
    return {
      normalizedPath,
      contentType,
      sizeBytes: stats.size,
      encoding: 'none',
      contentText: null,
      contentBase64: null,
      metadata: JSON.stringify({ source_status: 'too_large', max_bytes: MAX_BINARY_CAPTURE_BYTES }),
    };
  }

  return {
    normalizedPath,
    contentType,
    sizeBytes: stats.size,
    encoding: 'base64',
    contentText: null,
    contentBase64: readFileSync(normalizedPath).toString('base64'),
    metadata: JSON.stringify({ source_status: 'captured_binary' }),
  };
}

export function captureTaskRunResult(taskId: string): TaskRunResultRow | null {
  const task = queryOne<Task & { assigned_agent_name?: string | null }>(
    `SELECT t.*, a.name as assigned_agent_name
     FROM tasks t
     LEFT JOIN agents a ON a.id = t.assigned_agent_id
     WHERE t.id = ?`,
    [taskId],
  );

  if (!task) return null;

  const recentActivities = queryAll<TaskActivity>(
    `SELECT * FROM task_activities
     WHERE task_id = ?
     ORDER BY created_at DESC
     LIMIT 12`,
    [taskId],
  );

  const completedActivity = queryOne<TaskActivity>(
    `SELECT * FROM task_activities
     WHERE task_id = ? AND activity_type = 'completed'
     ORDER BY created_at DESC
     LIMIT 1`,
    [taskId],
  );

  const deliverables = queryAll<TaskDeliverable>(
    `SELECT * FROM task_deliverables
     WHERE task_id = ?
     ORDER BY created_at ASC`,
    [taskId],
  );

  const session = queryOne<{ session_id?: string | null }>(
    `SELECT session_id
     FROM sessions
     WHERE task_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [taskId],
  );

  const previousRuns = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM task_run_results WHERE task_id = ?',
    [taskId],
  )?.count || 0;

  const runId = crypto.randomUUID();
  const runNumber = previousRuns + 1;
  const createdAt = new Date().toISOString();
  const summary = completedActivity?.message || task.status_reason || `Run ${runNumber} completed`;

  const metadata = JSON.stringify({
    task: {
      id: task.id,
      title: task.title,
      task_type: task.task_type,
      priority: task.priority,
      status: task.status,
      workspace_id: task.workspace_id,
      assigned_agent_id: task.assigned_agent_id,
      assigned_agent_name: task.assigned_agent_name || null,
    },
    recent_activities: recentActivities.map((activity) => ({
      id: activity.id,
      activity_type: activity.activity_type,
      message: activity.message,
      metadata: activity.metadata || null,
      created_at: activity.created_at,
    })),
    deliverables: deliverables.map((deliverable) => ({
      id: deliverable.id,
      title: deliverable.title,
      path: deliverable.path || null,
      deliverable_type: deliverable.deliverable_type,
      description: deliverable.description || null,
      created_at: deliverable.created_at,
    })),
  });

  transaction(() => {
    run(
      `INSERT INTO task_run_results (
        id, task_id, run_number, status, summary, agent_id,
        session_id, completed_activity_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        taskId,
        runNumber,
        task.status,
        summary,
        task.assigned_agent_id,
        session?.session_id || null,
        completedActivity?.id || null,
        metadata,
        createdAt,
      ],
    );

    for (const deliverable of deliverables) {
      const artifact = captureArtifact(deliverable);
      run(
        `INSERT INTO task_run_result_artifacts (
          id, task_run_result_id, task_id, deliverable_id, title, path, normalized_path,
          content_type, size_bytes, encoding, content_text, content_base64, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          runId,
          taskId,
          deliverable.id,
          deliverable.title,
          deliverable.path || null,
          artifact.normalizedPath,
          artifact.contentType,
          artifact.sizeBytes,
          artifact.encoding,
          artifact.contentText,
          artifact.contentBase64,
          artifact.metadata,
          createdAt,
        ],
      );
    }
  });

  return queryOne<TaskRunResultRow>('SELECT * FROM task_run_results WHERE id = ?', [runId]) || null;
}

export function getStoredArtifactByPath(filePath: string): StoredTaskRunArtifact | null {
  const normalizedPath = normalizeFilePath(filePath);
  return queryOne<StoredTaskRunArtifact>(
    `SELECT * FROM task_run_result_artifacts
     WHERE normalized_path = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalizedPath],
  ) || null;
}
