// OWNER LANE: CORE-B (worldgen). STUB written by LEAD - replace with a seeded simplex/OpenSimplex2 using a
// Fisher-Yates permutation (do NOT use three/examples SimplexNoise: its permutation is not a true shuffle).
// Must be deterministic for a given seed and pure (runs in Node tests and in workers). SPEC §5.2.

import { registerStub } from '../core/stubs.js';
import { hash01 } from '../core/math.js';

registerStub('noise');

/**
 * @param {number} seed uint32
 * @returns {{ noise2: (x:number, y:number) => number, noise3: (x:number, y:number, z:number) => number }}
 *   noise2/noise3 return values in [-1, 1].
 */
export function createNoise(seed) {
  // Stub: smooth value noise (good enough to run; CORE-B replaces with simplex).
  const v2 = (ix, iy) => hash01(seed, ix, iy) * 2 - 1;
  const v3 = (ix, iy, iz) => hash01(seed ^ 0x5bd1e995, ix, iy, iz) * 2 - 1;
  const s = (t) => t * t * (3 - 2 * t);
  return {
    noise2(x, y) {
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = s(x - x0), fy = s(y - y0);
      const a = v2(x0, y0), b = v2(x0 + 1, y0), c = v2(x0, y0 + 1), d = v2(x0 + 1, y0 + 1);
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    },
    noise3(x, y, z) {
      const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
      const fx = s(x - x0), fy = s(y - y0), fz = s(z - z0);
      const l = (a, b, t) => a + (b - a) * t;
      const c00 = l(v3(x0, y0, z0), v3(x0 + 1, y0, z0), fx), c10 = l(v3(x0, y0 + 1, z0), v3(x0 + 1, y0 + 1, z0), fx);
      const c01 = l(v3(x0, y0, z0 + 1), v3(x0 + 1, y0, z0 + 1), fx), c11 = l(v3(x0, y0 + 1, z0 + 1), v3(x0 + 1, y0 + 1, z0 + 1), fx);
      return l(l(c00, c10, fy), l(c01, c11, fy), fz);
    },
  };
}

/**
 * Fractal Brownian motion over noise2.
 * @param {(x:number,y:number)=>number} n2 @param {number} x @param {number} y
 * @param {number} [octaves=4] @param {number} [lacunarity=2] @param {number} [gain=0.5]
 * @returns {number} roughly [-1, 1]
 */
export function fbm2(n2, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += n2(x * freq, y * freq) * amp; norm += amp; amp *= gain; freq *= lacunarity; }
  return sum / norm;
}
