// OWNER LANE: FEATURE-MECH. Explosion maths (SPEC §2.5 "Explosion"). Pure: no game access.
//   1352 rays (the surface of a 16^3 grid). Each ray starts with intensity power x (0.7..1.3), steps 0.3 blocks
//   and loses 0.225 per step plus (blast + 0.3) x 0.3 in every non-air cell. A cell is destroyed while the
//   intensity stays > 0. Entity damage: impact = (1 - d / 2P) x exposure -> floor(7P (i^2 + i) + 1).

import { B_LIQUID, B_OPAQUE, B_SOLID } from '../core/registry.js';
import { B_BLAST } from './rules.js';

/** The 1352 unit ray directions (computed once). Float32Array [dx, dy, dz, ...]. */
export const RAY_DIRS = (() => {
  const out = [];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
    if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
    let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
    const l = Math.hypot(dx, dy, dz);
    out.push(dx / l, dy / l, dz / l);
  }
  return new Float32Array(out);
})();
export const RAY_COUNT = RAY_DIRS.length / 3;
export const STEP = 0.3;
export const STEP_LOSS = 0.225;
export const MAX_BLOCKS = 600;

/**
 * Cells an explosion destroys.
 * @param {(x:number,y:number,z:number)=>number} getRaw
 * @param {number} cx @param {number} cy @param {number} cz  centre
 * @param {number} power
 * @param {() => number} rand
 * @param {{maxBlocks?: number}} [opts]
 * @returns {{cells: number[], count: number}} cells as flat [x, y, z, raw, ...] sorted nearest first, capped
 */
export function explosionCells(getRaw, cx, cy, cz, power, rand, opts = {}) {
  const maxBlocks = opts.maxBlocks ?? MAX_BLOCKS;
  const R = Math.ceil(power * 1.3 / STEP_LOSS * STEP) + 2;
  const D = R * 2 + 1;
  const seen = new Uint8Array(D * D * D);
  const ox = Math.floor(cx) - R, oy = Math.floor(cy) - R, oz = Math.floor(cz) - R;
  const found = [];
  for (let r = 0; r < RAY_COUNT; r++) {
    const dx = RAY_DIRS[r * 3] * STEP, dy = RAY_DIRS[r * 3 + 1] * STEP, dz = RAY_DIRS[r * 3 + 2] * STEP;
    let f = power * (0.7 + rand() * 0.6);
    let px = cx, py = cy, pz = cz;
    while (f > 0) {
      const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
      const lx = bx - ox, ly = by - oy, lz = bz - oz;
      if (lx < 0 || ly < 0 || lz < 0 || lx >= D || ly >= D || lz >= D) break;
      if (by >= 0 && by < 128) {
        const raw = getRaw(bx, by, bz), id = raw & 0xff;
        if (id !== 0) {
          f -= (B_BLAST[id] + 0.3) * 0.3;
          if (f > 0) {
            const i = lx + D * (lz + D * ly);
            if (!seen[i]) { seen[i] = 1; found.push(bx, by, bz, raw); }
          }
        }
      }
      px += dx; py += dy; pz += dz;
      f -= STEP_LOSS;
    }
  }
  // nearest first, capped
  const n = found.length / 4;
  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const d2 = (i) => { const x = found[i * 4] + 0.5 - cx, y = found[i * 4 + 1] + 0.5 - cy, z = found[i * 4 + 2] + 0.5 - cz; return x * x + y * y + z * z; };
  const dist = order.map(d2);
  order.sort((a, b) => dist[a] - dist[b]);
  const count = Math.min(n, maxBlocks);
  const cells = new Array(count * 4);
  for (let k = 0; k < count; k++) { const i = order[k]; for (let c = 0; c < 4; c++) cells[k * 4 + c] = found[i * 4 + c]; }
  return { cells, count };
}

/** True when the centre cell is a fluid: explosions in water (or lava) break no blocks. */
export function centreInFluid(getRaw, cx, cy, cz) { return B_LIQUID[getRaw(Math.floor(cx), Math.floor(cy), Math.floor(cz)) & 0xff] !== 0; }

/**
 * Fraction (0..1) of sample points of an entity box that see the explosion centre without a solid block between.
 * box = {minX, minY, minZ, maxX, maxY, maxZ}.
 */
export function exposure(getRaw, cx, cy, cz, box) {
  const sx = 1 / ((box.maxX - box.minX) * 2 + 1), sy = 1 / ((box.maxY - box.minY) * 2 + 1), sz = 1 / ((box.maxZ - box.minZ) * 2 + 1);
  let seen = 0, total = 0;
  for (let a = 0; a <= 1; a += sx) for (let b = 0; b <= 1; b += sy) for (let c = 0; c <= 1; c += sz) {
    const px = box.minX + (box.maxX - box.minX) * a, py = box.minY + (box.maxY - box.minY) * b, pz = box.minZ + (box.maxZ - box.minZ) * c;
    total++;
    if (!segmentBlocked(getRaw, px, py, pz, cx, cy, cz)) seen++;
  }
  return total ? seen / total : 0;
}

function segmentBlocked(getRaw, ax, ay, az, bx, by, bz) {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const steps = Math.ceil(len / 0.25);
  let lastX = NaN, lastY = NaN, lastZ = NaN;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(ax + (bx - ax) * t), y = Math.floor(ay + (by - ay) * t), z = Math.floor(az + (bz - az) * t);
    if (x === lastX && y === lastY && z === lastZ) continue;
    lastX = x; lastY = y; lastZ = z;
    if (x === Math.floor(bx) && y === Math.floor(by) && z === Math.floor(bz)) continue; // the centre cell itself
    const id = getRaw(x, y, z) & 0xff;
    if (B_OPAQUE[id] || B_SOLID[id]) return true;
  }
  return false;
}

/** Impact 0..1 for an entity at distance `dist` from the centre with `expo` exposure (0 outside 2P). */
export function impactOf(dist, power, expo) {
  const d = dist / (2 * power);
  if (d > 1) return 0;
  return (1 - d) * expo;
}

/** Damage in half-hearts for an impact: floor(7P(i^2 + i) + 1) (Java: (i^2+i)/2 * 7 * 2P + 1). */
export function damageOf(impact, power) {
  if (impact <= 0) return 0;
  return Math.floor((impact * impact + impact) / 2 * 7 * (2 * power) + 1);
}
