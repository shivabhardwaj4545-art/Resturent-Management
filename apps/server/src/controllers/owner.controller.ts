import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { uploadMenuItemImage, uploadRestaurantLogo, uploadRestaurantBanner, uploadRestaurantPaymentQr } from '../services/cloudinary.service';
import { emitOrderStatusUpdate, emitNotification, emitUserLoyaltyUpdate, emitPaymentNotReceived } from '../services/socket.service';
import { cacheDelPattern, cacheSet } from '../services/redis.service';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { generateTableSignature } from '../utils/tableSignature';
import { sortOperatingHours } from '../utils/operatingHours';

async function getOwnerRestaurant(ownerId: string) {
  const restaurant = await prisma.restaurant.findFirst({
    where: { ownerId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
  return restaurant;
}

// ── Dashboard ─────────────────────────────────────────────────

export async function getDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [todayStats, monthlyStats, recentOrders, orderStatusBreakdown, last7DaysRevenue, reviewStats, todayHourlyRaw] = await Promise.all([
      prisma.order.aggregate({
        where: { restaurantId: restaurant.id, createdAt: { gte: today }, status: { not: 'CANCELLED' }, deletedAt: null },
        _count: { id: true },
        _sum: { total: true },
        _avg: { total: true },
      }),
      prisma.order.aggregate({
        where: { restaurantId: restaurant.id, createdAt: { gte: startOfMonth }, status: { not: 'CANCELLED' }, deletedAt: null },
        _count: { id: true },
        _sum: { total: true },
      }),
      prisma.order.findMany({
        where: { restaurantId: restaurant.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          user: { select: { name: true } },
          items: { include: { menuItem: { select: { name: true } } }, take: 3 },
        },
      }),
      prisma.order.groupBy({
        by: ['status'],
        where: { restaurantId: restaurant.id },
        _count: { status: true },
      }),
      // Last 7 days revenue
      prisma.$queryRaw<Array<{ date: string; revenue: number; orders: number }>>`
        SELECT 
          DATE("createdAt")::text as date,
          SUM(total)::float as revenue,
          COUNT(id)::int as orders
        FROM orders
        WHERE "restaurantId" = ${restaurant.id}
          AND "createdAt" >= NOW() - INTERVAL '7 days'
          AND status != 'CANCELLED'
          AND "deletedAt" IS NULL
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `,
      prisma.review.aggregate({
        where: { restaurantId: restaurant.id },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      // Today hourly breakdown (0 to 23 hours)
      prisma.$queryRaw<Array<{ hour: number; revenue: number; orders: number }>>`
        SELECT 
          EXTRACT(HOUR FROM "createdAt")::int as hour,
          SUM(total)::float as revenue,
          COUNT(id)::int as orders
        FROM orders
        WHERE "restaurantId" = ${restaurant.id}
          AND "createdAt" >= ${today}
          AND status != 'CANCELLED'
          AND "deletedAt" IS NULL
        GROUP BY EXTRACT(HOUR FROM "createdAt")
        ORDER BY hour ASC
      `,
    ]);

    const pendingOrders = orderStatusBreakdown.find((s) => s.status === 'PENDING')?._count.status ?? 0;

    // Format 24-hour array for today's hourly earnings chart
    const todayHourlyEarnings = Array.from({ length: 24 }, (_, h) => {
      const found = todayHourlyRaw.find((item) => Number(item.hour) === h);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const formattedHour = `${h % 12 === 0 ? 12 : h % 12} ${ampm}`;
      return {
        hour: formattedHour,
        rawHour: h,
        revenue: found ? Number(found.revenue) : 0,
        orders: found ? Number(found.orders) : 0,
      };
    });

    const currentHour = new Date().getHours();
    const activeHours = Math.max(1, currentHour + 1);
    const todayRevenueVal = todayStats._sum.total ?? 0;
    const todayHourlyAverage = todayRevenueVal > 0 ? todayRevenueVal / activeHours : 0;

    res.json({
      success: true,
      data: {
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          isOpen: restaurant.isOpen,
          themeColor: restaurant.themeColor,
        },
        stats: {
          todayRevenue: todayRevenueVal,
          todayOrders: todayStats._count.id,
          monthlyRevenue: monthlyStats._sum.total ?? 0,
          monthlyOrders: monthlyStats._count.id,
          todayHourlyAverage,
          pendingOrders,
          avgOrderValue: todayStats._avg.total ?? 0,
          avgRating: reviewStats._avg.rating ?? 0,
          totalReviews: reviewStats._count.rating ?? 0,
        },
        recentOrders,
        orderStatusBreakdown,
        last7DaysRevenue,
        todayHourlyEarnings,
      },
    });
  } catch (error) { next(error); }
}

// ── Restaurant Profile ────────────────────────────────────────

export async function getRestaurant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    if (restaurant.operatingHours) {
      restaurant.operatingHours = sortOperatingHours(restaurant.operatingHours);
    }
    res.json({ success: true, data: { restaurant } });
  } catch (error) { next(error); }
}

export async function updateRestaurant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const body = { ...req.body } as Record<string, any>;

    if (body.operatingHours) {
      body.operatingHours = sortOperatingHours(body.operatingHours);
    }

    if (body.slug && typeof body.slug === 'string') {
      const sanitizedSlug = body.slug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (!sanitizedSlug) {
        throw new AppError('Invalid URL slug format. Use letters, numbers, and hyphens.', 400, 'INVALID_SLUG');
      }

      if (sanitizedSlug !== restaurant.slug) {
        const existing = await prisma.restaurant.findUnique({
          where: { slug: sanitizedSlug },
        });

        if (existing && existing.id !== restaurant.id) {
          throw new AppError('This URL slug is already taken by another restaurant. Please choose a unique URL slug.', 400, 'SLUG_TAKEN');
        }
        body.slug = sanitizedSlug;
      }
    }

    const updated = await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: body,
    });

    if (updated.operatingHours) {
      updated.operatingHours = sortOperatingHours(updated.operatingHours);
    }

    await cacheDelPattern(`menu:${restaurant.slug}*`);
    if (updated.slug !== restaurant.slug) {
      await cacheDelPattern(`menu:${updated.slug}*`);
    }

    res.json({ success: true, data: { restaurant: updated }, message: 'Restaurant settings updated' });
  } catch (error) { next(error); }
}

export async function toggleRestaurant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const { isOpen } = req.body as { isOpen: boolean };
    const updated = await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: { isOpen },
    });
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({
      success: true,
      data: { isOpen: updated.isOpen },
      message: `Restaurant is now ${updated.isOpen ? 'OPEN' : 'CLOSED'}`,
    });
  } catch (error) { next(error); }
}

export async function uploadLogo(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    if (!req.file) throw new AppError('No image file provided.', 400, 'NO_FILE');
    const url = await uploadRestaurantLogo(req.file.buffer, restaurant.slug);
    await prisma.restaurant.update({ where: { id: restaurant.id }, data: { logo: url } });
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, data: { logo: url }, message: 'Logo uploaded' });
  } catch (error) { next(error); }
}

export async function uploadBanner(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    if (!req.file) throw new AppError('No image file provided.', 400, 'NO_FILE');
    const url = await uploadRestaurantBanner(req.file.buffer, restaurant.slug);
    await prisma.restaurant.update({ where: { id: restaurant.id }, data: { banner: url } });
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, data: { banner: url }, message: 'Banner uploaded' });
  } catch (error) { next(error); }
}

export async function uploadPaymentQr(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    if (!req.file) throw new AppError('No image file provided.', 400, 'NO_FILE');
    const url = await uploadRestaurantPaymentQr(req.file.buffer, restaurant.slug);
    await prisma.restaurant.update({ where: { id: restaurant.id }, data: { paymentQrCode: url } });
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, data: { paymentQrCode: url }, message: 'Payment QR uploaded' });
  } catch (error) { next(error); }
}

// ── Menu Categories ────────────────────────────────────────────

export async function getCategories(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId: restaurant.id },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { items: true } } },
    });
    res.json({ success: true, data: { categories } });
  } catch (error) { next(error); }
}

export async function createCategory(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const { name, sortOrder } = req.body as { name: string; sortOrder?: number };
    const category = await prisma.menuCategory.create({
      data: { name, restaurantId: restaurant.id, sortOrder: sortOrder ?? 0 },
    });
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.status(201).json({ success: true, data: { category }, message: 'Category created' });
  } catch (error) { next(error); }
}

export async function updateCategory(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;
    const existing = await prisma.menuCategory.findFirst({ where: { id, restaurantId: restaurant.id } });
    if (!existing) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
    const category = await prisma.menuCategory.update({ where: { id }, data: req.body as Record<string, unknown> });
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, data: { category }, message: 'Category updated' });
  } catch (error) { next(error); }
}

export async function deleteCategory(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;
    const existing = await prisma.menuCategory.findFirst({ where: { id, restaurantId: restaurant.id } });
    if (!existing) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
    await prisma.menuCategory.delete({ where: { id } });
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, data: null, message: 'Category deleted' });
  } catch (error) { next(error); }
}

export async function reorderCategories(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const { order } = req.body as { order: Array<{ id: string; sortOrder: number }> };
    await Promise.all(
      order.map((item) =>
        prisma.menuCategory.updateMany({
          where: { id: item.id, restaurantId: restaurant.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, data: null, message: 'Categories reordered' });
  } catch (error) { next(error); }
}

// ── Menu Items ─────────────────────────────────────────────────

export async function getMenuItems(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const items = await prisma.menuItem.findMany({
      where: { restaurantId: restaurant.id, deletedAt: null },
      include: { category: true, variants: true, addOns: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { items } });
  } catch (error) { next(error); }
}

export async function createMenuItem(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const body = req.body as {
      name: string; description?: string; price: string; categoryId: string;
      isVeg?: string; isVegan?: string; isAvailable?: string; badges?: string;
      variants?: string; addOns?: string;
    };

    let imageUrl: string | undefined;
    if (req.file) {
      imageUrl = await uploadMenuItemImage(req.file.buffer, restaurant.slug, body.name);
    }

    const variants = body.variants ? JSON.parse(body.variants) as Array<{ name: string; price: number }> : [];
    const addOns = body.addOns ? JSON.parse(body.addOns) as Array<{ name: string; price: number }> : [];
    const badges = body.badges ? JSON.parse(body.badges) as string[] : [];

    const item = await prisma.menuItem.create({
      data: {
        name: body.name,
        description: body.description,
        price: parseFloat(body.price),
        categoryId: body.categoryId,
        restaurantId: restaurant.id,
        image: imageUrl,
        isVeg: body.isVeg !== 'false',
        isVegan: body.isVegan === 'true',
        isAvailable: body.isAvailable !== 'false',
        badges: badges as Array<'POPULAR' | 'TRENDING' | 'BEST_SELLER' | 'NEW'>,
        variants: { create: variants },
        addOns: { create: addOns },
      },
      include: { variants: true, addOns: true, category: true },
    });

    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.status(201).json({ success: true, data: { item }, message: 'Menu item created' });
  } catch (error) { next(error); }
}

export async function updateMenuItem(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;
    const existing = await prisma.menuItem.findFirst({ where: { id, restaurantId: restaurant.id, deletedAt: null } });
    if (!existing) throw new AppError('Menu item not found.', 404, 'ITEM_NOT_FOUND');

    const body = req.body as {
      name?: string; description?: string; price?: string; categoryId?: string;
      isVeg?: string; isVegan?: string; isAvailable?: string; badges?: string;
      variants?: string; addOns?: string;
    };

    let imageUrl: string | undefined;
    if (req.file) {
      imageUrl = await uploadMenuItemImage(req.file.buffer, restaurant.slug, body.name ?? existing.name);
    }

    const updateData: Record<string, unknown> = {};
    if (body.name) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.price) updateData.price = parseFloat(body.price);
    if (body.categoryId) updateData.categoryId = body.categoryId;
    if (imageUrl) updateData.image = imageUrl;
    if (body.isVeg !== undefined) updateData.isVeg = body.isVeg !== 'false';
    if (body.isVegan !== undefined) updateData.isVegan = body.isVegan === 'true';
    if (body.isAvailable !== undefined) updateData.isAvailable = body.isAvailable !== 'false';
    if (body.badges) updateData.badges = JSON.parse(body.badges) as string[];

    const item = await prisma.menuItem.update({
      where: { id },
      data: updateData,
      include: { variants: true, addOns: true, category: true },
    });

    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, data: { item }, message: 'Menu item updated' });
  } catch (error) { next(error); }
}

export async function deleteMenuItem(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;
    const existing = await prisma.menuItem.findFirst({ where: { id, restaurantId: restaurant.id, deletedAt: null } });
    if (!existing) throw new AppError('Menu item not found.', 404, 'ITEM_NOT_FOUND');
    await prisma.menuItem.update({ where: { id }, data: { deletedAt: new Date() } });
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, data: null, message: 'Menu item deleted' });
  } catch (error) { next(error); }
}

export async function toggleMenuItemAvailability(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;
    const existing = await prisma.menuItem.findFirst({ where: { id, restaurantId: restaurant.id, deletedAt: null } });
    if (!existing) throw new AppError('Menu item not found.', 404, 'ITEM_NOT_FOUND');
    const updated = await prisma.menuItem.update({ where: { id }, data: { isAvailable: !existing.isAvailable } });
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, data: { isAvailable: updated.isAvailable } });
  } catch (error) { next(error); }
}

// ── Coupons ────────────────────────────────────────────────────

export async function getCoupons(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const coupons = await prisma.coupon.findMany({
      where: { restaurantId: restaurant.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { coupons } });
  } catch (error) { next(error); }
}

export async function createCoupon(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const coupon = await prisma.coupon.create({
      data: { ...req.body as any, restaurantId: restaurant.id },
    });
    res.status(201).json({ success: true, data: { coupon }, message: 'Coupon created' });
  } catch (error) { next(error); }
}

export async function updateCoupon(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;
    const existing = await prisma.coupon.findFirst({ where: { id, restaurantId: restaurant.id } });
    if (!existing) throw new AppError('Coupon not found.', 404, 'COUPON_NOT_FOUND');
    const coupon = await prisma.coupon.update({ where: { id }, data: req.body as Record<string, unknown> });
    res.json({ success: true, data: { coupon }, message: 'Coupon updated' });
  } catch (error) { next(error); }
}

export async function deleteCoupon(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;
    const existing = await prisma.coupon.findFirst({ where: { id, restaurantId: restaurant.id } });
    if (!existing) throw new AppError('Coupon not found.', 404, 'COUPON_NOT_FOUND');
    await prisma.coupon.delete({ where: { id } });
    res.json({ success: true, data: null, message: 'Coupon deleted' });
  } catch (error) { next(error); }
}

export async function toggleCoupon(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;
    const existing = await prisma.coupon.findFirst({ where: { id, restaurantId: restaurant.id } });
    if (!existing) throw new AppError('Coupon not found.', 404, 'COUPON_NOT_FOUND');
    const updated = await prisma.coupon.update({ where: { id }, data: { isActive: !existing.isActive } });
    res.json({ success: true, data: { isActive: updated.isActive } });
  } catch (error) { next(error); }
}

// ── Orders ─────────────────────────────────────────────────────

export async function getOrders(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const { status, page = '1', limit = '20', search } = req.query as {
      status?: string; page?: string; limit?: string; search?: string;
    };

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const where: Record<string, unknown> = {
      restaurantId: restaurant.id,
      deletedAt: null,
      ...(status && status !== 'ALL' && { status }),
      ...(search && {
        OR: [
          { id: { contains: search, mode: 'insensitive' } },
          { guestName: { contains: search, mode: 'insensitive' } },
          { guestPhone: { contains: search } },
        ],
      }),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit, 10),
        include: {
          user: { select: { name: true, phone: true, email: true } },
          items: { include: { menuItem: { select: { name: true } } } },
          address: true,
        },
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      success: true,
      data: { orders },
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) { next(error); }
}

export async function getOrderDetail(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;

    const order = await prisma.order.findFirst({
      where: { id, restaurantId: restaurant.id, deletedAt: null },
      include: {
        user: { select: { name: true, email: true, phone: true } },
        items: { include: { menuItem: true, variant: true } },
        address: true,
        payment: true,
        coupon: true,
      },
    });

    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    res.json({ success: true, data: { order } });
  } catch (error) { next(error); }
}

export async function updateOrderStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;
    const { status, addOnStatus, reason } = req.body as { status?: string; addOnStatus?: string; reason?: string };

    const order = await prisma.order.findFirst({
      where: { id, restaurantId: restaurant.id, deletedAt: null },
      include: { user: true },
    });

    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    const statusDateFields: Record<string, string> = {
      CONFIRMED: 'confirmedAt',
      PREPARING: 'preparingAt',
      BAKING: 'bakingAt',
      READY: 'readyAt',
      ON_THE_WAY: 'onTheWayAt',
      DELIVERED: 'deliveredAt',
      CANCELLED: 'cancelledAt',
    };

    if (status === 'CANCELLED' && order.status !== 'CANCELLED') {
      // 1. Refund redeemed loyalty points
      const redeemedTx = await prisma.loyaltyTransaction.findFirst({
        where: { orderId: id, type: 'REDEEMED' },
      });
      if (redeemedTx && order.userId) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: order.userId! },
            data: { loyaltyPoints: { increment: redeemedTx.points } },
          });
          await tx.loyaltyTransaction.create({
            data: {
              userId: order.userId!,
              orderId: id,
              points: redeemedTx.points,
              type: 'EARNED',
            },
          });
        });
      }

      // 2. Deduct earned loyalty points
      const earnedTx = await prisma.loyaltyTransaction.findFirst({
        where: { orderId: id, type: 'EARNED', points: { gt: 0 } },
      });
      if (earnedTx && order.userId) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: order.userId! },
            data: { loyaltyPoints: { decrement: earnedTx.points } },
          });
          await tx.loyaltyTransaction.create({
            data: {
              userId: order.userId!,
              orderId: id,
              points: earnedTx.points,
              type: 'REDEEMED',
            },
          });
        });
      }

      // 3. Refund wallet balance
      const walletDebit = await prisma.walletTransaction.findFirst({
        where: { orderId: id, type: 'DEBIT' },
      });
      if (walletDebit && order.userId) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: order.userId! },
            data: { walletBalance: { increment: walletDebit.amount } },
          });
          await tx.walletTransaction.create({
            data: {
              userId: order.userId!,
              orderId: id,
              amount: walletDebit.amount,
              type: 'CREDIT',
              reference: `Refund for Cancelled Order #${order.id.slice(-8).toUpperCase()}`,
            },
          });
        });
      }

      // 4. Emit the updated user points to the frontend socket in real-time
      if (order.userId) {
        const updatedUser = await prisma.user.findUnique({
          where: { id: order.userId },
          select: { loyaltyPoints: true },
        });
        if (updatedUser) {
          emitUserLoyaltyUpdate(order.userId, updatedUser.loyaltyPoints);
        }
      }
    }

    const updateData: Record<string, any> = {};
    if (status) {
      updateData.status = status;
      const dateField = statusDateFields[status];
      if (dateField) {
        updateData[dateField] = new Date();
      }
      if (status === 'CANCELLED' && order.addOnStatus) {
        updateData.addOnStatus = 'CANCELLED';
      }
    }

    if (addOnStatus !== undefined) {
      updateData.addOnStatus = addOnStatus;
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: updateData,
    });

    // Emit real-time update via Socket.io
    emitOrderStatusUpdate(id, restaurant.id, {
      orderId: id,
      status: updatedOrder.status,
      addOnStatus: updatedOrder.addOnStatus,
      lastAddOnAt: updatedOrder.lastAddOnAt,
      updatedAt: updatedOrder.updatedAt.toISOString(),
    });

    // Notify customer on status update
    if (status && order.userId) {
      const statusMessages: Record<string, string> = {
        CONFIRMED: 'Your order has been confirmed! 🎉',
        PREPARING: 'Your order is being prepared! 👨‍🍳',
        BAKING: 'Your order is in the kitchen! 🔥',
        READY: 'Your order is ready! 🍽️',
        ON_THE_WAY: 'Your order is on the way! 🚴',
        DELIVERED: 'Your order has been delivered! ✅',
        CANCELLED: `Your order has been cancelled. ${reason ?? ''}`,
      };

      await prisma.notification.create({
        data: {
          userId: order.userId,
          restaurantId: restaurant.id,
          type: 'ORDER_STATUS',
          title: `Order ${status}`,
          message: statusMessages[status] ?? `Order status updated to ${status}`,
        },
      });

      emitNotification(order.userId, {
        type: 'ORDER_STATUS',
        title: `Order ${status}`,
        message: statusMessages[status],
        orderId: id,
      });
    }

    // Notify customer on add-on status update
    if (addOnStatus && order.userId) {
      const addOnMessages: Record<string, string> = {
        PREPARING: 'Your add-on items are being prepared! 👨‍🍳',
        READY: 'Your add-on items are ready to serve! 🍽️',
        DELIVERED: 'Your add-on items have been served! ✅',
        CANCELLED: 'Your add-on items have been cancelled. 🚫',
      };

      const msg = addOnMessages[addOnStatus] ?? `Add-on status updated to ${addOnStatus}`;

      await prisma.notification.create({
        data: {
          userId: order.userId,
          restaurantId: restaurant.id,
          type: 'ORDER_STATUS',
          title: `Add-ons ${addOnStatus}`,
          message: msg,
        },
      });

      emitNotification(order.userId, {
        type: 'ORDER_STATUS',
        title: `Add-ons ${addOnStatus}`,
        message: msg,
        orderId: id,
      });
    }

    res.json({
      success: true,
      data: { order: { id: updatedOrder.id, status: updatedOrder.status } },
      message: `Order status updated to ${status}`,
    });
  } catch (error) { next(error); }
}

// ── Confirm Cash Payment (Pay at Counter / Waiter) ─────────────────────────

export async function confirmPayment(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;

    const order = await prisma.order.findFirst({
      where: { id, restaurantId: restaurant.id, deletedAt: null },
    });

    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.paymentStatus === 'PAID') {
      throw new AppError('Payment is already marked as paid.', 400, 'ALREADY_PAID');
    }

    const loyaltySetting = await prisma.systemSetting.findUnique({
      where: { key: 'loyalty_settings' },
    });
    const loyaltyVal = (loyaltySetting?.value as Record<string, any>) ?? {};
    const pointsPerSpendRupees = Number(loyaltyVal.pointsPerSpendRupees) || 10;

    const pointsEarned = Math.floor(Number(order.total) / pointsPerSpendRupees);

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: { paymentStatus: 'PAID' },
      });

      await tx.payment.updateMany({
        where: { orderId: id },
        data: { status: 'PAID' },
      });

      if (order.userId && pointsEarned > 0) {
        await tx.user.update({
          where: { id: order.userId },
          data: { loyaltyPoints: { increment: pointsEarned } },
        });

        await tx.loyaltyTransaction.create({
          data: {
            userId: order.userId,
            orderId: order.id,
            points: pointsEarned,
            type: 'EARNED',
          },
        });
      }
    });

    if (order.userId && pointsEarned > 0) {
      const updatedUser = await prisma.user.findUnique({
        where: { id: order.userId },
        select: { loyaltyPoints: true },
      });
      if (updatedUser) {
        emitUserLoyaltyUpdate(order.userId, updatedUser.loyaltyPoints);
      }
    }

    // Emit real-time socket update to customer
    emitOrderStatusUpdate(id, restaurant.id, {
      orderId: id,
      paymentStatus: 'PAID',
      updatedAt: new Date().toISOString(),
    });

    if (order.userId) {
      await prisma.notification.create({
        data: {
          userId: order.userId,
          restaurantId: restaurant.id,
          type: 'PAYMENT_RECEIPT',
          title: '✅ Payment Confirmed!',
          message: `Your payment of ₹${Number(order.total).toFixed(2)} has been confirmed by the restaurant!`,
        },
      });

      emitNotification(order.userId, {
        type: 'PAYMENT_RECEIPT',
        title: '✅ Payment Confirmed!',
        message: `Your payment of ₹${Number(order.total).toFixed(2)} has been confirmed!`,
        orderId: id,
      });
    }

    res.json({ success: true, message: 'Payment confirmed successfully.' });
  } catch (error) { next(error); }
}

export async function rejectPayment(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const id = req.params.id as string;

    const order = await prisma.order.findFirst({
      where: { id, restaurantId: restaurant.id, deletedAt: null },
    });

    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.paymentStatus === 'PAID') {
      throw new AppError('Payment is already marked as paid.', 400, 'ALREADY_PAID');
    }

    await prisma.order.update({
      where: { id },
      data: { paymentStatus: 'FAILED' },
    });

    // Emit real-time socket event to the customer on this order's tracking page
    emitPaymentNotReceived(id, Number(order.total));
    emitOrderStatusUpdate(id, restaurant.id, {
      orderId: id,
      paymentStatus: 'FAILED',
      updatedAt: new Date().toISOString(),
    });

    // Also send an in-app notification if there's a userId
    if (order.userId) {
      await prisma.notification.create({
        data: {
          userId: order.userId,
          restaurantId: restaurant.id,
          type: 'SYSTEM',
          title: '⚠️ Payment Not Received',
          message: `Your payment of ₹${Number(order.total).toFixed(2)} for order #${id.slice(-8).toUpperCase()} was not received. Please complete payment to process your order, or it may be cancelled.`,
        },
      });
      emitNotification(order.userId, {
        type: 'SYSTEM',
        title: '⚠️ Payment Not Received',
        message: `Your payment of ₹${Number(order.total).toFixed(2)} for order #${id.slice(-8).toUpperCase()} was not received.`,
        createdAt: new Date().toISOString(),
      });
    }

    res.json({ success: true, message: 'Payment rejection notification sent to customer.' });
  } catch (error) { next(error); }
}



export async function getAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const { period = '7d' } = req.query as { period?: string };

    const days = period === '30d' ? 30 : 7;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [revenueData, topItems, reviewStats, todayStats, monthlyStats, todayHourlyRaw] = await Promise.all([
      prisma.$queryRaw<Array<{ date: string; revenue: number; orders: number }>>`
        SELECT 
          DATE("createdAt")::text as date,
          SUM(total)::float as revenue,
          COUNT(id)::int as orders
        FROM orders
        WHERE "restaurantId" = ${restaurant.id}
          AND "createdAt" >= ${startDate}
          AND status != 'CANCELLED'
          AND "deletedAt" IS NULL
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `,
      prisma.orderItem.groupBy({
        by: ['menuItemId'],
        where: {
          order: { restaurantId: restaurant.id, createdAt: { gte: startDate }, status: { not: 'CANCELLED' } },
        },
        _sum: { quantity: true, subtotal: true },
        orderBy: { _sum: { subtotal: 'desc' } },
        take: 5,
      }),
      prisma.review.aggregate({
        where: { restaurantId: restaurant.id },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      prisma.order.aggregate({
        where: { restaurantId: restaurant.id, createdAt: { gte: today }, status: { not: 'CANCELLED' }, deletedAt: null },
        _count: { id: true },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: { restaurantId: restaurant.id, createdAt: { gte: startOfMonth }, status: { not: 'CANCELLED' }, deletedAt: null },
        _count: { id: true },
        _sum: { total: true },
      }),
      prisma.$queryRaw<Array<{ hour: number; revenue: number; orders: number }>>`
        SELECT 
          EXTRACT(HOUR FROM "createdAt")::int as hour,
          SUM(total)::float as revenue,
          COUNT(id)::int as orders
        FROM orders
        WHERE "restaurantId" = ${restaurant.id}
          AND "createdAt" >= ${today}
          AND status != 'CANCELLED'
          AND "deletedAt" IS NULL
        GROUP BY EXTRACT(HOUR FROM "createdAt")
        ORDER BY hour ASC
      `,
    ]);

    const topItemIds = topItems.map((t) => t.menuItemId);
    const topItemsWithNames = await prisma.menuItem.findMany({
      where: { id: { in: topItemIds } },
      select: { id: true, name: true },
    });

    const topItemsFormatted = topItems.map((t) => ({
      name: topItemsWithNames.find((i) => i.id === t.menuItemId)?.name ?? 'Unknown',
      quantity: t._sum.quantity ?? 0,
      revenue: t._sum.subtotal ?? 0,
    }));

    const todayHourlyEarnings = Array.from({ length: 24 }, (_, h) => {
      const found = todayHourlyRaw.find((item) => Number(item.hour) === h);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const formattedHour = `${h % 12 === 0 ? 12 : h % 12} ${ampm}`;
      return {
        hour: formattedHour,
        rawHour: h,
        revenue: found ? Number(found.revenue) : 0,
        orders: found ? Number(found.orders) : 0,
      };
    });

    const currentHour = new Date().getHours();
    const activeHours = Math.max(1, currentHour + 1);
    const todayRevenueVal = todayStats._sum.total ?? 0;
    const todayHourlyAverage = todayRevenueVal > 0 ? todayRevenueVal / activeHours : 0;

    res.json({
      success: true,
      data: {
        revenueData,
        topItems: topItemsFormatted,
        reviewStats: {
          avgRating: reviewStats._avg.rating ?? 0,
          totalReviews: reviewStats._count.rating,
        },
        summaryStats: {
          todayRevenue: todayRevenueVal,
          todayOrders: todayStats._count.id,
          monthlyRevenue: monthlyStats._sum.total ?? 0,
          monthlyOrders: monthlyStats._count.id,
          todayHourlyAverage,
        },
        todayHourlyEarnings,
      },
    });
  } catch (error) { next(error); }
}

export async function seedDemoMenu(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);

    const sampleCategories = [
      {
        name: 'Starters',
        sortOrder: 0,
        items: [
          { name: 'Paneer Tikka', description: 'Soft paneer cubes marinated in spiced yogurt and grilled to perfection in tandoor.', price: 240, isVeg: true, badges: ['POPULAR', 'BEST_SELLER'], image: 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?q=80&w=800&auto=format&fit=crop' },
          { name: 'Crispy Corn', description: 'Crunchy sweet corn kernels tossed with Indian spices, fresh lime and coriander.', price: 180, isVeg: true, badges: ['TRENDING'], image: 'https://images.unsplash.com/photo-1551782450-a2132b4ba21d?q=80&w=800&auto=format&fit=crop' },
          { name: 'Chicken 65', description: 'Spicy, deep-fried chicken bites tossed with curry leaves and green chilies.', price: 280, isVeg: false, badges: ['POPULAR'], image: 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?q=80&w=800&auto=format&fit=crop' },
          { name: 'Tandoori Chicken', description: 'Whole chicken marinated in mustard oil, lemon juice & spices, roasted over charcoal.', price: 320, isVeg: false, badges: ['BEST_SELLER'], image: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?q=80&w=800&auto=format&fit=crop' },
          { name: 'Veg Spring Rolls', description: 'Crispy golden rolls stuffed with shredded vegetables & glass noodles.', price: 190, isVeg: true, badges: ['NEW'], image: 'https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=800&auto=format&fit=crop' },
          { name: 'Hara Bhara Kebab', description: 'Pan-fried spinach, green peas and potato patties infused with aromatic herbs.', price: 210, isVeg: true, badges: ['POPULAR'], image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=800&auto=format&fit=crop' },
        ],
      },
      {
        name: 'Main Course',
        sortOrder: 1,
        items: [
          { name: 'Butter Chicken', description: 'Tender chicken pieces cooked in a rich, creamy tomato butter gravy.', price: 350, isVeg: false, badges: ['BEST_SELLER'], image: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?q=80&w=800&auto=format&fit=crop' },
          { name: 'Dal Makhani', description: 'Slow-cooked black lentils simmered overnight with butter and fresh cream.', price: 260, isVeg: true, badges: ['POPULAR'], image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=800&auto=format&fit=crop' },
          { name: 'Paneer Butter Masala', description: 'Cottage cheese cubes cooked in an aromatic, spiced tomato cream sauce.', price: 320, isVeg: true, badges: ['NEW'], image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?q=80&w=800&auto=format&fit=crop' },
          { name: 'Kadai Paneer', description: 'Fresh paneer tossed with capsicum, onion, and coarse Indian spices in a wok.', price: 310, isVeg: true, badges: ['TRENDING'], image: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?q=80&w=800&auto=format&fit=crop' },
          { name: 'Mutton Rogan Josh', description: 'Authentic Kashmiri style tender lamb curry slow cooked with saffron and spices.', price: 440, isVeg: false, badges: ['BEST_SELLER'], image: 'https://images.unsplash.com/photo-1545247181-516773cae754?q=80&w=800&auto=format&fit=crop' },
          { name: 'Malai Kofta', description: 'Melt-in-mouth cottage cheese and cashew dumplings in a rich white cashew curry.', price: 290, isVeg: true, badges: ['POPULAR'], image: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=800&auto=format&fit=crop' },
        ],
      },
      {
        name: 'Breads & Rice',
        sortOrder: 2,
        items: [
          { name: 'Butter Naan', description: 'Soft, fluffy tandoori flatbread brushed with fresh butter.', price: 50, isVeg: true, badges: [], image: 'https://images.unsplash.com/photo-1626074353765-517a681e40be?q=80&w=800&auto=format&fit=crop' },
          { name: 'Garlic Naan', description: 'Leavened Indian flatbread topped with minced garlic and herbs.', price: 65, isVeg: true, badges: ['POPULAR'], image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=800&auto=format&fit=crop' },
          { name: 'Hyderabadi Chicken Biryani', description: 'Fragrant basmati rice layered with marinated chicken and aromatic spices.', price: 340, isVeg: false, badges: ['BEST_SELLER'], image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=800&auto=format&fit=crop' },
          { name: 'Veg Dum Biryani', description: 'Slow cooked aromatic rice layered with farm fresh vegetables, saffron and mint.', price: 260, isVeg: true, badges: ['POPULAR'], image: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?q=80&w=800&auto=format&fit=crop' },
          { name: 'Jeera Rice', description: 'Aromatic long-grain basmati rice tempered with cumin seeds and ghee.', price: 150, isVeg: true, badges: [], image: 'https://images.unsplash.com/photo-1596797038530-2c107229654b?q=80&w=800&auto=format&fit=crop' },
        ],
      },
      {
        name: 'Desserts',
        sortOrder: 3,
        items: [
          { name: 'Gulab Jamun', description: 'Warm milk-solid dumplings soaked in cardamom sugar syrup.', price: 120, isVeg: true, badges: ['BEST_SELLER'], image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=800&auto=format&fit=crop' },
          { name: 'Rasmalai', description: 'Soft flattened paneer discs soaked in chilled saffron flavored sweet milk.', price: 140, isVeg: true, badges: ['POPULAR'], image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?q=80&w=800&auto=format&fit=crop' },
          { name: 'Matka Kulfi', description: 'Traditional thick Indian ice cream infused with pistachios & cardamom.', price: 100, isVeg: true, badges: ['TRENDING'], image: 'https://images.unsplash.com/photo-1570197788417-0e82375c9371?q=80&w=800&auto=format&fit=crop' },
        ],
      },
      {
        name: 'Beverages',
        sortOrder: 4,
        items: [
          { name: 'Mango Lassi', description: 'Creamy yogurt drink blended with sweet Alphonso mangoes.', price: 110, isVeg: true, badges: ['POPULAR'], image: 'https://images.unsplash.com/photo-1546173159-315724a31696?q=80&w=800&auto=format&fit=crop' },
          { name: 'Fresh Lime Soda', description: 'Refreshing sparkling soda infused with freshly squeezed lime and mint.', price: 80, isVeg: true, badges: [], image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?q=80&w=800&auto=format&fit=crop' },
          { name: 'Masala Chai', description: 'Aromatic Indian tea brewed with whole spices, milk and ginger.', price: 40, isVeg: true, badges: [], image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?q=80&w=800&auto=format&fit=crop' },
        ],
      },
    ];

    for (const cat of sampleCategories) {
      let existingCat = await prisma.menuCategory.findFirst({
        where: { restaurantId: restaurant.id, name: cat.name },
      });

      if (!existingCat) {
        existingCat = await prisma.menuCategory.create({
          data: { name: cat.name, restaurantId: restaurant.id, sortOrder: cat.sortOrder },
        });
      }

      for (const item of cat.items) {
        const itemExists = await prisma.menuItem.findFirst({
          where: { restaurantId: restaurant.id, name: item.name, deletedAt: null },
        });

        if (!itemExists) {
          await prisma.menuItem.create({
            data: {
              name: item.name,
              description: item.description,
              price: item.price,
              categoryId: existingCat.id,
              restaurantId: restaurant.id,
              isVeg: item.isVeg,
              isAvailable: true,
              badges: item.badges as any,
              image: item.image,
            },
          });
        } else {
          // Force update image so no items remain without food image
          await prisma.menuItem.update({
            where: { id: itemExists.id },
            data: { image: item.image },
          });
        }
      }
    }

    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, message: 'Sample demo menu loaded successfully!' });
  } catch (error) {
    next(error);
  }
}

export async function signTable(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const table = req.query.table as string;
    if (!table) {
      throw new AppError('Table number is required.', 400, 'BAD_REQUEST');
    }
    const signature = generateTableSignature(restaurant.id, table);
    res.json({ success: true, data: { signature } });
  } catch (error) {
    next(error);
  }
}

// ── Get Restaurant Reviews ──────────────────────────────────────────

export async function getRestaurantReviews(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);

    const reviews = await prisma.review.findMany({
      where: { restaurantId: restaurant.id },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true, email: true } },
        order: { select: { id: true, guestName: true, total: true } },
      },
    });

    const aggregate = await prisma.review.aggregate({
      where: { restaurantId: restaurant.id },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const breakdown = await prisma.review.groupBy({
      by: ['rating'],
      where: { restaurantId: restaurant.id },
      _count: { rating: true },
    });

    const starBreakdown = {
      1: breakdown.find((b) => b.rating === 1)?._count.rating ?? 0,
      2: breakdown.find((b) => b.rating === 2)?._count.rating ?? 0,
      3: breakdown.find((b) => b.rating === 3)?._count.rating ?? 0,
      4: breakdown.find((b) => b.rating === 4)?._count.rating ?? 0,
      5: breakdown.find((b) => b.rating === 5)?._count.rating ?? 0,
    };

    res.json({
      success: true,
      data: {
        reviews,
        stats: {
          avgRating: aggregate._avg.rating ?? 0,
          totalReviews: aggregate._count.rating ?? 0,
          starBreakdown,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

