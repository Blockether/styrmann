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
  business_id: z.string().optional(),
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
