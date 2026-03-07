/**
 * Database Migrations System
 * 
 * Handles schema changes in a production-safe way:
 * 1. Tracks which migrations have been applied
 * 2. Runs new migrations automatically on startup
 * 3. Never runs the same migration twice
 */

import Database from 'better-sqlite3';
import { bootstrapCoreAgentsRaw } from '@/lib/bootstrap-agents';

interface Migration {
  id: string;
  name: string;
  up: (_db: Database.Database) => void;
}

// All migrations in order - NEVER remove or reorder existing migrations
const migrations: Migration[] = [
  {
    id: '001',
    name: 'initial_schema',
    up: () => {
      // Core tables - these are created in schema.ts on fresh databases
      // This migration exists to mark the baseline for existing databases
      console.log('[Migration 001] Baseline schema marker');
    }
  },
  {
    id: '002',
    name: 'add_workspaces',
    up: (db) => {
      console.log('[Migration 002] Adding workspaces table and columns...');
      
      // Create workspaces table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          icon TEXT DEFAULT 'folder',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);
      
      // Insert default workspace if not exists
      db.exec(`
        INSERT OR IGNORE INTO workspaces (id, name, slug, description, icon) 
        VALUES ('default', 'MissionControl Configuration', 'default', 'Main configuration workspace', 'MC');
      `);
      
      // Add workspace_id to tasks if not exists
      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      if (!tasksInfo.some(col => col.name === 'workspace_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)`);
        console.log('[Migration 002] Added workspace_id to tasks');
      }
      
      // Add workspace_id to agents if not exists
      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
      if (!agentsInfo.some(col => col.name === 'workspace_id')) {
        db.exec(`ALTER TABLE agents ADD COLUMN workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id)`);
        console.log('[Migration 002] Added workspace_id to agents');
      }
    }
  },
  {
    id: '003',
    name: 'add_planning_tables',
    up: (db) => {
      console.log('[Migration 003] Adding planning tables...');
      
      // Create planning_questions table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_questions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          question TEXT NOT NULL,
          question_type TEXT DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'text', 'yes_no')),
          options TEXT,
          answer TEXT,
          answered_at TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
      
      // Create planning_specs table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_specs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          spec_markdown TEXT NOT NULL,
          locked_at TEXT NOT NULL,
          locked_by TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
      
      // Create index
      db.exec(`CREATE INDEX IF NOT EXISTS idx_planning_questions_task ON planning_questions(task_id, sort_order)`);
      
      // Update tasks status check constraint to include 'planning'
      // SQLite doesn't support ALTER CONSTRAINT, so we check if it's needed
      const taskSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
      if (taskSchema && !taskSchema.sql.includes("'planning'")) {
        console.log('[Migration 003] Note: tasks table needs planning status - will be handled by schema recreation on fresh dbs');
      }
    }
  },
  {
    id: '004',
    name: 'add_planning_session_columns',
    up: (db) => {
      console.log('[Migration 004] Adding planning session columns to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];

      // Add planning_session_key column
      if (!tasksInfo.some(col => col.name === 'planning_session_key')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_session_key TEXT`);
        console.log('[Migration 004] Added planning_session_key');
      }

      // Add planning_messages column (stores JSON array of messages)
      if (!tasksInfo.some(col => col.name === 'planning_messages')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_messages TEXT`);
        console.log('[Migration 004] Added planning_messages');
      }

      // Add planning_complete column
      if (!tasksInfo.some(col => col.name === 'planning_complete')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_complete INTEGER DEFAULT 0`);
        console.log('[Migration 004] Added planning_complete');
      }

      // Add planning_spec column (stores final spec JSON)
      if (!tasksInfo.some(col => col.name === 'planning_spec')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_spec TEXT`);
        console.log('[Migration 004] Added planning_spec');
      }

      // Add planning_agents column (stores generated agents JSON)
      if (!tasksInfo.some(col => col.name === 'planning_agents')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_agents TEXT`);
        console.log('[Migration 004] Added planning_agents');
      }
    }
  },
  {
    id: '005',
    name: 'add_agent_model_field',
    up: (db) => {
      console.log('[Migration 005] Adding model field to agents...');

      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];

      // Add model column
      if (!agentsInfo.some(col => col.name === 'model')) {
        db.exec(`ALTER TABLE agents ADD COLUMN model TEXT`);
        console.log('[Migration 005] Added model to agents');
      }
    }
  },
  {
    id: '006',
    name: 'add_planning_dispatch_error_column',
    up: (db) => {
      console.log('[Migration 006] Adding planning_dispatch_error column to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];

      // Add planning_dispatch_error column
      if (!tasksInfo.some(col => col.name === 'planning_dispatch_error')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_dispatch_error TEXT`);
        console.log('[Migration 006] Added planning_dispatch_error to tasks');
      }
    }
  },
  {
    id: '007',
    name: 'add_agent_source_and_gateway_id',
    up: (db) => {
      console.log('[Migration 007] Adding source and gateway_agent_id to agents...');

      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];

      // Add source column: 'local' for MC-created, 'gateway' for imported from OpenClaw Gateway
      if (!agentsInfo.some(col => col.name === 'source')) {
        db.exec(`ALTER TABLE agents ADD COLUMN source TEXT DEFAULT 'local'`);
        console.log('[Migration 007] Added source to agents');
      }

      // Add gateway_agent_id column: stores the original agent ID/name from the Gateway
      if (!agentsInfo.some(col => col.name === 'gateway_agent_id')) {
        db.exec(`ALTER TABLE agents ADD COLUMN gateway_agent_id TEXT`);
        console.log('[Migration 007] Added gateway_agent_id to agents');
      }
    }
  },
  {
    id: '008',
    name: 'add_status_reason_column',
    up: (db) => {
      console.log('[Migration 008] Adding status_reason column to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];

      if (!tasksInfo.some(col => col.name === 'status_reason')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN status_reason TEXT`);
        console.log('[Migration 008] Added status_reason to tasks');
      }
    }
  },
  {
    id: '009',
    name: 'add_agent_session_key_prefix',
    up: (db) => {
      console.log('[Migration 009] Adding session_key_prefix to agents...');

      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];

      if (!agentsInfo.some(col => col.name === 'session_key_prefix')) {
        db.exec(`ALTER TABLE agents ADD COLUMN session_key_prefix TEXT`);
        console.log('[Migration 009] Added session_key_prefix to agents');
      }
    }
  },
  {
    id: '010',
    name: 'add_workflow_templates_roles_knowledge',
    up: (db) => {
      console.log('[Migration 010] Adding workflow templates, task roles, and knowledge tables...');

      // Create workflow_templates table
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_templates (
          id TEXT PRIMARY KEY,
          workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
          name TEXT NOT NULL,
          description TEXT,
          stages TEXT NOT NULL,
          fail_targets TEXT,
          is_default INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_templates_workspace ON workflow_templates(workspace_id)`);

      // Create task_roles table
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_roles (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          agent_id TEXT NOT NULL REFERENCES agents(id),
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(task_id, role)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_task_roles_task ON task_roles(task_id)`);

      // Create knowledge_entries table
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_entries (
          id TEXT PRIMARY KEY,
          workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
          task_id TEXT REFERENCES tasks(id),
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          tags TEXT,
          confidence REAL DEFAULT 0.5,
          created_by_agent_id TEXT REFERENCES agents(id),
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_entries_workspace ON knowledge_entries(workspace_id, created_at DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_entries_task ON knowledge_entries(task_id)`);

      // Add workflow_template_id to tasks
      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      if (!tasksInfo.some(col => col.name === 'workflow_template_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN workflow_template_id TEXT REFERENCES workflow_templates(id)`);
        console.log('[Migration 010] Added workflow_template_id to tasks');
      }

      // Recreate tasks table to add 'verification' + 'pending_dispatch' to status CHECK constraint
      // SQLite doesn't support ALTER CONSTRAINT, so we need table recreation
      const taskSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
      if (taskSchema && !taskSchema.sql.includes("'verification'")) {
        console.log('[Migration 010] Recreating tasks table to add verification status...');

        // Get current column names from the old table
        const oldCols = (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map(c => c.name);
        const hasWorkflowCol = oldCols.includes('workflow_template_id');

        db.exec(`ALTER TABLE tasks RENAME TO _tasks_old_010`);
        db.exec(`
          CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'inbox' CHECK (status IN ('pending_dispatch', 'planning', 'inbox', 'assigned', 'in_progress', 'testing', 'review', 'verification', 'done')),
            priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
            assigned_agent_id TEXT REFERENCES agents(id),
            created_by_agent_id TEXT REFERENCES agents(id),
            workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
            business_id TEXT DEFAULT 'default',
            due_date TEXT,
            workflow_template_id TEXT REFERENCES workflow_templates(id),
            planning_session_key TEXT,
            planning_messages TEXT,
            planning_complete INTEGER DEFAULT 0,
            planning_spec TEXT,
            planning_agents TEXT,
            planning_dispatch_error TEXT,
            status_reason TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )
        `);

        // Copy data with explicit column mapping
        const sharedCols = 'id, title, description, status, priority, assigned_agent_id, created_by_agent_id, workspace_id, business_id, due_date, planning_session_key, planning_messages, planning_complete, planning_spec, planning_agents, planning_dispatch_error, status_reason, created_at, updated_at';

        if (hasWorkflowCol) {
          db.exec(`
            INSERT INTO tasks (${sharedCols}, workflow_template_id)
            SELECT ${sharedCols}, workflow_template_id FROM _tasks_old_010
          `);
        } else {
          db.exec(`
            INSERT INTO tasks (${sharedCols})
            SELECT ${sharedCols} FROM _tasks_old_010
          `);
        }

        db.exec(`DROP TABLE _tasks_old_010`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_agent_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)`);
        console.log('[Migration 010] Tasks table recreated with verification status');
      }

      // Seed default workflow templates for the 'default' workspace
      const existingTemplates = db.prepare('SELECT COUNT(*) as count FROM workflow_templates').get() as { count: number };
      if (existingTemplates.count === 0) {
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO workflow_templates (id, workspace_id, name, description, stages, fail_targets, is_default, created_at, updated_at)
          VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'tpl-simple',
          'Simple',
          'Builder only — for quick, straightforward tasks',
          JSON.stringify([
            { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
            { id: 'done', label: 'Done', role: null, status: 'done' }
          ]),
          JSON.stringify({}),
          0, now, now
        );

        db.prepare(`
          INSERT INTO workflow_templates (id, workspace_id, name, description, stages, fail_targets, is_default, created_at, updated_at)
          VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'tpl-standard',
          'Standard',
          'Builder → Tester → Reviewer — for most projects',
          JSON.stringify([
            { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
            { id: 'test', label: 'Test', role: 'tester', status: 'testing' },
            { id: 'review', label: 'Review', role: 'reviewer', status: 'review' },
            { id: 'done', label: 'Done', role: null, status: 'done' }
          ]),
          JSON.stringify({ testing: 'in_progress', review: 'in_progress' }),
          1, now, now
        );

        db.prepare(`
          INSERT INTO workflow_templates (id, workspace_id, name, description, stages, fail_targets, is_default, created_at, updated_at)
          VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'tpl-strict',
          'Strict',
          'Builder → Tester → Verifier + Learner — for critical projects',
          JSON.stringify([
            { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
            { id: 'test', label: 'Test', role: 'tester', status: 'testing' },
            { id: 'review', label: 'Review', role: null, status: 'review' },
            { id: 'verify', label: 'Verify', role: 'verifier', status: 'verification' },
            { id: 'done', label: 'Done', role: null, status: 'done' }
          ]),
          JSON.stringify({ testing: 'in_progress', review: 'in_progress', verification: 'in_progress' }),
          0, now, now
        );

        console.log('[Migration 010] Seeded default workflow templates');
      }
    }
  },
  {
    id: '011',
    name: 'fix_broken_fk_references',
    up: (db) => {
      // Migration 010 renamed tasks → _tasks_old_010, which caused SQLite to
      // rewrite FK references in ALL child tables to point to "_tasks_old_010".
      // After dropping _tasks_old_010, those FK references became dangling.
      // Fix: recreate affected tables with correct FK references.
      console.log('[Migration 011] Fixing broken FK references from migration 010...');

      const broken = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%_tasks_old_010%'`
      ).all() as { name: string }[];

      if (broken.length === 0) {
        console.log('[Migration 011] No broken FK references found — skipping');
        return;
      }

      // Table definitions with correct FK references to tasks(id)
      const tableDefinitions: Record<string, string> = {
        planning_questions: `CREATE TABLE planning_questions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          question TEXT NOT NULL,
          question_type TEXT DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'text', 'yes_no')),
          options TEXT,
          answer TEXT,
          answered_at TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )`,
        planning_specs: `CREATE TABLE planning_specs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          spec_markdown TEXT NOT NULL,
          locked_at TEXT NOT NULL,
          locked_by TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )`,
        conversations: `CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          title TEXT,
          type TEXT DEFAULT 'direct' CHECK (type IN ('direct', 'group', 'task')),
          task_id TEXT REFERENCES tasks(id),
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )`,
        events: `CREATE TABLE events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          agent_id TEXT REFERENCES agents(id),
          task_id TEXT REFERENCES tasks(id),
          message TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )`,
        openclaw_sessions: `CREATE TABLE openclaw_sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT REFERENCES agents(id),
          openclaw_session_id TEXT NOT NULL,
          channel TEXT,
          status TEXT DEFAULT 'active',
          session_type TEXT DEFAULT 'persistent',
          task_id TEXT REFERENCES tasks(id),
          ended_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )`,
        task_activities: `CREATE TABLE task_activities (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          agent_id TEXT REFERENCES agents(id),
          activity_type TEXT NOT NULL,
          message TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )`,
        task_deliverables: `CREATE TABLE task_deliverables (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          deliverable_type TEXT NOT NULL,
          title TEXT NOT NULL,
          path TEXT,
          description TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )`,
        task_roles: `CREATE TABLE task_roles (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          agent_id TEXT NOT NULL REFERENCES agents(id),
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(task_id, role)
        )`,
      };

      for (const { name } of broken) {
        const newSql = tableDefinitions[name];
        if (!newSql) {
          console.warn(`[Migration 011] No definition for table ${name} — skipping`);
          continue;
        }

        // Get column names from old table
        const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[])
          .map(c => c.name).join(', ');

        const tmpName = `_${name}_fix_011`;
        db.exec(`ALTER TABLE ${name} RENAME TO ${tmpName}`);
        db.exec(newSql);
        db.exec(`INSERT INTO ${name} (${cols}) SELECT ${cols} FROM ${tmpName}`);
        db.exec(`DROP TABLE ${tmpName}`);
        console.log(`[Migration 011] Recreated table: ${name}`);
      }

      // Recreate indexes for affected tables
      db.exec(`CREATE INDEX IF NOT EXISTS idx_planning_questions_task ON planning_questions(task_id, sort_order)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_task_roles_task ON task_roles(task_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_task ON task_activities(task_id, created_at DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_deliverables_task ON task_deliverables(task_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_openclaw_sessions_task ON openclaw_sessions(task_id)`);

      console.log('[Migration 011] All broken FK references fixed');
    }
  },
  {
    id: '012',
    name: 'fix_strict_template_review_queue',
    up: (db) => {
      // Update Strict template: review is a queue (no role), verification is the active QC step.
      // Also fix the seed data in migration 010 for new databases.
      console.log('[Migration 012] Updating Strict workflow template...');

      const strictStages = JSON.stringify([
        { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
        { id: 'test', label: 'Test', role: 'tester', status: 'testing' },
        { id: 'review', label: 'Review', role: null, status: 'review' },
        { id: 'verify', label: 'Verify', role: 'verifier', status: 'verification' },
        { id: 'done', label: 'Done', role: null, status: 'done' }
      ]);

      const updated = db.prepare(
        `UPDATE workflow_templates
         SET stages = ?, description = ?, updated_at = datetime('now')
         WHERE id = 'tpl-strict'`
      ).run(strictStages, 'Builder → Tester → Verifier + Learner — for critical projects');

      if (updated.changes > 0) {
        console.log('[Migration 012] Strict template updated (review is now a queue)');
      } else {
        console.log('[Migration 012] No tpl-strict found — will be correct on fresh seed');
      }
    }
  },
  {
    id: '013',
    name: 'reset_fresh_start',
    up: (db) => {
      console.log('[Migration 013] Fresh start — wiping all data and bootstrapping...');

      // 1. Delete all row data (keep workspaces + workflow_templates infrastructure)
      const tablesToWipe = [
        'task_roles',
        'task_activities',
        'task_deliverables',
        'planning_questions',
        'planning_specs',
        'knowledge_entries',
        'messages',
        'conversation_participants',
        'conversations',
        'events',
        'openclaw_sessions',
        'agents',
        'tasks',
      ];
      for (const table of tablesToWipe) {
        try {
          db.exec(`DELETE FROM ${table}`);
          console.log(`[Migration 013] Wiped ${table}`);
        } catch (err) {
          // Table might not exist on fresh DBs — skip silently
          console.log(`[Migration 013] Table ${table} not found — skipping`);
        }
      }

      // 2. Make Strict the default template, Standard non-default
      db.exec(`UPDATE workflow_templates SET is_default = 0 WHERE id = 'tpl-standard'`);
      db.exec(`UPDATE workflow_templates SET is_default = 1 WHERE id = 'tpl-strict'`);

      // 3. Fix Strict template: verification role → 'reviewer' (was 'verifier')
      const fixedStages = JSON.stringify([
        { id: 'build',  label: 'Build',  role: 'builder',  status: 'in_progress' },
        { id: 'test',   label: 'Test',   role: 'tester',   status: 'testing' },
        { id: 'review', label: 'Review', role: null,        status: 'review' },
        { id: 'verify', label: 'Verify', role: 'reviewer',  status: 'verification' },
        { id: 'done',   label: 'Done',   role: null,        status: 'done' },
      ]);
      db.prepare(
        `UPDATE workflow_templates SET stages = ?, description = ?, updated_at = datetime('now') WHERE id = 'tpl-strict'`
      ).run(fixedStages, 'Builder → Tester → Reviewer + Learner — for critical projects');

      console.log('[Migration 013] Strict template is now default with reviewer role');

      // 4. Bootstrap 4 core agents for the default workspace
      const missionControlUrl = process.env.MISSION_CONTROL_URL || 'http://localhost:4000';
      bootstrapCoreAgentsRaw(db, 'default', missionControlUrl);

      console.log('[Migration 013] Fresh start complete');
    }
  },
  {
    id: '014',
    name: 'add_agent_sync_columns',
    up: (db) => {
      console.log('[Migration 014] Adding agent sync columns...');

      const cols = (db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[]).map(c => c.name);

      if (!cols.includes('agent_dir')) {
        db.exec(`ALTER TABLE agents ADD COLUMN agent_dir TEXT`);
      }
      if (!cols.includes('agent_workspace_path')) {
        db.exec(`ALTER TABLE agents ADD COLUMN agent_workspace_path TEXT`);
      }

      console.log('[Migration 014] Agent sync columns added');
    }
  },
  {
    id: '015',
    name: 'drop_avatar_emoji_column',
    up: (db) => {
      console.log('[Migration 015] Dropping avatar_emoji column from agents...');
      const cols = (db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[]).map(c => c.name);
      if (cols.includes('avatar_emoji')) {
        db.exec(`ALTER TABLE agents DROP COLUMN avatar_emoji`);
      }
      console.log('[Migration 015] avatar_emoji column dropped');
    }
  },
  {
    id: '016',
    name: 'add_workspace_metadata_fields',
    up: (db) => {
      console.log('[Migration 016] Adding workspace metadata columns...');

      const cols = (db.prepare(`PRAGMA table_info(workspaces)`).all() as { name: string }[]).map(c => c.name);

      if (!cols.includes('github_repo')) {
        db.exec(`ALTER TABLE workspaces ADD COLUMN github_repo TEXT`);
      }

      if (!cols.includes('owner_email')) {
        db.exec(`ALTER TABLE workspaces ADD COLUMN owner_email TEXT`);
      }

      if (!cols.includes('coordinator_email')) {
        db.exec(`ALTER TABLE workspaces ADD COLUMN coordinator_email TEXT`);
      }

      console.log('[Migration 016] Workspace metadata columns added');
    }
  },
  {
    id: '017',
    name: 'add_workspace_logo_url',
    up: (db) => {
      console.log('[Migration 017] Adding workspace logo_url column...');

      const cols = (db.prepare(`PRAGMA table_info(workspaces)`).all() as { name: string }[]).map(c => c.name);

      if (!cols.includes('logo_url')) {
        db.exec(`ALTER TABLE workspaces ADD COLUMN logo_url TEXT`);
      }

      console.log('[Migration 017] Workspace logo_url column added');
    }
  },
  {
    id: '018',
    name: 'project_management_overhaul',
    up: (db) => {
      console.log('[Migration 018] Adding sprints, milestones, tags, and enhanced task fields...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS milestones (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          due_date TEXT,
          status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS sprints (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          goal TEXT,
          milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          status TEXT DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'completed', 'cancelled')),
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          color TEXT DEFAULT '#6b7280',
          UNIQUE(workspace_id, name)
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_tags (
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (task_id, tag_id)
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_comments (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          author TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_blockers (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          blocked_by_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          description TEXT,
          resolved INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_resources (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          resource_type TEXT DEFAULT 'link' CHECK (resource_type IN ('link', 'document', 'design', 'api', 'reference')),
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_acceptance_criteria (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          description TEXT NOT NULL,
          is_met INTEGER DEFAULT 0,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      const taskCols = (db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]).map(c => c.name);

      if (!taskCols.includes('task_type')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'feature' CHECK (task_type IN ('bug', 'feature', 'chore', 'documentation', 'research'))`);
      }
      if (!taskCols.includes('effort')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN effort INTEGER CHECK (effort IS NULL OR (effort >= 1 AND effort <= 5))`);
      }
      if (!taskCols.includes('impact')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN impact INTEGER CHECK (impact IS NULL OR (impact >= 1 AND impact <= 5))`);
      }
      if (!taskCols.includes('sprint_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL`);
      }
      if (!taskCols.includes('milestone_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL`);
      }
      if (!taskCols.includes('parent_task_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE`);
      }

      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sprints_workspace ON sprints(workspace_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_milestones_workspace ON milestones(workspace_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tags_workspace ON tags(workspace_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_task_blockers_task ON task_blockers(task_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_task_resources_task ON task_resources(task_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_task_acceptance_criteria_task ON task_acceptance_criteria(task_id, sort_order)`);

      console.log('[Migration 018] Project management overhaul complete');
    }
  },
  {
    id: '019',
    name: 'milestone_coordinator_sprint_number',
    up: (db) => {
      console.log('[Migration 019] Adding milestone coordinator + sprint number...');

      const milestoneCols = (db.prepare(`PRAGMA table_info(milestones)`).all() as { name: string }[]).map(c => c.name);
      if (!milestoneCols.includes('coordinator_agent_id')) {
        db.exec(`ALTER TABLE milestones ADD COLUMN coordinator_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL`);
      }

      const sprintCols = (db.prepare(`PRAGMA table_info(sprints)`).all() as { name: string }[]).map(c => c.name);
      if (!sprintCols.includes('sprint_number')) {
        db.exec(`ALTER TABLE sprints ADD COLUMN sprint_number INTEGER`);
      }

      console.log('[Migration 019] Done');
    }
  },
  {
    id: '020',
    name: 'hierarchy_agent_schema_restructure',
    up: (db) => {
      console.warn('[Migration 020] Restructuring hierarchy + agent schema...');

      const milestoneCols = (db.prepare(`PRAGMA table_info(milestones)`).all() as { name: string }[]).map(c => c.name);
      if (!milestoneCols.includes('sprint_id')) {
        db.exec(`ALTER TABLE milestones ADD COLUMN sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL`);
      }
      if (!milestoneCols.includes('priority')) {
        db.exec(`ALTER TABLE milestones ADD COLUMN priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent'))`);
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS milestone_dependencies (
          id TEXT PRIMARY KEY,
          milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
          depends_on_milestone_id TEXT REFERENCES milestones(id) ON DELETE CASCADE,
          depends_on_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
          dependency_type TEXT NOT NULL DEFAULT 'finish_to_start' CHECK (dependency_type IN ('finish_to_start', 'blocks')),
          created_at TEXT DEFAULT (datetime('now')),
          CHECK (
            (depends_on_milestone_id IS NOT NULL AND depends_on_task_id IS NULL)
            OR
            (depends_on_milestone_id IS NULL AND depends_on_task_id IS NOT NULL)
          )
        )
      `);

      const taskCols = (db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]).map(c => c.name);
      if (taskCols.includes('sprint_id') || taskCols.includes('parent_task_id')) {
        db.exec(`
          CREATE TABLE tasks_new_020 (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'inbox' CHECK (status IN ('pending_dispatch', 'planning', 'inbox', 'assigned', 'in_progress', 'testing', 'review', 'verification', 'done')),
            priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
            task_type TEXT DEFAULT 'feature' CHECK (task_type IN ('bug', 'feature', 'chore', 'documentation', 'research')),
            effort INTEGER CHECK (effort IS NULL OR (effort >= 1 AND effort <= 5)),
            impact INTEGER CHECK (impact IS NULL OR (impact >= 1 AND impact <= 5)),
            assigned_agent_id TEXT REFERENCES agents(id),
            created_by_agent_id TEXT REFERENCES agents(id),
            workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
            milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
            business_id TEXT DEFAULT 'default',
            due_date TEXT,
            workflow_template_id TEXT REFERENCES workflow_templates(id),
            planning_session_key TEXT,
            planning_messages TEXT,
            planning_complete INTEGER DEFAULT 0,
            planning_spec TEXT,
            planning_agents TEXT,
            planning_dispatch_error TEXT,
            status_reason TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )
        `);

        db.exec(`
          INSERT INTO tasks_new_020 (
            id, title, description, status, priority, task_type, effort, impact,
            assigned_agent_id, created_by_agent_id, workspace_id, milestone_id,
            business_id, due_date, workflow_template_id, planning_session_key,
            planning_messages, planning_complete, planning_spec, planning_agents,
            planning_dispatch_error, status_reason, created_at, updated_at
          )
          SELECT
            id, title, description, status, priority, task_type, effort, impact,
            assigned_agent_id, created_by_agent_id, workspace_id, milestone_id,
            business_id, due_date, workflow_template_id, planning_session_key,
            planning_messages, planning_complete, planning_spec, planning_agents,
            planning_dispatch_error, status_reason, created_at, updated_at
          FROM tasks
        `);

        db.exec(`DROP TABLE tasks`);
        db.exec(`ALTER TABLE tasks_new_020 RENAME TO tasks`);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_agent_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type)`);
      }

      const agentCols = (db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[]).map(c => c.name);
      if (agentCols.includes('is_master')) {
        db.exec(`
          CREATE TABLE agents_new_020 (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'standby' CHECK (status IN ('standby', 'working', 'offline')),
            workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
            soul_md TEXT,
            user_md TEXT,
            agents_md TEXT,
            model TEXT,
            source TEXT DEFAULT 'local',
            gateway_agent_id TEXT,
            session_key_prefix TEXT,
            agent_dir TEXT,
            agent_workspace_path TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )
        `);

        db.exec(`
          INSERT INTO agents_new_020 (
            id, name, role, description, status, workspace_id, soul_md, user_md,
            agents_md, model, source, gateway_agent_id, session_key_prefix,
            agent_dir, agent_workspace_path, created_at, updated_at
          )
          SELECT
            id, name, role, description, status, workspace_id, soul_md, user_md,
            agents_md, model, source, gateway_agent_id, session_key_prefix,
            agent_dir, agent_workspace_path, created_at, updated_at
          FROM agents
        `);

        db.exec(`UPDATE agents_new_020 SET role = 'orchestrator' WHERE id IN (SELECT id FROM agents WHERE is_master = 1)`);

        db.exec(`DROP TABLE agents`);
        db.exec(`ALTER TABLE agents_new_020 RENAME TO agents`);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`);
      }

      const sprintCols = (db.prepare(`PRAGMA table_info(sprints)`).all() as { name: string }[]).map(c => c.name);
      if (sprintCols.includes('milestone_id')) {
        db.exec(`
          CREATE TABLE sprints_new_020 (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            goal TEXT,
            sprint_number INTEGER,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            status TEXT DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'completed', 'cancelled')),
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )
        `);

        db.exec(`
          INSERT INTO sprints_new_020 (
            id, workspace_id, name, goal, sprint_number, start_date, end_date, status, created_at, updated_at
          )
          SELECT
            id, workspace_id, name, goal, sprint_number, start_date, end_date, status, created_at, updated_at
          FROM sprints
        `);

        db.exec(`DROP TABLE sprints`);
        db.exec(`ALTER TABLE sprints_new_020 RENAME TO sprints`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_sprints_workspace ON sprints(workspace_id)`);
      }

      db.exec(`DROP INDEX IF EXISTS idx_tasks_parent`);
      db.exec(`DROP INDEX IF EXISTS idx_tasks_sprint`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_milestones_sprint ON milestones(sprint_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_milestone_deps_milestone ON milestone_dependencies(milestone_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_milestone_deps_depends ON milestone_dependencies(depends_on_milestone_id, depends_on_task_id)`);

      db.exec(`
        UPDATE workflow_templates
        SET
          stages = REPLACE(
            REPLACE(stages, '"label":"Review"', '"label":"Human Verifier"'),
            '"label": "Review"',
            '"label": "Human Verifier"'
          ),
          updated_at = datetime('now')
        WHERE
          (stages LIKE '%"status":"review"%' OR stages LIKE '%"status": "review"%')
          AND (stages LIKE '%"role":null%' OR stages LIKE '%"role": null%')
          AND (stages LIKE '%"label":"Review"%' OR stages LIKE '%"label": "Review"%')
      `);

      console.warn('[Migration 020] Hierarchy + agent schema restructure complete');
    }
  },
  {
    id: '021',
    name: 'github_issues_and_task_link',
    up: (db) => {
      console.warn('[Migration 021] Adding github_issues table and tasks.github_issue_id...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS github_issues (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          github_id INTEGER NOT NULL,
          issue_number INTEGER NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          state TEXT NOT NULL DEFAULT 'open',
          state_reason TEXT,
          labels TEXT NOT NULL DEFAULT '[]',
          assignees TEXT NOT NULL DEFAULT '[]',
          github_url TEXT NOT NULL,
          author TEXT,
          created_at_github TEXT,
          updated_at_github TEXT,
          synced_at TEXT NOT NULL,
          UNIQUE(workspace_id, issue_number)
        )
      `);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_github_issues_workspace ON github_issues(workspace_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_github_issues_state ON github_issues(workspace_id, state)`);

      const taskCols = (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map(c => c.name);
      if (!taskCols.includes('github_issue_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN github_issue_id TEXT REFERENCES github_issues(id) ON DELETE SET NULL`);
        console.warn('[Migration 021] Added github_issue_id to tasks');
      }

      console.warn('[Migration 021] Done');
    }
  },
  {
    id: '022',
    name: 'add_daemon_tables',
    up: (db) => {
      console.log('[Migration 022] Adding daemon tables (agent_heartbeats, scheduled_job_runs)...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_heartbeats (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_agent ON agent_heartbeats(agent_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_created ON agent_heartbeats(created_at)`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_job_runs (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT,
          result TEXT,
          error TEXT,
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_job ON scheduled_job_runs(job_id)`);
      console.log('[Migration 022] Daemon tables created');
    }
  },
  {
    id: '023',
    name: 'add_agent_logs_table',
    up: (db) => {
      console.log('[Migration 023] Adding agent_logs table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_logs (
          id TEXT PRIMARY KEY,
          agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
          openclaw_session_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_logs_session ON agent_logs(openclaw_session_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_logs_role ON agent_logs(role)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_logs_workspace ON agent_logs(workspace_id)`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_logs_content_hash ON agent_logs(content_hash)`);
      console.log('[Migration 023] agent_logs table created');
    }
  },
  {
    id: '024',
    name: 'add_task_id_to_agent_logs',
    up: (db) => {
      console.log('[Migration 024] Adding task_id to agent_logs + backfill...');
      // Add task_id column
      db.exec(`ALTER TABLE agent_logs ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_logs_task ON agent_logs(task_id)`);
      // Backfill: derive task_id from openclaw_sessions where session matches
      db.exec(`
        UPDATE agent_logs SET task_id = (
          SELECT os.task_id FROM openclaw_sessions os
          WHERE os.openclaw_session_id = agent_logs.openclaw_session_id
          AND os.task_id IS NOT NULL
          LIMIT 1
        )
        WHERE task_id IS NULL
      `);
      console.log('[Migration 024] agent_logs.task_id added and backfilled');
    }
  }
];

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Get already applied migrations
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map(m => m.id)
  );

  // Run pending migrations in order
  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    console.log(`[DB] Running migration ${migration.id}: ${migration.name}`);

    try {
      // Disable FK checks during migrations (required for table recreation).
      // PRAGMA foreign_keys must be set outside a transaction in SQLite.
      db.pragma('foreign_keys = OFF');
      // Prevent ALTER TABLE RENAME from rewriting FK references in other tables.
      db.pragma('legacy_alter_table = ON');

      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(migration.id, migration.name);
      })();

      // Re-enable FK checks and legacy alter table
      db.pragma('legacy_alter_table = OFF');
      db.pragma('foreign_keys = ON');

      console.log(`[DB] Migration ${migration.id} completed`);
    } catch (error) {
      // Re-enable FK checks even on failure
      db.pragma('foreign_keys = ON');
      console.error(`[DB] Migration ${migration.id} failed:`, error);
      throw error;
    }
  }
}

/**
 * Get migration status
 */
export function getMigrationStatus(db: Database.Database): { applied: string[]; pending: string[] } {
  const applied = (db.prepare('SELECT id FROM _migrations ORDER BY id').all() as { id: string }[]).map(m => m.id);
  const pending = migrations.filter(m => !applied.includes(m.id)).map(m => m.id);
  return { applied, pending };
}
