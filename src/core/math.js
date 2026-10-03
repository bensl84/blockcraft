// OWNER: LEAD (shared, frozen). Small, allocation-free math + deterministic randomness helpers.
// Never use Math.random() in world generation or texture generation; use these.

export const DEG = Math.PI / 180;

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function invLerp(a, b, v) { return a === b ? 0 : (v - a) / (b - a); }
export function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
/** Positive modulo (works for negatives). */
export function mod(a, n) { return ((a % n) + n) % n; }
/** Floor division for integers (works for negatives): floorDiv(-1, 16) === -1. */
export function floorDiv(a, n) { return Math.floor(a / n); }
/** Shortest signed angle difference b - a in radians, in (-PI, PI]. */
export function angleDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d <= -Math.PI) d += Math.PI * 2; return d; }
export function approach(v, target, step) { return v < target ? Math.min(v + step, target) : Math.max(v - step, target); }

/** 32-bit integer hash of up to 4 ints (seed, x, y, z). Returns uint32. */
export function hash32(seed, x = 0, y = 0, z = 0) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35); h ^= h >>> 16;
  h = Math.imul(h ^ (z | 0), 0x27d4eb2f); h ^= h >>> 15;
  h = Math.imul(h, 0x165667b1); h ^= h >>> 13;
  return h >>> 0;
}
/** Hash -> float in [0, 1). */
export function hash01(seed, x = 0, y = 0, z = 0) { return hash32(seed, x, y, z) / 4294967296; }

/** FNV-1a hash of a string -> uint32 (used to seed per-texture / per-name generators). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32 PRNG -> function returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience seeded RNG object. */
export class Rng {
  constructor(seed) { this.next = mulberry32(seed >>> 0); }
  /** float in [0,1) */ float() { return this.next(); }
  /** float in [a,b) */ range(a, b) { return a + (b - a) * this.next(); }
  /** int in [a,b] inclusive */ int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
}

/** Random uint32 seed from Math.random (UI use only, e.g. new world seeds). */
export function randomSeed() { return (Math.random() * 4294967296) >>> 0; }

/** Parse '#rrggbb' -> [r,g,b] 0..255 */
export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

/** Look direction from yaw/pitch (radians). yaw 0 = facing -Z (north); +yaw turns left (counter-clockwise from above). */
export function lookDir(yaw, pitch, out = { x: 0, y: 0, z: 0 }) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}
/** Horizontal forward (x,z) for a yaw. */
export function forwardXZ(yaw, out = { x: 0, z: 0 }) { out.x = -Math.sin(yaw); out.z = -Math.cos(yaw); return out; }
/** Horizontal right (x,z) for a yaw. */
export function rightXZ(yaw, out = { x: 0, z: 0 }) { out.x = Math.cos(yaw); out.z = -Math.sin(yaw); return out; }
/** Facing (0=N,1=E,2=S,3=W) closest to a horizontal look yaw. */
export function yawToFacing(yaw) {
  const f = lookDir(yaw, 0);
  if (Math.abs(f.x) > Math.abs(f.z)) return f.x > 0 ? 1 : 3;
  return f.z > 0 ? 2 : 0;
}

/** Axis-aligned box helpers. Box = {minX,minY,minZ,maxX,maxY,maxZ}. */
export function boxesIntersect(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
