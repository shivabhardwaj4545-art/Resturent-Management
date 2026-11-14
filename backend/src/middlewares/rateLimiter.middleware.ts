import rateLimit, { Store, MemoryStore } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../services/redis.service';
import { logger } from '../utils/logger';
import { logAuthAudit } from '../utils/authAudit.logger';

class FallbackStore implements Store {
  private redisStore: RedisStore;
  private memoryStore: MemoryStore;

  constructor() {
    this.redisStore = new RedisStore({
      sendCommand: (...args: string[]) => {
        if (redisClient.status !== 'ready') {
          return Promise.reject(new Error('Redis is not ready'));
        }
        return redisClient.call(args[0], ...args.slice(1)) as Promise<any>;
      },
    });
    this.memoryStore = new MemoryStore();
  }

  init(options: any) {
    if (this.isRedisReady && this.redisStore.init) {
      Promise.resolve(this.redisStore.init(options)).catch(() => {
        logger.warn('Redis rate-limit store initialization failed. Operating with memory fallback.');
      });
    }
    this.memoryStore.init(options);
  }

  private get isRedisReady(): boolean {
    return redisClient.status === 'ready';
  }

  async get(key: string) {
    if (this.isRedisReady) {
      try {
        return await this.redisStore.get?.(key);
      } catch {
        // Fall through
      }
    }
    return this.memoryStore.get(key);
  }

  async increment(key: string) {
    if (this.isRedisReady) {
      try {
        return await this.redisStore.increment(key);
      } catch {
        // Fall through
      }
    }
    return this.memoryStore.increment(key);
  }

  async decrement(key: string) {
    if (this.isRedisReady) {
      try {
        return await this.redisStore.decrement(key);
      } catch {
        // Fall through
      }
    }
    return this.memoryStore.decrement(key);
  }

  async resetKey(key: string) {
    if (this.isRedisReady) {
      try {
        return await this.redisStore.resetKey(key);
      } catch {
        // Fall through
      }
    }
    return this.memoryStore.resetKey(key);
  }

  async resetAll() {
    if (this.isRedisReady) {
      try {
        return await (this.redisStore as any).resetAll?.();
      } catch {
        // Fall through
      }
    }
    return this.memoryStore.resetAll();
  }

  async shutdown() {
    if ((this.redisStore as any).shutdown) await (this.redisStore as any).shutdown();
    this.memoryStore.shutdown();
  }
}

  const createLimiter = (windowMs: number, max: number, message: string, code = 'RATE_LIMIT_EXCEEDED') => {
    const isTest = process.env.NODE_ENV === 'test';
    const finalMax = isTest ? 10000 : max;

    return rateLimit({
      windowMs,
      max: finalMax,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { singleCount: false },
      handler: (req, res) => {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        logAuthAudit({
          event: 'RATE_LIMIT_EXCEEDED',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          reason: `${message} (Limit: ${finalMax} per ${Math.round(windowMs / 60000)}m, Path: ${req.originalUrl || req.url})`,
        });
        res.status(429).json({
          success: false,
          error: message,
          code,
          retryAfter,
        });
      },
      skip: (req) => {
        // Never rate-limit in automated tests
        if (process.env.NODE_ENV === 'test') return true;
        // Always allow payment status polling and health checks
        if (req.path?.includes('/status') || req.path?.includes('/health')) return true;
        return false;
      },
      store: new FallbackStore(),
    });
  };

  // General API limit: 1200 req per 15 minutes in production
  export const generalLimiter = createLimiter(
    15 * 60 * 1000,
  1200,
    'Too many requests. Please try again in 15 minutes.',
    'RATE_LIMIT_EXCEEDED'
  );

// Dedicated Login IP limiter: 60 attempts per 15 minutes per IP
// Protects against IP-based brute-force while allowing multiple legitimate users behind shared NAT/office IPs
export const loginIpLimiter = createLimiter(
    15 * 60 * 1000,
    60,
    'Too many login attempts from this network. Please wait a few minutes before trying again.',
    'LOGIN_RATE_LIMIT_EXCEEDED'
  );

  // Dedicated Refresh Token limiter: 180 requests per 15 minutes per IP
  // Completely decoupled from login so active tab polling/refresh never blocks login attempts
  export const refreshTokenLimiter = createLimiter(
    15 * 60 * 1000,
    180,
    'Too many session refresh requests. Please wait a moment.',
    'REFRESH_RATE_LIMIT_EXCEEDED'
  );

  // Registration limiter: 15 accounts per hour per IP
  export const registerLimiter = createLimiter(
    60 * 60 * 1000,
    15,
  'Too many accounts created from this network. Please wait an hour before registering again.',
    'REGISTER_RATE_LIMIT_EXCEEDED'
  );

  // Password reset: 5 attempts per hour per IP
  export const passwordResetLimiter = createLimiter(
    60 * 60 * 1000,
  5,
    'Too many password reset requests. Please wait 1 hour.',
    'PASSWORD_RESET_RATE_LIMIT_EXCEEDED'
  );

  // Backward-compatible export: alias to loginIpLimiter
  export const authLimiter = loginIpLimiter;

  // AI routes: 10 req per minute
  export const aiLimiter = createLimiter(
    60 * 1000,
    10,
  'Too many AI requests. Please slow down.',
    'AI_RATE_LIMIT_EXCEEDED'
  );

  // Counter verification code lookup limiter: 30 attempts per minute
  export const counterLookupLimiter = createLimiter(
    60 * 1000,
    30,
  'Too many verification code attempts. Please wait a moment.',
    'COUNTER_LOOKUP_RATE_LIMIT_EXCEEDED'
  );
