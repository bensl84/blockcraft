// OWNER LANE: CORE-C (world data/lighting/mesher). Written by LEAD as the frozen data layout (SPEC §5.3).
// CORE-C may add fields/methods but must not change the meaning or layout of the existing ones.

import { COLUMN_VOLUME, SECTIONS_PER_COLUMN, colIndex } from '../core/constants.js';

/** Column pipeline states (monotonic while loaded). */
export const COL_STATE = Object.freeze({ EMPTY: 0, GENERATED: 1, LIT: 2, MESHED: 3 });

export class Column {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    /** id | state<<8 ; index = colIndex(lx, y, lz) = lx | lz<<4 | y<<8 ; section s = [s*4096, s*4096+4096) */
    this.blocks = new Uint16Array(COLUMN_VOLUME);
    /** sky<<4 | block ; same index as blocks */
    this.light = new Uint8Array(COLUMN_VOLUME);
    /** per (lx + lz*16): lowest y such that every cell at y' >= y lets full sky light through (filter 0). 0..128 */
    this.heightmap = new Uint8Array(256);
    /** per (lx + lz*16): biome id (worldgen BIOMES) */
    this.biomes = new Uint8Array(256);
    this.state = COL_STATE.EMPTY;
    /** bit s set => section s needs (re)meshing */
    this.dirtyMask = 0;
    /** bit s set => section s has at least one non-air block (maintained by CORE-C; stub: all set) */
    this.nonEmptyMask = (1 << SECTIONS_PER_COLUMN) - 1;
    /** true once the player (or anything non-worldgen) changed a block: the column must be persisted */
    this.modified = false;
    /** true when changed since the last save */
    this.saveDirty = false;
    /** true when this column was generated this session (false when restored from a save) */
    this.fresh = true;
    /** block entities (chest/furnace contents...) keyed by colIndex(lx, y, lz) */
    this.blockEntities = new Map();
    /** game tick of the last access (for unloading heuristics) */
    this.lastTouched = 0;
  }

  getRaw(lx, y, lz) { return this.blocks[colIndex(lx, y, lz)]; }
  setRaw(lx, y, lz, v) { this.blocks[colIndex(lx, y, lz)] = v; }
  getLight(lx, y, lz) { return this.light[colIndex(lx, y, lz)]; }
  markDirty(sy) { if (sy >= 0 && sy < SECTIONS_PER_COLUMN) this.dirtyMask |= 1 << sy; }
}
