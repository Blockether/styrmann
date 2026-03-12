import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { getOpenClawClient, sendMessageWithProvenance } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import { getMissionControlUrl } from '@/lib/config';
import { ensureTaskWorktree, getTaskPipelineDir, getWorkspaceRepoPath, isGitWorkTree } from '@/lib/git-repo';
import { getRelevantKnowledge, formatKnowledgeForDispatch } from '@/lib/learner';
import { createTaskActivity } from '@/lib/task-activity';
import { getTaskWorkflow } from '@/lib/workflow-engine';
import { getUnresolvedTaskDependencies } from '@/lib/task-dependencies';
import { generateScopedApiToken } from '@/lib/scoped-api-tokens';
import type { Task, Agent, OpenClawSession, WorkflowStage } from '@/lib/types';

export interface DispatchResult {
  success: boolean;
  error?: string;
  taskId?: string;
  agentId?: string;
  sessionId?: string;
  updatedTask?: Task;
  updatedAgent?: Agent;
  warning?: string;
  otherOrchestrators?: Array<{ id: string; name: string; role: string }>;
}

function normalizeSessionSlug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return cleaned || 'agent';
}

function resourcePathFromPreviewUrl(url: string): string | null {
  if (!url.startsWith('/api/files/preview?path=')) return null;
  const marker = 'path=';
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const encoded = url.slice(idx + marker.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function getExternalMissionControlUrl(missionControlUrl: string): string {
  try {
    const parsed = new URL(missionControlUrl);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
      return process.env.MISSION_CONTROL_PUBLIC_URL || 'https://control.blockether.com';
    }
    return missionControlUrl;
  } catch {
    return process.env.MISSION_CONTROL_PUBLIC_URL || 'https://control.blockether.com';
  }
}

function getStageLoopTarget(stage: WorkflowStage | null | undefined): string | null {
  if (!stage) return null;
  const maybe = stage as unknown as Record<string, unknown>;
  const value = maybe.loop_target_status;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function buildResourceContext(taskId: string): string {
  const resources = queryAll<{ title: string; url: string; resource_type: string }>(
    `SELECT title, url, resource_type
     FROM task_resources
     WHERE task_id = ?
     ORDER BY created_at ASC`,
    [taskId],
  );

  if (resources.length === 0) return '';

  const list = resources
    .map((resource, index) => `${index + 1}. [${resource.resource_type}] ${resource.title} -> ${resource.url}`)
    .join('\n');

  const snippets: string[] = [];
  for (const resource of resources) {
    if (resource.resource_type !== 'document') continue;
    const localPath = resourcePathFromPreviewUrl(resource.url);
    if (!localPath || !existsSync(localPath)) continue;
    try {
      const content = readFileSync(localPath, 'utf-8').replace(/\u0000/g, '').trim();
      if (!content) continue;
      const excerpt = content.slice(0, 2500);
      snippets.push(`- ${resource.title}:\n${excerpt}${content.length > excerpt.length ? '\n...[truncated]' : ''}`);
      if (snippets.length >= 3) break;
    } catch {
    }
  }

  const snippetSection = snippets.length > 0
    ? `\n\n**INGESTED FILE EXCERPTS (document resources):**\n${snippets.join('\n\n')}`
    : '';

  return `\n**TASK RESOURCES:**\n${list}${snippetSection}\nUse these resources as required input when implementing and verifying this task.`;
}

export async function dispatchTaskToAgent(taskId: string): Promise<DispatchResult> {
  try {
    const task = queryOne<Task & { assigned_agent_name?: string; workspace_id: string }>(
      `SELECT t.*, a.name as assigned_agent_name
       FROM tasks t
       LEFT JOIN agents a ON t.assigned_agent_id = a.id
       WHERE t.id = ?`,
      [taskId]
    );

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (!task.assigned_agent_id) {
      return { success: false, error: 'Task has no assigned agent' };
    }

    const unresolvedDependencies = getUnresolvedTaskDependencies(taskId);
    if (unresolvedDependencies.length > 0) {
      const blockedList = unresolvedDependencies
        .map((item) => `${item.depends_on_task_title || item.depends_on_task_id} -> ${item.required_status}`)
        .join('; ');
      return {
        success: false,
        error: `Task dependencies unresolved: ${blockedList}`,
      };
    }

    const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [task.assigned_agent_id]);
    if (!agent) {
      return { success: false, error: 'Assigned agent not found' };
    }

    if (agent.role === 'orchestrator') {
    const otherOrchestrators = queryAll<{ id: string; name: string; role: string }>(
        `SELECT id, name, role
         FROM agents
         WHERE role = 'orchestrator'
         AND id != ?
         AND status != 'offline'`,
        [agent.id]
      );

      if (otherOrchestrators.length > 0) {
        return {
          success: false,
          warning: 'Other orchestrators available',
          otherOrchestrators,
        };
      }
    }

    const client = getOpenClawClient();
    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch (err) {
        console.error('Failed to connect to OpenClaw Gateway:', err);
        return { success: false, error: 'Failed to connect to OpenClaw Gateway' };
      }
    }

    const now = new Date().toISOString();

    let session = queryOne<OpenClawSession>(
      `SELECT * FROM openclaw_sessions
       WHERE agent_id = ? AND status = ? AND task_id = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      [agent.id, 'active', task.id],
    );

    if (!session) {
      const interruptedSession = queryOne<OpenClawSession>(
        `SELECT * FROM openclaw_sessions
         WHERE agent_id = ? AND status = ? AND task_id = ?
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`,
        [agent.id, 'interrupted', task.id],
      );
      if (interruptedSession) {
        run(
          'UPDATE openclaw_sessions SET status = ?, ended_at = NULL, updated_at = ? WHERE id = ?',
          ['active', now, interruptedSession.id],
        );
        session = queryOne<OpenClawSession>('SELECT * FROM openclaw_sessions WHERE id = ?', [interruptedSession.id]);
        createTaskActivity({
          taskId,
          activityType: 'status_changed',
          agentId: agent.id,
          message: `Resuming interrupted OpenClaw session for ${agent.name}`,
          metadata: {
            workflow_step: task.status === 'assigned' ? 'in_progress' : task.status,
            decision_event: true,
            openclaw_session_id: interruptedSession.openclaw_session_id,
          },
        });
      }
    }

    if (!session) {
      const orphanSession = queryOne<OpenClawSession>(
        `SELECT * FROM openclaw_sessions
         WHERE agent_id = ? AND status = ? AND task_id IS NULL
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`,
        [agent.id, 'active'],
      );
      if (orphanSession) {
        run(
          'UPDATE openclaw_sessions SET task_id = ?, session_type = ?, updated_at = ? WHERE id = ?',
          [task.id, 'subagent', now, orphanSession.id],
        );
        session = queryOne<OpenClawSession>('SELECT * FROM openclaw_sessions WHERE id = ?', [orphanSession.id]);
      }
    }

    if (!session) {
      const sessionId = uuidv4();
      const openclawSessionId = `mission-control-${normalizeSessionSlug(agent.name)}-${task.id.slice(0, 8)}`;

      run(
        `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, channel, status, session_type, task_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, agent.id, openclawSessionId, 'mission-control', 'active', 'subagent', task.id, now, now]
      );

      session = queryOne<OpenClawSession>('SELECT * FROM openclaw_sessions WHERE id = ?', [sessionId]);

      run(
        `INSERT INTO events (id, type, agent_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), 'agent_status_changed', agent.id, `${agent.name} session created`, now]
      );
    }

    if (!session) {
      return { success: false, error: 'Failed to create agent session' };
    }

    const priorityLabel = {
      low: 'LOW',
      normal: 'NORMAL',
      high: 'HIGH',
      urgent: 'URGENT',
    }[task.priority] || 'NORMAL';

    const workspace = queryOne<{ github_repo?: string | null; local_path?: string | null; name?: string | null }>(
      'SELECT github_repo, local_path, name FROM workspaces WHERE id = ?',
      [task.workspace_id],
    );
    const workspaceRepo = workspace?.local_path || workspace?.github_repo || null;
    const repoPath = getWorkspaceRepoPath(workspaceRepo);
    if (!repoPath || !existsSync(repoPath)) {
      return {
        success: false,
        error: `Workspace repo path is unavailable: ${workspaceRepo || 'missing workspace repo path'}`,
      };
    }
    const hasGitWorktree = isGitWorkTree(repoPath);
    const worktree = hasGitWorktree ? ensureTaskWorktree(repoPath, task.id, task.title) : null;
    const taskProjectDir = getTaskPipelineDir(worktree?.worktreePath || repoPath, task.id);
    mkdirSync(taskProjectDir, { recursive: true });
    const missionControlUrl = getExternalMissionControlUrl(getMissionControlUrl());
    const activeAcpBinding = queryOne<{
      acp_session_key: string;
      acp_agent_id: string;
      discord_thread_id: string;
    }>(
      `SELECT acp_session_key, acp_agent_id, discord_thread_id
       FROM acp_bindings
       WHERE workspace_id = ? AND status = 'active'
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      [task.workspace_id],
    );

    const rawTask = task as Task & {
      assigned_agent_name?: string;
      workspace_id: string;
      planning_spec?: string;
      planning_agents?: string;
    };
    let planningSpecSection = '';
    let agentInstructionsSection = '';

    if (rawTask.planning_spec) {
      try {
        const spec = JSON.parse(rawTask.planning_spec);
        const specText = typeof spec === 'string' ? spec : (spec.spec_markdown || JSON.stringify(spec, null, 2));
        planningSpecSection = `\n---\n**PLANNING SPECIFICATION:**\n${specText}\n`;
      } catch {
        planningSpecSection = `\n---\n**PLANNING SPECIFICATION:**\n${rawTask.planning_spec}\n`;
      }
    }

    if (rawTask.planning_agents) {
      try {
        const agents = JSON.parse(rawTask.planning_agents);
        if (Array.isArray(agents)) {
          const myInstructions = agents.find(
            (a: { agent_id?: string; name?: string; instructions?: string }) =>
              a.agent_id === agent.id || a.name === agent.name
          );
          if (myInstructions?.instructions) {
            agentInstructionsSection = `\n**YOUR INSTRUCTIONS:**\n${myInstructions.instructions}\n`;
          } else {
            const allInstructions = agents
              .filter((a: { instructions?: string }) => a.instructions)
              .map((a: { name?: string; role?: string; instructions?: string }) =>
                `- **${a.name || a.role || 'Agent'}:** ${a.instructions}`
              )
              .join('\n');
            if (allInstructions) {
              agentInstructionsSection = `\n**AGENT INSTRUCTIONS:**\n${allInstructions}\n`;
            }
          }
        }
      } catch {
      }
    }

    let knowledgeSection = '';
    try {
      const knowledge = getRelevantKnowledge(task.workspace_id, task.title, agent.id);
      knowledgeSection = formatKnowledgeForDispatch(knowledge);
    } catch {
    }
    const resourceSection = buildResourceContext(task.id);

    const workflow = getTaskWorkflow(taskId);
    let currentStage: WorkflowStage | undefined;
    let nextStage: WorkflowStage | undefined;
    if (workflow) {
      let stageIndex = workflow.stages.findIndex((stage) => stage.status === task.status);
      if (stageIndex < 0 && (task.status === 'assigned' || task.status === 'inbox')) {
        stageIndex = workflow.stages.findIndex((stage) => Boolean(stage.role));
      }
      if (stageIndex >= 0) {
        currentStage = workflow.stages[stageIndex];
        nextStage = workflow.stages[stageIndex + 1];
      }
    }

    const isBuilder = currentStage?.role === 'builder' || (!currentStage && task.status === 'assigned');
    const isTester = currentStage?.role === 'tester';
    const isVerifier = currentStage?.role === 'verifier' || currentStage?.role === 'reviewer';
    const nextStatus = nextStage?.status || 'review';
    const failEndpoint = `POST ${missionControlUrl}/api/tasks/${task.id}/fail`;
    const acpSection = activeAcpBinding
      ? `\n**ACP CONTEXT:**\n- ACP session key: ${activeAcpBinding.acp_session_key}\n- ACP agent: ${activeAcpBinding.acp_agent_id}\n- Discord thread: ${activeAcpBinding.discord_thread_id}\n- **ACP Provenance mode:** meta+receipt\n- When sending messages via ACP bridge, always use: \`openclaw acp --provenance meta+receipt\` (or the \`openclaw-acp\` alias)\n- This attaches InputProvenance metadata and Source Receipt blocks to messages for traceability\nUse this as supervisor context if your runtime can access ACP bindings.\n`
      : '';

    const scopedApiToken = generateScopedApiToken({
      taskId: task.id,
      workspaceId: task.workspace_id,
      sessionId: session.openclaw_session_id,
      ttlSeconds: 6 * 60 * 60,
      scopes: [
        `task:${task.id}:read`,
        `task:${task.id}:write`,
        'tasks:create',
        'tasks:read',
        'knowledge:read',
        'knowledge:write',
        'events:read',
      ],
    });
    const authHeader = `\n   Headers: {"Authorization": "Bearer ${scopedApiToken}"}`;
    const loopTarget = getStageLoopTarget(currentStage);
    const loopGuide = loopTarget
      ? `\nLoop policy:\n- This stage can loop back to ${loopTarget}.\n- On each retry, increment iteration context in activity metadata and explain what changed since last attempt.\n- Exit loop only when verification criteria are satisfied; otherwise call fail endpoint with precise blocker root-cause.`
      : `\nLoop policy:\n- If you are uncertain, do one evidence-backed iteration and report assumptions explicitly.\n- Do not spin indefinitely; escalate via fail endpoint when blocked.`;
    let completionInstructions: string;
    if (isBuilder) {
      const branchMetadata = worktree
        ? `{"branch": "${worktree.branchName}"}`
        : '{}';
      const branchRule = worktree
        ? `Branch rule:
- Work only in this directory: ${worktree.worktreePath}
- Use branch: ${worktree.branchName}
- Commit freely on that branch and include the branch in activity metadata above`
        : `Workspace rule:
- Work in this directory: ${repoPath}
- This workspace runs without a git worktree branch requirement.
- Still write deliverables under ${taskProjectDir}`;

      completionInstructions = `**IMPORTANT:** Use Mission Control direct REST API.
1. Log activity: POST ${missionControlUrl}/api/tasks/${task.id}/activities${authHeader}
   Body: {"activity_type": "completed", "message": "Description of what was done", "metadata": ${branchMetadata}}
2. Register deliverable: POST ${missionControlUrl}/api/tasks/${task.id}/deliverables${authHeader}
   Body: {"deliverable_type": "file", "title": "File name", "path": "${taskProjectDir}/filename.html"}
3. Update status: PATCH ${missionControlUrl}/api/tasks/${task.id}${authHeader}
   Body: {"status": "${nextStatus}"}

Progress reporting rules:
- Post at least one mid-run update using /activities with activity_type "updated" before completion.
- If any command fails due to access, auth, or missing files, post an explicit "updated" activity describing blocker and fallback.
- Do not silently continue after tool/API failures.

${branchRule}
${loopGuide}

When complete, reply with:
\`TASK_COMPLETE: [brief summary of what you did]\``;
    } else if (isTester) {
      completionInstructions = `**YOUR ROLE: TESTER** — Test the deliverables for this task.

Review the output directory for deliverables and run any applicable tests.

**If tests PASS:**
1. POST ${missionControlUrl}/api/tasks/${task.id}/activities${authHeader}
   Body: {"activity_type": "completed", "message": "Tests passed: [summary]"}
2. PATCH ${missionControlUrl}/api/tasks/${task.id}${authHeader}
   Body: {"status": "${nextStatus}"}
${loopGuide}

**If tests FAIL:**
1. ${failEndpoint}${authHeader}
   Body: {"reason": "Detailed description of what failed and what needs fixing"}

Progress reporting rules:
- Post at least one mid-run update using /activities with activity_type "updated".
- If test environment/access failures occur, report them immediately with blocker details before fail-loopback call.
${loopGuide}

Reply with: \`TEST_PASS: [summary]\` or \`TEST_FAIL: [what failed]\``;
    } else if (isVerifier) {
      completionInstructions = `**YOUR ROLE: VERIFIER** — Verify that all work meets quality standards.

Review deliverables, test results, and task requirements.

**If verification PASSES:**
1. POST ${missionControlUrl}/api/tasks/${task.id}/activities${authHeader}
   Body: {"activity_type": "completed", "message": "Verification passed: [summary]"}
2. PATCH ${missionControlUrl}/api/tasks/${task.id}${authHeader}
   Body: {"status": "${nextStatus}"}
${loopGuide}

**If verification FAILS:**
1. ${failEndpoint}${authHeader}
   Body: {"reason": "Detailed description of what failed and what needs fixing"}

Progress reporting rules:
- Post at least one mid-run update using /activities with activity_type "updated".
- If blocked by permissions/access/scopes, report the blocker explicitly before fail-loopback call.
${loopGuide}

Reply with: \`VERIFY_PASS: [summary]\` or \`VERIFY_FAIL: [what failed]\``;
    } else {
      completionInstructions = `**IMPORTANT:** After completing work:
1. PATCH ${missionControlUrl}/api/tasks/${task.id}${authHeader}
   Body: {"status": "${nextStatus}"}`;
    }

    const roleLabel = currentStage?.label || 'Task';
    const taskMessage = `[${priorityLabel}] **${isBuilder ? 'NEW TASK ASSIGNED' : `${roleLabel.toUpperCase()} STAGE — ${task.title}`}**

**Title:** ${task.title}
${task.description ? `**Description:** ${task.description}\n` : ''}
**Priority:** ${task.priority.toUpperCase()}
${task.due_date ? `**Due:** ${task.due_date}\n` : ''}
**Task ID:** ${task.id}
**Mission Control API base:** ${missionControlUrl}/api
${planningSpecSection}${agentInstructionsSection}${knowledgeSection}${resourceSection}
${acpSection}${isBuilder ? `**OUTPUT DIRECTORY:** ${taskProjectDir}\nCreate this directory and save all deliverables there. Do not write outside .mission-control/task pipeline path.\n` : `**OUTPUT DIRECTORY:** ${taskProjectDir}\nRead prior artifacts from this .mission-control path if needed.\n`}
${completionInstructions}

If you need help or clarification, ask the orchestrator.`;

    try {
      const prefix = agent.session_key_prefix || 'agent:main:';
      const sessionKey = `${prefix}${session.openclaw_session_id}`;
      const traceUrl = `/api/tasks/${task.id}/sessions/${encodeURIComponent(session.openclaw_session_id)}/trace`;
      // Send dispatch via ACP bridge with provenance (falls back to direct RPC)
      const { provenance } = await sendMessageWithProvenance(sessionKey, taskMessage, {
        cwd: worktree?.worktreePath || repoPath,
        timeoutMs: 30000,
      });

      createTaskActivity({
        taskId: task.id,
        activityType: 'dispatch_invocation',
        message: `Dispatch invocation sent to ${agent.name}`,
        agentId: agent.id,
        metadata: {
          openclaw_session_id: session.openclaw_session_id,
          session_key: sessionKey,
          trace_url: traceUrl,
          output_directory: taskProjectDir,
          branch: worktree?.branchName || null,
          worktree_path: worktree?.worktreePath || null,
          base_branch: worktree?.defaultBranch || null,
          provenance,
          invocation: taskMessage,
          workflow_step: task.status === 'assigned' ? 'in_progress' : task.status,
          decision_event: true,
        },
      });

      if (task.status === 'assigned') {
        run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['in_progress', now, taskId]);
      }

      const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (updatedTask) {
        broadcast({
          type: 'task_updated',
          payload: updatedTask,
        });
      }

      run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['working', now, agent.id]);

      const updatedAgent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agent.id]);
      if (updatedAgent) {
        broadcast({
          type: 'agent_updated',
          payload: updatedAgent,
        });
      }

      const eventId = uuidv4();
      run(
        `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [eventId, 'task_dispatched', agent.id, task.id, `Task "${task.title}" dispatched to ${agent.name}`, now]
      );

      createTaskActivity({
        taskId: task.id,
        activityType: 'status_changed',
        message: `Task dispatched to ${agent.name} - Agent is now working on this task`,
        agentId: agent.id,
        metadata: {
          workflow_step: 'in_progress',
          decision_event: true,
        },
      });

      return {
        success: true,
        taskId: task.id,
        agentId: agent.id,
        sessionId: session.openclaw_session_id,
        updatedTask: updatedTask || undefined,
        updatedAgent: updatedAgent || undefined,
      };
    } catch (err) {
      console.error('Failed to send message to agent:', err);
      return { success: false, error: 'Internal server error' };
    }
  } catch (error) {
    console.error('Failed to dispatch task:', error);
    return { success: false, error: 'Internal server error' };
  }
}
