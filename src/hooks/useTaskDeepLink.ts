'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import type { Task } from '@/lib/types';

type TabType = 'overview' | 'planning' | 'proposals' | 'activity' | 'deliverables' | 'sessions';

const VALID_TABS: TabType[] = ['overview', 'planning', 'proposals', 'activity', 'deliverables', 'sessions'];

function isValidTab(value: string | null): value is TabType {
  return value !== null && (VALID_TABS as string[]).includes(value);
}

function readInitialTaskDeepLink(): { taskId: string | null; tab: TabType | undefined } {
  if (typeof window === 'undefined') return { taskId: null, tab: undefined };
  const params = new URLSearchParams(window.location.search);
  const taskId = params.get('task');
  const tabParam = params.get('tab');
  return {
    taskId,
    tab: isValidTab(tabParam) ? tabParam : undefined,
  };
}

/**
 * Syncs task modal open/close + active tab with URL query params.
 *
 * URL shape: ?task=<id>&tab=<tab>
 *
 * - On mount: reads ?task= from URL and fetches the task to auto-open.
 * - On openTask: pushes ?task=<id> to the URL.
 * - On closeTask: removes ?task= and ?tab= from the URL.
 * - On tab change: updates ?tab= in the URL.
 */
export function useTaskDeepLink() {
  const [linkedTask, setLinkedTask] = useState<Task | null>(null);
  const [initialTab, setInitialTab] = useState<TabType | undefined>(() => readInitialTaskDeepLink().tab);
  const [loading, setLoading] = useState(() => Boolean(readInitialTaskDeepLink().taskId));
  const initializedRef = useRef(false);

  // Read URL on mount and resolve the task
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const { taskId } = readInitialTaskDeepLink();
    if (!taskId) return;

    fetch(`/api/tasks/${taskId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Task not found');
        return res.json();
      })
      .then((task: Task) => {
        setLinkedTask(task);
      })
      .catch((error) => {
        console.error('Failed to load deep-linked task:', error);
        // Remove invalid task param from URL
        const url = new URL(window.location.href);
        url.searchParams.delete('task');
        url.searchParams.delete('tab');
        window.history.replaceState({}, '', url.toString());
      })
      .finally(() => setLoading(false));
  }, []);

  const openTask = useCallback((task: Task) => {
    setLinkedTask(task);
    setInitialTab(undefined);

    const url = new URL(window.location.href);
    url.searchParams.set('task', task.id);
    url.searchParams.delete('tab');
    window.history.pushState({}, '', url.toString());
  }, []);

  const closeTask = useCallback(() => {
    setLinkedTask(null);
    setInitialTab(undefined);

    const url = new URL(window.location.href);
    url.searchParams.delete('task');
    url.searchParams.delete('tab');
    url.searchParams.delete('trace');
    window.history.pushState({}, '', url.toString());
  }, []);

  const updateTab = useCallback((tab: TabType) => {
    const url = new URL(window.location.href);
    if (tab === 'overview') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', tab);
    }
    window.history.replaceState({}, '', url.toString());
  }, []);

  // Listen for browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const taskId = params.get('task');

      if (!taskId) {
        setLinkedTask(null);
        setInitialTab(undefined);
        return;
      }

      // If the current linked task matches, just update tab
      if (linkedTask && linkedTask.id === taskId) {
        const tabParam = params.get('tab');
        if (isValidTab(tabParam)) {
          setInitialTab(tabParam);
        }
        return;
      }

      // Different task — fetch it
      fetch(`/api/tasks/${taskId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((task: Task | null) => {
          if (task) {
            setLinkedTask(task);
            const tabParam = params.get('tab');
            setInitialTab(isValidTab(tabParam) ? tabParam : undefined);
          } else {
            setLinkedTask(null);
          }
        })
        .catch(() => setLinkedTask(null));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [linkedTask]);

  return {
    /** Task resolved from URL deep link (null if none) */
    linkedTask,
    /** Initial tab from URL (undefined if not specified) */
    initialTab,
    /** Whether deep-linked task is still loading */
    loading,
    /** Open a task and push to URL */
    openTask,
    /** Close the modal and clean URL */
    closeTask,
    /** Update the tab in URL without navigation */
    updateTab,
  };
}
