import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { uploadMenuItemImage, uploadRestaurantLogo, uploadRestaurantBanner } from '../services/cloudinary.service';
import { emitOrderStatusUpdate, emitNotification } from '../services/socket.service';
import { cacheDelPattern, cacheSet } from '../services/redis.service';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';

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

    const [todayStats, recentOrders, orderStatusBreakdown, last7DaysRevenue] = await Promise.all([
      prisma.order.aggregate({
        where: { restaurantId: restaurant.id, createdAt: { gte: today } },
        _count: { id: true },
        _sum: { total: true },
        _avg: { total: true },
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
    ]);

    const pendingOrders = orderStatusBreakdown.find((s) => s.status === 'PENDING')?._count.status ?? 0;

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
          todayRevenue: todayStats._sum.total ?? 0,
          todayOrders: todayStats._count.id,
          pendingOrders,
          avgOrderValue: todayStats._avg.total ?? 0,
        },
        recentOrders,
        orderStatusBreakdown,
        last7DaysRevenue,
      },
    });
  } catch (error) { next(error); }
}

// ── Restaurant Profile ────────────────────────────────────────

export async function getRestaurant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    res.json({ success: true, data: { restaurant } });
  } catch (error) { next(error); }
}

export async function updateRestaurant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const updated = await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: req.body as Record<string, unknown>,
    });
    await cacheDelPattern(`menu:${restaurant.slug}*`);
    res.json({ success: true, data: { restaurant: updated }, message: 'Restaurant updated' });
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
    const { status, reason } = req.body as { status: string; reason?: string };

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

    const updateData: Record<string, any> = {
      status: status as 'CONFIRMED' | 'PREPARING' | 'BAKING' | 'READY' | 'ON_THE_WAY' | 'DELIVERED' | 'CANCELLED',
    };
    const dateField = statusDateFields[status];
    if (dateField) {
      updateData[dateField] = new Date();
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: updateData,
    });

    // Emit real-time update via Socket.io
    emitOrderStatusUpdate(id, restaurant.id, {
      orderId: id,
      status: updatedOrder.status,
      updatedAt: updatedOrder.updatedAt.toISOString(),
    });

    // Notify customer
    if (order.userId) {
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

    res.json({
      success: true,
      data: { order: { id: updatedOrder.id, status: updatedOrder.status } },
      message: `Order status updated to ${status}`,
    });
  } catch (error) { next(error); }
}

// ── Analytics ──────────────────────────────────────────────────

export async function getAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const restaurant = await getOwnerRestaurant(req.user!.id);
    const { period = '7d' } = req.query as { period?: string };

    const days = period === '30d' ? 30 : 7;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [revenueData, topItems, reviewStats] = await Promise.all([
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

    res.json({
      success: true,
      data: {
        revenueData,
        topItems: topItemsFormatted,
        reviewStats: {
          avgRating: reviewStats._avg.rating ?? 0,
          totalReviews: reviewStats._count.rating,
        },
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
          { name: 'Paneer Tikka', description: 'Soft paneer cubes marinated in spiced yogurt and grilled to perfection.', price: 240, isVeg: true, badges: ['POPULAR', 'BEST_SELLER'] },
          { name: 'Crispy Corn', description: 'Crunchy sweet corn kernels tossed with Indian spices and fresh lime.', price: 180, isVeg: true, badges: ['TRENDING'] },
          { name: 'Chicken 65', description: 'Spicy, deep-fried chicken bites tossed with curry leaves and green chilies.', price: 280, isVeg: false, badges: ['POPULAR'] },
        ],
      },
      {
        name: 'Main Course',
        sortOrder: 1,
        items: [
          { name: 'Butter Chicken', description: 'Tender chicken pieces cooked in a rich, creamy tomato butter gravy.', price: 350, isVeg: false, badges: ['BEST_SELLER'] },
          { name: 'Dal Makhani', description: 'Slow-cooked black lentils simmered overnight with butter and fresh cream.', price: 260, isVeg: true, badges: ['POPULAR'] },
          { name: 'Paneer Butter Masala', description: 'Cottage cheese cubes cooked in a aromatic, spiced tomato cream sauce.', price: 320, isVeg: true, badges: ['NEW'] },
        ],
      },
      {
        name: 'Breads & Rice',
        sortOrder: 2,
        items: [
          { name: 'Butter Naan', description: 'Soft, fluffy tandoori flatbread brushed with fresh butter.', price: 50, isVeg: true, badges: [] },
          { name: 'Garlic Naan', description: 'Leavened Indian flatbread topped with minced garlic and herbs.', price: 65, isVeg: true, badges: ['POPULAR'] },
          { name: 'Hyderabadi Chicken Biryani', description: 'Fragrant basmati rice layered with marinated chicken and aromatic spices.', price: 340, isVeg: false, badges: ['BEST_SELLER'] },
        ],
      },
      {
        name: 'Desserts & Drinks',
        sortOrder: 3,
        items: [
          { name: 'Gulab Jamun', description: 'Warm milk-solid dumplings soaked in cardamom sugar syrup.', price: 120, isVeg: true, badges: ['BEST_SELLER'] },
          { name: 'Mango Lassi', description: 'Creamy yogurt drink blended with sweet Alphonso mangoes.', price: 110, isVeg: true, badges: ['POPULAR'] },
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
            },
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

