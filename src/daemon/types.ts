export interface DaemonConfig {
  mcUrl: string;
  mcToken: string;
  heartbeatIntervalMs: number;
  dispatchIntervalMs: number;
  schedulerIntervalMs: number;
}

export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  handler: () => Promise<void>;
  enabled: boolean;
}

export interface DaemonStats {
  startedAt: number;
  lastHeartbeatTick?: string;
  lastDispatchTick?: string;
  lastSchedulerTick?: string;
  dispatchedCount: number;
  heartbeatCount: number;
  staleRecoveredCount: number;
  scheduledRunCount: number;
  scheduledFailureCount: number;
  routedEventCount: number;
}
