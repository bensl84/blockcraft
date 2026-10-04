// OWNER LANE: CORE-A. Animated textures (water, lava, fire) and the alpha class of every texture key.
// An animated painter is (pc, ctx, frame, totalFrames) => void. Loops are seamless: every moving pattern
// shifts by whole pixels on a 16-px torus, so frame `total` equals frame 0 (also at halfAnim, which simply
// samples every second frame).

import { hash2, tnoise, rgb } from './toolkit.js';

const S = 16;
const P = (...hex) => hex.map(rgb);
const pick = (pal, t) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)))];

/** Keys whose alpha must be 0 or 255 (cutout pass). Crops (wheat_N, carrots_N, potatoes_N) are matched by pattern. */
export const CUTOUT_KEYS = new Set([
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'glass', 'oak_sapling', 'birch_sapling', 'spruce_sapling',
  'short_grass', 'fern', 'dead_bush', 'dandelion', 'poppy', 'cornflower', 'blue_orchid', 'allium', 'lily_of_the_valley',
  'orange_tulip', 'pink_tulip', 'sugar_cane', 'brown_mushroom', 'red_mushroom', 'ladder', 'torch',
  'oak_door_lower', 'oak_door_upper', 'fire',
]);

/** Translucent keys and their constant alpha (SPEC §5.1 item 4). Water's alpha is set by its painter. */
export const TRANSLUCENT_ALPHA = { ice: 190, nether_portal: 200 }; // nether_portal: LEAD v1.7 (judge FID-8)
for (const c of ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']) TRANSLUCENT_ALPHA['stained_glass_' + c] = 150;
export const WATER_ALPHA = 175;

// A narrow, low-contrast ramp: every water block shows the same frame, so strong per-texel contrast reads as
// a repeating block grid across lakes and oceans (review CORE-R6). Crests are soft and few.
const WATER = P('#3361d3', '#3867d7', '#3d6ddb', '#4374df', '#4a7be3', '#5687e8');
const LAVA = P('#7a1e06', '#a42c08', '#c8400a', '#e2580e', '#f27614', '#fc9a22', '#ffc444', '#ffe68a');
const FIRE = P('#b8300c', '#e2581a', '#f8862a', '#ffbc40', '#ffe680', '#fff8d0');

export const ANIMATED = {
  water(pc, c, f) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const a = tnoise(x + f, y, 4, 4, c.seed);
      const b = tnoise(x, y - f, 4, 8, c.seed + 1);
      const w = tnoise(x - f, y + f, 8, 8, c.seed + 2);
      const v = 0.42 * a + 0.38 * b + 0.2 * w;
      // soft ripple crests: a narrow, slightly lighter band where the two waves meet near a wave top; the waves
      // move every frame, so the crests wander instead of sitting on the same texels of every block
      const crest = Math.abs(a - b) < 0.035 && v > 0.56;
      let t = (v - 0.22) / 0.56;
      if (crest) t = Math.max(t, 0.9);
      pc.setRGB(x, y, pick(WATER, t), WATER_ALPHA);
    }
  },
  lava(pc, c, f) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const wx = Math.round((tnoise(x, y + f, 2, 4, c.seed + 3) - 0.5) * 6);
      const a = tnoise(x + wx, y + f, 4, 4, c.seed);
      const b = tnoise(x - f, y + wx, 8, 8, c.seed + 1);
      const v = 0.62 * a + 0.38 * b;
      let t = (v - 0.2) / 0.62;
      t += (hash2(x, y, c.seed + 2) - 0.5) * 0.08;
      pc.setRGB(x, y, pick(LAVA, t));
    }
  },
  fire(pc, c, f, total) {
    const step = 16 / total; // upward scroll per frame, whole pixels
    for (let x = 0; x < S; x++) {
      const h = 6 + 9 * tnoise(x, f * step, 8, 8, c.seed);
      for (let y = 0; y < S; y++) {
        const hb = 15 - y;
        const n = tnoise(x, y + f * step, 8, 8, c.seed + 1) * 0.65 + hash2(x, (y + f * step) & 15, c.seed + 2) * 0.35;
        const inten = 1 - hb / h;
        const v = inten * 1.15 + (n - 0.5) * 0.9;
        if (v < 0.22) { pc.setRGB(x, y, FIRE[1], 0); continue; }
        pc.setRGB(x, y, pick(FIRE, (v - 0.22) / 0.95), 255);
      }
    }
    pc.bleed(true);
  },
};
