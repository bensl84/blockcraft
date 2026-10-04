// OWNER LANE: FEATURE-AUDIO. Pure mixing logic (no WebAudio here, unit-tested in Node):
//  - VoiceTable: SPEC §8.3.1 limits - at most 32 live voices, at most 4 of one name, at most 12 starts per
//    second for one name, plus an optional per-name minimum gap. Steals the oldest voice when full.
//  - spatial(): distance attenuation + stereo pan from the listener's position and yaw.

export const LIMITS = Object.freeze({ MAX_VOICES: 32, MAX_PER_NAME: 4, MAX_STARTS_PER_SEC: 12 });

export class VoiceTable {
  constructor(limits = LIMITS) {
    this.limits = limits;
    /** live voices, oldest first: {id, name, start, end, ...extra} */
    this.voices = [];
    /** name -> recent start times (seconds) within the last 1 s */
    this.starts = new Map();
    /** name -> last start time */
    this.last = new Map();
    this.nextId = 1;
    this.total = 0;
    this.dropped = 0;
    this.stolen = 0;
  }

  /** Remove voices that ended at or before `now`. Returns the removed voices (caller disconnects nodes). */
  prune(now) {
    let removed = null;
    let w = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.end <= now) { (removed || (removed = [])).push(v); } else this.voices[w++] = v;
    }
    this.voices.length = w;
    return removed || EMPTY;
  }

  countName(name) {
    let n = 0;
    for (const v of this.voices) if (v.name === name) n++;
    return n;
  }

  /**
   * Decide whether a new voice for `name` may start at time `now`.
   * Returns {ok: false, reason} or {ok: true, steal: voice|null} (the caller must stop `steal`).
   * opts.gap: minimum seconds since the previous start of this name.
   */
  admit(name, now, opts = {}) {
    this.prune(now);
    const gap = opts.gap || 0;
    const last = this.last.get(name);
    if (gap > 0 && last !== undefined && now - last < gap) { this.dropped++; return { ok: false, reason: 'gap' }; }
    let st = this.starts.get(name);
    if (st) {
      let k = 0;
      while (k < st.length && now - st[k] >= 1) k++;
      if (k) st.splice(0, k);
      if (st.length >= this.limits.MAX_STARTS_PER_SEC) { this.dropped++; return { ok: false, reason: 'rate' }; }
    }
    if (this.countName(name) >= this.limits.MAX_PER_NAME) { this.dropped++; return { ok: false, reason: 'name' }; }
    let steal = null;
    if (this.voices.length >= this.limits.MAX_VOICES) {
      // steal the oldest voice with the lowest priority
      let best = -1;
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (best < 0 || (v.prio || 0) < (this.voices[best].prio || 0)) best = i;
      }
      if ((this.voices[best].prio || 0) > (opts.prio || 0)) { this.dropped++; return { ok: false, reason: 'full' }; }
      steal = this.voices.splice(best, 1)[0];
      this.stolen++;
    }
    return { ok: true, steal };
  }

  /** Record a started voice. `extra` is merged into the record (nodes etc). Returns the record. */
  add(name, now, end, extra = {}) {
    const rec = { id: this.nextId++, name, start: now, end, ...extra };
    this.voices.push(rec);
    let st = this.starts.get(name);
    if (!st) { st = []; this.starts.set(name, st); }
    st.push(now);
    this.last.set(name, now);
    this.total++;
    return rec;
  }

  /** Remove a specific voice (stopped early). */
  remove(rec) {
    const i = this.voices.indexOf(rec);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** {voices, byName} - live voice counts. */
  stats(now) {
    if (now !== undefined) this.prune(now);
    const byName = {};
    for (const v of this.voices) byName[v.name] = (byName[v.name] || 0) + 1;
    return { voices: this.voices.length, byName };
  }

  clear() { const all = this.voices; this.voices = []; this.starts.clear(); this.last.clear(); return all; }
}

const EMPTY = Object.freeze([]);

/**
 * Positional gain/pan. Listener at (lx, ly, lz) looking along yaw (yaw 0 = north/-Z, +yaw turns left,
 * SPEC §3.7). Returns {gain 0..1, pan -1..1, dist}. gain is 0 at or beyond `range`.
 * Curve: full volume within `ref` blocks, then ~ref/d, faded smoothly to 0 over the last quarter of range.
 */
export function spatial(lx, ly, lz, yaw, sx, sy, sz, range = 16, ref = 3, out = { gain: 0, pan: 0, dist: 0 }) {
  const dx = sx - lx, dy = sy - ly, dz = sz - lz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out.dist = d;
  if (!(range > 0) || d >= range || !Number.isFinite(d)) { out.gain = 0; out.pan = 0; return out; }
  let g = d <= ref ? 1 : ref / d;
  const fadeStart = range * 0.75;
  if (d > fadeStart) g *= 1 - (d - fadeStart) / (range - fadeStart);
  // camera right = (cos yaw, 0, -sin yaw); forward = (-sin yaw, 0, -cos yaw)
  const h = Math.sqrt(dx * dx + dz * dz);
  let pan = 0, fwd = 1;
  if (h > 1e-4) {
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    pan = (dx * rx + dz * rz) / h;
    fwd = (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / h;
    pan *= Math.min(1, h / 1.5) * 0.85; // close sources are centred; never hard-panned
  }
  if (fwd < 0) g *= 1 + 0.15 * fwd; // slightly quieter behind (max -1.4 dB)
  out.gain = Math.max(0, Math.min(1, g));
  out.pan = Math.max(-1, Math.min(1, pan));
  return out;
}

/** Combine settings into bus gains. {master, music, sfx} linear. */
export function busGains(settings) {
  const s = settings || {};
  const n = (x, d) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
  return {
    master: s.muted ? 0 : n(s.masterVolume, 0.65),
    music: n(s.musicVolume, 0.35),
    sfx: n(s.sfxVolume, 1),
  };
}
