// OWNER LANE: CORE-A. Node-only review sheets for textures and icons (no browser needed).
//   node tools/corea-preview.mjs [--keys a,b,c] [--scale 4]
// Writes into .tmp/:
//   corea-sheet.png   every texture layer (animation frames included), 16 per row, scaled, on a checkerboard
//   corea-tiles.png   tiling check: the main terrain textures repeated 3x3 each
//   corea-icons.png   the item icon atlas at 2x on an inventory-grey background
//   corea-keys.txt    cell index -> key for corea-sheet.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';
import { buildTextures } from '../src/textures/textures.js';
import { paintIconAtlas } from '../src/textures/icons.js';
import { ITEM_LIST } from '../src/data/items.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
mkdirSync(TMP, { recursive: true });
const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const scale = Number(argv('--scale', 4));
const only = argv('--keys', null);

const t0 = performance.now();
const ts = buildTextures({ fastLeaves: args.includes('--fast') });
const t1 = performance.now();
const atlas = paintIconAtlas(ts);
const t2 = performance.now();
console.log(`buildTextures ${(t1 - t0).toFixed(1)} ms (${ts.count} layers), icons ${(t2 - t1).toFixed(1)} ms`);

function canvas(w, h, bg) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = typeof bg === 'function' ? bg(x, y) : bg;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return { w, h, d };
}
function blit(cv, src, sw, sh, ox, oy, s) {
  for (let y = 0; y < sh * s; y++) for (let x = 0; x < sw * s; x++) {
    const si = (Math.floor(y / s) * sw + Math.floor(x / s)) * 4;
    const a = src[si + 3] / 255;
    if (!a) continue;
    const di = ((oy + y) * cv.w + ox + x) * 4;
    for (let k = 0; k < 3; k++) cv.d[di + k] = src[si + k] * a + cv.d[di + k] * (1 - a);
  }
}
const checker = (x, y) => (((x >> 3) ^ (y >> 3)) & 1 ? [70, 110, 160] : [90, 130, 180]);

// sheet of all layers
const keys = only ? only.split(',') : [...ts.index.keys()];
const cells = [];
for (const k of keys) {
  const n = ts.animated.has(k) ? ts.animated.get(k).frames : 1;
  for (let f = 0; f < n; f++) cells.push([k, f]);
}
const cols = 16, cs = 16 * scale + 4;
const sheet = canvas(cols * cs, Math.ceil(cells.length / cols) * cs, checker);
const lines = [];
cells.forEach(([k, f], i) => {
  const L = ts.layer(k) + f;
  blit(sheet, ts.data.subarray(L * 1024, L * 1024 + 1024), 16, 16, (i % cols) * cs + 2, Math.floor(i / cols) * cs + 2, scale);
  lines.push(`${i}\t${k}${f ? '#' + f : ''}`);
});
writeFileSync(join(TMP, 'corea-sheet.png'), encodePNG(sheet.w, sheet.h, sheet.d));
writeFileSync(join(TMP, 'corea-keys.txt'), lines.join('\n'));

// tiling check
const tileKeys = argv('--tiles', 'grass_top,dirt,stone,cobblestone,sand,gravel,oak_planks,oak_log,oak_leaves,bricks,stone_bricks,wool_red,water,lava,glowstone,bookshelf').split(',');
const ts2 = 3 * 16 * 2 + 6;
const tiles = canvas(Math.min(tileKeys.length, 8) * ts2, Math.ceil(tileKeys.length / 8) * ts2, [40, 40, 40]);
tileKeys.forEach((k, i) => {
  const L = ts.layer(k);
  for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) blit(tiles, ts.data.subarray(L * 1024, L * 1024 + 1024), 16, 16, (i % 8) * ts2 + 3 + tx * 32, Math.floor(i / 8) * ts2 + 3 + ty * 32, 2);
});
writeFileSync(join(TMP, 'corea-tiles.png'), encodePNG(tiles.w, tiles.h, tiles.d));

// icon atlas on inventory grey, 2x
const iconScale = Number(argv('--iconscale', 2));
const [r0, r1] = argv('--rows', `0-${atlas.rows - 1}`).split('-').map(Number);
const ic = canvas(atlas.width * iconScale, (r1 - r0 + 1) * 32 * iconScale, (x, y) => ((Math.floor(x / (32 * iconScale)) + Math.floor(y / (32 * iconScale))) & 1 ? [139, 139, 139] : [150, 150, 150]));
blit(ic, atlas.data.subarray(r0 * 32 * atlas.width * 4, (r1 + 1) * 32 * atlas.width * 4), atlas.width, (r1 - r0 + 1) * 32, 0, 0, iconScale);
writeFileSync(join(TMP, 'corea-icons.png'), encodePNG(ic.w, ic.h, ic.d));
writeFileSync(join(TMP, 'corea-icon-keys.txt'), ITEM_LIST.map((it, i) => `${i}\t${it.key}\t${it.icon}`).join('\n'));
console.log('wrote .tmp/corea-sheet.png, corea-tiles.png, corea-icons.png');
