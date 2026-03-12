'use client';

import { useState } from 'react';
import { Bot, Brain, ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import type { Task, TaskWorkflowPlan, WorkflowPlanStep } from '@/lib/types';

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
    <div data-component="src/components/WorkflowPlanDiagram" className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
            <GitBranch className="w-4 h-4 text-mc-text-secondary" />
            <span>Orchestrator Workflow Plan</span>
          </div>
          <p className="mt-1 text-xs text-mc-text-secondary">{plan.summary}</p>
        </div>
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            title="Re-evaluate agent assignments and capability gaps"
            className="min-h-11 px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Brain className={`w-4 h-4 ${regenerating ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">Replan Workflow</span>
          </button>
        )}
      </div>

      <div className="p-2 sm:p-4 space-y-4">
        <section className="rounded-lg border border-mc-border bg-mc-bg-secondary/40 p-2 sm:p-3">
          <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Agent Step Proposals</div>
            <div className="text-[11px] text-mc-text-secondary">Planning candidates and capabilities</div>
          </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
          {plan.participants.map((participant) => {
            const skillExpanded = expandedParticipantSkills.has(participant.agent_id);
            const visibleSkills = skillExpanded ? participant.skills : participant.skills.slice(0, 2);
            return (
              <div
                key={participant.agent_id}
                className="rounded-lg border px-3 py-3 text-xs w-full border-mc-border bg-mc-bg-secondary"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 font-medium text-mc-text">
                  {participant.planner ? <Brain className="w-3.5 h-3.5 text-mc-accent" /> : <Bot className="w-3.5 h-3.5 text-mc-text-secondary" />}
                  <span>{participant.agent_name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {participant.planner && <span className="text-[11px] px-2 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary">planning lead</span>}
                  </div>
                </div>
                <div className="mt-1 text-mc-text-secondary">{participant.agent_role}</div>
                {participant.skills.length > 0 && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => toggleParticipantSkills(participant.agent_id)}
                      className="text-[11px] text-mc-text-secondary hover:text-mc-text inline-flex items-center gap-1"
                    >
                      {skillExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      Skills ({participant.skills.length})
                    </button>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                    {visibleSkills.map((skill) => (
                      <span key={`p-${participant.agent_id}-${skill}`} className="px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border text-[10px]">
                        {skill}
                      </span>
                    ))}
                    {!skillExpanded && participant.skills.length > 2 && (
                      <span className="px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border text-[10px] text-mc-text-secondary">+{participant.skills.length - 2} more</span>
                    )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </section>

        <section className="rounded-lg border border-mc-accent/40 bg-mc-accent/5 p-2 sm:p-3">
          <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs uppercase tracking-wide text-mc-accent font-medium">Execution Track</div>
            <div className="text-[11px] text-mc-text-secondary">Execution blueprint and runtime state.</div>
            <div className="text-[11px] px-2 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary">
              Runtime status now: {task.status.replace(/_/g, ' ')}
            </div>
            <div className="text-[11px] px-2 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary">
              Current step: {(currentStepLabel || currentStepStatus || task.status).replace(/_/g, ' ')}
            </div>
            <div className="text-[11px] px-2 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary">
              Iterations: {currentStepIterations}
            </div>
            {sessionRuntime && (
              <div className={`text-[11px] px-2 py-0.5 rounded border ${sessionRuntime.active > 0 ? 'bg-green-50 border-green-200 text-green-700' : 'bg-orange-50 border-orange-200 text-orange-700'}`}>
                Sessions: {sessionRuntime.active} active / {sessionRuntime.interrupted} interrupted / {sessionRuntime.total} total
              </div>
            )}
            <div className="text-[11px] px-2 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary">
              Current runtime agent: {currentRuntimeAgentName || 'none active'}
            </div>
          </div>
        <div className="grid grid-cols-1 gap-3">
            {plan.steps.map((step, index) => {
              const stepSkillExpanded = expandedStepSkills.has(step.id);
              const visibleStepSkills = stepSkillExpanded ? step.skills : step.skills.slice(0, 2);
              const promptValue = promptDrafts[step.id] ?? step.prompt;
              const stepIterations = iterationsByStepStatus[step.status] || 0;
              const isCurrentStep = (currentStepStatus || task.status) === step.status;
              return (
                <div key={step.id} className="flex items-start gap-2 min-w-0">
                  <div
                    className={`w-full rounded-lg border p-3 ${isCurrentStep ? 'border-mc-accent' : 'border-mc-border'} bg-mc-bg-secondary`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] uppercase tracking-wide text-mc-text-secondary">Step {step.sequence}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded ${step.kind === 'verification' ? 'bg-blue-100 text-blue-700' : step.kind === 'queue' ? 'bg-mc-bg border border-mc-border text-mc-text-secondary' : 'bg-amber-100 text-amber-700'}`}>
                          {step.kind === 'queue' ? 'transition' : step.kind}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary">
                          iteration {stepIterations}
                        </span>
                        {isCurrentStep && (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-mc-accent/15 text-mc-accent border border-mc-accent/40">
                            current
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-mc-text-secondary">planned for {step.status.replace(/_/g, ' ')} phase</span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-mc-text">{step.label}</div>
                    <div className="mt-1 text-xs text-mc-text-secondary">
                      {step.agent_name
                        ? `${step.agent_name} (${step.agent_role || 'agent'})`
                        : step.kind === 'queue'
                          ? 'System transition (no agent required)'
                          : 'Unassigned - no matching agent capability'}
                    </div>
                    {step.skills.length > 0 && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => toggleStepSkills(step.id)}
                          className="text-[11px] text-mc-text-secondary hover:text-mc-text inline-flex items-center gap-1"
                        >
                          {stepSkillExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          Skills ({step.skills.length})
                        </button>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                        {visibleStepSkills.map((skill) => (
                          <span key={`s-${step.id}-${skill}`} className="px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border text-[10px]">
                            {skill}
                          </span>
                        ))}
                        {!stepSkillExpanded && step.skills.length > 2 && (
                          <span className="px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border text-[10px] text-mc-text-secondary">+{step.skills.length - 2} more</span>
                        )}
                        </div>
                      </div>
                    )}

                    {canEditPlan && onPromptChange && onPromptSave && step.agent_id && step.kind !== 'queue' && (
                      <div className="mt-3 space-y-2">
                        <div className="text-[11px] uppercase tracking-wide text-mc-text-secondary">Planned Prompt</div>
                        <textarea
                          value={promptValue}
                          onChange={(event) => onPromptChange(step.id, event.target.value)}
                          rows={4}
                          className="w-full rounded border border-mc-border bg-mc-bg px-2 py-1.5 text-xs text-mc-text"
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => onPromptSave(step.id)}
                            disabled={savingPromptStepId === step.id}
                            className="min-h-9 px-2.5 py-1.5 rounded border border-mc-border text-xs hover:bg-mc-bg-tertiary disabled:opacity-50"
                          >
                            {savingPromptStepId === step.id ? 'Saving...' : 'Save Prompt'}
                          </button>
                        </div>
                      </div>
                    )}

                    {(!step.agent_id || step.kind === 'queue') && (
                      <div className="mt-3 text-[11px] text-mc-text-secondary">
                        Automatic transition checkpoint. No agent executes here; the orchestrator advances to the next actionable stage.
                      </div>
                    )}

                    {step.loop_target_status && (
                      <div className="mt-3 text-[11px] text-mc-text-secondary">
                        On failure, returns task to {step.loop_target_status.replace(/_/g, ' ')} phase
                      </div>
                    )}
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
