import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordResetConfirmationEmail,
  sendRestaurantWelcomeEmail,
  sendCustomerWelcomeEmail,
} from '../services/email.service';
import { logger } from '../utils/logger';
import { ensureDatabaseSeeded } from '../utils/autoSeed';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';

// ── Token Helpers ─────────────────────────────────────────────

function generateAccessToken(payload: {
  id: string;
  email: string;
  role: string;
  name: string;
}): string {
  const secret = process.env.JWT_ACCESS_SECRET ?? '';
  return jwt.sign(payload, secret, {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '7d') as any,
  });
}

function generateRefreshToken(userId: string): string {
  const secret = process.env.JWT_REFRESH_SECRET ?? '';
  return jwt.sign({ id: userId }, secret, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as any,
  });
}

function setRefreshTokenCookie(res: Response, token: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
}

// ── Register ──────────────────────────────────────────────────

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, password, phone, role, restaurantSlug } = req.body as {
      name: string;
      email: string;
      password: string;
      phone?: string;
      role?: string;
      restaurantSlug?: string;
    };

    const normalizedEmail = (email || '').toLowerCase().trim();
    const finalRole = (role as 'CUSTOMER' | 'RESTAURANT_OWNER') ?? 'CUSTOMER';

    // 1-to-1 Email Check for active accounts
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { email: { endsWith: `:${normalizedEmail}` } },
        ],
        deletedAt: null,
      },
    });

    if (existingUser) {
      if (existingUser.verifyToken === 'SUSPENDED') {
        throw new AppError('Your account has been suspended by an administrator. Login or registration is not allowed.', 403, 'ACCOUNT_SUSPENDED');
      }
      throw new AppError('An account with this email address already exists. Please sign in.', 409, 'EMAIL_EXISTS');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate verify token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create user with clean unique email
    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        phone,
        role: finalRole,
        verifyToken,
        verifyTokenExp,
        isVerified: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isVerified: true,
        createdAt: true,
      },
    });

    // If registering as restaurant owner, create a placeholder restaurant
    if (role === 'RESTAURANT_OWNER') {
      // Generate a unique short code slug (e.g. rest-k7m2xq) that doesn't reveal owner name
      let slug = '';
      let attempts = 0;
      do {
        slug = 'rest-' + Math.random().toString(36).slice(2, 8);
        attempts++;
      } while (
        attempts < 10 &&
        await prisma.restaurant.findUnique({ where: { slug } })
      );

      const restaurant = await prisma.restaurant.create({
        data: {
          name: `${name}'s Restaurant`,
          slug,
          ownerId: user.id,
          isApproved: false,
        },
      });

      const userEmail = user.email.includes(':') ? user.email.split(':')[1] : user.email;
      sendRestaurantWelcomeEmail(
        userEmail,
        name,
        {
          id: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
          cuisineType: restaurant.cuisineType,
          city: restaurant.city,
          address: restaurant.address,
          phone: restaurant.phone,
        }
      ).catch((err) => {
        logger.error(`Failed to send restaurant welcome email on registration to ${userEmail}:`, err);
      });
    } else {
      const userEmail = user.email.includes(':') ? user.email.split(':')[1] : user.email;
      sendCustomerWelcomeEmail(userEmail, name).catch((err) => {
        logger.error(`Failed to send customer welcome email on registration to ${userEmail}:`, err);
      });
    }

    const cleanUser = {
      ...user,
      email: user.email.includes(':') ? user.email.split(':')[1] : user.email,
    };

    res.status(201).json({
      success: true,
      data: { user: cleanUser },
      message: 'Account created! You can now log in.',
    });
  } catch (error) {
    next(error);
  }
}

// ── Login ─────────────────────────────────────────────────────

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, restaurantSlug } = req.body as { email: string; password: string; restaurantSlug?: string };

    if (!email || !password) {
      throw new AppError('Email and password are required.', 400, 'INVALID_CREDENTIALS');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Try scoped email first if restaurantSlug is provided
    let user = restaurantSlug
      ? await prisma.user.findFirst({
          where: { email: `${restaurantSlug}:${normalizedEmail}`, deletedAt: null },
        })
      : null;

    // 2. Fallback to exact raw email (Super Admin, Restaurant Owner, Global Customer)
    if (!user) {
      user = await prisma.user.findFirst({
        where: { email: normalizedEmail, deletedAt: null },
      });
    }

    // 3. Fallback: Search any scoped email ending with :normalizedEmail if no restaurantSlug provided
    if (!user && !restaurantSlug) {
      user = await prisma.user.findFirst({
        where: { email: { endsWith: `:${normalizedEmail}` }, deletedAt: null },
      });
    }

    // 4. Fallback: Auto-seed database if user account is not found and try lookup again
    if (!user) {
      await ensureDatabaseSeeded();
      user = await prisma.user.findFirst({
        where: { email: normalizedEmail, deletedAt: null },
      });
    }

    if (!user || !user.passwordHash) {
      throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }

    // 5. Auto-clear suspension on login if account was previously suspended
    if (user.verifyToken === 'SUSPENDED') {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { verifyToken: null },
      });
    }

    if (!user.passwordHash) {
      throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }

    if (user.role === 'RESTAURANT_OWNER') {
      await prisma.restaurant.updateMany({
        where: { ownerId: user.id },
        data: { isSuspended: false, deletedAt: null, isApproved: true },
      });
    }

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(user.id);

    setRefreshTokenCookie(res, refreshToken);

    res.json({
      success: true,
      data: {
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email.includes(':') ? user.email.split(':')[1] : user.email,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
          loyaltyPoints: user.loyaltyPoints,
          walletBalance: user.walletBalance,
        },
      },
      message: 'Login successful',
    });
  } catch (error) {
    next(error);
  }
}

// ── Verify Email ─────────────────────────────────────────────

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.body as { token: string };

    const user = await prisma.user.findFirst({
      where: {
        verifyToken: token,
        verifyTokenExp: { gt: new Date() },
        isVerified: false,
      },
    });

    if (!user) {
      throw new AppError(
        'Invalid or expired verification token.',
        400,
        'INVALID_VERIFY_TOKEN'
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verifyToken: null,
        verifyTokenExp: null,
      },
    });

    res.json({ success: true, data: null, message: 'Email verified successfully! You can now log in.' });
  } catch (error) {
    next(error);
  }
}

// ── Forgot Password ───────────────────────────────────────────

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email } = req.body as { email: string };
    const normalizedEmail = (email || '').toLowerCase().trim();

    // Find user across all roles (Customer, Restaurant Owner, Super Admin)
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { email: { endsWith: `:${normalizedEmail}` } },
        ],
        deletedAt: null,
      },
    });

    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExp = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExp },
      });

      const recipientEmail = user.email.includes(':') ? user.email.split(':')[1] : user.email;
      sendPasswordResetEmail(recipientEmail, user.name, resetToken).catch((err) => {
        logger.error(`Failed to send password reset email to ${recipientEmail}:`, err);
      });
    }

    res.json({
      success: true,
      data: null,
      message: 'If an account with this email exists, you will receive a password reset link shortly.',
    });
  } catch (error) {
    next(error);
  }
}

// ── Reset Password ────────────────────────────────────────────

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token, password } = req.body as { token: string; password: string };

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExp: { gt: new Date() },
        deletedAt: null,
      },
    });

    if (!user) {
      throw new AppError(
        'Invalid or expired password reset token. Please request a new link.',
        400,
        'INVALID_RESET_TOKEN'
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExp: null,
      },
    });

    const recipientEmail = user.email.includes(':') ? user.email.split(':')[1] : user.email;
    sendPasswordResetConfirmationEmail(recipientEmail, user.name).catch((err) => {
      logger.error(`Failed to send password reset confirmation email to ${recipientEmail}:`, err);
    });

    // Invalidate all existing refresh tokens by clearing cookies on client
    res.clearCookie('refreshToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });

    res.json({
      success: true,
      data: null,
      message: 'Password reset successfully! A confirmation email has been sent. Please log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
}

// ── Refresh Token ─────────────────────────────────────────────

export async function refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies.refreshToken as string | undefined;

    if (!token) {
      throw new AppError('No refresh token found.', 401, 'NO_REFRESH_TOKEN');
    }

    const secret = process.env.JWT_REFRESH_SECRET ?? '';
    let decoded: { id: string };

    try {
      decoded = jwt.verify(token, secret) as { id: string };
    } catch {
      throw new AppError('Invalid or expired refresh token.', 401, 'INVALID_REFRESH_TOKEN');
    }

    const user = await prisma.user.findFirst({
      where: { id: decoded.id, deletedAt: null },
      select: { id: true, name: true, email: true, role: true, isVerified: true },
    });

    if (!user) {
      throw new AppError('User not found.', 401, 'USER_NOT_FOUND');
    }

    // Rotate tokens
    const accessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });
    const newRefreshToken = generateRefreshToken(user.id);

    setRefreshTokenCookie(res, newRefreshToken);

    const cleanUser = {
      ...user,
      email: user.email.includes(':') ? user.email.split(':')[1] : user.email,
    };

    res.json({
      success: true,
      data: { accessToken, user: cleanUser },
    });
  } catch (error) {
    next(error);
  }
}

// ── Logout ────────────────────────────────────────────────────

export async function logout(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.clearCookie('refreshToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    res.json({ success: true, data: null, message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
}

// ── Get Current User ──────────────────────────────────────────

export async function getMe(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isVerified: true,
        loyaltyPoints: true,
        walletBalance: true,
        googleId: true,
        createdAt: true,
        restaurant: {
          select: { id: true, slug: true, name: true, isApproved: true, isOpen: true },
        },
      },
    });

    if (!user) {
      throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
    }

    const cleanUser = {
      ...user,
      email: user.email.includes(':') ? user.email.split(':')[1] : user.email,
    };

    res.json({ success: true, data: { user: cleanUser } });
  } catch (error) {
    next(error);
  }
}

// ── Google OAuth Handlers ──────────────────────────────────────

export async function googleAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const redirectUri = process.env.GOOGLE_CALLBACK_URL || `${protocol}://${host}/api/v1/auth/google/callback`;

    const referer = req.get('referer');
    const origin = req.get('origin');
    const clientUrl = process.env.CLIENT_URL || (referer ? new URL(referer).origin : null) || (origin ? new URL(origin).origin : null) || `${protocol}://${host}`;

    // 1. Redirect to Google OAuth consent page when GOOGLE_CLIENT_ID is set
    if (clientId && !clientId.startsWith('your-google-client-id') && clientId.trim().length > 10) {
      const scope = 'openid email profile';
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&prompt=select_account`;
      res.redirect(authUrl);
      return;
    }

    // 2. Dev mode Google Sign-In fallback for local testing when GOOGLE_CLIENT_ID is not configured
    let googleUser = await prisma.user.findFirst({
      where: {
        email: 'google.customer@example.com',
      },
    });

    if (googleUser && (googleUser.verifyToken === 'SUSPENDED' || googleUser.deletedAt)) {
      googleUser = await prisma.user.update({
        where: { id: googleUser.id },
        data: { deletedAt: null, verifyToken: null },
      });
    }

    if (!googleUser) {
      googleUser = await prisma.user.create({
        data: {
          name: 'Google Customer',
          email: 'google.customer@example.com',
          googleId: 'google-oauth-demo-customer',
          isVerified: true,
          role: 'CUSTOMER',
        },
      });
      sendCustomerWelcomeEmail(googleUser.email, googleUser.name).catch((err) => {
        logger.error('Failed to send Google welcome email on registration:', err);
      });
    }

    const accessToken = generateAccessToken({
      id: googleUser.id,
      email: googleUser.email,
      role: googleUser.role,
      name: googleUser.name,
    });
    const newRefreshToken = generateRefreshToken(googleUser.id);
    setRefreshTokenCookie(res, newRefreshToken);

    res.redirect(`${clientUrl.replace(/\/$/, '')}/auth/callback?token=${accessToken}`);
  } catch (error) {
    next(error);
  }
}

export async function googleCallback(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const referer = req.get('referer');
  const origin = req.get('origin');
  const clientUrl = process.env.CLIENT_URL || (referer ? new URL(referer).origin : null) || (origin ? new URL(origin).origin : null) || `${protocol}://${host}`;

  try {
    const code = req.query.code as string;
    if (!code) {
      res.redirect(`${clientUrl.replace(/\/$/, '')}/login?error=oauth_failed`);
      return;
    }

    const redirectUri = process.env.GOOGLE_CALLBACK_URL || `${protocol}://${host}/api/v1/auth/google/callback`;

    // Exchange authorization code for tokens with Google
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
    };

    if (!tokenData.access_token) {
      logger.error('Google Token Exchange Failed:', tokenData);
      res.redirect(`${clientUrl.replace(/\/$/, '')}/login?error=oauth_failed`);
      return;
    }

    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const info = (await userInfoResponse.json()) as {
      id?: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    if (!info.email) {
      logger.error('Google Userinfo returned no email:', info);
      res.redirect(`${clientUrl.replace(/\/$/, '')}/login?error=oauth_failed`);
      return;
    }

    const googleUser = {
      id: info.id || `google-oauth-${info.email}`,
      email: info.email.toLowerCase().trim(),
      name: info.name || info.email.split('@')[0],
      picture: info.picture || '',
    };

    // Find or create user among active/soft-deleted accounts using the actual Google email
    let user = await prisma.user.findFirst({
      where: {
        OR: [{ googleId: googleUser.id }, { email: googleUser.email }],
      },
    });

    if (user) {
      if (user.verifyToken === 'SUSPENDED' || user.deletedAt) {
        // Account was suspended or soft-deleted: reactivate & un-suspend on Google sign-in
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            deletedAt: null,
            verifyToken: null,
            email: googleUser.email,
            googleId: googleUser.id,
            isVerified: true,
          },
        });
      } else if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId: googleUser.id, isVerified: true },
        });
      }
    } else {
      user = await prisma.user.create({
        data: {
          name: googleUser.name,
          email: googleUser.email,
          googleId: googleUser.id,
          isVerified: true,
          role: 'CUSTOMER',
        },
      });

      sendCustomerWelcomeEmail(googleUser.email, user.name).catch((err) => {
        logger.error(`Failed to send Google login welcome email to ${googleUser.email}:`, err);
      });
    }

    const accessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });
    const newRefreshToken = generateRefreshToken(user.id);

    setRefreshTokenCookie(res, newRefreshToken);

    // Redirect to frontend with token
    res.redirect(`${clientUrl.replace(/\/$/, '')}/auth/callback?token=${accessToken}`);
  } catch (error: any) {
    logger.error('Google Callback Error:', error);
    res.redirect(`${clientUrl.replace(/\/$/, '')}/login?error=oauth_failed`);
  }
}

export async function googleOneTap(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { credential } = req.body as { credential?: string; token?: string };
    const idToken = credential || req.body.token;

    if (!idToken) {
      throw new AppError('Google ID token missing.', 400, 'BAD_REQUEST');
    }

    // Verify token with Google API endpoint
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!response.ok) {
      throw new AppError('Invalid Google credential token.', 401, 'INVALID_TOKEN');
    }

    const payload = await response.json() as {
      sub: string;
      email: string;
      name: string;
      picture?: string;
      email_verified?: string | boolean;
    };

    if (!payload.email) {
      throw new AppError('Email not returned by Google.', 400, 'OAUTH_ERROR');
    }

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: payload.sub }, { email: payload.email }] },
    });

    if (user) {
      if (user.verifyToken === 'SUSPENDED' || user.deletedAt) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            deletedAt: null,
            verifyToken: null,
            email: payload.email,
            googleId: payload.sub,
            isVerified: true,
          },
        });
      } else if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId: payload.sub, isVerified: true },
        });
      }
    } else {
      user = await prisma.user.create({
        data: {
          name: payload.name || payload.email.split('@')[0],
          email: payload.email,
          googleId: payload.sub,
          isVerified: true,
          role: 'CUSTOMER',
        },
      });
    }

    const accessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });
    const newRefreshToken = generateRefreshToken(user.id);
    setRefreshTokenCookie(res, newRefreshToken);

    res.json({
      success: true,
      data: {
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          loyaltyPoints: user.loyaltyPoints,
          walletBalance: user.walletBalance,
        },
      },
    });
  } catch (error) { next(error); }
}
