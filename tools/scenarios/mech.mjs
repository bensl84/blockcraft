// OWNER LANE: FEATURE-MECH. Smoke scenarios for block mechanics (SPEC §8.6 acceptance).
// Most scenarios drive MECH directly through the frozen world/interaction contract (world.setBlock,
// interaction.breakBlock/placeBlock - implemented by the CORE stubs too) and the additive helper
// game.mechanics.useAt(x, y, z, {item}) (CORE-E's use() steps 3-5). The `mech-input-*` scenarios go through the
// real CORE-E kid tap path; `mech-fence-pen` needs the MOBS lane and reports PENDING until it lands.
// The full in-world play-through (real mouse, screenshots, perf) is tools/mech-play.mjs.

const FLAT = { preset: 'flat', seed: 11, mode: 'creative', difficulty: 'peaceful' };
const SURV = { preset: 'flat', seed: 11, mode: 'survival', difficulty: 'easy' };

async function start(t, opts = FLAT) {
  await t.call('startWorld', opts);
  await t.call('setRandomSeed', 4242);
  return t.call('pos');
}

export default [
  {
    name: 'mech-sand-falls', requires: [],
    async run(t) {
      const p = await start(t);
      const x = Math.floor(p.x) + 3, z = Math.floor(p.z) - 3;
      t.assert(await t.call('setBlock', x, 9, z, 'sand'), 'sand placed 5 above the ground');
      await t.call('runTicks', 6);
      t.assert(await t.call('getBlock', x, 9, z) === 'air', 'sand left its cell');
      const falling = (await t.call('entities')).filter((e) => e.type === 'falling_block');
      t.assert(falling.length === 1, `one falling_block entity (${falling.length})`);
      await t.call('lookAt', x + 0.5, 6, z + 0.5);
      await t.call('waitFrames', 3);
      await t.shot('mech-sand-falling');
      await t.call('runTicks', 34);
      t.assert(await t.call('getBlock', x, 4, z) === 'sand', 'sand rests on the ground within 40 ticks');
      t.assert((await t.call('entities')).every((e) => e.type !== 'falling_block'), 'entity removed after landing');
    },
  },
  {
    name: 'mech-tnt-chain', requires: [],
    async run(t) {
      const p = await start(t);
      const x = Math.floor(p.x) + 4, z = Math.floor(p.z) - 6;
      await t.call('setBlock', x, 4, z, 'tnt');
      await t.call('setBlock', x + 3, 4, z, 'tnt');
      const before = await t.call('eventCount', 'explosion');
      const primed = await t.eval(([x, z]) => !!window.__game.game.mechanics.primeTnt(x, 4, z), [x, z]);
      t.assert(primed, 'primeTnt returns the entity');
      await t.call('runTicks', 40);
      await t.call('lookAt', x + 0.5, 4.5, z + 0.5);
      await t.call('waitFrames', 3);
      await t.shot('mech-tnt-primed');
      const res = await t.eval(async () => {
        const g = window.__game.game;
        // time the TICK only (stepTicks also renders a frame, which under SwiftShader can take 250 ms on its own;
        // LEAD integration: the old measure failed one SwiftShader run at 244 ms while the ticks took a few ms)
        let worst = 0, frameWorst = 0, t0 = 0;
        const done = () => { worst = Math.max(worst, performance.now() - t0); };
        g.afterTick.add(done);
        try {
          for (let i = 0; i < 160; i++) { t0 = performance.now(); g.stepTicks(1); frameWorst = Math.max(frameWorst, performance.now() - t0); }
        } finally { g.afterTick.delete(done); }
        return { worst, frameWorst };
      });
      t.note('worstTickMs', Math.round(res.worst * 10) / 10);
      t.note('worstTickPlusFrameMs', Math.round(res.frameWorst * 10) / 10);
      const after = await t.call('eventCount', 'explosion');
      t.assert(after - before === 2, `explosion emitted twice (${after - before})`);
      t.assert(await t.call('getBlock', x, 4, z) === 'air' && await t.call('getBlock', x + 3, 4, z) === 'air', 'both TNT gone');
      t.assert((await t.call('entities')).every((e) => e.type !== 'tnt'), 'no primed TNT left');
      t.assert(res.worst < 50, `no tick over 50 ms during the chain (${res.worst.toFixed(1)} ms)`);
      await t.shot('mech-tnt-crater');
    },
  },
  {
    name: 'mech-door', requires: [],
    async run(t) {
      const p = await start(t);
      const x = Math.floor(p.x) + 2, z = Math.floor(p.z) - 2;
      const r = await t.eval(([x, z]) => window.__game.game.mechanics.useAt(x, 3, z, { item: 'oak_door' }), [x, z]);
      t.assert(r.consumed && r.by === 'placer', `door placer consumed the press (${JSON.stringify(r)})`);
      t.assert(await t.call('getBlock', x, 4, z) === 'oak_door' && await t.call('getBlock', x, 5, z) === 'oak_door', 'two-high door');
      const s0 = await t.call('getState', x, 4, z);
      await t.eval(([x, z]) => window.__game.game.mechanics.useAt(x, 4, z, { item: 'stick' }), [x, z]);
      const s1 = await t.call('getState', x, 4, z);
      await t.eval(([x, z]) => window.__game.game.mechanics.useAt(x, 5, z, { item: 'stick' }), [x, z]);
      const s2 = await t.call('getState', x, 4, z);
      t.assert((s0 & 4) === 0 && (s1 & 4) === 4 && (s2 & 4) === 0, `open state flips twice (${s0}, ${s1}, ${s2})`);
      const toggles = await t.call('events', 'door:toggle', 2);
      t.assert(toggles.length === 2 && toggles[0].payload.open === true && toggles[1].payload.open === false, 'door:toggle open/close');
      await t.eval(([x, z]) => window.__game.game.interaction.breakBlock(x, 5, z, { by: 'player' }), [x, z]);
      await t.call('runTicks', 2);
      t.assert(await t.call('getBlock', x, 4, z) === 'air', 'breaking the top half removes the bottom half');
    },
  },
  {
    name: 'mech-water-flow', requires: [],
    async run(t) {
      const p = await start(t);
      const x = Math.floor(p.x) + 3, z = Math.floor(p.z) - 3;
      await t.call('setBlock', x, 4, z, 'water');
      await t.call('runTicks', 200);
      t.assert(await t.call('getBlock', x + 7, 4, z) === 'water' && await t.call('getState', x + 7, 4, z) === 7, 'reaches distance 7 at level 7');
      t.assert(await t.call('getBlock', x, 4, z - 7) === 'water', 'all directions');
      t.assert(await t.call('getBlock', x + 8, 4, z) === 'air', 'not distance 8');
      // pick up with the bucket helper path, pour it back
      await t.call('setBlock', x, 4, z, 'air');
      await t.call('runTicks', 200);
      t.assert(await t.call('getBlock', x + 3, 4, z) === 'air', 'flow dries up without a source');
    },
  },
  {
    name: 'mech-farm', requires: [],
    async run(t) {
      const p = await start(t);
      const x = Math.floor(p.x) + 2, z = Math.floor(p.z) - 3;
      await t.call('setBlock', x, 3, z, 'dirt');
      const hoe = await t.eval(([x, z]) => window.__game.game.mechanics.useAt(x, 3, z, { item: 'wooden_hoe' }), [x, z]);
      t.assert(hoe.consumed && await t.call('getBlock', x, 3, z) === 'farmland', 'hoe tills dirt');
      const planted = await t.eval(([x, z]) => window.__game.game.interaction.placeBlock(x, 4, z, window.__game.blockId('wheat'), 0, { by: 'player', item: 'wheat_seeds' }), [x, z]);
      t.assert(planted && await t.call('getBlock', x, 4, z) === 'wheat', 'seeds planted');
      await t.call('setRandomSeed', 12345);
      for (let i = 0; i < 3; i++) await t.eval(([x, z]) => window.__game.game.mechanics.useAt(x, 4, z, { item: 'bone_meal' }), [x, z]);
      t.assert(await t.call('getState', x, 4, z) === 7, `wheat age 7 after bone meal x3 (age ${await t.call('getState', x, 4, z)})`);
      t.assert(await t.call('eventCount', 'bonemeal') >= 2, 'bonemeal events');
      // sapling -> tree
      await t.call('setBlock', x + 3, 4, z, 'oak_sapling');
      await t.eval(([x, z]) => { const m = window.__game.game.mechanics; for (let i = 0; i < 40 && window.__game.getBlock(x, 4, z) === 'oak_sapling'; i++) m.applyBoneMeal(x, 4, z); }, [x + 3, z]);
      t.assert(await t.call('getBlock', x + 3, 4, z) === 'oak_log', 'bone meal grows a tree from a sapling');
    },
  },
  {
    name: 'mech-torch-support', requires: [],
    async run(t) {
      const p = await start(t);
      const x = Math.floor(p.x) + 2, z = Math.floor(p.z) - 2;
      await t.call('setBlock', x, 4, z, 'stone');
      await t.call('setBlock', x, 5, z, 'torch');
      const action = await t.eval(([x, z]) => { const ix = window.__game.game.interaction; const a = ix.newAction(); ix.breakBlock(x, 4, z, { by: 'player', action: a }); return a; }, [x, z]);
      await t.call('runTicks', 3);
      t.assert(await t.call('getBlock', x, 5, z) === 'air', 'torch fell off');
      const ev = (await t.call('events', 'block:changed', 50)).map((e) => e.payload).filter((c) => c.x === x && c.y === 5 && c.z === z && c.oldId === 69);
      t.assert(ev.length === 1 && ev[0].action === action && ev[0].cause === 'support', `torch change carries the break's action (${JSON.stringify(ev)})`);
    },
  },
  {
    name: 'mech-tnt-batch', requires: [],
    async run(t) {
      const p = await start(t, SURV);
      const x = Math.floor(p.x) + 8, z = Math.floor(p.z) - 8;
      await t.eval(([x, z]) => {
        const w = window.__game.game.world, stone = window.__game.blockId('stone');
        w.beginBatch();
        try { for (let dx = -5; dx <= 5; dx++) for (let dy = 4; dy <= 14; dy++) for (let dz = -5; dz <= 5; dz++) w.setBlock(x + dx, dy, z + dz, stone, 0, { cause: 'test' }); } finally { w.endBatch(); }
        w.setBlock(x, 9, z, window.__game.blockId('tnt'), 0, { cause: 'test' });
      }, [x, z]);
      const before = (await t.call('entities')).length;
      await t.eval(([x, z]) => window.__game.game.mechanics.primeTnt(x, 9, z, 2), [x, z]);
      await t.call('runTicks', 6);
      const ev = (await t.call('events', 'explosion', 1))[0];
      t.assert(ev && Array.isArray(ev.payload.blocks) && ev.payload.blocks.length === ev.payload.count && ev.payload.count > 5, `explosion.blocks has count entries (${ev && ev.payload.count})`);
      const last = await t.eval(() => window.__game.game.mechanics.stats.lastExplosion);
      t.note('lastExplosion', last);
      t.assert(last.items <= 32, `at most 32 item entities (${last.items})`);
      t.assert(last.ms < 50, `explosion resolved in under 50 ms (${last.ms})`);
      const items = (await t.call('entities')).filter((e) => e.type === 'item').length;
      t.assert(items <= 32, `item entities <= 32 (${items})`);
      if (!t.stubs.includes('items')) t.assert(items >= 1, 'survival TNT drops items');
      t.note('entitiesBefore', before);
    },
  },
  {
    name: 'mech-bed-nap', requires: [],
    async run(t) {
      const p = await start(t);
      const x = Math.floor(p.x) + 2, z = Math.floor(p.z) - 3;
      await t.eval(() => { window.__game.game.player.yaw = 0; });
      const placed = await t.eval(([x, z]) => window.__game.game.mechanics.useAt(x, 3, z, { item: 'red_bed' }), [x, z]);
      t.assert(placed.consumed && await t.call('getBlock', x, 4, z) === 'bed' && await t.call('getBlock', x, 4, z - 1) === 'bed', 'two-long bed');
      await t.eval(([x, z]) => window.__game.game.mechanics.useAt(x, 4, z, { item: 'stick' }), [x, z]);
      const start1 = await t.call('events', 'sleep:start', 1);
      t.assert(start1.length === 1 && start1[0].payload.nap === true, 'sleep:start {nap: true}');
      t.assert(await t.call('eventCount', 'player:spawnSet') >= 1, 'spawn point set');
      t.assert(await t.call('getTime') === 18000, 'starry nap sky');
      await t.call('waitFrames', 2);
      await t.shot('mech-nap');
      await t.call('runTicks', 70);
      t.assert(await t.call('getTime') === 3000, 'time returns to 3000');
      t.assert(await t.call('eventCount', 'sleep:end') >= 1, 'sleep:end');
    },
  },
  {
    name: 'mech-visuals', requires: [],
    async run(t) {
      const p = await start(t);
      const bx = Math.floor(p.x), bz = Math.floor(p.z) - 6;
      await t.eval(([bx, bz]) => {
        const g = window.__game.game, id = window.__game.blockId;
        for (let dx = -3; dx <= 3; dx++) for (let dy = 4; dy <= 7; dy++) g.world.setBlock(bx + dx, dy, bz - 1, id('stone_bricks'), 0, { cause: 'test' });
        g.mechanics.useAt(bx, 5, bz - 1, { item: 'painting', face: 4 });
        g.world.setBlock(bx - 2, 9, bz + 1, id('sand'), 0, { cause: 'test' });
        g.world.setBlock(bx + 2, 4, bz + 1, id('tnt'), 0, { cause: 'test' });
        g.mechanics.primeTnt(bx + 2, 4, bz + 1, 400);
      }, [bx, bz]);
      await t.call('runTicks', 8);
      const ents = await t.call('entities');
      t.note('entities', ents.map((e) => e.type));
      t.assert(ents.some((e) => e.type === 'painting'), 'painting hung');
      t.assert(ents.some((e) => e.type === 'tnt'), 'primed TNT');
      await t.call('lookAt', bx + 0.5, 5.5, bz);
      await t.call('waitFrames', 4);
      await t.shot('mech-visuals');
      await t.eval(([bx, bz]) => window.__game.game.interaction.breakBlock(bx, 5, bz - 1, { by: 'player' }), [bx, bz]);
      await t.call('runTicks', 12);
      t.assert((await t.call('entities')).every((e) => e.type !== 'painting'), 'painting pops off when its wall goes');
    },
  },
  {
    name: 'mech-save-ticks', requires: [],
    async run(t) {
      const p = await start(t);
      const x = Math.floor(p.x) + 3, z = Math.floor(p.z) + 3;
      await t.call('setBlock', x, 4, z, 'water');
      await t.call('runTicks', 3);
      const data = await t.eval(() => JSON.parse(JSON.stringify(window.__game.game.mechanics.serialize(window.__game.game))));
      t.assert(data.v === 1 && data.ticks.length > 0, `serialize keeps pending ticks (${data.ticks.length})`);
    },
  },
  /* ---------- real CORE-E input path (and MOBS for the pen) ---------- */
  {
    name: 'mech-input-door', requires: ['input', 'interaction', 'raycast', 'player', 'physics'],
    async run(t) {
      const p = await start(t);
      await t.call('setFlying', false);
      await t.call('waitTicks', 10);
      await t.call('setSlot', 0, 'oak_door', 1);
      await t.call('selectSlot', 0);
      const x = Math.floor(p.x), z = Math.floor(p.z) - 2;
      const aim = await t.call('aimAt', x + 0.5, 4, z + 0.5);
      await t.call('tapAt', aim.x, aim.y);
      await t.call('waitTicks', 3);
      t.assert(await t.call('getBlock', x, 4, z) === 'oak_door' && await t.call('getBlock', x, 5, z) === 'oak_door', 'tap places a two-high door');
      const a2 = await t.call('aimAt', x + 0.5, 4.5, z + 0.5);
      await t.call('tapAt', a2.x, a2.y);
      await t.call('waitTicks', 3);
      t.assert((await t.call('getState', x, 4, z) & 4) === 4, 'tap opens the door');
    },
  },
  {
    name: 'mech-input-survival-door', requires: ['input', 'interaction', 'raycast', 'player', 'physics'],
    async run(t) {
      // survival: one tap places ONE two-high door and uses up exactly one door item (CORE-E consumes after a placer)
      const p = await start(t, SURV);
      await t.call('waitTicks', 10);
      await t.call('setSlot', 0, 'oak_door', 3);
      await t.call('selectSlot', 0);
      const x = Math.floor(p.x) + 1, z = Math.floor(p.z) - 2;
      const aim = await t.call('aimAt', x + 0.5, 4, z + 0.5);
      await t.call('tapAt', aim.x, aim.y);
      await t.call('waitTicks', 3);
      t.assert(await t.call('getBlock', x, 5, z) === 'oak_door', 'door placed');
      t.assert((await t.call('selected')).count === 2, `one door used (${(await t.call('selected')).count} left)`);
      // refused under a ceiling: nothing used up
      await t.call('setBlock', x - 2, 5, z, 'stone');
      const a2 = await t.call('aimAt', x - 1.5, 4, z + 0.5);
      await t.call('tapAt', a2.x, a2.y);
      await t.call('waitTicks', 3);
      t.assert(await t.call('getBlock', x - 2, 4, z) !== 'oak_door', 'no door under a ceiling');
      t.assert((await t.call('selected')).count === 2, 'refused door is not used up');
    },
  },
  {
    name: 'mech-input-painting', requires: ['input', 'interaction', 'raycast', 'player', 'physics'],
    async run(t) {
      // kid creative: tap a wall with a painting -> it hangs; tap it with an empty hand -> it comes down (like a block)
      const p = await start(t);
      await t.call('setFlying', false);
      await t.call('waitTicks', 5);
      const x = Math.floor(p.x), z = Math.floor(p.z) - 4;
      await t.eval(([x, z]) => {
        const g = window.__game.game, id = window.__game.blockId;
        for (let dx = -2; dx <= 2; dx++) for (let y = 4; y <= 6; y++) g.world.setBlock(x + dx, y, z, id('stone_bricks'), 0, { cause: 'test' });
      }, [x, z]);
      await t.call('setSlot', 0, 'painting', 1);
      await t.call('selectSlot', 0);
      const a = await t.call('aimAt', x + 0.5, 5.2, z + 1.001);
      await t.call('tapAt', a.x, a.y);
      await t.call('waitTicks', 2);
      const hung = (await t.call('entities')).filter((e) => e.type === 'painting');
      t.assert(hung.length === 1, `tap hangs a painting (${hung.length})`);
      t.note('picture', hung[0] && hung[0].data.index);
      await t.call('setSlot', 1, null);
      await t.call('selectSlot', 1);
      const b = await t.call('aimAt', hung[0].x, hung[0].y + 0.5, hung[0].z + 0.05);
      await t.call('tapAt', b.x, b.y);
      await t.call('waitTicks', 2);
      t.assert((await t.call('entities')).every((e) => e.type !== 'painting'), 'empty-hand tap takes it down');
      t.assert(await t.call('getBlock', x, 5, z) === 'stone_bricks', 'the wall behind is untouched');
    },
  },
  {
    name: 'mech-input-bucket', requires: ['input', 'interaction', 'raycast', 'player', 'physics'],
    async run(t) {
      const p = await start(t, SURV);
      await t.call('waitTicks', 10);
      const x = Math.floor(p.x), z = Math.floor(p.z) - 2;
      await t.call('setBlock', x, 4, z, 'water');
      await t.call('setSlot', 0, 'bucket', 1);
      await t.call('selectSlot', 0);
      // look there AND put the kid cursor on it (an earlier scenario may have left the cursor off-centre)
      await t.call('lookAt', x + 0.5, 4.1, z + 0.5);
      await t.call('aimAt', x + 0.5, 4.1, z + 0.5);
      await t.call('press', 'use');
      await t.call('waitTicks', 3);
      t.assert(await t.call('getBlock', x, 4, z) === 'air', 'bucket picks up the source');
      t.assert((await t.call('selected')).item === 'water_bucket', 'water bucket in hand');
      await t.call('aimAt', x + 0.5, 3.9, z + 0.5);
      await t.call('press', 'use');
      await t.call('waitTicks', 3);
      t.assert(await t.call('getBlock', x, 4, z) === 'water', 'poured back');
    },
  },
  {
    name: 'mech-fence-pen', requires: ['mobs', 'physics', 'interaction', 'input', 'raycast', 'player'],
    async run(t) {
      const p = await start(t);
      const cx = Math.floor(p.x) + 6, cz = Math.floor(p.z) - 6;
      await t.eval(([cx, cz]) => {
        const g = window.__game.game, id = window.__game.blockId;
        for (let d = -3; d <= 3; d++) for (const [x, z] of [[cx + d, cz - 3], [cx + d, cz + 3], [cx - 3, cz + d], [cx + 3, cz + d]]) {
          if (x === cx && z === cz + 3) g.world.setBlock(x, 4, z, id('oak_fence_gate'), 0, { cause: 'test' });
          else g.world.setBlock(x, 4, z, id('oak_fence'), 0, { cause: 'test' });
        }
      }, [cx, cz]);
      await t.call('runTicks', 2);
      const pig = await t.call('spawn', 'pig', cx + 0.5, 4, cz + 0.5);
      await t.call('runTicks', 400);
      const e = (await t.call('entities')).find((x) => x.id === pig);
      t.assert(e && Math.abs(e.x - (cx + 0.5)) < 3 && Math.abs(e.z - (cz + 0.5)) < 3, `pig stays in the pen (${JSON.stringify(e)})`);
      await t.eval(([cx, cz]) => window.__game.game.mechanics.useAt(cx, 4, cz + 3, { item: 'stick' }), [cx, cz]);
      t.assert((await t.call('getState', cx, 4, cz + 3) & 4) === 4, 'gate opens');
    },
  },
];

