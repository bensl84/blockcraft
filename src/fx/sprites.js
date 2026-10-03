// OWNER LANE: FEATURE-FX. Procedural, ORIGINAL pixel art for FX: the particle sprite atlas, the sun, the 8 moon
// phases, the cloud map and the weather streaks. PURE (no DOM, no three.js) and deterministic, so it is unit
// tested in Node. Row 0 of every image is the TOP row (same convention as the block textures, SPEC §5.1).

import { mulberry32 } from '../core/math.js';

/** Particle atlas: 8x8 cells of 8x8 pixels (64x64 RGBA). */
export const SPRITE_CELL = 8;
export const SPRITE_COLS = 8;
export const SPRITE_ATLAS_SIZE = SPRITE_CELL * SPRITE_COLS; // 64

/** Sprite indices in the particle atlas. */
export const SPRITE = Object.freeze({
  GENERIC: 0,   // 0..7: round puffs, small (0) to big (7) - smoke, poof, explosion
  HEART: 8,
  SPARKLE: 9,   // 9..10 two twinkle frames
  CRIT: 11,
  ANGRY: 12,
  DROP: 13,
  BUBBLE: 14,
  FLAME: 15,    // 15..16 two flicker frames
  SQUARE: 17,   // solid square (tinted crumbs / weather splash)
  NOTE: 18,
  STAR: 19,     // tiny 4-point star (glint)
});

function img(w, h) { return { w, h, data: new Uint8Array(w * h * 4) }; }
function put(im, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  const i = (y * im.w + x) * 4;
  im.data[i] = r; im.data[i + 1] = g; im.data[i + 2] = b; im.data[i + 3] = a;
}
function cellPut(im, cell, x, y, rgb, a = 255) {
  const cx = (cell % SPRITE_COLS) * SPRITE_CELL, cy = Math.floor(cell / SPRITE_COLS) * SPRITE_CELL;
  if (x < 0 || y < 0 || x >= SPRITE_CELL || y >= SPRITE_CELL) return;
  put(im, cx + x, cy + y, rgb[0], rgb[1], rgb[2], a);
}
/** Draw a 8-row pattern into a cell: chars map to colours, '.' = transparent. */
function pattern(im, cell, rows, palette) {
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      cellPut(im, cell, x, y, palette[ch]);
    }
  }
}

/**
 * Build the particle sprite atlas. Greyscale puffs are tinted per particle (smoke grey, poof white, explosion
 * warm grey); coloured sprites (heart, flame) are used with a white tint.
 * @returns {{w:number,h:number,data:Uint8Array}}
 */
export function buildSpriteAtlas() {
  const im = img(SPRITE_ATLAS_SIZE, SPRITE_ATLAS_SIZE);
  const rnd = mulberry32(0x5eed);
  // 0..7 puffs: a chunky disc whose radius grows with the index, a lighter top-left and darker rim.
  for (let s = 0; s < 8; s++) {
    const r = 1 + s * 0.45;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const dx = x - 3.5, dy = y - 3.5;
      const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.55 + Math.hypot(dx, dy) * 0.45;
      if (d > r + 0.25) continue;
      let v = 225 + Math.floor(rnd() * 30);
      if (d > r - 0.9) v -= 45;                    // rim
      if (dx + dy < -1.5 && d < r - 0.9) v = 255;   // highlight
      cellPut(im, SPRITE.GENERIC + s, x, y, [v, v, v]);
    }
  }
  pattern(im, SPRITE.HEART, [
    '........',
    '.RR.RR..',
    'RWRRRRR.',
    'RRRRRRR.',
    'RRRRRRR.',
    '.RRRRR..',
    '..RRR...',
    '...R....',
  ], { R: [235, 52, 82], W: [255, 200, 210] });
  pattern(im, SPRITE.SPARKLE, [
    '........',
    '...W....',
    '...W....',
    '.WWWWW..',
    '...W....',
    '...W....',
    '........',
    '........',
  ], { W: [255, 255, 255] });
  pattern(im, SPRITE.SPARKLE + 1, [
    '........',
    '........',
    '..W.W...',
    '...W....',
    '..W.W...',
    '........',
    '........',
    '........',
  ], { W: [255, 255, 255] });
  pattern(im, SPRITE.CRIT, [
    '...W....',
    '...W....',
    '..WWW...',
    'WWWYWWW.',
    '..WWW...',
    '...W....',
    '...W....',
    '........',
  ], { W: [255, 255, 255], Y: [255, 255, 255] });
  pattern(im, SPRITE.ANGRY, [
    '........',
    '.DD..DD.',
    'DLLDDLLD',
    'DLLLLLLD',
    '.DLLLLD.',
    'DLLLLLLD',
    'DLLDDLLD',
    '.DD..DD.',
  ], { D: [60, 40, 40], L: [120, 90, 90] });
  pattern(im, SPRITE.DROP, [
    '........',
    '...W....',
    '..WW....',
    '..WWW...',
    '.WWWW...',
    '.WWWW...',
    '..WW....',
    '........',
  ], { W: [255, 255, 255] });
  pattern(im, SPRITE.BUBBLE, [
    '........',
    '..WWW...',
    '.WH..W..',
    '.W...W..',
    '.W...W..',
    '..WWW...',
    '........',
    '........',
  ], { W: [235, 245, 255], H: [255, 255, 255] });
  pattern(im, SPRITE.FLAME, [
    '...Y....',
    '...Y....',
    '..YY....',
    '..YOY...',
    '.YOOY...',
    '.YORO...',
    '.YORO...',
    '..OO....',
  ], { Y: [255, 230, 120], O: [255, 150, 40], R: [230, 70, 20] });
  pattern(im, SPRITE.FLAME + 1, [
    '........',
    '....Y...',
    '...YY...',
    '..YOY...',
    '..YOOY..',
    '.YOROY..',
    '.YORO...',
    '..OO....',
  ], { Y: [255, 230, 120], O: [255, 150, 40], R: [230, 70, 20] });
  pattern(im, SPRITE.SQUARE, [
    'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW',
  ], { W: [255, 255, 255] });
  pattern(im, SPRITE.NOTE, [
    '...WWW..',
    '...W.W..',
    '...W....',
    '...W....',
    '.WWW....',
    'WWWW....',
    '.WW.....',
    '........',
  ], { W: [255, 255, 255] });
  pattern(im, SPRITE.STAR, [
    '........',
    '........',
    '...W....',
    '..WWW...',
    '...W....',
    '........',
    '........',
    '........',
  ], { W: [255, 255, 255] });
  return im;
}

/**
 * Square sun with stepped glow rings (additive: rgb is pre-multiplied by brightness, alpha unused).
 * @returns {{w:number,h:number,data:Uint8Array}} 32x32
 */
export function buildSunTexture() {
  const im = img(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
    let c;
    if (d < 5) c = [255, 255, 236];
    else if (d < 6) c = [255, 246, 170];
    else if (d < 8) c = [196, 168, 80];
    else if (d < 10) c = [110, 84, 34];
    else if (d < 13) c = [44, 30, 12];
    else c = [0, 0, 0];
    put(im, x, y, c[0], c[1], c[2], 255);
  }
  return im;
}

/**
 * 8 moon phases in a 4x2 grid of 16x16 cells (64x32). Phase 0 full, 4 new; 1-3 waning, 5-7 waxing.
 * Additive: dark parts are black.
 */
export function buildMoonTexture() {
  const im = img(64, 32);
  const craters = [[-2, -2, 1.6], [2.5, 1, 1.2], [-1, 3, 1], [2, -3, 0.8], [-3.5, 1, 0.7]];
  for (let p = 0; p < 8; p++) {
    const ox = (p % 4) * 16, oy = Math.floor(p / 4) * 16;
    const theta = (p / 8) * Math.PI * 2;
    const k = Math.cos(theta);
    const waxing = p > 4;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      // chunky square-ish disc (radius 6), like pixel art
      const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.35 + Math.hypot(dx, dy) * 0.65;
      if (d > 6.2) { put(im, ox + x, oy + y, 0, 0, 0, 255); continue; }
      const nx = dx / 6.2, ny = dy / 6.2;
      const s = Math.sqrt(Math.max(0, 1 - ny * ny));
      let lit;
      if (p === 0) lit = true;
      else if (p === 4) lit = false;
      else if (!waxing) lit = nx <= k * s + 0.01;
      else lit = nx >= -k * s - 0.01;
      let v = 214;
      for (const [cx, cy, r] of craters) if (Math.hypot(dx - cx, dy - cy) < r) v = 168;
      if (d > 5.4) v -= 20;
      if (!lit) v = 18;
      put(im, ox + x, oy + y, v, v, Math.min(255, v + 10), 255);
    }
  }
  return im;
}

/** Cloud map: square boolean grid (period in cells) from tiling value noise. Deterministic. */
export const CLOUD_MAP_SIZE = 32;
export const CLOUD_CELL = 12;          // blocks per cloud cell
export const CLOUD_THICKNESS = 4;      // blocks
export function buildCloudMap(seed = 1337, size = CLOUD_MAP_SIZE, fill = 0.38) {
  const rnd = mulberry32(seed >>> 0);
  const lat = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const l1 = lat(8), l2 = lat(16);
  const sample = (l, n, x, y) => {
    const gx = (x / size) * n, gy = (y / size) * n;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const v = (ix, iy) => l[((iy % n + n) % n) * n + ((ix % n + n) % n)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = v(x0, y0), b = v(x0 + 1, y0), c = v(x0, y0 + 1), d = v(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const vals = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    vals[y * size + x] = sample(l1, 8, x, y) * 0.7 + sample(l2, 16, x, y) * 0.3;
  }
  // threshold at the requested fill fraction
  const sorted = Array.from(vals).sort((a, b) => b - a);
  const thr = sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(fill * sorted.length)))];
  const map = new Uint8Array(size * size);
  for (let i = 0; i < map.length; i++) map[i] = vals[i] > thr ? 1 : 0;
  return { size, map, at(x, y) { return map[((y % size + size) % size) * size + ((x % size + size) % size)]; } };
}

/**
 * Cloud geometry over (2*half) x (2*half) cells centred on the origin (pattern repeats every map.size cells):
 * top + bottom faces for every cloud cell, side faces only where the neighbour is empty.
 * @returns {{position: Float32Array, shade: Uint8Array, index: Uint32Array, quads: number}}
 */
export function buildCloudGeometry(cloudMap, half = CLOUD_MAP_SIZE, cell = CLOUD_CELL, thick = CLOUD_THICKNESS) {
  const pos = [], shade = [];
  let quads = 0;
  const quad = (a, b, c, d, s) => { pos.push(...a, ...b, ...c, ...d); shade.push(s, s, s, s); quads++; };
  for (let j = -half; j < half; j++) for (let i = -half; i < half; i++) {
    if (!cloudMap.at(i, j)) continue;
    const x0 = i * cell, x1 = x0 + cell, z0 = j * cell, z1 = z0 + cell, y0 = 0, y1 = thick;
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 255);           // top
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 212);           // bottom
    if (!cloudMap.at(i + 1, j)) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 232); // east
    if (!cloudMap.at(i - 1, j)) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 232); // west
    if (!cloudMap.at(i, j + 1)) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 244); // south
    if (!cloudMap.at(i, j - 1)) quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 244); // north
  }
  const index = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const b = q * 4, o = q * 6;
    index[o] = b; index[o + 1] = b + 1; index[o + 2] = b + 2; index[o + 3] = b; index[o + 4] = b + 2; index[o + 5] = b + 3;
  }
  return { position: new Float32Array(pos), shade: new Uint8Array(shade), index, quads };
}

/**
 * Weather streak texture: 2 cells of 8x32 (rain streaks, snow flakes) = 16x32 RGBA.
 */
export function buildWeatherTexture() {
  const im = img(16, 32);
  const rnd = mulberry32(0xa11);
  // rain: a few thin streaks with varying alpha
  for (let s = 0; s < 3; s++) {
    const x = 1 + s * 3, y0 = Math.floor(rnd() * 20), len = 6 + Math.floor(rnd() * 8);
    for (let y = 0; y < len; y++) put(im, x, (y0 + y) % 32, 150, 180, 235, 120 + Math.floor((y / len) * 120));
  }
  // snow: 5 little flakes
  for (let s = 0; s < 6; s++) {
    const x = 8 + Math.floor(rnd() * 7), y = Math.floor(rnd() * 31);
    put(im, x, y, 255, 255, 255, 255);
    if (s % 2 === 0) { put(im, x + 1, y, 240, 245, 255, 255); put(im, x, y + 1, 240, 245, 255, 255); put(im, x + 1, y + 1, 255, 255, 255, 255); }
  }
  return im;
}
