import { describe, it, expect } from 'vitest';
import { createTestDb } from './test-helpers';
import { getConnectedEntities } from './entity-links';

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

describe('Migration 058: add_entity_links', () => {
  it('creates entity_links table with correct schema', () => {
    const db = createTestDb();
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_links'").get();
    expect(result).toBeDefined();

    const cols = db.prepare("PRAGMA table_info(entity_links)").all() as any[];
    const colNames = cols.map((c: any) => c.name);
    ['id', 'from_entity_type', 'from_entity_id', 'to_entity_type', 'to_entity_id', 'link_type', 'explanation'].forEach(col => {
      expect(colNames).toContain(col);
    });
    db.close();
  });

  it('prevents self-links (from_entity_id == to_entity_id)', () => {
    const db = createTestDb();
    const entityId = crypto.randomUUID();

    expect(() => {
      db.prepare("INSERT INTO entity_links (id, from_entity_type, from_entity_id, to_entity_type, to_entity_id, link_type) VALUES (?, ?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), 'task', entityId, 'task', entityId, 'relates_to');
    }).toThrow();

    db.close();
  });

  it('prevents duplicate links', () => {
    const db = createTestDb();
    const fromId = crypto.randomUUID();
    const toId = crypto.randomUUID();

    db.prepare("INSERT INTO entity_links (id, from_entity_type, from_entity_id, to_entity_type, to_entity_id, link_type) VALUES (?, ?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), 'task', fromId, 'memory', toId, 'relates_to');

    expect(() => {
      db.prepare("INSERT INTO entity_links (id, from_entity_type, from_entity_id, to_entity_type, to_entity_id, link_type) VALUES (?, ?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), 'task', fromId, 'memory', toId, 'relates_to');
    }).toThrow();

    db.close();
  });

  it('graph traversal respects MAX_DEPTH', () => {
    const db = createTestDb();

    const entities = Array.from({ length: 15 }, () => crypto.randomUUID());
    for (let i = 0; i < entities.length - 1; i++) {
      db.prepare("INSERT INTO entity_links (id, from_entity_type, from_entity_id, to_entity_type, to_entity_id, link_type) VALUES (?, ?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), 'task', entities[i], 'task', entities[i + 1], 'relates_to');
    }

    const connected = getConnectedEntities(db, entities[0], 10);

    const maxDistance = Math.max(...connected.map((e) => e.distance));
    expect(maxDistance).toBeLessThanOrEqual(10);

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

describe('Migration 059: add_knowledge_articles_and_commits', () => {
  it('creates knowledge_articles table', () => {
    const db = createTestDb();
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_articles'").get();
    expect(result).toBeDefined();

    const cols = db.prepare("PRAGMA table_info(knowledge_articles)").all() as { name: string }[];
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('organization_id');
    expect(colNames).toContain('workspace_id');
    expect(colNames).toContain('title');
    expect(colNames).toContain('summary');
    expect(colNames).toContain('body');
    expect(colNames).toContain('synthesis_model');
    expect(colNames).toContain('synthesis_prompt_hash');
    expect(colNames).toContain('source_memory_ids');
    expect(colNames).toContain('status');
    expect(colNames).toContain('version');
    expect(colNames).toContain('supersedes_id');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');

    db.close();
  });

  it('knowledge_articles table has correct indexes', () => {
    const db = createTestDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='knowledge_articles'").all() as { name: string }[];
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames).toContain('idx_knowledge_articles_org');
    expect(indexNames).toContain('idx_knowledge_articles_workspace');
    expect(indexNames).toContain('idx_knowledge_articles_status');
    db.close();
  });

  it('creates commits table with dedup constraint', () => {
    const db = createTestDb();
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='commits'").get();
    expect(result).toBeDefined();

    const cols = db.prepare("PRAGMA table_info(commits)").all() as { name: string }[];
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('workspace_id');
    expect(colNames).toContain('commit_hash');
    expect(colNames).toContain('message');
    expect(colNames).toContain('author_name');
    expect(colNames).toContain('author_email');
    expect(colNames).toContain('branch');
    expect(colNames).toContain('files_changed');
    expect(colNames).toContain('insertions');
    expect(colNames).toContain('deletions');
    expect(colNames).toContain('committed_at');
    expect(colNames).toContain('ingested_at');
    expect(colNames).toContain('metadata');

    db.close();
  });

  it('commits table has correct indexes', () => {
    const db = createTestDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='commits'").all() as { name: string }[];
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames).toContain('idx_commits_workspace');
    expect(indexNames).toContain('idx_commits_committed_at');
    expect(indexNames).toContain('idx_commits_author');
    db.close();
  });
});

describe('Migration 060: add_fts5_tables', () => {
  it('creates FTS5 virtual tables', () => {
    const db = createTestDb();

    for (const ftsTable of ['memories_fts', 'knowledge_articles_fts', 'org_tickets_fts', 'commits_fts']) {
      const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(ftsTable);
      expect(result).toBeDefined();
    }

    db.close();
  });

  it('FTS5 indexes memories on insert', () => {
    const db = createTestDb();
    const uniqueWord = `searchtest${Date.now()}`;

    db.prepare("INSERT INTO memories (id, memory_type, title, body) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), 'fact', `Test memory about ${uniqueWord}`, `This fact contains the word ${uniqueWord}`);

    const results = db.prepare('SELECT * FROM memories_fts WHERE memories_fts MATCH ?').all(uniqueWord);
    expect(results.length).toBeGreaterThan(0);
    db.close();
  });

  it('FTS5 removes memories on delete', () => {
    const db = createTestDb();
    const uniqueWord = `deletetest${Date.now()}`;
    const id = crypto.randomUUID();

    db.prepare("INSERT INTO memories (id, memory_type, title, body) VALUES (?, ?, ?, ?)")
      .run(id, 'fact', `Delete test ${uniqueWord}`, uniqueWord);

    let results = db.prepare('SELECT * FROM memories_fts WHERE memories_fts MATCH ?').all(uniqueWord);
    expect(results.length).toBe(1);

    db.prepare("DELETE FROM memories WHERE id = ?").run(id);

    results = db.prepare('SELECT * FROM memories_fts WHERE memories_fts MATCH ?').all(uniqueWord);
    expect(results.length).toBe(0);
    db.close();
  });

  it('BM25 ranking returns more relevant result first', () => {
    const db = createTestDb();
    const keyword = `rankingtest${Date.now()}`;

    db.prepare("INSERT INTO memories (id, memory_type, title, body) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), 'note', `${keyword} ${keyword} ${keyword}`, `${keyword} ${keyword}`);

    db.prepare("INSERT INTO memories (id, memory_type, title, body) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), 'note', keyword, 'not very relevant at all');

    const results = db.prepare(
      `SELECT m.title, bm25(memories_fts) as rank FROM memories_fts
       JOIN memories m ON m.rowid = memories_fts.rowid
       WHERE memories_fts MATCH ? ORDER BY rank LIMIT 10`
    ).all(keyword) as { title: string; rank: number }[];

    expect(results.length).toBe(2);
    expect(results[0].rank).toBeLessThanOrEqual(results[1].rank);
    db.close();
  });
});

describe('Migration 062: add_webhooks', () => {
  it('creates webhooks and webhook_deliveries tables', () => {
    const db = createTestDb();
    const webhooks = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='webhooks'").get();
    expect(webhooks).toBeDefined();
    const deliveries = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='webhook_deliveries'").get();
    expect(deliveries).toBeDefined();
    db.close();
  });

  it('webhooks table has correct columns', () => {
    const db = createTestDb();
    const cols = db.prepare("PRAGMA table_info(webhooks)").all() as { name: string }[];
    const colNames = cols.map((c: { name: string }) => c.name);
    ['id', 'organization_id', 'url', 'secret', 'event_types', 'is_active',
     'last_delivery_at', 'last_delivery_status', 'failure_count'].forEach(col => {
      expect(colNames).toContain(col);
    });
    db.close();
  });

  it('webhook_deliveries table has correct columns', () => {
    const db = createTestDb();
    const cols = db.prepare("PRAGMA table_info(webhook_deliveries)").all() as { name: string }[];
    const colNames = cols.map((c: { name: string }) => c.name);
    ['id', 'webhook_id', 'event_type', 'payload', 'status', 'response_status',
     'response_body', 'attempts'].forEach(col => {
      expect(colNames).toContain(col);
    });
    db.close();
  });

  it('webhook_deliveries status CHECK constraint works', () => {
    const db = createTestDb();
    const webhookId = crypto.randomUUID();
    db.prepare("INSERT INTO webhooks (id, url, event_types) VALUES (?, ?, '[]')").run(webhookId, 'https://example.com/hook');

    expect(() => {
      db.prepare("INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status) VALUES (?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), webhookId, 'test', '{}', 'delivered');
    }).not.toThrow();

    expect(() => {
      db.prepare("INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status) VALUES (?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), webhookId, 'test', '{}', 'invalid_status');
    }).toThrow();

    db.close();
  });

  it('webhooks indexes exist', () => {
    const db = createTestDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='webhooks'").all() as { name: string }[];
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames).toContain('idx_webhooks_org');
    expect(indexNames).toContain('idx_webhooks_active');
    db.close();
  });

  it('webhook_deliveries indexes exist', () => {
    const db = createTestDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='webhook_deliveries'").all() as { name: string }[];
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames).toContain('idx_webhook_deliveries_webhook');
    expect(indexNames).toContain('idx_webhook_deliveries_status');
    db.close();
  });
});

describe('Migration 061: backfill_org_tickets', () => {
  it('fresh DB has zero orphan tasks', () => {
    const db = createTestDb();
    const orphanCount = (db.prepare('SELECT count(*) as c FROM tasks WHERE org_ticket_id IS NULL').get() as { c: number }).c;
    expect(orphanCount).toBe(0);
    db.close();
  });

  it('backfills tasks that lack org_ticket_id', () => {
    const db = createTestDb();

    const org = db.prepare("SELECT id FROM organizations LIMIT 1").get() as { id: string } | undefined;
    if (!org) { db.close(); return; }

    const workspace = db.prepare("SELECT id FROM workspaces WHERE organization_id = ? AND is_internal = 0 LIMIT 1").get(org.id) as { id: string } | undefined;
    if (!workspace) { db.close(); return; }

    const taskId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO tasks (id, title, status, priority, task_type, workspace_id, assignee_type)
      VALUES (?, ?, 'inbox', 'normal', 'feature', ?, 'ai')
    `).run(taskId, 'Test orphan task', workspace.id);

    let task = db.prepare("SELECT org_ticket_id FROM tasks WHERE id = ?").get(taskId) as { org_ticket_id: string | null };
    expect(task.org_ticket_id).toBeNull();

    const ticketId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO org_tickets (id, organization_id, title, status, priority, ticket_type)
      VALUES (?, ?, ?, 'delegated', 'normal', 'feature')
    `).run(ticketId, org.id, '[Migrated] Test orphan task');

    db.prepare("UPDATE tasks SET org_ticket_id = ? WHERE id = ?").run(ticketId, taskId);

    db.prepare(`
      INSERT INTO entity_links (id, from_entity_type, from_entity_id, to_entity_type, to_entity_id, link_type, explanation)
      VALUES (?, 'org_ticket', ?, 'task', ?, 'delegates_to', 'Auto-migrated')
    `).run(crypto.randomUUID(), ticketId, taskId);

    task = db.prepare("SELECT org_ticket_id FROM tasks WHERE id = ?").get(taskId) as { org_ticket_id: string | null };
    expect(task.org_ticket_id).toBe(ticketId);

    const ticket = db.prepare("SELECT title, status, ticket_type FROM org_tickets WHERE id = ?").get(ticketId) as { title: string; status: string; ticket_type: string };
    expect(ticket.title).toBe('[Migrated] Test orphan task');
    expect(ticket.status).toBe('delegated');
    expect(ticket.ticket_type).toBe('feature');

    const link = db.prepare("SELECT link_type FROM entity_links WHERE from_entity_id = ? AND to_entity_id = ?").get(ticketId, taskId) as { link_type: string };
    expect(link.link_type).toBe('delegates_to');

    db.close();
  });

  it('maps task_type to correct ticket_type', () => {
    const db = createTestDb();

    const org = db.prepare("SELECT id FROM organizations LIMIT 1").get() as { id: string } | undefined;
    if (!org) { db.close(); return; }

    const workspace = db.prepare("SELECT id FROM workspaces WHERE organization_id = ? AND is_internal = 0 LIMIT 1").get(org.id) as { id: string } | undefined;
    if (!workspace) { db.close(); return; }

    const typeMap: Record<string, string> = {
      bug: 'bug',
      feature: 'feature',
      chore: 'task',
      documentation: 'task',
      research: 'task',
      spike: 'task',
    };

    for (const [taskType, expectedTicketType] of Object.entries(typeMap)) {
      const taskId = crypto.randomUUID();
      const ticketId = crypto.randomUUID();

      db.prepare(`
        INSERT INTO tasks (id, title, status, priority, task_type, workspace_id, assignee_type)
        VALUES (?, ?, 'inbox', 'normal', ?, ?, 'ai')
      `).run(taskId, `Test ${taskType}`, taskType, workspace.id);

      db.prepare(`
        INSERT INTO org_tickets (id, organization_id, title, status, priority, ticket_type)
        VALUES (?, ?, ?, 'delegated', 'normal', ?)
      `).run(ticketId, org.id, `[Migrated] Test ${taskType}`, expectedTicketType);

      db.prepare("UPDATE tasks SET org_ticket_id = ? WHERE id = ?").run(ticketId, taskId);

      const ticket = db.prepare("SELECT ticket_type FROM org_tickets WHERE id = ?").get(ticketId) as { ticket_type: string };
      expect(ticket.ticket_type).toBe(expectedTicketType);
    }

    db.close();
  });
});
