import { Router } from 'express';
import {
  createUpiIntent,
  getPaymentStatus,
  verifyAndConfirmPayment,
  handleUpiWebhook,
  reconcilePayment,
  cancelPendingOrder,
} from '../controllers/payment.controller';

const router = Router();

// Customer endpoint to generate UPI intent payment attempt (supports both styles)
router.post('/create-upi-intent', createUpiIntent);
router.post('/orders/:orderId/payment-attempts', createUpiIntent);

// Read-only endpoint to check server-side payment status
router.get('/:paymentId/status', getPaymentStatus);

// Server-side verification & webhook endpoint
router.post('/verify-upi', verifyAndConfirmPayment);
router.post('/webhook', handleUpiWebhook);
router.post('/webhooks/upi/:provider', handleUpiWebhook);

// Privileged reconciliation endpoint
router.post('/:paymentId/reconcile', reconcilePayment);

// Order cancellation endpoint
router.post('/orders/:orderId/cancel', cancelPendingOrder);

export default router;
