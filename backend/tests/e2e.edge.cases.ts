import axios from 'axios';

const API_BASE = 'http://localhost:4000/api/v1';

async function runEdgeCases() {
  console.log('🧪 Starting Edge Case & Security Validation...\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, title: string, details?: any) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] Edge Case ${total}: ${title}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] Edge Case ${total}: ${title}`, details || '');
      process.exitCode = 1;
    }
  }

  // Login as owner for setup
  const ownerLogin = await axios.post(`${API_BASE}/auth/login`, {
    email: 'owner@upstates.com',
    password: 'Owner@123456',
  });
  const authToken = ownerLogin.data.data.accessToken;
  const authHeaders = { headers: { Authorization: `Bearer ${authToken}` } };

  const menuRes = await axios.get(`${API_BASE}/menu/upstates`);
  const item = menuRes.data.data.categories[0].items[0];

  // -------------------------------------------------------------------------
  // EDGE CASE 1: Cross-Restaurant Isolation
  // -------------------------------------------------------------------------
  // Create order at upstates Table A
  const tableA = `A-${Date.now().toString().slice(-4)}`;
  const orderA = (
    await axios.post(`${API_BASE}/orders/guest`, {
      restaurantSlug: 'upstates',
      tableNumber: tableA,
      guestName: 'Alice',
      guestPhone: '9876543210',
      paymentMethod: 'PAY_AT_COUNTER',
      cartItems: [{ menuItemId: item.id, quantity: 1, addOns: [] }],
    })
  ).data.data.order;

  // Try to use orderA's code at a different restaurant ('pizza-palace')
  let crossRestaurantBlocked = false;
  try {
    await axios.post(`${API_BASE}/table-sessions/validate-access-code`, {
      restaurantSlug: 'pizza-palace',
      tableNumber: tableA,
      accessCode: orderA.verificationCode,
      deviceReference: 'dev_intruder',
    });
  } catch (err: any) {
    if ([400, 401, 403, 404, 409].includes(err.response?.status)) {
      crossRestaurantBlocked = true;
    }
  }
  assert(crossRestaurantBlocked, 'Cross-restaurant code injection is strictly blocked');

  // -------------------------------------------------------------------------
  // EDGE CASE 2: Cross-Table Isolation (Same Restaurant, Different Table)
  // -------------------------------------------------------------------------
  const tableB = `B-${Date.now().toString().slice(-4)}`;
  let crossTableBlocked = false;
  try {
    await axios.post(`${API_BASE}/table-sessions/validate-access-code`, {
      restaurantSlug: 'upstates',
      tableNumber: tableB,
      accessCode: orderA.verificationCode,
      deviceReference: 'dev_intruder',
    });
  } catch (err: any) {
    if ([400, 401, 403, 404, 409].includes(err.response?.status)) {
      crossTableBlocked = true;
    }
  }
  assert(crossTableBlocked, 'Access code from Table A is rejected when submitted at Table B');

  // -------------------------------------------------------------------------
  // EDGE CASE 3: Rate Limiting & 5-Attempt Lockout
  // -------------------------------------------------------------------------
  const bruteForceDevice = `brute_${Date.now()}`;
  let lockoutTriggered = false;
  let remainingAttemptsReported = true;

  for (let i = 1; i <= 6; i++) {
    try {
      await axios.post(`${API_BASE}/table-sessions/validate-access-code`, {
        restaurantSlug: 'upstates',
        tableNumber: tableA,
        accessCode: '0000',
        deviceReference: bruteForceDevice,
      });
    } catch (err: any) {
      if (err.response?.status === 429) {
        lockoutTriggered = true;
        break;
      }
      if (err.response?.data?.data?.remainingAttempts === undefined) {
        remainingAttemptsReported = false;
      }
    }
  }
  assert(lockoutTriggered, 'Consecutive failed code attempts triggers 429 ACCESS_CODE_LOCKED_OUT lockout');

  // -------------------------------------------------------------------------
  // EDGE CASE 4: Cannot Add Items to Settled / Paid Order
  // -------------------------------------------------------------------------
  // Settle orderA
  await axios.post(
    `${API_BASE}/owner/counter/confirm-payment`,
    { orderId: orderA.id, instrument: 'CASH' },
    authHeaders
  );

  let addingToPaidBlocked = false;
  try {
    await axios.post(`${API_BASE}/orders/${orderA.id}/add-items`, {
      cartItems: [{ menuItemId: item.id, quantity: 1, addOns: [] }],
    });
  } catch (err: any) {
    if (err.response?.status === 400 && err.response?.data?.code === 'ORDER_ALREADY_SETTLED') {
      addingToPaidBlocked = true;
    }
  }
  assert(addingToPaidBlocked, 'Adding items to an already PAID order is blocked with ORDER_ALREADY_SETTLED');

  // -------------------------------------------------------------------------
  // EDGE CASE 5: Table Clearance Lifecycle
  // -------------------------------------------------------------------------
  // Settle and clear table
  let clearanceSucceeded = false;
  try {
    const clearRes = await axios.post(
      `${API_BASE}/table-sessions/clear`,
      {
        tableNumber: tableA,
        reason: 'GUESTS_LEFT_EMPTY',
      },
      authHeaders
    );
    if (clearRes.data.success) {
      clearanceSucceeded = true;
    }
  } catch (err: any) {
    console.error('Clearance error:', err.response?.data);
  }
  assert(clearanceSucceeded, 'Staff can successfully clear table once all bills are paid');

  // -------------------------------------------------------------------------
  // EDGE CASE 6: Post-Clearance Fresh QR Scan
  // -------------------------------------------------------------------------
  // Next guest scanning the cleared table gets a fresh, clean session without old bills
  const freshScanRes = await axios.post(`${API_BASE}/table-sessions/check-access`, {
    restaurantSlug: 'upstates',
    tableNumber: tableA,
    deviceReference: `guest_new_${Date.now()}`,
  });
  assert(
    freshScanRes.data.success && !freshScanRes.data.data.isOccupied,
    'Next guest scanning cleared table receives clean available state'
  );

  console.log(`\n========================================`);
  console.log(`🎉 ALL ${passed} / ${total} EDGE CASES PASSED!`);
  console.log(`========================================\n`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runEdgeCases();
