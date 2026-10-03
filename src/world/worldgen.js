// OWNER LANE: CORE-B (worldgen). Spec: docs/SPEC.md §5.2.
// PURE and DETERMINISTIC: same (seed, cx, cz, preset) -> identical blocks. No Math.random, no DOM, no three.js
// (runs in Node tests and in workers).
//
// Pipeline per column (generateColumn):
//   1. terrain samples on a padded 20x20 grid (gen_terrain.js: height, biome, rivers, climate)
//   2. layers: bedrock (y0 + random y1-3), stone, filler, surface block per biome / depth / slope
//   3. stone variants, dirt/gravel pockets and ores (pull model: blobs from the 3x3 neighbourhood)
//   4. caves: spaghetti tunnels + rare caverns on a 4x4x4 lattice (trilinear), lava at the very bottom,
//      never within 2 blocks of water or the sea floor; rare surface openings
//   5. water below sea level, ice on snowy water
//   6. trees (pull model: candidates within 3 blocks of the column, only cells inside the column written)
//   7. plants: flower patches, short grass, ferns, dead bushes, cactus, sugar cane, pumpkins, melons, mushrooms
//   8. snow layers on every exposed solid top in snowy places (+ snowy grass bit), mountain snow caps

import { COLUMN_VOLUME, FLAT_SURFACE_Y, SEA_LEVEL, WORLD_HEIGHT, colIndex } from '../core/constants.js';
import { ID } from '../core/registry.js';
import { hash32, hash01, mulberry32 } from '../core/math.js';
import { getTerrain, B } from './gen_terrain.js';
import { buildTree, TREE_MAX_RADIUS } from './gen_trees.js';

/**
 * Biome table. id is stored per column cell in Column.biomes (Uint8). Order is save-stable.
 * Which animals live in a biome is NOT here: data/mobs.js MOBS[type].biomes is authoritative (mobsForBiome()).
 * trees.perColumn = average trees per 16x16 column; flowers = patch flowers; grassDensity = short grass chance.
 */
export const BIOMES = Object.freeze([
  { id: 0, name: 'plains', surface: 'grass_block', filler: 'dirt', trees: { kinds: ['oak', 'birch'], perColumn: 0.25 }, flowers: ['dandelion', 'poppy', 'cornflower', 'orange_tulip', 'pink_tulip'], grassDensity: 0.3 },
  { id: 1, name: 'forest', surface: 'grass_block', filler: 'dirt', trees: { kinds: ['oak', 'birch'], perColumn: 3.5 }, flowers: ['dandelion', 'poppy', 'lily_of_the_valley', 'allium'], grassDensity: 0.15 },
  { id: 2, name: 'desert', surface: 'sand', filler: 'sandstone', trees: { kinds: [], perColumn: 0 }, flowers: ['dead_bush'], grassDensity: 0.02 },
  { id: 3, name: 'snowy', surface: 'grass_block', filler: 'dirt', snowLayer: true, trees: { kinds: ['spruce'], perColumn: 0.6 }, flowers: [], grassDensity: 0 },
  { id: 4, name: 'birch_forest', surface: 'grass_block', filler: 'dirt', trees: { kinds: ['birch'], perColumn: 3 }, flowers: ['allium', 'blue_orchid', 'lily_of_the_valley'], grassDensity: 0.15 },
  { id: 5, name: 'taiga', surface: 'grass_block', filler: 'dirt', trees: { kinds: ['spruce'], perColumn: 3 }, flowers: ['fern'], grassDensity: 0.2 },
  { id: 6, name: 'beach', surface: 'sand', filler: 'sand', trees: { kinds: [], perColumn: 0 }, flowers: [], grassDensity: 0 },
  { id: 7, name: 'ocean', surface: 'sand', filler: 'sand', trees: { kinds: [], perColumn: 0 }, flowers: [], grassDensity: 0 },
  { id: 8, name: 'mountains', surface: 'grass_block', filler: 'stone', trees: { kinds: ['spruce'], perColumn: 0.3 }, flowers: ['cornflower'], grassDensity: 0.1 },
]);
export const BIOME_BY_NAME = Object.freeze(Object.fromEntries(BIOMES.map((b) => [b.name, b.id])));

// block ids as module constants (registry ID is a large dynamic object; keep property lookups out of hot loops)
const _air = ID.air,
  _andesite = ID.andesite,
  _bedrock = ID.bedrock,
  _birch_leaves = ID.birch_leaves,
  _birch_log = ID.birch_log,
  _brown_mushroom = ID.brown_mushroom,
  _cactus = ID.cactus,
  _clay = ID.clay,
  _coal_ore = ID.coal_ore,
  _dandelion = ID.dandelion,
  _dead_bush = ID.dead_bush,
  _diamond_ore = ID.diamond_ore,
  _diorite = ID.diorite,
  _dirt = ID.dirt,
  _emerald_ore = ID.emerald_ore,
  _farmland = ID.farmland,
  _fern = ID.fern,
  _gold_ore = ID.gold_ore,
  _granite = ID.granite,
  _grass_block = ID.grass_block,
  _gravel = ID.gravel,
  _ice = ID.ice,
  _iron_ore = ID.iron_ore,
  _lapis_ore = ID.lapis_ore,
  _lava = ID.lava,
  _melon = ID.melon,
  _oak_leaves = ID.oak_leaves,
  _oak_log = ID.oak_log,
  _pink_tulip = ID.pink_tulip,
  _pumpkin = ID.pumpkin,
  _red_mushroom = ID.red_mushroom,
  _redstone_ore = ID.redstone_ore,
  _sand = ID.sand,
  _sandstone = ID.sandstone,
  _short_grass = ID.short_grass,
  _snow = ID.snow,
  _spruce_leaves = ID.spruce_leaves,
  _spruce_log = ID.spruce_log,
  _stone = ID.stone,
  _sugar_cane = ID.sugar_cane,
  _water = ID.water;

/* ------------------------------------------------------------------------------------------ tables */

const SNOW_LINE = 102;          // mountain tops at or above this get snow
const STONE_LINE = 96;          // bare stone above this in the mountains
const LAVA_LEVEL = 6;           // carved cave cells at or below this fill with lava
const CAVE_MIN_Y = 4;
const TREE_GRID = 4;            // tree candidate grid (one jittered candidate per 4x4 cell)
const TREE_JITTER = 3;
const FLAT_CLEAR_RADIUS = 24;   // flat preset: no decoration near the origin (tests and the spawn stay clear)

// [id, yMin, yMax, blobSize, perColumn, flag]   flag 1 = mountains only. Order matters (stone variants first).
const ORES = [
  [_granite, 5, 80, 24, 2, 0],
  [_diorite, 5, 80, 24, 2, 0],
  [_andesite, 5, 80, 24, 2, 0],
  [_gravel, 5, 64, 16, 2, 0],
  [_dirt, 5, 64, 16, 2, 0],
  [_coal_ore, 5, 100, 8, 12, 0],
  [_iron_ore, 5, 64, 6, 8, 0],
  [_gold_ore, 5, 32, 6, 2, 0],
  [_lapis_ore, 5, 30, 5, 1, 0],
  [_redstone_ore, 5, 16, 6, 4, 0],
  [_diamond_ore, 5, 16, 4, 1, 0],
  [_emerald_ore, 5, 30, 1, 1, 1],
];
const blobRadius = (size) => (size <= 1 ? 0 : size <= 6 ? 1 : size <= 10 ? 2 : 3);

const TREE_KIND_IDS = {
  oak: [_oak_log, _oak_leaves],
  birch: [_birch_log, _birch_leaves],
  spruce: [_spruce_log, _spruce_leaves],
};

const GRASSY = new Uint8Array(16);
for (const b of [B.PLAINS, B.FOREST, B.SNOWY, B.BIRCH, B.TAIGA, B.MOUNTAINS]) GRASSY[b] = 1;

// salts
const S_BEDROCK = 0x11, S_FILL = 0x12, S_ORE = 0x13, S_TREE = 0x14, S_PLANT = 0x15, S_PATCH = 0x16, S_CACTUS = 0x17;
const S_PUMPKIN = 0x18, S_CANE = 0x19, S_MUSH = 0x1a;

/* ------------------------------------------------------------------------------------------ scratch */

const PAD = 2, PW = 16 + PAD * 2;                  // padded sample grid 20x20
const padH = new Int16Array(PW * PW);
const colBiome = new Uint8Array(256), colRiver = new Float32Array(256), colOpen = new Float32Array(256);
const colMountain = new Float32Array(256);
const surfTop = new Int16Array(256);               // y of the surface block after layering (-1 none)
const caveCeil = new Int16Array(256);
const LAT_X = 5, LAT_Y = 33;                       // cave lattice (4x4x4 cells)
const latA = new Float32Array(LAT_X * LAT_X * LAT_Y);
const latB = new Float32Array(LAT_X * LAT_X * LAT_Y);
const latC = new Float32Array(LAT_X * LAT_X * LAT_Y);
const caveCell = new Uint8Array(4 * 4 * (LAT_Y - 1));
const CAVE_W = 0.1, CAVE_W_MAX = 0.115, CAVERN_THR_MIN = 0.7;

/* ------------------------------------------------------------------------------------------ helpers */

function treeKindIndex(kinds, r) {
  if (kinds.length === 1) return kinds[0];
  return r < 0.75 ? kinds[0] : kinds[1]; // first kind dominates (oak forests with a few birches)
}

/**
 * Tree candidate in grid cell (gx, gz) for the non-flat presets: returns null or
 * {x, z, y (trunk base), kind, rng seed}. Pure: the same answer from every column that asks.
 */
function treeCandidate(T, seed, gx, gz) {
  const hsh = hash32(seed ^ 0x7ee5, gx, gz, S_TREE);
  const r = (hsh >>> 8) / 16777216;
  if (r >= 0.24) return null;                      // max density (forest 3.5 / 16 cells)
  const x = gx * TREE_GRID + (hsh & 3) % TREE_JITTER;
  const z = gz * TREE_GRID + ((hsh >>> 2) & 3) % TREE_JITTER;
  const s = T.sample(x, z);
  const biome = s.biome;
  const def = BIOMES[biome];
  if (!def.trees.kinds.length) return null;
  // clumpy forests: density modulated by a patch noise
  const clump = 0.55 + 0.9 * (0.5 + 0.5 * T.patch(x / 48 + 300, z / 48));
  if (r >= (def.trees.perColumn / 16) * clump) return null;
  if (s.h < SEA_LEVEL || s.h >= STONE_LINE || s.river > 0.02 || s.open > 0.68) return null;
  if (biome === B.SNOWY && s.h <= SEA_LEVEL + 1) return null; // snowy beaches are sand
  if (biome === B.MOUNTAINS || s.h > 84) {
    // no trees on steep stone slopes
    const h = s.h;
    const a = T.sample(x + 1, z).h, b = T.sample(x - 1, z).h, c = T.sample(x, z + 1).h, d = T.sample(x, z - 1).h;
    if (Math.max(Math.abs(a - h), Math.abs(b - h), Math.abs(c - h), Math.abs(d - h)) >= 3) return null;
  }
  const s2 = T.sample(x, z); // (sample record is shared; re-read after neighbour samples)
  return { x, z, y: s2.h + 1, kind: treeKindIndex(def.trees.kinds, hash01(seed, x, z, 0x2b)), seed: hash32(seed, x, z, 0x7ee) };
}

/** Flat preset tree candidates: one grid cell per column, about 1 tree per 5 columns, away from the origin. */
function flatTreeCandidate(seed, gx, gz) {
  const hsh = hash32(seed ^ 0xf1a7, gx, gz, S_TREE);
  if ((hsh >>> 8) / 16777216 >= 0.2) return null;
  const x = gx * 16 + (hsh & 15);
  const z = gz * 16 + ((hsh >>> 4) & 15);
  if (x * x + z * z < FLAT_CLEAR_RADIUS * FLAT_CLEAR_RADIUS) return null;
  return { x, z, y: FLAT_SURFACE_Y, kind: (hsh >>> 9) % 3 === 0 ? 'birch' : 'oak', seed: hash32(seed, x, z, 0x7ee) };
}

/** Write one tree into the column (cells outside [x0, x0+15] x [z0, z0+15] are skipped). */
function writeTreeClipped(blocks, x0, z0, t) {
  const [logId, leafId] = TREE_KIND_IDS[t.kind];
  const rand = mulberry32(t.seed);
  buildTree(t.kind, rand, (dx, dy, dz, isLog) => {
    const lx = t.x + dx - x0, lz = t.z + dz - z0, y = t.y + dy;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WORLD_HEIGHT) return;
    const i = colIndex(lx, y, lz);
    const cur = blocks[i] & 0xff;
    if (isLog) {
      if (cur === _air || cur === leafId || cur === _oak_leaves || cur === _birch_leaves || cur === _spruce_leaves || cur === _short_grass || cur === _fern || cur === _snow) blocks[i] = logId;
    } else if (cur === _air) {
      blocks[i] = leafId;
    }
  });
}

/* ------------------------------------------------------------------------------------------ flat */

function generateFlat(seed, cx, cz, blocks, biomes) {
  biomes.fill(B.PLAINS);
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      blocks[colIndex(lx, 0, lz)] = _bedrock;
      blocks[colIndex(lx, 1, lz)] = _dirt;
      blocks[colIndex(lx, 2, lz)] = _dirt;
      blocks[colIndex(lx, 3, lz)] = _grass_block;
    }
  }
  // P1: a few trees and flowers at hashed positions (never near the origin)
  const x0 = cx * 16, z0 = cz * 16;
  for (let gz = cz - 1; gz <= cz + 1; gz++) {
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      const t = flatTreeCandidate(seed, gx, gz);
      if (t && t.x + TREE_MAX_RADIUS >= x0 && t.x - TREE_MAX_RADIUS <= x0 + 15 && t.z + TREE_MAX_RADIUS >= z0 && t.z - TREE_MAX_RADIUS <= z0 + 15) {
        writeTreeClipped(blocks, x0, z0, t);
      }
    }
  }
  const R2 = FLAT_CLEAR_RADIUS * FLAT_CLEAR_RADIUS;
  const flowers = BIOMES[B.PLAINS].flowers;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const x = x0 + lx, z = z0 + lz;
      if (x * x + z * z < R2) continue;
      const i = colIndex(lx, FLAT_SURFACE_Y, lz);
      if (blocks[i] !== _air) continue;
      const r = hash01(seed, x, z, S_PLANT);
      if (r < 0.012) blocks[i] = ID[flowers[hash32(seed, x >> 3, z >> 3, S_PATCH) % flowers.length]];
      else if (r < 0.05) blocks[i] = _short_grass;
    }
  }
}

/* ------------------------------------------------------------------------------------------ main */

/**
 * Generate one 16x128x16 column: terrain + caves + ores + water + surface + decoration (trees, flowers,
 * grass, sugar cane, cactus, pumpkins) using the pull model (features from neighbouring columns that reach
 * into this one are written too, so no cross-column writes are needed).
 * @param {number} seed uint32
 * @param {number} cx column x (block x = cx*16 + lx)
 * @param {number} cz column z
 * @param {'default'|'flat'|'islands'|'snowy'} preset
 * @param {{blocks: Uint16Array, biomes: Uint8Array}} out  blocks.length === 32768 (colIndex), biomes.length === 256 (lx + lz*16)
 *        Caller passes ZEROED arrays; generator writes packed values (id | state<<8).
 * @returns {{blocks: Uint16Array, biomes: Uint8Array}} out
 */
export function generateColumn(seed, cx, cz, preset, out) {
  const blocks = out.blocks, biomes = out.biomes;
  if (blocks.length !== COLUMN_VOLUME) throw new Error('generateColumn: blocks must be Uint16Array(32768)');
  seed >>>= 0;
  if (preset === 'flat') { generateFlat(seed, cx, cz, blocks, biomes); return out; }
  const T = getTerrain(seed, preset);
  const x0 = cx * 16, z0 = cz * 16;

  /* 1. samples ------------------------------------------------------------------------------------ */
  let maxH = 0;
  for (let pz = 0; pz < PW; pz++) {
    for (let px = 0; px < PW; px++) {
      const s = T.sample(x0 + px - PAD, z0 + pz - PAD);
      padH[px + pz * PW] = s.h;
      const lx = px - PAD, lz = pz - PAD;
      if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
        const c = lx + lz * 16;
        colBiome[c] = s.biome; colRiver[c] = s.river; colOpen[c] = s.open; colMountain[c] = s.mountain;
        biomes[c] = s.biome;
        if (s.h > maxH) maxH = s.h;
      }
    }
  }

  /* 2. layers ------------------------------------------------------------------------------------- */
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const c = lx + lz * 16;
      const x = x0 + lx, z = z0 + lz;
      const h = padH[(lx + PAD) + (lz + PAD) * PW];
      const biome = colBiome[c];
      blocks[colIndex(lx, 0, lz)] = _bedrock;
      for (let y = 1; y <= 3; y++) if (hash01(seed, x, y, z ^ S_BEDROCK) < 1 - y / 4) blocks[colIndex(lx, y, lz)] = _bedrock;
      const fh = hash32(seed, x, z, S_FILL);
      const depth = 3 + (fh & 1);
      // slope from the padded grid (for cliffs in the mountains)
      const hp = (lx + PAD) + (lz + PAD) * PW;
      const slope = Math.max(Math.abs(padH[hp + 1] - h), Math.abs(padH[hp - 1] - h), Math.abs(padH[hp + PW] - h), Math.abs(padH[hp - PW] - h));
      let top, fill, fillDepth = depth, under = _stone, underDepth = 0;
      if (h < SEA_LEVEL) {
        // sea / lake / river floor
        const wd = SEA_LEVEL - 1 - h;
        const cl = T.clay(x / 9, z / 9);
        if (wd <= 4 && cl > 0.45) { top = _clay; fill = _clay; fillDepth = 1 + (fh >>> 1 & 1); }
        else if (wd >= 7 && T.patch(x / 23, z / 23) > -0.1) { top = _gravel; fill = _gravel; fillDepth = 2; }
        else if (biome === B.OCEAN || biome === B.BEACH || biome === B.DESERT || colRiver[c] > 0.02 || wd >= 3) { top = _sand; fill = _sand; }
        else { top = _dirt; fill = _dirt; }
        if (top === _sand) { under = _sandstone; underDepth = 2; }
      } else if (biome === B.DESERT) {
        top = _sand; fill = _sand; under = _sandstone; underDepth = 4;
      } else if (biome === B.BEACH) {
        top = _sand; fill = _sand; under = _sandstone; underDepth = 2;
      } else if (biome === B.SNOWY && h <= SEA_LEVEL + 1 && colRiver[c] <= 0.02 && padMin(hp, 3) < SEA_LEVEL) {
        top = _sand; fill = _sand; under = _sandstone; underDepth = 2; // snowy beach
      } else if (biome === B.MOUNTAINS && (h >= STONE_LINE || slope >= 4)) {
        top = (slope >= 4 && (fh >>> 3) % 7 === 0) ? _gravel : _stone; fill = _stone; fillDepth = 1;
      } else if (biome === B.MOUNTAINS) {
        top = _grass_block; fill = _dirt; fillDepth = 1 + (fh & 1);
      } else {
        top = _grass_block; fill = _dirt;
      }
      let y = 1;
      const fillStart = h - fillDepth;
      const underStart = fillStart - underDepth;
      for (; y <= h; y++) {
        const i = colIndex(lx, y, lz);
        if (blocks[i] === _bedrock) continue;
        blocks[i] = y === h ? top : y > fillStart ? fill : y > underStart ? under : _stone;
      }
      surfTop[c] = h;
    }
  }

  function padMin(hp, r) {
    let m = 999;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const px = (hp % PW) + dx, pz = ((hp / PW) | 0) + dz;
      if (px < 0 || pz < 0 || px >= PW || pz >= PW) continue;
      const v = padH[px + pz * PW]; if (v < m) m = v;
    }
    return m;
  }

  /* 3. ores and stone variants (pull model over the 3x3 neighbourhood) ---------------------------------- */
  for (let k = 0; k < ORES.length; k++) {
    const [oreId, yMin, yMax, size, count, flag] = ORES[k];
    const r = blobRadius(size);
    for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
      for (let ncx = cx - 1; ncx <= cx + 1; ncx++) {
        if (r === 0 && (ncx !== cx || ncz !== cz)) continue;
        for (let n = 0; n < count; n++) {
          const hh = hash32(seed ^ 0x0e5, ncx, ncz, (k << 6) | n | (S_ORE << 12));
          const bx = ncx * 16 + (hh & 15), bz = ncz * 16 + ((hh >>> 4) & 15);
          if (bx + r < x0 || bx - r > x0 + 15 || bz + r < z0 || bz - r > z0 + 15) continue;
          const by = yMin + ((hh >>> 8) % (yMax - yMin + 1));
          if (flag === 1 && colBiome[(bx - x0) + (bz - z0) * 16] !== B.MOUNTAINS) continue;
          let px = bx, py = by, pz = bz;
          let st = (hh ^ 0x9e3779b9) >>> 0; // inline mulberry32 (no closure per blob)
          for (let s = 0; s < size; s++) {
            const lx = px - x0, lz = pz - z0;
            if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16 && py > 0 && py < WORLD_HEIGHT) {
              const i = colIndex(lx, py, lz);
              if (blocks[i] === _stone) blocks[i] = oreId;
            }
            // random 6-neighbour step, kept inside the blob box
            st = (st + 0x6d2b79f5) >>> 0;
            let q = Math.imul(st ^ (st >>> 15), st | 1);
            q ^= q + Math.imul(q ^ (q >>> 7), q | 61);
            const d = ((((q ^ (q >>> 14)) >>> 0) / 4294967296) * 6) | 0;
            let nx = px, ny = py, nz = pz;
            if (d === 0) nx++; else if (d === 1) nx--; else if (d === 2) ny++; else if (d === 3) ny--; else if (d === 4) nz++; else nz--;
            if (Math.abs(nx - bx) > r || Math.abs(ny - by) > r || Math.abs(nz - bz) > r || ny < yMin || ny > yMax) { nx = px; ny = py; nz = pz; }
            px = nx; py = ny; pz = nz;
          }
        }
      }
    }
  }

  /* 4. caves -------------------------------------------------------------------------------------- */
  // ceiling per cell: crust of 5 below the surface; rare openings reach the surface; never within 2 blocks
  // (horizontally) of water, and at least 3 blocks under any nearby sea/lake/river floor.
  let maxCeil = 0;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const c = lx + lz * 16;
      const h = surfTop[c];
      const biome = colBiome[c];
      const sandy = biome === B.DESERT || biome === B.BEACH || biome === B.OCEAN;
      let ceil = (colOpen[c] > 0.74 && !sandy && h >= SEA_LEVEL + 3) ? h : h - 5;
      const hp = (lx + PAD) + (lz + PAD) * PW;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const hn = padH[hp + dx + dz * PW];
          if (hn < SEA_LEVEL + 1 && hn - 3 < ceil) ceil = hn - 3; // water column (or shoreline) nearby
        }
      }
      caveCeil[c] = ceil;
      if (ceil > maxCeil) maxCeil = ceil;
    }
  }
  if (maxCeil >= CAVE_MIN_Y) {
    const latTop = Math.min(LAT_Y - 1, ((maxCeil + 4) >> 2) + 1);
    const nA = T.caveA, nB = T.caveB, nC = T.caveC;
    for (let ly = 0; ly <= latTop; ly++) {
      const wy = ly * 4;
      for (let lzI = 0; lzI < LAT_X; lzI++) {
        for (let lxI = 0; lxI < LAT_X; lxI++) {
          const wx = x0 + lxI * 4, wz = z0 + lzI * 4;
          const li = lxI + lzI * LAT_X + ly * LAT_X * LAT_X;
          latA[li] = nA(wx / 52, wy / 30, wz / 52);
          latB[li] = nB(wx / 52, wy / 30, wz / 52);
          latC[li] = wy >= 8 && wy <= 44 ? nC(wx / 80, wy / 36, wz / 80) : -1;
        }
      }
    }
    // lattice cells whose 8 corners cannot produce a cave (trilinear values stay inside the corner range)
    for (let iy = 0; iy < latTop; iy++) {
      for (let iz = 0; iz < 4; iz++) {
        for (let ix = 0; ix < 4; ix++) {
          const b = ix + iz * LAT_X + iy * 25;
          let mnA = 9, mxA = -9, mnB = 9, mxB = -9, mxC = -9;
          for (let k = 0; k < 8; k++) {
            const o = b + (k & 1) + ((k >> 1) & 1) * LAT_X + (k >> 2) * 25;
            const va = latA[o], vb = latB[o], vc = latC[o];
            if (va < mnA) mnA = va; if (va > mxA) mxA = va;
            if (vb < mnB) mnB = vb; if (vb > mxB) mxB = vb;
            if (vc > mxC) mxC = vc;
          }
          const tunnel = !(mnA > CAVE_W_MAX || mxA < -CAVE_W_MAX || mnB > CAVE_W_MAX || mxB < -CAVE_W_MAX);
          caveCell[ix + iz * 4 + iy * 16] = tunnel || mxC > CAVERN_THR_MIN ? 1 : 0;
        }
      }
    }
    for (let lz = 0; lz < 16; lz++) {
      const iz = lz >> 2, fz = (lz & 3) / 4;
      for (let lx = 0; lx < 16; lx++) {
        const c = lx + lz * 16;
        const ceil = caveCeil[c];
        if (ceil < CAVE_MIN_Y) continue;
        const ix = lx >> 2, fx = (lx & 3) / 4;
        const opening = ceil >= surfTop[c] - 1;
        for (let y = CAVE_MIN_Y; y <= ceil; y++) {
          const iy = y >> 2, fy = (y & 3) / 4;
          if (!caveCell[ix + iz * 4 + iy * 16]) { y = (iy << 2) + 3; continue; }
          const b000 = ix + iz * LAT_X + iy * 25;
          // trilinear interpolation of the three lattice fields
          const a = tri(latA, b000, fx, fy, fz);
          const b = tri(latB, b000, fx, fy, fz);
          // tunnels thin out above y 40 (rare near the surface) unless this is an opening
          let w = CAVE_W;
          if (!opening && y > 40) w *= Math.max(0, 1 - (y - 40) / 14);
          else if (y < 24) w = CAVE_W_MAX;
          let carve = (a < w && a > -w && b < w && b > -w);
          if (!carve && y >= 8 && y <= 44) {
            const ch = tri(latC, b000, fx, fy, fz);
            const thr = CAVERN_THR_MIN + (y > 30 ? (y - 30) * 0.02 : 0) + (y < 14 ? (14 - y) * 0.02 : 0);
            carve = ch > thr;
          }
          if (!carve) continue;
          const i = colIndex(lx, y, lz);
          const cur = blocks[i];
          if (cur === _bedrock || cur === _air) continue;
          blocks[i] = y <= LAVA_LEVEL ? _lava : _air;
        }
      }
    }
  }

  /* 5. water and the real surface ------------------------------------------------------------------- */
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const c = lx + lz * 16;
      const h = surfTop[c];
      if (h < SEA_LEVEL - 1) {
        for (let y = h + 1; y < SEA_LEVEL; y++) {
          const i = colIndex(lx, y, lz);
          if (blocks[i] === _air) blocks[i] = _water;
        }
      }
      if (h === SEA_LEVEL - 1) { /* surface block level with the water: nothing to fill */ }
      // the real ground top (an opening may have carved the surface away)
      let y = h;
      while (y > 0 && blocks[colIndex(lx, y, lz)] === _air) y--;
      surfTop[c] = y;
    }
  }

  /* 6. trees (pull model) --------------------------------------------------------------------------- */
  const gx0 = Math.floor((x0 - TREE_MAX_RADIUS) / TREE_GRID), gx1 = Math.floor((x0 + 15 + TREE_MAX_RADIUS) / TREE_GRID);
  const gz0 = Math.floor((z0 - TREE_MAX_RADIUS) / TREE_GRID), gz1 = Math.floor((z0 + 15 + TREE_MAX_RADIUS) / TREE_GRID);
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const t = treeCandidate(T, seed, gx, gz);
      if (!t) continue;
      if (t.x + TREE_MAX_RADIUS < x0 || t.x - TREE_MAX_RADIUS > x0 + 15 || t.z + TREE_MAX_RADIUS < z0 || t.z - TREE_MAX_RADIUS > z0 + 15) continue;
      // trunk base cell inside this column: only on real grass/dirt (never sand, water, or carved ground)
      const lx = t.x - x0, lz = t.z - z0;
      if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
        const g = blocks[colIndex(lx, t.y - 1, lz)] & 0xff;
        if (g === _grass_block) blocks[colIndex(lx, t.y - 1, lz)] = _dirt;
      }
      writeTreeClipped(blocks, x0, z0, t);
    }
  }

  /* 7. plants --------------------------------------------------------------------------------------- */
  const patchN = T.patch;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const c = lx + lz * 16;
      const biome = colBiome[c];
      const def = BIOMES[biome];
      const x = x0 + lx, z = z0 + lz;
      const y = surfTop[c];
      if (y < 1 || y >= WORLD_HEIGHT - 4) continue;
      const gi = colIndex(lx, y, lz), ai = colIndex(lx, y + 1, lz);
      const ground = blocks[gi] & 0xff;
      if (blocks[ai] !== _air) continue;
      const r = hash01(seed, x, z, S_PLANT);
      if (ground === _grass_block) {
        if (biome === B.SNOWY || (biome === B.MOUNTAINS && y >= SNOW_LINE)) continue; // snow goes there
        // sugar cane on the shore (next to open, unfrozen water at sea level)
        // pumpkin / melon patches: one hashed spot per column (about 1 in 40 / 1 in 90 columns)
        const pk = pumpkinAt(seed, x, z, cx, cz, biome);
        if (pk) { blocks[ai] = pk; continue; }
        const pv = patchN(x / 11, z / 11);
        const flowers = def.flowers;
        if (flowers.length && flowers[0] !== 'fern' && pv > 0.5 && r < 0.32) {
          // flower patch: one species per 8x8 area
          blocks[ai] = ID[flowers[hash32(seed, x >> 3, z >> 3, S_PATCH) % flowers.length]];
          continue;
        }
        if ((biome === B.FOREST || biome === B.TAIGA || biome === B.BIRCH) && r > 0.996) {
          blocks[ai] = (hash32(seed, x, z, S_MUSH) & 1) ? _brown_mushroom : _red_mushroom;
          continue;
        }
        const gd = def.grassDensity * (0.55 + 0.9 * (0.5 + 0.5 * patchN(x / 17 + 50, z / 17)));
        if (r < gd) {
          blocks[ai] = biome === B.TAIGA && hash01(seed, x, z, S_PATCH) < 0.45 ? _fern : _short_grass;
        } else if (biome === B.PLAINS && r > 0.993) {
          // a lone flower here and there
          blocks[ai] = ID[def.flowers[hash32(seed, x, z, S_PATCH) % def.flowers.length]];
        }
      } else if (ground === _sand && y >= SEA_LEVEL) {
        if (biome === B.DESERT) {
          if (cactusAt(seed, x, z) && cactusRoom(lx, lz, y)) {
            const hgt = 1 + (hash32(seed, x, z, S_CACTUS + 1) % 3);
            for (let k = 1; k <= hgt && y + k < WORLD_HEIGHT; k++) blocks[colIndex(lx, y + k, lz)] = _cactus;
          } else if (r < 0.012) blocks[ai] = _dead_bush;
        }
      } else if ((ground === _sand || ground === _dirt) && y === SEA_LEVEL - 1 && biome !== B.SNOWY) {
        // shoreline level with the water: sugar cane where a neighbour is open water
        if (nextToWater(lx, lz) && hash01(seed, x, z, S_CANE) < 0.2) placeCane(blocks, lx, y + 1, lz, seed, x, z);
      }
    }
  }
  // cave floor mushrooms (dark, below y 40)
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const x = x0 + lx, z = z0 + lz;
      if (hash01(seed, x, z, S_MUSH + 1) > 0.05) continue;
      const top = Math.min(40, caveCeil[lx + lz * 16]);
      for (let y = LAVA_LEVEL + 2; y <= top; y++) {
        const i = colIndex(lx, y, lz);
        if (blocks[i] === _air && blocks[i - 256] === _stone) {
          if (hash01(seed, x, y, z) < 0.12) blocks[i] = (hash32(seed, x, y, z) & 1) ? _brown_mushroom : _red_mushroom;
          break;
        }
      }
    }
  }

  /* 8. snow and ice --------------------------------------------------------------------------------- */
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const c = lx + lz * 16;
      const biome = colBiome[c];
      const snowyBiome = biome === B.SNOWY;
      const topLimit = Math.min(WORLD_HEIGHT - 2, Math.max(surfTop[c], SEA_LEVEL) + 13);
      let y = topLimit;
      while (y > 0 && blocks[colIndex(lx, y, lz)] === _air) y--;
      const i = colIndex(lx, y, lz);
      const id = blocks[i] & 0xff;
      if (snowyBiome && id === _water && y === SEA_LEVEL - 1) { blocks[i] = _ice; continue; }
      if (!(snowyBiome || y >= SNOW_LINE)) continue;
      if (id === _grass_block || id === _dirt || id === _stone || id === _gravel || id === _sand || id === _oak_leaves ||
          id === _birch_leaves || id === _spruce_leaves || id === _granite || id === _diorite || id === _andesite ||
          id === _coal_ore || id === _iron_ore || id === _emerald_ore || id === _clay) {
        blocks[i + 256] = _snow;
        if (id === _grass_block) blocks[i] = _grass_block | (1 << 8); // snowy bit
      }
    }
  }
  return out;

  /* local helpers (closures over this column's scratch) ------------------------------------------------ */
  function nextToWater(lx, lz) {
    // a horizontal neighbour whose column is under water at sea level (unfrozen)
    const hp = (lx + PAD) + (lz + PAD) * PW;
    return padH[hp + 1] < SEA_LEVEL - 1 || padH[hp - 1] < SEA_LEVEL - 1 || padH[hp + PW] < SEA_LEVEL - 1 || padH[hp - PW] < SEA_LEVEL - 1;
  }
  function cactusRoom(lx, lz, y) {
    // cactus needs air on all four sides at every height: neighbours must not be taller than the ground
    const hp = (lx + PAD) + (lz + PAD) * PW;
    return padH[hp + 1] <= y && padH[hp - 1] <= y && padH[hp + PW] <= y && padH[hp - PW] <= y;
  }
}

function tri(lat, b, fx, fy, fz) {
  const a00 = lat[b] + (lat[b + 1] - lat[b]) * fx;
  const a10 = lat[b + 5] + (lat[b + 6] - lat[b + 5]) * fx;
  const a01 = lat[b + 25] + (lat[b + 26] - lat[b + 25]) * fx;
  const a11 = lat[b + 30] + (lat[b + 31] - lat[b + 30]) * fx;
  const a0 = a00 + (a10 - a00) * fz;
  const a1 = a01 + (a11 - a01) * fz;
  return a0 + (a1 - a0) * fy;
}

/** Cactus candidates: one jittered spot per 5x5 cell (min spacing 3, so cacti never touch). */
function cactusAt(seed, x, z) {
  const gx = Math.floor(x / 5), gz = Math.floor(z / 5);
  const h = hash32(seed, gx, gz, S_CACTUS);
  if ((h >>> 8) / 16777216 >= 0.16) return false;
  return x === gx * 5 + (h & 3) % 3 && z === gz * 5 + ((h >>> 2) & 3) % 3;
}

/** Pumpkin (about 1 in 40 columns) or melon (1 in 90) patch around one hashed spot of the column. */
function pumpkinAt(seed, x, z, cx, cz, biome) {
  if (biome !== B.PLAINS && biome !== B.FOREST && biome !== B.TAIGA && biome !== B.BIRCH) return 0;
  const h = hash32(seed, cx, cz, S_PUMPKIN);
  const r = (h >>> 8) / 16777216;
  let id;
  if (r < 1 / 40) id = _pumpkin;
  else if (r < 1 / 40 + 1 / 90 && biome !== B.TAIGA) id = _melon;
  else return 0;
  const px = cx * 16 + 4 + (h & 7), pz = cz * 16 + 4 + ((h >>> 3) & 7);
  const dx = x - px, dz = z - pz;
  if (dx * dx + dz * dz > 5) return 0;
  return hash01(seed, x, z, S_PUMPKIN) < 0.4 || (dx === 0 && dz === 0) ? id : 0;
}

function placeCane(blocks, lx, y, lz, seed, x, z) {
  const hgt = 1 + (hash32(seed, x, z, S_CANE + 1) % 3);
  for (let k = 0; k < hgt && y + k < WORLD_HEIGHT; k++) {
    const i = colIndex(lx, y + k, lz);
    if (blocks[i] !== _air) break;
    blocks[i] = _sugar_cane;
  }
}

/**
 * Y of the topmost solid terrain block at (x, z) BEFORE decoration (used for spawn search, previews, mobs).
 * Must agree with generateColumn (it is the same height function; caves do not change it except at the
 * rare surface openings, and trees/plants are decoration).
 */
export function getTerrainHeight(seed, x, z, preset) {
  if (preset === 'flat') return FLAT_SURFACE_Y - 1;
  return getTerrain(seed >>> 0, preset).sample(Math.floor(x), Math.floor(z)).h;
}

/** Biome id at a world column (must agree with generateColumn's biomes array). */
export function getBiomeAt(seed, x, z, preset) {
  if (preset === 'flat') return B.PLAINS;
  return getTerrain(seed >>> 0, preset).sample(Math.floor(x), Math.floor(z)).biome;
}

/* ------------------------------------------------------------------------------------------ spawn */

const spawnCache = new Map();

/**
 * A good spawn point near the origin: on dry grass (at least 3 blocks from water), open sky (no leaves above),
 * fairly flat, with trees, water or hills in view. Deterministic. Returns FEET position at the centre of the
 * block: {x: bx+0.5, y: surface+1, z: bz+0.5}.
 */
export function findSpawn(seed, preset) {
  seed >>>= 0;
  if (preset === 'flat') return { x: 0.5, y: FLAT_SURFACE_Y, z: 0.5 };
  const key = seed + '|' + preset;
  const hit = spawnCache.get(key);
  if (hit) return { ...hit };
  const T = getTerrain(seed, preset);
  const cands = [];
  const MAX_R = 256, GOOD_R = 112, STEP = 5;
  for (let ring = 0; ring * STEP <= MAX_R; ring++) {
    const rr = ring * STEP;
    // walk the square ring of radius rr (deterministic order)
    const pts = [];
    if (ring === 0) pts.push([0, 0]);
    else {
      for (let i = -rr; i < rr; i += STEP) pts.push([i, -rr]);
      for (let i = -rr; i < rr; i += STEP) pts.push([rr, i]);
      for (let i = rr; i > -rr; i -= STEP) pts.push([i, rr]);
      for (let i = rr; i > -rr; i -= STEP) pts.push([-rr, i]);
    }
    for (const [x, z] of pts) {
      const sc = spawnScore(T, seed, x, z);
      if (sc !== null) cands.push({ x, z, sc: sc - Math.sqrt(x * x + z * z) / 40 });
    }
    if ((rr >= GOOD_R && cands.length) || cands.length >= 80) break;
  }
  cands.sort((a, b) => b.sc - a.sc || (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z) || a.x - b.x || a.z - b.z);
  const out = { blocks: new Uint16Array(COLUMN_VOLUME), biomes: new Uint8Array(256) };
  let lastCol = null;
  for (const cnd of cands.slice(0, 16)) {
    // verify against the real generated column: grass at the surface, nothing solid or leafy above
    for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const x = cnd.x + ox, z = cnd.z + oz;
      const cx = x >> 4, cz = z >> 4;
      if (lastCol !== cx + ',' + cz) { out.blocks.fill(0); generateColumn(seed, cx, cz, preset, out); lastCol = cx + ',' + cz; }
      const y = verifySpawnCell(out.blocks, x & 15, z & 15);
      if (y > 0) {
        const res = { x: x + 0.5, y, z: z + 0.5 };
        spawnCache.set(key, res);
        return { ...res };
      }
    }
  }
  // fallback: highest dry point we know of near the origin
  const h = T.sample(0, 0).h;
  const res = { x: 0.5, y: Math.max(h, SEA_LEVEL - 1) + 1, z: 0.5 };
  spawnCache.set(key, res);
  return { ...res };
}

function verifySpawnCell(blocks, lx, lz) {
  let y = WORLD_HEIGHT - 1;
  while (y > 0) {
    const id = blocks[colIndex(lx, y, lz)] & 0xff;
    if (id !== _air && id !== _short_grass && id !== _fern && !(id >= _dandelion && id <= _pink_tulip)) break;
    y--;
  }
  const id = blocks[colIndex(lx, y, lz)] & 0xff;
  if (id === _snow && (blocks[colIndex(lx, y - 1, lz)] & 0xff) === _grass_block) return y; // snowy preset
  if (id !== _grass_block) return -1;
  // no plant at the feet (clear the view of the first frame), two air cells above
  if ((blocks[colIndex(lx, y + 1, lz)] & 0xff) !== _air) return -1;
  return y + 1;
}

/** null if (x, z) is not a valid spawn; otherwise a score (higher = nicer view). */
function spawnScore(T, seed, x, z) {
  const s = T.sample(x, z);
  const h = s.h, biome = s.biome;
  if (!GRASSY[biome] || biome === B.MOUNTAINS || (biome === B.SNOWY && !T.isSnowy) || h < SEA_LEVEL + 1 || h > 86 || s.river > 0.01 || s.open > 0.68) return null;
  let sc = biome === B.PLAINS ? 5 : biome === B.BIRCH ? 4 : biome === B.FOREST ? 3 : biome === B.TAIGA ? 2 : 0;
  // dry within 3 blocks and flat within 2
  for (let dz = -3; dz <= 3; dz += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      if (dx * dx + dz * dz > 10) continue;
      const hn = T.sample(x + dx, z + dz).h;
      if (hn < SEA_LEVEL) return null;
      if (dx * dx + dz * dz <= 4 && Math.abs(hn - h) > 1) return null;
    }
  }
  // trees: some around, none overhead or right in front of the face (the player starts looking north, -Z)
  let near = 0, blockedView = 0;
  const g0x = Math.floor((x - 16) / TREE_GRID), g1x = Math.floor((x + 16) / TREE_GRID);
  const g0z = Math.floor((z - 16) / TREE_GRID), g1z = Math.floor((z + 16) / TREE_GRID);
  for (let gz = g0z; gz <= g1z; gz++) {
    for (let gx = g0x; gx <= g1x; gx++) {
      const t = treeCandidate(T, seed, gx, gz);
      if (!t) continue;
      const dx = t.x - x, dz = t.z - z, d2 = dx * dx + dz * dz;
      if (d2 <= 36) return null;
      if (d2 <= 256) near++;
      if (dz < 0 && dz >= -12 && Math.abs(dx) <= 2 - dz / 2) blockedView++;
    }
  }
  sc += near === 0 ? -3 : near <= 8 ? 2 + near * 0.5 : near <= 20 ? 4 : 2;
  sc -= blockedView * 3;
  // no wall of ground right in front
  for (let d = 2; d <= 10; d += 2) if (T.sample(x, z - d).h > h + 2 + d / 4) { sc -= 4; break; }
  // a lake or the sea, hills, more than one biome around; extra credit when they are in the first view (north)
  let water = 0, hill = 0, viewWater = 0, viewHill = 0;
  const seen = new Set([biome]);
  for (let k = 0; k < 8; k++) {
    const [ca, sa] = DIRS8[k];
    for (const d of [18, 30, 44]) {
      const p = T.sample(Math.round(x + ca * d), Math.round(z + sa * d));
      const north = k === 5 || k === 6 || k === 7;
      if (p.h < SEA_LEVEL) { water++; if (north) viewWater++; }
      if (p.h > h + 10) { hill++; if (north) viewHill++; }
      seen.add(p.biome);
    }
  }
  if (water) sc += 2;
  if (hill) sc += 1;
  if (viewWater) sc += 3;
  if (viewHill) sc += 2;
  sc += Math.min(3, seen.size - 1);
  return sc;
}
// 8 compass directions (x, z) as constants (no trig in the deterministic path); 5, 6, 7 point north-ish (-Z)
const DIRS8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

/* ------------------------------------------------------------------------------------------ placeTree */

/**
 * Grow a tree (worldgen and saplings/bone meal use the same shapes).
 * @param {(x:number,y:number,z:number,id:number,state?:number)=>void} set  writes a block
 * @param {(x:number,y:number,z:number)=>number} get                        reads a block id
 * @param {number} x @param {number} y  base (the dirt/grass is at y-1) @param {number} z
 * @param {'oak'|'birch'|'spruce'} kind
 * @param {() => number} rand  deterministic [0,1)
 * @returns {boolean} false if there was no room (nothing written)
 */
export function placeTree(set, get, x, y, z, kind, rand) {
  const ids = TREE_KIND_IDS[kind] || TREE_KIND_IDS.oak;
  const [logId, leafId] = ids;
  const below = get(x, y - 1, z);
  if (below !== _grass_block && below !== _dirt && below !== _farmland) return false;
  // collect the shape first (one rand stream), then check room, then write
  const cells = [];
  buildTree(kind in TREE_KIND_IDS ? kind : 'oak', rand, (dx, dy, dz, isLog) => { cells.push(dx, dy, dz, isLog ? 1 : 0); });
  for (let i = 0; i < cells.length; i += 4) {
    const cy = y + cells[i + 1];
    if (cy >= WORLD_HEIGHT) return false;
    if (!cells[i + 3]) continue;
    if (cells[i + 1] === 0) continue; // the sapling itself sits in the base cell
    const id = get(x + cells[i], cy, z + cells[i + 2]);
    if (id !== _air && id !== _short_grass && id !== _fern && id !== _snow && id !== _oak_leaves && id !== _birch_leaves && id !== _spruce_leaves) return false;
  }
  if (below === _grass_block || below === _farmland) set(x, y - 1, z, _dirt, 0);
  for (let i = 0; i < cells.length; i += 4) {
    const cx = x + cells[i], cy = y + cells[i + 1], cz = z + cells[i + 2];
    if (cells[i + 3]) set(cx, cy, cz, logId, 0);
    else {
      const id = get(cx, cy, cz);
      if (id === _air || id === _short_grass || id === _fern || id === _snow) set(cx, cy, cz, leafId, 0);
    }
  }
  return true;
}
