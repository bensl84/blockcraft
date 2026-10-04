// OWNER LANE: CORE-A. Pure (no DOM) item icon atlas painter, SPEC §4.5 and §5.1 item 9.
//   iso:<block>   isometric block drawn at 32 px: top x1.0, left (south) x0.8, right (east) x0.6, with
//                 proportional slab, stairs, carpet, snow layer, chest, cake, cactus, fence and gate models
//   tex:<key>     a flat block texture drawn at 2x
//   sprite:<name> an original 16x16 sprite (sprites.js) drawn at 2x; dye/bed use `tint`, eggs use `colors`
// textures.js wraps the result in a canvas + data URL. Node tests use this directly.

import { ITEM_LIST } from '../data/items.js';
import { BLOCK_BY_NAME } from '../data/blocks.js';
import { faceTexKey, B_PASS, PASS } from '../core/registry.js';
import { FACE } from '../core/constants.js';
import { PixelCanvas } from './toolkit.js';
import { paintSprite } from './sprites.js';

export const ICON_COLS = 16;
const CELL = 32;

/** Projection of block-local (x, y, z) (each 0..1) to icon pixels. Viewer looks from south-east, above. */
const PX = (x, y, z) => [16 + 15 * (x - z), 1 + 7.5 * (x + z) + 15 * (1 - y)];

/**
 * Draw one face of a box. axis: 'top' | 'south' | 'east' | 'bottom' | 'north' | 'west'.
 * Texture coordinates follow the mesher convention (u = block x, v = 1 - y on sides; top u = x, v = z).
 */
function drawFace(out, ox, oy, box, axis, tex, k, alphaMode) {
  const [x0, y0, z0, x1, y1, z1] = box;
  let O, U, V, uv;
  switch (axis) {
    case 'top': O = [x0, y1, z0]; U = [x1 - x0, 0, 0]; V = [0, 0, z1 - z0]; uv = (a, b) => [x0 + a * (x1 - x0), z0 + b * (z1 - z0)]; break;
    case 'south': O = [x0, y1, z1]; U = [x1 - x0, 0, 0]; V = [0, -(y1 - y0), 0]; uv = (a, b) => [x0 + a * (x1 - x0), 1 - (y1 - b * (y1 - y0))]; break;
    case 'east': O = [x1, y1, z1]; U = [0, 0, -(z1 - z0)]; V = [0, -(y1 - y0), 0]; uv = (a, b) => [1 - (z1 - a * (z1 - z0)), 1 - (y1 - b * (y1 - y0))]; break;
    case 'north': O = [x0, y1, z0]; U = [x1 - x0, 0, 0]; V = [0, -(y1 - y0), 0]; uv = (a, b) => [1 - (x0 + a * (x1 - x0)), 1 - (y1 - b * (y1 - y0))]; break;
    case 'west': O = [x0, y1, z1]; U = [0, 0, -(z1 - z0)]; V = [0, -(y1 - y0), 0]; uv = (a, b) => [z1 - a * (z1 - z0), 1 - (y1 - b * (y1 - y0))]; break;
    default: O = [x0, y0, z0]; U = [x1 - x0, 0, 0]; V = [0, 0, z1 - z0]; uv = (a, b) => [x0 + a * (x1 - x0), 1 - (z0 + b * (z1 - z0))];
  }
  const p0 = PX(O[0], O[1], O[2]);
  const pu = PX(O[0] + U[0], O[1] + U[1], O[2] + U[2]);
  const pv = PX(O[0] + V[0], O[1] + V[1], O[2] + V[2]);
  const ux = pu[0] - p0[0], uy = pu[1] - p0[1], vx = pv[0] - p0[0], vy = pv[1] - p0[1];
  const det = ux * vy - uy * vx;
  if (Math.abs(det) < 1e-6) return;
  const minX = Math.max(0, Math.floor(Math.min(p0[0], pu[0], pv[0], pu[0] + vx))), maxX = Math.min(CELL - 1, Math.ceil(Math.max(p0[0], pu[0], pv[0], pu[0] + vx)));
  const minY = Math.max(0, Math.floor(Math.min(p0[1], pu[1], pv[1], pu[1] + vy))), maxY = Math.min(CELL - 1, Math.ceil(Math.max(p0[1], pu[1], pv[1], pu[1] + vy)));
  const W = out.w;
  for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
    const dx = px + 0.5 - p0[0], dy = py + 0.5 - p0[1];
    const a = (dx * vy - dy * vx) / det, b = (ux * dy - uy * dx) / det;
    if (a < -1e-4 || b < -1e-4 || a > 1.0001 || b > 1.0001) continue;
    const [u, v] = uv(Math.min(0.9999, Math.max(0, a)), Math.min(0.9999, Math.max(0, b)));
    const tx = Math.min(15, Math.max(0, Math.floor(u * 16))), ty = Math.min(15, Math.max(0, Math.floor(v * 16)));
    const si = (ty * 16 + tx) * 4;
    const sa = tex[si + 3];
    if (sa === 0) continue;
    const di = ((oy + py) * W + ox + px) * 4;
    const r = tex[si] * k, g = tex[si + 1] * k, bl = tex[si + 2] * k;
    if (alphaMode === 'opaque' || sa === 255) {
      out.data[di] = r; out.data[di + 1] = g; out.data[di + 2] = bl; out.data[di + 3] = 255;
    } else { // straight-alpha "over"
      const da = out.data[di + 3] / 255, s = sa / 255, oa = s + da * (1 - s);
      out.data[di] = (r * s + out.data[di] * da * (1 - s)) / oa;
      out.data[di + 1] = (g * s + out.data[di + 1] * da * (1 - s)) / oa;
      out.data[di + 2] = (bl * s + out.data[di + 2] * da * (1 - s)) / oa;
      out.data[di + 3] = oa * 255;
    }
  }
}

const P16 = 1 / 16;
/** Box list (block-local units) for the iso model of a block shape. */
function isoBoxes(def) {
  switch (def.shape) {
    case 'slab': return [[0, 0, 0, 1, 0.5, 1]];
    case 'stairs': return [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 0.5]];
    case 'carpet': return [[0, 0, 0, 1, P16, 1]];
    case 'layer': return [[0, 0, 0, 1, 2 * P16, 1]];
    case 'trapdoor': return [[0, 0, 0, 1, 3 * P16, 1]];
    case 'farmland': return [[0, 0, 0, 1, 15 * P16, 1]];
    case 'chest': return [[P16, 0, P16, 15 * P16, 14 * P16, 15 * P16]];
    case 'cake': return [[P16, 0, P16, 15 * P16, 0.5, 15 * P16]];
    case 'cactus': return [[P16, 0, P16, 15 * P16, 1, 15 * P16]];
    case 'fence': return [
      [0, 0, 6 * P16, 4 * P16, 1, 10 * P16], [12 * P16, 0, 6 * P16, 1, 1, 10 * P16],
      [4 * P16, 12 * P16, 7 * P16, 12 * P16, 15 * P16, 9 * P16], [4 * P16, 5 * P16, 7 * P16, 12 * P16, 8 * P16, 9 * P16]];
    case 'gate': return [
      [0, 3 * P16, 7 * P16, 2 * P16, 1, 9 * P16], [14 * P16, 3 * P16, 7 * P16, 1, 1, 9 * P16],
      [2 * P16, 12 * P16, 7 * P16, 14 * P16, 15 * P16, 9 * P16], [2 * P16, 5 * P16, 7 * P16, 14 * P16, 8 * P16, 9 * P16],
      [6 * P16, 8 * P16, 7 * P16, 8 * P16, 12 * P16, 9 * P16], [8 * P16, 8 * P16, 7 * P16, 10 * P16, 12 * P16, 9 * P16]];
    default: return [[0, 0, 0, 1, 1, 1]];
  }
}

/** Paint an iso block icon into `out` at (ox, oy). */
function paintIso(out, ox, oy, def, texPixels) {
  const id = def.id;
  // fronts face the viewer's left (south): facing S = 2; logs/hay upright (axis 0)
  const state = def.facing ? 2 : 0;
  const key = (face) => faceTexKey(id, state, face);
  const transparent = B_PASS[id] === PASS.TRANSLUCENT || (B_PASS[id] === PASS.CUTOUT && def.name.indexOf('leaves') < 0);
  const leaves = def.name.endsWith('_leaves');
  const tex = (face) => {
    const t = texPixels(key(face));
    if (!leaves) return t;
    // leaves: fill holes with a deep shade so the icon reads as a solid bush
    const c = new Uint8ClampedArray(t);
    for (let i = 0; i < c.length; i += 4) if (c[i + 3] < 128) { c[i] *= 0.55; c[i + 1] *= 0.55; c[i + 2] *= 0.55; c[i + 3] = 255; }
    return c;
  };
  const boxes = isoBoxes(def);
  // painter's order: back boxes first (smaller x+z, lower y)
  boxes.sort((a, b) => (a[0] + a[2] + a[1]) - (b[0] + b[2] + b[1]));
  const mode = transparent ? 'blend' : 'opaque';
  // a 1-px contour shadow behind solid icons is drawn by outlining later
  for (const b of boxes) {
    if (transparent) {
      drawFace(out, ox, oy, b, 'bottom', tex(FACE.DOWN), 0.5, mode);
      drawFace(out, ox, oy, b, 'north', tex(FACE.NORTH), 0.55, mode);
      drawFace(out, ox, oy, b, 'west', tex(FACE.WEST), 0.5, mode);
    }
    drawFace(out, ox, oy, b, 'south', tex(FACE.SOUTH), 0.8, mode);
    drawFace(out, ox, oy, b, 'east', tex(FACE.EAST), 0.6, mode);
    drawFace(out, ox, oy, b, 'top', tex(FACE.UP), 1.0, mode);
  }
}

/** Blit a 16x16 RGBA buffer at 2x into the atlas. */
function blit2x(out, ox, oy, src) {
  const W = out.w;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const si = (y * 16 + x) * 4;
    if (!src[si + 3]) continue;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const di = ((oy + y * 2 + dy) * W + ox + x * 2 + dx) * 4;
      out.data[di] = src[si]; out.data[di + 1] = src[si + 1]; out.data[di + 2] = src[si + 2]; out.data[di + 3] = src[si + 3];
    }
  }
}

/**
 * Paint every item icon. Returns {data: Uint8ClampedArray RGBA, width, height, cols, rows, index: Map<key, cell>,
 * sprite16: Map<key, Uint8ClampedArray(1024)>} (sprite16 = the 16x16 source used for 3D item extrusion).
 * @param {{size:number, layer:(k:string)=>number, data:Uint8Array}} textureSet
 */
export function paintIconAtlas(textureSet) {
  const cols = ICON_COLS;
  const rows = Math.ceil(ITEM_LIST.length / cols);
  const out = new PixelCanvas(cols * CELL, rows * CELL);
  const index = new Map();
  const sprite16 = new Map();
  const texCache = new Map();
  const texPixels = (k) => {
    let v = texCache.get(k);
    if (!v) {
      const L = textureSet.layer(k);
      v = textureSet.data.subarray(L * 1024, L * 1024 + 1024);
      texCache.set(k, v);
    }
    return v;
  };
  const spriteCache = new Map();
  ITEM_LIST.forEach((it, i) => {
    index.set(it.key, i);
    const ox = (i % cols) * CELL, oy = Math.floor(i / cols) * CELL;
    const [kind, name] = [it.icon.slice(0, it.icon.indexOf(':')), it.icon.slice(it.icon.indexOf(':') + 1)];
    if (kind === 'iso') {
      const def = BLOCK_BY_NAME.get(name);
      paintIso(out, ox, oy, def, texPixels);
      sprite16.set(it.key, new Uint8ClampedArray(texPixels(faceTexKey(def.id, def.facing ? 2 : 0, FACE.SOUTH))));
    } else if (kind === 'tex') {
      const src = texPixels(name);
      blit2x(out, ox, oy, src);
      sprite16.set(it.key, new Uint8ClampedArray(src));
    } else {
      const ck = name + '|' + (it.tint || '') + '|' + (it.colors ? it.colors.join(',') : '');
      let pc = spriteCache.get(ck);
      if (!pc) { pc = paintSprite(name, it, texPixels); spriteCache.set(ck, pc); }
      blit2x(out, ox, oy, pc.data);
      sprite16.set(it.key, pc.data);
    }
  });
  return { data: out.data, width: out.w, height: out.h, cols, rows, index, sprite16 };
}
