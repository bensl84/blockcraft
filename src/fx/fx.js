// OWNER LANE: FEATURE-FX (visual polish). API FROZEN (SPEC §8.7) - this file wires the FX modules together:
//   particles.js  pooled instanced particles (block break patches, smoke, explosion, hearts, sparkles, ...)
//   itemmesh.js   cached 3D item meshes (dropped items, held items) - makeItemMesh / disposeItemMesh
//   avatar.js     first-person arm + held item (swing, equip, place, bob) and the third-person character
//   blockfx.js    mining crack overlay and the kid ghost block
//   overlays.js   underwater / lava tint, red hurt vignette (flash-safe), fades, kid hold ring
//   weather.js    rain and snow (P2)
//   ../render/celestial.js  sun, 8 moon phases, stars, drifting blocky clouds
//
// Everything tolerates stub lanes: FX samples the renderer's array texture when it exists and its own fallback
// otherwise, reads frozen fields (player.*, interaction.mining/target, input.aim*) and listens to SPEC §6 events.
// New events: 'fx:weather' {rain, snow} when the target rain strength changes.


import { B_LIQUID, ID, blockDef, getSelectionBoxes } from '../core/registry.js';
import { MOBS } from '../data/mobs.js';
import { mulberry32 } from '../core/math.js';
import { getTexturePixels } from '../textures/textures.js';
import { ArrayTextureRef, createAtlasMaterial, createColorMaterial, makeLightHook, sharedUniforms } from './fxmat.js';
import { MAX_PARTICLES, ParticleMesh, ParticleSim } from './particles.js';
import { ItemMeshFactory } from './itemmesh.js';
import { PlayerAvatar, SkinTexture, ViewModel } from './avatar.js';
import { CrackOverlay, GhostBlock } from './blockfx.js';
import { Overlays } from './overlays.js';
import { Weather } from './weather.js';
import { Celestial } from '../render/celestial.js';

const TORCH_ID = ID.torch, FIRE_ID = ID.fire, LAVA_ID = ID.lava, LIT_FURNACE_ID = ID.furnace_lit;
const AMBIENT_SAMPLES = 400;   // random cells per tick within AMBIENT_R (torch flames, fire smoke, lava pops)
const AMBIENT_R = 12;

/** @returns {object} FX system (game.fx) */
export function createFxSystem(game) {
  let ready = false;
  let texRef, shared, hook, sim, pmesh, items, skin, viewModel, avatar, crack, ghost, overlays, weather, celestial;
  let worldMats, vmMats;
  const ambientRng = mulberry32(0xa3b1e7);
  const tntTracked = new Map();     // entity id -> fuse ticks seen
  const mobPos = new Map();         // entity id -> [x, y, z, h] (death poof position after removal)
  const deathPos = new Map();
  let lastExternalFade = -1e9;
  let prevInWater = false;
  const viewer = { x: 0, y: 0, z: 0 };
  const tmpEye = { x: 0, y: 0, z: 0 }, tmpDir = { x: 0, y: 0, z: 0 };

  const fx = {
    name: 'fx',

    /** P2 weather state the renderer reads: {rain 0..1, target, snow}. */
    weather: { rain: 0, target: 0, snow: false },

    init() { setup(); },

    tick() {
      if (!ready || !game.meta) return;
      const w = game.world;
      sim.tick(w, game.tickCount);
      weather.tick(fx);
      ambientTick(w);
      trackEntities();
      const p = game.player;
      // breathing bubbles while the eye is under water
      if (p && p.eyeInWater && game.tickCount % 5 === 0) {
        p.getEyePos(tmpEye); p.getLookDir(tmpDir);
        sim.spawn('bubble', tmpEye.x + tmpDir.x * 0.6, tmpEye.y - 0.1, tmpEye.z + tmpDir.z * 0.6, { count: 1, spread: 0.15 }, w);
      }
      // dust from the face being mined
      const m = game.interaction && game.interaction.mining;
      const t = game.interaction && game.interaction.target;
      if (m && t && t.x === m.x && t.y === m.y && t.z === m.z && game.tickCount % 4 === 0) hitParticles(t);
    },

    frame(g, dt, alpha) {
      if (!ready) return;
      try { texRef.update(); } catch (err) { game.reportError(err, 'fx.texture'); }
      const cam = game.renderer && game.renderer.camera;
      if (cam) { viewer.x = cam.position.x; viewer.y = cam.position.y; viewer.z = cam.position.z; sim.viewer = viewer; }
      attachAll();
      pmesh.update(game.state === 'playing' ? alpha : 1);
      viewModel.update(dt, alpha);
      avatar.update(dt);
      crack.update((stage) => (game.textures ? game.textures.layer('crack_' + stage) : 0));
      ghost.update(dt);
      weather.update(dt);
      fx.weather.rain = weather.state.rain; fx.weather.target = weather.state.target; fx.weather.snow = weather.state.snow;
      celestial.update(dt, weather.state.rain);
      updateOverlays();
    },

    /**
     * Spawn particles. kind: 'block'|'smoke'|'explosion'|'heart'|'sparkle'|'splash'|'bubble'|'crit'|'angry'|'poof'|
     * 'flame' (+ 'item' crumbs with opts.colors or opts.item, 'drip', 'note').
     * opts: {count, id, state (for 'block'), spread, vx, vy, vz, color [r,g,b] 0..1, size}. Returns the number spawned.
     */
    spawnParticles(kind, x, y, z, opts = {}) {
      if (!ready) setup();
      if (kind === 'item' && opts.item && !opts.colors) opts = { ...opts, colors: itemColors(opts.item) };
      return sim.spawn(kind, x, y, z, opts, game.world);
    },

    /** Break burst for a block (called on 'block:broken' by fx itself; exposed for mechanics/tests). */
    blockBreakParticles(x, y, z, id, state = 0) {
      if (!ready) setup();
      return sim.blockBreak(Math.floor(x), Math.floor(y), Math.floor(z), id, state, game.world);
    },

    /**
     * A small Object3D showing an item: block items as a mini block, flat items as an extruded 16x16 sprite.
     * Origin = bottom centre; ~0.25 blocks (blocks) / ~0.5 wide (flat items). Caller adds it via
     * renderer.addObject and must call disposeItemMesh() when done. Geometry is CACHED per item key and SHARED;
     * disposeItemMesh() releases the Object3D, never the shared geometry. World light is applied per draw.
     */
    makeItemMesh(itemKey) {
      if (!ready) setup();
      return items.make(itemKey);
    },
    disposeItemMesh(obj) { if (items) items.dispose(obj); },

    /** Full-screen fade (0..1 opacity target) e.g. sleeping, home teleport. Resolves when reached. */
    fade(to, ms = 500) {
      if (!ready) setup();
      lastExternalFade = performance.now();
      return overlays.fade(to, ms);
    },

    /** Brief red damage vignette (flash-safe: at most 3 per second). The hurt camera tilt belongs to the player lane. */
    hurtFlash() { if (!ready) setup(); return overlays.hurtFlash(); },

    /** P2: set the rain strength target 0..1 (eases in/out). Snow replaces rain in snowy biomes. */
    setWeather(rain) { if (!ready) setup(); weather.set(rain); return weather.state.target; },

    /** Live counters for tests and the debug overlay. */
    stats() {
      if (!ready) return { particles: 0 };
      return {
        particles: sim.count, maxParticles: MAX_PARTICLES, spawned: sim.spawned,
        itemMeshesLive: items.live, itemGeometries: items.cache.size,
        crack: crack.mesh.visible ? crack.stage : -1, ghost: ghost.mesh.visible ? { ...ghost.placement } : null,
        viewModel: viewModel.root.visible, heldItem: viewModel.itemKey, playerModel: avatar.mesh.visible,
        underwater: overlays.underwater, flashes: overlays.flashes, fade: overlays.fadeLevel,
        sky: { ...celestial.state }, clouds: celestial.clouds.visible, cloudQuads: celestial.cloudQuads, stars: celestial.starCount,
        weather: { ...weather.state }, ring: !!overlays.ringState,
      };
    },

    /** Internals for tests/debugging (not a stable API). */
    get debug() { return { sim, pmesh, items, viewModel, avatar, crack, ghost, overlays, weather, celestial, texRef }; },

    dispose() {
      if (!ready) return;
      pmesh.dispose(); viewModel.dispose(); avatar.dispose(); crack.dispose(); ghost.dispose(); weather.dispose(); celestial.dispose();
      items.disposeAll(); skin.dispose(); texRef.dispose();
      for (const m of [worldMats.atlas, worldMats.color, vmMats.atlas, vmMats.color, crack.material, ghost.material]) m.dispose();
      ready = false;
    },
  };

  /* ------------------------------------------------------------------ setup */
  function setup() {
    if (ready) return;
    ready = true;
    shared = sharedUniforms(game.renderer);
    texRef = new ArrayTextureRef(game);
    texRef.update();
    hook = makeLightHook(game);
    worldMats = { atlas: createAtlasMaterial(shared, texRef, 'lit'), color: createColorMaterial(shared), hook };
    vmMats = { atlas: createAtlasMaterial(shared, texRef, 'lit', { fog: false }), color: createColorMaterial(shared, { fog: false }) };
    sim = new ParticleSim(MAX_PARTICLES);
    sim.texPixels = texPixels;
    pmesh = new ParticleMesh(sim, shared, texRef);
    items = new ItemMeshFactory(game, worldMats);
    skin = new SkinTexture(game);
    viewModel = new ViewModel(game, shared, items, vmMats, skin);
    avatar = new PlayerAvatar(game, shared, items, skin);
    crack = new CrackOverlay(game, createAtlasMaterial(shared, texRef, 'crack'));
    ghost = new GhostBlock(game, createAtlasMaterial(shared, texRef, 'lit', { transparent: true, alpha: 0.35 }));
    weather = new Weather(game, shared);
    celestial = new Celestial(game);
    fx.weather = { rain: 0, target: 0, snow: false };
    overlays = typeof document !== 'undefined' && game.uiRoot ? new Overlays(game) : nullOverlays();
    subscribe();
    attachAll();
    installPointerRing();
  }

  let attachedAll = false;
  function attachAll() {
    if (attachedAll) return;
    const r = game.renderer;
    if (!r || !r.dynamicGroup || !r.addObject) return;
    r.addObject(pmesh.mesh);
    r.addObject(crack.mesh);
    r.addObject(ghost.mesh);
    avatar.attach(r);
    weather.attach(r);
    celestial.attach(r);
    viewModel.attach(r);
    attachedAll = true;
  }

  function texPixels(layer) {
    const ts = game.textures;
    if (!ts || !ts.data) return null;
    const S = ts.size || 16;
    return ts.data.subarray(layer * S * S * 4, (layer + 1) * S * S * 4);
  }

  function itemColors(itemKey) {
    try {
      const c = items.colorsOf(itemKey);
      if (c && c.length) return c;
      const e = items.entry(itemKey);
      if (e.kind === 'block' && game.textures) {
        const def = blockDef(e.id);
        const key = def && typeof def.tex === 'string' ? def.tex : null;
        if (key) {
          const px = getTexturePixels(game.textures, key);
          return [[px[0] / 255, px[1] / 255, px[2] / 255], [px[40] / 255, px[41] / 255, px[42] / 255]];
        }
      }
    } catch { /* fall through */ }
    return [[0.8, 0.8, 0.8]];
  }

  /* ------------------------------------------------------------------ events */
  function subscribe() {
    const ev = game.events;
    ev.on('block:broken', (e) => { if (e.by !== 'explosion') sim.blockBreak(e.x, e.y, e.z, e.id, e.state | 0, game.world); });
    ev.on('block:placed', (e) => { if (e.by === 'player') viewModel.push(); });
    ev.on('block:mining', (e) => crack.onMining(e));
    ev.on('block:miningStop', (e) => crack.onStop(e));
    ev.on('player:swing', () => { viewModel.swing(); avatar.swing(); });
    ev.on('player:hurt', () => fx.hurtFlash());
    ev.on('player:water', (e) => {
      const p = game.player;
      if (e.inWater && !prevInWater && p && !p.flying) sim.spawn('splash', p.x, Math.floor(p.y) + 0.95, p.z, { count: 18, spread: 0.4 }, game.world);
      prevInWater = !!e.inWater;
    });
    ev.on('explosion', (e) => explosionFx(e));
    ev.on('bonemeal', (e) => sim.spawn('sparkle', e.x + 0.5, e.y + 0.5, e.z + 0.5, { count: 14, spread: 0.55 }, game.world));
    const hearts = (e) => {
      const ent = game.entities && game.entities.get ? game.entities.get(e.id) : null;
      const h = ent ? ent.height : 1;
      sim.spawn('heart', e.x, e.y + h + 0.2, e.z, { count: 5, spread: 0.4 }, game.world);
    };
    ev.on('mob:love', hearts);
    ev.on('mob:bred', hearts);
    ev.on('mob:tamed', hearts);
    ev.on('mob:hurt', (e) => {
      if (!Number.isFinite(e.x)) return;
      const ent = game.entities && game.entities.get ? game.entities.get(e.id) : null;
      sim.spawn('crit', e.x, e.y + (ent ? ent.height * 0.6 : 0.6), e.z, { count: 6, spread: 0.2 }, game.world);
    });
    ev.on('mob:death', (e) => { if (Number.isFinite(e.x)) deathPos.set(e.id, [e.x, e.y, e.z]); });
    ev.on('entity:spawn', (e) => {
      if (!MOBS[e.type]) return;
      if (e.reason === 'spawn' || e.reason === 'breed') sim.spawn('poof', e.x, e.y + 0.4, e.z, { count: 8, spread: 0.35, size: 0.3 }, game.world);
    });
    ev.on('entity:remove', (e) => {
      const pos = deathPos.get(e.id) || mobPos.get(e.id);
      deathPos.delete(e.id); mobPos.delete(e.id); tntTracked.delete(e.id);
      if (!pos || !MOBS[e.type]) return;
      if (e.reason === 'dead' || e.reason === 'despawn') sim.spawn('poof', pos[0], pos[1] + 0.5, pos[2], { count: 16, spread: 0.45 }, game.world);
    });
    ev.on('tnt:primed', (e) => { tntTracked.set(e.id, 0); });
    ev.on('player:eat', (e) => crumbs(e.item, 3));
    ev.on('player:ate', (e) => crumbs(e.item, 10));
    ev.on('item:broken', (e) => crumbs(e.item, 12));
    ev.on('kid:home', () => { if (performance.now() - lastExternalFade > 1000) overlays.pulse(160, 80, 320); });
    ev.on('player:respawn', () => { if (performance.now() - lastExternalFade > 1000) overlays.pulse(0, 120, 600); });
    ev.on('sleep:start', (e) => {
      overlays.fade(0.95, 600).then(() => { if (e && e.nap) overlays.fade(0.4, 700); });
    });
    ev.on('sleep:end', () => { overlays.fade(1, 250).then(() => overlays.fade(0, 700)); });
    ev.on('settings:changed', (e) => { if (e.key === 'skin') skin.refresh(); });
    ev.on('world:ready', (e) => { weather.reset(e.meta); prevInWater = false; });
    ev.on('world:exit', () => {
      sim.clear(); tntTracked.clear(); mobPos.clear(); deathPos.clear(); crack.evt = null;
      overlays.clearAll(); overlays.fade(0, 0); weather.reset(null);
    });
    ev.on('game:state', (e) => { if (e.to !== 'playing') overlays.ringCancel(); });
  }

  function crumbs(item, count) {
    if (!item || !game.player) return;
    const p = game.player;
    p.getEyePos(tmpEye); p.getLookDir(tmpDir);
    sim.spawn('item', tmpEye.x + tmpDir.x * 0.45, tmpEye.y - 0.2 + tmpDir.y * 0.3, tmpEye.z + tmpDir.z * 0.45,
      { count, spread: 0.08, colors: itemColors(item) }, game.world);
  }

  function explosionFx(e) {
    const w = game.world;
    const power = Number(e.power) || 4;
    sim.spawn('explosion', e.x, e.y, e.z, { count: Math.round(6 + power * 3), spread: Math.min(3, 0.5 + power * 0.45), size: 1.2 + power * 0.15 }, w);
    sim.spawn('smoke', e.x, e.y, e.z, { count: 16, spread: power * 0.4, size: 0.4, vy: 0.03 }, w);
    const blocks = Array.isArray(e.blocks) ? e.blocks : [];
    const step = Math.max(1, Math.floor(blocks.length / 14));
    for (let i = 0; i < blocks.length; i += step) {
      const b = blocks[i];
      if (b && b.id) sim.blockBreak(b.x, b.y, b.z, b.id, b.state | 0, w, 5);
    }
  }

  function hitParticles(t) {
    const w = game.world;
    const raw = w.getRaw(t.x, t.y, t.z);
    if (!(raw & 0xff)) return;
    const n0 = sim.count;
    sim.blockBreak(t.x, t.y, t.z, raw & 0xff, raw >> 8, w, 2);
    // move them to the hit point, pushed slightly out of the face, small velocities
    const hx = Number.isFinite(t.px) ? t.px : t.x + 0.5, hy = Number.isFinite(t.py) ? t.py : t.y + 0.5, hz = Number.isFinite(t.pz) ? t.pz : t.z + 0.5;
    for (let i = n0; i < sim.count; i++) {
      sim.x[i] = sim.px[i] = hx + (t.nx || 0) * 0.08 + (sim.rand() - 0.5) * 0.4 * (t.nx ? 0 : 1);
      sim.y[i] = sim.py[i] = hy + (t.ny || 0) * 0.08 + (sim.rand() - 0.5) * 0.4 * (t.ny ? 0 : 1);
      sim.z[i] = sim.pz[i] = hz + (t.nz || 0) * 0.08 + (sim.rand() - 0.5) * 0.4 * (t.nz ? 0 : 1);
      sim.vx[i] = (t.nx || 0) * 0.05 + (sim.rand() - 0.5) * 0.05;
      sim.vy[i] = (t.ny || 0) * 0.05 + 0.05;
      sim.vz[i] = (t.nz || 0) * 0.05 + (sim.rand() - 0.5) * 0.05;
      sim.size[i] *= 0.7;
    }
  }

  /** Random "display ticks" near the player: torch flames + smoke, fire smoke, lava pops, lit furnace flames. */
  function ambientTick(w) {
    const p = game.player;
    if (!p || !w || !w.getRaw) return;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    const R = ambientRng, D = AMBIENT_R * 2 + 1;
    for (let i = 0; i < AMBIENT_SAMPLES; i++) {
      const x = px + Math.floor(R() * D) - AMBIENT_R, y = py + Math.floor(R() * D) - AMBIENT_R, z = pz + Math.floor(R() * D) - AMBIENT_R;
      const raw = w.getRaw(x, y, z);
      const id = raw & 0xff;
      if (!id) continue;
      if (id === TORCH_ID) {
        const boxes = getSelectionBoxes(id, raw >> 8);
        const b = boxes[0];
        const cx = b ? (b[0] + b[3]) / 2 : 0.5, cz = b ? (b[2] + b[5]) / 2 : 0.5, top = b ? b[4] : 0.62;
        sim.spawn('flame', x + cx, y + top + 0.06, z + cz, { count: 1, spread: 0 }, w);
        if (R() < 0.5) sim.spawn('smoke', x + cx, y + top + 0.12, z + cz, { count: 1, spread: 0, size: 0.12 }, w);
      } else if (id === FIRE_ID) {
        if (R() < 0.5) sim.spawn('smoke', x + R(), y + 0.6, z + R(), { count: 1, spread: 0, size: 0.3 }, w);
      } else if (id === LAVA_ID && B_LIQUID[id] === 2) {
        if (R() < 0.05 && !(w.getRaw(x, y + 1, z) & 0xff)) {
          sim.spawn('flame', x + R(), y + 1, z + R(), { count: 1, spread: 0, vy: 0.12, size: 0.1 }, w);
          sim.spawn('smoke', x + R(), y + 1.1, z + R(), { count: 1, spread: 0, size: 0.18 }, w);
        }
      } else if (id === LIT_FURNACE_ID && R() < 0.3) {
        sim.spawn('flame', x + 0.5, y + 0.3, z + 0.5, { count: 1, spread: 0.3 }, w);
      }
    }
  }

  /** Remember mob positions (death poof after removal) and puff smoke from primed TNT. */
  function trackEntities() {
    const ents = game.entities;
    if (!ents || !ents.forEach) return;
    if (game.tickCount % 5 === 0) {
      const hearts = game.tickCount % 10 === 0;
      ents.forEach((e) => {
        if (!MOBS[e.type]) return;
        let a = mobPos.get(e.id);
        if (!a) { a = [0, 0, 0]; mobPos.set(e.id, a); }
        a[0] = e.x; a[1] = e.y; a[2] = e.z;
        // love mode: a heart every 10 ticks (MOBS keeps the counter in entity.data; any of these names works)
        const d = e.data;
        if (hearts && d && e.deathTime === 0 && ((d.love | 0) > 0 || (d.loveTicks | 0) > 0 || (d.inLove | 0) > 0)) {
          sim.spawn('heart', e.x, e.y + (e.height || 1) + 0.25, e.z, { count: 1, spread: 0.35 }, game.world);
        }
      });
    }
    for (const [id, n] of tntTracked) {
      const e = ents.get(id);
      if (!e) { tntTracked.delete(id); continue; }
      tntTracked.set(id, n + 1);
      if (n % 2 === 0) sim.spawn('smoke', e.x, e.y + 1.05, e.z, { count: 1, spread: 0.05, size: 0.16 }, game.world);
    }
  }

  /* ------------------------------------------------------------------ overlays */
  function updateOverlays() {
    const p = game.player;
    const inWorld = !!(game.meta && p && (game.state === 'playing' || game.state === 'paused'));
    let eyeWater = false, eyeLava = false;
    if (inWorld) {
      eyeWater = !!p.eyeInWater;
      const w = game.world;
      if (w && w.getBlock) {
        const ex = Math.floor(p.renderX ?? p.x), ey = Math.floor((p.renderY ?? p.y) + (p.eyeHeight || 1.62)), ez = Math.floor(p.renderZ ?? p.z);
        const id = w.getBlock(ex, ey, ez);
        if (B_LIQUID[id] === 1) eyeWater = true;
        if (B_LIQUID[id] === 2) eyeLava = true;
      }
    }
    overlays.setUnderwater(inWorld && eyeWater && !p.view);
    overlays.setInLava(inWorld && eyeLava);
    overlays.setVignette(inWorld);
    overlays.updateRing();
  }

  function installPointerRing() {
    const c = game.canvas;
    if (!c || !c.addEventListener) return;
    const ok = () => game.state === 'playing' && game.settings.controls === 'kid' && !(game.input && game.input.isCaptured && game.input.isCaptured());
    c.addEventListener('pointerdown', (e) => {
      if (!ok()) return;
      if (e.width > 40 && e.pointerType === 'touch') return;   // palms are ignored (SPEC §7.1)
      if (overlays.ringState && overlays.ringState.id !== e.pointerId) return;  // only the first pointer
      const r = c.getBoundingClientRect();
      overlays.ringDown(e.pointerId, e.clientX - r.left, e.clientY - r.top);
    }, { passive: true });
    c.addEventListener('pointermove', (e) => { const r = c.getBoundingClientRect(); overlays.ringMove(e.pointerId, e.clientX - r.left, e.clientY - r.top); }, { passive: true });
    const up = (e) => overlays.ringUp(e.pointerId);
    c.addEventListener('pointerup', up, { passive: true });
    c.addEventListener('pointercancel', up, { passive: true });
    c.addEventListener('pointerleave', up, { passive: true });
  }

  return fx;
}

/** Overlay stand-in without a DOM (Node tests). */
function nullOverlays() {
  return {
    underwater: false, inLava: false, flashes: 0, fadeLevel: 0, ringState: null,
    setUnderwater(v) { this.underwater = v; }, setInLava(v) { this.inLava = v; }, setVignette() {},
    hurtFlash() { this.flashes++; return true; }, fade(to) { this.fadeLevel = to; return Promise.resolve(); }, pulse() { return Promise.resolve(); },
    ringDown() {}, ringMove() {}, ringUp() {}, ringCancel() {}, updateRing() {}, clearAll() {},
  };
}


