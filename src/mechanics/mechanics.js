// OWNER LANE: FEATURE-MECH (block mechanics). STUB written by LEAD - API FROZEN (SPEC §8.6).
// Implement (may split into src/mechanics/*.js): scheduled block ticks + random ticks (3 per section per
// tick), support checks (torch/flower/door/crop/ladder/carpet/snow drop when support is removed), falling
// sand/gravel entities, TNT priming (flint&steel, fire, explosions; fuse 80, chain 10-30) + explosion ray
// algorithm + entity damage/knockback, fluids (water 5-tick flow, levels 0-7, infinite source; lava P1),
// lava+water -> obsidian/cobblestone/stone, farming (hoe, hydration, trampling, crop growth, bone meal,
// saplings -> worldgen placeTree), doors (two halves, toggle), beds (two halves, sleep -> skip night, set
// spawn; 'nap' when daylightCycle is off), cake bites, fire (never spreads by default), snow layers,
// sugar cane/cactus growth, fence/pane connection updates (registry.connectionState), fence gates,
// paintings (P1), and the P1 fidelity set: double slabs, stacking snow layers, leaf decay, grass spreading,
// sugar cane needing water, grass 'snowy' bit.
// Registers its behaviour through core/hooks.js and entity types through entities/entity.js.
//
// RULES (SPEC §8.6): every block removal goes through game.interaction.breakBlock (explosions included, with
// opts.dropInto so drops can be merged: at most 32 item entities per explosion); explosions, tree growth and
// fluid spreading wrap their edits in world.beginBatch()/endBatch(); follow-up changes (door halves, support
// breaks, fence updates) pass along the `action` of the 'block:changed' that caused them; gameplay rolls use
// game.rand().
//
// Stub behaviour: inert.

import { registerStub } from '../core/stubs.js';

registerStub('mechanics');

/** @returns {object} Mechanics system (game.mechanics) */
export function createMechanicsSystem(game) {
  return {
    name: 'mechanics',
    stub: true,
    init() {},
    tick() {},
    /**
     * Explode at (x,y,z) with power (TNT 4, creeper 3). opts: {source: 'tnt'|'creeper'|'test', breakBlocks?:
     * boolean (default rules.tntExplodes / mobGriefing), fire?: boolean}. Allocates ONE action id
     * (interaction.newAction) for all its breaks, batches them, merges drops (<= 32 item entities).
     * Emits 'explosion' {x, y, z, power, source, action, count, blocks: [{x, y, z, id, state}]}.
     * Returns the number of blocks destroyed.
     */
    explode(x, y, z, power, opts = {}) { return 0; },
    /** Replace a TNT block with a primed TNT entity (fuse ticks, default 80). Emits 'tnt:primed'. */
    primeTnt(x, y, z, fuse = 80) { return null; },
    /** Schedule a block update at (x,y,z) in `delay` ticks (fluids, falling blocks, support checks). */
    scheduleTick(x, y, z, delay) {},
    /** Grow the plant/crop/sapling at (x,y,z) as if bone-mealed. Returns true if anything grew. */
    applyBoneMeal(x, y, z) { return false; },
    /**
     * Try to sleep in the bed at (x,y,z). Returns {ok, nap, reason: 'not_night'|'monsters'|'too_far'|null}.
     * When rules.daylightCycle is false (kid default) every attempt is a "nap": ok + nap true, a short fade with
     * a starry sky, then back to 09:00 (KID_LOCKED_TIME). Emits 'sleep:start' / 'sleep:end' {nap}.
     */
    trySleep(x, y, z) { return { ok: false, nap: false, reason: 'not_night' }; },
    serialize() { return {}; },
    deserialize() {},
  };
}
