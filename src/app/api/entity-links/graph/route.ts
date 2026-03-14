import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getConnectedEntities, MAX_LINK_DEPTH } from '@/lib/db/entity-links';

export const dynamic = 'force-dynamic';

// GET /api/entity-links/graph - Recursive graph traversal from an entity
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const entity_id = searchParams.get('entity_id');
    const max_depth = Math.min(
      Math.max(parseInt(searchParams.get('max_depth') || '10', 10), 1),
      MAX_LINK_DEPTH
    );

    if (!entity_id) {
      return NextResponse.json({ error: 'entity_id is required' }, { status: 400 });
    }

    const db = getDb();
    const connected = getConnectedEntities(db, entity_id, max_depth);

    return NextResponse.json({ entity_id, connected });
  } catch (error) {
    console.error('Failed to traverse entity graph:', error);
    return NextResponse.json({ error: 'Failed to traverse entity graph' }, { status: 500 });
  }
}
