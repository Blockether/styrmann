'use client';
import { X, CheckCircle2, Clock } from 'lucide-react';
import type { Task } from '@/lib/types';

interface Props {
  task: Task;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  inbox: 'text-gray-600',
  assigned: 'text-blue-600',
  in_progress: 'text-orange-600',
  testing: 'text-yellow-600',
  review: 'text-purple-600',
  verification: 'text-indigo-600',
  done: 'text-green-600',
};

export function WorkspaceTaskViewer({ task, onClose }: Props) {
  return (
    <div data-component="src/components/WorkspaceTaskViewer" className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded w-full max-w-lg shadow-lg max-h-[85vh] flex flex-col">
        <div className="p-3 border-b border-mc-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className={STATUS_COLORS[task.status] || 'text-mc-text-secondary'} />
            <span className="font-mono text-sm font-semibold text-mc-text truncate">{task.title}</span>
          </div>
          <button onClick={onClose} className="text-mc-text-secondary hover:text-mc-text"><X size={16} /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          <div className="text-xs text-mc-text-secondary font-mono uppercase tracking-wide">Read-only -- managed by orchestrator</div>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs px-2 py-0.5 rounded font-mono bg-mc-bg border border-mc-border text-mc-text-secondary">{task.status}</span>
            <span className="text-xs px-2 py-0.5 rounded font-mono bg-mc-bg border border-mc-border text-mc-text-secondary">{task.priority}</span>
            <span className="text-xs px-2 py-0.5 rounded font-mono bg-mc-bg border border-mc-border text-mc-text-secondary">{task.task_type}</span>
          </div>
          {task.description && <p className="text-sm text-mc-text">{task.description}</p>}
          <div className="flex gap-4 text-xs text-mc-text-secondary">
            {task.due_date && <span className="flex items-center gap-1"><Clock size={10} />{task.due_date}</span>}
          </div>
        </div>
        <div className="p-3 border-t border-mc-border flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-mc-text-secondary hover:text-mc-text border border-mc-border rounded">Close</button>
        </div>
      </div>
    </div>
  );
}
