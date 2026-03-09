'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [traceSessionId, setTraceSessionId] = useState<string | null>(null);
  const [traceTaskId, setTraceTaskId] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // Read ?trace= on mount (taskId comes from ?task= which useTaskDeepLink manages)
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const traceParam = params.get('trace');
    const taskParam = params.get('task');
    if (traceParam) {
      setTraceSessionId(traceParam);
      if (taskParam) setTraceTaskId(taskParam);
    }
  }, []);

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
