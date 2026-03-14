/**
 * Discord Message Classification
 *
 * Uses llmJsonInfer to classify incoming Discord messages as:
 *   - task: an actionable work item (bug report, feature request, work assignment)
 *   - conversation: a question, discussion, or status update
 *   - clarification: the system needs more info before creating a task
 *
 * Falls back to rule-based keyword matching when LLM is unavailable.
 */

import { llmJsonInfer, llmInfer, isLlmAvailable } from '@/lib/llm';
import type { DiscordClassification } from '@/lib/types';

// ---------------------------------------------------------------------------
// Rule-based fallback
// ---------------------------------------------------------------------------

const TASK_SIGNALS = [
  'add support', 'implement', 'create', 'build', 'fix', 'resolve',
  'deploy', 'migrate', 'refactor', 'update', 'upgrade', 'remove',
  'delete', 'set up', 'configure', 'integrate', 'write', 'design',
  'should be', 'needs to', 'need to', 'please add', 'please fix',
  'broken', 'bug', 'error', 'crash', 'failing', 'not working',
];

const CONVERSATION_SIGNALS = [
  'do we', 'does anyone', 'how do', 'how does', 'what is',
  'what are', 'why is', 'why does', 'can someone', 'is there',
  'has anyone', 'thoughts on', 'opinion on', 'wondering',
  'just checking', 'fyi', 'heads up', 'btw', 'lol', 'thanks',
  'thank you', 'good morning', 'hello', 'hi everyone', 'hey',
];

function classifyByRules(message: string): DiscordClassification {
  const lower = message.toLowerCase().trim();

  let taskScore = 0;
  let convScore = 0;

  for (const signal of TASK_SIGNALS) {
    if (lower.includes(signal)) taskScore++;
  }
  for (const signal of CONVERSATION_SIGNALS) {
    if (lower.includes(signal)) convScore++;
  }

  // Short messages (under 10 words) lean conversational
  const wordCount = lower.split(/\s+/).length;
  if (wordCount < 5) convScore += 2;

  // Messages ending with ? lean conversational
  if (lower.endsWith('?')) convScore += 2;

  // Imperative sentences lean task
  const startsWithVerb = /^(add|fix|create|build|implement|deploy|update|remove|write|design|set|configure|integrate|migrate|refactor|resolve|upgrade|delete)\b/i.test(lower);
  if (startsWithVerb) taskScore += 3;

  if (taskScore > convScore) {
    return {
      type: 'task',
      confidence: Math.min(0.7, 0.4 + taskScore * 0.1),
      reasoning: 'Rule-based: task keywords detected',
      title: message.slice(0, 200),
      task_type: lower.includes('bug') || lower.includes('fix') || lower.includes('broken') ? 'bug' : 'feature',
      priority: lower.includes('urgent') || lower.includes('asap') || lower.includes('critical') ? 'urgent'
        : lower.includes('important') ? 'high' : 'normal',
    };
  }

  return {
    type: 'conversation',
    confidence: Math.min(0.7, 0.4 + convScore * 0.1),
    reasoning: 'Rule-based: conversational patterns detected',
  };
}

// ---------------------------------------------------------------------------
// LLM-based classification
// ---------------------------------------------------------------------------

const CLASSIFIER_SYSTEM_PROMPT = `You are a Discord message classifier for Styrmann, a mission control task management system.

Classify the message as one of:
- "task": actionable work item — bug report, feature request, work assignment, implementation request
- "conversation": discussion, question, status update, greeting, opinion request
- "clarification": the message suggests a task but is too vague to create one without more information

When type is "task", also extract:
- title: concise task title (max 200 chars)
- description: fuller description of what needs to be done
- task_type: one of "bug", "feature", "chore", "documentation", "research", "spike"
- priority: one of "low", "normal", "high", "urgent"

When type is "clarification", include:
- question: the specific clarification question to ask the user

Return ONLY a JSON object. No explanation, no markdown.
Schema: {"type": "task"|"conversation"|"clarification", "confidence": 0.0-1.0, "reasoning": "...", "title?": "...", "description?": "...", "task_type?": "...", "priority?": "...", "question?": "..."}`;

export async function classifyDiscordMessage(
  message: string,
  authorName?: string,
  channelContext?: string,
): Promise<DiscordClassification> {
  // Try LLM first
  if (isLlmAvailable()) {
    const user = [
      `Message: "${message}"`,
      authorName ? `Author: ${authorName}` : null,
      channelContext ? `Channel context: ${channelContext}` : null,
      '',
      'Return JSON classification:',
    ].filter(Boolean).join('\n');

    const result = await llmJsonInfer<DiscordClassification>(CLASSIFIER_SYSTEM_PROMPT, user);
    if (result && result.type) {
      return result;
    }
  }

  // Fallback to rules
  return classifyByRules(message);
}

// ---------------------------------------------------------------------------
// Conversational response
// ---------------------------------------------------------------------------

const RESPONDER_SYSTEM_PROMPT = `You are Styrmann, an AI assistant embedded in a Discord server for a software development team. You help with project coordination and task management.

Rules:
- Be concise and helpful
- If someone asks about project status, tasks, or work items, provide relevant information
- If you detect a message that might be a task request, suggest creating a task
- Keep responses under 2000 characters (Discord limit)
- Do not use markdown headers (# or ##) — Discord renders them poorly in bot messages
- Use **bold** and bullet points for structure if needed
- Be professional but friendly`;

export async function generateConversationalResponse(
  message: string,
  authorName?: string,
  context?: string,
): Promise<string | null> {
  if (!isLlmAvailable()) {
    return null;
  }

  const user = [
    `User "${authorName || 'Unknown'}" says: "${message}"`,
    context ? `\nContext: ${context}` : null,
    '\nRespond conversationally:',
  ].filter(Boolean).join('\n');

  const response = await llmInfer(RESPONDER_SYSTEM_PROMPT, user);
  if (response && response.length > 2000) {
    return response.slice(0, 1997) + '...';
  }
  return response;
}
