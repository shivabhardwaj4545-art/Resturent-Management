/**
 * Utility for generating robust, cross-platform UPI Intent links
 * Supports Google Pay (tez://), PhonePe (phonepe://), Paytm (paytmmp://),
 * BHIM (bhim://), and standard universal NPCI upi:// protocols across mobile devices.
 */

export type UpiAppType = 'gpay' | 'phonepe' | 'paytm' | 'bhim' | 'generic';

export function getCleanUpiParams(rawUrl: string): string {
  if (!rawUrl) return '';
  return rawUrl.replace(/^upi:\/\/pay\??/, '');
}

export function buildAppUpiUrl(app: UpiAppType, upiUrl: string): string {
  if (!upiUrl) return '';

  const params = getCleanUpiParams(upiUrl);

  switch (app) {
    case 'gpay':
      return `tez://upi/pay?${params}`;
    case 'phonepe':
      return `phonepe://pay?${params}`;
    case 'paytm':
      return `paytmmp://pay?${params}`;
    case 'bhim':
      return `bhim://upi/pay?${params}`;
    case 'generic':
    default:
      return `upi://pay?${params}`;
  }
}

export function triggerUpiLaunch(app: UpiAppType, upiUrl: string) {
  if (!upiUrl || typeof window === 'undefined') return;
  const targetUrl = buildAppUpiUrl(app, upiUrl);
  const fallbackUrl = `upi://pay?${getCleanUpiParams(upiUrl)}`;

  try {
    window.location.href = targetUrl;
    // Fallback to standard UPI link if app-specific custom scheme doesn't open within 1.2 seconds
    if (app !== 'generic' && targetUrl !== fallbackUrl) {
      setTimeout(() => {
        if (typeof document !== 'undefined' && document.hasFocus()) {
          window.location.href = fallbackUrl;
        }
      }, 1200);
    }
  } catch {
    window.location.href = fallbackUrl;
  }
}

