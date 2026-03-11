import type { CreateTaskInput } from '@/lib/validation';

export function inferEffortImpact(input: Pick<CreateTaskInput, 'description' | 'priority' | 'task_type' | 'title'>): { effort: number; impact: number } {
  const text = `${input.title || ''} ${input.description || ''}`.toLowerCase();
  let effort = 2;
  let impact = 2;

  if (input.priority === 'high') impact += 1;
  if (input.priority === 'urgent') impact += 2;
  if (input.task_type === 'bug') impact += 1;
  if (input.task_type === 'feature') effort += 1;
  if (input.task_type === 'research') effort += 1;

  const complexitySignals = ['refactor', 'migration', 'architecture', 'workflow', 'integration', 'multi', 'cross', 'deploy'];
  const riskSignals = ['production', 'security', 'critical', 'failure', 'stale', 'blocked'];
  const simpleSignals = ['copy', 'label', 'rename', 'typo', 'text', 'small'];

  for (const token of complexitySignals) {
    if (text.includes(token)) effort += 1;
  }
  for (const token of riskSignals) {
    if (text.includes(token)) impact += 1;
  }
  for (const token of simpleSignals) {
    if (text.includes(token)) effort -= 1;
  }

  const clamp = (value: number) => Math.max(1, Math.min(5, value));
  return { effort: clamp(effort), impact: clamp(impact) };
}
