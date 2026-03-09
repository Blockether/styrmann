import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';
import { UpdateHumanSchema } from '@/lib/validation';
import type { Human } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const human = queryOne<Human>('SELECT * FROM humans WHERE id = ?', [id]);
  if (!human) {
    return NextResponse.json({ error: 'Human not found' }, { status: 404 });
  }
  return NextResponse.json(human);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const existing = queryOne<Human>('SELECT * FROM humans WHERE id = ?', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Human not found' }, { status: 404 });
    }

    const body = await request.json();
    const validation = UpdateHumanSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', details: validation.error.issues }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    if (validation.data.name !== undefined) {
      updates.push('name = ?');
      values.push(validation.data.name);
    }
    if (validation.data.email !== undefined) {
      updates.push('email = ?');
      values.push(validation.data.email);
    }
    if (validation.data.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(validation.data.is_active);
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    run(`UPDATE humans SET ${updates.join(', ')} WHERE id = ?`, values);

    const human = queryOne<Human>('SELECT * FROM humans WHERE id = ?', [id]);
    return NextResponse.json(human);
  } catch {
    return NextResponse.json({ error: 'Failed to update human' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = queryOne<Human>('SELECT * FROM humans WHERE id = ?', [id]);
  if (!existing) {
    return NextResponse.json({ error: 'Human not found' }, { status: 404 });
  }

  run('UPDATE humans SET is_active = 0, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  return NextResponse.json({ success: true });
}
