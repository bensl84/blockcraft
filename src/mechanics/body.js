// OWNER LANE: FEATURE-MECH. Minimal per-axis AABB mover for MECH's own non-living entities (falling blocks,
// primed TNT, SPEC §2.5: gravity 0.04, drag 0.98). It only needs world.getRaw + registry boxes, so falling sand
// and TNT behave the same whether CORE-E's physics.js is a stub or real. Living entities keep using
// physics.moveAndCollide (MOBS). Pure apart from the world accessor.

import { getCollisionBoxes } from '../core/registry.js';

const EPS = 1e-7;
const tmp = [];

function collect(getRaw, minX, minY, minZ, maxX, maxY, maxZ) {
  tmp.length = 0;
  const x0 = Math.floor(minX), x1 = Math.floor(maxX - EPS), y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY - EPS);
  const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - EPS);
  for (let y = Math.max(0, y0); y <= Math.min(127, y1); y++) {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const raw = getRaw(x, y, z), id = raw & 0xff;
      if (!id) continue;
      const boxes = getCollisionBoxes(id, raw >>> 8);
      for (const b of boxes) tmp.push(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
    }
  }
  return tmp;
}

/**
 * Move a body {x, y, z, width, height} by (dx, dy, dz), clipping per axis (Y, then X, then Z) against block
 * collision boxes. Sets onGround / collidedH / collidedV. Returns the body.
 */
export function moveBody(getRaw, b, dx, dy, dz) {
  const hw = b.width / 2;
  let minX = b.x - hw, maxX = b.x + hw, minY = b.y, maxY = b.y + b.height, minZ = b.z - hw, maxZ = b.z + hw;
  const boxes = collect(getRaw, Math.min(minX, minX + dx), Math.min(minY, minY + dy), Math.min(minZ, minZ + dz),
    Math.max(maxX, maxX + dx), Math.max(maxY, maxY + dy), Math.max(maxZ, maxZ + dz));
  const n = boxes.length;
  const ody = dy, odx = dx, odz = dz;
  // Y
  for (let i = 0; i < n; i += 6) {
    if (boxes[i + 3] <= minX || boxes[i] >= maxX || boxes[i + 5] <= minZ || boxes[i + 2] >= maxZ) continue;
    if (dy < 0 && boxes[i + 4] <= minY + EPS) dy = Math.max(dy, boxes[i + 4] - minY);
    else if (dy > 0 && boxes[i + 1] >= maxY - EPS) dy = Math.min(dy, boxes[i + 1] - maxY);
  }
  minY += dy; maxY += dy;
  // X
  for (let i = 0; i < n; i += 6) {
    if (boxes[i + 4] <= minY || boxes[i + 1] >= maxY || boxes[i + 5] <= minZ || boxes[i + 2] >= maxZ) continue;
    if (dx < 0 && boxes[i + 3] <= minX + EPS) dx = Math.max(dx, boxes[i + 3] - minX);
    else if (dx > 0 && boxes[i] >= maxX - EPS) dx = Math.min(dx, boxes[i] - maxX);
  }
  minX += dx; maxX += dx;
  // Z
  for (let i = 0; i < n; i += 6) {
    if (boxes[i + 4] <= minY || boxes[i + 1] >= maxY || boxes[i + 3] <= minX || boxes[i] >= maxX) continue;
    if (dz < 0 && boxes[i + 5] <= minZ + EPS) dz = Math.max(dz, boxes[i + 5] - minZ);
    else if (dz > 0 && boxes[i + 2] >= maxZ - EPS) dz = Math.min(dz, boxes[i + 2] - maxZ);
  }
  b.x += dx; b.y += dy; b.z += dz;
  b.collidedV = dy !== ody;
  b.collidedH = dx !== odx || dz !== odz;
  b.onGround = ody < 0 && dy !== ody;
  if (b.collidedV) b.vy = 0;
  if (dx !== odx) b.vx = 0;
  if (dz !== odz) b.vz = 0;
  return b;
}
