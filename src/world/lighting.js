// OWNER LANE: CORE-C (world data/lighting/mesher). STUB written by LEAD - replace bodies, keep signatures.
// Spec: docs/SPEC.md §5.3.4 (two-channel BFS flood fill: sky + block, removal + re-propagation, across
// column borders in world coordinates, dirty-marking neighbour sections whose AO/smooth light changes;
// relightBatch = ONE combined removal + propagation pass for a whole world.beginBatch()/endBatch() batch;
// initial lighting <= RENDER.LIGHT_COLUMN_BUDGET_MS per column on the weak proxy).
//
// Stub behaviour: sky light = 15 above the heightmap, 0 below; block light = emitters' own cell only.

import { registerStub } from '../core/stubs.js';
import { B_FILTER, B_EMIT } from '../core/registry.js';
import { WORLD_HEIGHT, colIndex } from '../core/constants.js';

registerStub('lighting');

/** Recompute col.heightmap for every (lx, lz). heightmap = lowest y with only filter-0 cells at and above it. */
export function computeHeightmap(col) {
  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) computeHeightAt(col, lx, lz);
}
function computeHeightAt(col, lx, lz) {
  let y = WORLD_HEIGHT - 1;
  while (y >= 0 && B_FILTER[col.blocks[colIndex(lx, y, lz)] & 0xff] === 0) y--;
  col.heightmap[lx + lz * 16] = y + 1;
}

/**
 * Initial light for a freshly generated/loaded column (state GENERATED -> LIT). Must also pull light from
 * already-LIT neighbours and push into them (border reconciliation), marking their touched sections dirty.
 * @param {object} world World system (getColumn, markSectionDirty...) @param {import('./column.js').Column} col
 */
export function lightColumn(world, col) {
  computeHeightmap(col);
  const L = col.light;
  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const h = col.heightmap[lx + lz * 16];
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      const i = colIndex(lx, y, lz);
      L[i] = ((y >= h ? 15 : 0) << 4) | B_EMIT[col.blocks[i] & 0xff];
    }
  }
}

/**
 * Incremental relight after world.setBlock changed (x,y,z) from oldRaw to newRaw (world coords).
 * Must update both channels and call world.markSectionDirtyAt(x, y, z) for every changed cell's section
 * (and border neighbours). Stub: recompute that x/z's sky column + the cell's own block light.
 */
/**
 * Combined relight after a batch of edits (world.endBatch). changes is a flat array of
 * (x, y, z, oldRaw, newRaw) quintuples. Real implementation: seed removal + propagation queues from every
 * changed cell and run the BFS once. Stub: relight each distinct x/z column once.
 * @param {object} world @param {number[]} changes
 */
export function relightBatch(world, changes) {
  const seen = new Set();
  for (let k = 0; k < changes.length; k += 5) {
    const x = changes[k], z = changes[k + 2];
    const key = x + ',' + z;
    if (seen.has(key)) continue;
    seen.add(key);
    relightBlock(world, x, changes[k + 1], z, changes[k + 3], changes[k + 4]);
  }
}

export function relightBlock(world, x, y, z, oldRaw, newRaw) {
  const col = world.getColumn(x >> 4, z >> 4);
  if (!col) return;
  const lx = x & 15, lz = z & 15;
  computeHeightAt(col, lx, lz);
  const h = col.heightmap[lx + lz * 16];
  for (let yy = 0; yy < WORLD_HEIGHT; yy++) {
    const i = colIndex(lx, yy, lz);
    const old = col.light[i];
    const v = ((yy >= h ? 15 : 0) << 4) | B_EMIT[col.blocks[i] & 0xff];
    if (v !== old) { col.light[i] = v; world.markSectionDirtyAt(x, yy, z); }
  }
}
