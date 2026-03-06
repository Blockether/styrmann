import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { syncAgentsWithRpcCheck } from '@/lib/openclaw/sync';
import type { Agent } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const results = await syncAgentsWithRpcCheck();

    const syncedAgents = queryAll<Agent>(
      `SELECT * FROM agents WHERE source = 'synced' ORDER BY name ASC`
    );

    return NextResponse.json({
      agents: syncedAgents,
      results,
      total: syncedAgents.length,
    });
  } catch (error) {
    console.error('Failed to sync agents:', error);
    return NextResponse.json(
      { error: 'Failed to sync agents from OpenClaw' },
      { status: 500 }
    );
  }
}
