// OWNER LANE: FEATURE-MOBS. three.js glue for mob models (SPEC §5.5.5, §8.1 "Rendering"):
//   - ONE merged BufferGeometry per model + variant (shared by every mob of that type) with a per-vertex
//     `aPart` attribute (Uint8, 1 component, not normalised),
//   - one CanvasTexture per skin variant (shared), material from renderer.createEntityMaterial({map, parts})
//     cloned per entity, posed every frame by writing the `uParts` matrices -> one draw call per mob,
//   - uLightSky / uLightBlock from world.getLight at the eye, hurt / flash tint through uTint.
//
// Stub tolerance: while CORE-D's renderer is a stub, createEntityMaterial returns a MeshBasicMaterial that
// ignores uParts/uTint. patchStubMaterial() then injects the same part transform + tint with onBeforeCompile so
// the walk cycle and hurt flash can be checked in screenshots today. It is never applied to the real material.

import * as THREE from 'three';
import { MODELS, PX, buildModelArrays, poseModel } from './mob_models.js';
import { paintSkin, skinKey } from './mob_skins.js';

const geoCache = new Map();     // 'type|variants' -> BufferGeometry
const texCache = new Map();     // skinKey -> Texture
const baseMatCache = new Map(); // skinKey -> base material (cloned per entity)

/** Shared merged geometry of a model + variant list. Never disposed per entity. */
export function modelGeometry(type, variants = []) {
  const key = type + '|' + variants.join(',');
  let g = geoCache.get(key);
  if (g) return g;
  const a = buildModelArrays(MODELS[type], variants);
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
  g.setAttribute('aPart', new THREE.BufferAttribute(a.part, 1, false));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  // parts move (legs swing, heads turn): pad the bounds so frustum culling never clips a pose
  g.boundingSphere.radius += 0.5;
  g.userData.shared = true;
  geoCache.set(key, g);
  return g;
}

/** Shared skin texture of a type + variant. */
export function skinTexture(type, variant = {}) {
  const key = skinKey(type, variant);
  let t = texCache.get(key);
  if (t) return t;
  const pc = paintSkin(type, variant);
  t = new THREE.CanvasTexture(pc.toCanvas());
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

function baseMaterial(game, type, variant) {
  const key = skinKey(type, variant);
  let m = baseMatCache.get(key);
  if (m) return m;
  const parts = MODELS[type].parts.length;
  m = game.renderer.createEntityMaterial({ map: skinTexture(type, variant), parts, alphaTest: 0.1 });
  baseMatCache.set(key, m);
  return m;
}

/** Fresh uniforms for a stub material clone (MeshBasicMaterial.clone drops our custom uniforms object). */
function ensureUniforms(mat, parts) {
  if (!mat.uniforms) mat.uniforms = {};
  const u = mat.uniforms;
  if (!u.uLightSky) u.uLightSky = { value: 15 };
  if (!u.uLightBlock) u.uLightBlock = { value: 0 };
  if (!u.uTint) u.uTint = { value: new THREE.Vector4(0, 0, 0, 0) };
  if (!u.uParts || !Array.isArray(u.uParts.value) || u.uParts.value.length < parts) {
    u.uParts = { value: Array.from({ length: parts }, () => new THREE.Matrix4()) };
  }
}

/**
 * Stub renderer only: make a MeshBasicMaterial honour aPart/uParts and uTint. Harmless no-op for the real
 * renderer's ShaderMaterial (which implements both natively, SPEC §5.5.5).
 */
export function patchStubMaterial(mat, parts) {
  if (!mat || mat.isShaderMaterial || !(mat.userData && mat.userData.stub)) return mat;
  ensureUniforms(mat, parts);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uParts = mat.uniforms.uParts;
    shader.uniforms.uTint = mat.uniforms.uTint;
    shader.uniforms.uLightSky = mat.uniforms.uLightSky;
    shader.vertexShader = `attribute float aPart;\nuniform mat4 uParts[${parts}];\n` + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\ntransformed = (uParts[int(aPart + 0.5)] * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'uniform vec4 uTint;\nuniform float uLightSky;\n' + shader.fragmentShader.replace(
      '#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb *= max(0.25, pow(0.8, 15.0 - uLightSky));\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uTint.rgb, uTint.a);');
  };
  mat.customProgramCacheKey = () => 'bc-mob-parts-' + parts;
  mat.needsUpdate = true;
  return mat;
}

/** Per-entity material (clone of the shared base for this skin). */
export function createMobMaterial(game, type, variant = {}) {
  const parts = MODELS[type].parts.length;
  const base = baseMaterial(game, type, variant);
  const m = base.clone();
  if (!m.uniforms || m.uniforms === base.uniforms) m.uniforms = {};
  ensureUniforms(m, parts);
  // three's cloneUniforms() only slices arrays: the uParts Matrix4 objects would be shared by every clone
  const bp = base.uniforms && base.uniforms.uParts && base.uniforms.uParts.value;
  if (bp && m.uniforms.uParts.value.some((x, i) => x === bp[i])) m.uniforms.uParts.value = m.uniforms.uParts.value.map((x) => x.clone());
  const bt = base.uniforms && base.uniforms.uTint && base.uniforms.uTint.value;
  if (bt && m.uniforms.uTint.value === bt) m.uniforms.uTint.value = bt.clone();
  patchStubMaterial(m, parts);
  return m;
}

/** Swap the skin of an existing mob mesh (sheep dye / rainbow, wolf collar). Disposes only the old clone. */
export function setMobSkin(game, mesh, type, variant) {
  const old = mesh.material;
  const m = createMobMaterial(game, type, variant);
  if (old && old.uniforms && m.uniforms) {
    m.uniforms.uLightSky.value = old.uniforms.uLightSky ? old.uniforms.uLightSky.value : 15;
    m.uniforms.uLightBlock.value = old.uniforms.uLightBlock ? old.uniforms.uLightBlock.value : 0;
  }
  mesh.material = m;
  if (old) old.dispose();
}

/** A mesh for a mob (shared geometry + cloned material). Caller adds it with renderer.addObject. */
export function createMobMesh(game, type, variants = [], variant = {}) {
  const mesh = new THREE.Mesh(modelGeometry(type, variants), createMobMaterial(game, type, variant));
  mesh.matrixAutoUpdate = true;
  mesh.frustumCulled = true;
  mesh.userData.mobType = type;
  return mesh;
}

/* ------------------------------------------------------------------ posing */

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _s = new THREE.Matrix4(), _t = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const POSE = [];

/**
 * Write the uParts matrices of a mob mesh from its pose (see mob_models.poseModel).
 * Matrix per part = T(pivot + offset) * R(yaw, pitch, roll) * S(scale) * T(-pivot), in blocks.
 */
export function applyPose(mesh, type, e, t) {
  const model = MODELS[type];
  const pose = poseModel(model, e, t, POSE);
  const u = mesh.material.uniforms;
  if (!u || !u.uParts) return;
  const mats = u.uParts.value;
  for (let i = 0; i < model.parts.length && i < mats.length; i++) {
    const o = pose[i], pv = model.parts[i].pivot;
    const px = pv[0] * PX, py = pv[1] * PX, pz = pv[2] * PX;
    _e.set(o.rx, o.ry, o.rz, 'YXZ');
    _r.makeRotationFromEuler(_e);
    _s.makeScale(o.s, o.s, o.s);
    _t.makeTranslation(-px, -py, -pz);
    _m.makeTranslation(px + o.tx * PX, py + o.ty * PX, pz + o.tz * PX).multiply(_r).multiply(_s).multiply(_t);
    if (model.parts[i].parent !== undefined) mats[i].multiplyMatrices(mats[model.parts[i].parent], _m);
    else mats[i].copy(_m);
  }
}

/** Light + tint uniforms (0..15 light, tint rgba). */
export function setMobLight(mesh, sky, block) {
  const u = mesh.material.uniforms;
  if (!u) return;
  if (u.uLightSky) u.uLightSky.value = sky;
  if (u.uLightBlock) u.uLightBlock.value = block;
}
export function setMobTint(mesh, r, g, b, a) {
  const u = mesh.material.uniforms;
  if (u && u.uTint) u.uTint.value.set(r, g, b, a);
}

/** Small single-colour box mesh (arrows, XP orbs) using an entity material so it is lit and fogged. */
export function createSimpleMesh(game, sx, sy, sz, color, oy = 0) {
  const key = `simple|${sx}|${sy}|${sz}|${oy}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(0, oy, 0);
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Uint8Array(n), 1, false));
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  const m = game.renderer.createEntityMaterial({ color, parts: 1 });
  patchStubMaterial(m, 1);
  return new THREE.Mesh(g, m);
}

/** Debug/test: sizes of the shared caches (they must stay bounded however many mobs come and go). */
export function renderCacheStats() { return { geometries: geoCache.size, textures: texCache.size, materials: baseMatCache.size }; }
