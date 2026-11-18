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
            isServed: true,
            servedAt: true,
            createdAt: true,
            menuItem: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
            variant: {
              select: {
                id: true,
                name: true,
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

    // Maintain a fair queue:
    // Active orders are sorted by their queue entry time ascending (FIFO).
    // An add-on joins the queue based on lastAddOnAt and does not jump to the front.
    // Delivered orders are listed most recently served first.
    const activeOrders = orders
      .filter((o) => o.status !== 'DELIVERED')
      .sort((a, b) => {
        const timeA = new Date(a.lastAddOnAt || a.createdAt).getTime();
        const timeB = new Date(b.lastAddOnAt || b.createdAt).getTime();
        return timeA - timeB;
      });

    const deliveredOrders = orders
      .filter((o) => o.status === 'DELIVERED')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const sortedOrders = [...activeOrders, ...deliveredOrders];

    res.json({
      success: true,
      data: { orders: sortedOrders, restaurantId },
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
    const { status, addOnStatus } = req.body as { status?: string; addOnStatus?: string };

    const allowedStatuses = ['PREPARING', 'BAKING', 'READY', 'DELIVERED', 'CANCELLED'];
    const allowedAddonStatuses = ['PREPARING', 'BAKING', 'READY', 'DELIVERED', 'CANCELLED', 'NONE'];

    if (!status && !addOnStatus) {
      throw new AppError('Either status or addOnStatus is required.', 400, 'STATUS_REQUIRED');
    }

    if (status && !allowedStatuses.includes(status)) {
      throw new AppError(`Invalid status. Allowed values: ${allowedStatuses.join(', ')}`, 400, 'INVALID_STATUS');
    }

    if (addOnStatus && !allowedAddonStatuses.includes(addOnStatus)) {
      throw new AppError(`Invalid addOnStatus. Allowed values: ${allowedAddonStatuses.join(', ')}`, 400, 'INVALID_ADDON_STATUS');
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

    const updateData: Record<string, any> = {};

    if (status) {
      updateData.status = status;
      if (status === 'DELIVERED') {
        // Food is served. Do NOT mark payment as PAID — serving food and receiving payment
        // are separate events. Payment must be manually confirmed at counter or via payment gateway.
        updateData.addOnStatus = null;
        await prisma.orderItem.updateMany({
          where: { orderId: id },
          data: { isServed: true, servedAt: new Date() },
        });
      } else if (status === 'READY') {
        if (order.addOnStatus) updateData.addOnStatus = 'READY';
      } else if (status === 'PREPARING' || status === 'BAKING') {
        if (order.addOnStatus) updateData.addOnStatus = 'PREPARING';
      }
      if (statusDateFields[status]) {
        updateData[statusDateFields[status]] = new Date();
      }
    }

    if (addOnStatus !== undefined) {
      updateData.addOnStatus = addOnStatus === 'NONE' || addOnStatus === 'DELIVERED' ? null : addOnStatus;
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
        addOnStatus: updated.addOnStatus,
        paymentStatus: updated.paymentStatus,
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

export async function toggleKitchenOrderItemServed(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurantId = await getTargetRestaurantId(req);
    const { orderId, itemId } = req.params as { orderId: string; itemId: string };
    const { isServed } = req.body as { isServed?: boolean };

    const order = await prisma.order.findFirst({
      where: { id: orderId, restaurantId, deletedAt: null },
      include: {
        items: true,
      },
    });

    if (!order) {
      throw new AppError('Order not found or does not belong to this restaurant.', 404, 'ORDER_NOT_FOUND');
    }

    const targetItem = order.items.find((item) => item.id === itemId);
    if (!targetItem) {
      throw new AppError('Order item not found in this order.', 404, 'ITEM_NOT_FOUND');
    }

    const nextServedStatus = typeof isServed === 'boolean' ? isServed : !targetItem.isServed;

    // Update target item
    const updatedItem = await prisma.orderItem.update({
      where: { id: itemId },
      data: {
        isServed: nextServedStatus,
        servedAt: nextServedStatus ? new Date() : null,
      },
    });

    // Check all items of this order
    const allItems = await prisma.orderItem.findMany({
      where: { orderId: order.id },
      include: {
        menuItem: { select: { id: true, name: true, image: true } },
        variant: { select: { name: true } },
      },
    });

    const allServed = allItems.length > 0 && allItems.every((i) => i.isServed);
    const anyServed = allItems.some((i) => i.isServed);

    const updateOrderData: Record<string, any> = {};

    if (allServed) {
      updateOrderData.status = 'DELIVERED';
      updateOrderData.deliveredAt = new Date();
      updateOrderData.addOnStatus = null;
    } else {
      // If some items are served or none, but the order was already DELIVERED or READY, revert to PREPARING
      // so chef continues cooking the remaining items!
      if (order.status === 'DELIVERED' || order.status === 'READY') {
        updateOrderData.status = 'PREPARING';
        updateOrderData.preparingAt = order.preparingAt || new Date();
      } else if (order.status === 'CONFIRMED' && anyServed) {
        updateOrderData.status = 'PREPARING';
        updateOrderData.preparingAt = order.preparingAt || new Date();
      }
    }

    let updatedOrder = order;
    if (Object.keys(updateOrderData).length > 0) {
      updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: updateOrderData,
        include: {
          items: true,
        },
      });
    }

    // Socket broadcasts
    try {
      emitOrderStatusUpdate(order.id, restaurantId, {
        orderId: order.id,
        status: updatedOrder.status,
        addOnStatus: updatedOrder.addOnStatus,
        paymentStatus: updatedOrder.paymentStatus,
        updatedAt: updatedOrder.updatedAt.toISOString(),
        items: allItems,
        toggledItemId: itemId,
        isServed: nextServedStatus,
      });

      // Synchronize linked TableSession and OrderBatch
      if (order.tableSessionId) {
        const batchStatus = allServed ? 'SERVED' : 'PREPARING';
        await prisma.orderBatch.updateMany({
          where: {
            OR: [
              { orderId: order.id },
              { sessionId: order.tableSessionId, batchNumber: order.batchNumber || 1 },
            ],
          },
          data: {
            status: batchStatus,
            ...(allServed ? { servedAt: new Date() } : { preparingAt: new Date() }),
          },
        });

        if (order.tableNumber) {
          emitTableSessionUpdate(restaurantId, order.tableNumber, {
            sessionId: order.tableSessionId,
            orderId: order.id,
            orderStatus: updatedOrder.status,
            batchStatus,
            paymentStatus: order.paymentStatus,
            event: 'ORDER_ITEM_SERVED_UPDATED',
          });
        }
      }
    } catch (err) {
      logger.warn('Failed to emit socket updates for kitchen order item served update:', err);
    }

    res.json({
      success: true,
      data: {
        order: {
          ...updatedOrder,
          items: allItems,
        },
        toggledItem: updatedItem,
        allServed,
      },
    });
  } catch (error) {
    next(error);
  }
}
