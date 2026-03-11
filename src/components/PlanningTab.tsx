'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Lightbulb, Loader2 } from 'lucide-react';
import type { CapabilityProposal, Task, TaskFinding, TaskWorkflowPlan } from '@/lib/types';
import { WorkflowPlanDiagram } from './WorkflowPlanDiagram';

interface PlanningTabProps {
  taskId: string;
}

interface WorkflowPlanResponse {
  task: Task;
  plan: TaskWorkflowPlan;
  findings: TaskFinding[];
  proposals: CapabilityProposal[];
}

export function PlanningTab({ taskId }: PlanningTabProps) {
  const [data, setData] = useState<WorkflowPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const loadPlan = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/workflow-plan`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to load workflow plan');
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow plan');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadPlan(true);
    // SSE-driven: re-fetch on task updates or new activities instead of polling
    const onUpdate = () => loadPlan(false);
    window.addEventListener('mc:task-updated', onUpdate);
    window.addEventListener('mc:activity-logged', onUpdate);
    window.addEventListener('mc:activity-presented', onUpdate);
    return () => {
      window.removeEventListener('mc:task-updated', onUpdate);
      window.removeEventListener('mc:activity-logged', onUpdate);
      window.removeEventListener('mc:activity-presented', onUpdate);
    };
  }, [loadPlan]);

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/workflow-plan`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to regenerate workflow plan');
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate workflow plan');
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div data-component="src/components/PlanningTab" className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-mc-accent" />
        <span className="ml-2 text-mc-text-secondary">Loading orchestrator workflow plan...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div data-component="src/components/PlanningTab" className="p-4">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <span>{error || 'Workflow plan unavailable'}</span>
        </div>
      </div>
    );
  }

  return (
    <div data-component="src/components/PlanningTab" className="p-4 space-y-4">
      <WorkflowPlanDiagram task={data.task} plan={data.plan} regenerating={regenerating} onRegenerate={regenerate} />

      {data.findings.length > 0 && (
        <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
          <div className="p-3 border-b border-mc-border bg-mc-bg-secondary text-sm font-medium">Capability Findings</div>
          <div className="p-4 space-y-2">
            {data.findings.map((finding) => (
              <div key={finding.id} className="rounded border border-mc-border bg-mc-bg-secondary p-3">
                <div className="text-sm font-medium text-mc-text">{finding.title}</div>
                <div className="mt-1 text-xs text-mc-text-secondary">{finding.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.proposals.length > 0 && (
        <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
          <div className="p-3 border-b border-mc-border bg-mc-bg-secondary text-sm font-medium">Learner Proposals</div>
          <div className="p-4 space-y-3">
            {data.proposals.map((proposal) => (
              <div key={proposal.id} className="rounded border border-mc-border bg-mc-bg-secondary p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
                  <Lightbulb className="w-4 h-4 text-mc-accent" />
                  <span>{proposal.title}</span>
                </div>
                <div className="mt-1 text-xs text-mc-text-secondary">{proposal.detail}</div>
                <div className="mt-2 text-[11px] text-mc-text-secondary">
                  Target: {proposal.target_name} · Meta repo: {proposal.meta_workspace_slug || 'not configured'} · Status: {proposal.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
