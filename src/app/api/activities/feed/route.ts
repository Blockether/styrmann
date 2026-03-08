/**
 * Unified Activity Feed API
 * Merges task_activities + agent_logs into a single chronological feed.
 * Filterable by workspace, sprint, milestone, or task.
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface FeedItem {
  id: string;
  source: 'activity' | 'agent_log';
  task_id: string | null;
  task_title: string | null;
  task_status: string | null;
  agent_id: string | null;
  agent_name: string | null;
  milestone_id: string | null;
  milestone_name: string | null;
  // activity fields
  activity_type: string | null;
  message: string;
  metadata: string | null;
  trace_url: string | null;
  // agent_log fields
  role: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const workspaceId = params.get('workspace_id');
    const sprintId = params.get('sprint_id');
    const milestoneId = params.get('milestone_id');
    const taskId = params.get('task_id');
    const limit = Math.min(parseInt(params.get('limit') || '100'), 500);
    const offset = parseInt(params.get('offset') || '0');
    const sourceFilter = params.get('source'); // 'activity' | 'agent_log' | null (both)

    // Build task scope filter based on hierarchy
    let taskScope = '';
    const scopeParams: string[] = [];

    if (taskId) {
      taskScope = 'AND task_id = ?';
      scopeParams.push(taskId);
    } else if (milestoneId) {
      taskScope = 'AND task_id IN (SELECT id FROM tasks WHERE milestone_id = ?)';
      scopeParams.push(milestoneId);
    } else if (sprintId) {
      taskScope = `AND task_id IN (
        SELECT t.id FROM tasks t
        LEFT JOIN milestones m ON t.milestone_id = m.id
        WHERE m.sprint_id = ? OR (t.milestone_id IS NULL AND t.workspace_id = COALESCE(?, t.workspace_id))
      )`;
      scopeParams.push(sprintId);
      if (workspaceId) scopeParams.push(workspaceId);
      else scopeParams.push('');
    } else if (workspaceId) {
      taskScope = 'AND task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)';
      scopeParams.push(workspaceId);
    }

    const parts: string[] = [];

    // Part 1: task_activities
    if (sourceFilter !== 'agent_log') {
      parts.push(`
        SELECT
          a.id,
          'activity' as source,
          a.task_id,
          t.title as task_title,
          t.status as task_status,
          a.agent_id,
          ag.name as agent_name,
          t.milestone_id,
          m.name as milestone_name,
          a.activity_type,
          a.message,
          a.metadata,
          json_extract(a.metadata, '$.trace_url') as trace_url,
          NULL as role,
          a.created_at
        FROM task_activities a
        LEFT JOIN tasks t ON a.task_id = t.id
        LEFT JOIN agents ag ON a.agent_id = ag.id
        LEFT JOIN milestones m ON t.milestone_id = m.id
        WHERE 1=1 ${taskScope}
      `);
    }

    // Part 2: agent_logs (only those linked to tasks)
    if (sourceFilter !== 'activity') {
      parts.push(`
        SELECT
          l.id,
          'agent_log' as source,
          l.task_id,
          t.title as task_title,
          t.status as task_status,
          l.agent_id,
          ag.name as agent_name,
          t.milestone_id,
          m.name as milestone_name,
          NULL as activity_type,
          l.content as message,
          NULL as metadata,
          NULL as trace_url,
          l.role,
          l.created_at
        FROM agent_logs l
        LEFT JOIN tasks t ON l.task_id = t.id
        LEFT JOIN agents ag ON l.agent_id = ag.id
        LEFT JOIN milestones m ON t.milestone_id = m.id
        WHERE l.task_id IS NOT NULL ${taskScope}
      `);
    }

    if (parts.length === 0) {
      return NextResponse.json({ items: [], total: 0, hasMore: false });
    }

    const unionQuery = parts.join(' UNION ALL ');
    const allParams = [...scopeParams, ...scopeParams].slice(0, scopeParams.length * parts.length);

    // Wrap in subquery for ORDER BY (SQLite requires this with UNION ALL)
    const wrappedQuery = `SELECT * FROM (${unionQuery})`;

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM (${unionQuery})`;
    const totalRow = queryAll<{ total: number }>(countQuery, allParams);
    const total = totalRow[0]?.total ?? 0;

    // Fetch page
    const dataQuery = `${wrappedQuery} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const items = queryAll<FeedItem>(dataQuery, [...allParams, limit, offset]);

    return NextResponse.json({
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    });
  } catch (error) {
    console.error('Failed to fetch activity feed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
