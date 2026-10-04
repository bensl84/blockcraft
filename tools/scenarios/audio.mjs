// OWNER LANE: FEATURE-AUDIO. Smoke scenarios for src/audio/* (SPEC §8.3 acceptance + §13.2).
// Run: node tools/smoke.mjs --tag audio --scenario audio-locked,audio-unlock,...   (or --tag audio for all)
//
// Scenarios that need real CORE lanes (break/place, walking, mobs) list them in `requires` and report PENDING
// until those lanes are merged. Everything else runs against the stubs today.
// Side outputs (for humans): .tmp/audio-wav/*.wav (every sound + a music excerpt), .tmp/smoke-audio-waveforms.png,
// .tmp/audio-levels.json (peak/RMS per sound through the full mixing chain).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIM_DB, targetRms } from '../../src/audio/levels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = join(ROOT, '.tmp');
const FLAT = { preset: 'flat', seed: 11, mode: 'creative', difficulty: 'peaceful' };

/** Click an empty corner of the page = a real user gesture (unlocks WebAudio). */
async function gesture(t) {
  await t.page.mouse.click(4, 716);
  return t.waitFor(() => window.__game.game.audio.unlocked === true, null, 5000);
}

/** 16-bit PCM WAV from already-interleaved little-endian int16 PCM (base64 from the page: a JSON array of millions
 *  of numbers over the devtools protocol was what made audio-catalog slow). */
function wavPcm(path, b64, ch, sr) {
  const pcm = Buffer.from(b64, 'base64');
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(ch, 22); head.writeUInt32LE(sr, 24);
  head.writeUInt32LE(sr * ch * 2, 28); head.writeUInt16LE(ch * 2, 32); head.writeUInt16LE(16, 34); head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([head, pcm]));
}

export default [
  {
    // SPEC §8.3 acceptance: no console errors when audio is locked (headless) - every event is safe before unlock.
    name: 'audio-locked', requires: ['audio'],
    async run(t) {
      // a gesture from an earlier scenario (the --touch run taps in touch-controls) already unlocked audio for this
      // page: reload for a fresh, gesture-free page (LEAD integration)
      if (await t.eval(() => window.__game.game.audio.unlocked)) {
        await t.page.reload({ waitUntil: 'load' });
        await t.page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });
      }
      const r = await t.eval(() => {
        const g = window.__game.game;
        const a = g.audio;
        const before = { unlocked: a.unlocked, stats: a.stats() };
        const E = (n, p) => g.events.emit(n, p);
        E('ui:click', {}); E('ui:open', { screen: 'pause', opts: {} });
        E('block:broken', { x: 0, y: 3, z: 0, id: 1, by: 'player', drops: [] });
        E('explosion', { x: 0, y: 3, z: 0, power: 4, blocks: [], count: 0 });
        E('mob:sound', { id: 1, type: 'cow', kind: 'idle', x: 0, y: 3, z: 0 });
        E('sound', { name: 'item.pop' });
        const played = a.play('item.pop');
        return { before, played, after: a.stats(), audioStats: window.__game.audioStats() };
      });
      t.assert(r.before.unlocked === false, 'audio starts locked (no gesture yet)');
      t.assert(r.before.stats.state === 'none', `no AudioContext before a gesture (${r.before.stats.state})`);
      t.assert(r.played === null, 'play() is a silent no-op while locked');
      t.assert(r.after.voices === 0 && Object.keys(r.after.byName).length === 0, 'no voices while locked');
      t.assert(r.audioStats.voices === 0 && typeof r.audioStats.byName === 'object', '__game.audioStats() shape');
    },
  },
  {
    // SPEC: __game.game.audio.unlocked becomes true after a click.
    name: 'audio-unlock', requires: ['audio'],
    async run(t) {
      const ok = await gesture(t);
      t.assert(ok, 'audio.unlocked is true after a click');
      const s = await t.call('audioStats');
      t.note('ctx', { state: s.state, sampleRate: s.sampleRate });
      t.assert(s.state === 'running', `context running (${s.state})`);
      // count against the clicks still sounding from the gesture itself (or an earlier scenario)
      const r = await t.eval(() => { const a = window.__game.game.audio; const n0 = a.stats().byName['ui.click'] || 0; const v = !!a.play('ui.click'); return { v, n0, n1: a.stats().byName['ui.click'] || 0 }; });
      t.assert(r.v, 'a UI click plays once unlocked');
      t.assert(r.n1 === r.n0 + 1, `click voice counted (${JSON.stringify(r)})`);
      t.assert(await t.waitFor(() => window.__game.audioStats().voices === 0, null, 1500), 'voices end and are pruned');
    },
  },
  {
    // SPEC §8.3 acceptance: emit 50 block:broken events in one tick -> no more than 4 voices of that sound, no errors.
    name: 'audio-events', requires: ['audio'],
    async run(t) {
      await gesture(t);
      await t.call('startWorld', FLAT);
      const r = await t.eval(() => {
        const g = window.__game.game;
        const p = window.__game.pos();
        const stone = window.__game.blockId('stone');
        for (let i = 0; i < 50; i++) g.events.emit('block:broken', { x: Math.floor(p.x) + (i % 3), y: Math.floor(p.y) - 1, z: Math.floor(p.z) - 2, id: stone, state: 0, by: 'player', drops: [], blockEntity: null, action: 1 });
        const s1 = g.audio.stats();
        for (let i = 0; i < 50; i++) g.events.emit('ui:click', {});
        for (let i = 0; i < 40; i++) g.events.emit('mob:sound', { id: i, type: ['pig', 'cow', 'sheep', 'chicken'][i % 4], kind: 'idle', x: p.x + 2, y: p.y, z: p.z });
        const s2 = g.audio.stats();
        return { s1, s2 };
      });
      t.note('after50', r.s1.byName);
      t.assert(r.s1.byName['block.break.stone'] >= 1 && r.s1.byName['block.break.stone'] <= 4, `<= 4 voices of block.break.stone (${JSON.stringify(r.s1.byName)})`);
      t.assert(r.s2.voices <= 32, `<= 32 voices total (${r.s2.voices})`);
      for (const [n, c] of Object.entries(r.s2.byName)) t.assert(c <= 4, `${n}: ${c} voices`);
      t.assert((await t.eval(() => window.__game.errors.length)) === 0, 'no recorded errors');
    },
  },
  {
    // SPEC §8.3 acceptance: measured peak (AnalyserNode) of `explosion` <= -6 dBFS (kid and survival, default and max volume).
    name: 'audio-explosion-peak', requires: ['audio'],
    async run(t) {
      await gesture(t);
      await t.call('startWorld', FLAT);
      const res = {};
      for (const [label, master, kid] of [['kid-default', 0.65, true], ['kid-max', 1, true], ['survival-max', 1, false]]) {
        await t.call('setSetting', 'masterVolume', master);
        await t.call('setSetting', 'sfxVolume', 1);
        await t.call('sleep', 150);
        const live = await t.eval(async (kid) => {
          const p = window.__game.pos();
          return window.__game.game.audio.measurePeak('explosion', { x: p.x, y: p.y + 1.6, z: p.z, kid });
        }, kid);
        const off = await t.eval(async ([kid, master]) => window.__game.game.audio.renderOffline('explosion', { kid, settings: { masterVolume: master }, seed: 3 }), [kid, master]);
        res[label] = { live: Math.round(live.peakDb * 10) / 10, offline: off.peakDb, rms: off.rmsDb };
        t.assert(live.played, `${label}: explosion played`);
        t.assert(live.peakDb <= -6, `${label}: live analyser peak ${live.peakDb.toFixed(1)} dBFS <= -6`);
        t.assert(live.peakDb > -40, `${label}: explosion is audible (${live.peakDb.toFixed(1)} dBFS)`);
        t.assert(off.peakDb <= -6, `${label}: offline peak ${off.peakDb} dBFS <= -6`);
        await t.call('sleep', 300);
      }
      await t.call('setSetting', 'masterVolume', 0.65);
      t.note('explosion', res);
    },
  },
  {
    // Every catalogue sound renders through the full chain: audible, never above the -1 dBFS ceiling.
    // Writes .tmp/audio-levels.json, .tmp/audio-wav/<name>.wav and a waveform contact sheet screenshot.
    name: 'audio-catalog', requires: ['audio'],
    async run(t) {
      const names = await t.eval(() => window.__game.game.audio.soundNames());
      t.assert(names.length >= 100, `catalogue size ${names.length}`);
      const levels = {};
      const sheet = [];
      // render in parallel batches (each OfflineAudioContext renders on its own thread) to stay well inside the
      // scenario timeout while the real world is loaded on the title screen
      const BATCH = 6;
      for (let b = 0; b < names.length; b += BATCH) {
        const rs = await t.eval(async (batch) => Promise.all(batch.map(async (name) => {
          const o = await window.__game.game.audio.renderOffline(name, { seed: 5, data: true, sampleRate: 44100 });
          // min/max envelope for the contact sheet (120 columns)
          const d = o.data[0], cols = 120, env = [];
          for (let c = 0; c < cols; c++) {
            let lo = 0, hi = 0;
            for (let i = Math.floor(c * d.length / cols); i < Math.floor((c + 1) * d.length / cols); i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
            env.push([lo / 32768, hi / 32768]);
          }
          // interleaved int16 PCM -> base64 (compact transfer)
          const ch = o.data.length, n = o.data[0].length, pcm = new Int16Array(n * ch);
          for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) pcm[i * ch + c] = Math.max(-32768, Math.min(32767, o.data[c][i]));
          const bytes = new Uint8Array(pcm.buffer);
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          return { name, peakDb: o.peakDb, rmsDb: o.rmsDb, seconds: o.seconds, b64: btoa(bin), ch, env };
        })), names.slice(b, b + BATCH));
        for (const r of rs) {
          const name = r.name;
          levels[name] = { peakDb: r.peakDb, rmsDb: r.rmsDb, seconds: Math.round(r.seconds * 100) / 100 };
          sheet.push({ name, env: r.env, peakDb: r.peakDb });
          wavPcm(join(TMP, 'audio-wav', `${name}.wav`), r.b64, r.ch, 44100);
          t.assert(r.peakDb > -45, `${name} is audible (peak ${r.peakDb} dBFS)`);
          t.assert(r.peakDb <= -0.9, `${name} stays under the -1 dBFS ceiling (${r.peakDb})`);
        }
      }
      writeFileSync(join(TMP, 'audio-levels.json'), JSON.stringify(levels, null, 1));
      // loudness balance: each sound within 4 dB of its family target (levels.js); write suggested trims
      const trim = {};
      const off = [];
      for (const [n, l] of Object.entries(levels)) {
        const d = targetRms(n) - l.rmsDb;
        trim[n] = Math.round(Math.max(-24, Math.min(24, (TRIM_DB[n] || 0) + d)) * 10) / 10;
        if (Math.abs(d) > 4) off.push(`${n} ${l.rmsDb} (target ${targetRms(n)})`);
      }
      writeFileSync(join(TMP, 'audio-trim.json'), JSON.stringify(trim, null, 1));
      t.note('offTarget', off.length);
      const loudest = Object.entries(levels).sort((a, b) => b[1].peakDb - a[1].peakDb).slice(0, 5).map(([n, l]) => `${n} ${l.peakDb}`);
      t.note('loudest', loudest);
      // contact sheet
      await t.page.setViewportSize({ width: 1600, height: 1000 });
      await t.eval((sheet) => {
        const cv = document.createElement('canvas');
        cv.id = 'audio-sheet'; cv.width = 1600; cv.height = 1000;
        cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#14161c';
        document.body.appendChild(cv);
        const x = cv.getContext('2d');
        x.fillStyle = '#14161c'; x.fillRect(0, 0, 1600, 1000);
        const cols = 10, w = 160, h = Math.floor(1000 / Math.ceil(sheet.length / cols));
        sheet.forEach((s, i) => {
          const cx = (i % cols) * w, cy = Math.floor(i / cols) * h, mid = cy + h / 2 + 5;
          x.strokeStyle = '#2a2e38'; x.strokeRect(cx + 0.5, cy + 0.5, w - 1, h - 1);
          x.fillStyle = s.peakDb > -6 ? '#ffb454' : '#7fd1ff';
          s.env.forEach(([lo, hi], j) => { const px = cx + 20 + j; x.fillRect(px, mid - hi * (h / 2 - 8), 1, Math.max(1, (hi - lo) * (h / 2 - 8))); });
          x.fillStyle = '#d8dde8'; x.font = '10px monospace';
          x.fillText(`${s.name} ${s.peakDb}`, cx + 3, cy + 10);
        });
      }, sheet);
      await t.shot('audio-waveforms');
      await t.eval(() => document.getElementById('audio-sheet').remove());
      await t.page.setViewportSize({ width: 1280, height: 720 });
      t.assert(off.length === 0, `loudness balance: ${off.slice(0, 12).join(', ')}`);
    },
  },
  {
    // P1 music: the piano samples render, a piece is calm (peak well under the ceiling) and the live scheduler plays notes.
    name: 'audio-music', requires: ['audio'],
    async run(t) {
      const day = await t.eval(async () => {
        const o = await window.__game.game.audio.renderMusicOffline({ seconds: 40, seed: 7, data: true });
        const ch = o.data.length, n = o.data[0].length, pcm = new Int16Array(n * ch);
        for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) pcm[i * ch + c] = Math.max(-32768, Math.min(32767, o.data[c][i]));
        const bytes = new Uint8Array(pcm.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        delete o.data;
        return { ...o, b64: btoa(bin), ch };
      });
      const night = await t.eval(async () => window.__game.game.audio.renderMusicOffline({ seconds: 40, seed: 8, night: true, data: false }));
      wavPcm(join(TMP, 'audio-wav', 'music-day.wav'), day.b64, day.ch, 44100);
      t.note('day', { mode: day.mode, bpm: day.bpm, notes: day.notes, peakDb: day.peakDb, rmsDb: day.rmsDb, pieceSeconds: day.pieceSeconds });
      t.note('night', { mode: night.mode, bpm: night.bpm, notes: night.notes, peakDb: night.peakDb });
      t.assert(day.notes >= 10 && day.peakDb > -40, `music is audible (${day.notes} notes, ${day.peakDb} dBFS)`);
      t.assert(day.peakDb <= -3, `music is gentle (peak ${day.peakDb} dBFS)`);
      t.assert(['dorian', 'lydian'].includes(night.mode), `night mood mode (${night.mode})`);
      await gesture(t);
      await t.call('startWorld', FLAT);
      const wanted = await t.eval(() => window.__game.audioStats().music);
      t.assert(wanted.wanted === true, 'world:ready requests music');
      t.assert(wanted.nextIn === null || (wanted.nextIn >= 15 && wanted.nextIn <= 40.5), `first piece is 20-40 s away (${wanted.nextIn})`);
      await t.eval(() => window.__game.game.audio.startMusic(0));
      const playing = await t.waitFor(() => { const m = window.__game.audioStats().music; return m.ready && m.notesPlayed > 0; }, null, 15000);
      const m = await t.eval(() => window.__game.audioStats().music);
      t.note('live', m);
      t.assert(playing, `live music plays notes (${JSON.stringify(m)})`);
      await t.call('exitToTitle');
      const after = await t.eval(() => window.__game.audioStats().music);
      t.assert(after.enabled === false && after.wanted === false, 'music stops on exit to title');
    },
  },
  {
    // Volumes update live from settings; mute silences everything (the analyser at the output proves it).
    name: 'audio-volume', requires: ['audio'],
    async run(t) {
      await gesture(t);
      // isolate the effects bus: no music, and let any reverb tail from earlier scenarios die away
      await t.eval(() => window.__game.game.audio.stopMusic(0.05));
      await t.call('setSetting', 'musicVolume', 0);
      await t.call('sleep', 1500);
      const peak = (name) => t.eval(async (name) => (await window.__game.game.audio.measurePeak(name)).peakDb, name);
      const quiet = await t.eval(() => window.__game.game.audio.listenPeak(300));
      t.note('baseline', quiet);
      const normal = Math.min(await peak('ui.success'), await peak('ui.success')); // a stray sound can only add level
      await t.call('setSetting', 'muted', true);
      await t.call('sleep', 200);
      const muted = await peak('ui.success');
      await t.call('setSetting', 'muted', false);
      await t.call('setSetting', 'sfxVolume', 0);
      await t.call('sleep', 200);
      const noSfx = await peak('ui.success');
      await t.call('setSetting', 'sfxVolume', 1);
      await t.call('sleep', 200);
      const back = Math.min(await peak('ui.success'), await peak('ui.success'));
      await t.call('setSetting', 'musicVolume', 0.35);
      t.note('peaks', { normal, muted, noSfx, back });
      t.assert(normal > -40, `UI chime audible (${normal})`);
      t.assert(muted < -80, `muted is silent (${muted})`);
      t.assert(noSfx < -80, `sfxVolume 0 is silent (${noSfx})`);
      t.assert(Math.abs(back - normal) < 3, `volume restored (${back} vs ${normal})`);
    },
  },
  {
    // Underwater muffle + positional pan (live graph sanity; no core needed).
    name: 'audio-positional', requires: ['audio'],
    async run(t) {
      await gesture(t);
      await t.call('startWorld', FLAT);
      const r = await t.eval(async () => {
        const a = window.__game.game.audio, p = window.__game.pos();
        const near = a.play('cow.idle', { x: p.x + 1, y: p.y + 1.6, z: p.z });
        const far = a.play('cow.idle', { x: p.x + 40, y: p.y, z: p.z });
        const right = a.play('pig.idle', { x: p.x + 6, y: p.y + 1.6, z: p.z }); // yaw 0 faces north: +X is right
        return { near: !!near, far: far === null, pan: right && right.panner ? right.panner.pan.value : 0 };
      });
      t.assert(r.near, 'a nearby mob is heard');
      t.assert(r.far, 'a mob 40 blocks away makes no voice at all');
      t.assert(r.pan > 0.3, `a sound to the east pans right (${r.pan})`);
    },
  },
  {
    // In-world: breaking and placing blocks make material sounds (needs the real CORE player/interaction lanes).
    name: 'audio-break-place', requires: ['audio', 'input', 'player', 'physics', 'raycast', 'interaction', 'world'],
    async run(t) {
      await gesture(t);
      await t.call('startWorld', FLAT);
      await t.call('setFlying', false);
      await t.call('waitTicks', 10);
      await t.call('setLook', 0, -55);
      const s0 = await t.call('audioStats');
      const br = await t.call('breakTarget');
      t.assert(br.ok, `block broken (${JSON.stringify(br)})`);
      const s1 = await t.call('audioStats');
      t.assert(s1.started > s0.started, 'breaking started a sound');
      await t.call('selectSlot', 1);
      const pl = await t.call('placeTarget');
      t.assert(pl.ok, 'placed');
      const s2 = await t.call('audioStats');
      t.assert(s2.started > s1.started, 'placing started a sound');
      t.assert((await t.call('eventCount', 'block:placed')) >= 1, 'block:placed emitted');
    },
  },
  {
    // In-world: walking emits player:step -> footstep voices (needs CORE-E).
    name: 'audio-footsteps', requires: ['audio', 'input', 'player', 'physics', 'world'],
    async run(t) {
      await gesture(t);
      await t.call('startWorld', FLAT);
      await t.call('setFlying', false);
      await t.call('waitTicks', 10);
      const before = await t.call('eventCount', 'player:step');
      const s0 = await t.call('audioStats');
      await t.call('move', 1, 0, 1500);
      const steps = (await t.call('eventCount', 'player:step')) - before;
      const s1 = await t.call('audioStats');
      t.note('steps', steps);
      t.assert(steps >= 3, `player:step emitted while walking (${steps})`);
      t.assert(s1.started - s0.started >= Math.min(3, steps), 'footstep sounds started');
    },
  },
  {
    // In-world (phase 2): survival mining by holding attack -> hit sounds exactly every 4 game ticks, one break
    // sound, nothing after the block is gone. (The first gap used to be 3 ticks.)
    name: 'audio-mining-rhythm', requires: ['audio', 'input', 'player', 'physics', 'raycast', 'interaction', 'world'],
    async run(t) {
      await gesture(t);
      await t.call('startWorld', { ...FLAT, mode: 'survival' });
      await t.call('setFlying', false);
      await t.call('waitTicks', 10);
      const p = await t.call('pos');
      const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
      await t.call('setBlock', x, y, z - 2, 'dirt');
      // kid scheme targets through the free cursor: put it in the screen centre (like a child's held mouse)
      await t.eval(() => { const i = window.__game.game.input; i.aim.x = 0; i.aim.y = 0; i.aimActive = true; });
      await t.call('lookAt', x + 0.5, y + 0.5, z - 1.5);
      await t.eval(() => window.__game.game.audio.recent(true));
      const b0 = await t.call('eventCount', 'block:broken');
      await t.eval(() => window.__game.game.input.setVirtual('attack', true));
      const broke = await t.waitFor((b0) => window.__game.eventCount('block:broken') > b0, b0, 5000);
      await t.eval(() => window.__game.game.input.setVirtual('attack', false));
      await t.call('sleep', 500);
      const log = await t.eval(() => window.__game.game.audio.recent(true));
      const hits = log.filter((e) => e.name.startsWith('block.hit.')).map((e) => e.tick);
      const breaks = log.filter((e) => e.name.startsWith('block.break.'));
      const gaps = hits.slice(1).map((h, i) => h - hits[i]);
      t.note('hits', { hits, gaps, breaks: breaks.map((e) => e.name) });
      t.assert(broke, 'dirt broke while holding attack');
      t.assert(hits.length >= 2 && gaps.every((g) => g === 4), `hit every 4 ticks (${gaps})`);
      t.assert(breaks.length === 1 && breaks[0].name === 'block.break.dirt', `one dirt break sound (${breaks.map((e) => e.name)})`);
      t.assert(hits.every((h) => h <= breaks[0].tick), 'no hit after the break');
    },
  },
  {
    // In-world (phase 2): the listener is the camera - in the third-person FRONT view the camera looks back at the
    // player, so a sound to the player's east is on the screen's left and must pan left.
    name: 'audio-listener-views', requires: ['audio', 'input', 'player', 'world'],
    async run(t) {
      await gesture(t);
      await t.call('startWorld', FLAT);
      await t.call('setLook', 0, -10);
      const pans = {};
      for (const view of [0, 1, 2]) {
        await t.eval((v) => { window.__game.game.player.view = v; }, view);
        await t.call('sleep', 450); // let a frame move the camera; and the cow.idle min gap pass
        pans[view] = await t.eval(() => {
          const G = window.__game, p = G.pos(), a = G.game.audio, n0 = a.stats().started;
          G.game.events.emit('mob:sound', { id: 4242, type: 'cow', kind: 'idle', x: p.x + 5, y: p.y + 1.6, z: p.z });
          return a.stats().started > n0 ? a.recent().slice(-1)[0].pan : null;
        });
      }
      await t.eval(() => { window.__game.game.player.view = 0; });
      t.note('pan', pans);
      t.assert(pans[0] > 0.3, `first person: east is right (${pans[0]})`);
      t.assert(pans[1] > 0.3, `third person back: east is right (${pans[1]})`);
      t.assert(pans[2] < -0.3, `third person front: east is on the screen's left (${pans[2]})`);
    },
  },
  {
    // In-world: animals make their voices (needs MOBS).
    name: 'audio-mob-voices', requires: ['audio', 'mobs', 'physics', 'world'],
    async run(t) {
      await gesture(t);
      await t.call('startWorld', FLAT);
      const p = await t.call('pos');
      for (const type of ['pig', 'cow', 'sheep', 'chicken']) await t.call('spawn', type, p.x + 3, p.y, p.z - 3);
      const heard = await t.waitFor(() => window.__game.eventCount('mob:sound') > 0, null, 30000);
      t.assert(heard, 'mobs emit mob:sound within 30 s');
      const s = await t.call('audioStats');
      t.assert(s.started > 0, 'and the audio lane voices them');
    },
  },
];
