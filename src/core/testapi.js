// OWNER: LEAD (integration). window.__game - the stable DEBUG/TEST API that tools/smoke.mjs and every
// lane's playtests use. SPEC §11. Additive changes only (never rename/remove a member).
//
// Conventions: angles in DEGREES here (yaw 0 = north/-Z, + = turn left; pitch + = up). Promises resolve
// with plain JSON-safe values. Every member works (returns a safe value) even while lanes are stubs.

import { listStubs } from './stubs.js';
import { ID, blockName, idOf } from './registry.js';
import { getItem } from '../data/items.js';
import { DEG, clamp } from './math.js';
import { PHYS } from './constants.js';

export function installTestApi(game) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitTicks = (n) => new Promise((resolve) => {
    const target = game.tickCount + n;
    const start = performance.now();
    const check = () => (game.tickCount >= target || performance.now() - start > n * 50 * 4 + 2000 ? resolve(game.tickCount) : setTimeout(check, 10));
    check();
  });
  const waitFrames = (n) => new Promise((resolve) => {
    const target = game.frameCount + n;
    const start = performance.now();
    const check = () => (game.frameCount >= target || performance.now() - start > 5000 ? resolve(game.frameCount) : setTimeout(check, 5));
    check();
  });
  const jsonSafe = (v) => {
    try {
      const seen = new WeakSet();
      return JSON.parse(JSON.stringify(v, (k, x) => {
        if (x && typeof x === 'object') {
          if (seen.has(x)) return undefined;
          seen.add(x);
          if (x.isObject3D || x.isMaterial || x.isBufferGeometry || ArrayBuffer.isView(x)) return undefined;
        }
        return x;
      }));
    } catch { return null; }
  };
  const target = () => {
    const t = game.interaction && game.interaction.target;
    return t ? { x: t.x, y: t.y, z: t.z, face: t.face, nx: t.nx, ny: t.ny, nz: t.nz, name: blockName(t.id), state: t.state, dist: t.dist } : null;
  };
  const centerAim = () => { if (game.input) { game.input.aim.x = 0; game.input.aim.y = 0; game.input.aimActive = true; } };
  const manualLook = () => { if (game.input && game.input.noteManualLook) game.input.noteManualLook(); };
  /** Player state snapshot (pos() and recordTicks()). */
  const snapshot = () => {
    const p = game.player;
    return {
      tick: game.tickCount, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, yaw: p.yaw / DEG, pitch: p.pitch / DEG,
      onGround: !!p.onGround, collidedH: !!p.collidedH, flying: !!p.flying, sneaking: !!p.sneaking, sprinting: !!p.sprinting,
      inWater: !!p.inWater, eyeInWater: !!p.eyeInWater, inLava: !!p.inLava, onLadder: !!p.onLadder,
      health: p.health, food: p.food, air: p.air, fallDistance: p.fallDistance, view: p.view,
    };
  };
  /**
   * World point -> NDC through the first-person camera at the player's (interpolated) eye, using the camera's
   * current fov/aspect. {x, y, onScreen, depth}. Matches interaction's cursor ray (unproject of input.aim).
   */
  const worldToNdc = (x, y, z) => {
    const p = game.player, e = p.getEyePos({}, true);
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), sp = Math.sin(p.pitch), cp = Math.cos(p.pitch);
    const depth = dx * (-sy * cp) + dy * sp + dz * (-cy * cp);          // along the look vector
    const cx = dx * cy + dz * (-sy);                                      // along camera right
    const cu = dx * (sy * sp) + dy * cp + dz * (cy * sp);                 // along camera up
    const cam = game.renderer && game.renderer.camera;
    const t = Math.tan(((cam ? cam.fov : game.settings.fov) * DEG) / 2);
    const aspect = cam && cam.aspect ? cam.aspect : (window.innerWidth / Math.max(1, window.innerHeight));
    if (depth <= 1e-6) return { x: 0, y: 0, onScreen: false, depth };
    const nx = cx / (depth * t * aspect), ny = cu / (depth * t);
    return { x: nx, y: ny, onScreen: Math.abs(nx) <= 1 && Math.abs(ny) <= 1, depth };
  };
  /** Turn the player to look at a world point (eye -> point). Returns {yaw, pitch} in degrees. */
  const lookAtNow = (x, y, z) => {
    const p = game.player, e = p.getEyePos({}, false);
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -PHYS.PITCH_LIMIT, PHYS.PITCH_LIMIT);
    manualLook();
    return { yaw: p.yaw / DEG, pitch: p.pitch / DEG };
  };

  const api = {
    ready: false,
    worldReady: false,
    version: game.version,
    errors: game.errors,
    game,

    stubs: () => listStubs(),
    state: () => game.state,

    startWorld: async (opts = {}) => { await game.startWorld(opts); return true; },
    exitToTitle: async () => { await game.exitToTitle(); return true; },

    // ---------------- player ----------------
    /** {x,y,z,yaw,pitch,onGround,flying,inWater,health,food, vx,vy,vz,sneaking,sprinting,eyeInWater,inLava,onLadder,air,fallDistance,view,collidedH,tick} */
    pos: () => snapshot(),
    teleport: (x, y, z) => { game.player.teleport(x, y, z, 'test'); return true; },
    /**
     * Absolute look (degrees). Resets the kid auto-pitch timer so it does not fight the test, and re-centres the
     * kid cursor so the target is the block in the middle of the screen (use aimAt/tapAt for an off-centre aim).
     */
    setLook: (yawDeg, pitchDeg) => { game.player.yaw = yawDeg * DEG; game.player.pitch = pitchDeg * DEG; manualLook(); centerAim(); return true; },
    /** Look at a world point (kid cursor re-centred); waits 2 frames so targeting updates. -> {yaw, pitch} degrees */
    lookAt: async (x, y, z) => { const r = lookAtNow(x, y, z); centerAim(); await waitFrames(2); return r; },
    /** Put the kid cursor (input.aim, aimActive) on a world point without turning. -> {x, y, onScreen, target} */
    aimAt: async (x, y, z) => {
      const n = worldToNdc(x, y, z);
      if (game.input) { game.input.aim.x = n.x; game.input.aim.y = n.y; game.input.aimActive = true; }
      await waitFrames(2);
      return { x: n.x, y: n.y, onScreen: n.onScreen, target: target() };
    },
    /** World point -> NDC (no side effects). */
    worldToNdc: (x, y, z) => worldToNdc(x, y, z),
    /** Kid tap at a screen point (NDC): aim there + one 'use'. Resolves after 2 ticks with the target. */
    tapAt: async (ndcX, ndcY) => { game.input.tap(ndcX, ndcY); await waitTicks(2); return target(); },
    /** Kid hold at a screen point (NDC) for ms: aim there + hold 'attack'. */
    holdAt: async (ndcX, ndcY, ms = 400) => { game.input.hold(ndcX, ndcY, ms); await sleep(ms); await waitTicks(1); return true; },
    /**
     * Look at an entity's centre, aim at it and 'use' (feed, shear, tame, dye, ride) or 'attack' it.
     * -> {ok, targeted (interaction picked this entity), health, data}
     */
    interactEntity: async (id, kind = 'use') => {
      const e = game.entities.get(id);
      if (!e) return { ok: false, reason: 'no entity' };
      lookAtNow(e.x, e.y + e.height / 2, e.z);
      centerAim();
      await waitFrames(2);
      const te = game.interaction && game.interaction.targetEntity;
      const targeted = !!(te && te.entity && te.entity.id === id);
      if (kind === 'attack') { game.input.setVirtual('attack', true); await waitTicks(2); game.input.setVirtual('attack', false); }
      else game.input.press('use');
      await waitTicks(2);
      return { ok: true, targeted, health: e.health, data: jsonSafe(e.data) };
    },
    look: async (dyawDeg, dpitchDeg) => { game.input.addLook(dyawDeg * DEG, dpitchDeg * DEG); await waitFrames(2); return api.pos(); },
    /** Hold a movement vector (forward, right in -1..1) for ms of real time, then release. */
    move: async (forward, right, ms) => {
      game.input.setMoveVector(forward, right);
      await sleep(ms);
      game.input.setMoveVector(0, 0);
      await waitTicks(1);
      return api.pos();
    },
    jump: async () => { game.input.setVirtual('jump', true); await waitTicks(2); game.input.setVirtual('jump', false); return api.pos(); },
    /** Hold any action for ms (e.g. 'sneak', 'sprint', 'attack'). */
    hold: async (action, ms) => { game.input.setVirtual(action, true); await sleep(ms); game.input.setVirtual(action, false); return true; },
    press: (action) => { game.input.press(action); return true; },
    setFlying: (on) => { game.player.setFlying(!!on); return !!game.player.flying; },

    // ---------------- world ----------------
    getBlock: (x, y, z) => blockName(game.world.getBlock(x, y, z)),
    getBlockId: (x, y, z) => game.world.getBlock(x, y, z),
    getState: (x, y, z) => game.world.getState(x, y, z),
    getLight: (x, y, z) => ({ sky: game.world.getSkyLight(x, y, z), block: game.world.getBlockLight(x, y, z) }),
    setBlock: (x, y, z, name, state = 0) => game.world.setBlock(x, y, z, typeof name === 'number' ? name : idOf(name), state, { cause: 'test' }),
    surfaceY: (x, z) => game.world.getSurfaceY(x, z),
    target,
    /** Aim at screen centre and hold attack until the targeted block changes (or timeout). */
    breakTarget: async (timeoutMs = 4000) => {
      centerAim();
      await waitFrames(2);
      const t = target();
      if (!t) return { ok: false, reason: 'no target' };
      game.input.setVirtual('attack', true);
      const start = performance.now();
      let after = t.name;
      while (performance.now() - start < timeoutMs) {
        await sleep(25);
        after = blockName(game.world.getBlock(t.x, t.y, t.z));
        if (after !== t.name) break;
      }
      game.input.setVirtual('attack', false);
      await waitTicks(1);
      return { ok: after !== t.name, x: t.x, y: t.y, z: t.z, before: t.name, after };
    },
    /** Aim at screen centre and press use once; reports the block that appeared next to the target. */
    placeTarget: async (timeoutMs = 2000) => {
      centerAim();
      await waitFrames(2);
      const t = target();
      if (!t) return { ok: false, reason: 'no target' };
      const px = t.x + t.nx, py = t.y + t.ny, pz = t.z + t.nz;
      const before = blockName(game.world.getBlock(px, py, pz));
      game.input.setVirtual('use', true);
      const start = performance.now();
      let after = before;
      while (performance.now() - start < timeoutMs) {
        await sleep(25);
        after = blockName(game.world.getBlock(px, py, pz));
        if (after !== before) break;
      }
      game.input.setVirtual('use', false);
      await waitTicks(1);
      return { ok: after !== before, x: px, y: py, z: pz, before, placed: after };
    },

    // ---------------- inventory / UI ----------------
    selectSlot: (i) => { game.inventory.selectSlot(i); return game.inventory.selected; },
    selected: () => { const s = game.inventory.getSelected(); return { slot: game.inventory.selected, item: s ? s.item : null, count: s ? s.count : 0 }; },
    give: (item, count = 1) => { if (!getItem(item)) throw new Error('unknown item ' + item); return game.inventory.add({ item, count }); },
    inventory: () => game.inventory.slots.map((s) => (s ? { item: s.item, count: s.count } : null)),
    setSlot: (i, item, count = 1) => { game.inventory.set(i, item ? { item, count } : null); return true; },
    openInventory: async () => {
      game.events.emit('input:action', { action: 'inventory', down: true, source: 'test' });
      game.events.emit('input:action', { action: 'inventory', down: false, source: 'test' });
      await waitFrames(2);
      return game.ui.current;
    },
    openScreen: async (name, opts = {}) => { game.ui.open(name, opts); await waitFrames(2); return game.ui.current; },
    closeUI: async () => { game.ui.close(); await waitFrames(1); return game.ui.current; },
    uiOpen: () => game.ui.current,

    // ---------------- time / mode / rules ----------------
    setTime: (t) => { game.time.setTime(t); return game.time.dayTime; },
    getTime: () => game.time.dayTime,
    setMode: (m) => { game.setMode(m); return game.meta ? game.meta.mode : null; },
    setDifficulty: (d) => { game.setDifficulty(d); return game.meta ? game.meta.difficulty : null; },
    setRule: (k, v) => { game.setRule(k, v); return game.meta ? game.meta.rules[k] : null; },
    meta: () => jsonSafe(game.meta),

    // ---------------- entities ----------------
    spawn: (type, x, y, z, opts = {}) => { const e = game.entities.spawn(type, x, y, z, opts); return e ? e.id : null; },
    entities: () => game.entities.all().map((e) => ({ id: e.id, type: e.type, x: e.x, y: e.y, z: e.z, health: e.health, data: jsonSafe(e.data) })),

    // ---------------- perf / stats ----------------
    stats: () => {
      const r = game.renderer && game.renderer.getStats ? game.renderer.getStats() : {};
      const w = game.world && game.world.stats ? game.world.stats() : {};
      return {
        fps: Math.round(game.perf.fps * 10) / 10, frameMs: round2(game.perf.frameMs), workMs: round2(game.perf.workMs), tickMs: round2(game.perf.tickMs),
        ticks: game.tickCount, frames: game.frameCount,
        chunksLoaded: w.columns || 0, columnsMeshed: w.columnsMeshed || 0, renderDistance: w.renderDistance || 0,
        sectionMeshes: r.sectionMeshes || 0, drawCalls: r.drawCalls || 0, triangles: r.triangles || 0,
        geometries: r.geometries || 0, textures: r.textures || 0, programs: r.programs || 0, dpr: r.dpr || 0,
        entities: game.entities ? game.entities.count() : 0,
        gpu: game.renderer && game.renderer.gpu ? game.renderer.gpu.renderer : 'unknown',
        textureLayers: game.textures ? game.textures.count : 0,
      };
    },
    setRenderDistance: (n) => { game.world.setRenderDistance(n); return game.world.renderDistance; },
    /** Render a small frame and measure it: {uniqueColors, meanLuma, stdLuma} (detects blank/one-colour screens). */
    pixelStats: async (w = 96, h = 54) => {
      const url = game.renderer && game.renderer.captureThumbnail ? game.renderer.captureThumbnail(w, h) : null;
      if (!url) return { uniqueColors: 0, meanLuma: 0, stdLuma: 0 };
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, w, h).data;
      const colors = new Set(); let sum = 0, sum2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        colors.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += l; sum2 += l * l;
      }
      const n = d.length / 4, mean = sum / n;
      return { uniqueColors: colors.size, meanLuma: Math.round(mean), stdLuma: Math.round(Math.sqrt(Math.max(0, sum2 / n - mean * mean))) };
    },
    /** Lose and restore the WebGL context (renderer must recover). */
    contextLossTest: async () => {
      const t = game.renderer && game.renderer.three;
      if (!t || !t.forceContextLoss) return false;
      t.forceContextLoss();
      await sleep(300);
      t.forceContextRestore();
      await waitFrames(10);
      return true;
    },
    waitTicks,
    waitFrames,
    sleep,
    /** Run n ticks synchronously (crops, babies, furnaces) then one frame. Only while playing. -> tickCount */
    runTicks: (n) => game.stepTicks(n),
    /** Fix game.rand() (gameplay rolls: drops, taming, AI, spawns, growth) for reproducible tests. */
    setRandomSeed: (seed) => { game.setRandomSeed(seed); return true; },
    /**
     * Poll until predicate is truthy (true) or timeout (false). predicate: function (api, game) => bool, or a
     * source string evaluated with `api` and `game` in scope. The page CSP blocks compiling strings in the page,
     * so the smoke harness intercepts t.call('waitFor', src, ms) and polls from Node instead.
     */
    waitFor: async (predicate, timeoutMs = 5000) => {
      let fn = predicate;
      if (typeof predicate === 'string') {
        try { fn = new Function('api', 'game', `return (${predicate});`); } catch {
          throw new Error('waitFor: the page CSP blocks string predicates here - use t.call("waitFor", src, ms) from the smoke harness or pass a function');
        }
      }
      const start = performance.now();
      while (performance.now() - start < timeoutMs) {
        try { if (fn(api, game)) return true; } catch { /* keep polling */ }
        await sleep(25);
      }
      return false;
    },
    /**
     * Per-tick player states for the next n ticks: [{tick, x,y,z, vx,vy,vz, onGround, ...}] (physics asserts).
     * opts.sync: run the ticks synchronously (runTicks) instead of waiting for real time.
     */
    recordTicks: (n, opts = {}) => new Promise((resolve) => {
      const out = [];
      if (opts.sync) {
        const rec = () => out.push(snapshot());
        game.afterTick.add(rec);
        try { game.stepTicks(n); } finally { game.afterTick.delete(rec); }
        resolve(out);
        return;
      }
      const start = performance.now();
      let timer = 0;
      const done = () => { game.afterTick.delete(rec); clearInterval(timer); resolve(out); };
      const rec = () => { out.push(snapshot()); if (out.length >= n) done(); };
      game.afterTick.add(rec);
      timer = setInterval(() => { if (performance.now() - start > n * 200 + 2000) done(); }, 100);
    }),
    /** Audio voices right now: {voices, byName} (AUDIO lane; zeros while it is a stub). */
    audioStats: () => (game.audio && game.audio.stats ? game.audio.stats() : { voices: 0, byName: {} }),

    // ---------------- events ----------------
    events: (name, limit = 20) => game.events.recent(name, limit).map((e) => ({ tick: e.tick, payload: jsonSafe(e.payload) })),
    eventCount: (name) => game.events.counts.get(name) || 0,

    // ---------------- persistence / misc ----------------
    save: async () => (game.save ? game.save.saveNow('test') : false),
    listWorlds: async () => (game.save ? jsonSafe(await game.save.listWorlds()) : []),
    settings: () => jsonSafe(game.settings),
    setSetting: (k, v) => { game.setSetting(k, v); return game.settings[k]; },
    blockId: (name) => ID[name],
  };
  window.__game = api;
  return api;
}

function round2(v) { return Math.round((v || 0) * 100) / 100; }
