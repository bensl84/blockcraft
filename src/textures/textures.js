// OWNER LANE: CORE-A (textures). docs/SPEC.md §5.1. Everything here is ORIGINAL procedural pixel art.
//
// buildTextures() is PURE (no DOM): it runs in Node unit tests and could run in a worker.
// buildItemIcons() needs a DOM canvas (browser only); the pixels themselves come from the pure
// paintIconAtlas() in icons.js, so Node tests can check every icon.

import { REQUIRED_TEXTURE_KEYS, ANIMATED_TEXTURES } from '../core/registry.js';
import { ANIM } from '../core/constants.js';
import { getItem } from '../data/items.js';
import { hashString, mulberry32 } from '../core/math.js';
import { PixelCanvas } from './toolkit.js';
import { TERRAIN } from './tex_terrain.js';
import { BUILDING } from './tex_building.js';
import { PLANTS } from './tex_plants.js';
import { ANIMATED, CUTOUT_KEYS, TRANSLUCENT_ALPHA } from './tex_anim.js';
import { PALETTE, PALETTE_CUTOUT, LAYER_FALLBACK } from './tex_palette.js';
import { paintIconAtlas, ICON_COLS } from './icons.js';

export const TEX_SIZE = 16;
export const ICON_SIZE = 32;   // icon atlas cell size in pixels (16px sprites are drawn 2x; iso blocks drawn at 32)

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Every static painter by texture key (animated keys live in ANIMATED). */
export const PAINTERS = Object.freeze({ ...TERRAIN, ...BUILDING, ...PLANTS, ...PALETTE });

/** Is this key a cutout texture (alpha 0/255 only)? Crack overlays are NOT: they keep alpha 150/70. */
export function isCutoutKey(key) { return CUTOUT_KEYS.has(key) || PALETTE_CUTOUT.has(key) || /^(wheat|carrots|potatoes)_\d$/.test(key); }

/**
 * Build every block texture as layers of one RGBA8 array.
 * Layer order: REQUIRED_TEXTURE_KEYS sorted, animated keys expanded into consecutive layers
 * (water 16 frames @ 8 fps, lava 16 @ 4 fps, fire 8 @ 12 fps; halfAnim: water and lava 8 frames at half fps,
 * so one loop lasts as long).
 * maxLayers (v1.7, SPEC D5): when the set would need more layers than the GPU holds (WebGL2 guarantees 256), keys in
 * LAYER_FALLBACK share their fallback's layer (concrete looks like wool, ...) until it fits. The renderer first tries
 * halfAnim, then this.
 * @param {{fastLeaves?: boolean, halfAnim?: boolean, maxLayers?: number}} [opts]
 * @returns {import('../core/types.js').TextureSet & {animated: Map<string,{mode:number, frames:number, fps:number}>, buildMs: number}}
 */
export function buildTextures(opts = {}) {
  const t0 = now();
  const S = TEX_SIZE;
  const keys = REQUIRED_TEXTURE_KEYS;
  const index = new Map();
  const animated = new Map();
  let count = 0;
  // layers saved by sharing a fallback's layer (only when maxLayers says the full set does not fit)
  const aliased = new Map();
  if (opts.maxLayers > 0) {
    let need = 0;
    for (const k of keys) { const m = ANIMATED_TEXTURES[k] || 0; need += m ? (opts.halfAnim && (m === ANIM.WATER || m === ANIM.LAVA) ? ANIM.FRAMES[m] >> 1 : ANIM.FRAMES[m]) : 1; }
    for (const [k, fb] of Object.entries(LAYER_FALLBACK)) {
      if (need <= opts.maxLayers) break;
      if (keys.includes(k) && keys.includes(fb) && !LAYER_FALLBACK[fb]) { aliased.set(k, fb); need--; }
    }
  }
  for (const k of keys) {
    if (aliased.has(k)) continue;
    index.set(k, count);
    const mode = ANIMATED_TEXTURES[k] || 0;
    let frames = mode ? ANIM.FRAMES[mode] : 1;
    let fps = mode ? ANIM.FPS[mode] : 0;
    if (mode && opts.halfAnim && (mode === ANIM.WATER || mode === ANIM.LAVA)) { frames >>= 1; fps /= 2; }
    if (mode) animated.set(k, { mode, frames, fps });
    count += frames;
  }
  const data = new Uint8Array(S * S * 4 * count);
  const stoneSeed = hashString('stone');
  const pc = new PixelCanvas(S, S);
  for (const [k, fb] of aliased) index.set(k, index.get(fb));
  for (const k of keys) {
    if (aliased.has(k)) continue;
    const base = index.get(k);
    const seed = hashString(k);
    const ctx = { key: k, seed, rng: mulberry32(seed), fastLeaves: !!opts.fastLeaves, stoneSeed };
    const anim = animated.get(k);
    if (anim) {
      const full = ANIM.FRAMES[anim.mode];
      const step = full / anim.frames;
      for (let f = 0; f < anim.frames; f++) {
        pc.data.fill(0);
        ANIMATED[k](pc, ctx, f * step, full);
        data.set(pc.data, (base + f) * S * S * 4);
      }
      continue;
    }
    pc.data.fill(0);
    const painter = PAINTERS[k] || ANIMATED[k];
    if (painter) painter(pc, ctx);
    else paintMissing(pc);
    const a = TRANSLUCENT_ALPHA[k];
    if (a !== undefined) for (let i = 3; i < pc.data.length; i += 4) pc.data[i] = a;
    if (isCutoutKey(k)) pc.bleed();
    data.set(pc.data, base * S * S * 4);
  }
  return {
    size: S,
    count,
    data,
    index,
    animated,
    buildMs: now() - t0,
    layer(key) { const v = index.get(key); return v === undefined ? index.get('missing') : v; },
  };
}

/** Magenta/black checkerboard for unknown keys. */
export function paintMissing(pc) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pc.setRGB(x, y, ((x >> 3) ^ (y >> 3)) ? '#f81cf0' : '#101010');
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
 * @property {string} cssUrl                   short `url(blob:...)` CSS value for the same atlas (what style()/element() use)
 * @property {Map<string, number>} index       item key -> cell index
 * @property {(key: string) => {x:number,y:number,w:number,h:number}} rect   pixel rect in the atlas
 * @property {(key: string, px: number) => HTMLElement} element  a <span class="bc-icon"> showing the icon at px size
 * @property {(key: string, px: number) => object} style         CSS props {backgroundImage, backgroundPosition, backgroundSize, width, height}
 * @property {(key: string) => Uint8ClampedArray} pixels16       16x16 RGBA sprite (flat items; iso blocks give their front-ish view) for 3D extrusion
 * @property {(key: string) => boolean} has
 * @property {number} buildMs
 */
export function buildItemIcons(textureSet) {
  const t0 = now();
  const size = ICON_SIZE;
  const atlas = paintIconAtlas(textureSet);
  const { cols, rows, index, sprite16 } = atlas;
  const canvas = document.createElement('canvas');
  canvas.width = cols * size;
  canvas.height = rows * size;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(atlas.data, canvas.width, canvas.height), 0, 0);
  const url = canvas.toDataURL('image/png');
  // ROB-4: never inline the ~220 KB data URL into each icon's style; every inline copy is re-parsed
  // (200 icons cost ~190 ms, a 0.5 s freeze on a slow laptop when the backpack opens). One short blob
  // URL for the whole atlas, decoded once up front, keeps an icon element to a few microseconds.
  const cssUrl = `url(${shortUrl(url)})`;
  const rect = (key) => {
    const i = index.has(key) ? index.get(key) : 0;
    return { x: (i % cols) * size, y: Math.floor(i / cols) * size, w: size, h: size };
  };
  const style = (key, px) => {
    const r = rect(key), k = px / size;
    return {
      backgroundImage: cssUrl,
      backgroundPosition: `${-r.x * k}px ${-r.y * k}px`,
      backgroundSize: `${canvas.width * k}px ${canvas.height * k}px`,
      imageRendering: 'pixelated',
      width: px + 'px', height: px + 'px',
    };
  };
  return {
    size, canvas, cols, rows, url, cssUrl, index, rect, style,
    buildMs: now() - t0,
    element(key, px) {
      const e = document.createElement('span');
      e.className = 'bc-icon';
      Object.assign(e.style, style(key, px));
      e.dataset.item = key;
      return e;
    },
    pixels16(key) {
      const p = sprite16.get(key) || sprite16.get(ITEM_FALLBACK);
      return new Uint8ClampedArray(p);
    },
    has(key) { return !!getItem(key) && index.has(key); },
  };
}
const ITEM_FALLBACK = 'stone';

/** A short blob: URL holding the same PNG as `dataUrl` (falls back to the data URL itself). */
const keepDecoded = [];
function shortUrl(dataUrl) {
  try {
    if (typeof URL === 'undefined' || !URL.createObjectURL || typeof Blob === 'undefined') return dataUrl;
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Never revoked: icons already in the page keep pointing at it (built once per page load).
    const atlasBlobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    if (typeof Image !== 'undefined') {                     // decode once now, so the first backpack has its icons
      const img = new Image(); img.src = atlasBlobUrl;
      keepDecoded.push(img);
      if (img.decode) img.decode().catch(() => {});
    }
    return atlasBlobUrl;
  } catch { return dataUrl; }
}

export { ICON_COLS };
