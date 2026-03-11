/**
 * Database Schema for Mission Control
 * 
 * This defines the current desired schema state.
 * For existing databases, migrations handle schema updates.
 * 
 * IMPORTANT: When adding new tables or columns:
 * 1. Add them here for new databases
 * 2. Create a migration in migrations.ts for existing databases
 */

export const schema = `
-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT DEFAULT 'folder',
  github_repo TEXT,
  is_internal INTEGER DEFAULT 0,
  repo_kind TEXT DEFAULT 'standard' CHECK (repo_kind IN ('standard', 'meta')),
  local_path TEXT,
  owner_email TEXT,
  coordinator_email TEXT,
  himalaya_account TEXT,
  logo_url TEXT,
  organization TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'standby' CHECK (status IN ('standby', 'working', 'offline')),
  workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
  soul_md TEXT,
  user_md TEXT,
  agents_md TEXT,
  memory_md TEXT,
  model TEXT,
  source TEXT DEFAULT 'local',
  gateway_agent_id TEXT,
  session_key_prefix TEXT,
  agent_dir TEXT,
  agent_workspace_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Milestones table
CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  coordinator_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- GitHub issues table (workspace-scoped cache)
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
);

-- Milestone dependencies table
CREATE TABLE IF NOT EXISTS milestone_dependencies (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  depends_on_milestone_id TEXT REFERENCES milestones(id) ON DELETE CASCADE,
  depends_on_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL DEFAULT 'finish_to_start' CHECK (dependency_type IN ('finish_to_start','blocks')),
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (depends_on_milestone_id IS NOT NULL OR depends_on_task_id IS NOT NULL)
);

-- Sprints table
CREATE TABLE IF NOT EXISTS sprints (
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
);

-- Tasks table (Mission Queue)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'inbox' CHECK (status IN ('pending_dispatch', 'planning', 'inbox', 'assigned', 'in_progress', 'testing', 'review', 'verification', 'done')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  task_type TEXT DEFAULT 'feature' CHECK (task_type IN ('bug', 'feature', 'chore', 'documentation', 'research')),
  effort INTEGER CHECK (effort IS NULL OR (effort >= 1 AND effort <= 5)),
  impact INTEGER CHECK (impact IS NULL OR (impact >= 1 AND impact <= 5)),
  assignee_type TEXT DEFAULT 'ai' CHECK (assignee_type IN ('ai', 'human')),
  assigned_agent_id TEXT REFERENCES agents(id),
  assigned_human_id TEXT REFERENCES humans(id),
  created_by_agent_id TEXT REFERENCES agents(id),
  workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  github_issue_id TEXT REFERENCES github_issues(id) ON DELETE SET NULL,
  business_id TEXT DEFAULT 'default',
  due_date TEXT,
  workflow_template_id TEXT REFERENCES workflow_templates(id),
  workflow_plan_id TEXT,
  planning_session_key TEXT,
  planning_messages TEXT,
  planning_complete INTEGER DEFAULT 0,
  planning_spec TEXT,
  planning_agents TEXT,
  planning_dispatch_error TEXT,
  status_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS humans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6b7280',
  UNIQUE(workspace_id, name)
);

-- Task-Tag junction table
CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

-- Task comments
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

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
);

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
);

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
);

-- Task blockers
CREATE TABLE IF NOT EXISTS task_blockers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocked_by_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  description TEXT,
  resolved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Task resources
CREATE TABLE IF NOT EXISTS task_resources (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  resource_type TEXT DEFAULT 'link' CHECK (resource_type IN ('link', 'document', 'design', 'api', 'reference')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Task acceptance criteria
CREATE TABLE IF NOT EXISTS task_acceptance_criteria (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  is_met INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Planning questions table
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

-- Planning specs table (locked specifications)
CREATE TABLE IF NOT EXISTS planning_specs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  spec_markdown TEXT NOT NULL,
  locked_at TEXT NOT NULL,
  locked_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Conversations table (agent-to-agent or task-related)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  type TEXT DEFAULT 'direct' CHECK (type IN ('direct', 'group', 'task')),
  task_id TEXT REFERENCES tasks(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Conversation participants
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, agent_id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  sender_agent_id TEXT REFERENCES agents(id),
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'system', 'task_update', 'file')),
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Events table (for live feed)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id),
  task_id TEXT REFERENCES tasks(id),
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Businesses/Workspaces table (legacy - kept for compatibility)
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- OpenClaw session mapping
CREATE TABLE IF NOT EXISTS openclaw_sessions (
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
);

-- ACP Discord thread bindings
CREATE TABLE IF NOT EXISTS acp_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  discord_thread_id TEXT NOT NULL,
  discord_channel_id TEXT,
  discord_guild_id TEXT DEFAULT '1406182923563958352',
  acp_session_key TEXT NOT NULL,
  acp_agent_id TEXT,
  agent_id TEXT REFERENCES agents(id),
  task_id TEXT REFERENCES tasks(id),
  status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','closed')),
  cwd TEXT DEFAULT '/root/.openclaw/workspace',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Workflow templates (per-workspace workflow definitions)
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
);

-- Task role assignments (role -> agent mapping per task)
CREATE TABLE IF NOT EXISTS task_roles (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(task_id, role)
);

-- Knowledge entries (learner knowledge base)
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
  task_id TEXT REFERENCES tasks(id),
  agent_id TEXT REFERENCES agents(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  confidence REAL DEFAULT 0.5,
  created_by_agent_id TEXT REFERENCES agents(id),
  created_at TEXT DEFAULT (datetime('now'))
);

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
);

CREATE TABLE IF NOT EXISTS knowledge_routing_decisions (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  score REAL NOT NULL,
  selected INTEGER DEFAULT 0,
  reasons TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_vectors (
  knowledge_id TEXT PRIMARY KEY REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  model TEXT NOT NULL DEFAULT 'hash96-v1',
  dimension INTEGER NOT NULL DEFAULT 96,
  vector_json TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

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
);

-- Task activities table (for real-time activity log)
CREATE TABLE IF NOT EXISTS task_activities (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id),
  activity_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Task deliverables table (files, URLs, artifacts)
CREATE TABLE IF NOT EXISTS task_deliverables (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  deliverable_type TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT,
  description TEXT,
  openclaw_session_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

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
);

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
);

-- Task provenance (ACP input provenance and source receipts)
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
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_human ON tasks(assigned_human_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_activities_task ON task_activities(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliverables_task ON task_deliverables(task_id);
CREATE INDEX IF NOT EXISTS idx_task_run_results_task ON task_run_results(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_run_result_artifacts_run ON task_run_result_artifacts(task_run_result_id);
CREATE INDEX IF NOT EXISTS idx_task_run_result_artifacts_task ON task_run_result_artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_task_run_result_artifacts_path ON task_run_result_artifacts(normalized_path, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openclaw_sessions_task ON openclaw_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_planning_questions_task ON planning_questions(task_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_workspace ON workflow_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_roles_task ON task_roles(task_id);
CREATE INDEX IF NOT EXISTS idx_task_workflow_plans_task ON task_workflow_plans(task_id);
CREATE INDEX IF NOT EXISTS idx_task_findings_task ON task_findings(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capability_proposals_task ON capability_proposals(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_workspace ON knowledge_entries(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_task ON knowledge_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_agent ON knowledge_entries(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_attachments_knowledge ON knowledge_attachments(knowledge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_attachments_workspace ON knowledge_attachments(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_routing_decisions_knowledge ON knowledge_routing_decisions(knowledge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_routing_decisions_agent ON knowledge_routing_decisions(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_milestones_sprint ON milestones(sprint_id);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id);
CREATE INDEX IF NOT EXISTS idx_milestone_deps_milestone ON milestone_dependencies(milestone_id);
CREATE INDEX IF NOT EXISTS idx_milestone_deps_depends ON milestone_dependencies(depends_on_milestone_id);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_sprints_workspace ON sprints(workspace_id);
CREATE INDEX IF NOT EXISTS idx_milestones_workspace ON milestones(workspace_id);
CREATE INDEX IF NOT EXISTS idx_github_issues_workspace ON github_issues(workspace_id);
CREATE INDEX IF NOT EXISTS idx_github_issues_state ON github_issues(workspace_id, state);
CREATE INDEX IF NOT EXISTS idx_tags_workspace ON tags(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_blockers_task ON task_blockers(task_id);
CREATE INDEX IF NOT EXISTS idx_task_resources_task ON task_resources(task_id);
CREATE INDEX IF NOT EXISTS idx_task_acceptance_criteria_task ON task_acceptance_criteria(task_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_acp_bindings_workspace ON acp_bindings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_acp_bindings_status ON acp_bindings(status);
CREATE INDEX IF NOT EXISTS idx_acp_bindings_thread ON acp_bindings(discord_thread_id);
CREATE INDEX IF NOT EXISTS idx_task_provenance_task ON task_provenance(task_id);
CREATE INDEX IF NOT EXISTS idx_task_provenance_session ON task_provenance(session_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_workspace ON knowledge_vectors(workspace_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_agent ON knowledge_vectors(agent_id);
-- Daemon tables
CREATE TABLE IF NOT EXISTS agent_heartbeats (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  result TEXT,
  error TEXT,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_agent ON agent_heartbeats(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_created ON agent_heartbeats(created_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_job ON scheduled_job_runs(job_id);
-- Agent logs (OpenClaw session transcripts)
CREATE TABLE IF NOT EXISTS agent_logs (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  openclaw_session_id TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_session ON agent_logs(openclaw_session_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_role ON agent_logs(role);
CREATE INDEX IF NOT EXISTS idx_agent_logs_workspace ON agent_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_task ON agent_logs(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_logs_content_hash ON agent_logs(content_hash);
`;
