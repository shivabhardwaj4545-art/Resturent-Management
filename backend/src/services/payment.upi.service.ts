export interface UpiIntentParams {
  merchantVpa: string;
  merchantName: string;
  amount: number;
  txnRef: string;
  orderNote?: string;
  mode?: string;
}

export function isValidUpiId(upiId: string): boolean {
  if (!upiId) return false;
  const upiRegex = /^[\w.-]+@[\w.-]+$/;
  return upiRegex.test(upiId.trim());
}

export function generateTransactionRef(orderId: string): string {
  const cleanId = orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  const timestamp = Date.now().toString().slice(-6);
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  // NPCI specification mandates strictly alphanumeric transaction references (no hyphens or special chars)
  return `ORD${cleanId}${timestamp}${randomSuffix}`;
}

export function buildUpiIntentUrl(params: UpiIntentParams): string {
  const { merchantVpa, merchantName, amount, txnRef, orderNote } = params;

  if (!isValidUpiId(merchantVpa)) {
    throw new Error('Invalid Merchant UPI ID configuration.');
  }

  if (typeof amount !== 'number' || amount <= 0 || isNaN(amount)) {
    throw new Error('Invalid payment amount.');
  }

  // NPCI Standard: The payee address (pa) must contain the literal '@' character.
  // URL-encoding '@' as '%40' breaks UPI app intent parsers (Google Pay, PhonePe, Paytm, BHIM)
  // causing bank gateway security errors ("Security issue / Transaction blocked").
  const cleanVpa = merchantVpa.trim();
  const cleanPn = encodeURIComponent((merchantName || 'Restaurant').trim().replace(/[^a-zA-Z0-9 ]/g, ''));
  const am = amount.toFixed(2);
  const cu = 'INR';
  const cleanTr = txnRef.replace(/[^a-zA-Z0-9]/g, '').slice(0, 35);
  const cleanTn = encodeURIComponent((orderNote || `Order ${cleanTr}`).trim().replace(/[^a-zA-Z0-9 ]/g, ''));

  let url = `upi://pay?pa=${cleanVpa}&pn=${cleanPn}&am=${am}&cu=${cu}&tr=${cleanTr}&tn=${cleanTn}`;
  if (params.mode) {
    url += `&mode=${params.mode}`;
  }
  return url;
}
