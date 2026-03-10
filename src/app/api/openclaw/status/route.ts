import { NextResponse } from 'next/server';
import { getOpenClawClient, resetOpenClawClient } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';

const STATUS_CONNECT_TIMEOUT_MS = 8000;
const STATUS_RPC_TIMEOUT_MS = 8000;

function maskUrl(url: string): string {
  return url.replace(/token=[^&]+/gi, 'token=***');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

// GET /api/openclaw/status - Check OpenClaw connection status
export async function GET() {
  try {
    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await withTimeout(client.connect(), STATUS_CONNECT_TIMEOUT_MS, 'Gateway connect');
      } catch (err) {
        resetOpenClawClient();
        const message = err instanceof Error ? err.message : 'Unknown connection error';
        return NextResponse.json({
          connected: false,
          error: `Failed to connect to OpenClaw Gateway: ${message}`,
          gateway_url: maskUrl(process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789'),
        }, { status: 503 });
      }
    }

    // Try to list sessions to verify connection
    try {
      const sessions = await withTimeout(client.listSessions(), STATUS_RPC_TIMEOUT_MS, 'Gateway sessions.list');
      return NextResponse.json({
        connected: true,
        sessions_count: sessions.length,
        sessions: sessions,
        gateway_url: maskUrl(process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789'),
      });
    } catch (err) {
      resetOpenClawClient();
      const message = err instanceof Error ? err.message : 'Unknown RPC error';
      return NextResponse.json({
        connected: false,
        error: `Gateway RPC not ready: ${message}`,
        gateway_url: maskUrl(process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789'),
      }, { status: 503 });
    }
  } catch (error) {
    console.error('OpenClaw status check failed:', error);
    return NextResponse.json(
      {
        connected: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
