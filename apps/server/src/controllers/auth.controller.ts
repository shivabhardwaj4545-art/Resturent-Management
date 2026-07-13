import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from '../services/email.service';
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
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as any,
  });
}

function generateRefreshToken(userId: string): string {
  const secret = process.env.JWT_REFRESH_SECRET ?? '';
  return jwt.sign({ id: userId }, secret, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as any,
  });
}

function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
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

    const finalRole = (role as 'CUSTOMER' | 'RESTAURANT_OWNER') ?? 'CUSTOMER';

    // Scoped email for customers
    const dbEmail = (finalRole === 'CUSTOMER' && restaurantSlug)
      ? `${restaurantSlug}:${email}`
      : email;

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({ where: { email: dbEmail } });
    if (existingUser) {
      throw new AppError('An account with this email already exists.', 409, 'EMAIL_EXISTS');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate verify token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email: dbEmail,
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
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') +
        '-' +
        Math.random().toString(36).slice(2, 6);

      await prisma.restaurant.create({
        data: {
          name: `${name}'s Restaurant`,
          slug,
          ownerId: user.id,
          isApproved: false,
        },
      });
    }

    // Send verification email
    /*
    try {
      await sendVerificationEmail(email, name, verifyToken);
    } catch (emailError: any) {
      if (process.env.NODE_ENV === 'production') {
        throw emailError;
      }
      console.warn(`[DEV ONLY] Failed to send verification email: ${emailError.message}`);
      const verifyUrl = `${process.env.CLIENT_URL ?? 'http://localhost:3000'}/verify-email?token=${verifyToken}`;
      console.log(`[DEV ONLY] Verification link: ${verifyUrl}`);
    }
    */

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

    const dbEmail = restaurantSlug ? `${restaurantSlug}:${email}` : email;

    const user = await prisma.user.findFirst({
      where: { email: dbEmail, deletedAt: null },
    });

    if (!user || !user.passwordHash) {
      throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }

    /*
    if (!user.isVerified) {
      throw new AppError(
        'Please verify your email before logging in.',
        403,
        'EMAIL_NOT_VERIFIED'
      );
    }
    */

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
    const { email, restaurantSlug } = req.body as { email: string; restaurantSlug?: string };

    const dbEmail = restaurantSlug ? `${restaurantSlug}:${email}` : email;

    const user = await prisma.user.findFirst({ where: { email: dbEmail, deletedAt: null } });

    // Always respond with success (don't leak user existence)
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExp = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExp },
      });

      try {
        await sendPasswordResetEmail(email, user.name, resetToken);
      } catch (emailError: any) {
        if (process.env.NODE_ENV === 'production') {
          throw emailError;
        }
        console.warn(`[DEV ONLY] Failed to send password reset email: ${emailError.message}`);
        const resetUrl = `${process.env.CLIENT_URL ?? 'http://localhost:3000'}/reset-password?token=${resetToken}`;
        console.log(`[DEV ONLY] Reset password link: ${resetUrl}`);
      }
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
      },
    });

    if (!user) {
      throw new AppError(
        'Invalid or expired password reset token.',
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

    // Invalidate all existing refresh tokens by clearing cookies on client
    res.clearCookie('refreshToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });

    res.json({ success: true, data: null, message: 'Password reset successfully! Please log in with your new password.' });
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

// ── Google OAuth (placeholder handlers) ──────────────────────

export function googleAuth(_req: Request, res: Response): void {
  // Redirect to Google OAuth — in production use passport-google-oauth20
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const redirectUri = process.env.GOOGLE_CALLBACK_URL ?? '';
  const scope = 'openid email profile';
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;
  res.redirect(authUrl);
}

export async function googleCallback(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // In production, passport-google-oauth20 handles this
    // This is a simplified handler
    const code = req.query.code as string;
    if (!code) {
      throw new AppError('Authorization code missing', 400, 'OAUTH_ERROR');
    }

    // Exchange code for tokens with Google
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: process.env.GOOGLE_CALLBACK_URL ?? '',
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json() as {
      access_token?: string;
      error?: string;
    };

    if (!tokenData.access_token) {
      throw new AppError('Failed to get Google access token', 400, 'OAUTH_ERROR');
    }

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const googleUser = await userInfoResponse.json() as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };

    // Find or create user
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: googleUser.id }, { email: googleUser.email }] },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name: googleUser.name,
          email: googleUser.email,
          googleId: googleUser.id,
          isVerified: true,
          role: 'CUSTOMER',
        },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: googleUser.id, isVerified: true },
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
    const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:3000';
    res.redirect(`${clientUrl}/auth/callback?token=${accessToken}`);
  } catch (error) {
    next(error);
  }
}
