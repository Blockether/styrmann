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

### Notification
An organization-level signal about task progress.

- Notifications are shown in organization views
- Notifications are created when a task enters review or is completed
- A notification includes at least the task reference and status

### OpenCode Run
An observed execution of a delegated AI task.

- A run links a task to an external process identifier (PID)
- Styrmann observes process state and logs through the PID
- Styrmann does not own the process lifecycle
- Redeployments must allow the system to reconnect to already-running processes

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
       -> OpenCode Run
```

1. User creates an organization
2. User creates one or more workspaces inside the organization
3. User creates tickets in the organization backlog
4. User assigns tickets directly to a sprint or indirectly through a milestone
5. User delegates ticket work into AI tasks for a workspace
6. Styrmann observes OpenCode runs and surfaces task progress through organization notifications

## Terminology

| Term | Meaning |
|------|---------|
| **Organization** | Top-level planning and execution boundary (e.g. "Blockether") |
| **Workspace** | Repository-scoped execution context within an organization |
| **Backlog** | Organization-scoped pool of tickets with no sprint and no milestone |
| **Sprint** | Planning container that can hold tickets and milestones |
| **Milestone** | Named grouping of tickets inside a sprint |
| **AI Task** | Delegated implementation unit for a ticket in a workspace |
| **OpenCode Run** | External process execution observed by PID |

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
