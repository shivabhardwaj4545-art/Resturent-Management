export interface CreateIntentParams {
  orderId: string;
  restaurantId: string;
  restaurantName: string;
  merchantVpa: string;
  merchantName: string;
  amount: number;
  currency: string;
  merchantTxnRef: string;
  customerName?: string;
  customerPhone?: string;
  orderNote?: string;
}

export interface UpiIntentResult {
  merchantTxnRef: string;
  providerTxnRef?: string;
  amount: number;
  currency: string;
  intentUrl: string;
  qrPayload: string;
  expiresAt: Date;
  provider: string;
  metadata?: Record<string, any>;
}

export interface VerifyPaymentParams {
  merchantTxnRef: string;
  providerTxnRef?: string;
  expectedAmount: number;
  receivedAmount?: number;
  rawPayload?: any;
}

export interface UpiVerificationResult {
  isVerified: boolean;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  merchantTxnRef: string;
  providerTxnRef: string;
  amount: number;
  paidAt: Date;
  payerVpa?: string;
  responseCode?: string;
  rawResponse: any;
}

export interface UpiStatusResult {
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
  merchantTxnRef: string;
  providerTxnRef?: string;
  amount?: number;
  paidAt?: Date;
  rawResponse?: any;
}

export interface UpiWebhookResult {
  isValidSignature: boolean;
  eventType: string;
  merchantTxnRef: string;
  providerTxnRef?: string;
  amount: number;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  paidAt: Date;
  rawPayload: any;
}

export interface IUpiPaymentProvider {
  readonly providerName: string;

  /**
   * Generates a unique UPI Intent deep link and QR payload for an order
   */
  createIntent(params: CreateIntentParams): Promise<UpiIntentResult>;

  /**
   * Queries the bank/PSP gateway directly for transaction status
   */
  checkStatus(merchantTxnRef: string, providerTxnRef?: string): Promise<UpiStatusResult>;

  /**
   * Verifies payment authenticity, amount match, and settlement status
   */
  verifyPayment(params: VerifyPaymentParams): Promise<UpiVerificationResult>;

  /**
   * Validates and parses incoming server-to-server webhook notifications
   */
  parseWebhook(rawBody: string, headers: Record<string, string>): Promise<UpiWebhookResult>;
}
