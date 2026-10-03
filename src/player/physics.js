// OWNER LANE: CORE-E (player/physics/input/raycast/interaction). Pure collision helpers - used by the player AND
// by every entity (mobs, items, falling blocks, TNT). Spec: SPEC §7.2. Safe in Node (no DOM, no three.js).
//
// Collision follows Java's Entity.move: collect the collision boxes (registry) of every cell overlapping the
// box expanded by the motion, clip Y first, then the larger of X/Z, then the other, with a 1e-7 epsilon so bodies
// never snag on block seams. Step-up retries a horizontally blocked move with the box raised by stepHeight (two
// variants, like Java 1.12+) and keeps whichever went further. Sneak-edge protection trims horizontal motion in
// 0.05 steps while it would leave no support within stepHeight below the feet.
//
// Unloaded columns (world.isColumnLoaded false) count as SOLID for y in 0..127, so nothing falls out of the world
// while terrain streams in. Worlds without isColumnLoaded (unit-test fakes) are treated as fully loaded.

import { B_CLIMBABLE, B_LIQUID, B_SOLID, getCollisionBoxes } from '../core/registry.js';
import { WORLD_HEIGHT } from '../core/constants.js';

/**
 * @typedef {Object} Body   (Entity and Player both satisfy this)
 * @property {number} x @property {number} y @property {number} z   feet centre
 * @property {number} width @property {number} height
 * @property {number} [stepHeight]        auto step-up height (player 0.6, most mobs 0.6, items 0)
 * @property {boolean} onGround @property {boolean} collidedH @property {boolean} collidedV
 */

export const COLLISION_EPS = 1e-7;
const EPS = COLLISION_EPS;
const SNEAK_STEP = 0.05;

/* ------------------------------------------------------------------ box buffer (allocation-free) */
// Flat list of world-space boxes: [minX, minY, minZ, maxX, maxY, maxZ] * n. Grown by doubling, never shrunk.
let BOX = new Float64Array(6 * 256);
let boxCount = 0;
function pushBox(a, b, c, d, e, f) {
  if ((boxCount + 1) * 6 > BOX.length) { const n = new Float64Array(BOX.length * 2); n.set(BOX); BOX = n; }
  const o = boxCount * 6;
  BOX[o] = a; BOX[o + 1] = b; BOX[o + 2] = c; BOX[o + 3] = d; BOX[o + 4] = e; BOX[o + 5] = f;
  boxCount++;
}

/* ------------------------------------------------------------------ loaded-column cache */
// isColumnLoaded does a Map lookup with a string key; cache the last answer per (world, cx, cz) within one call.
let lcWorld = null, lcCx = 0, lcCz = 0, lcVal = true;
function columnLoaded(world, cx, cz) {
  if (!world.isColumnLoaded) return true;
  if (world === lcWorld && cx === lcCx && cz === lcCz) return lcVal;
  lcWorld = world; lcCx = cx; lcCz = cz; lcVal = !!world.isColumnLoaded(cx, cz);
  return lcVal;
}
function resetLoadedCache() { lcWorld = null; }

/**
 * Fill the internal buffer with the world-space collision boxes of every cell overlapping the query box.
 * Cells one below are included (fence / closed gate collision reaches 1.5). Returns the box count.
 */
function gatherBoxes(world, minX, minY, minZ, maxX, maxY, maxZ) {
  boxCount = 0;
  resetLoadedCache();
  const x0 = Math.floor(minX - EPS), x1 = Math.floor(maxX + EPS);
  const z0 = Math.floor(minZ - EPS), z1 = Math.floor(maxZ + EPS);
  const y0 = Math.max(0, Math.floor(minY - EPS) - 1), y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(maxY + EPS));
  if (y1 < y0) return 0;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!columnLoaded(world, x >> 4, z >> 4)) {
        // Unloaded: a solid wall from y 0 to the top of the world (one tall box per cell column).
        pushBox(x, 0, z, x + 1, WORLD_HEIGHT, z + 1);
        continue;
      }
      for (let y = y0; y <= y1; y++) {
        const v = world.getRaw(x, y, z), id = v & 0xff;
        if (!B_SOLID[id]) continue;
        const boxes = getCollisionBoxes(id, v >> 8);
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          pushBox(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
        }
      }
    }
  }
  return boxCount;
}

/* ------------------------------------------------------------------ per-axis clipping (Java calculateOffset) */
// The moving box lives in M (minX, minY, minZ, maxX, maxY, maxZ).
const M = new Float64Array(6);

function clipY(d) {
  if (d === 0) return 0;
  for (let i = 0, o = 0; i < boxCount; i++, o += 6) {
    if (BOX[o + 3] <= M[0] + EPS || BOX[o] >= M[3] - EPS || BOX[o + 5] <= M[2] + EPS || BOX[o + 2] >= M[5] - EPS) continue;
    if (d > 0 && BOX[o + 1] >= M[4] - EPS) { const g = BOX[o + 1] - M[4]; if (g < d) d = g; }
    else if (d < 0 && BOX[o + 4] <= M[1] + EPS) { const g = BOX[o + 4] - M[1]; if (g > d) d = g; }
  }
  return Math.abs(d) < EPS ? 0 : d;
}
function clipX(d) {
  if (d === 0) return 0;
  for (let i = 0, o = 0; i < boxCount; i++, o += 6) {
    if (BOX[o + 4] <= M[1] + EPS || BOX[o + 1] >= M[4] - EPS || BOX[o + 5] <= M[2] + EPS || BOX[o + 2] >= M[5] - EPS) continue;
    if (d > 0 && BOX[o] >= M[3] - EPS) { const g = BOX[o] - M[3]; if (g < d) d = g; }
    else if (d < 0 && BOX[o + 3] <= M[0] + EPS) { const g = BOX[o + 3] - M[0]; if (g > d) d = g; }
  }
  return Math.abs(d) < EPS ? 0 : d;
}
function clipZ(d) {
  if (d === 0) return 0;
  for (let i = 0, o = 0; i < boxCount; i++, o += 6) {
    if (BOX[o + 4] <= M[1] + EPS || BOX[o + 1] >= M[4] - EPS || BOX[o + 3] <= M[0] + EPS || BOX[o] >= M[3] - EPS) continue;
    if (d > 0 && BOX[o + 2] >= M[5] - EPS) { const g = BOX[o + 2] - M[5]; if (g < d) d = g; }
    else if (d < 0 && BOX[o + 5] <= M[2] + EPS) { const g = BOX[o + 5] - M[2]; if (g > d) d = g; }
  }
  return Math.abs(d) < EPS ? 0 : d;
}
function offsetM(dx, dy, dz) { M[0] += dx; M[3] += dx; M[1] += dy; M[4] += dy; M[2] += dz; M[5] += dz; }
function setM(minX, minY, minZ, maxX, maxY, maxZ) { M[0] = minX; M[1] = minY; M[2] = minZ; M[3] = maxX; M[4] = maxY; M[5] = maxZ; }

/** Clip Y, then the larger of |x| / |z|, then the other, offsetting M as it goes. Writes OUT[0..2]. */
const OUT = new Float64Array(3);
function clipMove(dx, dy, dz) {
  dy = clipY(dy); offsetM(0, dy, 0);
  if (Math.abs(dx) < Math.abs(dz)) {
    dz = clipZ(dz); offsetM(0, 0, dz);
    dx = clipX(dx); offsetM(dx, 0, 0);
  } else {
    dx = clipX(dx); offsetM(dx, 0, 0);
    dz = clipZ(dz); offsetM(0, 0, dz);
  }
  OUT[0] = dx; OUT[1] = dy; OUT[2] = dz;
}

/** True when any box in the buffer intersects the given box (strict, epsilon-shrunk). */
function anyBoxIntersects(minX, minY, minZ, maxX, maxY, maxZ) {
  for (let i = 0, o = 0; i < boxCount; i++, o += 6) {
    if (BOX[o] < maxX - EPS && BOX[o + 3] > minX + EPS && BOX[o + 1] < maxY - EPS && BOX[o + 4] > minY + EPS &&
      BOX[o + 2] < maxZ - EPS && BOX[o + 5] > minZ + EPS) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ public API */

/**
 * Move a body by (dx,dy,dz) blocks, resolving collisions per axis (Y first, then the larger of X/Z, then the
 * other - like Java), with step-up when on ground and blocked horizontally, and optional sneak edge-protection.
 * Sets body.onGround (Y motion clipped while moving down), collidedH, collidedV.
 * @param {object} world World system (getRaw, isColumnLoaded)
 * @param {Body} body
 * @param {number} dx @param {number} dy @param {number} dz
 * @param {{sneakEdge?: boolean}} [opts] sneakEdge: refuse horizontal moves that would leave the ground edge
 * @returns {{dx:number, dy:number, dz:number}} the motion actually applied (shared object - copy if kept)
 */
export function moveAndCollide(world, body, dx, dy, dz, opts = {}) {
  const hw = body.width / 2, h = body.height;
  const step = body.stepHeight > 0 ? body.stepHeight : 0;
  const bx0 = body.x - hw, by0 = body.y, bz0 = body.z - hw, bx1 = body.x + hw, by1 = body.y + h, bz1 = body.z + hw;
  const wasOnGround = !!body.onGround;
  if (!Number.isFinite(dx)) dx = 0;
  if (!Number.isFinite(dy)) dy = 0;
  if (!Number.isFinite(dz)) dz = 0;

  // ---- sneak edge protection (Java: while sneaking on the ground, trim motion that would leave support)
  if (opts.sneakEdge && wasOnGround && (dx !== 0 || dz !== 0)) {
    const drop = step > 0 ? step : 0.6;
    gatherBoxes(world, bx0 - Math.abs(dx) - 1, by0 - drop - 1, bz0 - Math.abs(dz) - 1, bx1 + Math.abs(dx) + 1, by1, bz1 + Math.abs(dz) + 1);
    const unsupported = (ox, oz) => !anyBoxIntersects(bx0 + ox, by0 - drop, bz0 + oz, bx1 + ox, by1 - drop, bz1 + oz);
    while (dx !== 0 && unsupported(dx, 0)) dx = Math.abs(dx) <= SNEAK_STEP ? 0 : dx - Math.sign(dx) * SNEAK_STEP;
    while (dz !== 0 && unsupported(0, dz)) dz = Math.abs(dz) <= SNEAK_STEP ? 0 : dz - Math.sign(dz) * SNEAK_STEP;
    while (dx !== 0 && dz !== 0 && unsupported(dx, dz)) {
      dx = Math.abs(dx) <= SNEAK_STEP ? 0 : dx - Math.sign(dx) * SNEAK_STEP;
      dz = Math.abs(dz) <= SNEAK_STEP ? 0 : dz - Math.sign(dz) * SNEAK_STEP;
    }
  }
  const odx = dx, ody = dy, odz = dz;

  // ---- normal move
  gatherBoxes(world,
    Math.min(bx0, bx0 + dx), Math.min(by0, by0 + dy) - (step > 0 ? step : 0), Math.min(bz0, bz0 + dz),
    Math.max(bx1, bx1 + dx), Math.max(by1, by1 + dy) + step, Math.max(bz1, bz1 + dz));
  setM(bx0, by0, bz0, bx1, by1, bz1);
  clipMove(dx, dy, dz);
  const rx = OUT[0], ry = OUT[1], rz = OUT[2];
  const fx0 = M[0], fy0 = M[1], fz0 = M[2];

  // ---- step-up (Java 1.12+ two-variant step; keeps the farther horizontal result)
  const blockedH = rx !== odx || rz !== odz;
  if (step > 0 && blockedH && (wasOnGround || (ry !== ody && ody < 0))) {
    // variant A: up-clip with the box expanded horizontally, then x, z
    setM(bx0, by0, bz0, bx1, by1, bz1);
    const sx0 = M[0], sz0 = M[2], sx1 = M[3], sz1 = M[5];
    M[0] = Math.min(sx0, sx0 + odx); M[3] = Math.max(sx1, sx1 + odx); M[2] = Math.min(sz0, sz0 + odz); M[5] = Math.max(sz1, sz1 + odz);
    const ayUp = clipY(step);
    setM(bx0, by0 + ayUp, bz0, bx1, by1 + ayUp, bz1);
    const aOrder = Math.abs(odx) < Math.abs(odz);
    let ax, az;
    if (aOrder) { az = clipZ(odz); offsetM(0, 0, az); ax = clipX(odx); offsetM(ax, 0, 0); } else { ax = clipX(odx); offsetM(ax, 0, 0); az = clipZ(odz); offsetM(0, 0, az); }
    const aMx = M[0], aMy = M[1], aMz = M[2];
    // variant B: plain up-clip, then x, z
    setM(bx0, by0, bz0, bx1, by1, bz1);
    const byUp = clipY(step);
    offsetM(0, byUp, 0);
    let bxm, bzm;
    if (aOrder) { bzm = clipZ(odz); offsetM(0, 0, bzm); bxm = clipX(odx); offsetM(bxm, 0, 0); } else { bxm = clipX(odx); offsetM(bxm, 0, 0); bzm = clipZ(odz); offsetM(0, 0, bzm); }
    let sx, sz, up;
    if (ax * ax + az * az > bxm * bxm + bzm * bzm) {
      sx = ax; sz = az; up = ayUp;
      setM(aMx, aMy, aMz, aMx + (bx1 - bx0), aMy + h, aMz + (bz1 - bz0));
    } else {
      sx = bxm; sz = bzm; up = byUp;
    }
    // settle back down by the amount we went up (Java: y = -up, clipped)
    const down = clipY(-up);
    offsetM(0, down, 0);
    if (sx * sx + sz * sz > rx * rx + rz * rz + 1e-12) {
      // Java bookkeeping: the vertical collision compares the original dy with the final settle move
      body.x = M[0] + hw; body.y = M[1]; body.z = M[2] + hw;
      body.collidedH = sx !== odx || sz !== odz;
      body.collidedV = ody !== down;
      body.onGround = body.collidedV && ody < 0;
      RESULT.dx = sx; RESULT.dy = up + down; RESULT.dz = sz;
      return RESULT;
    }
  }

  body.x = fx0 + hw; body.y = fy0; body.z = fz0 + hw;
  body.collidedH = rx !== odx || rz !== odz;
  body.collidedV = ry !== ody;
  body.onGround = body.collidedV && ody < 0;
  RESULT.dx = rx; RESULT.dy = ry; RESULT.dz = rz;
  return RESULT;
}
const RESULT = { dx: 0, dy: 0, dz: 0 };

/**
 * World-space collision boxes of blocks overlapping the query box.
 * @returns {number[][]} [[minX,minY,minZ,maxX,maxY,maxZ], ...] (fresh arrays - read immediately)
 */
export function collectBlockBoxes(world, minX, minY, minZ, maxX, maxY, maxZ, out = []) {
  out.length = 0;
  const n = gatherBoxes(world, minX, minY, minZ, maxX, maxY, maxZ);
  for (let i = 0, o = 0; i < n; i++, o += 6) {
    // keep only boxes that actually touch the query box
    if (BOX[o] > maxX || BOX[o + 3] < minX || BOX[o + 1] > maxY || BOX[o + 4] < minY || BOX[o + 2] > maxZ || BOX[o + 5] < minZ) continue;
    out.push([BOX[o], BOX[o + 1], BOX[o + 2], BOX[o + 3], BOX[o + 4], BOX[o + 5]]);
  }
  return out;
}

/** True if the box intersects any block collision box (unloaded columns count as solid). */
export function boxCollides(world, minX, minY, minZ, maxX, maxY, maxZ) {
  gatherBoxes(world, minX, minY, minZ, maxX, maxY, maxZ);
  return anyBoxIntersects(minX, minY, minZ, maxX, maxY, maxZ);
}

/**
 * Height of the fluid surface inside a liquid cell (0..1 block-local). Sources and flowing fluid use the
 * mesher's rule (14/16 x (8 - level)/8); falling fluid, or fluid with the same liquid above, fills the cell.
 */
export function fluidHeight(world, x, y, z, raw) {
  const id = raw & 0xff, st = raw >> 8;
  if ((st & 8) !== 0) return 1;
  const above = world.getRaw(x, y + 1, z) & 0xff;
  if (B_LIQUID[above] && B_LIQUID[above] === B_LIQUID[id]) return 1;
  return (14 / 16) * (8 - (st & 7)) / 8;
}

const FLUID = { water: 0, lava: false, eyeInWater: false, inWater: false, waterTop: -1 };
/**
 * Fluid contact for a body: {water: 0..1 fraction submerged, lava: bool, eyeInWater: bool} (eyeHeight optional).
 * Also: inWater (Java rule: water above feet + 0.4, i.e. swimming physics apply), waterTop (highest surface y or -1).
 * The returned object is shared - read it immediately.
 */
export function fluidState(world, body, eyeHeight = 0) {
  const hw = body.width / 2 - 0.001;
  const minY = body.y, maxY = body.y + body.height;
  const x0 = Math.floor(body.x - hw), x1 = Math.floor(body.x + hw);
  const z0 = Math.floor(body.z - hw), z1 = Math.floor(body.z + hw);
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(maxY));
  let top = -1, lava = false;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        const v = world.getRaw(x, y, z), kind = B_LIQUID[v & 0xff];
        if (!kind) continue;
        const surf = y + fluidHeight(world, x, y, z, v);
        if (surf <= minY) continue;
        if (kind === 1) { if (surf > top) top = surf; } else if (surf > minY + 0.4 && y < maxY - 0.4) lava = true;
      }
    }
  }
  FLUID.waterTop = top;
  FLUID.water = top < 0 ? 0 : Math.max(0, Math.min(1, (top - minY) / body.height));
  FLUID.inWater = top > minY + 0.4;
  FLUID.lava = lava;
  let eye = false;
  if (eyeHeight > 0) {
    const ey = body.y + eyeHeight;
    const ex = Math.floor(body.x), eyc = Math.floor(ey), ez = Math.floor(body.z);
    const v = world.getRaw(ex, eyc, ez);
    if (B_LIQUID[v & 0xff] === 1) eye = ey < eyc + fluidHeight(world, ex, eyc, ez, v);
  }
  FLUID.eyeInWater = eye;
  return FLUID;
}

/** True when the body's feet cell holds a climbable block (ladder). Java: block at floor(x), floor(y), floor(z). */
export function onClimbable(world, body) {
  return B_CLIMBABLE[world.getRaw(Math.floor(body.x), Math.floor(body.y), Math.floor(body.z)) & 0xff] === 1;
}

/**
 * Nearest Y >= y where a box of (width,height) centred at x,z does not collide (kid "unstuck" / spawn).
 * Returns y unchanged if already free; WORLD_HEIGHT if nothing found.
 */
export function findFreeY(world, x, y, z, width, height) {
  const hw = width / 2;
  if (!boxCollides(world, x - hw, y, z - hw, x + hw, y + height, z + hw)) return y;
  for (let cy = Math.floor(y) + 1; cy < WORLD_HEIGHT; cy++) {
    // stand on the highest collision top of the cell below if it is a partial block (slab, farmland...)
    let feet = cy;
    gatherBoxes(world, x - hw, cy - 1, z - hw, x + hw, cy, z + hw);
    let topBelow = -Infinity;
    for (let i = 0, o = 0; i < boxCount; i++, o += 6) {
      if (BOX[o] < x + hw && BOX[o + 3] > x - hw && BOX[o + 2] < z + hw && BOX[o + 5] > z - hw && BOX[o + 4] <= cy && BOX[o + 4] > cy - 1) {
        if (BOX[o + 4] > topBelow) topBelow = BOX[o + 4];
      }
    }
    if (topBelow > cy - 1 && topBelow < cy && !boxCollides(world, x - hw, topBelow, z - hw, x + hw, topBelow + height, z + hw)) feet = topBelow;
    if (!boxCollides(world, x - hw, feet, z - hw, x + hw, feet + height, z + hw)) return feet;
  }
  return WORLD_HEIGHT;
}
