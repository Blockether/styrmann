import { queryAll } from '@/lib/db';

export interface TaskDependencyRow {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  required_status: string;
  created_at: string;
  depends_on_task_title?: string | null;
  depends_on_task_status?: string | null;
}

export interface UnresolvedTaskDependency extends TaskDependencyRow {
  is_resolved: false;
}

export function listTaskDependencies(taskId: string): TaskDependencyRow[] {
  try {
    return queryAll<TaskDependencyRow>(
      `SELECT
         d.id,
         d.task_id,
         d.depends_on_task_id,
         d.required_status,
         d.created_at,
         t.title as depends_on_task_title,
         t.status as depends_on_task_status
       FROM task_dependencies d
       JOIN tasks t ON t.id = d.depends_on_task_id
       WHERE d.task_id = ?
       ORDER BY d.created_at DESC`,
      [taskId],
    );
  } catch {
    return [];
  }
}

export function getUnresolvedTaskDependencies(taskId: string): UnresolvedTaskDependency[] {
  try {
    return queryAll<UnresolvedTaskDependency>(
      `SELECT
         d.id,
         d.task_id,
         d.depends_on_task_id,
         d.required_status,
         d.created_at,
         t.title as depends_on_task_title,
         t.status as depends_on_task_status,
         0 as is_resolved
       FROM task_dependencies d
       JOIN tasks t ON t.id = d.depends_on_task_id
       WHERE d.task_id = ?
         AND t.status != d.required_status
       ORDER BY d.created_at DESC`,
      [taskId],
    );
  } catch {
    return [];
  }
}
