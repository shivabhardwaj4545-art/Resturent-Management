import { Router } from 'express';
import { authenticate, optionalAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { guestCheckoutSchema, userCheckoutSchema, razorpayVerifySchema } from '@qr-restaurant/shared/schemas';
import {
  placeGuestOrder,
  placeOrder,
  getOrderById,
  getUserOrders,
  verifyPayment,
  reorder,
  createDirectOrder,
} from '../controllers/order.controller';

const router = Router();

router.get('/razorpay-key', (req, res) => {
  res.json({ success: true, data: { keyId: process.env.RAZORPAY_KEY_ID ?? '' } });
});

router.post('/guest', validate(guestCheckoutSchema), placeGuestOrder);
router.post('/', authenticate, validate(userCheckoutSchema), placeOrder);
router.get('/', authenticate, getUserOrders);
router.get('/:orderId', optionalAuth, getOrderById);
router.post('/verify-payment', optionalAuth, validate(razorpayVerifySchema), verifyPayment);
router.post('/create-order', optionalAuth, createDirectOrder);
router.post('/:orderId/reorder', authenticate, reorder);

export default router;
