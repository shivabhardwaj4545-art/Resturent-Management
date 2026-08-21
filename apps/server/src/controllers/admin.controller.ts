import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';
import { cacheGet, cacheSet, cacheDelPattern } from '../services/redis.service';
import { emitNotification } from '../services/socket.service';
import {
  sendBroadcastEmail,
  sendRestaurantWelcomeEmail,
  sendRestaurantApprovalEmail,
} from '../services/email.service';
import type { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

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
    const body = (req.body || {}) as { isApproved?: boolean };

    const restaurant = await prisma.restaurant.findFirst({
      where: { id, deletedAt: null },
      include: { owner: true },
    });
    if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

    const isApproved = typeof body.isApproved === 'boolean' ? body.isApproved : !restaurant.isApproved;

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

    // Send email notification to restaurant owner
    if (restaurant.owner?.email) {
      sendRestaurantApprovalEmail(
        restaurant.owner.email,
        restaurant.owner.name,
        restaurant.name,
        isApproved,
        restaurant.slug
      ).catch((err) => {
        logger.error(`Failed to send restaurant approval email to ${restaurant.owner?.email}:`, err);
      });
    }

    res.json({ success: true, data: { isApproved: updated.isApproved }, message: `Restaurant ${isApproved ? 'approved' : 'approval revoked'}` });
  } catch (error) { next(error); }
}

export async function suspendRestaurant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const body = (req.body || {}) as { isSuspended?: boolean };

    const restaurant = await prisma.restaurant.findFirst({ where: { id, deletedAt: null } });
    if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

    const isSuspended = typeof body.isSuspended === 'boolean' ? body.isSuspended : !restaurant.isSuspended;

    const updated = await prisma.restaurant.update({
      where: { id },
      data: { isSuspended, ...(isSuspended && { isOpen: false }) },
    });

    // Also update connected owner user suspension status (keep deletedAt null so user stays visible as Suspended)
    if (restaurant.ownerId) {
      await prisma.user.update({
        where: { id: restaurant.ownerId },
        data: { verifyToken: isSuspended ? 'SUSPENDED' : null, deletedAt: null },
      }).catch((err) => logger.warn('Failed to update owner user suspension:', err));
    }

    res.json({ success: true, data: { isSuspended: updated.isSuspended }, message: `Restaurant ${isSuspended ? 'suspended' : 'reactivated'}` });
  } catch (error) { next(error); }
}

export async function getAllUsers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, page = '1', limit = '15', search } = req.query as {
      role?: string; page?: string; limit?: string; search?: string;
    };

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const where: Record<string, unknown> = { deletedAt: null };

    if (role && role !== 'all') {
      where.role = role;
    }

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
          isVerified: true, verifyToken: true, loyaltyPoints: true, walletBalance: true,
          createdAt: true, deletedAt: true,
          restaurant: {
            select: { id: true, name: true, slug: true, isSuspended: true, deletedAt: true },
          },
          _count: { select: { orders: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const mappedUsers = users.map((u) => {
      const activeRest = u.restaurant?.find((r) => r.deletedAt === null) || u.restaurant?.[0];
      const isAnyRestSuspended = u.restaurant?.some((r) => r.isSuspended);
      return {
        ...u,
        isSuspended: Boolean(isAnyRestSuspended) || u.verifyToken === 'SUSPENDED',
        restaurantName: activeRest?.name ?? null,
        restaurantSlug: activeRest?.slug ?? null,
        restaurantId: activeRest?.id ?? null,
        email: u.email.includes(':') ? u.email.split(':')[1] : u.email,
      };
    });

    res.json({
      success: true,
      data: { users: mappedUsers },
      pagination: { total, page: parseInt(page, 10), limit: parseInt(limit, 10), totalPages: Math.ceil(total / parseInt(limit, 10)) },
    });
  } catch (error) { next(error); }
}

export async function suspendUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const body = (req.body || {}) as { suspend?: boolean };
    const { suspend } = body;

    if (id === req.user!.id) throw new AppError('You cannot suspend your own account.', 400, 'CANNOT_SELF_SUSPEND');

    const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new AppError('User not found.', 404, 'USER_NOT_FOUND');

    if (user.role === 'SUPER_ADMIN') {
      throw new AppError('Super Admin accounts cannot be suspended.', 400, 'CANNOT_SUSPEND_SUPER_ADMIN');
    }

    const rest = await prisma.restaurant.findFirst({ where: { ownerId: id, deletedAt: null } });
    const isCurrentlySuspended = Boolean(rest?.isSuspended) || user.verifyToken === 'SUSPENDED';
    const shouldSuspend = typeof suspend === 'boolean' ? suspend : !isCurrentlySuspended;

    await prisma.user.update({
      where: { id },
      data: { verifyToken: shouldSuspend ? 'SUSPENDED' : null },
    });

    if (user.role === 'RESTAURANT_OWNER') {
      await prisma.restaurant.updateMany({
        where: { ownerId: id },
        data: { isSuspended: shouldSuspend, ...(shouldSuspend && { isOpen: false }) },
      });
    }

    res.json({ success: true, data: { id, isSuspended: shouldSuspend }, message: `User ${shouldSuspend ? 'suspended' : 'reactivated'} successfully` });
  } catch (error) { next(error); }
}

export async function deleteUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    if (id === req.user!.id) throw new AppError('You cannot delete your own account.', 400, 'CANNOT_SELF_DELETE');

    const user = await prisma.user.findFirst({ where: { id } });
    if (!user) throw new AppError('User not found.', 404, 'USER_NOT_FOUND');

    const timestamp = Date.now();
    await prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        email: `deleted_${timestamp}_${user.email}`,
        googleId: user.googleId ? `deleted_${timestamp}_${user.googleId}` : null,
      },
    });

    // Also soft-delete and suspend any restaurant owned by this user
    await prisma.restaurant.updateMany({
      where: { ownerId: id },
      data: { deletedAt: new Date(), isApproved: false, isSuspended: true, isOpen: false },
    });

    res.json({ success: true, message: `User ${user.name} deleted successfully.` });
  } catch (error) { next(error); }
}

export async function getGlobalAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period = '7d' } = req.query as { period?: string };
    const days = period === '30d' ? 30 : period === 'month' ? 30 : 7;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totalOrders, totalRevenue, totalUsers, totalRestaurants, topRestaurants, customerGrowth] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: startDate }, status: { not: 'CANCELLED' } } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: startDate }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
      }),
      prisma.user.count({ where: { role: 'CUSTOMER', deletedAt: null } }),
      prisma.restaurant.count({ where: { deletedAt: null } }),
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
      ownerPassword,
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
      ownerPassword?: string;
    };

    if (!name || !ownerName || !ownerEmail) {
      throw new AppError('Restaurant name, owner name, and owner email are required.', 400, 'BAD_REQUEST');
    }

    const normalizedOwnerEmail = ownerEmail.toLowerCase().trim();

    // 1. Find existing user (active or soft-deleted)
    let owner = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedOwnerEmail },
          { email: { endsWith: `:${normalizedOwnerEmail}` } },
        ],
      },
    });

    let finalPassword: string | undefined = undefined;
    if (!owner) {
      finalPassword = ownerPassword?.trim() || 'Owner@123456';
      const passwordHash = await bcrypt.hash(finalPassword, 12);
      owner = await prisma.user.create({
        data: {
          name: ownerName,
          email: normalizedOwnerEmail,
          phone: ownerPhone || null,
          role: 'RESTAURANT_OWNER',
          passwordHash,
          isVerified: true,
        },
      });
    } else {
      // User exists (whether active or soft-deleted) -> Reactivate and assign RESTAURANT_OWNER role
      finalPassword = ownerPassword?.trim() || 'Owner@123456';
      const passwordHash = await bcrypt.hash(finalPassword, 12);
      owner = await prisma.user.update({
        where: { id: owner.id },
        data: {
          name: ownerName || owner.name,
          email: normalizedOwnerEmail,
          phone: ownerPhone || owner.phone,
          role: owner.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'RESTAURANT_OWNER',
          passwordHash,
          isVerified: true,
          deletedAt: null, // Unsuspend & reactivate account!
        },
      });
    }

    // 2. Generate slug — use provided custom slug or generate a unique code
    let slug: string;
    if (customSlug?.trim()) {
      slug = customSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    } else {
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

    // 4. Send email notification to owner containing restaurant details, ID, login email & password
    sendRestaurantWelcomeEmail(
      normalizedOwnerEmail,
      ownerName,
      {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        cuisineType: restaurant.cuisineType,
        city: restaurant.city,
        address: restaurant.address,
        phone: restaurant.phone,
      },
      finalPassword
    ).catch((err) => {
      logger.error(`Failed to send restaurant welcome email to ${normalizedOwnerEmail}:`, err);
    });

    res.status(201).json({
      success: true,
      data: { restaurant },
      message: 'Restaurant created successfully and notification email sent to owner!',
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteRestaurant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const restaurant = await prisma.restaurant.findFirst({
      where: { id, deletedAt: null },
    });
    if (!restaurant) {
      throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
    }

    await prisma.restaurant.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isApproved: false,
        isSuspended: true,
      },
    });

    if (restaurant.ownerId) {
      const timestamp = Date.now();
      await prisma.user.update({
        where: { id: restaurant.ownerId },
        data: {
          deletedAt: new Date(),
          email: `deleted_${timestamp}_owner`,
        },
      }).catch((err) => logger.warn('Failed to soft delete restaurant owner on restaurant deletion:', err));
    }

    await cacheDelPattern(`menu:${restaurant.slug}*`);

    res.json({
      success: true,
      message: `Restaurant "${restaurant.name}" deleted successfully.`,
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

export async function broadcastNotification(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const adminUserId = req.user!.id;
    const { title, message, targetRole } = req.body as { title: string; message: string; targetRole?: string };
    if (!title || !message) {
      throw new AppError('Title and message are required for broadcast.', 400, 'BAD_REQUEST');
    }

    const whereClause: any = { deletedAt: null };
    if (targetRole === 'ALL_OWNERS') {
      whereClause.role = 'RESTAURANT_OWNER';
    } else if (targetRole === 'ALL_CUSTOMERS') {
      whereClause.role = 'CUSTOMER';
    }

    const targetUsers = await prisma.user.findMany({
      where: whereClause,
      select: { id: true, role: true, email: true, restaurant: { select: { id: true } } },
    });

    let sentCount = 0;
    for (const u of targetUsers) {
      const userRestaurant = u.restaurant && u.restaurant[0];

      // 1. In-app Notification
      await prisma.notification.create({
        data: {
          userId: u.id,
          restaurantId: userRestaurant?.id ?? null,
          type: 'BROADCAST',
          title: `📢 ${title}`,
          message,
        },
      });

      // 2. Insert broadcast directly into 1-to-1 Owner Chat Thread (skip self)
      if (u.id !== adminUserId) {
        await prisma.directMessage.create({
          data: {
            senderId: adminUserId,
            receiverId: u.id,
            message: `📢 [BROADCAST ANNOUNCEMENT]\nTitle: ${title}\n\n${message}`,
          },
        });
      }

      // 3. Real-time Sockets
      emitNotification(u.id, {
        type: 'BROADCAST',
        title: `📢 ${title}`,
        message,
        createdAt: new Date().toISOString(),
      });
      sentCount++;
    }

    // 4. Send Email Broadcast to all recipients
    const recipientEmails = Array.from(
      new Set(
        targetUsers
          .map((u) => {
            if (!u.email) return '';
            const email = u.email.includes(':') ? u.email.split(':')[1] : u.email;
            return email.toLowerCase().trim();
          })
          .filter((email) => email && email.includes('@') && email.includes('.'))
      )
    );

    if (recipientEmails.length > 0) {
      sendBroadcastEmail(recipientEmails, `📢 ${title}`, message, 'Super Admin Platform Broadcast')
        .then((result) => logger.info(`Broadcast notification email dispatch complete: ${result.success} sent, ${result.failed} failed.`))
        .catch((err) => logger.error('Failed to send broadcast notification emails:', err));
    }

    res.json({
      success: true,
      message: `Broadcast notification & emails sent successfully to ${sentCount} users!`,
      data: { sentCount },
    });
  } catch (error) { next(error); }
}

export async function broadcastEmail(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const adminUserId = req.user!.id;
    const { subject, message, targetRole } = req.body as { subject: string; message: string; targetRole?: string };
    if (!subject || !message) {
      throw new AppError('Subject and email content are required.', 400, 'BAD_REQUEST');
    }

    let users: Array<{ id: string; email: string }> = [];

    if (targetRole === 'ALL_OWNERS') {
      const ownerUsers = await prisma.user.findMany({
        where: { role: 'RESTAURANT_OWNER', deletedAt: null },
        select: { id: true, email: true },
      });
      const restaurants = await prisma.restaurant.findMany({
        where: { deletedAt: null },
        select: { owner: { select: { id: true, email: true } } },
      });
      const restOwnerUsers = restaurants.map((r) => r.owner).filter(Boolean) as Array<{ id: string; email: string }>;

      const map = new Map<string, { id: string; email: string }>();
      [...ownerUsers, ...restOwnerUsers].forEach((u) => {
        if (u && u.email) {
          const clean = u.email.includes(':') ? u.email.split(':')[1] : u.email;
          const normalized = clean.toLowerCase().trim();
          if (normalized.includes('@') && normalized.includes('.')) {
            map.set(normalized, { id: u.id, email: normalized });
          }
        }
      });
      users = Array.from(map.values());
    } else if (targetRole === 'ALL_CUSTOMERS') {
      users = await prisma.user.findMany({
        where: { role: 'CUSTOMER', deletedAt: null },
        select: { id: true, email: true },
      });
    } else {
      users = await prisma.user.findMany({
        where: { deletedAt: null },
        select: { id: true, email: true },
      });
    }

    for (const u of users) {
      if (u.id && u.id !== adminUserId) {
        await prisma.directMessage.create({
          data: {
            senderId: adminUserId,
            receiverId: u.id,
            message: `📧 [MASS EMAIL ANNOUNCEMENT]\nSubject: ${subject}\n\n${message}`,
          },
        }).catch((err) => logger.warn('Failed to create direct message for broadcast:', err));
      }

      if (u.id) {
        emitNotification(u.id, {
          type: 'BROADCAST',
          title: `📧 ${subject}`,
          message,
          createdAt: new Date().toISOString(),
        });
      }
    }

    const recipientEmails = Array.from(
      new Set(
        users
          .map((u) => {
            if (!u.email) return '';
            const email = u.email.includes(':') ? u.email.split(':')[1] : u.email;
            return email.toLowerCase().trim();
          })
          .filter((email) => email && email.includes('@') && email.includes('.'))
      )
    );

    if (req.user?.email) {
      const reqEmail = req.user.email.includes(':') ? req.user.email.split(':')[1] : req.user.email;
      const normalizedReqEmail = reqEmail.toLowerCase().trim();
      if (normalizedReqEmail && !recipientEmails.includes(normalizedReqEmail)) {
        recipientEmails.push(normalizedReqEmail);
      }
    }
    const adminSmtpEmail = (process.env.SMTP_USER || process.env.SMTP_FROM_EMAIL || '').toLowerCase().trim();
    if (adminSmtpEmail && !recipientEmails.includes(adminSmtpEmail)) {
      recipientEmails.push(adminSmtpEmail);
    }

    logger.info(`Sending broadcast email to ${recipientEmails.length} recipients: ${recipientEmails.join(', ')}`);

    // Dispatch emails asynchronously in the background so that the API request returns instantly
    sendBroadcastEmail(recipientEmails, subject, message, 'Super Admin Platform Announcement')
      .then((result) => {
        logger.info(`Broadcast email complete: ${result.success} sent, ${result.failed} failed.`);
      })
      .catch((err) => {
        logger.error('Background email broadcast dispatch failed:', err);
      });

    res.json({
      success: true,
      message: `Broadcast email dispatch initiated for ${recipientEmails.length} recipient(s) (${recipientEmails.join(', ')})!`,
      data: { recipients: recipientEmails, count: recipientEmails.length },
    });
  } catch (error) { next(error); }
}

// ── Get Admin Reviews ──────────────────────────────────────────

export async function getAdminReviews(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reviews = await prisma.review.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true, email: true } },
        order: { select: { id: true, guestName: true, total: true } },
        restaurant: { select: { name: true, slug: true } },
      },
    });

    const aggregate = await prisma.review.aggregate({
      _avg: { rating: true },
      _count: { rating: true },
    });

    res.json({
      success: true,
      data: {
        reviews,
        stats: {
          avgRating: aggregate._avg.rating ?? 0,
          totalReviews: aggregate._count.rating ?? 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

// ── Loyalty Settings Management ──────────────────────────────

export const DEFAULT_LOYALTY_SETTINGS = {
  pointsPerSpendRupees: 10,
  pointsPerDiscountRupee: 50,
  minPointsToRedeem: 50,
  conversionRuleText: '50 Loyalty Points = ₹1.00 Discount. Every 50 points saved gives you ₹1 off your total bill!',
  increaseRuleText: 'Earn 1 point for every ₹10 spent. Points are credited to your account when the restaurant owner completes/confirms payment on your order.',
  decreaseRuleText: 'When placing an order, tick "Redeem Loyalty Points" on checkout. Points are deducted to give you an instant bill discount!',
};

export async function getLoyaltySettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'loyalty_settings' },
    });

    const value = setting?.value ? { ...DEFAULT_LOYALTY_SETTINGS, ...(setting.value as object) } : DEFAULT_LOYALTY_SETTINGS;
    res.json({ success: true, data: { settings: value } });
  } catch (error) { next(error); }
}

export async function updateLoyaltySettings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      pointsPerSpendRupees,
      pointsPerDiscountRupee,
      minPointsToRedeem,
      conversionRuleText,
      increaseRuleText,
      decreaseRuleText,
    } = req.body as Record<string, any>;

    const existing = await prisma.systemSetting.findUnique({
      where: { key: 'loyalty_settings' },
    });

    const currentVal = existing?.value ? (existing.value as Record<string, any>) : DEFAULT_LOYALTY_SETTINGS;

    const updatedValue = {
      ...currentVal,
      ...(pointsPerSpendRupees !== undefined && { pointsPerSpendRupees: Number(pointsPerSpendRupees) || 10 }),
      ...(pointsPerDiscountRupee !== undefined && { pointsPerDiscountRupee: Number(pointsPerDiscountRupee) || 50 }),
      ...(minPointsToRedeem !== undefined && { minPointsToRedeem: Number(minPointsToRedeem) || 50 }),
      ...(conversionRuleText && { conversionRuleText: String(conversionRuleText) }),
      ...(increaseRuleText && { increaseRuleText: String(increaseRuleText) }),
      ...(decreaseRuleText && { decreaseRuleText: String(decreaseRuleText) }),
    };

    const setting = await prisma.systemSetting.upsert({
      where: { key: 'loyalty_settings' },
      update: { value: updatedValue },
      create: { key: 'loyalty_settings', value: updatedValue },
    });

    res.json({ success: true, data: { settings: setting.value }, message: 'Loyalty settings updated successfully' });
  } catch (error) { next(error); }
}
