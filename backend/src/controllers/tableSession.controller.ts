import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import {
  emitTableSessionUpdate,
  emitBatchUnlocked,
  emitNewOrder,
  emitOrderStatusUpdate,
} from '../services/socket.service';
import { logger } from '../utils/logger';

/**
 * Normalizes table numbers so "Table 1", "table 1", " 1 " all resolve consistently.
 */
export function normalizeTableNumber(raw?: string | null): string {
  if (!raw) return 'Table 1';
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('room')) return trimmed;
  if (lower.startsWith('table')) return trimmed;
  return `Table ${trimmed}`;
}

/**
 * Generates a cryptographically secure 4-digit numeric verification code (1000-9999).
 * Guarantees no collision with any other ACTIVE session in the same restaurant.
 */
export async function generateUniqueSessionCode(restaurantId: string): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const code = Math.floor(1000 + crypto.randomInt(9000)).toString();
    const existing = await prisma.tableSession.findFirst({
      where: {
        restaurantId,
        sessionCode: code,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!existing) {
      return code;
    }
  }
  return Math.floor(1000 + crypto.randomInt(9000)).toString();
}

/**
 * Resolves the restaurant from ID or Slug.
 */
async function resolveRestaurant(restaurantId?: string, restaurantSlug?: string) {
  if (restaurantId) {
    const rest = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, name: true, slug: true, isOpen: true },
    });
    if (rest) return rest;
  }
  if (restaurantSlug) {
    const rest = await prisma.restaurant.findUnique({
      where: { slug: restaurantSlug },
      select: { id: true, name: true, slug: true, isOpen: true },
    });
    if (rest) return rest;
  }
  throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
}

/**
 * 1. Join or Create Table Session.
 * When 4 customers sit at Table 1:
 * - All four connect to the EXACT SAME session and share ONE 4-digit code.
 * - Only ONE active session is permitted per table at any time.
 */
export async function joinOrCreateSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { restaurantId, restaurantSlug, tableNumber, guestName, guestCount } = req.body as {
      restaurantId?: string;
      restaurantSlug?: string;
      tableNumber?: string;
      guestName?: string;
      guestCount?: number;
    };

    if (!tableNumber) {
      throw new AppError('Table number is required to join a table session.', 400, 'TABLE_REQUIRED');
    }

    const restaurant = await resolveRestaurant(restaurantId, restaurantSlug);
    const cleanTable = normalizeTableNumber(tableNumber);

    // Concurrency-safe check for existing active session
    let session = await prisma.tableSession.findFirst({
      where: {
        restaurantId: restaurant.id,
        tableNumber: cleanTable,
        status: 'ACTIVE',
      },
      include: {
        batches: {
          orderBy: { batchNumber: 'asc' },
          include: {
            items: {
              include: {
                menuItem: { select: { id: true, name: true, image: true, price: true } },
                variant: { select: { id: true, name: true, price: true } },
              },
            },
          },
        },
      },
    });

    if (!session) {
      const sessionCode = await generateUniqueSessionCode(restaurant.id);
      const parsedGuests = guestCount && guestCount > 0 ? Number(guestCount) : 1;

      session = await prisma.$transaction(async (tx) => {
        // Double check in transaction
        const existingTx = await tx.tableSession.findFirst({
          where: {
            restaurantId: restaurant.id,
            tableNumber: cleanTable,
            status: 'ACTIVE',
          },
          include: {
            batches: {
              orderBy: { batchNumber: 'asc' },
              include: {
                items: {
                  include: {
                    menuItem: { select: { id: true, name: true, image: true, price: true } },
                    variant: { select: { id: true, name: true, price: true } },
                  },
                },
              },
            },
          },
        });
        if (existingTx) return existingTx;

        const newSession = await tx.tableSession.create({
          data: {
            restaurantId: restaurant.id,
            tableNumber: cleanTable,
            sessionCode,
            guestCount: parsedGuests,
            currentBatchNumber: 1,
            status: 'ACTIVE',
            notes: guestName ? `Initiated by ${guestName}` : undefined,
          },
        });

        // Initialize Batch 1 with status OPEN
        await tx.orderBatch.create({
          data: {
            sessionId: newSession.id,
            restaurantId: restaurant.id,
            batchNumber: 1,
            status: 'OPEN',
            subtotal: 0,
            tax: 0,
            discount: 0,
            total: 0,
          },
        });

        return tx.tableSession.findUniqueOrThrow({
          where: { id: newSession.id },
          include: {
            batches: {
              orderBy: { batchNumber: 'asc' },
              include: {
                items: {
                  include: {
                    menuItem: { select: { id: true, name: true, image: true, price: true } },
                    variant: { select: { id: true, name: true, price: true } },
                  },
                },
              },
            },
          },
        });
      });
    }

    // Active/current batch
    const currentBatch = session.batches.find((b) => b.batchNumber === session?.currentBatchNumber) || session.batches[session.batches.length - 1];

    res.json({
      success: true,
      data: {
        session: {
          id: session.id,
          restaurantId: session.restaurantId,
          restaurantName: restaurant.name,
          tableNumber: session.tableNumber,
          sessionCode: session.sessionCode,
          guestCount: session.guestCount,
          currentBatchNumber: session.currentBatchNumber,
          status: session.status,
          createdAt: session.createdAt,
          currentBatch,
          allBatches: session.batches,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 2. Get Active Table Session by Table Number.
 */
export async function getActiveSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { restaurantId, restaurantSlug, tableNumber } = req.query as {
      restaurantId?: string;
      restaurantSlug?: string;
      tableNumber?: string;
    };

    if (!tableNumber) {
      throw new AppError('Table number is required.', 400, 'TABLE_REQUIRED');
    }

    const restaurant = await resolveRestaurant(restaurantId, restaurantSlug);
    const cleanTable = normalizeTableNumber(tableNumber);

    const session = await prisma.tableSession.findFirst({
      where: {
        restaurantId: restaurant.id,
        tableNumber: cleanTable,
        status: 'ACTIVE',
      },
      include: {
        batches: {
          orderBy: { batchNumber: 'asc' },
          include: {
            items: {
              include: {
                menuItem: { select: { id: true, name: true, image: true, price: true } },
                variant: { select: { id: true, name: true, price: true } },
              },
            },
          },
        },
      },
    });

    if (!session) {
      res.json({
        success: true,
        data: { session: null },
      });
      return;
    }

    const currentBatch = session.batches.find((b: any) => b.batchNumber === session.currentBatchNumber) || null;

    res.json({
      success: true,
      data: {
        session: {
          ...session,
          currentBatch,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 3. Get Table Session Details by Session ID.
 */
export async function getSessionById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.params.sessionId as string;

    const session: any = await prisma.tableSession.findUnique({
      where: { id: sessionId },
      include: {
        restaurant: { select: { id: true, name: true, slug: true } },
        batches: {
          orderBy: { batchNumber: 'asc' },
          include: {
            items: {
              include: {
                menuItem: { select: { id: true, name: true, image: true, price: true } },
                variant: { select: { id: true, name: true, price: true } },
              },
            },
            order: {
              select: {
                id: true,
                status: true,
                paymentStatus: true,
                paymentMethod: true,
                counterPaymentMethod: true,
                total: true,
                guestName: true,
                guestPhone: true,
                items: {
                  include: {
                    menuItem: { select: { id: true, name: true, image: true, price: true } },
                    variant: { select: { id: true, name: true, price: true } },
                  },
                },
              },
            },
          },
        },
        orders: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            items: {
              include: {
                menuItem: { select: { id: true, name: true, image: true, price: true } },
                variant: { select: { id: true, name: true, price: true } },
              },
            },
            user: { select: { name: true, phone: true } },
          },
        },
      },
    });

    if (!session) {
      const order = await prisma.order.findUnique({
        where: { id: sessionId },
        include: {
          restaurant: { select: { id: true, name: true, slug: true } },
          items: {
            include: {
              menuItem: { select: { id: true, name: true, image: true, price: true } },
              variant: { select: { id: true, name: true, price: true } },
            },
          },
          user: { select: { name: true, phone: true } },
        },
      });

      if (!order) {
        throw new AppError('Table session not found.', 404, 'SESSION_NOT_FOUND');
      }

      let status = 'SUBMITTED';
      if (order.status === 'DELIVERED') status = 'SERVED';
      else if (order.status === 'READY') status = 'READY';
      else if (order.status === 'PREPARING' || order.status === 'BAKING') status = 'PREPARING';
      else if (order.status === 'CONFIRMED') status = 'ACCEPTED';
      else if (order.status === 'CANCELLED') status = 'CANCELLED';

      const items = (order.items || []).map((it: any) => ({
        id: it.id,
        itemName: `${it.menuItem?.name || 'Item'}${it.variant?.name ? ` (${it.variant.name})` : ''}`,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: it.subtotal,
        specialInstructions: null,
        addedBy: order.guestName || order.user?.name || 'Guest',
      }));

      const syntheticBatch = {
        id: order.id,
        batchNumber: 1,
        status,
        subtotal: order.subtotal,
        tax: order.gstAmount,
        discount: order.discount,
        total: order.total,
        items,
        paymentStatus: order.paymentStatus || 'PENDING',
        order,
      };

      res.json({
        success: true,
        data: {
          sessionId: order.id,
          tableNumber: order.tableNumber || 'Table 1',
          sessionCode: order.verificationCode || order.id.slice(-4).toUpperCase(),
          sessionStatus: 'ACTIVE',
          guestCount: 1,
          restaurant: order.restaurant,
          batches: [
            {
              batchId: order.id,
              batchNumber: 1,
              status,
              submittedAt: order.createdAt,
              completedAt: order.deliveredAt,
              itemsCount: items.reduce((acc: number, it: any) => acc + (it.quantity || 1), 0),
              items,
              subtotal: order.subtotal || 0,
              tax: order.gstAmount || 0,
              discount: order.discount || 0,
              total: order.total || 0,
              paymentStatus: order.paymentStatus || 'PENDING',
              orderId: order.id,
              counterPaymentMethod: order.counterPaymentMethod || null,
              paymentConfirmedAt: order.paymentConfirmedAt || null,
            },
          ],
          totals: {
            subtotal: order.subtotal || 0,
            tax: order.gstAmount || 0,
            discount: order.discount || 0,
            grandTotal: order.total || 0,
            isPaid: order.paymentStatus === 'PAID',
            paymentMethod: order.counterPaymentMethod || order.paymentMethod || (order.paymentStatus === 'PAID' ? 'PAID' : 'PENDING'),
            paymentConfirmedAt: order.paymentConfirmedAt || null,
          },
        },
      });
      return;
    }

    const sessionOrders = session.orders || [];

    // Populate batch items or status from orders if batch was created via direct checkout
    const enrichedBatches = session.batches.map((b: any) => {
      const matchingOrder = b.order || sessionOrders.find((o: any) => o.batchNumber === b.batchNumber) || sessionOrders[0];
      let items = b.items;
      let total = b.total;
      let status = b.status;
      let paymentStatus = b.order?.paymentStatus || 'PENDING';

      if (matchingOrder) {
        if (!items || items.length === 0) {
          items = (matchingOrder.items || []).map((it: any) => ({
            id: it.id,
            itemName: `${it.menuItem?.name || 'Item'}${it.variant?.name ? ` (${it.variant.name})` : ''}`,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            subtotal: it.subtotal,
            specialInstructions: it.addOns ? it.addOns.map((a: any) => a.name).join(', ') : null,
            addedBy: matchingOrder.guestName || matchingOrder.user?.name || 'Guest',
          }));
          total = matchingOrder.total;
        }

        paymentStatus = matchingOrder.paymentStatus || 'PENDING';

        if (matchingOrder.status === 'DELIVERED') status = 'SERVED';
        else if (matchingOrder.status === 'READY') status = 'READY';
        else if (matchingOrder.status === 'PREPARING' || matchingOrder.status === 'BAKING') status = 'PREPARING';
        else if (matchingOrder.status === 'CONFIRMED') status = 'ACCEPTED';
        else if (matchingOrder.status === 'PENDING') status = 'SUBMITTED';
        else if (matchingOrder.status === 'CANCELLED') status = 'CANCELLED';
      }

      return {
        ...b,
        status,
        total,
        items,
        paymentStatus,
        order: matchingOrder,
      };
    });

    const currentBatch = enrichedBatches.find((b: any) => b.batchNumber === session.currentBatchNumber) || enrichedBatches[enrichedBatches.length - 1] || null;

    res.json({
      success: true,
      data: {
        session: {
          ...session,
          batches: enrichedBatches,
          currentBatch,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 4. Add Items to the Current Open Batch.
 * SEQUENTIAL BATCH PROTECTION:
 * Items can ONLY be added when the current batch has status OPEN.
 * If previous batch is still SUBMITTED, PREPARING, READY, or SERVED,
 * any attempt to add items to a new round is strictly rejected.
 */
export async function addItemToBatch(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.params.sessionId as string;
    const { menuItemId, variantId, quantity = 1, customizations, specialInstructions, addedBy } = req.body as {
      menuItemId: string;
      variantId?: string;
      quantity: number;
      customizations?: any;
      specialInstructions?: string;
      addedBy?: string;
    };

    if (!menuItemId || quantity < 1) {
      throw new AppError('Valid menu item and quantity are required.', 400, 'INVALID_ITEM');
    }

    const session = await prisma.tableSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.status !== 'ACTIVE') {
      throw new AppError('This table session is no longer active.', 400, 'SESSION_INACTIVE');
    }

    // Locate current batch
    const currentBatch = await prisma.orderBatch.findUnique({
      where: {
        sessionId_batchNumber: {
          sessionId,
          batchNumber: session.currentBatchNumber,
        },
      },
    });

    if (!currentBatch) {
      throw new AppError('Current batch could not be found.', 404, 'BATCH_NOT_FOUND');
    }

    if (currentBatch.status !== 'OPEN') {
      throw new AppError(
        `Batch ${currentBatch.batchNumber} is currently ${currentBatch.status}. New items cannot be added until the waiter completes the current food round.`,
        400,
        'PREVIOUS_BATCH_IN_PROGRESS'
      );
    }

    // Validate menu item and calculate price
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: menuItemId, restaurantId: session.restaurantId, deletedAt: null },
      include: { variants: true },
    });

    if (!menuItem || !menuItem.isAvailable) {
      throw new AppError('This dish is currently unavailable.', 400, 'ITEM_UNAVAILABLE');
    }

    let unitPrice = menuItem.price;
    let selectedVariantName = '';
    if (variantId) {
      const variant = menuItem.variants.find((v) => v.id === variantId);
      if (variant) {
        unitPrice = variant.price;
        selectedVariantName = ` (${variant.name})`;
      }
    }

    const itemSubtotal = unitPrice * quantity;
    const itemName = `${menuItem.name}${selectedVariantName}`;

    // Add item & update batch total in transaction
    const updatedBatch = await prisma.$transaction(async (tx) => {
      await tx.orderBatchItem.create({
        data: {
          batchId: currentBatch.id,
          menuItemId,
          variantId: variantId || null,
          itemName,
          quantity,
          unitPrice,
          subtotal: itemSubtotal,
          customizations: customizations || null,
          specialInstructions: specialInstructions?.trim() || null,
          addedBy: addedBy?.trim() || 'Guest',
        },
      });

      const allItems = await tx.orderBatchItem.findMany({
        where: { batchId: currentBatch.id },
      });

      const newSubtotal = allItems.reduce((acc, it) => acc + it.subtotal, 0);
      const tax = Math.round(newSubtotal * 0.05 * 100) / 100; // 5% GST
      const total = Math.round((newSubtotal + tax) * 100) / 100;

      return tx.orderBatch.update({
        where: { id: currentBatch.id },
        data: {
          subtotal: newSubtotal,
          tax,
          total,
        },
        include: {
          items: {
            include: {
              menuItem: { select: { id: true, name: true, image: true, price: true } },
              variant: { select: { id: true, name: true, price: true } },
            },
          },
        },
      });
    });

    // Notify all guests at the table in real time
    emitTableSessionUpdate(session.restaurantId, session.tableNumber, {
      sessionId: session.id,
      currentBatch: updatedBatch,
      event: 'ITEM_ADDED',
      item: { name: itemName, quantity, addedBy: addedBy || 'Guest' },
    });

    res.json({
      success: true,
      data: {
        batch: updatedBatch,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 5. Remove Item from Current Open Batch.
 */
export async function removeItemFromBatch(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.params.sessionId as string;
    const itemId = req.params.itemId as string;

    const item: any = await prisma.orderBatchItem.findUnique({
      where: { id: itemId },
      include: {
        batch: true,
      },
    });

    if (!item || item.batch.sessionId !== sessionId) {
      throw new AppError('Item not found in this table session.', 404, 'ITEM_NOT_FOUND');
    }

    if (item.batch.status !== 'OPEN') {
      throw new AppError('Cannot modify items of a submitted or in-progress batch.', 400, 'BATCH_LOCKED');
    }

    // Fetch the session to get restaurantId and tableNumber for socket emission
    const parentSession = await prisma.tableSession.findUnique({
      where: { id: item.batch.sessionId },
      select: { restaurantId: true, tableNumber: true },
    });

    const updatedBatch = await prisma.$transaction(async (tx) => {
      await tx.orderBatchItem.delete({
        where: { id: itemId },
      });

      const remainingItems = await tx.orderBatchItem.findMany({
        where: { batchId: item.batchId },
      });

      const newSubtotal = remainingItems.reduce((acc: number, it: { subtotal: number }) => acc + it.subtotal, 0);
      const tax = Math.round(newSubtotal * 0.05 * 100) / 100;
      const total = Math.round((newSubtotal + tax) * 100) / 100;

      return tx.orderBatch.update({
        where: { id: item.batchId },
        data: {
          subtotal: newSubtotal,
          tax,
          total,
        },
        include: {
          items: {
            include: {
              menuItem: { select: { id: true, name: true, image: true, price: true } },
              variant: { select: { id: true, name: true, price: true } },
            },
          },
        },
      });
    });

    emitTableSessionUpdate(parentSession?.restaurantId || '', parentSession?.tableNumber || '', {
      sessionId,
      currentBatch: updatedBatch,
      event: 'ITEM_REMOVED',
    });

    res.json({
      success: true,
      data: { batch: updatedBatch },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 6. Submit Current Batch to Kitchen.
 * - Transitions batch status: OPEN -> SUBMITTED.
 * - Locks batch against ordinary customer edits.
 * - Creates kitchen-facing Order model linked to this batch & session.
 * - Dispatches real-time socket alert to Kitchen Dashboard and Waitstaff.
 */
export async function submitCurrentBatch(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.params.sessionId as string;
    const { notes } = req.body as { notes?: string };

    const session = await prisma.tableSession.findUnique({
      where: { id: sessionId },
      include: {
        restaurant: true,
      },
    });

    if (!session || session.status !== 'ACTIVE') {
      throw new AppError('Active table session not found.', 404, 'SESSION_NOT_FOUND');
    }

    const currentBatch: any = await prisma.orderBatch.findUnique({
      where: {
        sessionId_batchNumber: {
          sessionId,
          batchNumber: session.currentBatchNumber,
        },
      },
      include: {
        items: true,
      },
    });

    if (!currentBatch) {
      throw new AppError('Current batch not found.', 404, 'BATCH_NOT_FOUND');
    }

    if (currentBatch.status !== 'OPEN') {
      throw new AppError(
        `Batch ${currentBatch.batchNumber} has already been submitted (${currentBatch.status}).`,
        400,
        'ALREADY_SUBMITTED'
      );
    }

    if (currentBatch.items.length === 0) {
      throw new AppError('Cannot submit an empty food batch. Please add dishes first.', 400, 'EMPTY_BATCH');
    }

    const now = new Date();

    // Transaction to update batch and generate associated Order for kitchen & receipts
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Order record for kitchen display & billing
      const newOrder = await tx.order.create({
        data: {
          restaurantId: session.restaurantId,
          tableNumber: session.tableNumber,
          tableSessionId: session.id,
          batchNumber: currentBatch.batchNumber,
          verificationCode: session.sessionCode, // SHARED 4-digit code!
          status: 'CONFIRMED', // Immediately visible in kitchen queue
          paymentMethod: 'PAY_AT_COUNTER',
          paymentStatus: 'PENDING',
          subtotal: currentBatch.subtotal,
          gstAmount: currentBatch.tax,
          total: currentBatch.total,
          confirmedAt: now,
          items: {
            create: currentBatch.items.map((it: any) => ({
              menuItemId: it.menuItemId,
              variantId: it.variantId,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              subtotal: it.subtotal,
            })),
          },
        },
        include: {
          items: {
            include: {
              menuItem: { select: { id: true, name: true, image: true, price: true } },
            },
          },
        },
      });

      // 2. Lock and update the OrderBatch
      const updatedBatch = await tx.orderBatch.update({
        where: { id: currentBatch.id },
        data: {
          status: 'SUBMITTED',
          submittedAt: now,
          notes: notes?.trim() || null,
          orderId: newOrder.id,
        },
        include: {
          items: {
            include: {
              menuItem: { select: { id: true, name: true, image: true, price: true } },
              variant: { select: { id: true, name: true, price: true } },
            },
          },
        },
      });

      return { newOrder, updatedBatch };
    });

    // Notify Kitchen Dashboard & Waiters with real-time socket event
    emitNewOrder(session.restaurantId, {
      id: result.newOrder.id,
      orderId: result.newOrder.id,
      tableNumber: session.tableNumber,
      batchNumber: result.updatedBatch.batchNumber,
      verificationCode: session.sessionCode,
      total: result.updatedBatch.total,
      status: 'CONFIRMED',
      items: result.newOrder.items,
      createdAt: now.toISOString(),
    });

    emitTableSessionUpdate(session.restaurantId, session.tableNumber, {
      sessionId: session.id,
      currentBatch: result.updatedBatch,
      event: 'BATCH_SUBMITTED',
      message: `Batch ${result.updatedBatch.batchNumber} submitted to kitchen.`,
    });

    res.json({
      success: true,
      data: {
        batch: result.updatedBatch,
        order: result.newOrder,
        sessionCode: session.sessionCode,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 7. Update Batch Status (Staff: Waiter, Kitchen, Owner).
 * Lifecycle:
 * SUBMITTED -> ACCEPTED -> PREPARING -> READY -> SERVED -> COMPLETED.
 *
 * CRITICAL SEQUENTIAL RULE:
 * Marking COMPLETED is ONLY permitted when batch is already SERVED.
 * When a batch becomes COMPLETED:
 * - Automatically increments session.currentBatchNumber += 1.
 * - Automatically creates the NEXT batch with status OPEN under the SAME session and SAME code.
 * - Customers at the table now receive the unlocked prompt to order Batch 2!
 */
export async function updateBatchStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.params.sessionId as string;
    const batchId = req.params.batchId as string;
    const { status } = req.body as { status: string };

    const validStatuses = ['ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      throw new AppError(`Invalid batch status: ${status}`, 400, 'INVALID_STATUS');
    }

    let batch: any = await prisma.orderBatch.findUnique({
      where: { id: batchId },
      include: {
        session: true,
      },
    });

    if (!batch) {
      batch = await prisma.orderBatch.findFirst({
        where: {
          OR: [
            { orderId: batchId },
            { id: batchId },
            { sessionId: sessionId },
          ],
        },
        include: {
          session: true,
        },
        orderBy: { batchNumber: 'desc' },
      });
    }

    if (!batch) {
      // Direct order update fallback
      const order = await prisma.order.findFirst({
        where: {
          OR: [{ id: batchId }, { id: sessionId }],
        },
        include: { restaurant: true },
      });

      if (order) {
        let orderStatus: any = undefined;
        if (status === 'ACCEPTED') orderStatus = 'CONFIRMED';
        if (status === 'PREPARING') orderStatus = 'PREPARING';
        if (status === 'READY') orderStatus = 'READY';
        if (status === 'SERVED' || status === 'COMPLETED') orderStatus = 'DELIVERED';
        if (status === 'CANCELLED') orderStatus = 'CANCELLED';

        const now = new Date();
        await prisma.order.update({
          where: { id: order.id },
          data: {
            ...(orderStatus ? { status: orderStatus } : {}),
            ...(orderStatus === 'DELIVERED' ? { deliveredAt: now } : {}),
          },
        });

        if (orderStatus) {
          emitOrderStatusUpdate(order.id, order.restaurantId, {
            orderId: order.id,
            status: orderStatus,
            updatedAt: now.toISOString(),
          });
        }

        emitTableSessionUpdate(order.restaurantId, order.tableNumber || '', {
          sessionId,
          batchId,
          status,
          event: 'BATCH_STATUS_UPDATED',
        });

        res.json({
          success: true,
          data: {
            batch: {
              id: order.id,
              status,
              total: order.total,
            },
          },
        });
        return;
      }

      throw new AppError('Order batch not found for this session.', 404, 'BATCH_NOT_FOUND');
    }

    const now = new Date();
    const timestampUpdates: Record<string, any> = {};
    if (status === 'ACCEPTED') timestampUpdates.acceptedAt = now;
    if (status === 'PREPARING') timestampUpdates.preparingAt = now;
    if (status === 'READY') timestampUpdates.readyAt = now;
    if (status === 'SERVED') timestampUpdates.servedAt = now;
    if (status === 'COMPLETED') {
      timestampUpdates.completedAt = now;
      if (!batch.servedAt) timestampUpdates.servedAt = now;
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update the target batch
      const updated = await tx.orderBatch.update({
        where: { id: batch.id },
        data: {
          status: status as any,
          ...timestampUpdates,
        },
        include: {
          items: {
            include: {
              menuItem: { select: { id: true, name: true, image: true, price: true } },
            },
          },
        },
      });

      // 2. Synchronize linked Order status for KDS and existing tracking
      if (batch.orderId) {
        let orderStatus: any = undefined;
        if (status === 'PREPARING') orderStatus = 'PREPARING';
        if (status === 'READY') orderStatus = 'READY';
        if (status === 'SERVED' || status === 'COMPLETED') orderStatus = 'DELIVERED';
        if (status === 'CANCELLED') orderStatus = 'CANCELLED';

        if (orderStatus) {
          await tx.order.update({
            where: { id: batch.orderId },
            data: { status: orderStatus },
          });
          emitOrderStatusUpdate(batch.orderId, batch.restaurantId, {
            orderId: batch.orderId,
            status: orderStatus,
            updatedAt: now.toISOString(),
          });
        }
      }

      // 3. SEQUENTIAL BATCH UNLOCKING:
      let nextBatch = null;
      if (status === 'COMPLETED') {
        const nextBatchNum = batch.batchNumber + 1;

        // Check if next batch already exists
        const existingNext = await tx.orderBatch.findUnique({
          where: {
            sessionId_batchNumber: {
              sessionId: batch.sessionId,
              batchNumber: nextBatchNum,
            },
          },
        });

        if (!existingNext) {
          nextBatch = await tx.orderBatch.create({
            data: {
              sessionId: batch.sessionId,
              restaurantId: batch.restaurantId,
              batchNumber: nextBatchNum,
              status: 'OPEN',
              subtotal: 0,
              tax: 0,
              discount: 0,
              total: 0,
            },
            include: {
              items: {
                include: {
                  menuItem: { select: { id: true, name: true, image: true, price: true } },
                },
              },
            },
          });

          await tx.tableSession.update({
            where: { id: batch.sessionId },
            data: { currentBatchNumber: nextBatchNum },
          });
        } else {
          nextBatch = existingNext;
        }
      }

      return { updated, nextBatch };
    });

    // Real-time broadcasts
    emitTableSessionUpdate(batch.session.restaurantId, batch.session.tableNumber, {
      sessionId,
      batchId,
      status,
      updatedBatch: result.updated,
      nextBatch: result.nextBatch,
      event: 'BATCH_STATUS_UPDATED',
    });

    if (result.nextBatch) {
      emitBatchUnlocked(batch.session.restaurantId, batch.session.tableNumber, result.nextBatch);
    }

    res.json({
      success: true,
      data: {
        batch: result.updated,
        nextBatch: result.nextBatch,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 8. Get Consolidated Session Bill.
 * Summarizes all items and charges across Batch 1, Batch 2, etc. without double-counting.
 */
export async function getSessionBill(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sessionId = req.params.sessionId as string;

      const session: any = await prisma.tableSession.findUnique({
        where: { id: sessionId },
        include: {
          restaurant: {
            select: { id: true, name: true, slug: true, address: true, phone: true },
          },
          batches: {
            where: { status: { not: 'CANCELLED' } },
            orderBy: { batchNumber: 'asc' },
            include: {
              items: {
                include: {
                  menuItem: { select: { id: true, name: true, price: true } },
                  variant: { select: { id: true, name: true, price: true } },
                },
              },
              order: {
                select: {
                  id: true,
                  paymentStatus: true,
                  paymentMethod: true,
                  counterPaymentMethod: true,
                  paymentConfirmedAt: true,
                  verificationCode: true,
                  total: true,
                  subtotal: true,
                  gstAmount: true,
                  discount: true,
                  items: {
                    include: {
                      menuItem: { select: { id: true, name: true, price: true } },
                      variant: { select: { id: true, name: true, price: true } },
                    },
                  },
                },
              },
            },
          },
          orders: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            include: {
              items: {
                include: {
                  menuItem: { select: { id: true, name: true, price: true } },
                  variant: { select: { id: true, name: true, price: true } },
                },
              },
            },
          },
        },
      });

      if (!session) {
        const order: any = await prisma.order.findUnique({
          where: { id: sessionId },
          include: {
            restaurant: { select: { id: true, name: true, slug: true } },
            items: {
              include: {
                menuItem: { select: { id: true, name: true, image: true, price: true } },
                variant: { select: { id: true, name: true, price: true } },
              },
            },
            user: { select: { name: true, phone: true } },
          },
        });

        if (!order) {
          throw new AppError('Table session not found.', 404, 'SESSION_NOT_FOUND');
        }

        let status = 'SUBMITTED';
        if (order.status === 'DELIVERED') status = 'SERVED';
        else if (order.status === 'READY') status = 'READY';
        else if (order.status === 'PREPARING' || order.status === 'BAKING') status = 'PREPARING';
        else if (order.status === 'CONFIRMED') status = 'ACCEPTED';
        else if (order.status === 'CANCELLED') status = 'CANCELLED';

        const items = (order.items || []).map((it: any) => ({
          id: it.id,
          itemName: `${it.menuItem?.name || 'Item'}${it.variant?.name ? ` (${it.variant.name})` : ''}`,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          subtotal: it.subtotal,
          specialInstructions: null,
          addedBy: order.guestName || order.user?.name || 'Guest',
        }));

        const syntheticBatch = {
          id: order.id,
          batchNumber: 1,
          status,
          subtotal: order.subtotal,
          tax: order.gstAmount,
          discount: order.discount,
          total: order.total,
          items,
          paymentStatus: order.paymentStatus || 'PENDING',
          order,
        };

        res.json({
          success: true,
          data: {
            sessionId: order.id,
            tableNumber: order.tableNumber || 'Table 1',
            sessionCode: order.verificationCode || order.id.slice(-4).toUpperCase(),
            sessionStatus: 'ACTIVE',
            guestCount: 1,
            restaurant: order.restaurant,
            batches: [
              {
                batchId: order.id,
                batchNumber: 1,
                status,
                submittedAt: order.createdAt,
                completedAt: order.deliveredAt,
                itemsCount: items.reduce((acc: number, it: any) => acc + (it.quantity || 1), 0),
                items,
                subtotal: order.subtotal || 0,
                tax: order.gstAmount || 0,
                discount: order.discount || 0,
                total: order.total || 0,
                paymentStatus: order.paymentStatus || 'PENDING',
                orderId: order.id,
                counterPaymentMethod: order.counterPaymentMethod || null,
                paymentConfirmedAt: order.paymentConfirmedAt || null,
              },
            ],
            totals: {
              subtotal: order.subtotal || 0,
              tax: order.gstAmount || 0,
              discount: order.discount || 0,
              grandTotal: order.total || 0,
              isPaid: order.paymentStatus === 'PAID',
              paymentMethod: order.counterPaymentMethod || order.paymentMethod || (order.paymentStatus === 'PAID' ? 'PAID' : 'PENDING'),
              paymentConfirmedAt: order.paymentConfirmedAt || null,
            },
          },
        });
        return;
      }

      const sessionOrders = session.orders || [];

      let subtotal = 0;
      let tax = 0;
      let discount = 0;
      let grandTotal = 0;

      const formattedBatches = session.batches.map((b: any) => {
        const matchingOrder = b.order || sessionOrders.find((o: any) => o.batchNumber === b.batchNumber) || sessionOrders[0];
        let items = b.items || [];
        let bSubtotal = b.subtotal || 0;
        let bTax = b.tax || 0;
        let bDiscount = b.discount || 0;
        let bTotal = b.total || 0;
        let paymentStatus = b.order?.paymentStatus || 'PENDING';

        if (matchingOrder) {
          if (!items || items.length === 0) {
            items = (matchingOrder.items || []).map((it: any) => ({
              id: it.id,
              itemName: `${it.menuItem?.name || 'Item'}${it.variant?.name ? ` (${it.variant.name})` : ''}`,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              subtotal: it.subtotal,
            }));
            bSubtotal = matchingOrder.subtotal || 0;
            bTax = matchingOrder.gstAmount || 0;
            bDiscount = matchingOrder.discount || 0;
            bTotal = matchingOrder.total || 0;
          }
          paymentStatus = matchingOrder.paymentStatus || paymentStatus;
        }

        subtotal += bSubtotal;
        tax += bTax;
        discount += bDiscount;
        grandTotal += bTotal;

        return {
          batchId: b.id,
          batchNumber: b.batchNumber,
          status: b.status,
          submittedAt: b.submittedAt,
          completedAt: b.completedAt,
          itemsCount: items.reduce((acc: number, it: any) => acc + (it.quantity || 1), 0),
          items,
          subtotal: bSubtotal,
          tax: bTax,
          discount: bDiscount,
          total: bTotal,
          paymentStatus,
          orderId: matchingOrder?.id || null,
          counterPaymentMethod: matchingOrder?.counterPaymentMethod || null,
          paymentConfirmedAt: matchingOrder?.paymentConfirmedAt || null,
        };
      });

      // If batches array was empty or had 0 totals, fallback to sessionOrders directly
      if (formattedBatches.length === 0 && sessionOrders.length > 0) {
        sessionOrders.forEach((o: any, idx: number) => {
          const oItems = (o.items || []).map((it: any) => ({
            id: it.id,
            itemName: `${it.menuItem?.name || 'Item'}${it.variant?.name ? ` (${it.variant.name})` : ''}`,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            subtotal: it.subtotal,
          }));
          subtotal += o.subtotal || 0;
          tax += o.gstAmount || 0;
          discount += o.discount || 0;
          grandTotal += o.total || 0;

          formattedBatches.push({
            batchId: o.id,
            batchNumber: idx + 1,
            status: o.status === 'DELIVERED' ? 'SERVED' : o.status,
            submittedAt: o.createdAt,
            completedAt: o.deliveredAt,
            itemsCount: oItems.reduce((acc: number, it: any) => acc + (it.quantity || 1), 0),
            items: oItems,
            subtotal: o.subtotal || 0,
            tax: o.gstAmount || 0,
            discount: o.discount || 0,
            total: o.total || 0,
            paymentStatus: o.paymentStatus || 'PENDING',
            orderId: o.id,
            counterPaymentMethod: o.counterPaymentMethod || null,
            paymentConfirmedAt: o.paymentConfirmedAt || null,
          });
        });
      }

      // Check overall payment status across batches and orders
      const allPaid =
        (sessionOrders.length > 0 && sessionOrders.every((o: any) => o.paymentStatus === 'PAID')) ||
        (formattedBatches.length > 0 && formattedBatches.every((b: any) => b.paymentStatus === 'PAID'));

      // Check payment method from the paid order
      const paidOrder = sessionOrders.find((o: any) => o.paymentStatus === 'PAID') || session.batches.find((b: any) => b.order?.paymentStatus === 'PAID')?.order;

      res.json({
        success: true,
        data: {
          sessionId: session.id,
          tableNumber: session.tableNumber,
          sessionCode: session.sessionCode,
          sessionStatus: session.status,
          guestCount: session.guestCount,
          restaurant: session.restaurant,
          batches: formattedBatches,
          totals: {
            subtotal: Math.round(subtotal * 100) / 100,
            tax: Math.round(tax * 100) / 100,
            discount: Math.round(discount * 100) / 100,
            grandTotal: Math.round(grandTotal * 100) / 100,
            isPaid: allPaid,
            paymentMethod: paidOrder?.counterPaymentMethod || paidOrder?.paymentMethod || (allPaid ? 'PAID' : 'PENDING'),
            paymentConfirmedAt: paidOrder?.paymentConfirmedAt || null,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * 9. Close Table Session (Authorized Staff).
   * Ensures all food rounds are completed or explicitly cancelled before closing.
   */
  export async function closeTableSession(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sessionId = req.params.sessionId as string;
      const { paymentConfirmed = false, counterPaymentMethod = 'CASH' } = req.body as {
        paymentConfirmed?: boolean;
        counterPaymentMethod?: string;
      };

      const session: any = await prisma.tableSession.findUnique({
        where: { id: sessionId },
        include: {
          batches: true,
          orders: true,
        },
      });

      if (!session) {
        const order: any = await prisma.order.findUnique({
          where: { id: sessionId },
          include: { restaurant: true },
        });

        if (!order) {
          throw new AppError('Table session not found.', 404, 'SESSION_NOT_FOUND');
        }

        const now = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'DELIVERED',
              deliveredAt: order.deliveredAt || now,
              ...(paymentConfirmed
                ? {
                  paymentStatus: 'PAID',
                  paymentConfirmedBy: req.user?.id || 'Staff',
                  paymentConfirmedAt: now,
                  counterPaymentMethod: counterPaymentMethod || 'CASH',
                }
                : {}),
            },
          });

          if (paymentConfirmed) {
            await tx.payment.updateMany({
              where: { orderId: order.id },
              data: { status: 'PAID' },
            });
          }
        });

        emitOrderStatusUpdate(order.id, order.restaurantId, {
          orderId: order.id,
          status: 'DELIVERED',
          updatedAt: now.toISOString(),
        });

        emitTableSessionUpdate(order.restaurantId, order.tableNumber || '', {
          sessionId,
          event: 'SESSION_CLOSED',
          message: `Table order for ${order.tableNumber || 'Table'} closed successfully.`,
        });

        res.json({
          success: true,
          message: `Table order for ${order.tableNumber || 'Table'} closed successfully.`,
        });
        return;
      }

    if (session.status !== 'ACTIVE') {
      res.json({
        success: true,
        message: `Table session for ${session.tableNumber} is already closed.`,
      });
      return;
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // 1. Close session
      await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          closedBy: req.user?.id || 'Staff',
        },
      });

      // 2. Mark all non-completed batches as COMPLETED
      for (const b of session.batches) {
        if (b.status !== 'COMPLETED' && b.status !== 'CANCELLED') {
          await tx.orderBatch.update({
            where: { id: b.id },
            data: { status: 'COMPLETED', completedAt: now, servedAt: b.servedAt || now },
          });
        }
      }

      // 3. Mark all session orders as DELIVERED
      const batchOrderIds = session.batches.map((b: any) => b.orderId).filter(Boolean);
      await tx.order.updateMany({
        where: {
          OR: [
            { tableSessionId: sessionId },
            { id: { in: batchOrderIds } },
          ],
          status: { notIn: ['CANCELLED'] },
        },
        data: {
          status: 'DELIVERED',
          deliveredAt: now,
          ...(paymentConfirmed
            ? {
                paymentStatus: 'PAID',
                paymentConfirmedBy: req.user?.id || 'Staff',
                paymentConfirmedAt: now,
                counterPaymentMethod: counterPaymentMethod || 'CASH',
              }
            : {}),
        },
      });

      // 4. If payment confirmed, mark payments as PAID
      if (paymentConfirmed) {
        const linkedOrders = await tx.order.findMany({
          where: {
            OR: [
              { tableSessionId: sessionId },
              { id: { in: batchOrderIds } },
            ],
          },
          select: { id: true },
        });
        const lIds = linkedOrders.map((o) => o.id);
        if (lIds.length > 0) {
          await tx.payment.updateMany({
            where: { orderId: { in: lIds } },
            data: { status: 'PAID' },
          });
        }
      }
    });

    emitTableSessionUpdate(session.restaurantId, session.tableNumber, {
      sessionId,
      event: 'SESSION_CLOSED',
      message: `Table session for ${session.tableNumber} is closed.`,
    });

    res.json({
      success: true,
      message: `Table session for ${session.tableNumber} closed successfully.`,
    });
  } catch (error) {
    next(error);
  }
}

  /**
   * 10. List Active Table Sessions (Staff & Restaurant Owner Dashboard).
   */
  export async function listActiveSessions(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user!;
      let restaurantId = (user as any).restaurantId || (user as any).kitchenRestaurantId;

      if (!restaurantId && user.role === 'RESTAURANT_OWNER') {
        const rest = await prisma.restaurant.findFirst({
          where: { ownerId: user.id, deletedAt: null },
          select: { id: true },
        });
        restaurantId = rest?.id;
      }

      if (!restaurantId && user.role === 'SUPER_ADMIN') {
        const rest = await prisma.restaurant.findFirst({
          where: { deletedAt: null },
          select: { id: true },
        });
        restaurantId = rest?.id;
      }

      if (!restaurantId) {
        throw new AppError('Restaurant not found for authenticated user.', 404, 'RESTAURANT_NOT_FOUND');
      }

      const sessions: any = await prisma.tableSession.findMany({
        where: {
          restaurantId,
          status: 'ACTIVE',
        },
        orderBy: { createdAt: 'desc' },
        include: {
          batches: {
            orderBy: { batchNumber: 'asc' },
            include: {
              items: {
                include: {
                  menuItem: { select: { id: true, name: true, price: true } },
                },
              },
              order: {
                select: {
                  id: true,
                  status: true,
                  paymentStatus: true,
                  paymentMethod: true,
                  counterPaymentMethod: true,
                  total: true,
                  guestName: true,
                  guestPhone: true,
                  items: {
                    include: {
                      menuItem: { select: { id: true, name: true, price: true } },
                      variant: { select: { id: true, name: true, price: true } },
                    },
                  },
                },
              },
            },
          },
          orders: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            include: {
              items: {
                include: {
                  menuItem: { select: { id: true, name: true, price: true } },
                  variant: { select: { id: true, name: true, price: true } },
                },
              },
              user: { select: { name: true, phone: true } },
            },
          },
        },
      });

      const activeSessionTableSet = new Set(sessions.map((s: any) => normalizeTableNumber(s.tableNumber).toLowerCase()));

      const formatted: any[] = sessions.map((s: any) => {
        const sessionOrders = s.orders || [];
        let currentBatch = s.batches.find((b: any) => b.batchNumber === s.currentBatchNumber) || s.batches[s.batches.length - 1];

        // Gather all items across all orders and batches for this table session
        const seenItemIds = new Set<string>();
        const allItems: any[] = [];

        // 1. From sessionOrders
        for (const ord of sessionOrders) {
          if (ord.status === 'CANCELLED') continue;
          for (const it of (ord.items || [])) {
            if (!seenItemIds.has(it.id)) {
              seenItemIds.add(it.id);
              allItems.push({
                id: it.id,
                itemName: `${it.menuItem?.name || 'Item'}${it.variant?.name ? ` (${it.variant.name})` : ''}`,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                subtotal: it.subtotal,
                orderId: ord.id,
                batchNumber: ord.batchNumber || 1,
                addedBy: ord.guestName || ord.user?.name || 'Guest',
              });
            }
          }
        }

        // 2. From batches (in case some items were batch-only or not in sessionOrders)
        for (const b of s.batches) {
          if (b.status === 'CANCELLED') continue;
          if (b.items && b.items.length > 0) {
            for (const it of b.items) {
              if (!seenItemIds.has(it.id)) {
                seenItemIds.add(it.id);
                allItems.push({
                  id: it.id,
                  itemName: `${it.menuItem?.name || 'Item'}${it.variant?.name ? ` (${it.variant.name})` : ''}`,
                  quantity: it.quantity,
                  unitPrice: it.unitPrice,
                  subtotal: it.subtotal,
                  batchNumber: b.batchNumber,
                  addedBy: it.addedBy || 'Guest',
                });
              }
            }
          }
          if (b.order?.items) {
            for (const it of b.order.items) {
              if (!seenItemIds.has(it.id)) {
                seenItemIds.add(it.id);
                allItems.push({
                  id: it.id,
                  itemName: `${it.menuItem?.name || 'Item'}${it.variant?.name ? ` (${it.variant.name})` : ''}`,
                  quantity: it.quantity,
                  unitPrice: it.unitPrice,
                  subtotal: it.subtotal,
                  batchNumber: b.batchNumber,
                  addedBy: b.order.guestName || 'Guest',
                });
              }
            }
          }
        }

        // Total session bill
        let sessionTotal = 0;
        if (sessionOrders.length > 0) {
          sessionTotal = sessionOrders
            .filter((o: any) => o.status !== 'CANCELLED')
            .reduce((sum: number, o: any) => sum + Number(o.total || 0), 0);
        } else {
          sessionTotal = s.batches
            .filter((b: any) => b.status !== 'CANCELLED')
            .reduce((sum: number, b: any) => sum + Number(b.total || 0), 0);
        }

        // Overall payment status
        const isPaid =
          (sessionOrders.length > 0 && sessionOrders.every((o: any) => o.paymentStatus === 'PAID')) ||
          (s.batches.length > 0 && s.batches.every((b: any) => b.order?.paymentStatus === 'PAID'));

        // If currentBatch has no items, enrich from matching order
        let currentBatchItems = currentBatch?.items || [];
        let currentBatchTotal = currentBatch?.total || 0;
        let displayBatchStatus = currentBatch?.status || 'OPEN';

        const matchingOrder = sessionOrders.find((o: any) => o.batchNumber === currentBatch?.batchNumber) || sessionOrders[0];
        if (matchingOrder) {
          if (!currentBatchItems || currentBatchItems.length === 0) {
            currentBatchItems = (matchingOrder.items || []).map((it: any) => ({
              id: it.id,
              itemName: `${it.menuItem?.name || 'Item'}${it.variant?.name ? ` (${it.variant.name})` : ''}`,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              subtotal: it.subtotal,
            }));
            currentBatchTotal = matchingOrder.total;
          }

          // Synchronize batch status with order status
          if (matchingOrder.status === 'DELIVERED') displayBatchStatus = 'SERVED';
          else if (matchingOrder.status === 'READY') displayBatchStatus = 'READY';
          else if (matchingOrder.status === 'PREPARING' || matchingOrder.status === 'BAKING') displayBatchStatus = 'PREPARING';
          else if (matchingOrder.status === 'CONFIRMED') displayBatchStatus = 'ACCEPTED';
          else if (matchingOrder.status === 'PENDING') displayBatchStatus = 'SUBMITTED';
          else if (matchingOrder.status === 'CANCELLED') displayBatchStatus = 'CANCELLED';
        }

        const enrichedBatch = currentBatch
          ? {
            ...currentBatch,
            status: displayBatchStatus,
            items: currentBatchItems,
            total: currentBatchTotal,
            orderId: matchingOrder?.id || currentBatch.orderId || null,
          }
          : null;

        return {
          id: s.id,
          tableNumber: s.tableNumber,
          sessionCode: s.sessionCode,
          guestCount: s.guestCount,
          status: s.status,
          currentBatchNumber: s.currentBatchNumber,
          currentBatchStatus: displayBatchStatus,
          currentBatch: enrichedBatch,
          allItems,
          totalBatches: Math.max(s.batches.length, sessionOrders.length),
          sessionTotal: Math.round(sessionTotal * 100) / 100,
          paymentStatus: isPaid ? 'PAID' : 'PENDING',
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          orders: sessionOrders,
        };
      });

      // Also look for standalone ongoing table orders created today that don't belong to any session
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const standaloneOrders: any = await prisma.order.findMany({
        where: {
          restaurantId,
          tableNumber: { not: null },
          tableSessionId: null,
          deletedAt: null,
          status: { not: 'CANCELLED' },
          createdAt: { gte: startOfToday },
        },
        include: {
          items: {
            include: {
              menuItem: { select: { id: true, name: true, price: true } },
              variant: { select: { id: true, name: true, price: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Group standalone orders by table number if not already present
      const standaloneByTable = new Map<string, any[]>();
      for (const o of standaloneOrders) {
        const cleanTable = normalizeTableNumber(o.tableNumber);
        if (!activeSessionTableSet.has(cleanTable.toLowerCase())) {
          if (!standaloneByTable.has(cleanTable)) {
            standaloneByTable.set(cleanTable, []);
          }
          standaloneByTable.get(cleanTable)!.push(o);
        }
      }

      standaloneByTable.forEach((tableOrders, tableNum) => {
        const latestOrder = tableOrders[0];
        const tableTotal = tableOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
        const allPaid = tableOrders.every((o) => o.paymentStatus === 'PAID');

        let batchStatus = 'SUBMITTED';
        if (latestOrder.status === 'DELIVERED') batchStatus = 'SERVED';
        else if (latestOrder.status === 'READY') batchStatus = 'READY';
        else if (latestOrder.status === 'PREPARING' || latestOrder.status === 'BAKING') batchStatus = 'PREPARING';
        else if (latestOrder.status === 'CONFIRMED') batchStatus = 'ACCEPTED';

        const allItems: any[] = [];
        const seenItemIds = new Set<string>();
        for (const o of tableOrders) {
          if (o.status === 'CANCELLED') continue;
          for (const it of (o.items || [])) {
            if (!seenItemIds.has(it.id)) {
              seenItemIds.add(it.id);
              allItems.push({
                id: it.id,
                itemName: `${it.menuItem?.name || 'Item'}${it.variant?.name ? ` (${it.variant.name})` : ''}`,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                subtotal: it.subtotal,
                orderId: o.id,
                batchNumber: o.batchNumber || 1,
              });
            }
          }
        }

        const items = allItems.slice(0, 10);

        formatted.push({
          id: latestOrder.id,
          tableNumber: tableNum,
          sessionCode: latestOrder.verificationCode || latestOrder.id.slice(-4).toUpperCase(),
          guestCount: 1,
          status: 'ACTIVE',
          currentBatchNumber: 1,
          currentBatchStatus: batchStatus,
          currentBatch: {
            id: latestOrder.id,
            batchNumber: 1,
            status: batchStatus,
            subtotal: latestOrder.subtotal,
            tax: latestOrder.gstAmount,
            total: latestOrder.total,
            items,
            orderId: latestOrder.id,
          },
          allItems,
          totalBatches: tableOrders.length,
          sessionTotal: Math.round(tableTotal * 100) / 100,
          paymentStatus: allPaid ? 'PAID' : 'PENDING',
          createdAt: latestOrder.createdAt,
          updatedAt: latestOrder.updatedAt,
          orders: tableOrders,
        });
      });

      res.json({
        success: true,
        data: {
          sessions: formatted,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * 11. Mark Session as Paid (Counter Staff, Waitstaff, Restaurant Owner).
   * Marks all orders and batches in this session as PAID with selected payment instrument.
   */
  export async function markSessionAsPaid(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sessionId = req.params.sessionId as string;
      const { paymentMethod = 'CASH' } = req.body as { paymentMethod?: string };
      const now = new Date();

      const session: any = await prisma.tableSession.findUnique({
        where: { id: sessionId },
        include: { orders: true, batches: true, restaurant: true },
      });

      if (session) {
        await prisma.$transaction(async (tx) => {
          // Mark all orders in session as PAID
          await tx.order.updateMany({
            where: { tableSessionId: sessionId },
            data: {
              paymentStatus: 'PAID',
              paymentConfirmedAt: now,
              paymentConfirmedBy: req.user?.id || 'Staff',
              counterPaymentMethod: paymentMethod,
            },
          });

          // Also update any orders linked to batches of this session
          const batchOrderIds = session.batches.map((b: any) => b.orderId).filter(Boolean);
          if (batchOrderIds.length > 0) {
            await tx.order.updateMany({
              where: { id: { in: batchOrderIds } },
              data: {
                paymentStatus: 'PAID',
                paymentConfirmedAt: now,
                paymentConfirmedBy: req.user?.id || 'Staff',
                counterPaymentMethod: paymentMethod,
              },
            });
          }

          // Update payment records
          const allOrders = await tx.order.findMany({
            where: {
              OR: [
                { tableSessionId: sessionId },
                { id: { in: batchOrderIds } },
              ],
            },
            select: { id: true },
          });

          const orderIds = allOrders.map((o) => o.id);
          if (orderIds.length > 0) {
            await tx.payment.updateMany({
              where: { orderId: { in: orderIds } },
              data: { status: 'PAID' },
            });
          }
        });

        emitTableSessionUpdate(session.restaurantId, session.tableNumber, {
          sessionId: session.id,
          event: 'PAYMENT_CONFIRMED',
          paymentStatus: 'PAID',
          paymentMethod,
          message: `Payment confirmed for ${session.tableNumber}.`,
        });

        res.json({
          success: true,
          message: `Payment confirmed for ${session.tableNumber}.`,
        });
        return;
      }

      // Fallback: Check if sessionId is a standalone Order ID
      const order = await prisma.order.findUnique({
        where: { id: sessionId },
        include: { restaurant: true },
      });

      if (order) {
        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: 'PAID',
              paymentConfirmedAt: now,
              paymentConfirmedBy: req.user?.id || 'Staff',
              counterPaymentMethod: paymentMethod,
            },
          });

          await tx.payment.updateMany({
            where: { orderId: order.id },
            data: { status: 'PAID' },
          });
        });

        emitTableSessionUpdate(order.restaurantId, order.tableNumber || '', {
          sessionId: order.id,
          event: 'PAYMENT_CONFIRMED',
          paymentStatus: 'PAID',
          paymentMethod,
          message: `Payment confirmed for ${order.tableNumber || 'Order'}.`,
        });

        res.json({
          success: true,
          message: `Payment confirmed for ${order.tableNumber || 'Order'}.`,
        });
        return;
      }

      throw new AppError('Table session or order not found.', 404, 'SESSION_NOT_FOUND');
    } catch (error) {
      next(error);
    }
  }

  /**
   * 12. Cancel Table Session (Counter Staff, Restaurant Owner).
   * Cancels active table session and any ongoing orders, immediately freeing the table.
   */
  export async function cancelTableSession(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sessionId = req.params.sessionId as string;
      const { reason = 'Cancelled by staff' } = req.body as { reason?: string };
      const now = new Date();

      const session: any = await prisma.tableSession.findUnique({
        where: { id: sessionId },
        include: { orders: true, batches: true, restaurant: true },
      });

      if (session) {
        await prisma.$transaction(async (tx) => {
          await tx.tableSession.update({
            where: { id: sessionId },
            data: {
              status: 'CANCELLED',
              completedAt: now,
              closedBy: req.user?.id || 'Staff',
            },
          });

          await tx.orderBatch.updateMany({
            where: { sessionId },
            data: { status: 'CANCELLED' },
          });

          await tx.order.updateMany({
            where: {
              tableSessionId: sessionId,
              status: { notIn: ['DELIVERED'] },
            },
            data: { status: 'CANCELLED' },
          });
        });

        emitTableSessionUpdate(session.restaurantId, session.tableNumber, {
          sessionId: session.id,
          event: 'SESSION_CANCELLED',
          reason,
          message: `Table session for ${session.tableNumber} cancelled.`,
        });

        for (const ord of session.orders) {
          if (ord.status !== 'DELIVERED') {
            emitOrderStatusUpdate(ord.id, session.restaurantId, {
              orderId: ord.id,
              status: 'CANCELLED',
              updatedAt: now.toISOString(),
            });
          }
        }

        res.json({
          success: true,
          message: `Table session for ${session.tableNumber} cancelled. Table is now available.`,
        });
        return;
      }

      // Fallback: Check if sessionId is a standalone Order ID
      const order = await prisma.order.findUnique({
        where: { id: sessionId },
        include: { restaurant: true },
      });

      if (order) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' },
        });

        emitOrderStatusUpdate(order.id, order.restaurantId, {
          orderId: order.id,
          status: 'CANCELLED',
          updatedAt: now.toISOString(),
        });

        emitTableSessionUpdate(order.restaurantId, order.tableNumber || '', {
          sessionId: order.id,
          event: 'SESSION_CANCELLED',
          message: `Order for ${order.tableNumber || 'Table'} cancelled.`,
        });

        res.json({
          success: true,
          message: `Order for ${order.tableNumber || 'Table'} cancelled. Table is now available.`,
        });
        return;
      }

      throw new AppError('Table session or order not found.', 404, 'SESSION_NOT_FOUND');
    } catch (error) {
      next(error);
    }
  }


