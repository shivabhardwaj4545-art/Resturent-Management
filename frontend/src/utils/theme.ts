/**
 * Dynamic theme utility for converting hex colors to HSL and applying
 * dynamic CSS custom properties (--primary, --primary-foreground, --secondary, --secondary-foreground, --ring)
 * so that changing the restaurant theme updates all buttons, icons, badges and previews across the application.
 */

export function hexToHsl(hex: string): { primary: string; foreground: string } {
  hex = hex.replace('#', '').trim();
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (hex.length !== 6) {
    return { primary: '27 96% 61.2%', foreground: '0 0% 100%' };
  }

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  const hDeg = Math.round(h * 360);
  const sPct = Math.round(s * 100);
  const lPct = Math.round(l * 100);

  const primary = `${hDeg} ${sPct}% ${lPct}%`;
  const foreground = lPct > 70 ? '217 30% 11.8%' : '0 0% 100%';

  return { primary, foreground };
}

export function applyThemeColor(hex?: string | null): void {
  if (typeof document === 'undefined') return;
  const color = hex || '#E85D04';
  const { primary, foreground } = hexToHsl(color);

  const root = document.documentElement;
  root.style.setProperty('--primary', primary);
  root.style.setProperty('--primary-foreground', foreground);
  root.style.setProperty('--secondary', primary);
  root.style.setProperty('--secondary-foreground', foreground);
  root.style.setProperty('--ring', primary);
}
