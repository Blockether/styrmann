import { NextRequest, NextResponse } from 'next/server';
import type { DaemonStatsSnapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';

// In-memory store for the latest daemon stats snapshot.
// The daemon process pushes updates every ~30s via POST.
// Lost on MC restart, but daemon re-pushes within one interval.
const GLOBAL_KEY = '__daemon_stats_snapshot__';

if (!(GLOBAL_KEY in globalThis)) {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = null;
}

function getSnapshot(): DaemonStatsSnapshot | null {
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as DaemonStatsSnapshot | null;
}

function setSnapshot(snapshot: DaemonStatsSnapshot): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = snapshot;
}

/**
 * GET /api/daemon/stats - Return the latest daemon stats snapshot
 *
 * Returns the most recent snapshot pushed by the daemon, or null if
 * the daemon has not reported yet (e.g. just after MC restart).
 */
export async function GET() {
  const snapshot = getSnapshot();

  if (!snapshot) {
    return NextResponse.json({
      snapshot: null,
      message: 'No daemon stats received yet. Daemon may be starting up.',
    });
  }

  // Calculate staleness — if last report is > 2 minutes old, daemon may be down
  const reportedAt = new Date(snapshot.reported_at).getTime();
  const staleMs = Date.now() - reportedAt;
  const stale = staleMs > 120_000;

  return NextResponse.json({
    snapshot,
    stale,
    stale_seconds: Math.round(staleMs / 1000),
  });
}

/**
 * POST /api/daemon/stats - Receive a stats snapshot push from the daemon
 *
 * Body: DaemonStatsSnapshot
 * Called by the daemon reporter module every ~30 seconds.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Minimal validation
    if (!body.started_at || typeof body.uptime_seconds !== 'number') {
      return NextResponse.json({ error: 'Invalid stats payload' }, { status: 400 });
    }

    const snapshot: DaemonStatsSnapshot = {
      started_at: body.started_at,
      reported_at: body.reported_at || new Date().toISOString(),
      uptime_seconds: body.uptime_seconds,
      last_heartbeat_tick: body.last_heartbeat_tick,
      last_dispatch_tick: body.last_dispatch_tick,
      last_scheduler_tick: body.last_scheduler_tick,
      last_log_poll_tick: body.last_log_poll_tick,
      last_recovery_tick: body.last_recovery_tick,
      dispatched_count: body.dispatched_count || 0,
      heartbeat_count: body.heartbeat_count || 0,
      stale_recovered_count: body.stale_recovered_count || 0,
      scheduled_run_count: body.scheduled_run_count || 0,
      scheduled_failure_count: body.scheduled_failure_count || 0,
      routed_event_count: body.routed_event_count || 0,
      log_entries_stored: body.log_entries_stored || 0,
      log_entries_cleaned: body.log_entries_cleaned || 0,
      stalled_redispatched_count: body.stalled_redispatched_count || 0,
      stalled_reassigned_count: body.stalled_reassigned_count || 0,
      memory_mb: body.memory_mb || 0,
      pid: body.pid || 0,
      modules: Array.isArray(body.modules) ? body.modules : [],
      jobs: Array.isArray(body.jobs) ? body.jobs : [],
    };

    setSnapshot(snapshot);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to store daemon stats:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
