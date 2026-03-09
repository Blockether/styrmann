'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Save, Trash2, Folder, FileText, RefreshCw, ChevronRight } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import type { Agent, AgentStatus } from '@/lib/types';

interface AgentModalProps {
  agent?: Agent;
  onClose: () => void;
  workspaceId?: string;
  onAgentCreated?: (agentId: string) => void;
}

interface BrowserEntry {
  name: string;
  relative_path: string;
  type: 'file' | 'directory';
  is_symlink: boolean;
  size: number | null;
}

interface BrowserPayload {
  root_path: string;
  requested_path: string;
  entries: BrowserEntry[];
}

function parentPath(path: string): string {
  if (!path || path === '.') return '.';
  const parts = path.split('/').filter(Boolean);
  return parts.length <= 1 ? '.' : parts.slice(0, -1).join('/');
}

export function AgentModal({ agent, onClose, workspaceId, onAgentCreated }: AgentModalProps) {
  const { addAgent, updateAgent, agents } = useMissionControl();
  const [activeTab, setActiveTab] = useState<'info' | 'workspace' | 'soul' | 'user' | 'agents'>('info');
  const contentRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeTab]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [modelsLoading, setModelsLoading] = useState(true);
  const [workspaceBrowserPath, setWorkspaceBrowserPath] = useState('.');
  const [agentDirBrowserPath, setAgentDirBrowserPath] = useState('.');
  const [workspaceBrowser, setWorkspaceBrowser] = useState<BrowserPayload | null>(null);
  const [agentDirBrowser, setAgentDirBrowser] = useState<BrowserPayload | null>(null);
  const [skillsBrowser, setSkillsBrowser] = useState<BrowserPayload | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: agent?.name || '',
    role: agent?.role || '',
    description: agent?.description || '',
    status: agent?.status || 'standby' as AgentStatus,
    // is_master removed - orchestrator role determined by backend
    soul_md: agent?.soul_md || '',
    user_md: agent?.user_md || '',
    agents_md: agent?.agents_md || '',
    model: agent?.model || '',
  });

  // Load available models from OpenClaw config
  useEffect(() => {
    const loadModels = async () => {
      try {
        const res = await fetch('/api/openclaw/models');
        if (res.ok) {
          const data = await res.json();
          setAvailableModels(data.availableModels || []);
          setDefaultModel(data.defaultModel || '');
          // If agent has no model set, use default
          if (!agent?.model && data.defaultModel) {
            setForm(prev => ({ ...prev, model: data.defaultModel }));
          }
        }
      } catch (error) {
        console.error('Failed to load models:', error);
      } finally {
        setModelsLoading(false);
      }
    };
    loadModels();
  }, [agent]);

  useEffect(() => {
    if (activeTab !== 'workspace' || !agent?.id || agent.source !== 'synced') return;

    let cancelled = false;

    const fetchBrowser = async (scope: 'workspace' | 'agent', requestedPath: string): Promise<BrowserPayload | null> => {
      const res = await fetch(`/api/agents/${agent.id}/workspace?scope=${scope}&path=${encodeURIComponent(requestedPath)}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to load workspace browser');
      }
      return res.json();
    };

    const loadWorkspace = async () => {
      setWorkspaceLoading(true);
      setWorkspaceError(null);
      try {
        const [workspaceData, agentDirData, skillsData] = await Promise.all([
          fetchBrowser('workspace', workspaceBrowserPath),
          fetchBrowser('agent', agentDirBrowserPath),
          fetchBrowser('workspace', 'skills'),
        ]);
        if (!cancelled) {
          setWorkspaceBrowser(workspaceData);
          setAgentDirBrowser(agentDirData);
          setSkillsBrowser(skillsData);
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError(error instanceof Error ? error.message : 'Failed to load OpenClaw workspace');
        }
      } finally {
        if (!cancelled) {
          setWorkspaceLoading(false);
        }
      }
    };

    loadWorkspace().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeTab, agent?.id, agent?.source, workspaceBrowserPath, agentDirBrowserPath]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = agent ? `/api/agents/${agent.id}` : '/api/agents';
      const method = agent ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          workspace_id: workspaceId || agent?.workspace_id || 'default',
        }),
      });

      if (res.ok) {
        const savedAgent = await res.json();
        if (agent) {
          updateAgent(savedAgent);
        } else {
          addAgent(savedAgent);
          // Notify parent if callback provided (e.g., for inline agent creation)
          if (onAgentCreated) {
            onAgentCreated(savedAgent.id);
          }
        }
        onClose();
      }
    } catch (error) {
      console.error('Failed to save agent:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!agent || !confirm(`Delete ${agent.name}?`)) return;

    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
      if (res.ok) {
        // Remove from store
        useMissionControl.setState((state) => ({
          agents: state.agents.filter((a) => a.id !== agent.id),
          selectedAgent: state.selectedAgent?.id === agent.id ? null : state.selectedAgent,
        }));
        onClose();
      }
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  };

  const tabs = [
    { id: 'info', label: 'Info' },
    { id: 'workspace', label: 'Workspace' },
    { id: 'soul', label: 'SOUL.md' },
    { id: 'user', label: 'USER.md' },
    { id: 'agents', label: 'AGENTS.md' },
  ] as const;

  const renderBrowser = (
    title: string,
    browser: BrowserPayload | null,
    setPath: (path: string) => void,
    emptyMessage: string,
  ) => (
    <div className="space-y-3 rounded-lg border border-mc-border bg-mc-bg p-3">
      <div>
        <div className="text-sm font-medium text-mc-text">{title}</div>
        <div className="mt-1 font-mono text-[11px] text-mc-text-secondary break-all">{browser?.root_path || 'n/a'}</div>
      </div>

      {browser && (
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setPath(parentPath(browser.requested_path))}
            disabled={browser.requested_path === '.'}
            className="px-2 py-1 rounded border border-mc-border text-mc-text-secondary hover:text-mc-text disabled:opacity-50"
          >
            Up
          </button>
          <span className="font-mono text-mc-text-secondary break-all">{browser.requested_path}</span>
        </div>
      )}

      {browser && browser.entries.length > 0 ? (
        <div className="space-y-1">
          {browser.entries.map((entry) => (
            <button
              key={`${title}-${entry.relative_path}`}
              type="button"
              onClick={() => {
                if (entry.type === 'directory') setPath(entry.relative_path);
              }}
              className={`w-full flex items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs ${entry.type === 'directory' ? 'hover:bg-mc-bg-secondary cursor-pointer' : 'cursor-default'}`}
            >
              <div className="min-w-0 flex items-center gap-2">
                {entry.type === 'directory' ? (
                  <Folder className="w-3.5 h-3.5 text-mc-accent flex-shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-mc-text-secondary flex-shrink-0" />
                )}
                <span className="truncate text-mc-text">
                  {entry.name}
                  {entry.is_symlink ? ' [symlink]' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 text-mc-text-secondary flex-shrink-0">
                {entry.size !== null && <span>{entry.size}b</span>}
                {entry.type === 'directory' && <ChevronRight className="w-3.5 h-3.5" />}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-xs text-mc-text-secondary">{emptyMessage}</div>
      )}
    </div>
  );

  return (
    <div data-component="src/components/AgentModal" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-none md:rounded-lg w-full md:w-4/5 xl:w-3/5 h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mc-border flex-shrink-0">
          <h2 className="text-lg font-semibold">
            {agent ? `Edit ${agent.name}` : 'Create New Agent'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-mc-bg-tertiary rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-mc-border overflow-x-auto flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 min-h-11 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-mc-accent text-mc-accent'
                  : 'border-transparent text-mc-text-secondary hover:text-mc-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} ref={contentRef} className="flex-1 overflow-y-auto p-4">
          {activeTab === 'info' && (
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                  placeholder="Agent name"
                />
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  required
                  className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                  placeholder="e.g., Code & Automation"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={8}
                  className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-y"
                  placeholder="What does this agent do?"
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as AgentStatus })}
                  className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                >
                  <option value="standby">Standby</option>
                  <option value="working">Working</option>
                  <option value="offline">Offline</option>
                </select>
              </div>



              {/* Model Selection */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Model
                  {defaultModel && form.model === defaultModel && (
                    <span className="ml-2 text-xs text-mc-text-secondary">(Default)</span>
                  )}
                </label>
                {modelsLoading ? (
                  <div className="text-sm text-mc-text-secondary">Loading available models...</div>
                ) : (
                  <select
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                  >
                    <option value="">-- Use Default Model --</option>
                    {availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model}{defaultModel === model ? ' (Default)' : ''}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-mc-text-secondary mt-1">
                  AI model used by this agent. Leave empty to use OpenClaw default.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'workspace' && (
            <div className="space-y-4">
              {!agent ? (
                <div className="rounded-lg border border-mc-border bg-mc-bg p-4 text-sm text-mc-text-secondary">
                  Save the agent first to create and inspect its OpenClaw workspace.
                </div>
              ) : agent.source !== 'synced' ? (
                <div className="rounded-lg border border-mc-border bg-mc-bg p-4 text-sm text-mc-text-secondary">
                  This agent is local to Mission Control. OpenClaw workspace browsing is available for synced OpenClaw agents only.
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-mc-border bg-mc-bg p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <div className="text-sm font-medium text-mc-text">OpenClaw-backed agent</div>
                        <div className="text-xs text-mc-text-secondary mt-1">
                          Edits in this modal write to the real OpenClaw files on disk.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setWorkspaceBrowserPath('.');
                          setAgentDirBrowserPath('.');
                        }}
                        className="min-h-11 px-3 py-2 text-sm border border-mc-border rounded hover:bg-mc-bg-secondary flex items-center gap-2"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Refresh
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 text-xs">
                      <div>
                        <div className="text-mc-text-secondary">Gateway agent id</div>
                        <div className="font-mono text-mc-text break-all">{agent.gateway_agent_id || 'n/a'}</div>
                      </div>
                      <div>
                        <div className="text-mc-text-secondary">Workspace path</div>
                        <div className="font-mono text-mc-text break-all">{agent.agent_workspace_path || 'n/a'}</div>
                      </div>
                      <div>
                        <div className="text-mc-text-secondary">Agent config dir</div>
                        <div className="font-mono text-mc-text break-all">{agent.agent_dir || 'n/a'}</div>
                      </div>
                    </div>
                  </div>

                  {workspaceError && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                      {workspaceError}
                    </div>
                  )}

                  {workspaceLoading ? (
                    <div className="flex items-center gap-2 text-sm text-mc-text-secondary">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Loading OpenClaw workspace...
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {renderBrowser('Workspace Browser', workspaceBrowser, setWorkspaceBrowserPath, 'No files found in the agent workspace.')}

                      <div className="space-y-3 rounded-lg border border-mc-border bg-mc-bg p-3">
                        <div className="text-sm font-medium text-mc-text">Installed skills</div>
                        <div className="text-xs text-mc-text-secondary">
                          These entries come from the real <span className="font-mono">skills/</span> directory inside the OpenClaw workspace.
                        </div>
                        {skillsBrowser && skillsBrowser.entries.length > 0 ? (
                          <div className="space-y-1">
                            {skillsBrowser.entries.map((entry) => (
                              <div key={`skill-${entry.relative_path}`} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs">
                                <Folder className="w-3.5 h-3.5 text-mc-accent flex-shrink-0" />
                                <span className="text-mc-text">{entry.name}{entry.is_symlink ? ' [symlink]' : ''}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-mc-text-secondary">No skills installed in this workspace.</div>
                        )}
                      </div>

                      {renderBrowser('Agent Config Directory', agentDirBrowser, setAgentDirBrowserPath, 'No files found in the agent config directory.')}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'soul' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                SOUL.md - Agent Personality & Identity
              </label>
              <textarea
                value={form.soul_md}
                onChange={(e) => setForm({ ...form, soul_md: e.target.value })}
                rows={15}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent resize-none"
                placeholder="# Agent Name&#10;&#10;Define this agent's personality, values, and communication style..."
              />
            </div>
          )}

          {activeTab === 'user' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                USER.md - Context About the Human
              </label>
              <textarea
                value={form.user_md}
                onChange={(e) => setForm({ ...form, user_md: e.target.value })}
                rows={15}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent resize-none"
                placeholder="# User Context&#10;&#10;Information about the human this agent works with..."
              />
            </div>
          )}

          {activeTab === 'agents' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                AGENTS.md - Team Awareness
              </label>
              <textarea
                value={form.agents_md}
                onChange={(e) => setForm({ ...form, agents_md: e.target.value })}
                rows={15}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-mc-accent resize-none"
                placeholder="# Team Roster&#10;&#10;Information about other agents this agent works with..."
              />
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-mc-border flex-shrink-0">
          <div>
            {agent && (
              <button
                type="button"
                onClick={handleDelete}
                className="min-h-11 flex items-center gap-2 px-3 py-2 text-mc-accent-red hover:bg-mc-accent-red/10 rounded text-sm"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="min-h-11 flex items-center gap-2 px-4 py-2 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
