/**
 * Web Audio API Notification Sound Synthesizer
 * Provides crystal-clear, loud, distinct sounds for:
 * 1. New Order Notification
 * 2. Waiter Call Bell
 * 3. Kitchen Display Chime
 */

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

// Unlock audio context on user interaction
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume();
    }
  };
  window.addEventListener('click', unlockAudio, { once: false, capture: true });
  window.addEventListener('keydown', unlockAudio, { once: false, capture: true });
  window.addEventListener('touchstart', unlockAudio, { once: false, capture: true });
}

/**
 * Loud, clear 4-tone chime sequence for New Orders
 */
export function playNewOrderSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Melody: C5 (523.25) -> E5 (659.25) -> G5 (783.99) -> C6 (1046.50)
    const notes = [
      { freq: 523.25, time: 0, duration: 0.15 },
      { freq: 659.25, time: 0.15, duration: 0.15 },
      { freq: 783.99, time: 0.3, duration: 0.15 },
      { freq: 1046.5, time: 0.45, duration: 0.4 },
    ];

    // Repeat melody twice for maximum clarity
    const repeatOffset = 0.9;
    const allNotes = [
      ...notes,
      ...notes.map((n) => ({ ...n, time: n.time + repeatOffset })),
    ];

    allNotes.forEach(({ freq, time, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + time);

      // Warm overtone oscillator
      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(freq * 0.5, now + time);

      gain.gain.setValueAtTime(0.7, now + time);
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);

      osc.connect(gain);
      subOsc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + time);
      subOsc.start(now + time);
      osc.stop(now + time + duration);
      subOsc.stop(now + time + duration);
    });
  } catch {
    /* Silent fallback */
  }
}

/**
 * Loud 2-pulse bell chime for Waiter Calls / Bill Requests
 */
export function playWaiterCallSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Bell pulses: Ring-Ding... Ring-Ding!
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

      gain.gain.setValueAtTime(0.8, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now + start);
      osc2.start(now + start + 0.12);
      osc1.stop(now + start + 0.35);
      osc2.stop(now + start + 0.35);
    });
  } catch {
    /* Silent fallback */
  }
}

/**
 * High-pitched crisp chime for Kitchen Display Queue
 */
export function playKitchenOrderSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Kitchen Chime: High E5 -> G5 -> C6 -> E6
    const tones = [
      { freq: 659.25, start: 0, len: 0.15 },
      { freq: 783.99, start: 0.15, len: 0.15 },
      { freq: 1046.5, start: 0.3, len: 0.2 },
      { freq: 1318.51, start: 0.5, len: 0.4 },
    ];

    tones.forEach(({ freq, start, len }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square'; // Crisper sound for kitchen background noise
      osc.frequency.setValueAtTime(freq, now + start);

      // Lowpass filter to smooth square wave into crisp bell
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2500, now + start);

      gain.gain.setValueAtTime(0.5, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + len);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + len);
    });
  } catch {
    /* Silent fallback */
  }
}
