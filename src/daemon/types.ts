export interface DaemonConfig {
  mcUrl: string;
  mcToken: string;
  heartbeatIntervalMs: number;
  dispatchIntervalMs: number;
  schedulerIntervalMs: number;
  logPollIntervalMs: number;
  recoveryIntervalMs: number;
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
  lastHealthTick?: string;
  lastRouterTick?: string;
  lastHeartbeatTick?: string;
  lastDispatchTick?: string;
  lastSchedulerTick?: string;
  lastLogPollTick?: string;
  lastRecoveryTick?: string;
  dispatchedCount: number;
  heartbeatCount: number;
  staleRecoveredCount: number;
  scheduledRunCount: number;
  scheduledFailureCount: number;
  routedEventCount: number;
  logEntriesStored?: number;
  logEntriesCleaned?: number;
  stalledRedispatchedCount?: number;
  stalledReassignedCount?: number;
}
