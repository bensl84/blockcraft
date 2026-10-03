// OWNER LANE: FEATURE-MECH. Paintings (P1, SPEC §2.5): the `painting` item hangs a `painting` entity on a wall
// face, choosing the largest of 8 ORIGINAL procedurally painted pictures that fits (solid wall behind, free
// cells in front, no other painting there). Hitting it (or a nearby explosion, or losing the wall) takes it
// down and drops the item (survival).

import * as THREE from 'three';
import { Entity, registerEntityType } from '../entities/entity.js';
import { dropItem } from '../entities/item_entity.js';
import { registerItemUse } from '../core/hooks.js';
import { FACE, FACING_DIRS } from '../core/constants.js';
import { B_SOLID } from '../core/registry.js';
import { Rng } from '../core/math.js';
import { hasSolidSide } from './rules.js';

/** The 8 pictures: name, width x height in blocks. Ordered largest first. */
export const PICTURES = Object.freeze([
  { name: 'rainbow_hills', w: 4, h: 2 },
  { name: 'big_sun', w: 2, h: 2 },
  { name: 'night_sky', w: 2, h: 2 },
  { name: 'sailboat', w: 2, h: 1 },
  { name: 'tall_tree', w: 1, h: 2 },
  { name: 'flower', w: 1, h: 1 },
  { name: 'little_house', w: 1, h: 1 },
  { name: 'fish', w: 1, h: 1 },
]);

const FACE_TO_FACING = { [FACE.NORTH]: 0, [FACE.EAST]: 1, [FACE.SOUTH]: 2, [FACE.WEST]: 3 };

/** Cells covered by a picture hung from anchor cell (ax, ay, az) facing `f`, extending right/up. */
export function pictureCells(ax, ay, az, f, w, h) {
  const right = FACING_DIRS[(f + 1) & 3]; // to the viewer's left when facing it; consistent either way
  const out = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) out.push([ax + right[0] * i, ay + j, az + right[2] * i]);
  return out;
}

/** Largest picture (index into PICTURES) that fits at the anchor, or -1. Centres wide pictures on the anchor. */
export function choosePicture(getRaw, ax, ay, az, f, occupied = () => false) {
  const back = FACING_DIRS[(f + 2) & 3];
  const right = FACING_DIRS[(f + 1) & 3];
  for (let p = 0; p < PICTURES.length; p++) {
    const { w, h } = PICTURES[p];
    const ox = -Math.floor((w - 1) / 2), oy = -Math.floor((h - 1) / 2);
    const sx = ax + right[0] * ox, sz = az + right[2] * ox, sy = ay + oy;
    const cells = pictureCells(sx, sy, sz, f, w, h);
    let ok = true;
    for (const [x, y, z] of cells) {
      if (y < 0 || y > 127 || B_SOLID[getRaw(x, y, z) & 0xff] || !hasSolidSide(getRaw(x + back[0], y, z + back[2])) || occupied(x, y, z)) { ok = false; break; }
    }
    if (ok) return { index: p, x: sx, y: sy, z: sz };
  }
  return null;
}

/* ------------------------------------------------------------------ procedural art (original) */
const textureCache = new Map();
function pictureTexture(index) {
  if (textureCache.has(index)) return textureCache.get(index);
  if (typeof document === 'undefined') return null;
  const P = PICTURES[index];
  const c = document.createElement('canvas');
  c.width = P.w * 16; c.height = P.h * 16;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const rng = new Rng(0xb10c + index * 977);
  const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const noise = (cols, a = 0.15) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rng.chance(a)) rect(x, y, 1, 1, rng.pick(cols)); };
  switch (P.name) {
    case 'rainbow_hills': {
      rect(0, 0, W, H, '#8fd3ff');
      const bands = ['#e8473b', '#f39a2b', '#f7d43a', '#5cc248', '#3f8ee8', '#8a5ad6'];
      bands.forEach((col, i) => { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(W / 2, H + 4, 26 - i * 2, Math.PI, 0); g.stroke(); });
      for (let x = 0; x < W; x++) { const y = Math.round(H - 7 - 3 * Math.sin(x / 6) - 2 * Math.sin(x / 2.3)); rect(x, y, 1, H - y, x % 9 < 4 ? '#4fae3c' : '#5bbd45'); }
      rect(6, 3, 6, 2, '#ffffff'); rect(5, 4, 8, 2, '#ffffff'); rect(44, 5, 7, 2, '#ffffff');
      break;
    }
    case 'big_sun': {
      rect(0, 0, W, H, '#ffb85c'); rect(0, H / 2, W, H / 2, '#ff8a4a');
      g.fillStyle = '#fff2a0'; g.beginPath(); g.arc(W / 2, H / 2 + 2, 8, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; rect(Math.round(W / 2 + Math.cos(a) * 12) - 1, Math.round(H / 2 + 2 + Math.sin(a) * 12) - 1, 2, 2, '#fff2a0'); }
      rect(0, H - 6, W, 6, '#3a7bd5'); noise(['#5a9be5', '#2f6bc0'], 0.05);
      break;
    }
    case 'night_sky': {
      rect(0, 0, W, H, '#1c2450'); rect(0, H - 8, W, 8, '#2c3570');
      for (let i = 0; i < 18; i++) rect(rng.int(0, W - 1), rng.int(0, H - 10), 1, 1, rng.chance(0.3) ? '#ffe98a' : '#ffffff');
      g.fillStyle = '#f4f0d0'; g.beginPath(); g.arc(23, 8, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1c2450'; g.beginPath(); g.arc(25, 7, 4, 0, Math.PI * 2); g.fill();
      for (let x = 0; x < W; x++) rect(x, H - 4 - (x % 7 < 3 ? 1 : 0), 1, 4, '#142040');
      break;
    }
    case 'sailboat': {
      rect(0, 0, W, H, '#aee3ff'); rect(0, 10, W, 6, '#2f7fd8'); noise(['#5aa0ec'], 0.06);
      rect(11, 9, 12, 2, '#8a5a2c'); rect(13, 11, 8, 1, '#8a5a2c'); rect(16, 2, 1, 7, '#5a3a1c');
      for (let i = 0; i < 6; i++) rect(17, 2 + i, i + 1, 1, '#ffffff');
      for (let i = 0; i < 4; i++) rect(15 - i, 4 + i, i + 1, 1, '#f05a5a');
      rect(3, 2, 3, 3, '#fff27a');
      break;
    }
    case 'tall_tree': {
      rect(0, 0, W, H, '#bfe8ff'); rect(0, H - 5, W, 5, '#5bbd45');
      rect(7, 14, 2, 14, '#7a4f2c');
      g.fillStyle = '#3f9a3a'; g.beginPath(); g.arc(8, 11, 6, 0, Math.PI * 2); g.fill();
      noise(['#4fb04a', '#2f7a2c'], 0.08);
      rect(5, 9, 1, 1, '#e8473b'); rect(10, 12, 1, 1, '#e8473b'); rect(8, 7, 1, 1, '#e8473b');
      break;
    }
    case 'flower': {
      rect(0, 0, W, H, '#f6e7c8'); rect(7, 8, 2, 8, '#3f9a3a'); rect(9, 11, 3, 2, '#4fb04a');
      const pet = '#f2609a';
      rect(6, 2, 4, 2, pet); rect(6, 8, 4, 1, pet); rect(4, 4, 2, 4, pet); rect(10, 4, 2, 4, pet); rect(6, 4, 4, 4, '#ffd23a');
      rect(0, 0, W, 1, '#c79a5a'); rect(0, H - 1, W, 1, '#c79a5a'); rect(0, 0, 1, H, '#c79a5a'); rect(W - 1, 0, 1, H, '#c79a5a');
      break;
    }
    case 'little_house': {
      rect(0, 0, W, H, '#9fdcff'); rect(0, 13, W, 3, '#5bbd45');
      rect(3, 8, 10, 6, '#f4e2b0'); for (let i = 0; i < 6; i++) rect(2 + i, 8 - i, 12 - i * 2, 1, '#d24a3a');
      rect(7, 10, 2, 4, '#7a4f2c'); rect(4, 9, 2, 2, '#7ac6ff'); rect(10, 9, 2, 2, '#7ac6ff'); rect(11, 2, 2, 3, '#8a8a8a');
      break;
    }
    default: { // fish
      rect(0, 0, W, H, '#3a8fd8'); noise(['#4a9fe8', '#2f7fc8'], 0.12);
      rect(4, 6, 7, 4, '#ff9a3a'); rect(3, 7, 1, 2, '#ff9a3a'); rect(11, 5, 2, 6, '#ffb85c'); rect(12, 4, 2, 1, '#ffb85c'); rect(12, 11, 2, 1, '#ffb85c');
      rect(5, 7, 1, 1, '#ffffff'); rect(5, 7, 1, 1, '#1c1c1c'); rect(7, 6, 1, 4, '#ffffff');
      rect(2, 2, 1, 1, '#d8f0ff'); rect(3, 1, 1, 1, '#d8f0ff');
      break;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  textureCache.set(index, tex);
  return tex;
}

/* ------------------------------------------------------------------ entity */
export class Painting extends Entity {
  constructor(game, x, y, z, opts = {}) {
    super('painting', x, y, z);
    this.category = 'other';
    this.noGravity = true;
    const index = Math.max(0, Math.min(PICTURES.length - 1, opts.index | 0));
    const P = PICTURES[index];
    this.data = { index, facing: opts.facing & 3, ax: opts.ax | 0, ay: opts.ay | 0, az: opts.az | 0 };
    this.width = Math.max(P.w, 1); this.height = P.h;
    this.health = 1; this.maxHealth = 1;
    this.checkTimer = 0;
    this._game = game;
    this.object3d = makePictureObject(game, index, this.data.facing);
  }

  /** Thin hitbox flat on the wall. */
  getBox(out = {}) {
    const P = PICTURES[this.data.index], f = this.data.facing;
    const alongX = f === 0 || f === 2;
    const hw = P.w / 2, t = 1 / 32;
    out.minX = this.x - (alongX ? hw : t); out.maxX = this.x + (alongX ? hw : t);
    out.minZ = this.z - (alongX ? t : hw); out.maxZ = this.z + (alongX ? t : hw);
    out.minY = this.y; out.maxY = this.y + P.h;
    return out;
  }

  tick(game) {
    this.age++;
    this.vx = this.vy = this.vz = 0;
    if (++this.checkTimer >= 10) {
      this.checkTimer = 0;
      const P = PICTURES[this.data.index], f = this.data.facing, back = FACING_DIRS[(f + 2) & 3];
      for (const [x, y, z] of pictureCells(this.data.ax, this.data.ay, this.data.az, f, P.w, P.h)) {
        const getRaw = game.mechanics.getRaw;
        if (B_SOLID[getRaw(x, y, z) & 0xff] || !hasSolidSide(getRaw(x + back[0], y, z + back[2]))) { this.popOff(game); return; }
      }
    }
  }

  /** Any hit (player, explosion) takes the painting down. */
  hurt() { this.popOff(this._game); return true; }

  popOff(game) {
    if (this.removed) return;
    this.remove();
    if (!game.isCreative()) dropItem(game, { item: 'painting', count: 1 }, this.x, this.y + 0.5, this.z);
    game.events.emit('mech:painting', { id: this.id, x: this.x, y: this.y, z: this.z, removed: true });
  }

  render(game, alpha) {
    const o = this.object3d;
    if (!o) return;
    o.position.set(this.x, this.y + PICTURES[this.data.index].h / 2, this.z);
    const u = o.material && o.material.uniforms;
    if (u && game.world) {
      const d = FACING_DIRS[this.data.facing];
      const l = game.world.getLight(Math.floor(this.x + d[0] * 0.3), Math.floor(this.y + 0.5), Math.floor(this.z + d[2] * 0.3));
      if (u.uLightSky) u.uLightSky.value = l >> 4;
      if (u.uLightBlock) u.uLightBlock.value = l & 15;
    }
  }

  serialize() { return { ...super.serialize(), data: { ...this.data } }; }

  dispose(game) {
    const o = this.object3d;
    if (o) {
      if (game.renderer) game.renderer.removeObject(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
    }
    this.object3d = null;
  }
}

function makePictureObject(game, index, facing) {
  const r = game.renderer;
  if (!r || !r.createEntityMaterial) return null;
  const tex = pictureTexture(index);
  if (!tex) return null;
  const P = PICTURES[index];
  const geo = new THREE.PlaneGeometry(P.w, P.h);
  const mat = r.createEntityMaterial({ map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  // PlaneGeometry faces +Z; facing 0 = north (-Z)
  mesh.rotation.y = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][facing & 3];
  r.addObject(mesh);
  return mesh;
}

/** Feet position for a picture anchored at cell (sx, sy, sz) (bottom-left cell) facing f. */
function picturePosition(sx, sy, sz, f, P) {
  const right = FACING_DIRS[(f + 1) & 3], back = FACING_DIRS[(f + 2) & 3];
  const cx = sx + 0.5 + right[0] * (P.w - 1) / 2 + back[0] * (0.5 - 1 / 32);
  const cz = sz + 0.5 + right[2] * (P.w - 1) / 2 + back[2] * (0.5 - 1 / 32);
  return { x: cx, y: sy, z: cz };
}

let registered = false;
export function registerPaintings(game, mech) {
  if (!registered) {
    registered = true;
    registerEntityType('painting', {
      create: (g, x, y, z, opts = {}) => new Painting(g, x, y, z, opts),
      persistent: true, category: 'other',
    });
  }
  /** Hang a painting on the wall face hit (side faces only). Returns the entity or null. */
  mech.hangPainting = (hit, action = 0) => {
    if (!hit || hit.face === FACE.UP || hit.face === FACE.DOWN || !game.entities) return null;
    const f = FACE_TO_FACING[hit.face];
    if (f === undefined) return null;
    const ax = hit.x + hit.nx, ay = hit.y + hit.ny, az = hit.z + hit.nz;
    const occupied = (x, y, z) => game.entities.ofType('painting').some((p) => {
      const P = PICTURES[p.data.index];
      return p.data.facing === f && pictureCells(p.data.ax, p.data.ay, p.data.az, f, P.w, P.h).some(([a, b, c]) => a === x && b === y && c === z);
    });
    const pick = choosePicture(mech.getRaw, ax, ay, az, f, occupied);
    if (!pick) return null;
    const P = PICTURES[pick.index];
    const pos = picturePosition(pick.x, pick.y, pick.z, f, P);
    const e = game.entities.spawn('painting', pos.x, pos.y, pos.z, { index: pick.index, facing: f, ax: pick.x, ay: pick.y, az: pick.z, reason: 'placed' });
    if (e) game.events.emit('mech:painting', { id: e.id, x: pos.x, y: pos.y, z: pos.z, picture: P.name, action });
    return e;
  };
  registerItemUse('painting', (ctx) => {
    const e = mech.hangPainting(ctx.hit, ctx.action);
    if (!e) return false;
    if (!game.isCreative() && game.inventory) game.inventory.consumeSelected(1);
    if (game.player && game.player.swing) game.player.swing();
    return true;
  });
}
