# KNOWLEDGE.md -- Mission Control

Last updated: 2026-03-05

---

## Architecture

Next.js 14 App Router dashboard connected to OpenClaw Gateway via WebSocket.
SQLite database (better-sqlite3). Real-time updates via SSE.

```
Browser <-- SSE -- Mission Control (Next.js, port 4000) -- WebSocket --> OpenClaw Gateway (port 18789)
                          |                                                    |
                      SQLite DB                                         AI Providers
```

**Tech stack**: Next.js 14, TypeScript 5, SQLite (better-sqlite3), Zustand, Tailwind CSS, Zod, Lucide React, SSE.

**Service**: systemd unit `mission-control`, Rocky Linux, port 4000, URL https://control.blockether.com.

---

## Dashboard Architecture

Single-page dashboard per workspace. No route navigations between views.

```
/workspace/[slug]/page.tsx
  Header (nav buttons, view switching via URL ?view= param)
  Desktop: AgentsSidebar(collapsed) | {view content} | LiveFeed
    view='sprint'   -> ActiveSprint (List/Board toggle)
    view='backlog'  -> BacklogView (tasks with no sprint_id)
    view='pareto'   -> ParetoView (effort/impact matrix)
    view='activity' -> AgentActivityDashboard (embedded)
  Mobile portrait: tab bar (Content/Agents/Feed)
  Mobile landscape: 60/40 grid (content | agents or feed)
```

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

**Task fields**: title, description, status, priority (low/normal/high/urgent), task_type (bug/feature/chore/documentation/research), effort (1-5), impact (1-5), assigned_agent_id, sprint_id, milestone_id, parent_task_id, workflow_template_id, due_date, tags.

**Task sub-resources**: comments, blockers (with blocked_by_task_id), resources (links/docs/designs), acceptance criteria (with is_met flag), activities (audit log), deliverables (file/url/artifact), sub-agent sessions.

---

## Sprints

Auto-named `SPRINT-N` per workspace (auto-incremented `sprint_number`). Users cannot customize sprint names.

**Fields**: workspace_id, name, goal, sprint_number, start_date, end_date, status.

**Statuses**: `planning` -> `active` -> `completed` | `cancelled`.

**Constraints**:
- Only one sprint can be `active` per workspace at a time.
- When a sprint is completed, all non-done tasks are unassigned from the sprint.
- Cannot delete a sprint that has tasks.

**Kanban board** (ActiveSprint): Sprint-scoped. Only shows tasks where `sprint_id` matches the selected sprint. Two view modes: List (milestone-grouped) and Board (drag-and-drop columns for all 8 statuses).

---

## Milestones

Workspace-level task groups. **Independent of sprints** -- a task can belong to a sprint, a milestone, both, or neither.

**Fields**: workspace_id, name, description, due_date, status (open/closed), coordinator_agent_id.

**Coordinator agent**: Optional. Informational only -- displayed in the UI alongside the milestone name and progress bar. No automated notifications or dispatch tied to the coordinator.

**In ActiveSprint list view**: Tasks are grouped by milestone. Each group shows milestone name, coordinator initials, and a progress bar (done/total). Ungrouped tasks appear at the bottom.

Cannot delete a milestone that has tasks.

---

## Backlog

Backlog = tasks with `sprint_id IS NULL` and status != `done`. The BacklogView shows these tasks in a sortable table with filters for priority, type, and tags.

---

## Pareto View

Effort/impact matrix. Tasks plotted by their effort (1-5) and impact (1-5) scores. High-impact/low-effort tasks surface to the top.

---

## Tags

Workspace-scoped. Many-to-many with tasks via `task_tags` junction table. Each tag has a name (unique per workspace) and color. CRUD via `/api/tags`.

---

## Workflow Engine

Three workflow templates: Simple, Standard, Strict.

| Template | Pipeline | Default |
|----------|----------|---------|
| Simple | Builder -> Done | No |
| Standard | Builder -> Tester -> Reviewer -> Done | No |
| Strict | Builder -> Tester -> Review (queue) -> Reviewer (verification) -> Done | Yes |

The Strict template is the default. Review is a queue stage (role=null, no dispatch). Verification is active QC by the `reviewer` role.

**Workflow engine** (`src/lib/workflow-engine.ts`):
- `handleStageTransition()` -- Triggered on status changes to testing, review, or verification. Looks up role agent from `task_roles` table, assigns, dispatches.
- If no agent for a role: sets `planning_dispatch_error` on the task (shown as red banner on task card).
- Fail-loopback: `POST /api/tasks/{id}/fail` routes task back to `in_progress` and re-dispatches builder.

New workspaces clone workflow templates from the `default` workspace.

---

## Agent System

**Sync from OpenClaw Gateway**: Agents are defined in OpenClaw gateway config files. `ensureSynced()` runs lazily on first agent query. Reads config, upserts agents in DB with `source='synced'`. Agents removed from config are deleted from DB.

**Global visibility**: Synced agents have `workspace_id='default'`. Agent queries return both workspace-local agents AND all synced agents (`WHERE workspace_id = ? OR source = 'synced'`).

**Agent fields**: name, role, description, status (standby/working/offline), is_master, model, source (local/gateway/synced), gateway_agent_id, session_key_prefix, agent_dir, agent_workspace_path, soul_md, user_md, agents_md.

**Prompts stored in files**: soul_md, user_md, agents_md are read from OpenClaw agent workspace directories on disk. Double binding -- files are the source of truth, DB reflects them.

**Manual sync**: `POST /api/agents/sync` triggers `syncAgentsWithRpcCheck()` (attempts RPC to gateway, falls back to config-only).

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
| GET | `/api/tasks` | List tasks (filter: workspace_id, status, sprint_id, milestone_id, backlog=true) |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks/{id}` | Get task with agent joins, subtasks, tags, comments, blockers, resources, acceptance criteria |
| PATCH | `/api/tasks/{id}` | Update task (triggers workflow engine on status changes) |
| DELETE | `/api/tasks/{id}` | Delete task |
| POST | `/api/tasks/{id}/dispatch` | Dispatch to agent via OpenClaw |
| POST | `/api/tasks/{id}/fail` | Report stage failure (triggers fail-loopback) |
| GET/POST | `/api/tasks/{id}/activities` | Activity audit log |
| GET/POST | `/api/tasks/{id}/deliverables` | File/URL/artifact outputs |
| GET/POST | `/api/tasks/{id}/subagent` | Sub-agent session registration |
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
| GET | `/api/agents` | List agents (triggers ensureSynced) |
| GET/PATCH/DELETE | `/api/agents/{id}` | Agent CRUD (PATCH writes back to OpenClaw config) |
| POST | `/api/agents/sync` | Manual sync from gateway config |

### Workspaces
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/workspaces` | List (optional stats=true) / create workspace |
| GET/PATCH/DELETE | `/api/workspaces/{id}` | Workspace CRUD (lookup by ID or slug) |
| GET/POST | `/api/workspaces/{id}/knowledge` | Learner knowledge entries |
| GET/POST | `/api/workspaces/{id}/workflows` | Workflow templates |

### Other
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/events/stream` | SSE event stream |
| GET | `/api/tags` | List tags for workspace |
| POST | `/api/tags` | Create tag |
| PATCH/DELETE | `/api/tags/{id}` | Update/delete tag |
| GET/PATCH/DELETE | `/api/openclaw/sessions/{id}` | OpenClaw session management |
| POST | `/api/files/upload` | Upload file from remote agent |
| GET | `/api/files/download` | Download file |
| POST | `/api/webhooks/agent-completion` | HMAC-verified agent completion webhook |
| GET | `/api/demo` | Demo mode status flag |

---

## Database Schema

19 migrations (001-019), auto-run on DB connection in `src/lib/db/index.ts`. Schema creation (`schema.ts`) only runs for fresh databases.

### Core Tables
- **workspaces** -- slug, name, description, icon, github_repo, owner_email, coordinator_email, logo_url
- **agents** -- name, role, status, is_master, model, source, gateway_agent_id, session_key_prefix, agent_dir, agent_workspace_path, soul_md, user_md, agents_md
- **tasks** -- title, description, status, priority, task_type, effort, impact, assigned_agent_id, sprint_id, milestone_id, parent_task_id, workflow_template_id, due_date, planning fields
- **sprints** -- workspace_id, name, goal, sprint_number, start_date, end_date, status
- **milestones** -- workspace_id, name, description, due_date, status, coordinator_agent_id
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

---

## Authentication

When `MC_API_TOKEN` is set in `.env.local`:
- External API calls require `Authorization: Bearer <token>` header.
- Same-origin browser requests bypass auth.
- SSE streams accept token as query parameter.
- Implemented in `src/middleware.ts`.

Webhook verification: `WEBHOOK_SECRET` env var, HMAC signature in `x-webhook-signature` header.

---

## Agent Protocol

**Dispatch**: Task dispatched to agent via OpenClaw `chat.send` RPC. Includes task ID, description, output directory, callback endpoints. Role-specific instructions (builder: "when done, update to testing"; tester: "pass -> review, fail -> POST /fail").

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
4. **Sprints and milestones are independent**: A task can belong to a sprint, a milestone, both, or neither. They are not hierarchically related.
5. **Agent sync from gateway config**: Agents defined in OpenClaw config files, auto-synced on startup. Prompts stored in files (not DB). Synced agents appear in all workspaces.
6. **Migrations auto-run on DB connection**: Schema creation only for fresh databases. `legacy_alter_table = ON` during migrations to prevent FK rewriting bug.
7. **Component traceability**: Every React component's root DOM element has `data-component="src/path/to/File"` (relative path, no extension). Paste rendered HTML and immediately identify which source file to edit.

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
| `PROJECTS_PATH` | No | `~/Documents/Shared/projects` | Project files directory |
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
