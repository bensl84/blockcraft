// OWNER LANE: CORE-C (world data/lighting/mesher). Spec: docs/SPEC.md §5.3.4, §2.4.
//
// Two-channel (sky, block) breadth-first flood fill over WORLD coordinates, so light crosses column borders
// exactly like it crosses cells. Light is stored per cell as sky << 4 | block (Column.light).
//
//   * Block light loses 1 per step plus the filter of the cell it enters (B_FILTER; opaque = 15 blocks it).
//   * Sky light moves straight down through filter-0 cells without loss while it is 15, otherwise it loses
//     1 per step plus the filter (sideways, upward, or down into leaves/water/ice).
//   * Removal: a queue of (pos, oldLevel) is run fully (cells fed by the removed light are cleared and their
//     brighter neighbours become re-propagation seeds), then propagation runs.
//   * Only columns that are LIT (state >= LIT) are read or written, plus the column currently being lit.
//     A column becoming LIT re-seeds from both sides of every border it shares with LIT neighbours.
//   * Every cell whose light changes marks the mesh sections that can see it dirty (its own section, the
//     section above/below on a section border, and the neighbour columns' sections on a column border,
//     diagonals included - AO/smooth light reads the 26-neighbourhood). Edits mark them URGENT (remeshed in
//     the same frame), initial lighting marks them as background work.
//
// Queues are preallocated growable Int32Arrays of positions packed relative to an operation origin:
//   (x - ox) | (z - oz) << 12 | y << 24   (|x - origin| < 2048)

import { B_EMIT, B_FILTER } from '../core/registry.js';
import { WORLD_HEIGHT } from '../core/constants.js';
import { COL_STATE } from './column.js';

const TOP = WORLD_HEIGHT - 1;
const RANGE = 2047;

/* ------------------------------------------------------------------ queues */
let qPos = new Int32Array(1 << 15);
let qLen = 0;
let rPos = new Int32Array(1 << 14);
let rLev = new Uint8Array(1 << 14);
let rLen = 0;

let ox = 0, oz = 0;             // packing origin (minus RANGE+1 so packed coords are positive)
let W = null;                    // world of the running operation
let target = null;               // column being lit (allowed although not LIT yet)
let urgent = false;              // dirty marks are urgent (edits) or background (initial lighting)

/** Small direct-mapped column cache (16 slots) valid during one operation. */
const CC_X = new Int32Array(16), CC_Z = new Int32Array(16), CC_V = new Uint8Array(16);
const CC_C = new Array(16).fill(null);

function begin(world, originX, originZ) {
  W = world;
  ox = originX - RANGE - 1; oz = originZ - RANGE - 1;
  CC_V.fill(0);
  qLen = 0; rLen = 0;
}
function end() { W = null; target = null; CC_C.fill(null); }

/** Any loaded column (any state) or null. */
function anyCol(cx, cz) {
  const s = (cx & 3) | ((cz & 3) << 2);
  if (CC_V[s] === 1 && CC_X[s] === cx && CC_Z[s] === cz) return CC_C[s];
  const c = W.getColumn(cx, cz);
  CC_X[s] = cx; CC_Z[s] = cz; CC_C[s] = c; CC_V[s] = 1;
  return c;
}
/** Column that lighting may read/write: LIT (or meshed) or the one being lit. */
function litCol(cx, cz) {
  const c = anyCol(cx, cz);
  return c !== null && (c.state >= COL_STATE.LIT || c === target) ? c : null;
}

function inRange(x, z) { return x - ox > 0 && x - ox < 4095 && z - oz > 0 && z - oz < 4095; }
function pack(x, y, z) { return (x - ox) | ((z - oz) << 12) | (y << 24); }

function pushQ(x, y, z) {
  if (qLen === qPos.length) { const n = new Int32Array(qPos.length * 2); n.set(qPos); qPos = n; }
  qPos[qLen++] = pack(x, y, z);
}
function pushR(x, y, z, lev) {
  if (rLen === rPos.length) {
    const n = new Int32Array(rPos.length * 2); n.set(rPos); rPos = n;
    const m = new Uint8Array(rLev.length * 2); m.set(rLev); rLev = m;
  }
  rPos[rLen] = pack(x, y, z); rLev[rLen++] = lev;
}

/* ------------------------------------------------------------------ dirty marking */
function markSection(c, s) {
  if (urgent) c.markUrgent(s); else c.markDirty(s);
}
/** A cell's light changed: dirty every section whose padded mesh input contains it. */
function markCell(col, lx, y, lz) {
  const edgeX = lx === 0 ? -1 : lx === 15 ? 1 : 0;
  const edgeZ = lz === 0 ? -1 : lz === 15 ? 1 : 0;
  if (col === target && edgeX === 0 && edgeZ === 0) return; // the column being lit is meshed from scratch anyway
  const sy = y >> 4, ly = y & 15;
  const s0 = ly === 0 && sy > 0 ? sy - 1 : sy;
  const s1 = ly === 15 && sy < 7 ? sy + 1 : sy;
  if (col !== target) for (let s = s0; s <= s1; s++) markSection(col, s);
  if (edgeX === 0 && edgeZ === 0) return;
  const cx = col.cx, cz = col.cz;
  for (let dx = Math.min(0, edgeX); dx <= Math.max(0, edgeX); dx++) {
    for (let dz = Math.min(0, edgeZ); dz <= Math.max(0, edgeZ); dz++) {
      if (dx === 0 && dz === 0) continue;
      const c = anyCol(cx + dx, cz + dz);
      if (c === null || c === target || c.state < COL_STATE.LIT) continue;
      for (let s = s0; s <= s1; s++) markSection(c, s);
    }
  }
}

/* ------------------------------------------------------------------ BFS core */
// direction tables: 0 +x, 1 -x, 2 +y, 3 -y (down), 4 +z, 5 -z
const DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];
const DOWN = 3;

/**
 * Propagate the queued cells of one channel (sky: shift 4) outward.
 * @param {boolean} sky
 */
function propagate(sky) {
  const shift = sky ? 4 : 0;
  const keep = sky ? 0x0f : 0xf0;
  for (let h = 0; h < qLen; h++) {
    const p = qPos[h];
    const x = (p & 0xfff) + ox, z = ((p >>> 12) & 0xfff) + oz, y = p >>> 24;
    const col = litCol(x >> 4, z >> 4);
    if (col === null) continue;
    const L = (col.light[(x & 15) | ((z & 15) << 4) | (y << 8)] >> shift) & 15;
    if (L <= 1) continue;
    for (let d = 0; d < 6; d++) {
      const ny = y + DY[d];
      if (ny < 0 || ny > TOP) continue;
      const nx = x + DX[d], nz = z + DZ[d];
      const ncol = ((nx >> 4) === col.cx && (nz >> 4) === col.cz) ? col : litCol(nx >> 4, nz >> 4);
      if (ncol === null) continue;
      const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8);
      const f = B_FILTER[ncol.blocks[ni] & 0xff];
      if (f >= 15) continue;
      let nl = L - 1 - f;
      if (sky && d === DOWN && L === 15 && f === 0) nl = 15;
      if (nl <= 0) continue;
      const cur = ncol.light[ni];
      if (((cur >> shift) & 15) >= nl) continue;
      ncol.light[ni] = (cur & keep) | (nl << shift);
      markCell(ncol, nx & 15, ny, nz & 15);
      pushQ(nx, ny, nz);
    }
  }
  qLen = 0;
}

/**
 * Run the removal queue of one channel: clear every cell that was fed by removed light; brighter (or
 * independently lit) neighbours become propagation seeds. Emitters are re-seeded with their own level.
 */
function removeLight(sky) {
  const shift = sky ? 4 : 0;
  const keep = sky ? 0x0f : 0xf0;
  for (let h = 0; h < rLen; h++) {
    const p = rPos[h];
    const L = rLev[h];
    const x = (p & 0xfff) + ox, z = ((p >>> 12) & 0xfff) + oz, y = p >>> 24;
    for (let d = 0; d < 6; d++) {
      const ny = y + DY[d];
      if (ny < 0 || ny > TOP) continue;
      const nx = x + DX[d], nz = z + DZ[d];
      const ncol = litCol(nx >> 4, nz >> 4);
      if (ncol === null) continue;
      const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8);
      const cur = ncol.light[ni];
      const nl = (cur >> shift) & 15;
      if (nl === 0) continue;
      if (nl < L || (sky && d === DOWN && L === 15 && nl === 15)) {
        ncol.light[ni] = cur & keep;
        markCell(ncol, nx & 15, ny, nz & 15);
        pushR(nx, ny, nz, nl);
        if (!sky) {
          const e = B_EMIT[ncol.blocks[ni] & 0xff];
          if (e > 0) { ncol.light[ni] = (cur & keep) | e; pushQ(nx, ny, nz); }
        }
      } else {
        pushQ(nx, ny, nz);
      }
    }
  }
  rLen = 0;
}

/* ------------------------------------------------------------------ heightmap */

/** Recompute col.heightmap for every (lx, lz). heightmap = lowest y with only filter-0 cells at and above it. */
export function computeHeightmap(col) {
  const b = col.blocks, hm = col.heightmap;
  for (let i = 0; i < 256; i++) {
    let y = TOP;
    while (y >= 0 && B_FILTER[b[i | (y << 8)] & 0xff] === 0) y--;
    hm[i] = y + 1;
  }
  col.heightReady = true;
}

/**
 * Keep the heightmap right after one cell changed (world.setBlock step 4).
 * @param {import('./column.js').Column} col @param {number} lx @param {number} y @param {number} lz
 */
export function updateHeightAt(col, lx, y, lz) {
  const i = lx | (lz << 4);
  const h = col.heightmap[i];
  const f = B_FILTER[col.blocks[i | (y << 8)] & 0xff];
  if (f > 0) { if (y >= h) col.heightmap[i] = y + 1; return; }
  if (y === h - 1) {
    let yy = y;
    while (yy >= 0 && B_FILTER[col.blocks[i | (yy << 8)] & 0xff] === 0) yy--;
    col.heightmap[i] = yy + 1;
  }
}

/* ------------------------------------------------------------------ initial lighting */

/**
 * Initial light for a freshly generated/restored column (GENERATED -> LIT). The caller guarantees the 3x3
 * neighbourhood is GENERATED (heightmaps valid). Pulls light from LIT neighbours and pushes into them
 * (border reconciliation); touched neighbour sections are marked dirty (background).
 * @param {object} world World system (getColumn) @param {import('./column.js').Column} col
 */
export function lightColumn(world, col) {
  if (!col.heightReady) computeHeightmap(col);
  const bx = col.cx << 4, bz = col.cz << 4;
  begin(world, bx + 8, bz + 8);
  target = col;
  urgent = false;
  try {
    const L = col.light, B = col.blocks, hm = col.heightmap;
    // 1) sky 15 above the heightmap, 0 below; block light = own emission. Collect emitters.
    const emitters = [];
    for (let i = 0; i < 32768; i++) {
      const e = B_EMIT[B[i] & 0xff];
      L[i] = (i >> 8) >= hm[i & 255] ? 0xf0 | e : e;
      if (e > 1) emitters.push(i);
    }
    // 2) sky seeds: sky-15 cells that have a darker non-opaque horizontal neighbour, plus the top lit cell
    //    of every x/z (light going down into leaves / water).
    const nW = anyCol(col.cx - 1, col.cz), nE = anyCol(col.cx + 1, col.cz);
    const nN = anyCol(col.cx, col.cz - 1), nS = anyCol(col.cx, col.cz + 1);
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const h = hm[lx | (lz << 4)];
        if (h > TOP) continue;
        let m = h + 1;
        let v;
        v = lx > 0 ? hm[(lx - 1) | (lz << 4)] : nbHeight(nW, 15, lz, h); if (v > m) m = v;
        v = lx < 15 ? hm[(lx + 1) | (lz << 4)] : nbHeight(nE, 0, lz, h); if (v > m) m = v;
        v = lz > 0 ? hm[lx | ((lz - 1) << 4)] : nbHeight(nN, lx, 15, h); if (v > m) m = v;
        v = lz < 15 ? hm[lx | ((lz + 1) << 4)] : nbHeight(nS, lx, 0, h); if (v > m) m = v;
        if (m > WORLD_HEIGHT) m = WORLD_HEIGHT;
        for (let y = h; y < m; y++) pushQ(bx + lx, y, bz + lz);
      }
    }
    // 3) border reconciliation: LIT neighbours' border cells re-seed into this column.
    seedBorder(nW, 15, -1, true); seedBorder(nE, 0, -1, true); seedBorder(nN, -1, 15, true); seedBorder(nS, -1, 0, true);
    propagate(true);
    for (let k = 0; k < emitters.length; k++) {
      const i = emitters[k];
      pushQ(bx + (i & 15), i >> 8, bz + ((i >> 4) & 15));
    }
    seedBorder(nW, 15, -1, false); seedBorder(nE, 0, -1, false); seedBorder(nN, -1, 15, false); seedBorder(nS, -1, 0, false);
    propagate(false);
  } finally {
    end();
  }
}
function nbHeight(c, lx, lz, fallback) { return c !== null && c.heightReady ? c.heightmap[lx | (lz << 4)] : fallback; }

/**
 * Queue the cells of neighbour column c on the plane lx = fx (or lz = fz) whose light (one channel) can
 * brighten the adjacent cell of the column being lit.
 */
function seedBorder(c, fx, fz, sky) {
  if (c === null || c.state < COL_STATE.LIT) return;
  const shift = sky ? 4 : 0;
  const bx = c.cx << 4, bz = c.cz << 4, L = c.light, T = target.light;
  // adjacent cell in the target column: across the shared border
  const ax = fx >= 0 ? 15 - fx : -1, az = fx >= 0 ? -1 : 15 - fz;
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    const yo = y << 8;
    for (let k = 0; k < 16; k++) {
      const lx = fx >= 0 ? fx : k, lz = fx >= 0 ? k : fz;
      const l = (L[lx | (lz << 4) | yo] >> shift) & 15;
      if (l <= 1) continue;
      const tx = ax >= 0 ? ax : k, tz = ax >= 0 ? k : az;
      if (((T[tx | (tz << 4) | yo] >> shift) & 15) >= l - 1) continue;
      pushQ(bx + lx, y, bz + lz);
    }
  }
}

/* ------------------------------------------------------------------ incremental relight */

/**
 * Incremental relight after world.setBlock changed (x,y,z) from oldRaw to newRaw (world coords), both
 * channels, across column borders. Marks every section whose light changed (urgent).
 */
export function relightBlock(world, x, y, z, oldRaw, newRaw) {
  relightBatch(world, [x, y, z, oldRaw, newRaw]);
}

/**
 * Combined relight after a batch of edits (world.endBatch): one removal + one propagation pass per channel,
 * seeded from every changed cell. changes = flat (x, y, z, oldRaw, newRaw) quintuples.
 * @param {object} world @param {ArrayLike<number>} changes
 */
export function relightBatch(world, changes) {
  const n = changes.length;
  if (n < 5) return;
  // Group by packing origin (batches wider than ~4000 blocks are split; practically never happens).
  let rest = null;
  begin(world, changes[0], changes[2]);
  urgent = true;
  try {
    const sel = [];
    for (let k = 0; k < n; k += 5) {
      const x = changes[k], y = changes[k + 1], z = changes[k + 2];
      if (y < 0 || y > TOP) continue;
      const o = changes[k + 3] & 0xff, nw = changes[k + 4] & 0xff;
      if (B_FILTER[o] === B_FILTER[nw] && B_EMIT[o] === B_EMIT[nw]) continue; // light-neutral change
      if (!inRange(x, z)) { (rest || (rest = [])).push(x, y, z, changes[k + 3], changes[k + 4]); continue; }
      if (litCol(x >> 4, z >> 4) === null) continue;
      sel.push(x, y, z);
    }
    if (sel.length) {
      relightChannel(sel, true);
      relightChannel(sel, false);
    }
  } finally {
    end();
  }
  if (rest) relightBatch(world, rest);
}

function relightChannel(sel, sky) {
  const shift = sky ? 4 : 0, keep = sky ? 0x0f : 0xf0;
  // removal seeds: every changed cell with its old level
  for (let k = 0; k < sel.length; k += 3) {
    const x = sel[k], y = sel[k + 1], z = sel[k + 2];
    const col = litCol(x >> 4, z >> 4);
    const i = (x & 15) | ((z & 15) << 4) | (y << 8);
    const cur = col.light[i];
    const lev = (cur >> shift) & 15;
    if (lev > 0) {
      col.light[i] = cur & keep;
      markCell(col, x & 15, y, z & 15);
      pushR(x, y, z, lev);
    }
  }
  removeLight(sky);
  // re-seed: emission / open sky at the changed cells, and every neighbour of a changed cell
  for (let k = 0; k < sel.length; k += 3) {
    const x = sel[k], y = sel[k + 1], z = sel[k + 2];
    const col = litCol(x >> 4, z >> 4);
    const i = (x & 15) | ((z & 15) << 4) | (y << 8);
    const id = col.blocks[i] & 0xff;
    let own = 0;
    if (sky) { if (y === TOP) { const f = B_FILTER[id]; own = f === 0 ? 15 : f >= 15 ? 0 : 14 - f; } }
    else own = B_EMIT[id];
    const cur = col.light[i];
    if (own > ((cur >> shift) & 15)) { col.light[i] = (cur & keep) | (own << shift); markCell(col, x & 15, y, z & 15); }
    pushQ(x, y, z);
    for (let d = 0; d < 6; d++) {
      const ny = y + DY[d];
      if (ny < 0 || ny > TOP) continue;
      if (litCol((x + DX[d]) >> 4, (z + DZ[d]) >> 4) !== null) pushQ(x + DX[d], ny, z + DZ[d]);
    }
  }
  propagate(sky);
}
