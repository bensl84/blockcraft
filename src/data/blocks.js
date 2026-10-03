// OWNER: LEAD (shared data, written once by the architect). Lanes READ this; changes go through the
// integrator so every lane stays in agreement. Numeric ids are SAVE-FORMAT STABLE: never renumber,
// only append. See docs/SPEC.md §4 (block model) for the meaning of every field.
//
// A block value in the world is a Uint16: id (bits 0-7) | state (bits 8-15). See core/constants.js.
// State bit layouts per shape are documented next to the shape in SPEC §4.3 and in STATE below.
//
// Field reference (defaults in DEFAULTS):
//   shape        'none'|'cube'|'cross'|'liquid'|'torch'|'slab'|'stairs'|'door'|'bed'|'ladder'|'layer'|
//                'farmland'|'cactus'|'crop'|'fence'|'fire'|'chest'|'cake'|'carpet'|'gate'|'pane'
//   pass         render pass: 'opaque'|'cutout'|'translucent'|'none'
//   solid        has collision (exact boxes come from registry.getCollisionBoxes(id, state))
//   opaque       full, light-blocking cube: culls neighbour faces, casts AO, blocks sky/block light
//   emit         block light emitted 0..15
//   filter       extra light loss when light passes INTO this cell (0 air/glass, 1 leaves/water/ice, 15 opaque)
//   hardness     seconds-scale hardness (-1 = unbreakable). Break time = hardness * (1.5|5) / speed
//   blast        blast resistance
//   tool         preferred tool type ('pickaxe'|'axe'|'shovel'|'hoe'|'shears'|'sword'|null)
//   level        minimum harvest level when requiresTool (1 wood/gold, 2 stone, 3 iron, 4 diamond)
//   requiresTool drops only when mined with `tool` of at least `level`
//   drops        undefined = drops its own item x1; null = nothing; 'item' = 1 of item;
//                [{item, min=1, max=min, chance=1}] = each entry rolled; dropFn(state, rand) for special cases
//   sound        material sound set: 'stone'|'wood'|'grass'|'dirt'|'gravel'|'sand'|'cloth'|'glass'|'snow'|'metal'|'plant'|'liquid'|'none'
//   item         item key for pick-block / creative (undefined = same as block name; null = no item)
//   tab          creative tab for its block item
//   color        average colour (#rrggbb): particles fallback, stub textures, map
//   tex          'key' (all faces) | {top,bottom,side[,front]} | {end,side} (axis blocks) ; or texFn+texKeys
//   texFn        (state, face) => texture key   (stateful textures; texKeys lists every key it can return)
//   facing       state bits 0-1 store FACING (front texture goes on that face)
//   axis         state bits 0-1 store AXIS (0 Y,1 X,2 Z) for logs/hay
//   wave         'leaves'|'plant'|'water'|null vertex animation
//   anim         animated texture ('water'|'lava'|'fire') – see core/constants.js ANIM
//   replaceable  placing a block into this cell replaces it (air, water, grass, snow layer, fire)
//   gravity      falls when unsupported (sand, gravel)
//   climbable    ladder
//   slip         slipperiness (0.6 default, ice 0.98)
//   liquid       'water'|'lava'|null
//   flammable    can burn (fire spread is off by default anyway)
//   support      'floor'|'wall'|'floor_or_wall'|null — breaks (drops) when its support is removed
//   placeOn      list of block names it may be placed on (plants/crops); null = any solid top
//   fallMult     fall-damage multiplier when landing on it (hay 0.2, bed 0.5)
//   contactDamage damage per 10 ticks while touching (cactus 1)
//   lightLevel   (alias of emit; do not use)
//   xp           [min,max] experience when mined in survival (P1)

import { COLORS, COLOR_HEX, FACE } from '../core/constants.js';

export const SHAPES = Object.freeze(['none', 'cube', 'cross', 'liquid', 'torch', 'slab', 'stairs', 'door', 'bed', 'ladder',
  'layer', 'farmland', 'cactus', 'crop', 'fence', 'fire', 'chest', 'cake', 'carpet', 'gate', 'pane']); // append only
export const PASSES = Object.freeze(['opaque', 'cutout', 'translucent', 'none']);
export const SOUND_TYPES = Object.freeze(['stone', 'wood', 'grass', 'dirt', 'gravel', 'sand', 'cloth', 'glass', 'snow', 'metal', 'plant', 'liquid', 'none']);
export const TOOL_TYPES = Object.freeze(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']);
export const TABS = Object.freeze(['building', 'colors', 'nature', 'functional', 'tools', 'combat', 'food', 'materials', 'animals']);

/** State bit layouts (documentation + helpers). */
export const STATE = Object.freeze({
  // liquid: bits 0-2 level (0 = source, 1..7 flowing, higher = weaker), bit 3 falling
  LIQUID_LEVEL_MASK: 7, LIQUID_FALLING: 8,
  // torch: 0 = standing on floor; 1..4 = attached to the wall block in direction N,E,S,W (FACING + 1)
  // slab: bit 0 = top half, bit 1 = double slab (full block; MECH/CORE-E P1)
  SLAB_TOP: 1, SLAB_DOUBLE: 2,
  // stairs: bits 0-1 facing (direction the tall back faces away from = ascending direction), bit 2 upside-down
  STAIRS_UPSIDE_DOWN: 4,
  // door: bits 0-1 facing, bit 2 open, bit 3 upper half, bit 4 hinge on right
  DOOR_OPEN: 4, DOOR_UPPER: 8, DOOR_HINGE_RIGHT: 16,
  // bed: bits 0-1 facing (toward the head), bit 2 = head part, bit 3 = occupied, bits 4-7 colour index (COLORS)
  BED_HEAD: 4, BED_OCCUPIED: 8, BED_COLOR_SHIFT: 4,
  // ladder / chest / furnace / jack_o_lantern: bits 0-1 facing
  // layer (snow): bits 0-2 = layers - 1 (0 => 1/8 tall)
  // farmland: bits 0-2 moisture 0..7 (7 = wet)
  // crop (wheat/carrots/potatoes): bits 0-2 age 0..7
  // sapling: bit 0 stage
  // cactus / sugar_cane: bits 0-3 age (growth counter)
  // cake: bits 0-2 bites eaten 0..6
  // grass_block: bit 0 snowy (snow layer on top; MECH keeps it in sync, P1)
  // leaves: bit 0 persistent (placed by a player: never decays; worldgen leaves are 0 and decay, MECH P1)
  LEAVES_PERSISTENT: 1,
  // fence / glass_pane: bits 0-3 connections N,E,S,W (bit = 1 << FACING). Computed by registry.connectionState();
  //   CORE-E sets it on placement, MECH refreshes it on neighbour 'block:changed'.
  CONNECT_MASK: 15,
  // oak_fence_gate: bits 0-1 facing (toward the player who placed it), bit 2 open
  GATE_OPEN: 4,
  // log/hay: bits 0-1 axis
  // fire: bits 0-3 age
  // tnt: 0
});

const DEFAULTS = Object.freeze({
  shape: 'cube', pass: 'opaque', solid: true, opaque: true, emit: 0, filter: 15,
  hardness: 1, blast: null, tool: null, level: 0, requiresTool: false, drops: undefined, dropFn: null,
  sound: 'stone', item: undefined, tab: 'building', color: '#888888', tex: null, texFn: null, texKeys: null,
  facing: false, axis: false, wave: null, anim: null, replaceable: false, gravity: false, climbable: false,
  slip: 0.6, liquid: null, flammable: false, support: null, placeOn: null, fallMult: 1, contactDamage: 0, xp: null,
  display: null,
});

/** @type {Array<object|undefined>} index = block id */
export const BLOCKS = [];
/** @type {Map<string, object>} */
export const BLOCK_BY_NAME = new Map();

function titleCase(name) { return name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '); }

function def(id, name, props = {}) {
  if (BLOCKS[id]) throw new Error(`duplicate block id ${id}`);
  if (BLOCK_BY_NAME.has(name)) throw new Error(`duplicate block name ${name}`);
  const d = { ...DEFAULTS, ...props, id, name };
  // Non-cube / non-opaque derived defaults
  if (props.opaque === undefined && d.shape !== 'cube') d.opaque = false;
  if (props.opaque === undefined && d.pass !== 'opaque') d.opaque = false;
  if (props.filter === undefined && !d.opaque) d.filter = 0;
  if (d.blast === null) d.blast = d.hardness < 0 ? 3600000 : d.hardness;
  if (!d.display) d.display = titleCase(name);
  BLOCKS[id] = Object.freeze(d);
  BLOCK_BY_NAME.set(name, BLOCKS[id]);
  return BLOCKS[id];
}

const PLANT = { shape: 'cross', pass: 'cutout', solid: false, opaque: false, hardness: 0, sound: 'plant', tab: 'nature', wave: 'plant', support: 'floor', flammable: true };
const GROUND = ['grass_block', 'dirt', 'farmland'];
const between = (rand, a, b) => a + Math.floor(rand() * (b - a + 1));

/* ------------------------------ 0..16 terrain ------------------------------ */
def(0, 'air', { shape: 'none', pass: 'none', solid: false, opaque: false, hardness: 0, item: null, sound: 'none', replaceable: true, color: '#000000', tex: null });
def(1, 'stone', { tex: 'stone', hardness: 1.5, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, drops: 'cobblestone', color: '#7e7e7e' });
def(2, 'grass_block', {
  texFn: (s, f) => (f === FACE.UP ? 'grass_top' : f === FACE.DOWN ? 'dirt' : (s & 1 ? 'grass_side_snowy' : 'grass_side')),
  texKeys: ['grass_top', 'dirt', 'grass_side', 'grass_side_snowy'],
  hardness: 0.6, tool: 'shovel', drops: 'dirt', sound: 'grass', tab: 'nature', color: '#67a93b',
});
def(3, 'dirt', { tex: 'dirt', hardness: 0.5, tool: 'shovel', sound: 'dirt', tab: 'nature', color: '#7a5230' });
def(4, 'cobblestone', { tex: 'cobblestone', hardness: 2, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, color: '#7c7c7c' });
def(5, 'bedrock', { tex: 'bedrock', hardness: -1, blast: 3600000, item: 'bedrock', drops: null, tab: 'building', color: '#404040' });
def(6, 'sand', { tex: 'sand', hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true, tab: 'nature', color: '#e3d3a0' });
def(7, 'gravel', {
  tex: 'gravel', hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true, tab: 'nature', color: '#857f79',
  // 10% flint (Java). Original Blockcraft twist: 5% extra bone, so wolf taming and bone meal work in survival
  // before the P1 skeletons exist (SPEC §2.2 "P0 item sources").
  dropFn: (s, rand) => {
    const out = [{ item: rand() < 0.1 ? 'flint' : 'gravel', count: 1 }];
    if (rand() < 0.05) out.push({ item: 'bone', count: 1 });
    return out;
  },
});
def(8, 'sandstone', { tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, hardness: 0.8, blast: 0.8, tool: 'pickaxe', level: 1, requiresTool: true, color: '#dccb94' });
def(9, 'clay', { tex: 'clay', hardness: 0.6, tool: 'shovel', sound: 'dirt', drops: [{ item: 'clay_ball', min: 4 }], tab: 'nature', color: '#a2a8b5' });
def(10, 'snow_block', { tex: 'snow', hardness: 0.2, tool: 'shovel', sound: 'snow', drops: [{ item: 'snowball', min: 4 }], tab: 'nature', color: '#e6eff5' });
def(11, 'snow', {
  shape: 'layer', tex: 'snow', hardness: 0.1, tool: 'shovel', sound: 'snow', replaceable: true, support: 'floor',
  dropFn: (s) => [{ item: 'snowball', count: (s & 7) + 1 }], tab: 'nature', color: '#f0f6fa',
});
def(12, 'ice', { tex: 'ice', pass: 'translucent', opaque: false, filter: 1, hardness: 0.5, tool: 'pickaxe', sound: 'glass', slip: 0.98, drops: null, tab: 'nature', color: '#9cc2f6' });
def(13, 'water', {
  shape: 'liquid', pass: 'translucent', solid: false, opaque: false, filter: 1, hardness: 100, blast: 100, liquid: 'water',
  tex: 'water', anim: 'water', wave: 'water', replaceable: true, drops: null, item: null, sound: 'liquid', color: '#3268e0',
});
def(14, 'lava', {
  shape: 'liquid', pass: 'opaque', solid: false, opaque: false, filter: 1, emit: 15, hardness: 100, blast: 100, liquid: 'lava',
  tex: 'lava', anim: 'lava', replaceable: true, drops: null, item: null, sound: 'liquid', color: '#e2560a',
});
def(15, 'obsidian', { tex: 'obsidian', hardness: 50, blast: 1200, tool: 'pickaxe', level: 4, requiresTool: true, color: '#160f22' });
def(16, 'mossy_cobblestone', { tex: 'mossy_cobblestone', hardness: 2, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, color: '#6a7a5a' });

/* ------------------------------ 17..23 ores ------------------------------ */
const ORE = { hardness: 3, blast: 3, tool: 'pickaxe', requiresTool: true, tab: 'nature' };
def(17, 'coal_ore', { ...ORE, tex: 'coal_ore', level: 1, drops: 'coal', xp: [0, 2], color: '#6a6a6a' });
def(18, 'iron_ore', { ...ORE, tex: 'iron_ore', level: 2, drops: 'raw_iron', color: '#8a7d74' });
def(19, 'gold_ore', { ...ORE, tex: 'gold_ore', level: 3, drops: 'raw_gold', color: '#8f8a6a' });
def(20, 'diamond_ore', { ...ORE, tex: 'diamond_ore', level: 3, drops: 'diamond', xp: [3, 7], color: '#7a9496' });
def(21, 'redstone_ore', { ...ORE, tex: 'redstone_ore', level: 3, drops: [{ item: 'redstone', min: 4, max: 5 }], xp: [1, 5], color: '#8a6a6a' });
def(22, 'lapis_ore', { ...ORE, tex: 'lapis_ore', level: 2, drops: [{ item: 'lapis_lazuli', min: 4, max: 9 }], xp: [2, 5], color: '#6a7490' });
def(23, 'emerald_ore', { ...ORE, tex: 'emerald_ore', level: 3, drops: 'emerald', xp: [3, 7], color: '#6a8a74' });

/* ------------------------------ 24..35 woods (oak, birch, spruce) ------------------------------ */
const LOG = { axis: true, hardness: 2, tool: 'axe', sound: 'wood', flammable: true, tab: 'nature' };
def(24, 'oak_log', { ...LOG, tex: { end: 'oak_log_top', side: 'oak_log' }, color: '#6a5032' });
def(25, 'birch_log', { ...LOG, tex: { end: 'birch_log_top', side: 'birch_log' }, color: '#d8d6cf' });
def(26, 'spruce_log', { ...LOG, tex: { end: 'spruce_log_top', side: 'spruce_log' }, color: '#3e2b17' });
const PLANKS = { hardness: 2, blast: 3, tool: 'axe', sound: 'wood', flammable: true };
def(27, 'oak_planks', { ...PLANKS, tex: 'oak_planks', color: '#ae8a52' });
def(28, 'birch_planks', { ...PLANKS, tex: 'birch_planks', color: '#d6c58b' });
def(29, 'spruce_planks', { ...PLANKS, tex: 'spruce_planks', color: '#6c4f2f' });
const LEAVES = { pass: 'cutout', opaque: false, filter: 1, hardness: 0.2, tool: 'hoe', sound: 'plant', wave: 'leaves', flammable: true, tab: 'nature' };
// Original Blockcraft twist: oak and birch leaves drop string 2% (bows, wool, leads before P1 spiders exist).
def(30, 'oak_leaves', { ...LEAVES, tex: 'oak_leaves', color: '#4f8a2e', drops: [{ item: 'oak_sapling', chance: 0.05 }, { item: 'stick', min: 1, max: 2, chance: 0.02 }, { item: 'apple', chance: 0.005 }, { item: 'string', chance: 0.02 }] });
def(31, 'birch_leaves', { ...LEAVES, tex: 'birch_leaves', color: '#6a9a45', drops: [{ item: 'birch_sapling', chance: 0.05 }, { item: 'stick', min: 1, max: 2, chance: 0.02 }, { item: 'string', chance: 0.02 }] });
def(32, 'spruce_leaves', { ...LEAVES, tex: 'spruce_leaves', color: '#355c3c', drops: [{ item: 'spruce_sapling', chance: 0.05 }, { item: 'stick', min: 1, max: 2, chance: 0.02 }] });
const SAPLING = { ...PLANT, placeOn: GROUND };
def(33, 'oak_sapling', { ...SAPLING, tex: 'oak_sapling', color: '#4f8a2e' });
def(34, 'birch_sapling', { ...SAPLING, tex: 'birch_sapling', color: '#6a9a45' });
def(35, 'spruce_sapling', { ...SAPLING, tex: 'spruce_sapling', color: '#355c3c' });

/* ------------------------------ 36..48 plants ------------------------------ */
def(36, 'short_grass', { ...PLANT, tex: 'short_grass', replaceable: true, placeOn: GROUND, drops: [{ item: 'wheat_seeds', chance: 0.125 }], color: '#5a9a33' });
def(37, 'fern', { ...PLANT, tex: 'fern', replaceable: true, placeOn: GROUND, drops: [{ item: 'wheat_seeds', chance: 0.125 }], color: '#4a7a3a' });
def(38, 'dead_bush', { ...PLANT, tex: 'dead_bush', replaceable: true, placeOn: ['sand', 'dirt', 'grass_block'], dropFn: (s, rand) => [{ item: 'stick', count: between(rand, 0, 2) }], color: '#7a5a2a' });
const FLOWER = { ...PLANT, placeOn: GROUND };
def(39, 'dandelion', { ...FLOWER, tex: 'dandelion', color: '#ffe13a' });
def(40, 'poppy', { ...FLOWER, tex: 'poppy', color: '#e0261c' });
def(41, 'cornflower', { ...FLOWER, tex: 'cornflower', color: '#4a6ef0' });
def(42, 'blue_orchid', { ...FLOWER, tex: 'blue_orchid', color: '#3ab3da' });
def(43, 'allium', { ...FLOWER, tex: 'allium', color: '#c74ebd' });
def(44, 'lily_of_the_valley', { ...FLOWER, tex: 'lily_of_the_valley', color: '#f2efe6' });
def(45, 'orange_tulip', { ...FLOWER, tex: 'orange_tulip', color: '#f08a2a' });
def(46, 'pink_tulip', { ...FLOWER, tex: 'pink_tulip', color: '#f29ac0' });
def(47, 'sugar_cane', { ...PLANT, wave: null, tex: 'sugar_cane', placeOn: ['grass_block', 'dirt', 'sand', 'sugar_cane'], color: '#8ac65a' });
def(48, 'cactus', {
  shape: 'cactus', opaque: false, tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, hardness: 0.4,
  sound: 'cloth', contactDamage: 1, support: 'floor', placeOn: ['sand', 'cactus'], tab: 'nature', color: '#2e7426',
});

/* ------------------------------ 49..56 farm, pumpkins, glass ------------------------------ */
def(49, 'pumpkin', { tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' }, hardness: 1, tool: 'axe', sound: 'wood', tab: 'nature', color: '#dc7d18' });
def(50, 'jack_o_lantern', { facing: true, tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, emit: 15, hardness: 1, tool: 'axe', sound: 'wood', tab: 'functional', color: '#ec8f22' });
def(51, 'melon', { tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' }, hardness: 1, tool: 'axe', sound: 'wood', drops: [{ item: 'melon_slice', min: 3, max: 7 }], tab: 'nature', color: '#6c9a20' });
const CROP = { shape: 'crop', pass: 'cutout', solid: false, opaque: false, hardness: 0, sound: 'plant', wave: 'plant', support: 'floor', placeOn: ['farmland'], tab: 'nature' };
const WHEAT_KEYS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 'wheat_' + i);
def(52, 'wheat', {
  ...CROP, item: 'wheat_seeds', texFn: (s) => WHEAT_KEYS[s & 7], texKeys: WHEAT_KEYS, color: '#c9a83a',
  dropFn: (s, rand) => ((s & 7) === 7 ? [{ item: 'wheat', count: 1 }, { item: 'wheat_seeds', count: between(rand, 1, 4) }] : [{ item: 'wheat_seeds', count: 1 }]),
});
const CARROT_KEYS = [0, 1, 2, 3].map((i) => 'carrots_' + i);
def(53, 'carrots', {
  ...CROP, item: 'carrot', texFn: (s) => CARROT_KEYS[(s & 7) >> 1], texKeys: CARROT_KEYS, color: '#e08a2a',
  dropFn: (s, rand) => [{ item: 'carrot', count: (s & 7) === 7 ? between(rand, 2, 5) : 1 }],
});
const POTATO_KEYS = [0, 1, 2, 3].map((i) => 'potatoes_' + i);
def(54, 'potatoes', {
  ...CROP, item: 'potato', texFn: (s) => POTATO_KEYS[(s & 7) >> 1], texKeys: POTATO_KEYS, color: '#c9a85a',
  dropFn: (s, rand) => [{ item: 'potato', count: (s & 7) === 7 ? between(rand, 2, 5) : 1 }],
});
def(55, 'farmland', {
  shape: 'farmland', opaque: false, item: null, drops: 'dirt', hardness: 0.6, tool: 'shovel', sound: 'dirt', color: '#5a3b22',
  texFn: (s, f) => (f === FACE.UP ? ((s & 7) === 7 ? 'farmland_wet' : 'farmland_dry') : 'dirt'),
  texKeys: ['farmland_dry', 'farmland_wet', 'dirt'],
});
def(56, 'glass', { tex: 'glass', pass: 'cutout', opaque: false, hardness: 0.3, sound: 'glass', drops: null, color: '#c9e6ef' });

/* ------------------------------ 57..61 building ------------------------------ */
def(57, 'bricks', { tex: 'bricks', hardness: 2, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, color: '#9c4c3a' });
def(58, 'stone_bricks', { tex: 'stone_bricks', hardness: 1.5, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, color: '#808080' });
def(59, 'mossy_stone_bricks', { tex: 'mossy_stone_bricks', hardness: 1.5, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, color: '#6e7a62' });
def(60, 'bookshelf', { tex: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood', flammable: true, drops: [{ item: 'book', min: 3 }], color: '#7a5a3a' });
def(61, 'glowstone', { tex: 'glowstone', emit: 15, hardness: 0.3, sound: 'glass', drops: [{ item: 'glowstone_dust', min: 2, max: 4 }], tab: 'functional', color: '#f8d26a' });

/* ------------------------------ 62..70 functional ------------------------------ */
def(62, 'crafting_table', { tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' }, facing: true, hardness: 2.5, tool: 'axe', sound: 'wood', flammable: true, tab: 'functional', color: '#8a6a3c' });
def(63, 'furnace', { facing: true, tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, hardness: 3.5, tool: 'pickaxe', level: 1, requiresTool: true, tab: 'functional', color: '#7a7a7a' });
def(64, 'furnace_lit', { facing: true, tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit' }, emit: 13, hardness: 3.5, tool: 'pickaxe', level: 1, requiresTool: true, item: 'furnace', drops: 'furnace', color: '#8a7a6a' });
def(65, 'chest', { shape: 'chest', facing: true, tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' }, hardness: 2.5, tool: 'axe', sound: 'wood', flammable: true, tab: 'functional', color: '#9e662c' });
const BED_KEYS = [...COLORS.map((c) => 'bed_head_top_' + c), ...COLORS.map((c) => 'bed_foot_top_' + c), 'bed_side_head', 'bed_side_foot', 'bed_end_head', 'bed_end_foot', 'bed_bottom'];
def(66, 'bed', {
  shape: 'bed', hardness: 0.2, sound: 'wood', item: null, flammable: true, fallMult: 0.5, color: '#c4302b',
  texFn: (s, f) => {
    const color = COLORS[(s >> 4) & 15];
    const head = (s & 4) !== 0;
    if (f === FACE.UP) return (head ? 'bed_head_top_' : 'bed_foot_top_') + color;
    if (f === FACE.DOWN) return 'bed_bottom';
    // facing (bits 0-1) points toward the head; the face pointing that way on the head part is the head end
    const facingFace = [FACE.NORTH, FACE.EAST, FACE.SOUTH, FACE.WEST][s & 3];
    const backFace = [FACE.SOUTH, FACE.WEST, FACE.NORTH, FACE.EAST][s & 3];
    if (head && f === facingFace) return 'bed_end_head';
    if (!head && f === backFace) return 'bed_end_foot';
    return head ? 'bed_side_head' : 'bed_side_foot';
  },
  texKeys: BED_KEYS,
  dropFn: (s) => [{ item: COLORS[(s >> 4) & 15] + '_bed', count: 1 }],
});
def(67, 'oak_door', {
  shape: 'door', pass: 'cutout', hardness: 3, tool: 'axe', sound: 'wood', flammable: true, support: 'floor', tab: 'functional', color: '#a8814b',
  texFn: (s) => ((s & 8) ? 'oak_door_upper' : 'oak_door_lower'), texKeys: ['oak_door_upper', 'oak_door_lower'],
  dropFn: () => [{ item: 'oak_door', count: 1 }],
});
def(68, 'ladder', { shape: 'ladder', pass: 'cutout', facing: true, tex: 'ladder', hardness: 0.4, tool: 'axe', sound: 'wood', climbable: true, support: 'wall', tab: 'functional', color: '#9c7a46' });
def(69, 'torch', { shape: 'torch', pass: 'cutout', solid: false, tex: 'torch', emit: 14, hardness: 0, sound: 'wood', support: 'floor_or_wall', tab: 'functional', color: '#ffd040' });
def(70, 'tnt', { tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0, sound: 'grass', flammable: true, tab: 'functional', color: '#c8361e' });

/* ------------------------------ 71..78 storage blocks ------------------------------ */
const METAL = { tool: 'pickaxe', requiresTool: true, sound: 'metal', blast: 6 };
def(71, 'iron_block', { ...METAL, tex: 'iron_block', hardness: 5, level: 2, color: '#d8d8d8' });
def(72, 'gold_block', { ...METAL, tex: 'gold_block', hardness: 3, level: 3, color: '#f2c932' });
def(73, 'diamond_block', { ...METAL, tex: 'diamond_block', hardness: 5, level: 3, color: '#4fe3dc' });
def(74, 'emerald_block', { ...METAL, tex: 'emerald_block', hardness: 5, level: 3, color: '#19c45c' });
def(75, 'lapis_block', { ...METAL, sound: 'stone', tex: 'lapis_block', hardness: 3, level: 2, color: '#2d5bc4' });
def(76, 'coal_block', { ...METAL, sound: 'stone', tex: 'coal_block', hardness: 5, level: 1, flammable: true, color: '#1c1c1c' });
def(77, 'redstone_block', { ...METAL, tex: 'redstone_block', hardness: 5, level: 1, color: '#b01c1c' });
def(78, 'hay_block', { axis: true, tex: { end: 'hay_block_top', side: 'hay_block_side' }, hardness: 0.5, tool: 'hoe', sound: 'grass', flammable: true, fallMult: 0.2, tab: 'building', color: '#c9a42e' });

/* ------------------------------ 79..86 shapes & specials ------------------------------ */
// Slabs and stairs: not `opaque` (no face culling / AO) but filter 15, so a slab or stair roof keeps sky light out.
const ROOF = { filter: 15 };
def(79, 'oak_slab', { ...ROOF, shape: 'slab', tex: 'oak_planks', hardness: 2, blast: 3, tool: 'axe', sound: 'wood', flammable: true, color: '#ae8a52' });
def(80, 'cobblestone_slab', { ...ROOF, shape: 'slab', tex: 'cobblestone', hardness: 2, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, color: '#7c7c7c' });
def(81, 'stone_brick_slab', { ...ROOF, shape: 'slab', tex: 'stone_bricks', hardness: 2, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, color: '#808080' });
def(82, 'oak_stairs', { ...ROOF, shape: 'stairs', tex: 'oak_planks', hardness: 2, blast: 3, tool: 'axe', sound: 'wood', flammable: true, color: '#ae8a52' });
def(83, 'cobblestone_stairs', { ...ROOF, shape: 'stairs', tex: 'cobblestone', hardness: 2, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, color: '#7c7c7c' });
// Fence: state bits 0-3 = connections (STATE.CONNECT_MASK). Collision 1.5 high so animals stay in pens.
def(84, 'oak_fence', { shape: 'fence', tex: 'oak_planks', hardness: 2, blast: 3, tool: 'axe', sound: 'wood', flammable: true, color: '#ae8a52' });
def(85, 'fire', { shape: 'fire', pass: 'cutout', solid: false, tex: 'fire', anim: 'fire', emit: 15, hardness: 0, replaceable: true, item: null, drops: null, sound: 'none', support: 'floor', color: '#ff9a24' });
def(86, 'cake', {
  shape: 'cake', hardness: 0.5, sound: 'cloth', drops: null, tab: 'food', color: '#f2ece0',
  texFn: (s, f) => (f === FACE.UP ? 'cake_top' : f === FACE.DOWN ? 'cake_bottom' : (f === FACE.WEST && (s & 7) > 0 ? 'cake_inner' : 'cake_side')),
  texKeys: ['cake_top', 'cake_bottom', 'cake_side', 'cake_inner'],
});

/* ------------------------------ 87..102 wool x16 ------------------------------ */
COLORS.forEach((c, i) => def(87 + i, c + '_wool', { tex: 'wool_' + c, hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: true, tab: 'colors', color: null }));
/* ------------------------------ 103..118 stained glass x16 ------------------------------ */
COLORS.forEach((c, i) => def(103 + i, c + '_stained_glass', { tex: 'stained_glass_' + c, pass: 'translucent', opaque: false, hardness: 0.3, sound: 'glass', drops: null, tab: 'colors', color: null }));

/* ------------------------------ 119..123 misc natural ------------------------------ */
def(119, 'brown_mushroom', { ...PLANT, wave: null, tex: 'brown_mushroom', placeOn: null, emit: 1, color: '#9a7a5a' });
def(120, 'red_mushroom', { ...PLANT, wave: null, tex: 'red_mushroom', placeOn: null, color: '#c8302a' });
def(121, 'granite', { tex: 'granite', hardness: 1.5, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, tab: 'nature', color: '#9a6a5a' });
def(122, 'diorite', { tex: 'diorite', hardness: 1.5, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, tab: 'nature', color: '#bcbcbc' });
def(123, 'andesite', { tex: 'andesite', hardness: 1.5, blast: 6, tool: 'pickaxe', level: 1, requiresTool: true, tab: 'nature', color: '#888888' });

/* ------------------------------ 124..139 carpet x16 ------------------------------ */
COLORS.forEach((c, i) => def(124 + i, c + '_carpet', { shape: 'carpet', tex: 'wool_' + c, hardness: 0.1, sound: 'cloth', flammable: true, support: 'floor', tab: 'colors', color: null }));

// Fill colour fields for colour families from the shared palette.
for (const b of BLOCKS) {
  if (b && b.color === null) {
    const c = COLORS.find((col) => b.name.startsWith(col + '_'));
    const fixed = { ...b, color: COLOR_HEX[c] };
    BLOCKS[b.id] = Object.freeze(fixed);
    BLOCK_BY_NAME.set(b.name, BLOCKS[b.id]);
  }
}

/* ------------------------------ 140.. appended (P1) ------------------------------ */
// Fence gate: facing bits 0-1, open bit 2. Closed = 1.5-high collision across the gate line; open = no collision.
def(140, 'oak_fence_gate', { shape: 'gate', tex: 'oak_planks', hardness: 2, blast: 3, tool: 'axe', sound: 'wood', flammable: true, facing: true, tab: 'building', color: '#ae8a52' });
// Glass pane: thin glass that connects to neighbours like a fence (bits 0-3). Reuses the glass texture.
def(141, 'glass_pane', { shape: 'pane', pass: 'cutout', tex: 'glass', hardness: 0.3, sound: 'glass', drops: null, tab: 'building', color: '#c9e6ef' });

/** Highest id in use (+1 = table size needed). */
export const BLOCK_COUNT = BLOCKS.length;

/** Convenience: numeric id for a block name (throws on unknown names - catches typos early). */
export function blockId(name) {
  const b = BLOCK_BY_NAME.get(name);
  if (!b) throw new Error(`unknown block "${name}"`);
  return b.id;
}
/** Block def by id or name (undefined if unknown). */
export function getBlock(idOrName) {
  return typeof idOrName === 'number' ? BLOCKS[idOrName] : BLOCK_BY_NAME.get(idOrName);
}
