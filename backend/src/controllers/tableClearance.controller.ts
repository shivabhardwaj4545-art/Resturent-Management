import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { normalizeTableNumber, generateUniqueSessionCode } from './tableSession.controller';
import { emitTableSessionUpdate } from '../services/socket.service';
import { logger } from '../utils/logger';

/**
 * Resolves the restaurant for an authenticated user (Owner, Manager, or Kitchen).
 */
async function getAuthenticatedUserRestaurant(user: NonNullable<AuthenticatedRequest['user']>) {
  let restaurantId = (user as any).restaurantId || (user as any).kitchenRestaurantId;

  if (!restaurantId && user.role === 'RESTAURANT_OWNER') {
    const rest = await prisma.restaurant.findFirst({
      where: { ownerId: user.id, deletedAt: null },
      select: { id: true, name: true, slug: true, sessionManagementMode: true, qrSettings: true, platformType: true },
    });
    if (rest) return rest;
  }

  if (restaurantId) {
    const rest = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, name: true, slug: true, sessionManagementMode: true, qrSettings: true, platformType: true },
    });
    if (rest) return rest;
  }

  if (user.role === 'SUPER_ADMIN') {
    const rest = await prisma.restaurant.findFirst({
      where: { deletedAt: null },
      select: { id: true, name: true, slug: true, sessionManagementMode: true, qrSettings: true, platformType: true },
    });
    if (rest) return rest;
  }

  throw new AppError('Restaurant not found for authenticated user.', 404, 'RESTAURANT_NOT_FOUND');
}

/**
 * GET /api/v1/owner/table-management/session-mode
 * Retrieves the current session management mode (AUTO | MANUAL) for the restaurant.
 */
export async function getSessionManagementMode(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getAuthenticatedUserRestaurant(req.user!);
    res.json({
      success: true,
      data: {
        mode: restaurant.sessionManagementMode || 'MANUAL',
        restaurantId: restaurant.id,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/v1/owner/table-management/session-mode
 * Updates the session management mode for the restaurant.
 * NOTE: Changing modes NEVER automatically closes or modifies existing active sessions.
 */
export async function updateSessionManagementMode(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getAuthenticatedUserRestaurant(req.user!);
    const { mode } = req.body as { mode?: string };

    if (!mode || !['AUTO', 'MANUAL'].includes(mode.toUpperCase())) {
      throw new AppError('Valid session management mode (AUTO or MANUAL) is required.', 400, 'INVALID_MODE');
    }

    const newMode = mode.toUpperCase();

    const updated = await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: { sessionManagementMode: newMode },
      select: { id: true, name: true, sessionManagementMode: true },
    });

    logger.info(`Restaurant ${restaurant.id} changed session management mode to ${newMode} by user ${req.user!.id}`);

    res.json({
      success: true,
      data: {
        mode: updated.sessionManagementMode,
        restaurantId: updated.id,
      },
      message: `Session management mode successfully updated to ${newMode === 'AUTO' ? 'Auto Session Reset' : 'Manual Table Clearance'}. Existing active sessions retain their current lifecycle.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/owner/table-clearance
 * Comprehensive Table Clearance Dashboard.
 * Returns all tables, occupancy status, session details, order/payment statuses, and counters.
 */
export async function getTableClearanceDashboard(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getAuthenticatedUserRestaurant(req.user!);

    // 1. Gather all tables configured for this restaurant
    const defaultTables = restaurant.platformType === 'HOTEL'
      ? ['Room 101', 'Room 102', 'Room 103', 'Room 104', 'Room 201', 'Room 202']
      : ['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6', 'Table 7', 'Table 8', 'Table 9', 'Table 10'];

    const qrSettings = (restaurant.qrSettings as any) || {};
    const customLocations: string[] = Array.isArray(qrSettings.customLocations) ? qrSettings.customLocations : [];
    const disabledLocations: string[] = Array.isArray(qrSettings.disabledLocations) ? qrSettings.disabledLocations : [];

    // 2. Fetch all ACTIVE sessions for this restaurant
    const activeSessions = await prisma.tableSession.findMany({
      where: {
        restaurantId: restaurant.id,
        status: 'ACTIVE',
      },
      include: {
        batches: {
          orderBy: { batchNumber: 'asc' },
        },
        orders: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            total: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Collect all table names (defaults + customs + active session tables)
    const tableSet = new Set<string>();
    defaultTables.forEach((t) => tableSet.add(normalizeTableNumber(t)));
    customLocations.forEach((t) => tableSet.add(normalizeTableNumber(t)));
    activeSessions.forEach((s) => tableSet.add(normalizeTableNumber(s.tableNumber)));

    // Map active sessions by normalized table number
    const sessionByTable = new Map<string, typeof activeSessions[0]>();
    for (const session of activeSessions) {
      sessionByTable.set(normalizeTableNumber(session.tableNumber).toLowerCase(), session);
    }

    const sortedTableList = Array.from(tableSet).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    let awaitingClearanceCount = 0;
    let occupiedCount = 0;
    let paymentPendingCount = 0;
    let availableCount = 0;

    const tables = sortedTableList.map((tableName) => {
      const normalizedKey = tableName.toLowerCase();
      const session = sessionByTable.get(normalizedKey);
      const isDisabled = disabledLocations.some((d) => normalizeTableNumber(d).toLowerCase() === normalizedKey);

      if (!session) {
        availableCount++;
        return {
          tableNumber: tableName,
          status: 'AVAILABLE',
          displayStatus: 'Available',
          isDisabled,
          session: null,
        };
      }

      // Calculate orders summary
      const nonCancelledOrders = session.orders.filter((o) => o.status !== 'CANCELLED');
      const orderCount = nonCancelledOrders.length;
      const totalAmount = nonCancelledOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      const paidOrders = nonCancelledOrders.filter((o) => o.paymentStatus === 'PAID');
      const paidAmount = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);

      const allPaid = nonCancelledOrders.length > 0 && paidOrders.length === nonCancelledOrders.length;
      const partiallyPaid = paidOrders.length > 0 && paidOrders.length < nonCancelledOrders.length;

      let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
      if (allPaid || session.paymentStatus === 'PAID') {
        paymentStatus = 'PAID';
      } else if (partiallyPaid || session.paymentStatus === 'PARTIALLY_PAID') {
        paymentStatus = 'PARTIALLY_PAID';
      }

      // Prevailing order status
      const latestOrder = nonCancelledOrders[0];
      const orderStatus = latestOrder ? latestOrder.status : 'NO_ORDERS';

      // Determine Table Occupancy Status
      let occupancyStatus: 'PAID_AWAITING_CLEARANCE' | 'PAYMENT_PENDING' | 'OCCUPIED' = 'OCCUPIED';
      let displayStatus = 'Occupied';

      if (paymentStatus === 'PAID') {
        occupancyStatus = 'PAID_AWAITING_CLEARANCE';
        displayStatus = 'Paid – Awaiting Clearance';
        awaitingClearanceCount++;
      } else if (
        nonCancelledOrders.some((o) => ['SERVED', 'READY', 'DELIVERED'].includes(o.status)) ||
        paymentStatus === 'PARTIALLY_PAID'
      ) {
        occupancyStatus = 'PAYMENT_PENDING';
        displayStatus = 'Payment Pending';
        paymentPendingCount++;
      } else {
        occupancyStatus = 'OCCUPIED';
        displayStatus = 'Occupied';
        occupiedCount++;
      }

      const durationMs = Date.now() - new Date(session.createdAt).getTime();
      const durationMinutes = Math.max(1, Math.floor(durationMs / 60000));

      return {
        tableNumber: tableName,
        status: occupancyStatus,
        displayStatus,
        isDisabled,
        session: {
          id: session.id,
          sessionCode: session.sessionCode,
          startedAt: session.createdAt,
          durationMinutes,
          orderCount,
          totalAmount: Number(totalAmount.toFixed(2)),
          paidAmount: Number(paidAmount.toFixed(2)),
          paymentStatus,
          orderStatus,
          sessionManagementModeSnapshot: session.sessionManagementModeSnapshot || restaurant.sessionManagementMode || 'MANUAL',
          notes: session.notes,
        },
      };
    });

    res.json({
      success: true,
      data: {
        tables,
        summary: {
          totalTables: tables.length,
          awaitingClearanceCount,
          occupiedCount,
          paymentPendingCount,
          availableCount,
          sessionManagementMode: restaurant.sessionManagementMode || 'MANUAL',
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/owner/table-clearance/clear
 * Clears an occupied / paid table manually and releases the table for new diners.
 * Verifies that all orders are settled, closes the session, and updates availability.
 */
export async function clearTableManual(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getAuthenticatedUserRestaurant(req.user!);
    const { tableNumber, sessionId, reason, forceClear = false } = req.body as {
      tableNumber?: string;
      sessionId?: string;
      reason?: string;
      forceClear?: boolean;
    };

    if (!tableNumber && !sessionId) {
      throw new AppError('Either tableNumber or sessionId is required to clear a table.', 400, 'PARAM_REQUIRED');
    }

    const cleanTable = tableNumber ? normalizeTableNumber(tableNumber) : undefined;

    // Concurrency-safe lookup of active session
    let session = await prisma.tableSession.findFirst({
      where: {
        restaurantId: restaurant.id,
        ...(sessionId ? { id: sessionId } : { tableNumber: cleanTable }),
        status: 'ACTIVE',
      },
      include: {
        orders: {
          where: { deletedAt: null },
        },
        batches: true,
      },
    });

    // Idempotent: If session is already closed or does not exist, return cleanly
    if (!session) {
      // Check if session was already closed
      if (sessionId) {
        const closedSession = await prisma.tableSession.findUnique({
          where: { id: sessionId },
        });
        if (closedSession && closedSession.restaurantId === restaurant.id) {
          res.json({
            success: true,
            data: { tableNumber: closedSession.tableNumber, status: 'AVAILABLE' },
            message: `Table ${closedSession.tableNumber} is already cleared and available.`,
          });
          return;
        }
      }

      res.json({
        success: true,
        data: { tableNumber: cleanTable || 'Table', status: 'AVAILABLE' },
        message: `Table ${cleanTable || 'Table'} is currently available.`,
      });
      return;
    }

    // Verify restaurant ownership (Multi-tenant data isolation)
    if (session.restaurantId !== restaurant.id) {
      throw new AppError('Access denied: You do not have permission to clear this restaurant table.', 403, 'FORBIDDEN');
    }

    // Clearance verification: Check for unpaid orders
    const nonCancelledOrders = session.orders.filter((o) => o.status !== 'CANCELLED');
    const unpaidOrders = nonCancelledOrders.filter((o) => o.paymentStatus !== 'PAID');
    const unpaidAmount = unpaidOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    if (unpaidOrders.length > 0 && !forceClear) {
      throw new AppError(
        `Cannot clear ${session.tableNumber}: There are ${unpaidOrders.length} unpaid orders (₹${unpaidAmount.toFixed(2)} pending). Please collect payment before clearing the table.`,
        400,
        'UNPAID_ORDERS_REMAINING'
      );
    }

    const now = new Date();
    const closureStaffId = req.user?.id || 'Staff';
    const closureStaffName = req.user?.name || req.user?.email || 'Authorized Staff';

    // Atomic transaction: close session, update batches, mark orders, and create audit log
    await prisma.$transaction(async (tx) => {
      // 1. Close table session
      await tx.tableSession.update({
        where: { id: session!.id },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          closedAt: now,
          closedBy: closureStaffId,
          closureReason: reason || 'Manual Table Clearance by Staff',
          paymentStatus: unpaidOrders.length === 0 ? 'PAID' : session!.paymentStatus,
        },
      });

      // 2. Mark any open batches as COMPLETED
      await tx.orderBatch.updateMany({
        where: {
          sessionId: session!.id,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          servedAt: now,
        },
      });

      // 3. Mark all active orders as DELIVERED
      await tx.order.updateMany({
        where: {
          tableSessionId: session!.id,
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
        },
        data: {
          status: 'DELIVERED',
          deliveredAt: now,
        },
      });

      // 4. Create Table Clearance Log (Audit Trail)
      await tx.tableClearanceLog.create({
        data: {
          restaurantId: session!.restaurantId,
          tableNumber: session!.tableNumber,
          sessionId: session!.id,
          staffId: closureStaffId,
          staffName: closureStaffName,
          action: 'CLEAR_TABLE',
          reason: reason || (unpaidOrders.length === 0 ? 'Table cleared after payment' : 'Staff force clearance'),
          clearedAt: now,
        },
      });
    });

    // Real-time broadcast
    emitTableSessionUpdate(session.restaurantId, session.tableNumber, {
      sessionId: session.id,
      tableNumber: session.tableNumber,
      status: 'AVAILABLE',
      event: 'TABLE_CLEARED',
      message: `${session.tableNumber} has been cleared and is now available for new diners.`,
    });

    logger.info(`Table ${session.tableNumber} (Session ${session.id}) cleared by ${closureStaffName} (${closureStaffId})`);

    res.json({
      success: true,
      data: {
        tableNumber: session.tableNumber,
        sessionId: session.id,
        status: 'AVAILABLE',
      },
      message: `${session.tableNumber} has been successfully cleared and marked as AVAILABLE.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Rate limit tracking for 4-digit Table Access Code validation.
 * 5 failed attempts per table/device locks verification for 5 minutes.
 */
interface AccessCodeRateLimitEntry {
  attempts: number;
  lockedUntil?: number;
}
const accessCodeRateLimitMap = new Map<string, AccessCodeRateLimitEntry>();
const MAX_ACCESS_CODE_ATTEMPTS = 5;
const ACCESS_CODE_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generates a random 4-digit numeric table access code (1000-9999).
 */
export function generateRandomAccessCode(): string {
  return Math.floor(1000 + crypto.randomInt(9000)).toString();
}

/**
 * Computes SHA-256 hash of an access code.
 */
export function hashAccessCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

/**
 * POST /api/v1/table-sessions/check-access
 * Customer QR scan access control endpoint.
 * Evaluates current table status, enforces single primary device ownership,
 * dual mode rules, and handles table access codes.
 */
export async function checkTableStatusAndAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { restaurantSlug, restaurantId, tableNumber, guestName, guestCount, deviceReference, activeOrderId } = req.body as {
      restaurantSlug?: string;
      restaurantId?: string;
      tableNumber?: string;
      guestName?: string;
      guestCount?: number;
      deviceReference?: string;
      activeOrderId?: string;
    };

    if (!tableNumber) {
      throw new AppError('Table number is required.', 400, 'TABLE_REQUIRED');
    }

    const deviceRef = (req.headers['x-device-id'] as string) || deviceReference || (req.query.deviceReference as string) || null;
    const reqActiveOrderId = activeOrderId || (req.headers['x-active-order-id'] as string) || (req.query.activeOrderId as string) || null;
    const cleanTable = normalizeTableNumber(tableNumber);

    // Resolve restaurant
    let restaurant = null;
    if (restaurantId) {
      restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true, name: true, slug: true, sessionManagementMode: true, qrSettings: true },
      });
    } else if (restaurantSlug) {
      restaurant = await prisma.restaurant.findUnique({
        where: { slug: restaurantSlug },
        select: { id: true, name: true, slug: true, sessionManagementMode: true, qrSettings: true },
      });
    }

    if (!restaurant) {
      throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
    }

    // Check if QR service is shut down / in maintenance
    if ((restaurant.qrSettings as any)?.enabled === false) {
      res.status(503).json({
        success: false,
        code: 'QR_SERVICE_MAINTENANCE',
        message: 'Currently maintenance is going on kindly order normally!',
        data: {
          isAvailable: false,
          isMaintenance: true,
          tableNumber: cleanTable,
          restaurantName: restaurant.name,
        },
      });
      return;
    }

    const currentMode = restaurant.sessionManagementMode || 'MANUAL';

    // Check for an active session
    let session = await prisma.tableSession.findFirst({
      where: {
        restaurantId: restaurant.id,
        tableNumber: cleanTable,
        status: 'ACTIVE',
      },
      include: {
        orders: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
        deviceAccesses: {
          where: { revokedAt: null },
        },
      },
    });

    if (session) {
      const mode = session.sessionManagementModeSnapshot || currentMode;
      const nonCancelledOrders = session.orders.filter((o) => o.status !== 'CANCELLED');
      const paidOrders = nonCancelledOrders.filter((o) => o.paymentStatus === 'PAID');
      const isAllPaid = nonCancelledOrders.length > 0 && paidOrders.length === nonCancelledOrders.length;

      // In Auto Session Reset Mode:
      // If previous dining orders were all paid, auto-close the old session and create a brand-new session
      if (mode === 'AUTO' && isAllPaid) {
        const now = new Date();
        await prisma.tableSession.update({
          where: { id: session.id },
          data: {
            status: 'COMPLETED',
            completedAt: now,
            closedAt: now,
            closedBy: 'AUTO_SESSION_RESET',
            closureReason: 'Auto Session Reset: All orders settled upon fresh QR scan',
            paymentStatus: 'PAID',
          },
        });

        // Revoke previous session device accesses
        await prisma.sessionDeviceAccess.updateMany({
          where: { sessionId: session.id, revokedAt: null },
          data: { revokedAt: now },
        });

        res.json({
          success: true,
          data: {
            isAvailable: true,
            status: 'AVAILABLE',
            role: 'PRIMARY',
            isPrimary: true,
            isOccupied: false,
            tableNumber: cleanTable,
            restaurantId: restaurant.id,
            restaurantSlug: restaurant.slug,
            session: null,
          },
        });
        return;
      }

      // If active session has no orders placed yet, allow customer to order freely as primary device
      if (nonCancelledOrders.length === 0) {
        if (deviceRef && (!session.primaryDeviceReference || session.primaryDeviceReference !== deviceRef)) {
          await prisma.tableSession.update({
            where: { id: session.id },
            data: { primaryDeviceReference: deviceRef },
          });
          await prisma.sessionDeviceAccess.upsert({
            where: {
              sessionId_deviceReference: {
                sessionId: session.id,
                deviceReference: deviceRef,
              },
            },
            create: {
              sessionId: session.id,
              deviceReference: deviceRef,
              role: 'PRIMARY',
            },
            update: {
              role: 'PRIMARY',
              revokedAt: null,
            },
          });
        }

        res.json({
          success: true,
          data: {
            isAvailable: true,
            isAuthorized: true,
            status: 'AVAILABLE',
            role: 'PRIMARY',
            isPrimary: true,
            isOccupied: false,
            tableNumber: cleanTable,
            restaurantId: restaurant.id,
            restaurantSlug: restaurant.slug,
            session: {
              id: session.id,
              sessionCode: session.sessionCode,
              tableNumber: cleanTable,
            },
          },
        });
        return;
      }

      // Check device authorization for active session
      let isAuthorized = false;
      let deviceRole = 'SECONDARY';

      if (deviceRef) {
        if (session.primaryDeviceReference && session.primaryDeviceReference === deviceRef) {
          isAuthorized = true;
          deviceRole = 'PRIMARY';
        } else {
          const deviceAccess = session.deviceAccesses.find(
            (d) => d.deviceReference === deviceRef && !d.revokedAt
          );
          if (deviceAccess) {
            isAuthorized = true;
            deviceRole = deviceAccess.role;
          }
        }
      }

      // If customer provides their active order ID (or clicked Add More Items / Back to Menu),
      // verify if that order belongs to this session's orders. If so, they are authorized!
      if (reqActiveOrderId) {
        const matchingOrder = session.orders.find((o) => o.id === reqActiveOrderId);
        if (matchingOrder) {
          isAuthorized = true;
          if (session.primaryDeviceReference === deviceRef) {
            deviceRole = 'PRIMARY';
          }
        }
      }

      if (isAuthorized && deviceRef) {
        // Ensure device access is registered so subsequent calls without activeOrderId remain authorized
        try {
          await prisma.sessionDeviceAccess.upsert({
            where: {
              sessionId_deviceReference: {
                sessionId: session.id,
                deviceReference: deviceRef,
              },
            },
            create: {
              sessionId: session.id,
              deviceReference: deviceRef,
              role: deviceRole as any,
            },
            update: {
              revokedAt: null,
            },
          });
        } catch {
          // ignore duplicate upsert race
        }
      }

      // In Manual Table Clearance Mode:
      // If orders are paid, the table remains locked and unavailable until cleared by staff
      // EXCEPT when the authorized diner on this table is adding more items to their session!
      if (mode === 'MANUAL' && (isAllPaid || session.paymentStatus === 'PAID')) {
        if (!isAuthorized) {
          res.status(409).json({
            success: false,
            code: 'TABLE_ALREADY_OCCUPIED',
            message: 'This table is currently marked as occupied. If the table is physically empty, you can call the waiter.',
            data: {
              isAvailable: false,
              isOccupied: true,
              requiresAccessCode: true,
              tableNumber: cleanTable,
              sessionId: session.id,
              restaurantId: restaurant.id,
              restaurantSlug: restaurant.slug,
              status: 'PAID_AWAITING_CLEARANCE',
            },
          });
          return;
        }
      }

      // If session is active and dining in progress:
      // 1. Authorized device (Primary or authorized Secondary) can browse and order
      if (isAuthorized) {
        const nonCancelledOrders = session.orders.filter((o) => o.status !== 'CANCELLED');
        const latestActiveOrder = nonCancelledOrders[0] || null;
        const accessCode = latestActiveOrder?.verificationCode || session.sessionCode || session.tableAccessCode || '1234';

        res.json({
          success: true,
          data: {
            isAvailable: true,
            isAuthorized: true,
            status: 'OCCUPIED_DINING',
            role: deviceRole,
            isPrimary: deviceRole === 'PRIMARY',
            tableAccessCode: deviceRole === 'PRIMARY' ? accessCode : undefined,
            orderVerificationCode: accessCode,
            activeOrderId: latestActiveOrder?.id || null,
            activeOrder: latestActiveOrder
              ? {
                  id: latestActiveOrder.id,
                  orderNumber: latestActiveOrder.id.slice(-8).toUpperCase(),
                  status: latestActiveOrder.status,
                  total: latestActiveOrder.total,
                  verificationCode: latestActiveOrder.verificationCode || accessCode,
                  createdAt: latestActiveOrder.createdAt,
                }
              : null,
            session: {
              id: session.id,
              sessionCode: session.sessionCode,
              tableAccessCode: deviceRole === 'PRIMARY' ? accessCode : undefined,
              orderVerificationCode: accessCode,
              tableNumber: cleanTable,
            },
          },
        });
        return;
      }

      // 2. Unrecognized device scanning an active table:
      // Reject with 409 TABLE_ALREADY_OCCUPIED to trigger dedicated Occupied View
      res.status(409).json({
        success: false,
        code: 'TABLE_ALREADY_OCCUPIED',
        message: 'An active order already exists for this table.',
        data: {
          isAvailable: false,
          isOccupied: true,
          requiresAccessCode: true,
          tableNumber: cleanTable,
          sessionId: session.id,
          restaurantId: restaurant.id,
          restaurantSlug: restaurant.slug,
          status: 'OCCUPIED_DINING',
        },
      });
      return;
    }

    // SCENARIO A: TABLE AVAILABLE
    // Table is free and available for dining. A table session row is created upon order submission.
    res.json({
      success: true,
      data: {
        isAvailable: true,
        status: 'AVAILABLE',
        role: 'PRIMARY',
        isPrimary: true,
        isOccupied: false,
        tableNumber: cleanTable,
        restaurantId: restaurant.id,
        restaurantSlug: restaurant.slug,
        session: null,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/table-sessions/validate-access-code
 * Server-side validation of 4-digit Table Access Code for secondary devices.
 * Enforces rate limiting, locks out after 5 attempts, and grants access to shared table bill.
 */
export async function validateTableAccessCode(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { restaurantId, restaurantSlug, tableNumber, accessCode, deviceReference } = req.body as {
      restaurantId?: string;
      restaurantSlug?: string;
      tableNumber?: string;
      accessCode?: string;
      deviceReference?: string;
    };

    if (!tableNumber) {
      throw new AppError('Table number is required.', 400, 'TABLE_REQUIRED');
    }

    if (!accessCode || !/^\d{4}$/.test(accessCode.trim())) {
      throw new AppError('A valid 4-digit Table Access Code is required.', 400, 'INVALID_ACCESS_CODE_FORMAT');
    }

    const deviceRef = (req.headers['x-device-id'] as string) || deviceReference || 'secondary-device';
    const cleanTable = normalizeTableNumber(tableNumber);

    // Resolve restaurant
    let restaurant = null;
    if (restaurantId) {
      restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true, name: true, slug: true },
      });
    } else if (restaurantSlug) {
      restaurant = await prisma.restaurant.findUnique({
        where: { slug: restaurantSlug },
        select: { id: true, name: true, slug: true },
      });
    }

    if (!restaurant) {
      throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
    }

    // Rate Limiting Check
    const rateLimitKey = `${restaurant.id}_${cleanTable.toLowerCase()}_${deviceRef}`;
    const now = Date.now();
    const rateEntry = accessCodeRateLimitMap.get(rateLimitKey);

    if (rateEntry && rateEntry.lockedUntil && rateEntry.lockedUntil > now) {
      const remainingSeconds = Math.ceil((rateEntry.lockedUntil - now) / 1000);
      res.status(429).json({
        success: false,
        code: 'ACCESS_CODE_LOCKED_OUT',
        message: `Too many incorrect attempts. Table access verification is temporarily locked. Please try again in ${remainingSeconds} seconds or call the waiter.`,
        data: { remainingSeconds, locked: true },
      });
      return;
    }

    // Look up active table session
    const session = await prisma.tableSession.findFirst({
      where: {
        restaurantId: restaurant.id,
        tableNumber: cleanTable,
        status: 'ACTIVE',
      },
      include: {
        orders: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            total: true,
            verificationCode: true,
            createdAt: true,
          },
        },
      },
    });

    if (!session) {
      throw new AppError('No active table session found for this table.', 404, 'SESSION_NOT_FOUND');
    }

    const inputCode = accessCode.trim();
    const inputHash = hashAccessCode(inputCode);

    // Reuse the existing 4-digit Order Verification Code system
    const activeOrder = session.orders.find((o) => o.status !== 'CANCELLED' && o.paymentStatus !== 'PAID') || session.orders[0];
    const orderVerificationCode = activeOrder?.verificationCode;

    const isValid =
      (orderVerificationCode && orderVerificationCode === inputCode) ||
      session.orders.some((o) => o.verificationCode === inputCode) ||
      (session.sessionCode === inputCode) ||
      (session.tableAccessCode && session.tableAccessCode === inputCode) ||
      (session.accessCodeHash && session.accessCodeHash === inputHash);

    if (!isValid) {
      const attempts = (rateEntry ? rateEntry.attempts : 0) + 1;
      if (attempts >= MAX_ACCESS_CODE_ATTEMPTS) {
        accessCodeRateLimitMap.set(rateLimitKey, {
          attempts,
          lockedUntil: now + ACCESS_CODE_LOCKOUT_MS,
        });
        res.status(429).json({
          success: false,
          code: 'ACCESS_CODE_LOCKED_OUT',
          message: 'Too many incorrect attempts. Table order verification is locked for 5 minutes. Please call the waiter for assistance.',
          data: { remainingSeconds: 300, locked: true, remainingAttempts: 0 },
        });
        return;
      } else {
        accessCodeRateLimitMap.set(rateLimitKey, { attempts });
        const remainingAttempts = MAX_ACCESS_CODE_ATTEMPTS - attempts;
        res.status(401).json({
          success: false,
          code: 'INVALID_ORDER_VERIFICATION_CODE',
          message: 'Invalid Order Verification Code. Please check the 4-digit code shown on the screen of the person who placed the table order.',
          data: { remainingAttempts, locked: false },
        });
        return;
      }
    }

    // Code is valid! Clear rate limit entry
    accessCodeRateLimitMap.delete(rateLimitKey);

    // Grant SECONDARY device authorization
    await prisma.sessionDeviceAccess.upsert({
      where: {
        sessionId_deviceReference: {
          sessionId: session.id,
          deviceReference: deviceRef,
        },
      },
      create: {
        sessionId: session.id,
        deviceReference: deviceRef,
        role: 'SECONDARY',
      },
      update: {
        role: 'SECONDARY',
        revokedAt: null,
      },
    });

    // Calculate current table bill rollup
    const nonCancelledOrders = session.orders.filter((o) => o.status !== 'CANCELLED');
    const totalAmount = nonCancelledOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const paidOrders = nonCancelledOrders.filter((o) => o.paymentStatus === 'PAID');
    const paidAmount = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const latestActiveOrder = nonCancelledOrders[0] || null;

    res.json({
      success: true,
      message: 'Access granted. You are now connected to the table bill.',
      data: {
        authorized: true,
        role: 'SECONDARY',
        isPrimary: false,
        activeOrderId: latestActiveOrder?.id || null,
        activeOrder: latestActiveOrder
          ? {
              id: latestActiveOrder.id,
              orderNumber: latestActiveOrder.id.slice(-8).toUpperCase(),
              status: latestActiveOrder.status,
              total: latestActiveOrder.total,
              verificationCode: latestActiveOrder.verificationCode,
              createdAt: latestActiveOrder.createdAt,
            }
          : null,
        session: {
          id: session.id,
          sessionCode: session.sessionCode,
          tableNumber: cleanTable,
          status: session.status,
          orderCount: nonCancelledOrders.length,
          totalAmount: Number(totalAmount.toFixed(2)),
          paidAmount: Number(paidAmount.toFixed(2)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}
