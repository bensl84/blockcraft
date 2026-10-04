// OWNER: LEAD (v1.7, judge FID-8), in CORE-B's worldgen style. The Nether's columns (core/nether.js: every world's
// Nether is the strip x >= NETHER_EDGE). Pure and deterministic per (seed, cx, cz): runs in the worldgen workers.
//
// Shape: bedrock floor and roof (y 0 and 127, ragged 4 layers deep), netherrack caverns from a coarse 3D density
// grid (every 4 blocks across, 8 up, trilinear), solid toward the floor and the roof; a lava sea fills open caverns
// up to NETHER_LAVA_Y; soul sand and gravel patches on low floors; glowstone clusters hanging from the roof (the
// main light); nether quartz ore in the rock.

import { createNoise } from './noise.js';
import { colIndex } from '../core/constants.js';
import { BLOCK_BY_NAME } from '../data/blocks.js';
import { NETHER_LAVA_Y } from '../core/nether.js';

const idOf = (n) => BLOCK_BY_NAME.get(n).id;
const NR = idOf('netherrack'), LAVA = idOf('lava'), BEDROCK = idOf('bedrock'), GLOW = idOf('glowstone');
const SOUL = idOf('soul_sand'), QUARTZ = idOf('nether_quartz_ore'), GRAVEL = idOf('gravel');
/** Biome id written for Nether columns: 'desert' (dry: never snowy); MOBS spawns nothing in the Nether anyway. */
export const NETHER_BIOME = 2;

let cache = null;
function noiseFor(seed) {
  if (!cache || cache.seed !== seed) cache = { seed, a: createNoise((seed ^ 0x6e657468) >>> 0), b: createNoise((seed ^ 0x72657221) >>> 0) };
  return cache;
}

/** Deterministic hash in [0,1) per cell. */
function h01(seed, x, y, z, salt) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(seed ^ salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const GX = 5, GY = 17, GZ = 5;
const dens = new Float32Array(GX * GY * GZ);

function density(n, x, y, z) {
  let d = 0.65 * n.a.noise3(x / 72, y / 30, z / 72) + 0.35 * n.b.noise3(x / 26, y / 14, z / 26);
  if (y < 24) d += ((24 - y) / 24) * 1.1;          // a floor under the caverns (the lava sea fills the low ones)
  if (y > 100) d += ((y - 100) / 27) * 1.4;          // and a thick roof
  return d - 0.12;                                   // big open caverns
}

/**
 * Fill one Nether column. blocks: Uint16Array(32768) zeroed; biomes: Uint8Array(256).
 * @param {number} seed @param {number} cx @param {number} cz @param {Uint16Array} blocks @param {Uint8Array} biomes
 */
export function generateNetherColumn(seed, cx, cz, blocks, biomes) {
  seed >>>= 0;
  const n = noiseFor(seed);
  const x0 = cx * 16, z0 = cz * 16;
  for (let gx = 0; gx < GX; gx++) for (let gz = 0; gz < GZ; gz++) for (let gy = 0; gy < GY; gy++) {
    dens[(gx * GZ + gz) * GY + gy] = density(n, x0 + gx * 4, Math.min(127, gy * 8), z0 + gz * 4);
  }
  biomes.fill(NETHER_BIOME);
  for (let lz = 0; lz < 16; lz++) {
    const gz = lz >> 2, fz = (lz & 3) / 4;
    for (let lx = 0; lx < 16; lx++) {
      const gx = lx >> 2, fx = (lx & 3) / 4;
      const x = x0 + lx, z = z0 + lz;
      const i00 = (gx * GZ + gz) * GY, i10 = ((gx + 1) * GZ + gz) * GY, i01 = (gx * GZ + gz + 1) * GY, i11 = ((gx + 1) * GZ + gz + 1) * GY;
      for (let y = 0; y < 128; y++) {
        const idx = colIndex(lx, y, lz);
        if (y === 0 || y === 127 || (y <= 4 && h01(seed, x, y, z, 11) < 1 - y / 5) || (y >= 123 && h01(seed, x, y, z, 12) < (y - 122) / 5)) {
          blocks[idx] = BEDROCK; continue;
        }
        const gy = y >> 3, fy = (y & 7) / 8;
        const a = dens[i00 + gy] + (dens[i10 + gy] - dens[i00 + gy]) * fx, b = dens[i01 + gy] + (dens[i11 + gy] - dens[i01 + gy]) * fx;
        const c = dens[i00 + gy + 1] + (dens[i10 + gy + 1] - dens[i00 + gy + 1]) * fx, d = dens[i01 + gy + 1] + (dens[i11 + gy + 1] - dens[i01 + gy + 1]) * fx;
        const lo = a + (b - a) * fz, hi = c + (d - c) * fz;
        const v = lo + (hi - lo) * fy;
        if (v > 0) blocks[idx] = h01(seed, x, y, z, 13) < 0.012 ? QUARTZ : NR;
        else if (y <= NETHER_LAVA_Y) blocks[idx] = LAVA;
      }
      // floors: soul sand and gravel patches on low ground just above the lava
      const patch = n.a.noise3(x / 18, 7.5, z / 18);
      for (let y = NETHER_LAVA_Y + 1; y < 64; y++) {
        const idx = colIndex(lx, y, lz);
        if (blocks[idx] !== NR || blocks[colIndex(lx, y + 1, lz)] !== 0) continue;
        if (patch > 0.32) { blocks[idx] = SOUL; if (blocks[colIndex(lx, y - 1, lz)] === NR) blocks[colIndex(lx, y - 1, lz)] = SOUL; }
        else if (patch < -0.45 && y <= NETHER_LAVA_Y + 4) blocks[idx] = GRAVEL;
      }
      // roof: glowstone clusters hanging under the rock (the Nether's lamps)
      for (let y = 120; y > 48; y--) {
        const idx = colIndex(lx, y, lz);
        if (blocks[idx] !== NR || blocks[colIndex(lx, y - 1, lz)] !== 0) continue;
        const g = n.b.noise3(x / 9, y / 9, z / 9);
        if (g > 0.42 && h01(seed, x, y, z, 14) < 0.7) {
          const len = 1 + Math.floor(h01(seed, x, y, z, 15) * 3);
          for (let k = 1; k <= len && blocks[colIndex(lx, y - k, lz)] === 0; k++) blocks[colIndex(lx, y - k, lz)] = GLOW;
          blocks[idx] = GLOW;
        }
      }
    }
  }
  return { blocks, biomes };
}
