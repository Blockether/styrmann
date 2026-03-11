'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Lightbulb, Loader2 } from 'lucide-react';
import type { CapabilityProposal, Task, TaskActivity, TaskFinding, TaskWorkflowPlan } from '@/lib/types';
import { WorkflowPlanDiagram } from './WorkflowPlanDiagram';

interface PlanningTabProps {
  taskId: string;
  onFailureClick?: (agentId: string, step: string | null) => void;
}

interface WorkflowPlanResponse {
  task: Task;
  plan: TaskWorkflowPlan;
  findings: TaskFinding[];
  proposals: CapabilityProposal[];
}

interface ActivitiesResponse {
  raw_activities: TaskActivity[];
}

export function PlanningTab({ taskId, onFailureClick }: PlanningTabProps) {
  const [data, setData] = useState<WorkflowPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [savingPromptStepId, setSavingPromptStepId] = useState<string | null>(null);
  const [failureCounts, setFailureCounts] = useState<Record<string, number>>({});

  const hydratePromptDrafts = (payload: WorkflowPlanResponse) => {
    setPromptDrafts(Object.fromEntries((payload.plan.steps || []).map((step) => [step.id, step.prompt || ''])));
  };

  const loadPlan = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/workflow-plan`);
      const payload = await res.json() as WorkflowPlanResponse;
      if (!res.ok) throw new Error((payload as { error?: string }).error || 'Failed to load workflow plan');
      setData(payload);
      hydratePromptDrafts(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow plan');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [taskId]);

  const loadFailureStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/activities?limit=200`);
      const payload = await res.json() as ActivitiesResponse;
      if (!res.ok || !Array.isArray(payload.raw_activities)) return;

      const counts: Record<string, number> = {};
      for (const activity of payload.raw_activities) {
        const details = activity.technical_details && typeof activity.technical_details === 'object'
          ? activity.technical_details as Record<string, unknown>
          : null;
        const lower = `${activity.activity_type} ${activity.message}`.toLowerCase();
        const isFailure = lower.includes('fail')
          || lower.includes('error')
          || Boolean(details?.fail_reason)
          || Boolean(details?.retry_error)
          || Boolean(details?.dispatch_error)
          || Boolean(details?.planning_dispatch_error);
        if (!isFailure || !activity.agent_id) continue;
        counts[activity.agent_id] = (counts[activity.agent_id] || 0) + 1;
      }

      setFailureCounts(counts);
    } catch {
    }
  }, [taskId]);

  useEffect(() => {
    loadPlan(true);
    loadFailureStats();
    const onUpdate = () => {
      loadPlan(false);
      loadFailureStats();
    };
    window.addEventListener('mc:task-updated', onUpdate);
    window.addEventListener('mc:activity-logged', onUpdate);
    window.addEventListener('mc:activity-presented', onUpdate);
    return () => {
      window.removeEventListener('mc:task-updated', onUpdate);
      window.removeEventListener('mc:activity-logged', onUpdate);
      window.removeEventListener('mc:activity-presented', onUpdate);
    };
  }, [loadPlan, loadFailureStats]);

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/workflow-plan`, { method: 'POST' });
      const payload = await res.json() as WorkflowPlanResponse;
      if (!res.ok) throw new Error((payload as { error?: string }).error || 'Failed to regenerate workflow plan');
      setData(payload);
      hydratePromptDrafts(payload);
      setError(null);
      await loadFailureStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate workflow plan');
    } finally {
      setRegenerating(false);
    }
  };

  const savePrompt = async (stepId: string) => {
    const prompt = promptDrafts[stepId] ?? '';
    setSavingPromptStepId(stepId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/workflow-plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_id: stepId, prompt }),
      });
      const payload = await res.json() as WorkflowPlanResponse;
      if (!res.ok) throw new Error((payload as { error?: string }).error || 'Failed to save prompt');
      setData(payload);
      hydratePromptDrafts(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save prompt');
    } finally {
      setSavingPromptStepId(null);
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
    <div data-component="src/components/PlanningTab" className="p-2 sm:p-4 space-y-4">
      <WorkflowPlanDiagram
        task={data.task}
        plan={data.plan}
        regenerating={regenerating}
        onRegenerate={regenerate}
        failureCounts={failureCounts}
        promptDrafts={promptDrafts}
        onPromptChange={(stepId, value) => setPromptDrafts((prev) => ({ ...prev, [stepId]: value }))}
        onPromptSave={savePrompt}
        savingPromptStepId={savingPromptStepId}
        onFailureClick={onFailureClick}
      />

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
