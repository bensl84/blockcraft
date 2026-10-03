// OWNER LANE: FEATURE-AUDIO. Event bus -> sound mapping (SPEC §6 and §8.3 "Event mapping"). Other lanes never
// call the audio system directly; they emit their normal events and this file turns them into sounds.
// Pure with respect to WebAudio: it only calls the audio API object `a` (play / playBlock / stop / music
// helpers), so the unit tests drive it with a fake `a` and a real EventBus.

import { blockDef } from '../core/registry.js';
import { MOBS } from '../data/mobs.js';

const MINING_HIT_TICKS = 4;  // SPEC: hit sound every 4 ticks while mining
const EAT_MUNCH_TICKS = 4;
const EAT_MAX_TICKS = 40;    // eating takes 32 ticks; stop on our own if 'player:ate' never comes
const MOB_DEDUPE_SEC = 0.25;

/** Material sound type of a block id ('stone' when unknown). */
export function soundOfBlock(id) {
  const d = blockDef(id | 0);
  return d && d.sound ? d.sound : 'stone';
}

/** Voice name for a mob type (mobs.js `voice`, else the type itself). */
export function voiceOf(type) {
  const m = MOBS[type];
  return m && m.voice ? m.voice : type;
}

/**
 * Subscribe the audio system to the event bus.
 * @param {object} game
 * @param {object} a  {play(name, opts) -> voice|null, playBlock(kind, soundType, x, y, z, opts), stopVoice(v, fade),
 *                    music: {start(delay?), stop(fade?), setNight(bool), duck(level, sec)}, setMuffle(bool),
 *                    applySettings(), now() -> seconds, rand() -> [0,1)}
 * @returns {{tick():void, reset():void, dispose():void, state:object}}
 */
export function wireAudioEvents(game, a) {
  const offs = [];
  const on = (name, fn) => offs.push(game.events.on(name, fn));
  const st = {
    mining: null,          // {x, y, z, id, last: tick of the last hit sound}
    tick: 0,               // own tick counter (fallback when game.tickCount is missing, e.g. unit tests)
    eating: null,          // {ticks, item}
    fuses: new Map(),      // tnt entity id -> voice
    lastMob: new Map(),    // `${id}:${kind}` -> time
    inWater: false,
    eyeInWater: false,
  };
  const pos = (e, dy = 0.5) => (e && Number.isFinite(e.x) ? { x: e.x + 0.5, y: e.y + dy, z: e.z + 0.5 } : {});
  const at = (e, extra) => (e && Number.isFinite(e.x) ? { x: e.x, y: e.y, z: e.z, ...extra } : { ...extra });
  const kidSafe = () => { const m = game.meta; return !m || m.mode === 'creative' || m.difficulty === 'peaceful'; };
  const isMob = (type) => !!MOBS[type];
  // the game tick number: interaction emits 'block:mining' earlier in the SAME tick as our tick(), so counting from
  // the event's tick keeps the hit rhythm exactly 4 ticks (a private counter would make the first gap 3)
  const tickNow = () => (Number.isFinite(game.tickCount) ? game.tickCount : st.tick);
  const mobOnce = (id, kind) => {
    const key = `${id}:${kind}`;
    const now = a.now();
    const last = st.lastMob.get(key);
    if (last !== undefined && now - last < MOB_DEDUPE_SEC) return false;
    st.lastMob.set(key, now);
    if (st.lastMob.size > 256) st.lastMob.clear();
    return true;
  };

  /* ---------------- blocks ---------------- */
  on('block:broken', (e) => {
    if (!e || e.by === 'explosion') return; // the explosion sound covers its blocks (up to 600 of them)
    const p = pos(e);
    a.playBlock('break', soundOfBlock(e.id), p.x, p.y, p.z, { volume: e.by === 'player' || e.by === 'test' ? 1 : 0.7 });
    if (st.mining && st.mining.x === e.x && st.mining.y === e.y && st.mining.z === e.z) st.mining = null;
  });
  on('block:placed', (e) => {
    if (!e) return;
    const p = pos(e);
    a.playBlock('place', soundOfBlock(e.id), p.x, p.y, p.z);
  });
  on('block:mining', (e) => {
    if (!e) return;
    const m = st.mining;
    if (!m || m.x !== e.x || m.y !== e.y || m.z !== e.z) {
      st.mining = { x: e.x, y: e.y, z: e.z, id: e.id, last: tickNow() };
      const p = pos(e);
      a.playBlock('hit', soundOfBlock(e.id), p.x, p.y, p.z); // immediate feedback (< 50 ms)
    }
  });
  on('block:miningStop', () => { st.mining = null; });

  /* ---------------- player ---------------- */
  on('player:step', (e) => {
    if (!e) return;
    const type = e.sound || soundOfBlock(e.blockId);
    if (type === 'none') return;
    a.playBlock('step', type, e.x, e.y, e.z);
  });
  on('player:land', (e) => {
    if (!e) return;
    const fd = e.fallDistance || 0;
    const type = soundOfBlock(e.blockId);
    if (fd >= 5) a.play('player.bigfall', at(e));
    if (type !== 'none' && type !== 'liquid') a.playBlock(fd >= 1 ? 'land' : 'step', type, e.x, e.y, e.z);
  });
  on('player:hurt', (e) => { if (!e || e.cause !== 'void') a.play('player.hurt'); });
  on('player:water', (e) => {
    if (!e) return;
    const p = game.player;
    if (e.inWater && !st.inWater) {
      const falling = p && Number.isFinite(p.vy) && p.vy < -0.15;
      if (falling) a.play('player.splash', p ? { x: p.x, y: p.y, z: p.z } : {});
      else a.play('player.swim');
    }
    st.inWater = !!e.inWater;
    if (!!e.eyeInWater !== st.eyeInWater) { st.eyeInWater = !!e.eyeInWater; a.setMuffle(st.eyeInWater); }
  });
  on('player:teleport', (e) => {
    if (!e || e.reason === 'test' || e.reason === 'load') return;
    if (e.reason === 'void' || e.reason === 'respawn' || e.reason === 'stuck' || e.reason === 'home') a.play('ui.whoosh');
  });
  on('player:eat', (e) => {
    if (!st.eating) { st.eating = { ticks: 0, item: e && e.item }; a.play('player.eat'); }
    else st.eating.ticks = Math.min(st.eating.ticks, EAT_MAX_TICKS - 8); // still eating: keep the loop alive
  });
  on('player:ate', () => { if (st.eating) { st.eating = null; a.play('player.burp', { volume: 0.7 }); } });
  on('player:hotbar', () => { if (game.state === 'playing') a.play('ui.tick'); });
  on('player:death', () => { st.eating = null; st.mining = null; });

  /* ---------------- items ---------------- */
  on('item:pickup', () => a.play('item.pop'));
  on('item:drop', (e) => a.play('item.drop', at(e)));
  on('item:broken', () => a.play('item.break'));

  /* ---------------- entities and mobs ---------------- */
  on('entity:spawn', (e) => {
    if (!e || !isMob(e.type)) return;
    if (e.reason === 'spawn' || e.reason === 'breed' || e.reason === undefined) a.play('entity.pop', at(e, { volume: e.reason === 'breed' ? 1 : 0.6 }));
  });
  on('entity:remove', (e) => {
    if (!e) return;
    const fuse = st.fuses.get(e.id);
    if (fuse) { a.stopVoice(fuse, 0.08); st.fuses.delete(e.id); }
    if (isMob(e.type) && (e.reason === 'dead' || e.reason === 'despawn')) a.play('entity.poof', at(e, { volume: 0.7 }));
  });
  on('mob:hurt', (e) => { if (e && mobOnce(e.id, 'hurt')) a.play(`${voiceOf(e.type)}.hurt`, at(e)); });
  on('mob:death', (e) => { if (e && mobOnce(e.id, 'death')) a.play(`${voiceOf(e.type)}.death`, at(e)); });
  on('mob:sound', (e) => {
    if (!e) return;
    const voice = voiceOf(e.type);
    const kind = e.kind || 'idle';
    const o = at(e);
    switch (kind) {
      case 'idle': {
        const r = a.rand();
        if (voice === 'wolf') a.play(r < 0.3 ? 'wolf.bark' : 'wolf.idle', o);
        else if (voice === 'cat') a.play(r < 0.25 ? 'cat.purr' : 'cat.idle', o);
        else if (voice === 'horse') a.play(r < 0.3 ? 'horse.neigh' : 'horse.idle', o);
        else a.play(`${voice}.idle`, o);
        break;
      }
      case 'hurt': case 'death':
        if (mobOnce(e.id, kind)) a.play(`${voice}.${kind}`, o);
        break;
      case 'step':
        if (voice === 'skeleton' || voice === 'spider') a.play(`${voice}.step`, o);
        else {
          const under = game.world && game.world.getBlock ? soundOfBlock(game.world.getBlock(Math.floor(e.x), Math.floor(e.y - 0.2), Math.floor(e.z))) : 'grass';
          if (under !== 'none' && under !== 'liquid') a.playBlock('step', under, e.x, e.y, e.z, { volume: 0.45 });
        }
        break;
      case 'eat': a.play('mob.eat', o); break;
      case 'tame': a.play('mob.love', o); break;
      case 'angry': a.play(voice === 'wolf' ? 'wolf.angry' : `${voice}.hurt`, { ...o, pitch: 0.85 }); break;
      case 'hiss': a.play(voice === 'spider' ? 'spider.idle' : 'creeper.hiss', o); break;
      case 'whine': a.play('wolf.whine', o); break;
      case 'bark': a.play('wolf.bark', o); break;
      default: a.play(`${voice}.${kind}`, o);
    }
  });
  for (const ev of ['mob:tamed', 'mob:bred', 'mob:love']) on(ev, (e) => a.play('mob.love', at(e)));
  on('mob:sheared', (e) => a.play('shear', at(e)));

  /* ---------------- world mechanics ---------------- */
  on('explosion', (e) => {
    a.play('explosion', at(e, { kid: kidSafe(), prio: 2 }));
    a.music.duck(0.3, 1);
  });
  on('tnt:primed', (e) => {
    if (!e) return;
    const v = a.play('tnt.fuse', at(e, { dur: Math.max(0.5, (e.fuse || 80) / 20) }));
    if (v && e.id !== undefined) st.fuses.set(e.id, v);
  });
  on('door:toggle', (e) => { if (e) a.play(e.open ? 'door.open' : 'door.close', at(e, { pitch: e.kind === 'gate' ? 1.25 : 1, x: e.x + 0.5, y: e.y + 0.5, z: e.z + 0.5 })); });
  on('bonemeal', (e) => a.play('bonemeal', at(e, e ? { x: e.x + 0.5, y: e.y + 0.5, z: e.z + 0.5 } : {})));
  on('sleep:start', () => a.play('ui.sleep'));

  /* ---------------- UI and kid helpers ---------------- */
  on('ui:click', () => a.play('ui.click'));
  on('ui:open', (e) => {
    const s = e && e.screen;
    const o = e && e.opts && Number.isFinite(e.opts.x) ? { x: e.opts.x + 0.5, y: e.opts.y + 0.5, z: e.opts.z + 0.5 } : {};
    if (s === 'chest') a.play('chest.open', o);
    else a.play('ui.open');
  });
  on('ui:close', (e) => { if (e && e.screen === 'chest') a.play('chest.close'); else a.play('ui.close'); });
  on('craft', () => a.play('ui.success'));
  on('smelt', () => a.play('ui.success', { volume: 0.7 }));
  on('kid:home', () => a.play('ui.whoosh'));
  on('kid:rescue', () => a.play('ui.whoosh'));
  on('kid:undo', () => a.play('ui.undo'));
  on('hint', () => a.play('ui.hint'));
  on('sound', (e) => { if (e && e.name) a.play(e.name, e); });

  /* ---------------- settings, world lifecycle, music mood ---------------- */
  on('settings:changed', (e) => { if (e && /volume|muted/i.test(e.key)) a.applySettings(); });
  on('world:ready', () => { a.music.setNight(isNightNow(game)); a.music.start(); });
  on('world:exit', () => { reset(); a.music.stop(1.5); });
  on('game:state', (e) => { if (e && e.to === 'title') a.music.stop(1.5); });
  for (const n of ['dusk', 'night', 'midnight']) on('time:' + n, () => a.music.setNight(true));
  for (const n of ['dawn', 'day', 'noon']) on('time:' + n, () => a.music.setNight(false));
  on('time:set', (e) => a.music.setNight(isNightTime(e && e.dayTime)));

  function reset() {
    st.mining = null;
    st.eating = null;
    for (const v of st.fuses.values()) a.stopVoice(v, 0.05);
    st.fuses.clear();
    st.lastMob.clear();
    st.inWater = false;
    if (st.eyeInWater) { st.eyeInWater = false; a.setMuffle(false); }
  }

  return {
    state: st,
    /** 20 TPS (only while playing): repeating mining hits and eating munches. */
    tick() {
      st.tick++;
      const m = st.mining;
      if (m) {
        if (tickNow() - m.last >= MINING_HIT_TICKS) {
          m.last = tickNow();
          const id = game.world && game.world.getBlock ? game.world.getBlock(m.x, m.y, m.z) : m.id;
          if (!id) st.mining = null; // the block is gone (e.g. creative instant break without an event)
          else a.playBlock('hit', soundOfBlock(id), m.x + 0.5, m.y + 0.5, m.z + 0.5);
        }
      }
      const eat = st.eating;
      if (eat) {
        eat.ticks++;
        if (eat.ticks >= EAT_MAX_TICKS) st.eating = null;
        else if (eat.ticks % EAT_MUNCH_TICKS === 0) a.play('player.eat');
      }
    },
    reset,
    dispose() { for (const off of offs) off(); offs.length = 0; },
  };
}

/** Night for music mood: dusk (12000) .. dawn (23000). */
export function isNightTime(t) { return Number.isFinite(t) && t >= 12000 && t < 23000; }
function isNightNow(game) { return !!(game.time && isNightTime(game.time.dayTime)); }
