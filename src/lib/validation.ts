import { z } from 'zod';

// Task status and priority enums from types
const TaskStatus = z.enum([
  'pending_dispatch',
  'planning',
  'inbox',
  'assigned',
  'in_progress',
  'testing',
  'review',
  'verification',
  'done'
]);

const TaskPriority = z.enum(['low', 'normal', 'high', 'urgent']);

const TaskType = z.enum(['bug', 'feature', 'chore', 'documentation', 'research', 'spike']);

const ActivityType = z.enum([
  'spawned',
  'updated',
  'completed',
  'file_created',
  'status_changed',
  'dispatch_invocation',
  'test_passed',
  'test_failed',
  'activity_summary'
]);

const DeliverableType = z.enum(['file', 'url', 'artifact']);
const CriteriaGateType = z.enum(['manual', 'artifact', 'test', 'deploy', 'verifier']);

// Task validation schemas
export const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title must be 500 characters or less'),
  description: z.string().max(10000, 'Description must be 10000 characters or less').optional(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  task_type: TaskType.optional(),
  effort: z.number().int().min(1).max(5).optional().nullable(),
  impact: z.number().int().min(1).max(5).optional().nullable(),
   assignee_type: z.enum(['ai', 'human']).optional(),
   assigned_human_id: z.string().uuid().optional().nullable(),
   created_by_agent_id: z.string().uuid().optional().nullable(),
   workspace_id: z.string().optional(),
  milestone_id: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  github_issue_id: z.string().uuid().optional().nullable(),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  task_type: TaskType.optional(),
  effort: z.number().int().min(1).max(5).optional().nullable(),
  impact: z.number().int().min(1).max(5).optional().nullable(),
  assignee_type: z.enum(['ai', 'human']).optional(),
  assigned_human_id: z.string().uuid().optional().nullable(),
  milestone_id: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  updated_by_agent_id: z.string().uuid().optional(),
  updated_by_session_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const CreateHumanSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
});

export const UpdateHumanSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

export const SprintStatus = z.enum(['planning', 'active', 'completed', 'cancelled']);

export const CreateSprintSchema = z.object({
  workspace_id: z.string().min(1),
  goal: z.string().max(2000).optional(),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
});

export const UpdateSprintSchema = z.object({
  goal: z.string().max(2000).optional().nullable(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  status: SprintStatus.optional(),
});

export const CreateMilestoneSchema = z.object({
  workspace_id: z.string().min(1),
  sprint_id: z.string().optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  due_date: z.string().optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

export const UpdateMilestoneSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  due_date: z.string().optional().nullable(),
  status: z.enum(['open', 'closed']).optional(),
  sprint_id: z.string().optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

// Activity validation schema
export const CreateActivitySchema = z.object({
  activity_type: ActivityType,
  message: z.string().min(1, 'Message is required').max(5000, 'Message must be 5000 characters or less'),
  agent_id: z.string().uuid().optional(),
  metadata: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});

// Deliverable validation schema
export const CreateDeliverableSchema = z.object({
  deliverable_type: DeliverableType,
  title: z.string().min(1, 'Title is required'),
  path: z.string().optional(),
  description: z.string().optional(),
  session_id: z.string().optional(),
});

export const UpdateDeliverableSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').optional(),
  description: z.string().optional().nullable(),
  path: z.string().optional().nullable(),
});

export const CreateMilestoneDependencySchema = z.object({
  depends_on_milestone_id: z.string().uuid().optional(),
  depends_on_task_id: z.string().uuid().optional(),
  dependency_type: z.enum(['finish_to_start', 'blocks']).optional().default('finish_to_start'),
}).refine(
  data => data.depends_on_milestone_id != null || data.depends_on_task_id != null,
  { message: 'At least one of depends_on_milestone_id or depends_on_task_id is required' }
);

// Type exports for use in routes
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
export type CreateActivityInput = z.infer<typeof CreateActivitySchema>;
export type CreateDeliverableInput = z.infer<typeof CreateDeliverableSchema>;
export type UpdateDeliverableInput = z.infer<typeof UpdateDeliverableSchema>;
export type CreateHumanInput = z.infer<typeof CreateHumanSchema>;
export type UpdateHumanInput = z.infer<typeof UpdateHumanSchema>;

export const CreateAcceptanceCriteriaSchema = z.object({
  description: z.string().min(1).max(2000),
  is_met: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  parent_criteria_id: z.string().uuid().optional().nullable(),
  required_for_status: TaskStatus.optional().nullable(),
  gate_type: CriteriaGateType.optional(),
  artifact_key: z.string().max(200).optional().nullable(),
  create_subcriteria: z.boolean().optional(),
});

export const UpdateAcceptanceCriteriaSchema = z.object({
  description: z.string().min(1).max(2000).optional(),
  is_met: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  parent_criteria_id: z.string().uuid().optional().nullable(),
  required_for_status: TaskStatus.optional().nullable(),
  gate_type: CriteriaGateType.optional(),
  artifact_key: z.string().max(200).optional().nullable(),
});

export type CreateAcceptanceCriteriaInput = z.infer<typeof CreateAcceptanceCriteriaSchema>;
export type UpdateAcceptanceCriteriaInput = z.infer<typeof UpdateAcceptanceCriteriaSchema>;

// Wave 2 Entity Schemas

export const CreateOrgTicketSchema = z.object({
  organization_id: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  ticket_type: z.enum(['feature', 'bug', 'improvement', 'task', 'epic']).default('task'),
  external_ref: z.string().optional(),
  creator_name: z.string().optional(),
  assignee_name: z.string().optional(),
  due_date: z.string().optional(),
  story_points: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string()).default([]),
  org_sprint_id: z.string().optional().nullable(),
  org_milestone_id: z.string().optional().nullable(),
});

export const CreateMemorySchema = z.object({
  organization_id: z.string().optional(),
  workspace_id: z.string().optional(),
  memory_type: z.enum(['fact', 'decision', 'event', 'tool_run', 'error', 'observation', 'note', 'patch']),
  title: z.string().min(1).max(500),
  summary: z.string().optional(),
  body: z.string().optional(),
  source: z.string().optional(),
  source_ref: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const UpdateMemorySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  summary: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  status: z.enum(['open', 'resolved', 'closed']).optional(),
  memory_type: z.enum(['fact', 'decision', 'event', 'tool_run', 'error', 'observation', 'note', 'patch']).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(100).nullable().optional(),
});

export const CreateEntityLinkSchema = z.object({
  from_entity_type: z.string().min(1),
  from_entity_id: z.string().min(1),
  to_entity_type: z.string().min(1),
  to_entity_id: z.string().min(1),
  link_type: z.enum(['delegates_to', 'blocks', 'relates_to', 'derived_from', 'references', 'parent_of', 'motivated_by', 'resolved_by', 'contains', 'touches']),
  explanation: z.string().optional(),
}).refine(data => data.from_entity_id !== data.to_entity_id, {
  message: 'Cannot link an entity to itself',
  path: ['to_entity_id'],
});

export const CreateCommitSchema = z.object({
  workspace_id: z.string().min(1),
  commit_hash: z.string().min(1),
  message: z.string().min(1),
  author_name: z.string().optional(),
  author_email: z.string().optional(),
  branch: z.string().optional(),
  files_changed: z.array(z.string()).default([]),
  insertions: z.number().int().min(0).default(0),
  deletions: z.number().int().min(0).default(0),
  committed_at: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const CreateOrganizationSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  logo_url: z.string().url().optional(),
});

export const UpdateOrganizationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional().nullable(),
  logo_url: z.string().url().optional().nullable(),
});

export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationSchema>;

export const UpdateOrgTicketSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(['open', 'triaged', 'delegated', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  ticket_type: z.enum(['feature', 'bug', 'improvement', 'task', 'epic']).optional(),
  external_ref: z.string().optional().nullable(),
  assignee_name: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  story_points: z.number().int().min(0).max(100).optional().nullable(),
  tags: z.array(z.string()).optional(),
  org_sprint_id: z.string().optional().nullable(),
  org_milestone_id: z.string().optional().nullable(),
});

export const CreateOrgMilestoneSchema = z.object({
  organization_id: z.string().min(1),
  org_sprint_id: z.string().optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  due_date: z.string().optional(),
  status: z.enum(['open', 'closed']).default('open'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

export const UpdateOrgMilestoneSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  status: z.enum(['open', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  org_sprint_id: z.string().optional().nullable(),
});

export type CreateOrgMilestoneInput = z.infer<typeof CreateOrgMilestoneSchema>;
export type UpdateOrgMilestoneInput = z.infer<typeof UpdateOrgMilestoneSchema>;

export const CreateOrgSprintSchema = z.object({
  organization_id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  status: z.enum(['planned', 'active', 'completed']).default('planned'),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const UpdateOrgSprintSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(['planned', 'active', 'completed']).optional(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
});

export type CreateOrgSprintInput = z.infer<typeof CreateOrgSprintSchema>;
export type UpdateOrgSprintInput = z.infer<typeof UpdateOrgSprintSchema>;

export const CreateOrgTicketAcceptanceCriteriaSchema = z.object({
  description: z.string().min(1).max(1000),
  sort_order: z.number().int().min(0).default(0),
});

export const UpdateOrgTicketAcceptanceCriteriaSchema = z.object({
  description: z.string().min(1).max(1000).optional(),
  sort_order: z.number().int().min(0).optional(),
  is_met: z.number().int().min(0).max(1).optional(),
});

export type CreateOrgTicketAcceptanceCriteriaInput = z.infer<typeof CreateOrgTicketAcceptanceCriteriaSchema>;
export type UpdateOrgTicketAcceptanceCriteriaInput = z.infer<typeof UpdateOrgTicketAcceptanceCriteriaSchema>;

export type CreateOrgTicketInput = z.infer<typeof CreateOrgTicketSchema>;
export type UpdateOrgTicketInput = z.infer<typeof UpdateOrgTicketSchema>;
export type CreateMemoryInput = z.infer<typeof CreateMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof UpdateMemorySchema>;
export type CreateEntityLinkInput = z.infer<typeof CreateEntityLinkSchema>;
export type CreateCommitInput = z.infer<typeof CreateCommitSchema>;
