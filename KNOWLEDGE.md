# Styrmann — Domain Knowledge

## What is Styrmann?

Styrmann (Icelandic: "helmsman") is an orchestration harness for managing AI tools and AI workflows through structured project management.

## Core Entities

### Organization
The top-level container for planning and execution.

- An organization has a unique identity and a name
- An organization contains multiple workspaces
- An organization owns the backlog for tickets without sprint or milestone assignment
- Organization-level views surface notifications about AI task progress

### Workspace
A repository-scoped execution context within an organization.

- A workspace belongs to exactly one organization
- A workspace has a name and repository reference
- AI tasks are delegated in the context of a workspace

### Ticket
A business-level work item that can stay in backlog or be assigned into planned work.

- A ticket has a unique identity
- A ticket includes type, description, structured acceptance criteria, story points, effort, impact, and assignee
- Ticket type must not use `task`; task is reserved for AI execution units
- Acceptance criteria are structured data with nested list support, not plain text only
- A ticket can have attachments associated with it
- A ticket can be unassigned and remain in the backlog

### Sprint
A planning container within an organization.

- A sprint belongs to one organization
- A sprint has a name and optional timeframe
- A sprint can contain tickets directly
- A sprint can contain multiple milestones

### Milestone
A named grouping of tickets inside a sprint.

- A milestone belongs to exactly one sprint
- A milestone can contain multiple tickets
- A ticket assigned to a milestone inherits its sprint through that milestone

### AI Task
A delegated unit of implementation work derived from a ticket.

- A task belongs to one ticket and one workspace
- A task can represent the full scope of a ticket or a subset of it
- A task has a unique identity
- Task statuses are `:task.status/inbox`, `:task.status/implementing`, `:task.status/testing`, `:task.status/reviewing`, and `:task.status/done`
- The initial task status is `:task.status/inbox`
- `:task.status/done` means the delegated work is accepted
- A task optionally carries scoped acceptance criteria (EDN string) narrowed from the parent ticket's acceptance criteria
- A task optionally carries CoVe (Chain-of-Verification) questions (EDN string) used to validate the task's output
- A task optionally carries deliverables (EDN string) — a list of maps with `:title`, `:description`, and `:status` ("done" or "pending")
- Deliverables are rolled up on the ticket detail view as a summary with a progress bar
- A task can declare dependencies on other tasks via `:task/depends-on` (a set of task refs); dependent tasks must complete before this task can start

### Task Dependency Graph
A directed acyclic graph (DAG) of tasks derived from a single ticket.

- Tasks within a ticket can depend on other tasks in the same ticket
- Dependencies are expressed as `:task/depends-on` refs on the task entity
- Circular dependencies are rejected at creation time
- `domain.task/create-graph!` creates an entire DAG in a single transaction; callers pass `depends-on-indices` (0-based indices into the same spec vector) to wire up edges
- `domain.task/dependency-graph` returns all tasks for a ticket with `:task/depends-on` refs resolved to full task maps

### Ticket Analysis
The process of decomposing a ticket into a DAG of scoped AI tasks.

- Analysis is orchestrated in `domain.analysis`
- Each resulting task gets a subset of the ticket's acceptance criteria and a set of CoVe questions
- CoVe questions are generated via Svar RLM to verify the task output before marking it done
- The analysis pipeline is: parse ticket → generate CoVe questions → decompose into tasks → build dependency graph
- Svar RLM integration is implemented with retry loop; `domain.analysis/decompose-ticket!` generates structured output with validation feedback

### Notification
An organization-level signal about task progress.

- Notifications are shown in organization views
- Notifications are created when a task enters review or is completed
- A notification includes at least the task reference and status

### Execution Environment
The runtime context used by agents to execute delegated task work.

- An execution environment belongs to a workspace
- It defines runtime type (local/container/remote), model provider, model, optional base URL, and working directory
- It references a credential profile key; secrets are resolved from runtime environment variables, never from database values
- Environment status tracks readiness (`ready`, `busy`, `offline`, `error`)

### Agent
An execution identity with instructions, role metadata, and type classification.

- An agent has a stable key, name, type, model, version, role description, and instruction set
- Agent type is one of: `:agent.type/planner`, `:agent.type/implementer`, `:agent.type/reviewer`, `:agent.type/explorer`, `:agent.type/verifier`
- **Planner**: decomposes tickets into task DAGs (uses glm-5)
- **Implementer**: writes code using structured editing (uses glm-5-turbo)
- **Reviewer**: reviews code changes, runs diagnostics (uses glm-5)
- **Explorer**: indexes codebases, maps namespaces (uses glm-5-turbo)
- **Verifier**: runs tests, validates acceptance criteria (uses glm-5-turbo)
- Agent records are reusable across many runs
- Agents are bound to tool capabilities through explicit bindings
- All 5 agents are registered via `execution.agent-types/ensure-all-agents!`

### Workflow
A workflow coordinates execution of one task through one or more agent sessions.

- A workflow belongs to one task
- A workflow aggregates many sessions
- A workflow has explicit lifecycle status (`running`, `succeeded`, `failed`, etc.)

### Session
An observed execution attempt of an agent inside a workflow.

- A session links workflow, execution environment, and agent
- A session stores command metadata, process identifier (PID), logs, and exit code artifacts
- A session has explicit lifecycle status (`running`, `succeeded`, `failed`, etc.)
- Redeployments must allow the system to reconnect to already-running sessions

### Tool Definition and Session Calls (`session.calls/*`)
Function-like capabilities used by agents during execution.

- Tools are first-class definitions with schema and classpath function symbol metadata
- Tools are registered from classpath through the runtime tool registry and synced into Datalevin on startup
- Agent-tool bindings control which tools an agent can call
- Session calls are persisted with input/output payloads, status, timestamps, and optional error text

### Session Event (`session.event/*`)
Append-only timeline entries for session visibility.

- Events capture state changes, logs, tool call boundaries, and other execution signals
- Events are tied to a specific session and can carry structured EDN payloads

### Session Messages (`session.messages/*`)
Conversation and textual exchange timeline for a session.

- Messages belong to a session
- Messages include role (`system`, `user`, `assistant`, `tool`) and content

## Assignment Rules

- A ticket assigned directly to a sprint must have no milestone
- A ticket assigned to a milestone must inherit sprint through that milestone
- A ticket cannot be assigned to both sprint and milestone at the same time
- A ticket with neither sprint nor milestone belongs to the organization backlog
- The backlog is scoped to the organization, not to a workspace

## Workflow

```
Organization
  -> Workspace
  -> Backlog Ticket
  -> Sprint
       -> Milestone
            -> Ticket

Ticket
  -> AI Task
       -> Workflow
            -> Session
```

1. User creates an organization
2. User creates one or more workspaces inside the organization
3. User creates tickets in the organization backlog
4. User assigns tickets directly to a sprint or indirectly through a milestone
5. User delegates ticket work into AI tasks for a workspace
6. Styrmann observes workflow/session execution and surfaces task progress through organization notifications

## Terminology

| Term | Meaning |
|------|---------|
| **Organization** | Top-level planning and execution boundary (e.g. "Blockether") |
| **Workspace** | Repository-scoped execution context within an organization |
| **Backlog** | Organization-scoped pool of tickets with no sprint and no milestone |
| **Sprint** | Planning container that can hold tickets and milestones |
| **Milestone** | Named grouping of tickets inside a sprint |
| **AI Task** | Delegated implementation unit for a ticket in a workspace |
| **Task Graph** | DAG of tasks within a ticket expressing execution order via dependency edges |
| **CoVe Questions** | Chain-of-Verification questions generated per task to validate output |
| **Ticket Analysis** | Process of decomposing a ticket into a scoped task DAG via Svar RLM |
| **Execution Environment** | Workspace-scoped runtime context used for agent execution |
| **Agent** | Versioned execution identity with role and instructions |
| **Workflow** | Multi-session execution container for a single task |
| **Session** | External process execution attempt observed by PID |
| **Tool Definition** | Callable function capability available to agents |
| **Session Calls** | Persisted invocation of a tool during a session (`session.calls/*`) |
| **Session Event** | Timeline event emitted during a session (`session.event/*`) |
| **Session Messages** | Conversation/message record inside a session (`session.messages/*`) |

## Naming Conventions (UI)

- The home page lists **organizations**, not "projects"
- Navigation refers to "Organizations" throughout (breadcrumbs, nav bar, headings)
- An organization like "Blockether" is the top-level entity; it is not a project
- Workspaces are repository-scoped contexts within an organization (e.g. "styrmann" workspace inside "Blockether" organization)

## UX Direction

- The application should feel SPA-like even though it is server-rendered
- Navigation should prefer in-place body replacement over full page reloads where possible
- Organization screens should behave like app workspaces: top toolbar, fast tab/view switching, and modal actions
- Mutually exclusive primary views (for example sprint board vs backlog) should switch in place so only one is visible at a time
