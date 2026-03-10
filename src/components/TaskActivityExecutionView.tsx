'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { Task, TaskWorkflowPlan, TaskFinding, CapabilityProposal } from '@/lib/types';
import { WorkflowPlanDiagram } from './WorkflowPlanDiagram';
import { ActivityLog } from './ActivityLog';

interface TaskActivityExecutionViewProps {
  taskId: string;
}

interface WorkflowPlanResponse {
  task: Task;
  plan: TaskWorkflowPlan;
  findings: TaskFinding[];
  proposals: CapabilityProposal[];
}

export function TaskActivityExecutionView({ taskId }: TaskActivityExecutionViewProps) {
  const [data, setData] = useState<WorkflowPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
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
    load(true);
    const interval = setInterval(() => load(false), 5000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div data-component="src/components/TaskActivityExecutionView" className="space-y-4">
      {loading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin text-mc-accent" />
        </div>
      ) : error || !data ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <span>{error || 'Workflow plan unavailable'}</span>
        </div>
      ) : (
        <WorkflowPlanDiagram task={data.task} plan={data.plan} />
      )}
      <ActivityLog taskId={taskId} />
    </div>
  );
}
