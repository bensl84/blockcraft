// OWNER: FEATURE-INV. Unit tests for crafting matching (shaped / mirrored / shapeless / tags / 2x2 limit),
// consumption with remainders, the recipe book helpers, smelting + furnace ticking, and slot click rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeCraft, craftableRecipes, fuelTicks, matchRecipe, planRecipe, recipeGridSize, smeltingResult,
} from '../src/inventory/crafting.js';
import {
  containerStacks, createChest, createFurnace, furnaceProgress, normalizeContainer, tickFurnace,
} from '../src/inventory/containers.js';
import {
  arraySlot, clickSlot, dragDistribute, fieldSlot, gatherToCursor, moveInto, quickMove, stackable,
} from '../src/inventory/slots.js';
import { RECIPES, SMELTING, ingredientItems } from '../src/data/recipes.js';
import { ITEMS } from '../src/data/items.js';
import { ID } from '../src/core/registry.js';
import { EventBus } from '../src/core/events.js';
import { Inventory } from '../src/inventory/inventory.js';

const S = (item, count = 1) => ({ item, count });
/** Grid from rows of item keys ('.' = empty). */
function grid(rows) {
  const out = [];
  for (const r of rows) for (const k of r) out.push(k === '.' ? null : S(k));
  return out;
}

test('crafting: shapeless log -> 4 planks anywhere in 2x2 and 3x3', () => {
  for (const [w, i] of [[2, 0], [2, 3], [3, 4], [3, 8]]) {
    const g = new Array(w * w).fill(null);
    g[i] = S('oak_log');
    const m = matchRecipe(g, w, w);
    assert.ok(m, `log at ${i} in ${w}x${w}`);
    assert.deepEqual(m.result, { item: 'oak_planks', count: 4 });
  }
  assert.equal(matchRecipe(grid([['oak_log', 'oak_log'], ['.', '.']]), 2, 2), null, 'two logs is not a recipe');
  assert.equal(matchRecipe(new Array(4).fill(null), 2, 2), null, 'empty grid');
});

test('crafting: shaped with tags, any position, outside cells must be empty', () => {
  // stick: 2 planks vertical, any plank type, mixed types too
  let m = matchRecipe(grid([['.', 'birch_planks'], ['.', 'oak_planks']]), 2, 2);
  assert.equal(m && m.result.item, 'stick');
  assert.equal(m.result.count, 4);
  m = matchRecipe(grid([['.', '.', '.'], ['.', '.', 'spruce_planks'], ['.', '.', 'spruce_planks']]), 3, 3);
  assert.equal(m && m.result.item, 'stick', 'stick in the bottom-right corner of a 3x3');
  assert.equal(matchRecipe(grid([['oak_planks', '.'], ['.', 'oak_planks']]), 2, 2), null, 'diagonal planks are not a stick');
  // crafting table 2x2 of planks; an extra item outside the pattern breaks it
  assert.equal(matchRecipe(grid([['oak_planks', 'oak_planks'], ['oak_planks', 'oak_planks']]), 2, 2).result.item, 'crafting_table');
  assert.equal(matchRecipe(grid([['oak_planks', 'oak_planks', 'dirt'], ['oak_planks', 'oak_planks', '.'], ['.', '.', '.']]), 3, 3), null);
  // torch with coal or charcoal
  assert.equal(matchRecipe(grid([['charcoal', '.'], ['stick', '.']]), 2, 2).result.item, 'torch');
  // chest vs furnace: same ring pattern, different key
  const ring = (k) => grid([[k, k, k], [k, '.', k], [k, k, k]]);
  assert.equal(matchRecipe(ring('oak_planks'), 3, 3).result.item, 'chest');
  assert.equal(matchRecipe(ring('cobblestone'), 3, 3).result.item, 'furnace');
  assert.equal(matchRecipe(ring('dirt'), 3, 3), null);
});

test('crafting: mirrored shaped recipes match (axe, hoe, stairs)', () => {
  const axe = grid([['cobblestone', 'cobblestone', '.'], ['cobblestone', 'stick', '.'], ['.', 'stick', '.']]);
  const axeM = grid([['.', 'cobblestone', 'cobblestone'], ['.', 'stick', 'cobblestone'], ['.', 'stick', '.']]);
  assert.equal(matchRecipe(axe, 3, 3).result.item, 'stone_axe');
  assert.equal(matchRecipe(axeM, 3, 3).result.item, 'stone_axe', 'mirrored axe');
  const stairs = grid([['.', '.', 'oak_planks'], ['.', 'oak_planks', 'oak_planks'], ['oak_planks', 'oak_planks', 'oak_planks']]);
  assert.equal(matchRecipe(stairs, 3, 3).result.item, 'oak_stairs', 'mirrored stairs');
  const hoeM = grid([['.', 'iron_ingot', 'iron_ingot'], ['.', 'stick', '.'], ['.', 'stick', '.']]);
  assert.equal(matchRecipe(hoeM, 3, 3).result.item, 'iron_hoe');
  // shears are their own mirror image counterpart
  assert.equal(matchRecipe(grid([['iron_ingot', '.'], ['.', 'iron_ingot']]), 2, 2).result.item, 'shears');
  assert.equal(matchRecipe(grid([['.', 'iron_ingot'], ['iron_ingot', '.']]), 2, 2).result.item, 'shears');
});

test('crafting: 2x2 grid only matches recipes that fit 2x2', () => {
  // a 3-wide pattern cannot be made in 2x2 even if the items are there
  assert.equal(recipeGridSize(RECIPES.find((r) => r.result.item === 'chest')), 3);
  assert.equal(recipeGridSize(RECIPES.find((r) => r.result.item === 'crafting_table')), 2);
  assert.equal(recipeGridSize(RECIPES.find((r) => r.result.item === 'oak_planks')), 2);
  // bread = 3 wheat in a row: impossible in 2x2
  assert.equal(matchRecipe(grid([['wheat', 'wheat'], ['wheat', '.']]), 2, 2), null);
  assert.equal(matchRecipe(grid([['wheat', 'wheat', 'wheat'], ['.', '.', '.'], ['.', '.', '.']]), 3, 3).result.item, 'bread');
  assert.equal(matchRecipe(grid([['.', '.', '.'], ['.', '.', '.'], ['wheat', 'wheat', 'wheat']]), 3, 3).result.item, 'bread');
});

test('crafting: shapeless multiset with tags, exact count, any order', () => {
  // red wool from red dye + any wool
  assert.equal(matchRecipe(grid([['blue_wool', '.'], ['.', 'red_dye']]), 2, 2).result.item, 'red_wool');
  assert.equal(matchRecipe(grid([['red_dye', 'blue_wool'], ['blue_wool', '.']]), 2, 2), null, 'extra wool -> no match');
  // book = 3 paper + leather in any cells
  assert.equal(matchRecipe(grid([['paper', '.', 'leather'], ['.', 'paper', '.'], ['paper', '.', '.']]), 3, 3).result.item, 'book');
  // mushroom stew
  assert.equal(matchRecipe(grid([['bowl', 'red_mushroom'], ['brown_mushroom', '.']]), 2, 2).result.item, 'mushroom_stew');
  // first match wins: orange dye from tulip, and from red + yellow (2)
  const m = matchRecipe(grid([['yellow_dye', 'red_dye'], ['.', '.']]), 2, 2);
  assert.deepEqual(m.result, { item: 'orange_dye', count: 2 });
  // damaged tools never count as ingredients? they still match by key (Java ignores damage for most recipes)
  assert.ok(matchRecipe([{ item: 'iron_ingot', count: 1 }, { item: 'flint', count: 3 }, null, null], 2, 2));
});

test('crafting: consumeCraft takes one per cell and leaves remainders (buckets)', () => {
  const g = grid([['milk_bucket', 'milk_bucket', 'milk_bucket'], ['sugar', 'egg', 'sugar'], ['wheat', 'wheat', 'wheat']]);
  g[3].count = 5; // 5 sugar in one cell
  const m = matchRecipe(g, 3, 3);
  assert.equal(m.result.item, 'cake');
  const after = consumeCraft(g, 3, 3, m.recipe);
  assert.deepEqual(after.slice(0, 3), [S('bucket'), S('bucket'), S('bucket')], 'milk buckets leave buckets');
  assert.deepEqual(after[3], S('sugar', 4));
  assert.equal(after[4], null);
  assert.equal(g[3].count, 5, 'input grid is not mutated');
  assert.notEqual(after[3], g[3], 'new stack objects');
});

test('crafting: every recipe can be planned from enough items and matches back (data sanity)', () => {
  const conflicts = [];
  for (const r of RECIPES) {
    // give 64 of the first item of each spec
    const specs = r.type === 'shaped' ? Object.values(r.key) : r.ingredients;
    const stacks = [...new Set(specs.map((s) => ingredientItems(s)[0]))].map((k) => S(k, 64));
    const size = recipeGridSize(r);
    const plan = planRecipe(r, stacks, size, size);
    assert.ok(plan, `plan for ${r.id}`);
    const m = matchRecipe(plan.grid, size, size);
    assert.ok(m, `planned grid for ${r.id} matches a recipe`);
    if (m.result.item !== r.result.item) conflicts.push(`${r.id} -> ${m.result.item}`);
    for (const it of [r.result.item]) assert.ok(ITEMS.has(it), `result item ${it} exists`);
  }
  // Data-level shadowing (first match wins): report, do not fail on, known ones.
  assert.deepEqual(conflicts.filter((c) => !c.startsWith('blue_dye') && !c.startsWith('white_dye')), [], `shadowed recipes: ${conflicts.join(', ')}`);
});

test('crafting: craftableRecipes / planRecipe for the recipe book', () => {
  const inv = new Inventory();
  inv.add(S('oak_log', 2));
  let list = craftableRecipes(inv, 2);
  const planks = list.find((e) => e.recipe.result.item === 'oak_planks');
  assert.ok(planks && planks.missing === 0 && planks.gridSize === 2);
  assert.ok(!list.some((e) => e.gridSize === 3), '2x2 book lists only 2x2 recipes');
  assert.ok(list.find((e) => e.recipe.result.item === 'stick').missing === 2, 'stick needs 2 planks');
  inv.add(S('birch_planks', 1)); inv.add(S('oak_planks', 1));
  list = craftableRecipes(inv.slots, 3);
  assert.equal(list.find((e) => e.recipe.result.item === 'stick').missing, 0, 'mixed planks count for #planks');
  assert.ok(list.some((e) => e.recipe.result.item === 'chest'), '3x3 book includes chest');
  // plan: shaped at the top-left
  const plan = planRecipe(RECIPES.find((r) => r.result.item === 'stick'), inv, 2, 2);
  assert.ok(plan.grid[0] && plan.grid[2] && !plan.grid[1] && !plan.grid[3]);
  assert.equal(matchRecipe(plan.grid, 2, 2).result.item, 'stick');
  assert.equal(planRecipe(RECIPES.find((r) => r.result.item === 'chest'), inv, 2, 2), null, 'chest does not fit 2x2');
  assert.equal(planRecipe(RECIPES.find((r) => r.result.item === 'furnace'), inv, 3, 3), null, 'missing cobblestone');
});

test('smelting: every SMELTING input resolves; fuel values', () => {
  for (const r of SMELTING) for (const it of ingredientItems(r.input)) {
    const s = smeltingResult(it);
    assert.ok(s && s.result === r.result && s.time === 200, `${it} smelts`);
  }
  assert.equal(smeltingResult('birch_log').result, 'charcoal');
  assert.equal(smeltingResult('dirt'), null);
  assert.equal(fuelTicks('coal'), 1600);
  assert.equal(fuelTicks('oak_planks'), 300);
  assert.equal(fuelTicks('stick'), 100);
  assert.equal(fuelTicks('coal_block'), 16000);
  assert.equal(fuelTicks('lava_bucket'), 20000);
  assert.equal(fuelTicks('dirt'), 0);
});

/** Fake world for furnace ticking. */
function fakeGame() {
  const blocks = new Map();
  const events = new EventBus();
  const key = (x, y, z) => `${x},${y},${z}`;
  const world = {
    changes: 0,
    getRaw: (x, y, z) => blocks.get(key(x, y, z)) || 0,
    setBlock(x, y, z, id, state = 0, opts = {}) { blocks.set(key(x, y, z), id | (state << 8)); this.changes++; this.lastOpts = opts; return true; },
  };
  return { world, events, blocks };
}

test('furnace: sand + coal -> glass after 200 ticks; lit swap keeps facing; fuel use', () => {
  const g = fakeGame();
  g.world.setBlock(0, 5, 0, ID.furnace, 2);
  const be = createFurnace();
  be.input = S('sand', 2); be.fuel = S('coal', 1);
  tickFurnace(g, be, 0, 5, 0);
  assert.equal(g.world.getRaw(0, 5, 0), ID.furnace_lit | (2 << 8), 'lit, facing kept');
  assert.equal(g.world.lastOpts.keepBlockEntity, true);
  assert.equal(be.fuel, null, 'coal consumed');
  assert.equal(be.burnTicks, 1600);
  for (let i = 1; i < 199; i++) tickFurnace(g, be, 0, 5, 0);
  assert.equal(be.output, null, 'not yet at 199 ticks');
  tickFurnace(g, be, 0, 5, 0);
  assert.deepEqual(be.output, S('glass', 1), 'glass at tick 200');
  assert.deepEqual(be.input, S('sand', 1));
  assert.equal(g.events.counts.get('smelt'), 1);
  for (let i = 0; i < 200; i++) tickFurnace(g, be, 0, 5, 0);
  assert.deepEqual(be.output, S('glass', 2));
  assert.equal(be.input, null);
  // keeps burning without input, cook progress stays 0; then goes out and swaps back
  for (let i = 0; i < 1600; i++) tickFurnace(g, be, 0, 5, 0);
  assert.equal(be.burnTicks, 0);
  assert.equal(g.world.getRaw(0, 5, 0), ID.furnace | (2 << 8), 'unlit again');
  assert.ok(Math.abs(be.xp - 0.2) < 1e-9, 'xp accumulates');
});

test('furnace: no fuel is wasted without a smeltable input; full output stops; lava leaves a bucket', () => {
  const g = fakeGame();
  g.world.setBlock(1, 1, 1, ID.furnace, 0);
  const be = createFurnace();
  be.fuel = S('coal', 3); be.input = S('dirt', 4);
  for (let i = 0; i < 50; i++) tickFurnace(g, be, 1, 1, 1);
  assert.equal(be.fuel.count, 3, 'dirt does not smelt: coal kept');
  assert.equal(be.burnTicks, 0);
  be.input = S('cobblestone', 5); be.output = S('stone', 64);
  for (let i = 0; i < 50; i++) tickFurnace(g, be, 1, 1, 1);
  assert.equal(be.fuel.count, 3, 'full output: coal kept');
  be.output = S('stone', 63);
  be.fuel = S('lava_bucket', 1);
  tickFurnace(g, be, 1, 1, 1);
  assert.deepEqual(be.fuel, S('bucket', 1), 'lava bucket leaves its bucket');
  for (let i = 0; i < 199; i++) tickFurnace(g, be, 1, 1, 1);
  assert.deepEqual(be.output, S('stone', 64));
  const cook = be.cookTicks;
  tickFurnace(g, be, 1, 1, 1);
  assert.equal(be.cookTicks, 0, 'full output resets progress');
  assert.equal(cook, 0);
  // fire out with progress: progress drops by 2 per tick
  const be2 = createFurnace();
  be2.cookTicks = 10;
  tickFurnace(g, be2, 1, 1, 1);
  assert.equal(be2.cookTicks, 8);
  assert.deepEqual(furnaceProgress({ burnTicks: 800, burnTotal: 1600, cookTicks: 100 }), { burn: 0.5, cook: 0.5 });
});

test('containers: normalize + contents for dropping', () => {
  const c = createChest();
  assert.equal(c.items.length, 27);
  c.items[3] = S('diamond', 5);
  c.items[4] = { item: 'dirt', count: 0 };
  assert.deepEqual(containerStacks(c), [S('diamond', 5)]);
  const n = normalizeContainer({ type: 'chest', items: [S('stone', 2)] }, 'chest');
  assert.equal(n.items.length, 27);
  assert.deepEqual(n.items[0], S('stone', 2));
  assert.equal(normalizeContainer(null, 'furnace').type, 'furnace');
  const f = createFurnace(); f.input = S('sand', 1); f.output = S('glass', 3);
  assert.deepEqual(containerStacks(f), [S('sand', 1), S('glass', 3)]);
});

test('slots: left click pick up / place / merge / swap', () => {
  const arr = [S('dirt', 10), null, S('dirt', 60), S('stone', 3)];
  const s = (i, o) => arraySlot(arr, i, o);
  let r = clickSlot(s(0), null, 'left');
  assert.deepEqual(r.cursor, S('dirt', 10)); assert.equal(arr[0], null);
  r = clickSlot(s(2), r.cursor, 'left');
  assert.deepEqual(arr[2], S('dirt', 64)); assert.deepEqual(r.cursor, S('dirt', 6), 'merge up to 64');
  r = clickSlot(s(3), r.cursor, 'left');
  assert.deepEqual(arr[3], S('dirt', 6)); assert.deepEqual(r.cursor, S('stone', 3), 'swap different items');
  r = clickSlot(s(1), r.cursor, 'left');
  assert.deepEqual(arr[1], S('stone', 3)); assert.equal(r.cursor, null);
});

test('slots: right click takes half (rounded up) and places one', () => {
  const arr = [S('sand', 7), null];
  let r = clickSlot(arraySlot(arr, 0), null, 'right');
  assert.deepEqual(r.cursor, S('sand', 4)); assert.deepEqual(arr[0], S('sand', 3));
  r = clickSlot(arraySlot(arr, 1), r.cursor, 'right');
  assert.deepEqual(arr[1], S('sand', 1)); assert.deepEqual(r.cursor, S('sand', 3));
  r = clickSlot(arraySlot(arr, 0), r.cursor, 'right');
  assert.deepEqual(arr[0], S('sand', 4)); assert.deepEqual(r.cursor, S('sand', 2));
  const one = [S('sand', 1)];
  r = clickSlot(arraySlot(one, 0), null, 'right');
  assert.deepEqual(r.cursor, S('sand', 1)); assert.equal(one[0], null);
});

test('slots: unstackable tools, slot filters, output slots, limits', () => {
  const arr = [{ item: 'iron_pickaxe', count: 1, damage: 3 }, { item: 'iron_pickaxe', count: 1 }];
  assert.equal(stackable(arr[0], arr[1]), false);
  let r = clickSlot(arraySlot(arr, 0), null);
  r = clickSlot(arraySlot(arr, 1), r.cursor);
  assert.equal(arr[1].damage, 3, 'tools swap, never merge');
  // fuel-only slot rejects sand
  const f = { fuel: null };
  const fuel = fieldSlot(f, 'fuel', { accept: (st) => fuelTicks(st.item) > 0 });
  r = clickSlot(fuel, S('sand', 5));
  assert.equal(f.fuel, null); assert.deepEqual(r.cursor, S('sand', 5));
  r = clickSlot(fuel, S('coal', 5));
  assert.deepEqual(f.fuel, S('coal', 5)); assert.equal(r.cursor, null);
  // output: take only, merge onto the cursor when it fits
  const o = { output: S('glass', 3) };
  const out = fieldSlot(o, 'output', { output: true });
  r = clickSlot(out, S('sand', 1));
  assert.deepEqual(o.output, S('glass', 3), 'cannot place into output');
  r = clickSlot(out, S('glass', 60));
  assert.deepEqual(r.cursor, S('glass', 63)); assert.equal(o.output, null);
  // limit 1 (armour slots)
  const a = [null];
  r = clickSlot(arraySlot(a, 0, { limit: 1 }), S('dirt', 5));
  assert.deepEqual(a[0], S('dirt', 1)); assert.deepEqual(r.cursor, S('dirt', 4));
});

test('slots: drag distribute, quick move, gather', () => {
  const arr = [null, null, S('dirt', 1), S('stone', 1)];
  const slots = arr.map((_, i) => arraySlot(arr, i));
  let r = dragDistribute(slots, S('dirt', 10), 'left');
  assert.deepEqual(arr.slice(0, 3).map((s) => s.count), [3, 3, 4], 'even split over 3 accepting slots (10/3 = 3 each)');
  assert.deepEqual(r.cursor, S('dirt', 1));
  const arr2 = [null, null];
  r = dragDistribute(arr2.map((_, i) => arraySlot(arr2, i)), S('sand', 5), 'right');
  assert.deepEqual(arr2, [S('sand', 1), S('sand', 1)]); assert.deepEqual(r.cursor, S('sand', 3));
  // quick move merges first, then empties
  const from = [S('dirt', 40)];
  const to = [null, S('dirt', 50), S('stone', 3)];
  assert.ok(quickMove(arraySlot(from, 0), to.map((_, i) => arraySlot(to, i))));
  assert.deepEqual(to, [S('dirt', 26), S('dirt', 64), S('stone', 3)]);
  assert.equal(from[0], null);
  const left = moveInto(S('stone', 100), [arraySlot([null], 0)]);
  assert.deepEqual(left, S('stone', 36));
  // gather: partial stacks first
  const g = [S('dirt', 64), S('dirt', 5), S('dirt', 10)];
  r = gatherToCursor(g.map((_, i) => arraySlot(g, i)), S('dirt', 1));
  assert.deepEqual(r.cursor, S('dirt', 64)); assert.equal(g[1], null); assert.equal(g[2], null); assert.deepEqual(g[0], S('dirt', 16), 'partials first, then the full stack tops up');
});
