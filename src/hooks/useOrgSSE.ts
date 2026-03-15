'use client';

import { useEffect, useRef } from 'react';
import type { SSEEvent } from '@/lib/types';

interface UseOrgSSEOptions {
  onTicketChange?: () => void;
  onSprintChange?: () => void;
  onMilestoneChange?: () => void;
  onKnowledgeChange?: () => void;
}

export function useOrgSSE(options: UseOrgSSEOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = (event) => {
      try {
        const data: SSEEvent = JSON.parse(event.data);
        switch (data.type) {
          case 'org_ticket_created':
          case 'org_ticket_updated':
          case 'org_ticket_deleted':
            optionsRef.current.onTicketChange?.();
            break;
          case 'org_sprint_created':
          case 'org_sprint_updated':
          case 'org_sprint_deleted':
            optionsRef.current.onSprintChange?.();
            break;
          case 'org_milestone_created':
          case 'org_milestone_updated':
          case 'org_milestone_deleted':
            optionsRef.current.onMilestoneChange?.();
            break;
          case 'knowledge_synthesized':
          case 'knowledge_article_archived':
            optionsRef.current.onKnowledgeChange?.();
            break;
        }
      } catch {}
    };

    return () => eventSource.close();
  }, []);
}
