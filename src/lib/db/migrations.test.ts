import { describe, it, expect } from 'vitest';
import { createTestDb } from './test-helpers';

describe('Fresh database', () => {
  it('creates all expected tables from schema + seed migration', () => {
    const db = createTestDb();
    
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[]).map(t => t.name);
    
    expect(tables).toContain('organizations');
    expect(tables).toContain('workspaces');
    expect(tables).toContain('agents');
    expect(tables).toContain('tasks');
    expect(tables).toContain('org_tickets');
    expect(tables).toContain('memories');
    expect(tables).toContain('entity_links');
    expect(tables).toContain('knowledge_articles');
    expect(tables).toContain('commits');
    expect(tables).toContain('webhooks');
    expect(tables).toContain('webhook_deliveries');
    expect(tables).toContain('sprints');
    expect(tables).toContain('milestones');
    expect(tables).toContain('memories_fts');
    expect(tables).toContain('org_tickets_fts');
    expect(tables).toContain('knowledge_articles_fts');
    expect(tables).toContain('commits_fts');
    
    const agentCount = (db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number }).count;
    expect(agentCount).toBeGreaterThan(0);
    
    db.close();
  });

  it('has org_ticket_acceptance_criteria table', () => {
    const db = createTestDb();
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_ticket_acceptance_criteria'").get();
    expect(result).toBeDefined();
    db.close();
  });

  it('org_tickets has story_points column', () => {
    const db = createTestDb();
    const cols = (db.prepare("PRAGMA table_info(org_tickets)").all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('story_points');
    db.close();
  });
});
