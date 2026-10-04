// OWNER: LEAD. Example / integration scenarios. Each lane creates tools/scenarios/<lane>.mjs in the same shape.
// A scenario: { name: 'lane-thing', requires: ['stubName', ...], touchOnly?: true, async run(t) { ... } }
// t.call('<__game method>', ...args)  t.eval(fn, arg)  t.waitFor(fn, arg, ms)  t.assert(cond, msg)  t.shot('name')
// t.note(k, v)  t.pending('reason')  t.log(msg)  t.page (Playwright Page)  t.stubs (string[])  t.args (CLI flags)
// Start your own world in every scenario (the harness returns to the title screen between scenarios).
//
// These scenarios pin cross-lane CONTRACTS (SPEC §5.3, §6, §7.4, §8.1, §11). They run against the stubs today
// and must keep passing when the real lanes land.

const FLAT = { preset: 'flat', seed: 3, mode: 'creative', difficulty: 'peaceful' };

/** Persist dirty columns: the real save lane when live, otherwise the same world calls saveNow() makes. */
async function saveNow(t) {
  if (!t.stubs.includes('save')) return t.call('save');
  return t.eval(() => {
    const w = window.__game.game.world;
    for (const [cx, cz] of w.getDirtyColumns()) { w.exportColumn(cx, cz); w.markColumnSaved(cx, cz); }
    for (const key of [...w.pendingSave.keys()]) { const [cx, cz] = key.split(',').map(Number); w.exportColumn(cx, cz); w.markColumnSaved(cx, cz); }
    return true;
  });
}

/** Teleport far away (20 columns), wait until column (cx,cz) unloads, come back, wait until it is lit again. */
async function awayAndBack(t, home, cx, cz) {
  await t.call('teleport', home.x + 320, home.y, home.z);
  const gone = await t.waitFor(([cx, cz]) => !window.__game.game.world.getColumn(cx, cz), [cx, cz], 10000);
  t.assert(gone, `column ${cx},${cz} unloads after teleporting 20 columns away`);
  const away = await t.eval(([cx, cz]) => {
    const w = window.__game.game.world;
    return { saved: w.savedColumns.has(cx + ',' + cz), pending: w.pendingSave.has(cx + ',' + cz) };
  }, [cx, cz]);
  await t.call('teleport', home.x, home.y, home.z);
  const back = await t.waitFor(([cx, cz]) => window.__game.game.world.isColumnLoaded(cx, cz), [cx, cz], 10000);
  t.assert(back, `column ${cx},${cz} loads again after returning`);
  return away;
}

/** Real mouse tap (kid scheme) on a world point. */
async function tapWorld(t, x, y, z, ms = 80) {
  const n = await t.call('worldToNdc', x, y, z);
  const vp = t.page.viewportSize();
  await t.page.mouse.move(Math.round((n.x + 1) / 2 * vp.width), Math.round((1 - n.y) / 2 * vp.height));
  await t.call('waitFrames', 2);
  await t.page.mouse.down();
  await new Promise((r) => setTimeout(r, ms));
  await t.page.mouse.up();
  await t.call('waitTicks', 3);
}

export default [
  {
    name: 'lead-events-roundtrip',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const ok = await t.call('setBlock', 2, 4, 2, 'stone');
      t.assert(ok, 'setBlock on a loaded column succeeds');
      t.assert(await t.call('getBlock', 2, 4, 2) === 'stone', 'getBlock reads it back');
      const ev = await t.call('events', 'block:changed', 1);
      t.assert(ev.length === 1 && ev[0].payload.id === await t.call('blockId', 'stone') && ev[0].payload.cause === 'test', 'block:changed payload');
      t.assert('action' in ev[0].payload, 'block:changed carries an action id');
    },
  },
  {
    // Critique blocker 2: edit -> save -> unload -> reload must keep the edit (and a later save must not
    // overwrite it with regenerated terrain).
    name: 'lead-unload-persist',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const home = await t.call('pos');
      const bx = Math.floor(home.x) + 2, bz = Math.floor(home.z) + 2;
      const cx = bx >> 4, cz = bz >> 4;
      t.assert(await t.call('setBlock', bx, 4, bz, 'gold_block'), 'block set');
      await saveNow(t);
      const away1 = await awayAndBack(t, home, cx, cz);
      t.note('away1', away1);
      t.assert(away1.saved && !away1.pending, 'saved column is kept in world.savedColumns while unloaded');
      t.assert(await t.call('getBlock', bx, 4, bz) === 'gold_block', 'edit survives unload -> reload after a save');
      // second cycle: a save after the reload, then unload again - still there
      await saveNow(t);
      await awayAndBack(t, home, cx, cz);
      t.assert(await t.call('getBlock', bx, 4, bz) === 'gold_block', 'edit survives a second save + unload cycle');
      // unsaved edit: goes to pendingSave AND savedColumns, restored as still-dirty
      t.assert(await t.call('setBlock', bx, 4, bz, 'diamond_block'), 'second edit');
      const away2 = await awayAndBack(t, home, cx, cz);
      t.assert(away2.saved && away2.pending, 'unsaved column is in pendingSave and savedColumns while unloaded');
      t.assert(await t.call('getBlock', bx, 4, bz) === 'diamond_block', 'unsaved edit survives unload -> reload');
      const dirty = await t.eval(([cx, cz]) => window.__game.game.world.getDirtyColumns().some(([a, b]) => a === cx && b === cz), [cx, cz]);
      t.assert(dirty, 'a column restored from pendingSave is still dirty (the next save writes it)');
    },
  },
  {
    // Critique blocker 3 + majors 4/6/20: block entity in the payload, action ids, bedrock rule.
    name: 'lead-break-contract',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const p = await t.call('pos');
      const x = Math.floor(p.x) + 2, z = Math.floor(p.z) + 2;
      t.assert(await t.call('setBlock', x, 4, z, 'chest'), 'chest placed');
      const r = await t.eval(({ x, z }) => {
        const g = window.__game.game;
        g.world.setBlockEntity(x, 4, z, { type: 'chest', items: [{ item: 'diamond', count: 3 }] });
        const ok = g.interaction.breakBlock(x, 4, z, { by: 'test' });
        const br = g.events.recent('block:broken', 1)[0].payload;
        const ch = g.events.recent('block:changed', 1)[0].payload;
        return { ok, items: br.blockEntity && br.blockEntity.items, action: br.action, chAction: ch.action, left: g.world.getBlockEntity(x, 4, z) };
      }, { x, z });
      t.note('break', r);
      t.assert(r.ok, 'breakBlock succeeded');
      t.assert(r.items && r.items[0].item === 'diamond', 'block:broken carries the chest contents (blockEntity)');
      t.assert(r.action > 0 && r.action === r.chAction, 'block:broken and block:changed share one action id');
      t.assert(r.left === null, 'block entity removed with the block');
      const placed = await t.eval(({ x, z }) => {
        const g = window.__game.game, ID = window.__game.blockId;
        g.world.setBlock(x, 4, z, ID('short_grass'), 0, { cause: 'test' });
        const ok = g.interaction.placeBlock(x, 4, z, ID('stone'), 0, { by: 'test' });
        return { ok, ev: g.events.recent('block:placed', 1)[0].payload };
      }, { x, z });
      t.assert(placed.ok && placed.ev.oldId === await t.call('blockId', 'short_grass'), 'placing replaces short grass and reports the old block');
      const bedrock = await t.eval(({ x, z }) => {
        const g = window.__game.game, ID = window.__game.blockId;
        g.world.setBlock(x, 5, z, ID('bedrock'), 0, { cause: 'test' });
        const upper = g.interaction.breakBlock(x, 5, z, { by: 'player' });
        const floor = g.interaction.breakBlock(x, 0, z, { by: 'player' });
        return { upper, floor };
      }, { x, z });
      t.assert(bedrock.upper === true, 'creative may break bedrock above y 0');
      t.assert(bedrock.floor === false, 'the y 0 bedrock floor is never removable');
    },
  },
  {
    // Critique major 9: batches emit per-cell events and relight once at endBatch.
    name: 'lead-batch',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const p = await t.call('pos');
      const x = Math.floor(p.x) + 3, z = Math.floor(p.z) + 3;
      const r = await t.eval(({ x, z }) => {
        const g = window.__game.game, w = g.world, stone = window.__game.blockId('stone');
        const before = g.events.counts.get('block:changed') || 0;
        const list = [];
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) list.push([x + dx, 12, z + dz, stone]);
        const n = w.setBlocks(list, { cause: 'test', action: 777 });
        const evs = g.events.recent('block:changed', 9);
        return { n, events: (g.events.counts.get('block:changed') || 0) - before, actions: evs.every((e) => e.payload.action === 777), sky: w.getSkyLight(x, 8, z), inBatch: w.inBatch() };
      }, { x, z });
      t.note('batch', r);
      t.assert(r.n === 9 && r.events === 9, 'one block:changed per cell');
      t.assert(r.actions, 'opts.action is passed through to block:changed');
      t.assert(r.sky === 13, `light is correct after endBatch (3x3 roof: centre is 2 steps from open sky, 15 - 2 = 13; got ${r.sky})`);
      t.assert(r.inBatch === false, 'batch closed');
    },
  },
  {
    // Critique major 8c / minor 29: entities park with their column and come back with reason 'load'.
    name: 'lead-entity-streaming',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const home = await t.call('pos');
      const id = await t.eval(({ x, y, z }) => {
        const g = window.__game.game;
        if (!g.entities.types.has('lead_marker')) {
          g.entities.types.set('lead_marker', { persistent: true, category: 'other', create: (game, x, y, z) => new g.entities.EntityClass('lead_marker', x, y, z) });
        }
        const e = g.entities.spawn('lead_marker', x, y, z);
        return e ? e.id : null;
      }, { x: home.x + 2, y: home.y, z: home.z + 2 });
      t.assert(id !== null, 'marker spawned');
      const cx = Math.floor(home.x + 2) >> 4, cz = Math.floor(home.z + 2) >> 4;
      await t.call('teleport', home.x + 320, home.y, home.z);
      const parked = await t.waitFor(() => !window.__game.game.entities.ofType('lead_marker').length, null, 10000);
      t.assert(parked, 'entity removed from the scene when its column unloads');
      const saved = await t.eval(() => window.__game.game.entities.serialize().list.some((d) => d.type === 'lead_marker'));
      t.assert(saved, 'parked entity is still part of the world save');
      await t.call('teleport', home.x, home.y, home.z);
      const back = await t.waitFor(() => window.__game.game.entities.ofType('lead_marker').length === 1, null, 10000);
      t.assert(back, `entity restored when column ${cx},${cz} loads again`);
      const ev = await t.call('events', 'entity:spawn', 1);
      t.assert(ev[0] && ev[0].payload.reason === 'load', 'restore emits entity:spawn with reason load');
    },
  },
  {
    // Critique major 10: test API members exist and behave with stubs.
    name: 'lead-testapi',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const t0 = (await t.call('stats')).ticks;
      const t1 = await t.call('runTicks', 40);
      t.assert(t1 >= t0 + 40, `runTicks advances 40 ticks (${t0} -> ${t1})`);
      // seed + draws in ONE evaluation: a tick or frame between two calls may draw game.rand() (mobs, mechanics)
      const draw = () => t.eval(() => { window.__game.setRandomSeed(7); return [0, 1, 2].map(() => window.__game.game.rand()); });
      const a = await draw();
      await t.call('runTicks', 5);
      const b = await draw();
      t.assert(JSON.stringify(a) === JSON.stringify(b), 'setRandomSeed makes game.rand reproducible');
      const p = await t.call('pos');
      for (const k of ['vx', 'vy', 'vz', 'sneaking', 'sprinting', 'eyeInWater', 'inLava', 'onLadder', 'air', 'fallDistance', 'view']) t.assert(k in p, `pos() has ${k}`);
      const eyeY = p.y + 1.62;
      const look = await t.call('lookAt', p.x, eyeY + 5, p.z - 5);
      t.assert(Math.abs(look.pitch - 45) < 0.5 && Math.abs(look.yaw) < 0.5, `lookAt points the view (${JSON.stringify(look)})`);
      const n = await t.call('worldToNdc', p.x, eyeY + 5, p.z - 5);
      t.assert(Math.abs(n.x) < 0.02 && Math.abs(n.y) < 0.02 && n.onScreen, `looked-at point projects to the centre (${JSON.stringify(n)})`);
      const right = await t.call('worldToNdc', p.x + 1, eyeY + 5, p.z - 5);
      t.assert(right.x > 0.05, 'a point to the right projects right of centre');
      const rec = await t.call('recordTicks', 5, { sync: true });
      t.assert(rec.length === 5 && rec[4].tick === rec[0].tick + 4, 'recordTicks sync gives consecutive ticks');
      const live = await t.call('recordTicks', 3);
      t.assert(live.length === 3, 'recordTicks in real time');
      t.assert(await t.call('waitFor', 'api.state() === "playing"', 1000), 'waitFor (string, via the harness) sees a true predicate');
      t.assert(!(await t.call('waitFor', 'game.tickCount < 0', 200)), 'waitFor times out on a false predicate');
      const inPage = await t.eval(() => window.__game.waitFor(() => window.__game.state() === 'playing', 500));
      t.assert(inPage, 'waitFor with a function works in the page');
      const as = await t.call('audioStats');
      t.assert(typeof as.voices === 'number' && as.byName, 'audioStats shape');
      const tap = await t.call('tapAt', 0, 0);
      t.assert(tap === null || typeof tap === 'object', 'tapAt runs');
    },
  },
  {
    // Integration (cross-lane defect, MOBS -> CORE-E): in the kid scheme a hold that started on an animal must
    // never turn into digging after the animal hops away (kid creative breaks blocks instantly).
    name: 'lead-kid-hold-entity', requires: ['mobs', 'interaction', 'input', 'player'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, rules: { passiveMobs: false } });
      await t.call('setFlying', false);
      await t.call('waitTicks', 5);
      const p = await t.call('pos');
      const id = await t.eval(({ x, y, z }) => window.__game.game.mobs.spawnMob('pig', x, y, z - 2.5).id, p);
      await t.call('waitTicks', 3);
      const pig = (await t.call('entities')).find((e) => e.id === id);
      await t.call('lookAt', pig.x, pig.y + 0.4, pig.z);
      t.assert(await t.eval((id) => { const te = window.__game.game.interaction.targetEntity; return !!(te && te.entity && te.entity.id === id); }, id), 'the pig is targeted');
      const broken0 = await t.call('eventCount', 'block:broken');
      // hold (as a long kid press does), then the pig is gone from under the cursor while the hold continues
      await t.eval(() => window.__game.game.input.setVirtual('attack', true));
      await t.call('waitTicks', 3);
      await t.eval((id) => { const e = window.__game.game.entities.get(id); window.__game.game.entities.remove(e, 'test'); }, id);
      await t.call('waitTicks', 30);
      const tg = await t.call('target');
      t.assert(tg && tg.name === 'grass_block', `the grass behind is targeted now (${JSON.stringify(tg)})`);
      t.assert(await t.call('eventCount', 'block:broken') === broken0, 'the hold that hit the pig dug nothing');
      await t.eval(() => window.__game.game.input.setVirtual('attack', false));
      await t.call('waitTicks', 2);
      // a NEW hold on the block still breaks it
      await t.eval(() => window.__game.game.input.setVirtual('attack', true));
      await t.call('waitTicks', 3);
      await t.eval(() => window.__game.game.input.setVirtual('attack', false));
      t.assert(await t.call('eventCount', 'block:broken') > broken0, 'a new hold on the block breaks it');
    },
  },
  {
    // Integration (cross-lane defect, KID -> FX/CORE-D): with the eye inside an opaque block the screen shows that
    // block's texture instead of seeing through the world.
    name: 'lead-head-in-block', requires: ['fx', 'renderer', 'player'],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('setFlying', true);
      const p = await t.call('pos');
      const x = Math.floor(p.x) + 3, z = Math.floor(p.z) + 3;
      for (let y = 4; y <= 7; y++) await t.call('setBlock', x, y, z, 'sand');
      await t.call('teleport', x + 0.5, 5, z + 0.5);   // eye at 6.62, inside the sand
      await t.call('setLook', 0, 0);
      await t.call('waitFrames', 4);
      const s = await t.eval(() => window.__game.game.fx.stats());
      t.assert(s.inBlock, 'the in-block overlay is on');
      const shown = await t.eval(() => { const e = document.querySelector('#fx-layer .fx-inblock'); return { on: e.classList.contains('on'), bg: getComputedStyle(e).backgroundImage.slice(0, 30), op: getComputedStyle(e).opacity }; });
      t.note('overlay', shown);
      t.assert(shown.on && shown.bg.startsWith('url(') && shown.op === '1', 'the sand texture fills the screen');
      await t.shot('lead-head-in-block');
      await t.call('teleport', x + 0.5, 9, z + 0.5);
      await t.call('waitFrames', 4);
      t.assert(!(await t.eval(() => window.__game.game.fx.stats().inBlock)), 'the overlay goes away when the head is out');
    },
  },
  {
    // Integration (MENUS suggestion): behind the pause screen the frozen world is drawn twice and then not again
    // until something visible changes (resize, settings); the picture behind the menu stays.
    name: 'lead-pause-no-redraw', requires: ['renderer', 'menus'],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('waitFrames', 5);
      const skips = () => t.eval(() => window.__game.game.renderer.getStats().frozenSkips);
      const s0 = await skips();
      await t.call('waitFrames', 10);
      t.assert(await skips() === s0, 'playing: every frame is drawn');
      await t.call('openScreen', 'pause');
      // the world keeps streaming in behind the menu (each new mesh is drawn); once it is complete frames skip
      const quiet = await t.call('waitFor', 'game.world.unmeshedWithin(game.world.renderDistance) === 0', 15000);
      t.assert(quiet, 'world streamed in');
      let s1 = await skips();
      for (let i = 0; i < 20 && (await t.eval(() => { const a = window.__game.game.renderer.getStats().frozenSkips; return window.__game.waitFrames(20).then(() => window.__game.game.renderer.getStats().frozenSkips - a); })) < 15; i++) s1 = await skips();
      const before = await skips();
      await t.call('waitFrames', 20);
      s1 = await skips();
      t.assert(s1 - before >= 15, `paused: frames skip the world (${s1 - before} of 20)`);
      await t.shot('lead-pause-frozen');
      // (the drawing buffer is not preserved, so the page cannot read the frozen picture back; the screenshot above
      // shows the last frame staying behind the menu)
      // a resize while paused draws again
      const fr = () => t.eval(() => ({ f: window.__game.game.frameCount, s: window.__game.game.renderer.getStats().frozenSkips }));
      const a = await fr();
      await t.page.setViewportSize({ width: 1200, height: 700 });
      await t.call('waitFrames', 6);
      const b = await fr();
      t.note('resize', { frames: b.f - a.f, skipped: b.s - a.s });
      t.assert(b.s - a.s <= b.f - a.f - 2, `a resize redraws (${b.s - a.s} skipped of ${b.f - a.f} frames)`);
      await t.page.setViewportSize({ width: 1280, height: 720 });
      await t.call('closeUI');
      const s3 = await skips();
      await t.call('waitFrames', 10);
      t.assert(await skips() === s3, 'resumed: every frame is drawn again');
    },
  },
  {
    // Integration (cross-lane defects KID 2, INV 4, MECH 3): a NEW world never inherits the previous world's
    // hotbar selection, kid cursor, health, food, air or XP.
    name: 'lead-new-world-reset', requires: ['survival', 'input', 'hud'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, mode: 'survival', difficulty: 'easy' });
      await t.eval(() => {
        const g = window.__game.game, p = g.player;
        p.health = 3; p.food = 5; p.air = 90; p.xpLevel = 7; p.xpProgress = 0.5;
        g.inventory.selectSlot(6);
        g.input.aim.x = 0.7; g.input.aim.y = -0.4;
      });
      await t.call('startWorld', { ...FLAT, seed: 4, mode: 'survival', difficulty: 'easy' });
      const r = await t.eval(() => { const g = window.__game.game, p = g.player; return { health: p.health, food: p.food, air: p.air, xp: p.xpLevel, prog: p.xpProgress, sel: g.inventory.selected, aim: [g.input.aim.x, g.input.aim.y, g.input.aimActive] }; });
      t.note('fresh', r);
      t.assert(r.health === 20 && r.food === 20 && r.air === 300, `fresh health, food and air (${JSON.stringify(r)})`);
      t.assert(r.xp === 0 && r.prog === 0, 'no XP carried over');
      t.assert(r.sel === 0, 'hotbar back on slot 1');
      t.assert(r.aim[0] === 0 && r.aim[1] === 0 && r.aim[2] === true, 'kid cursor back in the middle');
    },
  },
  {
    // Integration (found in the end-to-end play): a new world has farm animals close to the spawn, inside the kid
    // border, on every preset with grass; a saved world does not get them twice.
    name: 'lead-starter-animals', requires: ['mobs', 'worldgen'],
    async run(t) {
      const out = {};
      for (const [preset, seed] of [['default', 12345], ['default', 8], ['default', 777], ['flat', 1], ['snowy', 5]]) {
        await t.call('startWorld', { preset, seed, mode: 'creative', difficulty: 'peaceful' });
        const r = await t.eval(() => {
          const g = window.__game.game, sp = g.meta.spawn;
          const near = g.entities.all().filter((e) => e.category === 'creature' && Math.hypot(e.x - sp.x, e.z - sp.z) <= 32);
          return { n: near.length, types: [...new Set(near.map((e) => e.type))].sort() };
        });
        out[preset + seed] = r;
        t.assert(r.n >= 6 && r.types.length >= 3, `${preset} ${seed}: animals within 32 blocks of the spawn (${JSON.stringify(r)})`);
      }
      t.note('near', out);
      await t.shot('lead-starter-animals');
    },
  },
  {
    // Integration (found in the end-to-end play): a tap on an animal standing behind a grass tuft or a flower hits
    // the animal, not the plant.
    name: 'lead-entity-through-grass', requires: ['mobs', 'interaction', 'raycast'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, rules: { passiveMobs: false } });
      await t.call('setFlying', false);
      await t.call('waitTicks', 5);
      const p = await t.call('pos');
      const x = Math.floor(p.x), z = Math.floor(p.z);
      await t.call('setBlock', x, 4, z - 2, 'short_grass');
      await t.call('setBlock', x, 4, z - 3, 'poppy');
      const id = await t.eval(({ x, z }) => { const e = window.__game.game.mobs.spawnMob('pig', x + 0.5, 4, z - 3.5); e.tick = function () { this.age++; }; return e.id; }, { x, z });
      await t.call('lookAt', x + 0.5, 4.3, z - 3.4);
      await t.call('waitFrames', 3);
      const r = await t.eval(() => { const g = window.__game.game.interaction; return { ent: g.targetEntity && g.targetEntity.entity.id, block: g.target && g.target.id }; });
      t.note('target', r);
      t.assert(r.ent === id, `the pig behind the grass and the poppy is targeted (${JSON.stringify(r)})`);
      // an animal well behind the grass does not steal a tap meant for the grass cell
      await t.call('setBlock', x, 4, z - 3, 'air');
      await t.eval(({ id, x, z }) => { const e = window.__game.game.entities.get(id); e.x = e.prevX = x + 0.5; e.z = e.prevZ = z - 5.5; }, { id, x, z });
      await t.call('lookAt', x + 0.5, 4.2, z - 1.5);
      await t.call('waitFrames', 3);
      const far = await t.eval(() => { const g = window.__game.game.interaction; return { ent: g.targetEntity && g.targetEntity.entity.id, block: g.target && g.target.id }; });
      t.note('far', far);
      t.assert(!far.ent, `a pig 4 blocks behind the grass is not targeted (${JSON.stringify(far)})`);
      await t.call('lookAt', x + 0.5, 4.3, z - 3.4);
      // a solid block in front still hides it
      await t.call('setBlock', x, 4, z - 2, 'stone');
      await t.call('setBlock', x, 5, z - 2, 'stone');
      await t.call('waitFrames', 3);
      t.assert(!(await t.eval(() => window.__game.game.interaction.targetEntity)), 'a stone wall still hides the pig');
    },
  },
  {
    // Judge FID-7: the bigger building palette - every new block draws, the kid picker offers it, and the new
    // shapes work with real taps (trapdoor, birch door, flower pot, hanging lantern, wall sign).
    name: 'lead-building-palette', requires: ['mechanics', 'interaction', 'renderer', 'invui'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, rules: { passiveMobs: false } });
      await t.call('setFlying', false);
      await t.call('waitTicks', 5);
      const p = await t.call('pos');
      const x0 = Math.floor(p.x), y0 = Math.floor(p.y), z0 = Math.floor(p.z);
      // a showcase: three rows in front of the child (north)
      const row1 = ['stone_slab', 'brick_slab', 'sandstone_slab', 'birch_slab', 'spruce_slab', 'stone_stairs', 'brick_stairs', 'sandstone_stairs', 'stone_brick_stairs', 'birch_stairs', 'spruce_stairs'];
      const row3 = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map((c) => c + '_concrete').concat(['quartz_block', 'prismarine']);
      await t.eval(({ x0, y0, z0, row1, row3 }) => {
        const api = window.__game, w = api.game.world;
        const put = (x, y, z, n, s = 0) => w.setBlock(x, y, z, api.blockId(n), s, { cause: 'test' });
        row1.forEach((n, i) => put(x0 - 5 + i, y0, z0 - 5, n, n.endsWith('_stairs') ? 2 : 0));
        put(x0 - 6, y0, z0 - 5, 'stone_slab', 2);                                   // a double slab
        const r2 = z0 - 7;
        put(x0 - 6, y0, r2, 'birch_door', 2); put(x0 - 6, y0 + 1, r2, 'birch_door', 2 | 8);
        put(x0 - 5, y0, r2, 'spruce_door', 2); put(x0 - 5, y0 + 1, r2, 'spruce_door', 2 | 8);
        put(x0 - 4, y0, r2, 'birch_fence', 2 | 8); put(x0 - 3, y0, r2, 'spruce_fence', 8);
        put(x0 - 2, y0, r2, 'birch_fence_gate', 0); put(x0 - 1, y0, r2, 'spruce_fence_gate', 4);
        put(x0, y0, r2, 'oak_trapdoor', 0); put(x0 + 1, y0, r2, 'birch_trapdoor', 2 | 4); put(x0 + 2, y0, r2, 'spruce_trapdoor', 8);
        put(x0 + 3, y0, r2, 'lantern', 0); put(x0 + 4, y0 + 2, r2, 'oak_planks'); put(x0 + 4, y0 + 1, r2, 'lantern', 1);
        put(x0 + 5, y0, r2, 'flower_pot', 2); put(x0 + 6, y0, r2, 'flower_pot', 9);
        put(x0 + 7, y0, r2, 'oak_sign', 2); put(x0 + 8, y0, r2 - 1, 'stone'); put(x0 + 8, y0, r2, 'oak_sign', 2 | 4);
        row3.forEach((n, i) => put(x0 - 9 + i, y0, z0 - 9, n));
        return true;
      }, { x0, y0, z0, row1, row3 });
      await t.call('setLook', 0, -22);
      await t.call('waitFrames', 20);
      await t.shot('lead-palette-showcase');
      // every new block item has an icon in the atlas (the kid picker pages are pinned by a unit test)
      const tabs = await t.eval(() => [...window.__game.game.icons.index.keys()]);
      for (const k of ['birch_door', 'spruce_trapdoor', 'lantern', 'flower_pot', 'oak_sign', 'red_concrete', 'quartz_block', 'stone_brick_stairs', 'spruce_fence_gate']) {
        t.assert(tabs.includes(k), `${k} has an item icon`);
      }
      // real taps: a trapdoor opens and closes; a birch door opens; a poppy goes into a pot; a lantern hangs
      const tz = z0 - 3;
      await t.call('setBlock', x0, y0, tz, 'oak_trapdoor', 0);
      await t.call('setSlot', 0, 'stone', 64); await t.call('selectSlot', 0);
      await t.call('setLook', 0, -45);
      await t.call('waitFrames', 3);
      await tapWorld(t, x0 + 0.5, y0 + 0.19, tz + 0.5);
      const st1 = await t.call('getState', x0, y0, tz);
      t.assert((st1 & 4) !== 0, `a tap opens the trapdoor (state ${st1})`);
      await t.call('setBlock', x0, y0, tz, 'air');
      // place a birch door with a tap on the ground, then tap it open
      await t.call('setSlot', 0, 'birch_door', 4);
      await tapWorld(t, x0 + 0.5, y0, tz + 0.5);
      const dl = await t.call('getBlock', x0, y0 + 0, tz), du = await t.call('getBlock', x0, y0 + 1, tz);
      t.assert(dl === 'birch_door' && du === 'birch_door', `a tap places a two-high birch door (${dl}/${du})`);
      await tapWorld(t, x0 + 0.5, y0 + 0.8, tz + 0.5);
      t.assert(((await t.call('getState', x0, y0, tz)) & 4) !== 0, 'a tap opens the birch door');
      await t.call('setBlock', x0, y0 + 1, tz, 'air'); await t.call('setBlock', x0, y0, tz, 'air');
      // flower pot: place it, then plant a poppy with a tap
      await t.call('setSlot', 0, 'flower_pot', 4);
      await tapWorld(t, x0 + 0.5, y0, tz + 0.5);
      t.assert(await t.call('getBlock', x0, y0, tz) === 'flower_pot', 'a tap places a flower pot');
      await t.call('setSlot', 0, 'poppy', 4);
      await tapWorld(t, x0 + 0.5, y0 + 0.3, tz + 0.5);
      t.assert(await t.call('getState', x0, y0, tz) === 2, 'a poppy tap plants it in the pot');
      // a lantern tapped onto the underside of a block hangs
      await t.call('setBlock', x0, y0 + 3, tz, 'oak_planks');
      await t.call('setLook', 0, 30);
      await t.call('waitFrames', 3);
      await t.call('setSlot', 0, 'lantern', 4);
      await tapWorld(t, x0 + 0.5, y0 + 3, tz + 0.5);
      const lan = { id: await t.call('getBlock', x0, y0 + 2, tz), st: await t.call('getState', x0, y0 + 2, tz) };
      t.assert(lan.id === 'lantern' && (lan.st & 1) === 1, `a lantern under a block hangs (${JSON.stringify(lan)})`);
      // breaking the block above drops the hanging lantern (support)
      await t.call('setBlock', x0, y0 + 3, tz, 'air');
      await t.call('runTicks', 3);
      t.assert(await t.call('getBlock', x0, y0 + 2, tz) === 'air', 'the lantern falls off when its ceiling goes');
      await t.call('setLook', 0, -22);
      await t.call('waitFrames', 5);
      await t.shot('lead-palette-after-taps');
      const light = await t.call('getLight', x0 + 3, y0, z0 - 7);
      t.note('lanternLight', light);
    },
  },
  {
    // Judge FID-8: an obsidian frame lit with flint and steel (a real tap) opens a portal; walking in (the real up
    // arrow) takes the child to the Nether - dark red caverns, glowstone, a lava sea, no sky, no rain - onto a
    // safe railed platform; walking back in brings her to the same portal at home. One Undo removes a lit sheet,
    // and breaking the frame removes it too.
    name: 'lead-nether-portal', requires: ['mechanics', 'interaction', 'renderer', 'worldgen', 'kid'],
    async run(t) {
      await t.call('startWorld', { preset: 'default', seed: 12345, mode: 'creative', difficulty: 'peaceful' });
      await t.call('setFlying', false);
      await t.call('waitTicks', 5);
      const p = await t.call('pos');
      const x0 = Math.floor(p.x) - 1, y0 = Math.floor(p.y), z0 = Math.floor(p.z) - 4;
      await t.eval(({ x0, y0, z0 }) => {
        const api = window.__game, w = api.game.world, id = (n) => api.blockId(n);
        for (let dx = -2; dx <= 5; dx++) for (let dz = -1; dz <= 4; dz++) {
          w.setBlock(x0 + dx, y0 - 1, z0 + dz, id('stone'), 0, { cause: 'test' });
          for (let dy = 0; dy < 6; dy++) w.setBlock(x0 + dx, y0 + dy, z0 + dz, 0, 0, { cause: 'test' });
        }
        for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 5; dy++) {
          if (dx === 0 || dx === 3 || dy === 0 || dy === 4) w.setBlock(x0 + dx, y0 + dy, z0, id('obsidian'), 0, { cause: 'test' });
        }
      }, { x0, y0, z0 });
      await t.call('setSlot', 0, 'flint_and_steel', 1); await t.call('selectSlot', 0);
      await t.call('setLook', 0, -20);
      await t.call('waitFrames', 5);
      const sheet = () => t.eval(({ x0, y0, z0 }) => { let n = 0; const g = window.__game; for (let dx = 1; dx <= 2; dx++) for (let dy = 1; dy <= 3; dy++) if (g.getBlock(x0 + dx, y0 + dy, z0) === 'nether_portal') n++; return n; }, { x0, y0, z0 });
      await tapWorld(t, x0 + 1.5, y0 + 1, z0 + 0.5);
      t.assert(await sheet() === 6, `a flint tap inside the frame lights a 2x3 sheet (${await sheet()})`);
      await t.shot('lead-nether-lit');
      await t.eval(() => window.__game.game.kid.undo());
      await t.call('waitTicks', 2);
      t.assert(await sheet() === 0, 'one Undo puts the frame back to empty');
      await tapWorld(t, x0 + 1.5, y0 + 1, z0 + 0.5);
      t.assert(await sheet() === 6, 'lit again');
      // walk in
      await t.call('setLook', 0, 0);
      const travels = () => t.call('eventCount', 'nether:travel');
      const base = await travels();
      await t.page.keyboard.down('ArrowUp');
      let went = false;
      for (let i = 0; i < 60 && !went; i++) { await new Promise((r) => setTimeout(r, 100)); went = (await travels()) > base; }
      await t.page.keyboard.up('ArrowUp');
      t.assert(went, 'walking into the sheet travels');
      await t.call('waitFrames', 30);
      const there = await t.eval(() => {
        const g = window.__game.game, pl = g.player, r = g.renderer, w = g.world;
        let lava = 0;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 2; dy++) if ((w.getRaw(Math.floor(pl.x) + dx, Math.floor(pl.y) + dy, Math.floor(pl.z) + dz) & 0xff) === 14) lava++;
        return { x: pl.x, y: pl.y, z: pl.z, nether: r.nether, fogFar: r.uniforms.uFogFar.value, minLight: r.uniforms.uMinLight.value, rain: g.fx.weather.rain,
          floor: window.__game.getBlock(Math.floor(pl.x), Math.floor(pl.y) - 1, Math.floor(pl.z)), lava, clouds: g.fx.stats ? g.fx.stats().celestial : null };
      });
      t.note('arrived', there);
      t.assert(there.x > 30000 && there.nether, `in the Nether (${Math.round(there.x)})`);
      t.assert(there.fogFar <= 56 && there.minLight >= 0.3 && there.rain === 0, 'Nether haze, a light floor and no rain');
      t.assert(['obsidian', 'nether_bricks', 'netherrack'].includes(there.floor) && there.lava === 0, `a safe floor and no lava next to the child (${there.floor}, lava ${there.lava})`);
      for (let i = 0; i < 40; i++) { if (!(await t.eval(() => window.__game.game.world.unmeshedWithin(3)))) break; await new Promise((r) => setTimeout(r, 100)); }
      await t.call('waitFrames', 10);
      await t.shot('lead-nether-arrived');
      await t.call('setLook', 0, 10);
      await t.call('waitFrames', 10);
      await t.shot('lead-nether-portal-back');
      // back through the portal behind the arrival spot (it faces away from the sheet)
      const sheetDir = await t.eval(() => {
        const g = window.__game.game, pl = g.player;
        for (let r = 1; r <= 3; r++) for (const [dx, dz] of [[0, -r], [0, r], [r, 0], [-r, 0]]) {
          if ((g.world.getRaw(Math.floor(pl.x + dx), Math.floor(pl.y) + 1, Math.floor(pl.z + dz)) & 0xff) === window.__game.blockId('nether_portal')) return { dx, dz };
        }
        return null;
      });
      t.assert(!!sheetDir, 'the arrival portal is right there');
      await t.call('setLook', sheetDir.dz < 0 ? 0 : sheetDir.dz > 0 ? 180 : sheetDir.dx > 0 ? 270 : 90, 0);
      await t.page.keyboard.down('ArrowUp');
      let back = false;
      for (let i = 0; i < 60 && !back; i++) { await new Promise((r) => setTimeout(r, 100)); back = (await travels()) > base + 1; }
      await t.page.keyboard.up('ArrowUp');
      const home = await t.call('pos');
      t.assert(back && Math.abs(home.x - (x0 + 2)) < 4 && Math.abs(home.z - z0) < 4, `back home at the first portal (${Math.round(home.x)}, ${Math.round(home.z)} vs ${x0 + 2}, ${z0})`);
      t.assert(!(await t.eval(() => window.__game.game.renderer.nether)), 'the overworld sky is back');
      // breaking the frame removes the sheet
      await t.call('setBlock', x0, y0 + 2, z0, 'air');
      await t.call('runTicks', 10);
      t.assert(await sheet() === 0, `no sheet without its frame (${await sheet()})`);
    },
  },
  {
    // Judge FID-7 (last item): two chests side by side make one double chest - 54 slots on one screen, each half
    // keeps its own 27 in the save, and breaking one half leaves a single chest with its items.
    name: 'lead-double-chest', requires: ['mechanics', 'interaction', 'invui'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, rules: { passiveMobs: false } });
      await t.call('setFlying', false);
      await t.call('waitTicks', 5);
      const p = await t.call('pos');
      const x0 = Math.floor(p.x), y0 = Math.floor(p.y), z0 = Math.floor(p.z) - 3;
      await t.call('setSlot', 0, 'chest', 8); await t.call('selectSlot', 0);
      await t.call('setLook', 0, -35);
      await t.call('waitFrames', 3);
      await tapWorld(t, x0 + 0.5, y0, z0 + 0.5);
      await tapWorld(t, x0 + 1.5, y0, z0 + 0.5);
      const st = [await t.call('getState', x0, y0, z0), await t.call('getState', x0 + 1, y0, z0)];
      t.assert(await t.call('getBlock', x0, y0, z0) === 'chest' && await t.call('getBlock', x0 + 1, y0, z0) === 'chest', 'two chests placed with taps');
      t.assert((st[0] & 12) && (st[1] & 12) && (st[0] & 3) === (st[1] & 3), `they joined into a double chest (states ${st})`);
      await t.call('waitFrames', 5);
      await t.shot('lead-double-chest-world');
      // a tap opens one 54-slot screen
      await t.call('setSlot', 0, null);
      await tapWorld(t, x0 + 1, y0 + 0.5, z0 + 0.9);
      t.assert(await t.call('uiOpen') === 'chest', 'the chest screen opened');
      const ids = await t.eval(() => window.__game.game.invui.screen.slotIds().filter((s) => s[0] === 'k').length);
      t.assert(ids === 54, `54 chest slots (${ids})`);
      await t.eval(() => { const g = window.__game.game; g.inventory.cursor = { item: 'diamond', count: 5 }; g.invui.screen.clickSlot('k40'); g.inventory.cursor = { item: 'emerald', count: 2 }; g.invui.screen.clickSlot('k3'); });
      await t.shot('lead-double-chest-open');
      await t.call('closeUI');
      const halves = await t.eval(({ x0, y0, z0 }) => {
        const w = window.__game.game.world, it = (be) => (be && be.items ? be.items.map((s, i) => (s ? i + ':' + s.item : '')).filter(Boolean) : null);
        return [it(w.getBlockEntity(x0, y0, z0)), it(w.getBlockEntity(x0 + 1, y0, z0))];
      }, { x0, y0, z0 });
      t.note('halves', halves);
      const flat = halves.flat().filter(Boolean);
      t.assert(halves.every((h) => Array.isArray(h)) && flat.includes('3:emerald') && flat.includes('13:diamond'), `each half keeps its own 27 slots (${JSON.stringify(halves)})`);
      // break the half with the diamonds: the other one is a single chest again and keeps the emeralds
      const dIdx = halves[0] && halves[0].includes('13:diamond') ? 0 : 1;
      await t.eval(({ x, y, z }) => window.__game.game.interaction.breakBlock(x, y, z, { by: 'player' }), { x: x0 + dIdx, y: y0, z: z0 });
      await t.call('runTicks', 3);
      const left = { st: await t.call('getState', x0 + (1 - dIdx), y0, z0) };
      left.items = await t.eval(({ x, y, z }) => { const be = window.__game.game.world.getBlockEntity(x, y, z); return be ? be.items.filter(Boolean).map((s) => s.item) : null; }, { x: x0 + (1 - dIdx), y: y0, z: z0 });
      t.assert((left.st & 12) === 0 && left.items && left.items.includes('emerald'), `the other half is a single chest with its items (${JSON.stringify(left)})`);
    },
  },
  {
    // Judge KID-12: an event payload that carries a live mob (player:hurt's source) used to make events() walk the
    // whole game: the Playwright process ran out of memory. Now the copy is bounded and the mob is a small stub.
    name: 'lead-events-live-payload', requires: ['mobs', 'survival'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, mode: 'survival', difficulty: 'easy', rules: { passiveMobs: false, hostileMobs: true, daylightCycle: false } });
      await t.call('setFlying', false);
      await t.call('setTime', 18000);
      const base = await t.call('eventCount', 'player:hurt');
      await t.eval(() => { const g = window.__game.game, p = g.player; g.mobs.spawnMob('zombie', p.x + 1.3, p.y, p.z); });
      let hurt = false;
      for (let i = 0; i < 20 && !hurt; i++) { await t.call('runTicks', 20); hurt = (await t.call('eventCount', 'player:hurt')) > base; }
      t.assert(hurt, 'the zombie hit the player');
      const t0 = Date.now();
      const evs = await t.call('events', 'player:hurt', 20);
      const ms = Date.now() - t0, size = JSON.stringify(evs).length;
      // survival.damage's source is {entity} for a mob hit
      const src = evs.map((e) => e.payload && e.payload.source && (e.payload.source.entity || e.payload.source)).find((x) => x && x.type === 'zombie');
      t.note('events', { ms, size, source: src });
      t.assert(ms < 3000 && size < 20000, `events('player:hurt') is quick and small (${ms} ms, ${size} chars)`);
      t.assert(src && typeof src.id === 'number' && Number.isFinite(src.x), `the zombie source is a small stub ${JSON.stringify(src)}`);
      // the other test API copies keep their full depth
      const m = await t.call('meta');
      t.assert(m && m.rules && m.rules.hostileMobs === true && typeof m.seed === 'number', 'meta() is still complete');
    },
  },
  {
    // Judge FID-3: Peaceful and back used to switch monsters off for good (setDifficulty wrote hostileMobs = false).
    name: 'lead-difficulty-roundtrip', requires: ['mobs', 'survival'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, seed: 5, mode: 'survival', difficulty: 'easy', rules: { passiveMobs: false } });
      await t.call('setFlying', false);
      t.assert((await t.call('meta')).rules.hostileMobs === true, 'a Survival Easy world starts with monsters on');
      await t.call('setTime', 14000);
      await t.call('setDifficulty', 'peaceful');
      await t.call('runTicks', 600);
      const monsters = () => t.eval(() => window.__game.game.entities.all().filter((e) => e.category === 'monster' && !e.removed).length);
      const onPeaceful = await monsters();
      await t.call('setDifficulty', 'easy');
      const m = await t.call('meta');
      t.assert(m.difficulty === 'easy' && m.rules.hostileMobs === true, `back on Easy the Monsters switch is still on (${JSON.stringify({ d: m.difficulty, h: m.rules.hostileMobs })})`);
      let n = 0;
      for (let i = 0; i < 12 && n === 0; i++) { await t.call('setTime', 18000); await t.call('runTicks', 100); n = await monsters(); }
      t.note('monsters', { onPeaceful, afterEasy: n });
      t.assert(onPeaceful === 0, `no monsters while Peaceful (${onPeaceful})`);
      t.assert(n > 0, `monsters spawn again at night after Peaceful -> Easy (${n})`);
    },
  },
  {
    // Judge FID-11: survival worlds have weather; Survival Normal shows the big Respawn button after dying.
    name: 'lead-survival-rules', requires: ['survival', 'menus', 'fx'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, seed: 6, mode: 'survival', difficulty: 'normal', rules: { passiveMobs: false, hostileMobs: false } });
      await t.call('setFlying', false);
      const r = (await t.call('meta')).rules;
      t.assert(r.weatherCycle === true && r.immediateRespawn === false && r.keepInventory === true, `Survival Normal rules ${JSON.stringify({ w: r.weatherCycle, i: r.immediateRespawn, k: r.keepInventory })}`);
      // a real fall: 30 blocks up, flying off
      const p = await t.call('pos');
      await t.call('teleport', p.x, p.y + 30, p.z);
      let dead = false;
      for (let i = 0; i < 20 && !dead; i++) { await t.call('runTicks', 10); dead = await t.eval(() => !!window.__game.game.player.dead); }
      t.assert(dead, 'the fall killed the player');
      await t.call('waitFrames', 5);
      t.assert(await t.call('uiOpen') === 'death', 'the death screen is open');
      await t.call('runTicks', 60);
      t.assert(await t.eval(() => !!window.__game.game.player.dead), 'no automatic respawn on Survival Normal');
      await t.shot('lead-survival-death');
      const btn = await t.page.$('.bc-death-respawn');
      t.assert(!!btn, 'the big Respawn button is there');
      const box = await btn.boundingBox();
      t.assert(box && box.width >= 64 && box.height >= 64, `the Respawn button is big (${box && Math.round(box.width)} px)`);
      await t.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const back = await t.waitFor(() => { const g = window.__game.game; return !g.player.dead && g.player.health === 20 && !g.ui.current && g.state === 'playing'; }, null, 5000);
      t.assert(back, 'a real click on Respawn brings the child back with full health');
      // weather: the cycle runs in survival (the first rain comes within 18000 ticks)
      let rain = false;
      for (let i = 0; i < 19 && !rain; i++) { await t.call('runTicks', 1000); rain = await t.eval(() => window.__game.game.fx.weather.target > 0); }
      t.assert(rain, 'it starts raining in a survival world');
      // Survival Easy keeps the instant respawn; the kid world never rains by itself
      await t.call('startWorld', { ...FLAT, seed: 7, mode: 'survival', difficulty: 'easy' });
      t.assert((await t.call('meta')).rules.immediateRespawn === true, 'Survival Easy respawns at once');
      await t.call('startWorld', FLAT);
      t.assert((await t.call('meta')).rules.weatherCycle === false, 'the kid creative world has no weather cycle');
    },
  },
];
