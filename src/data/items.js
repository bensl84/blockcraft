// OWNER: LEAD (shared data, written once by the architect). Lanes READ this. Item keys are save-format
// stable strings. See docs/SPEC.md §4.5 for field meanings.
//
// ItemStack (everywhere in the game): { item: string, count: number, damage?: number, data?: object }
//
// Item def fields:
//   key       unique string id (== block name for plain block items)
//   name      English display name (parent-facing; kids get pictures + optional speech)
//   stack     max stack size (64 default, 16 eggs/snowballs/buckets-of-nothing, 1 tools/armor/filled buckets)
//   tab       creative tab: building|colors|nature|functional|tools|combat|food|materials|animals
//   icon      'iso:<block>' (isometric block icon) | 'tex:<block texture key>' (flat block texture) | 'sprite:<sprite>'
//   tint      optional #rrggbb tint applied to a greyscale sprite (dyes, beds)
//   colors    optional [base, spots] for spawn eggs
//   block     block name placed by this item (+ placeState = state bits to OR in, e.g. bed colour)
//   tool      { type, level, speed, durability }  level: 1 wood/gold, 2 stone, 3 iron, 4 diamond
//   damage    melee damage in half-hearts (fist = 1)
//   armor     { slot: 'head'|'chest'|'legs'|'feet', points, durability }
//   food      { hunger, saturation, alwaysEdible?, effects?: [{type, ticks, level, chance}], returns?: itemKey }
//   fuel      furnace burn time in ticks (200 ticks smelts one item)
//   use       right-click behaviour handled by a lane via hooks.registerItemUse(key, fn):
//             'eat' 'drink' 'bucket' 'water_bucket' 'lava_bucket' 'flint_and_steel' 'shears' 'bone_meal' 'hoe'
//             'spawn_egg' 'throw' 'bow' 'saddle' 'carrot_on_a_stick' 'dye' 'lead' 'boat' 'seeds'
//   mob       mob type for spawn eggs
//   dye       colour name for dyes
//   creative  shown in the creative picker (default true)
//   priority  'P0' | 'P1' | 'P2' — when the behaviour behind this item must work (SPEC §2)

import { BLOCKS } from './blocks.js';
import { MOBS } from './mobs.js';
import { COLORS, COLOR_HEX } from '../core/constants.js';

/** @type {Map<string, object>} */
export const ITEMS = new Map();
/** Items in creative/display order. */
export const ITEM_LIST = [];

function titleCase(key) { return key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '); }

function item(key, props = {}) {
  if (ITEMS.has(key)) throw new Error(`duplicate item ${key}`);
  const d = Object.freeze({ key, name: props.name || titleCase(key), stack: 64, tab: 'materials', icon: 'sprite:' + key, creative: true, damage: 1, priority: 'P0', ...props });
  ITEMS.set(key, d);
  ITEM_LIST.push(d);
  return d;
}

/* ------------------------------ block items (auto) ------------------------------ */
const ISO_SHAPES = new Set(['cube', 'slab', 'stairs', 'chest', 'farmland', 'cactus', 'fence', 'cake', 'layer', 'carpet', 'gate']);
const ITEM_PRIORITY = { stairs: 'P1', fence: 'P1', gate: 'P1', pane: 'P1', cake: 'P1', carpet: 'P1' };
/** Per-block-item overrides: bedrock is not offered in the picker (a kid could never remove it), cake stacks to 1. */
const BLOCK_ITEM_EXTRA = { bedrock: { creative: false }, cake: { stack: 1 } };
for (const b of BLOCKS) {
  if (!b || b.item === null) continue;
  if (b.item !== undefined && b.item !== b.name) continue; // block picks into another item (defined below)
  let icon;
  if (b.shape === 'door') icon = 'sprite:' + b.name;
  else if (ISO_SHAPES.has(b.shape)) icon = 'iso:' + b.name;
  else icon = 'tex:' + (typeof b.tex === 'string' ? b.tex : (b.texKeys ? b.texKeys[0] : b.name));
  item(b.name, {
    name: b.display, block: b.name, icon, tab: b.tab, fuel: blockFuel(b),
    priority: ITEM_PRIORITY[b.shape] || 'P0',
    ...(BLOCK_ITEM_EXTRA[b.name] || {}),
  });
}
function blockFuel(b) {
  if (b.name.endsWith('_log') || b.name.endsWith('_planks') || b.name === 'crafting_table' || b.name === 'chest' || b.name === 'bookshelf' || b.name === 'oak_fence' || b.name === 'oak_stairs' || b.name === 'ladder') return 300;
  if (b.name === 'oak_slab') return 150;
  if (b.name.endsWith('_sapling') || b.name.endsWith('_wool')) return 100;
  if (b.name.endsWith('_carpet')) return 67;
  if (b.name === 'coal_block') return 16000;
  if (b.name === 'oak_door') return 200;
  return undefined;
}

/* ------------------------------ beds x16 ------------------------------ */
COLORS.forEach((c, i) => item(c + '_bed', { block: 'bed', placeState: i << 4, stack: 1, icon: 'sprite:bed', tint: COLOR_HEX[c], tab: 'functional' }));

/* ------------------------------ tools 5 types x 5 tiers ------------------------------ */
export const TIERS = Object.freeze({
  wooden: { level: 1, speed: 2, durability: 59, material: '#planks' },
  stone: { level: 2, speed: 4, durability: 131, material: 'cobblestone' },
  iron: { level: 3, speed: 6, durability: 250, material: 'iron_ingot' },
  golden: { level: 1, speed: 12, durability: 32, material: 'gold_ingot' },
  diamond: { level: 4, speed: 8, durability: 1561, material: 'diamond' },
});
const TOOL_DAMAGE = {
  sword: { wooden: 4, stone: 5, iron: 6, golden: 4, diamond: 7 },
  axe: { wooden: 7, stone: 9, iron: 9, golden: 7, diamond: 9 },
  pickaxe: { wooden: 2, stone: 3, iron: 4, golden: 2, diamond: 5 },
  shovel: { wooden: 2.5, stone: 3.5, iron: 4.5, golden: 2.5, diamond: 5.5 },
  hoe: { wooden: 1, stone: 1, iron: 1, golden: 1, diamond: 1 },
};
for (const type of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) {
  for (const [tier, t] of Object.entries(TIERS)) {
    item(`${tier}_${type}`, {
      stack: 1, tab: type === 'sword' ? 'combat' : 'tools',
      tool: Object.freeze({ type, level: t.level, speed: t.speed, durability: t.durability }),
      damage: TOOL_DAMAGE[type][tier], fuel: tier === 'wooden' ? 200 : undefined,
      use: type === 'hoe' ? 'hoe' : undefined,
    });
  }
}
item('shears', { stack: 1, tab: 'tools', tool: { type: 'shears', level: 0, speed: 5, durability: 238 }, use: 'shears' });
item('flint_and_steel', { stack: 1, tab: 'tools', tool: { type: 'flint_and_steel', level: 0, speed: 1, durability: 64 }, use: 'flint_and_steel' });
item('bucket', { stack: 16, tab: 'tools', use: 'bucket' });
item('water_bucket', { stack: 1, tab: 'tools', use: 'water_bucket' });
item('lava_bucket', { stack: 1, tab: 'tools', use: 'lava_bucket', fuel: 20000, creative: false, priority: 'P1' });
item('milk_bucket', { stack: 1, tab: 'food', use: 'drink', food: { hunger: 0, saturation: 0, alwaysEdible: true, returns: 'bucket' }, priority: 'P1' });
item('saddle', { stack: 1, tab: 'tools', use: 'saddle', priority: 'P1' });
item('carrot_on_a_stick', { stack: 1, tab: 'tools', use: 'carrot_on_a_stick', tool: { type: 'carrot_on_a_stick', level: 0, speed: 1, durability: 25 }, priority: 'P1' });
item('lead', { tab: 'tools', use: 'lead', priority: 'P2' });
item('oak_boat', { stack: 1, tab: 'tools', use: 'boat', priority: 'P1' });   // boat entity + water physics: MOBS lane (SPEC §8.1)
item('painting', { tab: 'functional', use: 'painting', priority: 'P1' });        // hanging picture entity: MECH lane (SPEC §8.6)
item('bow', { stack: 1, tab: 'combat', use: 'bow', tool: { type: 'bow', level: 0, speed: 1, durability: 384 }, fuel: 300, priority: 'P1' });
item('arrow', { tab: 'combat', priority: 'P1' });

/* ------------------------------ armor (P1) ------------------------------ */
const ARMOR = {
  leather: { points: [1, 3, 2, 1], mult: 5 }, iron: { points: [2, 6, 5, 2], mult: 15 },
  golden: { points: [2, 5, 3, 1], mult: 7 }, diamond: { points: [3, 8, 6, 3], mult: 33 },
};
const ARMOR_SLOTS = [['helmet', 'head', 11], ['chestplate', 'chest', 16], ['leggings', 'legs', 15], ['boots', 'feet', 13]];
for (const [mat, a] of Object.entries(ARMOR)) {
  ARMOR_SLOTS.forEach(([piece, slot, base], i) => item(`${mat}_${piece}`, {
    stack: 1, tab: 'combat', priority: 'P1', armor: Object.freeze({ slot, points: a.points[i], durability: base * a.mult }),
  }));
}

/* ------------------------------ materials ------------------------------ */
item('stick', { fuel: 100 });
item('coal', { fuel: 1600 });
item('charcoal', { fuel: 1600 });
item('raw_iron'); item('raw_gold'); item('iron_ingot'); item('gold_ingot'); item('diamond'); item('emerald');
item('lapis_lazuli', { dye: 'blue' }); // also works as blue dye in recipes
item('redstone'); item('flint'); item('string'); item('feather'); item('gunpowder'); item('leather');
item('bone'); item('bone_meal', { use: 'bone_meal', dye: 'white' });
item('wheat'); item('sugar'); item('clay_ball'); item('brick'); item('paper'); item('book'); item('glowstone_dust');
item('bowl', { fuel: 100 });
item('egg', { stack: 16, use: 'throw', priority: 'P1' });
item('snowball', { stack: 16, use: 'throw', priority: 'P2' });
item('wheat_seeds', { block: 'wheat', use: 'seeds', tab: 'nature' });

/* ------------------------------ dyes x16 ------------------------------ */
COLORS.forEach((c) => item(c + '_dye', { icon: 'sprite:dye', tint: COLOR_HEX[c], use: 'dye', dye: c, tab: 'colors' }));

/* ------------------------------ food ------------------------------ */
const F = (hunger, saturation, extra = {}) => Object.freeze({ hunger, saturation, ...extra });
item('apple', { tab: 'food', use: 'eat', food: F(4, 2.4) });
item('golden_apple', { tab: 'food', use: 'eat', food: F(4, 9.6, { alwaysEdible: true, effects: [{ type: 'regeneration', ticks: 100, level: 2, chance: 1 }, { type: 'absorption', ticks: 2400, level: 1, chance: 1 }] }) });
item('bread', { tab: 'food', use: 'eat', food: F(5, 6) });
item('carrot', { tab: 'food', use: 'eat', block: 'carrots', food: F(3, 3.6) });
item('potato', { tab: 'food', use: 'eat', block: 'potatoes', food: F(1, 0.6) });
item('baked_potato', { tab: 'food', use: 'eat', food: F(5, 6) });
item('porkchop', { name: 'Raw Porkchop', tab: 'food', use: 'eat', food: F(3, 1.8) });
item('cooked_porkchop', { tab: 'food', use: 'eat', food: F(8, 12.8) });
item('beef', { name: 'Raw Beef', tab: 'food', use: 'eat', food: F(3, 1.8) });
item('cooked_beef', { name: 'Steak', tab: 'food', use: 'eat', food: F(8, 12.8) });
item('chicken', { name: 'Raw Chicken', tab: 'food', use: 'eat', food: F(2, 1.2, { effects: [{ type: 'hunger', ticks: 600, level: 1, chance: 0.3 }] }) });
item('cooked_chicken', { tab: 'food', use: 'eat', food: F(6, 7.2) });
item('mutton', { name: 'Raw Mutton', tab: 'food', use: 'eat', food: F(2, 1.2) });
item('cooked_mutton', { tab: 'food', use: 'eat', food: F(6, 9.6) });
item('rotten_flesh', { tab: 'food', use: 'eat', food: F(4, 0.8, { effects: [{ type: 'hunger', ticks: 600, level: 1, chance: 0.8 }] }) });
item('melon_slice', { tab: 'food', use: 'eat', food: F(2, 1.2) });
item('pumpkin_pie', { tab: 'food', use: 'eat', food: F(8, 4.8), priority: 'P1' });
item('mushroom_stew', { stack: 1, tab: 'food', use: 'eat', food: F(6, 7.2, { returns: 'bowl' }), priority: 'P1' });

/* ------------------------------ spawn eggs (creative) ------------------------------ */
const EGGS = {
  pig: ['#f0a5a2', '#e07a78'], cow: ['#3a2a1e', '#e8e8e8'], sheep: ['#ecedeb', '#d8c8b0'], chicken: ['#f4f4f4', '#e02020'],
  wolf: ['#d8d8d8', '#8a8a8a'], cat: ['#e8b878', '#8a5a2a'], horse: ['#a0703c', '#3a2a1e'],
  zombie: ['#2a8a8a', '#5a8a3a'], skeleton: ['#cfcfcf', '#5a5a5a'], creeper: ['#3e9a2e', '#1c1c1c'], spider: ['#2a2420', '#e01818'],
};
const EGG_PRIORITY = { cat: 'P1', horse: 'P1', zombie: 'P1', skeleton: 'P1', creeper: 'P1', spider: 'P1' };
for (const [mob, colors] of Object.entries(EGGS)) {
  item(mob + '_spawn_egg', { tab: 'animals', icon: 'sprite:spawn_egg', colors, use: 'spawn_egg', mob, priority: EGG_PRIORITY[mob] || 'P0' });
}

/* ------------------------------ kid creative picker (SPEC §8.2.4) ------------------------------ */
/**
 * The 8 picture tabs of the kid creative picker, in order. `tabs` = data tabs (item.tab) shown on that page,
 * `extra` = more item keys shown there as well (they keep their own data tab too). Animals carries everything
 * a child needs for breeding, taming, shearing and dyeing animals.
 */
export const PICKER_TABS = Object.freeze([
  Object.freeze({ id: 'building', icon: 'bricks', tabs: ['building'], extra: [] }),
  Object.freeze({ id: 'colors', icon: 'red_wool', tabs: ['colors'], extra: [] }),
  Object.freeze({ id: 'nature', icon: 'grass_block', tabs: ['nature'], extra: [] }),
  Object.freeze({ id: 'functional', icon: 'crafting_table', tabs: ['functional'], extra: [] }),
  Object.freeze({ id: 'tools', icon: 'iron_pickaxe', tabs: ['tools', 'combat'], extra: [] }),
  Object.freeze({ id: 'food', icon: 'apple', tabs: ['food'], extra: [] }),
  Object.freeze({
    id: 'animals', icon: 'pig_spawn_egg', tabs: ['animals'],
    extra: ['wheat', 'wheat_seeds', 'carrot', 'bone', 'bone_meal', 'shears', 'bucket', 'saddle', ...COLORS.map((c) => c + '_dye')],
  }),
  Object.freeze({ id: 'materials', icon: 'diamond', tabs: ['materials'], extra: [] }),
]);

/**
 * Items shown on one picker tab, in display order. Hides creative:false items, hostile spawn eggs while
 * hostile mobs are off, and spawn eggs whose mob type is not implemented yet (hasMob(type) false).
 * @param {string} tabId PICKER_TABS id
 * @param {{hostileMobs?: boolean, hasMob?: (type: string) => boolean}} [opts]
 * @returns {object[]} item defs
 */
export function creativePickerItems(tabId, opts = {}) {
  const tab = PICKER_TABS.find((t) => t.id === tabId);
  if (!tab) return [];
  const hostile = !!opts.hostileMobs;
  const hasMob = opts.hasMob || (() => true);
  const visible = (d) => {
    if (!d || d.creative === false) return false;
    if (d.mob) {
      const m = MOBS[d.mob];
      if (!m || (m.category === 'monster' && !hostile) || !hasMob(d.mob)) return false;
    }
    return true;
  };
  const out = ITEM_LIST.filter((d) => tab.tabs.includes(d.tab) && visible(d));
  for (const k of tab.extra) { const d = ITEMS.get(k); if (visible(d) && !out.includes(d)) out.push(d); }
  return out;
}

/* ------------------------------ helpers ------------------------------ */
export function getItem(key) { return ITEMS.get(key); }
export function hasItem(key) { return ITEMS.has(key); }
export function maxStack(key) { const d = ITEMS.get(key); return d ? d.stack : 64; }
/** Every sprite name CORE-A must be able to paint (icon 'sprite:<name>'). */
export function requiredSprites() {
  const s = new Set();
  for (const d of ITEM_LIST) if (d.icon.startsWith('sprite:')) s.add(d.icon.slice(7));
  return [...s].sort();
}
/** New ItemStack. */
export function stack(item, count = 1, extra) { return extra ? { item, count, ...extra } : { item, count }; }
