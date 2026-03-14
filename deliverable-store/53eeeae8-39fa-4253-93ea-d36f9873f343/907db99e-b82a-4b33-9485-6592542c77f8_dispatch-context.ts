import { queryAll } from '@/lib/db';
import {
  getLearningsForFilePaths,
  getMemoriesForAgent,
  bumpMemoryRecall,
  getCodeContextForTask,
  getRelatedTasksByFilePaths,
} from './query-utils';
import type { ProjectLearning, AgentMemory, TaskCodeContext } from './types';

const MAX_LEARNINGS = 5;
const MAX_MEMORIES = 8;
const MAX_CODE_CONTEXT_ITEMS = 5;

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function buildLearningsContext(taskId: string, workspaceId: string): string {
  const taskFilePaths = queryAll<{ file_path: string }>(
    'SELECT DISTINCT file_path FROM task_code_context WHERE task_id = ?',
    [taskId],
  ).map((row) => row.file_path);

  let learnings: ProjectLearning[] = [];

  if (taskFilePaths.length > 0) {
    learnings = getLearningsForFilePaths(workspaceId, taskFilePaths, {
      limit: MAX_LEARNINGS,
    });
  }

  if (learnings.length < MAX_LEARNINGS) {
    const remaining = MAX_LEARNINGS - learnings.length;
    const existingIds = new Set(learnings.map((l) => l.id));
    const recentLearnings = queryAll<ProjectLearning>(
      `SELECT * FROM project_learnings
       WHERE workspace_id = ? AND is_active = 1
       ORDER BY confidence DESC, created_at DESC
       LIMIT ?`,
      [workspaceId, remaining + learnings.length],
    ).filter((l) => !existingIds.has(l.id));

    learnings = learnings.concat(recentLearnings.slice(0, remaining));
  }

  if (learnings.length === 0) return '';

  const items = learnings.map((learning, index) => {
    const confidenceLabel = learning.confidence !== null ? ` (confidence: ${learning.confidence})` : '';
    const lines = [`${index + 1}. [${learning.learning_type}] ${learning.title}${confidenceLabel}`];
    if (learning.summary) {
      lines.push(`   → ${truncate(learning.summary, 200)}`);
    }
    if (learning.related_file_paths) {
      try {
        const paths = JSON.parse(learning.related_file_paths) as string[];
        if (paths.length > 0) {
          lines.push(`   → Related files: ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ` (+${paths.length - 3} more)` : ''}`);
        }
      } catch { /* invalid JSON */ }
    }
    return lines.join('\n');
  });

  return `\n**RELEVANT PROJECT LEARNINGS:**\n${items.join('\n\n')}\n`;
}

export function buildMemoryContext(agentId: string, workspaceId: string): string {
  const memories = getMemoriesForAgent(agentId, workspaceId, { limit: MAX_MEMORIES });

  if (memories.length === 0) return '';

  bumpMemoryRecall(memories.map((m) => m.id));

  const items = memories.map((memory: AgentMemory) => {
    return `- [${memory.memory_type}] ${memory.title}: ${truncate(memory.content, 150)}`;
  });

  return `\n**AGENT MEMORY (operational knowledge):**\n${items.join('\n')}\n`;
}

export function buildCodeContextSection(taskId: string, workspaceId: string): string {
  const codeContextEntries = getCodeContextForTask(taskId);
  const relatedTasks = getRelatedTasksByFilePaths(taskId, workspaceId, { limit: MAX_CODE_CONTEXT_ITEMS });

  if (codeContextEntries.length === 0 && relatedTasks.length === 0) return '';

  const lines: string[] = [];

  if (codeContextEntries.length > 0) {
    lines.push('- Recent changes to these files:');
    const shown = codeContextEntries.slice(0, MAX_CODE_CONTEXT_ITEMS);
    for (const entry of shown) {
      const changeSuffix = entry.change_summary ? ` (${truncate(entry.change_summary, 80)})` : '';
      const typeSuffix = entry.change_type ? ` [${entry.change_type}]` : '';
      lines.push(`  - ${entry.file_path}${typeSuffix}${changeSuffix}`);
    }
    if (codeContextEntries.length > MAX_CODE_CONTEXT_ITEMS) {
      lines.push(`  - ... and ${codeContextEntries.length - MAX_CODE_CONTEXT_ITEMS} more files`);
    }
  }

  if (relatedTasks.length > 0) {
    const taskTitles = relatedTasks
      .slice(0, MAX_CODE_CONTEXT_ITEMS)
      .map((t) => `${t.title} (${t.status})`)
      .join(', ');
    lines.push(`- Related tasks touching same files: ${taskTitles}`);
  }

  return `\n**CODE CONTEXT:**\n${lines.join('\n')}\n`;
}

export function buildDatalagaContextSections(
  taskId: string,
  agentId: string,
  workspaceId: string,
): string {
  const learnings = buildLearningsContext(taskId, workspaceId);
  const memory = buildMemoryContext(agentId, workspaceId);
  const codeContext = buildCodeContextSection(taskId, workspaceId);

  return `${learnings}${memory}${codeContext}`;
}
