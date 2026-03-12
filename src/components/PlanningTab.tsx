'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Lightbulb, Loader2 } from 'lucide-react';
import type { CapabilityProposal, Task, TaskActivity, TaskFinding, TaskWorkflowPlan } from '@/lib/types';
import { WorkflowPlanDiagram } from './WorkflowPlanDiagram';
import { ActivityLog } from './ActivityLog';

interface PlanningTabProps {
  taskId: string;
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

interface SessionRuntimeSummary {
  active: number;
  interrupted: number;
  stale: number;
  total: number;
  currentAgentName: string | null;
}

interface SessionRuntimeRow {
  status?: string;
  is_active?: boolean;
  agent_name?: string;
}

export function PlanningTab({ taskId }: PlanningTabProps) {
  const [data, setData] = useState<WorkflowPlanResponse | null>(null);
  const [rawActivities, setRawActivities] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [savingPromptStepId, setSavingPromptStepId] = useState<string | null>(null);
  const [sessionRuntime, setSessionRuntime] = useState<SessionRuntimeSummary>({ active: 0, interrupted: 0, stale: 0, total: 0, currentAgentName: null });

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

  const loadActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/activities?limit=400`);
      const payload = await res.json() as ActivitiesResponse;
      if (!res.ok) throw new Error('Failed to load activity state');
      setRawActivities(Array.isArray(payload.raw_activities) ? payload.raw_activities : []);
    } catch {
      setRawActivities([]);
    }
  }, [taskId]);

  const loadSessionRuntime = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/sessions`);
      if (!res.ok) return;
      const rows = (await res.json()) as SessionRuntimeRow[];
      const active = rows.filter((row) => row.is_active).length;
      const interrupted = rows.filter((row) => row.status === 'interrupted').length;
      const stale = rows.filter((row) => row.status === 'stale').length;
      const currentAgentName = rows.find((row) => row.is_active)?.agent_name || null;
      setSessionRuntime({ active, interrupted, stale, total: rows.length, currentAgentName });
    } catch {
      setSessionRuntime({ active: 0, interrupted: 0, stale: 0, total: 0, currentAgentName: null });
    }
  }, [taskId]);

  useEffect(() => {
    loadPlan(true);
    loadActivities();
    loadSessionRuntime();
    const onUpdate = () => loadPlan(false);
    const onActivity = () => loadActivities();
    const onSession = () => loadSessionRuntime();
    window.addEventListener('mc:task-updated', onUpdate);
    window.addEventListener('mc:activity-logged', onActivity);
    window.addEventListener('mc:activity-presented', onActivity);
    window.addEventListener('mc:agent-updated', onSession);
    window.addEventListener('mc:agent-completed', onSession);
    return () => {
      window.removeEventListener('mc:task-updated', onUpdate);
      window.removeEventListener('mc:activity-logged', onActivity);
      window.removeEventListener('mc:activity-presented', onActivity);
      window.removeEventListener('mc:agent-updated', onSession);
      window.removeEventListener('mc:agent-completed', onSession);
    };
  }, [loadActivities, loadPlan, loadSessionRuntime]);

  const iterationsByStepStatus = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const activity of rawActivities) {
      const step = typeof activity.workflow_step === 'string' && activity.workflow_step.trim().length > 0
        ? activity.workflow_step.trim()
        : null;
      if (!step) continue;
      const message = typeof activity.message === 'string' ? activity.message : '';
      const isStageIteration = activity.activity_type === 'dispatch_invocation'
        || (activity.activity_type === 'status_changed' && message.startsWith('Stage handoff:'))
        || (activity.activity_type === 'status_changed' && message.startsWith('[Auto-Recovery]'));
      if (!isStageIteration) continue;
      totals[step] = (totals[step] || 0) + 1;
    }
    return totals;
  }, [rawActivities]);

  const currentStepStatus = data?.task.status || null;
  const canReplan = Boolean(data && ['inbox', 'planning', 'pending_dispatch'].includes(data.task.status));
  const currentStepLabel = useMemo(() => {
    if (!data) return null;
    return data.plan.steps.find((step) => step.status === data.task.status)?.label || null;
  }, [data]);
  const currentStepIterations = currentStepStatus ? (iterationsByStepStatus[currentStepStatus] || 0) : 0;

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/workflow-plan`, { method: 'POST' });
      const payload = await res.json() as WorkflowPlanResponse;
      if (!res.ok) throw new Error((payload as { error?: string }).error || 'Failed to regenerate workflow plan');
      setData(payload);
      hydratePromptDrafts(payload);
      setError(null);
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
        <span className="ml-2 text-mc-text-secondary">Loading orchestration control room...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div data-component="src/components/PlanningTab" className="p-2 sm:p-4 space-y-4">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <span>{error || 'Workflow plan unavailable. Runtime activity remains available below.'}</span>
        </div>
        <ActivityLog taskId={taskId} />
      </div>
    );
  }

  return (
    <div data-component="src/components/PlanningTab" className="p-2 sm:p-4 space-y-4">
      {!canReplan && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
          Replanning is locked because execution already started. Current status: {data.task.status.replace(/_/g, ' ')}.
        </div>
      )}

      <WorkflowPlanDiagram
        task={data.task}
        plan={data.plan}
        currentStepStatus={currentStepStatus}
        currentStepLabel={currentStepLabel}
        currentStepIterations={currentStepIterations}
        iterationsByStepStatus={iterationsByStepStatus}
        sessionRuntime={sessionRuntime}
        currentRuntimeAgentName={sessionRuntime.currentAgentName}
        regenerating={regenerating}
        onRegenerate={canReplan ? regenerate : undefined}
        promptDrafts={promptDrafts}
        onPromptChange={(stepId, value) => setPromptDrafts((prev) => ({ ...prev, [stepId]: value }))}
        onPromptSave={canReplan ? savePrompt : undefined}
        savingPromptStepId={savingPromptStepId}
        canEditPlan={canReplan}
      />

      <ActivityLog taskId={taskId} />

      {data.findings.length > 0 && (
        <div className="overflow-hidden rounded-[1.1rem] border border-mc-border bg-white/75 shadow-[0_16px_36px_-34px_rgba(0,0,0,0.25)]">
          <div className="border-b border-mc-border bg-mc-bg-secondary/70 p-3 text-sm font-medium">Capability Findings</div>
          <div className="p-4 space-y-3">
            {data.findings.map((finding) => (
              <div key={finding.id} className="rounded-2xl border border-mc-border bg-gradient-to-br from-mc-bg-secondary via-mc-bg to-mc-bg p-3">
                <div className="text-sm font-medium text-mc-text">{finding.title}</div>
                <div className="mt-1 text-xs leading-5 text-mc-text-secondary">{finding.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.proposals.length > 0 && (
        <div className="overflow-hidden rounded-[1.1rem] border border-mc-border bg-white/75 shadow-[0_16px_36px_-34px_rgba(0,0,0,0.25)]">
          <div className="border-b border-mc-border bg-mc-bg-secondary/70 p-3 text-sm font-medium">Capability Proposals</div>
          <div className="p-4 space-y-3">
            {data.proposals.map((proposal) => (
              <div key={proposal.id} className="rounded-2xl border border-mc-border bg-gradient-to-br from-mc-bg-secondary via-mc-bg to-mc-bg p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
                  <Lightbulb className="w-4 h-4 text-mc-accent" />
                  <span>{proposal.title}</span>
                </div>
                <div className="mt-1 text-xs leading-5 text-mc-text-secondary">{proposal.detail}</div>
                <div className="mt-2 text-[11px] leading-5 text-mc-text-secondary">
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
