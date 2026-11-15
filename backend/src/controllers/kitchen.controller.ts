import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { emitOrderStatusUpdate, emitTableSessionUpdate } from '../services/socket.service';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

async function getTargetRestaurantId(req: AuthenticatedRequest): Promise<string> {
  const user = req.user!;
  if (user.role === 'KITCHEN') {
    if (!user.kitchenRestaurantId) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { kitchenRestaurantId: true },
      });
      if (!dbUser?.kitchenRestaurantId) {
        throw new AppError('Kitchen account is not assigned to any restaurant.', 403, 'KITCHEN_NOT_ASSIGNED');
      }
      return dbUser.kitchenRestaurantId;
    }
    return user.kitchenRestaurantId;
  }

  // Restaurant Owner or Super Admin fallback
  const rest = await prisma.restaurant.findFirst({
    where: { ownerId: user.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!rest) {
    throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
  }
  return rest.id;
}

export async function getKitchenOrders(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurantId = await getTargetRestaurantId(req);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        deletedAt: null,
        OR: [
          { status: { in: ['CONFIRMED', 'PREPARING', 'BAKING', 'READY'] } },
          { status: 'DELIVERED', createdAt: { gte: startOfToday } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            addOns: true,
            isAddon: true,
            createdAt: true,
            menuItem: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
        user: {
          select: {
            name: true,
            phone: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: { orders, restaurantId },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateKitchenOrderStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurantId = await getTargetRestaurantId(req);
    const id = req.params.id as string;
    const { status } = req.body as { status?: string };

    const allowedStatuses = ['PREPARING', 'BAKING', 'READY', 'DELIVERED', 'CANCELLED'];
    if (!status || !allowedStatuses.includes(status)) {
      throw new AppError(`Invalid status. Allowed values: ${allowedStatuses.join(', ')}`, 400, 'INVALID_STATUS');
    }

    const order = await prisma.order.findFirst({
      where: { id, restaurantId, deletedAt: null },
    });

    if (!order) {
      throw new AppError('Order not found or does not belong to this restaurant.', 404, 'ORDER_NOT_FOUND');
    }

    const statusDateFields: Record<string, string> = {
      CONFIRMED: 'confirmedAt',
      PREPARING: 'preparingAt',
      BAKING: 'preparingAt',
      READY: 'readyAt',
      DELIVERED: 'deliveredAt',
      CANCELLED: 'cancelledAt',
    };

    const updateData: Record<string, any> = {
      status,
      ...(status === 'DELIVERED' && { paymentStatus: 'PAID' }),
    };
    if (statusDateFields[status]) {
      updateData[statusDateFields[status]] = new Date();
    }

    const updated = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        user: { select: { name: true, phone: true } },
      },
    });

    // Real-time socket broadcast
    try {
      emitOrderStatusUpdate(updated.id, updated.restaurantId, {
        orderId: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt.toISOString(),
      });

      // Synchronize linked TableSession and OrderBatch
      if (updated.tableSessionId) {
        let batchStatus: any = undefined;
        const now = new Date();
        const batchTimestampUpdates: Record<string, any> = {};

        if (status === 'PREPARING' || status === 'BAKING') {
          batchStatus = 'PREPARING';
          batchTimestampUpdates.preparingAt = now;
        } else if (status === 'READY') {
          batchStatus = 'READY';
          batchTimestampUpdates.readyAt = now;
        } else if (status === 'DELIVERED') {
          batchStatus = 'SERVED';
          batchTimestampUpdates.servedAt = now;
        } else if (status === 'CANCELLED') {
          batchStatus = 'CANCELLED';
        }

        if (batchStatus) {
          await prisma.orderBatch.updateMany({
            where: {
              OR: [
                { orderId: updated.id },
                { sessionId: updated.tableSessionId, batchNumber: updated.batchNumber || 1 },
              ],
            },
            data: {
              status: batchStatus,
              ...batchTimestampUpdates,
            },
          });
        }

        if (updated.tableNumber) {
          emitTableSessionUpdate(restaurantId, updated.tableNumber, {
            sessionId: updated.tableSessionId,
            orderId: updated.id,
            orderStatus: updated.status,
            batchStatus,
            paymentStatus: updated.paymentStatus,
            event: 'ORDER_STATUS_SYNCED',
          });
        }
      }
    } catch (err) {
      logger.warn('Failed to emit socket updates for kitchen order status update:', err);
    }

    res.json({
      success: true,
      data: { order: updated },
      message: `Order status updated to ${status}`,
    });
  } catch (error) {
    next(error);
  }
}
