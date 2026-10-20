import type { Settings } from './api';

type VoiceCfg = Settings['voice'];

export const ttsSupported = () => 'speechSynthesis' in window;
export const sttSupported = () => !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export function listVoices(): SpeechSynthesisVoice[] {
  return ttsSupported() ? window.speechSynthesis.getVoices() : [];
}

/** Speak a message using the user's voice settings. Does nothing unless voice is enabled and not muted. */
export function speak(text: string, cfg: VoiceCfg, force = false) {
  if (!ttsSupported() || !text) return;
  if (!force && (!cfg.enabled || cfg.muted)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = cfg.rate;
  u.volume = cfg.volume;
  const v = listVoices().find((x) => x.name === cfg.voiceName);
  if (v) u.voice = v;
  synth.speak(u);
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/**
 * One-shot voice input. The browser asks the user for microphone permission the first time.
 * Returns a stop() function. Where speech recognition isn't supported, onError explains that typing works instead.
 */
export function listen(onText: (t: string) => void, onEnd: () => void, onError: (m: string) => void): () => void {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) {
    onError('Voice input isn’t supported in this browser. You can type instead.');
    onEnd();
    return () => {};
  }
  const rec = new SR();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e: any) => onText(e.results[0][0].transcript);
  rec.onerror = (e: any) => onError(e.error === 'not-allowed' ? 'Microphone access was blocked. You can type instead.' : `Voice input error: ${e.error}`);
  rec.onend = onEnd;
  try { rec.start(); } catch { onEnd(); }
  return () => { try { rec.stop(); } catch { /* ignore */ } };
}
