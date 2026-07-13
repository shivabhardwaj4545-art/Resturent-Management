import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireOwner } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  restaurantProfileSchema,
  restaurantToggleSchema,
  menuCategorySchema,
  menuItemSchema,
  updateMenuItemSchema,
  couponSchema,
  updateOrderStatusSchema,
} from '@qr-restaurant/shared/schemas';
import {
  getDashboard,
  getRestaurant,
  updateRestaurant,
  toggleRestaurant,
  uploadLogo,
  uploadBanner,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  getMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleMenuItemAvailability,
  seedDemoMenu,
  getCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  toggleCoupon,
  getOrders,
  getOrderDetail,
  updateOrderStatus,
  confirmPayment,
  getAnalytics,
  signTable,
} from '../controllers/owner.controller';
import { upload } from '../services/cloudinary.service';

const router = Router();

// All owner routes require authentication + RESTAURANT_OWNER role
router.use(authenticate, requireOwner);

// Dashboard
router.get('/dashboard', getDashboard);

// Restaurant management
router.get('/restaurant', getRestaurant);
router.put('/restaurant', validate(restaurantProfileSchema), updateRestaurant);
router.patch('/restaurant/toggle', validate(restaurantToggleSchema), toggleRestaurant);
router.post('/restaurant/logo', upload.single('logo'), uploadLogo);
router.post('/restaurant/banner', upload.single('banner'), uploadBanner);
router.get('/restaurant/sign-table', signTable);

// Menu categories
router.get('/menu/categories', getCategories);
router.post('/menu/categories', validate(menuCategorySchema), createCategory);
router.put('/menu/categories/:id', validate(menuCategorySchema), updateCategory);
router.delete('/menu/categories/:id', deleteCategory);
router.put('/menu/categories/reorder', reorderCategories);

// Menu items
router.get('/menu/items', getMenuItems);
router.post('/menu/items', upload.single('image'), createMenuItem);
router.put('/menu/items/:id', upload.single('image'), updateMenuItem);
router.delete('/menu/items/:id', deleteMenuItem);
router.patch('/menu/items/:id/availability', toggleMenuItemAvailability);
router.post('/menu/seed-demo', seedDemoMenu);

// Coupons
router.get('/coupons', getCoupons);
router.post('/coupons', validate(couponSchema), createCoupon);
router.put('/coupons/:id', validate(couponSchema), updateCoupon);
router.delete('/coupons/:id', deleteCoupon);
router.patch('/coupons/:id/toggle', toggleCoupon);

// Orders
router.get('/orders', getOrders);
router.get('/orders/:id', getOrderDetail);
router.patch('/orders/:id/status', validate(updateOrderStatusSchema), updateOrderStatus);
router.patch('/orders/:id/payment', confirmPayment);

// Analytics
router.get('/analytics', getAnalytics);

export default router;
