import crypto from 'crypto';
import { normalizeTableNumber } from '../src/controllers/tableSession.controller';

/**
 * Single Device Table Ordering & Waiter Assistance Test Harness
 * Simulates:
 * - Table Session creation with 4-digit Table Access Code
 * - Primary vs. Secondary Device identification
 * - Server-side cryptographic code hashing & rate-limiting (5-attempt lockout)
 * - Shared bill aggregation across multiple ordering devices
 * - Waiter assistance request lifecycle & physical table clearance
 * - Multi-tenant isolation & session expiration security
 */
class SingleDeviceOrderingHarness {
  restaurants: Map<string, any> = new Map();
  tableSessions: Map<string, any> = new Map();
  deviceAccesses: Map<string, any> = new Map();
  orders: Map<string, any> = new Map();
  waiterRequests: Map<string, any> = new Map();
  rateLimitMap: Map<string, { attempts: number; lockedUntil?: number }> = new Map();
  idCounter = 1;

  constructor() {
    this.reset();
  }

  reset() {
    this.restaurants.clear();
    this.tableSessions.clear();
    this.deviceAccesses.clear();
    this.orders.clear();
    this.waiterRequests.clear();
    this.rateLimitMap.clear();
    this.idCounter = 1;

    // Seed test restaurants
    this.restaurants.set('rest-1', {
      id: 'rest-1',
      name: 'EZRestro Bistro',
      slug: 'ezrestro-bistro',
      sessionManagementMode: 'MANUAL',
      ownerId: 'owner-1',
    });

    this.restaurants.set('rest-2', {
      id: 'rest-2',
      name: 'Other Place',
      slug: 'other-place',
      sessionManagementMode: 'MANUAL',
      ownerId: 'owner-2',
    });
  }

  generateAccessCode(): string {
    return String(1000 + Math.floor(Math.random() * 9000));
  }

  hashAccessCode(code: string): string {
    return crypto.createHash('sha256').update(code.trim()).digest('hex');
  }

  // Check access / QR scan
  async checkTableAccess(restaurantId: string, rawTableNumber: string, deviceReference: string) {
    const restaurant = this.restaurants.get(restaurantId);
    if (!restaurant) throw new Error('Restaurant not found');
    const cleanTable = normalizeTableNumber(rawTableNumber);

    // Find active session
    let session = Array.from(this.tableSessions.values()).find(
      (s) => s.restaurantId === restaurantId && s.tableNumber === cleanTable && s.status === 'ACTIVE'
    );

    if (!session) {
      // First customer: Assign as Primary device, generate 4-digit code
      const sessionId = `sess-${this.idCounter++}`;
      const accessCode = this.generateAccessCode();
      const accessCodeHash = this.hashAccessCode(accessCode);
      const sessionCode = String(1000 + Math.floor(Math.random() * 9000));

      session = {
        id: sessionId,
        restaurantId,
        tableNumber: cleanTable,
        sessionCode,
        tableAccessCode: accessCode,
        accessCodeHash,
        primaryDeviceReference: deviceReference,
        status: 'ACTIVE',
        paymentStatus: 'PENDING',
        totalAmount: 0,
        paidAmount: 0,
        createdAt: new Date(),
      };
      this.tableSessions.set(sessionId, session);

      // Grant Primary access
      const accessId = `acc-${this.idCounter++}`;
      this.deviceAccesses.set(accessId, {
        id: accessId,
        sessionId,
        deviceReference,
        role: 'PRIMARY',
        grantedAt: new Date(),
        revokedAt: null,
      });

      return {
        isAvailable: true,
        isPrimary: true,
        role: 'PRIMARY',
        tableAccessCode: accessCode,
        session,
      };
    }

    // Active session exists: Check if this device is authorized
    let isAuthorized = false;
    let role = 'SECONDARY';

    if (session.primaryDeviceReference === deviceReference) {
      isAuthorized = true;
      role = 'PRIMARY';
    } else {
      const access = Array.from(this.deviceAccesses.values()).find(
        (a) => a.sessionId === session.id && a.deviceReference === deviceReference && !a.revokedAt
      );
      if (access) {
        isAuthorized = true;
        role = access.role;
      }
    }

    if (isAuthorized) {
      return {
        isAvailable: true,
        isAuthorized: true,
        role,
        isPrimary: role === 'PRIMARY',
        tableAccessCode: role === 'PRIMARY' ? session.tableAccessCode : undefined,
        session,
      };
    }

    // Unrecognized device: Block and require 4-digit code or Waiter Call
    return {
      isAvailable: false,
      isOccupied: true,
      requiresAccessCode: true,
      tableNumber: cleanTable,
      sessionId: session.id,
      restaurantId: restaurant.id,
      status: 'TABLE_ALREADY_OCCUPIED',
    };
  }

  // Validate 4-digit Table Access Code
  async validateAccessCode(restaurantId: string, rawTableNumber: string, accessCode: string, deviceReference: string) {
    const cleanTable = normalizeTableNumber(rawTableNumber);
    const rateKey = `${restaurantId}_${cleanTable.toLowerCase()}_${deviceReference}`;
    const now = Date.now();
    const rateEntry = this.rateLimitMap.get(rateKey);

    // Rate limit lockout check
    if (rateEntry && rateEntry.lockedUntil && rateEntry.lockedUntil > now) {
      const remainingSeconds = Math.ceil((rateEntry.lockedUntil - now) / 1000);
      return {
        success: false,
        status: 429,
        code: 'ACCESS_CODE_LOCKED_OUT',
        message: 'Too many incorrect attempts. Table access verification is locked.',
        remainingSeconds,
      };
    }

    // Find active session
    const session = Array.from(this.tableSessions.values()).find(
      (s) => s.restaurantId === restaurantId && s.tableNumber === cleanTable && s.status === 'ACTIVE'
    );

    if (!session) {
      return {
        success: false,
        status: 404,
        code: 'SESSION_NOT_FOUND',
        message: 'No active table session found for this table.',
      };
    }

    const inputHash = this.hashAccessCode(accessCode);
    const isValid = session.tableAccessCode === accessCode.trim() || session.accessCodeHash === inputHash;

    if (!isValid) {
      const attempts = (rateEntry ? rateEntry.attempts : 0) + 1;
      if (attempts >= 5) {
        this.rateLimitMap.set(rateKey, { attempts, lockedUntil: now + 300000 });
        return {
          success: false,
          status: 429,
          code: 'ACCESS_CODE_LOCKED_OUT',
          message: 'Too many incorrect attempts. Table access verification is locked for 5 minutes.',
        };
      } else {
        this.rateLimitMap.set(rateKey, { attempts });
        return {
          success: false,
          status: 401,
          code: 'INVALID_TABLE_ACCESS_CODE',
          remainingAttempts: 5 - attempts,
        };
      }
    }

    // Success: Clear rate limit & grant secondary access
    this.rateLimitMap.delete(rateKey);
    const accessId = `acc-${this.idCounter++}`;
    this.deviceAccesses.set(accessId, {
      id: accessId,
      sessionId: session.id,
      deviceReference,
      role: 'SECONDARY',
      grantedAt: new Date(),
      revokedAt: null,
    });

    return {
      success: true,
      status: 200,
      authorized: true,
      role: 'SECONDARY',
      session,
    };
  }

  // Place order
  async placeOrder(restaurantId: string, rawTableNumber: string, deviceReference: string, items: any[], total: number) {
    const cleanTable = normalizeTableNumber(rawTableNumber);
    const session = Array.from(this.tableSessions.values()).find(
      (s) => s.restaurantId === restaurantId && s.tableNumber === cleanTable && s.status === 'ACTIVE'
    );

    if (!session) throw new Error('No active session');

    // Check device access
    const isPrimary = session.primaryDeviceReference === deviceReference;
    const hasAccess = Array.from(this.deviceAccesses.values()).some(
      (a) => a.sessionId === session.id && a.deviceReference === deviceReference && !a.revokedAt
    );

    if (!isPrimary && !hasAccess) {
      throw new Error('TABLE_ACCESS_CODE_REQUIRED');
    }

    // If an active ongoing order exists for this table session, append items as add-ons
    const existingActiveOrder = Array.from(this.orders.values()).find(
      (o) => o.tableSessionId === session.id && o.status !== 'CANCELLED' && o.status !== 'COMPLETED'
    );

    if (existingActiveOrder) {
      const addonItems = items.map((i) => ({ ...i, isAddon: true, addedByDevice: deviceReference }));
      existingActiveOrder.items.push(...addonItems);
      existingActiveOrder.total += total;
      existingActiveOrder.addOnStatus = 'PREPARING';
      existingActiveOrder.lastAddOnAt = new Date();
      session.totalAmount += total;
      return existingActiveOrder;
    }

    const orderId = `ord-${this.idCounter++}`;
    const order = {
      id: orderId,
      restaurantId,
      tableSessionId: session.id,
      tableNumber: cleanTable,
      deviceReference,
      items: items.map((i) => ({ ...i, isAddon: false })),
      total,
      paymentStatus: 'PENDING',
      status: 'PENDING',
      createdAt: new Date(),
    };
    this.orders.set(orderId, order);
    session.totalAmount += total;
    return order;
  }

  // Get combined table bill
  async getCombinedBill(sessionId: string) {
    const session = this.tableSessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const sessionOrders = Array.from(this.orders.values()).filter(
      (o) => o.tableSessionId === sessionId && o.status !== 'CANCELLED'
    );
    const totalAmount = sessionOrders.reduce((sum, o) => sum + o.total, 0);
    const paidOrders = sessionOrders.filter((o) => o.paymentStatus === 'PAID');
    const paidAmount = paidOrders.reduce((sum, o) => sum + o.total, 0);

    return {
      sessionId,
      orders: sessionOrders,
      totalAmount,
      paidAmount,
      orderCount: sessionOrders.length,
      isFullyPaid: sessionOrders.length > 0 && paidOrders.length === sessionOrders.length,
    };
  }

  // Create Waiter Request
  async callWaiter(restaurantId: string, rawTableNumber: string, deviceReference: string, reason?: string) {
    const cleanTable = normalizeTableNumber(rawTableNumber);
    const session = Array.from(this.tableSessions.values()).find(
      (s) => s.restaurantId === restaurantId && s.tableNumber === cleanTable && s.status === 'ACTIVE'
    );

    const requestId = `wreq-${this.idCounter++}`;
    const req = {
      id: requestId,
      restaurantId,
      tableNumber: cleanTable,
      sessionId: session ? session.id : null,
      deviceReference,
      reason: reason || 'Customer requested assistance at table.',
      status: 'PENDING',
      createdAt: new Date(),
    };
    this.waiterRequests.set(requestId, req);
    return req;
  }

  // Acknowledge Waiter Request
  async acknowledgeWaiterRequest(requestId: string, staffName = 'Staff') {
    const req = this.waiterRequests.get(requestId);
    if (!req) throw new Error('Request not found');
    req.status = 'ACKNOWLEDGED';
    req.acknowledgedBy = staffName;
    req.acknowledgedAt = new Date();
    return req;
  }

  // Resolve Waiter Request
  async resolveWaiterRequest(requestId: string, staffName = 'Staff') {
    const req = this.waiterRequests.get(requestId);
    if (!req) throw new Error('Request not found');
    req.status = 'RESOLVED';
    req.resolvedBy = staffName;
    req.resolvedAt = new Date();
    return req;
  }

  // Clear table from Waiter Request or Table Clearance Dashboard
  async clearTableSession(restaurantId: string, sessionId: string, forceClear = false) {
    const session = this.tableSessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.restaurantId !== restaurantId) throw new Error('Access denied');

    const bill = await this.getCombinedBill(sessionId);
    if (!bill.isFullyPaid && !forceClear && bill.orderCount > 0) {
      throw new Error('Cannot clear table with unpaid orders without force clearance');
    }

    const now = new Date();
    session.status = 'COMPLETED';
    session.completedAt = now;

    // Revoke all device accesses
    for (const access of this.deviceAccesses.values()) {
      if (access.sessionId === sessionId && !access.revokedAt) {
        access.revokedAt = now;
      }
    }

    return { success: true, releasedTable: session.tableNumber };
  }
}

describe('EZRestro Single Device Ordering & Waiter Assistance Suite', () => {
  let harness: SingleDeviceOrderingHarness;

  beforeEach(() => {
    harness = new SingleDeviceOrderingHarness();
  });

  // TEST 1: First customer scans Table 4 -> Primary device assigned -> 4-digit code generated
  test('1. First customer scanning Table 4 becomes Primary Device and generates 4-digit Table Access Code', async () => {
    const res = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-customer-1');
    expect(res.isAvailable).toBe(true);
    expect(res.isPrimary).toBe(true);
    expect(res.role).toBe('PRIMARY');
    expect(res.tableAccessCode).toMatch(/^\d{4}$/);
    expect(res.session.primaryDeviceReference).toBe('dev-customer-1');
  });

  // TEST 2: Second customer scans Table 4 without code -> Occupied screen shown -> Cannot create new session
  test('2. Second customer scanning Table 4 sees TABLE ALREADY OCCUPIED and cannot create a duplicate session', async () => {
    // Primary device initiates session
    await harness.checkTableAccess('rest-1', 'Table 4', 'dev-customer-1');

    // Second device scans
    const res2 = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-customer-2');
    expect(res2.isAvailable).toBe(false);
    expect(res2.isOccupied).toBe(true);
    expect(res2.requiresAccessCode).toBe(true);
    expect(res2.status).toBe('TABLE_ALREADY_OCCUPIED');
    expect(res2.tableNumber).toBe('Table 4');

    // Verify only ONE active session exists in total for Table 4
    const activeSessions = Array.from(harness.tableSessions.values()).filter(
      (s) => s.restaurantId === 'rest-1' && s.tableNumber === 'Table 4' && s.status === 'ACTIVE'
    );
    expect(activeSessions.length).toBe(1);
  });

  // TEST 3: Correct 4-digit code entered -> Device authorized as secondary -> Can view shared bill
  test('3. Entering correct 4-digit code authorizes secondary device to join session bill', async () => {
    const primary = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-customer-1');
    const code = primary.tableAccessCode;

    const valRes = await harness.validateAccessCode('rest-1', 'Table 4', code, 'dev-customer-2');
    expect(valRes.success).toBe(true);
    expect(valRes.authorized).toBe(true);
    expect(valRes.role).toBe('SECONDARY');
    expect(valRes.session.id).toBe(primary.session.id);
  });

  // TEST 4: Incorrect code entered -> 401 error shown -> Counter incremented
  test('4. Incorrect 4-digit code is rejected with attempt counter decremented', async () => {
    await harness.checkTableAccess('rest-1', 'Table 4', 'dev-customer-1');

    const valRes = await harness.validateAccessCode('rest-1', 'Table 4', '0000', 'dev-customer-2');
    expect(valRes.success).toBe(false);
    expect(valRes.status).toBe(401);
    expect(valRes.code).toBe('INVALID_TABLE_ACCESS_CODE');
    expect(valRes.remainingAttempts).toBe(4);
  });

  // TEST 5: 5 incorrect attempts -> Lockout triggered (429) -> Cannot guess codes
  test('5. Lockout triggered after 5 consecutive incorrect attempts (HTTP 429)', async () => {
    await harness.checkTableAccess('rest-1', 'Table 4', 'dev-customer-1');

    for (let i = 0; i < 4; i++) {
      const res = await harness.validateAccessCode('rest-1', 'Table 4', `111${i}`, 'dev-attacker');
      expect(res.status).toBe(401);
    }

    // 5th attempt locks out
    const fifthRes = await harness.validateAccessCode('rest-1', 'Table 4', '9999', 'dev-attacker');
    expect(fifthRes.status).toBe(429);
    expect(fifthRes.code).toBe('ACCESS_CODE_LOCKED_OUT');

    // Subsequent attempt remains locked out
    const lockedRes = await harness.validateAccessCode('rest-1', 'Table 4', '9999', 'dev-attacker');
    expect(lockedRes.status).toBe(429);
  });

  // TEST 6: Secondary device adds items to bill -> Linked to active session bill
  test('6. Additional items ordered by authorized secondary device are linked to shared table bill', async () => {
    const primary = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-customer-1');
    await harness.validateAccessCode('rest-1', 'Table 4', primary.tableAccessCode, 'dev-customer-2');

    const order = await harness.placeOrder('rest-1', 'Table 4', 'dev-customer-2', [{ name: 'Garlic Bread', price: 180 }], 180);
    expect(order.tableSessionId).toBe(primary.session.id);
    expect(order.deviceReference).toBe('dev-customer-2');

    const bill = await harness.getCombinedBill(primary.session.id);
    expect(bill.totalAmount).toBe(180);
    expect(bill.orderCount).toBe(1);
  });

  // TEST 7: Primary and secondary device orders accumulate on one ongoing order
  test('7. Primary and secondary device orders accumulate on one combined ongoing order and shared table bill', async () => {
    const primary = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-customer-1');
    await harness.validateAccessCode('rest-1', 'Table 4', primary.tableAccessCode, 'dev-customer-2');

    const initialOrder = await harness.placeOrder('rest-1', 'Table 4', 'dev-customer-1', [{ name: 'Pizza', price: 450 }], 450);
    const addedOrder = await harness.placeOrder('rest-1', 'Table 4', 'dev-customer-2', [{ name: 'Pasta', price: 350 }], 350);

    // Both point to the exact same order!
    expect(addedOrder.id).toBe(initialOrder.id);
    expect(addedOrder.items.length).toBe(2);
    expect(addedOrder.total).toBe(800);
    expect(addedOrder.items[1].isAddon).toBe(true);

    const bill = await harness.getCombinedBill(primary.session.id);
    expect(bill.totalAmount).toBe(800);
  });

  // TEST 8: Customer clicks "Call Waiter" from occupied screen -> WaiterRequest created
  test('8. Customer clicks Call Waiter on occupied screen, creating persistent WaiterRequest', async () => {
    await harness.checkTableAccess('rest-1', 'Table 4', 'dev-customer-1');

    const req = await harness.callWaiter('rest-1', 'Table 4', 'dev-customer-2', 'Table appears empty but is marked occupied.');
    expect(req.id).toBeDefined();
    expect(req.tableNumber).toBe('Table 4');
    expect(req.status).toBe('PENDING');
    expect(req.deviceReference).toBe('dev-customer-2');
  });

  // TEST 9: Waiter request appears on owner dashboard with pending status
  test('9. Waiter requests are listed on owner dashboard with pending counter', async () => {
    await harness.callWaiter('rest-1', 'Table 4', 'dev-guest-1');
    await harness.callWaiter('rest-1', 'Table 6', 'dev-guest-2');

    const pending = Array.from(harness.waiterRequests.values()).filter((r) => r.status === 'PENDING');
    expect(pending.length).toBe(2);
  });

  // TEST 10: Staff acknowledges waiter request
  test('10. Restaurant staff acknowledges waiter request', async () => {
    const req = await harness.callWaiter('rest-1', 'Table 4', 'dev-guest-1');
    const ack = await harness.acknowledgeWaiterRequest(req.id, 'Waiter John');
    expect(ack.status).toBe('ACKNOWLEDGED');
    expect(ack.acknowledgedBy).toBe('Waiter John');
  });

  // TEST 11: Staff resolves request if table is still physically occupied
  test('11. Staff resolves waiter request when table is inspected and remains occupied', async () => {
    const req = await harness.callWaiter('rest-1', 'Table 4', 'dev-guest-1');
    const res = await harness.resolveWaiterRequest(req.id, 'Manager Alice');
    expect(res.status).toBe('RESOLVED');
    expect(res.resolvedBy).toBe('Manager Alice');
  });

  // TEST 12: Staff clears table from waiter request -> Closes session, revokes devices, releases table
  test('12. Staff clears table when physically empty, revoking all device accesses and releasing table', async () => {
    const primary = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-customer-1');
    await harness.validateAccessCode('rest-1', 'Table 4', primary.tableAccessCode, 'dev-customer-2');

    // Clear session
    const clearRes = await harness.clearTableSession('rest-1', primary.session.id, true);
    expect(clearRes.success).toBe(true);
    expect(primary.session.status).toBe('COMPLETED');

    // Check all device accesses revoked
    const activeAccesses = Array.from(harness.deviceAccesses.values()).filter(
      (a) => a.sessionId === primary.session.id && !a.revokedAt
    );
    expect(activeAccesses.length).toBe(0);
  });

  // TEST 13: Next customer scans Table 4 after clearance -> Fresh session, new Primary, new code
  test('13. Next customer scanning Table 4 after clearance receives brand-new session & access code', async () => {
    const firstSession = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-first-guest');
    const oldCode = firstSession.tableAccessCode;
    await harness.clearTableSession('rest-1', firstSession.session.id, true);

    // New customer scans
    const newSession = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-new-guest');
    expect(newSession.isAvailable).toBe(true);
    expect(newSession.isPrimary).toBe(true);
    expect(newSession.session.id).not.toBe(firstSession.session.id);
    expect(newSession.tableAccessCode).toBeDefined();
    expect(newSession.session.primaryDeviceReference).toBe('dev-new-guest');
  });

  // TEST 14: Tenant isolation: Code from Table 4 cannot be validated against Table 5 or another restaurant
  test('14. Multi-tenant and cross-table isolation: Access code from Table 4 cannot join Table 5 or Restaurant 2', async () => {
    const s1 = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-c1');
    const codeTable4 = s1.tableAccessCode;

    // Try using Table 4 code on Table 5 in same restaurant
    await harness.checkTableAccess('rest-1', 'Table 5', 'dev-other');
    const crossTableRes = await harness.validateAccessCode('rest-1', 'Table 5', codeTable4, 'dev-intruder');
    expect(crossTableRes.success).toBe(false);

    // Try using Table 4 code in Restaurant 2
    await harness.checkTableAccess('rest-2', 'Table 4', 'dev-other-rest');
    const crossRestRes = await harness.validateAccessCode('rest-2', 'Table 4', codeTable4, 'dev-intruder');
    expect(crossRestRes.success).toBe(false);
  });

  // TEST 15: Expired/Closed session code cannot be reused
  test('15. Closed session access code is invalid for subsequent sessions', async () => {
    const s1 = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-c1');
    const oldCode = s1.tableAccessCode;
    await harness.clearTableSession('rest-1', s1.session.id, true);

    // New session starts
    await harness.checkTableAccess('rest-1', 'Table 4', 'dev-c2');

    // Attempt validating old code
    const res = await harness.validateAccessCode('rest-1', 'Table 4', oldCode, 'dev-c3');
    // Unless by extreme coincidence the random 4-digit codes match, old code is rejected
    if (oldCode !== harness.tableSessions.get(Array.from(harness.tableSessions.keys()).pop()!)?.tableAccessCode) {
      expect(res.success).toBe(false);
    }
  });

  // TEST 16: Primary device re-scans table -> Recognized without entering code
  test('16. Primary device re-scans table and is recognized without code prompt', async () => {
    const s1 = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-c1');
    expect(s1.isPrimary).toBe(true);

    const reScan = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-c1');
    expect(reScan.isAvailable).toBe(true);
    expect(reScan.isAuthorized).toBe(true);
    expect(reScan.role).toBe('PRIMARY');
    expect(reScan.tableAccessCode).toBe(s1.tableAccessCode);
  });

  // TEST 17: Authorized secondary device re-scans table -> Recognized after authorization
  test('17. Authorized secondary device re-scans table and is recognized without entering code again', async () => {
    const s1 = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-c1');
    await harness.validateAccessCode('rest-1', 'Table 4', s1.tableAccessCode, 'dev-c2');

    const reScan = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-c2');
    expect(reScan.isAvailable).toBe(true);
    expect(reScan.isAuthorized).toBe(true);
    expect(reScan.role).toBe('SECONDARY');
  });

  // TEST 18: Unpaid orders verification before clearance
  test('18. Manual table clearance prevents closing session with unpaid orders without force override', async () => {
    const s1 = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-c1');
    await harness.placeOrder('rest-1', 'Table 4', 'dev-c1', [{ name: 'Steak', price: 600 }], 600);

    // Normal clearance should fail due to unpaid order
    await expect(harness.clearTableSession('rest-1', s1.session.id, false)).rejects.toThrow(
      'Cannot clear table with unpaid orders without force clearance'
    );

    // Force clearance succeeds
    const forceRes = await harness.clearTableSession('rest-1', s1.session.id, true);
    expect(forceRes.success).toBe(true);
  });

  // TEST 19: Friend ordering at the same table automatically goes as add-on to ongoing order
  test('19. Friend from the same table placing an order appends items as an add-on to the ongoing order', async () => {
    // 1. Person 1 starts session and places initial order
    const p1 = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-person-1');
    const orderP1 = await harness.placeOrder('rest-1', 'Table 4', 'dev-person-1', [
      { name: 'Butter Chicken', price: 420 },
      { name: 'Naan', price: 60 },
    ], 480);
    expect(orderP1.items.length).toBe(2);

    // 2. Person 2 (friend) scans and validates code
    const p2Access = await harness.validateAccessCode('rest-1', 'Table 4', p1.tableAccessCode, 'dev-person-2');
    expect(p2Access.authorized).toBe(true);

    // 3. Person 2 orders extra roti & dal makhani
    const orderP2 = await harness.placeOrder('rest-1', 'Table 4', 'dev-person-2', [
      { name: 'Dal Makhani', price: 320 },
      { name: 'Tandoori Roti', price: 40 },
    ], 360);

    // 4. Must be identical ongoing order ID with add-on flag set!
    expect(orderP2.id).toBe(orderP1.id);
    expect(orderP2.items.length).toBe(4);
    expect(orderP2.total).toBe(840);
    expect(orderP2.addOnStatus).toBe('PREPARING');

    const addedItems = orderP2.items.filter((i: any) => i.isAddon);
    expect(addedItems.length).toBe(2);
    expect(addedItems[0].name).toBe('Dal Makhani');
  });

  // TEST 20: Both the first person and the friend track the exact same order
  test('20. Order tracking ID and details are identical on both the primary customer and friend phones', async () => {
    const p1 = await harness.checkTableAccess('rest-1', 'Table 4', 'dev-person-1');
    const orderP1 = await harness.placeOrder('rest-1', 'Table 4', 'dev-person-1', [{ name: 'Biryani', price: 350 }], 350);

    await harness.validateAccessCode('rest-1', 'Table 4', p1.tableAccessCode, 'dev-person-2');
    const orderP2 = await harness.placeOrder('rest-1', 'Table 4', 'dev-person-2', [{ name: 'Raita', price: 80 }], 80);

    // Both devices have the exact same tracking target
    const trackingIdP1 = orderP1.id;
    const trackingIdP2 = orderP2.id;
    expect(trackingIdP1).toBe(trackingIdP2);

    const bill = await harness.getCombinedBill(p1.session.id);
    expect(bill.totalAmount).toBe(430);
  });
});
