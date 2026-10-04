// OWNER LANE: FEATURE-MECH. MECH entity types (SPEC §8.6 "Registrations"):
//   falling_block - sand/gravel that lost its support (gravity 0.04, drag 0.98); lands and places itself, or
//                   drops as an item when the landing cell is not replaceable.
//   tnt           - primed TNT: hops 0.2 b/t up with up to 0.02 sideways, 80-tick fuse (10-30 when set off by an
//                   explosion), flashes white every 5 ticks, swells to 1.3x over the last 10 ticks, then explodes.
// Both render with renderer.createBlockModel(id, state) wrapped so the model is centred on the entity.

import * as THREE from 'three';
import { Entity, registerEntityType } from '../entities/entity.js';
import { dropItem } from '../entities/item_entity.js';
import { ENTITY_PHYS } from '../core/constants.js';
import { ID, blockItem } from '../core/registry.js';
import { moveAndCollide } from '../player/physics.js';

/** CORE-E collision (per-axis, unloaded columns are solid); a blocked axis stops that velocity. */
function moveEntity(game, e) {
  const ovx = e.vx, ovy = e.vy, ovz = e.vz;
  const r = moveAndCollide(game.world, e, ovx, ovy, ovz);
  if (r.dx !== ovx) e.vx = 0;
  if (r.dy !== ovy) e.vy = 0;
  if (r.dz !== ovz) e.vz = 0;
}

/** Block model centred on the entity: x/z centred, bottom at y = 0 (or centred when `centre`). */
function makeBlockObject(game, id, state, centre) {
  const r = game.renderer;
  if (!r || typeof r.createBlockModel !== 'function') return null;
  let mesh = null;
  try { mesh = r.createBlockModel(id, state); } catch (err) { game.reportError(err, 'mechanics createBlockModel'); return null; }
  if (!mesh) return null;
  const g = mesh.geometry;
  const group = new THREE.Group();
  group.add(mesh);
  if (g && g.computeBoundingBox) {
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const sy = bb.max.y - bb.min.y;
    mesh.position.set(-cx, centre ? -(bb.min.y + sy / 2) : -bb.min.y, -cz);
  }
  group.userData.mesh = mesh;
  r.addObject(group);
  return group;
}

function disposeBlockObject(game, obj) {
  if (!obj) return;
  if (game.renderer) game.renderer.removeObject(obj);
  const mesh = obj.userData.mesh;
  if (mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material && mesh.material.dispose) mesh.material.dispose();
  }
}

function setEntityLight(game, obj, x, y, z) {
  const mesh = obj && obj.userData.mesh;
  const u = mesh && mesh.material && mesh.material.uniforms;
  if (!u || !game.world) return;
  const l = game.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
  if (u.uLightSky) u.uLightSky.value = l >> 4;
  if (u.uLightBlock) u.uLightBlock.value = l & 15;
}


/* ------------------------------------------------------------------ falling block */
export class FallingBlock extends Entity {
  constructor(game, x, y, z, opts = {}) {
    super('falling_block', x, y, z);
    this.width = 0.98; this.height = 0.98;
    this.category = 'block';
    this.data = { block: opts.block | 0 || ID.sand, state: opts.state | 0, action: opts.action | 0, time: opts.time | 0 };
    this.vy = Number.isFinite(opts.vy) ? opts.vy : 0;
    this.object3d = makeBlockObject(game, this.data.block, this.data.state, false);
  }

  tick(game) {
    super.tick(game);
    const d = this.data;
    d.time++;
    if (!this.noGravity) this.vy -= ENTITY_PHYS.GRAVITY;
    moveEntity(game, this);
    this.vx *= ENTITY_PHYS.DRAG; this.vy *= ENTITY_PHYS.DRAG; this.vz *= ENTITY_PHYS.DRAG;
    if (this.y < -8 || d.time > 600) { this.remove(); return; }
    if (this.onGround) {
      this.vx *= 0.7; this.vz *= 0.7;
      const bx = Math.floor(this.x), by = Math.floor(this.y + 0.5), bz = Math.floor(this.z);
      game.mechanics.landFallingBlock(this, bx, by, bz);
      this.remove();
    }
  }

  render(game, alpha) {
    super.render(game, alpha);
    if (this.object3d) setEntityLight(game, this.object3d, this.x, this.y + 0.5, this.z);
  }

  dispose(game) { disposeBlockObject(game, this.object3d); this.object3d = null; }
}

/* ------------------------------------------------------------------ primed TNT */
export class PrimedTnt extends Entity {
  constructor(game, x, y, z, opts = {}) {
    super('tnt', x, y, z);
    this.width = 0.98; this.height = 0.98;
    this.category = 'block';
    // `action` is the undo action of whatever lit it (a tap, or the explosion that chain-primed it); the blast
    // reuses it so a whole chain is ONE undo entry. A loaded save drops it: action ids restart every session.
    this.data = { fuse: Number.isFinite(opts.fuse) ? opts.fuse | 0 : 80, action: opts.loaded ? 0 : opts.action | 0, source: opts.source || 'tnt' };
    this.fuseStart = Math.max(1, this.data.fuse);
    if (opts.hop !== false && !opts.loaded) {
      const a = (game.rand ? game.rand() : 0.5) * Math.PI * 2;
      this.vy = 0.2;
      this.vx = -Math.sin(a) * 0.02;
      this.vz = -Math.cos(a) * 0.02;
    }
    this.object3d = makeBlockObject(game, ID.tnt, 0, true);
  }

  tick(game) {
    super.tick(game);
    this.vy -= ENTITY_PHYS.GRAVITY;
    moveEntity(game, this);
    this.vx *= ENTITY_PHYS.DRAG; this.vy *= ENTITY_PHYS.DRAG; this.vz *= ENTITY_PHYS.DRAG;
    if (this.onGround) { this.vx *= 0.7; this.vz *= 0.7; }
    if (this.y < -16) { this.remove(); return; }
    this.data.fuse--;
    if (this.data.fuse <= 0) {
      this.remove();
      game.mechanics.queueExplosion(this.x, this.y + 0.98 / 16, this.z, 4, { source: this.data.source === 'test' ? 'test' : 'tnt', action: this.data.action });
    }
  }

  /** Flash white every 5 ticks; swell to 1.3x over the last 10 ticks. */
  render(game, alpha) {
    const o = this.object3d;
    if (!o) return;
    o.position.set(this.prevX + (this.x - this.prevX) * alpha, this.prevY + (this.y - this.prevY) * alpha + 0.49, this.prevZ + (this.z - this.prevZ) * alpha);
    const fuse = this.data.fuse - alpha;
    let s = 1;
    if (fuse < 10) { const f = Math.min(1, Math.max(0, 1 - fuse / 10)); s = 1 + 0.3 * f * f; }
    o.scale.setScalar(s);
    const mesh = o.userData.mesh;
    const u = mesh && mesh.material && mesh.material.uniforms;
    const flash = Math.floor(this.data.fuse / 5) % 2 === 0;
    if (u && u.uTint && u.uTint.value && u.uTint.value.set) u.uTint.value.set(1, 1, 1, flash ? 0.6 : 0);
    else if (mesh && mesh.material && mesh.material.color) mesh.material.color.setScalar(flash ? 1 : 0.6);
    setEntityLight(game, o, this.x, this.y + 0.5, this.z);
  }

  serialize() { return { ...super.serialize(), data: { ...this.data } }; }

  dispose(game) { disposeBlockObject(game, this.object3d); this.object3d = null; }
}

let registered = false;
/** Register falling_block and tnt with the entity registry (idempotent). */
export function registerMechEntityTypes() {
  if (registered) return;
  registered = true;
  registerEntityType('falling_block', {
    create: (game, x, y, z, opts = {}) => new FallingBlock(game, x, y, z, opts),
    persistent: true, category: 'block',
  });
  registerEntityType('tnt', {
    create: (game, x, y, z, opts = {}) => new PrimedTnt(game, x, y, z, opts),
    load: (game, d) => new PrimedTnt(game, d.x, d.y, d.z, { ...(d.data || {}), loaded: true, hop: false }),
    persistent: true, category: 'block',
  });
}

/** Spawn a dropped item for a block that could not land (falling block onto a torch etc.). */
export function dropBlockItem(game, id, state, x, y, z) {
  const key = blockItem(id);
  if (!key) return null;
  return dropItem(game, { item: key, count: 1 }, x, y, z);
}

