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

describe('Migration 056: add_org_tickets', () => {
  it('creates org_tickets table with correct schema', () => {
    const db = createTestDb();
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_tickets'").get();
    expect(result).toBeDefined();

    const cols = db.prepare("PRAGMA table_info(org_tickets)").all() as { name: string }[];
    const colNames = cols.map((c: { name: string }) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('organization_id');
    expect(colNames).toContain('title');
    expect(colNames).toContain('description');
    expect(colNames).toContain('status');
    expect(colNames).toContain('priority');
    expect(colNames).toContain('ticket_type');
    expect(colNames).toContain('external_ref');
    expect(colNames).toContain('external_system');
    expect(colNames).toContain('creator_name');
    expect(colNames).toContain('assignee_name');
    expect(colNames).toContain('due_date');
    expect(colNames).toContain('tags');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
    expect(cols.length).toBeGreaterThanOrEqual(14);

    db.close();
  });

  it('tasks table has org_ticket_id column', () => {
    const db = createTestDb();
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain('org_ticket_id');
    db.close();
  });

  it('org_tickets indexes exist', () => {
    const db = createTestDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='org_tickets'").all() as { name: string }[];
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames).toContain('idx_org_tickets_org');
    expect(indexNames).toContain('idx_org_tickets_status');
    expect(indexNames).toContain('idx_org_tickets_external_ref');
    db.close();
  });

  it('tasks org_ticket_id index exists', () => {
    const db = createTestDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tasks'").all() as { name: string }[];
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames).toContain('idx_tasks_org_ticket');
    db.close();
  });

  it('validates status CHECK constraint on org_tickets', () => {
    const db = createTestDb();

    const orgId = crypto.randomUUID();
    db.prepare("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)").run(orgId, 'TestOrg', 'test-org-056');

    expect(() => {
      db.prepare("INSERT INTO org_tickets (id, organization_id, title, status) VALUES (?, ?, ?, ?)").run(
        crypto.randomUUID(), orgId, 'Valid Ticket', 'open'
      );
    }).not.toThrow();

    expect(() => {
      db.prepare("INSERT INTO org_tickets (id, organization_id, title, status) VALUES (?, ?, ?, ?)").run(
        crypto.randomUUID(), orgId, 'Invalid Ticket', 'invalid_status'
      );
    }).toThrow();

    db.close();
  });

  it('validates priority CHECK constraint on org_tickets', () => {
    const db = createTestDb();

    const orgId = crypto.randomUUID();
    db.prepare("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)").run(orgId, 'TestOrg2', 'test-org-056-pri');

    expect(() => {
      db.prepare("INSERT INTO org_tickets (id, organization_id, title, priority) VALUES (?, ?, ?, ?)").run(
        crypto.randomUUID(), orgId, 'Urgent Ticket', 'urgent'
      );
    }).not.toThrow();

    expect(() => {
      db.prepare("INSERT INTO org_tickets (id, organization_id, title, priority) VALUES (?, ?, ?, ?)").run(
        crypto.randomUUID(), orgId, 'Bad Priority', 'critical'
      );
    }).toThrow();

    db.close();
  });

  it('validates ticket_type CHECK constraint on org_tickets', () => {
    const db = createTestDb();

    const orgId = crypto.randomUUID();
    db.prepare("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)").run(orgId, 'TestOrg3', 'test-org-056-type');

    expect(() => {
      db.prepare("INSERT INTO org_tickets (id, organization_id, title, ticket_type) VALUES (?, ?, ?, ?)").run(
        crypto.randomUUID(), orgId, 'Epic Ticket', 'epic'
      );
    }).not.toThrow();

    expect(() => {
      db.prepare("INSERT INTO org_tickets (id, organization_id, title, ticket_type) VALUES (?, ?, ?, ?)").run(
        crypto.randomUUID(), orgId, 'Bad Type', 'invalid_type'
      );
    }).toThrow();

    db.close();
  });
});

describe('Migration 057: add_memories', () => {
  it('creates memories table with correct schema', () => {
    const db = createTestDb();
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'").get();
    expect(result).toBeDefined();

    const cols = db.prepare("PRAGMA table_info(memories)").all() as { name: string }[];
    const colNames = cols.map((c: { name: string }) => c.name);

    ['id', 'organization_id', 'workspace_id', 'memory_type', 'title', 'summary', 'body',
     'source', 'source_ref', 'confidence', 'status', 'metadata', 'tags'].forEach(col => {
      expect(colNames).toContain(col);
    });

    db.close();
  });

  it('accepts all 8 memory types', () => {
    const db = createTestDb();
    const memoryTypes = ['fact', 'decision', 'event', 'tool_run', 'error', 'observation', 'note', 'patch'];

    for (const memType of memoryTypes) {
      expect(() => {
        db.prepare("INSERT INTO memories (id, memory_type, title) VALUES (?, ?, ?)").run(crypto.randomUUID(), memType, `Test ${memType}`);
      }).not.toThrow();
    }

    const count = (db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number }).count;
    expect(count).toBe(8);

    db.close();
  });

  it('rejects invalid memory type', () => {
    const db = createTestDb();

    expect(() => {
      db.prepare("INSERT INTO memories (id, memory_type, title) VALUES (?, ?, ?)").run(crypto.randomUUID(), 'invalid_type', 'Test');
    }).toThrow();

    db.close();
  });

  it('memories indexes exist', () => {
    const db = createTestDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memories'").all() as { name: string }[];
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames).toContain('idx_memories_org');
    expect(indexNames).toContain('idx_memories_workspace');
    expect(indexNames).toContain('idx_memories_type');
    expect(indexNames).toContain('idx_memories_status');
    expect(indexNames).toContain('idx_memories_created');
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
