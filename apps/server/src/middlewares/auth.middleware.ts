import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    name: string;
  };
}

export async function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    console.log('[AUTH MIDDLEWARE] incoming authHeader:', authHeader);
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      console.log('[AUTH MIDDLEWARE] No token found in header');
      throw new AppError('Authentication required. Please log in.', 401, 'AUTH_REQUIRED');
    }

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      throw new AppError('Server configuration error', 500, 'SERVER_ERROR');
    }

    let decoded: { id: string; email: string; role: string; name: string };
    try {
      decoded = jwt.verify(token, secret) as typeof decoded;
      console.log('[AUTH MIDDLEWARE] decoded payload:', decoded);
    } catch (err) {
      console.log('[AUTH MIDDLEWARE] jwt verify failed:', err);
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError('Session expired. Please log in again.', 401, 'TOKEN_EXPIRED');
      }
      throw new AppError('Invalid authentication token.', 401, 'TOKEN_INVALID');
    }

    // Verify user still exists and is not deleted/suspended
    const user = await prisma.user.findFirst({
      where: {
        id: decoded.id,
        deletedAt: null,
      },
      select: { id: true, email: true, role: true, name: true, verifyToken: true },
    });

    console.log('[AUTH MIDDLEWARE] fetched user from DB:', user);

    if (!user || user.verifyToken === 'SUSPENDED') {
      console.log('[AUTH MIDDLEWARE] User deleted or suspended in DB:', decoded.id);
      throw new AppError('Account has been suspended or deleted. Please contact support.', 401, 'ACCOUNT_DELETED');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

// Optional authentication - doesn't fail if no token
export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token) {
      const secret = process.env.JWT_ACCESS_SECRET;
      if (secret) {
        try {
          const decoded = jwt.verify(token, secret) as {
            id: string;
            email: string;
            role: string;
            name: string;
          };
          const user = await prisma.user.findFirst({
            where: { id: decoded.id, deletedAt: null },
            select: { id: true, email: true, role: true, name: true },
          });
          if (user) req.user = user;
        } catch {
          // Token invalid, continue without auth
        }
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}
