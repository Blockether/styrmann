/**
 * Organization Configuration Helpers
 * 
 * Provides utilities for singular organization mode and default org settings.
 */

export function isSingularOrgMode(): boolean {
  return process.env.STYRMAN_SINGULAR_ORG === 'true';
}

export function getDefaultOrgName(): string {
  return process.env.STYRMAN_DEFAULT_ORG_NAME || 'Default';
}
