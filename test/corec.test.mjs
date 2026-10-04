// OWNER LANE: CORE-C. Unit tests + benches for lighting (src/world/lighting.js), the mesher
// (src/world/mesher.js) and the world system (src/world/world.js). Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';

import { ID, B_PASS, B_DEFINED, PASS, bindTextures } from '../src/core/registry.js';
import { DEFAULT_RULES, COLUMN_VOLUME, colIndex, colKey, padIndex } from '../src/core/constants.js';
import { EventBus } from '../src/core/events.js';
import { mulberry32 } from '../src/core/math.js';
import { buildTextures } from '../src/textures/textures.js';
import { createWorldSystem } from '../src/world/world.js';
import { COL_STATE, Column } from '../src/world/column.js';
import { lightColumn, computeHeightmap } from '../src/world/lighting.js';
import { generateColumn } from '../src/world/worldgen.js';
import { PADDED_VOLUME, buildPadded, meshSection, meshBlockModel } from '../src/world/mesher.js';
import { encodeColumn } from '../src/save/codec.js';

bindTextures(buildTextures());

/** A recording renderer: tracks live section meshes so leaks and same-frame remeshes are visible. */
function fakeRenderer() {
  const live = new Map();
  const r = {
    live, sets: 0, frame: 0, log: [],
    setSectionMesh(cx, sy, cz, mesh) { r.sets++; r.log.push({ key: `${cx},${sy},${cz}`, frame: r.frame, mesh }); if (mesh) live.set(`${cx},${sy},${cz}`, mesh); else live.delete(`${cx},${sy},${cz}`); },
    removeColumnMeshes(cx, cz) { for (let s = 0; s < 8; s++) live.delete(`${cx},${s},${cz}`); },
    clearWorld() { live.clear(); },
  };
  return r;
}

function makeWorld({ preset = 'flat', seed = 1, R = 3, renderer = null, saved = null } = {}) {
  const events = new EventBus();
  const game = {
    events, settings: { fancyLeaves: true, smoothLighting: true, waving: true }, renderer, state: 'playing',
    player: { x: 8.5, y: 4, z: 8.5, yaw: 0 }, perf: { frameMs: 16, workMs: 2 }, tickCount: 0, isCreative: () => true,
    meta: { seed, preset, rules: { ...DEFAULT_RULES } }, textures: null,
  };
  const w = createWorldSystem(game);
  w.init(game);
  w.open(game.meta, saved);
  w.setRenderDistance(R);
  const pump = (cond, msg, max = 4000) => {
    for (let i = 0; i < max && !cond(); i++) { if (renderer) renderer.frame++; w.frame(game, 0.016); }
    assert.ok(cond(), msg);
  };
  const settle = () => { for (let i = 0; i < 400; i++) { if (renderer) renderer.frame++; w.frame(game, 0.016); } };
  return { w, game, events, pump, settle };
}

const lightAt = (w, x, y, z) => ({ sky: w.getSkyLight(x, y, z), block: w.getBlockLight(x, y, z) });

/* ================================================================== lighting */

test('lighting: torch next to a column border lights both sides symmetrically; removal returns all to 0', () => {
  const { w, pump } = makeWorld({ R: 3 });
  pump(() => w.isColumnLoaded(0, 0) && w.isColumnLoaded(1, 0) && w.isColumnLoaded(-1, 0), 'columns lit');
  // flat: ground top y = 3, air from y = 4. Torch at x = 15 (last cell of column 0), next to column 1.
  const tx = 15, ty = 6, tz = 8;
  assert.ok(w.setBlock(tx, ty, tz, ID.torch, 0, { cause: 'test' }));
  assert.equal(w.getBlockLight(tx, ty, tz), 14, 'torch emits 14');
  for (let d = 1; d <= 13; d++) {
    assert.equal(w.getBlockLight(tx + d, ty, tz), 14 - d, `east (column 1) at distance ${d}`);
    assert.equal(w.getBlockLight(tx - d, ty, tz), 14 - d, `west (column 0) at distance ${d}`);
    assert.equal(w.getBlockLight(tx + d, ty, tz), w.getBlockLight(tx - d, ty, tz), `symmetric at ${d}`);
  }
  assert.equal(w.getBlockLight(tx + 14, ty, tz), 0);
  // diagonal symmetry across the border (manhattan distance)
  assert.equal(w.getBlockLight(tx + 3, ty + 2, tz - 4), 14 - 9);
  assert.equal(w.getBlockLight(tx - 3, ty + 2, tz + 4), 14 - 9);
  assert.ok(w.setBlock(tx, ty, tz, ID.air, 0, { cause: 'test' }));
  for (let x = tx - 16; x <= tx + 16; x++) for (let y = 4; y < 24; y++) for (let z = tz - 16; z <= tz + 16; z++) {
    assert.equal(w.getBlockLight(x, y, z), 0, `block light back to 0 at ${x},${y},${z}`);
  }
  // re-add: same field again
  assert.ok(w.setBlock(tx, ty, tz, ID.torch, 0, { cause: 'test' }));
  assert.equal(w.getBlockLight(tx + 5, ty, tz), 9);
  assert.equal(w.getBlockLight(tx - 5, ty, tz), 9);
  w.close();
});

test('lighting: sky under a 1-block roof is 14 at the edge and decays inward; open sky stays 15', () => {
  const { w, pump } = makeWorld({ R: 3 });
  pump(() => w.isColumnLoaded(0, 0) && w.isColumnLoaded(-1, -1) && w.isColumnLoaded(1, 1), 'columns lit');
  const list = [];
  for (let x = 2; x <= 12; x++) for (let z = 2; z <= 12; z++) list.push([x, 8, z, ID.stone]);
  w.setBlocks(list, { cause: 'test' });
  assert.equal(w.getSkyLight(0, 7, 7), 15, 'open sky outside');
  assert.equal(w.getSkyLight(2, 7, 7), 14, 'edge cell under the roof');
  assert.equal(w.getSkyLight(3, 7, 7), 13, 'one step in');
  assert.equal(w.getSkyLight(7, 7, 7), 9, 'centre: 15 - 6');
  assert.equal(w.getSkyLight(7, 4, 7), 9, 'straight down from the centre: horizontal decay only');
  assert.equal(w.getSkyLight(7, 9, 7), 15, 'on top of the roof');
  assert.equal(w.getHeight(7, 7), 9, 'heightmap above the roof');
  // remove the roof again: everything back to 15
  w.setBlocks(list.map(([x, y, z]) => [x, y, z, ID.air]), { cause: 'test' });
  for (let x = 1; x <= 13; x++) for (let z = 1; z <= 13; z++) assert.equal(w.getSkyLight(x, 5, z), 15, `sky back at ${x},${z}`);
  assert.equal(w.getHeight(7, 7), 4);
  w.close();
});

test('lighting: water and leaves filter sky light; opaque emitters light their neighbours', () => {
  const { w, pump } = makeWorld({ R: 3 });
  pump(() => w.isColumnLoaded(0, 0) && w.isColumnLoaded(1, 1) && w.isColumnLoaded(-1, -1), 'lit');
  // a 1-wide shaft of water 3 deep surrounded by stone so sky only comes from above
  const list = [];
  for (let y = 4; y <= 7; y++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) list.push([8 + dx, y, 8 + dz, dx || dz ? ID.stone : ID.water]);
  w.setBlocks(list, { cause: 'test' });
  assert.equal(w.getSkyLight(8, 7, 8), 13, 'top water: 15 - 1 - filter');
  assert.equal(w.getSkyLight(8, 6, 8), 11);
  assert.equal(w.getSkyLight(8, 4, 8), 7);
  w.setBlock(4, 10, 4, ID.glowstone, 0, { cause: 'test' });
  assert.equal(w.getBlockLight(4, 10, 4), 15);
  assert.equal(w.getBlockLight(5, 10, 4), 14);
  assert.equal(w.getBlockLight(4, 10, 8), 11);
  w.close();
});

/**
 * Incremental relight == lighting from scratch. Random edits (torches, glowstone, roofs, holes, water,
 * leaves) near column borders, then the same final blocks are loaded into a fresh world and lit from scratch:
 * every lit cell must match.
 */
test('lighting: incremental relight matches a from-scratch light of the same blocks (random edits)', () => {
  const A = makeWorld({ R: 2 });
  A.settle();
  const rand = mulberry32(1234);
  const kinds = [ID.torch, ID.glowstone, ID.stone, ID.stone, ID.stone, ID.air, ID.air, ID.water, ID.oak_leaves, ID.glass, ID.oak_slab];
  for (let round = 0; round < 6; round++) {
    const batch = round % 2 === 1;
    const edits = [];
    for (let k = 0; k < 60; k++) {
      const x = -6 + Math.floor(rand() * 28), z = -6 + Math.floor(rand() * 28), y = 1 + Math.floor(rand() * 14);
      edits.push([x, y, z, kinds[Math.floor(rand() * kinds.length)]]);
    }
    // a roof that later gets holes punched into it
    if (round === 0) for (let x = 10; x <= 21; x++) for (let z = 10; z <= 21; z++) edits.push([x, 12, z, ID.stone]);
    if (batch) A.w.setBlocks(edits, { cause: 'test' });
    else for (const e of edits) A.w.setBlock(e[0], e[1], e[2], e[3], 0, { cause: 'test' });
  }
  // fresh world with the final blocks of every loaded column
  const saved = new Map();
  A.w.forEachColumn((c) => saved.set(colKey(c.cx, c.cz), { data: encodeColumn(c.blocks), blockEntities: [] }));
  const B = makeWorld({ R: 2, saved });
  B.settle();
  let compared = 0, diffs = 0, first = null;
  A.w.forEachColumn((ca) => {
    const cb = B.w.getColumn(ca.cx, ca.cz);
    if (!cb || ca.state < COL_STATE.LIT || cb.state < COL_STATE.LIT) return;
    // only columns whose whole 3x3 neighbourhood is lit in both worlds (identical light sources)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!A.w.isColumnLoaded(ca.cx + dx, ca.cz + dz) || !B.w.isColumnLoaded(ca.cx + dx, ca.cz + dz)) return;
    }
    compared++;
    for (let i = 0; i < COLUMN_VOLUME; i++) {
      if (ca.light[i] !== cb.light[i]) { diffs++; if (!first) first = { cx: ca.cx, cz: ca.cz, x: i & 15, y: i >> 8, z: (i >> 4) & 15, a: ca.light[i].toString(16), b: cb.light[i].toString(16) }; }
    }
  });
  assert.ok(compared >= 9, `compared ${compared} columns`);
  assert.equal(diffs, 0, `light differs in ${diffs} cells, first ${JSON.stringify(first)}`);
  A.w.close(); B.w.close();
});

test('lighting bench: initial column light and a 600-cell batch relight', () => {
  const mk = (cx, cz) => { const c = new Column(cx, cz); generateColumn(12345, cx, cz, 'default', c); computeHeightmap(c); c.state = COL_STATE.GENERATED; return c; };
  const cols = new Map();
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) cols.set(colKey(cx, cz), mk(cx, cz));
  const fakeWorld = { getColumn: (cx, cz) => cols.get(colKey(cx, cz)) || null };
  let n = 0;
  const t0 = performance.now();
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = cols.get(colKey(cx, cz)); lightColumn(fakeWorld, c); c.state = COL_STATE.LIT; n++; }
  const per = (performance.now() - t0) / n;
  console.log(`  [bench] lightColumn: ${per.toFixed(3)} ms per column (${n} columns, default preset)`);
  assert.ok(per < 10, `light column ${per.toFixed(2)} ms`);

  const { w, pump } = makeWorld({ R: 3 });
  pump(() => w.isColumnLoaded(0, 0) && w.isColumnLoaded(1, 1) && w.isColumnLoaded(-1, -1), 'lit');
  const list = [];
  for (let x = 0; x < 15; x++) for (let z = 0; z < 10; z++) for (let y = 6; y < 10; y++) list.push([x, y, z, ID.stone]);
  assert.equal(list.length, 600);
  const t1 = performance.now();
  w.setBlocks(list, { cause: 'test' });
  const ms = performance.now() - t1;
  console.log(`  [bench] 600-cell batch (fill): ${ms.toFixed(2)} ms`);
  const t2 = performance.now();
  w.setBlocks(list.map(([x, y, z]) => [x, y, z, ID.air]), { cause: 'test' });
  const ms2 = performance.now() - t2;
  console.log(`  [bench] 600-cell batch (remove): ${ms2.toFixed(2)} ms`);
  assert.ok(ms < 60 && ms2 < 60, 'batch relight is fast');
  const t3 = performance.now();
  for (let i = 0; i < 50; i++) { w.setBlock(5, 5, 5, ID.torch, 0, { cause: 'test' }); w.setBlock(5, 5, 5, ID.air, 0, { cause: 'test' }); }
  console.log(`  [bench] torch place/remove: ${((performance.now() - t3) / 100).toFixed(3)} ms per edit`);
  w.close();
});

/* ================================================================== mesher */

function padded() { return { blocks: new Uint16Array(PADDED_VOLUME), light: new Uint8Array(PADDED_VOLUME).fill(0xf0) }; }
function corners(m, q) {
  const out = [];
  for (let k = 0; k < 4; k++) {
    const v = q * 4 + k;
    out.push({ x: m.position[v * 3], y: m.position[v * 3 + 1], z: m.position[v * 3 + 2], u: m.tex[v * 4 + 1], v: m.tex[v * 4 + 2], flags: m.tex[v * 4 + 3], sky: m.light[v * 4], block: m.light[v * 4 + 1], ao: m.light[v * 4 + 2], shade: m.light[v * 4 + 3] });
  }
  return out;
}
function findQuad(m, pred) { for (let q = 0; q < m.quads; q++) { const c = corners(m, q); if (pred(c)) return c; } return null; }

test('mesher: AO darkens corners next to walls; flat light with smoothLighting off', () => {
  const { blocks, light } = padded();
  // floor of stone at y = 0, a wall block at (5,1,4): the top face of (5,0,5) has two occluded corners
  for (let x = -1; x <= 16; x++) for (let z = -1; z <= 16; z++) blocks[padIndex(x, 0, z)] = ID.stone;
  blocks[padIndex(5, 1, 4)] = ID.stone;
  light[padIndex(5, 1, 4)] = 0;
  const m = meshSection(blocks, light, {}).opaque;
  const top = findQuad(m, (c) => c.every((p) => p.y === 1) && Math.min(...c.map((p) => p.x)) === 5 && Math.min(...c.map((p) => p.z)) === 5);
  assert.ok(top, 'top face of (5,0,5) found');
  const north = top.filter((p) => p.z === 5), south = top.filter((p) => p.z === 6);
  assert.ok(north.every((p) => p.ao === 2), `north corners touch the wall: ao ${north.map((p) => p.ao)}`);
  assert.ok(south.every((p) => p.ao === 3), 'south corners are open');
  const far = findQuad(m, (c) => c.every((p) => p.y === 1) && Math.min(...c.map((p) => p.x)) === 10 && Math.min(...c.map((p) => p.z)) === 10);
  assert.ok(far.every((p) => p.ao === 3 && p.sky === 240), 'open ground: ao 3, full sky');
  const flat = meshSection(blocks, light, { smoothLighting: false }).opaque;
  for (let v = 0; v < flat.quads * 4; v++) assert.equal(flat.light[v * 4 + 2], 3, 'no AO without smooth lighting');
});

test('mesher: quad flip rotates the start corner when a00 + a11 > a01 + a10', () => {
  const { blocks, light } = padded();
  for (let x = -1; x <= 16; x++) for (let z = -1; z <= 16; z++) blocks[padIndex(x, 0, z)] = ID.stone;
  // one occluder diagonal to the top-left (north-west) corner of the top face of (5,0,5)
  blocks[padIndex(4, 1, 4)] = ID.stone;
  const m = meshSection(blocks, light, {}).opaque;
  const top = findQuad(m, (c) => c.every((p) => p.y === 1) && Math.min(...c.map((p) => p.x)) === 5 && Math.min(...c.map((p) => p.z)) === 5);
  // up face corners: BL (0,1,1) BR (1,1,1) TR (1,1,0) TL (0,1,0). The dark corner is TL (x 5, z 5).
  const dark = top.find((p) => p.x === 5 && p.z === 5);
  assert.equal(dark.ao, 2);
  // a00 (BL) + a11 (TR) are bright > a01 (TL dark) + a10 (BR): the first emitted vertex is BR (x 6, z 6)
  assert.ok(top[0].x === 6 && top[0].z === 6, `flipped quad starts at BR, got ${JSON.stringify(top[0])}`);
  // unflipped case: open ground starts at BL (x 10, z 11)
  const open = findQuad(m, (c) => c.every((p) => p.y === 1) && Math.min(...c.map((p) => p.x)) === 10 && Math.min(...c.map((p) => p.z)) === 10);
  assert.ok(open[0].x === 10 && open[0].z === 11, 'unflipped quad starts at BL');
});

test('mesher: a single bright (torch-lit) corner is shared by both triangles (review CORE-R2)', () => {
  const { blocks, light } = padded();
  // a dark stone floor (no sky light) with block light only at the north-west corner of the top face of (5,0,5)
  for (let i = 0; i < light.length; i++) light[i] = 0;
  for (let x = -1; x <= 16; x++) for (let z = -1; z <= 16; z++) blocks[padIndex(x, 0, z)] = ID.stone;
  light[padIndex(4, 1, 4)] = 14;
  const m = meshSection(blocks, light, {}).opaque;
  const top = findQuad(m, (c) => c.every((p) => p.y === 1) && Math.min(...c.map((p) => p.x)) === 5 && Math.min(...c.map((p) => p.z)) === 5);
  const bright = top.findIndex((p) => p.block > 0);
  assert.ok(bright >= 0 && top.filter((p) => p.block > 0).length === 1, `exactly one lit corner (${JSON.stringify(top)})`);
  // indices [0,1,2, 0,2,3]: vertices 0 and 2 are in both triangles
  assert.ok(bright === 0 || bright === 2, `the lit corner is on the shared diagonal (vertex ${bright})`);
});

test('mesher: culling rules (glass, leaves fancy/fast, water) and passes', () => {
  const { blocks, light } = padded();
  blocks[padIndex(2, 2, 2)] = ID.glass; blocks[padIndex(3, 2, 2)] = ID.glass;
  let m = meshSection(blocks, light, {});
  assert.equal(m.cutout.quads, 10, 'glass culls glass');
  blocks[padIndex(2, 2, 2)] = ID.oak_leaves; blocks[padIndex(3, 2, 2)] = ID.oak_leaves;
  assert.equal(meshSection(blocks, light, { fancyLeaves: true }).cutout.quads, 12, 'fancy leaves keep inner faces');
  assert.equal(meshSection(blocks, light, { fancyLeaves: false }).cutout.quads, 10, 'fast leaves cull each other');
  blocks.fill(0);
  blocks[padIndex(2, 2, 2)] = ID.water; blocks[padIndex(3, 2, 2)] = ID.water;
  m = meshSection(blocks, light, {});
  assert.equal(m.translucent.quads, 10, 'water culls water');
  const top = findQuad(m.translucent, (c) => c.every((p) => p.y > 2 && p.y < 3));
  assert.ok(top && Math.abs(top[0].y - (2 + 14 / 16)) < 1e-6, 'water top at 14/16');
  assert.ok((top[0].flags >> 3 & 3) === 1 && (top[0].flags >> 5 & 3) === 3, 'water anim + wave flags');
  blocks[padIndex(2, 2, 2)] = ID.lava; blocks[padIndex(3, 2, 2)] = 0;
  m = meshSection(blocks, light, {});
  assert.ok(m.opaque && !m.translucent, 'lava is in the opaque pass');
  // flowing water level 4 next to a source: corner heights averaged
  blocks.fill(0);
  blocks[padIndex(2, 2, 2)] = ID.water; blocks[padIndex(3, 2, 2)] = ID.water | (4 << 8);
  m = meshSection(blocks, light, {}).translucent;
  const ys = new Set();
  for (let v = 0; v < m.quads * 4; v++) ys.add(Math.round((m.position[v * 3 + 1] - 2) * 1000) / 1000);
  assert.ok(ys.has(0.875) && [...ys].some((y) => y > 0.4 && y < 0.7), `averaged corner heights ${[...ys]}`);
});

test('mesher: shapes (slab, stairs, cross, crop, torch, ladder, fence, door, pane, bed, cactus, fire)', () => {
  const one = (id, state = 0, extra = null) => {
    const { blocks, light } = padded();
    blocks[padIndex(5, 5, 5)] = id | (state << 8);
    if (extra) extra(blocks);
    return meshSection(blocks, light, { origin: [0, 0, 0] });
  };
  let m = one(ID.oak_slab);
  assert.equal(m.opaque.quads, 6);
  assert.ok(findQuad(m.opaque, (c) => c.every((p) => p.y === 5.5)), 'bottom slab top face at y 0.5');
  m = one(ID.oak_slab, 1);
  assert.ok(findQuad(m.opaque, (c) => c.every((p) => p.y === 5.5)) && findQuad(m.opaque, (c) => c.every((p) => p.y === 6)), 'top slab spans 0.5..1');
  assert.ok(one(ID.oak_stairs, 2).opaque.quads >= 10, 'stairs = slab + half block');
  m = one(ID.poppy);
  assert.equal(m.cutout.quads, 2, 'cross = 2 quads');
  assert.ok(corners(m.cutout, 0).every((p) => (p.flags & 7) === 6), 'plant face flag 6');
  const jitterA = one(ID.short_grass).cutout.position[0];
  const { blocks: b2, light: l2 } = padded();
  b2[padIndex(5, 5, 5)] = ID.short_grass;
  const jitterB = meshSection(b2, l2, { origin: [16, 0, 0] }).cutout.position[0];
  assert.notEqual(jitterA, jitterB, 'cross jitter depends on the world position');
  assert.equal(one(ID.wheat, 7).cutout.quads, 4, 'crop = 4 planes');
  m = one(ID.torch);
  assert.equal(m.cutout.quads, 6, 'torch = 6 faces');
  for (let v = 0; v < 24; v++) { const x = m.cutout.position[v * 3]; assert.ok(x >= 5 + 6 / 16 && x <= 5 + 10 / 16, 'floor torch is thin'); }
  m = one(ID.torch, 1); // on the north wall: base near z 0, top leaning south
  let minZbottom = 9, maxZtop = 0;
  for (let v = 0; v < 24; v++) { const y = m.cutout.position[v * 3 + 1], z = m.cutout.position[v * 3 + 2]; if (y < 5.3) minZbottom = Math.min(minZbottom, z); if (y > 5.7) maxZtop = Math.max(maxZtop, z); }
  assert.ok(minZbottom < 5.2 && maxZtop > minZbottom + 0.15, `wall torch leans away from the wall (${minZbottom}, ${maxZtop})`);
  m = one(ID.ladder, 2); // facing south: wall to the north
  assert.equal(m.cutout.quads, 1);
  assert.ok(corners(m.cutout, 0).every((p) => Math.abs(p.z - (5 + 1 / 16)) < 1e-6), 'ladder 1/16 off the north wall');
  assert.equal(one(ID.oak_fence, 0).opaque.quads, 6, 'lone fence post');
  assert.ok(one(ID.oak_fence, 15).opaque.quads > 30, 'fence with 4 connections has rails');
  assert.equal(one(ID.oak_door, 0).cutout.quads, 6, 'door panel');
  assert.ok(one(ID.glass_pane, 5).cutout.quads >= 12, 'pane with arms');
  assert.equal(one(ID.bed, 4).opaque.quads, 6);
  assert.equal(one(ID.cactus).opaque.quads, 6);
  assert.equal(one(ID.fire).cutout.quads, 4);
  assert.ok(one(ID.oak_fence_gate, 4).opaque.quads > 6, 'open gate');
  assert.ok(one(ID.chest, 2).opaque.quads === 6 && one(ID.cake, 3).opaque.quads === 6 && one(ID.white_carpet).opaque.quads === 6);
  assert.equal(one(ID.snow, 3).opaque.quads, 6);
  // a cube next to a slab still shows its face (slabs are not opaque); a slab on stone hides its bottom
  m = one(ID.oak_slab, 0, (b) => { b[padIndex(5, 4, 5)] = ID.stone; });
  assert.equal(m.opaque.quads, 6 + 5, 'stone below: slab bottom culled, stone top drawn');
});

test('mesher: every block and state meshes inside its cell with valid attributes', () => {
  let total = 0;
  for (let id = 1; id < 256; id++) {
    if (!B_DEFINED[id]) continue;
    for (const state of [0, 1, 2, 3, 4, 5, 7, 8, 9, 12, 15, 0x14, 0x25]) {
      const { blocks, light } = padded();
      blocks[padIndex(7, 7, 7)] = id | (state << 8);
      blocks[padIndex(7, 6, 7)] = ID.stone;
      const m = meshSection(blocks, light, {});
      if (B_PASS[id] === PASS.NONE) continue;
      assert.ok(m, `id ${id} state ${state} produces a mesh`);
      for (const pass of ['opaque', 'cutout', 'translucent']) {
        const b = m[pass];
        if (!b) continue;
        assert.equal(b.position.length, b.quads * 12);
        for (let v = 0; v < b.quads * 4; v++) {
          const x = b.position[v * 3], y = b.position[v * 3 + 1], z = b.position[v * 3 + 2];
          if (y < 7 - 1e-6 && pass !== 'opaque') continue; // the stone below is in the opaque pass
          if (y >= 7 - 1e-6 || pass !== 'opaque' || b.tex[v * 4] !== 0) {
            assert.ok(x >= 6.9 && x <= 8.1 && z >= 6.9 && z <= 8.1 && y >= 5.9 && y <= 8.2, `id ${id}/${state} vertex ${x},${y},${z}`);
          }
          assert.ok(b.tex[v * 4 + 1] <= 256 && b.tex[v * 4 + 2] <= 256, `uv range id ${id}`);
          assert.ok((b.tex[v * 4 + 3] & 7) <= 6 && (b.tex[v * 4 + 3] >> 7) === 0, 'flags');
          assert.ok(b.light[v * 4] <= 240 && b.light[v * 4 + 1] <= 240 && b.light[v * 4 + 2] <= 3, 'light ranges');
        }
        total += b.quads;
      }
    }
  }
  assert.ok(total > 1000);
  for (const id of [ID.stone, ID.torch, ID.poppy, ID.water, ID.oak_stairs, ID.oak_door]) {
    const bm = meshBlockModel(id, 0);
    assert.ok(bm.quads > 0, `block model ${id}`);
    for (let v = 0; v < bm.quads * 4; v++) {
      assert.ok(Math.abs(bm.position[v * 3]) <= 0.5 + 1e-6 && Math.abs(bm.position[v * 3 + 2]) <= 0.5 + 1e-6, 'block model centred');
      assert.equal(bm.light[v * 4], 240, 'full sky light');
    }
  }
  assert.equal(meshBlockModel(ID.oak_planks, 0).quads, 6);
});

test('mesher bench: typical surface sections', () => {
  const cols = new Map();
  for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
    const c = new Column(cx, cz); generateColumn(777, cx, cz, 'default', c); computeHeightmap(c); c.state = COL_STATE.GENERATED; cols.set(colKey(cx, cz), c);
  }
  const fw = { getColumn: (cx, cz) => cols.get(colKey(cx, cz)) || null };
  for (const c of cols.values()) { lightColumn(fw, c); c.state = COL_STATE.LIT; }
  const pb = new Uint16Array(PADDED_VOLUME), pl = new Uint8Array(PADDED_VOLUME);
  let n = 0, quads = 0, msBuild = 0, msMesh = 0;
  for (let round = 0; round < 3; round++) for (let cx = 0; cx <= 1; cx++) for (let cz = 0; cz <= 1; cz++) for (let sy = 2; sy <= 4; sy++) {
    const t0 = performance.now();
    if (!buildPadded(fw, cx, sy, cz, pb, pl)) continue;
    const t1 = performance.now();
    const m = meshSection(pb, pl, { origin: [cx * 16, sy * 16, cz * 16] });
    msBuild += t1 - t0; msMesh += performance.now() - t1; n++;
    if (m) quads += (m.opaque ? m.opaque.quads : 0) + (m.cutout ? m.cutout.quads : 0) + (m.translucent ? m.translucent.quads : 0);
  }
  console.log(`  [bench] meshSection: ${(msMesh / n).toFixed(3)} ms, buildPadded: ${(msBuild / n).toFixed(3)} ms per section (${n} sections, ${Math.round(quads / n)} quads avg)`);
  assert.ok(msMesh / n < 5, 'section mesh is fast');
});

/* ================================================================== world */

test('world: edits remesh in the very next frame, outside the budget', () => {
  const renderer = fakeRenderer();
  const { w, game, pump } = makeWorld({ R: 3, renderer });
  pump(() => w.getColumn(0, 0) && w.getColumn(0, 0).state === COL_STATE.MESHED && w.unmeshedWithin(2) === 0, 'spawn area meshed');
  for (let i = 0; i < 50; i++) { renderer.frame++; w.frame(game, 0.016); }
  renderer.log.length = 0;
  game.perf.frameMs = 40; // late frames: streaming budget is halved, edits are not budgeted
  assert.ok(w.setBlock(15, 5, 15, ID.torch, 0, { cause: 'test' }));
  const editFrame = renderer.frame;
  renderer.frame++; w.frame(game, 0.016);
  const hits = renderer.log.filter((e) => e.frame === editFrame + 1).map((e) => e.key);
  assert.ok(hits.includes('0,0,0'), `own section remeshed next frame (${hits})`);
  assert.ok(hits.includes('1,0,0') && hits.includes('0,0,1') && hits.includes('1,0,1'), 'neighbour columns lit by the torch remeshed in the same frame');
  const torchMesh = renderer.live.get('0,0,0');
  assert.ok(torchMesh.cutout && torchMesh.cutout.quads >= 6, 'torch geometry present');
  w.close();
});

test('world: no section-mesh leak after streaming 20 columns away and back; drops meshes beyond R+1', () => {
  const renderer = fakeRenderer();
  const { w, game, pump, settle } = makeWorld({ preset: 'default', seed: 12345, R: 4, renderer });
  pump(() => w.unmeshedWithin(4) === 0, 'all columns within R meshed', 8000);
  settle();
  const base = renderer.live.size;
  const bound = Math.ceil(Math.PI * 5 * 5 + 4 * 5 + 8) * 8; // sections of every column within R+1
  assert.ok(base > 0 && base <= bound, `live sections ${base} <= ${bound}`);
  game.player.x += 16 * 20;
  pump(() => w.unmeshedWithin(4) === 0, 'meshed far away', 8000);
  settle();
  assert.ok(renderer.live.size <= bound, `live sections bounded far away (${renderer.live.size})`);
  for (const key of renderer.live.keys()) {
    const [cx, , cz] = key.split(',').map(Number);
    const d2 = (cx - (Math.floor(game.player.x) >> 4)) ** 2 + (cz - (Math.floor(game.player.z) >> 4)) ** 2;
    assert.ok(d2 <= 25, `no mesh left beyond R+1 (${key})`);
  }
  game.player.x -= 16 * 20;
  pump(() => w.unmeshedWithin(4) === 0, 'meshed again at home', 8000);
  settle();
  assert.ok(Math.abs(renderer.live.size - base) <= 8, `same number of live sections back home (${renderer.live.size} vs ${base})`);
  assert.equal(w.stats().sectionMeshes, renderer.live.size, 'world and renderer agree on live sections');
  assert.ok(w.stats().columns <= Math.ceil(Math.PI * 8.5 * 8.5) + 20, `columns bounded by R+4 (${w.stats().columns})`);
  w.close();
  assert.equal(renderer.live.size, 0, 'close() removes every mesh');
});

test('world: streaming order, gating and events', () => {
  const { w, events, pump } = makeWorld({ preset: 'default', seed: 5, R: 3 });
  const gen = [], loaded = [];
  events.on('world:columnGenerated', (e) => gen.push(e));
  events.on('world:columnLoaded', (e) => {
    loaded.push(e);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) assert.ok(w.getColumn(e.cx + dx, e.cz + dz), 'LIT needs the 3x3 neighbourhood generated');
  });
  pump(() => w.unmeshedWithin(3) === 0, 'meshed');
  assert.ok(gen.length >= loaded.length && loaded.length >= 29);
  assert.ok(gen.every((e) => e.fresh === true));
  w.forEachColumn((c) => {
    if (c.state !== COL_STATE.MESHED) return;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) assert.ok(w.isColumnLoaded(c.cx + dx, c.cz + dz), 'MESHED needs the 3x3 neighbourhood LIT');
  });
  const s = w.stats();
  assert.ok(s.genAvgMs > 0 && s.lightAvgMs > 0 && s.meshAvgMs > 0);
  assert.equal(s.workers, 0, 'Node: main-thread fallback');
  // getters
  assert.equal(w.getLight(0, 200, 0), 0xf0);
  assert.equal(w.getLight(0, -1, 0), 0);
  assert.equal(w.getRaw(1e6, 5, 0), 0);
  assert.equal(w.getLight(1e6, 5, 0), 0xf0);
  assert.equal(w.getHeight(1e6, 0), 128);
  assert.ok(w.getSurfaceY(0.5, 0.5) > 40);
  w.close();
});

test('world: ensureColumn and pregenerate (sync fallback) produce lit/meshed columns', async () => {
  const renderer = fakeRenderer();
  const { w } = makeWorld({ preset: 'default', seed: 9, R: 6, renderer });
  const c = w.ensureColumn(10, 10);
  assert.ok(c.state >= COL_STATE.LIT && w.isColumnLoaded(10, 10));
  let last = null;
  await w.pregenerate(0, 0, 2, (done, total) => { last = [done, total]; });
  assert.ok(last && last[0] === last[1], `progress reached the total ${last}`);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (dx * dx + dz * dz <= 4) assert.equal(w.getColumn(dx, dz).state, COL_STATE.MESHED);
  }
  assert.ok(renderer.live.size > 0);
  w.close();
});

test('world: batches relight once with correct light; setBlock rules', () => {
  const { w, pump, events } = makeWorld({ R: 3 });
  pump(() => w.isColumnLoaded(0, 0) && w.isColumnLoaded(1, 1) && w.isColumnLoaded(-1, -1), 'lit');
  let changed = 0;
  events.on('block:changed', () => changed++);
  w.beginBatch(); w.beginBatch();
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) w.setBlock(x, 9, z, ID.stone, 0, { cause: 'test', action: 3 });
  w.endBatch();
  assert.ok(w.inBatch());
  assert.equal(w.getSkyLight(2, 8, 2), 15, 'stale inside the batch');
  w.endBatch();
  assert.equal(changed, 25);
  assert.equal(w.getSkyLight(2, 8, 2), 12, 'relit at the outer endBatch: 3 steps from open sky');
  assert.equal(w.setBlock(2, 9, 2, ID.stone, 0, {}), false, 'no change -> false');
  assert.equal(w.setBlock(2, 200, 2, ID.stone, 0, {}), false, 'out of range');
  assert.equal(w.setBlock(1e6, 5, 2, ID.stone, 0, {}), false, 'unloaded');
  assert.equal(w.getColumn(0, 0).modified, true);
  w.close();
});
