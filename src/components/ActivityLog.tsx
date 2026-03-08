/**
 * ActivityLog Component
 * Displays chronological activity log for a task
 */

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Zap, PenLine, CheckCircle2, FileText, ArrowRightLeft, Activity } from 'lucide-react';
import type { TaskActivity } from '@/lib/types';
import { AgentInitials } from './AgentInitials';

interface ActivityLogProps {
  taskId: string;
}

export function ActivityLog({ taskId }: ActivityLogProps) {
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const lastCountRef = useRef(0);

  const loadActivities = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);

      const res = await fetch(`/api/tasks/${taskId}/activities`);
      const data = await res.json();

      if (res.ok) {
        setActivities(data);
        lastCountRef.current = data.length;
      }
    } catch (error) {
      console.error('Failed to load activities:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  // Initial load
  useEffect(() => {
    loadActivities(true);
  }, [taskId, loadActivities]);

  // Polling function
  const pollForActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/activities`);
      if (res.ok) {
        const data = await res.json();
        // Only update if there are new activities
        if (data.length !== lastCountRef.current) {
          setActivities(data);
          lastCountRef.current = data.length;
        }
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, [taskId]); // setActivities is stable from React, no need to include

  // Poll for new activities every 5 seconds when task is in progress
  useEffect(() => {
    const pollInterval = setInterval(pollForActivities, 5000);

    pollingRef.current = pollInterval;

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [taskId, pollForActivities]);

  const getActivityBadge = (type: string) => {
    const base = 'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0';
    switch (type) {
      case 'spawned':
        return <div className={`${base} bg-amber-100 text-amber-600`}><Zap size={16} /></div>;
      case 'updated':
        return <div className={`${base} bg-blue-100 text-blue-600`}><PenLine size={16} /></div>;
      case 'completed':
        return <div className={`${base} bg-green-100 text-green-600`}><CheckCircle2 size={16} /></div>;
      case 'file_created':
        return <div className={`${base} bg-purple-100 text-purple-600`}><FileText size={16} /></div>;
      case 'status_changed':
        return <div className={`${base} bg-slate-100 text-slate-500`}><ArrowRightLeft size={16} /></div>;
      case 'dispatch_invocation':
        return <div className={`${base} bg-mc-accent/20 text-mc-accent`}><Zap size={16} /></div>;
      default:
        return <div className={`${base} bg-mc-bg-secondary text-mc-text-secondary`}><Activity size={16} /></div>;
    }
  };

  const getTraceUrl = (metadata?: string): string | null => {
    if (!metadata) return null;
    try {
      const parsed = JSON.parse(metadata) as Record<string, unknown>;
      const traceUrl = parsed.trace_url;
      return typeof traceUrl === 'string' && traceUrl ? traceUrl : null;
    } catch {
      return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-mc-text-secondary">Loading activities...</div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-mc-text-secondary">
        <div className="text-xl font-bold text-mc-text-secondary mb-2">No Activity</div>
        <p>No activity yet</p>
      </div>
    );
  }

  return (
    <div data-component="src/components/ActivityLog" className="space-y-3">
      {activities.map((activity) => (
        <div
          key={activity.id}
          className="flex gap-3 p-3 bg-mc-bg rounded-lg border border-mc-border"
        >
          {/* Icon */}
          {getActivityBadge(activity.activity_type)}

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Agent info */}
            {activity.agent && (
              <div className="flex items-center gap-2 mb-1">
                <AgentInitials name={activity.agent.name} size="sm" />
                <span className="text-sm font-medium text-mc-text">
                  {activity.agent.name}
                </span>
              </div>
            )}

            {/* Message */}
            <p className="text-sm text-mc-text break-words">
              {activity.message}
            </p>

            {/* Metadata */}
            {activity.metadata && (
              <div className="mt-2 p-2 bg-mc-bg-tertiary rounded text-xs text-mc-text-secondary font-mono">
                {typeof activity.metadata === 'string' 
                  ? activity.metadata 
                  : JSON.stringify(JSON.parse(activity.metadata), null, 2)}
              </div>
            )}

            {getTraceUrl(activity.metadata) && (
              <div className="mt-2">
                <a
                  href={getTraceUrl(activity.metadata) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-mc-accent hover:underline"
                >
                  Open session trace
                </a>
              </div>
            )}

            {/* Timestamp */}
            <div className="text-xs text-mc-text-secondary mt-2">
              {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
