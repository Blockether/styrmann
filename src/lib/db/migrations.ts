/**
 * Database Migrations System
 * 
 * Handles schema changes in a production-safe way:
 * 1. Tracks which migrations have been applied
 * 2. Runs new migrations automatically on startup
 * 3. Never runs the same migration twice
 *
 * HISTORY: Migrations 001-063 were consolidated on 2026-03-14 during
 * the org-knowledge-platform work. The schema.ts file now contains the
 * complete schema. All future migrations start from 100.
 */

import Database from 'better-sqlite3';
import { bootstrapCoreAgentsRaw } from '@/lib/bootstrap-agents';

interface Migration {
  id: string;
  name: string;
  up: (_db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    id: '100',
    name: 'seed_fresh_database',
    up: (db) => {
      const styrmannUrl = process.env.STYRMAN_URL || 'http://localhost:4000';
      bootstrapCoreAgentsRaw(db, styrmannUrl);
      console.log('[Migration 100] Core agents bootstrapped');
    }
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map(m => m.id)
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    console.log(`[DB] Running migration ${migration.id}: ${migration.name}`);

    try {
      db.pragma('foreign_keys = OFF');
      db.pragma('legacy_alter_table = ON');

      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(migration.id, migration.name);
      })();

      db.pragma('legacy_alter_table = OFF');
      db.pragma('foreign_keys = ON');

      console.log(`[DB] Migration ${migration.id} completed`);
    } catch (error) {
      db.pragma('foreign_keys = ON');
      console.error(`[DB] Migration ${migration.id} failed:`, error);
      throw error;
    }
  }
}

export function getMigrationStatus(db: Database.Database): { applied: string[]; pending: string[] } {
  const applied = (db.prepare('SELECT id FROM _migrations ORDER BY id').all() as { id: string }[]).map(m => m.id);
  const pending = migrations.filter(m => !applied.includes(m.id)).map(m => m.id);
  return { applied, pending };
}
