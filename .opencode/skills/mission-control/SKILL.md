---
name: mission-control
description: "Mission Control project skill for workspace-scoped implementation, workflow supervision, OpenClaw integration, task execution through MC, UI fixes, and safe deploys. Use when changing this repo, creating/supervising tasks in Mission Control, working with workflows/acceptance gates, or touching OpenClaw-backed agents."
version: "0.1.0"
license: Apache-2.0
compatibility: opencode
---

# Mission Control

Use this skill when working on `/root/repos/blockether/mission-control` itself.

This skill is for:
- implementing or debugging Mission Control features
- operating through Mission Control task/workflow APIs instead of ad-hoc local edits when the user wants work executed via MC
- updating workflow templates, acceptance gates, task lifecycle behavior, or task supervision
- working with OpenClaw-synced agents, agent prompts, `SOUL.md` / `USER.md` / `AGENTS.md` / `MEMORY.md`
- making UI changes that must respect the Blockether design system and mobile behavior
- deploying or validating the running production instance safely

Do not load this skill for unrelated repositories.

## Trigger phrases

Load this skill when the user asks any of the following kinds of things:
- "fix Mission Control"
- "create a task through MC"
- "supervise the run"
- "update workflows / acceptance / review / merge flow"
- "work with OpenClaw agents"
- "deploy Mission Control"
- "fix mobile UI / modal / task view / workflow view"
- "why is this task stuck / why didn't the handoff happen"

## Working model

Mission Control is not just a dashboard. It is the control plane for:
- task creation and stage progression
- role-based agent handoff
- acceptance criteria and human acceptance
- OpenClaw agent sync and session supervision
- task deliverables, changes, runs, resources, and traces

Prefer changing or using Mission Control's own APIs and workflow machinery instead of bypassing them.

## Core operating rules

1. Stay workspace-scoped.
   - Work only in the current Mission Control workspace/repo.
   - Never leak credentials or inspect unrelated repositories.

2. Prefer Mission Control-native flows.
   - If the user wants work executed through MC, create/update a task, assign workflow + roles, dispatch, and supervise.
   - Use direct local edits only when the request is explicitly about changing the Mission Control codebase itself.

3. Respect the current workflow model.
   - Templates are agent-driven stages.
   - Human approval is an explicit acceptance gate, not a workflow worker role.
   - Agents must not mark tasks done directly; human acceptance merges or raises a problem.

4. Use OpenClaw correctly.
   - Gateway/RPC first when available.
   - Host-level fallback only when RPC is unavailable or fails.
   - Agent-scoped learnings belong in `MEMORY.md`, not `SOUL.md`.

5. Keep UI work mobile-safe.
   - Avoid horizontal overflow.
   - Use wrapping and helper text instead of oversized option labels.
   - Preserve `data-component` traceability on every React component root.

6. Verify every meaningful change.
   - Always run `npx tsc --noEmit`, `npm run build`, and usually `./scripts/check.sh`.
   - For deploys, always use `/root/repos/blockether/mission-control/scripts/deploy.sh`.

## Blockether project rules

- Absolute paths only.
- Light theme only; use Blockether cream/gold `mc-*` palette.
- Tailwind only.
- Lucide React icons only.
- Fonts: IBM Plex Mono for headings, Atkinson Hyperlegible for body.
- Toolbars: title left, controls right.
- Mobile: `flex-wrap`, text labels hidden with `hidden sm:inline` where appropriate.
- Modal actions live in top-bordered compact footers.
- Dropdowns with long descriptions must use helper text below the field, never verbose `<option>` text.

## Default execution patterns

### 1. Code change in Mission Control

Use this path for UI bugs, API changes, workflow logic, DB changes, and OpenClaw integration fixes.

Checklist:
- read `AGENTS.md`
- inspect relevant code and existing patterns first
- make the smallest coherent change
- preserve workspace-scoped behavior
- run diagnostics + typecheck + build + `./scripts/check.sh`
- deploy with `/root/repos/blockether/mission-control/scripts/deploy.sh` when requested

### 2. Execute work through Mission Control

Use this path when the user says to create a task, run via MC, or supervise execution.

Checklist:
- resolve workspace
- choose the right workflow template
- create a task with crisp title, description, and acceptance criteria
- assign the correct agents/roles
- dispatch and supervise activities, sessions, logs, and status changes
- use acceptance gate at the end: human accepts and merges, or raises a problem to loop back

### 3. Workflow or acceptance redesign

Checklist:
- inspect `src/lib/workflow-templates.ts`
- inspect `src/lib/workflow-engine.ts`
- inspect `src/app/api/tasks/[id]/route.ts`, `fail`, `test`, `accept`, and `changes`
- keep stage ownership agent-only
- keep human approval explicit and auditable
- ensure loopback on failure/conflict returns to builder start

### 4. OpenClaw agent work

Checklist:
- inspect `src/lib/openclaw/config.ts`, `src/lib/openclaw/sync.ts`, `src/app/api/agents/route.ts`
- treat synced files as source of truth
- keep identity in `SOUL.md`
- keep durable lessons in `MEMORY.md`
- verify sync back into DB/API

## Workflow template intent

Current meaningful templates:

- `Simple`
  - Builder -> Reviewer -> Human Accept & Merge
  - Use for small, straightforward fixes

- `Standard`
  - Builder -> Tester -> Reviewer -> Human Accept & Merge
  - Use for most product/code changes

- `Strict`
  - Builder -> Tester -> Reviewer Verification -> Reviewer Final Review -> Human Accept & Merge
  - Use for risky or production-critical work

If a template does not fit the task, explain why and update the template or choose a better one deliberately.

## Examples

### Example: user wants work done through MC

User:
> Create a task for the mobile overflow bug, use Simple workflow, and supervise the run.

What to do:
- create the task in MC
- attach acceptance criteria
- assign `Denis | Builder` as builder
- dispatch the task
- monitor activities/sessions/logs
- report current run state back to the user

### Example: user wants workflow changes

User:
> Remove human verifier role from templates and make final approval a user merge action.

What to do:
- update hardcoded templates
- migrate existing DB templates
- add explicit accept/reject API and UI actions
- enforce that agents cannot mark tasks done directly
- make merge conflicts loop back into the task workflow

### Example: user wants an agent to learn

User:
> Scope learnings per agent and update the OpenClaw agent with them.

What to do:
- store learning with `agent_id`
- prioritize agent-scoped knowledge during dispatch
- sync durable learnings into that agent's `MEMORY.md`
- do not pollute `SOUL.md` with operational lessons

## Anti-patterns

Do not:
- bypass Mission Control workflows when the request is explicitly to operate through MC
- put verbose descriptions into dropdown options
- treat `review` as an agentless black hole without clear human acceptance semantics
- write learned operational behavior into `SOUL.md`
- deploy via manual service commands instead of `scripts/deploy.sh`
- assume production behavior without checking activities, sessions, traces, or health endpoints
- use broad repo-agnostic advice when the codebase already has strong local conventions

## Reference map

- `refs/WORKFLOWS.md` — stage model, acceptance gate, supervision flow
- `refs/OPERATIONS.md` — build, check, deploy, and production validation
- `AGENTS.md` — project rules, deploy path, styling, traceability
- `KNOWLEDGE.md` — broader architecture context (validate against code if behavior changed recently)
- `src/lib/workflow-templates.ts` — canonical workflow definitions
- `src/lib/workflow-engine.ts` — stage transitions and fail-loopback
- `src/lib/dispatch.ts` — agent prompt construction and task dispatch
- `src/lib/openclaw/config.ts` — synced agent files and config resolution
- `src/lib/openclaw/sync.ts` — sync behavior
- `src/app/api/tasks/[id]/route.ts` — task update and status-change enforcement
- `src/app/api/tasks/[id]/accept/route.ts` — human acceptance merge/reject path
- `src/app/api/tasks/[id]/changes/route.ts` — task branch/change visibility
- `src/app/api/agents/route.ts` — OpenClaw-backed agent provisioning

## Success criteria for using this skill

You are using this skill correctly when you:
- choose MC-native task/workflow operations when appropriate
- preserve Blockether UI/system conventions
- keep work and evidence scoped to the active workspace
- use the correct human acceptance gate model
- verify changes with build/typecheck/check before reporting success

## Load deeper references only when needed

- For task/workflow supervision or redesign, read `refs/WORKFLOWS.md`.
- For deploys, validation, and production-safe execution, read `refs/OPERATIONS.md`.
- For broader repo architecture, use `KNOWLEDGE.md`, but prefer live code when behavior changed recently.
