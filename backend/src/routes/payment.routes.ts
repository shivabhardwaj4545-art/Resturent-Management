import { Router } from 'express';
import {
  createUpiIntent,
  getPaymentStatus,
  getOrderPaymentDetails,
  verifyAndConfirmPayment,
  handleUpiWebhook,
  reconcilePayment,
  cancelPendingOrder,
  createPaymentRefund,
  getRestaurantTransactions,
} from '../controllers/payment.controller';

const router = Router();

// Customer endpoint to generate UPI intent payment attempt (supports both styles)
router.post('/create-upi-intent', createUpiIntent);
router.post('/orders/:orderId/payment-attempts', createUpiIntent);

// Read-only endpoint to check server-side payment status
router.get('/:paymentId/status', getPaymentStatus);

// Fetch order payment details & attempts for existing order
router.get('/orders/:orderId', getOrderPaymentDetails);
router.get('/orders/:orderId/payment', getOrderPaymentDetails);

// Server-side verification & webhook endpoint
router.post('/verify-upi', verifyAndConfirmPayment);
router.post('/webhook', handleUpiWebhook);
router.post('/webhooks/upi/:provider', handleUpiWebhook);

// Privileged reconciliation & refund endpoints
router.post('/:paymentId/reconcile', reconcilePayment);
router.post('/:paymentId/refund', createPaymentRefund);
router.get('/restaurants/:restaurantId/transactions', getRestaurantTransactions);

// Order cancellation endpoint
router.post('/orders/:orderId/cancel', cancelPendingOrder);

export default router;
