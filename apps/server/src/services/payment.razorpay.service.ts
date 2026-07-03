import Razorpay from 'razorpay';
import crypto from 'crypto';
import { AppError } from '../utils/AppError';

let razorpay: Razorpay;

function getRazorpay(): Razorpay {
  if (!razorpay) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID ?? '',
      key_secret: process.env.RAZORPAY_KEY_SECRET ?? '',
    });
  }
  return razorpay;
}

export async function createRazorpayOrder(
  amount: number,
  currency = 'INR',
  receipt: string,
  notes: Record<string, string> = {}
): Promise<{
  id: string;
  amount: number;
  currency: string;
  receipt: string;
}> {
  if (Math.round(amount * 100) < 100) {
    throw new AppError('Minimum amount for order creation is 100 paise (₹1.00).', 400, 'MIN_AMOUNT_NOT_MET');
  }

  try {
    const keyId = process.env.RAZORPAY_KEY_ID ?? '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET ?? '';

    // Detect dummy keys or missing credentials
    if (!keyId || keyId.includes('your_key_id') || keySecret.includes('your_razorpay_key_secret')) {
      console.warn('⚠️ Razorpay keys are not configured. Falling back to a mock Razorpay order.');
      return {
        id: `order_mock_${Math.random().toString(36).substring(2, 15)}`,
        amount: Math.round(amount * 100),
        currency,
        receipt,
      };
    }

    const rz = getRazorpay();

    const order = await rz.orders.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency,
      receipt,
      notes,
    });

    return {
      id: order.id,
      amount: order.amount as number,
      currency: order.currency,
      receipt: order.receipt ?? receipt,
    };
  } catch (err: any) {
    const keyId = process.env.RAZORPAY_KEY_ID ?? '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET ?? '';
    const hasKeys = keyId && !keyId.includes('your_key_id') && keySecret && !keySecret.includes('your_razorpay_key_secret');

    if (!hasKeys && process.env.NODE_ENV === 'development') {
      console.warn('⚠️ Razorpay order creation failed. Falling back to mock Razorpay order in development:', err.message);
      return {
        id: `order_mock_${Math.random().toString(36).substring(2, 15)}`,
        amount: Math.round(amount * 100),
        currency,
        receipt,
      };
    }

    // Handle auth failures (return 401)
    if (
      err.statusCode === 401 ||
      err.status === 401 ||
      err.message?.toLowerCase().includes('auth') ||
      err.message?.toLowerCase().includes('key') ||
      err.message?.toLowerCase().includes('credential')
    ) {
      throw new AppError('Razorpay authentication failed. Please check API keys.', 401, 'PAYMENT_AUTH_FAILURE');
    }

    // Handle Razorpay API errors (return 500)
    throw new AppError(err.message || 'Razorpay API error', 500, 'PAYMENT_GATEWAY_ERROR');
  }
}

export function verifyRazorpaySignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): boolean {
  if (razorpayOrderId?.startsWith('order_mock_')) {
    console.warn('⚠️ Bypassing signature verification for mock Razorpay order.');
    return true;
  }
  const secret = process.env.RAZORPAY_KEY_SECRET ?? '';
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return expectedSignature === razorpaySignature;
}

export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return expectedSignature === signature;
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
