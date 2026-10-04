// OWNER LANE: FEATURE-MOBS. More mob kinds (judge FID-6, in the order a child notices them):
//   water: cod and tropical fish (schools, swim in 3D, flop on land), squid (pulse swimming, ink when hurt);
//   land:  rabbit (hops; desert / snowy / taiga coats), fox (sleeps by day, curled up), bee (flies between flowers,
//          stings only when hit in survival);
//   night: enderman (neutral: angry when hit or stared at, teleports, dodges arrows, carries a block when
//          mobGriefing is on), slime (hops, splits in two to four when it dies, deep underground);
//   village folk (FID-5 builds the villages): villager (profession robes; an emerald buys a small gift, anything
//          else gets a head shake and the emerald picture), iron golem (fights monsters, gives the child a poppy).
// Sounds: the AUDIO catalogue has no voices for these yet, so each type maps its sounds onto existing catalogue
// names with a pitch (VOICE below) through plain 'sound' events (never 'mob:sound', which would play the
// stand-in `voice` from data/mobs.js unpitched).

import { Mob } from './mob.js';
import { Monster } from './monsters.js';
import { B_LIQUID, B_OPAQUE, B_SOLID, ID, blockDef, blockName } from '../core/registry.js';
import { BIOMES } from '../world/worldgen.js';
import { lerp, lookDir } from '../core/math.js';
import { daylightAt, findStandY, turnToward, yawToward } from './mob_ai.js';
import { moveEntity } from './collide.js';
import { dropItem } from './item_entity.js';

const DIFF = (g) => (g.meta ? g.meta.difficulty : 'peaceful');
const isWater = (id) => B_LIQUID[id & 0xff] === 1;
const tmpEye = { x: 0, y: 0, z: 0 }, tmpDir = { x: 0, y: 0, z: 0 };

/** kind -> [catalogue sound, pitch, volume]; missing kinds are silent. */
const VOICE = {
  cod: { hurt: ['player.splash', 1.7, 0.35], death: ['player.splash', 1.4, 0.4], flop: ['item.pop', 0.6, 0.35] },
  tropical_fish: { hurt: ['player.splash', 1.9, 0.35], death: ['player.splash', 1.5, 0.4], flop: ['item.pop', 0.7, 0.35] },
  squid: { hurt: ['player.splash', 0.8, 0.5], death: ['player.splash', 0.7, 0.6] },
  rabbit: { hurt: ['chicken.hurt', 1.6, 0.6], death: ['chicken.death', 1.5, 0.6], eat: ['mob.eat', 1.4, 0.6], tame: ['mob.love', 1.2, 1] },
  fox: { idle: ['wolf.whine', 1.55, 0.5], hurt: ['wolf.hurt', 1.45, 0.7], death: ['wolf.death', 1.4, 0.7], eat: ['mob.eat', 1.2, 0.7] },
  bee: { hurt: ['chicken.hurt', 2.0, 0.5], death: ['chicken.death', 1.9, 0.5], angry: ['spider.idle', 1.8, 0.5], eat: ['mob.eat', 1.6, 0.5] },
  enderman: { idle: ['zombie.idle', 0.55, 0.5], hurt: ['zombie.hurt', 0.6, 0.7], death: ['zombie.death', 0.55, 0.8], angry: ['zombie.hurt', 0.45, 0.9], teleport: ['entity.poof', 0.55, 0.7] },
  slime: { hurt: ['item.pop', 0.55, 0.7], death: ['item.pop', 0.45, 0.8], land: ['item.pop', 0.75, 0.45] },
  villager: { idle: ['pig.idle', 0.6, 0.45], hurt: ['pig.hurt', 0.7, 0.6], death: ['pig.death', 0.65, 0.7], no: ['pig.idle', 0.5, 0.6], yes: ['ui.success', 1, 0.6] },
  iron_golem: { hurt: ['block.hit.metal', 0.7, 0.8], death: ['block.break.metal', 0.6, 0.9], step: ['block.step.metal', 0.6, 0.5], gift: ['item.pop', 0.9, 0.8] },
};
function mappedSound(kind) {
  if (kind === 'idle' && this.sleeping) return;      // a sleeping fox is quiet
  const m = VOICE[this.type], s = m && m[kind];
  if (!s) return;
  this.game.events.emit('sound', { name: s[0], pitch: s[1], volume: s[2], x: this.x, y: this.y + this.height / 2, z: this.z });
}

/**
 * A gift from a mob to the child: the item pops out just in front of her (between her and the mob), so it is
 * picked up a moment later however far away she tapped from.
 */
function giveToPlayer(mob, stack) {
  const g = mob.game, p = g.player;
  if (!p) return;
  const dx = mob.x - p.x, dz = mob.z - p.z, l = Math.hypot(dx, dz) || 1, k = Math.min(0.6, l / 2);
  dropItem(g, stack, p.x + dx / l * k, p.y + 1.1, p.z + dz / l * k, { vx: -dx / l * 0.03, vy: 0.12, vz: -dz / l * 0.03 });
}

/** Biome name at a block column ('' when unknown). */
function biomeAt(game, x, z) {
  const w = game.world;
  const bx = Math.floor(x), bz = Math.floor(z);
  const col = w && w.getColumn ? w.getColumn(bx >> 4, bz >> 4) : null;
  const b = col && col.biomes ? BIOMES[col.biomes[(bx & 15) + (bz & 15) * 16]] : null;
  return b ? b.name : '';
}

/* ================================================================== water mobs */

class WaterMob extends Mob {
  initData() {
    this.stepHeight = 0;
    this.swimTarget = null; this.swimCooldown = 0; this.outTicks = 0; this.flopTimer = 10;
    this.pitchR = 0; this.prevPitchR = 0;
  }
  get swimSpeed() { return 0.05; }
  interactLeash() { return false; }
  steer() {}
  maxDrop() { return 64; }
  underwater() { return this.inWater && this.waterFrac > 0.3; }
  /** A random water cell within reach (fish of a school drift toward their mates). */
  pickSwimTarget(bias) {
    const w = this.game.world;
    for (let i = 0; i < 8; i++) {
      let tx = this.x + (this.rand() - 0.5) * 12, ty = this.y + (this.rand() - 0.5) * 5, tz = this.z + (this.rand() - 0.5) * 12;
      if (bias) { tx = (tx + bias.x) / 2; ty = (ty + bias.y) / 2; tz = (tz + bias.z) / 2; }
      const bx = Math.floor(tx), by = Math.floor(ty), bz = Math.floor(tz);
      if (isWater(w.getBlock(bx, by, bz)) && isWater(w.getBlock(bx, by + 1, bz))) return { x: bx + 0.5, y: by + 0.2, z: bz + 0.5 };
    }
    return null;
  }
  schoolCentre() {
    if (!this.def.school) return null;
    let n = 0, x = 0, y = 0, z = 0;
    for (const o of this.game.entities.queryRadius(this.x, this.y, this.z, 8, (e) => e.type === this.type && e !== this && !e.deathTime)) { x += o.x; y += o.y; z += o.z; n++; }
    return n ? { x: x / n, y: y / n, z: z / n } : null;
  }
  think() {
    if (!this.underwater()) { this.swimTarget = null; return; }
    const g = this.game, p = g.player;
    if (this.panicTicks > 0) {
      if (!this.swimTarget || this.age % 15 === 0) {
        const a = this.attacker || p;
        const dx = this.x - a.x, dz = this.z - a.z, l = Math.hypot(dx, dz) || 1;
        this.swimTarget = this.pickSwimTarget({ x: this.x + dx / l * 6, y: this.y, z: this.z + dz / l * 6 });
      }
      this.speedMod = 2;
      return;
    }
    this.speedMod = 1;
    if (this.petTicks > 0 && p) { this.swimTarget = null; this.lookAt = p; return; }
    if (this.swimTarget && this.distTo(this.swimTarget.x, this.swimTarget.y, this.swimTarget.z) < 0.7) this.swimTarget = null;
    if (!this.swimTarget && --this.swimCooldown <= 0) {
      this.swimCooldown = 20 + Math.floor(this.rand() * 60);
      if (this.rand() < 0.8) this.swimTarget = this.pickSwimTarget(this.schoolCentre());
    }
  }
  physics() {
    const w = this.game.world;
    if (!this.inWater) {
      // on land: flop about (and slowly run out of air outside kid worlds)
      this.prevPitchR = this.pitchR;
      if (this.onGround && --this.flopTimer <= 0) {
        this.flopTimer = 12 + Math.floor(this.rand() * 14);
        this.vy = 0.35;
        this.vx += (this.rand() - 0.5) * 0.12; this.vz += (this.rand() - 0.5) * 0.12;
        this.yaw += (this.rand() - 0.5) * 1.5;
        this.sound('flop');
      }
      if (++this.outTicks > 300 && this.age % 20 === 0) this.hurt(1, { type: 'drown' });
      this.forward = 0;
      super.physics();
      return;
    }
    this.outTicks = 0;
    const t = this.swimTarget;
    let ax = 0, ay = 0, az = 0;
    if (t && this.underwater()) {
      const dx = t.x - this.x, dy = t.y - this.y, dz = t.z - this.z, d = Math.hypot(dx, dy, dz) || 1;
      const a = this.swimAccel();
      ax = dx / d * a; ay = dy / d * a; az = dz / d * a;
      this.yaw = turnToward(this.yaw, yawToward(dx, dz), 0.2);
    }
    this.vx += ax; this.vy += ay; this.vz += az;
    // never leave the water upward: the cell over the back must be water too
    const above = w.getBlock(Math.floor(this.x), Math.floor(this.y + this.height + 0.1), Math.floor(this.z));
    if (!isWater(above) && this.vy > 0) this.vy = 0;
    if (!this.underwater()) this.vy -= 0.02;      // half out at the surface: sink back in
    this.pushApart();
    const vx = this.vx, vy = this.vy, vz = this.vz;
    const m = moveEntity(w, this, vx, vy, vz);
    if (Math.abs(m.dx - vx) > 1e-7) { this.vx = 0; this.swimTarget = null; }
    if (Math.abs(m.dz - vz) > 1e-7) { this.vz = 0; this.swimTarget = null; }
    if (Math.abs(m.dy - vy) > 1e-7) this.vy = 0;
    const drag = this.swimDrag();
    this.vx *= drag; this.vy *= drag; this.vz *= drag;
    this.fallDistance = 0;
    this.prevPitchR = this.pitchR;
    const hs = Math.hypot(this.vx, this.vz);
    this.pitchR += (Math.max(-0.6, Math.min(0.6, Math.atan2(this.vy, hs + 0.02))) - this.pitchR) * 0.2;
  }
  swimAccel() { return this.swimSpeed * 0.1 * this.speedMod; }
  swimDrag() { return 0.9; }
  onLand() {}
  render(game, alpha) {
    super.render(game, alpha);
    const o = this.object3d;
    if (!o) return;
    o.rotation.order = 'YXZ';
    if (!this.inWater && this.deathTime === 0) o.rotation.z = Math.PI / 2;   // a fish on land lies on its side
    else o.rotation.x = lerp(this.prevPitchR, this.pitchR, alpha);
  }
}

export class Cod extends WaterMob {
  get swimSpeed() { return 0.09; }
}

export class TropicalFish extends WaterMob {
  initData(game, opts) {
    super.initData(game, opts);
    if (!Number.isInteger(this.data.variant)) this.data.variant = Math.floor(this.spawnRand() * 6);
  }
  get swimSpeed() { return 0.08; }
  skinVariant() { return { pattern: this.data.variant | 0 }; }
}

export class Squid extends WaterMob {
  initData(game, opts) { super.initData(game, opts); this.pulse = Math.floor(this.spawnRand() * 40); this.prevTent = 0; this.tent = 0; }
  // squid swim in pushes: a quick squeeze of the tentacles, then a glide
  swimAccel() { return this.pulse < 8 ? 0.03 * this.speedMod : 0; }
  swimDrag() { return 0.95; }
  tickTimers() {
    super.tickTimers();
    this.pulse = (this.pulse + 1) % (this.panicTicks > 0 ? 20 : 40);
    this.prevTent = this.tent;
    const want = this.inWater ? (this.pulse < 8 ? 0 : Math.min(1, (this.pulse - 8) / 20)) : 0.2;
    this.tent += (want - this.tent) * 0.3;
  }
  /** Hurt (in every world, kid ones too): a cloud of ink and off it shoots. */
  startPanic(a) {
    super.startPanic(a);
    const fx = this.game.fx;
    if (fx && fx.spawnParticles) fx.spawnParticles('smoke', this.x, this.y + this.height * 0.5, this.z, { count: 14, spread: 0.6, size: 0.4, color: [0.04, 0.04, 0.07] });
    this.game.events.emit('mobs:ink', { id: this.id, x: this.x, y: this.y, z: this.z });
  }
  fillPose(v, alpha) { v.tentacles = lerp(this.prevTent, this.tent, alpha); }
}

/* ================================================================== rabbit */

const RABBIT_COATS = ['brown', 'brown', 'black', 'salt', 'spotted'];
export class Rabbit extends Mob {
  initData(game, opts) {
    if (!this.data.coat) {
      const b = biomeAt(game, this.x, this.z), r = this.spawnRand();
      this.data.coat = b === 'snowy' ? (r < 0.8 ? 'white' : 'spotted') : b === 'desert' ? 'gold' : RABBIT_COATS[Math.floor(r * RABBIT_COATS.length)];
    }
    this.hopTimer = 0; this.hop = 0; this.prevHop = 0;
  }
  thinkSpecial() {
    // survival rabbits are shy: they bolt from a child who is not sneaking or holding a carrot (Java)
    const g = this.game, p = g.player;
    if (this.kidSafe || !p || p.dead || g.isCreative() || this.data.tamed) return false;
    const held = g.inventory && g.inventory.getSelected();
    if (held && this.def.tempt.includes(held.item)) return false;
    if (!p.sneaking && this.distToPlayer() < 5) { this.attacker = p; this.panicTicks = 30; }
    return false;
  }
  physics() {
    // rabbits get about by hopping
    if (this.hopTimer > 0) this.hopTimer--;
    if (this.forward > 0.1 && this.onGround && this.hopTimer === 0 && !this.inWater) { this.jumpNext = true; this.hopTimer = this.panicTicks > 0 ? 4 : 6 + Math.floor(this.rand() * 6); }
    super.physics();
    this.prevHop = this.hop;
    this.hop = this.onGround ? Math.max(0, this.hop - 0.3) : Math.min(1, this.hop + 0.4);
  }
  jumpVelocity() { return this.panicTicks > 0 ? 0.5 : 0.38; }
  skinVariant() { return { coat: this.data.coat }; }
  fillPose(v, alpha) { v.hop = lerp(this.prevHop, this.hop, alpha); }
}

/* ================================================================== fox */

export class Fox extends Mob {
  initData(game) {
    if (!this.data.variant) this.data.variant = biomeAt(game, this.x, this.z) === 'snowy' ? 'snow' : 'red';
    this.sleeping = false;
  }
  think() {
    const g = this.game;
    const day = daylightAt(g.time ? g.time.dayTime : 6000) > 0.6;
    if (this.sleeping) {
      // wakes at dusk, when hurt or tempted, or when a child walks right up without sneaking (survival)
      const p = g.player;
      const close = p && !p.dead && !p.sneaking && !this.kidSafe && this.distToPlayer() < 2.5;
      if (!day || this.panicTicks > 0 || this.data.love > 0 || close || this.inWater) this.sleeping = false;
      else { this.target = null; return; }
    }
    if (day && this.onGround && !this.target && this.panicTicks === 0 && !(this.data.love > 0) && !this.data.leashed && this.petTicks === 0 && this.rand() < 0.004) { this.sleeping = true; this.target = null; return; }
    super.think();
  }
  thinkSpecial() {
    const g = this.game, p = g.player;
    if (this.kidSafe || !p || p.dead || g.isCreative()) return false;
    const held = g.inventory && g.inventory.getSelected();
    if (held && this.def.tempt.includes(held.item)) return false;
    if (!p.sneaking && this.distToPlayer() < 6) { this.attacker = p; this.panicTicks = 40; }
    return false;
  }
  pet() { this.sleeping = false; return super.pet(); }
  startPanic(a) { this.sleeping = false; super.startPanic(a); }
  skinVariant() { return { snow: this.data.variant === 'snow' }; }
  fillPose(v) { v.sleeping = this.sleeping; }
}

/* ================================================================== bee */

const FLOWERS = new Set(['dandelion', 'poppy', 'cornflower', 'orange_tulip', 'pink_tulip', 'allium', 'lily_of_the_valley', 'blue_orchid']
  .filter((n) => ID[n] !== undefined).map((n) => ID[n]));

export class Bee extends Mob {
  initData() {
    this.noGravity = true; this.stepHeight = 0;
    this.flyTarget = null; this.flyCooldown = 0; this.flowerScan = 0; this.hover = 0;
    this.angryTicks = 0; this.attackCooldown = 0;
  }
  steer() {}
  onLand() {}
  maxDrop() { return 64; }
  get flowerPos() { return this.data.flower || null; }
  findFlower() {
    const w = this.game.world, bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
    let best = null, bd = Infinity;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) for (let dy = -4; dy <= 2; dy++) {
      if (!FLOWERS.has(w.getBlock(bx + dx, by + dy, bz + dz))) continue;
      const d = dx * dx + dy * dy + dz * dz + this.rand() * 6;
      if (d < bd) { bd = d; best = { x: bx + dx + 0.5, y: by + dy + 0.55, z: bz + dz + 0.5 }; }
    }
    return best;
  }
  think() {
    const g = this.game, p = g.player;
    if (this.angryTicks > 0) this.angryTicks--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.data.stung && !this.kidSafe && ++this.data.stung > 900 && this.age % 20 === 0) this.hurt(this.maxHealth, { type: 'starve' });
    this.target = null;
    if (this.angryTicks > 0 && !this.data.stung && this.playerIsTarget() && DIFF(g) !== 'peaceful') {
      this.flyTarget = { x: p.x, y: p.y + 1.0, z: p.z }; this.speedMod = 1.6; this.lookAt = p;
      if (this.distToPlayer() < 1.6 && this.attackCooldown === 0) {
        this.attackCooldown = 20;
        if (g.survival && g.survival.damage(this.def.attack[DIFF(g)] || 2, 'mob', { entity: this })) { this.data.stung = 1; this.angryTicks = 0; this.sound('angry'); }
      }
      return;
    }
    this.speedMod = 1;
    if (this.panicTicks > 0) {
      if (!this.flyTarget || this.age % 20 === 0) { const a = this.attacker || p; const dx = this.x - a.x, dz = this.z - a.z, l = Math.hypot(dx, dz) || 1; this.flyTarget = { x: this.x + dx / l * 6, y: this.y + 1, z: this.z + dz / l * 6 }; }
      this.speedMod = 1.5; return;
    }
    if (this.petTicks > 0 && p) { this.flyTarget = null; this.lookAt = p; return; }
    // breeding and flower-tempting reuse the ground helpers; the bee flies above the spot they choose
    if (this.data.love > 0 && !this.baby && this.thinkMate()) { this.flyTarget = { ...this.target, y: this.target.y + 0.8 }; this.target = null; return; }
    if (this.thinkTempt()) { const q = p; this.flyTarget = this.distToPlayer() > 2.5 ? { x: q.x, y: q.y + 1.4, z: q.z } : null; this.target = null; return; }
    if (this.baby && this.thinkFollowParent()) { this.flyTarget = { ...this.target, y: this.target.y + 0.6 }; this.target = null; return; }
    // flowers: fly to one, hover over it for a while (sparkly pollen), then on to the next
    if (this.hover > 0) {
      if (--this.hover === 0) { this.data.nectar = true; this.flyTarget = null; this.flyCooldown = 20; }
      else if (this.hover % 12 === 0) { const fx = g.fx; if (fx && fx.spawnParticles) fx.spawnParticles('sparkle', this.x, this.y + 0.1, this.z, { count: 1, spread: 0.2, color: [1, 0.85, 0.2] }); }
      return;
    }
    if (this.flyTarget && this.distTo(this.flyTarget.x, this.flyTarget.y, this.flyTarget.z) < 0.6) {
      if (this.flyTarget.flower && FLOWERS.has(g.world.getBlock(Math.floor(this.flyTarget.x), Math.floor(this.flyTarget.y - 0.55), Math.floor(this.flyTarget.z)))) this.hover = 60 + Math.floor(this.rand() * 60);
      this.flyTarget = null;
      return;
    }
    if (!this.flyTarget && --this.flyCooldown <= 0) {
      this.flyCooldown = 20 + Math.floor(this.rand() * 40);
      const f = this.rand() < 0.6 ? this.findFlower() : null;
      if (f) this.flyTarget = { x: f.x, y: f.y + 0.35, z: f.z, flower: true };
      else {
        const a = this.rand() * Math.PI * 2, r = 2 + this.rand() * 5;
        const tx = this.x + Math.cos(a) * r, tz = this.z + Math.sin(a) * r;
        const ground = findStandY(this.getRaw, tx, this.y, tz, 6, false);
        this.flyTarget = { x: tx, y: (ground === null ? this.y : ground) + 1 + this.rand() * 2, z: tz };
      }
    }
  }
  physics() {
    const w = this.game.world;
    const t = this.flyTarget;
    if (t) {
      const dx = t.x - this.x, dy = t.y - this.y, dz = t.z - this.z, d = Math.hypot(dx, dy, dz) || 1;
      const a = 0.02 * this.speedMod;
      this.vx += dx / d * a; this.vy += dy / d * a; this.vz += dz / d * a;
      this.yaw = turnToward(this.yaw, yawToward(dx, dz), 0.25);
    } else if (this.lookAt) this.yaw = turnToward(this.yaw, yawToward(this.lookAt.x - this.x, this.lookAt.z - this.z), 0.15);
    // keep a little air under the wings
    const below = w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.4), Math.floor(this.z));
    if (B_SOLID[below] && !t) this.vy += 0.01;
    this.vy += Math.sin(this.age * 0.15) * 0.002;
    if (this.inWater) this.vy += 0.03;
    if (this.deathTime > 0) this.vy -= 0.05;
    this.pushApart();
    const vx = this.vx, vy = this.vy, vz = this.vz;
    const m = moveEntity(w, this, vx, vy, vz);
    if (Math.abs(m.dx - vx) > 1e-7 || Math.abs(m.dz - vz) > 1e-7) { this.vx = 0; this.vz = 0; if (this.flyTarget && !this.flyTarget.flower) this.flyTarget = null; this.vy += 0.05; }
    if (Math.abs(m.dy - vy) > 1e-7) this.vy = 0;
    this.vx *= 0.88; this.vy *= 0.88; this.vz *= 0.88;
    this.fallDistance = 0;
  }
  onHurtBy(attacker) {
    const g = this.game;
    if (attacker !== g.player || this.kidSafe || DIFF(g) === 'peaceful' || g.isCreative()) return;
    // the whole swarm nearby gets angry (Java hive anger)
    for (const b of g.entities.queryRadius(this.x, this.y, this.z, 10, (e) => e.type === 'bee' && !e.deathTime)) { b.angryTicks = 500; b.panicTicks = 0; }
    this.sound('angry');
  }
  startPanic(a) { if (this.angryTicks > 0) return; super.startPanic(a); }
  skinVariant() { return { angry: this.angryTicks > 0 }; }
}

/* ================================================================== enderman */

const HOLDABLE = new Set(['grass_block', 'dirt', 'sand', 'gravel', 'clay', 'pumpkin', 'melon', 'red_mushroom', 'brown_mushroom', 'cactus', 'tnt',
  ...['dandelion', 'poppy', 'cornflower', 'orange_tulip', 'pink_tulip', 'allium', 'lily_of_the_valley', 'blue_orchid']].filter((n) => ID[n] !== undefined).map((n) => ID[n]));

export class Enderman extends Monster {
  initData() { this.angryTicks = 0; this.stare = 0; this.tpCooldown = 0; }
  get angry() { return this.angryTicks > 0; }
  tickTimers() {
    super.tickTimers();
    if (this.angryTicks > 0) this.angryTicks--;
    if (this.tpCooldown > 0) this.tpCooldown--;
  }
  tickEnvironment() {
    super.tickEnvironment();
    if (this.deathTime) return;
    const g = this.game;
    // water hurts endermen and makes them teleport away
    if (this.inWater && this.age % 10 === 0) { this.hurt(1, { type: 'drown' }); this.teleportRandom(); }
    // a calm enderman in daylight under the open sky wanders off by teleporting (Java)
    if (!this.angry && this.age % 20 === 0 && daylightAt(g.time ? g.time.dayTime : 6000) > 0.6) {
      const sky = g.world.getSkyLight(Math.floor(this.x), Math.floor(this.y + this.eyeHeight), Math.floor(this.z));
      if (sky >= 15 && this.rand() < 0.15) this.teleportRandom();
    }
  }
  /** Is the player looking right at this enderman's head with nothing in between? (Java isLookingAtMe) */
  stared() {
    const g = this.game, p = g.player;
    if (!this.playerIsTarget() || !p.getEyePos) return false;
    const e = p.getEyePos(tmpEye), d = lookDir(p.yaw, p.pitch, tmpDir);
    const hx = this.x - e.x, hy = this.y + this.eyeHeight - e.y, hz = this.z - e.z, len = Math.hypot(hx, hy, hz);
    if (len > 64 || len < 0.5) return false;
    const dot = (d.x * hx + d.y * hy + d.z * hz) / len;
    if (dot <= 1 - 0.025 / len) return false;
    const w = g.world;
    for (let s = 0.5; s < len - 0.5; s += 0.5) {
      if (B_OPAQUE[w.getBlock(Math.floor(e.x + hx / len * s), Math.floor(e.y + hy / len * s), Math.floor(e.z + hz / len * s))]) return false;
    }
    return true;
  }
  provoke() {
    if (!this.angry) { this.sound('angry'); this.game.events.emit('mobs:enderAngry', { id: this.id, x: this.x, y: this.y, z: this.z }); }
    this.angryTicks = 600;
  }
  thinkSpecial() {
    const g = this.game, p = g.player;
    if (this.age % 4 === 0 && this.stared()) { if (++this.stare >= 2) this.provoke(); } else if (this.age % 4 === 0) this.stare = 0;
    this.tryCarry();
    if (!this.angry || !this.playerIsTarget()) return false;
    const d = this.distToPlayer();
    if (d > 64) { this.angryTicks = 0; return false; }
    if (d > 12 && this.tpCooldown === 0) this.teleportToward(p);
    this.chasePlayer(0.6, 1.4);
    this.meleePlayer(this.def.attack[DIFF(g)] || this.def.attack.easy);
    return true;
  }
  onHurtBy(attacker) { if (attacker === this.game.player) this.provoke(); }
  hurt(amount, source = {}) {
    // arrows never land: it teleports out of the way (Java)
    if (source.projectile && this.deathTime === 0) { this.teleportRandom(); return false; }
    const ok = super.hurt(amount, source);
    if (ok && this.deathTime === 0 && !source.player && !source.entity && this.rand() < 0.9) this.teleportRandom();
    return ok;
  }
  /** Pick up a block now and then and put it down somewhere else later (only with rules.mobGriefing). */
  tryCarry() {
    const g = this.game;
    if (!(g.meta && g.meta.rules.mobGriefing)) return;
    const w = g.world;
    if (!this.data.carried) {
      if (this.rand() >= 1 / 200) return;
      const x = Math.floor(this.x + (this.rand() - 0.5) * 4), y = Math.floor(this.y + this.rand() * 3 - 1), z = Math.floor(this.z + (this.rand() - 0.5) * 4);
      const id = w.getBlock(x, y, z);
      if (!HOLDABLE.has(id) || w.getBlockEntity && w.getBlockEntity(x, y, z)) return;
      if (g.interaction && g.interaction.breakBlock) g.interaction.breakBlock(x, y, z, { by: 'mob', drops: false });
      else w.setBlock(x, y, z, 0, 0, { cause: 'mob' });
      this.data.carried = blockName(id);
    } else if (this.rand() < 1 / 1200) {
      const x = Math.floor(this.x + (this.rand() - 0.5) * 2), y = Math.floor(this.y + this.rand() * 2), z = Math.floor(this.z + (this.rand() - 0.5) * 2);
      const id = ID[this.data.carried];
      if (id === undefined) { delete this.data.carried; return; }
      if (w.getBlock(x, y, z) !== 0 || !B_SOLID[w.getBlock(x, y - 1, z)]) return;
      w.setBlock(x, y, z, id, 0, { cause: 'mob' });
      g.events.emit('block:placed', { x, y, z, id, state: 0, by: 'mob' });
      delete this.data.carried;
    }
  }
  /** Teleport to a free 3-high spot (feet on solid, not in fluid) near (cx, cy, cz). */
  teleportNear(cx, cy, cz, range, tries = 16) {
    const g = this.game, w = g.world;
    for (let i = 0; i < tries; i++) {
      const x = Math.floor(cx + (this.rand() - 0.5) * 2 * range) + 0.5, z = Math.floor(cz + (this.rand() - 0.5) * 2 * range) + 0.5;
      const y = findStandY(this.getRaw, x, cy, z, 12);
      if (y === null) continue;
      const by = Math.floor(y + 0.01);
      if (B_SOLID[w.getBlock(Math.floor(x), by + 2, Math.floor(z))] || isWater(w.getBlock(Math.floor(x), by, Math.floor(z)))) continue;
      const fx = g.fx;
      if (fx && fx.spawnParticles) fx.spawnParticles('sparkle', this.x, this.y + 1.4, this.z, { count: 16, spread: 0.6, color: [0.75, 0.35, 1] });
      this.sound('teleport');
      this.x = this.prevX = x; this.y = this.prevY = y; this.z = this.prevZ = z;
      this.vx = this.vy = this.vz = 0; this.fallDistance = 0; this.target = null;
      if (fx && fx.spawnParticles) fx.spawnParticles('sparkle', x, y + 1.4, z, { count: 16, spread: 0.6, color: [0.75, 0.35, 1] });
      this.sound('teleport');
      this.tpCooldown = 40;
      g.events.emit('mobs:teleport', { id: this.id, type: this.type, x, y, z });
      return true;
    }
    return false;
  }
  teleportRandom() { return this.teleportNear(this.x, this.y, this.z, 16); }
  teleportToward(p) { return this.teleportNear(p.x, p.y, p.z, 6); }
  geometryVariants() { return this.data.carried ? ['block'] : []; }
  skinVariant() {
    const c = this.data.carried, d = c && ID[c] !== undefined ? blockDef(ID[c]) : null;
    return { angry: this.angry, block: d && d.color ? d.color : '', grassy: c === 'grass_block' };
  }
  fillPose(v) { v.carrying = !!this.data.carried; v.angry = this.angry; v.armsUp = false; }
  extraLoot() { const c = this.data.carried; return c && ID[c] !== undefined ? [{ item: c, count: 1 }] : []; }
}

/* ================================================================== slime */

const SLIME_SIZES = [1, 2, 4];
export class Slime extends Monster {
  initData() {
    if (!SLIME_SIZES.includes(this.data.size)) this.data.size = SLIME_SIZES[Math.floor(this.spawnRand() * 3)];
    this.jumpDelay = 10; this.squish = 0; this.prevSquish = 0; this.wasOnGround = true; this.hopDir = null;
  }
  get size() { return this.data.size || 1; }
  baseMaxHealth() { return this.size * this.size; }
  updateSize() { const s = this.size; this.width = 0.52 * s; this.height = 0.52 * s; this.eyeHeight = 0.325 * s; }
  renderScale() { return this.size; }
  steer() {}
  think() {
    const g = this.game;
    const p = this.huntTarget(16);
    if (p) { this.hopDir = yawToward(p.x - this.x, p.z - this.z); this.lookAt = p; if (this.size > 1) this.meleePlayer(this.size * (DIFF(g) === 'easy' ? 0.75 : 1)); }
    else if (this.age % 60 === 0) this.hopDir = this.rand() < 0.7 ? this.rand() * Math.PI * 2 : null;
  }
  physics() {
    this.forward = 0;
    if (this.onGround && this.deathTime === 0 && this.hopDir !== null && --this.jumpDelay <= 0) {
      const hunting = !!this.huntTarget(16);
      this.jumpDelay = (10 + Math.floor(this.rand() * 20)) / (hunting ? 3 : 1) | 0;
      this.yaw = this.hopDir;
      const sp = 0.12 + 0.03 * this.size;
      this.vx += -Math.sin(this.yaw) * sp; this.vz += -Math.cos(this.yaw) * sp;
      this.vy = 0.42 + 0.02 * this.size;
      this.squish = 0.5;
    }
    super.physics();
    if (this.onGround && !this.wasOnGround) { this.squish = -0.5; this.sound('land'); }
    this.wasOnGround = this.onGround;
    this.prevSquish = this.squish;
    this.squish *= 0.6;
  }
  onLand() {}
  tickDeath() {
    if (this.deathTime === 19 && this.size > 1) this.split();
    super.tickDeath();
  }
  /** Two to four slimes half the size (Java). */
  split() {
    const g = this.game, n = 2 + Math.floor(this.grand() * 3), s = this.size / 2;
    for (let i = 0; i < n; i++) {
      const ox = ((i % 2) - 0.5) * this.width * 0.5, oz = (Math.floor(i / 2) - 0.5) * this.width * 0.5;
      const c = g.mobs && g.mobs.spawnMob ? g.mobs.spawnMob('slime', this.x + ox, this.y + 0.2, this.z + oz, { size: s, reason: 'split' }) : null;
      if (c) { c.yaw = this.rand() * Math.PI * 2; c.vy = 0.3; }
    }
  }
  dropLoot() {
    const g = this.game;
    if (this.killedByPlayer && !g.isCreative() && g.mobs && g.mobs.spawnXp) g.mobs.spawnXp(this.x, this.y + 0.3, this.z, this.size);
  }
  render(game, alpha) {
    super.render(game, alpha);
    const o = this.object3d;
    if (!o || this.deathTime > 0) return;
    const q = lerp(this.prevSquish, this.squish, alpha), s = this.size;
    o.scale.set(s * (1 - q * 0.3), s * (1 + q * 0.5), s * (1 - q * 0.3));
  }
}

/* ================================================================== villager */

const PROFESSIONS = ['farmer', 'librarian', 'cleric', 'smith', 'shepherd'];
/** profession -> gifts for one emerald: [item, count] */
const GIFTS = {
  farmer: [['bread', 3], ['carrot', 4], ['apple', 2]],
  librarian: [['book', 1], ['paper', 6]],
  cleric: [['redstone', 4], ['lapis_lazuli', 3], ['glowstone_dust', 2]],
  smith: [['iron_ingot', 2], ['coal', 4]],
  shepherd: [['white_wool', 2], ['red_wool', 2], ['light_blue_wool', 2], ['yellow_wool', 2], ['lime_wool', 2]],
  plain: [['bread', 2]],
};

export class Villager extends Mob {
  initData(game, opts) {
    if (!this.data.variant) this.data.variant = PROFESSIONS[Math.floor(this.spawnRand() * PROFESSIONS.length)];
    this.shake = 0; this.nod = 0; this.wish = null; this.wishTicks = 0;
  }
  interactLeash() { return false; }
  tickTimers() {
    super.tickTimers();
    if (this.shake > 0) this.shake--;
    if (this.nod > 0) this.nod--;
    if (this.wishTicks > 0) this.wishTicks--;
  }
  thinkSpecial() {
    // villagers run from zombies
    const z = this.game.entities.queryRadius(this.x, this.y, this.z, 8, (e) => e.type === 'zombie' && !e.deathTime)[0];
    if (z) { this.attacker = z; this.panicTicks = Math.max(this.panicTicks, 40); this.thinkPanic(); return true; }
    if (this.shake > 0 || this.nod > 0) { this.target = null; this.lookAt = this.game.player; return true; }
    return false;
  }
  /** An emerald buys a small gift from the villager's trade; anything else gets a friendly head shake. */
  interactSpecial(ctx) {
    const g = this.game, item = ctx.stack ? ctx.stack.item : null;
    if (this.baby) { this.shake = 20; this.sound('no'); return true; }
    if (item === 'emerald') {
      const list = GIFTS[this.data.variant] || GIFTS.plain;
      const [gift, count] = list[Math.floor(g.rand() * list.length)];
      this.consumeHeld(); this.touch();
      giveToPlayer(this, { item: gift, count });
      this.nod = 24; this.wishTicks = 0;
      if (g.fx && g.fx.spawnParticles) g.fx.spawnParticles('sparkle', this.x, this.y + 2.1, this.z, { count: 8, spread: 0.5, color: [0.3, 1, 0.4] });
      this.sound('yes');
      g.events.emit('mobs:trade', { id: this.id, type: this.type, profession: this.data.variant, item: gift, count, x: this.x, y: this.y, z: this.z });
      return true;
    }
    this.shake = 24; this.wishTicks = 60;
    this.sound('no');
    return true;
  }
  skinVariant() { return { prof: this.data.variant }; }
  fillPose(v) { v.shake = this.shake; v.nod = this.nod; }
  /** A floating emerald over the head while it waits for one (the picture says what it wants). */
  render(game, alpha) {
    super.render(game, alpha);
    if (!(this.wishTicks > 0) || this.deathTime > 0) { this.disposeWish(game); return; }
    if (!this.wish) {
      if (!game.fx || !game.fx.makeItemMesh || !game.renderer || !game.renderer.addObject) return;
      this.wish = game.fx.makeItemMesh('emerald');
      if (!this.wish) return;
      game.renderer.addObject(this.wish);
    }
    const t = this.age + alpha;
    this.wish.position.set(lerp(this.prevX, this.x, alpha), lerp(this.prevY, this.y, alpha) + this.height * this.renderScale() + 0.55 + Math.sin(t * 0.2) * 0.06, lerp(this.prevZ, this.z, alpha));
    this.wish.rotation.set(0, t * 0.08, 0);
    const m = this.wish.material;
    if (m && m.uniforms && m.uniforms.uLightSky) { m.uniforms.uLightSky.value = 15; if (m.uniforms.uLightBlock) m.uniforms.uLightBlock.value = 15; }
  }
  disposeWish(game) {
    if (!this.wish) return;
    if (game.renderer) game.renderer.removeObject(this.wish);
    if (game.fx && game.fx.disposeItemMesh) game.fx.disposeItemMesh(this.wish);
    this.wish = null;
  }
  dispose(game) { super.dispose(game); this.disposeWish(game); }
}

/* ================================================================== iron golem */

export class IronGolem extends Mob {
  initData() { this.attackAnim = 0; this.attackCooldown = 0; this.offerTicks = 0; this.giftCooldown = 0; this.combatTarget = null; this.angryAtPlayer = 0; }
  knockback() {}                    // far too heavy to be pushed around
  startPanic() {}
  onLand() {}
  tickTimers() {
    super.tickTimers();
    if (this.attackAnim > 0) this.attackAnim--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.offerTicks > 0) this.offerTicks--;
    if (this.giftCooldown > 0) this.giftCooldown--;
    if (this.angryAtPlayer > 0) this.angryAtPlayer--;
  }
  thinkSpecial() {
    const g = this.game, p = g.player;
    let t = this.combatTarget;
    if (t && (t.removed || t.deathTime > 0 || this.distTo(t.x, t.y, t.z) > 20)) t = this.combatTarget = null;
    if (!t && this.age % 10 === 0) {
      let best = 16 * 16;
      for (const m of g.entities.queryRadius(this.x, this.y, this.z, 16, (e) => e.category === 'monster' && !e.deathTime && e.type !== 'creeper')) {
        const d = (m.x - this.x) ** 2 + (m.z - this.z) ** 2;
        if (d < best) { best = d; t = m; }
      }
      this.combatTarget = t || null;
    }
    if (!t && this.angryAtPlayer > 0 && this.playerIsTarget() && DIFF(g) !== 'peaceful') t = p;
    if (!t) { if (this.offerTicks > 0 && p) { this.target = null; this.lookAt = p; return true; } return false; }
    this.target = { x: t.x, y: t.y, z: t.z }; this.stopDist = 1.2; this.speedMod = 1; this.lookAt = t;
    const reach = this.width / 2 + (t.width || 0.6) / 2 + 0.9;
    if (Math.hypot(t.x - this.x, t.z - this.z) < reach && Math.abs(t.y - this.y) < 2 && this.attackCooldown === 0) {
      this.attackCooldown = 20; this.attackAnim = 10;
      if (t === p) { if (g.survival) g.survival.damage(this.def.attack[DIFF(g)] || 7, 'mob', { entity: this }); if (p.onGround) p.vy = 0.6; }
      else { t.hurt(7 + Math.floor(g.rand() * 15), { type: 'mob', entity: this }); t.vy = Math.max(t.vy || 0, 0.5); }
    }
    return true;
  }
  onHurtBy(attacker) { if (attacker === this.game.player && !this.kidSafe && !this.game.isCreative()) this.angryAtPlayer = 600; }
  /** Tap: hold out a poppy and give it to the child (once a while); an iron ingot mends a hurt golem (Java). */
  interactSpecial(ctx) {
    const g = this.game, item = ctx.stack ? ctx.stack.item : null;
    if (item === 'iron_ingot' && this.health < this.maxHealth) { this.health = Math.min(this.maxHealth, this.health + 25); this.consumeHeld(); this.sound('step'); return true; }
    if (this.giftCooldown === 0 && !this.baby) {
      this.giftCooldown = 400; this.offerTicks = 60;
      giveToPlayer(this, { item: 'poppy', count: 1 });
      this.sound('gift');
      g.events.emit('mobs:gift', { id: this.id, type: this.type, item: 'poppy', x: this.x, y: this.y, z: this.z });
      return true;
    }
    return this.pet();
  }
  geometryVariants() { return this.offerTicks > 0 ? ['flower'] : []; }
  fillPose(v) { v.offer = this.offerTicks > 0; v.attackAnim = this.attackAnim / 10; v.armsUp = false; }
}

export const MORE_CLASSES = {
  cod: Cod, tropical_fish: TropicalFish, squid: Squid, rabbit: Rabbit, fox: Fox, bee: Bee,
  enderman: Enderman, slime: Slime, villager: Villager, iron_golem: IronGolem,
};
for (const C of Object.values(MORE_CLASSES)) C.prototype.sound = mappedSound;
