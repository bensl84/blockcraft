// OWNER LANE: CORE-D. Unit tests for the pure renderer modules: sky, quality presets + dynamic scaling,
// quad index buffers + column merge, shader contract strings, outline geometry, entity material cloning.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SKY_PALETTE, celestialAngle, computeSky, daylightFor } from '../src/render/sky.js';
import { DynamicScaler, SCALE, detectPreset } from '../src/render/quality.js';
import { U16_QUADS, degenerateSection, mergeColumnPass, quadCenters, quadIndices, sortQuadsBackToFront, withCorner } from '../src/render/chunkmerge.js';
import { CHUNK_FRAG, CHUNK_VERT, ENTITY_FRAG, ENTITY_VERT, SKY_FRAG } from '../src/render/shaders.js';
import { lineSegmentsFor, ribbonFor } from '../src/render/outline.js';
import { SHARED_ENTITY_UNIFORMS, makeEntityMaterial } from '../src/render/entitymat.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/* ------------------------------------------------------------------ sky */
test('sky: daylight follows the Java celestial curve', () => {
  assert.equal(computeSky(6000).daylight, 1, 'noon');
  assert.equal(computeSky(18000).daylight, 0, 'midnight');
  const dawn = computeSky(23500).daylight;
  assert.ok(dawn > 0.4 && dawn < 0.8, 'dawn (23500) is half-lit');
  assert.ok(computeSky(22500).daylight < dawn && dawn < computeSky(0).daylight, 'brightens through dawn');
  assert.ok(close(celestialAngle(6000), 0), 'noon angle 0');
  assert.ok(close(celestialAngle(18000), 0.5), 'midnight angle 0.5');
  assert.ok(computeSky(12000).daylight > 0.8 && computeSky(13000).daylight < 0.45 && computeSky(13500).daylight < 0.1, 'dusk darkens fast after 12000');
  assert.ok(close(computeSky(6000, 1).daylight, 0.75), 'rain caps daylight at 0.75');
  assert.ok(close(daylightFor(0), 1));
});

test('sky: colours, sunset glow, stars, sun direction', () => {
  const noon = computeSky(6000), night = computeSky(18000), rise = computeSky(23500), set = computeSky(12300);
  assert.deepEqual(noon.skyColor.map((v) => Math.round(v * 1000)), SKY_PALETTE.DAY_SKY.map((v) => Math.round(v * 1000)));
  assert.deepEqual(night.skyColor.map((v) => Math.round(v * 1000)), SKY_PALETTE.NIGHT_SKY.map((v) => Math.round(v * 1000)));
  assert.equal(noon.sunsetColor, null);
  assert.equal(night.sunsetColor, null);
  assert.ok(rise.sunsetColor && rise.sunsetColor[3] > 0.5, 'sunrise glow');
  assert.ok(set.sunsetColor && set.sunsetColor[0] > set.sunsetColor[2], 'sunset glow is warm');
  assert.equal(noon.starBrightness, 0);
  assert.ok(night.starBrightness > 0.5);
  for (const s of [noon, night, rise, set]) {
    assert.ok(close(Math.hypot(...s.sunDir), 1, 1e-9), 'sunDir is a unit vector');
    for (const c of [...s.skyColor, ...s.fogColor]) assert.ok(c >= 0 && c <= 1);
  }
  assert.ok(rise.sunDir[0] > 0.95, 'sun rises in the east (+X)');
  assert.ok(noon.sunDir[1] > 0.99, 'sun overhead at noon');
  assert.ok(set.sunDir[0] < 0, 'sun sets in the west (-X)');
  assert.equal(computeSky(6000, 0, 13).moonPhase, 5);
});

test('sky: no colour jumps through a whole day (smooth uniforms, no remesh needed)', () => {
  let prev = computeSky(0);
  for (let t = 20; t <= 24000; t += 20) {
    const s = computeSky(t % 24000);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(s.skyColor[i] - prev.skyColor[i]) < 0.03, `sky jump at ${t}`);
      assert.ok(Math.abs(s.fogColor[i] - prev.fogColor[i]) < 0.03, `fog jump at ${t}`);
    }
    assert.ok(Math.abs(s.daylight - prev.daylight) < 0.03, `daylight jump at ${t}`);
    prev = s;
  }
});

/* ------------------------------------------------------------------ quality */
test('quality: presets from GPU strings (SPEC §5.5.6)', () => {
  const p = (s, o) => detectPreset(s, o);
  assert.deepEqual([p('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)').renderDistance, p('llvmpipe (LLVM 15.0.7, 256 bits)').preset], [4, 'low']);
  const hd = p('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(hd.renderDistance, 5); assert.equal(hd.dprCap, 1); assert.equal(hd.fastLeaves, true);
  const iris = p('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(iris.renderDistance, 6); assert.equal(iris.dprCap, 1.25); assert.equal(iris.fastLeaves, false);
  assert.equal(p('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)').renderDistance, 6);
  const rtx = p('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Ti (0x00002208) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(rtx.renderDistance, 8); assert.equal(rtx.dprCap, 1.5);
  const touch = p('Apple GPU', { touchPrimary: true });
  assert.equal(touch.renderDistance, 5); assert.equal(touch.dprCap, 1);
});

function feed(sc, from, to, ms, work = 10) {
  const acts = [];
  for (let t = from; t <= to; t += ms) { const a = sc.sample(t, ms, work); if (a) acts.push({ t, ...a }); }
  return acts;
}

test('quality: dynamic scaler lowers DPR first, then R; respects warm-up, cooldown and manual R', () => {
  const sc = new DynamicScaler({ dpr: 1.25, dprMax: 1.25, r: 6, rMax: 6 });
  assert.equal(feed(sc, 0, 4900, 40).length, 0, 'first 5 s ignored');
  const acts = feed(sc, 4940, 30000, 40);
  assert.deepEqual(acts.slice(0, 3).map((a) => [a.type, a.value]), [['dpr', 1], ['dpr', 0.75], ['r', 5]]);
  for (let i = 1; i < acts.length; i++) assert.ok(acts[i].t - acts[i - 1].t >= SCALE.COOLDOWN_MS, 'cooldown between changes');
  assert.ok(acts.every((a) => a.type === 'dpr' || a.value >= SCALE.R_MIN), 'R never below 3');

  const manual = new DynamicScaler({ dpr: 1, dprMax: 1, r: 8, rMax: 8, manualR: true });
  const m = feed(manual, 0, 60000, 40);
  assert.ok(m.length >= 1 && m.every((a) => a.type === 'dpr'), 'manual R: only DPR changes');
});

test('quality: 30 Hz displays with light work never scale down; fast frames raise R to the preset max', () => {
  const sc = new DynamicScaler({ dpr: 1, dprMax: 1, r: 6, rMax: 6 });
  assert.equal(feed(sc, 0, 60000, 33.3, 3).length, 0, '30 Hz vsync, work 3 ms: no change');
  const up = new DynamicScaler({ dpr: 1, dprMax: 1, r: 4, rMax: 6 });
  const acts = feed(up, 0, 60000, 8);
  assert.deepEqual(acts.map((a) => [a.type, a.value]), [['r', 5], ['r', 6]]);
});

/* ------------------------------------------------------------------ geometry */
test('chunkmerge: shared quad index buffers (u16 up to 16384 quads, u32 beyond, grown by doubling)', () => {
  const a = quadIndices(3);
  assert.ok(a instanceof Uint16Array);
  assert.deepEqual([...a], [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
  assert.equal(quadIndices(U16_QUADS).length, U16_QUADS * 6);
  assert.equal(quadIndices(5).buffer, a.buffer, 'views of one shared array');
  const big = quadIndices(U16_QUADS + 1);
  assert.ok(big instanceof Uint32Array);
  assert.equal(big[U16_QUADS * 6 + 5], (U16_QUADS) * 4 + 3);
  const huge = quadIndices(U16_QUADS * 5);
  assert.equal(huge.length, U16_QUADS * 30);
  assert.equal(huge[huge.length - 1], U16_QUADS * 5 * 4 - 1);
  assert.equal(big[big.length - 1], (U16_QUADS + 1) * 4 - 1, 'an older view is still valid after a grow');
});

function buf(quads, seed) {
  const b = { position: new Float32Array(quads * 12), tex: new Uint16Array(quads * 16), light: new Uint8Array(quads * 16), quads };
  for (let i = 0; i < b.position.length; i++) b.position[i] = (i % 3 === 1 ? 2 : 1) + seed;
  b.tex.fill(seed); b.light.fill(seed);
  return b;
}

test('chunkmerge: merging sections offsets y, keeps old ranges, and degenerates edited sections', () => {
  const s = [undefined, undefined, buf(2, 1), undefined, buf(3, 5), null, undefined, undefined];
  const m1 = mergeColumnPass(null, s);
  assert.equal(m1.quads, 5);
  assert.deepEqual([...m1.ranges], [0, 0, 0, 0, 0, 2, 2, 0, 2, 3, 5, 0, 5, 0, 5, 0]);
  assert.equal(m1.minSy, 2); assert.equal(m1.maxSy, 4);
  assert.equal(m1.position[1], 3 + 32, 'section 2 y offset by 32');
  assert.equal(m1.position[0], 2, 'x untouched');
  assert.equal(m1.position[2 * 12 + 1], 7 + 64, 'section 4 y offset by 64');
  assert.equal(m1.tex[2 * 16], 5);
  // replace section 2 only; section 4 is copied from the old merge
  const m2 = mergeColumnPass(m1, [undefined, undefined, buf(1, 9), undefined, undefined, undefined, undefined, undefined]);
  assert.equal(m2.quads, 4);
  assert.equal(m2.position[1], 11 + 32);
  assert.equal(m2.position[12 + 1], 7 + 64, 'old section 4 data kept (already offset)');
  assert.equal(m2.tex[16], 5, 'old section 4 tex kept');
  // degenerate section 4 in place
  const range = degenerateSection(m2, 4);
  assert.deepEqual(range, [12, 36]);
  assert.ok(m2.position.subarray(12, 48).every((v) => v === 0));
  assert.equal(m2.ranges[9], 0, 'degenerated slot holds no live quads');
  assert.equal(mergeColumnPass(m2, new Array(8).fill(undefined)).quads, 1, 're-merge drops the degenerate quads');
  assert.equal(mergeColumnPass(null, new Array(8).fill(null)), null);
});

test('chunkmerge: corner lights are merged, and buffers without them get them built (review CORE-R2)', () => {
  // legacy buffer (no corner): each quad's vertices become its corners BL, BR, TR, TL in order
  const b = buf(2, 0);
  for (let v = 0; v < 8; v++) { b.light[v * 4] = v * 30; b.light[v * 4 + 1] = 240 - v * 30; b.light[v * 4 + 2] = v & 3; }
  b.tex.fill(0x1ff); // garbage in bits 7-8 must be replaced
  const w = withCorner(b);
  assert.notEqual(w, b, 'a new object');
  assert.equal(b.corner, undefined, 'the input is not mutated');
  assert.equal(b.tex[3], 0x1ff, 'input tex untouched');
  for (let q = 0; q < 2; q++) for (let j = 0; j < 4; j++) {
    const v = q * 4 + j;
    assert.equal((w.tex[v * 4 + 3] >> 7) & 3, j, 'vertex j is corner j');
    assert.equal(w.tex[v * 4 + 3] & 0x7f, 0x7f, 'other flag bits kept');
    for (let jj = 0; jj < 4; jj++) {
      const c = w.corner[v * 4 + jj], src = q * 4 + jj;
      assert.equal(c & 127, Math.round(b.light[src * 4] / 2), 'sky*8');
      assert.equal((c >> 7) & 127, Math.round(b.light[src * 4 + 1] / 2), 'block*8');
      assert.equal(c >> 14, b.light[src * 4 + 2], 'ao');
    }
  }
  assert.equal(withCorner(w), w, 'a buffer with corners is returned as is');
  // merged columns carry corner data for new and kept sections
  const m1 = mergeColumnPass(null, [b, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  assert.equal(m1.corner.length, m1.quads * 16);
  assert.deepEqual([...m1.corner], [...w.corner]);
  const own = { ...buf(1, 3), corner: new Uint16Array(16).fill(1234) };
  const m2 = mergeColumnPass(m1, [undefined, own, undefined, undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual([...m2.corner.subarray(0, 32)], [...w.corner], 'kept section corners copied');
  assert.ok(m2.corner.subarray(32, 48).every((c) => c === 1234), 'new section corners copied');
});

test('chunkmerge: translucent quads sort back to front', () => {
  // three horizontal quads at y = 1, 5, 3 (section-local), section offset y 16
  const pos = new Float32Array(3 * 12);
  [1, 5, 3].forEach((y, q) => { const c = [[0, y, 1], [1, y, 1], [1, y, 0], [0, y, 0]]; c.forEach((v, k) => pos.set(v, q * 12 + k * 3)); });
  const centers = quadCenters(pos, 3, 0, 16, 0);
  assert.deepEqual([...centers], [0.5, 17, 0.5, 0.5, 21, 0.5, 0.5, 19, 0.5]);
  const idx = quadIndices(3).slice();
  sortQuadsBackToFront(centers, 3, 0.5, 30, 0.5, idx); // eye above: lowest (farthest) first
  assert.deepEqual([...idx.subarray(0, 6)], [0, 1, 2, 0, 2, 3]);
  assert.deepEqual([idx[6], idx[12]], [8, 4]);
  sortQuadsBackToFront(centers, 3, 0.5, 0, 0.5, idx); // eye below: highest first
  assert.deepEqual([idx[0], idx[6], idx[12]], [4, 8, 0]);
  const many = 5000, c2 = new Float32Array(many * 3).map((_, i) => (i * 7919) % 101);
  const i2 = sortQuadsBackToFront(c2, many, 0, 0, 0, new Uint32Array(many * 6));
  const d = (q) => c2[q * 3] ** 2 + c2[q * 3 + 1] ** 2 + c2[q * 3 + 2] ** 2;
  for (let k = 1; k < many; k++) assert.ok(d(i2[(k - 1) * 6] / 4) >= d(i2[k * 6] / 4));
});

/* ------------------------------------------------------------------ shaders */
test('shaders: chunk contract (SPEC §5.5.3) is present', () => {
  for (const s of [CHUNK_VERT]) for (const k of ['aTex', 'flat out float vLayer', 'aTex.yz / 256.0', 'uAnimFps', 'uWave']) assert.ok(s.includes(k), k);
  // v1.4 (review CORE-R2): the quad's four corner lights, flat, blended bilinearly per pixel; AO 0..3 -> 0.5/0.7/0.85/1.0
  // times the face shade from the face bits (0.6 E/W, 1.0 up, 0.5 down, 0.8 S/N, 0.9 plants, as the mesher's x255 values)
  for (const k of ['in vec4 aCorner', 'flat out vec4 vSky4', 'flat out vec4 vBlk4', 'flat out vec4 vAo4', 'floor(flags / 128.0)', '0.5 + 0.2 * min(ao, 1.0) + 0.15', 'bcFaceShade(mod(flags, 8.0))', '0.600000', '1.000000', '0.501961', '0.800000', '0.901961']) assert.ok(CHUNK_VERT.includes(k), k);
  assert.ok(!CHUNK_VERT.includes('in vec4 aLight'), 'chunk geometry uploads no per-vertex light');
  for (const k of ['sampler2DArray', 'pow(0.8, 15.0 - effSky)', '(1.0 - uDaylight) * 11.0', 'b * ((b * 0.6 + 0.4) * 0.6 + 0.4)', 'uGamma', 'uMinLight', 'CUTOUT', 'discard', 'bcBilerp(vAo4', 'bcBilerp(vSky4', 'bcBilerp(vBlk4', 'uFogNear', 'uFogFar']) assert.ok(CHUNK_FRAG.includes(k), k);
  for (const k of ['uParts[PARTS]', 'aPart', 'ATLAS', 'MAP']) assert.ok(ENTITY_VERT.includes(k), k);
  for (const k of ['uLightSky', 'uLightBlock', 'uTint', 'uAlphaTest']) assert.ok(ENTITY_FRAG.includes(k), k);
  assert.ok(SKY_FRAG.includes('uSunset') && SKY_FRAG.includes('uFogColor'));
});

/* ------------------------------------------------------------------ outline */
test('outline: line segments and ribbons cover 12 edges per box', () => {
  const box = [[0, 0, 0, 1, 1, 1]];
  const ls = lineSegmentsFor(box, 0);
  assert.equal(ls.length, 12 * 6);
  let len = 0;
  for (let i = 0; i < ls.length; i += 6) len += Math.hypot(ls[i + 3] - ls[i], ls[i + 4] - ls[i + 1], ls[i + 5] - ls[i + 2]);
  assert.ok(close(len, 12), 'unit cube edges total 12');
  const rb = ribbonFor([[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 0.5, 1, 1]]);
  assert.equal(rb.index.length, 2 * 12 * 6);
  assert.equal(rb.side.length, 2 * 12 * 4);
  assert.ok(Math.max(...rb.start) <= 1.004 + 1e-6 && Math.min(...rb.start) >= -0.004 - 1e-6);
});

/* ------------------------------------------------------------------ entity materials */
test('entity material: clones share global uniforms + map, own light/tint/parts', () => {
  const shared = {
    uTex: { value: null }, uDaylight: { value: 1 }, uMinLight: { value: 0.2 }, uFogColor: { value: new THREE.Color() },
    uFogNear: { value: 1 }, uFogFar: { value: 2 }, uFogSphere: { value: 0 }, uTime: { value: 0 },
    uAnimFrames: { value: new THREE.Vector4() }, uAnimFps: { value: new THREE.Vector4() },
  };
  const map = new THREE.Texture();
  const m = makeEntityMaterial(shared, { map, parts: 5, transparent: true });
  assert.equal(m.defines.PARTS, '5');
  assert.ok('MAP' in m.defines);
  assert.equal(m.uniforms.uParts.value.length, 5);
  assert.equal(map.magFilter, THREE.NearestFilter);
  assert.equal(m.depthWrite, false);
  const c = m.clone();
  for (const k of SHARED_ENTITY_UNIFORMS) assert.equal(c.uniforms[k], shared[k], `${k} shared`);
  assert.equal(c.uniforms.uMap.value, map, 'map texture shared (no re-upload per entity)');
  assert.notEqual(c.uniforms.uLightSky, m.uniforms.uLightSky);
  assert.notEqual(c.uniforms.uTint.value, m.uniforms.uTint.value);
  assert.notEqual(c.uniforms.uParts.value[0], m.uniforms.uParts.value[0]);
  c.uniforms.uParts.value[2].makeTranslation(1, 2, 3);
  assert.ok(m.uniforms.uParts.value[2].equals(new THREE.Matrix4()), 'original pose untouched');
  const cc = c.clone();
  assert.equal(cc.uniforms.uDaylight, shared.uDaylight, 'clone of a clone still shares');
  assert.equal(makeEntityMaterial(shared, { parts: 40 }).defines.PARTS, '8', 'parts capped at 8');
});
