// OWNER LANE: CORE-A. Terrain, stone family, ores, wood and leaves: original procedural 16x16 pixel art.
// Each painter is (pc: PixelCanvas, ctx: {key, seed, rng, fastLeaves}) => void and must be deterministic.
// Everything tiles: neighbourhood operations wrap (tnoise / voronoiWrap / poissonSeeds on the torus).

import { hash2, tnoise, tfbm, voronoiWrap, poissonSeeds, shade, mix, rgb, PixelCanvas } from './toolkit.js';
import { mulberry32 } from '../core/math.js';

const S = 16;
const P = (...hex) => hex.map(rgb);
/** Palette index for t in [0,1). */
const pick = (pal, t) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)))];
const each = (fn) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x, y); };
const wrapd = (a, b) => { let d = Math.abs(a - b); return Math.min(d, S - d); };

/* ------------------------------------------------------------------ palettes */
export const PAL = {
  stone: P('#626262', '#6f6f6f', '#7b7b7b', '#868686', '#939393'),
  cobble: P('#4c4c4c', '#5e5e5e', '#6f6f6f', '#7f7f7f', '#929292', '#a3a3a3'),
  dirt: P('#5b3d26', '#6b482d', '#7a5434', '#87603b', '#966c45'),
  grass: P('#457f28', '#518e30', '#5d9c38', '#69a941', '#76b64b', '#8ac65c'),
  sand: P('#cdb97f', '#d6c48c', '#ddcc96', '#e4d4a1', '#ebdcad'),
  sandstone: P('#bda76d', '#cbb67c', '#d6c389', '#dfcd95', '#e8d8a3'),
  gravel: P('#5e5853', '#6f6964', '#817a74', '#938c86', '#a59e97', '#7b6e66'),
  clay: P('#8f95a2', '#989eab', '#a2a8b5', '#abb1bd', '#b5bbc6'),
  snow: P('#dfe9f1', '#e9f1f7', '#f2f7fb', '#fbfdff'),
  ice: P('#86b0ea', '#93bcf1', '#a1c7f6', '#b3d3fa', '#d5e8ff'),
  obsidian: P('#0f0b17', '#160f22', '#1e152e', '#2c1f44', '#3e2c5e', '#5a4483'),
  bedrock: P('#2a2a2a', '#3c3c3c', '#525252', '#6a6a6a', '#888888'),
  granite: P('#7b5345', '#8b5f4f', '#9a6a5a', '#a97766', '#b98777', '#c79a8b'),
  diorite: P('#7e7e80', '#a3a3a5', '#bebebf', '#d0d0d1', '#e2e2e3', '#f1f1f1'),
  andesite: P('#6c6c6c', '#787878', '#838383', '#8e8e8e', '#9b9b9b', '#a9a9a9'),
  moss: P('#3f5f2a', '#4d7032', '#5b823a', '#6a9345'),
};

/* ------------------------------------------------------------------ base generators (shared) */

export function paintStone(pc, seed, pal = PAL.stone) {
  each((x, y) => {
    // soft horizontal strata + blotches: classic grey stone
    const v = 0.5 * tnoise(x, y, 4, 8, seed) + 0.3 * tnoise(x, y, 8, 16, seed + 7) + 0.2 * hash2(x, y, seed + 3);
    pc.setRGB(x, y, pick(pal, (v - 0.18) / 0.66));
  });
  // a few short dark streaks
  const r = mulberry32(seed ^ 0x5157);
  for (let i = 0; i < 5; i++) {
    const x0 = Math.floor(r() * S), y0 = Math.floor(r() * S), len = 2 + Math.floor(r() * 3);
    for (let k = 0; k < len; k++) pc.set(x0 + k, y0 + (k === len - 1 && r() < 0.5 ? 1 : 0), pal[0]);
  }
  // sparse highlight pixels
  for (let i = 0; i < 6; i++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); pc.set(x, y, pal[pal.length - 1]); }
}

/** Rounded stones with mortar gaps, lit from the top-left. */
export function paintCobble(pc, seed, pal = PAL.cobble, mortar = null, count = 8) {
  const r = mulberry32(seed);
  const seeds = poissonSeeds(r, count, 4.9);
  const tone = seeds.map(() => r());
  each((x, y) => {
    const { id, d1, d2 } = voronoiWrap(x, y, seeds);
    if (d2 - d1 < 0.95) { pc.setRGB(x, y, mortar || pal[0]); return; }
    let dx = x + 0.5 - seeds[id][0], dy = y + 0.5 - seeds[id][1];
    if (dx > 8) dx -= 16; if (dx < -8) dx += 16; if (dy > 8) dy -= 16; if (dy < -8) dy += 16;
    const edge = Math.min(1, (d2 - d1) / 3);
    const light = (-(dx + dy) / (Math.abs(dx) + Math.abs(dy) + 0.8)) * (1 - edge * 0.5);
    let t = 0.42 + tone[id] * 0.28 + light * 0.28 + (hash2(x, y, seed + 1) - 0.5) * 0.18;
    if (d2 - d1 < 1.7) t -= 0.18;
    pc.setRGB(x, y, pick(pal.slice(1), t));
  });
}

export function paintDirt(pc, seed, pal = PAL.dirt) {
  each((x, y) => {
    const v = 0.45 * tnoise(x, y, 4, 4, seed) + 0.25 * tnoise(x, y, 8, 8, seed + 1) + 0.3 * hash2(x, y, seed + 2);
    pc.setRGB(x, y, pick(pal, (v - 0.12) / 0.78));
  });
  const r = mulberry32(seed ^ 0xd127);
  // little clumps: a light pixel with a dark pixel under-right (reads as a pebble/crumb)
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S);
    pc.set(x, y, pal[4]); pc.set(x + 1, y + 1, pal[0]);
  }
  for (let i = 0; i < 3; i++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); pc.set(x, y, '#857a6e'); pc.set(x + 1, y, '#6a6056'); }
}

function paintGrassTop(pc, seed) {
  const pal = PAL.grass;
  each((x, y) => {
    const v = 0.4 * tnoise(x, y, 4, 4, seed) + 0.25 * tnoise(x, y, 8, 8, seed + 1) + 0.35 * hash2(x, y, seed + 2);
    pc.setRGB(x, y, pick(pal.slice(0, 5), (v - 0.1) / 0.8));
  });
  // grass tufts: bright tip over a darker root
  const r = mulberry32(seed ^ 0x6a11);
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S);
    pc.set(x, y, pal[5]); pc.set(x, y + 1, pal[1]);
  }
}

/* ------------------------------------------------------------------ ore clusters */
const NUGGETS = [
  ['.##.', '####', '.###'],
  ['##..', '###.', '.###', '..#.'],
  ['.##', '###', '##.'],
  ['.#..', '###.', '####', '.##.'],
  ['###', '##.', '.#.'],
  ['.##.', '###.', '.###'],
];
function paintOre(pc, seed, colors, stoneSeed) {
  paintStone(pc, stoneSeed);
  const [hi, mid, dark] = colors.map(rgb);
  const r = mulberry32(seed);
  const spots = poissonSeeds(r, 5, 5.6);
  spots.forEach((s, i) => {
    const shape = NUGGETS[(i + Math.floor(r() * NUGGETS.length)) % NUGGETS.length];
    const ox = Math.floor(s[0]), oy = Math.floor(s[1]);
    const inB = (x, y) => y >= 0 && y < shape.length && x >= 0 && x < shape[y].length && shape[y][x] === '#';
    // soft stone shadow down-right of the nugget
    for (let y = 0; y <= shape.length; y++) for (let x = 0; x <= 3; x++) {
      if (inB(x, y) || !(inB(x - 1, y) || inB(x, y - 1))) continue;
      pc.set(ox + x, oy + y, shade(pc.get(ox + x, oy + y), 0.72));
    }
    let first = true;
    for (let y = 0; y < shape.length; y++) for (let x = 0; x < shape[y].length; x++) {
      if (!inB(x, y)) continue;
      let c = mid;
      if (!inB(x + 1, y) && !inB(x, y + 1)) c = dark;
      else if (!inB(x, y + 1) || !inB(x + 1, y)) c = (x + y) % 2 ? dark : mid;
      if (first || (!inB(x - 1, y) && !inB(x, y - 1))) { c = hi; first = false; }
      pc.set(ox + x, oy + y, c);
    }
  });
}

/* ------------------------------------------------------------------ wood */
export const WOOD = {
  oak: { planks: P('#7d5f36', '#9a7746', '#a8834e', '#b48f59', '#c19c66'), bark: P('#4a3820', '#594429', '#685032', '#775d3b', '#886b46'), ring: P('#9a7746', '#ab8650', '#b8955e', '#c6a46c') },
  birch: { planks: P('#ab9963', '#c3b077', '#cebb83', '#d8c68e', '#e2d29c'), bark: P('#2a2a26', '#c8c4b8', '#d8d5ca', '#e6e3da', '#f2f0ea'), ring: P('#c3b077', '#d1be86', '#dccb93', '#e5d6a2') },
  spruce: { planks: P('#4c3520', '#5c4129', '#684b30', '#755538', '#836141'), bark: P('#24180c', '#2f2112', '#3a2918', '#45321e', '#523c25'), ring: P('#5c4129', '#6b4d31', '#795839', '#866443') },
};

function paintPlanks(pc, seed, pal) {
  const r = mulberry32(seed);
  const seams = [Math.floor(r() * 6) + 2, Math.floor(r() * 6) + 9, Math.floor(r() * 6) + 1, Math.floor(r() * 6) + 8];
  const boardTone = [0, 0.06, -0.04, 0.03].map((v) => v + (r() - 0.5) * 0.06);
  each((x, y) => {
    const b = y >> 2, ry = y & 3;
    // grain: long horizontal streaks
    const g = 0.6 * tnoise(x, y, 2, 16, seed + b) + 0.4 * hash2(x, y >> 0, seed + 9);
    let t = 0.5 + boardTone[b] + (g - 0.5) * 0.55;
    if (ry === 0) t += 0.12;
    if (ry === 3) { pc.setRGB(x, y, pal[0]); return; }
    if (x === seams[b]) { pc.setRGB(x, y, pal[0]); return; }
    if (x === (seams[b] + 1) % S) t += 0.15;
    pc.setRGB(x, y, pick(pal.slice(1), t));
  });
  // a few knots
  for (let i = 0; i < 2; i++) { const x = Math.floor(r() * S), y = (Math.floor(r() * 4) << 2) + 1 + Math.floor(r() * 2); pc.set(x, y, pal[1]); }
}

function paintLogSide(pc, seed, pal, birch = false) {
  if (birch) {
    each((x, y) => {
      const v = 0.6 * tnoise(x, y, 4, 2, seed) + 0.4 * hash2(x, y, seed + 1);
      pc.setRGB(x, y, pick(pal.slice(1), v));
    });
    // dark lenticel dashes, the unmistakable birch look
    const r = mulberry32(seed ^ 0xb1c);
    for (let i = 0; i < 9; i++) {
      const y = Math.floor(r() * S), x0 = Math.floor(r() * S), len = 2 + Math.floor(r() * 4);
      for (let k = 0; k < len; k++) pc.set(x0 + k, y, k === 0 || k === len - 1 ? '#57544c' : pal[0]);
      if (len > 3 && r() < 0.5) pc.set(x0 + 1, y + 1, '#8c887d');
    }
    return;
  }
  each((x, y) => {
    // vertical bark ridges
    const v = 0.55 * tnoise(x, y, 16, 2, seed) + 0.25 * tnoise(x, y, 8, 4, seed + 3) + 0.2 * hash2(x, y, seed + 1);
    pc.setRGB(x, y, pick(pal, (v - 0.15) / 0.7));
  });
  const r = mulberry32(seed ^ 0x1095);
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * S), y0 = Math.floor(r() * S), len = 3 + Math.floor(r() * 6);
    for (let k = 0; k < len; k++) pc.set(x, y0 + k, pal[0]);
    pc.set(x + 1, y0, pal[4]);
  }
}

function paintLogTop(pc, seed, ringPal, barkPal, birch = false) {
  each((x, y) => {
    const dx = x - 7.5, dy = y - 7.5;
    const cheb = Math.max(Math.abs(dx), Math.abs(dy));
    if (cheb >= 7) { // bark rim
      const v = hash2(x, y, seed);
      pc.setRGB(x, y, birch ? (v < 0.25 ? barkPal[0] : pick(barkPal.slice(2), v)) : pick(barkPal.slice(1, 4), v));
      return;
    }
    const rr = 0.55 * cheb + 0.45 * Math.hypot(dx, dy) * 0.92 + (tnoise(x, y, 4, 4, seed) - 0.5) * 1.1;
    const ring = Math.floor(rr / 1.5);
    let t = ring % 2 ? 0.2 : 0.65;
    t += (hash2(x, y, seed + 2) - 0.5) * 0.3;
    if (cheb >= 6) t = 0.1;
    pc.setRGB(x, y, pick(ringPal, t));
  });
  pc.set(7, 7, ringPal[0]); pc.set(8, 8, ringPal[0]);
}

function paintLeaves(pc, seed, pal, fast, style = 'round') {
  const r = mulberry32(seed);
  const clumps = poissonSeeds(r, 14, 3.2);
  each((x, y) => {
    const { id, d1, d2 } = voronoiWrap(x, y, clumps);
    let dx = x + 0.5 - clumps[id][0], dy = y + 0.5 - clumps[id][1];
    if (dx > 8) dx -= 16; if (dx < -8) dx += 16; if (dy > 8) dy -= 16; if (dy < -8) dy += 16;
    const light = -(dx + dy) / 5;
    let t = 0.5 + light * 0.4 + (hash2(x, y, seed + 1) - 0.5) * 0.5;
    if (style === 'needle') t = 0.45 + ((x + y * 2) % 5 === 0 ? 0.35 : 0) + (hash2(x, y, seed + 1) - 0.5) * 0.5 + light * 0.2;
    if (d2 - d1 < 0.8) t -= 0.35;
    const n = tnoise(x, y, 8, 8, seed + 6);
    const hole = (n < 0.42 && hash2(x, y, seed + 5) < 0.42) || hash2(x, y, seed + 4) < 0.05;
    if (hole) {
      if (fast) pc.setRGB(x, y, shade(pal[0], 0.7));
      else pc.setRGB(x, y, pal[0], 0);
    } else pc.setRGB(x, y, pick(pal, t));
  });
  if (!fast) pc.bleed();
}

/* ------------------------------------------------------------------ painters */
export const TERRAIN = {
  stone: (pc, c) => paintStone(pc, c.seed),
  cobblestone: (pc, c) => paintCobble(pc, c.seed),
  mossy_cobblestone: (pc, c) => {
    paintCobble(pc, c.seed);
    each((x, y) => {
      const m = 0.65 * tnoise(x, y, 4, 4, c.seed + 11) + 0.35 * hash2(x, y, c.seed + 12);
      const cur = pc.get(x, y);
      const isMortar = cur[0] < 80;
      if (m > 0.56 || (isMortar && m > 0.42)) pc.setRGB(x, y, pick(PAL.moss, (m - 0.4) * 1.9 + (hash2(x, y, c.seed) - 0.5) * 0.4));
    });
  },
  dirt: (pc, c) => paintDirt(pc, c.seed),
  grass_top: (pc, c) => paintGrassTop(pc, c.seed),
  grass_side: (pc, c) => {
    paintDirt(pc, c.seed);
    const pal = PAL.grass;
    for (let x = 0; x < S; x++) {
      // ragged green overhang: 3-5 px with occasional long drips
      let h = 3 + Math.floor(tnoise(x, 0, 8, 1, c.seed + 5) * 2.6);
      if (hash2(x, 0, c.seed + 6) < 0.18) h += 1;
      for (let y = 0; y < h; y++) {
        const t = 0.25 + hash2(x, y, c.seed + 7) * 0.55 - y * 0.05;
        pc.setRGB(x, y, pick(pal.slice(0, 5), t));
      }
      pc.setRGB(x, h, shade(pal[0], 0.82));
    }
  },
  grass_side_snowy: (pc, c) => {
    paintDirt(pc, c.seed);
    const pal = PAL.snow;
    for (let x = 0; x < S; x++) {
      let h = 3 + Math.floor(tnoise(x, 0, 8, 1, c.seed + 5) * 2.4);
      for (let y = 0; y < h; y++) pc.setRGB(x, y, pick(pal, 0.4 + hash2(x, y, c.seed) * 0.6));
      pc.setRGB(x, h, '#c6d2dc');
    }
  },
  sand: (pc, c) => each((x, y) => {
    const v = 0.35 * tnoise(x, y, 4, 4, c.seed) + 0.65 * hash2(x, y, c.seed + 1);
    pc.setRGB(x, y, pick(PAL.sand, v));
  }),
  sandstone_top: (pc, c) => each((x, y) => {
    const v = 0.5 * tnoise(x, y, 4, 4, c.seed) + 0.5 * hash2(x, y, c.seed + 1);
    pc.setRGB(x, y, pick(PAL.sandstone.slice(1), v));
  }),
  sandstone_bottom: (pc, c) => {
    each((x, y) => {
      const v = 0.5 * tnoise(x, y, 4, 4, c.seed) + 0.5 * hash2(x, y, c.seed + 1);
      pc.setRGB(x, y, pick(PAL.sandstone.slice(0, 4), v));
    });
    const r = mulberry32(c.seed);
    for (let i = 0; i < 3; i++) { let x = Math.floor(r() * S), y = Math.floor(r() * S); for (let k = 0; k < 4; k++) { pc.set(x, y, PAL.sandstone[0]); x += r() < 0.5 ? 1 : 0; y += 1; } }
  },
  sandstone_side: (pc, c) => {
    const pal = PAL.sandstone;
    each((x, y) => {
      let t = 0.35 + hash2(x, y, c.seed) * 0.4 + (tnoise(x, y, 2, 8, c.seed + 1) - 0.5) * 0.4;
      if (y <= 2) t += 0.35; // smooth cap
      if (y === 3) t = 0.05;
      if (y === 15) t = 0.05;
      if ((y === 8 || y === 11) && hash2(x, y, c.seed + 2) < 0.7) t -= 0.25;
      pc.setRGB(x, y, pick(pal, t));
    });
  },
  gravel: (pc, c) => {
    const r = mulberry32(c.seed);
    const seeds = poissonSeeds(r, 26, 2.4);
    const tone = seeds.map(() => r());
    each((x, y) => {
      const { id, d1, d2 } = voronoiWrap(x, y, seeds);
      if (d2 - d1 < 0.55) { pc.setRGB(x, y, PAL.gravel[0]); return; }
      const t = tone[id] * 0.85 + 0.15 - (d1 > 1.2 ? 0.12 : 0) + (hash2(x, y, c.seed) - 0.5) * 0.15;
      pc.setRGB(x, y, tone[id] > 0.86 ? PAL.gravel[5] : pick(PAL.gravel.slice(1, 5), t));
    });
  },
  clay: (pc, c) => {
    each((x, y) => pc.setRGB(x, y, pick(PAL.clay, 0.3 + 0.4 * tnoise(x, y, 4, 4, c.seed) + 0.3 * hash2(x, y, c.seed + 1) - 0.15)));
    const r = mulberry32(c.seed);
    for (let i = 0; i < 6; i++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); pc.set(x, y, PAL.clay[0]); pc.set(x + 1, y, PAL.clay[1]); }
  },
  snow: (pc, c) => each((x, y) => {
    const v = 0.4 * tnoise(x, y, 4, 4, c.seed) + 0.6 * hash2(x, y, c.seed + 1);
    pc.setRGB(x, y, v < 0.1 ? '#d2e0ec' : pick(PAL.snow, v));
  }),
  ice: (pc, c) => {
    each((x, y) => pc.setRGB(x, y, pick(PAL.ice.slice(0, 4), 0.5 * tnoise(x, y, 2, 4, c.seed) + 0.5 * hash2(x, y, c.seed + 1)), 190));
    // white diagonal glints
    const r = mulberry32(c.seed);
    for (let i = 0; i < 4; i++) {
      const x0 = Math.floor(r() * S), y0 = Math.floor(r() * S), len = 2 + Math.floor(r() * 4);
      for (let k = 0; k < len; k++) pc.set(x0 + k, y0 - k, PAL.ice[4], 190);
    }
  },
  obsidian: (pc, c) => {
    each((x, y) => {
      const v = 0.55 * tnoise(x, y, 4, 4, c.seed) + 0.45 * hash2(x, y, c.seed + 1);
      pc.setRGB(x, y, pick(PAL.obsidian.slice(0, 4), v));
    });
    const r = mulberry32(c.seed);
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(r() * S), y = Math.floor(r() * S);
      pc.set(x, y, PAL.obsidian[4]); if (r() < 0.6) pc.set(x + 1, y, PAL.obsidian[3]); if (r() < 0.4) pc.set(x, y - 1, PAL.obsidian[5]);
    }
  },
  bedrock: (pc, c) => {
    const r = mulberry32(c.seed);
    const seeds = poissonSeeds(r, 16, 3);
    const tone = seeds.map(() => r());
    each((x, y) => {
      const { id, d1 } = voronoiWrap(x, y, seeds);
      const t = tone[id] * 0.8 + (hash2(x, y, c.seed) - 0.5) * 0.35 - d1 * 0.05;
      pc.setRGB(x, y, pick(PAL.bedrock, t + 0.1));
    });
  },
  granite: (pc, c) => each((x, y) => {
    const v = 0.35 * tnoise(x, y, 8, 8, c.seed) + 0.65 * hash2(x, y, c.seed + 1);
    pc.setRGB(x, y, pick(PAL.granite, v * 1.08 - 0.04));
  }),
  diorite: (pc, c) => each((x, y) => {
    const v = 0.4 * tnoise(x, y, 8, 8, c.seed) + 0.6 * hash2(x, y, c.seed + 1);
    pc.setRGB(x, y, pick(PAL.diorite, v < 0.14 ? 0 : v < 0.24 ? 0.2 : 0.35 + (v - 0.24) * 0.85));
  }),
  andesite: (pc, c) => each((x, y) => {
    const v = 0.55 * tnoise(x, y, 4, 8, c.seed) + 0.45 * hash2(x, y, c.seed + 1);
    pc.setRGB(x, y, pick(PAL.andesite, (v - 0.15) / 0.7));
  }),

  /* ores (stone base shared with the stone block so ores sit flush in walls) */
  coal_ore: (pc, c) => paintOre(pc, c.seed, ['#4a4a4a', '#262626', '#141414'], c.stoneSeed),
  iron_ore: (pc, c) => paintOre(pc, c.seed, ['#f3d2b6', '#d8a888', '#a77a5c'], c.stoneSeed),
  gold_ore: (pc, c) => paintOre(pc, c.seed, ['#fffaa0', '#f7d53a', '#c59617'], c.stoneSeed),
  diamond_ore: (pc, c) => paintOre(pc, c.seed, ['#e2fffd', '#5cecec', '#1fa8b4'], c.stoneSeed),
  redstone_ore: (pc, c) => paintOre(pc, c.seed, ['#ff8a7a', '#e5221b', '#9a0d0d'], c.stoneSeed),
  lapis_ore: (pc, c) => paintOre(pc, c.seed, ['#7aa7ff', '#2c5fd0', '#183a8e'], c.stoneSeed),
  emerald_ore: (pc, c) => paintOre(pc, c.seed, ['#b8ffd0', '#2fd46c', '#137c3c'], c.stoneSeed),

  /* woods */
  oak_planks: (pc, c) => paintPlanks(pc, c.seed, WOOD.oak.planks),
  birch_planks: (pc, c) => paintPlanks(pc, c.seed, WOOD.birch.planks),
  spruce_planks: (pc, c) => paintPlanks(pc, c.seed, WOOD.spruce.planks),
  oak_log: (pc, c) => paintLogSide(pc, c.seed, WOOD.oak.bark),
  birch_log: (pc, c) => paintLogSide(pc, c.seed, WOOD.birch.bark, true),
  spruce_log: (pc, c) => paintLogSide(pc, c.seed, WOOD.spruce.bark),
  oak_log_top: (pc, c) => paintLogTop(pc, c.seed, WOOD.oak.ring, WOOD.oak.bark),
  birch_log_top: (pc, c) => paintLogTop(pc, c.seed, WOOD.birch.ring, WOOD.birch.bark, true),
  spruce_log_top: (pc, c) => paintLogTop(pc, c.seed, WOOD.spruce.ring, WOOD.spruce.bark),
  oak_leaves: (pc, c) => paintLeaves(pc, c.seed, P('#2f6a1d', '#3b7d24', '#478f2c', '#55a035', '#66b241'), c.fastLeaves),
  birch_leaves: (pc, c) => paintLeaves(pc, c.seed, P('#4c7a2c', '#5b8c36', '#6a9c40', '#7aac4c', '#8cbd5a'), c.fastLeaves),
  spruce_leaves: (pc, c) => paintLeaves(pc, c.seed, P('#1f3d29', '#28492f', '#315537', '#3c6342', '#4a7350'), c.fastLeaves, 'needle'),
};

export { paintPlanks, paintLeaves, PixelCanvas, mix };
