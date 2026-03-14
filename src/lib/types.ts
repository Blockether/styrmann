// Core types for Styrmann

export type AgentStatus = 'standby' | 'working' | 'offline';

export type TaskStatus = 'pending_dispatch' | 'planning' | 'inbox' | 'assigned' | 'in_progress' | 'testing' | 'review' | 'verification' | 'done';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export type MessageType = 'text' | 'system' | 'task_update' | 'file';



export type EventType =
  | 'task_created'
  | 'task_assigned'
  | 'task_status_changed'
  | 'task_completed'
  | 'message_sent'
  | 'agent_status_changed'
  | 'agent_joined'
  | 'system';

export type TaskType = 'bug' | 'feature' | 'chore' | 'documentation' | 'research' | 'spike';

export type SprintStatus = 'planning' | 'active' | 'completed' | 'cancelled';

export type MilestoneStatus = 'open' | 'closed';

export type ResourceType = 'link' | 'document' | 'design' | 'api' | 'reference';

export type AgentSource = 'local' | 'gateway' | 'synced';

export interface Agent {
  id: string;
  name: string;
  role: string;
  description?: string;
  status: AgentStatus;
  workspace_id?: string;
  soul_md?: string;
  user_md?: string;
  agents_md?: string;
  memory_md?: string;
  model?: string;
  source: AgentSource;
  gateway_agent_id?: string;
  session_key_prefix?: string;
  agent_dir?: string;
  agent_workspace_path?: string;
  /** Number of active tasks (assigned, in_progress, testing, review, verification) */
  active_task_count?: number;
  /** Title of the current in-progress task, if any */
  current_task_title?: string;
  /** Active tasks assigned to this agent */
  active_tasks?: AgentTask[];
  created_at: string;
  updated_at: string;
}

export interface AgentTask {
  id: string;
  title: string;
  status: string;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  deliverable_count: number;
}

export interface Milestone {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  due_date?: string;
  status: MilestoneStatus;
  coordinator_agent_id?: string;
  sprint_id?: string;
  priority?: TaskPriority;
  story_points?: number;
  created_at: string;
  updated_at: string;
  coordinator?: Agent;
  sprint?: Sprint;
  dependencies?: MilestoneDependency[];
}

export interface MilestoneDependency {
  id: string;
  milestone_id: string;
  depends_on_milestone_id?: string;
  depends_on_task_id?: string;
  dependency_type: 'finish_to_start' | 'blocks';
  created_at: string;
  depends_on_milestone?: Milestone;
  depends_on_task?: Task;
}

export interface Sprint {
  id: string;
  workspace_id: string;
  name: string;
  goal?: string;
  sprint_number?: number;
  start_date: string;
  end_date: string;
  status: SprintStatus;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface TaskBlocker {
  id: string;
  task_id: string;
  blocked_by_task_id?: string;
  description?: string;
  resolved: boolean;
  created_at: string;
  blocked_by_task?: Task;
}

export interface TaskResource {
  id: string;
  task_id: string;
  title: string;
  url: string;
  resource_type: ResourceType;
  created_at: string;
}

export interface TaskAcceptanceCriteria {
  id: string;
  task_id: string;
  description: string;
  is_met: boolean;
  sort_order: number;
  parent_criteria_id?: string | null;
  required_for_status?: TaskStatus | null;
  gate_type?: 'manual' | 'artifact' | 'test' | 'deploy' | 'verifier';
  artifact_key?: string | null;
  created_at: string;
}

export interface GitHubIssue {
  id: string;
  workspace_id: string;
  github_id: number;
  issue_number: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  state_reason?: string | null;
  labels: string;
  assignees: string;
  github_url: string;
  author?: string | null;
  created_at_github?: string | null;
  updated_at_github?: string | null;
  synced_at: string;
  task_id?: string | null;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  task_type: TaskType;
  effort?: number;
  impact?: number;
  assignee_type?: 'ai' | 'human';
  assigned_agent_id: string | null;
  assigned_human_id?: string | null;
  created_by_agent_id: string | null;
   workspace_id: string;
   milestone_id?: string;
   github_issue_id?: string | null;
   due_date?: string;
   workflow_template_id?: string;
   status_reason?: string;
   workflow_plan_id?: string | null;
  created_at: string;
  updated_at: string;
  assigned_agent?: Agent;
  assigned_human?: Human;
  assignee_display_name?: string | null;
  created_by_agent?: Agent;
  milestone?: Milestone;
  tags?: Tag[];
  comments?: TaskComment[];
  blockers?: TaskBlocker[];
  resources?: TaskResource[];
  acceptance_criteria?: TaskAcceptanceCriteria[];
  is_blocked?: boolean;
  blocked_reason?: string | null;
}





export interface Event {
  id: string;
  type: EventType;
  agent_id?: string;
  task_id?: string;
  message: string;
  metadata?: string;
  created_at: string;
  // Joined fields
  agent?: Agent;
  task?: Task;
}

export interface Business {
  id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon: string;
  github_repo?: string;
  is_internal?: number;
  repo_kind?: 'standard' | 'meta';
  local_path?: string;
  owner_email?: string;
  coordinator_email?: string;
  logo_url?: string;
  organization?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceStats {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon: string;
  github_repo?: string;
  is_internal?: number;
  repo_kind?: 'standard' | 'meta';
  local_path?: string;
  owner_email?: string;
  coordinator_email?: string;
  logo_url?: string;
  organization?: string;
  taskCounts: {
    pending_dispatch: number;
    planning: number;
    inbox: number;
    assigned: number;
    in_progress: number;
    testing: number;
    review: number;
    verification: number;
    done: number;
    total: number;
  };
}

// Workflow template types
export interface WorkflowStage {
  id: string;
  label: string;
  role: string | null;
  status: TaskStatus;
  required_artifacts?: string[];
  required_fields?: string[];
}

export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  required_status: TaskStatus;
  created_at: string;
  depends_on_task_title?: string | null;
  depends_on_task_status?: string | null;
  depends_on_task?: Task;
}

export interface TaskArtifact {
  id: string;
  task_id: string;
  stage_status?: TaskStatus | null;
  artifact_key: string;
  artifact_value: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowPlanStep {
  id: string;
  label: string;
  role: string | null;
  status: TaskStatus;
  kind: 'execution' | 'verification' | 'queue';
  sequence: number;
  agent_id?: string | null;
  agent_name?: string | null;
  agent_role?: string | null;
  skills: string[];
  prompt: string;
  loop_target_status?: string | null;
}

export interface WorkflowPlanParticipant {
  agent_id: string;
  agent_name: string;
  agent_role: string;
  skills: string[];
  planner?: boolean;
}

export interface TaskWorkflowPlan {
  id: string;
  task_id: string;
  workspace_id: string;
  orchestrator_agent_id?: string | null;
  workflow_template_id?: string | null;
  workflow_name: string;
  summary: string;
  participants: WorkflowPlanParticipant[];
  steps: WorkflowPlanStep[];
  created_at: string;
  updated_at: string;
}

export interface TaskFinding {
  id: string;
  task_id: string;
  workspace_id: string;
  finding_type: 'missing_agent' | 'missing_skill' | 'planning_note';
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
  metadata?: string;
  created_at: string;
}

export interface CapabilityProposal {
  id: string;
  task_id: string;
  workspace_id: string;
  learner_agent_id?: string | null;
  proposal_type: 'agent' | 'skill';
  title: string;
  detail: string;
  target_name: string;
  meta_workspace_id?: string | null;
  meta_workspace_slug?: string | null;
  status: 'open' | 'accepted' | 'rejected';
  created_at: string;
}

export interface WorkflowTemplate {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  stages: WorkflowStage[];
  fail_targets: Record<string, string>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskRole {
  id: string;
  task_id: string;
  role: string;
  agent_id: string;
  created_at: string;
  // Joined fields
  agent?: Agent;
}

export interface AgentSession {
  id: string;
  agent_id: string;
  session_id: string;
  channel?: string;
  status: string;
  session_type: 'persistent' | 'subagent';
  task_id?: string;
  ended_at?: string;
  last_dispatched_at?: string;
  dispatch_pid?: number;
  created_at: string;
  updated_at: string;
}

export type ActivityType = 'spawned' | 'updated' | 'completed' | 'file_created' | 'status_changed' | 'dispatch_invocation' | 'test_passed' | 'test_failed' | 'activity_summary';

export interface PresentedTaskActivity {
  id: string;
  task_id: string;
  activity_type: ActivityType | string;
  summary_role: 'presenter' | 'system';
  summary_kind: 'live' | 'post_step' | 'raw';
  message: string;
  created_at: string;
  workflow_step: string | null;
  decision_event: boolean;
  technical_details: Record<string, unknown> | null;
  agent_id?: string;
  agent?: Agent;
  raw_activities: TaskActivity[];
}

export interface TaskActivity {
  id: string;
  task_id: string;
  agent_id?: string;
  activity_type: ActivityType;
  message: string;
  metadata?: string;
  created_at: string;
  workflow_step?: string | null;
  decision_event?: boolean;
  summary_role?: 'presenter' | 'system';
  summary_kind?: 'live' | 'post_step' | 'raw';
  technical_details?: Record<string, unknown> | null;
  // Joined fields
  agent?: Agent;
}

export type DeliverableType = 'file' | 'url' | 'artifact';

export interface TaskDeliverable {
  id: string;
  task_id: string;
  deliverable_type: DeliverableType;
  title: string;
  path?: string;
  description?: string;
  session_id?: string;
  source?: 'agent' | 'system';
  created_via_agent_id?: string | null;
  created_via_agent_name?: string | null;
  created_via_workflow_step?: string | null;
  created_via_session_id?: string | null;
  created_at: string;
}


// API request/response types
export interface CreateAgentRequest {
  name: string;
  role: string;
  description?: string;
  soul_md?: string;
  user_md?: string;
  agents_md?: string;
  memory_md?: string;
  model?: string;
}

export interface UpdateAgentRequest extends Partial<CreateAgentRequest> {
  status?: AgentStatus;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  priority?: TaskPriority;
  task_type?: TaskType;
  effort?: number;
  impact?: number;
  assignee_type?: 'ai' | 'human';
  assigned_human_id?: string;
   created_by_agent_id?: string;
   workspace_id?: string;
   milestone_id?: string;
   due_date?: string;
  tags?: string[];
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  status?: TaskStatus;
}

export interface Human {
  id: string;
  name: string;
  email: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}



export interface AgentMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface AgentSessionInfo {
  id: string;
  channel: string;
  peer?: string;
  model?: string;
  status: string;
}

export interface AgentHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export type AgentLogRole = 'user' | 'assistant' | 'system';

export interface AgentLog {
  id: string;
  agent_id: string | null;
  session_id: string;
  role: AgentLogRole;
  content: string;
  content_hash: string;
  workspace_id: string;
  created_at: string;
  // Joined fields
  agent_name?: string;
  agent_role?: string;
}

export interface AgentWithSession extends Agent {
  agentSession?: AgentSession | null;
}

// Real-time SSE event types
export type SSEEventType =
  | 'task_updated'
  | 'agent_updated'
  | 'task_created'
  | 'task_deleted'
  | 'activity_logged'
  | 'activity_presented'
  | 'deliverable_added'
  | 'deliverable_deleted'
  | 'agent_spawned'
  | 'agent_completed'
  | 'github_issues_synced'
  | 'agent_log_added'
  | 'daemon_stats_updated'
  | 'organization_created'
  | 'organization_updated'
  | 'organization_deleted'
  | 'org_ticket_created'
  | 'org_ticket_updated'
  | 'org_ticket_deleted';

export interface SSEEvent {
  type: SSEEventType;
  payload: Task | Agent | TaskActivity | PresentedTaskActivity | TaskDeliverable | Organization | OrgTicket | {
    taskId: string;
    sessionId: string;
    agentName?: string;
    summary?: string;
    deleted?: boolean;
  } | {
    id: string;  // For task_deleted / organization_deleted events
  } | {
    workspace_id: string;  // For github_issues_synced events
  };
}


// ── System & Daemon types ────────────────────────────────────────────

export interface ValidationCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: string;
  /** Whether this check failure can be auto-repaired by dispatching to an agent */
  repairable?: boolean;
  /** Prompt to send to the repair agent describing what to fix */
  repair_prompt?: string;
  category?: 'system' | 'agent';
}

export interface ValidationResult {
  passed: boolean;
  checks: ValidationCheck[];
  errors: number;
  warnings: number;
  ran_at: string;
}

export interface SystemInfo {
  node_version: string;
  platform: string;
  arch: string;
  hostname: string;
  uptime_seconds: number;
  memory: {
    rss_mb: number;
    heap_total_mb: number;
    heap_used_mb: number;
    external_mb: number;
  };
  system_memory: {
    total_mb: number;
    free_mb: number;
    used_percent: number;
  };
  services: {
    web: 'active' | 'inactive' | 'unknown';
    daemon: 'active' | 'inactive' | 'unknown';
  };
}

export interface DaemonJobInfo {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  last_run?: string;
}

export interface DaemonModuleInfo {
  name: string;
  interval_ms: number;
  last_tick?: string;
}

export interface DaemonStatsSnapshot {
  // Timing
  started_at: string;
  reported_at: string;
  uptime_seconds: number;
  // Module ticks
  last_heartbeat_tick?: string;
  last_dispatch_tick?: string;
  last_scheduler_tick?: string;
  last_log_poll_tick?: string;
  last_recovery_tick?: string;
  // Counters
  dispatched_count: number;
  heartbeat_count: number;
  stale_recovered_count: number;
  scheduled_run_count: number;
  scheduled_failure_count: number;
  routed_event_count: number;
  log_entries_stored: number;
  log_entries_cleaned: number;
  stalled_redispatched_count?: number;
  stalled_reassigned_count?: number;
  // Process
  memory_mb: number;
  pid: number;
  // Modules & jobs
  modules: DaemonModuleInfo[];
  jobs: DaemonJobInfo[];
  // Discord
  discord_connected?: boolean;
  discord_messages_processed?: number;
  discord_tasks_created?: number;
  discord_completions_sent?: number;
  discord_voice_responses?: number;
}

// ── ACP Provenance types ──────────────────────────────────────────────

export type ProvenanceKind = 'external_user' | 'inter_session' | 'internal_system';

export type ProvenanceMode = 'off' | 'meta' | 'meta+receipt';

export interface InputProvenance {
  kind: ProvenanceKind;
  originSessionId?: string;
  sourceSessionKey?: string;
  sourceChannel?: string;
  sourceTool?: string;
}

export interface SourceReceipt {
  bridge?: string;
  originHost?: string;
  originCwd?: string;
  acpSessionId?: string;
  originSessionId?: string;
  targetSession?: string;
  [key: string]: string | undefined;
}

export interface ProvenanceRecord {
  id: string;
  task_id: string;
  session_id?: string;
  kind: ProvenanceKind;
  origin_session_id?: string;
  source_session_key?: string;
  source_channel?: string;
  source_tool?: string;
  receipt_text?: string;
  receipt_data?: SourceReceipt;
  message_role?: string;
  message_index?: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Discord Integration
// ---------------------------------------------------------------------------

export type DiscordClassificationType = 'task' | 'conversation' | 'clarification';

export interface DiscordClassification {
  type: DiscordClassificationType;
  confidence: number;
  reasoning: string;
  /** Extracted task title when type=task */
  title?: string;
  /** Extracted task description when type=task */
  description?: string;
  /** Inferred task type when type=task */
  task_type?: 'bug' | 'feature' | 'chore' | 'documentation' | 'research' | 'spike';
  /** Inferred priority when type=task */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  /** Clarification question to ask when type=clarification */
  question?: string;
}

export interface DiscordMessage {
  id: string;
  discord_message_id: string;
  discord_channel_id: string;
  discord_guild_id: string;
  discord_author_id: string;
  discord_author_name: string;
  content: string;
  classification: DiscordClassificationType;
  task_id?: string | null;
  workspace_id: string;
  response_sent: number;
  completion_notified: number;
  discord_thread_id?: string | null;
  metadata?: string | null;
  created_at: string;
  /** Joined from tasks table */
  task_title?: string | null;
  task_status?: string | null;
}

export type ClarificationStatus = 'pending' | 'resolved' | 'expired';

export interface ClarificationContext {
  id: string;
  discord_channel_id: string;
  discord_author_id: string;
  original_message_id: string;
  original_content: string;
  question: string;
  classification_data?: string | null;
  status: ClarificationStatus;
  workspace_id: string;
  created_at: string;
  resolved_at?: string | null;
}

// ── Wave 2 Entities ──────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  logo_url?: string | null;
  created_at: string;
  updated_at: string;
}

export type OrgTicketStatus = 'open' | 'triaged' | 'delegated' | 'in_progress' | 'resolved' | 'closed';
export type OrgTicketType = 'feature' | 'bug' | 'improvement' | 'task' | 'epic';

export interface OrgTicket {
  id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  status: OrgTicketStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  ticket_type: OrgTicketType;
  external_ref?: string | null;
  external_system?: string | null;
  creator_name?: string | null;
  assignee_name?: string | null;
  due_date?: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

export type MemoryType = 'fact' | 'decision' | 'event' | 'tool_run' | 'error' | 'observation' | 'note' | 'patch';

export interface Memory {
  id: string;
  organization_id?: string | null;
  workspace_id?: string | null;
  memory_type: MemoryType;
  title: string;
  summary?: string | null;
  body?: string | null;
  source?: string | null;
  source_ref?: string | null;
  confidence?: number | null;
  status: 'open' | 'resolved' | 'closed';
  metadata: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export type LinkType = 'delegates_to' | 'blocks' | 'relates_to' | 'derived_from' | 'references' | 'parent_of' | 'motivated_by' | 'resolved_by' | 'contains' | 'touches';

export interface EntityLink {
  id: string;
  from_entity_type: string;
  from_entity_id: string;
  to_entity_type: string;
  to_entity_id: string;
  link_type: LinkType;
  explanation?: string | null;
  created_at: string;
}

export type KnowledgeArticleStatus = 'draft' | 'published' | 'stale' | 'archived';

export interface KnowledgeArticle {
  id: string;
  organization_id?: string | null;
  workspace_id?: string | null;
  title: string;
  summary: string;
  body: string;
  synthesis_model?: string | null;
  synthesis_prompt_hash?: string | null;
  source_memory_ids: string;
  status: KnowledgeArticleStatus;
  version: number;
  supersedes_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Commit {
  id: string;
  workspace_id: string;
  commit_hash: string;
  message: string;
  author_name?: string | null;
  author_email?: string | null;
  branch?: string | null;
  files_changed: string;
  insertions: number;
  deletions: number;
  committed_at: string;
  ingested_at: string;
  metadata: string;
}
