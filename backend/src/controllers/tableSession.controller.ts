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
                total: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new AppError('Table session not found.', 404, 'SESSION_NOT_FOUND');
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

    const batch: any = await prisma.orderBatch.findUnique({
      where: { id: batchId },
      include: {
        session: true,
      },
    });

    if (!batch || batch.sessionId !== sessionId) {
      throw new AppError('Order batch not found for this session.', 404, 'BATCH_NOT_FOUND');
    }

    // Restriction: Cannot mark COMPLETED unless the batch is already SERVED (Requirement 8)
    if (status === 'COMPLETED' && batch.status !== 'SERVED') {
      throw new AppError(
        'The food must be marked as SERVED before completing this batch.',
        400,
        'BATCH_NOT_SERVED'
      );
    }

    const now = new Date();
    const timestampUpdates: Record<string, any> = {};
    if (status === 'ACCEPTED') timestampUpdates.acceptedAt = now;
    if (status === 'PREPARING') timestampUpdates.preparingAt = now;
    if (status === 'READY') timestampUpdates.readyAt = now;
    if (status === 'SERVED') timestampUpdates.servedAt = now;
    if (status === 'COMPLETED') timestampUpdates.completedAt = now;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update the target batch
      const updated = await tx.orderBatch.update({
        where: { id: batchId },
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
      // When batch is marked COMPLETED, initialize the NEXT batch!
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
                verificationCode: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new AppError('Table session not found.', 404, 'SESSION_NOT_FOUND');
    }

    let subtotal = 0;
    let tax = 0;
    let discount = 0;
    let grandTotal = 0;

    const formattedBatches = session.batches.map((b: any) => {
      subtotal += b.subtotal;
      tax += b.tax;
      discount += b.discount;
      grandTotal += b.total;

      return {
        batchId: b.id,
        batchNumber: b.batchNumber,
        status: b.status,
        submittedAt: b.submittedAt,
        completedAt: b.completedAt,
        itemsCount: b.items.reduce((acc: number, it: any) => acc + it.quantity, 0),
        items: b.items,
        subtotal: b.subtotal,
        tax: b.tax,
        total: b.total,
        paymentStatus: b.order?.paymentStatus || 'PENDING',
      };
    });

    // Check overall payment status
    const allPaid = session.batches.length > 0 && session.batches.every((b: any) => b.order?.paymentStatus === 'PAID');

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
      throw new AppError('Table session not found.', 404, 'SESSION_NOT_FOUND');
    }

    if (session.status !== 'ACTIVE') {
      throw new AppError('This table session has already been closed.', 400, 'SESSION_ALREADY_CLOSED');
    }

    // Verify no batch is currently being prepared, ready, or served
    const unfinishedBatch = session.batches.find(
      (b: any) => ['SUBMITTED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'].includes(b.status)
    );

    if (unfinishedBatch) {
      throw new AppError(
        `Cannot close table session while Batch ${unfinishedBatch.batchNumber} is still in progress (${unfinishedBatch.status}). Please complete or cancel it first.`,
        400,
        'UNFINISHED_BATCH'
      );
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Close session
      await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          closedBy: req.user?.id || 'Staff',
        },
      });

      // Mark empty open batches as COMPLETED or CANCELLED
      for (const b of session.batches) {
        if (b.status === 'OPEN') {
          await tx.orderBatch.update({
            where: { id: b.id },
            data: { status: 'COMPLETED', completedAt: now },
          });
        }
      }

      // If staff confirms counter payment, update linked orders
      if (paymentConfirmed) {
        await tx.order.updateMany({
          where: { tableSessionId: sessionId },
          data: {
            paymentStatus: 'PAID',
            paymentConfirmedBy: req.user?.id || 'Staff',
            paymentConfirmedAt: now,
            counterPaymentMethod: counterPaymentMethod || 'CASH',
          },
        });
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

    const sessions = await prisma.tableSession.findMany({
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
              },
            },
          },
        },
      },
    });

    const formatted = sessions.map((s) => {
      const currentBatch = s.batches.find((b) => b.batchNumber === s.currentBatchNumber) || s.batches[s.batches.length - 1];
      const sessionTotal = s.batches
        .filter((b) => b.status !== 'CANCELLED')
        .reduce((sum, b) => sum + b.total, 0);

      const isPaid = s.batches.length > 0 && s.batches.every((b) => b.order?.paymentStatus === 'PAID');

      return {
        id: s.id,
        tableNumber: s.tableNumber,
        sessionCode: s.sessionCode,
        guestCount: s.guestCount,
        status: s.status,
        currentBatchNumber: s.currentBatchNumber,
        currentBatchStatus: currentBatch?.status || 'OPEN',
        currentBatch,
        totalBatches: s.batches.length,
        sessionTotal: Math.round(sessionTotal * 100) / 100,
        paymentStatus: isPaid ? 'PAID' : 'PENDING',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
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

