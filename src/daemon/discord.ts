import { Client, Events, GatewayIntentBits, type Message, type TextBasedChannel, type ThreadChannel } from 'discord.js';
import { createLogger } from './logger';
import { mcFetch } from './bridge';
import { initVoice } from './discord-voice';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('discord');

const COMPLETION_POLL_MS = 30_000;
const CLARIFICATION_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

interface ClassifyResponse {
  type: 'task' | 'conversation' | 'clarification';
  confidence: number;
  reasoning: string;
  title?: string;
  description?: string;
  task_type?: string;
  priority?: string;
  question?: string;
}

interface TaskResponse {
  id: string;
  title: string;
  status: string;
  priority: string;
  task_type: string;
}

interface OrgTicketResponse {
  id: string;
  title: string;
  status: string;
  priority: string;
  ticket_type: string;
}

interface DelegationResponse {
  success: boolean;
  task_ids: string[];
  error?: string;
  llm_used: boolean;
}

interface CompletionEntry {
  id: string;
  discord_channel_id: string;
  discord_author_id: string;
  discord_author_name: string;
  discord_thread_id?: string;
  task_id: string;
  task_title: string;
}

interface PendingClarification {
  originalContent: string;
  question: string;
  classificationData: ClassifyResponse;
  contextId: string;
  createdAt: number;
}

const pendingClarifications = new Map<string, PendingClarification>();

function clarificationKey(channelId: string, authorId: string): string {
  return `${channelId}:${authorId}`;
}

function parseChannelFilter(): Set<string> | null {
  const raw = process.env.DISCORD_CHANNEL_IDS;
  if (!raw) return null;
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

function shouldProcessMessage(message: Message, channelFilter: Set<string> | null, botId: string | null): boolean {
  if (message.author.bot) return false;
  if (channelFilter) return channelFilter.has(message.channelId);
  if (botId && message.mentions.has(botId)) return true;
  return false;
}

async function classifyMessage(content: string, authorName: string): Promise<ClassifyResponse | null> {
  try {
    const res = await mcFetch('/api/discord/classify', {
      method: 'POST',
      body: JSON.stringify({ message: content, author_name: authorName }),
    });
    if (!res.ok) {
      log.warn(`Classification failed: ${res.status}`);
      return null;
    }
    return await res.json() as ClassifyResponse;
  } catch (err) {
    log.error('Classification request failed:', err);
    return null;
  }
}

const VALID_TICKET_TYPES = new Set(['feature', 'bug', 'improvement', 'task', 'epic']);

function toTicketType(taskType?: string): string {
  if (taskType && VALID_TICKET_TYPES.has(taskType)) return taskType;
  return 'task';
}

async function getWorkspaceOrgId(workspaceId: string): Promise<string | null> {
  try {
    const res = await mcFetch(`/api/workspaces/${workspaceId}`);
    if (!res.ok) {
      log.warn(`Failed to fetch workspace ${workspaceId}: ${res.status}`);
      return null;
    }
    const workspace = await res.json() as { organization_id?: string };
    return workspace.organization_id || null;
  } catch (err) {
    log.error('Failed to fetch workspace:', err);
    return null;
  }
}

async function createTask(classification: ClassifyResponse, content: string, workspaceId: string): Promise<TaskResponse | null> {
  try {
    const orgId = await getWorkspaceOrgId(workspaceId);
    if (!orgId) {
      log.warn('No organization_id found for workspace — cannot create org ticket');
      return null;
    }

    const title = classification.title || content.slice(0, 200);

    const ticketRes = await mcFetch('/api/org-tickets', {
      method: 'POST',
      headers: { 'x-mc-system': 'daemon' },
      body: JSON.stringify({
        organization_id: orgId,
        title,
        description: classification.description || content,
        ticket_type: toTicketType(classification.task_type),
        priority: classification.priority || 'normal',
        external_system: 'discord',
        creator_name: 'discord-daemon',
      }),
    });

    if (!ticketRes.ok) {
      log.warn(`Org ticket creation failed: ${ticketRes.status}`);
      return null;
    }

    const ticket = await ticketRes.json() as OrgTicketResponse;
    log.info(`Created org ticket ${ticket.id}: "${ticket.title}"`);

    const delegateRes = await mcFetch(`/api/org-tickets/${ticket.id}/delegate`, {
      method: 'POST',
      headers: { 'x-mc-system': 'daemon' },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });

    if (!delegateRes.ok) {
      log.warn(`Org ticket delegation failed: ${delegateRes.status}`);
      return {
        id: ticket.id,
        title: ticket.title,
        status: 'inbox',
        priority: ticket.priority,
        task_type: classification.task_type || 'feature',
      };
    }

    const delegation = await delegateRes.json() as DelegationResponse;
    const primaryTaskId = delegation.task_ids?.[0] || ticket.id;
    log.info(`Delegated org ticket ${ticket.id} -> tasks: [${delegation.task_ids.join(', ')}]`);

    return {
      id: primaryTaskId,
      title: ticket.title,
      status: 'inbox',
      priority: ticket.priority,
      task_type: classification.task_type || 'feature',
    };
  } catch (err) {
    log.error('Org ticket creation/delegation failed:', err);
    return null;
  }
}

async function getConversationalResponse(content: string, authorName: string): Promise<string | null> {
  try {
    const res = await mcFetch('/api/discord/respond', {
      method: 'POST',
      body: JSON.stringify({ message: content, author_name: authorName }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { response?: string };
    return data.response || null;
  } catch {
    return null;
  }
}

async function storeDiscordMessage(
  message: Message,
  classification: string,
  taskId: string | null,
  workspaceId: string,
  threadId?: string,
): Promise<string | null> {
  try {
    const res = await mcFetch('/api/discord/messages', {
      method: 'POST',
      body: JSON.stringify({
        discord_message_id: message.id,
        discord_channel_id: message.channelId,
        discord_guild_id: message.guildId || '',
        discord_author_id: message.author.id,
        discord_author_name: message.author.displayName || message.author.username,
        content: message.content,
        classification,
        task_id: taskId,
        workspace_id: workspaceId,
        discord_thread_id: threadId || undefined,
      }),
    });
    if (res.ok) {
      const data = await res.json() as { id: string };
      return data.id;
    }
    return null;
  } catch (err) {
    log.warn('Failed to store discord message record:', err);
    return null;
  }
}

async function storeClarificationContext(
  channelId: string,
  authorId: string,
  messageDbId: string,
  originalContent: string,
  question: string,
  classificationData: ClassifyResponse,
  workspaceId: string,
): Promise<string | null> {
  try {
    const res = await mcFetch('/api/discord/clarifications', {
      method: 'POST',
      body: JSON.stringify({
        discord_channel_id: channelId,
        discord_author_id: authorId,
        original_message_id: messageDbId,
        original_content: originalContent,
        question,
        classification_data: classificationData,
        workspace_id: workspaceId,
      }),
    });
    if (res.ok) {
      const data = await res.json() as { id: string };
      return data.id;
    }
    return null;
  } catch (err) {
    log.warn('Failed to store clarification context:', err);
    return null;
  }
}

async function resolveClarificationContext(contextId: string): Promise<void> {
  try {
    await mcFetch(`/api/discord/clarifications/${contextId}/resolve`, {
      method: 'POST',
    });
  } catch (err) {
    log.warn('Failed to resolve clarification context:', err);
  }
}

async function tryCreateThread(message: Message, taskTitle: string): Promise<string | undefined> {
  try {
    if (!message.channel || !('threads' in message.channel)) return undefined;
    const threadName = `Task: ${taskTitle.slice(0, 95)}`;
    const thread = await message.startThread({
      name: threadName,
      autoArchiveDuration: 1440,
    });
    return thread.id;
  } catch (err) {
    log.warn('Failed to create thread:', err);
    return undefined;
  }
}

async function handleClarificationResponse(
  message: Message,
  pending: PendingClarification,
  workspaceId: string,
  stats: DaemonStats,
): Promise<void> {
  const key = clarificationKey(message.channelId, message.author.id);
  pendingClarifications.delete(key);

  const combinedContent = `Original request: ${pending.originalContent}\n\nClarification response: ${message.content}`;
  const authorName = message.author.displayName || message.author.username;

  const reClassification = await classifyMessage(combinedContent, authorName);
  if (!reClassification) {
    await message.reply('Thanks for the clarification. I had trouble processing it — please try rephrasing.');
    return;
  }

  if (reClassification.type === 'task') {
    const task = await createTask(reClassification, combinedContent, workspaceId);
    if (task) {
      const threadId = await tryCreateThread(message, task.title);
      await storeDiscordMessage(message, 'task', task.id, workspaceId, threadId);
      await resolveClarificationContext(pending.contextId);
      stats.discordTasksCreated = (stats.discordTasksCreated || 0) + 1;

      const confirmTarget = threadId
        ? await message.client.channels.fetch(threadId).catch(() => null) as TextBasedChannel | null
        : null;

      const confirmText = `Task created: **${task.title}**\nPriority: ${task.priority} | Type: ${task.task_type}`;
      if (confirmTarget && 'send' in confirmTarget) {
        await confirmTarget.send(confirmText);
      } else {
        await message.reply(confirmText);
      }
    } else {
      await message.reply('I detected a task from your clarification but failed to create it. Please try again.');
    }
  } else if (reClassification.type === 'clarification') {
    await storeDiscordMessage(message, 'clarification', null, workspaceId);
    await message.reply(reClassification.question || 'Could you provide more details?');
  } else {
    await storeDiscordMessage(message, 'conversation', null, workspaceId);
    await resolveClarificationContext(pending.contextId);
    const response = await getConversationalResponse(combinedContent, authorName);
    if (response) await message.reply(response);
  }

  stats.discordMessagesProcessed = (stats.discordMessagesProcessed || 0) + 1;
}

async function handleMessage(message: Message, workspaceId: string, stats: DaemonStats): Promise<void> {
  const authorName = message.author.displayName || message.author.username;
  const key = clarificationKey(message.channelId, message.author.id);

  const pending = pendingClarifications.get(key);
  if (pending && (Date.now() - pending.createdAt) < CLARIFICATION_EXPIRY_MS) {
    await handleClarificationResponse(message, pending, workspaceId, stats);
    return;
  }
  if (pending) {
    pendingClarifications.delete(key);
    await resolveClarificationContext(pending.contextId);
  }

  const classification = await classifyMessage(message.content, authorName);

  if (!classification) {
    return;
  }

  log.info(`[${classification.type}] "${message.content.slice(0, 80)}" by ${authorName} (confidence: ${classification.confidence})`);

  if (classification.type === 'task') {
    const task = await createTask(classification, message.content, workspaceId);
    if (task) {
      const threadId = await tryCreateThread(message, task.title);
      await storeDiscordMessage(message, 'task', task.id, workspaceId, threadId);
      stats.discordTasksCreated = (stats.discordTasksCreated || 0) + 1;

      const confirmText = `Task created: **${task.title}**\nPriority: ${task.priority} | Type: ${task.task_type}`;
      if (threadId) {
        const thread = await message.client.channels.fetch(threadId).catch(() => null) as TextBasedChannel | null;
        if (thread && 'send' in thread) {
          await thread.send(confirmText);
        } else {
          await message.reply(confirmText);
        }
      } else {
        await message.reply(confirmText);
      }
    } else {
      await message.reply('I detected a task but failed to create it. Please try again.');
    }
  } else if (classification.type === 'clarification') {
    const messageDbId = await storeDiscordMessage(message, 'clarification', null, workspaceId);
    const question = classification.question || 'Could you provide more details about what you need?';

    if (messageDbId) {
      const contextId = await storeClarificationContext(
        message.channelId,
        message.author.id,
        messageDbId,
        message.content,
        question,
        classification,
        workspaceId,
      );

      if (contextId) {
        pendingClarifications.set(key, {
          originalContent: message.content,
          question,
          classificationData: classification,
          contextId,
          createdAt: Date.now(),
        });
      }
    }

    await message.reply(question);
  } else {
    const response = await getConversationalResponse(message.content, authorName);
    await storeDiscordMessage(message, 'conversation', null, workspaceId);
    if (response) {
      await message.reply(response);
    }
  }

  stats.discordMessagesProcessed = (stats.discordMessagesProcessed || 0) + 1;
}

async function checkCompletions(client: Client, stats: DaemonStats): Promise<void> {
  try {
    const res = await mcFetch('/api/discord/completions');
    if (!res.ok) return;

    const completions = await res.json() as CompletionEntry[];
    if (!Array.isArray(completions) || completions.length === 0) return;

    const ackIds: string[] = [];

    for (const entry of completions) {
      try {
        const targetChannelId = entry.discord_thread_id || entry.discord_channel_id;
        const channel = await client.channels.fetch(targetChannelId).catch(() => null) as TextBasedChannel | null;

        const fallbackChannel = !channel && entry.discord_thread_id
          ? await client.channels.fetch(entry.discord_channel_id).catch(() => null) as TextBasedChannel | null
          : null;

        const sendTo = (channel && 'send' in channel) ? channel : (fallbackChannel && 'send' in fallbackChannel) ? fallbackChannel : null;

        if (sendTo) {
          await sendTo.send(
            `Task completed: **${entry.task_title}**\n` +
            `Originally requested by <@${entry.discord_author_id}>`,
          );
          ackIds.push(entry.id);
          stats.discordCompletionsSent = (stats.discordCompletionsSent || 0) + 1;
        }
      } catch (sendErr) {
        log.warn(`Failed to send completion for ${entry.id}:`, sendErr);
      }
    }

    if (ackIds.length > 0) {
      await mcFetch('/api/discord/completions/ack', {
        method: 'POST',
        body: JSON.stringify({ ids: ackIds }),
      });
      log.info(`Sent ${ackIds.length} completion notifications`);
    }
  } catch (err) {
    log.error('Completion check failed:', err);
  }
}

export function startDiscord(_config: DaemonConfig, stats: DaemonStats): () => void {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    log.info('DISCORD_BOT_TOKEN not set — Discord integration disabled');
    return () => {};
  }

  const workspaceId = process.env.DISCORD_WORKSPACE_ID || 'default';
  const channelFilter = parseChannelFilter();

  let client: Client | null = null;
  let completionTimer: ReturnType<typeof setInterval> | null = null;
  let stopVoice: (() => void) | null = null;

  async function init() {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });

    client.on(Events.ClientReady, (c) => {
      log.info(`Bot logged in as ${c.user.tag}`);
      if (channelFilter) {
        log.info(`Monitoring channels: ${[...channelFilter].join(', ')}`);
      } else {
        log.info('No DISCORD_CHANNEL_IDS set — responding to @mentions only');
      }
      stats.discordConnected = true;
    });

    client.on(Events.MessageCreate, async (message) => {
      if (!shouldProcessMessage(message, channelFilter, client?.user?.id || null)) return;

      try {
        await handleMessage(message, workspaceId, stats);
      } catch (err) {
        log.error('Message handling failed:', err);
      }
    });

    client.on('error', (err) => {
      log.error('Client error:', err);
    });

    await client.login(token);

    stopVoice = initVoice(client, stats);

    completionTimer = setInterval(() => {
      if (client) checkCompletions(client, stats).catch(() => {});
    }, COMPLETION_POLL_MS);
  }

  init().catch((err) => {
    log.error('Bot failed to start:', err);
    stats.discordConnected = false;
  });

  return () => {
    if (stopVoice) stopVoice();
    if (completionTimer) clearInterval(completionTimer);
    pendingClarifications.clear();
    if (client) {
      client.destroy();
      log.info('Bot disconnected');
    }
    stats.discordConnected = false;
  };
}
