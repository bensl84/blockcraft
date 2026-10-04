// OWNER LANE: FEATURE-MECH. Unit tests for block mechanics (SPEC §2.5, §8.6): scheduler, fluids, falling blocks,
// support, doors, beds, farming and growth, explosions, TNT chains, fences, leaves, grass, buckets, slabs, fire.
// Runs the real mechanics system against a small in-memory world and an interaction double that follows the
// frozen breakBlock/placeBlock contract (SPEC §7.4), so it does not depend on other lanes' stubs.
import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { DEFAULT_RULES, SURVIVAL_RULES, colIndex, colKey, packBlock, FACE } from '../src/core/constants.js';
import { ID, isReplaceable, rollDrops, B_HARDNESS, connectionState } from '../src/core/registry.js';
import { mulberry32 } from '../src/core/math.js';
import { Inventory } from '../src/inventory/inventory.js';
import { createEntitySystem } from '../src/entities/entity.js';
import { createMechanicsSystem } from '../src/mechanics/mechanics.js';
import { TickScheduler, TICK_KIND } from '../src/mechanics/scheduler.js';
import { fluidTick, flowDirections, FLUID_PARAMS } from '../src/mechanics/fluids.js';
import { RAY_COUNT, damageOf, explosionCells, impactOf } from '../src/mechanics/explosion.js';
import { supportStatus, hasSolidTop } from '../src/mechanics/rules.js';
import { rayCells } from '../src/mechanics/raycells.js';
import { PICTURES, choosePicture } from '../src/mechanics/painting.js';
import { UndoLog } from '../src/kid/undo.js';

/* ------------------------------------------------------------------ harness */
const R = 3; // columns -R..R loaded

function makeGame(opts = {}) {
  const mode = opts.mode || 'creative';
  const events = new EventBus();
  const cols = new Map();
  let batch = 0;
  const batches = { begun: 0, ended: 0 };
  for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) {
    const blocks = new Uint16Array(32768);
    if (opts.flat !== false) {
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
        blocks[colIndex(x, 0, z)] = ID.bedrock;
        blocks[colIndex(x, 1, z)] = ID.dirt; blocks[colIndex(x, 2, z)] = ID.dirt;
        blocks[colIndex(x, 3, z)] = opts.ground ?? ID.grass_block;
      }
    }
    cols.set(colKey(cx, cz), { cx, cz, state: 3, nonEmptyMask: 255, blocks, blockEntities: new Map() });
  }
  const col = (x, z) => cols.get(colKey(Math.floor(x) >> 4, Math.floor(z) >> 4));
  const world = {
    isOpen: true, renderDistance: 3,
    getColumn: (cx, cz) => cols.get(colKey(cx, cz)) || null,
    isColumnLoaded: (cx, cz) => cols.has(colKey(cx, cz)),
    forEachColumn: (fn) => { for (const c of cols.values()) fn(c); },
    getRaw(x, y, z) { if (y < 0 || y > 127) return 0; const c = col(x, z); return c ? c.blocks[colIndex(Math.floor(x) & 15, Math.floor(y), Math.floor(z) & 15)] : 0; },
    getBlock(x, y, z) { return world.getRaw(x, y, z) & 0xff; },
    getState(x, y, z) { return world.getRaw(x, y, z) >> 8; },
    getLight: () => opts.light ?? 0xf0,
    getBlockEntity: () => null,
    setBlock(x, y, z, id, state = 0, o = {}) {
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      if (y < 0 || y > 127) return false;
      const c = col(x, z);
      if (!c) return false;
      const i = colIndex(x & 15, y, z & 15), old = c.blocks[i], nv = packBlock(id, state);
      if (old === nv) return false;
      c.blocks[i] = nv;
      if (!o.silent) events.emit('block:changed', { x, y, z, oldId: old & 0xff, oldState: old >> 8, id: id & 0xff, state: state & 0xff, cause: o.cause || 'unknown', action: o.action | 0 });
      return true;
    },
    beginBatch() { batch++; batches.begun++; },
    endBatch() { if (batch > 0) { batch--; batches.ended++; } },
    inBatch: () => batch > 0,
  };
  const game = {
    events, world, tickCount: 0, frameCount: 0, renderer: null, audio: null,
    meta: { mode, rules: { ...DEFAULT_RULES, ...(mode === 'survival' ? SURVIVAL_RULES : {}), ...(opts.rules || {}) }, spawn: { x: 0.5, y: 4, z: 0.5 } },
    isCreative: () => game.meta.mode === 'creative',
    rand: mulberry32(opts.seed ?? 1),
    errors: [],
    reportError(err, where) { game.errors.push(`${where}: ${err && err.message}`); },
    drops: [],
    batches,
    time: {
      dayTime: 3000,
      isNight() { return this.dayTime >= 12542 && this.dayTime <= 23459; },
      setTime(t) { this.dayTime = ((t % 24000) + 24000) % 24000; events.emit('time:set', { dayTime: this.dayTime }); },
    },
    player: { x: 0.5, y: 4, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, width: 0.6, height: 1.8, eyeHeight: 1.62, flying: false, food: 20, sleeping: false, spawnPoint: { x: 0.5, y: 4, z: 0.5 }, swing() {} },
    survival: { damaged: [], damage(a, c) { this.damaged.push([a, c]); return game.meta.mode === 'survival'; }, addFood() {} },
  };
  game.inventory = new Inventory(events);
  let seq = 0;
  game.interaction = {
    newAction: () => ++seq,
    reach: () => 5,
    getAimRay(out = {}) {
      const p = game.player, cp = Math.cos(p.pitch);
      out.ox = p.x; out.oy = p.y + p.eyeHeight; out.oz = p.z;
      out.dx = -Math.sin(p.yaw) * cp; out.dy = Math.sin(p.pitch); out.dz = -Math.cos(p.yaw) * cp;
      return out;
    },
    breakBlock(x, y, z, o = {}) {
      const v = world.getRaw(x, y, z), id = v & 0xff, state = v >> 8, by = o.by || 'player';
      if (id === 0) return false;
      if (B_HARDNESS[id] < 0 && !(game.isCreative() && y > 0 && (by === 'player' || by === 'test'))) return false;
      const doDrops = o.drops ?? (!game.isCreative() && !!game.meta.rules.dropItemsOnBreak);
      const drops = doDrops ? rollDrops(id, state, game.rand, o.toolDef ?? null) : [];
      const action = o.action || game.interaction.newAction();
      if (!world.setBlock(x, y, z, 0, 0, { cause: by, action })) return false;
      events.emit('block:broken', { x, y, z, id, state, by, drops, blockEntity: null, action });
      for (const s of drops) { if (o.dropInto) o.dropInto.push({ stack: s, x: x + 0.5, y: y + 0.5, z: z + 0.5 }); else game.drops.push(s); }
      return true;
    },
    placeBlock(x, y, z, id, state = 0, o = {}) {
      const cur = world.getRaw(x, y, z);
      if (!o.force && (!isReplaceable(cur & 0xff) || cur === packBlock(id, state))) return false;
      const action = o.action || game.interaction.newAction();
      if (!world.setBlock(x, y, z, id, state, { cause: o.by || 'player', action })) return false;
      events.emit('block:placed', { x, y, z, id, state, by: o.by || 'player', item: o.item || null, oldId: cur & 0xff, oldState: cur >> 8, action });
      return true;
    },
  };
  game.entities = createEntitySystem(game);
  game.entities.init(game);
  game.mechanics = createMechanicsSystem(game);
  game.mechanics.init(game);
  game.mechanics.deserialize(game, undefined);
  game.step = (n = 1) => { for (let i = 0; i < n; i++) { game.tickCount++; game.mechanics.tick(game); game.entities.tick(game); } };
  game.set = (x, y, z, name, st = 0, cause = 'test', action = 0) => world.setBlock(x, y, z, typeof name === 'number' ? name : ID[name], st, { cause, action });
  game.get = (x, y, z) => world.getRaw(x, y, z) & 0xff;
  game.st = (x, y, z) => world.getRaw(x, y, z) >> 8;
  game.log = (name) => { const out = []; events.on(name, (p) => out.push(p)); return out; };
  return game;
}

/* ------------------------------------------------------------------ scheduler */
test('scheduler: min-heap order, dedup per cell+kind, action adoption, JSON roundtrip', () => {
  const s = new TickScheduler();
  assert.ok(s.schedule(0, 1, 2, 3, 5, TICK_KIND.FLUID, 0));
  assert.ok(!s.schedule(0, 1, 2, 3, 9, TICK_KIND.FLUID, 7), 'later duplicate ignored');
  assert.ok(s.schedule(0, 1, 2, 3, 2, TICK_KIND.NEIGHBOR, 3), 'other kind is separate');
  assert.ok(s.schedule(0, 9, 9, 9, 1, 0, 0));
  assert.ok(s.schedule(0, 1, 2, 3, 3, TICK_KIND.FLUID, 0), 'earlier duplicate replaces');
  assert.equal(s.size, 3);
  assert.equal(s.popDue(0), null);
  const a = s.popDue(10), b = s.popDue(10), c = s.popDue(10);
  assert.deepEqual([a.x, b.kind, c.t], [9, TICK_KIND.NEIGHBOR, 3]);
  assert.equal(c.action, 7, 'adopted the action of the ignored duplicate');
  assert.equal(s.popDue(10), null);
  s.schedule(100, 4, 5, 6, 4, TICK_KIND.FIRE, 11);
  const s2 = new TickScheduler();
  s2.fromJSON(200, s.toJSON(100));
  const e = s2.popDue(204);
  assert.deepEqual([e.x, e.y, e.z, e.kind, e.action, e.t], [4, 5, 6, TICK_KIND.FIRE, 11, 204]);
});

/* ------------------------------------------------------------------ fluids */
test('water: a source on flat ground spreads to distance 7 (level 7) and no further, within 200 ticks', () => {
  const g = makeGame();
  g.set(0, 4, 0, 'water', 0, 'player', 5);
  g.step(200);
  for (let d = 1; d <= 7; d++) {
    for (const [x, z] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
      assert.equal(g.get(x, 4, z), ID.water, `water at distance ${d} (${x},${z})`);
      assert.equal(g.st(x, 4, z), d, `level ${d} at (${x},${z})`);
    }
  }
  assert.equal(g.get(8, 4, 0), ID.air, 'distance 8 stays dry');
  assert.equal(g.get(4, 4, 4), ID.air, 'diamond shape (manhattan 8)');
  assert.equal(g.get(3, 4, 4), ID.water, 'manhattan 7 is wet');
  assert.ok(g.batches.begun > 0 && g.batches.begun === g.batches.ended, 'fluid ticks run inside paired batches');
  assert.deepEqual(g.errors, []);
});

test('water: flowing water carries the action of the change that started it', () => {
  const g = makeGame();
  const changes = g.log('block:changed');
  g.set(0, 4, 0, 'water', 0, 'player', 42);
  g.step(60);
  const fluid = changes.filter((c) => c.cause === 'fluid');
  assert.ok(fluid.length > 20);
  assert.ok(fluid.every((c) => c.action === 42), 'every follow-up change has action 42');
});

test('water: removing the source dries the flow; two sources make an infinite source', () => {
  const g = makeGame();
  g.set(0, 4, 0, 'water');
  g.step(120);
  g.set(0, 4, 0, 'air');
  g.step(200);
  for (let d = 0; d <= 8; d++) assert.equal(g.get(d, 4, 0), ID.air, `dry at ${d}`);
  const h = makeGame();
  h.set(0, 4, 0, 'water'); h.set(2, 4, 0, 'water');
  h.step(60);
  assert.equal(h.get(1, 4, 0), ID.water);
  assert.equal(h.st(1, 4, 0), 0, 'the cell between two sources on solid ground becomes a source');
});

test('water: falls down a pillar edge, prefers a nearby drop, washes away torches and crops', () => {
  const g = makeGame();
  // platform at y 8 from x -1..1, z -1..1 ; source on top
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) g.set(x, 8, z, 'stone');
  g.set(0, 9, 0, 'water');
  g.step(150);
  assert.equal(g.get(2, 9, 0), ID.water, 'spills over the edge');
  assert.equal(g.get(2, 8, 0), ID.water);
  assert.ok(g.st(2, 8, 0) & 8, 'falling water has bit 3');
  assert.equal(g.get(2, 4, 0), ID.water, 'reaches the ground');
  // drop preference: on flat ground with a hole 2 blocks east, water heads only east
  const h = makeGame();
  h.set(2, 3, 0, 'air'); h.set(2, 2, 0, 'air');
  h.set(0, 4, 0, 'water');
  h.step(12);
  assert.equal(h.get(1, 4, 0), ID.water, 'flows toward the drop');
  assert.equal(h.get(-1, 4, 0), ID.air, 'not away from the drop');
  // washing
  const w = makeGame();
  w.set(2, 4, 0, 'torch'); w.set(1, 3, 0, 'farmland', 7); w.set(1, 4, 0, 'wheat', 3);
  const broken = w.log('block:broken');
  w.set(0, 4, 0, 'water');
  w.step(40);
  assert.equal(w.get(2, 4, 0), ID.water, 'torch washed away');
  assert.equal(w.get(1, 4, 0), ID.water, 'crop washed away');
  assert.ok(broken.some((b) => b.by === 'fluid' && b.id === ID.torch));
});

test('lava: slow (30 ticks), 3 blocks, obsidian / cobblestone / stone with water', () => {
  const g = makeGame();
  g.set(0, 4, 0, 'lava');
  g.step(25);
  assert.equal(g.get(1, 4, 0), ID.air, 'lava has not moved after 25 ticks');
  g.step(200);
  assert.equal(g.get(1, 4, 0), ID.lava); assert.equal(g.st(1, 4, 0), 2);
  assert.equal(g.get(3, 4, 0), ID.lava); assert.equal(g.st(3, 4, 0), 6);
  assert.equal(g.get(4, 4, 0), ID.air, 'lava reaches 3 blocks');
  // water next to the source -> obsidian; flowing lava touched by water -> cobblestone
  g.set(0, 4, 1, 'water');
  g.step(3);
  assert.equal(g.get(0, 4, 0), ID.obsidian, 'lava source + water = obsidian');
  const h = makeGame();
  h.set(0, 4, 0, 'lava', 2);
  h.set(1, 4, 0, 'water');
  h.step(3);
  assert.equal(h.get(0, 4, 0), ID.cobblestone, 'flowing lava + water = cobblestone');
  // the thin tip of a flow (level 6) hardens too: the classic cobblestone generator (judge FID-9)
  const tip = makeGame();
  tip.set(0, 4, 0, 'lava');
  tip.step(200);
  assert.equal(tip.get(3, 4, 0), ID.lava); assert.equal(tip.st(3, 4, 0), 6);
  tip.set(4, 4, 0, 'water');
  tip.step(40);
  assert.equal(tip.get(3, 4, 0), ID.cobblestone, 'lava tip (level 6) + water = cobblestone');
  assert.equal(tip.get(0, 4, 0), ID.lava, 'the source keeps flowing');
  const k = makeGame();
  k.set(0, 4, 0, 'water'); k.set(0, 6, 0, 'lava'); k.set(0, 5, 0, 'air');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) if (x || z) k.set(x, 6, z, 'stone'); // keep the lava from spreading sideways first
  k.set(0, 7, 0, 'stone');
  k.step(80);
  assert.equal(k.get(0, 4, 0), ID.stone, 'lava flowing down onto water makes stone');
});

test('fluids: pure flowDirections and fluidTick on a Map grid', () => {
  const m = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const acc = {
    get: (x, y, z) => m.get(key(x, y, z)) ?? (y <= 3 ? ID.stone : 0),
    set: (x, y, z, id, st) => m.set(key(x, y, z), packBlock(id, st)),
    wash: () => {},
  };
  m.set(key(0, 4, 0), ID.water);
  m.set(key(0, 3, -3), 0); // drop 3 north
  const dirs = flowDirections(acc, ID.water, 0, 4, 0, FLUID_PARAMS[1].slope);
  assert.deepEqual(dirs, [0], 'only north (toward the drop)');
  fluidTick(acc, 0, 4, 0);
  assert.equal(acc.get(0, 4, -1), packBlock(ID.water, 1));
  assert.equal(acc.get(1, 4, 0), 0);
});

/* ------------------------------------------------------------------ falling blocks */
test('sand placed 5 above the ground falls as an entity and lands within 40 ticks (action carried)', () => {
  const g = makeGame();
  const changes = g.log('block:changed');
  g.set(0, 9, 0, 'sand', 0, 'player', 77);
  g.step(3);
  assert.equal(g.get(0, 9, 0), ID.air, 'lifted off after 2-3 ticks');
  assert.equal(g.entities.ofType('falling_block').length, 1);
  g.step(37);
  assert.equal(g.get(0, 4, 0), ID.sand, 'rests on the ground');
  assert.equal(g.entities.ofType('falling_block').length, 0);
  const landed = changes.find((c) => c.y === 4 && c.id === ID.sand);
  assert.equal(landed.action, 77);
  // stacked gravel falls together; a torch in the landing cell turns it into an item (no block placed)
  const h = makeGame({ mode: 'survival' });
  h.set(0, 4, 0, 'torch');
  h.set(0, 7, 0, 'gravel');
  h.step(40);
  assert.equal(h.get(0, 4, 0), ID.torch, 'torch untouched');
  assert.equal(h.get(0, 5, 0), ID.air);
});

/* ------------------------------------------------------------------ support */
test('support: breaking the block under a torch pops it with the same action', () => {
  const g = makeGame();
  g.set(0, 4, 0, 'stone');
  g.set(0, 5, 0, 'torch', 0);
  g.set(1, 4, 0, 'torch', 4); // wall torch attached to the stone to its west (state 1 + W)
  const changes = g.log('block:changed');
  g.interaction.breakBlock(0, 4, 0, { by: 'player', action: 900 });
  g.step(2);
  assert.equal(g.get(0, 5, 0), ID.air, 'floor torch fell off');
  assert.equal(g.get(1, 4, 0), ID.air, 'wall torch fell off');
  const torchChanges = changes.filter((c) => c.oldId === ID.torch);
  assert.equal(torchChanges.length, 2);
  assert.ok(torchChanges.every((c) => c.action === 900 && c.cause === 'support'));
});

test('support predicates: crops need farmland, sugar cane needs water, ladders need a wall', () => {
  const g = makeGame();
  const get = (x, y, z) => g.world.getRaw(x, y, z);
  g.set(0, 4, 0, 'wheat');
  assert.equal(supportStatus(get, 0, 4, 0), 'support', 'wheat on grass');
  g.set(0, 3, 0, 'farmland');
  assert.equal(supportStatus(get, 0, 4, 0), 'ok');
  g.set(2, 4, 0, 'sugar_cane');
  assert.equal(supportStatus(get, 2, 4, 0), 'support', 'cane without water');
  g.set(3, 3, 0, 'water');
  assert.equal(supportStatus(get, 2, 4, 0), 'ok', 'cane next to water');
  g.set(5, 4, 0, 'ladder', 0); // facing N -> wall to the south
  assert.equal(supportStatus(get, 5, 4, 0), 'support');
  g.set(5, 4, 1, 'stone');
  assert.equal(supportStatus(get, 5, 4, 0), 'ok');
  assert.ok(hasSolidTop(packBlock(ID.oak_slab, 1)) && !hasSolidTop(packBlock(ID.oak_slab, 0)), 'top slab carries a torch, bottom slab does not');
});

/* ------------------------------------------------------------------ doors / gates / fences */
test('doors: two-high placement, open/close twice, breaking one half removes the other', () => {
  const g = makeGame();
  const toggles = g.log('door:toggle');
  const r = g.mechanics.useAt(0, 3, 0, { item: 'oak_door' });
  assert.ok(r.consumed && r.by === 'placer');
  assert.equal(g.get(0, 4, 0), ID.oak_door); assert.equal(g.get(0, 5, 0), ID.oak_door);
  assert.ok(g.st(0, 5, 0) & 8, 'upper half bit');
  const s0 = g.st(0, 4, 0) & 4;
  g.mechanics.useAt(0, 5, 0, { item: 'stick' });
  assert.notEqual(g.st(0, 4, 0) & 4, s0); assert.equal(g.st(0, 5, 0) & 4, g.st(0, 4, 0) & 4, 'both halves flip');
  g.mechanics.useAt(0, 4, 0, { item: 'stick' });
  assert.equal(g.st(0, 4, 0) & 4, s0, 'flipped back');
  assert.equal(toggles.length, 2);
  assert.deepEqual(toggles.map((t) => t.open), [true, false]);
  const broken = g.log('block:broken');
  g.interaction.breakBlock(0, 5, 0, { by: 'player', action: 5 });
  g.step(2);
  assert.equal(g.get(0, 4, 0), ID.air, 'lower half removed');
  assert.equal(broken[1].by, 'cascade'); assert.equal(broken[1].action, 5); assert.deepEqual(broken[1].drops, []);
  // no door without two free cells
  g.set(3, 5, 0, 'stone');
  g.mechanics.useAt(3, 3, 0, { item: 'oak_door' });
  assert.equal(g.get(3, 4, 0), ID.air, 'refused under a ceiling');
});

test('fences update connections on neighbour changes; gates toggle', () => {
  const g = makeGame();
  g.set(0, 4, 0, 'oak_fence', 0);
  g.set(1, 4, 0, 'oak_fence', 0, 'player', 3);
  g.step(2);
  const get = (x, y, z) => g.world.getRaw(x, y, z);
  assert.equal(g.st(0, 4, 0), connectionState(get, 0, 4, 0, ID.oak_fence));
  assert.equal(g.st(0, 4, 0) & 2, 2, 'west fence connects east');
  assert.equal(g.st(1, 4, 0) & 8, 8, 'east fence connects west');
  g.set(1, 4, 0, 'air');
  g.step(2);
  assert.equal(g.st(0, 4, 0), 0, 'disconnected');
  g.set(0, 4, 1, 'oak_fence_gate', 0);
  const t = g.log('door:toggle');
  g.mechanics.useAt(0, 4, 1, { item: 'stick' });
  assert.equal(g.st(0, 4, 1) & 4, 4);
  assert.equal(t[0].kind, 'gate');
});

/* ------------------------------------------------------------------ beds */
test('bed: two-long placement, use sets spawn and naps when the day is locked', () => {
  const g = makeGame();
  const ev = { start: g.log('sleep:start'), end: g.log('sleep:end'), spawn: g.log('player:spawnSet') };
  g.player.yaw = 0; // facing north
  g.inventory.set(0, { item: 'blue_bed', count: 1 });
  g.mechanics.useAt(0, 3, 0, { item: 'blue_bed' });
  assert.equal(g.get(0, 4, 0), ID.bed); assert.equal(g.get(0, 4, -1), ID.bed, 'head one cell north');
  assert.equal((g.st(0, 4, 0) >> 4) & 15, 11, 'blue colour bits');
  assert.equal(g.st(0, 4, -1) & 4, 4, 'head bit');
  g.mechanics.useAt(0, 4, 0, { item: 'stick' });
  assert.equal(ev.spawn.length, 1);
  assert.ok(g.player.spawnPoint.y >= 4);
  assert.deepEqual(ev.start, [{ nap: true }]);
  assert.equal(g.time.dayTime, 18000, 'starry sky during the nap');
  assert.ok(g.player.sleeping);
  g.step(60);
  assert.deepEqual(ev.end, [{ nap: true }]);
  assert.equal(g.time.dayTime, 3000, 'back to 09:00');
  assert.ok(!g.player.sleeping);
  // breaking the head removes the foot without a second drop
  g.interaction.breakBlock(0, 4, -1, { by: 'player' });
  g.step(2);
  assert.equal(g.get(0, 4, 0), ID.air);
});

test('bed: survival sleep only at night, 100 ticks then morning', () => {
  const g = makeGame({ mode: 'survival' });
  g.set(0, 4, 0, 'bed', 0); g.set(0, 4, -1, 'bed', 4);
  assert.equal(g.mechanics.trySleep(0, 4, 0).reason, 'not_night');
  g.time.setTime(14000);
  const r = g.mechanics.trySleep(0, 4, 0);
  assert.ok(r.ok && !r.nap);
  g.step(99);
  assert.equal(g.time.dayTime, 14000);
  g.step(1);
  assert.equal(g.time.dayTime, 0);
});

/* ------------------------------------------------------------------ farming */
test('farming: hoe tills, seeds, bone meal grows wheat to age 7 in 3 uses (seeded)', () => {
  const g = makeGame({ seed: 12345 });
  const r = g.mechanics.useAt(0, 3, 0, { item: 'wooden_hoe' });
  assert.ok(r.consumed);
  assert.equal(g.get(0, 3, 0), ID.farmland);
  g.set(0, 4, 0, 'wheat', 0, 'player');
  let uses = 0;
  while (g.st(0, 4, 0) < 7 && uses < 5) { assert.ok(g.mechanics.useAt(0, 4, 0, { item: 'bone_meal' }).consumed); uses++; }
  assert.equal(g.st(0, 4, 0), 7);
  assert.ok(uses <= 3, `bone meal x${uses}`);
  assert.equal(g.mechanics.applyBoneMeal(0, 4, 0), false, 'a ripe crop takes no bone meal');
  // hoe refuses with a block on top
  g.set(2, 4, 0, 'stone');
  assert.ok(!g.mechanics.useAt(2, 3, 0, { item: 'wooden_hoe' }).consumed);
});

test('farming: hydrated crops grow by random ticks; dry empty farmland turns back to dirt', () => {
  const g = makeGame({ seed: 7 });
  g.set(0, 3, 0, 'farmland', 0); g.set(0, 4, 0, 'wheat', 0);
  g.set(3, 3, 0, 'water');
  g.set(8, 3, 8, 'farmland', 0);
  // ~1365 ticks between random ticks of one cell, 1/3 growth chance when wet: 7 stages average ~29000 ticks
  for (let i = 0; i < 100000 && (g.st(0, 4, 0) < 7 || g.get(8, 3, 8) === ID.farmland); i += 500) g.step(500);
  assert.equal(g.st(0, 3, 0), 7, 'farmland near water is wet');
  assert.equal(g.st(0, 4, 0), 7, 'wheat ripened by random ticks');
  assert.notEqual(g.get(8, 3, 8), ID.farmland, 'dry farmland without a crop reverted (to dirt, then maybe grass)');
});

test('saplings: bone meal grows a tree; leaf decay spares player-placed leaves', () => {
  const g = makeGame({ seed: 3 });
  g.set(0, 4, 0, 'oak_sapling');
  for (let i = 0; i < 30 && g.get(0, 4, 0) === ID.oak_sapling; i++) g.mechanics.applyBoneMeal(0, 4, 0);
  assert.equal(g.get(0, 4, 0), ID.oak_log, 'sapling became a trunk');
  assert.equal(g.get(0, 5, 0), ID.oak_log);
  // decay: lone worldgen leaves far from logs vanish, persistent leaves stay
  const h = makeGame({ seed: 9 });
  h.set(10, 10, 10, 'oak_leaves', 0);
  h.set(-10, 10, -10, 'oak_leaves', 1);
  h.set(12, 10, 10, 'oak_leaves', 0); h.set(12, 10, 11, 'oak_log');
  h.step(40000);
  assert.equal(h.get(10, 10, 10), ID.air, 'lonely leaves decayed');
  assert.equal(h.get(-10, 10, -10), ID.oak_leaves, 'persistent leaves stay');
  assert.equal(h.get(12, 10, 10), ID.oak_leaves, 'leaves next to a log stay');
  // modern Java distance: a leaf 6 steps (through leaves) from a log stays, 7 steps decays
  const k = makeGame({ seed: 4 });
  k.set(0, 20, 0, 'oak_log');
  for (let i = 1; i <= 7; i++) k.set(i, 20, 0, 'oak_leaves', 0);
  k.step(60000);
  assert.equal(k.get(6, 20, 0), ID.oak_leaves, 'leaf 6 steps from the log stays (worldgen trees reach 5)');
  assert.equal(k.get(7, 20, 0), ID.air, 'leaf 7 steps away decays');
});

test('grass: spreads to lit dirt, dies under an opaque block; sugar cane grows to 3', () => {
  const g = makeGame({ seed: 5, ground: ID.dirt });
  g.set(0, 3, 0, 'grass_block');
  g.set(5, 3, 5, 'grass_block'); g.set(5, 4, 5, 'stone');
  g.set(-4, 3, -4, 'sand'); g.set(-4, 4, -4, 'sugar_cane'); g.set(-3, 3, -4, 'water');
  g.step(100000);
  let grass = 0;
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (g.get(x, 3, z) === ID.grass_block) grass++;
  assert.ok(grass > 3, `grass spread (${grass})`);
  assert.equal(g.get(5, 3, 5), ID.dirt, 'covered grass became dirt');
  assert.equal(g.get(-4, 6, -4), ID.sugar_cane, 'cane 3 tall');
  assert.equal(g.get(-4, 7, -4), ID.air, 'never 4 tall');
});

/* ------------------------------------------------------------------ explosions */
test('explosion maths: 1352 rays, damage formula, ray cells inside stone', () => {
  assert.equal(RAY_COUNT, 1352);
  assert.equal(damageOf(1, 4), 57);
  assert.equal(damageOf(0, 4), 0);
  assert.equal(impactOf(8, 4, 1), 0);
  assert.equal(impactOf(4, 4, 1), 0.5);
  const getRaw = (x, y, z) => (y < 64 && !(x === 0 && y === 60 && z === 0) ? ID.stone : 0); // TNT cell is air
  const r = explosionCells(getRaw, 0.5, 60.06, 0.5, 4, mulberry32(1));
  assert.ok(r.count >= 10 && r.count < 120, `stone blast removes a pocket (${r.count})`);
  const air = explosionCells(() => 0, 0.5, 60.5, 0.5, 4, mulberry32(1));
  assert.equal(air.count, 0);
  const bedrock = explosionCells(() => ID.bedrock, 0.5, 60.5, 0.5, 4, mulberry32(1));
  assert.equal(bedrock.count, 0, 'bedrock never breaks');
});

test('explosion: one action, one batch, blocks payload, merged drops <= 32, damage + knockback', () => {
  const g = makeGame({ mode: 'survival' });
  for (let x = -6; x <= 6; x++) for (let y = 4; y <= 14; y++) for (let z = -6; z <= 6; z++) g.set(x, y, z, (x + y + z) % 3 ? 'stone' : 'dirt');
  const changes = g.log('block:changed');
  const ex = g.log('explosion');
  const before = g.batches.begun;
  g.player.x = 0.5; g.player.y = 15; g.player.z = 3.5;
  const n = g.mechanics.explode(0.5, 9.5, 0.5, 4, { source: 'tnt' });
  assert.ok(n > 10);
  assert.equal(ex.length, 1);
  const e = ex[0];
  assert.equal(e.count, n); assert.equal(e.blocks.length, n);
  const actions = new Set(changes.filter((c) => c.cause === 'explosion').map((c) => c.action));
  assert.deepEqual([...actions], [e.action], 'every break shares the explosion action');
  assert.equal(g.batches.begun - before, 1, 'one batch');
  assert.ok(g.mechanics.stats.lastExplosion.items <= 32 && g.mechanics.stats.lastExplosion.items >= 2, `merged drop entities (${g.mechanics.stats.lastExplosion.items})`);
  assert.ok(g.mechanics.stats.lastExplosion.ms < 50, `explosion took ${g.mechanics.stats.lastExplosion.ms} ms`);
});

test('explosion: damages and pushes the player and mobs, never items', () => {
  const g = makeGame({ mode: 'survival' });
  g.player.x = 2.5; g.player.y = 4; g.player.z = 0.5;
  class Dummy extends g.entities.EntityClass { constructor() { super('dummy_mob', -1.5, 4, 0.5); this.hits = []; this.health = 10; } hurt(a, s) { this.hits.push([a, s.type]); return true; } }
  g.entities.types.set('dummy_mob', { create: () => new Dummy(), persistent: false, category: 'creature' });
  const mob = g.entities.spawn('dummy_mob', -1.5, 4, 0.5);
  g.mechanics.explode(0.5, 4.06, 0.5, 4, { source: 'tnt' });
  assert.equal(g.survival.damaged.length, 1);
  assert.equal(g.survival.damaged[0][1], 'explosion');
  assert.ok(g.survival.damaged[0][0] > 10, `close blast hurts a lot (${g.survival.damaged[0][0]})`);
  assert.ok(g.player.vx > 0.2, 'player pushed away (east)');
  assert.ok(mob.hits.length === 1 && mob.vx < -0.2, 'mob hurt and pushed west');
  g.player.flying = true; g.player.vx = 0;
  g.mechanics.explode(0.5, 4.06, 0.5, 4, { source: 'tnt', now: true });
  assert.equal(g.player.vx, 0, 'flying creative-style players are not pushed');
});

test('explosion: water blocks breaking, tntExplodes=false is a harmless poof, creative never drops', () => {
  const g = makeGame();
  g.set(0, 4, 0, 'water');
  assert.equal(g.mechanics.explode(0.5, 4.2, 0.5, 4, { source: 'tnt' }), 0, 'in water: no blocks');
  const h = makeGame({ rules: { tntExplodes: false } });
  const ex = h.log('explosion');
  assert.equal(h.mechanics.explode(0.5, 4.1, 0.5, 4, { source: 'tnt' }), 0);
  assert.ok(ex[0].harmless && Array.isArray(ex[0].blocks) && ex[0].blocks.length === 0);
  assert.equal(h.get(0, 3, 0), ID.grass_block);
  const c = makeGame();
  c.mechanics.explode(0.5, 4.1, 0.5, 4, { source: 'tnt' });
  assert.equal(c.mechanics.stats.lastExplosion.items, 0, 'creative: no drops');
  assert.equal(c.get(0, 3, 0), ID.air);
});

test('TNT: flint primes (hop + 80 fuse), chain reaction primes the second, both gone within 200 ticks', () => {
  const g = makeGame();
  const ex = g.log('explosion'), primed = g.log('tnt:primed');
  g.set(0, 4, 0, 'tnt'); g.set(3, 4, 0, 'tnt');
  const r = g.mechanics.useAt(0, 4, 0, { item: 'flint_and_steel' });
  assert.ok(r.consumed && r.by === 'block');
  assert.equal(g.get(0, 4, 0), ID.air);
  const tnt = g.entities.ofType('tnt')[0];
  assert.ok(tnt && tnt.vy > 0.19, 'hops up');
  assert.equal(primed[0].fuse, 80);
  g.step(79);
  assert.equal(ex.length, 0);
  g.step(1);
  assert.equal(ex.length, 1, 'explodes at 80 ticks');
  assert.equal(g.get(3, 4, 0), ID.air, 'second TNT primed (not broken)');
  assert.equal(primed.length, 2);
  assert.ok(primed[1].fuse >= 10 && primed[1].fuse <= 30);
  g.step(40);
  assert.equal(ex.length, 2);
  assert.equal(g.entities.ofType('tnt').length, 0);
  assert.deepEqual(g.errors, []);
});

test('TNT: a 12-TNT chain lit by one flint tap is ONE undo entry; one undo restores every cell (judge ROB-3)', () => {
  const g = makeGame({ ground: ID.stone }); // stone top: no grass dying under the pile during the fuse
  const log = new UndoLog(50);
  g.events.on('block:changed', (e) => log.record(e, g.tickCount));
  // the same 3x2x2 pile the judge used, on the flat ground (y 4..5); then snapshot every cell around it
  for (let i = 0; i < 12; i++) g.set(-1 + (i % 3), 4 + Math.floor(i / 6), -1 + (Math.floor(i / 3) % 2), 'tnt');
  const before = new Map();
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) for (let y = 0; y < 14; y++) before.set(`${x},${y},${z}`, g.world.getRaw(x, y, z));
  const ex = g.log('explosion');
  const r = g.mechanics.useAt(-1, 4, -1, { item: 'flint_and_steel', action: 777 });
  assert.ok(r.consumed);
  g.step(400);
  assert.equal(ex.length, 12, 'all 12 TNT exploded');
  assert.equal(g.entities.ofType('tnt').length, 0);
  assert.equal(new Set(ex.map((e) => e.action)).size, 1, 'every blast in the chain shares one action');
  assert.equal(log.size, 1, 'one undo entry for the whole chain');
  let air = 0;
  for (const [k, v] of before) { const [x, y, z] = k.split(',').map(Number); if (v !== 0 && g.world.getRaw(x, y, z) === 0) air++; }
  assert.ok(air > 40, `crater has ${air} cells`);
  const u = log.undo({ getRaw: (x, y, z) => g.world.getRaw(x, y, z), setBlock: (x, y, z, id, st, o) => g.world.setBlock(x, y, z, id, st, o), beginBatch: () => g.world.beginBatch(), endBatch: () => g.world.endBatch() });
  assert.ok(u.count >= air, `undo restored ${u.count} cells`);
  for (const [k, v] of before) { const [x, y, z] = k.split(',').map(Number); assert.equal(g.world.getRaw(x, y, z), v, `cell ${k} restored`); }
  // a separate blast (a creeper, no lighting action) still gets its own action
  g.mechanics.explode(0.5, 30, 0.5, 3, { source: 'creeper' });
  assert.notEqual(ex[ex.length - 1].action, ex[0].action);
  assert.deepEqual(g.errors, []);
});

test('TNT: at most 2 explosions resolve per tick, the rest queue', () => {
  const g = makeGame();
  const ex = g.log('explosion');
  g.tickCount++; g.mechanics.tick(g);
  for (let i = 0; i < 5; i++) g.mechanics.explode(i * 20 - 40.5, 30, 0.5, 4, { source: 'test' });
  assert.equal(ex.length, 2);
  g.step(1); assert.equal(ex.length, 4);
  g.step(1); assert.equal(ex.length, 5);
});

/* ------------------------------------------------------------------ fire, buckets, slabs, snow, cake */
test('fire: flint lights a top face, fire burns out in 30-90 ticks and never spreads by default; fire primes TNT', () => {
  const g = makeGame();
  g.set(0, 4, 1, 'oak_planks');
  assert.ok(g.mechanics.useAt(0, 3, 0, { item: 'flint_and_steel' }).consumed);
  assert.equal(g.get(0, 4, 0), ID.fire);
  g.step(29);
  assert.equal(g.get(0, 4, 0), ID.fire);
  g.step(62);
  assert.equal(g.get(0, 4, 0), ID.air, 'burnt out');
  assert.equal(g.get(0, 4, 1), ID.oak_planks, 'no spread');
  g.set(5, 4, 0, 'tnt');
  g.mechanics.useAt(4, 3, 0, { item: 'flint_and_steel' });
  g.step(2);
  assert.equal(g.entities.ofType('tnt').length, 1, 'fire next to TNT primes it');
});

test('buckets: pick up a water source, pour it back; survival swaps the bucket', () => {
  const g = makeGame({ mode: 'survival' });
  g.set(0, 4, -2, 'water');
  g.player.x = 0.5; g.player.y = 4; g.player.z = 0.5; g.player.yaw = 0; g.player.pitch = -Math.atan2(5.62 - 4.05, 2.0); // aim at the bottom centre of (0,4,-2)
  g.inventory.set(0, { item: 'bucket', count: 1 }); g.inventory.selectSlot(0);
  const hit = rayCells((x, y, z) => g.world.getRaw(x, y, z), 0.5, 5.62, 0.5, 0, -1.57, -2.0, 5, (raw) => (raw & 0xff) !== 0);
  assert.deepEqual([hit.x, hit.y, hit.z], [0, 4, -2]);
  assert.ok(g.mechanics.useAt(0, 4, -2, {}).consumed, 'bucket used');
  assert.equal(g.get(0, 4, -2), ID.air, 'water picked up');
  assert.equal(g.inventory.getSelected().item, 'water_bucket');
  assert.ok(g.mechanics.useAt(0, 3, -2, {}).consumed, 'water bucket used');
  assert.equal(g.st(0, 4, -2), 0, 'a source');
  assert.equal(g.get(0, 4, -2), ID.water, 'poured where we picked it');
  assert.equal(g.inventory.getSelected().item, 'bucket');
});

test('buckets in creative swap in hand too; ice and snow melt near torches (P2)', () => {
  const g = makeGame();
  g.set(0, 4, -2, 'water');
  g.player.pitch = -Math.atan2(5.62 - 4.05, 2.0);
  g.inventory.set(0, { item: 'bucket', count: 1 }); g.inventory.selectSlot(0);
  g.mechanics.useAt(0, 4, -2, {});
  assert.equal(g.inventory.getSelected().item, 'water_bucket');
  g.mechanics.useAt(0, 3, -2, {});
  assert.equal(g.inventory.getSelected().item, 'bucket');
  const h = makeGame({ light: 0xfe, seed: 2 });
  h.set(0, 4, 0, 'ice'); h.set(14, 4, 14, 'snow');
  h.step(30000);
  assert.equal(h.get(0, 4, 0), ID.water, 'ice melted');
  assert.equal(h.get(14, 4, 14), ID.air, 'snow melted');
});

test('snow layers stack (double slabs are CORE-E); cake loses bites', () => {
  const g = makeGame();
  g.set(1, 4, 0, 'snow', 0);
  g.mechanics.useAt(1, 4, 0, { item: 'snow' });
  g.mechanics.useAt(1, 4, 0, { item: 'snow' });
  assert.equal(g.st(1, 4, 0), 2, '3 layers');
  g.step(2);
  assert.equal(g.st(1, 3, 0) & 1, 1, 'grass under snow is snowy');
  g.set(2, 4, 0, 'cake', 0);
  for (let i = 0; i < 6; i++) g.mechanics.useAt(2, 4, 0, { item: 'stick' });
  assert.equal(g.st(2, 4, 0), 6);
  g.mechanics.useAt(2, 4, 0, { item: 'stick' });
  assert.equal(g.get(2, 4, 0), ID.air, 'seventh bite finishes the cake');
});

test('paintings: largest picture that fits on a wall', () => {
  const g = makeGame();
  const get = (x, y, z) => g.world.getRaw(x, y, z);
  for (let x = -3; x <= 3; x++) for (let y = 4; y <= 6; y++) g.set(x, y, 1, 'stone');
  const big = choosePicture(get, 0, 5, 0, 0);
  assert.equal(PICTURES[big.index].name, 'rainbow_hills', '4x2 fits a 7x3 wall');
  const small = choosePicture(get, 0, 6, 0, 0);
  assert.equal(PICTURES[small.index].w * PICTURES[small.index].h <= 4, true);
  assert.equal(choosePicture(get, 0, 5, -3, 0), null, 'no wall, no painting');
});

test('serialize: scheduled ticks survive a save/load', () => {
  const g = makeGame();
  g.set(0, 4, 0, 'water');
  g.step(3);
  const data = JSON.parse(JSON.stringify(g.mechanics.serialize(g)));
  assert.ok(data.ticks.length > 0);
  const h = makeGame();
  h.world.setBlock(0, 4, 0, ID.water, 0, { silent: true });
  h.mechanics.deserialize(h, data);
  h.step(80);
  assert.equal(h.get(5, 4, 0), ID.water, 'flow continues after load');
});
