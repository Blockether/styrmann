'use client';

import { Bot, Brain, GitBranch, RotateCcw } from 'lucide-react';
import type { Task, TaskWorkflowPlan, WorkflowPlanStep } from '@/lib/types';

interface WorkflowPlanDiagramProps {
  task: Pick<Task, 'status' | 'assigned_agent_id' | 'title'>;
  plan: TaskWorkflowPlan;
  regenerating?: boolean;
  onRegenerate?: () => void;
}

function getStepState(task: Pick<Task, 'status'>, plan: TaskWorkflowPlan, step: WorkflowPlanStep): 'active' | 'complete' | 'pending' {
  const currentIndex = plan.steps.findIndex((item) => item.status === task.status);
  const stepIndex = plan.steps.findIndex((item) => item.id === step.id);
  if (step.status === task.status) return 'active';
  if (currentIndex >= 0 && stepIndex >= 0 && stepIndex < currentIndex) return 'complete';
  return 'pending';
}

export function WorkflowPlanDiagram({ task, plan, regenerating = false, onRegenerate }: WorkflowPlanDiagramProps) {
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

      <div className="p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {plan.participants.map((participant) => {
            const isActiveAgent = task.assigned_agent_id === participant.agent_id;
            return (
              <div
                key={participant.agent_id}
                className={`rounded-lg border px-3 py-2 text-xs min-w-[180px] ${isActiveAgent ? 'border-mc-accent bg-mc-accent/10' : 'border-mc-border bg-mc-bg-secondary'}`}
              >
                <div className="flex items-center gap-2 font-medium text-mc-text">
                  {participant.planner ? <Brain className="w-3.5 h-3.5 text-mc-accent" /> : <Bot className="w-3.5 h-3.5 text-mc-text-secondary" />}
                  <span>{participant.agent_name}</span>
                </div>
                <div className="mt-1 text-mc-text-secondary">{participant.agent_role}{isActiveAgent ? ' - active now' : participant.planner ? ' - planning lead' : ''}</div>
                {participant.skills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {participant.skills.map((skill) => (
                      <span key={`p-${participant.agent_id}-${skill}`} className="px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border text-[10px]">
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <div className="flex items-stretch gap-2 min-w-max">
            {plan.steps.map((step, index) => {
              const state = getStepState(task, plan, step);
              return (
                <div key={step.id} className="flex items-center gap-2">
                  <div
                    className={`w-56 rounded-lg border p-3 ${
                      state === 'active'
                        ? 'border-mc-accent bg-mc-accent/10'
                        : state === 'complete'
                          ? 'border-mc-accent-green/40 bg-mc-accent-green/10'
                          : 'border-mc-border bg-mc-bg-secondary'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-wide text-mc-text-secondary">Step {step.sequence}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded ${step.kind === 'verification' ? 'bg-blue-100 text-blue-700' : step.kind === 'queue' ? 'bg-mc-bg border border-mc-border text-mc-text-secondary' : 'bg-amber-100 text-amber-700'}`}>
                        {step.kind}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-mc-text">{step.label}</div>
                    <div className="mt-1 text-xs text-mc-text-secondary">{step.role || 'Queue'} · status `{step.status}`</div>
                    <div className="mt-2 text-xs text-mc-text-secondary">
                      {step.agent_name ? `${step.agent_name} (${step.agent_role || 'agent'})` : 'Missing capability'}
                    </div>
                    {step.skills.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {step.skills.map((skill) => (
                          <span key={`s-${step.id}-${skill}`} className="px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border text-[10px]">
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                    {step.loop_target_status && (
                      <div className="mt-3 text-[11px] text-mc-text-secondary">Failure loops to `{step.loop_target_status}`</div>
                    )}
                    {state === 'active' && (
                      <div className="mt-3 text-[11px] font-medium text-mc-accent">Current execution step for {task.title}</div>
                    )}
                  </div>
                  {index < plan.steps.length - 1 && <div className="text-mc-text-secondary/50">{'->'}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
