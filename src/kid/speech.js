// OWNER LANE: KID. Optional text-to-speech (settings.speakNames, default off): block names when a hotbar slot
// is selected and the hint lines. LOCAL voices only (voice.localService) - a network voice would send text off
// the device, so with no local voice nothing is spoken. Never throws.

import { pickVoice } from './logic.js';

export function createSpeech(game) {
  const synth = (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis : null;
  let voices = [];
  let timer = 0;
  const sp = {
    available: !!synth,
    /** last request {text, spoken, voice, at} (tests read it through game.kid.speech.last) */
    last: null,
    count: 0,
    refresh() { try { voices = synth ? synth.getVoices() || [] : []; } catch { voices = []; } },
    voice() { return pickVoice(voices, (typeof navigator !== 'undefined' && navigator.language) || 'en-US'); },
    /** Speak `text` after `delayMs` (debounced: only the newest request in the window is spoken). */
    say(text, delayMs = 0) {
      if (!text) return;
      clearTimeout(timer);
      timer = setTimeout(() => sp.speakNow(text), delayMs);
    },
    speakNow(text) {
      const v = sp.voice();
      const muted = game.settings.muted || game.settings.masterVolume <= 0;
      sp.last = { text, spoken: !!(v && synth && !muted), voice: v ? v.name : null, at: Date.now() };
      sp.count++;
      if (!v || !synth || muted) return false;
      try {
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.voice = v; u.lang = v.lang; u.rate = 0.9; u.pitch = 1.1;
        u.volume = Math.max(0, Math.min(1, game.settings.masterVolume / 0.65));
        synth.speak(u);
        return true;
      } catch (err) { game.reportError(err, 'kid speech'); return false; }
    },
    cancel() { clearTimeout(timer); try { if (synth) synth.cancel(); } catch { /* ignore */ } },
  };
  if (synth) {
    sp.refresh();
    try { synth.addEventListener('voiceschanged', () => sp.refresh()); } catch { /* old API */ }
  }
  return sp;
}
