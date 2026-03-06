# Learnings -- hierarchy-agent-restructure

## 2026-03-06 -- Session Start

### Worktree
- Branch: `feat/hierarchy-agent-restructure`
- Worktree: `/root/repos/blockether/mission-control-hierarchy`
- Main repo: `/root/repos/blockether/mission-control`
- ALL work MUST happen in the worktree path

### Codebase Patterns
- Migration pattern: id string, name string, `up(db: Database.Database)` function. Runner handles transactions, foreign_keys OFF, legacy_alter_table ON.
- Migration numbering: next is `020`
- SQLite drop column: NOT supported directly. Use create-copy-drop-rename pattern.
- API routes: Next.js App Router. Raw SQL (better-sqlite3). No ORM.
- Zod validation: `src/lib/validation.ts`. Schemas used in API routes.
- Types: `src/lib/types.ts`. Pure TypeScript interfaces, no runtime.
- Bootstrap: `src/lib/bootstrap-agents.ts`. Creates 4 default agents. Called lazily on workspace creation.
- is_master: appears in ~35 places across 16 files. Must ALL become `role = 'orchestrator'`.
- parent_task_id: appears in 7 files, 19 occurrences. ALL must be removed.

### Existing Bug
- `src/app/api/milestones/route.ts` writes `sprint_id` to milestones INSERT but column didn't exist -- fixed by migration 020 adding the column. Route itself needs `priority` added.

### Ghost Column
- Migrated DBs have `milestone_id` on sprints (from migration 018). Not present on fresh DBs. Migration 020 must clean this up.

### Authorization Gate
- `src/app/api/tasks/[id]/route.ts:73-84` checks `is_master` to allow review->done transition. Must become `role === 'orchestrator'`. This is a security boundary.

### Styling Rules (AGENTS.md)
- Tailwind + mc-* CSS classes only
- Lucide React icons ONLY
- IBM Plex Mono (headings), Atkinson Hyperlegible (body)
- Light theme, Blockether cream/gold palette
- All components MUST have `data-component="src/path/to/File"` on root DOM element
- No emojis
- Toolbars: ChevronRight leading + context title left, controls right

### Commit Footer Required
Every commit MUST include:
```
Ultraworked with [Sisyphus] from OhMyClaude Code (https://ohmyclaude.com)

Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>
```

## Task 4: Schema Validation Update (2026-03-06)

### Changes Made
- **CreateTaskSchema**: Removed `sprint_id` (line 43) and `parent_task_id` (line 45)
- **UpdateTaskSchema**: Removed `sprint_id` (line 60) and `parent_task_id` (line 62)
- **CreateMilestoneSchema**: Added `priority: z.enum(['low','normal','high','urgent']).optional()` (line 87). `sprint_id` already present (line 82).
- **UpdateMilestoneSchema**: Added `sprint_id: z.string().optional().nullable()` (line 96) and `priority: z.enum(['low','normal','high','urgent']).optional()` (line 97)
- **New Export**: `CreateMilestoneDependencySchema` (lines 116-123) with refine validation requiring at least one of `depends_on_milestone_id` or `depends_on_task_id`

### Verification
- No agent schemas found in validation.ts (is_master removal not needed here)
- TypeScript syntax valid. File compiles without validation.ts-specific errors.
- Downstream errors in tasks/[id]/activities/route.ts and TaskDetailPanel.tsx are expected (they reference removed fields)

### Key Insight
Zod schemas are runtime API boundaries. Removing sprint_id and parent_task_id from task schemas means:
- API will reject/strip these fields from incoming requests
- Enforces new contract: tasks get sprint context via milestone.sprint_id, not direct sprint FK
- Milestone dependencies are informational only (v1) -- no blocking logic yet

## 2026-03-06T08:01:23+01:00 Task 8: Orchestrator Guard + Bootstrap/Seed Cleanup

### Changes Applied
- `populateTaskRolesFromAgents()` now skips orchestrator stages with `if (stage.role === 'orchestrator') continue;` so orchestrator is never auto-assigned as a workflow worker.
- `bootstrap-agents.ts` now includes Orchestrator in `CORE_AGENTS` and inserts agents without `is_master`.
- Bootstrap is now role-aware and idempotent per workspace: it checks existing agent by `(workspace_id, role)` before creating, preventing duplicate orchestrators on re-bootstrap.
- `SHARED_AGENTS_MD` now documents Orchestrator explicitly as a manager role and removes master-role framing.
- `seed.ts` removed all `is_master` usage; orchestrator seed entry now uses `role: 'orchestrator'` and description `Project Orchestrator / Product Owner`.

### Verification Notes
- `is_master` grep across target files returned zero hits.
- LSP diagnostics are clean for changed files:
  - `src/lib/workflow-engine.ts`
  - `src/lib/bootstrap-agents.ts`
  - `src/lib/db/seed.ts`
- Full `npm run build` currently fails due to pre-existing unrelated type error in `src/components/ActiveSprint.tsx` (`Task.sprint_id`), not from Task 8 file changes.

## [2026-03-06] Task 7: Agents API is_master removal + single-orchestrator enforcement

- 8 `is_master` references found across 3 API files (route.ts, [id]/route.ts, sync/route.ts)
- `ORDER BY is_master DESC, name ASC` replaced with `ORDER BY role ASC, name ASC` (GET) and `ORDER BY name ASC` (sync)
- Single-orchestrator enforcement: query `SELECT id FROM agents WHERE workspace_id = ? AND role = 'orchestrator'` before INSERT (POST) and before role promotion (PATCH)
- Orchestrator demotion block returns 400 with message directing user to delete+recreate
- Duplicate orchestrator returns 409 in both POST and PATCH contexts
- All 3 files already had `queryOne` imported, no import changes needed
- The PATCH handler in [id]/route.ts had `body.is_master` block at lines 78-81 which was cleanly removed
- Both POST enforcement and PATCH demotion/promotion checks use the same pattern: queryOne for existing orchestrator in workspace

## [2026-03-06] Task 9: Replace remaining is_master across API routes

### Files changed (5):
- `src/app/api/tasks/[id]/activities/route.ts` — removed `is_master: false` from 2 inline Agent object literals (lines 51, 133). These were constructing partial Agent objects for SSE/response payloads; since Agent interface no longer has is_master, the property was simply deleted.
- `src/app/api/tasks/[id]/planning/route.ts` — 2 SQL queries: `WHERE is_master = 1` → `WHERE role = 'orchestrator'` (lines 101, 112)
- `src/app/api/tasks/[id]/planning/poll/route.ts` — 2 SQL queries: same pattern (lines 87, 91)
- `src/app/api/tasks/[id]/dispatch/route.ts` — 3 changes: removed `a.is_master` from SELECT (line 28), `agent.is_master` → `agent.role === 'orchestrator'` (line 57), SQL `WHERE is_master = 1` → `WHERE role = 'orchestrator'` (line 66)
- `src/app/api/openclaw/orchestra/route.ts` — 1 SQL query: same pattern (line 38)

### Key observations:
- `sessions/[id]/route.ts` had zero is_master hits — already clean
- The dispatch route had the most complex change: SQL SELECT removal + JS property check + SQL WHERE clause
- All other files in `src/app/api/` with is_master hits (agents/*, tasks/route.ts, tasks/[id]/route.ts) are handled by Tasks 6 and 7 — correctly excluded from this task's scope
- Final grep confirmed zero is_master hits in both `src/app/api/tasks/` and `src/app/api/openclaw/`


## [2026-03-06] Task 6: Tasks API rewrite (sprint_id/parent_task_id removal + auth gate fix)

### Changes Made
- **tasks/route.ts GET**: Removed `parent_task_id` query param, `sprint_name` SELECT, sprint JOIN, `WHERE t.parent_task_id IS NULL` (now `WHERE 1=1`)
- **Sprint filter**: `WHERE t.sprint_id = ?` replaced with `WHERE t.milestone_id IN (SELECT id FROM milestones WHERE sprint_id = ?)`
- **Backlog filter**: `t.sprint_id IS NULL` replaced with `t.milestone_id IS NULL`
- **Sprint transform**: Removed from response mapping (Task type no longer has sprint_id)
- **tasks/route.ts POST**: Removed `sprint_id` and `parent_task_id` from INSERT (19 cols -> 17 cols)
- **tasks/[id]/route.ts PATCH**: Removed `sprint_id` and `parent_task_id` update blocks
- **Auth gate**: `SELECT is_master` -> `SELECT role`, `!updatingAgent.is_master` -> `updatingAgent.role !== 'orchestrator'`

### Key Pattern
- Sprint-scoped task queries now go through milestones: `t.milestone_id IN (SELECT id FROM milestones WHERE sprint_id = ?)`
- `sprint_id` as a URL query parameter is still valid -- it just resolves through the milestones table
- The 2 remaining `sprint_id` string occurrences in route.ts are legitimate (query param name + milestones table column)

### Verification
- LSP diagnostics: clean on both files
- grep for is_master/parent_task_id: zero hits
- grep for sprint_id: 2 legitimate hits (query param + milestone subquery)
## [2026-03-06] Task 5: Update Milestones API Routes

- `m.*` in SQL already includes sprint_id and priority columns (added by migration 020), so no explicit SELECT needed for those
- story_points MUST be computed at read time via `(SELECT COALESCE(SUM(effort), 0) FROM tasks WHERE milestone_id = m.id) as story_points` -- never stored
- SQLite `IS` operator handles NULL comparisons correctly for duplicate detection: `depends_on_milestone_id IS ?` works for both NULL and non-NULL values
- MilestoneWithCoordinatorColumns type already extends Milestone which has story_points?, so no type changes needed
- CreateMilestoneDependencySchema uses `.refine()` to require at least one of depends_on_milestone_id/depends_on_task_id
- dependency_type has `.default('finish_to_start')` in validation schema, so it's always present in validated data
- POST milestones previously wrote sprint_id but column didn't exist pre-migration 020; now it does and works correctly
