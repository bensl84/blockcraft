// OWNER LANE: FEATURE-INV (inventory + crafting + furnace + chest UI). Public signatures are FROZEN (SPEC §8.2.2).
// Pure (no DOM) so it is unit-testable. Matching rules: header of src/data/recipes.js and SPEC §4.6.
//
//   matchRecipe(grid, w, h)            -> {recipe, result} | null   (first match in RECIPES order wins)
//   consumeCraft(grid, w, h, recipe)   -> NEW grid (one item per used cell, REMAINDERS left behind)
//   craftableRecipes(inventory, size)  -> [{recipe, gridSize, missing}]  (recipe book)
//   planRecipe(recipe, stacks, w, h)   -> {grid, take} | null  (additive: concrete grid for the recipe book)
//   smeltingResult(itemKey)            -> {result, xp, time} | null
//   fuelTicks(itemKey)                 -> burn ticks (0 = not fuel)

import { getItem } from '../data/items.js';
import { RECIPES, REMAINDERS, SMELTING, ingredientItems } from '../data/recipes.js';

/* ------------------------------------------------------------------ recipe preprocessing (cached) */
const PREP = new WeakMap();

/** Trimmed shaped pattern: {w, h, cells: Array<spec|null>} (row-major), plus the mirrored cells. */
function prep(recipe) {
  let p = PREP.get(recipe);
  if (p) return p;
  if (recipe.type === 'shaped') {
    const rows = recipe.pattern;
    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== ' ') { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      }
    });
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const cells = [], mirror = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = (rows[minY + y] || '')[minX + x];
        cells.push(ch && ch !== ' ' ? recipe.key[ch] : null);
        const mch = (rows[minY + y] || '')[minX + (w - 1 - x)];
        mirror.push(mch && mch !== ' ' ? recipe.key[mch] : null);
      }
    }
    let count = 0;
    for (const c of cells) if (c) count++;
    p = { w, h, cells, mirror, count };
  } else {
    p = { w: 0, h: 0, cells: null, mirror: null, count: recipe.ingredients.length };
  }
  PREP.set(recipe, p);
  return p;
}

/** Does an item key satisfy an ingredient spec ('item' or '#tag')? */
export function ingredientMatches(spec, itemKey) {
  if (!spec || !itemKey) return false;
  if (spec[0] === '#') return ingredientItems(spec).includes(itemKey);
  return spec === itemKey;
}

/** Does a recipe fit in a w x h grid at all? (2x2 = player inventory) */
export function recipeFits(recipe, w, h) {
  const p = prep(recipe);
  if (recipe.type === 'shaped') return p.w <= w && p.h <= h;
  return p.count <= w * h;
}

/** Grid size (2 or 3) a recipe needs. */
export function recipeGridSize(recipe) { return recipeFits(recipe, 2, 2) ? 2 : 3; }

/* ------------------------------------------------------------------ matching */
const itemOf = (s) => (s && s.count > 0 ? s.item : null);

/**
 * Find the recipe matching a crafting grid.
 * @param {Array<import('../core/types.js').ItemStack|null>} grid  row-major, length w*h
 * @param {number} w 2 or 3 @param {number} h 2 or 3
 * @returns {{recipe: object, result: import('../core/types.js').ItemStack} | null}
 */
export function matchRecipe(grid, w, h) {
  if (!grid) return null;
  // bounding box + item list of the non-empty cells
  let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
  const items = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const it = itemOf(grid[y * w + x]);
      if (!it) continue;
      items.push(it);
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (items.length === 0) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  for (const recipe of RECIPES) {
    const p = prep(recipe);
    if (recipe.type === 'shaped') {
      if (p.w !== bw || p.h !== bh || p.count !== items.length) continue;
      if (shapedAt(grid, w, minX, minY, p.w, p.h, p.cells) || shapedAt(grid, w, minX, minY, p.w, p.h, p.mirror)) {
        return { recipe, result: { ...recipe.result } };
      }
    } else {
      if (p.count !== items.length || p.count > w * h) continue;
      if (shapelessMatch(recipe.ingredients, items)) return { recipe, result: { ...recipe.result } };
    }
  }
  return null;
}

function shapedAt(grid, gw, ox, oy, pw, ph, cells) {
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const spec = cells[y * pw + x];
      const it = itemOf(grid[(oy + y) * gw + ox + x]);
      if (!spec) { if (it) return false; continue; }
      if (!ingredientMatches(spec, it)) return false;
    }
  }
  return true;
}

/** Exact multiset match of items against ingredient specs (backtracking; lists have at most 9 entries). */
function shapelessMatch(specs, items) {
  if (specs.length !== items.length) return false;
  const used = new Array(items.length).fill(false);
  // exact specs first: they constrain the most
  const order = specs.slice().sort((a, b) => (a[0] === '#') - (b[0] === '#'));
  const go = (k) => {
    if (k === order.length) return true;
    for (let i = 0; i < items.length; i++) {
      if (used[i] || !ingredientMatches(order[k], items[i])) continue;
      used[i] = true;
      if (go(k + 1)) return true;
      used[i] = false;
    }
    return false;
  };
  return go(0);
}

/**
 * Consume one craft from the grid (one item per used cell; REMAINDERS left behind). Returns a NEW grid array
 * with new stack objects (the input grid is not mutated).
 * @returns {Array<import('../core/types.js').ItemStack|null>}
 */
export function consumeCraft(grid, w, h, recipe) {
  const out = grid.slice(0, w * h).map((s) => (s && s.count > 0 ? { ...s } : null));
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (!s) continue;
    s.count -= 1;
    if (s.count <= 0) {
      const rem = REMAINDERS[s.item];
      out[i] = rem ? { item: rem, count: 1 } : null;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ recipe book */
/** Normalise an Inventory, an array of stacks, or {slots} to an array of stacks. */
function stacksOf(inv) {
  if (!inv) return [];
  if (Array.isArray(inv)) return inv;
  if (Array.isArray(inv.slots)) return inv.slots;
  return [];
}

/** item key -> total count */
function countItems(stacks) {
  const m = new Map();
  for (const s of stacks) if (s && s.count > 0 && !s.damage) m.set(s.item, (m.get(s.item) || 0) + s.count);
  return m;
}

/** Ingredient specs a recipe uses, one per used cell (shaped: row-major cells; shapeless: list). */
export function recipeSpecs(recipe) {
  const p = prep(recipe);
  return recipe.type === 'shaped' ? p.cells.filter(Boolean) : recipe.ingredients.slice();
}

/**
 * Assign concrete items for every spec from the available counts (exact specs first, then tags taking the
 * item the player has most of). Returns {assign: item key per spec index (in `specs` order), missing}.
 */
function assignSpecs(specs, counts) {
  const avail = new Map(counts);
  const assign = new Array(specs.length).fill(null);
  let missing = 0;
  const idx = specs.map((s, i) => i).sort((a, b) => (specs[a][0] === '#') - (specs[b][0] === '#'));
  for (const i of idx) {
    const spec = specs[i];
    let best = null, bestN = 0;
    for (const it of ingredientItems(spec)) {
      const n = avail.get(it) || 0;
      if (n > bestN) { best = it; bestN = n; }
    }
    if (best) { assign[i] = best; avail.set(best, bestN - 1); } else missing++;
  }
  return { assign, missing };
}

/**
 * Recipes the player could craft right now from `inventory` (+ which grid size they need), for the kid
 * recipe book. Includes every recipe that fits `gridSize` with `missing` = ingredient units the player lacks
 * (0 = craftable now). Recipe order is RECIPES order (the data lists the important ones first).
 * @param {object|Array} inventory Inventory model, {slots}, or an array of ItemStacks
 * @param {2|3} gridSize
 * @returns {Array<{recipe: object, gridSize: 2|3, missing: number}>}
 */
export function craftableRecipes(inventory, gridSize = 3) {
  const counts = countItems(stacksOf(inventory));
  const out = [];
  for (const recipe of RECIPES) {
    if (!getItem(recipe.result.item)) continue;
    const need = recipeGridSize(recipe);
    if (need > gridSize) continue;
    const { missing } = assignSpecs(recipeSpecs(recipe), counts);
    out.push({ recipe, gridSize: need, missing });
  }
  return out;
}

/**
 * Concrete grid for one craft of `recipe` from the stacks the player has (recipe book "tap to craft").
 * Shaped patterns are placed at the top-left of the w x h grid. Returns null if it does not fit or an
 * ingredient is missing.
 * @returns {{grid: Array<{item:string,count:1}|null>, take: Map<string, number>} | null}
 */
export function planRecipe(recipe, inventory, w = 3, h = 3) {
  if (!recipeFits(recipe, w, h)) return null;
  const specs = recipeSpecs(recipe);
  const { assign, missing } = assignSpecs(specs, countItems(stacksOf(inventory)));
  if (missing) return null;
  const grid = new Array(w * h).fill(null);
  const take = new Map();
  const p = prep(recipe);
  let k = 0;
  if (recipe.type === 'shaped') {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        if (!p.cells[y * p.w + x]) continue;
        const it = assign[k++];
        grid[y * w + x] = { item: it, count: 1 };
        take.set(it, (take.get(it) || 0) + 1);
      }
    }
  } else {
    for (let i = 0; i < specs.length; i++) {
      const it = assign[i];
      grid[i] = { item: it, count: 1 };
      take.set(it, (take.get(it) || 0) + 1);
    }
  }
  return { grid, take };
}

/* ------------------------------------------------------------------ smelting */
/** Furnace recipe for an input item: {result, xp, time} or null. */
export function smeltingResult(itemKey) {
  if (!itemKey) return null;
  for (const r of SMELTING) {
    if (ingredientMatches(r.input, itemKey)) return { result: r.result, xp: r.xp, time: r.time };
  }
  return null;
}

/** Burn time in ticks of a fuel item (0 = not fuel). */
export function fuelTicks(itemKey) { const d = getItem(itemKey); return (d && d.fuel) || 0; }
