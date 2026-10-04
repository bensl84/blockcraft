// OWNER LANE: FEATURE-AUDIO. Procedural reverb impulse response (SPEC §8.3.1: shared convolver, 3.5 s IR).
// Pure fill function (unit-tested) + a tiny wrapper that makes the AudioBuffer.
//
// The IR is decorrelated stereo noise with an exponential decay (RT60 = seconds), a short pre-delay, a few
// sparse early reflections, and a one-pole low-pass whose cutoff closes over time so the tail gets darker
// (like a real room / a felt-piano hall) instead of hissing.

import { lcg } from './dsp.js';

/**
 * Fill two channel arrays with an impulse response. Returns the peak absolute value (after normalising, 1).
 * @param {Float32Array} L
 * @param {Float32Array} R
 * @param {number} sampleRate
 * @param {object} [o] {seconds = 3.5, rt60 = 3.0, predelay = 0.02, damp = 0.6 (0 bright .. 1 dark), seed}
 */
export function fillImpulse(L, R, sampleRate, o = {}) {
  const n = L.length;
  const rt60 = o.rt60 ?? 3.0;
  const pre = Math.floor((o.predelay ?? 0.02) * sampleRate);
  const damp = Math.max(0, Math.min(0.95, o.damp ?? 0.6));
  const rng = lcg(o.seed ?? 0x0c418);
  const k = Math.log(1000) / (rt60 * sampleRate); // amplitude e-fold so -60 dB at rt60
  let lpL = 0, lpR = 0;
  for (let i = 0; i < n; i++) {
    if (i < pre) { L[i] = 0; R[i] = 0; continue; }
    const t = i - pre;
    const env = Math.exp(-k * t);
    // cutoff closes from bright to dark over the tail
    const frac = Math.min(1, t / (n - pre));
    const a = 0.15 + 0.8 * damp * frac; // one-pole coefficient: higher = darker
    lpL = lpL * a + (rng() * 2 - 1) * (1 - a);
    lpR = lpR * a + (rng() * 2 - 1) * (1 - a);
    L[i] = lpL * env;
    R[i] = lpR * env;
  }
  // sparse early reflections in the first 80 ms
  for (let e = 0; e < 8; e++) {
    const at = pre + Math.floor(rng() * 0.08 * sampleRate);
    if (at < n) { const g = 0.6 * (1 - e / 10); L[at] += (rng() < 0.5 ? -g : g); R[Math.min(n - 1, at + Math.floor(rng() * 40))] += (rng() < 0.5 ? -g : g); }
  }
  // fade the last 50 ms to zero (no click at the end of the IR)
  const fade = Math.min(n, Math.floor(0.05 * sampleRate));
  for (let i = 0; i < fade; i++) { const g = i / fade; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
  let peak = 0;
  for (let i = 0; i < n; i++) { const m = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (m > peak) peak = m; }
  if (peak > 0) for (let i = 0; i < n; i++) { L[i] /= peak; R[i] /= peak; }
  return peak > 0 ? 1 : 0;
}

/** Build the IR AudioBuffer for a context. */
export function makeImpulse(ctx, o = {}) {
  const seconds = o.seconds ?? 3.5;
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  fillImpulse(buf.getChannelData(0), buf.getChannelData(1), ctx.sampleRate, o);
  return buf;
}
