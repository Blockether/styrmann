import { createHmac, timingSafeEqual } from 'crypto';

function getTokenSecrets(): string[] {
  const token = (process.env.STYRMAN_API_TOKEN || '').trim();
  return token.length > 0 ? [token] : [];
}

export interface ScopedTokenPayload {
  v: 1 | 2;
  iat: number;
  exp: number;
  jti: string;
  task_id?: string;
  workspace_id?: string;
  session_id?: string;
  scopes: string[];
}

export function generateScopedApiToken(input: {
  scopes: string[];
  taskId?: string;
  workspaceId?: string;
  sessionId?: string;
  ttlSeconds?: number;
}): string {
  const secrets = getTokenSecrets();
  const primarySecret = secrets[0];
  if (!primarySecret) {
  throw new Error('STYRMAN_API_TOKEN is required to generate scoped API tokens');
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(60, input.ttlSeconds || 6 * 60 * 60);
  const payload: ScopedTokenPayload = {
    v: 2,
    iat: now,
    exp,
    jti: crypto.randomUUID(),
    task_id: input.taskId,
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    scopes: Array.from(new Set(input.scopes.filter(Boolean))),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', primarySecret).update(encoded).digest('base64url');
  return `mcst.${encoded}.${signature}`;
}

export function verifyScopedApiToken(token: string): ScopedTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'mcst') return null;
  const [, encoded, signature] = parts;
  const secrets = getTokenSecrets();
  if (secrets.length === 0) return null;

  let validSignature = false;
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
    try {
      if (timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        validSignature = true;
        break;
      }
    } catch {
      continue;
    }
  }
  if (!validSignature) return null;

  let parsed: ScopedTokenPayload;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ScopedTokenPayload;
  } catch {
    return null;
  }
  if (!parsed || ![1, 2].includes(parsed.v) || !Array.isArray(parsed.scopes)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!parsed.exp || parsed.exp < now) return null;
  return parsed;
}
