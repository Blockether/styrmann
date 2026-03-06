# Decisions -- hierarchy-agent-restructure

## 2026-03-06

### D1: Milestone sprint_id nullable
Tasks CAN exist without milestones (milestone_id nullable). Milestones CAN exist without a sprint (sprint_id nullable). This supports planning phase and backlog.

### D2: Backlog = milestone_id IS NULL
Backlog tasks are those with no milestone. Previously sprint_id IS NULL. Query must be updated everywhere.

### D3: Milestone dependencies informational only (v1)
Dependencies shown in UI but do NOT block task dispatch. Pure informational badge.

### D4: Story points = computed at read time
Never stored on milestone. Always `SELECT COALESCE(SUM(effort), 0) FROM tasks WHERE milestone_id = m.id` at query time.

### D5: Learner agent kept as-is
Not mentioned in user's role list but not explicitly removed. Keep Learner + knowledge_entries table intact.

### D6: Queue drain scope unchanged
drainQueue() stays workspace-scoped. Not changed to milestone-scoped.

### D7: task.sprint_id removed
Tasks get sprint context via milestone.sprint_id. No direct sprint FK on tasks.

### D8: PO demotion blocked
Cannot change orchestrator's role via PATCH. Must delete + recreate. Returns 400 on demotion attempt.

### D9: Human Verifier = queue stage label only
Status value `review` stays unchanged in DB. Only the workflow template JSON `label` field changes from "Review" to "Human Verifier".

### D10: Orchestrator not a workflow worker
Orchestrator must NOT be auto-assigned to workflow stages in populateTaskRolesFromAgents(). It's a manager role, not a worker role. Add guard in fuzzy matching loop.
