# KNOWLEDGE.md -- Styrmann

Last updated: 2026-03-14

---

## Architecture

Styrmann is a self-contained control plane for orchestrating agent and human delivery. It dispatches tasks to OpenCode agent sessions via CLI spawn. No external gateway required.

```
Browser <-- SSE -- Styrmann (Next.js, port 4000) -- child_process.spawn --> OpenCode CLI
                          |
                      SQLite DB
```

**Tech stack**: Next.js 16, React 19, TypeScript 5.9, SQLite (better-sqlite3), Zustand, Tailwind CSS 4, Zod, Lucide React, SSE. ESLint 9 (flat config).

**Service**: systemd unit `mission-control`, Rocky Linux, port 4000, URL https://control.blockether.com.

### OpenCode ACP Integration

Agent dispatch uses OpenCode CLI (not OpenClaw Gateway WebSocket):
- `src/lib/acp/client.ts` — `dispatchToOpenCode()` spawns `opencode --session {key}` and writes task message to stdin
- Session key format: `{agent.session_key_prefix}{session_id}` (e.g. `agent:main:mission-control-builder-abc12345`)
- Process runs detached (fire-and-forget); OpenCode handles its own lifecycle
- Agent system prompts embedded in `src/lib/agent-prompts.ts` — no external prompt storage

### Semantic Agent Roles

Eight roles defined in `src/lib/agent-roles.ts` with system prompts in `src/lib/agent-prompts.ts`:
- `orchestrator` — coordinates multi-agent workflows, plans, delegates
- `builder` — implements features, writes code, creates deliverables
- `tester` — runs tests, verifies correctness
- `reviewer` — reviews code quality, architecture, security
- `explorer` — researches, investigates, gathers information
- `pragmatist` — practical solutions, trade-off analysis
- `guardian` — security, compliance, risk assessment
- `consolidator` — merges work, resolves conflicts, integrates

### Architectural Rationale (OpenClaw Removal)

OpenClaw Gateway was removed because:
- OpenClaw harness is designed for conventional workflows, not coding agents
- OpenClaw requires external configuration and maintenance outside the repository
- OpenCode ACP makes Styrmann fully plug-and-play — no external dependencies
- OpenCode provides more powerful agent execution

---

## Dashboard Architecture

The homepage lists organizations and their workspaces. Clicking a workspace opens the single-page workspace dashboard. No route navigations between views within a workspace.

**Org-first navigation**: The root `/` page groups workspaces by organization. Each organization card shows its name, slug, and workspace count. Workspaces without an `organization_id` appear under an "Ungrouped" section.

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

**Task creation behavior**: New AI tasks no longer expose manual loop, template, or per-task execution controls. The orchestrator generates a workflow plan immediately from existing agents and linked skills only, stores it on the task, and leaves the task in `inbox` until execution begins. Human tasks still require a selected human and move to `assigned`, which triggers an email through Himalaya.

**Task creation UI**: Manual agent loop configuration, task-level template picking, and direct execution settings are removed. The task modal now shows Overview, Activity, Sessions, and Deliverables tabs. Planning is merged into Activity: the workflow blueprint and runtime activity timeline are presented together, including current step and iteration context. Capability proposals remain inline below the workflow plan diagram.

**Activity orchestration UX**: The Activity tab now presents a staged orchestration control room instead of a dense planning block. The workflow plan is split into an orchestration guide, participant roster, live runtime strip, and per-stage cards that explain owner, trigger phase, expected outcome, skill coverage, and failure loopback. Activity log cards and the task detail shell use the same cream/gold visual language so the whole task view reads as one continuous pipeline surface.

**Task Activity tab policy**: Task-modal Activity renders raw `task_activities` directly. Presenter consolidation cards/labels are removed from the task Activity tab.

**Deliverables UX**:
- Deliverables API enriches file/url/artifact entries with derived provenance (`created_via_agent_name`, `created_via_workflow_step`, `created_via_session_id`) using existing session/activity joins.
- Deliverable cards show stage + agent provenance whenever an `openclaw_session_id` is available.
- Generic legacy descriptions are replaced at read time with derived stage/agent provenance text when session/activity context exists.

**Replanning lock**: Regenerating/editing workflow plans is allowed only before execution starts (`planning`, `inbox`, `pending_dispatch`). Once a task enters runtime stages (`assigned`, `in_progress`, `testing`, `review`, `verification`, `done`), workflow-plan regenerate/edit endpoints return `409 REPLAN_LOCKED`, and Activity UI hides plan-edit controls.

**Runtime communication updates**:
- Activity execution header now includes explicit current runtime agent (`none active` if no active session).
- Deliverables phase summaries are split into `Current Run` (since last resume) and `Historical Attempts` (before last resume) so stale failures from older attempts are not presented as current run state.

**Task fields**: title, description, status, priority (low/normal/high/urgent), task_type (bug/feature/chore/documentation/research), effort (1-5), impact (1-5), assignee_type (`ai` | `human`), assigned_agent_id, assigned_human_id, milestone_id, workflow_template_id, workflow_plan_id, due_date, tags.

Tasks get sprint context via `milestone.sprint_id`. There is no direct `sprint_id` on tasks.

**Task sub-resources**: comments, blockers (with blocked_by_task_id), resources (links/docs/designs), acceptance criteria (with is_met flag), activities (audit log), deliverables (file/url/artifact), task sessions and traces.

**Workflow plan persistence**: Each AI task can store `workflow_plan_id`, pointing to a persisted orchestrator plan in `task_workflow_plans` with participants, per-step skills, and step order.

---

## Hierarchy

The full hierarchy from org to task:

```
Organization -> Workspace -> Sprint -> Milestone -> Task
```

Organizations group workspaces. Each workspace has its own sprints, milestones, and tasks. The workspace-level hierarchy is strict: sprints contain milestones, milestones contain tasks. A task belongs to a milestone; a milestone optionally belongs to a sprint. Tasks do not belong directly to sprints.

Organizations also have a parallel business-facing track:

```
Organization -> Org Tickets (human-facing, Jira-style)
                    |
                    v (delegation)
             Workspace Tasks (via orchestrator)
```

Org tickets are the only authorized way to create workspace tasks in production. The delegation endpoint acts as an auth gate.

**Backlog**: tasks where `milestone_id IS NULL` and status != `done`.

---

## Organizations

Organizations are the top-level grouping entity. They are auto-created during workspace discovery when `discoverRepoWorkspaces()` detects a new org directory under `STYRMAN_PROJECTS_PATH`. Each org directory (e.g., `/root/repos/blockether`) becomes one organization.

**Fields**: id, name, slug, description, logo_url.

**Workspace link**: `workspaces.organization_id` is a nullable FK to `organizations(id)`. Workspaces discovered under the same org directory share the same `organization_id`.

**API**:
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/organizations` | List all organizations |
| POST | `/api/organizations` | Create organization |
| GET | `/api/organizations/[id]` | Get organization by ID |
| PATCH | `/api/organizations/[id]` | Update organization |
| DELETE | `/api/organizations/[id]` | Delete organization |

---

## Organizational Tickets

Org tickets are human-facing business tickets at the organization level, analogous to Jira issues. They represent work requests from stakeholders before that work is broken down into technical tasks.

**Fields**: id, organization_id, title, description, status, priority, ticket_type, external_ref, external_system, creator_name, assignee_name, due_date, tags.

**ticket_type**: `feature | bug | improvement | task | epic`.

**Lifecycle**:
```
open -> triaged -> delegated -> in_progress -> resolved -> closed
```

**Delegation**: `POST /api/org-tickets/[id]/delegate` converts an org ticket into one or more workspace tasks. The delegation module (`src/lib/delegation.ts`) uses LLM planning to decompose the ticket into 1-3 tasks with acceptance criteria. Falls back to a single task if LLM is unavailable. Each created task gets an `org_ticket_id` FK and a `delegates_to` entity link from the ticket to the task. The ticket status moves to `delegated` atomically.

**Auth gate**: Delegation is the only authorized path to create workspace tasks in production. Direct `POST /api/tasks` is available but gated by the same auth middleware.

**FTS**: `org_tickets_fts` virtual table enables full-text search on title and description.

**API**:
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/org-tickets` | List org tickets (filter: organization_id, status, priority) |
| POST | `/api/org-tickets` | Create org ticket |
| GET | `/api/org-tickets/[id]` | Get org ticket |
| PATCH | `/api/org-tickets/[id]` | Update org ticket |
| DELETE | `/api/org-tickets/[id]` | Delete org ticket |
| POST | `/api/org-tickets/[id]/delegate` | Delegate ticket to workspace tasks |

---

## Memory System

Memories are the raw knowledge store for an organization. They capture facts, decisions, events, and observations from development activity.

**8 memory types**: `fact`, `decision`, `event`, `tool_run`, `error`, `observation`, `note`, `patch`.

**Fields**: id, organization_id, workspace_id, memory_type, title, summary, body, source, source_ref, confidence (0-100), status (open/resolved/closed), metadata (JSON), tags (JSON).

**Provenance**: `source` names the origin system (e.g., `agent`, `discord`, `webhook`). `source_ref` is a free-form reference (e.g., session ID, commit hash, ticket number).

**Status lifecycle**: `open -> resolved -> closed`. Synthesis reads `open` and `resolved` memories; `closed` memories are excluded.

**FTS**: `memories_fts` virtual table (FTS5, porter tokenizer) enables full-text search on title, summary, and body. Kept in sync via INSERT/UPDATE/DELETE triggers.

**API**:
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/memories` | List memories (filter: organization_id, workspace_id, memory_type, status, search) |
| POST | `/api/memories` | Create memory |
| GET | `/api/memories/[id]` | Get memory |
| PATCH | `/api/memories/[id]` | Update memory |
| DELETE | `/api/memories/[id]` | Delete memory |

---

## Entity Links

Entity links are generic directed edges between any two entities in the system. They form a knowledge graph that connects org tickets, tasks, memories, knowledge articles, commits, and other entities.

**10 link types**: `delegates_to`, `blocks`, `relates_to`, `derived_from`, `references`, `parent_of`, `motivated_by`, `resolved_by`, `contains`, `touches`.

**Fields**: id, from_entity_type, from_entity_id, to_entity_type, to_entity_id, link_type, explanation.

**Self-link prevention**: A CHECK constraint enforces `from_entity_id != to_entity_id`.

**Unique constraint**: `(from_entity_id, to_entity_id, link_type)` is unique. Duplicate links are silently ignored via `INSERT OR IGNORE`.

**Graph traversal**: `GET /api/entity-links/graph` uses a recursive CTE with `MAX_DEPTH=10` to traverse the full reachability graph from a given root entity.

**System-created links**:
- Delegation creates `org_ticket -> delegates_to -> task`
- Knowledge synthesis creates `knowledge_article -> derived_from -> memory` for each source memory

**API**:
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/entity-links` | List links (filter: from_entity_id, to_entity_id, link_type) |
| POST | `/api/entity-links` | Create link |
| GET | `/api/entity-links/graph` | Recursive graph traversal from a root entity |

---

## Knowledge Synthesis

Knowledge synthesis converts raw memories into curated, LLM-authored knowledge articles. It runs as a daemon module and can also be triggered on demand.

**Pipeline** (`src/lib/knowledge-synthesis.ts`):
1. Fetch all non-closed memories for the organization (optionally scoped to a workspace).
2. Group memories into batches of up to `maxMemoriesPerArticle` (default 20).
3. For each batch, compute a `synthesis_prompt_hash` (SHA-256 of sorted memory IDs + summaries). Skip if an up-to-date article with that hash already exists.
4. Send batch to LLM with a synthesis prompt. LLM returns `{title, summary, body}`.
5. Archive any stale articles for the same org/workspace.
6. Insert new `knowledge_article` with status `published`.
7. Create `derived_from` entity links from the article to each source memory.
8. Broadcast `knowledge_synthesized` SSE event.

**Staleness detection**: Articles with `status='stale'` are archived before new ones are inserted. Articles become stale when their source memories are updated.

**Daemon**: The synthesis daemon module runs hourly. It iterates all organizations and calls `synthesizeKnowledge()` for each.

**Minimum threshold**: Synthesis requires at least `minMemories` (default 3) memories before running.

**API**:
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/knowledge` | List knowledge articles (filter: organization_id, workspace_id, status, search) |
| GET | `/api/knowledge/[id]` | Get knowledge article |
| PATCH | `/api/knowledge/[id]` | Update or archive article |
| DELETE | `/api/knowledge/[id]` | Delete article |
| POST | `/api/knowledge/synthesize` | Trigger LLM synthesis for an organization |

---

## Full-Text Search

Styrmann uses SQLite FTS5 virtual tables with the external content pattern. All FTS tables use the porter tokenizer for stemming.

**FTS5 virtual tables**:
| Table | Source table | Indexed columns |
|-------|-------------|-----------------|
| `memories_fts` | `memories` | title, summary, body |
| `knowledge_articles_fts` | `knowledge_articles` | title, summary, body |
| `org_tickets_fts` | `org_tickets` | title, description |
| `commits_fts` | `commits` | message, author_name |

Each FTS table is kept in sync with its source via three triggers: `AFTER INSERT`, `AFTER DELETE`, and `AFTER UPDATE`. The update trigger deletes the old row and inserts the new one.

**Unified search endpoint**: `GET /api/search` queries all FTS tables and returns ranked results. Supports `entity_types` filter to restrict which tables are searched.

---

## Commit Ingestion

Commits are ingested from external CI/CD systems or git hooks via a REST API. They are stored in the `commits` table and indexed for full-text search.

**Fields**: id, workspace_id, commit_hash, message, author_name, author_email, branch, files_changed (JSON), insertions, deletions, committed_at, ingested_at, metadata (JSON).

**Unique constraint**: `(workspace_id, commit_hash)` prevents duplicate ingestion.

**Ticket reference parsing**: The ingestion endpoint parses commit messages for ticket references in the formats `#123` and `PROJ-123`. Matched references are stored in `metadata` and can be used to create entity links between commits and org tickets.

**FTS**: `commits_fts` enables full-text search on commit message and author name.

**API**:
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/commits` | List commits (filter: workspace_id, branch, author_email, search) |
| POST | `/api/commits` | Ingest one or more commits |

---

## Webhook System

Styrmann supports outbound webhooks for pushing events to external dev portals, CI systems, or monitoring tools.

**Registration**: Webhooks are registered per organization. Each registration specifies a target URL, an optional HMAC secret, and a list of event types to subscribe to. An empty `event_types` array means "subscribe to all events".

**Delivery** (`src/lib/webhook-delivery.ts`):
1. On each broadcast event, `deliverWebhookEvent()` finds all active, non-failed webhooks matching the event type.
2. A `webhook_deliveries` row is created with status `pending`.
3. Delivery runs asynchronously with up to 3 attempts and exponential backoff (1s, 5s, 30s).
4. Each request includes `X-Webhook-Event`, `X-Delivery-ID`, and (if secret is set) `X-Webhook-Signature: sha256=<hmac>`.
5. On success, `failure_count` resets to 0. On failure, `failure_count` increments.

**HMAC signing**: `HMAC-SHA256` over the full JSON payload string. Signature format: `sha256=<hex>`.

**Auto-disable**: Webhooks with `failure_count >= 10` are excluded from future deliveries. They must be manually re-enabled via PATCH.

**Delivery tracking**: `webhook_deliveries` records every attempt with `response_status`, `response_body` (truncated to 1000 chars), and `attempts` count.

**API**:
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/webhooks/registrations` | List webhook registrations |
| POST | `/api/webhooks/registrations` | Create webhook registration |
| GET | `/api/webhooks/registrations/[id]` | Get registration |
| PATCH | `/api/webhooks/registrations/[id]` | Update registration (re-enable, change URL/secret/events) |
| DELETE | `/api/webhooks/registrations/[id]` | Delete registration |

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

**Fields**: workspace_id, name, description, due_date, status (open/closed), coordinator_agent_id (auto-resolved from default orchestrator), sprint_id, priority.

**sprint_id**: FK to sprints (nullable). A milestone can exist without a sprint (it will appear in the backlog view).

**priority**: `'low' | 'normal' | 'high' | 'urgent'`. Defaults to `'normal'`.

**story_points**: Computed at read time via `SUM(task.effort)` across all tasks in the milestone. Never stored in the database.

**Coordinator agent**: Optional. Informational only -- displayed in the UI alongside the milestone name and progress bar. No automated notifications or dispatch tied to the coordinator.

**In ActiveSprint list view**: Tasks are grouped by milestone. Each group shows milestone name, coordinator initials, and a progress bar (done/total). Ungrouped tasks appear at the bottom.

**Empty milestone visibility**: Sprint milestones remain visible even when they have zero tasks. Empty groups show a "No tasks yet in this milestone." placeholder with an inline Create Task action.

**Milestone-scoped task creation**: ActiveSprint milestone groups include a New Task button that opens TaskModal with that milestone pre-selected.

Cannot delete a milestone that has tasks.

### Milestone Dependencies

The `milestone_dependencies` table tracks ordering relationships between milestones.

**Fields**: id, milestone_id, depends_on_milestone_id (nullable), depends_on_task_id (nullable), dependency_type.

**dependency_type**: `'finish_to_start' | 'blocks'`.

**Constraint**: at least one of `depends_on_milestone_id` or `depends_on_task_id` must be non-null.

**v1 behavior (milestones only)**: Milestone dependencies are informational only. No milestone-level dispatch blocking is enforced.

**Task-level behavior**: Task dependencies are enforceable via `task_dependencies`. Dispatch and forward stage transitions are hard-blocked when required dependency statuses are unmet.

---

## Backlog

Backlog = tasks with `milestone_id IS NULL` and status != `done`. The BacklogView shows these tasks in a sortable table with filters for priority, type, and tags. Tasks can be assigned to a milestone directly from the backlog card.

**Assignee display rule**: task cards and hover summaries no longer expose AI agent names as the assignee label. AI-owned tasks display `AI`. Human-owned tasks display `HUMAN` plus the selected human's full name.

---

## Pareto View

Effort/impact matrix. Tasks plotted by their effort (1-5) and impact (1-5) scores. High-impact/low-effort tasks surface to the top.

Pareto excludes tasks with `status = 'done'` and only evaluates active tasks in the current workspace.

---

## Tags

Workspace-scoped. Many-to-many with tasks via `task_tags` junction table. Each tag has a name (unique per workspace) and color. CRUD via `/api/tags`.

---

## Workflow Engine

Workflow planning is now orchestrator-owned. The system chooses among the existing template shapes (Simple, Standard, Strict, Auto-Train where applicable), persists a concrete plan per task, and never creates new agents dynamically.

| Template | Pipeline | Default |
|----------|----------|---------|
| Simple | Builder -> Reviewer -> Done | No |
| Standard | Builder -> Tester -> Reviewer -> Done | No |
| Strict | Builder -> Tester -> Verify -> Review -> Done | Yes |
| Auto-Train | Builder -> Loop Complete | No |
| Architecture | Explorer -> Simplicity Review -> Correctness Review -> Consolidate -> Done | No |

The Strict template is the default. Per-task workflow plans persist selected participants, per-step skills, loopback targets, findings, and learner proposals.

**Workflow engine** (`src/lib/workflow-engine.ts` + `src/lib/workflow-planning.ts`):
- `generateTaskWorkflowPlan()` is async. It selects existing agents via rule-based role matching, then applies LLM-powered skill selection to refine per-agent skill picks. Plans are stored in `task_workflow_plans`.
- **LLM skill selection** (`llmSelectSkills()`): After rule-based agent selection, sends task context and each agent's available skills to an LLM (provider resolved via `src/lib/llm.ts`). The LLM returns a JSON map of `{agent_id: [skill1, skill2]}` selecting only the most relevant skills per agent per task. Falls back to rule-based `pickSkills()` if LLM is unavailable or errors.
- **LLM provider resolution** (`src/lib/llm.ts`): Provider-agnostic inference utility. Resolution order: `ANTHROPIC_API_KEY` env -> `OPENAI_API_KEY` env -> `~/.openclaw/openclaw.json` (reads first provider with apiKey). Supports Anthropic, Gemini, and OpenAI-compatible APIs. 25s timeout. Exports: `llmInfer()`, `llmJsonInfer()`, `isLlmAvailable()`.
- Missing capability creates a `task_findings` record and optional learner `capability_proposals` entry pointing to the meta repository. No dynamic agent creation is allowed.
- `handleStageTransition()` uses orchestrator-populated `task_roles` to assign and dispatch the correct existing agent for the active step.
- Fail-loopback: `POST /api/tasks/{id}/fail` routes task back to `in_progress` and re-dispatches builder.
- Orchestrators are planners/supervisors only. They are not auto-assigned to workflow execution stages.

**Builder hard gate (server-side):**
- Builder-owned tasks cannot move forward (`testing`/`review`/`verification`/`done`) without implementation evidence.
- Enforced in both `PATCH /api/tasks/{id}` and `POST /api/webhooks/agent-completion`.
- Evidence rule: at least one file deliverable OR at least one git commit in workspace repo since task creation.
- Violations return `409` and task status is not advanced.

**Template definitions are hardcoded** in `src/lib/workflow-templates.ts`. New workspaces get templates provisioned from these code constants via `provisionWorkflowTemplates()`. The orchestrator then picks among these shapes and persists the selected plan to the task.

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

**Meta repository**: Workspace `id='default'` is the internal `System / OpenClaw` meta repository. It has `repo_kind='meta'`, `is_internal=1`, no GitHub link, and `local_path='/root/.openclaw'`.

**Global visibility**: Agents are ALWAYS global. The `agents` table no longer includes `workspace_id`, and agent APIs/query paths now operate on the full global roster.

**Bootstrap policy**: `bootstrapCoreAgentsRaw()` is a fallback for fresh installs without an OpenClaw gateway. It bootstraps 8 local fallback agents globally: Orchestrator, Builder, Tester, Reviewer, Explorer, Pragmatist, Guardian, and Consolidator. If any synced agents exist, bootstrap is skipped entirely — synced agents ARE the real team. Workflow planning handles missing roles via `task_findings` and `capability_proposals` rather than creating new agents.

**OpenClaw prompt source policy**: Styrmann treats workspace `AGENTS.md` as the canonical agent instruction source and `SOUL.md` as identity/personality context. `system.md` in agent directories is considered legacy and is auto-migrated into workspace `AGENTS.md` + `SOUL.md` when detected, then removed. Framework-level duplicate system prompt injection is intentionally avoided.
**Agent fields**: name, role, description, status (standby/working/offline), model, source (local/gateway/synced), gateway_agent_id, session_key_prefix, agent_dir, agent_workspace_path, soul_md, user_md, agents_md. **API enrichment**: `GET /api/agents` returns `active_task_count` (number of active tasks) and `current_task_title` (title of in-progress task, if any) for each agent.

**Prompts stored in files**: soul_md, user_md, agents_md are read from OpenClaw agent workspace directories on disk. Double binding -- files are the source of truth, DB reflects them.

**Workspace visibility**: Synced OpenClaw agents expose their real filesystem paths via `agent_dir` and `agent_workspace_path`. Styrmann includes a read-only browser endpoint for these roots so the agent modal can inspect the actual workspace/config directories and installed `skills/` entries on disk.

**OpenClaw modal policy**: Synced OpenClaw agents are inspected read-only in the Agent modal. The Operations/OpenClaw view is now a management entrypoint, not a direct prompt editor for synced agents. `/operations#agents/{agentId}` hash routes open agent-specific modals directly, the role field is selected from the canonical default role list, and the Agents panel shows a warning banner when required default roles are missing.

**Skill linking policy**: Main OpenClaw agent skills are treated as the shared source. Sub-agents link skills via symlinks into their workspace `skills/` directories (no copy). Styrmann exposes `/api/agents/{id}/skills` for listing and link/unlink/sync actions. Workflow planning reads these linked skills when choosing which existing agent should run each step.

### Presenter Role

The Presenter is a core role that interprets technical execution data without changing execution.

- Presenter summarizes task activity in real time from raw `task_activities`
- Presenter does not dispatch work, change statuses, or create capabilities
- Presenter output keeps full raw metadata and traces accessible via expansion
- Activity filtering supports agent, workflow step, and decision-event views while task-level activity remains scoped to the current task

**Semantic summarization** (`src/lib/activity-presentation.ts`): Each activity type gets a purpose-built human-readable summary. `dispatch_invocation` extracts agent name and step; `status_changed` extracts stage handoff or failure reason; `test_passed`/`test_failed` extracts pass/fail counts and failed deliverables; `completed` extracts TASK_COMPLETE summary; `spawned` extracts sub-agent name; `file_created` extracts deliverable type and path. HTTP/curl payloads extract method + hostname + path.

**Post-step consolidation** (`src/lib/task-activity.ts`): `consolidateStepActivities()` merges consecutive same-type activities from the same agent (deduplicates, keeps latest), collapses `status_changed` chains to final transition, and only applies to `post_step` summaries (live summaries keep all events). `presenterMessage()` builds unique semantic summaries with `[step]` / `[step completed]` prefix format.

**Workspace presenter feed**: `buildWorkspaceActivitySummary()` fetches latest presented activity per active task in a workspace. Exposed via `GET /api/workspaces/{id}/activity-summary?limit=N`. AgentActivityDashboard renders a "Presenter Feed" section with expandable per-task summaries (shows task status, agent, latest presenter message, and expandable raw activities).
### Human Assignments & Himalaya

- `humans` table stores assignable humans with `name`, `email`, and `is_active`.
- Migration seeds `Karol <karol@blockether.com>` and `Alex <alex@blockether.com>` as initial human assignees.
- `workspaces.himalaya_account` selects which Himalaya account Styrmann uses for human-assignment email delivery.
- `workspaces.coordinator_email` is used as the sender address in those emails.
- `GET /api/system/himalaya` reports CLI availability, configured accounts, selected account, and whether `himalaya account doctor` passes.
- Human-assigned tasks suppress AI dispatch and disable Team-tab role mapping until switched back to `ai`.
- Operations now includes a dedicated Human Assignment Routing panel for managing human assignees and default sender settings (`coordinator_email`, `himalaya_account`).

**Manual sync**: `POST /api/agents/sync` triggers `syncAgentsWithRpcCheck()` (attempts RPC to gateway, falls back to config-only).

### Orchestrator Role

One global agent has `role = 'orchestrator'`. This is the Product Owner / project manager role. The orchestrator is auto-resolved everywhere -- milestones, workflow plans, dispatch, and recovery all resolve the default orchestrator automatically. No user selection is required or exposed in the UI.

**Single global orchestrator constraint**: Creating a second orchestrator returns `409 Conflict`. Enforced at the API level.

**Demotion blocked**: `PATCH /api/agents/{id}` cannot change an orchestrator's role. Returns `400 Bad Request`. To change the orchestrator, delete the agent and recreate with a different role.

**Auto-resolution**: All subsystems that need the orchestrator (milestone creation, workflow planning, task dispatch, recovery daemon) resolve it via `SELECT id FROM agents WHERE role = 'orchestrator' ORDER BY created_at ASC LIMIT 1`. No manual assignment.

**Status is system-managed**: `PATCH /api/agents/{id}` rejects manual `status` updates with `403` (`Agent status is system-managed and cannot be updated manually`) unless the request carries internal daemon header `x-mc-system: daemon`.

**Agent modal policy**: The Agent modal no longer exposes a manual status selector; status transitions are driven by dispatch/completion/heartbeat automation only.

**Not a worker**: Orchestrators are excluded from workflow stage auto-assignment. They manage the project but do not execute tasks.

**UI**: Orchestrator agents display a Crown icon and "Product Owner" subtitle in AgentsSidebar.

---

## SSE (Real-Time)

Server-Sent Events, not WebSocket. Endpoint: `GET /api/events/stream`.

Events broadcast:
- `task_created`, `task_updated`, `task_deleted`
- `activity_logged`, `activity_presented`, `deliverable_added`, `deliverable_deleted`
- `agent_spawned`, `agent_completed`
- `agent_updated`, `agent_log_added`, `github_issues_synced`, `daemon_stats_updated`
- `organization_created`, `organization_updated`, `organization_deleted`, `org_ticket_created`, `org_ticket_updated`, `org_ticket_deleted`, `memory_created`, `memory_updated`, `entity_linked`, `commit_ingested`, `knowledge_synthesized`
Client: `src/hooks/useSSE.ts` with auto-reconnect (5s retry) and 30s keep-alive pings.
Server: `src/lib/events.ts` manages connected clients.

Fallback: Agent Activity Dashboard polls every 20s; task-specific views use SSE event listeners (`mc:task-updated`, `mc:activity-logged`, `mc:activity-presented`) for immediate updates instead of interval polling.

---

## API Endpoints

### Tasks
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/tasks` | List tasks (filter: workspace_id, status, milestone_id, backlog=true) |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks/{id}` | Get task with agent joins, tags, comments, blockers, resources, acceptance criteria |
| PATCH | `/api/tasks/{id}` | Update task (triggers workflow engine on status changes) |
| DELETE | `/api/tasks/{id}` | Delete task and cleanup OpenClaw sessions + task artifacts/worktrees (`task-artifacts/{taskId}` + legacy `.mission-control/tasks/{taskId}`) |
| POST | `/api/tasks/{id}/dispatch` | Dispatch to agent via OpenClaw |
| GET/POST | `/api/tasks/{id}/dependencies` | Task dependency list/create (`depends_on_task_id`, `required_status`) |
| PATCH/DELETE | `/api/tasks/{id}/dependencies/{dependencyId}` | Task dependency update/remove |
| GET/POST | `/api/tasks/{id}/artifacts` | Stage gate artifact evidence list/upsert (`artifact_key`, `artifact_value`, optional `stage_status`) |
| POST | `/api/tasks/{id}/fail` | Report stage failure (triggers fail-loopback) |
| GET/POST | `/api/tasks/{id}/activities` | Activity audit log (supports ?limit&offset pagination) |
| GET/POST | `/api/tasks/{id}/deliverables` | File/URL/artifact outputs (list/create) |
| GET/PATCH/DELETE | `/api/tasks/{id}/deliverables/{deliverableId}` | Single deliverable (read/update/delete) |
| GET/POST | `/api/tasks/{id}/subagent` | Legacy session registration endpoint (compatibility) |
| GET | `/api/tasks/{id}/sessions` | Task session list (session-centric) |
| GET | `/api/tasks/{id}/sessions/{sessionId}/trace` | Full session trace (dispatch invocation + OpenClaw history) |
| GET | `/api/tasks/{id}/changes` | Task changes summary (workspace, task-scoped files/commits, sessions with interruption/stale/finished breakdown, worktree metadata) |
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
| GET | `/api/agents` | List all global agents (triggers ensureSynced); enriches each agent with `active_task_count` and `current_task_title` from tasks table |
| GET/PATCH/DELETE | `/api/agents/{id}` | Agent CRUD (PATCH writes back to OpenClaw config; cannot demote orchestrator; manual `status` updates forbidden unless internal daemon call) |
| GET | `/api/agents/{id}/workspace` | Read-only browser for synced agent workspace/config roots (`scope=workspace|agent`, `path=...`) |
| GET/POST | `/api/agents/{id}/skills` | Inspect and manage shared skill links for synced agents (`link`, `unlink`, `replace_with_link`, `sync_all`) |
| POST | `/api/agents/sync` | Manual sync from gateway config |
| GET/POST | `/api/humans` | List or create human assignees |
| GET/PATCH/DELETE | `/api/humans/{id}` | Read, update, or deactivate a human assignee |
| GET | `/api/system/himalaya` | Inspect Himalaya CLI/account health for human assignment email delivery |

### Workspaces
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/workspaces` | List (optional stats=true) / create repository/workspace |
| GET/PATCH/DELETE | `/api/workspaces/{id}` | Workspace CRUD (lookup by ID or slug); internal meta repository cannot be linked to GitHub; DELETE returns 403 for internal workspaces (checked by both `id === 'default'` and `is_internal` flag) |
| GET/POST | `/api/workspaces/{id}/workflows` | Workflow templates |
| GET | `/api/workspaces/{id}/activity-summary` | Presenter summaries across active tasks (query: ?limit=N, max 50) |

### Other
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/events/stream` | SSE event stream |
| POST | `/api/events/broadcast` | Daemon SSE relay (broadcasts event to all connected clients) |
| GET | `/api/tags` | List tags for workspace |
| POST | `/api/tags` | Create tag |
| PATCH/DELETE | `/api/tags/{id}` | Update/delete tag |
| GET/PATCH/DELETE | `/api/openclaw/sessions/{id}` | OpenClaw session management (DELETE attempts gateway `sessions.delete` by key before DB cleanup) |
| GET | `/api/openclaw/gateway-logs` | OpenClaw gateway runtime logs (RPC-first; journalctl fallback) |
| POST | `/api/files/upload` | Upload file from remote agent |
| GET | `/api/files/download` | Download file |
| POST | `/api/webhooks/agent-completion` | HMAC-verified agent completion webhook |
| GET | `/api/demo` | Demo mode status flag |
| GET | `/api/system/info` | Process memory, Node version, system memory, service statuses |
| POST | `/api/system/validate` | Run validation checks (env, DB, services, HTTP) — returns JSON |
| GET | `/api/daemon/stats` | Latest daemon stats snapshot (pushed by daemon every 30s) |
| POST | `/api/daemon/stats` | Daemon pushes its in-memory stats to MC |

### Organizations
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/organizations` | List/create organizations |
| GET/PATCH/DELETE | `/api/organizations/[id]` | Organization CRUD |

### Org Tickets
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/org-tickets` | List/create org tickets |
| GET/PATCH/DELETE | `/api/org-tickets/[id]` | Org ticket CRUD |
| POST | `/api/org-tickets/[id]/delegate` | Delegate ticket to workspace tasks via orchestrator |

### Memories
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/memories` | List/create memory entries (supports FTS search via `?search=`) |
| GET/PATCH/DELETE | `/api/memories/[id]` | Memory CRUD |

### Entity Links
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/entity-links` | List/create cross-entity links |
| GET | `/api/entity-links/graph` | Recursive graph traversal (MAX_DEPTH=10) from a root entity |

### Knowledge Articles
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/knowledge` | List synthesized knowledge articles (supports FTS search) |
| GET/PATCH/DELETE | `/api/knowledge/[id]` | Read/update/archive a single knowledge article |
| POST | `/api/knowledge/synthesize` | Trigger LLM-powered synthesis from memories into published articles |

### Commits
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/commits` | List/ingest commits (supports FTS search) |

### Webhooks
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/webhooks/registrations` | List/create webhook registrations |
| GET/PATCH/DELETE | `/api/webhooks/registrations/[id]` | Webhook registration CRUD |

### Search
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/search` | Unified FTS search across memories, knowledge articles, org tickets, commits (filter: `entity_types`) |

---

## Database Schema

62 migrations (001-062), auto-run on DB connection in `src/lib/db/index.ts`. Schema creation (`schema.ts`) only runs for fresh databases. After migrations, `discoverRepoWorkspaces()` scans `/root/repos/{org}/{repo}` for git repos and creates/syncs workspaces. Migrations 055-062 added the org/knowledge platform tables.

### Core Tables
- **organizations** -- id, name, slug (unique), description, logo_url. Auto-created from workspace discovery.
- **workspaces** -- slug (`{org}-{repo}` format), name, description, icon, github_repo, owner_email, coordinator_email, logo_url, organization, organization_id (FK to organizations, nullable)
- **agents** -- name, role, status, model, source, gateway_agent_id, session_key_prefix, agent_dir, agent_workspace_path, soul_md, user_md, agents_md. No `is_master` column.
- **tasks** -- title, description, status, priority, task_type, effort, impact, assigned_agent_id, milestone_id, workflow_template_id, workflow_plan_id, due_date, github_issue_id (nullable FK to github_issues), org_ticket_id (nullable FK to org_tickets). No `sprint_id`. No `parent_task_id`.
- **sprints** -- workspace_id, name, goal, sprint_number, start_date, end_date, status
- **milestones** -- workspace_id, name, description, due_date, status, coordinator_agent_id (auto-resolved from default orchestrator, not user-settable), sprint_id (FK nullable), priority ('low'|'normal'|'high'|'urgent')
- **milestone_dependencies** -- id, milestone_id, depends_on_milestone_id (nullable), depends_on_task_id (nullable), dependency_type ('finish_to_start'|'blocks')
- **tags** / **task_tags** -- workspace-scoped tags, many-to-many with tasks

### Org/Knowledge Platform Tables
- **org_tickets** -- organization_id, title, description, status, priority, ticket_type, external_ref, external_system, creator_name, assignee_name, due_date, tags (JSON)
- **memories** -- organization_id, workspace_id, memory_type (8 types), title, summary, body, source, source_ref, confidence (0-100), status, metadata (JSON), tags (JSON)
- **entity_links** -- from_entity_type, from_entity_id, to_entity_type, to_entity_id, link_type (10 types), explanation. Self-link prevented by CHECK constraint.
- **knowledge_articles** -- organization_id, workspace_id, title, summary, body, synthesis_model, synthesis_prompt_hash, source_memory_ids (JSON), status (draft/published/stale/archived), version, supersedes_id
- **commits** -- workspace_id, commit_hash, message, author_name, author_email, branch, files_changed (JSON), insertions, deletions, committed_at, metadata (JSON). Unique on (workspace_id, commit_hash).
- **webhooks** -- organization_id, url, secret, event_types (JSON), is_active, last_delivery_at, last_delivery_status, failure_count
- **webhook_deliveries** -- webhook_id, event_type, payload, status (pending/delivered/failed), response_status, response_body, attempts

### FTS5 Virtual Tables
Four FTS5 virtual tables use the external content pattern with porter tokenizer. Each is kept in sync via INSERT/UPDATE/DELETE triggers:
- **memories_fts** -- indexes memories(title, summary, body)
- **knowledge_articles_fts** -- indexes knowledge_articles(title, summary, body)
- **org_tickets_fts** -- indexes org_tickets(title, description)
- **commits_fts** -- indexes commits(message, author_name)

### Task Sub-Resource Tables
- **task_comments** -- author, content
- **task_blockers** -- blocked_by_task_id, description, resolved flag
- **task_dependencies** -- hard dependency edges (`task_id`, `depends_on_task_id`, `required_status`)
- **task_artifacts** -- gate evidence (`artifact_key`, `artifact_value`, optional `stage_status`)
- **task_resources** -- title, url, resource_type (link/document/design/api/reference)
- **task_acceptance_criteria** -- description, is_met, sort_order
- **task_activities** -- activity_type, message, agent_id, metadata (JSON)
- **task_activities metadata** -- presenter-friendly fields such as `workflow_step`, `decision_event`, trace/session context, and tool-call details are stored in metadata JSON; presenter summaries are computed from these raw events
- **task_deliverables** -- deliverable_type (file/url/artifact), title, path, description
- **task_roles** -- role, agent_id (unique per task+role)
- **task_workflow_plans** -- orchestrator_agent_id, workflow_template_id, workflow_name, summary, participants_json, steps_json
- **task_findings** -- finding_type, severity, title, detail, metadata
- **capability_proposals** -- learner_agent_id, proposal_type, title, detail, target_name, meta_workspace_id, meta_workspace_slug, status

### Workflow Tables
- **workflow_templates** -- stages (JSON array, supports per-stage `required_artifacts`/`required_fields`), fail_targets (JSON), is_default

### Session and Event Tables
- **openclaw_sessions** -- agent_id, openclaw_session_id, channel, status, session_type (persistent/subagent), task_id, ended_at
- **events** -- type, agent_id, task_id, message, metadata
- **github_issues** -- workspace_id, github_id (integer), issue_number, title, body, state ('open'|'closed'), state_reason, labels (JSON string), assignees (JSON string), github_url, author, created_at_github, updated_at_github, synced_at, task_id (nullable FK to tasks). Unique constraint on (workspace_id, issue_number). Indexes on workspace_id and (workspace_id, state).
- **task_provenance** -- task_id, session_id, kind ('external_user'|'inter_session'|'internal_system'), origin_session_id, source_session_key, source_channel, source_tool, receipt_text, receipt_data (JSON). Stores ACP provenance metadata and Source Receipt blocks parsed from OpenClaw session history.

---

---

## GitHub Issues Integration

GitHub Issues are synced from the workspace's `github_repo` URL using the `gh` CLI (authenticated as `michal-blockether`).

### Endpoints

- `POST /api/workspaces/[id]/github/sync` -- Trigger manual sync for one workspace. Runs `gh issue list --repo owner/repo --json ... --limit 200 --state all`, upserts into `github_issues` table, broadcasts `github_issues_synced` SSE event. Returns `{ synced_count, workspace_id }`.
- `GET /api/workspaces/[id]/github/issues?state=open|closed|all` -- Return cached issues from DB. Left-joins `tasks` to expose `task_id` per issue.
- `GET /api/cron/github-sync` -- Sync all workspaces with a configured `github_repo`. Requires Bearer token auth. Returns `{ synced_workspaces, total_issues, errors? }`.

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

When `STYRMAN_API_TOKEN` is set in `.env.local`:
- Same-origin browser requests bypass auth.
- All non-browser API access requires Bearer auth (no localhost bypass).
- Scoped per-task tokens (`mcst.<payload>.<sig>`) are supported and enforced at middleware level:
  - task-scoped read/write (`task:{id}:read`, `task:{id}:write`)
  - optional task list/create (`tasks:read`, `tasks:create`)
  - OpenClaw session endpoints are scoped by `session_id` in the token payload (`/api/openclaw/sessions/{id}` and `/api/openclaw/sessions/{id}/history`) and additionally require task scope (`task:{id}:read`/`task:{id}:write`)
- Scoped token signing/verification uses `STYRMAN_API_TOKEN`.
- Bearer parsing is normalized (trims whitespace, handles duplicated `Bearer`, strips quote wrappers) before scoped verification.
- Invalid scoped token => `401 invalid_token`; missing scope => `403 insufficient_scope` with loopback guidance to `/api/tasks/{id}/fail`.
- SSE streams accept token as query parameter.
- Implemented in `middleware.ts` + `src/proxy.ts`.

Webhook verification: `STYRMAN_WEBHOOK_SECRET` env var, HMAC signature in `x-webhook-signature` header.

---

## Agent Protocol

**Dispatch**: Task dispatched to agent via OpenClaw `chat.send` RPC. Includes task ID, description, output directory, callback endpoints. Role-specific instructions (builder: "when done, update to testing"; tester: "pass -> review, fail -> POST /fail").

**Pipeline storage rule**: Agent output path is workspace-repo anchored under task artifacts:
- `<workspace-repo>/task-artifacts/<task-id>`
- Legacy reads still support prior `.mission-control/tasks/<task-id>` paths.

**Dispatch-generated task brief artifact**:
- Before agent execution, dispatch writes `<output-directory>/task-problem-statement.md`.
- The file is auto-registered as a `task_deliverables` file artifact (deduped by path), so each task has a canonical problem statement artifact from the start.
- The generated task brief includes acceptance criteria and orchestrator planning context (when present).
- The orchestrator section renders a Mermaid workflow diagram / participant plan instead of raw planning JSON where structured plan data is available.

**Git repo handling**: repo validation uses git worktree detection (`git rev-parse --is-inside-work-tree`), not `.git` directory checks, so linked worktrees are supported.

**Session trace persistence**:
- Every dispatch writes a `task_activities` record with `activity_type='dispatch_invocation'` and metadata including:
  - `openclaw_session_id`
  - `session_key`
  - `trace_url`
  - `output_directory`
  - `invocation` (full dispatched prompt)
- Per-session trace endpoint: `GET /api/tasks/{id}/sessions/{sessionId}/trace` returns dispatch invocation + normalized OpenClaw chat history.
- Trace fetch auto-captures deliverables from write-style tool calls (for example `write`, `functions.write`, `write_file`) and inserts deduped `task_deliverables` rows by task/session/path.
- Auto-captured deliverables include stage/agent-aware descriptions derived from the dispatch session metadata.
- Workspace Activity and Task Activity surfaces include links to session traces when available.

**Task deletion cleanup**:
- Task delete attempts OpenClaw gateway session termination using `sessions.delete` with `key` (session key preferred, then session id fallback).
- Task delete removes `task-artifacts/{taskId}` and legacy `.mission-control/tasks/{taskId}`, plus derived `.mission-control/worktrees/*` task paths resolved from dispatch metadata and deterministic path builders.
- DB cleanup is schema-aware (`PRAGMA table_info`) and nullifies/removes related rows safely across environments with slight schema drift.

**Auto-Train dispatch specialization**:
- For `task_type='autotrain'`, dispatch prompt switches to a continuous loop contract: inspect -> propose -> implement -> verify -> report.
- Dispatch includes active ACP binding context for the workspace when present (`acp_session_key`, `acp_agent_id`, `discord_thread_id`, provenance mode `meta+receipt`).
- Iteration summaries from recent activities are injected into the next loop dispatch.

**ACP Provenance Integration**:
- OpenClaw `--provenance meta+receipt` mode attaches `InputProvenance` metadata and `[Source Receipt]` text blocks to messages sent via ACP bridge.
- Provenance kinds: `external_user` (ACP bridge), `inter_session` (ACPX runtime), `internal_system`.
- Trace API (`GET /api/tasks/{id}/sessions/{sessionId}/trace`) parses provenance from session history messages and stores records in `task_provenance` table.
- Provenance API: `GET /api/tasks/{id}/provenance` returns all stored provenance records for a task.
- TraceViewerModal displays provenance chain badges and Source Receipt details.
- TraceViewerModal stage-flow uses a centered vertical sequence with down-arrow connectors.
- Trace summary `stage_flow` extraction is strict (requires `stage`/`phase`/`step` tokens); summary highlights are not displayed in the trace modal.
- Trace normalization now filters placeholder assistant rows with no text/tool content and understands top-level OpenAI-style `tool_calls` in addition to block-based tool calls.
- Markdown/text preview wraps prose for mobile while markdown tables are wrapped in horizontal scroll containers.
- Markdown preview also renders Mermaid code blocks as diagrams via client-side Mermaid initialization.

**Session finalization**:
- Successful stage PATCH transitions can include `updated_by_session_id`; Styrmann finalizes that OpenClaw session immediately instead of letting it decay into `stale`.
- Stage failure endpoint accepts `openclaw_session_id` and marks that session `interrupted` before fail-loopback.
- Workflow handoff finalizes other active task sessions as `interrupted` before dispatching the next agent.
- Agent completion webhook finalizes the bound session as `completed` and no longer assumes only `assigned` / `in_progress` tasks are completable.
- Agent log ingestion bumps `openclaw_sessions.updated_at`, so real transcript activity keeps live sessions from being mislabeled stale.

**PI / ACP runtime contract**:
- Styrmann's normal thread-bound execution path uses the OpenClaw ACP session runtime.
- Dispatch prompts explicitly tell agents to use the Pi-style coding workflow inside that ACP session, while using Styrmann REST APIs for task/activity/deliverable updates.
- Plain `pi` CLI is treated as a non-ACP fallback path rather than the primary Styrmann execution model.
- SessionsList shows a provenance summary banner when records exist.

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

## File Operations (Remote Agents)

Agents without direct filesystem access use upload/download endpoints:

- `POST /api/files/upload` -- `{ relativePath, content, encoding }` -> saves to `$STYRMAN_PROJECTS_PATH/{relativePath}`
- `GET /api/files/download?relativePath=...` -- Returns file content (JSON or raw with `&raw=true`)
- `POST /api/files/reveal` -- Opens file in system file manager

---

## Key Design Decisions

1. **SSE over WebSocket**: Simpler, works with Next.js App Router natively, sufficient for server-to-client updates.
2. **SQLite over Postgres**: Single-file DB, zero config, WAL mode for concurrent reads. Sufficient for single-server deployment.
3. **Single-page dashboard**: All views render in same page via state switching. No route navigations between views -- prevents layout jumps. Workspace-level dashboard views are now `sprint`, `backlog`, `pareto`, and `issues`; removed views like `activity` and `knowledge` fall back to the main panel.
4. **Milestone-first hierarchy**: Tasks belong to milestones; milestones belong to sprints. The hierarchy is `Workspace -> Sprint -> Milestone -> Task`. Tasks do not have a direct sprint relationship. Backlog is defined as `milestone_id IS NULL`.
5. **Agent sync from gateway config**: Agents defined in OpenClaw config files, auto-synced on startup. Prompts stored in files (not DB). Synced agents appear in all workspaces.
6. **Migrations auto-run on DB connection**: Schema creation only for fresh databases. `legacy_alter_table = ON` during migrations to prevent FK rewriting bug.
7. **Component traceability**: Every React component's root DOM element has `data-component="src/path/to/File"` (relative path, no extension). Paste rendered HTML and immediately identify which source file to edit.
8. **LiveFeed is workspace-scoped**: Events API filters by `workspace_id` via task or agent ownership. System events (no task/agent) appear in all workspaces. AgentActivityDashboard is the global cross-workspace activity view.
9. **Single global orchestrator**: Only one agent with `role = 'orchestrator'` is allowed globally. Enforced at the API level (409 on duplicate). Orchestrators cannot be demoted via PATCH (400) -- delete and recreate to change. Orchestrators are excluded from workflow stage auto-assignment. The orchestrator is auto-resolved in all subsystems (milestones, workflow plans, dispatch, recovery) -- no manual selection is exposed or required.
10. **Story points computed, not stored**: `story_points` on a milestone is computed at read time via `SUM(task.effort)`. It is never persisted in the database.
11. **Milestone dependencies are informational in v1**: The `milestone_dependencies` table exists and is queryable, but no blocking behavior is enforced. Dependencies are for planning visibility only.

12. **Repo-driven workspaces**: Standard repositories auto-discover from git repos at `/root/repos/{org}/{repo}`. On DB init, `discoverRepoWorkspaces()` scans for org directories containing git repos and creates/syncs a workspace per repo. Slug format: `{org}-{repo}` (e.g., `blockether-mission-control`). Styrmann is treated like any other discovered repository. The `default` workspace is reserved for the internal OpenClaw meta repository rooted at `/root/.openclaw`. Repositories are grouped by organization in the UI, with the meta repository under `System`.
13. **Workflow templates in code, not DB-cloned**: Template definitions (Simple, Standard, Strict, Auto-Train, Architecture) live in `src/lib/workflow-templates.ts` as TypeScript constants. New workspaces get templates provisioned from code, not cloned from another workspace's DB rows.
14. **LLM-powered skill selection**: Workflow planning uses LLM inference to intelligently select the most relevant skills per agent per task step, rather than assigning all available skills. Falls back to rule-based selection when LLM is unavailable.
15. **Standardized file upload UX**: Active file input areas across the UI use a consistent drag-and-drop zone pattern with Upload icon, dashed border, and "Drop file or click to browse" text.
16. **Vitest test framework**: Tests use `pool: 'forks'` for better-sqlite3 native module support. Test helper `createTestDb()` creates in-memory SQLite databases with full schema + migrations applied. Test files are colocated at `src/**/*.test.ts`.
17. **Stabilization wave**: Legacy tables removed (businesses, memory_pipeline_config, planning_questions, planning_specs, conversations, conversation_participants, messages). Legacy task columns removed (business_id, planning_*). Clean schema foundation for org/knowledge platform migration.
18. **Organization-first hierarchy**: The full hierarchy is `Organization -> Workspace -> Sprint -> Milestone -> Task`. Organizations are auto-created from repo directory structure. `workspaces.organization_id` links workspaces to their parent org. The homepage groups workspaces by organization.
19. **Task creation lockdown via org tickets**: Org tickets are the intended entry point for all new work. `POST /api/org-tickets/[id]/delegate` is the authorized path that creates workspace tasks via LLM-powered decomposition. The delegation module enforces ticket status transitions and creates `delegates_to` entity links atomically. Direct task creation remains available but is treated as an internal/admin path.
20. **Memory system without vectors**: The knowledge store uses SQLite FTS5 (porter tokenizer) for full-text search rather than vector embeddings. This keeps the system self-contained with no external vector DB dependency. Eight memory types cover the full range of development knowledge: fact, decision, event, tool_run, error, observation, note, patch. LLM synthesis converts raw memories into curated knowledge articles on a scheduled basis.
21. **Outbound webhook system for external integration**: Styrmann pushes events to external dev portals via registered webhooks. HMAC-SHA256 signing ensures payload authenticity. Exponential backoff (3 attempts: 1s, 5s, 30s) handles transient failures. Webhooks with 10+ consecutive failures are auto-disabled to prevent noise. Delivery history is tracked in `webhook_deliveries` for debugging.
---

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENCLAW_GATEWAY_URL` | Yes | `ws://127.0.0.1:18789` | WebSocket URL to OpenClaw Gateway |
| `OPENCLAW_GATEWAY_TOKEN` | Yes | -- | Auth token for OpenClaw |
| `STYRMAN_API_TOKEN` | No | -- | API auth token (enables Bearer auth) |
| `STYRMAN_WEBHOOK_SECRET` | No | -- | HMAC secret for webhook verification |
| `STYRMAN_DATABASE_PATH` | No | `./styrman.db` | SQLite database path |
| `STYRMAN_PROJECTS_PATH` | No | `/root/repos` | Repos base directory — scanned for `{org}/{repo}` git repos, auto-discovered as workspaces |
| `STYRMAN_URL` | No | auto-detected | API URL for agent callbacks |

---

## npm Scripts

```
npm run dev          # Start dev server on port 4000
npm run build        # Production build (next build)
npm run start        # Production server on port 4000
npm run lint         # ESLint
npm run test         # Run vitest test suite
npm run test:watch   # Run vitest in watch mode
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

The Next.js server handles HTTP request/response cycles but has no built-in mechanism for background loops — polling for assigned tasks, monitoring agent health, or running scheduled jobs. A separate daemon process (`tsx src/daemon/index.ts`) fills this gap. It communicates with Styrmann exclusively via HTTP API (never imports Next.js internals or accesses the DB directly), making it safe to run, restart, or kill independently.

### Architecture

The daemon is a standalone Node.js process with nine modules:

| Module | Interval | Purpose |
|--------|----------|---------|
| **heartbeat** | 30s | Polls `/api/agents` and active subagent sessions; stale working agents are set to standby after 60m inactivity with no active subagent session |
| **dispatcher** | 10s | Polls `/api/tasks?status=assigned`, auto-dispatches each via `POST /api/tasks/{id}/dispatch` |
| **scheduler** | 10s | Runs registered `ScheduledJob` entries on interval. Job registry starts empty — no hardcoded jobs |
| **recovery** | 60s | Polls recoverable statuses (`assigned`, `in_progress`, `testing`, `verification`, `review`), detects stale work (20m threshold), marks stale active sessions as `interrupted`, then attempts continuation by re-dispatching to the assignee; on conflict or offline assignee, reassigns to the default orchestrator |
| **autotrain** | 30s | Polls completed `autotrain` tasks and reopens them for the next repo-improvement iteration until stop/max-iteration conditions are hit |
| **health** | 60s | Pings MC to verify API is reachable, logs connection changes |
| **router** | SSE stream | Subscribes to `/api/events/stream`, routes events (e.g., logs task assignments for dispatcher awareness) |
| **logs** | 30s | Polls OpenClaw session histories via `/api/openclaw/sessions/{id}/history`, stores new entries in `agent_logs` table via `/api/logs/ingest`, broadcasts `agent_log_added` SSE events, auto-cleans entries older than 30 days. **Auth failure detection**: scans new log entries for provider/auth error patterns (401/403, API key missing, rate limits, provider timeouts, model unavailable); when detected, posts a `[Provider Alert]` task activity with actionable diagnostics. Uses 10-minute cooldown per session to avoid spam. |
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

Env vars: `STYRMAN_URL` (default `https://control.blockether.com`), `STYRMAN_API_TOKEN` (required).

### Database Tables

| Table | Purpose |
|-------|---------|
| `agent_heartbeats` | Records agent status snapshots over time (agent_id, status, metadata, created_at) |
| `scheduled_job_runs` | Records job execution history (job_id, status, started_at, finished_at, result, error, optional task_id) |
| `agent_logs` | OpenClaw session transcripts — role (user/assistant/system), content, content_hash (dedup), linked to agent and workspace |
### Shared Dispatch (`src/lib/dispatch.ts`)

The dispatch logic (task message building, OpenClaw session management, workflow stage awareness, and resource injection) was extracted from the API route into a shared module `dispatchTaskToAgent(taskId)`. Both the API route (`POST /api/tasks/{id}/dispatch`) and the daemon's dispatcher call the same function. Returns a `DispatchResult` with success/error status and updated task/agent payloads.

The dispatch module includes a **concurrent session guard**: before creating a new OpenClaw session for a task, it interrupts any existing active sessions on that task via `finalizeOtherActiveSessionsForTask()`. This prevents the dual-session bug where two agents run simultaneously on the same task. Interrupted sessions are logged as task activities.

### Broadcast Endpoint

`POST /api/events/broadcast` — accepts `{type, payload}` and broadcasts to all connected SSE clients. Protected by the existing middleware auth (`STYRMAN_API_TOKEN`). Used by the daemon to push real-time updates from a separate process that can't access the in-memory SSE client set directly.

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
- **Config Validation** -- "Run Validation" button that POSTs to `/api/system/validate` and displays pass/fail/warn results for each check (env file, env vars, database, web service, daemon service, HTTP endpoint, Himalaya CLI, gateway connection, agents, models, config, sessions, nodes, **agent credentials**). The **Agent Credentials** check reads each agent's `auth-profiles.json` from their `agent_dir`, compares provider coverage against the main agent, and flags auth error stats (high error counts, cooldown states).

The **OpenClaw Control Plane** section shows 4 cards:
- **Gateway Status** — Connection status (connected/disconnected), masked gateway URL (tokens replaced with `***`), active session count.
- **Agent Occupation** — Working/standby/offline counts with stacked bar visualization, redesigned agent list with status-based visual treatment (green left-border for working, neutral for standby, muted for offline), role badges, model info, task counts, and current task titles. Per-agent cards show description previews and current task context for working agents.
- **Available Models** — Model list from gateway with default model badge, source indicator (remote/local/fallback).
- **Security Audit and Live Logs** — On-demand audit / auto-fix actions plus the live global OpenClaw session transcript viewer.

Both sections auto-refresh every 30 seconds. Validation only runs on button click.

### Daemon Stats Reporter

New daemon module (`src/daemon/reporter.ts`): pushes the daemon's in-memory `DaemonStats` object to MC via `POST /api/daemon/stats` every 30 seconds. MC stores the latest snapshot in a `globalThis` variable (in-memory, lost on MC restart but daemon re-pushes within one interval). Payload includes all DaemonStats counters, process memory, PID, module intervals with last-tick timestamps, and registered scheduled jobs.

The scheduler now exports `getRegisteredJobs()` for the reporter to include job metadata in its stats push.

### Discord Integration

Discord integration runs as a daemon module (`src/daemon/discord.ts`). Conditional on `DISCORD_BOT_TOKEN` env var — if absent, the module is a no-op.

**Architecture**: Discord.js v14 client runs inside the daemon process alongside other modules (heartbeat, dispatcher, etc.). Communicates with Styrmann via `mcFetch()` HTTP calls to API endpoints.

**Message flow**: Discord message received -> check for pending clarification (state machine) -> `POST /api/discord/classify` (LLM classification via `src/lib/discord-classifier.ts`) -> if task: `POST /api/tasks` creates the task, creates a Discord thread via `Message.startThread()`, stores record in `discord_messages` table with provenance -> if conversation: `POST /api/discord/respond` generates AI reply -> if clarification: stores context in `discord_clarification_contexts` table, asks follow-up question, waits for user's next message in that channel.

**Thread support**: When a task is created from a Discord message, the bot creates a thread from that message (named `Task: {title}`). Completion notifications are sent to the thread when available, falling back to the original channel. Thread IDs are stored in `discord_messages.discord_thread_id` (migration 052).

**Clarification state machine**: When a message is classified as `clarification`, the bot stores context in `discord_clarification_contexts` (migration 052) and holds in-memory state keyed by `channel:author`. When the same user sends a follow-up in the same channel within 10 minutes, the bot combines both messages and re-classifies. If still unclear, it can ask again. Contexts expire after 10 minutes. Stale pending contexts are cleaned up on next message from that user.

**Completion notifications**: The discord module polls `GET /api/discord/completions` every 30 seconds to find tasks that originated from Discord and reached `done` status. Sends notification to the originating thread (preferred) or channel (fallback) and marks as notified via `POST /api/discord/completions/ack`.

**Provenance**: When a task is created from Discord, the `POST /api/discord/messages` endpoint inserts a `task_provenance` record with `kind='external_user'`, `source_channel='discord'`, `source_tool='discord-bot'`, and receipt data containing the Discord message/channel/author metadata. This makes Discord-originated tasks traceable in the task provenance view.

**Classification**: Uses `llmJsonInfer()` with system prompt to classify messages as task/conversation/clarification. When LLM is unavailable, falls back to rule-based keyword matching. Classification extracts task title, description, type, and priority when applicable.

**Database**: `discord_messages` table (migration 051) stores message metadata, classification result, linked task_id, thread_id, and notification tracking flags. `discord_clarification_contexts` table (migration 052) tracks pending clarification conversations with status (`pending`/`resolved`/`expired`).

**Reporter stats**: The daemon reporter includes Discord-specific counters in the stats payload: `discord_connected`, `discord_messages_processed`, `discord_tasks_created`, `discord_completions_sent`, `discord_voice_responses`. When connected, a `discord` module entry appears in the modules list.

**UI**: `DiscordMessagesView` component (`src/components/DiscordMessagesView.tsx`) shows Discord message history with classification icons, author badges, task linkage, and thread indicators. Accessible via the `?view=discord` URL param or the sidebar Discord nav item. Filterable by classification type (all/task/conversation/clarification).

**Channel filtering**: `DISCORD_CHANNEL_IDS` env var (comma-separated) limits which channels the bot monitors. If not set, bot only responds to @mentions.

**Voice** (optional): `src/daemon/discord-voice.ts` — enabled only when both `OPENAI_API_KEY` (Whisper ASR) and `ELEVENLABS_API_KEY` (TTS) are set. Captures audio from Discord voice channels, transcribes via Whisper, classifies and processes the transcription, then responds with ElevenLabs-synthesized speech.

**API endpoints**:
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/discord/classify` | POST | Classify a message as task/conversation/clarification |
| `/api/discord/respond` | POST | Generate conversational AI response |
| `/api/discord/messages` | GET | List Discord messages with optional workspace/classification filter |
| `/api/discord/messages` | POST | Store Discord message record with classification and provenance |
| `/api/discord/completions` | GET | Find tasks from Discord that completed but not yet notified |
| `/api/discord/completions/ack` | POST | Mark completion notifications as sent |
| `/api/discord/clarifications` | POST | Store clarification context for state machine |
| `/api/discord/clarifications/[id]/resolve` | POST | Resolve a pending clarification context |
| `/api/workspaces/[id]/discord/messages` | GET | List Discord messages scoped to a workspace |

**Env vars** (set in daemon environment):
| Variable | Required | Purpose |
|----------|----------|---------|
| `DISCORD_BOT_TOKEN` | Yes (to enable) | Discord bot authentication |
| `DISCORD_CHANNEL_IDS` | No | Comma-separated channel IDs to monitor |
| `DISCORD_WORKSPACE_ID` | No | Workspace for created tasks (default: "default") |
| `OPENAI_API_KEY` | For voice | Whisper ASR |
| `OPENAI_BASE_URL` | No | Custom OpenAI-compatible endpoint |
| `ELEVENLABS_API_KEY` | For voice | ElevenLabs TTS |
| `ELEVENLABS_VOICE_ID` | No | ElevenLabs voice (default: Sarah) |
