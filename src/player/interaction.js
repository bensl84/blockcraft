// OWNER LANE: CORE-E (player/physics/input/raycast/interaction). API FROZEN (SPEC §7.4).
//
// Per-frame targeting (kid: a ray from the eye through the free cursor, unprojected with the live camera FOV and
// aspect; classic / pointer-locked: the crosshair), blocks + entities (nearer wins), highlight outline via
// renderer.setHighlight only when the target changes. Attack: entity hits (repeat every 10 ticks while held),
// creative instant break (repeat every 5 ticks), survival mining with Java break times per tick (crack stages,
// 'block:mining' / 'block:miningStop', 6-tick delay, tool wear, exhaustion). Use: preUse -> entityInteract ->
// blockUse -> itemUse -> placers / default placement (repeat every 4 ticks while held) -> kid creative "tap with an
// empty hand or a tool breaks". Every press allocates ONE action id shared by everything it causes (undo, §8.5.2).

import {
  B_HARDNESS, B_OPAQUE, B_SHAPE, B_SOLID, B_WAVE, ID, SHAPE, blockDef, blockItem, blockName, breakTicks,
  connectionState, getCollisionBoxes, getSelectionBoxes, isReplaceable, itemPlaces, rollDrops,
} from '../core/registry.js';
import { BREAK, FACE, REACH, SURVIVAL, WAVE, WORLD_HEIGHT, packBlock } from '../core/constants.js';
import { DEG, yawToFacing } from '../core/math.js';
import { hooks } from '../core/hooks.js';
import { getItem, maxStack } from '../data/items.js';
import { STATE } from '../data/blocks.js';
import { dropItem } from '../entities/item_entity.js';
import { raycast } from './raycast.js';

const ENTITY_ATTACK_REPEAT = 10;
const LIVING = new Set(['creature', 'monster']);

/** Horizontal facing (0 N, 1 E, 2 S, 3 W) of a horizontal unit normal; -1 for vertical normals. */
export function facingOfNormal(nx, ny, nz) {
  if (ny !== 0) return -1;
  if (nz < 0) return 0;
  if (nx > 0) return 1;
  if (nz > 0) return 2;
  return 3;
}

/**
 * State bits for placing block `id` against `hit` (pure; SPEC §7.4 default placement rules).
 * Returns -1 when this face cannot take the block (torch on a ceiling, ladder on a floor).
 * @param {number} id block id @param {number} baseState item placeState bits (bed colour...)
 * @param {{face:number, nx:number, ny:number, nz:number, py:number}} hit @param {number} yaw player yaw (radians)
 * @param {(x:number,y:number,z:number)=>number} [getRaw] for fence/pane connections @param {number[]} [cell] target cell
 */
export function placementState(id, baseState, hit, yaw, getRaw = null, cell = null) {
  const def = blockDef(id);
  if (!def) return -1;
  const shape = B_SHAPE[id];
  let st = baseState | 0;
  if (shape === SHAPE.TORCH) {
    if (hit.ny > 0) return st & ~7;
    if (hit.ny < 0) return -1;
    return (st & ~7) | (1 + facingOfNormal(-hit.nx, 0, -hit.nz));
  }
  if (shape === SHAPE.LADDER) {
    if (hit.ny !== 0) return -1;
    return (st & ~3) | facingOfNormal(hit.nx, 0, hit.nz);
  }
  const fracY = hit.py - Math.floor(hit.py);
  const topHalf = hit.ny < 0 || (hit.ny === 0 && fracY > 0.5);
  if (shape === SHAPE.SLAB) return (st & ~3) | (topHalf ? STATE.SLAB_TOP : 0);
  if (shape === SHAPE.STAIRS) return (st & ~7) | yawToFacing(yaw) | (topHalf ? STATE.STAIRS_UPSIDE_DOWN : 0);
  if (shape === SHAPE.FENCE || shape === SHAPE.PANE) {
    return getRaw && cell ? (st & ~STATE.CONNECT_MASK) | connectionState(getRaw, cell[0], cell[1], cell[2], id) : st;
  }
  if (shape === SHAPE.GATE) return (st & ~7) | yawToFacing(yaw + Math.PI);
  if (def.axis) {
    const axis = hit.ny !== 0 ? 0 : hit.nx !== 0 ? 1 : 2;
    return (st & ~3) | axis;
  }
  if (def.facing) return (st & ~3) | yawToFacing(yaw + Math.PI);
  if (B_WAVE[id] === WAVE.LEAVES) return st | STATE.LEAVES_PERSISTENT;
  return st;
}

/** @returns {object} Interaction system (game.interaction) */
export function createInteractionSystem(game) {
  let actionSeq = 0;
  // press state
  let attackAction = 0, useAction = 0;
  let breakCooldown = 0;           // ticks until the next block may start (creative repeat / survival delay)
  let entityCooldown = 0;
  let useRepeat = 0;
  let useRepeatPlaces = false;
  // targeting scratch (allocation-free per frame)
  const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  const hitOut = {};               // the one RayHit object ix.target points at (updated in place)
  let hlOn = false, hlX = 0, hlY = 0, hlZ = 0, hlV = -1;   // what the renderer outline currently shows

  const ix = {
    name: 'interaction',
    /** @type {import('../core/types.js').RayHit|null} current block target (updated every frame) */
    target: null,
    /** @type {{entity: object, dist: number}|null} current entity target (closer than the block) */
    targetEntity: null,
    /** survival mining progress or null: {x,y,z,id,progress 0..1,stage 0..9,ticks,totalTicks} */
    mining: null,

    init() {
      game.events.on('world:exit', () => { ix.target = null; ix.targetEntity = null; ix.mining = null; hlOn = false; });
      game.events.on('settings:changed', (e) => { if (e.key === 'controls') { stopMining(); hlV = -1; } });
    },

    /** Current reach in blocks (kid scheme 8, creative 5, survival 4.5). */
    reach() {
      if (game.input && game.input.scheme === 'kid') return REACH.KID;
      if (!game.input && game.settings.controls === 'kid') return REACH.KID;
      return game.isCreative() ? REACH.CREATIVE : REACH.SURVIVAL;
    },
    /** Entity reach: survival 3, creative or kid 5. */
    entityReach() {
      return (game.isCreative() || (game.input && game.input.scheme === 'kid')) ? REACH.ENTITY_CREATIVE : REACH.ENTITY_SURVIVAL;
    },

    /**
     * Allocate a new action id (positive int). One player use()/attack() press = one action; MECH allocates one
     * per explosion. Changes caused by another change (door second half, support breaks, fence updates) reuse
     * the causing change's `action` (from its 'block:changed' payload) - KID groups undo entries by it.
     */
    newAction() { actionSeq = actionSeq >= 0x3fffffff ? 1 : actionSeq + 1; return actionSeq; },

    /**
     * Ray used for targeting: from the eye through input.aim (NDC) - centre when pointer-locked or in the
     * classic scheme. Uses the interpolated eye and the live camera FOV/aspect (matches __game.worldToNdc).
     * @param {object} [out] @param {boolean} [render=true] interpolated (frame) or tick position
     * @returns {{ox:number,oy:number,oz:number,dx:number,dy:number,dz:number}}
     */
    getAimRay(out = {}, render = true) {
      const p = game.player, input = game.input;
      const e = p.getEyePos(EYE, render);
      out.ox = e.x; out.oy = e.y; out.oz = e.z;
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), sp = Math.sin(p.pitch), cp = Math.cos(p.pitch);
      let lx = -sy * cp, ly = sp, lz = -cy * cp;
      const centre = !input || input.scheme === 'classic' || input.pointerLocked;
      if (!centre && (input.aim.x !== 0 || input.aim.y !== 0)) {
        const cam = game.renderer && game.renderer.camera;
        const fov = cam ? cam.fov : (p.fov || game.settings.fov || 70);
        const aspect = cam && cam.aspect ? cam.aspect : (typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9);
        const t = Math.tan((fov * DEG) / 2);
        const ax = input.aim.x * t * aspect, ay = input.aim.y * t;
        // right = (cy, 0, -sy) ; up = (sy*sp, cp, cy*sp)
        lx += cy * ax + sy * sp * ay;
        ly += cp * ay;
        lz += -sy * ax + cy * sp * ay;
        const n = Math.hypot(lx, ly, lz);
        lx /= n; ly /= n; lz /= n;
      }
      out.dx = lx; out.dy = ly; out.dz = lz;
      return out;
    },

    /**
     * THE shared break routine (player, kid, mechanics, explosions, tests). SPEC §7.4:
     *  1. read the raw value AND the block entity (chest/furnace contents) before anything changes;
     *     refuse air; refuse unbreakable blocks (hardness < 0) unless by 'player'/'test' in creative at y > 0
     *  2. roll drops (opts.drops, default: survival && rules.dropItemsOnBreak) with game.rand
     *  3. world.setBlock(air, {cause: by, action})
     *  4. emit 'block:broken' {x,y,z,id,state,by,drops,blockEntity,action} (drops are informational)
     *  5. spawn the drops: dropItem() each at the cell centre - or push {stack,x,y,z} into opts.dropInto
     *     (explosions merge their drops). Nobody else spawns block drops.
     * Container contents are dropped by FEATURE-INV from the payload's blockEntity.
     * @param {{by?: string, drops?: boolean, toolDef?: object|null, action?: number, dropInto?: Array}} [opts]
     * @returns {boolean} false if nothing was there, it is unbreakable, or the column is not loaded
     */
    breakBlock(x, y, z, opts = {}) {
      const w = game.world;
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      const v = w.getRaw(x, y, z), id = v & 0xff, state = v >> 8;
      const by = opts.by || 'player';
      if (id === ID.air) return false;
      if (B_HARDNESS[id] < 0 && !(game.isCreative() && y > 0 && (by === 'player' || by === 'test'))) return false;
      const blockEntity = w.getBlockEntity(x, y, z);
      const doDrops = opts.drops ?? (!game.isCreative() && !!(game.meta && game.meta.rules.dropItemsOnBreak));
      const drops = doDrops ? rollDrops(id, state, game.rand || Math.random, opts.toolDef ?? null) : [];
      const action = opts.action || ix.newAction();
      if (!w.setBlock(x, y, z, ID.air, 0, { cause: by, action })) return false;
      game.events.emit('block:broken', { x, y, z, id, state, by, drops, blockEntity, action });
      for (const s of drops) {
        if (opts.dropInto) opts.dropInto.push({ stack: s, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
        else {
          const r = game.rand || Math.random;
          dropItem(game, s, x + 0.5, y + 0.5, z + 0.5, { vx: (r() - 0.5) * 0.1, vy: 0.1 + r() * 0.05, vz: (r() - 0.5) * 0.1 });
        }
      }
      if (by === 'player' && !game.isCreative() && game.survival && game.survival.addExhaustion) game.survival.addExhaustion(SURVIVAL.EXHAUST.BREAK);
      return true;
    },

    /**
     * THE shared place routine. The cell must be replaceable (air, water, short grass, snow layer, fire) and not
     * already hold exactly this value, and the new block's collision boxes must not overlap the player or a
     * living entity (unless force). Emits 'block:placed' {x,y,z,id,state,by,item,oldId,oldState,action}.
     * Does NOT consume items (callers do, survival only).
     * @param {{by?: string, item?: string|null, force?: boolean, action?: number}} [opts] force: skip all checks
     */
    placeBlock(x, y, z, id, state = 0, opts = {}) {
      const w = game.world;
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      if (y < 0 || y >= WORLD_HEIGHT) return false;
      const cur = w.getRaw(x, y, z);
      if (!opts.force) {
        if (!isReplaceable(cur & 0xff) || cur === packBlock(id, state)) return false;
        if (blocksBodies(x, y, z, id, state)) return false;
      }
      const by = opts.by || 'player';
      const action = opts.action || ix.newAction();
      if (!w.setBlock(x, y, z, id, state, { cause: by, action })) return false;
      game.events.emit('block:placed', { x, y, z, id, state, by, item: opts.item || null, oldId: cur & 0xff, oldState: cur >> 8, action });
      return true;
    },

    /** Perform "use" at the current target (right click / kid tap). Returns what happened or false. */
    use(action = 0, placeOnly = false) {
      if (!game.world || !game.world.isOpen) return false;
      return doUse(action || ix.newAction(), placeOnly);
    },
    /** One attack step at the current target (left click / kid hold). Returns true if something happened. */
    attack(action = 0) {
      if (!game.world || !game.world.isOpen) return false;
      return attackStep(action || ix.newAction(), true);
    },
    /** Middle click: put the targeted block's item in the hotbar (creative). */
    pickBlock() {
      const t = ix.target;
      if (!t || !game.isCreative() || !game.inventory) return false;
      const key = blockItem(t.id);
      if (!key || !getItem(key)) return false;
      const inv = game.inventory;
      for (let i = 0; i < 9; i++) { const s = inv.get(i); if (s && s.item === key) { inv.selectSlot(i); return true; } }
      inv.set(inv.selected, { item: key, count: maxStack(key) });
      return true;
    },

    tick() {
      if (game.state !== 'playing' || !game.world || !game.world.isOpen) return;
      const input = game.input;
      const p = game.player;
      if (breakCooldown > 0) breakCooldown--;
      if (entityCooldown > 0) entityCooldown--;
      if (useRepeat > 0) useRepeat--;
      if (p.dead || p.sleeping || input.isCaptured()) { stopMining(); return; }
      updateTarget(false);

      if (input.wasPressed('pick') && input.scheme === 'classic') ix.pickBlock();

      // ---- use (tap / right click). One action per press; held placement repeats every 4 ticks.
      if (input.wasPressed('use')) {
        useAction = ix.newAction();
        const r = doUse(useAction, false);
        useRepeatPlaces = r === 'place';
        useRepeat = BREAK.PLACE_REPEAT_TICKS;
      } else if (input.isDown('use') && useRepeatPlaces && useRepeat === 0) {
        const r = doUse(useAction, true);
        useRepeat = BREAK.PLACE_REPEAT_TICKS;
        void r;
      }
      if (!input.isDown('use') && !input.wasPressed('use')) useRepeatPlaces = false;

      // ---- attack (hold / left click)
      const pressed = input.wasPressed('attack'), held = input.isDown('attack') || pressed;
      if (pressed) { attackAction = ix.newAction(); entityCooldown = 0; if (game.isCreative()) breakCooldown = 0; }
      if (held) attackStep(attackAction || ix.newAction(), pressed);
      else stopMining();
    },

    frame() {
      if (game.state !== 'playing' || !game.world || !game.world.isOpen) {
        if (hlOn) setHighlight(null);
        return;
      }
      updateTarget(true);
    },
  };

  const EYE = { x: 0, y: 0, z: 0 };
  const RAY_OPTS = { out: hitOut };

  /* ------------------------------------------------------------------ targeting */
  function updateTarget(render) {
    const input = game.input, p = game.player, w = game.world;
    if (!input || !p || p.dead || p.sleeping || input.isCaptured() || (input.scheme === 'kid' && !input.aimActive && !input.pointerLocked)) {
      ix.target = null; ix.targetEntity = null;
      setHighlight(null);
      return;
    }
    ix.getAimRay(ray, render);
    const hit = raycast(w, ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, ix.reach(), RAY_OPTS);
    let ent = null;
    if (game.entities && game.entities.raycast) {
      const maxD = Math.min(ix.entityReach(), hit ? hit.dist : Infinity);
      try { ent = game.entities.raycast(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, maxD, targetableEntity); } catch { ent = null; }
    }
    if (ent && hit && ent.dist > hit.dist) ent = null;
    ix.targetEntity = ent;
    ix.target = hit;
    if (ent) setHighlight(null);
    else if (hit) {
      const v = hit.id | (hit.state << 8);
      if ((!hlOn || hit.x !== hlX || hit.y !== hlY || hit.z !== hlZ || v !== hlV) && game.renderer && game.renderer.setHighlight) {
        hlOn = true; hlX = hit.x; hlY = hit.y; hlZ = hit.z; hlV = v;
        game.renderer.setHighlight({ x: hit.x, y: hit.y, z: hit.z, id: hit.id, state: hit.state, boxes: selectionBoxes(hit.id, hit.state) });
      }
    } else setHighlight(null);
  }
  function setHighlight(v) {
    if (v === null) {
      if (!hlOn) return;
      hlOn = false;
      if (game.renderer && game.renderer.setHighlight) game.renderer.setHighlight(null);
    }
  }
  function targetableEntity(e) {
    if (!e || e.removed || e.deathTime > 0) return false;
    if (e.category === 'item' || e.category === 'projectile' || e.noTarget) return false;
    return true;
  }

  /* ------------------------------------------------------------------ helpers */
  function selectionBoxes(id, state) { return getSelectionBoxes(id, state); }
  function heldStack() { return game.inventory ? game.inventory.getSelected() : null; }
  function heldDef() { const s = heldStack(); return s ? getItem(s.item) : null; }
  function heldTool() { const d = heldDef(); return d && d.tool ? d.tool : null; }

  /** Would a block (id,state) at the cell intersect the player or a living entity? */
  function blocksBodies(x, y, z, id, state) {
    const boxes = getCollisionBoxes(id, state);
    if (!boxes.length) return false;
    const p = game.player;
    const hw = p.width / 2;
    for (const b of boxes) {
      const minX = x + b[0], minY = y + b[1], minZ = z + b[2], maxX = x + b[3], maxY = y + b[4], maxZ = z + b[5];
      if (p.x - hw < maxX && p.x + hw > minX && p.y < maxY && p.y + p.height > minY && p.z - hw < maxZ && p.z + hw > minZ) return true;
      if (game.entities && game.entities.queryBox) {
        const list = game.entities.queryBox(minX, minY, minZ, maxX, maxY, maxZ, null, (e) => LIVING.has(e.category) || e.living === true);
        if (list.length) return true;
      }
    }
    return false;
  }

  function hasSolidTop(x, y, z) {
    const v = game.world.getRaw(x, y, z), id = v & 0xff;
    if (!B_SOLID[id]) return false;
    const boxes = getCollisionBoxes(id, v >> 8);
    for (const b of boxes) if (b[4] >= 1 - 1e-6) return true;
    return false;
  }
  function isWallSupport(x, y, z) {
    const id = game.world.getRaw(x, y, z) & 0xff;
    return B_OPAQUE[id] === 1 || (B_SOLID[id] === 1 && B_SHAPE[id] === SHAPE.CUBE);
  }

  function stopMining() {
    if (ix.mining) {
      const m = ix.mining;
      ix.mining = null;
      game.events.emit('block:miningStop', { x: m.x, y: m.y, z: m.z });
    }
  }

  function ctxBase(action) {
    const inv = game.inventory;
    return {
      game, player: game.player, stack: heldStack(), slot: inv ? inv.selected : 0, hit: ix.target,
      sneaking: !!game.player.sneaking, action,
    };
  }

  /* ------------------------------------------------------------------ attack */
  function attackStep(action, pressed) {
    const p = game.player;
    const te = ix.targetEntity;
    if (te && te.entity) {
      stopMining();
      if (entityCooldown > 0 && !pressed) return false;
      entityCooldown = ENTITY_ATTACK_REPEAT;
      hitEntity(te.entity);
      return true;
    }
    const t = ix.target;
    if (!t) { stopMining(); return false; }
    if (game.isCreative()) {
      if (breakCooldown > 0) return false;
      if (t.y <= 0 && B_HARDNESS[t.id] < 0) return false;
      p.swing();
      if (ix.breakBlock(t.x, t.y, t.z, { by: 'player', action })) {
        breakCooldown = BREAK.CREATIVE_REPEAT_TICKS;
        return true;
      }
      return false;
    }
    // ---- survival mining
    if (breakCooldown > 0) { if (p.swingTicks === 0) p.swing(); return false; }
    const tool = heldTool();
    const m = ix.mining;
    if (!m || m.x !== t.x || m.y !== t.y || m.z !== t.z || m.id !== t.id) {
      stopMining();
      ix.mining = { x: t.x, y: t.y, z: t.z, id: t.id, progress: 0, stage: -1, ticks: 0, totalTicks: 0 };
    }
    const mm = ix.mining;
    const total = breakTicks(t.id, tool, { headInWater: !!p.eyeInWater, onGround: !!p.onGround });
    mm.totalTicks = total;
    if (p.swingTicks <= 2) p.swing();
    if (!Number.isFinite(total)) return false;             // unbreakable in survival
    mm.ticks++;
    mm.progress = total <= 0 ? 1 : Math.min(1, mm.progress + 1 / total);
    if (mm.progress > 1 - 1e-9) mm.progress = 1;   // float sums of 1/n never quite reach 1
    const stage = Math.min(BREAK.STAGES - 1, Math.floor(mm.progress * BREAK.STAGES));
    if (stage !== mm.stage && mm.progress < 1) {
      mm.stage = stage;
      game.events.emit('block:mining', { x: mm.x, y: mm.y, z: mm.z, id: mm.id, progress: mm.progress, stage });
    }
    if (mm.progress >= 1) {
      const hardness = B_HARDNESS[t.id];
      const ok = ix.breakBlock(t.x, t.y, t.z, { by: 'player', toolDef: tool, action });
      stopMining();
      breakCooldown = BREAK.DELAY_TICKS;
      if (ok && tool && hardness > 0 && game.inventory) game.inventory.damageSelected(1);
      return ok;
    }
    return true;
  }

  function hitEntity(e) {
    const p = game.player;
    const def = heldDef();
    const stack = heldStack();
    let damage = def && Number.isFinite(def.damage) ? def.damage : 1;
    const crit = p.vy < 0 && !p.onGround && !p.flying && !p.inWater && !p.onLadder;
    if (crit) damage *= 1.5;
    p.swing();
    const h = hooks.entityAttack.get(e.type);
    let cancelled = false;
    if (h) {
      try { cancelled = !!h({ game, player: p, stack, entity: e, damage }); } catch (err) { game.reportError(err, `entityAttack ${e.type}`); }
    }
    if (!cancelled && typeof e.hurt === 'function') {
      e.hurt(damage, { type: 'player', player: true, crit, entity: null, x: p.x, y: p.y, z: p.z, knockback: 0.4, yaw: p.yaw });
    }
    if (!game.isCreative()) {
      if (game.survival && game.survival.addExhaustion) game.survival.addExhaustion(SURVIVAL.EXHAUST.ATTACK);
      if (def && def.tool && game.inventory) game.inventory.damageSelected(def.tool.type === 'sword' ? 1 : 2);
    }
  }

  /* ------------------------------------------------------------------ use */
  function doUse(action, placeOnly) {
    const p = game.player;
    const ctx = ctxBase(action);
    const stack = ctx.stack;
    if (!placeOnly) {
      // 1. generic pre-handlers (riding dismount...)
      for (const fn of hooks.preUse) {
        try { if (fn(ctx)) { p.swing(); return 'hook'; } } catch (err) { game.reportError(err, 'preUse'); }
      }
      // 2. entity
      const te = ix.targetEntity;
      if (te && te.entity) {
        const h = hooks.entityInteract.get(te.entity.type);
        if (h) {
          let ok = false;
          try { ok = !!h({ game, player: p, stack, slot: ctx.slot, entity: te.entity, sneaking: ctx.sneaking, action }); } catch (err) { game.reportError(err, `entityInteract ${te.entity.type}`); }
          if (ok) { p.swing(); return 'entity'; }
        }
      }
      // 3. block use (unless sneaking with something in hand)
      const t = ix.target;
      if (t && !(ctx.sneaking && stack)) {
        const name = blockName(t.id);
        const h = hooks.blockUse.get(name);
        if (h) {
          let ok = false;
          try { ok = !!h(ctx); } catch (err) { game.reportError(err, `blockUse ${name}`); }
          if (ok) { p.swing(); game.events.emit('block:use', { x: t.x, y: t.y, z: t.z, id: t.id, hook: name }); return 'block'; }
        }
      }
      // 4. item use
      if (stack) {
        const h = hooks.itemUse.get(stack.item);
        if (h) {
          let ok = false;
          try { ok = !!h(ctx); } catch (err) { game.reportError(err, `itemUse ${stack.item}`); }
          if (ok) { p.swing(); return 'item'; }
        }
      }
    }
    // 5. place
    if (stack && ix.target) {
      const places = itemPlaces(stack.item);
      if (places) {
        if (tryPlace(stack, places, action)) return 'place';
        if (placeOnly) return false;
        return 'refused';
      }
    }
    if (placeOnly) return false;
    // 6. kid creative: an empty hand or a tool breaks the block instantly
    const t = ix.target;
    if (t && game.input.scheme === 'kid' && game.isCreative() && !ix.targetEntity) {
      const def = stack ? getItem(stack.item) : null;
      if (!stack || (def && def.tool)) {
        if (t.y <= 0 && B_HARDNESS[t.id] < 0) return false;
        p.swing();
        if (ix.breakBlock(t.x, t.y, t.z, { by: 'player', action })) return 'break';
      }
    }
    return false;
  }

  /** Default placement (SPEC §7.4) or a registered placer. Returns true when a block went in. */
  function tryPlace(stack, places, action) {
    const w = game.world, p = game.player, hit = ix.target;
    const id = places.id;
    const hitRaw = w.getRaw(hit.x, hit.y, hit.z);
    let cx, cy, cz;
    // slab merging (P1): the open face of the same slab, in the hit cell or the cell in front
    if (B_SHAPE[id] === SHAPE.SLAB) {
      const merged = tryMergeSlab(id, hit, hitRaw, stack, action);
      if (merged) return true;
    }
    if (isReplaceable(hitRaw & 0xff) && (hitRaw & 0xff) !== id) { cx = hit.x; cy = hit.y; cz = hit.z; }
    else { cx = hit.x + hit.nx; cy = hit.y + hit.ny; cz = hit.z + hit.nz; }
    if (cy < 0 || cy >= WORLD_HEIGHT) return false;
    if (w.isColumnLoaded && !w.isColumnLoaded(cx >> 4, cz >> 4)) return false;
    const cur = w.getRaw(cx, cy, cz);
    if (!isReplaceable(cur & 0xff)) return false;
    // the face actually used for the state rules: when we replace the hit cell (grass, snow), act as its top
    const face = (cx === hit.x && cy === hit.y && cz === hit.z) ? { face: FACE.UP, nx: 0, ny: 1, nz: 0, py: hit.y } : hit;
    const state = placementState(id, places.state, face, p.yaw, w.getRaw, [cx, cy, cz]);
    if (state < 0) return false;
    const def = blockDef(id);
    // support rules
    if (def.placeOn) {
      const below = blockName(w.getBlock(cx, cy - 1, cz));
      if (!def.placeOn.includes(below)) return false;
    } else if (def.support === 'floor' && !hasSolidTop(cx, cy - 1, cz)) return false;
    if (def.support === 'floor_or_wall') {
      if (B_SHAPE[id] === SHAPE.TORCH && (state & 7) === 0) { if (!hasSolidTop(cx, cy - 1, cz)) return false; }
      else if (B_SHAPE[id] === SHAPE.TORCH) {
        const d = ((state & 7) - 1) & 3, dx = [0, 1, 0, -1][d], dz = [-1, 0, 1, 0][d];
        if (!isWallSupport(cx + dx, cy, cz + dz)) return false;
      }
    }
    if (def.support === 'wall') {
      const f = state & 3, back = (f + 2) & 3, dx = [0, 1, 0, -1][back], dz = [-1, 0, 1, 0][back];
      if (!isWallSupport(cx + dx, cy, cz + dz)) return false;
    }
    const name = def.name;
    const placer = hooks.placers.get(name);
    let ok = false;
    if (placer) {
      const pctx = { game, player: p, stack, slot: game.inventory ? game.inventory.selected : 0, hit, x: cx, y: cy, z: cz, id, state, face: hit.face, sneaking: !!p.sneaking, action };
      try { ok = !!placer(pctx); } catch (err) { game.reportError(err, `placer ${name}`); ok = false; }
    } else {
      ok = ix.placeBlock(cx, cy, cz, id, state, { by: 'player', item: stack.item, action });
    }
    if (!ok) return false;
    p.swing();
    if (!game.isCreative() && game.inventory) game.inventory.consumeSelected(1);
    return true;
  }

  function tryMergeSlab(id, hit, hitRaw, stack, action) {
    const w = game.world;
    const check = (x, y, z, raw, wantTop) => {
      if ((raw & 0xff) !== id) return false;
      const st = raw >> 8;
      if (st & STATE.SLAB_DOUBLE) return false;
      const isTop = (st & STATE.SLAB_TOP) !== 0;
      if (isTop === wantTop) return false;   // the existing half must be the other one
      const ns = (st & ~STATE.SLAB_TOP) | STATE.SLAB_DOUBLE;
      if (blocksBodies(x, y, z, id, ns)) return false;
      if (!w.setBlock(x, y, z, id, ns, { cause: 'player', action })) return false;
      game.events.emit('block:placed', { x, y, z, id, state: ns, by: 'player', item: stack.item, oldId: id, oldState: st, action });
      game.player.swing();
      if (!game.isCreative() && game.inventory) game.inventory.consumeSelected(1);
      return true;
    };
    // clicking the open face of a slab in the hit cell: bottom slab's top face, top slab's bottom face
    const hs = hitRaw >> 8;
    if ((hitRaw & 0xff) === id && !(hs & STATE.SLAB_DOUBLE)) {
      const isTop = (hs & STATE.SLAB_TOP) !== 0;
      if ((!isTop && hit.ny > 0) || (isTop && hit.ny < 0)) return check(hit.x, hit.y, hit.z, hitRaw, !isTop);
    }
    // the cell in front already holds the other half
    const fx = hit.x + hit.nx, fy = hit.y + hit.ny, fz = hit.z + hit.nz;
    const fr = w.getRaw(fx, fy, fz);
    if ((fr & 0xff) === id) {
      const st = placementState(id, 0, hit, game.player.yaw);
      return check(fx, fy, fz, fr, (st & STATE.SLAB_TOP) !== 0);
    }
    return false;
  }

  return ix;
}
