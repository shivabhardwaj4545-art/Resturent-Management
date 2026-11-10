import Razorpay from 'razorpay';
import crypto from 'node:crypto';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

let razorpayInstance: Razorpay | null = null;

function getRazorpay(): Razorpay {
  if (!razorpayInstance) {
    const key_id = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '';
    const key_secret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!key_id || !key_secret) {
      throw new AppError('Razorpay API keys not configured', 500, 'RAZORPAY_CONFIG_ERROR');
    }
    razorpayInstance = new Razorpay({
      key_id,
      key_secret,
    });
  }
  return razorpayInstance;
}

export async function createRazorpayOrder(
  amount: number,
  currency = 'INR',
  receipt: string,
  notes: Record<string, string> = {}
): Promise<{ id: string; amount: number; currency: string; receipt: string }> {
  try {
    const rz = getRazorpay();
    const order = await rz.orders.create({
      amount: Math.round(amount * 100), // amount in paise
      currency,
      receipt: receipt.slice(0, 40),
      notes,
    });
    return {
      id: order.id,
      amount: order.amount as number,
      currency: order.currency,
      receipt: order.receipt ?? receipt,
    };
  } catch (err: any) {
    logger.error('Failed to create Razorpay order:', err?.message || err);
    throw new AppError(err?.error?.description || err.message || 'Failed to initialize payment gateway order.', 500, 'RAZORPAY_ORDER_FAILED');
  }
}

export function verifyRazorpaySignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): boolean {
  try {
    const secret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!secret) return false;
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    return expectedSignature === razorpaySignature;
  } catch (err) {
    logger.error('Error verifying Razorpay signature:', err);
    return false;
  }
}

export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string
): boolean {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || '';
    if (!secret) return false;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    return expectedSignature === signature;
  } catch (err) {
    logger.error('Error verifying Razorpay webhook signature:', err);
    return false;
  }
}

export async function fetchRazorpayPayment(paymentId: string): Promise<{
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
}> {
  const rz = getRazorpay();
  const payment = await rz.payments.fetch(paymentId);
  return {
    id: payment.id,
    amount: payment.amount as number,
    currency: payment.currency,
    status: payment.status,
    method: payment.method ?? 'unknown',
  };
}

export async function initiateRefund(
  paymentId: string,
  amount: number,
  reason = 'Order cancelled'
): Promise<{ id: string; amount: number }> {
  const rz = getRazorpay();
  const refund = await rz.payments.refund(paymentId, {
    amount: Math.round(amount * 100),
    notes: { reason },
  });
  if (!refund || !refund.id) {
    throw new AppError('Failed to initiate refund', 500, 'REFUND_FAILED');
  }
  return {
    id: refund.id,
    amount: refund.amount as number,
  };
}
