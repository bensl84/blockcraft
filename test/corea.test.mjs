// OWNER LANE: CORE-A. Unit tests for textures, item icons and the pixel toolkit (SPEC §5.1, §13.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTextures, getTexturePixels, PAINTERS, isCutoutKey, TEX_SIZE, ICON_SIZE } from '../src/textures/textures.js';
import { paintIconAtlas } from '../src/textures/icons.js';
import { hasSprite, SPRITES } from '../src/textures/sprites.js';
import { ANIMATED, TRANSLUCENT_ALPHA, WATER_ALPHA } from '../src/textures/tex_anim.js';
import { texRng, hash2, vnoise, fbm, voronoiWrap, quant, PixelCanvas, tnoise } from '../src/textures/toolkit.js';
import { REQUIRED_TEXTURE_KEYS, ANIMATED_TEXTURES, PASS, faceTexKey } from '../src/core/registry.js';
import { BLOCKS } from '../src/data/blocks.js';
import { FACE } from '../src/core/constants.js';
import { ITEM_LIST, requiredSprites } from '../src/data/items.js';
import { hashString } from '../src/core/math.js';

const ts = buildTextures();
const px = (k, f = 0) => getTexturePixels(ts, k, f);
const fnv = (b) => hashString(Buffer.from(b).toString('latin1'));

test('texa-determinism: same bytes every build; fastLeaves only touches leaves; halfAnim halves water/lava', () => {
  const again = buildTextures();
  assert.equal(fnv(again.data), fnv(ts.data));
  const fast = buildTextures({ fastLeaves: true });
  for (const k of REQUIRED_TEXTURE_KEYS) {
    const same = fnv(getTexturePixels(fast, k)) === fnv(px(k));
    if (k.endsWith('_leaves')) assert.ok(!same, `${k} differs in fast mode`);
    else assert.ok(same, `${k} unaffected by fastLeaves`);
  }
  for (const k of ['oak_leaves', 'birch_leaves', 'spruce_leaves']) {
    const p = getTexturePixels(fast, k);
    for (let i = 3; i < p.length; i += 4) assert.equal(p[i], 255, `${k} fast leaves are opaque`);
  }
  const half = buildTextures({ halfAnim: true });
  assert.equal(half.animated.get('water').frames, 8);
  assert.equal(half.animated.get('lava').frames, 8);
  assert.equal(half.animated.get('fire').frames, 8);
  assert.equal(half.animated.get('water').fps, 4);
  assert.equal(half.count, ts.count - 16);
  for (let f = 0; f < 8; f++) assert.equal(fnv(getTexturePixels(half, 'water', f)), fnv(px('water', f * 2)), 'half frames sample the full loop');
});

test('layer list is exactly REQUIRED_TEXTURE_KEYS in sorted order, animated keys consecutive', () => {
  const keys = [...ts.index.keys()];
  assert.deepEqual(keys, [...REQUIRED_TEXTURE_KEYS]);
  let next = 0;
  for (const k of keys) {
    assert.equal(ts.index.get(k), next, `${k} layer`);
    next += ts.animated.has(k) ? ts.animated.get(k).frames : 1;
  }
  assert.equal(next, ts.count);
  assert.ok(ts.count <= 256);
  for (const k of Object.keys(ANIMATED_TEXTURES)) assert.ok(ts.animated.has(k));
  assert.equal(ts.layer('definitely_not_a_key'), ts.layer('missing'));
  assert.equal(TEX_SIZE, 16); assert.equal(ICON_SIZE, 32);
});

test('every required key has a real painter (no magenta fallback)', () => {
  for (const k of REQUIRED_TEXTURE_KEYS) assert.ok(PAINTERS[k] || ANIMATED[k], `painter for ${k}`);
});

test('alpha classes: cutout 0/255 with bled RGB, translucent constant alpha, everything else opaque', () => {
  for (const k of REQUIRED_TEXTURE_KEYS) {
    const frames = ts.animated.has(k) ? ts.animated.get(k).frames : 1;
    for (let f = 0; f < frames; f++) {
      const p = px(k, f);
      const alphas = new Set();
      for (let i = 3; i < p.length; i += 4) alphas.add(p[i]);
      if (k.startsWith('crack_')) { for (const a of alphas) assert.ok([0, 70, 150].includes(a), `${k} alpha ${a}`); continue; }
      if (k === 'water') { assert.deepEqual([...alphas], [WATER_ALPHA]); continue; }
      if (TRANSLUCENT_ALPHA[k] !== undefined) { assert.deepEqual([...alphas], [TRANSLUCENT_ALPHA[k]], k); continue; }
      if (isCutoutKey(k)) {
        for (const a of alphas) assert.ok(a === 0 || a === 255, `${k} cutout alpha ${a}`);
        assert.ok(alphas.has(255), `${k} has opaque texels`);
        // bleeding: transparent texels carry colour (no black fringe in mipmaps)
        let dark = 0, clear = 0;
        for (let i = 0; i < p.length; i += 4) if (!p[i + 3]) { clear++; if (p[i] + p[i + 1] + p[i + 2] < 20) dark++; }
        assert.ok(dark <= clear * 0.05, `${k}: ${dark}/${clear} transparent texels are black`);
        continue;
      }
      assert.deepEqual([...alphas], [255], `${k} opaque`);
    }
  }
  // every translucent / cutout block resolves to textures of the right class
  for (const b of BLOCKS) {
    if (!b || b.pass !== 'translucent') continue;
    const key = faceTexKey(b.id, 0, FACE.UP);
    assert.ok(key === 'water' || TRANSLUCENT_ALPHA[key] !== undefined, `${b.name} (${key}) has a translucent texture`);
  }
  void PASS;
});

test('crack stages grow monotonically and use the spec alphas', () => {
  let prev = 0;
  for (let s = 0; s < 10; s++) {
    const p = px('crack_' + s);
    let core = 0, halo = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] === 150) core++; else if (p[i + 3] === 70) halo++;
      if (p[i + 3]) assert.equal(p[i] + p[i + 1] + p[i + 2], 0, 'cracks are black');
    }
    assert.ok(core >= prev && core > 0 && halo > 0, `crack_${s} core ${core}`);
    assert.ok(core <= Math.ceil((60 * (s + 1)) / 10), `crack_${s} shows at most ceil(60(s+1)/10) core pixels`);
    prev = core;
  }
});

test('terrain textures tile seamlessly (wrap seams no harsher than the interior)', () => {
  const lumAt = (p, x, y) => { const i = ((y & 15) * 16 + (x & 15)) * 4; return 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]; };
  for (const k of ['stone', 'dirt', 'grass_top', 'sand', 'gravel', 'cobblestone', 'oak_planks', 'oak_log', 'snow', 'clay', 'andesite', 'granite', 'diorite', 'water', 'lava', 'glowstone', 'wool_red', 'obsidian', 'bedrock']) {
    const p = px(k);
    let inner = 0, seam = 0, n = 0, m = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.abs(lumAt(p, x, y) - lumAt(p, x + 1, y)) + Math.abs(lumAt(p, x, y) - lumAt(p, x, y + 1));
      if (x === 15 || y === 15) { seam += d; m++; } else { inner += d; n++; }
    }
    assert.ok(seam / m <= (inner / n) * 1.9 + 6, `${k}: seam ${(seam / m).toFixed(1)} vs interior ${(inner / n).toFixed(1)}`);
  }
});

test('animations loop seamlessly (last frame -> first frame is an ordinary step)', () => {
  for (const k of ['water', 'lava', 'fire']) {
    const n = ts.animated.get(k).frames;
    const diff = (a, b) => { let s = 0; const A = px(k, a), B = px(k, b); for (let i = 0; i < A.length; i++) s += Math.abs(A[i] - B[i]); return s; };
    let avg = 0;
    for (let f = 0; f < n - 1; f++) avg += diff(f, f + 1);
    avg /= n - 1;
    const wrap = diff(n - 1, 0);
    assert.ok(wrap <= avg * 1.8, `${k} wrap step ${wrap} vs average ${avg.toFixed(0)}`);
    assert.ok(avg > 0, `${k} actually animates`);
  }
});

test('style: compact palettes (pixel art, no anti-aliasing gradients)', () => {
  for (const [k, L] of ts.index) {
    if (ts.animated.has(k)) continue;
    const d = ts.data.subarray(L * 1024, L * 1024 + 1024);
    const s = new Set();
    for (let i = 0; i < 1024; i += 4) if (d[i + 3]) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    assert.ok(s.size <= 28, `${k} uses ${s.size} colours`);
  }
});

test('icons: every item gets a non-empty 32px cell; sprites cover requiredSprites(); deterministic', () => {
  const a = paintIconAtlas(ts);
  assert.equal(a.cols * 32, a.width);
  assert.equal(a.index.size, ITEM_LIST.length);
  for (const n of requiredSprites()) assert.ok(hasSprite(n), `sprite ${n}`);
  for (const it of ITEM_LIST) {
    const i = a.index.get(it.key);
    const ox = (i % a.cols) * 32, oy = Math.floor(i / a.cols) * 32;
    let n = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (a.data[((oy + y) * a.width + ox + x) * 4 + 3]) n++;
    assert.ok(n >= 40, `${it.key} icon has ${n} pixels`);
    const s16 = a.sprite16.get(it.key);
    assert.ok(s16 && s16.length === 1024, `${it.key} pixels16`);
  }
  const b = paintIconAtlas(ts);
  assert.equal(fnv(a.data), fnv(b.data), 'icon atlas is deterministic');
  // tints and egg colours reach the pixels
  const cell = (k) => { const i = a.index.get(k); const ox = (i % a.cols) * 32, oy = Math.floor(i / a.cols) * 32; const out = []; for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const j = ((oy + y) * a.width + ox + x) * 4; out.push(a.data[j], a.data[j + 1], a.data[j + 2], a.data[j + 3]); } return fnv(out); };
  assert.notEqual(cell('red_dye'), cell('blue_dye'));
  assert.notEqual(cell('red_bed'), cell('lime_bed'));
  assert.notEqual(cell('pig_spawn_egg'), cell('cow_spawn_egg'));
  assert.notEqual(cell('iron_pickaxe'), cell('diamond_pickaxe'));
  for (const name of Object.keys(SPRITES)) assert.equal(typeof SPRITES[name], 'function');
});

test('performance: warm builds stay well inside the boot budget', () => {
  for (let i = 0; i < 3; i++) buildTextures();
  let t0 = performance.now();
  for (let i = 0; i < 5; i++) buildTextures();
  const tex = (performance.now() - t0) / 5;
  paintIconAtlas(ts); paintIconAtlas(ts);
  t0 = performance.now();
  for (let i = 0; i < 5; i++) paintIconAtlas(ts);
  const ic = (performance.now() - t0) / 5;
  assert.ok(tex < 60, `buildTextures ${tex.toFixed(1)} ms`);
  assert.ok(ic < 150, `paintIconAtlas ${ic.toFixed(1)} ms`);
});

test('toolkit: deterministic, tiling, stable signatures', () => {
  assert.equal(texRng('stone')(), texRng('stone')());
  assert.equal(hash2(3, 4, 5), hash2(3, 4, 5));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    assert.ok(Math.abs(vnoise(x, y, 4, 7) - vnoise(x + 16, y + 16, 4, 7)) < 1e-12, 'vnoise tiles');
    assert.ok(Math.abs(tnoise(x, y, 2, 8, 7) - tnoise(x + 16, y - 16, 2, 8, 7)) < 1e-12, 'tnoise tiles');
    const v = fbm(x, y, 3);
    assert.ok(v >= 0 && v < 1);
  }
  const v = voronoiWrap(0, 0, [[15.5, 15.5], [8, 8]]);
  assert.equal(v.id, 0, 'voronoi wraps across the edge');
  assert.equal(quant(0.99, ['a', 'b']), 'b');
  const pc = new PixelCanvas(16, 16);
  for (const m of ['set', 'get', 'alpha', 'fill', 'bevel', 'outline', 'copyTo', 'toCanvas']) assert.equal(typeof pc[m], 'function', m);
  pc.set(-1, -1, '#ff0000');
  assert.deepEqual(pc.get(15, 15), [255, 0, 0, 255], 'set wraps');
  pc.outline('#000000');
  assert.equal(pc.alpha(14, 15), 255);
  const target = new Uint8Array(2048);
  pc.copyTo(target, 1024);
  assert.equal(target[1024 + (15 * 16 + 15) * 4], 255);
});
