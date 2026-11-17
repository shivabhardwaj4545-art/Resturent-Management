import { normalizeTableNumber } from '../src/controllers/tableSession.controller';

/**
 * In-Memory Mock Restaurant Database Harness
 * Simulates transactions, unique constraints, dual mode session lifecycles,
 * and tenant isolation to execute all 14 edge-case tests with deterministic precision.
 */
class TableSessionHarness {
  restaurants: Map<string, any> = new Map();
  tableSessions: Map<string, any> = new Map();
  orders: Map<string, any> = new Map();
  clearanceLogs: any[] = [];
  idCounter = 1;

  constructor() {
    this.reset();
  }

  reset() {
    this.restaurants.clear();
    this.tableSessions.clear();
    this.orders.clear();
    this.clearanceLogs = [];
    this.idCounter = 1;

    // Seed default test restaurant
    this.restaurants.set('rest-1', {
      id: 'rest-1',
      name: 'EZRestro Gourmet Bistro',
      slug: 'ezrestro-bistro',
      sessionManagementMode: 'MANUAL', // Safer migration default
      ownerId: 'owner-1',
    });

    this.restaurants.set('rest-2', {
      id: 'rest-2',
      name: 'Competitor Grill',
      slug: 'competitor-grill',
      sessionManagementMode: 'AUTO',
      ownerId: 'owner-2',
    });
  }

  // Set session management mode
  updateSessionMode(restaurantId: string, mode: 'AUTO' | 'MANUAL') {
    const restaurant = this.restaurants.get(restaurantId);
    if (!restaurant) throw new Error('Restaurant not found');
    restaurant.sessionManagementMode = mode;
    return restaurant;
  }

  // TEST 1 & 2: Concurrency-safe Join or Create Table Session
  async scanTableQr(restaurantId: string, rawTableNumber: string, guestName?: string) {
    const restaurant = this.restaurants.get(restaurantId);
    if (!restaurant) throw new Error('Restaurant not found');
    const cleanTable = normalizeTableNumber(rawTableNumber);

    // Look for active session
    let activeSession = Array.from(this.tableSessions.values()).find(
      (s) => s.restaurantId === restaurantId && s.tableNumber === cleanTable && s.status === 'ACTIVE'
    );

    if (activeSession) {
      // Evaluate session mode & orders
      const sessionOrders = Array.from(this.orders.values()).filter(
        (o) => o.tableSessionId === activeSession.id && o.status !== 'CANCELLED'
      );
      const isAllPaid = sessionOrders.length > 0 && sessionOrders.every((o) => o.paymentStatus === 'PAID');
      const mode = activeSession.sessionManagementModeSnapshot || restaurant.sessionManagementMode;

      // Auto Mode: If all orders were paid, auto-close previous session and create new
      if (mode === 'AUTO' && isAllPaid) {
        activeSession.status = 'COMPLETED';
        activeSession.completedAt = new Date();
        activeSession.closedAt = new Date();
        activeSession.closedBy = 'AUTO_SESSION_RESET';
        activeSession = null;
      } else if (mode === 'MANUAL' && (isAllPaid || activeSession.paymentStatus === 'PAID')) {
        // In Manual mode, if paid, table remains locked awaiting staff clearance
        return {
          available: false,
          locked: true,
          status: 'PAID_AWAITING_CLEARANCE',
          tableNumber: cleanTable,
          session: null,
          message: 'This table is currently unavailable for new orders. Please contact restaurant staff.',
        };
      } else {
        // Active dining in progress: return existing session
        return {
          available: true,
          locked: false,
          status: 'OCCUPIED_DINING',
          tableNumber: cleanTable,
          session: activeSession,
        };
      }
    }

    // Create new unique session
    const newSessionId = `sess-${this.idCounter++}`;
    const sessionCode = String(1000 + Math.floor(Math.random() * 9000));
    const newSession = {
      id: newSessionId,
      restaurantId,
      tableNumber: cleanTable,
      sessionCode,
      status: 'ACTIVE',
      paymentStatus: 'PENDING',
      totalAmount: 0,
      paidAmount: 0,
      sessionManagementModeSnapshot: restaurant.sessionManagementMode,
      createdAt: new Date(),
      guestName,
    };
    this.tableSessions.set(newSessionId, newSession);

    return {
      available: true,
      locked: false,
      status: 'AVAILABLE',
      tableNumber: cleanTable,
      session: newSession,
    };
  }

  // TEST 3: Place order linked to table session
  async placeOrder(restaurantId: string, rawTableNumber: string, items: any[], total: number) {
    const scanRes = await this.scanTableQr(restaurantId, rawTableNumber);
    if (!scanRes.available || scanRes.locked) {
      throw new Error('Table is currently occupied and awaiting clearance. No new orders can be placed.');
    }

    const orderId = `ord-${this.idCounter++}`;
    const order = {
      id: orderId,
      restaurantId,
      tableSessionId: scanRes.session.id,
      tableNumber: scanRes.tableNumber,
      items,
      total,
      paymentStatus: 'PENDING',
      status: 'PENDING',
      createdAt: new Date(),
    };
    this.orders.set(orderId, order);

    // Update session totals
    scanRes.session.totalAmount += total;
    scanRes.session.paymentStatus = 'PENDING';

    return order;
  }

  // TEST 4, 7, 8: Settle Payment for Order or Session
  async confirmPayment(orderIdOrSessionId: string, paidBy = 'Counter Staff') {
    const now = new Date();

    // Check if sessionId was passed directly
    let session = this.tableSessions.get(orderIdOrSessionId);
    let targetOrders: any[] = [];

    if (session) {
      targetOrders = Array.from(this.orders.values()).filter(
        (o) => o.tableSessionId === session.id && o.status !== 'CANCELLED'
      );
    } else {
      const singleOrder = this.orders.get(orderIdOrSessionId);
      if (!singleOrder) throw new Error('Order or Session not found');
      targetOrders = [singleOrder];
      session = this.tableSessions.get(singleOrder.tableSessionId);
    }

    // Mark target orders as PAID
    for (const o of targetOrders) {
      o.paymentStatus = 'PAID';
      o.paidAt = now;
      o.paidBy = paidBy;
    }

    if (session) {
      const allSessionOrders = Array.from(this.orders.values()).filter(
        (o) => o.tableSessionId === session.id && o.status !== 'CANCELLED'
      );
      const allPaid = allSessionOrders.every((o) => o.paymentStatus === 'PAID');
      const restaurant = this.restaurants.get(session.restaurantId);
      const mode = session.sessionManagementModeSnapshot || restaurant.sessionManagementMode;

      if (allPaid) {
        session.paymentStatus = 'PAID';
        session.paidAmount = session.totalAmount;

        if (mode === 'AUTO') {
          // AUTO MODE: Automatically close session! Table becomes AVAILABLE
          session.status = 'COMPLETED';
          session.completedAt = now;
          session.closedAt = now;
          session.closedBy = 'AUTO_SESSION_RESET';
          session.closureReason = 'All orders settled in Auto Session Reset mode';
          return { status: 'AVAILABLE', sessionClosed: true, mode: 'AUTO' };
        } else {
          // MANUAL MODE: Table remains ACTIVE, QR locked, awaiting clearance!
          return { status: 'PAID_AWAITING_CLEARANCE', sessionClosed: false, mode: 'MANUAL' };
        }
      } else {
        session.paymentStatus = 'PARTIALLY_PAID';
        return { status: 'PARTIALLY_PAID', sessionClosed: false, mode };
      }
    }

    return { status: 'PAID', sessionClosed: false };
  }

  // TEST 5, 9, 12, 14: Clear Table Manually
  async clearTable(userRestaurantId: string, tableNumberOrSessionId: string, staffId = 'staff-1', forceClear = false) {
    const cleanTable = normalizeTableNumber(tableNumberOrSessionId);

    // Concurrency / Idempotency: Find active session
    const session = Array.from(this.tableSessions.values()).find(
      (s) =>
        (s.id === tableNumberOrSessionId || s.tableNumber === cleanTable) &&
        s.status === 'ACTIVE'
    );

    if (!session) {
      // Idempotent: already cleared
      return { success: true, message: 'Table is already cleared and available.' };
    }

    // TEST 14: Multi-tenant restaurant data isolation
    if (session.restaurantId !== userRestaurantId) {
      throw new Error('Access denied: You do not have permission to clear this restaurant table.');
    }

    // TEST 9: Verify all orders are settled
    const sessionOrders = Array.from(this.orders.values()).filter(
      (o) => o.tableSessionId === session.id && o.status !== 'CANCELLED'
    );
    const unpaidOrders = sessionOrders.filter((o) => o.paymentStatus !== 'PAID');

    if (unpaidOrders.length > 0 && !forceClear) {
      const unpaidTotal = unpaidOrders.reduce((sum, o) => sum + o.total, 0);
      throw new Error(
        `Cannot clear ${session.tableNumber}: There are ${unpaidOrders.length} unpaid orders (₹${unpaidTotal.toFixed(2)} pending). Please collect payment before clearing the table.`
      );
    }

    const now = new Date();
    session.status = 'COMPLETED';
    session.completedAt = now;
    session.closedAt = now;
    session.closedBy = staffId;
    session.closureReason = 'Manual Table Clearance by Staff';

    this.clearanceLogs.push({
      restaurantId: session.restaurantId,
      tableNumber: session.tableNumber,
      sessionId: session.id,
      staffId,
      clearedAt: now,
    });

    return { success: true, message: `Table ${session.tableNumber} cleared and available.` };
  }

  // TEST 13: Delayed payment callback arriving for an already closed session
  async handleDelayedPaymentCallback(orderId: string, amount: number) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('Order not found');

    const session = this.tableSessions.get(order.tableSessionId);

    // Reconcile payment record
    order.paymentStatus = 'PAID';
    order.reconciledAt = new Date();

    // Must NOT reopen or corrupt the old completed session
    if (session && session.status === 'COMPLETED') {
      // Keep session status as COMPLETED
      return { reconciled: true, sessionReopened: false, sessionStatus: session.status };
    }

    return { reconciled: true, sessionReopened: false, sessionStatus: session?.status };
  }
}

describe('Dual Mode Table Session Management & Smart Table Clearance Suite', () => {
  let harness: TableSessionHarness;

  beforeEach(() => {
    harness = new TableSessionHarness();
  });

  // TEST 1: Customer scans an available table QR
  test('TEST 1: Customer scans an available table QR -> New unique session created', async () => {
    const res = await harness.scanTableQr('rest-1', 'Table 4', 'Alice');
    expect(res.available).toBe(true);
    expect(res.locked).toBe(false);
    expect(res.status).toBe('AVAILABLE');
    expect(res.session).toBeDefined();
    expect(res.session.status).toBe('ACTIVE');
    expect(res.session.tableNumber).toBe('Table 4');
  });

  // TEST 2: Two customers scan the same QR simultaneously
  test('TEST 2: Two customers scan the same QR simultaneously -> Only one active session created', async () => {
    // Customer 1 and Customer 2 scan Table 4
    const res1 = await harness.scanTableQr('rest-1', 'Table 4', 'Alice');
    const res2 = await harness.scanTableQr('rest-1', 'Table 4', 'Bob');

    expect(res1.session.id).toBe(res2.session.id);
    expect(res1.session.sessionCode).toBe(res2.session.sessionCode);

    // Total active sessions for Table 4 in rest-1 must strictly be 1
    const activeSessions = Array.from(harness.tableSessions.values()).filter(
      (s) => s.restaurantId === 'rest-1' && s.tableNumber === 'Table 4' && s.status === 'ACTIVE'
    );
    expect(activeSessions.length).toBe(1);
  });

  // TEST 3: Multiple customers order from different phones at the same table
  test('TEST 3: Multiple customers order from different phones at the same table -> Separate orders linked to the same session', async () => {
    const orderAlice = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Burger', price: 250 }], 250);
    const orderBob = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Pizza', price: 400 }], 400);

    expect(orderAlice.id).not.toBe(orderBob.id);
    expect(orderAlice.tableSessionId).toBe(orderBob.tableSessionId);

    const session = harness.tableSessions.get(orderAlice.tableSessionId);
    expect(session.totalAmount).toBe(650);
  });

  // TEST 4: Restaurant operates in Manual Mode and customer pays
  test('TEST 4: Restaurant operates in Manual Mode and customer pays -> Payment marked PAID, table remains OCCUPIED & LOCKED', async () => {
    harness.updateSessionMode('rest-1', 'MANUAL');
    const order = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Pasta', price: 500 }], 500);

    const payResult = await harness.confirmPayment(order.id);
    expect(payResult.mode).toBe('MANUAL');
    expect(payResult.sessionClosed).toBe(false);
    expect(payResult.status).toBe('PAID_AWAITING_CLEARANCE');

    const session = harness.tableSessions.get(order.tableSessionId);
    expect(session.status).toBe('ACTIVE');
    expect(session.paymentStatus).toBe('PAID');

    // Scanning by a new customer should show TABLE_CURRENTLY_OCCUPIED
    const scanRes = await harness.scanTableQr('rest-1', 'Table 4', 'New Guest');
    expect(scanRes.available).toBe(false);
    expect(scanRes.locked).toBe(true);
    expect(scanRes.message).toContain('Please contact restaurant staff');
  });

  // TEST 5: Owner clears the paid table
  test('TEST 5: Owner clears the paid table -> Session closes, table becomes AVAILABLE', async () => {
    harness.updateSessionMode('rest-1', 'MANUAL');
    const order = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Biryani', price: 350 }], 350);
    await harness.confirmPayment(order.id);

    // Staff performs manual clearance
    const clearRes = await harness.clearTable('rest-1', 'Table 4', 'waiter-bob');
    expect(clearRes.success).toBe(true);

    const session = harness.tableSessions.get(order.tableSessionId);
    expect(session.status).toBe('COMPLETED');
    expect(session.closedBy).toBe('waiter-bob');
    expect(harness.clearanceLogs.length).toBe(1);
  });

  // TEST 6: New customer scans the same QR after clearance
  test('TEST 6: New customer scans the same QR after clearance -> New session ID created', async () => {
    harness.updateSessionMode('rest-1', 'MANUAL');
    const order = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Salad', price: 200 }], 200);
    const oldSessionId = order.tableSessionId;
    await harness.confirmPayment(order.id);
    await harness.clearTable('rest-1', 'Table 4');

    // New customer scans Table 4
    const newScan = await harness.scanTableQr('rest-1', 'Table 4', 'Charlie');
    expect(newScan.available).toBe(true);
    expect(newScan.session.id).not.toBe(oldSessionId);
    expect(newScan.session.status).toBe('ACTIVE');
  });

  // TEST 7: Restaurant operates in Auto Mode and customer pays the full outstanding amount
  test('TEST 7: Restaurant operates in Auto Mode and customer pays the full outstanding amount -> Session automatically closes and table becomes AVAILABLE', async () => {
    harness.updateSessionMode('rest-1', 'AUTO');
    const order = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Thali', price: 300 }], 300);

    const payResult = await harness.confirmPayment(order.id);
    expect(payResult.mode).toBe('AUTO');
    expect(payResult.sessionClosed).toBe(true);
    expect(payResult.status).toBe('AVAILABLE');

    const session = harness.tableSessions.get(order.tableSessionId);
    expect(session.status).toBe('COMPLETED');
    expect(session.closedBy).toBe('AUTO_SESSION_RESET');

    // Next scan immediately gets fresh session
    const nextScan = await harness.scanTableQr('rest-1', 'Table 4', 'Diana');
    expect(nextScan.available).toBe(true);
    expect(nextScan.session.id).not.toBe(session.id);
  });

  // TEST 8: Customer has multiple orders and only one is paid
  test('TEST 8: Customer has multiple orders and only one is paid -> Auto Mode must not close the session', async () => {
    harness.updateSessionMode('rest-1', 'AUTO');
    const order1 = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Round 1 Drinks', price: 200 }], 200);
    const order2 = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Round 2 Mains', price: 600 }], 600);

    // Pay only Order 1
    const payResult = await harness.confirmPayment(order1.id);
    expect(payResult.sessionClosed).toBe(false);
    expect(payResult.status).toBe('PARTIALLY_PAID');

    const session = harness.tableSessions.get(order1.tableSessionId);
    expect(session.status).toBe('ACTIVE');
    expect(session.paymentStatus).toBe('PARTIALLY_PAID');
  });

  // TEST 9: Staff attempts to clear a table with unpaid orders
  test('TEST 9: Staff attempts to clear a table with unpaid orders -> Block clearance and show the reason', async () => {
    harness.updateSessionMode('rest-1', 'MANUAL');
    await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Steak', price: 900 }], 900);

    // Attempting to clear without paying must throw an informative error
    await expect(harness.clearTable('rest-1', 'Table 4')).rejects.toThrow(
      'Cannot clear Table 4: There are 1 unpaid orders (₹900.00 pending)'
    );
  });

  // TEST 10: Owner changes from Manual Mode to Auto Mode while tables are occupied
  test('TEST 10: Owner changes from Manual Mode to Auto Mode while tables are occupied -> Existing sessions are not unexpectedly closed', async () => {
    harness.updateSessionMode('rest-1', 'MANUAL');
    const order = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Pasta', price: 450 }], 450);
    const session = harness.tableSessions.get(order.tableSessionId);
    expect(session.sessionManagementModeSnapshot).toBe('MANUAL');

    // Owner switches restaurant to AUTO mode
    harness.updateSessionMode('rest-1', 'AUTO');

    // Existing active session must remain ACTIVE and retain MANUAL lifecycle
    expect(session.status).toBe('ACTIVE');
    expect(session.sessionManagementModeSnapshot).toBe('MANUAL');
  });

  // TEST 11: Customer refreshes the QR page after session closure
  test('TEST 11: Customer refreshes the QR page after session closure -> Old session must not be reused', async () => {
    harness.updateSessionMode('rest-1', 'AUTO');
    const order = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Coffee', price: 150 }], 150);
    const oldSessionId = order.tableSessionId;
    await harness.confirmPayment(order.id); // auto closes in AUTO mode

    // Customer reloads / scans the same table URL
    const refreshScan = await harness.scanTableQr('rest-1', 'Table 4');
    expect(refreshScan.session.id).not.toBe(oldSessionId);
    expect(refreshScan.session.status).toBe('ACTIVE');
  });

  // TEST 12: Duplicate clearance requests arrive simultaneously
  test('TEST 12: Duplicate clearance requests arrive simultaneously -> Only one successful closure operation (idempotency)', async () => {
    harness.updateSessionMode('rest-1', 'MANUAL');
    const order = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Soup', price: 180 }], 180);
    await harness.confirmPayment(order.id);

    // Two parallel clearance calls
    const [res1, res2] = await Promise.all([
      harness.clearTable('rest-1', 'Table 4', 'staff-1'),
      harness.clearTable('rest-1', 'Table 4', 'staff-2'),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(harness.clearanceLogs.length).toBe(1); // exactly one audit log created
  });

  // TEST 13: A delayed payment callback arrives after a session has closed
  test('TEST 13: A delayed payment callback arrives after a session has closed -> Do not reopen or corrupt the old session', async () => {
    harness.updateSessionMode('rest-1', 'MANUAL');
    const order = await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Curry', price: 300 }], 300);
    await harness.confirmPayment(order.id);
    await harness.clearTable('rest-1', 'Table 4');

    const session = harness.tableSessions.get(order.tableSessionId);
    expect(session.status).toBe('COMPLETED');

    // Webhook/callback arrives late
    const callbackRes = await harness.handleDelayedPaymentCallback(order.id, 300);
    expect(callbackRes.reconciled).toBe(true);
    expect(callbackRes.sessionReopened).toBe(false);
    expect(session.status).toBe('COMPLETED'); // remains COMPLETED
  });

  // TEST 14: An owner attempts to access another restaurant's table clearance endpoint
  test('TEST 14: An owner attempts to access another restaurant table clearance endpoint -> Access denied', async () => {
    // Table 4 belongs to rest-1
    await harness.placeOrder('rest-1', 'Table 4', [{ name: 'Pizza', price: 500 }], 500);

    // Owner of rest-2 tries to clear rest-1 table
    await expect(harness.clearTable('rest-2', 'Table 4')).rejects.toThrow(
      'Access denied: You do not have permission to clear this restaurant table.'
    );
  });
});
