'use client';

import { create } from 'zustand';
import { debug } from './debug';
import type { Agent, Task, Event, TaskStatus, AgentSession } from './types';

interface StyrmannState {
  // Data
  agents: Agent[];
  tasks: Task[];
  events: Event[];

  agentSessions: Record<string, AgentSession | null>;

  // UI State
  selectedAgent: Agent | null;
  selectedTask: Task | null;
  selectedSprintId: string | null;
  isOnline: boolean;
  isLoading: boolean;
  // Actions
  setAgents: (agents: Agent[]) => void;
  setTasks: (tasks: Task[]) => void;
  setEvents: (events: Event[]) => void;
  addEvent: (event: Event) => void;
  setSelectedAgent: (agent: Agent | null) => void;
  setSelectedTask: (task: Task | null) => void;
  setSelectedSprintId: (id: string | null) => void;
  setIsOnline: (online: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  // Task mutations
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  updateTask: (task: Task) => void;
  addTask: (task: Task) => void;
  removeTask: (taskId: string) => void;

  // Agent mutations
  updateAgent: (agent: Agent) => void;
  addAgent: (agent: Agent) => void;

  setAgentSession: (agentId: string, session: AgentSession | null) => void;
}

export const useStyrmann = create<StyrmannState>((set) => ({
  // Initial state
  agents: [],
  tasks: [],
  events: [],
  agentSessions: {},
  selectedAgent: null,
  selectedTask: null,
  selectedSprintId: null,
  isOnline: true,
  isLoading: true,


  // Setters
  setAgents: (agents) => set({ agents }),
  setTasks: (tasks) => {
    debug.store('setTasks called', { count: tasks.length });
    set({ tasks });
  },
  setEvents: (events) => set({ events }),
  addEvent: (event) =>
    set((state) => ({ events: [event, ...state.events].slice(0, 100) })),
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  setSelectedTask: (task) => {
    debug.store('setSelectedTask called', { id: task?.id, status: task?.status });
    set({ selectedTask: task });
  },
  setSelectedSprintId: (id) => set({ selectedSprintId: id }),
  setIsOnline: (online) => {
    debug.store('setIsOnline called', { online });
    set({ isOnline: online });
  },
  setIsLoading: (loading) => set({ isLoading: loading }),


  // Task mutations
  updateTaskStatus: (taskId, status) => {
    debug.store('updateTaskStatus called', { taskId, status });
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, status } : task
      ),
    }));
  },
  updateTask: (updatedTask) => {
    debug.store('updateTask called', { id: updatedTask.id, status: updatedTask.status });
    set((state) => {
      const oldTask = state.tasks.find(t => t.id === updatedTask.id);
      if (oldTask) {
        debug.store('Task state change', {
          id: updatedTask.id,
          oldStatus: oldTask.status,
          newStatus: updatedTask.status
        });
      } else {
        debug.store('Task not found in store, adding', { id: updatedTask.id });
      }
      return {
        tasks: state.tasks.map((task) =>
          task.id === updatedTask.id ? updatedTask : task
        ),
      };
    });
  },
  addTask: (task) => {
    debug.store('addTask called', { id: task.id, title: task.title });
    set((state) => {
      // Dedupe: don't add if already exists
      if (state.tasks.some((t) => t.id === task.id)) {
        debug.store('Task already exists, skipping add', { id: task.id });
        return state;
      }
      return { tasks: [task, ...state.tasks] };
    });
  },
  removeTask: (taskId) => {
    debug.store('removeTask called', { taskId });
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== taskId) }));
  },

  // Agent mutations
  updateAgent: (updatedAgent) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === updatedAgent.id ? updatedAgent : agent
      ),
    })),
  addAgent: (agent) => set((state) => ({ agents: [...state.agents, agent] })),

  setAgentSession: (agentId: string, session: AgentSession | null) =>
    set((state) => ({
      agentSessions: { ...state.agentSessions, [agentId]: session },
    })),
}));
