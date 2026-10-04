// OWNER LANE: CORE-C (world data/lighting/mesher). The API is FROZEN (SPEC §5.3.2).
//
// Column pipeline (SPEC §5.3.3): EMPTY -> GENERATED (worldgen in a worker, or restored from a save) -> LIT
// (needs the 3x3 neighbourhood GENERATED; main thread, lighting.js) -> MESHED (needs the 3x3 neighbourhood
// LIT; sections meshed in workers, main-thread fallback). Radii around the player's column, with the mesh radius
// M = R + MESH_MARGIN (one ring beyond the fog): data to M + 3, light to M + 1.5, meshes within M (dropped again
// beyond M + 1 to bound geometries), unload beyond R + UNLOAD_MARGIN (R + 5). The renderer does not DRAW columns
// wholly beyond the fog (fog cull, review CORE-R10), so the extra ring and the hysteresis cost no draw calls.
// Order: offsets sorted by dist^2 - 2*dot(lookDir, offset), rebuilt when the player crosses a column border
// or turns. Budget: RENDER.CHUNK_BUDGET_MS per frame (2 ms when frames are late), 14 ms while loading.
//
// Edits (setBlock / batches / markSectionDirty*) mark sections URGENT: they are remeshed synchronously at the
// start of the next world.frame(), before streaming and outside the budget, so an edit made in a tick (or
// between frames) is on screen in the very next rendered frame. Light changes caused by streaming are
// background work (worker remesh, old mesh stays until the new one arrives). Every dirty mark bumps the
// section's version; worker results older than the version are dropped.
//
// PERSISTENCE INVARIANT (SPEC §5.3.2): a loaded column is the authority for its own data. For every MODIFIED
// column that is NOT loaded, world.savedColumns holds the latest data (encoded bytes, decoded lazily);
// world.pendingSave additionally holds the ones not yet written to IndexedDB. Never drop either without
// moving the data to the other or into a loaded column. The one exception is a DAMAGED record (it does not
// decode): it is moved into world.corruptColumns (kept as found, never overwritten) and that column is generated
// from the seed again, so one bad column never stops the world from opening or streaming (review ROB-1).
//
// FAULT ISOLATION: every per-column step of streaming (restore/generate, light, mesh, worker results, urgent
// remesh) runs in its own try/catch. A column that throws is reported once and skipped for a short back-off;
// the rest of the world keeps streaming.

import { COL_STATE, Column } from './column.js';
import { generateColumn } from './worldgen.js';
import { computeHeightmap, lightColumn, relightBatch, updateHeightAt } from './lighting.js';
import { PADDED_VOLUME, buildPadded, meshSection } from './mesher.js';
import { createWorkerPool } from './workers.js';
import { B_SOLID, getCollisionBoxes } from '../core/registry.js';
import { COLUMN_VOLUME, RENDER, SECTIONS_PER_COLUMN, WORLD_HEIGHT, colIndex, colKey, packBlock } from '../core/constants.js';
import { decodeColumn, encodeColumn } from '../save/codec.js';

const ALL = (1 << SECTIONS_PER_COLUMN) - 1;

/**
 * Column record used by savedColumns / pendingSave / exportColumn:
 *   {blocks?: Uint16Array(32768), data?: Uint8Array (save/codec.js encodeColumn bytes), blockEntities?: [{i, data}]}
 * At least one of `blocks` / `data` is present. exportColumn() always returns `blocks`; savedColumns entries
 * written by the world are compact (`data`), and FEATURE-MENUS loadWorld() should hand over `data` too so
 * columns are only decoded when they are actually visited.
 */
function recordBlocks(rec) {
  if (!rec || typeof rec !== 'object') throw new Error('column record: missing');
  if (rec.blocks) {
    if (!(rec.blocks instanceof Uint16Array) || rec.blocks.length !== COLUMN_VOLUME) throw new Error('column record: bad blocks array');
    return rec.blocks;
  }
  const data = rec.data instanceof ArrayBuffer ? new Uint8Array(rec.data) : rec.data;
  if (!data || typeof data.length !== 'number') throw new Error('column record: no block data');
  return decodeColumn(data);
}
/** Block entities of a record, keeping only well-formed entries ([{i, data}] with i inside the column). */
function recordEntities(rec) {
  const list = rec && rec.blockEntities;
  if (!Array.isArray(list)) return [];
  return list.filter((be) => be && typeof be === 'object' && Number.isInteger(be.i) && be.i >= 0 && be.i < COLUMN_VOLUME && be.data != null && typeof be.data === 'object');
}
/** Retry delay after a column step threw, and how often it may throw before it stops counting as unmeshed. */
const FAIL_BACKOFF_MS = 1000;
const FAIL_GIVE_UP = 3;
function compactRecord(rec) { return rec.data && !rec.blocks ? rec : { data: encodeColumn(rec.blocks), blockEntities: rec.blockEntities || [] }; }

/** Numeric map key for a column (exact for |cx|, |cz| < 2^20). */
function nk(cx, cz) { return cx * 2097152 + cz; }
const now = () => performance.now();

/**
 * @param {object} game
 * @returns {object} World system (game.world). See SPEC §5.3.2 for every member.
 */
export function createWorldSystem(game) {
  /** @type {Map<string, Column>} frozen API (colKey) */
  const columns = new Map();
  /** @type {Map<number, Column>} same columns, numeric key (hot paths) */
  const byNum = new Map();
  const padBlocks = new Uint16Array(PADDED_VOLUME);
  const padLight = new Uint8Array(PADDED_VOLUME);
  let pool = null;
  let poolTextures = null;
  let epoch = 0;                         // bumped on open/close: results of an older world are dropped
  /** numeric key -> true while a worker generates that column */
  const genInFlight = new Map();
  /** finished worker generations waiting to be integrated: [{cx, cz, blocks, biomes, epoch}] */
  const genResults = [];
  /** finished worker meshes waiting to be applied: [{col, sy, version, mesh}] */
  const meshResults = [];
  let order = [];                        // [dx, dz, d2] sorted by biased distance
  let orderCx = NaN, orderCz = NaN, orderYaw = NaN, orderR = -1;
  let pregenActive = 0;
  const st = { genMs: 0, genN: 0, lightMs: 0, lightN: 0, meshMs: 0, meshN: 0, workerMeshes: 0, workerGens: 0, syncMeshes: 0, urgentMeshes: 0, streamMs: 0, dropped: 0 };
  /** batch state: nesting depth + flat list of changes (x, y, z, oldRaw, newRaw) */
  let batchDepth = 0;
  let batchChanges = [];
  // 1-entry column cache for getRaw/getLight hot paths
  let cacheCx = NaN, cacheCz = NaN, cacheCol = null;
  /** numeric key -> {n: failures, retryAt: ms} for columns whose streaming step threw (fault isolation) */
  const failed = new Map();

  function colAt(cx, cz) {
    if (cx === cacheCx && cz === cacheCz) return cacheCol;
    const c = byNum.get(nk(cx, cz)) || null;
    cacheCx = cx; cacheCz = cz; cacheCol = c;
    return c;
  }
  function dropCache() { cacheCx = NaN; cacheCz = NaN; cacheCol = null; }

  const world = {
    name: 'world',
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
    /**
     * CORE-C addition (ROB-1): damaged saved records that did not decode, colKey -> {record, error, at}. The
     * column is generated from the seed instead. Entries are kept as found (never overwritten) for a later
     * restore or inspection; an unedited regenerated column is never saved over the stored record.
     */
    corruptColumns: new Map(),
    center: { cx: 0, cz: 0 },

    init() {
      // Settings that need world work (SPEC §3.8): render distance and smooth lighting. fancyLeaves belongs to
      // CORE-D (texture rebuild), which then calls world.remeshAll().
      game.events.on('settings:changed', (e) => {
        if (e.key === 'renderDistance' && e.value > 0) world.setRenderDistance(e.value);
        else if (e.key === 'smoothLighting') world.remeshAll();
      });
      startWorkers();
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
      world.corruptColumns = new Map();
      world.isOpen = true;
      epoch++;
      if (pool === null && game.textures) startWorkers();
    },

    /** Unload everything (meshes removed from the renderer). No export: callers save first (exitToTitle). */
    close() {
      for (const col of columns.values()) if (game.renderer && col.meshedMask) game.renderer.removeColumnMeshes(col.cx, col.cz);
      columns.clear();
      byNum.clear();
      dropCache();
      genInFlight.clear();
      genResults.length = 0;
      meshResults.length = 0;
      batchDepth = 0; batchChanges = [];
      failed.clear();
      orderCx = NaN;
      world.isOpen = false;
      epoch++;
    },

    getColumn(cx, cz) { return byNum.get(nk(cx, cz)) || null; },
    /** true when the column is generated AND lit (safe for gameplay/physics). */
    isColumnLoaded(cx, cz) { const c = byNum.get(nk(cx, cz)); return !!c && c.state >= COL_STATE.LIT; },
    forEachColumn(fn) { for (const c of columns.values()) fn(c); },

    /** Packed value id | state<<8 (0 for unloaded / out of range). */
    getRaw(x, y, z) {
      y = Math.floor(y);
      if (y < 0 || y >= WORLD_HEIGHT) return 0;
      x = Math.floor(x); z = Math.floor(z);
      const c = colAt(x >> 4, z >> 4);
      return c !== null ? c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)] : 0;
    },
    getBlock(x, y, z) { return world.getRaw(x, y, z) & 0xff; },
    getState(x, y, z) { return world.getRaw(x, y, z) >> 8; },
    /** sky<<4 | block. Above the world: 0xF0. Below: 0. Unloaded: 0xF0. */
    getLight(x, y, z) {
      y = Math.floor(y);
      if (y >= WORLD_HEIGHT) return 0xf0;
      if (y < 0) return 0;
      x = Math.floor(x); z = Math.floor(z);
      const c = colAt(x >> 4, z >> 4);
      return c !== null && c.state >= COL_STATE.LIT ? c.light[(x & 15) | ((z & 15) << 4) | (y << 8)] : 0xf0;
    },
    getSkyLight(x, y, z) { return world.getLight(x, y, z) >> 4; },
    getBlockLight(x, y, z) { return world.getLight(x, y, z) & 15; },
    /** heightmap value (see Column.heightmap); WORLD_HEIGHT for unloaded. */
    getHeight(x, z) {
      const c = colAt(Math.floor(x) >> 4, Math.floor(z) >> 4);
      return c !== null && c.heightReady ? c.heightmap[(Math.floor(x) & 15) + (Math.floor(z) & 15) * 16] : WORLD_HEIGHT;
    },
    /** Feet Y to stand on the highest block with collision at (x,z): top of its collision box. -1 if none/unloaded. */
    getSurfaceY(x, z) {
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const v = world.getRaw(x, y, z), id = v & 0xff;
        if (B_SOLID[id]) {
          const boxes = getCollisionBoxes(id, v >> 8);
          if (boxes.length) { let top = 0; for (const b of boxes) if (b[4] > top) top = b[4]; return y + top; }
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
      const col = colAt(x >> 4, z >> 4);
      if (col === null || col.state < COL_STATE.GENERATED) return false;
      const i = colIndex(x & 15, y, z & 15);
      const old = col.blocks[i];
      const nv = packBlock(id, state);
      if (old === nv) return false;
      col.blocks[i] = nv;
      if (nv !== 0) col.nonEmptyMask |= 1 << (y >> 4);
      if (!opts.keepBlockEntity && col.blockEntities.has(i)) col.blockEntities.delete(i);
      if (opts.cause !== 'worldgen') { col.modified = true; col.saveDirty = true; }
      updateHeightAt(col, x & 15, y, z & 15);
      if (batchDepth > 0) batchChanges.push(x, y, z, old, nv);
      else {
        if (col.state >= COL_STATE.LIT) relightBatch(world, [x, y, z, old, nv]);
        world.markSectionDirtyAt(x, y, z);
      }
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

    /**
     * Mark every section whose mesh can see the cell (x,y,z) dirty (urgent: remeshed next frame, outside the
     * budget): its own section, plus the neighbouring sections/columns when it lies on a border (corners
     * included: AO and smooth light read the 26-neighbourhood).
     */
    markSectionDirtyAt(x, y, z) {
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      const cx = x >> 4, cz = z >> 4, sy = y >> 4;
      const lx = x & 15, lz = z & 15, ly = y & 15;
      const x0 = lx === 0 ? -1 : 0, x1 = lx === 15 ? 1 : 0;
      const z0 = lz === 0 ? -1 : 0, z1 = lz === 15 ? 1 : 0;
      const s0 = ly === 0 ? sy - 1 : sy, s1 = ly === 15 ? sy + 1 : sy;
      for (let dx = x0; dx <= x1; dx++) for (let dz = z0; dz <= z1; dz++) {
        const c = colAt(cx + dx, cz + dz);
        if (c === null) continue;
        for (let s = s0; s <= s1; s++) c.markUrgent(s);
      }
    },
    /** Mark one section dirty (urgent). */
    markSectionDirty(cx, sy, cz) { const c = colAt(cx, cz); if (c !== null) c.markUrgent(sy); },

    /**
     * Re-mesh every loaded column (smoothLighting / fancyLeaves changed). Sections are rebuilt nearest-first in
     * the background; old meshes stay until replaced. Re-sends the texture layer table to the workers when
     * CORE-D rebuilt game.textures.
     */
    remeshAll() {
      if (pool && pool.alive && game.textures && game.textures !== poolTextures) sendTextures();
      for (const c of columns.values()) {
        if (c.state < COL_STATE.LIT) continue;
        for (let s = 0; s < SECTIONS_PER_COLUMN; s++) if ((c.nonEmptyMask | c.meshedMask) & (1 << s)) c.markDirty(s);
      }
    },

    /** Block entity (chest/furnace data object) at a world cell, or null. */
    getBlockEntity(x, y, z) {
      const c = colAt(Math.floor(x) >> 4, Math.floor(z) >> 4);
      return c !== null ? c.blockEntities.get(colIndex(Math.floor(x) & 15, Math.floor(y), Math.floor(z) & 15)) || null : null;
    },
    /** Set/clear (null) a block entity. Marks the column modified. */
    setBlockEntity(x, y, z, data) {
      const c = colAt(Math.floor(x) >> 4, Math.floor(z) >> 4);
      if (c === null) return false;
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
      world.renderDistance = Math.max(RENDER.MIN_DISTANCE, Math.min(RENDER.MAX_DISTANCE, Math.round(n) || RENDER.DEFAULT_DISTANCE));
      orderCx = NaN;
      game.events.emit('world:renderDistance', { distance: world.renderDistance });
    },

    /** Generate (or restore) + light a column synchronously (its 3x3 neighbourhood is generated first). */
    ensureColumn(cx, cz) {
      let col = colAt(cx, cz);
      if (col !== null && col.state >= COL_STATE.LIT) return col;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (colAt(cx + dx, cz + dz) === null) generateSync(cx + dx, cz + dz);
      col = colAt(cx, cz);
      lightNow(col);
      return col;
    },

    /** Mesh every dirty section of a column now (main thread). Its 3x3 neighbourhood should be LIT. */
    meshColumn(col) {
      if (!col || col.state < COL_STATE.LIT) return;
      if (col.state === COL_STATE.LIT) col.dirtyMask |= col.nonEmptyMask | col.meshedMask;
      for (let s = 0; s < SECTIONS_PER_COLUMN; s++) if (col.dirtyMask & (1 << s)) meshSectionSync(col, s);
      col.dirtyMask = 0; col.urgentMask = 0;
      col.meshStarted = true;
      col.state = COL_STATE.MESHED;
    },

    /**
     * Prepare the spawn area: generate radius+2, light radius+1, mesh radius (workers in parallel, main-thread
     * fallback), yielding to the browser between ~14 ms slices so the loading screen can update.
     * onProgress(done, total) counts meshed columns.
     */
    async pregenerate(cx, cz, radius = RENDER.SPAWN_RADIUS, onProgress = null) {
      if (!world.isOpen) return;
      const r = Math.max(0, Math.round(radius));
      const target = offsetsWithin(r + 0.01);
      const total = target.length;
      const myEpoch = epoch;
      pregenActive++;
      try {
        let lastDone = -1, stallSince = now();
        for (;;) {
          if (!world.isOpen || epoch !== myEpoch) return;
          stream(cx, cz, r, RENDER.LOADING_BUDGET_MS, null);
          let done = 0;
          for (const [dx, dz] of target) { const c = colAt(cx + dx, cz + dz); if (c !== null && c.state === COL_STATE.MESHED) done++; }
          if (onProgress) onProgress(done, total);
          if (done >= total) break;
          if (done !== lastDone || pool === null || !pool.alive || pool.inFlight() === 0) { lastDone = done; stallSince = now(); }
          else if (now() - stallSince > 4000) { killWorkers('pregenerate stalled (no worker progress for 4 s)'); }
          await new Promise((res) => setTimeout(res, pool && pool.alive && pool.inFlight() ? 2 : 0));
        }
      } finally {
        pregenActive--;
      }
    },

    /** Per-frame streaming around the player within the chunk budget (SPEC §5.3.3). */
    frame(g, dt) {
      if (!world.isOpen || !game.player) return;
      const pcx = Math.floor(game.player.x) >> 4, pcz = Math.floor(game.player.z) >> 4;
      world.center.cx = pcx; world.center.cz = pcz;
      flushUrgent();
      if (pregenActive) { applyMeshResults(); return; }
      const loading = game.state === 'loading';
      const late = game.perf && game.perf.frameMs > 20;
      const budget = loading ? RENDER.LOADING_BUDGET_MS : late ? RENDER.CHUNK_BUDGET_MS / 2 : RENDER.CHUNK_BUDGET_MS;
      const t0 = now();
      // mesh radius = R + MESH_MARGIN: the fog ends at (R - 0.5) * 16, so the circular radius's diagonal gaps
      // (and the newest, still-streaming ring) sit beyond fogFar and never show as holes
      const meshR = world.renderDistance + RENDER.MESH_MARGIN;
      stream(pcx, pcz, meshR, budget, game.player);
      dropFarMeshes(pcx, pcz, meshR);
      unloadFar(pcx, pcz, world.renderDistance);
      st.streamMs = st.streamMs * 0.9 + (now() - t0) * 0.1;
    },

    /**
     * Number of columns within radius r (columns) of the player's column that are not meshed yet. The
     * player lane caps kid-scheme flight speed while this exceeds KID.STREAM_BACKLOG_COLUMNS (SPEC §2.1).
     */
    unmeshedWithin(r) {
      const r2 = r * r;
      let n = 0;
      const R = Math.ceil(r);
      // around the player's CURRENT column (world.center only moves in frame(): right after a teleport it
      // would still describe the old area and report "all meshed" too early)
      const p = game.player;
      const ok = p && Number.isFinite(p.x) && Number.isFinite(p.z);
      const ccx = ok ? Math.floor(p.x) >> 4 : world.center.cx, ccz = ok ? Math.floor(p.z) >> 4 : world.center.cz;
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dz * dz > r2) continue;
        const c = colAt(ccx + dx, ccz + dz);
        if (c === null || c.state !== COL_STATE.MESHED) {
          // a column that keeps failing must not hold the kid flight cap forever
          const f = failed.size ? failed.get(nk(ccx + dx, ccz + dz)) : undefined;
          if (f === undefined || f.n < FAIL_GIVE_UP) n++;
        }
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
      const c = colAt(cx, cz);
      if (c === null) {
        const key = colKey(cx, cz);
        const p = world.pendingSave.get(key);
        if (!p) return null;
        try { return { blocks: recordBlocks(p), blockEntities: recordEntities(p) }; } catch (err) { quarantine(key, p, err); return null; }
      }
      return { blocks: c.blocks.slice(), blockEntities: [...c.blockEntities].map(([i, data]) => ({ i, data: JSON.parse(JSON.stringify(data)) })) };
    },
    /**
     * The save lane wrote this column (call synchronously right after exportColumn, in the same task).
     * Loaded: clears saveDirty. Unloaded: MOVES the pendingSave record into savedColumns (never drops it).
     */
    markColumnSaved(cx, cz) {
      const key = colKey(cx, cz);
      const c = colAt(cx, cz);
      if (c !== null) c.saveDirty = false;
      const p = world.pendingSave.get(key);
      if (p) {
        let rec;
        try { rec = compactRecord(p); } catch (err) { quarantine(key, p, err); return; }
        world.savedColumns.set(key, rec); world.pendingSave.delete(key);
      }
    },

    /** CORE-C addition (diagnostics/tests): stop the worker pool; everything continues on the main thread. */
    disableWorkers(reason = 'disabled') { killWorkers(reason); },
    /** CORE-C addition: start a fresh worker pool after disableWorkers (no-op while one is alive). */
    enableWorkers() { if (pool && pool.alive) return; pool = null; poolTextures = null; startWorkers(); },

    stats() {
      let meshed = 0, lit = 0, sections = 0;
      for (const c of columns.values()) {
        if (c.state === COL_STATE.MESHED) meshed++;
        if (c.state >= COL_STATE.LIT) lit++;
        for (let m = c.meshedMask; m; m &= m - 1) sections++;
      }
      return {
        columns: columns.size, columnsLit: lit, columnsMeshed: meshed, sectionMeshes: sections,
        genAvgMs: st.genN ? st.genMs / st.genN : 0, lightAvgMs: st.lightN ? st.lightMs / st.lightN : 0, meshAvgMs: st.meshN ? st.meshMs / st.meshN : 0,
        renderDistance: world.renderDistance, savedColumns: world.savedColumns.size, pendingSave: world.pendingSave.size,
        workers: pool && pool.alive ? pool.size : 0, workerReason: pool ? pool.reason : 'not started', inFlight: pool && pool.alive ? pool.inFlight() : 0,
        genInFlight: genInFlight.size, workerMeshes: st.workerMeshes, workerGens: st.workerGens, syncMeshes: st.syncMeshes,
        urgentMeshes: st.urgentMeshes, droppedResults: st.dropped, streamMs: Math.round(st.streamMs * 100) / 100,
      };
    },
  };

  /* ---------------------------------------------------------------- workers */
  function startWorkers() {
    if (pool !== null) return;
    pool = createWorkerPool({ onDead: (reason) => { if (game.dev) console.warn('[world] workers disabled:', reason); } });
    if (pool.alive && game.textures) sendTextures();
  }
  function sendTextures() {
    poolTextures = game.textures;
    const layers = [...game.textures.index.entries()];
    pool.init(layers).then((ok) => { if (!ok) genInFlight.clear(); });
    // every queued mesh job was built with the old layers: invalidate by bumping versions
    for (const c of columns.values()) for (let s = 0; s < SECTIONS_PER_COLUMN; s++) if (c.pendingMask & (1 << s)) c.markDirty(s);
  }
  function killWorkers(reason) {
    if (pool && pool.alive) pool.kill(reason);
    genInFlight.clear();
    for (const c of columns.values()) { if (c.pendingMask) { for (let s = 0; s < SECTIONS_PER_COLUMN; s++) if (c.pendingMask & (1 << s)) c.markDirty(s); c.pendingMask = 0; } }
  }
  function useWorkers() { return pool !== null && pool.alive && poolTextures !== null; }

  /* ---------------------------------------------------------------- generation */
  /** Restore from pendingSave / savedColumns (saved data wins). Returns the column or null. */
  function restore(cx, cz) {
    const key = colKey(cx, cz);
    const pending = world.pendingSave.get(key);
    const saved = pending || world.savedColumns.get(key);
    if (!saved) return null;
    let blocks;
    try { blocks = recordBlocks(saved); } catch (err) {
      // damaged record: keep it aside and let the caller generate this column from the seed (ROB-1)
      quarantine(key, saved, err);
      return null;
    }
    const col = new Column(cx, cz);
    col.blocks.set(blocks);
    col.fresh = false;
    col.modified = true;
    col.saveDirty = !!pending; // not yet in IndexedDB -> keep it in getDirtyColumns()
    for (const be of recordEntities(saved)) col.blockEntities.set(be.i, be.data);
    // the loaded column becomes the authority: drop both records (unload re-exports)
    world.pendingSave.delete(key);
    world.savedColumns.delete(key);
    return col;
  }
  /**
   * Move a damaged record out of pendingSave/savedColumns into world.corruptColumns (first copy wins) and say
   * so once. Not a game error: the world recovers by generating that column again.
   */
  function quarantine(key, rec, err) {
    world.pendingSave.delete(key);
    world.savedColumns.delete(key);
    if (world.corruptColumns.has(key)) return;
    const error = String((err && err.message) || err);
    world.corruptColumns.set(key, { record: rec, error, at: Date.now() });
    console.warn(`[blockcraft] damaged saved column ${key} (${error}): set aside, regenerating it from the seed`);
    const [cx, cz] = key.split(',').map(Number);
    game.events.emit('world:columnCorrupt', { cx, cz, error });
  }
  /** A column's streaming step threw: report once per column, then back off before trying it again. */
  function columnFailed(cx, cz, err) {
    const k = nk(cx, cz);
    let f = failed.get(k);
    if (f === undefined) {
      f = { n: 0, retryAt: 0 };
      failed.set(k, f);
      if (game.reportError) game.reportError(err, `world column ${cx},${cz}`); else console.error('[world] column', cx, cz, err);
    }
    f.n++;
    f.retryAt = now() + FAIL_BACKOFF_MS * Math.min(f.n, 10);
  }
  /** true while a failed column is still backing off (skip it this frame). */
  function backingOff(cx, cz) {
    if (failed.size === 0) return false;
    const f = failed.get(nk(cx, cz));
    return f !== undefined && now() < f.retryAt;
  }

  function addGenerated(col) {
    computeHeightmap(col);
    col.computeNonEmpty();
    col.state = COL_STATE.GENERATED;
    columns.set(colKey(col.cx, col.cz), col);
    byNum.set(nk(col.cx, col.cz), col);
    dropCache();
    genInFlight.delete(nk(col.cx, col.cz));
    game.events.emit('world:columnGenerated', { cx: col.cx, cz: col.cz, fresh: col.fresh });
    return col;
  }
  function generateSync(cx, cz) {
    const t0 = now();
    let col = restore(cx, cz);
    if (col === null) {
      col = new Column(cx, cz);
      generateColumn(world.seed, cx, cz, world.preset, col);
      // a regenerated damaged column was visited before: not a fresh chunk for chunk-generation animals
      if (world.corruptColumns.size > 0 && world.corruptColumns.has(colKey(cx, cz))) col.fresh = false;
    }
    addGenerated(col);
    st.genMs += now() - t0; st.genN++;
    return col;
  }
  /** Ask for a column: restore now, or generate in a worker, or generate now (fallback). true = sync work done. */
  function requestColumn(cx, cz) {
    const k = nk(cx, cz);
    if (genInFlight.has(k)) return false;
    const key = colKey(cx, cz);
    if (world.pendingSave.has(key) || world.savedColumns.has(key) || !useWorkers()) { generateSync(cx, cz); return true; }
    if (!pool.canPost('gen')) return false;
    genInFlight.set(k, true);
    const myEpoch = epoch;
    pool.post({ op: 'generate', seed: world.seed, cx, cz, preset: world.preset }).then((res) => {
      if (myEpoch !== epoch) return;
      if (!res || !res.ok) { genInFlight.delete(k); if (pool.alive && res && res.error && /unknown op|not implemented/.test(res.error)) killWorkers(res.error); return; }
      st.workerGens++;
      genResults.push(res);
    });
    return false;
  }
  function applyGenResults(budgetEnd) {
    while (genResults.length) {
      if (now() > budgetEnd) return;
      const res = genResults.shift();
      const k = nk(res.cx, res.cz);
      genInFlight.delete(k);
      if (byNum.has(k)) { st.dropped++; continue; }
      const dx = res.cx - world.center.cx, dz = res.cz - world.center.cz;
      const U = world.renderDistance + RENDER.UNLOAD_MARGIN;
      if (dx * dx + dz * dz > U * U) { st.dropped++; continue; }
      const key = colKey(res.cx, res.cz);
      try {
        if (world.pendingSave.has(key) || world.savedColumns.has(key)) { generateSync(res.cx, res.cz); continue; } // saved data wins
        addGenerated(new Column(res.cx, res.cz, res.blocks, res.biomes));
      } catch (err) { columnFailed(res.cx, res.cz, err); }
    }
  }

  /* ---------------------------------------------------------------- lighting */
  function neighboursAtLeast(col, state) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const c = colAt(col.cx + dx, col.cz + dz);
      if (c === null || c.state < state) return false;
    }
    return true;
  }
  function lightNow(col) {
    const t0 = now();
    lightColumn(world, col);
    col.state = COL_STATE.LIT;
    col.dirtyMask = col.nonEmptyMask | col.meshedMask;
    col.urgentMask = 0;
    st.lightMs += now() - t0; st.lightN++;
    // Lit = gameplay-safe: MOBS spawns chunk-generation animals here when fresh (light is valid now).
    game.events.emit('world:columnLoaded', { cx: col.cx, cz: col.cz, fresh: col.fresh });
  }

  /* ---------------------------------------------------------------- meshing */
  function meshOpts(cx, sy, cz) {
    const s = game.settings || {};
    const lowPreset = game.renderer && game.renderer.quality && game.renderer.quality.preset === 'low';
    return { fancyLeaves: s.fancyLeaves !== false && !lowPreset, smoothLighting: s.smoothLighting !== false, waving: s.waving !== false, origin: [cx * 16, sy * 16, cz * 16] };
  }
  function applyMesh(col, s, mesh) {
    if (mesh) col.meshedMask |= 1 << s; else if (!(col.meshedMask & (1 << s))) return;
    else col.meshedMask &= ~(1 << s);
    if (game.renderer) game.renderer.setSectionMesh(col.cx, s, col.cz, mesh);
  }
  function meshSectionSync(col, s) {
    const t0 = now();
    const has = buildPadded(world, col.cx, s, col.cz, padBlocks, padLight);
    const mesh = has ? meshSection(padBlocks, padLight, meshOpts(col.cx, s, col.cz)) : null;
    applyMesh(col, s, mesh);
    col.dirtyMask &= ~(1 << s);
    col.urgentMask &= ~(1 << s);
    st.meshMs += now() - t0; st.meshN++; st.syncMeshes++;
  }
  /** Post (or do) the dirty, not-in-flight sections of a column. Returns false when out of budget/slots. */
  function processDirty(col, budgetEnd) {
    col.meshStarted = true;
    for (let s = 0; s < SECTIONS_PER_COLUMN; s++) {
      const bit = 1 << s;
      if (!(col.dirtyMask & bit) || (col.pendingMask & bit)) continue;
      if (!((col.nonEmptyMask | col.meshedMask) & bit)) { col.dirtyMask &= ~bit; continue; }
      if (useWorkers()) {
        if (!pool.canPost('mesh')) return false;
        const blocks = new Uint16Array(PADDED_VOLUME), light = new Uint8Array(PADDED_VOLUME);
        const has = buildPadded(world, col.cx, s, col.cz, blocks, light);
        col.dirtyMask &= ~bit;
        if (!has) { applyMesh(col, s, null); continue; }
        const version = col.secVersion[s];
        col.pendingMask |= bit;
        col.pendingVer[s] = version;
        const myEpoch = epoch;
        pool.post({ op: 'mesh', blocks, light, opts: meshOpts(col.cx, s, col.cz), version }, [blocks.buffer, light.buffer]).then((res) => {
          if (myEpoch !== epoch) return;
          meshResults.push({ col, s, version, res });
        });
      } else {
        if (now() > budgetEnd) return false;
        meshSectionSync(col, s);
      }
    }
    return true;
  }
  function applyMeshResults() {
    while (meshResults.length) {
      const { col, s, version, res } = meshResults.shift();
      const bit = 1 << s;
      if (col.pendingVer[s] === version) col.pendingMask &= ~bit;
      if (byNum.get(nk(col.cx, col.cz)) !== col) { st.dropped++; continue; }
      if (!res || !res.ok) {
        // worker refused: fall back for this section
        col.dirtyMask |= bit;
        if (pool && pool.alive && res && res.error && /textures not bound|unknown op/.test(res.error)) killWorkers(res.error);
        continue;
      }
      if (col.secVersion[s] !== version || col.state < COL_STATE.LIT || !col.meshStarted) { st.dropped++; col.dirtyMask |= bit; continue; }
      try {
        applyMesh(col, s, res.mesh);
        st.workerMeshes++;
        checkMeshed(col);
      } catch (err) { columnFailed(col.cx, col.cz, err); }
    }
  }
  function checkMeshed(col) {
    if (col.state === COL_STATE.LIT && col.meshStarted && !col.dirtyMask && !col.pendingMask) col.state = COL_STATE.MESHED;
  }
  /** Edits: remesh urgent sections of displayed columns right now (no budget). */
  function flushUrgent() {
    for (const col of columns.values()) {
      if (!col.urgentMask) continue;
      if (col.state < COL_STATE.LIT || !col.meshStarted) { col.urgentMask = 0; continue; }
      try {
        for (let s = 0; s < SECTIONS_PER_COLUMN; s++) {
          if (!(col.urgentMask & (1 << s))) continue;
          if ((col.nonEmptyMask | col.meshedMask) & (1 << s)) { meshSectionSync(col, s); st.urgentMeshes++; }
          else { col.dirtyMask &= ~(1 << s); col.urgentMask &= ~(1 << s); }
        }
        col.urgentMask = 0;
        checkMeshed(col);
      } catch (err) { col.urgentMask = 0; columnFailed(col.cx, col.cz, err); }
    }
  }

  /* ---------------------------------------------------------------- streaming */
  function offsetsWithin(r) {
    const out = [];
    const R = Math.ceil(r);
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) if (dx * dx + dz * dz <= r * r) out.push([dx, dz, dx * dx + dz * dz]);
    out.sort((a, b) => a[2] - b[2]);
    return out;
  }
  function rebuildOrder(pcx, pcz, R, player) {
    const yaw = player ? player.yaw || 0 : 0;
    const lx = -Math.sin(yaw), lz = -Math.cos(yaw);
    // light radius R + 1.5 covers the diagonal neighbours of every meshed column; data must cover theirs
    const list = offsetsWithin(R + RENDER.DATA_MARGIN + 1);
    for (const o of list) o.push(o[2] - 2 * (lx * o[0] + lz * o[1]));
    list.sort((a, b) => a[3] - b[3]);
    order = list;
    orderCx = pcx; orderCz = pcz; orderYaw = yaw; orderR = R;
  }

  /**
   * One streaming pass around (pcx, pcz) with mesh radius R: apply worker results, then walk the ordered
   * offsets doing at most `budget` ms of main-thread work (generate/restore, light, mesh or post to workers).
   */
  function stream(pcx, pcz, R, budget, player) {
    const t0 = now();
    const budgetEnd = t0 + budget;
    applyMeshResults();
    applyGenResults(budgetEnd);
    if (pcx !== orderCx || pcz !== orderCz || R !== orderR || (player && Math.abs(angleDelta((player.yaw || 0), orderYaw)) > 0.6)) rebuildOrder(pcx, pcz, R, player);
    const meshR2 = R * R, lightR2 = (R + 1.5) * (R + 1.5);
    for (let i = 0; i < order.length; i++) {
      if (now() > budgetEnd) break;
      const o = order[i];
      const d2 = o[2];
      const cx = pcx + o[0], cz = pcz + o[1];
      if (backingOff(cx, cz)) continue;
      // one column's failure must never stop the others (ROB-1): each column's step is isolated
      try {
        const col = colAt(cx, cz);
        if (col === null) { requestColumn(cx, cz); continue; }
        if (col.state === COL_STATE.GENERATED) {
          if (d2 <= lightR2 && neighboursAtLeast(col, COL_STATE.GENERATED)) lightNow(col);
          else continue;
        }
        if (d2 > meshR2) continue;
        if (col.state === COL_STATE.LIT) {
          if (!col.meshStarted && !neighboursAtLeast(col, COL_STATE.LIT)) continue;
          processDirty(col, budgetEnd);
          checkMeshed(col);
        } else if (col.state === COL_STATE.MESHED && col.dirtyMask) {
          processDirty(col, budgetEnd);
        }
      } catch (err) { columnFailed(cx, cz, err); }
    }
  }
  /** Drop meshes of columns that left the mesh radius (+1 hysteresis): bounds draw calls and geometries. */
  function dropFarMeshes(pcx, pcz, R) {
    const D = R + 1;
    for (const col of columns.values()) {
      if (!col.meshStarted) continue;
      const dx = col.cx - pcx, dz = col.cz - pcz;
      if (dx * dx + dz * dz <= D * D) continue;
      if (col.meshedMask && game.renderer) game.renderer.removeColumnMeshes(col.cx, col.cz);
      col.meshedMask = 0;
      col.meshStarted = false;
      for (let s = 0; s < SECTIONS_PER_COLUMN; s++) if (col.pendingMask & (1 << s)) col.markDirty(s);
      col.dirtyMask = col.nonEmptyMask;
      col.urgentMask = 0;
      if (col.state === COL_STATE.MESHED) col.state = COL_STATE.LIT;
    }
  }
  function unloadFar(pcx, pcz, R) {
    const U = R + RENDER.UNLOAD_MARGIN;
    for (const [key, col] of columns) {
      const dx = col.cx - pcx, dz = col.cz - pcz;
      if (dx * dx + dz * dz > U * U) unloadColumn(key, col);
    }
  }

  /** Unload one column: modified data goes to savedColumns (always) and pendingSave (if unsaved). */
  function unloadColumn(key, col) {
    if (col.modified) {
      const rec = world.exportColumn(col.cx, col.cz);
      world.savedColumns.set(key, compactRecord(rec));
      if (col.saveDirty) world.pendingSave.set(key, rec);
    }
    if (failed.size) failed.delete(nk(col.cx, col.cz));
    if (game.renderer) game.renderer.removeColumnMeshes(col.cx, col.cz);
    col.meshedMask = 0;
    columns.delete(key);
    byNum.delete(nk(col.cx, col.cz));
    dropCache();
    game.events.emit('world:columnUnloaded', { cx: col.cx, cz: col.cz });
  }

  return world;
}

function angleDelta(a, b) {
  if (!Number.isFinite(b)) return Math.PI;
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
