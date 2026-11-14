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
      // Standard unsigned UPI intent must omit mode=02 to prevent Google Pay / PhonePe security blocks
      expect(intentUrl).not.toContain('mode=02');
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
      it('should resolve registered providers and fallback to direct_upi gracefully', () => {
        const directProvider = UpiProviderRegistry.getProvider('direct_upi');
        expect(directProvider.providerName).toBe('DIRECT_UPI');

        const mockProvider = UpiProviderRegistry.getProvider('mock');
        expect(mockProvider.providerName).toBe('MOCK_UPI');

        const bankProvider = UpiProviderRegistry.getProvider('bank');
        expect(bankProvider.providerName).toBe('BANK_UPI');

        const fallbackProvider = UpiProviderRegistry.getProvider('unknown_provider');
        expect(fallbackProvider.providerName).toBe('DIRECT_UPI');
      });

      it('DirectVpaProvider should verify VPA format, generate direct intent, and support direct settlement without bank gateway credentials', async () => {
        const directProvider = UpiProviderRegistry.getProvider('direct_upi');
        const accountResult = await directProvider.verifyUpiAccount({
          upiId: 'kartiksharma2007k@oksbi',
          accountType: 'MERCHANT',
          businessName: 'Upstates Restaurant',
        });

        expect(accountResult.isValidSyntax).toBe(true);
        expect(accountResult.verificationStatus).toBe('VERIFIED');
        expect(accountResult.merchantEligibilityStatus).toBe('MERCHANT_APPROVED');
        expect(accountResult.intentEnabled).toBe(true);
        expect(accountResult.bankName).toBe('State Bank of India');

        const intent = await directProvider.createIntent({
          orderId: 'order_789',
          restaurantId: 'rest_789',
          restaurantName: 'Upstates Restaurant',
          merchantVpa: 'kartiksharma2007k@oksbi',
          merchantName: 'Upstates Restaurant',
          amount: 350.5,
          currency: 'INR',
          merchantTxnRef: 'ORD789012',
        });

        expect(intent.merchantTxnRef).toBe('ORD789012');
        expect(intent.amount).toBe(350.5);
        expect(intent.intentUrl).toContain('pa=kartiksharma2007k@oksbi');
        expect(intent.intentUrl).toContain('am=350.50');
        expect(intent.metadata?.mode).toBe('DIRECT_VPA_WITHOUT_AUTOMATIC_PROVIDER_VERIFICATION');
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

    describe('E. Authoritative Reference, Amount Precision & UTR Separation', () => {
      it('should format exact paise amount without floating point rounding errors', () => {
        const amount = 2.36;
        const paise = Math.round(amount * 100);
        expect(paise).toBe(236);

        const intentUrl = buildUpiIntentUrl({
          merchantVpa: 'restaurant@upi',
          merchantName: 'Test Diner',
          amount: 2.36,
          txnRef: 'ORDTEST123456789',
        });

        expect(intentUrl).toContain('am=2.36');
        expect(intentUrl).not.toContain('am=2&');
        expect(intentUrl).not.toContain('am=2.00');
      });

      it('should distinguish merchant reference from bank UTR/RRN strictly', () => {
        const orderId = 'clx987654321';
        const merchantRef = generateTransactionRef(orderId);
        const simulatedBankUtr = '432109876543'; // 12-digit numeric RRN

        expect(merchantRef.startsWith('ORD')).toBe(true);
        expect(merchantRef).not.toBe(simulatedBankUtr);
        expect(/^\d{12}$/.test(simulatedBankUtr)).toBe(true);
      });

      it('should build intent URL with correct payee name and merchant category code', async () => {
        const mock = new MockUpiProvider();
        const intent = await mock.createIntent({
          orderId: 'order_555',
          restaurantId: 'rest_555',
          restaurantName: 'Grand Cafe',
          merchantVpa: 'grandcafe@upi',
          merchantName: 'Grand Cafe Pvt Ltd',
          amount: 540.75,
          currency: 'INR',
          merchantTxnRef: 'ORDCAFE555000',
        });

        expect(intent.amount).toBe(540.75);
        expect(intent.merchantTxnRef).toBe('ORDCAFE555000');
        expect(intent.intentUrl).toContain('am=540.75');
        expect(intent.intentUrl).toContain('pa=grandcafe@upi');
        expect(intent.intentUrl).toContain('pn=Grand%20Cafe%20Pvt%20Ltd');
      });
    });

    describe('F. Direct Settlement Architecture, Reconciliations & Production Security', () => {
      it('should reject mock payment verification when NODE_ENV is production', async () => {
        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
          const mock = new MockUpiProvider();
          await expect(
            mock.verifyPayment({
              merchantTxnRef: 'ORDTEST123',
              expectedAmount: 500,
            })
          ).rejects.toThrow('Production environment cannot verify payments with MOCK_UPI');
        } finally {
          process.env.NODE_ENV = prevEnv;
        }
      });

      it('should process refunds and payment reversals via adapter', async () => {
        const mock = new MockUpiProvider();
        const refund = await mock.refundPayment({
          merchantTxnRef: 'ORDCAFE555000',
          amount: 540.75,
          reason: 'Customer cancelled order before food preparation',
        });

        expect(refund.isSuccess).toBe(true);
        expect(refund.status).toBe('SUCCESS');
        expect(refund.refundId).toMatch(/^MOCK-RFD-/);
        expect(refund.amount).toBe(540.75);
      });

      it('should provide settlement reconciliation records across date range', async () => {
        const mock = new MockUpiProvider();
        const reconcile = await mock.reconcilePayments({
          startDate: new Date(Date.now() - 86400000),
          endDate: new Date(),
        });

        expect(reconcile).toHaveProperty('totalRecords');
        expect(Array.isArray(reconcile.records)).toBe(true);
      });
    });
  });

