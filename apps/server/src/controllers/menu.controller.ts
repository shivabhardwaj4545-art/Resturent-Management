import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { cacheGet, cacheSet } from '../services/redis.service';
import { emitWaiterCall } from '../services/socket.service';
import { ensureDatabaseSeeded } from '../utils/autoSeed';
import { verifyTableSignature } from '../utils/tableSignature';
import { logger } from '../utils/logger';

// Public: list of approved restaurants (for demo/landing page)
export async function getPublicRestaurants(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurants = await prisma.restaurant.findMany({
      where: { isApproved: true, isSuspended: false, deletedAt: null },
      select: { slug: true, name: true },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    res.json({ success: true, data: { restaurants } });
  } catch (error) { next(error); }
}

export async function getRestaurantMenu(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurantSlug = req.params.restaurantSlug as string;
    const cacheKey = `menu:${restaurantSlug}`;

    // Try cache first (TTL 5 minutes)
    const cached = await cacheGet(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, fromCache: true });
      return;
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: {
        slug: restaurantSlug,
        deletedAt: null,
        isApproved: true,
        isSuspended: false,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        cuisineType: true,
        logo: true,
        banner: true,
        address: true,
        city: true,
        phone: true,
        operatingHours: true,
        isOpen: true,
        hasDelivery: true,
        minOrderValue: true,
        deliveryRadius: true,
        themeColor: true,
        menuTemplate: true,
        customFields: true,
        paymentQrCode: true,
        paymentUpiId: true,
        paymentPhone: true,
        bankName: true,
        bankAccountNumber: true,
        bankIfsc: true,
        bankAccountHolder: true,
      },
    });

    if (!restaurant) {
      await ensureDatabaseSeeded();
      const retrySlug = restaurantSlug.toLowerCase();
      const retryRestaurant = await prisma.restaurant.findFirst({
        where: {
          slug: retrySlug,
          deletedAt: null,
          isApproved: true,
          isSuspended: false,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          cuisineType: true,
          logo: true,
          banner: true,
          address: true,
          city: true,
          phone: true,
          operatingHours: true,
          isOpen: true,
          hasDelivery: true,
          minOrderValue: true,
          deliveryRadius: true,
          themeColor: true,
        menuTemplate: true,
        customFields: true,
          paymentQrCode: true,
          paymentUpiId: true,
          paymentPhone: true,
          bankName: true,
          bankAccountNumber: true,
          bankIfsc: true,
          bankAccountHolder: true,
        },
      });

      if (!retryRestaurant) {
        throw new AppError(
          'Restaurant not found or not yet approved.',
          404,
          'RESTAURANT_NOT_FOUND'
        );
      }
      
      const categories = await prisma.menuCategory.findMany({
        where: { restaurantId: retryRestaurant.id },
        orderBy: { sortOrder: 'asc' },
        include: {
          items: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            include: { variants: true, addOns: true },
          },
        },
      });

      const data = { restaurant: retryRestaurant, categories };
      await cacheSet(cacheKey, data, 300);
      res.json({ success: true, data });
      return;
    }

    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId: restaurant.id },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            variants: true,
            addOns: true,
          },
        },
      },
    });

    const data = { restaurant, categories };

    // Cache for 5 minutes
    await cacheSet(cacheKey, data, 300);

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// POST /menu/:restaurantSlug/call-waiter (public — no auth required)
export async function callWaiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurantSlug = req.params.restaurantSlug as string;
    const { tableNumber, tableToken } = req.body as { tableNumber?: string; tableToken?: string };

    if (!tableNumber || typeof tableNumber !== 'string' || tableNumber.trim() === '') {
      throw new AppError('tableNumber is required', 400, 'VALIDATION_ERROR');
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: {
        slug: restaurantSlug,
        deletedAt: null,
        isApproved: true,
        isSuspended: false,
      },
      select: { id: true, name: true },
    });

    if (!restaurant) {
      throw new AppError('Restaurant not found', 404, 'RESTAURANT_NOT_FOUND');
    }

    // Verify cryptographic signature of the table number ONLY if a tableToken is provided
    if (tableToken && typeof tableToken === 'string' && tableToken.trim() !== '' && process.env.DISABLE_TABLE_SIGNATURE !== 'true') {
      if (!verifyTableSignature(restaurant.id, tableNumber.trim(), tableToken)) {
        throw new AppError('Invalid table QR code signature. Please scan the QR code on your table.', 403, 'INVALID_TABLE_TOKEN');
      }
    }

    // Emit real-time waiter call to the restaurant owner's socket room
    emitWaiterCall(restaurant.id, tableNumber.trim());

    // Create persistent notification in database so restaurant owner sees it in dashboard
    await prisma.notification.create({
      data: {
        restaurantId: restaurant.id,
        type: 'WAITER_CALL',
        title: `🔔 Waiter Call - Table ${tableNumber.trim()}`,
        message: `Customer at Table ${tableNumber.trim()} is requesting assistance.`,
      },
    }).catch((err) => logger.warn('Failed to create waiter call notification in DB:', err));

    res.json({
      success: true,
      message: `Waiter has been called for Table ${tableNumber.trim()}`,
    });
  } catch (error) {
    next(error);
  }
}

