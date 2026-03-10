import { NextResponse } from 'next/server';
import { runOpenClawMemoryConsolidation } from '@/lib/openclaw-memory';
import { rebuildKnowledgeVectors } from '@/lib/memory-search';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await runOpenClawMemoryConsolidation();
    const vectors = rebuildKnowledgeVectors();
    return NextResponse.json({
      message: 'Memory pipeline run completed',
      consolidation: result,
      vectors,
    });
  } catch (error) {
    console.error('Failed to run memory pipeline:', error);
    return NextResponse.json({ error: 'Failed to run memory pipeline' }, { status: 500 });
  }
}
