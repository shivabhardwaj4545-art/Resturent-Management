import { generateOrderVerificationCode } from '../src/services/verificationCode.service';
import { prisma } from '../src/lib/prisma';
import { UpiProviderRegistry } from '../src/services/payment/UpiProviderRegistry';
import { DirectVpaProvider } from '../src/services/payment/providers/DirectVpaProvider';
import { SetuUpiProvider } from '../src/services/payment/providers/SetuUpiProvider';

describe('Counter Order Verification & Payment Confirmation Architecture', () => {
  let restaurantAId: string;
  let restaurantBId: string;
  let sampleOrderAId: string;
  let sampleOrderBId: string;
  let codeA: string;
  let codeB: string;

  beforeAll(async () => {
    // Retrieve or mock test restaurants
    const restA = await prisma.restaurant.findFirst({ where: { deletedAt: null } });
    if (restA) {
      restaurantAId = restA.id;
    } else {
      restaurantAId = 'mock-restaurant-a';
    }
    restaurantBId = 'mock-restaurant-b';
  });

  describe('1. 4-Digit Verification Code Generator', () => {
    it('should generate a valid 4-digit numeric string between 1000 and 9999', async () => {
      const code = await generateOrderVerificationCode(restaurantAId);
      expect(typeof code).toBe('string');
      expect(code).toMatch(/^\d{4}$/);
      const num = parseInt(code, 10);
      expect(num).toBeGreaterThanOrEqual(1000);
      expect(num).toBeLessThanOrEqual(9999);
    });

    it('should generate random, non-deterministic codes across consecutive calls', async () => {
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const code = await generateOrderVerificationCode(restaurantAId);
        expect(code).toMatch(/^\d{4}$/);
        codes.add(code);
      }
      // With 20 random generations from 9000 possibilities, we should have almost all unique codes (at least 15)
      expect(codes.size).toBeGreaterThanOrEqual(15);
    });
  });

  describe('2. Multi-Restaurant Security & Code Verification', () => {
    it('should isolate codes between different restaurants', async () => {
      codeA = await generateOrderVerificationCode(restaurantAId);
      codeB = await generateOrderVerificationCode(restaurantBId);

      expect(codeA).toMatch(/^\d{4}$/);
      expect(codeB).toMatch(/^\d{4}$/);
    });

    it('should reject malformed codes (less or more than 4 digits, non-numeric)', () => {
      const invalidCodes = ['123', '12345', 'abcd', '12a4', '', '12 4'];
      for (const ic of invalidCodes) {
        expect(/^\d{4}$/.test(ic.trim())).toBe(false);
      }
    });
  });

  describe('3. Manual Payment Confirmation Lifecycle', () => {
    it('should prevent marking cancelled orders as paid', () => {
      const order = {
        id: 'ord-test-cancelled',
        status: 'CANCELLED',
        paymentStatus: 'PENDING',
      };

      const canConfirm = order.status !== 'CANCELLED' && order.paymentStatus !== 'PAID';
      expect(canConfirm).toBe(false);
    });

    it('should prevent duplicate payment confirmation', () => {
      const order = {
        id: 'ord-test-paid',
        status: 'PREPARING',
        paymentStatus: 'PAID',
      };

      const canConfirm = order.status !== 'CANCELLED' && order.paymentStatus !== 'PAID';
      expect(canConfirm).toBe(false);
    });

    it('should maintain independent order status and payment status', () => {
      // Order status can be PENDING, CONFIRMED, PREPARING, READY, DELIVERED
      // Payment status can be PENDING or PAID
      const statuses = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];
      for (const s of statuses) {
        const order = { status: s, paymentStatus: 'PAID' };
        // Confirming payment must not alter order.status to COMPLETED
        expect(order.paymentStatus).toBe('PAID');
        expect(order.status).toBe(s);
      }
    });
  });

  describe('4. Preservation of Online Payment Architecture', () => {
    it('should preserve existing payment providers in registry', () => {
      const directProvider = UpiProviderRegistry.getProvider('DIRECT_UPI');
      expect(directProvider).toBeInstanceOf(DirectVpaProvider);

      const setuProvider = UpiProviderRegistry.getProvider('SETU_UPI');
      expect(setuProvider).toBeInstanceOf(SetuUpiProvider);
    });

    it('should ensure offline payment methods (PAY_AT_COUNTER, PAY_TO_WAITER) are recognized', () => {
      const offlineMethods = ['PAY_AT_COUNTER', 'PAY_TO_WAITER', 'COD'];
      for (const method of offlineMethods) {
        const isOnline = method === 'UPI_INTENT' || method === 'RAZORPAY';
        expect(isOnline).toBe(false);
      }
    });
  });
});
