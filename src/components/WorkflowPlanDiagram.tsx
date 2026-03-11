'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Bot, Brain, ChevronDown, ChevronRight, GitBranch, RotateCcw } from 'lucide-react';
import type { Task, TaskWorkflowPlan, WorkflowPlanStep } from '@/lib/types';

interface WorkflowPlanDiagramProps {
  task: Pick<Task, 'status' | 'assigned_agent_id' | 'title'>;
  plan: TaskWorkflowPlan;
  regenerating?: boolean;
  onRegenerate?: () => void;
  failureCounts?: Record<string, number>;
  promptDrafts?: Record<string, string>;
  onPromptChange?: (stepId: string, value: string) => void;
  onPromptSave?: (stepId: string) => void;
  savingPromptStepId?: string | null;
  onFailureClick?: (agentId: string, step: string | null) => void;
}

function getStepState(task: Pick<Task, 'status'>, plan: TaskWorkflowPlan, step: WorkflowPlanStep): 'active' | 'complete' | 'pending' {
  const currentIndex = plan.steps.findIndex((item) => item.status === task.status);
  const stepIndex = plan.steps.findIndex((item) => item.id === step.id);
  if (step.status === task.status) return 'active';
  if (currentIndex >= 0 && stepIndex >= 0 && stepIndex < currentIndex) return 'complete';
  return 'pending';
}

export function WorkflowPlanDiagram({
  task,
  plan,
  regenerating = false,
  onRegenerate,
  failureCounts = {},
  promptDrafts = {},
  onPromptChange,
  onPromptSave,
  savingPromptStepId = null,
  onFailureClick,
}: WorkflowPlanDiagramProps) {
  const [expandedParticipantSkills, setExpandedParticipantSkills] = useState<Set<string>>(new Set());
  const [expandedStepSkills, setExpandedStepSkills] = useState<Set<string>>(new Set());

  const activeAgentIds = useMemo(() => {
    const ids = new Set<string>();
    if (task.assigned_agent_id) ids.add(task.assigned_agent_id);
    return ids;
  }, [task.assigned_agent_id]);

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
            {regenerating ? <RotateCcw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            <span className="hidden sm:inline">Replan Workflow</span>
          </button>
        )}
      </div>

      <div className="p-2 sm:p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
          {plan.participants.map((participant) => {
            const isActiveAgent = activeAgentIds.has(participant.agent_id);
            const failures = failureCounts[participant.agent_id] || 0;
            const skillExpanded = expandedParticipantSkills.has(participant.agent_id);
            const visibleSkills = skillExpanded ? participant.skills : participant.skills.slice(0, 2);
            return (
              <div
                key={participant.agent_id}
                className={`rounded-lg border px-3 py-3 text-xs w-full ${isActiveAgent ? 'border-mc-accent bg-mc-accent/10' : 'border-mc-border bg-mc-bg-secondary'}`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 font-medium text-mc-text">
                  {participant.planner ? <Brain className="w-3.5 h-3.5 text-mc-accent" /> : <Bot className="w-3.5 h-3.5 text-mc-text-secondary" />}
                  <span>{participant.agent_name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {isActiveAgent && <span className="text-[11px] px-2 py-0.5 rounded bg-mc-accent text-mc-bg font-medium">active</span>}
                    {participant.planner && <span className="text-[11px] px-2 py-0.5 rounded bg-mc-bg border border-mc-border text-mc-text-secondary">planning lead</span>}
                    {failures > 0 && (
                      <button
                        type="button"
                        onClick={() => onFailureClick?.(participant.agent_id, null)}
                        className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-700 inline-flex items-center gap-1 hover:bg-red-200"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {failures} failures
                      </button>
                    )}
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

        <div className="grid grid-cols-1 gap-3">
            {plan.steps.map((step, index) => {
              const state = getStepState(task, plan, step);
              const stepFailures = step.agent_id ? (failureCounts[step.agent_id] || 0) : 0;
              const stepSkillExpanded = expandedStepSkills.has(step.id);
              const visibleStepSkills = stepSkillExpanded ? step.skills : step.skills.slice(0, 2);
              const promptValue = promptDrafts[step.id] ?? step.prompt;
              return (
                <div key={step.id} className="flex items-start gap-2 min-w-0">
                  <div
                    className={`w-full rounded-lg border p-3 ${
                      state === 'active'
                        ? 'border-mc-accent bg-mc-accent/10'
                        : state === 'complete'
                          ? 'border-mc-accent-green/40 bg-mc-accent-green/10'
                          : 'border-mc-border bg-mc-bg-secondary'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] uppercase tracking-wide text-mc-text-secondary">Step {step.sequence}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded ${step.kind === 'verification' ? 'bg-blue-100 text-blue-700' : step.kind === 'queue' ? 'bg-mc-bg border border-mc-border text-mc-text-secondary' : 'bg-amber-100 text-amber-700'}`}>
                          {step.kind}
                        </span>
                        {state === 'active' && <span className="text-[11px] px-2 py-0.5 rounded bg-mc-accent text-mc-bg font-medium">active</span>}
                        {stepFailures > 0 && (
                          <button
                            type="button"
                            onClick={() => step.agent_id && onFailureClick?.(step.agent_id, null)}
                            className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-700 inline-flex items-center gap-1 hover:bg-red-200"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {stepFailures} failures
                          </button>
                        )}
                      </div>
                      <span className="text-[11px] text-mc-text-secondary">status `{step.status}`</span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-mc-text">{step.label}</div>
                    <div className="mt-1 text-xs text-mc-text-secondary">
                      {step.agent_name ? `${step.agent_name} (${step.agent_role || 'agent'})` : 'Missing capability'}
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

                    {onPromptChange && onPromptSave && (
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

                    {step.loop_target_status && (
                      <div className="mt-3 text-[11px] text-mc-text-secondary">Failure loops to `{step.loop_target_status}`</div>
                    )}
                  </div>
                  {index < plan.steps.length - 1 && <div className="text-mc-text-secondary/50 pt-4 hidden sm:block">{'->'}</div>}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
