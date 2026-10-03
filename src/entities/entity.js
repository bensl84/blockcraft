// OWNER: FEATURE-MOBS (foundation written by LEAD; the public API below is FROZEN - extend, don't break).
// Base Entity class + entity-type registry + EntityManager system ('entities'). SPEC §8.1.
//
// Other lanes add entity types WITHOUT editing this file:
//   registerEntityType('tnt', { create(game, x, y, z, opts) { return new PrimedTnt(...) }, persistent: false });
// and spawn with game.entities.spawn('tnt', x, y, z, { fuse: 80 }).
//
// Coordinates: x,z = centre of the hitbox footprint, y = bottom (feet). Velocity in blocks per TICK.
//
// Streaming (SPEC §8.1 "entities and streaming"): when a column unloads, its PERSISTENT entities are serialized
// into a parked list keyed by column and removed (reason 'unload'); non-persistent ones are just removed. When the
// column loads again they are rebuilt (entity:spawn reason 'load'). World saves include parked entities, and a
// loaded world parks every entity until its column is lit. So nothing piles up in memory or in the scene.

import { clamp, lerp } from '../core/math.js';
import { CHUNK_SHIFT, colKey } from '../core/constants.js';

let NEXT_ID = 1;

/**
 * @typedef {Object} EntityTypeDef
 * @property {(game: object, x: number, y: number, z: number, opts?: object) => Entity} create
 * @property {(game: object, data: object) => Entity|null} [load]   rebuild from Entity.serialize() output
 * @property {boolean} [persistent]  saved with the world (default true)
 * @property {string} [category]     'creature'|'monster'|'item'|'projectile'|'block'|'other' (spawn caps)
 */
/** @type {Map<string, EntityTypeDef>} */
export const ENTITY_TYPES = new Map();
export function registerEntityType(type, def) { ENTITY_TYPES.set(type, { persistent: true, category: 'other', ...def }); }

export class Entity {
  constructor(type, x, y, z) {
    this.id = NEXT_ID++;
    this.type = type;
    this.x = x; this.y = y; this.z = z;
    this.prevX = x; this.prevY = y; this.prevZ = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.prevYaw = 0; this.pitch = 0;
    this.headYaw = 0;                 // relative to body yaw (mobs)
    this.width = 0.6; this.height = 1.8;
    this.onGround = false; this.collidedH = false; this.collidedV = false;
    this.inWater = false; this.inLava = false;
    this.fallDistance = 0;
    this.noGravity = false;
    this.health = 1; this.maxHealth = 1;
    this.hurtTime = 0;                // ticks of red flash remaining
    this.invulnTicks = 0;
    this.deathTime = 0;               // >0 while playing the death animation
    this.age = 0;                     // ticks alive
    this.removed = false;
    this.persistent = true;
    this.category = 'other';
    /** @type {import('three').Object3D|null} scene node (added via game.renderer.addObject) */
    this.object3d = null;
    /** type-specific state (saved by serialize()) */
    this.data = {};
  }

  /** Hitbox. */
  getBox(out = {}) {
    const hw = this.width / 2;
    out.minX = this.x - hw; out.maxX = this.x + hw;
    out.minY = this.y; out.maxY = this.y + this.height;
    out.minZ = this.z - hw; out.maxZ = this.z + hw;
    return out;
  }

  /** Called every game tick (20 TPS) after prev* were saved. Override. */
  tick(game) { this.age++; }

  /**
   * Take damage. Returns true if damage was applied. Override for mobs (knockback, panic, sounds).
   * @param {number} amount half-hearts @param {{type:string, entity?:Entity, player?:boolean}} source
   */
  hurt(amount, source) {
    if (this.invulnTicks > 0 || this.deathTime > 0) return false;
    this.health -= amount;
    this.hurtTime = 10; this.invulnTicks = 10;
    if (this.health <= 0) this.die(source);
    return true;
  }

  die(source) { this.deathTime = 1; }

  /** Per-frame visual update. Default: interpolated position + yaw on object3d. */
  render(game, alpha) {
    if (!this.object3d) return;
    this.object3d.position.set(lerp(this.prevX, this.x, alpha), lerp(this.prevY, this.y, alpha), lerp(this.prevZ, this.z, alpha));
    this.object3d.rotation.y = lerpAngle(this.prevYaw, this.yaw, alpha);
  }

  /** Remove from the world at the end of this tick. */
  remove() { this.removed = true; }

  /** Free GPU resources. Default removes object3d from the scene. Override to dispose geometries/materials. */
  dispose(game) {
    if (this.object3d && game.renderer) game.renderer.removeObject(this.object3d);
    this.object3d = null;
  }

  /** JSON-safe state for saving (persistent entities only). */
  serialize() {
    return { type: this.type, x: this.x, y: this.y, z: this.z, yaw: this.yaw, health: this.health, age: this.age, data: this.data };
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** EntityManager system. game.entities === this. */
export function createEntitySystem(game) {
  /** @type {Map<number, Entity>} */
  const map = new Map();
  /** colKey -> serialized persistent entities of columns that are not loaded */
  const parked = new Map();
  const tmpBox = {};
  const keyOf = (x, z) => colKey(Math.floor(x) >> CHUNK_SHIFT, Math.floor(z) >> CHUNK_SHIFT);
  const columnLoaded = (x, z) => !game.world || !game.world.isColumnLoaded || game.world.isColumnLoaded(Math.floor(x) >> CHUNK_SHIFT, Math.floor(z) >> CHUNK_SHIFT);

  /** Serialize (if persistent) into the parked list of its column, then remove. */
  function park(e) {
    if (e.persistent && e.deathTime === 0) {
      const key = keyOf(e.x, e.z);
      let list = parked.get(key);
      if (!list) { list = []; parked.set(key, list); }
      try { list.push(e.serialize()); } catch (err) { game.reportError(err, `entity ${e.type} park`); }
    }
    sys.remove(e, 'unload');
  }
  /** Rebuild one serialized entity. Returns it (already added) or null. */
  function loadRecord(d, reason) {
    const def = ENTITY_TYPES.get(d.type);
    if (!def) return null;
    let e = null;
    try {
      e = def.load ? def.load(game, d) : def.create(game, d.x, d.y, d.z, d.data || {});
      if (e && !def.load) { e.yaw = d.yaw || 0; if (Number.isFinite(d.health)) e.health = d.health; if (Number.isFinite(d.age)) e.age = d.age; e.data = { ...e.data, ...(d.data || {}) }; }
    } catch (err) { game.reportError(err, `entity load ${d.type}`); }
    if (!e) return null;
    e.category = e.category === 'other' ? def.category : e.category;
    if (def.persistent === false) e.persistent = false;
    return sys.add(e, reason);
  }

  const sys = {
    name: 'entities',
    map,

    /** Serialized entities waiting for their column to load (read-only view; colKey -> records). */
    parked,
    /** Debug/test access to the type registry and base class (lanes import registerEntityType / Entity instead). */
    types: ENTITY_TYPES,
    EntityClass: Entity,

    init() {
      game.events.on('world:exit', () => sys.clear());
      game.events.on('world:columnUnloaded', (e) => {
        const key = colKey(e.cx, e.cz);
        for (const ent of [...map.values()]) if (keyOf(ent.x, ent.z) === key) park(ent);
      });
      game.events.on('world:columnLoaded', (e) => {
        const key = colKey(e.cx, e.cz);
        const list = parked.get(key);
        if (!list) return;
        parked.delete(key);
        for (const d of list) loadRecord(d, 'load');
      });
    },

    /**
     * Spawn a registered type. Returns the entity or null (unknown type / create returned null).
     * opts.reason ('spawn' default, 'breed', 'egg'...) is passed to 'entity:spawn'.
     */
    spawn(type, x, y, z, opts = {}) {
      const def = ENTITY_TYPES.get(type);
      if (!def) { console.warn(`[entities] unknown entity type ${type}`); return null; }
      const e = def.create(game, x, y, z, opts);
      if (!e) return null;
      e.category = e.category === 'other' ? def.category : e.category;
      if (def.persistent === false) e.persistent = false;
      return sys.add(e, opts.reason || 'spawn');
    },

    /**
     * Add an already constructed entity. Emits 'entity:spawn' {id, type, x, y, z, reason}.
     * reason: 'spawn' | 'load' (save/streaming restore - FX and AUDIO stay quiet) | 'breed' | ...
     */
    add(e, reason = 'spawn') {
      map.set(e.id, e);
      game.events.emit('entity:spawn', { id: e.id, type: e.type, x: e.x, y: e.y, z: e.z, reason });
      return e;
    },

    get(id) { return map.get(id) || null; },
    all() { return [...map.values()]; },
    ofType(type) { const out = []; for (const e of map.values()) if (e.type === type) out.push(e); return out; },
    count(filter) { let n = 0; for (const e of map.values()) if (!filter || filter(e)) n++; return n; },
    forEach(fn) { for (const e of map.values()) fn(e); },

    /** Remove now (disposes visuals). Emits 'entity:remove' {id, type, reason}. */
    remove(eOrId, reason = 'removed') {
      const e = typeof eOrId === 'number' ? map.get(eOrId) : eOrId;
      if (!e || !map.has(e.id)) return;
      map.delete(e.id);
      e.removed = true;
      try { e.dispose(game); } catch (err) { console.error(err); }
      game.events.emit('entity:remove', { id: e.id, type: e.type, reason });
    },

    /** Entities whose hitbox intersects the box (excluding `except`). */
    queryBox(minX, minY, minZ, maxX, maxY, maxZ, except = null, filter = null) {
      const out = [];
      for (const e of map.values()) {
        if (e === except || e.removed) continue;
        const b = e.getBox(tmpBox);
        if (b.minX < maxX && b.maxX > minX && b.minY < maxY && b.maxY > minY && b.minZ < maxZ && b.maxZ > minZ) {
          if (!filter || filter(e)) out.push(e);
        }
      }
      return out;
    },

    /** Entities whose feet are within r of (x,y,z). */
    queryRadius(x, y, z, r, filter = null) {
      const out = [], r2 = r * r;
      for (const e of map.values()) {
        if (e.removed) continue;
        const dx = e.x - x, dy = e.y - y, dz = e.z - z;
        if (dx * dx + dy * dy + dz * dz <= r2 && (!filter || filter(e))) out.push(e);
      }
      return out;
    },

    /**
     * Nearest entity hit by a ray (slab test against hitboxes grown by `grow`).
     * @returns {{entity: Entity, dist: number}|null}
     */
    raycast(ox, oy, oz, dx, dy, dz, maxDist, filter = null, grow = 0.1) {
      let best = null, bestT = maxDist;
      for (const e of map.values()) {
        if (e.removed || e.deathTime > 0 || (filter && !filter(e))) continue;
        const b = e.getBox(tmpBox);
        const t = rayBox(ox, oy, oz, dx, dy, dz, b.minX - grow, b.minY - grow, b.minZ - grow, b.maxX + grow, b.maxY + grow, b.maxZ + grow);
        if (t !== null && t < bestT) { bestT = t; best = e; }
      }
      return best ? { entity: best, dist: bestT } : null;
    },

    tick() {
      const world = game.world;
      for (const e of [...map.values()]) {
        if (!columnLoaded(e.x, e.z)) {
          // Column not lit yet: frozen. Column not in memory at all (moved/flung out of the loaded area): park.
          if (world && world.getColumn && !world.getColumn(Math.floor(e.x) >> CHUNK_SHIFT, Math.floor(e.z) >> CHUNK_SHIFT)) park(e);
          continue;
        }
        e.prevX = e.x; e.prevY = e.y; e.prevZ = e.z; e.prevYaw = e.yaw;
        if (e.hurtTime > 0) e.hurtTime--;
        if (e.invulnTicks > 0) e.invulnTicks--;
        try { e.tick(game); } catch (err) { game.reportError(err, `entity ${e.type}#${e.id} tick`); e.removed = true; }
      }
      for (const e of [...map.values()]) if (e.removed) sys.remove(e, 'dead');
    },

    frame(g, dt, alpha) {
      for (const e of map.values()) {
        try { e.render(game, alpha); } catch (err) { game.reportError(err, `entity ${e.type}#${e.id} render`); e.removed = true; }
      }
    },

    /** Remove every entity and forget parked ones (world exit / load). */
    clear() { for (const e of [...map.values()]) sys.remove(e, 'clear'); parked.clear(); },

    /** Loaded persistent entities + parked ones (records of unloaded columns). */
    serialize() {
      const list = [];
      for (const e of map.values()) if (e.persistent && !e.removed && e.deathTime === 0) list.push(e.serialize());
      for (const recs of parked.values()) for (const d of recs) list.push(d);
      return { v: 1, list };
    },

    /** World start: entities in lit columns load now ('load'); the rest are parked until their column loads. */
    deserialize(g, data) {
      sys.clear();
      if (!data || !Array.isArray(data.list)) return;
      for (const d of data.list) {
        if (!d || !ENTITY_TYPES.has(d.type) || !Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
        if (columnLoaded(d.x, d.z)) { loadRecord(d, 'load'); continue; }
        const key = keyOf(d.x, d.z);
        let list = parked.get(key);
        if (!list) { list = []; parked.set(key, list); }
        list.push(d);
      }
    },
  };
  return sys;
}

/** Ray vs AABB slab test. Returns entry distance t >= 0 or null. */
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [minX, minY, minZ], mx = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
    } else {
      let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return clamp(tmin, 0, Infinity);
}
