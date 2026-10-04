// OWNER LANE: CORE-C (world data/lighting/mesher). Spec: docs/SPEC.md §5.3.5 (mesher) and §5.4 (mesh contract
// consumed by CORE-D). meshSection / meshBlockModel are PURE over typed arrays (no three.js, no DOM, no world
// access) so they run in the worker too; buildPadded is the only function that reads the world.
//
// Output per pass: MeshBuffers {position: Float32Array(quads*12), tex: Uint16Array(quads*16),
// light: Uint8Array(quads*16), corner: Uint16Array(quads*16), quads} - 4 vertices per quad, no index array
// (renderer uses QUAD_INDICES).
//   tex    = [layer, u, v, flags]  u,v in 1/256 tile; flags: bits 0-2 face (6 = non-axis plant), 3-4 ANIM, 5-6 WAVE,
//            bits 7-8 which corner of the quad this vertex is (0 BL, 1 BR, 2 TR, 3 TL)
//   light  = [sky*16, block*16, ao 0..3, shade*255] of this vertex
//   corner = the quad's four corner lights (BL, BR, TR, TL; the same on all 4 vertices), each
//            sky*8 | block*8 << 7 | ao << 14 (v1.4, review CORE-R2: the chunk shader blends them bilinearly per
//            pixel, so smooth light and AO have no triangle diagonal)
// Cubes: face culling, per-vertex AO (0fps), smooth light, quad flip on combined AO x light. Other shapes:
// boxes with uv-lock (slabs, stairs, doors, beds, chests, cakes, carpets, snow layers, farmland, panes,
// fences, gates, cactus), single quads (ladder), cross plants with hash jitter, crops (#), torches (tilted on
// walls), fire, liquids (corner heights averaged, P1).

import {
  B_ANIM, B_FILTER, B_LIQUID, B_OPAQUE, B_PASS, B_SHAPE, B_WAVE, ID, PASS, SHAPE, blockDef, faceLayer,
  getSelectionBoxes,
} from '../core/registry.js';
import { POT_PLANTS } from '../data/blocks.js';
import { FACE_SHADE, PADDED, SECTION_SIZE, WORLD_HEIGHT, colIndex, padIndex } from '../core/constants.js';

/** Size of the padded input arrays (18^3). */
export const PADDED_VOLUME = PADDED * PADDED * PADDED;

/**
 * Quad corner positions per face, in the REQUIRED vertex order: bottom-left, bottom-right, top-right, top-left
 * as seen from OUTSIDE the face (counter-clockwise => front face for three.js). Triangles are always
 * (0,1,2) (0,2,3); the mesher rotates the start corner by one to flip the diagonal (AO anisotropy fix).
 * Texture u goes left->right, v goes top->bottom (v=0 is the top row of the 16x16 image).
 * Up face: texture top edge points north (-Z). Down face: texture top edge points south (+Z).
 */
export const FACE_CORNERS = Object.freeze([
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], // 0 east  (+X)
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // 1 west  (-X)
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], // 2 up    (+Y)
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // 3 down  (-Y)
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // 4 south (+Z)
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], // 5 north (-Z)
]);
/** UV (in 1/256 tile units) for corners BL, BR, TR, TL. */
export const CORNER_UV = Object.freeze([[0, 256], [256, 256], [256, 0], [0, 0]]);
/** Index pattern per quad (offset by 4*q). */
export const QUAD_INDICES = Object.freeze([0, 1, 2, 0, 2, 3]);

/* ------------------------------------------------------------------ tables */
const PX = 1 / 16;
const FDX = [1, -1, 0, 0, 0, 0], FDY = [0, 0, 1, -1, 0, 0], FDZ = [0, 0, 0, 0, 1, -1];
/** padded index delta of each face normal */
const FD = new Int32Array(6);
for (let f = 0; f < 6; f++) FD[f] = FDX[f] + FDZ[f] * PADDED + FDY[f] * PADDED * PADDED;
/** Corner positions flattened [f*12 + k*3 + axis]. */
const FC = new Float32Array(72);
for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) for (let a = 0; a < 3; a++) FC[f * 12 + k * 3 + a] = FACE_CORNERS[f][k][a];
/** AO sample deltas per face/corner: [side1, side2] relative to the face-neighbour cell. */
const AOD = new Int32Array(48);
{
  const STRIDE = [1, PADDED * PADDED, PADDED]; // x, y, z strides
  for (let f = 0; f < 6; f++) {
    const normalAxis = FDX[f] !== 0 ? 0 : FDY[f] !== 0 ? 1 : 2;
    const tang = [0, 1, 2].filter((a) => a !== normalAxis);
    for (let k = 0; k < 4; k++) {
      const c = FACE_CORNERS[f][k];
      AOD[f * 8 + k * 2] = (c[tang[0]] ? 1 : -1) * STRIDE[tang[0]];
      AOD[f * 8 + k * 2 + 1] = (c[tang[1]] ? 1 : -1) * STRIDE[tang[1]];
    }
  }
}
const SHADE = FACE_SHADE.map((s) => Math.round(s * 255));
const PLANT_SHADE = Math.round(0.9 * 255);
const PLANT_FACE = 6;

/** Per-id helper tables. */
const T_AXIS = new Uint8Array(256);       // logs / hay: side UVs rotate with the axis
const T_CULL_SAME = new Uint8Array(256);  // glass, stained glass, ice, panes, fences: same-id neighbours cull
const T_LEAVES = new Uint8Array(256);
const T_ROOF = new Uint8Array(256);       // filter 15 but not opaque (slabs, stairs): light read from neighbours
const T_FLAGS = new Uint16Array(256);     // ANIM << 3 | WAVE << 5
for (let id = 0; id < 256; id++) {
  const b = blockDef(id);
  if (!b) continue;
  T_AXIS[id] = b.axis ? 1 : 0;
  T_LEAVES[id] = b.wave === 'leaves' ? 1 : 0;
  T_ROOF[id] = B_FILTER[id] >= 15 && !B_OPAQUE[id] ? 1 : 0;
  T_FLAGS[id] = (B_ANIM[id] << 3) | (B_WAVE[id] << 5);
  if (b.name === 'glass' || b.name === 'ice' || b.name.endsWith('_stained_glass') || b.shape === 'pane' || b.shape === 'fence' || b.shape === 'portal') T_CULL_SAME[id] = 1;
}
/** Flower pot state (bits 0-3) -> block id of the potted plant (0 = empty). */
const POT_IDS = new Uint8Array(16);
POT_PLANTS.forEach((n, i) => { if (n) POT_IDS[i] = ID[n]; });

/* ------------------------------------------------------------------ output buffers (growable scratch) */
class Buf {
  constructor() { this.cap = 0; this.quads = 0; this.pos = null; this.tex = null; this.light = null; this.corner = null; this.grow(1024); }
  grow(q) {
    const pos = new Float32Array(q * 12), tex = new Uint16Array(q * 16), light = new Uint8Array(q * 16), corner = new Uint16Array(q * 16);
    if (this.pos) { pos.set(this.pos); tex.set(this.tex); light.set(this.light); corner.set(this.corner); }
    this.pos = pos; this.tex = tex; this.light = light; this.corner = corner; this.cap = q;
  }
  finish() {
    if (this.quads === 0) return null;
    const q = this.quads;
    return { position: this.pos.slice(0, q * 12), tex: this.tex.slice(0, q * 16), light: this.light.slice(0, q * 16), corner: this.corner.slice(0, q * 16), quads: q };
  }
}
const BUFS = [new Buf(), new Buf(), new Buf()];

/* per-quad scratch: positions, uvs, per-corner sky/block (x16 for light, x8 for corner) and ao */
const QP = new Float32Array(12);
const QUV = new Int32Array(8);
const QS = new Uint8Array(4), QB = new Uint8Array(4), QA = new Uint8Array(4);
const QS8 = new Uint8Array(4), QB8 = new Uint8Array(4);

/** Effective light (slabs/stairs take their neighbours' max light). */
let EL = new Uint8Array(PADDED_VOLUME);
let BLK = null;
let SMOOTH = true, FANCY = true;
let OX = 0, OY = 0, OZ = 0, JITTER = true;

function emitQuad(buf, layer, flags, shade) {
  if (buf.quads === buf.cap) buf.grow(buf.cap * 2);
  // Quad flip (combined AO x light brightness per corner). The diagonal runs through the corner pair that differs
  // most, so a single odd corner - dark (AO) or bright (a torch-lit corner) - is shared by both triangles and its
  // value spreads over the whole face instead of making a sharp one-triangle wedge. Ties (flat faces, linear
  // gradients) keep the classic rule: rotate the start corner when a00 + a11 > a01 + a10.
  const b0 = (QA[0] + 1) * (16 + Math.max(QS[0], QB[0]));
  const b1 = (QA[1] + 1) * (16 + Math.max(QS[1], QB[1]));
  const b2 = (QA[2] + 1) * (16 + Math.max(QS[2], QB[2]));
  const b3 = (QA[3] + 1) * (16 + Math.max(QS[3], QB[3]));
  const d02 = Math.abs(b0 - b2), d13 = Math.abs(b1 - b3);
  const start = d02 > d13 ? 0 : d13 > d02 ? 1 : b0 + b2 > b1 + b3 ? 1 : 0;
  // the quad's four corner lights, in corner order BL, BR, TR, TL (blended bilinearly per pixel by the shader)
  const c0 = QS8[0] | (QB8[0] << 7) | (QA[0] << 14), c1 = QS8[1] | (QB8[1] << 7) | (QA[1] << 14);
  const c2 = QS8[2] | (QB8[2] << 7) | (QA[2] << 14), c3 = QS8[3] | (QB8[3] << 7) | (QA[3] << 14);
  const q = buf.quads++;
  const P = buf.pos, T = buf.tex, L = buf.light, C = buf.corner;
  let pi = q * 12, ti = q * 16;
  for (let j = 0; j < 4; j++) {
    const k = (start + j) & 3;
    P[pi++] = QP[k * 3]; P[pi++] = QP[k * 3 + 1]; P[pi++] = QP[k * 3 + 2];
    T[ti] = layer; T[ti + 1] = QUV[k * 2]; T[ti + 2] = QUV[k * 2 + 1]; T[ti + 3] = flags | (k << 7);
    L[ti] = QS[k]; L[ti + 1] = QB[k]; L[ti + 2] = QA[k]; L[ti + 3] = shade;
    C[ti] = c0; C[ti + 1] = c1; C[ti + 2] = c2; C[ti + 3] = c3;
    ti += 4;
  }
}

/** Smooth light + AO for face f of the cell at padded index p (samples the plane of the face neighbour). */
function faceLight(p, f, withAO) {
  const q = p + FD[f];
  if (!SMOOTH) { flatLight(q); return; }
  const lq = EL[q];
  const base = f * 8;
  for (let k = 0; k < 4; k++) {
    const a = q + AOD[base + k * 2], b = q + AOD[base + k * 2 + 1], c = a + AOD[base + k * 2 + 1];
    const s1 = B_OPAQUE[BLK[a] & 0xff], s2 = B_OPAQUE[BLK[b] & 0xff], sc = B_OPAQUE[BLK[c] & 0xff];
    let sky = lq >> 4, blk = lq & 15, n = 1;
    if (!s1) { const l = EL[a]; sky += l >> 4; blk += l & 15; n++; }
    if (!s2) { const l = EL[b]; sky += l >> 4; blk += l & 15; n++; }
    if (!sc && !(s1 && s2)) { const l = EL[c]; sky += l >> 4; blk += l & 15; n++; }
    QS[k] = Math.round(sky * 16 / n);
    QB[k] = Math.round(blk * 16 / n);
    QS8[k] = Math.round(sky * 8 / n);
    QB8[k] = Math.round(blk * 8 / n);
    QA[k] = withAO ? (s1 && s2 ? 0 : 3 - (s1 + s2 + sc)) : 3;
  }
}
/** Flat light from one padded cell. */
function flatLight(p) {
  const l = EL[p];
  const s = (l >> 4) * 16, b = (l & 15) * 16;
  for (let k = 0; k < 4; k++) { QS[k] = s; QB[k] = b; QA[k] = 3; QS8[k] = s >> 1; QB8[k] = b >> 1; }
}

/** UV of a point on face f (uv-lock: texture follows block-local coordinates). */
function uvOf(f, x, y, z, k) {
  let u, v;
  switch (f) {
    case 0: u = 1 - z; v = 1 - y; break;
    case 1: u = z; v = 1 - y; break;
    case 2: u = x; v = z; break;
    case 3: u = x; v = 1 - z; break;
    case 4: u = x; v = 1 - y; break;
    default: u = 1 - x; v = 1 - y; break;
  }
  QUV[k * 2] = Math.round(u * 256);
  QUV[k * 2 + 1] = Math.round(v * 256);
}

/* ------------------------------------------------------------------ shapes */

function cube(p, x, y, z, id, state, buf) {
  const flags = T_FLAGS[id];
  const axis = T_AXIS[id] ? state & 3 : 0;
  for (let f = 0; f < 6; f++) {
    const nid = BLK[p + FD[f]] & 0xff;
    if (B_OPAQUE[nid]) continue;
    if (nid === id && T_CULL_SAME[id]) continue;
    if (!FANCY && T_LEAVES[id] && T_LEAVES[nid]) continue;
    const fo = f * 12;
    for (let k = 0; k < 4; k++) {
      QP[k * 3] = x + FC[fo + k * 3]; QP[k * 3 + 1] = y + FC[fo + k * 3 + 1]; QP[k * 3 + 2] = z + FC[fo + k * 3 + 2];
    }
    // logs / hay lying along X rotate the N, S, up and down faces; along Z the E and W faces
    const rot = (axis === 1 && (f >= 2)) || (axis === 2 && f <= 1) ? 1 : 0;
    for (let k = 0; k < 4; k++) { const c = CORNER_UV[(k + rot) & 3]; QUV[k * 2] = c[0]; QUV[k * 2 + 1] = c[1]; }
    faceLight(p, f, true);
    emitQuad(buf, faceLayer(id, state, f), f | flags, SHADE[f]);
  }
}

/**
 * Emit the faces of one axis-aligned box (block-local 0..1). Boundary faces are culled against opaque (and,
 * for panes/fences, same-id) neighbours and get smooth light + AO; inner faces use the cell's own light.
 * skipMask: bit f => do not emit face f. uvRot (up face only): rotate the top texture by n quarter turns.
 */
function box(p, x, y, z, id, state, buf, x0, y0, z0, x1, y1, z1, skipMask = 0, upRot = 0) {
  const flags = T_FLAGS[id];
  for (let f = 0; f < 6; f++) {
    if (skipMask & (1 << f)) continue;
    let boundary;
    switch (f) {
      case 0: boundary = x1 >= 1; break;
      case 1: boundary = x0 <= 0; break;
      case 2: boundary = y1 >= 1; break;
      case 3: boundary = y0 <= 0; break;
      case 4: boundary = z1 >= 1; break;
      default: boundary = z0 <= 0; break;
    }
    if (boundary) {
      const nid = BLK[p + FD[f]] & 0xff;
      if (B_OPAQUE[nid]) continue;
      if (nid === id && T_CULL_SAME[id]) continue;
    }
    const fo = f * 12;
    for (let k = 0; k < 4; k++) {
      const cx = FC[fo + k * 3] ? x1 : x0, cy = FC[fo + k * 3 + 1] ? y1 : y0, cz = FC[fo + k * 3 + 2] ? z1 : z0;
      QP[k * 3] = x + cx; QP[k * 3 + 1] = y + cy; QP[k * 3 + 2] = z + cz;
      uvOf(f, cx, cy, cz, k);
    }
    if (f === 2 && upRot) rotateUV(upRot);
    if (boundary) faceLight(p, f, true); else flatLight(p);
    emitQuad(buf, faceLayer(id, state, f), f | flags, SHADE[f]);
  }
}
const UVTMP = new Int32Array(8);
function rotateUV(r) {
  UVTMP.set(QUV);
  for (let k = 0; k < 4; k++) { const s = (k + r) & 3; QUV[k * 2] = UVTMP[s * 2]; QUV[k * 2 + 1] = UVTMP[s * 2 + 1]; }
}

function boxes(p, x, y, z, id, state, buf, list) {
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    box(p, x, y, z, id, state, buf, b[0], b[1], b[2], b[3], b[4], b[5]);
  }
}

/** A free quad given 4 corners (BL, BR, TR, TL) relative to the cell, with standard full UVs. */
function freeQuad(buf, x, y, z, c, layer, flags, shade) {
  for (let k = 0; k < 4; k++) {
    QP[k * 3] = x + c[k * 3]; QP[k * 3 + 1] = y + c[k * 3 + 1]; QP[k * 3 + 2] = z + c[k * 3 + 2];
    QUV[k * 2] = CORNER_UV[k][0]; QUV[k * 2 + 1] = CORNER_UV[k][1];
  }
  emitQuad(buf, layer, flags, shade);
}
const FQ = new Float32Array(12);

function hashXZ(x, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

function cross(p, x, y, z, id, state, buf) {
  let jx = 0, jz = 0;
  if (JITTER) {
    const h = hashXZ(OX + x, OZ + z);
    jx = ((h & 0xff) / 255 - 0.5) * 0.3;
    jz = (((h >>> 8) & 0xff) / 255 - 0.5) * 0.3;
  }
  const layer = faceLayer(id, state, 2);
  const flags = PLANT_FACE | T_FLAGS[id];
  flatLight(p);
  const a = 0.05, b = 0.95;
  // plane 1: (a,a) -> (b,b) ; plane 2: (a,b) -> (b,a)
  setFQ(a + jx, 0, a + jz, b + jx, 0, b + jz, 1);
  freeQuad(buf, x, y, z, FQ, layer, flags, PLANT_SHADE);
  setFQ(a + jx, 0, b + jz, b + jx, 0, a + jz, 1);
  freeQuad(buf, x, y, z, FQ, layer, flags, PLANT_SHADE);
}
/** Vertical quad from (x0,z0) to (x1,z1), y from y0 to y0+h. */
function setFQ(x0, y0, z0, x1, y1unused, z1, h) {
  FQ[0] = x0; FQ[1] = y0; FQ[2] = z0;
  FQ[3] = x1; FQ[4] = y0; FQ[5] = z1;
  FQ[6] = x1; FQ[7] = y0 + h; FQ[8] = z1;
  FQ[9] = x0; FQ[10] = y0 + h; FQ[11] = z0;
}

/** Flower pot (v1.7): the pot box, plus the potted plant as a small cross standing in the soil (no sway). */
function pot(p, x, y, z, id, state, buf) {
  box(p, x, y, z, id, state, buf, 5 * PX, 0, 5 * PX, 11 * PX, 6 * PX, 11 * PX);
  const pid = POT_IDS[state & 15];
  if (!pid) return;
  const layer = faceLayer(pid, 0, 2);
  const flags = PLANT_FACE | (B_ANIM[pid] << 3);
  flatLight(p);
  const a = 0.22, b = 0.78, y0 = 4 * PX, h = 0.72;
  setFQ(a, y0, a, b, 0, b, h);
  freeQuad(buf, x, y, z, FQ, layer, flags, PLANT_SHADE);
  setFQ(a, y0, b, b, 0, a, h);
  freeQuad(buf, x, y, z, FQ, layer, flags, PLANT_SHADE);
}

function crop(p, x, y, z, id, state, buf) {
  const layer = faceLayer(id, state, 2);
  const flags = PLANT_FACE | T_FLAGS[id];
  flatLight(p);
  const y0 = -PX;
  for (const c of [4 * PX, 12 * PX]) {
    setFQ(0, y0, c, 1, 0, c, 1); freeQuad(buf, x, y, z, FQ, layer, flags, PLANT_SHADE);
    setFQ(c, y0, 1, c, 0, 0, 1); freeQuad(buf, x, y, z, FQ, layer, flags, PLANT_SHADE);
  }
}

function fire(p, x, y, z, id, state, buf) {
  const layer = faceLayer(id, state, 2);
  const flags = PLANT_FACE | T_FLAGS[id];
  flatLight(p);
  const t = 0.3, h = 1.1;
  // four planes: bottom edge on a side of the cell, top edge leaning inward
  quad4(0, 0, 0, 0, 0, 1, t, h, 1, t, h, 0); freeQuad(buf, x, y, z, FQ, layer, flags, PLANT_SHADE);
  quad4(1, 0, 1, 1, 0, 0, 1 - t, h, 0, 1 - t, h, 1); freeQuad(buf, x, y, z, FQ, layer, flags, PLANT_SHADE);
  quad4(1, 0, 0, 0, 0, 0, 0, h, t, 1, h, t); freeQuad(buf, x, y, z, FQ, layer, flags, PLANT_SHADE);
  quad4(0, 0, 1, 1, 0, 1, 1, h, 1 - t, 0, h, 1 - t); freeQuad(buf, x, y, z, FQ, layer, flags, PLANT_SHADE);
}
function quad4(a0, a1, a2, b0, b1, b2, c0, c1, c2, d0, d1, d2) {
  FQ[0] = a0; FQ[1] = a1; FQ[2] = a2; FQ[3] = b0; FQ[4] = b1; FQ[5] = b2;
  FQ[6] = c0; FQ[7] = c1; FQ[8] = c2; FQ[9] = d0; FQ[10] = d1; FQ[11] = d2;
}

/* torch: 2x10x2 px stick; wall torches lean 22.5 degrees away from the wall */
const TORCH_COS = Math.cos(22.5 * Math.PI / 180), TORCH_SIN = Math.sin(22.5 * Math.PI / 180);
function torch(p, x, y, z, id, state, buf) {
  const flags = T_FLAGS[id];
  flatLight(p);
  const s = state & 7;
  const wall = s >= 1 && s <= 4;
  const d = (s - 1) & 3;
  const dx = wall ? [0, 1, 0, -1][d] : 0, dz = wall ? [-1, 0, 1, 0][d] : 0;
  const baseX = 0.5 + dx * 0.42, baseZ = 0.5 + dz * 0.42, baseY = wall ? 3.5 * PX : 0;
  const lo = -PX, hi = PX, top = 10 * PX;
  for (let f = 0; f < 6; f++) {
    const fo = f * 12;
    for (let k = 0; k < 4; k++) {
      const lx = FC[fo + k * 3] ? hi : lo, ly = FC[fo + k * 3 + 1] ? top : 0, lz = FC[fo + k * 3 + 2] ? hi : lo;
      let px = lx, py = ly, pz = lz;
      if (wall) {
        const a = lx * dx + lz * dz, b = lx * -dz + lz * dx;
        const a2 = a * TORCH_COS - ly * TORCH_SIN;
        py = a * TORCH_SIN + ly * TORCH_COS;
        px = a2 * dx + b * -dz;
        pz = a2 * dz + b * dx;
      }
      QP[k * 3] = x + baseX + px; QP[k * 3 + 1] = y + baseY + py; QP[k * 3 + 2] = z + baseZ + pz;
      // uv: stick at texture columns 7..8, rows 6..15; top = flame rows 6..7, bottom = rows 14..15
      uvOf(f, 0.5 + lx, ly, 0.5 + lz, k);
      if (f === 2) QUV[k * 2 + 1] = FC[fo + k * 3 + 2] ? 128 : 96;
      else if (f === 3) QUV[k * 2 + 1] = FC[fo + k * 3 + 2] ? 224 : 256;
    }
    emitQuad(buf, faceLayer(id, state, f), f | flags, SHADE[f]);
  }
}

function ladder(p, x, y, z, id, state, buf) {
  const F = state & 3;
  const face = [5, 0, 4, 1][F];        // FACING_TO_FACE: the quad faces away from the wall
  const wall = (F + 2) & 3;            // wall side
  let x0 = 0, z0 = 0, x1 = 1, z1 = 1;
  if (wall === 0) z1 = PX;             // wall north: plane at z = 1/16 facing south
  else if (wall === 1) x0 = 1 - PX;    // wall east: plane at x = 15/16 facing west
  else if (wall === 2) z0 = 1 - PX;
  else x1 = PX;
  box(p, x, y, z, id, state, buf, x0, 0, z0, x1, 1, z1, 0x3f & ~(1 << face));
}

function cactus(p, x, y, z, id, state, buf) {
  box(p, x, y, z, id, state, buf, 0, 0, 0, 1, 1, 1, 0x3f & ~((1 << 2) | (1 << 3)));
  box(p, x, y, z, id, state, buf, PX, 0, PX, 1 - PX, 1, 1 - PX, (1 << 2) | (1 << 3));
}

function fence(p, x, y, z, id, state, buf) {
  box(p, x, y, z, id, state, buf, 6 * PX, 0, 6 * PX, 10 * PX, 1, 10 * PX);
  for (let d = 0; d < 4; d++) {
    if (!(state & (1 << d))) continue;
    for (const [ya, yb] of RAILS) {
      if (d === 0) box(p, x, y, z, id, state, buf, 7 * PX, ya, 0, 9 * PX, yb, 6 * PX);
      else if (d === 1) box(p, x, y, z, id, state, buf, 10 * PX, ya, 7 * PX, 1, yb, 9 * PX);
      else if (d === 2) box(p, x, y, z, id, state, buf, 7 * PX, ya, 10 * PX, 9 * PX, yb, 1);
      else box(p, x, y, z, id, state, buf, 0, ya, 7 * PX, 6 * PX, yb, 9 * PX);
    }
  }
}
const RAILS = [[6 * PX, 9 * PX], [12 * PX, 15 * PX]];

function gate(p, x, y, z, id, state, buf) {
  const alongX = (state & 1) === 0;   // facing N/S: the gate line runs along X
  const open = (state & 4) !== 0;
  const f = state & 3;
  const post = (a0, a1) => (alongX
    ? box(p, x, y, z, id, state, buf, a0, 5 * PX, 7 * PX, a1, 1, 9 * PX)
    : box(p, x, y, z, id, state, buf, 7 * PX, 5 * PX, a0, 9 * PX, 1, a1));
  post(0, 2 * PX);
  post(14 * PX, 1);
  for (const [ya, yb] of RAILS) {
    if (!open) {
      if (alongX) box(p, x, y, z, id, state, buf, 2 * PX, ya, 7 * PX, 14 * PX, yb, 9 * PX);
      else box(p, x, y, z, id, state, buf, 7 * PX, ya, 2 * PX, 9 * PX, yb, 14 * PX);
    } else {
      // rails swung open toward the facing side, one leaf on each post
      const towardPlus = f === 2 || f === 1;
      const a0 = towardPlus ? 9 * PX : 2 * PX, a1 = towardPlus ? 14 * PX : 7 * PX;
      if (alongX) {
        box(p, x, y, z, id, state, buf, 0, ya, a0, 2 * PX, yb, a1);
        box(p, x, y, z, id, state, buf, 14 * PX, ya, a0, 1, yb, a1);
      } else {
        box(p, x, y, z, id, state, buf, a0, ya, 0, a1, yb, 2 * PX);
        box(p, x, y, z, id, state, buf, a0, ya, 14 * PX, a1, yb, 1);
      }
    }
  }
}

/* liquids: faces only toward non-opaque cells that are not the same liquid; top corners averaged */
const LH = new Float32Array(4); // corner heights [x0z0, x1z0, x0z1, x1z1]
function liquidHeight(p, lid) {
  const v = BLK[p];
  if (B_LIQUID[v & 0xff] !== lid) return -1;
  if (B_LIQUID[BLK[p + FD[2]] & 0xff] === lid) return 1;
  const st = v >> 8;
  if (st & 8) return 14 / 16;
  return (14 / 16) * (8 - (st & 7)) / 8;
}
function liquid(p, x, y, z, id, state, buf) {
  const lid = B_LIQUID[id];
  const flags = T_FLAGS[id];
  const aboveSame = B_LIQUID[BLK[p + FD[2]] & 0xff] === lid;
  if (aboveSame) { LH[0] = LH[1] = LH[2] = LH[3] = 1; } else {
    // corner (cx, cz) averages the same-liquid cells among the 4 cells sharing it; full if any has liquid above
    for (let cz = 0; cz < 2; cz++) for (let cx = 0; cx < 2; cx++) {
      let sum = 0, n = 0, full = false;
      for (let dz = cz - 1; dz <= cz; dz++) for (let dx = cx - 1; dx <= cx; dx++) {
        const h = liquidHeight(p + dx + dz * PADDED, lid);
        if (h < 0) continue;
        if (h === 1) full = true;
        sum += h; n++;
      }
      LH[cx + cz * 2] = full ? 1 : n ? sum / n : 14 / 16;
    }
  }
  for (let f = 0; f < 6; f++) {
    const nid = BLK[p + FD[f]] & 0xff;
    if (B_OPAQUE[nid] || B_LIQUID[nid] === lid) continue;
    const fo = f * 12;
    for (let k = 0; k < 4; k++) {
      const cx = FC[fo + k * 3], cy = FC[fo + k * 3 + 1], cz = FC[fo + k * 3 + 2];
      const h = cy ? LH[cx + cz * 2] : 0;
      QP[k * 3] = x + cx; QP[k * 3 + 1] = y + h; QP[k * 3 + 2] = z + cz;
      uvOf(f, cx, h, cz, k);
    }
    faceLight(p, f, false);
    emitQuad(buf, faceLayer(id, state, f), f | flags, SHADE[f]);
    if (f !== 2 && (flags & (3 << 5))) {
      // only the surface bobs: vertices at the bottom of the cell keep still (no gaps against the ground)
      const q = buf.quads - 1;
      for (let k = 0; k < 4; k++) if (buf.pos[q * 12 + k * 3 + 1] === y) buf.tex[q * 16 + k * 4 + 3] &= ~(3 << 5);
    }
  }
}

/* ------------------------------------------------------------------ section mesher */

/**
 * Mesh one section from padded input.
 * @param {Uint16Array} blocks padded (18^3) @param {Uint8Array} light padded (18^3)
 * @param {{fancyLeaves?: boolean, smoothLighting?: boolean, waving?: boolean, origin?: number[]}} [opts]
 *        origin (optional, CORE-C addition): world position of the section's (0,0,0) cell - plant jitter hash
 * @returns {import('../core/types.js').SectionMesh | null}  null when nothing is visible
 */
export function meshSection(blocks, light, opts = {}) {
  run(blocks, light, opts, true);
  const res = { opaque: BUFS[0].finish(), cutout: BUFS[1].finish(), translucent: BUFS[2].finish() };
  return res.opaque || res.cutout || res.translucent ? res : null;
}

function run(blocks, light, opts, jitter) {
  SMOOTH = opts.smoothLighting !== false;
  FANCY = opts.fancyLeaves !== false;
  const o = opts.origin;
  OX = o ? o[0] | 0 : 0; OY = o ? o[1] | 0 : 0; OZ = o ? o[2] | 0 : 0;
  JITTER = jitter;
  BLK = blocks;
  BUFS[0].quads = 0; BUFS[1].quads = 0; BUFS[2].quads = 0;
  // effective light: filter-15 non-opaque cells (slabs, stairs) take the max of their neighbours
  EL.set(light);
  for (let i = 0; i < PADDED_VOLUME; i++) {
    if (!T_ROOF[blocks[i] & 0xff]) continue;
    let s = light[i] >> 4, b = light[i] & 15;
    for (let f = 0; f < 6; f++) {
      const j = i + FD[f];
      if (j < 0 || j >= PADDED_VOLUME) continue;
      const l = light[j];
      if ((l >> 4) > s) s = l >> 4;
      if ((l & 15) > b) b = l & 15;
    }
    EL[i] = (s << 4) | b;
  }
  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      let p = padIndex(0, y, z);
      for (let x = 0; x < 16; x++, p++) {
        const v = blocks[p];
        const id = v & 0xff;
        if (id === 0) continue;
        const pass = B_PASS[id];
        if (pass === PASS.NONE) continue;
        meshCell(p, x, y, z, id, v >> 8, BUFS[pass]);
      }
    }
  }
  BLK = null;
}

function meshCell(p, x, y, z, id, state, buf) {
  switch (B_SHAPE[id]) {
    case SHAPE.CUBE: cube(p, x, y, z, id, state, buf); break;
    case SHAPE.LIQUID: liquid(p, x, y, z, id, state, buf); break;
    case SHAPE.CROSS: cross(p, x, y, z, id, state, buf); break;
    case SHAPE.CROP: crop(p, x, y, z, id, state, buf); break;
    case SHAPE.TORCH: torch(p, x, y, z, id, state, buf); break;
    case SHAPE.FIRE: fire(p, x, y, z, id, state, buf); break;
    case SHAPE.LADDER: ladder(p, x, y, z, id, state, buf); break;
    case SHAPE.CACTUS: cactus(p, x, y, z, id, state, buf); break;
    case SHAPE.FENCE: fence(p, x, y, z, id, state, buf); break;
    case SHAPE.GATE: gate(p, x, y, z, id, state, buf); break;
    case SHAPE.POT: pot(p, x, y, z, id, state, buf); break;
    case SHAPE.BED: {
      const b = getSelectionBoxes(id, state)[0];
      box(p, x, y, z, id, state, buf, b[0], b[1], b[2], b[3], b[4], b[5], 0, state & 3);
      break;
    }
    case SHAPE.NONE: break;
    default: boxes(p, x, y, z, id, state, buf, getSelectionBoxes(id, state)); break; // slab stairs door layer carpet farmland chest cake pane trapdoor lantern sign portal
  }
}

/**
 * Mesh a single block in isolation (all faces visible, full sky light, no AO) for dropped items, held
 * blocks, falling sand, primed TNT, inventory previews. Geometry: x,z in [-0.5, 0.5], y in [0, 1]
 * (non-cube shapes keep their real proportions inside that cell). All passes merged into one buffer.
 * @returns {import('../core/types.js').MeshBuffers}
 */
const MB_BLOCKS = new Uint16Array(PADDED_VOLUME);
const MB_LIGHT = new Uint8Array(PADDED_VOLUME).fill(0xf0);
export function meshBlockModel(id, state = 0) {
  const c = padIndex(0, 0, 0);
  MB_BLOCKS[c] = (id & 0xff) | ((state & 0xff) << 8);
  const parts = [];
  if ((id & 0xff) !== 0 && B_PASS[id & 0xff] !== PASS.NONE) {
    SMOOTH = false; FANCY = true; JITTER = false; OX = OY = OZ = 0;
    BLK = MB_BLOCKS;
    EL.set(MB_LIGHT);
    BUFS[0].quads = 0; BUFS[1].quads = 0; BUFS[2].quads = 0;
    meshCell(c, 0, 0, 0, id & 0xff, (state & 0xff), BUFS[B_PASS[id & 0xff]]);
    BLK = null;
    for (const b of BUFS) { const m = b.finish(); if (m) parts.push(m); }
  }
  MB_BLOCKS[c] = 0;
  const quads = parts.reduce((a, m) => a + m.quads, 0);
  const out = { position: new Float32Array(quads * 12), tex: new Uint16Array(quads * 16), light: new Uint8Array(quads * 16), corner: new Uint16Array(quads * 16), quads };
  let q = 0;
  for (const m of parts) { out.position.set(m.position, q * 12); out.tex.set(m.tex, q * 16); out.light.set(m.light, q * 16); out.corner.set(m.corner, q * 16); q += m.quads; }
  for (let i = 0; i < out.position.length; i += 3) { out.position[i] -= 0.5; out.position[i + 2] -= 0.5; }
  return out;
}

/* ------------------------------------------------------------------ padded input (main thread) */

const NB = new Array(9).fill(null);
/**
 * Copy one section plus a 1-block border (from neighbouring sections/columns) into padded arrays.
 * Cells outside the world (y < 0 or y >= 128) read as air with sky light 15 above / 0 below; cells in
 * unloaded columns read as air with light 0xF0.
 * @param {object} world   World system (getColumn)
 * @param {number} cx @param {number} sy section index 0..7 @param {number} cz
 * @param {Uint16Array} outBlocks length PADDED_VOLUME
 * @param {Uint8Array} outLight  length PADDED_VOLUME
 * @returns {boolean} true if the section itself contains any non-air block (false => skip meshing)
 */
export function buildPadded(world, cx, sy, cz, outBlocks, outLight) {
  for (let gz = -1; gz <= 1; gz++) for (let gx = -1; gx <= 1; gx++) NB[(gx + 1) + (gz + 1) * 3] = world.getColumn(cx + gx, cz + gz);
  const center = NB[4];
  if (center && !(center.nonEmptyMask & (1 << sy))) { NB.fill(null); return false; }
  let any = false;
  const y0 = sy * SECTION_SIZE;
  for (let dz = -1; dz <= 16; dz++) {
    const gz = dz < 0 ? 0 : dz > 15 ? 2 : 1, lz = dz & 15;
    for (let dx = -1; dx <= 16; dx++) {
      const gx = dx < 0 ? 0 : dx > 15 ? 2 : 1, lx = dx & 15;
      const col = NB[gx + gz * 3];
      const core = gx === 1 && gz === 1;
      let p = (dx + 1) + (dz + 1) * PADDED;
      for (let dy = -1; dy <= 16; dy++, p += PADDED * PADDED) {
        const wy = y0 + dy;
        if (!col || wy < 0 || wy >= WORLD_HEIGHT) {
          outBlocks[p] = 0;
          outLight[p] = wy >= WORLD_HEIGHT || !col ? 0xf0 : 0;
          continue;
        }
        const i = colIndex(lx, wy, lz);
        const v = col.blocks[i];
        outBlocks[p] = v;
        outLight[p] = col.light[i];
        if (v !== 0 && core && dy >= 0 && dy < 16) any = true;
      }
    }
  }
  NB.fill(null);
  return any;
}

