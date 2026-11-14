import { logger } from './logger';

export type AuthEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'ACCOUNT_COOLDOWN_TRIGGERED'
  | 'REFRESH_TOKEN_ROTATED'
  | 'REFRESH_TOKEN_REUSE_DETECTED'
  | 'LOGOUT'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED';

export interface AuthAuditEvent {
  event: AuthEventType;
  userId?: string | null;
  email?: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
  attemptCount?: number;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * Structured security audit logging for all authentication & authorization lifecycle events.
 * Strictly guarantees that passwords, OTPs, raw tokens, cookie values and secrets are never logged.
 */
export function logAuthAudit(event: AuthAuditEvent): void {
  const sanitizedEmail = event.email ? event.email.toLowerCase().trim() : undefined;
  const ip = event.ip || 'unknown';
  const timestamp = new Date().toISOString();

  const auditPayload = {
    type: 'AUTH_AUDIT',
    event: event.event,
    timestamp,
    userId: event.userId || undefined,
    email: sanitizedEmail,
    ip,
    userAgent: event.userAgent ? String(event.userAgent).slice(0, 200) : undefined,
    correlationId: event.correlationId,
    attemptCount: event.attemptCount,
    reason: event.reason,
  };

  if (
    event.event === 'LOGIN_FAILED' ||
    event.event === 'RATE_LIMIT_EXCEEDED' ||
    event.event === 'ACCOUNT_COOLDOWN_TRIGGERED' ||
    event.event === 'REFRESH_TOKEN_REUSE_DETECTED'
  ) {
    logger.warn(`[SECURITY AUDIT] ${event.event}: email=${sanitizedEmail ?? 'unknown'}, ip=${ip}, reason=${event.reason ?? 'N/A'}`);
  } else {
    logger.info(`[SECURITY AUDIT] ${event.event}: userId=${event.userId ?? 'anonymous'}, email=${sanitizedEmail ?? 'unknown'}, ip=${ip}`);
  }
}

