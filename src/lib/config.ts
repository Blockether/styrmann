/**
 * Configuration Management
 *
 * Server-side config from environment variables.
 * Client-side config stored in localStorage.
 */

export interface MissionControlConfig {
  missionControlUrl: string;
}

const DEFAULT_CONFIG: MissionControlConfig = {
  missionControlUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000',
};

const CONFIG_KEY = 'mission-control-config';

export function getConfig(): MissionControlConfig {
  if (typeof window === 'undefined') {
    return DEFAULT_CONFIG;
  }

  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }

  return DEFAULT_CONFIG;
}

export function updateConfig(updates: Partial<MissionControlConfig>): void {
  if (typeof window === 'undefined') {
    throw new Error('Cannot update config on server side');
  }

  if (updates.missionControlUrl !== undefined) {
    try {
      new URL(updates.missionControlUrl);
    } catch {
      throw new Error('Invalid Mission Control URL');
    }
  }

  const current = getConfig();
  const updated = { ...current, ...updates };

  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Failed to save config:', error);
    throw new Error('Failed to save configuration');
  }
}

export function resetConfig(): void {
  if (typeof window === 'undefined') {
    throw new Error('Cannot reset config on server side');
  }

  localStorage.removeItem(CONFIG_KEY);
}

export function getMissionControlUrl(): string {
  if (typeof window === 'undefined') {
    return process.env.MISSION_CONTROL_URL || 'http://localhost:4000';
  }

  return getConfig().missionControlUrl;
}

export function getProjectsPath(): string {
  return process.env.PROJECTS_PATH || '/root/repos';
}
