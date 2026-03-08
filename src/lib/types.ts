// Core types for Mission Control

export type AgentStatus = 'standby' | 'working' | 'offline';

export type TaskStatus = 'pending_dispatch' | 'planning' | 'inbox' | 'assigned' | 'in_progress' | 'testing' | 'review' | 'verification' | 'done';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export type MessageType = 'text' | 'system' | 'task_update' | 'file';

export type ConversationType = 'direct' | 'group' | 'task';

export type EventType =
  | 'task_created'
  | 'task_assigned'
  | 'task_status_changed'
  | 'task_completed'
  | 'message_sent'
  | 'agent_status_changed'
  | 'agent_joined'
  | 'system';

export type TaskType = 'bug' | 'feature' | 'chore' | 'documentation' | 'research';

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
  workspace_id: string;
  soul_md?: string;
  user_md?: string;
  agents_md?: string;
  model?: string;
  source: AgentSource;
  gateway_agent_id?: string;
  session_key_prefix?: string;
  /** Absolute path to the OpenClaw agent config directory (contains system.md) */
  agent_dir?: string;
  /** Absolute path to the OpenClaw agent workspace directory (contains SOUL.md, USER.md, AGENTS.md) */
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
  assigned_agent_id: string | null;
  created_by_agent_id: string | null;
  workspace_id: string;
  milestone_id?: string;
  github_issue_id?: string | null;
  business_id: string;
  due_date?: string;
  workflow_template_id?: string;
  status_reason?: string;
  planning_complete?: number;
  planning_dispatch_error?: string;
  planning_session_key?: string;
  created_at: string;
  updated_at: string;
  assigned_agent?: Agent;
  created_by_agent?: Agent;
  milestone?: Milestone;
  tags?: Tag[];
  comments?: TaskComment[];
  blockers?: TaskBlocker[];
  resources?: TaskResource[];
  acceptance_criteria?: TaskAcceptanceCriteria[];
}

export interface Conversation {
  id: string;
  title?: string;
  type: ConversationType;
  task_id?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  participants?: Agent[];
  last_message?: Message;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_agent_id?: string;
  content: string;
  message_type: MessageType;
  metadata?: string;
  created_at: string;
  // Joined fields
  sender?: Agent;
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

export interface KnowledgeEntry {
  id: string;
  workspace_id: string;
  task_id?: string;
  category: string;
  title: string;
  content: string;
  tags?: string[];
  confidence: number;
  created_by_agent_id?: string;
  created_at: string;
}

export interface OpenClawSession {
  id: string;
  agent_id: string;
  openclaw_session_id: string;
  channel?: string;
  status: string;
  session_type: 'persistent' | 'subagent';
  task_id?: string;
  ended_at?: string;
  created_at: string;
  updated_at: string;
}

export type ActivityType = 'spawned' | 'updated' | 'completed' | 'file_created' | 'status_changed' | 'dispatch_invocation';

export interface TaskActivity {
  id: string;
  task_id: string;
  agent_id?: string;
  activity_type: ActivityType;
  message: string;
  metadata?: string;
  created_at: string;
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
  created_at: string;
}

// Planning types
export type PlanningQuestionType = 'multiple_choice' | 'text' | 'yes_no';

export type PlanningCategory = 
  | 'goal'
  | 'audience'
  | 'scope'
  | 'design'
  | 'content'
  | 'technical'
  | 'timeline'
  | 'constraints';

export interface PlanningQuestionOption {
  id: string;
  label: string;
}

export interface PlanningQuestion {
  id: string;
  task_id: string;
  category: PlanningCategory;
  question: string;
  question_type: PlanningQuestionType;
  options?: PlanningQuestionOption[];
  answer?: string;
  answered_at?: string;
  sort_order: number;
  created_at: string;
}

export interface PlanningSpec {
  id: string;
  task_id: string;
  spec_markdown: string;
  locked_at: string;
  locked_by?: string;
  created_at: string;
}

export interface PlanningState {
  questions: PlanningQuestion[];
  spec?: PlanningSpec;
  progress: {
    total: number;
    answered: number;
    percentage: number;
  };
  isLocked: boolean;
}

// API request/response types
export interface CreateAgentRequest {
  name: string;
  role: string;
  description?: string;
  soul_md?: string;
  user_md?: string;
  agents_md?: string;
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
  assigned_agent_id?: string;
  created_by_agent_id?: string;
  workspace_id?: string;
  milestone_id?: string;
  business_id?: string;
  due_date?: string;
  tags?: string[];
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  status?: TaskStatus;
}

export interface SendMessageRequest {
  conversation_id: string;
  sender_agent_id: string;
  content: string;
  message_type?: MessageType;
  metadata?: string;
}

// OpenClaw WebSocket message types
export interface OpenClawMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface OpenClawSessionInfo {
  id: string;
  channel: string;
  peer?: string;
  model?: string;
  status: string;
}

// OpenClaw history message format (from Gateway)
export interface OpenClawHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export type AgentLogRole = 'user' | 'assistant' | 'system';

export interface AgentLog {
  id: string;
  agent_id: string | null;
  openclaw_session_id: string;
  role: AgentLogRole;
  content: string;
  content_hash: string;
  workspace_id: string;
  created_at: string;
  // Joined fields
  agent_name?: string;
  agent_role?: string;
}

// Agent with OpenClaw session info (extended for UI use)
export interface AgentWithOpenClaw extends Agent {
  openclawSession?: OpenClawSession | null;
}

// Real-time SSE event types
export type SSEEventType =
  | 'task_updated'
  | 'agent_updated'
  | 'task_created'
  | 'task_deleted'
  | 'activity_logged'
  | 'deliverable_added'
  | 'agent_spawned'
  | 'agent_completed'
  | 'github_issues_synced'
  | 'agent_log_added'
  | 'daemon_stats_updated';

export interface SSEEvent {
  type: SSEEventType;
  payload: Task | Agent | TaskActivity | TaskDeliverable | {
    taskId: string;
    sessionId: string;
    agentName?: string;
    summary?: string;
    deleted?: boolean;
  } | {
    id: string;  // For task_deleted events
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
  /** Category grouping for display (e.g. 'system', 'openclaw') */
  category?: 'system' | 'openclaw';
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
}
