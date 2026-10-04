// OWNER: LEAD (shared, frozen). Fast typed-array views of src/data/blocks.js plus the shared block geometry
// rules (collision / selection boxes), face-texture lookup, break-time and drop rules. Pure: safe in Node,
// in workers and on the main thread. docs/SPEC.md §4.2-§4.4 documents every export.

import { BLOCKS, BLOCK_BY_NAME, SHAPES } from '../data/blocks.js';
import { getItem } from '../data/items.js';
import { ANIM, BREAK, FACE, FACING_DIRS, FACING_TO_FACE, WAVE } from './constants.js';

/** Shape enum: SHAPE.CUBE === 1 etc. (index into blocks.js SHAPES). */
export const SHAPE = Object.freeze(Object.fromEntries(SHAPES.map((s, i) => [s.toUpperCase(), i])));
/** Render pass enum. */
export const PASS = Object.freeze({ OPAQUE: 0, CUTOUT: 1, TRANSLUCENT: 2, NONE: 3 });
const PASS_OF = { opaque: 0, cutout: 1, translucent: 2, none: 3 };
const LIQUID_OF = { water: 1, lava: 2 };
const WAVE_OF = { leaves: WAVE.LEAVES, plant: WAVE.PLANT, water: WAVE.WATER };
const ANIM_OF = { water: ANIM.WATER, lava: ANIM.LAVA, fire: ANIM.FIRE };

export const MAX_BLOCK_ID = 256;
const N = MAX_BLOCK_ID;
/** Per-id typed tables (index = block id 0..255). Undefined ids behave like air. */
export const B_DEFINED = new Uint8Array(N);
export const B_SHAPE = new Uint8Array(N);
export const B_PASS = new Uint8Array(N).fill(PASS.NONE);
export const B_SOLID = new Uint8Array(N);
export const B_OPAQUE = new Uint8Array(N);
export const B_EMIT = new Uint8Array(N);
export const B_FILTER = new Uint8Array(N);
export const B_HARDNESS = new Float32Array(N);
export const B_REPLACEABLE = new Uint8Array(N).fill(1);
export const B_LIQUID = new Uint8Array(N);     // 0 none, 1 water, 2 lava
export const B_WAVE = new Uint8Array(N);
export const B_ANIM = new Uint8Array(N);
export const B_GRAVITY = new Uint8Array(N);
export const B_CLIMBABLE = new Uint8Array(N);
export const B_SLIP = new Float32Array(N).fill(0.6);
export const B_STATEFUL_TEX = new Uint8Array(N); // texture depends on state (texFn / facing / axis)

/** name -> id, e.g. ID.stone === 1. */
export const ID = {};
export const AIR = 0;

for (const b of BLOCKS) {
  if (!b) continue;
  const i = b.id;
  ID[b.name] = i;
  B_DEFINED[i] = 1;
  B_SHAPE[i] = SHAPE[b.shape.toUpperCase()];
  B_PASS[i] = PASS_OF[b.pass];
  B_SOLID[i] = b.solid ? 1 : 0;
  B_OPAQUE[i] = b.opaque ? 1 : 0;
  B_EMIT[i] = b.emit;
  B_FILTER[i] = b.opaque ? 15 : b.filter;
  B_HARDNESS[i] = b.hardness;
  B_REPLACEABLE[i] = b.replaceable ? 1 : 0;
  B_LIQUID[i] = LIQUID_OF[b.liquid] || 0;
  B_WAVE[i] = WAVE_OF[b.wave] || 0;
  B_ANIM[i] = ANIM_OF[b.anim] || 0;
  B_GRAVITY[i] = b.gravity ? 1 : 0;
  B_CLIMBABLE[i] = b.climbable ? 1 : 0;
  B_SLIP[i] = b.slip;
  B_STATEFUL_TEX[i] = b.texFn || b.facing || b.axis ? 1 : 0;
}
Object.freeze(ID);

export function blockDef(id) { return BLOCKS[id & 0xff]; }
export function blockName(id) { const b = BLOCKS[id & 0xff]; return b ? b.name : 'unknown'; }
export function idOf(name) { const b = BLOCK_BY_NAME.get(name); if (!b) throw new Error(`unknown block "${name}"`); return b.id; }
export function isOpaque(id) { return B_OPAQUE[id & 0xff] === 1; }
export function isSolid(id) { return B_SOLID[id & 0xff] === 1; }
export function isReplaceable(id) { return B_REPLACEABLE[id & 0xff] === 1; }
export function isLiquid(id) { return B_LIQUID[id & 0xff] !== 0; }

/* ------------------------------------------------------------------ textures */

/** Texture key for a block face. face = FACE.* (0 east,1 west,2 up,3 down,4 south,5 north). */
export function faceTexKey(id, state, face) {
  const b = BLOCKS[id & 0xff];
  if (!b) return 'missing';
  if (b.texFn) return b.texFn(state, face);
  const t = b.tex;
  if (t == null) return 'missing';
  if (typeof t === 'string') return t;
  if (b.axis && t.end) {
    const axis = state & 3;
    const isEnd = axis === 0 ? (face === FACE.UP || face === FACE.DOWN)
      : axis === 1 ? (face === FACE.EAST || face === FACE.WEST)
        : (face === FACE.SOUTH || face === FACE.NORTH);
    return isEnd ? t.end : t.side;
  }
  if (face === FACE.UP) return t.top || t.side;
  if (face === FACE.DOWN) return t.bottom || t.top || t.side;
  if (b.facing && t.front && face === FACING_TO_FACE[state & 3]) return t.front;
  return t.side;
}

/** Every texture key CORE-A must provide (block faces + crack stages + 'missing'). Sorted. */
export const REQUIRED_TEXTURE_KEYS = (() => {
  const s = new Set(['missing']);
  for (let i = 0; i < 10; i++) s.add('crack_' + i);
  for (const b of BLOCKS) {
    if (!b) continue;
    if (b.texKeys) b.texKeys.forEach((k) => s.add(k));
    const t = b.tex;
    if (typeof t === 'string') s.add(t);
    else if (t) Object.values(t).forEach((k) => s.add(k));
  }
  return Object.freeze([...s].sort());
})();

/** Texture keys that are animated: key -> ANIM mode. Frames are consecutive layers (ANIM.FRAMES[mode]). */
export const ANIMATED_TEXTURES = Object.freeze({ water: ANIM.WATER, lava: ANIM.LAVA, fire: ANIM.FIRE });

let FACE_LAYER = null;      // Uint16Array(N*6) for state 0
let layerOfKey = null;
const statefulCache = new Map();

/**
 * Bind a TextureSet (CORE-A) so faceLayer() can return array-texture layers. Called once by main.js
 * after buildTextures(); workers call it with a {layer(key)} shim built from textureSet.index.
 * @param {{layer:(key:string)=>number}} textureSet
 */
export function bindTextures(textureSet) {
  layerOfKey = (k) => textureSet.layer(k);
  FACE_LAYER = new Uint16Array(N * 6);
  statefulCache.clear();
  for (let id = 0; id < N; id++) {
    if (!B_DEFINED[id]) continue;
    for (let f = 0; f < 6; f++) FACE_LAYER[id * 6 + f] = layerOfKey(faceTexKey(id, 0, f));
  }
}

/** Array-texture layer for a face (base layer for animated textures). Requires bindTextures() first. */
export function faceLayer(id, state, face) {
  id &= 0xff;
  if (!B_STATEFUL_TEX[id] || state === 0) return FACE_LAYER[id * 6 + face];
  const k = (id << 16) | (state << 3) | face;
  let v = statefulCache.get(k);
  if (v === undefined) { v = layerOfKey(faceTexKey(id, state, face)); statefulCache.set(k, v); }
  return v;
}
export function texturesBound() { return FACE_LAYER !== null; }

/* ------------------------------------------------------------------ boxes */
// Boxes are [minX, minY, minZ, maxX, maxY, maxZ] in block-local units (0..1, fence/gate collision goes to 1.5).
// Returned arrays are SHARED and FROZEN: never mutate them.

const P = 1 / 16;
const EMPTY = Object.freeze([]);
const FULL = Object.freeze([Object.freeze([0, 0, 0, 1, 1, 1])]);
const box = (...v) => Object.freeze(v);
const list = (...b) => Object.freeze(b);

/** Thin panel along the block edge in horizontal direction d (0 N,1 E,2 S,3 W). */
function edgePanel(d, t) {
  switch (d & 3) {
    case 0: return box(0, 0, 0, 1, 1, t);
    case 1: return box(1 - t, 0, 0, 1, 1, 1);
    case 2: return box(0, 0, 1 - t, 1, 1, 1);
    default: return box(0, 0, 0, t, 1, 1);
  }
}
/** Half-block (in x/z) on side d at y range [y0,y1]. */
function halfOn(d, y0, y1) {
  switch (d & 3) {
    case 0: return box(0, y0, 0, 1, y1, 0.5);
    case 1: return box(0.5, y0, 0, 1, y1, 1);
    case 2: return box(0, y0, 0.5, 1, y1, 1);
    default: return box(0, y0, 0, 0.5, y1, 1);
  }
}

function computeBoxes(id, state, forSelection) {
  const shape = B_SHAPE[id];
  switch (shape) {
    case SHAPE.NONE: case SHAPE.LIQUID: return EMPTY;
    case SHAPE.CUBE: return FULL;
    case SHAPE.CROSS:
      return forSelection ? list(box(3 * P, 0, 3 * P, 13 * P, 13 * P, 13 * P)) : EMPTY;
    case SHAPE.CROP:
      return forSelection ? list(box(0, 0, 0, 1, Math.max(2, ((state & 7) + 1) * 2) * P, 1)) : EMPTY;
    case SHAPE.FIRE:
      return forSelection ? list(box(0, 0, 0, 1, P, 1)) : EMPTY;
    case SHAPE.TORCH: {
      if (!forSelection) return EMPTY;
      if ((state & 7) === 0) return list(box(6 * P, 0, 6 * P, 10 * P, 10 * P, 10 * P));
      const d = ((state & 7) - 1) & 3; // wall direction
      const dx = [0, 1, 0, -1][d], dz = [-1, 0, 1, 0][d];
      const cx = 0.5 + dx * 0.34, cz = 0.5 + dz * 0.34, h = 2.5 * P;
      return list(box(cx - h, 3 * P, cz - h, cx + h, 13 * P, cz + h));
    }
    case SHAPE.SLAB: return (state & 2) ? FULL : list((state & 1) ? box(0, 0.5, 0, 1, 1, 1) : box(0, 0, 0, 1, 0.5, 1));
    case SHAPE.STAIRS: {
      const up = (state & 4) !== 0, f = state & 3;
      return up ? list(box(0, 0.5, 0, 1, 1, 1), halfOn(f, 0, 0.5)) : list(box(0, 0, 0, 1, 0.5, 1), halfOn(f, 0.5, 1));
    }
    case SHAPE.DOOR: {
      const f = state & 3, open = (state & 4) !== 0, right = (state & 16) !== 0;
      const d = open ? (right ? (f + 1) & 3 : (f + 3) & 3) : f;
      return list(edgePanel(d, 3 * P));
    }
    case SHAPE.BED: return list(box(0, 0, 0, 1, 9 * P, 1));
    case SHAPE.LADDER: return list(edgePanel(((state & 3) + 2) & 3, 3 * P));
    case SHAPE.LAYER: {
      const n = (state & 7) + 1;
      if (forSelection) return list(box(0, 0, 0, 1, n / 8, 1));
      return n > 1 ? list(box(0, 0, 0, 1, (n - 1) / 8, 1)) : EMPTY;
    }
    case SHAPE.CARPET: return list(box(0, 0, 0, 1, P, 1));
    case SHAPE.FARMLAND: return list(box(0, 0, 0, 1, 15 * P, 1));
    case SHAPE.CACTUS: return list(box(P, 0, P, 15 * P, forSelection ? 1 : 15 * P, 15 * P));
    case SHAPE.CHEST: return list(box(P, 0, P, 15 * P, 14 * P, 15 * P));
    case SHAPE.CAKE: { const b = Math.min(6, state & 7); return list(box((1 + 2 * b) * P, 0, P, 15 * P, 0.5, 15 * P)); }
    case SHAPE.FENCE: return connectedBoxes(state, 6 * P, 10 * P, forSelection ? 1 : 1.5);
    case SHAPE.PANE: return connectedBoxes(state, 7 * P, 9 * P, 1);
    case SHAPE.GATE: {
      // Gate line runs across the facing direction. Closed: 1.5-high collision (pens!). Open: walk-through.
      if (!forSelection && (state & 4)) return EMPTY;
      const h = forSelection ? 1 : 1.5;
      return list((state & 1) === 0 ? box(0, 0, 6 * P, 1, h, 10 * P) : box(6 * P, 0, 0, 10 * P, h, 1));
    }
    case SHAPE.TRAPDOOR: {
      // closed: a 3/16 hatch at the bottom (or the top, bit 3) of the cell; open: standing on its hinge edge (bits 0-1)
      if (state & 4) return list(edgePanel(state & 3, 3 * P));
      return list((state & 8) ? box(0, 13 * P, 0, 1, 1, 1) : box(0, 0, 0, 1, 3 * P, 1));
    }
    case SHAPE.LANTERN:
      // body 6x7x6 px plus a 4x2x4 cap; hanging (bit 0) lifts it 1 px and adds the 2 px hook to the ceiling
      return (state & 1)
        ? list(box(5 * P, P, 5 * P, 11 * P, 8 * P, 11 * P), box(6 * P, 8 * P, 6 * P, 10 * P, 10 * P, 10 * P), box(7 * P, 10 * P, 7 * P, 9 * P, 1, 9 * P))
        : list(box(5 * P, 0, 5 * P, 11 * P, 7 * P, 11 * P), box(6 * P, 7 * P, 6 * P, 10 * P, 9 * P, 10 * P));
    case SHAPE.POT: return list(box(5 * P, 0, 5 * P, 11 * P, 6 * P, 11 * P));
    case SHAPE.SIGN: {
      if (!forSelection) return EMPTY;
      const f = state & 3, ns = (f & 1) === 0; // the board runs along X when it faces N or S
      if (state & 4) {
        // wall sign: a 2/16 board on the edge behind the writing, 8/16 high
        const back = (f + 2) & 3;
        const t = 2 * P, y0 = 4 * P, y1 = 12 * P;
        switch (back) {
          case 0: return list(box(0, y0, 0, 1, y1, t));
          case 1: return list(box(1 - t, y0, 0, 1, y1, 1));
          case 2: return list(box(0, y0, 1 - t, 1, y1, 1));
          default: return list(box(0, y0, 0, t, y1, 1));
        }
      }
      // standing sign: a post and an 8/16 high board across the middle of the cell
      return ns ? list(box(7 * P, 0, 7 * P, 9 * P, 7 * P, 9 * P), box(0, 7 * P, 7 * P, 1, 15 * P, 9 * P))
        : list(box(7 * P, 0, 7 * P, 9 * P, 7 * P, 9 * P), box(7 * P, 7 * P, 0, 9 * P, 15 * P, 1));
    }
    case SHAPE.PORTAL:
      if (!forSelection) return EMPTY;
      return list((state & 1) ? box(6 * P, 0, 0, 10 * P, 1, 1) : box(0, 0, 6 * P, 1, 1, 10 * P));
    default: return FULL;
  }
}
/** Post (lo..hi in x/z) plus one arm per connection bit (bit d = FACING d: 0 N, 1 E, 2 S, 3 W). */
function connectedBoxes(state, lo, hi, h) {
  const out = [box(lo, 0, lo, hi, h, hi)];
  if (state & 1) out.push(box(lo, 0, 0, hi, h, lo));
  if (state & 2) out.push(box(hi, 0, lo, 1, h, hi));
  if (state & 4) out.push(box(lo, 0, hi, hi, h, 1));
  if (state & 8) out.push(box(0, 0, lo, lo, h, hi));
  return Object.freeze(out);
}

/**
 * Connection bits (STATE.CONNECT_MASK, bit d = FACING d) for a fence or glass pane at (x,y,z), from its 4
 * horizontal neighbours. Fences join fences, gates and opaque cubes; panes join panes, glass-like solid cubes
 * and opaque cubes. CORE-E calls this when placing, MECH when a neighbour changes. Pure: getRaw(x,y,z) -> raw.
 */
export function connectionState(getRaw, x, y, z, id) {
  const shape = B_SHAPE[id & 0xff];
  let bits = 0;
  for (let d = 0; d < 4; d++) {
    const nid = getRaw(x + FACING_DIRS[d][0], y, z + FACING_DIRS[d][2]) & 0xff;
    const ns = B_SHAPE[nid];
    let c = B_OPAQUE[nid] === 1;
    if (shape === SHAPE.FENCE) c = c || ns === SHAPE.FENCE || ns === SHAPE.GATE;
    else if (shape === SHAPE.PANE) c = c || ns === SHAPE.PANE || (ns === SHAPE.CUBE && B_SOLID[nid] === 1 && B_WAVE[nid] !== WAVE.LEAVES);
    else return 0;
    if (c) bits |= 1 << d;
  }
  return bits;
}

const collisionCache = new Map();
const selectionCache = new Map();
/** Collision boxes for physics (players, mobs, items). */
export function getCollisionBoxes(id, state) {
  id &= 0xff;
  if (!B_SOLID[id]) return EMPTY;
  if (B_SHAPE[id] === SHAPE.CUBE) return FULL;
  const k = (id << 8) | (state & 0xff);
  let v = collisionCache.get(k);
  if (!v) { v = computeBoxes(id, state, false); collisionCache.set(k, v); }
  return v;
}
/** Selection (raycast / outline) boxes. Liquids and air have none. */
export function getSelectionBoxes(id, state) {
  id &= 0xff;
  if (!B_DEFINED[id] || id === AIR) return EMPTY;
  if (B_SHAPE[id] === SHAPE.CUBE) return FULL;
  const k = (id << 8) | (state & 0xff);
  let v = selectionCache.get(k);
  if (!v) { v = computeBoxes(id, state, true); selectionCache.set(k, v); }
  return v;
}

/* ------------------------------------------------------------------ mining & drops */

/**
 * Can this tool harvest the block (get drops)? toolDef = items.js `tool` object or null (hand).
 */
export function canHarvest(id, toolDef) {
  const b = BLOCKS[id & 0xff];
  if (!b) return false;
  if (!b.requiresTool) return true;
  return !!toolDef && toolDef.type === b.tool && toolDef.level >= b.level;
}

/** Mining speed multiplier of a tool on a block (1 = hand). */
export function toolSpeed(id, toolDef) {
  const b = BLOCKS[id & 0xff];
  if (!b || !toolDef) return 1;
  if (toolDef.type === 'shears') {
    if (b.name.endsWith('_leaves')) return 15;
    if (b.name.endsWith('_wool')) return 5;
    return 1;
  }
  if (toolDef.type === 'sword') return (b.tool === 'hoe' || b.shape === 'cross' || b.name === 'pumpkin' || b.name === 'melon') ? 1.5 : 1;
  return toolDef.type === b.tool ? toolDef.speed : 1;
}

/**
 * Ticks needed to break a block in survival (Java formula, SPEC §2.2).
 * 0 = instant, Infinity = unbreakable.
 * @param {number} id
 * @param {object|null} toolDef  items.js tool object of the held item (null = hand)
 * @param {{headInWater?:boolean, onGround?:boolean}} [ctx]
 */
export function breakTicks(id, toolDef, ctx = {}) {
  const b = BLOCKS[id & 0xff];
  if (!b) return Infinity;
  const h = b.hardness;
  if (h < 0) return Infinity;
  if (h === 0) return 0;
  let speed = toolSpeed(id, toolDef);
  if (ctx.headInWater) speed *= 0.2;
  if (ctx.onGround === false) speed *= 0.2;
  const perTick = speed / h / (canHarvest(id, toolDef) ? BREAK.HARVEST_DIV : BREAK.NO_HARVEST_DIV);
  if (perTick >= 1) return 0;
  return Math.ceil(1 / perTick);
}

/**
 * Roll the drops for breaking (id,state) in survival. Returns ItemStack[] (possibly empty).
 * @param {number} id @param {number} state
 * @param {() => number} [rand]  random source in [0,1)
 * @param {object|null} [toolDef] held tool (null = hand); requiresTool blocks drop nothing without it
 */
export function rollDrops(id, state, rand = Math.random, toolDef = null) {
  const b = BLOCKS[id & 0xff];
  if (!b) return [];
  if (b.requiresTool && !canHarvest(id, toolDef)) return [];
  let out;
  if (b.dropFn) out = b.dropFn(state, rand);
  else if (b.drops === null) out = [];
  else if (b.drops === undefined) { const it = b.item === undefined ? b.name : b.item; out = it ? [{ item: it, count: 1 }] : []; }
  else if (typeof b.drops === 'string') out = [{ item: b.drops, count: 1 }];
  else {
    out = [];
    for (const d of b.drops) {
      if (d.chance !== undefined && rand() >= d.chance) continue;
      const min = d.min ?? 1, max = d.max ?? min;
      const count = min + Math.floor(rand() * (max - min + 1));
      if (count > 0) out.push({ item: d.item, count });
    }
  }
  return out.filter((s) => s.count > 0);
}

/** Item key that pick-block / creative uses for this block (null if none). */
export function blockItem(id) {
  const b = BLOCKS[id & 0xff];
  if (!b) return null;
  return b.item === undefined ? b.name : b.item;
}

/** Block id (and state bits) an item places, or null. */
export function itemPlaces(itemKey) {
  const it = getItem(itemKey);
  if (!it || !it.block) return null;
  return { id: idOf(it.block), state: it.placeState || 0 };
}
