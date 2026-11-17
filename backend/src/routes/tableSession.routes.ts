import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireOwnerOrKitchen } from '../middlewares/rbac.middleware';
import {
  joinOrCreateSession,
  getActiveSession,
  getSessionById,
  addItemToBatch,
  removeItemFromBatch,
  submitCurrentBatch,
  updateBatchStatus,
  getSessionBill,
  closeTableSession,
  listActiveSessions,
  markSessionAsPaid,
  cancelTableSession,
} from '../controllers/tableSession.controller';
import {
  checkTableStatusAndAccess,
  getTableClearanceDashboard,
  clearTableManual,
} from '../controllers/tableClearance.controller';

const router = Router();

// Public / Customer Endpoints
router.post('/check-access', checkTableStatusAndAccess);
router.post('/join-or-create', joinOrCreateSession);
router.get('/active', getActiveSession);
router.get('/:sessionId', getSessionById);
router.get('/:sessionId/bill', getSessionBill);

// Customer Batch Items Management
router.post('/:sessionId/batches/items', addItemToBatch);
router.delete('/:sessionId/batches/items/:itemId', removeItemFromBatch);
router.post('/:sessionId/batches/submit', submitCurrentBatch);

// Staff Protected Endpoints (Waitstaff, Kitchen, Restaurant Owner)
router.get('/', authenticate, requireOwnerOrKitchen, listActiveSessions);
router.get('/clearance', authenticate, requireOwnerOrKitchen, getTableClearanceDashboard);
router.post('/clear', authenticate, requireOwnerOrKitchen, clearTableManual);
router.patch('/:sessionId/batches/:batchId/status', authenticate, requireOwnerOrKitchen, updateBatchStatus);
router.post('/:sessionId/close', authenticate, requireOwnerOrKitchen, closeTableSession);
router.post('/:sessionId/mark-paid', authenticate, requireOwnerOrKitchen, markSessionAsPaid);
router.post('/:sessionId/cancel', authenticate, requireOwnerOrKitchen, cancelTableSession);

export default router;

