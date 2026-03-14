/**
 * Migration 053: Datalaga concepts — linkings, learnings, memory, code context, acceptance evidence
 *
 * Incorporates 5 Datalaga concepts as native SQLite tables:
 * 1. entity_linkings    — general-purpose typed entity relations
 * 2. project_learnings  — workspace-scoped knowledge (decisions, observations, patterns)
 * 3. agent_memories     — per-agent operational knowledge
 * 4. task_code_context  — file/commit tracking linked to tasks
 * 5. acceptance_evidence — evidence linked to acceptance criteria
 *
 * INTEGRATION: Append this entry to the `migrations` array in src/lib/db/migrations.ts
 * after migration '052' (add_discord_threads_and_clarification_contexts).
 *
 * Also update src/lib/db/schema.ts to include these tables and indexes
 * so fresh databases get them from the schema string.
 */

// --- Copy this object into the migrations array in src/lib/db/migrations.ts ---

/*
  {
    id: '053',
    name: 'datalaga_concepts_linkings_learnings_memory_code_context_evidence',
    up: (db) => {
      console.log('[Migration 053] Adding Datalaga concept tables...');

      // 1. Entity Linkings — General-Purpose Entity Relations
      db.exec(`
        CREATE TABLE IF NOT EXISTS entity_linkings (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          link_type TEXT NOT NULL,
          explanation TEXT,
          metadata TEXT,
          created_by TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(source_type, source_id, target_type, target_id, link_type)
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_linkings_source ON entity_linkings(source_type, source_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_linkings_target ON entity_linkings(target_type, target_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_linkings_workspace ON entity_linkings(workspace_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_linkings_type ON entity_linkings(link_type)');

      // 2. Project Learnings — What Worked, What Failed, Why
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_learnings (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          session_id TEXT,
          learning_type TEXT NOT NULL CHECK (learning_type IN (
            'decision', 'observation', 'pattern', 'failure', 'success', 'caveat'
          )),
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          detail TEXT,
          confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
          tags TEXT,
          related_file_paths TEXT,
          related_task_ids TEXT,
          metadata TEXT,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_learnings_workspace ON project_learnings(workspace_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_learnings_task ON project_learnings(task_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_learnings_type ON project_learnings(learning_type)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_learnings_active ON project_learnings(workspace_id, is_active, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_learnings_agent ON project_learnings(agent_id)');

      // 3. Agent Memories — Per-Agent Operational Knowledge
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_memories (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          memory_type TEXT NOT NULL CHECK (memory_type IN (
            'skill', 'preference', 'pattern', 'context', 'tool_usage', 'codebase_knowledge'
          )),
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          relevance_tags TEXT,
          recall_count INTEGER DEFAULT 0,
          last_accessed_at TEXT,
          expires_at TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_memories_agent_workspace ON agent_memories(agent_id, workspace_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_memories_type ON agent_memories(memory_type)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_memories_expires ON agent_memories(expires_at)');

      // 4. Task Code Context — File Paths, Commits, Change Summaries
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_code_context (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          file_path TEXT NOT NULL,
          commit_sha TEXT,
          change_summary TEXT,
          change_type TEXT CHECK (change_type IN ('created', 'modified', 'deleted', 'referenced')),
          language TEXT,
          symbols TEXT,
          diff_stats TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_code_context_task ON task_code_context(task_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_code_context_workspace ON task_code_context(workspace_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_code_context_file ON task_code_context(file_path, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_code_context_commit ON task_code_context(commit_sha)');

      // 5. Acceptance Evidence — Evidence Linked to Criteria
      db.exec(`
        CREATE TABLE IF NOT EXISTS acceptance_evidence (
          id TEXT PRIMARY KEY,
          criteria_id TEXT NOT NULL REFERENCES task_acceptance_criteria(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          evidence_type TEXT NOT NULL CHECK (evidence_type IN (
            'test_result', 'deliverable', 'code_change', 'activity',
            'manual_verification', 'artifact'
          )),
          evidence_ref_id TEXT,
          evidence_ref_type TEXT,
          summary TEXT NOT NULL,
          is_positive INTEGER DEFAULT 1,
          verified_by TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_evidence_criteria ON acceptance_evidence(criteria_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_evidence_task ON acceptance_evidence(task_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_evidence_type ON acceptance_evidence(evidence_type)');

      console.log('[Migration 053] Datalaga concept tables created');
    }
  },
*/

// --- Also add these table definitions to the `schema` string in src/lib/db/schema.ts ---
// See migration-053.sql for the complete CREATE TABLE + CREATE INDEX statements.
// Copy them into the template literal in schema.ts so fresh databases include them.
