'use client';

import { useState, useEffect } from 'react';
import { ArrowRight, Folder, CheckSquare, Trash2, AlertTriangle, Pencil, GitBranch, Search, Loader2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { WorkspaceStats } from '@/lib/types';

export function WorkspaceDashboard() {
  const [workspaces, setWorkspaces] = useState<WorkspaceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCloneModal, setShowCloneModal] = useState(false);
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
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">All Workspaces</h2>
          <p className="text-mc-text-secondary">
            Select a workspace to view its mission queue and agents
          </p>
        </div>

        {workspaces.length === 0 ? (
          <div className="text-center py-16">
            <GitBranch className="w-16 h-16 mx-auto text-mc-text-secondary mb-4" />
            <h3 className="text-lg font-medium mb-2">No repositories yet</h3>
            <p className="text-mc-text-secondary mb-6">
              Clone a GitHub repo to get started
            </p>
            <button
              onClick={() => setShowCloneModal(true)}
              className="px-6 py-3 bg-mc-accent text-white rounded-lg font-medium hover:bg-mc-accent/90"
            >
              Clone Repository
            </button>
          </div>
        ) : (
          <>
            {(() => {
              const grouped = workspaces.reduce<Record<string, WorkspaceStats[]>>((acc, ws) => {
                const org = ws.organization || 'Other';
                if (!acc[org]) acc[org] = [];
                acc[org].push(ws);
                return acc;
              }, {});

              const orgOrder = Object.keys(grouped).sort((a, b) => {
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

            <button
              onClick={() => setShowCloneModal(true)}
              className="border-2 border-dashed border-mc-border rounded-xl p-6 hover:border-mc-accent/50 transition-colors flex flex-col items-center justify-center gap-3 min-h-[120px] w-full max-w-sm mx-auto mt-6"
            >
              <div className="w-10 h-10 rounded-full bg-mc-bg-tertiary flex items-center justify-center">
                <GitBranch className="w-5 h-5 text-mc-text-secondary" />
              </div>
              <span className="text-mc-text-secondary font-medium">Clone Repository</span>
            </button>
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <h2 className="text-lg font-semibold">Edit Workspace</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
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
              placeholder="https://github.com/org/repo"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent"
            />
          </div>

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

interface GhRepoItem {
  name: string;
  fullName: string;
  description: string | null;
  cloned: boolean;
}

function CloneRepoModal({ onClose, onCloned }: { onClose: () => void; onCloned: () => void }) {
  const [org, setOrg] = useState('Blockether');
  const [repos, setRepos] = useState<GhRepoItem[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [filter, setFilter] = useState('');
  const [cloning, setCloning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        // Update the list to mark as cloned
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

  const filtered = repos.filter((r) =>
    r.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div className="bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-xl w-full max-w-lg pb-[env(safe-area-inset-bottom)] sm:pb-0 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-mc-border flex-shrink-0">
          <h2 className="text-lg font-semibold">Clone Repository</h2>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="GitHub org"
              className="w-32 bg-mc-bg border border-mc-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-mc-accent"
            />
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
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
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
