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
  utr?: string;
  responseCode?: string;
  rawResponse: any;
}

export interface UpiStatusResult {
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
  merchantTxnRef: string;
  providerTxnRef?: string;
  amount?: number;
  paidAt?: Date;
  utr?: string;
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
  utr?: string;
  rawPayload: any;
}

// ── Separate Verification Stages ─────────────────────────────────────

export type VpaResolutionStatus = 'VALID' | 'INVALID' | 'UNRESOLVED' | 'RESTRICTED';

export type MerchantLifecycleStatus =
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'KYC_PENDING'
  | 'KYC_REJECTED'
  | 'MERCHANT_PENDING'
  | 'MERCHANT_APPROVED'
  | 'SETTLEMENT_PENDING'
  | 'PAYMENT_TEST_PENDING'
  | 'ACTIVE'
  | 'SUSPENDED';

export type SettlementStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type VerificationMode =
  | 'DIRECT_VPA_WITHOUT_AUTOMATIC_PROVIDER_VERIFICATION'
  | 'AUTHORIZED_BANK_OR_ACQUIRER_VERIFICATION';

export interface VerificationStagesState {
  isValidSyntax: boolean;
  vpaStatus: VpaResolutionStatus;
  payeeName: string | null;
  payeeNameMatched: boolean;
  merchantStatus: MerchantLifecycleStatus;
  providerMerchantId: string | null;
  mcc: string | null;
  settlementStatus: SettlementStatus;
  verificationMode: VerificationMode;
  paymentEnabled: boolean;
  stageSummary: string;
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
  vpaStatus?: VpaResolutionStatus;
  merchantStatus?: MerchantLifecycleStatus;
  mcc?: string;
  settlementStatus?: SettlementStatus;
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

// ── Merchant Onboarding & Lifecycle ──────────────────────────────────

export interface MerchantOnboardingParams {
  restaurantId: string;
  legalBusinessName: string;
  businessStructure?: 'PROPRIETORSHIP' | 'PARTNERSHIP' | 'LLP' | 'PRIVATE_LIMITED';
  contactPhone?: string;
  contactEmail?: string;
  businessAddress?: string;
  panNumber?: string;
  gstin?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankAccountHolder?: string;
  upiVpa: string;
}

export interface MerchantOnboardingResult {
  onboardingRef: string;
  provider: string;
  status: MerchantLifecycleStatus;
  kycStatus: 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
  providerMerchantId?: string;
  mcc?: string;
  settlementStatus: SettlementStatus;
  rejectionReason?: string;
  rawResponse?: any;
}

export interface MerchantStatusLookupResult {
  onboardingRef: string;
  merchantStatus: MerchantLifecycleStatus;
  kycStatus: 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
  providerMerchantId?: string;
  mcc?: string;
  settlementStatus: SettlementStatus;
  isActive: boolean;
  rawResponse?: any;
}

export interface MerchantSettlementConfigParams {
  restaurantId: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankAccountHolder: string;
  providerMerchantId?: string;
}

export interface MerchantSettlementConfigResult {
  isApproved: boolean;
  settlementStatus: SettlementStatus;
  settlementAccountRef?: string;
  bankName?: string;
  failureReason?: string;
  rawResponse?: any;
}

export interface UpiRefundParams {
  merchantTxnRef: string;
  providerTxnRef?: string;
  amount: number;
  currency?: string;
  reason?: string;
}

export interface UpiRefundResult {
  isSuccess: boolean;
  refundId: string;
  merchantTxnRef: string;
  amount: number;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  rawResponse?: any;
}

export interface UpiReconcileParams {
  startDate: Date;
  endDate: Date;
  merchantId?: string;
}

export interface UpiReconcileRecord {
  merchantTxnRef: string;
  providerTxnRef: string;
  amount: number;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED';
  settledAt?: Date;
  utr?: string;
}

export interface UpiReconcileResult {
  totalRecords: number;
  records: UpiReconcileRecord[];
  rawResponse?: any;
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

  /**
   * Initiates multi-merchant onboarding with acquiring bank / payment provider
   */
  onboardMerchant?(params: MerchantOnboardingParams): Promise<MerchantOnboardingResult>;

  /**
   * Looks up real-time merchant status with acquiring provider
   */
  getMerchantStatus?(merchantId: string, onboardingRef?: string): Promise<MerchantStatusLookupResult>;

  /**
   * Verifies merchant bank settlement configuration
   */
  verifySettlementConfig?(params: MerchantSettlementConfigParams): Promise<MerchantSettlementConfigResult>;

  /**
   * Processes a customer refund or payment reversal through acquiring bank
   */
  refundPayment?(params: UpiRefundParams): Promise<UpiRefundResult>;

  /**
   * Reconciles settlement records against bank ledger
   */
  reconcilePayments?(params: UpiReconcileParams): Promise<UpiReconcileResult>;
}
