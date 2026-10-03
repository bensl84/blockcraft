// OWNER LANE: FEATURE-INV (inventory + crafting + furnace + chest UI). Public signatures are FROZEN (SPEC §8.2.3).
// Block-entity data for containers (stored with world.setBlockEntity, saved with the column).
//
// Furnace logic follows Java's AbstractFurnaceBlockEntity.tick: burn down, light new fuel only when an item can
// be smelted, cook 200 ticks per item, reset progress when it cannot smelt, lose 2 progress per tick when the
// fire is out, swap furnace <-> furnace_lit (keeping the facing state and the block entity) when burning
// starts or stops. No DOM: unit-tested in test/inv.test.mjs with a fake world.

import { ID } from '../core/registry.js';
import { maxStack } from '../data/items.js';
import { REMAINDERS, SMELT_TIME } from '../data/recipes.js';
import { fuelTicks, smeltingResult } from './crafting.js';

/** Chest slot count. */
export const CHEST_SIZE = 27;

/** New chest block entity. */
export function createChest() { return { type: 'chest', items: new Array(CHEST_SIZE).fill(null) }; }

/** New furnace block entity. */
export function createFurnace() {
  return { type: 'furnace', input: null, fuel: null, output: null, burnTicks: 0, burnTotal: 0, cookTicks: 0, xp: 0 };
}

/** Block names that own a container block entity -> its kind. */
export const CONTAINER_BLOCKS = Object.freeze({ chest: 'chest', furnace: 'furnace', furnace_lit: 'furnace' });

/**
 * Make a loaded/saved block entity safe to use (missing fields, wrong array sizes, invalid stacks).
 * Returns the same object (mutated) or a new one when `be` is not usable.
 */
export function normalizeContainer(be, kind) {
  if (kind === 'chest') {
    if (!be || be.type !== 'chest' || !Array.isArray(be.items)) return createChest();
    if (be.items.length !== CHEST_SIZE) be.items = Array.from({ length: CHEST_SIZE }, (_, i) => be.items[i] || null);
    for (let i = 0; i < CHEST_SIZE; i++) if (!validStack(be.items[i])) be.items[i] = null;
    return be;
  }
  if (kind === 'furnace') {
    if (!be || be.type !== 'furnace') return createFurnace();
    for (const k of ['input', 'fuel', 'output']) if (!validStack(be[k])) be[k] = null;
    for (const k of ['burnTicks', 'burnTotal', 'cookTicks', 'xp']) if (!Number.isFinite(be[k])) be[k] = 0;
    return be;
  }
  return be;
}
const validStack = (s) => !!(s && typeof s.item === 'string' && s.count > 0);

/** Every stack held by a container block entity (for dropping its contents when it breaks). */
export function containerStacks(be) {
  if (!be) return [];
  if (be.type === 'chest' && Array.isArray(be.items)) return be.items.filter(validStack);
  if (be.type === 'furnace') return [be.input, be.fuel, be.output].filter(validStack);
  return [];
}

/** Can the furnace smelt its input into its output slot right now? -> smelting recipe or null */
export function furnaceRecipe(be) {
  if (!be.input || be.input.count <= 0) return null;
  const r = smeltingResult(be.input.item);
  if (!r) return null;
  const out = be.output;
  if (!out) return r;
  if (out.item !== r.result || out.damage || out.data) return null;
  return out.count < maxStack(r.result) ? r : null;
}

/**
 * Advance one furnace by one tick (200 ticks per item; fuel burn per fuelTicks()). Swaps the block between
 * 'furnace' and 'furnace_lit' (keeping facing state, keepBlockEntity: true) when burning starts/stops.
 * @param {object} game @param {object} be furnace data @param {number} x @param {number} y @param {number} z
 * @returns {boolean} true when the furnace data changed (callers mark the column dirty / refresh the UI)
 */
export function tickFurnace(game, be, x, y, z) {
  if (!be || be.type !== 'furnace') return false;
  const wasBurning = be.burnTicks > 0;
  let changed = false;
  if (be.burnTicks > 0) { be.burnTicks--; changed = true; }
  const recipe = furnaceRecipe(be);
  if (be.burnTicks > 0 || (be.fuel && be.input)) {
    if (be.burnTicks <= 0 && recipe && be.fuel) {
      const burn = fuelTicks(be.fuel.item);
      if (burn > 0) {
        be.burnTicks = be.burnTotal = burn;
        const rem = REMAINDERS[be.fuel.item];
        be.fuel = be.fuel.count > 1 ? { ...be.fuel, count: be.fuel.count - 1 } : (rem ? { item: rem, count: 1 } : null);
        changed = true;
      }
    }
    if (be.burnTicks > 0 && recipe) {
      be.cookTicks++;
      changed = true;
      if (be.cookTicks >= (recipe.time || SMELT_TIME)) {
        be.cookTicks = 0;
        be.input = be.input.count > 1 ? { ...be.input, count: be.input.count - 1 } : null;
        be.output = be.output ? { ...be.output, count: be.output.count + 1 } : { item: recipe.result, count: 1 };
        be.xp = (be.xp || 0) + (recipe.xp || 0);
        if (game && game.events) game.events.emit('smelt', { item: recipe.result, count: 1, x, y, z });
      }
    } else if (be.cookTicks !== 0) { be.cookTicks = 0; changed = true; }
  } else if (be.cookTicks > 0) {
    be.cookTicks = Math.max(0, be.cookTicks - 2);
    changed = true;
  }
  const burning = be.burnTicks > 0;
  if (burning !== wasBurning) setFurnaceLit(game, x, y, z, burning);
  return changed;
}

/** Swap furnace <-> furnace_lit at a cell, keeping the facing state bits and the block entity. */
export function setFurnaceLit(game, x, y, z, lit) {
  const w = game && game.world;
  if (!w || !w.getRaw) return false;
  const v = w.getRaw(x, y, z), id = v & 0xff, state = v >> 8;
  const want = lit ? ID.furnace_lit : ID.furnace;
  if (id === want || (id !== ID.furnace && id !== ID.furnace_lit)) return false;
  return w.setBlock(x, y, z, want, state, { cause: 'furnace', keepBlockEntity: true });
}

/** 0..1 progress values for the furnace screen (flame height, arrow length). */
export function furnaceProgress(be) {
  const burn = be && be.burnTicks > 0 && be.burnTotal > 0 ? be.burnTicks / be.burnTotal : 0;
  const cook = be ? Math.min(1, (be.cookTicks || 0) / SMELT_TIME) : 0;
  return { burn, cook };
}
