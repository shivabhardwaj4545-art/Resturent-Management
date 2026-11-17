import { Request, Response, NextFunction } from 'express';
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
 * POST /api/v1/table-sessions/check-access
 * Customer QR scan access control endpoint.
 * Evaluates current table status, enforces dual mode rules, and manages session creation.
 */
export async function checkTableStatusAndAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { restaurantSlug, restaurantId, tableNumber, guestName, guestCount } = req.body as {
      restaurantSlug?: string;
      restaurantId?: string;
      tableNumber?: string;
      guestName?: string;
      guestCount?: number;
    };

    if (!tableNumber) {
      throw new AppError('Table number is required.', 400, 'TABLE_REQUIRED');
    }

    const cleanTable = normalizeTableNumber(tableNumber);

    // Resolve restaurant
    let restaurant = null;
    if (restaurantId) {
      restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true, name: true, slug: true, sessionManagementMode: true },
      });
    } else if (restaurantSlug) {
      restaurant = await prisma.restaurant.findUnique({
        where: { slug: restaurantSlug },
        select: { id: true, name: true, slug: true, sessionManagementMode: true },
      });
    }

    if (!restaurant) {
      throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
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

        // Create fresh session
        const sessionCode = await generateUniqueSessionCode(restaurant.id);
        const newSession = await prisma.tableSession.create({
          data: {
            restaurantId: restaurant.id,
            tableNumber: cleanTable,
            sessionCode,
            guestCount: guestCount ? Number(guestCount) : 1,
            currentBatchNumber: 1,
            status: 'ACTIVE',
            paymentStatus: 'PENDING',
            sessionManagementModeSnapshot: currentMode,
            notes: guestName ? `Initiated by ${guestName}` : undefined,
          },
        });

        await prisma.orderBatch.create({
          data: {
            sessionId: newSession.id,
            restaurantId: restaurant.id,
            batchNumber: 1,
            status: 'OPEN',
          },
        });

        res.json({
          success: true,
          data: {
            isAvailable: true,
            status: 'AVAILABLE',
            session: {
              id: newSession.id,
              sessionCode: newSession.sessionCode,
              tableNumber: cleanTable,
            },
          },
        });
        return;
      }

      // In Manual Table Clearance Mode:
      // If orders are paid, the table remains locked and unavailable until cleared by staff
      if (mode === 'MANUAL' && (isAllPaid || session.paymentStatus === 'PAID')) {
        res.status(403).json({
          success: false,
          code: 'TABLE_CURRENTLY_OCCUPIED',
          message: 'This table is currently unavailable for new orders. Please contact restaurant staff.',
          data: {
            isAvailable: false,
            locked: true,
            tableNumber: cleanTable,
            status: 'PAID_AWAITING_CLEARANCE',
          },
        });
        return;
      }

      // If session is active and dining in progress:
      // Allow customers at this table to join and order under the SAME session
      res.json({
        success: true,
        data: {
          isAvailable: true,
          status: 'OCCUPIED_DINING',
          session: {
            id: session.id,
            sessionCode: session.sessionCode,
            tableNumber: cleanTable,
          },
        },
      });
      return;
    }

    // SCENARIO A: TABLE AVAILABLE
    // Atomically create a new table session
    const sessionCode = await generateUniqueSessionCode(restaurant.id);
    const newSession = await prisma.tableSession.create({
      data: {
        restaurantId: restaurant.id,
        tableNumber: cleanTable,
        sessionCode,
        guestCount: guestCount ? Number(guestCount) : 1,
        currentBatchNumber: 1,
        status: 'ACTIVE',
        paymentStatus: 'PENDING',
        sessionManagementModeSnapshot: currentMode,
        notes: guestName ? `Initiated by ${guestName}` : undefined,
      },
    });

    await prisma.orderBatch.create({
      data: {
        sessionId: newSession.id,
        restaurantId: restaurant.id,
        batchNumber: 1,
        status: 'OPEN',
      },
    });

    res.json({
      success: true,
      data: {
        isAvailable: true,
        status: 'AVAILABLE',
        session: {
          id: newSession.id,
          sessionCode: newSession.sessionCode,
          tableNumber: cleanTable,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}
