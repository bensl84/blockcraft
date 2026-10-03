// OWNER LANE: CORE-E (player/physics/input/raycast/interaction). STUB written by LEAD - keep the exported
// signatures; used by the player AND by every entity (mobs, items, falling blocks, TNT). Spec: SPEC §7.2.
//
// Stub behaviour: moves without collision (bodies fall through the world).

import { registerStub } from '../core/stubs.js';

registerStub('physics');

/**
 * @typedef {Object} Body   (Entity and Player both satisfy this)
 * @property {number} x @property {number} y @property {number} z   feet centre
 * @property {number} width @property {number} height
 * @property {number} [stepHeight]        auto step-up height (player 0.6, most mobs 0.6, items 0)
 * @property {boolean} onGround @property {boolean} collidedH @property {boolean} collidedV
 */

/**
 * Move a body by (dx,dy,dz) blocks, resolving collisions per axis (Y first, then X, then Z - larger of X/Z
 * first like Java), with step-up when on ground and blocked horizontally, and optional sneak edge-protection.
 * Sets body.onGround (Y motion clipped while moving down), collidedH, collidedV.
 * @param {object} world World system (getRaw)
 * @param {Body} body
 * @param {number} dx @param {number} dy @param {number} dz
 * @param {{sneakEdge?: boolean}} [opts] sneakEdge: refuse horizontal moves that would leave the ground edge
 * @returns {{dx:number, dy:number, dz:number}} the motion actually applied (shared object - copy if kept)
 */
export function moveAndCollide(world, body, dx, dy, dz, opts = {}) {
  body.x += dx; body.y += dy; body.z += dz;
  body.onGround = false; body.collidedH = false; body.collidedV = false;
  RESULT.dx = dx; RESULT.dy = dy; RESULT.dz = dz;
  return RESULT;
}
const RESULT = { dx: 0, dy: 0, dz: 0 };

/**
 * World-space collision boxes of blocks overlapping the query box.
 * @returns {number[][]} [[minX,minY,minZ,maxX,maxY,maxZ], ...] (fresh arrays or pooled - read immediately)
 */
export function collectBlockBoxes(world, minX, minY, minZ, maxX, maxY, maxZ, out = []) { out.length = 0; return out; }

/** True if the box intersects any block collision box. */
export function boxCollides(world, minX, minY, minZ, maxX, maxY, maxZ) { return false; }

/**
 * Fluid contact for a body: {water: 0..1 fraction submerged, lava: bool, eyeInWater: bool} (eyeHeight optional).
 */
export function fluidState(world, body, eyeHeight = 0) { return { water: 0, lava: false, eyeInWater: false }; }

/**
 * Nearest Y >= y where a box of (width,height) centred at x,z does not collide (kid "unstuck" / spawn).
 * Returns y unchanged if already free; WORLD_HEIGHT if nothing found.
 */
export function findFreeY(world, x, y, z, width, height) { return y; }
