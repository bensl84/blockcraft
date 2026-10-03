// OWNER LANE: CORE-E (player/physics/input/raycast/interaction). STUB written by LEAD - keep the signature.
// Spec: SPEC §7.3 (Amanatides & Woo DDA; test non-cube blocks against registry.getSelectionBoxes; skip
// fluids unless opts.fluids; origin inside a solid block returns that block).

import { registerStub } from '../core/stubs.js';

registerStub('raycast');

/**
 * Cast a ray through the block grid.
 * @param {object} world World system (getRaw)
 * @param {number} ox @param {number} oy @param {number} oz  origin (eye)
 * @param {number} dx @param {number} dy @param {number} dz  direction (any length; normalised internally)
 * @param {number} maxDist blocks
 * @param {{fluids?: boolean, filter?: (id:number, state:number) => boolean}} [opts]
 *        fluids: also hit water/lava (buckets); filter: return false to pass through a block
 * @returns {import('../core/types.js').RayHit | null}
 */
export function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, opts = {}) {
  return null;
}
