export const DEFAULT_AGENT_ROLE_OPTIONS = [
  'orchestrator',
  'builder',
  'tester',
  'reviewer',
  'explorer',
  'pragmatist',
  'guardian',
  'consolidator',
] as const;

export const REQUIRED_DEFAULT_AGENT_ROLES = [
  'orchestrator',
  'builder',
  'tester',
  'reviewer',
] as const;

export function formatAgentRoleLabel(role: string): string {
  return role
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
