// OWNER LANE: CORE-A (textures). Shared pixel-art toolkit, also used by FEATURE-MOBS (mob skins) and
// FEATURE-FX (particles). STUB-QUALITY implementations by LEAD: CORE-A may improve them but must keep
// these signatures and their determinism (same inputs -> same pixels). SPEC §5.1.3.

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

/** A small RGBA pixel buffer with helpers (no DOM). */
export class PixelCanvas {
  constructor(w = 16, h = 16) { this.w = w; this.h = h; this.data = new Uint8ClampedArray(w * h * 4); }
  /** set(x, y, '#rrggbb' | [r,g,b], alpha=255). Coordinates wrap. */
  set(x, y, color, a = 255) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h;
    const c = typeof color === 'string' ? hexToRgb(color) : color;
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
}
