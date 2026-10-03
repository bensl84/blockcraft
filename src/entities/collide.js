// OWNER LANE: FEATURE-MOBS. Entity movement glue.
//
// Entities move with CORE-E's frozen physics API (player/physics.js moveAndCollide / fluidState). While that
// module is still a stub (it moves bodies WITHOUT collision, so every mob would fall out of the world), this
// file provides a LOCAL fallback with the same contract (SPEC §7.2: Y first, then the larger of X/Z, step-up,
// unloaded columns count as solid). As soon as CORE-E deletes registerStub('physics') the real functions are
// used automatically - nothing here needs to change. Recorded in docs/handoff/mobs.md.

import { isStub } from '../core/stubs.js';
import { B_LIQUID, B_SOLID, getCollisionBoxes } from '../core/registry.js';
import { STATE } from '../data/blocks.js';
import * as physics from '../player/physics.js';

const EPS = 1e-7;
const BOX = new Float64Array(6 * 512);   // pooled world-space boxes
let boxCount = 0;
const RESULT = { dx: 0, dy: 0, dz: 0 };

function columnPresent(world, x, z) {
  if (!world.isColumnLoaded) return true;
  return world.isColumnLoaded(Math.floor(x) >> 4, Math.floor(z) >> 4);
}

/** Collect collision boxes overlapping [min, max] into the pool. Unloaded columns are full cubes. */
function collect(world, minX, minY, minZ, maxX, maxY, maxZ) {
  boxCount = 0;
  const x0 = Math.floor(minX), x1 = Math.floor(maxX - EPS), z0 = Math.floor(minZ), z1 = Math.floor(maxZ - EPS);
  const y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY - EPS);   // -1: fences reach 1.5 into the cell above
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const loaded = columnPresent(world, x, z);
      for (let y = y0; y <= y1; y++) {
        if (boxCount >= 510) return;
        if (!loaded) { if (y >= 0 && y < 128) push(x, y, z, 0, 0, 0, 1, 1, 1); continue; }
        if (y < 0) { push(x, y, z, 0, 0, 0, 1, 1, 1); continue; }   // never fall below the world floor
        const v = world.getRaw(x, y, z), id = v & 0xff;
        if (!B_SOLID[id]) continue;
        const boxes = getCollisionBoxes(id, v >> 8);
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          push(x, y, z, b[0], b[1], b[2], b[3], b[4], b[5]);
        }
      }
    }
  }
}
function push(x, y, z, a, b, c, d, e, f) {
  const o = boxCount * 6;
  BOX[o] = x + a; BOX[o + 1] = y + b; BOX[o + 2] = z + c; BOX[o + 3] = x + d; BOX[o + 4] = y + e; BOX[o + 5] = z + f;
  boxCount++;
}

function clipY(bx0, by0, bz0, bx1, by1, bz1, dy) {
  for (let i = 0; i < boxCount; i++) {
    const o = i * 6;
    if (BOX[o + 3] <= bx0 + EPS || BOX[o] >= bx1 - EPS || BOX[o + 5] <= bz0 + EPS || BOX[o + 2] >= bz1 - EPS) continue;
    if (dy > 0 && BOX[o + 1] >= by1 - EPS) { const m = BOX[o + 1] - by1; if (m < dy) dy = m; }
    else if (dy < 0 && BOX[o + 4] <= by0 + EPS) { const m = BOX[o + 4] - by0; if (m > dy) dy = m; }
  }
  return dy;
}
function clipX(bx0, by0, bz0, bx1, by1, bz1, dx) {
  for (let i = 0; i < boxCount; i++) {
    const o = i * 6;
    if (BOX[o + 4] <= by0 + EPS || BOX[o + 1] >= by1 - EPS || BOX[o + 5] <= bz0 + EPS || BOX[o + 2] >= bz1 - EPS) continue;
    if (dx > 0 && BOX[o] >= bx1 - EPS) { const m = BOX[o] - bx1; if (m < dx) dx = m; }
    else if (dx < 0 && BOX[o + 3] <= bx0 + EPS) { const m = BOX[o + 3] - bx0; if (m > dx) dx = m; }
  }
  return dx;
}
function clipZ(bx0, by0, bz0, bx1, by1, bz1, dz) {
  for (let i = 0; i < boxCount; i++) {
    const o = i * 6;
    if (BOX[o + 4] <= by0 + EPS || BOX[o + 1] >= by1 - EPS || BOX[o + 3] <= bx0 + EPS || BOX[o] >= bx1 - EPS) continue;
    if (dz > 0 && BOX[o + 2] >= bz1 - EPS) { const m = BOX[o + 2] - bz1; if (m < dz) dz = m; }
    else if (dz < 0 && BOX[o + 5] <= bz0 + EPS) { const m = BOX[o + 5] - bz0; if (m > dz) dz = m; }
  }
  return dz;
}

/** One sweep Y -> (larger of X/Z) -> other from box b; returns applied [dx, dy, dz] in out. */
function sweep(b, dx, dy, dz, out) {
  let [x0, y0, z0, x1, y1, z1] = b;
  const ady = clipY(x0, y0, z0, x1, y1, z1, dy); y0 += ady; y1 += ady;
  let adx, adz;
  if (Math.abs(dx) >= Math.abs(dz)) {
    adx = clipX(x0, y0, z0, x1, y1, z1, dx); x0 += adx; x1 += adx;
    adz = clipZ(x0, y0, z0, x1, y1, z1, dz);
  } else {
    adz = clipZ(x0, y0, z0, x1, y1, z1, dz); z0 += adz; z1 += adz;
    adx = clipX(x0, y0, z0, x1, y1, z1, dx);
  }
  out[0] = adx; out[1] = ady; out[2] = adz;
  return out;
}

const A = [0, 0, 0], S = [0, 0, 0];
/**
 * Local fallback with the contract of physics.moveAndCollide (SPEC §7.2). Sets onGround / collidedH /
 * collidedV on the body and returns the applied motion (shared object).
 */
export function localMoveAndCollide(world, body, dx, dy, dz) {
  const hw = body.width / 2;
  const box = [body.x - hw, body.y, body.z - hw, body.x + hw, body.y + body.height, body.z + hw];
  const step = body.stepHeight || 0;
  collect(world, Math.min(box[0], box[0] + dx) - 0.01, Math.min(box[1], box[1] + dy) - 0.01 - (step ? 0 : 0), Math.min(box[2], box[2] + dz) - 0.01,
    Math.max(box[3], box[3] + dx) + 0.01, Math.max(box[4], box[4] + dy) + step + 0.01, Math.max(box[5], box[5] + dz) + 0.01);
  sweep(box, dx, dy, dz, A);
  const clippedDown = dy < 0 && A[1] > dy + EPS;
  const blockedH = Math.abs(A[0] - dx) > EPS || Math.abs(A[2] - dz) > EPS;
  if (step > 0 && blockedH && (body.onGround || clippedDown)) {
    // step-up: raise by step, move horizontally, settle back down; keep it when it went further
    const raised = box.slice();
    const up = clipY(raised[0], raised[1], raised[2], raised[3], raised[4], raised[5], step);
    raised[1] += up; raised[4] += up;
    sweep(raised, dx, 0, dz, S);
    raised[0] += S[0]; raised[3] += S[0]; raised[2] += S[2]; raised[5] += S[2];
    const down = clipY(raised[0], raised[1], raised[2], raised[3], raised[4], raised[5], -(up + 0.01) + Math.min(0, dy));
    const h1 = A[0] * A[0] + A[2] * A[2], h2 = S[0] * S[0] + S[2] * S[2];
    if (h2 > h1 + EPS) { A[0] = S[0]; A[2] = S[2]; A[1] = up + down; }
  }
  body.x += A[0]; body.y += A[1]; body.z += A[2];
  body.collidedH = Math.abs(A[0] - dx) > EPS || Math.abs(A[2] - dz) > EPS;
  body.collidedV = Math.abs(A[1] - dy) > EPS;
  body.onGround = body.collidedV && dy < 0 || (A[1] > 0 && dy <= 0 && A[1] <= step + EPS);
  RESULT.dx = A[0]; RESULT.dy = A[1]; RESULT.dz = A[2];
  return RESULT;
}

/** Local fallback of physics.fluidState: {water: submerged fraction 0..1, lava, eyeInWater}. */
export function localFluidState(world, body, eyeHeight = 0) {
  const hw = body.width / 2 - 0.001;
  const x0 = Math.floor(body.x - hw), x1 = Math.floor(body.x + hw), z0 = Math.floor(body.z - hw), z1 = Math.floor(body.z + hw);
  const yb = body.y, yt = body.y + body.height;
  let waterTop = -Infinity, lava = false;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    for (let y = Math.floor(yb); y <= Math.floor(yt - 1e-6); y++) {
      const v = world.getRaw(x, y, z), liq = B_LIQUID[v & 0xff];
      if (!liq) continue;
      const level = (v >> 8) & STATE.LIQUID_LEVEL_MASK;
      const falling = ((v >> 8) & STATE.LIQUID_FALLING) !== 0;
      const top = y + (falling || level === 0 ? (isLiquidAbove(world, x, y, z) ? 1 : 0.9) : (8 - level) / 9);
      if (top <= yb) continue;
      if (liq === 2) lava = true;
      else if (top > waterTop) waterTop = top;
    }
  }
  const water = waterTop > yb ? Math.min(1, (waterTop - yb) / body.height) : 0;
  const eyeInWater = eyeHeight > 0 && waterTop > body.y + eyeHeight;
  return { water, lava, eyeInWater };
}
function isLiquidAbove(world, x, y, z) { return B_LIQUID[world.getRaw(x, y + 1, z) & 0xff] !== 0; }

/** True while CORE-E's physics module is still the stub. */
export function physicsIsStub() { return isStub('physics'); }

/** moveAndCollide to use for entities: the real one when CORE-E is live, else the local fallback. */
export function moveEntity(world, body, dx, dy, dz) {
  if (physicsIsStub()) return localMoveAndCollide(world, body, dx, dy, dz);
  return physics.moveAndCollide(world, body, dx, dy, dz, {});
}
/** fluidState to use for entities (real or fallback). */
export function entityFluid(world, body, eyeHeight = 0) {
  if (physicsIsStub()) return localFluidState(world, body, eyeHeight);
  return physics.fluidState(world, body, eyeHeight);
}
/** boxCollides to use for entities (real or fallback). */
export function entityBoxCollides(world, minX, minY, minZ, maxX, maxY, maxZ) {
  if (!physicsIsStub()) return physics.boxCollides(world, minX, minY, minZ, maxX, maxY, maxZ);
  collect(world, minX, minY, minZ, maxX, maxY, maxZ);
  for (let i = 0; i < boxCount; i++) {
    const o = i * 6;
    if (BOX[o] < maxX - EPS && BOX[o + 3] > minX + EPS && BOX[o + 1] < maxY - EPS && BOX[o + 4] > minY + EPS && BOX[o + 2] < maxZ - EPS && BOX[o + 5] > minZ + EPS) return true;
  }
  return false;
}
