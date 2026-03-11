import type { TaskActivity } from '@/lib/types';

// ── Helpers ──────────────────────────────────────────────────────────

function extractAgentName(metadata: Record<string, unknown> | null, message: string): string | null {
  if (typeof metadata?.agent_name === 'string') return metadata.agent_name;
  if (typeof metadata?.handoff_role === 'string') return metadata.handoff_role;
  const match = message.match(/(?:->|to|by)\s+(\w[\w\s]*?)(?:\s*\(|$|,|\.)/i);
  return match?.[1]?.trim() || null;
}

function extractStep(metadata: Record<string, unknown> | null): string | null {
  if (typeof metadata?.workflow_step === 'string') return metadata.workflow_step;
  if (typeof metadata?.handoff_role === 'string') return metadata.handoff_role;
  return null;
}

function extractSkillCount(invocation: string): number {
  const match = invocation.match(/Skills?:\s*([^.]+)/i);
  if (!match) return 0;
  return match[1].split(',').filter((s) => s.trim().length > 0).length;
}

function shortenPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 3 ? `.../${parts.slice(-2).join('/')}` : p;
}

// ── Per-Type Semantic Summarization ──────────────────────────────────

function summarizeDispatch(message: string, metadata: Record<string, unknown> | null): string {
  const invocation = typeof metadata?.invocation === 'string' ? metadata.invocation : message;
  const outputDir = typeof metadata?.output_directory === 'string' ? shortenPath(metadata.output_directory) : null;
  const agent = extractAgentName(metadata, message);
  const step = extractStep(metadata);
  const skillCount = extractSkillCount(invocation);

  const parts: string[] = [];
  if (agent) {
    parts.push(`Dispatched ${agent}`);
  } else {
    parts.push('Agent dispatched');
  }
  if (step) parts.push(`for ${step} step`);
  if (skillCount > 0) parts.push(`with ${skillCount} skill(s)`);
  if (outputDir) parts.push(`writing to ${outputDir}`);
  return `${parts.join(' ')}.`;
}

function summarizeStatusChange(message: string, metadata: Record<string, unknown> | null): string {
  const agent = extractAgentName(metadata, message);
  const step = extractStep(metadata);
  const failReason = typeof metadata?.fail_reason === 'string' ? metadata.fail_reason : null;
  const failTarget = typeof metadata?.fail_target === 'string' ? metadata.fail_target : null;

  if (failReason) {
    return `Stage failed${step ? ` at ${step}` : ''}: ${failReason}. Looping back to ${failTarget || 'builder'}.`;
  }

  if (message.toLowerCase().includes('handoff')) {
    return agent
      ? `Stage handoff to ${agent}${step ? ` for ${step}` : ''}.`
      : `Stage handoff${step ? ` to ${step}` : ''}.`;
  }

  // Generic status change — extract from/to if present
  const statusMatch = message.match(/(\w+)\s*(?:->|to)\s*(\w+)/i);
  if (statusMatch) {
    return `Task moved from ${statusMatch[1]} to ${statusMatch[2]}${agent ? ` (${agent})` : ''}.`;
  }

  return message.length > 200 ? `${message.slice(0, 200)}...` : message;
}

function summarizeTestResult(activityType: string, message: string, metadata: Record<string, unknown> | null): string {
  const passed = activityType === 'test_passed';
  const results = Array.isArray(metadata?.results)
    ? (metadata.results as Array<Record<string, unknown>>)
    : [];

  if (results.length > 0) {
    const passCount = results.filter((r) => r.passed).length;
    const failCount = results.length - passCount;
    const notable = results
      .filter((r) => !r.passed)
      .slice(0, 3)
      .map((r) => String(r.deliverable || 'unknown'));
    const suffix = failCount > 0 && notable.length > 0
      ? ` Failed: ${notable.join(', ')}.`
      : '';
    return `QA ${passed ? 'passed' : 'failed'}: ${passCount}/${results.length} checks passed.${suffix}`;
  }

  return `QA ${passed ? 'passed' : 'failed'}.`;
}

function summarizeCompletion(message: string, metadata: Record<string, unknown> | null): string {
  const agent = extractAgentName(metadata, message);
  // Extract TASK_COMPLETE summary if present
  const completeMatch = message.match(/TASK_COMPLETE:\s*(.+?)(?:\s*\||\s*$)/i);
  if (completeMatch) {
    return `${agent || 'Agent'} completed: ${completeMatch[1].trim().slice(0, 160)}`;
  }
  return agent ? `${agent} completed their work.` : 'Agent work completed.';
}

function summarizeSpawn(message: string, metadata: Record<string, unknown> | null): string {
  const agent = extractAgentName(metadata, message);
  return agent ? `Sub-agent ${agent} spawned.` : 'Sub-agent spawned.';
}

function summarizeFileCreated(message: string, metadata: Record<string, unknown> | null): string {
  const filePath = typeof metadata?.path === 'string' ? shortenPath(metadata.path) : null;
  const fileType = typeof metadata?.deliverable_type === 'string' ? metadata.deliverable_type : 'file';
  return filePath
    ? `Deliverable ${fileType} created: ${filePath}`
    : `Deliverable ${fileType} created.`;
}

function summarizeHttpOrPayload(message: string): string {
  // Extract method + URL from curl-like or HTTP request patterns
  const curlMatch = message.match(/curl\s+(?:-[A-Z]+\s+)?(?:-X\s+)?(\w+)?\s+['"]?(https?:\/\/[^\s'"]+)/i);
  if (curlMatch) {
    const method = curlMatch[1] || 'GET';
    const url = new URL(curlMatch[2]);
    return `HTTP ${method} request sent to ${url.hostname}${url.pathname}.`;
  }

  const httpMatch = message.match(/(GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/[^\s]+)/i);
  if (httpMatch) {
    const url = new URL(httpMatch[2]);
    return `HTTP ${httpMatch[1]} request sent to ${url.hostname}${url.pathname}.`;
  }

  // Generic payload/JSON — just condense
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 200 ? `${compact.slice(0, 200)}...` : compact;
}

// ── Main Entry Points ────────────────────────────────────────────────

function summarizeTechnicalDetails(activityType: string | null, message: string, metadata: Record<string, unknown> | null): string {
  switch (activityType) {
    case 'dispatch_invocation':
      return summarizeDispatch(message, metadata);
    case 'status_changed':
      return summarizeStatusChange(message, metadata);
    case 'test_passed':
    case 'test_failed':
      return summarizeTestResult(activityType, message, metadata);
    case 'completed':
      return summarizeCompletion(message, metadata);
    case 'spawned':
      return summarizeSpawn(message, metadata);
    case 'file_created':
      return summarizeFileCreated(message, metadata);
    default:
      break;
  }

  // Heuristic fallback for untyped technical content
  if (/curl|http request|payload|json/i.test(message)) {
    return summarizeHttpOrPayload(message);
  }

  // Pass through short messages, condense long ones
  if (message.length > 200) {
    return `${message.replace(/\s+/g, ' ').trim().slice(0, 200)}...`;
  }

  return message;
}

export function summarizeFeedItem(
  message: string,
  metadata: Record<string, unknown> | null,
  source: 'activity' | 'agent_log',
  activityType: string | null,
): string {
  if (source === 'agent_log') {
    const compact = message.replace(/\s+/g, ' ').trim();
    return compact.length > 160 ? `${compact.slice(0, 160)}...` : compact;
  }

  return summarizeTechnicalDetails(activityType, message, metadata);
}

export function summarizeTaskActivity(
  activity: Pick<TaskActivity, 'activity_type' | 'message' | 'technical_details' | 'metadata'>,
): string {
  const normalizedMessage = typeof activity.message === 'string' ? activity.message : String(activity.message ?? '');
  const metadata =
    activity.technical_details ||
    (() => {
      if (!activity.metadata) return null;
      try {
        const parsed = JSON.parse(activity.metadata);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    })();

  return summarizeTechnicalDetails(activity.activity_type, normalizedMessage, metadata);
}
