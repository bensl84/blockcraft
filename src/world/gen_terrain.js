// OWNER LANE: CORE-B (worldgen). SPEC §5.2.
// Pure per-point terrain functions: height (continentalness / erosion / peaks-valleys splines, rivers),
// climate and biome choice. Everything here is a pure function of (seed, preset, x, z) so generateColumn,
// getTerrainHeight, getBiomeAt, findSpawn and the pull-model feature placement always agree.
//
// Biomes never change the height: the height is computed first from biome-free noise, then the biome is
// picked from climate (+ the height for ocean / beach / mountains). That keeps biome borders cliff-free.

import { SEA_LEVEL, FLAT_SURFACE_Y } from '../core/constants.js';
import { hash32 } from '../core/math.js';
import { createNoise } from './noise.js';

/** Biome ids (save-stable; must match BIOMES in worldgen.js). */
export const B = Object.freeze({ PLAINS: 0, FOREST: 1, DESERT: 2, SNOWY: 3, BIRCH: 4, TAIGA: 5, BEACH: 6, OCEAN: 7, MOUNTAINS: 8 });

/** Piecewise-linear spline over sorted [x, y] knots (flat arrays for speed). */
function spline(xs, ys, v) {
  const n = xs.length;
  if (v <= xs[0]) return ys[0];
  if (v >= xs[n - 1]) return ys[n - 1];
  let i = 1;
  while (v > xs[i]) i++;
  const t = (v - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
}
function sstep(e0, e1, x) { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

// Continentalness -> base height (default preset). Most land 52..64, coasts 44..50, oceans 30..40.
const CONT_X = [-1.0, -0.55, -0.32, -0.2, -0.12, -0.04, 0.15, 0.4, 0.7, 1.0];
const CONT_Y = [28, 31, 38, 44, 48.5, 51.5, 55, 58, 62, 66];
// Erosion -> hilliness (0 = flat plains, 1 = rolling hills)
const ERO_X = [-1.0, -0.45, -0.1, 0.25, 0.6, 1.0];
const ERO_Y = [1.0, 0.85, 0.55, 0.25, 0.1, 0.05];
// Islands preset: island field -> base height
const ISL_X = [-1.0, 0.0, 0.18, 0.26, 0.34, 0.5, 0.75, 1.0];
const ISL_Y = [30, 34, 40, 46, 50, 55, 62, 70];

/** Climate noise scale (blocks per noise unit). */
const CLIMATE_SCALE = 800;

const cache = new Map(); // `${seed}|${preset}` -> terrain (small LRU)

/**
 * @param {number} seed uint32
 * @param {string} preset 'default' | 'flat' | 'islands' | 'snowy'
 */
export function getTerrain(seed, preset) {
  seed >>>= 0;
  const key = seed + '|' + preset;
  let t = cache.get(key);
  if (t) return t;
  t = createTerrain(seed, preset);
  if (cache.size >= 6) cache.delete(cache.keys().next().value);
  cache.set(key, t);
  return t;
}

function createTerrain(seed, preset) {
  const mk = (salt) => createNoise(hash32(seed, salt, 0x51ed, 7)).noise2;
  const mk3 = (salt) => createNoise(hash32(seed, salt, 0x3a9f, 11)).noise3;
  const nCont = mk(1), nEro = mk(2), nPv = mk(3), nMnt = mk(4), nRidge = mk(5), nDet = mk(6);
  const nRiv = mk(7), nTemp = mk(8), nHum = mk(9), nOpen = mk(10), nVar = mk(11), nIsl = mk(12);
  // per-seed coordinate offsets so the origin is not a special point of every noise
  const ox = (hash32(seed, 91) % 20000) - 10000, oz = (hash32(seed, 92) % 20000) - 10000;

  function fbm(n, x, z, oct) {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += n(x * f + i * 31.7, z * f - i * 17.3) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return sum / norm;
  }

  const isFlat = preset === 'flat';
  const isIslands = preset === 'islands';
  const isSnowy = preset === 'snowy';

  /** Reusable sample record (callers copy what they need before the next call). */
  const S = { h: 0, biome: 0, river: 0, mountain: 0, temp: 0, hum: 0, open: 0 };

  // ---- macro fields on a 4-block lattice -------------------------------------------------------------
  // The slow, low-frequency fields (continents, erosion, mountains, rivers, climate, cave openings) are
  // evaluated at lattice points (multiples of 4) and bilinearly interpolated. A point query and a column
  // query interpolate the same lattice values, so getTerrainHeight always agrees with generateColumn.
  // Values are pure functions of (i, j); the direct-mapped cache only saves work.
  const NF = 8; // base, land, hilly, mountain, riverRaw, temp, hum, open
  const CACHE = 4096;
  const ckI = new Int32Array(CACHE), ckJ = new Int32Array(CACHE), ckOk = new Uint8Array(CACHE);
  const cv = new Float64Array(CACHE * NF);
  const C00 = new Float64Array(NF), C10 = new Float64Array(NF), C01 = new Float64Array(NF), C11 = new Float64Array(NF);

  function macroInto(i, j, dst) {
    const slot = ((Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0) & (CACHE - 1);
    const o = slot * NF;
    if (!(ckOk[slot] && ckI[slot] === i && ckJ[slot] === j)) {
      const x = i * 4, z = j * 4;
      const X = x + ox, Z = z + oz;
      const dist = Math.sqrt(x * x + z * z);
      let base, land, hilly, mountain = 0, rv = 1;
      if (isIslands) {
        // archipelago: islands where the island field is high; a guaranteed home island around the origin
        let f = fbm(nIsl, X / 240, Z / 240, 4) * 0.95 - 0.04;
        f += 0.6 * Math.max(0, 1 - dist / 120);
        base = spline(ISL_X, ISL_Y, f);
        land = sstep(0.2, 0.34, f);
        hilly = 0.6;
      } else {
        let c = fbm(nCont, X / 700, Z / 700, 4) * 1.3 + 0.2;
        // keep the spawn region on land (oceans still appear a few hundred blocks out)
        c += 0.3 * Math.max(0, 1 - dist / 300);
        base = spline(CONT_X, CONT_Y, c);
        land = sstep(-0.18, 0.0, c);
        hilly = spline(ERO_X, ERO_Y, fbm(nEro, X / 420, Z / 420, 3) * 1.3);
        mountain = sstep(0.38, 0.8, fbm(nMnt, X / 900, Z / 900, 2) * 1.4) * land;
        rv = fbm(nRiv, X / 560, Z / 560, 3);
      }
      cv[o] = base; cv[o + 1] = land; cv[o + 2] = hilly; cv[o + 3] = mountain; cv[o + 4] = rv;
      // climate at about 1/800 (SPEC: ~1/700): biomes a few hundred blocks across, so they read as regions
      cv[o + 5] = fbm(nTemp, X / CLIMATE_SCALE, Z / CLIMATE_SCALE, 3) * 1.45;
      cv[o + 6] = fbm(nHum, X / CLIMATE_SCALE + 41, Z / CLIMATE_SCALE - 37, 3) * 1.45;
      cv[o + 7] = nOpen(X / 70, Z / 70);
      ckI[slot] = i; ckJ[slot] = j; ckOk[slot] = 1;
    }
    for (let k = 0; k < NF; k++) dst[k] = cv[o + k];
  }

  /**
   * Sample the terrain at integer world column (x, z): integer height of the top terrain block, biome id,
   * river channel weight (0..1), mountain weight, cave-opening field.
   */
  function sample(x, z) {
    if (isFlat) {
      S.h = FLAT_SURFACE_Y - 1; S.biome = B.PLAINS; S.river = 0; S.mountain = 0; S.temp = 0; S.hum = 0; S.open = -1;
      return S;
    }
    const i = Math.floor(x / 4), j = Math.floor(z / 4);
    const fx = (x - i * 4) / 4, fz = (z - j * 4) / 4;
    macroInto(i, j, C00); macroInto(i + 1, j, C10); macroInto(i, j + 1, C01); macroInto(i + 1, j + 1, C11);
    const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
    const base = C00[0] * w00 + C10[0] * w10 + C01[0] * w01 + C11[0] * w11;
    const land = C00[1] * w00 + C10[1] * w10 + C01[1] * w01 + C11[1] * w11;
    const hilly = C00[2] * w00 + C10[2] * w10 + C01[2] * w01 + C11[2] * w11;
    const mountain = C00[3] * w00 + C10[3] * w10 + C01[3] * w01 + C11[3] * w11;
    const rvRaw = C00[4] * w00 + C10[4] * w10 + C01[4] * w01 + C11[4] * w11;
    let temp = C00[5] * w00 + C10[5] * w10 + C01[5] * w01 + C11[5] * w11;
    let hum = C00[6] * w00 + C10[6] * w10 + C01[6] * w01 + C11[6] * w11;
    const open = C00[7] * w00 + C10[7] * w10 + C01[7] * w01 + C11[7] * w11;

    const X = x + ox, Z = z + oz;
    const pv = fbm(nPv, X / 160, Z / 160, 4) * 1.3;           // peaks & valleys
    let h = base;
    h += land * hilly * (pv > 0 ? pv * 22 : pv * 7);            // rolling hills, shallow valleys
    if (mountain > 0.001) {
      const r = 1 - Math.abs(fbm(nRidge, X / 260, Z / 260, 4) * 1.25);
      const ridge = r < 0 ? 0 : r * r;
      h += mountain * (8 + ridge * 46);
    }
    h += fbm(nDet, X / 28, Z / 28, 3) * (1.2 + 2.2 * hilly) * (0.3 + 0.7 * land);
    // rivers: a narrow band where |river noise| ~ 0, carving down to just below sea level with sandy banks
    let river = 0;
    if (!isIslands && rvRaw < 0.16 && rvRaw > -0.16) {
      const rv = Math.abs(rvRaw + 0.08 * nVar(X / 40, Z / 40));
      const fade = land * (1 - 0.75 * mountain);
      const bank = (1 - sstep(0.012, 0.075, rv)) * fade;
      if (bank > 0) {
        river = (1 - sstep(0.004, 0.03, rv)) * fade;
        h = h + (Math.min(h, SEA_LEVEL + 1.5) - h) * bank;
        h = h + (Math.min(h, SEA_LEVEL - 3.5) - h) * river;
      }
    }
    if (h > 118) h = 118 - (h - 118) * 0.2;
    if (h < 6) h = 6;
    const hi = Math.round(h);

    // climate (biomes never change the height); a little jitter keeps borders from looking ruled
    const jit = nVar(X / 23 + 99, Z / 23);
    temp += jit * 0.04; hum -= jit * 0.04;
    // colder up high (taiga and snow on the hilltops), but not in a hot climate: a hot region's hills stay warm,
    // so snow never sits right next to a desert (review CORE-R8)
    if (hi > 72) temp -= (hi - 72) * 0.012 * (1 - sstep(0.0, 0.35, temp));

    let biome;
    if (isSnowy) biome = B.SNOWY;
    else if (hi < SEA_LEVEL - 4) biome = B.OCEAN;
    else if (hi <= SEA_LEVEL + 1 && (river > 0.02 || hi < SEA_LEVEL || land < 0.98)) biome = temp < -0.5 ? B.SNOWY : (temp > 0.45 && hum < 0 ? B.DESERT : B.BEACH);
    else if (hi >= 90 || mountain > 0.6) biome = B.MOUNTAINS;
    else if (temp < -0.5) biome = B.SNOWY;
    else if (temp < -0.2) biome = B.TAIGA;
    else if (temp > 0.42 && hum < 0.05) biome = B.DESERT;
    else if (hum > 0.22) biome = temp < 0.12 ? B.BIRCH : B.FOREST;
    else if (hum > 0.05 && temp < -0.05) biome = B.BIRCH;
    else biome = B.PLAINS;

    S.h = hi; S.biome = biome; S.river = river; S.mountain = mountain; S.temp = temp; S.hum = hum; S.open = open;
    return S;
  }

  return {
    seed, preset, isFlat, isIslands, isSnowy, sample,
    /** 3D cave noises (spaghetti pair + cheese caverns) */
    caveA: mk3(20), caveB: mk3(21), caveC: mk3(22),
    /** 2D helper noises for decoration patches */
    patch: mk(30), clay: mk(31),
  };
}
