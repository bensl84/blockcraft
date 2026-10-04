// OWNER LANE: FEATURE-FX. 3D item meshes (SPEC §8.7 makeItemMesh, §5.5.5): block items are a mini block
// (CORE-C meshBlockModel geometry sampled from the block array texture), flat items are an extruded 16x16 sprite
// (one coloured voxel layer, 1/16 thick). Geometry is CACHED per item key and SHARED by every dropped item, held
// item and third-person hand item; disposeItemMesh() never disposes the shared geometry (draw-call and memory
// budget, SPEC §12). Per-object world light is applied in onBeforeRender (shared material, per-draw uniforms).

import * as THREE from 'three';
import { getItem } from '../data/items.js';
import { itemPlaces } from '../core/registry.js';
import { meshBlockModel } from '../world/mesher.js';
import { getTexturePixels } from '../textures/textures.js';

/** Dropped item sizes (blocks): block items 0.25 wide, flat items 0.5 wide - like the classic game. */
export const ITEM_SCALE_BLOCK = 0.25;
export const ITEM_SCALE_FLAT = 0.5;

/**
 * Extrude a 16x16 RGBA sprite into a coloured voxel slab. Pure.
 * Output space: x in [-0.5, 0.5] (left to right), y in [0, 1] (pixel row 0 = top = y 1), z in [-1/32, 1/32].
 * Face shade is baked into the colours (front 1.0, back 0.8, top 1.0, bottom 0.55, sides 0.7).
 * @param {ArrayLike<number>} px RGBA, 16*16*4, row 0 = top
 * @returns {{position: Float32Array, color: Uint8Array, index: Uint32Array, quads: number}}
 */
export function extrudeSprite(px, size = 16) {
  const pos = [], col = [];
  let quads = 0;
  const S = size, t = 0.5 / S;
  const opaque = (x, y) => x >= 0 && y >= 0 && x < S && y < S && px[(y * S + x) * 4 + 3] > 127;
  const quad = (a, b, c, d, r, g, bl, shade) => {
    pos.push(...a, ...b, ...c, ...d);
    const R = Math.round(r * shade), G = Math.round(g * shade), B = Math.round(bl * shade);
    for (let k = 0; k < 4; k++) col.push(R, G, B);
    quads++;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!opaque(x, y)) continue;
    const i = (y * S + x) * 4;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const x0 = x / S - 0.5, x1 = (x + 1) / S - 0.5, y1 = 1 - y / S, y0 = 1 - (y + 1) / S;
    quad([x0, y0, t], [x1, y0, t], [x1, y1, t], [x0, y1, t], r, g, b, 1.0);        // front (+Z)
    quad([x1, y0, -t], [x0, y0, -t], [x0, y1, -t], [x1, y1, -t], r, g, b, 0.8);    // back (-Z)
    if (!opaque(x, y - 1)) quad([x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t], r, g, b, 1.0);   // top
    if (!opaque(x, y + 1)) quad([x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t], r, g, b, 0.55);  // bottom
    if (!opaque(x + 1, y)) quad([x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t], r, g, b, 0.7);   // right
    if (!opaque(x - 1, y)) quad([x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t], r, g, b, 0.7);   // left
  }
  const index = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const b = q * 4, o = q * 6;
    index[o] = b; index[o + 1] = b + 1; index[o + 2] = b + 2; index[o + 3] = b; index[o + 4] = b + 2; index[o + 5] = b + 3;
  }
  return { position: new Float32Array(pos), color: new Uint8Array(col), index, quads };
}

/** BufferGeometry from meshBlockModel() output (chunk vertex format; SPEC §5.4). */
export function blockModelGeometry(id, state = 0) {
  const mb = meshBlockModel(id, state);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mb.position, 3));
  g.setAttribute('aTex', new THREE.BufferAttribute(mb.tex, 4));
  g.setAttribute('aLight', new THREE.BufferAttribute(mb.light, 4));
  const idx = new Uint16Array(mb.quads * 6);
  for (let q = 0; q < mb.quads; q++) {
    const b = q * 4, o = q * 6;
    idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 0.9);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  return g;
}

/** BufferGeometry of an extruded sprite. */
export function spriteGeometry(px) {
  const e = extrudeSprite(px);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(e.position, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(e.color, 3, true));
  g.setIndex(new THREE.BufferAttribute(e.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 0.75);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.05), new THREE.Vector3(0.5, 1, 0.05));
  return g;
}

/**
 * How an item is drawn: {kind: 'block', id, state} or {kind: 'flat', pixels: () => RGBA16x16}.
 * Icons: 'iso:<block>' -> 3D block; 'tex:<key>' -> extruded block texture; 'sprite:<name>' -> extruded icon.
 */
export function itemVisual(game, itemKey) {
  const def = getItem(itemKey);
  const icon = def ? def.icon : '';
  if (icon.startsWith('iso:')) {
    const pl = itemPlaces(itemKey);
    if (pl) return { kind: 'block', id: pl.id, state: pl.state || 0 };
  }
  if (icon.startsWith('tex:') && game.textures) {
    const key = icon.slice(4);
    return { kind: 'flat', pixels: () => getTexturePixels(game.textures, key) };
  }
  if (def && game.icons && game.icons.pixels16) {
    return { kind: 'flat', pixels: () => game.icons.pixels16(itemKey) };
  }
  return { kind: 'flat', pixels: () => fallbackPixels() };
}

function fallbackPixels() {
  const px = new Uint8Array(16 * 16 * 4);
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
    const i = (y * 16 + x) * 4;
    const edge = x === 3 || y === 3 || x === 12 || y === 12;
    px[i] = px[i + 1] = px[i + 2] = edge ? 60 : 150; px[i + 3] = 255;
  }
  return px;
}

/**
 * Cache of shared item geometries + the shared world-space materials.
 */
export class ItemMeshFactory {
  constructor(game, materials) {
    this.game = game;
    /** {atlas: ShaderMaterial, color: ShaderMaterial, hook: onBeforeRender} */
    this.materials = materials;
    /** itemKey -> {geometry, kind, scale, colors} */
    this.cache = new Map();
    this.live = 0;
  }

  /** Shared geometry entry for an item key (built once). */
  entry(itemKey) {
    let e = this.cache.get(itemKey);
    if (e) return e;
    const v = itemVisual(this.game, itemKey);
    let geometry, colors = null;
    if (v.kind === 'block') {
      geometry = blockModelGeometry(v.id, v.state);
    } else {
      let px = null;
      try { px = v.pixels(); } catch { px = null; }
      if (!px || px.length < 1024) px = fallbackPixels();
      geometry = spriteGeometry(px);
      colors = paletteOf(px);
    }
    geometry.name = 'fx-item:' + itemKey;
    e = { geometry, kind: v.kind, scale: v.kind === 'block' ? ITEM_SCALE_BLOCK : ITEM_SCALE_FLAT, colors, id: v.id, state: v.state };
    this.cache.set(itemKey, e);
    return e;
  }

  /** A few representative colours of an item (0..1 rgb) - crumbs when eating / a tool breaking. */
  colorsOf(itemKey) {
    const e = this.entry(itemKey);
    if (e.colors) return e.colors;
    return null;
  }

  /**
   * New Object3D for an item: a Group (origin = bottom centre, ~0.25 blocks for block items, ~0.5 wide for flat
   * items) containing one Mesh that shares the cached geometry + material. The caller adds it to the scene
   * (renderer.addObject) and may freely set the group's position/rotation (bob, spin).
   */
  make(itemKey, opts = {}) {
    const e = this.entry(itemKey);
    const mat = opts.material || (e.kind === 'block' ? this.materials.atlas : this.materials.color);
    const mesh = new THREE.Mesh(e.geometry, mat);
    mesh.scale.setScalar(e.scale * (opts.scale ?? 1));
    if (e.kind === 'flat') mesh.position.y = 0;
    mesh.onBeforeRender = opts.hook || this.materials.hook;
    mesh.userData.fxItemMesh = true;
    const group = new THREE.Group();
    group.name = 'item:' + itemKey;
    group.add(mesh);
    group.userData.itemKey = itemKey;
    group.userData.fxKind = e.kind;
    group.userData.fxMesh = mesh;
    this.live++;
    return group;
  }

  /** Release an Object3D made by make(): detach it; the shared geometry and material stay cached. */
  dispose(obj) {
    if (!obj || obj.userData.fxDisposed) return;
    obj.userData.fxDisposed = true;
    if (obj.parent) obj.parent.remove(obj);
    const m = obj.userData.fxMesh;
    if (m) { obj.remove(m); m.onBeforeRender = noop; }
    obj.userData.fxMesh = null;
    this.live = Math.max(0, this.live - 1);
  }

  /** Free every cached geometry (world teardown is NOT a reason; only full disposal). */
  disposeAll() { for (const e of this.cache.values()) e.geometry.dispose(); this.cache.clear(); }
}

function noop() {}

/** Up to 6 distinct opaque colours of a sprite (0..1), most common first. */
export function paletteOf(px) {
  const counts = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const k = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    const c = counts.get(k);
    if (c) c.n++; else counts.set(k, { n: 1, rgb: [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255] });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 6).map((c) => c.rgb);
}
