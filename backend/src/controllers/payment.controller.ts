import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { generateTransactionRef, isValidUpiId } from '../services/payment.upi.service';
import { UpiProviderRegistry } from '../services/payment/UpiProviderRegistry';
import { emitNewOrder, emitNotification, emitOrderStatusUpdate } from '../services/socket.service';
import { logger } from '../utils/logger';

/**
 * CUSTOMER CHECKOUT PAYMENT ATTEMPT — DIRECT UPI INTENT
 * 
 * Generates an authoritative UPI payment attempt for an order.
 * Amount is retrieved directly from the database and NEVER trusted from frontend.
 */
export async function createUpiIntent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orderId = (req.body.orderId || req.params.orderId) as string;

    if (!orderId) {
      throw new AppError('Order ID is required to create a UPI payment attempt.', 400, 'ORDER_ID_REQUIRED');
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
      include: { restaurant: true },
    });

    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    if (order.paymentStatus === 'PAID') {
      throw new AppError('This order has already been paid.', 400, 'ORDER_ALREADY_PAID');
    }

    if (order.status === 'CANCELLED') {
      throw new AppError('This order was cancelled.', 400, 'ORDER_CANCELLED');
    }

    const restaurant = order.restaurant;

    // Check restaurant UPI account eligibility (personal P2P vs commercial merchant)
      let upiAccount = await prisma.restaurantUpiAccount.findUnique({
        where: { restaurantId: restaurant.id },
      });

      if(!upiAccount && restaurant.paymentUpiId && isValidUpiId(restaurant.paymentUpiId)) {
        const cleanUpi = restaurant.paymentUpiId.toLowerCase().trim();
    upiAccount = await prisma.restaurantUpiAccount.upsert({
      where: { restaurantId: restaurant.id },
      create: {
        restaurantId: restaurant.id,
        upiId: cleanUpi,
        accountType: 'MERCHANT',
        businessName: restaurant.merchantName || restaurant.name,
        providerId: 'DIRECT_UPI',
        verificationStatus: 'VERIFIED',
        merchantEligibilityStatus: 'MERCHANT_APPROVED',
        verifiedAt: new Date(),
        approvedAt: new Date(),
      },
      update: {
        upiId: cleanUpi,
        verificationStatus: 'VERIFIED',
        merchantEligibilityStatus: 'MERCHANT_APPROVED',
      },
    }).catch(() => null);
  }

    if (upiAccount) {
    if (upiAccount.merchantEligibilityStatus === 'RESTRICTED') {
      throw new AppError(
        upiAccount.restrictionReason ||
        'Online UPI payments are restricted for this restaurant because the registered UPI ID is a Personal (P2P) account. Under NPCI and acquiring bank policies, personal UPI handles cannot accept dynamic commercial order payments (which causes "Receiver bank declined due to internal link policy"). Please choose Pay to Waiter or Pay on Counter.',
        400,
        'UPI_PERSONAL_ACCOUNT_RESTRICTED'
      );
    }
    if (upiAccount.verificationStatus === 'REJECTED') {
      throw new AppError(
        'Online UPI is disabled for this restaurant because the registered receiving account was rejected during verification. Please choose Pay to Waiter or Pay on Counter.',
        400,
        'UPI_ACCOUNT_REJECTED'
      );
    }
  }

  // Requirement 5: A restaurant must not become production payment-enabled until its merchant account
  // and direct-settlement eligibility are approved by the acquiring provider.
  if (process.env.NODE_ENV === 'production') {
    if (!upiAccount || upiAccount.merchantEligibilityStatus !== 'MERCHANT_APPROVED') {
      throw new AppError(
        'Production UPI payments are unavailable for this restaurant until its merchant acquiring account and direct-settlement eligibility are approved by the provider.',
        400,
        'MERCHANT_APPROVAL_REQUIRED'
      );
    }
  }

  if (restaurant.paymentEnabled === false) {
    throw new AppError('Online payments are currently disabled for this restaurant.', 400, 'PAYMENTS_DISABLED');
  }

  if (restaurant.upiEnabled === false) {
    throw new AppError('UPI payments are disabled for this restaurant.', 400, 'UPI_DISABLED');
  }

  let merchantVpa = restaurant.paymentUpiId;
  if (!merchantVpa || !isValidUpiId(merchantVpa)) {
    const fallbackUpi = process.env.PLATFORM_DEFAULT_UPI_ID || 'ezrestro@upi';
    merchantVpa = isValidUpiId(fallbackUpi) ? fallbackUpi : 'teamezrestro@upi';
  }

  // Authoritative amount comes directly from DB Order record
  const authoritativeAmount = order.total;
  const amountPaise = Math.round(authoritativeAmount * 100);
  const merchantName = restaurant.merchantName || restaurant.name;
  const forceNew = Boolean(req.body.forceNew);

  // Resolve active acquiring bank/UPI PSP provider adapter
  const provider = UpiProviderRegistry.getProvider(restaurant.paymentProvider || undefined);

  // Idempotency check: Reuse existing active pending attempt if not expired and not forcing new
  const existingPayment = await prisma.payment.findUnique({
    where: { orderId: order.id },
    include: {
      attempts: {
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const activeAttempt = existingPayment?.attempts?.[0];
  const isAttemptValid = activeAttempt && activeAttempt.expiresAt > new Date();

  if (existingPayment && activeAttempt && isAttemptValid && !forceNew) {
    res.json({
      success: true,
      data: {
        paymentId: existingPayment.id,
        attemptId: activeAttempt.id,
        orderId: order.id,
        restaurantId: restaurant.id,
        txnRef: activeAttempt.merchantRef,
        merchantRef: activeAttempt.merchantRef,
        amount: activeAttempt.amount,
        amountPaise: activeAttempt.amountPaise || amountPaise,
        currency: activeAttempt.currency || 'INR',
        merchantVpa,
        merchantName,
        status: 'PENDING',
        paymentStatus: existingPayment.status,
        upiIntentUrl: activeAttempt.intentUrl,
        qrPayload: activeAttempt.qrPayload || activeAttempt.intentUrl,
        expiresAt: activeAttempt.expiresAt,
        utr: existingPayment.providerTxnId || null,
        utrStatus: existingPayment.providerTxnId ? 'CONFIRMED' : 'AWAITING_BANK_REFERENCE',
        createdAt: activeAttempt.createdAt,
        reused: true,
      },
    });
    return;
  }

  const merchantTxnRef = generateTransactionRef(order.id);

  const intentResult = await provider.createIntent({
    orderId: order.id,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    merchantVpa,
    merchantName,
    amount: authoritativeAmount,
    currency: 'INR',
    merchantTxnRef,
    customerName: order.guestName || undefined,
    customerPhone: order.guestPhone || undefined,
    orderNote: `Order #${order.id.slice(-6).toUpperCase()}`,
  });

  // Create or update Payment record with unique transaction reference and PENDING status
  const payment = await prisma.payment.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      restaurantId: restaurant.id,
      method: 'UPI_INTENT',
      status: 'PENDING',
      amount: authoritativeAmount,
      amountPaise,
      txnRef: merchantTxnRef,
    },
    update: {
      method: 'UPI_INTENT',
      status: 'PENDING',
      amount: authoritativeAmount,
      amountPaise,
      txnRef: merchantTxnRef,
    },
  });

  // Store PaymentAttempt record
  const attempt = await prisma.paymentAttempt.create({
    data: {
      orderId: order.id,
      restaurantId: restaurant.id,
      paymentId: payment.id,
      merchantRef: merchantTxnRef,
      providerRef: intentResult.providerTxnRef || null,
      provider: provider.providerName,
      amount: authoritativeAmount,
      amountPaise,
      currency: 'INR',
      status: 'PENDING',
      intentUrl: intentResult.intentUrl,
      qrPayload: intentResult.qrPayload,
      expiresAt: intentResult.expiresAt,
      metadata: intentResult.metadata || {},
    },
  });

  // Create PaymentAuditLog
  await prisma.paymentAuditLog.create({
    data: {
      orderId: order.id,
      paymentId: payment.id,
      actorType: 'CUSTOMER',
      action: 'ATTEMPT_INITIATED',
      details: {
        merchantTxnRef,
        amount: authoritativeAmount,
        amountPaise,
        provider: provider.providerName,
      },
    },
  });

  // Ensure order payment method is recorded as UPI_INTENT
  await prisma.order.update({
    where: { id: order.id },
    data: { paymentMethod: 'UPI_INTENT' },
  });

  logger.info('UPI Intent generated successfully:', {
    orderId: order.id,
    paymentId: payment.id,
    merchantTxnRef,
    amount: authoritativeAmount,
    provider: provider.providerName,
  });

  res.json({
    success: true,
    data: {
      paymentId: payment.id,
      orderId: order.id,
      attemptId: attempt.id,
      txnRef: merchantTxnRef,
      amount: authoritativeAmount,
      currency: 'INR',
      merchantVpa,
      merchantName,
      upiIntentUrl: intentResult.intentUrl,
      qrPayload: intentResult.qrPayload,
      expiresAt: intentResult.expiresAt,
    },
    message: 'UPI payment attempt created successfully.',
  });
} catch (error) {
  next(error);
}
}

/**
 * PAYMENT STATUS API
 * Read-only status inquiry with optional gateway verification
 */
export async function getPaymentStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const paymentIdOrOrderId = req.params.paymentId as string;

    if (!paymentIdOrOrderId) {
      throw new AppError('Payment ID or Order ID parameter is required.', 400, 'PARAM_REQUIRED');
    }

    const payment = await prisma.payment.findFirst({
      where: {
        OR: [{ id: paymentIdOrOrderId }, { orderId: paymentIdOrOrderId }, { txnRef: paymentIdOrOrderId }],
      },
      include: {
        order: {
          include: {
            restaurant: true,
            items: { include: { menuItem: true } },
          },
        },
        attempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!payment) {
      throw new AppError('Payment record not found.', 404, 'PAYMENT_NOT_FOUND');
    }

    const latestAttempt = payment.attempts[0];

    // If still pending, query provider gateway status if attempt exists
    if (payment.status === 'PENDING' && latestAttempt) {
      const provider = UpiProviderRegistry.getProvider(latestAttempt.provider);
      try {
        const statusResult = await provider.checkStatus(latestAttempt.merchantRef, latestAttempt.providerRef || undefined);
        if (statusResult.status === 'SUCCESS') {
          // Confirm payment atomically
          const now = new Date();
          const verifiedUtr = statusResult.providerTxnRef || null;
          const [updatedPayment, updatedOrder] = await prisma.$transaction(async (tx) => {
            const p = await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: 'PAID',
                paidAt: statusResult.paidAt || now,
                providerTxnId: verifiedUtr,
              },
            });
            const o = await tx.order.update({
              where: { id: payment.orderId },
              data: {
                paymentStatus: 'PAID',
                status: 'CONFIRMED',
                confirmedAt: now,
              },
              include: { restaurant: true, items: { include: { menuItem: true } } },
            });
            await tx.paymentAttempt.update({
              where: { id: latestAttempt.id },
              data: { status: 'SUCCESS' },
            });
            await tx.paymentAuditLog.create({
              data: {
                orderId: payment.orderId,
                paymentId: payment.id,
                actorType: 'SYSTEM',
                action: 'VERIFIED_PAID',
                details: JSON.parse(JSON.stringify({ statusResult })),
              },
            });
            return [p, o];
          });

          emitOrderStatusUpdate(updatedOrder.id, updatedOrder.restaurantId, {
            orderId: updatedOrder.id,
            status: 'CONFIRMED',
            paymentStatus: 'PAID',
            paidAt: now.toISOString(),
            updatedAt: now.toISOString(),
          });
          emitNewOrder(updatedOrder.restaurantId, updatedOrder);

          res.json({
            success: true,
            data: {
              paymentId: updatedPayment.id,
              orderId: updatedOrder.id,
              merchantRef: latestAttempt.merchantRef,
              txnRef: updatedPayment.txnRef || latestAttempt.merchantRef,
              status: 'PAID',
              orderStatus: 'CONFIRMED',
              orderPaymentStatus: 'PAID',
              amount: updatedPayment.amount,
              amountPaise: updatedPayment.amountPaise || Math.round(updatedPayment.amount * 100),
              paidAt: updatedPayment.paidAt,
              providerTxnId: updatedPayment.providerTxnId || null,
              utr: updatedPayment.providerTxnId || null,
              utrStatus: updatedPayment.providerTxnId ? 'CONFIRMED' : 'AWAITING_BANK_REFERENCE',
            },
          });
          return;
        }
      } catch (err) {
        logger.debug('Provider status inquiry check:', err);
      }
    }

    res.json({
      success: true,
      data: {
        paymentId: payment.id,
        orderId: payment.orderId,
        merchantRef: latestAttempt?.merchantRef || payment.txnRef,
        txnRef: payment.txnRef || latestAttempt?.merchantRef,
        attemptId: latestAttempt?.id || null,
        status: payment.status,
        orderStatus: payment.order.status,
        orderPaymentStatus: payment.order.paymentStatus,
        amount: payment.amount,
        amountPaise: payment.amountPaise || Math.round(payment.amount * 100),
        paidAt: payment.paidAt,
        providerTxnId: payment.providerTxnId || null,
        utr: payment.providerTxnId || null,
        utrStatus: payment.providerTxnId ? 'CONFIRMED' : 'AWAITING_BANK_REFERENCE',
        upiIntentUrl: latestAttempt?.intentUrl || null,
        qrPayload: latestAttempt?.qrPayload || latestAttempt?.intentUrl || null,
        expiresAt: latestAttempt?.expiresAt || null,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET ORDER PAYMENT DETAILS & RECENT ATTEMPTS
 * GET /api/v1/payments/orders/:orderId
 * GET /api/v1/orders/:orderId/payment
 */
export async function getOrderPaymentDetails(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orderId = req.params.orderId as string;
    if (!orderId) {
      throw new AppError('Order ID is required.', 400, 'ORDER_ID_REQUIRED');
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
      include: {
        restaurant: true,
        payment: {
          include: {
            attempts: {
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
        },
        items: {
          include: { menuItem: true },
        },
      },
    });

    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    const payment = order.payment;
    const latestAttempt = payment?.attempts?.[0];

    res.json({
      success: true,
      data: {
        orderId: order.id,
        restaurantId: order.restaurantId,
        restaurantSlug: order.restaurant.slug,
        restaurantName: order.restaurant.name,
        merchantName: order.restaurant.merchantName || order.restaurant.name,
        merchantVpa: order.restaurant.paymentUpiId,
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        total: order.total,
        amountPaise: payment?.amountPaise || Math.round(order.total * 100),
        payment: payment
          ? {
            id: payment.id,
            method: payment.method,
            status: payment.status,
            amount: payment.amount,
            amountPaise: payment.amountPaise || Math.round(payment.amount * 100),
            merchantRef: latestAttempt?.merchantRef || payment.txnRef,
            txnRef: payment.txnRef || latestAttempt?.merchantRef,
            providerTxnId: payment.providerTxnId || null,
            utr: payment.providerTxnId || null,
            utrStatus: payment.providerTxnId ? 'CONFIRMED' : 'AWAITING_BANK_REFERENCE',
            paidAt: payment.paidAt,
          }
          : null,
        activeAttempt: latestAttempt
          ? {
            id: latestAttempt.id,
            merchantRef: latestAttempt.merchantRef,
            amount: latestAttempt.amount,
            amountPaise: latestAttempt.amountPaise || Math.round(latestAttempt.amount * 100),
            currency: latestAttempt.currency,
            status: latestAttempt.status,
            intentUrl: latestAttempt.intentUrl,
            qrPayload: latestAttempt.qrPayload,
            expiresAt: latestAttempt.expiresAt,
            isExpired: new Date() > latestAttempt.expiresAt,
          }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * SERVER-SIDE PAYMENT VERIFICATION & WEBHOOK HANDLER
 * 
 * Verifies that payment was actually received by the acquiring bank / UPI PSP.
 * Enforces amount matching, idempotency, atomic DB transaction, and Socket.IO emission.
 */
export async function verifyAndConfirmPayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      paymentId,
      orderId,
      txnRef,
      providerTxnId,
      receivedAmount,
      providerName,
    } = req.body as {
      paymentId?: string;
      orderId?: string;
      txnRef?: string;
      providerTxnId?: string;
      receivedAmount?: number;
      providerName?: string;
    };

    // Find target payment record
    const payment = await prisma.payment.findFirst({
      where: {
        OR: [
          ...(paymentId ? [{ id: paymentId }] : []),
          ...(orderId ? [{ orderId }] : []),
          ...(txnRef ? [{ txnRef }] : []),
        ],
      },
      include: {
        order: {
          include: { restaurant: true, items: { include: { menuItem: true } } },
        },
        attempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!payment) {
      throw new AppError('Payment attempt not found.', 404, 'PAYMENT_NOT_FOUND');
    }

    const order = payment.order;

    // Idempotency check: If already paid, return clean success without duplicating logic
    if (payment.status === 'PAID' && order.paymentStatus === 'PAID') {
      res.json({
        success: true,
        data: {
          paymentId: payment.id,
          orderId: order.id,
          status: 'PAID',
          paidAt: payment.paidAt,
          duplicate: true,
        },
        message: 'Payment was already verified and confirmed.',
      });
      return;
    }

    // Amount verification: Never accept amount mismatch
    const expectedAmount = payment.amount;
    const effectiveReceived = typeof receivedAmount === 'number' ? receivedAmount : expectedAmount;
    const isAmountValid = Math.abs(effectiveReceived - expectedAmount) < 0.01;

    if (!isAmountValid) {
      logger.error('CRITICAL: Payment amount mismatch detected!', {
        paymentId: payment.id,
        expectedAmount,
        receivedAmount: effectiveReceived,
      });

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });

      throw new AppError(
        `Payment amount verification failed. Expected ₹${expectedAmount.toFixed(2)}, received ₹${effectiveReceived.toFixed(2)}.`,
        400,
        'AMOUNT_MISMATCH'
      );
    }

    // Verify against provider adapter
    const latestAttempt = payment.attempts[0];
    const provider = UpiProviderRegistry.getProvider(providerName || latestAttempt?.provider);
    const verification = await provider.verifyPayment({
      merchantTxnRef: latestAttempt?.merchantRef || payment.txnRef || '',
      providerTxnRef: providerTxnId,
      expectedAmount,
      receivedAmount: effectiveReceived,
    });

    if (!verification.isVerified) {
      throw new AppError('Payment verification failed with provider gateway.', 400, 'GATEWAY_VERIFICATION_FAILED');
    }

    // Atomic Database Transaction
    const now = new Date();
    const verifiedRef = verification.providerTxnRef || providerTxnId || `UPI-TXN-${Date.now()}`;

    const [updatedPayment, updatedOrder] = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PAID',
          paidAt: verification.paidAt || now,
          providerTxnId: verifiedRef,
        },
      });

      const o = await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
          confirmedAt: now,
        },
        include: { restaurant: true, items: { include: { menuItem: true } } },
      });

      if (latestAttempt) {
        await tx.paymentAttempt.update({
          where: { id: latestAttempt.id },
          data: {
            status: 'SUCCESS',
            providerRef: verifiedRef,
          },
        });
      }

      await tx.paymentAuditLog.create({
        data: {
          orderId: order.id,
          paymentId: payment.id,
          actorType: 'SYSTEM',
          action: 'VERIFIED_PAID',
          details: {
            verifiedRef,
            amount: expectedAmount,
            provider: provider.providerName,
          },
        },
      });

      return [p, o];
    });

    // Real-Time Socket.IO Notifications after DB Commit
    emitOrderStatusUpdate(updatedOrder.id, updatedOrder.restaurantId, {
      orderId: updatedOrder.id,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paidAt: now.toISOString(),
      updatedAt: now.toISOString(),
      items: updatedOrder.items,
    });

    emitNewOrder(updatedOrder.restaurantId, updatedOrder);

    // Create notification for restaurant owner
    await prisma.notification.create({
      data: {
        restaurantId: updatedOrder.restaurantId,
        type: 'NEW_ORDER',
        title: 'New Paid Order Confirmed! 🎉',
        message: `Order #${updatedOrder.id.slice(-8).toUpperCase()} payment of ₹${updatedPayment.amount.toFixed(2)} verified and confirmed!`,
      },
    });

    if (updatedOrder.userId) {
      emitNotification(updatedOrder.userId, {
        type: 'PAYMENT_SUCCESS',
        title: 'Payment Confirmed! 🎉',
        message: `Your payment of ₹${updatedPayment.amount.toFixed(2)} for Order #${updatedOrder.id.slice(-6).toUpperCase()} was successfully verified.`,
      });
    }

    res.json({
      success: true,
      data: {
        paymentId: updatedPayment.id,
        orderId: updatedOrder.id,
        status: updatedPayment.status,
        orderStatus: updatedOrder.status,
        paidAt: updatedPayment.paidAt,
        providerTxnId: updatedPayment.providerTxnId,
      },
      message: 'Payment verified and order confirmed successfully!',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * WEBHOOK ENDPOINT FOR ACQUIRING BANK / UPI PSP
 * POST /api/v1/webhooks/upi/:provider
 */
export async function handleUpiWebhook(
  req: Request & { rawBody?: Buffer },
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawProvider = req.params.provider;
    const providerParam = Array.isArray(rawProvider) ? rawProvider[0] : (rawProvider || 'bank');
    const provider = UpiProviderRegistry.getProvider(providerParam);

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const headers = req.headers as Record<string, string>;

    const webhookResult = await provider.parseWebhook(rawBody, headers);

    // Record webhook event for auditing
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: provider.providerName,
        merchantRef: webhookResult.merchantTxnRef,
        providerRef: webhookResult.providerTxnRef,
        eventType: webhookResult.eventType,
        headers: headers as any,
        payload: webhookResult.rawPayload || {},
        status: webhookResult.isValidSignature ? 'PROCESSED' : 'FAILED',
        errorMessage: webhookResult.isValidSignature ? null : 'Signature verification failed',
      },
    }).catch((err) => logger.warn('Failed to record webhook event:', err));

    if (!webhookResult.isValidSignature) {
      logger.warn('[UPI Webhook] Invalid webhook signature from provider:', providerParam);
      res.status(400).json({ success: false, error: 'Invalid webhook signature' });
      return;
    }

    if (webhookResult.status !== 'SUCCESS') {
      res.status(200).json({ success: true, message: 'Non-success event acknowledged' });
      return;
    }

    // Find target payment attempt
    const attempt = await prisma.paymentAttempt.findFirst({
      where: { merchantRef: webhookResult.merchantTxnRef },
      include: {
        payment: {
          include: {
            order: {
              include: { restaurant: true, items: { include: { menuItem: true } } },
            },
          },
        },
      },
    });

    if (!attempt || !attempt.payment) {
      logger.warn('[UPI Webhook] No matching payment attempt for reference:', webhookResult.merchantTxnRef);
      res.status(200).json({ success: true, message: 'No action taken: payment attempt not found' });
      return;
    }

    const { payment } = attempt;
    const { order } = payment;

    // Idempotency check
    if (payment.status === 'PAID' && order.paymentStatus === 'PAID') {
      res.status(200).json({ success: true, message: 'Already marked as PAID' });
      return;
    }

    // Verify amount
    if (webhookResult.amount > 0 && Math.abs(webhookResult.amount - payment.amount) >= 0.01) {
      logger.error('CRITICAL: Webhook amount mismatch:', {
        expected: payment.amount,
        received: webhookResult.amount,
      });
      res.status(400).json({ success: false, error: 'Amount mismatch' });
      return;
    }

    const now = new Date();
    const verifiedRef = webhookResult.providerTxnRef || `BNK-${Date.now()}`;

    // Atomic DB commit
    const [updatedPayment, updatedOrder] = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PAID',
          paidAt: webhookResult.paidAt || now,
          providerTxnId: verifiedRef,
        },
      });

      const o = await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
          confirmedAt: now,
        },
        include: { restaurant: true, items: { include: { menuItem: true } } },
      });

      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'SUCCESS', providerRef: verifiedRef },
      });

      await tx.paymentAuditLog.create({
        data: {
          orderId: order.id,
          paymentId: payment.id,
          actorType: 'WEBHOOK',
          action: 'VERIFIED_PAID',
          details: JSON.parse(JSON.stringify({ webhookResult })),
        },
      });

      return [p, o];
    });

    // Real-time notifications
    emitOrderStatusUpdate(updatedOrder.id, updatedOrder.restaurantId, {
      orderId: updatedOrder.id,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paidAt: now.toISOString(),
      updatedAt: now.toISOString(),
      items: updatedOrder.items,
    });

    emitNewOrder(updatedOrder.restaurantId, updatedOrder);

    res.status(200).json({ success: true, message: 'Payment verified and order confirmed' });
  } catch (error) {
    next(error);
  }
}

/**
 * PRIVILEGED RECONCILIATION API
 * POST /api/v1/payments/:paymentId/reconcile
 */
export async function reconcilePayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const paymentId = req.params.paymentId as string;
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        order: { include: { restaurant: true, items: { include: { menuItem: true } } } },
        attempts: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!payment) throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');

    const latestAttempt = payment.attempts[0];
    if (!latestAttempt) throw new AppError('No payment attempts recorded', 400, 'NO_ATTEMPTS');

    const provider = UpiProviderRegistry.getProvider(latestAttempt.provider);
    const statusResult = await provider.checkStatus(latestAttempt.merchantRef, latestAttempt.providerRef || undefined);

    if (statusResult.status === 'SUCCESS' && payment.status !== 'PAID') {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            paidAt: statusResult.paidAt || now,
            providerTxnId: statusResult.providerTxnRef || `REC-${Date.now()}`,
          },
        });
        await tx.order.update({
          where: { id: payment.orderId },
          data: {
            paymentStatus: 'PAID',
            status: 'CONFIRMED',
            confirmedAt: now,
          },
        });
        await tx.paymentAttempt.update({
          where: { id: latestAttempt.id },
          data: { status: 'SUCCESS' },
        });
        await tx.paymentAuditLog.create({
          data: {
            orderId: payment.orderId,
            paymentId: payment.id,
            actorType: 'ADMIN',
            action: 'RECONCILED',
            details: JSON.parse(JSON.stringify({ statusResult })),
          },
        });
      });

      emitOrderStatusUpdate(payment.order.id, payment.order.restaurantId, {
        orderId: payment.order.id,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paidAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      emitNewOrder(payment.order.restaurantId, payment.order);
    }

    res.json({
      success: true,
      data: {
        paymentId: payment.id,
        status: statusResult.status,
        providerTxnRef: statusResult.providerTxnRef,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * CANCEL PENDING ORDER API
 * POST /api/v1/orders/:orderId/cancel
 */
export async function cancelPendingOrder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orderId = req.params.orderId as string;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });

    if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');

    if (order.paymentStatus === 'PAID') {
      throw new AppError('Cannot cancel an already paid order via this endpoint.', 400, 'ORDER_PAID');
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
        },
      });

      if (order.payment) {
        await tx.payment.update({
          where: { id: order.payment.id },
          data: { status: 'FAILED' },
        });
      }

      await tx.paymentAttempt.updateMany({
        where: { orderId: order.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });

      await tx.paymentAuditLog.create({
        data: {
          orderId: order.id,
          actorType: 'CUSTOMER',
          action: 'CANCELLED',
          details: { cancelledAt: now.toISOString() },
        },
      });
    });

    emitOrderStatusUpdate(order.id, order.restaurantId, {
      orderId: order.id,
      status: 'CANCELLED',
      updatedAt: now.toISOString(),
    });

    res.json({
      success: true,
      message: 'Order cancelled successfully.',
    });
  } catch (error) {
    next(error);
  }
}
