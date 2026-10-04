// OWNER LANE: FEATURE-MECH (block mechanics). SPEC §2.5 and §8.6. API frozen (explode, primeTnt, scheduleTick,
// applyBoneMeal, trySleep, serialize, deserialize); everything else here is additive.
//
// Modules:
//   scheduler.js  scheduled block ticks (min-heap per game tick, deduplicated per cell, <= 1024 runs per tick)
//   rules.js      support / wash / solid-top predicates (pure)
//   fluids.js     water + lava flow (pure, accessor based)
//   explosion.js  1352-ray explosion maths, exposure, damage (pure)
//   entities.js   falling_block + tnt entity types
//   uses.js       hooks: doors, gates, beds, cake, TNT, buckets, hoes, bone meal, flint and steel, snow layers
//   painting.js   painting entity + item (P1)
//
// RULES (SPEC §0.3, §8.6): blocks are broken only through game.interaction.breakBlock (explosions pass dropInto
// so their drops are merged into <= 32 item entities). Deliberate exceptions, documented in docs/handoff/mech.md:
// fluid flow/decay/pickup, falling blocks lifting off, fire burning out and growth use world.setBlock directly
// (they move or transform a block; a break event would play break particles and sounds). Bulk edits run inside
// world.beginBatch()/endBatch(). Follow-up changes carry the causing change's `action`. Gameplay rolls use
// game.rand().

import { maxStack } from '../data/items.js';
import { BLOCKS, STATE } from '../data/blocks.js';
import {
  B_LIQUID, B_OPAQUE, B_SHAPE, ID, SHAPE, connectionState, isReplaceable,
} from '../core/registry.js';
import { KID, KID_LOCKED_TIME, colKey } from '../core/constants.js';
import { dropItem } from '../entities/item_entity.js';
import { placeTree } from '../world/worldgen.js';
import { TICK_KIND, TickScheduler } from './scheduler.js';
import {
  AIR, B_NEEDS_SUPPORT, CROP_IDS, FLOWER_IDS, GRAVITY_IDS, LAVA, LEAF_IDS, LOG_IDS, SAPLING_KIND, WATER,
  canFallThrough, effectiveLight, hasSolidTop, supportStatus,
} from './rules.js';
import { FLUID_PARAMS, flowVector, fluidTick, lavaMix } from './fluids.js';
import { centreInFluid, damageOf, explosionCells, exposure, impactOf } from './explosion.js';
import { dropBlockItem, registerMechEntityTypes } from './entities.js';
import { registerMechHooks } from './uses.js';
import { registerPaintings } from './painting.js';

export const MAX_TICK_RUNS = 1024;
export const MAX_EXPLOSIONS_PER_TICK = 2;
export const MAX_DROP_ENTITIES = 32;
export const RANDOM_TICKS_PER_SECTION = 3;
export const FIRE_MIN = 30, FIRE_MAX = 90;
export const SLEEP_TICKS = 100;
export const SPREAD_LIGHT = 9;

/** Explosions harvest like the right tool (TNT drops 100% of destroyed blocks, SPEC §2.5). */
const BLAST_TOOLS = new Map();
function blastTool(id) {
  const t = BLOCKS[id] && BLOCKS[id].tool;
  if (!t) return null;
  let d = BLAST_TOOLS.get(t);
  if (!d) { d = Object.freeze({ type: t, level: 9, speed: 1, durability: 1 }); BLAST_TOOLS.set(t, d); }
  return d;
}

const NB = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** @returns {object} Mechanics system (game.mechanics) */
export function createMechanicsSystem(game) {
  const sched = new TickScheduler();
  /** colKey -> [[x, y, z, kind, delay, action]] ticks of columns that are not loaded */
  const parked = new Map();
  /** explosions waiting for the per-tick cap: [x, y, z, power, opts] */
  let explosionQueue = [];
  let explosionsThisTick = 0;
  /** active sleep: {nap, ticks, x, y, z} or null */
  let sleep = null;
  /** action id of the scheduled tick being executed (follow-up changes carry it) */
  let curAction = 0;
  const flowTmp = { x: 0, z: 0 };
  const boxTmp = {};

  const getRaw = (x, y, z) => game.world.getRaw(x, y, z);
  const rules = () => (game.meta && game.meta.rules) || {};
  const isNight = () => !!(game.time && game.time.isNight && game.time.isNight());
  const lightAt = (x, y, z) => effectiveLight(game.world.getLight(x, y, z), isNight());
  const loaded = (x, z) => { const w = game.world; return !!w && w.isColumnLoaded(Math.floor(x) >> 4, Math.floor(z) >> 4); };
  const newAction = () => (game.interaction && game.interaction.newAction ? game.interaction.newAction() : 0);
  const setBlock = (x, y, z, id, state, cause, action = curAction) => game.world.setBlock(x, y, z, id, state, { cause, action });
  const breakBlock = (x, y, z, opts) => (game.interaction ? game.interaction.breakBlock(x, y, z, opts) : false);

  /** Fluid accessor for fluids.js: writes carry the current tick's action. */
  const fluidAcc = {
    get: getRaw,
    set: (x, y, z, id, state) => setBlock(x, y, z, id, state, 'fluid'),
    wash: (x, y, z, fluidId) => breakBlock(x, y, z, { by: 'fluid', action: curAction || undefined, drops: B_LIQUID[fluidId] === LAVA ? false : undefined }),
  };

  const stats = {
    ticksRun: 0, randomTicks: 0, explosions: 0, fallingSpawned: 0, tntPrimed: 0, lastExplosion: null,
    /** cumulative ms spent in scheduled ticks / random ticks / leaf-decay searches (perf debugging) */
    schedMs: 0, randomMs: 0, leafChecks: 0,
  };

  /* ------------------------------------------------------------------ scheduling */
  function schedule(x, y, z, delay, kind = TICK_KIND.NEIGHBOR, action = 0) {
    if (y < 0 || y > 127) return;
    sched.schedule(game.tickCount, x, y, z, delay, kind, action);
  }

  function onBlockChanged(e) {
    noteRandomTicked(e.x, e.y, e.z, e.id);
    if (!game.world || !game.world.isOpen || e.cause === 'worldgen') return;
    const a = e.action | 0;
    for (const d of NB) schedule(e.x + d[0], e.y + d[1], e.z + d[2], 1, TICK_KIND.NEIGHBOR, a);
    if (e.id === ID.fire && e.oldId !== ID.fire) {
      schedule(e.x, e.y, e.z, FIRE_MIN + Math.floor(game.rand() * (FIRE_MAX - FIRE_MIN + 1)), TICK_KIND.FIRE, a);
    }
  }

  function parkTick(e) {
    const key = colKey(e.x >> 4, e.z >> 4);
    let list = parked.get(key);
    if (!list) { list = []; parked.set(key, list); }
    if (list.length < 4096) list.push([e.x, e.y, e.z, e.kind, 1, e.action]);
  }

  function runScheduled() {
    const now = game.tickCount;
    let n = 0, e;
    while (n < MAX_TICK_RUNS && (e = sched.popDue(now))) {
      n++;
      if (!loaded(e.x, e.z)) { parkTick(e); continue; }
      curAction = e.action;
      try {
        switch (e.kind) {
          case TICK_KIND.NEIGHBOR: neighborUpdate(e.x, e.y, e.z); break;
          case TICK_KIND.FLUID: fluidTick(fluidAcc, e.x, e.y, e.z); break;
          case TICK_KIND.FALL: fallUpdate(e.x, e.y, e.z); break;
          case TICK_KIND.FIRE: fireUpdate(e.x, e.y, e.z); break;
          default: break;
        }
      } catch (err) { game.reportError(err, 'mechanics scheduled tick'); }
      curAction = 0;
    }
    stats.ticksRun += n;
  }

  /* ------------------------------------------------------------------ neighbour reactions */
  function neighborUpdate(x, y, z) {
    const raw = getRaw(x, y, z), id = raw & 0xff, st = raw >>> 8;
    if (id === AIR) return;
    const liquid = B_LIQUID[id];
    if (liquid) {
      if (liquid === LAVA && lavaMix(fluidAcc, x, y, z)) return;
      schedule(x, y, z, FLUID_PARAMS[liquid].delay - 1, TICK_KIND.FLUID, curAction);
      return;
    }
    if (GRAVITY_IDS.has(id)) {
      if (y > 0 && canFallThrough(getRaw(x, y - 1, z) & 0xff)) schedule(x, y, z, 1, TICK_KIND.FALL, curAction);
      return;
    }
    if (B_NEEDS_SUPPORT[id]) {
      const s = supportStatus(getRaw, x, y, z);
      if (s !== 'ok') {
        breakBlock(x, y, z, { by: s, action: curAction || undefined, drops: s === 'cascade' ? false : undefined });
        return;
      }
    }
    const shape = B_SHAPE[id];
    if (shape === SHAPE.FENCE || shape === SHAPE.PANE) {
      const bits = connectionState(getRaw, x, y, z, id);
      if ((st & STATE.CONNECT_MASK) !== bits) setBlock(x, y, z, id, (st & ~STATE.CONNECT_MASK) | bits, 'cascade');
      return;
    }
    if (id === ID.grass_block) {
      const above = getRaw(x, y + 1, z) & 0xff;
      const snowy = above === ID.snow || above === ID.snow_block ? 1 : 0;
      if ((st & 1) !== snowy) setBlock(x, y, z, id, (st & ~1) | snowy, 'cascade');
      return;
    }
    if (id === ID.farmland) {
      if (B_OPAQUE[getRaw(x, y + 1, z) & 0xff]) setBlock(x, y, z, ID.dirt, 0, 'cascade');
      return;
    }
    if (id === ID.tnt) {
      for (const d of NB) {
        const n = getRaw(x + d[0], y + d[1], z + d[2]) & 0xff;
        if (n === ID.fire || n === ID.lava) { primeTnt(x, y, z, 80, { action: curAction, by: 'fire' }); return; }
      }
    }
  }

  /* ------------------------------------------------------------------ falling blocks */
  function fallUpdate(x, y, z) {
    const raw = getRaw(x, y, z), id = raw & 0xff;
    if (!GRAVITY_IDS.has(id) || y <= 0 || !canFallThrough(getRaw(x, y - 1, z) & 0xff)) return;
    if (!game.entities) return;
    const action = curAction;
    if (!setBlock(x, y, z, AIR, 0, 'fall', action)) return;
    const e = game.entities.spawn('falling_block', x + 0.5, y, z + 0.5, { block: id, state: raw >>> 8, action, reason: 'fall' });
    if (e) stats.fallingSpawned++;
  }

  /** Called by a falling_block entity when it lands in cell (bx, by, bz). */
  function landFallingBlock(ent, bx, by, bz) {
    const d = ent.data;
    const cur = getRaw(bx, by, bz), cid = cur & 0xff;
    const placeable = by >= 0 && by < 128 && (cid === AIR || (isReplaceable(cid) && cid !== d.block));
    if (placeable && setBlock(bx, by, bz, d.block, d.state, 'fall', d.action | 0)) {
      const def = BLOCKS[d.block];
      if (game.audio && game.audio.playBlock) game.audio.playBlock('land', def ? def.sound : 'sand', bx + 0.5, by, bz + 0.5);
      game.events.emit('mech:landed', { x: bx, y: by, z: bz, id: d.block, action: d.action | 0 });
      return true;
    }
    if (rules().dropItemsOnBreak) dropBlockItem(game, d.block, d.state, ent.x, ent.y + 0.5, ent.z);
    return false;
  }

  /* ------------------------------------------------------------------ fire */
  function fireUpdate(x, y, z) {
    if ((getRaw(x, y, z) & 0xff) !== ID.fire) return;
    if (rules().fireSpread) spreadFire(x, y, z);
    setBlock(x, y, z, AIR, 0, 'fire');
  }

  function flammable(id) { const b = BLOCKS[id]; return !!(b && b.flammable); }

  function spreadFire(x, y, z) {
    for (const d of NB) {
      if (!d[0] && !d[1] && !d[2]) continue;
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      const nid = getRaw(nx, ny, nz) & 0xff;
      if (nid === ID.tnt) { primeTnt(nx, ny, nz, 80, { action: curAction, by: 'fire' }); continue; }
      if (flammable(nid) && game.rand() < 0.3) {
        breakBlock(nx, ny, nz, { by: 'fire', drops: false, action: curAction || undefined });
        if (hasSolidTop(getRaw(nx, ny - 1, nz))) setBlock(nx, ny, nz, ID.fire, 0, 'fire');
      }
    }
  }

  /* ------------------------------------------------------------------ random ticks */
  // Cell picking uses a private PRNG (thousands of draws per tick would otherwise shift every other lane's
  // game.rand() rolls with the number of loaded columns). It is re-seeded from game.rand whenever game.rand is
  // replaced (setRandomSeed), so tests stay reproducible. The growth rolls themselves still use game.rand().
  let rtSeed = 0, rtFrom = null;
  const rtRand = () => {
    if (rtFrom !== game.rand) { rtFrom = game.rand; rtSeed = (game.rand() * 0x100000000) >>> 0 || 1; }
    rtSeed ^= rtSeed << 13; rtSeed >>>= 0; rtSeed ^= rtSeed >>> 17; rtSeed ^= rtSeed << 5; rtSeed >>>= 0;
    return rtSeed;
  };
  let randomTicksOn = true;
  // Per column: bitmask of the sections that hold any random-ticked block (grass, crops, leaves, saplings...).
  // Underground stone and open-air sections are skipped, which halves the random-tick cost. Scanned lazily (a few
  // columns per tick; unscanned columns tick every non-empty section), bits are added on block changes and the
  // entry is dropped when the column (re)loads or unloads. Stale bits only cost a few wasted picks.
  const rtMasks = new Map();
  let rtScanBudget = 0;
  function rtMask(col) {
    const key = colKey(col.cx, col.cz);
    let m = rtMasks.get(key);
    if (m !== undefined) return m;
    if (rtScanBudget <= 0) return col.nonEmptyMask;
    rtScanBudget--;
    m = 0;
    const b = col.blocks;
    for (let s = 0; s < 8; s++) {
      if (!(col.nonEmptyMask & (1 << s))) continue;
      for (let i = s << 12, end = i + 4096; i < end; i++) if (RANDOM_TICKED[b[i] & 0xff]) { m |= 1 << s; break; }
    }
    rtMasks.set(key, m);
    return m;
  }
  function noteRandomTicked(x, y, z, id) {
    if (!RANDOM_TICKED[id & 0xff]) return;
    const key = colKey(x >> 4, z >> 4);
    const m = rtMasks.get(key);
    if (m !== undefined) rtMasks.set(key, m | (1 << (y >> 4)));
  }
  function randomTicks() {
    const w = game.world;
    if (!randomTicksOn || !w || !w.forEachColumn) return;
    const p = game.player;
    const pcx = p ? Math.floor(p.x) >> 4 : 0, pcz = p ? Math.floor(p.z) >> 4 : 0;
    const R = (w.renderDistance || 6) + 1;
    let count = 0;
    rtScanBudget = 3;
    w.forEachColumn((col) => {
      if (col.state < 2) return; // LIT
      const dx = col.cx - pcx, dz = col.cz - pcz;
      if (dx * dx + dz * dz > R * R) return;
      const mask = rtMask(col) & col.nonEmptyMask;
      if (!mask) return;
      const blocks = col.blocks;
      for (let sy = 0; sy < 8; sy++) {
        if (!(mask & (1 << sy))) continue;
        for (let k = 0; k < RANDOM_TICKS_PER_SECTION; k++) {
          const r = rtRand() & 4095;
          const lx = r & 15, lz = (r >> 4) & 15, y = (sy << 4) | (r >> 8);
          const raw = blocks[(sy << 12) | r];   // == colIndex(lx, y, lz)
          const id = raw & 0xff;
          if (RANDOM_TICKED[id]) { count++; randomTick(col.cx * 16 + lx, y, col.cz * 16 + lz, raw); }
        }
      }
    });
    stats.randomTicks += count;
  }

  const RANDOM_TICKED = new Uint8Array(256);
  for (const id of [...CROP_IDS, ...SAPLING_KIND.keys(), ...LEAF_IDS, ID.farmland, ID.sugar_cane, ID.cactus, ID.grass_block, ID.ice, ID.snow]) RANDOM_TICKED[id] = 1;

  function randomTick(x, y, z, raw) {
    const id = raw & 0xff, st = raw >>> 8;
    if (CROP_IDS.has(id)) { growCrop(x, y, z, st); return; }
    if (SAPLING_KIND.has(id)) { if (lightAt(x, y, z) >= SPREAD_LIGHT && game.rand() < 1 / 7) advanceSapling(x, y, z, 0); return; }
    if (id === ID.farmland) { farmlandTick(x, y, z, st); return; }
    if (id === ID.sugar_cane || id === ID.cactus) { tallPlantTick(x, y, z, id); return; }
    if (id === ID.grass_block) { grassTick(x, y, z); return; }
    if (LEAF_IDS.has(id)) { if (!(st & STATE.LEAVES_PERSISTENT) && !logNear(x, y, z, LEAF_R)) breakBlock(x, y, z, { by: 'decay' }); }
    if (id === ID.ice || id === ID.snow) meltTick(x, y, z, id);
  }

  /** P2: ice and snow layers melt next to strong block light (torches, glowstone, lava). */
  function meltTick(x, y, z, id) {
    let bl = game.world.getLight(x, y, z) & 15;
    if (id === ID.ice) for (let k = 1; k < 7; k++) bl = Math.max(bl, game.world.getLight(x + NB[k][0], y + NB[k][1], z + NB[k][2]) & 15);
    if (bl <= 11) return;
    if (id === ID.snow) setBlock(x, y, z, AIR, 0, 'melt', 0);
    else setBlock(x, y, z, ID.water, 0, 'melt', 0);
  }

  function growCrop(x, y, z, st) {
    const age = st & 7;
    if (age >= 7 || lightAt(x, y, z) < SPREAD_LIGHT) return;
    const below = getRaw(x, y - 1, z);
    const wet = (below & 0xff) === ID.farmland && ((below >>> 8) & 7) === 7;
    if (game.rand() < (wet ? 1 / 3 : 1 / 7)) setBlock(x, y, z, getRaw(x, y, z) & 0xff, (st & ~7) | (age + 1), 'growth', 0);
  }

  /** Water within 4 horizontal blocks at the same height or one above. */
  function hydrated(x, y, z) {
    for (let dy = 0; dy <= 1; dy++) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      if (B_LIQUID[getRaw(x + dx, y + dy, z + dz) & 0xff] === WATER) return true;
    }
    return false;
  }

  function farmlandTick(x, y, z, st) {
    const m = st & 7;
    if (hydrated(x, y, z)) { if (m !== 7) setBlock(x, y, z, ID.farmland, 7, 'growth', 0); return; }
    if (m > 0) { setBlock(x, y, z, ID.farmland, m - 1, 'growth', 0); return; }
    if (!CROP_IDS.has(getRaw(x, y + 1, z) & 0xff)) setBlock(x, y, z, ID.dirt, 0, 'growth', 0);
  }

  /**
   * Sugar cane / cactus: Java counts an age 0..15 in the block state and grows on the 16th random tick. Each age
   * step is a block change, i.e. a remesh of an unchanged-looking section, many times a minute across a loaded
   * world (and it kept CORE-D's hot sections from ever settling). Same average pace without the churn: grow with
   * chance 1/16 per random tick.
   */
  function tallPlantTick(x, y, z, id) {
    if ((getRaw(x, y + 1, z) & 0xff) !== AIR || y >= 127) return;
    let h = 1;
    while (h < 3 && (getRaw(x, y - h, z) & 0xff) === id) h++;
    if (h >= 3) return;
    if (game.rand() < 1 / 16) setBlock(x, y + 1, z, id, 0, 'growth', 0);
  }

  function grassTick(x, y, z) {
    const above = getRaw(x, y + 1, z) & 0xff;
    if (B_OPAQUE[above]) { setBlock(x, y, z, ID.dirt, 0, 'growth', 0); return; }
    if (lightAt(x, y + 1, z) < SPREAD_LIGHT) return;
    for (let i = 0; i < 4; i++) {
      const tx = x + Math.floor(game.rand() * 3) - 1, ty = y + Math.floor(game.rand() * 5) - 3, tz = z + Math.floor(game.rand() * 3) - 1;
      if ((getRaw(tx, ty, tz) & 0xff) !== ID.dirt) continue;
      const ta = getRaw(tx, ty + 1, tz) & 0xff;
      if (B_OPAQUE[ta] || B_LIQUID[ta] || lightAt(tx, ty + 1, tz) < SPREAD_LIGHT) continue;
      setBlock(tx, ty, tz, ID.grass_block, ta === ID.snow ? 1 : 0, 'growth', 0);
    }
  }

  /**
   * Breadth-first search through leaves for a log within `max` steps (leaf decay). Modern Java rule: a leaf stays
   * while a log is at most 6 steps away through leaves (CORE-B trees have leaves 5 steps out; the old radius 4 ate
   * them).
   */
  const LEAF_R = 6, LEAF_D = 2 * LEAF_R + 1, leafSeen = new Uint32Array(LEAF_D * LEAF_D * LEAF_D);
  let leafStamp = 0;
  const leafQueue = new Int32Array(LEAF_D * LEAF_D * LEAF_D * 4);
  function logNear(x, y, z, max) {
    // Never decay next to a column that is not in memory (its logs are unknown).
    const w = game.world;
    for (const [ox, oz] of [[-max, -max], [max, -max], [-max, max], [max, max]]) {
      if (w.getColumn && !w.getColumn((x + ox) >> 4, (z + oz) >> 4)) return true;
    }
    stats.leafChecks++;
    leafStamp = (leafStamp + 1) >>> 0 || 1;
    let head = 0, tail = 0;
    const idx = (dx, dy, dz) => (dx + LEAF_R) + LEAF_D * ((dz + LEAF_R) + LEAF_D * (dy + LEAF_R));
    leafSeen[idx(0, 0, 0)] = leafStamp;
    leafQueue[tail++] = 0; leafQueue[tail++] = 0; leafQueue[tail++] = 0; leafQueue[tail++] = 0;
    while (head < tail) {
      const dx = leafQueue[head++], dy = leafQueue[head++], dz = leafQueue[head++], dist = leafQueue[head++];
      for (let k = 1; k < 7; k++) {
        const nx = dx + NB[k][0], ny = dy + NB[k][1], nz = dz + NB[k][2];
        if (Math.abs(nx) > LEAF_R || Math.abs(ny) > LEAF_R || Math.abs(nz) > LEAF_R) continue;
        const i = idx(nx, ny, nz);
        if (leafSeen[i] === leafStamp) continue;
        leafSeen[i] = leafStamp;
        const nid = getRaw(x + nx, y + ny, z + nz) & 0xff;
        if (LOG_IDS.has(nid)) return true;
        if (LEAF_IDS.has(nid) && dist + 1 < max) { leafQueue[tail++] = nx; leafQueue[tail++] = ny; leafQueue[tail++] = nz; leafQueue[tail++] = dist + 1; }
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ saplings and trees */
  function advanceSapling(x, y, z, action) {
    const raw = getRaw(x, y, z), id = raw & 0xff, st = raw >>> 8;
    const kind = SAPLING_KIND.get(id);
    if (!kind) return false;
    if (!(st & 1)) return setBlock(x, y, z, id, st | 1, 'growth', action);
    return growTree(x, y, z, kind, action);
  }

  function growTree(x, y, z, kind, action) {
    const w = game.world;
    const get = (gx, gy, gz) => (gx === x && gy === y && gz === z ? AIR : getRaw(gx, gy, gz) & 0xff);
    const set = (sx, sy, sz, id, state = 0) => {
      if (sy < 0 || sy > 127) return;
      const cur = getRaw(sx, sy, sz) & 0xff;
      const base = sx === x && sy === y && sz === z;
      if (base || cur === AIR || isReplaceable(cur) || LEAF_IDS.has(cur)) w.setBlock(sx, sy, sz, id, state, { cause: 'growth', action });
    };
    w.beginBatch();
    let ok = false;
    try { ok = placeTree(set, get, x, y, z, kind, game.rand); } finally { w.endBatch(); }
    if (ok) game.events.emit('mech:tree', { x, y, z, kind });
    return !!ok;
  }

  /* ------------------------------------------------------------------ bone meal */
  function applyBoneMeal(x, y, z, opts = {}) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    const raw = getRaw(x, y, z), id = raw & 0xff, st = raw >>> 8;
    const action = opts.action | 0;
    let applied = false;
    if (CROP_IDS.has(id)) {
      const age = st & 7;
      if (age < 7) {
        const next = Math.min(7, age + 2 + Math.floor(game.rand() * 4));
        setBlock(x, y, z, id, (st & ~7) | next, 'growth', action);
        applied = true;
      }
    } else if (SAPLING_KIND.has(id)) {
      if (game.rand() < 0.45) advanceSapling(x, y, z, action);
      applied = true;
    } else if (id === ID.grass_block && (getRaw(x, y + 1, z) & 0xff) === AIR) {
      const w = game.world;
      w.beginBatch();
      try {
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
          for (let dy = 1; dy >= -1; dy--) {
            const gx = x + dx, gy = y + dy, gz = z + dz;
            if ((getRaw(gx, gy, gz) & 0xff) !== ID.grass_block || (getRaw(gx, gy + 1, gz) & 0xff) !== AIR) continue;
            const r = game.rand();
            if ((dx || dz) && r < 0.45) break;
            const plant = r < 0.85 ? ID.short_grass : FLOWER_IDS[Math.floor(game.rand() * FLOWER_IDS.length)];
            setBlock(gx, gy + 1, gz, plant, 0, 'growth', action);
            break;
          }
        }
      } finally { w.endBatch(); }
      applied = true;
    }
    if (applied) game.events.emit('bonemeal', { x, y, z });
    return applied;
  }

  /* ------------------------------------------------------------------ TNT and explosions */
  function primeTnt(x, y, z, fuse = 80, opts = {}) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if ((getRaw(x, y, z) & 0xff) !== ID.tnt || !game.entities) return null;
    const action = opts.action || newAction();
    if (!breakBlock(x, y, z, { by: opts.by || 'tnt', drops: false, action })) return null;
    const e = game.entities.spawn('tnt', x + 0.5, y, z + 0.5, { fuse, action, reason: 'primed', source: opts.source });
    if (!e) return null;
    stats.tntPrimed++;
    game.events.emit('tnt:primed', { id: e.id, x: x + 0.5, y, z: z + 0.5, fuse });
    return e;
  }

  function explode(x, y, z, power, opts = {}) {
    if (explosionsThisTick >= MAX_EXPLOSIONS_PER_TICK && !opts.now) {
      explosionQueue.push([x, y, z, power, opts]);
      return 0;
    }
    explosionsThisTick++;
    return resolveExplosion(x, y, z, power, opts);
  }

  function resolveExplosion(x, y, z, power, opts) {
    const t0 = performance.now();
    const r = rules();
    const source = opts.source || 'test';
    const ruleBreak = source === 'tnt' ? r.tntExplodes !== false : source === 'creeper' ? !!r.mobGriefing : true;
    const harmless = source === 'tnt' && r.tntExplodes === false && opts.breakBlocks === undefined;
    let breakBlocks = opts.breakBlocks ?? ruleBreak;
    if (centreInFluid(getRaw, x, y, z)) breakBlocks = false;
    const action = newAction();
    const blocks = [];
    let items = 0;
    const w = game.world;
    if (breakBlocks && w) {
      const { cells, count } = explosionCells(getRaw, x, y, z, power, game.rand);
      const dropInto = [];
      const dropRule = !!r.dropItemsOnBreak;
      w.beginBatch();
      try {
        for (let k = 0; k < count; k++) {
          const bx = cells[k * 4], by = cells[k * 4 + 1], bz = cells[k * 4 + 2];
          const raw = getRaw(bx, by, bz), id = raw & 0xff;
          if (id === AIR || B_LIQUID[id]) continue;
          if (id === ID.tnt) {
            if (primeTnt(bx, by, bz, 10 + Math.floor(game.rand() * 21), { action, by: 'explosion' })) blocks.push({ x: bx, y: by, z: bz, id, state: raw >>> 8 });
            continue;
          }
          const drops = dropRule && (source !== 'creeper' || game.rand() < 1 / power);
          if (breakBlock(bx, by, bz, { by: 'explosion', action, drops, dropInto, toolDef: drops ? blastTool(id) : null })) blocks.push({ x: bx, y: by, z: bz, id, state: raw >>> 8 });
        }
        if (opts.fire) {
          for (const b of blocks) {
            if (game.rand() < 1 / 3 && (getRaw(b.x, b.y, b.z) & 0xff) === AIR && hasSolidTop(getRaw(b.x, b.y - 1, b.z))) setBlock(b.x, b.y, b.z, ID.fire, 0, 'explosion', action);
          }
        }
      } finally { w.endBatch(); }
      items = spawnMergedDrops(dropInto);
    }
    if (!harmless) hurtAround(x, y, z, power, source);
    stats.explosions++;
    stats.lastExplosion = { x, y, z, power, source, count: blocks.length, items, ms: Math.round((performance.now() - t0) * 100) / 100, harmless };
    game.events.emit('explosion', { x, y, z, power, source, action, count: blocks.length, blocks, harmless });
    return blocks.length;
  }

  /** Merge explosion drops by item and spawn at most 32 item entities spread over the blast. */
  function spawnMergedDrops(list) {
    if (!list.length) return 0;
    const groups = new Map();
    for (const d of list) {
      const s = d.stack;
      const key = s.item + (s.damage ? '#' + s.damage : '');
      let g = groups.get(key);
      if (!g) { g = { item: s.item, damage: s.damage, count: 0, pos: [] }; groups.set(key, g); }
      g.count += s.count;
      if (g.pos.length < 16) g.pos.push(d);
    }
    let out = [];
    for (const g of groups.values()) {
      const max = maxStack(g.item);
      for (let left = g.count; left > 0; left -= max) out.push({ g, count: Math.min(max, left) });
    }
    if (out.length > MAX_DROP_ENTITIES) {
      out = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_DROP_ENTITIES).map((g) => ({ g, count: g.count }));
    }
    for (const o of out) {
      const p = o.g.pos[Math.floor(game.rand() * o.g.pos.length)];
      const stack = { item: o.g.item, count: o.count };
      if (o.g.damage) stack.damage = o.g.damage;
      dropItem(game, stack, p.x, p.y, p.z, { vx: (game.rand() - 0.5) * 0.2, vy: 0.2 + game.rand() * 0.1, vz: (game.rand() - 0.5) * 0.2 });
    }
    return out.length;
  }

  function hurtAround(x, y, z, power, source) {
    const reach = power * 2;
    if (game.entities) {
      for (const e of game.entities.queryRadius(x, y, z, reach + 2)) {
        if (e.removed || e.type === 'item') continue;
        const dist = Math.hypot(e.x - x, e.y - y, e.z - z);
        const impact = impactOf(dist, power, exposure(getRaw, x, y, z, e.getBox(boxTmp)));
        if (impact <= 0) continue;
        push(e, x, y, z, e.height * 0.85, impact);
        if (e.type === 'tnt' || e.type === 'falling_block') continue;
        try { e.hurt(damageOf(impact, power), { type: 'explosion', source }); } catch (err) { game.reportError(err, 'mechanics explosion hurt'); }
      }
    }
    const p = game.player;
    if (p && !p.dead) {
      const hw = (p.width || 0.6) / 2;
      const box = { minX: p.x - hw, minY: p.y, minZ: p.z - hw, maxX: p.x + hw, maxY: p.y + (p.height || 1.8), maxZ: p.z + hw };
      const dist = Math.hypot(p.x - x, p.y - y, p.z - z);
      const impact = impactOf(dist, power, exposure(getRaw, x, y, z, box));
      if (impact > 0) {
        if (!p.flying) push(p, x, y, z, p.eyeHeight || 1.62, impact);
        let dmg = damageOf(impact, power);
        // a mob's blast scales with difficulty like Java (easy: half + 1); the player's own TNT does not
        // (moved here from the creeper's stub-era fallback when the lanes were merged)
        if (source === 'creeper' && game.meta && game.meta.difficulty === 'easy') dmg = Math.min(dmg, Math.floor(dmg / 2) + 1);
        if (game.survival) game.survival.damage(dmg, 'explosion', { type: 'explosion', source });
      }
    }
  }

  function push(b, x, y, z, eye, impact) {
    let dx = b.x - x, dy = b.y + eye - y, dz = b.z - z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) { dx = 0; dy = 1; dz = 0; } else { dx /= l; dy /= l; dz /= l; }
    b.vx = (b.vx || 0) + dx * impact; b.vy = (b.vy || 0) + dy * impact; b.vz = (b.vz || 0) + dz * impact;
  }

  /* ------------------------------------------------------------------ beds and sleep */
  function trySleep(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (sleep) return { ok: false, nap: false, reason: 'sleeping' };
    if ((getRaw(x, y, z) & 0xff) !== ID.bed) return { ok: false, nap: false, reason: 'no_bed' };
    const r = rules();
    if (!r.daylightCycle) {
      startSleep(x, y, z, true);
      return { ok: true, nap: true, reason: null };
    }
    if (!isNight()) return { ok: false, nap: false, reason: 'not_night' };
    if (game.entities && game.entities.queryBox(x - 8, y - 5, z - 8, x + 9, y + 6, z + 9, null, (e) => e.category === 'monster' && e.deathTime === 0).length) {
      return { ok: false, nap: false, reason: 'monsters' };
    }
    startSleep(x, y, z, false);
    return { ok: true, nap: false, reason: null };
  }

  function startSleep(x, y, z, nap) {
    sleep = { nap, ticks: 0, x, y, z };
    if (game.player) { game.player.sleeping = true; game.player.vx = game.player.vy = game.player.vz = 0; }
    if (nap && game.time) game.time.setTime(18000);
    game.events.emit('sleep:start', { nap });
    game.events.emit('player:sleep', { sleeping: true, nap });
  }

  function endSleep(completed) {
    const s = sleep;
    sleep = null;
    if (!s) return;
    if (game.time) {
      if (s.nap) game.time.setTime(KID_LOCKED_TIME);
      else if (completed) game.time.setTime(0);
    }
    if (game.player) game.player.sleeping = false;
    game.events.emit('sleep:end', { nap: s.nap });
    game.events.emit('player:sleep', { sleeping: false, nap: s.nap });
  }

  function sleepTick() {
    if (!sleep) return;
    sleep.ticks++;
    if ((getRaw(sleep.x, sleep.y, sleep.z) & 0xff) !== ID.bed && loaded(sleep.x, sleep.z)) { endSleep(false); return; }
    if (sleep.ticks >= (sleep.nap ? KID.NAP_TICKS : SLEEP_TICKS)) endSleep(true);
  }

  /* ------------------------------------------------------------------ water current */
  function waterPush() {
    const push1 = (b, h) => {
      const fx = Math.floor(b.x), fy = Math.floor(b.y + h), fz = Math.floor(b.z);
      const raw = getRaw(fx, fy, fz);
      if (B_LIQUID[raw & 0xff] !== WATER || (raw >>> 8) === 0) return;
      flowVector(getRaw, fx, fy, fz, flowTmp);
      if (!flowTmp.x && !flowTmp.z) return;
      b.vx = (b.vx || 0) + flowTmp.x * 0.014;
      b.vz = (b.vz || 0) + flowTmp.z * 0.014;
    };
    const p = game.player;
    if (p && !p.flying) push1(p, 0.1);
    if (game.entities) game.entities.forEach((e) => { if (!e.removed && e.type !== 'tnt' && e.type !== 'falling_block' && e.type !== 'painting') push1(e, 0.1); });
  }

  /* ------------------------------------------------------------------ system */
  const mech = {
    name: 'mechanics',
    /** world.getRaw bound (used by MECH entities) */
    getRaw,
    /** pending scheduled ticks (debug) */
    scheduler: sched,
    stats,

    init() {
      registerMechEntityTypes();
      registerMechHooks(game, mech);
      registerPaintings(game, mech);
      game.events.on('block:changed', onBlockChanged);
      game.events.on('world:exit', () => reset());
      game.events.on('world:columnUnloaded', (e) => {
        rtMasks.delete(colKey(e.cx, e.cz));
        for (const t of sched.removeWhere((t) => (t.x >> 4) === e.cx && (t.z >> 4) === e.cz)) parkTick(t);
      });
      game.events.on('world:columnLoaded', (e) => {
        const key = colKey(e.cx, e.cz);
        rtMasks.delete(key);
        const list = parked.get(key);
        if (!list) return;
        parked.delete(key);
        for (const [x, y, z, kind, delay, action] of list) schedule(x, y, z, delay, kind, action);
      });
      game.events.on('player:land', (e) => {
        if (game.isCreative() || !(e.fallDistance > 1)) return;
        const fx = Math.floor(e.x), fz = Math.floor(e.z);
        for (const fy of [Math.floor(e.y - 0.05), Math.floor(e.y)]) {
          if ((getRaw(fx, fy, fz) & 0xff) === ID.farmland && game.rand() < e.fallDistance - 0.5) { setBlock(fx, fy, fz, ID.dirt, 0, 'trample', 0); break; }
        }
      });
    },

    tick() {
      if (!game.world || !game.world.isOpen) return;
      explosionsThisTick = 0;
      if (explosionQueue.length) {
        const q = explosionQueue;
        explosionQueue = [];
        for (const item of q) {
          if (explosionsThisTick >= MAX_EXPLOSIONS_PER_TICK) { explosionQueue.push(item); continue; }
          explosionsThisTick++;
          resolveExplosion(item[0], item[1], item[2], item[3], item[4]);
        }
      }
      const w = game.world;
      w.beginBatch();
      try {
        const t0 = performance.now();
        runScheduled();
        const t1 = performance.now();
        randomTicks();
        stats.schedMs += t1 - t0; stats.randomMs += performance.now() - t1;
      } finally { w.endBatch(); }
      waterPush();
      sleepTick();
    },

    /**
     * Explode at (x,y,z) with power (TNT 4, creeper 3). opts: {source: 'tnt'|'creeper'|'test', breakBlocks?:
     * boolean (default rules.tntExplodes / mobGriefing), fire?: boolean, now?: boolean (ignore the 2-per-tick cap)}.
     * ONE action id for all breaks, one batch, drops merged into <= 32 item entities. Emits 'explosion'
     * {x, y, z, power, source, action, count, blocks, harmless}. Returns the number of blocks destroyed
     * (0 when queued because 2 explosions already resolved this tick).
     */
    explode,
    /** Explode at the next free slot (TNT entities use this through explode()). */
    queueExplosion(x, y, z, power, opts = {}) { return explode(x, y, z, power, opts); },
    /** Replace a TNT block with a primed TNT entity (fuse ticks, default 80). opts: {action, by}. Emits 'tnt:primed'. */
    primeTnt,
    /** Schedule a block update (neighbour check: support, falling, fluids, connections) at (x,y,z) in `delay` ticks. */
    scheduleTick(x, y, z, delay = 1, kind = TICK_KIND.NEIGHBOR, action = 0) { schedule(Math.floor(x), Math.floor(y), Math.floor(z), delay, kind, action); },
    /** Grow the crop/sapling/grass at (x,y,z) as if bone-mealed. True when bone meal applies (and is used up). */
    applyBoneMeal,
    /**
     * Try to sleep in the bed at (x,y,z). {ok, nap, reason: 'not_night'|'monsters'|'no_bed'|'sleeping'|null}.
     * Kid default (daylightCycle off): always a nap - starry sky for KID.NAP_TICKS, then back to 09:00.
     */
    trySleep,
    /** Test/debug switch: false pauses random ticks (growth, grass, leaf decay, melting). Not saved. */
    setRandomTicks(on) { randomTicksOn = !!on; return randomTicksOn; },
    /** Current sleep {nap, ticks, x, y, z} or null. */
    sleeping() { return sleep ? { ...sleep } : null; },
    /** Falling block landing (called by the falling_block entity). */
    landFallingBlock,
    /** Grow the sapling at (x,y,z) one stage (stage 1 grows the tree). */
    advanceSapling(x, y, z, action = 0) { return advanceSapling(Math.floor(x), Math.floor(y), Math.floor(z), action); },

    serialize() {
      const now = game.tickCount;
      const parkedList = [];
      for (const list of parked.values()) for (const r of list) if (parkedList.length < 4096) parkedList.push(r);
      return {
        v: 1,
        ticks: sched.toJSON(now, 4096),
        parked: parkedList,
        explosions: explosionQueue.map(([x, y, z, power, opts]) => [x, y, z, power, { source: opts.source, breakBlocks: opts.breakBlocks, fire: opts.fire }]),
      };
    },
    deserialize(g, data) {
      reset();
      if (!data || data.v !== 1) return;
      sched.fromJSON(game.tickCount, data.ticks);
      if (Array.isArray(data.parked)) for (const r of data.parked) if (Array.isArray(r)) parkTick({ x: r[0], y: r[1], z: r[2], kind: r[3], action: r[5] || 0 });
      if (Array.isArray(data.explosions)) explosionQueue = data.explosions.filter((e) => Array.isArray(e) && e.length >= 4).map((e) => [e[0], e[1], e[2], e[3], e[4] || {}]);
    },
  };

  function reset() {
    sched.clear();
    rtMasks.clear();
    parked.clear();
    explosionQueue = [];
    if (sleep && game.player) game.player.sleeping = false;
    sleep = null;
  }

  return mech;
}

