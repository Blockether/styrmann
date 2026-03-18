# Styrmann — Domain Knowledge

## What is Styrmann?

Styrmann (Icelandic: "helmsman") is an orchestration harness for managing AI tools and AI workflows through structured project management.

## Core Entities

### Ticket
A business-level work item. Tickets are created in the **backlog** and can be promoted to milestones.

- Statuses: `:ticket.status/backlog`, `:ticket.status/active`, `:ticket.status/done`, `:ticket.status/cancelled`
- A ticket in backlog has no milestone reference
- Promoting a ticket = assigning it to a milestone

### Milestone
A grouping of related tickets that represent a deliverable or goal. Milestones belong to sprints.

- A milestone without a sprint is unassigned
- Assigning a milestone to a sprint makes it part of that sprint's scope

### Sprint
A time-boxed iteration containing a set of milestones. Each milestone within a sprint contains its own tickets.

- Statuses: `:sprint.status/planning`, `:sprint.status/active`, `:sprint.status/completed`
- A sprint has optional start and end dates

## Workflow

```
Ticket (backlog) → promote → Milestone → assign → Sprint
```

1. User creates tickets (business needs, features, bugs)
2. Tickets live in the backlog until promoted
3. User creates milestones and assigns tickets to them
4. User creates sprints and assigns milestones to them
5. Sprint activation begins the work cycle

## Terminology

| Term | Meaning |
|------|---------|
| **Backlog** | The pool of unassigned tickets (no milestone) |
| **Promote** | Assign a backlog ticket to a milestone |
| **Sprint** | Time-boxed work iteration containing milestones |
| **Milestone** | Goal-oriented grouping of tickets within a sprint |
