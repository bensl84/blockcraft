// OWNER LANE: KID. Smoke scenarios for the touch overlay and kid helpers (SPEC §8.5, §13.2).
// Scenarios marked requires: [] run against the CORE stubs today (they drive the kid system through events,
// the test API and the documented world/interaction routines). Scenarios that need the real core list those
// lanes in `requires` and report PENDING until the core lanes land.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const FLAT = { preset: 'flat', seed: 5, mode: 'creative', difficulty: 'peaceful' };
const TMP = fileURLToPath(new URL('../../.tmp/', import.meta.url));

/** Rect of a DOM element by CSS selector (or null). */
const rectOf = (t, sel) => t.eval((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  const cs = getComputedStyle(e);
  return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' };
}, sel);

/** CDP multi-touch helper (needs --touch). Pointer events from it carry pointerType 'touch'. */
async function touchPad(t) {
  const cdp = await t.page.context().newCDPSession(t.page);
  const active = new Map();
  const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...active.values()] });
  return {
    async down(id, x, y, r = 6) { active.set(id, { x, y, id, radiusX: r, radiusY: r, force: 1 }); await send('touchStart'); },
    async move(id, x, y) { const p = active.get(id); if (!p) return; p.x = x; p.y = y; await send('touchMove'); },
    // CDP: touchEnd carries no points; releasing one of several fingers = touchMove with the remaining ones
    async up(id) { active.delete(id); await (active.size ? send('touchMove') : cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })); },
    async end() { if (active.size) { active.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } await cdp.detach(); },
  };
}

const W = 1280, H = 720;
const px = (n) => ({ x: Math.round((n.x + 1) / 2 * W), y: Math.round((1 - n.y) / 2 * H) });
const centre = (r) => [Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2)];
const held = (t) => t.eval(() => window.__game.game.touch.held().sort());
const isDown = (t, a) => t.eval((a) => window.__game.game.input.isDown(a), a);

export default [
  {
    name: 'kid-buttons',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('waitFrames', 3);
      const home = await rectOf(t, '[data-kid="home"]');
      const undo = await rectOf(t, '[data-kid="undo"]');
      t.note('home', home); t.note('undo', undo);
      t.assert(home && home.visible && home.w >= 80 && home.h >= 80, `Home button is a primary 80 px control (${JSON.stringify(home)})`);
      t.assert(home.x >= 24 && home.y >= 24, 'Home sits 24 px from the top-left edges');
      t.assert(undo && undo.visible && undo.w >= 56 && undo.h >= 56, 'Undo button is at least a secondary 56 px control');
      t.assert(undo.x >= home.x + home.w + 8, 'Undo keeps 8 px from Home');
      // press Home with a real mouse after walking away
      const p0 = await t.call('pos');
      await t.call('teleport', p0.x + 30, p0.y + 5, p0.z - 30);
      const n0 = await t.call('eventCount', 'kid:home');
      await t.page.mouse.click(home.x + home.w / 2, home.y + home.h / 2);
      await t.call('waitTicks', 6);
      const p1 = await t.call('pos');
      t.assert(Math.hypot(p1.x - p0.x, p1.z - p0.z) < 1 && Math.abs(p1.y - p0.y) < 1, `Home button teleports home (${JSON.stringify(p1)})`);
      t.assert(await t.call('eventCount', 'kid:home') === n0 + 1, 'kid:home emitted once');
      const sparks = await t.eval(() => document.querySelectorAll('.kid-spark').length);
      t.assert(sparks > 0, 'sparkles burst on arrival');
      const tp = (await t.call('events', 'player:teleport', 1))[0];
      t.assert(tp && tp.payload.reason === 'home', 'player:teleport reason home');
      await t.shot('kid-buttons');
      // buttons hide on the title
      await t.call('exitToTitle');
      await t.call('waitFrames', 2);
      t.assert(!(await rectOf(t, '[data-kid="home"]')).visible, 'Home hidden on the title screen');
    },
  },
  {
    name: 'kid-void',
    requires: [],
    async run(t) {
      await t.call('startWorld', { ...FLAT, mode: 'survival', difficulty: 'easy' });
      t.assert((await t.call('meta')).rules.voidRescue === true, 'voidRescue on in survival');
      const p0 = await t.call('pos');
      const hurt0 = await t.call('eventCount', 'player:hurt');
      await t.call('teleport', p0.x + 3, -30, p0.z + 3);
      await t.call('runTicks', 10);
      const p = await t.call('pos');
      const sy = await t.call('surfaceY', p.x, p.z);
      t.note('after', { y: p.y, surface: sy, health: p.health });
      t.assert(Math.abs(p.y - sy) < 0.01, `back on the surface within 10 ticks (y ${p.y}, surface ${sy})`);
      t.assert(p.health === p0.health, 'health unchanged');
      const hurts = await t.call('events', 'player:hurt', 50);
      t.assert(!hurts.some((h) => h.payload.cause === 'void'), 'no void damage');
      t.assert(await t.call('eventCount', 'player:hurt') === hurt0 || !hurts.some((h) => h.payload.cause === 'void'), 'no hurt from the fall');
      const r = await t.call('events', 'kid:rescue', 1);
      t.assert(r.length && r[0].payload.reason === 'void', 'kid:rescue {reason: void}');
      const tp = await t.call('events', 'player:teleport', 1);
      t.assert(tp[0].payload.reason === 'void', 'teleport reason void');
      // with the rule off nothing happens
      await t.call('setRule', 'voidRescue', false);
      await t.call('teleport', p0.x, -5, p0.z);
      await t.call('runTicks', 5);
      t.assert((await t.call('pos')).y < 0, 'rule off: no rescue');
      await t.call('setRule', 'voidRescue', true);
      await t.call('runTicks', 2);
      t.assert((await t.call('pos')).y >= 0, 'rule back on: rescued');
    },
  },
  {
    name: 'kid-undo',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const p = await t.call('pos');
      const x = Math.floor(p.x) + 3, z = Math.floor(p.z) - 3, y = 4;
      // 1) place (by the player, through THE shared place routine) then U key -> air
      t.assert(await t.eval(([x, y, z]) => { const g = window.__game.game; return g.interaction.placeBlock(x, y, z, window.__game.blockId('oak_planks'), 0, { by: 'player', item: 'oak_planks' }); }, [x, y, z]), 'placed planks');
      t.assert(await t.call('getBlock', x, y, z) === 'oak_planks', 'planks there');
      await t.page.keyboard.press('KeyU');
      await t.call('waitTicks', 1);
      t.assert(await t.call('getBlock', x, y, z) === 'air', 'U undoes the place');
      const u = await t.call('events', 'kid:undo', 1);
      t.assert(u.length && u[0].payload.count === 1, 'kid:undo {count: 1}');
      // 2) door: lower half by the player, upper half as MECH's cascade with the same action -> both gone
      const door = await t.eval(([x, y, z]) => {
        const g = window.__game.game, id = window.__game.blockId('oak_door');
        const action = g.interaction.newAction();
        g.interaction.placeBlock(x, y, z, id, 0, { by: 'player', item: 'oak_door', action });
        g.world.setBlock(x, y + 1, z, id, 8, { cause: 'cascade', action });
        return [g.world.getBlock(x, y, z), g.world.getBlock(x, y + 1, z)].every((b) => b === id);
      }, [x, y, z]);
      t.assert(door, 'door placed (both halves)');
      t.assert(await t.eval(() => window.__game.game.kid.undo()), 'undo() returns true');
      t.assert(await t.call('getBlock', x, y, z) === 'air' && await t.call('getBlock', x, y + 1, z) === 'air', 'both door halves gone');
      // 3) place into water -> undo -> water back
      await t.call('setBlock', x, y, z, 'water');
      await t.eval(([x, y, z]) => window.__game.game.interaction.placeBlock(x, y, z, window.__game.blockId('stone'), 0, { by: 'player' }), [x, y, z]);
      t.assert(await t.call('getBlock', x, y, z) === 'stone', 'stone replaced the water');
      await t.eval(() => window.__game.game.kid.undo());
      t.assert(await t.call('getBlock', x, y, z) === 'water', 'water is back');
      await t.call('setBlock', x, y, z, 'air');
      // 4) explosion: 9 cells broken with one action id and cause 'explosion' in one batch -> one undo entry
      const blasted = await t.eval(([x, y, z]) => {
        const g = window.__game.game;
        const action = g.interaction.newAction();
        g.world.beginBatch();
        let n = 0;
        try { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (g.interaction.breakBlock(x + dx, y - 1, z + dz, { by: 'explosion', action, drops: false })) n++; } finally { g.world.endBatch(); }
        return n;
      }, [x, y, z]);
      t.assert(blasted === 9, `9 blocks blasted (${blasted})`);
      const entries = await t.eval(() => window.__game.game.kid.undoLog.size);
      t.assert(entries === 1, `one undo entry for the blast (${entries})`);
      // the Undo button (DOM, real mouse)
      const ub = await rectOf(t, '[data-kid="undo"]');
      await t.page.mouse.click(ub.x + ub.w / 2, ub.y + ub.h / 2);
      await t.call('waitTicks', 1);
      const restored = await t.eval(([x, y, z]) => {
        const g = window.__game.game; let n = 0;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (g.world.getBlock(x + dx, y - 1, z + dz) !== 0) n++;
        return n;
      }, [x, y, z]);
      t.assert(restored === 9, `the Undo button restores the whole blast (${restored}/9)`);
      // 5) a cell changed since (test edit) is never overwritten; empty undo is a gentle no
      await t.eval(([x, y, z]) => window.__game.game.interaction.placeBlock(x, y, z, window.__game.blockId('glass'), 0, { by: 'player' }), [x, y, z]);
      await t.call('setBlock', x, y, z, 'gold_block');
      t.assert(await t.eval(() => window.__game.game.kid.undo()) === false, 'nothing restorable -> false');
      t.assert(await t.call('getBlock', x, y, z) === 'gold_block', 'changed cell untouched');
      t.assert((await t.call('events', 'sound', 5)).some((e) => e.payload.name === 'ui.error'), 'gentle error sound');
      // 6) undo changes are never recorded (no redo loop) and test edits are ignored
      t.assert(await t.eval(() => window.__game.game.kid.undoLog.size) === 0, 'log empty');
    },
  },
  {
    // Real core: kid tap places, the door placer (MECH) adds the upper half, a real TNT explosion.
    name: 'kid-undo-real',
    requires: ['input', 'player', 'physics', 'raycast', 'interaction', 'world'],
    async run(t) {
      // a child taps to build, holds to break, then presses the real Undo button / U key
      await t.call('startWorld', FLAT);
      await t.call('setFlying', false);
      await t.call('waitTicks', 10);
      await t.call('setLook', 0, -25);
      await t.call('waitFrames', 3);
      const p = await t.call('pos');
      const bx = Math.floor(p.x) - 1, bz = Math.floor(p.z) - 5;
      await t.call('selectSlot', 0);
      const item = await t.eval(() => { const s = window.__game.game.inventory.getSelected(); return s ? s.item : null; });
      const tapAt = async (x, y, z, ms = 80) => {
        const n = px(await t.call('worldToNdc', x, y, z));
        await t.page.mouse.move(n.x, n.y);
        await t.call('waitFrames', 2);
        await t.page.mouse.down();
        await t.call('sleep', ms);
        await t.page.mouse.up();
        await t.call('waitTicks', 3);
      };
      // tap three blocks into a little wall (each tap is its own action)
      for (let i = 0; i < 3; i++) await tapAt(bx + i + 0.5, 4, bz + 0.5);
      const tower = [];
      for (let i = 0; i < 3; i++) tower.push(await t.call('getBlock', bx + i, 4, bz));
      t.assert(tower.every((b) => b && b !== 'air'), `tapping built a wall (${tower} / held ${item})`);
      await t.shot('kid-undo-real-tower');
      const undo = await rectOf(t, '[data-kid="undo"]');
      await t.page.mouse.click(...centre(undo));
      await t.call('waitTicks', 2);
      t.assert(await t.call('getBlock', bx + 2, 4, bz) === 'air' && await t.call('getBlock', bx + 1, 4, bz) !== 'air', 'Undo button removes only the newest block');
      await t.page.keyboard.press('KeyU');
      await t.call('waitTicks', 2);
      t.assert(await t.call('getBlock', bx + 1, 4, bz) === 'air' && await t.call('getBlock', bx, 4, bz) !== 'air', 'U removes the next one');
      // hold to break the last tower block, undo brings it back
      const n = px(await t.call('worldToNdc', bx + 0.5, 4.6, bz + 0.98));
      await t.page.mouse.move(n.x, n.y);
      await t.call('waitFrames', 2);
      await t.page.mouse.down();
      await t.call('sleep', 560);
      await t.page.mouse.up();
      await t.call('waitTicks', 2);
      t.assert(await t.call('getBlock', bx, 4, bz) === 'air', 'hold broke the block');
      await t.page.mouse.click(...centre(undo));
      await t.call('waitTicks', 2);
      t.assert(await t.call('getBlock', bx, 4, bz) === tower[0], 'undo puts the broken block back');
      // a block placed where the player stands is undone without trapping them; then nothing left -> error sound
      const ev = await t.call('eventCount', 'kid:undo');
      t.assert(ev >= 3, `kid:undo events (${ev})`);
      await t.page.mouse.click(...centre(undo));
      await t.call('waitTicks', 2);
      await t.page.mouse.click(...centre(undo));
      await t.call('waitTicks', 2);
      const snd = await t.call('events', 'sound', 3);
      t.assert(snd.some((e) => e.payload.name === 'ui.error'), 'empty undo plays the error sound');
      await t.call('waitFrames', 10);
      await t.shot('kid-undo-real-empty');
    },
  },
  {
    name: 'kid-undo-mech',
    requires: ['input', 'player', 'physics', 'raycast', 'interaction', 'world', 'mechanics'],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('setFlying', false);
      await t.call('waitTicks', 10);
      await t.call('setLook', 0, -55);
      await t.call('setSlot', 0, 'oak_door', 1);
      await t.call('selectSlot', 0);
      const dp = await t.call('placeTarget');
      t.assert(dp.ok && await t.call('getBlock', dp.x, dp.y + 1, dp.z) === 'oak_door', 'door with both halves');
      await t.call('press', 'undo');
      await t.call('waitTicks', 2);
      t.assert(await t.call('getBlock', dp.x, dp.y, dp.z) === 'air' && await t.call('getBlock', dp.x, dp.y + 1, dp.z) === 'air', 'undo removes both door halves');
      const p = await t.call('pos');
      const bx = Math.floor(p.x) + 6, bz = Math.floor(p.z) + 6;
      const before = await t.eval(([x, z]) => { const g = window.__game.game; let n = 0; for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let y = 1; y <= 4; y++) if (g.world.getBlock(x + dx, y, z + dz)) n++; return n; }, [bx, bz]);
      await t.eval(([x, z]) => window.__game.game.mechanics.explode(x + 0.5, 3.5, z + 0.5, 3, { source: 'test', breakBlocks: true }), [bx, bz]);
      await t.call('waitTicks', 3);
      await t.call('press', 'undo');
      await t.call('waitTicks', 3);
      const after = await t.eval(([x, z]) => { const g = window.__game.game; let n = 0; for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let y = 1; y <= 4; y++) if (g.world.getBlock(x + dx, y, z + dz)) n++; return n; }, [bx, bz]);
      t.assert(after === before, `one undo restores the crater (${after}/${before})`);
    },
  },
  {
    name: 'kid-border',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('setRule', 'worldBorder', 40);
      const s = (await t.call('meta')).spawn;
      await t.call('teleport', s.x + 50, s.y, s.z);
      await t.call('runTicks', 20);
      const p = await t.call('pos');
      t.note('pushed', p.x - (s.x + 50));
      t.assert(p.x < s.x + 50 - 1.5 && p.x > s.x + 50 - 2.5, `pushed back about 0.1 b/t toward spawn (x ${p.x - s.x})`);
      t.assert(Math.abs(p.z - s.z) < 1e-6, 'straight back toward the spawn');
      const fog = await t.eval(() => { const r = window.__game.game.renderer; return 'fogOverride' in r ? r.fogOverride : 'n/a'; });
      t.note('fog', fog);
      if (fog !== 'n/a') t.assert(fog && fog.far < 30, `thick fog at the border (${JSON.stringify(fog)})`);
      const kb = await t.eval(() => window.__game.game.kid.border);
      t.assert(kb.fogT === 1 && kb.over > 0, 'border state');
      await t.call('teleport', s.x + 2, s.y, s.z);
      await t.call('runTicks', 2);
      const fog2 = await t.eval(() => { const r = window.__game.game.renderer; return 'fogOverride' in r ? r.fogOverride : 'n/a'; });
      if (fog2 !== 'n/a') t.assert(fog2 === null, 'fog override cleared inside the border');
      await t.call('setRule', 'worldBorder', 512);
    },
  },
  {
    name: 'kid-stuck',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('setFlying', false);
      const p0 = await t.call('pos');
      const bx = Math.floor(p0.x) + 8, bz = Math.floor(p0.z) + 8;
      // a pit: stone ring at head-level around the cell (flat ground top = 4)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { await t.call('setBlock', bx + dx, 4, bz + dz, 'stone'); await t.call('setBlock', bx + dx, 5, bz + dz, 'stone'); }
      await t.call('teleport', bx + 0.5, 4, bz + 0.5);
      await t.eval(() => window.__game.game.input.setMoveVector(1, 0));
      await t.call('runTicks', 30);
      t.assert(!(await t.eval(() => window.__game.game.kid.stuck.stuck)), 'not stuck after 1.5 s');
      await t.call('runTicks', 35);
      t.assert(await t.eval(() => window.__game.game.kid.stuck.stuck), 'stuck after 3 s of pushing without moving');
      const ev = await t.call('events', 'kid:stuck', 1);
      t.assert(ev.length && ev[0].payload.stuck === true, 'kid:stuck {stuck: true}');
      t.assert(await t.eval(() => window.__game.game.kid.hintShown) === 'unstuck', 'unstuck pictogram shown');
      await t.call('waitFrames', 30);
      await t.shot('kid-stuck');
      await t.eval(() => window.__game.game.input.setMoveVector(0, 0));
      await t.eval(() => window.__game.game.input.setVirtual('jump', true));
      await t.call('runTicks', 21);
      await t.eval(() => window.__game.game.input.setVirtual('jump', false));
      const p = await t.call('pos');
      t.note('popped', p);
      t.assert(p.y >= 6 - 1e-6, `holding jump 1 s pops out onto the rim (y ${p.y})`);
      t.assert(!(await t.eval(() => window.__game.game.kid.stuck.stuck)), 'no longer stuck');
      t.assert((await t.call('events', 'kid:rescue', 1))[0].payload.reason === 'stuck', 'kid:rescue {reason: stuck}');
      // head inside a block pops on its own after 2 s
      await t.call('teleport', p0.x, 4, p0.z);
      await t.call('setBlock', Math.floor(p0.x), 5, Math.floor(p0.z), 'sand');
      await t.call('runTicks', 45);
      const q = await t.call('pos');
      t.assert(q.y >= 6 - 1e-6, `head-in-block auto pop (y ${q.y})`);
    },
  },
  {
    name: 'kid-hints',
    requires: [],
    async run(t) {
      await t.call('setSetting', 'hints', true);
      await t.call('startWorld', FLAT);
      // earlier scenarios may already have used up / completed hints this session: start a fresh plan
      await t.eval(() => { const h = window.__game.game.kid.hints; Object.assign(h, new h.constructor()); });
      await t.call('runTicks', 150);
      t.assert(await t.eval(() => window.__game.game.kid.hintShown) === 'walk', 'after 7 s idle the walk pictogram shows');
      const h = await t.call('events', 'hint', 1);
      t.assert(h.length && h[0].payload.name === 'walk', 'hint {name: walk}');
      await t.call('waitFrames', 40);
      await t.shot('kid-hint-walk-live');
      await t.eval(() => window.__game.game.input.setMoveVector(1, 0));
      await t.call('runTicks', 8);
      await t.eval(() => window.__game.game.input.setMoveVector(0, 0));
      t.assert(await t.eval(() => window.__game.game.kid.hintShown) === null, 'walking hides the hint');
      t.assert((await t.call('events', 'sound', 5)).some((e) => e.payload.name === 'ui.success'), 'success chime');
      // every pictogram, both variants, for the screenshot review (scheduler paused so it cannot swap them)
      await t.call('setSetting', 'hints', false);
      await t.call('waitTicks', 1);
      for (const v of ['keys', 'touch']) {
        for (const n of ['walk', 'turn', 'place', 'break', 'pick', 'fly', 'unstuck']) {
          await t.eval(([n, v]) => window.__game.game.kid.showHint(n, v), [n, v]);
          await t.call('sleep', 650);
          const r = await rectOf(t, '[data-kid="hint"]');
          t.assert(r.visible && r.w >= 300, `${n}/${v} visible`);
          await t.page.screenshot({ path: join(TMP, `smoke-kid-hint-${n}-${v}.png`), clip: { x: r.x - 8, y: r.y - 8, width: r.w + 16, height: r.h + 16 } });
        }
      }
      await t.eval(() => window.__game.game.kid.hideHint());
      // hints off: nothing shows
      await t.call('setSetting', 'hints', false);
      await t.call('runTicks', 300);
      t.assert(await t.eval(() => window.__game.game.kid.hintShown) === null, 'hints setting off');
      await t.call('setSetting', 'hints', true);
    },
  },
  {
    name: 'kid-speech',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('setSetting', 'speakNames', true);
      await t.call('selectSlot', 3);
      await t.call('sleep', 400);
      const last = await t.eval(() => window.__game.game.kid.speech.last);
      const name = await t.eval(() => { const g = window.__game.game; const s = g.inventory.getSelected(); return s ? s.item : null; });
      t.note('speech', last);
      t.assert(last && typeof last.text === 'string' && last.text.length > 0, `a name was requested (${JSON.stringify(last)})`);
      t.assert(last.text.toLowerCase().replace(/ /g, '_').includes(String(name).split('_')[0]), `speaks the selected item (${last.text} / ${name})`);
      t.note('localVoice', last.voice);
      await t.call('setSetting', 'speakNames', false);
      const c = await t.eval(() => window.__game.game.kid.speech.count);
      await t.call('selectSlot', 4);
      await t.call('sleep', 400);
      t.assert(await t.eval(() => window.__game.game.kid.speech.count) === c, 'speakNames off: silent');
    },
  },
  {
    name: 'kid-home-arrow',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const s = (await t.call('meta')).spawn;
      await t.call('teleport', s.x + 30, s.y, s.z);
      await t.call('waitFrames', 3);
      t.assert(!(await t.eval(() => window.__game.game.kid.homeArrow.visible)), 'no arrow within 48 blocks');
      await t.call('teleport', s.x + 60, s.y, s.z);
      await t.call('setLook', 0, 0);
      await t.call('waitFrames', 3);
      let a = await t.eval(() => ({ ...window.__game.game.kid.homeArrow }));
      t.assert(a.visible, 'arrow beyond 48 blocks');
      t.assert(Math.abs(a.deg + 90) < 2, `home to the west while facing north -> arrow points left (${a.deg})`);
      await t.call('setLook', 90, 0);
      await t.call('waitFrames', 3);
      a = await t.eval(() => ({ ...window.__game.game.kid.homeArrow }));
      t.assert(Math.abs(a.deg) < 2, `facing west -> arrow points ahead (${a.deg})`);
      await t.call('setLook', 0, 0);
      await t.call('waitFrames', 5);
      await t.shot('kid-home-arrow');
      const r = await rectOf(t, '[data-kid="home-arrow"]');
      t.assert(r.visible && r.y >= 16 && r.w >= 80, `arrow plate on screen (${JSON.stringify(r)})`);
    },
  },
  {
    name: 'kid-guards',
    requires: [],
    async run(t) {
      if (await t.call('state') !== 'title') await t.call('exitToTitle');
      await t.call('waitFrames', 2);
      // Play with a real click (user activation -> fullscreen + keyboard lock)
      const play = await rectOf(t, '[data-action="play"]');
      t.assert(play && play.visible, 'Play button');
      await t.page.mouse.click(play.x + play.w / 2, play.y + play.h / 2);
      t.assert(await t.waitFor(() => window.__game.worldReady, null, 10000), 'world started from Play');
      const fs = await t.eval(() => !!document.fullscreenElement);
      t.note('fullscreen', fs);
      // blocked keys during play
      const blocked = await t.eval(() => {
        const send = (init) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); window.dispatchEvent(e); return e.defaultPrevented; };
        return {
          f5: send({ code: 'F5', key: 'F5' }), ctrlR: send({ code: 'KeyR', key: 'r', ctrlKey: true }), zoom: send({ code: 'Equal', key: '=', ctrlKey: true }),
          altLeft: send({ code: 'ArrowLeft', key: 'ArrowLeft', altKey: true }), f1: send({ code: 'F1', key: 'F1' }),
          w: send({ code: 'KeyW', key: 'w' }),
        };
      });
      t.note('blocked', blocked);
      t.assert(blocked.f5 && blocked.ctrlR && blocked.zoom && blocked.altLeft && blocked.f1, `reload/zoom/back keys blocked (${JSON.stringify(blocked)})`);
      // history entry so a back swipe lands in the game
      t.assert(await t.eval(() => !!(history.state && history.state.bc === 1)), 'history.pushState({bc: 1})');
      // beforeunload asks after the first interaction
      const bu = await t.eval(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
      t.assert(bu, 'beforeunload is guarded while a world is open');
      if (fs) {
        await t.eval(() => document.exitFullscreen());
        t.assert(await t.waitFor(() => { const e = document.querySelector('[data-kid="guard"]'); return e && !e.classList.contains('bc-hidden'); }, null, 3000), 'keep-playing overlay after leaving fullscreen');
        await t.shot('kid-keep-playing');
        const kp = await rectOf(t, '[data-kid="keep-playing"]');
        t.assert(kp.w >= 200 && kp.h >= 120, `keep-playing button is huge (${kp.w}x${kp.h})`);
        await t.page.mouse.click(kp.x + kp.w / 2, kp.y + kp.h / 2);
        t.assert(await t.waitFor(() => !!document.fullscreenElement, null, 3000), '▶ re-enters fullscreen');
        t.assert(!(await t.eval(() => window.__game.game.kid.guards.overlayVisible)), 'overlay hidden again');
        // a grown-up can stay in a window
        await t.eval(() => document.exitFullscreen());
        await t.waitFor(() => window.__game.game.kid.guards.overlayVisible, null, 3000);
        const sw = await rectOf(t, '[data-kid="stay-windowed"]');
        t.assert(sw.w >= 48 && sw.h >= 48, 'stay-windowed button >= 48 px');
        await t.page.mouse.click(sw.x + sw.w / 2, sw.y + sw.h / 2);
        t.assert(!(await t.eval(() => window.__game.game.kid.guards.overlayVisible)), 'stay windowed hides the overlay');
      } else t.log('fullscreen not granted headless: overlay path not exercised (SPEC D8)');
      await t.call('exitToTitle');
      const bu2 = await t.eval(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
      t.assert(!bu2, 'no unload prompt on the title screen');
      const f5t = await t.eval(() => { const e = new KeyboardEvent('keydown', { code: 'F5', bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
      t.assert(!f5t, 'F5 is not blocked on the title screen');
    },
  },
  {
    name: 'kid-touch-overlay',
    requires: [],
    touchOnly: true,
    async run(t) {
      await t.call('setSetting', 'touchControls', 'auto');
      await t.call('startWorld', FLAT);
      await t.page.mouse.click(640, 360);
      await t.call('waitFrames', 3);
      t.assert(!(await t.eval(() => window.__game.game.touch.visible)), 'hidden after a mouse click (auto)');
      await t.page.touchscreen.tap(640, 300);
      await t.call('waitFrames', 3);
      t.assert(await t.eval(() => window.__game.game.touch.visible), 'shown after a touch (auto)');
      // sizes and margins
      const names = ['forward', 'back', 'turnLeft', 'turnRight', 'jump', 'fly', 'pause'];
      const rects = {};
      for (const n of names) rects[n] = await rectOf(t, `[data-touch="${n}"]`);
      t.note('rects', rects);
      for (const n of names) {
        const r = rects[n];
        t.assert(r && r.visible && r.w >= 80 && r.h >= 80, `${n} >= 80 px (${JSON.stringify(r)})`);
        t.assert(r.x >= 24 && r.y >= 24 && r.x + r.w <= 1280 - 24 && r.y + r.h <= 720 - 24, `${n} 24 px from the edges`);
      }
      t.assert(rects.jump.w === 112, `jump is 112 px at size M (${rects.jump.w})`);
      t.assert(!(await rectOf(t, '[data-touch="down"]')).visible, 'Down hidden while walking');
      await t.shot('kid-touch');
      // D-pad: hold forward, slide to turn left, second finger on jump (multi-touch), release
      const pad = await touchPad(t);
      const [fx, fy] = centre(rects.forward);
      await pad.down(1, fx, fy);
      await t.call('waitFrames', 1);
      t.assert(await isDown(t, 'forward'), 'D-pad ▲ holds forward');
      const [lx, ly] = centre(rects.turnLeft);
      await pad.move(1, lx, ly);
      await t.call('waitFrames', 1);
      t.assert(await isDown(t, 'turnLeft') && !(await isDown(t, 'forward')), 'sliding to ◀ turns instead');
      const [jx, jy] = centre(rects.jump);
      await pad.down(2, jx, jy);
      await t.call('waitFrames', 1);
      t.assert((await held(t)).join(',') === 'jump,turnLeft', `two fingers: turn + jump (${await held(t)})`);
      await t.shot('kid-touch-pressed');
      await pad.up(2);
      await pad.up(1);
      await t.call('waitFrames', 1);
      t.assert((await held(t)).length === 0 && !(await isDown(t, 'jump')) && !(await isDown(t, 'turnLeft')), 'all released');
      // palm-sized contact is ignored
      await pad.down(3, jx, jy, 30);
      await t.call('waitFrames', 1);
      t.assert(!(await isDown(t, 'jump')), 'palm ignored');
      await pad.up(3);
      // fly toggle, pause
      const fly0 = await t.call('eventCount', 'input:action');
      const [flx, fly] = centre(rects.fly);
      await pad.down(4, flx, fly); await pad.up(4);
      await t.call('waitFrames', 2);
      const acts = await t.call('events', 'input:action', 6);
      t.assert(acts.some((a) => a.payload.action === 'toggleFly' && a.payload.down), `fly button presses toggleFly (${fly0})`);
      await t.call('setFlying', true);
      await t.call('waitFrames', 2);
      const down = await rectOf(t, '[data-touch="down"]');
      t.assert(down.visible && down.w >= 96, `Down ▼ shown while flying (${JSON.stringify(down)})`);
      const [dx, dy] = centre(down);
      await pad.down(5, dx, dy);
      await t.call('waitFrames', 1);
      t.assert(await isDown(t, 'descend'), 'Down holds descend');
      await pad.up(5);
      await t.shot('kid-touch-flying');
      await t.call('setFlying', false);
      // stuck pulse on the Up button
      await t.eval(() => window.__game.game.events.emit('kid:stuck', { stuck: true, reason: 'test' }));
      t.assert(await t.eval(() => document.querySelector('[data-touch="jump"]').classList.contains('touch-pulse')), 'Up pulses while stuck');
      await t.eval(() => window.__game.game.events.emit('kid:stuck', { stuck: false }));
      const [px, py] = centre(rects.pause);
      await pad.down(6, px, py); await pad.up(6);
      await t.call('waitFrames', 2);
      t.assert(await t.call('uiOpen') === 'pause', 'pause button opens pause');
      t.assert(!(await t.eval(() => window.__game.game.touch.visible)), 'overlay hides under screens');
      await t.call('closeUI');
      await t.call('waitFrames', 2);
      // left-handed mirror and big buttons
      await t.call('setSetting', 'leftHanded', true);
      await t.call('setSetting', 'buttonSize', 'L');
      await t.call('waitFrames', 2);
      const jL = await rectOf(t, '[data-touch="jump"]'), fL = await rectOf(t, '[data-touch="forward"]');
      t.assert(jL.x < 640 && fL.x > 640, 'left-handed: jump left, D-pad right');
      t.assert(jL.w === 128, `size L jump 128 px (${jL.w})`);
      await t.shot('kid-touch-lefthanded');
      await t.call('setSetting', 'leftHanded', false);
      await t.call('setSetting', 'buttonSize', 'M');
      // joystick style
      await t.eval(() => window.__game.game.touch.setStyle('joystick'));
      await t.call('waitFrames', 2);
      const joy = await rectOf(t, '[data-touch="joystick"]');
      t.assert(joy.visible && joy.w === 160, 'joystick 160 px base');
      const [jcx, jcy] = centre(joy);
      await pad.down(7, jcx, jcy);
      await pad.move(7, jcx, jcy - 80);
      await t.call('waitFrames', 1);
      const vm = await t.eval(() => ({ ...window.__game.game.input.virtualMove }));
      t.assert(vm.forward > 0.9, `joystick up = forward (${JSON.stringify(vm)})`);
      await t.shot('kid-touch-joystick');
      await pad.up(7);
      await t.call('waitFrames', 1);
      t.assert((await t.eval(() => window.__game.game.input.virtualMove.forward)) === 0, 'joystick released');
      await t.eval(() => window.__game.game.touch.setStyle('dpad'));
      // settings: off never shows, on always shows
      await t.call('setSetting', 'touchControls', 'off');
      await t.page.touchscreen.tap(640, 300);
      await t.call('waitFrames', 2);
      t.assert(!(await t.eval(() => window.__game.game.touch.visible)), 'touchControls off');
      await t.call('setSetting', 'touchControls', 'on');
      await t.page.mouse.click(640, 360);
      await t.call('waitFrames', 2);
      t.assert(await t.eval(() => window.__game.game.touch.visible), 'touchControls on');
      await t.call('setSetting', 'touchControls', 'auto');
      await pad.end();
    },
  },
  {
    // Real core: a touch on the canvas switches input.lastPointerType and the world gestures still work under
    // the overlay (tap places, drag on the right side looks).
    name: 'kid-touch-world',
    requires: ['input', 'player', 'physics', 'raycast', 'interaction', 'world'],
    touchOnly: true,
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('setFlying', false);
      await t.call('waitTicks', 10);
      await t.page.touchscreen.tap(900, 300);
      await t.call('waitFrames', 3);
      t.assert(await t.eval(() => window.__game.game.input.lastPointerType) === 'touch', 'input saw the touch');
      t.assert(await t.eval(() => window.__game.game.touch.visible), 'overlay visible');
      const pad = await touchPad(t);
      const yaw0 = (await t.call('pos')).yaw;
      await pad.down(1, 900, 400);
      for (let i = 1; i <= 10; i++) await pad.move(1, 900 - i * 12, 400);
      await pad.up(1);
      await t.call('waitFrames', 3);
      t.assert(Math.abs((await t.call('pos')).yaw - yaw0) > 5, 'drag on the right side looks');
      // ▲ walks (finger held 0.6 s)
      const f = await rectOf(t, '[data-touch="forward"]');
      const a0 = await t.call('pos');
      await pad.down(2, ...centre(f));
      await t.call('sleep', 600);
      await pad.up(2);
      const a1 = await t.call('pos');
      const walked = Math.hypot(a1.x - a0.x, a1.z - a0.z);
      t.note('dpadWalk', walked);
      t.assert(walked > 1, `D-pad ▲ walks the player (${walked.toFixed(2)} blocks)`);
      // ◀ turns left (+yaw), ▶ turns right
      const l = await rectOf(t, '[data-touch="turnLeft"]');
      const y0 = (await t.call('pos')).yaw;
      await pad.down(3, ...centre(l));
      await t.call('sleep', 500);
      await pad.up(3);
      await t.call('waitFrames', 2);
      const y1 = (await t.call('pos')).yaw;
      t.note('dpadTurnDeg', y1 - y0);
      t.assert(y1 - y0 > 15, `D-pad ◀ turns left (${(y1 - y0).toFixed(1)} deg)`);
      const r = await rectOf(t, '[data-touch="turnRight"]');
      await pad.down(4, ...centre(r));
      await t.call('sleep', 500);
      await pad.up(4);
      await t.call('waitFrames', 2);
      const y2 = (await t.call('pos')).yaw;
      t.assert(y2 < y1 - 15, `D-pad ▶ turns right (${(y2 - y1).toFixed(1)} deg)`);
      // slide the finger from ▲ onto ◀ without lifting: walking becomes turning
      await pad.down(5, ...centre(f));
      await t.call('sleep', 200);
      t.assert((await held(t)).includes('forward'), 'slide start holds forward');
      await pad.move(5, ...centre(l));
      await t.call('sleep', 100);
      const h2 = await held(t);
      t.assert(h2.includes('turnLeft') && !h2.includes('forward'), `slide onto ◀ swaps to turning (${h2})`);
      await pad.up(5);
      // Jump button: a real jump
      const j = await rectOf(t, '[data-touch="jump"]');
      await pad.down(6, ...centre(j));
      let maxY = (await t.call('pos')).y;
      const yStart = maxY;
      for (let i = 0; i < 8; i++) { await t.call('sleep', 40); maxY = Math.max(maxY, (await t.call('pos')).y); }
      await pad.up(6);
      t.assert(maxY > yStart + 0.8, `Jump button jumps (rose ${(maxY - yStart).toFixed(2)})`);
      await t.call('waitTicks', 20);
      // Fly button (creative) -> flying; Up rises; Down appears and descends; Fly again lands
      const fl = await rectOf(t, '[data-touch="fly"]');
      t.assert(fl && fl.visible, 'Fly button visible in creative');
      await pad.down(7, ...centre(fl)); await t.call('sleep', 60); await pad.up(7);
      t.assert(await t.waitFor(() => window.__game.game.player.flying, null, 2000), 'Fly button starts flying');
      await t.call('waitFrames', 3);
      const yF0 = (await t.call('pos')).y;
      await pad.down(8, ...centre(j)); await t.call('sleep', 700); await pad.up(8);
      const yF1 = (await t.call('pos')).y;
      t.assert(yF1 > yF0 + 2, `Up rises while flying (${(yF1 - yF0).toFixed(2)})`);
      const dn = await rectOf(t, '[data-touch="down"]');
      t.assert(dn && dn.visible, 'Down button shows while flying');
      await t.shot('kid-touch-world-flying');
      await pad.down(9, ...centre(dn)); await t.call('sleep', 400); await pad.up(9);
      const yF2 = (await t.call('pos')).y;
      t.assert(yF2 < yF1 - 1, `Down descends (${(yF2 - yF1).toFixed(2)})`);
      await pad.down(10, ...centre(fl)); await t.call('sleep', 60); await pad.up(10);
      t.assert(await t.waitFor(() => !window.__game.game.player.flying, null, 2000), 'Fly button again stops flying');
      t.assert(await t.waitFor(() => window.__game.game.player.onGround, null, 4000), 'lands');
      t.assert((await held(t)).length === 0, 'nothing left held');
      // a tap on the world while a D-pad finger is down still places (multi-touch)
      await t.call('setLook', 0, -35);
      await t.call('waitFrames', 3);
      const q = await t.call('pos');
      const bx = Math.floor(q.x), bz = Math.floor(q.z) - 3;
      const placed0 = await t.call('eventCount', 'block:placed');
      const n = px(await t.call('worldToNdc', bx + 0.5, 4, bz + 0.5));
      await t.page.touchscreen.tap(n.x, n.y);
      await t.call('waitTicks', 3);
      t.assert(await t.call('eventCount', 'block:placed') > placed0, 'tap on the world through the overlay places a block');
      await t.shot('kid-touch-world');
      await pad.end();
    },
  },
];
