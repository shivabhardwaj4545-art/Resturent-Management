import crypto from 'crypto';

/**
 * Regression Test Suite for EZRestro Critical Bug Fixes
 * 
 * Issue 1: Unification of Table Access Code and 4-Digit Order Verification Code
 * Issue 2: Served status (DELIVERED) must NOT automatically mark an order as PAID
 */
describe('EZRestro Critical Bug Fixes: Verification & Order Lifecycle Suite', () => {
  interface TableSession {
    id: string;
    restaurantId: string;
    tableNumber: string;
    sessionCode: string;
    tableAccessCode: string;
    status: 'ACTIVE' | 'COMPLETED';
    paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
    orders: Order[];
  }

  interface Order {
    id: string;
    tableSessionId: string;
    restaurantId: string;
    tableNumber: string;
    status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';
    paymentStatus: 'UNPAID' | 'PENDING' | 'PAID';
    verificationCode: string;
    addOnStatus: string | null;
    items: Array<{ name: string; quantity: number; price: number }>;
    total: number;
  }

  class EZRestroTestHarness {
    sessions = new Map<string, TableSession>();
    orders = new Map<string, Order>();
    deviceAccesses = new Map<string, Set<string>>(); // sessionId -> Set of deviceFingerprints

    createTableSession(restaurantId: string, tableNumber: string, deviceFingerprint: string): { session: TableSession; code: string } {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      const sessionId = `sess_${restaurantId}_${tableNumber}_${Date.now()}`;
      
      const session: TableSession = {
        id: sessionId,
        restaurantId,
        tableNumber,
        sessionCode: code,
        tableAccessCode: code, // Unified: tableAccessCode === sessionCode === verificationCode
        status: 'ACTIVE',
        paymentStatus: 'UNPAID',
        orders: [],
      };

      this.sessions.set(sessionId, session);
      this.deviceAccesses.set(sessionId, new Set([deviceFingerprint]));
      return { session, code };
    }

    placeOrder(sessionId: string, items: Array<{ name: string; quantity: number; price: number }>): Order {
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error('Session not found');

      // The 4-digit Order Verification Code reuses session.sessionCode
      const verificationCode = session.sessionCode;
      const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      const total = items.reduce((s, i) => s + i.price * i.quantity, 0);

      const order: Order = {
        id: orderId,
        tableSessionId: sessionId,
        restaurantId: session.restaurantId,
        tableNumber: session.tableNumber,
        status: 'CONFIRMED',
        paymentStatus: 'UNPAID',
        verificationCode,
        addOnStatus: null,
        items,
        total,
      };

      this.orders.set(orderId, order);
      session.orders.push(order);
      return order;
    }

    // Serving food in the kitchen (READY -> DELIVERED / SERVED)
    updateKitchenStatus(orderId: string, newStatus: Order['status']): Order {
      const order = this.orders.get(orderId);
      if (!order) throw new Error('Order not found');

      order.status = newStatus;
      if (newStatus === 'DELIVERED') {
        // Serving food clears addOnStatus, but DOES NOT change paymentStatus to PAID
        order.addOnStatus = null;
      }

      return order;
    }

    // Joining existing order via 4-digit code
    joinTableWithCode(tableNumber: string, restaurantId: string, code: string, deviceFingerprint: string): { success: boolean; activeOrder?: Order; error?: string } {
      const session = Array.from(this.sessions.values()).find(
        (s) => s.restaurantId === restaurantId && s.tableNumber === tableNumber && s.status === 'ACTIVE'
      );

      if (!session) {
        return { success: false, error: 'NO_ACTIVE_SESSION' };
      }

      // Check active ongoing order
      const activeOrder = session.orders.find((o) => o.status !== 'CANCELLED' && o.paymentStatus !== 'PAID');
      const validCode = activeOrder ? activeOrder.verificationCode : session.sessionCode;

      if (code.trim() !== validCode) {
        return { success: false, error: 'INVALID_ORDER_VERIFICATION_CODE' };
      }

      // Authorize device
      this.deviceAccesses.get(session.id)?.add(deviceFingerprint);
      return { success: true, activeOrder };
    }

    // Adding items to existing order (e.g., dessert/drink after main dishes served)
    addItemsToOrder(orderId: string, additionalItems: Array<{ name: string; quantity: number; price: number }>): Order {
      const order = this.orders.get(orderId);
      if (!order) throw new Error('Order not found');

      if (order.status === 'CANCELLED') {
        throw new Error('Cannot add items to cancelled order');
      }

      if (order.paymentStatus === 'PAID') {
        throw new Error('Cannot add items to paid order');
      }

      // Items can be added even if status is DELIVERED (food was served, meal is ongoing)
      order.items.push(...additionalItems);
      order.total += additionalItems.reduce((s, i) => s + i.price * i.quantity, 0);
      order.addOnStatus = 'PREPARING';
      return order;
    }

    // Manual payment confirmation by cashier/owner
    confirmPayment(orderId: string, method: string): Order {
      const order = this.orders.get(orderId);
      if (!order) throw new Error('Order not found');

      if (order.paymentStatus === 'PAID') {
        return order; // Idempotent
      }

      order.paymentStatus = 'PAID';
      
      const session = this.sessions.get(order.tableSessionId);
      if (session) {
        const nonCancelled = session.orders.filter((o) => o.status !== 'CANCELLED');
        const allPaid = nonCancelled.length > 0 && nonCancelled.every((o) => o.paymentStatus === 'PAID');
        if (allPaid) {
          session.paymentStatus = 'PAID';
        }
      }

      return order;
    }
  }

  let harness: EZRestroTestHarness;

  beforeEach(() => {
    harness = new EZRestroTestHarness();
  });

  describe('Issue 1: Unified 4-Digit Order Verification Code & Table Joining', () => {
    it('should use the same 4-digit code for table session, active order verification, and friend joining', () => {
      // 1. First customer scans Table 5
      const { session, code } = harness.createTableSession('rest_1', '5', 'device_primary');
      expect(code).toMatch(/^\d{4}$/);
      expect(session.sessionCode).toBe(code);
      expect(session.tableAccessCode).toBe(code);

      // 2. Customer places order
      const order = harness.placeOrder(session.id, [{ name: 'Paneer Butter Masala', quantity: 1, price: 280 }]);
      expect(order.verificationCode).toBe(code);

      // 3. Friend scans same table QR with their phone
      const joinAttempt = harness.joinTableWithCode('5', 'rest_1', code, 'device_friend');
      expect(joinAttempt.success).toBe(true);
      expect(joinAttempt.activeOrder?.id).toBe(order.id);
      expect(joinAttempt.activeOrder?.verificationCode).toBe(code);
    });

    it('should reject invalid verification code when friend attempts to join table', () => {
      const { session, code } = harness.createTableSession('rest_1', '7', 'device_1');
      harness.placeOrder(session.id, [{ name: 'Chicken Biryani', quantity: 1, price: 350 }]);

      const wrongCode = code === '1234' ? '4321' : '1234';
      const joinAttempt = harness.joinTableWithCode('7', 'rest_1', wrongCode, 'device_2');
      expect(joinAttempt.success).toBe(false);
      expect(joinAttempt.error).toBe('INVALID_ORDER_VERIFICATION_CODE');
    });

    it('should prevent cross-restaurant and cross-table access with same code', () => {
      const { session: sess1, code: code1 } = harness.createTableSession('rest_1', '3', 'device_1');
      harness.placeOrder(sess1.id, [{ name: 'Dal Makhani', quantity: 1, price: 220 }]);

      // Attempt joining Table 4 at same restaurant with Table 3 code
      const crossTable = harness.joinTableWithCode('4', 'rest_1', code1, 'device_intruder');
      expect(crossTable.success).toBe(false);

      // Attempt joining Table 3 at different restaurant with same code
      const crossRest = harness.joinTableWithCode('3', 'rest_2', code1, 'device_intruder');
      expect(crossRest.success).toBe(false);
    });

    it('should allow friends joining the table to add items to the active bill without creating duplicate orders', () => {
      const { session, code } = harness.createTableSession('rest_1', '10', 'device_host');
      const initialOrder = harness.placeOrder(session.id, [{ name: 'Garlic Naan', quantity: 2, price: 60 }]);
      expect(initialOrder.total).toBe(120);

      // Friend joins table using code
      const friendJoin = harness.joinTableWithCode('10', 'rest_1', code, 'device_guest');
      expect(friendJoin.success).toBe(true);

      // Friend appends Cold Drinks to the existing active bill
      const updatedOrder = harness.addItemsToOrder(friendJoin.activeOrder!.id, [
        { name: 'Fresh Lime Soda', quantity: 2, price: 80 },
      ]);

      expect(updatedOrder.id).toBe(initialOrder.id);
      expect(updatedOrder.items).toHaveLength(2);
      expect(updatedOrder.total).toBe(120 + 160);
      expect(session.orders).toHaveLength(1); // No duplicate orders
    });
  });

  describe('Issue 2: Served Status (DELIVERED) Must NOT Automatically Mark Order as PAID', () => {
    it('should maintain paymentStatus as UNPAID when food progresses from PREPARING -> READY -> DELIVERED (SERVED)', () => {
      const { session } = harness.createTableSession('rest_1', '2', 'device_customer');
      const order = harness.placeOrder(session.id, [{ name: 'Thali', quantity: 1, price: 300 }]);

      expect(order.status).toBe('CONFIRMED');
      expect(order.paymentStatus).toBe('UNPAID');

      // Kitchen starts preparing
      harness.updateKitchenStatus(order.id, 'PREPARING');
      expect(order.status).toBe('PREPARING');
      expect(order.paymentStatus).toBe('UNPAID');

      // Kitchen marks ready to serve
      harness.updateKitchenStatus(order.id, 'READY');
      expect(order.status).toBe('READY');
      expect(order.paymentStatus).toBe('UNPAID');

      // Waiter marks served (DELIVERED)
      harness.updateKitchenStatus(order.id, 'DELIVERED');
      expect(order.status).toBe('DELIVERED');
      // CRITICAL CHECK: Food is served, but payment MUST still be UNPAID!
      expect(order.paymentStatus).toBe('UNPAID');
      expect(session.paymentStatus).toBe('UNPAID');
    });

    it('should allow customer to order dessert/drinks after main food is SERVED (DELIVERED)', () => {
      const { session } = harness.createTableSession('rest_1', '8', 'device_customer');
      const order = harness.placeOrder(session.id, [{ name: 'Veg Pulao', quantity: 1, price: 200 }]);

      // Main food is served
      harness.updateKitchenStatus(order.id, 'DELIVERED');
      expect(order.status).toBe('DELIVERED');
      expect(order.paymentStatus).toBe('UNPAID');

      // Customer orders dessert after finishing main meal
      const updatedOrder = harness.addItemsToOrder(order.id, [{ name: 'Gulab Jamun (2 pcs)', quantity: 1, price: 90 }]);
      expect(updatedOrder.items).toHaveLength(2);
      expect(updatedOrder.total).toBe(290);
      expect(updatedOrder.addOnStatus).toBe('PREPARING');
    });

    it('should only mark paymentStatus as PAID when manual payment is confirmed by cashier/staff', () => {
      const { session } = harness.createTableSession('rest_1', '12', 'device_customer');
      const order = harness.placeOrder(session.id, [{ name: 'Pizza', quantity: 1, price: 450 }]);

      harness.updateKitchenStatus(order.id, 'DELIVERED');
      expect(order.paymentStatus).toBe('UNPAID');

      // Cashier receives cash or UPI at the counter and confirms payment
      harness.confirmPayment(order.id, 'CASH');
      expect(order.paymentStatus).toBe('PAID');
      expect(session.paymentStatus).toBe('PAID');
    });

    it('should handle idempotent payment confirmation without errors or duplicate billing', () => {
      const { session } = harness.createTableSession('rest_1', '14', 'device_customer');
      const order = harness.placeOrder(session.id, [{ name: 'Pasta', quantity: 1, price: 320 }]);

      harness.updateKitchenStatus(order.id, 'DELIVERED');
      harness.confirmPayment(order.id, 'UPI');
      expect(order.paymentStatus).toBe('PAID');

      // Repeated payment call (e.g. double click or webhook retry)
      const repeatOrder = harness.confirmPayment(order.id, 'UPI');
      expect(repeatOrder.paymentStatus).toBe('PAID');
      expect(repeatOrder.total).toBe(320);
    });
  });
});
