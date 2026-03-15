'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  RefreshCw,
  CheckCircle2,
  ListTodo,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import type { DiscordMessage } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

interface DiscordMessagesViewProps {
  workspaceId: string;
}

type ClassificationFilter = 'all' | 'task' | 'conversation' | 'clarification';

const CLASSIFICATION_ICONS: Record<string, React.ReactNode> = {
  task: <ListTodo className="w-4 h-4 text-mc-accent-green" />,
  conversation: <MessageSquare className="w-4 h-4 text-mc-accent" />,
  clarification: <HelpCircle className="w-4 h-4 text-mc-accent-yellow" />,
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  task: 'Task',
  conversation: 'Conversation',
  clarification: 'Clarification',
};

export function DiscordMessagesView({ workspaceId }: DiscordMessagesViewProps) {
  const [messages, setMessages] = useState<DiscordMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ClassificationFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(true);

  const fetchMessages = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ workspace_id: workspaceId });
      if (filter !== 'all') params.set('classification', filter);

      const res = await fetch(`/api/discord/messages?${params}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(Array.isArray(data) ? data : []);
        setIsConfigured(true);
      } else {
        setIsConfigured(false);
        setError(null);
      }
    } catch (err) {
      setIsConfigured(false);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, filter]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const taskCount = messages.filter(m => m.classification === 'task').length;
  const conversationCount = messages.filter(m => m.classification === 'conversation').length;
  const clarificationCount = messages.filter(m => m.classification === 'clarification').length;

  return (
    <div
      data-component="src/components/DiscordMessagesView"
      className="flex-1 flex flex-col overflow-hidden"
    >
      <div className="p-3 min-h-12 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">Discord Messages</span>
          {messages.length > 0 && (
            <span className="text-xs text-mc-text-secondary hidden sm:inline">
              {taskCount} tasks, {conversationCount} convos, {clarificationCount} clarifications
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as ClassificationFilter)}
            className="px-2 py-1.5 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
          >
            <option value="all">All</option>
            <option value="task">Tasks</option>
            <option value="conversation">Conversations</option>
            <option value="clarification">Clarifications</option>
          </select>
          {isConfigured && (
            <button
              onClick={fetchMessages}
              disabled={loading}
              className="flex items-center gap-1.5 px-2 py-1.5 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-mc-text-secondary" />
          </div>
        ) : !isConfigured ? (
          <div className="text-center py-12">
            <MessageSquare className="w-12 h-12 text-mc-border mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Discord integration not configured</h3>
            <p className="text-sm text-mc-text-secondary max-w-xl mx-auto">
              Discord integration not configured. Set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID in your environment to enable Discord message tracking.
            </p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-mc-accent-red/20 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-mc-accent-red" />
            </div>
            <p className="text-sm text-mc-accent-red">{error}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="w-12 h-12 text-mc-border mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Discord Messages</h3>
            <p className="text-sm text-mc-text-secondary">
              {filter === 'all'
                ? 'No messages have been processed by the Discord bot yet.'
                : `No ${filter} messages found.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3 hover:border-mc-accent/40 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex-shrink-0">
                    {CLASSIFICATION_ICONS[msg.classification] || <MessageSquare className="w-4 h-4" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-medium text-mc-accent px-1.5 py-0.5 rounded bg-mc-accent/10 flex-shrink-0">
                          {msg.discord_author_name}
                        </span>
                        <span className="text-xs text-mc-text-secondary flex-shrink-0">
                          {CLASSIFICATION_LABELS[msg.classification] || msg.classification}
                        </span>
                      </div>
                      <span className="text-xs text-mc-text-secondary flex-shrink-0">
                        {formatDistanceToNow(new Date(msg.created_at + 'Z'), { addSuffix: true })}
                      </span>
                    </div>

                    <p className="text-sm mb-2 break-words">{msg.content.slice(0, 500)}{msg.content.length > 500 ? '...' : ''}</p>

                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {msg.discord_thread_id && (
                          <span className="text-xs text-mc-text-secondary flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" />
                            Thread
                          </span>
                        )}
                      </div>

                      {msg.task_id && (
                        <span className="text-xs text-mc-accent-green flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {msg.task_title || 'Linked to task'}
                          {msg.task_status && (
                            <span className="text-mc-text-secondary">({msg.task_status})</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
