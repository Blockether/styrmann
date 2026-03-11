'use client';

import { ActivityLog } from './ActivityLog';

interface TaskActivityExecutionViewProps {
  taskId: string;
}

export function TaskActivityExecutionView({ taskId }: TaskActivityExecutionViewProps) {
  return (
    <div data-component="src/components/TaskActivityExecutionView">
      <ActivityLog taskId={taskId} />
    </div>
  );
}
