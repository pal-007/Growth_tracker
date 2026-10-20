import confetti from 'canvas-confetti';

let ctx: AudioContext | null = null;
const audio = () => {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
};

function tone(freq: number, start: number, dur: number, gain = 0.08, type: OscillatorType = 'sine') {
  const c = audio();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

/** Subtle two-note "pling". Only plays when the user has sounds turned on. */
export function playComplete(on: boolean) {
  if (!on) return;
  tone(660, 0, 0.18);
  tone(990, 0.09, 0.28);
}
export function playLevelUp(on: boolean) {
  if (!on) return;
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.3, 0.07));
}
export function playChime(on: boolean) {
  if (!on) return;
  tone(880, 0, 0.5, 0.07);
  tone(660, 0.25, 0.7, 0.07);
}

export function sparkle(animations: boolean, big = false, origin?: { x: number; y: number }) {
  if (!animations) return;
  const colors = ['#8b5cf6', '#3b82f6', '#22d3ee', '#f472b6', '#fbbf24'];
  confetti({ particleCount: big ? 160 : 40, spread: big ? 100 : 60, startVelocity: big ? 45 : 32, origin: origin ?? { y: 0.7 }, colors, disableForReducedMotion: true, ticks: big ? 220 : 120 });
  if (big) {
    setTimeout(() => confetti({ particleCount: 70, angle: 60, spread: 70, origin: { x: 0, y: 0.8 }, colors, disableForReducedMotion: true }), 200);
    setTimeout(() => confetti({ particleCount: 70, angle: 120, spread: 70, origin: { x: 1, y: 0.8 }, colors, disableForReducedMotion: true }), 350);
  }
}

// ---------- Ambient focus sounds (generated in the browser, no files needed) ----------
let ambient: { stop: () => void } | null = null;
export const AMBIENT = [
  { key: 'rain', label: 'Rain' },
  { key: 'brown', label: 'Deep noise' },
  { key: 'white', label: 'White noise' },
];

export function startAmbient(kind: string, volume = 0.5) {
  stopAmbient();
  const c = audio();
  if (!c) return;
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.5; } else data[i] = white;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = kind === 'rain' ? 'bandpass' : 'lowpass';
  filter.frequency.value = kind === 'rain' ? 1800 : kind === 'brown' ? 500 : 6000;
  const g = c.createGain();
  g.gain.value = 0.18 * volume;
  src.connect(filter).connect(g).connect(c.destination);
  src.start();
  ambient = { stop: () => { try { src.stop(); } catch { /* already stopped */ } src.disconnect(); } };
}
export function stopAmbient() {
  ambient?.stop();
  ambient = null;
}

// ---------- Notifications (need the user's permission; only fire while the app is open) ----------
export const notifSupported = () => 'Notification' in window;
export async function askNotificationPermission(): Promise<NotificationPermission> {
  if (!notifSupported()) return 'denied';
  return Notification.requestPermission();
}
export function notify(title: string, body: string) {
  if (notifSupported() && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch { /* some browsers block constructor use */ }
  }
}
