// OWNER LANE: FEATURE-MOBS. Pure AI / movement / rule helpers for mobs (no DOM, no three.js, no game object).
// Everything here takes a `getRaw(x, y, z) -> uint16` world accessor and a `rand() -> [0,1)` source so it is
// unit-testable in Node (test/mobs.test.mjs) and deterministic under game.rand / setRandomSeed. SPEC §2.6.

import { B_LIQUID, B_SOLID, ID, getCollisionBoxes } from '../core/registry.js';
import { COLORS } from '../core/constants.js';

/* ------------------------------------------------------------------ movement maths */

/**
 * Per-tick ground acceleration of a mob (Java LivingEntity.travel with input = speed = attr*mod):
 * a = (attr*mod)^2 * 0.216 / slip^3. With slip 0.6 the steady ground speed is ~43.2*(attr*mod)^2 blocks/s.
 */
export function mobGroundAccel(attr, mod = 1, slip = 0.6) {
  const s = attr * mod;
  return s * s * (0.216 / (slip * slip * slip));
}
/** Air acceleration of a mob (Java flying speed 0.02 scaled by the input = attr*mod). */
export function mobAirAccel(attr, mod = 1) { return 0.02 * attr * mod; }
/** Steady ground speed in blocks/second for an attribute and modifier (slip 0.6). */
export function steadyGroundSpeed(attr, mod = 1, slip = 0.6) {
  return (mobGroundAccel(attr, mod, slip) / (1 - slip * 0.91)) * 20;
}

/** Yaw (radians, SPEC §3.7: 0 = -Z, + turns left) that faces along (dx, dz). */
export function yawToward(dx, dz) { return Math.atan2(-dx, -dz); }

/** Shortest signed difference b - a in (-PI, PI]. */
export function wrapAngle(a) {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
/** Rotate `cur` toward `target` by at most `maxStep` radians. */
export function turnToward(cur, target, maxStep) {
  const d = wrapAngle(target - cur);
  if (Math.abs(d) <= maxStep) return cur + d;
  return cur + Math.sign(d) * maxStep;
}

/* ------------------------------------------------------------------ terrain safety */

const DANGER = new Uint8Array(256);
for (const n of ['lava', 'fire', 'cactus']) if (ID[n] !== undefined) DANGER[ID[n]] = 1;
/** Blocks a mob must never walk into or onto (lava, fire, cactus). */
export function isDangerBlock(id) { return DANGER[id & 0xff] === 1; }

/** Highest collision-box top inside the cell (0..1.5), or -1 when the cell has no collision. */
export function cellTop(getRaw, x, y, z) {
  const v = getRaw(x, y, z), id = v & 0xff;
  if (!B_SOLID[id]) return -1;
  const boxes = getCollisionBoxes(id, v >> 8);
  let top = -1;
  for (const b of boxes) if (b[4] > top) top = b[4];
  return top;
}
/** True if the cell blocks a body (has any collision box). */
export function cellBlocks(getRaw, x, y, z) { return B_SOLID[getRaw(x, y, z) & 0xff] === 1; }

/**
 * Distance a body standing at feet y would fall at column (x, z): 0 when there is ground right below.
 * Returns Infinity when no ground is found within `maxScan` blocks (void / unloaded). Water below stops the
 * fall (a dive into water is safe) and is reported as 0.5 below the water cell top.
 */
export function dropBelow(getRaw, x, y, z, maxScan = 6) {
  const bx = Math.floor(x), bz = Math.floor(z);
  const fy = Math.floor(y - 1e-4);
  for (let k = 0; k <= maxScan; k++) {
    const cy = fy - k;
    if (cy < 0) return Infinity;
    const v = getRaw(bx, cy, bz), id = v & 0xff;
    if (B_LIQUID[id] === 1) return Math.max(0, y - (cy + 1));
    if (B_SOLID[id]) {
      const top = cellTop(getRaw, bx, cy, bz);
      return Math.max(0, y - (cy + top));
    }
  }
  return Infinity;
}

/**
 * Is it safe for a mob to step to (x, z) from feet height y? Rejects (SPEC §2.6 "Getting around"):
 *  - a drop of `maxDrop` (4) blocks or more,
 *  - lava / fire / cactus at the feet, at the head, or as the ground it would land on.
 */
export function isSafeStep(getRaw, x, y, z, maxDrop = 4) {
  const bx = Math.floor(x), bz = Math.floor(z), by = Math.floor(y + 1e-4);
  const feet = getRaw(bx, by, bz) & 0xff;
  if (isDangerBlock(feet) || B_LIQUID[feet] === 2) return false;
  if (isDangerBlock(getRaw(bx, by + 1, bz) & 0xff)) return false;
  // stepping up one block: look at the cell above the obstacle
  if (B_SOLID[feet]) {
    const up = getRaw(bx, by + 1, bz) & 0xff;
    return !isDangerBlock(up) && B_LIQUID[up] !== 2;
  }
  const drop = dropBelow(getRaw, x, y, z, maxDrop + 1);
  if (!(drop < maxDrop)) return false;
  // what would it land on?
  const landY = Math.floor(y - drop - 0.01);
  const ground = getRaw(bx, landY, bz) & 0xff;
  if (isDangerBlock(ground) || B_LIQUID[ground] === 2) return false;
  return true;
}

/**
 * Can a mob of the given width jump over the obstacle in front of it (direction dirX/dirZ, unit)?
 * Requires the obstacle top to be <= 1 block above the feet and two cells of headroom above it (SPEC §2.6).
 */
export function canJumpObstacle(getRaw, x, y, z, dirX, dirZ, width = 0.6) {
  const reach = width / 2 + 0.35;
  const ax = x + dirX * reach, az = z + dirZ * reach;
  const bx = Math.floor(ax), bz = Math.floor(az), by = Math.floor(y + 1e-4);
  let obstacleTop = -1;
  // obstacle may be in the feet cell, or (for a slab-height step) already partly below the feet
  for (let k = 0; k <= 1; k++) {
    const t = cellTop(getRaw, bx, by + k, bz);
    if (t >= 0) obstacleTop = Math.max(obstacleTop, by + k + t);
  }
  if (obstacleTop < 0) return false;
  const rise = obstacleTop - y;
  if (rise > 1.0 + 1e-6 || rise <= 0) return false;
  // headroom: nothing with collision in [top, top + 2) above the obstacle (the obstacle's own cell may be a slab)
  const base = Math.floor(obstacleTop + 1e-4);
  for (let y = base; y <= base + 2; y++) {
    const t = cellTop(getRaw, bx, y, bz);
    if (t < 0) continue;
    const v = getRaw(bx, y, bz), boxes = getCollisionBoxes(v & 0xff, v >> 8);
    for (const b of boxes) if (y + b[4] > obstacleTop + 1e-6 && y + b[1] < obstacleTop + 2 - 1e-6) return false;
  }
  return !isDangerBlock(getRaw(bx, base, bz) & 0xff);
}

/**
 * Feet y of a standable spot at column (x, z) near `y0` (searching `range` up and down): a cell with a solid
 * top below, two free (non-solid, non-liquid) cells for the body, no danger blocks. Returns null if none.
 * @param {(x:number,y:number,z:number)=>number} getRaw
 */
export function findStandY(getRaw, x, y0, z, range = 4, needDry = true) {
  const bx = Math.floor(x), bz = Math.floor(z), base = Math.floor(y0);
  for (let d = 0; d <= range; d++) {
    for (const s of d === 0 ? [0] : [d, -d]) {
      const y = base + s;
      if (y < 1 || y > 126) continue;
      const below = getRaw(bx, y - 1, bz) & 0xff;
      if (!B_SOLID[below] || isDangerBlock(below)) continue;
      const feet = getRaw(bx, y, bz) & 0xff, head = getRaw(bx, y + 1, bz) & 0xff;
      if (B_SOLID[feet] || B_SOLID[head]) continue;
      if (needDry && (B_LIQUID[feet] || B_LIQUID[head])) continue;
      if (isDangerBlock(feet) || isDangerBlock(head)) continue;
      const top = cellTop(getRaw, bx, y - 1, bz);
      return y - 1 + top;
    }
  }
  return null;
}

/**
 * Pick a wander target within `radius` blocks (SPEC §2.6: every 3-8 s a random point within 10 blocks).
 * Rejects spots with no standing place near the current height, danger blocks, or a big drop.
 * @returns {{x:number,y:number,z:number}|null}
 */
export function pickWanderTarget(rand, getRaw, x, y, z, radius = 10, tries = 10, vertical = 4) {
  for (let i = 0; i < tries; i++) {
    const a = rand() * Math.PI * 2, r = 2 + rand() * (radius - 2);
    const tx = Math.floor(x + Math.cos(a) * r) + 0.5, tz = Math.floor(z + Math.sin(a) * r) + 0.5;
    const ty = findStandY(getRaw, tx, y, tz, vertical);
    if (ty === null) continue;
    return { x: tx, y: ty, z: tz };
  }
  return null;
}

/** A point `dist` blocks away from (fromX, fromZ), on the far side of (x, z) - used to flee. */
export function fleeTarget(rand, getRaw, x, y, z, fromX, fromZ, dist = 6) {
  let ax = x - fromX, az = z - fromZ;
  const len = Math.hypot(ax, az);
  if (len < 1e-3) { const a = rand() * Math.PI * 2; ax = Math.cos(a); az = Math.sin(a); } else { ax /= len; az /= len; }
  for (let i = 0; i < 6; i++) {
    const spread = (rand() - 0.5) * (0.6 + i * 0.4);
    const c = Math.cos(spread), s = Math.sin(spread);
    const dx = ax * c - az * s, dz = ax * s + az * c;
    const tx = Math.floor(x + dx * dist) + 0.5, tz = Math.floor(z + dz * dist) + 0.5;
    const ty = findStandY(getRaw, tx, y, tz, 3);
    if (ty !== null) return { x: tx, y: ty, z: tz };
  }
  return pickWanderTarget(rand, getRaw, x, y, z, dist, 6);
}

/* ------------------------------------------------------------------ rules */

/** Weighted pick from {key: weight}. */
export function weightedPick(rand, weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = rand() * total;
  for (const k in weights) { r -= weights[k]; if (r < 0) return k; }
  return Object.keys(weights)[0];
}

/** Natural sheep wool colour from MOBS.sheep.colorWeights. */
export function rollSheepColor(rand, weights) { return weightedPick(rand, weights); }

/** Integer in [min, max] inclusive. */
export function randInt(rand, min, max) { return min + Math.floor(rand() * (max - min + 1)); }

/**
 * Rainbow sheep (SPEC §2.6, P1): dye the same sheep with `cfg.dyes` (3) DIFFERENT colours within
 * `cfg.windowTicks` (200). history = [{color, tick}] newest last. Returns true when the condition holds at `now`.
 */
export function checkRainbow(history, now, cfg = { dyes: 3, windowTicks: 200 }) {
  const seen = new Set();
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (now - h.tick > cfg.windowTicks) break;
    seen.add(h.color);
    if (seen.size >= cfg.dyes) return true;
  }
  return false;
}
/** Rainbow wool colour shown at a tick (one colour per `cycleTicks`). */
export function rainbowColor(tick, cycleTicks = 20) { return COLORS[Math.floor(tick / cycleTicks) % COLORS.length]; }

/** Remaining baby growth after one feeding: each feeding cuts the remaining time by 10% (SPEC §2.6). */
export function feedBaby(remainingTicks, speedup = 0.1) { return Math.max(0, Math.floor(remainingTicks * (1 - speedup))); }

/* ------------------------------------------------------------------ experience (P1) */

/** XP needed to go from `level` to level+1 (Java). */
export function xpToNext(level) {
  if (level >= 30) return 9 * level - 158;
  if (level >= 15) return 5 * level - 38;
  return 2 * level + 7;
}
/**
 * Add experience points to a {xp, xpLevel, xpProgress} holder (the player). xp = total points.
 * Returns the number of levels gained.
 */
export function addXp(p, points) {
  p.xp = (p.xp || 0) + points;
  let level = p.xpLevel || 0;
  let into = (p.xpProgress || 0) * xpToNext(level) + points;
  let gained = 0;
  while (into >= xpToNext(level)) { into -= xpToNext(level); level++; gained++; }
  p.xpLevel = level;
  p.xpProgress = into / xpToNext(level);
  return gained;
}
/** Split an XP amount into orb values (Java sizes) so big rewards make a few orbs, not dozens. */
export function splitXp(total) {
  const sizes = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
  const out = [];
  let left = Math.max(0, Math.floor(total));
  while (left > 0 && out.length < 16) {
    const s = sizes.find((v) => v <= left) || 1;
    out.push(s); left -= s;
  }
  return out;
}

/* ------------------------------------------------------------------ daylight (monsters burn, spawn light test) */

/**
 * Daylight factor 0..1 for a dayTime (SPEC §5.5.4 Java celestial angle; same formula as render/sky.js):
 * f = frac(t/24000 - 0.25); angle = f + ((1 - (cos(f*PI)+1)/2) - f)/3; daylight = clamp(cos(angle*2PI)*2 + 0.5, 0, 1).
 */
export function daylightAt(dayTime) {
  let f = dayTime / 24000 - 0.25;
  f -= Math.floor(f);
  const angle = f + ((1 - (Math.cos(f * Math.PI) + 1) / 2) - f) / 3;
  return Math.max(0, Math.min(1, Math.cos(angle * Math.PI * 2) * 2 + 0.5));
}
/** Effective sky light at night: sky - (1 - daylight) * 11 (SPEC §2.4), clamped at 0. */
export function effectiveSky(sky, daylight) { return Math.max(0, sky - (1 - daylight) * 11); }
