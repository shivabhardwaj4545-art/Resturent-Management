import crypto from 'node:crypto';
import {
  IUpiPaymentProvider,
  CreateIntentParams,
  UpiIntentResult,
  VerifyPaymentParams,
  UpiVerificationResult,
  UpiStatusResult,
  UpiWebhookResult,
  VerifyUpiAccountParams,
  VerifyUpiAccountResult,
  CheckMerchantEligibilityParams,
  CheckMerchantEligibilityResult,
} from '../types';
import { buildUpiIntentUrl, isValidUpiId } from '../../payment.upi.service';

/**
 * Mock / Sandbox UPI Provider
 * Used for local development, automated integration testing, and sandbox verification.
 * Simulates acquiring bank / UPI PSP responses without requiring live production bank keys.
 */
export class MockUpiProvider implements IUpiPaymentProvider {
  public readonly providerName = 'MOCK_UPI';

  // In-memory registry for mock transactions
  private static mockStore = new Map<
    string,
    {
      merchantTxnRef: string;
      providerTxnRef: string;
      amount: number;
      status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
      paidAt?: Date;
      payerVpa?: string;
    }
  >();

  /**
   * Simulates VPA existence check and commercial merchant eligibility evaluation
   */
  public async verifyUpiAccount(params: VerifyUpiAccountParams): Promise<VerifyUpiAccountResult> {
    const { upiId, accountType, accountHolderName, businessName } = params;

    const isValid = isValidUpiId(upiId);
    if (!isValid) {
      return {
        isValidSyntax: false,
        accountExists: false,
        accountType,
        verificationStatus: 'REJECTED',
        merchantEligibilityStatus: 'RESTRICTED',
        restrictionReason: 'Invalid UPI ID format. Standard format is username@bank (e.g., restaurant@okaxis).',
        intentEnabled: false,
        dynamicQrEnabled: false,
      };
    }

    const isPersonal = accountType.toUpperCase() === 'PERSONAL';

    if (isPersonal) {
      // Personal UPI IDs exist and are identity verified, but NOT approved for merchant intent
      return {
        isValidSyntax: true,
        accountExists: true,
        accountType: 'PERSONAL',
        accountHolderName: accountHolderName || 'Account Holder',
        bankName: 'State Bank of India',
        verificationStatus: 'VERIFIED',
        merchantEligibilityStatus: 'RESTRICTED',
        restrictionReason:
          'Personal (P2P) UPI accounts are restricted by NPCI and receiving banks from accepting dynamic commercial intent links or dynamic QR payments. Receiver banks decline such payments due to internal link policies.',
        intentEnabled: false,
        dynamicQrEnabled: false,
        rawResponse: { accountType: 'PERSONAL', code: 'P2P_RESTRICTED' },
      };
    }

    // Commercial Merchant UPI ID
    const providerMerchantId = `MOCK-MID-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    return {
      isValidSyntax: true,
      accountExists: true,
      accountType: 'MERCHANT',
      accountHolderName: accountHolderName || businessName || 'Verified Merchant',
      businessName: businessName || 'Restaurant Business',
      bankName: 'HDFC Bank Merchant Services',
      providerMerchantId,
      verificationStatus: 'VERIFIED',
      merchantEligibilityStatus: 'MERCHANT_APPROVED',
      intentEnabled: true,
      dynamicQrEnabled: true,
      rawResponse: {
        accountType: 'MERCHANT',
        mcc: '5812',
        settlementModel: 'DIRECT_SETTLEMENT',
        status: 'ACTIVE',
      },
    };
  }

  /**
   * Evaluates whether a registered UPI account is eligible for commercial customer payments
   */
  public async checkMerchantEligibility(
    params: CheckMerchantEligibilityParams
  ): Promise<CheckMerchantEligibilityResult> {
    const isPersonal = params.accountType.toUpperCase() === 'PERSONAL';

    if (isPersonal) {
      return {
        isEligibleForCommercialPayments: false,
        merchantEligibilityStatus: 'RESTRICTED',
        intentEnabled: false,
        dynamicQrEnabled: false,
        restrictionReason:
          'Personal (P2P) UPI ID cannot accept customer orders via UPI Intent or Dynamic QR. Bank internal link policy blocks commercial payments to personal VPAs.',
        recommendedAction: 'Register an approved Merchant UPI ID with your acquiring bank.',
      };
    }

    return {
      isEligibleForCommercialPayments: true,
      merchantEligibilityStatus: 'MERCHANT_APPROVED',
      intentEnabled: true,
      dynamicQrEnabled: true,
    };
  }

  public async createIntent(params: CreateIntentParams): Promise<UpiIntentResult> {
    const {
      merchantVpa,
      merchantName,
      amount,
      merchantTxnRef,
      orderNote,
    } = params;

    const intentUrl = buildUpiIntentUrl({
      merchantVpa: merchantVpa || 'merchant@upi',
      merchantName: merchantName || 'Restaurant Merchant',
      amount,
      txnRef: merchantTxnRef,
      orderNote: orderNote || `Order ${merchantTxnRef}`,
    });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiry
    const providerTxnRef = `MOCK-UPI-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    MockUpiProvider.mockStore.set(merchantTxnRef, {
      merchantTxnRef,
      providerTxnRef,
      amount,
      status: 'PENDING',
    });

    return {
      merchantTxnRef,
      providerTxnRef,
      amount,
      currency: 'INR',
      intentUrl,
      qrPayload: intentUrl,
      expiresAt,
      provider: this.providerName,
      metadata: {
        simulation: true,
        gateway: 'Sandboxed NPCI UPI Gateway',
      },
    };
  }

  public async checkStatus(
    merchantTxnRef: string,
    providerTxnRef?: string
  ): Promise<UpiStatusResult> {
    const record = MockUpiProvider.mockStore.get(merchantTxnRef);
    if (!record) {
      return {
        status: 'PENDING',
        merchantTxnRef,
        providerTxnRef: providerTxnRef || `MOCK-${Date.now()}`,
      };
    }

    return {
      status: record.status,
      merchantTxnRef: record.merchantTxnRef,
      providerTxnRef: record.providerTxnRef,
      amount: record.amount,
      paidAt: record.paidAt,
      rawResponse: {
        gatewayStatus: record.status,
        responseCode: record.status === 'SUCCESS' ? '00' : 'U69',
      },
    };
  }

  public async verifyPayment(params: VerifyPaymentParams): Promise<UpiVerificationResult> {
    const { merchantTxnRef, expectedAmount, receivedAmount, providerTxnRef } = params;

    const record = MockUpiProvider.mockStore.get(merchantTxnRef);
    const effectiveAmount = typeof receivedAmount === 'number' ? receivedAmount : expectedAmount;
    const isAmountMatch = Math.abs(effectiveAmount - expectedAmount) < 0.01;

    if (!isAmountMatch) {
      return {
        isVerified: false,
        status: 'FAILED',
        merchantTxnRef,
        providerTxnRef: providerTxnRef || 'MOCK-FAILED',
        amount: effectiveAmount,
        paidAt: new Date(),
        responseCode: 'AM_MISMATCH',
        rawResponse: { error: 'Amount mismatch' },
      };
    }

    const verifiedProviderRef = providerTxnRef || record?.providerTxnRef || `MOCK-UTR-${Date.now()}`;
    const now = new Date();

    if (record) {
      record.status = 'SUCCESS';
      record.paidAt = now;
      record.providerTxnRef = verifiedProviderRef;
    }

    return {
      isVerified: true,
      status: 'SUCCESS',
      merchantTxnRef,
      providerTxnRef: verifiedProviderRef,
      amount: expectedAmount,
      paidAt: now,
      payerVpa: 'customer@upi',
      responseCode: '00',
      rawResponse: {
        gateway: 'Mock UPI Gateway',
        bankRrn: verifiedProviderRef,
        status: 'SUCCESS',
      },
    };
  }

  public async parseWebhook(
    rawBody: string,
    headers: Record<string, string>
  ): Promise<UpiWebhookResult> {
    let parsed: any;
    try {
      parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch {
      parsed = {};
    }

    const merchantTxnRef = parsed.merchantTxnRef || parsed.txnRef || '';
    const providerTxnRef = parsed.providerTxnRef || parsed.utr || `MOCK-WH-${Date.now()}`;
    const amount = Number(parsed.amount) || 0;
    const status = parsed.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING';

    return {
      isValidSignature: true, // Sandbox mock always approves test signatures
      eventType: parsed.event || 'payment.success',
      merchantTxnRef,
      providerTxnRef,
      amount,
      status,
      paidAt: new Date(),
      rawPayload: parsed,
    };
  }

  /**
   * Helper for tests or manual simulator triggers
   */
  public static simulateSuccess(merchantTxnRef: string, utr?: string): void {
    const existing = MockUpiProvider.mockStore.get(merchantTxnRef);
    if (existing) {
      existing.status = 'SUCCESS';
      existing.paidAt = new Date();
      if (utr) existing.providerTxnRef = utr;
    }
  }
}
