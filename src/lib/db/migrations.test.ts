import { describe, it, expect } from 'vitest';
import { createTestDb } from './test-helpers';

describe('Migration 055: add_organizations', () => {
  it('creates organizations table with correct schema', () => {
    const db = createTestDb();
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organizations'").get();
    expect(result).toBeDefined();

    const cols = db.prepare("PRAGMA table_info(organizations)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('slug');
    expect(colNames).toContain('description');
    expect(colNames).toContain('logo_url');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
    db.close();
  });

  it('workspaces table has organization_id column', () => {
    const db = createTestDb();
    const cols = db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('organization_id');
    db.close();
  });

  it('organizations slug index exists', () => {
    const db = createTestDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='organizations'").all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_organizations_slug');
    db.close();
  });

  it('workspaces organization_id index exists', () => {
    const db = createTestDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='workspaces'").all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_workspaces_organization_id');
    db.close();
  });
});

describe('Migration 054: drop_legacy_tables', () => {
  it('drops legacy tables from database', () => {
    const db = createTestDb();

    const legacyTables = [
      'businesses',
      'memory_pipeline_config',
      'planning_questions',
      'planning_specs',
      'conversations',
      'conversation_participants',
      'messages',
    ];

    for (const tableName of legacyTables) {
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(tableName);
      expect(result).toBeUndefined();
    }

    db.close();
  });

  it('tasks table has no legacy columns after migration', () => {
    const db = createTestDb();

    const taskColumns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
    const colNames = taskColumns.map((c) => c.name);

    expect(colNames).not.toContain('business_id');
    expect(colNames).not.toContain('planning_session_key');
    expect(colNames).not.toContain('planning_messages');
    expect(colNames).not.toContain('planning_complete');
    expect(colNames).not.toContain('planning_spec');
    expect(colNames).not.toContain('planning_agents');
    expect(colNames).not.toContain('planning_dispatch_error');

    db.close();
  });

  it('tasks table retains essential columns after migration', () => {
    const db = createTestDb();

    const taskColumns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
    const colNames = taskColumns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('title');
    expect(colNames).toContain('status');
    expect(colNames).toContain('workspace_id');
    expect(colNames).toContain('milestone_id');
    expect(colNames).toContain('assigned_agent_id');
    expect(colNames).toContain('workflow_template_id');

    db.close();
  });
});
