/**
 * Task Deliverables API
 * Endpoints for managing task deliverables (files, URLs, artifacts)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { CreateDeliverableSchema } from '@/lib/validation';
import { existsSync } from 'fs';

import type { TaskDeliverable } from '@/lib/types';

export const dynamic = 'force-dynamic';
/**
 * GET /api/tasks/[id]/deliverables
 * Retrieve all deliverables for a task
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const db = getDb();

    const deliverables = db.prepare(`
      SELECT *
      FROM task_deliverables
      WHERE task_id = ?
      ORDER BY created_at DESC
    `).all(taskId) as TaskDeliverable[];

    const enriched = deliverables.map((deliverable) => {
      if (!deliverable.openclaw_session_id) {
        return {
          ...deliverable,
          created_via_agent_id: null,
          created_via_agent_name: null,
          created_via_workflow_step: null,
          created_via_session_id: null,
        };
      }

      const session = db.prepare(`
        SELECT s.openclaw_session_id, s.agent_id, a.name as agent_name
        FROM openclaw_sessions s
        LEFT JOIN agents a ON a.id = s.agent_id
        WHERE s.openclaw_session_id = ?
        LIMIT 1
      `).get(deliverable.openclaw_session_id) as { openclaw_session_id?: string | null; agent_id?: string | null; agent_name?: string | null } | undefined;

      const stepRow = db.prepare(`
        SELECT json_extract(metadata, '$.workflow_step') as workflow_step
        FROM task_activities
        WHERE task_id = ?
          AND activity_type = 'dispatch_invocation'
          AND json_extract(metadata, '$.openclaw_session_id') = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(taskId, deliverable.openclaw_session_id) as { workflow_step?: string | null } | undefined;

      return {
        ...deliverable,
        created_via_agent_id: session?.agent_id || null,
        created_via_agent_name: session?.agent_name || null,
        created_via_workflow_step: stepRow?.workflow_step || null,
        created_via_session_id: session?.openclaw_session_id || deliverable.openclaw_session_id || null,
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error('Error fetching deliverables:', error);
    return NextResponse.json(
      { error: 'Failed to fetch deliverables' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks/[id]/deliverables
 * Add a new deliverable to a task
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    
    // Validate input with Zod
    const validation = CreateDeliverableSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { deliverable_type, title, path, description, openclaw_session_id } = validation.data;

    // Validate file existence for file deliverables
    let fileExists = true;
    let normalizedPath = path;
    if (deliverable_type === 'file' && path) {
      // Expand tilde
      normalizedPath = path.replace(/^~/, process.env.HOME || '');
      fileExists = existsSync(normalizedPath);
      if (!fileExists) {
        console.warn(`[DELIVERABLE] Warning: File does not exist: ${normalizedPath}`);
      }
    }

    const db = getDb();
    const id = crypto.randomUUID();

    // Insert deliverable
    db.prepare(`
      INSERT INTO task_deliverables (id, task_id, deliverable_type, title, path, description, openclaw_session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      taskId,
      deliverable_type,
      title,
      path || null,
      description || null,
      openclaw_session_id || null
    );

    // Get the created deliverable
    const deliverable = db.prepare(`
      SELECT *
      FROM task_deliverables
      WHERE id = ?
    `).get(id) as TaskDeliverable;

    // Broadcast to SSE clients
    broadcast({
      type: 'deliverable_added',
      payload: deliverable,
    });

    // Return with warning if file doesn't exist
    if (deliverable_type === 'file' && !fileExists) {
      return NextResponse.json(
        {
          ...deliverable,
          warning: `File does not exist at path: ${normalizedPath}. Please create the file.`
        },
        { status: 201 }
      );
    }

    return NextResponse.json(deliverable, { status: 201 });
  } catch (error) {
    console.error('Error creating deliverable:', error);
    return NextResponse.json(
      { error: 'Failed to create deliverable' },
      { status: 500 }
    );
  }
}
