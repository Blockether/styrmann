/**
 * Temporary signed tokens for workspace file access.
 * Generates HMAC-SHA256 signed URLs that grant time-limited access
 * to specific workspace files without requiring session auth.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const FILE_TOKEN_SECRET = process.env.STYRMAN_API_TOKEN || randomBytes(32).toString('hex');

/**
 * Generate a signed token for accessing a specific workspace file.
 * Token is bound to agent ID, scope, and file path.
 */
export function generateFileToken(
  agentId: string,
  scope: string,
  path: string,
  expiresInSeconds: number = 7200, // 2 hours default
): { token: string; expires: number } {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `file:${agentId}:${scope}:${path}:${expires}`;
  const token = createHmac('sha256', FILE_TOKEN_SECRET)
    .update(payload)
    .digest('base64url');
  return { token, expires };
}

/**
 * Validate a signed file token.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function validateFileToken(
  token: string,
  expires: string | number,
  agentId: string,
  scope: string,
  path: string,
): boolean {
  const expiresNum = typeof expires === 'string' ? parseInt(expires, 10) : expires;
  if (isNaN(expiresNum)) return false;

  // Check expiry
  if (Math.floor(Date.now() / 1000) > expiresNum) return false;

  // Recompute expected token
  const payload = `file:${agentId}:${scope}:${path}:${expiresNum}`;
  const expected = createHmac('sha256', FILE_TOKEN_SECRET)
    .update(payload)
    .digest('base64url');

  // Constant-time comparison
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false; // Length mismatch
  }
}
