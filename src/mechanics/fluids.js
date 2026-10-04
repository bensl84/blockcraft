// OWNER LANE: FEATURE-MECH. Water and lava flow rules (SPEC §2.5). Pure: works on an accessor object so the
// same code runs in the game (world.setBlock / interaction.breakBlock) and in Node unit tests (a Map grid).
//
// Cell state for liquids: bits 0-2 level (0 = source, 1..7 flowing, higher = weaker), bit 3 falling.
//   Water: flows every 5 ticks, level step 1 (reaches 7 blocks on flat ground), looks 4 blocks ahead for a drop,
//          infinite source rule (a flowing cell next to >= 2 sources on a solid block or a source).
//   Lava:  flows every 30 ticks, level step 2 (reaches 3 blocks), looks 2 blocks ahead, never makes sources.
//   Lava meets water: a lava source becomes obsidian, flowing lava (level <= 4) cobblestone; lava flowing down
//   onto water turns that water into stone; lava flowing sideways into water makes cobblestone.
//
// Accessor: { get(x,y,z) -> raw uint16, set(x,y,z,id,state), wash(x,y,z) (break a washable block first) }

import { B_LIQUID, B_SOLID, ID } from '../core/registry.js';
import { AIR, LAVA, WATER, B_WASHABLE, blocksFluid } from './rules.js';

export const FLUID_PARAMS = Object.freeze({
  [WATER]: Object.freeze({ step: 1, delay: 5, slope: 4 }),
  [LAVA]: Object.freeze({ step: 2, delay: 30, slope: 2 }),
});
export const FALLING = 8;

const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
const OPP = [2, 3, 0, 1];

/** Kind of fluid at a raw value: 0 none, 1 water, 2 lava. */
export function fluidKind(raw) { return B_LIQUID[raw & 0xff]; }
/** Flow delay in ticks for a fluid block id (0 if not a fluid). */
export function fluidDelay(id) { const k = B_LIQUID[id & 0xff]; return k ? FLUID_PARAMS[k].delay : 0; }

/** Level used for spreading: falling cells count as 0 ("falling water resets the level"). */
function effLevel(st) { return (st & FALLING) ? 0 : (st & 7); }

/**
 * Lava next to water (up or sideways) hardens. Returns true when the lava cell was converted.
 */
export function lavaMix(acc, x, y, z) {
  const raw = acc.get(x, y, z);
  if (B_LIQUID[raw & 0xff] !== LAVA) return false;
  let touches = B_LIQUID[acc.get(x, y + 1, z) & 0xff] === WATER;
  for (let d = 0; d < 4 && !touches; d++) touches = B_LIQUID[acc.get(x + DX[d], y, z + DZ[d]) & 0xff] === WATER;
  if (!touches) return false;
  const st = raw >>> 8;
  // A source hardens into obsidian; ANY flowing lava (even the thin tip of a flow) into cobblestone.
  acc.set(x, y, z, st === 0 ? ID.obsidian : ID.cobblestone, 0);
  return true;
}

/** Can a fluid `id` move into a cell holding `raw` with new state level `lvl`? */
function canFlowInto(id, raw, lvl) {
  const tid = raw & 0xff;
  if (tid === AIR || B_WASHABLE[tid]) return true;
  if (tid === id) {
    const ts = raw >>> 8;
    if (ts === 0) return false;            // never overwrite a source
    if (ts & FALLING) return false;        // a falling column is fed from above
    return (ts & 7) > lvl;                 // only a weaker flow
  }
  if (B_LIQUID[tid] === WATER && B_LIQUID[id] === LAVA) return true; // lava into water -> stone / cobblestone
  return false;
}

/** Blocked for path finding: a block that stops fluid, or a source of the same fluid. */
function blockedOrSource(id, raw) {
  const tid = raw & 0xff;
  if (blocksFluid(tid)) return true;
  if (tid === id && (raw >>> 8) === 0) return true;
  if (B_LIQUID[tid] && tid !== id) return true;
  return false;
}

function dropCost(acc, id, x, y, z, depth, from, slope) {
  let best = 1000;
  for (let d = 0; d < 4; d++) {
    if (d === from) continue;
    const nx = x + DX[d], nz = z + DZ[d];
    if (blockedOrSource(id, acc.get(nx, y, nz))) continue;
    if (!blocksFluid(acc.get(nx, y - 1, nz) & 0xff)) return depth;
    if (depth < slope) {
      const c = dropCost(acc, id, nx, y, nz, depth + 1, OPP[d], slope);
      if (c < best) best = c;
    }
  }
  return best;
}

/**
 * Directions (0 N, 1 E, 2 S, 3 W) the fluid at (x,y,z) spreads to: the ones with the shortest path to a drop
 * within `slope` blocks, or every open direction when there is no drop nearby.
 */
export function flowDirections(acc, id, x, y, z, slope, out = []) {
  out.length = 0;
  const cost = [1000, 1000, 1000, 1000];
  let min = 1000;
  for (let d = 0; d < 4; d++) {
    const nx = x + DX[d], nz = z + DZ[d];
    if (blockedOrSource(id, acc.get(nx, y, nz))) continue;
    cost[d] = !blocksFluid(acc.get(nx, y - 1, nz) & 0xff) ? 0 : dropCost(acc, id, nx, y, nz, 1, OPP[d], slope);
    if (cost[d] < min) min = cost[d];
  }
  for (let d = 0; d < 4; d++) if (cost[d] === min) out.push(d);
  return out;
}

const DIRS_TMP = [];

/**
 * One flow update of the fluid at (x,y,z). Recomputes its level from its neighbours (decay when cut off,
 * falling when fed from above, infinite water sources), then flows down, or sideways when it rests on a block.
 * @returns {boolean} true when anything changed
 */
export function fluidTick(acc, x, y, z) {
  let raw = acc.get(x, y, z);
  const id = raw & 0xff, kind = B_LIQUID[id];
  if (!kind) return false;
  const P = FLUID_PARAMS[kind];
  if (kind === LAVA && lavaMix(acc, x, y, z)) return true;
  let st = raw >>> 8;
  let changed = false;
  if (st !== 0) {
    let ns;
    if ((acc.get(x, y + 1, z) & 0xff) === id) ns = FALLING;
    else {
      let minL = 99, sources = 0;
      for (let d = 0; d < 4; d++) {
        const n = acc.get(x + DX[d], y, z + DZ[d]);
        if ((n & 0xff) !== id) continue;
        const nst = n >>> 8;
        if (nst === 0) sources++;
        const l = effLevel(nst);
        if (l < minL) minL = l;
      }
      let lvl = minL + P.step;
      if (kind === WATER && sources >= 2) {
        const b = acc.get(x, y - 1, z), bid = b & 0xff;
        if (B_SOLID[bid] || (bid === id && (b >>> 8) === 0)) lvl = 0;
      }
      ns = lvl > 7 ? -1 : lvl;
    }
    if (ns !== st) {
      if (ns < 0) { acc.set(x, y, z, AIR, 0); return true; }
      acc.set(x, y, z, id, ns);
      st = ns; changed = true;
    }
  }
  // down
  if (y > 0) {
    const b = acc.get(x, y - 1, z), bid = b & 0xff;
    if (bid === AIR || B_WASHABLE[bid] || (kind === LAVA && B_LIQUID[bid] === WATER)) {
      if (kind === LAVA && B_LIQUID[bid] === WATER) { acc.set(x, y - 1, z, ID.stone, 0); return true; }
      if (B_WASHABLE[bid]) acc.wash(x, y - 1, z, id);
      acc.set(x, y - 1, z, id, FALLING);
      return true;
    }
    // resting on the same flowing fluid: no sideways spread (unless this is a source)
    if (st !== 0 && !blocksFluid(bid)) return changed;
  }
  const side = (st & FALLING) ? P.step : (st & 7) + P.step;
  if (side > 7) return changed;
  const dirs = flowDirections(acc, id, x, y, z, P.slope, DIRS_TMP);
  for (const d of dirs) {
    const nx = x + DX[d], nz = z + DZ[d];
    const n = acc.get(nx, y, nz);
    if (!canFlowInto(id, n, side)) continue;
    const nid = n & 0xff;
    if (kind === LAVA && B_LIQUID[nid] === WATER) { acc.set(nx, y, nz, ID.cobblestone, 0); changed = true; continue; }
    if (B_WASHABLE[nid]) acc.wash(nx, y, nz, id);
    acc.set(nx, y, nz, id, side);
    changed = true;
  }
  return changed;
}

/**
 * Horizontal flow vector at a fluid cell (for pushing entities ~0.014 b/t toward the flow). Writes {x, z}
 * normalised (0,0 when still).
 */
export function flowVector(getRaw, x, y, z, out = { x: 0, z: 0 }) {
  out.x = 0; out.z = 0;
  const raw = getRaw(x, y, z), id = raw & 0xff;
  if (!B_LIQUID[id]) return out;
  const here = effLevel(raw >>> 8);
  for (let d = 0; d < 4; d++) {
    const n = getRaw(x + DX[d], y, z + DZ[d]), nid = n & 0xff;
    let diff = 0;
    if (nid === id) diff = effLevel(n >>> 8) - here;
    else if (!blocksFluid(nid) && y > 0 && (getRaw(x + DX[d], y - 1, z + DZ[d]) & 0xff) === id) diff = 8 - here; // edge of a fall
    else continue;
    out.x += DX[d] * diff; out.z += DZ[d] * diff;
  }
  const len = Math.hypot(out.x, out.z);
  if (len > 1e-6) { out.x /= len; out.z /= len; }
  return out;
}

