import { Router } from 'express';
import {
  getSaasPlans,
  createSaasSubscription,
  verifySaasSubscription,
  getCurrentSubscription,
  cancelSaasSubscription,
} from '../controllers/saas.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Public / Authenticated plans query
router.get('/plans', getSaasPlans);

// Authenticated Restaurant Owner Subscription Management
router.post('/subscriptions', authenticate, createSaasSubscription);
router.post('/subscriptions/verify', authenticate, verifySaasSubscription);
router.get('/subscriptions/current', authenticate, getCurrentSubscription);
router.post('/subscriptions/:id/cancel', authenticate, cancelSaasSubscription);

export default router;

