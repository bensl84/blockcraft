// CORE-E unit tests: physics (moveAndCollide, step-up, sneak edge, fluids, findFreeY), raycast (DDA, shapes,
// fluids, origin inside), the player's Java movement numbers at 20 TPS (SPEC §2.1), placement state rules and
// the notched-wheel heuristic. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { ID } from '../src/core/registry.js';
import { FACE, PHYS, packBlock } from '../src/core/constants.js';
import { EventBus } from '../src/core/events.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { STATE } from '../src/data/blocks.js';
import { boxCollides, collectBlockBoxes, findFreeY, fluidState, moveAndCollide } from '../src/player/physics.js';
import { raycast } from '../src/player/raycast.js';
import { createPlayerSystem } from '../src/player/player.js';
import { createInteractionSystem, facingOfNormal, placementState } from '../src/player/interaction.js';
import { hooks } from '../src/core/hooks.js';
import { Inventory } from '../src/inventory/inventory.js';
import { isNotchedWheel } from '../src/player/input.js';

/* ------------------------------------------------------------------ fakes */
function makeWorld({ floorY = 3, floorId = ID.stone, size = 64, loaded = () => true } = {}) {
  const cells = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const w = {
    isOpen: true,
    renderDistance: 6,
    getRaw(x, y, z) {
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      if (y < 0 || y > 127) return 0;
      const v = cells.get(key(x, y, z));
      if (v !== undefined) return v;
      if (floorY >= 0 && y <= floorY && Math.abs(x) < size && Math.abs(z) < size) return floorId;
      return 0;
    },
    getBlock(x, y, z) { return w.getRaw(x, y, z) & 0xff; },
    set(x, y, z, id, st = 0) { cells.set(key(x, y, z), packBlock(id, st)); },
    isColumnLoaded: (cx, cz) => loaded(cx, cz),
    unmeshedWithin: () => 0,
  };
  return w;
}
function body(x, y, z, extra = {}) { return { x, y, z, width: 0.6, height: 1.8, stepHeight: 0.6, onGround: false, collidedH: false, collidedV: false, ...extra }; }

/** Minimal game around a real player system; input is driven by the test. */
function makeGame(world, { scheme = 'kid', creative = true, settings = {} } = {}) {
  const held = new Set();
  let pressed = new Set(), queued = new Set();
  const input = {
    scheme, move: { forward: 0, strafe: 0 }, lastManualLookMs: 1e15, pointerLocked: false, lookDelta: { yaw: 0, pitch: 0 },
    isDown: (a) => held.has(a), wasPressed: (a) => pressed.has(a), isCaptured: () => false,
    hold(a) { if (!held.has(a)) queued.add(a); held.add(a); }, release(a) { held.delete(a); },
    beginTick() { pressed = queued; queued = new Set(); },
  };
  const game = {
    events: new EventBus(), settings: { ...DEFAULT_SETTINGS, autoJump: false, ...settings }, state: 'playing',
    meta: { mode: creative ? 'creative' : 'survival', rules: { hunger: false } }, tickCount: 0,
    isCreative: () => creative, world, input, renderer: null, entities: null,
  };
  const player = createPlayerSystem(game);
  game.player = player;
  player.init(game);
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { game.tickCount++; input.beginTick(); player.tick(game); } };
  return { game, player, input, tick };
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

/* ------------------------------------------------------------------ physics */
test('physics: falling body lands exactly on the floor and is onGround', () => {
  const w = makeWorld();
  const b = body(0.5, 6, 0.5);
  moveAndCollide(w, b, 0, -5, 0);
  near(b.y, 4, 1e-9, 'lands on top of y=3 floor');
  assert.ok(b.onGround && b.collidedV && !b.collidedH);
});

test('physics: walls clip horizontal motion; seams never snag', () => {
  const w = makeWorld();
  for (let y = 4; y <= 6; y++) w.set(3, y, 0, ID.stone);
  const b = body(1.5, 4, 0.5, { onGround: true });
  const r = moveAndCollide(w, b, 2, -0.08, 0);
  near(b.x, 3 - 0.3, 1e-6, 'stops at the wall');
  assert.ok(b.collidedH);
  near(r.dx, 1.2, 1e-6, 'applied dx');
  // walking along a flat floor made of many cells never collides horizontally
  const c = body(0.5, 4, 0.5, { onGround: true });
  for (let i = 0; i < 40; i++) moveAndCollide(w, c, 0.21, -0.08, 0.13);
  assert.ok(!c.collidedH, 'no snag on block seams');
  near(c.y, 4, 1e-9, 'stays on the floor');
});

test('physics: step-up onto a 0.5 slab, not onto a full block', () => {
  const w = makeWorld();
  w.set(2, 4, 0, ID.oak_slab, 0);
  const b = body(1.5, 4, 0.5, { onGround: true });
  moveAndCollide(w, b, 0.3, -0.08, 0);
  near(b.y, 4.5, 1e-6, 'stepped up onto the slab');
  assert.ok(b.onGround);
  const w2 = makeWorld();
  w2.set(2, 4, 0, ID.stone);
  const c = body(1.5, 4, 0.5, { onGround: true });
  moveAndCollide(w2, c, 0.3, -0.08, 0);
  near(c.y, 4, 1e-9, 'a full block is not stepped');
  assert.ok(c.collidedH);
});

test('physics: fence collision is 1.5 high (no step, no stand-in)', () => {
  const w = makeWorld();
  w.set(2, 4, 0, ID.oak_fence, 0);
  const b = body(1.5, 4, 0.5, { onGround: true });
  moveAndCollide(w, b, 0.5, -0.08, 0);
  assert.ok(b.x < 2.375 - 0.3 + 1e-6 && b.y === 4, `blocked by the post (${b.x}, ${b.y})`);
});

test('physics: sneak edge keeps the body on its block', () => {
  const w = makeWorld({ floorY: -1 });
  w.set(0, 3, 0, ID.stone);
  const b = body(0.5, 4, 0.5, { onGround: true });
  for (let i = 0; i < 30; i++) moveAndCollide(w, b, 0.2, -0.08, 0, { sneakEdge: true });
  assert.ok(b.x <= 1 + 0.3 + 0.05 && b.x > 1.0, `edge-protected at x ${b.x}`);
  near(b.y, 4, 1e-9, 'did not fall');
  const c = body(0.5, 4, 0.5, { onGround: true });
  moveAndCollide(w, c, 1.5, -0.08, 0);
  moveAndCollide(w, c, 0, -0.08, 0);
  assert.ok(c.x > 1.9 && !c.onGround && c.y < 4, 'without sneak the body walks off');
});

test('physics: unloaded columns are solid, collectBlockBoxes/boxCollides/findFreeY', () => {
  const w = makeWorld({ loaded: (cx) => cx < 1 });
  const b = body(14.5, 4, 0.5, { onGround: true });
  moveAndCollide(w, b, 3, -0.08, 0);
  near(b.x, 16 - 0.3, 1e-6, 'stops at the unloaded column');
  const inside = body(20.5, 50.3, 0.5);
  for (let i = 0; i < 20; i++) moveAndCollide(w, inside, 0, -0.5, 0);
  assert.ok(inside.y >= 50 - 1e-9, 'a body inside an unloaded column never falls through it (' + inside.y + ')');
  const pg = makeGame(w);
  pg.player.spawn(40.5, 70, 0.5, 0, 0);
  pg.tick(20);
  near(pg.player.y, 70, 1e-9, 'the player waits in place until its column loads');
  const boxes = collectBlockBoxes(w, 0, 3, 0, 1, 4, 1);
  assert.ok(boxes.some((bx) => bx[4] === 4), 'floor box found');
  assert.ok(boxCollides(w, 0.2, 3.5, 0.2, 0.8, 5, 0.8));
  assert.ok(!boxCollides(w, 0.2, 4, 0.2, 0.8, 5.8, 0.8));
  const ww = makeWorld();
  for (let y = 4; y <= 6; y++) ww.set(0, y, 0, ID.stone);
  assert.equal(findFreeY(ww, 0.5, 4, 0.5, 0.6, 1.8), 7, 'pops above the pillar');
  assert.equal(findFreeY(ww, 5.5, 4, 5.5, 0.6, 1.8), 4, 'free spot unchanged');
  ww.set(5, 4, 5, ID.oak_slab, 0); // bottom slab: stand on 4.5
  assert.equal(findFreeY(ww, 5.5, 4.2, 5.5, 0.6, 1.8), 4.5, 'stands on the slab top');
});

test('physics: fluidState water fraction, eye in water, lava', () => {
  const w = makeWorld();
  for (let y = 4; y <= 6; y++) w.set(0, y, 0, ID.water, 0);
  const fs = fluidState(w, body(0.5, 4, 0.5), 1.62);
  assert.ok(fs.water > 0.9 && fs.inWater && fs.eyeInWater && !fs.lava, JSON.stringify(fs));
  const w2 = makeWorld();
  w2.set(0, 4, 0, ID.water, 0);
  const fs2 = fluidState(w2, body(0.5, 4, 0.5), 1.62);
  assert.ok(fs2.inWater && !fs2.eyeInWater && fs2.water < 0.6, JSON.stringify(fs2));
  const w3 = makeWorld();
  w3.set(0, 4, 0, ID.lava, 0); w3.set(0, 5, 0, ID.lava, 0);
  assert.ok(fluidState(w3, body(0.5, 4, 0.5), 1.62).lava);
});

/* ------------------------------------------------------------------ raycast */
test('raycast: hits the top face of the ground with the outward normal', () => {
  const w = makeWorld();
  const h = raycast(w, 0.5, 5.62, 0.5, 0, -1, 0, 8);
  assert.ok(h && h.x === 0 && h.y === 3 && h.z === 0 && h.face === FACE.UP && h.ny === 1, JSON.stringify(h));
  near(h.dist, 1.62, 1e-9, 'distance');
  near(h.py, 4, 1e-9, 'hit point');
  const side = raycast(w, -3.5, 3.5, 0.5, 1, 0, 0, 8, {});
  // origin is inside the floor block (solid) -> returns it with face UP, dist 0
  assert.ok(side && side.dist === 0 && side.face === FACE.UP);
  const w2 = makeWorld({ floorY: -1 });
  w2.set(2, 5, 0, ID.stone);
  const e = raycast(w2, -1.5, 5.5, 0.5, 1, 0, 0, 8);
  assert.ok(e && e.x === 2 && e.face === FACE.WEST && e.nx === -1, JSON.stringify(e));
  const n = raycast(w2, 5.5, 5.5, 0.5, -1, 0, 0, 8);
  assert.ok(n && n.x === 2 && n.face === FACE.EAST && n.nx === 1);
  assert.equal(raycast(w2, 5.5, 5.5, 0.5, -1, 0, 0, 2), null, 'max distance respected');
  // negative coordinates, diagonal
  w2.set(-4, 5, -4, ID.stone);
  const d = raycast(w2, 0.5, 5.5, 0.5, -1, 0, -1, 10);
  assert.ok(d && d.x === -4 && d.z === -4, JSON.stringify(d));
});

test('raycast: partial shapes, plants, fluids and filters', () => {
  const w = makeWorld({ floorY: -1 });
  w.set(2, 5, 0, ID.oak_slab, 0);                   // bottom slab: y 5..5.5
  assert.equal(raycast(w, 0.5, 5.75, 0.5, 1, 0, 0, 6), null, 'passes over a bottom slab');
  const s = raycast(w, 0.5, 5.25, 0.5, 1, 0, 0, 6);
  assert.ok(s && s.x === 2 && s.face === FACE.WEST);
  w.set(4, 5, 0, ID.poppy);                          // cross plant: selection [3,0,3]..[13,13,13]
  const pl = raycast(w, 3.5, 5.95, 0.5, 1, 0, 0, 6);
  assert.equal(pl, null, 'over the plant box');
  const pl2 = raycast(w, 3.5, 5.3, 0.5, 1, 0, 0, 6);
  assert.ok(pl2 && pl2.x === 4 && pl2.px > 4.18, 'plant hit through its box');
  w.set(0, 3, 0, ID.water, 0);
  assert.equal(raycast(w, 0.5, 5, 0.5, 0, -1, 0, 4), null, 'water skipped by default');
  const f = raycast(w, 0.5, 5, 0.5, 0, -1, 0, 4, { fluids: true });
  assert.ok(f && f.y === 3 && f.id === ID.water && f.face === FACE.UP, 'fluids: hits the surface');
  w.set(0, 2, 0, ID.stone); w.set(0, 1, 0, ID.dirt);
  const flt = raycast(w, 0.5, 5, 0.5, 0, -1, 0, 6, { filter: (id) => id !== ID.stone });
  assert.ok(flt && flt.id === ID.dirt, 'filter passes through stone');
  w.set(6, 5, 0, ID.torch, 0);
  assert.ok(raycast(w, 6.5, 6, 0.5, 0, -1, 0, 3).id === ID.torch, 'torch hit from above');
});

/* ------------------------------------------------------------------ player movement numbers (SPEC §2.1) */
test('player: walk speed 4.317 m/s and jump apex 1.2522 in 12 ticks', () => {
  const w = makeWorld();
  const { player, input, tick } = makeGame(w);
  player.spawn(0.5, 4, 0.5, 0, 0);
  tick(5);
  assert.ok(player.onGround, 'on ground');
  input.move.forward = 1;
  tick(40);
  const z0 = player.z; tick(20);
  near((z0 - player.z), 4.317, 4.317 * 0.05, 'walk m/s');
  input.move.forward = 0;
  tick(30);
  assert.equal(player.vx, 0); assert.equal(player.vz, 0);
  const y0 = player.y;
  const lands = [];
  player.game = null;
  input.hold('jump'); tick(1); input.release('jump');
  let maxY = player.y, t = 1;
  while (!player.onGround && t < 40) { tick(1); t++; maxY = Math.max(maxY, player.y); lands.push(player.y); }
  near(maxY - y0, 1.2522, 0.002, 'jump apex');
  assert.equal(t, 12, 'flat jump lasts 12 ticks');
  near(player.y, y0, 1e-9, 'back on the floor');
});

test('player: classic sprint 5.612, sneak 1.3, sprint-jump boost', () => {
  const w = makeWorld({ size: 400 });
  const { player, input, tick } = makeGame(w, { scheme: 'classic' });
  player.spawn(0.5, 4, 0.5, 0, 0);
  tick(3);
  input.move.forward = 1; input.hold('sprint');
  tick(40);
  assert.ok(player.sprinting, 'sprinting');
  let z0 = player.z; tick(20);
  near(z0 - player.z, 5.612, 5.612 * 0.05, 'sprint m/s');
  input.release('sprint'); input.move.forward = 0; tick(30);
  assert.ok(!player.sprinting, 'sprint stops when forward is released');
  input.hold('sneak'); input.move.forward = 1;
  tick(30);
  z0 = player.z; tick(20);
  near(z0 - player.z, 1.3, 1.3 * 0.05, 'sneak m/s');
  assert.ok(player.sneaking && player.height === PHYS.SNEAK_HEIGHT);
  input.release('sneak'); tick(1);
  assert.ok(!player.sneaking && player.height === PHYS.HEIGHT);
});

test('player: creative flight speeds and kid fly toggle; landing ends flight', () => {
  const w = makeWorld({ size: 1000 });
  const { player, input, tick, game } = makeGame(w, { scheme: 'classic' });
  player.spawn(0.5, 20, 0.5, 0, 0);
  player.setFlying(true);
  assert.ok(player.flying);
  input.move.forward = 1;
  tick(60);
  let z0 = player.z; tick(20);
  near(z0 - player.z, 10.92, 10.92 * 0.05, 'fly m/s');
  input.hold('sprint'); tick(80);
  z0 = player.z; tick(20);
  near(z0 - player.z, 21.6, 21.6 * 0.05, 'sprint-fly m/s');
  input.release('sprint'); input.move.forward = 0; tick(60);
  input.hold('jump'); tick(20);
  let y0 = player.y; tick(20);
  near(player.y - y0, 7.5, 7.5 * 0.05, 'fly up m/s');
  input.release('jump');
  input.hold('sneak'); tick(10);
  y0 = player.y; tick(20);
  near(y0 - player.y, 7.5, 7.5 * 0.05, 'fly down m/s');
  tick(200);
  assert.ok(!player.flying && player.onGround, 'landing ends flight');
  // classic double-tap jump toggles flight
  input.release('sneak');
  tick(5);
  input.hold('jump'); tick(1); input.release('jump'); tick(2); input.hold('jump'); tick(1); input.release('jump');
  assert.ok(player.flying, 'double-tap jump flies');
  assert.ok(game.events.counts.get('player:fly') >= 2);
  // kid: toggleFly + descend
  const k = makeGame(makeWorld(), { scheme: 'kid' });
  k.player.spawn(0.5, 4, 0.5, 0, 0); k.tick(3);
  k.game.events.emit('input:action', { action: 'toggleFly', down: true, source: 'test' }); k.tick(1);
  assert.ok(k.player.flying, 'F toggles flight in the kid scheme');
  k.tick(10);
  assert.ok(k.player.y > 4.2, 'kid lift on take-off');
  k.input.hold('descend'); k.tick(30);
  assert.ok(!k.player.flying && k.player.onGround, 'descend lands and ends flight');
});

test('player: ladder climb 2.35 m/s, swimming up, falling fires player:land', () => {
  const w = makeWorld();
  for (let y = 4; y <= 20; y++) { w.set(0, y, -1, ID.stone); w.set(0, y, 0, ID.ladder, 2); } // ladder faces south (away from wall)
  const { player, input, tick, game } = makeGame(w);
  player.spawn(0.5, 4, 0.6, 0, 0);
  input.move.forward = 1;
  tick(20);
  assert.ok(player.onLadder, 'on the ladder');
  const y0 = player.y; tick(20);
  near(player.y - y0, 2.35, 2.35 * 0.05, 'ladder up m/s');
  input.move.forward = 0;
  // swim up
  const ww = makeWorld();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 4; y <= 10; y++) ww.set(x, y, z, ID.water, 0);
  const s = makeGame(ww);
  s.player.spawn(0.5, 5, 0.5, 0, 0);
  s.tick(30);
  assert.ok(s.player.inWater && s.player.y < 5, 'sinks slowly in water');
  s.input.hold('jump'); s.tick(40);
  assert.ok(s.player.y > 8.5, `swims up (${s.player.y})`);
  assert.ok(s.game.events.counts.get('player:water') >= 1, 'player:water emitted');
  // fall
  player.teleport(5.5, 14, 5.5, 'test');
  const lands = [];
  game.events.on('player:land', (e) => lands.push(e));
  tick(40);
  // Java excludes the landing tick's partial motion: a 10-block drop reports ~9.67 (fall damage ceil(fd - 3) = 7 either way)
  assert.ok(lands.length === 1 && lands[0].fallDistance > 9.5 && lands[0].fallDistance <= 10 && lands[0].blockId === ID.stone, JSON.stringify(lands));
  assert.equal(player.fallDistance, 0);
});

test('player: auto-jump climbs a 1-block step but not a fence; step-up of a slab while walking', () => {
  const w = makeWorld({ size: 200 });
  w.set(0, 4, -3, ID.stone);
  const { player, input, tick } = makeGame(w, { settings: { autoJump: true } });
  player.spawn(0.5, 4, 0.5, 0, 0);
  tick(3);
  input.move.forward = 1;
  let onTop = false, bumps = 0;
  for (let i = 0; i < 24; i++) { tick(1); if (player.collidedH) bumps++; if (Math.abs(player.y - 5) < 1e-9 && player.onGround && player.z < -2) onTop = true; }
  assert.ok(onTop, `auto-jumped onto the block (${player.y}, ${player.z})`);
  assert.equal(bumps, 0, 'auto-jump starts early enough not to bump the block');
  const w2 = makeWorld({ size: 200 });
  for (let x = -2; x <= 2; x++) w2.set(x, 4, -3, ID.oak_fence, 10);
  const f = makeGame(w2, { settings: { autoJump: true } });
  f.player.spawn(0.5, 4, 0.5, 0, 0); f.tick(3);
  f.input.move.forward = 1; f.tick(40);
  near(f.player.y, 4, 1e-9, 'a fence is never auto-jumped');
  const w3 = makeWorld({ size: 200 });
  w3.set(0, 4, -3, ID.oak_slab, 0);
  const sl = makeGame(w3, { settings: { autoJump: false } });
  sl.player.spawn(0.5, 4, 0.5, 0, 0); sl.tick(3);
  sl.input.move.forward = 1;
  let onSlab = false;
  for (let i = 0; i < 25; i++) { sl.tick(1); if (Math.abs(sl.player.y - 4.5) < 1e-9 && sl.player.z < -2.2 && sl.player.z > -2.8) onSlab = true; }
  assert.ok(onSlab, 'stepped onto the slab while walking');
  assert.ok(sl.player.z < -4, 'and walked on past it');
});

/* ------------------------------------------------------------------ placement rules (SPEC §7.4) */
test('placement: torch, ladder, slab, axis, facing, leaves, stairs states', () => {
  const up = { face: FACE.UP, nx: 0, ny: 1, nz: 0, py: 4 };
  const down = { face: FACE.DOWN, nx: 0, ny: -1, nz: 0, py: 3 };
  const south = { face: FACE.SOUTH, nx: 0, ny: 0, nz: 1, py: 4.7 };
  const east = { face: FACE.EAST, nx: 1, ny: 0, nz: 0, py: 4.2 };
  assert.equal(facingOfNormal(0, 0, -1), 0); assert.equal(facingOfNormal(1, 0, 0), 1);
  assert.equal(facingOfNormal(0, 0, 1), 2); assert.equal(facingOfNormal(-1, 0, 0), 3);
  assert.equal(placementState(ID.torch, 0, up, 0), 0, 'floor torch');
  assert.equal(placementState(ID.torch, 0, down, 0), -1, 'no ceiling torch');
  assert.equal(placementState(ID.torch, 0, south, 0), 1 + 0, 'torch on the south face of a block hangs on the wall to its north');
  assert.equal(placementState(ID.torch, 0, east, 0), 1 + 3, 'east face -> wall to the west');
  assert.equal(placementState(ID.ladder, 0, south, 0), 2, 'ladder faces away from the wall');
  assert.equal(placementState(ID.ladder, 0, up, 0), -1, 'no floor ladder');
  assert.equal(placementState(ID.oak_slab, 0, up, 0), 0, 'up face -> bottom slab');
  assert.equal(placementState(ID.oak_slab, 0, down, 0), STATE.SLAB_TOP, 'down face -> top slab');
  assert.equal(placementState(ID.oak_slab, 0, south, 0), STATE.SLAB_TOP, 'upper half of a side -> top slab');
  assert.equal(placementState(ID.oak_slab, 0, east, 0), 0, 'lower half of a side -> bottom slab');
  assert.equal(placementState(ID.oak_log, 0, up, 0), 0, 'log on top -> Y');
  assert.equal(placementState(ID.oak_log, 0, east, 0), 1, 'log on east -> X');
  assert.equal(placementState(ID.oak_log, 0, south, 0), 2, 'log on south -> Z');
  assert.equal(placementState(ID.furnace, 0, up, 0), 2, 'player looking north: furnace front faces south (toward the player)');
  assert.equal(placementState(ID.furnace, 0, up, Math.PI / 2), 1, 'player looking west: front faces east');
  assert.equal(placementState(ID.oak_leaves, 0, up, 0) & STATE.LEAVES_PERSISTENT, STATE.LEAVES_PERSISTENT, 'player leaves are persistent');
  assert.equal(placementState(ID.oak_stairs, 0, up, 0), 0, 'stairs ascend away from the player');
  assert.equal(placementState(ID.oak_stairs, 0, down, 0), STATE.STAIRS_UPSIDE_DOWN, 'upside-down from below');
  const bed = placementState(ID.bed, 5 << 4, up, 0);
  assert.equal(bed >> 4, 5, 'item placeState bits (bed colour) are kept');
  // fence connections from neighbours
  const getRaw = (x, y, z) => (x === 1 && z === 0 ? ID.stone : 0);
  assert.equal(placementState(ID.oak_fence, 0, up, 0, getRaw, [0, 4, 0]), 2, 'fence joins the stone to the east');
});

test('input: notched wheel vs trackpad swipe heuristic', () => {
  assert.ok(isNotchedWheel({ deltaY: 120, deltaMode: 0 }));
  assert.ok(isNotchedWheel({ deltaY: -100, deltaMode: 0 }));
  assert.ok(isNotchedWheel({ deltaY: 3, deltaMode: 1 }));
  assert.ok(isNotchedWheel({ deltaY: 4, deltaMode: 0, wheelDeltaY: -120 }));
  assert.ok(!isNotchedWheel({ deltaY: 4.5, deltaMode: 0 }), 'trackpad swipe');
  assert.ok(!isNotchedWheel({ deltaY: 37, deltaMode: 0, wheelDeltaY: -44 }), 'trackpad swipe 2');
  assert.ok(!isNotchedWheel({ deltaY: 120, deltaMode: 0, ctrlKey: true }), 'pinch zoom');
  assert.ok(!isNotchedWheel({ deltaY: 0, deltaMode: 0 }));
});

/* ------------------------------------------------------------------ interaction: use order + hooks (SPEC §7.4) */
function makeIxGame({ scheme = 'kid', creative = true } = {}) {
  const w = makeWorld({ size: 32 });
  w.setBlock = (x, y, z, id, st = 0) => { if (w.getRaw(x, y, z) === packBlock(id, st)) return false; w.set(x, y, z, id, st); return true; };
  w.getBlockEntity = () => null;
  const events = new EventBus();
  const held = new Set();
  let pressed = new Set(), queued = new Set();
  const input = {
    scheme, aim: { x: 0, y: 0 }, aimActive: true, pointerLocked: false, move: { forward: 0, strafe: 0 },
    isDown: (a) => held.has(a), wasPressed: (a) => pressed.has(a), isCaptured: () => false,
    tap(a) { queued.add(a); }, hold(a) { if (!held.has(a)) queued.add(a); held.add(a); }, release(a) { held.delete(a); },
    beginTick() { pressed = queued; queued = new Set(); },
  };
  const player = {
    x: 0.5, y: 4, z: 3.5, width: 0.6, height: 1.8, eyeHeight: 1.62, yaw: 0, pitch: -55 * Math.PI / 180, sneaking: false,
    vx: 0, vy: 0, vz: 0, onGround: true, swingTicks: 0, fov: 70,
    getEyePos(out = {}) { out.x = this.x; out.y = this.y + this.eyeHeight; out.z = this.z; return out; },
    swing() { this.swingTicks = 6; },
  };
  const inventory = new Inventory(events);
  const game = {
    events, settings: { ...DEFAULT_SETTINGS }, state: 'playing', meta: { mode: creative ? 'creative' : 'survival', rules: { dropItemsOnBreak: !creative } },
    world: w, input, player, inventory, renderer: { camera: null, setHighlight() {} }, entities: null, rand: () => 0.5,
    isCreative: () => creative, reportError: (e) => { throw e; },
  };
  const ix = createInteractionSystem(game);
  game.interaction = ix;
  ix.init(game);
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { input.beginTick(); ix.tick(game); } };
  return { game, ix, input, w, inventory, player, tick };
}

test('interaction: hook order blockUse > itemUse > placer/default place; kid empty-hand break; one action per press', () => {
  const { game, ix, input, w, inventory, tick } = makeIxGame({ scheme: 'kid' });
  const calls = [];
  try {
    tick(1);
    assert.ok(ix.target && ix.target.y === 3 && ix.target.ny === 1, `targets the floor (${JSON.stringify(ix.target)})`);
    const tx = ix.target.x, tz = ix.target.z;
    inventory.set(0, { item: 'oak_planks', count: 64 }); inventory.selectSlot(0);
    input.tap('use'); tick(1);
    assert.equal(w.getBlock(tx, 4, tz), ID.oak_planks, 'default placement');
    assert.equal(inventory.get(0).count, 64, 'creative never consumes');
    // blockUse on the planks consumes the tap
    hooks.blockUse.set('oak_planks', (ctx) => { calls.push(['block', ctx.action, ctx.hit.id]); return true; });
    tick(1);
    input.tap('use'); tick(1);
    assert.equal(calls.length, 1, 'blockUse called');
    assert.equal(w.getBlock(tx, 5, tz), 0, 'nothing placed on top');
    assert.equal(game.events.counts.get('block:use'), 1, 'block:use emitted');
    hooks.blockUse.delete('oak_planks');
    // itemUse runs when the block has no handler
    hooks.itemUse.set('oak_planks', (ctx) => { calls.push(['item', ctx.stack.item]); return true; });
    input.tap('use'); tick(1);
    assert.deepEqual(calls[1], ['item', 'oak_planks'], 'itemUse called');
    assert.equal(w.getBlock(tx, 5, tz), 0, 'item hook consumed the tap');
    hooks.itemUse.delete('oak_planks');
    // a placer replaces the default placement
    hooks.placers.set('oak_planks', (ctx) => { calls.push(['placer', ctx.x, ctx.y, ctx.z]); return ctx.game.world.setBlock(ctx.x, ctx.y, ctx.z, ID.stone, 0, { action: ctx.action }); });
    input.tap('use'); tick(1);
    assert.equal(calls[2][0], 'placer', JSON.stringify(calls));
    assert.equal(w.getBlock(calls[2][1], calls[2][2], calls[2][3]), ID.stone, 'placer placed its own block');
    hooks.placers.delete('oak_planks');
    // kid creative: tap with food never breaks; empty hand / tool breaks
    inventory.set(0, { item: 'apple', count: 1 });
    tick(1);
    const top = { ...ix.target };
    input.tap('use'); tick(1);
    assert.equal(w.getBlock(top.x, top.y, top.z), top.id, 'apple tap does not break');
    inventory.set(0, null);
    input.tap('use'); tick(1);
    assert.equal(w.getBlock(top.x, top.y, top.z), 0, 'empty-hand tap breaks in kid creative');
    inventory.set(0, { item: 'wooden_pickaxe', count: 1 });
    tick(1);
    const t2 = { ...ix.target };
    input.tap('use'); tick(1);
    assert.equal(w.getBlock(t2.x, t2.y, t2.z), 0, 'tool tap breaks in kid creative');
    // one action id per press
    const acts = [];
    game.events.on('block:placed', (e) => acts.push(e.action));
    inventory.set(0, { item: 'cobblestone', count: 64 });
    game.player.z = 6.5; game.player.pitch = -40 * Math.PI / 180;
    tick(1);
    input.tap('use'); tick(1);
    input.tap('use'); tick(1);
    assert.ok(acts.length === 2 && acts[0] !== acts[1] && acts[0] > 0, 'distinct action per press: ' + acts.join(','));
  } finally {
    hooks.blockUse.delete('oak_planks'); hooks.itemUse.delete('oak_planks'); hooks.placers.delete('oak_planks');
  }
});

test('interaction: survival mining ticks + stages; creative hold repeats every 5 ticks with one action; sneak skips blockUse', () => {
  const s = makeIxGame({ scheme: 'kid', creative: false });
  s.tick(1);
  const t = { ...s.ix.target };
  s.w.set(t.x, t.y, t.z, ID.dirt);
  const stages = [];
  s.game.events.on('block:mining', (e) => stages.push(e.stage));
  s.input.hold('attack');
  let n = 0;
  while (s.w.getBlock(t.x, t.y, t.z) === ID.dirt && n < 50) { s.tick(1); n++; }
  s.input.release('attack');
  assert.equal(n, 15, 'dirt by hand: 15 ticks');
  assert.deepEqual(stages, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'every crack stage once');
  s.tick(10);
  const t2 = { ...s.ix.target };
  s.input.tap('use'); s.tick(1);
  assert.equal(s.w.getBlock(t2.x, t2.y, t2.z), t2.id, 'survival empty-hand tap does not break');

  const c = makeIxGame({ scheme: 'kid', creative: true });
  c.player.pitch = -89 * Math.PI / 180;
  c.tick(1);
  const broken = [];
  c.game.events.on('block:broken', (e) => broken.push(e.action));
  c.input.hold('attack');
  for (let i = 0; i < 11; i++) c.tick(1);
  c.input.release('attack');
  assert.equal(broken.length, 3, `creative hold breaks at ticks 0, 5, 10 (${broken.length})`);
  assert.ok(broken.every((a) => a === broken[0]), 'one hold = one action id (one undo entry)');

  const k = makeIxGame({ scheme: 'classic', creative: true });
  let used = 0;
  hooks.blockUse.set('stone', () => { used++; return true; });
  try {
    k.tick(1);
    k.inventory.set(0, { item: 'cobblestone', count: 64 });
    k.input.tap('use'); k.tick(1);
    assert.equal(used, 1, 'blockUse without sneak');
    k.player.sneaking = true;
    k.input.tap('use'); k.tick(1);
    assert.equal(used, 1, 'sneaking with an item skips blockUse');
    assert.equal(k.game.events.counts.get('block:placed'), 1, 'and places instead');
  } finally { hooks.blockUse.delete('stone'); }
});

/* ------------------------------------------------------------------ judge round 1 fixes (KID-1/2/4, FID-4, ROB-9) */
test('interaction (KID-1): kid taps with a block pass through grass tufts and flowers to the ground behind', () => {
  const k = makeIxGame({ scheme: 'kid' });
  k.player.pitch = -30 * Math.PI / 180;
  k.w.set(0, 4, 1, ID.short_grass);
  k.inventory.set(0, { item: 'oak_planks', count: 64 }); k.inventory.selectSlot(0);
  k.tick(1);
  assert.ok(k.ix.target && k.ix.target.id === ID.stone && k.ix.target.z === 0 && k.ix.target.ny === 1, `ground behind the tuft (${JSON.stringify(k.ix.target)})`);
  k.input.tap('use'); k.tick(1);
  assert.equal(k.w.getBlock(0, 4, 0), ID.oak_planks, 'built where the child pointed');
  assert.equal(k.w.getBlock(0, 4, 1), ID.short_grass, 'not in the nearer tuft cell');
  // a flower in the target cell gives way to the block (one action)
  k.w.set(0, 4, 0, ID.poppy);
  const acts = [];
  k.game.events.on('block:broken', (e) => acts.push(['broken', e.action]));
  k.game.events.on('block:placed', (e) => acts.push(['placed', e.action]));
  k.tick(1); k.input.tap('use'); k.tick(1);
  assert.equal(k.w.getBlock(0, 4, 0), ID.oak_planks, 'poppy replaced');
  assert.ok(acts.length === 2 && acts[0][1] === acts[1][1], 'break + place share one action: ' + JSON.stringify(acts));
  // empty hand: the tuft is still the target (hold-to-break picks it)
  k.inventory.set(0, null); k.w.set(0, 4, 0, 0); k.tick(1);
  assert.equal(k.ix.target && k.ix.target.id, ID.short_grass, 'empty hand targets the tuft');
  // classic: Java targeting (the tuft catches the ray)
  const c = makeIxGame({ scheme: 'classic' });
  c.player.pitch = -30 * Math.PI / 180; c.w.set(0, 4, 1, ID.short_grass);
  c.inventory.set(0, { item: 'oak_planks', count: 64 }); c.inventory.selectSlot(0);
  c.tick(1);
  assert.equal(c.ix.target && c.ix.target.id, ID.short_grass, 'classic keeps Java targeting');
});

test('interaction (KID-2, FID-4): a tap on an entity never builds behind it; kid taps hit monsters and bare-handed animals', () => {
  const run = (scheme, category, item) => {
    const k = makeIxGame({ scheme });
    let hurts = 0;
    const mob = { id: 7, type: category === 'monster' ? 'zombie' : 'cow', category, health: 20, hurt(d) { hurts++; this.health -= d; return true; } };
    k.game.entities = { raycast: (ox, oy, oz, dx, dy, dz, maxD, filter) => (filter(mob) && maxD >= 1 ? { entity: mob, dist: 1 } : null), queryBox: () => [] };
    k.inventory.set(0, item ? { item, count: 64 } : null); k.inventory.selectSlot(0);
    k.tick(1);
    assert.ok(k.ix.targetEntity && k.ix.target, 'entity in front of a block');
    let placed = 0; k.game.events.on('block:placed', () => placed++);
    k.input.tap('use'); k.tick(1);
    const tapHurts = hurts;
    k.input.hold('use'); k.tick(8); k.input.release('use'); k.tick(1);   // a held use (classic right button) never builds either
    return { placed, hurts: tapHurts };
  };
  assert.deepEqual(run('kid', 'creature', 'grass_block'), { placed: 0, hurts: 0 }, 'kid: block in hand on a cow');
  assert.deepEqual(run('kid', 'creature', null), { placed: 0, hurts: 1 }, 'kid: empty hand on a cow is one hit');
  assert.deepEqual(run('kid', 'monster', 'grass_block'), { placed: 0, hurts: 1 }, 'kid: any tap on a zombie is one hit');
  assert.deepEqual(run('kid', 'monster', 'stone_sword'), { placed: 0, hurts: 1 }, 'kid: sword tap on a zombie');
  assert.deepEqual(run('classic', 'monster', 'grass_block'), { placed: 0, hurts: 0 }, 'classic right click on a zombie: nothing');
  // an entityInteract hook (feeding) still wins over the tap attack
  hooks.entityInteract.set('cow', () => true);
  try { assert.deepEqual(run('kid', 'creature', null), { placed: 0, hurts: 0 }, 'hook consumed the tap'); } finally { hooks.entityInteract.delete('cow'); }
});

test('player (KID-4): kid pushing toward a 1-block bank from 2-deep water climbs out; classic does not auto-swim', () => {
  const pool = () => {
    const w = makeWorld();
    for (let x = -6; x <= 6; x++) for (let z = -30; z <= 6; z++) {
      if (z <= -3) { for (let y = 4; y <= 6; y++) w.set(x, y, z, ID.stone); } else { w.set(x, 4, z, ID.water); w.set(x, 5, z, ID.water); }
    }
    return w;
  };
  const k = makeGame(pool(), { scheme: 'kid', settings: { autoJump: true } });
  k.player.spawn(0.5, 4, 0.5, 0, 0);
  k.input.move.forward = 1;
  k.tick(80);
  assert.ok(k.player.onGround && !k.player.inWater && k.player.y === 7 && k.player.z < -2.7, `kid climbed out (${k.player.y.toFixed(2)}, ${k.player.z.toFixed(2)})`);
  const c = makeGame(pool(), { scheme: 'classic', settings: { autoJump: true } });
  c.player.spawn(0.5, 4, 0.5, 0, 0);
  c.input.move.forward = 1;
  c.tick(80);
  assert.ok(c.player.y < 5, `classic stays at the bottom without jump (${c.player.y.toFixed(2)})`);
});

test('player (ROB-9): a damaged save position falls back to the world spawn', () => {
  const { game, player } = makeGame(makeWorld());
  game.meta.spawn = { x: 10.5, y: 4, z: -7.5 };
  player.deserialize(game, { x: NaN, y: null, z: 'abc', yaw: Infinity, pitch: NaN, spawnPoint: { x: NaN, y: 4, z: 0 } });
  assert.deepEqual([player.x, player.y, player.z, player.yaw, player.pitch], [10.5, 4, -7.5, 0, 0]);
  assert.deepEqual(player.spawnPoint, { x: 10.5, y: 4, z: -7.5 });
  player.deserialize(game, { x: 1.5, y: 9999, z: 2.5 });
  assert.equal(player.y, 4, 'y outside the world is refused too');
  player.deserialize(game, { x: 1.5, y: 20, z: 2.5, yaw: 1, pitch: 0.5, spawnPoint: { x: 3, y: 5, z: 6 } });
  assert.deepEqual([player.x, player.y, player.z, player.yaw, player.pitch], [1.5, 20, 2.5, 1, 0.5], 'a good save loads unchanged');
  assert.deepEqual(player.spawnPoint, { x: 3, y: 5, z: 6 });
});
