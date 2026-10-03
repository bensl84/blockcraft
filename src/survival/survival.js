// OWNER LANE: FEATURE-MOBS (mobs + entities + survival damage). STUB written by LEAD - API FROZEN (SPEC §8.1.4).
// Implement: health / hunger / saturation / exhaustion / regeneration / starvation (SPEC §2.4), damage with
// 10-tick invulnerability, fall damage (from 'player:land'), drowning, lava/fire, cactus, suffocation, void,
// eating (32 ticks, hooks.registerItemUse for foods), death -> 'player:death', respawn at bed/spawn, keep
// inventory rule, peaceful refill, golden apple effects. Game rules from game.meta.rules gate each damage type.
//
// Stub behaviour: nothing hurts; respawn() puts the player at the spawn point.

import { registerStub } from '../core/stubs.js';

registerStub('survival');

/** @returns {object} Survival system (game.survival) */
export function createSurvivalSystem(game) {
  const sys = {
    name: 'survival',
    stub: true,
    init() {},
    /**
     * Damage the player. cause: 'fall'|'drown'|'lava'|'fire'|'cactus'|'suffocate'|'void'|'starve'|'mob'|
     * 'explosion'|'arrow'|'generic'. source: {entity?} . Creative ignores everything except 'void'.
     * 'void' (feet below SURVIVAL.VOID_Y) returns false while rules.voidRescue is on (default, also in
     * survival): the kid lane rescues at y < 0 first. Returns true if damage was applied. Emits 'player:hurt'
     * {amount, cause, health}.
     */
    damage(amount, cause = 'generic', source = null) { return false; },
    /** Heal n half-hearts (clamped). Emits 'player:heal'. */
    heal(n) {},
    /** Add exhaustion (SURVIVAL.EXHAUST values). */
    addExhaustion(x) {},
    /** Can the player eat this food item right now? */
    canEat(itemKey) { return false; },
    /** Apply a food item's hunger/saturation/effects immediately (after the 32-tick eat). Emits 'player:eat'. */
    applyFood(itemKey) { return false; },
    /** Add hunger/saturation directly (cake slices). */
    addFood(hunger, saturation) {},
    /** Kill the player (cause). Emits 'player:death' {cause}. */
    kill(cause = 'generic') {},
    /** Respawn at bed/world spawn with full health/food. Emits 'player:respawn' {x,y,z}. */
    respawn() {
      const sp = game.player.spawnPoint;
      game.player.spawn(sp.x, sp.y, sp.z);
      game.events.emit('player:respawn', { x: sp.x, y: sp.y, z: sp.z });
    },
    tick() {},
    serialize() {
      const p = game.player;
      return { health: p.health, food: p.food, saturation: p.saturation, exhaustion: p.exhaustion, air: p.air, xp: p.xp, xpLevel: p.xpLevel, effects: p.effects };
    },
    deserialize(g, d) {
      if (!d) return;
      Object.assign(game.player, { health: d.health ?? 20, food: d.food ?? 20, saturation: d.saturation ?? 5, exhaustion: d.exhaustion ?? 0, air: d.air ?? 300, xp: d.xp ?? 0, xpLevel: d.xpLevel ?? 0, effects: d.effects || {} });
    },
  };
  return sys;
}
