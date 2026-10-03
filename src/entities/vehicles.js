// OWNER LANE: FEATURE-MOBS. Boats (P1, SPEC §8.1): entity `boat` placed with the `oak_boat` item, floats on the
// water surface, 0.04 b/t^2 paddle acceleration toward where the rider looks, drag 0.9 on water, riding through
// getSeat(), breaks back into the item when hit. Plus XP orbs (P1): small glowing orbs that fly to the player.

import { Entity } from './entity.js';
import { B_LIQUID } from '../core/registry.js';
import { STATE } from '../data/blocks.js';
import { lerp } from '../core/math.js';
import { isStub } from '../core/stubs.js';
import { moveEntity } from './collide.js';
import { addXp, findStandY, wrapAngle } from './mob_ai.js';
import { applyPose, createMobMesh, createSimpleMesh, setMobLight } from './mob_render.js';
import { dropItem } from './item_entity.js';

/** Top y of the water surface in the column at (x, z) around y (null when no water there). */
export function waterSurface(world, x, y, z) {
  const bx = Math.floor(x), bz = Math.floor(z);
  for (let cy = Math.floor(y) + 1; cy >= Math.floor(y) - 1; cy--) {
    const v = world.getRaw(bx, cy, bz);
    if (B_LIQUID[v & 0xff] !== 1) continue;
    const above = world.getRaw(bx, cy + 1, bz);
    if (B_LIQUID[above & 0xff] === 1) return cy + 1;
    const lvl = (v >> 8) & STATE.LIQUID_LEVEL_MASK;
    return cy + (lvl === 0 ? 0.9 : (8 - lvl) / 9);
  }
  return null;
}

export class Boat extends Entity {
  constructor(game, x, y, z, opts = {}) {
    super('boat', x, y, z);
    this.game = game;
    this.width = 1.375; this.height = 0.5625;
    this.category = 'other';
    this.persistent = true;
    this.stepHeight = 0;
    this.yaw = opts.yaw ?? 0; this.prevYaw = this.yaw;
    this.paddle = 0; this.prevPaddle = 0;
    this.health = 1; this.maxHealth = 1;
  }
  rider() { const p = this.game.player; return p && p.riding === this.id ? p : null; }
  getSeat() { return { x: this.x, y: this.y + 0.25, z: this.z, yaw: this.yaw }; }
  tick(game) {
    this.age++;
    const w = game.world, rider = this.rider();
    let forward = 0;
    if (rider) {
      const inp = game.input;
      if (inp && (inp.isDown('descend') || inp.isDown('sneak'))) this.dismount();
      else {
        this.yaw += wrapAngle(rider.yaw - this.yaw) * 0.15;
        forward = inp ? inp.move.forward : 0;
      }
    }
    // samples at the four hull corners decide whether the boat floats
    let surf = null;
    for (const [ox, oz] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      const s = waterSurface(w, this.x + ox, this.y, this.z + oz);
      if (s !== null && (surf === null || s > surf)) surf = s;
    }
    const inWater = surf !== null && surf > this.y - 0.2;
    if (forward !== 0) {
      const a = (inWater ? 0.04 : 0.01) * (forward > 0 ? 1 : 0.35) * Math.sign(forward);
      this.vx += -Math.sin(this.yaw) * a; this.vz += -Math.cos(this.yaw) * a;
      this.prevPaddle = this.paddle; this.paddle += 0.35 * Math.sign(forward);
    } else this.prevPaddle = this.paddle;
    if (inWater) {
      const want = surf - 0.12;
      this.vy += (want - this.y) * 0.12;
      this.vy *= 0.7;
    } else this.vy -= 0.04;
    const vx = this.vx, vy = this.vy, vz = this.vz;
    const a = moveEntity(w, this, vx, vy, vz);
    if (Math.abs(a.dx - vx) > 1e-7) this.vx = 0;
    if (Math.abs(a.dz - vz) > 1e-7) this.vz = 0;
    if (Math.abs(a.dy - vy) > 1e-7) this.vy = 0;
    const drag = inWater ? 0.9 : this.onGround ? 0.5 : 0.95;
    this.vx *= drag; this.vz *= drag;
    if (!inWater) this.vy *= 0.98;
    if (rider) this.syncRider();
  }
  syncRider() {
    const p = this.game.player;
    if (!p || p.riding !== this.id || !isStub('player')) return;
    const s = this.getSeat();
    p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
    p.x = s.x; p.y = s.y; p.z = s.z; p.vx = p.vy = p.vz = 0; p.fallDistance = 0;
  }
  mount() {
    const p = this.game.player;
    if (!p || p.riding) return false;
    p.riding = this.id;
    if (p.setFlying) p.setFlying(false);
    this.syncRider();
    return true;
  }
  dismount() {
    const p = this.game.player;
    if (!p || p.riding !== this.id) return;
    p.riding = null;
    for (const side of [1, -1]) {
      const a = this.yaw + side * Math.PI / 2;
      const x = this.x - Math.sin(a) * 1.3, z = this.z - Math.cos(a) * 1.3;
      const y = findStandY((xx, yy, zz) => this.game.world.getRaw(xx, yy, zz), x, this.y + 0.5, z, 3);
      if (y !== null) { if (p.teleport) p.teleport(x, y, z, 'dismount'); return; }
    }
    if (p.teleport) p.teleport(this.x, this.y + 1, this.z, 'dismount');
  }
  interact() { return this.mount(); }
  /** Any hit breaks the boat (drops the item outside creative). */
  hurt(amount, source = {}) {
    if (this.removed) return false;
    const g = this.game;
    if (this.rider()) this.dismount();
    if (!g.isCreative()) dropItem(g, { item: 'oak_boat', count: 1 }, this.x, this.y + 0.4, this.z);
    g.events.emit('sound', { name: 'wood.break', x: this.x, y: this.y, z: this.z });
    this.remove();
    return true;
  }
  render(game, alpha) {
    if (!game.renderer || !game.renderer.addObject) return;
    if (!this.object3d) { this.object3d = createMobMesh(game, 'boat', [], {}); game.renderer.addObject(this.object3d); }
    const o = this.object3d;
    o.position.set(lerp(this.prevX, this.x, alpha), lerp(this.prevY, this.y, alpha), lerp(this.prevZ, this.z, alpha));
    o.rotation.set(0, this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha, 0);
    this.view = this.view || { type: 'boat' };
    this.view.paddle = lerp(this.prevPaddle, this.paddle, alpha);
    applyPose(o, 'boat', this.view, this.age + alpha);
    if ((game.frameCount + this.id) % 4 === 0) {
      const l = game.world.getLight(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
      setMobLight(o, l >> 4, l & 15);
    }
  }
  dispose(game) {
    if (!this.object3d) return;
    if (game.renderer) game.renderer.removeObject(this.object3d);
    if (this.object3d.material) this.object3d.material.dispose();
    this.object3d = null;
  }
}

/* ------------------------------------------------------------------ XP orbs (P1) */

export class XpOrb extends Entity {
  constructor(game, x, y, z, opts = {}) {
    super('xp_orb', x, y, z);
    this.game = game;
    this.width = 0.25; this.height = 0.25;
    this.category = 'other';
    this.persistent = false;
    this.stepHeight = 0;
    this.data = { value: Math.max(1, opts.value | 0) };
    const r = game && game.rand ? () => game.rand() : Math.random;
    this.vx = (r() - 0.5) * 0.2; this.vy = 0.2 + r() * 0.1; this.vz = (r() - 0.5) * 0.2;
    this.delay = 10;
  }
  tick(game) {
    this.age++;
    if (this.age > 6000) { game.entities.remove(this, 'despawn'); return; }
    if (this.delay > 0) this.delay--;
    const p = game.player;
    let pulled = false;
    if (p && !p.dead && this.delay === 0) {
      const dx = p.x - this.x, dy = p.y + 0.9 - this.y, dz = p.z - this.z, d = Math.hypot(dx, dy, dz);
      if (d < 1.0) {
        const before = p.xpLevel || 0;
        const gained = addXp(p, this.data.value);
        game.events.emit('mobs:xp', { amount: this.data.value, xp: p.xp, level: p.xpLevel, levelUp: gained > 0 });
        game.events.emit('sound', { name: gained > 0 && (p.xpLevel % 5 === 0 || before === 0) ? 'player.levelup' : 'item.pop', x: this.x, y: this.y, z: this.z, pitch: 1.6 });
        game.entities.remove(this, 'pickup');
        return;
      }
      if (d < 8) {
        const k = (1 - d / 8) ** 2 * 0.1 / d;
        this.vx += dx * k; this.vy += dy * k; this.vz += dz * k;
        pulled = true;
      }
    }
    if (!pulled) this.vy -= 0.03;
    const vx = this.vx, vy = this.vy, vz = this.vz;
    const a = moveEntity(game.world, this, vx, vy, vz);
    if (Math.abs(a.dx - vx) > 1e-7) this.vx = 0;
    if (Math.abs(a.dz - vz) > 1e-7) this.vz = 0;
    if (Math.abs(a.dy - vy) > 1e-7) this.vy = 0;
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) { this.vx *= 0.6; this.vz *= 0.6; }
  }
  hurt() { return false; }
  render(game, alpha) {
    if (!game.renderer || !game.renderer.addObject) return;
    if (!this.object3d) {
      const s = 0.12 + Math.min(0.12, Math.log2(this.data.value + 1) * 0.02);
      this.object3d = createSimpleMesh(game, s, s, s, 0xc8f050, s / 2);
      game.renderer.addObject(this.object3d);
    }
    const t = this.age + alpha, o = this.object3d;
    o.position.set(lerp(this.prevX, this.x, alpha), lerp(this.prevY, this.y, alpha) + 0.05 + Math.sin(t * 0.2) * 0.04, lerp(this.prevZ, this.z, alpha));
    o.rotation.set(t * 0.07, t * 0.1, 0);
    o.scale.setScalar(1 + Math.sin(t * 0.3) * 0.12);
    if (o.material && o.material.uniforms && o.material.uniforms.uLightBlock) o.material.uniforms.uLightBlock.value = 15; // glows
  }
  dispose(game) {
    if (!this.object3d) return;
    if (game.renderer) game.renderer.removeObject(this.object3d);
    if (this.object3d.material) this.object3d.material.dispose();
    this.object3d = null;
  }
}
