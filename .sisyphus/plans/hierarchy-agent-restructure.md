# Hierarchy & Agent System Restructure

## TL;DR

> **Quick Summary**: Restructure Mission Control from flat independent entities (sprints, milestones, tasks as peers) to a strict hierarchy (Sprint -> Milestone -> Task), replace the `is_master` boolean with a proper single-per-workspace Orchestrator/PO role, remove the subtask concept, add milestone priority + dependencies, and update the UI to be milestone-centric.
> 
> **Deliverables**:
> - Migration 020 with full schema changes (new columns, tables, data migration, cleanup)
> - Updated types, validation, and all API routes
> - Workflow engine with "Human Verifier" stage rename
> - PO/Orchestrator agent with single-per-workspace enforcement
> - Milestone-first ActiveSprint UI
> - Updated KNOWLEDGE.md reflecting all changes
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: Migration -> Types/Validation -> API Routes -> UI Components -> Deploy

---

## Context

### Original Request
Restructure the data model and agent system to match a new organizational vision:
- Workspace = project/place, bag for sprints + agents + tasks
- Sprint = bag for milestones (time-boxed iteration)
- Milestone = business goal with priority and dependencies, bag for tasks
- Task = unit of work (flat, no subtasks)
- Single Orchestrator/PO per workspace who delegates work
- Rename "Review" queue to "Human Verifier"

### Interview Summary
**Key Discussions**:
- Full schema analysis revealed sprints and milestones are currently independent peers at workspace level
- Milestones lack priority, dependencies, and effort aggregation
- `parent_task_id` exists in 7 files, 19 occurrences — must be fully removed
- `is_master` is a boolean flag used in 16 files, 35 occurrences — must be replaced with role-based PO concept
- Agent `role` field is freeform text — no enum constraint
- Workflow engine has 3 templates (Simple, Standard, Strict) with role-based fuzzy matching

**Research Findings**:
- **Existing bug found**: Milestones API route writes `sprint_id` but the milestones table has no such column (would crash on fresh DBs). Must fix as part of this work.
- **Ghost column**: Migrated DBs have `milestone_id` on sprints (from migration 018) but fresh DBs don't. Schema inconsistency needs cleanup.
- **Authorization gate**: `tasks/[id]/route.ts:73-84` requires `is_master` agents to move tasks from review->done. This security check must survive the refactoring.
- **Milestone auto-close**: When last task in milestone reaches 'done', milestone auto-closes (`tasks/[id]/route.ts:378-404`). Logic preserved.
- **Learner special handling**: `workflow-engine.ts:300-310` adds learner to task_roles even though no workflow stage maps to it.

### Metis Review
**Identified Gaps** (all addressed):
- Planning routes (`planning/route.ts`, `planning/poll/route.ts`) use `is_master = 1` for session dispatch — must update to role-based
- `SHARED_AGENTS_MD` in bootstrap contains hardcoded "Review is a queue" text — must update
- Sprint completion logic currently nulls `sprint_id` on tasks — behavior changes since tasks no longer have sprint_id
- Queue drain (`drainQueue()`) is workspace-scoped — keeping current behavior (not milestone-scoped)
- `task_blockers` table exists independently of milestone dependencies — both coexist

---

## Work Objectives

### Core Objective
Transform Mission Control from a flat entity model to a strict Sprint -> Milestone -> Task hierarchy, with a single Orchestrator/PO agent per workspace and milestone-centric UI presentation.

### Concrete Deliverables
- Database migration 020 (schema changes for existing DBs)
- Updated `schema.ts` (schema for fresh DBs)
- Updated TypeScript types and Zod validation
- Rewritten milestones, tasks, agents API routes
- New milestone dependencies API endpoint
- Updated workflow engine with "Human Verifier" stage label
- Updated agent bootstrap with Orchestrator agent
- Milestone-first ActiveSprint and Kanban views
- PO-distinct AgentsSidebar
- Updated task creation/edit forms
- Updated KNOWLEDGE.md and CHANGELOG.md

### Definition of Done
- [x] `npm run build` passes clean
- [x] `npx tsc --noEmit` passes clean
- [x] `scripts/check.sh` passes (lint + validate + build)
- [x] `scripts/deploy.sh` succeeds with 200 response
- [x] All `is_master` references removed from codebase
- [x] All `parent_task_id` references removed from codebase
- [x] Milestone dependencies table exists and API works
- [x] Only one orchestrator agent can exist per workspace
- [x] Workflow templates show "Human Verifier" label (not "Review")

### Must Have
- Sprint -> Milestone -> Task hierarchy enforced in schema
- `milestone.sprint_id` FK to sprints table
- `milestone.priority` field (low/normal/high/urgent)
- `milestone_dependencies` table with milestone-to-milestone and milestone-to-task dependencies
- Computed story points (SUM of task.effort per milestone) in API responses
- Removal of `task.parent_task_id` and all subtask logic
- Removal of `task.sprint_id` (sprint derived via milestone)
- Removal of `is_master` column, replaced by `role = 'orchestrator'` with single-per-workspace constraint
- Orchestrator agent in bootstrap defaults
- "Human Verifier" label on the queue stage (review status, role=null) in all workflow templates
- Authorization gate preserved: only orchestrator can move tasks review->done
- Milestone-first grouping in ActiveSprint view
- PO visual distinction in AgentsSidebar

### Must NOT Have (Guardrails)
- **No AI delegation logic**: PO is a role label + constraint only, not an intelligent dispatcher
- **No enforced dependency blocking**: Milestone dependencies are informational in v1 (shown in UI, not blocking dispatch)
- **No stored story points**: Always computed at read-time via SUM query, never cached on milestone
- **No new views**: No standalone milestone detail panel, milestone burndown, or dependency graph view
- **No Learner changes**: Learner agent and knowledge_entries table kept as-is
- **No queue drain scope change**: drainQueue() stays workspace-scoped, not milestone-scoped
- **No task status value changes**: `review` stays as a status value. Only the workflow template label changes to "Human Verifier"
- **No workflow template editor**: Rename labels in existing templates only, no new templates or template editing UI
- **No breaking API shape changes**: Keep existing response field names where possible; add new fields, don't rename existing ones
- **No placeholder/stub code**: Every endpoint must be functional and verified
- **No console.log in production**: Use console.warn/error for diagnostics only

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** -- ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO (no test framework in project)
- **Automated tests**: None (project uses build + type check + deploy as verification)
- **Framework**: N/A
- **Primary verification**: `scripts/check.sh` (lint + validate + build), `scripts/deploy.sh`, curl API tests

### QA Policy
Every task MUST include agent-executed QA scenarios using Bash (curl for API, sqlite3 for schema).
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Schema changes**: Use `sqlite3` to verify table structure, column existence, constraint behavior
- **API changes**: Use `curl` to hit endpoints, verify response shape and status codes
- **Build verification**: Use `npx tsc --noEmit` and `npm run build`
- **Deploy verification**: Use `scripts/deploy.sh` and verify HTTPS response

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation -- schema + types, MAX PARALLEL):
|-- Task 1: Migration 020 (all schema changes) [deep]
|-- Task 2: Update schema.ts (fresh DB schema) [quick]
|-- Task 3: Update types.ts (TypeScript interfaces) [quick]
|-- Task 4: Update validation.ts (Zod schemas) [quick]

Wave 2 (Backend APIs -- depends on Wave 1, MAX PARALLEL):
|-- Task 5: Milestones API + dependencies endpoint [unspecified-high]
|-- Task 6: Tasks API rewrite (sprint_id/parent removal) [unspecified-high]
|-- Task 7: Agents API + PO enforcement [unspecified-high]
|-- Task 8: Workflow engine + bootstrap agents [deep]
|-- Task 9: Planning/dispatch/other is_master routes [unspecified-high]

Wave 3 (UI Components -- depends on Wave 2, MAX PARALLEL):
|-- Task 10: ActiveSprint milestone-first view [visual-engineering]
|-- Task 11: Kanban board milestone grouping [visual-engineering]
|-- Task 12: AgentsSidebar PO distinction [visual-engineering]
|-- Task 13: Task forms + BacklogView updates [visual-engineering]

Wave 4 (Documentation + Verification -- depends on Wave 3):
|-- Task 14: KNOWLEDGE.md + CHANGELOG.md update [writing]
|-- Task 15: Full build + deploy verification [quick]

Wave FINAL (Independent review -- depends on ALL):
|-- Task F1: Plan compliance audit [oracle]
|-- Task F2: Code quality review [unspecified-high]
|-- Task F3: Real QA [unspecified-high]
|-- Task F4: Scope fidelity check [deep]

Critical Path: Task 1 -> Task 5/6 -> Task 10 -> Task 15 -> F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 5 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | -- | 5, 6, 7, 8, 9 | 1 |
| 2 | -- | 5, 6, 7, 8, 9 | 1 |
| 3 | -- | 5, 6, 7, 8, 9 | 1 |
| 4 | -- | 5, 6, 7, 8, 9 | 1 |
| 5 | 1, 2, 3, 4 | 10, 13 | 2 |
| 6 | 1, 2, 3, 4 | 10, 11, 13 | 2 |
| 7 | 1, 2, 3, 4 | 12 | 2 |
| 8 | 1, 2, 3, 4 | 10, 11 | 2 |
| 9 | 1, 2, 3, 4 | -- | 2 |
| 10 | 5, 6, 8 | 14, 15 | 3 |
| 11 | 6, 8 | 14, 15 | 3 |
| 12 | 7 | 14, 15 | 3 |
| 13 | 5, 6 | 14, 15 | 3 |
| 14 | 10, 11, 12, 13 | 15 | 4 |
| 15 | 14 | F1-F4 | 4 |

### Agent Dispatch Summary

- **Wave 1**: **4** -- T1 `deep`, T2-T4 `quick`
- **Wave 2**: **5** -- T5-T7,T9 `unspecified-high`, T8 `deep`
- **Wave 3**: **4** -- T10-T13 `visual-engineering`
- **Wave 4**: **2** -- T14 `writing`, T15 `quick`
- **FINAL**: **4** -- F1 `oracle`, F2-F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. **Database Migration 020 -- Full Schema Restructure**
  **What to do**: Create migration `020` in `src/lib/db/migrations.ts` following the exact pattern of migrations 018/019 (id string, name string, up function receiving `db: Database.Database`). The migration must:
  1. Add `sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL` to milestones (if not exists).
  2. Add `priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'))` to milestones (if not exists).
  3. Create `milestone_dependencies` table: `id TEXT PRIMARY KEY`, `milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE`, `depends_on_milestone_id TEXT REFERENCES milestones(id) ON DELETE CASCADE`, `depends_on_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE`, `dependency_type TEXT NOT NULL DEFAULT 'finish_to_start' CHECK (dependency_type IN ('finish_to_start','blocks'))`, `created_at TEXT DEFAULT (datetime('now'))`, `CHECK (depends_on_milestone_id IS NOT NULL OR depends_on_task_id IS NOT NULL)`.
  4. Rebuild the `tasks` table WITHOUT `sprint_id` and `parent_task_id` columns using the create-copy-drop-rename pattern (SQLite does not support DROP COLUMN). Copy all other columns. Preserve all existing data.
  5. Rebuild the `agents` table WITHOUT `is_master` column using the same pattern. Data migration: `UPDATE agents_new SET role = 'orchestrator' WHERE id IN (SELECT id FROM agents WHERE is_master = 1)`.
  6. Clean up ghost `milestone_id` column on sprints table if it exists (from migration 018 -- only on migrated DBs, not fresh). Use `PRAGMA table_info(sprints)` check before attempting.
  7. Drop indexes `idx_tasks_parent` and `idx_tasks_sprint` (IF EXISTS).
  8. Create new indexes: `idx_milestones_sprint ON milestones(sprint_id)`, `idx_milestone_deps_milestone ON milestone_dependencies(milestone_id)`, `idx_milestone_deps_depends ON milestone_dependencies(depends_on_milestone_id)`.
  9. Update stored workflow template data: `UPDATE workflow_templates SET stages = REPLACE(stages, '"label":"Review"', '"label":"Human Verifier"') WHERE stages LIKE '%"label":"Review"%'`. Also handle `'label': 'Review'` variant if present.
  Use `db.pragma('foreign_keys = OFF')` and `db.pragma('legacy_alter_table = ON')` before table rebuilds (already handled by the migration runner, but be aware). Wrap all steps in the `up` function body -- the runner handles the transaction.

  **Must NOT do**:
  - Do not change task status enum values (`review` stays as a status value).
  - Do not drop `knowledge_entries` table or any other unrelated table.
  - Do not change `drainQueue` logic.
  - Do not delete existing task, agent, or milestone data.
  - Do not add migration to the `migrations` array more than once.

  **Recommended Agent Profile**:
  - Category: `deep`
  - Skills: SQLite schema manipulation, create-copy-drop-rename pattern, TypeScript, better-sqlite3 API
  - Skills Evaluated but Omitted: ORM usage (project uses raw SQL), automated test framework (none in project)

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 1 -- no dependencies)
  - Parallel Group: Wave 1
  - Blocks: Tasks 5, 6, 7, 8, 9
  - Blocked By: none

  **References**:
  - `src/lib/db/migrations.ts` lines 825-843: Migration 019 pattern -- exact structure to follow (id, name, up function, PRAGMA table_info guard, db.exec calls)
  - `src/lib/db/migrations.ts` lines 706-724: Migration 018 sprints table creation -- shows the ghost `milestone_id` column that needs cleanup
  - `src/lib/db/migrations.ts` lines 789-820: Migration 018 tasks column additions and index creation -- pattern for conditional column adds
  - `src/lib/db/migrations.ts` lines 849-896: `runMigrations()` function -- shows how `foreign_keys = OFF` and `legacy_alter_table = ON` are set by the runner, so the `up` function does NOT need to set them
  - `src/lib/db/schema.ts` lines 29-48: Current agents table with `is_master INTEGER DEFAULT 0` (line 35) -- this column must be removed
  - `src/lib/db/schema.ts` lines 78-105: Current tasks table with `sprint_id` (line 90) and `parent_task_id` (line 92) -- these columns must be removed
  - `src/lib/db/schema.ts` lines 51-61: Current milestones table -- missing `sprint_id` and `priority` columns that must be added
  - `src/lib/db/schema.ts` lines 309-334: Current indexes -- `idx_tasks_sprint` (line 324) and `idx_tasks_parent` (line 326) must be dropped
  - WHY: The migration runner at lines 849-896 handles transactions and pragma toggling. The `up` function only needs to contain the SQL operations. The create-copy-drop-rename pattern is required because SQLite does not support `ALTER TABLE DROP COLUMN` in older versions.

  **Acceptance Criteria**:
  - [x] `sqlite3 mission-control.db "PRAGMA table_info(milestones)"` shows `sprint_id` and `priority` columns
  - [x] `sqlite3 mission-control.db ".tables"` shows `milestone_dependencies`
  - [x] `sqlite3 mission-control.db "PRAGMA table_info(tasks)"` shows NO `sprint_id` or `parent_task_id` columns
  - [x] `sqlite3 mission-control.db "PRAGMA table_info(agents)"` shows NO `is_master` column
  - [x] `sqlite3 mission-control.db "SELECT COUNT(*) FROM tasks"` returns same count as before migration (no data loss)
  - [x] `sqlite3 mission-control.db "SELECT role FROM agents WHERE role='orchestrator'"` returns rows for agents that previously had `is_master=1`
  - [x] `sqlite3 mission-control.db "SELECT stages FROM workflow_templates LIMIT 1"` shows `Human Verifier` not `Review` in label fields
  - [x] Migration 020 appears in `_migrations` table after running

  **QA Scenarios**:
  - Scenario A (Happy Path -- migration runs clean):
    - Tool: Bash (sqlite3)
    - Preconditions: DB exists with at least one agent where `is_master=1`, at least one task, at least one workflow template with `Review` label
    - Steps: 1) Record pre-migration counts: `sqlite3 mission-control.db "SELECT COUNT(*) FROM tasks; SELECT COUNT(*) FROM agents"`. 2) Restart the Next.js server (migrations run on startup). 3) Run `sqlite3 mission-control.db "PRAGMA table_info(tasks)" | grep -c sprint_id` -- expect 0. 4) Run `sqlite3 mission-control.db "PRAGMA table_info(agents)" | grep -c is_master` -- expect 0. 5) Run `sqlite3 mission-control.db "SELECT COUNT(*) FROM tasks"` -- expect same count as step 1.
    - Expected Result: All column checks return 0, row counts match, no errors in server logs
    - Failure Indicators: Server fails to start, row count mismatch, column still present
    - Evidence path: `.sisyphus/evidence/task-1-migration-happy.txt`
  - Scenario B (Error Case -- duplicate migration guard):
    - Tool: Bash (sqlite3)
    - Preconditions: Migration 020 already applied (in `_migrations` table)
    - Steps: 1) Restart server again. 2) Check server logs for `[DB] Running migration 020` -- should NOT appear. 3) Run `sqlite3 mission-control.db "SELECT COUNT(*) FROM _migrations WHERE id='020'"` -- expect 1.
    - Expected Result: Migration skipped, no duplicate execution, server starts normally
    - Failure Indicators: Migration runs twice, data corruption, server crash
    - Evidence path: `.sisyphus/evidence/task-1-migration-idempotent.txt`

  **Evidence to Capture**: `sqlite3` PRAGMA outputs for tasks, agents, milestones, milestone_dependencies tables. Row counts before/after. Server startup logs showing migration 020 applied.

  **Commit**: Part of Wave 1 commit -- `refactor(schema): restructure hierarchy and agent model`

---

- [x] 2. **Update schema.ts -- Fresh Database Schema**
  **What to do**: Update `src/lib/db/schema.ts` to match the migration 020 end-state. This file defines the schema for fresh (new) databases. Changes:
  1. Milestones table (lines 51-61): add `sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL` and `priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'))` columns.
  2. Tasks table (lines 78-105): remove `sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL` (line 90) and `parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE` (line 92).
  3. Agents table (lines 29-48): remove `is_master INTEGER DEFAULT 0` (line 35).
  4. Add `milestone_dependencies` table definition after the milestones table block.
  5. Indexes (lines 309-334): remove `idx_tasks_sprint` (line 324) and `idx_tasks_parent` (line 326). Add `idx_milestones_sprint ON milestones(sprint_id)`, `idx_milestone_deps_milestone ON milestone_dependencies(milestone_id)`, `idx_milestone_deps_depends ON milestone_dependencies(depends_on_milestone_id)`.

  **Must NOT do**:
  - Do not change any other table definitions.
  - Do not remove `idx_tasks_milestone` (line 325) -- that index stays.
  - Do not modify the `knowledge_entries` table.

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: TypeScript, SQL DDL
  - Skills Evaluated but Omitted: migration tooling (not used here)

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 1)
  - Parallel Group: Wave 1
  - Blocks: Tasks 5, 6, 7, 8, 9
  - Blocked By: none

  **References**:
  - `src/lib/db/schema.ts` lines 29-48: Agents table -- `is_master` on line 35 must be removed
  - `src/lib/db/schema.ts` lines 51-61: Milestones table -- `sprint_id` and `priority` columns must be added after line 58 (`coordinator_agent_id`)
  - `src/lib/db/schema.ts` lines 78-105: Tasks table -- lines 90 (`sprint_id`) and 92 (`parent_task_id`) must be removed
  - `src/lib/db/schema.ts` lines 309-334: Indexes block -- lines 324 and 326 must be removed, new milestone indexes added
  - WHY: `schema.ts` is the source of truth for fresh DB creation. It must stay in sync with the migration end-state so new deployments get the correct schema without running migrations.

  **Acceptance Criteria**:
  - [x] `schema.ts` contains `sprint_id` and `priority` in milestones table definition
  - [x] `schema.ts` does NOT contain `is_master` in agents table definition
  - [x] `schema.ts` does NOT contain `sprint_id` or `parent_task_id` in tasks table definition
  - [x] `schema.ts` contains `milestone_dependencies` table definition with CHECK constraint
  - [x] `schema.ts` does NOT contain `idx_tasks_sprint` or `idx_tasks_parent` index definitions
  - [x] `schema.ts` contains `idx_milestones_sprint`, `idx_milestone_deps_milestone`, `idx_milestone_deps_depends`
  - [x] `npx tsc --noEmit` passes clean

  **QA Scenarios**:
  - Scenario A (Happy Path -- fresh DB uses new schema):
    - Tool: Bash (sqlite3 + node)
    - Preconditions: No existing DB file
    - Steps: 1) Delete or rename existing DB. 2) Start server (creates fresh DB from schema). 3) Run `sqlite3 mission-control.db "PRAGMA table_info(agents)" | grep is_master` -- expect empty. 4) Run `sqlite3 mission-control.db ".tables" | grep milestone_dependencies` -- expect match.
    - Expected Result: Fresh DB has correct schema, no `is_master`, has `milestone_dependencies`
    - Failure Indicators: `is_master` column present, `milestone_dependencies` table missing
    - Evidence path: `.sisyphus/evidence/task-2-schema-fresh-db.txt`
  - Scenario B (Error Case -- TypeScript compile check):
    - Tool: Bash
    - Preconditions: schema.ts edited
    - Steps: Run `npx tsc --noEmit 2>&1`
    - Expected Result: Zero errors
    - Failure Indicators: Any TypeScript error output
    - Evidence path: `.sisyphus/evidence/task-2-tsc-clean.txt`

  **Evidence to Capture**: `npx tsc --noEmit` output. PRAGMA table_info outputs from fresh DB.

  **Commit**: Part of Wave 1 commit -- `refactor(schema): restructure hierarchy and agent model`

---

- [x] 3. **Update types.ts -- TypeScript Interfaces**
  **What to do**: Update `src/lib/types.ts` to reflect the new schema. Specific changes:
  1. `Agent` interface (lines 33-54): remove `is_master: boolean` (line 39).
  2. `Milestone` interface (lines 56-67): add `sprint_id?: string`, `priority?: TaskPriority`, `sprint?: Sprint` (joined), `dependencies?: MilestoneDependency[]`, `story_points?: number` (computed at read-time).
  3. `Task` interface (lines 126-160): remove `sprint_id?: string` (line 138), `parent_task_id?: string` (line 140), `sprint?: Sprint` (line 152), `subtasks?: Task[]` (line 154).
  4. `CreateAgentRequest` interface (lines 379-388): remove `is_master?: boolean` (line 383).
  5. `CreateTaskRequest` interface (lines 394-410): remove `sprint_id?: string` (line 404), `parent_task_id?: string` (line 406).
  6. Add new `MilestoneDependency` interface after the `Milestone` interface: `{ id: string; milestone_id: string; depends_on_milestone_id?: string; depends_on_task_id?: string; dependency_type: 'finish_to_start' | 'blocks'; created_at: string; depends_on_milestone?: Milestone; depends_on_task?: Task; }`.
  7. Keep `coordinator_agent_id` on `Milestone` -- it stays.

  **Must NOT do**:
  - Do not change `TaskStatus` type (line 5) -- `review` stays.
  - Do not modify `KnowledgeEntry` interface (lines 275-286).
  - Do not modify `Learner`-related types.
  - Do not rename existing fields that are kept.

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: TypeScript interfaces, type design
  - Skills Evaluated but Omitted: runtime validation (handled in validation.ts)

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 1)
  - Parallel Group: Wave 1
  - Blocks: Tasks 5, 6, 7, 8, 9
  - Blocked By: none

  **References**:
  - `src/lib/types.ts` lines 33-54: `Agent` interface -- `is_master: boolean` on line 39 must be removed
  - `src/lib/types.ts` lines 56-67: `Milestone` interface -- missing `sprint_id`, `priority`, `dependencies`, `story_points` fields
  - `src/lib/types.ts` lines 126-160: `Task` interface -- `sprint_id` (line 138), `parent_task_id` (line 140), `sprint` (line 152), `subtasks` (line 154) must be removed
  - `src/lib/types.ts` lines 379-388: `CreateAgentRequest` -- `is_master?: boolean` (line 383) must be removed
  - `src/lib/types.ts` lines 394-410: `CreateTaskRequest` -- `sprint_id` (line 404) and `parent_task_id` (line 406) must be removed
  - `src/lib/types.ts` line 7: `TaskPriority` type -- reuse for `Milestone.priority` field
  - WHY: TypeScript interfaces are the contract between API routes and UI components. Removing deprecated fields here will surface all remaining usages as compile errors, making cleanup systematic.

  **Acceptance Criteria**:
  - [x] `Agent` interface has no `is_master` field
  - [x] `Milestone` interface has `sprint_id`, `priority`, `dependencies`, `story_points` fields
  - [x] `Task` interface has no `sprint_id`, `parent_task_id`, `sprint`, `subtasks` fields
  - [x] `MilestoneDependency` interface exists with correct shape
  - [x] `CreateAgentRequest` has no `is_master` field
  - [x] `CreateTaskRequest` has no `sprint_id` or `parent_task_id` fields
  - [x] `npx tsc --noEmit` passes (or surfaces only expected downstream errors in other files)

  **QA Scenarios**:
  - Scenario A (Happy Path -- interfaces compile):
    - Tool: Bash
    - Preconditions: types.ts edited
    - Steps: Run `npx tsc --noEmit 2>&1 | head -50`
    - Expected Result: Zero errors in types.ts itself; downstream errors in other files are expected and will be fixed in later tasks
    - Failure Indicators: Syntax errors in types.ts, missing interface members
    - Evidence path: `.sisyphus/evidence/task-3-types-tsc.txt`
  - Scenario B (Error Case -- removed field still referenced):
    - Tool: Bash
    - Preconditions: types.ts edited
    - Steps: Run `grep -rn 'is_master' src/lib/types.ts`
    - Expected Result: Zero matches
    - Failure Indicators: Any match found
    - Evidence path: `.sisyphus/evidence/task-3-types-grep.txt`

  **Evidence to Capture**: `npx tsc --noEmit` output. Grep for removed fields in types.ts.

  **Commit**: Part of Wave 1 commit -- `refactor(schema): restructure hierarchy and agent model`

---

- [x] 4. **Update validation.ts -- Zod Schemas**
  **What to do**: Update `src/lib/validation.ts` to match the new type contracts. Specific changes:
  1. `CreateMilestoneSchema` (lines 84-91): `sprint_id` is already present (line 86) -- verify it stays. Add `priority: z.enum(['low','normal','high','urgent']).optional()` field.
  2. `UpdateMilestoneSchema` (lines 93-99): add `sprint_id: z.string().optional().nullable()` and `priority: z.enum(['low','normal','high','urgent']).optional()` fields.
  3. `CreateTaskSchema` (lines 31-48): remove `sprint_id` (line 43) and `parent_task_id` (line 45) fields.
  4. `UpdateTaskSchema` (lines 50-66): remove `sprint_id` (line 60) and `parent_task_id` (line 62) fields.
  5. Add `CreateAgentSchema` and `UpdateAgentSchema` if they don't exist, or update existing agent schemas to remove `is_master` field. Check if agent schemas exist -- if not, they may be validated inline in the route.
  6. Add `CreateMilestoneDependencySchema`: `z.object({ milestone_id: z.string().uuid(), depends_on_milestone_id: z.string().uuid().optional(), depends_on_task_id: z.string().uuid().optional(), dependency_type: z.enum(['finish_to_start','blocks']).optional() }).refine(data => data.depends_on_milestone_id || data.depends_on_task_id, { message: 'At least one of depends_on_milestone_id or depends_on_task_id is required' })`.

  **Must NOT do**:
  - Do not change `TaskStatus` enum in validation (line 4-14).
  - Do not remove `milestone_id` from task schemas.
  - Do not change sprint schemas.

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: Zod schema design, TypeScript
  - Skills Evaluated but Omitted: runtime testing (verified via build)

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 1)
  - Parallel Group: Wave 1
  - Blocks: Tasks 5, 6, 7, 8, 9
  - Blocked By: none

  **References**:
  - `src/lib/validation.ts` lines 31-48: `CreateTaskSchema` -- `sprint_id` (line 43) and `parent_task_id` (line 45) must be removed
  - `src/lib/validation.ts` lines 50-66: `UpdateTaskSchema` -- `sprint_id` (line 60) and `parent_task_id` (line 62) must be removed
  - `src/lib/validation.ts` lines 84-91: `CreateMilestoneSchema` -- `sprint_id` already present (line 86), add `priority`
  - `src/lib/validation.ts` lines 93-99: `UpdateMilestoneSchema` -- add `sprint_id` and `priority`
  - `src/lib/validation.ts` line 16: `TaskPriority` Zod enum -- reuse the same values for milestone priority
  - WHY: Zod schemas are the runtime validation layer. Removing `sprint_id` and `parent_task_id` from task schemas means the API will reject requests that include those fields, enforcing the new contract at the boundary.

  **Acceptance Criteria**:
  - [x] `CreateTaskSchema` and `UpdateTaskSchema` have no `sprint_id` or `parent_task_id` fields
  - [x] `CreateMilestoneSchema` and `UpdateMilestoneSchema` have `priority` field
  - [x] `CreateMilestoneDependencySchema` exists and exported
  - [x] `npx tsc --noEmit` passes on validation.ts

  **QA Scenarios**:
  - Scenario A (Happy Path -- milestone creation with priority validates):
    - Tool: Bash (curl)
    - Preconditions: Server running with updated validation
    - Steps: `curl -s -X POST http://localhost:4000/api/milestones -H 'Content-Type: application/json' -d '{"workspace_id":"default","name":"Test Milestone","priority":"high"}' | jq '.priority'`
    - Expected Result: `"high"`
    - Failure Indicators: 400 validation error, `priority` field rejected
    - Evidence path: `.sisyphus/evidence/task-4-validation-milestone-priority.txt`
  - Scenario B (Error Case -- task creation with sprint_id rejected):
    - Tool: Bash (curl)
    - Preconditions: Server running with updated validation
    - Steps: `curl -s -X POST http://localhost:4000/api/tasks -H 'Content-Type: application/json' -d '{"title":"Test","workspace_id":"default","sprint_id":"some-id"}' | jq '.error'`
    - Expected Result: Validation error mentioning unrecognized key or the field is silently stripped (Zod strips unknown keys by default -- verify behavior)
    - Failure Indicators: Task created with `sprint_id` field populated
    - Evidence path: `.sisyphus/evidence/task-4-validation-task-sprint-rejected.txt`

  **Evidence to Capture**: `npx tsc --noEmit` output. Curl responses for milestone with priority and task with sprint_id.

  **Commit**: Part of Wave 1 commit -- `refactor(schema): restructure hierarchy and agent model`

---

- [x] 5. **Milestones API + Dependencies Endpoint**
  **What to do**: Update milestone API routes and create the new dependencies endpoint.
  1. `src/app/api/milestones/route.ts` GET (lines 13-63): Add `sprint_id` to SELECT. Add `priority` to SELECT. Add computed `story_points` via subquery: `(SELECT COALESCE(SUM(effort), 0) FROM tasks WHERE milestone_id = m.id) as story_points`. Support `sprint_id` query param filter: if provided, add `AND m.sprint_id = ?` to WHERE clause.
  2. `src/app/api/milestones/route.ts` POST (lines 65-107): The `sprint_id` INSERT is already present (line 86) but the column didn't exist before migration 020 -- this was the existing bug. After migration 020, this now works correctly. Add `priority` to INSERT: read from `data.priority ?? 'normal'`.
  3. `src/app/api/milestones/[id]/route.ts`: Create or update this file. GET should include `story_points` subquery. PATCH should accept `sprint_id` and `priority` updates. DELETE should cascade (FK handles it).
  4. Create `src/app/api/milestones/[id]/dependencies/route.ts`: GET returns all dependencies for a milestone. POST adds a dependency -- validate with `CreateMilestoneDependencySchema`, check for circular dependencies (a milestone cannot depend on itself or on a milestone that already depends on it), insert into `milestone_dependencies`.

  **Must NOT do**:
  - Do not store `story_points` in the DB -- always compute via SUM query.
  - Do not enforce dependency blocking on dispatch -- dependencies are informational only in v1.
  - Do not create a standalone milestone detail view.

  **Recommended Agent Profile**:
  - Category: `unspecified-high`
  - Skills: Next.js App Router API routes, SQLite, TypeScript, Zod validation
  - Skills Evaluated but Omitted: GraphQL (not used), ORM (raw SQL only)

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 2, parallel with Tasks 6, 7, 8, 9)
  - Parallel Group: Wave 2
  - Blocks: Tasks 10, 13
  - Blocked By: Tasks 1, 2, 3, 4

  **References**:
  - `src/app/api/milestones/route.ts` lines 28-41: Current GET SQL -- missing `sprint_id`, `priority`, `story_points`
  - `src/app/api/milestones/route.ts` lines 82-99: Current POST INSERT -- `sprint_id` already in INSERT (line 86) but column didn't exist; `priority` missing
  - `src/lib/validation.ts` lines 84-91: `CreateMilestoneSchema` -- after Task 4, will include `priority`
  - `src/lib/types.ts` lines 56-67: `Milestone` interface -- after Task 3, will include `sprint_id`, `priority`, `story_points`, `dependencies`
  - WHY: The existing bug (sprint_id in INSERT but not in schema) means any milestone creation on a fresh DB would crash with a SQLite error. Migration 020 fixes the schema; this task fixes the API to use the new columns correctly and adds the missing story_points computation.

  **Acceptance Criteria**:
  - [x] `GET /api/milestones?workspace_id=default` returns milestones with `story_points` field
  - [x] `GET /api/milestones?workspace_id=default&sprint_id=X` filters by sprint
  - [x] `POST /api/milestones` with `priority: 'high'` creates milestone with that priority
  - [x] `GET /api/milestones/[id]/dependencies` returns dependency list
  - [x] `POST /api/milestones/[id]/dependencies` with valid body creates dependency
  - [x] `POST /api/milestones/[id]/dependencies` with circular dependency returns 400

  **QA Scenarios**:
  - Scenario A (Happy Path -- create milestone with sprint and priority, verify story_points):
    - Tool: Bash (curl + sqlite3)
    - Preconditions: Server running, sprint exists with id `sprint-1`, tasks exist with `milestone_id` set and `effort` values
    - Steps: 1) `curl -s -X POST http://localhost:4000/api/milestones -H 'Content-Type: application/json' -d '{"workspace_id":"default","name":"M1","sprint_id":"sprint-1","priority":"high"}' | jq '{id,sprint_id,priority}'`. 2) Assign a task with effort=3 to that milestone. 3) `curl -s 'http://localhost:4000/api/milestones?workspace_id=default' | jq '.[] | select(.name=="M1") | .story_points'` -- expect 3.
    - Expected Result: Milestone created with sprint_id and priority; story_points reflects task effort sum
    - Failure Indicators: 500 error on creation, story_points missing or 0 when tasks have effort
    - Evidence path: `.sisyphus/evidence/task-5-milestone-api-happy.txt`
  - Scenario B (Error Case -- circular dependency rejected):
    - Tool: Bash (curl)
    - Preconditions: Two milestones A and B exist; A already depends on B
    - Steps: `curl -s -X POST http://localhost:4000/api/milestones/B-id/dependencies -H 'Content-Type: application/json' -d '{"depends_on_milestone_id":"A-id"}' | jq '.error'`
    - Expected Result: 400 error with message about circular dependency
    - Failure Indicators: Dependency created (circular), 500 error
    - Evidence path: `.sisyphus/evidence/task-5-milestone-circular-dep.txt`

  **Evidence to Capture**: Curl responses for milestone creation, story_points in GET response, dependency creation, circular dependency rejection.

  **Commit**: Part of Wave 2 commit -- `refactor(api): update routes for new hierarchy and PO role`

---

- [x] 6. **Tasks API Rewrite**
  **What to do**: Update task API routes to remove sprint_id/parent_task_id and fix sprint-scoped queries.
  1. `src/app/api/tasks/route.ts` GET (lines 12-100): Remove `sprintId` param (line 19) and its filter block (lines 63-66). Remove `parentTaskId` param (line 22) and its filter block (lines 75-79). Remove `WHERE t.parent_task_id IS NULL` from base SQL (line 37) -- all tasks are now top-level. Remove `LEFT JOIN sprints s ON t.sprint_id = s.id` (line 35) and `s.name as sprint_name` from SELECT. Sprint-scoped queries: change `AND t.sprint_id = ?` to `AND t.milestone_id IN (SELECT id FROM milestones WHERE sprint_id = ?)`. Backlog: change `AND t.sprint_id IS NULL` (line 81) to `AND t.milestone_id IS NULL`.
  2. `src/app/api/tasks/route.ts` POST: Remove `sprint_id` from INSERT statement.
  3. `src/app/api/tasks/[id]/route.ts` PATCH (lines 41-130): Remove `sprint_id` update block (lines 111-114). Remove `parent_task_id` update block (lines 119-122). Update the authorization gate (lines 73-84): change `SELECT is_master FROM agents WHERE id = ?` to `SELECT role FROM agents WHERE id = ?` and change `!updatingAgent.is_master` to `updatingAgent.role !== 'orchestrator'`. Update error message to `'Forbidden: only the orchestrator can approve tasks'`.
  4. Preserve milestone auto-close logic (lines 378-404 in `tasks/[id]/route.ts`) -- do not touch it.

  **Must NOT do**:
  - Do not change task status enum values.
  - Do not remove `milestone_id` from task queries.
  - Do not break the milestone auto-close logic.

  **Recommended Agent Profile**:
  - Category: `unspecified-high`
  - Skills: Next.js App Router, SQLite, TypeScript
  - Skills Evaluated but Omitted: ORM (raw SQL only)

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 2)
  - Parallel Group: Wave 2
  - Blocks: Tasks 10, 11, 13
  - Blocked By: Tasks 1, 2, 3, 4

  **References**:
  - `src/app/api/tasks/route.ts` lines 19-23: `sprintId` and `parentTaskId` params -- must be removed
  - `src/app/api/tasks/route.ts` lines 25-38: Base SQL with `LEFT JOIN sprints` and `WHERE t.parent_task_id IS NULL` -- must be updated
  - `src/app/api/tasks/route.ts` lines 63-83: Sprint and backlog filter blocks -- sprint filter changes to milestone subquery, backlog changes to `milestone_id IS NULL`
  - `src/app/api/tasks/[id]/route.ts` lines 73-84: Authorization gate -- `is_master` check must become `role = 'orchestrator'` check
  - `src/app/api/tasks/[id]/route.ts` lines 111-122: `sprint_id` and `parent_task_id` update blocks -- must be removed
  - WHY: Tasks no longer have a direct sprint relationship -- sprint context is derived through the milestone. The authorization gate must use the new role-based check to preserve the security invariant that only the orchestrator can approve tasks.

  **Acceptance Criteria**:
  - [x] `GET /api/tasks?workspace_id=default&backlog=true` returns tasks where `milestone_id IS NULL`
  - [x] `GET /api/tasks?workspace_id=default&sprint_id=X` returns tasks in milestones belonging to sprint X
  - [x] `PATCH /api/tasks/[id]` with `status: 'done'` from `review` by non-orchestrator agent returns 403
  - [x] `PATCH /api/tasks/[id]` with `status: 'done'` from `review` by orchestrator agent returns 200
  - [x] No `sprint_id` or `parent_task_id` in task INSERT or PATCH SQL

  **QA Scenarios**:
  - Scenario A (Happy Path -- orchestrator can approve task):
    - Tool: Bash (curl)
    - Preconditions: Task in `review` status, orchestrator agent exists with `role='orchestrator'`
    - Steps: `curl -s -X PATCH http://localhost:4000/api/tasks/TASK-ID -H 'Content-Type: application/json' -d '{"status":"done","updated_by_agent_id":"ORCHESTRATOR-ID"}' | jq '.status'`
    - Expected Result: `"done"`
    - Failure Indicators: 403 error, status not updated
    - Evidence path: `.sisyphus/evidence/task-6-tasks-orchestrator-approve.txt`
  - Scenario B (Error Case -- non-orchestrator cannot approve):
    - Tool: Bash (curl)
    - Preconditions: Task in `review` status, builder agent exists with `role='builder'`
    - Steps: `curl -s -X PATCH http://localhost:4000/api/tasks/TASK-ID -H 'Content-Type: application/json' -d '{"status":"done","updated_by_agent_id":"BUILDER-ID"}' | jq '.error'`
    - Expected Result: `"Forbidden: only the orchestrator can approve tasks"`
    - Failure Indicators: Task approved, 200 response
    - Evidence path: `.sisyphus/evidence/task-6-tasks-non-orchestrator-blocked.txt`

  **Evidence to Capture**: Curl responses for backlog query, sprint-scoped query, orchestrator approval, non-orchestrator rejection.

  **Commit**: Part of Wave 2 commit -- `refactor(api): update routes for new hierarchy and PO role`

---

- [x] 7. **Agents API + PO Enforcement**
  **What to do**: Update agent API routes to remove `is_master` and enforce single-orchestrator constraint.
  1. `src/app/api/agents/route.ts` GET (lines 10-42): Replace `ORDER BY is_master DESC, name ASC` (lines 20, 24) with `ORDER BY CASE WHEN role='orchestrator' THEN 0 ELSE 1 END, name ASC`.
  2. `src/app/api/agents/route.ts` POST (lines 45-92): Remove `is_master` from INSERT (lines 61-62, 68). Add single-PO enforcement: before INSERT, if `body.role === 'orchestrator'`, query `SELECT COUNT(*) FROM agents WHERE role='orchestrator' AND workspace_id=?` -- if count > 0, return 409 with `{ error: 'An orchestrator already exists in this workspace. Only one orchestrator is allowed per workspace.' }`.
  3. `src/app/api/agents/[id]/route.ts` PATCH (lines 38-80): Remove `is_master` update block (lines 78-80 and continuation). If updating `role` TO `'orchestrator'`, enforce single-PO: check no other orchestrator exists in workspace (excluding current agent), return 409 if one does. If updating `role` FROM `'orchestrator'` to something else, return 400 with `{ error: 'Cannot demote orchestrator. Delete and recreate the agent to change its role.' }`.

  **Must NOT do**:
  - Do not remove the `source: 'synced'` guard on POST (line 49) -- synced agents from OpenClaw bypass the creation restriction.
  - Do not add AI delegation logic to the orchestrator.

  **Recommended Agent Profile**:
  - Category: `unspecified-high`
  - Skills: Next.js App Router, SQLite, TypeScript, REST API design
  - Skills Evaluated but Omitted: OAuth (not used)

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 2)
  - Parallel Group: Wave 2
  - Blocks: Task 12
  - Blocked By: Tasks 1, 2, 3, 4

  **References**:
  - `src/app/api/agents/route.ts` lines 18-25: GET queries with `ORDER BY is_master DESC` -- must be replaced with role-based ordering
  - `src/app/api/agents/route.ts` lines 60-77: POST INSERT with `is_master` column (line 61) and value (line 68) -- must be removed
  - `src/app/api/agents/[id]/route.ts` lines 78-80: PATCH `is_master` update block -- must be removed
  - `src/app/api/agents/[id]/route.ts` lines 58-61: PATCH `role` update block -- must add orchestrator enforcement logic here
  - WHY: The single-orchestrator constraint is a business rule enforced at the API layer. The 409 response on duplicate orchestrator creation gives the UI a clear signal to show an error rather than silently failing.

  **Acceptance Criteria**:
  - [x] `GET /api/agents?workspace_id=default` returns orchestrator agent first
  - [x] `POST /api/agents` with `role: 'orchestrator'` when one already exists returns 409
  - [x] `PATCH /api/agents/[id]` with `role: 'orchestrator'` when another orchestrator exists returns 409
  - [x] `PATCH /api/agents/[id]` to demote orchestrator returns 400
  - [x] No `is_master` in any INSERT or UPDATE SQL in agents routes

  **QA Scenarios**:
  - Scenario A (Happy Path -- first orchestrator creation succeeds):
    - Tool: Bash (curl)
    - Preconditions: No orchestrator agent in workspace, server running
    - Steps: `curl -s -X POST http://localhost:4000/api/agents -H 'Content-Type: application/json' -d '{"name":"PO","role":"orchestrator","workspace_id":"default","source":"synced"}' | jq '.role'`
    - Expected Result: `"orchestrator"`
    - Failure Indicators: 403 or 409 error, agent not created
    - Evidence path: `.sisyphus/evidence/task-7-agents-po-create.txt`
  - Scenario B (Error Case -- second orchestrator rejected):
    - Tool: Bash (curl)
    - Preconditions: Orchestrator agent already exists in workspace
    - Steps: `curl -s -X POST http://localhost:4000/api/agents -H 'Content-Type: application/json' -d '{"name":"Second PO","role":"orchestrator","workspace_id":"default","source":"synced"}' | jq '{status: .error}'`
    - Expected Result: Error message about single orchestrator constraint
    - Failure Indicators: Second orchestrator created, 201 response
    - Evidence path: `.sisyphus/evidence/task-7-agents-po-duplicate-rejected.txt`

  **Evidence to Capture**: Curl responses for orchestrator creation, duplicate rejection, demotion rejection. GET response showing orchestrator first in list.

  **Commit**: Part of Wave 2 commit -- `refactor(api): update routes for new hierarchy and PO role`

---

- [x] 8. **Workflow Engine + Bootstrap Agents**
  **What to do**: Update the workflow engine and agent bootstrap to handle the orchestrator role and Human Verifier label.
  1. `src/lib/workflow-engine.ts` `populateTaskRolesFromAgents()` (lines 283-324): In the fuzzy matching loop (lines 285-298), add a guard: if `stage.role === 'orchestrator'`, skip it -- the orchestrator should not be auto-assigned to workflow stages. The orchestrator is a manager, not a worker.
  2. `src/lib/bootstrap-agents.ts` `CORE_AGENTS` array (lines 61-167): Add Orchestrator agent definition: `{ name: 'Orchestrator', role: 'orchestrator', soulMd: '# Orchestrator Agent\n\nProduct Owner and single point of approval. Reviews completed work and moves tasks from review to done.\n\n## Responsibilities\n- Review completed tasks in the review queue\n- Approve or reject work (move to done or back to builder)\n- Set task priorities and milestone assignments\n- Coordinate sprint planning\n\n## Rules\n- Only one Orchestrator per workspace\n- Do not do implementation work -- delegate to Builder\n- Approve only when all acceptance criteria are met' }`.
  3. `src/lib/bootstrap-agents.ts` `SHARED_AGENTS_MD` (lines 33-53): Replace `Review is a queue` (line 52) with `Human Verifier is a queue`. Add Orchestrator section: `## Orchestrator Agent\nProduct Owner. Single approver per workspace. Reviews work in the Human Verifier queue and moves tasks to Done.`.
  4. `src/lib/bootstrap-agents.ts` `bootstrapCoreAgentsRaw()` INSERT (lines 203-206): Remove `is_master` from INSERT column list and VALUES. The INSERT currently includes `is_master` (line 204) -- remove it.
  5. Check `src/lib/db/seed.ts` if it exists -- remove any `is_master` references.

  **Must NOT do**:
  - Do not change the learner fallback logic (lines 300-310 in workflow-engine.ts).
  - Do not change `drainQueue()` scope.
  - Do not add AI delegation logic to the Orchestrator.

  **Recommended Agent Profile**:
  - Category: `deep`
  - Skills: TypeScript, workflow engine patterns, agent system design
  - Skills Evaluated but Omitted: ML/AI (not applicable)

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 2)
  - Parallel Group: Wave 2
  - Blocks: Tasks 10, 11
  - Blocked By: Tasks 1, 2, 3, 4

  **References**:
  - `src/lib/workflow-engine.ts` lines 283-298: Fuzzy matching loop -- add `if (stage.role === 'orchestrator') continue;` guard
  - `src/lib/workflow-engine.ts` lines 300-310: Learner fallback -- do NOT touch this block
  - `src/lib/bootstrap-agents.ts` lines 33-53: `SHARED_AGENTS_MD` -- line 52 has `Review is a queue` text to replace
  - `src/lib/bootstrap-agents.ts` lines 61-167: `CORE_AGENTS` array -- add Orchestrator entry
  - `src/lib/bootstrap-agents.ts` lines 203-206: INSERT statement with `is_master` column -- must be removed
  - WHY: The orchestrator is a manager role. Auto-assigning it to workflow stages would break the workflow engine's assumption that stage agents are workers. The bootstrap change ensures new workspaces get an orchestrator by default.

  **Acceptance Criteria**:
  - [x] `populateTaskRolesFromAgents()` does not assign orchestrator to any workflow stage
  - [x] `SHARED_AGENTS_MD` contains `Human Verifier is a queue` not `Review is a queue`
  - [x] `CORE_AGENTS` includes Orchestrator with `role: 'orchestrator'`
  - [x] Bootstrap INSERT has no `is_master` column
  - [x] New workspace bootstrapped with zero agents gets Orchestrator agent created

  **QA Scenarios**:
  - Scenario A (Happy Path -- new workspace gets orchestrator):
    - Tool: Bash (curl + sqlite3)
    - Preconditions: New workspace created with zero agents
    - Steps: 1) Create workspace. 2) Trigger bootstrap (create first task or call bootstrap endpoint). 3) `sqlite3 mission-control.db "SELECT name, role FROM agents WHERE workspace_id='new-ws'"` -- expect Orchestrator with role='orchestrator'.
    - Expected Result: Orchestrator agent present in new workspace
    - Failure Indicators: No orchestrator, `is_master` column error
    - Evidence path: `.sisyphus/evidence/task-8-bootstrap-orchestrator.txt`
  - Scenario B (Error Case -- orchestrator not auto-assigned to workflow stage):
    - Tool: Bash (sqlite3)
    - Preconditions: Task created with workflow template, orchestrator agent exists
    - Steps: 1) Create task. 2) `sqlite3 mission-control.db "SELECT role FROM task_roles WHERE task_id='TASK-ID'"` -- expect no `orchestrator` role.
    - Expected Result: No task_roles entry with role='orchestrator'
    - Failure Indicators: Orchestrator assigned to a workflow stage
    - Evidence path: `.sisyphus/evidence/task-8-workflow-no-orchestrator-stage.txt`

  **Evidence to Capture**: Bootstrap agent list for new workspace. task_roles query showing no orchestrator assignment. SHARED_AGENTS_MD content showing Human Verifier text.

  **Commit**: Part of Wave 2 commit -- `refactor(api): update routes for new hierarchy and PO role`

---

- [x] 9. **Planning, Dispatch, and Other is_master Routes**
  **What to do**: Replace all remaining `is_master` references across API routes with role-based checks.
  1. `src/app/api/tasks/[id]/planning/route.ts` line 101: Replace `WHERE is_master = 1 AND workspace_id = ?` with `WHERE role = 'orchestrator' AND workspace_id = ?`.
  2. `src/app/api/tasks/[id]/planning/route.ts` lines 110-116: Replace `WHERE is_master = 1 AND id != ?` with `WHERE role = 'orchestrator' AND id != ?`.
  3. `src/app/api/tasks/[id]/planning/poll/route.ts` line 87: Replace `WHERE is_master = 1 AND workspace_id = ?` with `WHERE role = 'orchestrator' AND workspace_id = ?`.
  4. `src/app/api/tasks/[id]/planning/poll/route.ts` line 91: Replace `WHERE is_master = 1 AND id != ?` with `WHERE role = 'orchestrator' AND id != ?`.
  5. `src/app/api/tasks/[id]/dispatch/route.ts` line 57: Replace `if (agent.is_master)` with `if (agent.role === 'orchestrator')`. Line 66: Replace `WHERE is_master = 1` with `WHERE role = 'orchestrator'`.
  6. `src/app/api/tasks/[id]/dispatch/route.ts` line 28: Update the SELECT to include `a.role` instead of `a.is_master`.
  7. Search for any other `is_master` references in `src/app/api/tasks/[id]/activities/route.ts`, `src/app/api/openclaw/orchestra/route.ts`, `src/app/api/agents/sync/route.ts`, `src/app/api/openclaw/sessions/[id]/route.ts` and replace with role-based equivalents.
  8. Run `grep -r 'is_master' src/` -- result must be zero hits.

  **Must NOT do**:
  - Do not change the business logic of planning or dispatch -- only the `is_master` column references.
  - Do not remove the orchestrator conflict checks -- they are correct behavior, just need the column name updated.

  **Recommended Agent Profile**:
  - Category: `unspecified-high`
  - Skills: TypeScript, Next.js App Router, SQLite, grep/search
  - Skills Evaluated but Omitted: none

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 2, terminal task)
  - Parallel Group: Wave 2
  - Blocks: none (terminal Wave 2 task)
  - Blocked By: Tasks 1, 2, 3, 4

  **References**:
  - `src/app/api/tasks/[id]/planning/route.ts` lines 100-116: `is_master = 1` queries for finding default master and other orchestrators
  - `src/app/api/tasks/[id]/planning/poll/route.ts` lines 86-93: `is_master = 1` queries in `handlePlanningCompletion()`
  - `src/app/api/tasks/[id]/dispatch/route.ts` lines 28, 57, 66: `a.is_master` in SELECT and `is_master = 1` in WHERE
  - WHY: These routes implement the orchestrator conflict detection logic. They currently use the `is_master` column which will not exist after migration 020. Updating to `role = 'orchestrator'` preserves the exact same behavior with the new schema.

  **Acceptance Criteria**:
  - [x] `grep -r 'is_master' src/` returns zero hits
  - [x] Planning session starts correctly when orchestrator exists
  - [x] Dispatch route correctly identifies orchestrator by role
  - [x] `npx tsc --noEmit` passes clean

  **QA Scenarios**:
  - Scenario A (Happy Path -- planning starts with orchestrator):
    - Tool: Bash (curl)
    - Preconditions: Task in `inbox` status, orchestrator agent exists with `role='orchestrator'`
    - Steps: `curl -s -X POST http://localhost:4000/api/tasks/TASK-ID/planning -H 'Content-Type: application/json' -d '{}' | jq '.sessionKey'`
    - Expected Result: Session key returned (not null), no error about `is_master`
    - Failure Indicators: SQLite error about unknown column `is_master`, null session key
    - Evidence path: `.sisyphus/evidence/task-9-planning-starts.txt`
  - Scenario B (Error Case -- grep confirms zero is_master refs):
    - Tool: Bash
    - Preconditions: All route files updated
    - Steps: `grep -r 'is_master' src/ 2>&1`
    - Expected Result: No output (zero matches)
    - Failure Indicators: Any file:line output
    - Evidence path: `.sisyphus/evidence/task-9-is-master-grep-zero.txt`

  **Evidence to Capture**: `grep -r 'is_master' src/` output (must be empty). Planning start curl response. `npx tsc --noEmit` output.

  **Commit**: Part of Wave 2 commit -- `refactor(api): update routes for new hierarchy and PO role`

---

- [x] 10. **ActiveSprint Milestone-First View**
  **What to do**: Restructure the ActiveSprint component to show milestones as primary containers with tasks nested inside.
  1. Find the ActiveSprint component (search `src/components/` for files containing `ActiveSprint` or sprint task list rendering).
  2. Fetch milestones for the active sprint via `GET /api/milestones?workspace_id=X&sprint_id=SPRINT-ID`. Fetch tasks via `GET /api/tasks?workspace_id=X&sprint_id=SPRINT-ID`.
  3. Group tasks by `milestone_id`. Tasks with no `milestone_id` go into a `Backlog / Ungrouped` section at the bottom.
  4. Each milestone card shows: name (IBM Plex Mono heading), priority badge (color-coded: urgent=red, high=orange, normal=blue, low=gray using `mc-*` classes), coordinator agent name, progress bar (count of done tasks / total tasks), computed story_points from API response.
  5. Tasks within a milestone render as a nested list using the existing task card component.
  6. Add milestone dependency indicators: if a milestone has `dependencies`, show an informational badge `Depends on: [milestone name]` (no blocking behavior).
  7. Root DOM element must have `data-component="src/components/ActiveSprint"` (or the actual relative path).
  8. Styling: Tailwind only, `mc-*` CSS classes, Lucide React icons (`ChevronRight`, `Target`, `AlertCircle`), IBM Plex Mono for headings, Atkinson Hyperlegible for body text.

  **Must NOT do**:
  - Do not create a standalone milestone detail panel.
  - Do not add milestone burndown charts.
  - Do not enforce dependency blocking in the UI.

  **Recommended Agent Profile**:
  - Category: `visual-engineering`
  - Skills: React, TypeScript, Tailwind CSS, Lucide React, Next.js
  - Skills Evaluated but Omitted: D3.js (no charts needed), Storybook (no test framework)

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 3, parallel with Tasks 11, 12, 13)
  - Parallel Group: Wave 3
  - Blocks: Tasks 14, 15
  - Blocked By: Tasks 5, 6, 8

  **References**:
  - `src/lib/types.ts` lines 56-67: `Milestone` interface -- after Task 3, includes `sprint_id`, `priority`, `story_points`, `dependencies`
  - `src/lib/types.ts` lines 126-160: `Task` interface -- after Task 3, no `sprint_id` or `subtasks`
  - `src/app/api/milestones/route.ts` lines 28-41: GET query -- after Task 5, returns `story_points` and supports `sprint_id` filter
  - `src/app/api/tasks/route.ts` lines 63-66: Sprint filter -- after Task 6, uses milestone subquery
  - WHY: The milestone-first view is the primary deliverable of this restructure from the user's perspective. Milestones are now the organizing unit within a sprint, so the sprint view must reflect that hierarchy.

  **Acceptance Criteria**:
  - [x] ActiveSprint view shows milestones as expandable containers
  - [x] Each milestone shows priority badge, coordinator, progress bar, story_points
  - [x] Tasks without milestone appear in `Backlog / Ungrouped` section
  - [x] Milestone dependency badge shows when dependencies exist
  - [x] Root element has `data-component` attribute
  - [x] No TypeScript errors in component

  **QA Scenarios**:
  - Scenario A (Happy Path -- milestone with tasks renders correctly):
    - Tool: Bash (curl to verify API) + visual inspection
    - Preconditions: Active sprint with 2 milestones, each with 2-3 tasks at various statuses
    - Steps: 1) Load the app at `http://localhost:4000`. 2) Navigate to active sprint view. 3) Verify milestone cards visible with priority badges. 4) Verify task count and progress bar. 5) Verify ungrouped tasks section at bottom.
    - Expected Result: Milestone-first layout with nested tasks, priority badges, progress bars
    - Failure Indicators: Flat task list (no milestone grouping), missing priority badges, missing progress
    - Evidence path: `.sisyphus/evidence/task-10-activesprint-screenshot.png`
  - Scenario B (Error Case -- empty milestone renders gracefully):
    - Tool: Visual inspection
    - Preconditions: Milestone with zero tasks
    - Steps: Navigate to sprint view with empty milestone
    - Expected Result: Milestone card shows 0/0 progress, no crash
    - Failure Indicators: JavaScript error, blank screen, division by zero in progress bar
    - Evidence path: `.sisyphus/evidence/task-10-activesprint-empty-milestone.png`

  **Evidence to Capture**: Screenshot of milestone-first view. Screenshot of empty milestone. `data-component` attribute verified via browser DevTools.

  **Commit**: Part of Wave 3 commit -- `refactor(ui): milestone-first views and PO distinction`

---

- [x] 11. **Kanban Board Milestone Grouping**
  **What to do**: Add milestone swimlanes to the Kanban/Board component.
  1. Find the Kanban/Board component (search `src/components/` for files containing `Kanban` or `Board` or drag-and-drop column rendering).
  2. Fetch milestones for the active sprint. Group tasks by `milestone_id` within each status column.
  3. Add milestone header rows (swimlanes) that span all status columns. Each swimlane header shows: milestone name, priority badge, story_points.
  4. Milestone priority determines visual ordering: urgent first, then high, normal, low. Tasks without milestone appear in `Ungrouped` swimlane at the bottom.
  5. Maintain existing drag-and-drop behavior across status columns -- dragging a task changes its status, not its milestone.
  6. Root DOM element must have `data-component` attribute with the actual relative path.
  7. Styling: Tailwind only, `mc-*` classes, Lucide React icons, IBM Plex Mono headings.

  **Must NOT do**:
  - Do not break drag-and-drop functionality.
  - Do not add milestone editing from the board view.

  **Recommended Agent Profile**:
  - Category: `visual-engineering`
  - Skills: React, TypeScript, Tailwind CSS, drag-and-drop (existing library in project), Lucide React
  - Skills Evaluated but Omitted: D3.js, Storybook

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 3)
  - Parallel Group: Wave 3
  - Blocks: Tasks 14, 15
  - Blocked By: Tasks 6, 8

  **References**:
  - `src/lib/types.ts` lines 56-67: `Milestone` interface -- `priority` field used for swimlane ordering
  - `src/lib/types.ts` lines 126-160: `Task` interface -- `milestone_id` used for grouping
  - `src/app/api/tasks/route.ts` lines 63-66: Sprint filter -- after Task 6, returns tasks for sprint via milestone subquery
  - WHY: The Kanban board is the primary work-in-progress view. Adding milestone swimlanes makes it immediately clear which tasks belong to which business goal, without changing the status-column structure that agents and users rely on.

  **Acceptance Criteria**:
  - [x] Kanban board shows milestone swimlane headers spanning all columns
  - [x] Swimlanes ordered by priority (urgent first)
  - [x] Ungrouped swimlane at bottom for tasks without milestone
  - [x] Drag-and-drop still works across status columns
  - [x] Root element has `data-component` attribute

  **QA Scenarios**:
  - Scenario A (Happy Path -- swimlanes render with correct ordering):
    - Tool: Visual inspection
    - Preconditions: Active sprint with milestones of different priorities, tasks in various columns
    - Steps: 1) Navigate to Kanban board. 2) Verify urgent milestone swimlane appears first. 3) Verify tasks grouped under correct milestone. 4) Drag a task to different column -- verify status changes, milestone unchanged.
    - Expected Result: Swimlanes visible, priority ordering correct, drag-and-drop works
    - Failure Indicators: No swimlanes, wrong ordering, drag-and-drop broken
    - Evidence path: `.sisyphus/evidence/task-11-kanban-swimlanes.png`
  - Scenario B (Error Case -- board with no milestones renders gracefully):
    - Tool: Visual inspection
    - Preconditions: Active sprint with tasks but no milestones
    - Steps: Navigate to Kanban board
    - Expected Result: All tasks in `Ungrouped` swimlane, no crash
    - Failure Indicators: JavaScript error, blank board
    - Evidence path: `.sisyphus/evidence/task-11-kanban-no-milestones.png`

  **Evidence to Capture**: Screenshot of board with swimlanes. Screenshot of drag-and-drop in action. `data-component` attribute verified.

  **Commit**: Part of Wave 3 commit -- `refactor(ui): milestone-first views and PO distinction`

---

- [x] 12. **AgentsSidebar PO Distinction**
  **What to do**: Update the AgentsSidebar component to visually distinguish the Orchestrator/PO agent.
  1. Find the AgentsSidebar component (search `src/components/` for files containing `AgentsSidebar` or agent list rendering).
  2. Replace any `is_master`-based sorting or display logic with `role === 'orchestrator'` checks.
  3. Orchestrator agent gets: `Crown` icon (Lucide React `Crown`), different background/border using `mc-*` classes (e.g., `bg-mc-gold/10 border-mc-gold`), `Product Owner` subtitle below the agent name.
  4. Orchestrator always appears first in the list (sort by `role === 'orchestrator'` descending, then by name).
  5. Root DOM element must have `data-component` attribute with the actual relative path.
  6. Styling: Tailwind only, `mc-*` classes, Lucide React `Crown` icon only.

  **Must NOT do**:
  - Do not add AI delegation UI to the orchestrator card.
  - Do not use any icon library other than Lucide React.

  **Recommended Agent Profile**:
  - Category: `visual-engineering`
  - Skills: React, TypeScript, Tailwind CSS, Lucide React
  - Skills Evaluated but Omitted: none

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 3)
  - Parallel Group: Wave 3
  - Blocks: Tasks 14, 15
  - Blocked By: Task 7

  **References**:
  - `src/app/api/agents/route.ts` lines 18-25: GET query with `ORDER BY is_master DESC` -- after Task 7, uses role-based ordering; sidebar should match this ordering
  - `src/lib/types.ts` lines 33-54: `Agent` interface -- after Task 3, no `is_master` field; use `role === 'orchestrator'` check
  - WHY: The orchestrator is the single approver and PO. Visual distinction in the sidebar makes it immediately clear who has approval authority, which is important for users and agents reading the AGENTS.md context.

  **Acceptance Criteria**:
  - [x] Orchestrator agent shows `Crown` icon
  - [x] Orchestrator agent shows `Product Owner` subtitle
  - [x] Orchestrator agent has distinct background/border styling
  - [x] Orchestrator appears first in agent list
  - [x] No `is_master` references in component code
  - [x] Root element has `data-component` attribute

  **QA Scenarios**:
  - Scenario A (Happy Path -- orchestrator visually distinct):
    - Tool: Visual inspection
    - Preconditions: Orchestrator agent exists in workspace
    - Steps: 1) Load app. 2) Open agents sidebar. 3) Verify orchestrator appears first with Crown icon and `Product Owner` subtitle. 4) Verify distinct background color.
    - Expected Result: Orchestrator visually distinct, first in list
    - Failure Indicators: No Crown icon, no subtitle, same styling as other agents
    - Evidence path: `.sisyphus/evidence/task-12-agents-sidebar-po.png`
  - Scenario B (Error Case -- no orchestrator renders gracefully):
    - Tool: Visual inspection
    - Preconditions: Workspace with no orchestrator agent
    - Steps: Load app, open agents sidebar
    - Expected Result: Normal agent list, no crash, no Crown icon shown
    - Failure Indicators: JavaScript error, blank sidebar
    - Evidence path: `.sisyphus/evidence/task-12-agents-sidebar-no-po.png`

  **Evidence to Capture**: Screenshot of sidebar with orchestrator. Screenshot without orchestrator. `data-component` attribute verified.

  **Commit**: Part of Wave 3 commit -- `refactor(ui): milestone-first views and PO distinction`

---

- [x] 13. **Task Forms + BacklogView Updates**
  **What to do**: Update task creation/edit forms and the backlog view to remove deprecated fields.
  1. Find the task creation form component (search `src/components/` for task creation modal or form).
  2. Task creation form: remove `sprint_id` selector (tasks get sprint context via milestone). Remove `parent_task_id` / `subtask of` selector. Ensure `milestone_id` selector is prominent -- it should be a required or clearly visible field.
  3. Task edit/detail view: remove `sprint_id` display field. Remove subtask section. Show milestone with sprint context: if task has a milestone and that milestone has a sprint, show `Milestone: [name] (in [sprint name])`.
  4. BacklogView component (search for `BacklogView` or backlog task list): update the query from `sprint_id IS NULL` to `milestone_id IS NULL` for backlog definition. Add `Assign to milestone` action on backlog task cards.
  5. All modified components must have `data-component` attribute on root DOM element.
  6. Styling: Tailwind only, `mc-*` classes, Lucide React icons.

  **Must NOT do**:
  - Do not remove `milestone_id` from task creation form.
  - Do not add sprint selector to task creation (sprint is set on milestone, not task).

  **Recommended Agent Profile**:
  - Category: `visual-engineering`
  - Skills: React, TypeScript, Tailwind CSS, form handling, Lucide React
  - Skills Evaluated but Omitted: none

  **Parallelization**:
  - Can Run In Parallel: YES (Wave 3)
  - Parallel Group: Wave 3
  - Blocks: Tasks 14, 15
  - Blocked By: Tasks 5, 6

  **References**:
  - `src/lib/types.ts` lines 394-410: `CreateTaskRequest` -- after Task 3, no `sprint_id` or `parent_task_id`
  - `src/lib/validation.ts` lines 31-48: `CreateTaskSchema` -- after Task 4, no `sprint_id` or `parent_task_id`
  - `src/app/api/tasks/route.ts` lines 80-83: Backlog filter -- after Task 6, uses `milestone_id IS NULL`
  - WHY: The task creation form is the primary user-facing entry point for new work. Removing sprint_id from the form enforces the new hierarchy at the UX level -- users assign tasks to milestones, and milestones belong to sprints.

  **Acceptance Criteria**:
  - [x] Task creation form has no `sprint_id` or `parent_task_id` fields
  - [x] Task creation form has prominent `milestone_id` selector
  - [x] Task detail view shows `Milestone: [name] (in [sprint])` when applicable
  - [x] BacklogView shows tasks where `milestone_id IS NULL`
  - [x] BacklogView task cards have `Assign to milestone` action
  - [x] All modified components have `data-component` attribute

  **QA Scenarios**:
  - Scenario A (Happy Path -- task created with milestone, shows sprint context):
    - Tool: Visual inspection + curl
    - Preconditions: Milestone exists in a sprint
    - Steps: 1) Open task creation form. 2) Verify no sprint_id field. 3) Select milestone. 4) Create task. 5) Open task detail -- verify `Milestone: [name] (in SPRINT-X)` shown.
    - Expected Result: Task created with milestone, sprint context shown in detail
    - Failure Indicators: sprint_id field present in form, sprint context missing in detail
    - Evidence path: `.sisyphus/evidence/task-13-task-form-milestone.png`
  - Scenario B (Error Case -- backlog shows only milestone-less tasks):
    - Tool: Bash (curl)
    - Preconditions: Mix of tasks with and without milestone_id
    - Steps: `curl -s 'http://localhost:4000/api/tasks?workspace_id=default&backlog=true' | jq '[.[] | select(.milestone_id != null)] | length'`
    - Expected Result: `0` (no tasks with milestone_id in backlog)
    - Failure Indicators: Tasks with milestone_id appear in backlog
    - Evidence path: `.sisyphus/evidence/task-13-backlog-milestone-null.txt`

  **Evidence to Capture**: Screenshot of task creation form (no sprint_id). Screenshot of task detail with sprint context. Curl response for backlog query.

  **Commit**: Part of Wave 3 commit -- `refactor(ui): milestone-first views and PO distinction`

---

- [x] 14. **KNOWLEDGE.md + CHANGELOG.md Update**
  **What to do**: Update documentation to reflect all changes made in this restructure.
  1. `KNOWLEDGE.md` -- update the following sections:
     - Architecture section: update hierarchy diagram to show `Workspace -> Sprint -> Milestone -> Task` (was `Workspace -> Sprint/Milestone -> Task` as peers).
     - Task Lifecycle section: update workflow stage names -- `review` status now has label `Human Verifier` in workflow templates.
     - Sprint section: sprints now contain milestones (not tasks directly).
     - Milestone section: add `priority` (low/normal/high/urgent), `sprint_id` FK, `dependencies` (milestone_dependencies table), `story_points` (computed via SUM of task.effort). Document the `milestone_dependencies` table.
     - Task fields section: remove `sprint_id` and `parent_task_id` from field descriptions.
     - Agent System section: replace `is_master` boolean with `role = 'orchestrator'`. Document single-per-workspace constraint. Document that orchestrator is not auto-assigned to workflow stages.
     - Database Schema section: update all table descriptions to match migration 020 end-state.
     - Key Design Decisions section: add decisions for (a) milestone-first hierarchy, (b) single orchestrator constraint, (c) story_points computed not stored, (d) dependencies informational only in v1.
  2. `CHANGELOG.md` -- add new version entry at the top with: version number (increment from last), date (today), summary of changes, list of breaking changes (sprint_id removed from tasks, parent_task_id removed, is_master removed).

  **Must NOT do**:
  - Do not remove existing design decisions that are still valid.
  - Do not add emojis (per AGENTS.md rule).
  - Do not use em dashes or en dashes.

  **Recommended Agent Profile**:
  - Category: `writing`
  - Skills: Technical writing, documentation, Markdown
  - Skills Evaluated but Omitted: none

  **Parallelization**:
  - Can Run In Parallel: NO (Wave 4, depends on all Wave 3 tasks)
  - Parallel Group: Wave 4
  - Blocks: Task 15
  - Blocked By: Tasks 10, 11, 12, 13

  **References**:
  - `KNOWLEDGE.md` (root): full file -- read before editing to understand current structure
  - `CHANGELOG.md` (root): full file -- read to understand version format and increment correctly
  - `src/lib/db/schema.ts`: final state after Task 2 -- use as source of truth for schema documentation
  - `src/lib/types.ts`: final state after Task 3 -- use as source of truth for type documentation
  - WHY: KNOWLEDGE.md is the primary reference for AI agents working on this codebase. Outdated documentation causes agents to make incorrect assumptions. Every architectural change must be reflected here immediately.

  **Acceptance Criteria**:
  - [x] KNOWLEDGE.md hierarchy diagram shows `Sprint -> Milestone -> Task`
  - [x] KNOWLEDGE.md milestone section documents `priority`, `sprint_id`, `dependencies`, `story_points`
  - [x] KNOWLEDGE.md agent section documents orchestrator role and single-per-workspace constraint
  - [x] KNOWLEDGE.md has no references to `is_master`, `parent_task_id`, or `task.sprint_id`
  - [x] CHANGELOG.md has new entry at top with today's date
  - [x] No em dashes or en dashes in any added text

  **QA Scenarios**:
  - Scenario A (Happy Path -- KNOWLEDGE.md reflects new schema):
    - Tool: Bash (grep)
    - Preconditions: KNOWLEDGE.md updated
    - Steps: `grep -n 'is_master\|parent_task_id\|task\.sprint_id' KNOWLEDGE.md`
    - Expected Result: Zero matches (or only in historical/deprecated sections clearly marked as such)
    - Failure Indicators: Active references to removed fields
    - Evidence path: `.sisyphus/evidence/task-14-knowledge-grep.txt`
  - Scenario B (Error Case -- CHANGELOG.md has new entry):
    - Tool: Bash (head)
    - Preconditions: CHANGELOG.md updated
    - Steps: Read first 20 lines of CHANGELOG.md
    - Expected Result: New version entry at top with today's date and hierarchy restructure summary
    - Failure Indicators: No new entry, old entry at top
    - Evidence path: `.sisyphus/evidence/task-14-changelog-top.txt`

  **Evidence to Capture**: Grep output for removed fields in KNOWLEDGE.md. First 20 lines of CHANGELOG.md.

  **Commit**: `docs: update KNOWLEDGE.md for hierarchy restructure`

---

- [x] 15. **Full Build + Deploy Verification**
  **What to do**: Run the complete verification suite and deploy.
  1. Run `scripts/check.sh` -- must pass (lint + validate + build). Capture full output.
  2. Run `npx tsc --noEmit` independently -- must show zero errors. Capture output.
  3. Run `grep -r 'is_master' src/` -- must return zero hits. Capture output.
  4. Run `grep -r 'parent_task_id' src/` -- must return zero hits. Capture output.
  5. Run `scripts/deploy.sh` -- must succeed. Capture output.
  6. Run `curl -s -o /dev/null -w "%{http_code}" https://control.blockether.com` -- must return `200`.
  7. Test API endpoints with curl:
     - Create milestone with `sprint_id` and `priority`: `POST /api/milestones`
     - Create task with `milestone_id`: `POST /api/tasks`
     - Verify orchestrator enforcement: attempt second `POST /api/agents` with `role: 'orchestrator'` -- expect 409
     - Verify backlog: `GET /api/tasks?workspace_id=default&backlog=true` -- all results have `milestone_id: null`
  8. Run schema verification commands from the plan's Success Criteria section.

  **Must NOT do**:
  - Do not deploy if `scripts/check.sh` fails.
  - Do not skip any verification step.

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: Bash, curl, sqlite3, Next.js build
  - Skills Evaluated but Omitted: none

  **Parallelization**:
  - Can Run In Parallel: NO (Wave 4, final task)
  - Parallel Group: Wave 4
  - Blocks: F1-F4 (Final Verification Wave)
  - Blocked By: Task 14

  **References**:
  - `scripts/check.sh`: full pre-deploy check script
  - `scripts/deploy.sh`: build + restart + health check script
  - Plan Success Criteria section (lines 246-267): verification commands to run
  - WHY: This task is the gate before the final review wave. All implementation must be verified working end-to-end before handing off to the review agents.

  **Acceptance Criteria**:
  - [x] `scripts/check.sh` exits 0
  - [x] `npx tsc --noEmit` exits 0 with zero errors
  - [x] `grep -r 'is_master' src/` returns zero hits
  - [x] `grep -r 'parent_task_id' src/` returns zero hits
  - [x] `scripts/deploy.sh` succeeds
  - [x] `https://control.blockether.com` returns HTTP 200
  - [x] All API curl tests pass

  **QA Scenarios**:
  - Scenario A (Happy Path -- full verification passes):
    - Tool: Bash
    - Preconditions: All Wave 1-3 tasks complete
    - Steps: Run each command in sequence: `scripts/check.sh`, `npx tsc --noEmit`, `grep -r 'is_master' src/`, `grep -r 'parent_task_id' src/`, `scripts/deploy.sh`, `curl -s -o /dev/null -w "%{http_code}" https://control.blockether.com`
    - Expected Result: All commands exit 0 or return expected values, curl returns 200
    - Failure Indicators: Any non-zero exit, any grep hits, curl returns non-200
    - Evidence path: `.sisyphus/evidence/task-15-full-verification.txt`
  - Scenario B (Error Case -- deploy blocked if check fails):
    - Tool: Bash
    - Preconditions: Intentionally introduce a TypeScript error to test the gate
    - Steps: 1) Introduce a type error. 2) Run `scripts/check.sh`. 3) Verify it exits non-zero. 4) Fix the error. 5) Re-run and verify it passes.
    - Expected Result: `check.sh` correctly blocks on errors
    - Failure Indicators: `check.sh` exits 0 despite errors
    - Evidence path: `.sisyphus/evidence/task-15-check-gate.txt`

  **Evidence to Capture**: Full output of `scripts/check.sh`. `npx tsc --noEmit` output. Both grep outputs (must be empty). `scripts/deploy.sh` output. Curl HTTP status code. All API test curl responses.
---

## Final Verification Wave (MANDATORY -- after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection -> fix -> re-run.

- [x] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns -- reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Run `npx tsc --noEmit` + `scripts/lint.sh` + `npm run build`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names. Verify all `is_master` references gone. Verify all `parent_task_id` references gone.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | is_master refs [0/N] | parent_task_id refs [0/N] | VERDICT`

- [x] F3. **Real QA** -- `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task -- follow exact steps, capture evidence. Test cross-task integration (milestone creation in sprint, task in milestone, PO enforcement, workflow transitions). Test edge cases: empty milestone, task with no milestone (backlog), second PO creation attempt. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 -- everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance: no AI delegation logic, no enforced dependency blocking, no stored story points, no learner changes, no queue drain scope change. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Guardrails [N/N clean] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `refactor(schema): restructure hierarchy and agent model` -- migration, schema.ts, types.ts, validation.ts
- **Wave 2**: `refactor(api): update routes for new hierarchy and PO role` -- all API routes, workflow engine, bootstrap
- **Wave 3**: `refactor(ui): milestone-first views and PO distinction` -- all UI components
- **Wave 4**: `docs: update KNOWLEDGE.md for hierarchy restructure` -- KNOWLEDGE.md, CHANGELOG.md
- **Post-verify**: `chore: deploy hierarchy restructure` -- deploy verification

---

## Success Criteria

### Verification Commands
```bash
# Schema verification
sqlite3 mission-control.db "PRAGMA table_info(milestones)" | grep -E "sprint_id|priority"  # Both present
sqlite3 mission-control.db ".tables" | grep milestone_dependencies  # Table exists
sqlite3 mission-control.db "PRAGMA table_info(tasks)" | grep -c parent_task_id  # 0
sqlite3 mission-control.db "PRAGMA table_info(tasks)" | grep -c sprint_id  # 0
sqlite3 mission-control.db "PRAGMA table_info(agents)" | grep -c is_master  # 0

# Build verification
npx tsc --noEmit  # 0 errors
npm run build  # clean
scripts/check.sh  # all pass

# API verification
curl -s http://localhost:4000/api/agents?workspace_id=default | jq '.[0].role'  # "orchestrator"
curl -s -X POST http://localhost:4000/api/agents -H "Content-Type: application/json" \
  -d '{"name":"Second PO","role":"orchestrator","workspace_id":"default"}' | jq '.error'  # error present

# Deploy verification
scripts/deploy.sh  # succeeds
curl -s -o /dev/null -w "%{http_code}" https://control.blockether.com  # 200
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] Build passes clean
- [x] Deploy succeeds with 200
- [x] `grep -r "is_master" src/` returns 0 results
- [x] `grep -r "parent_task_id" src/` returns 0 results
