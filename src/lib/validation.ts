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

const TaskType = z.enum(['bug', 'feature', 'chore', 'documentation', 'research', 'autotrain']);

const ActivityType = z.enum([
  'spawned',
  'updated',
  'completed',
  'file_created',
  'status_changed',
  'dispatch_invocation'
]);

const DeliverableType = z.enum(['file', 'url', 'artifact']);

// Task validation schemas
export const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title must be 500 characters or less'),
  description: z.string().max(10000, 'Description must be 10000 characters or less').optional(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  task_type: TaskType.optional(),
  effort: z.number().int().min(1).max(5).optional().nullable(),
  impact: z.number().int().min(1).max(5).optional().nullable(),
  assigned_agent_id: z.string().uuid().optional().nullable(),
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
  assigned_agent_id: z.string().uuid().optional().nullable(),
  workflow_template_id: z.string().optional().nullable(),
  milestone_id: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  updated_by_agent_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
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
  coordinator_agent_id: z.string().uuid().optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

export const UpdateMilestoneSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  due_date: z.string().optional().nullable(),
  coordinator_agent_id: z.string().uuid().optional().nullable(),
  status: z.enum(['open', 'closed']).optional(),
  sprint_id: z.string().optional().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

// Activity validation schema
export const CreateActivitySchema = z.object({
  activity_type: ActivityType,
  message: z.string().min(1, 'Message is required').max(5000, 'Message must be 5000 characters or less'),
  agent_id: z.string().uuid().optional(),
  metadata: z.string().optional(),
});

// Deliverable validation schema
export const CreateDeliverableSchema = z.object({
  deliverable_type: DeliverableType,
  title: z.string().min(1, 'Title is required'),
  path: z.string().optional(),
  description: z.string().optional(),
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
