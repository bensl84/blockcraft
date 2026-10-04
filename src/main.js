// OWNER: LEAD (integration). Bootstrap, game object, system registration, fixed-timestep loop, world
// start/exit, error capture, service worker. docs/SPEC.md §3. Lanes never edit this file: everything a lane
// needs is reachable through its own system object, events, hooks and the registries.

import './styles.css';
import { EventBus } from './core/events.js';
import { loadSettings, setSetting } from './core/settings.js';
import {
  BUILD_VERSION, DEFAULT_RULES, DEV, MAX_FRAME_DT, MAX_TICKS_PER_FRAME, RENDER, SURVIVAL_RULES, TICK_DT,
} from './core/constants.js';
import { bindTextures } from './core/registry.js';
import { mulberry32, randomSeed } from './core/math.js';
import { applyGuiScale } from './core/dom.js';
import { installTestApi } from './core/testapi.js';
import { createTimeSystem } from './core/time.js';
import { createScreenManager } from './ui/screens.js';
import { buildItemIcons, buildTextures } from './textures/textures.js';
import { findSpawn } from './world/worldgen.js';
import { createWorldSystem } from './world/world.js';
import { createRendererSystem } from './render/renderer.js';
import { createInputSystem } from './player/input.js';
import { createPlayerSystem } from './player/player.js';
import { createInteractionSystem } from './player/interaction.js';
import { createEntitySystem } from './entities/entity.js';
import { createMobsSystem } from './entities/mobs.js';
import { createSurvivalSystem } from './survival/survival.js';
import { createMechanicsSystem } from './mechanics/mechanics.js';
import { Inventory, KID_CREATIVE_HOTBAR } from './inventory/inventory.js';
import { createInventoryUISystem } from './ui/inventory_ui.js';
import { createHudSystem } from './ui/hud.js';
import { createAudioSystem } from './audio/audio.js';
import { createSaveSystem } from './save/storage.js';
import { createMenusSystem } from './ui/menus.js';
import { installPixelFont } from './ui/pixelfont.js';
import { createTouchSystem } from './ui/touch.js';
import { createKidSystem } from './kid/kid.js';
import { createFxSystem } from './fx/fx.js';
// Side-effect imports: every public lane module is in the bundle from day one, so its stub registration
// (core/stubs.js) is visible to tests even before another module starts importing it.
import './world/noise.js';
import './player/physics.js';
import './player/raycast.js';
import './inventory/crafting.js';
import './inventory/containers.js';
import './entities/item_entity.js';
import './ui/parentgate.js';
import './textures/toolkit.js';
import './save/codec.js';

const WORLD_NAMES = ['Sunny Meadow', 'Happy Hills', 'Blue Lake', 'Cozy Forest', 'Rainbow Valley', 'Snowy Peak', 'Flower Field', 'Pony Plains'];

/* ------------------------------------------------------------------ game object (SPEC §3.2) */
const game = {
  version: BUILD_VERSION,
  dev: DEV,
  canvas: null,
  uiRoot: null,
  events: new EventBus(),
  settings: loadSettings(),
  /** 'boot' | 'title' | 'loading' | 'playing' | 'paused' */
  state: 'boot',
  /** @type {import('./core/types.js').WorldMeta|null} */
  meta: null,
  textures: null,
  icons: null,
  inventory: null,
  guiScale: 2,
  tickCount: 0,
  frameCount: 0,
  perf: { fps: 0, frameMs: 0, workMs: 0, tickMs: 0 },
  /** @type {Array<{message:string, where:string, stack:string, count:number, time:number}>} */
  errors: [],
  /** registered systems in REGISTRATION (= tick/frame) order */
  systems: [],
  /** name -> system */
  sys: {},

  setState(s) {
    if (s === game.state) return;
    const from = game.state;
    game.state = s;
    game.events.emit('game:state', { from, to: s });
  },
  isCreative() { return !game.meta || game.meta.mode === 'creative'; },
  setMode(mode) {
    if (!game.meta || (mode !== 'creative' && mode !== 'survival')) return;
    game.meta.mode = mode;
    if (mode === 'survival' && game.player) game.player.setFlying(false);
    game.events.emit('mode:changed', { mode });
  },
  setDifficulty(d) {
    if (!game.meta || !['peaceful', 'easy', 'normal'].includes(d)) return;
    game.meta.difficulty = d;
    if (d === 'peaceful') game.meta.rules.hostileMobs = false;
    game.events.emit('difficulty:changed', { difficulty: d });
  },
  setRule(key, value) {
    if (!game.meta || !(key in DEFAULT_RULES)) return;
    game.meta.rules[key] = value;
    game.events.emit('rules:changed', { key, value, rules: game.meta.rules });
  },
  setSetting(key, value) { setSetting(game, key, value); },
  /**
   * Shared gameplay random source in [0,1) (drops, taming, AI choices, spawn rolls, crop growth...). Every lane
   * uses game.rand() instead of Math.random() for gameplay so tests can fix it with setRandomSeed (SPEC §0.3).
   */
  rand: mulberry32(randomSeed()),
  /** Re-seed game.rand (test API setRandomSeed). */
  setRandomSeed(seed) { game.rand = mulberry32(seed >>> 0); },
  /** Test/fast-forward: run n ticks synchronously, then one frame (SPEC §11 runTicks). Only while playing. */
  stepTicks,
  /** LEAD/test only: callbacks run after every tick, fn(game). Used by the test API's recordTicks. */
  afterTick: new Set(),
  reportError,
  startWorld,
  exitToTitle,
};
game.events.tickRef = { get tick() { return game.tickCount; } };

/* ------------------------------------------------------------------ error capture */
function reportError(err, where = 'unknown') {
  const message = err && err.message ? err.message : String(err);
  const existing = game.errors.find((e) => e.message === message && e.where === where);
  if (existing) { existing.count++; return; }
  if (game.errors.length < 100) {
    game.errors.push({ message, where, stack: err && err.stack ? String(err.stack).slice(0, 2000) : '', count: 1, time: Date.now() });
  }
  console.error(`[blockcraft] ${where}:`, err);
}
game.events.onError = (err, name) => reportError(err, `event ${name}`);
window.addEventListener('error', (e) => reportError(e.error || e.message, 'window.onerror'));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandledrejection'));

/* ------------------------------------------------------------------ systems */
function register(sys) {
  if (!sys || !sys.name) throw new Error('system without name');
  if (game.sys[sys.name]) throw new Error(`duplicate system ${sys.name}`);
  game.systems.push(sys);
  game.sys[sys.name] = sys;
  game[sys.name] = sys; // shortcut: game.world, game.player, ...
  return sys;
}

function createSystems() {
  game.inventory = new Inventory(game.events);
  // REGISTRATION ORDER = TICK and FRAME ORDER (SPEC §3.4). The renderer is registered last so its frame()
  // renders after everything else updated, but it is INITIALISED first.
  register(createTimeSystem(game));
  register(createScreenManager(game));      // game.ui
  register(createInputSystem(game));        // game.input
  register(createWorldSystem(game));        // game.world
  register(createPlayerSystem(game));       // game.player
  register(createInteractionSystem(game));  // game.interaction
  register(createMechanicsSystem(game));    // game.mechanics
  register(createEntitySystem(game));       // game.entities
  register(createMobsSystem(game));         // game.mobs
  register(createSurvivalSystem(game));     // game.survival
  register(createInventoryUISystem(game));  // game.invui
  register(createHudSystem(game));          // game.hud
  register(createKidSystem(game));          // game.kid
  register(createTouchSystem(game));        // game.touch
  register(createFxSystem(game));           // game.fx
  register(createAudioSystem(game));        // game.audio
  register(createSaveSystem(game));         // game.save
  register(createMenusSystem(game));        // game.menus
  register(createRendererSystem(game));     // game.renderer
}

function safeCall(sys, method, ...args) {
  try { return sys[method](...args); } catch (err) { reportError(err, `${sys.name}.${method}`); return undefined; }
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  const t0 = performance.now();
  game.canvas = document.getElementById('game-canvas');
  game.uiRoot = document.getElementById('ui-root');
  const api = installTestApi(game);
  installFavicon();

  // 1) textures (CORE-A, pure) -> registry face-layer table
  game.textures = buildTextures({ fastLeaves: !game.settings.fancyLeaves });
  bindTextures(game.textures);

  // 2) systems
  createSystems();

  // 3) icons (DOM canvas) before UI systems init
  game.icons = buildItemIcons(game.textures);
  document.documentElement.style.setProperty('--icons-url', `url(${game.icons.url})`);

  // 4) init: renderer first, then registration order
  const initOrder = [game.renderer, ...game.systems.filter((s) => s !== game.renderer)];
  for (const s of initOrder) {
    if (!s.init) continue;
    try { await s.init(game); } catch (err) { reportError(err, `${s.name}.init`); }
  }
  installPixelFont().catch((err) => reportError(err, 'installPixelFont'));

  applyGuiScale(game);
  window.addEventListener('resize', () => applyGuiScale(game));
  game.events.on('settings:changed', (e) => { if (e.key === 'guiScale' || e.key === 'controls' || e.key === 'buttonSize') applyGuiScale(game); });

  registerServiceWorker();
  startLoop();

  const bootEl = document.getElementById('boot');
  if (bootEl) bootEl.remove();
  game.setState('title');
  game.bootMs = performance.now() - t0;
  api.ready = true;
  game.events.emit('game:ready', { bootMs: game.bootMs });
}

/* ------------------------------------------------------------------ loop (SPEC §3.5) */
function startLoop() {
  let last = performance.now();
  let acc = 0;
  let fpsAcc = 0, fpsFrames = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    const w0 = performance.now();
    if (game.state === 'playing') {
      acc += dt;
      let n = 0;
      while (acc >= TICK_DT && n < MAX_TICKS_PER_FRAME) { runTick(); acc -= TICK_DT; n++; }
      if (n === MAX_TICKS_PER_FRAME && acc > TICK_DT) acc = TICK_DT * 0.5; // drop backlog: slow down, never spiral
    }
    const alpha = game.state === 'playing' ? Math.min(1, acc / TICK_DT) : 1;
    runFrame(dt, alpha);
    const work = performance.now() - w0;
    game.perf.workMs = game.perf.workMs * 0.9 + work * 0.1;
    game.perf.frameMs = game.perf.frameMs * 0.9 + dt * 1000 * 0.1;
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { game.perf.fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
  };
  requestAnimationFrame(frame);
}

function runFrame(dt, alpha) {
  game.frameCount++;
  for (const s of game.systems) if (s.frame) safeCall(s, 'frame', game, dt, alpha);
}

function runTick() {
  const t0 = performance.now();
  game.tickCount++;
  for (const s of game.systems) if (s.tick) safeCall(s, 'tick', game);
  if (game.meta) game.meta.playTicks++;
  for (const fn of game.afterTick) { try { fn(game); } catch (err) { reportError(err, 'afterTick'); } }
  game.perf.tickMs = game.perf.tickMs * 0.9 + (performance.now() - t0) * 0.1;
}

/** Run n ticks back to back (capped at 100000), then one frame so visuals catch up. Returns game.tickCount. */
function stepTicks(n) {
  if (game.state !== 'playing') return game.tickCount;
  const count = Math.max(0, Math.min(100000, Math.floor(n) || 0));
  for (let i = 0; i < count; i++) runTick();
  runFrame(TICK_DT, 1);
  return game.tickCount;
}

/* ------------------------------------------------------------------ worlds (SPEC §3.6) */
function createWorldMeta(opts) {
  const mode = opts.mode === 'survival' ? 'survival' : 'creative';
  const difficulty = ['peaceful', 'easy', 'normal'].includes(opts.difficulty) ? opts.difficulty : 'peaceful';
  const rules = { ...DEFAULT_RULES, ...(mode === 'survival' ? SURVIVAL_RULES : {}), ...(opts.rules || {}) };
  if (difficulty === 'peaceful') { rules.hostileMobs = false; if (!(opts.rules && 'hunger' in opts.rules)) rules.hunger = false; }
  const now = Date.now();
  return {
    id: opts.id || 'w' + now.toString(36) + Math.floor(Math.random() * 46656).toString(36),
    name: opts.name || `${WORLD_NAMES[Math.floor(Math.random() * WORLD_NAMES.length)]} ${1 + Math.floor(Math.random() * 99)}`,
    seed: Number.isFinite(opts.seed) ? opts.seed >>> 0 : randomSeed(),
    preset: ['default', 'flat', 'islands', 'snowy'].includes(opts.preset) ? opts.preset : 'default',
    mode, difficulty, rules,
    createdAt: now, lastPlayed: now, playTicks: 0,
    spawn: null, home: null, thumbnail: null,
    formatVersion: 1,
    systems: {},
  };
}

/**
 * Start (create or load) a world. opts for a NEW world: {preset, mode, difficulty, seed?, name?, rules?}.
 * To LOAD: {meta, columns} as returned by game.save.loadWorld(id). Resolves when the spawn area is meshed
 * and game.state === 'playing'.
 */
async function startWorld(opts = {}) {
  if (game.state === 'loading') throw new Error('startWorld: already loading');
  if (game.meta) await closeWorld(false);
  if (game.ui.current) game.ui.close();
  game.setState('loading');
  try {
    return await openWorld(opts);
  } catch (err) {
    // a failed open/pregenerate must not leave the game stuck in 'loading' (MENUS request): back to the title
    try { if (game.meta) await closeWorld(false); } catch (e2) { reportError(e2, 'startWorld cleanup'); }
    game.setState('title');
    throw err;
  }
}

async function openWorld(opts) {
  window.__game && (window.__game.worldReady = false);
  const isNew = !opts.meta;
  const meta = isNew ? createWorldMeta(opts) : { ...createWorldMeta(opts.meta), ...opts.meta, rules: { ...DEFAULT_RULES, ...opts.meta.rules } };
  meta.lastPlayed = Date.now();
  game.meta = meta;
  game.events.emit('world:starting', { meta, isNew });

  game.world.open(meta, opts.columns || null);
  game.inventory.clear();
  for (const s of game.systems) {
    if (s.deserialize) safeCall(s, 'deserialize', game, meta.systems ? meta.systems[s.name] : undefined);
  }
  if (isNew) {
    const sp = findSpawn(meta.seed, meta.preset);
    meta.spawn = { x: sp.x, y: sp.y, z: sp.z };
    game.player.spawnPoint = { ...meta.spawn };
    game.player.spawn(sp.x, sp.y, sp.z, 0, 0);
    if (meta.mode === 'creative') game.inventory.fillHotbar(KID_CREATIVE_HOTBAR);
    // a new world starts on the first hotbar slot (inventory.clear() keeps the previous world's selection)
    game.inventory.selectSlot(0);
  }
  if (game.settings.renderDistance > 0) game.world.setRenderDistance(game.settings.renderDistance);
  if (game.renderer.setRenderDistance) game.renderer.setRenderDistance(game.world.renderDistance);

  const pcx = Math.floor(game.player.x) >> 4, pcz = Math.floor(game.player.z) >> 4;
  await game.world.pregenerate(pcx, pcz, Math.min(RENDER.SPAWN_RADIUS, game.world.renderDistance), (done, total) => {
    game.events.emit('world:progress', { done, total });
  });
  if (isNew) {
    // Make sure the new player stands on the real surface (worldgen estimate may differ by decoration).
    const sy = game.world.getSurfaceY(game.player.x, game.player.z);
    if (sy > 0) { game.player.spawn(game.player.x, sy, game.player.z, 0, 0); meta.spawn.y = sy; game.player.spawnPoint.y = sy; }
  }
  game.setState('playing');
  if (window.__game) window.__game.worldReady = true;
  game.events.emit('world:ready', { meta, isNew });
  return meta;
}

/** Save, close the world and return to the title screen. */
async function exitToTitle() {
  if (!game.meta) return;
  await closeWorld(true);
  game.setState('title');
}

async function closeWorld(save) {
  if (save && game.save) {
    try { await game.save.saveNow('exit'); } catch (err) { reportError(err, 'save on exit'); }
  }
  const meta = game.meta;
  if (game.ui.current) game.ui.close();
  game.events.emit('world:exit', { meta });
  game.world.close();
  if (game.renderer.clearWorld) game.renderer.clearWorld();
  game.entities.clear();
  game.meta = null;
  if (window.__game) window.__game.worldReady = false;
}

/* ------------------------------------------------------------------ platform */
function registerServiceWorker() {
  if (!location.protocol.startsWith('http')) return; // file:// rejects SW registration (verified)
  try {
    const link = document.createElement('link');
    link.rel = 'manifest'; link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
  } catch { /* ignore */ }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[blockcraft] service worker not registered:', err && err.message));
  }
}

function installFavicon() {
  try {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const x = c.getContext('2d');
    x.fillStyle = '#78a7ff'; x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#7a5230'; x.fillRect(2, 5, 12, 9);
    x.fillStyle = '#67a93b'; x.fillRect(2, 3, 12, 4);
    x.fillStyle = '#86c853'; x.fillRect(3, 3, 3, 1); x.fillRect(9, 4, 2, 1);
    const link = document.createElement('link');
    link.rel = 'icon'; link.href = c.toDataURL('image/png');
    document.head.appendChild(link);
  } catch { /* ignore */ }
}

boot().catch((err) => {
  reportError(err, 'boot');
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Oops - Blockcraft could not start. Please reload.';
});
