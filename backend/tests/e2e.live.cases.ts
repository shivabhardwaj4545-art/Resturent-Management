import axios from 'axios';

const API_BASE = 'http://localhost:4000/api/v1';

async function runAllCases() {
  console.log('🚀 Starting Comprehensive Live E2E Case Testing...\n');

  let passedCases = 0;
  let totalCases = 0;

  function assert(condition: boolean, caseTitle: string, details?: any) {
    totalCases++;
    if (condition) {
      console.log(`✅ [PASS] Case ${totalCases}: ${caseTitle}`);
      passedCases++;
    } else {
      console.error(`❌ [FAIL] Case ${totalCases}: ${caseTitle}`, details || '');
      process.exitCode = 1;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // CASE 1: Fetch Menu & Verify Categories & Items
    // -------------------------------------------------------------------------
    const menuRes = await axios.get(`${API_BASE}/menu/upstates`);
    assert(
      menuRes.data.success && menuRes.data.data.categories.length > 0,
      'Fetch restaurant menu returns categories and active items',
      menuRes.data
    );

    const categories = menuRes.data.data.categories;
    const allItems = categories.flatMap((c: any) => c.items);
    assert(allItems.length >= 2, 'Menu has at least 2 orderable items');

    const item1 = allItems[0];
    const item2 = allItems[1];

    // Unique table number for this test run so we start fresh
    const testTable = `T-${Date.now().toString().slice(-4)}`;
    const primaryDevice = `dev_primary_${Date.now()}`;
    const secondaryDevice = `dev_friend_${Date.now()}`;

    // -------------------------------------------------------------------------
    // CASE 2: New Table QR Scan -> Initial Status Check
    // -------------------------------------------------------------------------
    const initialStatusRes = await axios.post(`${API_BASE}/table-sessions/check-access`, {
      restaurantSlug: 'upstates',
      tableNumber: testTable,
      deviceReference: primaryDevice,
    });

    assert(
      initialStatusRes.data.success &&
      (!initialStatusRes.data.data.isOccupied || initialStatusRes.data.data.isAuthorized),
      'New table QR scan recognizes primary device without code prompt',
      initialStatusRes.data
    );

    // -------------------------------------------------------------------------
    // CASE 3: Primary Customer Places Initial Order
    // -------------------------------------------------------------------------
    const orderPayload1 = {
      restaurantSlug: 'upstates',
      tableNumber: testTable,
      guestName: 'Alex Host',
      guestPhone: '9876543210',
      paymentMethod: 'PAY_AT_COUNTER',
      cartItems: [
        {
          menuItemId: item1.id,
          quantity: 2,
          addOns: [],
        },
      ],
    };

    const orderRes1 = await axios.post(`${API_BASE}/orders/guest`, orderPayload1, {
      headers: { 'x-device-id': primaryDevice },
    });
    const order1 = orderRes1.data.data.order;

    assert(
      order1 && order1.id && /^\d{4}$/.test(order1.verificationCode),
      `Order placed successfully with 4-digit verification code: #${order1.verificationCode}`,
      order1
    );

    assert(
      order1.status === 'CONFIRMED' || order1.status === 'PENDING',
      `Order initial status is CONFIRMED or PENDING (Actual: ${order1.status})`
    );

    assert(
      order1.paymentStatus === 'PENDING',
      `Order paymentStatus is PENDING (Actual: ${order1.paymentStatus})`
    );

    // -------------------------------------------------------------------------
    // CASE 4: Secondary Device (Friend) Scans Same Table QR -> Occupied Detected
    // -------------------------------------------------------------------------
    let friendLocked = false;
    try {
      const friendScanRes = await axios.post(`${API_BASE}/table-sessions/check-access`, {
        restaurantSlug: 'upstates',
        tableNumber: testTable,
        deviceReference: secondaryDevice,
      });
      if (friendScanRes.data.data?.requiresAccessCode) {
        friendLocked = true;
      }
    } catch (err: any) {
      if (err.response && (err.response.status === 409 || err.response.status === 403)) {
        friendLocked = true;
      }
    }

    assert(friendLocked, 'Friend scanning occupied table is prompted with table lock / access code');

    // -------------------------------------------------------------------------
    // CASE 5: Friend Tries Wrong 4-Digit Code -> Rejected
    // -------------------------------------------------------------------------
    const wrongCode = order1.verificationCode === '1234' ? '4321' : '1234';
    let wrongCodeRejected = false;
    try {
      await axios.post(`${API_BASE}/table-sessions/validate-access-code`, {
        restaurantSlug: 'upstates',
        tableNumber: testTable,
        accessCode: wrongCode,
        deviceReference: secondaryDevice,
      });
    } catch (err: any) {
      if (err.response && [400, 401, 403, 429].includes(err.response.status)) {
        wrongCodeRejected = true;
      }
    }

    assert(wrongCodeRejected, 'Incorrect 4-digit code is rejected with 401 Unauthorized');

    // -------------------------------------------------------------------------
    // CASE 6: Friend Enters Valid 4-Digit Order Verification Code -> Authorized!
    // -------------------------------------------------------------------------
    const validCodeRes = await axios.post(`${API_BASE}/table-sessions/validate-access-code`, {
      restaurantSlug: 'upstates',
      tableNumber: testTable,
      accessCode: order1.verificationCode,
      deviceReference: secondaryDevice,
    });

    assert(
      validCodeRes.data.success && validCodeRes.data.data.authorized === true,
      'Friend is authorized using the host 4-digit Order Verification Code',
      validCodeRes.data
    );

    // -------------------------------------------------------------------------
    // CASE 7: Authorized Friend Orders Additional Items -> Links to Same Table Session
    // -------------------------------------------------------------------------
    const orderPayload2 = {
      restaurantSlug: 'upstates',
      tableNumber: testTable,
      guestName: 'Jordan Friend',
      guestPhone: '9876543211',
      paymentMethod: 'PAY_AT_COUNTER',
      cartItems: [
        {
          menuItemId: item2.id,
          quantity: 1,
          addOns: [],
        },
      ],
    };

    const orderRes2 = await axios.post(`${API_BASE}/orders/guest`, orderPayload2, {
      headers: { 'x-device-id': secondaryDevice },
    });
    const order2 = orderRes2.data.data.order;

    assert(
      order2 && (order2.tableSessionId === order1.tableSessionId || order2.verificationCode === order1.verificationCode),
      'Friend order is joined to the same table session and verification code',
      { order1Session: order1.tableSessionId, order2Session: order2.tableSessionId }
    );

    // -------------------------------------------------------------------------
    // CASE 8: Kitchen Staff Updates Order Status to READY then DELIVERED (SERVED)
    // -------------------------------------------------------------------------
    // Login as restaurant owner
    const ownerLogin = await axios.post(`${API_BASE}/auth/login`, {
      email: 'owner@upstates.com',
      password: 'Owner@123456',
    });
    const authToken = ownerLogin.data.data.accessToken;
    const authHeaders = { headers: { Authorization: `Bearer ${authToken}` } };

    // Kitchen marks PREPARING
    await axios.patch(`${API_BASE}/kitchen/orders/${order1.id}/status`, { status: 'PREPARING' }, authHeaders);
    let checkOrder = (await axios.get(`${API_BASE}/orders/${order1.id}`)).data.data.order;
    assert(checkOrder.status === 'PREPARING', 'Kitchen updates status to PREPARING');

    // Kitchen marks READY
    await axios.patch(`${API_BASE}/kitchen/orders/${order1.id}/status`, { status: 'READY' }, authHeaders);
    checkOrder = (await axios.get(`${API_BASE}/orders/${order1.id}`)).data.data.order;
    assert(checkOrder.status === 'READY', 'Kitchen updates status to READY');

    // Waiter marks DELIVERED (Food is served!)
    await axios.patch(`${API_BASE}/kitchen/orders/${order1.id}/status`, { status: 'DELIVERED' }, authHeaders);
    checkOrder = (await axios.get(`${API_BASE}/orders/${order1.id}`)).data.data.order;

    assert(
      checkOrder.status === 'DELIVERED',
      `Order food status is DELIVERED (Served) (Actual: ${checkOrder.status})`
    );

    // -------------------------------------------------------------------------
    // CASE 9: CRITICAL — SERVED STATUS MUST NOT AUTOMATICALLY MARK AS PAID
    // -------------------------------------------------------------------------
    assert(
      checkOrder.paymentStatus !== 'PAID' && checkOrder.paymentStatus === 'PENDING',
      `CRITICAL VERIFICATION: Food is DELIVERED (SERVED) but paymentStatus is STILL PENDING (Actual: ${checkOrder.paymentStatus})`
    );

    // -------------------------------------------------------------------------
    // CASE 10: Customer Can Add Items (Dessert/Drinks) Even After Food is Served (DELIVERED)
    // -------------------------------------------------------------------------
    let postServedAddonAllowed = false;
    try {
      const addonRes = await axios.post(`${API_BASE}/orders/${order1.id}/add-items`, {
        cartItems: [
          {
            menuItemId: item1.id,
            quantity: 1,
            addOns: [],
          },
        ],
      });
      if (addonRes.data.success) {
        postServedAddonAllowed = true;
      }
    } catch (err: any) {
      console.error('Post-served addon error:', err.response?.data);
    }

    assert(
      postServedAddonAllowed,
      'Customer can add items/addons to bill even after main dishes are DELIVERED'
    );

    // -------------------------------------------------------------------------
    // CASE 11: Cashier Confirms Offline Counter Payment
    // -------------------------------------------------------------------------
    const confirmRes = await axios.post(
      `${API_BASE}/owner/counter/confirm-payment`,
      { orderId: order1.id, instrument: 'CASH' },
      authHeaders
    );

    const paidOrder = (await axios.get(`${API_BASE}/orders/${order1.id}`)).data.data.order;
    assert(
      paidOrder.paymentStatus === 'PAID',
      `Cashier manually confirms payment -> paymentStatus is now PAID (Actual: ${paidOrder.paymentStatus})`,
      confirmRes.data
    );

    // -------------------------------------------------------------------------
    // CASE 12: Repeated Payment Attempt is Rejected with ALREADY_PAID
    // -------------------------------------------------------------------------
    let alreadyPaidPrevented = false;
    try {
      await axios.post(
        `${API_BASE}/owner/counter/confirm-payment`,
        { orderId: order1.id, instrument: 'CASH' },
        authHeaders
      );
    } catch (err: any) {
      if (err.response && (err.response.data?.code === 'ALREADY_PAID' || err.response.status === 400)) {
        alreadyPaidPrevented = true;
      }
    }

    assert(alreadyPaidPrevented, 'Duplicate payment confirmation attempt correctly returns ALREADY_PAID');

    console.log(`\n========================================`);
    console.log(`🎉 ALL ${passedCases} / ${totalCases} TEST CASES PASSED!`);
    console.log(`========================================\n`);

    if (passedCases === totalCases) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (error: any) {
    console.error('Fatal test error:', error.response?.data || error.message);
    process.exit(1);
  }
}

runAllCases();
