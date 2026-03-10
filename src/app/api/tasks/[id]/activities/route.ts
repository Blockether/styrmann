/**
 * Task Activities API
 * Endpoints for logging and retrieving task activities
 */

import { NextRequest, NextResponse } from 'next/server';
import { CreateActivitySchema } from '@/lib/validation';
import { buildPresentedTaskActivities, createTaskActivity } from '@/lib/task-activity';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/[id]/activities
 * Retrieve activities for a task with pagination
 *
 * Query params:
 *   limit  - Page size (default 50, max 200)
 *   offset - Pagination offset (default 0)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10) || 0;
    const presented = buildPresentedTaskActivities(taskId, limit, offset);

    return NextResponse.json({
      activities: presented.activities,
      raw_activities: presented.raw_activities,
      filters: presented.filters,
      pagination: {
        total: presented.total,
        limit,
        offset,
        has_more: offset + presented.activities.length < presented.total,
      },
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activities' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks/[id]/activities
 * Log a new activity for a task
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    
    // Validate input with Zod
    const validation = CreateActivitySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { activity_type, message, agent_id, metadata } = validation.data;
    const result = createTaskActivity({
      taskId,
      activityType: activity_type,
      message,
      agentId: agent_id,
      metadata,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Error creating activity:', error);
    return NextResponse.json(
      { error: 'Failed to create activity' },
      { status: 500 }
    );
  }
}
