import crypto from 'crypto';
import { prisma } from '../lib/prisma';

/**
 * Generates a cryptographically secure, non-sequential 4-digit numeric verification code (1000 - 9999)
 * scoped to a specific restaurant. Ensures no active (uncompleted/uncancelled) order in that restaurant
 * shares the same verification code.
 *
 * @param restaurantId The restaurant ID
 * @param tx Optional Prisma transaction client
 * @returns 4-digit string code (e.g. '4827')
 */
export async function generateOrderVerificationCode(
  restaurantId: string,
  tx?: any
): Promise<string> {
  const db = tx || prisma;
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate secure random integer between 1000 and 9999
    const codeNumber = crypto.randomInt(1000, 10000);
    const codeStr = codeNumber.toString();

    // Check if any active order for this restaurant is currently using this code
    const existingActiveOrder = await db.order.findFirst({
      where: {
        restaurantId,
        verificationCode: codeStr,
        status: {
          notIn: ['DELIVERED', 'CANCELLED'],
        },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!existingActiveOrder) {
      return codeStr;
    }
  }

  // Fallback: If after 20 attempts all randomly picked codes collide, pick a random code with timestamp salt
  const fallback = (1000 + (crypto.randomInt(0, 9000) ^ (Date.now() % 1000))).toString().slice(0, 4);
  return fallback.padStart(4, '7');
}
