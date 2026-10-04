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
      await setVis(false); await t.call('waitFrames', 3);
      const without = (await t.call('stats')).drawCalls;
      await setVis(true); await t.call('waitFrames', 3);
      const withEnt = (await t.call('stats')).drawCalls;
      const entityDraws = withEnt - without;
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
      const home = await t.call('pos');
      const sample = () => t.eval(() => window.__game.game.mobs.counts().creature);
      let max = await sample();
      const spawnsChunkgen = [];
      const settle = async () => { for (let i = 0; i < 12; i++) { await t.call('waitFrames', 5); max = Math.max(max, await sample()); } };
      await t.eval(() => { const g = window.__game.game; g.__cg = 0; g.events.on('entity:spawn', (e) => { if (e.reason === 'chunkgen') g.__cg++; }); });
      await settle();
      for (let round = 0; round < 3; round++) {
        await t.call('teleport', home.x + 320, home.y + 20, home.z);
        await settle();
        await t.call('teleport', home.x, home.y + 20, home.z);
        await settle();
        spawnsChunkgen.push(await t.eval(() => window.__game.game.__cg));
      }
      t.note('maxCreatures', max);
      t.note('chunkgenSpawnsAfterEachRound', spawnsChunkgen);
      t.note('populated', await t.eval(() => window.__game.game.mobs.populatedCount()));
      t.assert(max <= 24, `never more than 24 creatures loaded (${max})`);
      t.assert(spawnsChunkgen[0] > 0, 'chunk generation spawned some animals');
      t.assert(spawnsChunkgen[1] === spawnsChunkgen[0] && spawnsChunkgen[2] === spawnsChunkgen[0], `revisited columns never repopulate (${spawnsChunkgen})`);
      const cache = await t.eval(() => window.__game.game.mobs.renderStats());
      t.assert(cache.geometries <= 16 && cache.materials <= 64, `shared render caches stay bounded (${JSON.stringify(cache)})`);
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
];
