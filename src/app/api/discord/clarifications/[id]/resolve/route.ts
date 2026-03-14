import { NextRequest, NextResponse } from 'next/server';
import { run, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const existing = queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM discord_clarification_contexts WHERE id = ?',
    [id],
  );

  if (!existing) {
    return NextResponse.json({ error: 'Clarification context not found' }, { status: 404 });
  }

  if (existing.status !== 'pending') {
    return NextResponse.json({ id, status: existing.status, already_resolved: true });
  }

  run(
    `UPDATE discord_clarification_contexts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?`,
    [id],
  );

  return NextResponse.json({ id, status: 'resolved' });
}
