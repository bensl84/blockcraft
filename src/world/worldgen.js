// OWNER LANE: CORE-B (worldgen). STUB written by LEAD - replace the bodies, keep the exported signatures.
// Spec: docs/SPEC.md §5.2. Must be PURE and DETERMINISTIC: same (seed, cx, cz, preset) -> identical blocks,
// no Math.random, no DOM, no three.js (runs in Node tests and in workers).
//
// Stub behaviour: 'flat' preset is final-correct (bedrock y0, dirt y1-2, grass y3). Every other preset gets
// gentle sine hills of grass/dirt/stone over bedrock with a few flowers - enough for other lanes to test.

import { registerStub } from '../core/stubs.js';
import { COLUMN_VOLUME, FLAT_SURFACE_Y, SEA_LEVEL, colIndex } from '../core/constants.js';
import { ID } from '../core/registry.js';
import { hash01 } from '../core/math.js';

registerStub('worldgen');

/**
 * Biome table. id is stored per column cell in Column.biomes (Uint8). Order is save-stable.
 * Which animals live in a biome is NOT here: data/mobs.js MOBS[type].biomes is authoritative (mobsForBiome()).
 */
export const BIOMES = Object.freeze([
  { id: 0, name: 'plains', surface: 'grass_block', filler: 'dirt', trees: { kinds: ['oak'], perColumn: 0.15 }, flowers: ['dandelion', 'poppy', 'cornflower', 'orange_tulip', 'pink_tulip'], grassDensity: 0.25 },
  { id: 1, name: 'forest', surface: 'grass_block', filler: 'dirt', trees: { kinds: ['oak', 'birch'], perColumn: 3.5 }, flowers: ['dandelion', 'poppy', 'lily_of_the_valley', 'allium'], grassDensity: 0.15 },
  { id: 2, name: 'desert', surface: 'sand', filler: 'sandstone', trees: { kinds: [], perColumn: 0 }, flowers: ['dead_bush'], grassDensity: 0.02 },
  { id: 3, name: 'snowy', surface: 'grass_block', filler: 'dirt', snowLayer: true, trees: { kinds: ['spruce'], perColumn: 0.6 }, flowers: [], grassDensity: 0.05 },
  { id: 4, name: 'birch_forest', surface: 'grass_block', filler: 'dirt', trees: { kinds: ['birch'], perColumn: 3 }, flowers: ['allium', 'blue_orchid', 'lily_of_the_valley'], grassDensity: 0.15 },
  { id: 5, name: 'taiga', surface: 'grass_block', filler: 'dirt', trees: { kinds: ['spruce'], perColumn: 3 }, flowers: ['fern'], grassDensity: 0.2 },
  { id: 6, name: 'beach', surface: 'sand', filler: 'sand', trees: { kinds: [], perColumn: 0 }, flowers: [], grassDensity: 0 },
  { id: 7, name: 'ocean', surface: 'sand', filler: 'sand', trees: { kinds: [], perColumn: 0 }, flowers: [], grassDensity: 0 },
  { id: 8, name: 'mountains', surface: 'grass_block', filler: 'stone', trees: { kinds: ['spruce'], perColumn: 0.3 }, flowers: ['cornflower'], grassDensity: 0.1 },
]);
export const BIOME_BY_NAME = Object.freeze(Object.fromEntries(BIOMES.map((b) => [b.name, b.id])));

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
  biomes.fill(preset === 'snowy' ? 3 : 0);
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const wx = cx * 16 + lx, wz = cz * 16 + lz;
      const top = getTerrainHeight(seed, wx, wz, preset);
      blocks[colIndex(lx, 0, lz)] = ID.bedrock;
      for (let y = 1; y <= top; y++) {
        let id;
        if (preset === 'flat') id = y === top ? ID.grass_block : ID.dirt;
        else id = y === top ? ID.grass_block : y >= top - 3 ? ID.dirt : ID.stone;
        blocks[colIndex(lx, y, lz)] = id;
      }
      if (preset !== 'flat') {
        const r = hash01(seed, wx, 7, wz);
        if (r < 0.04) blocks[colIndex(lx, top + 1, lz)] = r < 0.02 ? ID.dandelion : ID.poppy;
        else if (r < 0.12) blocks[colIndex(lx, top + 1, lz)] = ID.short_grass;
      }
    }
  }
  return out;
}

/**
 * Y of the topmost solid terrain block at (x, z) BEFORE decoration (used for spawn search, previews, mobs).
 * Must agree with generateColumn.
 */
export function getTerrainHeight(seed, x, z, preset) {
  if (preset === 'flat') return FLAT_SURFACE_Y - 1;
  return SEA_LEVEL + 4 + Math.round(3 * Math.sin(x / 13 + (seed & 7)) * Math.cos(z / 17));
}

/** Biome id at a world column (must agree with generateColumn's biomes array). */
export function getBiomeAt(seed, x, z, preset) { return preset === 'snowy' ? 3 : 0; }

/**
 * A good spawn point near the origin: on land (not water/lava/leaves), open sky, preferably grass with
 * animals/trees nearby. Returns FEET position at the centre of the block: {x: bx+0.5, y: surface+1, z: bz+0.5}.
 */
export function findSpawn(seed, preset) {
  const y = getTerrainHeight(seed, 0, 0, preset) + 1;
  return { x: 0.5, y, z: 0.5 };
}

/**
 * Grow a tree (worldgen and saplings/bone meal use the same shapes).
 * @param {(x:number,y:number,z:number,id:number,state?:number)=>void} set  writes a block
 * @param {(x:number,y:number,z:number)=>number} get                        reads a block id
 * @param {number} x @param {number} y  base (the dirt/grass is at y-1) @param {number} z
 * @param {'oak'|'birch'|'spruce'} kind
 * @param {() => number} rand  deterministic [0,1) source
 * @returns {boolean} false if there was no room (nothing written)
 */
export function placeTree(set, get, x, y, z, kind, rand) {
  const log = kind === 'birch' ? ID.birch_log : kind === 'spruce' ? ID.spruce_log : ID.oak_log;
  const leaves = kind === 'birch' ? ID.birch_leaves : kind === 'spruce' ? ID.spruce_leaves : ID.oak_leaves;
  const h = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < h; i++) if (get(x, y + i, z) !== ID.air && i > 0) return false;
  for (let dy = h - 2; dy <= h + 1; dy++) {
    const r = dy >= h ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.abs(dx) === r && Math.abs(dz) === r && rand() < 0.5) continue;
      if (get(x + dx, y + dy, z + dz) === ID.air) set(x + dx, y + dy, z + dz, leaves, 0);
    }
  }
  for (let i = 0; i < h; i++) set(x, y + i, z, log, 0);
  return true;
}
