// OWNER LANE: FEATURE-MOBS (mobs + entities + survival damage). SPEC §2.3, §8.1 "Survival".
// Health / hunger / saturation / exhaustion / regeneration / starvation, damage with 10-tick invulnerability and
// armour, fall damage (from 'player:land', fallMult of the landing block), drowning, lava / fire, cactus,
// suffocation, void (only when rules.voidRescue is off), eating (32 ticks; kid scheme: one tap finishes on its
// own), effects (regeneration, absorption, hunger), death -> 'player:death', respawn at bed / world spawn,
// keep-inventory rule, peaceful refill. Every damage source is gated by its rule; creative ignores everything
// except the void. Pure maths in survival/damage.js.

import { SURVIVAL } from '../core/constants.js';
import { B_OPAQUE, ID, blockDef } from '../core/registry.js';
import { ITEM_LIST, getItem } from '../data/items.js';
import { registerItemUse } from '../core/hooks.js';
import { ARMORED_CAUSES, addFoodValues, airTick, applyArmor, applyInvuln, drainExhaustion, fallDamage, regenTick } from './damage.js';
import { dropItem } from '../entities/item_entity.js';

/** @returns {object} Survival system (game.survival) */
export function createSurvivalSystem(game) {
  const inv = { invuln: 0, lastDamage: 0 };
  const timers = { regen: 0, starve: 0, refill: 0, effect: 0 };
  let eating = null;           // {item, slot, ticks}
  let respawnIn = 0;
  let lastX = 0, lastZ = 0, havePos = false;

  const P = () => game.player;
  const rules = () => (game.meta && game.meta.rules) || {};
  const difficulty = () => (game.meta ? game.meta.difficulty : 'peaceful');
  const hungerOn = () => !!rules().hunger && difficulty() !== 'peaceful';

  function armorPoints() {
    const a = game.inventory && game.inventory.armor;
    if (!a) return 0;
    let n = 0;
    for (const s of a) { const d = s && getItem(s.item); if (d && d.armor) n += d.armor.points; }
    return n;
  }
  function wearArmor(amount) {
    const a = game.inventory && game.inventory.armor;
    if (!a) return;
    const wear = Math.max(1, Math.floor(amount / 4));
    let changed = false;
    for (let i = 0; i < a.length; i++) {
      const s = a[i], d = s && getItem(s.item);
      if (!d || !d.armor) continue;
      s.damage = (s.damage || 0) + wear; changed = true;
      if (s.damage >= d.armor.durability) { a[i] = null; game.events.emit('item:broken', { item: s.item }); }
    }
    if (changed) { game.inventory.version++; game.events.emit('inventory:changed', { slot: -1 }); }
  }

  const sys = {
    name: 'survival',

    init() {
      // food item uses: everything with use 'eat' / 'drink'
      for (const d of ITEM_LIST) {
        if (d.use !== 'eat' && d.use !== 'drink') continue;
        registerItemUse(d.key, (ctx) => sys.startEating(ctx));
      }
      game.events.on('player:land', (e) => sys.onLand(e));
      game.events.on('player:jump', (e) => { if (!game.isCreative()) sys.addExhaustion(e && e.sprint ? SURVIVAL.EXHAUST.SPRINT_JUMP : SURVIVAL.EXHAUST.JUMP); });
      game.events.on('player:spawnSet', (e) => { const p = P(); if (p && e) p.spawnPoint = { x: e.x, y: e.y, z: e.z }; });
      game.events.on('player:hotbar', () => { if (eating) sys.cancelEating(); });
      game.events.on('world:exit', () => { eating = null; respawnIn = 0; havePos = false; });
    },

    /** Is the player currently eating? {item, ticks} or null (FX/HUD may read it). */
    get eating() { return eating ? { item: eating.item, ticks: eating.ticks } : null; },

    /**
     * Damage the player. cause: 'fall'|'drown'|'lava'|'fire'|'cactus'|'suffocate'|'void'|'starve'|'mob'|
     * 'explosion'|'arrow'|'generic'. source: {entity?}. Creative ignores everything except 'void'.
     * 'void' (feet below SURVIVAL.VOID_Y) returns false while rules.voidRescue is on (default, also in
     * survival): the kid lane rescues at y < 0 first. Returns true if damage was applied. Emits 'player:hurt'
     * {amount, cause, health, source}.
     */
    damage(amount, cause = 'generic', source = null) {
      const p = P();
      if (!p || p.dead || !(amount > 0) || !game.meta) return false;
      if (cause === 'void') { if (rules().voidRescue !== false) return false; }
      else if (game.isCreative()) return false;
      if (difficulty() === 'peaceful' && (cause === 'mob' || cause === 'arrow')) return false;
      let dmg = applyInvuln(inv, amount);
      if (dmg <= 0) return false;
      if (ARMORED_CAUSES.has(cause)) { const pts = armorPoints(); if (pts > 0) { dmg = applyArmor(dmg, pts); wearArmor(amount); } }
      const abs = p.effects && p.effects.absorption;
      if (abs && abs.amount > 0) { const take = Math.min(abs.amount, dmg); abs.amount -= take; dmg -= take; }
      p.health = Math.max(0, p.health - dmg);
      p.hurtTime = 10;
      sys.addExhaustion(SURVIVAL.EXHAUST.DAMAGE);
      if (eating && cause !== 'starve') { /* Java keeps eating; kids too */ }
      game.events.emit('player:hurt', { amount: dmg, cause, health: p.health, source: source || null });
      if (p.health <= 0) sys.kill(cause);
      return true;
    },

    /** Heal n half-hearts (clamped). Emits 'player:heal'. */
    heal(n) {
      const p = P();
      if (!p || p.dead || !(n > 0) || p.health >= p.maxHealth) return;
      const before = p.health;
      p.health = Math.min(p.maxHealth, p.health + n);
      game.events.emit('player:heal', { amount: p.health - before, health: p.health });
    },

    /** Add exhaustion (SURVIVAL.EXHAUST values). Only counts in survival with hunger on. */
    addExhaustion(x) {
      const p = P();
      if (!p || !(x > 0) || game.isCreative() || !hungerOn()) return;
      p.exhaustion = (p.exhaustion || 0) + x;
      drainExhaustion(p);
    },

    /** Can the player eat this food item right now? */
    canEat(itemKey) {
      const p = P(), d = getItem(itemKey);
      if (!p || p.dead || !d || !d.food) return false;
      return d.food.alwaysEdible || p.food < SURVIVAL.MAX_FOOD;
    },

    /** Apply a food item's hunger/saturation/effects immediately (after the 32-tick eat). Emits 'player:ate'. */
    applyFood(itemKey) {
      const p = P(), d = getItem(itemKey);
      if (!p || !d || !d.food) return false;
      addFoodValues(p, d.food.hunger, d.food.saturation);
      if (d.use === 'drink' && itemKey === 'milk_bucket') p.effects = {};
      for (const ef of d.food.effects || []) if (game.rand() < (ef.chance ?? 1)) sys.addEffect(ef.type, ef.level || 1, ef.ticks || 0);
      game.events.emit('player:ate', { item: itemKey });
      return true;
    },

    /** Add hunger/saturation directly (cake slices). */
    addFood(hunger, saturation) { const p = P(); if (p) addFoodValues(p, hunger, saturation); },

    /** Effects: 'regeneration' (heal every 50 >> (level-1) ticks), 'absorption' (4 HP per level), 'hunger'. */
    addEffect(type, level, ticks) {
      const p = P();
      if (!p) return;
      p.effects = p.effects || {};
      const e = { level, ticks };
      if (type === 'absorption') e.amount = 4 * level;
      p.effects[type] = e;
    },

    /** Start eating the held food (item-use hook). Returns true when the use was consumed. */
    startEating(ctx) {
      const stack = ctx.stack, d = stack && getItem(stack.item);
      if (!d || !d.food) return false;
      // planting wins: a crop food aimed at the top of farmland is placed, not eaten (SPEC §7.4)
      if (d.block && ctx.hit && ctx.hit.id === ID.farmland && (ctx.hit.ny === 1 || ctx.hit.face === 2)) return false;
      if (!sys.canEat(stack.item)) return false;
      if (eating && eating.item === stack.item) return true;
      eating = { item: stack.item, slot: ctx.slot ?? (game.inventory ? game.inventory.selected : 0), ticks: 0 };
      game.events.emit('player:eat', { item: stack.item });
      return true;
    },
    cancelEating() { eating = null; },

    tickEating() {
      if (!eating) return;
      const inv = game.inventory;
      const s = inv && inv.get(eating.slot);
      if (!s || s.item !== eating.item || (inv && inv.selected !== eating.slot)) { eating = null; return; }
      // classic scheme: keep holding use; kid scheme: one tap finishes on its own (SPEC §2.3)
      const kid = game.settings.controls !== 'classic';
      if (!kid && game.input && !game.input.isDown('use') && eating.ticks > 2) { eating = null; return; }
      if (++eating.ticks < SURVIVAL.EAT_TICKS) return;   // AUDIO plays the eat loop from 'player:eat'
      const item = eating.item;
      eating = null;
      if (!sys.canEat(item)) return;
      sys.applyFood(item);
      const d = getItem(item);
      if (!game.isCreative() && inv) {
        const ret = d.food && d.food.returns;
        if (ret && s.count === 1) inv.replaceSelected({ item: ret, count: 1 });
        else { inv.consumeSelected(1); if (ret && inv.add({ item: ret, count: 1 }) > 0) dropItem(game, { item: ret, count: 1 }, P().x, P().y + 1, P().z); }
      }
      game.events.emit('sound', { name: 'player.burp', x: P().x, y: P().y + 1.5, z: P().z });
    },

    /** Kill the player (cause). Emits 'player:death' {cause}. */
    kill(cause = 'generic') {
      const p = P();
      if (!p || p.dead) return;
      p.dead = true; p.health = 0;
      eating = null;
      if (p.riding) p.riding = null;
      if (!rules().keepInventory && game.inventory) {
        const inv = game.inventory;
        const all = [...inv.slots, ...(inv.armor || []), inv.offhand].filter(Boolean);
        for (const s of all) dropItem(game, s, p.x, p.y + 1, p.z, { vx: (game.rand() - 0.5) * 0.4, vy: 0.2 + game.rand() * 0.2, vz: (game.rand() - 0.5) * 0.4, pickupDelay: 40 });
        inv.clear();
        p.xp = 0; p.xpLevel = 0; p.xpProgress = 0;
      }
      game.events.emit('player:death', { cause });
      if (rules().immediateRespawn !== false) {
        respawnIn = 20;
        if (game.fx && game.fx.fade) game.fx.fade(0.85, 600);
      }
    },

    /** Respawn at bed/world spawn with full health/food. Emits 'player:respawn' {x,y,z}. */
    respawn() {
      const p = P();
      const sp = p.spawnPoint || (game.meta && game.meta.spawn) || { x: 0.5, y: 64, z: 0.5 };
      let y = sp.y;
      if (game.world && game.world.getSurfaceY) {
        const sy = game.world.getSurfaceY(sp.x, sp.z);
        if (sy > 0 && (sy > y + 0.01 || y < 0)) y = sy;
      }
      p.spawn(sp.x, y, sp.z, p.yaw || 0, 0);
      p.dead = false;
      p.health = p.maxHealth = SURVIVAL.MAX_HEALTH;
      p.food = SURVIVAL.MAX_FOOD; p.saturation = SURVIVAL.START_SATURATION; p.exhaustion = 0;
      p.air = SURVIVAL.MAX_AIR; p.fireTicks = 0; p.effects = {}; p.hurtTime = 0; p.fallDistance = 0;
      inv.invuln = 0; inv.lastDamage = 0;
      respawnIn = 0; havePos = false;
      game.events.emit('player:respawn', { x: sp.x, y, z: sp.z });
      if (game.fx && game.fx.fade) game.fx.fade(0, 600);
    },

    /** Landing: fall damage = ceil(fallDistance - 3) * fallMult of the landing block (water / ladder: none). */
    onLand(e) {
      const p = P();
      if (!p || p.dead || !e || game.isCreative() || !rules().fallDamage) return;
      const id = e.blockId ?? 0;
      if (p.inWater || p.onLadder || p.flying) return;
      const def = blockDef(id);
      if (def && (def.liquid || def.climbable)) return;
      const mult = def ? def.fallMult ?? 1 : 1;
      const dmg = fallDamage(e.fallDistance || 0, mult);
      if (dmg > 0) sys.damage(dmg, 'fall', null);
    },

    tick() {
      const p = P();
      if (!p || !game.meta) return;
      if (inv.invuln > 0) inv.invuln--;
      if (p.hurtTime > 0) p.hurtTime--;
      if (p.dead) {
        if (respawnIn > 0 && --respawnIn === 0) sys.respawn();
        return;
      }
      sys.tickEating();
      const creative = game.isCreative();
      const r = rules();
      // movement exhaustion: sprinting 0.1 / m, swimming 0.01 / m (SPEC §2.3)
      if (havePos && !creative) {
        const dist = Math.hypot(p.x - lastX, p.z - lastZ);
        if (dist > 0 && dist < 2) {
          if (p.inWater) sys.addExhaustion(SURVIVAL.EXHAUST.SWIM_PER_M * dist);
          else if (p.sprinting) sys.addExhaustion(SURVIVAL.EXHAUST.SPRINT_PER_M * dist);
        }
      }
      lastX = p.x; lastZ = p.z; havePos = true;
      // hunger / regeneration
      if (creative) { p.food = SURVIVAL.MAX_FOOD; if (p.saturation < SURVIVAL.START_SATURATION) p.saturation = SURVIVAL.START_SATURATION; }
      else if (!hungerOn()) {
        // peaceful (or hunger off): health and hunger refill by 1 every 20 ticks
        if (++timers.refill >= 20) {
          timers.refill = 0;
          if (p.health < p.maxHealth) sys.heal(1);
          if (p.food < SURVIVAL.MAX_FOOD) p.food = Math.min(SURVIVAL.MAX_FOOD, p.food + 1);
        }
      } else {
        const out = regenTick(p, timers, difficulty());
        drainExhaustion(p);
        if (out.heal) sys.heal(out.heal);
        if (out.starve) sys.damage(out.starve, 'starve');
      }
      sys.tickEffects();
      if (p.dead) return;
      // air + drowning
      if (creative) p.air = SURVIVAL.MAX_AIR;
      else {
        const dmg = airTick(p, !!p.eyeInWater);
        if (dmg && r.drowningDamage) sys.damage(dmg, 'drown');
      }
      // lava / fire
      if (p.inWater && p.fireTicks > 0) p.fireTicks = 0;
      if (p.inLava) {
        if (r.fireDamage && !creative) { p.fireTicks = SURVIVAL.FIRE_TICKS_LAVA; if (game.tickCount % 10 === 0) sys.damage(SURVIVAL.LAVA_DAMAGE, 'lava'); }
      } else if (p.fireTicks > 0) {
        p.fireTicks--;
        if (r.fireDamage && game.tickCount % 20 === 0) sys.damage(SURVIVAL.FIRE_DAMAGE, 'fire');
      }
      // contact: fire block, cactus; suffocation (every 10 ticks)
      if (game.tickCount % 10 === 0 && !creative) sys.contactChecks(r);
      // void (only when the kid rescue is off)
      if (p.y < SURVIVAL.VOID_Y && r.voidRescue === false && game.tickCount % 10 === 0) sys.damage(4, 'void');
    },

    contactChecks(r) {
      const p = P(), w = game.world;
      const hw = (p.width || 0.6) / 2;
      let fire = false, cactus = false;
      for (let x = Math.floor(p.x - hw - 0.01); x <= Math.floor(p.x + hw + 0.01); x++) {
        for (let z = Math.floor(p.z - hw - 0.01); z <= Math.floor(p.z + hw + 0.01); z++) {
          for (let y = Math.floor(p.y); y <= Math.floor(p.y + (p.height || 1.8) - 0.01); y++) {
            const id = w.getBlock(x, y, z);
            if (id === ID.fire) fire = true; else if (id === ID.cactus) cactus = true;
          }
        }
      }
      if (fire && r.fireDamage) { p.fireTicks = Math.max(p.fireTicks || 0, 160); sys.damage(SURVIVAL.FIRE_DAMAGE, 'fire'); }
      if (cactus) sys.damage(SURVIVAL.CACTUS_DAMAGE, 'cactus');
      const eyeId = w.getBlock(Math.floor(p.x), Math.floor(p.y + (p.eyeHeight || 1.62)), Math.floor(p.z));
      if (B_OPAQUE[eyeId] && !p.flying) sys.damage(SURVIVAL.SUFFOCATE_DAMAGE, 'suffocate');
    },

    tickEffects() {
      const p = P();
      const ef = p.effects;
      if (!ef) return;
      timers.effect++;
      for (const [name, e] of Object.entries(ef)) {
        if (name === 'regeneration') { const every = Math.max(1, 50 >> Math.max(0, (e.level || 1) - 1)); if (timers.effect % every === 0) sys.heal(1); }
        else if (name === 'hunger' && !game.isCreative()) sys.addExhaustion(0.005 * (e.level || 1));
        if (e.ticks > 0 && --e.ticks <= 0) delete ef[name];
        else if (name === 'absorption' && !(e.amount > 0)) delete ef[name];
      }
    },

    serialize() {
      const p = P();
      return { health: p.health, food: p.food, saturation: p.saturation, exhaustion: p.exhaustion, air: p.air, xp: p.xp, xpLevel: p.xpLevel, xpProgress: p.xpProgress, effects: p.effects, fireTicks: p.fireTicks || 0 };
    },
    deserialize(g, d) {
      eating = null; respawnIn = 0; havePos = false;
      inv.invuln = 0; inv.lastDamage = 0;
      const p = P();
      Object.assign(p, {
        health: d && d.health > 0 ? Math.min(SURVIVAL.MAX_HEALTH, d.health) : SURVIVAL.MAX_HEALTH, maxHealth: SURVIVAL.MAX_HEALTH,
        food: d ? d.food ?? SURVIVAL.MAX_FOOD : SURVIVAL.MAX_FOOD, saturation: d ? d.saturation ?? SURVIVAL.START_SATURATION : SURVIVAL.START_SATURATION,
        exhaustion: d ? d.exhaustion ?? 0 : 0, air: d ? d.air ?? SURVIVAL.MAX_AIR : SURVIVAL.MAX_AIR,
        xp: d ? d.xp ?? 0 : 0, xpLevel: d ? d.xpLevel ?? 0 : 0, xpProgress: d ? d.xpProgress ?? 0 : 0,
        effects: d && d.effects ? d.effects : {}, fireTicks: d ? d.fireTicks || 0 : 0, dead: false, hurtTime: 0,
      });
    },
  };
  return sys;
}
