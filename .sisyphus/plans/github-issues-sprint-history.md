# GitHub Issues Integration + Sprint History

## TL;DR

> Add GitHub Issues as a read-only entity synced via gh CLI (initial fetch + cron every 10 minutes), linkable to MC tasks. Add sprint history as a collapsible section in the left sidebar. No webhooks.

---

## Must Have

- `github_issues` table (migration 021) — read-only cache of GitHub issues
- `github_issue_id` nullable FK on tasks table (same migration)
- `POST /api/workspaces/[id]/github/sync` — triggers gh CLI sync, upserts issues
- `GET /api/workspaces/[id]/github/issues` — returns cached issues from DB
- `POST /api/workspaces/[id]/github/sync` — triggers gh CLI sync, upserts issues, broadcasts SSE
- `GET /api/cron/github-sync` — internal cron endpoint, syncs all workspaces with github_repo set, called by system cron every 10 min
- Sprint history section in `AgentsSidebar` — collapsible, shows completed/cancelled sprints with stats, click to navigate
- `DashboardView` extended with `'issues'` type
- SSE broadcast (`github_issues_synced`) after every sync
- KNOWLEDGE.md updated

## Must NOT Have

- Create/edit/close GitHub issues from MC
- Bidirectional sync (task done does NOT close issue)
- Automatic webhook registration via GitHub API
- PR, commit, CI, deployment, release tracking
- Issue comment syncing
- Webhooks (dropped — gh CLI cron is simpler and sufficient)
- Per-workspace webhook secrets
- Any icon library other than Lucide React
- Emojis anywhere

---

## Wave Structure

### Wave 1 — Data Layer (migration + API)
- Task 1: Migration 021 (github_issues table + tasks.github_issue_id)
- Task 2: gh CLI sync endpoint + issues list endpoint
- Task 3: GitHub webhook endpoint

### Wave 2 — UI
- Task 4: GithubIssuesView component + DashboardView extension
- Task 5: Sprint history section in AgentsSidebar
- Task 6: "Create Task from Issue" wiring in TaskModal + store

### Wave 3 — Polish + Deploy
- Task 7: KNOWLEDGE.md + CHANGELOG.md update
- Task 8: Build verify + deploy

---

## Tasks

### Task 1: Migration 021

**What to do**: Add migration `021` to `src/lib/db/migrations.ts`. Also update `src/lib/db/schema.ts` for fresh DBs.

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS github_issues (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  github_id INTEGER NOT NULL,
  issue_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  state_reason TEXT,
  labels TEXT DEFAULT '[]',
  assignees TEXT DEFAULT '[]',
  github_url TEXT NOT NULL,
  author TEXT,
  created_at_github TEXT,
  updated_at_github TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE(workspace_id, issue_number)
);
CREATE INDEX IF NOT EXISTS idx_github_issues_workspace ON github_issues(workspace_id);
CREATE INDEX IF NOT EXISTS idx_github_issues_state ON github_issues(workspace_id, state);
```

Also in migration 021:
```sql
ALTER TABLE tasks ADD COLUMN github_issue_id TEXT REFERENCES github_issues(id) ON DELETE SET NULL;
```
(Guard with PRAGMA table_info check)

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` passes
- [ ] Migration 021 appears in `_migrations` table after server restart

---

### Task 2: gh CLI Sync Endpoint + Issues List

**Files to create**:
- `src/app/api/workspaces/[id]/github/sync/route.ts` — POST only
- `src/app/api/workspaces/[id]/github/issues/route.ts` — GET only

**Sync endpoint** (`POST /api/workspaces/[id]/github/sync`):
1. Fetch workspace by id, get `github_repo` field
2. Parse with `extractOwnerRepo()` from `src/lib/github.ts`
3. Run: `execFile('gh', ['issue', 'list', '--repo', 'owner/repo', '--json', 'number,title,state,body,labels,assignees,createdAt,updatedAt,url,author,id,stateReason', '--limit', '200', '--state', 'all'])`
4. Parse JSON output, upsert each issue into `github_issues` using `INSERT OR REPLACE`
5. Call `broadcast({ type: 'github_issues_synced', payload: { workspace_id: id } })`
6. Return `{ synced_count: N, workspace_id: id }`

**Issues list endpoint** (`GET /api/workspaces/[id]/github/issues`):
- Query params: `state` (open/closed/all, default: open), `limit` (default 50)
- Returns array of github_issues rows
- Include `task_id` by joining tasks on `github_issue_id = github_issues.id`

**Types to add to `src/lib/types.ts`**:
```typescript
export interface GitHubIssue {
  id: string;
  workspace_id: string;
  github_id: number;
  issue_number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  state_reason?: string;
  labels: string; // JSON
  assignees: string; // JSON
  github_url: string;
  author?: string;
  created_at_github?: string;
  updated_at_github?: string;
  synced_at: string;
  task_id?: string; // joined from tasks
}
```

**Acceptance Criteria**:
- [ ] `POST /api/workspaces/default/github/sync` returns `{ synced_count: N }` where N >= 0
- [ ] `GET /api/workspaces/default/github/issues` returns array (may be empty if no repo configured)
- [ ] `GET /api/workspaces/default/github/issues?state=open` filters correctly
- [ ] No POST/PATCH/DELETE on issues endpoint (405 if attempted)
- [ ] `npx tsc --noEmit` passes

---

### Task 3: GitHub Webhook Endpoint

**File**: `src/app/api/webhooks/github/route.ts`

**Signature verification**: GitHub sends `x-hub-signature-256: sha256=<hex>`. Use `GITHUB_WEBHOOK_SECRET` env var (NOT `WEBHOOK_SECRET`).

```typescript
function verifyGitHubSignature(signature: string, rawBody: string): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true; // dev mode
  if (!signature?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

**Events to handle**: `issues.opened`, `issues.edited`, `issues.closed`, `issues.reopened`, `issues.labeled`, `issues.unlabeled`, `issues.assigned`, `issues.unassigned`, `issues.deleted`

**Logic**:
- Read raw body (use `request.text()` before parsing)
- Verify signature
- Check `x-github-event` header — only handle `issues` events, return 200 for others (ping, etc.)
- Parse payload, extract `action` and `issue` object
- For `deleted`: DELETE from github_issues WHERE workspace_id matches AND issue_number matches
- For all others: upsert the issue data
- Find workspace by matching `repository.full_name` against `workspaces.github_repo`
- Broadcast SSE `github_issues_synced`
- Return `{ status: 'ok' }`

**Acceptance Criteria**:
- [ ] `POST /api/webhooks/github` with valid signature returns 200 `{ status: 'ok' }`
- [ ] `POST /api/webhooks/github` with invalid signature returns 401
- [ ] `POST /api/webhooks/github` with `x-github-event: ping` returns 200 (no-op)
- [ ] `npx tsc --noEmit` passes

---

### Task 4: GithubIssuesView Component + DashboardView Extension

**Files to create/modify**:
- `src/components/GithubIssuesView.tsx` — new component
- `src/components/Header.tsx` — extend `DashboardView` type with `'issues'`
- `src/components/AgentsSidebar.tsx` — add Issues to NAV_ITEMS
- `src/app/page.tsx` (or wherever views are rendered) — render GithubIssuesView when view === 'issues'

**GithubIssuesView**:
- Root element: `data-component="src/components/GithubIssuesView"`
- Toolbar: `ChevronRight` + "GitHub Issues" title on left, "Sync Now" button + state filter (Open/Closed/All) on right
- Shows `synced_at` timestamp ("Last synced: X minutes ago")
- Issue cards: issue number (#42), title, state badge (green=open, purple=closed), labels as colored chips, assignee avatars (initials), link icon to open GitHub URL
- "Create Task" button on each issue card — disabled/greyed if issue already has a linked task
- Empty state: if no `github_repo` configured on workspace, show "Configure GitHub repo in workspace settings"
- Loading state while syncing
- Lucide icons: `Github`, `ExternalLink`, `Plus`, `RefreshCw`, `CircleDot` (open), `CheckCircle2` (closed)

**NAV_ITEMS addition**:
```typescript
{ label: 'Issues', view: 'issues' as DashboardView, icon: <CircleDot className="w-4 h-4" /> }
```

**Acceptance Criteria**:
- [ ] `DashboardView` type includes `'issues'`
- [ ] Issues view renders when view === 'issues'
- [ ] Sync Now button calls POST sync endpoint and refreshes list
- [ ] State filter works (open/closed/all)
- [ ] Issue with linked task shows disabled "Create Task" button
- [ ] Root element has `data-component` attribute
- [ ] No TypeScript errors

---

### Task 5: Sprint History in AgentsSidebar

**File**: `src/components/AgentsSidebar.tsx`

**What to add**: A collapsible "Sprint History" section below the NAV_ITEMS views section, above the agents list.

**Behavior**:
- Fetch `GET /api/sprints?workspace_id=X&status=completed` + `&status=cancelled` (two calls or one with no status filter, then filter client-side)
- Show last 10 completed/cancelled sprints, newest first
- Each row: sprint name (SPRINT-N), date range, task completion count (e.g., "8/12 done")
- Clicking a sprint calls `onViewChange('sprint')` AND sets the selected sprint in the ActiveSprint component
- Collapsed by default, toggle with ChevronDown/ChevronRight
- Section header: `History` with `Clock` icon

**Challenge**: ActiveSprint manages its own sprint selection state internally. Need to lift sprint selection up OR use a store field. Add `selectedSprintId` to the Zustand store so sidebar can set it and ActiveSprint can read it.

**Store change**: Add `selectedSprintId: string | null` + `setSelectedSprintId` to `src/lib/store.ts`

**Acceptance Criteria**:
- [ ] Sprint history section appears in sidebar below nav items
- [ ] Completed sprints listed with name, dates, task count
- [ ] Clicking a sprint navigates to sprint view and selects that sprint
- [ ] Section is collapsible
- [ ] No TypeScript errors

---

### Task 6: "Create Task from Issue" Wiring

**Files to modify**:
- `src/components/GithubIssuesView.tsx` — "Create Task" button handler
- `src/components/TaskModal.tsx` — accept optional `githubIssue` prop to pre-fill
- `src/lib/store.ts` — add `openTaskModalWithIssue` action or similar

**Behavior**:
- Clicking "Create Task" on an issue opens TaskModal pre-filled with:
  - `title`: issue title
  - `description`: issue body (markdown)
  - `github_issue_id`: the issue's MC id (hidden field, sent in POST body)
- After task creation, the issue card shows "Task linked" and disables the button
- Task creation POST includes `github_issue_id` in body
- `CreateTaskSchema` in validation.ts gets `github_issue_id: z.string().uuid().optional().nullable()`
- Tasks API route stores `github_issue_id` in INSERT

**Acceptance Criteria**:
- [ ] Clicking "Create Task" opens modal pre-filled with issue title + body
- [ ] Created task has `github_issue_id` set in DB
- [ ] Issue card shows linked state after task creation
- [ ] `GET /api/workspaces/[id]/github/issues` returns `task_id` for linked issues
- [ ] No TypeScript errors

---

### Task 7: KNOWLEDGE.md + CHANGELOG.md

**Update KNOWLEDGE.md**:
- New section: GitHub Issues Integration
- Document `github_issues` table schema
- Document `tasks.github_issue_id` FK
- Document sync endpoint, issues endpoint, webhook endpoint
- Document `GITHUB_WEBHOOK_SECRET` env var
- Document sprint history sidebar behavior

**Update CHANGELOG.md**: New entry at top with today's date (2026-03-06), v1.6.0

**Acceptance Criteria**:
- [ ] KNOWLEDGE.md has GitHub Issues section
- [ ] CHANGELOG.md has new entry
- [ ] No em dashes or en dashes in added text

---

### Task 8: Build + Deploy

**What to do**:
1. `npx tsc --noEmit` — must exit 0
2. `scripts/check.sh` — must exit 0
3. `git add -A && git commit` with proper footer
4. `git push origin main`
5. `scripts/deploy.sh`
6. `curl -s -o /dev/null -w "%{http_code}" https://control.blockether.com` — must return 200

**Acceptance Criteria**:
- [ ] TypeScript clean
- [ ] Build passes
- [ ] Deployed and live at 200

---

## Key Patterns to Follow

- Migration pattern: `src/lib/db/migrations.ts` — PRAGMA table_info guard, CREATE TABLE IF NOT EXISTS
- API route pattern: `src/app/api/sprints/route.ts` — force-dynamic, Zod, workspace_id filter
- Webhook pattern: `src/app/api/webhooks/agent-completion/route.ts` — raw body, HMAC verify
- SSE broadcast: `import { broadcast } from '@/lib/events'`
- DB access: `queryAll`, `queryOne`, `run`, `transaction` from `@/lib/db`
- GitHub repo parsing: `extractOwnerRepo()` from `src/lib/github.ts`
- Toolbar: `p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap`
- Icons: Lucide React only
- Fonts: IBM Plex Mono headings, Atkinson Hyperlegible body
- Styling: mc-* CSS classes + Tailwind only

## Commit Footer (MANDATORY on every commit)
```
Ultraworked with [Sisyphus] from OhMyClaude Code (https://ohmyclaude.com)

Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>
```
