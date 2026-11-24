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
let userHasInteracted = false;

function hasUserGesture(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && (navigator as any).userActivation) {
    if ((navigator as any).userActivation.hasBeenActive) return true;
  }
  return userHasInteracted;
}

if (typeof window !== 'undefined') {
  const handleUserGesture = () => {
    userHasInteracted = true;
    try {
      if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) sharedAudioCtx = new AudioCtx();
      } else if (sharedAudioCtx.state === 'suspended') {
        sharedAudioCtx.resume().catch(() => {});
      }
      requestDesktopNotificationPermission();
    } catch {}
  };
  
  // Unlock on real user gestures (click or touchend)
  ['click', 'touchend'].forEach((evt) => {
    window.addEventListener(evt, handleUserGesture, { capture: true, passive: true });
  });
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!hasUserGesture()) {
    return null;
  }
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx.state === 'running' ? sharedAudioCtx : null;
  } catch {
    return null;
  }
}

import { useWaiterStore } from '@/store/waiter.store';

/**
 * Returns the current notification volume as a scalar multiplier (0.10 to 1.50).
 * 1.00 = 100% standard high volume, up to 1.50 = 150% Laptop Boost Mode.
 */
export function getNotificationVolume(): number {
  try {
    const vol = useWaiterStore.getState().volume;
    if (typeof vol === 'number' && !isNaN(vol)) {
      return Math.max(0.05, Math.min(1.5, vol / 100));
    }
  } catch {}
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('notification_volume');
    if (saved) {
      const parsed = Number(saved);
      if (!isNaN(parsed)) return Math.max(0.05, Math.min(1.5, parsed / 100));
    }
  }
  return 1.0;
}

export function setNotificationVolume(percentage: number) {
  const clean = Math.max(0, Math.min(150, Math.round(percentage)));
  try {
    useWaiterStore.getState().setVolume(clean);
  } catch {
    if (typeof window !== 'undefined') {
      localStorage.setItem('notification_volume', String(clean));
    }
  }
}

/**
 * Master output bus tailored specifically for PC and Windows laptop speakers:
 * - Uses DynamicsCompressorNode to boost RMS loudness by +6dB to +12dB without digital clipping.
 * - Scales directly with the user's volume preference (10% to 150%).
 */
function createAudioMaster(ctx: AudioContext, gainMultiplier: number = 1.0): { input: GainNode; masterGain: GainNode } {
  const userVol = getNotificationVolume(); // 0.1 to 1.5

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-12, ctx.currentTime);
  compressor.knee.setValueAtTime(8, ctx.currentTime);
  compressor.ratio.setValueAtTime(4.0, ctx.currentTime);
  compressor.attack.setValueAtTime(0.003, ctx.currentTime);
  compressor.release.setValueAtTime(0.20, ctx.currentTime);

  const masterGain = ctx.createGain();
  // Base 1.8x amplifier ensures 100% is significantly louder than before, with 150% providing massive laptop projection
  const effectiveGain = Math.max(0.02, userVol * gainMultiplier * 1.8);
  masterGain.gain.setValueAtTime(effectiveGain, ctx.currentTime);

  const inputNode = ctx.createGain();
  inputNode.gain.setValueAtTime(1.0, ctx.currentTime);

  inputNode.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(ctx.destination);

  return { input: inputNode, masterGain };
}

/**
 * Play a quick, pleasant feedback chirp whenever volume is increased or decreased
 */
export function playVolumePreview(volumePercent?: number): boolean {
  try {
    if (typeof volumePercent === 'number') {
      setNotificationVolume(volumePercent);
    }
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const master = createAudioMaster(ctx, 1.0);

    const notes = [
      { freq: 783.99, time: 0.00, dur: 0.12, vol: 0.65 }, // G5
      { freq: 1046.50, time: 0.08, dur: 0.22, vol: 0.80 }, // C6
    ];

    notes.forEach(({ freq, time, dur, vol }) => {
      const tStart = now + time;
      const tEnd = tStart + dur;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, tStart);

      gain.gain.setValueAtTime(0.0001, tStart);
      gain.gain.linearRampToValueAtTime(vol, tStart + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

      osc.connect(gain);
      gain.connect(master.input);
      osc.start(tStart);
      osc.stop(tEnd);
    });
    return true;
  } catch {
    return false;
  }
}

// ── 1. OWNER AUDIO SYNTHS (Pleasant POS Chime & Restaurant Desk Bell) ───────────

// 🛍️ New Order Sound: Warm, cheerful ascending 4-note POS chime (C5 -> E5 -> G5 -> C6)
// Boosted with high-mid acoustic body to cut clearly through laptop speakers
export function playOwnerOrderSynth(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const master = createAudioMaster(ctx, 1.0);

    // Upbeat 4-note ascending chord arpeggio (C5 -> E5 -> G5 -> C6)
    const notes = [
      { freq: 523.25, time: 0.00, duration: 0.22, vol: 0.75 }, // C5
      { freq: 659.25, time: 0.10, duration: 0.22, vol: 0.78 }, // E5
      { freq: 783.99, time: 0.20, duration: 0.25, vol: 0.85 }, // G5
      { freq: 1046.50, time: 0.30, duration: 0.50, vol: 0.95 }, // C6 (Resolution)
    ];

    notes.forEach(({ freq, time, duration, vol }) => {
      const noteStart = now + time;
      const noteEnd = noteStart + duration;

      // Primary crisp sine tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteStart);

      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.linearRampToValueAtTime(vol, noteStart + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

      osc.connect(gain);
      gain.connect(master.input);
      osc.start(noteStart);
      osc.stop(noteEnd);

      // Warm acoustic body harmonic (triangle waveform adds acoustic punch on laptop speakers)
      const bodyOsc = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      bodyOsc.type = 'triangle';
      bodyOsc.frequency.setValueAtTime(freq, noteStart);

      bodyGain.gain.setValueAtTime(0.0001, noteStart);
      bodyGain.gain.linearRampToValueAtTime(vol * 0.35, noteStart + 0.006);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

      bodyOsc.connect(bodyGain);
      bodyGain.connect(master.input);
      bodyOsc.start(noteStart);
      bodyOsc.stop(noteEnd);

      // Shimmering octave overtone for acoustic presence
      const overtone = ctx.createOscillator();
      const overtoneGain = ctx.createGain();
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(freq * 2, noteStart);

      overtoneGain.gain.setValueAtTime(0.0001, noteStart);
      overtoneGain.gain.linearRampToValueAtTime(vol * 0.25, noteStart + 0.006);
      overtoneGain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

      overtone.connect(overtoneGain);
      overtoneGain.connect(master.input);
      overtone.start(noteStart);
      overtone.stop(noteEnd);
    });
    return true;
  } catch {
    return false;
  }
}

// 🔔 Waiter Call Sound: Authentic Brass Desk Service Bell ("Ding-Ding!")
// Classic counter service bell with crisp double-strike & resonant metallic shimmer
export function playOwnerWaiterSynth(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const master = createAudioMaster(ctx, 1.1);

    // Double bell strike: first strike at t=0, second at t=0.22s
    const strikes = [0.0, 0.22];

    strikes.forEach((delay, idx) => {
      const strikeTime = now + delay;
      const strikeVol = idx === 0 ? 0.90 : 0.85;

      // 1. Strike transient tap (mallet hitting brass bell)
      const tapOsc = ctx.createOscillator();
      const tapGain = ctx.createGain();
      tapOsc.type = 'triangle';
      tapOsc.frequency.setValueAtTime(980, strikeTime);
      tapGain.gain.setValueAtTime(0.0001, strikeTime);
      tapGain.gain.linearRampToValueAtTime(0.25 * strikeVol, strikeTime + 0.002);
      tapGain.gain.exponentialRampToValueAtTime(0.0001, strikeTime + 0.04);
      tapOsc.connect(tapGain);
      tapGain.connect(master.input);
      tapOsc.start(strikeTime);
      tapOsc.stop(strikeTime + 0.04);

      // 2. Fundamental Bell Resonance: A6 (1760 Hz)
      const bellOsc = ctx.createOscillator();
      const bellGain = ctx.createGain();
      bellOsc.type = 'sine';
      bellOsc.frequency.setValueAtTime(1760, strikeTime);
      bellGain.gain.setValueAtTime(0.0001, strikeTime);
      bellGain.gain.linearRampToValueAtTime(strikeVol, strikeTime + 0.003);
      bellGain.gain.exponentialRampToValueAtTime(0.0001, strikeTime + 0.85);
      bellOsc.connect(bellGain);
      bellGain.connect(master.input);
      bellOsc.start(strikeTime);
      bellOsc.stop(strikeTime + 0.85);

      // 3. Bell Overtone: E7 (2640 Hz)
      const overtone1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      overtone1.type = 'sine';
      overtone1.frequency.setValueAtTime(2640, strikeTime);
      gain1.gain.setValueAtTime(0.0001, strikeTime);
      gain1.gain.linearRampToValueAtTime(strikeVol * 0.40, strikeTime + 0.003);
      gain1.gain.exponentialRampToValueAtTime(0.0001, strikeTime + 0.55);
      overtone1.connect(gain1);
      gain1.connect(master.input);
      overtone1.start(strikeTime);
      overtone1.stop(strikeTime + 0.55);

      // 4. Shimmering high overtone: A7 (3520 Hz)
      const overtone2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      overtone2.type = 'sine';
      overtone2.frequency.setValueAtTime(3520, strikeTime);
      gain2.gain.setValueAtTime(0.0001, strikeTime);
      gain2.gain.linearRampToValueAtTime(strikeVol * 0.25, strikeTime + 0.003);
      gain2.gain.exponentialRampToValueAtTime(0.0001, strikeTime + 0.45);
      overtone2.connect(gain2);
      gain2.connect(master.input);
      overtone2.start(strikeTime);
      overtone2.stop(strikeTime + 0.45);
    });

    return true;
  } catch {
    return false;
  }
}

// ── 2. KITCHEN AUDIO SYNTHS (Resonant triple kitchen chime) ───────────────────
export function playKitchenOrderSynth(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const master = createAudioMaster(ctx, 1.2);
    const strokes = [
      { delay: 0.00, freq: 587.33, duration: 0.35, vol: 0.85 }, // D5
      { delay: 0.16, freq: 880.00, duration: 0.40, vol: 0.90 }, // A5
      { delay: 0.32, freq: 1046.50, duration: 0.60, vol: 1.00 }, // C6
    ];
    strokes.forEach(({ delay, freq, duration, vol }) => {
      const strikeTime = now + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, strikeTime);
      gain.gain.setValueAtTime(0.0001, strikeTime);
      gain.gain.linearRampToValueAtTime(vol, strikeTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, strikeTime + duration);
      osc.connect(gain);
      gain.connect(master.input);
      osc.start(strikeTime);
      osc.stop(strikeTime + duration);

      // Rich body harmonic
      const body = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      body.type = 'triangle';
      body.frequency.setValueAtTime(freq, strikeTime);
      bodyGain.gain.setValueAtTime(0.0001, strikeTime);
      bodyGain.gain.linearRampToValueAtTime(vol * 0.35, strikeTime + 0.008);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, strikeTime + duration);
      body.connect(bodyGain);
      bodyGain.connect(master.input);
      body.start(strikeTime);
      body.stop(strikeTime + duration);
    });
    return true;
  } catch {
    return false;
  }
}

export function playKitchenWaiterSynth(): boolean {
  return playOwnerWaiterSynth();
}

// ── 3. CUSTOMER AUDIO SYNTHS (Soft, pleasant melodic tones) ──────────────────
export function playCustomerStatusSynth(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const notes = [
      { freq: 440.00, time: 0.00, duration: 0.25, vol: 0.30 },
      { freq: 554.37, time: 0.12, duration: 0.40, vol: 0.30 },
    ];
    notes.forEach(({ freq, time, duration, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + time);
      gain.gain.setValueAtTime(0.0001, now + time);
      gain.gain.linearRampToValueAtTime(vol, now + time + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + time + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + time);
      osc.stop(now + time + duration);
    });
    return true;
  } catch {
    return false;
  }
}

export function playCustomerWaiterComingSynth(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
    return true;
  } catch {
    return false;
  }
}

export function playOrderCancelledSynth(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const tones = [
      { freq: 659.25, start: 0.00, duration: 0.25, vol: 0.25 },
      { freq: 523.25, start: 0.15, duration: 0.40, vol: 0.25 },
    ];
    tones.forEach(({ freq, start, duration, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    });
    return true;
  } catch {
    return false;
  }
}

export function playDriverAssignedSynth(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const tones = [
      { freq: 523.25, start: 0.00, duration: 0.18, vol: 0.25 },
      { freq: 659.25, start: 0.12, duration: 0.35, vol: 0.25 },
    ];
    tones.forEach(({ freq, start, duration, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    });
    return true;
  } catch {
    return false;
  }
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

  // Respect owner sound mute preference
  if (role === 'owner') {
    try {
      if (useWaiterStore.getState().soundEnabled === false) {
        return;
      }
    } catch {}
  }

  // 1. Resume audio context safely if user has interacted
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended' && userHasInteracted) {
      ctx.resume().catch(() => {});
    }
  } catch {}

  // 2. Play role-specific Web Audio synth sound
  let synthPlayed = false;
  try {
    if (role === 'kitchen') {
      if (event === 'new_order') synthPlayed = playKitchenOrderSynth();
      else if (event === 'waiter_called') synthPlayed = playKitchenWaiterSynth();
      else synthPlayed = playKitchenOrderSynth();
    } else if (role === 'customer') {
      if (event === 'waiter_called') synthPlayed = playCustomerWaiterComingSynth();
      else synthPlayed = playCustomerStatusSynth();
    } else {
      // Owner (default)
      if (event === 'new_order') synthPlayed = playOwnerOrderSynth();
      else if (event === 'waiter_called') synthPlayed = playOwnerWaiterSynth();
      else if (event === 'order_cancelled') synthPlayed = playOrderCancelledSynth();
      else if (event === 'driver_assigned') synthPlayed = playDriverAssignedSynth();
      else if (event === 'order_status_changed') synthPlayed = true; // Quiet status change - avoid replaying new order sound when accepting
      else synthPlayed = false;
    }
  } catch {
    synthPlayed = false;
  }

  // 3. Fallback to HTML5 audio file only if synth did not succeed
  if (!synthPlayed) {
    const soundFile = SOUND_FILES[event];
    if (soundFile) {
      try {
        const audio = new Audio(soundFile);
        const baseVol = role === 'kitchen' ? 1.0 : role === 'customer' ? 0.6 : 0.9;
        audio.volume = Math.min(1.0, Math.max(0.05, baseVol * getNotificationVolume()));
        audio.play().catch(() => {});
      } catch {}
    }
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



