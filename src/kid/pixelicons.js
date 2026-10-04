// OWNER LANE: KID. Original 16x16 pixel-art glyphs for the kid and touch buttons, emitted as crisp inline SVG
// (no fonts needed, so no glyph ever renders as a box). Pure strings - no DOM access at import time.
//
// Map legend: '.' empty, W white, K outline, Y yellow, O orange, R red, D dark red, G green, L light green,
// B brown, N dark brown, C sky blue, U shirt (yellow), V trousers (teal), P skin, H hair, S light grey, A grey.

const PALETTE = {
  W: '#ffffff', K: '#1d1d1d', Y: '#ffd400', O: '#f39a1c', R: '#d8432f', D: '#8e2a1e', G: '#4f9a2e', L: '#8fd86a',
  B: '#8b5a2b', N: '#5a3b22', C: '#7fd0ff', U: '#f2c230', V: '#2a7f7a', P: '#f0c08f', H: '#6a3a1a', S: '#d6d6d6', A: '#8b8b8b',
};

/** Convert a pixel map (array of equal-length strings) into an SVG string (horizontal runs merged). */
export function pixelSvg(rows, { cls = '', title = '' } = {}) {
  const h = rows.length, w = rows[0].length;
  let rects = '';
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    let x = 0;
    while (x < w) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') { x++; continue; }
      let x2 = x + 1;
      while (x2 < w && row[x2] === ch) x2++;
      rects += `<rect x="${x}" y="${y}" width="${x2 - x}" height="1" fill="${PALETTE[ch] || ch}"/>`;
      x = x2;
    }
  }
  return `<svg class="kid-px ${cls}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"${title ? ` data-title="${title}"` : ''}>${rects}</svg>`;
}

export const flipH = (rows) => rows.map((r) => [...r].reverse().join(''));
export const flipV = (rows) => [...rows].reverse();

const ARROW_UP = [
  '................',
  '.......WW.......',
  '......WWWW......',
  '.....WWWWWW.....',
  '....WWWWWWWW....',
  '...WWWWWWWWWW...',
  '..WWWWWWWWWWWW..',
  '.WWWWWWWWWWWWWW.',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '................',
];

/** Curved arrow: up, then bending to the left ("turn left", top view of the path). */
const TURN_LEFT = [
  '................',
  '....WW..........',
  '...WWW..........',
  '..WWWWWWWWWW....',
  '.WWWWWWWWWWWW...',
  '..WWWWWWWWWWWW..',
  '...WWW.....WWW..',
  '....WW.....WWW..',
  '...........WWW..',
  '...........WWW..',
  '...........WWW..',
  '...........WWW..',
  '...........WWW..',
  '...........WWW..',
  '...........WWW..',
  '................',
];

const JUMP = [
  '................',
  '.......WW.......',
  '......WWWW......',
  '.....WWWWWW.....',
  '....WWWWWWWW....',
  '...WWWWWWWWWW...',
  '..WWWWWWWWWWWW..',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '................',
  '..LLLLLLLLLLLL..',
  '..GGGGGGGGGGGG..',
  '..NNNNNNNNNNNN..',
  '................',
];

const DOWN = [
  '................',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '.....WWWWWW.....',
  '..WWWWWWWWWWWW..',
  '...WWWWWWWWWW...',
  '....WWWWWWWW....',
  '.....WWWWWW.....',
  '......WWWW......',
  '.......WW.......',
  '................',
  '..LLLLLLLLLLLL..',
  '..GGGGGGGGGGGG..',
  '................',
];

const WINGS = [
  '................',
  '................',
  '.WW..........WW.',
  '.WWW........WWW.',
  '.WWWW......WWWW.',
  '.WWWWW.YY.WWWWW.',
  '.WWWWWWYYWWWWWW.',
  '..WWWWWYYWWWWW..',
  '..WWWWWYYWWWWW..',
  '...WWWW..WWWW...',
  '...WW.W..W.WW...',
  '...W..W..W..W...',
  '................',
  '................',
  '................',
  '................',
];

const PAUSE = [
  '................',
  '................',
  '................',
  '....WWW..WWW....',
  '....WWW..WWW....',
  '....WWW..WWW....',
  '....WWW..WWW....',
  '....WWW..WWW....',
  '....WWW..WWW....',
  '....WWW..WWW....',
  '....WWW..WWW....',
  '....WWW..WWW....',
  '....WWW..WWW....',
  '................',
  '................',
  '................',
];

const HOUSE = [
  '.......KK.......',
  '......KRRK......',
  '.....KRRRRK.....',
  '....KRRRRRRK....',
  '...KRRRRRRRRK...',
  '..KRRRRRRRRRRK..',
  '.KRRRRRRRRRRRRK.',
  'KKKKKKKKKKKKKKKK',
  '..KWWWWWWWWWWK..',
  '..KWWWWWWWWWWK..',
  '..KWNNNWWCCCWK..',
  '..KWNBNWWCCCWK..',
  '..KWNNNWWWWWWK..',
  '..KWNNNWWWWWWK..',
  '..KWNNNWWWWWWK..',
  '..KKKKKKKKKKKK..',
];

const UNDO = [
  '................',
  '................',
  '......WWWWW.....',
  '....WWWWWWWWW...',
  '...WWWW...WWWW..',
  '..WWW.......WWW.',
  '.WWWWW.......WW.',
  '..WWW........WW.',
  '...W.........WW.',
  '.............WW.',
  '............WWW.',
  '...........WWW..',
  '.....WWWWWWWWW..',
  '.....WWWWWWW....',
  '................',
  '................',
];

const STAR = [
  '.......Y........',
  '.......Y........',
  '......YWY.......',
  '......YWY.......',
  '.....YYWYY......',
  'YYYYYYWWWYYYYYY.',
  '..YYWWWWWWWYY...',
  'YYYYYYWWWYYYYYY.',
  '.....YYWYY......',
  '......YWY.......',
  '......YWY.......',
  '.......Y........',
  '.......Y........',
  '................',
  '................',
  '................',
];

const HAND = [
  '.....KK.........',
  '....KPPK........',
  '....KPPK........',
  '....KPPK........',
  '....KPPKKK......',
  '....KPPKPPKKK...',
  '.KK.KPPKPPKPPKK.',
  'KPPKKPPPPPPPPPPK',
  'KPPPKPPPPPPPPPPK',
  '.KPPPPPPPPPPPPPK',
  '..KPPPPPPPPPPPK.',
  '...KPPPPPPPPPK..',
  '....KPPPPPPPPK..',
  '.....KPPPPPPK...',
  '.....KKKKKKKK...',
  '................',
];

/** A small original blocky kid (8 x 16). */
const KID = [
  '..HHHH..',
  '.HHHHHH.',
  '.HPPPPH.',
  '.PKPPKP.',
  '.PPPPPP.',
  '..PPPP..',
  'UUUUUUUU',
  'PUUUUUUP',
  'PUUUUUUP',
  'PUUUUUUP',
  '..VVVV..',
  '..VVVV..',
  '..VV.VV.',
  '..VV.VV.',
  '..KK.KK.',
  '........',
];

/** Arrow used by the home compass (points up = straight ahead). */
const COMPASS_ARROW = [
  '.....KK.....',
  '....KYYK....',
  '...KYYYYK...',
  '..KYYYYYYK..',
  '.KYYYYYYYYK.',
  'KYYYYYYYYYYK',
  'KKKKYYYYKKKK',
  '...KKKKKK...',
];

/** Raw maps (unit tests check their shape). */
export const MAPS = Object.freeze({ ARROW_UP, TURN_LEFT, JUMP, DOWN, WINGS, PAUSE, HOUSE, UNDO, STAR, HAND, KID, COMPASS_ARROW });

export const ICONS = Object.freeze({
  forward: () => pixelSvg(ARROW_UP),
  back: () => pixelSvg(flipV(ARROW_UP)),
  turnLeft: () => pixelSvg(TURN_LEFT),
  turnRight: () => pixelSvg(flipH(TURN_LEFT)),
  jump: () => pixelSvg(JUMP),
  up: () => pixelSvg(ARROW_UP),
  down: () => pixelSvg(DOWN),
  fly: () => pixelSvg(WINGS),
  pause: () => pixelSvg(PAUSE),
  home: () => pixelSvg(HOUSE),
  undo: () => pixelSvg(UNDO),
  redo: () => pixelSvg(flipH(UNDO)),
  star: () => pixelSvg(STAR),
  hand: () => pixelSvg(HAND),
  kid: () => pixelSvg(KID),
  compass: () => pixelSvg(COMPASS_ARROW),
  arrowLeft: () => pixelSvg(rotateLeft(ARROW_UP)),
  arrowRight: () => pixelSvg(flipH(rotateLeft(ARROW_UP))),
});

/** Rotate a square map 90 degrees counter-clockwise (up arrow -> left arrow). */
export function rotateLeft(rows) {
  const n = rows.length;
  const out = [];
  for (let y = 0; y < n; y++) {
    let s = '';
    for (let x = 0; x < n; x++) s += rows[x][n - 1 - y];
    out.push(s);
  }
  return out;
}

/** Isometric grass block (SVG polygons, original colours) for the place/break pictograms. */
export function blockSvg(cls = '') {
  return `<svg class="kid-block ${cls}" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">
<polygon points="16,2 30,9 16,16 2,9" fill="#6cbf3b"/>
<polygon points="2,9 16,16 16,30 2,23" fill="#8b5a2b"/>
<polygon points="30,9 16,16 16,30 30,23" fill="#6b4421"/>
<polygon points="2,9 16,16 16,19 2,12" fill="#4f9a2e"/>
<polygon points="30,9 16,16 16,19 30,12" fill="#3f7f24"/>
<rect x="6" y="18" width="2" height="2" fill="#a8743f"/><rect x="11" y="22" width="2" height="2" fill="#6b4421"/>
<rect x="22" y="20" width="2" height="2" fill="#4e3218"/><rect x="25" y="15" width="2" height="2" fill="#835a2e"/>
<g class="kid-crack" stroke="#111" stroke-width="1.4" fill="none">
<polyline class="kid-crack1" points="16,16 13,20 14,24"/>
<polyline class="kid-crack2" points="16,16 20,13 24,14 26,18"/>
<polyline class="kid-crack3" points="13,20 8,19 6,22 16,26 22,24 27,19"/>
</g></svg>`;
}
