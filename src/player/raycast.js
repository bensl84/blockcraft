// OWNER LANE: CORE-E (player/physics/input/raycast/interaction). Pure block picking. Spec: SPEC §7.3.
// Amanatides & Woo DDA over cells; each visited cell is tested against registry.getSelectionBoxes (full cubes
// trivially), so slabs, torches, plants, ladders, carpets, doors and fences are hit only through their real
// shape. Liquids are skipped unless opts.fluids (then hit as their surface box). Origin inside a block's box
// returns that block with face UP. Safe in Node.

import { B_LIQUID, B_SHAPE, B_SOLID, SHAPE, getSelectionBoxes } from '../core/registry.js';
import { FACE, WORLD_HEIGHT } from '../core/constants.js';
import { fluidHeight } from './physics.js';

const MAX_STEPS = 1024;
const FLUID_BOX = [[0, 0, 0, 1, 1, 1]];
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// slab-test scratch (module-level, allocation-free)
let hitT = 0, hitFace = 0;

/** Ray (o + t*d, d normalised) vs box. Sets hitT/hitFace for the entry; returns false if no hit within [0, tMax]. */
function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, tMax) {
  let t0 = -Infinity, t1 = Infinity, face = -1;
  // X
  if (dx !== 0) {
    const inv = 1 / dx;
    let a = (minX - ox) * inv, b = (maxX - ox) * inv, f = dx > 0 ? FACE.WEST : FACE.EAST;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; face = f; }
    if (b < t1) t1 = b;
  } else if (ox < minX || ox > maxX) return false;
  // Y
  if (dy !== 0) {
    const inv = 1 / dy;
    let a = (minY - oy) * inv, b = (maxY - oy) * inv;
    const f = dy > 0 ? FACE.DOWN : FACE.UP;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; face = f; }
    if (b < t1) t1 = b;
  } else if (oy < minY || oy > maxY) return false;
  // Z
  if (dz !== 0) {
    const inv = 1 / dz;
    let a = (minZ - oz) * inv, b = (maxZ - oz) * inv;
    const f = dz > 0 ? FACE.NORTH : FACE.SOUTH;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; face = f; }
    if (b < t1) t1 = b;
  } else if (oz < minZ || oz > maxZ) return false;
  if (t0 > t1 || t1 < 0 || t0 > tMax) return false;
  if (t0 < 0) { hitT = 0; hitFace = -2; return true; } // origin inside the box
  hitT = t0; hitFace = face;
  return true;
}

/**
 * Cast a ray through the block grid.
 * @param {object} world World system (getRaw)
 * @param {number} ox @param {number} oy @param {number} oz  origin (eye)
 * @param {number} dx @param {number} dy @param {number} dz  direction (any length; normalised internally)
 * @param {number} maxDist blocks
 * @param {{fluids?: boolean, filter?: (id:number, state:number) => boolean, out?: object}} [opts]
 *        fluids: also hit water/lava (buckets); filter: return false to pass through a block;
 *        out: reuse this object for the result (allocation-free per-frame targeting)
 * @returns {import('../core/types.js').RayHit | null}
 */
export function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, opts = {}) {
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0) || !(maxDist > 0)) return null;
  dx /= len; dy /= len; dz /= len;
  const fluids = !!opts.fluids, filter = opts.filter || null;

  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0, sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = sy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = sz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
  let tCell = 0;     // distance at which the ray entered the current cell
  let first = true;

  for (let i = 0; i < MAX_STEPS && tCell <= maxDist; i++) {
    if (y >= 0 && y < WORLD_HEIGHT) {
      const v = world.getRaw(x, y, z), id = v & 0xff;
      if (id !== 0 && (!filter || filter(id, v >> 8))) {
        let boxes = null;
        if (B_LIQUID[id]) {
          if (fluids) { FLUID_BOX[0][4] = fluidHeight(world, x, y, z, v); boxes = FLUID_BOX; }
        } else if (B_SHAPE[id] !== SHAPE.NONE) boxes = getSelectionBoxes(id, v >> 8);
        if (boxes && boxes.length) {
          let bestT = Infinity, bestFace = -1;
          for (let k = 0; k < boxes.length; k++) {
            const b = boxes[k];
            if (rayBox(ox, oy, oz, dx, dy, dz, x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5], maxDist) && hitT < bestT) {
              bestT = hitT; bestFace = hitFace;
            }
          }
          if (bestFace !== -1) {
            if (bestFace === -2) {
              // origin inside this block's box: a solid block in the first cell is the hit; otherwise pass through
              if (first && B_SOLID[id]) return makeHit(opts.out, x, y, z, FACE.UP, v, 0, ox, oy, oz);
            } else {
              return makeHit(opts.out, x, y, z, bestFace, v, bestT, ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
            }
          }
        }
      }
    } else if ((y < 0 && sy <= 0) || (y >= WORLD_HEIGHT && sy >= 0)) {
      return null; // left the world vertically and moving away
    }
    first = false;
    // step to the next cell
    if (tmx < tmy) {
      if (tmx < tmz) { x += sx; tCell = tmx; tmx += tdx; } else { z += sz; tCell = tmz; tmz += tdz; }
    } else if (tmy < tmz) { y += sy; tCell = tmy; tmy += tdy; } else { z += sz; tCell = tmz; tmz += tdz; }
  }
  return null;
}

function makeHit(out, x, y, z, face, v, dist, px, py, pz) {
  const h = out || {};
  const n = FACE_NORMALS[face];
  h.x = x; h.y = y; h.z = z; h.face = face; h.nx = n[0]; h.ny = n[1]; h.nz = n[2];
  h.id = v & 0xff; h.state = v >> 8; h.dist = dist; h.px = px; h.py = py; h.pz = pz;
  return h;
}
