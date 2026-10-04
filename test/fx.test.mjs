// OWNER LANE: FEATURE-FX. Unit tests for the pure FX modules (particles, sprites, item extrusion, crack and
// ghost geometry, skin painter, flash safety). Browser-only parts (DOM overlays, rendering) are covered by the
// smoke scenarios in tools/scenarios/fx.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTextures } from '../src/textures/textures.js';
import { ID, bindTextures, faceLayer } from '../src/core/registry.js';
import { ParticleSim, MAX_PARTICLES, PARTICLE_KINDS, lightAround } from '../src/fx/particles.js';
import {
  SPRITE, SPRITE_ATLAS_SIZE, SPRITE_CELL, SPRITE_COLS, buildCloudGeometry, buildCloudMap, buildMoonTexture, buildSpriteAtlas,
  buildSunTexture, buildWeatherTexture, buildFlatCloudGeometry, CLOUD_MAP_SIZE,
} from '../src/fx/sprites.js';
import { ItemMeshFactory, extrudeSprite, itemVisual, paletteOf } from '../src/fx/itemmesh.js';
import { crackGeometryData, ghostPlacement } from '../src/fx/blockfx.js';
import { FlashLimiter } from '../src/fx/flash.js';
import { PARTS, buildPartsGeometry, buildPlayerGeometry, paintSkin, posePlayer } from '../src/fx/playermodel.js';
import { buildStarGeometry } from '../src/render/celestial.js';
import * as THREE from 'three';

const textures = buildTextures();
bindTextures(textures);

/** A tiny fake world: stone below y=64, air above; full sky light above ground. */
function fakeWorld(extra = new Map()) {
  return {
    getRaw(x, y, z) { const k = `${x},${y},${z}`; if (extra.has(k)) return extra.get(k); return y < 64 && y >= 0 ? ID.stone : 0; },
    getBlock(x, y, z) { return this.getRaw(x, y, z) & 0xff; },
    getLight(x, y, z) { return y >= 64 ? 0xf0 : 0; },
  };
}

/* ------------------------------------------------------------------ particles */

test('block break: 16-32 textured patches, lit, gone within 60 ticks', () => {
  const sim = new ParticleSim();
  const n = sim.blockBreak(0, 64, 0, ID.oak_planks, 0, fakeWorld());
  assert.ok(n >= 16 && n <= 32, `16-32 particles (got ${n})`);
  assert.equal(sim.count, n);
  const layers = new Set([0, 1, 2, 3, 4, 5].map((f) => faceLayer(ID.oak_planks, 0, f)));
  for (let i = 0; i < n; i++) {
    assert.ok(layers.has(sim.layer[i]), 'samples one of the block face layers');
    assert.equal(sim.span[i], 0.25, '4x4 pixel patch');
    assert.ok(sim.u0[i] >= 0 && sim.u0[i] <= 0.75 && sim.v0[i] >= 0 && sim.v0[i] <= 0.75);
    assert.equal(sim.sky[i], 15, 'lit by the world light of the broken cell');
  }
  for (let t = 0; t < 60; t++) sim.tick(fakeWorld(), t);
  assert.equal(sim.count, 0, 'all particles expire within 60 ticks');
});

test('mining dust from a solid block takes the light of the open face, not black', () => {
  const w = fakeWorld();
  assert.equal(lightAround(w, 0, 63, 0) >> 4, 15, 'stone at y 63 under open sky: lit from above');
  assert.equal(lightAround(w, 0, 64, 0) >> 4, 15, 'air cell keeps its own light');
  assert.equal(lightAround(w, 0, 40, 0), 0, 'buried stone stays dark');
  const sim = new ParticleSim();
  sim.blockBreak(0, 63, 0, ID.stone, 0, w, 2);   // the hit-particle path samples the (still solid) mined block
  for (let i = 0; i < sim.count; i++) assert.equal(sim.sky[i], 15);
});

test('particles land on the ground instead of falling through', () => {
  const sim = new ParticleSim();
  sim.blockBreak(0, 64, 0, ID.dirt, 0, fakeWorld());
  for (let t = 0; t < 15; t++) {
    sim.tick(fakeWorld(), t);
    for (let i = 0; i < sim.count; i++) assert.ok(sim.y[i] >= 64 - 1e-6, `particle ${i} above the ground (y ${sim.y[i]})`);
  }
});

test('particle pool is capped at 2000 and stays packed', () => {
  const sim = new ParticleSim();
  for (let k = 0; k < 300; k++) sim.spawn('smoke', 0, 70, 0, { count: 10 }, fakeWorld());
  assert.equal(sim.count, MAX_PARTICLES);
  assert.equal(sim.spawn('heart', 0, 70, 0, {}, fakeWorld()), 0, 'full pool rejects new particles');
  for (let t = 0; t < 45; t++) sim.tick(fakeWorld(), t);
  assert.equal(sim.count, 0);
});

test('every particle kind spawns and has a drawable sprite or layer', () => {
  const sim = new ParticleSim();
  const water = new Map([['0,70,0', ID.water]]);
  for (const kind of PARTICLE_KINDS) {
    const before = sim.count;
    const n = sim.spawn(kind, 0.5, 70.5, 0.5, { id: ID.stone, count: 3, spread: 0, colors: [[1, 0, 0]] }, fakeWorld(water));
    assert.ok(n > 0, `${kind} spawns`);
    for (let i = before; i < sim.count; i++) {
      const l = sim.drawLayer(i);
      assert.ok(Number.isFinite(l), `${kind} layer`);
      if (l < 0) assert.ok(-1 - l < SPRITE_COLS * SPRITE_COLS, `${kind} sprite index in the atlas`);
      assert.ok(sim.drawSize(i) > 0, `${kind} size`);
    }
  }
  assert.equal(sim.spawn('nope', 0, 70, 0), 0, 'unknown kinds are ignored');
});

test('bubbles die outside water; far particles are not spawned', () => {
  const sim = new ParticleSim();
  sim.spawn('bubble', 0.5, 70.5, 0.5, { count: 4, spread: 0 }, fakeWorld());
  sim.tick(fakeWorld(), 0);
  assert.equal(sim.count, 0, 'no water -> bubbles pop');
  sim.viewer = { x: 0, y: 70, z: 0 };
  assert.equal(sim.spawn('smoke', 200, 70, 0, {}, fakeWorld()), 0, 'beyond 48 blocks nothing spawns');
  assert.equal(sim.blockBreak(200, 64, 0, ID.stone, 0, fakeWorld()), 0);
  assert.ok(sim.spawn('smoke', 10, 70, 0, {}, fakeWorld()) > 0);
});

test('cutout textures: patch picker prefers opaque pixels', () => {
  const sim = new ParticleSim();
  const layer = 5;
  const px = new Uint8Array(16 * 16 * 4);
  for (let y = 12; y < 16; y++) for (let x = 12; x < 16; x++) px[(y * 16 + x) * 4 + 3] = 255;   // only one corner opaque
  sim.texPixels = () => px;
  let hits = 0;
  for (let k = 0; k < 200; k++) {
    const i = sim._alloc(0, 70, 0, null);
    sim.pickPatch(i, layer);
    if (sim.u0[i] >= 11 / 16 && sim.v0[i] >= 11 / 16) hits++;  // patches with >= 12 of 16 opaque pixels
    sim.kill(i);
  }
  assert.equal(hits, 200, `patches come from the opaque area (${hits}/200)`);
});

/* ------------------------------------------------------------------ sprites, sky */

test('sprite atlas, sun, moon and weather textures are deterministic', () => {
  const a = buildSpriteAtlas(), b = buildSpriteAtlas();
  assert.equal(a.w, SPRITE_ATLAS_SIZE);
  assert.deepEqual(a.data, b.data);
  const cellOpaque = (cell) => {
    let n = 0;
    const cx = (cell % SPRITE_COLS) * SPRITE_CELL, cy = Math.floor(cell / SPRITE_COLS) * SPRITE_CELL;
    for (let y = 0; y < SPRITE_CELL; y++) for (let x = 0; x < SPRITE_CELL; x++) if (a.data[((cy + y) * a.w + cx + x) * 4 + 3] > 127) n++;
    return n;
  };
  for (const k of Object.keys(SPRITE)) assert.ok(cellOpaque(SPRITE[k]) > 0, `sprite ${k} drawn`);
  for (let s = 1; s < 8; s++) assert.ok(cellOpaque(SPRITE.GENERIC + s) >= cellOpaque(SPRITE.GENERIC + s - 1), 'puffs grow with the index');
  assert.deepEqual(buildSunTexture().data, buildSunTexture().data);
  assert.deepEqual(buildWeatherTexture().data, buildWeatherTexture().data);
});

test('moon: 8 phases, full is brightest, new is dark, waning then waxing', () => {
  const m = buildMoonTexture();
  const lit = (p) => {
    let n = 0;
    const ox = (p % 4) * 16, oy = Math.floor(p / 4) * 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (m.data[((oy + y) * m.w + ox + x) * 4] > 100) n++;
    return n;
  };
  const L = [0, 1, 2, 3, 4, 5, 6, 7].map(lit);
  assert.ok(L[0] > 80, `full moon lit (${L[0]})`);
  assert.equal(L[4], 0, 'new moon dark');
  assert.ok(L[0] > L[1] && L[1] > L[2] && L[2] > L[3] && L[3] > L[4], `waning (${L})`);
  assert.ok(L[4] < L[5] && L[5] < L[6] && L[6] < L[7] && L[7] < L[0], `waxing (${L})`);
});

test('cloud map: deterministic, tiles, ~38% cover; cloud mesh culls inner sides', () => {
  const c = buildCloudMap(), d = buildCloudMap();
  assert.deepEqual(c.map, d.map);
  const cover = c.map.reduce((a, v) => a + v, 0) / c.map.length;
  assert.ok(cover > 0.3 && cover < 0.46, `cover ${cover}`);
  assert.equal(c.at(3, 5), c.at(3 + CLOUD_MAP_SIZE, 5 - CLOUD_MAP_SIZE), 'pattern repeats');
  const g = buildCloudGeometry(c, 8);
  let cells = 0;
  for (let j = -8; j < 8; j++) for (let i = -8; i < 8; i++) cells += c.at(i, j);
  assert.ok(g.quads >= cells * 2 && g.quads < cells * 6, `top+bottom per cell, sides only on edges (${g.quads} quads, ${cells} cells)`);
  assert.equal(g.position.length, g.quads * 12);
  assert.ok(g.index.every((i) => i < g.quads * 4));
  const flat = buildFlatCloudGeometry(c, 8);
  let flatCells = 0;
  for (let z = -8; z < 8; z++) for (let x = -8; x < 8; x++) if (c.at(x, z)) flatCells++;
  let area = 0;
  for (let q = 0; q < flat.quads; q++) { const p = flat.position; area += (p[q * 12 + 3] - p[q * 12]) * (p[q * 12 + 8] - p[q * 12 + 2]); }
  assert.equal(area, flatCells * 12 * 12, 'flat clouds cover exactly the cloud cells');
  assert.ok(flat.quads < g.quads / 3, `flat clouds are much lighter (${flat.quads} vs ${g.quads} quads)`);
});

test('star field: deterministic ~1200 quads', () => {
  const a = buildStarGeometry(), b = buildStarGeometry();
  assert.ok(a.count > 1000, `stars ${a.count}`);
  assert.deepEqual(Array.from(a.geometry.getAttribute('position').array.slice(0, 30)), Array.from(b.geometry.getAttribute('position').array.slice(0, 30)));
});

/* ------------------------------------------------------------------ items */

test('extrudeSprite: one voxel per opaque pixel, edges only where needed', () => {
  const one = new Uint8Array(16 * 16 * 4);
  one[(5 * 16 + 7) * 4 + 3] = 255;
  assert.equal(extrudeSprite(one).quads, 6, 'single pixel = a little cube');
  const full = new Uint8Array(16 * 16 * 4).fill(255);
  const e = extrudeSprite(full);
  assert.equal(e.quads, 2 * 256 + 4 * 16, 'front + back + outer rim');
  for (let i = 0; i < e.position.length; i += 3) {
    assert.ok(e.position[i] >= -0.5 && e.position[i] <= 0.5);
    assert.ok(e.position[i + 1] >= 0 && e.position[i + 1] <= 1);
    assert.ok(Math.abs(e.position[i + 2]) <= 1 / 32 + 1e-9);
  }
  assert.equal(e.color.length, e.quads * 12);
});

test('itemVisual + ItemMeshFactory: cached shared geometry, dispose keeps it', () => {
  const game = { textures, icons: null };
  assert.equal(itemVisual(game, 'stone').kind, 'block');
  assert.equal(itemVisual(game, 'torch').kind, 'flat');
  assert.equal(itemVisual(game, 'diamond').kind, 'flat');
  const mats = { atlas: new THREE.MeshBasicMaterial(), color: new THREE.MeshBasicMaterial(), hook() {} };
  const f = new ItemMeshFactory(game, mats);
  const a = f.make('stone'), b = f.make('stone'), c = f.make('diamond');
  assert.equal(a.userData.fxMesh.geometry, b.userData.fxMesh.geometry, 'same key shares geometry');
  assert.notEqual(a.userData.fxMesh.geometry, c.userData.fxMesh.geometry);
  assert.equal(f.cache.size, 2);
  let disposed = 0;
  a.userData.fxMesh.geometry.addEventListener('dispose', () => disposed++);
  const parent = new THREE.Group(); parent.add(a);
  f.dispose(a); f.dispose(a);
  assert.equal(a.parent, null, 'detached from the scene');
  assert.equal(disposed, 0, 'shared geometry is never disposed by disposeItemMesh');
  assert.equal(f.live, 2);
  assert.ok(Math.abs(a.userData.fxKind === 'block' ? b.userData.fxMesh.scale.x - 0.25 : 0) < 1e-9, 'block items are 0.25 blocks');
  assert.ok(Math.abs(c.userData.fxMesh.scale.x - 0.5) < 1e-9, 'flat items are 0.5 blocks wide');
  for (let i = 0; i < 100; i++) f.dispose(f.make('stone'));
  assert.equal(f.cache.size, 2, '100 make/dispose cycles add no geometry');
});

test('paletteOf: most common opaque colours first', () => {
  const px = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 40; i++) px.set([200, 10, 10, 255], i * 4);
  for (let i = 40; i < 50; i++) px.set([10, 200, 10, 255], i * 4);
  const p = paletteOf(px);
  assert.equal(p.length, 2);
  assert.ok(p[0][0] > 0.7 && p[1][1] > 0.7);
});

/* ------------------------------------------------------------------ crack + ghost */

test('crack geometry: inflated boxes with crack layer and projected UVs', () => {
  const d = crackGeometryData([[0, 0, 0, 1, 1, 1]], 77);
  assert.equal(d.quads, 6);
  for (let i = 0; i < d.position.length; i++) assert.ok(d.position[i] >= -0.003 && d.position[i] <= 1.003);
  for (let v = 0; v < d.quads * 4; v++) {
    assert.equal(d.tex[v * 4], 77);
    assert.ok(d.tex[v * 4 + 1] <= 256 && d.tex[v * 4 + 2] <= 256);
  }
  const slab = crackGeometryData([[0, 0, 0, 1, 0.5, 1]], 3);
  let maxY = 0;
  for (let i = 1; i < slab.position.length; i += 3) maxY = Math.max(maxY, slab.position[i]);
  assert.ok(maxY < 0.51, 'follows the selection box (slab)');
});

test('ghostPlacement mirrors the placement rules', () => {
  const w = fakeWorld();
  const player = { x: 10.5, y: 64, z: 10.5, width: 0.6, height: 1.8, yaw: 0 };
  const top = { x: 0, y: 63, z: 0, nx: 0, ny: 1, nz: 0, id: ID.stone, py: 64 };
  assert.deepEqual(ghostPlacement(w, top, 'oak_planks', player), { x: 0, y: 64, z: 0, id: ID.oak_planks, state: 0 });
  assert.equal(ghostPlacement(w, top, 'diamond', player), null, 'non-placeable items show no ghost');
  assert.equal(ghostPlacement(w, top, null, player), null);
  // replaceable target cell is filled directly
  const grassy = fakeWorld(new Map([['0,64,0', ID.short_grass]]));
  const hitGrass = { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, id: ID.short_grass };
  assert.deepEqual(ghostPlacement(grassy, hitGrass, 'stone', player), { x: 0, y: 64, z: 0, id: ID.stone, state: 0 });
  // never inside the player
  const under = { x: 10, y: 63, z: 10, nx: 0, ny: 1, nz: 0, id: ID.stone };
  assert.equal(ghostPlacement(w, under, 'stone', player), null);
  const lawn = fakeWorld(new Map([['10,63,10', ID.grass_block]]));
  assert.ok(ghostPlacement(lawn, under, 'poppy', player), 'non-solid plants may go at the feet');
  assert.equal(ghostPlacement(w, under, 'poppy', player), null, 'flowers only on soil (same support rules as placing)');
  // torches: floor = 0, wall = 1 + facing toward the wall, ceiling refused
  const side = { x: 0, y: 64, z: 0, nx: 0, ny: 0, nz: 1, id: ID.stone };
  const ws = fakeWorld(new Map([['0,64,0', ID.stone]]));
  assert.equal(ghostPlacement(ws, { ...top, y: 64 }, 'torch', player).state, 0);
  assert.equal(ghostPlacement(ws, side, 'torch', player).state, 1 + 0, 'wall to the north');
  assert.equal(ghostPlacement(ws, { ...side, ny: -1, nz: 0, y: 64 }, 'torch', player), null);
  // facing blocks face the player
  const furnace = ghostPlacement(w, top, 'furnace', player);
  assert.equal(furnace.state & 3, 2, 'player looking north -> front faces south');
});

/* ------------------------------------------------------------------ player model + flash */

test('skin painter is deterministic and uses settings.skin colours', () => {
  const a = paintSkin({ shirt: '#ff0000' }), b = paintSkin({ shirt: '#ff0000' }), c = paintSkin({ shirt: '#00ff00' });
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, c.data);
  // body front pixel (shirt) is reddish for a red shirt
  const i = ((16 + 4 + 6) * 64 + (16 + 4 + 1)) * 4;
  assert.ok(a.data[i] > 180 && a.data[i + 1] < 60, `shirt colour (${a.data.slice(i, i + 3)})`);
  // face has eye whites
  let whites = 0;
  for (let x = 8; x < 16; x++) { const k = ((8 + 4) * 64 + x) * 4; if (a.data[k] > 220 && a.data[k + 1] > 220 && a.data[k + 2] > 220) whites++; }
  assert.equal(whites, 2, 'two eye whites on the face');
});

test('player geometry: 6 parts, 24 vertices each; pose puts parts at their pivots', () => {
  const g = buildPlayerGeometry();
  assert.equal(g.getAttribute('position').count, 6 * 24);
  const parts = g.getAttribute('aPart').array;
  for (let p = 0; p < 6; p++) assert.equal(parts.filter((v) => v === p).length, 24);
  const one = buildPartsGeometry([{ box: PARTS[2].box, uv: PARTS[2].uv, part: 0 }]);
  assert.equal(one.getAttribute('position').count, 24);
  const uv = one.getAttribute('uv').array;
  assert.ok(uv.every((v) => v >= 0 && v <= 1));
  const mats = Array.from({ length: 6 }, () => new THREE.Matrix4());
  posePlayer(mats, { headYaw: 0, headPitch: 0, limbSwing: 0, limbAmount: 0, swing: 0 });
  const v = new THREE.Vector3();
  for (let i = 0; i < 6; i++) { v.set(0, 0, 0).applyMatrix4(mats[i]); assert.deepEqual([v.x, v.y, v.z].map(Math.round), PARTS[i].pivot); }
});

test('flash limiter: at most 3 flashes in any second', () => {
  const f = new FlashLimiter(3);
  let n = 0;
  for (let i = 0; i < 10; i++) if (f.allow(1000 + i * 10)) n++;
  assert.equal(n, 3);
  assert.equal(f.allow(1500), false);
  assert.equal(f.allow(2001), true, 'allowed again a second later');
});
