// OWNER LANE: FEATURE-FX. Visuals attached to the targeted block (SPEC §8.7):
//  - mining crack overlay: the block's selection boxes at 1.002 scale textured with crack_<stage>, multiply
//    blended, depthWrite off, polygonOffset -1; driven by interaction.mining and the block:mining events.
//  - kid ghost block: a translucent (alpha ~0.35, gently pulsing) preview of the held placeable block in the
//    cell a tap would fill (kid scheme, while the cursor hovers a target).

import * as THREE from 'three';
import {
  B_OPAQUE, B_SHAPE, B_SOLID, SHAPE, blockDef, getCollisionBoxes, getSelectionBoxes, isReplaceable, itemPlaces,
} from '../core/registry.js';
import { WORLD_HEIGHT } from '../core/constants.js';
import { placementState } from '../player/interaction.js';
import { FACE_CORNERS } from '../world/mesher.js';
import { blockModelGeometry } from './itemmesh.js';

/* ------------------------------------------------------------------ crack geometry (pure) */

/**
 * Quads for every face of every box, inflated about the box centre by `grow` (1.002 => 0.1% each side), with
 * texture coordinates projected from block-local positions (so cracks line up like the block texture).
 * @returns {{position: Float32Array, tex: Uint16Array, light: Uint8Array, index: Uint16Array, quads: number}}
 */
export function crackGeometryData(boxes, layer, grow = 1.002) {
  const n = boxes.length * 6;
  const position = new Float32Array(n * 12), tex = new Uint16Array(n * 16), light = new Uint8Array(n * 16), index = new Uint16Array(n * 6);
  let q = 0;
  for (const b of boxes) {
    const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
    const ex = (b[3] - b[0]) / 2 * grow + 0.001, ey = (Math.min(1, b[4]) - b[1]) / 2 * grow + 0.001, ez = (b[5] - b[2]) / 2 * grow + 0.001;
    const lo = [cx - ex, cy - ey, cz - ez], hi = [cx + ex, cy + ey, cz + ez];
    const cyy = (b[1] + Math.min(1, b[4])) / 2;
    lo[1] = cyy - ey; hi[1] = cyy + ey;
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 4; k++) {
        const c = FACE_CORNERS[f][k];
        const x = c[0] ? hi[0] : lo[0], y = c[1] ? hi[1] : lo[1], z = c[2] ? hi[2] : lo[2];
        const o = (q * 4 + k);
        position[o * 3] = x; position[o * 3 + 1] = y; position[o * 3 + 2] = z;
        const cl = (v) => Math.max(0, Math.min(1, v));
        let u, v;
        switch (f) {
          case 0: u = 1 - z; v = 1 - y; break;   // east
          case 1: u = z; v = 1 - y; break;       // west
          case 2: u = x; v = z; break;           // up
          case 3: u = x; v = 1 - z; break;       // down
          case 4: u = x; v = 1 - y; break;       // south
          default: u = 1 - x; v = 1 - y;         // north
        }
        tex[o * 4] = layer; tex[o * 4 + 1] = Math.round(cl(u) * 256); tex[o * 4 + 2] = Math.round(cl(v) * 256); tex[o * 4 + 3] = f;
        light[o * 4] = 240; light[o * 4 + 1] = 0; light[o * 4 + 2] = 3; light[o * 4 + 3] = 255;
      }
      const b4 = q * 4, i6 = q * 6;
      index[i6] = b4; index[i6 + 1] = b4 + 1; index[i6 + 2] = b4 + 2; index[i6 + 3] = b4; index[i6 + 4] = b4 + 2; index[i6 + 5] = b4 + 3;
      q++;
    }
  }
  return { position, tex, light, index, quads: q };
}

export class CrackOverlay {
  constructor(game, material) {
    this.game = game;
    this.material = material;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.name = 'fx-crack';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.key = '';
    this.stage = -1;
    /** mining state reconstructed from events while interaction.mining is unavailable */
    this.evt = null;
  }

  onMining(e) { this.evt = { x: e.x, y: e.y, z: e.z, id: e.id, stage: e.stage | 0 }; }
  onStop(e) { if (this.evt && (!e || (e.x === this.evt.x && e.y === this.evt.y && e.z === this.evt.z))) this.evt = null; }

  /** Current mining {x,y,z,id,stage} or null. */
  current() {
    const ix = this.game.interaction;
    const m = ix && ix.mining;
    if (m && Number.isFinite(m.x)) {
      const stage = Number.isFinite(m.stage) ? m.stage : Math.floor((m.progress || 0) * 10);
      return { x: m.x, y: m.y, z: m.z, id: m.id, stage };
    }
    const e = this.evt;
    if (e) {
      const w = this.game.world;
      if (!w || !w.getBlock || w.getBlock(e.x, e.y, e.z) !== e.id) { this.evt = null; return null; }
      return e;
    }
    return null;
  }

  update(layerOf) {
    const m = this.game.meta ? this.current() : null;
    if (!m || m.stage < 0) { this.mesh.visible = false; this.key = ''; return; }
    const w = this.game.world;
    const raw = w && w.getRaw ? w.getRaw(m.x, m.y, m.z) : 0;
    const id = raw & 0xff, state = raw >> 8;
    let boxes = id ? getSelectionBoxes(id, state) : null;
    if (!boxes || !boxes.length) boxes = [[0, 0, 0, 1, 1, 1]];
    const stage = Math.max(0, Math.min(9, m.stage | 0));
    const key = `${m.x},${m.y},${m.z},${raw}`;
    if (key !== this.key) {
      const d = crackGeometryData(boxes, layerOf(stage));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
      g.setAttribute('aTex', new THREE.BufferAttribute(d.tex, 4));
      g.setAttribute('aLight', new THREE.BufferAttribute(d.light, 4));
      g.setIndex(new THREE.BufferAttribute(d.index, 1));
      this.mesh.geometry.dispose();
      this.mesh.geometry = g;
      this.key = key;
      this.stage = stage;
    } else if (stage !== this.stage) {
      const a = this.mesh.geometry.getAttribute('aTex');
      const layer = layerOf(stage);
      for (let i = 0; i < a.count; i++) a.array[i * 4] = layer;
      a.needsUpdate = true;
      this.stage = stage;
    }
    this.mesh.position.set(m.x, m.y, m.z);
    this.mesh.visible = true;
  }

  dispose() { this.mesh.geometry.dispose(); if (this.mesh.parent) this.mesh.parent.remove(this.mesh); }
}

/* ------------------------------------------------------------------ ghost block */

/** Solid block whose collision reaches the top of the cell (floor support; mirrors CORE-E interaction). */
function hasSolidTop(world, x, y, z) {
  const v = world.getRaw(x, y, z), id = v & 0xff;
  if (!B_SOLID[id]) return false;
  for (const b of getCollisionBoxes(id, v >> 8)) if (b[4] >= 1 - 1e-6) return true;
  return false;
}
/** Full solid cube (wall support for torches and ladders; mirrors CORE-E interaction). */
function isWallSupport(world, x, y, z) {
  const id = world.getRaw(x, y, z) & 0xff;
  return B_OPAQUE[id] === 1 || (B_SOLID[id] === 1 && B_SHAPE[id] === SHAPE.CUBE);
}

/**
 * Where (and as what) a tap would place the held item. Pure (world, player and hit are plain objects).
 * Follows CORE-E's default placement (interaction.js tryPlace): the same target cell, the same
 * `placementState` rules and the same support checks, so the ghost never promises a block that will not go in.
 * @param {{getRaw: Function}} world
 * @param {{x,y,z,nx,ny,nz,face?,py?}} hit RayHit
 * @param {string|null} itemKey
 * @param {{x,y,z,width,height,yaw}} player
 * @returns {{x:number,y:number,z:number,id:number,state:number}|null}
 */
export function ghostPlacement(world, hit, itemKey, player) {
  if (!hit || !itemKey) return null;
  const pl = itemPlaces(itemKey);
  if (!pl) return null;
  const id = pl.id;
  const def = blockDef(id);
  if (!def) return null;
  let x = hit.x, y = hit.y, z = hit.z;
  const hitId = world.getRaw(x, y, z) & 0xff;
  const replaceHit = isReplaceable(hitId) && hitId !== id;
  if (!replaceHit) { x += hit.nx; y += hit.ny; z += hit.nz; }
  if (y < 0 || y >= WORLD_HEIGHT) return null;
  const cur = world.getRaw(x, y, z) & 0xff;
  if (!isReplaceable(cur) || cur === id) return null;
  // replacing the hit cell (grass, snow) acts as its top face
  const face = replaceHit ? { face: 2, nx: 0, ny: 1, nz: 0, py: hit.y } : { ...hit, py: Number.isFinite(hit.py) ? hit.py : hit.y + 0.5 };
  const state = placementState(id, pl.state || 0, face, player ? player.yaw : 0, (a, b, c) => world.getRaw(a, b, c), [x, y, z]);
  if (state < 0) return null;
  // support rules
  if (def.placeOn) {
    const below = blockDef(world.getRaw(x, y - 1, z) & 0xff);
    if (!below || !def.placeOn.includes(below.name)) return null;
  } else if (def.support === 'floor' && !hasSolidTop(world, x, y - 1, z)) return null;
  if (def.support === 'floor_or_wall' && B_SHAPE[id] === SHAPE.TORCH) {
    if ((state & 7) === 0) { if (!hasSolidTop(world, x, y - 1, z)) return null; }
    else {
      const d = ((state & 7) - 1) & 3;
      if (!isWallSupport(world, x + [0, 1, 0, -1][d], y, z + [-1, 0, 1, 0][d])) return null;
    }
  }
  if (def.support === 'wall') {
    const back = ((state & 3) + 2) & 3;
    if (!isWallSupport(world, x + [0, 1, 0, -1][back], y, z + [-1, 0, 1, 0][back])) return null;
  }
  // a solid block must not overlap the player
  if (B_SOLID[id] && player) {
    const hw = (player.width || 0.6) / 2, h = player.height || 1.8;
    for (const b of getCollisionBoxes(id, state)) {
      if (x + b[0] < player.x + hw && x + b[3] > player.x - hw && y + b[1] < player.y + h && y + b[4] > player.y
        && z + b[2] < player.z + hw && z + b[5] > player.z - hw) return null;
    }
  }
  return { x, y, z, id, state };
}

export class GhostBlock {
  constructor(game, material) {
    this.game = game;
    this.material = material;
    this.geos = new Map();       // (id<<8|state) -> geometry (bounded by the number of distinct blocks)
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.name = 'fx-ghost';
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
    this.mesh.scale.setScalar(0.98);
    this.placement = null;
    this.time = 0;
  }

  geometryFor(id, state) {
    const k = (id << 8) | state;
    let g = this.geos.get(k);
    if (!g) { g = blockModelGeometry(id, state); this.geos.set(k, g); }
    return g;
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    const input = g.input, ix = g.interaction, p = g.player;
    let pl = null;
    const kid = g.settings && g.settings.controls === 'kid';
    if (kid && g.meta && g.state === 'playing' && input && input.aimActive && !(input.isCaptured && input.isCaptured())
      && ix && ix.target && !ix.targetEntity && p && !p.dead) {
      const s = g.inventory && g.inventory.getSelected ? g.inventory.getSelected() : null;
      if (s) {
        try { pl = ghostPlacement(g.world, ix.target, s.item, p); } catch { pl = null; }
      }
    }
    // a ghost right in front of the eye fills the screen with a tinted box (e.g. aiming at tall grass at your
    // feet): hide it when the cell is within ~1.3 blocks of the eye and fade it in over the next block
    let near = 1;
    if (pl && p.getEyePos) {
      const e = p.getEyePos(this._eye || (this._eye = { x: 0, y: 0, z: 0 }));
      const d = Math.hypot(pl.x + 0.5 - e.x, pl.y + 0.5 - e.y, pl.z + 0.5 - e.z);
      near = Math.max(0, Math.min(1, (d - 1.3) / 1.0));
      if (near <= 0) pl = null;
    }
    this.placement = pl;
    if (!pl) { this.mesh.visible = false; return; }
    const geo = this.geometryFor(pl.id, pl.state);
    if (this.mesh.geometry !== geo) this.mesh.geometry = geo;
    this.mesh.position.set(pl.x + 0.5, pl.y + 0.01, pl.z + 0.5);
    // steady 38-46 % with a slow pulse (the ghost material lifts the texture toward white and skips world light)
    this.material.uniforms.uAlpha.value = (0.42 + Math.sin(this.time * 2.5) * 0.04) * near;
    this.material.uniforms.uLightSky.value = 15;
    this.material.uniforms.uLightBlock.value = 15;
    this.mesh.visible = true;
  }

  dispose() { for (const geo of this.geos.values()) geo.dispose(); this.geos.clear(); if (this.mesh.parent) this.mesh.parent.remove(this.mesh); }
}
