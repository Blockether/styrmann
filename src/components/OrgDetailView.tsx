'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Folder,
  Layers,
  Plus,
  Ticket,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { OrgTicketCreateModal } from '@/components/OrgTicketCreateModal';
import { OrgTicketModal } from '@/components/OrgTicketModal';
import { useOrgSSE } from '@/hooks/useOrgSSE';
import type { KnowledgeArticle, OrgMilestone, OrgSprint, OrgTicket } from '@/lib/types';

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  workspaces?: Array<{ id: string; name: string; slug: string }>;
}

const SPRINT_STATUS_COLORS: Record<string, string> = {
  planned: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  triaged: 'bg-yellow-100 text-yellow-800',
  delegated: 'bg-purple-100 text-purple-800',
  in_progress: 'bg-orange-100 text-orange-800',
  resolved: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-600',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  normal: 'bg-slate-100 text-slate-700',
  high: 'bg-orange-100 text-orange-800',
  urgent: 'bg-red-100 text-red-800',
};

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  feature: { label: 'FEA', color: 'bg-emerald-100 text-emerald-800' },
  bug: { label: 'BUG', color: 'bg-red-100 text-red-800' },
  improvement: { label: 'IMP', color: 'bg-blue-100 text-blue-800' },
  task: { label: 'TSK', color: 'bg-slate-100 text-slate-700' },
  epic: { label: 'EPI', color: 'bg-purple-100 text-purple-800' },
};

function OrgDetailViewInner({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') || 'board') as 'board' | 'knowledge' | 'workspaces';

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [tickets, setTickets] = useState<OrgTicket[]>([]);
  const [sprints, setSprints] = useState<OrgSprint[]>([]);
  const [milestones, setMilestones] = useState<OrgMilestone[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedSprintId, setSelectedSprintId] = useState<string>('backlog');
  const [expandedMilestones, setExpandedMilestones] = useState<Set<string>>(new Set(['no-milestone']));

  const [showCreateTicketModal, setShowCreateTicketModal] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const [showSprintForm, setShowSprintForm] = useState(false);
  const [newSprintName, setNewSprintName] = useState('');
  const [newSprintStartDate, setNewSprintStartDate] = useState('');
  const [newSprintEndDate, setNewSprintEndDate] = useState('');
  const [creatingSprint, setCreatingSprint] = useState(false);

  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [newMilestoneName, setNewMilestoneName] = useState('');
  const [newMilestoneSprintId, setNewMilestoneSprintId] = useState('');
  const [newMilestonePriority, setNewMilestonePriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState('');
  const [creatingMilestone, setCreatingMilestone] = useState(false);

  const loadOrganization = useCallback(async () => {
    const orgRes = await fetch(`/api/organizations/${slug}`);
    if (!orgRes.ok) {
      setOrg(null);
      return null;
    }
    const orgData = (await orgRes.json()) as OrgDetail;
    setOrg(orgData);
    return orgData;
  }, [slug]);

  const loadOrgResources = useCallback(async (organizationId: string) => {
    const [ticketRes, sprintRes, milestoneRes, knowledgeRes] = await Promise.all([
      fetch(`/api/org-tickets?organization_id=${organizationId}`),
      fetch(`/api/org-sprints?organization_id=${organizationId}`),
      fetch(`/api/org-milestones?organization_id=${organizationId}`),
      fetch(`/api/knowledge?organization_id=${organizationId}`),
    ]);

    setTickets(ticketRes.ok ? ((await ticketRes.json()) as OrgTicket[]) : []);
    setSprints(sprintRes.ok ? ((await sprintRes.json()) as OrgSprint[]) : []);
    setMilestones(milestoneRes.ok ? ((await milestoneRes.json()) as OrgMilestone[]) : []);
    setKnowledge(knowledgeRes.ok ? ((await knowledgeRes.json()) as KnowledgeArticle[]) : []);
  }, []);

  const refetchAll = useCallback(async () => {
    if (!org?.id) {
      return;
    }
    await loadOrgResources(org.id);
  }, [org?.id, loadOrgResources]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        setLoading(true);
        const orgData = await loadOrganization();
        if (!orgData || !mounted) {
          return;
        }
        await loadOrgResources(orgData.id);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    run().catch(() => {
      if (mounted) {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, [loadOrganization, loadOrgResources]);

  useEffect(() => {
    if (selectedSprintId !== 'backlog' && sprints.some((s) => s.id === selectedSprintId)) {
      return;
    }

    const activeSprint = sprints.find((s) => s.status === 'active');
    const plannedSprint = sprints.find((s) => s.status === 'planned');
    const defaultSprintId = activeSprint?.id || plannedSprint?.id || 'backlog';
    setSelectedSprintId(defaultSprintId);
  }, [sprints, selectedSprintId]);

  useEffect(() => {
    if (selectedSprintId === 'backlog') {
      setNewMilestoneSprintId('');
    } else {
      setNewMilestoneSprintId(selectedSprintId);
    }
  }, [selectedSprintId]);

  useOrgSSE({
    onTicketChange: refetchAll,
    onSprintChange: refetchAll,
    onMilestoneChange: refetchAll,
    onKnowledgeChange: refetchAll,
  });

  const filteredTickets = useMemo(() => {
    if (selectedSprintId === 'backlog') {
      return tickets.filter((ticket) => !ticket.org_sprint_id);
    }
    return tickets.filter((ticket) => ticket.org_sprint_id === selectedSprintId);
  }, [tickets, selectedSprintId]);

  const filteredMilestones = useMemo(() => {
    if (selectedSprintId === 'backlog') {
      return milestones.filter((milestone) => !milestone.org_sprint_id);
    }
    return milestones.filter((milestone) => milestone.org_sprint_id === selectedSprintId);
  }, [milestones, selectedSprintId]);

  const milestoneTicketMap = useMemo(() => {
    const map = new Map<string, OrgTicket[]>();
    for (const milestone of filteredMilestones) {
      map.set(milestone.id, filteredTickets.filter((ticket) => ticket.org_milestone_id === milestone.id));
    }
    map.set(
      'no-milestone',
      filteredTickets.filter(
        (ticket) => !ticket.org_milestone_id || !filteredMilestones.some((milestone) => milestone.id === ticket.org_milestone_id)
      )
    );
    return map;
  }, [filteredMilestones, filteredTickets]);

  const defaultTicketMilestoneId = filteredMilestones[0]?.id;

  const toggleMilestone = (milestoneKey: string) => {
    setExpandedMilestones((prev) => {
      const next = new Set(prev);
      if (next.has(milestoneKey)) {
        next.delete(milestoneKey);
      } else {
        next.add(milestoneKey);
      }
      return next;
    });
  };

  const createSprint = async () => {
    if (!org?.id || !newSprintName.trim()) {
      return;
    }

    setCreatingSprint(true);
    try {
      const res = await fetch('/api/org-sprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: org.id,
          name: newSprintName.trim(),
          status: 'planned',
          start_date: newSprintStartDate || undefined,
          end_date: newSprintEndDate || undefined,
        }),
      });

      if (res.ok) {
        const sprint = (await res.json()) as OrgSprint;
        setSelectedSprintId(sprint.id);
        setShowSprintForm(false);
        setNewSprintName('');
        setNewSprintStartDate('');
        setNewSprintEndDate('');
        await refetchAll();
      }
    } finally {
      setCreatingSprint(false);
    }
  };

  const createMilestone = async () => {
    if (!org?.id || !newMilestoneName.trim()) {
      return;
    }

    setCreatingMilestone(true);
    try {
      const res = await fetch('/api/org-milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: org.id,
          name: newMilestoneName.trim(),
          priority: newMilestonePriority,
          due_date: newMilestoneDueDate || undefined,
          org_sprint_id: newMilestoneSprintId || undefined,
        }),
      });

      if (res.ok) {
        const milestone = (await res.json()) as OrgMilestone;
        setExpandedMilestones((prev) => new Set(prev).add(milestone.id));
        setShowMilestoneForm(false);
        setNewMilestoneName('');
        setNewMilestonePriority('normal');
        setNewMilestoneDueDate('');
        await refetchAll();
      }
    } finally {
      setCreatingMilestone(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-mc-text-secondary">Loading...</div>;
  }

  if (!org) {
    return <div className="p-8 text-sm text-mc-text-secondary">Organization not found.</div>;
  }

  const selectedSprint = selectedSprintId === 'backlog' ? null : sprints.find((sprint) => sprint.id === selectedSprintId) || null;

  return (
    <div data-component="src/components/OrgDetailView" className="min-h-screen bg-mc-bg">
      <Header />

      {org.description && (
        <div className="px-8 py-3 border-b border-mc-border text-sm text-mc-text-secondary">{org.description}</div>
      )}

      <div className="p-8 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm text-mc-text-secondary">Sprint</label>
            <select
              value={selectedSprintId}
              onChange={(event) => setSelectedSprintId(event.target.value)}
              className="px-3 py-2 text-sm border border-mc-border rounded bg-mc-bg-secondary text-mc-text focus:outline-none focus:border-mc-accent"
            >
              <option value="backlog">Backlog</option>
              {sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name} ({sprint.status})
                </option>
              ))}
            </select>
            {selectedSprint ? (
              <span className={`px-2 py-1 rounded text-sm font-mono ${SPRINT_STATUS_COLORS[selectedSprint.status] || 'bg-gray-100 text-gray-700'}`}>
                {selectedSprint.status}
              </span>
            ) : (
              <span className="px-2 py-1 rounded text-sm font-mono bg-gray-100 text-gray-700">backlog</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowSprintForm((prev) => !prev)}
              className="px-3 py-1.5 text-sm font-mono border border-mc-border rounded hover:bg-mc-bg-secondary flex items-center gap-1"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Sprint</span>
            </button>
            <button
              onClick={() => setShowMilestoneForm((prev) => !prev)}
              className="px-3 py-1.5 text-sm font-mono border border-mc-border rounded hover:bg-mc-bg-secondary flex items-center gap-1"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Milestone</span>
            </button>
            <button
              onClick={() => setShowCreateTicketModal(true)}
              className="px-3 py-1.5 text-sm font-mono bg-mc-accent text-white rounded hover:opacity-90 flex items-center gap-1"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Ticket</span>
            </button>
          </div>
        </div>

        {showSprintForm && (
          <div className="p-4 rounded border border-mc-border bg-mc-bg-secondary mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                value={newSprintName}
                onChange={(event) => setNewSprintName(event.target.value)}
                placeholder="Sprint name"
                className="w-full px-3 py-2 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
              />
              <input
                type="date"
                value={newSprintStartDate}
                onChange={(event) => setNewSprintStartDate(event.target.value)}
                placeholder="Start"
                className="w-full px-3 py-2 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
              />
              <input
                type="date"
                value={newSprintEndDate}
                onChange={(event) => setNewSprintEndDate(event.target.value)}
                placeholder="End"
                className="w-full px-3 py-2 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowSprintForm(false);
                  setNewSprintName('');
                  setNewSprintStartDate('');
                  setNewSprintEndDate('');
                }}
                className="px-3 py-1.5 text-sm border border-mc-border rounded"
              >
                Cancel
              </button>
              <button
                disabled={creatingSprint || !newSprintName.trim()}
                onClick={createSprint}
                className="px-3 py-1.5 text-sm bg-mc-accent text-white rounded disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        )}

        {showMilestoneForm && (
          <div className="p-4 rounded border border-mc-border bg-mc-bg-secondary mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={newMilestoneName}
                onChange={(event) => setNewMilestoneName(event.target.value)}
                placeholder="Milestone name"
                className="w-full px-3 py-2 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
              />
              <select
                value={newMilestoneSprintId}
                onChange={(event) => setNewMilestoneSprintId(event.target.value)}
                className="w-full px-3 py-2 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
              >
                <option value="">Backlog</option>
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.name}
                  </option>
                ))}
              </select>
              <select
                value={newMilestonePriority}
                onChange={(event) => setNewMilestonePriority(event.target.value as 'low' | 'normal' | 'high' | 'urgent')}
                className="w-full px-3 py-2 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <input
                type="date"
                value={newMilestoneDueDate}
                onChange={(event) => setNewMilestoneDueDate(event.target.value)}
                className="w-full px-3 py-2 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowMilestoneForm(false);
                  setNewMilestoneName('');
                  setNewMilestoneDueDate('');
                  setNewMilestonePriority('normal');
                }}
                className="px-3 py-1.5 text-sm border border-mc-border rounded"
              >
                Cancel
              </button>
              <button
                disabled={creatingMilestone || !newMilestoneName.trim()}
                onClick={createMilestone}
                className="px-3 py-1.5 text-sm bg-mc-accent text-white rounded disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-0 border-b border-mc-border bg-mc-bg-secondary">
          {(['board', 'knowledge', 'workspaces'] as const).map((tab) => (
            <Link
              key={tab}
              href={`?tab=${tab}`}
              className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-mc-accent text-mc-text'
                  : 'border-transparent text-mc-text-secondary hover:text-mc-text'
              }`}
            >
              {tab === 'board' && (
                <>
                  <Layers size={14} className="inline mr-1" />
                  <span className="hidden sm:inline">Board</span>
                  <span className="sm:hidden">B</span>
                </>
              )}
              {tab === 'knowledge' && (
                <>
                  <BookOpen size={14} className="inline mr-1" />
                  <span className="hidden sm:inline">Knowledge</span>
                  <span className="sm:hidden">K</span>
                </>
              )}
              {tab === 'workspaces' && (
                <>
                  <Folder size={14} className="inline mr-1" />
                  <span className="hidden sm:inline">Workspaces</span>
                  <span className="sm:hidden">W</span>
                </>
              )}
            </Link>
          ))}
        </div>

        {activeTab === 'board' && (
          <div className="space-y-2">
            {[...filteredMilestones, { id: 'no-milestone', name: 'No Milestone', status: 'open' } as OrgMilestone].map((milestone) => {
              const milestoneKey = milestone.id;
              const milestoneTickets = milestoneTicketMap.get(milestoneKey) || [];
              const isOpen = expandedMilestones.has(milestoneKey);
              const statusClass = STATUS_COLORS[milestone.status] || 'bg-gray-100 text-gray-700';

              return (
                <section key={milestoneKey} className="rounded border border-mc-border bg-mc-bg-secondary">
                  <button
                    type="button"
                    onClick={() => toggleMilestone(milestoneKey)}
                    className="w-full p-3 border-b border-mc-border/50 text-left"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        {isOpen ? <ChevronDown size={16} className="text-mc-text-secondary" /> : <ChevronRight size={16} className="text-mc-text-secondary" />}
                        <span className="font-mono text-base text-mc-text truncate">{milestone.name}</span>
                        {milestone.id !== 'no-milestone' && (
                          <span className={`px-2 py-0.5 rounded text-sm font-mono ${statusClass}`}>{milestone.status}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-mc-text-secondary">
                        <span>{milestoneTickets.length} ticket{milestoneTickets.length === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="p-3 space-y-2">
                      {milestoneTickets.length === 0 ? (
                        <div className="p-3 rounded border border-mc-border bg-mc-bg text-sm text-mc-text-secondary">
                          No tickets in this milestone.
                        </div>
                      ) : (
                        milestoneTickets.map((ticket) => {
                          const typeConfig = TYPE_CONFIG[ticket.ticket_type] || TYPE_CONFIG.task;
                          return (
                            <button
                              key={ticket.id}
                              type="button"
                              onClick={() => setSelectedTicketId(ticket.id)}
                              className="w-full p-3 rounded border border-mc-border bg-mc-bg text-left hover:border-mc-accent transition-colors"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`px-2 py-0.5 rounded text-sm font-mono ${typeConfig.color}`}>{typeConfig.label}</span>
                                  <span className="text-sm text-mc-text truncate">{ticket.title}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                                  <span className={`px-2 py-0.5 rounded text-sm font-mono ${STATUS_COLORS[ticket.status] || 'bg-gray-100 text-gray-700'}`}>
                                    {ticket.status}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-sm font-mono ${PRIORITY_COLORS[ticket.priority] || 'bg-slate-100 text-slate-700'}`}>
                                    {ticket.priority}
                                  </span>
                                  {typeof ticket.story_points === 'number' && (
                                    <span className="px-2 py-0.5 rounded text-sm font-mono bg-mc-bg-secondary border border-mc-border text-mc-text-secondary">
                                      {ticket.story_points}sp
                                    </span>
                                  )}
                                </div>
                              </div>
                              {ticket.description && (
                                <p className="mt-2 text-sm text-mc-text-secondary line-clamp-2">{ticket.description}</p>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {activeTab === 'knowledge' && (
          <div className="space-y-2">
            {knowledge.length === 0 ? (
              <div className="p-3 rounded border border-mc-border bg-mc-bg-secondary text-sm text-mc-text-secondary">
                No knowledge articles yet.
              </div>
            ) : (
              knowledge.map((article) => (
                <article key={article.id} className="p-3 rounded border border-mc-border bg-mc-bg-secondary">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="font-mono text-base text-mc-text">{article.title}</h3>
                    <span className={`px-2 py-0.5 rounded text-sm font-mono ${article.status === 'stale' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                      {article.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-mc-text-secondary line-clamp-2">{article.summary}</p>
                </article>
              ))
            )}
          </div>
        )}

        {activeTab === 'workspaces' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(org.workspaces || []).map((workspace) => (
              <Link
                key={workspace.id}
                href={`/workspace/${workspace.slug}`}
                className="block p-3 rounded border border-mc-border bg-mc-bg-secondary hover:border-mc-accent transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Folder size={14} className="text-mc-accent shrink-0" />
                  <span className="font-mono text-base text-mc-text">{workspace.name}</span>
                </div>
                <p className="mt-1 text-sm text-mc-text-secondary">{workspace.slug}</p>
              </Link>
            ))}
            {(org.workspaces || []).length === 0 && (
              <div className="p-3 rounded border border-mc-border bg-mc-bg-secondary text-sm text-mc-text-secondary">
                No workspaces in this organization.
              </div>
            )}
          </div>
        )}
      </div>

      {showCreateTicketModal && (
        <OrgTicketCreateModal
          organizationId={org.id}
          initialSprintId={selectedSprintId === 'backlog' ? null : selectedSprintId}
          initialMilestoneId={defaultTicketMilestoneId ?? null}
          onClose={() => setShowCreateTicketModal(false)}
          onCreated={(ticket) => {
            setTickets((prev) => [ticket, ...prev]);
            setShowCreateTicketModal(false);
          }}
        />
      )}

      {selectedTicketId && (
        <OrgTicketModal
          ticketId={selectedTicketId}
          organizationId={org.id}
          onClose={() => setSelectedTicketId(null)}
          onUpdated={refetchAll}
        />
      )}
    </div>
  );
}

export function OrgDetailView({ slug }: { slug: string }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-mc-text-secondary">Loading...</div>}>
      <OrgDetailViewInner slug={slug} />
    </Suspense>
  );
}
