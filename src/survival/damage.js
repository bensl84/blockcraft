// OWNER LANE: FEATURE-MOBS. Pure survival maths (SPEC §2.3): fall damage, invulnerability frames, armour,
// exhaustion -> hunger, natural regeneration and starvation, explosion damage. No game object, no DOM:
// survival.js and mobs use these, test/mobs.test.mjs pins the numbers.

import { SURVIVAL } from '../core/constants.js';

/**
 * Fall damage when landing: ceil(fallDistance - 3) * fallMult (hay 0.2, bed 0.5). Never negative.
 * Landing in water / on a ladder is handled by the caller (fallMult 0).
 */
export function fallDamage(fallDistance, fallMult = 1) {
  const raw = Math.ceil(fallDistance - SURVIVAL.FALL_SAFE);
  if (!(raw > 0) || !(fallMult > 0)) return 0;
  return Math.max(0, Math.ceil(raw * fallMult - 1e-9));
}

/**
 * Invulnerability frames (SPEC §2.3): after a hit there are INVULN_TICKS (10) ticks during which only a
 * bigger hit counts, and only by the difference.
 * @param {{invuln: number, lastDamage: number}} s mutable state
 * @returns {number} damage to apply now (0 = ignored)
 */
export function applyInvuln(s, amount) {
  if (s.invuln > 0) {
    if (amount <= s.lastDamage) return 0;
    const extra = amount - s.lastDamage;
    s.lastDamage = amount;
    return extra;
  }
  s.invuln = SURVIVAL.INVULN_TICKS;
  s.lastDamage = amount;
  return amount;
}

/** Java armour formula: damage * (1 - min(20, max(points/5, points - damage/(2 + toughness/4))) / 25). */
export function applyArmor(amount, points, toughness = 0) {
  if (!(points > 0)) return amount;
  const eff = Math.min(20, Math.max(points / 5, points - amount / (2 + toughness / 4)));
  return amount * (1 - eff / 25);
}
/** Damage causes that armour reduces. */
export const ARMORED_CAUSES = new Set(['mob', 'arrow', 'explosion', 'generic', 'cactus', 'player']);

/**
 * Exhaustion -> saturation -> hunger (SPEC §2.3). Mutates {food, saturation, exhaustion}.
 * When exhaustion reaches 4: remove 1 saturation, or 1 hunger when saturation is 0.
 */
export function drainExhaustion(p) {
  while (p.exhaustion >= SURVIVAL.EXHAUSTION_MAX) {
    p.exhaustion -= SURVIVAL.EXHAUSTION_MAX;
    if (p.saturation > 0) p.saturation = Math.max(0, p.saturation - 1);
    else p.food = Math.max(0, p.food - 1);
  }
}

/**
 * One tick of natural regeneration / starvation (SPEC §2.3). Mutates p {health, maxHealth, food, saturation,
 * exhaustion} and the timer holder t {regen, starve}. Returns {heal, starve} amounts to apply this tick.
 * @param {'peaceful'|'easy'|'normal'} difficulty
 */
export function regenTick(p, t, difficulty) {
  const out = { heal: 0, starve: 0 };
  const hurt = p.health < p.maxHealth;
  if (p.food >= SURVIVAL.MAX_FOOD && p.saturation > 0 && hurt) {
    if (++t.regen >= SURVIVAL.REGEN_FAST_TICKS) { t.regen = 0; out.heal = 1; p.exhaustion += SURVIVAL.EXHAUST.HEAL; }
  } else if (p.food >= 18 && hurt) {
    if (++t.regen >= SURVIVAL.REGEN_TICKS) { t.regen = 0; out.heal = 1; p.exhaustion += SURVIVAL.EXHAUST.HEAL; }
  } else t.regen = 0;
  if (p.food <= 0) {
    if (++t.starve >= SURVIVAL.STARVE_TICKS) {
      t.starve = 0;
      const floor = difficulty === 'normal' ? 1 : difficulty === 'easy' ? 10 : 20;
      if (p.health > floor) out.starve = 1;
    }
  } else t.starve = 0;
  return out;
}

/** Saturation never exceeds hunger; both clamp to 0..20. */
export function addFoodValues(p, hunger, saturation) {
  p.food = Math.max(0, Math.min(SURVIVAL.MAX_FOOD, p.food + hunger));
  p.saturation = Math.max(0, Math.min(p.food, p.saturation + saturation));
}

/**
 * Explosion damage to an entity at distance d from a blast of power P with exposure (0..1) - SPEC §2.5:
 * impact i = (1 - d/(2P)) * exposure; damage = floor((i^2 + i) / 2 * 7 * 2P + 1). Returns {damage, impact}.
 */
export function explosionDamage(d, power, exposure = 1) {
  const r = power * 2;
  if (d >= r) return { damage: 0, impact: 0 };
  const i = (1 - d / r) * exposure;
  return { damage: Math.floor(((i * i + i) / 2) * 7 * r + 1), impact: i };
}

/** Drowning (SPEC §2.3): per tick with the eye in water air -= 1; at -20: damage 2 and air back to 0. */
export function airTick(p, eyeInWater) {
  if (eyeInWater) {
    p.air -= 1;
    if (p.air <= -20) { p.air = 0; return SURVIVAL.DROWN_DAMAGE; }
    return 0;
  }
  p.air = Math.min(SURVIVAL.MAX_AIR, p.air + SURVIVAL.AIR_REFILL);
  return 0;
}
