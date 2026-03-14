import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fetchRepoDescription } from '@/lib/github';
import type { Workspace } from '@/lib/types';

export const dynamic = 'force-dynamic';
// GET /api/workspaces/[id] - Get a single workspace
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const db = getDb();
    
    // Try to find by ID or slug
    const workspace = db.prepare(
      'SELECT * FROM workspaces WHERE id = ? OR slug = ?'
    ).get(id, id);
    
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    
    return NextResponse.json(workspace);
  } catch (error) {
    console.error('Failed to fetch workspace:', error);
    return NextResponse.json({ error: 'Failed to fetch workspace' }, { status: 500 });
  }
}

// PATCH /api/workspaces/[id] - Update a workspace
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const body = await request.json();
    const { name, description, icon, github_repo, owner_email, coordinator_email, logo_url } = body;
    
    const db = getDb();
    
    // Check workspace exists
    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    
    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (icon !== undefined) {
      updates.push('icon = ?');
      values.push(icon);
    }
    if (github_repo !== undefined) {
      if (existing.is_internal) {
        return NextResponse.json({ error: 'Internal system repositories cannot be linked to GitHub' }, { status: 403 });
      }
      updates.push('github_repo = ?');
      values.push(github_repo);

      if (github_repo && description === undefined) {
        const ghDesc = await fetchRepoDescription(github_repo);
        if (ghDesc) {
          updates.push('description = ?');
          values.push(ghDesc);
        }
      }
    }
    if (owner_email !== undefined) {
      updates.push('owner_email = ?');
      values.push(owner_email);
    }
    if (coordinator_email !== undefined) {
      updates.push('coordinator_email = ?');
      values.push(coordinator_email);
    }
    if (logo_url !== undefined) {
      updates.push('logo_url = ?');
      values.push(logo_url);
    }
    
    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    
    updates.push("updated_at = datetime('now')");
    values.push(id);
    
    db.prepare(`
      UPDATE workspaces SET ${updates.join(', ')} WHERE id = ?
    `).run(...values);
    
    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    return NextResponse.json(workspace);
  } catch (error) {
    console.error('Failed to update workspace:', error);
    return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    if (id === 'default') {
      return NextResponse.json({ error: 'Cannot delete the system meta repository' }, { status: 403 });
    }

    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    if (existing.is_internal) {
      return NextResponse.json({ error: 'Cannot delete internal system repositories' }, { status: 403 });
    }

    const taskIds = db.prepare('SELECT id FROM tasks WHERE workspace_id = ?').all(id) as { id: string }[];
    const tIds = taskIds.map(t => t.id);

    const cascade = db.transaction(() => {
      // Per-task children (no CASCADE FKs referencing tasks)
      for (const taskId of tIds) {
        db.prepare('DELETE FROM task_run_result_artifacts WHERE task_id = ?').run(taskId);
        db.prepare('DELETE FROM task_run_results WHERE task_id = ?').run(taskId);
        db.prepare('DELETE FROM task_acceptance_criteria WHERE task_id = ?').run(taskId);
        db.prepare('DELETE FROM task_deliverables WHERE task_id = ?').run(taskId);
        db.prepare('DELETE FROM task_activities WHERE task_id = ?').run(taskId);
        db.prepare('DELETE FROM task_resources WHERE task_id = ?').run(taskId);
        db.prepare('DELETE FROM task_artifacts WHERE task_id = ?').run(taskId);
        db.prepare('DELETE FROM task_comments WHERE task_id = ?').run(taskId);
        db.prepare('DELETE FROM task_blockers WHERE task_id = ?').run(taskId);
        db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?').run(taskId, taskId);
        db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
        db.prepare('DELETE FROM task_roles WHERE task_id = ?').run(taskId);
         db.prepare('DELETE FROM task_provenance WHERE task_id = ?').run(taskId);
         db.prepare('DELETE FROM sessions WHERE task_id = ?').run(taskId);
         db.prepare('DELETE FROM events WHERE task_id = ?').run(taskId);
         db.prepare('DELETE FROM scheduled_job_runs WHERE task_id = ?').run(taskId);
       }
      // Workspace-level children (must come before tasks/milestones/sprints/workspaces)
      db.prepare('DELETE FROM task_workflow_plans WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM task_findings WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM capability_proposals WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM agent_logs WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM acp_bindings WHERE workspace_id = ?').run(id);
      // Now safe to delete tasks (all FK references to tasks are gone)
      db.prepare('DELETE FROM tasks WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM milestone_dependencies WHERE milestone_id IN (SELECT id FROM milestones WHERE workspace_id = ?)').run(id);
      db.prepare('DELETE FROM milestones WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM sprints WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM tags WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM github_issues WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM workflow_templates WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    });

    cascade();

    return NextResponse.json({ success: true, deleted_tasks: tIds.length });
  } catch (error) {
    console.error('Failed to delete workspace:', error);
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 });
  }
}
