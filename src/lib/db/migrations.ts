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
  {
    id: '101',
    name: 'add_story_points_and_acceptance_criteria',
    up: (db) => {
      // Add story_points to org_tickets (for existing DBs)
      const cols = (db.prepare("PRAGMA table_info(org_tickets)").all() as { name: string }[]).map(c => c.name);
      if (!cols.includes('story_points')) {
        db.exec("ALTER TABLE org_tickets ADD COLUMN story_points INTEGER CHECK (story_points IS NULL OR (story_points >= 0 AND story_points <= 100))");
      }

      // Create org_ticket_acceptance_criteria table
      db.exec(`
        CREATE TABLE IF NOT EXISTS org_ticket_acceptance_criteria (
          id TEXT PRIMARY KEY,
          org_ticket_id TEXT NOT NULL REFERENCES org_tickets(id) ON DELETE CASCADE,
          description TEXT NOT NULL,
          sort_order INTEGER DEFAULT 0,
          is_met INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_org_ticket_ac ON org_ticket_acceptance_criteria(org_ticket_id);
      `);

      console.log('[Migration 101] Added story_points and org_ticket_acceptance_criteria');
    }
  },
  {
    id: '102',
    name: 'fix_fts5_null_coalesce_triggers',
    up: (db) => {
      db.exec(`
        DROP TRIGGER IF EXISTS memories_ai;
        DROP TRIGGER IF EXISTS memories_ad;
        DROP TRIGGER IF EXISTS memories_au;

        CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, title, summary, body)
          VALUES (new.rowid, new.title, COALESCE(new.summary, ''), COALESCE(new.body, ''));
        END;

        CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, title, summary, body)
          VALUES('delete', old.rowid, old.title, COALESCE(old.summary, ''), COALESCE(old.body, ''));
        END;

        CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, title, summary, body)
          VALUES('delete', old.rowid, old.title, COALESCE(old.summary, ''), COALESCE(old.body, ''));
          INSERT INTO memories_fts(rowid, title, summary, body)
          VALUES (new.rowid, new.title, COALESCE(new.summary, ''), COALESCE(new.body, ''));
        END;

        INSERT INTO memories_fts(memories_fts) VALUES('rebuild');
      `);

      db.exec(`
        DROP TRIGGER IF EXISTS org_tickets_ai;
        DROP TRIGGER IF EXISTS org_tickets_ad;
        DROP TRIGGER IF EXISTS org_tickets_au;

        CREATE TRIGGER org_tickets_ai AFTER INSERT ON org_tickets BEGIN
          INSERT INTO org_tickets_fts(rowid, title, description)
          VALUES (new.rowid, new.title, COALESCE(new.description, ''));
        END;

        CREATE TRIGGER org_tickets_ad AFTER DELETE ON org_tickets BEGIN
          INSERT INTO org_tickets_fts(org_tickets_fts, rowid, title, description)
          VALUES('delete', old.rowid, old.title, COALESCE(old.description, ''));
        END;

        CREATE TRIGGER org_tickets_au AFTER UPDATE ON org_tickets BEGIN
          INSERT INTO org_tickets_fts(org_tickets_fts, rowid, title, description)
          VALUES('delete', old.rowid, old.title, COALESCE(old.description, ''));
          INSERT INTO org_tickets_fts(rowid, title, description)
          VALUES (new.rowid, new.title, COALESCE(new.description, ''));
        END;

        INSERT INTO org_tickets_fts(org_tickets_fts) VALUES('rebuild');
      `);

       db.exec(`
         DROP TRIGGER IF EXISTS commits_ai;
         DROP TRIGGER IF EXISTS commits_ad;
         DROP TRIGGER IF EXISTS commits_au;

         CREATE TRIGGER commits_ai AFTER INSERT ON commits BEGIN
           INSERT INTO commits_fts(rowid, message, author_name)
           VALUES (new.rowid, new.message, COALESCE(new.author_name, ''));
         END;

         CREATE TRIGGER commits_ad AFTER DELETE ON commits BEGIN
           INSERT INTO commits_fts(commits_fts, rowid, message, author_name)
           VALUES('delete', old.rowid, old.message, COALESCE(old.author_name, ''));
         END;

         CREATE TRIGGER commits_au AFTER UPDATE ON commits BEGIN
           INSERT INTO commits_fts(commits_fts, rowid, message, author_name)
           VALUES('delete', old.rowid, old.message, COALESCE(old.author_name, ''));
           INSERT INTO commits_fts(rowid, message, author_name)
           VALUES (new.rowid, new.message, COALESCE(new.author_name, ''));
         END;

         INSERT INTO commits_fts(commits_fts) VALUES('rebuild');
       `);

       console.log('[Migration 102] Fixed FTS5 triggers with COALESCE for nullable columns');
     }
   },
   {
     id: '103',
     name: 'remove_external_system',
     up: (db) => {
       const cols = (db.prepare("PRAGMA table_info(org_tickets)").all() as { name: string }[]).map(c => c.name);
       if (cols.includes('external_system')) {
         db.exec("ALTER TABLE org_tickets DROP COLUMN external_system");
         console.log('[Migration 103] Dropped external_system column from org_tickets');
       } else {
        console.log('[Migration 103] external_system column not found, skipping');
        }
      }
   },
   {
     id: '104',
     name: 'add_org_sprints',
     up: (db) => {
       db.exec(`
         CREATE TABLE IF NOT EXISTS org_sprints (
           id TEXT PRIMARY KEY,
           organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
           name TEXT NOT NULL,
           description TEXT,
           status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed')),
           start_date TEXT,
           end_date TEXT,
           created_at TEXT DEFAULT (datetime('now')),
           updated_at TEXT DEFAULT (datetime('now'))
         );
         CREATE INDEX IF NOT EXISTS idx_org_sprints_org ON org_sprints(organization_id);
         CREATE INDEX IF NOT EXISTS idx_org_sprints_status ON org_sprints(status);
       `);
       const cols = (db.prepare("PRAGMA table_info(org_tickets)").all() as { name: string }[]).map(c => c.name);
       if (!cols.includes('org_sprint_id')) {
         db.exec("ALTER TABLE org_tickets ADD COLUMN org_sprint_id TEXT REFERENCES org_sprints(id) ON DELETE SET NULL");
         db.exec("CREATE INDEX IF NOT EXISTS idx_org_tickets_sprint ON org_tickets(org_sprint_id)");
       }
       console.log('[Migration 104] Added org_sprints table');
      }
   },
   {
     id: '105',
     name: 'add_org_milestones',
     up: (db) => {
       db.exec(`
         CREATE TABLE IF NOT EXISTS org_milestones (
           id TEXT PRIMARY KEY,
           organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
           org_sprint_id TEXT REFERENCES org_sprints(id) ON DELETE SET NULL,
           name TEXT NOT NULL,
           description TEXT,
           due_date TEXT,
           status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
           priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
           created_at TEXT DEFAULT (datetime('now')),
           updated_at TEXT DEFAULT (datetime('now'))
         );
         CREATE INDEX IF NOT EXISTS idx_org_milestones_org ON org_milestones(organization_id);
         CREATE INDEX IF NOT EXISTS idx_org_milestones_sprint ON org_milestones(org_sprint_id);
         CREATE INDEX IF NOT EXISTS idx_org_milestones_status ON org_milestones(status);
       `);
       const cols = (db.prepare("PRAGMA table_info(org_tickets)").all() as { name: string }[]).map(c => c.name);
       if (!cols.includes('org_milestone_id')) {
         db.exec("ALTER TABLE org_tickets ADD COLUMN org_milestone_id TEXT REFERENCES org_milestones(id) ON DELETE SET NULL");
         db.exec("CREATE INDEX IF NOT EXISTS idx_org_tickets_milestone ON org_tickets(org_milestone_id)");
       }
       console.log('[Migration 105] Added org_milestones table');
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
