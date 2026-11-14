/**
 * Utility for generating robust, cross-platform UPI Intent links
 * Supports Android Chrome Intent syntax, iOS custom URI schemes, and standard NPCI upi:// protocol.
 */

export type UpiAppType = 'gpay' | 'phonepe' | 'paytm' | 'bhim' | 'generic';

const ANDROID_PACKAGES: Record<Exclude<UpiAppType, 'generic'>, string> = {
  gpay: 'com.google.android.apps.nbu.paisa.user',
  phonepe: 'com.phonepe.app',
  paytm: 'net.one97.paytm',
  bhim: 'in.org.npci.upiapp',
};

export function getCleanUpiParams(rawUrl: string): string {
  if (!rawUrl) return '';
  return rawUrl.replace(/^upi:\/\/pay\??/, '');
}

export function buildAppUpiUrl(app: UpiAppType, upiUrl: string): string {
  if (!upiUrl) return '';

  const params = getCleanUpiParams(upiUrl);
  const isBrowser = typeof window !== 'undefined' && typeof navigator !== 'undefined';
  const isAndroid = isBrowser && /Android/i.test(navigator.userAgent);
  const isIOS = isBrowser && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Android Chrome Intent Protocol
  if (isAndroid) {
    if (app in ANDROID_PACKAGES) {
      const pkg = ANDROID_PACKAGES[app as keyof typeof ANDROID_PACKAGES];
      return `intent://pay?${params}#Intent;scheme=upi;package=${pkg};end`;
    }
    // Generic UPI intent chooser on Android
    return `intent://pay?${params}#Intent;scheme=upi;end`;
  }

  // iOS App-specific URI schemes
  if (isIOS) {
    if (app === 'gpay') return `gpay://upi/pay?${params}`;
    if (app === 'phonepe') return `phonepe://pay?${params}`;
    if (app === 'paytm') return `paytmmp://pay?${params}`;
    if (app === 'bhim') return `bhim://upi/pay?${params}`;
    return `upi://pay?${params}`;
  }

  // Desktop or fallback
  return upiUrl;
}

export function triggerUpiLaunch(app: UpiAppType, upiUrl: string) {
  if (!upiUrl || typeof window === 'undefined') return;
  const targetUrl = buildAppUpiUrl(app, upiUrl);
  try {
    window.location.href = targetUrl;
  } catch {
    window.location.href = upiUrl;
  }
}

