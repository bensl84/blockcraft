// OWNER LANE: CORE-A (textures). STUB written by LEAD - replace the bodies, keep the exported signatures.
// Spec: docs/SPEC.md §5.1. Everything here must be ORIGINAL procedural pixel art (no Mojang assets).
//
// buildTextures() is PURE (no DOM): it runs in Node unit tests and could run in a worker.
// buildItemIcons() needs a DOM canvas (browser only).
//
// Stub behaviour: every required key gets a flat colour tile (block colour or name hash) with light noise,
// animated keys get their frame count, crack_N get dark speckles. Icons are flat coloured squares.

import { registerStub } from '../core/stubs.js';
import { REQUIRED_TEXTURE_KEYS, ANIMATED_TEXTURES, blockDef } from '../core/registry.js';
import { ANIM } from '../core/constants.js';
import { BLOCKS } from '../data/blocks.js';
import { ITEM_LIST, getItem } from '../data/items.js';
import { hashString, hexToRgb, mulberry32 } from '../core/math.js';

registerStub('textures');
registerStub('icons');

export const TEX_SIZE = 16;
export const ICON_SIZE = 32;   // icon atlas cell size in pixels (16px sprites are drawn 2x; iso blocks drawn at 32)

/**
 * Build every block texture as layers of one RGBA8 array.
 * Layer order: REQUIRED_TEXTURE_KEYS sorted, animated keys expanded into ANIM.FRAMES[mode] consecutive layers.
 * @param {{fastLeaves?: boolean, halfAnim?: boolean}} [opts] halfAnim: water/lava with 8 frames for GPUs whose
 *        MAX_ARRAY_TEXTURE_LAYERS is below the normal count (SPEC §5.1); the `animated` map reports the real frames.
 * @returns {import('../core/types.js').TextureSet & {animated: Map<string,{mode:number, frames:number, fps:number}>}}
 */
export function buildTextures(opts = {}) {
  const S = TEX_SIZE;
  const keys = REQUIRED_TEXTURE_KEYS;
  const index = new Map();
  const animated = new Map();
  let count = 0;
  for (const k of keys) {
    index.set(k, count);
    const mode = ANIMATED_TEXTURES[k] || 0;
    const frames = mode ? ANIM.FRAMES[mode] : 1;
    if (mode) animated.set(k, { mode, frames, fps: ANIM.FPS[mode] });
    count += frames;
  }
  const data = new Uint8Array(S * S * 4 * count);
  const colorFor = (key) => {
    const b = BLOCKS.find((d) => d && (d.tex === key || (d.tex && typeof d.tex === 'object' && Object.values(d.tex).includes(key)) || (d.texKeys && d.texKeys.includes(key))));
    if (b && b.color) return hexToRgb(b.color);
    const h = hashString(key);
    return [64 + (h & 127), 64 + ((h >> 8) & 127), 64 + ((h >> 16) & 127)];
  };
  for (const k of keys) {
    const base = index.get(k);
    const frames = animated.has(k) ? animated.get(k).frames : 1;
    const rgb = k === 'missing' ? [255, 0, 255] : colorFor(k);
    const crack = k.startsWith('crack_');
    const cutout = /leaves|glass|sapling|torch|ladder|door|grass$|fern|bush|dandelion|poppy|cornflower|orchid|allium|lily|tulip|cane|wheat|carrots|potatoes|mushroom|fire/.test(k) && !k.startsWith('grass_');
    for (let f = 0; f < frames; f++) {
      const rnd = mulberry32(hashString(k) + f);
      const off = (base + f) * S * S * 4;
      for (let i = 0; i < S * S; i++) {
        const x = i % S, y = (i / S) | 0;
        const n = 0.88 + rnd() * 0.24;
        let a = 255;
        if (crack) a = rnd() < 0.08 * (Number(k.slice(6)) + 1) ? 150 : 0;
        else if (cutout && (x === 0 || y === 0 || x === S - 1 || y === S - 1 || rnd() < 0.15)) a = 0;
        const o = off + i * 4;
        data[o] = crack ? 0 : Math.min(255, rgb[0] * n);
        data[o + 1] = crack ? 0 : Math.min(255, rgb[1] * n);
        data[o + 2] = crack ? 0 : Math.min(255, rgb[2] * n);
        data[o + 3] = k.includes('stained_glass') || k === 'water' || k === 'ice' ? 170 : a;
      }
    }
  }
  return {
    size: S,
    count,
    data,
    index,
    animated,
    layer(key) { const v = index.get(key); return v === undefined ? index.get('missing') : v; },
  };
}

/**
 * RGBA pixels (TEX_SIZE*TEX_SIZE*4, a subarray view - do not mutate) of one texture frame.
 * @param {ReturnType<typeof buildTextures>} textureSet @param {string} key @param {number} [frame]
 */
export function getTexturePixels(textureSet, key, frame = 0) {
  const S = textureSet.size;
  const layer = textureSet.layer(key) + frame;
  return textureSet.data.subarray(layer * S * S * 4, (layer + 1) * S * S * 4);
}

/**
 * Build the item icon atlas (DOM). Every item in ITEM_LIST gets a cell.
 * @param {ReturnType<typeof buildTextures>} textureSet
 * @returns {ItemIconSet}
 *
 * @typedef {Object} ItemIconSet
 * @property {number} size                     cell size in px (ICON_SIZE)
 * @property {HTMLCanvasElement} canvas        the atlas
 * @property {number} cols @property {number} rows
 * @property {string} url                      atlas as a data: URL (for CSS backgrounds)
 * @property {Map<string, number>} index       item key -> cell index
 * @property {(key: string) => {x:number,y:number,w:number,h:number}} rect   pixel rect in the atlas
 * @property {(key: string, px: number) => HTMLElement} element  a <span class="bc-icon"> showing the icon at px size
 * @property {(key: string, px: number) => object} style         CSS props {backgroundImage, backgroundPosition, backgroundSize, width, height}
 * @property {(key: string) => Uint8ClampedArray} pixels16       16x16 RGBA sprite (flat items; iso blocks give their front-ish view) for 3D extrusion
 */
export function buildItemIcons(textureSet) {
  const size = ICON_SIZE;
  const cols = 16;
  const rows = Math.ceil(ITEM_LIST.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * size;
  canvas.height = rows * size;
  const ctx = canvas.getContext('2d');
  const index = new Map();
  ITEM_LIST.forEach((it, i) => {
    index.set(it.key, i);
    const x = (i % cols) * size, y = Math.floor(i / cols) * size;
    let color = it.tint || (it.colors && it.colors[0]) || null;
    if (!color && it.block) { const b = blockDef(BLOCKS.findIndex((d) => d && d.name === it.block)); color = b && b.color; }
    if (!color) { const h = hashString(it.key); color = `rgb(${80 + (h & 127)},${80 + ((h >> 8) & 127)},${80 + ((h >> 16) & 127)})`; }
    ctx.fillStyle = '#202020';
    ctx.fillRect(x + 4, y + 4, size - 8, size - 8);
    ctx.fillStyle = color;
    ctx.fillRect(x + 6, y + 6, size - 12, size - 12);
  });
  const url = canvas.toDataURL('image/png');
  const rect = (key) => {
    const i = index.has(key) ? index.get(key) : 0;
    return { x: (i % cols) * size, y: Math.floor(i / cols) * size, w: size, h: size };
  };
  const style = (key, px) => {
    const r = rect(key), k = px / size;
    return {
      backgroundImage: `url(${url})`,
      backgroundPosition: `${-r.x * k}px ${-r.y * k}px`,
      backgroundSize: `${canvas.width * k}px ${canvas.height * k}px`,
      width: px + 'px', height: px + 'px',
    };
  };
  return {
    size, canvas, cols, rows, url, index, rect, style,
    element(key, px) {
      const e = document.createElement('span');
      e.className = 'bc-icon';
      Object.assign(e.style, style(key, px));
      e.dataset.item = key;
      return e;
    },
    pixels16(key) {
      const r = rect(key);
      const tmp = document.createElement('canvas');
      tmp.width = 16; tmp.height = 16;
      const c = tmp.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, 16, 16);
      return c.getImageData(0, 0, 16, 16).data;
    },
    has(key) { return !!getItem(key) && index.has(key); },
  };
}
