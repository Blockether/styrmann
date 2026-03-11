/**
 * Workflow Template Definitions (Hardcoded)
 *
 * These are the canonical workflow pipeline definitions.
 * New workspaces get templates provisioned from these constants,
 * not cloned from another workspace's DB rows.
 */

import Database from 'better-sqlite3';

export interface WorkflowStage {
  id: string;
  label: string;
  role: string | null;
  status: string;
}

export interface WorkflowTemplateDefinition {
  name: string;
  description: string;
  stages: WorkflowStage[];
  failTargets: Record<string, string>;
  isDefault: boolean;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplateDefinition[] = [
  {
    name: 'Simple',
    description: 'Builder implementation -> reviewer quality pass -> human acceptance merge.',
    stages: [
      { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
      { id: 'review', label: 'Review', role: 'reviewer', status: 'review' },
      { id: 'done', label: 'Done', role: null, status: 'done' },
    ],
    failTargets: { review: 'in_progress' },
    isDefault: false,
  },
  {
    name: 'Standard',
    description: 'Builder implementation -> tester validation -> reviewer quality pass -> human acceptance merge.',
    stages: [
      { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
      { id: 'test', label: 'Test', role: 'tester', status: 'testing' },
      { id: 'review', label: 'Review', role: 'reviewer', status: 'review' },
      { id: 'done', label: 'Done', role: null, status: 'done' },
    ],
    failTargets: { testing: 'in_progress', review: 'in_progress' },
    isDefault: false,
  },
  {
    name: 'Strict',
    description: 'Builder -> tester -> reviewer verification -> reviewer final review -> human acceptance merge for critical work.',
    stages: [
      { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
      { id: 'test', label: 'Test', role: 'tester', status: 'testing' },
      { id: 'verify', label: 'Verify', role: 'reviewer', status: 'verification' },
      { id: 'review', label: 'Review', role: 'reviewer', status: 'review' },
      { id: 'done', label: 'Done', role: null, status: 'done' },
    ],
    failTargets: { testing: 'in_progress', verification: 'in_progress', review: 'in_progress' },
    isDefault: true,
  },
  {
    name: 'Auto-Train',
    description: 'Continuous builder loop for repo-improvement iterations. Builder executes repeatedly until stopped.',
    stages: [
      { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
      { id: 'done', label: 'Loop Complete', role: null, status: 'done' },
    ],
    failTargets: {},
    isDefault: false,
  },
  {
    name: 'Architecture',
    description: 'Architecture pipeline: Explorer maps options, Pragmatist reviews simplicity, Guardian reviews correctness, Consolidator synthesizes recommendation.',
    stages: [
      { id: 'explore', label: 'Explore', role: 'explorer', status: 'in_progress' },
      { id: 'simplicity', label: 'Simplicity Review', role: 'pragmatist', status: 'testing' },
      { id: 'correctness', label: 'Correctness Review', role: 'guardian', status: 'verification' },
      { id: 'consolidate', label: 'Consolidate', role: 'consolidator', status: 'review' },
      { id: 'done', label: 'Done', role: null, status: 'done' },
    ],
    failTargets: { testing: 'in_progress', verification: 'in_progress', review: 'in_progress' },
    isDefault: false,
  },
];

/**
 * Provision workflow templates for a workspace from code constants.
 * Skips if the workspace already has templates.
 */
export function provisionWorkflowTemplates(db: Database.Database, workspaceId: string): void {
  const existing = db.prepare(
    'SELECT COUNT(*) as count FROM workflow_templates WHERE workspace_id = ?'
  ).get(workspaceId) as { count: number };

  if (existing.count > 0) return;

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO workflow_templates (id, workspace_id, name, description, stages, fail_targets, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const tpl of WORKFLOW_TEMPLATES) {
    const id = crypto.randomUUID();
    insert.run(
      id,
      workspaceId,
      tpl.name,
      tpl.description,
      JSON.stringify(tpl.stages),
      JSON.stringify(tpl.failTargets),
      tpl.isDefault ? 1 : 0,
      now,
      now,
    );
  }

  console.log(`[WorkflowTemplates] Provisioned ${WORKFLOW_TEMPLATES.length} templates for workspace ${workspaceId}`);
}

export function ensureWorkflowTemplate(db: Database.Database, workspaceId: string, templateName: string): string | null {
  let template = db.prepare(
    'SELECT id FROM workflow_templates WHERE workspace_id = ? AND name = ? LIMIT 1'
  ).get(workspaceId, templateName) as { id: string } | undefined;

  if (!template) {
    const definition = WORKFLOW_TEMPLATES.find((item) => item.name === templateName);
    if (!definition) return null;

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO workflow_templates (id, workspace_id, name, description, stages, fail_targets, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      workspaceId,
      definition.name,
      definition.description,
      JSON.stringify(definition.stages),
      JSON.stringify(definition.failTargets),
      definition.isDefault ? 1 : 0,
      now,
      now,
    );

    template = db.prepare(
      'SELECT id FROM workflow_templates WHERE workspace_id = ? AND name = ? LIMIT 1'
    ).get(workspaceId, templateName) as { id: string } | undefined;
  }

  return template?.id || null;
}
