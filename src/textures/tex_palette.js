// OWNER: LEAD (v1.7, judge FID-7 building palette + FID-8 Nether), in CORE-A's texture style. Original procedural
// pixel art for: birch and spruce doors, three trapdoors, the lantern, the flower pot, the sign, 16 concrete
// colours, quartz, prismarine, and the Nether blocks (netherrack, soul sand, nether quartz ore, nether bricks,
// the portal sheet). Painters: (pc: PixelCanvas, ctx: {key, seed, rng}) => void, deterministic.
//
// Partial models sample their texture with uv-lock (u = block-local x, v = 1 - y on sides; top u = x, v = z):
//   lantern  side: body cols 5-10 rows 8-15, cap cols 6-9 rows 6-8, hook cols 7-8 rows 0-5; top: cols 5-10 rows 5-10
//   pot      side: cols 5-10 rows 10-15 (row 10 = rim); top: cols 5-10 rows 5-10 (soil inside the rim)
//   sign     standing board rows 1-8, wall board rows 4-11, post cols 7-8 rows 9-15: the "writing" stays in rows 3-7
//   trapdoor top face = the whole tile; its 3/16 edges show rows 13-15 (bottom hatch) or rows 0-2 (top hatch)

import { hash2, tnoise, mix, rgb } from './toolkit.js';
import { mulberry32 } from '../core/math.js';
import { COLORS, COLOR_HEX } from '../core/constants.js';

const S = 16;
const P = (...hex) => hex.map(rgb);
const pick = (pal, t) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)))];
const each = (fn) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x, y); };
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

/** Keys whose alpha is 0/255 (cutout pass with holes). */
export const PALETTE_CUTOUT = new Set(['birch_door_lower', 'birch_door_upper', 'spruce_door_lower', 'spruce_door_upper',
  'oak_trapdoor', 'birch_trapdoor', 'spruce_trapdoor']);
/**
 * Fallback texture per key, used only when a GPU cannot hold every layer even with half-length water and lava
 * (WebGL2 guarantees 256 layers): the key then shares its fallback's layer (textures.js buildTextures maxLayers).
 */
export const LAYER_FALLBACK = Object.freeze({
  ...Object.fromEntries(COLORS.map((c) => ['concrete_' + c, 'wool_' + c])),
  quartz_block: 'diorite', prismarine: 'mossy_cobblestone', nether_bricks: 'bricks', soul_sand: 'dirt',
  nether_quartz_ore: 'netherrack', birch_trapdoor: 'oak_trapdoor', spruce_trapdoor: 'oak_trapdoor',
});

/* ------------------------------------------------------------------ doors */
const DOOR_PAL = {
  birch: P('#8f7f50', '#b9a873', '#cdbb85', '#dccb95', '#ece0b4'),
  spruce: P('#2e2014', '#45321e', '#523c25', '#5e4529', '#6e5533'),
};
function paintDoor(pc, seed, upper, wood) {
  const pal = DOOR_PAL[wood];
  each((x, y) => {
    const t = 0.55 + (tnoise(x, y, 16, 2, seed) - 0.5) * 0.4 + (hash2(x, y, seed + 1) - 0.5) * 0.2;
    pc.setRGB(x, y, pick(pal, t));
  });
  each((x, y) => {
    if (x === 0 || x === 15) pc.setRGB(x, y, pal[0]);
    else if (x === 1) pc.setRGB(x, y, pal[4]);
    else if (x === 14) pc.setRGB(x, y, pal[1]);
  });
  if (wood === 'birch') {
    // birch: a tall window strip on top, little square panes below it, pale panels on the bottom half
    for (const y of [0, 15]) for (let x = 1; x < 15; x++) pc.setRGB(x, y, y === 0 ? pal[4] : pal[1]);
    if (upper) {
      for (const [x0, y0, w, h] of [[3, 2, 4, 5], [9, 2, 4, 5], [3, 9, 4, 4], [9, 9, 4, 4]]) {
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) pc.setRGB(x, y, '#d8eef5', 0);
        for (let x = x0 - 1; x <= x0 + w; x++) { pc.setRGB(x, y0 - 1, pal[1]); pc.setRGB(x, y0 + h, pal[4]); }
        for (let y = y0 - 1; y <= y0 + h; y++) { pc.setRGB(x0 - 1, y, pal[1]); pc.setRGB(x0 + w, y, pal[4]); }
      }
    } else {
      for (const [y0, y1] of [[2, 7], [9, 13]]) for (let y = y0; y <= y1; y++) for (let x = 3; x <= 12; x++) {
        pc.setRGB(x, y, y === y0 || x === 3 ? pal[4] : y === y1 || x === 12 ? pal[1] : pal[3]);
      }
      pc.setRGB(12, 0, '#8a8a8a'); pc.setRGB(12, 1, '#4a4a4a'); pc.setRGB(13, 1, '#2a2a2a');
    }
    return;
  }
  // spruce: vertical boards with iron straps, one small round-ish window on top
  each((x, y) => { if (x > 1 && x < 14 && (x % 4) === 1) pc.setRGB(x, y, pal[0]); });
  for (const y of upper ? [12, 13] : [3, 4, 11, 12]) for (let x = 1; x < 15; x++) pc.setRGB(x, y, y % 2 ? '#3a3a3e' : '#56565c');
  if (upper) {
    for (let y = 3; y <= 8; y++) for (let x = 5; x <= 10; x++) {
      const corner = (y === 3 || y === 8) && (x === 5 || x === 10);
      if (!corner) pc.setRGB(x, y, '#d8eef5', 0);
    }
  } else {
    pc.setRGB(12, 7, '#9a9aa0'); pc.setRGB(12, 8, '#3a3a3e'); pc.setRGB(13, 8, '#2a2a2e');
  }
}

/* ------------------------------------------------------------------ trapdoors */
function paintTrapdoor(pc, seed, wood) {
  const pal = wood === 'oak' ? P('#5e4428', '#7c5c36', '#946f42', '#a8814b', '#bc945c') : DOOR_PAL[wood];
  each((x, y) => {
    let t = 0.55 + (tnoise(x, y, 2, 16, seed) - 0.5) * 0.45 + (hash2(x, y, seed + 3) - 0.5) * 0.2;
    if ((x & 3) === 3) t -= 0.35;                         // board seams (vertical)
    pc.setRGB(x, y, pick(pal, t));
  });
  // frame
  each((x, y) => {
    if (x === 0 || y === 0) pc.setRGB(x, y, pal[4]);
    else if (x === 15 || y === 15) pc.setRGB(x, y, pal[0]);
    else if (x === 1 || y === 1 || x === 14 || y === 14) pc.setRGB(x, y, pal[2]);
  });
  // four little holes and two iron hinges
  for (const [x0, y0] of [[4, 4], [10, 4], [4, 10], [10, 10]]) {
    for (let y = y0; y < y0 + 2; y++) for (let x = x0; x < x0 + 2; x++) pc.setRGB(x, y, '#000000', 0);
  }
  for (const y of [2, 13]) for (let x = 2; x <= 5; x++) pc.setRGB(x, y, x === 5 ? '#3a3a3e' : '#6a6a70');
}

/* ------------------------------------------------------------------ lantern */
function paintLantern(pc) {
  pc.fill('#2e2e34');
  // hook / chain (rows 0-5, cols 7-8)
  for (let y = 0; y <= 5; y++) { pc.setRGB(7, y, y % 2 ? '#5a5a62' : '#3a3a40'); pc.setRGB(8, y, y % 2 ? '#3a3a40' : '#5a5a62'); }
  // cap (rows 6-8, cols 6-9)
  for (let y = 6; y <= 8; y++) for (let x = 6; x <= 9; x++) pc.setRGB(x, y, y === 6 ? '#6a6a74' : x === 9 ? '#2a2a30' : '#4a4a52');
  // body (rows 8-15, cols 5-10): iron frame, glowing glass
  for (let y = 8; y <= 15; y++) for (let x = 5; x <= 10; x++) {
    const frame = x === 5 || x === 10 || y <= 9 || y === 15;
    if (frame) pc.setRGB(x, y, y <= 9 ? '#5a5a64' : x === 10 || y === 15 ? '#2a2a30' : '#4a4a52');
    else {
      const d = Math.abs(x - 7.5) + Math.abs(y - 12);
      pc.setRGB(x, y, d < 1.6 ? '#fff4c0' : d < 2.6 ? '#ffd76a' : '#f2a838');
    }
  }
}
function paintLanternTop(pc) {
  pc.fill('#2e2e34');
  for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) {
    const ring = x === 5 || x === 10 || y === 5 || y === 10;
    pc.setRGB(x, y, ring ? '#5a5a64' : '#3e3e46');
  }
  for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) pc.setRGB(x, y, (x === 6 || y === 6) ? '#76767f' : '#4a4a52');
  pc.setRGB(7, 7, '#1e1e22'); pc.setRGB(8, 7, '#1e1e22'); pc.setRGB(7, 8, '#1e1e22'); pc.setRGB(8, 8, '#1e1e22');
}

/* ------------------------------------------------------------------ flower pot */
function paintPot(pc, seed) {
  const clay = P('#7e3e26', '#94492e', '#a4573a', '#b46446', '#c47452');
  each((x, y) => pc.setRGB(x, y, pick(clay, 0.45 + (hash2(x, y, seed) - 0.5) * 0.3)));
  // side band (rows 10-15): rim on row 10, a light stripe on row 12, darker foot on row 15
  for (let x = 0; x < S; x++) {
    pc.setRGB(x, 10, clay[4]);
    pc.setRGB(x, 11, clay[2]);
    pc.setRGB(x, 12, clay[3]);
    pc.setRGB(x, 15, clay[0]);
  }
  // top (rows 5-10, cols 5-10): rim ring around soil
  for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) {
    const ring = x === 5 || x === 10 || y === 5 || y === 10;
    pc.setRGB(x, y, ring ? clay[4] : pick(P('#3a2616', '#4a3020', '#5a3a26'), hash2(x, y, seed + 5)));
  }
}

/* ------------------------------------------------------------------ sign */
function paintSign(pc, seed) {
  const pal = P('#7a5a32', '#9a7746', '#b08a52', '#bf9a60', '#cfab70');
  each((x, y) => {
    const t = 0.6 + (tnoise(x, y, 2, 16, seed) - 0.5) * 0.4 + (hash2(x, y, seed + 1) - 0.5) * 0.15;
    pc.setRGB(x, y, pick(pal, t));
  });
  for (let y = 0; y < S; y++) { pc.setRGB(0, y, pal[0]); pc.setRGB(15, y, pal[0]); pc.setRGB(1, y, pal[4]); }
  // "writing": three short wavy lines (no letters: decorative, kid-friendly)
  const r = mulberry32(seed ^ 0x51a);
  for (const y of [3, 5, 7]) {
    const x0 = 3 + Math.floor(r() * 2), x1 = 12 - Math.floor(r() * 3);
    for (let x = x0; x <= x1; x++) if (r() < 0.85) pc.setRGB(x, y, '#3a2614');
  }
}

/* ------------------------------------------------------------------ concrete, quartz, prismarine */
function paintConcrete(pc, seed, hex) {
  const base = rgb(hex);
  const pal = [mix(base, BLACK, 0.07), mix(base, BLACK, 0.035), base, mix(base, WHITE, 0.035)];
  each((x, y) => pc.setRGB(x, y, pick(pal, 0.5 + (tnoise(x, y, 4, 4, seed) - 0.5) * 0.5 + (hash2(x, y, seed + 1) - 0.5) * 0.35)));
}
function paintQuartz(pc, seed) {
  const pal = P('#d8d0c4', '#e2dacf', '#ece6dc', '#f4efe7', '#fbf8f2');
  each((x, y) => pc.setRGB(x, y, pick(pal, 0.55 + (tnoise(x, y, 8, 2, seed) - 0.5) * 0.35 + (hash2(x, y, seed + 1) - 0.5) * 0.15)));
  each((x, y) => {
    if (x === 0 || y === 0) pc.setRGB(x, y, pal[4]);
    else if (x === 15 || y === 15) pc.setRGB(x, y, pal[0]);
  });
}
function paintPrismarine(pc, seed) {
  const pal = P('#3e7a72', '#4f8f86', '#63a29a', '#78b6a8', '#94cbbd', '#5a8aa8');
  each((x, y) => {
    const v = 0.55 * tnoise(x, y, 4, 4, seed) + 0.3 * tnoise(x, y, 8, 8, seed + 1) + 0.15 * hash2(x, y, seed + 2);
    pc.setRGB(x, y, pick(pal.slice(0, 5), v));
    if (tnoise(x, y, 4, 4, seed + 7) > 0.72) pc.setRGB(x, y, pal[5]);
  });
}

/* ------------------------------------------------------------------ the Nether */
const NETHER = P('#3e1414', '#541a1a', '#6a2222', '#7e2c28', '#94382e');
function paintNetherrack(pc, seed) {
  each((x, y) => {
    const v = 0.5 * tnoise(x, y, 4, 4, seed) + 0.3 * tnoise(x, y, 8, 8, seed + 1) + 0.2 * hash2(x, y, seed + 2);
    pc.setRGB(x, y, pick(NETHER, v));
  });
  const r = mulberry32(seed ^ 0x7a1);
  for (let i = 0; i < 10; i++) pc.set(Math.floor(r() * S), Math.floor(r() * S), NETHER[0]);
}
function paintSoulSand(pc, seed) {
  const pal = P('#3a2a1e', '#4a3626', '#54402f', '#604a38', '#6e5644');
  each((x, y) => pc.setRGB(x, y, pick(pal, 0.5 + (tnoise(x, y, 4, 4, seed) - 0.5) * 0.6 + (hash2(x, y, seed + 1) - 0.5) * 0.3)));
  // soft round dimples (no faces)
  for (const [cx, cy] of [[4, 4], [11, 6], [6, 11], [13, 13]]) {
    pc.setRGB(cx, cy, pal[0]); pc.setRGB(cx + 1, cy, pal[0]); pc.setRGB(cx, cy + 1, pal[1]); pc.setRGB(cx + 1, cy + 1, pal[1]);
    pc.setRGB(cx, cy - 1, pal[4]);
  }
}
function paintQuartzOre(pc, seed) {
  paintNetherrack(pc, seed);
  const r = mulberry32(seed ^ 0x9e1);
  for (let i = 0; i < 6; i++) {
    const x = 1 + Math.floor(r() * 13), y = 1 + Math.floor(r() * 13);
    pc.setRGB(x, y, '#f4efe7'); pc.setRGB(x + 1, y, '#d8d0c4'); pc.setRGB(x, y + 1, '#e2dacf');
    if (r() < 0.5) pc.setRGB(x + 1, y + 1, '#ffffff');
  }
}
function paintNetherBricks(pc, seed) {
  const pal = P('#1e0c0e', '#2c1418', '#3a1a1e', '#4a2228', '#5a2a30');
  const mortar = rgb('#140808');
  each((x, y) => {
    const b = y >> 2, ry = y & 3;
    const off = (b & 1) * 4;
    if (ry === 3 || ((x + off) & 7) === 7) { pc.setRGB(x, y, mortar); return; }
    let t = 0.4 + (hash2(((x + off) & 15) >> 3, b, seed) - 0.5) * 0.4 + (hash2(x, y, seed + 1) - 0.5) * 0.25;
    if (ry === 0) t += 0.25;
    pc.setRGB(x, y, pick(pal, t));
  });
}
function paintPortal(pc, seed) {
  const pal = P('#3a0a7a', '#5212a8', '#6a1ed0', '#8a3cf0', '#b07cff', '#d8b8ff');
  each((x, y) => {
    const dx = x - 7.5, dy = y - 7.5;
    const a = Math.atan2(dy, dx), d = Math.hypot(dx, dy);
    const swirl = 0.5 + 0.5 * Math.sin(a * 2 + d * 0.9 + seed * 1e-9);
    const v = 0.55 * swirl + 0.3 * tnoise(x, y, 4, 4, seed) + 0.15 * hash2(x, y, seed + 1);
    pc.setRGB(x, y, pick(pal, v));
  });
}

/* ------------------------------------------------------------------ the table */
export const PALETTE = {
  birch_door_lower: (pc, c) => paintDoor(pc, c.seed, false, 'birch'),
  birch_door_upper: (pc, c) => paintDoor(pc, c.seed, true, 'birch'),
  spruce_door_lower: (pc, c) => paintDoor(pc, c.seed, false, 'spruce'),
  spruce_door_upper: (pc, c) => paintDoor(pc, c.seed, true, 'spruce'),
  oak_trapdoor: (pc, c) => paintTrapdoor(pc, c.seed, 'oak'),
  birch_trapdoor: (pc, c) => paintTrapdoor(pc, c.seed, 'birch'),
  spruce_trapdoor: (pc, c) => paintTrapdoor(pc, c.seed, 'spruce'),
  lantern: (pc) => paintLantern(pc),
  lantern_top: (pc) => paintLanternTop(pc),
  flower_pot: (pc, c) => paintPot(pc, c.seed),
  oak_sign: (pc, c) => paintSign(pc, c.seed),
  quartz_block: (pc, c) => paintQuartz(pc, c.seed),
  prismarine: (pc, c) => paintPrismarine(pc, c.seed),
  netherrack: (pc, c) => paintNetherrack(pc, c.seed),
  soul_sand: (pc, c) => paintSoulSand(pc, c.seed),
  nether_quartz_ore: (pc, c) => paintQuartzOre(pc, c.seed),
  nether_bricks: (pc, c) => paintNetherBricks(pc, c.seed),
  nether_portal: (pc, c) => paintPortal(pc, c.seed),
};
for (const c of COLORS) PALETTE['concrete_' + c] = (pc, ctx) => paintConcrete(pc, ctx.seed, COLOR_HEX[c]);
