// OWNER LANE: FEATURE-AUDIO. Unit tests for src/audio/* (SPEC §8.3). WebAudio does not exist in Node, so the
// recipes and the system run against a STRICT mock AudioContext that throws on the mistakes the real API
// punishes (exponential ramps to 0, non-finite values, negative times, start/stop misuse).
import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { ID } from '../src/core/registry.js';
import { mulberry32 } from '../src/core/math.js';
import { makeVoiceCtx, fillNoise, lcg } from '../src/audio/dsp.js';
import { SOUNDS, BLOCK_KINDS, BLOCK_SOUND_TYPES, MOB_VOICES, MOB_KINDS, ALIASES, blockSoundName, resolveSound } from '../src/audio/sounds.js';
import { VoiceTable, LIMITS, spatial, busGains } from '../src/audio/mixer.js';
import { fillImpulse } from '../src/audio/reverb.js';
import { composePiece, nextGap, MODES, NOTE_RANGE, SAMPLE_NOTES, sampleFor, degreeToMidi } from '../src/audio/music.js';
import { wireAudioEvents, soundOfBlock, voiceOf, isNightTime } from '../src/audio/wiring.js';
import { scanAmbient, ambienceTargets, AMBIENCE } from '../src/audio/ambience.js';
import { targetRms } from '../src/audio/levels.js';
import { createAudioSystem, softClipCurve } from '../src/audio/audio.js';
import { SOUND_TYPES } from '../src/data/blocks.js';
import { MOBS } from '../src/data/mobs.js';

/* ------------------------------------------------------------------ strict mock WebAudio */
function chk(v, t, what) {
  if (!Number.isFinite(v)) throw new TypeError(`${what}: non-finite value ${v}`);
  if (t !== undefined && (!Number.isFinite(t) || t < 0)) throw new TypeError(`${what}: bad time ${t}`);
}
class Param {
  constructor(v = 0) { this._v = v; this.n = 0; this.last = -Infinity; }
  get value() { return this._v; }
  set value(v) { chk(v, undefined, 'value='); this._v = v; }
  setValueAtTime(v, t) { chk(v, t, 'setValueAtTime'); this._v = v; this.n++; return this; }
  linearRampToValueAtTime(v, t) { chk(v, t, 'linearRamp'); this.n++; return this; }
  exponentialRampToValueAtTime(v, t) {
    chk(v, t, 'expRamp');
    if (v <= 0) throw new RangeError('exponentialRampToValueAtTime value must be > 0');
    this.n++; return this;
  }
  setTargetAtTime(v, t, tc) { chk(v, t, 'setTarget'); if (!(tc > 0)) throw new RangeError('timeConstant'); this.n++; return this; }
  cancelScheduledValues(t) { chk(0, t, 'cancel'); return this; }
}
class Node {
  constructor(ctx) { this.ctx = ctx; ctx.nodeCount++; this.outs = []; }
  connect(n) { if (!n) throw new TypeError('connect(undefined)'); this.outs.push(n); return n; }
  disconnect() { this.outs.length = 0; }
}
class Source extends Node {
  constructor(ctx) { super(ctx); this.started = null; this.stopped = null; this.onended = null; ctx.sources.push(this); }
  start(t = 0) { chk(0, t, 'start'); if (this.started !== null) throw new Error('start twice'); this.started = t; }
  stop(t = 0) {
    chk(0, t, 'stop');
    if (this.started === null) throw new Error('stop before start');
    this.stopped = t;
  }
}
class Osc extends Source {
  constructor(ctx) { super(ctx); this.type = 'sine'; this.frequency = new Param(440); this.detune = new Param(0); }
  set type(v) { if (!['sine', 'square', 'sawtooth', 'triangle'].includes(v)) throw new TypeError('osc type ' + v); this._t = v; }
  get type() { return this._t; }
}
class BufSrc extends Source {
  constructor(ctx) { super(ctx); this.buffer = null; this.loop = false; this.playbackRate = new Param(1); }
  start(t = 0, off = 0) { chk(off, t, 'bufstart'); if (!this.buffer) throw new Error('no buffer'); super.start(t); }
}
class Buf {
  constructor(ch, len, sr) {
    if (!(len > 0) || !(sr >= 3000)) throw new RangeError('createBuffer');
    this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.duration = len / sr;
    this._d = Array.from({ length: ch }, () => new Float32Array(len));
  }
  getChannelData(c) { return this._d[c]; }
}
class MockCtx {
  constructor(o = {}) {
    this.sampleRate = o.sampleRate || 48000; this.currentTime = 0; this.state = 'suspended';
    this.nodeCount = 0; this.sources = []; this.destination = new Node(this); this.onstatechange = null;
  }
  createGain() { const n = new Node(this); n.gain = new Param(1); return n; }
  createOscillator() { return new Osc(this); }
  createBufferSource() { return new BufSrc(this); }
  createBiquadFilter() {
    const n = new Node(this); n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0);
    let ty = 'lowpass';
    Object.defineProperty(n, 'type', { get: () => ty, set: (v) => { if (!['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'].includes(v)) throw new TypeError('biquad ' + v); ty = v; } });
    return n;
  }
  createStereoPanner() { const n = new Node(this); n.pan = new Param(0); return n; }
  createDynamicsCompressor() { const n = new Node(this); for (const k of ['threshold', 'ratio', 'knee', 'attack', 'release']) n[k] = new Param(0); return n; }
  createConvolver() { const n = new Node(this); n.buffer = null; return n; }
  createWaveShaper() { const n = new Node(this); n.curve = null; n.oversample = 'none'; return n; }
  createAnalyser() { const n = new Node(this); n.fftSize = 2048; n.getFloatTimeDomainData = (a) => a.fill(0); return n; }
  createBuffer(ch, len, sr) { return new Buf(ch, len, sr); }
  resume() { this.state = 'running'; if (this.onstatechange) this.onstatechange(); return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
class MockOffline extends MockCtx {
  constructor(ch, len, sr) { super({ sampleRate: sr }); this.len = len; this.ch = ch; }
  startRendering() { return Promise.resolve(new Buf(this.ch, this.len, this.sampleRate)); }
}

/** Run one recipe on a fresh mock context and validate the voice. */
function runRecipe(name, opts = {}, seed = 1) {
  const ctx = new MockCtx();
  const out = ctx.createGain();
  const v = makeVoiceCtx(ctx, out, 0.5, { pitch: opts.pitch || 1, rand: mulberry32(seed), params: opts });
  SOUNDS[name].r(v);
  return { ctx, v };
}

/* ------------------------------------------------------------------ catalogue */
test('audio: catalogue covers every SPEC §8.3.2 name', () => {
  const required = ['ui.click', 'ui.open', 'ui.close', 'ui.tick', 'ui.success', 'ui.whoosh', 'ui.error',
    'player.hurt', 'player.land', 'player.bigfall', 'player.splash', 'player.swim', 'player.eat', 'player.burp', 'player.levelup', 'item.pop', 'item.break',
    'wolf.bark', 'wolf.whine', 'cat.purr', 'creeper.hiss',
    'tnt.fuse', 'explosion', 'door.open', 'door.close', 'chest.open', 'chest.close', 'furnace.crackle', 'bucket.fill', 'bucket.empty',
    'fire.ignite', 'lava.pop', 'shear', 'bonemeal', 'egg.lay', 'water.ambient'];
  for (const n of required) assert.ok(SOUNDS[n], `missing ${n}`);
  for (const voice of ['pig', 'cow', 'sheep', 'chicken', 'wolf', 'cat', 'horse', 'zombie', 'skeleton', 'creeper', 'spider']) {
    for (const k of MOB_KINDS) assert.ok(SOUNDS[`${voice}.${k}`], `missing ${voice}.${k}`);
  }
  for (const k of BLOCK_KINDS) for (const t of BLOCK_SOUND_TYPES) assert.ok(SOUNDS[`block.${k}.${t}`], `missing block.${k}.${t}`);
  // every block sound type in the data (except 'none') has sounds; every mob voice in the data is covered
  for (const t of SOUND_TYPES) if (t !== 'none') assert.ok(BLOCK_SOUND_TYPES.includes(t), `sound type ${t}`);
  for (const [type, m] of Object.entries(MOBS)) assert.ok(MOB_VOICES.includes(m.voice), `voice for ${type}`);
  for (const [a, target] of Object.entries(ALIASES)) assert.ok(SOUNDS[target], `alias ${a} -> ${target}`);
});

test('audio: every recipe builds valid WebAudio graphs (strict mock), several pitches and seeds', () => {
  for (const name of Object.keys(SOUNDS)) {
    for (const [pitch, seed] of [[1, 1], [0.95, 7], [1.05, 99], [0.6, 3], [1.6, 4]]) {
      const { ctx, v } = runRecipe(name, { pitch, kid: seed % 2 === 0, dur: 2 }, seed);
      assert.ok(v.sources.length >= 1, `${name} has sources`);
      assert.ok(v.end > v.t0 && v.end - v.t0 < 8, `${name} duration ${v.end - v.t0}`);
      for (const s of ctx.sources) {
        assert.notEqual(s.started, null, `${name}: every source started`);
        assert.notEqual(s.stopped, null, `${name}: every source stopped`);
        assert.ok(s.stopped >= s.started, `${name}: stop after start`);
        assert.ok(s.stopped <= v.end + 1e-9, `${name}: voice end covers every source`);
      }
      assert.ok(ctx.nodeCount < 220, `${name}: node budget (${ctx.nodeCount})`);
    }
  }
});

test('audio: entries have sane levels, ranges and pitch jitter', () => {
  for (const [name, d] of Object.entries(SOUNDS)) {
    assert.ok(d.vol > 0 && d.vol <= 1, `${name} vol`);
    assert.ok(d.range >= 0 && d.range <= 64, `${name} range`);
    assert.ok((d.pj ?? 0.05) >= 0 && (d.pj ?? 0.05) <= 0.4, `${name} pj`);
    if (name.startsWith('ui.')) assert.equal(d.range, 0, `${name} is not positional`);
  }
  assert.equal(SOUNDS.explosion.range >= 32, true, 'explosions carry further');
});

test('audio: name resolution and block sound mapping', () => {
  assert.equal(resolveSound('item.pop'), 'item.pop');
  assert.equal(resolveSound('pop'), 'item.pop');
  assert.equal(resolveSound('nope'), null);
  assert.equal(resolveSound(42), null);
  assert.equal(blockSoundName('break', 'glass'), 'block.break.glass');
  assert.equal(blockSoundName('step', 'none'), null);
  assert.equal(blockSoundName('step', 'weird'), 'block.step.stone');
  assert.equal(blockSoundName('weird', 'wood'), 'block.place.wood');
  assert.equal(soundOfBlock(ID.stone), 'stone');
  assert.equal(soundOfBlock(ID.glass), 'glass');
  assert.equal(soundOfBlock(ID.oak_planks), 'wood');
  assert.equal(soundOfBlock(ID.air), 'none');
  assert.equal(voiceOf('pig'), 'pig');
  assert.equal(voiceOf('unknown_thing'), 'unknown_thing');
});

/* ------------------------------------------------------------------ mixer */
test('audio: voice table enforces 32 voices, 4 per name, 12 starts/s and gaps', () => {
  const t = new VoiceTable();
  let ok = 0;
  for (let i = 0; i < 50; i++) { const a = t.admit('x', 0); if (a.ok) { t.add('x', 0, 1); ok++; } }
  assert.equal(ok, LIMITS.MAX_PER_NAME, '4 of one name');
  assert.equal(t.stats(0).byName.x, 4);
  // rate: 12 starts/s even when voices are short
  const r = new VoiceTable();
  let started = 0;
  for (let i = 0; i < 40; i++) { const now = i * 0.02; const a = r.admit('y', now); if (a.ok) { r.add('y', now, now + 0.01); started++; } }
  assert.equal(started, 12, '12 starts in the first 0.8 s');
  // gap
  const g = new VoiceTable();
  assert.ok(g.admit('z', 0, { gap: 0.3 }).ok); g.add('z', 0, 0.1);
  assert.equal(g.admit('z', 0.2, { gap: 0.3 }).ok, false);
  assert.ok(g.admit('z', 0.31, { gap: 0.3 }).ok);
  // total cap with stealing the oldest
  const s = new VoiceTable();
  for (let i = 0; i < 32; i++) { s.admit('n' + i, i * 0.001); s.add('n' + i, i * 0.001, 10); }
  const a = s.admit('new', 0.1);
  assert.ok(a.ok && a.steal && a.steal.name === 'n0', 'steals the oldest');
  s.add('new', 0.1, 10);
  assert.equal(s.stats(0.1).voices, 32);
  // prune
  assert.equal(s.prune(11).length, 32);
  assert.equal(s.stats().voices, 0);
});

test('audio: spatial gain and pan follow SPEC §3.7 axes', () => {
  const near = spatial(0, 0, 0, 0, 1, 0, 0, 16);
  assert.equal(near.gain, 1);
  const east = spatial(0, 0, 0, 0, 6, 0, 0, 16); // yaw 0 looks north (-Z): +X is to the right
  assert.ok(east.pan > 0.5, `east is right (${east.pan})`);
  const west = spatial(0, 0, 0, 0, -6, 0, 0, 16);
  assert.ok(west.pan < -0.5, 'west is left');
  const turned = spatial(0, 0, 0, Math.PI / 2, -6, 0, 0, 16); // +yaw turns left: now facing west
  assert.ok(Math.abs(turned.pan) < 0.05, 'facing the source -> centred');
  const far = spatial(0, 0, 0, 0, 0, 0, -15, 16);
  assert.ok(far.gain > 0 && far.gain < 0.1, `fades near the range (${far.gain})`);
  assert.equal(spatial(0, 0, 0, 0, 0, 0, -17, 16).gain, 0);
  const front = spatial(0, 0, 0, 0, 0, 0, -6, 16).gain, back = spatial(0, 0, 0, 0, 0, 0, 6, 16).gain;
  assert.ok(back < front && back > front * 0.8, 'slightly quieter behind');
  assert.equal(spatial(0, 0, 0, 0, NaN, 0, 0, 16).gain, 0);
});

test('audio: bus gains from settings', () => {
  assert.deepEqual(busGains({ masterVolume: 0.65, musicVolume: 0.35, sfxVolume: 1, muted: false }), { master: 0.65, music: 0.35, sfx: 1 });
  assert.equal(busGains({ masterVolume: 0.65, muted: true }).master, 0);
  assert.equal(busGains({ masterVolume: 7 }).master, 1);
  assert.equal(busGains({}).music, 0.35);
});

test('audio: soft-clip ceiling never exceeds -1 dBFS and is transparent below the knee', () => {
  const c = softClipCurve(0.5, 0.891);
  let max = 0;
  for (const y of c) max = Math.max(max, Math.abs(y));
  assert.ok(max <= 0.891 + 1e-6);
  const mid = (c.length - 1) / 2;
  const at = (x) => c[Math.round(mid + x * mid)];
  assert.ok(Math.abs(at(0.25) - 0.25) < 0.002);
  assert.ok(Math.abs(at(-0.4) + 0.4) < 0.002);
});

/* ------------------------------------------------------------------ dsp / reverb */
test('audio: noise tables are normalised and finite', () => {
  const n = 8000, w = new Float32Array(n), p = new Float32Array(n), b = new Float32Array(n);
  fillNoise(w, p, b, lcg(5));
  for (const a of [w, p, b]) {
    let m = 0; for (const x of a) { assert.ok(Number.isFinite(x)); m = Math.max(m, Math.abs(x)); }
    assert.ok(m > 0.5 && m <= 1.0001);
  }
});

test('audio: reverb impulse decays, is stereo and starts after the pre-delay', () => {
  const sr = 8000, n = Math.floor(3.5 * sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  fillImpulse(L, R, sr, { rt60: 3, predelay: 0.02 });
  const energy = (a, s, e) => { let x = 0; for (let i = s; i < e; i++) x += a[i] * a[i]; return x; };
  const early = energy(L, 0, sr / 2), late = energy(L, n - sr / 2, n);
  assert.ok(early > late * 300, `tail decays (${early} vs ${late})`);
  assert.equal(L[10], 0, 'pre-delay is silent');
  let corr = 0, nl = 0, nr = 0;
  for (let i = 0; i < n; i++) { corr += L[i] * R[i]; nl += L[i] * L[i]; nr += R[i] * R[i]; }
  assert.ok(Math.abs(corr / Math.sqrt(nl * nr)) < 0.5, 'channels decorrelated');
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  assert.ok(Math.abs(peak - 1) < 1e-6, 'normalised');
  assert.equal(L[n - 1], 0, 'faded to zero');
});

/* ------------------------------------------------------------------ music */
test('audio: composer is deterministic, in range, in key, slow and sparse', () => {
  const a = composePiece(mulberry32(42)), b = composePiece(mulberry32(42));
  assert.deepEqual(a, b, 'same seed, same piece');
  for (let seed = 1; seed <= 60; seed++) {
    const night = seed % 3 === 0;
    const p = composePiece(mulberry32(seed), { night });
    assert.ok(p.bpm >= 58 && p.bpm <= 72, `bpm ${p.bpm}`);
    assert.ok(p.seconds >= 40 && p.seconds <= 240, `length ${p.seconds}`);
    if (night) assert.ok(['dorian', 'lydian'].includes(p.mode), `night mode ${p.mode}`);
    else assert.ok(['ionian', 'lydian'].includes(p.mode), `day mode ${p.mode}`);
    const scale = MODES[p.mode].map((x) => (p.tonic + x) % 12);
    const mel = [];
    for (const e of p.events) {
      assert.ok(e.midi >= NOTE_RANGE.lo && e.midi <= NOTE_RANGE.hi, `note ${e.midi} in range`);
      assert.ok(scale.includes(e.midi % 12), `note ${e.midi} in ${p.mode}`);
      assert.ok(e.vel > 0 && e.vel <= 0.7, 'soft velocities');
      if (e.part === 'mel') mel.push(e);
    }
    assert.ok(mel.length >= 3, 'has a melody');
    // sparse: at least one long rest (>= 4 beats) between melody notes, and on average < 1 note per beat
    let longRest = false;
    for (let i = 1; i < mel.length; i++) if (mel[i].beat - mel[i - 1].beat >= 4) longRest = true;
    assert.ok(longRest, 'melody has long rests');
    assert.ok(p.events.length / p.beats < 1.2, `density ${(p.events.length / p.beats).toFixed(2)} notes/beat`);
    // seventh chords: the left hand plays the chord 7th at least once
    const lh = p.events.filter((e) => e.part === 'lh').map((e) => e.midi % 12);
    const seventh = (p.tonic + MODES[p.mode][6]) % 12;
    const fourth = (p.tonic + MODES[p.mode][2]) % 12; // 7th of the IV/ii-family chords appears too; accept either
    assert.ok(lh.includes(seventh) || lh.includes(fourth), 'seventh colours present');
  }
  const motifs = new Set();
  for (let s = 1; s <= 10; s++) motifs.add(JSON.stringify(composePiece(mulberry32(s)).events.filter((e) => e.part === 'mel').slice(0, 4).map((e) => e.midi)));
  assert.ok(motifs.size >= 8, 'pieces differ');
  assert.equal(degreeToMidi(48, 'ionian', 7), 60);
  assert.equal(degreeToMidi(48, 'dorian', 2), 51);
});

test('audio: music gaps match SPEC (first 20-40 s, then 40-150 s)', () => {
  const r = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const f = nextGap(r, true), g = nextGap(r, false);
    assert.ok(f >= 20 && f <= 40);
    assert.ok(g >= 40 && g <= 150);
  }
});

test('audio: piano samples cover the note range within ±2 semitones', () => {
  for (let m = NOTE_RANGE.lo; m <= NOTE_RANGE.hi; m++) {
    const { index, rate } = sampleFor(m);
    assert.ok(index >= 0 && index < SAMPLE_NOTES.length);
    assert.ok(rate >= Math.pow(2, -2 / 12) - 1e-9 && rate <= Math.pow(2, 2 / 12) + 1e-9, `midi ${m} rate ${rate}`);
  }
  assert.ok(isNightTime(13000) && isNightTime(18000) && !isNightTime(3000) && !isNightTime(23500));
});

/* ------------------------------------------------------------------ event wiring */
function fakeAudio() {
  const calls = [];
  let t = 0;
  const a = {
    calls,
    play: (name, opts = {}) => { calls.push(['play', name, opts]); return { name }; },
    playBlock: (kind, type, x, y, z, opts) => { calls.push(['block', `${kind}.${type}`, { x, y, z, ...(opts || {}) }]); return {}; },
    stopVoice: (v) => calls.push(['stop', v && v.name]),
    music: {
      start: (d) => calls.push(['music.start', d]), stop: () => calls.push(['music.stop']),
      setNight: (n) => calls.push(['night', n]), duck: (l, s) => calls.push(['duck', l, s]),
    },
    setMuffle: (on) => calls.push(['muffle', on]),
    applySettings: () => calls.push(['apply']),
    now: () => t,
    advance: (s) => { t += s; },
    rand: () => 0.9,
  };
  return a;
}
function fakeGame() {
  const events = new EventBus();
  events.onError = (err) => { throw err; };
  return {
    events, state: 'playing', meta: { mode: 'creative', difficulty: 'peaceful' },
    player: { x: 0, y: 4, z: 0, vy: -0.5, yaw: 0 },
    world: { getBlock: () => ID.stone },
    time: { dayTime: 3000 },
  };
}
const names = (a, kind) => a.calls.filter((c) => !kind || c[0] === kind).map((c) => c[1]);

test('audio: event mapping (SPEC §8.3 table)', () => {
  const game = fakeGame(), a = fakeAudio();
  const w = wireAudioEvents(game, a);
  const E = (n, p) => game.events.emit(n, p);
  E('block:broken', { x: 1, y: 2, z: 3, id: ID.stone, by: 'player', drops: [] });
  E('block:broken', { x: 1, y: 2, z: 3, id: ID.stone, by: 'explosion', drops: [] });
  E('block:placed', { x: 1, y: 2, z: 3, id: ID.oak_planks, by: 'player' });
  E('player:step', { x: 0, y: 4, z: 0, blockId: ID.grass_block, sound: 'grass' });
  E('player:land', { fallDistance: 6, x: 0, y: 4, z: 0, blockId: ID.sand });
  E('item:pickup', { item: 'dirt', count: 1 });
  E('ui:click', {});
  E('ui:open', { screen: 'pause', opts: {} });
  E('ui:open', { screen: 'chest', opts: { x: 1, y: 2, z: 3 } });
  E('craft', { item: 'stick', count: 4 });
  E('kid:home', { x: 0, y: 0, z: 0 });
  E('door:toggle', { x: 0, y: 4, z: 0, open: true, kind: 'door' });
  E('player:hurt', { amount: 1, cause: 'fall', health: 19 });
  E('sound', { name: 'bucket.fill', x: 1, y: 2, z: 3 });
  assert.deepEqual(names(a).filter((n) => n), [
    'break.stone', 'place.wood', 'step.grass', 'player.bigfall', 'land.sand', 'item.pop', 'ui.click', 'ui.open', 'chest.open',
    'ui.success', 'ui.whoosh', 'door.open', 'player.hurt', 'bucket.fill']);
  const br = a.calls[0][2];
  assert.deepEqual([br.x, br.y, br.z], [1.5, 2.5, 3.5], 'block sounds at the cell centre');
  w.dispose();
});

test('audio: explosion is kid-softened, ducks music; TNT fuse stops when the TNT goes away', () => {
  const game = fakeGame(), a = fakeAudio();
  wireAudioEvents(game, a);
  game.events.emit('tnt:primed', { id: 7, x: 0, y: 4, z: 0, fuse: 80 });
  const fuse = a.calls.find((c) => c[1] === 'tnt.fuse');
  assert.equal(fuse[2].dur, 4, 'fuse sound lasts the fuse');
  game.events.emit('entity:remove', { id: 7, type: 'tnt', reason: 'dead' });
  assert.ok(a.calls.some((c) => c[0] === 'stop' && c[1] === 'tnt.fuse'));
  game.events.emit('explosion', { x: 0, y: 4, z: 0, power: 4, blocks: [], count: 0 });
  const ex = a.calls.find((c) => c[1] === 'explosion');
  assert.equal(ex[2].kid, true);
  assert.ok(a.calls.some((c) => c[0] === 'duck' && c[1] === 0.3 && c[2] === 1), 'ducks music to 30% for 1 s');
  game.meta = { mode: 'survival', difficulty: 'normal' };
  game.events.emit('explosion', { x: 0, y: 4, z: 0, power: 4, blocks: [], count: 0 });
  assert.equal(a.calls.filter((c) => c[1] === 'explosion')[1][2].kid, false);
});

test('audio: mob voices, dedupe of hurt, entity spawn reasons', () => {
  const game = fakeGame(), a = fakeAudio();
  wireAudioEvents(game, a);
  const E = (n, p) => game.events.emit(n, p);
  E('mob:sound', { id: 1, type: 'pig', kind: 'idle', x: 1, y: 4, z: 1 });
  E('mob:sound', { id: 2, type: 'cow', kind: 'idle', x: 1, y: 4, z: 1 });
  E('mob:sound', { id: 3, type: 'wolf', kind: 'idle', x: 1, y: 4, z: 1 }); // rand 0.9 -> pant
  E('mob:hurt', { id: 1, type: 'pig', amount: 1, x: 1, y: 4, z: 1 });
  E('mob:sound', { id: 1, type: 'pig', kind: 'hurt', x: 1, y: 4, z: 1 }); // same hurt: deduped
  E('mob:sound', { id: 9, type: 'creeper', kind: 'hiss', x: 1, y: 4, z: 1 });
  E('mob:sound', { id: 4, type: 'sheep', kind: 'step', x: 1, y: 4, z: 1 }); // world says stone underneath
  E('mob:sound', { id: 5, type: 'zombie', kind: 'idle', x: 1, y: 4, z: 1 });
  E('mob:sound', { id: 6, type: 'skeleton', kind: 'idle', x: 1, y: 4, z: 1 });
  E('mob:sound', { id: 7, type: 'spider', kind: 'idle', x: 1, y: 4, z: 1 });
  E('mob:sound', { id: 8, type: 'chicken', kind: 'idle', x: 1, y: 4, z: 1 });
  E('entity:spawn', { id: 10, type: 'pig', x: 0, y: 4, z: 0, reason: 'load' });
  E('entity:spawn', { id: 11, type: 'pig', x: 0, y: 4, z: 0, reason: 'spawn' });
  E('entity:spawn', { id: 12, type: 'item', x: 0, y: 4, z: 0, reason: 'spawn' });
  E('entity:remove', { id: 11, type: 'pig', reason: 'unload' });
  E('entity:remove', { id: 11, type: 'pig', reason: 'dead' });
  E('mob:tamed', { id: 3, type: 'wolf', x: 0, y: 4, z: 0 });
  E('mob:sheared', { id: 4, type: 'sheep', x: 0, y: 4, z: 0 });
  assert.deepEqual(names(a), ['pig.idle', 'cow.idle', 'wolf.idle', 'pig.hurt', 'creeper.hiss', 'step.stone', 'zombie.idle',
    'skeleton.idle', 'spider.idle', 'chicken.idle', 'entity.pop', 'entity.poof', 'mob.love', 'shear']);
  a.advance(1);
  E('mob:sound', { id: 1, type: 'pig', kind: 'hurt', x: 1, y: 4, z: 1 });
  assert.equal(names(a).at(-1), 'pig.hurt', 'a later hurt plays again');
});

test('audio: mining hits every 4 ticks; eating munches and burps', () => {
  const game = fakeGame(), a = fakeAudio();
  const w = wireAudioEvents(game, a);
  game.events.emit('block:mining', { x: 0, y: 3, z: 0, id: ID.stone, progress: 0.1, stage: 1 });
  game.events.emit('block:mining', { x: 0, y: 3, z: 0, id: ID.stone, progress: 0.2, stage: 2 }); // same block: no extra
  for (let i = 0; i < 12; i++) w.tick();
  assert.equal(names(a, 'block').filter((n) => n === 'hit.stone').length, 1 + 3, 'one immediate + every 4 ticks');
  game.events.emit('block:miningStop', { x: 0, y: 3, z: 0 });
  for (let i = 0; i < 12; i++) w.tick();
  assert.equal(names(a, 'block').filter((n) => n === 'hit.stone').length, 4, 'stops with miningStop');
  a.calls.length = 0;
  game.events.emit('player:eat', { item: 'apple' });
  for (let i = 0; i < 32; i++) w.tick();
  game.events.emit('player:ate', { item: 'apple' });
  for (let i = 0; i < 10; i++) w.tick();
  const n = names(a);
  assert.ok(n.filter((x) => x === 'player.eat').length >= 6, `munches (${n.length})`);
  assert.equal(n.at(-1), 'player.burp');
  // an abandoned eat stops on its own
  a.calls.length = 0;
  game.events.emit('player:eat', { item: 'apple' });
  for (let i = 0; i < 100; i++) w.tick();
  assert.ok(names(a).filter((x) => x === 'player.eat').length <= 11);
});

test('audio: lifecycle events drive music, mood, muffle and settings', () => {
  const game = fakeGame(), a = fakeAudio();
  wireAudioEvents(game, a);
  const E = (n, p) => game.events.emit(n, p);
  E('world:ready', { meta: game.meta, isNew: true });
  E('time:night', { dayTime: 13000, day: 0 });
  E('time:set', { dayTime: 3000, day: 0 });
  E('player:water', { inWater: true, eyeInWater: true });
  E('player:water', { inWater: true, eyeInWater: false });
  E('settings:changed', { key: 'musicVolume', value: 0.2 });
  E('settings:changed', { key: 'fov', value: 80 });
  E('world:exit', { meta: game.meta });
  const c = a.calls.map((x) => x[0] + (x[0] === 'play' ? ':' + x[1] : x[1] !== undefined && typeof x[1] !== 'object' ? ':' + x[1] : ''));
  assert.deepEqual(c, ['night:false', 'music.start', 'night:true', 'night:false', 'play:player.splash', 'muffle:true', 'muffle:false', 'apply', 'music.stop']);
});

/* ------------------------------------------------------------------ whole system on the mock context */
async function liveSystem() {
  globalThis.window = { AudioContext: MockCtx, OfflineAudioContext: MockOffline, addEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false };
  const game = fakeGame();
  game.settings = { masterVolume: 0.65, musicVolume: 0.35, sfxVolume: 1, muted: false };
  game.renderer = null;
  game.player.getEyePos = (o) => { o.x = 0; o.y = 5.6; o.z = 0; return o; };
  const sys = createAudioSystem(game);
  sys.init(game);
  return { game, sys };
}

test('audio: locked system is silent and safe; unlock makes it live', async () => {
  const { game, sys } = await liveSystem();
  assert.equal(sys.unlocked, false);
  assert.equal(sys.play('item.pop'), null, 'locked -> null');
  game.events.emit('block:broken', { x: 0, y: 3, z: 0, id: ID.stone, by: 'player', drops: [] });
  assert.deepEqual({ v: sys.stats().voices, b: sys.stats().byName }, { v: 0, b: {} });
  assert.equal(await sys.unlock(), true);
  assert.equal(sys.unlocked, true);
  assert.ok(sys.play('item.pop'));
  assert.equal(sys.play('not.a.sound'), null);
  assert.equal(sys.stats().unknown['not.a.sound'], 1);
  assert.equal(sys.play('pig.idle', { x: 100, y: 0, z: 0 }), null, 'out of range -> no voice');
  sys.frame(game, 0.016, 1);
  sys.tick(game);
});

test('audio: 50 block:broken events in one tick -> at most 4 voices of that sound (SPEC audio-events)', async () => {
  const { game, sys } = await liveSystem();
  await sys.unlock();
  for (let i = 0; i < 50; i++) game.events.emit('block:broken', { x: i % 5, y: 3, z: 0, id: ID.stone, by: 'player', drops: [] });
  const s = sys.stats();
  assert.ok(s.byName['block.break.stone'] <= 4, JSON.stringify(s.byName));
  assert.ok(s.voices <= 32);
  for (let i = 0; i < 100; i++) sys.play(['item.pop', 'ui.click', 'pig.idle', 'cow.idle', 'block.step.grass', 'door.open', 'explosion', 'bonemeal', 'shear', 'egg.lay'][i % 10], { x: 1, y: 5, z: 0 });
  assert.ok(sys.stats().voices <= 32, `total cap (${sys.stats().voices})`);
});

test('audio: music starts on world:ready once unlocked, and stops on exit', async () => {
  const { game, sys } = await liveSystem();
  game.events.emit('world:ready', { meta: game.meta, isNew: true });
  assert.equal(sys.stats().music.wanted, true);
  await sys.unlock();
  await new Promise((r) => setTimeout(r, 10)); // mock sample render resolves
  const m = sys.music;
  assert.ok(m && m.ready, 'samples prepared');
  assert.ok(m.nextAt >= 20 && m.nextAt <= 40.1, `first piece after 20-40 s (${m.nextAt})`);
  sys.startMusic(0);
  sys.context.currentTime = 0.01;
  sys.frame(game, 0.016, 1);
  assert.ok(m.playing && m.notesPlayed > 0, 'notes scheduled');
  game.events.emit('world:exit', { meta: game.meta });
  assert.equal(m.enabled, false);
  assert.equal(sys.stats().music.wanted, false);
});

test('audio: per-frame voice budget (6 starts per 16 ms, prio exempt) and no voices while muted', async () => {
  const { game, sys } = await liveSystem();
  await sys.unlock();
  const names = ['ui.click', 'ui.open', 'ui.close', 'ui.tick', 'item.pop', 'ui.hint', 'ui.success', 'ui.undo', 'ui.whoosh'];
  const got = names.map((n) => sys.play(n));
  assert.equal(got.filter(Boolean).length, 6, 'only 6 new voices in one burst');
  assert.ok(sys.stats().budgetDropped >= 3, 'the rest are counted as budget drops');
  assert.ok(sys.play('explosion', { prio: 2 }), 'a priority sound still plays');
  game.settings.muted = true;
  game.events.emit('settings:changed', { key: 'muted', value: true, settings: game.settings });
  const t0 = performance.now(); while (performance.now() - t0 < 20) { /* next budget window */ }
  const before = sys.stats().started;
  assert.equal(sys.play('ui.error'), null, 'muted -> no voice is built');
  assert.equal(sys.stats().started, before);
});

test('audio: listener follows the camera pose (third-person front view mirrors left/right)', async () => {
  const { game, sys } = await liveSystem();
  await sys.unlock();
  game.meta = { mode: 'creative' };
  game.player.yaw = 0;
  game.renderer = { camera: { position: { x: 0, y: 5.6, z: -4 }, rotation: { y: Math.PI } } }; // front view
  sys.frame(game, 0.016, 1);
  assert.equal(sys.stats().listener.yaw, 3.14);
  const v = sys.play('cow.idle', { x: 5, y: 5.6, z: 0 }); // east of the player
  assert.ok(v && v.panner && v.panner.pan.value < -0.3, `east pans left when the camera faces the player (${v && v.panner && v.panner.pan.value})`);
});

/* ------------------------------------------------------------------ judge polish round 1 (POL-5..8) */
test('audio POL-7: priming TNT plays only the fuse, not a block break crunch', () => {
  const game = fakeGame(), a = fakeAudio();
  wireAudioEvents(game, a);
  const E = (n, p) => game.events.emit(n, p);
  E('block:broken', { x: 1, y: 2, z: 3, id: ID.tnt, by: 'tnt', drops: [] });   // flint and steel / tnt use
  E('block:broken', { x: 1, y: 2, z: 3, id: ID.tnt, by: 'fire', drops: [] });  // lit by fire or lava
  E('tnt:primed', { id: 5, x: 1.5, y: 2, z: 3.5, fuse: 80 });
  E('block:broken', { x: 1, y: 2, z: 3, id: ID.oak_planks, by: 'fire', drops: [] }); // fire burning wood still sounds
  E('block:broken', { x: 1, y: 2, z: 3, id: ID.tnt, by: 'player', drops: [] });  // a hand break still sounds
  assert.deepEqual(names(a), ['tnt.fuse', 'break.wood', 'break.grass']);
});

test('audio POL-8: the explosion family sits well above a block break and keeps a long rumble tail', () => {
  assert.ok(targetRms('explosion') >= targetRms('block.break.stone') + 4, 'explosion target >= 4 dB over a break');
  const { v } = runRecipe('explosion', { kid: true });
  assert.ok(v.end - v.t0 >= 3, `rumble tail lasts (${(v.end - v.t0).toFixed(2)} s)`);
  assert.ok(SOUNDS.explosion.ref >= 6, 'a blast is full loudness within several blocks');
});

test('audio POL-6: title music after the first gesture (quieter), fades on Play, world schedule after', async () => {
  const { game, sys } = await liveSystem();
  game.state = 'title';
  game.events.emit('game:state', { from: 'boot', to: 'title' });
  assert.equal(sys.stats().music.wantedTitle, true, 'title music requested before unlock');
  await sys.unlock();
  await new Promise((r) => setTimeout(r, 10));
  const m = sys.music;
  assert.ok(m.ready && m.enabled && m.title, 'title music on after the first gesture');
  assert.equal(m.level, 0.5, '-6 dB under the in-world level');
  assert.ok(m.nextAt <= 1.01, `title piece starts at once (${m.nextAt})`);
  sys.context.currentTime = 1.5;
  sys.frame(game, 0.016, 1);
  assert.ok(m.playing && m.notesPlayed > 0, 'title notes play');
  const titleFade = m.fade;
  game.state = 'loading';
  game.events.emit('game:state', { from: 'title', to: 'loading' });
  assert.equal(m.enabled, false, 'Play stops the title music');
  assert.ok(m.fadeStopped && titleFade.gain.n > 0, 'title session fades out');
  game.state = 'playing';
  game.events.emit('world:ready', { meta: game.meta, isNew: true });
  assert.ok(m.enabled && !m.title && m.level === 1, 'world music mode at full level');
  assert.notEqual(m.fade, titleFade, 'world music has its own gain (the title fade-out is not cut short)');
  const gap = m.nextAt - sys.context.currentTime;
  assert.ok(gap >= 20 && gap <= 40.1, `first world piece after 20-40 s (${gap})`);
  // exit to title: world music stops, title music comes back after the fade
  game.events.emit('world:exit', { meta: game.meta });
  game.state = 'title';
  game.events.emit('game:state', { from: 'playing', to: 'title' });
  assert.ok(m.enabled && m.title && Math.abs(m.nextAt - sys.context.currentTime - 2) < 1e-9, 'title music again after exit');
  assert.equal(sys.stats().music.wanted, false);
});

test('audio POL-6: unlocking in a world never starts title music', async () => {
  const { game, sys } = await liveSystem();
  game.state = 'playing';
  await sys.unlock();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(!sys.music.enabled, 'no music until world:ready');
});

test('audio POL-5: ambience scan finds lit furnaces (nearest first), open water and lava', () => {
  const cells = new Map();
  const set = (x, y, z, id) => cells.set(`${x},${y},${z}`, id);
  set(3, 10, 0, ID.furnace_lit); set(-6, 9, 2, ID.furnace_lit); set(1, 10, 1, ID.furnace_lit); set(7, 10, 7, ID.furnace_lit);
  set(0, 8, 5, ID.furnace); // unlit: silent
  for (let x = -4; x <= 4; x++) for (let z = -8; z <= -2; z++) set(x, 8, z, ID.water); // a pond (open)
  set(5, 8, 5, ID.water); set(5, 9, 5, ID.stone); // covered water: silent
  set(-3, 7, 6, ID.lava);
  const getRaw = (x, y, z) => cells.get(`${x},${y},${z}`) || 0;
  const s = scanAmbient(getRaw, 0, 10, 0);
  assert.deepEqual(s.furnaces, [[1, 10, 1], [3, 10, 0], [-6, 9, 2]], 'nearest 3 lit furnaces');
  assert.equal(s.water.length, 24, 'a spread of up to 24 open water cells');
  assert.ok(s.water.every(([x, y, z]) => getRaw(x, y, z) === ID.water && !getRaw(x, y + 1, z)));
  assert.deepEqual(s.lava, [[-3, 7, 6]]);
});

test('audio POL-5: rain bed follows strength, is muffled under a roof, silent in caves and snow; cave drone underground', () => {
  const open = ambienceTargets(1, false, 15, -5, false, true);
  assert.equal(open.rainGain, AMBIENCE.RAIN_LEVEL);
  assert.equal(open.rainHz, AMBIENCE.RAIN_OPEN_HZ);
  assert.equal(ambienceTargets(0.5, false, 15, -5, false, true).rainGain, AMBIENCE.RAIN_LEVEL / 2, 'scaled by rain strength');
  const roof = ambienceTargets(1, false, 14, 2, false, true);
  assert.ok(roof.rainGain > 0 && roof.rainGain < open.rainGain * 0.5 && roof.rainHz < 1000, 'quieter and muffled under a roof');
  assert.equal(ambienceTargets(1, false, 0, 20, false, true).rainGain, 0, 'deep cave: no rain');
  assert.equal(ambienceTargets(1, true, 15, -5, false, true).rainGain, 0, 'snow is silent');
  assert.equal(ambienceTargets(1, false, 15, -5, false, false).rainGain, 0, 'nothing off the playing state');
  assert.equal(ambienceTargets(0, false, 0, 20, false, true).cave, 1, 'cave air underground');
  assert.equal(ambienceTargets(0, false, 0, 2, false, true).cave, 0, 'a dark hut is not a cave');
  assert.equal(ambienceTargets(0, false, 0, 20, true, true).cave, 0, 'not under water');
});

test('audio POL-5: live ambience plays rain, furnace crackle, water lapping and cave drips', async () => {
  const { game, sys } = await liveSystem();
  await sys.unlock();
  const cells = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  cells.set(key(2, 4, 0), ID.furnace_lit);
  for (let x = -3; x <= -1; x++) cells.set(key(x, 3, 3), ID.water);
  let sky = 15, height = 4;
  game.world = { getBlock: () => ID.stone, getRaw: (x, y, z) => cells.get(key(x, y, z)) || 0, getSkyLight: () => sky, getHeight: () => height };
  game.player.eyeInWater = false;
  game.fx = { weather: { rain: 1, target: 1, snow: false } };
  sys.context.currentTime = 1;
  sys.frame(game, 0.016, 1);
  let st = sys.stats().ambience;
  assert.ok(st.rainBed && st.rain > 0.02, `rain bed on (${JSON.stringify(st)})`);
  assert.ok(sys.recent().some((r) => r.name === 'ambient.rain'), 'rain start is logged');
  for (let i = 0; i < 400; i++) { sys.context.currentTime += 0.05; sys.tick(game); if (i % 5 === 4) await new Promise((r) => setTimeout(r, 17)); } // real time: the per-frame voice budget
  const heard = new Set(sys.recent().map((r) => r.name));
  assert.ok(heard.has('furnace.crackle'), `lit furnace crackles (${[...heard]})`);
  assert.ok(heard.has('water.ambient'), 'water laps');
  // go underground: no sky light, rock far overhead
  sky = 0; height = 40; game.fx.weather.rain = 0;
  sys.context.currentTime += 0.2;
  sys.frame(game, 0.016, 1);
  st = sys.stats().ambience;
  assert.equal(st.cave, 1, 'cave detected');
  assert.ok(st.caveBed, 'cave air drone on');
  for (let i = 0; i < 400; i++) { sys.context.currentTime += 0.05; sys.tick(game); if (i % 5 === 4) await new Promise((r) => setTimeout(r, 17)); } // real time: the per-frame voice budget
  assert.ok(sys.recent().some((r) => r.name === 'cave.drip'), 'cave drips');
  game.events.emit('world:exit', { meta: game.meta });
  st = sys.stats().ambience;
  assert.ok(!st.rainBed && !st.caveBed, 'beds stop on world exit');
});
