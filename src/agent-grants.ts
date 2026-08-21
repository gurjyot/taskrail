import { createHash, timingSafeEqual } from 'node:crypto';
import { authorizeAgentAction, type AgentAuthorizationPolicy } from './agent-surface.js';

export interface AgentGrant {
  schema: 1;
  grantId: string;
  sessionId: string;
  actions: string[];
  issuedAt: string;
  expiresAt: string;
  nonceHash: string;
}

export interface AgentGrantCheck {
  allowed: boolean;
  reason: string;
}

export function hashGrantNonce(nonce: string) {
  return createHash('sha256').update(nonce).digest('hex');
}

export function createAgentGrant(input: {
  grantId: string;
  sessionId: string;
  actions: string[];
  nonce: string;
  ttlMs?: number;
  now?: Date;
}): AgentGrant {
  const now = input.now ?? new Date();
  const ttlMs = Math.max(1_000, Math.min(input.ttlMs ?? 5 * 60_000, 60 * 60_000));
  return {
    schema: 1,
    grantId: input.grantId,
    sessionId: input.sessionId,
    actions: [...new Set(input.actions)].sort(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    nonceHash: hashGrantNonce(input.nonce),
  };
}

export function authorizeAgentGrant(input: {
  grant: AgentGrant;
  action: string;
  sessionId: string;
  nonce: string;
  now?: Date;
  policy?: AgentAuthorizationPolicy;
}): AgentGrantCheck {
  const { grant } = input;
  if (grant.schema !== 1) return { allowed: false, reason: 'unsupported-grant-schema' };
  if (grant.sessionId !== input.sessionId) return { allowed: false, reason: 'session-mismatch' };
  if (!grant.actions.includes(input.action)) return { allowed: false, reason: 'action-not-granted' };
  const now = input.now ?? new Date();
  if (Number.isNaN(Date.parse(grant.expiresAt)) || now.getTime() >= Date.parse(grant.expiresAt)) return { allowed: false, reason: 'grant-expired' };
  const expected = Buffer.from(grant.nonceHash, 'hex');
  const actual = Buffer.from(hashGrantNonce(input.nonce), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { allowed: false, reason: 'grant-proof-invalid' };
  const base = authorizeAgentAction(input.action, input.policy ?? { allow: [input.action] });
  if (!base.allowed) return { allowed: false, reason: `base-policy:${base.reason}` };
  return { allowed: true, reason: 'scoped-grant' };
}
