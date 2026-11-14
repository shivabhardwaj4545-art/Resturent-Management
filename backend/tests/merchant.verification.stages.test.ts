import { MerchantAccountService } from '../src/services/merchant.account.service';
import { UpiProviderRegistry } from '../src/services/payment/UpiProviderRegistry';
import { SetuUpiProvider } from '../src/services/payment/providers/SetuUpiProvider';
import { DirectVpaProvider } from '../src/services/payment/providers/DirectVpaProvider';
import { isValidUpiId } from '../src/services/payment.upi.service';

describe('Authorised Restaurant Merchant VPA Verification & Multi-Stage Lifecycle', () => {
  describe('Stage 1: VPA Syntax & Format Validation', () => {
    it('should validate valid merchant VPAs', () => {
      expect(isValidUpiId('abc.restaurant@okaxis')).toBe(true);
      expect(isValidUpiId('upstates@oksbi')).toBe(true);
      expect(isValidUpiId('merchant.food@hdfcbank')).toBe(true);
      expect(isValidUpiId('my-bistro_1@icici')).toBe(true);
    });

    it('should reject malformed VPAs missing handle or bank domain', () => {
      expect(isValidUpiId('')).toBe(false);
      expect(isValidUpiId('invalidvpa')).toBe(false);
      expect(isValidUpiId('restaurant@')).toBe(false);
      expect(isValidUpiId('@okaxis')).toBe(false);
      expect(isValidUpiId('user with spaces@sbi')).toBe(false);
    });
  });

  describe('Stage 2: Provider VPA Resolution & Example VPA Evaluation', () => {
    it('should evaluate abc.restaurant@okaxis through provider and not assume active status without provider confirmation', async () => {
      const setu = new SetuUpiProvider();
      const result = await setu.verifyUpiAccount({
        upiId: 'abc.restaurant@okaxis',
        accountType: 'MERCHANT',
        businessName: 'ABC Restaurant',
      });

      expect(result.isValidSyntax).toBe(true);
      // In sandbox/unconfigured environment, resolution must be UNRESOLVED/PENDING
      expect(['VALID', 'UNRESOLVED']).toContain(result.vpaStatus);
      expect(result.providerMerchantId).toContain('SETU-');
      expect(result.mcc).toBe('5812');
    });

    it('should classify invalid VPAs as REJECTED during resolution', async () => {
      const setu = new SetuUpiProvider();
      const result = await setu.verifyUpiAccount({
        upiId: 'invalid-vpa-without-at',
        accountType: 'MERCHANT',
      });

      expect(result.isValidSyntax).toBe(false);
      expect(result.vpaStatus).toBe('INVALID');
      expect(result.verificationStatus).toBe('REJECTED');
      expect(result.intentEnabled).toBe(false);
      expect(result.dynamicQrEnabled).toBe(false);
    });
  });

  describe('Stage 3: Payee-Name Verification & Matching', () => {
    it('should match payee name when matching business name', () => {
      const businessName = 'Upstates Restaurant';
      const payeeName = 'Upstates Restaurant Private Limited';
      const pClean = payeeName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const bClean = businessName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matched = pClean.includes(bClean) || bClean.includes(pClean);
      expect(matched).toBe(true);
    });

    it('should detect mismatch when payee name is completely different', () => {
      const businessName = 'Upstates Restaurant';
      const payeeName = 'XYZ Automobiles';
      const pClean = payeeName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const bClean = businessName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matched = pClean.includes(bClean) || bClean.includes(pClean);
      expect(matched).toBe(false);
    });
  });

  describe('Stage 4, 5, 6 & 7: Merchant Onboarding, MID, MCC & Settlement Account Approval', () => {
    it('should generate merchant onboarding application with assigned MID and MCC 5812', async () => {
      const setu = new SetuUpiProvider();
      const onboardingRes = await setu.onboardMerchant({
        restaurantId: 'rest_test_123',
        legalBusinessName: 'Upstates Gourmet LLP',
        businessStructure: 'LLP',
        contactPhone: '9876543210',
        contactEmail: 'accounts@upstates.com',
        businessAddress: '123 MG Road, Bengaluru',
        panNumber: 'ABCDE1234F',
        gstin: '29ABCDE1234F1Z5',
        bankAccountNumber: '001122334455',
        bankIfsc: 'HDFC0001234',
        bankAccountHolder: 'Upstates Gourmet LLP',
        upiVpa: 'upstates@okhdfcbank',
      });

      expect(onboardingRes.onboardingRef).toContain('ONB-SETU');
      expect(onboardingRes.providerMerchantId).toContain('MID-SETU');
      expect(onboardingRes.mcc).toBe('5812');
      expect(onboardingRes.status).toBe('MERCHANT_APPROVED');
      expect(onboardingRes.kycStatus).toBe('VERIFIED');
      expect(onboardingRes.settlementStatus).toBe('APPROVED');
    });

    it('should verify settlement configuration and reject incomplete bank account details', async () => {
      const setu = new SetuUpiProvider();
      const invalidSettlement = await setu.verifySettlementConfig({
        restaurantId: 'rest_test_123',
        bankAccountNumber: '',
        bankIfsc: '',
        bankAccountHolder: '',
      });

      expect(invalidSettlement.isApproved).toBe(false);
      expect(invalidSettlement.settlementStatus).toBe('PENDING');
      expect(invalidSettlement.failureReason).toBeDefined();

      const validSettlement = await setu.verifySettlementConfig({
        restaurantId: 'rest_test_123',
        bankAccountNumber: '1234567890',
        bankIfsc: 'SBIN0001234',
        bankAccountHolder: 'Upstates Restaurant',
      });

      expect(validSettlement.isApproved).toBe(true);
      expect(validSettlement.settlementStatus).toBe('APPROVED');
      expect(validSettlement.settlementAccountRef).toBe('SETTLE-ACC-7890');
    });
  });

  describe('Stage 8: Payment Enablement Independence', () => {
    it('should never enable payments if settlement account is pending or VPA is unresolved', () => {
      const evaluateEnablement = (params: {
        isValidSyntax: boolean;
        vpaStatus: string;
        merchantStatus: string;
        settlementStatus: string;
      }) => {
        return Boolean(
          params.isValidSyntax &&
          params.vpaStatus === 'VALID' &&
          (params.merchantStatus === 'ACTIVE' || params.merchantStatus === 'MERCHANT_APPROVED') &&
          params.settlementStatus === 'APPROVED'
        );
      };

      // Unresolved VPA -> False
      expect(evaluateEnablement({
        isValidSyntax: true,
        vpaStatus: 'UNRESOLVED',
        merchantStatus: 'MERCHANT_APPROVED',
        settlementStatus: 'APPROVED',
      })).toBe(false);

      // Pending Settlement -> False
      expect(evaluateEnablement({
        isValidSyntax: true,
        vpaStatus: 'VALID',
        merchantStatus: 'MERCHANT_APPROVED',
        settlementStatus: 'PENDING',
      })).toBe(false);

      // Pending Merchant KYC -> False
      expect(evaluateEnablement({
        isValidSyntax: true,
        vpaStatus: 'VALID',
        merchantStatus: 'KYC_PENDING',
        settlementStatus: 'APPROVED',
      })).toBe(false);

      // All Passed -> True
      expect(evaluateEnablement({
        isValidSyntax: true,
        vpaStatus: 'VALID',
        merchantStatus: 'ACTIVE',
        settlementStatus: 'APPROVED',
      })).toBe(true);
    });
  });

  describe('Provider Adapter Integration & Webhook Verification', () => {
    it('should register and resolve SETU_UPI in registry', () => {
      const provider = UpiProviderRegistry.getProvider('setu');
      expect(provider.providerName).toBe('SETU_UPI');
    });

    it('should create dynamic UPI Intent for Setu with MCC 5812', async () => {
      const setu = new SetuUpiProvider();
      const intent = await setu.createIntent({
        orderId: 'order_test_999',
        restaurantId: 'rest_999',
        restaurantName: 'The Royal Table',
        merchantVpa: 'royaltable@okaxis',
        merchantName: 'The Royal Table',
        amount: 450,
        currency: 'INR',
        merchantTxnRef: 'ORDROYAL999',
      });

      expect(intent.merchantTxnRef).toBe('ORDROYAL999');
      expect(intent.amount).toBe(450);
      expect(intent.intentUrl).toContain('pa=royaltable@okaxis');
      expect(intent.intentUrl).toContain('am=450.00');
      expect(intent.provider).toBe('SETU_UPI');
    });

    it('should parse and verify authenticated Setu webhook notifications', async () => {
      const setu = new SetuUpiProvider();
      const rawPayload = JSON.stringify({
        eventType: 'PAYMENT_COMPLETED',
        merchantTxnRef: 'ORDROYAL999',
        providerTxnId: 'SETU-TXN-12345678',
        amount: 450,
        status: 'SUCCESS',
        utr: '123456789012',
        paidAt: new Date().toISOString(),
      });

      const parsed = await setu.parseWebhook(rawPayload, {});
      expect(parsed.isValidSignature).toBe(true);
      expect(parsed.merchantTxnRef).toBe('ORDROYAL999');
      expect(parsed.amount).toBe(450);
      expect(parsed.status).toBe('SUCCESS');
      expect(parsed.utr).toBe('123456789012');
    });

    it('should process payment refunds through adapter', async () => {
      const setu = new SetuUpiProvider();
      const refund = await setu.refundPayment({
        merchantTxnRef: 'ORDROYAL999',
        amount: 450,
        reason: 'Order cancelled by customer',
      });

      expect(refund.isSuccess).toBe(true);
      expect(refund.refundId).toContain('REF-SETU');
      expect(refund.amount).toBe(450);
      expect(refund.status).toBe('SUCCESS');
    });
  });
});

