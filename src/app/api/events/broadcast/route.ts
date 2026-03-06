import { NextRequest, NextResponse } from 'next/server';
import { broadcast } from '@/lib/events';
import type { SSEEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SSEEvent;

    if (!body.type || !body.payload) {
      return NextResponse.json({ error: 'Missing type or payload' }, { status: 400 });
    }

    broadcast(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to broadcast event:', error);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
