import crypto from 'crypto';

export function generateTableSignature(restaurantId: string, tableNumber: string): string {
  const secret = process.env.JWT_SECRET || 'table_signing_fallback_secret_key';
  return crypto
    .createHmac('sha256', secret)
    .update(`${restaurantId}:${tableNumber}`)
    .digest('hex')
    .slice(0, 16); // 16 characters is secure and keeps the URL short
}

export function verifyTableSignature(restaurantId: string, tableNumber: string, signature: string): boolean {
  const expected = generateTableSignature(restaurantId, tableNumber);
  return expected === signature;
}
