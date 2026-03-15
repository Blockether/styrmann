'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CircleDot,
  ChevronDown,
  ChevronRight,
  Folder,
  Layers,
  MessageSquare,
  Plus,
  Ticket,
} from 'lucide-react';
import { DiscordMessagesView } from '@/components/DiscordMessagesView';
import { GithubIssuesView } from '@/components/GithubIssuesView';
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
  workspaces?: Array<{
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    updated_at?: string;
    created_at?: string;
  }>;
}

interface WorkspaceStats {
  id: string;
  taskCounts?: {
    total: number;
  };
}

interface WorkspaceSummary {
  taskCount: number;
  lastActivity: string;
}

function formatRelativeTime(timestamp?: string): string {
  if (!timestamp) {
    return 'No recent activity';
  }

  const when = new Date(timestamp);
  if (Number.isNaN(when.getTime())) {
    return 'No recent activity';
  }

  const diffMs = Date.now() - when.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) {
    return 'Updated just now';
  }

  if (diffMinutes < 60) {
    return `Updated ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `Updated ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `Updated ${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

const SPRINT_STATUS_COLORS: Record<string, string> = {
  planned: 'bg-mc-bg-tertiary text-mc-text-secondary',
  active: 'bg-mc-accent-green/15 text-mc-accent-green',
  completed: 'bg-mc-accent-cyan/15 text-mc-accent-cyan',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-mc-accent/15 text-mc-accent',
  triaged: 'bg-mc-accent-yellow/15 text-mc-accent-yellow',
  delegated: 'bg-mc-accent-purple/15 text-mc-accent-purple',
  in_progress: 'bg-mc-accent-yellow/15 text-mc-accent-yellow',
  resolved: 'bg-mc-accent-green/15 text-mc-accent-green',
  closed: 'bg-mc-bg-tertiary text-mc-text-secondary',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-mc-bg-tertiary text-mc-text-secondary',
  normal: 'bg-mc-accent/15 text-mc-accent',
  high: 'bg-mc-accent-yellow/15 text-mc-accent-yellow',
  urgent: 'bg-mc-accent-red/15 text-mc-accent-red',
};

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  feature: { label: 'FEA', color: 'bg-mc-accent-green/15 text-mc-accent-green' },
  bug: { label: 'BUG', color: 'bg-mc-accent-red/15 text-mc-accent-red' },
  improvement: { label: 'IMP', color: 'bg-mc-accent-cyan/15 text-mc-accent-cyan' },
  task: { label: 'TSK', color: 'bg-mc-bg-tertiary text-mc-text-secondary' },
  epic: { label: 'EPI', color: 'bg-mc-accent-purple/15 text-mc-accent-purple' },
};

function OrgDetailViewInner({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') || 'board') as 'board' | 'knowledge' | 'workspaces' | 'discord' | 'issues';

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [tickets, setTickets] = useState<OrgTicket[]>([]);
  const [sprints, setSprints] = useState<OrgSprint[]>([]);
  const [milestones, setMilestones] = useState<OrgMilestone[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeArticle[]>([]);
  const [workspaceSummaries, setWorkspaceSummaries] = useState<Record<string, WorkspaceSummary>>({});
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

  const loadWorkspaceSummaries = useCallback(async (workspaces: NonNullable<OrgDetail['workspaces']>) => {
    if (workspaces.length === 0) {
      setWorkspaceSummaries({});
      return;
    }

    let workspaceStats: WorkspaceStats[] = [];
    try {
      const statsRes = await fetch('/api/workspaces?stats=true');
      if (statsRes.ok) {
        workspaceStats = (await statsRes.json()) as WorkspaceStats[];
      }
    } catch {
      workspaceStats = [];
    }

    const statsByWorkspaceId = new Map(workspaceStats.map((entry) => [entry.id, entry]));

    const summaryEntries = await Promise.all(
      workspaces.map(async (workspace) => {
        const taskCount = statsByWorkspaceId.get(workspace.id)?.taskCounts?.total ?? 0;
        const lastActivity = formatRelativeTime(workspace.updated_at || workspace.created_at);

        return [
          workspace.id,
          {
            taskCount,
            lastActivity,
          },
        ] as const;
      })
    );

    setWorkspaceSummaries(Object.fromEntries(summaryEntries));
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
        await Promise.all([loadOrgResources(orgData.id), loadWorkspaceSummaries(orgData.workspaces || [])]);
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
  }, [loadOrganization, loadOrgResources, loadWorkspaceSummaries]);

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
    return (
      <div data-component="src/components/OrgDetailView" className="h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-sm text-mc-text-secondary">Loading organization...</div>
      </div>
    );
  }

  if (!org) {
    return (
      <div data-component="src/components/OrgDetailView" className="h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-sm text-mc-text-secondary">Organization not found.</div>
      </div>
    );
  }

  const selectedSprint = selectedSprintId === 'backlog' ? null : sprints.find((sprint) => sprint.id === selectedSprintId) || null;
  const hasSprints = sprints.length > 0;
  const hasTicketsInSelection = filteredTickets.length > 0;
  const openTickets = tickets.filter((ticket) => !['resolved', 'closed'].includes(ticket.status)).length;
  const delegatedCount = tickets.filter((ticket) => ticket.status === 'delegated').length;
  const unassignedTickets = milestoneTicketMap.get('no-milestone') || [];
  const showUnassignedSection = unassignedTickets.length > 0;
  const showSprintActionBar = hasSprints;
  const showNoSprintEmptyState = activeTab === 'board' && !hasSprints && tickets.length === 0;
  const showNoTicketEmptyState = activeTab === 'board' && hasSprints && !hasTicketsInSelection;
  const primaryWorkspaceId = org.workspaces?.[0]?.id || '';

  return (
    <div data-component="src/components/OrgDetailView" className="h-screen flex flex-col bg-mc-bg overflow-hidden">
      <Header orgName={org.name} />

      {org.description && (
        <div className="px-3 md:px-4 py-3 border-b border-mc-border text-sm text-mc-text-secondary shrink-0">{org.description}</div>
      )}

      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <div className="px-3 md:px-4 border-b border-mc-border bg-mc-bg-secondary shrink-0">
          <div className="flex gap-0 overflow-x-auto">
            {(['board', 'issues', 'discord', 'knowledge', 'workspaces'] as const).map((tab) => (
              <Link
                key={tab}
                href={`?tab=${tab}`}
                className={`px-4 py-2.5 text-sm border-b-2 flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === tab
                    ? 'border-mc-accent text-mc-text font-medium bg-mc-bg-tertiary/30'
                    : 'border-transparent text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary/20'
                }`}
              >
                {tab === 'board' && (
                  <>
                    <Layers size={14} className="shrink-0" />
                    <span>Board</span>
                  </>
                )}
                {tab === 'knowledge' && (
                  <>
                    <BookOpen size={14} className="shrink-0" />
                    <span>Knowledge</span>
                  </>
                )}
                {tab === 'issues' && (
                  <>
                    <CircleDot size={14} className="shrink-0" />
                    <span>Issues</span>
                  </>
                )}
                {tab === 'discord' && (
                  <>
                    <MessageSquare size={14} className="shrink-0" />
                    <span>Discord</span>
                  </>
                )}
                {tab === 'workspaces' && (
                  <>
                    <Folder size={14} className="shrink-0" />
                    <span>Workspaces</span>
                  </>
                )}
              </Link>
            ))}
          </div>
        </div>

        {(activeTab === 'board' || activeTab === 'knowledge' || activeTab === 'workspaces') ? (
        <div className="flex-1 min-w-0 overflow-y-auto p-3 md:p-4">
          {activeTab === 'board' && (
            <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
               <div className="px-4 py-3 rounded-lg border border-mc-border bg-mc-bg-secondary">
                 <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium">Open Tickets</div>
                 <div className="text-3xl font-semibold mt-0.5 text-mc-text">{openTickets}</div>
               </div>
               <div className="px-4 py-3 rounded-lg border border-mc-border bg-mc-bg-secondary">
                 <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium">Milestones</div>
                 <div className="text-3xl font-semibold mt-0.5 text-mc-text">{milestones.length}</div>
               </div>
               <div className="px-4 py-3 rounded-lg border border-mc-border bg-mc-bg-secondary">
                 <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium">Delegated</div>
                 <div className="text-3xl font-semibold mt-0.5 text-mc-text">{delegatedCount}</div>
               </div>
             </div>

            {showSprintActionBar && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={selectedSprintId}
                    onChange={(event) => setSelectedSprintId(event.target.value)}
                    className="px-3 py-1.5 text-sm border border-mc-border rounded bg-mc-bg-secondary text-mc-text focus:outline-none focus:border-mc-accent"
                  >
                    <option value="backlog">Backlog</option>
                    {sprints.map((sprint) => (
                      <option key={sprint.id} value={sprint.id}>
                        {sprint.name} ({sprint.status})
                      </option>
                    ))}
                  </select>
                  {selectedSprint && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${SPRINT_STATUS_COLORS[selectedSprint.status] || 'bg-mc-bg-tertiary text-mc-text-secondary'}`}>
                      {selectedSprint.status}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setShowCreateTicketModal(true)}
                    className="px-3 py-1.5 text-sm bg-mc-accent text-white rounded hover:opacity-90 flex items-center gap-1.5"
                  >
                    <Plus size={14} />
                    <span className="hidden sm:inline">Create Ticket</span>
                    <span className="sm:hidden">Ticket</span>
                  </button>
                  {selectedSprint && (
                    <button
                      onClick={() => {
                        setShowMilestoneForm((prev) => !prev);
                        setShowSprintForm(false);
                      }}
                      className="px-3 py-1.5 text-sm border border-mc-border rounded hover:bg-mc-bg-tertiary"
                    >
                      Add Milestone
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowSprintForm((prev) => !prev);
                      setShowMilestoneForm(false);
                    }}
                    className="px-3 py-1.5 text-sm border border-mc-border rounded hover:bg-mc-bg-tertiary"
                  >
                    Create Sprint
                  </button>
                </div>
              </div>
            )}

            {showSprintForm && (
              <div className="rounded-lg border border-mc-border bg-mc-bg-secondary overflow-hidden">
                <div className="p-4 border-b border-mc-border bg-mc-bg-tertiary/30">
                  <h4 className="text-sm font-semibold text-mc-text">Create New Sprint</h4>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1.5">Name</label>
                      <input
                        type="text"
                        value={newSprintName}
                        onChange={(event) => setNewSprintName(event.target.value)}
                        placeholder="Sprint name"
                        className="w-full px-3 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text placeholder:text-mc-text-secondary/50 focus:outline-none focus:border-mc-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1.5">Start Date</label>
                      <input
                        type="date"
                        value={newSprintStartDate}
                        onChange={(event) => setNewSprintStartDate(event.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1.5">End Date</label>
                      <input
                        type="date"
                        value={newSprintEndDate}
                        onChange={(event) => setNewSprintEndDate(event.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                      />
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3 border-t border-mc-border flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setShowSprintForm(false);
                      setNewSprintName('');
                      setNewSprintStartDate('');
                      setNewSprintEndDate('');
                    }}
                    className="px-3 py-1.5 text-sm border border-mc-border rounded hover:bg-mc-bg-tertiary"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={creatingSprint || !newSprintName.trim()}
                    onClick={createSprint}
                    className="px-3 py-1.5 text-sm bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50"
                  >
                    Create Sprint
                  </button>
                </div>
              </div>
            )}

            {showMilestoneForm && (
              <div className="rounded-lg border border-mc-border bg-mc-bg-secondary overflow-hidden">
                <div className="p-4 border-b border-mc-border bg-mc-bg-tertiary/30">
                  <h4 className="text-sm font-semibold text-mc-text">Add New Milestone</h4>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1.5">Name</label>
                      <input
                        type="text"
                        value={newMilestoneName}
                        onChange={(event) => setNewMilestoneName(event.target.value)}
                        placeholder="Milestone name"
                        className="w-full px-3 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text placeholder:text-mc-text-secondary/50 focus:outline-none focus:border-mc-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1.5">Sprint</label>
                      <select
                        value={newMilestoneSprintId}
                        onChange={(event) => setNewMilestoneSprintId(event.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                      >
                        <option value="">Backlog</option>
                        {sprints.map((sprint) => (
                          <option key={sprint.id} value={sprint.id}>
                            {sprint.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1.5">Priority</label>
                      <select
                        value={newMilestonePriority}
                        onChange={(event) => setNewMilestonePriority(event.target.value as 'low' | 'normal' | 'high' | 'urgent')}
                        className="w-full px-3 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1.5">Due Date</label>
                      <input
                        type="date"
                        value={newMilestoneDueDate}
                        onChange={(event) => setNewMilestoneDueDate(event.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                      />
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3 border-t border-mc-border flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setShowMilestoneForm(false);
                      setNewMilestoneName('');
                      setNewMilestoneDueDate('');
                      setNewMilestonePriority('normal');
                    }}
                    className="px-3 py-1.5 text-sm border border-mc-border rounded hover:bg-mc-bg-tertiary"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={creatingMilestone || !newMilestoneName.trim()}
                    onClick={createMilestone}
                    className="px-3 py-1.5 text-sm bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50"
                  >
                    Add Milestone
                  </button>
                </div>
              </div>
            )}

            {showNoSprintEmptyState && (
              <div className="rounded border border-mc-border bg-mc-bg-secondary min-h-[320px] flex items-center justify-center px-6">
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Layers size={32} className="text-mc-text-secondary mb-4" />
                  <h3 className="text-lg font-semibold mb-2 text-mc-text">Get started with your first sprint</h3>
                  <p className="text-sm text-mc-text-secondary max-w-md mb-6">
                    Sprints help you organize work into time-boxed iterations. Create a sprint, add tickets, and delegate them to your engineering team.
                  </p>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <button
                      onClick={() => setShowSprintForm(true)}
                      className="px-4 py-2 text-sm bg-mc-accent text-white rounded hover:opacity-90"
                    >
                      Create Sprint
                    </button>
                    <button
                      onClick={() => setShowCreateTicketModal(true)}
                      className="px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text border border-mc-border rounded hover:bg-mc-bg"
                    >
                      or create a ticket
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showNoTicketEmptyState && (
              <div className="rounded border border-mc-border bg-mc-bg-secondary min-h-[220px] flex items-center justify-center px-6">
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Ticket size={32} className="text-mc-text-secondary mb-4" />
                  <h3 className="text-lg font-semibold mb-2 text-mc-text">
                    No tickets in {selectedSprint?.name || 'this sprint'}
                  </h3>
                  <p className="text-sm text-mc-text-secondary max-w-md mb-6">
                    Add a ticket to start tracking work in this sprint.
                  </p>
                  <button
                    onClick={() => setShowCreateTicketModal(true)}
                    className="px-4 py-2 text-sm bg-mc-accent text-white rounded hover:opacity-90"
                  >
                    Create Ticket
                  </button>
                </div>
              </div>
            )}

            {hasTicketsInSelection && (
              <div className="space-y-2">
                {[
                  ...filteredMilestones.filter((milestone) => (milestoneTicketMap.get(milestone.id) || []).length > 0),
                  ...(showUnassignedSection ? [{ id: 'no-milestone', name: 'Unassigned', status: 'open' } as OrgMilestone] : []),
                ].map((milestone) => {
                  const milestoneKey = milestone.id;
                  const milestoneTickets = milestoneTicketMap.get(milestoneKey) || [];
                  const isOpen = expandedMilestones.has(milestoneKey);
                  const statusClass = STATUS_COLORS[milestone.status] || 'bg-mc-bg-tertiary text-mc-text-secondary';

                  return (
                    <section key={milestoneKey} className="rounded-lg border border-mc-border bg-mc-bg-secondary overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleMilestone(milestoneKey)}
                        className="w-full px-4 py-3 border-b border-mc-border/60 text-left hover:bg-mc-bg-tertiary/30"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {isOpen ? <ChevronDown size={16} className="text-mc-text-secondary shrink-0" /> : <ChevronRight size={16} className="text-mc-text-secondary shrink-0" />}
                            <span className="text-sm font-semibold text-mc-text truncate">{milestone.name}</span>
                            {milestone.id !== 'no-milestone' && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${statusClass}`}>{milestone.status}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-mc-text-secondary">
                            <span className="font-mono">{milestoneTickets.length}</span>
                          </div>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="p-2 space-y-1.5">
                          {milestoneTickets.map((ticket) => {
                            const typeConfig = TYPE_CONFIG[ticket.ticket_type] || TYPE_CONFIG.task;
                            return (
                              <button
                                key={ticket.id}
                                type="button"
                                onClick={() => setSelectedTicketId(ticket.id)}
                                className="w-full px-3 py-2.5 rounded border border-mc-border bg-mc-bg text-left hover:border-mc-accent hover:bg-mc-bg-secondary"
                              >
                                <div className="flex items-center gap-2.5">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-mono shrink-0 ${typeConfig.color}`}>{typeConfig.label}</span>
                                  <span className="text-sm text-mc-text truncate flex-1 min-w-0">{ticket.title}</span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${STATUS_COLORS[ticket.status] || 'bg-mc-bg-tertiary text-mc-text-secondary'}`}>
                                      {ticket.status}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${PRIORITY_COLORS[ticket.priority] || 'bg-mc-bg-tertiary text-mc-text-secondary'}`}>
                                      {ticket.priority}
                                    </span>
                                    {typeof ticket.story_points === 'number' && (
                                      <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-mc-bg-tertiary text-mc-text-secondary">
                                        {ticket.story_points}sp
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {ticket.description && (
                                  <p className="mt-1.5 text-xs text-mc-text-secondary line-clamp-1 pl-14">{ticket.description}</p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
            </div>
          )}

          {activeTab === 'knowledge' && (
            <div className="space-y-2">
            {knowledge.length === 0 ? (
              <div className="rounded-lg border border-mc-border bg-mc-bg-secondary min-h-[320px] flex items-center justify-center px-6">
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <BookOpen size={32} className="text-mc-text-secondary mb-4" />
                  <h3 className="text-lg font-semibold mb-2 text-mc-text">No knowledge articles yet</h3>
                  <p className="text-sm text-mc-text-secondary max-w-md mb-4">
                    Knowledge articles are automatically synthesized from your team&apos;s memories and decisions. Start by recording memories through the API.
                  </p>
                  <pre className="text-xs font-mono text-left rounded-lg border border-mc-border bg-mc-bg p-3 mb-4 overflow-x-auto">
{`POST /api/memories
{
  "memory_type": "decision",
  "title": "We chose PostgreSQL",
  "body": "Because of..."
}`}
                  </pre>
                  <p className="text-sm text-mc-text-secondary max-w-md mb-6">
                    Once you have enough memories, knowledge synthesis runs automatically.
                  </p>
                  <a
                    href="/api/memories"
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 text-sm border border-mc-border rounded hover:bg-mc-bg-tertiary"
                  >
                    Open Memories API
                  </a>
                </div>
              </div>
            ) : (
              knowledge.map((article) => (
                <article key={article.id} className="px-4 py-3 rounded-lg border border-mc-border bg-mc-bg-secondary">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-mc-text truncate">{article.title}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-mono shrink-0 ${article.status === 'stale' ? 'bg-mc-accent-yellow/15 text-mc-accent-yellow' : 'bg-mc-accent-green/15 text-mc-accent-green'}`}>
                      {article.status}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-mc-text-secondary line-clamp-2">{article.summary}</p>
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
                className="block px-4 py-3 rounded-lg border border-mc-border bg-mc-bg-secondary hover:border-mc-accent hover:bg-mc-bg-tertiary/30"
              >
                <div className="flex items-center gap-3">
                  <Folder size={18} className="text-mc-accent shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-mc-text block truncate">{workspace.name}</span>
                    {workspace.description ? (
                      <p className="text-xs text-mc-text-secondary mt-0.5 line-clamp-1">{workspace.description}</p>
                    ) : (
                      <p className="text-xs text-mc-text-secondary mt-0.5">Tasks managed by AI agents</p>
                    )}
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-4 text-xs text-mc-text-secondary font-mono">
                  <span>{workspaceSummaries[workspace.id]?.taskCount ?? 0} tasks</span>
                  <span>{workspaceSummaries[workspace.id]?.lastActivity ?? 'No recent activity'}</span>
                </div>
              </Link>
            ))}
            {(org.workspaces || []).length === 0 && (
              <div className="sm:col-span-2 rounded-lg border border-mc-border bg-mc-bg-secondary min-h-[260px] flex items-center justify-center px-6">
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Folder size={32} className="text-mc-text-secondary mb-4" />
                  <h3 className="text-lg font-semibold mb-2 text-mc-text">No workspaces in this organization</h3>
                  <p className="text-sm text-mc-text-secondary max-w-md mb-6">
                    Workspaces are where delegated tasks are executed. Create or connect a workspace to start routing org tickets.
                  </p>
                  <Link href="/" className="px-4 py-2 text-sm border border-mc-border rounded hover:bg-mc-bg-tertiary">
                    Browse all workspaces
                  </Link>
                </div>
              </div>
            )}
            </div>
          )}
        </div>
        ) : activeTab === 'discord' ? (
          primaryWorkspaceId ? (
            <DiscordMessagesView workspaceId={primaryWorkspaceId} />
          ) : null
        ) : activeTab === 'issues' ? (
          primaryWorkspaceId && org.workspaces?.[0] ? (
            <GithubIssuesView workspaceId={primaryWorkspaceId} workspace={org.workspaces[0] as any} />
          ) : null
        ) : null}
      </main>

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
    <Suspense fallback={<div data-component="src/components/OrgDetailView" className="h-screen bg-mc-bg flex items-center justify-center text-sm text-mc-text-secondary">Loading organization...</div>}>
      <OrgDetailViewInner slug={slug} />
    </Suspense>
  );
}
