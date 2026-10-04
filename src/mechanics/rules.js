// OWNER LANE: FEATURE-MECH. Pure block-behaviour predicates shared by the mechanics modules (SPEC §2.5):
// support rules (torches, plants, crops, doors, beds, ladders, carpets, snow, fire, sugar cane, cactus),
// what fluids wash away, solid tops, and small lookup tables. No game/world access: every function takes a
// getRaw(x, y, z) -> uint16 accessor, so it runs in Node unit tests.

import { BLOCKS } from '../data/blocks.js';
import {
  B_LIQUID, B_OPAQUE, B_REPLACEABLE, B_SHAPE, B_SOLID, ID, SHAPE, getCollisionBoxes,
} from '../core/registry.js';
import { FACING_DIRS } from '../core/constants.js';

export const AIR = 0;
export const WATER = 1;
export const LAVA = 2;

/** Blast resistance per id (blocks.js `blast`). Undefined ids behave like air. */
export const B_BLAST = new Float32Array(256);
/** 1 when the block has a support rule (support / placeOn / two-part blocks). */
export const B_NEEDS_SUPPORT = new Uint8Array(256);
/** 1 when flowing water/lava breaks the block (plants, crops, torches, fire, snow layers, replaceables). */
export const B_WASHABLE = new Uint8Array(256);
/** Allowed ground ids per block id (placeOn), or null. */
const PLACE_ON = new Array(256).fill(null);

for (const b of BLOCKS) {
  if (!b) continue;
  B_BLAST[b.id] = b.blast;
  const shape = B_SHAPE[b.id];
  if (b.support || b.placeOn || shape === SHAPE.DOOR || shape === SHAPE.BED || shape === SHAPE.PORTAL) B_NEEDS_SUPPORT[b.id] = 1;
  if (b.placeOn) PLACE_ON[b.id] = new Set(b.placeOn.map((n) => ID[n]));
  const washShape = shape === SHAPE.CROSS || shape === SHAPE.CROP || shape === SHAPE.TORCH || shape === SHAPE.FIRE || shape === SHAPE.LAYER;
  if (b.id !== 0 && !b.liquid && (washShape || b.replaceable)) B_WASHABLE[b.id] = 1;
}
B_WASHABLE[ID.cactus] = 0;

export const GRAVITY_IDS = new Set([ID.sand, ID.gravel]);
export const SAPLING_KIND = new Map([[ID.oak_sapling, 'oak'], [ID.birch_sapling, 'birch'], [ID.spruce_sapling, 'spruce']]);
export const CROP_IDS = new Set([ID.wheat, ID.carrots, ID.potatoes]);
export const LOG_IDS = new Set([ID.oak_log, ID.birch_log, ID.spruce_log]);
export const LEAF_IDS = new Set([ID.oak_leaves, ID.birch_leaves, ID.spruce_leaves]);
export const FLOWER_IDS = [ID.dandelion, ID.poppy, ID.cornflower, ID.orange_tulip, ID.pink_tulip, ID.allium, ID.blue_orchid, ID.lily_of_the_valley];

export const idOfRaw = (v) => v & 0xff;
export const stateOfRaw = (v) => v >>> 8;

/** Is the liquid cell value a source (level 0, not falling)? */
export function isSource(raw) { return B_LIQUID[raw & 0xff] !== 0 && (raw >>> 8) === 0; }

/** A block whose top can carry a torch, flower, door, carpet, fire or snow layer. */
export function hasSolidTop(raw) {
  const id = raw & 0xff;
  if (B_OPAQUE[id]) return true;
  if (!B_SOLID[id]) return false;
  const boxes = getCollisionBoxes(id, raw >>> 8);
  for (const b of boxes) if (b[4] >= 1 && b[0] <= 0.5 && b[3] >= 0.5 && b[2] <= 0.5 && b[5] >= 0.5) return true;
  return false;
}

/** A block whose side can hold a wall torch or a ladder (full solid cube). */
export function hasSolidSide(raw) {
  const id = raw & 0xff;
  return B_OPAQUE[id] === 1 || (B_SOLID[id] === 1 && B_SHAPE[id] === SHAPE.CUBE);
}

/** Fluids pass through / wash this cell (air, plants, torches, fire, snow layers...). */
export function fluidPassable(id) { return id === AIR || B_WASHABLE[id] === 1; }

/** The cell stops fluids (Java isBlocked): anything that is not air, a fluid or washable. */
export function blocksFluid(id) { return id !== AIR && B_LIQUID[id] === 0 && B_WASHABLE[id] === 0; }

/** Falling blocks fall into this cell (air, fluids, fire, replaceable plants). */
export function canFallThrough(id) { return id === AIR || B_LIQUID[id] !== 0 || id === ID.fire || (B_REPLACEABLE[id] === 1 && !B_SOLID[id]); }

/** Water within 1 horizontal of (x,y,z). */
export function waterNextTo(getRaw, x, y, z) {
  for (let d = 0; d < 4; d++) {
    if (B_LIQUID[getRaw(x + FACING_DIRS[d][0], y, z + FACING_DIRS[d][2]) & 0xff] === WATER) return true;
  }
  return false;
}

/**
 * Support check for the block at (x,y,z) (SPEC §2.5 "needs its support").
 * @returns {'ok'|'support'|'cascade'} 'support' = break with drops (support lost), 'cascade' = the other half of a
 *          two-part block is gone (break without an extra drop).
 */
export function supportStatus(getRaw, x, y, z) {
  const raw = getRaw(x, y, z), id = raw & 0xff, st = raw >>> 8;
  if (!B_NEEDS_SUPPORT[id]) return 'ok';
  const shape = B_SHAPE[id];
  const below = getRaw(x, y - 1, z);
  if (shape === SHAPE.DOOR) {
    if (st & 8) { // upper half: the lower half must be below
      const b = below;
      return (b & 0xff) === id && !((b >>> 8) & 8) ? 'ok' : 'cascade';
    }
    const a = getRaw(x, y + 1, z);
    if (!((a & 0xff) === id && ((a >>> 8) & 8))) return 'cascade';
    return hasSolidTop(below) ? 'ok' : 'support';
  }
  if (shape === SHAPE.BED) {
    const f = st & 3, head = (st & 4) !== 0, dir = FACING_DIRS[f];
    const sx = head ? -dir[0] : dir[0], sz = head ? -dir[2] : dir[2];
    const o = getRaw(x + sx, y, z + sz);
    return (o & 0xff) === id && ((o >>> 8) & 4) !== (st & 4) && ((o >>> 8) & 3) === f ? 'ok' : 'cascade';
  }
  if (shape === SHAPE.TORCH) {
    const s = st & 7;
    if (s === 0) return hasSolidTop(below) ? 'ok' : 'support';
    const d = FACING_DIRS[(s - 1) & 3];
    return hasSolidSide(getRaw(x + d[0], y, z + d[2])) ? 'ok' : 'support';
  }
  if (shape === SHAPE.LADDER) {
    const d = FACING_DIRS[((st & 3) + 2) & 3];
    return hasSolidSide(getRaw(x + d[0], y, z + d[2])) ? 'ok' : 'support';
  }
  // v1.7 (FID-8): a portal sheet holds while its in-plane neighbours are portal or obsidian (break the frame: it goes)
  if (shape === SHAPE.PORTAL) {
    const keep = (r) => { const i = r & 0xff; return i === id || i === ID.obsidian; };
    const zAxis = (st & 1) !== 0;
    const a = zAxis ? getRaw(x, y, z - 1) : getRaw(x - 1, y, z), c = zAxis ? getRaw(x, y, z + 1) : getRaw(x + 1, y, z);
    return keep(below) && keep(getRaw(x, y + 1, z)) && keep(a) && keep(c) ? 'ok' : 'cascade';
  }
  // v1.7: a hanging lantern needs something solid above; a wall sign the wall behind its board
  if (shape === SHAPE.LANTERN && (st & 1)) return B_SOLID[getRaw(x, y + 1, z) & 0xff] ? 'ok' : 'support';
  if (shape === SHAPE.SIGN && (st & 4)) {
    const d = FACING_DIRS[((st & 3) + 2) & 3];
    return hasSolidSide(getRaw(x + d[0], y, z + d[2])) ? 'ok' : 'support';
  }
  const bid = below & 0xff;
  if (id === ID.sugar_cane) {
    if (bid === id) return 'ok';
    if (!PLACE_ON[id].has(bid)) return 'support';
    return waterNextTo(getRaw, x, y - 1, z) ? 'ok' : 'support';
  }
  if (shape === SHAPE.CARPET) return bid !== AIR ? 'ok' : 'support';
  const allowed = PLACE_ON[id];
  if (allowed) return allowed.has(bid) ? 'ok' : 'support';
  return hasSolidTop(below) ? 'ok' : 'support';
}

/** Effective light 0..15 at a cell: max(sky darkened at night, block). raw = world.getLight value. */
export function effectiveLight(lightRaw, night) {
  const sky = Math.max(0, (lightRaw >> 4) - (night ? 11 : 0));
  return Math.max(sky, lightRaw & 15);
}
