# Spike: Incorporate Datalaga Concepts into SQLite-Native Styrmann

## Executive Summary

This spike extracts 5 concepts from Datalaga's Datalevin EAV memory system and proposes native SQLite implementations for Styrmann. The design preserves Datalaga's relationship-rich retrieval patterns while leveraging Styrmann's existing relational schema and migration system.

**Key finding**: Datalaga's power comes from its graph traversal and relationship-first query patterns, not from Datalevin itself. The same patterns translate cleanly to SQLite junction tables + recursive CTEs, while gaining the benefits of Styrmann's existing task/agent/session infrastructure.

---

## Concept Mapping: Datalaga → Styrmann

| Datalaga Concept | Datalaga Implementation | Styrmann Proposal |
|---|---|---|
| **Linkings** | `:link` entity with `from`, `to`, `type`, `evidence` | `entity_linkings` table — general-purpose typed relations |
| **Learnings** | `:decision`, `:observation`, `:note` entities | `project_learnings` table — workspace-scoped knowledge |
| **Memory** | Session-scoped entities + `entity/refs` | `agent_memories` table — per-agent operational knowledge |
| **Code Context** | `:file`, `:symbol`, `:patch` entities | `task_code_context` table — file/commit tracking per task |
| **Acceptance Evaluation** | `:error` + `:link` with `resolved_by` type | `acceptance_evidence` table — evidence linked to criteria |

---

## 1. LINKINGS — General-Purpose Entity Relations

### Datalaga Pattern
Datalaga's `:link` entity type creates explicit semantic relationships between any two entities:
```clojure
{:link/from [:entity/id "error:claims-missing-role"]
 :link/to   [:entity/id "decision:normalize-claims-in-middleware"]
 :link/type :motivated
 :link/explanation "The failing claims test directly motivated the middleware normalization decision."
 :link/evidence ["tool-run:claims-e2e-failure" "observation:claims-normalized-in-handler"]}
```

### Styrmann Translation

**Table: `entity_linkings`**

Extends beyond `task_dependencies` (which only handles task→task blocking) to support any entity-to-entity relationship.

```sql
CREATE TABLE entity_linkings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,    -- 'task', 'agent', 'criteria', 'learning', 'memory', 'code_context'
  source_id TEXT NOT NULL,      -- FK reference to source entity
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  link_type TEXT NOT NULL,      -- 'depends_on', 'motivated', 'justifies', 'resolved_by',
                                -- 'follow_up_for', 'related_to', 'evidence_for', 'learned_from'
  explanation TEXT,
  metadata TEXT,                -- JSON for evidence IDs, confidence, etc.
  created_by TEXT,              -- agent_id or 'system'
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_linkings_source ON entity_linkings(source_type, source_id);
CREATE INDEX idx_linkings_target ON entity_linkings(target_type, target_id);
CREATE INDEX idx_linkings_workspace ON entity_linkings(workspace_id);
CREATE INDEX idx_linkings_type ON entity_linkings(link_type);
```

**Link types (initial set):**
- `depends_on` — task-to-task, supersedes `task_dependencies` for richer context
- `motivated` — error→decision, learning→action
- `justifies` — decision→code change
- `resolved_by` — error→fix, criteria→evidence
- `follow_up_for` — note→previous work
- `related_to` — general association
- `evidence_for` — deliverable→criteria, test result→criteria
- `learned_from` — learning→task/error/observation

### Coexistence with `task_dependencies`

`task_dependencies` remains for **hard dispatch blocking** (enforcement). `entity_linkings` is for **contextual relationships** (informational). No migration needed — they serve different purposes.

---

## 2. PROJECT LEARNINGS — What Worked, What Failed, Why

### Datalaga Pattern
Datalaga captures learnings through three entity types:
- `:decision` — rationale, outcome, alternatives, related files/symbols
- `:observation` — confidence-scored findings linked to tool runs
- `:note` — free-form knowledge with entity references

The key Datalaga query is `prior-decisions-for-task`: given a task's touched files, find all prior decisions that also touched those files, ordered by recency.

### Styrmann Translation

**Table: `project_learnings`**

```sql
CREATE TABLE project_learnings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  session_id TEXT,
  learning_type TEXT NOT NULL CHECK (learning_type IN (
    'decision', 'observation', 'pattern', 'failure', 'success', 'caveat'
  )),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,                    -- rationale, alternatives, evidence
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  tags TEXT,                      -- JSON array of tags
  related_file_paths TEXT,        -- JSON array of file paths
  related_task_ids TEXT,          -- JSON array of task IDs
  metadata TEXT,                  -- JSON for extra structured data
  is_active INTEGER DEFAULT 1,   -- soft delete / archive
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_learnings_workspace ON project_learnings(workspace_id, created_at DESC);
CREATE INDEX idx_learnings_task ON project_learnings(task_id);
CREATE INDEX idx_learnings_type ON project_learnings(learning_type);
CREATE INDEX idx_learnings_active ON project_learnings(workspace_id, is_active);
```

**Learning types:**
- `decision` — architectural choice with rationale (from Datalaga's `:decision`)
- `observation` — finding with confidence score (from Datalaga's `:observation`)
- `pattern` — recurring pattern discovered across tasks
- `failure` — what went wrong and why (post-mortem)
- `success` — what worked well (positive reinforcement)
- `caveat` — known gotcha or follow-up needed (from Datalaga's `:note`)

### Surfacing During Dispatch

The key innovation from Datalaga: **prior decisions for task**. Implemented as a SQL query:

```sql
-- Find learnings relevant to files this task will touch
SELECT pl.*
FROM project_learnings pl
WHERE pl.workspace_id = ?
  AND pl.is_active = 1
  AND pl.created_at < ?  -- only prior learnings
  AND EXISTS (
    SELECT 1
    FROM json_each(pl.related_file_paths) plf
    INNER JOIN json_each(?) tf  -- task's touched file paths
      ON plf.value = tf.value
  )
ORDER BY pl.created_at DESC
LIMIT 10;
```

---

## 3. MEMORY — Per-Agent Operational Knowledge

### Datalaga Pattern
Datalaga stores per-agent knowledge through session-scoped entities. Each session is tied to an agent via `:session/agent`, and all entities within that session form the agent's operational memory. The retrieval uses graph traversal (BFS with configurable hops) around anchor entities.

### Styrmann Translation

**Table: `agent_memories`**

This is NOT identity (that stays in SOUL.md). This is operational knowledge — things the agent learned while working.

```sql
CREATE TABLE agent_memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN (
    'skill', 'preference', 'pattern', 'context', 'tool_usage', 'codebase_knowledge'
  )),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  relevance_tags TEXT,            -- JSON array for matching
  recall_count INTEGER DEFAULT 0,
  last_accessed_at TEXT,
  expires_at TEXT,                -- optional TTL
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_memories_agent ON agent_memories(agent_id, created_at DESC);
CREATE INDEX idx_memories_agent_workspace ON agent_memories(agent_id, workspace_id);
CREATE INDEX idx_memories_type ON agent_memories(memory_type);
```

**Memory types:**
- `skill` — "I learned how to use X tool effectively"
- `preference` — "This codebase uses tabs, not spaces" / "Tests are in `__tests__/`"
- `pattern` — "Error handling follows this pattern in this repo"
- `context` — "The auth module was recently refactored (task AUTH-142)"
- `tool_usage` — "Running `npm test` requires NODE_ENV=test"
- `codebase_knowledge` — "The config lives in `src/config/` and uses Zod validation"

### Query During Dispatch

```sql
-- Get relevant memories for agent + workspace
SELECT am.*
FROM agent_memories am
WHERE am.agent_id = ?
  AND (am.workspace_id = ? OR am.workspace_id IS NULL)
  AND (am.expires_at IS NULL OR am.expires_at > datetime('now'))
ORDER BY am.recall_count DESC, am.updated_at DESC
LIMIT 15;
```

On recall, bump the counter:
```sql
UPDATE agent_memories
SET recall_count = recall_count + 1,
    last_accessed_at = datetime('now')
WHERE id IN (?);
```

---

## 4. CODE CONTEXT — File Paths, Commits, Change Summaries

### Datalaga Pattern
Datalaga tracks code through three entity types:
- `:file` — file identity with path, module, language, contained symbols
- `:symbol` — function/class identity with qualified name, signature, kind
- `:patch` — commit hash, diff summary, modified files/symbols, linked decision

The power comes from cross-referencing: "What prior decisions touched files that this task is about to modify?"

### Styrmann Translation

**Table: `task_code_context`**

```sql
CREATE TABLE task_code_context (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  commit_sha TEXT,
  change_summary TEXT,
  change_type TEXT CHECK (change_type IN ('created', 'modified', 'deleted', 'referenced')),
  language TEXT,
  symbols TEXT,                   -- JSON array of symbol names touched in this file
  diff_stats TEXT,                -- JSON: {additions, deletions, hunks}
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_code_context_task ON task_code_context(task_id);
CREATE INDEX idx_code_context_workspace ON task_code_context(workspace_id);
CREATE INDEX idx_code_context_file ON task_code_context(file_path);
CREATE INDEX idx_code_context_commit ON task_code_context(commit_sha);
```

### Impact Analysis Queries

```sql
-- Find other tasks that touched the same files (for impact analysis)
SELECT DISTINCT t.id, t.title, t.status, tcc2.change_summary
FROM task_code_context tcc1
INNER JOIN task_code_context tcc2 ON tcc1.file_path = tcc2.file_path
INNER JOIN tasks t ON tcc2.task_id = t.id
WHERE tcc1.task_id = ?        -- current task
  AND tcc2.task_id != ?       -- exclude current
  AND tcc2.workspace_id = ?
ORDER BY tcc2.created_at DESC
LIMIT 10;

-- Find learnings related to files this task touches
SELECT pl.*
FROM project_learnings pl, task_code_context tcc
WHERE tcc.task_id = ?
  AND pl.workspace_id = tcc.workspace_id
  AND pl.is_active = 1
  AND EXISTS (
    SELECT 1
    FROM json_each(pl.related_file_paths) plf
    WHERE plf.value = tcc.file_path
  )
ORDER BY pl.created_at DESC
LIMIT 5;
```

### Auto-Population

Code context can be populated from:
1. **Agent completion webhook** — parse `TASK_COMPLETE` for file paths
2. **Trace analysis** — scan session trace for write/edit tool calls (already done for deliverables)
3. **Git diff** — `git diff` on the task worktree branch vs base
4. **Agent self-report** — agent posts to `/api/tasks/{id}/code-context` endpoint

---

## 5. ACCEPTANCE CRITERIA EVALUATION — Evidence Linking

### Datalaga Pattern
Datalaga's acceptance evaluation is implicit via entity relationships:
1. Error detected → `:error` entity with `:error/tool-run` reference
2. Evidence gathered → `:observation` entity linked to tool run
3. Decision made → `:decision` entity with rationale
4. Fix applied → `:patch` entity with commit, linked to decision
5. Resolution → `:link` entity with `link_type = resolved_by`

Failure views exclude errors with status `:resolved` or `:closed`.

### Styrmann Translation

**Table: `acceptance_evidence`**

Links evidence to acceptance criteria (extends existing `task_acceptance_criteria`).

```sql
CREATE TABLE acceptance_evidence (
  id TEXT PRIMARY KEY,
  criteria_id TEXT NOT NULL REFERENCES task_acceptance_criteria(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'test_result', 'deliverable', 'code_change', 'activity',
    'manual_verification', 'artifact'
  )),
  evidence_ref_id TEXT,           -- FK to task_deliverables, task_activities, task_code_context, etc.
  evidence_ref_type TEXT,         -- which table the ref points to
  summary TEXT NOT NULL,
  is_positive INTEGER DEFAULT 1,  -- 1 = supports criteria, 0 = contradicts
  verified_by TEXT,               -- agent_id or 'human'
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_evidence_criteria ON acceptance_evidence(criteria_id);
CREATE INDEX idx_evidence_task ON acceptance_evidence(task_id);
CREATE INDEX idx_evidence_type ON acceptance_evidence(evidence_type);
```

### Richer Criteria Evaluation Query

```sql
-- Evaluate acceptance criteria with linked evidence
SELECT
  tac.id AS criteria_id,
  tac.description,
  tac.is_met,
  tac.gate_type,
  tac.artifact_key,
  COUNT(ae.id) AS evidence_count,
  SUM(CASE WHEN ae.is_positive = 1 THEN 1 ELSE 0 END) AS positive_evidence,
  SUM(CASE WHEN ae.is_positive = 0 THEN 1 ELSE 0 END) AS negative_evidence,
  -- Auto-evaluate: criteria is met if gate_type matches
  CASE
    WHEN tac.gate_type = 'artifact' AND EXISTS (
      SELECT 1 FROM task_artifacts ta
      WHERE ta.task_id = tac.task_id AND ta.artifact_key = tac.artifact_key
    ) THEN 1
    WHEN tac.gate_type = 'test' AND EXISTS (
      SELECT 1 FROM acceptance_evidence ae2
      WHERE ae2.criteria_id = tac.id AND ae2.evidence_type = 'test_result' AND ae2.is_positive = 1
    ) THEN 1
    WHEN tac.gate_type = 'verifier' AND EXISTS (
      SELECT 1 FROM acceptance_evidence ae3
      WHERE ae3.criteria_id = tac.id AND ae3.evidence_type = 'manual_verification' AND ae3.is_positive = 1
    ) THEN 1
    ELSE tac.is_met
  END AS computed_is_met
FROM task_acceptance_criteria tac
LEFT JOIN acceptance_evidence ae ON ae.criteria_id = tac.id
WHERE tac.task_id = ?
GROUP BY tac.id
ORDER BY tac.sort_order ASC;
```

---

## Dispatch Integration Design

### Current Dispatch Context Assembly (dispatch.ts)

```
dispatchTaskToAgent(taskId)
  ├─ Load task + agent
  ├─ buildResourceContext(taskId)          ← existing
  ├─ Load acceptance_criteria               ← existing
  ├─ Build taskMessage:
  │   ├─ Title + metadata
  │   ├─ planningSpecSection
  │   ├─ agentInstructionsSection
  │   ├─ resourceSection
  │   ├─ 🆕 learningsSection              ← NEW INJECTION
  │   ├─ 🆕 memorySection                 ← NEW INJECTION
  │   ├─ 🆕 codeContextSection            ← NEW INJECTION
  │   ├─ Runtime contract
  │   └─ Completion instructions
  └─ dispatchToOpenCode()
```

### New Context Builder Functions

**`buildLearningsContext(taskId, workspaceId)`**

Queries `project_learnings` for:
1. Learnings linked to files the current task will touch (via `task_code_context` or `entity_linkings`)
2. Learnings from the same milestone/sprint scope
3. Recent high-confidence observations for the workspace

Output format:
```markdown
**RELEVANT PROJECT LEARNINGS:**
1. [decision] Normalize claims in middleware (confidence: 95)
   → Rationale: Normalization in login! fixed direct login but missed SSO callbacks.
   → Related files: src/auth/middleware.clj, src/web/login_handler.clj

2. [caveat] Older websocket handshake code still bypasses the new middleware path.
   → Follow up on websocket handshake auth.

3. [failure] Password reset left stale refresh sessions alive.
   → refresh-session did not compare stored generation against revoked generation.
```

**`buildMemoryContext(agentId, workspaceId)`**

Queries `agent_memories` for the assigned agent + workspace.

Output format:
```markdown
**AGENT MEMORY (operational knowledge):**
- [codebase_knowledge] Config uses Zod validation in src/config/
- [tool_usage] Running tests requires: NODE_ENV=test npm test
- [pattern] Error handling follows try/catch with custom AppError class
```

**`buildCodeContextSection(taskId, workspaceId)`**

Queries `task_code_context` for related tasks, and `entity_linkings` for code relationships.

Output format:
```markdown
**CODE CONTEXT:**
- Recent changes to these files:
  - src/auth/session.clj: Modified in AUTH-142 (session generation check added)
  - src/auth/service.clj: Modified in AUTH-142 (password reset flow updated)
- Related completed tasks: AUTH-155, AUTH-142 (same file scope)
```

### Prompt Size Budget

Target: **≤500 tokens** for all three new sections combined. This keeps the dispatch prompt manageable. Truncation strategy:
- Max 5 learnings (most relevant, highest confidence)
- Max 8 memory items (most recalled, most recent)
- Max 5 code context items (most recent changes to overlapping files)

---

## API Endpoints (Proposed)

### Learnings
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/workspaces/{id}/learnings` | List learnings (filter: type, tags, file_paths) |
| POST | `/api/workspaces/{id}/learnings` | Create learning |
| PATCH | `/api/learnings/{id}` | Update learning |
| DELETE | `/api/learnings/{id}` | Archive learning (soft delete) |

### Agent Memories
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/agents/{id}/memories` | List agent memories (filter: workspace, type) |
| POST | `/api/agents/{id}/memories` | Create memory |
| PATCH | `/api/memories/{id}` | Update memory |
| DELETE | `/api/memories/{id}` | Delete memory |

### Code Context
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/tasks/{id}/code-context` | List code context for task |
| POST | `/api/tasks/{id}/code-context` | Add code context entry |
| DELETE | `/api/tasks/{id}/code-context/{entryId}` | Remove entry |

### Evidence
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/tasks/{id}/acceptance-evidence` | List evidence for task criteria |
| POST | `/api/tasks/{id}/acceptance-evidence` | Link evidence to criteria |

### Linkings
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/workspaces/{id}/linkings` | List linkings (filter: source, target, type) |
| POST | `/api/workspaces/{id}/linkings` | Create linking |
| DELETE | `/api/linkings/{id}` | Remove linking |

---

## Agent Write-Back Contract

Agents should record learnings and memories as they work. Add to dispatch prompt instructions:

```markdown
**MEMORY & LEARNINGS CONTRACT:**
- Record key decisions via POST /api/workspaces/{workspace_id}/learnings
  Body: {"learning_type": "decision", "title": "...", "summary": "...", "related_file_paths": [...]}
- Record operational knowledge via POST /api/agents/{agent_id}/memories
  Body: {"memory_type": "codebase_knowledge", "title": "...", "content": "..."}
- Record code context via POST /api/tasks/{task_id}/code-context
  Body: {"file_path": "...", "commit_sha": "...", "change_summary": "...", "change_type": "modified"}
- Link evidence to acceptance criteria via POST /api/tasks/{task_id}/acceptance-evidence
  Body: {"criteria_id": "...", "evidence_type": "test_result", "summary": "All tests pass"}
```

---

## Implementation Priority

| Phase | Tables | Effort | Value |
|-------|--------|--------|-------|
| **P0** | `project_learnings` + dispatch injection | 1-2 days | Highest — agents benefit from past context immediately |
| **P1** | `entity_linkings` + `task_code_context` | 1-2 days | High — enables cross-task context and impact analysis |
| **P2** | `agent_memories` + dispatch injection | 1 day | Medium — agent continuity across sessions |
| **P3** | `acceptance_evidence` + evaluation queries | 1 day | Medium — richer acceptance evaluation |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Prompt bloat from too many learnings/memories | Hard token budget (≤500 tokens), relevance scoring, pagination |
| Stale learnings polluting context | `is_active` flag, confidence decay, `expires_at` for memories |
| Agent write-back compliance | Include contract in dispatch prompt, validate via completion webhook |
| Schema migration on production DB | Standard Styrmann migration pattern (migration 053), FK checks disabled during migration |
| Performance of JSON `json_each()` queries | SQLite handles this well for reasonable sizes; add indexes on common paths |

---

## Verification Against Styrmann Codebase

Verified during spike (2026-03-14):

| Check | Result |
|-------|--------|
| FK references (workspaces, tasks, agents, task_acceptance_criteria) | ✅ All tables exist in schema.ts |
| Migration system compatibility (id/name/up pattern) | ✅ Matches migration 001-052 pattern exactly |
| DB access pattern (queryAll, queryOne, run from @/lib/db) | ✅ Consistent with all existing lib/ modules |
| UUID generation (uuid v4) | ✅ Same pattern as dispatch.ts, seed.ts |
| No conflict with removed knowledge_entries (migration 046) | ✅ All tables/indexes use distinct names |
| Index naming conventions | ✅ Follows existing idx_tablename_column pattern |
| JSON storage pattern (TEXT columns with json_each queries) | ✅ Consistent with planning_messages, planning_spec, etc. |
| ON DELETE behavior | ✅ CASCADE for owned entities, SET NULL for optional refs |
| Dispatch injection point (dispatch.ts L738-752) | ✅ New sections insert into taskMessage template literal |
| Agent memory_md column exists (migration 030) | ✅ MEMORY.md managed separately from agent_memories table |

### Dispatch Integration Point (Exact Location)

In `src/lib/dispatch.ts`, the `taskMessage` is assembled at line ~738. The Datalaga context sections should be injected between `resourceSection` and the `RUNTIME CONTRACT` block:

```typescript
// In dispatch.ts, around line 738:
const datalagaContext = buildDatalagaContextSections(task.id, agent.id, task.workspace_id);

const taskMessage = `[${priorityLabel}] **...**
...
${planningSpecSection}${agentInstructionsSection}${resourceSection}${datalagaContext}
**RUNTIME CONTRACT:**
...`;
```

### Coexistence Notes

- `task_dependencies` → kept for **hard dispatch blocking** (enforcement gate)
- `entity_linkings` → new, for **contextual relationships** (informational, surfaced in prompts)
- `agent-learning.ts` → existing, syncs MEMORY.md file. `agent_memories` table stores structured operational knowledge separately
- `knowledge_entries` → removed in migration 046. Our tables use entirely different names and purposes
- `builder-evidence.ts` → existing, checks git commits + workspace files. `acceptance_evidence` provides richer criteria-level evidence linking

---

## Files Delivered

1. `spike-design.md` — This document (concept mapping, schema design, integration design, API endpoints, risks)
2. `migration-053.sql` — Complete standalone migration SQL (5 tables, 17 indexes)
3. `migration-053-entry.ts` — TypeScript migration entry ready to paste into Styrmann's migrations.ts
4. `types.ts` — TypeScript interfaces for all 5 entity types + input types
5. `query-utils.ts` — CRUD + query functions using Styrmann's DB access patterns
6. `dispatch-context.ts` — Dispatch prompt context builders (learnings, memory, code context)
