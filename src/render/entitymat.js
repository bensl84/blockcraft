// OWNER LANE: CORE-D. Entity materials (SPEC §5.5.5): same light curve and fog as chunks, uniform per-entity
// light (uLightSky / uLightBlock 0..15), tint overlay (uTint rgba), alpha test, and optional per-vertex part
// matrices (uParts[N] + attribute aPart) so a whole mob is ONE draw call.
//
// clone() is overridden: the clone shares the renderer's global uniforms (daylight, fog, time, array texture)
// and the 2D map texture (no re-upload per entity), and gets its own light / tint / colour / part matrices.

import * as THREE from 'three';
import { ENTITY_FRAG, ENTITY_VERT } from './shaders.js';

/** Uniform names that are SHARED with the renderer (never cloned). */
export const SHARED_ENTITY_UNIFORMS = Object.freeze(['uTex', 'uDaylight', 'uMinLight', 'uGamma', 'uFogColor', 'uFogNear', 'uFogFar', 'uFogSphere', 'uTime', 'uAnimFrames', 'uAnimFps']);
export const MAX_PARTS = 8;

/**
 * @param {object} shared renderer.uniforms (+ uAnimFrames/uAnimFps/uFogSphere)
 * @param {{map?: THREE.Texture, atlas?: boolean, transparent?: boolean, alphaTest?: number, color?: any,
 *          parts?: number, side?: number, opacity?: number, fog?: boolean, depthWrite?: boolean}} opts
 */
export function makeEntityMaterial(shared, opts = {}) {
  const defines = {};
  if (opts.map) {
    defines.MAP = '';
    opts.map.magFilter = THREE.NearestFilter;
    if (opts.map.minFilter !== THREE.NearestFilter && opts.map.minFilter !== THREE.NearestMipmapNearestFilter && opts.map.minFilter !== THREE.NearestMipmapLinearFilter) opts.map.minFilter = THREE.NearestFilter;
    opts.map.colorSpace = THREE.NoColorSpace;
  }
  if (opts.atlas) defines.ATLAS = '';
  const parts = opts.parts ? Math.max(1, Math.min(MAX_PARTS, opts.parts | 0)) : 0;
  if (parts) defines.PARTS = String(parts);
  const uniforms = {};
  for (const k of SHARED_ENTITY_UNIFORMS) if (shared[k]) uniforms[k] = shared[k];
  uniforms.uLightSky = { value: 15 };
  uniforms.uLightBlock = { value: 0 };
  uniforms.uTint = { value: new THREE.Vector4(0, 0, 0, 0) };
  uniforms.uColor = { value: new THREE.Color(opts.color === undefined || opts.color === null ? 0xffffff : opts.color) };
  uniforms.uOpacity = { value: opts.opacity ?? 1 };
  uniforms.uAlphaTest = { value: opts.alphaTest ?? 0.1 };
  uniforms.uFogOn = { value: opts.fog === false ? 0 : 1 };
  if (opts.map) uniforms.uMap = { value: opts.map };
  if (parts) uniforms.uParts = { value: Array.from({ length: parts }, () => new THREE.Matrix4()) };
  const transparent = !!opts.transparent;
  const m = new THREE.ShaderMaterial({
    name: 'bc-entity',
    glslVersion: THREE.GLSL3,
    vertexShader: ENTITY_VERT,
    fragmentShader: ENTITY_FRAG,
    uniforms,
    defines,
    transparent,
    depthWrite: opts.depthWrite ?? !transparent,
    side: opts.side ?? (opts.atlas ? THREE.DoubleSide : THREE.FrontSide),
  });
  m.toneMapped = false;
  installClone(m);
  return m;
}

function installClone(m) {
  m.clone = function cloneEntityMaterial() {
    const c = THREE.ShaderMaterial.prototype.clone.call(this);
    for (const k of SHARED_ENTITY_UNIFORMS) if (this.uniforms[k]) c.uniforms[k] = this.uniforms[k];
    if (this.uniforms.uMap) c.uniforms.uMap = { value: this.uniforms.uMap.value };
    if (this.uniforms.uParts) c.uniforms.uParts = { value: this.uniforms.uParts.value.map((mm) => mm.clone()) };
    installClone(c);
    return c;
  };
}
