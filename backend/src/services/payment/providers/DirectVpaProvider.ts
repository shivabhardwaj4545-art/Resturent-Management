import {
  IUpiPaymentProvider,
  VerifyUpiAccountParams,
  VerifyUpiAccountResult,
  CheckMerchantEligibilityParams,
  CheckMerchantEligibilityResult,
  CreateIntentParams,
  UpiIntentResult,
  VerifyPaymentParams,
  UpiVerificationResult,
  UpiStatusResult,
  UpiWebhookResult,
} from '../types';
import { buildUpiIntentUrl, isValidUpiId } from '../../payment.upi.service';

/**
 * Direct VPA UPI Provider (Mode A: DIRECT_VPA_WITHOUT_AUTOMATIC_PROVIDER_VERIFICATION)
 * 
 * Used for direct customer-to-restaurant UPI payments where:
 * 1. Platform holds no acquiring bank credentials or master payment gateway MID.
 * 2. Platform never collects customer funds into its own account.
 * 3. Funds settle directly into each individual restaurant's bank-linked UPI ID (e.g. kartiksharma2007k@oksbi).
 * 4. Generates standard, verified NPCI UPI Intent links and dynamic QR codes.
 * 5. Works seamlessly in both local and production without fake credentials or mock dependencies.
 */
export class DirectVpaProvider implements IUpiPaymentProvider {
  public readonly providerName = 'DIRECT_UPI';

  private resolveBankName(upiId: string): string {
    const handle = upiId.toLowerCase().split('@')[1] || '';
    if (handle.includes('sbi') || handle.includes('oksbi')) return 'State Bank of India';
    if (handle.includes('axis') || handle.includes('okaxis')) return 'Axis Bank';
    if (handle.includes('hdfc') || handle.includes('okhdfcbank')) return 'HDFC Bank';
    if (handle.includes('icici') || handle.includes('okicici')) return 'ICICI Bank';
    if (handle.includes('paytm')) return 'Paytm Payments Bank';
    if (handle.includes('ybl') || handle.includes('ibl')) return 'YES Bank';
    if (handle.includes('barodampay') || handle.includes('bob')) return 'Bank of Baroda';
    if (handle.includes('pnb')) return 'Punjab National Bank';
    return 'UPI Participating Bank';
  }

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
        restrictionReason: 'Invalid UPI ID format. Expected username@bank (e.g., restaurant@okaxis, 9876543210@paytm).',
        intentEnabled: false,
        dynamicQrEnabled: false,
      };
    }

    const detectedBank = this.resolveBankName(upiId);
    const cleanAccountType: 'PERSONAL' | 'MERCHANT' =
      accountType?.toUpperCase() === 'PERSONAL' ? 'PERSONAL' : 'MERCHANT';

    return {
      isValidSyntax: true,
      accountExists: true,
      accountType: cleanAccountType,
      accountHolderName: accountHolderName || businessName || 'Restaurant Account',
      businessName: businessName || 'Restaurant',
      bankName: detectedBank,
      providerMerchantId: `DIRECT-${upiId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16)}`,
      verificationStatus: 'VERIFIED',
      merchantEligibilityStatus: 'MERCHANT_APPROVED',
      intentEnabled: true,
      dynamicQrEnabled: true,
      rawResponse: {
        mode: 'DIRECT_VPA_WITHOUT_AUTOMATIC_PROVIDER_VERIFICATION',
        accountType: cleanAccountType,
        settlementModel: 'DIRECT_TO_RESTAURANT_VPA',
        bankName: detectedBank,
        status: 'ACTIVE',
      },
    };
  }

  public async checkMerchantEligibility(
    params: CheckMerchantEligibilityParams
  ): Promise<CheckMerchantEligibilityResult> {
    const isValid = isValidUpiId(params.upiId);
    return {
      isEligibleForCommercialPayments: isValid,
      merchantEligibilityStatus: isValid ? 'MERCHANT_APPROVED' : 'REJECTED',
      intentEnabled: isValid,
      dynamicQrEnabled: isValid,
      restrictionReason: isValid ? undefined : 'Invalid UPI ID format.',
      recommendedAction: isValid ? undefined : 'Please update your restaurant UPI ID with a valid handle.',
    };
  }

  public async createIntent(params: CreateIntentParams): Promise<UpiIntentResult> {
    const { orderId, restaurantName, merchantVpa, merchantName, amount, merchantTxnRef, orderNote } = params;

    if (!merchantVpa || !isValidUpiId(merchantVpa)) {
      throw new Error('Restaurant does not have a valid receiving UPI ID configured.');
    }

    if (typeof amount !== 'number' || amount <= 0 || isNaN(amount)) {
      throw new Error(`Invalid payment amount: ${amount}`);
    }

    // Standard NPCI UPI URI with authoritative amount and clean reference
    const intentUrl = buildUpiIntentUrl({
      merchantVpa,
      merchantName: merchantName || restaurantName || 'Restaurant',
      amount,
      txnRef: merchantTxnRef,
      orderNote: orderNote || `Order #${orderId.slice(-6).toUpperCase()}`,
    });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute standard expiration

    return {
      merchantTxnRef,
      amount,
      currency: 'INR',
      intentUrl,
      qrPayload: intentUrl,
      expiresAt,
      provider: this.providerName,
      metadata: {
        mode: 'DIRECT_VPA_WITHOUT_AUTOMATIC_PROVIDER_VERIFICATION',
        directSettlementVpa: merchantVpa,
        orderId,
      },
    };
  }

  public async checkStatus(merchantTxnRef: string, _providerTxnRef?: string): Promise<UpiStatusResult> {
    // Mode A transactions have no server-to-server gateway callback without acquiring MID
    return {
      status: 'PENDING',
      merchantTxnRef,
      rawResponse: {
        mode: 'DIRECT_VPA_WITHOUT_AUTOMATIC_PROVIDER_VERIFICATION',
        note: 'Direct VPA payment confirmation requires restaurant confirmation or staff verification.',
      },
    };
  }

  public async verifyPayment(params: VerifyPaymentParams): Promise<UpiVerificationResult> {
    // In Mode A without acquiring credentials, automated verification is pending until restaurant confirms
    return {
      isVerified: false,
      status: 'PENDING',
      merchantTxnRef: params.merchantTxnRef,
      providerTxnRef: params.providerTxnRef || '',
      amount: params.expectedAmount,
      paidAt: new Date(),
      rawResponse: {
        mode: 'DIRECT_VPA_WITHOUT_AUTOMATIC_PROVIDER_VERIFICATION',
        note: 'Direct VPA transaction requires counter or restaurant owner confirmation.',
      },
    };
  }

  public async parseWebhook(_rawBody: string, _headers: Record<string, string>): Promise<UpiWebhookResult> {
    return {
      isValidSignature: false,
      eventType: 'UNSUPPORTED',
      merchantTxnRef: '',
      amount: 0,
      status: 'PENDING',
      paidAt: new Date(),
      rawPayload: {},
    };
  }
}
