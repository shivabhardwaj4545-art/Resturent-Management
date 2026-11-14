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

export interface VerifyUpiAccountParams {
  upiId: string;
  accountType: 'PERSONAL' | 'MERCHANT';
  accountHolderName?: string;
  businessName?: string;
}

export interface VerifyUpiAccountResult {
  isValidSyntax: boolean;
  accountExists: boolean;
  accountType: 'PERSONAL' | 'MERCHANT';
  accountHolderName?: string;
  businessName?: string;
  bankName?: string;
  providerMerchantId?: string;
  verificationStatus: 'VERIFIED' | 'REJECTED' | 'FAILED' | 'PENDING_VERIFICATION';
  merchantEligibilityStatus: 'MERCHANT_APPROVED' | 'RESTRICTED' | 'PENDING_APPROVAL';
  restrictionReason?: string;
  intentEnabled: boolean;
  dynamicQrEnabled: boolean;
  rawResponse?: any;
}

export interface CheckMerchantEligibilityParams {
  upiId: string;
  accountType: string;
  providerMerchantId?: string;
}

export interface CheckMerchantEligibilityResult {
  isEligibleForCommercialPayments: boolean;
  merchantEligibilityStatus: 'MERCHANT_APPROVED' | 'RESTRICTED' | 'PENDING_APPROVAL' | 'REJECTED';
  intentEnabled: boolean;
  dynamicQrEnabled: boolean;
  restrictionReason?: string;
  recommendedAction?: string;
}

export interface IUpiPaymentProvider {
  readonly providerName: string;

  /**
   * Validates account syntax, verifies account existence via penny drop / VPA lookup,
   * and strictly evaluates commercial payment eligibility
   */
  verifyUpiAccount(params: VerifyUpiAccountParams): Promise<VerifyUpiAccountResult>;

  /**
   * Checks whether the receiving UPI account has approved acquiring bank onboarding for commercial payments
   */
  checkMerchantEligibility(params: CheckMerchantEligibilityParams): Promise<CheckMerchantEligibilityResult>;

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
