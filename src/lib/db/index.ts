import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { schema } from './schema';
import { runMigrations } from './migrations';
import { discoverRepoWorkspaces } from '@/lib/repo-discovery';

const DB_PATH = process.env.STYRMAN_DATABASE_PATH || path.join(process.cwd(), 'styrman.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const isNewDb = !fs.existsSync(DB_PATH);
    
    const instance = new Database(DB_PATH);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');

    if (isNewDb) {
      // Fresh database: create full schema (tables + indexes)
      instance.exec(schema);
      console.log('[DB] New database created at:', DB_PATH);
    }

    // Run migrations for schema updates
    // This handles both new and existing databases
    // For new DBs, migrations are no-ops (tables already exist)
    // For existing DBs, migrations add new tables/columns/indexes
    runMigrations(instance);

    // Auto-discover workspaces from blockether repos
    discoverRepoWorkspaces(instance);

    // Only assign singleton AFTER successful initialization
    db = instance;
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Type-safe query helpers
export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql);
  return stmt.all(...params) as T[];
}

export function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = getDb().prepare(sql);
  return stmt.get(...params) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): Database.RunResult {
  const stmt = getDb().prepare(sql);
  return stmt.run(...params);
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  return db.transaction(fn)();
}

// Export migration utilities for CLI use
export { runMigrations, getMigrationStatus } from './migrations';
