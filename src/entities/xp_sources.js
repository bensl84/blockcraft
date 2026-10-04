// OWNER LANE: FEATURE-MOBS (XP orbs). Experience from blocks and furnaces (judge FID-12, Java values):
//  - ores mined by the player with drops (right tool, survival): blocks.js `xp: [min, max]` (coal 0-2, lapis 2-5,
//    redstone 1-5, diamond / emerald 3-7), orbs at the block centre;
//  - smelting: INV's furnace banks recipe XP in its block entity (`be.xp`, fractional). When the player takes items
//    out of the output slot the whole bank pops at the player (Java awards every stored recipe on a take);
//    breaking the furnace pops it at the furnace. Fractions round up with their own probability (Java).
// Breeding XP (1-7) is spawned by Mob.breedWith; kills by Mob.dropLoot.

import { blockDef, blockName } from '../core/registry.js';
import { randInt } from './mob_ai.js';

const FURNACE_CHECK_TICKS = 4;

/** Whole XP points from a fractional amount: floor + (rand < frac ? 1 : 0). */
export function roundXp(amount, rand) {
  const n = Math.floor(amount);
  return n + (rand() < amount - n ? 1 : 0);
}

export function createXpSources(game) {
  /** furnace cell key -> output count last seen (only furnaces the player used or that smelted since load) */
  const furnaces = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const isFurnace = (id) => /^furnace/.test(blockName(id));
  const survival = () => !!game.meta && !game.isCreative();
  const spawn = (x, y, z, n) => { if (n > 0 && game.mobs && game.mobs.spawnXp) game.mobs.spawnXp(x, y, z, n); };

  function popFurnace(be, x, y, z) {
    if (!be || !(be.xp > 0)) return 0;
    const n = roundXp(be.xp, () => game.rand());
    be.xp = 0;
    spawn(x, y, z, n);
    return n;
  }

  function track(x, y, z) {
    const be = game.world && game.world.getBlockEntity ? game.world.getBlockEntity(x, y, z) : null;
    if (!be || be.type !== 'furnace') return;
    furnaces.set(key(x, y, z), { x, y, z, out: be.output ? be.output.count : 0 });
  }

  return {
    init() {
      game.events.on('block:broken', (e) => {
        if (!e || !survival()) return;
        if (e.blockEntity && e.blockEntity.type === 'furnace') {
          furnaces.delete(key(e.x, e.y, e.z));
          popFurnace(e.blockEntity, e.x + 0.5, e.y + 0.5, e.z + 0.5);
        }
        if (e.by !== 'player' || !e.drops || !e.drops.length) return;
        const d = blockDef(e.id);
        if (!d || !Array.isArray(d.xp)) return;
        spawn(e.x + 0.5, e.y + 0.5, e.z + 0.5, randInt(() => game.rand(), d.xp[0], d.xp[1]));
      });
      game.events.on('smelt', (e) => { if (e && Number.isFinite(e.x)) track(e.x, e.y, e.z); });
      game.events.on('block:use', (e) => { if (e && isFurnace(e.id)) track(e.x, e.y, e.z); });
      game.events.on('world:exit', () => furnaces.clear());
    },
    tick() {
      if (!furnaces.size || game.tickCount % FURNACE_CHECK_TICKS) return;
      const p = game.player;
      for (const [k, f] of furnaces) {
        const be = game.world.getBlockEntity(f.x, f.y, f.z);
        if (!be || be.type !== 'furnace') { furnaces.delete(k); continue; }
        const out = be.output ? be.output.count : 0;
        // the output went down: the player took smelted items -> the whole bank pops at the player
        if (out < f.out && be.xp > 0 && p && !p.dead) popFurnace(be, p.x, p.y + 0.5, p.z);
        f.out = out;
      }
    },
    /** Test/debug view. */
    tracked() { return furnaces.size; },
  };
}
