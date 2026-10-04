// OWNER LANE: FEATURE-MENUS. SPEC §8.4.2.
// An ORIGINAL pixel font, written in code: one bitmap per printable ASCII character (32-126). Rows 0-6 sit
// above the baseline (cap height 7), rows 7-8 hang below it (descenders). At runtime the bitmaps are turned into
// a TrueType font in memory (one rectangle contour per horizontal run of lit pixels; tables head hhea maxp OS/2
// name cmap post loca glyf hmtx) and registered with FontFace. No network, no font files.
// CSS everywhere uses var(--font) = '"BlockcraftPixel", ...', so text uses fallbacks until this resolves.
//
// Pure parts (GLYPHS, glyphRows, buildFontTTF) run in Node for the unit tests; installPixelFont needs a DOM.

export const FONT_NAME = 'BlockcraftPixel';

/** Font units per glyph pixel and per em: 8 glyph pixels per em, so font-size 16/24/32 px stays crisp. */
export const FONT_PX = 125;
export const FONT_EM = 1000;
const ASCENT_PX = 8;
const DESCENT_PX = 2;

// '#' = lit pixel. Every row string has the glyph's full width; the advance is width + 1 pixel.
const G = {
  ' ': ['...'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '"': ['#.#', '#.#'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  "'": ['#', '#'],
  '(': ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  ',': ['..', '..', '..', '..', '..', '.#', '.#', '#.'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.', '#', '.', '.', '.', '#', '.'],
  ';': ['..', '.#', '..', '..', '..', '.#', '.#', '#.'],
  '<': ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.###.'],
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  'D': ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'I': ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  'J': ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  'N': ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '[': ['###', '#..', '#..', '#..', '#..', '#..', '###'],
  '^': ['..#..', '.#.#.', '#...#'],
  '_': ['.....', '.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '`': ['#.', '.#'],
  'a': ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  'b': ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '####.'],
  'c': ['.....', '.....', '.###.', '#....', '#....', '#...#', '.###.'],
  'd': ['....#', '....#', '.##.#', '#..##', '#...#', '#...#', '.####'],
  'e': ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  'f': ['..##', '.#..', '####', '.#..', '.#..', '.#..', '.#..'],
  'g': ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
  'h': ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  'i': ['#', '.', '#', '#', '#', '#', '#'],
  'j': ['...#', '....', '...#', '...#', '...#', '...#', '#..#', '.##.'],
  'k': ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'],
  'l': ['##.', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  'm': ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#...#', '#...#'],
  'n': ['.....', '.....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  'o': ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  'p': ['.....', '.....', '####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'q': ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#', '....#', '....#'],
  'r': ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  's': ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
  't': ['.#..', '.#..', '####', '.#..', '.#..', '.#..', '..##'],
  'u': ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'],
  'v': ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'w': ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  'x': ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  'y': ['.....', '.....', '#...#', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
  'z': ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],
  '{': ['..#', '.#.', '.#.', '#..', '.#.', '.#.', '..#'],
  '|': ['#', '#', '#', '#', '#', '#', '#'],
  '~': ['.....', '.....', '.#...', '#.#.#', '...#.'],
};
const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));
G[')'] = mirror(G['(']);
G['>'] = mirror(G['<']);
G['\\'] = mirror(G['/']);
G[']'] = mirror(G['[']);
G['}'] = mirror(G['{']);

/** Glyph bitmaps for ASCII 32..126: char -> array of row strings ('#' lit), rows 0-6 above the baseline. */
export const GLYPHS = Object.freeze(G);

/** Bitmap rows for a character (unknown characters give a hollow box). */
export function glyphRows(ch) {
  return G[ch] || ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'];
}

/** Width in glyph pixels (without the 1 px spacing). */
export function glyphWidth(ch) { return Math.max(...glyphRows(ch).map((r) => r.length)); }

/** Horizontal runs of lit pixels as font-unit rectangles [x0, y0, x1, y1] (y up, baseline 0). */
function glyphRects(rows) {
  const out = [];
  rows.forEach((row, r) => {
    const y0 = (6 - r) * FONT_PX, y1 = y0 + FONT_PX;
    let c = 0;
    while (c < row.length) {
      if (row[c] !== '#') { c++; continue; }
      let e = c;
      while (e < row.length && row[e] === '#') e++;
      out.push([c * FONT_PX, y0, e * FONT_PX, y1]);
      c = e;
    }
  });
  return out;
}

/* ------------------------------------------------------------------ TrueType writer */
class Writer {
  constructor() { this.bytes = []; }
  u8(v) { this.bytes.push(v & 0xff); return this; }
  u16(v) { this.bytes.push((v >>> 8) & 0xff, v & 0xff); return this; }
  i16(v) { return this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v) { this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); return this; }
  tag(s) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); return this; }
  pad4() { while (this.bytes.length % 4) this.bytes.push(0); return this; }
  get length() { return this.bytes.length; }
}

function checksum(bytes, start = 0, len = bytes.length - start) {
  let sum = 0;
  const end = start + ((len + 3) & ~3);
  for (let i = start; i < end; i += 4) {
    const v = ((bytes[i] || 0) << 24 | (bytes[i + 1] || 0) << 16 | (bytes[i + 2] || 0) << 8 | (bytes[i + 3] || 0)) >>> 0;
    sum = (sum + v) >>> 0;
  }
  return sum;
}

/**
 * Build the TrueType font. Glyph 0 is .notdef (a hollow box), glyphs 1..95 are ASCII 32..126.
 * @param {string} [family]
 * @returns {ArrayBuffer}
 */
export function buildFontTTF(family = FONT_NAME) {
  const P = FONT_PX;
  const chars = [];
  for (let c = 32; c <= 126; c++) chars.push(String.fromCharCode(c));
  const glyphs = [{ rects: [[0, 0, 5 * P, P], [0, 6 * P, 5 * P, 7 * P], [0, P, P, 6 * P], [4 * P, P, 5 * P, 6 * P]], adv: 6 * P }];
  for (const ch of chars) {
    const rows = glyphRows(ch);
    glyphs.push({ rects: glyphRects(rows), adv: (glyphWidth(ch) + 1) * P });
  }

  // glyf + loca
  const glyf = new Writer();
  const loca = [];
  let maxPoints = 0, maxContours = 0;
  let gxMin = 0x7fff, gyMin = 0x7fff, gxMax = -0x8000, gyMax = -0x8000;
  for (const g of glyphs) {
    loca.push(glyf.length);
    if (!g.rects.length) { g.xMin = 0; g.xMax = 0; continue; }
    let xMin = 0x7fff, yMin = 0x7fff, xMax = -0x8000, yMax = -0x8000;
    for (const [x0, y0, x1, y1] of g.rects) { xMin = Math.min(xMin, x0); yMin = Math.min(yMin, y0); xMax = Math.max(xMax, x1); yMax = Math.max(yMax, y1); }
    g.xMin = xMin; g.xMax = xMax;
    gxMin = Math.min(gxMin, xMin); gyMin = Math.min(gyMin, yMin); gxMax = Math.max(gxMax, xMax); gyMax = Math.max(gyMax, yMax);
    const n = g.rects.length;
    maxContours = Math.max(maxContours, n);
    maxPoints = Math.max(maxPoints, n * 4);
    glyf.i16(n).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
    for (let i = 0; i < n; i++) glyf.u16(i * 4 + 3);
    glyf.u16(0); // no instructions
    for (let i = 0; i < n * 4; i++) glyf.u8(0x01); // on-curve, 16-bit deltas
    // clockwise in y-up space: bottom-left -> top-left -> top-right -> bottom-right
    const pts = [];
    for (const [x0, y0, x1, y1] of g.rects) pts.push([x0, y0], [x0, y1], [x1, y1], [x1, y0]);
    let px = 0;
    for (const [x] of pts) { glyf.i16(x - px); px = x; }
    let py = 0;
    for (const [, y] of pts) { glyf.i16(y - py); py = y; }
    glyf.pad4();
  }
  loca.push(glyf.length);
  const locaW = new Writer();
  for (const o of loca) locaW.u32(o);

  const numGlyphs = glyphs.length;
  const advMax = Math.max(...glyphs.map((g) => g.adv));
  const inked = glyphs.filter((g) => g.rects.length);
  const minLsb = Math.min(...inked.map((g) => g.xMin));
  const minRsb = Math.min(...inked.map((g) => g.adv - g.xMax));
  const xMaxExtent = Math.max(...inked.map((g) => g.xMax));
  const ascent = ASCENT_PX * P, descent = DESCENT_PX * P;

  const head = new Writer();
  head.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x0003).u16(FONT_EM)
    .u32(0).u32(0xe0000000).u32(0).u32(0xe0000000) // created / modified (2023, fixed: deterministic bytes)
    .i16(gxMin).i16(gyMin).i16(gxMax).i16(gyMax)
    .u16(0).u16(8).i16(2).i16(1).i16(0);

  const hhea = new Writer();
  hhea.u16(1).u16(0).i16(ascent).i16(-descent).i16(0).u16(advMax).i16(minLsb).i16(minRsb).i16(xMaxExtent)
    .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(numGlyphs);

  const maxp = new Writer();
  maxp.u32(0x00010000).u16(numGlyphs).u16(maxPoints).u16(maxContours).u16(0).u16(0).u16(2)
    .u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);

  const avg = Math.round(glyphs.slice(1).reduce((a, g) => a + g.adv, 0) / (numGlyphs - 1));
  const os2 = new Writer();
  os2.u16(4).i16(avg).u16(400).u16(5).u16(0)
    .i16(650).i16(700).i16(0).i16(140).i16(650).i16(700).i16(0).i16(480)
    .i16(P).i16(3 * P).i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0);
  os2.u32(1).u32(0).u32(0).u32(0).tag('BLKC').u16(0x0040).u16(32).u16(126)
    .i16(ascent).i16(-descent).i16(0).u16(ascent).u16(descent).u32(1).u32(0)
    .i16(5 * P).i16(7 * P).u16(0).u16(32).u16(1);

  const names = [[1, family], [2, 'Regular'], [3, `${family}-Regular-1.0`], [4, `${family} Regular`], [5, 'Version 1.0'], [6, `${family}-Regular`]];
  const name = new Writer();
  const strings = names.map(([, s]) => { const w = []; for (const c of s) { const code = c.charCodeAt(0); w.push(code >> 8, code & 0xff); } return w; });
  name.u16(0).u16(names.length).u16(6 + 12 * names.length);
  let soff = 0;
  names.forEach(([id], i) => { name.u16(3).u16(1).u16(0x0409).u16(id).u16(strings[i].length).u16(soff); soff += strings[i].length; });
  for (const s of strings) for (const b of s) name.u8(b);

  const cmap = new Writer();
  cmap.u16(0).u16(1).u16(3).u16(1).u32(12);
  // format 4: segments [32..126] -> glyphs 1..95, then the 0xFFFF terminator
  const segs = [[32, 126, (1 - 32) & 0xffff], [0xffff, 0xffff, 1]];
  const segX2 = segs.length * 2;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segs.length));
  cmap.u16(4).u16(16 + 8 * segs.length).u16(0).u16(segX2).u16(searchRange).u16(Math.floor(Math.log2(segs.length))).u16(segX2 - searchRange);
  for (const s of segs) cmap.u16(s[1]);
  cmap.u16(0);
  for (const s of segs) cmap.u16(s[0]);
  for (const s of segs) cmap.u16(s[2]);
  for (let i = 0; i < segs.length; i++) cmap.u16(0);

  const post = new Writer();
  post.u32(0x00030000).u32(0).i16(-P).i16(P).u32(0).u32(0).u32(0).u32(0).u32(0);

  const hmtx = new Writer();
  for (const g of glyphs) hmtx.u16(g.adv).i16(g.rects.length ? g.xMin : 0);

  const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca: locaW, maxp, name, post };
  const tags = Object.keys(tables).sort();
  const numTables = tags.length;
  const sr = 16 * 2 ** Math.floor(Math.log2(numTables));
  const out = new Writer();
  out.u32(0x00010000).u16(numTables).u16(sr).u16(Math.floor(Math.log2(numTables))).u16(numTables * 16 - sr);
  let offset = 12 + 16 * numTables;
  const dir = [];
  for (const t of tags) {
    const bytes = tables[t].bytes;
    dir.push({ t, offset, len: bytes.length, sum: checksum(bytes) });
    offset += (bytes.length + 3) & ~3;
  }
  for (const d of dir) out.tag(d.t).u32(d.sum).u32(d.offset).u32(d.len);
  for (const t of tags) { for (const b of tables[t].bytes) out.u8(b); out.pad4(); }
  const bytes = Uint8Array.from(out.bytes);
  // head.checkSumAdjustment
  const headDir = dir.find((d) => d.t === 'head');
  const adj = (0xb1b0afba - checksum(bytes)) >>> 0;
  const p = headDir.offset + 8;
  bytes[p] = adj >>> 24; bytes[p + 1] = (adj >>> 16) & 0xff; bytes[p + 2] = (adj >>> 8) & 0xff; bytes[p + 3] = adj & 0xff;
  return bytes.buffer;
}

/** Simple checksum helper exported for the unit tests. */
export function ttfChecksum(bytes, start, len) { return checksum(bytes, start, len); }

let installing = null;
/** Build + register the pixel font. Resolves true when document.fonts has it. Never throws. */
export function installPixelFont() {
  if (installing) return installing;
  installing = (async () => {
    try {
      if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return false;
      const face = new FontFace(FONT_NAME, buildFontTTF(FONT_NAME), { style: 'normal', weight: '100 900', display: 'swap' });
      await face.load();
      document.fonts.add(face);
      return true;
    } catch (err) {
      console.warn('[blockcraft] pixel font not installed:', err && err.message);
      return false;
    }
  })();
  return installing;
}
