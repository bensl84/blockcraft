// OWNER LANE: FEATURE-AUDIO. API FROZEN (SPEC §8.3). Everything is synthesised with WebAudio at runtime
// (original sounds; no samples, no network). Event-driven: wiring.js subscribes to the game events
// (block:broken/placed/mining, player:step/land/hurt/water/eat, item:pickup, mob:sound, explosion, tnt:primed,
// ui:click, ui:open, door:toggle, sound ...) - other lanes never need to call audio directly.
//
// Graph (SPEC §8.3.1):
//   voice -> [StereoPanner] -> sfxIn -> muffle (low-pass, under water) -> sfxComp (-18 dB, 4:1, 3 ms, 0.25 s)
//         -> sfxVol (settings.sfxVolume) -> master (settings.masterVolume, 0 when muted)
//   piano -> musicIn -> musicVol (settings.musicVolume) -> duck -> dry -> master
//                                                             \-> send -> convolver (3.5 s procedural IR) -> master
//   master -> limiter (-6 dB, 20:1, 3 ms) -> ceiling (soft clip at -1 dBFS) -> analyser tap -> destination
// Limits: 32 voices, 4 per name, 12 starts/s per name (mixer.js). Pitch randomised ±5% unless a sound says so.
// Kid-safe levels: master limiter always on, explosion peak <= -6 dBFS (measured), no startle sounds.
// Unlock: the AudioContext is created on the first pointerdown/up, click, keydown or touch (or Play button -> unlock()),
// suspended while the tab is hidden and resumed when it is visible again.

import { mulberry32, randomSeed } from '../core/math.js';
import { makeVoiceCtx, toDb } from './dsp.js';
import { busGains, spatial, VoiceTable } from './mixer.js';
import { MusicPlayer, composePiece, renderPianoSamples, SAMPLE_NOTES } from './music.js';
import { makeImpulse } from './reverb.js';
import { SOUNDS, blockSoundName, resolveSound } from './sounds.js';
import { wireAudioEvents } from './wiring.js';

const MAX_STARTS_PER_FRAME = 6;    // new voices per ~frame (16 ms window; prio > 0 exempt): node creation costs main-
const FRAME_WINDOW_MS = 16;        // thread time (~0.3-1 ms per voice on a weak CPU), so a burst cannot stall a frame.
                                   // A time window (not frame()) so it also resets on screens where nothing renders.
const START_LEAD = 0.005;           // seconds between play() and the first sample (input reaction budget 50 ms)
const SETTLE = 0.6;              // offline renders start the sound after this (compressor start-up transient)
const DRY_DAY = 0.8, SEND_DAY = 0.45, DRY_NIGHT = 0.65, SEND_NIGHT = 0.75;

/**
 * Build the mixing graph on any BaseAudioContext (live or offline). Returns the named nodes.
 * @param {BaseAudioContext} ctx
 * @param {{master:number, music:number, sfx:number}} gains
 * @param {{reverb?: boolean}} [opt]  reverb:false skips the music convolver (offline SFX renders: the music bus is
 *                                    silent there, and the 3.5 s convolution is the most expensive node)
 */
export function buildGraph(ctx, gains, opt = {}) {
  const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const n = {};
  n.sfxIn = g(1);
  n.muffle = ctx.createBiquadFilter();
  n.muffle.type = 'lowpass';
  n.muffle.frequency.value = Math.min(20000, ctx.sampleRate / 2);
  n.muffle.Q.value = 0.5;
  n.sfxComp = ctx.createDynamicsCompressor();
  n.sfxComp.threshold.value = -18; n.sfxComp.ratio.value = 4; n.sfxComp.knee.value = 6;
  n.sfxComp.attack.value = 0.003; n.sfxComp.release.value = 0.25;
  n.sfxVol = g(gains.sfx);
  n.master = g(gains.master);
  n.musicIn = g(1);
  n.musicVol = g(gains.music);
  n.duck = g(1);
  n.dry = g(DRY_DAY);
  n.send = g(SEND_DAY);
  const reverb = opt.reverb !== false;
  if (reverb) {
    n.convolver = ctx.createConvolver();
    n.convolver.buffer = makeImpulse(ctx, { seconds: 3.5, rt60: 3.0, damp: 0.65 });
  }
  n.limiter = ctx.createDynamicsCompressor();
  n.limiter.threshold.value = -6; n.limiter.ratio.value = 20; n.limiter.knee.value = 0;
  n.limiter.attack.value = 0.003; n.limiter.release.value = 0.1;
  n.ceiling = ctx.createWaveShaper();
  n.ceiling.curve = softClipCurve(0.5, 0.891);
  n.ceiling.oversample = 'none';
  n.analyser = ctx.createAnalyser();
  n.analyser.fftSize = 2048;

  n.sfxIn.connect(n.muffle); n.muffle.connect(n.sfxComp); n.sfxComp.connect(n.sfxVol); n.sfxVol.connect(n.master);
  n.musicIn.connect(n.musicVol); n.musicVol.connect(n.duck);
  n.duck.connect(n.dry); n.dry.connect(n.master);
  if (reverb) { n.duck.connect(n.send); n.send.connect(n.convolver); n.convolver.connect(n.master); }
  n.master.connect(n.limiter); n.limiter.connect(n.ceiling); n.ceiling.connect(ctx.destination);
  n.ceiling.connect(n.analyser);
  return n;
}

/** Transfer curve: identity below `knee`, then a tanh shoulder that never exceeds `ceil`. */
export function softClipCurve(knee = 0.5, ceil = 0.891, size = 2049) {
  const c = new Float32Array(size);
  const span = ceil - knee;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/**
 * Start one catalogue sound on a context/graph. Returns the voice context (sources, end) or null.
 * Shared by live play() and the offline renderer.
 */
function startVoice(ctx, graph, key, def, opts, gain, pan, rand, t0) {
  const out = ctx.createGain();
  out.gain.value = gain;
  let panner = null;
  if (pan) {
    panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner);
    panner.connect(graph.sfxIn);
  } else out.connect(graph.sfxIn);
  const pj = def.pj ?? 0.05;
  const pitch = Math.max(0.25, Math.min(4, (Number.isFinite(opts.pitch) ? opts.pitch : 1) * (1 + (rand() * 2 - 1) * pj)));
  const v = makeVoiceCtx(ctx, out, t0, { pitch, rand, params: opts });
  def.r(v);
  v.outNode = out;
  v.panner = panner;
  return v;
}

/** @returns {object} Audio system (game.audio) */
export function createAudioSystem(game) {
  const rand = mulberry32(randomSeed()); // audio-private randomness: never game.rand() (keeps gameplay rolls deterministic)
  const table = new VoiceTable();
  const listener = { x: 0, y: 0, z: 0, yaw: 0 };
  const eye = { x: 0, y: 0, z: 0 };
  const sp = { gain: 0, pan: 0, dist: 0 };
  const unknown = {};
  const LOG_MAX = 256;
  const log = [];            // ring of recent plays for diagnostics/tests: {name, t, tick, gain, pan}
  let logHead = 0;
  let ctx = null;
  let graph = null;
  let music = null;
  let wiring = null;
  let wantMusic = false;     // music requested (world running) - honoured once unlocked
  let wantMusicDelay;        // undefined = SPEC first-piece gap
  let night = false;
  let hiddenSuspended = false;
  let errors = 0;
  let startsThisFrame = 0;
  let frameWindowAt = 0;
  let sfxSilent = false;     // master or sfx bus at 0 (muted): build no voices at all
  let budgetDropped = 0;

  const now = () => (ctx ? ctx.currentTime : performance.now() / 1000);
  const running = () => !!ctx && ctx.state === 'running';

  function warn(where, err) {
    errors++;
    if (errors <= 5) console.warn(`[audio] ${where}:`, err && err.message ? err.message : err);
  }

  function applySettings() {
    if (!graph) return;
    const gns = busGains(game.settings);
    sfxSilent = !(gns.master > 0 && gns.sfx > 0);
    const t = ctx.currentTime;
    // linear ramps (not setTargetAtTime) so 0 really is silence (mute) and there is no zipper noise
    ramp(graph.master.gain, gns.master, t, 0.05);
    ramp(graph.sfxVol.gain, gns.sfx, t, 0.05);
    ramp(graph.musicVol.gain, gns.music, t, 0.1);
  }

  function ramp(param, value, t, sec) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + sec);
  }

  function setMuffle(on) {
    if (!graph) return;
    graph.muffle.frequency.setTargetAtTime(on ? 650 : Math.min(20000, ctx.sampleRate / 2), ctx.currentTime, 0.06);
  }

  function setNight(on) {
    night = !!on;
    if (music) music.night = night;
    if (!graph) return;
    const t = ctx.currentTime;
    graph.dry.gain.setTargetAtTime(night ? DRY_NIGHT : DRY_DAY, t, 1.5);
    graph.send.gain.setTargetAtTime(night ? SEND_NIGHT : SEND_DAY, t, 1.5);
  }

  function duck(level, sec) {
    if (!graph) return;
    const t = ctx.currentTime;
    const p = graph.duck.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.setTargetAtTime(level, t, 0.04);
    p.setTargetAtTime(1, t + sec, 0.35);
  }

  function killVoice(rec, fade = 0.03) {
    if (!rec || !ctx) return;
    const t = ctx.currentTime;
    try {
      const g = rec.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + fade);
    } catch { /* ignore */ }
    for (const s of rec.sources) { try { s.stop(t + fade + 0.01); } catch { /* already stopped */ } }
    rec.end = Math.min(rec.end, t + fade + 0.02);
  }

  function disconnect(rec) {
    try { rec.out.disconnect(); } catch { /* ignore */ }
    if (rec.panner) { try { rec.panner.disconnect(); } catch { /* ignore */ } }
  }

  function startMusicNow() {
    if (!ctx) return;
    if (!music) {
      music = new MusicPlayer(ctx, graph.musicIn, rand);
      music.night = night;
      const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      music.prepare(Off);
    }
    if (wantMusic) { music.start(wantMusicDelay); wantMusicDelay = undefined; }
  }

  function onRunning() {
    sys.unlocked = true;
    applySettings();
    startMusicNow(); // renders the piano samples once (OfflineAudioContext) right after the first gesture
  }

  const musicApi = {
    start(delay) { wantMusic = true; wantMusicDelay = delay; if (running()) startMusicNow(); },
    stop(fade = 1.5) { wantMusic = false; wantMusicDelay = undefined; if (music) music.stop(fade); },
    setNight,
    duck,
  };

  /** Shared play implementation. opts: {x, y, z, volume, pitch, prio, ...recipe params}. */
  function play(name, opts = {}) {
    const key = resolveSound(name);
    if (!key) { unknown[name] = (unknown[name] || 0) + 1; return null; }
    if (!running() || !graph) return null;
    if (sfxSilent) return null; // muted / effects volume 0: nothing would be heard, so build nothing
    const prio = opts.prio || 0;
    const nowMs = performance.now();
    if (nowMs - frameWindowAt >= FRAME_WINDOW_MS) { frameWindowAt = nowMs; startsThisFrame = 0; }
    if (startsThisFrame >= MAX_STARTS_PER_FRAME && prio <= 0) { budgetDropped++; return null; }
    const def = SOUNDS[key];
    let gain = def.vol * (def.trim || 1) * (Number.isFinite(opts.volume) ? Math.max(0, Math.min(2, opts.volume)) : 1);
    let pan = 0;
    if (def.range > 0 && Number.isFinite(opts.x) && Number.isFinite(opts.y) && Number.isFinite(opts.z)) {
      spatial(listener.x, listener.y, listener.z, listener.yaw, opts.x, opts.y, opts.z, def.range, 3, sp);
      if (sp.gain < 0.01) return null; // out of earshot: no voice at all
      gain *= sp.gain;
      pan = Math.abs(sp.pan) > 0.02 ? sp.pan : 0;
    }
    if (gain <= 0.0005) return null;
    const t = ctx.currentTime;
    const adm = table.admit(key, t, { gap: def.gap, prio });
    if (!adm.ok) return null;
    startsThisFrame++;
    if (adm.steal) { killVoice(adm.steal, 0.03); const s = adm.steal; setTimeout(() => disconnect(s), 120); }
    let v;
    try {
      v = startVoice(ctx, graph, key, def, opts, gain, pan, rand, t + START_LEAD);
    } catch (err) {
      warn(`play ${key}`, err);
      return null;
    }
    const entry = { name: key, t: Math.round(t * 1000) / 1000, tick: game.tickCount | 0, gain: Math.round(gain * 1000) / 1000, pan: Math.round(pan * 100) / 100 };
    if (log.length < LOG_MAX) log.push(entry); else { log[logHead] = entry; logHead = (logHead + 1) % LOG_MAX; }
    return table.add(key, t, v.end, { out: v.outNode, panner: v.panner, sources: v.sources });
  }

  const sys = {
    name: 'audio',
    /** true once the AudioContext is running (after a user gesture) */
    unlocked: false,

    init() {
      wiring = wireAudioEvents(game, {
        play, playBlock: (...a) => sys.playBlock(...a), stopVoice: (rec, fade) => { if (rec) killVoice(rec, fade); },
        music: musicApi, setMuffle, applySettings, now, rand,
      });
      const gesture = () => { if (!running()) sys.unlock(); };
      window.addEventListener('pointerdown', gesture, true);
      window.addEventListener('keydown', gesture, true);
      window.addEventListener('touchstart', gesture, { capture: true, passive: true });
      // touch screens only grant audio permission on the END of a tap; mice on down - listen to both
      window.addEventListener('pointerup', gesture, true);
      window.addEventListener('touchend', gesture, { capture: true, passive: true });
      window.addEventListener('click', gesture, true);
      document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) {
          if (ctx.state === 'running') { hiddenSuspended = true; ctx.suspend().catch(() => {}); }
        } else if (hiddenSuspended || ctx.state === 'suspended') {
          hiddenSuspended = false;
          ctx.resume().then(() => { if (running()) onRunning(); }).catch(() => {});
        }
      });
    },

    /** Create/resume the AudioContext. Call from a user gesture (Play button, first click/key). */
    unlock() {
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return Promise.resolve(false);
          ctx = new AC({ latencyHint: 'interactive' });
          graph = buildGraph(ctx, busGains(game.settings));
          ctx.onstatechange = () => { sys.unlocked = ctx.state === 'running'; };
        }
        if (ctx.state === 'running') { if (!sys.unlocked) onRunning(); return Promise.resolve(true); }
        return ctx.resume().then(() => { if (running()) onRunning(); return running(); }, () => false);
      } catch (err) {
        warn('unlock', err);
        return Promise.resolve(false);
      }
    },

    /**
     * Play a named sound (catalog in SPEC §8.3.2). opts: {x,y,z (positional), volume 0..1, pitch multiplier}.
     * Returns the voice record (or null when locked, unknown, out of range or over a limit).
     */
    play(name, opts = {}) { return play(name, opts || {}); },

    /**
     * Block material sound. kind: 'break'|'place'|'step'|'hit'|'land'; soundType from blocks.js `sound`.
     */
    playBlock(kind, soundType, x, y, z, opts = {}) {
      const name = blockSoundName(kind, soundType);
      if (!name) return null;
      return play(name, { ...(opts || {}), x, y, z });
    },

    /** Start/stop the generative piano music. startMusic(delay = 1 s) starts a piece soon. */
    startMusic(delay = 1) { musicApi.start(delay); },
    stopMusic(fade = 1.5) { musicApi.stop(fade); },

    /** Stop a voice returned by play() (fade seconds). */
    stop(rec, fade = 0.05) { if (rec) killVoice(rec, fade); },

    /** Live voice counts for tests ('audio-events'): {voices, byName} (+ diagnostics). */
    stats() {
      const s = table.stats(ctx ? ctx.currentTime : undefined);
      s.unlocked = sys.unlocked;
      s.state = ctx ? ctx.state : 'none';
      s.started = table.total;
      s.dropped = table.dropped;
      s.budgetDropped = budgetDropped;
      s.stolen = table.stolen;
      s.unknown = { ...unknown };
      s.music = music ? music.stats() : { ready: false, enabled: false, playing: false, wanted: wantMusic };
      s.music.wanted = wantMusic;
      s.night = night;
      s.sampleRate = ctx ? ctx.sampleRate : 0;
      s.muffleHz = graph ? Math.round(graph.muffle.frequency.value) : 0;
      s.duck = graph ? Math.round(graph.duck.gain.value * 100) / 100 : 1;
      s.listener = { x: Math.round(listener.x * 10) / 10, y: Math.round(listener.y * 10) / 10, z: Math.round(listener.z * 10) / 10, yaw: Math.round(listener.yaw * 100) / 100 };
      return s;
    },

    tick() { if (wiring) wiring.tick(); },

    frame() {
      // listener = camera pose (position AND yaw: the third-person front view looks back at the player, so left/right
      // must follow what is on screen, not the player's facing). Falls back to the player's eye. The player system
      // is registered before audio, so the camera already holds this frame's pose.
      const p = game.player;
      const cam = game.renderer && game.renderer.camera;
      if (cam && cam.position && game.meta) {
        listener.x = cam.position.x; listener.y = cam.position.y; listener.z = cam.position.z;
        listener.yaw = Number.isFinite(cam.rotation.y) ? cam.rotation.y : (p ? p.yaw : 0);
      } else if (p && p.getEyePos) {
        p.getEyePos(eye, true); listener.x = eye.x; listener.y = eye.y; listener.z = eye.z;
        if (Number.isFinite(p.yaw)) listener.yaw = p.yaw;
      }
      if (!ctx) return;
      const removed = table.prune(ctx.currentTime);
      for (let i = 0; i < removed.length; i++) disconnect(removed[i]);
      if (music && running()) {
        const g = busGains(game.settings);
        if (g.master > 0 && g.music > 0) music.update(ctx.currentTime);
      }
    },

    dispose() {
      if (wiring) wiring.dispose();
      for (const r of table.clear()) { killVoice(r, 0.01); disconnect(r); }
      if (ctx) ctx.close().catch(() => {});
      ctx = null; graph = null; music = null;
      sys.unlocked = false;
    },

    /* ---------------- diagnostics / tests (additive API) ---------------- */
    /** The live AudioContext (or null before unlock). */
    get context() { return ctx; },
    /** Recent plays, oldest first (diagnostics): [{name, t (ctx seconds), tick, gain, pan}]. clear=true empties it. */
    recent(clear = false) {
      const out = log.length < LOG_MAX ? log.slice() : log.slice(logHead).concat(log.slice(0, logHead));
      if (clear) { log.length = 0; logHead = 0; }
      return out;
    },
    /** The music player (or null before unlock). */
    get music() { return music; },
    /** All catalogue names. */
    soundNames() { return Object.keys(SOUNDS); },

    /**
     * Render a sound through the full graph in an OfflineAudioContext and measure it.
     * opts: {x,y,z (relative listener at 0,0,0 yaw 0), volume, pitch, settings: {masterVolume, sfxVolume, ...},
     *        seconds = auto, sampleRate = 44100, data = false (return samples), seed} -> {peak, peakDb, rms, rmsDb, seconds, data?}
     */
    async renderOffline(name, opts = {}) {
      const key = resolveSound(name);
      if (!key) throw new Error(`unknown sound ${name}`);
      const def = SOUNDS[key];
      const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const sr = opts.sampleRate || 44100;
      const r = opts.seed !== undefined ? mulberry32(opts.seed) : rand;
      // measure the duration with a dry run on a throwaway context of 0.1 s
      const probe = new Off(2, Math.ceil(sr * 0.1), sr);
      const pg = { sfxIn: probe.createGain() };
      const pv = startVoice(probe, pg, key, def, opts, 1, 0, mulberry32(1), 0);
      const at = opts.at ?? SETTLE; // let the fresh compressors settle: a live graph has been running for ages
      const seconds = (opts.seconds || Math.min(8, pv.end + 0.3)) + at;
      const off = new Off(2, Math.ceil(sr * seconds), sr);
      const gns = busGains({ ...game.settings, ...(opts.settings || {}) });
      const g = buildGraph(off, gns, { reverb: false });
      let gain = def.vol * (def.trim || 1) * (Number.isFinite(opts.volume) ? opts.volume : 1), pan = 0;
      if (def.range > 0 && Number.isFinite(opts.x)) {
        spatial(0, 0, 0, 0, opts.x, opts.y || 0, opts.z || 0, def.range, 3, sp);
        gain *= sp.gain; pan = sp.pan;
      }
      startVoice(off, g, key, def, opts, gain, pan, r, at);
      const buf = await off.startRendering();
      return measure(buf, opts.data, at - 0.005);
    },

    /**
     * Play a sound on the LIVE graph and watch the analyser (SPEC acceptance: explosion peak). Needs unlock.
     * -> {peak, peakDb, ms} or null when locked.
     */
    async measurePeak(name, opts = {}) {
      if (!running()) return null;
      const rec = play(name, opts);
      if (!rec) return { peak: 0, peakDb: -120, ms: 0, played: false };
      const an = graph.analyser;
      const buf = new Float32Array(an.fftSize);
      let peak = 0;
      const t0 = performance.now();
      const until = (rec.end - ctx.currentTime) * 1000 + 250;
      while (performance.now() - t0 < until) {
        an.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
        await new Promise((res) => setTimeout(res, 10));
      }
      return { peak, peakDb: toDb(peak), ms: Math.round(performance.now() - t0), played: true };
    },

    /** Watch the live output for `ms` without playing anything -> {peakDb, voices} (silence checks). */
    async listenPeak(ms = 300) {
      if (!running()) return null;
      const an = graph.analyser;
      const buf = new Float32Array(an.fftSize);
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        an.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
        await new Promise((res) => setTimeout(res, 10));
      }
      return { peakDb: toDb(peak), voices: table.stats(ctx.currentTime).byName };
    },

    /**
     * Render `seconds` of generated music offline (piano samples + reverb + limiter) for listening tests.
     * opts: {seconds = 45, night = false, seed = 1, data = false} -> {peakDb, rmsDb, notes, mode, bpm, data?}
     */
    async renderMusicOffline(opts = {}) {
      const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const sr = 44100;
      const seconds = opts.seconds || 45;
      const samples = await renderPianoSamples(Off);
      const off = new Off(2, Math.ceil(sr * seconds), sr);
      const g = buildGraph(off, busGains({ ...game.settings, ...(opts.settings || {}) }));
      if (opts.night) { g.dry.gain.value = DRY_NIGHT; g.send.gain.value = SEND_NIGHT; }
      const r = mulberry32(opts.seed ?? 1);
      const mp = new MusicPlayer(off, g.musicIn, r);
      mp.buffers = samples.map((a) => { const b = off.createBuffer(1, a.length, 22050); b.getChannelData(0).set(a); return b; });
      const piece = composePiece(r, { night: !!opts.night });
      const spb = 60 / piece.bpm;
      let notes = 0;
      for (const e of piece.events) {
        const t = 0.2 + e.beat * spb;
        if (t > seconds - 0.5) break;
        mp.note(e.midi, e.vel, t, e.dur * spb);
        notes++;
      }
      const buf = await off.startRendering();
      return { ...measure(buf, opts.data), notes, mode: piece.mode, bpm: piece.bpm, pieceSeconds: Math.round(piece.seconds), samples: SAMPLE_NOTES.length };
    },
  };
  return sys;
}

/** Peak / RMS of a rendered buffer (both channels). data: also return interleaved-free channel arrays. */
function measure(buf, withData, fromSec = 0) {
  const from = Math.max(0, Math.floor(fromSec * buf.sampleRate));
  let peak = 0;
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c).subarray(from);
    chans.push(d);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  // RMS over the loud part only (frames above -50 dBFS) so long silent tails do not hide the level
  let s2 = 0, n2 = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > 0.003) { s2 += d[i] * d[i]; n2++; } }
  const rms = n2 ? Math.sqrt(s2 / n2) : 0;
  const out = { peak, peakDb: round1(toDb(peak)), rms, rmsDb: round1(toDb(rms)), seconds: (buf.length - from) / buf.sampleRate, sampleRate: buf.sampleRate, nonSilent: n2 };
  if (withData) out.data = chans.map((d) => Array.from(d, (x) => Math.round(x * 32767)));
  return out;
}

function round1(x) { return Math.round(x * 10) / 10; }
