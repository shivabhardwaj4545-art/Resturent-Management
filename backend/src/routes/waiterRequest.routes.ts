import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireOwnerOrKitchen } from '../middlewares/rbac.middleware';
import {
  createWaiterRequest,
  listWaiterRequests,
  acknowledgeWaiterRequest,
  resolveWaiterRequest,
  clearTableFromWaiterRequest,
} from '../controllers/waiterRequest.controller';

const router = Router();

// Public / Customer endpoint to call waiter
router.post('/', createWaiterRequest);

// Owner / Kitchen staff management endpoints
router.get('/', authenticate, requireOwnerOrKitchen, listWaiterRequests);
router.patch('/:requestId/acknowledge', authenticate, requireOwnerOrKitchen, acknowledgeWaiterRequest);
router.patch('/:requestId/resolve', authenticate, requireOwnerOrKitchen, resolveWaiterRequest);
router.post('/:requestId/clear-table', authenticate, requireOwnerOrKitchen, clearTableFromWaiterRequest);

export default router;
