import { Router } from 'express';
import { handleRazorpayWebhook } from '../controllers/webhook.controller';
import { handleUpiWebhook } from '../controllers/payment.controller';

const router = Router();

// POST /api/v1/webhooks/razorpay (Platform SaaS Subscriptions & mandates)
router.post('/razorpay', handleRazorpayWebhook);

// POST /api/v1/webhooks/upi/:provider (Customer Food Orders direct UPI webhook)
router.post('/upi/:provider', handleUpiWebhook);
router.post('/upi', handleUpiWebhook);

export default router;
