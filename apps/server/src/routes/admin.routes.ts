import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/rbac.middleware';
import {
  getAllRestaurants,
  approveRestaurant,
  suspendRestaurant,
  createRestaurant,
  deleteRestaurant,
  getAllUsers,
  suspendUser,
  deleteUser,
  getGlobalAnalytics,
  getConfig,
  updateConfig,
  getSubscriptionPlans,
  createSubscriptionPlan,
  getAdminCoupons,
  createAdminCoupon,
  deleteAdminCoupon,
  toggleAdminCoupon,
  broadcastNotification,
  broadcastEmail,
  getAdminReviews,
  getLoyaltySettings,
  updateLoyaltySettings,
} from '../controllers/admin.controller';

const router = Router();

router.use(authenticate, requireAdmin);

// Restaurant management
router.get('/restaurants', getAllRestaurants);
router.post('/restaurants', createRestaurant);
router.patch('/restaurants/:id/approve', approveRestaurant);
router.patch('/restaurants/:id/suspend', suspendRestaurant);
router.delete('/restaurants/:id', deleteRestaurant);

// User management
router.get('/users', getAllUsers);
router.patch('/users/:id/suspend', suspendUser);
router.delete('/users/:id', deleteUser);

// Global analytics
router.get('/analytics', getGlobalAnalytics);

// Configuration
router.get('/config', getConfig);
router.put('/config', updateConfig);

// Loyalty Program Settings
router.get('/loyalty-settings', getLoyaltySettings as any);
router.put('/loyalty-settings', updateLoyaltySettings as any);

// Subscriptions
router.get('/subscriptions', getSubscriptionPlans);
router.post('/subscriptions', createSubscriptionPlan);

// Coupons
router.get('/coupons', getAdminCoupons);
router.post('/coupons', createAdminCoupon);
router.delete('/coupons/:id', deleteAdminCoupon);
router.patch('/coupons/:id/toggle', toggleAdminCoupon);

// Broadcasts
router.post('/broadcast-notification', broadcastNotification);
router.post('/broadcast-email', broadcastEmail);

// Reviews
router.get('/reviews', getAdminReviews);

export default router;
