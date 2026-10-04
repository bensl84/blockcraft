// OWNER LANE: FEATURE-MOBS. Smoke scenarios for mobs, entities, items and survival (SPEC §8.1 acceptance).
//
// Two kinds:
//  - the SPEC §8.1 acceptance scenarios (mobs-breeding, mobs-pickup, mobs-wolf-tame, mobs-kid-no-death,
//    mobs-no-pileup, mobs-step-up) drive the game the way a child does (interactEntity / breakTarget) through
//    the real CORE-E interaction, input, player and physics;
//  - '-direct' twins call the same mob code through game.mobs.useOn / hit (the exact hooks.entityInteract
//    handlers interaction.use() calls) and interaction.breakBlock, so a failure points at the mob or the core side.
// Event counters (eventCount) are cumulative for the whole page session: scenarios compare against a baseline.
// Deeper in-world playtests with real mouse / keyboard / touch: tools/mobs-play.mjs.

const FLAT = { preset: 'flat', seed: 1, mode: 'creative', difficulty: 'peaceful' };
const NO_SPAWN = { ...FLAT, rules: { passiveMobs: false } };
/** Wait until the renderer is quiet: no section uploads or column merges and no hot (edited) sections left. */
async function settleRenderer(t, quietMs = 400, maxMs = 15000) {
  const end = Date.now() + maxMs;
  let last = -1, since = Date.now();
  while (Date.now() < end) {
    const q = await t.eval(() => { const s = window.__game.game.renderer.getStats(); return { n: s.sectionSets * 100000 + s.merges, hot: s.hotSections || 0 }; });
    if (q.n !== last || q.hot > 0) { last = q.n; since = Date.now(); } else if (Date.now() - since >= quietMs) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}
const SURVIVAL = { preset: 'flat', seed: 1, mode: 'survival', difficulty: 'easy', rules: { passiveMobs: false, hostileMobs: false } };

/** Spawn a mob near the player and return its id. */
async function spawnNear(t, type, dx, dz, opts = {}) {
  return t.eval(({ type, dx, dz, opts }) => {
    const g = window.__game.game, p = g.player;
    const e = g.mobs.spawnMob(type, p.x + dx, p.y, p.z + dz, opts);
    return e ? e.id : null;
  }, { type, dx, dz, opts });
}
/** Event counters are cumulative for the whole page session: scenarios compare against a baseline. */
async function evBase(t, names) {
  const base = {};
  for (const n of names) base[n] = await t.call('eventCount', n);
  return async (n) => (await t.call('eventCount', n)) - (base[n] || 0);
}
const ent = (t, id) => t.eval((id) => { const e = window.__game.game.entities.get(id); return e ? { id: e.id, x: e.x, y: e.y, z: e.z, health: e.health, removed: e.removed, data: JSON.parse(JSON.stringify(e.data)), baby: !!e.data.baby } : null; }, id);

export default [
  {
    name: 'mobs-gallery', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const p = await t.call('pos');
      const ids = await t.eval(({ x, y, z }) => {
        const g = window.__game.game;
        g.setDifficulty('easy'); g.setRule('hostileMobs', true);
        const row = [['pig', { saddled: true }], ['cow', {}], ['sheep', { color: 'white' }], ['sheep', { color: 'pink' }], ['chicken', {}], ['wolf', {}], ['wolf', { tamedBy: 'player', sitting: true }],
          ['cat', {}], ['horse', { coat: 'chestnut' }], ['zombie', {}], ['skeleton', {}], ['creeper', {}], ['spider', {}]];
        const out = [];
        const freeze = (e) => { e.yaw = Math.PI; e.prevYaw = Math.PI; e.headYaw = 0; e.tick = function () { this.age++; }; out.push(e.id); };
        row.forEach(([type, o], i) => { const e = g.mobs.spawnMob(type, x - 15 + i * 2.5, y, z - 11, o); if (e) freeze(e); });
        const babies = [['pig', {}], ['cow', {}], ['sheep', { color: 'light_blue' }], ['chicken', {}], ['wolf', {}]];
        babies.forEach(([type, o], i) => { const e = g.mobs.spawnMob(type, x - 5 + i * 2.5, y, z - 7, { ...o, baby: true }); if (e) freeze(e); });
        const boat = g.entities.spawn('boat', x + 7, y, z - 7, { yaw: 2.4 });
        if (boat) out.push(boat.id);
        return out;
      }, p);
      t.assert(ids.length === 19, `all gallery entities spawned (${ids.length})`);
      await t.call('setLook', 0, -12);
      await t.call('waitTicks', 6);
      await t.call('waitFrames', 3);
      const meshes = await t.eval(() => window.__game.game.entities.all().filter((e) => e.object3d).length);
      t.assert(meshes >= 19, `every entity has a mesh (${meshes})`);
      // the real renderer also draws terrain: count the entity draws as (all) - (entities hidden)
      const setVis = (v) => t.eval((v) => { for (const e of window.__game.game.entities.all()) if (e.object3d) e.object3d.visible = v; }, v);
      // terrain still streaming in (or FX clouds/particles) can change the total between two samples: take the
      // smallest difference over a few hidden/shown pairs (LEAD integration: flaked after other scenarios)
      let entityDraws = Infinity, withEnt = 0;
      for (let i = 0; i < 4; i++) {
        await setVis(false); await t.call('waitFrames', 3);
        const without = (await t.call('stats')).drawCalls;
        await setVis(true); await t.call('waitFrames', 3);
        const w = (await t.call('stats')).drawCalls;
        if (w - without < entityDraws) { entityDraws = w - without; withEnt = w; }
      }
      t.note('drawCalls', { total: withEnt, entities: entityDraws });
      t.assert(entityDraws <= 19 + 2, `one draw call per mob (${entityDraws} entity draws for 19 entities)`);
      t.note('renderCache', await t.eval(() => window.__game.game.mobs.renderStats()));
      await t.shot('mobs-gallery');
    },
  },

  /* ---------------------------------------------------------------- SPEC §8.1 acceptance (child-style input) */
  {
    name: 'mobs-breeding', requires: ['mobs', 'interaction', 'input', 'player', 'physics'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const a = await spawnNear(t, 'cow', 2, -3), b = await spawnNear(t, 'cow', -2, -3);
      const ec = await evBase(t, ['mob:bred']);
      await t.call('setSlot', 0, 'wheat', 4);
      await t.call('selectSlot', 0);
      for (const id of [a, b]) { const r = await t.call('interactEntity', id, 'use'); t.assert(r.targeted, `cow ${id} targeted`); t.assert(r.data.love > 0, 'in love'); }
      await t.call('runTicks', 200);
      const babies = await t.eval(() => window.__game.game.entities.ofType('cow').filter((e) => e.data.baby).length);
      t.assert(babies === 1, `a baby within 200 ticks (${babies})`);
      t.assert(await ec('mob:bred') === 1, 'mob:bred');
    },
  },
  {
    name: 'mobs-pickup', requires: ['mobs', 'interaction', 'input', 'raycast', 'player', 'physics'],
    async run(t) {
      await t.call('startWorld', SURVIVAL);
      await t.call('setFlying', false);
      await t.call('waitTicks', 10);
      await t.call('setLook', 0, -55);
      const ec = await evBase(t, ['item:pickup']);
      const before = await t.eval(() => window.__game.game.inventory.count('dirt'));
      const br = await t.call('breakTarget', 6000);
      t.assert(br.ok, `broke a block (${JSON.stringify(br)})`);
      await t.call('runTicks', 40);
      const after = await t.eval(() => window.__game.game.inventory.count('dirt'));
      t.assert(after === before + 1, `+1 dirt (${before} -> ${after})`);
      t.assert(await ec('item:pickup') >= 1, 'item:pickup');
      // LEAD regression: the random pop sometimes rolled the drop to the far side of the hole, out of reach
      // (mobs-pickup flaked in the full suite). Every pop direction must still be picked up.
      const misses = await t.eval(async ({ x, y, z }) => {
        const g = window.__game.game, out = [];
        for (const [vx, vz] of [[0, -0.1], [0.1, -0.1], [-0.1, -0.1], [0.1, 0], [-0.1, 0], [0, 0.1]]) {
          const n0 = g.inventory.count('dirt');
          // what interaction.breakBlock's dropItem() spawns, with a chosen pop direction
          const e = g.entities.spawn('item', x + 0.5, y + 0.375, z + 0.5, { stack: { item: 'dirt', count: 1 }, vx, vy: 0.2, vz, delay: 10, reason: 'drop' });
          if (!e) { out.push('no item entity'); break; }
          g.stepTicks(40);
          if (g.inventory.count('dirt') !== n0 + 1) out.push(`${vx},${vz}`);
        }
        return out;
      }, br);
      t.assert(misses.length === 0, `drops in the dug hole are picked up from every side (missed ${misses.join(' ')})`);
    },
  },
  {
    name: 'mobs-wolf-tame', requires: ['mobs', 'interaction', 'input', 'player', 'physics'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      await t.call('setRandomSeed', 4242);
      const id = await spawnNear(t, 'wolf', 0, -3);
      await t.call('setSlot', 0, 'bone', 16);
      await t.call('selectSlot', 0);
      let r = null;
      for (let i = 0; i < 16; i++) { r = await t.call('interactEntity', id, 'use'); if (r.data.tamed) break; }
      t.assert(r && r.data.tamed, 'tamed with bones');
      t.assert(r.data.sitting, 'sits after taming');
      await t.eval(() => { const g = window.__game.game; g.inventory.set(g.inventory.selected, null); });
      r = await t.call('interactEntity', id, 'use');
      t.assert(!r.data.sitting, 'tap makes it stand up');
    },
  },
  {
    name: 'mobs-kid-no-death', requires: ['mobs', 'interaction', 'input', 'player', 'physics'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const ec = await evBase(t, ['mob:hurt', 'mob:death']);
      const id = await spawnNear(t, 'pig', 0, -2.5);
      for (let i = 0; i < 20; i++) {
        const p = await ent(t, id);
        await t.call('teleport', p.x, p.y, p.z + 2.5);
        await t.call('interactEntity', id, 'attack');
        await t.call('runTicks', 11);
      }
      const pig = await ent(t, id);
      t.assert(pig && pig.health === 10, `health unchanged (${pig && pig.health})`);
      t.assert(await ec('mob:hurt') >= 15, `hits registered (${await ec('mob:hurt')})`);
      t.assert(await ec('mob:death') === 0, 'no deaths');
    },
  },
  {
    name: 'mobs-no-pileup', requires: ['mobs'],
    async run(t) {
      // the stub world streams columns (load/unload) end to end, so this runs today
      await t.call('startWorld', { preset: 'default', seed: 12345, mode: 'creative', difficulty: 'peaceful' });
      const rd0 = await t.eval(() => window.__game.game.settings.renderDistance);
      await t.call('setSetting', 'renderDistance', 6);
      const home = await t.call('pos');
      const sample = () => t.eval(() => window.__game.game.mobs.counts().creature);
      let max = await sample();
      const spawnsChunkgen = [];
      // LEAD (integration): wait until the new area has really streamed in (meshed ring done and no new column
      // populated for a while) - a fixed 60 frames was too short in a loaded full suite, so a column first loaded
      // in round 2 looked like a repopulated one. The render distance is pinned so auto quality cannot add a ring.
      const settle = async () => {
        let last = -1, quiet = 0;
        const end = Date.now() + 20000;
        while (Date.now() < end && quiet < 8) {
          await t.call('waitFrames', 5);
          max = Math.max(max, await sample());
          const s = await t.eval(() => { const g = window.__game.game; return { pop: g.mobs.populatedCount(), un: g.world.unmeshedWithin(g.world.renderDistance + 1) }; });
          if (s.pop === last && s.un === 0) quiet++; else { quiet = 0; last = s.pop; }
        }
      };
      await t.eval(() => { const g = window.__game.game; g.__cg = 0; g.events.on('entity:spawn', (e) => { if (e.reason === 'chunkgen') g.__cg++; }); });
      await settle();
      for (let round = 0; round < 3; round++) {
        await t.call('teleport', home.x + 320, home.y + 20, home.z);
        await settle();
        await t.call('teleport', home.x, home.y + 20, home.z);
        await settle();
        spawnsChunkgen.push(await t.eval(() => window.__game.game.__cg));
      }
      await t.call('setSetting', 'renderDistance', rd0);
      t.note('maxCreatures', max);
      t.note('chunkgenSpawnsAfterEachRound', spawnsChunkgen);
      t.note('populated', await t.eval(() => window.__game.game.mobs.populatedCount()));
      t.assert(max <= 24, `never more than 24 creatures loaded (${max})`);
      t.assert(spawnsChunkgen[0] > 0, 'chunk generation spawned some animals');
      t.assert(spawnsChunkgen[1] === spawnsChunkgen[0] && spawnsChunkgen[2] === spawnsChunkgen[0], `revisited columns never repopulate (${spawnsChunkgen})`);
      const cache = await t.eval(() => window.__game.game.mobs.renderStats());
      t.assert(cache.geometries <= 40 && cache.materials <= 64, `shared render caches stay bounded (${JSON.stringify(cache)})`);
    },
  },
  {
    name: 'mobs-step-up', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const p = await t.call('pos');
      const bx = Math.floor(p.x), bz = Math.floor(p.z);
      await t.eval(({ bx, bz }) => { const g = window.__game.game; for (let x = bx - 3; x <= bx + 3; x++) for (let z = bz - 9; z <= bz - 5; z++) g.world.setBlock(x, 4, z, 1, 0, { cause: 'test' }); }, { bx, bz });
      await t.call('setRandomSeed', 3);
      const id = await spawnNear(t, 'pig', 0, -2);
      // the child holds a carrot standing on the ledge: the pig follows and must hop up
      await t.call('teleport', p.x, 5, p.z - 8);
      await t.call('setSlot', 0, 'carrot', 1);
      await t.call('selectSlot', 0);
      let up = false;
      for (let i = 0; i < 10 && !up; i++) { await t.call('runTicks', 10); up = (await ent(t, id)).y >= 4.99; }
      t.assert(up, 'pig got over the 1-block ledge within 100 ticks');
    },
  },

  /* ---------------------------------------------------------------- direct twins (run while CORE-E is a stub) */
  {
    name: 'mobs-breeding-direct', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const ec = await evBase(t, ['mob:love']);
      const a = await spawnNear(t, 'cow', 2, -3), b = await spawnNear(t, 'cow', -2, -3);
      for (const id of [a, b]) {
        const r = await t.eval((id) => window.__game.game.mobs.useOn(id, 'wheat'), id);
        t.assert(r.ok && r.data.love > 0, 'fed wheat -> love');
      }
      t.assert(await ec('mob:love') === 2, 'mob:love x2');
      await t.call('runTicks', 200);
      const babies = await t.eval(() => window.__game.game.entities.ofType('cow').filter((e) => e.data.baby).length);
      t.assert(babies === 1, `baby cow within 200 ticks (${babies})`);
      const ev = await t.call('events', 'entity:spawn', 5);
      t.assert(ev.some((e) => e.payload.reason === 'breed'), 'entity:spawn reason breed');
      await t.call('setLook', 0, -25);
      await t.call('waitFrames', 3);
      await t.shot('mobs-breeding');
    },
  },
  {
    name: 'mobs-pickup-direct', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', SURVIVAL);
      await t.call('setFlying', false);
      const p = await t.call('pos');
      const before = await t.eval(() => window.__game.game.inventory.count('dirt'));
      const ok = await t.eval(({ x, z }) => window.__game.game.interaction.breakBlock(Math.floor(x) + 1, 3, Math.floor(z), { by: 'player' }), p);
      t.assert(ok, 'breakBlock');
      const items = await t.eval(() => window.__game.game.entities.ofType('item').length);
      t.assert(items === 1, `one item entity dropped (${items})`);
      await t.call('runTicks', 30);
      await t.call('teleport', p.x + 0.8, p.y, p.z);   // the child walks up to the drop
      await t.call('runTicks', 20);
      const after = await t.eval(() => window.__game.game.inventory.count('dirt'));
      t.assert(after === before + 1, `+1 dirt (${before} -> ${after})`);
      const ev = await t.call('events', 'item:pickup', 1);
      t.assert(ev[0] && ev[0].payload.item === 'dirt' && ev[0].payload.count === 1, 'item:pickup {dirt, 1}');
      t.assert(await t.eval(() => window.__game.game.entities.ofType('item').length) === 0, 'item entity gone');
    },
  },
  {
    name: 'mobs-wolf-tame-direct', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      await t.call('setRandomSeed', 4242);
      const id = await spawnNear(t, 'wolf', 0, -3);
      let r = null, n = 0;
      for (; n < 20; n++) { r = await t.eval((id) => window.__game.game.mobs.useOn(id, 'bone'), id); if (r.data.tamed) break; }
      t.assert(r.data.tamed, `tamed after ${n + 1} bones`);
      t.note('bones', n + 1);
      t.assert(r.data.sitting && r.health === 40, 'sits, 40 HP');
      r = await t.eval((id) => window.__game.game.mobs.useOn(id, null), id);
      t.assert(!r.data.sitting, 'stands');
      const p = await t.call('pos');
      await t.call('teleport', p.x + 30, p.y, p.z);
      await t.call('runTicks', 20);
      const w = await ent(t, id);
      t.assert(Math.hypot(w.x - (p.x + 30), w.z - p.z) < 5, 'teleports to the player beyond 12 blocks');
      await t.call('setLook', 90, -20);
      await t.call('waitFrames', 3);
      await t.shot('mobs-wolf');
    },
  },
  {
    name: 'mobs-kid-no-death-direct', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const ec = await evBase(t, ['mob:hurt', 'mob:death']);
      const id = await spawnNear(t, 'pig', 0, -3);
      for (let i = 0; i < 20; i++) { await t.eval((id) => window.__game.game.mobs.hit(id, 7), id); await t.call('runTicks', 11); }
      const pig = await ent(t, id);
      t.assert(pig && !pig.removed && pig.health === 10, `kid world: pig unhurt (${pig && pig.health})`);
      t.assert(await ec('mob:hurt') === 20 && await ec('mob:death') === 0, `hop + squeak, no death (${await ec('mob:hurt')} hurt)`);
      await t.call('setRule', 'animalsCanDie', true);
      const id2 = await spawnNear(t, 'pig', 2, -3);
      for (let i = 0; i < 3; i++) { await t.eval((id) => window.__game.game.mobs.hit(id, 4), id2); await t.call('runTicks', 11); }
      await t.call('runTicks', 25);
      t.assert(await ent(t, id2) === null, 'with the rule off a pig can die');
      t.assert(await ec('mob:death') === 1, 'mob:death');
    },
  },
  {
    name: 'mobs-sheep', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const ec = await evBase(t, ['mobs:rainbow']);
      const id = await spawnNear(t, 'sheep', 0, -3, { color: 'white' });
      let r = await t.eval((id) => window.__game.game.mobs.useOn(id, 'shears'), id);
      t.assert(r.ok && r.data.sheared, 'sheared');
      const wool = await t.eval(() => window.__game.game.entities.ofType('item').filter((e) => e.data.stack.item === 'white_wool').length);
      t.assert(wool >= 1 && wool <= 3, `1-3 wool (${wool})`);
      await t.eval((id) => { window.__game.game.entities.get(id).data.sheared = false; }, id);
      for (const c of ['red', 'yellow', 'blue']) { r = await t.eval(({ id, c }) => window.__game.game.mobs.useOn(id, c + '_dye'), { id, c }); await t.call('runTicks', 5); }
      t.assert(r.data.rainbow, 'rainbow sheep');
      t.assert(await ec('mobs:rainbow') === 1, 'mobs:rainbow event');
      await t.call('setLook', 0, -25);
      await t.call('waitFrames', 3);
      await t.shot('mobs-sheep');
      await t.eval((id) => window.__game.game.mobs.useOn(id, 'shears'), id);
      await t.call('runTicks', 4000);
      t.assert(!(await ent(t, id)).data.sheared, 'wool regrows after grazing');
    },
  },
  {
    name: 'mobs-survival', requires: ['mobs', 'survival'],
    async run(t) {
      await t.call('startWorld', SURVIVAL);
      await t.call('setFlying', false);
      const ec = await evBase(t, ['player:ate', 'player:death']);
      const land = (blockId) => t.eval((blockId) => window.__game.game.events.emit('player:land', { fallDistance: 10, x: 0, y: 4, z: 0, blockId }), blockId);
      await land(await t.call('blockId', 'grass_block'));
      t.assert((await t.call('pos')).health === 13, '10-block fall costs 7');
      await t.call('runTicks', 12);
      await t.eval(() => { window.__game.game.player.health = 20; });
      await land(await t.call('blockId', 'hay_block'));
      t.assert((await t.call('pos')).health === 18, 'hay softens the fall');
      t.assert(await t.eval(() => window.__game.game.survival.damage(4, 'void')) === false, 'void rescue on: no void damage');
      // eating with a single tap (kid scheme)
      await t.eval(() => { const g = window.__game.game; g.player.food = 8; g.player.saturation = 0; g.inventory.set(g.inventory.selected, { item: 'bread', count: 3 }); });
      t.assert(await t.eval(() => { const g = window.__game.game; return window.__game.game.survival.startEating({ game: g, player: g.player, stack: g.inventory.getSelected(), slot: g.inventory.selected, hit: null }); }), 'started eating');
      await t.call('runTicks', 33);
      t.assert((await t.call('pos')).food === 13, 'bread +5 hunger');
      t.assert(await ec('player:ate') === 1, 'player:ate');
      // death -> immediate respawn with keep-inventory
      await t.eval(() => { const g = window.__game.game; g.inventory.set(5, { item: 'diamond', count: 3 }); g.survival.damage(99, 'mob'); });
      t.assert(await ec('player:death') === 1, 'player:death');
      await t.call('runTicks', 22);
      const p = await t.call('pos');
      t.assert(p.health === 20 && p.food === 20, 'respawned full');
      t.assert(await t.eval(() => window.__game.game.inventory.count('diamond')) === 3, 'kept inventory');
    },
  },
  {
    name: 'mobs-monsters', requires: ['mobs', 'survival'],
    async run(t) {
      await t.call('startWorld', { ...SURVIVAL, rules: { passiveMobs: false, hostileMobs: true } });
      await t.call('setTime', 18000);
      const ec = await evBase(t, ['explosion']);
      await spawnNear(t, 'zombie', 0, -6);
      let hurt = false;
      for (let i = 0; i < 20 && !hurt; i++) { await t.call('runTicks', 15); hurt = (await t.call('pos')).health < 20; }
      t.assert(hurt, 'zombie reached and hit the player');
      await t.eval(() => { const g = window.__game.game; for (const e of g.entities.ofType('zombie')) g.entities.remove(e, 'test'); g.player.health = 20; });
      await t.call('runTicks', 12);
      const cid = await spawnNear(t, 'creeper', 0, -2.5);
      await t.call('runTicks', 10);
      await t.call('setLook', 0, -15);
      await t.call('waitFrames', 2);
      await t.shot('mobs-creeper-fuse');
      await t.call('runTicks', 50);
      t.assert(await ent(t, cid) === null, 'creeper exploded');
      t.assert(await ec('explosion') === 1, 'explosion event');
      t.assert(await t.eval(() => window.__game.game.events.recent('player:hurt', 5).some((e) => e.payload.cause === 'explosion')), 'the blast hurt the player');
      await t.eval(() => { const g = window.__game.game; g.__arrows = 0; g.events.on('entity:spawn', (e) => { if (e.type === 'arrow') g.__arrows++; }); });
      await spawnNear(t, 'skeleton', 3, -10);
      let arrows = 0;
      for (let i = 0; i < 10 && !arrows; i++) { await t.call('runTicks', 15); arrows = await t.eval(() => window.__game.game.__arrows); }
      t.assert(arrows > 0, 'skeleton shoots arrows');
      await t.call('setDifficulty', 'peaceful');
      t.assert(await t.eval(() => window.__game.game.mobs.counts().monster) === 0, 'peaceful removes monsters');
    },
  },
  {
    name: 'mobs-ride', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const id = await spawnNear(t, 'pig', 0, -2.5);
      let r = await t.eval((id) => window.__game.game.mobs.useOn(id, 'saddle'), id);
      t.assert(r.data.saddled, 'saddled');
      r = await t.eval((id) => window.__game.game.mobs.useOn(id, 'carrot_on_a_stick'), id);
      t.assert(await t.eval(() => window.__game.game.player.riding) === id, 'riding the pig');
      await t.call('setLook', 90, 0);   // look west
      const p0 = await t.call('pos');
      await t.call('runTicks', 60);
      const p1 = await t.call('pos');
      t.assert(p1.x < p0.x - 2, `pig carried the rider west (${(p0.x - p1.x).toFixed(2)})`);
      await t.call('hold', 'descend', 200);
      t.assert(await t.eval(() => window.__game.game.player.riding) === null, 'dismounted');
      // boat on a pond
      const q = await t.call('pos');
      const water = await t.call('blockId', 'water');
      await t.eval(({ x, z, water }) => { const g = window.__game.game; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) g.world.setBlock(Math.floor(x) + i, 3, Math.floor(z) - 8 + j, water, 0, { cause: 'test' }); }, { ...q, water });
      const bid = await t.eval(({ x, z }) => { const g = window.__game.game; const b = g.entities.spawn('boat', Math.floor(x) + 0.5, 4.5, Math.floor(z) - 7.5, {}); return b.id; }, q);
      await t.call('runTicks', 60);
      const b = await t.eval((id) => { const e = window.__game.game.entities.get(id); return { y: e.y }; }, bid);
      t.assert(Math.abs(b.y - (4 - 0.12)) < 0.2, `boat floats on the surface (y ${b.y.toFixed(2)})`);
    },
  },
  {
    name: 'mobs-persist', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      await spawnNear(t, 'wolf', 2, -3, { tamedBy: 'player' });
      const sid = await spawnNear(t, 'sheep', -2, -3, { color: 'purple' });
      await t.eval((id) => window.__game.game.mobs.useOn(id, 'shears'), sid);
      await spawnNear(t, 'chicken', 0, -4, { baby: true });
      const meta = await t.eval(() => {
        const g = window.__game.game;
        const m = JSON.parse(JSON.stringify(g.meta));
        for (const s of g.systems) if (s.serialize) { try { m.systems[s.name] = JSON.parse(JSON.stringify(s.serialize(g))); } catch { /* stub */ } }
        return m;
      });
      await t.call('exitToTitle');
      t.assert(await t.eval(() => window.__game.game.entities.all().length) === 0, 'no entity leak after exitToTitle');
      await t.eval((meta) => window.__game.game.startWorld({ meta, columns: null }), meta);
      const list = await t.call('entities');
      const wolf = list.find((e) => e.type === 'wolf'), sheep = list.find((e) => e.type === 'sheep'), chick = list.find((e) => e.type === 'chicken');
      t.assert(wolf && wolf.data.tamed && wolf.health === 40, 'tamed wolf restored');
      t.assert(sheep && sheep.data.color === 'purple' && sheep.data.sheared, 'sheared purple sheep restored');
      t.assert(chick && chick.data.baby, 'baby chicken restored');
    },
  },
  // ---------------------------------------------------------------- judge round 1 (FID-1, KID-3/6/7, FID-10/12, ROB-8)
  {
    name: 'mobs-skeleton-aim', requires: ['mobs', 'survival'],
    async run(t) {
      // a player standing still 6, 10 and 14 blocks from a skeleton on Normal takes at least 1 hit per 3 arrows
      await t.call('startWorld', { preset: 'flat', seed: 777, mode: 'survival', difficulty: 'normal', rules: { passiveMobs: false, hostileMobs: true, daylightCycle: false } });
      await t.call('setFlying', false);
      await t.call('setTime', 18000);
      const res = await t.eval(() => {
        const g = window.__game.game, p = g.player;
        const X = Math.floor(p.x) + 0.5, Y = p.y, Z = Math.floor(p.z) + 0.5;
        const out = [];
        let hits = 0, arrows = 0;
        const off = g.events.on('player:hurt', (e) => { if (e.cause === 'arrow') hits++; });
        const offA = g.events.on('entity:spawn', (e) => { if (e.type === 'arrow') arrows++; });
        for (const dist of [6, 10, 14]) {
          for (const e of g.entities.all()) g.entities.remove(e, 'test');
          hits = 0; arrows = 0;
          g.player.teleport(X, Y, Z, 'test');
          g.mobs.spawnMob('skeleton', X, Y, Z - dist, {});
          for (let i = 0; i < 200; i++) { g.player.health = 20; g.player.food = 20; g.player.teleport(X, Y, Z, 'test'); g.stepTicks(1); }
          out.push({ dist, arrows, hits });
        }
        off(); offA();
        for (const e of g.entities.all()) g.entities.remove(e, 'test');
        return out;
      });
      t.note('arrows', res);
      for (const r of res) t.assert(r.arrows >= 3 && r.hits * 3 >= r.arrows, `skeleton at ${r.dist} blocks: ${r.hits} hits from ${r.arrows} arrows (>= 1 per 3)`);
    },
  },
  {
    name: 'mobs-kid-ride-pet-horse', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const riding = () => t.eval(() => window.__game.game.player.riding);
      // KID-3: saddle tap, then a second tap with the saddle still in hand rides the pig
      const pig = await spawnNear(t, 'pig', 0, -2.5);
      let r = await t.eval((id) => window.__game.game.mobs.useOn(id, 'saddle'), pig);
      t.assert(r.data.saddled && await riding() === null, 'first saddle tap saddles only');
      await t.eval((id) => window.__game.game.mobs.useOn(id, 'saddle'), pig);
      t.assert(await riding() === pig, 'second saddle tap rides the saddled pig');
      await t.call('hold', 'descend', 200);
      t.assert(await riding() === null, 'off the pig');
      // KID-6: empty-hand pet -> mob:petted, no love, no hurt
      const ec = await evBase(t, ['mob:petted']);
      const sheep = await spawnNear(t, 'sheep', 3, -3);
      r = await t.eval((id) => window.__game.game.mobs.useOn(id, null), sheep);
      t.assert(r.ok && await ec('mob:petted') === 1 && !(r.data.love > 0) && r.health === 8, 'empty-hand tap pets the sheep');
      // KID-7: a kid-world horse is tamed by the first mount; Space gets off while it has no saddle
      const horse = await spawnNear(t, 'horse', -3, -4);
      r = await t.eval((id) => window.__game.game.mobs.useOn(id, null), horse);
      t.assert(r.data.tamed && await riding() === horse, 'kid world: first tap tames + mounts the horse');
      t.assert(await t.eval((id) => window.__game.game.entities.get(id).wishTicks > 0, horse), 'unsaddled tamed horse asks for a saddle');
      await t.call('hold', 'jump', 200);
      t.assert(await riding() === null, 'Space gets off an unsaddled horse');
    },
  },
  {
    name: 'mobs-sheared-dye', requires: ['mobs'],
    async run(t) {
      await t.call('startWorld', NO_SPAWN);
      const id = await spawnNear(t, 'sheep', 0, -3, { color: 'white' });
      await t.eval((id) => window.__game.game.mobs.useOn(id, 'shears'), id);
      const r = await t.eval((id) => window.__game.game.mobs.useOn(id, 'blue_dye'), id);
      t.assert(r.ok && r.data.sheared && r.data.color === 'blue', 'a sheared sheep takes the dye');
      await t.eval((id) => window.__game.game.entities.get(id).eatGrass(), id);
      const e = await ent(t, id);
      t.assert(!e.data.sheared && e.data.color === 'blue', 'its wool grows back blue');
    },
  },
  {
    name: 'mobs-egg-cap', requires: ['mobs'],
    async run(t) {
      // 300 pig-egg uses keep the living mobs <= 64 and the mob tick <= 3 ms
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const res = await t.eval(() => {
        const g = window.__game.game, inv = g.inventory, p = g.player;
        let refused = 0;
        const off = g.events.on('mobs:eggRefused', () => refused++);
        for (let i = 0; i < 300; i++) {
          inv.set(inv.selected, { item: 'pig_spawn_egg', count: 1 });
          const hit = { x: Math.floor(p.x) + (i % 9) - 4, y: Math.floor(p.y) - 1, z: Math.floor(p.z) - 3 - (Math.floor(i / 9) % 8), nx: 0, ny: 1, nz: 0, face: 2 };
          g.mobs.useEgg('pig', { game: g, player: p, stack: inv.getSelected(), slot: inv.selected, hit });
        }
        off();
        const n = g.entities.all().filter((e) => e.def && !e.removed).length;
        const t0 = performance.now();
        for (let i = 0; i < 100; i++) { g.entities.tick(g); g.mobs.tick(g); }
        return { n, refused, tickMs: (performance.now() - t0) / 100 };
      });
      t.note('eggCap', res);
      t.assert(res.n <= 64 && res.n >= 60, `living mobs capped at 64 (${res.n})`);
      t.assert(res.refused >= 230, `extra eggs refused (${res.refused})`);
      t.assert(res.tickMs <= 3, `mob tick ${res.tickMs.toFixed(2)} ms <= 3`);
    },
  },
  {
    name: 'mobs-xp-sources', requires: ['mobs', 'survival', 'interaction'],
    async run(t) {
      await t.call('startWorld', { ...SURVIVAL, difficulty: 'peaceful' });
      await t.call('setFlying', false);
      const r = await t.eval(() => {
        const g = window.__game.game, p = g.player, X = Math.floor(p.x), Z = Math.floor(p.z), id = (n) => window.__game.blockId(n);
        const xp = () => p.xp || 0;
        const out = {};
        // diamond ore broken by the player with an iron pickaxe (drops) -> 3-7 XP; by hand (no drops) -> none
        g.world.setBlock(X, 4, Z - 3, id('diamond_ore'), 0, { cause: 'test' });
        const x0 = xp();
        g.interaction.breakBlock(X, 4, Z - 3, { by: 'player', toolDef: { type: 'pickaxe', level: 3, speed: 6 } });
        g.stepTicks(60);
        out.diamond = xp() - x0;
        g.world.setBlock(X, 4, Z - 3, id('diamond_ore'), 0, { cause: 'test' });
        const x1 = xp();
        g.interaction.breakBlock(X, 4, Z - 3, { by: 'player', toolDef: null });
        g.stepTicks(60);
        out.byHand = xp() - x1;
        // furnace: 4 raw iron smelted; taking the output pops 0.7 x 4 = 2.8 -> 2 or 3 XP at the player
        g.world.setBlock(X + 2, 4, Z, id('furnace'), 0, { cause: 'test' });
        g.world.setBlockEntity(X + 2, 4, Z, { type: 'furnace', input: { item: 'raw_iron', count: 4 }, fuel: { item: 'coal', count: 1 }, output: null, burnTicks: 0, burnTotal: 0, cookTicks: 0, xp: 0 });
        g.events.emit('block:use', { x: X + 2, y: 4, z: Z, id: id('furnace'), hook: 'furnace' });
        g.stepTicks(820);
        const be2 = g.world.getBlockEntity(X + 2, 4, Z);
        out.smelted = be2 && be2.output ? be2.output.count : 0;
        const x2 = xp();
        g.inventory.add(be2.output); be2.output = null;
        g.stepTicks(60);
        out.smeltXp = xp() - x2;
        return out;
      });
      t.note('xp', r);
      t.assert(r.diamond >= 3 && r.diamond <= 7, `diamond ore gives 3-7 XP (${r.diamond})`);
      t.assert(r.byHand === 0, 'no drops, no XP');
      t.assert(r.smelted === 4 && (r.smeltXp === 2 || r.smeltXp === 3), `taking 4 iron ingots gives 2-3 XP (${r.smeltXp})`);
    },
  },
  {
    name: 'mobs-new-kinds', requires: ['mobs'],
    async run(t) {
      // judge FID-6: ten more mob kinds - each is one draw call, lives 100 ticks without errors, fish stay in water
      // (the slime stands 30+ blocks from the iron golem, which would otherwise fight it)
      await t.call('startWorld', NO_SPAWN);
      await t.call('setFlying', false);
      const p = await t.call('pos');
      const ids = await t.eval(({ x, y, z }) => {
        const g = window.__game.game, W = window.__game.blockId('water');
        g.setDifficulty('easy'); g.setRule('hostileMobs', true);
        for (let i = -3; i <= 3; i++) for (let k = -2; k <= 1; k++) for (let yy = 1; yy <= 3; yy++) g.world.setBlock(Math.floor(x) - 12 + i, yy, Math.floor(z) - 8 + k, W, 0, { cause: 'test' });
        const row = [['cod', -14, 2.2, -8], ['tropical_fish', -12, 2.2, -8], ['squid', -10.5, 1.4, -8.5], ['rabbit', -6, 4, -8], ['fox', -3.5, 4, -8], ['bee', -1, 5.5, -8],
          ['enderman', 2, 4, -9, { carried: 'sand' }], ['slime', -22, 4, -8, { size: 2 }], ['villager', 8, 4, -8, { variant: 'cleric' }], ['iron_golem', 11.5, 4, -9]];
        const out = [];
        for (const [type, dx, yy, dz, o] of row) { const e = g.mobs.spawnMob(type, x + dx, yy, z + dz, o || {}); if (e) out.push(e.id); }
        return out;
      }, p);
      t.assert(ids.length === 10, `all ten new kinds spawned (${ids.length})`);
      await t.call('setLook', 0, -10);
      await t.call('runTicks', 100);
      await t.call('waitFrames', 3);
      const all = await t.eval((ids) => ids.map((id) => { const e = window.__game.game.entities.get(id); return e ? e.type + (e.removed ? ':removed' : '') + (e.object3d ? '' : ':nomesh') : 'gone:' + id; }), ids);
      t.note('kinds', all);
      const alive = await t.eval((ids) => ids.map((id) => window.__game.game.entities.get(id)).filter((e) => e && !e.removed && e.object3d).map((e) => ({ type: e.type, inWater: !!e.inWater, water: !!(e.def && e.def.water) })), ids);
      t.assert(alive.length === 10, `all ten alive with a mesh after 100 ticks (${alive.length})`);
      t.assert(alive.filter((a) => a.water).every((a) => a.inWater), 'fish and squid are still in the pond');
      const setVis = (v) => t.eval((v) => { for (const e of window.__game.game.entities.all()) if (e.object3d) e.object3d.visible = v; }, v);
      // LEAD (integration): the pond edit leaves hot sections that fold back into their column a few seconds later,
      // and streaming may still add sections; either changes the terrain's draw count between the two captures.
      await settleRenderer(t);
      let entityDraws = Infinity;
      for (let i = 0; i < 4; i++) {
        await setVis(false); await t.call('waitFrames', 3);
        const without = (await t.call('stats')).drawCalls;
        await setVis(true); await t.call('waitFrames', 3);
        entityDraws = Math.min(entityDraws, (await t.call('stats')).drawCalls - without);
      }
      t.note('entityDraws', entityDraws);
      t.assert(entityDraws <= 10 + 2, `about one draw call per mob (${entityDraws})`);
      await t.shot('mobs-new-kinds');
    },
  },
];
