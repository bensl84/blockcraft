// OWNER LANE: CORE-C (world data/lighting/mesher). Written by LEAD as the frozen data layout (SPEC §5.3).
// CORE-C may add fields/methods but must not change the meaning or layout of the existing ones.

import { COLUMN_VOLUME, SECTIONS_PER_COLUMN, colIndex } from '../core/constants.js';

/** Column pipeline states (monotonic while loaded). */
export const COL_STATE = Object.freeze({ EMPTY: 0, GENERATED: 1, LIT: 2, MESHED: 3 });

const ALL_SECTIONS = (1 << SECTIONS_PER_COLUMN) - 1;

export class Column {
  /**
   * @param {number} cx @param {number} cz
   * @param {Uint16Array} [blocks] optional ready-made block array (worker result, transferred) - adopted, not copied
   * @param {Uint8Array} [biomes] optional ready-made biome array
   */
  constructor(cx, cz, blocks = null, biomes = null) {
    this.cx = cx;
    this.cz = cz;
    /** id | state<<8 ; index = colIndex(lx, y, lz) = lx | lz<<4 | y<<8 ; section s = [s*4096, s*4096+4096) */
    this.blocks = blocks && blocks.length === COLUMN_VOLUME ? blocks : new Uint16Array(COLUMN_VOLUME);
    /** sky<<4 | block ; same index as blocks */
    this.light = new Uint8Array(COLUMN_VOLUME);
    /** per (lx + lz*16): lowest y such that every cell at y' >= y lets full sky light through (filter 0). 0..128 */
    this.heightmap = new Uint8Array(256);
    /** per (lx + lz*16): biome id (worldgen BIOMES) */
    this.biomes = biomes && biomes.length === 256 ? biomes : new Uint8Array(256);
    this.state = COL_STATE.EMPTY;
    /** bit s set => section s needs (re)meshing */
    this.dirtyMask = 0;
    /** bit s set => section s has at least one non-air block (maintained by CORE-C; conservative: may stay set) */
    this.nonEmptyMask = ALL_SECTIONS;
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

    /* ---- CORE-C additions (internal; other lanes must not rely on them) ---- */
    /** bit s => dirty because of an edit: remeshed synchronously in the same frame (subset of dirtyMask) */
    this.urgentMask = 0;
    /** bit s => the renderer currently holds a mesh for section s */
    this.meshedMask = 0;
    /** bit s => a worker mesh job is in flight for section s (with pendingVer[s]) */
    this.pendingMask = 0;
    /** per-section edit/light version, bumped on every dirty mark; stale worker results are dropped */
    this.secVersion = new Uint32Array(SECTIONS_PER_COLUMN);
    this.pendingVer = new Uint32Array(SECTIONS_PER_COLUMN);
    /** meshing has started for this column (its sections may be on screen) */
    this.meshStarted = false;
    /** heightmap valid (computed when the column became GENERATED) */
    this.heightReady = false;
  }

  getRaw(lx, y, lz) { return this.blocks[colIndex(lx, y, lz)]; }
  setRaw(lx, y, lz, v) { this.blocks[colIndex(lx, y, lz)] = v; }
  getLight(lx, y, lz) { return this.light[colIndex(lx, y, lz)]; }
  markDirty(sy) {
    if (sy >= 0 && sy < SECTIONS_PER_COLUMN) { this.dirtyMask |= 1 << sy; this.secVersion[sy]++; }
  }
  /** Mark dirty because of an edit: remeshed in the same frame. */
  markUrgent(sy) {
    if (sy >= 0 && sy < SECTIONS_PER_COLUMN) { this.dirtyMask |= 1 << sy; this.urgentMask |= 1 << sy; this.secVersion[sy]++; }
  }
  /** Recompute nonEmptyMask by scanning (cheap: early exit per section). */
  computeNonEmpty() {
    let m = 0;
    const b = this.blocks;
    for (let s = 0; s < SECTIONS_PER_COLUMN; s++) {
      const end = (s + 1) << 12;
      for (let i = s << 12; i < end; i++) if (b[i] !== 0) { m |= 1 << s; break; }
    }
    this.nonEmptyMask = m;
    return m;
  }
}
