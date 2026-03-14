import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// DELETE /api/entity-links/[id] - Delete an entity link
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const existing = db.prepare('SELECT id FROM entity_links WHERE id = ?').get(id) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Entity link not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM entity_links WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete entity link:', error);
    return NextResponse.json({ error: 'Failed to delete entity link' }, { status: 500 });
  }
}
