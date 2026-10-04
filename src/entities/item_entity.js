// OWNER LANE: FEATURE-MOBS (mobs + entities + survival damage). SPEC §8.1 "Item entity".
// Dropped item entity ('item'): gravity 0.04 / drag 0.98 / ground friction 0.6 x 0.98, bob + spin render
// (FEATURE-FX makeItemMesh, shared geometry per item key), 10-tick pickup delay (40 when thrown by the player),
// magnet toward the player within 1.5 blocks at 0.1 b/t, picked up within 1.0 when the inventory has room
// ('item:pickup' {item, count} -> AUDIO pop), merges with identical stacks within 0.5, despawns after 6000
// ticks, lava destroys it. The type is registered by createMobsSystem.init (registerItemEntityType()).

import { Entity, registerEntityType } from './entity.js';
import { ENTITY_PHYS } from '../core/constants.js';
import { ID } from '../core/registry.js';
import { lerp } from '../core/math.js';
import { maxStack } from '../data/items.js';
import { entityFluid, moveEntity } from './collide.js';

export const ITEM_DESPAWN_TICKS = 6000;
export const ITEM_PICKUP_DELAY = 10, ITEM_THROW_DELAY = 40;
export const ITEM_MAGNET_RANGE = 1.5, ITEM_MAGNET_SPEED = 0.1, ITEM_PICKUP_RANGE = 1.0, ITEM_MERGE_RANGE = 0.5;

export class ItemEntity extends Entity {
  constructor(game, x, y, z, opts = {}) {
    super('item', x, y, z);
    this.game = game;
    this.width = 0.25; this.height = 0.25;
    this.category = 'item';
    this.persistent = true;
    this.stepHeight = 0;
    const st = opts.stack || opts.item && { item: opts.item, count: opts.count || 1 } || { item: 'stone', count: 1 };
    this.data = { stack: { ...st }, delay: opts.delay ?? opts.pickupDelay ?? ITEM_PICKUP_DELAY };
    if (opts.thrower) this.data.thrower = opts.thrower;
    this.vx = opts.vx ?? 0; this.vy = opts.vy ?? 0; this.vz = opts.vz ?? 0;
    this.bobPhase = (game && game.rand ? game.rand() : 0) * Math.PI * 2;
  }
  get stack() { return this.data.stack; }

  tick(game) {
    this.age++;
    const d = this.data;
    if (d.delay > 0) d.delay--;
    if (this.age >= ITEM_DESPAWN_TICKS) { game.entities.remove(this, 'despawn'); return; }
    // physics (SPEC §8.1): gravity 0.04, drag 0.98, ground friction 0.6 * 0.98
    const fl = entityFluid(game.world, this, 0);
    if (fl.lava || game.world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z)) === ID.fire) {
      game.events.emit('sound', { name: 'lava.pop', x: this.x, y: this.y, z: this.z });
      game.entities.remove(this, 'burn');
      return;
    }
    let magnet = false;
    const p = game.player;
    if (d.delay <= 0 && p && !p.dead) {
      // the body reaches 0.5 below the feet (Java inflates the pickup box by 0.5 down): a drop that rolled to
      // the far side of the 1-deep hole the child just dug in front of them is still pulled in and picked up
      const py = Math.max(p.y - 0.5, Math.min(p.y + (p.height || 1.8), this.y + 0.125));
      const dx = p.x - this.x, dy = py - (this.y + 0.125), dz = p.z - this.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < ITEM_PICKUP_RANGE && this.tryPickup(game)) return;
      if (dist < ITEM_MAGNET_RANGE && dist > 1e-4) {
        magnet = true;
        const k = ITEM_MAGNET_SPEED / dist;
        this.vx = dx * k; this.vy = dy * k + 0.02; this.vz = dz * k;
      }
    }
    if (!magnet) {
      if (fl.water > 0) { this.vy = this.vy * 0.9 + 0.012; this.vx *= 0.9; this.vz *= 0.9; }
      else this.vy -= ENTITY_PHYS.GRAVITY;
    }
    const vx = this.vx, vy = this.vy, vz = this.vz;
    const a = moveEntity(game.world, this, vx, vy, vz);
    if (Math.abs(a.dx - vx) > 1e-7) this.vx = 0;
    if (Math.abs(a.dz - vz) > 1e-7) this.vz = 0;
    if (Math.abs(a.dy - vy) > 1e-7) this.vy = 0;
    this.vx *= ENTITY_PHYS.DRAG; this.vy *= ENTITY_PHYS.DRAG; this.vz *= ENTITY_PHYS.DRAG;
    if (this.onGround) { this.vx *= 0.6; this.vz *= 0.6; }
    if (Math.abs(this.vx) < 0.001) this.vx = 0;
    if (Math.abs(this.vz) < 0.001) this.vz = 0;
    if ((this.age + this.id) % 20 === 0) this.tryMerge(game);
  }

  /** Put as much as fits into the inventory. Returns true when the entity is gone. */
  tryPickup(game) {
    const inv = game.inventory;
    if (!inv) return false;
    const s = this.data.stack;
    const left = inv.add(s);
    const picked = s.count - left;
    if (picked <= 0) return false;
    game.events.emit('item:pickup', { item: s.item, count: picked });
    if (left <= 0) { game.entities.remove(this, 'pickup'); return true; }
    s.count = left;
    return false;
  }

  /** Merge identical stacks within 0.5 blocks into this one (up to the max stack). */
  tryMerge(game) {
    const s = this.data.stack;
    if (s.damage || s.data) return;
    const max = maxStack(s.item);
    if (s.count >= max) return;
    const others = game.entities.queryRadius(this.x, this.y, this.z, ITEM_MERGE_RANGE, (e) => e !== this && e.type === 'item' && !e.removed);
    for (const o of others) {
      const t = o.data.stack;
      if (t.item !== s.item || t.damage || t.data || o.id < this.id) continue;   // the older (lower id) one absorbs
      const n = Math.min(max - s.count, t.count);
      if (n <= 0) break;
      s.count += n; t.count -= n;
      this.data.delay = Math.max(this.data.delay, o.data.delay);
      if (t.count <= 0) game.entities.remove(o, 'merge');
      if (s.count >= max) break;
    }
  }

  hurt() { return false; }

  render(game, alpha) {
    if (!game.renderer || !game.renderer.addObject || !game.fx || !game.fx.makeItemMesh) return;
    if (!this.object3d) {
      this.object3d = game.fx.makeItemMesh(this.data.stack.item);
      if (!this.object3d) return;
      game.renderer.addObject(this.object3d);
    }
    const o = this.object3d, t = this.age + alpha;
    o.position.set(lerp(this.prevX, this.x, alpha), lerp(this.prevY, this.y, alpha) + 0.12 + Math.sin(t * 0.1 + this.bobPhase) * 0.05, lerp(this.prevZ, this.z, alpha));
    o.rotation.y = t * 0.05 + this.bobPhase;
    const n = this.data.stack.count;
    o.scale.setScalar(n > 1 ? 1.15 : 1);
    const m = o.material;
    if (m && m.uniforms && m.uniforms.uLightSky && (game.frameCount + this.id) % 8 === 0) {
      const l = game.world.getLight(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z));
      m.uniforms.uLightSky.value = l >> 4;
      if (m.uniforms.uLightBlock) m.uniforms.uLightBlock.value = l & 15;
    }
  }

  dispose(game) {
    if (!this.object3d) return;
    if (game.renderer) game.renderer.removeObject(this.object3d);
    if (game.fx && game.fx.disposeItemMesh) game.fx.disposeItemMesh(this.object3d);
    this.object3d = null;
  }
}

/** Register the 'item' entity type (idempotent). */
export function registerItemEntityType() {
  registerEntityType('item', {
    category: 'item', persistent: true,
    create: (game, x, y, z, opts = {}) => new ItemEntity(game, x, y, z, opts),
  });
}

/**
 * Drop an ItemStack into the world as an entity.
 * @param {object} game
 * @param {import('../core/types.js').ItemStack} stack
 * @param {number} x @param {number} y @param {number} z  spawn position (centre)
 * @param {{vx?: number, vy?: number, vz?: number, pickupDelay?: number, thrower?: 'player'|null}} [opts]
 *        velocity in blocks/tick; default = small random pop (+0.2 up, +-0.1 sideways)
 * @returns {object|null} the item Entity
 */
export function dropItem(game, stack, x, y, z, opts = {}) {
  if (!game || !game.entities || !game.entities.spawn || !stack || !stack.item || !(stack.count > 0)) return null;
  if (!game.entities.types || !game.entities.types.has('item')) registerItemEntityType();
  const r = game.rand ? () => game.rand() : Math.random;
  const thrown = opts.thrower === 'player';
  const e = game.entities.spawn('item', x, y - 0.125, z, {
    stack: { ...stack },
    vx: opts.vx ?? (r() - 0.5) * 0.2, vy: opts.vy ?? 0.2, vz: opts.vz ?? (r() - 0.5) * 0.2,
    delay: opts.pickupDelay ?? (thrown ? ITEM_THROW_DELAY : ITEM_PICKUP_DELAY),
    thrower: opts.thrower || null,
    reason: 'drop',
  });
  if (e && thrown) game.events.emit('item:drop', { item: stack.item, count: stack.count, x, y, z });
  return e;
}
