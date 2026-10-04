// OWNER LANE: FEATURE-MOBS. Monsters (P1, SPEC §2.6): zombie (melee, burns in sun), skeleton (arrows within 15
// blocks every 60/40 ticks, burns in sun), creeper (30-tick fuse within 3 blocks, cancelled beyond 7, power 3
// through mechanics.explode, flees cats), spider (climbs walls, neutral in light >= 12, leaps). Only present when
// rules.hostileMobs and the difficulty is not peaceful (spawning.js removes them otherwise). Plus the `arrow`
// projectile shared by skeletons and the player's bow.

import { Entity, rayBox } from './entity.js';
import { Mob } from './mob.js';
import { B_SOLID, getCollisionBoxes } from '../core/registry.js';
import { lerp } from '../core/math.js';
import { daylightAt, randInt, wrapAngle, yawToward } from './mob_ai.js';
import { createSimpleMesh } from './mob_render.js';

const DIFF = (g) => (g.meta ? g.meta.difficulty : 'peaceful');

class Monster extends Mob {
  constructor(game, type, x, y, z, opts) {
    super(game, type, x, y, z, opts);
    this.persistent = false;
    this.attackCooldown = 0;
    this.idleFar = 0;
  }
  tickTimers() {
    super.tickTimers();
    if (this.attackCooldown > 0) this.attackCooldown--;
  }
  tickEnvironment() {
    super.tickEnvironment();
    if (!this.def.burnsInSun || this.inWater || this.deathTime) return;
    const g = this.game;
    const day = daylightAt(g.time ? g.time.dayTime : 6000);
    if (day > 0.5 && this.fireTicks < 20) {
      const sky = g.world.getSkyLight(Math.floor(this.x), Math.floor(this.y + this.eyeHeight), Math.floor(this.z));
      if (sky >= 15 && this.rand() * 30 < (day - 0.4) * 2 * 15) this.fireTicks = 160;
    }
  }
  /** Who to hunt right now (the player in survival within range), or null. */
  huntTarget(range) {
    const g = this.game, p = g.player;
    if (!this.playerIsTarget()) return null;
    return this.distToPlayer() <= range ? p : null;
  }
  think() {
    if (this.thinkSpecial()) return;
    this.thinkWander();
  }
  /** Bite / punch the player when in reach. */
  meleePlayer(amount) {
    const g = this.game, p = g.player;
    const reach = this.width / 2 + 0.3 + 0.6;
    if (this.attackCooldown > 0 || Math.hypot(p.x - this.x, p.z - this.z) > reach + 0.4 || Math.abs(p.y - this.y) > 1.6) return false;
    this.attackCooldown = 20;
    if (g.survival && g.survival.damage(amount, 'mob', { entity: this })) {
      const dx = p.x - this.x, dz = p.z - this.z, len = Math.hypot(dx, dz) || 1;
      p.vx = (p.vx || 0) + (dx / len) * 0.4; p.vz = (p.vz || 0) + (dz / len) * 0.4;
      if (p.onGround) p.vy = 0.4;
    }
    return true;
  }
  chasePlayer(stop = 0.6, mod = 1) {
    const p = this.game.player;
    this.target = { x: p.x, y: p.y, z: p.z };
    this.stopDist = stop; this.speedMod = mod; this.lookAt = p;
  }
  onHurtBy(attacker) { if (attacker === this.game.player) this.provoked = 200; }
  maxDrop() { return 5; }
}

export class Zombie extends Monster {
  initData(game) {
    if (this.data.baby === undefined && this.spawnRand() < (this.def.babyChance || 0)) { this.data.baby = true; this.data.grow = 1e9; }
  }
  tickTimers() { super.tickTimers(); if (this.baby) this.data.grow = 1e9; } // baby zombies never grow up
  thinkSpecial() {
    const p = this.huntTarget(this.def.followRange || 35);
    this.armsUp = !!p;
    if (!p) return false;
    this.chasePlayer(0.6, this.baby ? 1.5 : 1);
    const diff = DIFF(this.game);
    this.meleePlayer(this.def.attack[diff] || this.def.attack.easy);
    return true;
  }
  fillPose(v) { v.armsUp = this.armsUp; }
}

export class Skeleton extends Monster {
  thinkSpecial() {
    const p = this.huntTarget(this.def.ranged.range + 4);
    this.aiming = false;
    if (!p) return false;
    const g = this.game;
    // flee tamed wolves nearby
    const wolf = g.entities.queryRadius(this.x, this.y, this.z, 6, (e) => e.type === 'wolf' && e.data.tamed && !e.deathTime)[0];
    if (wolf) { this.attacker = wolf; this.panicTicks = 20; this.thinkPanic(); this.panicTicks = 0; return true; }
    const d = this.distToPlayer();
    this.lookAt = p;
    if (d > 10) this.chasePlayer(8, 1);
    else if (d < 4) { this.target = null; this.forward = 0; this.backOff = true; }
    else this.target = null;
    const diff = DIFF(g);
    const interval = this.def.ranged.intervalTicks[diff] || 60;
    if (d <= this.def.ranged.range) {
      this.aiming = true;
      if (this.attackCooldown === 0) {
        this.attackCooldown = interval;
        const [a, b] = this.def.ranged.damage[diff] || [1, 3];
        // aim a third of the way up the body like Java's getY(0.3333); shootArrow adds the arc lift on top
        shootArrow(g, this, this.x, this.y + this.eyeHeight - 0.1, this.z, p.x, p.y + (p.height || 1.8) * 0.3333, p.z, 1.6, 6 - (diff === 'normal' ? 2 : 0), randInt(() => this.grand(), a, b));
      }
    }
    return true;
  }
  physics() {
    if (this.backOff) {
      const p = this.game.player;
      this.wantYaw = yawToward(p.x - this.x, p.z - this.z);
      this.yaw += wrapAngle(this.wantYaw - this.yaw) * 0.3;
      this.vx -= -Math.sin(this.yaw) * 0.02; this.vz -= -Math.cos(this.yaw) * 0.02;
      this.backOff = false;
    }
    super.physics();
  }
  fillPose(v) { v.aiming = this.aiming; }
}

export class Creeper extends Monster {
  initData() { this.fuse = 0; this.prevFuse = 0; }
  thinkSpecial() {
    const g = this.game;
    this.prevFuse = this.fuse;
    // creepers are scared of cats (SPEC §2.6)
    const cat = g.entities.queryRadius(this.x, this.y, this.z, 6, (e) => e.type === 'cat' && !e.deathTime)[0];
    if (cat) { this.fuse = Math.max(0, this.fuse - 1); this.attacker = cat; this.panicTicks = 20; this.thinkPanic(); this.panicTicks = 0; return true; }
    const p = this.huntTarget(16);
    if (!p) { this.fuse = Math.max(0, this.fuse - 1); return false; }
    const d = this.distToPlayer();
    if (this.fuse > 0 || d <= this.def.fuseStartRange) {
      if (d > this.def.fuseCancelRange) this.fuse = Math.max(0, this.fuse - 1);
      else {
        if (this.fuse === 0) this.sound('hiss');
        this.fuse++;
        this.target = null; this.lookAt = p;
        if (this.fuse >= this.def.fuseTicks) { this.explode(); return true; }
        return true;
      }
    }
    this.chasePlayer(1.5, 1);
    return true;
  }
  explode() {
    const g = this.game, power = this.def.explosionPower || 3;
    const x = this.x, y = this.y + this.height / 2, z = this.z;
    this.persistent = false;
    g.entities.remove(this, 'explode');   // gone before the blast: no loot, no tip-over, no poof (the blast is the effect)
    const breakBlocks = !!(g.meta && g.meta.rules.mobGriefing);
    // MECH owns explosions: blocks, drops, entity and player damage, the 'explosion' event (the stub-era fallback
    // that hurt the player here was removed when the mechanics lane was merged)
    g.mechanics.explode(x, y, z, power, { source: 'creeper', breakBlocks });
  }
  tintNow() {
    if (this.hurtTime > 0 || this.deathTime > 0) return [1, 0, 0, 0.4];
    if (this.fuse > 0 && Math.floor(this.fuse / 5) % 2 === 1) return [1, 1, 1, 0.5];   // 2 flashes / s (flash-safe)
    return null;
  }
  renderScale() {
    const k = Math.min(1, this.fuse / (this.def.fuseTicks || 30));
    return 1 + k * 0.2 + (this.fuse > 0 ? Math.sin(this.age * 2.3) * 0.01 : 0);
  }
}

export class Spider extends Monster {
  initData() { this.climbs = true; }
  thinkSpecial() {
    const g = this.game;
    const light = g.world.getLight(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
    const day = daylightAt(g.time ? g.time.dayTime : 6000);
    const eff = Math.max(light & 15, Math.max(0, (light >> 4) - (1 - day) * 11));
    const neutral = eff >= this.def.neutralAtLight && !(this.provoked > 0);
    if (this.provoked > 0) this.provoked--;
    if (neutral) return false;
    const p = this.huntTarget(16);
    if (!p) return false;
    this.chasePlayer(0.5, 1);
    const d = this.distToPlayer();
    if (this.def.leap && this.onGround && d > 2 && d < 4 && this.rand() < 0.1) {
      const dx = p.x - this.x, dz = p.z - this.z, len = Math.hypot(dx, dz) || 1;
      this.vx += dx / len * 0.3; this.vz += dz / len * 0.3; this.vy = 0.4;
    }
    this.meleePlayer(this.def.attack[DIFF(g)] || 2);
    return true;
  }
}

export const MONSTER_CLASSES = { zombie: Zombie, skeleton: Skeleton, creeper: Creeper, spider: Spider };

/* ------------------------------------------------------------------ arrows */

export class Arrow extends Entity {
  constructor(game, x, y, z, opts = {}) {
    super('arrow', x, y, z);
    this.game = game;
    this.width = 0.25; this.height = 0.25;
    this.persistent = false;
    this.category = 'projectile';
    this.vx = opts.vx || 0; this.vy = opts.vy || 0; this.vz = opts.vz || 0;
    this.shooter = opts.shooter || null;
    this.damage = opts.damage || 2;
    this.fromPlayer = !!opts.fromPlayer;
    this.inGround = false;
    this.life = 0;
    this.pitchR = 0;
    this.yaw = yawToward(this.vx, this.vz);
    this.prevYaw = this.yaw;
  }
  tick(game) {
    this.age++;
    if (this.inGround) {
      if (++this.life > 1200) game.entities.remove(this, 'despawn');
      if (this.fromPlayer && this.age > 10 && !game.isCreative()) {
        const p = game.player;
        if (Math.hypot(p.x - this.x, p.y + 0.9 - this.y, p.z - this.z) < 1.3 && game.inventory && game.inventory.add({ item: 'arrow', count: 1 }) === 0) {
          game.events.emit('item:pickup', { item: 'arrow', count: 1 });
          game.entities.remove(this, 'pickup');
        }
      }
      return;
    }
    const sp = Math.hypot(this.vx, this.vy, this.vz);
    if (sp > 1e-6) {
      // entity hit along this tick's segment (ignore the shooter for the first ticks)
      const dx = this.vx / sp, dy = this.vy / sp, dz = this.vz / sp;
      const ignore = this.shooter;
      const hit = game.entities.raycast(this.x, this.y, this.z, dx, dy, dz, sp, (e) => e !== this && e !== ignore && e.type !== 'arrow' && e.type !== 'item' && e.type !== 'xp_orb' && typeof e.hurt === 'function' && e.category !== 'other', 0.1);
      const p = game.player;
      let pt = null;
      if (!this.fromPlayer && p && !p.dead) {
        // the player's box grows by 0.3 on every side for arrows (Java inflates the target box by 0.3)
        const hw = (p.width || 0.6) / 2 + 0.3;
        pt = rayBox(this.x, this.y, this.z, dx, dy, dz, p.x - hw, p.y - 0.3, p.z - hw, p.x + hw, p.y + (p.height || 1.8) + 0.3, p.z + hw);
        if (pt !== null && pt > sp) pt = null;
      }
      const blockT = this.blockHit(dx, dy, dz, sp);
      const entT = hit ? hit.dist : Infinity, plT = pt === null ? Infinity : pt;
      if (plT < entT && plT < blockT) {
        if (game.survival) game.survival.damage(this.damage, 'arrow', { entity: this.shooter || this });
        game.entities.remove(this, 'hit'); return;
      }
      if (hit && entT < blockT) {
        hit.entity.hurt(this.damage, { type: this.fromPlayer ? 'player' : 'mob', player: this.fromPlayer, entity: this.shooter || this });
        game.entities.remove(this, 'hit'); return;
      }
      if (blockT !== Infinity) {
        this.x += dx * blockT; this.y += dy * blockT; this.z += dz * blockT;
        this.inGround = true; this.vx = this.vy = this.vz = 0;
        return;
      }
    }
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    this.yaw = yawToward(this.vx, this.vz);
    this.pitchR = Math.atan2(this.vy, Math.hypot(this.vx, this.vz));
    this.vx *= 0.99; this.vy = this.vy * 0.99 - 0.05; this.vz *= 0.99;
    if (this.y < -64 || this.age > 400) this.remove();
  }
  /** First solid block along the segment (distance) or Infinity. */
  blockHit(dx, dy, dz, len) {
    const w = this.game.world;
    for (let t = 0.1; t <= len + 1e-6; t += 0.1) {
      const x = this.x + dx * t, y = this.y + dy * t, z = this.z + dz * t;
      const v = w.getRaw(Math.floor(x), Math.floor(y), Math.floor(z)), id = v & 0xff;
      if (!B_SOLID[id]) continue;
      const lx = x - Math.floor(x), ly = y - Math.floor(y), lz = z - Math.floor(z);
      for (const b of getCollisionBoxes(id, v >> 8)) if (lx >= b[0] && lx <= b[3] && ly >= b[1] && ly <= b[4] && lz >= b[2] && lz <= b[5]) return Math.max(0, t - 0.1);
    }
    return Infinity;
  }
  hurt() { return false; }
  render(game, alpha) {
    if (!game.renderer || !game.renderer.addObject) return;
    if (!this.object3d) { this.object3d = createSimpleMesh(game, 0.06, 0.06, 0.5, 0x8a6a4a); game.renderer.addObject(this.object3d); }
    const o = this.object3d;
    o.position.set(lerp(this.prevX, this.x, alpha), lerp(this.prevY, this.y, alpha), lerp(this.prevZ, this.z, alpha));
    o.rotation.set(this.pitchR, this.yaw, 0, 'YXZ');
  }
  dispose(game) {
    if (this.object3d) { if (game.renderer) game.renderer.removeObject(this.object3d); if (this.object3d.material) this.object3d.material.dispose(); }
    this.object3d = null;
  }
}

/**
 * Fire an arrow from (x, y, z) toward a target point with Java-like arc compensation.
 * @returns {Arrow|null}
 */
export function shootArrow(game, shooter, x, y, z, tx, ty, tz, speed = 1.6, inaccuracy = 6, damage = 2, fromPlayer = false) {
  const dx = tx - x, dz = tz - z, h = Math.hypot(dx, dz);
  const dy = ty - y + h * 0.2;
  return fireArrow(game, shooter, x, y, z, dx, dy, dz, speed, inaccuracy, damage, fromPlayer);
}
/** Fire an arrow along a direction. */
export function fireArrow(game, shooter, x, y, z, dx, dy, dz, speed, inaccuracy, damage, fromPlayer) {
  const len = Math.hypot(dx, dy, dz) || 1;
  const j = () => (game.rand() - 0.5) * 0.0075 * inaccuracy * 2;
  const vx = (dx / len + j()) * speed, vy = (dy / len + j()) * speed, vz = (dz / len + j()) * speed;
  const e = game.entities.spawn('arrow', x, y, z, { vx, vy, vz, shooter, damage, fromPlayer, reason: 'shot' });
  return e;
}
