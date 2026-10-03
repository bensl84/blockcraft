// OWNER LANE: FEATURE-MOBS. Passive animals (SPEC §2.6): pig (saddle + ride, P1), cow (milk), sheep (shear, dye,
// regrow by grazing, rainbow easter egg), chicken (eggs, slow fall, flapping), wolf (tame with a bone 1/3, sit,
// follow, teleport > 12 blocks, beg, defend), cat (P1: tame with raw chicken, scares creepers), horse (P1:
// tame by riding with temper, saddle, steer, jump). Base behaviour lives in mob.js.

import { Mob } from './mob.js';
import { MOBS } from '../data/mobs.js';
import { COLORS } from '../core/constants.js';
import { ID } from '../core/registry.js';
import { getItem } from '../data/items.js';
import { checkRainbow, findStandY, rainbowColor, randInt, rollSheepColor, wrapAngle } from './mob_ai.js';
import { dropItem } from './item_entity.js';

/* ------------------------------------------------------------------ riding helpers */
function wantsDismount(game) {
  const inp = game.input;
  return !!inp && (inp.isDown('descend') || inp.isDown('sneak'));
}

/* ------------------------------------------------------------------ pig */
export class Pig extends Mob {
  interactSpecial(ctx) {
    const item = ctx.stack ? ctx.stack.item : null;
    if (this.baby) return false;
    if (item === 'saddle' && !this.data.saddled) { this.data.saddled = true; this.consumeHeld(); this.touch(); this.sound('idle'); return true; }
    if (this.data.saddled && !(item && this.def.breed.includes(item)) && item !== 'saddle') return this.mount();
    return false;
  }
  controlRidden(rider) {
    const g = this.game;
    if (wantsDismount(g)) { this.dismount(); this.think(); return; }
    const held = g.inventory && g.inventory.getSelected();
    if (held && held.item === this.def.steerWith) {
      // a carrot on a stick steers the pig where the rider looks (Java); otherwise it wanders with the rider on it
      this.target = null;
      this.wantYaw = rider.yaw;
      this.yaw = this.yaw + wrapAngle(rider.yaw - this.yaw) * 0.3;
      this.forward = 1; this.speedMod = 1.4;
      this.lookAt = null;
      return;
    }
    this.think();
  }
  getSeat() { return { x: this.x, y: this.y + 0.8 * (this.baby ? 0.5 : 1), z: this.z, yaw: this.yaw }; }
  fillPose(v) { v.saddled = !!this.data.saddled; }
}

/* ------------------------------------------------------------------ cow */
export class Cow extends Mob {
  interactSpecial(ctx) {
    const item = ctx.stack ? ctx.stack.item : null;
    if (item !== 'bucket' || this.baby) return false;
    const g = this.game, inv = g.inventory;
    const milk = { item: 'milk_bucket', count: 1 };
    if (g.isCreative()) { if (inv && inv.find('milk_bucket') < 0) inv.add(milk); }
    else if (inv) {
      const s = inv.getSelected();
      if (s && s.count === 1) inv.replaceSelected(milk);
      else { inv.consumeSelected(1); if (inv.add(milk) > 0) dropItem(g, milk, g.player.x, g.player.y + 1, g.player.z); }
    }
    g.events.emit('sound', { name: 'bucket.fill', x: this.x, y: this.y + 1, z: this.z });
    this.touch();
    return true;
  }
}

/* ------------------------------------------------------------------ sheep */
export class Sheep extends Mob {
  initData(game) {
    if (!this.data.color) this.data.color = game && game.rand ? rollSheepColor(() => game.rand(), MOBS.sheep.colorWeights) : 'white';
  }
  currentColor() { return this.data.rainbow ? rainbowColor(this.age, MOBS.sheep.rainbow.cycleTicks) : this.data.color; }
  woolColor() { return this.data.rainbow ? COLORS[Math.floor(this.grand() * COLORS.length)] : this.data.color || 'white'; }
  geometryVariants() { return this.data.sheared ? [] : ['wool']; }
  skinVariant() { return { color: this.currentColor() }; }

  thinkSpecial() {
    if (this.target || this.eating > 0 || this.panicTicks > 0) return false;
    // grazing: sheared sheep graze more often so the wool comes back within ~15 s on average. The wait is drawn
    // once (geometric distribution) instead of rolling every tick, so idle sheep barely touch game.rand().
    if (!(this.nextGraze > 0)) {
      const chance = (this.data.sheared ? 1 / 300 : 1 / 1000) * (this.baby ? 10 : 1);
      this.nextGraze = 1 + Math.floor(Math.log(1 - this.rand() * 0.999999) / Math.log(1 - chance));
      this.grazeSheared = !!this.data.sheared;
    }
    if (this.grazeSheared !== !!this.data.sheared) { this.nextGraze = 0; return false; }
    if (--this.nextGraze <= 0) { this.eating = 40; this.target = null; return true; }
    return false;
  }
  tickTimers() {
    super.tickTimers();
    if (this.eating === 5) this.eatGrass();
  }
  eatGrass() {
    const g = this.game, w = g.world;
    const x = Math.floor(this.x), y = Math.floor(this.y + 0.01), z = Math.floor(this.z);
    const feet = w.getBlock(x, y, z), ground = w.getBlock(x, y - 1, z);
    const grass = feet === ID.short_grass || ground === ID.grass_block;
    if (!grass) return;
    const griefing = !!(g.meta && g.meta.rules.mobGriefing);
    if (griefing) {
      if (feet === ID.short_grass && g.interaction && g.interaction.breakBlock) g.interaction.breakBlock(x, y, z, { by: 'mob', drops: false });
      else if (ground === ID.grass_block) w.setBlock(x, y - 1, z, ID.dirt, 0, { cause: 'mob' });
    }
    this.data.sheared = false;
    if (this.baby) this.data.grow = Math.max(1, (this.data.grow || 0) - 60);
    this.sound('eat');
  }
  interactSpecial(ctx) {
    const s = ctx.stack, item = s ? s.item : null;
    if (!item) return false;
    const g = this.game;
    if (item === 'shears') {
      if (this.data.sheared || this.baby) return true;
      const [a, b] = this.def.shearDrops || [1, 3];
      const n = randInt(() => this.grand(), a, b);
      for (let i = 0; i < n; i++) {
        dropItem(g, { item: this.woolColor() + '_wool', count: 1 }, this.x, this.y + this.height * 0.8, this.z,
          { vx: (this.grand() - 0.5) * 0.1, vy: 0.2 + this.grand() * 0.05, vz: (this.grand() - 0.5) * 0.1 });
      }
      this.data.sheared = true;
      this.touch();
      g.events.emit('sound', { name: 'shear', x: this.x, y: this.y + 1, z: this.z });
      g.events.emit('mob:sheared', { id: this.id, type: this.type, x: this.x, y: this.y, z: this.z, count: n });
      if (!g.isCreative() && g.inventory) g.inventory.damageSelected(1);
      return true;
    }
    const def = getItem(item);
    if (def && def.use === 'dye' && def.dye) {
      if (this.data.sheared) return true;
      const cfg = this.def.rainbow;
      const hist = (this.data.dyes = Array.isArray(this.data.dyes) ? this.data.dyes : []);
      hist.push({ color: def.dye, tick: g.tickCount });
      while (hist.length > 6) hist.shift();
      const changed = this.data.rainbow || this.data.color !== def.dye;
      if (!changed) return true;
      this.data.color = def.dye;
      this.data.rainbow = false;
      if (cfg && checkRainbow(hist, g.tickCount, cfg)) {
        this.data.rainbow = true;
        this.particles('sparkle', 12);
        g.events.emit('mobs:rainbow', { id: this.id, type: this.type, x: this.x, y: this.y, z: this.z });
      }
      this.consumeHeld(); this.touch();
      this.particles('sparkle', 3);
      return true;
    }
    return false;
  }
  babyOpts(mate) {
    const a = this.data.rainbow ? COLORS[Math.floor(this.rand() * 16)] : this.data.color;
    const b = mate && mate.data ? (mate.data.rainbow ? COLORS[Math.floor(this.rand() * 16)] : mate.data.color) : a;
    return { color: this.rand() < 0.5 ? a : b };
  }
  fillPose(v) { v.eating = this.eating; }
}

/* ------------------------------------------------------------------ chicken */
export class Chicken extends Mob {
  initData(game) {
    this.slowFall = true;
    if (!(this.data.eggTimer > 0)) this.data.eggTimer = game && game.rand ? randInt(() => game.rand(), ...MOBS.chicken.layEggTicks) : 6000;
    this.flap = 0; this.prevFlap = 0;
  }
  tickTimers() {
    super.tickTimers();
    if (!this.baby && --this.data.eggTimer <= 0) {
      this.data.eggTimer = randInt(() => this.grand(), ...this.def.layEggTicks);
      dropItem(this.game, { item: 'egg', count: 1 }, this.x, this.y + 0.3, this.z, { vx: 0, vy: 0.1, vz: 0 });
      this.game.events.emit('sound', { name: 'egg.lay', x: this.x, y: this.y, z: this.z });
    }
    this.prevFlap = this.flap;
    const target = this.onGround || this.inWater ? 0 : 1.2;
    this.flap += (target - this.flap) * 0.3;
  }
  fillPose(v, alpha) {
    const f = this.prevFlap + (this.flap - this.prevFlap) * alpha;
    v.flap = f > 0.05 ? Math.abs(Math.sin((this.age + alpha) * 0.9)) * f : 0;
  }
}

/* ------------------------------------------------------------------ tameables: wolf, cat */
class Tameable extends Mob {
  baseMaxHealth() { return this.data.tamed && this.def.tamedHp ? this.def.tamedHp : this.def.hp; }
  canBreed() { return !!this.data.tamed; }
  babyOpts() { return this.data.tamed ? { tamedBy: this.data.owner || 'player' } : {}; }
  tame() {
    const g = this.game;
    this.data.tamed = true; this.data.owner = 'player'; this.data.sitting = true;
    this.maxHealth = this.baseMaxHealth(); this.health = this.maxHealth;
    this.target = null; this.panicTicks = 0; this.angryTicks = 0;
    this.touch();
    this.particles('heart', 7);
    this.sound('tame');
    g.events.emit('mob:tamed', { id: this.id, type: this.type, x: this.x, y: this.y, z: this.z });
  }
  /** Tamed pets: sit, follow the player, teleport when too far (SPEC §2.6). Returns true when it acted. */
  thinkPet() {
    if (!this.data.tamed) return false;
    const p = this.game.player;
    if (this.data.sitting) { this.target = null; if (p && this.distToPlayer() < 8) this.lookAt = p; return true; }
    if (!p || p.dead) return false;
    const d = this.distToPlayer();
    const tp = this.def.followTeleportDist || 12;
    if (d > tp && this.teleportNearPlayer()) return true;
    if (d > 10 || (this.following && d > 2)) {
      this.following = true;
      this.target = { x: p.x, y: p.y, z: p.z };
      this.stopDist = 2; this.speedMod = 1.3;
      return true;
    }
    this.following = false;
    return false;
  }
  teleportNearPlayer() {
    const p = this.game.player;
    for (let i = 0; i < 10; i++) {
      const a = this.rand() * Math.PI * 2, r = 2 + this.rand() * 1.5;
      const x = Math.floor(p.x + Math.cos(a) * r) + 0.5, z = Math.floor(p.z + Math.sin(a) * r) + 0.5;
      const y = findStandY(this.getRaw, x, p.y, z, 3);
      if (y === null) continue;
      this.x = this.prevX = x; this.y = this.prevY = y; this.z = this.prevZ = z;
      this.vx = this.vy = this.vz = 0; this.fallDistance = 0; this.target = null;
      return true;
    }
    return false;
  }
  toggleSit() { this.data.sitting = !this.data.sitting; this.target = null; this.following = false; this.sound('idle'); }
}

export class Wolf extends Tameable {
  initData() { this.angryTicks = 0; this.combatTarget = null; this.attackCooldown = 0; this.begging = false; }
  skinVariant() { return { tamed: !!this.data.tamed, angry: this.angryTicks > 0 }; }
  tickTimers() {
    super.tickTimers();
    if (this.angryTicks > 0) this.angryTicks--;
    if (this.attackCooldown > 0) this.attackCooldown--;
  }
  thinkSpecial() {
    const g = this.game, p = g.player;
    this.begging = false;
    // fight: angry wild wolf -> player (survival, not peaceful); tamed wolf -> whatever hurt its owner
    const diff = g.meta ? g.meta.difficulty : 'peaceful';
    if (this.angryTicks > 0 && !this.data.tamed && this.playerIsTarget() && diff !== 'peaceful') return this.chase(p, () => {
      if (g.survival) g.survival.damage(this.def.attack[diff] || 4, 'mob', { entity: this });
    });
    if (this.data.tamed && this.combatTarget) {
      const t = this.combatTarget;
      if (t.removed || t.deathTime > 0 || this.distTo(t.x, t.y, t.z) > 16 || this.data.sitting) this.combatTarget = null;
      else return this.chase(t, () => t.hurt(this.def.attack.normal || 4, { type: 'mob', entity: this }));
    }
    if (this.thinkPet()) return true;
    if (p && !p.dead && this.distToPlayer() < 8) {
      const held = g.inventory && g.inventory.getSelected();
      if (held && this.def.begItems.includes(held.item)) { this.begging = true; this.lookAt = p; this.target = null; return true; }
    }
    return false;
  }
  /** Run at a target and bite it every 20 ticks when close. */
  chase(t, bite) {
    this.target = { x: t.x, y: t.y, z: t.z };
    this.stopDist = 0.8; this.speedMod = 1.3; this.lookAt = t;
    const reach = this.width / 2 + (t.width || 0.6) / 2 + 0.6;
    if (Math.hypot(t.x - this.x, t.z - this.z) < reach && Math.abs(t.y - this.y) < 1.5 && this.attackCooldown === 0) {
      this.attackCooldown = 20;
      bite();
    }
    return true;
  }
  onHurtBy(attacker) {
    if (!attacker) return;
    if (!this.data.tamed && attacker === this.game.player && !this.kidSafe) { this.angryTicks = 400; this.panicTicks = 0; }
    if (this.data.tamed) this.data.sitting = false;
  }
  startPanic(attacker) { if (this.angryTicks > 0 || this.data.tamed) return; super.startPanic(attacker); }
  /** Owner protection (called by mobs.js on player:hurt / when the player hits something). */
  defendAgainst(ent) {
    if (!this.data.tamed || this.data.sitting || !ent || ent === this || ent.type === 'creeper') return;
    if (ent.data && ent.data.tamed) return;
    this.combatTarget = ent;
  }
  interactSpecial(ctx) {
    const item = ctx.stack ? ctx.stack.item : null;
    const g = this.game;
    if (this.data.tamed) {
      if (item && this.def.breed.includes(item)) {
        const food = getItem(item);
        if (this.health < this.maxHealth) {
          this.health = Math.min(this.maxHealth, this.health + (food && food.food ? food.food.hunger : 4));
          this.consumeHeld(); this.sound('eat'); this.particles('heart', 2);
          return true;
        }
        return this.feed(ctx);
      }
      this.toggleSit();
      return true;
    }
    if (item === this.def.tameItem) {
      if (this.angryTicks > 0) return true;
      this.consumeHeld();
      if (g.rand() < this.def.tameChance) this.tame();
      else this.particles('smoke', 5);
      return true;
    }
    return false;
  }
  fillPose(v) {
    v.sitting = !!this.data.sitting;
    v.wag = !!this.data.tamed && (this.begging || this.following || this.limbAmount < 0.1);
    v.tailLift = this.angryTicks > 0 ? -0.4 : this.data.tamed ? 0.9 - 1.2 * (this.health / this.maxHealth) : 0.5;
  }
}

export class Cat extends Tameable {
  thinkSpecial() {
    if (this.thinkPet()) return true;
    return false;
  }
  startPanic(attacker) { if (!this.data.tamed) super.startPanic(attacker); }
  interactSpecial(ctx) {
    const item = ctx.stack ? ctx.stack.item : null;
    if (this.data.tamed) {
      if (item && this.def.breed.includes(item)) return this.feed(ctx);
      this.toggleSit();
      return true;
    }
    if (item === this.def.tameItem) {
      this.consumeHeld();
      if (this.game.rand() < this.def.tameChance) this.tame(); else this.particles('smoke', 4);
      return true;
    }
    return false;
  }
  fillPose(v) { v.sitting = !!this.data.sitting; }
}

/* ------------------------------------------------------------------ horse (P1) */
export class Horse extends Mob {
  initData(game) {
    const r = game && game.rand ? () => game.rand() : () => 0.5;
    const d = this.data, def = MOBS.horse;
    if (!d.coat) d.coat = def.colors[Math.floor(r() * def.colors.length)];
    if (!(d.hp > 0)) d.hp = def.hp[0] + Math.floor(r() * 8) + Math.floor(r() * 9);
    if (!(d.speed > 0)) d.speed = (0.45 + r() * 0.3 + r() * 0.3 + r() * 0.3) * 0.25;
    if (!(d.jump > 0)) d.jump = def.jump[0] + (r() + r() + r()) / 3 * (def.jump[1] - def.jump[0]);
    if (!(d.temper >= 0)) d.temper = 0;
    this.rideTicks = 0;
  }
  canBreed() { return !!this.data.tamed; }
  interactSpecial(ctx) {
    const item = ctx.stack ? ctx.stack.item : null;
    if (this.baby) return false;
    const d = this.data;
    if (item && d.tamed && this.def.breed.includes(item) && !d.love && !d.cooldown) return this.feed(ctx);
    const temper = item ? this.def.temperItems[item] : 0;
    if (temper) {
      if (!d.tamed) d.temper = Math.min(100, d.temper + temper);
      this.health = Math.min(this.maxHealth, this.health + 2);
      this.consumeHeld(); this.sound('eat'); this.touch();
      return true;
    }
    if (item === 'saddle' && d.tamed && !d.saddled) { d.saddled = true; this.consumeHeld(); this.touch(); return true; }
    return this.mount();
  }
  controlRidden(rider) {
    const g = this.game, d = this.data;
    this.riddenAccel = false;
    if (wantsDismount(g)) { this.dismount(); this.think(); return; }
    if (!d.tamed) {
      // taming by riding (SPEC §2.6): every 30 ticks either it accepts the rider or bucks (+5 temper)
      this.think();
      if (++this.rideTicks % 30 === 0) {
        if (this.grand() * 100 < d.temper) {
          d.tamed = true; d.owner = 'player'; this.touch();
          this.particles('heart', 7); this.sound('tame');
          g.events.emit('mob:tamed', { id: this.id, type: this.type, x: this.x, y: this.y, z: this.z });
        } else {
          d.temper = Math.min(100, d.temper + (this.def.temperPerAttempt || 5));
          this.sound('angry');
          this.dismount();
          if (this.onGround) this.vy = 0.3;
        }
      }
      return;
    }
    if (!d.saddled) { this.think(); return; }
    const mv = g.input ? g.input.move : { forward: 0 };
    this.target = null;
    this.yaw = this.yaw + wrapAngle(rider.yaw - this.yaw) * 0.5;
    this.wantYaw = this.yaw;
    this.forward = Math.max(0, mv.forward);
    this.riddenAccel = true;
    if (g.input && g.input.isDown('jump') && this.onGround) this.jumpNext = true;
  }
  jumpVelocity() { return this.rider() ? Math.max(0.42, this.data.jump || 0.5) : 0.42; }
  getSeat() { return { x: this.x, y: this.y + 1.25 * (this.baby ? 0.5 : 1), z: this.z, yaw: this.yaw }; }
  skinVariant() { return { coat: this.data.coat }; }
  fillPose(v) { v.saddled = !!this.data.saddled; }
}

export const ANIMAL_CLASSES = { pig: Pig, cow: Cow, sheep: Sheep, chicken: Chicken, wolf: Wolf, cat: Cat, horse: Horse };
