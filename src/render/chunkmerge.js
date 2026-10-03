// OWNER LANE: CORE-D. Pure helpers (no three.js) for the chunk geometry: shared quad index buffers and the
// column merge (one geometry per column per pass, SPEC §5.5.6 "column-merged geometry"). Unit-tested.
//
// MeshBuffers (SPEC §5.3.5): {position: Float32Array(quads*12), tex: Uint16Array(quads*16),
// light: Uint8Array(quads*16), quads}. Positions are section-local (0..16).

/** Quads addressable by the shared 16-bit index buffer (4 vertices each => 65536 vertices). */
export const U16_QUADS = 16384;

let u16 = null;
let u32 = null;

function fillQuads(arr, from, to) {
  for (let q = from; q < to; q++) {
    const i = q * 6, v = q * 4;
    arr[i] = v; arr[i + 1] = v + 1; arr[i + 2] = v + 2;
    arr[i + 3] = v; arr[i + 4] = v + 2; arr[i + 5] = v + 3;
  }
}

/**
 * Index array for `quads` quads (QUAD_INDICES [0,1,2, 0,2,3] offset by 4 per quad): a VIEW of one shared,
 * precomputed array - Uint16 up to 16384 quads, else a shared Uint32 array grown by doubling. Views of an
 * older (smaller) Uint32 array stay valid after a grow.
 * @param {number} quads
 * @returns {Uint16Array|Uint32Array}
 */
export function quadIndices(quads) {
  if (quads <= U16_QUADS) {
    if (!u16) { u16 = new Uint16Array(U16_QUADS * 6); fillQuads(u16, 0, U16_QUADS); }
    return u16.subarray(0, quads * 6);
  }
  if (!u32 || u32.length < quads * 6) {
    let cap = u32 ? u32.length / 6 : U16_QUADS * 2;
    while (cap < quads) cap *= 2;
    const next = new Uint32Array(cap * 6);
    fillQuads(next, 0, cap);
    u32 = next;
  }
  return u32.subarray(0, quads * 6);
}

/**
 * Merge the 8 sections of one column pass into one set of arrays (positions offset to column-local y).
 * @param {{position:Float32Array, tex:Uint16Array, light:Uint8Array, ranges:Int32Array}|null} old previous merge
 * @param {Array<undefined|null|{position:Float32Array, tex:Uint16Array, light:Uint8Array, quads:number}>} sources
 *        per section sy (0..7): undefined = keep that section's quads from `old`; null = empty;
 *        MeshBuffers = new section-local data.
 * @returns {{position:Float32Array, tex:Uint16Array, light:Uint8Array, quads:number, ranges:Int32Array,
 *            minSy:number, maxSy:number}|null} ranges[sy*2] = first quad, ranges[sy*2+1] = quad count
 */
export function mergeColumnPass(old, sources) {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (let sy = 0; sy < 8; sy++) {
    const src = sources[sy];
    const n = src === undefined ? (old ? old.ranges[sy * 2 + 1] : 0) : src ? src.quads : 0;
    counts[sy] = n;
    total += n;
  }
  if (total === 0) return null;
  const position = new Float32Array(total * 12);
  const tex = new Uint16Array(total * 16);
  const light = new Uint8Array(total * 16);
  const ranges = new Int32Array(16);
  let q = 0, minSy = 8, maxSy = -1;
  for (let sy = 0; sy < 8; sy++) {
    const n = counts[sy];
    ranges[sy * 2] = q;
    ranges[sy * 2 + 1] = n;
    if (n === 0) continue;
    if (sy < minSy) minSy = sy;
    maxSy = sy;
    const src = sources[sy];
    if (src === undefined) {
      const os = old.ranges[sy * 2];
      position.set(old.position.subarray(os * 12, (os + n) * 12), q * 12);
      tex.set(old.tex.subarray(os * 16, (os + n) * 16), q * 16);
      light.set(old.light.subarray(os * 16, (os + n) * 16), q * 16);
    } else {
      position.set(src.position.subarray(0, n * 12), q * 12);
      const yo = sy * 16;
      if (yo) for (let i = q * 12 + 1, e = (q + n) * 12; i < e; i += 3) position[i] += yo;
      tex.set(src.tex.subarray(0, n * 16), q * 16);
      light.set(src.light.subarray(0, n * 16), q * 16);
    }
    q += n;
  }
  return { position, tex, light, quads: total, ranges, minSy, maxSy };
}

/**
 * Collapse one section's quads inside a merged column to degenerate triangles (all positions 0) so it stops
 * drawing without a rebuild. Returns [firstFloat, floatCount] for a partial GPU upload, or null.
 */
export function degenerateSection(merged, sy) {
  if (!merged) return null;
  const s = merged.ranges[sy * 2], n = merged.ranges[sy * 2 + 1];
  if (n === 0) return null;
  merged.position.fill(0, s * 12, (s + n) * 12);
  merged.ranges[sy * 2 + 1] = 0; // that slot no longer holds live quads (a later merge must not copy it)
  return [s * 12, n * 12];
}

/**
 * Quad centres (x, y, z per quad) of a MeshBuffers position array, offset by (ox, oy, oz) - world space.
 * @returns {Float32Array} quads*3
 */
export function quadCenters(position, quads, ox = 0, oy = 0, oz = 0) {
  const c = new Float32Array(quads * 3);
  for (let q = 0; q < quads; q++) {
    const p = q * 12;
    c[q * 3] = (position[p] + position[p + 3] + position[p + 6] + position[p + 9]) * 0.25 + ox;
    c[q * 3 + 1] = (position[p + 1] + position[p + 4] + position[p + 7] + position[p + 10]) * 0.25 + oy;
    c[q * 3 + 2] = (position[p + 2] + position[p + 5] + position[p + 8] + position[p + 11]) * 0.25 + oz;
  }
  return c;
}

let sortDist = new Float32Array(1024);
let sortOrder = new Uint32Array(1024);

/**
 * Rewrite a translucent pass's index array so its quads draw back to front as seen from (ex, ey, ez)
 * (water surfaces, ice and stained glass blend in the right order inside one section).
 * @param {Float32Array} centers quadCenters() output @param {number} quads
 * @param {Uint16Array|Uint32Array} index quads*6, rewritten in place
 */
export function sortQuadsBackToFront(centers, quads, ex, ey, ez, index) {
  if (sortDist.length < quads) { sortDist = new Float32Array(quads * 2); sortOrder = new Uint32Array(quads * 2); }
  const dist = sortDist;
  const order = sortOrder.subarray(0, quads);
  for (let q = 0; q < quads; q++) {
    const dx = centers[q * 3] - ex, dy = centers[q * 3 + 1] - ey, dz = centers[q * 3 + 2] - ez;
    dist[q] = dx * dx + dy * dy + dz * dz;
    order[q] = q;
  }
  order.sort((a, b) => dist[b] - dist[a]);
  for (let k = 0; k < quads; k++) {
    const v = order[k] * 4, i = k * 6;
    index[i] = v; index[i + 1] = v + 1; index[i + 2] = v + 2;
    index[i + 3] = v; index[i + 4] = v + 2; index[i + 5] = v + 3;
  }
  return index;
}
