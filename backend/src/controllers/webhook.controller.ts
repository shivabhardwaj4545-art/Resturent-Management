import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { verifyRazorpayWebhookSignature } from '../services/payment.razorpay.service';
import { AppError } from '../utils/AppError';
import { emitNewOrder, emitNotification, emitOrderStatusUpdate } from '../services/socket.service';
import { logger } from '../utils/logger';

interface CustomRequest extends Request {
  rawBody?: Buffer;
}

export async function handleRazorpayWebhook(
  req: CustomRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    if (!signature) {
      throw new AppError('Missing signature header', 400, 'MISSING_SIGNATURE');
    }

    // Verify webhook signature using raw body buffer
    const bodyStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const isValid = verifyRazorpayWebhookSignature(bodyStr, signature);

    if (!isValid) {
      throw new AppError('Invalid webhook signature', 400, 'INVALID_SIGNATURE');
    }

    const { event, payload } = req.body as {
      event: string;
      payload: any;
    };

    logger.info(`[Razorpay Webhook Received] Event: ${event}`);

    // ============================================================
    // 1. RAZORPAY SAAS SUBSCRIPTIONS EVENTS
    // ============================================================
    if (event.startsWith('subscription.')) {
      const subEntity = payload.subscription?.entity;
      const paymentEntity = payload.payment?.entity;

      if (!subEntity) {
        logger.warn('⚠️ Webhook missing subscription entity');
        res.status(200).json({ success: true, message: 'Missing subscription entity' });
        return;
      }

      const razorpaySubscriptionId = subEntity.id;
      const notes = subEntity.notes || {};
      const restaurantId = notes.restaurantId;

      // Find target subscription by razorpaySubscriptionId or restaurantId
      const subscription = await prisma.restaurantSubscription.findFirst({
        where: {
          OR: [
            { razorpaySubscriptionId },
            ...(restaurantId ? [{ restaurantId, isActive: true }] : []),
          ],
        },
        include: { restaurant: true, plan: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!subscription) {
        logger.warn(`⚠️ Subscription record not found for: ${razorpaySubscriptionId}`);
        res.status(200).json({ success: true, message: 'Subscription record not found' });
        return;
      }

      const now = new Date();

      if (event === 'subscription.charged' || event === 'subscription.activated') {
        const amountInPaise = paymentEntity?.amount || (subscription.amount * 100);
        const amount = amountInPaise / 100;
        const currentEnd = subEntity.current_end ? new Date(subEntity.current_end * 1000) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        await prisma.$transaction(async (tx) => {
          await tx.restaurantSubscription.update({
            where: { id: subscription.id },
            data: {
              isActive: true,
              paymentStatus: 'PAID',
              status: 'ACTIVE',
              razorpaySubscriptionId,
              razorpayPaymentId: paymentEntity?.id || subscription.razorpayPaymentId,
              expiresAt: currentEnd,
            },
          });

          await tx.subscriptionTransaction.create({
            data: {
              subscriptionId: subscription.id,
              restaurantId: subscription.restaurantId,
              amount,
              currency: 'INR',
              razorpayPaymentId: paymentEntity?.id || null,
              status: 'SUCCESS',
              paidAt: now,
              rawResponse: payload,
            },
          });

          await tx.subscriptionAuditLog.create({
            data: {
              subscriptionId: subscription.id,
              action: event === 'subscription.charged' ? 'RENEWED' : 'ACTIVATED',
              details: {
                event,
                amount,
                expiresAt: currentEnd.toISOString(),
              },
            },
          });

          await tx.restaurant.update({
            where: { id: subscription.restaurantId },
            data: { isSuspended: false },
          });
        });

        logger.info(`[Razorpay Webhook Success] Subscription ${subscription.id} renewed until ${currentEnd.toISOString()}`);
      } else if (event === 'subscription.halted') {
        await prisma.$transaction(async (tx) => {
          await tx.restaurantSubscription.update({
            where: { id: subscription.id },
            data: { status: 'HALTED', isActive: false },
          });

          await tx.subscriptionAuditLog.create({
            data: {
              subscriptionId: subscription.id,
              action: 'HALTED',
              details: { reason: 'Recurring mandate charge failed multiple times' },
            },
          });
        });
      } else if (event === 'subscription.cancelled') {
        await prisma.$transaction(async (tx) => {
          await tx.restaurantSubscription.update({
            where: { id: subscription.id },
            data: { status: 'CANCELLED', cancelledAt: now },
          });

          await tx.subscriptionAuditLog.create({
            data: {
              subscriptionId: subscription.id,
              action: 'CANCELLED',
              details: { cancelledVia: 'Razorpay Webhook' },
            },
          });
        });
      }

      res.status(200).json({ success: true });
      return;
    }

    // ============================================================
    // 2. GENERAL PAYMENT CAPTURED / ORDER PAID (Fallback)
    // ============================================================
    if (event === 'order.paid' || event === 'payment.captured') {
      const razorpayOrderId = payload.order?.entity?.id || payload.payment?.entity?.order_id;
      const razorpayPaymentId = payload.payment?.entity?.id;

      if (!razorpayOrderId) {
        res.status(200).json({ success: true, message: 'No action taken: missing razorpayOrderId' });
        return;
      }

      // Check if this is a SaaS subscription order
      const subOrder = await prisma.restaurantSubscription.findFirst({
        where: { razorpayOrderId },
      });

      if (subOrder) {
        await prisma.$transaction(async (tx) => {
          await tx.restaurantSubscription.update({
            where: { id: subOrder.id },
            data: {
              paymentStatus: 'PAID',
              isActive: true,
              status: 'ACTIVE',
              razorpayPaymentId,
            },
          });

          await tx.subscriptionTransaction.create({
            data: {
              subscriptionId: subOrder.id,
              restaurantId: subOrder.restaurantId,
              amount: subOrder.amount,
              currency: 'INR',
              razorpayPaymentId,
              razorpayOrderId,
              status: 'SUCCESS',
              paidAt: new Date(),
            },
          });

          await tx.restaurant.update({
            where: { id: subOrder.restaurantId },
            data: { isSuspended: false, isOpen: true },
          });
        });

        res.status(200).json({ success: true, message: 'SaaS subscription order paid' });
        return;
      }

      // Customer food orders legacy fallback
      const order = await prisma.order.findFirst({
        where: { razorpayOrderId },
        include: { restaurant: true, user: true },
      });

      if (!order) {
        res.status(200).json({ success: true, message: 'Order not found in database' });
        return;
      }

      if (order.paymentStatus === 'PAID') {
        res.status(200).json({ success: true, message: 'Order already marked as PAID' });
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'PAID',
            status: 'CONFIRMED',
            razorpayPaymentId,
          },
        });

        await tx.payment.updateMany({
          where: { orderId: order.id },
          data: {
            status: 'PAID',
            razorpayPaymentId,
          },
        });
      });

      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
        include: { items: { include: { menuItem: true } }, restaurant: true },
      });

      if (updatedOrder) {
        emitOrderStatusUpdate(order.id, order.restaurantId, {
          orderId: order.id,
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          updatedAt: new Date().toISOString(),
          items: updatedOrder.items,
        });
        emitNewOrder(order.restaurantId, updatedOrder);
      }

      if (order.userId) {
        emitNotification(order.userId, {
          type: 'ORDER_PLACED',
          title: 'Payment Verified via Webhook',
          message: `Your payment for the order at ${order.restaurant.name} was successfully received.`,
        });
      }

      res.status(200).json({ success: true });
      return;
    }

    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('[Webhook Error] Processing failed:', error);
    next(error);
  }
}
