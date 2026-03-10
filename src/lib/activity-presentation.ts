import type { TaskActivity } from '@/lib/types';

function summarizeInvocation(invocation: string): string {
  const compact = invocation.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function summarizeTechnicalDetails(activityType: string | null, message: string, metadata: Record<string, unknown> | null): string {
  if (activityType === 'dispatch_invocation') {
    const invocation = typeof metadata?.invocation === 'string' ? metadata.invocation : message;
    const outputDirectory = typeof metadata?.output_directory === 'string' ? metadata.output_directory : null;
    return outputDirectory
      ? `Dispatch issued with workflow instructions. Output directory: ${outputDirectory}. ${summarizeInvocation(invocation)}`
      : `Dispatch issued with workflow instructions. ${summarizeInvocation(invocation)}`;
  }

  if (activityType === 'test_failed' || activityType === 'test_passed') {
    const results = Array.isArray(metadata?.results) ? metadata.results as Array<Record<string, unknown>> : [];
    if (results.length > 0) {
      const notable = results.slice(0, 2).map((result) => `${result.deliverable}: ${result.passed ? 'pass' : 'fail'}`).join('; ');
      return `${message} ${notable}`;
    }
  }

  if (/curl|http request|payload|json/i.test(message)) {
    return message.replace(/\s+/g, ' ').trim().slice(0, 220);
  }

  return message;
}

export function summarizeFeedItem(message: string, metadata: Record<string, unknown> | null, source: 'activity' | 'agent_log', activityType: string | null): string {
  if (source === 'agent_log') {
    const compact = message.replace(/\s+/g, ' ').trim();
    return compact.length > 160 ? `${compact.slice(0, 160)}...` : compact;
  }

  return summarizeTechnicalDetails(activityType, message, metadata);
}

export function summarizeTaskActivity(activity: Pick<TaskActivity, 'activity_type' | 'message' | 'technical_details' | 'metadata'>): string {
  const metadata = activity.technical_details || (() => {
    if (!activity.metadata) return null;
    try {
      const parsed = JSON.parse(activity.metadata);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  })();

  return summarizeTechnicalDetails(activity.activity_type, activity.message, metadata);
}
