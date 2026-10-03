// OWNER LANE: CORE-A (textures). Shared pixel-art toolkit, also used by FEATURE-MOBS (mob skins) and
// FEATURE-FX (particles). SPEC §5.1 item 10. Every function is PURE and DETERMINISTIC (same inputs -> same
// pixels) and needs no DOM, except PixelCanvas.toCanvas().
//
// Frozen signatures (other lanes rely on them): texRng, hash2, vnoise, fbm, voronoiWrap, quant,
// PixelCanvas {set, get, alpha, fill, bevel, outline, copyTo, toCanvas}.
// Additions (optional helpers, safe for any lane): rgb, shade, mix, lum, ramp, tnoise, tfbm, poissonSeeds,
// PixelCanvas {setRGB, blend, paintGrid, outlineShade, bleed, clone, flipX, opaqueCount}.

import { hashString, hexToRgb, mulberry32 } from '../core/math.js';

/** Deterministic RNG for a texture name: returns () => float in [0,1). */
export function texRng(name) { return mulberry32(hashString(name)); }

/** Per-pixel hash in [0,1). */
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tiling value noise in [0,1). The lattice repeats every `period` pixels (period must divide 16). */
export function vnoise(x, y, period = 4, seed = 0) {
  const cell = 16 / period;
  const gx = x / cell, gy = y / cell;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (ix, iy) => hash2(((ix % period) + period) % period, ((iy % period) + period) % period, seed);
  const a = v(x0, y0), b = v(x0 + 1, y0), c = v(x0, y0 + 1), d = v(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** 0.55*vnoise(4) + 0.3*vnoise(8) + 0.15*white. */
export function fbm(x, y, seed = 0) { return 0.55 * vnoise(x, y, 4, seed) + 0.3 * vnoise(x, y, 8, seed + 1) + 0.15 * hash2(x, y, seed + 2); }

/** Wrapping Voronoi. seeds: Array<[x,y]> in pixel space (0..size). Returns {id, d1, d2}. */
export function voronoiWrap(x, y, seeds, size = 16) {
  let d1 = Infinity, d2 = Infinity, id = 0;
  for (let i = 0; i < seeds.length; i++) {
    let dx = Math.abs(x + 0.5 - seeds[i][0]); dx = Math.min(dx, size - dx);
    let dy = Math.abs(y + 0.5 - seeds[i][1]); dy = Math.min(dy, size - dy);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
  }
  return { id, d1, d2 };
}

/** Snap t in [0,1] to a palette entry. */
export function quant(t, palette) { return palette[Math.max(0, Math.min(palette.length - 1, Math.floor(t * palette.length)))]; }

/* ------------------------------------------------------------------ colour helpers (additions) */

const RGB_CACHE = new Map();
/** '#rrggbb' -> frozen [r,g,b] (cached). Arrays pass through. */
export function rgb(c) {
  if (typeof c !== 'string') return c;
  let v = RGB_CACHE.get(c);
  if (!v) { v = Object.freeze(hexToRgb(c)); RGB_CACHE.set(c, v); }
  return v;
}
const c255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
/** Multiply a colour by k (k > 1 lightens). */
export function shade(c, k) { c = rgb(c); return [c255(c[0] * k), c255(c[1] * k), c255(c[2] * k)]; }
/** Linear mix of two colours, t = 0 -> a, 1 -> b. */
export function mix(a, b, t) { a = rgb(a); b = rgb(b); return [c255(a[0] + (b[0] - a[0]) * t), c255(a[1] + (b[1] - a[1]) * t), c255(a[2] + (b[2] - a[2]) * t)]; }
/** Perceived luma 0..255. */
export function lum(c) { c = rgb(c); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
/** n-step palette from dark to light around a base colour (lo..hi multipliers). */
export function ramp(base, n = 5, lo = 0.72, hi = 1.18) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(shade(base, lo + (hi - lo) * (n === 1 ? 0.5 : i / (n - 1))));
  return out;
}

/**
 * Anisotropic tiling value noise in [0,1): `px` lattice cells across the 16-px width, `py` down the height
 * (both must divide 16). px < py gives horizontal streaks, px > py vertical ones.
 */
export function tnoise(x, y, px, py, seed = 0) {
  const gx = (x * px) / 16, gy = (y * py) / 16;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const wx0 = ((x0 % px) + px) % px, wx1 = (wx0 + 1) % px, wy0 = ((y0 % py) + py) % py, wy1 = (wy0 + 1) % py;
  const a = hash2(wx0, wy0, seed), b = hash2(wx1, wy0, seed), c = hash2(wx0, wy1, seed), d = hash2(wx1, wy1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** Tiling fractal noise: two tnoise octaves plus white noise; weights w = [w0, w1, wWhite]. */
export function tfbm(x, y, px, py, seed = 0, w = [0.55, 0.3, 0.15]) {
  return w[0] * tnoise(x, y, px, py, seed) + w[1] * tnoise(x, y, Math.min(16, px * 2), Math.min(16, py * 2), seed + 1) + w[2] * hash2(x, y, seed + 2);
}

/** Up to n points in [0,size)^2 at least minDist apart on the wrapping torus (deterministic for rng). */
export function poissonSeeds(rng, n, minDist, size = 16, tries = 40) {
  const pts = [];
  for (let t = 0; t < n * tries && pts.length < n; t++) {
    const x = rng() * size, y = rng() * size;
    let ok = true;
    for (const p of pts) {
      let dx = Math.abs(x - p[0]); dx = Math.min(dx, size - dx);
      let dy = Math.abs(y - p[1]); dy = Math.min(dy, size - dy);
      if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
    }
    if (ok) pts.push([x, y]);
  }
  return pts;
}

/* ------------------------------------------------------------------ PixelCanvas */

/** A small RGBA pixel buffer with helpers (no DOM). */
export class PixelCanvas {
  constructor(w = 16, h = 16) { this.w = w; this.h = h; this.data = new Uint8ClampedArray(w * h * 4); }
  /** set(x, y, '#rrggbb' | [r,g,b], alpha=255). Coordinates wrap. */
  set(x, y, color, a = 255) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h;
    const c = typeof color === 'string' ? rgb(color) : color;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = a;
  }
  get(x, y) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  alpha(x, y) { return this.get(x, y)[3]; }
  fill(color, a = 255) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, color, a); }
  /** Light from top-left: pixels with an empty up/left neighbour get lighter, down/right darker. */
  bevel(amount = 0.15) {
    const src = this.data.slice();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = (y * this.w + x) * 4;
      if (!src[i + 3]) continue;
      const empty = (xx, yy) => xx < 0 || yy < 0 || xx >= this.w || yy >= this.h || !src[(yy * this.w + xx) * 4 + 3];
      let k = 1;
      if (empty(x, y - 1) || empty(x - 1, y)) k += amount;
      else if (empty(x, y + 1) || empty(x + 1, y)) k -= amount;
      for (let c = 0; c < 3; c++) this.data[i + c] = Math.min(255, src[i + c] * k);
    }
  }
  /** Empty pixels touching a filled pixel (4-neighbour) get `color`. */
  outline(color) {
    const src = this.data.slice();
    const filled = (xx, yy) => xx >= 0 && yy >= 0 && xx < this.w && yy < this.h && src[(yy * this.w + xx) * 4 + 3] > 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (src[(y * this.w + x) * 4 + 3]) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) this.set(x, y, color);
    }
  }
  /** Copy into a target RGBA array at a byte offset (e.g. a TextureSet layer). */
  copyTo(target, offset = 0) { target.set(this.data, offset); }
  /** Browser only: an HTMLCanvasElement with these pixels. */
  toCanvas() {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    c.getContext('2d').putImageData(new ImageData(this.data, this.w, this.h), 0, 0);
    return c;
  }

  /* ---------------- additions ---------------- */

  /** Fast non-wrapping set; ignores out-of-range pixels. */
  setRGB(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    c = rgb(c);
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = a;
  }
  /** Alpha-blend a colour over the pixel (t = 0..1 opacity). Keeps the pixel's alpha (min 1 if it was empty). */
  blend(x, y, c, t) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    c = rgb(c);
    const i = (y * this.w + x) * 4;
    for (let k = 0; k < 3; k++) this.data[i + k] = c255(this.data[i + k] + (c[k] - this.data[i + k]) * t);
  }
  /**
   * Paint a character grid: rows = array of strings, pal = {char: '#hex' | [r,g,b] | null}. '.' and ' ' are
   * skipped, as are chars mapped to null. Optional mapper(ch, x, y) -> colour overrides the palette.
   */
  paintGrid(rows, pal, ox = 0, oy = 0) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const c = pal[ch];
        if (c == null) continue;
        this.setRGB(ox + x, oy + y, c);
      }
    }
    return this;
  }
  /**
   * Dark outline: empty pixels 4-touching a filled pixel get the darkest touching colour times k
   * (or `color` when given). Pixel-art style keeps the hue instead of using pure black.
   */
  outlineShade(k = 0.42, color = null, diagonal = false) {
    const src = this.data.slice();
    const W = this.w, H = this.h;
    const at = (xx, yy) => (xx >= 0 && yy >= 0 && xx < W && yy < H && src[(yy * W + xx) * 4 + 3] > 0 ? (yy * W + xx) * 4 : -1);
    const nb = diagonal ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (src[(y * W + x) * 4 + 3]) continue;
      let best = -1, bl = 1e9;
      for (const [dx, dy] of nb) {
        const j = at(x + dx, y + dy);
        if (j < 0) continue;
        const l = src[j] * 0.3 + src[j + 1] * 0.59 + src[j + 2] * 0.11;
        if (l < bl) { bl = l; best = j; }
      }
      if (best < 0) continue;
      if (color) this.setRGB(x, y, color);
      else this.setRGB(x, y, [src[best] * k, src[best + 1] * k, src[best + 2] * k]);
    }
    return this;
  }
  /**
   * Cutout hygiene (SPEC §5.1 item 3): alpha becomes 0 or 255 (threshold 128) and every transparent texel
   * gets the average RGB of nearby opaque texels (growing rings, wrapping) so mipmaps get no dark fringes.
   */
  bleed(wrap = true) {
    const W = this.w, H = this.h, d = this.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
    let any = false;
    for (let i = 3; i < d.length; i += 4) if (d[i]) { any = true; break; }
    if (!any) return this;
    const known = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) known[p] = d[p * 4 + 3] ? 1 : 0;
    for (let pass = 0; pass < W + H; pass++) {
      const add = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (known[p]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          let xx = x + dx, yy = y + dy;
          if (wrap) { xx = (xx + W) % W; yy = (yy + H) % H; } else if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (!known[q]) continue;
          r += d[q * 4]; g += d[q * 4 + 1]; b += d[q * 4 + 2]; n++;
        }
        if (n) add.push(p, r / n, g / n, b / n);
      }
      if (!add.length) break;
      for (let i = 0; i < add.length; i += 4) {
        const p = add[i];
        d[p * 4] = add[i + 1]; d[p * 4 + 1] = add[i + 2]; d[p * 4 + 2] = add[i + 3];
        known[p] = 1;
      }
    }
    return this;
  }
  clone() { const c = new PixelCanvas(this.w, this.h); c.data.set(this.data); return c; }
  flipX() {
    const src = this.data.slice();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = (y * this.w + x) * 4, j = (y * this.w + (this.w - 1 - x)) * 4;
      for (let k = 0; k < 4; k++) this.data[i + k] = src[j + k];
    }
    return this;
  }
  opaqueCount() { let n = 0; for (let i = 3; i < this.data.length; i += 4) if (this.data[i] > 0) n++; return n; }
}
