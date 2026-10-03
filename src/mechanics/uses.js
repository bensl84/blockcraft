// OWNER LANE: FEATURE-MECH. Use / place hooks (SPEC §7.4 call order, §8.6 "Registrations", core/hooks.js):
//   blockUse: oak_door, oak_fence_gate, bed, cake, tnt (with flint and steel)
//   itemUse:  flint_and_steel, bucket, water_bucket, lava_bucket, every hoe, bone_meal
//   placers:  oak_door, bed, slabs (double slab merge, P1), snow (stacking layers, P1)
// Every handler passes ctx.action to each change it makes (KID undo groups by it) and returns true when it
// consumed the press.

import { hooks, registerBlockUse, registerItemUse, registerPlacer } from '../core/hooks.js';
import { BLOCKS, STATE } from '../data/blocks.js';
import { COLORS, FACE, FACING_DIRS } from '../core/constants.js';
import { B_LIQUID, ID, isReplaceable, itemPlaces } from '../core/registry.js';
import { yawToFacing } from '../core/math.js';
import { dropItem } from '../entities/item_entity.js';
import { AIR, LAVA, hasSolidTop, isSource, B_WASHABLE } from './rules.js';
import { rayCells } from './raycells.js';

export const HOES = ['wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe'];
export const SLABS = ['oak_slab', 'cobblestone_slab', 'stone_brick_slab'];

export function registerMechHooks(game, mech) {
  const w = () => game.world;
  const getRaw = (x, y, z) => game.world.getRaw(x, y, z);
  const creative = () => game.isCreative();
  const inv = () => game.inventory;
  const swing = () => { if (game.player && game.player.swing) game.player.swing(); };
  const sound = (name, x, y, z) => game.events.emit('sound', { name, x, y, z });
  const playerFacing = () => yawToFacing(game.player ? game.player.yaw : 0);
  const consumeOne = () => { if (!creative() && inv()) inv().consumeSelected(1); };
  const wearTool = () => { if (!creative() && inv()) inv().damageSelected(1); };

  /* ------------------------------------------------------------------ doors */
  registerPlacer('oak_door', (ctx) => {
    const { x, y, z } = ctx;
    if (y < 1 || y > 126) return true;
    if (!isReplaceable(getRaw(x, y, z) & 0xff) || !isReplaceable(getRaw(x, y + 1, z) & 0xff) || !hasSolidTop(getRaw(x, y - 1, z))) return true;
    const f = playerFacing();
    const left = FACING_DIRS[(f + 3) & 3];
    const l = getRaw(x + left[0], y, z + left[2]);
    const hinge = (l & 0xff) === ID.oak_door && ((l >>> 8) & 3) === f && !((l >>> 8) & STATE.DOOR_HINGE_RIGHT) ? STATE.DOOR_HINGE_RIGHT : 0;
    const lower = f | hinge;
    if (!game.interaction.placeBlock(x, y, z, ID.oak_door, lower, { by: 'player', item: ctx.stack ? ctx.stack.item : 'oak_door', action: ctx.action })) return true;
    w().setBlock(x, y + 1, z, ID.oak_door, lower | STATE.DOOR_UPPER, { cause: 'cascade', action: ctx.action });
    consumeOne();
    swing();
    return true;
  });

  function toggleDoor(x, y, z, action) {
    const raw = getRaw(x, y, z);
    if ((raw & 0xff) !== ID.oak_door) return false;
    const st = raw >>> 8;
    const ly = (st & STATE.DOOR_UPPER) ? y - 1 : y;
    const lower = getRaw(x, ly, z), upper = getRaw(x, ly + 1, z);
    const open = !((lower >>> 8) & STATE.DOOR_OPEN);
    if ((lower & 0xff) === ID.oak_door) w().setBlock(x, ly, z, ID.oak_door, (lower >>> 8) ^ STATE.DOOR_OPEN, { cause: 'use', action });
    if ((upper & 0xff) === ID.oak_door) w().setBlock(x, ly + 1, z, ID.oak_door, (upper >>> 8) ^ STATE.DOOR_OPEN, { cause: 'use', action });
    game.events.emit('door:toggle', { x, y: ly, z, open, kind: 'door' });
    return true;
  }

  registerBlockUse('oak_door', (ctx) => {
    if (!ctx.hit) return false;
    if (!toggleDoor(ctx.hit.x, ctx.hit.y, ctx.hit.z, ctx.action)) return false;
    swing();
    return true;
  });

  registerBlockUse('oak_fence_gate', (ctx) => {
    const h = ctx.hit;
    if (!h) return false;
    const raw = getRaw(h.x, h.y, h.z);
    if ((raw & 0xff) !== ID.oak_fence_gate) return false;
    const st = (raw >>> 8) ^ STATE.GATE_OPEN;
    w().setBlock(h.x, h.y, h.z, ID.oak_fence_gate, st, { cause: 'use', action: ctx.action });
    game.events.emit('door:toggle', { x: h.x, y: h.y, z: h.z, open: !!(st & STATE.GATE_OPEN), kind: 'gate' });
    swing();
    return true;
  });

  /* ------------------------------------------------------------------ beds */
  registerPlacer('bed', (ctx) => {
    const { x, y, z } = ctx;
    const f = playerFacing();
    const d = FACING_DIRS[f];
    const hx = x + d[0], hz = z + d[2];
    const okCell = (cx, cz) => isReplaceable(getRaw(cx, y, cz) & 0xff) && hasSolidTop(getRaw(cx, y - 1, cz));
    if (y < 1 || !okCell(x, z) || !okCell(hx, hz)) return true;
    const base = (ctx.state & 0xf0) | f;
    if (!game.interaction.placeBlock(x, y, z, ID.bed, base, { by: 'player', item: ctx.stack ? ctx.stack.item : 'red_bed', action: ctx.action })) return true;
    w().setBlock(hx, y, hz, ID.bed, base | STATE.BED_HEAD, { cause: 'cascade', action: ctx.action });
    consumeOne();
    swing();
    return true;
  });

  /** A free standing spot next to the bed (feet position), or on top of it. */
  function bedSpawnPoint(x, y, z) {
    const raw = getRaw(x, y, z), st = raw >>> 8;
    const d = FACING_DIRS[st & 3];
    const foot = (st & STATE.BED_HEAD) ? [x - d[0], z - d[2]] : [x, z];
    const head = [foot[0] + d[0], foot[1] + d[2]];
    for (const [bx, bz] of [foot, head]) {
      for (let k = 0; k < 4; k++) {
        const cx = bx + FACING_DIRS[k][0], cz = bz + FACING_DIRS[k][2];
        for (const cy of [y, y + 1, y - 1]) {
          const a = getRaw(cx, cy, cz) & 0xff, b = getRaw(cx, cy + 1, cz) & 0xff;
          if ((a === AIR || (isReplaceable(a) && !B_LIQUID[a])) && (b === AIR || (isReplaceable(b) && !B_LIQUID[b])) && hasSolidTop(getRaw(cx, cy - 1, cz))) {
            return { x: cx + 0.5, y: cy, z: cz + 0.5 };
          }
        }
      }
    }
    return { x: foot[0] + 0.5, y: y + 0.5625, z: foot[1] + 0.5 };
  }

  registerBlockUse('bed', (ctx) => {
    const h = ctx.hit;
    if (!h) return false;
    const sp = bedSpawnPoint(h.x, h.y, h.z);
    if (game.player) game.player.spawnPoint = { ...sp };
    const color = COLORS[((getRaw(h.x, h.y, h.z) >>> 8) >> STATE.BED_COLOR_SHIFT) & 15] || 'red';
    game.events.emit('player:spawnSet', { ...sp });
    game.events.emit('toast', { text: 'Spawn point set', icon: color + '_bed' });
    const r = mech.trySleep(h.x, h.y, h.z);
    if (!r.ok && r.reason === 'not_night') game.events.emit('toast', { text: 'You can sleep at night', icon: color + '_bed' });
    if (!r.ok && r.reason === 'monsters') game.events.emit('toast', { text: 'Monsters are nearby', icon: color + '_bed' });
    swing();
    return true;
  });

  /* ------------------------------------------------------------------ cake (P1) */
  registerBlockUse('cake', (ctx) => {
    const h = ctx.hit;
    if (!h) return false;
    const raw = getRaw(h.x, h.y, h.z);
    if ((raw & 0xff) !== ID.cake) return false;
    if (!creative()) {
      const p = game.player;
      if (p && p.food >= 20) return true; // full: Java refuses the bite
      if (game.survival) game.survival.addFood(2, 0.4);
    }
    sound('player.eat', h.x + 0.5, h.y + 0.5, h.z + 0.5);
    const bites = (raw >>> 8) & 7;
    if (bites >= 6) game.interaction.breakBlock(h.x, h.y, h.z, { by: 'use', drops: false, action: ctx.action });
    else w().setBlock(h.x, h.y, h.z, ID.cake, bites + 1, { cause: 'use', action: ctx.action });
    game.events.emit('mech:cake', { x: h.x, y: h.y, z: h.z, bites: bites + 1 });
    swing();
    return true;
  });

  /* ------------------------------------------------------------------ TNT + flint and steel + fire */
  registerBlockUse('tnt', (ctx) => {
    if (!ctx.hit || !ctx.stack || ctx.stack.item !== 'flint_and_steel') return false;
    if (!mech.primeTnt(ctx.hit.x, ctx.hit.y, ctx.hit.z, 80, { action: ctx.action, by: 'tnt' })) return false;
    sound('fire.ignite', ctx.hit.x + 0.5, ctx.hit.y + 0.5, ctx.hit.z + 0.5);
    wearTool();
    swing();
    return true;
  });

  registerItemUse('flint_and_steel', (ctx) => {
    const h = ctx.hit;
    if (!h) return false;
    if ((getRaw(h.x, h.y, h.z) & 0xff) === ID.tnt) return hooks.blockUse.get('tnt')(ctx);
    const x = h.x + h.nx, y = h.y + h.ny, z = h.z + h.nz;
    if (y < 1 || y > 127 || (getRaw(x, y, z) & 0xff) !== AIR || !hasSolidTop(getRaw(x, y - 1, z))) return false;
    if (!game.interaction.placeBlock(x, y, z, ID.fire, 0, { by: 'player', item: 'flint_and_steel', action: ctx.action })) return false;
    sound('fire.ignite', x + 0.5, y + 0.5, z + 0.5);
    wearTool();
    swing();
    return true;
  });

  /* ------------------------------------------------------------------ buckets */
  function aimRay() {
    const ix = game.interaction;
    const r = ix && ix.getAimRay ? ix.getAimRay({}) : null;
    const reach = ix && ix.reach ? ix.reach() : 5;
    return r ? { ...r, reach } : null;
  }

  /**
   * Swap the bucket in hand (empty <-> filled). Creative swaps too (kid-first: the bucket in hand always shows what
   * it holds, so tap water -> water bucket, tap ground -> empty bucket again), but never uses up a stack.
   */
  function swapBucket(newKey, x, y, z) {
    const I = inv();
    if (!I) return;
    const s = I.getSelected();
    if (creative() || !s || s.count <= 1) { I.replaceSelected({ item: newKey, count: 1 }); return; }
    I.consumeSelected(1);
    const left = I.add({ item: newKey, count: 1 });
    if (left > 0) dropItem(game, { item: newKey, count: left }, x + 0.5, y + 0.5, z + 0.5);
  }

  registerItemUse('bucket', (ctx) => {
    const r = aimRay();
    if (!r) return false;
    const hit = rayCells(getRaw, r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, r.reach, (raw) => {
      const id = raw & 0xff;
      if (id === AIR) return false;
      return B_LIQUID[id] ? isSource(raw) : true;
    });
    if (!hit || !isSource(hit.raw)) return false;
    const kind = B_LIQUID[hit.raw & 0xff];
    if (!w().setBlock(hit.x, hit.y, hit.z, AIR, 0, { cause: 'player', action: ctx.action })) return false;
    swapBucket(kind === LAVA ? 'lava_bucket' : 'water_bucket', hit.x, hit.y, hit.z);
    sound('bucket.fill', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    swing();
    return true;
  });

  function pour(ctx, fluidId, key) {
    const r = aimRay();
    let target = null;
    if (r) {
      const hit = rayCells(getRaw, r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, r.reach, (raw) => { const id = raw & 0xff; return id !== AIR && !B_LIQUID[id]; });
      if (hit) {
        const id = hit.raw & 0xff;
        target = (isReplaceable(id) || B_WASHABLE[id]) ? [hit.x, hit.y, hit.z] : [hit.x + hit.nx, hit.y + hit.ny, hit.z + hit.nz];
      }
    }
    if (!target && ctx.hit) target = [ctx.hit.x + ctx.hit.nx, ctx.hit.y + ctx.hit.ny, ctx.hit.z + ctx.hit.nz];
    if (!target) return false;
    const [x, y, z] = target;
    if (y < 0 || y > 127) return false;
    const cur = getRaw(x, y, z), cid = cur & 0xff;
    if (cid === fluidId && (cur >>> 8) === 0) return false;
    if (B_WASHABLE[cid] && !isReplaceable(cid)) game.interaction.breakBlock(x, y, z, { by: 'player', action: ctx.action });
    else if (!isReplaceable(cid)) return false;
    if (!game.interaction.placeBlock(x, y, z, fluidId, 0, { by: 'player', item: key, action: ctx.action, force: true })) return false;
    swapBucket('bucket', x, y, z);
    sound('bucket.empty', x + 0.5, y + 0.5, z + 0.5);
    swing();
    return true;
  }
  registerItemUse('water_bucket', (ctx) => pour(ctx, ID.water, 'water_bucket'));
  registerItemUse('lava_bucket', (ctx) => pour(ctx, ID.lava, 'lava_bucket'));

  /* ------------------------------------------------------------------ hoes */
  for (const hoe of HOES) {
    registerItemUse(hoe, (ctx) => {
      const h = ctx.hit;
      if (!h || h.face === FACE.DOWN) return false;
      const id = getRaw(h.x, h.y, h.z) & 0xff;
      if (id !== ID.grass_block && id !== ID.dirt) return false;
      if ((getRaw(h.x, h.y + 1, h.z) & 0xff) !== AIR) return false;
      if (!w().setBlock(h.x, h.y, h.z, ID.farmland, 0, { cause: 'player', action: ctx.action })) return false;
      if (game.audio && game.audio.playBlock) game.audio.playBlock('place', 'dirt', h.x + 0.5, h.y + 1, h.z + 0.5);
      game.events.emit('mech:till', { x: h.x, y: h.y, z: h.z });
      wearTool();
      swing();
      return true;
    });
  }

  /* ------------------------------------------------------------------ bone meal */
  registerItemUse('bone_meal', (ctx) => {
    const h = ctx.hit;
    if (!h) return false;
    if (!mech.applyBoneMeal(h.x, h.y, h.z, { action: ctx.action })) return false;
    consumeOne();
    swing();
    return true;
  });

  /* ------------------------------------------------------------------ slabs (double) and snow layers (P1) */
  for (const name of SLABS) {
    registerPlacer(name, (ctx) => {
      const id = ID[name];
      const h = ctx.hit;
      const merge = (x, y, z, st) => {
        if (!game.interaction.placeBlock(x, y, z, id, (st & ~STATE.SLAB_TOP) | STATE.SLAB_DOUBLE, { by: 'player', item: name, action: ctx.action, force: true })) return false;
        consumeOne(); swing();
        return true;
      };
      if (h) {
        const raw = getRaw(h.x, h.y, h.z), st = raw >>> 8;
        if ((raw & 0xff) === id && !(st & STATE.SLAB_DOUBLE)) {
          const top = (st & STATE.SLAB_TOP) !== 0;
          if ((h.face === FACE.UP && !top) || (h.face === FACE.DOWN && top)) return merge(h.x, h.y, h.z, st);
        }
      }
      const craw = getRaw(ctx.x, ctx.y, ctx.z), cst = craw >>> 8;
      if ((craw & 0xff) === id && !(cst & STATE.SLAB_DOUBLE)) {
        let newTop;
        if (ctx.face === FACE.UP) newTop = false;
        else if (ctx.face === FACE.DOWN) newTop = true;
        else newTop = h && Number.isFinite(h.py) ? (h.py - Math.floor(h.py)) > 0.5 : false;
        if (newTop !== ((cst & STATE.SLAB_TOP) !== 0)) return merge(ctx.x, ctx.y, ctx.z, cst);
        return true; // same half already there: nothing to place
      }
      return false;
    });
  }

  registerPlacer('snow', (ctx) => {
    const tryStack = (x, y, z) => {
      const raw = getRaw(x, y, z);
      if ((raw & 0xff) !== ID.snow || ((raw >>> 8) & 7) >= 7) return false;
      if (!game.interaction.placeBlock(x, y, z, ID.snow, ((raw >>> 8) & 7) + 1, { by: 'player', item: 'snow', action: ctx.action, force: true })) return false;
      consumeOne(); swing();
      return true;
    };
    if (ctx.hit && tryStack(ctx.hit.x, ctx.hit.y, ctx.hit.z)) return true;
    return tryStack(ctx.x, ctx.y, ctx.z);
  });

  /* ------------------------------------------------------------------ test / integration helper */
  /**
   * Emulate CORE-E's use() steps 3-5 against a block cell (SPEC §7.4): blockUse[block] (unless sneaking with an
   * item), then itemUse[item], then placers[block of item]. Used by MECH smoke scenarios while CORE-E's
   * targeting is a stub, and handy for KID/test tooling. Returns {consumed, by: 'block'|'item'|'placer'|null, action}.
   * opts: {item, face (FACE index, default UP), sneaking, action}
   */
  mech.useAt = (x, y, z, opts = {}) => {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    const face = opts.face ?? FACE.UP;
    const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face];
    const raw = getRaw(x, y, z);
    const hit = { x, y, z, face, nx: n[0], ny: n[1], nz: n[2], id: raw & 0xff, state: raw >>> 8, dist: 2, px: x + 0.5 + n[0] * 0.5, py: y + 0.5 + n[1] * 0.5, pz: z + 0.5 + n[2] * 0.5 };
    const stack = opts.item ? { item: opts.item, count: 1 } : (game.inventory ? game.inventory.getSelected() : null);
    const action = opts.action || game.interaction.newAction();
    const ctx = { game, player: game.player, stack, slot: game.inventory ? game.inventory.selected : 0, hit, sneaking: !!opts.sneaking, action };
    const bdef = BLOCKS[raw & 0xff];
    const bu = bdef && hooks.blockUse.get(bdef.name);
    if (bu && !(ctx.sneaking && stack) && bu(ctx)) { game.events.emit('block:use', { x, y, z, id: raw & 0xff, hook: bdef.name }); return { consumed: true, by: 'block', action }; }
    const iu = stack && hooks.itemUse.get(stack.item);
    if (iu && iu(ctx)) return { consumed: true, by: 'item', action };
    const places = stack && game.interaction && itemBlock(stack.item);
    if (places) {
      const pl = hooks.placers.get(BLOCKS[places.id].name);
      const tid = raw & 0xff;
      const tx = isReplaceable(tid) && tid !== places.id ? x : x + n[0], ty = isReplaceable(tid) && tid !== places.id ? y : y + n[1], tz = isReplaceable(tid) && tid !== places.id ? z : z + n[2];
      if (pl && pl({ ...ctx, x: tx, y: ty, z: tz, id: places.id, state: places.state, face })) return { consumed: true, by: 'placer', action };
    }
    return { consumed: false, by: null, action };
  };
}

function itemBlock(key) { try { return itemPlaces(key); } catch { return null; } }
