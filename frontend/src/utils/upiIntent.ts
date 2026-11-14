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

  if (app === 'generic') {
    // Pure standard NPCI URI invokes native Android/iOS system UPI chooser
    return `upi://pay?${params}`;
  }

  // Android Chrome Intent Protocol for specific apps
  if (isAndroid) {
    if (app in ANDROID_PACKAGES) {
      const pkg = ANDROID_PACKAGES[app as keyof typeof ANDROID_PACKAGES];
      // Intent URL allows directly targeting the installed UPI app on Android
      return `intent://pay?${params}#Intent;scheme=upi;package=${pkg};end`;
    }
    return `upi://pay?${params}`;
  }

  // iOS App-specific URI schemes
  if (isIOS) {
    if (app === 'gpay') return `gpay://upi/pay?${params}`;
    if (app === 'phonepe') return `phonepe://pay?${params}`;
    if (app === 'paytm') return `paytmmp://pay?${params}`;
    if (app === 'bhim') return `bhim://upi/pay?${params}`;
    return `upi://pay?${params}`;
  }

  // Default / fallback
  return `upi://pay?${params}`;
}

export function triggerUpiLaunch(app: UpiAppType, upiUrl: string) {
  if (!upiUrl || typeof window === 'undefined') return;
  const targetUrl = buildAppUpiUrl(app, upiUrl);
  const fallbackUrl = `upi://pay?${getCleanUpiParams(upiUrl)}`;

  try {
    window.location.href = targetUrl;
    // Fallback to standard UPI link if package-specific intent fails after 1.5 seconds
    if (app !== 'generic') {
      setTimeout(() => {
        if (document.hasFocus()) {
          window.location.href = fallbackUrl;
        }
      }, 1500);
    }
  } catch {
    window.location.href = fallbackUrl;
  }
}
