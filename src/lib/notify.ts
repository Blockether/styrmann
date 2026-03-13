import { execFile } from 'child_process';

interface NotifyPayload {
  event: string;
  task_id?: string;
  title: string;
  message: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export function notify(payload: NotifyPayload): void {
  const scriptPath = process.env.MC_NOTIFY_SCRIPT;
  const webhookUrl = process.env.MC_NOTIFY_WEBHOOK;

  if (scriptPath) {
    try {
      execFile(scriptPath, [payload.event, JSON.stringify(payload)], {
        timeout: 10000,
        env: { ...process.env },
      }, (err) => {
        if (err) console.error('[Notify] script failed:', err.message);
      });
    } catch (err) {
      console.error('[Notify] script spawn failed:', err);
    }
  }

  if (webhookUrl) {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    }).catch((err) => {
      console.error('[Notify] webhook failed:', err.message || err);
    });
  }
}

export function getNotifyStatus(): { script_configured: boolean; script_path: string | null; webhook_configured: boolean; webhook_url: string | null } {
  return {
    script_configured: Boolean(process.env.MC_NOTIFY_SCRIPT),
    script_path: process.env.MC_NOTIFY_SCRIPT || null,
    webhook_configured: Boolean(process.env.MC_NOTIFY_WEBHOOK),
    webhook_url: process.env.MC_NOTIFY_WEBHOOK || null,
  };
}
