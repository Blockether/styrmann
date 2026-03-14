import { getDb } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

interface WebhookRow {
  id: string;
  organization_id: string | null;
  url: string;
  secret: string | null;
  event_types: string;
  is_active: number;
  last_delivery_at: string | null;
  last_delivery_status: string | null;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export async function deliverWebhookEvent(
  eventType: string,
  payload: Record<string, unknown>,
  organizationId?: string
): Promise<void> {
  const db = getDb();

  const webhooks = organizationId
    ? db.prepare(`
        SELECT * FROM webhooks
        WHERE is_active = 1
        AND failure_count < 10
        AND (organization_id = ? OR organization_id IS NULL)
      `).all(organizationId) as WebhookRow[]
    : db.prepare(`
        SELECT * FROM webhooks
        WHERE is_active = 1
        AND failure_count < 10
      `).all() as WebhookRow[];

  const matchingWebhooks = webhooks.filter(webhook => {
    const types = JSON.parse(webhook.event_types || '[]') as string[];
    return types.length === 0 || types.includes(eventType) || types.includes('*');
  });

  for (const webhook of matchingWebhooks) {
    const deliveryId = uuidv4();
    const payloadStr = JSON.stringify({
      event: eventType,
      data: payload,
      timestamp: new Date().toISOString(),
    });

    db.prepare(`
      INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, attempts)
      VALUES (?, ?, ?, ?, 'pending', 0)
    `).run(deliveryId, webhook.id, eventType, payloadStr);

    deliverWithRetry(webhook, deliveryId, payloadStr, eventType).catch(console.error);
  }
}

async function deliverWithRetry(
  webhook: WebhookRow,
  deliveryId: string,
  payload: string,
  eventType: string,
  maxAttempts: number = 3
): Promise<void> {
  const db = getDb();
  const retryDelays = [1000, 5000, 30000];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) await sleep(retryDelays[attempt - 1]);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-Event': eventType,
        'X-Delivery-ID': deliveryId,
      };

      if (webhook.secret) {
        const sig = crypto
          .createHmac('sha256', webhook.secret)
          .update(payload)
          .digest('hex');
        headers['X-Webhook-Signature'] = `sha256=${sig}`;
      }

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(10000),
      });

      const responseBody = await response.text().catch(() => '');

      db.prepare(`
        UPDATE webhook_deliveries SET status = ?, response_status = ?, response_body = ?, attempts = ?
        WHERE id = ?
      `).run(
        response.ok ? 'delivered' : 'failed',
        response.status,
        responseBody.slice(0, 1000),
        attempt + 1,
        deliveryId
      );

      db.prepare(`
        UPDATE webhooks SET last_delivery_at = datetime('now'), last_delivery_status = ?,
        failure_count = CASE WHEN ? = 1 THEN 0 ELSE failure_count + 1 END,
        updated_at = datetime('now')
        WHERE id = ?
      `).run(response.ok ? 'success' : 'failed', response.ok ? 1 : 0, webhook.id);

      if (response.ok) return;

    } catch {
      db.prepare(`
        UPDATE webhook_deliveries SET status = 'failed', attempts = ? WHERE id = ?
      `).run(attempt + 1, deliveryId);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
