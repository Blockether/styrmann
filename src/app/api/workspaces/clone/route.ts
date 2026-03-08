import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';
import { discoverRepoWorkspaces } from '@/lib/repo-discovery';

export const dynamic = 'force-dynamic';

const REPOS_BASE = '/root/repos';

/**
 * POST /api/workspaces/clone
 *
 * Clone a GitHub repository and create a workspace for it.
 * Body: { repo: "org/repo-name" }
 *
 * Runs: gh repo clone org/repo-name /root/repos/{org}/{repo-name}
 * Then triggers workspace auto-discovery.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { repo } = body;

    if (!repo || typeof repo !== 'string') {
      return NextResponse.json({ error: 'repo is required (format: org/repo-name)' }, { status: 400 });
    }

    // Validate format: org/repo
    const parts = repo.trim().split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return NextResponse.json(
        { error: 'Invalid format. Use org/repo-name (e.g., Blockether/spel)' },
        { status: 400 },
      );
    }

    const [orgRaw, repoName] = parts;
    const org = orgRaw.toLowerCase();
    const orgDir = path.join(REPOS_BASE, org);
    const repoDir = path.join(orgDir, repoName);

    // Check if already cloned
    if (fs.existsSync(path.join(repoDir, '.git'))) {
      // Already exists — just re-run discovery
      const db = getDb();
      discoverRepoWorkspaces(db);
      const workspace = db.prepare('SELECT * FROM workspaces WHERE slug = ?').get(`${org}-${repoName}`);
      return NextResponse.json(
        { message: 'Repository already exists, workspace synced', workspace },
        { status: 200 },
      );
    }

    // Ensure org directory exists
    if (!fs.existsSync(orgDir)) {
      fs.mkdirSync(orgDir, { recursive: true });
    }

    // Clone via gh CLI
    try {
      execSync(`gh repo clone ${repo} "${repoDir}"`, {
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (cloneError) {
      const errMsg = cloneError instanceof Error ? cloneError.message : String(cloneError);
      console.error('[Clone] gh repo clone failed:', errMsg);
      return NextResponse.json(
        { error: `Clone failed: ${errMsg.split('\n').slice(0, 3).join(' ')}` },
        { status: 500 },
      );
    }

    // Verify clone succeeded
    if (!fs.existsSync(path.join(repoDir, '.git'))) {
      return NextResponse.json({ error: 'Clone completed but .git not found' }, { status: 500 });
    }

    // Re-run workspace discovery to pick up the new repo
    const db = getDb();
    discoverRepoWorkspaces(db);

    const workspace = db.prepare('SELECT * FROM workspaces WHERE slug = ?').get(`${org}-${repoName}`);

    return NextResponse.json(
      { message: 'Repository cloned and workspace created', workspace },
      { status: 201 },
    );
  } catch (error) {
    console.error('Failed to clone repository:', error);
    return NextResponse.json({ error: 'Failed to clone repository' }, { status: 500 });
  }
}
