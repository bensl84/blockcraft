// OWNER LANE: FEATURE-MOBS. Procedurally painted, ORIGINAL mob skins (SPEC §8.1, §0.3 originality).
// Pure: paints into a textures/toolkit.js PixelCanvas using the box-UV layout of mob_models.js; deterministic
// (seeded from the type + variant name, never Math.random). Kid-friendly faces: 2x2 eyes with a highlight.
// The creeper face is an original design (round eyes and a little zig-zag mouth), not the classic frown.

import { PixelCanvas, hash2, texRng } from '../textures/toolkit.js';
import { COLOR_HEX } from '../core/constants.js';
import { MODELS, faceRects, packModel } from './mob_models.js';

/* ------------------------------------------------------------------ colour helpers */
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shade(hex, k) { const c = rgb(hex); return c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))); }
function mix(a, b, t) { const x = rgb(a), y = rgb(b); return x.map((v, i) => Math.round(v + (y[i] - v) * t)); }
/** [r, g, b] -> '#rrggbb'. */
function hex(c) { return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); }

/** Smooth value noise in [0,1) over pixel coordinates (cell = scale px). */
function vn(x, y, scale, seed) {
  const gx = x / scale, gy = y / scale, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Painting context for one face rectangle; coordinates are face-local (0,0 = top-left seen from outside). */
class Face {
  constructor(pc, rect, face, box, seed) { this.pc = pc; [this.x, this.y, this.w, this.h] = rect; this.face = face; this.box = box; this.seed = seed; }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.pc.set(this.x + x, this.y + y, typeof c === 'string' ? rgb(c) : c);
  }
  fill(c) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c); }
  /** Base colour with soft noise: shades picked from [dark, base, light] by value noise + a few speckles. */
  fur(base, amount = 0.08, scale = 2, speckle = 0.06) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const n = vn(this.x + x, this.y + y, scale, this.seed) - 0.5;
      const s = hash2(this.x + x, this.y + y, this.seed + 17);
      let k = 1 + n * amount * 2;
      if (s < speckle) k -= amount; else if (s > 1 - speckle) k += amount;
      this.set(x, y, shade(base, k));
    }
  }
  rowFill(y, c) { for (let x = 0; x < this.w; x++) this.set(x, y, c); }
  /** Cute 2x2 eye: top-left highlight, three dark pixels. */
  eye(x, y, dark = '#1d1a1a', hi = '#ffffff') { this.set(x, y, hi); this.set(x + 1, y, dark); this.set(x, y + 1, dark); this.set(x + 1, y + 1, dark); }
  get side() { return this.face === 'east' || this.face === 'west'; }
}

/* ------------------------------------------------------------------ painters (type -> fn(f, skin, variant)) */

const PAINT = {
  pig(f, skin) {
    const base = '#f2a9a6';
    switch (skin) {
      case 'body':
        f.fur(base, 0.06, 3);
        if (f.face === 'up') for (const [x, y] of [[2, 4], [3, 4], [6, 10], [7, 10], [7, 11]]) f.set(x, y, '#e8938f');
        break;
      case 'head':
        f.fur(base, 0.05, 3);
        if (f.face === 'front') {
          f.eye(1, 2, '#2b1d1d'); f.eye(5, 2, '#2b1d1d');
          f.set(0, 4, '#f7889a'); f.set(7, 4, '#f7889a');
          f.set(3, 7, '#c9707a'); f.set(4, 7, '#c9707a');
        }
        break;
      case 'snout':
        f.fill('#f19aa5');
        if (f.face === 'front') { f.rowFill(0, '#f7b4bd'); f.set(1, 1, '#9c4652'); f.set(2, 1, '#9c4652'); }
        break;
      case 'tail': f.fill('#e48a90'); break;
      case 'saddle':
        f.fur('#6b4226', 0.06, 2, 0.02);
        if (f.face === 'up') { for (let x = 1; x < f.w - 1; x += 2) { f.set(x, 1, '#c9a46a'); f.set(x, f.h - 2, '#c9a46a'); } }
        else f.rowFill(f.h - 1, '#4a2c18');
        break;
      default: // legs
        f.fur(base, 0.05, 2);
        if (f.face === 'down') f.fill('#a8656a'); else { f.rowFill(f.h - 1, '#b8747a'); f.rowFill(f.h - 2, '#c98488'); }
    }
  },
  cow(f, skin) {
    const brown = '#5e3b24', white = '#efebe4';
    const patch = () => {
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        const n = vn(f.x + x, f.y + y, 4, f.seed);
        const c = n > 0.56 ? white : brown;
        const s = hash2(f.x + x, f.y + y, f.seed + 3);
        f.set(x, y, shade(c, s < 0.08 ? 0.92 : s > 0.94 ? 1.06 : 1));
      }
    };
    switch (skin) {
      case 'body': patch(); break;
      case 'udder': f.fill('#e8a6a2'); if (f.face === 'down') { f.set(1, 1, '#c97f7c'); f.set(2, 2, '#c97f7c'); } break;
      case 'head':
        f.fur(brown, 0.05, 3);
        if (f.face === 'front') {
          for (let y = 0; y < 6; y++) { f.set(3, y, white); f.set(4, y, white); }
          f.set(2, 0, white); f.set(5, 0, white);
          f.eye(1, 3, '#160f0b'); f.eye(5, 3, '#160f0b');
        }
        break;
      case 'muzzle':
        f.fill('#e2b0a4');
        if (f.face === 'front') { f.set(1, 1, '#8a5a50'); f.set(4, 1, '#8a5a50'); f.rowFill(0, '#ecc2b8'); }
        break;
      case 'horn': f.fill('#e0dacb'); if (f.face !== 'down') f.set(0, 0, '#c4bca8'); break;
      default: patch(); if (f.face === 'down') f.fill('#2b2118'); else { f.rowFill(f.h - 1, '#2b2118'); f.rowFill(f.h - 2, '#3b2d22'); }
    }
  },
  sheep(f, skin, v) {
    const face = '#ead8bf';
    const woolHex = COLOR_HEX[v.color] || COLOR_HEX.white;
    switch (skin) {
      case 'wool': {
        const dark = v.color === 'black' ? 1.35 : 0.86, light = v.color === 'black' ? 0.8 : 1.08;
        for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
          const n = vn(f.x + x, f.y + y, 2, f.seed + 5);
          const k = n < 0.3 ? dark : n > 0.72 ? light : 1;
          f.set(x, y, shade(woolHex, k));
        }
        break;
      }
      case 'head':
        f.fur(face, 0.04, 3);
        if (f.face === 'front') {
          f.eye(0, 2, '#231c16'); f.eye(4, 2, '#231c16');
          f.set(2, 4, '#e59a9c'); f.set(3, 4, '#e59a9c'); f.set(2, 5, '#b57a74'); f.set(3, 5, '#b57a74');
        }
        break;
      // the body only shows once sheared: short stubble in the wool colour, so a dyed sheared sheep shows its new colour
      case 'body': f.fur(hex(mix(face, woolHex, 0.45)), 0.05, 2); break;
      default:
        f.fur(face, 0.04, 2);
        if (f.face === 'down') f.fill('#4a3a30'); else { f.rowFill(f.h - 1, '#5a463a'); }
    }
  },
  chicken(f, skin) {
    const white = '#f6f5ef';
    switch (skin) {
      case 'body': f.fur(white, 0.04, 2, 0.04); if (f.face === 'back') { f.set(2, 1, '#dcdad2'); f.set(3, 1, '#dcdad2'); } break;
      case 'head':
        f.fur(white, 0.03, 2, 0.02);
        if (f.face === 'front') { f.set(0, 1, '#1c1c1c'); f.set(3, 1, '#1c1c1c'); }
        if (f.side) { f.set(1, 1, '#1c1c1c'); f.set(1, 0, '#ffffff'); }
        if (f.face === 'up') { f.set(1, 1, '#d8262c'); f.set(2, 1, '#d8262c'); f.set(1, 2, '#e8343a'); }
        break;
      case 'beak': f.fill('#f3b33d'); f.rowFill(f.h - 1, '#d9962a'); break;
      case 'wattle': f.fill('#d8262c'); break;
      case 'wing':
        f.fur('#ecebe4', 0.05, 2);
        if (f.side) for (let x = 0; x < f.w; x += 2) f.set(x, f.h - 1, '#c8c6be');
        break;
      default: f.fill('#e8a82c'); f.rowFill(0, '#f0bc4a');
    }
  },
  wolf(f, skin, v) {
    const grey = '#c4c1bb', light = '#e7e5e0', dark = '#97938c';
    switch (skin) {
      case 'body':
        f.fur(grey, 0.07, 2);
        if (f.face === 'down') f.fur(light, 0.04, 2);
        if (f.face === 'up') for (let y = 0; y < f.h; y++) f.set(Math.floor(f.w / 2), y, dark);
        break;
      case 'mane':
        f.fur(shade(grey, 0.97).reduce((s, c) => s + c.toString(16).padStart(2, '0'), '#'), 0.1, 2, 0.1);
        if (v.tamed && (f.face === 'front' || f.side || f.face === 'back')) {
          f.rowFill(f.h - 3, '#c8282e'); f.rowFill(f.h - 2, '#a81e24');
          if (f.face === 'front') f.set(Math.floor(f.w / 2), f.h - 1, '#f2c83a');
        }
        break;
      case 'head':
        f.fur(grey, 0.06, 2);
        if (f.face === 'front') {
          if (v.angry) { f.eye(0, 1, '#d42020', '#ffb0a0'); f.eye(4, 1, '#d42020', '#ffb0a0'); f.set(1, 0, '#4a4642'); f.set(4, 0, '#4a4642'); }
          else { f.eye(0, 1, '#231f1c'); f.eye(4, 1, '#231f1c'); }
          f.set(2, 4, light); f.set(3, 4, light);
        }
        break;
      case 'snout':
        f.fill(light);
        if (f.face === 'front') { f.set(1, 0, '#2a2522'); f.set(0, 0, '#5a5550'); f.set(2, 0, '#5a5550'); f.set(1, 2, '#9a7a72'); }
        if (f.face === 'up') f.set(1, f.h - 1, '#2a2522');
        break;
      case 'ear': f.fill(dark); if (f.face === 'front') f.set(Math.floor(f.w / 2), 1, '#d99a9a'); break;
      case 'tail': f.fur(grey, 0.06, 2); if (f.face !== 'up' && f.face !== 'down') { f.rowFill(f.h - 1, light); } if (f.face === 'back') f.fill(light); break;
      default: f.fur(grey, 0.05, 2); if (f.face === 'down') f.fill('#6a6660');
    }
  },
  cat(f, skin) {
    const base = '#e8a352', stripe = '#b8652a', light = '#f6d8a8';
    switch (skin) {
      case 'body':
        f.fur(base, 0.04, 2);
        if (f.face === 'up' || f.side) for (let y = 1; y < f.h; y += 3) for (let x = 0; x < f.w; x++) if (hash2(x, y, 9) > 0.25) f.set(x, f.face === 'up' ? y : Math.min(f.h - 1, (y % f.h)), stripe);
        if (f.face === 'down') f.fill(light);
        break;
      case 'head':
        f.fur(base, 0.04, 2);
        if (f.face === 'front') { f.set(1, 1, '#6fd04a'); f.set(3, 1, '#6fd04a'); f.set(1, 0, '#ffffff'); f.set(3, 0, '#ffffff'); }
        if (f.face === 'up') { f.set(1, 1, stripe); f.set(3, 1, stripe); f.set(2, 3, stripe); }
        break;
      case 'nose': f.fill(light); if (f.face === 'front') { f.set(1, 0, '#f08a9a'); } break;
      case 'ear': f.fill(stripe); if (f.face === 'front') f.fill('#f2a0a8'); break;
      case 'tail': f.fill(base); if (f.face !== 'up' && f.face !== 'down') for (let x = 1; x < f.w; x += 2) f.set(x, 0, stripe); break;
      default: f.fur(base, 0.04, 2); if (f.face === 'down') f.fill(light); else f.rowFill(f.h - 1, light);
    }
  },
  horse(f, skin, v) {
    const coats = { white: '#e8e2d8', creamy: '#d9b98a', chestnut: '#a2552e', brown: '#7a4a28', black: '#2e2622', gray: '#8a8682', dark_brown: '#4a3020' };
    const coat = coats[v.coat] || coats.chestnut;
    const mane = v.coat === 'black' || v.coat === 'dark_brown' ? '#1a1412' : v.coat === 'white' ? '#cfc8bc' : '#2c1e14';
    switch (skin) {
      case 'body': f.fur(coat, 0.05, 3); break;
      case 'neck': f.fur(coat, 0.05, 2); break;
      case 'head':
        f.fur(coat, 0.05, 2);
        if (f.side) f.eye(1, 1, '#140e0c');
        if (f.face === 'front') { f.set(2, 0, '#f2eee6'); f.set(2, 1, '#f2eee6'); f.set(1, 3, '#3a2a22'); f.set(3, 3, '#3a2a22'); f.rowFill(4, shade(coat, 0.8)); }
        break;
      case 'mane': case 'tail': f.fur(mane, 0.12, 2, 0.1); break;
      case 'ear': f.fill(shade(coat, 0.85)); break;
      case 'saddle':
        f.fur('#5a3a20', 0.06, 2, 0.02);
        if (f.face === 'up') for (let x = 1; x < f.w - 1; x += 2) { f.set(x, 1, '#caa064'); f.set(x, f.h - 2, '#caa064'); }
        else f.rowFill(f.h - 1, '#3a2412');
        break;
      default:
        f.fur(coat, 0.05, 2);
        if (f.face === 'down') f.fill('#3a3430'); else { f.rowFill(f.h - 1, '#3a3430'); f.rowFill(f.h - 2, '#4a4440'); }
    }
  },
  zombie(f, skin) {
    const skinC = '#78a86a', shirt = '#7d5cb8', pants = '#6b5440';
    switch (skin) {
      case 'head':
        f.fur(skinC, 0.06, 2);
        if (f.face === 'up') f.fur('#3f6b3a', 0.1, 2);
        else f.rowFill(0, '#3f6b3a');
        if (f.face === 'front') {
          f.set(2, 1, '#3f6b3a'); f.set(5, 1, '#3f6b3a');
          f.eye(1, 3, '#20301c', '#dff2d6'); f.eye(5, 3, '#20301c', '#dff2d6');
          f.set(3, 6, '#3a5232'); f.set(4, 6, '#3a5232'); f.set(5, 5, '#3a5232');
        }
        break;
      case 'body':
        f.fur(shirt, 0.07, 2);
        if (f.face !== 'up' && f.face !== 'down') {
          for (let x = 0; x < f.w; x++) if (hash2(x, 1, f.seed) > 0.5) f.set(x, f.h - 1, skinC);
          f.set(1, 4, '#5e4290'); f.set(2, 5, '#5e4290'); f.set(f.w - 2, 7, '#5e4290');
        }
        break;
      case 'arm':
        f.fur(skinC, 0.06, 2);
        if (f.face !== 'down') for (let y = 0; y < 4; y++) f.rowFill(y, shade(shirt, y === 3 ? 0.85 : 1));
        if (f.face === 'down') f.fill('#5a8a4e');
        break;
      default:
        f.fur(pants, 0.06, 2);
        if (f.face === 'down') f.fill('#3d3d3d'); else { f.rowFill(f.h - 1, '#3d3d3d'); f.rowFill(f.h - 2, '#4a4a4a'); }
    }
  },
  skeleton(f, skin) {
    const bone = '#dedcd4', dark = '#55534e';
    switch (skin) {
      case 'head':
        f.fur(bone, 0.05, 2, 0.03);
        if (f.face === 'front') {
          f.eye(1, 3, '#26262b', '#8a90a8'); f.eye(5, 3, '#26262b', '#8a90a8');
          f.set(3, 5, '#5a5852'); f.set(4, 5, '#5a5852');
          for (let x = 1; x < 7; x++) f.set(x, 6, x % 2 ? '#4a4844' : bone);
        }
        break;
      case 'body':
        f.fill(dark);
        if (f.face === 'front' || f.face === 'back') {
          for (let y = 0; y < f.h; y++) { f.set(3, y, bone); f.set(4, y, bone); }
          for (let y = 1; y < 8; y += 2) for (let x = 1; x < f.w - 1; x++) f.set(x, y, bone);
          f.rowFill(f.h - 2, bone);
        } else if (f.side) { for (let y = 1; y < 8; y += 2) f.rowFill(y, bone); }
        else f.fill(bone);
        break;
      case 'bow':
        f.fill('#7a5230');
        if (f.side) for (let y = 1; y < f.h - 1; y++) f.set(0, y, '#d8d4c8');
        break;
      default:
        f.fill(bone);
        if (f.face !== 'up' && f.face !== 'down') { f.rowFill(Math.floor(f.h / 2), '#a8a59c'); f.rowFill(0, '#bdbab0'); }
    }
  },
  creeper(f, skin) {
    const base = '#58b043';
    const leafy = () => {
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        const n = vn(f.x + x, f.y + y, 2, f.seed + 11), s = hash2(f.x + x, f.y + y, f.seed);
        const c = n < 0.28 ? '#3f8f32' : n > 0.74 ? '#7dd05e' : base;
        f.set(x, y, s < 0.05 ? '#2c6a24' : c);
      }
    };
    leafy();
    if (skin === 'head' && f.face === 'front') {
      f.eye(1, 2, '#1b2a16', '#e8ffe0'); f.eye(5, 2, '#1b2a16', '#e8ffe0');
      f.set(1, 4, '#8fdc6e'); f.set(6, 4, '#8fdc6e');
      for (const [x, y] of [[2, 5], [3, 6], [4, 5], [5, 6]]) f.set(x, y, '#1b2a16');
    }
    if (skin === 'leg') { if (f.face === 'down') f.fill('#2c6a24'); else f.rowFill(f.h - 1, '#2c6a24'); }
  },
  spider(f, skin) {
    const body = '#3b2d2b';
    switch (skin) {
      case 'head':
        f.fur(body, 0.12, 2, 0.08);
        if (f.face === 'front') {
          f.eye(1, 2, '#d83232', '#ffd0d0'); f.eye(5, 2, '#d83232', '#ffd0d0');
          f.set(2, 1, '#b82a2a'); f.set(5, 1, '#b82a2a'); f.set(0, 4, '#b82a2a'); f.set(7, 4, '#b82a2a');
          f.set(3, 7, '#c8b8a8'); f.set(4, 7, '#c8b8a8');
        }
        break;
      case 'abdomen':
        f.fur(body, 0.12, 2, 0.08);
        if (f.face === 'up') for (let y = 2; y < f.h - 2; y += 3) for (let x = 3; x < f.w - 3; x++) f.set(x, y, '#5a3a34');
        break;
      case 'leg': f.fur('#2e2321', 0.12, 2, 0.06); if (f.face === 'up') { f.set(Math.floor(f.w / 2), 0, '#5a4640'); } break;
      default: f.fur(body, 0.12, 2, 0.08);
    }
  },
  /* ---------------- judge FID-6: more mob kinds ---------------- */
  cod(f, skin) {
    const back = '#9a8058', belly = '#e6dcc4', fin = '#b8986a';
    switch (skin) {
      case 'body':
        f.fur(back, 0.06, 2, 0.08);
        if (f.side) { for (let y = Math.floor(f.h / 2); y < f.h; y++) f.rowFill(y, shade(belly, 0.98)); for (let x = 1; x < f.w; x += 2) f.set(x, Math.floor(f.h / 2) - 1, '#7a6444'); }
        if (f.face === 'down') f.fill(belly);
        break;
      case 'head':
        f.fur(back, 0.05, 2);
        if (f.side) { f.eye(f.face === 'east' ? f.w - 2 : 0, 0, '#141414'); f.rowFill(f.h - 1, belly); }
        if (f.face === 'front') { f.rowFill(f.h - 1, '#c8a8a0'); }
        break;
      case 'fin': f.fill(fin); break;
      default: f.fur(fin, 0.06, 2); if (f.side) for (let y = 0; y < f.h; y += 2) f.set(f.w - 1, y, '#8a7048');
    }
  },
  tropical_fish(f, skin, v) {
    const PAL = [['#f08a24', '#ffffff'], ['#3a7ae0', '#ffd23a'], ['#ffd23a', '#2a2a2a'], ['#e04070', '#ffffff'], ['#30c0b0', '#f06a3a'], ['#a050e0', '#ffe060']];
    const [base, accent] = PAL[((v.pattern | 0) % PAL.length + PAL.length) % PAL.length];
    const striped = (v.pattern | 0) % 2 === 0;
    switch (skin) {
      case 'body':
        f.fur(base, 0.04, 2, 0.02);
        if (f.side) {
          if (striped) for (let y = 0; y < f.h; y++) { f.set(1, y, accent); f.set(f.w - 2, y, accent); }
          else for (const [x, y] of [[1, 1], [2, 3], [3, 1]]) f.set(x, y, accent);
          f.eye(f.face === 'east' ? f.w - 2 : 0, 1, '#141414');
        }
        break;
      case 'fin': f.fill(accent); break;
      default: f.fill(accent); if (f.side) for (let y = 0; y < f.h; y += 2) f.set(f.w - 1, y, base);
    }
  },
  squid(f, skin) {
    const base = '#2c4a6e', dark = '#1c3050', light = '#5a7ea6';
    if (skin === 'body') {
      f.fur(base, 0.08, 2, 0.06);
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (hash2(f.x + x, f.y + y, 31) > 0.9) f.set(x, y, light);
      if (f.face === 'front') {
        // big friendly eyes low on the mantle
        for (const ex of [1, f.w - 4]) { f.set(ex, f.h - 5, '#ffffff'); f.set(ex + 1, f.h - 5, '#ffffff'); f.set(ex + 2, f.h - 5, '#ffffff'); f.set(ex, f.h - 4, '#ffffff'); f.set(ex + 1, f.h - 4, '#101820'); f.set(ex + 2, f.h - 4, '#101820'); f.set(ex, f.h - 3, '#ffffff'); f.set(ex + 1, f.h - 3, '#101820'); f.set(ex + 2, f.h - 3, '#101820'); }
      }
      if (f.face === 'down') { f.fill(dark); f.set(Math.floor(f.w / 2), Math.floor(f.h / 2), '#0a1018'); }
    } else {
      f.fur(base, 0.08, 2);
      if (f.side || f.face === 'front' || f.face === 'back') for (let y = 2; y < f.h; y += 3) f.set(Math.floor(f.w / 2), y, '#c8d4e4');
      if (f.face === 'down') f.fill(dark);
    }
  },
  rabbit(f, skin, v) {
    const COATS = { brown: ['#8a6a48', '#c8b090'], white: ['#f2f0ea', '#ffffff'], black: ['#2e2a28', '#4a4440'], gold: ['#e0c080', '#f4e2b8'], salt: ['#a49a8e', '#dcd6cc'], spotted: ['#f2f0ea', '#3a3430'] };
    const [coat, light] = COATS[v.coat] || COATS.brown;
    switch (skin) {
      case 'body':
        f.fur(coat, 0.06, 2, 0.05);
        if (v.coat === 'spotted' && (f.side || f.face === 'up')) for (const [x, y] of [[1, 1], [2, 1], [1, 2], [f.w - 3, 2], [f.w - 2, 2]]) f.set(x, y, light);
        if (f.face === 'down') f.fill(light);
        break;
      case 'tail': f.fill(v.coat === 'black' ? '#6a6460' : '#ffffff'); break;
      case 'head':
        f.fur(coat, 0.05, 2);
        if (f.face === 'front') { f.eye(0, 1, '#1c1414'); f.eye(f.w - 2, 1, '#1c1414'); f.rowFill(f.h - 1, light); }
        break;
      case 'ear': f.fill(coat); if (f.face === 'front') { for (let y = 1; y < f.h; y++) f.set(0, y, '#e8a8b0'); } break;
      case 'nose': f.fill('#e88a9a'); break;
      default: f.fur(coat, 0.05, 2); if (f.face === 'down') f.fill(light);
    }
  },
  fox(f, skin, v) {
    const orange = v.snow ? '#e8e6e0' : '#d8702c', white = v.snow ? '#ffffff' : '#f2e8da', dark = v.snow ? '#b8b4ac' : '#3a2a20';
    switch (skin) {
      case 'body': f.fur(orange, 0.06, 2, 0.05); if (f.face === 'down') f.fill(white); break;
      case 'head':
        f.fur(orange, 0.05, 2);
        if (f.face === 'front') {
          f.eye(0, 1, '#1a1410'); f.eye(f.w - 2, 1, '#1a1410');
          for (let x = 1; x < f.w - 1; x++) f.set(x, f.h - 1, white);
          f.set(0, f.h - 1, white); f.set(f.w - 1, f.h - 1, white);
        }
        if (f.side) f.rowFill(f.h - 1, white);
        break;
      case 'snout': f.fill(white); if (f.face === 'front') { f.set(0, 0, '#1a1410'); f.set(1, 0, '#1a1410'); } if (f.face === 'up') f.rowFill(0, orange); break;
      case 'ear': f.fill(dark); if (f.face === 'front') f.set(0, f.h - 1, '#e8a8a0'); break;
      case 'tail':
        f.fur(orange, 0.08, 2, 0.08);
        if (f.face === 'back') f.fill(white);
        else if (f.face !== 'front') for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if ((f.face === 'up' || f.face === 'down') ? y >= f.h - 2 : x >= f.w - 2) f.set(x, y, white);
        break;
      default: f.fur(dark, 0.06, 2);
    }
  },
  bee(f, skin) {
    const yellow = '#f2c43a', brown = '#3a2a1a';
    switch (skin) {
      case 'body':
        f.fur(yellow, 0.04, 2, 0.02);
        if (f.side || f.face === 'up' || f.face === 'down') {
          // stripes across the back half (z runs along x on the side faces)
          for (let i = 0; i < f.w; i++) {
            const zz = f.side ? (f.face === 'east' ? f.w - 1 - i : i) : i;
            if (f.side ? (zz === 4 || zz === 5 || zz === 7 || zz === 8) : false) for (let y = 0; y < f.h; y++) f.set(i, y, brown);
          }
          if (!f.side) for (const y of [4, 5, 7, 8]) if (y < f.h) f.rowFill(f.face === 'up' ? y : f.h - 1 - y, brown);
        }
        if (f.face === 'front') { f.fill('#e8b830'); f.eye(1, 2, '#141010'); f.eye(f.w - 3, 2, '#141010'); f.set(3, 5, '#5a3a20'); }
        if (f.face === 'back') f.fill(brown);
        break;
      case 'stinger': f.fill('#d8d0c0'); break;
      case 'antenna': f.fill(brown); break;
      case 'wing': f.fill('#e6f2ff'); for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (hash2(f.x + x, f.y + y, 5) > 0.75) f.set(x, y, '#c8dcf0'); break;
      default: f.fill(brown);
    }
  },
  enderman(f, skin, v) {
    const black = '#151217', dark = '#0c0a0e';
    switch (skin) {
      case 'head':
        f.fur(black, 0.1, 2, 0.04);
        if (f.face === 'front') {
          const eye = v.angry ? '#ff5050' : '#d080ff', glow = v.angry ? '#ffb0b0' : '#f0c8ff';
          for (const ex of [0, f.w - 3]) { f.set(ex, 4, eye); f.set(ex + 1, 4, glow); f.set(ex + 2, 4, eye); }
          if (v.angry) { f.rowFill(6, '#3a1018'); f.set(2, 6, '#d8d0d0'); f.set(5, 6, '#d8d0d0'); }
        }
        break;
      case 'block': {
        const c = typeof v.block === 'string' && /^#[0-9a-f]{6}$/i.test(v.block) ? v.block : '#7a5a3c';
        f.fur(c, 0.12, 2, 0.1);
        if (f.face === 'up' && v.grassy) f.fur('#5ea83c', 0.1, 2, 0.08);
        break;
      }
      default: f.fur(black, 0.08, 2, 0.03); if (f.face === 'down') f.fill(dark);
    }
  },
  slime(f, skin) {
    const base = '#6ccf5a', dark = '#3e9a34', light = '#a6ee8e';
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const edge = x === 0 || y === 0 || x === f.w - 1 || y === f.h - 1;
      const n = vn(f.x + x, f.y + y, 3, f.seed);
      f.set(x, y, edge ? shade(base, 1.08) : n < 0.35 ? shade(base, 0.92) : base);
    }
    // the darker core shows through the jelly
    for (let y = 2; y < f.h - 2; y++) for (let x = 2; x < f.w - 2; x++) if (hash2(f.x + x, f.y + y, 13) > 0.55) f.set(x, y, shade(dark, 1.05));
    f.set(1, 1, light); f.set(2, 1, light); f.set(1, 2, light);
    if (f.face === 'front') {
      f.set(1, 2, '#1c3a18'); f.set(2, 2, '#1c3a18'); f.set(1, 3, '#1c3a18'); f.set(2, 3, '#1c3a18');
      f.set(5, 2, '#1c3a18'); f.set(6, 2, '#1c3a18'); f.set(5, 3, '#1c3a18'); f.set(6, 3, '#1c3a18');
      f.set(1, 2, '#ffffff'); f.set(5, 2, '#ffffff');
      f.set(3, 5, '#1c3a18'); f.set(4, 5, '#1c3a18');
    }
  },
  villager(f, skin, v) {
    const ROBES = { farmer: ['#7a5a36', '#c8a44a'], librarian: ['#ece6d8', '#b03030'], cleric: ['#7a3a9a', '#e8c040'], smith: ['#3a3634', '#7a5a3a'], shepherd: ['#b89060', '#f0eee8'], plain: ['#6a4a30', '#8a6a48'] };
    const [robe, trim] = ROBES[v.prof] || ROBES.plain;
    const skinC = '#c4927a', dark = '#9a6a56';
    switch (skin) {
      case 'head':
        f.fur(skinC, 0.04, 2);
        if (f.face === 'front') {
          f.rowFill(0, '#4a3020'); f.rowFill(1, '#4a3020');
          for (let x = 1; x < 7; x++) f.set(x, 3, '#4a3020');                    // one long eyebrow
          f.set(1, 4, '#ffffff'); f.set(2, 4, '#2a6a3a'); f.set(5, 4, '#2a6a3a'); f.set(6, 4, '#ffffff');
          f.set(3, 8, dark); f.set(4, 8, dark);
        } else if (f.face === 'up') f.fill(v.prof === 'farmer' ? '#e8d070' : '#4a3020');
        else f.rowFill(0, '#4a3020');
        if (v.prof === 'farmer' && f.face !== 'down') f.rowFill(0, '#e8d070');
        break;
      case 'nose': f.fill(shade(skinC, 0.94)); if (f.face === 'down') f.fill(dark); break;
      case 'body': case 'robe':
        f.fur(robe, 0.05, 2, 0.03);
        if (f.face === 'front' && skin === 'body') for (let y = 0; y < f.h; y++) { f.set(Math.floor(f.w / 2) - 1, y, trim); f.set(Math.floor(f.w / 2), y, trim); }
        if (skin === 'robe' && f.face !== 'up' && f.face !== 'down') f.rowFill(f.h - 1, trim);
        if (v.prof === 'smith' && f.face === 'front') for (let y = 2; y < f.h; y++) for (let x = 2; x < f.w - 2; x++) f.set(x, y, '#2a2420');
        break;
      case 'arms': case 'arm':
        f.fur(robe, 0.05, 2);
        if (skin === 'arms' && f.face === 'front') { f.set(0, 1, skinC); f.set(1, 1, skinC); f.set(f.w - 1, 1, skinC); f.set(f.w - 2, 1, skinC); f.set(0, 2, skinC); f.set(f.w - 1, 2, skinC); }
        break;
      default: f.fur('#4a3a2e', 0.05, 2); if (f.face === 'down') f.fill('#2a221c');
    }
  },
  iron_golem(f, skin) {
    const iron = '#d8d2c6', dark = '#a8a296', vine = '#4a8a2c';
    const vines = () => { for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const n = vn(f.x + x, f.y + y, 3, 77); if (n > 0.78) f.set(x, y, n > 0.88 ? '#6aaa3e' : vine); } };
    switch (skin) {
      case 'head':
        f.fur(iron, 0.05, 2, 0.04);
        if (f.face === 'front') { f.rowFill(2, dark); f.set(1, 4, '#ffffff'); f.set(2, 4, '#7a1e1e'); f.set(5, 4, '#7a1e1e'); f.set(6, 4, '#ffffff'); f.set(2, 5, '#5a1414'); f.set(5, 5, '#5a1414'); }
        break;
      case 'nose': f.fill(dark); break;
      case 'flower':
        f.fill('#3c8a2a');
        if (f.face === 'up' || f.face === 'down') f.fill('#d8241c');
        else for (let y = 0; y < Math.min(2, f.h); y++) f.rowFill(y, '#e0302a');
        break;
      case 'body': f.fur(iron, 0.05, 3, 0.04); vines(); if (f.face === 'front') { f.set(Math.floor(f.w / 2), 4, dark); f.set(Math.floor(f.w / 2) - 1, 5, dark); } break;
      case 'waist': f.fur(dark, 0.05, 2); vines(); break;
      case 'arm': f.fur(iron, 0.05, 2, 0.04); vines(); if (f.face !== 'up' && f.face !== 'down') f.rowFill(f.h - 1, dark); break;
      default: f.fur(iron, 0.05, 2, 0.04); vines(); if (f.face === 'down') f.fill(dark);
    }
  },
  boat(f, skin) {
    const wood = '#a2794a';
    f.fur(wood, 0.05, 2, 0.02);
    if (skin === 'paddle') { f.fill('#c49a62'); return; }
    if (f.face === 'up' || f.face === 'down') { for (let y = 3; y < f.h; y += 4) f.rowFill(y, '#7a5530'); }
    else for (let x = 5; x < f.w; x += 6) for (let y = 0; y < f.h; y++) f.set(x, y, '#7a5530');
    if (skin === 'bottom' && f.face === 'up') f.fur('#8a6238', 0.05, 2);
  },
};

/**
 * Paint the skin of a mob type (+ variant: {color} sheep, {tamed, angry} wolf, {coat} horse).
 * @returns {PixelCanvas} width x height from packModel(MODELS[type])
 */
export function paintSkin(type, variant = {}) {
  const model = MODELS[type];
  if (!model) throw new Error(`no model for ${type}`);
  const pack = packModel(model);
  const pc = new PixelCanvas(pack.width, pack.height);
  const painter = PAINT[type];
  const key = type + ':' + JSON.stringify(variant);
  const rng = texRng(key);
  model.boxes.forEach((box, i) => {
    const rects = faceRects(pack.rects[i]);
    for (const face of ['up', 'down', 'east', 'front', 'west', 'back']) {
      const r = rects[face];
      if (r[2] <= 0 || r[3] <= 0) continue;
      const f = new Face(pc, r, face, box, Math.floor(rng() * 1e6));
      painter(f, box.skin, variant);
    }
  });
  return pc;
}

/** Stable cache key of a skin variant. */
export function skinKey(type, variant = {}) { return type + ':' + JSON.stringify(variant); }
export { mix as mixColor };
