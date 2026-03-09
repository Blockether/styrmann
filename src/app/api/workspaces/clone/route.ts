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
 * Clone or fork+clone a GitHub repository and create a workspace for it.
 *
 * Body (clone mode):
 *   { repo: "org/repo-name" }
 *
 * Body (fork+clone mode):
 *   { fork_from: "https://github.com/upstream/repo" OR "upstream/repo", target_org: "Blockether" }
 *   Forks the repo into target_org (or personal account if omitted), then clones it.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ghEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

    // --- Fork+Clone mode ---
    if (body.fork_from) {
      const forkFrom = String(body.fork_from).trim();
      const targetOrg = body.target_org ? String(body.target_org).trim() : null;

      // Normalize: accept full URLs or org/repo format
      let sourceRepo = forkFrom;
      const urlMatch = forkFrom.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
      if (urlMatch) {
        sourceRepo = urlMatch[1];
      }

      // Validate format
      const parts = sourceRepo.split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return NextResponse.json(
          { error: 'Invalid repository. Use org/repo or a full GitHub URL.' },
          { status: 400 },
        );
      }

      const repoName = parts[1];

      // Build fork command
      const orgFlag = targetOrg ? ` --org "${targetOrg}"` : '';
      const forkCmd = `gh repo fork "${sourceRepo}" --clone=false --default-branch-only${orgFlag}`;

      try {
        execSync(forkCmd, { timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'], env: ghEnv });
      } catch (forkError) {
        const errMsg = forkError instanceof Error ? forkError.message : String(forkError);
        // gh repo fork returns exit 0 even if fork already exists, but just in case
        if (!errMsg.includes('already exists')) {
          console.error('[Fork] gh repo fork failed:', errMsg);
          return NextResponse.json(
            { error: `Fork failed: ${errMsg.split('\n').slice(0, 3).join(' ')}` },
            { status: 500 },
          );
        }
      }

      // The forked repo will be at target_org/repo-name or user/repo-name
      const forkedOwner = targetOrg || execSync('gh api user --jq .login', { timeout: 10_000, env: ghEnv }).toString().trim();
      const forkedRepo = `${forkedOwner}/${repoName}`;
      const org = forkedOwner.toLowerCase();
      const orgDir = path.join(REPOS_BASE, org);
      const repoDir = path.join(orgDir, repoName);

      // Check if already cloned
      if (fs.existsSync(path.join(repoDir, '.git'))) {
        const db = getDb();
        discoverRepoWorkspaces(db);
        const workspace = db.prepare('SELECT * FROM workspaces WHERE slug = ?').get(`${org}-${repoName}`);
        return NextResponse.json(
          { message: 'Fork already cloned, workspace synced', workspace },
          { status: 200 },
        );
      }

      // Clone the fork
      if (!fs.existsSync(orgDir)) {
        fs.mkdirSync(orgDir, { recursive: true });
      }

      try {
        execSync(`gh repo clone "${forkedRepo}" "${repoDir}"`, {
          timeout: 120_000,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: ghEnv,
        });
      } catch (cloneError) {
        const errMsg = cloneError instanceof Error ? cloneError.message : String(cloneError);
        console.error('[Clone] gh repo clone (forked) failed:', errMsg);
        return NextResponse.json(
          { error: `Clone of fork failed: ${errMsg.split('\n').slice(0, 3).join(' ')}` },
          { status: 500 },
        );
      }

      if (!fs.existsSync(path.join(repoDir, '.git'))) {
        return NextResponse.json({ error: 'Fork clone completed but .git not found' }, { status: 500 });
      }

      const db = getDb();
      discoverRepoWorkspaces(db);
      const workspace = db.prepare('SELECT * FROM workspaces WHERE slug = ?').get(`${org}-${repoName}`);

      return NextResponse.json(
        { message: 'Repository forked and cloned', workspace, forked_from: sourceRepo },
        { status: 201 },
      );
    }

    // --- Direct clone mode ---
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
        env: ghEnv,
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
