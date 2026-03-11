import { queryAll } from '@/lib/db';
import { getTaskWorkflow } from '@/lib/workflow-engine';

interface TaskArtifactRow {
  artifact_key: string;
  artifact_value: string;
}

function normalizeArtifactKey(value: string): string {
  return value.trim().toLowerCase();
}

function readMetadataEvidence(taskId: string): Record<string, string> {
  const rows = queryAll<{ metadata: string | null }>(
    `SELECT metadata
     FROM task_activities
     WHERE task_id = ? AND metadata IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 120`,
    [taskId],
  );

  const evidence: Record<string, string> = {};
  for (const row of rows) {
    if (!row.metadata) continue;
    try {
      const parsed = JSON.parse(row.metadata) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        const normalized = normalizeArtifactKey(key);
        if (value === null || value === undefined) continue;
        if (typeof value === 'string' && value.trim().length > 0) {
          evidence[normalized] = value.trim();
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          evidence[normalized] = String(value);
        }
      }
    } catch {
    }
  }
  return evidence;
}

function readArtifactRows(taskId: string, status: string): TaskArtifactRow[] {
  try {
    return queryAll<TaskArtifactRow>(
      `SELECT artifact_key, artifact_value
       FROM task_artifacts
       WHERE task_id = ? AND (stage_status IS NULL OR stage_status = ?)
       ORDER BY updated_at DESC`,
      [taskId, status],
    );
  } catch {
    return [];
  }
}

export interface StageGateValidationResult {
  ok: boolean;
  target_status: string;
  required_artifacts: string[];
  missing_artifacts: string[];
  evidence: Record<string, string>;
}

export function validateStageGates(taskId: string, targetStatus: string): StageGateValidationResult {
  const workflow = getTaskWorkflow(taskId);
  const stage = workflow?.stages.find((item) => item.status === targetStatus);
  const required = Array.from(new Set([
    ...(Array.isArray(stage?.required_artifacts) ? stage.required_artifacts : []),
    ...(Array.isArray(stage?.required_fields) ? stage.required_fields : []),
  ].map(normalizeArtifactKey).filter(Boolean)));

  if (required.length === 0) {
    return {
      ok: true,
      target_status: targetStatus,
      required_artifacts: [],
      missing_artifacts: [],
      evidence: {},
    };
  }

  const evidence: Record<string, string> = {};
  for (const artifact of readArtifactRows(taskId, targetStatus)) {
    const key = normalizeArtifactKey(artifact.artifact_key);
    if (!key) continue;
    const value = (artifact.artifact_value || '').trim();
    if (!value) continue;
    evidence[key] = value;
  }

  const metadataEvidence = readMetadataEvidence(taskId);
  for (const [key, value] of Object.entries(metadataEvidence)) {
    if (!evidence[key]) evidence[key] = value;
  }

  const aliases: Record<string, string[]> = {
    commit_sha: ['commit', 'git_commit', 'git_commit_sha', 'sha'],
    branch: ['git_branch'],
    push_confirmed: ['pushed', 'push_success', 'push_ok'],
    deploy_signature: ['deployment_signature', 'tx_signature'],
    smoke_test_result: ['smoke_test_passed', 'smoke_test'],
  };

  const missing: string[] = [];
  for (const key of required) {
    if (evidence[key]) continue;
    const aliasKeys = aliases[key] || [];
    const foundAlias = aliasKeys.find((alias) => evidence[alias]);
    if (!foundAlias) missing.push(key);
  }

  return {
    ok: missing.length === 0,
    target_status: targetStatus,
    required_artifacts: required,
    missing_artifacts: missing,
    evidence,
  };
}
