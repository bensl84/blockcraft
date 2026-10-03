// OWNER LANE: CORE-A. Cutout textures: plants, flowers, saplings, crops, mushrooms, ladder, torch.
// Transparent background; textures.js runs PixelCanvas.bleed() afterwards (alpha 0/255, RGB bleeding).
// Torch convention for the CORE-C model (2x10x2 px box): the stick is at x 7-8, rows 6-15; rows 6-7 are the
// glowing tip (its top face samples x 7-8, rows 6-7).

import { hash2, shade, rgb } from './toolkit.js';
import { mulberry32 } from '../core/math.js';

const S = 16;
const P = (...hex) => hex.map(rgb);
const pick = (pal, t) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)))];

const GREENS = P('#2c5e1a', '#397224', '#47872e', '#58993a', '#6cad48', '#84c25c');
const LEAF = { g: '#3f7f28', G: '#2c5e1a', l: '#5ea83a', L: '#86c65a', s: '#4a8a2e' };

/** A single blade from the bottom: x0 base column, h height, lean = horizontal drift at the tip. */
function blade(pc, x0, h, lean, pal, y0 = 15, width = 1) {
  for (let i = 0; i < h; i++) {
    const f = i / Math.max(1, h - 1);
    const x = Math.round(x0 + lean * f * f);
    const y = y0 - i;
    const c = pick(pal, 0.1 + f * 0.9);
    pc.setRGB(x, y, c);
    if (width > 1 && f < 0.45) pc.setRGB(x + 1, y, shade(c, 0.85));
  }
}

function grid(pc, rows, pal) { pc.paintGrid(rows.map((r) => r.padEnd(16, '.')), pal); }

/** A flower: head grid (top rows) + stem + two leaves. */
function flower(pc, head, pal, opts = {}) {
  const stemTop = opts.stemTop ?? 8, sx = opts.stemX ?? 7;
  for (let y = stemTop; y < S; y++) pc.setRGB(sx, y, y > 12 ? LEAF.G : LEAF.g);
  // leaves
  const lv = opts.leaves ?? [[11, -1], [13, 1]];
  for (const [ly, dir] of lv) {
    pc.setRGB(sx + dir, ly, LEAF.l); pc.setRGB(sx + 2 * dir, ly - 1, LEAF.l); pc.setRGB(sx + 3 * dir, ly - 2, LEAF.L);
    pc.setRGB(sx + 2 * dir, ly, LEAF.s);
  }
  grid(pc, head, pal);
}

export const PLANTS = {
  short_grass: (pc, c) => {
    const r = mulberry32(c.seed);
    const xs = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 3, 9, 12, 6];
    xs.forEach((x, i) => blade(pc, x, 5 + Math.floor(r() * 8) - (i > 9 ? 2 : 0), (r() - 0.5) * 4, GREENS));
  },
  fern: (pc) => {
    const pal = P('#2a5a22', '#346a2a', '#3f7a32', '#4c8a3c', '#5c9a48');
    const frond = (x0, lean, h) => {
      for (let i = 0; i < h; i++) {
        const f = i / h;
        const x = Math.round(x0 + lean * f * f), y = 15 - i;
        pc.setRGB(x, y, pal[1]);
        if (i > 1 && i % 2 === 0) {
          const len = Math.max(1, Math.round((1 - f) * 3.2));
          for (let k = 1; k <= len; k++) { pc.setRGB(x - k, y - (k > 1 ? 1 : 0), pick(pal, 0.4 + f * 0.6)); pc.setRGB(x + k, y - (k > 1 ? 1 : 0), pick(pal, 0.3 + f * 0.6)); }
        }
      }
    };
    frond(7, 0, 13); frond(5, -4, 10); frond(10, 4, 10); frond(8, 2, 6);
  },
  dead_bush: (pc) => {
    const br = P('#5a3a18', '#6e4a22', '#83592c', '#996a36');
    grid(pc, [
      '................',
      '..b.........b...',
      '...b...b...b....',
      '.b..b..b..b..b..',
      '..b..b.b.b..b...',
      '...b..bbb..b....',
      '....b..b..b.....',
      '.....b.b.b......',
      '..b...bbb...b...',
      '...b...b...b....',
      '....bb.b.bb.....',
      '......bbb.......',
      '.......b........',
      '.......B........',
      '.......B........',
      '......BBB.......',
    ], { b: br[3], B: br[1] });
    for (const [x, y] of [[2, 1], [12, 1], [7, 2], [1, 3], [13, 3]]) pc.setRGB(x, y, br[2]);
  },
  dandelion: (pc) => flower(pc, [
    '................',
    '................',
    '................',
    '................',
    '......yyy.......',
    '.....yYYYy......',
    '....yYYoYYy.....',
    '.....yYYYy......',
    '......yyy.......',
  ], { y: '#e8b818', Y: '#ffe13a', o: '#f59a18' }, { stemTop: 9 }),
  poppy: (pc) => flower(pc, [
    '................',
    '................',
    '................',
    '......r.r.......',
    '....rrRrRrr.....',
    '...rRRRRRRRr....',
    '...rRRkkkRRr....',
    '...rRRkKkRRr....',
    '....rRRkRRr.....',
    '.....rrrrr......',
  ], { r: '#a8140e', R: '#e0261c', k: '#2a1a10', K: '#5a4a10' }, { stemTop: 10 }),
  cornflower: (pc) => flower(pc, [
    '................',
    '................',
    '................',
    '.....b...b......',
    '...b..bBb..b....',
    '....bBBBBBb.....',
    '...bBBBkBBBb....',
    '....bBBBBBb.....',
    '...b..bBb..b....',
    '.....b...b......',
  ], { b: '#2f50c8', B: '#5a7ef4', k: '#1a2a6a' }, { stemTop: 9 }),
  blue_orchid: (pc) => flower(pc, [
    '................',
    '................',
    '................',
    '.....cc..cc.....',
    '....cCCccCCc....',
    '....cCCppCCc....',
    '.....cCpPCc.....',
    '......cCCc......',
    '.......cc.......',
    '...cc...........',
    '..cCCc..........',
    '...cc...........',
  ], { c: '#1f8fb8', C: '#4ac4e8', p: '#c890d8', P: '#f0d0f8' }, { stemTop: 9, leaves: [[13, 1]] }),
  allium: (pc) => {
    for (let y = 7; y < S; y++) pc.setRGB(7, y, y > 12 ? LEAF.G : LEAF.g);
    for (const [x, y] of [[6, 13], [5, 12], [8, 14], [9, 13]]) pc.setRGB(x, y, LEAF.l);
    for (let y = 1; y <= 7; y++) for (let x = 4; x <= 10; x++) {
      const d = Math.hypot(x - 7, y - 4);
      if (d > 3.3) continue;
      const k = (x + y) & 1;
      pc.setRGB(x, y, d > 2.6 ? '#8a2a98' : k ? '#c055d0' : '#a43ab6');
    }
    for (const [x, y] of [[6, 2], [8, 3], [5, 4], [7, 5], [9, 5], [6, 6]]) pc.setRGB(x, y, '#ec9cf4');
  },
  lily_of_the_valley: (pc) => {
    grid(pc, [
      '................',
      '................',
      '.......gg.......',
      '......g..g......',
      '.....g....g.....',
      '....wg.....g....',
      '...wWw.....wg...',
      '...wWw....wWw...',
      '....w.....wWw...',
      '.....g.....w....',
      '..L...g.........',
      '..lL..g...Ll....',
      '...lL.g..Ll.....',
      '....lLg.Ll......',
      '.....llgl.......',
      '......lg........',
    ], { g: '#3f7f28', w: '#d8d4c8', W: '#ffffff', L: '#6cb848', l: '#3f8a2c' });
    pc.setRGB(8, 8, '#d8d4c8'); pc.setRGB(8, 9, '#ffffff'); pc.setRGB(7, 9, '#d8d4c8'); pc.setRGB(9, 9, '#d8d4c8');
  },
  orange_tulip: (pc) => flower(pc, tulipHead, { t: '#c85a10', T: '#f08a2a', h: '#ffc070' }, { stemTop: 9, leaves: [[12, -1], [14, 1]] }),
  pink_tulip: (pc) => flower(pc, tulipHead, { t: '#c86090', T: '#f29ac0', h: '#ffd8e8' }, { stemTop: 9, leaves: [[12, -1], [14, 1]] }),

  sugar_cane: (pc) => {
    const pal = P('#4c7a2a', '#6a9c3a', '#86b84c', '#a6d468', '#c8e890');
    for (const [x0, off] of [[2, 1], [7, 3], [12, 0]]) {
      for (let y = 0; y < S; y++) {
        const node = (y + off) % 5 === 0;
        pc.setRGB(x0, y, node ? pal[4] : pal[2]);
        pc.setRGB(x0 + 1, y, node ? pal[3] : pal[1]);
        if (node && y > 0) pc.setRGB(x0 - (off & 1 ? 1 : -2), y - 1, pal[2]);
      }
    }
    for (const [x, y] of [[4, 3], [5, 2], [9, 9], [10, 8], [1, 12], [0, 11], [14, 6], [15, 5]]) pc.setRGB(x, y, '#5a9a34');
  },

  oak_sapling: (pc) => sapling(pc, P('#2f6a1d', '#3b7d24', '#478f2c', '#55a035', '#66b241'), '#5c4629', '#7a6040', 'round'),
  birch_sapling: (pc) => sapling(pc, P('#4c7a2c', '#5b8c36', '#6a9c40', '#7aac4c', '#8cbd5a'), '#d8d5ca', '#2a2a26', 'round'),
  spruce_sapling: (pc) => sapling(pc, P('#1f3d29', '#28492f', '#315537', '#3c6342', '#4a7350'), '#3a2918', '#523c25', 'cone'),

  brown_mushroom: (pc) => grid(pc, [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....cCCCc......',
    '...cCCCCCCCc....',
    '..cCCHCCCCCCc...',
    '..dccccccccd....',
    '......sS........',
    '......sS........',
    '......sS........',
    '.....ssSS.......',
    '................',
  ], { c: '#8a6440', C: '#a87c54', H: '#c49a70', d: '#5e4026', s: '#e8dcc8', S: '#c8b89c' }),
  red_mushroom: (pc) => grid(pc, [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......rrrr......',
    '....rRRwRRrr....',
    '...rRwRRRRwRr...',
    '...rRRRRwRRRr...',
    '...rwRRRRRRwr...',
    '...dddddddddd...',
    '.......sS.......',
    '.......sS.......',
    '.......sS.......',
    '......ssSS......',
    '................',
  ], { r: '#a8140e', R: '#d8261c', w: '#f8f0e8', d: '#6a0c08', s: '#e8dcc8', S: '#c8b89c' }),

  ladder: (pc) => {
    const wood = P('#5c4024', '#7a5a32', '#94703e', '#a8844c');
    for (let y = 0; y < S; y++) {
      pc.setRGB(2, y, wood[3]); pc.setRGB(3, y, wood[1]);
      pc.setRGB(12, y, wood[3]); pc.setRGB(13, y, wood[1]);
    }
    for (const y of [1, 5, 9, 13]) for (let x = 2; x <= 13; x++) {
      pc.setRGB(x, y, x === 2 || x === 12 ? wood[3] : wood[2]);
      pc.setRGB(x, y + 1, wood[0]);
    }
    for (const y of [1, 5, 9, 13]) { pc.setRGB(3, y, '#3a3a3a'); pc.setRGB(12, y, '#3a3a3a'); }
  },
  torch: (pc) => {
    const stick = P('#4a3018', '#6a4a26', '#8a6436');
    for (let y = 8; y < S; y++) { pc.setRGB(7, y, stick[2]); pc.setRGB(8, y, stick[1]); }
    pc.setRGB(7, 15, stick[1]); pc.setRGB(8, 15, stick[0]);
    // glowing tip (rows 6-7) plus a small flame above for the flat icon
    pc.setRGB(7, 6, '#fff6c0'); pc.setRGB(8, 6, '#ffe070');
    pc.setRGB(7, 7, '#ffcc40'); pc.setRGB(8, 7, '#f08a1a');
    pc.setRGB(7, 5, '#ffd84a'); pc.setRGB(8, 5, '#ffb030'); pc.setRGB(8, 4, '#ff9a24'); pc.setRGB(7, 4, '#fff2a0');
    pc.setRGB(7, 3, '#ffb030');
  },
};

const tulipHead = [
  '................',
  '................',
  '................',
  '................',
  '.....t.t.t......',
  '.....tTtTt......',
  '.....tThTt......',
  '.....tTTTt......',
  '......tTt.......',
];

function sapling(pc, pal, trunk, trunkDark, kind) {
  for (let y = 9; y < S; y++) { pc.setRGB(7, y, trunk); pc.setRGB(8, y, trunkDark); }
  if (kind === 'round') {
    const blobs = [[7.5, 5, 3.6], [4.6, 8, 2.3], [10.4, 7.6, 2.3], [7.5, 9.5, 1.6]];
    for (let y = 0; y < 13; y++) for (let x = 1; x < 15; x++) {
      let inside = false, lt = 0;
      for (const [bx, by, br] of blobs) {
        const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by);
        if (d < br) { inside = true; lt = Math.max(lt, (-(x + 0.5 - bx) - (y + 0.5 - by)) / br); }
      }
      if (!inside) continue;
      if (hash2(x, y, 77) < 0.1) continue;
      pc.setRGB(x, y, pick(pal, 0.45 + lt * 0.4 + (hash2(x, y, 5) - 0.5) * 0.3));
    }
  } else {
    // tiered cone
    for (let y = 1; y < 13; y++) {
      const tier = (y - 1) % 4;
      const half = Math.min(6, 1 + Math.floor((y - 1) / 4) * 1.6 + tier * 0.9);
      for (let x = Math.round(7.5 - half); x <= Math.round(7.5 + half); x++) {
        const t = 0.35 + (x < 8 ? 0.3 : 0) - tier * 0.08 + (hash2(x, y, 9) - 0.5) * 0.3;
        pc.setRGB(x, y, pick(pal, t));
      }
    }
  }
}

/* ------------------------------------------------------------------ crops (# shaped planes) */
const STALK_X = [1, 3, 6, 8, 11, 13];
for (let s = 0; s < 8; s++) {
  PLANTS['wheat_' + s] = (pc) => {
    const ripe = s === 7;
    const greens = s < 4 ? GREENS : s < 6 ? P('#4a8a2a', '#6a9a2e', '#8aa832', '#a8b440', '#c0bc4c') : P('#8a7a20', '#a8902a', '#c4a83a', '#d8bc4a', '#e8d066');
    const h = 2 + Math.round(s * 1.6);
    STALK_X.forEach((x, i) => {
      const hh = Math.max(1, h - (i % 3) + (i === 2 ? 1 : 0));
      blade(pc, x, hh, (i % 2 ? 0.6 : -0.6) * (s / 7), greens);
      if (ripe || s >= 5) {
        // grain heads
        const top = 16 - hh;
        const gold = ripe ? P('#a8822a', '#d4a83a', '#f0cc5a') : P('#8a9a30', '#a4ac3a', '#bcbc48');
        for (let k = 0; k < (ripe ? 4 : 3); k++) {
          pc.setRGB(x + (i % 2 ? 1 : 0), top + k, gold[(k + 1) % 3]);
          pc.setRGB(x + (i % 2 ? 0 : 1), top + k + 1, gold[k % 3]);
        }
      }
    });
  };
}
for (let s = 0; s < 4; s++) {
  PLANTS['carrots_' + s] = (pc) => {
    const h = [3, 5, 8, 10][s];
    const pal = P('#2a6a1e', '#3a8228', '#4c9a34', '#62b244', '#7ac858');
    [2, 7, 12].forEach((x, i) => {
      for (const [dx, lean] of [[0, -2], [1, 2], [0, 0]]) blade(pc, x + dx, h - (dx ? 1 : 0) - (i === 1 ? 0 : 1), lean * (s / 3 + 0.3), pal);
      if (s >= 2) { pc.setRGB(x - 1, 15 - h + 3, pal[4]); pc.setRGB(x + 2, 15 - h + 4, pal[4]); }
      if (s === 3) { pc.setRGB(x, 15, '#f08a2a'); pc.setRGB(x + 1, 15, '#d0701a'); pc.setRGB(x, 14, '#ffa040'); }
    });
  };
  PLANTS['potatoes_' + s] = (pc) => {
    const h = [3, 5, 7, 9][s];
    const pal = P('#2f5e22', '#3c722a', '#4a8634', '#5a9a40', '#6cae4e');
    [2, 7, 12].forEach((x, i) => {
      blade(pc, x, h - (i === 1 ? 0 : 1), 0, pal);
      // round leaflets along the stem
      for (let y = 15 - h + 2; y < 14; y += 2) {
        pc.setRGB(x - 1, y, pal[3]); pc.setRGB(x + 1, y + 1, pal[2]);
        if (s >= 2) { pc.setRGB(x - 2, y, pal[2]); pc.setRGB(x + 2, y + 1, pal[4]); }
      }
      if (s === 3) {
        pc.setRGB(x, 15 - h, '#f0f0e0'); pc.setRGB(x, 15 - h - 1, '#f8e070');
        pc.setRGB(x - 1, 15, '#c8a060'); pc.setRGB(x, 15, '#a88048');
      }
    });
  };
}

export const PLANT_KEYS = Object.keys(PLANTS);
