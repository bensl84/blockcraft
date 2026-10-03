// OWNER LANE: FEATURE-FX. Pooled particle system (SPEC §8.7): at most 2000 live particles, simulated per game
// tick (20 TPS, so runTicks/headless tests are deterministic) and drawn as ONE instanced draw call with
// position interpolation between ticks.
//
// ParticleSim is pure (typed arrays, no three.js, no DOM) and unit tested. ParticleMesh owns the GPU side:
// one InstancedBufferGeometry (camera-facing quads) whose shader samples either the block array texture
// (block-break patches) or FX's procedural sprite atlas (smoke, hearts, sparkles...).

import * as THREE from 'three';
import { B_LIQUID, B_OPAQUE, B_SHAPE, SHAPE, faceLayer, getCollisionBoxes } from '../core/registry.js';
import { mulberry32 } from '../core/math.js';
import { GLSL_LIGHT, pixelTexture } from './fxmat.js';
import { SPRITE, SPRITE_COLS, buildSpriteAtlas } from './sprites.js';

export const MAX_PARTICLES = 2000;

const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/**
 * Packed light (sky << 4 | block) for a particle in cell (x, y, z). An opaque cell has no light of its own (the
 * block being mined, or a patch that slid into a face), so it takes the brightest neighbour per channel instead
 * of drawing black.
 */
export function lightAround(world, x, y, z) {
  const l = world.getLight(x, y, z);
  const raw = world.getRaw ? world.getRaw(x, y, z) : 0;
  if (!B_OPAQUE[raw & 0xff]) return l;
  let sky = 0, blk = 0;
  for (const d of NB) {
    const nx = x + d[0], ny = y + d[1], nz = z + d[2];
    if (world.getRaw && B_OPAQUE[world.getRaw(nx, ny, nz) & 0xff]) continue;
    const v = world.getLight(nx, ny, nz);
    if ((v >> 4) > sky) sky = v >> 4;
    if ((v & 15) > blk) blk = v & 15;
  }
  return (sky << 4) | blk;
}
/** Particles are not spawned farther than this from the viewer (blocks). */
export const PARTICLE_VIEW_DIST = 48;

const SIDE_FACES = [0, 1, 4, 5];
const F_FULLBRIGHT = 1, F_COLLIDE = 2, F_SHRINK = 4, F_WATER = 8, F_ANIM_REV = 16, F_ANIM_LOOP = 32;

/** Every particle kind FX understands (SPEC §8.7 plus 'item' crumbs and 'drip'). */
export const PARTICLE_KINDS = Object.freeze(['block', 'smoke', 'explosion', 'heart', 'sparkle', 'splash', 'bubble',
  'crit', 'angry', 'poof', 'flame', 'item', 'drip', 'note']);

/**
 * Pure particle simulation. All per-particle state lives in packed typed arrays [0, count); removal swaps the
 * last particle into the hole (no allocation per particle, no per-tick garbage).
 */
export class ParticleSim {
  constructor(max = MAX_PARTICLES, seed = 0xf00d) {
    this.max = max;
    this.count = 0;
    this.rand = mulberry32(seed);
    const f = () => new Float32Array(max);
    this.x = f(); this.y = f(); this.z = f();
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.size = f();
    this.grav = f(); this.drag = f();
    this.layer = f(); this.u0 = f(); this.v0 = f(); this.span = f();
    this.r = f(); this.g = f(); this.b = f();
    this.sky = f(); this.block = f(); this.rot = f();
    this.frame0 = f(); this.frames = f();
    this.flags = new Uint8Array(max);
    /** viewer position for distance culling (set by FX every frame) */
    this.viewer = null;
    /** optional (layer) -> Uint8Array RGBA 16x16 for choosing opaque texture patches */
    this.texPixels = null;
    /** total spawned (stats/tests) */
    this.spawned = 0;
  }

  clear() { this.count = 0; }

  /** Allocate one particle slot at (x,y,z) with defaults; returns index or -1 when full. */
  _alloc(x, y, z, world) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    this.spawned++;
    this.x[i] = this.px[i] = x; this.y[i] = this.py[i] = y; this.z[i] = this.pz[i] = z;
    this.vx[i] = this.vy[i] = this.vz[i] = 0;
    this.age[i] = 0; this.life[i] = 20; this.size[i] = 0.1;
    this.grav[i] = 0; this.drag[i] = 0.98;
    this.layer[i] = -1 - SPRITE.GENERIC; this.u0[i] = 0; this.v0[i] = 0; this.span[i] = 1;
    this.r[i] = this.g[i] = this.b[i] = 1;
    this.rot[i] = 0; this.frame0[i] = 0; this.frames[i] = 0;
    this.flags[i] = 0;
    this.sampleLight(i, world);
    return i;
  }

  sampleLight(i, world) {
    if (world && world.getLight) {
      const l = lightAround(world, Math.floor(this.x[i]), Math.floor(this.y[i]), Math.floor(this.z[i]));
      this.sky[i] = l >> 4; this.block[i] = l & 15;
    } else { this.sky[i] = 15; this.block[i] = 0; }
  }

  _far(x, y, z) {
    const v = this.viewer;
    if (!v) return false;
    const dx = x - v.x, dy = y - v.y, dz = z - v.z;
    return dx * dx + dy * dy + dz * dz > PARTICLE_VIEW_DIST * PARTICLE_VIEW_DIST;
  }

  /**
   * Spawn particles. Returns how many were created.
   * opts: {count, id, state (block), spread, vx, vy, vz, color [r,g,b] 0..1, colors [[r,g,b]...] (item crumbs), size, life}
   */
  spawn(kind, x, y, z, opts = {}, world = null) {
    if (this._far(x, y, z)) return 0;
    const R = this.rand;
    const spread = opts.spread ?? 0.3;
    const n0 = this.count;
    const jitter = () => (R() - 0.5) * 2 * spread;
    const each = (n, fn) => { for (let k = 0; k < n; k++) { const i = this._alloc(x + jitter(), y + jitter() * 0.5, z + jitter(), world); if (i < 0) break; fn(i, k); } };
    const baseV = (i) => { this.vx[i] += opts.vx || 0; this.vy[i] += opts.vy || 0; this.vz[i] += opts.vz || 0; };
    switch (kind) {
      case 'block': return this.blockBreak(Math.floor(x), Math.floor(y), Math.floor(z), opts.id | 0, opts.state | 0, world, opts.count);
      case 'smoke':
        each(opts.count ?? 4, (i) => {
          this.vx[i] = (R() - 0.5) * 0.03; this.vy[i] = 0.02 + R() * 0.02; this.vz[i] = (R() - 0.5) * 0.03; baseV(i);
          this.grav[i] = -0.002; this.drag[i] = 0.94;
          this.life[i] = Math.min(40, Math.floor(8 / (R() * 0.8 + 0.2)));
          this.size[i] = (opts.size ?? 0.22) * (0.8 + R() * 0.5);
          const c = opts.color ? opts.color[0] : 0.32 + R() * 0.12;
          this.r[i] = c; this.g[i] = opts.color ? opts.color[1] : c; this.b[i] = opts.color ? opts.color[2] : c;
          this.frame0[i] = SPRITE.GENERIC; this.frames[i] = 8; this.flags[i] = F_ANIM_REV;
        });
        break;
      case 'poof':
        each(opts.count ?? 12, (i) => {
          this.vx[i] = (R() - 0.5) * 0.12; this.vy[i] = 0.02 + R() * 0.06; this.vz[i] = (R() - 0.5) * 0.12; baseV(i);
          this.grav[i] = -0.001; this.drag[i] = 0.9;
          this.life[i] = 12 + Math.floor(R() * 12);
          this.size[i] = (opts.size ?? 0.35) * (0.8 + R() * 0.5);
          const c = 0.86 + R() * 0.14; this.r[i] = c; this.g[i] = c; this.b[i] = c;
          this.frame0[i] = SPRITE.GENERIC; this.frames[i] = 8; this.flags[i] = F_ANIM_REV;
        });
        break;
      case 'explosion':
        each(opts.count ?? 14, (i) => {
          this.vx[i] = (R() - 0.5) * 0.08; this.vy[i] = (R() - 0.3) * 0.08; this.vz[i] = (R() - 0.5) * 0.08; baseV(i);
          this.drag[i] = 0.86;
          this.life[i] = 8 + Math.floor(R() * 10);
          this.size[i] = (opts.size ?? 1.6) * (0.75 + R() * 0.5);
          const c = 0.78 + R() * 0.22; this.r[i] = c; this.g[i] = c * 0.97; this.b[i] = c * 0.9;
          this.frame0[i] = SPRITE.GENERIC; this.frames[i] = 8; this.flags[i] = F_ANIM_REV | F_FULLBRIGHT;
        });
        break;
      case 'heart':
        each(opts.count ?? 5, (i) => {
          this.vx[i] = (R() - 0.5) * 0.02; this.vy[i] = 0.02 + R() * 0.015; this.vz[i] = (R() - 0.5) * 0.02; baseV(i);
          this.drag[i] = 0.92; this.grav[i] = -0.0015;
          this.life[i] = 16 + Math.floor(R() * 10);
          this.size[i] = opts.size ?? 0.3;
          this.layer[i] = -1 - SPRITE.HEART; this.flags[i] = F_FULLBRIGHT | F_SHRINK;
        });
        break;
      case 'sparkle':
        each(opts.count ?? 10, (i) => {
          this.vx[i] = (R() - 0.5) * 0.03; this.vy[i] = R() * 0.03; this.vz[i] = (R() - 0.5) * 0.03; baseV(i);
          this.drag[i] = 0.9;
          this.life[i] = 16 + Math.floor(R() * 14);
          this.size[i] = (opts.size ?? 0.17) * (0.8 + R() * 0.4);
          const c = opts.color || [0.5, 1.0, 0.4];
          this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
          this.frame0[i] = SPRITE.SPARKLE; this.frames[i] = 2; this.flags[i] = F_FULLBRIGHT | F_ANIM_LOOP | F_SHRINK;
        });
        break;
      case 'crit':
        each(opts.count ?? 10, (i) => {
          const a = R() * Math.PI * 2, e = (R() - 0.3) * 1.2, s = 0.18 + R() * 0.2;
          this.vx[i] = Math.cos(a) * Math.cos(e) * s; this.vy[i] = Math.sin(e) * s + 0.05; this.vz[i] = Math.sin(a) * Math.cos(e) * s; baseV(i);
          this.drag[i] = 0.7; this.grav[i] = 0.01;
          this.life[i] = 6 + Math.floor(R() * 8);
          this.size[i] = (opts.size ?? 0.18) * (0.8 + R() * 0.4);
          const c = opts.color || [1, 0.95, 0.55];
          this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
          this.layer[i] = -1 - SPRITE.CRIT; this.flags[i] = F_FULLBRIGHT | F_SHRINK;
        });
        break;
      case 'angry':
        each(opts.count ?? 3, (i) => {
          this.vy[i] = 0.01; this.drag[i] = 0.9;
          this.life[i] = 20; this.size[i] = opts.size ?? 0.35;
          this.layer[i] = -1 - SPRITE.ANGRY; this.flags[i] = F_SHRINK;
        });
        break;
      case 'note':
        each(opts.count ?? 1, (i) => {
          this.vy[i] = 0.03; this.drag[i] = 0.9; this.life[i] = 18; this.size[i] = opts.size ?? 0.3;
          const c = opts.color || [0.4, 1, 0.5]; this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
          this.layer[i] = -1 - SPRITE.NOTE; this.flags[i] = F_FULLBRIGHT | F_SHRINK;
        });
        break;
      case 'splash':
        each(opts.count ?? 10, (i) => {
          this.vx[i] = (R() - 0.5) * 0.12; this.vy[i] = 0.12 + R() * 0.14; this.vz[i] = (R() - 0.5) * 0.12; baseV(i);
          this.grav[i] = 0.04; this.drag[i] = 0.98;
          this.life[i] = 8 + Math.floor(R() * 10);
          this.size[i] = (opts.size ?? 0.12) * (0.7 + R() * 0.6);
          const c = opts.color || [0.55, 0.72, 1.0];
          this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
          this.layer[i] = -1 - SPRITE.DROP; this.flags[i] = F_COLLIDE;
        });
        break;
      case 'drip':
        each(opts.count ?? 1, (i) => {
          this.vx[i] = (R() - 0.5) * 0.04; this.vy[i] = 0.06 + R() * 0.05; this.vz[i] = (R() - 0.5) * 0.04; baseV(i);
          this.grav[i] = 0.04; this.life[i] = 4 + Math.floor(R() * 4); this.size[i] = opts.size ?? 0.06;
          const c = opts.color || [0.6, 0.75, 1.0];
          this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
          this.layer[i] = -1 - SPRITE.SQUARE; this.flags[i] = F_COLLIDE;
        });
        break;
      case 'bubble':
        each(opts.count ?? 4, (i) => {
          this.vx[i] = (R() - 0.5) * 0.02; this.vy[i] = 0.01 + R() * 0.02; this.vz[i] = (R() - 0.5) * 0.02; baseV(i);
          this.grav[i] = -0.002; this.drag[i] = 0.85;
          this.life[i] = 8 + Math.floor(R() * 32);
          this.size[i] = (opts.size ?? 0.1) * (0.7 + R() * 0.6);
          this.layer[i] = -1 - SPRITE.BUBBLE; this.flags[i] = F_WATER;
        });
        break;
      case 'flame':
        each(opts.count ?? 1, (i) => {
          this.vx[i] = (R() - 0.5) * 0.004; this.vy[i] = 0.004 + R() * 0.004; this.vz[i] = (R() - 0.5) * 0.004; baseV(i);
          this.drag[i] = 0.96;
          this.life[i] = 8 + Math.floor(R() * 12);
          this.size[i] = (opts.size ?? 0.12) * (0.8 + R() * 0.4);
          this.frame0[i] = SPRITE.FLAME; this.frames[i] = 2; this.flags[i] = F_FULLBRIGHT | F_ANIM_LOOP | F_SHRINK;
        });
        break;
      case 'item': {
        const cols = opts.colors && opts.colors.length ? opts.colors : [[0.8, 0.8, 0.8]];
        each(opts.count ?? 8, (i) => {
          this.vx[i] = (R() - 0.5) * 0.15; this.vy[i] = 0.08 + R() * 0.12; this.vz[i] = (R() - 0.5) * 0.15; baseV(i);
          this.grav[i] = 0.04; this.drag[i] = 0.98;
          this.life[i] = 10 + Math.floor(R() * 14);
          this.size[i] = (opts.size ?? 0.1) * (0.7 + R() * 0.6);
          const c = cols[Math.floor(R() * cols.length)];
          this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
          this.layer[i] = -1 - SPRITE.SQUARE; this.flags[i] = F_COLLIDE;
        });
        break;
      }
      default: return 0;
    }
    return this.count - n0;
  }

  /**
   * Block-break burst: a 3x3x3 grid (27 particles) of 4x4-pixel patches of the block's face textures, flying out
   * from the centre with gravity, colliding with the ground, lit by world light (SPEC §8.7: 16-32 particles).
   */
  blockBreak(bx, by, bz, id, state, world, count) {
    if (!id || this._far(bx + 0.5, by + 0.5, bz + 0.5)) return 0;
    const R = this.rand;
    const n0 = this.count;
    const grid = 3;
    const shape = B_SHAPE[id];
    const flat = shape === SHAPE.CROSS || shape === SHAPE.CROP || shape === SHAPE.TORCH || shape === SHAPE.FIRE;
    const hMax = flat ? 0.7 : 1;
    let n = 0;
    const limit = count ?? grid * grid * grid;
    for (let gx = 0; gx < grid && n < limit; gx++) for (let gy = 0; gy < grid && n < limit; gy++) for (let gz = 0; gz < grid && n < limit; gz++) {
      const fx = (gx + 0.5) / grid, fy = (gy + 0.5) / grid, fz = (gz + 0.5) / grid;
      const i = this._alloc(bx + fx + (R() - 0.5) * 0.2, by + fy * hMax, bz + fz + (R() - 0.5) * 0.2, null);
      if (i < 0) return this.count - n0;
      n++;
      this.vx[i] = (fx - 0.5) * 0.25 + (R() - 0.5) * 0.06;
      this.vy[i] = (fy - 0.5) * 0.15 + 0.08 + R() * 0.06;
      this.vz[i] = (fz - 0.5) * 0.25 + (R() - 0.5) * 0.06;
      this.grav[i] = 0.04; this.drag[i] = 0.98;
      this.life[i] = 10 + Math.floor(R() * 28);
      this.size[i] = 0.1 + R() * 0.09;
      // face texture: mostly sides, sometimes top/bottom (grass shows green + brown, logs bark + rings)
      const roll = R();
      const face = roll < 0.6 ? SIDE_FACES[Math.floor(R() * 4)] : (roll < 0.85 ? 2 : 3);
      const layer = faceLayer(id, state, face);
      this.layer[i] = layer;
      this.span[i] = 0.25;
      this.pickPatch(i, layer);
      this.flags[i] = F_COLLIDE;
      this.sky[i] = 15; this.block[i] = 0;
      if (world && world.getLight) {
        const l = lightAround(world, bx, by, bz);
        this.sky[i] = l >> 4; this.block[i] = l & 15;
      }
    }
    return this.count - n0;
  }

  /** Choose a 4x4 patch with enough opaque pixels (cutout textures such as flowers have lots of holes). */
  pickPatch(i, layer) {
    const R = this.rand;
    const px = this.texPixels ? this.texPixels(layer) : null;
    const list = px ? this.patchList(layer, px) : null;
    if (list && list.length) {
      const k = Math.floor(R() * (list.length / 2)) * 2;
      this.u0[i] = list[k] / 16; this.v0[i] = list[k + 1] / 16;
      return;
    }
    this.u0[i] = Math.floor(R() * 13) / 16; this.v0[i] = Math.floor(R() * 13) / 16;
  }

  /** Cached list of patch origins [pu, pv, ...] whose 4x4 pixels are mostly opaque (per layer + pixel source). */
  patchList(layer, px) {
    if (!this._patches) this._patches = new Map();
    const c = this._patches.get(layer);
    if (c && c.px === px.buffer && c.off === px.byteOffset) return c.list;
    const good = [], ok = [];
    for (let pv = 0; pv <= 12; pv++) for (let pu = 0; pu <= 12; pu++) {
      let n = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (px[((pv + y) * 16 + pu + x) * 4 + 3] > 127) n++;
      if (n >= 12) good.push(pu, pv); else if (n >= 6) ok.push(pu, pv);
    }
    const list = Int8Array.from(good.length ? good : ok);
    this._patches.set(layer, { px: px.buffer, off: px.byteOffset, list });
    return list;
  }

  /** Remove particle i (swap the last one into its slot). */
  kill(i) {
    const j = --this.count;
    if (i === j) return;
    for (const k of ParticleSim.FIELDS) this[k][i] = this[k][j];
  }

  /** One game tick: age, gravity, drag, collisions, light refresh, death. */
  tick(world, tickCount = 0) {
    const waterId = WATER_ID;
    for (let i = 0; i < this.count; i++) {
      this.age[i] += 1;
      if (this.age[i] >= this.life[i]) { this.kill(i); i--; continue; }
      const fl = this.flags[i];
      this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.pz[i] = this.z[i];
      this.vy[i] -= this.grav[i];
      let nx = this.x[i] + this.vx[i], ny = this.y[i] + this.vy[i], nz = this.z[i] + this.vz[i];
      if ((fl & F_COLLIDE) && world && world.getRaw) {
        // vertical first
        if (solidAt(world, this.x[i], ny, this.z[i])) {
          if (this.vy[i] < 0) { ny = Math.floor(ny) + topOf(world, this.x[i], ny, this.z[i]) + 0.001; this.vx[i] *= 0.7; this.vz[i] *= 0.7; } else ny = this.y[i];
          this.vy[i] = 0;
        }
        if (solidAt(world, nx, ny, this.z[i])) { nx = this.x[i]; this.vx[i] = 0; }
        if (solidAt(world, nx, ny, nz)) { nz = this.z[i]; this.vz[i] = 0; }
      }
      if ((fl & F_WATER) && world && world.getBlock) {
        if (world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz)) !== waterId) { this.kill(i); i--; continue; }
      }
      this.x[i] = nx; this.y[i] = ny; this.z[i] = nz;
      const d = this.drag[i];
      this.vx[i] *= d; this.vy[i] *= d; this.vz[i] *= d;
      if (((tickCount + i) % 10) === 0 && !(fl & F_FULLBRIGHT)) this.sampleLight(i, world);
    }
  }

  /** Sprite/layer index for drawing particle i (animated sprites change frame with age). */
  drawLayer(i) {
    const frames = this.frames[i];
    if (!frames) return this.layer[i];
    const t = Math.min(0.999, this.age[i] / Math.max(1, this.life[i]));
    const fl = this.flags[i];
    let f;
    if (fl & F_ANIM_LOOP) f = Math.floor(this.age[i] / 3) % frames;
    else if (fl & F_ANIM_REV) f = frames - 1 - Math.floor(t * frames);
    else f = Math.floor(t * frames);
    return -1 - (this.frame0[i] + f);
  }

  /** Size used for drawing (shrinking kinds get smaller toward the end). */
  drawSize(i, alpha = 0) {
    const s = this.size[i];
    if (!(this.flags[i] & F_SHRINK)) return s;
    const t = Math.min(1, (this.age[i] + alpha) / Math.max(1, this.life[i]));
    return s * (1 - t * t * 0.7);
  }
}
ParticleSim.FIELDS = ['x', 'y', 'z', 'px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 'size', 'grav', 'drag', 'layer', 'u0', 'v0', 'span',
  'r', 'g', 'b', 'sky', 'block', 'rot', 'frame0', 'frames', 'flags'];

let WATER_ID = 0;
for (let id = 1; id < 256; id++) if (B_LIQUID[id] === 1) { WATER_ID = id; break; }

function solidAt(world, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const v = world.getRaw(bx, by, bz);
  const id = v & 0xff;
  if (!id) return false;
  const boxes = getCollisionBoxes(id, v >> 8);
  if (!boxes.length) return false;
  const lx = x - bx, ly = y - by, lz = z - bz;
  for (const b of boxes) if (lx >= b[0] && lx <= b[3] && ly >= b[1] && ly <= b[4] && lz >= b[2] && lz <= b[5]) return true;
  return false;
}
function topOf(world, x, y, z) {
  const v = world.getRaw(Math.floor(x), Math.floor(y), Math.floor(z));
  const boxes = getCollisionBoxes(v & 0xff, v >> 8);
  let top = 0;
  for (const b of boxes) if (b[4] > top) top = Math.min(1, b[4]);
  return top || 1;
}

/* ------------------------------------------------------------------ GPU side */

/** One instanced mesh drawing every live particle (1 draw call). */
export class ParticleMesh {
  constructor(sim, shared, texRef) {
    this.sim = sim;
    const max = sim.max;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.iPos = inst(4); this.iUV = inst(4); this.iCol = inst(4); this.iMisc = inst(4);
    g.setAttribute('iPos', this.iPos); g.setAttribute('iUV', this.iUV); g.setAttribute('iCol', this.iCol); g.setAttribute('iMisc', this.iMisc);
    this.attrs = [this.iPos, this.iUV, this.iCol, this.iMisc];
    g.instanceCount = 0;
    this.geometry = g;
    const atlas = buildSpriteAtlas();
    this.spriteTex = pixelTexture(atlas.data, atlas.w, atlas.h);
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uTex: texRef.uniform, uSprites: { value: this.spriteTex } },
      defines: { SPRITE_COLS: SPRITE_COLS.toFixed(1) },
      vertexShader: /* glsl */`
        in vec4 iPos;
        in vec4 iUV;
        in vec4 iCol;
        in vec4 iMisc;
        out vec2 vUv;
        flat out float vLayer;
        out vec4 vCol;
        out vec3 vLight;
        out float vDist;
        ${GLSL_LIGHT}
        void main() {
          vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
          float c = cos(iMisc.z), s = sin(iMisc.z);
          vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          mv.xy += corner * iPos.w;
          vDist = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
          vec2 q = vec2(position.x + 0.5, 0.5 - position.y);
          vUv = iUV.yz + q * iUV.w;
          vLayer = iUV.x;
          vCol = iCol;
          vLight = iMisc.w > 0.5 ? vec3(1.0) : bcLight(iMisc.x, iMisc.y);
        }`,
      fragmentShader: /* glsl */`
        precision highp sampler2DArray;
        uniform sampler2DArray uTex;
        uniform sampler2D uSprites;
        in vec2 vUv;
        flat in float vLayer;
        in vec4 vCol;
        in vec3 vLight;
        in float vDist;
        ${GLSL_LIGHT}
        void main() {
          vec4 t;
          if (vLayer > -0.5) {
            t = texture(uTex, vec3(clamp(vUv, 0.001, 0.999), vLayer));
          } else {
            float idx = -vLayer - 1.0;
            vec2 cell = vec2(mod(idx, SPRITE_COLS), floor(idx / SPRITE_COLS));
            t = texture(uSprites, (cell + clamp(vUv, 0.01, 0.99)) / SPRITE_COLS);
          }
          if (t.a < 0.5) discard;
          vec3 c = t.rgb * vCol.rgb * vLight;
          gl_FragColor = vec4(bcFog(c, vDist), 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'fx-particles';
    this.mesh.matrixAutoUpdate = false;
  }

  /** Copy interpolated particle state into the instance buffers (call once per frame). */
  update(alpha) {
    const s = this.sim, n = s.count;
    const P = this.iPos.array, U = this.iUV.array, C = this.iCol.array, M = this.iMisc.array;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      P[o] = s.px[i] + (s.x[i] - s.px[i]) * alpha;
      P[o + 1] = s.py[i] + (s.y[i] - s.py[i]) * alpha;
      P[o + 2] = s.pz[i] + (s.z[i] - s.pz[i]) * alpha;
      P[o + 3] = s.drawSize(i, alpha);
      U[o] = s.drawLayer(i); U[o + 1] = s.u0[i]; U[o + 2] = s.v0[i]; U[o + 3] = s.span[i];
      C[o] = s.r[i]; C[o + 1] = s.g[i]; C[o + 2] = s.b[i]; C[o + 3] = 1;
      M[o] = s.sky[i]; M[o + 1] = s.block[i]; M[o + 2] = s.rot[i]; M[o + 3] = (s.flags[i] & F_FULLBRIGHT) ? 1 : 0;
    }
    if (n || this.lastCount) {
      for (let k = 0; k < 4; k++) {
        const a = this.attrs[k];
        a.clearUpdateRanges();
        if (n) { a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
      }
    }
    this.lastCount = n;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); this.spriteTex.dispose(); }
}
