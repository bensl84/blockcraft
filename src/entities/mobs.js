// OWNER LANE: FEATURE-MOBS (mobs + entities + survival damage). SPEC §8.1, §2.6.
// The `mobs` system: registers every mob type of src/data/mobs.js (plus `item`, `xp_orb`, `arrow`, `boat`) with
// the entity registry, the entity interactions (feed, shear, dye, milk, tame, saddle, ride) and item uses (spawn
// eggs, boat, bow), runs natural spawning (spawning.js) and keeps pets loyal (wolves defend the player).
// Public API (frozen): spawnMob(type, x, y, z, {baby, color, tamedBy, variant}) -> Entity|null, counts().
// Additive, documented in docs/handoff/mobs.md: spawnXp, useOn, hit, populatedCount, spawner, renderStats.

import { MOBS } from '../data/mobs.js';
import { getItem } from '../data/items.js';
import { registerEntityType } from './entity.js';
import { registerEntityInteract, registerItemUse, registerPreUse, hooks } from '../core/hooks.js';
import { mobTypeDef } from './mob.js';
import { ANIMAL_CLASSES } from './animals.js';
import { Arrow, MONSTER_CLASSES, fireArrow } from './monsters.js';
import { Boat, XpOrb, waterSurface } from './vehicles.js';
import { registerItemEntityType } from './item_entity.js';
import { createSpawner } from './spawning.js';
import { splitXp } from './mob_ai.js';
import { renderCacheStats } from './mob_render.js';
import { raycast } from '../player/raycast.js';
import { lookDir } from '../core/math.js';

const CLASSES = { ...ANIMAL_CLASSES, ...MONSTER_CLASSES };

/** Register every entity type this lane owns (idempotent; safe in Node tests). */
export function registerMobEntityTypes() {
  for (const type of Object.keys(MOBS)) if (CLASSES[type]) registerEntityType(type, mobTypeDef(CLASSES[type], type));
  registerItemEntityType();
  registerEntityType('xp_orb', { category: 'other', persistent: false, create: (game, x, y, z, o = {}) => new XpOrb(game, x, y, z, o) });
  registerEntityType('arrow', { category: 'projectile', persistent: false, create: (game, x, y, z, o = {}) => new Arrow(game, x, y, z, o) });
  registerEntityType('boat', { category: 'other', persistent: true, create: (game, x, y, z, o = {}) => new Boat(game, x, y, z, o) });
}

/** @returns {object} Mobs system (game.mobs) */
export function createMobsSystem(game) {
  const spawner = createSpawner(game);

  /**
   * The ray the player aims with: interaction's cursor ray (the kid free cursor or screen centre), else the look
   * direction. -> {ox, oy, oz, dx, dy, dz}
   */
  function aimRay() {
    const ix = game.interaction, out = {};
    if (ix && ix.getAimRay) { ix.getAimRay(out, false); if (Number.isFinite(out.dx)) return out; }
    const p = game.player, e = p.getEyePos({}), d = lookDir(p.yaw, p.pitch);
    return { ox: e.x, oy: e.y, oz: e.z, dx: d.x, dy: d.y, dz: d.z };
  }

  /** Spawn-egg / boat target position: on the face the player aims at, or 2.5 blocks in front in the air. */
  function placementPoint(ctx) {
    const h = ctx.hit;
    if (h) {
      if (h.ny === 1 || h.face === 2) return { x: h.x + 0.5, y: h.y + 1, z: h.z + 0.5 };
      return { x: h.x + h.nx + 0.5, y: h.y + h.ny, z: h.z + h.nz + 0.5 };
    }
    const r = aimRay();
    return { x: r.ox + r.dx * 2.5, y: r.oy + r.dy * 2.5 - 0.5, z: r.oz + r.dz * 2.5 };
  }

  function spawnEgg(type) {
    return (ctx) => {
      const def = MOBS[type];
      if (def.category === 'monster' && game.meta && game.meta.difficulty === 'peaceful') return false;
      const pt = placementPoint(ctx);
      const e = sys.spawnMob(type, pt.x, pt.y, pt.z, {});
      if (!e) return false;
      if (e.touch) e.touch();
      if (!game.isCreative() && game.inventory) game.inventory.consumeSelected(1);
      if (game.player && game.player.swing) game.player.swing();
      return true;
    };
  }

  function useBoat(ctx) {
    const p = game.player, w = game.world;
    let pt = null;
    {
      const r = aimRay();
      const hit = raycast(w, r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, game.interaction ? game.interaction.reach() : 5, { fluids: true });
      if (hit) {
        const s = waterSurface(w, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
        pt = s !== null ? { x: hit.x + 0.5, y: s - 0.1, z: hit.z + 0.5 } : { x: hit.x + hit.nx + 0.5, y: hit.y + hit.ny + (hit.ny === 1 ? 0 : 0), z: hit.z + hit.nz + 0.5 };
      }
    }
    if (!pt && ctx.hit) {
      const h = ctx.hit;
      const s = waterSurface(w, h.x + h.nx + 0.5, h.y + h.ny + 0.5, h.z + h.nz + 0.5);
      pt = s !== null ? { x: h.x + h.nx + 0.5, y: s - 0.1, z: h.z + h.nz + 0.5 } : { x: h.x + h.nx + 0.5, y: h.y + h.ny, z: h.z + h.nz + 0.5 };
    }
    if (!pt) return false;
    const b = game.entities.spawn('boat', pt.x, pt.y, pt.z, { yaw: p.yaw });
    if (!b) return false;
    if (!game.isCreative() && game.inventory) game.inventory.consumeSelected(1);
    return true;
  }

  function useBow() {
    const p = game.player, inv = game.inventory;
    const creative = game.isCreative();
    if (!creative && (!inv || inv.count('arrow') <= 0)) return false;
    if ((sys.bowCooldown || 0) > game.tickCount) return true;
    sys.bowCooldown = game.tickCount + 10;
    const r = aimRay();
    fireArrow(game, p, r.ox + r.dx * 0.4, r.oy - 0.1 + r.dy * 0.4, r.oz + r.dz * 0.4, r.dx, r.dy, r.dz, 3.0, 1, 6, true);
    if (!creative) { inv.removeItem('arrow', 1); inv.damageSelected(1); }
    if (p.swing) p.swing();
    return true;
  }

  const sys = {
    name: 'mobs',
    spawner,
    init() {
      registerMobEntityTypes();
      const interact = (ctx) => (ctx.entity && ctx.entity.interact ? !!ctx.entity.interact(ctx) : false);
      for (const type of Object.keys(CLASSES)) registerEntityInteract(type, interact);
      registerEntityInteract('boat', interact);
      for (const type of Object.keys(MOBS)) if (CLASSES[type]) registerItemUse(type + '_spawn_egg', spawnEgg(type));
      registerItemUse('oak_boat', useBoat);
      registerItemUse('bow', useBow);
      // tapping the animal (or boat) you ride gets you off (touch has no Down button while not flying)
      registerPreUse((ctx) => {
        const p = game.player, te = game.interaction && game.interaction.targetEntity;
        if (!p || !p.riding || !te || !te.entity || te.entity.id !== p.riding) return false;
        // a saddle (or food) tapped on the horse you sit on is used on it: saddling happens while riding
        if (te.entity.acceptsWhileRidden && te.entity.acceptsWhileRidden(ctx.stack)) return false;
        if (te.entity.dismount) te.entity.dismount();
        return true;
      });
      game.events.on('world:columnLoaded', (e) => { try { spawner.onColumnLoaded(e); } catch (err) { game.reportError(err, 'mobs columnLoaded'); } });
      game.events.on('world:exit', () => spawner.clear());
      // a new world starts with a few farm animals near the spawn (LEAD integration)
      game.events.on('world:ready', (e) => { if (e && e.isNew) { try { spawner.starterAnimals(); } catch (err) { game.reportError(err, 'mobs starter animals'); } } });
      const purge = () => { if (!spawner.hostileAllowed()) spawner.despawnMonsters(true); };
      game.events.on('difficulty:changed', purge);
      game.events.on('rules:changed', (e) => { if (e.key === 'hostileMobs') purge(); });
      // pets defend the player: whatever hurts the player, and monsters the player hits
      game.events.on('player:hurt', (e) => { if (e.source && e.source.entity) sys.alertPets(e.source.entity); });
      game.events.on('mob:hurt', (e) => {
        if (e.by !== 'player') return;
        const ent = game.entities.get(e.id);
        if (ent && ent.category === 'monster') sys.alertPets(ent);
      });
    },

    /**
     * Spawn a mob of `type` (key of MOBS) at feet position. opts: {baby?: boolean, color?: string (sheep),
     * tamedBy?: 'player', variant?: string, reason?: 'spawn'|'breed'|'chunkgen'|'natural'}. Returns the Entity or null.
     */
    spawnMob(type, x, y, z, opts = {}) {
      if (!MOBS[type] || !game.entities) return null;
      const o = { ...opts };
      if (o.variant && type === 'horse' && !o.coat) o.coat = o.variant;
      return game.entities.spawn(type, x, y, z, o);
    },

    /** Counts by category within the loaded area: {creature, monster}. */
    counts() { return spawner.counts(); },

    /** Experience orbs worth `amount` points (P1). */
    spawnXp(x, y, z, amount) {
      for (const v of splitXp(amount)) game.entities.spawn('xp_orb', x, y, z, { value: v, reason: 'xp' });
    },

    /** Tamed wolves within 16 blocks go after `ent`. */
    alertPets(ent) {
      const p = game.player;
      if (!p || !ent || ent === p) return;
      for (const w of game.entities.queryRadius(p.x, p.y, p.z, 16, (e) => e.type === 'wolf' && e.data && e.data.tamed)) if (w.defendAgainst) w.defendAgainst(ent);
    },

    /**
     * Test/debug: run the player "use" on a mob exactly like interaction does (hooks.entityInteract), holding
     * `item` in the selected hotbar slot when given. Returns {ok, data, health}.
     */
    useOn(idOrEntity, item = undefined, count = 1) {
      const e = typeof idOrEntity === 'number' ? game.entities.get(idOrEntity) : idOrEntity;
      if (!e) return { ok: false };
      const inv = game.inventory;
      if (item !== undefined && inv) inv.set(inv.selected, item ? { item, count: Math.min(count, getItem(item) ? getItem(item).stack : 64) } : null);
      const fn = hooks.entityInteract.get(e.type);
      const action = game.interaction && game.interaction.newAction ? game.interaction.newAction() : 0;
      const ok = fn ? !!fn({ game, player: game.player, stack: inv ? inv.getSelected() : null, slot: inv ? inv.selected : 0, entity: e, sneaking: false, action }) : false;
      return { ok, data: JSON.parse(JSON.stringify(e.data || {})), health: e.health };
    },
    /** Test/debug: hit a mob like the player's attack (default damage 1 = fist). */
    hit(idOrEntity, amount = 1) {
      const e = typeof idOrEntity === 'number' ? game.entities.get(idOrEntity) : idOrEntity;
      if (!e || !e.hurt) return false;
      return e.hurt(amount, { type: 'player', player: true, crit: false });
    },
    populatedCount() { return spawner.populated.size; },
    renderStats() { return renderCacheStats(); },

    tick() {
      if (!game.meta) return;
      spawner.tick();
      const p = game.player;
      if (p && p.riding) {
        const m = game.entities.get(p.riding);
        if (!m || m.removed || m.deathTime > 0) p.riding = null;
      }
    },
    frame() {},
    serialize() { return { v: 1, populated: spawner.serialize() }; },
    deserialize(g, d) { spawner.clear(); if (d && d.populated) spawner.deserialize(d.populated); },
  };
  return sys;
}
