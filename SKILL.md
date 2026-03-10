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

## Auto-Train Loop

- `task_type='autotrain'` means the task is a continuous improvement loop for one workspace repo.
- The task description is the supervisor prompt.
- Optional control: include `MAX_ITERATIONS: N` in the prompt.
- Optional learning control: include `EVOLVE_AGENT_PROMPTS: true` in the prompt to have Auto-Train append lessons into the assigned agent's `SOUL.md` and `AGENTS.md` each iteration.
- Manual supervisor controls are available in Task Modal:
  - **Start Loop** writes `AUTOTRAIN_RESUME` and sets status to `assigned` when needed.
  - **Stop Loop** writes `AUTOTRAIN_STOP`; daemon stops re-looping on that signal.
- The daemon reopens completed autotrain tasks for the next iteration automatically.
- Each iteration must:
  - inspect one improvement area,
  - write a proposal under `.mission-control/tasks/<task-id>/iter-<n>/proposal.md`,
  - implement one focused improvement,
  - verify using repo checks,
  - report back through activities and deliverables.
- Never work outside the task workspace repo.
- Never expose credentials, secrets, tokens, or `.env` contents.

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

## Local Tools to Prefer

- Use in-process MCP endpoint first: `POST /api/mcp` (JSON-RPC methods: `initialize`, `tools/list`, `tools/call`).
- Use direct REST API calls only as fallback when MCP is unavailable.
- Use `/root/repos/blockether/mission-control/scripts/openclaw-acp` for ACP bridge calls with `--provenance meta+receipt` preconfigured.
