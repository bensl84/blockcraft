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
      await t.call('setRandomSeed', 7);
      const a = await t.eval(() => [0, 1, 2].map(() => window.__game.game.rand()));
      await t.call('setRandomSeed', 7);
      const b = await t.eval(() => [0, 1, 2].map(() => window.__game.game.rand()));
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
];
