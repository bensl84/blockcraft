// OWNER LANE: CORE-E (player/physics/input/raycast/interaction). STUB written by LEAD - API FROZEN (SPEC §7.4).
// Replace the internals: per-frame targeting (cursor ray in kid scheme / crosshair in classic, blocks +
// entities), survival mining with Java break times and crack stages, creative instant break with repeat,
// place with repeat, hooks (core/hooks.js) for use/place/entity interaction, default placement rules
// (incl. fence/pane connection state via registry.connectionState, slab merging, persistent leaves),
// highlight outline via renderer.setHighlight, melee attack. Every player use()/attack() starts ONE action
// id (newAction) and passes it to every break/place/hook it performs (undo grouping, SPEC §8.5.2).
//
// Stub behaviour: no targeting; breakBlock/placeBlock work when called directly (used by tests/mechanics),
// with the final payloads, drop handling and bedrock rule.

import { registerStub } from '../core/stubs.js';
import { B_HARDNESS, ID, isReplaceable, rollDrops } from '../core/registry.js';
import { REACH, SURVIVAL, packBlock } from '../core/constants.js';
import { dropItem } from '../entities/item_entity.js';

registerStub('interaction');

/** @returns {object} Interaction system (game.interaction) */
export function createInteractionSystem(game) {
  let actionSeq = 0;
  const ix = {
    name: 'interaction',
    stub: true,
    /** @type {import('../core/types.js').RayHit|null} current block target (updated every frame) */
    target: null,
    /** @type {{entity: object, dist: number}|null} current entity target (closer than the block) */
    targetEntity: null,
    /** survival mining progress or null: {x,y,z,id,progress 0..1,stage 0..9,ticks,totalTicks} */
    mining: null,

    init() {},

    /** Current reach in blocks (kid scheme 8, creative 5, survival 4.5). */
    reach() {
      if (game.settings.controls === 'kid') return REACH.KID;
      return game.isCreative() ? REACH.CREATIVE : REACH.SURVIVAL;
    },

    /**
     * Allocate a new action id (positive int). One player use()/attack() press = one action; MECH allocates one
     * per explosion. Changes caused by another change (door second half, support breaks, fence updates) reuse
     * the causing change's `action` (from its 'block:changed' payload) - KID groups undo entries by it.
     */
    newAction() { actionSeq = actionSeq >= 0x3fffffff ? 1 : actionSeq + 1; return actionSeq; },

    /**
     * Ray used for targeting: from the eye through input.aim (NDC) - centre when pointer-locked.
     * @returns {{ox:number,oy:number,oz:number,dx:number,dy:number,dz:number}}
     */
    getAimRay(out = {}) {
      const e = game.player.getEyePos({}, true);
      const d = game.player.getLookDir({});
      out.ox = e.x; out.oy = e.y; out.oz = e.z; out.dx = d.x; out.dy = d.y; out.dz = d.z;
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
        else dropItem(game, s, x + 0.5, y + 0.5, z + 0.5);
      }
      if (by === 'player' && !game.isCreative() && game.survival) game.survival.addExhaustion(SURVIVAL.EXHAUST.BREAK);
      return true;
    },

    /**
     * THE shared place routine. The cell must be replaceable (air, water, short grass, snow layer, fire) and not
     * already hold exactly this value. Emits 'block:placed' {x,y,z,id,state,by,item,oldId,oldState,action}.
     * Does NOT consume items (callers do, survival only). The real version also refuses cells whose new
     * collision boxes overlap the player or a living entity (unless force).
     * @param {{by?: string, item?: string|null, force?: boolean, action?: number}} [opts] force: skip both checks
     */
    placeBlock(x, y, z, id, state = 0, opts = {}) {
      const w = game.world;
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      const cur = w.getRaw(x, y, z);
      if (!opts.force && (!isReplaceable(cur & 0xff) || cur === packBlock(id, state))) return false;
      const by = opts.by || 'player';
      const action = opts.action || ix.newAction();
      if (!w.setBlock(x, y, z, id, state, { cause: by, action })) return false;
      game.events.emit('block:placed', { x, y, z, id, state, by, item: opts.item || null, oldId: cur & 0xff, oldState: cur >> 8, action });
      return true;
    },

    /** Perform "use" at the current target (right click / kid tap). Returns true if something happened. */
    use() { return false; },
    /** Begin/continue attacking the current target (left click / kid hold). */
    attack() { return false; },
    /** Middle click: put the targeted block's item in the hotbar (creative). */
    pickBlock() { return false; },

    tick() {},
    frame() {},
  };
  return ix;
}
