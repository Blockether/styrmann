#!/usr/bin/env python3
"""
Mission Control CLI for AI agents.

Usage:
  mc.py <action> '<json_params>'

Returns JSON to stdout:
  {"ok": true, "data": ...}
  {"ok": false, "error": "...", "details": "..."}

Environment:
  MC_URL        Base URL (default: http://localhost:4000)
  MC_TOKEN      Bearer token (required for remote access, optional on localhost)
  MC_WORKSPACE  Default workspace ID (default: "default")

Actions:
  task_create       Create a new task
  task_list         List tasks with optional filters
  task_get          Get a single task by ID
  task_update       Update task fields
  task_status       Change task status
  task_delete       Delete a task
  task_log          Log an activity on a task

  sprint_list       List sprints
  sprint_create     Create a new sprint
  sprint_end        End (complete) a sprint

  milestone_list    List milestones
  milestone_create  Create a milestone

  agent_list        List agents
  agent_get         Get a single agent
  agent_status      Update agent status (working/standby/offline)

  issue_list        List cached GitHub issues
  issue_sync        Trigger GitHub issues sync

  acp_bindings      List ACP Discord thread bindings
  acp_bind          Create an ACP Discord thread binding
  acp_unbind        Close an ACP binding

  workspace_list    List all workspaces

  status            Show workspace overview (agents + active tasks)
"""

import json
import os
import sys
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_URL = os.environ.get("MC_URL", "http://localhost:4000").rstrip("/")
TOKEN = os.environ.get("MC_TOKEN", "")
WORKSPACE_ID = os.environ.get("MC_WORKSPACE", "default")


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------


def ok(data):
    print(json.dumps({"ok": True, "data": data}, indent=2))
    sys.exit(0)


def fail(error: str, details: str = ""):
    print(json.dumps({"ok": False, "error": error, "details": details}, indent=2))
    sys.exit(1)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _headers():
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    return h


def _request(method: str, path: str, body=None):
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            err_json = json.loads(raw)
            msg = err_json.get("error") or err_json.get("message") or raw
        except Exception:
            msg = raw or f"HTTP {e.code}"
        fail(f"API error {e.code} on {method} {path}", msg)
    except urllib.error.URLError as e:
        fail(f"Mission Control unreachable at {BASE_URL}", str(e.reason))
    except Exception as e:
        fail(f"Request failed: {e}")


def api_get(path: str):
    return _request("GET", path)


def api_post(path: str, body: dict):
    return _request("POST", path, body)


def api_patch(path: str, body: dict):
    return _request("PATCH", path, body)


def api_delete(path: str):
    return _request("DELETE", path)


# ---------------------------------------------------------------------------
# Param validation
# ---------------------------------------------------------------------------


def require(params: dict, *keys: str):
    for k in keys:
        if not params.get(k):
            fail(f"Missing required parameter: '{k}'", f"Required: {list(keys)}")


def ws(params: dict) -> str:
    return params.get("workspace_id") or WORKSPACE_ID


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------


def action_task_create(p: dict):
    """
    Create a new task.
    Required: title
    Optional: description, status, priority (low/normal/high/urgent),
              task_type (bug/feature/chore/documentation/research),
              assigned_agent_id, milestone_id, effort (1-5), impact (1-5),
              workspace_id, github_issue_id
    """
    require(p, "title")
    body = {
        "title": p["title"],
        "workspace_id": ws(p),
    }
    for field in (
        "description",
        "status",
        "priority",
        "task_type",
        "assigned_agent_id",
        "milestone_id",
        "effort",
        "impact",
        "due_date",
        "github_issue_id",
    ):
        if p.get(field) is not None:
            body[field] = p[field]
    result = api_post("/api/tasks", body)
    ok(result)


def action_task_list(p: dict):
    """
    List tasks.
    Optional: workspace_id, status (comma-separated), sprint_id, milestone_id,
              assigned_agent_id, task_type, backlog (true/false)
    """
    qs = f"workspace_id={ws(p)}"
    for field in (
        "status",
        "sprint_id",
        "milestone_id",
        "assigned_agent_id",
        "task_type",
        "backlog",
    ):
        if p.get(field):
            qs += f"&{field}={p[field]}"
    result = api_get(f"/api/tasks?{qs}")
    ok(result)


def action_task_get(p: dict):
    """
    Get a single task by ID.
    Required: task_id
    """
    require(p, "task_id")
    result = api_get(f"/api/tasks/{p['task_id']}")
    ok(result)


def action_task_update(p: dict):
    """
    Update task fields.
    Required: task_id
    Optional: title, description, status, priority, task_type,
              assigned_agent_id, milestone_id, effort, impact, due_date
    """
    require(p, "task_id")
    body = {}
    for field in (
        "title",
        "description",
        "status",
        "priority",
        "task_type",
        "assigned_agent_id",
        "milestone_id",
        "effort",
        "impact",
        "due_date",
    ):
        if p.get(field) is not None:
            body[field] = p[field]
    if not body:
        fail("No fields to update", "Provide at least one field to update")
    result = api_patch(f"/api/tasks/{p['task_id']}", body)
    ok(result)


def action_task_status(p: dict):
    """
    Change task status.
    Required: task_id, status
    Valid statuses: planning, pending_dispatch, inbox, assigned, in_progress,
                    testing, review, verification, done
    """
    require(p, "task_id", "status")
    valid = {
        "planning",
        "pending_dispatch",
        "inbox",
        "assigned",
        "in_progress",
        "testing",
        "review",
        "verification",
        "done",
    }
    if p["status"] not in valid:
        fail(f"Invalid status: '{p['status']}'", f"Valid values: {sorted(valid)}")
    result = api_patch(f"/api/tasks/{p['task_id']}", {"status": p["status"]})
    ok(result)


def action_task_delete(p: dict):
    """
    Delete a task.
    Required: task_id
    """
    require(p, "task_id")
    api_delete(f"/api/tasks/{p['task_id']}")
    ok({"deleted": True, "task_id": p["task_id"]})


def action_task_log(p: dict):
    """
    Log an activity on a task.
    Required: task_id, message
    Optional: activity_type (spawned/updated/completed/file_created/status_changed),
              agent_id
    """
    require(p, "task_id", "message")
    body = {
        "activity_type": p.get("activity_type", "updated"),
        "message": p["message"],
    }
    if p.get("agent_id"):
        body["agent_id"] = p["agent_id"]
    result = api_post(f"/api/tasks/{p['task_id']}/activities", body)
    ok(result)


def action_sprint_list(p: dict):
    """
    List sprints.
    Optional: workspace_id, status (planning/active/completed/cancelled)
    """
    qs = f"workspace_id={ws(p)}"
    if p.get("status"):
        qs += f"&status={p['status']}"
    result = api_get(f"/api/sprints?{qs}")
    ok(result)


def action_sprint_create(p: dict):
    """
    Create a new sprint.
    Required: name, start_date (YYYY-MM-DD), end_date (YYYY-MM-DD)
    Optional: goal, workspace_id
    """
    require(p, "name", "start_date", "end_date")
    body = {
        "name": p["name"],
        "start_date": p["start_date"],
        "end_date": p["end_date"],
        "workspace_id": ws(p),
    }
    if p.get("goal"):
        body["goal"] = p["goal"]
    result = api_post("/api/sprints", body)
    ok(result)


def action_sprint_end(p: dict):
    """
    End (complete) a sprint.
    Required: sprint_id
    """
    require(p, "sprint_id")
    result = api_patch(f"/api/sprints/{p['sprint_id']}", {"status": "completed"})
    ok(result)


def action_milestone_list(p: dict):
    """
    List milestones.
    Optional: workspace_id, sprint_id, status
    """
    qs = f"workspace_id={ws(p)}"
    for field in ("sprint_id", "status"):
        if p.get(field):
            qs += f"&{field}={p[field]}"
    result = api_get(f"/api/milestones?{qs}")
    ok(result)


def action_milestone_create(p: dict):
    """
    Create a milestone.
    Required: name
    Optional: description, sprint_id, due_date, priority, workspace_id
    """
    require(p, "name")
    body = {
        "name": p["name"],
        "workspace_id": ws(p),
    }
    for field in ("description", "sprint_id", "due_date", "priority"):
        if p.get(field):
            body[field] = p[field]
    result = api_post("/api/milestones", body)
    ok(result)


def action_agent_list(p: dict):
    """
    List agents.
    Optional: workspace_id
    """
    qs = f"workspace_id={ws(p)}"
    result = api_get(f"/api/agents?{qs}")
    ok(result)


def action_agent_get(p: dict):
    """
    Get a single agent by ID.
    Required: agent_id
    """
    require(p, "agent_id")
    result = api_get(f"/api/agents/{p['agent_id']}")
    ok(result)


def action_agent_status(p: dict):
    """
    Update agent status.
    Required: agent_id, status (working/standby/offline)
    """
    require(p, "agent_id", "status")
    valid = {"working", "standby", "offline"}
    if p["status"] not in valid:
        fail(f"Invalid status: '{p['status']}'", f"Valid values: {sorted(valid)}")
    result = api_patch(f"/api/agents/{p['agent_id']}", {"status": p["status"]})
    ok(result)


def action_issue_list(p: dict):
    """
    List cached GitHub issues for a workspace.
    Required: workspace_id (or MC_WORKSPACE env)
    Optional: state (open/closed/all, default: open)
    """
    workspace = ws(p)
    state = p.get("state", "open")
    result = api_get(f"/api/workspaces/{workspace}/github/issues?state={state}")
    ok(result)


def action_issue_sync(p: dict):
    """
    Trigger GitHub issues sync for a workspace.
    Required: workspace_id (or MC_WORKSPACE env)
    """
    workspace = ws(p)
    result = api_post(f"/api/workspaces/{workspace}/github/sync", {})
    ok(result)


def action_workspace_list(p: dict):
    """
    List all workspaces.
    No parameters required.
    """
    result = api_get("/api/workspaces")
    ok(result)


def action_acp_bindings(p: dict):
    qs = f"workspace_id={ws(p)}"
    status = p.get("status", "active")
    if status and status != "all":
        qs += f"&status={status}"
    for field in ("agent_id", "discord_thread_id"):
        if p.get(field):
            qs += f"&{field}={p[field]}"
    result = api_get(f"/api/acp/bindings?{qs}")
    ok(result)


def action_acp_bind(p: dict):
    require(p, "discord_thread_id", "acp_session_key")
    body = {
        "workspace_id": ws(p),
        "discord_thread_id": p["discord_thread_id"],
        "acp_session_key": p["acp_session_key"],
    }
    for field in ("discord_channel_id", "acp_agent_id", "agent_id", "task_id", "cwd"):
        if p.get(field) is not None:
            body[field] = p[field]
    result = api_post("/api/acp/bindings", body)
    ok(result)


def action_acp_unbind(p: dict):
    require(p, "binding_id")
    result = api_patch(f"/api/acp/bindings/{p['binding_id']}", {"status": "closed"})
    ok(result)


def action_status(p: dict):
    """
    Show workspace overview: agents + active tasks.
    Optional: workspace_id
    """
    workspace = ws(p)
    agents = api_get(f"/api/agents?workspace_id={workspace}") or []
    tasks = (
        api_get(
            f"/api/tasks?workspace_id={workspace}&status=in_progress,assigned,review,testing"
        )
        or []
    )
    sprints = api_get(f"/api/sprints?workspace_id={workspace}") or []
    active_sprint = next((s for s in sprints if s.get("status") == "active"), None)
    ok(
        {
            "workspace_id": workspace,
            "active_sprint": active_sprint,
            "agents": [
                {
                    "id": a["id"],
                    "name": a["name"],
                    "role": a.get("role"),
                    "status": a.get("status"),
                }
                for a in agents
            ],
            "active_tasks": [
                {
                    "id": t["id"],
                    "title": t["title"],
                    "status": t["status"],
                    "assigned_agent_name": t.get("assigned_agent_name"),
                }
                for t in tasks
            ],
        }
    )


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

ACTIONS = {
    "task_create": action_task_create,
    "task_list": action_task_list,
    "task_get": action_task_get,
    "task_update": action_task_update,
    "task_status": action_task_status,
    "task_delete": action_task_delete,
    "task_log": action_task_log,
    "sprint_list": action_sprint_list,
    "sprint_create": action_sprint_create,
    "sprint_end": action_sprint_end,
    "milestone_list": action_milestone_list,
    "milestone_create": action_milestone_create,
    "agent_list": action_agent_list,
    "agent_get": action_agent_get,
    "agent_status": action_agent_status,
    "issue_list": action_issue_list,
    "issue_sync": action_issue_sync,
    "acp_bindings": action_acp_bindings,
    "acp_bind": action_acp_bind,
    "acp_unbind": action_acp_unbind,
    "status": action_status,
    "workspace_list": action_workspace_list,
}


def main():
    if len(sys.argv) < 2:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "Usage: mc.py <action> ['{...json params...}']",
                    "available_actions": sorted(ACTIONS.keys()),
                },
                indent=2,
            )
        )
        sys.exit(1)

    action = sys.argv[1]

    if action in ("--help", "-h", "help"):
        print(
            json.dumps(
                {
                    "ok": True,
                    "data": {
                        "usage": "mc.py <action> ['{...json params...}']",
                        "env": {
                            "MC_URL": f"{BASE_URL} (current)",
                            "MC_TOKEN": "Bearer token (optional on localhost)",
                            "MC_WORKSPACE": f"{WORKSPACE_ID} (current)",
                        },
                        "actions": {
                            k: (v.__doc__ or "").strip().split("\n")[0]
                            for k, v in ACTIONS.items()
                        },
                    },
                },
                indent=2,
            )
        )
        sys.exit(0)

    if action not in ACTIONS:
        fail(
            f"Unknown action: '{action}'",
            f"Available: {sorted(ACTIONS.keys())}",
        )

    # Parse params
    params = {}
    if len(sys.argv) >= 3:
        raw = sys.argv[2]
        try:
            params = json.loads(raw)
        except json.JSONDecodeError as e:
            fail(f"Invalid JSON params: {e}", f"Got: {raw[:200]}")
        if not isinstance(params, dict):
            fail("Params must be a JSON object", f"Got type: {type(params).__name__}")

    ACTIONS[action](params)


if __name__ == "__main__":
    main()
