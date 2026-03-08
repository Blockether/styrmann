# Mission Control Skill

This file defines the operational contract for agents working through Mission Control.

## Execution Contract

- Use workspace repo as source of truth.
- Write task artifacts to `<workspace-repo>/.mission-control/tasks/<task-id>`.
- Keep pipeline artifacts in that path so downstream stages read the same data.
- Do not use ad-hoc directories outside `.mission-control` for task outputs.

## Task Progression Gate

- Builder-owned tasks cannot advance to `testing`, `review`, `verification`, or `done` without evidence.
- Valid evidence is either:
  - at least one file deliverable, or
  - at least one git commit in the workspace repo since task creation.

## Session and Traceability

- Every dispatch must be traceable to an OpenClaw session.
- Dispatch invocation is logged in task activities as `dispatch_invocation` with metadata:
  - `openclaw_session_id`
  - `session_key`
  - `trace_url`
  - `output_directory`
  - full invocation payload
- Use task session trace endpoint to inspect full execution:
  - `GET /api/tasks/{taskId}/sessions/{sessionId}/trace`

## API Paths to Prefer

- Sessions list: `GET /api/tasks/{id}/sessions`
- Session trace: `GET /api/tasks/{id}/sessions/{sessionId}/trace`
- Task changes summary: `GET /api/tasks/{id}/changes`
- Deliverables: `GET/POST /api/tasks/{id}/deliverables`
- Activities: `GET/POST /api/tasks/{id}/activities`

Legacy route `GET/POST /api/tasks/{id}/subagent` remains for compatibility, but session-centric paths are preferred.
