// OWNER LANE: CORE-C (world data/lighting/mesher). STUB written by LEAD - the API is FROZEN (SPEC §5.3.2);
// replace the internals (proper LIT gating on neighbours, time-budgeted queues, look-direction bias,
// incremental lighting, combined batch relight, worker offload - P0, SPEC §5.3.5).
//
// Stub behaviour: works end-to-end with the stub worldgen/lighting/mesher so other lanes can test:
// columns stream around the player, edits remesh immediately, batches relight once, saves can export
// modified columns, and modified columns survive unload -> reload (SPEC §5.3.3 "saved data wins").
//
// PERSISTENCE INVARIANT (SPEC §5.3.3): a loaded column is the authority for its own data. For every MODIFIED
// column that is NOT loaded, world.savedColumns holds the latest data (encoded bytes, decoded lazily);
// world.pendingSave additionally holds the ones not yet written to IndexedDB. Never drop either without
// moving the data to the other or into a loaded column.

import { registerStub } from '../core/stubs.js';
import { COL_STATE, Column } from './column.js';
import { generateColumn } from './worldgen.js';
import { lightColumn, relightBatch, relightBlock } from './lighting.js';
import { PADDED_VOLUME, buildPadded, meshSection } from './mesher.js';
import { B_SOLID, getCollisionBoxes } from '../core/registry.js';
import { RENDER, SECTIONS_PER_COLUMN, WORLD_HEIGHT, colIndex, colKey, packBlock } from '../core/constants.js';
import { decodeColumn, encodeColumn } from '../save/codec.js';

registerStub('world');

/**
 * Column record used by savedColumns / pendingSave / exportColumn:
 *   {blocks?: Uint16Array(32768), data?: Uint8Array (save/codec.js encodeColumn bytes), blockEntities?: [{i, data}]}
 * At least one of `blocks` / `data` is present. exportColumn() always returns `blocks`; savedColumns entries
 * written by the world are compact (`data`), and FEATURE-MENUS loadWorld() should hand over `data` too so
 * columns are only decoded when they are actually visited.
 */
function recordBlocks(rec) { return rec.blocks || decodeColumn(rec.data); }
function compactRecord(rec) { return rec.data && !rec.blocks ? rec : { data: encodeColumn(rec.blocks), blockEntities: rec.blockEntities || [] }; }

/**
 * @param {object} game
 * @returns {object} World system (game.world). See SPEC §5.3.2 for every member.
 */
export function createWorldSystem(game) {
  /** @type {Map<string, Column>} */
  const columns = new Map();
  const padBlocks = new Uint16Array(PADDED_VOLUME);
  const padLight = new Uint8Array(PADDED_VOLUME);
  const offsets = buildOffsets(RENDER.MAX_DISTANCE + RENDER.UNLOAD_MARGIN + 1);
  let genMs = 0, meshMs = 0, genCount = 0, meshCount = 0;
  /** batch state: nesting depth + flat list of changes (x, y, z, oldRaw, newRaw) */
  let batchDepth = 0;
  let batchChanges = [];

  const world = {
    name: 'world',
    stub: true,
    isOpen: false,
    seed: 0,
    preset: 'default',
    /** chunks (columns) of radius that get meshed */
    renderDistance: RENDER.DEFAULT_DISTANCE,
    columns,
    /** latest data of every modified column that is not loaded: colKey -> column record (see recordBlocks) */
    savedColumns: new Map(),
    /** records of unloaded columns changed since the last save (FEATURE-MENUS writes them, then markColumnSaved) */
    pendingSave: new Map(),
    center: { cx: 0, cz: 0 },

    init() {
      // Settings that need world work (SPEC §8.4.1 "setting owners"): render distance and smooth lighting.
      // fancyLeaves belongs to CORE-D (texture rebuild), which then calls world.remeshAll().
      game.events.on('settings:changed', (e) => {
        if (e.key === 'renderDistance' && e.value > 0) world.setRenderDistance(e.value);
        else if (e.key === 'smoothLighting') world.remeshAll();
      });
    },

    /**
     * Open a world. savedColumns: Map colKey -> column record ({data: Uint8Array} preferred, or {blocks}),
     * plus blockEntities [{i: colIndex, data}]. Clears any previous world.
     */
    open(meta, savedColumns = null) {
      world.close();
      world.seed = meta.seed >>> 0;
      world.preset = meta.preset || 'default';
      world.savedColumns = savedColumns || new Map();
      world.pendingSave = new Map();
      world.isOpen = true;
    },

    /** Unload everything (meshes removed from the renderer). No export: callers save first (exitToTitle). */
    close() {
      for (const col of columns.values()) if (game.renderer) game.renderer.removeColumnMeshes(col.cx, col.cz);
      columns.clear();
      batchDepth = 0; batchChanges = [];
      world.isOpen = false;
    },

    getColumn(cx, cz) { return columns.get(colKey(cx, cz)) || null; },
    /** true when the column is generated AND lit (safe for gameplay/physics). */
    isColumnLoaded(cx, cz) { const c = columns.get(colKey(cx, cz)); return !!c && c.state >= COL_STATE.LIT; },
    forEachColumn(fn) { for (const c of columns.values()) fn(c); },

    /** Packed value id | state<<8 (0 for unloaded / out of range). */
    getRaw(x, y, z) {
      if (y < 0 || y >= WORLD_HEIGHT) return 0;
      const c = columns.get(colKey(Math.floor(x) >> 4, Math.floor(z) >> 4));
      return c ? c.blocks[colIndex(Math.floor(x) & 15, Math.floor(y), Math.floor(z) & 15)] : 0;
    },
    getBlock(x, y, z) { return world.getRaw(x, y, z) & 0xff; },
    getState(x, y, z) { return world.getRaw(x, y, z) >> 8; },
    /** sky<<4 | block. Above the world: 0xF0. Below: 0. Unloaded: 0xF0. */
    getLight(x, y, z) {
      if (y >= WORLD_HEIGHT) return 0xf0;
      if (y < 0) return 0;
      const c = columns.get(colKey(Math.floor(x) >> 4, Math.floor(z) >> 4));
      return c ? c.light[colIndex(Math.floor(x) & 15, Math.floor(y), Math.floor(z) & 15)] : 0xf0;
    },
    getSkyLight(x, y, z) { return world.getLight(x, y, z) >> 4; },
    getBlockLight(x, y, z) { return world.getLight(x, y, z) & 15; },
    /** heightmap value (see Column.heightmap); WORLD_HEIGHT for unloaded. */
    getHeight(x, z) {
      const c = columns.get(colKey(Math.floor(x) >> 4, Math.floor(z) >> 4));
      return c ? c.heightmap[(Math.floor(x) & 15) + (Math.floor(z) & 15) * 16] : WORLD_HEIGHT;
    },
    /** Feet Y to stand on the highest block with collision at (x,z): top of its collision box. -1 if none/unloaded. */
    getSurfaceY(x, z) {
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const v = world.getRaw(x, y, z), id = v & 0xff;
        if (B_SOLID[id]) {
          const boxes = getCollisionBoxes(id, v >> 8);
          if (boxes.length) return y + Math.max(...boxes.map((b) => b[4]));
        }
      }
      return -1;
    },

    /**
     * Change a block. Handles heightmap, lighting, dirty sections (+ border neighbours), modified/save flags and
     * emits 'block:changed' {x,y,z, oldId, oldState, id, state, cause, action} unless opts.silent.
     * Inside beginBatch()/endBatch() the relight and dirty-marking are deferred to endBatch() (one combined
     * pass); 'block:changed' is still emitted per cell immediately (light values are stale until endBatch).
     * @param {{cause?: string, silent?: boolean, keepBlockEntity?: boolean, action?: number}} [opts]
     *        action: id of the player action / explosion this change belongs to (undo grouping, SPEC §8.5.2)
     * @returns {boolean} false if the column is not loaded or y out of range or nothing changed
     */
    setBlock(x, y, z, id, state = 0, opts = {}) {
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      if (y < 0 || y >= WORLD_HEIGHT) return false;
      const col = columns.get(colKey(x >> 4, z >> 4));
      if (!col || col.state < COL_STATE.GENERATED) return false;
      const i = colIndex(x & 15, y, z & 15);
      const old = col.blocks[i];
      const nv = packBlock(id, state);
      if (old === nv) return false;
      col.blocks[i] = nv;
      if (!opts.keepBlockEntity && col.blockEntities.has(i)) col.blockEntities.delete(i);
      if (opts.cause !== 'worldgen') { col.modified = true; col.saveDirty = true; }
      if (batchDepth > 0) batchChanges.push(x, y, z, old, nv);
      else { relightBlock(world, x, y, z, old, nv); world.markSectionDirtyAt(x, y, z); }
      if (!opts.silent) {
        game.events.emit('block:changed', {
          x, y, z, oldId: old & 0xff, oldState: old >> 8, id: id & 0xff, state: state & 0xff,
          cause: opts.cause || 'unknown', action: opts.action | 0,
        });
      }
      return true;
    },

    /**
     * Bulk edits (explosions, tree growth, fluids): between beginBatch() and endBatch() every setBlock defers
     * its relight and remesh marking; endBatch() runs ONE combined relight (lighting.relightBatch) and merges
     * the dirty sections. Batches nest; only the outermost endBatch() does the work. Always pair them
     * (try/finally).
     */
    beginBatch() { batchDepth++; },
    endBatch() {
      if (batchDepth === 0) return;
      if (--batchDepth > 0 || batchChanges.length === 0) return;
      const list = batchChanges;
      batchChanges = [];
      relightBatch(world, list);
      for (let k = 0; k < list.length; k += 5) world.markSectionDirtyAt(list[k], list[k + 1], list[k + 2]);
    },
    /** true while inside beginBatch()/endBatch(). */
    inBatch() { return batchDepth > 0; },
    /**
     * Convenience batch: list of [x, y, z, id, state?]. Same opts as setBlock (applied to every cell).
     * @returns {number} cells actually changed
     */
    setBlocks(list, opts = {}) {
      let n = 0;
      world.beginBatch();
      try { for (const c of list) if (world.setBlock(c[0], c[1], c[2], c[3], c[4] || 0, opts)) n++; } finally { world.endBatch(); }
      return n;
    },

    /** Mark the section containing (x,y,z) dirty, plus neighbour sections when on a section border. */
    markSectionDirtyAt(x, y, z) {
      const cx = x >> 4, cz = z >> 4, sy = y >> 4;
      const lx = x & 15, lz = z & 15, ly = y & 15;
      world.markSectionDirty(cx, sy, cz);
      if (lx === 0) world.markSectionDirty(cx - 1, sy, cz);
      if (lx === 15) world.markSectionDirty(cx + 1, sy, cz);
      if (lz === 0) world.markSectionDirty(cx, sy, cz - 1);
      if (lz === 15) world.markSectionDirty(cx, sy, cz + 1);
      if (ly === 0) world.markSectionDirty(cx, sy - 1, cz);
      if (ly === 15) world.markSectionDirty(cx, sy + 1, cz);
    },
    markSectionDirty(cx, sy, cz) { const c = columns.get(colKey(cx, cz)); if (c) c.markDirty(sy); },

    /**
     * Re-mesh every loaded column (smoothLighting / fancyLeaves changed). Columns drop back to LIT so the
     * streaming loop rebuilds them nearest-first inside the frame budget; old meshes stay until replaced.
     */
    remeshAll() {
      for (const c of columns.values()) {
        if (c.state === COL_STATE.MESHED) { c.state = COL_STATE.LIT; c.dirtyMask = (1 << SECTIONS_PER_COLUMN) - 1; }
      }
    },

    /** Block entity (chest/furnace data object) at a world cell, or null. */
    getBlockEntity(x, y, z) {
      const c = columns.get(colKey(Math.floor(x) >> 4, Math.floor(z) >> 4));
      return c ? c.blockEntities.get(colIndex(Math.floor(x) & 15, Math.floor(y), Math.floor(z) & 15)) || null : null;
    },
    /** Set/clear (null) a block entity. Marks the column modified. */
    setBlockEntity(x, y, z, data) {
      const c = columns.get(colKey(Math.floor(x) >> 4, Math.floor(z) >> 4));
      if (!c) return false;
      const i = colIndex(Math.floor(x) & 15, Math.floor(y), Math.floor(z) & 15);
      if (data) c.blockEntities.set(i, data); else c.blockEntities.delete(i);
      c.modified = true; c.saveDirty = true;
      return true;
    },
    /** Iterate all loaded block entities: fn(data, x, y, z). */
    forEachBlockEntity(fn) {
      for (const c of columns.values()) for (const [i, data] of c.blockEntities) {
        fn(data, c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15));
      }
    },

    setRenderDistance(n) {
      world.renderDistance = Math.max(RENDER.MIN_DISTANCE, Math.min(RENDER.MAX_DISTANCE, Math.round(n)));
      game.events.emit('world:renderDistance', { distance: world.renderDistance });
    },

    /** Generate (or restore) + light a column synchronously. Returns it. */
    ensureColumn(cx, cz) {
      const key = colKey(cx, cz);
      let col = columns.get(key);
      if (col && col.state >= COL_STATE.LIT) return col;
      const t0 = performance.now();
      if (!col) {
        col = new Column(cx, cz);
        const pending = world.pendingSave.get(key);
        const saved = pending || world.savedColumns.get(key);
        if (saved) {
          // Saved data wins. The loaded column becomes the authority: drop both records (unload re-exports).
          col.blocks.set(recordBlocks(saved));
          col.fresh = false;
          col.modified = true;
          col.saveDirty = !!pending; // not yet in IndexedDB -> keep it in getDirtyColumns()
          if (saved.blockEntities) for (const be of saved.blockEntities) col.blockEntities.set(be.i, be.data);
          world.pendingSave.delete(key);
          world.savedColumns.delete(key);
        } else {
          generateColumn(world.seed, cx, cz, world.preset, col);
        }
        col.state = COL_STATE.GENERATED;
        columns.set(key, col);
        game.events.emit('world:columnGenerated', { cx, cz, fresh: col.fresh });
      }
      lightColumn(world, col);
      col.state = COL_STATE.LIT;
      col.dirtyMask = (1 << SECTIONS_PER_COLUMN) - 1;
      genMs += performance.now() - t0; genCount++;
      // Lit = gameplay-safe: MOBS spawns chunk-generation animals here when fresh (light is valid now).
      game.events.emit('world:columnLoaded', { cx, cz, fresh: col.fresh });
      return col;
    },

    /** Mesh every dirty section of a column now. */
    meshColumn(col) {
      const t0 = performance.now();
      for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
        if (!(col.dirtyMask & (1 << sy))) continue;
        const has = buildPadded(world, col.cx, sy, col.cz, padBlocks, padLight);
        const mesh = has ? meshSection(padBlocks, padLight, { fancyLeaves: game.settings.fancyLeaves, smoothLighting: game.settings.smoothLighting }) : null;
        if (game.renderer) game.renderer.setSectionMesh(col.cx, sy, col.cz, mesh);
        meshCount++;
      }
      col.dirtyMask = 0;
      col.state = COL_STATE.MESHED;
      meshMs += performance.now() - t0;
    },

    /**
     * Synchronously prepare the spawn area: generate+light radius+1, mesh radius. Yields to the browser
     * between slices so the loading screen can update. onProgress(done, total).
     */
    async pregenerate(cx, cz, radius = RENDER.SPAWN_RADIUS, onProgress = null) {
      const gen = offsets.filter(([dx, dz]) => dx * dx + dz * dz <= (radius + 1) * (radius + 1));
      const mesh = offsets.filter(([dx, dz]) => dx * dx + dz * dz <= radius * radius);
      const total = gen.length + mesh.length;
      let done = 0, t0 = performance.now();
      const yieldIfNeeded = async () => {
        if (performance.now() - t0 > RENDER.LOADING_BUDGET_MS) {
          if (onProgress) onProgress(done, total);
          await new Promise((r) => setTimeout(r, 0));
          t0 = performance.now();
        }
      };
      for (const [dx, dz] of gen) { world.ensureColumn(cx + dx, cz + dz); done++; await yieldIfNeeded(); }
      for (const [dx, dz] of mesh) { world.meshColumn(world.getColumn(cx + dx, cz + dz)); done++; await yieldIfNeeded(); }
      if (onProgress) onProgress(total, total);
    },

    /** Per-frame streaming around the player within the chunk budget (SPEC §5.3.3). */
    frame(g, dt) {
      if (!world.isOpen || !game.player) return;
      const pcx = Math.floor(game.player.x) >> 4, pcz = Math.floor(game.player.z) >> 4;
      world.center.cx = pcx; world.center.cz = pcz;
      const R = world.renderDistance;
      const t0 = performance.now();
      const budget = game.state === 'loading' ? RENDER.LOADING_BUDGET_MS : RENDER.CHUNK_BUDGET_MS;
      // 1) edits first: remesh dirty sections of already meshed columns (no budget - edits must feel instant)
      for (const col of columns.values()) if (col.state === COL_STATE.MESHED && col.dirtyMask) world.meshColumn(col);
      // 2) generate/light out to R+DATA_MARGIN-1, mesh within R (nearest first)
      for (const [dx, dz] of offsets) {
        if (performance.now() - t0 > budget) break;
        const d2 = dx * dx + dz * dz;
        if (d2 > (R + 1) * (R + 1)) break;
        const col = world.ensureColumn(pcx + dx, pcz + dz);
        if (d2 <= R * R && (col.state !== COL_STATE.MESHED || col.dirtyMask)) {
          for (let nx = -1; nx <= 1; nx++) for (let nz = -1; nz <= 1; nz++) world.ensureColumn(col.cx + nx, col.cz + nz);
          world.meshColumn(col);
        }
      }
      // 3) unload far columns (hysteresis)
      const U = R + RENDER.UNLOAD_MARGIN;
      for (const [key, col] of columns) {
        const dx = col.cx - pcx, dz = col.cz - pcz;
        if (dx * dx + dz * dz > U * U) unloadColumn(key, col);
      }
    },

    /**
     * Number of columns within radius r (columns) of the player's column that are not meshed yet. The
     * player lane caps kid-scheme flight speed while this exceeds KID.STREAM_BACKLOG_COLUMNS (SPEC §2.1).
     */
    unmeshedWithin(r) {
      const r2 = r * r;
      let n = 0;
      for (const [dx, dz] of offsets) {
        if (dx * dx + dz * dz > r2) break;
        const c = columns.get(colKey(world.center.cx + dx, world.center.cz + dz));
        if (!c || c.state !== COL_STATE.MESHED) n++;
      }
      return n;
    },

    /** Loaded columns changed since their last save: Array<[cx, cz]>. Unloaded ones are in world.pendingSave. */
    getDirtyColumns() {
      const out = [];
      for (const c of columns.values()) if (c.modified && c.saveDirty) out.push([c.cx, c.cz]);
      return out;
    },
    /** Snapshot for saving: {blocks: Uint16Array copy, blockEntities: [{i, data}]} (pendingSave record if unloaded). */
    exportColumn(cx, cz) {
      const c = columns.get(colKey(cx, cz));
      if (!c) {
        const p = world.pendingSave.get(colKey(cx, cz));
        return p ? { blocks: recordBlocks(p), blockEntities: p.blockEntities || [] } : null;
      }
      return { blocks: c.blocks.slice(), blockEntities: [...c.blockEntities].map(([i, data]) => ({ i, data: JSON.parse(JSON.stringify(data)) })) };
    },
    /**
     * The save lane wrote this column (call synchronously right after exportColumn, in the same task).
     * Loaded: clears saveDirty. Unloaded: MOVES the pendingSave record into savedColumns (never drops it).
     */
    markColumnSaved(cx, cz) {
      const key = colKey(cx, cz);
      const c = columns.get(key);
      if (c) c.saveDirty = false;
      const p = world.pendingSave.get(key);
      if (p) { world.savedColumns.set(key, compactRecord(p)); world.pendingSave.delete(key); }
    },

    stats() {
      let meshed = 0;
      for (const c of columns.values()) if (c.state === COL_STATE.MESHED) meshed++;
      return {
        columns: columns.size, columnsMeshed: meshed, genAvgMs: genCount ? genMs / genCount : 0, meshAvgMs: meshCount ? meshMs / meshCount : 0,
        renderDistance: world.renderDistance, savedColumns: world.savedColumns.size, pendingSave: world.pendingSave.size,
      };
    },
  };

  /** Unload one column: modified data goes to savedColumns (always) and pendingSave (if unsaved). */
  function unloadColumn(key, col) {
    if (col.modified) {
      const rec = world.exportColumn(col.cx, col.cz);
      world.savedColumns.set(key, compactRecord(rec));
      if (col.saveDirty) world.pendingSave.set(key, rec);
    }
    if (game.renderer) game.renderer.removeColumnMeshes(col.cx, col.cz);
    columns.delete(key);
    game.events.emit('world:columnUnloaded', { cx: col.cx, cz: col.cz });
  }

  return world;
}

/** Column offsets within radius r sorted by distance (nearest first). */
function buildOffsets(r) {
  const out = [];
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (dx * dx + dz * dz <= r * r) out.push([dx, dz]);
  out.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
  return out;
}
