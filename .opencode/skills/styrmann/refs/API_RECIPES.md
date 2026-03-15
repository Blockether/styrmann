# API Recipes -- Creating work items through Styrmann

## Authentication

All Styrmann API endpoints require a bearer token when `STYRMAN_API_TOKEN` is set in `.env.local`.

```bash
# Read the token once
TOKEN=$(grep STYRMAN_API_TOKEN /root/repos/blockether/styrmann/.env.local | cut -d= -f2-)

# All subsequent curl calls use:
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" http://localhost:4000/api/...
```

If `STYRMAN_API_TOKEN` is not set, auth is disabled (dev mode) and no header is needed.

**Common mistake**: Calling the API without the bearer token and getting `{"error":"Unauthorized"}`. Always check `.env.local` for the token first.

## Resolve organization ID

Before creating sprints, milestones, or tickets, you need the organization ID:

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/organizations
# Returns: [{"id":"ab90def4-...","name":"Blockether","slug":"blockether",...}]
```

## Create a sprint

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:4000/api/org-sprints \
  -d '{
    "organization_id": "<ORG_ID>",
    "name": "Sprint name",
    "description": "Optional description",
    "status": "planned"
  }'
```

Status values: `planned`, `active`, `completed`.

## Create a milestone

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:4000/api/org-milestones \
  -d '{
    "organization_id": "<ORG_ID>",
    "name": "Milestone name",
    "description": "Optional description",
    "org_sprint_id": "<SPRINT_ID or omit for backlog>",
    "priority": "normal"
  }'
```

Priority values: `low`, `normal`, `high`, `urgent`.

## Create an org ticket

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:4000/api/org-tickets \
  -d '{
    "organization_id": "<ORG_ID>",
    "title": "Ticket title",
    "description": "Detailed description",
    "ticket_type": "feature",
    "priority": "normal",
    "status": "open",
    "org_sprint_id": "<SPRINT_ID or omit>",
    "org_milestone_id": "<MILESTONE_ID or omit>"
  }'
```

Ticket types: `feature`, `bug`, `improvement`, `task`, `epic`.
Status values: `open`, `triaged`, `delegated`, `in_progress`, `resolved`, `closed`.

## List existing items

```bash
# Sprints for an org
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/org-sprints?organization_id=<ORG_ID>"

# Milestones for an org
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/org-milestones?organization_id=<ORG_ID>"

# Tickets for an org
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/org-tickets?organization_id=<ORG_ID>"

# Workspaces (all)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/workspaces

# Agents (all)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/agents
```

## Full workflow: create sprint + milestone + ticket

```bash
TOKEN=$(grep STYRMAN_API_TOKEN /root/repos/blockether/styrmann/.env.local | cut -d= -f2-)
ORG_ID="ab90def4-d276-4fba-b222-119c6ed1af4f"  # Blockether

# 1. Create sprint
SPRINT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:4000/api/org-sprints \
  -d "{\"organization_id\":\"$ORG_ID\",\"name\":\"Sprint 1\",\"status\":\"active\"}")
SPRINT_ID=$(echo $SPRINT | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# 2. Create milestone under sprint
MILESTONE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:4000/api/org-milestones \
  -d "{\"organization_id\":\"$ORG_ID\",\"name\":\"Settings UI\",\"org_sprint_id\":\"$SPRINT_ID\",\"priority\":\"high\"}")
MILESTONE_ID=$(echo $MILESTONE | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# 3. Create ticket under milestone + sprint
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:4000/api/org-tickets \
  -d "{\"organization_id\":\"$ORG_ID\",\"title\":\"Add Discord configuration UI\",\"description\":\"...\",\"ticket_type\":\"feature\",\"priority\":\"high\",\"status\":\"open\",\"org_sprint_id\":\"$SPRINT_ID\",\"org_milestone_id\":\"$MILESTONE_ID\"}"
```
