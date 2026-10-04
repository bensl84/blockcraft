// OWNER: LEAD (shared, frozen). Behaviour registries so feature lanes can add block/item/entity behaviour
// WITHOUT editing CORE-E's interaction.js. docs/SPEC.md §7.4 defines the call order.
//
// Use order when the player presses "use" (right click / kid tap):
//   1. entity under the cursor (closer than the block) -> entityInteract[type]   (tame, feed, shear, ride, dye)
//   2. block under the cursor (unless sneaking with an item) -> blockUse[blockName] (open table/chest, door, bed, cake, TNT+flint)
//   3. held item -> itemUse[itemKey]                       (eat, bucket, bone meal, hoe, spawn egg, flint & steel...)
//   4. held item places a block -> placers[blockName] if registered, else CORE-E default placement
// A handler returns true when it CONSUMED the action (stop), false to fall through.
// PLACERS are different (SPEC §7.4 step 5): true = placed. interaction then swings and, outside creative, consumes ONE
// item from the selected slot itself, so a placer never consumes the item. false = refused: nothing is placed or
// consumed, and the default placement does NOT run.
//
// Context objects (all fields always present; hit may be null). `action` is the id of this player action
// (interaction.newAction()): pass it as opts.action to every breakBlock/placeBlock/setBlock the handler does, so
// KID's undo treats the whole thing (door + its second half, bed, bucket...) as one entry (SPEC §8.5.2).
//   UseCtx    { game, player, stack, slot, hit, sneaking, action }
//             hit = RayHit from raycast(): { x,y,z, face, nx,ny,nz, id, state, dist, px,py,pz }
//   PlaceCtx  { game, player, stack, slot, hit, x,y,z (cell to place into), id, state (default state bits), face, sneaking, action }
//   EntityCtx { game, player, stack, slot, entity, sneaking, action }
//   AttackCtx { game, player, stack, entity, damage }    (entityAttack: return true to cancel default damage)

export const hooks = {
  /** @type {Map<string, (ctx: object) => boolean>} keyed by block name */
  blockUse: new Map(),
  /** @type {Map<string, (ctx: object) => boolean>} keyed by item key */
  itemUse: new Map(),
  /** @type {Map<string, (ctx: object) => boolean>} keyed by block name; custom placement (door, bed). true = placed (item consumed by interaction), false = refused */
  placers: new Map(),
  /** @type {Map<string, (ctx: object) => boolean>} keyed by entity type */
  entityInteract: new Map(),
  /** @type {Map<string, (ctx: object) => boolean>} keyed by entity type */
  entityAttack: new Map(),
  /** @type {Array<(ctx: object) => boolean>} generic "use" pre-handlers (e.g. riding dismount) run first */
  preUse: [],
};

export function registerBlockUse(blockName, fn) { hooks.blockUse.set(blockName, fn); }
export function registerItemUse(itemKey, fn) { hooks.itemUse.set(itemKey, fn); }
export function registerPlacer(blockName, fn) { hooks.placers.set(blockName, fn); }
export function registerEntityInteract(type, fn) { hooks.entityInteract.set(type, fn); }
export function registerEntityAttack(type, fn) { hooks.entityAttack.set(type, fn); }
export function registerPreUse(fn) { hooks.preUse.push(fn); }
