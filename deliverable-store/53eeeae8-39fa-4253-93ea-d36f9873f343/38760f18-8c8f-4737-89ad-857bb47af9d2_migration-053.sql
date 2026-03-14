-- Migration 053: Datalaga concepts - linkings, learnings, memory, code context, acceptance evidence
-- 
-- Incorporates 5 Datalaga concepts as native SQLite tables:
-- 1. entity_linkings    — general-purpose typed entity relations
-- 2. project_learnings  — workspace-scoped knowledge (decisions, observations, patterns)
-- 3. agent_memories     — per-agent operational knowledge
-- 4. task_code_context  — file/commit tracking linked to tasks
-- 5. acceptance_evidence — evidence linked to acceptance criteria
--
-- Corresponds to Styrmann migration ID '053' in migrations.ts

-- ============================================================
-- 1. ENTITY LINKINGS — General-Purpose Entity Relations
-- ============================================================
-- Extends beyond task_dependencies (which handles hard dispatch blocking)
-- to support any entity-to-entity contextual relationship.

CREATE TABLE IF NOT EXISTS entity_linkings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,      -- 'task', 'agent', 'criteria', 'learning', 'memory', 'code_context', 'deliverable'
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  link_type TEXT NOT NULL,        -- 'depends_on', 'motivated', 'justifies', 'resolved_by',
                                  -- 'follow_up_for', 'related_to', 'evidence_for', 'learned_from'
  explanation TEXT,
  metadata TEXT,                  -- JSON: evidence IDs, confidence scores, extra context
  created_by TEXT,                -- agent_id or 'system' or 'human'
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_type, source_id, target_type, target_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_linkings_source ON entity_linkings(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_linkings_target ON entity_linkings(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_linkings_workspace ON entity_linkings(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkings_type ON entity_linkings(link_type);


-- ============================================================
-- 2. PROJECT LEARNINGS — What Worked, What Failed, Why
-- ============================================================
-- Captures decisions, observations, patterns, failures, successes, and caveats
-- scoped to a workspace. Surfaced during dispatch via file-path matching.

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
  detail TEXT,                    -- rationale, alternatives, evidence narrative
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  tags TEXT,                      -- JSON array of string tags
  related_file_paths TEXT,        -- JSON array of file paths (for dispatch surfacing)
  related_task_ids TEXT,          -- JSON array of task IDs
  metadata TEXT,                  -- JSON: extra structured data (alternatives, outcome, etc.)
  is_active INTEGER DEFAULT 1,   -- 0 = archived/superseded
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_learnings_workspace ON project_learnings(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_task ON project_learnings(task_id);
CREATE INDEX IF NOT EXISTS idx_learnings_type ON project_learnings(learning_type);
CREATE INDEX IF NOT EXISTS idx_learnings_active ON project_learnings(workspace_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_agent ON project_learnings(agent_id);


-- ============================================================
-- 3. AGENT MEMORIES — Per-Agent Operational Knowledge
-- ============================================================
-- NOT identity (that stays in SOUL.md). This is operational knowledge
-- learned while working: tool usage, codebase patterns, preferences.

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
  relevance_tags TEXT,            -- JSON array of tags for matching during dispatch
  recall_count INTEGER DEFAULT 0, -- bumped each time surfaced in dispatch
  last_accessed_at TEXT,
  expires_at TEXT,                -- optional TTL for ephemeral knowledge
  metadata TEXT,                  -- JSON: extra context
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_agent_workspace ON agent_memories(agent_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON agent_memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_expires ON agent_memories(expires_at);


-- ============================================================
-- 4. TASK CODE CONTEXT — File Paths, Commits, Change Summaries
-- ============================================================
-- Links tasks to the specific files they touch, with commit info
-- and change details. Enables cross-task impact analysis.

CREATE TABLE IF NOT EXISTS task_code_context (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  commit_sha TEXT,
  change_summary TEXT,
  change_type TEXT CHECK (change_type IN ('created', 'modified', 'deleted', 'referenced')),
  language TEXT,
  symbols TEXT,                   -- JSON array of symbol names touched in this file
  diff_stats TEXT,                -- JSON: {"additions": N, "deletions": N, "hunks": N}
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_code_context_task ON task_code_context(task_id);
CREATE INDEX IF NOT EXISTS idx_code_context_workspace ON task_code_context(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_code_context_file ON task_code_context(file_path, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_code_context_commit ON task_code_context(commit_sha);


-- ============================================================
-- 5. ACCEPTANCE EVIDENCE — Evidence Linked to Criteria
-- ============================================================
-- Links evidence (test results, deliverables, code changes) to
-- acceptance criteria for richer evaluation queries.

CREATE TABLE IF NOT EXISTS acceptance_evidence (
  id TEXT PRIMARY KEY,
  criteria_id TEXT NOT NULL REFERENCES task_acceptance_criteria(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'test_result', 'deliverable', 'code_change', 'activity',
    'manual_verification', 'artifact'
  )),
  evidence_ref_id TEXT,           -- FK to task_deliverables, task_activities, task_code_context, etc.
  evidence_ref_type TEXT,         -- which table the ref points to
  summary TEXT NOT NULL,
  is_positive INTEGER DEFAULT 1,  -- 1 = supports criteria, 0 = contradicts
  verified_by TEXT,               -- agent_id or 'human'
  metadata TEXT,                  -- JSON: extra context (test output, score, etc.)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_criteria ON acceptance_evidence(criteria_id);
CREATE INDEX IF NOT EXISTS idx_evidence_task ON acceptance_evidence(task_id);
CREATE INDEX IF NOT EXISTS idx_evidence_type ON acceptance_evidence(evidence_type);
