import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireOwnerOrKitchen } from '../middlewares/rbac.middleware';
import {
  getKitchenOrders,
  updateKitchenOrderStatus,
  toggleKitchenOrderItemServed,
} from '../controllers/kitchen.controller';

const router = Router();

// Protect all kitchen routes
router.use(authenticate, requireOwnerOrKitchen);

router.get('/orders', getKitchenOrders);
router.patch('/orders/:id/status', updateKitchenOrderStatus);
router.patch('/orders/:orderId/items/:itemId/served', toggleKitchenOrderItemServed);

export default router;
