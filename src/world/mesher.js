// OWNER LANE: CORE-C (world data/lighting/mesher). STUB written by LEAD - replace bodies, keep signatures and
// the OUTPUT FORMAT (consumed by CORE-D's renderer). Spec: docs/SPEC.md §5.4.
//
// Must be PURE over typed arrays (no three.js, no DOM, no world access inside meshSection) so it can move into
// a worker. Real implementation: culled faces + per-vertex AO (0fps) + smooth light + quad flip, all shapes.
//
// Stub behaviour: full cubes only, face culling, no AO (ao=3), light taken from the neighbour cell.

import { registerStub } from '../core/stubs.js';
import { B_ANIM, B_OPAQUE, B_PASS, B_SHAPE, B_WAVE, PASS, SHAPE, faceLayer } from '../core/registry.js';
import { FACE_DIRS, FACE_SHADE, PADDED, SECTION_SIZE, WORLD_HEIGHT, colIndex, padIndex } from '../core/constants.js';

registerStub('mesher');

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
  let any = false;
  const y0 = sy * SECTION_SIZE;
  for (let dz = -1; dz <= 16; dz++) {
    for (let dx = -1; dx <= 16; dx++) {
      const wx = cx * 16 + dx, wz = cz * 16 + dz;
      const col = world.getColumn(wx >> 4, wz >> 4);
      for (let dy = -1; dy <= 16; dy++) {
        const wy = y0 + dy;
        const p = padIndex(dx, dy, dz);
        if (!col || wy < 0 || wy >= WORLD_HEIGHT) {
          outBlocks[p] = 0;
          outLight[p] = wy >= WORLD_HEIGHT || !col ? 0xf0 : 0;
          continue;
        }
        const i = colIndex(wx & 15, wy, wz & 15);
        const v = col.blocks[i];
        outBlocks[p] = v;
        outLight[p] = col.light[i];
        if (v !== 0 && dx >= 0 && dx < 16 && dy >= 0 && dy < 16 && dz >= 0 && dz < 16) any = true;
      }
    }
  }
  return any;
}

/**
 * Mesh one section from padded input.
 * @param {Uint16Array} blocks padded (18^3) @param {Uint8Array} light padded (18^3)
 * @param {{fancyLeaves?: boolean, smoothLighting?: boolean, waving?: boolean}} [opts]
 * @returns {import('../core/types.js').SectionMesh | null}  null when nothing is visible
 */
export function meshSection(blocks, light, opts = {}) {
  const out = [newBuf(), newBuf(), newBuf()];
  for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const v = blocks[padIndex(x, y, z)];
    const id = v & 0xff;
    if (id === 0 || B_SHAPE[id] !== SHAPE.CUBE) continue;
    const pass = B_PASS[id];
    if (pass === PASS.NONE) continue;
    const state = v >> 8;
    for (let f = 0; f < 6; f++) {
      const d = FACE_DIRS[f];
      const n = blocks[padIndex(x + d[0], y + d[1], z + d[2])];
      const nid = n & 0xff;
      if (B_OPAQUE[nid]) continue;
      if (nid === id && !B_OPAQUE[id]) continue;
      const lv = light[padIndex(x + d[0], y + d[1], z + d[2])];
      pushQuad(out[pass], x, y, z, f, faceLayer(id, state, f), (B_ANIM[id] << 3) | (B_WAVE[id] << 5), (lv >> 4) * 16, (lv & 15) * 16, 3);
    }
  }
  const res = { opaque: finish(out[0]), cutout: finish(out[1]), translucent: finish(out[2]) };
  return res.opaque || res.cutout || res.translucent ? res : null;
}

/**
 * Mesh a single block in isolation (all faces visible, full sky light, no AO) for dropped items, held
 * blocks, falling sand, primed TNT, inventory previews. Geometry: x,z in [-0.5, 0.5], y in [0, 1]
 * (non-cube shapes keep their real proportions inside that cell).
 * @returns {import('../core/types.js').MeshBuffers}
 */
export function meshBlockModel(id, state = 0) {
  const b = newBuf();
  for (let f = 0; f < 6; f++) pushQuad(b, -0.5, 0, -0.5, f, faceLayer(id, state, f), (B_ANIM[id] << 3), 240, 0, 3);
  return finish(b) || { position: new Float32Array(0), tex: new Uint16Array(0), light: new Uint8Array(0), quads: 0 };
}

function newBuf() { return { pos: [], tex: [], light: [], quads: 0 }; }
function pushQuad(b, x, y, z, f, layer, flagsExtra, sky16, block16, ao) {
  const c = FACE_CORNERS[f];
  const shade = Math.round(FACE_SHADE[f] * 255);
  for (let k = 0; k < 4; k++) {
    b.pos.push(x + c[k][0], y + c[k][1], z + c[k][2]);
    b.tex.push(layer, CORNER_UV[k][0], CORNER_UV[k][1], f | flagsExtra);
    b.light.push(sky16, block16, ao, shade);
  }
  b.quads++;
}
function finish(b) {
  if (b.quads === 0) return null;
  return { position: new Float32Array(b.pos), tex: new Uint16Array(b.tex), light: new Uint8Array(b.light), quads: b.quads };
}
