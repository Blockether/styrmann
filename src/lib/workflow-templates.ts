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
    description: 'Builder only — for quick, straightforward tasks',
    stages: [
      { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
      { id: 'done', label: 'Done', role: null, status: 'done' },
    ],
    failTargets: {},
    isDefault: false,
  },
  {
    name: 'Standard',
    description: 'Builder → Tester → Human Verifier — for most projects',
    stages: [
      { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
      { id: 'test', label: 'Test', role: 'tester', status: 'testing' },
      { id: 'review', label: 'Human Verifier', role: 'reviewer', status: 'review' },
      { id: 'done', label: 'Done', role: null, status: 'done' },
    ],
    failTargets: { testing: 'in_progress', review: 'in_progress' },
    isDefault: false,
  },
  {
    name: 'Strict',
    description: 'Builder → Tester → Human Verifier → Reviewer — for critical projects',
    stages: [
      { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
      { id: 'test', label: 'Test', role: 'tester', status: 'testing' },
      { id: 'review', label: 'Human Verifier', role: null, status: 'review' },
      { id: 'verify', label: 'Verify', role: 'reviewer', status: 'verification' },
      { id: 'done', label: 'Done', role: null, status: 'done' },
    ],
    failTargets: { testing: 'in_progress', review: 'in_progress', verification: 'in_progress' },
    isDefault: true,
  },
  {
    name: 'Auto-Train',
    description: 'Continuous repo improvement loop for one workspace-scoped task prompt',
    stages: [
      { id: 'improve', label: 'Improve', role: 'builder', status: 'in_progress' },
      { id: 'done', label: 'Loop Complete', role: null, status: 'done' },
    ],
    failTargets: {},
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
