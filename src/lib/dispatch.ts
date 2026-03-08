import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import { getMissionControlUrl } from '@/lib/config';
import { getWorkspaceRepoPath, getTaskPipelineDir, isGitWorkTree } from '@/lib/git-repo';
import { getRelevantKnowledge, formatKnowledgeForDispatch } from '@/lib/learner';
import { getTaskWorkflow } from '@/lib/workflow-engine';
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
         AND workspace_id = ?
         AND status != 'offline'`,
        [agent.id, task.workspace_id]
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

    let session = queryOne<OpenClawSession>(
      'SELECT * FROM openclaw_sessions WHERE agent_id = ? AND status = ?',
      [agent.id, 'active']
    );

    const now = new Date().toISOString();

    if (!session) {
      const sessionId = uuidv4();
      const openclawSessionId = `mission-control-${agent.name.toLowerCase().replace(/\s+/g, '-')}`;

      run(
        `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, channel, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, agent.id, openclawSessionId, 'mission-control', 'active', now, now]
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

    const workspace = queryOne<{ github_repo?: string | null; name?: string | null }>(
      'SELECT github_repo, name FROM workspaces WHERE id = ?',
      [task.workspace_id],
    );
    const repoPath = getWorkspaceRepoPath(workspace?.github_repo || null);
    if (!repoPath || !isGitWorkTree(repoPath)) {
      return {
        success: false,
        error: `Workspace repo is not a valid git worktree: ${workspace?.github_repo || 'missing github_repo'}`,
      };
    }
    const taskProjectDir = getTaskPipelineDir(repoPath, task.id);
    const missionControlUrl = getMissionControlUrl();
    const autoTrainIteration = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM task_activities
       WHERE task_id = ? AND activity_type = 'dispatch_invocation'`,
      [task.id],
    )?.count || 0;
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
    const recentAutoTrainSummaries = task.task_type === 'autotrain'
      ? queryAll<{ message: string }>(
          `SELECT message FROM task_activities
           WHERE task_id = ? AND activity_type IN ('completed', 'status_changed')
           ORDER BY created_at DESC
           LIMIT 3`,
          [task.id],
        )
      : [];

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
      const knowledge = getRelevantKnowledge(task.workspace_id, task.title);
      knowledgeSection = formatKnowledgeForDispatch(knowledge);
    } catch {
    }

    const workflow = getTaskWorkflow(taskId);
    let currentStage: WorkflowStage | undefined;
    let nextStage: WorkflowStage | undefined;
    if (workflow) {
      let stageIndex = workflow.stages.findIndex((stage) => stage.status === task.status);
      if (stageIndex < 0 && (task.status === 'assigned' || task.status === 'inbox')) {
        stageIndex = workflow.stages.findIndex((stage) => stage.role === 'builder');
      }
      if (stageIndex >= 0) {
        currentStage = workflow.stages[stageIndex];
        nextStage = workflow.stages[stageIndex + 1];
      }
    }

    const isBuilder = !currentStage || currentStage.role === 'builder' || task.status === 'assigned';
    const isTester = currentStage?.role === 'tester';
    const isVerifier = currentStage?.role === 'verifier' || currentStage?.role === 'reviewer';
    const nextStatus = nextStage?.status || 'review';
    const failEndpoint = `POST ${missionControlUrl}/api/tasks/${task.id}/fail`;
    const autoTrainIterationNumber = autoTrainIteration + 1;
    const autoTrainOutputDir = `${taskProjectDir}/iter-${autoTrainIterationNumber}`;
    const autoTrainSummariesSection = recentAutoTrainSummaries.length > 0
      ? recentAutoTrainSummaries.map((item, index) => `${index + 1}. ${item.message}`).join('\n')
      : 'No prior iterations yet.';
    const acpSection = activeAcpBinding
      ? `\n**ACP CONTEXT:**\n- ACP session key: ${activeAcpBinding.acp_session_key}\n- ACP agent: ${activeAcpBinding.acp_agent_id}\n- Discord thread: ${activeAcpBinding.discord_thread_id}\nUse this as supervisor context if your runtime can access ACP bindings.\n`
      : '';

    let completionInstructions: string;
    if (task.task_type === 'autotrain') {
      completionInstructions = `**AUTO-TRAIN LOOP — ITERATION ${autoTrainIterationNumber}**\nYou are continuously improving ONLY the current Mission Control workspace repository.\n\nExecute in order:\n1. INSPECT the repository for one high-value bug, UX issue, script weakness, traceability gap, or feature-enablement improvement.\n2. PROPOSE the change in ${autoTrainOutputDir}/proposal.md.\n3. IMPLEMENT exactly one focused improvement in the repo.\n4. VERIFY with the repo's own commands (prefer scripts/check.sh, then targeted validation if needed).\n5. RECORD artifacts in ${autoTrainOutputDir}.\n6. COMMIT your change with a concise message only if your runtime supports git safely; otherwise still record file evidence and verification.\n7. REPORT back to Mission Control and set the task to done so the daemon can start the next iteration.\n\nConstraints:\n- Work ONLY inside workspace repo: ${repoPath}\n- Write ALL loop artifacts under ${autoTrainOutputDir}\n- NEVER expose credentials, tokens, secrets, .env contents, or sensitive configs\n- NEVER work on any other workspace/repo\n- Keep diffs reviewable and focused\n\nPrevious iteration summaries:\n${autoTrainSummariesSection}\n\nWhen complete, call:\n1. POST ${missionControlUrl}/api/tasks/${task.id}/activities\n   Body: {"activity_type": "completed", "message": "Auto-Train iteration ${autoTrainIterationNumber}: [what improved, why, verification]"}\n2. POST ${missionControlUrl}/api/tasks/${task.id}/deliverables\n   Body: {"deliverable_type": "file", "title": "Iteration ${autoTrainIterationNumber} proposal", "path": "${autoTrainOutputDir}/proposal.md"}\n3. PATCH ${missionControlUrl}/api/tasks/${task.id}\n   Body: {"status": "done"}`;
    } else if (isBuilder) {
      completionInstructions = `**IMPORTANT:** After completing work, you MUST call these APIs:
1. Log activity: POST ${missionControlUrl}/api/tasks/${task.id}/activities
   Body: {"activity_type": "completed", "message": "Description of what was done"}
2. Register deliverable: POST ${missionControlUrl}/api/tasks/${task.id}/deliverables
   Body: {"deliverable_type": "file", "title": "File name", "path": "${taskProjectDir}/filename.html"}
3. Update status: PATCH ${missionControlUrl}/api/tasks/${task.id}
   Body: {"status": "${nextStatus}"}

When complete, reply with:
\`TASK_COMPLETE: [brief summary of what you did]\``;
    } else if (isTester) {
      completionInstructions = `**YOUR ROLE: TESTER** — Test the deliverables for this task.

Review the output directory for deliverables and run any applicable tests.

**If tests PASS:**
1. Log activity: POST ${missionControlUrl}/api/tasks/${task.id}/activities
   Body: {"activity_type": "completed", "message": "Tests passed: [summary]"}
2. Update status: PATCH ${missionControlUrl}/api/tasks/${task.id}
   Body: {"status": "${nextStatus}"}

**If tests FAIL:**
1. ${failEndpoint}
   Body: {"reason": "Detailed description of what failed and what needs fixing"}

Reply with: \`TEST_PASS: [summary]\` or \`TEST_FAIL: [what failed]\``;
    } else if (isVerifier) {
      completionInstructions = `**YOUR ROLE: VERIFIER** — Verify that all work meets quality standards.

Review deliverables, test results, and task requirements.

**If verification PASSES:**
1. Log activity: POST ${missionControlUrl}/api/tasks/${task.id}/activities
   Body: {"activity_type": "completed", "message": "Verification passed: [summary]"}
2. Update status: PATCH ${missionControlUrl}/api/tasks/${task.id}
   Body: {"status": "${nextStatus}"}

**If verification FAILS:**
1. ${failEndpoint}
   Body: {"reason": "Detailed description of what failed and what needs fixing"}

Reply with: \`VERIFY_PASS: [summary]\` or \`VERIFY_FAIL: [what failed]\``;
    } else {
      completionInstructions = `**IMPORTANT:** After completing work:
1. Update status: PATCH ${missionControlUrl}/api/tasks/${task.id}
   Body: {"status": "${nextStatus}"}`;
    }

    const roleLabel = currentStage?.label || 'Task';
    const taskMessage = `[${priorityLabel}] **${isBuilder ? 'NEW TASK ASSIGNED' : `${roleLabel.toUpperCase()} STAGE — ${task.title}`}**

**Title:** ${task.title}
${task.description ? `**Description:** ${task.description}\n` : ''}
**Priority:** ${task.priority.toUpperCase()}
${task.due_date ? `**Due:** ${task.due_date}\n` : ''}
**Task ID:** ${task.id}
${planningSpecSection}${agentInstructionsSection}${knowledgeSection}
${acpSection}${task.task_type === 'autotrain' ? `**OUTPUT DIRECTORY:** ${autoTrainOutputDir}\nThis iteration must write artifacts under the iteration directory inside .mission-control.\n` : isBuilder ? `**OUTPUT DIRECTORY:** ${taskProjectDir}\nCreate this directory and save all deliverables there. Do not write outside .mission-control/task pipeline path.\n` : `**OUTPUT DIRECTORY:** ${taskProjectDir}\nRead prior artifacts from this .mission-control path if needed.\n`}
${completionInstructions}

If you need help or clarification, ask the orchestrator.`;

    try {
      const prefix = agent.session_key_prefix || 'agent:main:';
      const sessionKey = `${prefix}${session.openclaw_session_id}`;
      const traceUrl = `${missionControlUrl}/api/tasks/${task.id}/sessions/${session.openclaw_session_id}/trace`;
      await client.call('chat.send', {
        sessionKey,
        message: taskMessage,
        idempotencyKey: `dispatch-${task.id}-${Date.now()}`,
      });

      run(
        `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          task.id,
          agent.id,
          'dispatch_invocation',
          `Dispatch invocation sent to ${agent.name}`,
          JSON.stringify({
            openclaw_session_id: session.openclaw_session_id,
            session_key: sessionKey,
            trace_url: traceUrl,
            output_directory: taskProjectDir,
            invocation: taskMessage,
          }),
          now,
        ],
      );

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

      const activityId = crypto.randomUUID();
      run(
        `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [activityId, task.id, agent.id, 'status_changed', `Task dispatched to ${agent.name} - Agent is now working on this task`, now]
      );

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
