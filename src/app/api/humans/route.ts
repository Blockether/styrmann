import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { CreateHumanSchema } from '@/lib/validation';
import type { Human } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const humans = queryAll<Human>('SELECT * FROM humans WHERE is_active = 1 ORDER BY name ASC');
    return NextResponse.json(humans);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch humans' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = CreateHumanSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', details: validation.error.issues }, { status: 400 });
    }

    const existing = queryOne<{ id: string }>('SELECT id FROM humans WHERE email = ?', [validation.data.email]);
    if (existing) {
      return NextResponse.json({ error: 'A human with this email already exists' }, { status: 409 });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    run(
      `INSERT INTO humans (id, name, email, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [id, validation.data.name, validation.data.email, now, now],
    );

    const human = queryOne<Human>('SELECT * FROM humans WHERE id = ?', [id]);
    return NextResponse.json(human, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create human' }, { status: 500 });
  }
}
