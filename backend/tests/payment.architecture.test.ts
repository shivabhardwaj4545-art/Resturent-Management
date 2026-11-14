import crypto from 'node:crypto';
import { buildUpiIntentUrl, generateTransactionRef, isValidUpiId } from '../src/services/payment.upi.service';
import { MockUpiProvider } from '../src/services/payment/providers/MockUpiProvider';
import { BankUpiProvider } from '../src/services/payment/providers/BankUpiProvider';
import { UpiProviderRegistry } from '../src/services/payment/UpiProviderRegistry';
import { verifyRazorpayWebhookSignature } from '../src/services/payment.razorpay.service';

describe('Payment Architecture Test Suite', () => {
  describe('A. Customer Order Payment — Direct UPI Intent Specification', () => {
    it('should validate standard UPI IDs correctly', () => {
      expect(isValidUpiId('restaurant@okaxis')).toBe(true);
      expect(isValidUpiId('merchant.pay@hdfcbank')).toBe(true);
      expect(isValidUpiId('invalid-vpa-without-at')).toBe(false);
      expect(isValidUpiId('')).toBe(false);
    });

    it('should generate strictly alphanumeric NPCI transaction references without dashes', () => {
      const orderId = 'clx123abc456';
      const ref = generateTransactionRef(orderId);
      expect(ref).toMatch(/^ORD[A-Z0-9]+$/);
      expect(ref.length).toBeLessThanOrEqual(35);
      expect(ref).not.toContain('-');
      expect(ref).not.toContain('_');
    });

    it('should build NPCI-compliant UPI intent URLs retaining unencoded @ in pa parameter', () => {
      const intentUrl = buildUpiIntentUrl({
        merchantVpa: 'upstates@upi',
        merchantName: 'Upstates Restaurant',
        amount: 566.40,
        txnRef: 'ORDABC123456789',
        orderNote: 'SwiftBite Order #123456',
      });

      expect(intentUrl.startsWith('upi://pay?')).toBe(true);
      expect(intentUrl).toContain('pa=upstates@upi'); // literal '@' as required by NPCI
      expect(intentUrl).not.toContain('pa=upstates%40upi'); // must NOT be %40
      expect(intentUrl).toContain('am=566.40');
      expect(intentUrl).toContain('cu=INR');
      expect(intentUrl).toContain('tr=ORDABC123456789');
      expect(intentUrl).toContain('mode=02');
    });

    it('should reject invalid payment amounts', () => {
      expect(() => {
        buildUpiIntentUrl({
          merchantVpa: 'merchant@upi',
          merchantName: 'Restaurant',
          amount: -10,
          txnRef: 'TXN123',
        });
      }).toThrow('Invalid payment amount');
    });
  });

  describe('B. UPI Provider Adapter & Registry', () => {
    it('should resolve registered providers and fallback to mock gracefully', () => {
      const mockProvider = UpiProviderRegistry.getProvider('mock');
      expect(mockProvider.providerName).toBe('MOCK_UPI');

      const bankProvider = UpiProviderRegistry.getProvider('bank');
      expect(bankProvider.providerName).toBe('BANK_UPI');

      const fallbackProvider = UpiProviderRegistry.getProvider('unknown_provider');
      expect(fallbackProvider.providerName).toBe('MOCK_UPI');
    });

    it('MockUpiProvider should generate valid intent result and verify payment successfully', async () => {
      const mock = new MockUpiProvider();
      const intent = await mock.createIntent({
        orderId: 'order_123',
        restaurantId: 'rest_456',
        restaurantName: 'Test Bistro',
        merchantVpa: 'bistro@upi',
        merchantName: 'Test Bistro',
        amount: 250,
        currency: 'INR',
        merchantTxnRef: 'ORDBISTRO123',
      });

      expect(intent.merchantTxnRef).toBe('ORDBISTRO123');
      expect(intent.amount).toBe(250);
      expect(intent.currency).toBe('INR');
      expect(intent.intentUrl).toContain('pa=bistro@upi');
      expect(intent.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Verify payment with exact amount
      const verification = await mock.verifyPayment({
        merchantTxnRef: 'ORDBISTRO123',
        expectedAmount: 250,
        receivedAmount: 250,
      });

      expect(verification.isVerified).toBe(true);
      expect(verification.status).toBe('SUCCESS');
      expect(verification.responseCode).toBe('00');
    });

    it('MockUpiProvider should reject verification when received amount does not match', async () => {
      const mock = new MockUpiProvider();
      const verification = await mock.verifyPayment({
        merchantTxnRef: 'ORDBISTRO123',
        expectedAmount: 250,
        receivedAmount: 200, // Amount mismatch
      });

      expect(verification.isVerified).toBe(false);
      expect(verification.status).toBe('FAILED');
      expect(verification.responseCode).toBe('AM_MISMATCH');
    });

    it('BankUpiProvider should append MCC code and sub-merchant ID when configured', async () => {
      const bank = new BankUpiProvider({
        merchantId: 'MERCH_HDFC_001',
        subMerchantId: 'SUB_REST_99',
        mcc: '5812',
      });

      const intent = await bank.createIntent({
        orderId: 'order_999',
        restaurantId: 'rest_99',
        restaurantName: 'Grand Palace',
        merchantVpa: 'grandpalace@hdfc',
        merchantName: 'Grand Palace',
        amount: 1200,
        currency: 'INR',
        merchantTxnRef: 'ORDPALACE999',
      });

      expect(intent.intentUrl).toContain('mc=5812');
      expect(intent.intentUrl).toContain('mid=SUB_REST_99');
      expect(intent.provider).toBe('BANK_UPI');
    });
  });

  describe('C. Platform SaaS Subscription — Razorpay Webhook Signature Verification', () => {
    it('should verify legitimate HMAC-SHA256 signatures for Razorpay webhook payloads', () => {
      const secret = 'test_webhook_secret_key_123';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const payload = JSON.stringify({
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: { id: 'sub_12345', status: 'active', current_end: 1770000000 },
          },
          payment: {
            entity: { id: 'pay_67890', amount: 249900, status: 'captured' },
          },
        },
      });

      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const isVerified = verifyRazorpayWebhookSignature(payload, validSignature);
      expect(isVerified).toBe(true);

      const isTamperedVerified = verifyRazorpayWebhookSignature(payload, 'tampered_fake_signature_abc');
      expect(isTamperedVerified).toBe(false);
    });

    it('should calculate annual subscription savings correctly', () => {
      const monthlyPrice = 1999;
      const expectedAnnualDiscountPrice = Math.round(monthlyPrice * 12 * 0.85); // 15% discount
      expect(expectedAnnualDiscountPrice).toBe(20390);
    });
  });

  describe('D. Restaurant UPI Account Onboarding & Link Policy Enforcement', () => {
    it('should classify personal UPI IDs as RESTRICTED with explicit bank link policy notice', async () => {
      const mock = new MockUpiProvider();
      const result = await mock.verifyUpiAccount({
        upiId: 'owner@okhdfcbank',
        accountType: 'PERSONAL',
        accountHolderName: 'Restaurant Owner',
      });

      expect(result.isValidSyntax).toBe(true);
      expect(result.accountExists).toBe(true);
      expect(result.accountType).toBe('PERSONAL');
      expect(result.verificationStatus).toBe('VERIFIED');
      expect(result.merchantEligibilityStatus).toBe('RESTRICTED');
      expect(result.intentEnabled).toBe(false);
      expect(result.dynamicQrEnabled).toBe(false);
      expect(result.restrictionReason).toContain('Personal (P2P) UPI accounts are restricted by NPCI and receiving banks');
      expect(result.restrictionReason).toContain('internal link policies');
    });

    it('should approve commercial Merchant UPI IDs with assigned providerMerchantId', async () => {
      const mock = new MockUpiProvider();
      const result = await mock.verifyUpiAccount({
        upiId: 'restro.merchant@hdfcbank',
        accountType: 'MERCHANT',
        businessName: 'Spice Route Bistro',
      });

      expect(result.isValidSyntax).toBe(true);
      expect(result.accountExists).toBe(true);
      expect(result.accountType).toBe('MERCHANT');
      expect(result.verificationStatus).toBe('VERIFIED');
      expect(result.merchantEligibilityStatus).toBe('MERCHANT_APPROVED');
      expect(result.intentEnabled).toBe(true);
      expect(result.dynamicQrEnabled).toBe(true);
      expect(result.providerMerchantId).toBeDefined();
    });

    it('should reject malformed UPI IDs during onboarding', async () => {
      const mock = new MockUpiProvider();
      const result = await mock.verifyUpiAccount({
        upiId: 'invalid-no-at-sign',
        accountType: 'MERCHANT',
      });

      expect(result.isValidSyntax).toBe(false);
      expect(result.verificationStatus).toBe('REJECTED');
      expect(result.merchantEligibilityStatus).toBe('RESTRICTED');
      expect(result.intentEnabled).toBe(false);
    });

    it('BankUpiProvider should require configured credentials and flag personal accounts as RESTRICTED', async () => {
      const bank = new BankUpiProvider({
        merchantId: '', // Unconfigured
        apiKey: '',
      });

      const personalCheck = await bank.checkMerchantEligibility({
        upiId: 'personal@axisbank',
        accountType: 'PERSONAL',
      });

      expect(personalCheck.isEligibleForCommercialPayments).toBe(false);
      expect(personalCheck.merchantEligibilityStatus).toBe('RESTRICTED');
      expect(personalCheck.intentEnabled).toBe(false);
      expect(personalCheck.restrictionReason).toContain('Personal (P2P) UPI ID cannot accept customer orders');
    });
  });
});

