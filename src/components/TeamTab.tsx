'use client';

import { useState, useEffect } from 'react';
import { Save, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useStyrmann } from '@/lib/store';
import type { WorkflowTemplate, WorkflowStage } from '@/lib/types';

interface TeamTabProps {
  taskId: string;
  workspaceId: string;
}

interface RoleAssignment {
  role: string;
  agent_id: string;
  agent_name?: string;
}

function toTitleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function compactRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (!normalized) return 'Agent';
  if (normalized.includes('orchestrator')) return 'Orchestrator';
  if (normalized.includes('product_owner') || normalized.includes('product owner') || normalized.includes('project manager')) return 'Product Owner';
  if (normalized.includes('builder')) return 'Builder';
  if (normalized.includes('tester')) return 'Tester';
  if (normalized.includes('reviewer')) return 'Reviewer';
  const firstClause = role.split(/[—-]/)[0]?.trim() || role;
  return toTitleCase(firstClause).slice(0, 24);
}

function formatAgentLabel(name: string, role: string, max = 48): string {
  const full = `${name} (${compactRole(role)})`;
  return full.length > max ? `${full.slice(0, max - 1)}…` : full;
}

const WORKFLOW_SUMMARY: Record<string, string> = {
  Simple: 'Builder implementation -> reviewer quality pass -> human acceptance merge.',
  Standard: 'Builder implementation -> tester validation -> reviewer quality pass -> human acceptance merge.',
  Strict: 'Builder -> tester -> reviewer verification -> reviewer final review -> human acceptance merge for critical work.',
};
function getWorkflowLabel(name: string): string {
  return name;
}


export function TeamTab({ taskId, workspaceId }: TeamTabProps) {
  const { agents } = useStyrmann();
  const [roles, setRoles] = useState<RoleAssignment[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('');
  const [assigneeType, setAssigneeType] = useState<'ai' | 'human'>('ai');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load existing roles and workflows
  useEffect(() => {
    const load = async () => {
      try {
        const [rolesRes, workflowsRes, taskRes] = await Promise.all([
          fetch(`/api/tasks/${taskId}/roles`),
          fetch(`/api/workspaces/${workspaceId}/workflows`),
          fetch(`/api/tasks/${taskId}`),
        ]);

        if (rolesRes.ok) {
          const data = await rolesRes.json();
          setRoles(data.map((r: RoleAssignment & { agent_name: string }) => ({
            role: r.role,
            agent_id: r.agent_id,
            agent_name: r.agent_name,
          })));
        }

        if (workflowsRes.ok) {
          const data = await workflowsRes.json();
          setWorkflows(data);
        }

        if (taskRes.ok) {
          const task = await taskRes.json();
          setSelectedWorkflow(task.workflow_template_id || '');
          setAssigneeType(task.assignee_type || 'ai');
        }
      } catch (err) {
        console.error('Failed to load team data:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [taskId, workspaceId]);

  const currentWorkflow = workflows.find(w => w.id === selectedWorkflow);
  const requiredRoles = currentWorkflow
    ? currentWorkflow.stages.filter((s: WorkflowStage) => s.role).map((s: WorkflowStage) => s.role as string)
    : [];

  // Unique roles (remove duplicates)
  const uniqueRoles = Array.from(new Set(requiredRoles));
  const isTemplateLocked = Boolean(currentWorkflow);

  const handleWorkflowChange = async (templateId: string) => {
    setSelectedWorkflow(templateId);
    setError(null);

    // Update task's workflow_template_id
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_template_id: templateId || null }),
      });
    } catch {
      // Best-effort
    }

    const wf = workflows.find(w => w.id === templateId);
    if (wf) {
      const wfRoles = Array.from(new Set(
        wf.stages.filter((s: WorkflowStage) => s.role).map((s: WorkflowStage) => s.role as string)
      ));
      const roleMap = new Map(roles.map((r) => [r.role, r]));
      const nextRoles = wfRoles.map((role) => {
        const existing = roleMap.get(role);
        return {
          role,
          agent_id: existing?.agent_id || '',
          agent_name: existing?.agent_name,
        };
      });
      setRoles(nextRoles);
    }
  };

  const handleRoleAgentChange = (role: string, agentId: string) => {
    setRoles(prev => {
      const existing = prev.find(r => r.role === role);
      if (existing) {
        return prev.map(r => r.role === role ? { ...r, agent_id: agentId } : r);
      }
      return [...prev, { role, agent_id: agentId }];
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const validRoles = roles.filter((r) => {
        if (!r.role || !r.agent_id) return false;
        if (isTemplateLocked) return uniqueRoles.includes(r.role);
        return true;
      });
      const res = await fetch(`/api/tasks/${taskId}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: validRoles }),
      });

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save roles');
      }
    } catch (err) {
      setError('Failed to save roles');
    } finally {
      setSaving(false);
    }
  };

  const addCustomRole = () => {
    setRoles(prev => [...prev, { role: '', agent_id: '' }]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-5 h-5 text-mc-text-secondary animate-spin" />
      </div>
    );
  }

  const missingRoles = uniqueRoles.filter(role =>
    !roles.find(r => r.role === role && r.agent_id)
  );
  const visibleRoles = isTemplateLocked
    ? uniqueRoles
    : roles.map((r) => r.role).filter(Boolean);

  return (
    <div data-component="src/components/TeamTab" className="space-y-6">
      {assigneeType === 'human' && (
        <div className="p-3 bg-mc-bg rounded-lg border border-mc-border text-sm text-mc-text-secondary">
          This task is assigned to a human. Workflow role mapping is inactive until you switch the assignee type back to AI.
        </div>
      )}
      {/* Workflow Template Selector */}
      <div>
        <label className="block text-sm font-medium mb-2">Workflow Template</label>
        <select
          value={selectedWorkflow}
          onChange={(e) => handleWorkflowChange(e.target.value)}
          disabled={assigneeType === 'human'}
          className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent min-w-0"
        >
            <option value="">No workflow (single agent)</option>
          {workflows.map(wf => (
            <option key={wf.id} value={wf.id}>
              {getWorkflowLabel(wf.name)}{wf.is_default ? ' (Default)' : ''}
            </option>
          ))}
      </select>

          {currentWorkflow && (
        <p className="mt-1.5 text-xs text-mc-text-secondary break-words">
          {WORKFLOW_SUMMARY[currentWorkflow.name] || currentWorkflow.description}
        </p>
      )}
      </div>

      {/* Workflow Stages Visualization */}
      {currentWorkflow && (
        <div>
          <label className="block text-sm font-medium mb-2">Stages</label>
          <div className="flex items-center gap-1 overflow-x-auto pb-1 max-w-full">
            {currentWorkflow.stages.map((stage: WorkflowStage, i: number) => (
              <div key={stage.id} className="flex items-center gap-1 flex-shrink-0">
                <div className={`px-3 py-1.5 rounded-full text-xs font-medium max-w-[120px] sm:max-w-none truncate ${
                  stage.role
                    ? 'bg-mc-accent/10 border border-mc-accent/30 text-mc-accent'
                    : 'bg-mc-bg-tertiary border border-mc-border text-mc-text-secondary'
                }`}>
                  <span className="truncate">{stage.label}</span>
                  {stage.role && <span className="ml-1 opacity-60">({stage.role})</span>}
                </div>
                {i < currentWorkflow.stages.length - 1 && (
                  <span className="text-mc-text-secondary/40 text-xs flex-shrink-0">→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing Roles Warning */}
      {missingRoles.length > 0 && (
        <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-orange-300 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-orange-200 break-words">
                Missing agents for: {missingRoles.join(', ')}
              </p>
              <p className="text-xs text-orange-300/70 mt-1">
                Assign agents below so the workflow can auto-handoff at each stage.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Role Assignments */}
      <div>
        <label className="block text-sm font-medium mb-2">Role Assignments</label>
        <div className="space-y-3">
          {visibleRoles.map(role => {
            if (!role) return null;
            const assignment = roles.find(r => r.role === role);
            return (
              <div key={role} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
                <div className="sm:w-24 text-xs font-medium text-mc-text-secondary capitalize flex-shrink-0">
                  {role}
                </div>
                <select
                  value={assignment?.agent_id || ''}
                  onChange={(e) => handleRoleAgentChange(role, e.target.value)}
                  disabled={assigneeType === 'human'}
                  className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent min-w-0"
                >
                  <option value="">Unassigned</option>
                  {agents.map(agent => (
                    <option key={agent.id} value={agent.id}>
                      {formatAgentLabel(agent.name, agent.role)}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

          {!isTemplateLocked && roles.filter(r => !uniqueRoles.includes(r.role) && r.role).map((r, i) => (
            <div key={`custom-${i}`} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
              <input
                value={r.role}
                onChange={(e) => {
                  setRoles(prev => prev.map((pr, pi) =>
                    pi === roles.indexOf(r) ? { ...pr, role: e.target.value } : pr
                  ));
                }}
                placeholder="Role name"
                className="sm:w-24 bg-mc-bg border border-mc-border rounded px-2 py-2 text-xs focus:outline-none focus:border-mc-accent"
              />
              <select
                value={r.agent_id}
                onChange={(e) => handleRoleAgentChange(r.role, e.target.value)}
                disabled={assigneeType === 'human'}
                className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent min-w-0"
              >
                <option value="">Unassigned</option>
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {formatAgentLabel(agent.name, agent.role)}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {!isTemplateLocked && (
            <button
              onClick={addCustomRole}
              disabled={assigneeType === 'human'}
              className="text-xs text-mc-accent hover:text-mc-accent/80"
            >
              + Add custom role
            </button>
          )}
        </div>
      </div>

      {/* Error / Success */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-400 break-words">{error}</p>
        </div>
      )}

      {saved && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
          <p className="text-sm text-green-400">Team saved successfully</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end pt-4 border-t border-mc-border gap-2 sm:gap-0">
        <button
          onClick={handleSave}
          disabled={saving || assigneeType === 'human'}
          className="min-h-11 flex items-center justify-center gap-2 px-4 py-2 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Team'}
        </button>
      </div>
    </div>
  );
}
