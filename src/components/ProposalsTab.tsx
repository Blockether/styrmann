'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Lightbulb, Loader2 } from 'lucide-react';
import type { CapabilityProposal, TaskFinding, TaskWorkflowPlan, Task } from '@/lib/types';

interface ProposalsTabProps {
  taskId: string;
}

interface WorkflowPlanResponse {
  task: Task;
  plan: TaskWorkflowPlan;
  findings: TaskFinding[];
  proposals: CapabilityProposal[];
}

export function ProposalsTab({ taskId }: ProposalsTabProps) {
  const [data, setData] = useState<WorkflowPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/workflow-plan`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to load proposals');
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load proposals');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div data-component="src/components/ProposalsTab" className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-mc-accent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div data-component="src/components/ProposalsTab" className="p-4">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <span>{error || 'Proposals unavailable'}</span>
        </div>
      </div>
    );
  }

  return (
    <div data-component="src/components/ProposalsTab" className="p-4 space-y-4">
      <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
        <div className="p-3 border-b border-mc-border bg-mc-bg-secondary text-sm font-medium">Findings</div>
        <div className="p-4 space-y-2">
          {data.findings.length === 0 ? (
            <div className="text-sm text-mc-text-secondary">No missing capability findings for this task.</div>
          ) : (
            data.findings.map((finding) => (
              <div key={finding.id} className="rounded border border-mc-border bg-mc-bg-secondary p-3">
                <div className="text-sm font-medium text-mc-text">{finding.title}</div>
                <div className="mt-1 text-xs text-mc-text-secondary">{finding.detail}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
        <div className="p-3 border-b border-mc-border bg-mc-bg-secondary text-sm font-medium">Learner Proposals</div>
        <div className="p-4 space-y-3">
          {data.proposals.length === 0 ? (
            <div className="text-sm text-mc-text-secondary">No proposals generated. The current agent pool and shared skills cover this workflow.</div>
          ) : (
            data.proposals.map((proposal) => (
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
