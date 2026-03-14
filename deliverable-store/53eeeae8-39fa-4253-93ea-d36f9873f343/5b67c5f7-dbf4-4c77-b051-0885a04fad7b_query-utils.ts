import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import type {
  ProjectLearning,
  AgentMemory,
  TaskCodeContext,
  AcceptanceEvidence,
  EntityLinking,
  CriteriaEvaluation,
  CreateLearningInput,
  CreateMemoryInput,
  CreateCodeContextInput,
  CreateEvidenceInput,
  CreateLinkingInput,
} from './types';

// ---------------------------------------------------------------------------
// Project Learnings
// ---------------------------------------------------------------------------

export function createLearning(input: CreateLearningInput): ProjectLearning {
  const id = uuidv4();
  const now = new Date().toISOString();

  run(
    `INSERT INTO project_learnings
       (id, workspace_id, task_id, agent_id, session_id, learning_type,
        title, summary, detail, confidence, tags, related_file_paths,
        related_task_ids, metadata, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      input.workspace_id,
      input.task_id || null,
      input.agent_id || null,
      input.session_id || null,
      input.learning_type,
      input.title,
      input.summary,
      input.detail || null,
      input.confidence ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.related_file_paths ? JSON.stringify(input.related_file_paths) : null,
      input.related_task_ids ? JSON.stringify(input.related_task_ids) : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
    ],
  );

  return queryOne<ProjectLearning>('SELECT * FROM project_learnings WHERE id = ?', [id])!;
}

export function getLearningsForWorkspace(
  workspaceId: string,
  options: { limit?: number; type?: string; activeOnly?: boolean } = {},
): ProjectLearning[] {
  const { limit = 50, type, activeOnly = true } = options;
  const conditions = ['workspace_id = ?'];
  const params: unknown[] = [workspaceId];

  if (activeOnly) {
    conditions.push('is_active = 1');
  }
  if (type) {
    conditions.push('learning_type = ?');
    params.push(type);
  }

  params.push(limit);

  return queryAll<ProjectLearning>(
    `SELECT * FROM project_learnings
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
  );
}

export function getLearningsForFilePaths(
  workspaceId: string,
  filePaths: string[],
  options: { limit?: number; beforeDate?: string } = {},
): ProjectLearning[] {
  const { limit = 10, beforeDate } = options;
  const params: unknown[] = [workspaceId, JSON.stringify(filePaths)];
  let dateClause = '';

  if (beforeDate) {
    dateClause = 'AND pl.created_at < ?';
    params.push(beforeDate);
  }

  params.push(limit);

  return queryAll<ProjectLearning>(
    `SELECT pl.*
     FROM project_learnings pl
     WHERE pl.workspace_id = ?
       AND pl.is_active = 1
       ${dateClause}
       AND EXISTS (
         SELECT 1
         FROM json_each(pl.related_file_paths) plf
         INNER JOIN json_each(?) tf ON plf.value = tf.value
       )
     ORDER BY pl.confidence DESC, pl.created_at DESC
     LIMIT ?`,
    params,
  );
}

export function archiveLearning(learningId: string): void {
  run(
    `UPDATE project_learnings SET is_active = 0, updated_at = datetime('now') WHERE id = ?`,
    [learningId],
  );
}

// ---------------------------------------------------------------------------
// Agent Memories
// ---------------------------------------------------------------------------

export function createMemory(input: CreateMemoryInput): AgentMemory {
  const id = uuidv4();
  const now = new Date().toISOString();

  run(
    `INSERT INTO agent_memories
       (id, agent_id, workspace_id, task_id, memory_type,
        title, content, relevance_tags, recall_count,
        last_accessed_at, expires_at, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`,
    [
      id,
      input.agent_id,
      input.workspace_id || null,
      input.task_id || null,
      input.memory_type,
      input.title,
      input.content,
      input.relevance_tags ? JSON.stringify(input.relevance_tags) : null,
      input.expires_at || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
    ],
  );

  return queryOne<AgentMemory>('SELECT * FROM agent_memories WHERE id = ?', [id])!;
}

export function getMemoriesForAgent(
  agentId: string,
  workspaceId: string | null,
  options: { limit?: number; type?: string } = {},
): AgentMemory[] {
  const { limit = 15, type } = options;
  const conditions = ['am.agent_id = ?', "(am.workspace_id = ? OR am.workspace_id IS NULL)"];
  const params: unknown[] = [agentId, workspaceId];

  conditions.push("(am.expires_at IS NULL OR am.expires_at > datetime('now'))");

  if (type) {
    conditions.push('am.memory_type = ?');
    params.push(type);
  }

  params.push(limit);

  return queryAll<AgentMemory>(
    `SELECT am.*
     FROM agent_memories am
     WHERE ${conditions.join(' AND ')}
     ORDER BY am.recall_count DESC, am.updated_at DESC
     LIMIT ?`,
    params,
  );
}

export function bumpMemoryRecall(memoryIds: string[]): void {
  if (memoryIds.length === 0) return;

  const placeholders = memoryIds.map(() => '?').join(', ');
  run(
    `UPDATE agent_memories
     SET recall_count = recall_count + 1,
         last_accessed_at = datetime('now')
     WHERE id IN (${placeholders})`,
    memoryIds,
  );
}

// ---------------------------------------------------------------------------
// Task Code Context
// ---------------------------------------------------------------------------

export function addCodeContext(input: CreateCodeContextInput): TaskCodeContext {
  const id = uuidv4();
  const now = new Date().toISOString();

  run(
    `INSERT INTO task_code_context
       (id, task_id, workspace_id, file_path, commit_sha,
        change_summary, change_type, language, symbols,
        diff_stats, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.task_id,
      input.workspace_id,
      input.file_path,
      input.commit_sha || null,
      input.change_summary || null,
      input.change_type || null,
      input.language || null,
      input.symbols ? JSON.stringify(input.symbols) : null,
      input.diff_stats ? JSON.stringify(input.diff_stats) : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
    ],
  );

  return queryOne<TaskCodeContext>('SELECT * FROM task_code_context WHERE id = ?', [id])!;
}

export function getCodeContextForTask(taskId: string): TaskCodeContext[] {
  return queryAll<TaskCodeContext>(
    'SELECT * FROM task_code_context WHERE task_id = ? ORDER BY created_at DESC',
    [taskId],
  );
}

export function getRelatedTasksByFilePaths(
  taskId: string,
  workspaceId: string,
  options: { limit?: number } = {},
): Array<{ task_id: string; title: string; status: string; change_summary: string | null }> {
  const { limit = 10 } = options;

  return queryAll(
    `SELECT DISTINCT t.id AS task_id, t.title, t.status, tcc2.change_summary
     FROM task_code_context tcc1
     INNER JOIN task_code_context tcc2 ON tcc1.file_path = tcc2.file_path
     INNER JOIN tasks t ON tcc2.task_id = t.id
     WHERE tcc1.task_id = ?
       AND tcc2.task_id != ?
       AND tcc2.workspace_id = ?
     ORDER BY tcc2.created_at DESC
     LIMIT ?`,
    [taskId, taskId, workspaceId, limit],
  );
}

// ---------------------------------------------------------------------------
// Acceptance Evidence
// ---------------------------------------------------------------------------

export function addEvidence(input: CreateEvidenceInput): AcceptanceEvidence {
  const id = uuidv4();
  const now = new Date().toISOString();

  run(
    `INSERT INTO acceptance_evidence
       (id, criteria_id, task_id, evidence_type, evidence_ref_id,
        evidence_ref_type, summary, is_positive, verified_by,
        metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.criteria_id,
      input.task_id,
      input.evidence_type,
      input.evidence_ref_id || null,
      input.evidence_ref_type || null,
      input.summary,
      input.is_positive !== false ? 1 : 0,
      input.verified_by || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
    ],
  );

  return queryOne<AcceptanceEvidence>('SELECT * FROM acceptance_evidence WHERE id = ?', [id])!;
}

export function evaluateCriteria(taskId: string): CriteriaEvaluation[] {
  return queryAll<CriteriaEvaluation>(
    `SELECT
       tac.id AS criteria_id,
       tac.description,
       tac.is_met,
       tac.gate_type,
       tac.artifact_key,
       COUNT(ae.id) AS evidence_count,
       SUM(CASE WHEN ae.is_positive = 1 THEN 1 ELSE 0 END) AS positive_evidence,
       SUM(CASE WHEN ae.is_positive = 0 THEN 1 ELSE 0 END) AS negative_evidence,
       CASE
         WHEN tac.gate_type = 'artifact' AND EXISTS (
           SELECT 1 FROM task_artifacts ta
           WHERE ta.task_id = tac.task_id AND ta.artifact_key = tac.artifact_key
         ) THEN 1
         WHEN tac.gate_type = 'test' AND EXISTS (
           SELECT 1 FROM acceptance_evidence ae2
           WHERE ae2.criteria_id = tac.id AND ae2.evidence_type = 'test_result' AND ae2.is_positive = 1
         ) THEN 1
         WHEN tac.gate_type = 'verifier' AND EXISTS (
           SELECT 1 FROM acceptance_evidence ae3
           WHERE ae3.criteria_id = tac.id AND ae3.evidence_type = 'manual_verification' AND ae3.is_positive = 1
         ) THEN 1
         ELSE tac.is_met
       END AS computed_is_met
     FROM task_acceptance_criteria tac
     LEFT JOIN acceptance_evidence ae ON ae.criteria_id = tac.id
     WHERE tac.task_id = ?
     GROUP BY tac.id
     ORDER BY tac.sort_order ASC`,
    [taskId],
  );
}

// ---------------------------------------------------------------------------
// Entity Linkings
// ---------------------------------------------------------------------------

export function createLinking(input: CreateLinkingInput): EntityLinking {
  const id = uuidv4();
  const now = new Date().toISOString();

  run(
    `INSERT OR IGNORE INTO entity_linkings
       (id, workspace_id, source_type, source_id, target_type, target_id,
        link_type, explanation, metadata, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.workspace_id,
      input.source_type,
      input.source_id,
      input.target_type,
      input.target_id,
      input.link_type,
      input.explanation || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.created_by || null,
      now,
    ],
  );

  return queryOne<EntityLinking>(
    `SELECT * FROM entity_linkings
     WHERE source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND link_type = ?`,
    [input.source_type, input.source_id, input.target_type, input.target_id, input.link_type],
  )!;
}

export function getLinkingsForEntity(
  entityType: string,
  entityId: string,
  options: { direction?: 'outgoing' | 'incoming' | 'both'; linkType?: string; limit?: number } = {},
): EntityLinking[] {
  const { direction = 'both', linkType, limit = 50 } = options;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (direction === 'outgoing') {
    conditions.push('(source_type = ? AND source_id = ?)');
    params.push(entityType, entityId);
  } else if (direction === 'incoming') {
    conditions.push('(target_type = ? AND target_id = ?)');
    params.push(entityType, entityId);
  } else {
    conditions.push('((source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?))');
    params.push(entityType, entityId, entityType, entityId);
  }

  if (linkType) {
    conditions.push('link_type = ?');
    params.push(linkType);
  }

  params.push(limit);

  return queryAll<EntityLinking>(
    `SELECT * FROM entity_linkings
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
  );
}

export function deleteLinking(linkingId: string): void {
  run('DELETE FROM entity_linkings WHERE id = ?', [linkingId]);
}
