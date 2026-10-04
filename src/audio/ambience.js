// OWNER LANE: FEATURE-AUDIO. World ambience (judge finding POL-5): the world should never be silent where the
// screen shows something alive.
//   - Rain bed: a looping soft filtered-noise "shhh" while it rains (fx.weather.rain, eased by FX; 'fx:weather'
//     as a fallback), scaled by the rain strength. Under a roof it drops and goes muffled (low-pass); deep
//     inside a cave (no sky light) it is gone. Snow is silent, like real snow.
//   - Lit furnaces crackle, surface water laps now and then, lava pops: found by scanning the cells around the
//     player once a second (17 x 9 x 17 getRaw reads, ~0.05 ms) and played as ordinary positional catalogue
//     sounds ('furnace.crackle', 'water.ambient', 'lava.pop').
//   - Caves: when the eye has no sky light and solid ground is well overhead, a very quiet low "cave air" drone
//     fades in, with an occasional soft water drip ('cave.drip') somewhere nearby. Calm, never scary.
// Beds are two looping noise sources at most, routed into the SFX bus (so mute, the effects volume and the
// under-water muffle all apply). Everything fades out off the 'playing' state and stops on world exit.

import { ID } from '../core/registry.js';
import { noiseBuffers } from './dsp.js';

export const AMBIENCE = Object.freeze({
  SCAN_EVERY: 20,       // ticks between cell scans
  R: 8, DY: 4,          // scan box half sizes (blocks)
  RAIN_LEVEL: 0.045,    // bed gain at full rain in the open (~ -33 dBFS RMS at default volumes, measured live)
  RAIN_ROOF: 0.42,      // under a roof (scaled further by the sky light reaching the eye)
  RAIN_OPEN_HZ: 3600, RAIN_ROOF_HZ: 650,
  CAVE_LEVEL: 0.014,    // cave air drone (~ -44 dBFS RMS at default volumes, measured live: very quiet)
  CAVE_DEPTH: 4,        // solid ground at least this many blocks above the eye
  FURNACE_P: 0.035,     // crackle chance per tick per nearby lit furnace (nearest 3)
  LAVA_P: 0.02,         // pop chance per tick when open lava is near
  WATER_GAP: [80, 180], // ticks between water lapping sounds
  DRIP_GAP: [60, 170],  // ticks between cave drips
});

const MAX_LIST = 24;

/**
 * Scan the box around (px, py, pz) for ambient sound sources. Pure (only calls getRaw).
 * @returns {{furnaces: number[][], water: number[][], lava: number[][]}}  furnaces nearest first (max 3);
 *          water / lava = cells with air above (max 24 each, a spread of the box)
 */
export function scanAmbient(getRaw, px, py, pz, R = AMBIENCE.R, DY = AMBIENCE.DY) {
  const furn = [], water = [], lava = [];
  const LIT = ID.furnace_lit, WATER = ID.water, LAVA = ID.lava;
  const n = [0, 0];
  // keep a spread of up to MAX_LIST cells (deterministic reservoir: cell k replaces slot hash % k when it lands in range)
  const keep = (list, i, x, y, z) => {
    const k = ++n[i];
    if (list.length < MAX_LIST) { list.push([x, y, z]); return; }
    const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
    const j = h % k;
    if (j < MAX_LIST) list[j] = [x, y, z];
  };
  for (let y = py - DY; y <= py + DY; y++) {
    for (let z = pz - R; z <= pz + R; z++) {
      for (let x = px - R; x <= px + R; x++) {
        const id = getRaw(x, y, z) & 0xff;
        if (!id) continue;
        if (id === LIT) furn.push([x, y, z, (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2]);
        else if (id === WATER || id === LAVA) {
          if (getRaw(x, y + 1, z) & 0xff) continue; // only open surfaces make a sound
          if (id === WATER) keep(water, 0, x, y, z); else keep(lava, 1, x, y, z);
        }
      }
    }
  }
  furn.sort((a, b) => a[3] - b[3]);
  return { furnaces: furn.slice(0, 3).map((f) => f.slice(0, 3)), water, lava };
}

/**
 * Where the ear is: {rainGain, rainHz, cave (0/1 target), covered, sky}. Pure.
 * rain: 0..1 strength; sky: sky light at the eye 0..15; depth: blocks of ground/roof above the eye (<= 0 = open sky).
 */
export function ambienceTargets(rain, snow, sky, depth, eyeInWater, playing) {
  const covered = depth > 0;
  const r = playing && !snow ? Math.max(0, Math.min(1, rain || 0)) : 0;
  const skyF = Math.max(0, Math.min(15, sky)) / 15;
  const rainGain = r * AMBIENCE.RAIN_LEVEL * (covered ? AMBIENCE.RAIN_ROOF * skyF : 1);
  const cave = playing && !eyeInWater && sky <= 0 && depth >= AMBIENCE.CAVE_DEPTH ? 1 : 0;
  return { rainGain, rainHz: covered ? AMBIENCE.RAIN_ROOF_HZ : AMBIENCE.RAIN_OPEN_HZ, cave, covered };
}

/**
 * @param {object} game
 * @param {{ctx(): BaseAudioContext|null, dest(): AudioNode|null, play(name, opts), rand(): number, log(name, gain)}} env
 */
export function createAmbience(game, env) {
  const st = { tick: 0, scan: null, waterIn: 60, dripIn: 80, rainTarget: 0, lastFrame: -1, caveF: 0,
    rain: 0, cave: 0, covered: false, sky: 15, depth: 0 };
  const eye = { x: 0, y: 0, z: 0 };
  let rainBed = null, caveBed = null;
  const off = game.events && game.events.on ? game.events.on('fx:weather', (e) => { if (e && Number.isFinite(e.rain)) st.rainTarget = e.rain; }) : null;
  const R = () => env.rand();
  const between = (a) => a[0] + Math.floor(R() * (a[1] - a[0]));

  function makeBed(color, type, hz, q) {
    const ctx = env.ctx(), dest = env.dest();
    if (!ctx || !dest) return null;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffers(ctx)[color];
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = hz;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(flt); flt.connect(g); g.connect(dest);
    src.start(ctx.currentTime, R() * 1.5);
    return { src, flt, g, quietSince: -1, extra: null };
  }
  function dropBed(b, fade = 0.05) {
    if (!b) return;
    const ctx = env.ctx();
    const t = ctx ? ctx.currentTime : 0;
    try { b.g.gain.cancelScheduledValues(t); b.g.gain.setValueAtTime(b.g.gain.value, t); b.g.gain.linearRampToValueAtTime(0, t + fade); } catch { /* ignore */ }
    for (const s of [b.src, b.extra]) if (s) { try { s.stop(t + fade + 0.02); } catch { /* ignore */ } }
    setTimeout(() => { try { b.g.disconnect(); } catch { /* ignore */ } }, (fade + 0.2) * 1000);
  }
  /** Ease a bed to `level`; drop it after 4 s of silence. Returns the (possibly new / dropped) bed. */
  function drive(b, level, now, make, tc = 0.6) {
    if (level > 0.0005) {
      if (!b) b = make();
      if (!b) return null;
      b.quietSince = -1;
    } else if (b) {
      if (b.quietSince < 0) b.quietSince = now;
      else if (now - b.quietSince > 4) { dropBed(b); return null; }
    }
    if (b) b.g.gain.setTargetAtTime(level, now, tc);
    return b;
  }

  function where() {
    const p = game.player, w = game.world;
    if (!p) return false;
    if (p.getEyePos) p.getEyePos(eye, true); else { eye.x = p.x; eye.y = p.y + 1.6; eye.z = p.z; }
    const ex = Math.floor(eye.x), ey = Math.floor(eye.y), ez = Math.floor(eye.z);
    st.sky = w && w.getSkyLight ? w.getSkyLight(ex, ey, ez) : 15;
    const h = w && w.getHeight ? w.getHeight(ex, ez) : 0;
    st.depth = Number.isFinite(h) && h < 128 ? h - ey : (st.sky >= 15 ? 0 : 1);
    return true;
  }

  return {
    state: st,
    /** Every frame (any state): drive the beds (throttled to ~10 Hz). */
    frame() {
      const ctx = env.ctx();
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (now - st.lastFrame < 0.1) return;
      st.lastFrame = now;
      const playing = game.state === 'playing' && !!game.meta;
      const fxw = game.fx && game.fx.weather;
      const rain = fxw && Number.isFinite(fxw.rain) ? fxw.rain : st.rainTarget;
      const snow = !!(fxw && fxw.snow);
      if (playing) where();
      const p = game.player;
      const tg = ambienceTargets(rain, snow, st.sky, st.depth, !!(p && p.eyeInWater), playing);
      st.rain = Math.round(tg.rainGain * 1000) / 1000;
      st.covered = tg.covered;
      st.cave = tg.cave;
      const wasRain = !!rainBed;
      rainBed = drive(rainBed, tg.rainGain, now, () => makeBed('pink', 'lowpass', tg.rainHz, 0.5), 0.8);
      if (rainBed) {
        rainBed.flt.frequency.setTargetAtTime(tg.rainHz, now, 0.25);
        if (!wasRain) env.log('ambient.rain', tg.rainGain);
      }
      const wasCave = !!caveBed;
      caveBed = drive(caveBed, tg.cave * AMBIENCE.CAVE_LEVEL, now, () => {
        const b = makeBed('brown', 'lowpass', 240, 0.7);
        if (!b) return null;
        // a very slow wander of the filter: the cave "breathes" instead of humming
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07;
        const lg = ctx.createGain();
        lg.gain.value = 60;
        lfo.connect(lg); lg.connect(b.flt.frequency);
        lfo.start(now);
        b.extra = lfo;
        return b;
      }, 2.0);
      if (caveBed && !wasCave) env.log('ambient.cave', AMBIENCE.CAVE_LEVEL);
    },

    /** 20 TPS while playing: scan for sources, play crackles / laps / pops / drips. */
    tick() {
      const w = game.world, p = game.player;
      if (!w || !w.getRaw || !p) return;
      st.tick++;
      if (!st.scan || st.tick % AMBIENCE.SCAN_EVERY === 0) st.scan = scanAmbient(w.getRaw.bind(w), Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      const s = st.scan;
      for (const f of s.furnaces) {
        if ((w.getRaw(f[0], f[1], f[2]) & 0xff) !== ID.furnace_lit) continue; // went out since the scan
        if (R() < AMBIENCE.FURNACE_P) env.play('furnace.crackle', { x: f[0] + 0.5, y: f[1] + 0.5, z: f[2] + 0.5 });
      }
      if (s.water.length && --st.waterIn <= 0) {
        const c = s.water[Math.floor(R() * s.water.length)];
        env.play('water.ambient', { x: c[0] + 0.5, y: c[1] + 0.9, z: c[2] + 0.5, volume: 0.8 + R() * 0.4 });
        st.waterIn = between(AMBIENCE.WATER_GAP);
      }
      if (s.lava.length && R() < AMBIENCE.LAVA_P) {
        const c = s.lava[Math.floor(R() * s.lava.length)];
        env.play('lava.pop', { x: c[0] + 0.5, y: c[1] + 1, z: c[2] + 0.5 });
      }
      if (st.cave && --st.dripIn <= 0) {
        const a = R() * Math.PI * 2, d = 2 + R() * 6;
        env.play('cave.drip', { x: p.x + Math.cos(a) * d, y: p.y + 2 + R() * 3, z: p.z + Math.sin(a) * d });
        st.dripIn = between(AMBIENCE.DRIP_GAP);
      }
    },

    stats() {
      return { rain: st.rain, covered: st.covered, cave: st.cave, sky: st.sky, depth: st.depth, rainBed: !!rainBed, caveBed: !!caveBed,
        furnaces: st.scan ? st.scan.furnaces.length : 0, water: st.scan ? st.scan.water.length : 0, lava: st.scan ? st.scan.lava.length : 0 };
    },

    /** World exit / new world: stop the beds now and forget the scan. */
    reset() {
      dropBed(rainBed, 0.4); dropBed(caveBed, 0.4);
      rainBed = null; caveBed = null;
      st.scan = null; st.rainTarget = 0; st.tick = 0; st.cave = 0; st.rain = 0;
    },

    dispose() { this.reset(); if (off) off(); },
  };
}
