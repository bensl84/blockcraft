// OWNER LANE: CORE-B (worldgen). Unit tests for src/world/worldgen.js, gen_*.js and noise.js (SPEC §5.2, §13.2).
import test from 'node:test';
import assert from 'node:assert/strict';

import { COLUMN_VOLUME, SEA_LEVEL, FLAT_SURFACE_Y, colIndex } from '../src/core/constants.js';
import { ID, B_DEFINED, B_OPAQUE } from '../src/core/registry.js';
import { hashString, mulberry32 } from '../src/core/math.js';
import { isStub } from '../src/core/stubs.js';
import { BIOMES, BIOME_BY_NAME, generateColumn, getTerrainHeight, getBiomeAt, findSpawn, placeTree } from '../src/world/worldgen.js';
import { createNoise, fbm2 } from '../src/world/noise.js';
import { MOBS } from '../src/data/mobs.js';

const mk = () => ({ blocks: new Uint16Array(COLUMN_VOLUME), biomes: new Uint8Array(256) });
const gen = (seed, cx, cz, preset = 'default') => generateColumn(seed, cx, cz, preset, mk());
const idAt = (col, lx, y, lz) => col.blocks[colIndex(lx, y, lz)] & 0xff;
const LEAVES = new Set([ID.oak_leaves, ID.birch_leaves, ID.spruce_leaves]);
const LOGS = new Set([ID.oak_log, ID.birch_log, ID.spruce_log]);

/** A region of generated columns with world-coordinate access. */
function region(seed, cx0, cz0, n, preset = 'default') {
  const cols = new Map();
  for (let cz = cz0; cz < cz0 + n; cz++) for (let cx = cx0; cx < cx0 + n; cx++) cols.set(cx + ',' + cz, gen(seed, cx, cz, preset));
  return {
    x0: cx0 * 16, z0: cz0 * 16, x1: (cx0 + n) * 16 - 1, z1: (cz0 + n) * 16 - 1, cols,
    get(x, y, z) {
      if (y < 0 || y > 127) return 0;
      const c = cols.get((x >> 4) + ',' + (z >> 4));
      return c ? c.blocks[colIndex(x & 15, y, z & 15)] & 0xff : -1;
    },
    biome(x, z) { const c = cols.get((x >> 4) + ',' + (z >> 4)); return c ? c.biomes[(x & 15) + (z & 15) * 16] : -1; },
  };
}

test('coreb: stubs removed for worldgen and noise', () => {
  assert.equal(isStub('worldgen'), false);
  assert.equal(isStub('noise'), false);
});

test('coreb noise: seeded, deterministic, in range', () => {
  const a = createNoise(7), b = createNoise(7), c = createNoise(8);
  let diff = 0, mn = 1, mx = -1;
  for (let i = 0; i < 5000; i++) {
    const x = i * 0.137, y = i * 0.0713 - 20, z = (i % 97) * 0.31;
    assert.equal(a.noise2(x, y), b.noise2(x, y));
    assert.equal(a.noise3(x, y, z), b.noise3(x, y, z));
    const v = a.noise2(x, y), w = a.noise3(x, y, z);
    mn = Math.min(mn, v, w); mx = Math.max(mx, v, w);
    if (v !== c.noise2(x, y)) diff++;
  }
  assert.ok(mn >= -1 && mx <= 1, `range ${mn}..${mx}`);
  assert.ok(mn < -0.6 && mx > 0.6, `uses the range (${mn}..${mx})`);
  assert.ok(diff > 4900, 'different seeds give different noise');
  const f = fbm2(a.noise2, 3.3, -1.2, 5);
  assert.ok(f >= -1 && f <= 1);
});

test('coreb biomes: save-stable ids, names used by data/mobs.js exist', () => {
  assert.deepEqual(BIOMES.map((b) => b.name), ['plains', 'forest', 'desert', 'snowy', 'birch_forest', 'taiga', 'beach', 'ocean', 'mountains']);
  BIOMES.forEach((b, i) => assert.equal(b.id, i));
  for (const m of Object.values(MOBS)) for (const n of m.biomes || []) assert.ok(n in BIOME_BY_NAME, `mob biome ${n}`);
  for (const b of BIOMES) for (const f of b.flowers) assert.ok(ID[f] !== undefined, `flower ${f}`);
});

test('coreb determinism over 100 columns (order and cache independent), every preset', () => {
  for (const preset of ['default', 'snowy', 'islands', 'flat']) {
    const first = [];
    for (let i = 0; i < 100; i++) first.push(hashString(Buffer.from(gen(12345, (i % 10) - 5, Math.floor(i / 10) - 5, preset).blocks.buffer).toString('latin1')));
    // other seeds in between to churn any caches, then reverse order
    gen(999, 3, 3, preset); gen(1, -40, 7, preset);
    for (let i = 99; i >= 0; i--) {
      const col = gen(12345, (i % 10) - 5, Math.floor(i / 10) - 5, preset);
      assert.equal(hashString(Buffer.from(col.blocks.buffer).toString('latin1')), first[i], `${preset} column ${i} reproducible`);
    }
    assert.notEqual(first[0], first[1], `${preset}: neighbouring columns differ`);
  }
});

test('coreb columns: only defined blocks, bedrock floor, terrain height and biome agree with point queries', () => {
  const seed = 4242;
  let topMismatch = 0, checked = 0;
  for (let cz = -3; cz <= 3; cz++) {
    for (let cx = -3; cx <= 3; cx++) {
      const col = gen(seed, cx, cz);
      for (let i = 0; i < COLUMN_VOLUME; i++) assert.ok(B_DEFINED[col.blocks[i] & 0xff], `defined id ${col.blocks[i] & 0xff}`);
      for (let lz = 0; lz < 16; lz += 3) {
        for (let lx = 0; lx < 16; lx += 3) {
          const x = cx * 16 + lx, z = cz * 16 + lz;
          assert.equal(idAt(col, lx, 0, lz), ID.bedrock);
          assert.equal(col.biomes[lx + lz * 16], getBiomeAt(seed, x, z, 'default'), 'biome agrees');
          const h = getTerrainHeight(seed, x, z, 'default');
          checked++;
          const top = idAt(col, lx, h, lz);
          if (top === ID.air || top === ID.lava) topMismatch++; // only at rare cave openings
          for (let y = h + 1; y < 128; y++) {
            const id = idAt(col, lx, y, lz);
            assert.ok(id === ID.air || id === ID.water || id === ID.ice || id === ID.snow || LOGS.has(id) || LEAVES.has(id) || !B_OPAQUE[id] || id === ID.pumpkin || id === ID.melon || id === ID.cobblestone || id === ID.mossy_cobblestone,
              `nothing terrain-like above getTerrainHeight at ${x},${y},${z}: ${id}`);
          }
        }
      }
    }
  }
  assert.ok(topMismatch / checked < 0.02, `terrain top present (${topMismatch}/${checked} carved)`);
});

test('coreb ores: correct depths, emerald only in the mountains, stone variants present', () => {
  const maxY = { [ID.diamond_ore]: 16, [ID.redstone_ore]: 16, [ID.lapis_ore]: 30, [ID.gold_ore]: 32, [ID.iron_ore]: 64, [ID.coal_ore]: 100, [ID.emerald_ore]: 30 };
  const seen = new Map();
  for (const seed of [12345, 777]) {
    const r = region(seed, -4, -4, 8);
    for (const col of r.cols.values()) {
      for (let i = 0; i < COLUMN_VOLUME; i++) {
        const id = col.blocks[i] & 0xff;
        if (!(id in maxY) && id !== ID.granite && id !== ID.diorite && id !== ID.andesite) continue;
        const y = i >> 8;
        seen.set(id, (seen.get(id) || 0) + 1);
        if (id in maxY) {
          assert.ok(y <= maxY[id] && y >= 5, `ore ${id} at y ${y}`);
          if (id === ID.emerald_ore) assert.equal(col.biomes[i & 255], BIOME_BY_NAME.mountains, 'emerald only in mountains');
        }
      }
    }
  }
  for (const n of ['coal_ore', 'iron_ore', 'gold_ore', 'redstone_ore', 'diamond_ore', 'lapis_ore', 'granite', 'diorite', 'andesite'])
    assert.ok(seen.get(ID[n]) > 0, `${n} generated`);
});

test('coreb caves + water: caves exist, never open into water, lava only at the bottom', () => {
  const r = region(12345, -3, -3, 6);
  let caveAir = 0;
  for (let x = r.x0 + 1; x < r.x1; x++) {
    for (let z = r.z0 + 1; z < r.z1; z++) {
      for (let y = 1; y < 64; y++) {
        const id = r.get(x, y, z);
        if (id === ID.water) {
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
            const n = r.get(x + dx, y + dy, z + dz);
            assert.ok(n !== ID.air && n !== ID.lava, `water at ${x},${y},${z} touches ${n === ID.air ? 'air' : 'lava'} at ${dx},${dy},${dz}`);
          }
        }
        if (id === ID.lava) assert.ok(y <= 6, `lava at y ${y}`);
        if (id === ID.air && y < 40 && B_OPAQUE[r.get(x, y + 1, z)]) caveAir++;
      }
    }
  }
  assert.ok(caveAir > 2000, `caves carved (${caveAir} cells)`);
});

test('coreb trees: pull model is seamless (every leaf has a trunk nearby, canopies complete across borders)', () => {
  // default terrain: no orphan leaves anywhere (a missing cross-column trunk would leave floating leaves)
  const r = region(12345, -4, -2, 6);
  let leaves = 0;
  for (let x = r.x0 + 3; x <= r.x1 - 3; x++) {
    for (let z = r.z0 + 3; z <= r.z1 - 3; z++) {
      for (let y = 40; y < 128; y++) {
        if (!LEAVES.has(r.get(x, y, z))) continue;
        leaves++;
        let found = false;
        for (let dx = -3; dx <= 3 && !found; dx++) for (let dz = -3; dz <= 3 && !found; dz++) for (let dy = -10; dy <= 1 && !found; dy++)
          if (LOGS.has(r.get(x + dx, y + dy, z + dz))) found = true;
        assert.ok(found, `leaf at ${x},${y},${z} has a trunk`);
      }
    }
  }
  assert.ok(leaves > 500, `trees generated (${leaves} leaves)`);
  // flat preset (no terrain in the way): every oak/birch top log has its 4 side leaves, even across borders
  const f = region(5, -12, -12, 24, 'flat');
  let tops = 0, crossing = 0;
  for (let x = f.x0 + 1; x < f.x1; x++) {
    for (let z = f.z0 + 1; z < f.z1; z++) {
      for (let y = FLAT_SURFACE_Y; y < FLAT_SURFACE_Y + 9; y++) {
        const id = f.get(x, y, z);
        if (id !== ID.oak_log && id !== ID.birch_log) continue;
        if (!LEAVES.has(f.get(x, y + 1, z))) continue;
        tops++;
        if ((x & 15) === 0 || (x & 15) === 15 || (z & 15) === 0 || (z & 15) === 15 || (x & 15) === 1 || (x & 15) === 14) crossing++;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.ok(LEAVES.has(f.get(x + dx, y, z + dz)), `canopy at ${x + dx},${y},${z + dz}`);
      }
    }
  }
  assert.ok(tops >= 20, `flat trees (${tops})`);
  assert.ok(crossing >= 1, 'some flat tree canopies cross a column border');
});

test('coreb flat preset: exact layout, spawn y 4, clear around the origin, P1 decoration further out', () => {
  const c = gen(1, 0, 0, 'flat');
  for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
    assert.equal(idAt(c, lx, 0, lz), ID.bedrock);
    assert.equal(idAt(c, lx, 1, lz), ID.dirt);
    assert.equal(idAt(c, lx, 2, lz), ID.dirt);
    assert.equal(idAt(c, lx, 3, lz), ID.grass_block);
    for (let y = 4; y < 128; y++) assert.equal(idAt(c, lx, y, lz), ID.air, 'nothing above the grass near the origin');
  }
  assert.deepEqual(findSpawn(1, 'flat'), { x: 0.5, y: FLAT_SURFACE_Y, z: 0.5 });
  const r = region(1, -10, -10, 20, 'flat');
  let logs = 0, plants = 0;
  for (const col of r.cols.values()) for (let i = FLAT_SURFACE_Y * 256; i < COLUMN_VOLUME; i++) {
    const id = col.blocks[i] & 0xff;
    if (LOGS.has(id)) logs++;
    else if (id !== ID.air && !LEAVES.has(id)) plants++;
  }
  const trees = logs / 5.5;
  assert.ok(trees > 10 && trees <= 400 / 4, `flat: a few trees, at most 1 per 4 columns (${trees.toFixed(0)})`);
  assert.ok(plants > 50, `flat: some flowers and grass (${plants})`);
});

test('coreb spawn: dry grass, open sky, away from water, deterministic, several seeds', () => {
  for (const seed of [12345, 1, 2, 3, 42, 777, 9001, 31337]) {
    const s = findSpawn(seed, 'default');
    assert.deepEqual(findSpawn(seed, 'default'), s, 'deterministic');
    assert.equal(((s.x % 1) + 1) % 1, 0.5); assert.equal(((s.z % 1) + 1) % 1, 0.5);
    assert.ok(Math.hypot(s.x, s.z) <= 256, `near the origin (${s.x}, ${s.z})`);
    const bx = Math.floor(s.x), bz = Math.floor(s.z);
    const r = region(seed, (bx >> 4) - 1, (bz >> 4) - 1, 3);
    assert.equal(r.get(bx, s.y - 1, bz), ID.grass_block, `seed ${seed}: grass under the feet`);
    assert.equal(r.get(bx, s.y, bz), ID.air, 'feet free');
    assert.equal(r.get(bx, s.y + 1, bz), ID.air, 'head free');
    for (let y = s.y; y < 128; y++) assert.equal(r.get(bx, y, bz), ID.air, `open sky (y ${y})`);
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let y = s.y - 3; y <= s.y; y++)
      assert.notEqual(r.get(bx + dx, y, bz + dz), ID.water, `seed ${seed}: no water within 3 blocks`);
  }
  const sn = findSpawn(5, 'snowy');
  assert.ok(sn.y > SEA_LEVEL, 'snowy preset spawn on land');
  const is = findSpawn(5, 'islands');
  assert.ok(is.y > SEA_LEVEL, 'islands preset spawn on land');
});

test('coreb biome variety: >= 4 biomes within 512 blocks for seed 12345 (and in general)', () => {
  const near = new Set(), far = new Set();
  for (let z = -256; z <= 256; z += 8) for (let x = -256; x <= 256; x += 8) near.add(getBiomeAt(12345, x, z, 'default'));
  assert.ok(near.size >= 4, `seed 12345: ${near.size} biomes within 512 blocks (${[...near].map((b) => BIOMES[b].name)})`);
  for (const seed of [1, 2, 3, 42, 777]) {
    const s = new Set();
    for (let z = -512; z <= 512; z += 16) for (let x = -512; x <= 512; x += 16) { const b = getBiomeAt(seed, x, z, 'default'); s.add(b); far.add(b); }
    assert.ok(s.size >= 5, `seed ${seed}: ${s.size} biomes within 512`);
  }
  assert.equal(far.size, 9, 'every biome appears across seeds');
  for (let i = 0; i < 50; i++) assert.equal(getBiomeAt(3, i * 37, -i * 11, 'snowy'), BIOME_BY_NAME.snowy, 'snowy preset forces snow');
});

test('coreb surface: snow on snowy tops, sand beaches, decoration present, heights in range', () => {
  // the origin region plus one more 256x256 region: biomes are a few hundred blocks across (climate ~1/800,
  // LEAD review CORE-R8), so one region alone may hold only the cold biomes
  const cols = new Map();
  for (const [cx0, cz0] of [[-8, -8], [-24, -24]]) for (const [k, c] of region(12345, cx0, cz0, 16).cols) cols.set(k, c);
  const r = { cols };
  const tops = new Map(), deco = new Map();
  const heights = [];
  for (const [key, col] of r.cols) {
    for (let c = 0; c < 256; c++) {
      let y = 127;
      while (y > 0 && (col.blocks[c | (y << 8)] & 0xff) === ID.air) y--;
      const id = col.blocks[c | (y << 8)] & 0xff;
      const b = col.biomes[c];
      if (b === BIOME_BY_NAME.snowy) assert.ok(id === ID.snow || id === ID.ice, `snowy top is snow or ice (${id}) in ${key}`);
      tops.set(id, (tops.get(id) || 0) + 1);
      const lx = c & 15, lz = c >> 4;
      heights.push(getTerrainHeight(12345, (Number(key.split(',')[0]) << 4) + lx, (Number(key.split(',')[1]) << 4) + lz, 'default'));
    }
    for (let i = 0; i < COLUMN_VOLUME; i++) { const id = col.blocks[i] & 0xff; deco.set(id, (deco.get(id) || 0) + 1); }
  }
  for (const n of ['short_grass', 'dandelion', 'poppy', 'oak_log', 'birch_log', 'spruce_log', 'sugar_cane', 'snow', 'ice', 'fern'])
    assert.ok((deco.get(ID[n]) || 0) + (tops.get(ID[n]) || 0) > 0, `${n} appears in two 256x256 areas`);
  heights.sort((a, b) => a - b);
  const q = (p) => heights[Math.floor(p * (heights.length - 1))];
  assert.ok(q(0.5) >= 48 && q(0.5) <= 72, `median height ${q(0.5)}`);
  assert.ok(q(1) <= 120 && q(0) >= 6, `height range ${q(0)}..${q(1)}`);
});

test('coreb desert decoration: cactus never touches another block sideways, dead bushes', () => {
  // find a desert near the origin for a fixed seed by scanning biomes
  let found = null;
  for (let r = 0; r < 800 && !found; r += 32) for (let a = 0; a < 16 && !found; a++) {
    const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
    if (getBiomeAt(12345, x, z, 'default') === BIOME_BY_NAME.desert) found = [x, z];
  }
  assert.ok(found, 'a desert exists');
  const rg = region(12345, (found[0] >> 4) - 2, (found[1] >> 4) - 2, 5);
  let cactus = 0, bushes = 0;
  for (let x = rg.x0 + 1; x < rg.x1; x++) for (let z = rg.z0 + 1; z < rg.z1; z++) for (let y = 40; y < 110; y++) {
    const id = rg.get(x, y, z);
    if (id === ID.dead_bush) bushes++;
    if (id !== ID.cactus) continue;
    cactus++;
    const below = rg.get(x, y - 1, z);
    assert.ok(below === ID.sand || below === ID.cactus, 'cactus on sand');
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.equal(rg.get(x + dx, y, z + dz), ID.air, `cactus side free at ${x},${y},${z}`);
  }
  assert.ok(cactus > 0 && bushes > 0, `desert decoration (cactus ${cactus}, dead bushes ${bushes})`);
});

test('coreb placeTree: shapes, room check, deterministic, no partial writes', () => {
  for (const kind of ['oak', 'birch', 'spruce']) {
    const world = new Map();
    const key = (x, y, z) => x + ',' + y + ',' + z;
    const get = (x, y, z) => (y === 9 ? ID.grass_block : world.get(key(x, y, z)) ?? ID.air);
    const set = (x, y, z, id) => world.set(key(x, y, z), id);
    assert.equal(placeTree(set, get, 0, 10, 0, kind, mulberry32(3)), true, kind);
    const logs = [...world.values()].filter((v) => LOGS.has(v)).length;
    const lv = [...world.values()].filter((v) => LEAVES.has(v)).length;
    const range = { oak: [4, 6], birch: [5, 7], spruce: [6, 9] }[kind];
    assert.ok(logs >= range[0] && logs <= range[1], `${kind} trunk ${logs}`);
    assert.ok(lv > 10, `${kind} leaves ${lv}`);
    for (const [k, v] of world) if (LEAVES.has(v) || LOGS.has(v)) {
      const [x, , z] = k.split(',').map(Number);
      assert.ok(Math.abs(x) <= 3 && Math.abs(z) <= 3, 'within radius 3');
    }
    // same rand -> same tree
    const w2 = new Map();
    placeTree((x, y, z, id) => w2.set(key(x, y, z), id), (x, y, z) => (y === 9 ? ID.grass_block : w2.get(key(x, y, z)) ?? ID.air), 0, 10, 0, kind, mulberry32(3));
    assert.deepEqual([...w2].sort(), [...world].sort());
    // blocked: a stone block in the trunk path -> false and nothing written
    const w3 = new Map([[key(0, 12, 0), ID.stone]]);
    let writes = 0;
    const ok = placeTree(() => writes++, (x, y, z) => (y === 9 ? ID.grass_block : w3.get(key(x, y, z)) ?? ID.air), 0, 10, 0, kind, mulberry32(3));
    assert.equal(ok, false); assert.equal(writes, 0);
    // not on sand
    assert.equal(placeTree(() => {}, (x, y) => (y === 9 ? ID.sand : ID.air), 0, 10, 0, kind, mulberry32(3)), false);
  }
});

test('coreb performance: generateColumn <= 1 ms per column (desktop budget)', () => {
  const out = mk();
  for (let i = 0; i < 300; i++) { out.blocks.fill(0); generateColumn(12345, (i % 30) - 60, Math.floor(i / 30) + 40, 'default', out); } // JIT warm-up
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) { out.blocks.fill(0); generateColumn(12345, (i % 10) - 5 + run * 10, Math.floor(i / 10) - 5, 'default', out); }
    best = Math.min(best, (performance.now() - t0) / 100);
  }
  console.log(`# coreb gen ${best.toFixed(3)} ms/column`);
  assert.ok(best <= 1, `generateColumn ${best.toFixed(3)} ms per column`);
});

test('coreb climate: a desert never borders snow - no snowy biome or snow-capped peak within 16 blocks (LEAD review CORE-R8)', () => {
  const STEP = 8, HALF = 1024, N = (2 * HALF) / STEP, R = 16 / STEP;
  let deserts = 0, checkedPeaks = 0;
  for (const seed of [12345, 4242, 777]) {
    const bio = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) bio[i + j * N] = getBiomeAt(seed, -HALF + i * STEP, -HALF + j * STEP, 'default');
    const peaks = new Set();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (bio[i + j * N] !== BIOME_BY_NAME.desert) continue;
      deserts++;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const b = bio[ii + jj * N];
        assert.notEqual(b, BIOME_BY_NAME.snowy, `seed ${seed}: snowy biome next to the desert at ${-HALF + i * STEP},${-HALF + j * STEP}`);
        const x = -HALF + ii * STEP, z = -HALF + jj * STEP;
        if (b === BIOME_BY_NAME.mountains && getTerrainHeight(seed, x, z, 'default') >= 102) peaks.add(x + ',' + z);
      }
    }
    // a high mountain right next to a desert keeps a bare (warm) top: no snow layer on it
    for (const k of [...peaks].slice(0, 24)) {
      const [x, z] = k.split(',').map(Number);
      const col = gen(seed, x >> 4, z >> 4);
      let y = 127;
      while (y > 0 && (col.blocks[colIndex(x & 15, y, z & 15)] & 0xff) === ID.air) y--;
      assert.notEqual(col.blocks[colIndex(x & 15, y, z & 15)] & 0xff, ID.snow, `seed ${seed}: snow-capped peak at ${x},${y},${z} next to a desert`);
      checkedPeaks++;
    }
  }
  assert.ok(deserts > 100, `deserts exist (${deserts} samples); ${checkedPeaks} desert-side peaks checked`);
});
