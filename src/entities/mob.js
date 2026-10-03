// OWNER LANE: FEATURE-MOBS. The living-mob base class (SPEC §2.6, §8.1): movement with the player formula
// (a = (attr*mod)^2, gravity 0.08 / drag 0.98, step 0.6), idle AI (wander, look at player, panic, tempt, breed,
// follow parent), getting around (jump obstacles <= 1 block, never path off 4+ drops / into lava, fire, cactus,
// float in water, turn away when blocked), hurt + knockback + red flash, kid rule "animals can't die",
// death tip-over + poof + drops, babies, riding seats. Subclasses (animals.js, monsters.js) add type rules.
//
// Gameplay outcomes (drops, taming, shearing, eggs, xp) roll game.rand() (SPEC §0.3). Idle-AI choices (wander
// timing and targets, glances, grazing) roll the mob's own stream `rng`, seeded from game.rand() when the mob is
// created: still reproducible under setRandomSeed, but steady-state ticks no longer draw from game.rand (see the
// handoff: keeps setRandomSeed sequences stable between test calls). Persistent state lives in `this.data` (saved by Entity.serialize);
// the entity type's create(game, x, y, z, opts) receives the saved data as opts on load, so data keys == opts keys.

import { Entity } from './entity.js';
import { MOBS, SPAWN } from '../data/mobs.js';
import { B_SLIP, ID } from '../core/registry.js';
import { clamp, lerp, mulberry32 } from '../core/math.js';
import { entityFluid, moveEntity } from './collide.js';
import {
  canJumpObstacle, feedBaby, findStandY, fleeTarget, isSafeStep, mobAirAccel, mobGroundAccel,
  pickWanderTarget, randInt, turnToward, wrapAngle, yawToward,
} from './mob_ai.js';
import { applyPose, createMobMesh, createSimpleMesh, setMobLight, setMobTint, setMobSkin } from './mob_render.js';
import { dropItem } from './item_entity.js';

const HEAD_LIMIT = 50 * Math.PI / 180;
const TURN_RATE = 0.35;           // max body turn per tick (radians, ~20 degrees)
const tmpBox = {};

/** Keys copied from spawn opts / saved data into entity.data. */
const DATA_KEYS = ['baby', 'grow', 'color', 'sheared', 'tamed', 'owner', 'sitting', 'saddled', 'coat', 'speed', 'jump', 'hp', 'temper',
  'love', 'cooldown', 'wild', 'eggTimer', 'rainbow', 'dyes', 'variant', 'name', 'leashed'];

export class Mob extends Entity {
  /**
   * @param {object} game
   * @param {string} type key of MOBS
   * @param {object} [opts] spawn options or saved data: {baby, color, tamedBy, variant, ...data keys}; `rand`: the
   *   generator for this mob's creation rolls (AI stream seed, sheep colour, egg timer, horse stats). Chunk-generation
   *   spawns pass their per-column generator so streaming columns never draw game.rand(); default game.rand().
   */
  constructor(game, type, x, y, z, opts = {}) {
    super(type, x, y, z);
    this.game = game;
    /** Creation-time roll (only valid during construction / initData). */
    this.spawnRand = typeof opts.rand === 'function' ? opts.rand : (game && game.rand ? () => game.rand() : () => 0.5);
    this.rng = mulberry32((this.spawnRand() * 4294967296) >>> 0 || 0x9e3779b9);
    this.def = MOBS[type] || {};
    this.category = this.def.category || 'creature';
    this.persistent = this.category !== 'monster';
    for (const k of DATA_KEYS) if (opts[k] !== undefined) this.data[k] = opts[k];
    if (opts.tamedBy) { this.data.tamed = true; this.data.owner = opts.tamedBy; }
    this.initData(game, opts);
    if (this.data.baby && !(this.data.grow > 0)) this.data.grow = SPAWN.BABY_GROW_TICKS;
    this.stepHeight = 0.6;
    this.speedAttr = Array.isArray(this.def.speed) ? (this.data.speed || this.def.speed[0]) : (this.def.speed || 0.25);
    this.maxHealth = this.baseMaxHealth();
    this.health = this.maxHealth;
    this.yaw = opts.yaw !== undefined ? opts.yaw : this.rng() * Math.PI * 2;
    this.prevYaw = this.yaw;
    this.spawnRand = null;
    this.updateSize();
    // AI state (not saved)
    this.target = null;            // {x, y, z} navigation goal
    this.speedMod = 1;
    this.stopDist = 0.5;
    this.wanderCooldown = 20 + Math.floor(this.rng() * 100);
    this.panicTicks = 0;
    this.lookTicks = 0; this.lookAt = null; this.lookYaw = 0; this.nextLook = 20;
    this.nextIdleSound = 60 + Math.floor(this.rng() * 300);
    this.jumpNext = false; this.jumpAttempts = 0; this.freeTicks = 0;
    this.stuckTicks = 0; this.lastProgress = 0;
    this.mateId = 0; this.mateTicks = 0;
    this.lastDamage = 0;
    this.attacker = null;
    this.killedByPlayer = false;
    this.fireTicks = 0;
    this.eating = 0;
    // render state
    this.limbSwing = 0; this.limbAmount = 0; this.prevLimbAmount = 0;
    this.headYaw = 0; this.headPitch = 0; this.prevHeadYaw = 0;
    this.renderYaw = this.yaw;
    this.tint = null;
    this.variantKey = '';
  }

  /* ------------------------------------------------------------------ basics */
  /** Subclass hook: fill type defaults into this.data (runs inside the constructor, before health/speed). */
  initData(game, opts) {}
  get baby() { return !!this.data.baby; }
  get kidSafe() {
    const r = this.game && this.game.meta && this.game.meta.rules;
    return this.category === 'creature' && !!r && r.animalsCanDie === false;
  }
  baseMaxHealth() { return typeof this.def.hp === 'number' ? this.def.hp : (this.data.hp || 20); }
  updateSize() {
    const k = this.baby ? 0.5 : 1;
    this.width = (this.def.w || 0.6) * k; this.height = (this.def.h || 1) * k; this.eyeHeight = (this.def.eye || this.height * 0.85) * k;
  }
  /** Touched by the player (fed, sheared, dyed, tamed, ridden...): never culled as a natural wild animal. */
  touch() { if (this.data.wild) delete this.data.wild; }
  /** Idle-AI stream (per mob, seeded from game.rand at creation). */
  rand() { return this.rng(); }
  /** Gameplay outcome roll: game.rand(). */
  grand() { return this.game.rand(); }
  get world() { return this.game.world; }
  getRaw = (x, y, z) => this.game.world.getRaw(x, y, z);
  distTo(x, y, z) { return Math.hypot(this.x - x, this.y - y, this.z - z); }
  distToPlayer() { const p = this.game.player; return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z); }
  playerIsTarget() {
    const g = this.game, p = g.player;
    return !!p && !p.dead && !g.isCreative() && g.state === 'playing';
  }
  /** Mob sound event (AUDIO maps it to '<voice>.<kind>'). */
  sound(kind) {
    this.game.events.emit('mob:sound', { id: this.id, type: this.type, kind, x: this.x, y: this.y + this.height / 2, z: this.z });
  }
  particles(kind, count = 4, dy = null) {
    const fx = this.game.fx;
    if (fx && fx.spawnParticles) fx.spawnParticles(kind, this.x, this.y + (dy === null ? this.height + 0.2 : dy), this.z, { count, spread: this.width * 0.6 });
  }
  consumeHeld(n = 1) { if (!this.game.isCreative() && this.game.inventory) this.game.inventory.consumeSelected(n); }

  /* ------------------------------------------------------------------ tick */
  tick(game) {
    this.age++;
    if (this.deathTime > 0) { this.tickDeath(); return; }
    this.tickTimers();
    const fl = entityFluid(game.world, this, this.eyeHeight);
    this.waterFrac = fl.water; this.inWater = fl.water > 0; this.inLava = !!fl.lava; this.eyeInWater = !!fl.eyeInWater;
    this.tickEnvironment();
    if (this.deathTime > 0 || this.removed) return;
    this.forward = 0; this.wantYaw = this.yaw; this.speedMod = 1; this.riddenAccel = false;
    const rider = this.rider();
    if (rider) this.controlRidden(rider); else this.think();
    this.steer();
    this.physics();
    this.afterMove();
    this.updateLook();
  }

  tickTimers() {
    const d = this.data;
    if (d.love > 0) { d.love--; if (d.love % 20 === 0) this.particles('heart', 1); }
    if (d.cooldown > 0) d.cooldown--;
    if (this.baby) {
      d.grow = (d.grow || 0) - 1;
      if (d.grow <= 0) { d.baby = false; delete d.grow; this.updateSize(); this.onGrownUp(); }
    }
    if (this.panicTicks > 0) this.panicTicks--;
    if (this.eating > 0) this.eating--;
    if (this.fireTicks > 0) this.fireTicks--;
    if (--this.nextIdleSound <= 0) {
      this.nextIdleSound = 120 + Math.floor(this.rand() * 280);
      if (this.distToPlayer() < 16 && !this.data.sitting) this.sound('idle');
    }
  }
  /** Subclass hook when a baby becomes an adult. */
  onGrownUp() {}

  /** Lava, fire, cactus, drowning-free: animals only suffer them when they can die. */
  tickEnvironment() {
    const g = this.game;
    if (this.inWater && this.fireTicks > 0) this.fireTicks = 0;
    if (this.inLava) { this.fireTicks = 300; if (this.age % 10 === 0) this.hurt(4, { type: 'lava' }); }
    else if (this.fireTicks > 0 && this.age % 20 === 0) this.hurt(1, { type: 'fire' });
    if (this.age % 10 === 0) {
      const b = this.getBox(tmpBox);
      const x0 = Math.floor(b.minX - 0.01), x1 = Math.floor(b.maxX + 0.01), z0 = Math.floor(b.minZ - 0.01), z1 = Math.floor(b.maxZ + 0.01);
      const y0 = Math.floor(b.minY), y1 = Math.floor(b.maxY - 0.01);
      let fire = false, cactus = false;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) {
        const id = g.world.getBlock(x, y, z);
        if (id === ID.fire) fire = true; else if (id === ID.cactus) cactus = true;
      }
      if (fire) { this.fireTicks = Math.max(this.fireTicks, 160); this.hurt(1, { type: 'fire' }); }
      if (cactus) this.hurt(1, { type: 'cactus' });
    }
  }

  /* ------------------------------------------------------------------ AI */
  /** Decide what to do this tick: sets this.target / this.speedMod / this.lookAt. Subclasses extend. */
  think() {
    if (this.eating > 0) { this.target = null; return; }
    if (this.panicTicks > 0) { this.thinkPanic(); return; }
    if (this.data.leashed && this.thinkLeash()) return;
    if (this.thinkSpecial()) return;
    if (this.data.love > 0 && !this.baby && this.thinkMate()) return;
    if (this.thinkTempt()) return;
    if (this.baby && this.thinkFollowParent()) return;
    this.thinkWander();
  }
  /** Subclass hook (wolf follow, monsters chase...). Return true when it took control this tick. */
  thinkSpecial() { return false; }

  thinkPanic() {
    this.speedMod = SPAWN.PANIC_SPEED_MOD;
    this.stopDist = 0.6;
    if (!this.target || this.age % 20 === 0 || this.distTo(this.target.x, this.target.y, this.target.z) < 1) {
      const a = this.attacker || this.game.player;
      this.target = fleeTarget(() => this.rand(), this.getRaw, this.x, this.y, this.z, a.x, a.z, 5 + Math.floor(this.rand() * 4));
    }
  }

  thinkMate() {
    let mate = this.mateId ? this.game.entities.get(this.mateId) : null;
    if (!mate || !this.canMate(mate)) {
      mate = null; this.mateId = 0;
      if (this.age % 10 === 0) {
        let best = 64;
        this.game.entities.forEach((o) => {
          if (o === this || !this.canMate(o)) return;
          const d = (o.x - this.x) ** 2 + (o.y - this.y) ** 2 + (o.z - this.z) ** 2;
          if (d < best) { best = d; mate = o; }
        });
        if (mate) this.mateId = mate.id;
      }
    }
    if (!mate) return false;
    const d = Math.hypot(mate.x - this.x, mate.z - this.z);
    this.target = { x: mate.x, y: mate.y, z: mate.z };
    this.stopDist = 1.2; this.speedMod = 1;
    this.lookAt = mate;
    if (d < 2.2) {
      this.mateTicks++;
      if (this.mateTicks >= 30 && this.id < mate.id) this.breedWith(mate);
    } else this.mateTicks = 0;
    return true;
  }
  canMate(o) {
    return o && o.type === this.type && !o.removed && o.deathTime === 0 && !o.baby && o.data.love > 0 && this.canBreed() && o.canBreed && o.canBreed();
  }
  /** Extra breed gate (wolves and cats must be tamed). */
  canBreed() { return true; }
  breedWith(mate) {
    const g = this.game;
    const x = (this.x + mate.x) / 2, y = Math.max(this.y, mate.y), z = (this.z + mate.z) / 2;
    const opts = this.babyOpts(mate);
    const baby = g.mobs && g.mobs.spawnMob ? g.mobs.spawnMob(this.type, x, y, z, { ...opts, baby: true, reason: 'breed' }) : null;
    for (const p of [this, mate]) { p.data.love = 0; p.data.cooldown = SPAWN.BREED_COOLDOWN_TICKS; p.mateTicks = 0; p.mateId = 0; p.touch(); }
    g.events.emit('mob:bred', { id: baby ? baby.id : this.id, type: this.type, x, y, z, parents: [this.id, mate.id] });
    if (baby) baby.touch();
    this.particles('heart', 6);
    if (g.mobs && g.mobs.spawnXp) g.mobs.spawnXp(x, y + 0.5, z, randInt(() => this.grand(), 1, 7));
  }
  /** Spawn options inherited by a baby (sheep colour mix, tamed owner...). */
  babyOpts(mate) { return {}; }

  thinkTempt() {
    const items = this.def.tempt;
    if (!items || !items.length) return false;
    const g = this.game, p = g.player;
    if (!p || p.dead || p.riding === this.id) return false;
    const held = g.inventory && g.inventory.getSelected();
    if (!held || !items.includes(held.item)) return false;
    const d = this.distToPlayer();
    if (d > SPAWN.TEMPT_RANGE) return false;
    this.lookAt = p;
    this.speedMod = 1;
    this.stopDist = 2.5;
    this.target = d > 2.5 ? { x: p.x, y: p.y, z: p.z } : null;
    return true;
  }

  thinkFollowParent() {
    if (this.age % 20 === 0 || !this.parentRef || this.parentRef.removed) {
      this.parentRef = null;
      let best = 64;
      this.game.entities.forEach((o) => {
        if (o.type !== this.type || o.baby || o.removed || o.deathTime) return;
        const d = (o.x - this.x) ** 2 + (o.z - this.z) ** 2;
        if (d < best) { best = d; this.parentRef = o; }
      });
    }
    const par = this.parentRef;
    if (!par) return false;
    const d = Math.hypot(par.x - this.x, par.z - this.z);
    if (d < 3) return false;
    this.target = { x: par.x, y: par.y, z: par.z };
    this.stopDist = 2; this.speedMod = 1.1;
    return true;
  }

  thinkWander() {
    this.speedMod = 1; this.stopDist = 0.6;
    if (this.target) return;
    if (--this.wanderCooldown > 0) return;
    this.wanderCooldown = 60 + Math.floor(this.rand() * 100); // 3-8 s (SPEC §2.6)
    if (this.rand() < 0.75) this.target = pickWanderTarget(() => this.rand(), this.getRaw, this.x, this.y, this.z, 10, 8);
  }

  /** Called when the way is blocked or unsafe: drop the target and choose again soon (turn away from walls). */
  blocked() {
    this.target = null; this.jumpAttempts = 0; this.stuckTicks = 0;
    this.wanderCooldown = Math.min(this.wanderCooldown, 5 + Math.floor(this.rand() * 15));
    if (this.panicTicks > 0) this.thinkPanic();
  }

  /** Turn the target into forward input + desired yaw (with the path-safety check). */
  steer() {
    const t = this.target;
    if (!t) return;
    const dx = t.x - this.x, dz = t.z - this.z, dist = Math.hypot(dx, dz);
    if (dist <= this.stopDist) { this.target = this.keepTarget ? t : null; this.lastProgress = 0; return; }
    this.wantYaw = yawToward(dx, dz);
    const diff = Math.abs(wrapAngle(this.wantYaw - this.yaw));
    this.forward = diff > 1.2 ? 0.2 : Math.cos(diff);
    // never walk off a 4+ drop, into lava / fire, onto cactus (SPEC §2.6)
    const reach = this.width / 2 + 0.35;
    const fx = -Math.sin(this.wantYaw), fz = -Math.cos(this.wantYaw);
    if (this.onGround && !this.inWater && !isSafeStep(this.getRaw, this.x + fx * reach, this.y, this.z + fz * reach, this.maxDrop())) {
      this.forward = 0; this.blocked(); return;
    }
    // stuck detection: no progress toward the target for 40 ticks
    if (t !== this.progressTarget) { this.progressTarget = t; this.lastProgress = dist; this.stuckTicks = 0; }
    else if (dist < this.lastProgress - 0.05) { this.lastProgress = dist; this.stuckTicks = 0; }
    else if (++this.stuckTicks > 40) this.blocked();
  }
  maxDrop() { return 4; }

  /** Rider input (pig with carrot on a stick, saddled horse). Subclasses override. */
  controlRidden(rider) { this.think(); }
  rider() {
    const p = this.game.player;
    return p && p.riding === this.id ? p : null;
  }
  /** Seat for a rider (SPEC §7.5 riding: the player copies it). */
  getSeat() { return { x: this.x, y: this.y + this.height * 0.75, z: this.z, yaw: this.yaw }; }

  /* ------------------------------------------------------------------ physics (SPEC §2.1 formula) */
  physics() {
    const w = this.game.world;
    if (this.forward > 0) this.yaw = turnToward(this.yaw, this.wantYaw, TURN_RATE);
    else if (this.lookAt && this.target === null) this.yaw = turnToward(this.yaw, yawToward(this.lookAt.x - this.x, this.lookAt.z - this.z), 0.12);
    const below = w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z));
    const slip = this.onGround ? (B_SLIP[below] || 0.6) : 0.6;
    const f = clamp(this.forward, 0, 1);
    let a;
    if (this.inWater || this.inLava) a = 0.02 * f;
    // ridden + steered (horse): Java uses input 1 with speed = attribute, i.e. a = attr * 0.216 / slip^3
    else if (this.onGround) a = (this.riddenAccel ? this.speedAttr * this.speedMod * (0.216 / (slip * slip * slip)) : mobGroundAccel(this.speedAttr, this.speedMod, slip)) * f;
    else a = mobAirAccel(this.speedAttr, this.speedMod) * f;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.vx += fx * a; this.vz += fz * a;
    if (this.jumpNext && this.onGround) { this.vy = this.jumpVelocity(); this.jumpNext = false; }
    if ((this.inWater && this.waterFrac > 0.4) || this.inLava) this.vy += 0.04;   // float (SPEC §2.6)
    if (this.climbs && this.collidedH && this.forward > 0) this.vy = 0.2;          // spiders climb walls
    this.pushApart();
    const vx = this.vx, vy = this.vy, vz = this.vz;
    const applied = moveEntity(w, this, vx, vy, vz);
    if (Math.abs(applied.dx - vx) > 1e-7) this.vx = 0;
    if (Math.abs(applied.dz - vz) > 1e-7) this.vz = 0;
    if (Math.abs(applied.dy - vy) > 1e-7) this.vy = 0;
    // fall tracking
    if (this.inWater) this.fallDistance = 0;
    else if (applied.dy < 0) this.fallDistance -= applied.dy;
    if (this.onGround) { if (this.fallDistance > 0) this.onLand(this.fallDistance); this.fallDistance = 0; }
    // drag + gravity (applied after the move)
    if (this.inWater) { this.vx *= 0.8; this.vy *= 0.8; this.vz *= 0.8; this.vy -= 0.005; }
    else if (this.inLava) { this.vx *= 0.5; this.vy *= 0.5; this.vz *= 0.5; this.vy -= 0.02; }
    else {
      if (!this.noGravity) this.vy = (this.vy - 0.08) * 0.98;
      const k = this.onGround ? slip * 0.91 : 0.91;
      this.vx *= k; this.vz *= k;
      if (this.slowFall && !this.onGround && this.vy < 0) this.vy *= 0.6;
    }
    if (Math.abs(this.vx) < 0.003) this.vx = 0;
    if (Math.abs(this.vy) < 0.003 && this.onGround) this.vy = 0;
    if (Math.abs(this.vz) < 0.003) this.vz = 0;
    if (this.vy < -3.92) this.vy = -3.92;
  }
  jumpVelocity() { return 0.42; }

  /** Mobs gently push each other apart when their boxes overlap (Java Entity.push), so herds don't stack. */
  pushApart() {
    if (this.deathTime > 0 || this.rider()) return;
    const hw = this.width / 2;
    this.game.entities.forEach((o) => {
      if (o === this || !o.def || o.removed || o.deathTime > 0) return;
      const ow = o.width / 2;
      if (Math.abs(o.x - this.x) >= hw + ow || Math.abs(o.z - this.z) >= hw + ow) return;
      if (o.y >= this.y + this.height || this.y >= o.y + o.height) return;
      let dx = this.x - o.x, dz = this.z - o.z;
      let d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d < 0.01) { dx = (this.id & 1) ? 0.01 : -0.01; dz = 0; d = 0.01; }
      d = Math.sqrt(d);
      const k = Math.min(1, 1 / d) * 0.05 / d;
      this.vx += dx * k; this.vz += dz * k;
    });
  }

  /** Fall damage for mobs that can be hurt (never in kid worlds; chickens never). */
  onLand(dist) {
    if (this.def.noFallDamage || this.slowFall) return;
    const dmg = Math.ceil(dist - 3);
    if (dmg > 0) this.hurt(dmg, { type: 'fall' });
  }

  afterMove() {
    // jump obstacles <= 1 block with headroom; turn away after one failed jump (SPEC §2.6)
    if (this.collidedH && this.forward > 0.1 && !this.inWater) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if (this.onGround) {
        if (this.jumpAttempts < 2 && canJumpObstacle(this.getRaw, this.x, this.y, this.z, fx, fz, this.width)) { this.jumpNext = true; this.jumpAttempts++; }
        else this.blocked();
      }
      this.freeTicks = 0;
    } else if (this.collidedH && this.inWater && this.forward > 0.1) {
      this.vy = Math.max(this.vy, 0.12); // climb out of water onto the bank
    } else if (++this.freeTicks > 10) this.jumpAttempts = 0;
    // walk cycle
    const dist = Math.hypot(this.x - this.prevX, this.z - this.prevZ);
    this.prevLimbAmount = this.limbAmount;
    this.limbAmount += (Math.min(1, dist * 4) - this.limbAmount) * 0.4;
    this.limbSwing += this.limbAmount * (this.baby ? 1.6 : 1);
    if (this.game.player && this.game.player.riding === this.id) this.syncRider();
  }

  updateLook() {
    const p = this.game.player;
    if (p && p.riding === this.id) {
      // a ridden animal looks where it goes (never round at its own rider)
      this.lookTicks = 0; this.lookTarget = null; this.lookAt = null;
      this.prevHeadYaw = this.headYaw;
      this.headYaw *= 0.7; this.headPitch *= 0.7;
      return;
    }
    if (!this.lookAt && this.target === null && this.eating === 0 && p) {
      // idle glances are scheduled (one roll per glance, not one per tick: fewer game.rand() draws)
      if (this.lookTicks > 0) this.lookTicks--;
      else if (--this.nextLook <= 0) {
        const r = this.rand();
        if (r < 0.65 && this.distToPlayer() < SPAWN.LOOK_AT_PLAYER_RANGE) { this.lookTicks = 40 + Math.floor(r * 60); this.lookTarget = 'player'; }
        else { this.lookTicks = 20 + Math.floor(r * 20); this.lookTarget = 'random'; this.lookYaw = (r * 7.31 % 1 - 0.5) * 2 * HEAD_LIMIT; }
        this.nextLook = 40 + Math.floor(this.rand() * 100);
      } else this.lookTarget = null;
    }
    let wantYaw = 0, wantPitch = 0;
    const lt = this.lookAt || (this.lookTicks > 0 && this.lookTarget === 'player' ? p : null);
    if (lt) {
      const ey = (lt === p ? p.y + (p.eyeHeight || 1.62) : lt.y + (lt.eyeHeight || lt.height * 0.8 || 0.5));
      const dx = lt.x - this.x, dz = lt.z - this.z, dy = ey - (this.y + this.eyeHeight);
      wantYaw = wrapAngle(yawToward(dx, dz) - this.yaw);
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz) + 1e-6);
    } else if (this.lookTicks > 0 && this.lookTarget === 'random') wantYaw = this.lookYaw;
    wantYaw = clamp(wantYaw, -HEAD_LIMIT, HEAD_LIMIT);
    wantPitch = clamp(wantPitch, -0.6, 0.6);
    this.prevHeadYaw = this.headYaw;
    this.headYaw += (wantYaw - this.headYaw) * 0.3;
    this.headPitch += (wantPitch - this.headPitch) * 0.3;
    this.lookAt = null;
  }

  /* ------------------------------------------------------------------ damage */
  /**
   * Take damage (SPEC §2.6 hurt and death). source: {type: 'player'|'mob'|'fall'|'lava'|..., player?, entity?, crit?}.
   * Kid rule (rules.animalsCanDie false): animals only get knockback, a hop, panic and a squeak; health never drops.
   */
  hurt(amount, source = {}) {
    if (this.deathTime > 0 || this.removed) return false;
    const g = this.game;
    const fromPlayer = !!(source.player || source.type === 'player');
    const attacker = source.entity || (fromPlayer ? g.player : null);
    if (this.kidSafe) {
      if (!attacker && source.type !== 'explosion') return false; // environment never touches kid-world animals
      if (this.invulnTicks > 0) return false;
      this.invulnTicks = 10;
      this.knockback(attacker, 0.4);
      this.startPanic(attacker);
      this.sound('hurt');
      g.events.emit('mob:hurt', { id: this.id, type: this.type, amount: 0, x: this.x, y: this.y, z: this.z, by: source.type || 'unknown' });
      return true;
    }
    let dmg = amount;
    if (this.invulnTicks > 0) {
      if (amount <= this.lastDamage) return false;
      dmg = amount - this.lastDamage;
    } else this.invulnTicks = 10;
    this.lastDamage = amount;
    if (this.def.armor && source.type !== 'fall' && source.type !== 'fire' && source.type !== 'lava') dmg *= 1 - Math.min(20, this.def.armor) / 25;
    this.health -= dmg;
    this.hurtTime = 10;
    if (attacker) this.knockback(attacker, 0.4);
    this.onHurtBy(attacker, source);
    if (this.category === 'creature' && !this.data.tamed) this.startPanic(attacker);
    g.events.emit('mob:hurt', { id: this.id, type: this.type, amount: dmg, x: this.x, y: this.y, z: this.z, by: source.type || 'unknown' });
    if (this.health <= 0) { this.health = 0; this.killedByPlayer = fromPlayer; this.die(source); }
    else this.sound('hurt');
    return true;
  }
  /** Subclass hook (wolves get angry, monsters retaliate). */
  onHurtBy(attacker, source) {}
  startPanic(attacker) {
    if (this.category !== 'creature') return;
    this.panicTicks = SPAWN.PANIC_TICKS;
    this.attacker = attacker || this.game.player;
    this.target = null;
    this.data.sitting = false;
  }
  /** Knockback away from `from`: strength horizontal + a 0.4 hop (SPEC §2.3 melee). */
  knockback(from, strength = 0.4) {
    let dx = from ? this.x - from.x : (this.rand() - 0.5), dz = from ? this.z - from.z : (this.rand() - 0.5);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    this.vx = this.vx / 2 + dx * strength;
    this.vz = this.vz / 2 + dz * strength;
    if (this.onGround || this.inWater) this.vy = Math.min(0.4, this.vy / 2 + 0.4);
  }

  die(source = {}) {
    if (this.deathTime > 0) return;
    this.deathTime = 1;
    const g = this.game;
    if (g.player && g.player.riding === this.id) g.player.riding = null;
    this.sound('death');
    g.events.emit('mob:death', { id: this.id, type: this.type, x: this.x, y: this.y, z: this.z, by: source.type || 'unknown' });
  }

  tickDeath() {
    this.deathTime++;
    this.forward = 0;
    this.physics();
    if (this.deathTime >= 20) {
      this.dropLoot();
      this.remove();   // entity:remove reason 'dead' -> FX poof + AUDIO
    }
  }

  /** Loot from MOBS[type].drops (+ cooked when burning), only outside creative. XP orbs when a player killed it. */
  dropLoot() {
    const g = this.game;
    if (g.isCreative() || this.baby) return;
    const r = () => this.grand();
    for (const d of this.def.drops || []) {
      const n = randInt(r, d.min ?? 1, d.max ?? d.min ?? 1);
      if (n <= 0) continue;
      let item = d.cooked && this.fireTicks > 0 ? d.cooked : d.item;
      if (item === 'wool') { if (this.data.sheared) continue; item = this.woolColor() + '_wool'; }
      dropItem(g, { item, count: n }, this.x, this.y + this.height / 2, this.z);
    }
    for (const s of this.extraLoot()) dropItem(g, s, this.x, this.y + this.height / 2, this.z);
    if (this.killedByPlayer && g.mobs && g.mobs.spawnXp && this.def.xp) g.mobs.spawnXp(this.x, this.y + 0.3, this.z, randInt(r, this.def.xp[0], this.def.xp[1]));
  }
  extraLoot() { return this.data.saddled ? [{ item: 'saddle', count: 1 }] : []; }
  woolColor() { return this.data.color || 'white'; }

  /* ------------------------------------------------------------------ interaction (hooks.entityInteract) */
  /**
   * Player "use" on this mob with ctx.stack (SPEC §8.1 entity interactions). Returns true when consumed.
   * Base: same-type spawn egg makes a baby, breed items feed (love / baby growth).
   */
  interact(ctx) {
    const item = ctx.stack ? ctx.stack.item : null;
    if (this.deathTime > 0) return false;
    if (item === this.type + '_spawn_egg') {
      const g = this.game;
      if (g.mobs && g.mobs.spawnMob) {
        const b = g.mobs.spawnMob(this.type, this.x, this.y, this.z, { ...this.babyOpts(this), baby: true });
        if (b) b.touch();
      }
      this.consumeHeld();
      return true;
    }
    if (this.interactLeash(ctx)) return true;
    if (this.interactSpecial(ctx)) return true;
    if (item && this.def.breed && this.def.breed.includes(item)) return this.feed(ctx);
    return false;
  }
  /** Subclass hook for shears, dye, bucket, bone, saddle, riding, sitting. */
  interactSpecial(ctx) { return false; }
  /** True when tapping this mount while riding it with `stack` should use the item (saddle...) instead of getting off. */
  acceptsWhileRidden(stack) { return false; }

  /** Feed a breed item: babies grow 10% faster, adults fall in love (600 ticks, hearts). Always consumes the action. */
  feed(ctx) {
    const d = this.data;
    if (this.baby) {
      d.grow = feedBaby(d.grow || SPAWN.BABY_GROW_TICKS, SPAWN.BABY_FEED_SPEEDUP);
      this.consumeHeld(); this.touch();
      this.particles('sparkle', 4);
      this.sound('eat');
      return true;
    }
    if (d.love > 0 || d.cooldown > 0 || !this.canBreed()) return true;
    d.love = SPAWN.LOVE_TICKS;
    this.consumeHeld(); this.touch();
    this.sound('eat');
    this.particles('heart', 5);
    this.game.events.emit('mob:love', { id: this.id, type: this.type, x: this.x, y: this.y, z: this.z });
    return true;
  }

  /** Mount this mob (pig, horse). */
  mount() {
    const p = this.game.player;
    if (!p || p.riding || this.baby) return false;
    p.riding = this.id;
    this.touch();
    this.target = null;
    if (p.setFlying) p.setFlying(false);
    this.syncRider();
    return true;
  }
  dismount() {
    const p = this.game.player;
    if (!p || p.riding !== this.id) return;
    p.riding = null;
    const side = this.yaw + Math.PI / 2;
    const x = this.x - Math.sin(side) * (this.width / 2 + 0.6), z = this.z - Math.cos(side) * (this.width / 2 + 0.6);
    const y = findStandY(this.getRaw, x, this.y, z, 2) ?? this.y;
    if (p.teleport) p.teleport(x, y, z, 'dismount');
  }
  /**
   * Keep the rider on the seat AFTER the mount moved this tick. The player system ticks before entities and
   * copies the seat itself (SPEC §7.5), which alone leaves the rider one tick behind the mount (the animal
   * visibly slides ahead of the camera at a gallop). prevX/Y/Z stay as the player set them, so the camera
   * interpolates exactly like the mount does.
   */
  syncRider() {
    const p = this.game.player;
    if (!p || p.riding !== this.id) return;
    const s = this.getSeat();
    p.x = s.x; p.y = s.y; p.z = s.z;
    p.vx = p.vy = p.vz = 0; p.fallDistance = 0;
  }

  /* ------------------------------------------------------------------ rendering */
  /** Variant list for the shared geometry (sheep wool on/off). */
  geometryVariants() { return []; }
  /** Skin variant (sheep colour, wolf collar...). */
  skinVariant() { return {}; }

  render(game, alpha) {
    if (!game.renderer || !game.renderer.addObject) return;
    const variants = this.geometryVariants(), skin = this.skinVariant();
    const key = variants.join(',') + '|' + JSON.stringify(skin);
    if (!this.object3d || this.variantKey !== key) {
      if (this.object3d && this.variantKey.split('|')[0] === variants.join(',')) {
        setMobSkin(game, this.object3d, this.type, skin);
      } else {
        if (this.object3d) this.disposeMesh(game);
        this.object3d = createMobMesh(game, this.type, variants, skin);
        game.renderer.addObject(this.object3d);
      }
      this.variantKey = key;
    }
    const o = this.object3d;
    o.position.set(lerp(this.prevX, this.x, alpha), lerp(this.prevY, this.y, alpha), lerp(this.prevZ, this.z, alpha));
    o.rotation.set(0, this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha, this.deathTime > 0 ? Math.min(1, (this.deathTime - 1 + alpha) / 19) * Math.PI / 2 : 0);
    o.scale.setScalar(this.renderScale());
    // pose
    const view = this.renderView || (this.renderView = { type: this.type });
    view.limbSwing = this.limbSwing - this.limbAmount * (1 - alpha);
    view.limbAmount = lerp(this.prevLimbAmount, this.limbAmount, alpha);
    view.headYaw = lerp(this.prevHeadYaw, this.headYaw, alpha);
    view.headPitch = this.headPitch;
    view.baby = this.baby;
    this.fillPose(view, alpha);
    applyPose(o, this.type, view, this.age + alpha);
    // light at the eye + tint
    if (game.frameCount % 4 === (this.id & 3) || this.lastLight === undefined) {
      this.lastLight = game.world.getLight(Math.floor(this.x), Math.floor(this.y + this.eyeHeight), Math.floor(this.z));
      setMobLight(o, this.lastLight >> 4, this.lastLight & 15);
    }
    if (this.data.leashed || this.rope) this.renderRope(game, alpha);
    const t = this.tintNow(alpha);
    if (t) setMobTint(o, t[0], t[1], t[2], t[3]); else setMobTint(o, 0, 0, 0, 0);
  }
  renderScale() { return this.baby ? 0.5 : 1; }
  /** Type-specific pose fields (sitting, wings, tail...). */
  fillPose(view, alpha) {}
  tintNow() { return this.hurtTime > 0 || this.deathTime > 0 ? [1, 0, 0, 0.4] : null; }

  disposeMesh(game) {
    if (!this.object3d) return;
    if (game.renderer) game.renderer.removeObject(this.object3d);
    if (this.object3d.material) this.object3d.material.dispose();   // clone only; geometry + texture are shared
    this.object3d = null;
  }
  dispose(game) { this.disposeMesh(game); this.disposeRope(game); }

  /* ------------------------------------------------------------------ leads (P2) */
  /** Lead on an animal: tap with a lead to leash it to the player, tap again (any item) to let go. */
  interactLeash(ctx) {
    const item = ctx.stack ? ctx.stack.item : null;
    if (this.category !== 'creature') return false;
    if (this.data.leashed) { this.unleash(true); return true; }
    if (item !== 'lead') return false;
    this.data.leashed = 'player';
    this.consumeHeld(); this.touch();
    this.sound('idle');
    return true;
  }
  unleash(dropLead) {
    delete this.data.leashed;
    if (dropLead && !this.game.isCreative()) dropItem(this.game, { item: 'lead', count: 1 }, this.x, this.y + this.height, this.z);
  }
  /** Leashed: trot after the player; a long rope pulls; too long snaps (drops the lead). */
  thinkLeash() {
    const p = this.game.player;
    if (!p || p.dead) return false;
    const d = this.distToPlayer();
    if (d > 16) { this.unleash(true); return false; }
    if (d > 10) {
      const k = 0.04 * (d - 10) / d;
      this.vx += (p.x - this.x) * k; this.vz += (p.z - this.z) * k;
      if (p.y > this.y + 1 && this.onGround) this.jumpNext = true;
    }
    if (d > 4) { this.target = { x: p.x, y: p.y, z: p.z }; this.stopDist = 3; this.speedMod = 1.3; this.lookAt = p; return true; }
    return false;
  }
  renderRope(game, alpha) {
    const p = game.player;
    if (!this.data.leashed || !p || this.deathTime > 0) { this.disposeRope(game); return; }
    if (!this.rope) { this.rope = createSimpleMesh(game, 0.05, 0.05, 1, 0x8a6a3a, 0); game.renderer.addObject(this.rope); }
    const hx = p.renderX ?? p.x, hy = (p.renderY ?? p.y) + 1.1, hz = p.renderZ ?? p.z;
    const mx = lerp(this.prevX, this.x, alpha), my = lerp(this.prevY, this.y, alpha) + this.height * 0.8, mz = lerp(this.prevZ, this.z, alpha);
    const dx = hx - mx, dy = hy - my, dz = hz - mz, len = Math.hypot(dx, dy, dz) || 0.01;
    this.rope.position.set((hx + mx) / 2, (hy + my) / 2, (hz + mz) / 2);
    this.rope.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0, 'YXZ');
    this.rope.scale.set(1, 1, len);
    if (this.lastLight !== undefined) setMobLight(this.rope, this.lastLight >> 4, this.lastLight & 15);
  }
  disposeRope(game) {
    if (!this.rope) return;
    if (game.renderer) game.renderer.removeObject(this.rope);
    if (this.rope.material) this.rope.material.dispose();
    this.rope = null;
  }
}

/** Standard registration helper: registerEntityType(type, mobType(Class)). */
export function mobTypeDef(Cls, type) {
  return {
    category: MOBS[type].category,
    persistent: MOBS[type].category !== 'monster',
    create: (game, x, y, z, opts = {}) => new Cls(game, type, x, y, z, opts),
  };
}

