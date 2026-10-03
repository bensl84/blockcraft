// OWNER LANE: FEATURE-MOBS (mobs + entities + survival damage). STUB written by LEAD - API FROZEN (SPEC §8.1).
// Implement: mob entity types for every MOBS entry (src/data/mobs.js) registered with registerEntityType,
// box models + original procedural skins (textures/toolkit.js), walk/idle/hurt/death animation, AI (wander,
// look at player, panic, tempt, breed + babies, wolf/cat taming sit/follow/teleport, sheep shear/dye/regrow,
// chicken eggs, pig/horse riding (P1), hostile AI (P1) + sun burning), spawning (chunk-gen animals, monster
// cycles, caps, despawn), mob interaction hooks (hooks.registerEntityInteract), spawn eggs (hooks.registerItemUse).
//
// Stub behaviour: nothing spawns.

import { registerStub } from '../core/stubs.js';
import { MOBS } from '../data/mobs.js';

registerStub('mobs');

/** @returns {object} Mobs system (game.mobs) */
export function createMobsSystem(game) {
  const sys = {
    name: 'mobs',
    stub: true,
    init() {},
    /**
     * Spawn a mob of `type` (key of MOBS) at feet position. opts: {baby?: boolean, color?: string (sheep),
     * tamedBy?: 'player', variant?: string}. Returns the Entity or null.
     */
    spawnMob(type, x, y, z, opts = {}) {
      if (!MOBS[type]) return null;
      return game.entities.spawn(type, x, y, z, opts);
    },
    /** Counts by category within the loaded area: {creature, monster}. */
    counts() { return { creature: 0, monster: 0 }; },
    tick() {},
    frame() {},
  };
  return sys;
}
