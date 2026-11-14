import crypto from 'node:crypto';
import {
  IUpiPaymentProvider,
  CreateIntentParams,
  UpiIntentResult,
  VerifyPaymentParams,
  UpiVerificationResult,
  UpiStatusResult,
  UpiWebhookResult,
} from '../types';
import { buildUpiIntentUrl } from '../../payment.upi.service';

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
