'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Filter,
  Bot,
  User,
  Cpu,
  Clock,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { AgentInitials } from './AgentInitials';

interface ActivityFeedProps {
  workspaceId: string;
  sprintId?: string;
}

type SourceFilter = 'all' | 'activity' | 'agent_log';

interface Milestone {
  id: string;
  name: string;
  workspace_id: string;
  sprint_id?: string;
}

interface FeedItem {
  id: string;
  source: 'activity' | 'agent_log';
  task_id: string | null;
  task_title: string | null;
  task_status: string | null;
  agent_id: string | null;
  agent_name: string | null;
  milestone_id: string | null;
  milestone_name: string | null;
  activity_type: string | null;
  message: string;
  role: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface FeedResponse {
  items: FeedItem[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

const STATUS_COLORS: Record<string, string> = {
  in_progress: 'bg-mc-accent',
  assigned: 'bg-mc-accent-yellow',
  testing: 'bg-mc-accent-cyan',
  review: 'bg-mc-accent-purple',
  verification: 'bg-orange-500',
  done: 'bg-mc-accent-green',
  planning: 'bg-mc-accent-purple',
  pending_dispatch: 'bg-gray-400',
  inbox: 'bg-mc-accent-pink',
};

const ROLE_BADGE_STYLES: Record<string, string> = {
  user: 'bg-blue-100 text-blue-700',
  assistant: 'bg-amber-100 text-amber-700',
  system: 'bg-slate-100 text-slate-600',
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  user: <User className="w-3 h-3" />,
  assistant: <Bot className="w-3 h-3" />,
  system: <Cpu className="w-3 h-3" />,
};

export function ActivityFeed({ workspaceId, sprintId }: ActivityFeedProps) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [milestoneFilter, setMilestoneFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  // Fetch milestones for filter dropdown
  useEffect(() => {
    const fetchMilestones = async () => {
      try {
        const params = new URLSearchParams({ workspace_id: workspaceId });
        if (sprintId) params.set('sprint_id', sprintId);
        const res = await fetch(`/api/milestones?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setMilestones(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Failed to fetch milestones:', err);
      }
    };

    fetchMilestones();
  }, [workspaceId, sprintId]);

  // Fetch feed
  const fetchFeed = useCallback(
    async (offset = 0, append = false) => {
      try {
        if (!append) setLoading(true);
        else setLoadingMore(true);
        setError(null);

        const params = new URLSearchParams({
          workspace_id: workspaceId,
          limit: '100',
          offset: offset.toString(),
        });

        if (sprintId) params.set('sprint_id', sprintId);
        if (milestoneFilter) params.set('milestone_id', milestoneFilter);
        if (sourceFilter !== 'all') params.set('source', sourceFilter);

        const res = await fetch(`/api/activities/feed?${params.toString()}`);

        if (res.ok) {
          const data: FeedResponse = await res.json();
          if (append) {
            setItems((prev) => [...prev, ...data.items]);
          } else {
            setItems(data.items);
            // Expand all task groups by default
            const taskIds = new Set(
              data.items
                .filter((item) => item.task_id !== null)
                .map((item) => item.task_id as string)
            );
            setExpandedTasks(taskIds);
          }
          setTotal(data.total);
          setHasMore(data.hasMore);
        } else {
          const errData = await res.json().catch(() => ({ error: 'Failed to fetch activity feed' }));
          setError(errData.error || 'Failed to fetch activity feed');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch activity feed');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [workspaceId, sprintId, milestoneFilter, sourceFilter]
  );

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchFeed(0, false);
  }, [fetchFeed]);

  // Group items by task_id
  const groupedItems = useMemo(() => {
    const groups: Record<string, { task: { id: string; title: string; status: string } | null; milestone: { id: string; name: string } | null; items: FeedItem[] }> = {};

    items.forEach((item) => {
      const groupKey = item.task_id || '__unlinked__';

      if (!groups[groupKey]) {
        groups[groupKey] = {
          task: item.task_id
            ? { id: item.task_id, title: item.task_title || 'Unknown Task', status: item.task_status || 'unknown' }
            : null,
          milestone: item.milestone_id
            ? { id: item.milestone_id, name: item.milestone_name || 'Unknown Milestone' }
            : null,
          items: [],
        };
      }

      groups[groupKey].items.push(item);
    });

    // Sort items within each group by created_at descending
    Object.values(groups).forEach((group) => {
      group.items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    });

    return groups;
  }, [items]);

  // Ordered group keys (tasks first, unlinked last)
  const groupOrder = useMemo(() => {
    const keys = Object.keys(groupedItems);
    const taskKeys = keys.filter((k) => k !== '__unlinked__');
    const unlinkedKey = keys.includes('__unlinked__') ? ['__unlinked__'] : [];
    return [...taskKeys, ...unlinkedKey];
  }, [groupedItems]);

  const toggleTaskGroup = (taskKey: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskKey)) {
        next.delete(taskKey);
      } else {
        next.add(taskKey);
      }
      return next;
    });
  };

  const toggleMessageExpand = (itemId: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchFeed(items.length, true);
    }
  };

  const getStatusColor = (status: string): string => {
    return STATUS_COLORS[status] || 'bg-gray-400';
  };

  const getRoleBadgeStyle = (role: string): string => {
    return ROLE_BADGE_STYLES[role] || 'bg-mc-bg-tertiary text-mc-text-secondary';
  };

  const getRoleIcon = (role: string): React.ReactNode => {
    return ROLE_ICONS[role] || null;
  };

  return (
    <div
      data-component="src/components/ActivityFeed"
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Toolbar */}
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-mc-accent" />
          <span className="font-mono font-medium">Activity</span>
          <span className="text-xs text-mc-text-secondary hidden sm:inline">
            {total > 0 ? `${total} total` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Milestone Filter */}
          <select
            value={milestoneFilter}
            onChange={(e) => setMilestoneFilter(e.target.value)}
            className="min-h-11 px-2 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
          >
            <option value="">All Milestones</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          {/* Source Filter */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="min-h-11 px-2 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
          >
            <option value="all">All Sources</option>
            <option value="activity">Status Changes</option>
            <option value="agent_log">Agent Logs</option>
          </select>

          {/* Refresh Button */}
          <button
            onClick={() => fetchFeed(0, false)}
            disabled={loading}
            className="flex items-center gap-2 px-3 min-h-11 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{loading ? 'Loading...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Feed Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-mc-text-secondary" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-mc-accent-red/20 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-mc-accent-red" />
            </div>
            <p className="text-sm text-mc-accent-red">{error}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <Activity className="w-12 h-12 text-mc-border mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Activity</h3>
            <p className="text-sm text-mc-text-secondary">
              {milestoneFilter || sourceFilter !== 'all'
                ? 'No activity matches your current filters.'
                : 'No activity has been recorded yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupOrder.map((groupKey) => {
              const group = groupedItems[groupKey];
              const isExpanded = expandedTasks.has(groupKey);
              const itemCount = group.items.length;

              return (
                <div
                  key={groupKey}
                  className="bg-mc-bg-secondary border border-mc-border rounded-lg overflow-hidden"
                >
                  {/* Task Group Header */}
                  <button
                    onClick={() => toggleTaskGroup(groupKey)}
                    className="w-full px-4 py-3 border-b border-mc-border bg-mc-bg-tertiary/50 text-left hover:bg-mc-bg-tertiary transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 flex-shrink-0 text-mc-text-secondary" />
                        ) : (
                          <ChevronRight className="w-4 h-4 flex-shrink-0 text-mc-text-secondary" />
                        )}
                        {group.task ? (
                          <>
                            <FileText className="w-4 h-4 flex-shrink-0 text-mc-accent" />
                            <span className="font-mono font-medium truncate">
                              {group.task.title}
                            </span>
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded text-white flex-shrink-0 ${getStatusColor(
                                group.task.status
                              )}`}
                            >
                              {group.task.status.replace('_', ' ')}
                            </span>
                          </>
                        ) : (
                          <>
                            <Cpu className="w-4 h-4 flex-shrink-0 text-mc-text-secondary" />
                            <span className="font-mono font-medium truncate">General Activity</span>
                          </>
                        )}
                        {group.milestone && (
                          <span className="text-xs text-mc-text-secondary hidden sm:inline">
                            in {group.milestone.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-mc-text-secondary bg-mc-bg px-2 py-0.5 rounded">
                          {itemCount} {itemCount === 1 ? 'item' : 'items'}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Task Group Content */}
                  {isExpanded && (
                    <div className="divide-y divide-mc-border">
                      {group.items.map((item) => (
                        <div key={item.id} className="p-3 hover:bg-mc-bg-tertiary/30 transition-colors">
                          <div className="flex gap-3">
                            {/* Agent Avatar */}
                            <div className="flex-shrink-0 mt-1">
                              {item.agent_name ? (
                                <AgentInitials name={item.agent_name} size="sm" />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-mc-bg-tertiary flex items-center justify-center">
                                  <Cpu className="w-3 h-3 text-mc-text-secondary" />
                                </div>
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              {/* Header */}
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                {item.source === 'activity' ? (
                                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-mc-accent/15 text-mc-accent">
                                    {item.activity_type || 'status_change'}
                                  </span>
                                ) : (
                                  <span
                                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${getRoleBadgeStyle(
                                      item.role || 'system'
                                    )}`}
                                  >
                                    {getRoleIcon(item.role || 'system')}
                                    {item.role || 'system'}
                                  </span>
                                )}
                                {item.agent_name && (
                                  <span className="text-xs text-mc-text-secondary">{item.agent_name}</span>
                                )}
                                <span className="text-xs text-mc-text-secondary ml-auto flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                                </span>
                              </div>

                              {/* Message Content */}
                              {item.source === 'activity' ? (
                                <p className="text-sm text-mc-text">{item.message}</p>
                              ) : (
                                <div
                                  className={`text-sm text-mc-text font-mono whitespace-pre-wrap break-words bg-mc-bg-tertiary rounded p-2 ${
                                    expandedMessages.has(item.id) ? '' : 'line-clamp-4'
                                  }`}
                                >
                                  {item.message}
                                </div>
                              )}

                              {/* Expand/Collapse for long agent logs */}
                              {item.source === 'agent_log' && item.message.split('\n').length > 4 && (
                                <button
                                  onClick={() => toggleMessageExpand(item.id)}
                                  className="mt-2 text-xs text-mc-accent hover:underline"
                                >
                                  {expandedMessages.has(item.id) ? 'Show less' : 'Show more'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Load More Button */}
            {hasMore && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-4 py-2 min-h-11 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Load More'
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
