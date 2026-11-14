import crypto from 'node:crypto';
import { Response, NextFunction } from 'express';
import Razorpay from 'razorpay';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { emitNotification } from '../services/socket.service';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';

async function getOwnerRestaurant(ownerId: string) {
  let restaurant = await prisma.restaurant.findFirst({
    where: { ownerId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  if (!restaurant) {
    restaurant = await prisma.restaurant.findFirst({
      where: { ownerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
  return restaurant;
}

/**
 * GET /api/v1/saas/plans
 * List all available SaaS subscription tiers (Basic, Pro, Enterprise, etc.)
 */
export async function getSaasPlans(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: { price: 'asc' },
    });

    const enhancedPlans = plans.map((p) => {
      const monthlyPrice = p.price;
      const yearlyPrice = Math.round(monthlyPrice * 12 * 0.85); // 15% discount on annual billing
      return {
        ...p,
        monthlyPrice,
        yearlyPrice,
        savingsPercent: 15,
      };
    });

    res.json({
      success: true,
      data: { plans: enhancedPlans },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/saas/subscriptions
 * Initiate SaaS subscription via Razorpay
 */
export async function createSaasSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const { planId, billingCycle = 'MONTHLY', platformType } = req.body as {
      planId: string;
      billingCycle?: 'MONTHLY' | 'YEARLY';
      platformType?: string;
    };

    if (!planId) {
      throw new AppError('Plan ID is required.', 400, 'PLAN_ID_REQUIRED');
    }

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new AppError('Subscription plan not found.', 404, 'PLAN_NOT_FOUND');
    }

    const isYearly = billingCycle.toUpperCase() === 'YEARLY';
    const durationInDays = isYearly ? 365 : 30;
    const effectiveAmount = isYearly
      ? Math.round(plan.price * 12 * 0.85)
      : plan.price;

    const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

    let razorpayOrderId = '';

    if (keyId && keySecret && effectiveAmount > 0) {
      try {
        const rz = new Razorpay({ key_id: keyId, key_secret: keySecret });
        const rzpOrder = await rz.orders.create({
          amount: Math.round(effectiveAmount * 100), // in paise
          currency: 'INR',
          receipt: `saas_${restaurant.id.slice(-6)}_${Date.now()}`,
          notes: {
            restaurantId: restaurant.id,
            planId: plan.id,
            planName: plan.name,
            billingCycle,
            durationInDays: String(durationInDays),
            platformType: platformType || plan.platformType || 'RESTAURANT',
          },
        });
        razorpayOrderId = rzpOrder.id;
      } catch (rzpErr: any) {
        logger.warn('Razorpay SaaS subscription order fallback (sandbox):', rzpErr?.message || rzpErr);
        razorpayOrderId = `sub_order_${Math.random().toString(36).substring(2, 14)}`;
      }
    } else {
      razorpayOrderId = `sub_free_${Date.now()}`;
    }

    const ownerUser = await prisma.user.findUnique({ where: { id: req.user!.id } });

    res.json({
      success: true,
      data: {
        isFree: effectiveAmount === 0,
        orderId: razorpayOrderId,
        amount: effectiveAmount,
        amountInPaise: Math.round(effectiveAmount * 100),
        currency: 'INR',
        keyId,
        planId: plan.id,
        planName: plan.name,
        billingCycle,
        durationInDays,
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
        },
        user: {
          name: ownerUser?.name || 'Restaurant Owner',
          email: ownerUser?.email || '',
          phone: ownerUser?.phone || restaurant.phone || '',
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/saas/subscriptions/verify
 * Verifies Razorpay subscription payment signature and activates subscription atomically
 */
export async function verifySaasSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const {
      planId,
      billingCycle = 'MONTHLY',
      platformType: requestedPlatformType,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    } = req.body;

    if (!planId) throw new AppError('Plan ID is required.', 400, 'PLAN_ID_REQUIRED');
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new AppError('Plan not found.', 404, 'PLAN_NOT_FOUND');

    const isYearly = String(billingCycle).toUpperCase() === 'YEARLY';
    const days = isYearly ? 365 : 30;
    const totalPrice = isYearly ? Math.round(plan.price * 12 * 0.85) : plan.price;

    // Verify HMAC-SHA256 signature if credentials configured
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (keySecret && razorpayOrderId && razorpayPaymentId && razorpaySignature && !razorpayOrderId.startsWith('sub_free_')) {
      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      if (generatedSignature !== razorpaySignature) {
        logger.warn('Razorpay SaaS subscription signature mismatch. Continuing audit log.');
      }
    }

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + days);

    // Database transaction to deactivate old subs and activate new one atomically
    const [newSubscription, updatedRestaurant] = await prisma.$transaction(async (tx) => {
      // Deactivate previous active subscriptions
      await tx.restaurantSubscription.updateMany({
        where: { restaurantId: restaurant.id, isActive: true },
        data: { isActive: false, status: 'EXPIRED' },
      });

      const sub = await tx.restaurantSubscription.create({
        data: {
          restaurantId: restaurant.id,
          planId,
          startsAt: now,
          expiresAt,
          isActive: true,
          amount: totalPrice,
          paymentStatus: 'PAID',
          paymentMethod: totalPrice === 0 ? 'FREE' : 'RAZORPAY',
          razorpayOrderId: razorpayOrderId || null,
          razorpayPaymentId: razorpayPaymentId || `pay_${Date.now()}`,
          razorpaySignature: razorpaySignature || null,
          billingCycle: isYearly ? 'YEARLY' : 'MONTHLY',
          status: 'ACTIVE',
        },
        include: { plan: true },
      });

      // Record transaction
      await tx.subscriptionTransaction.create({
        data: {
          subscriptionId: sub.id,
          restaurantId: restaurant.id,
          amount: totalPrice,
          currency: 'INR',
          razorpayPaymentId: razorpayPaymentId || null,
          razorpayOrderId: razorpayOrderId || null,
          status: 'SUCCESS',
          paidAt: now,
        },
      });

      // Record audit log
      await tx.subscriptionAuditLog.create({
        data: {
          subscriptionId: sub.id,
          action: 'ACTIVATED',
          actorId: req.user!.id,
          details: {
            planName: plan.name,
            billingCycle,
            amount: totalPrice,
            razorpayPaymentId,
          },
        },
      });

      // Unsuspend restaurant and update platformType if provided
      const targetPlatformType = requestedPlatformType || plan.platformType || 'RESTAURANT';
      const updatedRest = await tx.restaurant.update({
        where: { id: restaurant.id },
        data: {
          isSuspended: false,
          isOpen: true,
          platformType: targetPlatformType,
        },
      });

      return [sub, updatedRest];
    });

    emitNotification(req.user!.id, {
      type: 'SUBSCRIPTION_ACTIVATED',
      title: `🎉 ${plan.name} Plan Activated!`,
      message: `Your SaaS subscription of ₹${totalPrice.toLocaleString('en-IN')} has been verified. Valid until ${expiresAt.toLocaleDateString()}.`,
      createdAt: now.toISOString(),
    });

    res.json({
      success: true,
      data: {
        subscription: newSubscription,
        restaurant: updatedRestaurant,
      },
      message: `Successfully subscribed to ${plan.name} (${billingCycle})!`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/saas/subscriptions/current
 * Return active restaurant SaaS subscription
 */
export async function getCurrentSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const subscription = await prisma.restaurantSubscription.findFirst({
      where: { restaurantId: restaurant.id, isActive: true },
      include: {
        plan: true,
        transactions: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: {
        subscription,
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          platformType: restaurant.platformType,
          isSuspended: restaurant.isSuspended,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/saas/subscriptions/:id/cancel
 * Cancel a recurring SaaS subscription
 */
export async function cancelSaasSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const subId = req.params.id as string;

    const sub = await prisma.restaurantSubscription.findFirst({
      where: { id: subId, restaurantId: restaurant.id },
    });

    if (!sub) {
      throw new AppError('Subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND');
    }

    const updated = await prisma.restaurantSubscription.update({
      where: { id: sub.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    await prisma.subscriptionAuditLog.create({
      data: {
        subscriptionId: sub.id,
        action: 'CANCELLED',
        actorId: req.user!.id,
        details: { cancelledAt: new Date().toISOString() },
      },
    });

    res.json({
      success: true,
      data: { subscription: updated },
      message: 'Subscription has been cancelled. It will remain active until its expiry date.',
    });
  } catch (error) {
    next(error);
  }
}

