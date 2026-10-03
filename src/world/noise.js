// OWNER LANE: CORE-B (worldgen). SPEC §5.2.
// Seeded 2D/3D simplex noise (Gustavson's formulation) with a true Fisher-Yates permutation driven by
// mulberry32(seed). Pure and deterministic: same seed -> same values on every run, in Node and in workers.
// No Math.random, no DOM.

import { mulberry32 } from '../core/math.js';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

// 12 edge-midpoint gradients of a cube (x, y, z). 2D uses (x, y) of the same table.
const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);
// 2D: 12 directions evenly around the circle (smoother isotropy than the cube-edge set), length ~1.
const GRAD2 = new Float64Array(24);
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2 + 0.13;
  GRAD2[i * 2] = Math.cos(a);
  GRAD2[i * 2 + 1] = Math.sin(a);
}

/**
 * @param {number} seed uint32
 * @returns {{ noise2: (x:number, y:number) => number, noise3: (x:number, y:number, z:number) => number }}
 *   noise2/noise3 return values in [-1, 1].
 */
export function createNoise(seed) {
  const rand = mulberry32((seed >>> 0) ^ 0x2545f491);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { // Fisher-Yates
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }

  function noise2(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = pm12[ii + perm[jj]] * 2; t0 *= t0; n += t0 * t0 * (GRAD2[g] * x0 + GRAD2[g + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = pm12[ii + i1 + perm[jj + j1]] * 2; t1 *= t1; n += t1 * t1 * (GRAD2[g] * x1 + GRAD2[g + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = pm12[ii + 1 + perm[jj + 1]] * 2; t2 *= t2; n += t2 * t2 * (GRAD2[g] * x2 + GRAD2[g + 1] * y2); }
    const v = 99 * n; // unit gradients: peak ~ +-1
    return v > 1 ? 1 : v < -1 ? -1 : v;
  }

  function noise3(xin, yin, zin) {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { const g = pm12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) { const g = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) { const g = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) { const g = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3); }
    const v = 32 * n;
    return v > 1 ? 1 : v < -1 ? -1 : v;
  }

  return { noise2, noise3 };
}

/**
 * Fractal Brownian motion over noise2.
 * @param {(x:number,y:number)=>number} n2 @param {number} x @param {number} y
 * @param {number} [octaves=4] @param {number} [lacunarity=2] @param {number} [gain=0.5]
 * @returns {number} roughly [-1, 1]
 */
export function fbm2(n2, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    // per-octave offset so every octave does not pass through 0 at the origin
    sum += n2(x * freq + i * 17.31, y * freq - i * 11.73) * amp;
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}
