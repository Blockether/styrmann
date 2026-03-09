# Mission Control workflows

Use this reference when the task involves task execution through Mission Control, workflow redesign, acceptance gates, or supervision.

## Current template intent

- `Simple`: Builder -> Reviewer -> Human Accept & Merge
- `Standard`: Builder -> Tester -> Reviewer -> Human Accept & Merge
- `Strict`: Builder -> Tester -> Reviewer Verification -> Reviewer Final Review -> Human Accept & Merge

Human approval is not a workflow worker role. It is an explicit acceptance action.

## Required mental model

1. Agents do the implementation work in the workspace git repo.
2. Work should happen on a task branch.
3. Branch/changes visibility must be tied back to the task.
4. Final completion happens through explicit human acceptance.
5. Acceptance merges to `main`/`master`.
6. Merge conflict or human rejection loops the task back to the start.

## Files and APIs that matter

- `src/lib/workflow-templates.ts`
- `src/lib/workflow-engine.ts`
- `src/lib/dispatch.ts`
- `src/app/api/tasks/[id]/route.ts`
- `src/app/api/tasks/[id]/accept/route.ts`
- `src/app/api/tasks/[id]/fail/route.ts`
- `src/app/api/tasks/[id]/changes/route.ts`
- `src/app/api/tasks/[id]/test/route.ts`

## Supervision checklist

When the user says to execute through MC or supervise a run:

1. Resolve workspace.
2. Choose the right workflow deliberately.
3. Create the task with sharp acceptance criteria.
4. Assign roles explicitly.
5. Dispatch.
6. Monitor:
   - task status
   - task activities
   - OpenClaw session state
   - agent logs
   - changes/deliverables/resources
7. At review/verification, drive one of two outcomes:
   - `Accept & Merge`
   - `Raise Problem`

## Failure model

- Testing failure -> back to builder start
- Reviewer/verification failure -> back to builder start
- Merge conflict on acceptance -> back to builder start with conflict reason
- Missing builder evidence -> block forward movement

## Good defaults

- Use `Simple` for small UI or layout fixes.
- Use `Standard` for normal product/code work.
- Use `Strict` for risky production behavior, migrations, or workflow-critical changes.
