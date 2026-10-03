// OWNER: LEAD (shared data, written once by the architect). Lanes READ this.
// Matching rules (implemented by FEATURE-INV in src/inventory/crafting.js) are in docs/SPEC.md §4.6:
//   * shaped: pattern rows use ' ' for empty; the pattern is trimmed to its bounding box and may sit anywhere in
//     the grid; a horizontally mirrored match also counts; every grid cell outside the pattern must be empty.
//   * shapeless: the multiset of non-empty grid cells must equal the ingredient list exactly (any order/position).
//   * an ingredient is an item key or '#tag' (any item in TAGS[tag]).
//   * a 2x2 grid (player inventory) can only match recipes whose trimmed pattern fits in 2x2 / <= 4 ingredients.
//   * crafting consumes one item per used cell; items in REMAINDERS leave their remainder behind in that cell.
//   * when several recipes match, the FIRST in RECIPES order wins.

import { COLORS } from '../core/constants.js';
import { TIERS } from './items.js';

export const TAGS = Object.freeze({
  planks: ['oak_planks', 'birch_planks', 'spruce_planks'],
  logs: ['oak_log', 'birch_log', 'spruce_log'],
  wool: COLORS.map((c) => c + '_wool'),
  coals: ['coal', 'charcoal'],
});

/** Items that leave something behind in the crafting grid when consumed. */
export const REMAINDERS = Object.freeze({ milk_bucket: 'bucket', water_bucket: 'bucket', lava_bucket: 'bucket' });

export const RECIPES = [];
let n = 0;
function shaped(result, count, pattern, key, extra = {}) {
  RECIPES.push(Object.freeze({ id: `${result}#${n++}`, type: 'shaped', pattern, key, result: { item: result, count }, ...extra }));
}
function shapeless(result, count, ingredients, extra = {}) {
  RECIPES.push(Object.freeze({ id: `${result}#${n++}`, type: 'shapeless', ingredients, result: { item: result, count }, ...extra }));
}

/* ---- wood & basics (most important first: the kid's recipe book shows these first) ---- */
shapeless('oak_planks', 4, ['oak_log']);
shapeless('birch_planks', 4, ['birch_log']);
shapeless('spruce_planks', 4, ['spruce_log']);
shaped('stick', 4, ['#', '#'], { '#': '#planks' });
shaped('crafting_table', 1, ['##', '##'], { '#': '#planks' });
shaped('torch', 4, ['C', 'S'], { C: '#coals', S: 'stick' });
shaped('chest', 1, ['###', '# #', '###'], { '#': '#planks' });
shaped('furnace', 1, ['###', '# #', '###'], { '#': 'cobblestone' });

/* ---- tools (5 types x 5 tiers) ---- */
for (const [tier, t] of Object.entries(TIERS)) {
  const M = t.material;
  shaped(`${tier}_pickaxe`, 1, ['MMM', ' S ', ' S '], { M, S: 'stick' }, { group: 'tools' });
  shaped(`${tier}_axe`, 1, ['MM', 'MS', ' S'], { M, S: 'stick' }, { group: 'tools' });
  shaped(`${tier}_shovel`, 1, ['M', 'S', 'S'], { M, S: 'stick' }, { group: 'tools' });
  shaped(`${tier}_sword`, 1, ['M', 'M', 'S'], { M, S: 'stick' }, { group: 'combat' });
  shaped(`${tier}_hoe`, 1, ['MM', ' S', ' S'], { M, S: 'stick' }, { group: 'tools' });
}
shaped('shears', 1, [' I', 'I '], { I: 'iron_ingot' });
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);
shaped('bucket', 1, ['I I', ' I '], { I: 'iron_ingot' });

/* ---- building ---- */
shaped('oak_door', 3, ['##', '##', '##'], { '#': '#planks' });
shaped('ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' });
shaped('oak_slab', 6, ['###'], { '#': 'oak_planks' });
shaped('cobblestone_slab', 6, ['###'], { '#': 'cobblestone' });
shaped('stone_brick_slab', 6, ['###'], { '#': 'stone_bricks' });
shaped('oak_stairs', 4, ['#  ', '## ', '###'], { '#': 'oak_planks' });
shaped('cobblestone_stairs', 4, ['#  ', '## ', '###'], { '#': 'cobblestone' });
shaped('oak_fence', 3, ['PSP', 'PSP'], { P: 'oak_planks', S: 'stick' });
shaped('oak_fence_gate', 1, ['SPS', 'SPS'], { P: '#planks', S: 'stick' });
shaped('glass_pane', 16, ['GGG', 'GGG'], { G: 'glass' });
shaped('painting', 1, ['SSS', 'SWS', 'SSS'], { S: 'stick', W: '#wool' });
shaped('bookshelf', 1, ['###', 'BBB', '###'], { '#': '#planks', B: 'book' });
shaped('stone_bricks', 4, ['SS', 'SS'], { S: 'stone' });
shaped('bricks', 1, ['BB', 'BB'], { B: 'brick' });
shaped('sandstone', 1, ['SS', 'SS'], { S: 'sand' });
shaped('snow_block', 1, ['SS', 'SS'], { S: 'snowball' });
shaped('snow', 6, ['SSS'], { S: 'snow_block' });
shaped('clay', 1, ['CC', 'CC'], { C: 'clay_ball' });
shaped('glowstone', 1, ['GG', 'GG'], { G: 'glowstone_dust' });
shaped('jack_o_lantern', 1, ['P', 'T'], { P: 'pumpkin', T: 'torch' });
shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' });
shaped('hay_block', 1, ['WWW', 'WWW', 'WWW'], { W: 'wheat' });
shapeless('wheat', 9, ['hay_block']);

/* ---- storage blocks (9 <-> 1) ---- */
for (const [blk, ing] of [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond'], ['emerald_block', 'emerald'],
  ['lapis_block', 'lapis_lazuli'], ['coal_block', 'coal'], ['redstone_block', 'redstone']]) {
  shaped(blk, 1, ['XXX', 'XXX', 'XXX'], { X: ing });
  shapeless(ing, 9, [blk]);
}

/* ---- colours: wool, beds, carpet, stained glass, dyes ---- */
shaped('white_wool', 1, ['SS', 'SS'], { S: 'string' });
for (const c of COLORS) {
  shapeless(`${c}_wool`, 1, [`${c}_dye`, '#wool'], { group: 'colors' });
  shaped(`${c}_bed`, 1, ['WWW', 'PPP'], { W: `${c}_wool`, P: '#planks' }, { group: 'beds' });
  shaped(`${c}_carpet`, 3, ['WW'], { W: `${c}_wool` }, { group: 'colors' });
  shaped(`${c}_stained_glass`, 8, ['GGG', 'GDG', 'GGG'], { G: 'glass', D: `${c}_dye` }, { group: 'colors' });
}
// Dyes from flowers & materials (original Blockcraft mapping where vanilla has no source here).
shapeless('yellow_dye', 1, ['dandelion']);
shapeless('red_dye', 1, ['poppy']);
shapeless('blue_dye', 1, ['cornflower']);
shapeless('blue_dye', 1, ['lapis_lazuli']);
shapeless('light_blue_dye', 1, ['blue_orchid']);
shapeless('magenta_dye', 1, ['allium']);
shapeless('white_dye', 1, ['lily_of_the_valley']);
shapeless('white_dye', 1, ['bone_meal']);
shapeless('orange_dye', 1, ['orange_tulip']);
shapeless('pink_dye', 1, ['pink_tulip']);
shapeless('black_dye', 1, ['#coals']);
shapeless('orange_dye', 2, ['red_dye', 'yellow_dye']);
shapeless('pink_dye', 2, ['red_dye', 'white_dye']);
shapeless('light_blue_dye', 2, ['blue_dye', 'white_dye']);
shapeless('purple_dye', 2, ['red_dye', 'blue_dye']);
shapeless('magenta_dye', 2, ['purple_dye', 'pink_dye']);
shapeless('lime_dye', 2, ['green_dye', 'white_dye']);
shapeless('cyan_dye', 2, ['blue_dye', 'green_dye']);
shapeless('gray_dye', 2, ['black_dye', 'white_dye']);
shapeless('light_gray_dye', 2, ['gray_dye', 'white_dye']);
shapeless('brown_dye', 2, ['orange_dye', 'black_dye']);

/* ---- food ---- */
shaped('bread', 1, ['WWW'], { W: 'wheat' });
shaped('bowl', 4, ['P P', ' P '], { P: '#planks' });
shapeless('mushroom_stew', 1, ['brown_mushroom', 'red_mushroom', 'bowl']);
shaped('cake', 1, ['MMM', 'SES', 'WWW'], { M: 'milk_bucket', S: 'sugar', E: 'egg', W: 'wheat' });
shapeless('pumpkin_pie', 1, ['pumpkin', 'sugar', 'egg']);
shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' });
shapeless('sugar', 1, ['sugar_cane']);

/* ---- materials ---- */
shaped('paper', 3, ['CCC'], { C: 'sugar_cane' });
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
shapeless('bone_meal', 3, ['bone']);

/* ---- armor (P1) ---- */
for (const [mat, M] of [['leather', 'leather'], ['iron', 'iron_ingot'], ['golden', 'gold_ingot'], ['diamond', 'diamond']]) {
  shaped(`${mat}_helmet`, 1, ['MMM', 'M M'], { M }, { group: 'armor' });
  shaped(`${mat}_chestplate`, 1, ['M M', 'MMM', 'MMM'], { M }, { group: 'armor' });
  shaped(`${mat}_leggings`, 1, ['MMM', 'M M', 'M M'], { M }, { group: 'armor' });
  shaped(`${mat}_boots`, 1, ['M M', 'M M'], { M }, { group: 'armor' });
}

/* ---- travel, riding, combat (P1/P2) ---- */
shaped('arrow', 4, ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' });
shaped('bow', 1, [' ST', 'S T', ' ST'], { S: 'stick', T: 'string' });
shaped('saddle', 1, [' L ', 'LIL'], { L: 'leather', I: 'iron_ingot' });
shapeless('carrot_on_a_stick', 1, ['stick', 'string', 'carrot']);
shaped('lead', 2, ['SS ', 'SS ', '  S'], { S: 'string' });
shaped('oak_boat', 1, ['P P', 'PPP'], { P: '#planks' });

/** Furnace recipes. time in ticks (200 = 10 s). xp per item (P1). input may be '#tag'. */
export const SMELTING = Object.freeze([
  { input: 'raw_iron', result: 'iron_ingot', xp: 0.7 },
  { input: 'raw_gold', result: 'gold_ingot', xp: 1.0 },
  { input: 'iron_ore', result: 'iron_ingot', xp: 0.7 },
  { input: 'gold_ore', result: 'gold_ingot', xp: 1.0 },
  { input: 'diamond_ore', result: 'diamond', xp: 1.0 },
  { input: 'coal_ore', result: 'coal', xp: 0.1 },
  { input: 'lapis_ore', result: 'lapis_lazuli', xp: 0.2 },
  { input: 'redstone_ore', result: 'redstone', xp: 0.7 },
  { input: 'emerald_ore', result: 'emerald', xp: 1.0 },
  { input: 'sand', result: 'glass', xp: 0.1 },
  { input: 'cobblestone', result: 'stone', xp: 0.1 },
  { input: '#logs', result: 'charcoal', xp: 0.15 },
  { input: 'porkchop', result: 'cooked_porkchop', xp: 0.35 },
  { input: 'beef', result: 'cooked_beef', xp: 0.35 },
  { input: 'chicken', result: 'cooked_chicken', xp: 0.35 },
  { input: 'mutton', result: 'cooked_mutton', xp: 0.35 },
  { input: 'potato', result: 'baked_potato', xp: 0.35 },
  { input: 'clay_ball', result: 'brick', xp: 0.3 },
  { input: 'cactus', result: 'green_dye', xp: 1.0 },
].map((r) => Object.freeze({ time: 200, ...r })));

export const SMELT_TIME = 200;

/** Resolve an ingredient spec to the list of item keys it accepts. */
export function ingredientItems(spec) {
  if (spec.startsWith('#')) {
    const t = TAGS[spec.slice(1)];
    if (!t) throw new Error(`unknown tag ${spec}`);
    return t;
  }
  return [spec];
}
