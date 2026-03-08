# KNOWLEDGE.md -- Mission Control

Last updated: 2026-03-07

---

## Architecture

Next.js 16 App Router dashboard connected to OpenClaw Gateway via WebSocket.
SQLite database (better-sqlite3). Real-time updates via SSE.

```
Browser <-- SSE -- Mission Control (Next.js, port 4000) -- WebSocket --> OpenClaw Gateway (port 18789)
                          |                                                    |
                      SQLite DB                                         AI Providers
```

**Tech stack**: Next.js 16, React 19, TypeScript 5.9, SQLite (better-sqlite3), Zustand, Tailwind CSS 4, Zod, Lucide React, SSE. ESLint 9 (flat config).

**Service**: systemd unit `mission-control`, Rocky Linux, port 4000, URL https://control.blockether.com.

---

## Dashboard Architecture

Single-page dashboard per workspace. No route navigations between views.

```
/workspace/[slug]/page.tsx
  Header (logo, workspace, stats, online status, clock, settings -- NO view nav)
  Desktop: AgentsSidebar(views + agents, collapsed by default) | {view content} | LiveFeed(collapsed by default)
    view='sprint'   -> ActiveSprint (List/Board toggle)
    view='backlog'  -> BacklogView (tasks with no milestone_id)
    view='pareto'   -> ParetoView (effort/impact matrix)
    view='activity' -> AgentActivityDashboard (embedded)
  Mobile: hamburger in Header opens AgentsSidebar as slide-over overlay. Single content panel, no duplicate tabs.
```

**Navigation lives in AgentsSidebar only** -- not in the Header. The sidebar has two sections: Views (Sprint/Backlog/Pareto/Activity) at top, Agents list below. On desktop it collapses to icons. On mobile it's a slide-over overlay triggered by hamburger menu.

View state is React state + URL query param (`?view=backlog`). Default is `sprint`. Switching calls `window.history.replaceState()` -- no page reload.

---

## Task Lifecycle

```
PLANNING -> INBOX -> ASSIGNED -> IN_PROGRESS -> TESTING -> REVIEW -> VERIFICATION -> DONE
```

| Status | Description |
|--------|-------------|
| `planning` | AI asks clarifying questions before work begins |
| `inbox` | New task awaiting processing |
| `assigned` | Assigned to agent, auto-dispatched via OpenClaw |
| `in_progress` | Agent actively working |
| `testing` | Automated quality gate (browser tests, CSS validation) |
| `review` | Queue stage -- no agent dispatch, awaiting human review |
| `verification` | Active QC by reviewer agent |
| `done` | Completed and approved |

Also: `pending_dispatch` (transient, pre-dispatch state).

**Fail-loopback**: Testing or verification failure returns task to `in_progress` and re-dispatches the builder.

**Task fields**: title, description, status, priority (low/normal/high/urgent), task_type (bug/feature/chore/documentation/research), effort (1-5), impact (1-5), assigned_agent_id, milestone_id, workflow_template_id, due_date, tags.

Tasks get sprint context via `milestone.sprint_id`. There is no direct `sprint_id` on tasks.

**Task sub-resources**: comments, blockers (with blocked_by_task_id), resources (links/docs/designs), acceptance criteria (with is_met flag), activities (audit log), deliverables (file/url/artifact), task sessions and traces.

---

## Hierarchy

The workspace hierarchy is strict:

```
Workspace -> Sprint -> Milestone -> Task
```

Sprints contain milestones. Milestones contain tasks. A task belongs to a milestone; a milestone optionally belongs to a sprint. Tasks do not belong directly to sprints.

**Backlog**: tasks where `milestone_id IS NULL` and status != `done`.

---

## Sprints

Auto-named `SPRINT-N` per workspace (auto-incremented `sprint_number`). Users cannot customize sprint names.

**Fields**: workspace_id, name, goal, sprint_number, start_date, end_date, status.

**Statuses**: `planning` -> `active` -> `completed` | `cancelled`.

**Constraints**:
- Only one sprint can be `active` per workspace at a time.
- When a sprint is completed, all non-done tasks are unassigned from the sprint (via their milestones).
- Cannot delete a sprint that has milestones.

**Kanban board** (ActiveSprint): Sprint-scoped. Shows tasks grouped by milestone, where the milestone belongs to the selected sprint. Two view modes: List (milestone-grouped) and Board (drag-and-drop columns for all 8 statuses, with milestone swimlanes).

---

## Milestones

Milestones are the primary grouping unit for tasks. Each milestone optionally belongs to a sprint.

**Fields**: workspace_id, name, description, due_date, status (open/closed), coordinator_agent_id, sprint_id, priority.

**sprint_id**: FK to sprints (nullable). A milestone can exist without a sprint (it will appear in the backlog view).

**priority**: `'low' | 'normal' | 'high' | 'urgent'`. Defaults to `'normal'`.

**story_points**: Computed at read time via `SUM(task.effort)` across all tasks in the milestone. Never stored in the database.

**Coordinator agent**: Optional. Informational only -- displayed in the UI alongside the milestone name and progress bar. No automated notifications or dispatch tied to the coordinator.

**In ActiveSprint list view**: Tasks are grouped by milestone. Each group shows milestone name, coordinator initials, and a progress bar (done/total). Ungrouped tasks appear at the bottom.

Cannot delete a milestone that has tasks.

### Milestone Dependencies

The `milestone_dependencies` table tracks ordering relationships between milestones.

**Fields**: id, milestone_id, depends_on_milestone_id (nullable), depends_on_task_id (nullable), dependency_type.

**dependency_type**: `'finish_to_start' | 'blocks'`.

**Constraint**: at least one of `depends_on_milestone_id` or `depends_on_task_id` must be non-null.

**v1 behavior**: Dependencies are informational only. No blocking behavior is enforced at the API or workflow level. They are displayed in the UI for planning purposes.

---

## Backlog

Backlog = tasks with `milestone_id IS NULL` and status != `done`. The BacklogView shows these tasks in a sortable table with filters for priority, type, and tags. Tasks can be assigned to a milestone directly from the backlog card.

---

## Pareto View

Effort/impact matrix. Tasks plotted by their effort (1-5) and impact (1-5) scores. High-impact/low-effort tasks surface to the top.

---

## Tags

Workspace-scoped. Many-to-many with tasks via `task_tags` junction table. Each tag has a name (unique per workspace) and color. CRUD via `/api/tags`.

---

## Workflow Engine

Four workflow templates: Simple, Standard, Strict, Auto-Train.

| Template | Pipeline | Default |
|----------|----------|---------|
| Simple | Builder -> Done | No |
| Standard | Builder -> Tester -> Reviewer -> Done | No |
| Strict | Builder -> Tester -> Human Verifier (queue) -> Reviewer (verification) -> Done | Yes |
| Auto-Train | Builder -> Loop Complete | No |

The Strict template is the default. The `review` stage is labeled "Human Verifier" -- it is a queue stage (role=null, no dispatch). Verification is active QC by the `reviewer` role.

**Workflow engine** (`src/lib/workflow-engine.ts`):
- `handleStageTransition()` -- Triggered on status changes to testing, review, or verification. Looks up role agent from `task_roles` table, assigns, dispatches.
- If no agent for a role: sets `planning_dispatch_error` on the task (shown as red banner on task card).
- Fail-loopback: `POST /api/tasks/{id}/fail` routes task back to `in_progress` and re-dispatches builder.
- **Orchestrator guard**: `populateTaskRolesFromAgents()` skips agents with `role = 'orchestrator'`. Orchestrators are not auto-assigned to workflow stages.

**Builder hard gate (server-side):**
- Builder-owned tasks cannot move forward (`testing`/`review`/`verification`/`done`) without implementation evidence.
- Enforced in both `PATCH /api/tasks/{id}` and `POST /api/webhooks/agent-completion`.
- Evidence rule: at least one file deliverable OR at least one git commit in workspace repo since task creation.
- Violations return `409` and task status is not advanced.

**Template definitions are hardcoded** in `src/lib/workflow-templates.ts`. New workspaces get templates provisioned from these code constants via `provisionWorkflowTemplates()`. The legacy `cloneWorkflowTemplates()` in `bootstrap-agents.ts` delegates to the same function for backward compatibility.

**Auto-Train loop:**
- `task_type='autotrain'` marks a task as a continuous repo-improvement loop.
- New autotrain tasks auto-select the `Auto-Train` workflow template when available.
- The daemon module `src/daemon/autotrain.ts` watches `done` autotrain tasks and reopens them to `assigned` for the next iteration.
- Scope is workspace-local only; dispatch pins work to the workspace repo and `.mission-control/tasks/{taskId}/iter-{n}`.
- The task description acts as the supervisor prompt. Optional stop control: include `MAX_ITERATIONS: N` in the prompt.
- Optional prompt-learning control: include `EVOLVE_AGENT_PROMPTS: true` in task description so dispatch instructs the agent to append iteration learnings to its own `SOUL.md` and `AGENTS.md`.
- Manual control buttons in Task Modal Overview:
  - **Start Loop** logs `AUTOTRAIN_RESUME` and moves task to `assigned` when needed.
  - **Stop Loop** logs `AUTOTRAIN_STOP` and pauses queued `assigned` tasks back to `inbox`.
  - Daemon honors latest STOP/RESUME control signal from task activities.

---

## Agent System

**Sync from OpenClaw Gateway**: Agents are defined in OpenClaw gateway config files. `ensureSynced()` runs lazily on first agent query. Reads config, upserts agents in DB with `source='synced'`. Agents removed from config are deleted from DB.

**Global visibility**: Synced agents have `workspace_id='default'`. Agent queries return both workspace-local agents AND all synced agents (`WHERE workspace_id = ? OR source = 'synced'`).

**Agent fields**: name, role, description, status (standby/working/offline), model, source (local/gateway/synced), gateway_agent_id, session_key_prefix, agent_dir, agent_workspace_path, soul_md, user_md, agents_md. **API enrichment**: `GET /api/agents` returns `active_task_count` (number of active tasks) and `current_task_title` (title of in-progress task, if any) for each agent.

**Prompts stored in files**: soul_md, user_md, agents_md are read from OpenClaw agent workspace directories on disk. Double binding -- files are the source of truth, DB reflects them.

**Manual sync**: `POST /api/agents/sync` triggers `syncAgentsWithRpcCheck()` (attempts RPC to gateway, falls back to config-only).

### Orchestrator Role

One agent per workspace may have `role = 'orchestrator'`. This is the Product Owner / project manager role.

**Single-per-workspace constraint**: Creating a second orchestrator in the same workspace returns `409 Conflict`. Enforced at the API level.

**Demotion blocked**: `PATCH /api/agents/{id}` cannot change an orchestrator's role. Returns `400 Bad Request`. To change the orchestrator, delete the agent and recreate with a different role.

**Not a worker**: Orchestrators are excluded from workflow stage auto-assignment. They manage the project but do not execute tasks.

**UI**: Orchestrator agents display a Crown icon and "Product Owner" subtitle in AgentsSidebar.

---

## SSE (Real-Time)

Server-Sent Events, not WebSocket. Endpoint: `GET /api/events/stream`.

Events broadcast:
- `task_created`, `task_updated`, `task_deleted`
- `activity_logged`, `deliverable_added`
- `agent_spawned`, `agent_completed`

Client: `src/hooks/useSSE.ts` with auto-reconnect (5s retry) and 30s keep-alive pings.
Server: `src/lib/events.ts` manages connected clients.

Fallback: Task polling every 60s, event polling every 30s.

---

## API Endpoints

### Tasks
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/tasks` | List tasks (filter: workspace_id, status, milestone_id, backlog=true) |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks/{id}` | Get task with agent joins, tags, comments, blockers, resources, acceptance criteria |
| PATCH | `/api/tasks/{id}` | Update task (triggers workflow engine on status changes) |
| DELETE | `/api/tasks/{id}` | Delete task |
| POST | `/api/tasks/{id}/dispatch` | Dispatch to agent via OpenClaw |
| POST | `/api/tasks/{id}/fail` | Report stage failure (triggers fail-loopback) |
| GET/POST | `/api/tasks/{id}/activities` | Activity audit log (supports ?limit&offset pagination) |
| GET/POST | `/api/tasks/{id}/deliverables` | File/URL/artifact outputs (list/create) |
| GET/DELETE | `/api/tasks/{id}/deliverables/{deliverableId}` | Single deliverable (read/delete) |
| GET/POST | `/api/tasks/{id}/subagent` | Legacy session registration endpoint (compatibility) |
| GET | `/api/tasks/{id}/sessions` | Task session list (session-centric) |
| GET | `/api/tasks/{id}/sessions/{sessionId}/trace` | Full session trace (dispatch invocation + OpenClaw history) |
| GET | `/api/tasks/{id}/changes` | Task changes summary (workspace, files, commits, sessions) |
| GET/PUT | `/api/tasks/{id}/roles` | Role-to-agent assignments |

### Sprints and Milestones
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/sprints` | List/create sprints (workspace_id required) |
| GET/PATCH/DELETE | `/api/sprints/{id}` | Sprint CRUD |
| GET/POST | `/api/milestones` | List/create milestones (workspace_id required) |
| GET/PATCH/DELETE | `/api/milestones/{id}` | Milestone CRUD |

### Agents
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/agents` | List agents (triggers ensureSynced); enriches each agent with `active_task_count` and `current_task_title` from tasks table |
| GET/PATCH/DELETE | `/api/agents/{id}` | Agent CRUD (PATCH writes back to OpenClaw config; cannot demote orchestrator) |
| POST | `/api/agents/sync` | Manual sync from gateway config |

### Workspaces
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/workspaces` | List (optional stats=true) / create workspace |
| GET/PATCH/DELETE | `/api/workspaces/{id}` | Workspace CRUD (lookup by ID or slug) |
| GET/POST | `/api/workspaces/{id}/knowledge` | Knowledge entries (list/create) |
| GET/PATCH/DELETE | `/api/workspaces/{id}/knowledge/{entryId}` | Single knowledge entry (read/update/delete) |
| GET/POST | `/api/workspaces/{id}/workflows` | Workflow templates |

### Other
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/events/stream` | SSE event stream |
| POST | `/api/events/broadcast` | Daemon SSE relay (broadcasts event to all connected clients) |
| GET | `/api/tags` | List tags for workspace |
| POST | `/api/tags` | Create tag |
| PATCH/DELETE | `/api/tags/{id}` | Update/delete tag |
| GET/PATCH/DELETE | `/api/openclaw/sessions/{id}` | OpenClaw session management |
| GET | `/api/openclaw/gateway-logs` | OpenClaw gateway runtime logs (RPC-first; journalctl fallback) |
| POST | `/api/files/upload` | Upload file from remote agent |
| GET | `/api/files/download` | Download file |
| POST | `/api/webhooks/agent-completion` | HMAC-verified agent completion webhook |
| GET | `/api/demo` | Demo mode status flag |
| GET | `/api/system/info` | Process memory, Node version, system memory, service statuses |
| POST | `/api/system/validate` | Run validation checks (env, DB, services, HTTP) — returns JSON |
| GET | `/api/daemon/stats` | Latest daemon stats snapshot (pushed by daemon every 30s) |
| POST | `/api/daemon/stats` | Daemon pushes its in-memory stats to MC |

---

## Database Schema

27 migrations (001-027), auto-run on DB connection in `src/lib/db/index.ts`. Schema creation (`schema.ts`) only runs for fresh databases. After migrations, `discoverRepoWorkspaces()` scans `/root/repos/{org}/{repo}` for git repos and creates/syncs workspaces.

### Core Tables
- **workspaces** -- slug (`{org}-{repo}` format), name, description, icon, github_repo, owner_email, coordinator_email, logo_url, organization
- **agents** -- name, role, status, model, source, gateway_agent_id, session_key_prefix, agent_dir, agent_workspace_path, soul_md, user_md, agents_md. No `is_master` column.
- **tasks** -- title, description, status, priority, task_type, effort, impact, assigned_agent_id, milestone_id, workflow_template_id, due_date, github_issue_id (nullable FK to github_issues), planning fields. No `sprint_id`. No `parent_task_id`.
- **sprints** -- workspace_id, name, goal, sprint_number, start_date, end_date, status
- **milestones** -- workspace_id, name, description, due_date, status, coordinator_agent_id, sprint_id (FK nullable), priority ('low'|'normal'|'high'|'urgent')
- **milestone_dependencies** -- id, milestone_id, depends_on_milestone_id (nullable), depends_on_task_id (nullable), dependency_type ('finish_to_start'|'blocks')
- **tags** / **task_tags** -- workspace-scoped tags, many-to-many with tasks

### Task Sub-Resource Tables
- **task_comments** -- author, content
- **task_blockers** -- blocked_by_task_id, description, resolved flag
- **task_resources** -- title, url, resource_type (link/document/design/api/reference)
- **task_acceptance_criteria** -- description, is_met, sort_order
- **task_activities** -- activity_type, message, agent_id, metadata (JSON)
- **task_deliverables** -- deliverable_type (file/url/artifact), title, path, description
- **task_roles** -- role, agent_id (unique per task+role)

### Workflow and Knowledge Tables
- **workflow_templates** -- stages (JSON array), fail_targets (JSON), is_default
- **knowledge_entries** -- category, title, content, tags (JSON), confidence score

### Session and Event Tables
- **openclaw_sessions** -- agent_id, openclaw_session_id, channel, status, session_type (persistent/subagent), task_id, ended_at
- **events** -- type, agent_id, task_id, message, metadata
- **conversations** / **messages** / **conversation_participants** -- agent-to-agent messaging
- **planning_questions** / **planning_specs** -- AI planning Q&A flow
- **businesses** -- legacy table, kept for compatibility
- **github_issues** -- workspace_id, github_id (integer), issue_number, title, body, state ('open'|'closed'), state_reason, labels (JSON string), assignees (JSON string), github_url, author, created_at_github, updated_at_github, synced_at, task_id (nullable FK to tasks). Unique constraint on (workspace_id, issue_number). Indexes on workspace_id and (workspace_id, state).

---

---

## GitHub Issues Integration

GitHub Issues are synced from the workspace's `github_repo` URL using the `gh` CLI (authenticated as `michal-blockether`).

### Endpoints

- `POST /api/workspaces/[id]/github/sync` -- Trigger manual sync for one workspace. Runs `gh issue list --repo owner/repo --json ... --limit 200 --state all`, upserts into `github_issues` table, broadcasts `github_issues_synced` SSE event. Returns `{ synced_count, workspace_id }`.
- `GET /api/workspaces/[id]/github/issues?state=open|closed|all` -- Return cached issues from DB. Left-joins `tasks` to expose `task_id` per issue.
- `GET /api/cron/github-sync` -- Sync all workspaces with a configured `github_repo`. Localhost-only or Bearer token auth. Returns `{ synced_workspaces, total_issues, errors? }`.

### Cron Job

Installed in `/var/spool/cron/crontabs/root`:
```
*/10 * * * * curl -s -o /dev/null http://localhost:4000/api/cron/github-sync
```
Runs every 10 minutes. Silent mode (`-s -o /dev/null`).

### Task Link Pattern

When a task is created from a GitHub issue:
1. `POST /api/tasks` body includes `github_issue_id` (UUID of the `github_issues` row).
2. The tasks route INSERTs with `github_issue_id` and then runs `UPDATE github_issues SET task_id = ? WHERE id = ?`.
3. The issues list endpoint returns `task_id` so the UI can show linked state.

### UI

- `GithubIssuesView` component: toolbar with Sync Now button and state filter (Open/Closed/All), issue cards with state badge, labels, assignee initials, ExternalLink to GitHub, Create Task button (disabled if already linked).
- Accessible via `DashboardView = 'issues'` in the workspace page sidebar.
- "Create Task" opens `TaskModal` pre-filled with issue title and body.

### Notes

- `Blockether/mission-control` has GitHub Issues DISABLED. Use `Blockether/spel` (workspace `f46fd2b7`) for testing.
- `gh` CLI must be authenticated with `repo` scope.
- Labels and assignees are stored as JSON strings in the DB.

## Authentication

When `MC_API_TOKEN` is set in `.env.local`:
- External API calls require `Authorization: Bearer <token>` header.
- Same-origin browser requests bypass auth.
- SSE streams accept token as query parameter.
- Implemented in `src/proxy.ts` (Next.js 16 proxy, formerly middleware).

Webhook verification: `WEBHOOK_SECRET` env var, HMAC signature in `x-webhook-signature` header.

---

## Agent Protocol

**Dispatch**: Task dispatched to agent via OpenClaw `chat.send` RPC. Includes task ID, description, output directory, callback endpoints. Role-specific instructions (builder: "when done, update to testing"; tester: "pass -> review, fail -> POST /fail").

**Pipeline storage rule**: Agent output path is workspace-repo anchored and always under `.mission-control`:
- `<workspace-repo>/.mission-control/tasks/<task-id>`
- This path is used so downstream stages read the same artifacts consistently.

**Git repo handling**: repo validation uses git worktree detection (`git rev-parse --is-inside-work-tree`), not `.git` directory checks, so linked worktrees are supported.

**Session trace persistence**:
- Every dispatch writes a `task_activities` record with `activity_type='dispatch_invocation'` and metadata including:
  - `openclaw_session_id`
  - `session_key`
  - `trace_url`
  - `output_directory`
  - `invocation` (full dispatched prompt)
- Per-session trace endpoint: `GET /api/tasks/{id}/sessions/{sessionId}/trace` returns dispatch invocation + normalized OpenClaw chat history.
- Workspace Activity and Task Activity surfaces include links to session traces when available.

**Auto-Train dispatch specialization**:
- For `task_type='autotrain'`, dispatch prompt switches to a continuous loop contract: inspect -> propose -> implement -> verify -> report.
- Dispatch includes active ACP binding context for the workspace when present (`acp_session_key`, `acp_agent_id`, `discord_thread_id`).
- Iteration summaries from recent activities are injected into the next loop dispatch.

**Completion format**: `TASK_COMPLETE: [summary] | deliverables: [paths] | verification: [how verified]`

**Progress**: `PROGRESS_UPDATE: [what changed] | next: [next step] | eta: [time]`

**Blockers**: `BLOCKED: [what] | need: [input] | meanwhile: [fallback work]`

---

## Orchestration Helpers

`src/lib/orchestration.ts`:
- `onSubAgentSpawned()` -- Register sub-agent, log activity, broadcast SSE
- `onSubAgentCompleted()` -- Mark session complete, log deliverables, broadcast
- `logActivity()` / `logDeliverable()` -- Audit trail
- `verifyTaskHasDeliverables()` -- Required before review -> done transition

`src/lib/learner.ts`:
- Captures transition outcomes as knowledge entries
- Injects relevant lessons into future dispatches

---

## File Operations (Remote Agents)

Agents without direct filesystem access use upload/download endpoints:

- `POST /api/files/upload` -- `{ relativePath, content, encoding }` -> saves to `$PROJECTS_PATH/{relativePath}`
- `GET /api/files/download?relativePath=...` -- Returns file content (JSON or raw with `&raw=true`)
- `POST /api/files/reveal` -- Opens file in system file manager

---

## Key Design Decisions

1. **SSE over WebSocket**: Simpler, works with Next.js App Router natively, sufficient for server-to-client updates.
2. **SQLite over Postgres**: Single-file DB, zero config, WAL mode for concurrent reads. Sufficient for single-server deployment.
3. **Single-page dashboard**: All views render in same page via state switching. No route navigations between views -- prevents layout jumps.
4. **Milestone-first hierarchy**: Tasks belong to milestones; milestones belong to sprints. The hierarchy is `Workspace -> Sprint -> Milestone -> Task`. Tasks do not have a direct sprint relationship. Backlog is defined as `milestone_id IS NULL`.
5. **Agent sync from gateway config**: Agents defined in OpenClaw config files, auto-synced on startup. Prompts stored in files (not DB). Synced agents appear in all workspaces.
6. **Migrations auto-run on DB connection**: Schema creation only for fresh databases. `legacy_alter_table = ON` during migrations to prevent FK rewriting bug.
7. **Component traceability**: Every React component's root DOM element has `data-component="src/path/to/File"` (relative path, no extension). Paste rendered HTML and immediately identify which source file to edit.
8. **LiveFeed is workspace-scoped**: Events API filters by `workspace_id` via task or agent ownership. System events (no task/agent) appear in all workspaces. AgentActivityDashboard is the global cross-workspace activity view.
9. **Single orchestrator per workspace**: Only one agent with `role = 'orchestrator'` is allowed per workspace. Enforced at the API level (409 on duplicate). Orchestrators cannot be demoted via PATCH (400) -- delete and recreate to change. Orchestrators are excluded from workflow stage auto-assignment.
10. **Story points computed, not stored**: `story_points` on a milestone is computed at read time via `SUM(task.effort)`. It is never persisted in the database.
11. **Milestone dependencies are informational in v1**: The `milestone_dependencies` table exists and is queryable, but no blocking behavior is enforced. Dependencies are for planning visibility only.

12. **Repo-driven workspaces**: Workspaces auto-discover from git repos at `/root/repos/{org}/{repo}`. On DB init, `discoverRepoWorkspaces()` scans for org directories containing git repos and creates/syncs a workspace per repo. Slug format: `{org}-{repo}` (e.g., `blockether-mission-control`). The `default` workspace (id='default') maps to `blockether/mission-control`. All workspaces are peers. Workspaces are grouped by organization in the UI.
13. **Workflow templates in code, not DB-cloned**: Template definitions (Simple, Standard, Strict) live in `src/lib/workflow-templates.ts` as TypeScript constants. New workspaces get templates provisioned from code, not cloned from another workspace's DB rows.
---

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENCLAW_GATEWAY_URL` | Yes | `ws://127.0.0.1:18789` | WebSocket URL to OpenClaw Gateway |
| `OPENCLAW_GATEWAY_TOKEN` | Yes | -- | Auth token for OpenClaw |
| `MC_API_TOKEN` | No | -- | API auth token (enables Bearer auth) |
| `WEBHOOK_SECRET` | No | -- | HMAC secret for webhook verification |
| `DATABASE_PATH` | No | `./mission-control.db` | SQLite database path |
| `WORKSPACE_BASE_PATH` | No | `~/Documents/Shared` | Base workspace directory |
| `PROJECTS_PATH` | No | `/root/repos` | Repos base directory — scanned for `{org}/{repo}` git repos, auto-discovered as workspaces |
| `MISSION_CONTROL_URL` | No | auto-detected | API URL for agent callbacks |
| `DEMO_MODE` | No | -- | Enables read-only demo mode |

---

## npm Scripts

```
npm run dev          # Start dev server on port 4000
npm run build        # Production build (next build)
npm run start        # Production server on port 4000
npm run lint         # ESLint
npm run db:seed      # Create DB + seed defaults
npm run db:backup    # WAL checkpoint + copy to .backup
npm run db:restore   # Restore from .backup
npm run db:reset     # Delete DB + re-seed
```

---

## Shell Scripts

```
scripts/deploy.sh [--skip-build] [--no-restart]   # Build + restart + health check
scripts/lint.sh [--fix]                            # ESLint + tsc --noEmit
scripts/validate.sh                                # DB + env + service health
scripts/check.sh                                   # Full pre-deploy (lint + validate + build)
```

## Daemon (Agent Automation)

### Rationale

The Next.js server handles HTTP request/response cycles but has no built-in mechanism for background loops — polling for assigned tasks, monitoring agent health, or running scheduled jobs. A separate daemon process (`tsx src/daemon/index.ts`) fills this gap. It communicates with Mission Control exclusively via HTTP API (never imports Next.js internals or accesses the DB directly), making it safe to run, restart, or kill independently.

### Architecture

The daemon is a standalone Node.js process with nine modules:

| Module | Interval | Purpose |
|--------|----------|---------|
| **heartbeat** | 30s | Polls `/api/agents`, detects stale working agents (>60 min without activity), sets them to standby |
| **dispatcher** | 10s | Polls `/api/tasks?status=assigned`, auto-dispatches each via `POST /api/tasks/{id}/dispatch` |
| **scheduler** | 10s | Runs registered `ScheduledJob` entries on interval. Job registry starts empty — no hardcoded jobs |
| **recovery** | 60s | Polls `in_progress` tasks, detects stale work (default >30m without updates), and performs auto-recovery (re-dispatch to assignee or reassign to fallback orchestrator) |
| **autotrain** | 30s | Polls completed `autotrain` tasks and reopens them for the next repo-improvement iteration until stop/max-iteration conditions are hit |
| **health** | 60s | Pings MC to verify API is reachable, logs connection changes |
| **router** | SSE stream | Subscribes to `/api/events/stream`, routes events (e.g., logs task assignments for dispatcher awareness) |
| **logs** | 30s | Polls OpenClaw session histories via `/api/openclaw/sessions/{id}/history`, stores new entries in `agent_logs` table via `/api/logs/ingest`, broadcasts `agent_log_added` SSE events, auto-cleans entries older than 30 days |
| **reporter** | 30s | Pushes daemon runtime snapshot to `/api/daemon/stats` for Operations UI visibility |
Communication flow: `Daemon → HTTP API → Next.js → SQLite / OpenClaw Gateway → SSE broadcast → UI`

For SSE relay (daemon pushing events to browser clients): `Daemon → POST /api/events/broadcast → in-memory SSE broadcaster → connected browsers`

### Running

```bash
# Production
npm run daemon

# Development (auto-restart on changes)
npm run daemon:dev
```

Env vars: `MC_URL` (default `http://localhost:4000`), `MC_API_TOKEN` (required — same token used by `mc` CLI), `MC_STALLED_TASK_THRESHOLD_MS` (default `1800000`), `MC_STALLED_TASK_COOLDOWN_MS` (default `600000`).

### Database Tables

| Table | Purpose |
|-------|---------|
| `agent_heartbeats` | Records agent status snapshots over time (agent_id, status, metadata, created_at) |
| `scheduled_job_runs` | Records job execution history (job_id, status, started_at, finished_at, result, error, optional task_id) |
| `agent_logs` | OpenClaw session transcripts — role (user/assistant/system), content, content_hash (dedup), linked to agent and workspace |
### Shared Dispatch (`src/lib/dispatch.ts`)

The dispatch logic (task message building, OpenClaw session management, workflow stage awareness, knowledge injection) was extracted from the API route into a shared module `dispatchTaskToAgent(taskId)`. Both the API route (`POST /api/tasks/{id}/dispatch`) and the daemon's dispatcher call the same function. Returns a `DispatchResult` with success/error status and updated task/agent payloads.

### Broadcast Endpoint

`POST /api/events/broadcast` — accepts `{type, payload}` and broadcasts to all connected SSE clients. Protected by the existing middleware auth (`MC_API_TOKEN`). Used by the daemon to push real-time updates from a separate process that can't access the in-memory SSE client set directly.

### Agent Logs (OpenClaw Transcripts)

Real-time agent session logs from OpenClaw Gateway, polled and stored by the daemon.

**Database:** `agent_logs` table with columns: `id`, `agent_id`, `openclaw_session_id`, `role` (user/assistant/system), `content`, `content_hash` (SHA-256 for dedup), `workspace_id`, `created_at`. Unique index on `content_hash` prevents duplicates.

**API Endpoints:**
- `GET /api/logs` — Query with rich filtering: `agent_id`, `session_id`, `role`, `workspace_id`, `search` (LIKE), `from`/`to` (date range), `limit`/`offset` (pagination), `order` (asc/desc). Returns `{logs, total, limit, offset, hasMore}`.
- `POST /api/logs/ingest` — Bulk insert from daemon. Uses `INSERT OR IGNORE` for dedup by content_hash.
- `GET /api/logs/sessions` — Distinct sessions with log counts (for filter dropdown).
- `DELETE /api/logs?days=60` — Cleanup stale entries older than N days.

**Daemon module (`src/daemon/logs.ts`):** Polls every 30s. For each active OpenClaw session, fetches history, computes content_hash per message, stores new entries via `/api/logs/ingest`, broadcasts `agent_log_added` SSE event. Runs cleanup every ~50 minutes (100 ticks). Maintains an in-memory `knownHashes` Set to avoid redundant API calls.

**UI:** `AgentLogsView` component embedded in the unified Operations dashboard under the OpenClaw control-plane section. Features: agent dropdown, role filter tabs, session filter, text search, date range inputs, paginated list with "Load more", auto-refresh on new data. The component accepts an optional `workspaceId` prop — when omitted on the Operations page, shows all logs globally.

**SSE Event:** `agent_log_added` — payload contains `{count, session_id, agent_id, agent_name, workspace_id}`.

**Retention:** Logs older than 60 days are automatically purged by the daemon. Manual cleanup available via `DELETE /api/logs?days=N`.

### Operations Dashboard

The homepage has two top-level destinations: **Workspaces** and **Operations**. `/operations` is the canonical operational dashboard route. Legacy `/system` and `/openclaw` routes redirect to `/operations` for compatibility.

**Operations dashboard** is split into two sections. The **System Runtime** section shows 4 cards:
- **Process Info** — Node.js version, platform, hostname, web process memory (RSS, heap), system memory usage bar, web/daemon service status dots.
- **Daemon Status** — Uptime, PID, memory, module table (name, interval, last tick), counters (dispatched, heartbeats, stale recovered, events routed, logs stored/cleaned). Shows stale warning if last report is >2min old.
- **Scheduled Jobs** — List of registered cron jobs from the daemon scheduler (id, name, cron, enabled, last run).
- **Config Validation** — "Run Validation" button that POSTs to `/api/system/validate` and displays pass/fail/warn results for each check (env file, env vars, database, web service, daemon service, HTTP endpoint).

The **OpenClaw Control Plane** section shows 4 cards:
- **Gateway Status** — Connection status (connected/disconnected), masked gateway URL (tokens replaced with `***`), active session count.
- **Agent Occupation** — Working/standby/offline counts with stacked bar visualization, redesigned agent list with status-based visual treatment (green left-border for working, neutral for standby, muted for offline), role badges, model info, task counts, and current task titles. Per-agent cards show description previews and current task context for working agents.
- **Available Models** — Model list from gateway with default model badge, source indicator (remote/local/fallback).
- **Security Audit and Live Logs** — On-demand audit / auto-fix actions plus the live global OpenClaw session transcript viewer.

Both sections auto-refresh every 30 seconds. Validation only runs on button click.

### Daemon Stats Reporter

New daemon module (`src/daemon/reporter.ts`): pushes the daemon's in-memory `DaemonStats` object to MC via `POST /api/daemon/stats` every 30 seconds. MC stores the latest snapshot in a `globalThis` variable (in-memory, lost on MC restart but daemon re-pushes within one interval). Payload includes all DaemonStats counters, process memory, PID, module intervals with last-tick timestamps, and registered scheduled jobs.

The scheduler now exports `getRegisteredJobs()` for the reporter to include job metadata in its stats push.
