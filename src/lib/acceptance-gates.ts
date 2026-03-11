import { queryAll, queryOne, run } from '@/lib/db';
import type { TaskStatus } from '@/lib/types';

export interface CriteriaRow {
  id: string;
  task_id: string;
  description: string;
  is_met: number;
  sort_order: number;
  parent_criteria_id: string | null;
  required_for_status: string | null;
  gate_type: string | null;
  artifact_key: string | null;
  created_at: string;
}

export function loadCriteria(taskId: string): CriteriaRow[] {
  return queryAll<CriteriaRow>(
    `SELECT id, task_id, description, is_met, sort_order, parent_criteria_id, required_for_status, gate_type, artifact_key, created_at
     FROM task_acceptance_criteria
     WHERE task_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [taskId],
  );
}

function hasArtifact(taskId: string, key: string): boolean {
  if (!key) return false;
  const found = queryOne<{ id: string }>(
    `SELECT id FROM task_artifacts
     WHERE task_id = ? AND lower(artifact_key) = lower(?)
     LIMIT 1`,
    [taskId, key],
  );
  return Boolean(found?.id);
}

function criterionMet(taskId: string, row: CriteriaRow): boolean {
  const gateType = (row.gate_type || 'manual').toLowerCase();
  if (gateType === 'artifact') {
    return row.is_met === 1 || (row.artifact_key ? hasArtifact(taskId, row.artifact_key) : false);
  }
  return row.is_met === 1;
}

export interface AcceptanceGateResult {
  ok: boolean;
  target_status: string;
  missing: Array<{ id: string; description: string; gate_type: string; artifact_key: string | null; parent_criteria_id: string | null }>;
}

export function evaluateAcceptanceGates(taskId: string, targetStatus: TaskStatus): AcceptanceGateResult {
  const criteria = loadCriteria(taskId);
  if (criteria.length === 0) {
    return { ok: true, target_status: targetStatus, missing: [] };
  }

  const relevant = criteria.filter((row) => {
    const required = (row.required_for_status || 'done') as TaskStatus;
    return required === targetStatus;
  });

  if (relevant.length === 0) {
    return { ok: true, target_status: targetStatus, missing: [] };
  }

  const byParent = new Map<string, CriteriaRow[]>();
  for (const row of relevant) {
    const parentId = row.parent_criteria_id || '__root__';
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)?.push(row);
  }

  const missing: AcceptanceGateResult['missing'] = [];
  const roots = byParent.get('__root__') || [];
  for (const root of roots) {
    const children = byParent.get(root.id) || [];
    const childrenMet = children.length === 0 ? true : children.every((child) => criterionMet(taskId, child));
    const rootMet = criterionMet(taskId, root);
    const met = children.length > 0 ? childrenMet : rootMet;
    if (!met) {
      missing.push({
        id: root.id,
        description: root.description,
        gate_type: root.gate_type || 'manual',
        artifact_key: root.artifact_key,
        parent_criteria_id: root.parent_criteria_id,
      });
    }
  }

  return { ok: missing.length === 0, target_status: targetStatus, missing };
}

export function createDefaultSubcriteria(taskId: string, parentId: string, parentDescription: string, requiredForStatus: TaskStatus): void {
  const now = new Date().toISOString();
  const short = parentId.slice(0, 8);
  const verifierId = crypto.randomUUID();
  run(
    `INSERT INTO task_acceptance_criteria
      (id, task_id, description, is_met, sort_order, parent_criteria_id, required_for_status, gate_type, artifact_key, created_at)
     VALUES (?, ?, ?, 0, 1000, ?, ?, 'verifier', NULL, ?)`,
    [verifierId, taskId, `Verifier confirms: ${parentDescription}`, parentId, requiredForStatus, now],
  );

  const artifactId = crypto.randomUUID();
  run(
    `INSERT INTO task_acceptance_criteria
      (id, task_id, description, is_met, sort_order, parent_criteria_id, required_for_status, gate_type, artifact_key, created_at)
     VALUES (?, ?, ?, 0, 1001, ?, ?, 'artifact', ?, ?)`,
    [artifactId, taskId, `Evidence recorded for: ${parentDescription}`, parentId, requiredForStatus, `criteria.${short}.evidence`, now],
  );
}
