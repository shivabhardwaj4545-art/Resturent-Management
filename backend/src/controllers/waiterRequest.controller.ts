import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { normalizeTableNumber } from './tableSession.controller';
import { emitTableSessionUpdate, emitWaiterCall } from '../services/socket.service';
import { logger } from '../utils/logger';

/**
 * Resolves restaurant for authenticated owner or kitchen staff.
 */
async function getAuthenticatedUserRestaurant(user: NonNullable<AuthenticatedRequest['user']>) {
  let restaurantId = (user as any).restaurantId || (user as any).kitchenRestaurantId;

  if (!restaurantId && user.role === 'RESTAURANT_OWNER') {
    const rest = await prisma.restaurant.findFirst({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, slug: true, ownerId: true },
    });
    if (rest) return rest;
  }

  if (restaurantId) {
    const rest = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, name: true, slug: true, ownerId: true },
    });
    if (rest) return rest;
  }

  if (user.role === 'SUPER_ADMIN') {
    const rest = await prisma.restaurant.findFirst({
      where: { deletedAt: null },
      select: { id: true, name: true, slug: true, ownerId: true },
    });
    if (rest) return rest;
  }

  throw new AppError('Restaurant not found for authenticated user.', 404, 'RESTAURANT_NOT_FOUND');
}

/**
 * POST /api/v1/waiter-requests
 * Customer initiates waiter assistance request.
 * Automatically associates restaurant, table, active session, and device reference.
 */
export async function createWaiterRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { restaurantSlug, restaurantId, tableNumber, reason, requestType = 'TABLE_OCCUPIED_ASSISTANCE', deviceReference } = req.body as {
      restaurantSlug?: string;
      restaurantId?: string;
      tableNumber?: string;
      reason?: string;
      requestType?: string;
      deviceReference?: string;
    };

    if (!tableNumber) {
      throw new AppError('Table number is required to call a waiter.', 400, 'TABLE_REQUIRED');
    }

    const cleanTable = normalizeTableNumber(tableNumber);

    // Resolve restaurant
    let restaurant = null;
    if (restaurantId) {
      restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true, name: true, ownerId: true },
      });
    } else if (restaurantSlug) {
      restaurant = await prisma.restaurant.findUnique({
        where: { slug: restaurantSlug },
        select: { id: true, name: true, ownerId: true },
      });
    }

    if (!restaurant) {
      throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
    }

    // Lookup active session for table
    const activeSession = await prisma.tableSession.findFirst({
      where: {
        restaurantId: restaurant.id,
        tableNumber: cleanTable,
        status: 'ACTIVE',
      },
      select: { id: true, sessionCode: true, tableAccessCode: true },
    });

    const defaultReason = requestType === 'TABLE_OCCUPIED_ASSISTANCE'
      ? 'Table appears occupied in the system, but the table may be physically empty.'
      : 'Customer requested assistance at table.';

    // Create persistent WaiterRequest
    const waiterReq = await prisma.waiterRequest.create({
      data: {
        restaurantId: restaurant.id,
        tableNumber: cleanTable,
        sessionId: activeSession ? activeSession.id : null,
        requestType,
        reason: reason || defaultReason,
        status: 'PENDING',
        deviceReference: deviceReference || req.headers['x-device-id']?.toString() || null,
      },
    });

    // Real-time notification to owner dashboard
    emitWaiterCall(
      restaurant.id,
      cleanTable,
      'default',
      undefined,
      undefined,
      undefined,
      requestType,
      waiterReq.reason || undefined,
      restaurant.ownerId
    );

    logger.info(`Waiter request created for ${cleanTable} at restaurant ${restaurant.id} (ID: ${waiterReq.id})`);

    res.status(201).json({
      success: true,
      data: {
        id: waiterReq.id,
        tableNumber: cleanTable,
        status: waiterReq.status,
        reason: waiterReq.reason,
        createdAt: waiterReq.createdAt,
      },
      message: `Waiter request received for ${cleanTable}. A staff member has been notified.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/owner/waiter-requests
 * Retrieves waiter assistance requests for owner/staff dashboard.
 */
export async function listWaiterRequests(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getAuthenticatedUserRestaurant(req.user!);
    const { status } = req.query as { status?: string };

    const requests = await prisma.waiterRequest.findMany({
      where: {
        restaurantId: restaurant.id,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        session: {
          select: {
            id: true,
            sessionCode: true,
            tableAccessCode: true,
            status: true,
            paymentStatus: true,
            totalAmount: true,
            createdAt: true,
          },
        },
      },
    });

    const pendingCount = await prisma.waiterRequest.count({
      where: { restaurantId: restaurant.id, status: 'PENDING' },
    });

    res.json({
      success: true,
      data: {
        requests,
        pendingCount,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/v1/owner/waiter-requests/:requestId/acknowledge
 * Acknowledges a waiter assistance request.
 */
export async function acknowledgeWaiterRequest(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getAuthenticatedUserRestaurant(req.user!);
    const requestId = req.params.requestId as string;

    const existing = await prisma.waiterRequest.findUnique({
      where: { id: requestId },
    });

    if (!existing || existing.restaurantId !== restaurant.id) {
      throw new AppError('Waiter request not found.', 404, 'NOT_FOUND');
    }

    const updated = await prisma.waiterRequest.update({
      where: { id: requestId },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        acknowledgedBy: req.user?.id || 'Staff',
      },
    });

    res.json({
      success: true,
      data: updated,
      message: `Request for ${updated.tableNumber} acknowledged.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/v1/owner/waiter-requests/:requestId/resolve
 * Marks a waiter request as resolved (e.g. table is still occupied or customer was assisted).
 */
export async function resolveWaiterRequest(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getAuthenticatedUserRestaurant(req.user!);
    const requestId = req.params.requestId as string;

    const existing = await prisma.waiterRequest.findUnique({
      where: { id: requestId },
    });

    if (!existing || existing.restaurantId !== restaurant.id) {
      throw new AppError('Waiter request not found.', 404, 'NOT_FOUND');
    }

    const updated = await prisma.waiterRequest.update({
      where: { id: requestId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedBy: req.user?.id || 'Staff',
      },
    });

    res.json({
      success: true,
      data: updated,
      message: `Request for ${updated.tableNumber} marked as resolved.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/owner/waiter-requests/:requestId/clear-table
 * Scenario B: Staff verifies table is physically empty and clears previous session.
 * Closes the old session, invalidates access credentials, marks table AVAILABLE, and marks request RESOLVED.
 */
export async function clearTableFromWaiterRequest(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getAuthenticatedUserRestaurant(req.user!);
    const requestId = req.params.requestId as string;
    const { forceClear = false, reason } = req.body as { forceClear?: boolean; reason?: string };

    const waiterReq = await prisma.waiterRequest.findUnique({
      where: { id: requestId },
      include: {
        session: {
          include: {
            orders: { where: { deletedAt: null } },
          },
        },
      },
    });

    if (!waiterReq || waiterReq.restaurantId !== restaurant.id) {
      throw new AppError('Waiter request not found.', 404, 'NOT_FOUND');
    }

    const cleanTable = normalizeTableNumber(waiterReq.tableNumber);
    const now = new Date();
    const staffId = req.user?.id || 'Staff';
    const staffName = req.user?.name || req.user?.email || 'Authorized Staff';

    // If an active session exists, verify clearance conditions
    if (waiterReq.session && waiterReq.session.status === 'ACTIVE') {
      const unpaidOrders = waiterReq.session.orders.filter(
        (o) => o.status !== 'CANCELLED' && o.paymentStatus !== 'PAID'
      );

      if (unpaidOrders.length > 0 && !forceClear) {
        const unpaidSum = unpaidOrders.reduce((sum, o) => sum + (o.total || 0), 0);
        throw new AppError(
          `Cannot clear ${cleanTable}: Table has ${unpaidOrders.length} unpaid orders (₹${unpaidSum.toFixed(2)} due). Please confirm payment or authorize exception.`,
          400,
          'UNPAID_ORDERS'
        );
      }

      await prisma.$transaction(async (tx) => {
        // 1. Close table session
        await tx.tableSession.update({
          where: { id: waiterReq.session!.id },
          data: {
            status: 'COMPLETED',
            completedAt: now,
            closedAt: now,
            closedBy: staffId,
            closureReason: reason || 'Cleared by staff via Waiter Assistance Request (Table physically empty)',
          },
        });

        // 2. Revoke all device access tokens for this session
        await tx.sessionDeviceAccess.updateMany({
          where: { sessionId: waiterReq.session!.id, revokedAt: null },
          data: { revokedAt: now },
        });

        // 3. Mark orders as delivered
        await tx.order.updateMany({
          where: { tableSessionId: waiterReq.session!.id, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
          data: { status: 'DELIVERED', deliveredAt: now },
        });

        // 4. Mark waiter request as RESOLVED
        await tx.waiterRequest.update({
          where: { id: waiterReq.id },
          data: {
            status: 'RESOLVED',
            resolvedAt: now,
            resolvedBy: staffId,
          },
        });

        // 5. Audit log
        await tx.tableClearanceLog.create({
          data: {
            restaurantId: restaurant.id,
            tableNumber: cleanTable,
            sessionId: waiterReq.session!.id,
            staffId,
            staffName,
            action: 'CLEAR_TABLE_WAITER_REQUEST',
            reason: reason || 'Cleared via Waiter Assistance Request (Physically empty table)',
            clearedAt: now,
          },
        });
      });
    } else {
      // No active session or already closed, just mark request RESOLVED
      await prisma.waiterRequest.update({
        where: { id: waiterReq.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: now,
          resolvedBy: staffId,
        },
      });
    }

    // Real-time broadcast
    emitTableSessionUpdate(restaurant.id, cleanTable, {
      tableNumber: cleanTable,
      status: 'AVAILABLE',
      event: 'TABLE_CLEARED',
      message: `${cleanTable} has been cleared and is now available for new guests.`,
    });

    res.json({
      success: true,
      message: `${cleanTable} has been successfully cleared and marked as AVAILABLE.`,
      data: {
        tableNumber: cleanTable,
        status: 'AVAILABLE',
      },
    });
  } catch (error) {
    next(error);
  }
}
