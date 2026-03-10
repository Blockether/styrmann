import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getOpenClawClient, resetOpenClawClient } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';

const SERVICE_NAME = 'openclaw-gateway';
const RESTART_POLL_ATTEMPTS = 20;
const RESTART_POLL_DELAY_MS = 1000;
const RESTART_CONNECT_TIMEOUT_MS = 4000;
const RESTART_RPC_TIMEOUT_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

/**
 * POST /api/system/restart-gateway - Restart the OpenClaw Gateway service
 *
 * Runs `systemctl restart openclaw-gateway` and verifies it came back up.
 */
export async function POST() {
  try {
    resetOpenClawClient();

    // Check current status before restart
    let wasActive = false;
    try {
      const before = execSync(`systemctl is-active ${SERVICE_NAME} 2>/dev/null`, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      wasActive = before === 'active';
    } catch {
      // Service may not exist
    }

    // Restart the service
    try {
      execSync(`systemctl restart ${SERVICE_NAME} 2>&1`, {
        encoding: 'utf8',
        timeout: 30000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { success: false, error: `Restart command failed: ${message}` },
        { status: 500 },
      );
    }

    let pid: string | undefined;
    try {
      pid = execSync(
        `systemctl show ${SERVICE_NAME} --property=MainPID --no-pager 2>/dev/null`,
        { encoding: 'utf8', timeout: 5000 },
      ).trim().split('=')[1] || undefined;
    } catch {
      pid = undefined;
    }

    let lastError = 'Gateway did not become RPC-ready in time';
    let rpcReady = false;

    for (let attempt = 0; attempt < RESTART_POLL_ATTEMPTS; attempt += 1) {
      await sleep(RESTART_POLL_DELAY_MS);

      let isActive = false;
      try {
        const after = execSync(`systemctl is-active ${SERVICE_NAME} 2>/dev/null`, {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();
        isActive = after === 'active';
      } catch {
        isActive = false;
      }

      if (!isActive) {
        lastError = 'Service is not active after restart';
        continue;
      }

      try {
        resetOpenClawClient();
        const client = getOpenClawClient();
        await withTimeout(client.connect(), RESTART_CONNECT_TIMEOUT_MS, 'Gateway connect probe');
        await withTimeout(client.listSessions(), RESTART_RPC_TIMEOUT_MS, 'Gateway sessions.list probe');
        rpcReady = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Gateway RPC probe failed';
      }
    }

    if (!rpcReady) {
      resetOpenClawClient();
      return NextResponse.json({
        success: false,
        error: `Service restarted but gateway RPC is not ready: ${lastError}`,
        was_active: wasActive,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      was_active: wasActive,
      is_active: true,
      pid: pid ? parseInt(pid, 10) : undefined,
      restarted_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Gateway restart failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
