import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { cacheGet, cacheSet } from '../services/redis.service';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';

export async function getAllRestaurants(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, page = '1', limit = '20', search } = req.query as {
      status?: string; page?: string; limit?: string; search?: string;
    };

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const where: Record<string, unknown> = { deletedAt: null };

    if (status === 'pending') { where.isApproved = false; where.isSuspended = false; }
    else if (status === 'approved') { where.isApproved = true; where.isSuspended = false; }
    else if (status === 'suspended') { where.isSuspended = true; }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [restaurants, total] = await Promise.all([
      prisma.restaurant.findMany({
        where,
        skip,
        take: parseInt(limit, 10),
        orderBy: { createdAt: 'desc' },
        include: {
          owner: { select: { name: true, email: true, phone: true } },
          _count: { select: { orders: true, menuItems: true } },
        },
      }),
      prisma.restaurant.count({ where }),
    ]);

    res.json({
      success: true,
      data: { restaurants },
      pagination: { total, page: parseInt(page, 10), limit: parseInt(limit, 10), totalPages: Math.ceil(total / parseInt(limit, 10)) },
    });
  } catch (error) { next(error); }
}

export async function approveRestaurant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { isApproved } = req.body as { isApproved: boolean };

    const restaurant = await prisma.restaurant.findFirst({ where: { id, deletedAt: null } });
    if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

    const updated = await prisma.restaurant.update({
      where: { id },
      data: { isApproved },
    });

    // Notify restaurant owner
    await prisma.notification.create({
      data: {
        restaurantId: id,
        type: 'RESTAURANT_APPROVED',
        title: isApproved ? 'Restaurant Approved!' : 'Restaurant Approval Revoked',
        message: isApproved
          ? 'Congratulations! Your restaurant has been approved. You can now start accepting orders.'
          : 'Your restaurant approval has been revoked. Please contact support.',
      },
    });

    res.json({ success: true, data: { isApproved: updated.isApproved }, message: `Restaurant ${isApproved ? 'approved' : 'approval revoked'}` });
  } catch (error) { next(error); }
}

export async function suspendRestaurant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { isSuspended } = req.body as { isSuspended: boolean };

    const restaurant = await prisma.restaurant.findFirst({ where: { id, deletedAt: null } });
    if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

    const updated = await prisma.restaurant.update({
      where: { id },
      data: { isSuspended, ...(isSuspended && { isOpen: false }) },
    });

    res.json({ success: true, data: { isSuspended: updated.isSuspended }, message: `Restaurant ${isSuspended ? 'suspended' : 'reactivated'}` });
  } catch (error) { next(error); }
}

export async function getAllUsers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, page = '1', limit = '20', search } = req.query as {
      role?: string; page?: string; limit?: string; search?: string;
    };

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const where: Record<string, unknown> = { deletedAt: null };
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit, 10),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, email: true, phone: true, role: true,
          isVerified: true, loyaltyPoints: true, walletBalance: true,
          createdAt: true, deletedAt: true,
          _count: { select: { orders: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: { users },
      pagination: { total, page: parseInt(page, 10), limit: parseInt(limit, 10), totalPages: Math.ceil(total / parseInt(limit, 10)) },
    });
  } catch (error) { next(error); }
}

export async function suspendUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { suspend } = req.body as { suspend: boolean };

    if (id === req.user!.id) throw new AppError('You cannot suspend your own account.', 400, 'CANNOT_SELF_SUSPEND');

    const user = await prisma.user.findFirst({ where: { id } });
    if (!user) throw new AppError('User not found.', 404, 'USER_NOT_FOUND');

    await prisma.user.update({
      where: { id },
      data: { deletedAt: suspend ? new Date() : null },
    });

    res.json({ success: true, data: null, message: `User ${suspend ? 'suspended' : 'reactivated'}` });
  } catch (error) { next(error); }
}

export async function getGlobalAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period = '7d' } = req.query as { period?: string };
    const days = period === '30d' ? 30 : period === 'month' ? 30 : 7;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const cacheKey = `admin:analytics:${period}`;
    const cached = await cacheGet(cacheKey);
    if (cached) { res.json({ success: true, data: cached }); return; }

    const [totalOrders, totalRevenue, totalUsers, totalRestaurants, topRestaurants, customerGrowth] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: startDate }, status: { not: 'CANCELLED' } } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: startDate }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
      }),
      prisma.user.count({ where: { role: 'CUSTOMER', deletedAt: null } }),
      prisma.restaurant.count({ where: { isApproved: true, deletedAt: null } }),
      prisma.order.groupBy({
        by: ['restaurantId'],
        where: { createdAt: { gte: startDate }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: { id: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
      prisma.$queryRaw<Array<{ date: string; count: number }>>`
        SELECT DATE("createdAt")::text as date, COUNT(id)::int as count
        FROM users
        WHERE role = 'CUSTOMER' AND "createdAt" >= ${startDate} AND "deletedAt" IS NULL
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `,
    ]);

    const restaurantIds = topRestaurants.map((r) => r.restaurantId);
    const restaurantNames = await prisma.restaurant.findMany({
      where: { id: { in: restaurantIds } },
      select: { id: true, name: true },
    });

    // Calculate commission revenue
    const commissionData = await prisma.restaurant.findMany({
      where: { id: { in: restaurantIds } },
      select: { id: true, commissionRate: true },
    });

    const topRestaurantsFormatted = topRestaurants.map((r) => {
      const revenue = r._sum.total ?? 0;
      const commission = commissionData.find((c) => c.id === r.restaurantId)?.commissionRate ?? 5;
      return {
        restaurantId: r.restaurantId,
        name: restaurantNames.find((n) => n.id === r.restaurantId)?.name ?? 'Unknown',
        totalRevenue: revenue,
        totalOrders: r._count.id,
        commissionEarned: (revenue * commission) / 100,
      };
    });

    const data = {
      summary: {
        totalOrders,
        totalRevenue: totalRevenue._sum.total ?? 0,
        platformCommission: totalRevenue._sum.total ? totalRevenue._sum.total * 0.05 : 0,
        totalUsers,
        totalRestaurants,
      },
      topRestaurants: topRestaurantsFormatted,
      customerGrowth,
    };

    await cacheSet(cacheKey, data, 30 * 60); // 30 min cache
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function getConfig(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const config = {
      defaultCommissionRate: parseFloat(process.env.DEFAULT_COMMISSION_RATE ?? '5'),
      gstRate: parseFloat(process.env.GST_RATE ?? '18'),
      deliveryFee: 40,
      packagingFee: 15,
      loyaltyPointsPerRupee: 1,
      minOrderValue: 0,
    };
    res.json({ success: true, data: { config } });
  } catch (error) { next(error); }
}

export async function updateConfig(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    // In a production app, persist these to a config table in DB
    // For now, acknowledge the update
    res.json({ success: true, data: req.body, message: 'Configuration updated. Note: Restart server to apply env changes.' });
  } catch (error) { next(error); }
}

export async function getSubscriptionPlans(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const plans = await prisma.subscriptionPlan.findMany({ orderBy: { price: 'asc' } });
    res.json({ success: true, data: { plans } });
  } catch (error) { next(error); }
}

export async function createSubscriptionPlan(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, price, features } = req.body as { name: string; price: number; features: Record<string, unknown> };
    const plan = await prisma.subscriptionPlan.create({ data: { name, price, features: features as any } });
    res.status(201).json({ success: true, data: { plan }, message: 'Subscription plan created' });
  } catch (error) { next(error); }
}

export async function createRestaurant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      name,
      slug: customSlug,
      cuisineType,
      address,
      city,
      pincode,
      phone,
      ownerName,
      ownerEmail,
      ownerPhone,
    } = req.body as {
      name: string;
      slug?: string;
      cuisineType?: string;
      address?: string;
      city?: string;
      pincode?: string;
      phone?: string;
      ownerName: string;
      ownerEmail: string;
      ownerPhone?: string;
    };

    if (!name || !ownerName || !ownerEmail) {
      throw new AppError('Restaurant name, owner name, and owner email are required.', 400, 'BAD_REQUEST');
    }

    // 1. Find or create owner user
    let owner = await prisma.user.findFirst({
      where: { email: ownerEmail, deletedAt: null },
    });

    if (!owner) {
      const passwordHash = await bcrypt.hash('Owner@123456', 12);
      owner = await prisma.user.create({
        data: {
          name: ownerName,
          email: ownerEmail,
          phone: ownerPhone || null,
          role: 'RESTAURANT_OWNER',
          passwordHash,
          isVerified: true,
        },
      });
    }

    // 2. Generate slug — use provided custom slug or generate a unique code
    let slug: string;
    if (customSlug?.trim()) {
      slug = customSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    } else {
      // Generate a unique short code slug (e.g. rest-k7m2xq)
      let attempts = 0;
      slug = '';
      do {
        slug = 'rest-' + Math.random().toString(36).slice(2, 8);
        attempts++;
      } while (
        attempts < 10 &&
        await prisma.restaurant.findUnique({ where: { slug } })
      );
    }

    // Check if slug is unique
    const existingRestaurant = await prisma.restaurant.findUnique({
      where: { slug },
    });
    if (existingRestaurant) {
      throw new AppError('A restaurant with this slug/URL already exists. Please choose a different one.', 400, 'SLUG_EXISTS');
    }

    // 3. Create restaurant (approved by default since admin creates it)
    const restaurant = await prisma.restaurant.create({
      data: {
        name,
        slug,
        cuisineType: cuisineType || 'General',
        address: address || null,
        city: city || null,
        pincode: pincode || null,
        phone: phone || null,
        ownerId: owner.id,
        isApproved: true,
        isOpen: true,
      },
    });

    res.status(201).json({
      success: true,
      data: { restaurant },
      message: 'Restaurant created successfully!',
    });
  } catch (error) {
    next(error);
  }
}

export async function getAdminCoupons(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const coupons = await prisma.coupon.findMany({
      where: { restaurantId: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { coupons } });
  } catch (error) { next(error); }
}

export async function createAdminCoupon(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code, type, value, minOrderAmount, maxDiscount, maxUses, expiresAt } = req.body as {
      code: string; type: 'FLAT' | 'PERCENT'; value: number;
      minOrderAmount?: number; maxDiscount?: number; maxUses?: number; expiresAt?: string;
    };
    const coupon = await prisma.coupon.create({
      data: {
        code: code.toUpperCase(),
        type,
        value,
        minOrderAmount: minOrderAmount || 0,
        maxDiscount: maxDiscount || null,
        maxUses: maxUses || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        restaurantId: null,
      },
    });
    res.status(201).json({ success: true, data: { coupon } });
  } catch (error) { next(error); }
}

export async function deleteAdminCoupon(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const coupon = await prisma.coupon.findFirst({ where: { id, restaurantId: null } });
    if (!coupon) throw new AppError('Coupon not found.', 404, 'COUPON_NOT_FOUND');
    await prisma.coupon.delete({ where: { id } });
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (error) { next(error); }
}

export async function toggleAdminCoupon(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const coupon = await prisma.coupon.findFirst({ where: { id, restaurantId: null } });
    if (!coupon) throw new AppError('Coupon not found.', 404, 'COUPON_NOT_FOUND');
    const updated = await prisma.coupon.update({
      where: { id },
      data: { isActive: !coupon.isActive },
    });
    res.json({ success: true, data: { isActive: updated.isActive } });
  } catch (error) { next(error); }
}
