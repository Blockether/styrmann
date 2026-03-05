# KNOWLEDGE.md -- Mission Control Consolidated Knowledge

This document consolidates all project knowledge previously scattered across
multiple markdown files. For agent instructions and deployment, see `AGENTS.md`.

---

## Architecture Overview

Mission Control is an AI Agent Orchestration Dashboard built with Next.js 14.
It connects to OpenClaw Gateway via WebSocket to dispatch tasks to AI agents
and track their progress in real-time.

```
Mission Control (Next.js, port 4000)
        |
        |-- WebSocket --> OpenClaw Gateway (port 18789)
        |                       |
        |                       +--> AI Providers (Anthropic, etc.)
        |
        +-- SQLite (better-sqlite3)
        |
        +-- SSE --> Browser clients (real-time updates)
```

## Task Lifecycle

```
PLANNING --> INBOX --> ASSIGNED --> IN_PROGRESS --> TESTING --> REVIEW --> DONE
```

- **PLANNING**: AI asks clarifying questions before work begins.
- **INBOX**: New tasks awaiting processing.
- **ASSIGNED**: Task assigned to an agent, auto-dispatched via OpenClaw.
- **IN_PROGRESS**: Agent actively working.
- **TESTING**: Automated quality gate (browser tests, CSS validation, resource checks).
- **REVIEW**: Passed automated tests, awaiting human approval (queue -- no agent dispatch).
- **DONE**: Task completed and approved.

**Fail-loopback**: If testing or verification fails, task returns to IN_PROGRESS
and the builder agent is re-dispatched.

## Sprint and Milestone Hierarchy

```
Sprint (SPRINT-N, auto-incremented)
  +-- Milestone (with coordinator agent)
        +-- Task
        +-- Task
```

Milestones are task groups within a sprint. Each milestone has a coordinator
agent who gets notified when all child tasks complete.

## Workflow Engine

Three workflow templates: Simple, Standard, Strict.

The **Strict** template defines a full pipeline:
- Builder -> Tester -> Queue (review) -> Verifier -> Done
- Each stage transition dispatches to the appropriate role agent
- If no agent is assigned for a role, a dispatch error banner appears on the card
- Review is a queue stage (role=null) -- no agent dispatch
- Verification is active QC by a verifier agent

The workflow engine lives in `src/lib/workflow-engine.ts` and handles:
- Stage transitions via `handleStageTransition()`
- Role-to-agent lookup from `task_roles` table
- Fail-loopback routing with detailed reasons

## API Endpoints

### Core CRUD

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tasks` | GET | List all tasks (filterable by status, workspace) |
| `/api/tasks` | POST | Create task |
| `/api/tasks/{id}` | GET | Get task details |
| `/api/tasks/{id}` | PATCH | Update task (triggers workflow engine on status changes) |
| `/api/tasks/{id}/dispatch` | POST | Dispatch task to agent via OpenClaw |
| `/api/tasks/{id}/fail` | POST | Report stage failure (triggers fail-loopback) |
| `/api/agents` | GET/POST | Agent CRUD |
| `/api/agents/{id}` | GET/PATCH/DELETE | Agent management |
| `/api/sprints` | GET/POST | Sprint CRUD |
| `/api/sprints/{id}` | GET/PATCH/DELETE | Sprint management |
| `/api/milestones` | GET/POST | Milestone CRUD |
| `/api/milestones/{id}` | GET/PATCH/DELETE | Milestone management |
| `/api/workspaces` | GET/POST | Workspace CRUD |
| `/api/workspaces/{id}` | GET/PATCH/DELETE | Workspace management |
| `/api/tags` | GET/POST | Tag management |

### Task Sub-Resources

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tasks/{id}/activities` | GET/POST | Activity log (audit trail) |
| `/api/tasks/{id}/deliverables` | GET/POST | File/URL/artifact outputs |
| `/api/tasks/{id}/subagent` | GET/POST | Sub-agent session registration |
| `/api/tasks/{id}/roles` | GET/PUT | Role-to-agent assignments |

### Real-Time and Gateway

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/events/stream` | GET | SSE event stream |
| `/api/openclaw/sessions` | GET | List OpenClaw sessions |
| `/api/openclaw/sessions/{id}` | PATCH/DELETE | Update/delete session |
| `/api/files/upload` | POST | Upload file from remote agent |
| `/api/files/download` | GET | Download file |
| `/api/files/reveal` | POST | Open file in file manager |
| `/api/webhooks/completion` | POST | Agent completion webhook |

### Workspace Extensions

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/workspaces/{id}/knowledge` | GET/POST | Learner knowledge entries |
| `/api/workspaces/{id}/workflows` | GET/POST | Workflow templates |

## SSE (Server-Sent Events)

Real-time updates use SSE, not WebSocket. The system broadcasts these events:

- `task_created` -- New task added
- `task_updated` -- Task modified (including status changes)
- `activity_logged` -- New activity logged
- `deliverable_added` -- New deliverable registered
- `agent_spawned` -- Sub-agent started
- `agent_completed` -- Sub-agent finished

**Client**: `src/hooks/useSSE.ts` connects to `/api/events/stream`
with auto-reconnect (5s retry) and 30s keep-alive pings.

**Server**: `src/lib/events.ts` manages connected clients and broadcasts.

## Agent Protocol

### Dispatch Format

When a task is dispatched, the agent receives:
- Task ID, title, description, priority
- Output directory path
- API endpoints to call back
- Role-specific instructions (builder/tester/verifier)

### Completion Format

```
TASK_COMPLETE: [concise summary] | deliverables: [paths] | verification: [how verified]
```

### Progress Updates

```
PROGRESS_UPDATE: [what changed] | next: [next step] | eta: [time]
```

### Blocker Reports

```
BLOCKED: [what is blocked] | need: [specific input] | meanwhile: [fallback work]
```

## Orchestration Helper Library

`src/lib/orchestration.ts` provides helper functions:

- `onSubAgentSpawned()` -- Register sub-agent, log activity, broadcast event
- `onSubAgentCompleted()` -- Mark session complete, log deliverables, broadcast
- `logActivity()` -- Log task activity with type and message
- `logDeliverable()` -- Register file/URL/artifact output
- `registerSubAgentSession()` -- Register sub-agent in DB
- `completeSubAgentSession()` -- Mark session complete with timestamp
- `verifyTaskHasDeliverables()` -- Check before approval (review -> done requires deliverables)

## Learner Knowledge Loop

`src/lib/learner.ts` implements a knowledge loop:
- Captures transition outcomes (pass/fail) as knowledge entries
- Injects relevant lessons into future dispatches
- Learner agent gets notified when tasks complete

## Database Schema

### Core Tables

- `workspaces` -- Multi-workspace support with slug routing
- `agents` -- Agent definitions (synced from gateway config)
- `tasks` -- Task records with full lifecycle status
- `sprints` -- Sprint containers (SPRINT-N naming)
- `milestones` -- Task groups within sprints
- `tags` -- Tag management
- `task_tags` -- Task-tag associations

### Workflow Tables

- `workflow_templates` -- Pipeline definitions (Simple/Standard/Strict)
- `workflow_stages` -- Stage definitions per template
- `task_roles` -- Role-to-agent assignments per task

### Activity Tables

- `task_activities` -- Audit log (activity_type, message, agent_id, metadata)
- `task_deliverables` -- Output artifacts (file/url/artifact)
- `openclaw_sessions` -- Gateway sessions (persistent + subagent types)

### Other Tables

- `planning_questions` -- AI planning Q&A
- `planning_specs` -- AI-generated specifications
- `conversations` -- Chat history
- `events` -- System event log
- `workspace_knowledge` -- Learner knowledge entries
- `_migrations` -- Applied migration tracking

## Authentication

When `MC_API_TOKEN` is set in `.env.local`:
- External API calls require `Authorization: Bearer <token>` header
- Same-origin browser requests bypass auth (no header needed)
- SSE streams accept token as query parameter
- Implemented in `src/middleware.ts`

## Configuration Helpers

`src/lib/config.ts` provides:
- `getMissionControlUrl()` -- Auto-detects API URL
- `getWorkspaceBasePath()` -- Workspace root directory
- `getProjectsPath()` -- Projects directory

Environment variables override UI settings for server operations.

## File Operations (Remote Agents)

Remote agents without filesystem access use:

```
POST /api/files/upload
{
  "relativePath": "project-name/filename.html",
  "content": "file contents...",
  "encoding": "utf-8"
}
```

Files are saved at `$PROJECTS_PATH/{relativePath}`.

Download:
```
GET /api/files/download?relativePath=project-name/filename.html
GET /api/files/download?relativePath=project-name/filename.html&raw=true
```

## Debugging

Enable debug mode in browser console:
```javascript
mcDebug.enable()
```

Logs prefixed with:
- `[SSE]` -- Server-sent events
- `[STORE]` -- Zustand state changes
- `[API]` -- API calls
- `[FILE]` -- File operations

## Activity Types

| Type | Description |
|------|-------------|
| `spawned` | Sub-agent created |
| `updated` | General progress update |
| `completed` | Work finished |
| `file_created` | File created/modified |
| `status_changed` | Status transition |

## Deliverable Types

| Type | Description |
|------|-------------|
| `file` | Local file (path required, must exist) |
| `url` | Web URL |
| `artifact` | Other output |

## Key Design Decisions

1. **SSE over WebSocket**: Simpler, works with Next.js out of the box,
   sufficient for unidirectional server-to-client updates.

2. **SQLite over Postgres**: Single-file database, zero config, sufficient
   for single-server deployment. WAL mode for concurrent reads.

3. **Single-page dashboard**: All views (Sprint, Backlog, Pareto, Activity)
   render in the same page via state switching. No route navigations between
   views -- prevents layout jumps and maintains scroll position.

4. **Agent sync from gateway config**: Agents are defined in OpenClaw
   gateway configuration files and auto-synced on startup. Prompts stored
   in files, not in the database. Agents appear in all workspaces.

5. **Migrations auto-run**: All migrations execute on DB connection in
   `src/lib/db/index.ts`. Schema creation only runs for fresh databases
   to avoid re-running on existing ones.

## Nginx/Proxy SSE Configuration

If running behind a reverse proxy:

```nginx
location /api/events/stream {
    proxy_pass http://localhost:4000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding off;
}
```

## Common Issues

- **SSE not connecting**: Check browser console for `[SSE] Connected`. If not,
  verify `/api/events/stream` endpoint and check for proxy buffering.
- **Agent counter stuck at 0**: Counter only shows sub-agents with
  `session_type='subagent'` and `status='active'`.
- **Migration FK bug (fixed)**: Migration 011 fixed dangling FK references
  caused by SQLite rewriting FKs during `ALTER TABLE`. Runner now sets
  `legacy_alter_table = ON`.
- **Port 4000 in use**: `lsof -i :4000` then `kill -9 <PID>`.
- **Agent callbacks failing behind proxy**: Set `NO_PROXY=localhost,127.0.0.1`.
