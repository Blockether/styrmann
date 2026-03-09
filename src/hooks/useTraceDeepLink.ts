'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Syncs trace viewer open/close with the `?trace=` URL query parameter.
 *
 * - On mount: reads `?trace=` from URL and decodes it as the initial traceUrl.
 * - On openTrace: encodes the path into `?trace=`.
 * - On closeTrace: removes `?trace=` from the URL.
 *
 * Works alongside `useTaskDeepLink` which owns `?task=` and `?tab=`.
 */
export function useTraceDeepLink() {
  const [traceUrl, setTraceUrl] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // Read ?trace= on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const encodedTrace = params.get('trace');
    if (encodedTrace) {
      try {
        setTraceUrl(decodeURIComponent(encodedTrace));
      } catch {
        // Malformed — remove from URL
        const url = new URL(window.location.href);
        url.searchParams.delete('trace');
        window.history.replaceState({}, '', url.toString());
      }
    }
  }, []);

  const openTrace = useCallback((url: string | null) => {
    setTraceUrl(url);
    const windowUrl = new URL(window.location.href);
    if (url) {
      windowUrl.searchParams.set('trace', encodeURIComponent(url));
    } else {
      windowUrl.searchParams.delete('trace');
    }
    window.history.replaceState({}, '', windowUrl.toString());
  }, []);

  const closeTrace = useCallback(() => {
    setTraceUrl(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('trace');
    window.history.replaceState({}, '', url.toString());
  }, []);

  return { traceUrl, openTrace, closeTrace };
}
