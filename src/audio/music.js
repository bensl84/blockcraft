// OWNER LANE: FEATURE-AUDIO. Generative calm piano music (SPEC §8.3 Music, P1). Entirely original: a pure
// composer (composePiece, unit-tested) writes sparse pieces from major-seventh / ninth chords at 58-72 bpm
// with a short melodic motif that repeats and varies, separated by long rests. The MusicPlayer renders a
// small set of soft felt-piano note samples ONCE with an OfflineAudioContext after the first gesture, then
// schedules notes (pitch-shifted samples) through the music bus (which feeds the shared convolver reverb).
//
// Timing: first piece 20-40 s after a world starts, then 40-150 s of silence between pieces.
// Night mood (dusk..dawn): Dorian or Lydian and a wetter reverb.

import { noiseBuffers } from './dsp.js';

export const MODES = Object.freeze({
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
});

/** Chord progressions as 0-based scale degrees, per mode. Every chord is voiced as a 7th/9th chord. */
const PROGRESSIONS = Object.freeze({
  ionian: [[0, 3], [0, 3, 5, 3], [0, 5, 3, 4], [3, 0], [0, 2, 3, 0], [5, 3, 0, 4], [0, 4, 5, 3]],
  lydian: [[0, 1], [0, 1, 5, 0], [0, 4, 1, 0], [1, 0]],
  dorian: [[0, 3], [0, 6, 3, 0], [0, 2, 3, 0], [0, 4, 3]],
});

/** Possible tonics (pitch classes as MIDI in octave 2-3 for the bass). */
const TONICS = [36, 38, 39, 41, 43, 34, 37];
export const NOTE_RANGE = Object.freeze({ lo: 31, hi: 96 });

/** Scale degree (any integer, may exceed 7) -> MIDI note from a tonic. */
export function degreeToMidi(tonic, mode, deg) {
  const sc = MODES[mode];
  const o = Math.floor(deg / 7);
  const i = ((deg % 7) + 7) % 7;
  return tonic + o * 12 + sc[i];
}

/** Move a midi note by octaves into [lo, hi] (inclusive) when possible. */
function into(m, lo, hi) {
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m;
}

/**
 * Compose one piece. Pure and deterministic for a given rng.
 * @param {() => number} rng   uniform [0,1)
 * @param {object} [o]         {night=false, avoidTonic}
 * @returns {{bpm:number, tonic:number, mode:string, pattern:string, beats:number, seconds:number,
 *            events: Array<{beat:number, midi:number, vel:number, dur:number, part:'bass'|'lh'|'mel'}>}}
 */
export function composePiece(rng, o = {}) {
  const R = (a, b) => a + (b - a) * rng();
  const I = (n) => Math.floor(rng() * n) % n;
  const pickOf = (l) => l[I(l.length)];
  const night = !!o.night;
  const mode = night ? (rng() < 0.6 ? 'dorian' : 'lydian') : (rng() < 0.7 ? 'ionian' : 'lydian');
  let tonic = pickOf(TONICS);
  if (o.avoidTonic !== undefined && tonic === o.avoidTonic) tonic = TONICS[(TONICS.indexOf(tonic) + 1 + I(TONICS.length - 1)) % TONICS.length];
  const bpm = Math.round(R(58, 72));
  const prog = pickOf(PROGRESSIONS[mode]);
  const pattern = pickOf(['roll', 'arp', 'pulse']);
  const space = R(0.15, 0.45); // chance that a chord thins out to bass + one colour tone (room to breathe)
  const barsPerChord = 2;
  const events = [];
  const push = (beat, midi, vel, dur, part) => {
    if (midi < NOTE_RANGE.lo || midi > NOTE_RANGE.hi) return;
    events.push({ beat: Math.round(beat * 1000) / 1000, midi, vel: Math.max(0.08, Math.min(0.7, vel)), dur, part });
  };

  // chord tones (as scale degrees relative to the chord root degree): root, 3rd, 5th, 7th, 9th
  const chordDegs = (d) => [d, d + 2, d + 4, d + 6, d + 8];
  /** Left hand: rootless-ish voicing (3rd, 7th, 9th, sometimes 5th) placed in 50..67. */
  const voicing = (d) => {
    const cd = chordDegs(d);
    const tones = [cd[1], cd[3], cd[4]];
    if (rng() < 0.4) tones.push(cd[2]);
    return tones.map((x) => into(degreeToMidi(tonic, mode, x) + 12, 50, 67)).sort((a, b) => a - b)
      .filter((m, i, a) => i === 0 || m !== a[i - 1]);
  };

  const chordBeats = barsPerChord * 4;
  /** One pass through the progression starting at `beat`. motif: null or the motif to place. */
  const playPass = (beat, withMotif, motif, variation) => {
    prog.forEach((d, ci) => {
      const b0 = beat + ci * chordBeats;
      const bass = into(degreeToMidi(tonic, mode, d), 31, 47);
      push(b0, bass, R(0.34, 0.42), chordBeats, 'bass');
      const v = voicing(d);
      if (ci > 0 && rng() < space) { // a thin chord: just one colour tone, late and soft
        push(b0 + 2.5, v[v.length - 1], R(0.15, 0.2), chordBeats - 3, 'lh');
        if (withMotif && motif && (ci % 2 === 0)) placeMotif(b0 + motif.offset, d, motif, variation);
        return;
      }
      if (pattern === 'roll') {
        v.forEach((m, i) => push(b0 + 0.25 + i * 0.22, m, R(0.2, 0.28), chordBeats - 0.5, 'lh'));
        if (rng() < 0.5) push(b0 + 6, v[v.length - 1], R(0.16, 0.22), 2, 'lh');
      } else if (pattern === 'arp') {
        v.slice(0, 3).forEach((m, i) => push(b0 + 1 + i, m, R(0.2, 0.27), chordBeats - 1 - i, 'lh'));
        if (rng() < 0.6) push(b0 + 5, v[0], R(0.15, 0.2), 3, 'lh');
      } else {
        v.forEach((m) => push(b0 + 1.5, m, R(0.17, 0.23), 3, 'lh'));
        if (rng() < 0.7) v.forEach((m) => push(b0 + 4, m, R(0.14, 0.19), 4, 'lh'));
      }
      if (withMotif && motif && (ci % 2 === 0)) placeMotif(b0 + motif.offset, d, motif, variation);
    });
    return beat + prog.length * chordBeats;
  };

  // melody motif: contour as scale steps relative to the first note, plus rhythm (beats)
  const makeMotif = () => {
    const n = 3 + I(3);
    const steps = [0];
    for (let i = 1; i < n; i++) {
      const s = pickOf([-2, -1, -1, 1, 1, 2, 3, -3]);
      steps.push(steps[i - 1] + s);
    }
    const rhythm = [];
    for (let i = 0; i < n; i++) rhythm.push(pickOf([1, 1, 1.5, 2, 2, 3]));
    return { steps, rhythm, startTone: pickOf([1, 2, 3, 4]), offset: pickOf([0.5, 1, 2]) };
  };
  const placeMotif = (beat, chordDeg, motif, variation) => {
    const startDeg = chordDegs(chordDeg)[motif.startTone];
    let b = beat;
    // keep the melody in 67..86, above the left hand (50..67)
    let base = degreeToMidi(tonic, mode, startDeg + 14);
    let shift = 0;
    while (base + shift < 67) shift += 12;
    while (base + shift > 86) shift -= 12;
    motif.steps.forEach((s, i) => {
      let st = s;
      if (variation && i === motif.steps.length - 1) st += pickOf([-1, 1, 2]);
      const m = degreeToMidi(tonic, mode, startDeg + 14 + st) + shift;
      const dur = motif.rhythm[i];
      push(b, m, R(0.36, 0.48) - i * 0.02, dur + 1, 'mel');
      b += dur;
    });
  };

  const motif = makeMotif();
  let beat = 0;
  beat = playPass(beat, false, null, false);            // intro: chords only
  beat = playPass(beat, true, motif, false);             // A
  if (prog.length < 4) {                                 // long progressions skip this pass (pieces stay ~1.5 min)
    if (rng() < 0.55) beat = playPass(beat, true, motif, true); // A with a varied ending
    else beat = playPass(beat, true, makeMotif(), false);       // B: an answering motif
  }
  beat += 4;                                             // a breath (one bar of nothing new)
  beat = playPass(beat, rng() < 0.6, motif, false);      // A' (sometimes without melody)
  // outro: tonic chord held, one high colour note
  push(beat, into(degreeToMidi(tonic, mode, 0), 31, 47), 0.32, 8, 'bass');
  voicing(0).forEach((m, i) => push(beat + 0.3 + i * 0.3, m, 0.2, 7, 'lh'));
  push(beat + 2, into(degreeToMidi(tonic, mode, 8 + 7), 72, 86), 0.3, 6, 'mel');
  beat += 10;

  events.sort((a, b) => a.beat - b.beat);
  return { bpm, tonic, mode, pattern, beats: beat, seconds: beat * 60 / bpm, events };
}

/** Seconds of silence before the next piece. first: 20-40 s; later: 40-150 s (SPEC). */
export function nextGap(rng, first) { return first ? 20 + rng() * 20 : 40 + rng() * 110; }

/* ------------------------------------------------------------------ piano samples */
export const SAMPLE_NOTES = Object.freeze([31, 35, 39, 43, 47, 51, 55, 59, 63, 67, 71, 75, 79, 83, 87, 91, 95]);
const SAMPLE_RATE = 22050;
const sampleSeconds = (m) => (m < 52 ? 5.5 : m < 72 ? 4.2 : 3.0);

/** Nearest pre-rendered sample for a MIDI note -> {index, rate}. */
export function sampleFor(midi) {
  let best = 0;
  for (let i = 1; i < SAMPLE_NOTES.length; i++) if (Math.abs(SAMPLE_NOTES[i] - midi) < Math.abs(SAMPLE_NOTES[best] - midi)) best = i;
  return { index: best, rate: Math.pow(2, (midi - SAMPLE_NOTES[best]) / 12) };
}

/** Schedule one soft felt-piano note into an (offline) context. Original additive recipe. */
function renderPianoNote(ctx, out, t, midi, len) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const B = 0.00018;
  const K = Math.max(3, Math.min(10, Math.floor(7000 / f)));
  const tau = Math.max(0.6, Math.min(3.2, 1.7 * Math.pow(2, -(midi - 60) / 20)));
  const felt = ctx.createBiquadFilter();
  felt.type = 'lowpass';
  felt.frequency.setValueAtTime(Math.min(9000, f * 7 + 500), t);
  felt.frequency.setTargetAtTime(Math.min(4000, f * 3 + 300), t + 0.05, 0.6);
  felt.Q.setValueAtTime(0.4, t);
  felt.connect(out);
  const end = t + len;
  for (let k = 1; k <= K; k++) {
    const fk = f * k * Math.sqrt(1 + B * k * k);
    if (fk > 10000) break;
    const amp = 0.3 / Math.pow(k, 1.35) * (k === 1 ? 1 : 0.85);
    const tk = tau / (1 + 0.45 * (k - 1));
    for (let s = 0; s < (k <= 3 ? 2 : 1); s++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(fk, t);
      if (s === 1) osc.detune.setValueAtTime(1.3 + 0.4 * k, t);
      const g = ctx.createGain();
      const a = s === 1 ? amp * 0.55 : amp;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.007);
      g.gain.setTargetAtTime(a * 0.42, t + 0.007, tk * 0.12);   // prompt sound
      g.gain.setTargetAtTime(0, t + 0.2, tk);                    // aftersound
      g.gain.setValueAtTime(a * 0.42 * Math.exp(-(len - 0.25) / tk), end - 0.06);
      g.gain.linearRampToValueAtTime(0, end - 0.005);
      osc.connect(g); g.connect(felt);
      osc.start(t); osc.stop(end);
    }
  }
  // soft felt hammer thump
  const nz = ctx.createBufferSource();
  nz.buffer = noiseBuffers(ctx).pink;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(Math.min(3000, f * 3), t);
  bp.Q.setValueAtTime(0.8, t);
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0, t);
  hg.gain.linearRampToValueAtTime(0.05, t + 0.003);
  hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  nz.connect(bp); bp.connect(hg); hg.connect(out);
  nz.start(t); nz.stop(t + 0.04);
}

/**
 * Render every sample note once with an OfflineAudioContext. Resolves with Float32Array[] (mono, SAMPLE_RATE),
 * each normalised to a 0.9 peak. Needs window.OfflineAudioContext.
 */
export async function renderPianoSamples(OfflineCtor) {
  const lens = SAMPLE_NOTES.map(sampleSeconds);
  const starts = [];
  let total = 0;
  for (const l of lens) { starts.push(total); total += l + 0.05; }
  const frames = Math.ceil(total * SAMPLE_RATE);
  const off = new OfflineCtor(1, frames, SAMPLE_RATE);
  const bus = off.createGain();
  bus.gain.value = 1;
  bus.connect(off.destination);
  SAMPLE_NOTES.forEach((m, i) => renderPianoNote(off, bus, starts[i], m, lens[i]));
  const buf = await off.startRendering();
  const data = buf.getChannelData(0);
  return SAMPLE_NOTES.map((m, i) => {
    const a = Math.floor(starts[i] * SAMPLE_RATE);
    const slice = data.slice(a, a + Math.floor(lens[i] * SAMPLE_RATE));
    let peak = 0;
    for (let j = 0; j < slice.length; j++) { const v = Math.abs(slice[j]); if (v > peak) peak = v; }
    if (peak > 0) { const g = 0.9 / peak; for (let j = 0; j < slice.length; j++) slice[j] *= g; }
    return slice;
  });
}

/* ------------------------------------------------------------------ player */
const LOOKAHEAD = 1.5;

export class MusicPlayer {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} dest  music bus input
   * @param {() => number} rng
   */
  constructor(ctx, dest, rng) {
    this.ctx = ctx;
    this.rng = rng;
    this.fade = ctx.createGain();
    this.fade.gain.value = 1;
    this.fade.connect(dest);
    this.buffers = null;      // AudioBuffer[] once prepared
    this.preparing = null;    // Promise
    this.enabled = false;
    this.piece = null;
    this.pieceStart = 0;
    this.idx = 0;
    this.nextAt = Infinity;
    this.first = true;
    this.night = false;
    this.lastTonic = undefined;
    this.notesPlayed = 0;
    this.piecesStarted = 0;
    this.active = new Set();
    this.error = null;
  }

  /** Render the note samples (once). Resolves true when ready. */
  prepare(OfflineCtor) {
    if (this.buffers) return Promise.resolve(true);
    if (this.preparing) return this.preparing;
    if (!OfflineCtor) { this.error = 'no OfflineAudioContext'; return Promise.resolve(false); }
    this.preparing = renderPianoSamples(OfflineCtor).then((arrays) => {
      this.buffers = arrays.map((a) => {
        const b = this.ctx.createBuffer(1, a.length, SAMPLE_RATE);
        b.getChannelData(0).set(a);
        return b;
      });
      return true;
    }).catch((err) => { this.error = String(err && err.message || err); return false; });
    return this.preparing;
  }

  get ready() { return !!this.buffers; }
  get playing() { return !!this.piece; }

  /** Enable music; the next piece starts after `delay` seconds (default: the SPEC first-piece gap). */
  start(delay) {
    const now = this.ctx.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(this.fade.gain.value, now);
    this.fade.gain.linearRampToValueAtTime(1, now + 0.3);
    if (this.enabled && (this.piece || this.nextAt < Infinity) && delay === undefined) return;
    this.enabled = true;
    this.nextAt = now + (delay === undefined ? nextGap(this.rng, this.first) : Math.max(0, delay));
  }

  /** Fade out and stop scheduling. */
  stop(fade = 1.5) {
    const now = this.ctx.currentTime;
    this.enabled = false;
    this.piece = null;
    this.nextAt = Infinity;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(this.fade.gain.value, now);
    this.fade.gain.linearRampToValueAtTime(0, now + Math.max(0.05, fade));
    const stopAt = now + Math.max(0.05, fade) + 0.05;
    for (const s of this.active) { try { s.stop(stopAt); } catch { /* already stopped */ } }
  }

  /** Scheduler; call often (every frame). */
  update(now) {
    if (!this.enabled || !this.buffers) return;
    if (!this.piece) {
      if (now < this.nextAt) return;
      this.piece = composePiece(this.rng, { night: this.night, avoidTonic: this.lastTonic });
      this.lastTonic = this.piece.tonic;
      this.pieceStart = now + 0.2;
      this.idx = 0;
      this.first = false;
      this.piecesStarted++;
    }
    const p = this.piece;
    const spb = 60 / p.bpm;
    while (this.idx < p.events.length) {
      const e = p.events[this.idx];
      const t = this.pieceStart + e.beat * spb + (this.rng() - 0.5) * 0.02;
      if (t > now + LOOKAHEAD) break;
      this.idx++;
      if (t < now - 0.05) continue; // fell behind (tab was hidden): skip rather than burst
      this.note(e.midi, e.vel, Math.max(now, t), e.dur * spb);
    }
    if (this.idx >= p.events.length && now > this.pieceStart + p.seconds + 2) {
      this.piece = null;
      this.nextAt = now + nextGap(this.rng, false);
    }
  }

  /** Play one note now/at time t. vel 0..1, held for `hold` seconds then released (damper). */
  note(midi, vel, t, hold) {
    const { index, rate } = sampleFor(midi);
    const buf = this.buffers[index];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(rate, t);
    const g = this.ctx.createGain();
    const amp = Math.pow(vel, 1.5) * 1.45; // ~ +4 dB: music sits a little under block sounds at default volumes
    g.gain.setValueAtTime(amp, t);
    const natural = buf.duration / rate;
    const rel = t + Math.min(natural - 0.1, Math.max(0.2, hold));
    g.gain.setTargetAtTime(0, rel, 0.35);
    src.connect(g);
    g.connect(this.fade);
    const end = Math.min(t + natural, rel + 1.6);
    src.start(t);
    src.stop(end);
    this.active.add(src);
    src.onended = () => { this.active.delete(src); try { g.disconnect(); } catch { /* ignore */ } };
    this.notesPlayed++;
  }

  stats() {
    return { ready: this.ready, enabled: this.enabled, playing: this.playing, night: this.night, notesPlayed: this.notesPlayed,
      piecesStarted: this.piecesStarted, nextIn: Number.isFinite(this.nextAt) ? Math.max(0, this.nextAt - this.ctx.currentTime) : null,
      mode: this.piece ? this.piece.mode : null, bpm: this.piece ? this.piece.bpm : null, error: this.error };
  }
}
