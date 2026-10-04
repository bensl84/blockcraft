// OWNER LANE: FEATURE-AUDIO. Tiny WebAudio synthesis toolkit used by every sound recipe (sounds.js) and the
// piano sampler (music.js). Works on a real AudioContext and on an OfflineAudioContext alike, and only uses
// the standard node factory methods, so the unit tests can drive it with a mock context.
//
// A recipe receives a "voice context" v = { ctx, out, t0, p, r, sources, end } (see makeVoiceCtx) and calls
// the helpers below with times RELATIVE to v.t0. Every helper registers its source nodes in v.sources (so the
// mixer can stop a stolen voice) and extends v.end (so the mixer knows when the voice is over).

const NOISE_SECONDS = 2;
const noiseCache = new WeakMap(); // ctx -> {white, pink, brown}
const EPS = 0.0001;

/** Shared looping noise buffers for one context (created once, ~2 s each, mono). */
export function noiseBuffers(ctx) {
  let n = noiseCache.get(ctx);
  if (n) return n;
  const len = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
  const rng = lcg(0x5eed1234);
  const white = ctx.createBuffer(1, len, ctx.sampleRate);
  const pink = ctx.createBuffer(1, len, ctx.sampleRate);
  const brown = ctx.createBuffer(1, len, ctx.sampleRate);
  fillNoise(white.getChannelData(0), pink.getChannelData(0), brown.getChannelData(0), rng);
  n = { white, pink, brown };
  noiseCache.set(ctx, n);
  return n;
}

/** Fill white / pink (Paul Kellet economy filter) / brown noise arrays, each normalised to peak ~1. Pure. */
export function fillNoise(w, p, b, rng) {
  let b0 = 0, b1 = 0, b2 = 0, br = 0;
  for (let i = 0; i < w.length; i++) {
    const x = rng() * 2 - 1;
    w[i] = x;
    b0 = 0.99765 * b0 + x * 0.0990460;
    b1 = 0.96300 * b1 + x * 0.2965164;
    b2 = 0.57000 * b2 + x * 1.0526913;
    p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.2;
    br = (br + 0.02 * x) / 1.02;
    b[i] = br * 3.5;
  }
  normalise(p); normalise(b);
}

function normalise(a) {
  let m = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; }
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] /= m;
}

/** Small deterministic LCG in [0,1) (noise tables only; recipes get their own rng via v.r). */
export function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Create the voice context a recipe draws into.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} out   voice output node (the mixer's per-voice gain)
 * @param {number} t0       absolute start time (ctx.currentTime based)
 * @param {object} [o]      {pitch = 1, rand = Math.random, params = {}}
 */
export function makeVoiceCtx(ctx, out, t0, o = {}) {
  return { ctx, out, t0, p: o.pitch || 1, r: o.rand || Math.random, q: o.params || {}, sources: [], end: t0 };
}

/** Random in [a, b) from the voice rng. */
export function rr(v, a, b) { return a + (b - a) * v.r(); }
/** Random element. */
export function pick(v, list) { return list[Math.floor(v.r() * list.length) % list.length]; }

function track(v, src, stopAt) {
  v.sources.push(src);
  if (stopAt > v.end) v.end = stopAt;
}

/**
 * Apply an attack/decay envelope to an AudioParam: 0 -> peak in `a` s (linear), then exponential decay to
 * silence at `dur`. Optional `hold` keeps the peak before decaying. All times relative to `t` (absolute).
 */
export function envAD(param, t, a, peak, dur, hold = 0) {
  const pk = Math.max(EPS * 2, peak);
  const aa = Math.max(0.001, a);
  param.setValueAtTime(EPS, t);
  param.linearRampToValueAtTime(pk, t + aa);
  if (hold > 0) param.setValueAtTime(pk, t + aa + hold);
  param.exponentialRampToValueAtTime(EPS, t + Math.max(aa + hold + 0.005, dur));
}

/** Set a frequency param to f (and glide to f2 by `dur`), exponential when both > 0. */
function glide(param, t, f, f2, dur, lin = false) {
  param.setValueAtTime(Math.max(1, f), t);
  if (f2 && f2 !== f) {
    if (lin) param.linearRampToValueAtTime(Math.max(1, f2), t + dur);
    else param.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
  }
}

/** Follow a list of [timeRel, value] points on a param (exponential between points, values > 0). */
export function curve(param, t, pts, lin = false) {
  param.setValueAtTime(Math.max(EPS, pts[0][1]), t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) {
    const [dt, val] = pts[i];
    if (lin) param.linearRampToValueAtTime(val, t + dt);
    else param.exponentialRampToValueAtTime(Math.max(EPS, val), t + dt);
  }
}

/**
 * Oscillator with an AD envelope.
 * o: {type='sine', f, f2 (glide target), t=0, dur, a=0.004, g=0.5, hold=0, to=v.out, detune=0, lin=false,
 *     vib: {rate, depth (Hz)} }
 */
export function tone(v, o) {
  const { ctx } = v;
  const t = v.t0 + (o.t || 0);
  const dur = Math.max(0.01, o.dur || 0.2);
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  const f = (o.f || 440) * (o.noPitch ? 1 : v.p);
  const f2 = o.f2 ? o.f2 * (o.noPitch ? 1 : v.p) : 0;
  glide(osc.frequency, t, f, f2, dur * (o.glideFrac || 1), o.lin);
  if (o.detune) osc.detune.setValueAtTime(o.detune, t);
  const g = ctx.createGain();
  envAD(g.gain, t, o.a ?? 0.004, o.g ?? 0.5, dur, o.hold || 0);
  osc.connect(g);
  g.connect(o.to || v.out);
  if (o.vib) addVibrato(v, osc.frequency, t, dur, o.vib.rate, o.vib.depth * v.p);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  track(v, osc, t + dur + 0.02);
  return g;
}

/** LFO modulating an AudioParam (Hz depth). */
export function addVibrato(v, param, t, dur, rate, depth) {
  const lfo = v.ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(rate, t);
  const lg = v.ctx.createGain();
  lg.gain.setValueAtTime(depth, t);
  lfo.connect(lg);
  lg.connect(param);
  lfo.start(t);
  lfo.stop(t + dur + 0.02);
  track(v, lfo, t + dur + 0.02);
  return lfo;
}

/**
 * Filtered noise burst with an AD envelope.
 * o: {color='white'|'pink'|'brown', t=0, dur, a=0.002, g=0.5, hold=0, type='bandpass', f, f2, q=1, to, rate=1}
 * type 'none' skips the filter.
 */
export function noise(v, o) {
  const { ctx } = v;
  const t = v.t0 + (o.t || 0);
  const dur = Math.max(0.01, o.dur || 0.1);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffers(ctx)[o.color || 'white'];
  src.loop = true;
  if (o.rate) src.playbackRate.setValueAtTime(o.rate, t);
  const g = ctx.createGain();
  envAD(g.gain, t, o.a ?? 0.002, o.g ?? 0.5, dur, o.hold || 0);
  let head = src;
  if (o.type !== 'none') {
    const flt = ctx.createBiquadFilter();
    flt.type = o.type || 'bandpass';
    const pm = o.noPitch ? 1 : v.p;
    if (o.fpts) curve(flt.frequency, t, o.fpts.map(([dt, f]) => [Math.min(dt, dur), f * pm]));
    else glide(flt.frequency, t, (o.f || 1000) * pm, o.f2 ? o.f2 * pm : 0, dur);
    flt.Q.setValueAtTime(o.q ?? 1, t);
    src.connect(flt);
    head = flt;
  }
  head.connect(g);
  g.connect(o.to || v.out);
  const off = v.r() * (NOISE_SECONDS - 0.5);
  src.start(t, off);
  src.stop(t + dur + 0.02);
  track(v, src, t + dur + 0.02);
  return g;
}

/**
 * Granular crackle: n short noise grains on ONE source/filter/gain (cheap). Grains never overlap.
 * o: {t=0, dur, n, g=0.5, gJit=0.5, len=0.012, type='bandpass', f, fJit=0.3, q=2, color, to}
 */
export function crackle(v, o) {
  const { ctx } = v;
  const t = v.t0 + (o.t || 0);
  const dur = Math.max(0.02, o.dur || 0.2);
  const n = Math.max(1, o.n || 6);
  const len = o.len || 0.012;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffers(ctx)[o.color || 'white'];
  src.loop = true;
  const flt = ctx.createBiquadFilter();
  flt.type = o.type || 'bandpass';
  flt.Q.setValueAtTime(o.q ?? 2, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  // grain onsets: sorted random times, then pushed apart so each grain finishes before the next starts
  const times = [];
  for (let i = 0; i < n; i++) times.push(v.r() * Math.max(0.001, dur - len));
  times.sort((a, b) => a - b);
  let prevEnd = -1;
  const fBase = (o.f || 2000) * (o.noPitch ? 1 : v.p);
  const decay = o.decay ?? 0; // amplitude falloff over the grain train (0 = flat, 1 = last grain silent)
  let last = t;
  for (let i = 0; i < n; i++) {
    let gt = times[i];
    if (gt < prevEnd + 0.002) gt = prevEnd + 0.002;
    const gl = len * rr(v, 0.6, 1.4);
    if (gt + gl > dur + 0.2) break;
    const amp = Math.max(EPS * 2, (o.g ?? 0.5) * (1 - (o.gJit ?? 0.5) * v.r()) * (1 - decay * (gt / dur)));
    const ff = Math.max(40, fBase * (1 + (o.fJit ?? 0.3) * (v.r() * 2 - 1)));
    flt.frequency.setValueAtTime(ff, t + gt);
    g.gain.setValueAtTime(EPS, t + gt);
    g.gain.linearRampToValueAtTime(amp, t + gt + 0.0015);
    g.gain.exponentialRampToValueAtTime(EPS, t + gt + gl);
    prevEnd = gt + gl;
    last = t + gt + gl;
  }
  src.connect(flt);
  flt.connect(g);
  g.connect(o.to || v.out);
  src.start(t, v.r() * (NOISE_SECONDS - 0.5));
  src.stop(last + 0.02);
  track(v, src, last + 0.02);
  return g;
}

/**
 * Voiced (animal-like) sound: sawtooth/square source with a pitch contour, through parallel formant band-pass
 * filters, plus optional breath noise. o: {t=0, dur, f0: [[tRel, Hz]...], formants: [[Hz, Q, gain]...] or
 * fcurve: [[tRel, scale]...] (scales every formant), type='sawtooth', g=0.5, a=0.02, hold, vib:{rate, depth},
 * am:{rate, depth} (tremolo, 0..1), breath (0..1), to}
 */
export function voiced(v, o) {
  const { ctx } = v;
  const t = v.t0 + (o.t || 0);
  const dur = Math.max(0.03, o.dur || 0.4);
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sawtooth';
  const pts = (o.f0 || [[0, 200]]).map(([dt, f]) => [Math.min(dt, dur), f * v.p]);
  curve(osc.frequency, t, pts);
  if (o.vib) addVibrato(v, osc.frequency, t, dur, o.vib.rate, o.vib.depth * v.p);
  const sum = ctx.createGain();
  sum.gain.setValueAtTime(1, t);
  const env = ctx.createGain();
  envAD(env.gain, t, o.a ?? 0.02, o.g ?? 0.5, dur, o.hold || 0);
  for (const [ff, q, fg] of (o.formants || [[700, 4, 1], [1200, 5, 0.6]])) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    if (o.fcurve) curve(bp.frequency, t, o.fcurve.map(([dt, s]) => [Math.min(dt, dur), ff * s]));
    else bp.frequency.setValueAtTime(ff, t);
    bp.Q.setValueAtTime(q, t);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(fg, t);
    osc.connect(bp); bp.connect(bg); bg.connect(sum);
  }
  if (o.am) {
    // tremolo: env -> amGain whose gain is 1-depth/2 + lfo*depth/2
    const amg = ctx.createGain();
    amg.gain.setValueAtTime(1 - o.am.depth / 2, t);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(o.am.rate, t);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(o.am.depth / 2, t);
    lfo.connect(lg); lg.connect(amg.gain);
    lfo.start(t); lfo.stop(t + dur + 0.02);
    track(v, lfo, t + dur + 0.02);
    sum.connect(amg); amg.connect(env);
  } else sum.connect(env);
  env.connect(o.to || v.out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  track(v, osc, t + dur + 0.02);
  if (o.breath) noise(v, { t: o.t || 0, dur, a: o.a ?? 0.02, g: (o.g ?? 0.5) * o.breath, type: 'bandpass', f: (o.formants ? o.formants[0][0] : 900) / v.p, q: 1.2, to: o.to });
  return env;
}

/** A low-passed sub-mix node (for muffled/soft sounds). Returns the filter (connect recipe parts into it). */
export function lowpass(v, f, q = 0.7, to = v.out) {
  const flt = v.ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.setValueAtTime(f, v.t0);
  flt.Q.setValueAtTime(q, v.t0);
  flt.connect(to);
  return flt;
}

/** A gain sub-mix node. */
export function sub(v, gain = 1, to = v.out) {
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(gain, v.t0);
  g.connect(to);
  return g;
}

/** Bell / chime partial stack (sine partials with individual decays). o: {t, f, dur, g, partials: [[ratio, gain, decayMul]]} */
export function bell(v, o) {
  const parts = o.partials || [[1, 1, 1], [2, 0.35, 0.6], [3.01, 0.15, 0.4], [4.2, 0.08, 0.3]];
  for (const [ratio, pg, dm] of parts) {
    tone(v, { t: o.t || 0, f: o.f * ratio, dur: (o.dur || 0.6) * dm, a: o.a ?? 0.003, g: (o.g ?? 0.3) * pg, to: o.to });
  }
}

/** Decibels from a linear amplitude (floors at -120 dB). */
export function toDb(a) { return a > 1e-6 ? 20 * Math.log10(a) : -120; }
