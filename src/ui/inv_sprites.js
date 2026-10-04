// OWNER LANE: FEATURE-INV. Original procedural pixel sprites for the HUD and container screens (hearts, hunger,
// air, armour, furnace flame and arrow, backpack, trash, recipe book, close). Drawn once with fillRect on a
// canvas (no anti-aliasing), exposed as data: URLs and shown with image-rendering: pixelated at integer scale.
//
// Mask letters map to palette colours per sprite; '.' is transparent.

const cache = new Map();

/** Sprite definitions: rows of letters + palette. All designs are original. */
const DEFS = {
  heart_full: {
    rows: ['.KKK.KKK.', 'KRRRKRRRK', 'KRWRRRRRK', 'KRRRRRRRK', 'KDRRRRRDK', '.KDRRRDK.', '..KDRDK..', '...KDK...', '....K....'],
    pal: { K: '#2b0a0a', R: '#e8312c', W: '#ffb4a8', D: '#a81c1c' },
  },
  heart_half: {
    rows: ['.KKK.KKK.', 'KRRRKEEEK', 'KRWREEEEK', 'KRRREEEEK', 'KDRREEEEK', '.KDREEEK.', '..KDEEK..', '...KEK...', '....K....'],
    pal: { K: '#2b0a0a', R: '#e8312c', W: '#ffb4a8', D: '#a81c1c', E: '#4a1c1c' },
  },
  heart_empty: {
    rows: ['.KKK.KKK.', 'KEEEKEEEK', 'KEEEEEEEK', 'KEEEEEEEK', 'KEEEEEEEK', '.KEEEEEK.', '..KEEEK..', '...KEK...', '....K....'],
    pal: { K: '#2b0a0a', E: '#4a1c1c' },
  },
  // damage flash: only the outline turns white; full / half hearts keep their red (the bar never looks emptied)
  heart_flash: {
    rows: ['.WWW.WWW.', 'WEEEWEEEW', 'WEEEEEEEW', 'WEEEEEEEW', 'WEEEEEEEW', '.WEEEEEW.', '..WEEEW..', '...WEW...', '....W....'],
    pal: { W: '#ffffff', E: '#4a1c1c' },
  },
  heart_full_flash: {
    rows: ['.WWW.WWW.', 'WRRRWRRRW', 'WRHRRRRRW', 'WRRRRRRRW', 'WDRRRRRDW', '.WDRRRDW.', '..WDRDW..', '...WDW...', '....W....'],
    pal: { W: '#ffffff', R: '#e8312c', H: '#ffb4a8', D: '#a81c1c' },
  },
  heart_half_flash: {
    rows: ['.WWW.WWW.', 'WRRRWEEEW', 'WRHREEEEW', 'WRRREEEEW', 'WDRREEEEW', '.WDREEEW.', '..WDEEW..', '...WEW...', '....W....'],
    pal: { W: '#ffffff', R: '#e8312c', H: '#ffb4a8', D: '#a81c1c', E: '#4a1c1c' },
  },
  food_full: {
    rows: ['.....KKK.', '....KMMMK', '...KMMHMK', '...KMMMMK', '..KMMMMK.', '.KBKKKK..', 'KBBK.....', 'KWBK.....', '.KK......'],
    pal: { K: '#3a1a08', M: '#b8642c', H: '#eaa868', B: '#efe6d2', W: '#ffffff' },
  },
  food_half: {
    rows: ['.....KKK.', '....KEEEK', '...KEEEEK', '...KMEEEK', '..KMMEEK.', '.KBKKKK..', 'KBBK.....', 'KWBK.....', '.KK......'],
    pal: { K: '#3a1a08', M: '#b8642c', E: '#3e2a1c', B: '#efe6d2', W: '#ffffff' },
  },
  food_empty: {
    rows: ['.....KKK.', '....KEEEK', '...KEEEEK', '...KEEEEK', '..KEEEEK.', '.KEKKKK..', 'KEEK.....', 'KEEK.....', '.KK......'],
    pal: { K: '#3a1a08', E: '#3e2a1c' },
  },
  bubble: {
    rows: ['..KKKK...', '.KLLLLK..', 'KLWWLLLK.', 'KLWLLLLK.', 'KLLLLLLK.', 'KLLLLLDK.', '.KLLLDK..', '..KKKK...', '.........'],
    pal: { K: '#1d3f8a', L: '#7ec4ff', W: '#ffffff', D: '#4a88d8' },
  },
  armor_full: {
    rows: ['.KK...KK.', 'KLLK.KLLK', 'KLWLKLLLK', 'KLLLLLLLK', '.KLLLLLK.', '.KLLLLLK.', '.KLLDLLK.', '.KLLLLLK.', '..KKKKK..'],
    pal: { K: '#2a2a2a', L: '#d8d8d8', W: '#ffffff', D: '#9a9a9a' },
  },
  armor_half: {
    rows: ['.KK...KK.', 'KLLK.KEEK', 'KLWLKEEEK', 'KLLLEEEEK', '.KLLEEEK.', '.KLLEEEK.', '.KLLEEEK.', '.KLLEEEK.', '..KKKKK..'],
    pal: { K: '#2a2a2a', L: '#d8d8d8', W: '#ffffff', E: '#555555' },
  },
  armor_empty: {
    rows: ['.KK...KK.', 'KEEK.KEEK', 'KEEEKEEEK', 'KEEEEEEEK', '.KEEEEEK.', '.KEEEEEK.', '.KEEEEEK.', '.KEEEEEK.', '..KKKKK..'],
    pal: { K: '#2a2a2a', E: '#555555' },
  },
  // furnace flame 14x14 (lit) and its dark background version
  flame_on: {
    rows: ['......Y.......', '.....YY.......', '.....YOY......', '....YOOY...Y..', '....YOOOY.YY..', '...YOORROYYOY.',
      '...YORRROYOOY.', '..YOORRRROORY.', '..YORRWRRRROY.', '.YORRWWWRRRROY', '.YORWWWWWRRROY', '.YORRWWWWRRROY', '..YORRWWRRROY.', '...YYOOOOOYY..'],
    pal: { Y: '#ffd23a', O: '#ff9a1a', R: '#e8461c', W: '#fff4b0' },
  },
  flame_off: {
    rows: ['......G.......', '.....GG.......', '.....GGG......', '....GGGG...G..', '....GGGGG.GG..', '...GGGGGGGGGG.',
      '...GGGGGGGGGG.', '..GGGGGGGGGGG.', '..GGGGGGGGGGG.', '.GGGGGGGGGGGGG', '.GGGGGGGGGGGGG', '.GGGGGGGGGGGGG', '..GGGGGGGGGGG.', '...GGGGGGGGG..'],
    pal: { G: '#8b8b8b' },
  },
  // progress arrow 22x15: empty (grey) and full (white)
  arrow_off: { rows: arrowRows('G'), pal: { G: '#8b8b8b', K: '#5a5a5a' } },
  arrow_on: { rows: arrowRows('W'), pal: { W: '#ffffff', K: '#d0d0d0' } },
  // 16x16 button glyphs
  backpack: {
    rows: ['.....KKKKKK.....', '....KBBBBBBK....', '...KBK....KBK...', '..KKKKKKKKKKKK..', '.KBBBBBBBBBBBBK.', '.KBHHBBBBBBHHBK.',
      '.KBBBBBBBBBBBBK.', '.KKKKKYYYYKKKKK.', '.KBBBBYKKYBBBBK.', '.KBBBBYYYYBBBBK.', '.KBBBBBBBBBBBBK.', '.KBDDDDDDDDDDBK.',
      '.KBBBBBBBBBBBBK.', '.KDDDDDDDDDDDDK.', '..KKKKKKKKKKKK..', '................'],
    pal: { K: '#2a1606', B: '#b8742e', H: '#e6a85a', D: '#7a4818', Y: '#ffd400' },
  },
  trash: {
    rows: ['......KKKK......', '.....KLLLLK.....', '.KKKKKKKKKKKKKK.', '.KLLLLLLLLLLLLK.', '.KKKKKKKKKKKKKK.', '..KGGGGGGGGGGK..',
      '..KGDGGDGGDGGK..', '..KGDGGDGGDGGK..', '..KGDGGDGGDGGK..', '..KGDGGDGGDGGK..', '..KGDGGDGGDGGK..', '..KGDGGDGGDGGK..',
      '..KGDGGDGGDGGK..', '..KGGGGGGGGGGK..', '...KKKKKKKKKK...', '................'],
    pal: { K: '#1e1e1e', L: '#c8c8c8', G: '#9a9a9a', D: '#5e5e5e' },
  },
  book: {
    rows: ['................', '..KKKKKKKKKKKK..', '.KGGGGGGGGGGGGK.', '.KGHHGGGGGGGGPK.', '.KGGGGGGGGGGGPK.', '.KGGGYYYYGGGGPK.',
      '.KGGGYGGYGGGGPK.', '.KGGGYYYYGGGGPK.', '.KGGGGGGGGGGGPK.', '.KGGGGGGGGGGGPK.', '.KGGGGGGGGGGGPK.', '.KGGGGGGGGGGGPK.',
      '.KDDDDDDDDDDDPK.', '.KKKKKKKKKKKKKK.', '................', '................'],
    pal: { K: '#14300e', G: '#3e8a2a', H: '#7cc85a', D: '#2a5e1c', P: '#f4ecd6', Y: '#ffd400' },
  },
  close: {
    rows: ['................', '.KKK........KKK.', '.KWWK......KWWK.', '.KWWWK....KWWWK.', '..KWWWK..KWWWK..', '...KWWWKKWWWK...',
      '....KWWWWWWK....', '.....KWWWWK.....', '.....KWWWWK.....', '....KWWWWWWK....', '...KWWWKKWWWK...', '..KWWWK..KWWWK..',
      '.KWWWK....KWWWK.', '.KWWK......KWWK.', '.KKK........KKK.', '................'],
    pal: { K: '#3a0a0a', W: '#ffffff' },
  },
  // tiny crafting-table badge (8x8) for recipes that need the 3x3 table
  table_badge: {
    rows: ['KKKKKKKK', 'KTTTTTTK', 'KTKTTKTK', 'KWWWWWWK', 'KWKWWKWK', 'KWWWWWWK', 'KWKWWKWK', 'KKKKKKKK'],
    pal: { K: '#2a1606', T: '#c08a4a', W: '#8a5a2a' },
  },
};

function arrowRows(c) {
  const rows = [];
  for (let y = 0; y < 15; y++) {
    let r = '';
    for (let x = 0; x < 22; x++) {
      let on;
      if (x < 15) on = y >= 5 && y <= 9;            // shaft
      else on = Math.abs(y - 7) <= 7 - (x - 15);   // head
      r += on ? c : '.';
    }
    rows.push(r);
  }
  return rows;
}

/** Canvas for one sprite at 1x. */
function draw(name) {
  const d = DEFS[name];
  if (!d) throw new Error(`unknown sprite ${name}`);
  const h = d.rows.length, w = d.rows[0].length;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x2 = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = d.rows[y][x];
      if (ch === '.' || !d.pal[ch]) continue;
      x2.fillStyle = d.pal[ch];
      x2.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** {url, w, h} of a sprite (1x pixel size). */
export function sprite(name) {
  let s = cache.get(name);
  if (!s) {
    const c = draw(name);
    s = { url: c.toDataURL('image/png'), w: c.width, h: c.height };
    cache.set(name, s);
  }
  return s;
}

/** Inline style props to show a sprite at integer `scale`. */
export function spriteStyle(name, scale) {
  const s = sprite(name);
  return {
    backgroundImage: `url(${s.url})`, backgroundSize: `${s.w * scale}px ${s.h * scale}px`,
    backgroundRepeat: 'no-repeat', width: s.w * scale + 'px', height: s.h * scale + 'px', imageRendering: 'pixelated',
  };
}

/** A <span> showing the sprite at integer scale. */
export function spriteEl(name, scale, cls = '') {
  const e = document.createElement('span');
  e.className = 'inv-sprite ' + cls;
  Object.assign(e.style, spriteStyle(name, scale));
  e.dataset.sprite = name;
  return e;
}

/** Swap the sprite shown by an element made with spriteEl (no DOM rebuild). */
export function setSprite(e, name, scale) {
  if (e.dataset.sprite === name && e.dataset.scale === String(scale)) return;
  Object.assign(e.style, spriteStyle(name, scale));
  e.dataset.sprite = name; e.dataset.scale = String(scale);
}

export const SPRITE_NAMES = Object.freeze(Object.keys(DEFS));
