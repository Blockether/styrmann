import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cloneWorkflowTemplates } from '@/lib/bootstrap-agents';
import { fetchRepoDescription } from '@/lib/github';
import type { Workspace, WorkspaceStats, TaskStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Helper to generate slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// GET /api/workspaces - List all workspaces with stats
export async function GET(request: NextRequest) {
  const includeStats = request.nextUrl.searchParams.get('stats') === 'true';

  try {
    const db = getDb();
    
    if (includeStats) {
      // Get workspaces with task counts and agent counts
      const workspaces = db.prepare('SELECT * FROM workspaces ORDER BY name').all() as Workspace[];
      
      const stats: WorkspaceStats[] = workspaces.map(workspace => {
        // Get task counts by status
        const taskCounts = db.prepare(`
          SELECT status, COUNT(*) as count 
          FROM tasks 
          WHERE workspace_id = ? 
          GROUP BY status
        `).all(workspace.id) as { status: TaskStatus; count: number }[];
        
        const counts: WorkspaceStats['taskCounts'] = {
          pending_dispatch: 0,
          planning: 0,
          inbox: 0,
          assigned: 0,
          in_progress: 0,
          testing: 0,
          review: 0,
          verification: 0,
          done: 0,
          total: 0
        };
        
        taskCounts.forEach(tc => {
          counts[tc.status] = tc.count;
          counts.total += tc.count;
        });
        
        
        return {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          description: workspace.description,
          icon: workspace.icon,
          github_repo: workspace.github_repo,
          is_internal: workspace.is_internal,
          repo_kind: workspace.repo_kind,
          local_path: workspace.local_path,
          owner_email: workspace.owner_email,
          coordinator_email: workspace.coordinator_email,
          himalaya_account: workspace.himalaya_account,
          logo_url: workspace.logo_url,
          organization: workspace.organization,
          taskCounts: counts,
        };
      });
      
      return NextResponse.json(stats);
    }
    
    const workspaces = db.prepare('SELECT * FROM workspaces ORDER BY name').all();
    return NextResponse.json(workspaces);
  } catch (error) {
    console.error('Failed to fetch workspaces:', error);
    return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 });
  }
}

// POST /api/workspaces - Create a new workspace
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, icon, github_repo, owner_email, coordinator_email, himalaya_account, logo_url } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const slug = generateSlug(name);
    
    // Check if slug already exists
    const existing = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(slug);
    if (existing) {
      return NextResponse.json({ error: 'A workspace with this name already exists' }, { status: 400 });
    }

    let resolvedDescription = description || null;
    if (!resolvedDescription && github_repo) {
      resolvedDescription = await fetchRepoDescription(github_repo);
    }

    db.prepare(`
      INSERT INTO workspaces (id, name, slug, description, icon, github_repo, owner_email, coordinator_email, himalaya_account, logo_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name.trim(),
      slug,
      resolvedDescription,
      icon || 'BL',
      github_repo || null,
      owner_email || null,
      coordinator_email || null,
      himalaya_account || null,
      logo_url || null
    );

    // Clone workflow templates for the new workspace (agents come from OpenClaw sync)
    cloneWorkflowTemplates(db, id);

    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    console.error('Failed to create workspace:', error);
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 });
  }
}
