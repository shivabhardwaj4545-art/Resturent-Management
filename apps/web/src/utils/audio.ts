/**
 * Real-Time Sound, Popup, and Vibration Notification Service
 * Supports distinct role-based audio profiles:
 * - Owner Side: Sharp cash-register brass chime & rapid waiter alarm
 * - Kitchen Side: Loud double kitchen gong chime & high-gain buzzer (designed to cut through kitchen noise)
 * - Customer Side: Soft, warm melodic chord & gentle ding
 * - Web Audio API synthesized tones + HTML5 audio fallback
 * - Mobile Haptic Vibration (navigator.vibrate)
 * - Native Browser Desktop Notifications
 * - Automatic AudioContext unlock & audibility listeners
 */

export type EventType =
  | 'new_order'
  | 'waiter_called'
  | 'order_cancelled'
  | 'driver_assigned'
  | 'order_status_changed';

export type UserRole = 'owner' | 'kitchen' | 'customer';

// Mobile vibration trigger
export function triggerVibration(pattern: number[] = [200, 100, 200]) {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore vibration errors */
    }
  }
}

// Browser Desktop Notification Helpers
export function requestDesktopNotificationPermission() {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }
}

const recentDesktopNotificationsCache = new Map<string, number>();

export function sendDesktopNotification(
  title: string,
  options?: {
    body?: string;
    icon?: string;
    tag?: string;
    data?: any;
    requireInteraction?: boolean;
  }
) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  // Prevent duplicate notifications within 4 seconds
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanBody = (options?.body || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const dedupeKey = `${cleanTitle}-${cleanBody}`;
  const now = Date.now();
  const lastSent = recentDesktopNotificationsCache.get(dedupeKey);

  if (lastSent && now - lastSent < 4000) {
    return;
  }
  recentDesktopNotificationsCache.set(dedupeKey, now);

  if (recentDesktopNotificationsCache.size > 50) {
    for (const [key, timestamp] of recentDesktopNotificationsCache.entries()) {
      if (now - timestamp > 10000) recentDesktopNotificationsCache.delete(key);
    }
  }

  const fireNotification = () => {
    try {
      const notif = new Notification(title, {
        icon: options?.icon || '/favicon.png',
        badge: '/favicon.png',
        body: options?.body || '',
        tag: options?.tag || undefined,
        requireInteraction: options?.requireInteraction ?? true,
        ...options,
      });

      notif.onclick = (e) => {
        e.preventDefault();
        window.focus();
        notif.close();
      };
    } catch (err) {
      console.error('Desktop notification trigger error:', err);
    }
  };

  if (Notification.permission === 'granted') {
    fireNotification();
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        fireNotification();
      }
    }).catch(() => {});
  }
}

// Audio context singleton for web audio fallback
let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      requestDesktopNotificationPermission();
    } catch {}
  };
  
  // Auto unlock on any page interaction or visibility change
  ['click', 'keydown', 'touchstart', 'mousemove', 'scroll', 'pointerdown', 'focus', 'mouseenter', 'visibilitychange', 'load'].forEach((evt) => {
    window.addEventListener(evt, unlockAudio, { capture: true, passive: true });
  });

  // Call once immediately
  unlockAudio();
}

// ── 1. OWNER AUDIO SYNTHS (Sharp cash-register & waiter call alarm) ───────────

// 🛍️ New Order Sound: Sharp, upbeat cash-register / order chime
export function playOwnerOrderSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    // Ascending cash-register brass chord + metallic ping
    const notes = [
      { freq: 523.25, type: 'triangle' as const, time: 0, duration: 0.15, vol: 0.9 },
      { freq: 659.25, type: 'triangle' as const, time: 0.08, duration: 0.15, vol: 0.9 },
      { freq: 783.99, type: 'triangle' as const, time: 0.16, duration: 0.18, vol: 0.95 },
      { freq: 1046.5, type: 'triangle' as const, time: 0.24, duration: 0.25, vol: 1.0 },
      { freq: 1567.98, type: 'sine' as const, time: 0.35, duration: 0.4, vol: 1.0 },
      { freq: 2093.0, type: 'sine' as const, time: 0.42, duration: 0.5, vol: 0.8 }, // Metallic coin-register ping
    ];

    notes.forEach(({ freq, type, time, duration, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + time);
      gain.gain.setValueAtTime(vol, now + time);
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + time);
      osc.stop(now + time + duration);
    });
  } catch { /* silent fallback */ }
}

// 🔔 Waiter Call Sound: Loud, urgent, repeating dual-tone Bell Ring Alarm
export function playOwnerWaiterSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // 4 rapid double-ring pulses (Ding-Ding! Ding-Ding!)
    const pulses = [0, 0.28, 0.56, 0.84];
    pulses.forEach((delay) => {
      // Bell tone 1: High A6 (1760 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1760, now + delay);
      gain1.gain.setValueAtTime(1.1, now + delay);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.22);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now + delay);
      osc1.stop(now + delay + 0.22);

      // Bell tone 2 (harmonic overlay): E6 (1318.5 Hz) + pitch sweep for ring sharpness
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'square';
      osc2.frequency.setValueAtTime(1318.51, now + delay + 0.04);
      osc2.frequency.exponentialRampToValueAtTime(1046.5, now + delay + 0.2);
      gain2.gain.setValueAtTime(0.7, now + delay + 0.04);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.22);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + delay + 0.04);
      osc2.stop(now + delay + 0.22);
    });
  } catch { /* silent fallback */ }
}

// ── 2. KITCHEN AUDIO SYNTHS (Loud double kitchen bell/gong chime) ────────────
export function playKitchenOrderSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const strokes = [
      { delay: 0, freq1: 587.33, freq2: 880 },
      { delay: 0.2, freq1: 880, freq2: 1174.66 },
      { delay: 0.5, freq1: 587.33, freq2: 880 },
      { delay: 0.7, freq1: 880, freq2: 1174.66 },
    ];
    strokes.forEach(({ delay, freq1, freq2 }) => {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = 'triangle';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq1, now + delay);
      osc2.frequency.setValueAtTime(freq2, now + delay);
      gain.gain.setValueAtTime(1.0, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.4);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(now + delay);
      osc2.start(now + delay);
      osc1.stop(now + delay + 0.4);
      osc2.stop(now + delay + 0.4);
    });
  } catch { /* silent fallback */ }
}

export function playKitchenWaiterSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    [0, 0.25, 0.5].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(783.99, now + delay);
      gain.gain.setValueAtTime(0.9, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.2);
    });
  } catch { /* silent fallback */ }
}

// ── 3. CUSTOMER AUDIO SYNTHS (Soft, warm, pleasant melodic triad) ────────────
export function playCustomerStatusSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const notes = [
      { freq: 440, time: 0, duration: 0.3 },
      { freq: 554.37, time: 0.12, duration: 0.35 },
      { freq: 659.25, time: 0.24, duration: 0.5 },
    ];
    notes.forEach(({ freq, time, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + time);
      gain.gain.setValueAtTime(0.5, now + time);
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + time);
      osc.stop(now + time + duration);
    });
  } catch { /* silent fallback */ }
}

export function playCustomerWaiterComingSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, now);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
  } catch { /* silent fallback */ }
}

export function playOrderCancelledSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const tones = [
      { freq: 300, start: 0, duration: 0.2 },
      { freq: 220, start: 0.25, duration: 0.35 },
    ];
    tones.forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.7, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    });
  } catch { /* silent fallback */ }
}

export function playDriverAssignedSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const tones = [
      { freq: 440, start: 0, duration: 0.12 },
      { freq: 554.37, start: 0.15, duration: 0.25 },
    ];
    tones.forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.6, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    });
  } catch { /* silent fallback */ }
}

// Sound file mapping
const SOUND_FILES: Record<EventType, string> = {
  new_order: '/sounds/new_order.mp3',
  waiter_called: '/sounds/waiter_call.mp3',
  order_cancelled: '/sounds/order_cancelled.mp3',
  driver_assigned: '/sounds/driver_assigned.mp3',
  order_status_changed: '/sounds/order_status_changed.mp3',
};

// Play event sound with specific role profile
export function playRoleEventSound(event: EventType, role: UserRole = 'owner') {
  if (typeof window === 'undefined') return;

  // 1. Resume audio context synchronously
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  } catch {}

  // 2. Play role-specific Web Audio synth sound
  try {
    if (role === 'kitchen') {
      if (event === 'new_order') playKitchenOrderSynth();
      else if (event === 'waiter_called') playKitchenWaiterSynth();
      else playKitchenOrderSynth();
    } else if (role === 'customer') {
      if (event === 'waiter_called') playCustomerWaiterComingSynth();
      else playCustomerStatusSynth();
    } else {
      // Owner (default)
      if (event === 'new_order') playOwnerOrderSynth();
      else if (event === 'waiter_called') playOwnerWaiterSynth();
      else if (event === 'order_cancelled') playOrderCancelledSynth();
      else playOwnerOrderSynth();
    }
  } catch {}

  // 3. Play MP3 file audio simultaneously
  const soundFile = SOUND_FILES[event];
  if (soundFile) {
    try {
      const audio = new Audio(soundFile);
      audio.volume = role === 'kitchen' ? 1.0 : role === 'customer' ? 0.6 : 0.9;
      audio.play().catch(() => {});
    } catch {}
  }
}

// Named function exports for direct caller usage
export const playEventSound = (event: EventType) => playRoleEventSound(event, 'owner');
export const playNewOrderSound = () => playRoleEventSound('new_order', 'owner');
export const playWaiterCallSound = () => playRoleEventSound('waiter_called', 'owner');
export const playOrderCancelledSound = () => playRoleEventSound('order_cancelled', 'owner');
export const playDriverAssignedSound = () => playRoleEventSound('driver_assigned', 'owner');
export const playOrderStatusSound = () => playRoleEventSound('order_status_changed', 'owner');
export const playKitchenOrderSound = () => playRoleEventSound('new_order', 'kitchen');

/**
 * Real-time notification flow:
 * 1. Popup UI Trigger
 * 2. Desktop Notification
 * 3. Role-specific Audio Sound
 * 4. Vibration (mobile)
 */
export function processRealTimeEvent(
  event: EventType,
  popupTrigger?: () => void,
  desktopDetails?: { title: string; body?: string; tag?: string },
  role: UserRole = 'owner'
) {
  // 1. Trigger Popup FIRST for instant UI modal rendering (<10ms)
  if (popupTrigger) {
    try {
      popupTrigger();
    } catch { /* ignore popup trigger error */ }
  }

  // 2. Trigger Native Desktop System Notification
  if (desktopDetails) {
    try {
      sendDesktopNotification(desktopDetails.title, {
        body: desktopDetails.body,
        tag: desktopDetails.tag || `${event}-${Date.now()}`,
      });
    } catch { /* ignore desktop notification error */ }
  }

  // 3. Play Role-Specific Sound
  try {
    playRoleEventSound(event, role);
  } catch { /* ignore audio error */ }

  // 4. Trigger Vibration (mobile)
  triggerVibration([200, 100, 200]);
}



