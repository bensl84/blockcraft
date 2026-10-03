// OWNER LANE: FEATURE-MOBS. Unit tests for the AI helpers, damage maths, models/skins, and whole-mob behaviour
// simulated against a small fake world (Node, no browser). While CORE-E's physics is a stub, entities use the
// local fallback collider in src/entities/collide.js, so these tests also pin that fallback.
import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { DEFAULT_RULES, SURVIVAL_RULES, packBlock } from '../src/core/constants.js';
import { ID } from '../src/core/registry.js';
import { mulberry32 } from '../src/core/math.js';
import { Inventory } from '../src/inventory/inventory.js';
import { MOBS, SPAWN } from '../src/data/mobs.js';
import { createEntitySystem } from '../src/entities/entity.js';
import { createMobsSystem } from '../src/entities/mobs.js';
import { createSurvivalSystem } from '../src/survival/survival.js';
import { hooks } from '../src/core/hooks.js';
import {
  addXp, canJumpObstacle, checkRainbow, daylightAt, dropBelow, feedBaby, findStandY, isSafeStep, mobGroundAccel,
  pickWanderTarget, rainbowColor, splitXp, steadyGroundSpeed, xpToNext, yawToward,
} from '../src/entities/mob_ai.js';
import {
  addFoodValues, airTick, applyArmor, applyInvuln, drainExhaustion, explosionDamage, fallDamage, regenTick,
} from '../src/survival/damage.js';
import { MODELS, buildModelArrays, faceRects, packModel, poseModel } from '../src/entities/mob_models.js';
import { paintSkin } from '../src/entities/mob_skins.js';
import { localMoveAndCollide } from '../src/entities/collide.js';
import { columnKey, decodeKeys, encodeKeys } from '../src/entities/spawning.js';
import { dropItem } from '../src/entities/item_entity.js';

/* ------------------------------------------------------------------ fake world + game */

function makeWorld(radiusCols = 6) {
  const over = new Map();
  const k = (x, y, z) => x + ',' + y + ',' + z;
  const world = {
    renderDistance: 6,
    columns: new Map(),
    getRaw(x, y, z) {
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      if (y < 0 || y >= 128) return 0;
      if (!world.isColumnLoaded(x >> 4, z >> 4)) return 0;
      const v = over.get(k(x, y, z));
      if (v !== undefined) return v;
      return y === 0 ? ID.bedrock : y < 3 ? ID.dirt : y === 3 ? ID.grass_block : 0;
    },
    getBlock(x, y, z) { return world.getRaw(x, y, z) & 0xff; },
    getState(x, y, z) { return world.getRaw(x, y, z) >> 8; },
    setBlock(x, y, z, id, state = 0) { over.set(k(Math.floor(x), Math.floor(y), Math.floor(z)), packBlock(id, state)); return true; },
    getLight() { return 0xf0; },
    getSkyLight() { return 15; },
    getBlockLight() { return 0; },
    isColumnLoaded(cx, cz) { return Math.abs(cx) <= radiusCols && Math.abs(cz) <= radiusCols; },
    getColumn(cx, cz) { return world.isColumnLoaded(cx, cz) ? { cx, cz, biomes: new Uint8Array(256) } : null; },
    forEachColumn(fn) { for (let cx = -radiusCols; cx <= radiusCols; cx++) for (let cz = -radiusCols; cz <= radiusCols; cz++) fn({ cx, cz, biomes: new Uint8Array(256) }); },
    getSurfaceY() { return 4; },
    fill(x0, y0, z0, x1, y1, z1, name, state = 0) {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) world.setBlock(x, y, z, name === 'air' ? 0 : ID[name], state);
    },
  };
  return world;
}

function makeGame({ mode = 'creative', difficulty = 'peaceful', rules = {}, seed = 1 } = {}) {
  const events = new EventBus();
  const errors = [];
  const game = {
    events, errors, tickCount: 0, frameCount: 0, state: 'playing',
    settings: { controls: 'kid' },
    world: makeWorld(),
    rand: mulberry32(seed),
    meta: { mode, difficulty, rules: { ...DEFAULT_RULES, ...(mode === 'survival' ? SURVIVAL_RULES : {}), ...rules }, spawn: { x: 0.5, y: 4, z: 0.5 } },
    isCreative() { return game.meta.mode === 'creative'; },
    reportError(err, where) { errors.push(where + ': ' + (err && err.message)); },
    input: { held: new Set(), isDown(a) { return this.held.has(a); }, move: { forward: 0, strafe: 0 } },
    interaction: { seq: 0, newAction() { return ++this.seq; }, breakBlock(x, y, z) { game.world.setBlock(x, y, z, 0); return true; } },
    fx: null, renderer: null,
    player: {
      x: 0.5, y: 4, z: 0.5, prevX: 0.5, prevY: 4, prevZ: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, eyeHeight: 1.62,
      yaw: 0, pitch: 0, health: 20, maxHealth: 20, food: 20, saturation: 5, exhaustion: 0, air: 300, xp: 0, xpLevel: 0, xpProgress: 0,
      dead: false, hurtTime: 0, fireTicks: 0, effects: {}, riding: null, flying: false, inWater: false, eyeInWater: false, inLava: false,
      onGround: true, spawnPoint: { x: 0.5, y: 4, z: 0.5 },
      spawn(x, y, z) { Object.assign(this, { x, y, z, prevX: x, prevY: y, prevZ: z, vx: 0, vy: 0, vz: 0, fallDistance: 0 }); },
      teleport(x, y, z) { this.spawn(x, y, z); },
      getEyePos(o = {}) { o.x = this.x; o.y = this.y + 1.62; o.z = this.z; return o; },
      getLookDir(o = {}) { o.x = 0; o.y = 0; o.z = -1; return o; },
      setFlying() {}, swing() {},
    },
  };
  game.inventory = new Inventory(events);
  game.entities = createEntitySystem(game);
  game.mobs = createMobsSystem(game);
  game.survival = createSurvivalSystem(game);
  game.entities.init(game); game.mobs.init(game); game.survival.init(game);
  events.onError = (err, name) => errors.push('event ' + name + ': ' + err.message);
  game.step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      game.tickCount++;
      game.entities.tick(game);
      game.mobs.tick(game);
      game.survival.tick(game);
    }
  };
  return game;
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (+-${eps})`);
const getRawOf = (w) => (x, y, z) => w.getRaw(x, y, z);

/* ------------------------------------------------------------------ pure helpers */

test('mob speed formula: pig wanders ~2.7 b/s and panics ~4.2 b/s (SPEC §2.6)', () => {
  near(steadyGroundSpeed(0.25, 1), 2.7, 0.15, 'pig wander');
  near(steadyGroundSpeed(0.25, 1.25), 4.2, 0.2, 'pig panic');
  near(mobGroundAccel(0.25, 1, 0.6), 0.0625, 1e-9, 'accel = (attr*mod)^2 on normal ground');
  near(yawToward(0, -1), 0, 1e-9, 'north = yaw 0');
  near(yawToward(-1, 0), Math.PI / 2, 1e-9, 'west = +90 (left turn)');
});

test('terrain safety: drops, lava, cactus, fire, ledges, standing spots', () => {
  const w = makeWorld();
  const g = getRawOf(w);
  assert.equal(isSafeStep(g, 5.5, 4, 5.5), true, 'flat ground is safe');
  w.fill(10, 0, 0, 10, 3, 0, 'air');                     // a pit down to the void (no bedrock)
  assert.equal(dropBelow(g, 10.5, 4, 0.5), Infinity, 'bottomless pit');
  assert.equal(isSafeStep(g, 10.5, 4, 0.5), false, 'never walk into a bottomless pit');
  w.fill(12, 1, 0, 12, 3, 0, 'air');                     // 3 deep (bedrock at 0)
  near(dropBelow(g, 12.5, 4, 0.5), 3, 1e-6, '3-block drop');
  assert.equal(isSafeStep(g, 12.5, 4, 0.5), true, 'a 3-block drop is fine');
  w.fill(14, 4, 0, 14, 4, 0, 'lava');
  assert.equal(isSafeStep(g, 14.5, 4, 0.5), false, 'never into lava');
  w.fill(16, 4, 0, 16, 4, 0, 'cactus');
  assert.equal(isSafeStep(g, 16.5, 4, 0.5), false, 'never onto cactus');
  w.fill(18, 4, 0, 18, 4, 0, 'fire');
  assert.equal(isSafeStep(g, 18.5, 4, 0.5), false, 'never into fire');
  // obstacles: 1-block ledge yes, 2-block wall no, fence (1.5) no, slab yes
  w.fill(20, 4, 0, 20, 4, 0, 'stone');
  assert.equal(canJumpObstacle(g, 19.5, 4, 0.5, 1, 0, 0.9), true, '1-block ledge is jumpable');
  w.fill(20, 5, 0, 20, 5, 0, 'stone');
  assert.equal(canJumpObstacle(g, 19.5, 4, 0.5, 1, 0, 0.9), false, '2-block wall is not');
  w.fill(22, 4, 0, 22, 4, 0, 'oak_fence');
  assert.equal(canJumpObstacle(g, 21.5, 4, 0.5, 1, 0, 0.9), false, 'fences (1.5) keep animals in pens');
  w.fill(24, 4, 0, 24, 4, 0, 'oak_slab');
  assert.equal(canJumpObstacle(g, 23.5, 4, 0.5, 1, 0, 0.9), true, 'slab step');
  assert.equal(findStandY(g, 0.5, 4, 30.5), 4, 'stand height on flat grass');
  const r = mulberry32(3);
  for (let i = 0; i < 50; i++) {
    const t = pickWanderTarget(r, g, 0.5, 4, 30.5, 10, 10);
    assert.ok(t && Math.hypot(t.x - 0.5, t.z - 30.5) <= 11 && t.y === 4, 'wander target within 10 blocks on the ground');
  }
});

test('rules: rainbow sheep, baby feeding, xp, daylight', () => {
  assert.equal(checkRainbow([{ color: 'red', tick: 0 }, { color: 'blue', tick: 50 }, { color: 'lime', tick: 150 }], 150), true);
  assert.equal(checkRainbow([{ color: 'red', tick: 0 }, { color: 'red', tick: 50 }, { color: 'red', tick: 60 }], 60), false, 'same colour thrice');
  assert.equal(checkRainbow([{ color: 'red', tick: 0 }, { color: 'blue', tick: 150 }, { color: 'lime', tick: 300 }], 300), false, 'too slow');
  assert.notEqual(rainbowColor(0), rainbowColor(20), 'one colour per second');
  assert.equal(feedBaby(24000), 21600);
  assert.equal(xpToNext(0), 7);
  const p = { xp: 0, xpLevel: 0, xpProgress: 0 };
  assert.equal(addXp(p, 7), 1); assert.equal(p.xpLevel, 1);
  addXp(p, 9); assert.equal(p.xpLevel, 2);
  assert.equal(splitXp(10).reduce((a, b) => a + b, 0), 10);
  near(daylightAt(6000), 1, 1e-6, 'noon'); near(daylightAt(18000), 0, 1e-6, 'midnight');
});

test('damage maths (SPEC §2.3)', () => {
  assert.equal(fallDamage(10, 1), 7, '10-block fall = 7');
  assert.equal(fallDamage(3, 1), 0);
  assert.equal(fallDamage(3.2, 1), 1);
  assert.equal(fallDamage(10, 0.2), 2, 'hay');
  assert.equal(fallDamage(10, 0.5), 4, 'bed');
  const s = { invuln: 0, lastDamage: 0 };
  assert.equal(applyInvuln(s, 5), 5);
  assert.equal(applyInvuln(s, 3), 0, 'smaller hit inside the window ignored');
  assert.equal(applyInvuln(s, 7), 2, 'bigger hit counts by the difference');
  near(applyArmor(10, 20), 4, 1e-9, 'full diamond-ish armour');
  near(applyArmor(10, 0), 10, 1e-9, 'no armour');
  const p = { food: 20, saturation: 1, exhaustion: 8.5 };
  drainExhaustion(p);
  assert.deepEqual([p.food, p.saturation], [19, 0]);
  near(p.exhaustion, 0.5, 1e-9, 'exhaustion remainder');
  addFoodValues(p, 4, 30); assert.equal(p.saturation, p.food, 'saturation <= hunger');
  // regen: full food + saturation heals 1 every 10 ticks; starvation stops at 10 on easy, 1 on normal
  const q = { health: 10, maxHealth: 20, food: 20, saturation: 5, exhaustion: 0 }, t = { regen: 0, starve: 0 };
  let healed = 0;
  for (let i = 0; i < 100; i++) healed += regenTick(q, t, 'easy').heal;
  assert.equal(healed, 10);
  for (const [diff, floor] of [['easy', 10], ['normal', 1]]) {
    const h = { health: 20, maxHealth: 20, food: 0, saturation: 0, exhaustion: 0 }, tt = { regen: 0, starve: 0 };
    for (let i = 0; i < 80 * 30; i++) h.health -= regenTick(h, tt, diff).starve;
    assert.equal(h.health, floor, `starvation floor on ${diff}`);
  }
  assert.equal(explosionDamage(0, 3).damage, 43, 'point blank creeper');
  assert.equal(explosionDamage(6, 3).damage, 0, 'out of range');
  const a = { air: 300 };
  let drown = 0;
  for (let i = 0; i < 320; i++) drown += airTick(a, true);
  assert.equal(drown, 2, 'first drowning hit after 320 ticks');
  for (let i = 0; i < 100; i++) airTick(a, false);
  assert.equal(a.air, 300);
});

/* ------------------------------------------------------------------ models + skins */

test('models: <= 8 parts (one draw call), packed UVs in range and non-overlapping, sane buffers', () => {
  for (const [type, m] of Object.entries(MODELS)) {
    assert.ok(m.parts.length <= 8, `${type}: ${m.parts.length} parts`);
    const pack = packModel(m);
    const cells = new Set();
    m.boxes.forEach((b, i) => {
      assert.ok(b.part < m.parts.length, `${type} box ${i} part index`);
      for (const [x, y, w, h] of Object.values(faceRects(pack.rects[i]))) {
        assert.ok(x >= 0 && y >= 0 && x + w <= pack.width && y + h <= pack.height, `${type} box ${i} inside the skin`);
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const key = xx + ',' + yy; assert.ok(!cells.has(key), `${type}: overlapping UV at ${key}`); cells.add(key); }
      }
    });
    const a = buildModelArrays(m, ['wool']);
    assert.equal(a.position.length / 3, a.vertices);
    assert.ok(a.uv.every((v) => v >= 0 && v <= 1), `${type} uv range`);
    assert.ok(Math.max(...a.part) < m.parts.length);
    assert.ok(Math.max(...a.index) < a.vertices);
    const pose = poseModel(m, { type, limbSwing: 3, limbAmount: 1, headYaw: 0.3, sitting: true, saddled: false }, 10, []);
    assert.equal(pose.length, m.parts.length);
    assert.ok(pose.every((o) => Number.isFinite(o.rx) && Number.isFinite(o.s)));
  }
  assert.ok(buildModelArrays(MODELS.sheep, []).vertices < buildModelArrays(MODELS.sheep, ['wool']).vertices, 'sheared sheep geometry has no wool');
});

test('skins: deterministic, every box face fully painted, sheep colours differ', () => {
  for (const type of Object.keys(MODELS)) {
    const a = paintSkin(type, {}), b = paintSkin(type, {});
    assert.deepEqual(a.data, b.data, `${type} deterministic`);
    const pack = packModel(MODELS[type]);
    MODELS[type].boxes.forEach((box, i) => {
      for (const [x, y, w, h] of Object.values(faceRects(pack.rects[i]))) {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) assert.equal(a.alpha(xx, yy), 255, `${type} box ${i} pixel ${xx},${yy}`);
      }
    });
  }
  assert.notDeepEqual(paintSkin('sheep', { color: 'red' }).data, paintSkin('sheep', { color: 'blue' }).data);
  assert.notDeepEqual(paintSkin('wolf', { tamed: true }).data, paintSkin('wolf', { tamed: false }).data, 'collar');
});

/* ------------------------------------------------------------------ fallback collider */

test('fallback collider: lands on the ground, steps up 0.5, blocked by walls, stays out of unloaded columns', () => {
  const w = makeWorld(1);
  const body = { x: 0.5, y: 10, z: 0.5, width: 0.9, height: 0.9, stepHeight: 0.6, onGround: false };
  for (let i = 0; i < 40; i++) localMoveAndCollide(w, body, 0, -0.5, 0);
  near(body.y, 4, 1e-6, 'feet on the grass'); assert.ok(body.onGround);
  w.fill(2, 4, 0, 2, 4, 0, 'oak_slab');
  for (let i = 0; i < 20; i++) localMoveAndCollide(w, body, 0.1, -0.1, 0);
  assert.ok(body.y > 4.4, `stepped onto the slab (y ${body.y})`);
  w.fill(6, 4, 0, 6, 6, 0, 'stone');
  for (let i = 0; i < 60; i++) localMoveAndCollide(w, body, 0.1, -0.1, 0);
  assert.ok(body.x < 6 - 0.44 && body.collidedH, 'wall stops it');
  const b2 = { x: 30.5, y: 4, z: 0.5, width: 0.6, height: 1.8, stepHeight: 0.6, onGround: true };
  for (let i = 0; i < 30; i++) localMoveAndCollide(w, b2, 0.2, -0.08, 0);
  assert.ok(b2.x <= 32 - 0.3 + 1e-6, `unloaded columns are solid (${b2.x})`);
});

/* ------------------------------------------------------------------ whole mobs in the fake world */

test('pig: lands, wanders without ever walking off a 6-block cliff, steps up a ledge', () => {
  const g = makeGame({ seed: 5 });
  // a 9x9 plateau 6 blocks high: wandering pigs must stay on it
  g.world.fill(-4, 4, -4, 4, 9, 4, 'stone');
  const pig = g.mobs.spawnMob('pig', 0.5, 12, 0.5);
  assert.ok(pig);
  let minY = 99;
  for (let i = 0; i < 3000; i++) { g.step(); if (i > 40) minY = Math.min(minY, pig.y); }
  near(minY, 10, 1e-6, 'never left the plateau');
  assert.ok(pig.limbSwing > 5, 'it walked around (walk cycle advanced)');
  // step-up: a pig led over a 1-block ledge by a carrot gets on top within 100 ticks
  const g2 = makeGame({ seed: 2 });
  g2.world.fill(4, 4, -3, 12, 4, 3, 'stone');
  const p2 = g2.mobs.spawnMob('pig', 0.5, 4, 0.5);
  g2.player.x = 8.5; g2.player.y = 5; g2.player.z = 0.5;
  g2.inventory.set(0, { item: 'carrot', count: 5 });
  let t = 0;
  for (; t < 100 && p2.y < 4.99; t++) g2.step();
  assert.ok(p2.y >= 4.99, `pig climbed the ledge (y ${p2.y.toFixed(2)}, ${t} ticks)`);
  assert.deepEqual(g.errors.concat(g2.errors), []);
});

test('mobs float in water and climb out', () => {
  const g = makeGame({ seed: 4 });
  g.world.fill(-3, 1, -3, 3, 3, 3, 'water');
  const sheep = g.mobs.spawnMob('sheep', 0.5, 2, 0.5);
  const wolf = g.mobs.spawnMob('wolf', 1.5, 1.2, 1.5, { baby: true });
  let maxSheep = 0;
  for (let i = 0; i < 200; i++) { g.step(); if (i > 60) maxSheep = Math.max(maxSheep, sheep.y); }
  assert.ok(maxSheep > 2.5, `sheep floats near the surface (${maxSheep.toFixed(2)})`);
  assert.ok(wolf.y > 2.3, `baby wolf floats (${wolf.y.toFixed(2)})`);
});

test('kid rule: animals cannot die (20 hits) but hop, panic and squeak; with the rule off they die and drop loot', () => {
  const g = makeGame({ seed: 9 });
  const pig = g.mobs.spawnMob('pig', 3.5, 4, 0.5);
  g.step(5);
  let hops = 0;
  for (let i = 0; i < 20; i++) {
    g.mobs.hit(pig.id, 7);
    if (pig.vy > 0.3) hops++;
    g.step(11);
  }
  assert.equal(pig.health, 10, 'health never drops');
  assert.ok(hops >= 15, `hops away (${hops})`);
  assert.equal(g.events.counts.get('mob:death') || 0, 0);
  assert.ok(g.events.recent('mob:sound', 50).some((e) => e.payload.kind === 'hurt'), 'squeak');
  // survival with animalsCanDie: death tip-over then drops + removal
  const s = makeGame({ mode: 'survival', difficulty: 'easy', seed: 3 });
  const cow = s.mobs.spawnMob('cow', 3.5, 4, 0.5);
  s.step(5);
  s.mobs.hit(cow.id, 20);
  assert.ok(cow.deathTime > 0, 'dying');
  s.step(25);
  assert.ok(cow.removed, 'removed after the tip-over');
  const drops = s.entities.ofType('item').map((e) => e.data.stack.item);
  assert.ok(drops.includes('beef'), `cow drops beef (${drops})`);
  assert.ok(s.entities.ofType('xp_orb').length > 0, 'xp orbs for a player kill');
});

test('breeding: two cows + wheat -> hearts -> baby within 200 ticks; cooldown; baby grows up', () => {
  const g = makeGame({ seed: 11 });
  const a = g.mobs.spawnMob('cow', 0.5, 4, 0.5), b = g.mobs.spawnMob('cow', 3.5, 4, 2.5);
  g.step(2);
  assert.ok(g.mobs.useOn(a.id, 'wheat').ok && g.mobs.useOn(b.id, 'wheat').ok, 'fed');
  assert.equal(a.data.love, SPAWN.LOVE_TICKS);
  assert.equal(g.events.counts.get('mob:love'), 2);
  let baby = null, t = 0;
  for (; t < 200 && !baby; t++) { g.step(); baby = g.entities.ofType('cow').find((e) => e.baby); }
  assert.ok(baby, 'a baby cow');
  assert.equal(g.events.recent('entity:spawn', 50).filter((e) => e.payload.reason === 'breed').length, 1);
  assert.equal(a.data.cooldown > 5000 && b.data.cooldown > 5000, true, 'parents cool down');
  assert.ok(baby.width < 0.5, 'babies are half size');
  g.mobs.useOn(baby.id, 'wheat');
  assert.equal(baby.data.grow < SPAWN.BABY_GROW_TICKS, true, 'feeding speeds growth');
  g.step(baby.data.grow + 2);
  assert.equal(baby.baby, false, 'grew up');
  assert.equal(g.inventory.getSelected().count, 1, 'creative: wheat not consumed');
});

test('sheep: shear 1-3 wool, dye, rainbow easter egg, regrow by grazing', () => {
  const g = makeGame({ seed: 21 });
  const s = g.mobs.spawnMob('sheep', 2.5, 4, 0.5, { color: 'white' });
  g.step(2);
  assert.ok(g.mobs.useOn(s.id, 'shears').ok);
  assert.equal(s.data.sheared, true);
  const wool = g.entities.ofType('item').filter((e) => e.data.stack.item === 'white_wool');
  assert.ok(wool.length >= 1 && wool.length <= 3, `1-3 wool (${wool.length})`);
  assert.equal(g.events.counts.get('mob:sheared'), 1);
  s.data.sheared = false;
  g.mobs.useOn(s.id, 'red_dye'); assert.equal(s.data.color, 'red');
  g.step(5); g.mobs.useOn(s.id, 'blue_dye');
  g.step(5); g.mobs.useOn(s.id, 'lime_dye');
  assert.equal(s.data.rainbow, true, 'rainbow sheep after 3 colours in 200 ticks');
  assert.notEqual(s.currentColor(), (() => { s.age += 20; return s.currentColor(); })(), 'cycles colours');
  g.mobs.useOn(s.id, 'shears');
  g.step(4000);
  assert.equal(s.data.sheared, false, 'wool regrew after grazing');
  assert.equal(g.world.getBlock(Math.floor(s.x), 3, Math.floor(s.z)), ID.grass_block, 'mobGriefing off: the grass stays');
});

test('chicken lays eggs; cow gives milk; spawn egg on a mob makes a baby', () => {
  const g = makeGame({ seed: 8 });
  const c = g.mobs.spawnMob('chicken', 2.5, 4, 0.5);
  c.data.eggTimer = 3;
  g.step(6);
  assert.ok(g.entities.ofType('item').some((e) => e.data.stack.item === 'egg'), 'egg dropped');
  const cow = g.mobs.spawnMob('cow', -2.5, 4, 0.5);
  g.mobs.useOn(cow.id, 'bucket');
  assert.ok(g.inventory.find('milk_bucket') >= 0, 'milk');
  g.mobs.useOn(cow.id, 'cow_spawn_egg');
  assert.ok(g.entities.ofType('cow').some((e) => e.baby), 'baby cow from the egg');
});

test('wolf: bone tames 1/3 (seeded), sits, follows, teleports when far; feeding heals', () => {
  const g = makeGame({ seed: 77 });
  const w = g.mobs.spawnMob('wolf', 3.5, 4, 0.5);
  g.step(2);
  let tries = 0;
  while (!w.data.tamed && tries < 30) { g.mobs.useOn(w.id, 'bone'); tries++; }
  assert.ok(w.data.tamed && tries > 0, `tamed after ${tries} bones`);
  assert.equal(g.events.counts.get('mob:tamed'), 1);
  assert.equal(w.maxHealth, 40); assert.equal(w.data.sitting, true, 'tamed wolves sit');
  g.mobs.useOn(w.id, null); assert.equal(w.data.sitting, false, 'tap toggles sit');
  g.player.x = 40.5; g.player.z = 0.5;
  g.step(10);
  assert.ok(Math.hypot(w.x - 40.5, w.z - 0.5) < 5, `teleported to the player (${w.x.toFixed(1)})`);
  g.player.x = 50.5; g.step(80);
  assert.ok(Math.hypot(w.x - 50.5, w.z - 0.5) < 12, 'follows');
  w.health = 30;
  g.mobs.useOn(w.id, 'beef');
  assert.ok(w.health > 30, 'meat heals a tamed wolf');
  g.mobs.useOn(w.id, null); const x0 = w.x; g.player.x = 70.5; g.step(5);
  assert.equal(w.data.sitting, true); near(w.x, x0, 0.01, 'sitting wolves stay');
});

test('saddled pig can be ridden; boat floats; horse tames by riding', () => {
  const g = makeGame({ seed: 12 });
  const pig = g.mobs.spawnMob('pig', 2.5, 4, 0.5);
  g.mobs.useOn(pig.id, 'saddle'); assert.equal(pig.data.saddled, true);
  g.mobs.useOn(pig.id, null);
  assert.equal(g.player.riding, pig.id, 'riding');
  g.inventory.set(0, { item: 'carrot_on_a_stick', count: 1 });
  g.player.yaw = -Math.PI / 2;   // look east
  const x0 = pig.x;
  g.step(60);
  assert.ok(pig.x > x0 + 3, `carrot on a stick steers east (${(pig.x - x0).toFixed(2)})`);
  g.input.held.add('descend'); g.step(2); g.input.held.clear();
  assert.equal(g.player.riding, null, 'dismount with descend');
  // boat
  g.world.fill(-10, 1, -10, -6, 3, -6, 'water');
  const boat = g.entities.spawn('boat', -7.5, 3, -7.5, {});
  g.step(80);
  near(boat.y, 4 - 0.12, 0.15, 'boat floats at the surface');
  // horse: riding raises temper until it accepts the rider
  const horse = g.mobs.spawnMob('horse', 8.5, 4, 8.5);
  let rides = 0;
  while (!horse.data.tamed && rides < 60) { g.mobs.useOn(horse.id, null); g.step(31); rides++; }
  assert.ok(horse.data.tamed, `horse tamed after ${rides} rides`);
  assert.deepEqual(g.errors, []);
});

test('items: magnet + pickup + pop event; merge; despawn after 6000 ticks', () => {
  const g = makeGame({ mode: 'survival', difficulty: 'easy', seed: 2 });
  dropItem(g, { item: 'dirt', count: 1 }, 1.4, 4.5, 0.5);
  g.step(30);
  assert.equal(g.inventory.count('dirt'), 1);
  assert.equal(g.events.counts.get('item:pickup'), 1);
  const a = dropItem(g, { item: 'cobblestone', count: 3 }, 10.5, 4.2, 10.5, { vx: 0, vy: 0, vz: 0 });
  const b = dropItem(g, { item: 'cobblestone', count: 4 }, 10.6, 4.2, 10.6, { vx: 0, vy: 0, vz: 0 });
  g.step(25);
  assert.equal(g.entities.ofType('item').length, 1, 'merged');
  assert.equal((a.removed ? b : a).data.stack.count, 7);
  g.step(6000);
  assert.equal(g.entities.ofType('item').length, 0, 'despawned');
  const c = dropItem(g, { item: 'stick', count: 1 }, 20.5, 6, 20.5, { vx: 0, vy: 0, vz: 0 });
  g.world.fill(20, 4, 20, 20, 4, 20, 'lava');
  g.step(40);
  assert.ok(c.removed, 'lava destroys items');
});

test('spawning: chunk-gen animals at most once per column, creature cap 24, culling restored wild animals', () => {
  const g = makeGame({ seed: 31 });
  let fresh = 0;
  for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) { g.events.emit('world:columnLoaded', { cx, cz, fresh: true }); fresh++; }
  const first = g.mobs.counts().creature;
  assert.ok(first > 0 && first <= SPAWN.CREATURE_CAP, `some animals, capped (${first})`);
  assert.equal(g.mobs.populatedCount(), fresh);
  const before = g.entities.count();
  for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) g.events.emit('world:columnLoaded', { cx, cz, fresh: true });
  assert.equal(g.entities.count(), before, 'a populated column is never populated again');
  // the populated set survives save/load
  const saved = JSON.parse(JSON.stringify(g.mobs.serialize()));
  const g2 = makeGame({ seed: 31 });
  g2.mobs.deserialize(g2, saved);
  g2.events.emit('world:columnLoaded', { cx: 0, cz: 0, fresh: true });
  assert.equal(g2.entities.count(), 0, 'no repopulation after reload');
  // over the cap: restoring a column drops untouched wild animals only
  const g3 = makeGame({ seed: 5 });
  for (let i = 0; i < 24; i++) g3.mobs.spawnMob('cow', -40 + i, 4, -40);
  const pet = g3.mobs.spawnMob('wolf', 20.5, 4, 20.5, { tamedBy: 'player' });
  const wild = [];
  for (let i = 0; i < 3; i++) wild.push(g3.mobs.spawnMob('sheep', 21.5 + i, 4, 21.5, { wild: true }));
  g3.events.emit('world:columnLoaded', { cx: 1, cz: 1, fresh: false });
  assert.ok(!pet.removed, 'pets always come back');
  assert.equal(wild.filter((e) => e.removed).length, 3, 'wild extras culled');
  assert.equal(g3.mobs.counts().creature, 25);
  const keys = new Set([columnKey(-3, 7), columnKey(100, -200), columnKey(0, 0)]);
  assert.deepEqual([...decodeKeys(encodeKeys(keys))].sort(), [...keys].sort());
});

test('survival: fall damage via player:land, creative + void rules, peaceful refill, eating, death + respawn', () => {
  const g = makeGame({ mode: 'survival', difficulty: 'easy', seed: 1 });
  const p = g.player;
  g.events.emit('player:land', { fallDistance: 10, x: 0, y: 4, z: 0, blockId: ID.grass_block });
  assert.equal(p.health, 13, '10-block fall = 7 damage');
  assert.equal(g.events.recent('player:hurt', 1)[0].payload.cause, 'fall');
  g.step(12);
  p.health = 20;
  g.events.emit('player:land', { fallDistance: 10, x: 0, y: 4, z: 0, blockId: ID.hay_block });
  assert.equal(p.health, 18, 'hay x0.2');
  g.step(12);
  assert.equal(g.survival.damage(4, 'void'), false, 'void never damages while the kid rescue is on');
  g.meta.mode = 'creative';
  assert.equal(g.survival.damage(4, 'mob'), false, 'creative ignores damage');
  g.meta.mode = 'survival';
  // eating: tap an apple, completes on its own after 32 ticks (kid scheme)
  p.food = 10; p.saturation = 0;
  g.inventory.set(0, { item: 'apple', count: 2 });
  const use = hooks.itemUse.get('apple');
  assert.ok(use({ game: g, player: p, stack: g.inventory.getSelected(), slot: 0, hit: null, sneaking: false, action: 1 }));
  g.step(31); assert.equal(p.food, 10, 'still eating');
  g.step(2); assert.equal(p.food, 14, 'ate'); assert.equal(g.inventory.count('apple'), 1);
  // regen at high food
  p.health = 15; p.food = 20; p.saturation = 5;
  g.step(30);
  assert.ok(p.health > 15, 'natural regeneration');
  // drowning
  p.health = 20; p.eyeInWater = true; p.air = 300;
  g.step(321);
  assert.ok(p.health <= 18, `drowned a little (${p.health})`);
  p.eyeInWater = false;
  // death + immediate respawn with keep inventory
  g.inventory.set(3, { item: 'diamond', count: 5 });
  g.survival.damage(100, 'mob');
  assert.equal(p.dead, true); assert.equal(g.events.counts.get('player:death'), 1);
  g.step(21);
  assert.equal(p.dead, false); assert.equal(p.health, 20); assert.equal(g.inventory.count('diamond'), 5, 'keep inventory');
  assert.equal(g.events.counts.get('player:respawn'), 1);
  // keepInventory off: everything scatters
  g.meta.rules.keepInventory = false;
  g.step(12);
  g.survival.damage(100, 'mob');
  assert.equal(g.inventory.count('diamond'), 0);
  assert.ok(g.entities.ofType('item').some((e) => e.data.stack.item === 'diamond'), 'dropped on death');
  // peaceful refill
  const q = makeGame({ mode: 'survival', difficulty: 'peaceful' });
  q.player.health = 10; q.player.food = 10;
  q.step(100);
  assert.equal(q.player.health, 15); assert.equal(q.player.food, 15);
});

test('monsters (P1): zombie hits the player, creeper explodes, skeleton shoots, peaceful removes them', () => {
  const g = makeGame({ mode: 'survival', difficulty: 'easy', seed: 6, rules: { hostileMobs: true } });
  g.time = { dayTime: 18000 };
  const z = g.mobs.spawnMob('zombie', 6.5, 4, 0.5);
  let t = 0;
  for (; t < 300 && g.player.health === 20; t++) g.step();
  assert.ok(g.player.health < 20, `zombie attacked (${t} ticks)`);
  g.entities.remove(z, 'test');
  g.player.health = 20; g.step(12);
  const c = g.mobs.spawnMob('creeper', 2.5, 4, 0.5);
  for (t = 0; t < 80 && !c.removed; t++) g.step();
  assert.ok(c.removed, 'creeper went off');
  assert.equal(g.events.counts.get('explosion'), 1);
  assert.ok(g.player.health < 20, 'blast hurt the player');
  g.player.health = 20; g.step(12);
  g.mobs.spawnMob('skeleton', 10.5, 4, 0.5);
  for (t = 0; t < 120 && !g.entities.ofType('arrow').length; t++) g.step();
  assert.ok(g.entities.ofType('arrow').length > 0, 'skeleton shot an arrow');
  // sun burning at noon
  g.time.dayTime = 6000;
  const z2 = g.mobs.spawnMob('zombie', -8.5, 4, 0.5);
  g.step(200);
  assert.ok(z2.fireTicks > 0 || z2.removed || z2.health < 20, 'zombies burn in the sun');
  g.meta.difficulty = 'peaceful'; g.events.emit('difficulty:changed', { difficulty: 'peaceful' });
  assert.equal(g.mobs.counts().monster, 0, 'peaceful removes monsters');
  assert.deepEqual(g.errors, []);
});

test('serialize/restore keeps mob state (tamed wolf, coloured sheared sheep, baby, saddle)', () => {
  const g = makeGame({ seed: 3 });
  const w = g.mobs.spawnMob('wolf', 1.5, 4, 1.5, { tamedBy: 'player' });
  const s = g.mobs.spawnMob('sheep', 3.5, 4, 1.5, { color: 'purple' }); s.data.sheared = true;
  const b = g.mobs.spawnMob('pig', 5.5, 4, 1.5, { baby: true });
  const p = g.mobs.spawnMob('pig', 7.5, 4, 1.5); p.data.saddled = true;
  const data = JSON.parse(JSON.stringify(g.entities.serialize()));
  const g2 = makeGame({ seed: 3 });
  g2.entities.deserialize(g2, data);
  const byType = (t) => g2.entities.ofType(t);
  const w2 = byType('wolf')[0];
  assert.ok(w2.data.tamed && w2.maxHealth === 40, 'tamed wolf');
  const s2 = byType('sheep')[0];
  assert.deepEqual([s2.data.color, s2.data.sheared], ['purple', true]);
  assert.ok(byType('pig').some((e) => e.baby && e.width < 0.5), 'baby');
  assert.ok(byType('pig').some((e) => e.data.saddled), 'saddle');
  assert.equal(b.baby && w.data.tamed && s.data.sheared && p.data.saddled, true);
});
