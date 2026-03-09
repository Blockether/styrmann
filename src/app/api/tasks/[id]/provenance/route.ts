import { NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/db';
import type { SourceReceipt } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

interface ProvenanceRow {
  id: string;
  task_id: string;
  session_id: string | null;
  kind: string;
  origin_session_id: string | null;
  source_session_key: string | null;
  source_channel: string | null;
  source_tool: string | null;
  receipt_text: string | null;
  receipt_data: string | null;
  message_role: string | null;
  message_index: number | null;
  created_at: string;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id: taskId } = await params;

    const task = queryOne<{ id: string }>('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const rows = queryAll<ProvenanceRow>(
      `SELECT id, task_id, session_id, kind, origin_session_id, source_session_key,
              source_channel, source_tool, receipt_text, receipt_data,
              message_role, message_index, created_at
       FROM task_provenance
       WHERE task_id = ?
       ORDER BY created_at ASC, message_index ASC`,
      [taskId],
    );

    const records = rows.map((row) => ({
      ...row,
      receipt_data: row.receipt_data ? (JSON.parse(row.receipt_data) as SourceReceipt) : null,
    }));

    return NextResponse.json({
      task_id: taskId,
      count: records.length,
      records,
    });
  } catch (error) {
    console.error('Failed to fetch task provenance:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
