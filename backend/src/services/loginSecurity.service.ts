import { redisClient, isRedisReady } from './redis.service';
import { logAuthAudit } from '../utils/authAudit.logger';
import { logger } from '../utils/logger';

// In-memory fallback stores for when Redis is unavailable
interface MemoryAttemptRecord {
  count: number;
  expiresAt: number;
}

interface MemoryCooldownRecord {
  expiresAt: number;
  durationSeconds: number;
}

const memoryAttempts = new Map<string, MemoryAttemptRecord>();
const memoryCooldowns = new Map<string, MemoryCooldownRecord>();

// Periodic in-memory garbage collection every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryAttempts.entries()) {
    if (record.expiresAt <= now) {
      memoryAttempts.delete(key);
    }
  }
  for (const [key, record] of memoryCooldowns.entries()) {
    if (record.expiresAt <= now) {
      memoryCooldowns.delete(key);
    }
  }
}, 60 * 1000).unref();

const ATTEMPT_WINDOW_SECONDS = 15 * 60; // 15-minute sliding attempt window

/**
 * Determine progressive cooldown duration (in seconds) based on failed attempt count
 */
function getCooldownDurationForAttempt(attemptCount: number): number {
  if (attemptCount < 5) return 0;
  if (attemptCount === 5) return 60; // 1 minute cooldown
  if (attemptCount === 6) return 300; // 5 minute cooldown
  return 900; // 15 minute cooldown for 7+ consecutive failed attempts
}

/**
 * Check if an account is currently in temporary cooldown due to repeated failed logins.
 */
export async function checkAccountLoginCooldown(
  email: string
): Promise<{ inCooldown: boolean; retryAfterSeconds: number }> {
  const normalizedEmail = email.toLowerCase().trim();
  const cooldownKey = `account_cooldown:${normalizedEmail}`;

  if (isRedisReady()) {
    try {
      const ttl = await redisClient.ttl(cooldownKey);
      if (ttl > 0) {
        return { inCooldown: true, retryAfterSeconds: ttl };
      }
    } catch (err) {
      logger.warn('Redis cooldown check failed, falling back to memory store:', err);
    }
  }

  // Memory fallback
  const record = memoryCooldowns.get(normalizedEmail);
  if (record) {
    const remainingMs = record.expiresAt - Date.now();
    if (remainingMs > 0) {
      const retryAfterSeconds = Math.ceil(remainingMs / 1000);
      return { inCooldown: true, retryAfterSeconds };
    }
    memoryCooldowns.delete(normalizedEmail);
  }

  return { inCooldown: false, retryAfterSeconds: 0 };
}

/**
 * Record a failed login attempt for an account.
 * Updates attempt counter and triggers progressive temporary cooldown if threshold is reached.
 */
export async function recordFailedLoginAttempt(
  email: string,
  ip: string,
  userAgent?: string,
  correlationId?: string
): Promise<{ attemptCount: number; cooldownSeconds: number }> {
  const normalizedEmail = email.toLowerCase().trim();
  const attemptsKey = `account_attempts:${normalizedEmail}`;
  const cooldownKey = `account_cooldown:${normalizedEmail}`;

  let attemptCount = 1;

  if (isRedisReady()) {
    try {
      const current = await redisClient.incr(attemptsKey);
      if (current === 1) {
        await redisClient.expire(attemptsKey, ATTEMPT_WINDOW_SECONDS);
      }
      attemptCount = current;
    } catch (err) {
      logger.warn('Redis attempt increment failed, using in-memory store:', err);
      attemptCount = incrementMemoryAttempt(normalizedEmail);
    }
  } else {
    attemptCount = incrementMemoryAttempt(normalizedEmail);
  }

  const cooldownSeconds = getCooldownDurationForAttempt(attemptCount);

  if (cooldownSeconds > 0) {
    if (isRedisReady()) {
      try {
        await redisClient.setex(cooldownKey, cooldownSeconds, '1');
      } catch (err) {
        logger.warn('Redis setex cooldown failed, using in-memory store:', err);
        setMemoryCooldown(normalizedEmail, cooldownSeconds);
      }
    } else {
      setMemoryCooldown(normalizedEmail, cooldownSeconds);
    }

    logAuthAudit({
      event: 'ACCOUNT_COOLDOWN_TRIGGERED',
      email: normalizedEmail,
      ip,
      userAgent,
      correlationId,
      attemptCount,
      reason: `Account exceeded failed attempt threshold (${attemptCount} attempts). Enforced ${cooldownSeconds}s temporary cooldown.`,
    });
  } else {
    logAuthAudit({
      event: 'LOGIN_FAILED',
      email: normalizedEmail,
      ip,
      userAgent,
      correlationId,
      attemptCount,
      reason: 'Invalid credentials provided.',
    });
  }

  return { attemptCount, cooldownSeconds };
}

/**
 * Reset failed login attempts and clear temporary cooldown upon successful login.
 */
export async function recordSuccessfulLogin(
  email: string,
  ip: string,
  userId: string,
  userAgent?: string,
  correlationId?: string
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const attemptsKey = `account_attempts:${normalizedEmail}`;
  const cooldownKey = `account_cooldown:${normalizedEmail}`;

  if (isRedisReady()) {
    try {
      await redisClient.del(attemptsKey, cooldownKey);
    } catch (err) {
      logger.warn('Redis reset on successful login failed, clearing memory store:', err);
    }
  }

  memoryAttempts.delete(normalizedEmail);
  memoryCooldowns.delete(normalizedEmail);

  logAuthAudit({
    event: 'LOGIN_SUCCESS',
    userId,
    email: normalizedEmail,
    ip,
    userAgent,
    correlationId,
    reason: 'Credentials verified and session initiated successfully.',
  });
}

// ── Memory Store Helpers ──────────────────────────────────────────

function incrementMemoryAttempt(email: string): number {
  const now = Date.now();
  const existing = memoryAttempts.get(email);
  if (existing && existing.expiresAt > now) {
    existing.count += 1;
    return existing.count;
  }
  const count = 1;
  memoryAttempts.set(email, {
    count,
    expiresAt: now + ATTEMPT_WINDOW_SECONDS * 1000,
  });
  return count;
}

function setMemoryCooldown(email: string, durationSeconds: number): void {
  const now = Date.now();
  memoryCooldowns.set(email, {
    expiresAt: now + durationSeconds * 1000,
    durationSeconds,
  });
}

