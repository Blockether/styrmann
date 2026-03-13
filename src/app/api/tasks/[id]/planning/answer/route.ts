import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  try {
    const body = await request.json() as { answer?: string; otherText?: string };
    const { answer, otherText } = body;

    if (!answer) {
      return NextResponse.json({ error: 'Answer is required' }, { status: 400 });
    }

    const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as {
      id: string;
      title: string;
      description: string;
      planning_session_key?: string;
      planning_messages?: string;
    } | undefined;

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!task.planning_session_key) {
      return NextResponse.json({ error: 'Planning not started' }, { status: 400 });
    }

    const answerText = answer?.toLowerCase() === 'other' && otherText
      ? `Other: ${otherText}`
      : answer;

    const messages = task.planning_messages ? JSON.parse(task.planning_messages) as unknown[] : [];
    messages.push({ role: 'user', content: answerText, timestamp: Date.now() });

    getDb().prepare('UPDATE tasks SET planning_messages = ? WHERE id = ?').run(JSON.stringify(messages), taskId);

    return NextResponse.json({
      success: true,
      messages,
      note: 'Answer recorded. Planning via OpenCode ACP is handled externally.',
    });
  } catch (error) {
    console.error('Failed to submit answer:', error);
    return NextResponse.json({ error: 'Failed to submit answer: ' + (error as Error).message }, { status: 500 });
  }
}
