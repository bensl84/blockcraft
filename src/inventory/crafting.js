// OWNER LANE: FEATURE-INV (inventory + crafting + furnace + chest UI). STUB written by LEAD - keep signatures.
// Pure (no DOM) so it is unit-testable. Matching rules: header of src/data/recipes.js and SPEC §4.6.

import { registerStub } from '../core/stubs.js';
import { getItem } from '../data/items.js';

registerStub('crafting');

/**
 * Find the recipe matching a crafting grid.
 * @param {Array<import('../core/types.js').ItemStack|null>} grid  row-major, length w*h
 * @param {number} w 2 or 3 @param {number} h 2 or 3
 * @returns {{recipe: object, result: import('../core/types.js').ItemStack} | null}
 */
export function matchRecipe(grid, w, h) { return null; }

/**
 * Consume one craft from the grid (one item per used cell; REMAINDERS left behind). Returns a NEW grid array.
 * @returns {Array<import('../core/types.js').ItemStack|null>}
 */
export function consumeCraft(grid, w, h, recipe) { return grid.slice(); }

/**
 * Recipes the player could craft right now from `inventory` (+ which grid size they need), for the kid
 * recipe book (P1). @returns {Array<{recipe: object, gridSize: 2|3, missing: number}>}
 */
export function craftableRecipes(inventory, gridSize = 3) { return []; }

/** Furnace recipe for an input item: {result, xp, time} or null. */
export function smeltingResult(itemKey) { return null; }

/** Burn time in ticks of a fuel item (0 = not fuel). */
export function fuelTicks(itemKey) { const d = getItem(itemKey); return (d && d.fuel) || 0; }
