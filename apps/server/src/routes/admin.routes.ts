import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/rbac.middleware';
import {
  getAllRestaurants,
  approveRestaurant,
  suspendRestaurant,
  createRestaurant,
  getAllUsers,
  suspendUser,
  getGlobalAnalytics,
  getConfig,
  updateConfig,
  getSubscriptionPlans,
  createSubscriptionPlan,
  getAdminCoupons,
  createAdminCoupon,
  deleteAdminCoupon,
  toggleAdminCoupon,
} from '../controllers/admin.controller';

const router = Router();

router.use(authenticate, requireAdmin);

// Restaurant management
router.get('/restaurants', getAllRestaurants);
router.post('/restaurants', createRestaurant);
router.patch('/restaurants/:id/approve', approveRestaurant);
router.patch('/restaurants/:id/suspend', suspendRestaurant);

// User management
router.get('/users', getAllUsers);
router.patch('/users/:id/suspend', suspendUser);

// Global analytics
router.get('/analytics', getGlobalAnalytics);

// Configuration
router.get('/config', getConfig);
router.put('/config', updateConfig);

// Subscriptions
router.get('/subscriptions', getSubscriptionPlans);
router.post('/subscriptions', createSubscriptionPlan);

// Coupons
router.get('/coupons', getAdminCoupons);
router.post('/coupons', createAdminCoupon);
router.delete('/coupons/:id', deleteAdminCoupon);
router.patch('/coupons/:id/toggle', toggleAdminCoupon);

export default router;
