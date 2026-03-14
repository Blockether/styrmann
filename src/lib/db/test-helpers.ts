import Database from 'better-sqlite3';
import { schema } from './schema';
import { runMigrations } from './migrations';

export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  db.exec(schema);
  
  runMigrations(db);
  
  return db;
}
