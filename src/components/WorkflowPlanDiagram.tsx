'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  GitBranch,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { Task, TaskWorkflowPlan, WorkflowPlanParticipant, WorkflowPlanStep } from '@/lib/types';

interface WorkflowPlanDiagramProps {
  task: Pick<Task, 'status' | 'title'>;
  plan: TaskWorkflowPlan;
  currentStepStatus?: string | null;
  currentStepLabel?: string | null;
  currentStepIterations?: number;
  iterationsByStepStatus?: Record<string, number>;
  sessionRuntime?: {
    active: number;
    interrupted: number;
    stale: number;
    total: number;
  };
  currentRuntimeAgentName?: string | null;
  regenerating?: boolean;
  onRegenerate?: () => void;
  promptDrafts?: Record<string, string>;
  onPromptChange?: (stepId: string, value: string) => void;
  onPromptSave?: (stepId: string) => void;
  savingPromptStepId?: string | null;
  canEditPlan?: boolean;
}

function humanize(value: string | null | undefined, fallback = 'Not set'): string {
  if (!value) return fallback;
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function workflowNarrative(workflowName: string): string {
  switch (workflowName) {
    case 'Simple':
      return 'Fast path: build, review, then hand off to human acceptance.';
    case 'Strict':
      return 'High-scrutiny path: extra verification before the final review handoff.';
    case 'Standard':
      return 'Default path: orchestrate build, test, review, and then hand over for acceptance.';
    default:
      return 'Role-driven orchestration path with explicit stage ownership and loopback handling.';
  }
}

function stepKindLabel(step: WorkflowPlanStep): string {
  if (step.kind === 'queue') return 'Control checkpoint';
  if (step.kind === 'verification') return 'Quality gate';
  return 'Execution stage';
}

function stepKindTone(step: WorkflowPlanStep, isCurrent: boolean): string {
  if (isCurrent) return 'border-mc-accent bg-gradient-to-br from-mc-accent/10 via-mc-bg to-mc-bg-secondary shadow-[0_14px_40px_-26px_rgba(184,134,11,0.55)]';
  if (step.kind === 'verification') return 'border-sky-200 bg-gradient-to-br from-sky-50 via-mc-bg to-mc-bg-secondary';
  if (step.kind === 'queue') return 'border-stone-200 bg-gradient-to-br from-mc-bg-secondary via-mc-bg to-mc-bg';
  return 'border-mc-border bg-gradient-to-br from-mc-bg-secondary via-mc-bg to-mc-bg';
}

function participantTone(participant: WorkflowPlanParticipant): string {
  return participant.planner
    ? 'border-mc-accent/40 bg-gradient-to-br from-mc-accent/10 via-mc-bg to-mc-bg-secondary'
    : 'border-mc-border bg-gradient-to-br from-mc-bg-secondary via-mc-bg to-mc-bg';
}

function stepPurpose(step: WorkflowPlanStep): string {
  if (step.kind === 'queue') {
    return 'Mission Control advances the task once the prior stage has produced enough evidence.';
  }
  if (step.kind === 'verification') {
    return 'This stage pressure-tests the previous output before the pipeline moves forward.';
  }
  if (!step.agent_id) {
    return 'No agent is currently mapped to this stage, so orchestration cannot execute it automatically.';
  }
  return `${step.agent_name || 'Assigned agent'} owns this stage and is expected to move the task toward ${humanize(step.status).toLowerCase()}.`;
}

function stepOutcome(step: WorkflowPlanStep): string {
  if (step.kind === 'queue') return 'Outcome: task state changes and the next actionable stage becomes eligible.';
  if (step.kind === 'verification') return 'Outcome: evidence is checked, then the task either advances or loops back with explicit failure context.';
  if (!step.agent_id) return 'Outcome: capability gap remains visible until a suitable participant is assigned.';
  return `Outcome: ${humanize(step.status)} work is completed by ${step.agent_name || 'the assigned agent'} and handed to the next stage.`;
}

function runtimeTone(sessionRuntime?: WorkflowPlanDiagramProps['sessionRuntime']): string {
  if (!sessionRuntime) return 'border-mc-border bg-mc-bg';
  if (sessionRuntime.active > 0) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (sessionRuntime.interrupted > 0 || sessionRuntime.stale > 0) return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-mc-border bg-mc-bg text-mc-text-secondary';
}

export function WorkflowPlanDiagram({
  task,
  plan,
  currentStepStatus,
  currentStepLabel,
  currentStepIterations = 0,
  iterationsByStepStatus = {},
  sessionRuntime,
  currentRuntimeAgentName = null,
  regenerating = false,
  onRegenerate,
  promptDrafts = {},
  onPromptChange,
  onPromptSave,
  savingPromptStepId = null,
  canEditPlan = true,
}: WorkflowPlanDiagramProps) {
  const [expandedParticipantSkills, setExpandedParticipantSkills] = useState<Set<string>>(new Set());
  const [expandedStepSkills, setExpandedStepSkills] = useState<Set<string>>(new Set());

  const planner = useMemo(
    () => plan.participants.find((participant) => participant.planner) || null,
    [plan.participants]
  );
  const executionParticipants = useMemo(
    () => plan.participants.filter((participant) => !participant.planner),
    [plan.participants]
  );
  const activeStepLabel = currentStepLabel || humanize(currentStepStatus || task.status);
  const guideCards = [
    {
      title: 'Plan the route',
      detail: `${planner?.agent_name || 'Orchestrator'} selects the workflow shape and assigns stage ownership.`,
      icon: Brain,
    },
    {
      title: 'Staff the pipeline',
      detail: `${executionParticipants.length} execution participant${executionParticipants.length === 1 ? '' : 's'} carry the active stages.`,
      icon: Users,
    },
    {
      title: 'Run the stages',
      detail: `Each step maps to a task status so runtime always has a visible owner and destination.`,
      icon: Activity,
    },
    {
      title: 'Verify and loop',
      detail: 'Failures return to a defined recovery point instead of silently stalling the task.',
      icon: ShieldCheck,
    },
  ];

  const toggleParticipantSkills = (agentId: string) => {
    setExpandedParticipantSkills((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const toggleStepSkills = (stepId: string) => {
    setExpandedStepSkills((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  return (
    <div data-component="src/components/WorkflowPlanDiagram" className="overflow-hidden rounded-[1.25rem] border border-mc-border bg-gradient-to-br from-[#fffaf0] via-mc-bg to-[#f7efe0] shadow-[0_24px_80px_-48px_rgba(130,95,34,0.45)]">
      <div className="relative overflow-hidden border-b border-mc-border bg-[linear-gradient(135deg,rgba(184,134,11,0.12),rgba(255,248,230,0.94)_42%,rgba(255,255,255,0.98))] p-4 sm:p-5">
        <div className="absolute inset-y-0 right-0 hidden w-56 bg-[radial-gradient(circle_at_top_right,rgba(184,134,11,0.2),transparent_68%)] sm:block" />
        <div className="relative flex items-start justify-between gap-3 flex-wrap">
          <div className="max-w-3xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-mc-accent/25 bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-mc-text-secondary">
              <GitBranch className="h-3.5 w-3.5 text-mc-accent" />
              Orchestration Pipeline
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xl font-semibold text-mc-text sm:text-2xl">{task.title}</h3>
              <span className="rounded-full border border-mc-border bg-white/80 px-2.5 py-1 text-[11px] uppercase tracking-wide text-mc-text-secondary">
                {plan.workflow_name}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-mc-text-secondary">{workflowNarrative(plan.workflow_name)}</p>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-mc-text-secondary/90">{plan.summary}</p>
          </div>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating}
              title="Re-evaluate agent assignments and capability gaps"
              className="min-h-11 rounded-full border border-mc-border bg-white/85 px-4 py-2 text-sm text-mc-text shadow-sm transition hover:bg-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 text-mc-accent ${regenerating ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Replan Workflow</span>
              <span className="sm:hidden">Replan</span>
            </button>
          )}
        </div>

        <div className="relative mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {guideCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} className="rounded-2xl border border-white/70 bg-white/75 p-3 shadow-[0_16px_36px_-30px_rgba(80,60,20,0.45)] backdrop-blur-sm">
                <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
                  <Icon className="h-4 w-4 text-mc-accent" />
                  <span>{card.title}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-mc-text-secondary">{card.detail}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-3 sm:p-5 space-y-5">
        <section className="rounded-[1.1rem] border border-mc-border bg-white/70 p-3 sm:p-4 shadow-[0_16px_40px_-34px_rgba(0,0,0,0.25)]">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-mc-text-secondary">Pipeline Cast</div>
              <div className="mt-1 text-sm font-medium text-mc-text">Who plans, who executes, and where each agent contributes.</div>
            </div>
            <div className="rounded-full border border-mc-border bg-mc-bg px-3 py-1 text-[11px] text-mc-text-secondary">
              {plan.participants.length} participant{plan.participants.length === 1 ? '' : 's'} in plan
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)]">
            <div className={`rounded-2xl border p-4 ${planner ? participantTone(planner) : 'border-mc-border bg-mc-bg'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
                  <Brain className="h-4 w-4 text-mc-accent" />
                  <span>{planner?.agent_name || 'No orchestrator assigned'}</span>
                </div>
                <span className="rounded-full border border-mc-accent/30 bg-mc-accent/10 px-2.5 py-1 text-[11px] uppercase tracking-wide text-mc-accent">
                  Planning lead
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-mc-text-secondary">
                {planner
                  ? `${planner.agent_role} owns workflow shaping, stage sequencing, and participant coverage before runtime begins.`
                  : 'No dedicated planner was found for this workflow plan.'}
              </p>
              {planner?.skills?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {planner.skills.map((skill) => (
                    <span key={`planner-${skill}`} className="rounded-full border border-mc-border bg-white/75 px-2 py-1 text-[11px] text-mc-text-secondary">
                      {skill}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {executionParticipants.map((participant) => {
                const skillExpanded = expandedParticipantSkills.has(participant.agent_id);
                const visibleSkills = skillExpanded ? participant.skills : participant.skills.slice(0, 3);
                return (
                  <div key={participant.agent_id} className={`rounded-2xl border p-4 ${participantTone(participant)}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
                          <Bot className="h-4 w-4 text-mc-text-secondary" />
                          <span>{participant.agent_name}</span>
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-wide text-mc-text-secondary">{participant.agent_role}</div>
                      </div>
                      <span className="rounded-full border border-mc-border bg-white/80 px-2 py-1 text-[11px] text-mc-text-secondary">
                        Execution
                      </span>
                    </div>

                    <p className="mt-3 text-xs leading-5 text-mc-text-secondary">
                      Assigned to one or more runtime stages based on role fit and capability coverage.
                    </p>

                    {participant.skills.length > 0 ? (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => toggleParticipantSkills(participant.agent_id)}
                          className="inline-flex items-center gap-1 text-[11px] text-mc-text-secondary transition hover:text-mc-text"
                        >
                          {skillExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          Capability set ({participant.skills.length})
                        </button>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {visibleSkills.map((skill) => (
                            <span key={`p-${participant.agent_id}-${skill}`} className="rounded-full border border-mc-border bg-white/80 px-2 py-1 text-[11px] text-mc-text-secondary">
                              {skill}
                            </span>
                          ))}
                          {!skillExpanded && participant.skills.length > 3 ? (
                            <span className="rounded-full border border-mc-border bg-white/80 px-2 py-1 text-[11px] text-mc-text-secondary">
                              +{participant.skills.length - 3} more
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-[1.1rem] border border-mc-accent/25 bg-[linear-gradient(180deg,rgba(184,134,11,0.08),rgba(255,255,255,0.92)_26%,rgba(255,255,255,0.98))] p-3 sm:p-4 shadow-[0_18px_42px_-34px_rgba(120,90,20,0.4)]">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-mc-accent">Live Runtime</div>
              <div className="mt-1 text-sm font-medium text-mc-text">What the orchestrator is doing right now, and where the task sits in the lane.</div>
            </div>
            <div className={`rounded-full border px-3 py-1 text-[11px] ${runtimeTone(sessionRuntime)}`}>
              {sessionRuntime
                ? `${sessionRuntime.active} active / ${sessionRuntime.interrupted} interrupted / ${sessionRuntime.total} total sessions`
                : 'No session telemetry yet'}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-mc-border bg-white/80 p-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-mc-text-secondary">
                <GitBranch className="h-3.5 w-3.5 text-mc-accent" />
                Runtime status
              </div>
              <div className="mt-2 text-base font-semibold text-mc-text">{humanize(task.status)}</div>
            </div>
            <div className="rounded-2xl border border-mc-border bg-white/80 p-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-mc-text-secondary">
                <Activity className="h-3.5 w-3.5 text-mc-accent" />
                Active step
              </div>
              <div className="mt-2 text-base font-semibold text-mc-text">{activeStepLabel}</div>
            </div>
            <div className="rounded-2xl border border-mc-border bg-white/80 p-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-mc-text-secondary">
                <Clock3 className="h-3.5 w-3.5 text-mc-accent" />
                Current iteration
              </div>
              <div className="mt-2 text-base font-semibold text-mc-text">{currentStepIterations}</div>
            </div>
            <div className="rounded-2xl border border-mc-border bg-white/80 p-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-mc-text-secondary">
                <Bot className="h-3.5 w-3.5 text-mc-accent" />
                Runtime owner
              </div>
              <div className="mt-2 text-base font-semibold text-mc-text">{currentRuntimeAgentName || 'No active agent'}</div>
            </div>
          </div>
        </section>

        <section className="rounded-[1.1rem] border border-mc-border bg-white/72 p-3 sm:p-4 shadow-[0_16px_36px_-34px_rgba(0,0,0,0.25)]">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-mc-text-secondary">Stage-by-stage pipeline</div>
              <div className="mt-1 text-sm font-medium text-mc-text">Every stage shows owner, trigger phase, expected outcome, and failure behavior.</div>
            </div>
            <div className="rounded-full border border-mc-border bg-mc-bg px-3 py-1 text-[11px] text-mc-text-secondary">
              {plan.steps.length} stage{plan.steps.length === 1 ? '' : 's'} mapped
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4">
            {plan.steps.map((step, index) => {
              const stepSkillExpanded = expandedStepSkills.has(step.id);
              const visibleStepSkills = stepSkillExpanded ? step.skills : step.skills.slice(0, 3);
              const promptValue = promptDrafts[step.id] ?? step.prompt;
              const stepIterations = iterationsByStepStatus[step.status] || 0;
              const isCurrentStep = (currentStepStatus || task.status) === step.status;
              return (
                <div key={step.id} className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)] lg:items-stretch">
                  <div className="rounded-2xl border border-mc-border bg-gradient-to-br from-mc-bg-secondary via-mc-bg to-mc-bg p-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[11px] uppercase tracking-[0.18em] text-mc-text-secondary">Stage {step.sequence}</span>
                      {isCurrentStep ? (
                        <span className="rounded-full border border-mc-accent/35 bg-mc-accent/10 px-2.5 py-1 text-[11px] text-mc-accent">Current</span>
                      ) : null}
                    </div>
                    <div className="mt-3 text-lg font-semibold text-mc-text">{step.label}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-mc-text-secondary">
                      <span className="rounded-full border border-mc-border bg-white/80 px-2 py-1">{stepKindLabel(step)}</span>
                      <span className="rounded-full border border-mc-border bg-white/80 px-2 py-1">Triggers in {humanize(step.status)}</span>
                      <span className="rounded-full border border-mc-border bg-white/80 px-2 py-1">Iteration {stepIterations}</span>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-mc-text-secondary">{stepPurpose(step)}</p>
                    {index < plan.steps.length - 1 ? (
                      <div className="mt-4 hidden items-center gap-2 text-[11px] uppercase tracking-wide text-mc-text-secondary lg:inline-flex">
                        <ArrowRight className="h-3.5 w-3.5 text-mc-accent" />
                        Next stage: {plan.steps[index + 1]?.label}
                      </div>
                    ) : (
                      <div className="mt-4 hidden items-center gap-2 text-[11px] uppercase tracking-wide text-mc-text-secondary lg:inline-flex">
                        <CheckCircle2 className="h-3.5 w-3.5 text-mc-accent-green" />
                        Final handoff stage
                      </div>
                    )}
                  </div>

                  <div className={`rounded-2xl border p-4 ${stepKindTone(step, isCurrentStep)}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-mc-text-secondary">Assigned role</div>
                        <div className="mt-1 text-base font-semibold text-mc-text">
                          {step.agent_name
                            ? `${step.agent_name} (${step.agent_role || 'agent'})`
                            : step.kind === 'queue'
                              ? 'System checkpoint'
                              : 'Unassigned capability gap'}
                        </div>
                      </div>
                      <div className="rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-[11px] text-mc-text-secondary">
                        {humanize(step.status)} phase
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-white/80 bg-white/70 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-mc-text-secondary">Stage purpose</div>
                          <p className="mt-2 text-sm leading-6 text-mc-text-secondary">{stepPurpose(step)}</p>
                        </div>
                        <div className="rounded-2xl border border-white/80 bg-white/70 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-mc-text-secondary">Expected outcome</div>
                          <p className="mt-2 text-sm leading-6 text-mc-text-secondary">{stepOutcome(step)}</p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="rounded-2xl border border-white/80 bg-white/70 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-mc-text-secondary">Failure behavior</div>
                          <p className="mt-2 text-sm leading-6 text-mc-text-secondary">
                            {step.loop_target_status
                              ? `If this stage fails, orchestration returns the task to ${humanize(step.loop_target_status).toLowerCase()} for another pass.`
                              : 'No explicit loopback is configured for this stage.'}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-white/80 bg-white/70 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-mc-text-secondary">Capabilities in play</div>
                          {step.skills.length > 0 ? (
                            <>
                              <button
                                type="button"
                                onClick={() => toggleStepSkills(step.id)}
                                className="mt-2 inline-flex items-center gap-1 text-[11px] text-mc-text-secondary transition hover:text-mc-text"
                              >
                                {stepSkillExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                View skills ({step.skills.length})
                              </button>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {visibleStepSkills.map((skill) => (
                                  <span key={`s-${step.id}-${skill}`} className="rounded-full border border-mc-border bg-mc-bg px-2 py-1 text-[11px] text-mc-text-secondary">
                                    {skill}
                                  </span>
                                ))}
                                {!stepSkillExpanded && step.skills.length > 3 ? (
                                  <span className="rounded-full border border-mc-border bg-mc-bg px-2 py-1 text-[11px] text-mc-text-secondary">
                                    +{step.skills.length - 3} more
                                  </span>
                                ) : null}
                              </div>
                            </>
                          ) : (
                            <p className="mt-2 text-sm leading-6 text-mc-text-secondary">No explicit skill bundle is attached to this stage.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {canEditPlan && onPromptChange && onPromptSave && step.agent_id && step.kind !== 'queue' ? (
                      <div className="mt-4 rounded-2xl border border-white/80 bg-white/72 p-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-mc-text-secondary">Planned prompt</div>
                          <div className="text-[11px] text-mc-text-secondary">Editable before execution starts</div>
                        </div>
                        <textarea
                          value={promptValue}
                          onChange={(event) => onPromptChange(step.id, event.target.value)}
                          rows={4}
                          className="mt-3 w-full rounded-xl border border-mc-border bg-mc-bg px-3 py-2 text-xs text-mc-text"
                        />
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => onPromptSave(step.id)}
                            disabled={savingPromptStepId === step.id}
                            className="min-h-10 rounded-full border border-mc-border bg-white px-3 py-2 text-xs text-mc-text transition hover:bg-mc-bg disabled:opacity-50"
                          >
                            {savingPromptStepId === step.id ? 'Saving...' : 'Save Prompt'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
