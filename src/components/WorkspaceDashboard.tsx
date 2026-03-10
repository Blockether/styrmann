'use client';

import { useState, useEffect } from 'react';
import { ArrowRight, Folder, CheckSquare, Trash2, AlertTriangle, Pencil, GitBranch, Search, Loader2, ExternalLink, GitFork, ChevronDown, User, Building2, Plus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { WorkspaceStats } from '@/lib/types';

export function WorkspaceDashboard() {
  const [workspaces, setWorkspaces] = useState<WorkspaceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<WorkspaceStats | null>(null);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const res = await fetch('/api/workspaces?stats=true');
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data);
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="flex flex-col items-center">
          <Image src="/logo.png" alt="Blockether" width={40} height={40} priority className="mb-4 animate-pulse rounded" />
          <p className="text-mc-text-secondary">Loading workspaces...</p>
        </div>
      </div>
    );
  }

  return (
    <div data-component="src/components/WorkspaceDashboard" className="min-h-screen bg-mc-bg">

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold mb-1">Repositories</h2>
            <p className="text-mc-text-secondary text-sm">
              System and project repositories live here. Open a repository to view its mission queue and agents.
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setShowCreateWorkspaceModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-mc-bg-secondary border border-mc-border rounded-lg text-sm font-medium hover:bg-mc-bg-tertiary flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Create Repository</span>
            </button>
            <button
              onClick={() => setShowCloneModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-mc-accent text-white rounded-lg text-sm font-medium hover:bg-mc-accent/90 flex-shrink-0"
            >
              <GitBranch className="w-4 h-4" />
              <span className="hidden sm:inline">Clone Repository</span>
            </button>
          </div>
        </div>

        {workspaces.length === 0 ? (
          <div className="text-center py-16">
            <GitBranch className="w-16 h-16 mx-auto text-mc-text-secondary mb-4" />
            <h3 className="text-lg font-medium mb-2">No repositories yet</h3>
            <p className="text-mc-text-secondary mb-6">
              Create a local repository or clone a GitHub repo to get started
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                onClick={() => setShowCreateWorkspaceModal(true)}
                className="px-6 py-3 border border-mc-border rounded-lg font-medium hover:bg-mc-bg-tertiary"
              >
                Create local repository
              </button>
              <button
                onClick={() => setShowCloneModal(true)}
                className="px-6 py-3 bg-mc-accent text-white rounded-lg font-medium hover:bg-mc-accent/90"
              >
                Clone your first repository
              </button>
            </div>
          </div>
        ) : (
          <>
            {(() => {
              const grouped = workspaces.reduce<Record<string, WorkspaceStats[]>>((acc, ws) => {
                const org = ws.is_internal ? 'System' : (ws.organization || 'Other');
                if (!acc[org]) acc[org] = [];
                acc[org].push(ws);
                return acc;
              }, {});

              const orgOrder = Object.keys(grouped).sort((a, b) => {
                if (a === 'System') return -1;
                if (b === 'System') return 1;
                if (a === 'Other') return 1;
                if (b === 'Other') return -1;
                return a.localeCompare(b);
              });

              return orgOrder.map((org) => (
                <div key={org} className="mb-10">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-mc-text-secondary border-l-2 border-mc-accent pl-3 mb-4">
                    {org}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {grouped[org].map((workspace) => (
                      <WorkspaceCard
                        key={workspace.id}
                        workspace={workspace}
                        onDelete={(id) => setWorkspaces(workspaces.filter(w => w.id !== id))}
                        onEdit={(ws) => setEditingWorkspace(ws)}
                      />
                    ))}
                  </div>
                </div>
              ));
            })()}

          </>
        )}
      </main>

      {showCloneModal && (
        <CloneRepoModal
          onClose={() => setShowCloneModal(false)}
          onCloned={() => {
            setShowCloneModal(false);
            loadWorkspaces();
          }}
        />
      )}

      {showCreateWorkspaceModal && (
        <CreateWorkspaceModal
          onClose={() => setShowCreateWorkspaceModal(false)}
          onCreated={() => {
            setShowCreateWorkspaceModal(false);
            loadWorkspaces();
          }}
        />
      )}

      {editingWorkspace && (
        <EditWorkspaceModal
          workspace={editingWorkspace}
          onClose={() => setEditingWorkspace(null)}
          onSaved={() => {
            setEditingWorkspace(null);
            loadWorkspaces();
          }}
        />
      )}
    </div>
  );
}

function WorkspaceCard({ workspace, onDelete, onEdit }: { workspace: WorkspaceStats; onDelete: (id: string) => void; onEdit: (workspace: WorkspaceStats) => void }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, { method: 'DELETE' });
      if (res.ok) {
        onDelete(workspace.id);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete workspace');
      }
    } catch {
      alert('Failed to delete workspace');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };
  
  return (
    <>
    <Link href={`/workspace/${workspace.slug}`}>
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4 sm:p-5 hover:border-mc-accent/50 transition-all hover:shadow-lg cursor-pointer group">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {workspace.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={workspace.logo_url} alt={workspace.name} className="w-7 h-7 rounded object-contain flex-shrink-0" />
            ) : (
              <Folder className="w-7 h-7 text-mc-accent flex-shrink-0" />
            )}
            <h3 className="font-semibold text-lg group-hover:text-mc-accent transition-colors truncate">
              {workspace.name}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            {workspace.id !== 'default' && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                className="p-1.5 rounded hover:bg-mc-accent-red/20 text-mc-text-secondary hover:text-mc-accent-red transition-colors"
                title="Delete workspace"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit(workspace);
              }}
              className="p-1.5 rounded hover:bg-mc-accent/20 text-mc-text-secondary hover:text-mc-accent transition-colors"
              title="Edit workspace"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <ArrowRight className="w-5 h-5 text-mc-text-secondary group-hover:text-mc-accent transition-colors" />
          </div>
        </div>

        {workspace.description && (
          <p className="text-xs text-mc-text-secondary line-clamp-2 mb-3">{workspace.description}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap mb-3">
          {workspace.is_internal ? (
            <div className="inline-flex items-center rounded border border-mc-accent bg-mc-accent/10 px-2 py-0.5 text-[11px] text-mc-accent font-medium">
              System / OpenClaw repository
            </div>
          ) : !workspace.github_repo ? (
            <div className="inline-flex items-center rounded border border-mc-border bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text-secondary">
              Local repository
            </div>
          ) : (
            <div className="inline-flex items-center rounded border border-mc-border bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text-secondary">
              GitHub linked
            </div>
          )}
          {workspace.is_internal ? (
            <div className="inline-flex items-center rounded border border-mc-border bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text-secondary">
              Internal
            </div>
          ) : null}
        </div>

        {workspace.local_path && (
          <div className="text-[11px] text-mc-text-secondary mb-3 font-mono truncate">
            {workspace.local_path}
          </div>
        )}

        <div className="flex items-center gap-1 text-sm text-mc-text-secondary">
          <CheckSquare className="w-3.5 h-3.5" />
          <span>{workspace.taskCounts.total} tasks</span>
        </div>
      </div>
    </Link>

    {/* Delete Confirmation Modal */}
    {showDeleteConfirm && (
      <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-3 sm:p-4" onClick={() => setShowDeleteConfirm(false)}>
        <div className="bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-xl w-full max-w-md p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-mc-accent-red/20 rounded-full">
              <AlertTriangle className="w-6 h-6 text-mc-accent-red" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Delete Workspace</h3>
              <p className="text-sm text-mc-text-secondary">This action cannot be undone</p>
            </div>
          </div>
          
          <p className="text-mc-text-secondary mb-6">
            Are you sure you want to delete <strong>{workspace.name}</strong>? 
            {workspace.taskCounts.total > 0 && (
              <span className="block mt-2 text-mc-accent-red">
                Warning: This workspace has {workspace.taskCounts.total} task(s). Delete them first.
              </span>
            )}
          </p>
          
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 text-mc-text-secondary hover:text-mc-text"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting || workspace.taskCounts.total > 0}
              className="px-4 py-2 bg-mc-accent-red text-white rounded-lg font-medium hover:bg-mc-accent-red/90 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete Workspace'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function EditWorkspaceModal({ workspace, onClose, onSaved }: { workspace: WorkspaceStats; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(workspace.name);
  const [logoUrl, setLogoUrl] = useState(workspace.logo_url || '');
  const [githubRepo, setGithubRepo] = useState(workspace.github_repo || '');
  const [ownerEmail, setOwnerEmail] = useState(workspace.owner_email || '');
  const [coordinatorEmail, setCoordinatorEmail] = useState(workspace.coordinator_email || '');
  const [himalayaAccount, setHimalayaAccount] = useState(workspace.himalaya_account || '');
  const [availableHimalayaAccounts, setAvailableHimalayaAccounts] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/system/himalaya')
      .then((res) => res.json())
      .then((data) => {
        const accountNames = Array.isArray(data.accounts) ? data.accounts.map((account: { name: string }) => account.name) : [];
        setAvailableHimalayaAccounts(accountNames);
        if (!workspace.himalaya_account && data.default_account) {
          setHimalayaAccount(data.default_account);
        }
      })
      .catch(() => {});
  }, [workspace.himalaya_account]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          logo_url: logoUrl.trim() || null,
          github_repo: githubRepo.trim() || null,
          owner_email: ownerEmail.trim() || null,
          coordinator_email: coordinatorEmail.trim() || null,
          himalaya_account: himalayaAccount.trim() || null,
        }),
      });

      if (res.ok) {
        onSaved();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update workspace');
      }
    } catch {
      setError('Failed to update workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div className="bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-xl w-full max-w-md pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-mc-border">
          <h2 className="text-lg font-semibold">Edit Repository</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {workspace.is_internal ? (
            <div className="rounded-lg border border-mc-accent bg-mc-accent/10 px-3 py-2 text-sm text-mc-text-secondary">
              This is the internal OpenClaw meta repository. GitHub linking is disabled here.
            </div>
          ) : null}

          <div>
            <label className="block text-sm font-medium mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Logo URL</label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="/workspace-logos/mission-control.png"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">GitHub Repository</label>
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              disabled={Boolean(workspace.is_internal)}
              placeholder="https://github.com/org/repo"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {workspace.local_path ? (
            <div>
              <label className="block text-sm font-medium mb-2">Repository Path</label>
              <input
                type="text"
                value={workspace.local_path}
                readOnly
                className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 text-mc-text-secondary font-mono"
              />
            </div>
          ) : null}

          <div>
            <label className="block text-sm font-medium mb-2">Owner Email</label>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@company.com"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Coordinator Email</label>
            <input
              type="email"
              value={coordinatorEmail}
              onChange={(e) => setCoordinatorEmail(e.target.value)}
              placeholder="coordinator@company.com"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Himalaya Sender Account</label>
            <select
              value={himalayaAccount}
              onChange={(e) => setHimalayaAccount(e.target.value)}
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent"
            >
              <option value="">Use Himalaya default account</option>
              {availableHimalayaAccounts.map((account) => (
                <option key={account} value={account}>{account}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-mc-text-secondary">
              This account is used when Mission Control sends human task-assignment emails via Himalaya.
            </p>
          </div>

          {error && (
            <div className="text-mc-accent-red text-sm">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-mc-text-secondary hover:text-mc-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="px-6 py-2 bg-mc-accent text-white rounded-lg font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          github_repo: null,
        }),
      });

      if (res.ok) {
        onCreated();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to create workspace');
      }
    } catch {
      setError('Failed to create workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div className="bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-xl w-full max-w-md pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-mc-border">
          <h2 className="text-lg font-semibold">Create Repository</h2>
          <p className="text-xs text-mc-text-secondary mt-1">No GitHub repository required. You can connect or back up later.</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Repository Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Client Dashboard"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this repository is for"
              rows={3}
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent resize-y"
            />
          </div>

          {error && <div className="text-mc-accent-red text-sm">{error}</div>}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-mc-text-secondary hover:text-mc-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="px-6 py-2 bg-mc-accent text-white rounded-lg font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Repository'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface GhRepoItem {
  name: string;
  fullName: string;
  description: string | null;
  cloned: boolean;
}

interface GhAccount {
  login: string;
  type: 'user' | 'org';
}

function CloneRepoModal({ onClose, onCloned }: { onClose: () => void; onCloned: () => void }) {
  const [tab, setTab] = useState<'browse' | 'fork'>('browse');
  const [accounts, setAccounts] = useState<GhAccount[]>([]);
  const [org, setOrg] = useState('');
  const [repos, setRepos] = useState<GhRepoItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [filter, setFilter] = useState('');
  const [cloning, setCloning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fork tab state
  const [forkUrl, setForkUrl] = useState('');
  const [forkTargetOrg, setForkTargetOrg] = useState('');
  const [forking, setForking] = useState(false);
  const [forkSuccess, setForkSuccess] = useState<string | null>(null);

  // Fetch GitHub accounts on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/github/orgs')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          setAccounts(data);
          // Default to first org, or first account
          const defaultOrg = data.find((a: GhAccount) => a.type === 'org') || data[0];
          if (defaultOrg) {
            setOrg(defaultOrg.login);
            setForkTargetOrg(defaultOrg.login);
          }
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingAccounts(false));
    return () => { cancelled = true; };
  }, []);

  // Fetch repos when org changes
  useEffect(() => {
    if (!org.trim()) return;
    let cancelled = false;
    setLoadingRepos(true);
    setError(null);

    fetch(`/api/github/repos?org=${encodeURIComponent(org.trim())}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          setRepos(data);
        } else {
          setError(data.error || 'Failed to load repos');
        }
      })
      .catch(() => !cancelled && setError('Failed to fetch repos'))
      .finally(() => !cancelled && setLoadingRepos(false));

    return () => { cancelled = true; };
  }, [org]);

  const handleClone = async (fullName: string) => {
    setCloning(fullName);
    setError(null);

    try {
      const res = await fetch('/api/workspaces/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: fullName }),
      });
      const data = await res.json();

      if (res.ok) {
        setRepos((prev) => prev.map((r) => r.fullName === fullName ? { ...r, cloned: true } : r));
        onCloned();
      } else {
        setError(data.error || 'Clone failed');
      }
    } catch {
      setError('Clone failed');
    } finally {
      setCloning(null);
    }
  };

  const handleForkAndClone = async () => {
    if (!forkUrl.trim()) return;
    setForking(true);
    setError(null);
    setForkSuccess(null);

    try {
      const res = await fetch('/api/workspaces/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fork_from: forkUrl.trim(),
          target_org: forkTargetOrg || undefined,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setForkSuccess(data.message || 'Fork and clone successful');
        setForkUrl('');
        onCloned();
      } else {
        setError(data.error || 'Fork failed');
      }
    } catch {
      setError('Fork failed');
    } finally {
      setForking(false);
    }
  };

  const filtered = repos.filter((r) =>
    r.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div className="bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-xl w-full max-w-lg pb-[env(safe-area-inset-bottom)] sm:pb-0 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-mc-border flex-shrink-0">
          <h2 className="text-lg font-semibold">Clone Repository</h2>

          {/* Tab switcher */}
          <div className="mt-3 flex gap-1 bg-mc-bg rounded-lg p-0.5 border border-mc-border">
            <button
              onClick={() => { setTab('browse'); setError(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'browse' ? 'bg-mc-bg-secondary text-mc-text shadow-sm' : 'text-mc-text-secondary hover:text-mc-text'}`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Browse Repos</span>
            </button>
            <button
              onClick={() => { setTab('fork'); setError(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'fork' ? 'bg-mc-bg-secondary text-mc-text shadow-sm' : 'text-mc-text-secondary hover:text-mc-text'}`}
            >
              <GitFork className="w-3.5 h-3.5" />
              <span>Fork from URL</span>
            </button>
          </div>

          {/* Browse tab controls */}
          {tab === 'browse' && (
            <div className="mt-3 flex gap-2 items-center">
              <div className="relative flex-shrink-0">
                {accounts.find((a) => a.login === org)?.type === 'user'
                  ? <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mc-text-secondary pointer-events-none" />
                  : <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mc-text-secondary pointer-events-none" />}
                <select
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  disabled={loadingAccounts}
                  className="appearance-none bg-mc-bg border border-mc-border rounded-lg pl-8 pr-7 py-1.5 text-sm focus:outline-none focus:border-mc-accent cursor-pointer"
                >
                  {loadingAccounts && <option>Loading...</option>}
                  {accounts.map((a) => (
                    <option key={a.login} value={a.login}>{a.login}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mc-text-secondary pointer-events-none" />
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mc-text-secondary" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter repos..."
                  className="w-full bg-mc-bg border border-mc-border rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:border-mc-accent"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === 'browse' && (
            <>
              {loadingRepos ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-mc-text-secondary" />
                  <span className="ml-2 text-sm text-mc-text-secondary">Loading repos...</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-sm text-mc-text-secondary">
                  {repos.length === 0 ? 'No repos found' : 'No matches'}
                </div>
              ) : (
                <div className="divide-y divide-mc-border">
                  {filtered.map((repo) => (
                    <div
                      key={repo.fullName}
                      className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-mc-bg-tertiary/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{repo.name}</div>
                        {repo.description && (
                          <p className="text-xs text-mc-text-secondary truncate mt-0.5">{repo.description}</p>
                        )}
                      </div>
                      {repo.cloned ? (
                        <span className="text-xs text-mc-text-secondary bg-mc-bg-tertiary px-2 py-1 rounded flex-shrink-0">
                          Cloned
                        </span>
                      ) : (
                        <button
                          onClick={() => handleClone(repo.fullName)}
                          disabled={cloning !== null}
                          className="text-xs font-medium text-mc-accent hover:text-mc-accent/80 bg-mc-accent/10 hover:bg-mc-accent/20 px-3 py-1 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                        >
                          {cloning === repo.fullName ? 'Cloning...' : 'Clone'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'fork' && (
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Repository URL</label>
                <div className="relative">
                  <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mc-text-secondary" />
                  <input
                    type="text"
                    value={forkUrl}
                    onChange={(e) => { setForkUrl(e.target.value); setForkSuccess(null); }}
                    placeholder="https://github.com/owner/repo or owner/repo"
                    className="w-full bg-mc-bg border border-mc-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-mc-accent font-mono"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-mc-text-secondary mt-1">Paste a GitHub URL or owner/repo to fork it into your account</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Fork into</label>
                <div className="relative">
                  <select
                    value={forkTargetOrg}
                    onChange={(e) => setForkTargetOrg(e.target.value)}
                    disabled={loadingAccounts}
                    className="appearance-none w-full bg-mc-bg border border-mc-border rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-mc-accent cursor-pointer"
                  >
                    {accounts.map((a) => (
                      <option key={a.login} value={a.login}>
                        {a.login} {a.type === 'user' ? '(personal)' : '(org)'}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mc-text-secondary pointer-events-none" />
                </div>
              </div>

              <button
                onClick={handleForkAndClone}
                disabled={!forkUrl.trim() || forking}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-mc-accent text-white rounded-lg text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50 transition-colors"
              >
                {forking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Forking and cloning...
                  </>
                ) : (
                  <>
                    <GitFork className="w-4 h-4" />
                    Fork and Clone
                  </>
                )}
              </button>

              {forkSuccess && (
                <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded">
                  {forkSuccess}
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="px-5 py-2 border-t border-mc-border">
            <div className="text-mc-accent-red text-xs bg-mc-accent-red/10 px-3 py-2 rounded">{error}</div>
          </div>
        )}

        <div className="border-t border-mc-border p-4 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-mc-text-secondary hover:text-mc-text"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
