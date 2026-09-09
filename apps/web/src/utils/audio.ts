/**
 * Real-Time Sound, Popup, and Vibration Notification Service
 * Supports:
 * - Real-time audio playback for:
 *   1. new_order -> new_order.mp3 / Order sound 🔔
 *   2. waiter_called -> waiter_call.mp3 / Waiter sound 🛎️
 *   3. order_cancelled -> order_cancelled.mp3 / Cancel sound ⚠️
 *   4. driver_assigned -> driver_assigned.mp3 / Driver sound 🚗
 *   5. order_status_changed -> order_status_changed.mp3 / Status sound 🔔
 * - Web Audio API fallback synthesized tones
 * - Mobile Haptic Vibration (navigator.vibrate)
 * - Sequential execution: Sound -> Popup -> Vibration (mobile)
 */

export type EventType =
  | 'new_order'
  | 'waiter_called'
  | 'order_cancelled'
  | 'driver_assigned'
  | 'order_status_changed';

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
    } catch {}
  };
  ['click', 'keydown', 'touchstart', 'mousemove', 'scroll', 'pointerdown', 'focus'].forEach((evt) => {
    window.addEventListener(evt, unlockAudio, { capture: true, passive: true });
  });
}

// Synthesized Sound Fallbacks
export function playNewOrderSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const notes = [
      { freq: 523.25, time: 0, duration: 0.15 },
      { freq: 659.25, time: 0.15, duration: 0.15 },
      { freq: 783.99, time: 0.3, duration: 0.15 },
      { freq: 1046.5, time: 0.45, duration: 0.4 },
    ];
    notes.forEach(({ freq, time, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + time);
      gain.gain.setValueAtTime(0.8, now + time);
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + time);
      osc.stop(now + time + duration);
    });
  } catch { /* silent fallback */ }
}

export function playWaiterCallSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const pulses = [
      { freq1: 987.77, freq2: 1318.51, start: 0 },
      { freq1: 987.77, freq2: 1318.51, start: 0.4 },
    ];
    pulses.forEach(({ freq1, freq2, start }) => {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(freq1, now + start);
      osc2.frequency.setValueAtTime(freq2, now + start + 0.12);
      gain.gain.setValueAtTime(0.9, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.35);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(now + start);
      osc2.start(now + start + 0.12);
      osc1.stop(now + start + 0.35);
      osc2.stop(now + start + 0.35);
    });
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

export function playOrderStatusSynth() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const tones = [
      { freq: 659.25, start: 0, duration: 0.15 },
      { freq: 880, start: 0.15, duration: 0.3 },
    ];
    tones.forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
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

// Sound file mapping
const SOUND_FILES: Record<EventType, string> = {
  new_order: '/sounds/new_order.mp3',
  waiter_called: '/sounds/waiter_call.mp3',
  order_cancelled: '/sounds/order_cancelled.mp3',
  driver_assigned: '/sounds/driver_assigned.mp3',
  order_status_changed: '/sounds/order_status_changed.mp3',
};

const SYNTH_FALLBACKS: Record<EventType, () => void> = {
  new_order: playNewOrderSynth,
  waiter_called: playWaiterCallSynth,
  order_cancelled: playOrderCancelledSynth,
  driver_assigned: playDriverAssignedSynth,
  order_status_changed: playOrderStatusSynth,
};

export function playEventSound(event: EventType) {
  if (typeof window === 'undefined') return;

  // 1. Play instant Web Audio synth sound (0ms latency chime)
  const synth = SYNTH_FALLBACKS[event];
  if (synth) {
    try {
      synth();
    } catch {}
  }

  // 2. Play MP3 file audio simultaneously
  const soundFile = SOUND_FILES[event];
  if (soundFile) {
    try {
      const audio = new Audio(soundFile);
      audio.volume = 1.0;
      audio.play().catch(() => {});
    } catch {}
  }
}

// Named function exports for direct caller usage
export const playNewOrderSound = () => playEventSound('new_order');
export const playWaiterCallSound = () => playEventSound('waiter_called');
export const playOrderCancelledSound = () => playEventSound('order_cancelled');
export const playDriverAssignedSound = () => playEventSound('driver_assigned');
export const playOrderStatusSound = () => playEventSound('order_status_changed');
export const playKitchenOrderSound = () => playEventSound('new_order');

/**
 * Real-time notification flow:
 * 1. Sound
 * 2. Popup
 * 3. Vibration (mobile)
 */
export function processRealTimeEvent(
  event: EventType,
  popupTrigger?: () => void
) {
  // 1. Trigger Popup FIRST for instant UI modal rendering (<10ms)
  if (popupTrigger) {
    try {
      popupTrigger();
    } catch { /* ignore popup trigger error */ }
  }

  // 2. Play Sound
  try {
    playEventSound(event);
  } catch { /* ignore audio error */ }

  // 3. Trigger Vibration (mobile)
  triggerVibration([200, 100, 200]);
}

