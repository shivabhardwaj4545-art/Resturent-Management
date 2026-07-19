import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { isRestaurantOpen } from '../utils/operatingHours';
import { AppError } from '../utils/AppError';
import { createRazorpayOrder, verifyRazorpaySignature } from '../services/payment.razorpay.service';
import { emitNewOrder, emitNotification, emitWaiterCall, emitOrderStatusUpdate } from '../services/socket.service';
import { sendOrderConfirmationEmail } from '../services/email.service';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { verifyTableSignature } from '../utils/tableSignature';

const GST_RATE = parseFloat(process.env.GST_RATE ?? '18') / 100;
const DELIVERY_FEE = 40;
const PACKAGING_FEE = 15;
const LOYALTY_POINTS_PER_RUPEE = 1; // 1 point per ₹10 spent

async function calculateOrderTotal(
  cartItems: Array<{
    menuItemId: string;
    variantId?: string | null;
    quantity: number;
    addOns?: Array<{ id: string; name: string; price: number }>;
  }>,
  couponCode?: string,
  restaurantId?: string,
  userId?: string,
  isDineIn?: boolean
): Promise<{
  items: Array<{
    menuItemId: string;
    variantId?: string | null;
    quantity: number;
    unitPrice: number;
    addOns: Array<{ id: string; name: string; price: number }>;
    subtotal: number;
    name: string;
  }>;
  subtotal: number;
  gstAmount: number;
  deliveryFee: number;
  packagingFee: number;
  discount: number;
  total: number;
  couponId?: string;
}> {
  const processedItems = await Promise.all(
    cartItems.map(async (cartItem) => {
      const menuItem = await prisma.menuItem.findFirst({
        where: { id: cartItem.menuItemId, isAvailable: true, deletedAt: null },
        include: { variants: true },
      });

      if (!menuItem) {
        throw new AppError(`Menu item ${cartItem.menuItemId} not found or unavailable.`, 400, 'ITEM_NOT_FOUND');
      }

      let unitPrice = menuItem.price;
      if (cartItem.variantId) {
        const variant = menuItem.variants.find((v) => v.id === cartItem.variantId);
        if (variant) unitPrice = variant.price;
      }

      const addOnsTotal = (cartItem.addOns ?? []).reduce((sum, ao) => sum + ao.price, 0);
      const subtotal = (unitPrice + addOnsTotal) * cartItem.quantity;

      return {
        menuItemId: cartItem.menuItemId,
        variantId: cartItem.variantId,
        quantity: cartItem.quantity,
        unitPrice: unitPrice + addOnsTotal,
        addOns: cartItem.addOns ?? [],
        subtotal,
        name: menuItem.name,
      };
    })
  );

  const subtotal = processedItems.reduce((sum, i) => sum + i.subtotal, 0);
  const gstAmount = subtotal * GST_RATE;
  let discount = 0;
  let couponId: string | undefined;

  if (couponCode && restaurantId) {
    const coupon = await prisma.coupon.findFirst({
      where: {
        code: couponCode.toUpperCase(),
        isActive: true,
        OR: [{ restaurantId }, { restaurantId: null }],
        expiresAt: { gt: new Date() },
      },
    });

    if (coupon && subtotal >= coupon.minOrderAmount) {
      if (coupon.type === 'FLAT') {
        discount = coupon.value;
      } else {
        discount = (subtotal * coupon.value) / 100;
        if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
      }
      couponId = coupon.id;
    }
  }

  const deliveryFee = isDineIn ? 0 : DELIVERY_FEE;
  const packagingFee = isDineIn ? 0 : PACKAGING_FEE;
  const total = subtotal + gstAmount + deliveryFee + packagingFee - discount;

  return {
    items: processedItems,
    subtotal: parseFloat(subtotal.toFixed(2)),
    gstAmount: parseFloat(gstAmount.toFixed(2)),
    deliveryFee,
    packagingFee,
    discount: parseFloat(discount.toFixed(2)),
    total: parseFloat(Math.max(total, 0).toFixed(2)),
    couponId,
  };
}

// ── Guest Order ───────────────────────────────────────────────

export async function placeGuestOrder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { guestName, guestPhone, tableNumber, tableToken, paymentMethod, couponCode, restaurantSlug, cartItems, isDirect } = req.body as {
      guestName: string;
      guestPhone: string;
      tableNumber?: string;
      tableToken?: string;
      paymentMethod: 'RAZORPAY' | 'COD' | 'PAY_TO_WAITER';
      isDirect?: boolean;
      couponCode?: string;
      restaurantSlug: string;
      cartItems: Array<{ menuItemId: string; variantId?: string; quantity: number; addOns?: Array<{ id: string; name: string; price: number }> }>;
    };

    const restaurant = await prisma.restaurant.findFirst({
      where: { slug: restaurantSlug, isApproved: true, isSuspended: false, deletedAt: null },
    });

    if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
    if (!restaurant.isOpen || !isRestaurantOpen(restaurant.operatingHours, restaurant.isOpen)) {
      throw new AppError('Restaurant is currently closed or outside operating hours.', 400, 'RESTAURANT_CLOSED');
    }

    // Verify table number signature to prevent table spoofing (bypassed in development or if disabled)
    if (tableNumber && tableNumber.trim() !== '' && process.env.NODE_ENV !== 'development' && process.env.DISABLE_TABLE_SIGNATURE !== 'true') {
      if (!tableToken || typeof tableToken !== 'string' || !verifyTableSignature(restaurant.id, tableNumber.trim(), tableToken)) {
        throw new AppError('Invalid table QR code signature. Please scan the QR code on your table.', 403, 'INVALID_TABLE_TOKEN');
      }
    }

    const isDineIn = true; // Guest orders are always at the restaurant (dine-in/takeaway)
    const { items, subtotal, gstAmount, deliveryFee, packagingFee, discount, total, couponId } =
      await calculateOrderTotal(cartItems, couponCode, restaurant.id, undefined, isDineIn);

    if (!isDineIn && subtotal < restaurant.minOrderValue) {
      throw new AppError(
        `Minimum order value is ₹${restaurant.minOrderValue}.`,
        400,
        'MIN_ORDER_NOT_MET'
      );
    }

    let razorpayOrderId: string | undefined;

    if (paymentMethod === 'RAZORPAY' && !isDirect) {
      const rzOrder = await createRazorpayOrder(total, 'INR', `guest-${Date.now()}`, {
        guestName,
        restaurantName: restaurant.name,
      });
      razorpayOrderId = rzOrder.id;
    }

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          restaurantId: restaurant.id,
          guestName,
          guestPhone,
          tableNumber,
          status: 'PENDING',
          paymentMethod,
          paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PENDING',
          subtotal,
          gstAmount,
          deliveryFee,
          packagingFee,
          discount,
          total,
          couponId,
          razorpayOrderId,
          items: {
            create: items.map((item) => ({
              menuItemId: item.menuItemId,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              addOns: item.addOns,
              subtotal: item.subtotal,
            })),
          },
        },
        include: { items: { include: { menuItem: true } }, restaurant: true },
      });

      if (couponId) {
        await tx.coupon.update({
          where: { id: couponId },
          data: { usedCount: { increment: 1 } },
        });
      }

      // Create payment record
      await tx.payment.create({
        data: {
          orderId: newOrder.id,
          method: paymentMethod,
          status: 'PENDING',
          amount: total,
          razorpayOrderId,
        },
      });

      return newOrder;
    });

    // Notify restaurant via Socket.io
    emitNewOrder(restaurant.id, order);

    if ((paymentMethod === 'PAY_TO_WAITER' || paymentMethod === 'COD') && tableNumber) {
      const itemsSummary = order.items.map((item: any) => {
        const addOnsLabel = item.addOns && Array.isArray(item.addOns) && item.addOns.length > 0
          ? ` (+ ${item.addOns.map((ao: any) => ao.name).join(', ')})`
          : '';
        return `${item.menuItem?.name || 'Item'}${addOnsLabel} × ${item.quantity}`;
      }).join(', ');
      emitWaiterCall(restaurant.id, tableNumber, 'payment', total, paymentMethod, itemsSummary);
    }

    // Create notification for restaurant
    await prisma.notification.create({
      data: {
        restaurantId: restaurant.id,
        type: 'NEW_ORDER',
        title: 'New Order Received!',
        message: `New order #${order.id.slice(-8).toUpperCase()} from ${guestName} - ₹${total}`,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        order: {
          id: order.id,
          status: order.status,
          total: order.total,
          razorpayOrderId,
        },
      },
      message: 'Order placed successfully!',
    });
  } catch (error) {
    next(error);
  }
}

// ── Authenticated User Order ──────────────────────────────────

export async function placeOrder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    if (req.user!.role !== 'CUSTOMER') {
      throw new AppError('Restaurant owners and administrators are not allowed to place orders.', 403, 'ORDER_RESTRICTED');
    }
    const { addressId, newAddress, tableNumber, tableToken, paymentMethod, couponCode, restaurantSlug, useWallet, usePoints, isDirect, cartItems: reqCartItems } = req.body as {
      addressId?: string;
      newAddress?: { label: string; flat: string; street: string; area: string; city: string; pincode: string; isDefault: boolean };
      tableNumber?: string;
      tableToken?: string;
      paymentMethod: 'RAZORPAY' | 'COD' | 'WALLET' | 'PAY_TO_WAITER';
      couponCode?: string;
      restaurantSlug: string;
      useWallet?: boolean;
      usePoints?: boolean;
      isDirect?: boolean;
      cartItems?: Array<{ menuItemId: string; variantId?: string | null; quantity: number; addOns?: Array<{ id: string; name: string; price: number }> }>;
    };

    const restaurant = await prisma.restaurant.findFirst({
      where: { slug: restaurantSlug, isApproved: true, isSuspended: false, deletedAt: null },
    });

    if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
    if (!restaurant.isOpen || !isRestaurantOpen(restaurant.operatingHours, restaurant.isOpen)) {
      throw new AppError('Restaurant is currently closed or outside operating hours.', 400, 'RESTAURANT_CLOSED');
    }

    // Verify table number signature to prevent table spoofing (bypassed in development or if disabled)
    if (tableNumber && tableNumber.trim() !== '' && process.env.NODE_ENV !== 'development' && process.env.DISABLE_TABLE_SIGNATURE !== 'true') {
      if (!tableToken || typeof tableToken !== 'string' || !verifyTableSignature(restaurant.id, tableNumber.trim(), tableToken)) {
        throw new AppError('Invalid table QR code signature. Please scan the QR code on your table.', 403, 'INVALID_TABLE_TOKEN');
      }
    }

    let cartItems: Array<{
      menuItemId: string;
      variantId?: string | null;
      quantity: number;
      addOns: Array<{ id: string; name: string; price: number }>;
    }> = [];

    if (reqCartItems && reqCartItems.length > 0) {
      cartItems = reqCartItems.map((ci) => ({
        menuItemId: ci.menuItemId,
        variantId: ci.variantId,
        quantity: ci.quantity,
        addOns: ci.addOns ?? [],
      }));
    } else {
      // Get cart from DB
      const dbCartItems = await prisma.cartItem.findMany({
        where: { userId },
        include: { menuItem: true, variant: true },
      });
      cartItems = dbCartItems.map((ci) => ({
        menuItemId: ci.menuItemId,
        variantId: ci.variantId,
        quantity: ci.quantity,
        addOns: ci.addOns as Array<{ id: string; name: string; price: number }>,
      }));
    }

    if (cartItems.length === 0) {
      throw new AppError('Your cart is empty.', 400, 'EMPTY_CART');
    }

    const isDineIn = !addressId && !newAddress; // If no delivery address is specified, it is dine-in/takeaway
    const { items, subtotal, gstAmount, deliveryFee, packagingFee, discount, total, couponId } =
      await calculateOrderTotal(
        cartItems,
        couponCode,
        restaurant.id,
        userId,
        isDineIn
      );

    if (!isDineIn && subtotal < restaurant.minOrderValue) {
      throw new AppError(`Minimum order value is ₹${restaurant.minOrderValue}.`, 400, 'MIN_ORDER_NOT_MET');
    }

    // Get or create address
    let resolvedAddressId: string | undefined;

    if (newAddress) {
      const addr = await prisma.address.create({
        data: { userId, ...newAddress },
      });
      resolvedAddressId = addr.id;
    } else if (addressId) {
      const addr = await prisma.address.findFirst({ where: { id: addressId, userId } });
      if (!addr) throw new AppError('Address not found.', 404, 'ADDRESS_NOT_FOUND');
      resolvedAddressId = addr.id;
    }

    // Get user wallet balance and loyalty points
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalance: true, loyaltyPoints: true }
    });

    let pointsDeduction = 0;
    let pointsValue = 0;
    let finalTotal = total;

    if (usePoints && user && user.loyaltyPoints > 0) {
      // 10 loyalty points = ₹1 discount
      const maxPointsVal = user.loyaltyPoints / 10;
      const pointsVal = Math.min(maxPointsVal, total);
      pointsDeduction = Math.floor(pointsVal * 10);
      pointsValue = pointsDeduction / 10;
      finalTotal = total - pointsValue;
    }

    let walletDeduction = 0;
    if (useWallet && user && user.walletBalance > 0) {
      walletDeduction = Math.min(user.walletBalance, finalTotal);
      finalTotal = finalTotal - walletDeduction;
    }

    let razorpayOrderId: string | undefined;

    if (paymentMethod === 'RAZORPAY' && finalTotal > 0 && !isDirect) {
      const rzOrder = await createRazorpayOrder(finalTotal, 'INR', `order-${userId}-${Date.now()}`, {
        userId,
        restaurantName: restaurant.name,
      });
      razorpayOrderId = rzOrder.id;
    }

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          restaurantId: restaurant.id,
          userId,
          addressId: resolvedAddressId,
          tableNumber,
          status: 'PENDING',
          paymentMethod,
          paymentStatus: 'PENDING',
          subtotal,
          gstAmount,
          deliveryFee,
          packagingFee,
          discount: discount + walletDeduction + pointsValue,
          total: finalTotal,
          couponId,
          razorpayOrderId,
          items: {
            create: items.map((item) => ({
              menuItemId: item.menuItemId,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              addOns: item.addOns,
              subtotal: item.subtotal,
            })),
          },
        },
        include: { items: { include: { menuItem: true } }, restaurant: true, user: true },
      });

      // Deduct wallet balance
      if (walletDeduction > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { walletBalance: { decrement: walletDeduction } },
        });
        await tx.walletTransaction.create({
          data: {
            userId,
            orderId: newOrder.id,
            amount: walletDeduction,
            type: 'DEBIT',
            reference: `Order #${newOrder.id.slice(-8).toUpperCase()}`,
          },
        });
      }

      // Deduct loyalty points redeemed
      if (pointsDeduction > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { loyaltyPoints: { decrement: pointsDeduction } },
        });
        await tx.loyaltyTransaction.create({
          data: {
            userId,
            orderId: newOrder.id,
            points: pointsDeduction,
            type: 'REDEEMED',
          },
        });
      }

      // Award loyalty points (1 point per ₹10 spent on final cash paid)
      const pointsEarned = Math.floor(finalTotal / 10) * LOYALTY_POINTS_PER_RUPEE;
      if (pointsEarned > 0 && paymentMethod !== 'COD' && paymentMethod !== 'PAY_TO_WAITER') {
        await tx.user.update({
          where: { id: userId },
          data: { loyaltyPoints: { increment: pointsEarned } },
        });
        await tx.loyaltyTransaction.create({
          data: {
            userId,
            orderId: newOrder.id,
            points: pointsEarned,
            type: 'EARNED',
          },
        });
      }

      // Update coupon usage
      if (couponId) {
        await tx.coupon.update({
          where: { id: couponId },
          data: { usedCount: { increment: 1 } },
        });
        await tx.couponUsage.create({
          data: { couponId, userId, orderId: newOrder.id },
        });
      }

      // Create payment record
      await tx.payment.create({
        data: {
          orderId: newOrder.id,
          method: paymentMethod,
          status: 'PENDING',
          amount: finalTotal,
          razorpayOrderId,
        },
      });

      // Clear cart
      await tx.cartItem.deleteMany({ where: { userId } });

      return newOrder;
    });

    // Notify restaurant
    emitNewOrder(restaurant.id, order);

    if ((paymentMethod === 'PAY_TO_WAITER' || paymentMethod === 'COD') && tableNumber) {
      const itemsSummary = order.items.map((item: any) => {
        const addOnsLabel = item.addOns && Array.isArray(item.addOns) && item.addOns.length > 0
          ? ` (+ ${item.addOns.map((ao: any) => ao.name).join(', ')})`
          : '';
        return `${item.menuItem?.name || 'Item'}${addOnsLabel} × ${item.quantity}`;
      }).join(', ');
      emitWaiterCall(restaurant.id, tableNumber, 'payment', finalTotal, paymentMethod, itemsSummary);
    }
    emitNotification(userId, {
      type: 'ORDER_PLACED',
      title: 'Order Placed!',
      message: `Your order at ${restaurant.name} has been placed successfully.`,
    });

    // Send confirmation email
    if (order.user?.email) {
      sendOrderConfirmationEmail(
        order.user.email,
        order.user.name,
        order.id,
        restaurant.name,
        finalTotal
      ).catch(() => {}); // Fire and forget
    }

    res.status(201).json({
      success: true,
      data: {
        order: {
          id: order.id,
          status: order.status,
          total: finalTotal,
          razorpayOrderId,
          walletDeducted: walletDeduction,
        },
      },
      message: 'Order placed successfully!',
    });
  } catch (error) {
    next(error);
  }
}

// ── Get Order by ID ───────────────────────────────────────────

export async function getOrderById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orderId = req.params.orderId as string;

    const order = await prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        restaurant: {
          select: {
            name: true,
            logo: true,
            phone: true,
            themeColor: true,
            paymentQrCode: true,
            paymentUpiId: true,
            paymentPhone: true,
            bankName: true,
            bankAccountNumber: true,
            bankIfsc: true,
            bankAccountHolder: true,
          }
        },
        items: {
          include: {
            menuItem: { select: { name: true, image: true } },
            variant: { select: { name: true } },
          },
        },
        address: true,
        user: { select: { name: true, email: true, phone: true } },
      },
    });

    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    // Access control — user can only see their own orders (guests cannot see user orders)
    if (order.userId) {
      if (!req.user || (order.userId !== req.user.id && req.user.role === 'CUSTOMER')) {
        throw new AppError('Access denied.', 403, 'ACCESS_DENIED');
      }
    }

    res.json({ success: true, data: { order } });
  } catch (error) {
    next(error);
  }
}

// ── User Orders ───────────────────────────────────────────────

export async function getUserOrders(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string ?? '1', 10);
    const limit = parseInt(req.query.limit as string ?? '10', 10);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          restaurant: { select: { id: true, name: true, logo: true, slug: true } },
          items: { include: { menuItem: { select: { name: true, image: true } } }, take: 3 },
        },
      }),
      prisma.order.count({ where: { userId, deletedAt: null } }),
    ]);

    res.json({
      success: true,
      data: { orders },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
}

// ── Verify Payment ────────────────────────────────────────────

export async function verifyPayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
      orderId: string;
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    };

    const isValid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
    if (!isValid) {
      throw new AppError('Payment verification failed. Invalid signature.', 400, 'INVALID_PAYMENT_SIGNATURE');
    }

    const order = await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'PAID',
        razorpayPaymentId,
        payment: {
          update: { status: 'PAID', razorpayPaymentId },
        },
      },
      include: { restaurant: true },
    });

    res.json({
      success: true,
      data: { order: { id: order.id, paymentStatus: order.paymentStatus } },
      message: 'Payment verified successfully!',
    });
  } catch (error) {
    next(error);
  }
}

// ── Reorder ───────────────────────────────────────────────────

export async function reorder(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    if (req.user!.role !== 'CUSTOMER') {
      throw new AppError('Restaurant owners and administrators are not allowed to place orders.', 403, 'ORDER_RESTRICTED');
    }
    const orderId = req.params.orderId as string;

    const previousOrder = await prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: { include: { menuItem: true } } },
    }) as any;

    if (!previousOrder) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    // Clear current cart and add previous order items
    await prisma.cartItem.deleteMany({ where: { userId } });

    const cartItemsToCreate = previousOrder.items
      .filter((item: any) => item.menuItem.isAvailable && !item.menuItem.deletedAt)
      .map((item: any) => ({
        userId,
        menuItemId: item.menuItemId,
        variantId: item.variantId,
        quantity: item.quantity,
        addOns: item.addOns,
      }));

    await prisma.cartItem.createMany({ data: cartItemsToCreate });

    res.json({
      success: true,
      data: { itemsAdded: cartItemsToCreate.length },
      message: `${cartItemsToCreate.length} items added to your cart`,
    });
  } catch (error) {
    next(error);
  }
}

// ── Create Direct Order (Razorpay Standard Web Checkout) ───────

export async function createDirectOrder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { amount, currency = 'INR', receipt } = req.body as {
      amount: number; // in paise
      currency?: string;
      receipt?: string;
    };

    if (amount === undefined || amount === null) {
      throw new AppError('Amount is required.', 400, 'INVALID_AMOUNT');
    }

    if (amount < 100) {
      throw new AppError('Amount must be at least 100 paise.', 400, 'INVALID_AMOUNT');
    }

    const receiptId = receipt || `rcpt_${Date.now()}`;

    // createRazorpayOrder takes amount in Rupees, but the endpoint receives amount in paise.
    // So we pass amount / 100.
    const rzOrder = await createRazorpayOrder(amount / 100, currency, receiptId);

    res.status(200).json({
      order_id: rzOrder.id,
      amount: rzOrder.amount, // returned in paise
      currency: rzOrder.currency,
    });
  } catch (error) {
    next(error);
  }
}

export async function addItemsToOrder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orderId = req.params.orderId as string;
    const { cartItems, paymentMethod } = req.body as {
      cartItems: Array<{ menuItemId: string; variantId?: string; quantity: number; addOns?: any }>;
      paymentMethod?: 'RAZORPAY' | 'COD' | 'WALLET' | 'PAY_TO_WAITER';
    };

    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
      include: { items: true, restaurant: true },
    });

    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    // Retrieve menuItem details to calculate prices
    const menuItemIds = cartItems.map((item) => item.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      include: { variants: true },
    });

    let addedSubtotal = 0;
    const itemsToCreate: any[] = [];

    for (const item of cartItems) {
      const menuItem = menuItems.find((m) => m.id === item.menuItemId);
      if (!menuItem) continue;

      let unitPrice = menuItem.price;
      if (item.variantId) {
        const variant = menuItem.variants.find((v) => v.id === item.variantId);
        if (variant) {
          unitPrice = variant.price;
        }
      }

      // Calculate add-on prices if any
      let addOnsTotal = 0;
      if (item.addOns && Array.isArray(item.addOns)) {
        item.addOns.forEach((ao: any) => {
          addOnsTotal += ao.price || 0;
        });
      }

      const itemSubtotal = (unitPrice + addOnsTotal) * item.quantity;
      addedSubtotal += itemSubtotal;

      itemsToCreate.push({
        orderId,
        menuItemId: item.menuItemId,
        variantId: item.variantId || null,
        quantity: item.quantity,
        unitPrice: unitPrice + addOnsTotal,
        subtotal: itemSubtotal,
        addOns: item.addOns ? item.addOns : undefined,
      });
    }

    if (itemsToCreate.length === 0) {
      throw new AppError('No valid items to add.', 400, 'INVALID_ITEMS');
    }

    const addedGst = addedSubtotal * 0.18; // 18% GST consistent with standard rate
    const addedTotal = addedSubtotal + addedGst;

    // Start a transaction to create items and update order totals
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Create new OrderItems
      await tx.orderItem.createMany({
        data: itemsToCreate,
      });

      // Update Order totals
      const orderUpdate = await tx.order.update({
        where: { id: orderId },
        data: {
          subtotal: { increment: addedSubtotal },
          gstAmount: { increment: addedGst },
          total: { increment: addedTotal },
          paymentStatus: order.paymentMethod === 'RAZORPAY' ? order.paymentStatus : 'PENDING',
        },
        include: {
          items: { include: { menuItem: true } },
          restaurant: true,
        },
      });

      // Update payment record amount if it exists and is PENDING
      const existingPayment = await tx.payment.findUnique({
        where: { orderId },
      });
      if (existingPayment && existingPayment.status === 'PENDING') {
        await tx.payment.update({
          where: { orderId },
          data: {
            amount: { increment: addedTotal },
            method: paymentMethod || existingPayment.method,
          },
        });
      }

      return orderUpdate;
    });

    // Emit order status update / socket events to update owner dashboard in real time
    emitOrderStatusUpdate(orderId, order.restaurantId, {
      orderId,
      status: updatedOrder.status,
      paymentStatus: updatedOrder.paymentStatus,
      updatedAt: updatedOrder.updatedAt.toISOString(),
    });

    // Build items summary for only the newly added items
    const itemsSummary = itemsToCreate.map((item: any) => {
      const mItem = menuItems.find((m) => m.id === item.menuItemId);
      const addOnsLabel = item.addOns && Array.isArray(item.addOns) && item.addOns.length > 0
        ? ` (+ ${item.addOns.map((ao: any) => ao.name).join(', ')})`
        : '';
      return `${mItem?.name || 'Item'}${addOnsLabel} × ${item.quantity}`;
    }).join(', ');

    // Send a waiter call notification to alert the owner that items were added!
    emitWaiterCall(
      order.restaurantId,
      order.tableNumber || 'Delivery',
      'addons',
      addedTotal,
      paymentMethod,
      itemsSummary
    );

    res.json({
      success: true,
      data: { order: updatedOrder },
      message: 'Items added to order successfully!',
    });
  } catch (error) {
    next(error);
  }
}

export async function claimGuestOrders(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { orderIds } = req.body as { orderIds: string[] };
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      res.json({ success: true, message: 'No orders to claim.' });
      return;
    }

    const userId = req.user!.id;

    // Update all guest orders in the list that don't have a userId yet
    await prisma.order.updateMany({
      where: {
        id: { in: orderIds },
        userId: null,
        deletedAt: null,
      },
      data: {
        userId,
      },
    });

    res.json({
      success: true,
      message: 'Guest orders successfully claimed.',
    });
  } catch (error) {
    next(error);
  }
}
