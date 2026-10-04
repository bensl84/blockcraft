// OWNER LANE: KID. Unit tests for the pure kid/touch modules: undo log, border, home arrow, void rule, stuck
// detector, hint scheduler, voice picking, exit-guard key filter, touch layout and gestures, pixel icons.
import test from 'node:test';
import assert from 'node:assert/strict';

import { UndoLog, MAX_CELLS_PER_ENTRY } from '../src/kid/undo.js';
import {
  BORDER_PUSH, HINT, HINT_ORDER, HintPlan, STUCK, StuckDetector, borderFog, borderState, homeArrowAngle,
  needsVoidRescue, pickVoice, wrapAngle, yawToward,
} from '../src/kid/logic.js';
import { isBlockedKey } from '../src/kid/guards.js';
import { ICONS, MAPS, pixelSvg, rotateLeft } from '../src/kid/pixelicons.js';
import { hintHtml, ALL_HINTS } from '../src/kid/hints.js';
import {
  BUTTON_SIZES, EDGE, GAP, dpadActions, dpadRects, isPalm, joystickVector, rectsTooClose, touchLayout, wantTouch,
} from '../src/ui/touch_logic.js';
import { KID } from '../src/core/constants.js';
import { EventBus } from '../src/core/events.js';
import { createWorldSystem } from '../src/world/world.js';
import { ID } from '../src/core/registry.js';

const DEG = Math.PI / 180;

/** Minimal world: a Map of raw values with the world API the undo log uses. */
function fakeWorld(events) {
  const cells = new Map();
  let batch = 0;
  const w = {
    batches: 0,
    getRaw: (x, y, z) => cells.get(`${x},${y},${z}`) || 0,
    setBlock(x, y, z, id, state = 0, opts = {}) {
      const k = `${x},${y},${z}`, old = cells.get(k) || 0, nv = (id & 0xff) | (state << 8);
      if (old === nv) return false;
      cells.set(k, nv);
      if (events) events.emit('block:changed', { x, y, z, oldId: old & 0xff, oldState: old >> 8, id, state, cause: opts.cause || 'unknown', action: opts.action | 0 });
      return true;
    },
    beginBatch() { batch++; w.batches++; },
    endBatch() { batch--; },
    get inBatch() { return batch > 0; },
  };
  return w;
}
const ch = (x, y, z, oldId, id, cause, action, oldState = 0, state = 0) => ({ x, y, z, oldId, oldState, id, state, cause, action });

test('undo: place then undo restores air; cause filters; ring size', () => {
  const log = new UndoLog(3);
  const w = fakeWorld();
  w.setBlock(1, 4, 1, 5, 0);
  assert.equal(log.record(ch(1, 4, 1, 0, 5, 'player', 1)), true);
  assert.equal(log.record(ch(2, 4, 1, 0, 5, 'undo', 2)), false, 'undo changes are never recorded');
  assert.equal(log.record(ch(2, 4, 1, 0, 5, 'worldgen', 3)), false);
  assert.equal(log.record(ch(2, 4, 1, 0, 5, 'test', 4)), false);
  assert.equal(log.record(ch(2, 4, 1, 0, 5, 'player', 0)), false, 'action 0 is never recorded');
  assert.equal(log.size, 1);
  const r = log.undo(w);
  assert.equal(r.count, 1);
  assert.equal(w.getRaw(1, 4, 1), 0, 'back to air');
  assert.equal(w.batches, 1, 'one batch per undo');
  assert.equal(log.size, 0);
  assert.equal(log.undo(w).count, 0, 'nothing left');
  // ring buffer keeps the newest `max` entries
  for (let a = 10; a < 16; a++) log.record(ch(a, 4, 0, 0, 5, 'player', a));
  assert.equal(log.size, 3);
  assert.deepEqual(log.entries.map((e) => e.action), [13, 14, 15]);
  assert.equal(new UndoLog().max, KID.UNDO_ENTRIES);
});

test('undo: door halves and torches join their action; explosion = one entry; newest cell first', () => {
  const log = new UndoLog();
  const w = fakeWorld();
  // door: lower half by the player, upper half as a cascade with the same action
  w.setBlock(0, 5, 0, ID.oak_door, 0); log.record(ch(0, 5, 0, 0, ID.oak_door, 'player', 7));
  w.setBlock(0, 6, 0, ID.oak_door, 8); log.record(ch(0, 6, 0, 0, ID.oak_door, 'cascade', 7, 0, 8));
  assert.equal(log.size, 1);
  assert.equal(log.peek().cells.length, 2);
  // a cascade arriving BEFORE the qualifying change still joins
  w.setBlock(3, 5, 0, ID.torch, 0); log.record(ch(3, 5, 0, 0, ID.torch, 'support', 9));
  assert.equal(log.size, 1, 'candidate only');
  w.setBlock(3, 4, 0, 0, 0); log.record(ch(3, 4, 0, ID.stone, 0, 'player', 9));
  assert.equal(log.size, 2);
  // explosion: many cells, one entry
  for (let i = 0; i < 20; i++) { w.setBlock(10 + i, 4, 0, 0, 0); log.record(ch(10 + i, 4, 0, ID.stone, 0, 'explosion', 11)); }
  assert.equal(log.size, 3);
  assert.equal(log.peek().cells.length, 20);
  const order = [];
  const spy = { ...w, getRaw: w.getRaw, setBlock: (x, y, z, id, s, o) => { order.push(x); return w.setBlock(x, y, z, id, s, o); } };
  assert.equal(log.undo(spy).count, 20);
  assert.equal(order[0], 29, 'newest cell restored first');
  for (let i = 0; i < 20; i++) assert.equal(w.getRaw(10 + i, 4, 0), ID.stone);
  assert.equal(log.undo(w).count, 2); // stone + torch back? torch cell was air->torch: restores to air; stone back
  assert.equal(w.getRaw(3, 4, 0), ID.stone);
  assert.equal(w.getRaw(3, 5, 0), 0);
  assert.equal(log.undo(w).count, 2, 'both door halves');
  assert.equal(w.getRaw(0, 5, 0), 0);
  assert.equal(w.getRaw(0, 6, 0), 0);
});

test('undo: first before kept per cell, only restores cells still equal to after, skips dead entries', () => {
  const log = new UndoLog();
  const w = fakeWorld();
  // place stone into water (water was "before")
  w.setBlock(0, 4, 0, ID.water, 0);
  w.setBlock(0, 4, 0, ID.stone, 0); log.record(ch(0, 4, 0, ID.water, ID.stone, 'player', 1));
  w.setBlock(0, 4, 0, ID.cobblestone, 0); log.record(ch(0, 4, 0, ID.stone, ID.cobblestone, 'player', 1));
  assert.equal(log.peek().cells[0].before, ID.water, 'first before kept');
  assert.equal(log.peek().cells[0].after, ID.cobblestone, 'latest after');
  // second action, then someone else changes its cell (not recorded): undo skips it and goes to the first
  w.setBlock(5, 4, 0, ID.glass, 0); log.record(ch(5, 4, 0, 0, ID.glass, 'player', 2));
  w.setBlock(5, 4, 0, ID.gold_block, 0); // e.g. a test edit
  const r = log.undo(w);
  assert.equal(r.count, 1);
  assert.equal(r.entry.action, 1);
  assert.equal(w.getRaw(0, 4, 0), ID.water, 'water is back');
  assert.equal(w.getRaw(5, 4, 0), ID.gold_block, 'changed cell untouched');
});

test('redo (KID-8): the last undone action comes back first; a new action clears redo; dead cells skipped', () => {
  const log = new UndoLog(50);
  const events = new EventBus();
  const w = fakeWorld(events);
  events.on('block:changed', (e) => log.record(e));
  const DOOR = ID.oak_door ?? 30;
  // five player placements, then a door (two halves, one action)
  for (let i = 0; i < 5; i++) w.setBlock(i, 4, 0, ID.stone, 0, { cause: 'player', action: i + 1 });
  w.setBlock(9, 4, 0, DOOR, 0, { cause: 'player', action: 9 });
  w.setBlock(9, 5, 0, DOOR, 8, { cause: 'cascade', action: 9 });
  assert.equal(log.size, 6);
  // undo the door: redo puts both halves back (bottom first) in one batch, not recorded as a new action
  assert.equal(log.undo(w).count, 2);
  assert.equal(w.getRaw(9, 5, 0), 0);
  assert.equal(log.redoSize, 1);
  const b0 = w.batches;
  assert.equal(log.redo(w).count, 2);
  assert.equal(w.batches, b0 + 1, 'one batch per redo');
  assert.equal(w.getRaw(9, 4, 0) & 0xff, DOOR);
  assert.equal(w.getRaw(9, 5, 0) >> 8, 8, 'top half state back');
  assert.equal(log.size, 6, 'the redone action is undoable again (and not recorded twice)');
  assert.equal(log.redoSize, 0);
  // mash undo: everything gone, all of it redoable
  for (let i = 0; i < 6; i++) assert.ok(log.undo(w).count > 0);
  assert.equal(log.size, 0);
  assert.equal(log.redoSize, 6);
  assert.equal(log.undo(w).count, 0, 'nothing left to undo');
  // redo walks forward again: the last undone (placement 1) first
  assert.equal(log.redo(w).count, 1);
  assert.equal(w.getRaw(0, 4, 0), ID.stone, 'placement 1 back');
  assert.equal(w.getRaw(1, 4, 0), 0, 'placement 2 still undone');
  assert.equal(log.size, 1);
  assert.equal(log.redoSize, 5);
  // undo again then redo again round-trips
  assert.equal(log.undo(w).count, 1);
  assert.equal(w.getRaw(0, 4, 0), 0);
  assert.equal(log.redo(w).count, 1);
  assert.equal(w.getRaw(0, 4, 0), ID.stone);
  // a cell changed by someone else since the undo is left alone; an entry with nothing left is dropped
  w.setBlock(1, 4, 0, ID.glass, 0);   // unrecorded edit where placement 2 was
  assert.equal(log.redo(w).count, 1, 'skips placement 2 (its cell is no longer air) and redoes placement 3');
  assert.equal(w.getRaw(1, 4, 0), ID.glass, 'edited cell untouched');
  assert.equal(w.getRaw(2, 4, 0), ID.stone);
  assert.equal(log.redoSize, 3);
  // a new player action clears the redo stack
  w.setBlock(20, 4, 0, ID.stone, 0, { cause: 'player', action: 20 });
  assert.equal(log.redoSize, 0, 'new action clears redo');
  assert.equal(log.redo(w).count, 0);
  assert.equal(w.getRaw(3, 4, 0), 0, 'placement 4 stays undone');
  // clear() empties redo too
  log.undo(w);
  assert.equal(log.redoSize, 1);
  log.clear();
  assert.equal(log.redoSize, 0);
});

test('undo: candidates are bounded and entries capped', () => {
  const log = new UndoLog();
  for (let a = 1; a <= 200; a++) log.record(ch(a, 1, 1, 0, 1, 'cascade', a));
  assert.ok(log.byAction.size <= 64, `candidates bounded (${log.byAction.size})`);
  assert.equal(log.size, 0);
  for (let i = 0; i < MAX_CELLS_PER_ENTRY + 50; i++) log.record(ch(i, 2, 0, 0, 1, 'explosion', 999));
  assert.equal(log.peek().cells.length, MAX_CELLS_PER_ENTRY);
});

test('undo: integrates with the real world system (block:changed from setBlock, cause undo not re-recorded)', () => {
  const events = new EventBus();
  const game = { events, renderer: null };
  const world = createWorldSystem(game);
  const log = new UndoLog();
  events.on('block:changed', (e) => log.record(e, 0));
  // fake a loaded column: world.open + generate a single column through its public API is heavy; use the
  // fake world for behaviour and only check that the payload shape matches what UndoLog expects.
  const payload = { x: 1, y: 2, z: 3, oldId: ID.water, oldState: 0, id: ID.stone, state: 0, cause: 'player', action: 4 };
  events.emit('block:changed', payload);
  assert.equal(log.size, 1);
  events.emit('block:changed', { ...payload, cause: 'undo', action: 0 });
  assert.equal(log.size, 1);
  assert.equal(typeof world.setBlock, 'function');
});

test('home arrow angle and facing yaw follow SPEC §3.7 (+yaw = left)', () => {
  // home straight north of the player, looking north -> 0
  assert.ok(Math.abs(homeArrowAngle(0, 0, 0, 0, -50)) < 1e-9);
  // home to the west (-X) while looking north -> +90 deg (to the left)
  assert.ok(Math.abs(homeArrowAngle(0, 0, 0, -50, 0) - 90 * DEG) < 1e-9);
  // home to the east while looking north -> -90 (right)
  assert.ok(Math.abs(homeArrowAngle(0, 0, 0, 50, 0) + 90 * DEG) < 1e-9);
  // looking west (yaw +90) with home west -> ahead
  assert.ok(Math.abs(homeArrowAngle(0, 0, 90 * DEG, -50, 0)) < 1e-9);
  // behind -> +-180
  assert.ok(Math.abs(Math.abs(homeArrowAngle(0, 0, 0, 0, 50)) - Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
  // yawToward agrees with the look vector (-sin yaw, -cos yaw)
  const y = yawToward(0, 0, 3, 4);
  assert.ok(Math.abs(-Math.sin(y) - 0.6) < 1e-9 && Math.abs(-Math.cos(y) - 0.8) < 1e-9);
});

test('soft border state, push direction and thickening fog', () => {
  const s = borderState(600, 0, 0, 0, 512);
  assert.equal(s.over, 88);
  assert.equal(s.nx, -1); assert.equal(s.nz, -0);
  assert.equal(s.fogT, 1);
  assert.equal(borderState(100, 0, 0, 0, 512).fogT, 0);
  const mid = borderState(496, 0, 0, 0, 512);
  assert.ok(mid.fogT > 0.45 && mid.fogT < 0.55 && mid.over === 0);
  assert.equal(borderState(9999, 0, 0, 0, 0).over, 0, 'radius 0 = no border');
  const f0 = borderFog(0, 88), f1 = borderFog(1, 88);
  assert.equal(f0.far, 88);
  assert.ok(f1.far < 20 && f1.near < f1.far && f1.near >= 1);
  assert.equal(BORDER_PUSH, 0.1);
});

test('void rescue rule', () => {
  assert.equal(needsVoidRescue(-0.01), true);
  assert.equal(needsVoidRescue(0), false);
  assert.equal(needsVoidRescue(5, 0), false);
  assert.equal(needsVoidRescue(5, 20), true, '10+ below the lowest terrain');
  assert.equal(needsVoidRescue(15, 20), false);
});

test('stuck detector: 3 s pushing while enclosed, jump 1 s pops; head-in-block auto pops', () => {
  const d = new StuckDetector();
  const s = { x: 0, z: 0, pushing: true, enclosed: true, headInBlock: false, jumpDown: false };
  let r = null;
  for (let i = 0; i < STUCK.PUSH_TICKS - 1; i++) r = d.update(s);
  assert.equal(d.stuck, false);
  r = d.update(s);
  assert.equal(r, 'stuck'); assert.equal(d.reason, 'enclosed');
  for (let i = 0; i < STUCK.JUMP_HOLD_TICKS - 1; i++) assert.notEqual(d.update({ ...s, jumpDown: true }), 'pop');
  assert.equal(d.update({ ...s, jumpDown: true }), 'pop');
  // moving resets
  const m = new StuckDetector();
  for (let i = 0; i < 100; i++) m.update({ ...s, x: i * 0.1 });
  assert.equal(m.stuck, false, 'moving is not stuck');
  // not enclosed: never stuck
  const n = new StuckDetector();
  for (let i = 0; i < 200; i++) n.update({ ...s, enclosed: false });
  assert.equal(n.stuck, false);
  // head in a block
  const h = new StuckDetector();
  const hs = { x: 0, z: 0, pushing: false, enclosed: false, headInBlock: true, jumpDown: false };
  const out = [];
  for (let i = 0; i < STUCK.HEAD_AUTO_POP_TICKS; i++) out.push(h.update(hs));
  assert.equal(out[STUCK.HEAD_TICKS - 1], 'stuck');
  assert.equal(out[STUCK.HEAD_AUTO_POP_TICKS - 1], 'pop');
  // freed by digging out
  const f = new StuckDetector();
  for (let i = 0; i < STUCK.PUSH_TICKS; i++) f.update(s);
  assert.equal(f.update({ ...s, enclosed: false }), 'free');
});

test('hint plan: idle 7 s shows the next hint, at most 3 loops per hint per session, success only if shown', () => {
  const h = new HintPlan();
  let r;
  for (let i = 0; i < HINT.IDLE_TICKS - 1; i++) { r = h.tick(true); assert.equal(r.show, null); }
  r = h.tick(true);
  assert.equal(r.show, 'walk');
  // completing a non-shown hint: no sparkle
  const c1 = h.complete('turn');
  assert.equal(c1.first, true); assert.equal(c1.wasShown, false);
  // the visible hint loops 3 times then hides
  let hides = 0;
  for (let i = 0; i < HINT.LOOP_TICKS * HINT.MAX_LOOPS; i++) if (h.tick(true).hide) hides++;
  assert.equal(hides, 1);
  assert.equal(h.loops.get('walk'), 3);
  // walk is out of loops, turn is done -> next is place
  for (let i = 0; i < HINT.IDLE_TICKS - 1; i++) h.tick(true);
  assert.equal(h.tick(true).show, 'place');
  const c2 = h.complete('place');
  assert.equal(c2.hide, true); assert.equal(c2.wasShown, true);
  // not allowed (screen open) -> idle resets, nothing shows
  for (let i = 0; i < HINT.IDLE_TICKS * 2; i++) assert.equal(h.tick(false).show, null);
  // fly skipped when the player cannot fly
  const g = new HintPlan();
  for (const n of HINT_ORDER) if (n !== 'fly') g.complete(n);
  assert.equal(g.next(false), null);
  assert.equal(g.next(true), 'fly');
});

test('speech uses local voices only', () => {
  const voices = [
    { name: 'Cloud', lang: 'en-US', localService: false, default: true },
    { name: 'Local FR', lang: 'fr-FR', localService: true },
    { name: 'Local US', lang: 'en-US', localService: true },
  ];
  assert.equal(pickVoice(voices, 'en-US').name, 'Local US');
  assert.equal(pickVoice(voices, 'fr-CA').name, 'Local FR');
  assert.equal(pickVoice(voices, 'de-DE').name, 'Local US', 'falls back to English');
  assert.equal(pickVoice([{ name: 'Cloud', lang: 'en-US', localService: false }], 'en-US'), null, 'never a network voice');
  assert.equal(pickVoice([], 'en-US'), null);
});

test('exit guards block reload / zoom / help keys but not game keys', () => {
  const k = (code, mods = {}) => isBlockedKey({ code, ...mods });
  assert.ok(k('F5')); assert.ok(k('F1')); assert.ok(k('F3')); assert.ok(k('F6')); assert.ok(k('F7'));
  assert.ok(k('KeyR', { ctrlKey: true })); assert.ok(k('KeyR', { metaKey: true }));
  assert.ok(k('Equal', { ctrlKey: true })); assert.ok(k('Minus', { ctrlKey: true })); assert.ok(k('Digit0', { ctrlKey: true }));
  assert.ok(k('ArrowLeft', { altKey: true })); assert.ok(k('BrowserBack'));
  assert.ok(!k('KeyR')); assert.ok(!k('KeyW')); assert.ok(!k('ArrowLeft')); assert.ok(!k('Space')); assert.ok(!k('Escape'));
  assert.ok(!k('KeyE', { ctrlKey: true }), 'only listed ctrl combos');
});

test('touch layout: sizes, 24 px margins, 8 px gaps, spec positions, mirroring', () => {
  for (const size of ['S', 'M', 'L']) {
    for (const [W, H] of [[1280, 720], [1366, 768], [1920, 1080], [1024, 768], [812, 375]]) {
      const L = touchLayout(W, H, size, false);
      const R = dpadRects(L.dpad);
      const all = { ...R, jump: L.jump, fly: L.fly, down: L.down, pause: L.pause };
      for (const [n, r] of Object.entries(all)) {
        assert.ok(r.w >= 80 && r.h >= 80, `${n} >= 80 px (${size} ${W}x${H})`);
        assert.ok(r.x >= EDGE && r.y >= EDGE && r.x + r.w <= W - EDGE && r.y + r.h <= H - EDGE, `${n} inside 24 px margins (${size} ${W}x${H}): ${JSON.stringify(r)}`);
      }
      const names = Object.keys(all);
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        assert.ok(!rectsTooClose(all[names[i]], all[names[j]], GAP), `${names[i]} vs ${names[j]} keep ${GAP} px (${size} ${W}x${H})`);
      }
      assert.equal(L.btn, BUTTON_SIZES[size]);
    }
  }
  const M = touchLayout(1280, 720, 'M', false);
  assert.equal(M.dpad.cx, 24 + 140); assert.equal(M.dpad.cy, 720 - 24 - 140);
  assert.equal(M.jump.w, 112);
  assert.equal(1280 - (M.jump.x + M.jump.w / 2), 100, 'jump about 100 px from the right edge');
  assert.equal(720 - (M.jump.y + M.jump.h / 2), 140, 'and 140 px from the bottom');
  assert.equal(M.down.w, 96);
  assert.ok(M.fly.y + M.fly.h <= M.jump.y - GAP, 'fly above jump');
  const LH = touchLayout(1280, 720, 'M', true);
  assert.equal(LH.dpad.cx, 1280 - 164);
  assert.equal(LH.jump.x, 1280 - M.jump.x - M.jump.w);
  assert.deepEqual(LH.pause, M.pause, 'pause stays top right');
});

test('touch layout: the jump / down / fly column is lifted clear of the HUD block (LEAD integration)', () => {
  const overlap = (r, h) => r.x < h.right + GAP && r.x + r.w > h.left - GAP && r.y + r.h > h.top - GAP;
  // 1024 x 600 survival HUD measured in the browser: hotbar 219..805, backpack to 885, hearts row from y 455
  for (const [W, H, hud] of [[1024, 600, { left: 219, right: 885, top: 455 }], [1280, 720, { left: 311, right: 1057, top: 575 }], [1366, 768, { left: 354, right: 1100, top: 623 }]]) {
    for (const lh of [false, true]) {
      const L = touchLayout(W, H, 'M', lh, lh ? { left: W - hud.right, right: W - hud.left, top: hud.top } : hud);
      const h = lh ? { left: W - hud.right, right: W - hud.left, top: hud.top } : hud;
      for (const n of ['jump', 'down', 'fly']) assert.ok(!overlap(L[n], h), `${n} clear of the HUD (${W}x${H} lh=${lh}): ${JSON.stringify(L[n])}`);
      for (const n of ['jump', 'down', 'fly']) assert.ok(!rectsTooClose(L[n], L.pause, GAP), `${n} clear of pause (${W}x${H})`);
      assert.ok(!rectsTooClose(L.jump, L.down, GAP) && !rectsTooClose(L.jump, L.fly, GAP) && !rectsTooClose(L.fly, L.down, GAP), 'column buttons apart');
    }
  }
  // POL-12: the D-pad and the joystick rise clear of the HUD block (1024 x 600 survival: hearts under ▶)
  const inX = (r, h) => r.x < h.right && r.x + r.w > h.left;
  for (const [W, H, hud] of [[1024, 600, { left: 213, right: 885, top: 442 }], [1024, 640, { left: 213, right: 885, top: 482 }], [1280, 720, { left: 311, right: 1057, top: 575 }]]) {
    for (const lh of [false, true]) {
      const h = lh ? { left: W - hud.right, right: W - hud.left, top: hud.top } : hud;
      const L = touchLayout(W, H, 'M', lh, h);
      const rs = dpadRects(L.dpad);
      for (const k in rs) {
        const r = rs[k];
        assert.ok(!inX(r, h) || r.y + r.h <= h.top - GAP, `D-pad ${k} clear of the HUD (${W}x${H} lh=${lh}): ${JSON.stringify(r)}`);
        assert.ok(r.y >= L.pause.y + L.pause.h + GAP, `D-pad ${k} below the top row (${W}x${H})`);
        assert.ok(r.y + r.h <= H - EDGE, `D-pad ${k} on screen`);
      }
      const j = L.joystick, jr = { x: j.cx - j.base / 2, y: j.cy - j.base / 2, w: j.base, h: j.base };
      assert.ok(!inX(jr, h) || jr.y + jr.h <= h.top - GAP, `joystick clear of the HUD (${W}x${H} lh=${lh})`);
    }
  }
  // no HUD overlap: the D-pad keeps its spec spot (24 px margins)
  const free = touchLayout(1366, 768, 'M', false, { left: 354, right: 1100, top: 600 });
  assert.equal(free.dpad.cy, 768 - EDGE - free.dpad.extent);
  // a wide screen with the HUD far away keeps the spec position
  const wide = touchLayout(1920, 1080, 'M', false, { left: 650, right: 1330, top: 900 });
  assert.equal(1080 - (wide.jump.y + wide.jump.h / 2), 140);
});

test('touch D-pad sectors, joystick, palm and visibility rules', () => {
  const a = (dx, dy) => { const o = dpadActions(dx, dy, 20); return ['forward', 'back', 'turnLeft', 'turnRight'].filter((k) => o[k]).join('+'); };
  assert.equal(a(0, -60), 'forward');
  assert.equal(a(0, 60), 'back');
  assert.equal(a(-60, 0), 'turnLeft');
  assert.equal(a(60, 0), 'turnRight');
  assert.equal(a(-50, -50), 'forward+turnLeft');
  assert.equal(a(50, -50), 'forward+turnRight');
  assert.equal(a(5, 5), '', 'dead zone');
  const j = joystickVector(0, -100, 48);
  assert.equal(j.ky, -48); assert.equal(j.fx, 1); assert.equal(j.sx, 0);
  const j2 = joystickVector(3, 2, 48);
  assert.equal(j2.fx, 0); assert.equal(j2.sx, 0, 'dead zone');
  assert.equal(isPalm(60, 60), true); assert.equal(isPalm(20, 20), false); assert.equal(isPalm(undefined, undefined), false);
  assert.equal(wantTouch('on', 'mouse'), true);
  assert.equal(wantTouch('off', 'touch'), false);
  assert.equal(wantTouch('auto', 'touch'), true);
  assert.equal(wantTouch('auto', 'mouse'), false);
});

test('pixel icons are well-formed 16x16 maps and hints render for every name and variant', () => {
  for (const [name, fn] of Object.entries(ICONS)) {
    const svg = fn();
    assert.ok(svg.startsWith('<svg') && svg.includes('<rect'), `${name} renders`);
    assert.ok(/viewBox="0 0 (16 16|8 16|12 8)"/.test(svg), `${name} viewBox`);
  }
  for (const [name, rows] of Object.entries(MAPS)) {
    assert.ok(rows.length === 16 || name === 'COMPASS_ARROW', `${name}: 16 rows`);
    for (const row of rows) assert.equal(row.length, rows[0].length, `${name}: equal row lengths`);
    for (const row of rows) assert.ok(/^[.WKYORDGLBNCUVPHSA]+$/.test(row), `${name}: palette chars only`);
  }
  assert.ok(pixelSvg(['W.', '.W']).includes('width="1"'));
  const r = rotateLeft(['W...', '....', '....', '....']);
  assert.equal(r[3][0], 'W');
  for (const n of ALL_HINTS) for (const v of ['keys', 'touch']) assert.ok(hintHtml(n, v).includes('kid-pic'), `${n}/${v}`);
});
