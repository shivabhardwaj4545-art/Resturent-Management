import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { emitOrderStatusUpdate, emitNotification, emitUserLoyaltyUpdate } from '../services/socket.service';

/**
 * Helper to resolve the authenticated restaurant owner or staff's restaurant.
 * Guarantees strict multi-restaurant isolation: queries are ALWAYS scoped to this restaurant ID.
 */
async function getStaffOrOwnerRestaurant(user: { id: string; role: string; kitchenRestaurantId?: string | null }) {
  if (user.role === 'RESTAURANT_OWNER') {
    let restaurant = await prisma.restaurant.findFirst({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!restaurant) {
      restaurant = await prisma.restaurant.findFirst({
        where: { ownerId: user.id },
        orderBy: { createdAt: 'asc' },
      });
    }
    if (!restaurant) throw new AppError('Restaurant not found for this owner.', 404, 'RESTAURANT_NOT_FOUND');
    return restaurant;
  }

  if (user.kitchenRestaurantId) {
    const restaurant = await prisma.restaurant.findFirst({
      where: { id: user.kitchenRestaurantId, deletedAt: null },
    });
    if (!restaurant) throw new AppError('Assigned restaurant not found for this staff member.', 404, 'RESTAURANT_NOT_FOUND');
    return restaurant;
  }

  if (user.role === 'SUPER_ADMIN') {
    const restaurant = await prisma.restaurant.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!restaurant) throw new AppError('No restaurant found in system.', 404, 'RESTAURANT_NOT_FOUND');
    return restaurant;
  }

  throw new AppError('Access denied: Staff or owner privileges required.', 403, 'INSUFFICIENT_ROLE');
}

/**
 * 1. Search/Lookup order by 4-digit verification code.
 * Strict multi-restaurant isolation: Restaurant A can only find Restaurant A's orders.
 */
export async function lookupOrderByVerificationCode(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Authentication required.', 401, 'NOT_AUTHENTICATED');
    }

    const restaurant = await getStaffOrOwnerRestaurant(req.user);
    const code = (req.body?.code || req.query?.code || req.params?.code)?.toString().trim();

    if (!code || !/^\d{4}$/.test(code)) {
      throw new AppError('Please enter a valid 4-digit numeric verification code.', 400, 'INVALID_VERIFICATION_CODE');
    }

    // Lookup order strictly within this restaurant
    const order = await prisma.order.findFirst({
      where: {
        restaurantId: restaurant.id,
        verificationCode: code,
        deletedAt: null,
      },
      include: {
        items: {
          include: {
            menuItem: { select: { id: true, name: true, image: true, price: true } },
            variant: { select: { id: true, name: true, price: true } },
          },
        },
        user: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!order) {
      throw new AppError(
        `No order found with verification code #${code} for ${restaurant.name}. Please verify the code with the customer.`,
        404,
        'ORDER_NOT_FOUND'
      );
    }

    res.json({
      success: true,
      data: {
        order: {
          id: order.id,
          orderNumber: order.id.slice(-8).toUpperCase(),
          verificationCode: order.verificationCode,
          restaurantId: order.restaurantId,
          restaurantName: restaurant.name,
          customerName: order.user?.name || order.guestName || 'Guest Customer',
          customerPhone: order.user?.phone || order.guestPhone || null,
          tableNumber: order.tableNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          counterPaymentMethod: order.counterPaymentMethod,
          paymentConfirmedBy: order.paymentConfirmedBy,
          paymentConfirmedAt: order.paymentConfirmedAt,
          subtotal: order.subtotal,
          gstAmount: order.gstAmount,
          deliveryFee: order.deliveryFee,
          packagingFee: order.packagingFee,
          discount: order.discount,
          total: order.total,
          createdAt: order.createdAt,
          items: order.items.map((item) => ({
            id: item.id,
            name: item.menuItem?.name || 'Item',
            image: item.menuItem?.image || null,
            variantName: item.variant?.name || null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            addOns: item.addOns,
          })),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 2. Manual Payment Confirmation at the Counter.
 * Marks the payment as PAID only after staff confirmation.
 * Atomic update, prevents duplicates, emits real-time updates.
 */
export async function confirmCounterPayment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Authentication required.', 401, 'NOT_AUTHENTICATED');
    }

    const restaurant = await getStaffOrOwnerRestaurant(req.user);
    const orderId = (req.body?.orderId || req.params?.orderId)?.toString().trim();
    const rawInstrument = (req.body?.instrument || 'CASH').toString().toUpperCase().trim();
    const instrument = ['CASH', 'COUNTER_UPI', 'CARD'].includes(rawInstrument) ? rawInstrument : 'CASH';

    if (!orderId) {
      throw new AppError('Order ID is required.', 400, 'ORDER_ID_REQUIRED');
    }

    // Scoped strictly to this restaurant
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId: restaurant.id,
        deletedAt: null,
      },
    });

    if (!order) {
      throw new AppError('Order not found or does not belong to your restaurant.', 404, 'ORDER_NOT_FOUND');
    }

    if (order.status === 'CANCELLED') {
      throw new AppError('Cannot confirm payment for a cancelled order.', 400, 'ORDER_CANCELLED');
    }

    if (order.paymentStatus === 'PAID') {
      throw new AppError('Payment has already been confirmed and marked as PAID.', 400, 'ALREADY_PAID');
    }

    // Check loyalty settings
    const loyaltySetting = await prisma.systemSetting.findUnique({
      where: { key: 'loyalty_settings' },
    });
    const loyaltyVal = (loyaltySetting?.value as Record<string, any>) ?? {};
    const loyaltyEnabled = loyaltyVal.enabled !== false;
    const pointsPerSpendRupees = Number(loyaltyVal.pointsPerSpendRupees) || 10;
    const pointsEarned = loyaltyEnabled ? Math.floor(Number(order.total) / pointsPerSpendRupees) : 0;

    const now = new Date();

    // Atomic database update
    await prisma.$transaction(async (tx) => {
      // 1. Update Order payment status
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          paymentConfirmedBy: req.user!.id,
          paymentConfirmedAt: now,
          counterPaymentMethod: instrument,
        },
      });

      // 2. Update Payment records
      await tx.payment.updateMany({
        where: { orderId: order.id },
        data: {
          status: 'PAID',
          paidAt: now,
          providerTxnId: `COUNTER_${instrument}_${Date.now()}`,
        },
      });

      // 3. Create Audit Record
      await tx.paymentAuditLog.create({
        data: {
          orderId: order.id,
          actorType: 'EMPLOYEE',
          actorId: req.user!.id,
          actorName: req.user?.name || req.user?.email || 'Counter Staff',
          action: 'COUNTER_PAYMENT_CONFIRMED',
          details: {
            instrument,
            amount: order.total,
            verificationCode: order.verificationCode,
            confirmedAt: now.toISOString(),
          },
        },
      });

      // 4. Award customer loyalty points if registered customer
      if (order.userId && pointsEarned > 0) {
        await tx.user.update({
          where: { id: order.userId },
          data: { loyaltyPoints: { increment: pointsEarned } },
        });

        await tx.loyaltyTransaction.create({
          data: {
            userId: order.userId,
            orderId: order.id,
            points: pointsEarned,
            type: 'EARNED',
          },
        });
      }
    });

    // Notify customer loyalty updates
    if (order.userId && pointsEarned > 0) {
      const updatedUser = await prisma.user.findUnique({
        where: { id: order.userId },
        select: { loyaltyPoints: true },
      });
      if (updatedUser) {
        emitUserLoyaltyUpdate(order.userId, updatedUser.loyaltyPoints);
      }
    }

    // Emit real-time Socket.io update to customer order tracking room and restaurant room
    emitOrderStatusUpdate(order.id, restaurant.id, {
      orderId: order.id,
      paymentStatus: 'PAID',
      paymentConfirmedAt: now.toISOString(),
      counterPaymentMethod: instrument,
      updatedAt: now.toISOString(),
    });

    // In-app notification for logged-in customer
    if (order.userId) {
      await prisma.notification.create({
        data: {
          userId: order.userId,
          restaurantId: restaurant.id,
          type: 'PAYMENT_RECEIPT',
          title: '✅ Payment Confirmed at Counter!',
          message: `Your payment of ₹${Number(order.total).toFixed(2)} (${instrument}) has been verified and confirmed at the restaurant counter.`,
        },
      });

      emitNotification(order.userId, {
        type: 'PAYMENT_RECEIPT',
        title: '✅ Payment Confirmed at Counter!',
        message: `Your payment of ₹${Number(order.total).toFixed(2)} (${instrument}) has been confirmed!`,
        orderId: order.id,
      });
    }

    res.json({
      success: true,
      message: 'Payment confirmed successfully. Order marked as PAID.',
      data: {
        orderId: order.id,
        paymentStatus: 'PAID',
        paymentConfirmedAt: now,
        counterPaymentMethod: instrument,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 3. Recent Counter Orders Pending Payment (for convenient counter dashboard quick-select)
 */
export async function getCounterPendingOrders(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Authentication required.', 401, 'NOT_AUTHENTICATED');
    }

    const restaurant = await getStaffOrOwnerRestaurant(req.user);

    const orders = await prisma.order.findMany({
      where: {
        restaurantId: restaurant.id,
        paymentStatus: 'PENDING',
        status: { notIn: ['CANCELLED'] },
        deletedAt: null,
      },
      select: {
        id: true,
        verificationCode: true,
        guestName: true,
        tableNumber: true,
        total: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
        user: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({
      success: true,
      data: {
        orders: orders.map((o) => ({
          id: o.id,
          orderNumber: o.id.slice(-8).toUpperCase(),
          verificationCode: o.verificationCode,
          customerName: o.user?.name || o.guestName || 'Guest',
          tableNumber: o.tableNumber,
          total: o.total,
          status: o.status,
          paymentStatus: o.paymentStatus,
          createdAt: o.createdAt,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}
