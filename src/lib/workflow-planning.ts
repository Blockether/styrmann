import { existsSync, lstatSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getDb, queryAll, queryOne, run } from '@/lib/db';
import { createTaskActivity } from '@/lib/task-activity';
import { broadcast } from '@/lib/events';
import { WORKFLOW_TEMPLATES, ensureWorkflowTemplate } from '@/lib/workflow-templates';
import { llmJsonInfer } from '@/lib/llm';
import type {
  Agent,
  CapabilityProposal,
  Task,
  TaskFinding,
  TaskWorkflowPlan,
  WorkflowPlanParticipant,
  WorkflowPlanStep,
  WorkflowStage,
} from '@/lib/types';

type PersistedPlanRow = {
  id: string;
  task_id: string;
  workspace_id: string;
  orchestrator_agent_id: string | null;
  workflow_template_id: string | null;
  workflow_name: string;
  summary: string;
  participants_json: string;
  steps_json: string;
  created_at: string;
  updated_at: string;
};

type PlanningTask = Pick<Task, 'id' | 'title' | 'description' | 'priority' | 'task_type' | 'effort' | 'impact' | 'workspace_id' | 'status' | 'assigned_agent_id' | 'assigned_human_id' | 'assignee_type'>;

const SKILL_FALLBACKS: Record<string, string[]> = {
  orchestrator: ['workflow-design', 'scope-triage', 'agent-selection'],
  builder: ['implementation', 'delivery', 'code-change'],
  tester: ['validation', 'test-design', 'regression-check'],
  reviewer: ['verification', 'quality-gate', 'risk-review'],
  verifier: ['verification', 'acceptance-gate', 'release-check'],
  explorer: ['research-discovery', 'option-mapping', 'tradeoff-analysis'],
  pragmatist: ['simplicity-review', 'scope-minimization', 'maintenance-lens'],
  guardian: ['correctness-review', 'risk-assessment', 'safety-check'],
  consolidator: ['synthesis', 'recommendation-drafting', 'decision-record'],
};

function normalizeRole(role: string | null | undefined): string {
  return String(role || '').trim().toLowerCase();
}

function listAgentSkillNames(agent: Pick<Agent, 'agent_workspace_path'>): string[] {
  const skillsRoot = agent.agent_workspace_path ? join(agent.agent_workspace_path, 'skills') : null;
  if (!skillsRoot || !existsSync(skillsRoot)) return [];

  return readdirSync(skillsRoot)
    .filter((entry) => {
      const full = join(skillsRoot, entry);
      try {
        const stats = lstatSync(full);
        if (stats.isSymbolicLink()) return true;
        return statSync(full).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));
}

function tokenizeTask(task: PlanningTask): string[] {
  return `${task.title} ${task.description || ''} ${task.task_type} ${task.priority}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function chooseWorkflowName(task: PlanningTask): string {
  const effort = Number(task.effort || 0);
  const impact = Number(task.impact || 0);
  const haystack = `${task.title} ${task.description || ''}`.toLowerCase();
  if (task.task_type === 'research' || /\b(architect|architecture|rfc|adr)\b/.test(haystack)) return 'Architecture';
  if (task.priority === 'urgent' || impact >= 4 || effort >= 4) return 'Strict';
  if (impact >= 3 || effort >= 3 || task.task_type === 'bug') return 'Standard';
  return 'Simple';
}

function chooseTemplateStages(name: string): WorkflowStage[] {
  const definition = WORKFLOW_TEMPLATES.find((item) => item.name === name) || WORKFLOW_TEMPLATES.find((item) => item.isDefault) || WORKFLOW_TEMPLATES[0];
  return definition.stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    role: stage.role,
    status: stage.status as WorkflowStage['status'],
  }));
}

function chooseFailTargets(name: string): Record<string, string> {
  const definition = WORKFLOW_TEMPLATES.find((item) => item.name === name) || WORKFLOW_TEMPLATES.find((item) => item.isDefault) || WORKFLOW_TEMPLATES[0];
  return definition.failTargets;
}

function scoreAgent(agent: Agent, role: string, taskTokens: string[], alreadyUsed: Set<string>): number {
  const normalizedRole = normalizeRole(role);
  const agentRole = normalizeRole(agent.role);
  const haystack = `${agent.name} ${agent.role} ${agent.description || ''}`.toLowerCase();
  let score = 0;

  if (agentRole === normalizedRole) score += 80;
  if (agentRole.includes(normalizedRole) || haystack.includes(normalizedRole)) score += 30;
  if (normalizedRole === 'reviewer' && (agentRole.includes('verify') || agentRole.includes('review'))) score += 20;
  if (normalizedRole === 'tester' && agentRole.includes('test')) score += 20;
  if (normalizedRole === 'builder' && (agentRole.includes('build') || agentRole.includes('engineer') || agentRole.includes('implement'))) score += 20;

  const skills = listAgentSkillNames(agent);
  for (const token of taskTokens) {
    if (haystack.includes(token)) score += 2;
    if (skills.some((skill) => skill.toLowerCase().includes(token))) score += 4;
  }

  if (alreadyUsed.has(agent.id)) score -= 10;
  if (agent.status === 'offline') score -= 1000;
  return score;
}

function pickSkills(agent: Agent, taskTokens: string[]): { skills: string[]; usedFallback: boolean } {
  const linkedSkills = listAgentSkillNames(agent);
  if (linkedSkills.length > 0) {
    const matched = linkedSkills.filter((skill) => taskTokens.some((token) => skill.toLowerCase().includes(token)));
    return {
      skills: (matched.length > 0 ? matched : linkedSkills).slice(0, 4),
      usedFallback: false,
    };
  }

  const fallback = SKILL_FALLBACKS[normalizeRole(agent.role)] || ['general-execution'];
  return { skills: fallback, usedFallback: true };
}

type LlmSkillMap = Record<string, string[]>;

async function llmSelectSkills(
  task: PlanningTask,
  roleAssignments: Map<string, { agent: Agent | null; skills: string[]; usedFallback: boolean }>,
): Promise<LlmSkillMap | null> {
  const lines: string[] = [];
  for (const [role, assignment] of roleAssignments) {
    if (!assignment.agent) continue;
    const allSkills = listAgentSkillNames(assignment.agent);
    const fallback = SKILL_FALLBACKS[normalizeRole(assignment.agent.role)] || [];
    const available = allSkills.length > 0 ? allSkills : fallback;
    lines.push(
      `- Agent "${assignment.agent.name}" (id: ${assignment.agent.id}, role: ${assignment.agent.role}), assigned as ${role}` +
      `\n  Available skills: [${available.join(', ')}]`,
    );
  }
  if (lines.length === 0) return null;

  const system =
    'You are a workflow planning assistant for an AI agent orchestration system. ' +
    'Given a task and agents with their available skills, select 1-3 most relevant skills per agent for their assigned workflow step. ' +
    'Only select from the available skills listed for each agent. ' +
    'Return ONLY a JSON object mapping agent id to an array of selected skill names. No explanation, no markdown.';

  const user = [
    `Task: "${task.title}"`,
    task.description ? `Description: ${task.description}` : null,
    `Type: ${task.task_type}, Priority: ${task.priority}${task.effort ? `, Effort: ${task.effort}` : ''}${task.impact ? `, Impact: ${task.impact}` : ''}`,
    '',
    'Agents and their workflow assignments:',
    ...lines,
    '',
    'Return JSON: {"<agent_id>": ["skill1", "skill2"], ...}',
  ].filter(Boolean).join('\n');

  return llmJsonInfer<LlmSkillMap>(system, user);
}

function deriveStepKind(status: string, role: string | null): WorkflowPlanStep['kind'] {
  if (!role) return 'queue';
  if (['testing', 'review', 'verification'].includes(status)) return 'verification';
  return 'execution';
}

function defaultStepPrompt(task: PlanningTask, step: Pick<WorkflowPlanStep, 'label' | 'status' | 'role' | 'loop_target_status' | 'kind'>): string {
  const lines: string[] = [
    `Task: ${task.title}`,
    task.description ? `Context: ${task.description}` : '',
    `Step: ${step.label} (${step.status})`,
    `Role focus: ${step.role || 'queue transition'}`,
    'Goal: complete this step with clear evidence and handoff-ready output.',
  ].filter(Boolean);

  if (step.kind === 'verification') {
    lines.push('Validation scope: verify quality gates, report failures precisely, and include reproducible evidence.');
  }
  if (step.loop_target_status) {
    lines.push(`Failure loop target: if this step fails, workflow returns to ${step.loop_target_status}.`);
    lines.push('Iteration rule: on each retry, state what changed from the prior attempt and why it should now pass.');
    lines.push('Exit rule: leave the loop only with verifiable evidence, otherwise call failure with root-cause and blocking factors.');
  }

  lines.push('Output: concise summary of what changed, what was verified, and what the next stage needs.');
  return lines.join('\n');
}

function buildPlanningAgentsPayload(
  task: PlanningTask,
  participants: WorkflowPlanParticipant[],
  steps: WorkflowPlanStep[],
): Array<{ agent_id?: string; name?: string; role?: string; instructions?: string; skills?: string[] }> {
  const byAgent = new Map<string, Array<WorkflowPlanStep>>();
  for (const step of steps) {
    if (!step.agent_id) continue;
    if (!byAgent.has(step.agent_id)) byAgent.set(step.agent_id, []);
    byAgent.get(step.agent_id)?.push(step);
  }

  return participants
    .filter((participant) => !participant.planner)
    .map((participant) => {
      const agentSteps = (byAgent.get(participant.agent_id) || []).sort((a, b) => a.sequence - b.sequence);
      const instructionBlocks = agentSteps.map((step) => {
        const header = `Step ${step.sequence}: ${step.label} (${step.status})`;
        const prompt = (step.prompt || '').trim() || defaultStepPrompt(task, step);
        return `${header}\n${prompt}`;
      });

      return {
        agent_id: participant.agent_id,
        name: participant.agent_name,
        role: participant.agent_role,
        instructions: instructionBlocks.length > 0
          ? instructionBlocks.join('\n\n---\n\n')
          : `Execute your assigned workflow stage for task ${task.title}.`,
        skills: participant.skills,
      };
    });
}

function readPlan(taskId: string): { plan: TaskWorkflowPlan; findings: TaskFinding[]; proposals: CapabilityProposal[] } | null {
  const row = queryOne<PersistedPlanRow>('SELECT * FROM task_workflow_plans WHERE task_id = ? LIMIT 1', [taskId]);
  if (!row) return null;

  const findings = queryAll<TaskFinding>('SELECT * FROM task_findings WHERE task_id = ? ORDER BY created_at DESC', [taskId]);
  const proposals = queryAll<CapabilityProposal>('SELECT * FROM capability_proposals WHERE task_id = ? ORDER BY created_at DESC', [taskId]);

  const parsedSteps = JSON.parse(row.steps_json || '[]') as Array<WorkflowPlanStep & { prompt?: string }>;
  const steps: WorkflowPlanStep[] = parsedSteps.map((step) => ({
    ...step,
    prompt: typeof step.prompt === 'string' && step.prompt.trim().length > 0
      ? step.prompt
      : `Task: ${row.summary}\nStep: ${step.label} (${step.status})\nGoal: complete this step with clear evidence.`,
  }));

  return {
    plan: {
      id: row.id,
      task_id: row.task_id,
      workspace_id: row.workspace_id,
      orchestrator_agent_id: row.orchestrator_agent_id,
      workflow_template_id: row.workflow_template_id,
      workflow_name: row.workflow_name,
      summary: row.summary,
      participants: JSON.parse(row.participants_json || '[]') as WorkflowPlanParticipant[],
      steps,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    findings,
    proposals,
  };
}

export function getTaskWorkflowPlan(taskId: string): { plan: TaskWorkflowPlan; findings: TaskFinding[]; proposals: CapabilityProposal[] } | null {
  return readPlan(taskId);
}

export async function ensureTaskWorkflowPlan(taskId: string, force = false): Promise<{ plan: TaskWorkflowPlan; findings: TaskFinding[]; proposals: CapabilityProposal[] }> {
  const existing = !force ? readPlan(taskId) : null;
  if (existing) return existing;
  return generateTaskWorkflowPlan(taskId);
}

export async function generateTaskWorkflowPlan(taskId: string): Promise<{ plan: TaskWorkflowPlan; findings: TaskFinding[]; proposals: CapabilityProposal[] }> {
  const task = queryOne<PlanningTask>('SELECT * FROM tasks WHERE id = ? LIMIT 1', [taskId]);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const db = getDb();
  const workflowName = chooseWorkflowName(task);
  const workflowTemplateId = ensureWorkflowTemplate(db, task.workspace_id, workflowName);
  const stages = chooseTemplateStages(workflowName);
  const failTargets = chooseFailTargets(workflowName);
  const taskTokens = tokenizeTask(task);
  const orchestrator = queryOne<Agent>(
    `SELECT * FROM agents
     WHERE role = 'orchestrator'
     ORDER BY created_at ASC
     LIMIT 1`,
  );
  const candidateAgents = queryAll<Agent>(
    `SELECT * FROM agents
     WHERE status != 'offline'
       AND role != 'orchestrator'
       AND role != 'presenter'
     ORDER BY updated_at DESC`,
  );

  const usedAgents = new Set<string>();
  const roleAssignments = new Map<string, { agent: Agent | null; skills: string[]; usedFallback: boolean }>();
  const participants: WorkflowPlanParticipant[] = [];
  const findings: TaskFinding[] = [];
  const proposals: CapabilityProposal[] = [];
  const metaWorkspace = queryOne<{ id: string; slug: string }>(
    `SELECT id, slug FROM workspaces WHERE repo_kind = 'meta' OR slug = 'system-openclaw' ORDER BY created_at ASC LIMIT 1`,
  );

  for (const stage of stages) {
    if (!stage.role || roleAssignments.has(stage.role)) continue;
    const sorted = [...candidateAgents]
      .map((agent) => ({ agent, score: scoreAgent(agent, stage.role as string, taskTokens, usedAgents) }))
      .sort((a, b) => b.score - a.score);

    const best = sorted[0];
    if (!best || best.score <= 0) {
      roleAssignments.set(stage.role, { agent: null, skills: [], usedFallback: false });
      findings.push({
        id: crypto.randomUUID(),
        task_id: task.id,
        workspace_id: task.workspace_id,
        finding_type: 'missing_agent',
        severity: 'critical',
        title: `Missing ${stage.role} capability`,
        detail: `No existing agent can fulfill the ${stage.role} role in the ${workflowName} workflow. The orchestrator kept the workflow structure but did not create a new agent.`,
        metadata: JSON.stringify({ role: stage.role, workflow: workflowName }),
        created_at: new Date().toISOString(),
      });
      continue;
    }

    usedAgents.add(best.agent.id);
    const skillSelection = pickSkills(best.agent, taskTokens);
    roleAssignments.set(stage.role, { agent: best.agent, skills: skillSelection.skills, usedFallback: skillSelection.usedFallback });

    if (!participants.some((participant) => participant.agent_id === best.agent.id)) {
      participants.push({
        agent_id: best.agent.id,
        agent_name: best.agent.name,
        agent_role: best.agent.role,
        skills: skillSelection.skills,
      });
    }

    if (skillSelection.usedFallback) {
      findings.push({
        id: crypto.randomUUID(),
        task_id: task.id,
        workspace_id: task.workspace_id,
        finding_type: 'missing_skill',
        severity: 'warn',
        title: `Generic skill coverage for ${best.agent.name}`,
        detail: `${best.agent.name} has no linked shared skills in its workspace, so the orchestrator is relying on role defaults for the ${stage.role} step.`,
        metadata: JSON.stringify({ role: stage.role, agent_id: best.agent.id }),
        created_at: new Date().toISOString(),
      });
    }
  }

  if (orchestrator && !participants.some((participant) => participant.agent_id === orchestrator.id)) {
    participants.unshift({
      agent_id: orchestrator.id,
      agent_name: orchestrator.name,
      agent_role: orchestrator.role,
      skills: pickSkills(orchestrator, taskTokens).skills,
      planner: true,
    });
  }

  // LLM-powered skill refinement: ask an LLM to pick the most relevant skills per agent
  const llmSkills = await llmSelectSkills(task, roleAssignments);
  if (llmSkills) {
    console.log('[Planning] LLM skill selection applied');
    for (const p of participants) {
      const selected = llmSkills[p.agent_id];
      if (selected && selected.length > 0) p.skills = selected;
    }
    for (const [, assignment] of roleAssignments) {
      if (assignment.agent) {
        const selected = llmSkills[assignment.agent.id];
        if (selected && selected.length > 0) assignment.skills = selected;
      }
    }
  } else {
    console.log('[Planning] LLM unavailable, using rule-based skill selection');
  }

  for (const finding of findings) {
    const role = (() => {
      try {
        const parsed = finding.metadata ? JSON.parse(finding.metadata) as { role?: string; agent_id?: string } : {};
        return parsed.role || parsed.agent_id || 'capability';
      } catch {
        return 'capability';
      }
    })();

    proposals.push({
      id: crypto.randomUUID(),
      task_id: task.id,
      workspace_id: task.workspace_id,
      learner_agent_id: null,
      proposal_type: finding.finding_type === 'missing_agent' ? 'agent' : 'skill',
      title: finding.finding_type === 'missing_agent'
        ? `Capability proposal: add ${role} agent archetype`
        : `Capability proposal: add ${role} shared skill`,
      detail: `Mission Control recorded this gap in the meta repository as a proposal only. No automatic system change has been made. Add a loop policy for this capability: explicit retry criteria, retry limit, and clear loop-exit evidence. ${finding.detail}`,
      target_name: String(role),
      meta_workspace_id: metaWorkspace?.id || null,
      meta_workspace_slug: metaWorkspace?.slug || null,
      status: 'open',
      created_at: new Date().toISOString(),
    });
  }

  const steps: WorkflowPlanStep[] = stages.map((stage, index) => {
    const assignment = stage.role ? roleAssignments.get(stage.role) : undefined;
    const step: WorkflowPlanStep = {
      id: stage.id,
      label: stage.label,
      role: stage.role,
      status: stage.status,
      kind: deriveStepKind(stage.status, stage.role),
      sequence: index + 1,
      agent_id: assignment?.agent?.id || null,
      agent_name: assignment?.agent?.name || null,
      agent_role: assignment?.agent?.role || null,
      skills: assignment?.skills || [],
      prompt: '',
      loop_target_status: failTargets[stage.status] || null,
    };

    step.prompt = defaultStepPrompt(task, step);
    return step;
  });

  const summary = `${workflowName} workflow planned by ${orchestrator?.name || 'the orchestrator'} using ${participants.filter((participant) => !participant.planner).length} execution participant(s).`;
  const planId = crypto.randomUUID();
  const now = new Date().toISOString();
  const firstExecutableStep = steps.find((step) => step.role && step.agent_id);
  const shouldPrimeExecution = task.assignee_type !== 'human' && ['inbox', 'planning'].includes(task.status);
  const nextAssignedAgentId = shouldPrimeExecution
    ? (firstExecutableStep?.agent_id || null)
    : (task.assigned_agent_id || null);
  const nextStatus = shouldPrimeExecution
    ? (firstExecutableStep?.agent_id ? 'assigned' : 'inbox')
    : task.status;

  const planningAgentsPayload = buildPlanningAgentsPayload(task, participants, steps);

  db.transaction(() => {
    run('DELETE FROM task_roles WHERE task_id = ?', [task.id]);
    run('DELETE FROM task_findings WHERE task_id = ?', [task.id]);
    run('DELETE FROM capability_proposals WHERE task_id = ?', [task.id]);
    run('DELETE FROM task_workflow_plans WHERE task_id = ?', [task.id]);

    run(
      `INSERT INTO task_workflow_plans
       (id, task_id, workspace_id, orchestrator_agent_id, workflow_template_id, workflow_name, summary, participants_json, steps_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        planId,
        task.id,
        task.workspace_id,
        orchestrator?.id || null,
        workflowTemplateId,
        workflowName,
        summary,
        JSON.stringify(participants),
        JSON.stringify(steps),
        now,
        now,
      ],
    );

    const insertedRoles = new Set<string>();
    for (const step of steps) {
      if (!step.role || !step.agent_id || insertedRoles.has(step.role)) continue;
      insertedRoles.add(step.role);
      run(
        `INSERT INTO task_roles (id, task_id, role, agent_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), task.id, step.role, step.agent_id, now],
      );
    }

    for (const finding of findings) {
      run(
        `INSERT INTO task_findings (id, task_id, workspace_id, finding_type, severity, title, detail, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [finding.id, finding.task_id, finding.workspace_id, finding.finding_type, finding.severity, finding.title, finding.detail, finding.metadata || null, finding.created_at],
      );
    }

    for (const proposal of proposals) {
      run(
        `INSERT INTO capability_proposals
         (id, task_id, workspace_id, learner_agent_id, proposal_type, title, detail, target_name, meta_workspace_id, meta_workspace_slug, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proposal.id,
          proposal.task_id,
          proposal.workspace_id,
          proposal.learner_agent_id || null,
          proposal.proposal_type,
          proposal.title,
          proposal.detail,
          proposal.target_name,
          proposal.meta_workspace_id || null,
          proposal.meta_workspace_slug || null,
          proposal.status,
          proposal.created_at,
        ],
      );
    }

    run(
      `UPDATE tasks
       SET workflow_template_id = ?,
           workflow_plan_id = ?,
           planning_complete = 1,
           planning_spec = ?,
           planning_agents = ?,
           assigned_agent_id = ?,
           status = ?,
           planning_dispatch_error = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        workflowTemplateId,
        planId,
        JSON.stringify({
          title: `Workflow Plan - ${task.title}`,
          summary,
          deliverables: ['Execution workflow plan', 'Agent role and skill mapping'],
          success_criteria: ['Existing agents selected', 'No dynamic agents created', 'Findings and proposals recorded for missing capability'],
          constraints: { workflow_name: workflowName },
        }),
        JSON.stringify(planningAgentsPayload),
        nextAssignedAgentId,
        nextStatus,
        findings.length > 0 ? `${findings.length} workflow finding(s) recorded` : null,
        now,
        task.id,
      ],
    );

    createTaskActivity({
      taskId: task.id,
      activityType: 'updated',
      message: `Orchestrator planned ${workflowName} workflow with ${steps.length} step(s).`,
      agentId: orchestrator?.id || null,
      metadata: {
        workflow_plan_id: planId,
        findings: findings.length,
        proposals: proposals.length,
        workflow_step: 'planning',
        decision_event: true,
      },
    });
  })();

  const persisted = readPlan(task.id);
  if (!persisted) {
    throw new Error(`Failed to persist workflow plan for task ${task.id}`);
  }

  const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ? LIMIT 1', [task.id]);
  if (updatedTask) {
    broadcast({ type: 'task_updated', payload: updatedTask });
  }

  return persisted;
}

export function updateWorkflowStepPrompt(taskId: string, stepId: string, prompt: string): { plan: TaskWorkflowPlan; findings: TaskFinding[]; proposals: CapabilityProposal[] } {
  const row = queryOne<PersistedPlanRow>('SELECT * FROM task_workflow_plans WHERE task_id = ? LIMIT 1', [taskId]);
  if (!row) {
    throw new Error('Workflow plan not found');
  }

  const task = queryOne<PlanningTask>('SELECT * FROM tasks WHERE id = ? LIMIT 1', [taskId]);
  if (!task) {
    throw new Error('Task not found');
  }

  const steps = JSON.parse(row.steps_json || '[]') as WorkflowPlanStep[];
  const participants = JSON.parse(row.participants_json || '[]') as WorkflowPlanParticipant[];
  const target = steps.find((step) => step.id === stepId);
  if (!target) {
    throw new Error('Workflow step not found');
  }

  target.prompt = prompt.trim() || defaultStepPrompt(task, target);

  const now = new Date().toISOString();
  const planningAgentsPayload = buildPlanningAgentsPayload(task, participants, steps);

  run('UPDATE task_workflow_plans SET steps_json = ?, updated_at = ? WHERE task_id = ?', [JSON.stringify(steps), now, taskId]);
  run('UPDATE tasks SET planning_agents = ?, updated_at = ? WHERE id = ?', [JSON.stringify(planningAgentsPayload), now, taskId]);

  const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ? LIMIT 1', [taskId]);
  if (updatedTask) {
    broadcast({ type: 'task_updated', payload: updatedTask });
  }

  const updated = readPlan(taskId);
  if (!updated) {
    throw new Error('Failed to reload updated workflow plan');
  }

  return updated;
}
