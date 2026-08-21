import { UserRole, ItemBadge } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { logger } from './logger';

export async function syncDatabaseSchema(): Promise<void> {
  const statements = [
    // Restaurant columns
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "paymentQrCode" TEXT',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "paymentUpiId" TEXT',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "paymentPhone" TEXT',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "bankName" TEXT',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "bankAccountNumber" TEXT',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "bankIfsc" TEXT',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "bankAccountHolder" TEXT',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN DEFAULT false',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "hasDelivery" BOOLEAN DEFAULT true',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "themeColor" TEXT',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "menuTemplate" TEXT DEFAULT \'modern\'',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "customFields" JSONB',
    'ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "commissionRate" DOUBLE PRECISION DEFAULT 5',

    // User columns
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verifyToken" TEXT',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verifyTokenExp" TIMESTAMP',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resetToken" TEXT',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resetTokenExp" TIMESTAMP',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleId" TEXT',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "loyaltyPoints" INT DEFAULT 0',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "walletBalance" DOUBLE PRECISION DEFAULT 0',

    // System settings table
    'CREATE TABLE IF NOT EXISTS "system_settings" ("id" TEXT NOT NULL PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "value" JSONB NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',

    // Order columns
    'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tableToken" TEXT',
    'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "guestName" TEXT',
    'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "guestPhone" TEXT',
    'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "commissionAmount" DOUBLE PRECISION DEFAULT 0',
    'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP',
  ];

  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err: any) {
      logger.warn(`Schema sync statement warning (${sql}):`, err?.message || err);
    }
  }
  logger.info('✅ Database schema auto-synchronized successfully.');
}

export async function ensureDatabaseSeeded(): Promise<void> {
  try {
    await syncDatabaseSchema();

    const adminEmail = process.env.SUPER_ADMIN_EMAIL ?? 'admin@qrrestaurant.com';
    const adminExists = await prisma.user.findFirst({
      where: { email: adminEmail },
    });

    const upstatesRestaurant = await prisma.restaurant.findFirst({
      where: { slug: 'upstates' },
    });

    if (adminExists && upstatesRestaurant) {
      logger.info('🌱 Database seed check: Super admin & demo restaurant upstates already exist.');
      return;
    }

    logger.info('🌱 Auto-seeding database with live default credentials and demo restaurant upstates...');

    // 1. Super Admin
    const adminPasswordHash = await bcrypt.hash(
      process.env.SUPER_ADMIN_PASSWORD ?? 'Admin@123456',
      12
    );

    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        passwordHash: adminPasswordHash,
        isVerified: true,
      },
      create: {
        name: process.env.SUPER_ADMIN_NAME ?? 'Platform Admin',
        email: adminEmail,
        passwordHash: adminPasswordHash,
        role: UserRole.SUPER_ADMIN,
        isVerified: true,
      },
    });

    // 2. Restaurant Owner
    const ownerPasswordHash = await bcrypt.hash('Owner@123456', 12);
    const owner = await prisma.user.upsert({
      where: { email: 'owner@upstates.com' },
      update: {
        passwordHash: ownerPasswordHash,
        isVerified: true,
      },
      create: {
        name: 'Rajan Sharma',
        email: 'owner@upstates.com',
        passwordHash: ownerPasswordHash,
        phone: '9876543210',
        role: UserRole.RESTAURANT_OWNER,
        isVerified: true,
      },
    });

    // 3. Sample Customer
    const customerPasswordHash = await bcrypt.hash('Customer@123', 12);
    const customer = await prisma.user.upsert({
      where: { email: 'customer@example.com' },
      update: {
        passwordHash: customerPasswordHash,
        isVerified: true,
      },
      create: {
        name: 'Priya Mehta',
        email: 'customer@example.com',
        passwordHash: customerPasswordHash,
        phone: '9876543211',
        role: UserRole.CUSTOMER,
        isVerified: true,
        loyaltyPoints: 150,
        walletBalance: 200,
      },
    });

    // 4. Upstates Restaurant
    const restaurant = await prisma.restaurant.upsert({
      where: { slug: 'upstates' },
      update: {
        isApproved: true,
        isOpen: true,
      },
      create: {
        name: 'Upstates',
        slug: 'upstates',
        description: 'A premium dining experience featuring authentic North Indian and Mughlai cuisine in a warm, welcoming ambiance.',
        cuisineType: 'North Indian, Mughlai',
        logo: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?q=80&w=200&auto=format&fit=crop',
        banner: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?q=80&w=1200&auto=format&fit=crop',
        address: '42, Connaught Place',
        city: 'New Delhi',
        pincode: '110001',
        phone: '9876543210',
        isOpen: true,
        isApproved: true,
        minOrderValue: 200,
        deliveryRadius: 10,
        commissionRate: 5,
        themeColor: '#E85D04',
        ownerId: owner.id,
      },
    });

    // Check if menu categories exist for Upstates
    const catCount = await prisma.menuCategory.count({
      where: { restaurantId: restaurant.id },
    });

    if (catCount === 0) {
      const starters = await prisma.menuCategory.create({
        data: { name: 'Starters', restaurantId: restaurant.id, sortOrder: 1 },
      });
      const mainCourse = await prisma.menuCategory.create({
        data: { name: 'Main Course', restaurantId: restaurant.id, sortOrder: 2 },
      });
      const breads = await prisma.menuCategory.create({
        data: { name: 'Breads', restaurantId: restaurant.id, sortOrder: 3 },
      });
      const desserts = await prisma.menuCategory.create({
        data: { name: 'Desserts', restaurantId: restaurant.id, sortOrder: 4 },
      });
      const beverages = await prisma.menuCategory.create({
        data: { name: 'Beverages', restaurantId: restaurant.id, sortOrder: 5 },
      });

      await prisma.menuItem.createMany({
        data: [
          { name: 'Paneer Tikka', description: 'Marinated cottage cheese cubes grilled to perfection.', price: 320, categoryId: starters.id, restaurantId: restaurant.id, isVeg: true, isAvailable: true, badges: [ItemBadge.BEST_SELLER], image: 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?q=80&w=800&auto=format&fit=crop' },
          { name: 'Butter Chicken', description: 'Succulent chicken pieces simmered in a rich tomato sauce.', price: 420, categoryId: mainCourse.id, restaurantId: restaurant.id, isVeg: false, isAvailable: true, badges: [ItemBadge.BEST_SELLER], image: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?q=80&w=800&auto=format&fit=crop' },
          { name: 'Butter Naan', description: 'Soft leavened bread brushed with butter.', price: 60, categoryId: breads.id, restaurantId: restaurant.id, isVeg: true, isAvailable: true, badges: [ItemBadge.BEST_SELLER], image: 'https://images.unsplash.com/photo-1626074353765-517a681e40be?q=80&w=800&auto=format&fit=crop' },
          { name: 'Gulab Jamun', description: 'Soft milk dumplings in rose syrup.', price: 120, categoryId: desserts.id, restaurantId: restaurant.id, isVeg: true, isAvailable: true, badges: [ItemBadge.BEST_SELLER], image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=800&auto=format&fit=crop' },
          { name: 'Mango Lassi', description: 'Thick yogurt drink blended with Alphonso mangoes.', price: 120, categoryId: beverages.id, restaurantId: restaurant.id, isVeg: true, isAvailable: true, badges: [ItemBadge.POPULAR], image: 'https://images.unsplash.com/photo-1546173159-315724a31696?q=80&w=800&auto=format&fit=crop' },
        ],
      });
    }

    // Update ALL menu items in database with high quality food photos if missing or placeholder
    const allMenuItems = await prisma.menuItem.findMany({
      where: { deletedAt: null },
    });

    if (allMenuItems.length > 0) {
      for (const item of allMenuItems) {
        if (!item.image || item.image.includes('placeholder') || item.image.trim() === '') {
          let imageUrl = 'https://images.unsplash.com/photo-1540420773420-3366772f4999?q=80&w=800&auto=format&fit=crop';
          const nameLower = item.name.toLowerCase();
          if (nameLower.includes('paneer')) imageUrl = 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?q=80&w=800&auto=format&fit=crop';
          else if (nameLower.includes('chicken')) imageUrl = 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?q=80&w=800&auto=format&fit=crop';
          else if (nameLower.includes('naan') || nameLower.includes('roti') || nameLower.includes('bread')) imageUrl = 'https://images.unsplash.com/photo-1626074353765-517a681e40be?q=80&w=800&auto=format&fit=crop';
          else if (nameLower.includes('biryani') || nameLower.includes('rice')) imageUrl = 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=800&auto=format&fit=crop';
          else if (nameLower.includes('jamun') || nameLower.includes('dessert') || nameLower.includes('sweet') || nameLower.includes('rasmalai') || nameLower.includes('kulfi')) imageUrl = 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=800&auto=format&fit=crop';
          else if (nameLower.includes('lassi') || nameLower.includes('drink') || nameLower.includes('mango') || nameLower.includes('chai') || nameLower.includes('soda')) imageUrl = 'https://images.unsplash.com/photo-1546173159-315724a31696?q=80&w=800&auto=format&fit=crop';
          else if (nameLower.includes('corn')) imageUrl = 'https://images.unsplash.com/photo-1551782450-a2132b4ba21d?q=80&w=800&auto=format&fit=crop';
          else if (nameLower.includes('dal') || nameLower.includes('makhani')) imageUrl = 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=800&auto=format&fit=crop';
          else if (nameLower.includes('kebab') || nameLower.includes('roll') || nameLower.includes('tandoori')) imageUrl = 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?q=80&w=800&auto=format&fit=crop';
          else if (nameLower.includes('mutton') || nameLower.includes('curry') || nameLower.includes('kofta')) imageUrl = 'https://images.unsplash.com/photo-1545247181-516773cae754?q=80&w=800&auto=format&fit=crop';

          await prisma.menuItem.update({
            where: { id: item.id },
            data: { image: imageUrl },
          });
        }
      }
      logger.info(`📸 Ensured food photos for ${allMenuItems.length} menu items.`);
    }

    logger.info('🎉 Auto-seed complete! Super Admin (admin@qrrestaurant.com), Owner (owner@upstates.com), Customer (customer@example.com), and Restaurant /r/upstates are active.');
  } catch (error: any) {
    logger.warn(`⚠️ Auto-seed encounter: ${error.message}`);
  }
}
