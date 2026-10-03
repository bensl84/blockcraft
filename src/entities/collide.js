// OWNER LANE: FEATURE-MOBS. Entity movement glue.
//
// Entities move with CORE-E's frozen physics API (player/physics.js moveAndCollide / fluidState / boxCollides,
// SPEC §7.2: Y first, then the larger of X/Z, step-up by body.stepHeight, unloaded columns count as solid).
// Phase 1 carried a local fallback collider here while physics was a stub; it was removed after the core merge.

import * as physics from '../player/physics.js';

const NO_OPTS = {};

/** moveAndCollide for entities (sets onGround / collidedH / collidedV; returns the shared applied-motion object). */
export function moveEntity(world, body, dx, dy, dz) {
  return physics.moveAndCollide(world, body, dx, dy, dz, NO_OPTS);
}
/** fluidState for entities: {water (submerged fraction), lava, eyeInWater, inWater, waterTop} (shared object). */
export function entityFluid(world, body, eyeHeight = 0) {
  return physics.fluidState(world, body, eyeHeight);
}
/** boxCollides for entities. */
export function entityBoxCollides(world, minX, minY, minZ, maxX, maxY, maxZ) {
  return physics.boxCollides(world, minX, minY, minZ, maxX, maxY, maxZ);
}
