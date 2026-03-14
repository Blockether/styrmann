import { describe, it, expect } from 'vitest';
import { createTestDb } from './test-helpers';

describe('Database Schema', () => {
  it('creates all tables', () => {
    const db = createTestDb();
    
    const tables = [
      'workspaces',
      'agents',
      'tasks',
      'sprints',
      'milestones',
      'tags',
      'task_activities',
      'task_deliverables',
    ];
    
    for (const tableName of tables) {
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(tableName);
      
      expect(result).toBeDefined();
      expect((result as any)?.name).toBe(tableName);
    }
    
    db.close();
  });
});
