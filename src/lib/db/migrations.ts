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
import { provisionWorkflowTemplates } from '@/lib/workflow-templates';

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

      // 4. Bootstrap core agents globally (default workspace)
  const styrmannUrl = process.env.STYRMAN_URL || 'http://localhost:4000';
      bootstrapCoreAgentsRaw(db, styrmannUrl);

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
      const hasColumn = db.prepare(`SELECT COUNT(*) as cnt FROM pragma_table_info('agent_logs') WHERE name = 'task_id'`).get() as { cnt: number };
      if (!hasColumn.cnt) {
        db.exec(`ALTER TABLE agent_logs ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`);
      }
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
  },
  {
    id: '025',
    name: 'add_acp_bindings_table',
    up: (db) => {
      console.log('[Migration 025] Adding acp_bindings table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS acp_bindings (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          discord_thread_id TEXT NOT NULL,
          discord_channel_id TEXT,
          discord_guild_id TEXT DEFAULT '1406182923563958352',
          acp_session_key TEXT NOT NULL,
          acp_agent_id TEXT DEFAULT 'opencode',
          agent_id TEXT REFERENCES agents(id),
          task_id TEXT REFERENCES tasks(id),
          status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','closed')),
          cwd TEXT DEFAULT '/root/.openclaw/workspace',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_acp_bindings_workspace ON acp_bindings(workspace_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_acp_bindings_status ON acp_bindings(status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_acp_bindings_thread ON acp_bindings(discord_thread_id)`);
      console.log('[Migration 025] acp_bindings table created');
    }
  },
  {
    id: '026',
    name: 'repo_workspace_cleanup',
    up: (db) => {
      console.log('[Migration 026] Cleaning up workspaces for repo-driven model...');

      // Delete test-flow-workspace and its associated data
      const testWs = db.prepare("SELECT id FROM workspaces WHERE slug = 'test-flow-workspace'").get() as { id: string } | undefined;
      if (testWs) {
        db.prepare('DELETE FROM workflow_templates WHERE workspace_id = ?').run(testWs.id);
        db.prepare('DELETE FROM tasks WHERE workspace_id = ?').run(testWs.id);
        db.prepare('DELETE FROM sprints WHERE workspace_id = ?').run(testWs.id);
        db.prepare('DELETE FROM milestones WHERE workspace_id = ?').run(testWs.id);
        db.prepare('DELETE FROM workspaces WHERE id = ?').run(testWs.id);
        console.log('[Migration 026] Deleted test-flow-workspace and its data');
      }

      // Update default workspace to be repo-linked to mission-control
      db.prepare(`
        UPDATE workspaces
        SET name = 'Mission Control', slug = 'mission-control', github_repo = 'https://github.com/Blockether/mission-control', updated_at = datetime('now')
        WHERE id = 'default'
      `).run();

      console.log('[Migration 026] Updated default workspace -> mission-control');
    }
  },
  {
    id: '027',
    name: 'add_workspace_organization',
    up: (db) => {
      console.log('[Migration 027] Adding organization column to workspaces...');

      const cols = (db.prepare('PRAGMA table_info(workspaces)').all() as { name: string }[]).map(c => c.name);

      if (!cols.includes('organization')) {
        db.exec('ALTER TABLE workspaces ADD COLUMN organization TEXT');
        db.exec('CREATE INDEX IF NOT EXISTS idx_workspaces_organization ON workspaces(organization)');
      }

      // Set organization for existing workspaces based on github_repo
      db.prepare(`
        UPDATE workspaces
        SET organization = 'blockether'
        WHERE github_repo LIKE '%github.com/Blockether/%'
      `).run();

      // Rename slugs to org-repo format
      db.prepare(`
        UPDATE workspaces SET slug = 'blockether-mission-control' WHERE id = 'default'
      `).run();

      // Rename spel workspace slug
      db.prepare(`
        UPDATE workspaces SET slug = 'blockether-spel' WHERE slug = 'spel' OR slug = 'blockether-spel'
      `).run();

      console.log('[Migration 027] Organization column added, slugs updated to org-repo format');
    }
  },
  {
    id: '028',
    name: 'extend_task_type_with_autotrain',
    up: (db) => {
      console.log('[Migration 028] Extending tasks.task_type CHECK to include autotrain...');

      db.exec(`
        CREATE TABLE tasks_new_028 (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'inbox' CHECK (status IN ('pending_dispatch', 'planning', 'inbox', 'assigned', 'in_progress', 'testing', 'review', 'verification', 'done')),
          priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
          task_type TEXT DEFAULT 'feature' CHECK (task_type IN ('bug', 'feature', 'chore', 'documentation', 'research', 'autotrain')),
          effort INTEGER CHECK (effort IS NULL OR (effort >= 1 AND effort <= 5)),
          impact INTEGER CHECK (impact IS NULL OR (impact >= 1 AND impact <= 5)),
          assigned_agent_id TEXT REFERENCES agents(id),
          created_by_agent_id TEXT REFERENCES agents(id),
          workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
          milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
          github_issue_id TEXT REFERENCES github_issues(id) ON DELETE SET NULL,
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
        INSERT INTO tasks_new_028 (
          id, title, description, status, priority, task_type, effort, impact,
          assigned_agent_id, created_by_agent_id, workspace_id, milestone_id,
          github_issue_id, business_id, due_date, workflow_template_id, planning_session_key,
          planning_messages, planning_complete, planning_spec, planning_agents,
          planning_dispatch_error, status_reason, created_at, updated_at
        )
        SELECT
          id, title, description, status, priority, task_type, effort, impact,
          assigned_agent_id, created_by_agent_id, workspace_id, milestone_id,
          github_issue_id, business_id, due_date, workflow_template_id, planning_session_key,
          planning_messages, planning_complete, planning_spec, planning_agents,
          planning_dispatch_error, status_reason, created_at, updated_at
        FROM tasks
      `);

      db.exec('DROP TABLE tasks');
      db.exec('ALTER TABLE tasks_new_028 RENAME TO tasks');

      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_agent_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type)');

      console.log('[Migration 028] tasks.task_type now supports autotrain');
    }
  },
  {
    id: '029',
    name: 'add_task_run_results_and_rename_self_improve_template',
    up: (db) => {
      console.log('[Migration 029] Adding task run snapshots and renaming old Auto-Train templates...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_run_results (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          run_number INTEGER NOT NULL,
          status TEXT NOT NULL,
          summary TEXT,
          agent_id TEXT REFERENCES agents(id),
          openclaw_session_id TEXT,
          completed_activity_id TEXT REFERENCES task_activities(id) ON DELETE SET NULL,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(task_id, run_number)
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_run_result_artifacts (
          id TEXT PRIMARY KEY,
          task_run_result_id TEXT NOT NULL REFERENCES task_run_results(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          deliverable_id TEXT REFERENCES task_deliverables(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          path TEXT,
          normalized_path TEXT,
          content_type TEXT,
          size_bytes INTEGER,
          encoding TEXT,
          content_text TEXT,
          content_base64 TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec('CREATE INDEX IF NOT EXISTS idx_task_run_results_task ON task_run_results(task_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_task_run_result_artifacts_run ON task_run_result_artifacts(task_run_result_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_task_run_result_artifacts_task ON task_run_result_artifacts(task_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_task_run_result_artifacts_path ON task_run_result_artifacts(normalized_path, created_at DESC)');

      db.prepare(`
        UPDATE workflow_templates
        SET name = 'Self Improve', updated_at = datetime('now')
        WHERE name = 'Auto-Train'
      `).run();

      console.log('[Migration 029] Task run snapshots added and templates renamed to Self Improve');
    }
  },
  {
    id: '030',
    name: 'add_agent_scoped_knowledge_and_memory',
    up: (db) => {
      console.log('[Migration 030] Adding agent-scoped knowledge and agent memory support...');

      const agentColumns = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
      if (!agentColumns.some((column) => column.name === 'memory_md')) {
        db.exec('ALTER TABLE agents ADD COLUMN memory_md TEXT');
      }

      const knowledgeColumns = db.prepare("PRAGMA table_info(knowledge_entries)").all() as { name: string }[];
      if (!knowledgeColumns.some((column) => column.name === 'agent_id')) {
        db.exec('ALTER TABLE knowledge_entries ADD COLUMN agent_id TEXT REFERENCES agents(id)');
      }

      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_entries_agent ON knowledge_entries(agent_id, created_at DESC)');

      console.log('[Migration 030] Agent-scoped knowledge and memory support added');
    }
  },
  {
    id: '031',
    name: 'remove_legacy_autotrain_task_type',
    up: (db) => {
      console.log('[Migration 031] Removing legacy autotrain task type and normalizing old tasks...');

      db.exec(`
        UPDATE tasks
        SET task_type = 'chore',
            status_reason = CASE
              WHEN status_reason IS NULL OR status_reason = '' THEN 'Legacy autotrain task converted to chore during migration.'
              ELSE status_reason
            END
        WHERE task_type = 'autotrain'
      `);

      const taskSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
      if (taskSchema && taskSchema.sql.includes("'autotrain'")) {
        db.exec(`ALTER TABLE tasks RENAME TO _tasks_old_031`);
        db.exec(`
          CREATE TABLE tasks (
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
            github_issue_id TEXT REFERENCES github_issues(id) ON DELETE SET NULL,
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
          INSERT INTO tasks (
            id, title, description, status, priority, task_type, effort, impact,
            assigned_agent_id, created_by_agent_id, workspace_id, milestone_id, github_issue_id,
            business_id, due_date, workflow_template_id,
            planning_session_key, planning_messages, planning_complete, planning_spec, planning_agents,
            planning_dispatch_error, status_reason, created_at, updated_at
          )
          SELECT
            id, title, description, status, priority,
            CASE WHEN task_type = 'autotrain' THEN 'chore' ELSE task_type END,
            effort, impact,
            assigned_agent_id, created_by_agent_id, workspace_id, milestone_id, github_issue_id,
            business_id, due_date, workflow_template_id,
            planning_session_key, planning_messages, planning_complete, planning_spec, planning_agents,
            planning_dispatch_error, status_reason, created_at, updated_at
          FROM _tasks_old_031
        `);

        db.exec('DROP TABLE _tasks_old_031');
        db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_agent_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type)');
      }

      db.exec(`
        DELETE FROM workflow_templates
        WHERE name = 'Self Improve'
          AND id NOT IN (
            SELECT DISTINCT workflow_template_id
            FROM tasks
            WHERE workflow_template_id IS NOT NULL
          )
      `);

      console.log('[Migration 031] Legacy autotrain removed');
    }
  },
  {
    id: '032',
    name: 'normalize_workflow_template_descriptions',
    up: (db) => {
      console.log('[Migration 032] Normalizing workflow template descriptions...');

      db.prepare(
        `UPDATE workflow_templates
         SET description = ?, updated_at = datetime('now')
         WHERE name = 'Simple'`
      ).run('Single builder pass. Best for small, straightforward tasks.');

      db.prepare(
        `UPDATE workflow_templates
         SET description = ?, updated_at = datetime('now')
         WHERE name = 'Standard'`
      ).run('Builder implementation -> tester validation -> reviewer approval. Best default for most tasks.');

      db.prepare(
        `UPDATE workflow_templates
         SET description = ?, updated_at = datetime('now')
         WHERE name = 'Strict'`
      ).run('Builder -> tester -> human checkpoint -> reviewer verification. Use for high-risk or production-critical tasks.');

      console.log('[Migration 032] Workflow template descriptions normalized');
    }
  },
  {
    id: '033',
    name: 'agent_only_workflow_templates_with_human_acceptance_gate',
    up: (db) => {
      console.log('[Migration 033] Converting workflow templates to agent-only stages with explicit human acceptance gate...');

      const simpleStages = JSON.stringify([
        { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
        { id: 'review', label: 'Review', role: 'reviewer', status: 'review' },
        { id: 'done', label: 'Done', role: null, status: 'done' },
      ]);
      const standardStages = JSON.stringify([
        { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
        { id: 'test', label: 'Test', role: 'tester', status: 'testing' },
        { id: 'review', label: 'Review', role: 'reviewer', status: 'review' },
        { id: 'done', label: 'Done', role: null, status: 'done' },
      ]);
      const strictStages = JSON.stringify([
        { id: 'build', label: 'Build', role: 'builder', status: 'in_progress' },
        { id: 'test', label: 'Test', role: 'tester', status: 'testing' },
        { id: 'verify', label: 'Verify', role: 'reviewer', status: 'verification' },
        { id: 'review', label: 'Review', role: 'reviewer', status: 'review' },
        { id: 'done', label: 'Done', role: null, status: 'done' },
      ]);

      db.prepare(
        `UPDATE workflow_templates
         SET stages = ?, fail_targets = ?, description = ?, updated_at = datetime('now')
         WHERE name = 'Simple'`
      ).run(
        simpleStages,
        JSON.stringify({ review: 'in_progress' }),
        'Builder implementation -> reviewer quality pass -> human acceptance merge.'
      );

      db.prepare(
        `UPDATE workflow_templates
         SET stages = ?, fail_targets = ?, description = ?, updated_at = datetime('now')
         WHERE name = 'Standard'`
      ).run(
        standardStages,
        JSON.stringify({ testing: 'in_progress', review: 'in_progress' }),
        'Builder implementation -> tester validation -> reviewer quality pass -> human acceptance merge.'
      );

      db.prepare(
        `UPDATE workflow_templates
         SET stages = ?, fail_targets = ?, description = ?, updated_at = datetime('now')
         WHERE name = 'Strict'`
      ).run(
        strictStages,
        JSON.stringify({ testing: 'in_progress', verification: 'in_progress', review: 'in_progress' }),
        'Builder -> tester -> reviewer verification -> reviewer final review -> human acceptance merge for critical work.'
      );

      console.log('[Migration 033] Workflow templates converted');
    }
  },
  {
    id: '034',
    name: 'link_task_sessions_and_deliverables_to_openclaw_sessions',
    up: (db) => {
      console.log('[Migration 034] Linking task sessions and deliverables to OpenClaw sessions...');

      const deliverableColumns = db.prepare("PRAGMA table_info(task_deliverables)").all() as { name: string }[];
      if (!deliverableColumns.some((column) => column.name === 'openclaw_session_id')) {
        db.exec('ALTER TABLE task_deliverables ADD COLUMN openclaw_session_id TEXT');
      }

      db.exec(`
        UPDATE openclaw_sessions
        SET task_id = (
          SELECT ta.task_id
          FROM task_activities ta
          WHERE ta.activity_type = 'dispatch_invocation'
            AND json_extract(ta.metadata, '$.openclaw_session_id') = openclaw_sessions.openclaw_session_id
          ORDER BY ta.created_at DESC
          LIMIT 1
        )
        WHERE task_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM task_activities ta
            WHERE ta.activity_type = 'dispatch_invocation'
              AND json_extract(ta.metadata, '$.openclaw_session_id') = openclaw_sessions.openclaw_session_id
          )
      `);

      db.exec(`
        UPDATE openclaw_sessions
        SET session_type = 'subagent'
        WHERE session_type = 'persistent'
          AND openclaw_session_id LIKE 'mission-control-%'
          AND task_id IS NOT NULL
      `);

      db.exec(`
        UPDATE task_deliverables
        SET openclaw_session_id = (
          SELECT json_extract(ta.metadata, '$.openclaw_session_id')
          FROM task_activities ta
          WHERE ta.task_id = task_deliverables.task_id
            AND ta.activity_type = 'dispatch_invocation'
          ORDER BY ta.created_at DESC
          LIMIT 1
        )
        WHERE openclaw_session_id IS NULL
      `);

      db.exec('CREATE INDEX IF NOT EXISTS idx_deliverables_session ON task_deliverables(openclaw_session_id)');

      console.log('[Migration 034] Session and deliverable linkage backfilled');
    }
  },
  {
    id: '035',
    name: 'add_task_provenance_table',
    up: (db) => {
      console.log('[Migration 035] Creating task_provenance table...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_provenance (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          session_id TEXT,
          kind TEXT NOT NULL,
          origin_session_id TEXT,
          source_session_key TEXT,
          source_channel TEXT,
          source_tool TEXT,
          receipt_text TEXT,
          receipt_data TEXT,
          message_role TEXT,
          message_index INTEGER,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec('CREATE INDEX IF NOT EXISTS idx_task_provenance_task ON task_provenance(task_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_task_provenance_session ON task_provenance(session_id)');

      console.log('[Migration 035] task_provenance table created');
    }
  },
  {
    id: '036',
    name: 'add_human_assignments_and_workspace_config',
    up: (db) => {
      console.log('[Migration 036] Adding human assignment support and workspace config...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS humans (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        INSERT OR IGNORE INTO humans (id, name, email, is_active)
        VALUES
          ('human-karol', 'Karol', 'karol@blockether.com', 1),
          ('human-alex', 'Alex', 'alex@blockether.com', 1)
      `);

      const taskInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      if (!taskInfo.some((col) => col.name === 'assignee_type')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN assignee_type TEXT DEFAULT 'ai' CHECK (assignee_type IN ('ai', 'human'))`);
      }
      if (!taskInfo.some((col) => col.name === 'assigned_human_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN assigned_human_id TEXT REFERENCES humans(id)`);
      }

      db.exec(`UPDATE tasks SET assignee_type = CASE WHEN assigned_human_id IS NOT NULL THEN 'human' ELSE 'ai' END WHERE assignee_type IS NULL OR assignee_type = ''`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_assigned_human ON tasks(assigned_human_id)');

      console.log('[Migration 036] Human assignment support ready');
    }
  },
  {
    id: '037',
    name: 'create_openclaw_meta_repository',
    up: (db) => {
      console.log('[Migration 037] Creating OpenClaw meta repository and decoupling Styrmann...');

      const workspaceInfo = db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[];
      const workspaceCols = new Set(workspaceInfo.map((col) => col.name));

      if (!workspaceCols.has('is_internal')) {
        db.exec(`ALTER TABLE workspaces ADD COLUMN is_internal INTEGER DEFAULT 0`);
      }
      if (!workspaceCols.has('repo_kind')) {
        db.exec(`ALTER TABLE workspaces ADD COLUMN repo_kind TEXT DEFAULT 'standard' CHECK (repo_kind IN ('standard', 'meta'))`);
      }
      if (!workspaceCols.has('local_path')) {
        db.exec(`ALTER TABLE workspaces ADD COLUMN local_path TEXT`);
      }

      const metaWorkspaceId = 'default';
      const styrmannWorkspaceId = 'workspace-mission-control';
      const styrmannRepo = 'https://github.com/Blockether/mission-control';
      const styrmannSlug = 'blockether-mission-control';
      const styrmannPath = '/root/repos/blockether/mission-control';
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE workspaces
        SET name = ?,
            slug = ?,
            description = ?,
            icon = ?,
            github_repo = NULL,
            is_internal = 1,
            repo_kind = 'meta',
            local_path = ?,
            organization = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        'System / OpenClaw',
        'system-openclaw',
        'Internal OpenClaw meta repository for system skills, .openclaw configuration, and meta-programming artifacts.',
        'OC',
        '/root/.openclaw',
        'System',
        metaWorkspaceId,
      );

      const existingStyrmann = db.prepare(
        `SELECT id FROM workspaces WHERE id = ? OR github_repo = ? OR slug = ? OR local_path = ? LIMIT 1`
      ).get(styrmannWorkspaceId, styrmannRepo, styrmannSlug, styrmannPath) as { id: string } | undefined;

      const resolvedStyrmannWorkspaceId = existingStyrmann?.id || styrmannWorkspaceId;

      if (existingStyrmann) {
        db.prepare(`
          UPDATE workspaces
          SET name = ?,
              slug = ?,
              description = COALESCE(description, ?),
              icon = COALESCE(icon, 'BL'),
              github_repo = ?,
              is_internal = 0,
              repo_kind = 'standard',
              local_path = ?,
              organization = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(
          'Styrmann',
          styrmannSlug,
          'Styrmann product repository.',
          styrmannRepo,
          styrmannPath,
          'blockether',
          resolvedStyrmannWorkspaceId,
        );
      } else {
        db.prepare(`
          INSERT INTO workspaces (
            id, name, slug, description, icon, github_repo, is_internal, repo_kind, local_path, organization, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 'standard', ?, ?, ?, ?)
        `).run(
          resolvedStyrmannWorkspaceId,
          'Styrmann',
          styrmannSlug,
          'Styrmann product repository.',
          'BL',
          styrmannRepo,
          styrmannPath,
          'blockether',
          now,
          now,
        );
      }

      db.prepare(`UPDATE tasks SET workspace_id = ? WHERE workspace_id = ?`).run(resolvedStyrmannWorkspaceId, metaWorkspaceId);
      db.prepare(`UPDATE sprints SET workspace_id = ? WHERE workspace_id = ?`).run(resolvedStyrmannWorkspaceId, metaWorkspaceId);
      db.prepare(`UPDATE milestones SET workspace_id = ? WHERE workspace_id = ?`).run(resolvedStyrmannWorkspaceId, metaWorkspaceId);
      db.prepare(`UPDATE github_issues SET workspace_id = ? WHERE workspace_id = ?`).run(resolvedStyrmannWorkspaceId, metaWorkspaceId);
      db.prepare(`UPDATE tags SET workspace_id = ? WHERE workspace_id = ?`).run(resolvedStyrmannWorkspaceId, metaWorkspaceId);
      db.prepare(`UPDATE workflow_templates SET workspace_id = ? WHERE workspace_id = ?`).run(resolvedStyrmannWorkspaceId, metaWorkspaceId);
      db.prepare(`UPDATE knowledge_entries SET workspace_id = ? WHERE workspace_id = ?`).run(resolvedStyrmannWorkspaceId, metaWorkspaceId);
      db.prepare(`UPDATE acp_bindings SET workspace_id = ? WHERE workspace_id = ?`).run(resolvedStyrmannWorkspaceId, metaWorkspaceId);
      db.prepare(`UPDATE agent_logs SET workspace_id = ? WHERE workspace_id = ?`).run(resolvedStyrmannWorkspaceId, metaWorkspaceId);
      db.prepare(`UPDATE agents SET workspace_id = ? WHERE workspace_id = ? AND COALESCE(source, 'local') NOT IN ('synced', 'gateway')`).run(resolvedStyrmannWorkspaceId, metaWorkspaceId);

      provisionWorkflowTemplates(db, metaWorkspaceId);

      console.log(`[Migration 037] Meta repository: ${metaWorkspaceId} -> system-openclaw`);
      console.log(`[Migration 037] Styrmann workspace: ${resolvedStyrmannWorkspaceId} -> ${styrmannSlug}`);
    }
  },
  {
    id: '038',
    name: 'add_memory_pipeline_and_vector_index',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_vectors (
          knowledge_id TEXT PRIMARY KEY REFERENCES knowledge_entries(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          model TEXT NOT NULL DEFAULT 'hash96-v1',
          dimension INTEGER NOT NULL DEFAULT 96,
          vector_json TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_pipeline_config (
          id TEXT PRIMARY KEY,
          enabled INTEGER DEFAULT 1,
          llm_enabled INTEGER DEFAULT 1,
          schedule_cron TEXT DEFAULT '0 * * * *',
          top_k INTEGER DEFAULT 24,
          llm_model TEXT DEFAULT 'gpt-4o-mini',
          llm_base_url TEXT DEFAULT 'https://api.openai.com/v1',
          summary_prompt TEXT,
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_workspace ON knowledge_vectors(workspace_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_agent ON knowledge_vectors(agent_id)');

      db.prepare(
        `INSERT INTO memory_pipeline_config (id, enabled, llm_enabled, schedule_cron, top_k, llm_model, llm_base_url, summary_prompt, updated_at)
         VALUES ('default', 1, 1, '0 * * * *', 24, 'gpt-4o-mini', 'https://api.openai.com/v1',
                 'Summarize durable learnings into concise operational rules for MEMORY, SOUL, AGENTS, and USER artifacts. Keep output factual and directly actionable.', datetime('now'))
         ON CONFLICT(id) DO NOTHING`
      ).run();

      const dimension = 96;
      const tokenize = (text: string): string[] => text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2)
        .slice(0, 800);

      const hashToken = (token: string): number => {
        let hash = 2166136261;
        for (let i = 0; i < token.length; i += 1) {
          hash ^= token.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0);
      };

      const normalize = (vector: number[]): number[] => {
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
        if (!norm) return vector;
        return vector.map((value) => value / norm);
      };

      const vectorize = (text: string): number[] => {
        const vector = new Array<number>(dimension).fill(0);
        for (const token of tokenize(text)) {
          const index = hashToken(token) % dimension;
          vector[index] += 1;
        }
        return normalize(vector);
      };

      const entries = db.prepare(
        `SELECT id, workspace_id, agent_id, category, title, content, tags
         FROM knowledge_entries`
      ).all() as Array<{
        id: string;
        workspace_id: string;
        agent_id?: string | null;
        category: string;
        title: string;
        content: string;
        tags?: string | null;
      }>;

      const upsert = db.prepare(
        `INSERT INTO knowledge_vectors (knowledge_id, workspace_id, agent_id, model, dimension, vector_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(knowledge_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           agent_id = excluded.agent_id,
           model = excluded.model,
           dimension = excluded.dimension,
           vector_json = excluded.vector_json,
           updated_at = excluded.updated_at`
      );

      for (const entry of entries) {
        const text = `${entry.category} ${entry.title} ${entry.content} ${entry.tags || ''}`;
        upsert.run(entry.id, entry.workspace_id, entry.agent_id || null, 'hash96-v1', dimension, JSON.stringify(vectorize(text)));
      }
    }
  },
  {
    id: '039',
    name: 'add_knowledge_attachments_and_routing_decisions',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_attachments (
          id TEXT PRIMARY KEY,
          knowledge_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          file_name TEXT NOT NULL,
          mime_type TEXT,
          size_bytes INTEGER,
          content_text TEXT,
          content_base64 TEXT,
          source_url TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_routing_decisions (
          id TEXT PRIMARY KEY,
          knowledge_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          score REAL NOT NULL,
          selected INTEGER DEFAULT 0,
          reasons TEXT NOT NULL DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_attachments_knowledge ON knowledge_attachments(knowledge_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_attachments_workspace ON knowledge_attachments(workspace_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_routing_decisions_knowledge ON knowledge_routing_decisions(knowledge_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_routing_decisions_agent ON knowledge_routing_decisions(agent_id, created_at DESC)');
    }
  },
  {
    id: '040',
    name: 'add_orchestrator_workflow_plans_and_proposals',
    up: (db) => {
      const tasksInfo = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>;
      if (!tasksInfo.some((column) => column.name === 'workflow_plan_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN workflow_plan_id TEXT`);
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_workflow_plans (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          orchestrator_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          workflow_template_id TEXT REFERENCES workflow_templates(id) ON DELETE SET NULL,
          workflow_name TEXT NOT NULL,
          summary TEXT NOT NULL,
          participants_json TEXT NOT NULL,
          steps_json TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_findings (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          finding_type TEXT NOT NULL,
          severity TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS capability_proposals (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          learner_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          proposal_type TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL,
          target_name TEXT NOT NULL,
          meta_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
          meta_workspace_slug TEXT,
          status TEXT DEFAULT 'open',
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      db.exec('CREATE INDEX IF NOT EXISTS idx_task_workflow_plans_task ON task_workflow_plans(task_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_task_findings_task ON task_findings(task_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_capability_proposals_task ON capability_proposals(task_id, created_at DESC)');
    }
  },
  {
    id: '041',
    name: 'bootstrap_presenter_agent',
    up: (db) => {
      // Agents are global — bootstrap once into 'default', not per-workspace.
  const styrmannUrl = process.env.STYRMAN_URL || 'http://localhost:4000';
      bootstrapCoreAgentsRaw(db, styrmannUrl);
    }
  },
  {
    id: '042',
    name: 'drop_agents_workspace_id',
    up: (db) => {
      db.exec('DROP INDEX IF EXISTS idx_agents_workspace');

      const agentColumns = (db.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[]).map((column) => column.name);
      if (agentColumns.includes('workspace_id')) {
        db.exec('ALTER TABLE agents DROP COLUMN workspace_id');
      }
    }
  },
  {
    id: '043',
    name: 'add_knowledge_links',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_links (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
          target_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
          link_type TEXT NOT NULL DEFAULT 'related',
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(source_id, target_id)
        )
      `);
    }
  },
  {
    id: '044',
    name: 'add_task_dependencies_and_stage_artifacts',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_dependencies (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          required_status TEXT NOT NULL DEFAULT 'done',
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(task_id, depends_on_task_id)
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_artifacts (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          stage_status TEXT,
          artifact_key TEXT NOT NULL,
          artifact_value TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(task_id, stage_status, artifact_key)
        )
      `);

      db.exec('CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id, required_status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends ON task_dependencies(depends_on_task_id, required_status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_task_artifacts_task ON task_artifacts(task_id, stage_status, artifact_key)');
    }
  },
  {
    id: '045',
    name: 'add_acceptance_criteria_gate_fields',
    up: (db) => {
      const cols = (db.prepare('PRAGMA table_info(task_acceptance_criteria)').all() as { name: string }[]).map((c) => c.name);
      if (!cols.includes('parent_criteria_id')) {
        db.exec('ALTER TABLE task_acceptance_criteria ADD COLUMN parent_criteria_id TEXT REFERENCES task_acceptance_criteria(id) ON DELETE CASCADE');
      }
      if (!cols.includes('required_for_status')) {
        db.exec('ALTER TABLE task_acceptance_criteria ADD COLUMN required_for_status TEXT');
      }
      if (!cols.includes('gate_type')) {
        db.exec('ALTER TABLE task_acceptance_criteria ADD COLUMN gate_type TEXT DEFAULT \'manual\'');
      }
      if (!cols.includes('artifact_key')) {
        db.exec('ALTER TABLE task_acceptance_criteria ADD COLUMN artifact_key TEXT');
      }

      db.exec("UPDATE task_acceptance_criteria SET required_for_status = COALESCE(required_for_status, 'done')");
      db.exec("UPDATE task_acceptance_criteria SET gate_type = COALESCE(gate_type, 'manual')");
      db.exec('CREATE INDEX IF NOT EXISTS idx_task_acceptance_parent ON task_acceptance_criteria(task_id, parent_criteria_id, sort_order)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_task_acceptance_gate ON task_acceptance_criteria(task_id, required_for_status, gate_type)');
    }
  },
  {
    id: '046',
    name: 'remove_mission_control_knowledge_system',
    up: (db) => {
      db.exec('DROP INDEX IF EXISTS idx_knowledge_entries_workspace');
      db.exec('DROP INDEX IF EXISTS idx_knowledge_entries_task');
      db.exec('DROP INDEX IF EXISTS idx_knowledge_entries_agent');
      db.exec('DROP INDEX IF EXISTS idx_knowledge_attachments_knowledge');
      db.exec('DROP INDEX IF EXISTS idx_knowledge_attachments_workspace');
      db.exec('DROP INDEX IF EXISTS idx_knowledge_routing_decisions_knowledge');
      db.exec('DROP INDEX IF EXISTS idx_knowledge_routing_decisions_agent');

      db.exec('DROP TABLE IF EXISTS knowledge_links');
      db.exec('DROP TABLE IF EXISTS knowledge_vectors');
      db.exec('DROP TABLE IF EXISTS knowledge_routing_decisions');
      db.exec('DROP TABLE IF EXISTS knowledge_attachments');
      db.exec('DROP TABLE IF EXISTS knowledge_entries');
    }
  },
  {
    id: '047',
    name: 'rename_openclaw_to_session',
    up: (db) => {
      db.exec('DROP INDEX IF EXISTS idx_openclaw_sessions_task');
      db.exec('DROP INDEX IF EXISTS idx_agent_logs_session');
      db.exec('DROP INDEX IF EXISTS idx_agent_logs_content_hash');
      db.exec('DROP INDEX IF EXISTS idx_deliverables_session');

      db.exec('ALTER TABLE openclaw_sessions RENAME TO sessions');
      db.exec('ALTER TABLE sessions RENAME COLUMN openclaw_session_id TO session_id');
      db.exec('ALTER TABLE agent_logs RENAME COLUMN openclaw_session_id TO session_id');
      db.exec('ALTER TABLE task_deliverables RENAME COLUMN openclaw_session_id TO session_id');
      db.exec('ALTER TABLE task_run_results RENAME COLUMN openclaw_session_id TO session_id');

      db.exec('CREATE INDEX idx_sessions_task ON sessions(task_id)');
      db.exec('CREATE INDEX idx_agent_logs_session ON agent_logs(session_id)');
      db.exec('CREATE UNIQUE INDEX idx_agent_logs_content_hash ON agent_logs(content_hash)');
      db.exec('CREATE INDEX idx_deliverables_session ON task_deliverables(session_id)');
    }
  },
  {
    id: '048',
    name: 'add_session_dispatch_tracking',
    up: (db) => {
      const cols = (db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).map(c => c.name);
      if (!cols.includes('last_dispatched_at')) {
        db.exec('ALTER TABLE sessions ADD COLUMN last_dispatched_at TEXT');
      }
      if (!cols.includes('dispatch_pid')) {
        db.exec('ALTER TABLE sessions ADD COLUMN dispatch_pid INTEGER');
      }
    }
  },
  {
    id: '049',
    name: 'add_deliverable_source',
    up: (db) => {
      const cols = (db.prepare(`PRAGMA table_info(task_deliverables)`).all() as { name: string }[]).map(c => c.name);
      if (!cols.includes('source')) {
        db.exec("ALTER TABLE task_deliverables ADD COLUMN source TEXT DEFAULT 'agent'");
      }
    }
  },
  {
    id: '050',
    name: 'add_spike_task_type',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks_new AS SELECT * FROM tasks WHERE 0;
      `);
      db.exec(`DROP TABLE IF EXISTS tasks_new`);

      const cols = (db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[]);
      const hasCheck = cols.find(c => c.name === 'task_type');
      if (!hasCheck) return;

      db.exec(`
        CREATE TABLE tasks_rebuild (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'inbox' CHECK (status IN ('pending_dispatch', 'planning', 'inbox', 'assigned', 'in_progress', 'testing', 'review', 'verification', 'done')),
          priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
          task_type TEXT DEFAULT 'feature' CHECK (task_type IN ('bug', 'feature', 'chore', 'documentation', 'research', 'spike')),
          effort INTEGER CHECK (effort IS NULL OR (effort >= 1 AND effort <= 5)),
          impact INTEGER CHECK (impact IS NULL OR (impact >= 1 AND impact <= 5)),
          assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          created_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
          milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
          github_issue_id TEXT REFERENCES github_issues(id) ON DELETE SET NULL,
          business_id TEXT DEFAULT 'default',
          due_date TEXT,
          workflow_template_id TEXT REFERENCES workflow_templates(id) ON DELETE SET NULL,
          planning_session_key TEXT,
          planning_messages TEXT,
          planning_complete INTEGER DEFAULT 0,
          planning_spec TEXT,
          planning_agents TEXT,
          planning_dispatch_error TEXT,
          status_reason TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          assignee_type TEXT DEFAULT 'ai' CHECK (assignee_type IN ('ai', 'human')),
          assigned_human_id TEXT,
          workflow_plan_id TEXT
        );
        INSERT INTO tasks_rebuild SELECT * FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_rebuild RENAME TO tasks;
        CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type);
        CREATE INDEX IF NOT EXISTS idx_tasks_business ON tasks(business_id);
      `);
    }
  },
  {
    id: '051',
    name: 'add_discord_messages',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS discord_messages (
          id TEXT PRIMARY KEY,
          discord_message_id TEXT NOT NULL,
          discord_channel_id TEXT NOT NULL,
          discord_guild_id TEXT NOT NULL,
          discord_author_id TEXT NOT NULL,
          discord_author_name TEXT NOT NULL,
          content TEXT NOT NULL,
          classification TEXT NOT NULL CHECK (classification IN ('task', 'conversation', 'clarification')),
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
          response_sent INTEGER DEFAULT 0,
          completion_notified INTEGER DEFAULT 0,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_discord_messages_discord_id ON discord_messages(discord_message_id);
        CREATE INDEX IF NOT EXISTS idx_discord_messages_task ON discord_messages(task_id);
        CREATE INDEX IF NOT EXISTS idx_discord_messages_channel ON discord_messages(discord_channel_id);
        CREATE INDEX IF NOT EXISTS idx_discord_messages_classification ON discord_messages(classification);
      `);
    }
  },
  {
    id: '052',
    name: 'add_discord_threads_and_clarification_contexts',
    up: (db) => {
      console.log('[Migration 052] Adding discord thread support and clarification context tracking...');

      // Add thread_id column to discord_messages
      const cols = db.pragma('table_info(discord_messages)') as { name: string }[];
      if (!cols.some(c => c.name === 'discord_thread_id')) {
        db.exec(`ALTER TABLE discord_messages ADD COLUMN discord_thread_id TEXT`);
      }

      // Clarification context tracking for the state machine
      db.exec(`
        CREATE TABLE IF NOT EXISTS discord_clarification_contexts (
          id TEXT PRIMARY KEY,
          discord_channel_id TEXT NOT NULL,
          discord_author_id TEXT NOT NULL,
          original_message_id TEXT NOT NULL,
          original_content TEXT NOT NULL,
          question TEXT NOT NULL,
          classification_data TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'expired')),
          workspace_id TEXT NOT NULL DEFAULT 'default',
          created_at TEXT DEFAULT (datetime('now')),
          resolved_at TEXT,
          FOREIGN KEY (original_message_id) REFERENCES discord_messages(id) ON DELETE CASCADE
        )
      `);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_discord_clarification_channel_author ON discord_clarification_contexts(discord_channel_id, discord_author_id, status)`);

      console.log('[Migration 052] Discord threads and clarification contexts ready');
    }
  },
  {
    id: '053',
    name: 'add_deliverable_blob_storage',
    up: (db) => {
      console.log('[Migration 053] Adding BLOB storage columns to task_deliverables...');

      const cols = db.pragma('table_info(task_deliverables)') as { name: string }[];
      if (!cols.some(c => c.name === 'content')) {
        db.exec('ALTER TABLE task_deliverables ADD COLUMN content BLOB');
      }
      if (!cols.some(c => c.name === 'file_name')) {
        db.exec('ALTER TABLE task_deliverables ADD COLUMN file_name TEXT');
      }
      if (!cols.some(c => c.name === 'file_size')) {
        db.exec('ALTER TABLE task_deliverables ADD COLUMN file_size INTEGER');
      }

      console.log('[Migration 053] task_deliverables BLOB columns ready');
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
