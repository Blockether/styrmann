---
name: styrmann
description: "Styrmann project skill for workspace-scoped implementation, workflow supervision, task execution, org-level ticket/sprint/milestone management, UI fixes, and safe deploys. Use when changing this repo, creating tasks or org tickets through Styrmann, working with workflows/acceptance gates, or managing integrations."
version: "0.2.0"
license: Apache-2.0
compatibility: opencode
---

# Styrmann

Use this skill when working on `/root/repos/blockether/styrmann` itself.

This skill is for:
- implementing or debugging Styrmann features
- operating through Styrmann's own APIs to create org tickets, sprints, milestones, and tasks
- updating workflow templates, acceptance gates, task lifecycle behavior, or task supervision
- making UI changes that must respect the Blockether design system and mobile behavior
- deploying or validating the running production instance safely

Do not load this skill for unrelated repositories.

## Trigger phrases

Load this skill when the user asks any of the following kinds of things:
- "fix Styrmann"
- "create a task / ticket / sprint / milestone"
- "delegate via Styrmann"
- "supervise the run"
- "update workflows / acceptance / review / merge flow"
- "deploy Styrmann"
- "fix mobile UI / modal / task view / workflow view"
- "why is this task stuck / why didn't the handoff happen"
- "configure Discord / GitHub / integrations"

## Working model

Styrmann is the control plane for:
- org-level ticket/sprint/milestone management
- workspace task creation and stage progression
- role-based agent handoff
- acceptance criteria and human acceptance
- task deliverables, changes, runs, resources, and traces

Prefer using Styrmann's own APIs and workflow machinery instead of bypassing them.

## API authentication (CRITICAL)

All Styrmann API endpoints require a bearer token when `STYRMAN_API_TOKEN` is set in `.env.local`.

```bash
TOKEN=$(grep STYRMAN_API_TOKEN /root/repos/blockether/styrmann/.env.local | cut -d= -f2-)
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" http://localhost:4000/api/...
```

**Learnings from past failures:**
- Calling the API without the bearer token returns `{"error":"Unauthorized"}` -- always read the token from `.env.local` first.
- The token is stored as `STYRMAN_API_TOKEN` in `.env.local`, NOT as an environment variable in the shell.
- If `STYRMAN_API_TOKEN` is not set at all, auth is disabled (dev mode) and no header is needed.
- Never hardcode or expose the token value in commits or logs.

## Core operating rules

1. Stay workspace-scoped.
   - Work only in the current Styrmann workspace/repo.
   - Never leak credentials or inspect unrelated repositories.

2. Prefer Styrmann-native flows.
   - If the user wants work executed through Styrmann, create org tickets/sprints/milestones via the API, assign workflow + roles, dispatch, and supervise.
   - Use direct local edits only when the request is explicitly about changing the Styrmann codebase itself.

3. Respect the current workflow model.
   - Templates are agent-driven stages.
   - Human approval is an explicit acceptance gate, not a workflow worker role.
   - Agents must not mark tasks done directly; human acceptance merges or raises a problem.

4. Keep UI work mobile-safe.
   - Avoid horizontal overflow.
   - Use wrapping and helper text instead of oversized option labels.
   - Preserve `data-component` traceability on every React component root.

5. Verify every meaningful change.
   - Always run `npx tsc --noEmit`, `npm run build`, and usually `./scripts/check.sh`.
   - For deploys, always use `/root/repos/blockether/styrmann/scripts/deploy.sh`.

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

### 1. Code change in Styrmann

Use this path for UI bugs, API changes, workflow logic, DB changes, and integration fixes.

Checklist:
- read `AGENTS.md`
- inspect relevant code and existing patterns first
- make the smallest coherent change
- preserve workspace-scoped behavior
- run diagnostics + typecheck + build + `./scripts/check.sh`
- deploy with `/root/repos/blockether/styrmann/scripts/deploy.sh` when requested

### 2. Create work items through Styrmann API

Use this path when the user says to create a ticket, sprint, milestone, or task through Styrmann.

**Read `refs/API_RECIPES.md` for complete curl examples and the full auth + creation workflow.**

Quick checklist:
1. Read `STYRMAN_API_TOKEN` from `.env.local`
2. Resolve organization ID via `GET /api/organizations`
3. Create sprint via `POST /api/org-sprints` (if needed)
4. Create milestone via `POST /api/org-milestones` (if needed)
5. Create ticket via `POST /api/org-tickets` with sprint + milestone IDs

### 3. Workflow or acceptance redesign

Checklist:
- inspect `src/lib/workflow-templates.ts`
- inspect `src/lib/workflow-engine.ts`
- inspect `src/app/api/tasks/[id]/route.ts`, `fail`, `test`, `accept`, and `changes`
- keep stage ownership agent-only
- keep human approval explicit and auditable
- ensure loopback on failure/conflict returns to builder start

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

### Example: user wants a ticket created through Styrmann

User:
> Create a ticket for the Discord settings UI feature.

What to do:
1. Read token: `TOKEN=$(grep STYRMAN_API_TOKEN .env.local | cut -d= -f2-)`
2. Get org ID: `curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/organizations`
3. Create ticket: `POST /api/org-tickets` with org ID, title, description, type, priority
4. Report the created ticket ID and title back to the user

### Example: user wants work done through Styrmann

User:
> Create a task for the mobile overflow bug, use Simple workflow, and supervise the run.

What to do:
- create the task via API
- attach acceptance criteria
- assign the correct builder agent
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

## Agent learnings

These are operational lessons from real agent sessions. Do not repeat these mistakes.

### 2026-03-15: API auth failure when creating org tickets

**Problem**: Agent tried to create sprints/milestones/tickets via `curl http://localhost:4000/api/org-sprints` and got `{"error":"Unauthorized"}`. Wasted time debugging.

**Root cause**: The skill told the agent to "create a task" but never documented:
1. That auth is required (bearer token)
2. Where the token lives (`.env.local` as `STYRMAN_API_TOKEN`)
3. The exact curl syntax with auth headers
4. The API endpoint paths for org-level resources

**Fix**: Always read `STYRMAN_API_TOKEN` from `.env.local` first. See `refs/API_RECIPES.md` for complete patterns.

**Lesson for skill authors**: If a skill says "do X via API", it MUST include the auth pattern and concrete curl examples. Abstract instructions like "create a task with crisp title" are useless without the HTTP details.

## Anti-patterns

Do not:
- call Styrmann API endpoints without reading `STYRMAN_API_TOKEN` from `.env.local` first
- bypass Styrmann workflows when the request is explicitly to operate through Styrmann
- put verbose descriptions into dropdown options
- treat `review` as an agentless black hole without clear human acceptance semantics
- deploy via manual service commands instead of `scripts/deploy.sh`
- assume production behavior without checking activities, sessions, traces, or health endpoints
- use broad repo-agnostic advice when the codebase already has strong local conventions

## Reference map

- `refs/API_RECIPES.md` -- auth pattern, curl examples for creating sprints/milestones/tickets
- `refs/WORKFLOWS.md` -- stage model, acceptance gate, supervision flow
- `refs/OPERATIONS.md` -- build, check, deploy, and production validation
- `AGENTS.md` -- project rules, deploy path, styling, traceability
- `KNOWLEDGE.md` -- broader architecture context (validate against code if behavior changed recently)
- `src/lib/workflow-templates.ts` -- canonical workflow definitions
- `src/lib/workflow-engine.ts` -- stage transitions and fail-loopback
- `src/lib/dispatch.ts` -- agent prompt construction and task dispatch
- `src/app/api/tasks/[id]/route.ts` -- task update and status-change enforcement
- `src/app/api/tasks/[id]/accept/route.ts` -- human acceptance merge/reject path
- `src/app/api/tasks/[id]/changes/route.ts` -- task branch/change visibility
- `src/app/api/agents/route.ts` -- agent provisioning

## Success criteria for using this skill

You are using this skill correctly when you:
- use Styrmann API with proper auth for creating work items
- choose Styrmann-native task/workflow operations when appropriate
- preserve Blockether UI/system conventions
- keep work and evidence scoped to the active workspace
- use the correct human acceptance gate model
- verify changes with build/typecheck/check before reporting success

## Load deeper references only when needed

- For creating work items via API, read `refs/API_RECIPES.md`.
- For task/workflow supervision or redesign, read `refs/WORKFLOWS.md`.
- For deploys, validation, and production-safe execution, read `refs/OPERATIONS.md`.
- For broader repo architecture, use `KNOWLEDGE.md`, but prefer live code when behavior changed recently.
