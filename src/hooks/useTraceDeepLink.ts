'use client';

import { useCallback, useState } from 'react';

/**
 * Syncs trace viewer open/close with the `?trace=` URL query parameter.
 *
 * The trace param is a plain openclaw_session_id (no encoding of full paths).
 * URL shape: `?task=<id>&tab=sessions&trace=<sessionId>`
 *
 * Also tracks the associated taskId for trace resolution.
 * Works alongside `useTaskDeepLink` which owns `?task=` and `?tab=`.
 */
export function useTraceDeepLink() {
  const [traceSessionId, setTraceSessionId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('trace');
  });
  const [traceTaskId, setTraceTaskId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('trace') ? params.get('task') : null;
  });

  const openTrace = useCallback((sessionId: string | null, taskId?: string) => {
    setTraceSessionId(sessionId);
    if (taskId) setTraceTaskId(taskId);
    const url = new URL(window.location.href);
    if (sessionId) {
      url.searchParams.set('trace', sessionId);
    } else {
      url.searchParams.delete('trace');
    }
    window.history.replaceState({}, '', url.toString());
  }, []);

  const closeTrace = useCallback(() => {
    setTraceSessionId(null);
    setTraceTaskId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('trace');
    window.history.replaceState({}, '', url.toString());
  }, []);

  return { traceSessionId, traceTaskId, openTrace, closeTrace };
}
