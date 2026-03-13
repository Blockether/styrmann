/**
 * Repo-Driven Workspace Auto-Discovery
 *
 * Scans /root/repos/{org}/{repo} for git repositories and ensures
 * each one has a corresponding workspace in the database.
 *
 * Structure: /root/repos/{org}/{repo}/.git
 *   - Slug format: {org}-{repo} (e.g., blockether-mission-control)
 *   - Display name: {Org}/{Repo} (e.g., Blockether/Styrmann)
 *   - Organization stored in workspace.organization column
 *
 * Styrmann is discovered like any other repository.
 * The internal meta repository is modeled separately in the DB.
 *
 * Flat repos (no org parent) are ignored — only org/repo structure is discovered.
 * Templates are provisioned from code constants, not cloned from another workspace.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { provisionWorkflowTemplates } from './workflow-templates';

const REPOS_BASE = '/root/repos';

interface DiscoveredRepo {
  org: string;
  repo: string;
  slug: string;
  displayName: string;
  githubRepo: string;
  repoPath: string;
}

/**
 * Scan REPOS_BASE for org/repo git directories.
 */
function scanRepos(): DiscoveredRepo[] {
  if (!fs.existsSync(REPOS_BASE)) {
    console.warn(`[RepoDiscovery] Repos base not found: ${REPOS_BASE} — skipping`);
    return [];
  }

  const results: DiscoveredRepo[] = [];
  const orgDirs = fs.readdirSync(REPOS_BASE, { withFileTypes: true }).filter((e) => e.isDirectory());

  for (const orgDir of orgDirs) {
    const orgPath = path.join(REPOS_BASE, orgDir.name);

    // Skip if this is itself a git repo (flat repo, not org/repo)
    if (fs.existsSync(path.join(orgPath, '.git'))) continue;

    const repoDirs = fs.readdirSync(orgPath, { withFileTypes: true }).filter(
      (e) => e.isDirectory() && fs.existsSync(path.join(orgPath, e.name, '.git')),
    );

    for (const repoDir of repoDirs) {
      const org = orgDir.name;
      const repo = repoDir.name;
      const capitalizedOrg = org.charAt(0).toUpperCase() + org.slice(1);
      const capitalizedRepo = repo
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      results.push({
        org,
        repo,
        slug: `${org}-${repo}`,
        displayName: capitalizedRepo,
        githubRepo: `https://github.com/${capitalizedOrg}/${repo}`,
        repoPath: path.join(orgPath, repo),
      });
    }
  }

  return results;
}

/**
 * Discover git repos under REPOS_BASE/{org}/{repo} and ensure matching workspaces exist.
 * Safe to call on every startup — idempotent.
 */
export function discoverRepoWorkspaces(db: Database.Database): void {
  const repos = scanRepos();

  if (repos.length === 0) {
    console.warn('[RepoDiscovery] No org/repo git repos found — skipping');
    return;
  }

  for (const discovered of repos) {
    const { org, repo, slug, displayName, githubRepo } = discovered;

    const oldSlug = repo; // backward compat: previous discovery used repo name only
    const existing = db.prepare(
      'SELECT id, slug FROM workspaces WHERE slug = ? OR slug = ? OR github_repo = ? OR local_path = ? LIMIT 1',
    ).get(slug, oldSlug, githubRepo, discovered.repoPath) as { id: string; slug: string } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE workspaces
        SET slug = ?, name = ?, github_repo = ?, organization = ?, is_internal = 0, repo_kind = 'standard', local_path = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(slug, displayName, githubRepo, org, discovered.repoPath, existing.id);

      if (existing.slug !== slug) {
        console.log(`[RepoDiscovery] Renamed workspace '${existing.slug}' → '${slug}'`);
      } else {
        console.log(`[RepoDiscovery] Workspace '${slug}' already exists — updated`);
      }

      provisionWorkflowTemplates(db, existing.id);
      continue;
    }

    // Create new workspace
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO workspaces (id, name, slug, description, icon, github_repo, is_internal, repo_kind, local_path, organization)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'standard', ?, ?)
    `).run(id, displayName, slug, null, 'BL', githubRepo, discovered.repoPath, org);

    provisionWorkflowTemplates(db, id);
    console.log(`[RepoDiscovery] Created workspace '${slug}' for ${org}/${repo}`);
  }
}
