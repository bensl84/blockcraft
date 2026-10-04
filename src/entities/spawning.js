// OWNER LANE: FEATURE-MOBS. Natural spawning (SPEC §2.6 "Spawning"):
//  - chunk generation: on world:columnLoaded {fresh: true} a 10% chance of a group of 2-4 animals from
//    MOBS[type].biomes (mobsForBiome), on grass with light >= 9. A `populated` set (saved in meta.systems.mobs)
//    makes sure a column is populated at most once, ever. The creature cap (24) applies.
//  - passive top-up: every 400 ticks while fewer than 24 creatures are loaded, one group in a loaded column at
//    least 24 blocks from the player.
//  - never piling up: entities park/restore with their column (entity.js). When restoring a column would push
//    the loaded creature count over the cap, untouched WILD animals (natural spawns the child never fed, sheared,
//    dyed, tamed, rode or bred) of that column are dropped instead. Pets and bred animals always come back.
//  - monsters (P1): one attempt every 20 ticks while rules.hostileMobs and not peaceful, cap 20, effective sky
//    light <= 7 and block light 0, 24+ blocks from the player; instant despawn beyond 128, random beyond 32
//    after 30 s; switching to peaceful removes them all.
// Rolls use game.rand(), except chunk-generation population: like Java's chunk population it is seeded per column
// from the world seed (hash32(seed, cx, cz)), so it is deterministic per world and never draws from game.rand while
// columns stream in during frames (spec deviation recorded in docs/handoff/mobs.md).

import { BIOMES } from '../world/worldgen.js';
import { isNetherColumn, isNetherX } from '../core/nether.js';
import { B_LIQUID, B_SOLID, ID } from '../core/registry.js';
import { MOBS, SPAWN, mobsForBiome } from '../data/mobs.js';
import { ENTITY_TYPES } from './entity.js';
import { daylightAt, effectiveSky, randInt, weightedPick } from './mob_ai.js';
import { hash32, mulberry32 } from '../core/math.js';

const PASSIVE_TOPUP_TICKS = 400;
/** Water mobs (fish, squid) have their own kid-scaled cap and never count against the land creature cap. */
export const WATER_CAP = 12;
/** Chance that a freshly generated column with deep enough water gets a school of fish or a squid. */
const WATER_CHUNK_CHANCE = 0.15;
/** Monster spawn weights (Java-like: endermen are rare, slimes only deep underground). */
const MONSTER_WEIGHTS = { zombie: 100, skeleton: 100, creeper: 100, spider: 100, enderman: 10, slime: 30 };
/** LEAD integration: the farm animals a NEW world always starts with near the spawn (one small group each). */
export const STARTER_TYPES = Object.freeze(['cow', 'sheep', 'pig', 'chicken']);
const MONSTER_TYPES = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'slime'];

/** Numeric key of a column for the populated set. */
export function columnKey(cx, cz) { return (((cx & 0xffff) << 16) | (cz & 0xffff)) >>> 0; }
/** Compact string form of a set of numeric keys (sorted, delta-encoded base 36). */
export function encodeKeys(set) {
  const a = [...set].sort((x, y) => x - y);
  let prev = 0;
  return a.map((k) => { const d = k - prev; prev = k; return d.toString(36); }).join('.');
}
export function decodeKeys(str) {
  const out = new Set();
  if (typeof str !== 'string' || !str) return out;
  let prev = 0;
  for (const p of str.split('.')) { const d = parseInt(p, 36); if (!Number.isFinite(d)) continue; prev += d; out.add(prev); }
  return out;
}

export function createSpawner(game) {
  let populated = new Set();
  let topupTimer = 0, monsterTimer = 0;
  const rand = () => game.rand();
  const isCreatureType = (t) => ENTITY_TYPES.has(t) && MOBS[t] && MOBS[t].category === 'creature' && !MOBS[t].water;

  function rules() { return (game.meta && game.meta.rules) || {}; }
  function hostileAllowed() { return !!(game.meta && rules().hostileMobs && game.meta.difficulty !== 'peaceful'); }

  function counts() {
    let creature = 0, monster = 0, water = 0;
    game.entities.forEach((e) => {
      if (e.removed || e.deathTime > 0) return;
      if (e.category === 'creature') { if (e.def && e.def.water) water++; else creature++; } else if (e.category === 'monster') monster++;
    });
    return { creature, monster, water };
  }

  /** Highest solid block at (x, z): {y (block y), id} or null. */
  function surfaceBlock(x, z) {
    const w = game.world;
    for (let y = 126; y >= 1; y--) {
      const id = w.getBlock(x, y, z);
      if (B_SOLID[id] || B_LIQUID[id]) return { y, id };
    }
    return null;
  }

  /** Can an animal of this type spawn on this surface? Grass for all; sand / snow on grass for types that list it (rabbits, foxes). */
  function groundOk(type, s, bx, bz) {
    if (s.id === ID.grass_block) return true;
    const on = MOBS[type].spawnOn;
    if (!on) return false;
    if (s.id === ID.sand) return on.includes('sand');
    if (s.id === ID.snow) return on.includes('snow') && game.world.getBlock(bx, s.y - 1, bz) === ID.grass_block;
    return false;
  }

  /**
   * One school of fish or a squid in a column with water at least 3 deep (oceans, rivers, lakes). Tropical fish only
   * in ocean / beach water. Returns how many spawned.
   */
  function spawnWaterGroup(cx, cz, reason, rand = () => game.rand()) {
    const w = game.world;
    const col = w.getColumn(cx, cz);
    if (!col || !w.isColumnLoaded(cx, cz)) return 0;
    const lx = Math.floor(rand() * 16), lz = Math.floor(rand() * 16), x = cx * 16 + lx, z = cz * 16 + lz;
    const s = surfaceBlock(x, z);
    if (!s || B_LIQUID[s.id] !== 1) return 0;
    let depth = 0;
    while (depth < 40 && B_LIQUID[w.getBlock(x, s.y - depth, z)] === 1) depth++;
    if (depth < 3) return 0;
    const biome = BIOMES[col.biomes ? col.biomes[lx + lz * 16] : 0];
    const warm = !!biome && (biome.name === 'ocean' || biome.name === 'beach');
    const weights = {};
    for (const t of ['cod', 'tropical_fish', 'squid']) {
      const d = MOBS[t];
      if (!d || !ENTITY_TYPES.has(t) || (d.warm && !warm) || depth < (d.minDepth || 3)) continue;
      weights[t] = t === 'cod' ? 45 : t === 'squid' ? 25 : 30;
    }
    if (!Object.keys(weights).length) return 0;
    const type = weightedPick(rand, weights);
    const [gmin, gmax] = MOBS[type].group || [1, 3];
    const want = randInt(rand, gmin, gmax);
    let n = 0;
    for (let i = 0; i < want * 4 && n < want; i++) {
      if (counts().water >= WATER_CAP) break;
      const bx = x + randInt(rand, -3, 3), bz = z + randInt(rand, -3, 3);
      const by = s.y - 1 - Math.floor(rand() * Math.max(1, depth - 2));
      if (B_LIQUID[w.getBlock(bx, by, bz)] !== 1 || B_LIQUID[w.getBlock(bx, by + 1, bz)] !== 1) continue;
      const e = game.mobs.spawnMob(type, bx + 0.5, by + 0.1, bz + 0.5, { wild: true, reason, rand });
      if (e) n++;
    }
    return n;
  }

  /** One group of animals in a column (chunk generation or top-up). Returns how many spawned. */
  function spawnAnimalGroup(cx, cz, reason, rand = () => game.rand()) {
    const w = game.world;
    const col = w.getColumn(cx, cz);
    if (!col || !w.isColumnLoaded(cx, cz)) return 0;
    const lx = Math.floor(rand() * 16), lz = Math.floor(rand() * 16);
    const biome = BIOMES[col.biomes ? col.biomes[lx + lz * 16] : 0];
    const types = mobsForBiome(biome ? biome.name : 'plains', isCreatureType);
    if (!types.length) return 0;
    const type = types[Math.floor(rand() * types.length)];
    const [gmin, gmax] = MOBS[type].group || [2, 4];
    const want = randInt(rand, gmin, gmax);
    let n = 0;
    for (let i = 0; i < want * 4 && n < want; i++) {
      if (counts().creature >= SPAWN.CREATURE_CAP) break;
      const bx = cx * 16 + Math.max(0, Math.min(15, lx + randInt(rand, -3, 3)));
      const bz = cz * 16 + Math.max(0, Math.min(15, lz + randInt(rand, -3, 3)));
      const s = surfaceBlock(bx, bz);
      if (!s || !groundOk(type, s, bx, bz)) continue;
      const snow = s.id === ID.snow;
      const fy = s.y + 1;
      if (B_SOLID[w.getBlock(bx, fy, bz)] || B_SOLID[w.getBlock(bx, fy + 1, bz)] || B_LIQUID[w.getBlock(bx, fy, bz)]) continue;
      const l = w.getLight(bx, fy, bz);
      if (Math.max(l >> 4, l & 15) < SPAWN.ANIMAL_MIN_LIGHT) continue;
      const e = game.mobs.spawnMob(type, bx + 0.5, snow ? s.y + 0.125 : fy, bz + 0.5, { wild: true, reason, rand });
      if (e) n++;
    }
    return n;
  }

  /**
   * One group of `type` around block (gx, gz): up to `want` animals on sky-lit grass within 3 blocks. Ignores the
   * creature cap (starter animals). Returns how many spawned.
   */
  function spawnGroupAt(gx, gz, type, want, rand, reason, extra = {}) {
    const w = game.world;
    let n = 0;
    for (let i = 0; i < want * 6 && n < want; i++) {
      const bx = gx + randInt(rand, -3, 3), bz = gz + randInt(rand, -3, 3);
      if (!w.isColumnLoaded(bx >> 4, bz >> 4)) continue;
      const s = surfaceBlock(bx, bz);
      // grass, or a thin snow layer on grass (the snowy preset)
      if (!s || !(s.id === ID.grass_block || (s.id === ID.snow && w.getBlock(bx, s.y - 1, bz) === ID.grass_block))) continue;
      const fy = s.y + 1;
      if (B_SOLID[w.getBlock(bx, fy, bz)] || B_SOLID[w.getBlock(bx, fy + 1, bz)] || B_LIQUID[w.getBlock(bx, fy, bz)]) continue;
      const e = game.mobs.spawnMob(type, bx + 0.5, s.id === ID.snow ? s.y + 0.125 : fy, bz + 0.5, { reason, rand, ...extra });
      if (e) n++;
    }
    return n;
  }

  /**
   * LEAD integration (found in the end-to-end play: the nearest animal was 75 blocks away, outside the kid world's
   * 48-block border). A NEW world gets one small group of each farm animal 10-28 blocks from the spawn, inside the
   * border, deterministic per world seed. They are not 'wild', so the cap never culls them when their column
   * reloads (like pets). Returns how many spawned.
   */
  function starterAnimals() {
    const sp = game.meta && game.meta.spawn;
    if (!sp || !rules().passiveMobs) return 0;
    const rng = mulberry32(hash32((game.meta.seed >>> 0) ^ 0x53544152, 11, 22, 33));
    const border = rules().worldBorder > 0 ? rules().worldBorder : 64;
    const maxR = Math.max(12, Math.min(28, border - 8));
    let n = 0;
    for (const type of STARTER_TYPES) {
      if (!ENTITY_TYPES.has(type)) continue;
      for (let tries = 0; tries < 8; tries++) {
        const a = rng() * Math.PI * 2, r = 10 + rng() * (maxR - 10);
        const got = spawnGroupAt(Math.floor(sp.x + Math.cos(a) * r), Math.floor(sp.z + Math.sin(a) * r), type, rng() < 0.5 ? 2 : 3, rng, 'starter');
        if (got) { n += got; break; }
      }
    }
    return n;
  }

  /** Drop untouched wild animals of a just-restored column while the loaded creature count is over the cap. */
  function cullRestored(cx, cz) {
    const c = counts();
    let n = 0;
    // land animals and water mobs each against their own cap
    for (const [over0, water] of [[c.creature - SPAWN.CREATURE_CAP, false], [c.water - WATER_CAP, true]]) {
      let over = over0;
      if (over <= 0) continue;
      const list = [];
      game.entities.forEach((e) => {
        if (e.category === 'creature' && !!(e.def && e.def.water) === water && e.data && e.data.wild && !e.data.tamed && (Math.floor(e.x) >> 4) === cx && (Math.floor(e.z) >> 4) === cz) list.push(e);
      });
      for (let i = list.length - 1; i >= 0 && over > 0; i--, over--, n++) game.entities.remove(list[i], 'cull');
    }
    return n;
  }

  function onColumnLoaded(ev) {
    if (!game.meta || !game.mobs) return;
    if (!ev.fresh) { cullRestored(ev.cx, ev.cz); return; }
    cullRestored(ev.cx, ev.cz);
    const key = columnKey(ev.cx, ev.cz);
    if (populated.has(key)) return;             // never populate a column twice (SPEC §2.6)
    populated.add(key);
    if (isNetherColumn(ev.cx)) return;          // LEAD v1.7 (FID-8): the kid-safe Nether has no mobs
    if (!rules().passiveMobs) return;
    // water mobs roll their own per-column generator, so the land animals of a seed stay exactly as before
    const wrng = mulberry32(hash32((game.meta.seed >>> 0) ^ 0x57415452, ev.cx, ev.cz, 9));
    if (wrng() < WATER_CHUNK_CHANCE && counts().water < WATER_CAP) spawnWaterGroup(ev.cx, ev.cz, 'chunkgen', wrng);
    const crng = mulberry32(hash32((game.meta.seed >>> 0) ^ 0x4d4f4253, ev.cx, ev.cz, 7));
    if (crng() >= SPAWN.CHUNKGEN_ANIMAL_CHANCE) return;
    if (counts().creature >= SPAWN.CREATURE_CAP) return;
    spawnAnimalGroup(ev.cx, ev.cz, 'chunkgen', crng);
  }

  function topUp(water = false) {
    const p = game.player, w = game.world;
    if (!p || !rules().passiveMobs) return 0;
    const cnt = counts();
    if (water ? cnt.water >= WATER_CAP : cnt.creature >= SPAWN.CREATURE_CAP) return 0;
    const cols = [];
    w.forEachColumn((c) => {
      if (!w.isColumnLoaded(c.cx, c.cz)) return;
      const dx = c.cx * 16 + 8 - p.x, dz = c.cz * 16 + 8 - p.z;
      const d = Math.hypot(dx, dz);
      if (d < SPAWN.MIN_PLAYER_DIST || d > (w.renderDistance || 6) * 16) return;
      // a world with a border (kid worlds): only inside it, where the child can reach them (LEAD integration)
      const sp = game.meta && game.meta.spawn, br = rules().worldBorder;
      if (sp && br > 0 && Math.hypot(c.cx * 16 + 8 - sp.x, c.cz * 16 + 8 - sp.z) > br - 6) return;
      cols.push(c);
    });
    if (!cols.length) return 0;
    const col = cols[Math.floor(rand() * cols.length)];
    return water ? spawnWaterGroup(col.cx, col.cz, 'natural') : spawnAnimalGroup(col.cx, col.cz, 'natural');
  }

  /** One monster spawn attempt (P1). */
  function monsterAttempt() {
    const p = game.player, w = game.world;
    if (!p || counts().monster >= SPAWN.MONSTER_CAP) return null;
    const types = MONSTER_TYPES.filter((t) => ENTITY_TYPES.has(t));
    if (!types.length) return null;
    const pickType = (y) => {
      const wts = {};
      for (const t of types) { const m = MOBS[t]; if (m.maxSpawnY !== undefined && y >= m.maxSpawnY) continue; wts[t] = MONSTER_WEIGHTS[t] || 100; }
      return weightedPick(rand, wts);
    };
    const a = rand() * Math.PI * 2, r = SPAWN.MIN_PLAYER_DIST + rand() * 24;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (!w.isColumnLoaded(x >> 4, z >> 4)) return null;
    const day = daylightAt(game.time ? game.time.dayTime : 6000);
    const top = Math.min(126, Math.floor(p.y) + 24), bottom = Math.max(1, Math.floor(p.y) - 32);
    for (let y = top; y >= bottom; y--) {
      const below = w.getBlock(x, y - 1, z);
      if (!B_SOLID[below] || B_LIQUID[below]) continue;
      if (B_SOLID[w.getBlock(x, y, z)] || B_SOLID[w.getBlock(x, y + 1, z)] || B_LIQUID[w.getBlock(x, y, z)] || B_LIQUID[w.getBlock(x, y + 1, z)]) continue;
      const l = w.getLight(x, y, z);
      if ((l & 15) > SPAWN.MONSTER_MAX_BLOCK_LIGHT || effectiveSky(l >> 4, day) > SPAWN.MONSTER_MAX_SKY_LIGHT) continue;
      if (Math.hypot(x + 0.5 - p.x, y - p.y, z + 0.5 - p.z) < SPAWN.MIN_PLAYER_DIST) return null;
      const type = pickType(y);
      // tall mobs (endermen) need a third free cell
      if (MOBS[type].h > 2 && (B_SOLID[w.getBlock(x, y + 2, z)] || B_LIQUID[w.getBlock(x, y + 2, z)])) return null;
      return game.mobs.spawnMob(type, x + 0.5, y, z + 0.5, { reason: 'natural' });
    }
    return null;
  }

  /** Remove monsters that are too far / idle, or all of them when hostiles are off. */
  function despawnMonsters(all) {
    const p = game.player;
    let n = 0;
    for (const e of game.entities.all()) {
      if (e.category !== 'monster' || e.removed) continue;
      if (all) { game.entities.remove(e, 'despawn'); n++; continue; }
      const d = p ? Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) : 0;
      if (d > SPAWN.MONSTER_DESPAWN_FAR) { game.entities.remove(e, 'despawn'); n++; continue; }
      if (d > SPAWN.MONSTER_DESPAWN_IDLE) {
        e.idleFar = (e.idleFar || 0) + 1;
        if (e.idleFar > 600 && rand() < 1 / 800) { game.entities.remove(e, 'despawn'); n++; }
      } else e.idleFar = 0;
    }
    return n;
  }

  return {
    get populated() { return populated; },
    counts, onColumnLoaded, spawnAnimalGroup, spawnWaterGroup, spawnGroupAt, starterAnimals, topUp, monsterAttempt, despawnMonsters, hostileAllowed, cullRestored,
    tick() {
      if (!game.meta) return;
      const nether = !!(game.player && isNetherX(game.player.x));   // LEAD v1.7 (FID-8): nothing spawns in the Nether
      if (++topupTimer >= PASSIVE_TOPUP_TICKS) { topupTimer = 0; if (!nether) { topUp(); topUp(true); } }
      if (hostileAllowed() && !nether) {
        if (++monsterTimer >= SPAWN.MONSTER_ATTEMPT_TICKS) { monsterTimer = 0; monsterAttempt(); }
        despawnMonsters(false);
      } else if (game.tickCount % 20 === 0 && counts().monster > 0) despawnMonsters(true);
    },
    serialize() { return encodeKeys(populated); },
    deserialize(str) { populated = decodeKeys(str); topupTimer = 0; monsterTimer = 0; },
    clear() { populated = new Set(); topupTimer = 0; monsterTimer = 0; },
  };
}
