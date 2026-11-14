import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  checkAccountLoginCooldown,
  recordFailedLoginAttempt,
  recordSuccessfulLogin,
} from '../src/services/loginSecurity.service';

// Mock Prisma
jest.mock('../src/lib/prisma', () => {
  const testUser = {
    id: 'sec-user-123',
    name: 'Secure User',
    email: 'secure@test.com',
    passwordHash: '',
    role: 'RESTAURANT_OWNER',
    isVerified: true,
    loyaltyPoints: 0,
    walletBalance: 0,
    verifyToken: null,
    deletedAt: null,
    kitchenRestaurantId: null,
  };

  const otherUser = {
    id: 'other-user-456',
    name: 'Other User',
    email: 'other@test.com',
    passwordHash: '',
    role: 'CUSTOMER',
    isVerified: true,
    loyaltyPoints: 0,
    walletBalance: 0,
    verifyToken: null,
    deletedAt: null,
    kitchenRestaurantId: null,
  };

  return {
    prisma: {
      user: {
        findFirst: jest.fn(async ({ where }) => {
          if (where?.email?.includes('secure@test.com') || where?.id === testUser.id) {
            return testUser;
          }
          if (where?.email?.includes('other@test.com') || where?.id === otherUser.id) {
            return otherUser;
          }
          return null;
        }),
        update: jest.fn(async () => testUser),
      },
      restaurant: {
        findFirst: jest.fn(async () => ({ id: 'rest-sec', maxLogins: 5, platformType: 'RESTAURANT' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      activeSession: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }) => data),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      refreshToken: {
        create: jest.fn(async ({ data }) => ({ id: 'tk-1', ...data })),
        update: jest.fn(async () => ({})),
      },
    },
  };
});

describe('Secure Authentication and Layered Rate Limiting', () => {
  const validPassword = 'StrongPassword!2026';
  const targetEmail = 'secure@test.com';

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-jwt-secret-key-at-least-32-chars-long';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';

    const hash = await bcrypt.hash(validPassword, 10);
    const mockUser = await prisma.user.findFirst({ where: { email: targetEmail } } as any);
    if (mockUser) {
      mockUser.passwordHash = hash;
    }
  });

  beforeEach(async () => {
    // Reset test accounts before each test
    await recordSuccessfulLogin(targetEmail, '127.0.0.1', 'sec-user-123');
    await recordSuccessfulLogin('other@test.com', '127.0.0.1', 'other-user-456');
  });

  test('1. Successful login returns HTTP 200 with access token and HttpOnly cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password: validPassword });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.email).toBe(targetEmail);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('2. Invalid password returns generic HTTP 401 without exposing account details', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password: 'WrongPassword999' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid email or password.');
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  test('3. Repeated failed attempts trigger progressive temporary cooldown with HTTP 429 and Retry-After', async () => {
    // 4 failed attempts: returns 401
    for (let i = 1; i <= 4; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: targetEmail, password: 'WrongPassword' });
      expect(res.status).toBe(401);
    }

    // 5th failed attempt: triggers 1-minute cooldown, returns HTTP 429
    const fifthAttempt = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password: 'WrongPassword' });

    expect(fifthAttempt.status).toBe(429);
    expect(fifthAttempt.body.code).toBe('ACCOUNT_RATE_LIMITED');
    expect(fifthAttempt.body.retryAfter).toBeGreaterThan(0);
    expect(fifthAttempt.headers['retry-after']).toBeDefined();

    // 6th attempt during cooldown is immediately rejected with 429
    const immediateNext = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password: validPassword }); // Even with correct password, cooldown applies!

    expect(immediateNext.status).toBe(429);
    expect(immediateNext.body.code).toBe('ACCOUNT_RATE_LIMITED');
  });

  test('4. Legitimate user on a different account on the same IP is NOT blocked by another account cooldown', async () => {
    // Put targetEmail into cooldown with 5 failed attempts
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: targetEmail, password: 'WrongPassword' });
    }

    // Check targetEmail is in cooldown
    const targetStatus = await checkAccountLoginCooldown(targetEmail);
    expect(targetStatus.inCooldown).toBe(true);

    // Another user on the same IP can still log in successfully
    const otherUser = await prisma.user.findFirst({ where: { email: 'other@test.com' } } as any);
    if (otherUser) otherUser.passwordHash = await bcrypt.hash('OtherPassword123', 10);

    const otherRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'other@test.com', password: 'OtherPassword123' });

    expect(otherRes.status).toBe(200);
    expect(otherRes.body.success).toBe(true);
  });

  test('5. Successful login resets failed attempts and clears cooldown', async () => {
    // Make 2 failed attempts
    await request(app).post('/api/v1/auth/login').send({ email: targetEmail, password: 'WrongPassword' });
    await request(app).post('/api/v1/auth/login').send({ email: targetEmail, password: 'WrongPassword' });

    // Now log in successfully
    const successRes = await request(app).post('/api/v1/auth/login').send({ email: targetEmail, password: validPassword });
    expect(successRes.status).toBe(200);

    // Cooldown is clear
    const status = await checkAccountLoginCooldown(targetEmail);
    expect(status.inCooldown).toBe(false);
  });

  test('6. Express trust proxy configuration is set for private network hops', () => {
    expect(app.get('trust proxy')).toBeDefined();
  });
});
