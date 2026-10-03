// OWNER LANE: CORE-A. Building, functional and coloured block textures (original procedural pixel art).
// Painters: (pc: PixelCanvas, ctx: {key, seed, rng, fastLeaves, stoneSeed}) => void, deterministic.
//
// Partial-height models sample the BOTTOM rows of a side texture (u = block-local x, v = 1 - y, like a
// slab): bed sides use rows 7-15, cake sides rows 8-15, the chest (inset 1/16, 14/16 tall) x 1-14 rows 2-15.

import { hash2, tnoise, voronoiWrap, poissonSeeds, shade, mix, rgb } from './toolkit.js';
import { mulberry32 } from '../core/math.js';
import { COLORS, COLOR_HEX } from '../core/constants.js';
import { PAL, WOOD, paintPlanks } from './tex_terrain.js';

const S = 16;
const P = (...hex) => hex.map(rgb);
const pick = (pal, t) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)))];
const each = (fn) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x, y); };
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

/** Five-step ramp that also works for very dark and very light bases. */
export function softRamp(base, dark = 0.3, light = 0.22) {
  return [mix(base, BLACK, dark), mix(base, BLACK, dark / 2), rgb(base), mix(base, WHITE, light / 2), mix(base, WHITE, light)];
}

/** Bevelled frame on a 16x16 tile: top/left rows lighter, bottom/right darker. */
function bevelFrame(pc, hiK = 1.18, loK = 0.72, width = 1) {
  each((x, y) => {
    const c = pc.get(x, y);
    if (x < width || y < width) pc.setRGB(x, y, shade(c, hiK), c[3]);
    else if (x >= S - width || y >= S - width) pc.setRGB(x, y, shade(c, loK), c[3]);
  });
}

/* ------------------------------------------------------------------ glass */
function paintGlass(pc, frameHi, frameLo, glint, fillAlpha = 0, fill = null) {
  each((x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) {
      const lo = x === 15 || y === 15;
      pc.setRGB(x, y, lo ? frameLo : frameHi, 255);
    } else pc.setRGB(x, y, fill || frameHi, fillAlpha);
  });
  // corner studs
  for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]]) pc.setRGB(x, y, shade(frameLo, 0.85));
  // glints: two diagonal streaks, upper left, and a small one lower right
  for (const [x, y] of [[2, 5], [3, 4], [4, 3], [5, 2], [3, 6], [4, 5], [5, 4], [6, 3], [11, 13], [12, 12], [13, 11]]) pc.setRGB(x, y, glint, 255);
}

/* ------------------------------------------------------------------ painters */
export const BUILDING = {
  missing: (pc) => each((x, y) => pc.setRGB(x, y, ((x >> 3) ^ (y >> 3)) ? '#f81cf0' : '#101010')),

  glass: (pc) => paintGlass(pc, rgb('#e4f3f8'), rgb('#9fc3d2'), rgb('#ffffff')),

  bricks: (pc, c) => {
    const pal = P('#7e3424', '#8f3f2d', '#9d4936', '#ab5440', '#b8614c');
    const mortar = P('#a39a90', '#b4aba1', '#c2b9ae');
    each((x, y) => {
      const b = y >> 2, ry = y & 3;
      const off = (b & 1) * 4;
      const col = ((x + off) & 15) >> 3;
      if (ry === 3 || ((x + off) & 7) === 7) { pc.setRGB(x, y, pick(mortar, hash2(x, y, c.seed))); return; }
      const tone = hash2(col, b, c.seed + 1);
      let t = 0.25 + tone * 0.45 + (hash2(x, y, c.seed + 2) - 0.5) * 0.25;
      if (ry === 0) t += 0.2;
      if (ry === 2) t -= 0.2;
      pc.setRGB(x, y, pick(pal, t));
    });
  },

  stone_bricks: (pc, c) => paintStoneBricks(pc, c.seed, false),
  mossy_stone_bricks: (pc, c) => paintStoneBricks(pc, c.seed, true),

  bookshelf: (pc, c) => {
    paintPlanks(pc, c.seed, WOOD.oak.planks);
    const wood = WOOD.oak.planks;
    const books = P('#a8382a', '#2f5aa8', '#3f8a3a', '#7a4f2a', '#7a3f9a', '#2a8a86', '#c4a23a', '#d8cfa8', '#c0603a');
    const r = mulberry32(c.seed);
    for (const [top, bot] of [[2, 6], [9, 13]]) {
      for (let y = top; y <= bot; y++) for (let x = 1; x <= 14; x++) pc.setRGB(x, y, '#2e2014');
      let x = 1;
      while (x <= 14) {
        const w = Math.min(15 - x, r() < 0.55 ? 2 : 1);
        const h0 = top + (r() < 0.3 ? 1 + Math.floor(r() * 2) : 0);
        const col = books[Math.floor(r() * books.length)];
        const lean = r() < 0.08;
        if (!lean) {
          for (let yy = h0; yy <= bot; yy++) {
            pc.setRGB(x, yy, shade(col, 1.15));
            if (w === 2) pc.setRGB(x + 1, yy, shade(col, 0.82));
          }
          const band = h0 + 1 + Math.floor(r() * 2);
          if (band < bot && r() < 0.7) { pc.setRGB(x, band, shade(col, 1.45)); if (w === 2) pc.setRGB(x + 1, band, shade(col, 1.15)); }
        }
        x += w;
      }
      // shelf lip under the row
      for (let xx = 0; xx < S; xx++) pc.setRGB(xx, bot + 1, xx === 0 || xx === 15 ? wood[0] : wood[1]);
    }
    for (let y = 0; y < S; y++) { pc.setRGB(0, y, y === 7 || y === 14 ? wood[0] : wood[2]); pc.setRGB(15, y, wood[0]); }
    for (let x = 0; x < S; x++) { pc.setRGB(x, 0, wood[3]); pc.setRGB(x, 1, wood[2]); pc.setRGB(x, 8, wood[3]); pc.setRGB(x, 15, wood[0]); }
  },

  glowstone: (pc, c) => {
    const r = mulberry32(c.seed);
    const seeds = poissonSeeds(r, 11, 3.6);
    const pal = P('#7a5226', '#b97a2e', '#e4a83c', '#f7cf55', '#ffe684', '#fff6c4');
    each((x, y) => {
      const { d1, d2 } = voronoiWrap(x, y, seeds);
      if (d2 - d1 < 0.6) { pc.setRGB(x, y, pal[0]); return; }
      const t = 1 - d1 / 3.4 + (hash2(x, y, c.seed) - 0.5) * 0.3 - (d2 - d1 < 1.3 ? 0.25 : 0);
      pc.setRGB(x, y, pick(pal.slice(1), t));
    });
  },

  /* crafting table */
  crafting_table_top: (pc, c) => {
    paintPlanks(pc, c.seed, WOOD.oak.planks);
    const dark = rgb('#5a4024'), mid = rgb('#7a5a32');
    each((x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) pc.setRGB(x, y, dark);
      else if (x === 1 || y === 1) pc.setRGB(x, y, shade(pc.get(x, y), 1.12));
      else if (x === 14 || y === 14) pc.setRGB(x, y, mid);
      else if ((x === 5 || x === 10) || (y === 5 || y === 10)) pc.setRGB(x, y, mid);
    });
    // corner brackets in iron
    for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) pc.setRGB(x, y, '#9a9a9a');
  },
  crafting_table_side: (pc, c) => { craftingSide(pc, c, false); },
  crafting_table_front: (pc, c) => { craftingSide(pc, c, true); },

  /* furnace */
  furnace_side: (pc, c) => paintFurnaceBase(pc, c.seed),
  furnace_top: (pc, c) => {
    paintFurnaceBase(pc, c.seed);
    for (let i = 3; i <= 12; i++) { pc.setRGB(i, 3, '#5a5a5a'); pc.setRGB(i, 12, '#9a9a9a'); pc.setRGB(3, i, '#5a5a5a'); pc.setRGB(12, i, '#9a9a9a'); }
  },
  furnace_front: (pc, c) => paintFurnaceFront(pc, c.seed, false),
  furnace_front_lit: (pc, c) => paintFurnaceFront(pc, c.seed, true),

  /* chest */
  chest_top: (pc, c) => paintChest(pc, c.seed, 'top'),
  chest_side: (pc, c) => paintChest(pc, c.seed, 'side'),
  chest_front: (pc, c) => paintChest(pc, c.seed, 'front'),

  /* storage blocks */
  iron_block: (pc, c) => metalPlates(pc, c.seed, P('#9c9c9c', '#b8b8b8', '#cdcdcd', '#dedede', '#f0f0f0')),
  gold_block: (pc, c) => { metalPlates(pc, c.seed, P('#b88a14', '#dba91e', '#f2c932', '#fbdd55', '#fff08a')); shine(pc, '#fffbd0'); },
  diamond_block: (pc, c) => gemFacets(pc, c.seed, P('#1d8f8f', '#2fbdb8', '#4fe3dc', '#8af2ec', '#d8fffc')),
  emerald_block: (pc, c) => gemFacets(pc, c.seed, P('#0d6a32', '#139447', '#19c45c', '#4fe08a', '#b8ffd2')),
  lapis_block: (pc, c) => {
    const pal = P('#1e3f8e', '#2650aa', '#2d5bc4', '#3a6ad6', '#5a86e8');
    each((x, y) => pc.setRGB(x, y, pick(pal, 0.45 * tnoise(x, y, 4, 4, c.seed) + 0.55 * hash2(x, y, c.seed + 1))));
    const r = mulberry32(c.seed);
    for (let i = 0; i < 10; i++) pc.set(Math.floor(r() * S), Math.floor(r() * S), r() < 0.5 ? '#9ab8ff' : '#e8d070');
    bevelFrame(pc, 1.25, 0.7);
  },
  coal_block: (pc, c) => {
    const pal = P('#0c0c0c', '#141414', '#1c1c1c', '#242424', '#2e2e2e');
    each((x, y) => pc.setRGB(x, y, pick(pal, 0.5 * tnoise(x, y, 4, 4, c.seed) + 0.5 * hash2(x, y, c.seed + 1))));
    const r = mulberry32(c.seed);
    for (let i = 0; i < 9; i++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); pc.set(x, y, '#4a4a4a'); pc.set(x + 1, y + 1, '#060606'); }
    bevelFrame(pc, 1.9, 0.6);
  },
  redstone_block: (pc, c) => {
    const pal = P('#7e0e0e', '#981414', '#b01c1c', '#c82828', '#e04040');
    each((x, y) => pc.setRGB(x, y, pick(pal, 0.4 * tnoise(x, y, 4, 4, c.seed) + 0.6 * hash2(x, y, c.seed + 1))));
    // circuit-like dots
    for (let y = 2; y < S; y += 4) for (let x = 2; x < S; x += 4) { pc.setRGB(x, y, '#ff7a6a'); pc.setRGB(x + 1, y + 1, '#5a0808'); }
    bevelFrame(pc, 1.3, 0.65);
  },

  hay_block_side: (pc, c) => {
    const pal = P('#8f6e16', '#ad8a1c', '#c4a02a', '#d6b43a', '#e6c85a');
    each((x, y) => {
      const v = 0.6 * tnoise(x, y, 16, 2, c.seed) + 0.4 * hash2(x, y, c.seed + 1);
      pc.setRGB(x, y, pick(pal, v));
    });
    const band = P('#5a3412', '#7a4818', '#94602a');
    for (const y0 of [3, 11]) for (let x = 0; x < S; x++) {
      pc.setRGB(x, y0, band[2]); pc.setRGB(x, y0 + 1, band[1]);
      if (hash2(x, y0, c.seed) < 0.3) pc.setRGB(x, y0 + 1, band[0]);
    }
  },
  hay_block_top: (pc, c) => {
    const pal = P('#8f6e16', '#ad8a1c', '#c4a02a', '#d6b43a', '#e6c85a');
    each((x, y) => {
      let t = hash2(x, y, c.seed) * 0.7 + 0.15;
      if ((x + 2 * y) % 5 === 0) t += 0.3;
      if ((2 * x + y) % 7 === 0) t -= 0.3;
      pc.setRGB(x, y, pick(pal, t));
    });
    bevelFrame(pc, 1.1, 0.8);
  },

  tnt_side: (pc) => {
    const stick = P('#7e1a0e', '#c42e1a', '#e2482c', '#a82414');
    each((x, y) => pc.setRGB(x, y, stick[x & 3]));
    for (let x = 0; x < S; x++) { pc.setRGB(x, 0, shade(stick[x & 3], 0.8)); pc.setRGB(x, 15, shade(stick[x & 3], 0.7)); }
    // label band
    for (let y = 5; y <= 11; y++) for (let x = 0; x < S; x++) pc.setRGB(x, y, y === 5 || y === 11 ? '#2a1e18' : (y === 6 ? '#fbf4e2' : '#ece2c8'));
    const L = ['###.#...#.###', '.#..##..#..#.', '.#..#.#.#..#.', '.#..#..##..#.', '.#..#...#..#.'];
    for (let r = 0; r < 5; r++) for (let i = 0; i < 13; i++) if (L[r][i] === '#') pc.setRGB(1 + i, 6 + r, '#241812');
  },
  tnt_top: (pc) => tntEnds(pc, true),
  tnt_bottom: (pc) => tntEnds(pc, false),

  /* gourds */
  pumpkin_side: (pc, c) => paintPumpkinSide(pc, c.seed),
  pumpkin_top: (pc, c) => {
    const pal = P('#9a4c0e', '#bb620e', '#d27416', '#e48a22', '#efa038');
    each((x, y) => {
      const dx = x - 7.5, dy = y - 7.5;
      const a = Math.atan2(dy, dx);
      const rib = Math.cos(a * 8);
      let t = 0.55 + rib * 0.2 + (hash2(x, y, c.seed) - 0.5) * 0.2 - Math.hypot(dx, dy) * 0.012;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 7) t -= 0.25;
      pc.setRGB(x, y, pick(pal, t));
    });
    // stem
    for (const [x, y, col] of [[7, 6, '#7a9a2a'], [8, 6, '#5a7a1e'], [6, 7, '#5a7a1e'], [7, 7, '#6a8a22'], [8, 7, '#4a6a14'], [9, 7, '#3a5410'], [7, 8, '#4a6a14'], [8, 8, '#3a5410'], [7, 9, '#7a3c0a'], [8, 9, '#7a3c0a']]) pc.setRGB(x, y, col);
  },
  jack_o_lantern: (pc, c) => {
    paintPumpkinSide(pc, c.seed);
    const face = [
      '................',
      '................',
      '................',
      '...ooo....ooo...',
      '..oyyyo..oyyyo..',
      '..oyYyo..oyYyo..',
      '..oyyyo..oyyyo..',
      '...ooo....ooo...',
      '................',
      '..o..........o..',
      '..oyo......oyo..',
      '...oyyyyyyyyo...',
      '....oyYYYYyo....',
      '.....oooooo.....',
      '................',
      '................',
    ];
    pc.paintGrid(face, { o: '#7a3608', y: '#ffc23a', Y: '#fff2a0' });
  },
  melon_side: (pc, c) => {
    const pal = P('#3f6410', '#4f7a16', '#62921e', '#78a82a', '#90c03c');
    each((x, y) => {
      const w = Math.floor((tnoise(x, y, 1, 4, c.seed) - 0.5) * 2.2);
      const p = (x + w + 16) & 3;
      let t = [0.1, 0.45, 0.85, 0.5][p] + (hash2(x, y, c.seed + 1) - 0.5) * 0.25;
      pc.setRGB(x, y, pick(pal, t));
    });
  },
  melon_top: (pc, c) => {
    const pal = P('#3f6410', '#4f7a16', '#62921e', '#78a82a', '#90c03c');
    each((x, y) => {
      const dx = x - 7.5, dy = y - 7.5;
      const a = Math.atan2(dy, dx);
      let t = 0.5 + Math.cos(a * 6 + Math.hypot(dx, dy) * 0.3) * 0.3 + (hash2(x, y, c.seed) - 0.5) * 0.25;
      pc.setRGB(x, y, pick(pal, t));
    });
    pc.setRGB(7, 7, '#5a4a1a'); pc.setRGB(8, 8, '#3a2e10'); pc.setRGB(8, 7, '#4a3c14'); pc.setRGB(7, 8, '#4a3c14');
  },

  /* cactus */
  cactus_side: (pc, c) => {
    const pal = P('#1a4f16', '#226019', '#2a6e22', '#36822c', '#48983a');
    each((x, y) => {
      const p = x & 3;
      let t = [0.12, 0.45, 0.85, 0.5][p] + (hash2(x, y, c.seed) - 0.5) * 0.2;
      pc.setRGB(x, y, pick(pal, t));
    });
    for (let x = 2; x < S; x += 4) for (let y = (x >> 2) & 1 ? 1 : 3; y < S; y += 4) { pc.setRGB(x, y, '#e6f0b0'); pc.setRGB(x, y + 1, '#16400f'); }
  },
  cactus_top: (pc, c) => cactusEnd(pc, c.seed, 1),
  cactus_bottom: (pc, c) => cactusEnd(pc, c.seed, 0.75),

  /* cake */
  cake_top: (pc, c) => {
    const icing = P('#d8d0c4', '#e8e0d4', '#f4eee4', '#fdfaf4');
    each((x, y) => pc.setRGB(x, y, pick(icing, 0.35 + hash2(x, y, c.seed) * 0.65)));
    for (let i = 0; i < S; i++) { pc.setRGB(i, 0, icing[0]); pc.setRGB(0, i, icing[0]); pc.setRGB(i, 15, icing[0]); pc.setRGB(15, i, icing[0]); }
    for (let i = 1; i < 15; i++) { pc.setRGB(i, 1, '#f0b8c8'); pc.setRGB(1, i, '#f0b8c8'); pc.setRGB(i, 14, '#e8a0b4'); pc.setRGB(14, i, '#e8a0b4'); }
    for (const [x, y] of [[4, 4], [10, 3], [7, 8], [3, 10], [11, 11]]) {
      pc.setRGB(x, y, '#e8283a'); pc.setRGB(x + 1, y, '#b8141f'); pc.setRGB(x, y + 1, '#b8141f'); pc.setRGB(x + 1, y + 1, '#8a0c14'); pc.setRGB(x, y, '#ff7a84');
    }
  },
  cake_side: (pc, c) => cakeSide(pc, c.seed, false),
  cake_inner: (pc, c) => cakeSide(pc, c.seed, true),
  cake_bottom: (pc, c) => {
    const sponge = P('#a86a34', '#b87a40', '#c8884a');
    each((x, y) => pc.setRGB(x, y, pick(sponge, hash2(x, y, c.seed))));
  },

  /* farmland */
  farmland_dry: (pc, c) => farmland(pc, c.seed, P('#4a3220', '#583c26', '#67472d', '#775336', '#866040')),
  farmland_wet: (pc, c) => farmland(pc, c.seed, P('#26190f', '#302014', '#3b2819', '#47311f', '#533a25')),

  /* doors */
  oak_door_lower: (pc, c) => paintDoor(pc, c.seed, false),
  oak_door_upper: (pc, c) => paintDoor(pc, c.seed, true),

  /* bed parts shared by every colour */
  bed_side_head: (pc, c) => bedSide(pc, c.seed, 'side'),
  bed_side_foot: (pc, c) => bedSide(pc, c.seed, 'side'),
  bed_end_head: (pc, c) => bedSide(pc, c.seed, 'end'),
  bed_end_foot: (pc, c) => bedSide(pc, c.seed, 'end'),
  bed_bottom: (pc, c) => { paintPlanks(pc, c.seed, WOOD.oak.planks); each((x, y) => pc.setRGB(x, y, shade(pc.get(x, y), 0.8))); },
};

/* crack stages crack_0..9: SPEC §5.1 item 6 */
const CRACK_PATHS = (() => {
  const r = mulberry32(0xc7ac);
  const order = [];
  const paths = [];
  const starts = [[7, 7], [5, 9], [10, 6]];
  for (let p = 0; p < 3; p++) {
    let [x, y] = starts[p];
    let dir = r() * Math.PI * 2;
    const pts = [];
    const seen = new Set();
    while (pts.length < 20) {
      const k = ((x + 16) % 16) + ',' + ((y + 16) % 16);
      if (!seen.has(k)) { seen.add(k); pts.push([(x + 16) % 16, (y + 16) % 16]); }
      dir += (r() - 0.5) * 1.3;
      x += Math.round(Math.cos(dir)); y += Math.round(Math.sin(dir));
      if (r() < 0.12) { // branch jump back to an earlier point
        const b = pts[Math.floor(r() * pts.length)]; x = b[0]; y = b[1]; dir += Math.PI / 2;
      }
    }
    paths.push(pts);
  }
  for (let i = 0; i < 20; i++) for (let p = 0; p < 3; p++) order.push(paths[p][i]);
  return order; // 60 pixels, interleaved so every stage grows all three cracks
})();
for (let s = 0; s < 10; s++) {
  BUILDING['crack_' + s] = (pc) => {
    const n = Math.ceil((60 * (s + 1)) / 10);
    const core = new Set();
    for (let i = 0; i < n && i < CRACK_PATHS.length; i++) core.add(CRACK_PATHS[i][0] + CRACK_PATHS[i][1] * 16);
    for (const p of core) {
      const x = p & 15, y = p >> 4;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = ((x + dx + 16) & 15) + ((y + dy + 16) & 15) * 16;
        if (!core.has(q) && pc.get(q & 15, q >> 4)[3] === 0) pc.setRGB(q & 15, q >> 4, [0, 0, 0], 70);
      }
    }
    for (const p of core) pc.setRGB(p & 15, p >> 4, [0, 0, 0], 150);
  };
}

/* wool, stained glass, bed tops: one per colour */
COLORS.forEach((col, ci) => {
  const base = rgb(COLOR_HEX[col]);
  const ramp = softRamp(base, 0.3, 0.24);
  BUILDING['wool_' + col] = (pc, c) => paintWool(pc, c.seed, ramp);
  BUILDING['stained_glass_' + col] = (pc) => paintGlass(pc, mix(base, WHITE, 0.1), shade(base, 0.7), mix(base, WHITE, 0.6), 255, mix(base, WHITE, 0.18));
  BUILDING['bed_head_top_' + col] = (pc, c) => bedTop(pc, c.seed, ramp, true);
  BUILDING['bed_foot_top_' + col] = (pc, c) => bedTop(pc, c.seed, ramp, false);
  void ci;
});

/* ------------------------------------------------------------------ helpers */

function paintWool(pc, seed, ramp) {
  each((x, y) => {
    let t = 0.5 + (tnoise(x, y, 4, 4, seed) - 0.5) * 0.5 + (hash2(x, y, seed + 1) - 0.5) * 0.4;
    const k = (x + 2 * y) & 3; // soft diagonal weave
    if (k === 0) t += 0.17; else if (k === 2) t -= 0.17;
    pc.setRGB(x, y, pick(ramp.slice(0, 4), t));
  });
  const r = mulberry32(seed ^ 0x3001);
  for (let i = 0; i < 8; i++) pc.set(Math.floor(r() * S), Math.floor(r() * S), ramp[4]);
}

function paintStoneBricks(pc, seed, mossy) {
  const pal = P('#5f5f5f', '#6c6c6c', '#777777', '#818181', '#8c8c8c', '#9a9a9a');
  const mortar = rgb('#474747');
  each((x, y) => {
    const band = y >> 3, ry = y & 7;
    const seam = band === 0 ? 15 : 7;
    if (ry === 7 || x === seam) { pc.setRGB(x, y, mortar); return; }
    let t = 0.45 + (tnoise(x, y, 4, 8, seed) - 0.5) * 0.45 + (hash2(x, y, seed + 1) - 0.5) * 0.25;
    if (ry === 0 || x === (seam + 1) % 16) t += 0.3;
    if (ry === 6 || x === (seam + 15) % 16) t -= 0.3;
    pc.setRGB(x, y, pick(pal, t));
  });
  // a hairline crack
  const r = mulberry32(seed);
  let x = 3 + Math.floor(r() * 4), y = 9;
  for (let k = 0; k < 4; k++) { pc.setRGB(x, y, '#555555'); x += r() < 0.5 ? 1 : 0; y++; }
  if (mossy) {
    each((xx, yy) => {
      const m = 0.6 * tnoise(xx, yy, 4, 4, seed + 21) + 0.4 * hash2(xx, yy, seed + 22);
      const near = (yy & 7) <= 1 || (yy & 7) === 7;
      if (m > (near ? 0.5 : 0.64)) pc.setRGB(xx, yy, pick(PAL.moss, (m - 0.45) * 2 + (hash2(xx, yy, seed) - 0.5) * 0.4));
    });
  }
}

function craftingSide(pc, c, front) {
  paintPlanks(pc, c.seed, WOOD.oak.planks);
  const band = P('#4a3420', '#6a4c2c', '#8a6a3e');
  for (let x = 0; x < S; x++) { pc.setRGB(x, 0, band[2]); pc.setRGB(x, 1, band[1]); pc.setRGB(x, 2, band[0]); }
  // legs
  for (let y = 3; y < S; y++) { pc.setRGB(0, y, band[0]); pc.setRGB(15, y, band[0]); pc.setRGB(1, y, band[1]); pc.setRGB(14, y, band[1]); }
  const metal = { m: '#d0d0d0', M: '#8a8a8a', h: '#8a5e30', H: '#5a3a1a', d: '#3a3a3a', t: '#6a6a6a' };
  if (front) {
    // a hammer and a hanging saw on pegs
    pc.paintGrid([
      '................',
      '................',
      '................',
      '..MmmmM....HHH..',
      '..MmmmM....H.H..',
      '....h......HHH..',
      '....h......mmM..',
      '....h......mmMt.',
      '....h......mmM..',
      '....h......mmMt.',
      '....h......mmM..',
      '....H......mmMt.',
      '............mM..',
    ], metal);
  } else {
    // cross brace between the legs
    const w = WOOD.oak.planks;
    for (let i = 0; i < 12; i++) {
      pc.setRGB(2 + i, 3 + i, w[4]); pc.setRGB(3 + i, 3 + i, w[1]);
      pc.setRGB(13 - i, 3 + i, w[4]); pc.setRGB(12 - i, 3 + i, w[1]);
    }
  }
}

function paintFurnaceBase(pc, seed) {
  const pal = P('#5c5c5c', '#686868', '#747474', '#7f7f7f', '#8b8b8b');
  each((x, y) => pc.setRGB(x, y, pick(pal, 0.4 + (tnoise(x, y, 4, 4, seed) - 0.5) * 0.5 + (hash2(x, y, seed + 1) - 0.5) * 0.4)));
  each((x, y) => {
    if (x === 0 || y === 0) pc.setRGB(x, y, '#9e9e9e');
    else if (x === 15 || y === 15) pc.setRGB(x, y, '#4a4a4a');
  });
}

function paintFurnaceFront(pc, seed, lit) {
  paintFurnaceBase(pc, seed);
  // vents
  for (let x = 4; x <= 11; x += 2) { pc.setRGB(x, 3, '#2a2a2a'); pc.setRGB(x, 4, '#2a2a2a'); pc.setRGB(x + 1, 4, '#9a9a9a'); }
  // mouth
  for (let y = 7; y <= 13; y++) for (let x = 3; x <= 12; x++) {
    const rim = y === 7 || x === 3 || x === 12 || y === 13;
    if (rim) pc.setRGB(x, y, y === 13 || x === 12 ? '#a0a0a0' : '#3a3a3a');
    else if (!lit) pc.setRGB(x, y, y === 8 ? '#141414' : '#1e1e1e');
    else {
      const h = 9 + Math.floor(hash2(x, 0, seed) * 3);
      const col = y >= 12 ? '#fff2a0' : y >= 11 ? '#ffd23a' : y >= h ? '#ff8a1a' : y === h - 1 ? '#c8401a' : '#2a120a';
      pc.setRGB(x, y, col);
    }
  }
  if (!lit) for (let x = 4; x <= 11; x++) pc.setRGB(x, 12, x & 1 ? '#3a3a3a' : '#262626');
  // little feet ledge
  for (let x = 2; x <= 13; x++) pc.setRGB(x, 14, '#5a5a5a');
}

function paintChest(pc, seed, part) {
  const pal = P('#5c3a14', '#744a1c', '#8a5a24', '#9e6a2c', '#b27a36');
  const frame = rgb('#3a2408');
  each((x, y) => {
    const b = part === 'top' ? x >> 2 : y >> 2;
    let t = 0.5 + (tnoise(x, y, part === 'top' ? 8 : 2, part === 'top' ? 2 : 8, seed) - 0.5) * 0.5 + (hash2(x, y, seed + 1) - 0.5) * 0.25 + (b & 1 ? 0.08 : -0.04);
    pc.setRGB(x, y, pick(pal, t));
  });
  // frame at the model's visible border (x 1..14; sides rows 2..15)
  const top = part === 'top' ? 1 : 2;
  each((x, y) => {
    if (x <= 1 || x >= 14 || y <= top || y >= 14) pc.setRGB(x, y, (x <= 1 || y <= top) ? shade(frame, 1.25) : frame);
  });
  if (part !== 'top') {
    for (let x = 1; x <= 14; x++) { pc.setRGB(x, 7, frame); pc.setRGB(x, 8, pal[4]); }
  }
  if (part === 'front') {
    pc.paintGrid([
      '......mM........',
      '......Ml........',
      '......dk........',
      '......dd........',
    ].map((r) => r.padEnd(16, '.')), { m: '#e8e8e8', M: '#b8b8b8', l: '#9a9a9a', d: '#7a7a7a', k: '#2a2a2a' }, 1, 6);
  }
}

function metalPlates(pc, seed, pal) {
  each((x, y) => {
    const px = x & 7, py = y & 7;
    let t = 0.55 + (hash2(x, y, seed) - 0.5) * 0.15;
    if (px === 0 || py === 0) t = 0.95;
    else if (px === 7 || py === 7) t = 0.1;
    else if (px === 1 || py === 1) t += 0.15;
    else if (px === 6 || py === 6) t -= 0.15;
    pc.setRGB(x, y, pick(pal, t));
  });
  for (let y = 2; y < S; y += 8) for (let x = 2; x < S; x += 8) {
    pc.setRGB(x, y, pal[4]); pc.setRGB(x + 3, y + 3, pal[0]);
  }
}
function shine(pc, col) {
  for (const [x, y] of [[2, 4], [3, 3], [4, 2], [10, 4], [11, 3], [2, 12], [3, 11], [10, 12], [11, 11], [12, 10]]) pc.setRGB(x, y, col);
}
function gemFacets(pc, seed, pal) {
  each((x, y) => {
    const px = (x & 7) - 3.5, py = (y & 7) - 3.5;
    let t;
    if (Math.abs(px) + Math.abs(py) < 3) t = 0.9 - (px + py) * 0.05;
    else if (px < 0 && py < 0) t = 0.7;
    else if (px > 0 && py > 0) t = 0.2;
    else t = 0.45;
    if ((x & 7) === 7 || (y & 7) === 7) t = 0.02;
    pc.setRGB(x, y, pick(pal, t + (hash2(x, y, seed) - 0.5) * 0.08));
  });
  for (const [x, y] of [[2, 2], [10, 2], [2, 10], [10, 10]]) pc.setRGB(x, y, '#ffffff');
}

function tntEnds(pc, fuse) {
  const ring = P('#6a140a', '#b42818', '#d43a22');
  each((x, y) => {
    const cx = (x & 3) - 1.5, cy = (y & 3) - 1.5;
    const d = Math.max(Math.abs(cx), Math.abs(cy));
    pc.setRGB(x, y, d > 1 ? ring[0] : (cx + cy < 0 ? ring[2] : ring[1]));
  });
  for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x += 4) { pc.setRGB(x + 1, y + 1, '#e8d8b0'); pc.setRGB(x + 2, y + 2, '#a89870'); }
  if (fuse) {
    for (const [x, y, c] of [[7, 7, '#4a4a4a'], [8, 7, '#2a2a2a'], [7, 8, '#2a2a2a'], [8, 8, '#1a1a1a'], [6, 6, '#7a7a7a'], [9, 9, '#1a1a1a'], [8, 6, '#5a5a5a'], [6, 8, '#3a3a3a']]) pc.setRGB(x, y, c);
  }
}

function paintPumpkinSide(pc, seed) {
  const pal = P('#9a4a0c', '#b65e0e', '#cc7014', '#de8420', '#ec9a34');
  each((x, y) => {
    const p = (x + 1) & 3;
    let t = [0.08, 0.5, 0.88, 0.62][p] + (tnoise(x, y, 4, 4, seed) - 0.5) * 0.3 + (hash2(x, y, seed + 1) - 0.5) * 0.12;
    if (y === 0 || y === 15) t -= 0.25;
    pc.setRGB(x, y, pick(pal, t));
  });
}

function cactusEnd(pc, seed, k) {
  const pal = P('#1a4f16', '#2a6e22', '#3a8a30', '#5aaa48', '#84c86a').map((c) => shade(c, k));
  each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let t = d >= 7 ? 0.05 : d >= 6 ? 0.3 : (Math.floor(d) % 2 ? 0.5 : 0.7);
    if (d < 2) t = 0.95;
    pc.setRGB(x, y, pick(pal, t + (hash2(x, y, seed) - 0.5) * 0.12));
  });
  for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12], [7, 2], [2, 8], [13, 7], [8, 13]]) pc.setRGB(x, y, shade('#e6f0b0', k));
}

function cakeSide(pc, seed, inner) {
  const sponge = P('#c07a3e', '#d08c4c', '#dc9c5a', '#e6ac6a');
  const icing = P('#e8e0d4', '#f6f0e6', '#fffdf8');
  each((x, y) => {
    const ry = 8 + (y & 7); // rows 0-7 repeat rows 8-15
    let col;
    if (ry <= 9) col = pick(icing, hash2(x, ry, seed));
    else if (ry === 12) col = inner ? (hash2(x, ry, seed) < 0.8 ? '#c8283a' : '#e04050') : '#d8405a';
    else if (ry === 15) col = sponge[0];
    else col = pick(sponge, 0.3 + hash2(x, ry, seed + 1) * 0.7);
    if (inner && ry > 9 && ry !== 12 && hash2(x, ry, seed + 5) < 0.12) col = '#a86a34';
    pc.setRGB(x, y, col);
  });
  if (!inner) {
    // icing drips
    for (let x = 0; x < S; x++) {
      const d = hash2(x, 0, seed + 3);
      if (d < 0.35) { pc.setRGB(x, 2, icing[1]); pc.setRGB(x, 10, icing[1]); }
      if (d < 0.12) { pc.setRGB(x, 3, icing[0]); pc.setRGB(x, 11, icing[0]); }
    }
  }
}

function farmland(pc, seed, pal) {
  each((x, y) => {
    const ry = y & 3;
    let t = 0.45 + (hash2(x, y, seed) - 0.5) * 0.5 + (tnoise(x, y, 8, 4, seed + 1) - 0.5) * 0.3;
    if (ry === 0) t += 0.35;
    if (ry === 3) t -= 0.35;
    pc.setRGB(x, y, pick(pal, t));
  });
  bevelFrame(pc, 1.1, 0.8);
}

function paintDoor(pc, seed, upper) {
  const pal = P('#5e4428', '#7c5c36', '#946f42', '#a8814b', '#bc945c');
  each((x, y) => {
    let t = 0.55 + (tnoise(x, y, 16, 2, seed) - 0.5) * 0.4 + (hash2(x, y, seed + 1) - 0.5) * 0.2;
    pc.setRGB(x, y, pick(pal, t));
  });
  // stiles and rails
  each((x, y) => {
    if (x === 0 || x === 15) pc.setRGB(x, y, pal[0]);
    else if (x === 1) pc.setRGB(x, y, pal[4]);
    else if (x === 14) pc.setRGB(x, y, pal[1]);
  });
  const railRows = upper ? [0, 1, 7, 8, 14, 15] : [0, 1, 7, 8, 14, 15];
  for (const y of railRows) for (let x = 1; x < 15; x++) pc.setRGB(x, y, y === 15 || y === 8 ? pal[1] : y === 0 || y === 7 ? pal[4] : pal[3]);
  if (upper) {
    // four window panes (transparent) in two rows
    for (const [x0, y0] of [[3, 2], [9, 2], [3, 9], [9, 9]]) {
      for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) pc.setRGB(x, y, '#c9e6ef', 0);
      // window frame bevel
      for (let x = x0 - 1; x <= x0 + 4; x++) { pc.setRGB(x, y0 - 1, pal[1]); pc.setRGB(x, y0 + 4, pal[4]); }
      for (let y = y0 - 1; y <= y0 + 4; y++) { pc.setRGB(x0 - 1, y, pal[1]); pc.setRGB(x0 + 4, y, pal[4]); }
    }
  } else {
    // two raised panels
    for (const [y0, y1] of [[2, 6], [9, 13]]) for (let y = y0; y <= y1; y++) for (let x = 3; x <= 12; x++) {
      const c = y === y0 || x === 3 ? pal[4] : y === y1 || x === 12 ? pal[1] : pal[2];
      pc.setRGB(x, y, c);
    }
    // handle
    pc.setRGB(12, 1, '#4a4a4a'); pc.setRGB(13, 1, '#2a2a2a'); pc.setRGB(12, 0, '#8a8a8a');
  }
}

function bedTop(pc, seed, ramp, head) {
  each((x, y) => {
    let t = 0.45 + (hash2(x, y, seed) - 0.5) * 0.35 + (((x + 2 * y) & 3) === 0 ? 0.12 : 0);
    if (x === 0 || x === 15) t = 0.05;
    else if (x === 1) t += 0.25;
    pc.setRGB(x, y, pick(ramp, t));
  });
  if (head) {
    // pillow
    const pil = P('#c8c4bc', '#e2ded6', '#f2efe9', '#fdfcf9');
    for (let y = 1; y <= 6; y++) for (let x = 2; x <= 13; x++) {
      let c = pil[2];
      if (y === 1 || x === 2) c = pil[3];
      if (y === 6 || x === 13) c = pil[0];
      if ((x === 2 || x === 13) && (y === 1 || y === 6)) continue;
      pc.setRGB(x, y, c);
    }
    pc.setRGB(5, 3, pil[1]); pc.setRGB(10, 4, pil[1]);
    // turned-down sheet
    for (let x = 1; x < 15; x++) { pc.setRGB(x, 8, '#f2efe9'); pc.setRGB(x, 9, '#d8d4cc'); }
    for (let x = 1; x < 15; x++) pc.setRGB(x, 10, ramp[4]);
  } else {
    for (let x = 1; x < 15; x++) pc.setRGB(x, 15, ramp[0]);
  }
}

function bedSide(pc, seed, kind) {
  const wood = WOOD.oak.planks;
  const sheet = P('#cfcac0', '#e6e2da', '#f4f1eb');
  each((x, y) => {
    const ry = y < 7 ? y + 7 : y; // only rows 7-15 are visible on a 9/16 bed
    let c;
    if (ry <= 7) c = sheet[2];
    else if (ry <= 10) c = pick(sheet, 0.3 + hash2(x, ry, seed) * 0.7);
    else if (ry === 11) c = sheet[0];
    else if (ry <= 13) c = pick(wood.slice(1, 4), 0.3 + hash2(x, ry, seed + 1) * 0.6);
    else {
      const leg = x <= 2 || x >= 13;
      c = leg ? (x === 0 || x === 13 ? wood[3] : wood[1]) : (ry === 14 ? '#3a2a18' : '#24180c');
    }
    if (ry === 12) c = wood[3];
    pc.setRGB(x, y, c);
  });
  if (kind === 'end') for (let y = 0; y < S; y++) { pc.setRGB(0, y, wood[0]); pc.setRGB(15, y, wood[0]); }
}

export { paintGlass };
