// OWNER LANE: FEATURE-MENUS. Original procedural pixel art for the menus (SPEC §8.4.1, §9): icons, block tiles,
// the BLOCKCRAFT logo, preset / mode pictures and the parallax title scenery. Everything is drawn in code at
// runtime (no images, no network). Browser only (needs canvas); deterministic (seeded RNG, no Math.random).

import { hashString, mulberry32 } from '../core/math.js';
import { glyphRows, glyphWidth } from './pixelfont.js';

/* ------------------------------------------------------------------ colour helpers */
function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function shade([r, g, b], k) { return [clamp255(r * k), clamp255(g * k), clamp255(b * k)]; }
function mix(a, b, t) { return [clamp255(a[0] + (b[0] - a[0]) * t), clamp255(a[1] + (b[1] - a[1]) * t), clamp255(a[2] + (b[2] - a[2]) * t)]; }
function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function css([r, g, b], a = 1) { return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return c;
}

/* ------------------------------------------------------------------ block tiles (16x16, original) */
const TILE_CACHE = new Map();
const S = 16;

/** Paint a 16x16 RGBA tile. fn(x, y, rnd) -> [r,g,b] | [r,g,b,a] | null */
function paintTile(key, fn) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const rnd = mulberry32(hashString('menu-tile-' + key));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = fn(x, y, rnd);
    const o = (y * S + x) * 4;
    if (!v) { img.data[o + 3] = 0; continue; }
    img.data[o] = v[0]; img.data[o + 1] = v[1]; img.data[o + 2] = v[2]; img.data[o + 3] = v.length > 3 ? v[3] : 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const PAL = {
  dirt: ['#6b4a30', '#7d583a', '#8c6545', '#96704d', '#5b3e27'].map(hex),
  grass: ['#4c8a2a', '#5a9e33', '#68b03d', '#77c046', '#3f7a22'].map(hex),
  stone: ['#6f6f6f', '#7d7d7d', '#888888', '#949494', '#5e5e5e'].map(hex),
  bark: ['#4f3a22', '#5e4529', '#6d5131', '#3f2e1b'].map(hex),
  leaves: ['#2f6b1f', '#3a7d26', '#46902d', '#255716'].map(hex),
  spruce: ['#21452a', '#2a5634', '#33643d', '#1a3822'].map(hex),
  snow: ['#e9f1f7', '#f6fbff', '#dbe7f0', '#ffffff'].map(hex),
  sand: ['#d8c88e', '#e2d49b', '#cdbb7f', '#eadfab'].map(hex),
  planks: ['#9c7442', '#a97f4b', '#b48a53', '#8a6538'].map(hex),
  water: ['#3d6fd6', '#4679e0', '#5287ea', '#3563c6'].map(hex),
};
const pick = (pal, rnd) => pal[Math.floor(rnd() * pal.length)];

const TILE_PAINTERS = {
  dirt: (x, y, r) => pick(PAL.dirt, r),
  grass_top: (x, y, r) => pick(PAL.grass, r),
  grass_side: (x, y, r) => {
    const drip = 3 + ((x * 7 + 3) % 5 === 0 ? 2 : (x * 5) % 3 === 0 ? 1 : 0);
    return y < drip ? pick(PAL.grass, r) : pick(PAL.dirt, r);
  },
  snow_side: (x, y, r) => {
    const drip = 3 + ((x * 7 + 1) % 4 === 0 ? 1 : 0);
    return y < drip ? pick(PAL.snow, r) : pick(PAL.dirt, r);
  },
  snow: (x, y, r) => pick(PAL.snow, r),
  stone: (x, y, r) => {
    const blob = ((x * 13 + y * 7) % 11 < 2) || ((x + y * 3) % 9 === 0);
    return blob ? PAL.stone[4] : pick(PAL.stone.slice(0, 4), r);
  },
  log: (x, y, r) => {
    const stripe = (x % 4 === 0) ? PAL.bark[3] : PAL.bark[(x + Math.floor(y / 5)) % 3];
    return r() < 0.15 ? shade(stripe, 0.85) : stripe;
  },
  leaves: (x, y, r) => (r() < 0.12 ? PAL.leaves[3] : pick(PAL.leaves.slice(0, 3), r)),
  spruce: (x, y, r) => (r() < 0.15 ? PAL.spruce[3] : pick(PAL.spruce.slice(0, 3), r)),
  sand: (x, y, r) => pick(PAL.sand, r),
  planks: (x, y, r) => {
    if (y % 4 === 3) return PAL.planks[3];
    const seam = ((Math.floor(y / 4) % 2) ? 4 : 11);
    if (x === seam) return PAL.planks[3];
    return pick(PAL.planks.slice(0, 3), r);
  },
  water: (x, y, r) => (y % 5 === 0 && r() < 0.5 ? PAL.water[2] : pick(PAL.water, r)),
  red_wool: (x, y, r) => shade(hex('#b3312c'), 0.9 + r() * 0.2),
  yellow_wool: (x, y, r) => shade(hex('#f0c22f'), 0.9 + r() * 0.2),
  blue_wool: (x, y, r) => shade(hex('#3c58c8'), 0.9 + r() * 0.2),
  glass: (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? [210, 235, 245] : (x === y + 3 || x === y + 4) && x < 12 ? [235, 250, 255, 200] : [190, 225, 240, 90]),
};

/** A 16x16 original block tile canvas (cached). */
export function tile(key) {
  if (!TILE_CACHE.has(key)) TILE_CACHE.set(key, paintTile(key, TILE_PAINTERS[key] || TILE_PAINTERS.stone));
  return TILE_CACHE.get(key);
}

/** Tile pixels (RGBA Uint8ClampedArray, 16x16) for per-pixel sampling. */
const TILE_PX = new Map();
function tilePixels(key) {
  if (!TILE_PX.has(key)) TILE_PX.set(key, tile(key).getContext('2d').getImageData(0, 0, S, S).data);
  return TILE_PX.get(key);
}

/** Data URL of a tile scaled by `scale` and darkened by `dark` (0..1) - CSS backgrounds (loading screen). */
export function tileURL(key, scale = 4, dark = 0) {
  const c = canvas(S * scale, S * scale);
  const ctx = c.getContext('2d');
  ctx.drawImage(tile(key), 0, 0, S * scale, S * scale);
  if (dark > 0) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, c.width, c.height); }
  return c.toDataURL('image/png');
}

/* ------------------------------------------------------------------ icons (16x16, auto outline + bevel) */
const ICON_CACHE = new Map();

function makeGrid() { return new Array(256).fill(null); }
function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function fillPoly(g, pts, col) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (inPoly(x + 0.5, y + 0.5, pts)) g[y * 16 + x] = col; }
function fillRect(g, x0, y0, w, h, col) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < 16 && y < 16) g[y * 16 + x] = col; }
function fillFn(g, fn, col) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (fn(x + 0.5, y + 0.5)) g[y * 16 + x] = col; }
function dot(g, x, y, col) { if (x >= 0 && y >= 0 && x < 16 && y < 16) g[y * 16 + x] = col; }

const ICON_DEFS = {
  play(g) { fillPoly(g, [[3.5, 1.5], [14.5, 8], [3.5, 14.5]], '#4fb233'); },
  plus(g) { fillRect(g, 6, 2, 4, 12, '#4fb233'); fillRect(g, 2, 6, 12, 4, '#4fb233'); },
  cross(g) { fillPoly(g, [[1.5, 4], [4, 1.5], [14.5, 12], [12, 14.5]], '#d8382a'); fillPoly(g, [[12, 1.5], [14.5, 4], [4, 14.5], [1.5, 12]], '#d8382a'); },
  check(g) { fillPoly(g, [[1, 8.5], [3.5, 6], [6.5, 9], [12.5, 2.5], [15, 5], [6.5, 14]], '#4fb233'); },
  left(g) { fillPoly(g, [[1, 8], [8, 1], [8, 5], [15, 5], [15, 11], [8, 11], [8, 15]], '#f2d23c'); },
  right(g) { fillPoly(g, [[15, 8], [8, 1], [8, 5], [1, 5], [1, 11], [8, 11], [8, 15]], '#f2d23c'); },
  back(g) { fillPoly(g, [[1, 8], [8, 1], [8, 5], [15, 5], [15, 11], [8, 11], [8, 15]], '#e8e8e8'); },
  heart(g) {
    fillFn(g, (x, y) => Math.hypot(x - 5, y - 5.5) < 3.6 || Math.hypot(x - 11, y - 5.5) < 3.6 || inPoly(x, y, [[1.6, 6.5], [14.4, 6.5], [8, 14.2]]), '#e0302a');
    dot(g, 4, 4, '#ffb0a8'); dot(g, 5, 4, '#ff8a80');
  },
  star(g) {
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 3.1 : 7.6; pts.push([8 + Math.cos(a) * r, 8.6 + Math.sin(a) * r]); }
    fillPoly(g, pts, '#ffd23a');
  },
  sun(g) {
    fillFn(g, (x, y) => Math.hypot(x - 8, y - 8) < 4.2, '#ffcf33');
    for (const [x, y] of [[8, 1], [8, 14], [1, 8], [14, 8], [3, 3], [12, 3], [3, 12], [12, 12]]) { dot(g, x, y, '#ffb21e'); dot(g, x + (x < 8 ? 1 : x > 8 ? -1 : 0), y + (y < 8 ? 1 : y > 8 ? -1 : 0), '#ffb21e'); }
  },
  moon(g) { fillFn(g, (x, y) => Math.hypot(x - 8, y - 8) < 6.4 && Math.hypot(x - 11, y - 5.5) > 5, '#f3edb5'); },
  gear(g) {
    fillFn(g, (x, y) => {
      const d = Math.hypot(x - 8, y - 8), a = Math.atan2(y - 8, x - 8);
      const outer = Math.cos(a * 8) > 0.15 ? 7.3 : 5.6;
      return d < outer && d > 2.3;
    }, '#a6a6a6');
  },
  lock(g) {
    fillFn(g, (x, y) => y < 8 && Math.hypot(x - 8, y - 7) < 5 && Math.hypot(x - 8, y - 7) > 3, '#bdbdbd');
    fillRect(g, 3, 7, 10, 8, '#e3b23c');
    fillRect(g, 7, 9, 2, 3, '#4a3410');
  },
  house(g) {
    fillPoly(g, [[0.5, 8.5], [8, 1], [15.5, 8.5]], '#c8372d');
    fillRect(g, 3, 8, 10, 7, '#c99a5b');
    fillRect(g, 7, 10, 3, 5, '#6a4320');
    fillRect(g, 4, 9, 2, 2, '#8fd3ff');
    fillRect(g, 11, 2, 2, 4, '#7d7d7d');
  },
  exit(g) {
    fillRect(g, 1, 1, 9, 14, '#8a5a2b');
    fillRect(g, 2, 2, 7, 5, '#a8733c'); fillRect(g, 2, 8, 7, 6, '#a8733c');
    dot(g, 7, 8, '#ffd23a');
    fillPoly(g, [[9, 9], [12, 9], [12, 6.5], [15.6, 11], [12, 15.5], [12, 13], [9, 13]], '#4fb233');
  },
  trash(g) {
    fillRect(g, 2, 3, 12, 2, '#9a9a9a'); fillRect(g, 6, 1, 4, 2, '#9a9a9a');
    fillPoly(g, [[3, 5], [13, 5], [12, 15], [4, 15]], '#b8b8b8');
    for (const x of [6, 8, 10]) fillRect(g, x, 7, 1, 6, '#7a7a7a');
  },
  pencil(g) {
    fillPoly(g, [[2, 11], [11, 2], [14, 5], [5, 14]], '#f2c230');
    fillPoly(g, [[2, 11], [5, 14], [1, 15]], '#f0c9a0');
    dot(g, 1, 14, '#333333'); dot(g, 2, 14, '#333333'); dot(g, 1, 13, '#333333');
    fillPoly(g, [[11, 2], [13, 0.5], [15.5, 3], [14, 5]], '#ef8fb0');
  },
  sword(g) {
    fillPoly(g, [[14.8, 1.2], [15, 4], [7, 12], [4, 9], [12, 1]], '#d9e2e8');
    fillPoly(g, [[3, 8], [8, 13], [6.5, 14.5], [1.5, 9.5]], '#6b4a24');
    fillPoly(g, [[3.5, 11], [5, 12.5], [2, 15.5], [0.5, 14]], '#8a5a2b');
  },
  respawn(g) {
    fillFn(g, (x, y) => {
      const d = Math.hypot(x - 8, y - 8.5), a = Math.atan2(y - 8.5, x - 8);
      return d > 3.4 && d < 6.6 && !(a > -Math.PI / 2 - 0.1 && a < -0.5);
    }, '#4fb233');
    fillPoly(g, [[6.5, -0.2], [12.2, 2.2], [7.2, 7.2]], '#4fb233');
  },
  worlds(g) {
    for (const [ox, oy] of [[1, 1], [9, 1], [1, 9], [9, 9]]) { fillRect(g, ox, oy, 6, 2, '#5aa733'); fillRect(g, ox, oy + 2, 6, 4, '#8c6545'); }
  },
  mouse(g) {
    fillFn(g, (x, y) => (x > 3 && x < 13 && y > 4 && y < 12) || Math.hypot(x - 8, y - 5) < 5 && y < 6 || Math.hypot(x - 8, y - 11) < 5 && y > 11, '#ececec');
    fillRect(g, 8, 1, 1, 6, '#6a6a6a'); fillRect(g, 4, 6, 9, 1, '#6a6a6a');
    fillRect(g, 4, 2, 4, 4, '#4fb233');
  },
  backspace(g) {
    fillPoly(g, [[0.5, 8], [5, 2.5], [15.5, 2.5], [15.5, 13.5], [5, 13.5]], '#d0d0d0');
    fillPoly(g, [[7, 5], [8, 4], [13, 11], [12, 12]], '#d8382a'); fillPoly(g, [[12, 4], [13, 5], [8, 12], [7, 11]], '#d8382a');
  },
  dice(g) {
    fillRect(g, 2, 2, 12, 12, '#f4f4f4');
    for (const [x, y] of [[4, 4], [10, 4], [7, 7], [4, 10], [10, 10]]) fillRect(g, x, y, 2, 2, '#c8372d');
  },
  pickaxe(g) {
    fillFn(g, (x, y) => { const d = Math.hypot(x - 8, y - 12); return d > 9 && d < 11.6 && y < 7; }, '#5fd3d0');
    fillPoly(g, [[9.5, 4.5], [11.5, 6.5], [3, 15], [1, 13]], '#8a5a2b');
  },
  block(g) {
    fillPoly(g, [[8, 1], [15, 4.5], [8, 8], [1, 4.5]], '#68b03d');
    fillPoly(g, [[1, 4.5], [8, 8], [8, 15.5], [1, 12]], '#8c6545');
    fillPoly(g, [[15, 4.5], [8, 8], [8, 15.5], [15, 12]], '#6b4a30');
  },
  flat(g) { fillRect(g, 0, 9, 16, 2, '#5aa733'); fillRect(g, 0, 11, 16, 5, '#8c6545'); fillRect(g, 6, 5, 4, 4, '#c99a5b'); },
};

/** Paint an icon definition (16x16 shape grid) into an 18x18 canvas (1 px margin for the outline) with bevel shading. */
function renderIcon(name) {
  const g = makeGrid();
  (ICON_DEFS[name] || ICON_DEFS.block)(g);
  const N = 18;
  const c = canvas(N, N);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  const at = (x, y) => (x < 0 || y < 0 || x > 15 || y > 15 ? null : g[y * 16 + x]);
  for (let Y = 0; Y < N; Y++) for (let X = 0; X < N; X++) {
    const x = X - 1, y = Y - 1;
    const o = (Y * N + X) * 4;
    const v = at(x, y);
    let rgb = null, a = 255;
    if (v) {
      rgb = hex(v);
      if (!at(x, y - 1) || !at(x - 1, y)) rgb = mix(rgb, [255, 255, 255], 0.28);
      else if (!at(x, y + 1) || !at(x + 1, y)) rgb = shade(rgb, 0.72);
    } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
      rgb = [24, 24, 24];
    } else if (at(x - 1, y - 1) || at(x + 1, y + 1) || at(x + 1, y - 1) || at(x - 1, y + 1)) {
      rgb = [24, 24, 24]; a = 110;
    }
    if (!rgb) continue;
    img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Data URL of a 16x16 pixel icon (cached). */
export function iconURL(name) {
  if (!ICON_CACHE.has(name)) ICON_CACHE.set(name, renderIcon(name).toDataURL('image/png'));
  return ICON_CACHE.get(name);
}
export const ICON_NAMES = Object.freeze(Object.keys(ICON_DEFS));

/** <img> of an icon at px CSS size (pixelated). */
export function iconImg(name, px, cls = '') {
  const img = document.createElement('img');
  img.src = iconURL(name);
  img.alt = '';
  img.draggable = false;
  img.className = 'bc-mi ' + cls;
  img.dataset.icon = name;
  if (px) { img.style.width = px + 'px'; img.style.height = px + 'px'; }
  return img;
}

/* ------------------------------------------------------------------ logo */
/**
 * The BLOCKCRAFT logo: every font pixel is a little bevelled stone cube, the top pixels of each letter wear
 * a grass cap, with a dark extrusion below. Returns a canvas (scale it with CSS, image-rendering: pixelated).
 */
export function drawLogo(text = 'BLOCKCRAFT') {
  const C = 6;               // art px per font pixel
  const DEPTH = 4;           // extrusion in art px
  const chars = [...text];
  let wpx = 0;
  for (const ch of chars) wpx += glyphWidth(ch) + 1;
  wpx -= 1;
  const W = wpx * C + 4 + DEPTH, H = 7 * C + 4 + DEPTH;
  const mask = new Uint8Array(wpx * 7);
  let ox = 0;
  for (const ch of chars) {
    const rows = glyphRows(ch);
    for (let r = 0; r < 7; r++) for (let c = 0; c < rows[r]?.length; c++) if (rows[r][c] === '#') mask[r * wpx + ox + c] = 1;
    ox += glyphWidth(ch) + 1;
  }
  const on = (c, r) => c >= 0 && r >= 0 && c < wpx && r < 7 && mask[r * wpx + c] === 1;
  const cv = canvas(W, H);
  const ctx = cv.getContext('2d');
  const stone = tilePixels('stone'), grass = tilePixels('grass_top'), dirt = tilePixels('dirt');
  const img = ctx.createImageData(W, H);
  const put = (x, y, rgb) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255; };
  const lit = new Uint8Array(W * H);
  // extrusion (dark), then faces
  for (let r = 0; r < 7; r++) for (let c = 0; c < wpx; c++) {
    if (!on(c, r)) continue;
    for (let d = DEPTH; d >= 1; d--) for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const X = 2 + c * C + x + Math.round(d * 0.5), Y = 2 + r * C + y + d;
      put(X, Y, shade([70, 70, 74], 0.75 + 0.06 * (DEPTH - d)));
      lit[Y * W + X] = 1;
    }
  }
  for (let r = 0; r < 7; r++) for (let c = 0; c < wpx; c++) {
    if (!on(c, r)) continue;
    const cap = !on(c, r - 1);
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const X = 2 + c * C + x, Y = 2 + r * C + y;
      const tx = X & 15, ty = Y & 15, o = (ty * 16 + tx) * 4;
      let rgb;
      if (cap && y < 2) rgb = [grass[o], grass[o + 1], grass[o + 2]];
      else if (cap && y === 2 && (x + c) % 3 === 0) rgb = [grass[o], grass[o + 1], grass[o + 2]];
      else rgb = (r === 6 && y >= C - 2) ? [dirt[o], dirt[o + 1], dirt[o + 2]] : [stone[o], stone[o + 1], stone[o + 2]];
      if (y === 0 && !on(c, r - 1)) rgb = mix(rgb, [255, 255, 255], 0.35);
      else if (x === 0 && !on(c - 1, r)) rgb = mix(rgb, [255, 255, 255], 0.22);
      else if (y === C - 1 && !on(c, r + 1)) rgb = shade(rgb, 0.7);
      else if (x === C - 1 && !on(c + 1, r)) rgb = shade(rgb, 0.8);
      put(X, Y, rgb);
      lit[Y * W + X] = 1;
    }
  }
  // 1 px black outline
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (lit[y * W + x]) continue;
    if ((x > 0 && lit[y * W + x - 1]) || (x < W - 1 && lit[y * W + x + 1]) || (y > 0 && lit[(y - 1) * W + x]) || (y < H - 1 && lit[(y + 1) * W + x])) put(x, y, [20, 20, 20]);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/* ------------------------------------------------------------------ little scenes (preset / mode pictures) */
function skyGradient(ctx, w, h, top, bottom, bands = 6) {
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = css(mix(hex(top), hex(bottom), i / (bands - 1)));
    ctx.fillRect(0, Math.floor(i * h / bands), w, Math.ceil(h / bands) + 1);
  }
}
function drawTile(ctx, key, x, y, size) { ctx.drawImage(tile(key), Math.round(x), Math.round(y), size, size); }
function cloud(ctx, x, y, w) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w, 3); ctx.fillRect(x + 2, y - 2, w - 5, 2);
  ctx.fillStyle = '#dfe9f5'; ctx.fillRect(x, y + 3, w, 1);
}
function tree(ctx, x, groundY, b, kind = 'oak') {
  const trunk = kind === 'spruce' ? 3 : 2;
  for (let i = 1; i <= trunk; i++) drawTile(ctx, 'log', x, groundY - i * b, b);
  const top = groundY - trunk * b;
  if (kind === 'spruce') {
    for (const [dx, dy, n] of [[-2, -1, 5], [-1, -2, 3], [-1, -3, 3], [0, -4, 1]]) for (let i = 0; i < n; i++) drawTile(ctx, 'spruce', x + (dx + i) * b, top + dy * b, b);
    for (const [dx, dy] of [[0, -4], [-1, -2]]) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x + dx * b, top + dy * b, b, Math.max(1, b / 4)); }
  } else {
    for (const [dx, dy, n] of [[-2, -1, 5], [-2, -2, 5], [-1, -3, 3]]) for (let i = 0; i < n; i++) drawTile(ctx, 'leaves', x + (dx + i) * b, top + dy * b, b);
  }
}

/** Picture for a world preset ('flat' | 'default' | 'snowy' | 'islands'): an 80x50 art-pixel canvas. */
export function presetPicture(preset) {
  const W = 80, H = 50, b = 8;
  const cv = canvas(W, H);
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(hashString('preset-' + preset));
  if (preset === 'snowy') {
    skyGradient(ctx, W, H, '#8fb4e6', '#dbe8f7');
    ctx.fillStyle = '#9fb0c8';
    for (let x = 0; x < W; x += 4) { const hgt = 16 + Math.round(10 * Math.abs(Math.sin(x * 0.07 + 1))); ctx.fillRect(x, H - 14 - hgt, 4, hgt); ctx.fillStyle = '#f4f8ff'; ctx.fillRect(x, H - 14 - hgt, 4, 3); ctx.fillStyle = '#9fb0c8'; }
    const hs = [3, 3, 2, 2, 3, 4, 4, 3, 2, 2];
    hs.forEach((h, i) => { for (let j = 0; j < h; j++) drawTile(ctx, j === h - 1 ? 'snow_side' : (j < h - 2 ? 'stone' : 'dirt'), i * b, H - (j + 1) * b, b); });
    tree(ctx, 2 * b, H - 2 * b, 4, 'spruce');
    tree(ctx, 7 * b + 2, H - 3 * b, 4, 'spruce');
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 26; i++) ctx.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * (H - 20)), 1, 1);
  } else if (preset === 'flat') {
    skyGradient(ctx, W, H, '#6fa6f7', '#bcd8ff');
    ctx.fillStyle = '#ffe680'; ctx.fillRect(62, 6, 8, 8);
    cloud(ctx, 8, 10, 16); cloud(ctx, 40, 16, 12);
    for (let i = 0; i < 10; i++) { drawTile(ctx, 'grass_side', i * b, H - 2 * b, b); drawTile(ctx, 'dirt', i * b, H - b, b); }
    // a tiny build: a house of planks with a red wool roof and a glass window
    const gx = 2 * b, gy = H - 2 * b;
    for (let i = 0; i < 3; i++) for (let j = 1; j <= 2; j++) drawTile(ctx, 'planks', gx + i * b, gy - j * b, b);
    drawTile(ctx, 'glass', gx + b, gy - 2 * b, b);
    for (let i = -1; i < 4; i++) drawTile(ctx, 'red_wool', gx + i * b, gy - 3 * b, b);
    for (let i = 0; i < 3; i++) drawTile(ctx, 'red_wool', gx + i * b, gy - 4 * b, b);
    drawTile(ctx, 'red_wool', gx + b, gy - 5 * b, b);
    drawTile(ctx, 'yellow_wool', 6 * b, gy - b, b); drawTile(ctx, 'blue_wool', 7 * b, gy - b, b); drawTile(ctx, 'blue_wool', 7 * b, gy - 2 * b, b);
  } else if (preset === 'islands') {
    skyGradient(ctx, W, H, '#6fa6f7', '#cfe6ff');
    ctx.fillStyle = '#3d6fd6'; ctx.fillRect(0, H - 14, W, 14);
    for (let i = 1; i < 5; i++) drawTile(ctx, i === 1 || i === 4 ? 'sand' : 'grass_side', i * b, H - 2 * b, b);
    for (let i = 6; i < 9; i++) drawTile(ctx, 'sand', i * b, H - 2 * b + 3, b);
    tree(ctx, 2 * b + 4, H - 2 * b, 4, 'oak');
  } else {
    skyGradient(ctx, W, H, '#6fa6f7', '#c4ddff');
    ctx.fillStyle = '#ffe680'; ctx.fillRect(8, 6, 8, 8);
    cloud(ctx, 46, 9, 18);
    const hs = [2, 3, 4, 4, 3, 2, 2, 3, 3, 2];
    hs.forEach((h, i) => { for (let j = 0; j < h; j++) drawTile(ctx, j === h - 1 ? 'grass_side' : (j === 0 && h > 3 ? 'stone' : 'dirt'), i * b, H - (j + 1) * b, b); });
    tree(ctx, 2 * b + 2, H - 4 * b, 4, 'oak');
    tree(ctx, 7 * b + 2, H - 3 * b, 4, 'oak');
    ctx.fillStyle = '#ffd23a'; ctx.fillRect(5 * b + 2, H - 2 * b - 2, 2, 2);
    ctx.fillStyle = '#e0302a'; ctx.fillRect(9 * b + 3, H - 2 * b - 2, 2, 2);
  }
  return cv;
}

/** Picture for a mode card ('creative' | 'easy' | 'normal'): a 48x32 art-pixel canvas. */
export function modePicture(kind) {
  const W = 48, H = 32;
  const cv = canvas(W, H);
  const ctx = cv.getContext('2d');
  const icon = (name, x, y, s = 16) => ctx.drawImage(renderIcon(name), x, y, s, s);
  if (kind === 'creative') {
    skyGradient(ctx, W, H, '#7a5cc8', '#c2a7f2', 5);
    drawTile(ctx, 'grass_side', 4, 18, 10); drawTile(ctx, 'red_wool', 15, 12, 10); drawTile(ctx, 'yellow_wool', 26, 18, 10);
    icon('star', 30, 1, 16);
    ctx.fillStyle = '#fff6b0';
    for (const [x, y] of [[6, 6], [22, 4], [12, 3], [40, 22], [3, 14]]) { ctx.fillRect(x, y, 1, 1); ctx.fillRect(x - 1, y + 1, 3, 1); ctx.fillRect(x, y + 2, 1, 1); }
  } else if (kind === 'easy') {
    skyGradient(ctx, W, H, '#5ea0f0', '#bcd8ff', 5);
    for (let i = 0; i < 5; i++) drawTile(ctx, 'grass_side', i * 10, 26, 10);
    icon('sun', 2, 1, 14);
    icon('sword', 16, 4, 20);
    icon('heart', 34, 8, 12);
  } else {
    skyGradient(ctx, W, H, '#16224a', '#3a4f86', 5);
    ctx.fillStyle = '#ffffff';
    for (const [x, y] of [[20, 3], [29, 7], [41, 4], [8, 18], [44, 15]]) ctx.fillRect(x, y, 1, 1);
    for (let i = 0; i < 5; i++) drawTile(ctx, 'grass_side', i * 10, 26, 10);
    ctx.fillStyle = 'rgba(10,16,40,0.45)'; ctx.fillRect(0, 26, W, 6);
    icon('moon', 2, 1, 14);
    icon('sword', 16, 4, 20);
    icon('heart', 34, 6, 10); icon('heart', 34, 15, 10);
  }
  return cv;
}

/* ------------------------------------------------------------------ title scenery (parallax panorama) */
/**
 * Seamless parallax scenery drawn into a low-resolution canvas (stretched with CSS, pixelated):
 * sky bands, a square sun, drifting clouds, far mountains, mid hills with trees and a near ground layer with
 * flowers and a few wandering animals. Call resize() when the window size changes and draw(t) every frame.
 */
export class Panorama {
  constructor() {
    this.canvas = canvas(320, 180);
    this.canvas.className = 'bc-menu-panorama';
    this.ctx = this.canvas.getContext('2d');
    this.layers = [];
    this.w = 0; this.h = 0;
    this.animals = [];
  }

  resize(cssW, cssH) {
    const H = 180;
    const W = Math.max(160, Math.ceil(cssW / Math.max(1, cssH) * H));
    if (W === this.w && H === this.h) return;
    this.w = W; this.h = H;
    this.canvas.width = W; this.canvas.height = H;
    this.ctx.imageSmoothingEnabled = false;
    this.sky = this.buildSky(W, H);
    const stripW = Math.ceil(Math.max(W * 2, 640) / 64) * 64;
    this.layers = [
      { strip: this.buildClouds(stripW, H), speed: 3 },
      { strip: this.buildMountains(stripW, H), speed: 5 },
      { strip: this.buildHills(stripW, H, 8, 'mid'), speed: 11 },
      { strip: this.buildHills(stripW, H, 16, 'near'), speed: 24 },
    ];
    this.stripW = stripW;
    const kinds = ['pig', 'sheep', 'chicken', 'pig', 'chicken', 'sheep'];
    this.animals = kinds.map((kind, i) => ({ kind, sx: (stripW * (i + 0.3)) / kinds.length, dir: i % 2 ? -1 : 1, speed: kind === 'chicken' ? 7 : 4 + i }));
    this.lastT = null;
  }

  buildSky(W, H) {
    const c = canvas(W, H);
    const x = c.getContext('2d');
    skyGradient(x, W, H, '#5b95f0', '#c9e0ff', 9);
    x.fillStyle = '#fff3a8'; x.fillRect(Math.floor(W * 0.78), 18, 20, 20);
    x.fillStyle = '#ffe36b'; x.fillRect(Math.floor(W * 0.78) + 3, 21, 14, 14);
    return c;
  }

  buildClouds(W, H) {
    const c = canvas(W, H);
    const x = c.getContext('2d');
    const rnd = mulberry32(hashString('pano-clouds'));
    for (let i = 0; i < W / 70; i++) {
      const cx = Math.floor(i * 70 + rnd() * 30), cy = 10 + Math.floor(rnd() * 40), w = 24 + Math.floor(rnd() * 30);
      x.fillStyle = '#ffffff'; x.fillRect(cx, cy, w, 6); x.fillRect(cx + 4, cy - 4, w - 10, 4);
      x.fillStyle = '#dce8f7'; x.fillRect(cx, cy + 6, w, 2);
    }
    return c;
  }

  /** Periodic height function over the strip (seamless wrap). */
  heights(n, seed, base, amp) {
    const rnd = mulberry32(hashString('pano-h-' + seed));
    const waves = [1, 2, 3, 5].map((k) => ({ k, ph: rnd() * Math.PI * 2, a: amp / k }));
    const out = [];
    for (let i = 0; i < n; i++) {
      let v = base;
      for (const w of waves) v += Math.sin((i / n) * Math.PI * 2 * w.k + w.ph) * w.a;
      out.push(Math.round(v));
    }
    return out;
  }

  buildMountains(W, H) {
    const c = canvas(W, H);
    const x = c.getContext('2d');
    const cols = W / 4;
    const hs = this.heights(cols, 'mtn', 52, 22);
    for (let i = 0; i < cols; i++) {
      const top = H - 58 - hs[i];
      x.fillStyle = '#8ea6c8'; x.fillRect(i * 4, top, 4, H - top);
      if (hs[i] > 56) { x.fillStyle = '#eef4fb'; x.fillRect(i * 4, top, 4, 4 + (hs[i] - 56) / 2); }
      x.fillStyle = 'rgba(70,90,130,0.25)'; if (i % 3 === 0) x.fillRect(i * 4, top + 8, 4, H - top);
    }
    return c;
  }

  buildHills(W, H, b, which) {
    const c = canvas(W, H);
    const x = c.getContext('2d');
    const cols = W / b;
    const near = which === 'near';
    const hs = this.heights(cols, which, near ? 2.2 : 3.6, near ? 1.1 : 2.0);
    const groundBase = near ? H : H - 14;
    const rnd = mulberry32(hashString('pano-deco-' + which));
    this[which + 'Heights'] = { hs, b, groundBase };
    for (let i = 0; i < cols; i++) {
      const h = Math.max(1, hs[i]);
      for (let j = 0; j < h + (near ? 0 : 3); j++) {
        const key = j === h - 1 ? 'grass_side' : (j < h - 3 ? 'stone' : 'dirt');
        drawTile(x, key, i * b, groundBase - (j + 1) * b, b);
      }
      const gy = groundBase - h * b;
      if (rnd() < (near ? 0.05 : 0.2) && i > 1 && i < cols - 3) tree(x, i * b, gy, b, rnd() < 0.3 ? 'spruce' : 'oak');
      else if (near && rnd() < 0.3) {
        x.fillStyle = rnd() < 0.5 ? '#e0302a' : '#ffd23a';
        const fx = i * b + 4 + Math.floor(rnd() * 8);
        x.fillRect(fx, gy - 4, 3, 3);
        x.fillStyle = '#3f7a22'; x.fillRect(fx + 1, gy - 1, 1, 1);
      }
    }
    if (!near) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(170,200,240,0.28)'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over'; }
    return c;
  }

  /** Ground y (art px) of the near layer at screen x for scroll offset off. */
  nearGround(screenX, off) {
    const nh = this.nearHeights;
    if (!nh) return this.h;
    const sx = ((screenX + off) % this.stripW + this.stripW) % this.stripW;
    const i = Math.floor(sx / nh.b);
    return nh.groundBase - Math.max(1, nh.hs[i]) * nh.b;
  }

  drawAnimal(a, gy, t) {
    const x = this.ctx;
    const X = Math.round(a.x), step = Math.floor(t * 6) % 2;
    const flip = a.dir < 0;
    const px = (dx, dy, w, h, col) => { x.fillStyle = col; x.fillRect(flip ? X + 16 - dx - w : X + dx, gy - 12 + dy, w, h); };
    if (a.kind === 'pig') {
      px(1, 3, 12, 6, '#f0a3a8'); px(11, 1, 5, 6, '#f0a3a8'); px(15, 3, 2, 3, '#e07f86'); px(13, 2, 1, 1, '#222');
      px(2, 9, 2, 3 - step, '#e08a90'); px(9, 9, 2, 2 + step, '#e08a90');
    } else if (a.kind === 'sheep') {
      px(1, 2, 12, 7, '#f2f2f2'); px(11, 1, 5, 5, '#d8d8d8'); px(13, 2, 3, 3, '#b49a86'); px(14, 2, 1, 1, '#222');
      px(2, 9, 2, 3 - step, '#b49a86'); px(9, 9, 2, 2 + step, '#b49a86');
    } else {
      px(4, 5, 7, 5, '#ffffff'); px(9, 2, 4, 4, '#ffffff'); px(13, 4, 2, 1, '#ffb21e'); px(12, 6, 1, 1, '#e0302a'); px(11, 3, 1, 1, '#222');
      px(5, 10, 1, 2, '#ffb21e'); px(8, 10, 1, 2, '#ffb21e');
    }
  }

  /** Draw at time t (seconds). */
  draw(t) {
    if (!this.w) return;
    const x = this.ctx;
    x.drawImage(this.sky, 0, 0);
    for (const L of this.layers) {
      const off = Math.floor((t * L.speed) % this.stripW);
      x.drawImage(L.strip, -off, 0);
      if (this.stripW - off < this.w) x.drawImage(L.strip, this.stripW - off, 0);
    }
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    const nearOff = Math.floor((t * 24) % this.stripW);
    const wrap = (v) => ((v % this.stripW) + this.stripW) % this.stripW;
    for (const a of this.animals) {
      a.sx = wrap(a.sx + a.dir * a.speed * dt);
      const screenX = wrap(a.sx - nearOff);
      if (screenX > this.w + 4) continue;
      a.x = screenX;
      this.drawAnimal(a, this.nearGround(screenX + 8, nearOff), t);
    }
  }
}
