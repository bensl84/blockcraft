// OWNER LANE: FEATURE-MOBS (mobs + entities + survival damage). STUB written by LEAD - keep the signature.
// Dropped item entity ('item'): gravity 0.04 / drag 0.98, bob + spin render (FEATURE-FX makeItemMesh),
// 10-tick pickup delay (40 when thrown by the player), magnet toward the player within ~1.5 blocks once
// pickable, merge with nearby identical stacks, despawn after 5 minutes, 'item:pickup' {item,count} +
// pop sound, lava destroys. Registered with registerEntityType('item', ...) from createMobsSystem.init.
//
// Stub behaviour: returns null (nothing dropped). Callers must tolerate null.

import { registerStub } from '../core/stubs.js';

registerStub('items');

/**
 * Drop an ItemStack into the world as an entity.
 * @param {object} game
 * @param {import('../core/types.js').ItemStack} stack
 * @param {number} x @param {number} y @param {number} z  spawn position (centre)
 * @param {{vx?: number, vy?: number, vz?: number, pickupDelay?: number, thrower?: 'player'|null}} [opts]
 *        velocity in blocks/tick; default = small random pop (+0.2 up, +-0.1 sideways)
 * @returns {object|null} the item Entity
 */
export function dropItem(game, stack, x, y, z, opts = {}) {
  return null;
}
