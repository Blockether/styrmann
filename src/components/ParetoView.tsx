'use client';

import { useState, useMemo } from 'react';
import {
  Zap,
  Briefcase,
  Clock,
  XCircle,
  AlertCircle,
  Target,
  ChevronRight,
} from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { TaskModal } from '@/components/TaskModal';
import type { Task, TaskType } from '@/lib/types';

const TASK_TYPE_COLORS: Record<TaskType, string> = {
  bug: 'bg-mc-accent-red',
  feature: 'bg-blue-500',
  chore: 'bg-mc-text-secondary',
  documentation: 'bg-mc-accent-purple',
  research: 'bg-mc-accent-green',
  autotrain: 'bg-amber-500',
};

const TASK_TYPE_BORDER_COLORS: Record<TaskType, string> = {
  bug: 'border-mc-accent-red',
  feature: 'border-blue-500',
  chore: 'border-mc-text-secondary',
  documentation: 'border-mc-accent-purple',
  research: 'border-mc-accent-green',
  autotrain: 'border-amber-500',
};

interface TaskWithPosition extends Task {
  gridRow: number;
  gridCol: number;
}

interface ParetoViewProps {
  workspaceId: string;
}

export function ParetoView({ workspaceId }: ParetoViewProps) {
  const { tasks } = useMissionControl();
  const [hoveredTask, setHoveredTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const { scoredTasks, unscoredTasks, quickWinsCount } = useMemo(() => {
    const scored = tasks.filter(
      (task) => task.effort !== null && task.effort !== undefined && task.impact !== null && task.impact !== undefined
    );
    const unscored = tasks.filter(
      (task) => task.effort === null || task.effort === undefined || task.impact === null || task.impact === undefined
    );
    const quickWins = scored.filter(
      (task) => (task.impact ?? 0) >= 4 && (task.effort ?? 5) <= 3
    );

    return {
      scoredTasks: scored,
      unscoredTasks: unscored,
      quickWinsCount: quickWins.length,
    };
  }, [tasks]);

  const tasksWithPosition = useMemo((): TaskWithPosition[] => {
    return scoredTasks.map((task) => {
      const gridCol = task.effort ?? 3;
      const gridRow = 6 - (task.impact ?? 3);
      return { ...task, gridRow, gridCol };
    });
  }, [scoredTasks]);

  const tasksByCell = useMemo(() => {
    const map = new Map<string, TaskWithPosition[]>();
    for (const task of tasksWithPosition) {
      const key = `${task.gridRow}-${task.gridCol}`;
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return map;
  }, [tasksWithPosition]);

  return (
    <div data-component="src/components/ParetoView" className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-medium">Pareto</span>
          <span className="text-sm text-mc-text-secondary">{scoredTasks.length} scored, {tasks.length} total</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4">
            <div className="text-xs uppercase text-mc-text-secondary">Total Tasks</div>
            <div className="text-2xl font-semibold mt-1">{tasks.length}</div>
          </div>
          <div className="bg-mc-accent-green/10 border border-mc-accent-green/30 rounded-xl p-4">
            <div className="text-xs uppercase text-mc-accent-green">Quick Wins</div>
            <div className="text-2xl font-semibold mt-1 text-mc-accent-green">{quickWinsCount}</div>
          </div>
          <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4">
            <div className="text-xs uppercase text-mc-text-secondary">Scored</div>
            <div className="text-2xl font-semibold mt-1">{scoredTasks.length}</div>
          </div>
          <div className="bg-mc-accent-yellow/10 border border-mc-accent-yellow/30 rounded-xl p-4">
            <div className="text-xs uppercase text-mc-accent-yellow">Unscored</div>
            <div className="text-2xl font-semibold mt-1 text-mc-accent-yellow">{unscoredTasks.length}</div>
          </div>
        </section>

        <section className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-mc-accent" />
            <h2 className="font-semibold">Impact vs Effort Matrix</h2>
          </div>

          <div className="relative">
            <div className="absolute -left-2 top-1/2 -translate-y-1/2 -rotate-90 text-sm font-medium text-mc-text-secondary whitespace-nowrap">
              Impact
            </div>

            <div className="ml-8 mr-4">
              <div className="relative aspect-square max-w-2xl mx-auto">
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5">
                  <div className="bg-mc-accent-green/10 rounded-tl-lg border border-mc-accent-green/20 relative">
                    <div className="absolute top-2 left-2 text-xs font-medium text-mc-accent-green flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      Quick Wins
                    </div>
                    <div className="absolute bottom-2 left-2 text-[10px] text-mc-accent-green/70">DO FIRST</div>
                  </div>

                  <div className="bg-blue-500/10 rounded-tr-lg border border-blue-500/20 relative">
                    <div className="absolute top-2 right-2 text-xs font-medium text-blue-600 flex items-center gap-1">
                      <Briefcase className="w-3 h-3" />
                      Major Projects
                    </div>
                    <div className="absolute bottom-2 right-2 text-[10px] text-blue-600/70">PLAN</div>
                  </div>

                  <div className="bg-mc-text-secondary/5 rounded-bl-lg border border-mc-text-secondary/20 relative">
                    <div className="absolute bottom-2 left-2 text-xs font-medium text-mc-text-secondary flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Fill-ins
                    </div>
                    <div className="absolute top-2 left-2 text-[10px] text-mc-text-secondary/70">DO LATER</div>
                  </div>

                  <div className="bg-mc-accent-red/10 rounded-br-lg border border-mc-accent-red/20 relative">
                    <div className="absolute bottom-2 right-2 text-xs font-medium text-mc-accent-red flex items-center gap-1">
                      <XCircle className="w-3 h-3" />
                      Avoid
                    </div>
                    <div className="absolute top-2 right-2 text-[10px] text-mc-accent-red/70">DEPRIORITIZE</div>
                  </div>
                </div>

                <div className="absolute inset-0 grid grid-cols-5 grid-rows-5">
                  {Array.from({ length: 25 }).map((_, index) => {
                    const row = Math.floor(index / 5) + 1;
                    const col = (index % 5) + 1;
                    const cellKey = `${row}-${col}`;
                    const cellTasks = tasksByCell.get(cellKey) || [];

                    return (
                      <div
                        key={index}
                        className="relative border border-mc-border/30 flex items-center justify-center"
                      >
                        {cellTasks.length > 0 && (
                          <div className="relative w-full h-full">
                            {cellTasks.slice(0, 5).map((task, i) => (
                              <button
                                key={task.id}
                                onClick={() => setEditingTask(task)}
                                className={`absolute w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full border-2 ${TASK_TYPE_COLORS[task.task_type]} ${TASK_TYPE_BORDER_COLORS[task.task_type]} cursor-pointer hover:scale-150 hover:z-20 hover:shadow-lg transition-transform`}
                                style={{
                                  left: `${15 + i * 12}%`,
                                  top: `${40 + (i % 3) * 10}%`,
                                }}
                                onMouseEnter={() => setHoveredTask(task)}
                                onMouseLeave={() => setHoveredTask(null)}
                                title={task.title}
                              >
                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 text-[8px] sm:text-[9px] leading-tight font-medium text-mc-text whitespace-nowrap max-w-[80px] sm:max-w-[100px] truncate pointer-events-none">
                                  {task.title}
                                </span>
                              </button>
                            ))}
                            {cellTasks.length > 5 && (
                              <div className="absolute bottom-1 right-1 text-[9px] bg-mc-bg-secondary/90 px-1 rounded text-mc-text-secondary">
                                +{cellTasks.length - 5}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="absolute -left-6 top-0 bottom-0 flex flex-col-reverse justify-between py-2 text-xs text-mc-text-secondary">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                  <span>5</span>
                </div>
              </div>

              <div className="text-center text-sm font-medium text-mc-text-secondary mt-2">
                Effort
              </div>
              <div className="flex justify-center gap-8 text-xs text-mc-text-secondary mt-1">
                <span>1 (Low)</span>
                <span>5 (High)</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 mt-6 pt-4 border-t border-mc-border">
            <span className="text-xs text-mc-text-secondary">Task Types:</span>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-mc-accent-red" />
              <span className="text-xs">Bug</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-xs">Feature</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-mc-text-secondary" />
              <span className="text-xs">Chore</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-mc-accent-purple" />
              <span className="text-xs">Docs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-mc-accent-green" />
              <span className="text-xs">Research</span>
            </div>
          </div>
        </section>

        {hoveredTask && (
          <div className="fixed bottom-4 left-4 bg-mc-bg-secondary border border-mc-border rounded-xl p-4 shadow-xl max-w-xs z-50">
            <div className="font-medium text-sm mb-1 line-clamp-2">{hoveredTask.title}</div>
            <div className="text-xs text-mc-text-secondary space-y-1">
              <div>Impact: {hoveredTask.impact} / Effort: {hoveredTask.effort}</div>
              {hoveredTask.assigned_agent && (
                <div>Assigned: {(hoveredTask.assigned_agent as { name: string }).name}</div>
              )}
              <div className="capitalize">Type: {hoveredTask.task_type}</div>
            </div>
          </div>
        )}

        {unscoredTasks.length > 0 && (
          <section className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="w-5 h-5 text-mc-accent-yellow" />
              <h2 className="font-semibold">Unscored Tasks</h2>
              <span className="text-sm text-mc-text-secondary">({unscoredTasks.length})</span>
            </div>
            <p className="text-sm text-mc-text-secondary mb-4">
              These tasks need impact and effort scores to appear on the matrix. Score them to prioritize effectively.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {unscoredTasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => setEditingTask(task)}
                  className="p-3 bg-mc-bg border border-mc-border rounded-lg hover:border-mc-accent/50 transition-colors text-left"
                >
                  <div className="font-medium text-sm line-clamp-1">{task.title}</div>
                  <div className="text-xs text-mc-text-secondary mt-1 flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${TASK_TYPE_COLORS[task.task_type]} text-white`}>
                      {task.task_type}
                    </span>
                    <span className="capitalize">{task.priority}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      </div>

      {editingTask && (
        <TaskModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}
