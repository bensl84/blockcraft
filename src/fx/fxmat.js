// OWNER LANE: FEATURE-FX. Shared shader materials for every FX object (particles, item meshes, view model,
// player model, crack overlay, ghost block). They use the SAME lighting curve and fog as the chunk shader
// (SPEC §5.5.3) by sharing CORE-D's uniform objects (renderer.uniforms: uDaylight, uMinLight, uFogColor,
// uFogNear, uFogFar), so FX objects match the world at any time of day and under the kid soft-border fog.
//
// Why FX owns its shaders instead of renderer.createEntityMaterial(): FX needs instancing (particles),
// multiply blending (crack), per-object light updated in onBeforeRender with a SHARED material (dropped
// items share one material + one geometry per item key), and must look right while CORE-D is still a stub.
//
// Array texture: FX samples CORE-D's DataArrayTexture (renderer.uniforms.uTex). While that is null (stub
// renderer) FX builds its own fallback DataArrayTexture from game.textures so everything stays visible.

import * as THREE from 'three';

/* ------------------------------------------------------------------ GLSL chunks */

/** Light + fog helpers, identical maths to the chunk shader (SPEC §5.5.3). */
export const GLSL_LIGHT = /* glsl */`
uniform float uDaylight;
uniform float uMinLight;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
vec3 bcLight(float sky, float block) {
  float effSky = max(0.0, sky - (1.0 - uDaylight) * 11.0);
  float skyB = pow(0.8, 15.0 - effSky);
  float blkB = pow(0.8, 15.0 - block);
  vec3 l = max(vec3(skyB), blkB * vec3(1.0, 0.92, 0.78));
  return max(l, vec3(uMinLight));
}
vec3 bcFog(vec3 c, float dist) {
  float f = clamp((dist - uFogNear) / max(0.001, uFogFar - uFogNear), 0.0, 1.0);
  return mix(c, uFogColor, f);
}
`;

const AO_TABLE = 'const float AO[4] = float[4](0.5, 0.7, 0.85, 1.0);';

/* ------------------------------------------------------------------ shared uniforms */

/**
 * Uniform objects shared with the renderer. If the renderer has them we reuse the SAME objects (live values);
 * otherwise we make local ones with sensible daytime defaults.
 */
export function sharedUniforms(renderer) {
  const u = (renderer && renderer.uniforms) || {};
  const pick = (k, v) => (u[k] && typeof u[k] === 'object' && 'value' in u[k] ? u[k] : { value: v });
  return {
    uDaylight: pick('uDaylight', 1),
    uMinLight: pick('uMinLight', 0.2),
    uFogColor: pick('uFogColor', new THREE.Color(0.72, 0.83, 1)),
    uFogNear: pick('uFogNear', 48),
    uFogFar: pick('uFogFar', 88),
  };
}

/* ------------------------------------------------------------------ array texture */

/**
 * Keeps `uniform.value` pointing at CORE-D's block DataArrayTexture (`renderer.uniforms.uTex`, rebuilt on
 * context restore / halfAnim). Call update() once per frame.
 */
export class ArrayTextureRef {
  constructor(game) {
    this.game = game;
    this.uniform = { value: null };
  }
  update() {
    const r = this.game.renderer;
    const real = r && r.uniforms && r.uniforms.uTex && r.uniforms.uTex.value;
    this.uniform.value = real && real.isTexture ? real : null;
  }
  dispose() { this.uniform.value = null; }
}

/* ------------------------------------------------------------------ per-object light */

/**
 * onBeforeRender hook for meshes that SHARE a material: samples world light at the object's world position
 * and re-uploads the material's light uniforms for this one draw (three.js `uniformsNeedUpdate`).
 * `mesh.userData.fxLight` may hold {sky, block} to force a value (view model).
 */
export function makeLightHook(game) {
  return function onBeforeRender(renderer, scene, camera, geometry, material) {
    const u = material.uniforms;
    if (!u || !u.uLightSky) return;
    let sky = 15, block = 0;
    const forced = this.userData && this.userData.fxLight;
    if (forced) { sky = forced.sky; block = forced.block; } else {
      const w = game.world;
      const e = this.matrixWorld.elements;
      if (w && w.isOpen !== false && w.getLight) {
        const l = w.getLight(Math.floor(e[12]), Math.floor(e[13] + 0.05), Math.floor(e[14]));
        sky = l >> 4; block = l & 15;
      }
    }
    if (u.uLightSky.value !== sky || u.uLightBlock.value !== block) {
      u.uLightSky.value = sky; u.uLightBlock.value = block;
    }
    material.uniformsNeedUpdate = true;
  };
}

/* ------------------------------------------------------------------ materials */

/**
 * Block-model material using the chunk vertex format (position, aTex u16x4, aLight u8x4) - meshBlockModel()
 * geometry. mode: 'lit' (items, held block, ghost) | 'crack' (multiply-blended crack overlay).
 * opts: {alpha, transparent, fog (default true), side}
 */
export function createAtlasMaterial(shared, texRef, mode = 'lit', opts = {}) {
  const crack = mode === 'crack';
  const fog = opts.fog !== false;
  const uniforms = {
    ...shared,
    uTex: texRef.uniform,
    uLightSky: { value: 15 },
    uLightBlock: { value: 0 },
    uAlpha: { value: opts.alpha ?? 1 },
    uTint: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    defines: { ...(crack ? { CRACK: 1 } : {}), ...(fog ? { USE_BCFOG: 1 } : {}) },
    vertexShader: /* glsl */`
      in vec4 aTex;
      in vec4 aLight;
      out vec2 vUv;
      flat out float vLayer;
      out float vShade;
      out float vDist;
      ${AO_TABLE}
      void main() {
        vUv = aTex.yz / 256.0;
        vLayer = aTex.x;
        vShade = aLight.w / 255.0 * AO[int(aLight.z + 0.5)];
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      precision highp sampler2DArray;
      uniform sampler2DArray uTex;
      uniform float uLightSky;
      uniform float uLightBlock;
      uniform float uAlpha;
      uniform vec4 uTint;
      in vec2 vUv;
      flat in float vLayer;
      in float vShade;
      in float vDist;
      ${GLSL_LIGHT}
      void main() {
        vec4 t = texture(uTex, vec3(vUv, vLayer));
      #ifdef CRACK
        if (t.a < 0.02) discard;
        vec3 c = mix(vec3(1.0), t.rgb, t.a);
        #ifdef USE_BCFOG
        float f = clamp((vDist - uFogNear) / max(0.001, uFogFar - uFogNear), 0.0, 1.0);
        c = mix(c, vec3(1.0), f);
        #endif
        gl_FragColor = vec4(c, 1.0);
      #else
        if (t.a < 0.1) discard;
        vec3 c = t.rgb * vShade * bcLight(uLightSky, uLightBlock);
        c = mix(c, uTint.rgb, uTint.a);
        #ifdef USE_BCFOG
        c = bcFog(c, vDist);
        #endif
        gl_FragColor = vec4(c, (t.a < 0.99 ? t.a : 1.0) * uAlpha);
      #endif
      }`,
    transparent: crack || !!opts.transparent,
    depthWrite: !crack && !opts.transparent,
    side: opts.side ?? THREE.FrontSide,
  });
  if (crack) {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.DstColorFactor;
    m.blendDst = THREE.ZeroFactor;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
  }
  return m;
}

/**
 * Vertex-colour material (extruded item sprites): position + aColor (u8x3 normalised, face shade baked in).
 * opts: {fog (default true)}
 */
export function createColorMaterial(shared, opts = {}) {
  const fog = opts.fog !== false;
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uLightSky: { value: 15 }, uLightBlock: { value: 0 }, uTint: { value: new THREE.Vector4(0, 0, 0, 0) } },
    defines: fog ? { USE_BCFOG: 1 } : {},
    vertexShader: /* glsl */`
      in vec3 aColor;
      out vec3 vColor;
      out float vDist;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uLightSky;
      uniform float uLightBlock;
      uniform vec4 uTint;
      in vec3 vColor;
      in float vDist;
      ${GLSL_LIGHT}
      void main() {
        vec3 c = vColor * bcLight(uLightSky, uLightBlock);
        c = mix(c, uTint.rgb, uTint.a);
        #ifdef USE_BCFOG
        c = bcFog(c, vDist);
        #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/**
 * Posed box model material (player model, first-person arm): position, uv, aPart (u8), aShade (u8 normalised).
 * uParts: N part matrices (one draw call for the whole model, like mobs - SPEC §5.5.5).
 */
export function createPartsMaterial(shared, map, parts, opts = {}) {
  const fog = opts.fog !== false;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uMap: { value: map },
      uParts: { value: Array.from({ length: parts }, () => new THREE.Matrix4()) },
      uLightSky: { value: 15 },
      uLightBlock: { value: 0 },
      uTint: { value: new THREE.Vector4(0, 0, 0, 0) },
    },
    defines: { PARTS: parts, ...(fog ? { USE_BCFOG: 1 } : {}) },
    vertexShader: /* glsl */`
      uniform mat4 uParts[PARTS];
      in float aPart;
      in float aShade;
      out vec2 vUv;
      out float vShade;
      out float vDist;
      void main() {
        vUv = uv;
        vShade = aShade;
        vec4 p = uParts[int(aPart + 0.5)] * vec4(position, 1.0);
        vec4 mv = modelViewMatrix * p;
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform float uLightSky;
      uniform float uLightBlock;
      uniform vec4 uTint;
      in vec2 vUv;
      in float vShade;
      in float vDist;
      ${GLSL_LIGHT}
      void main() {
        vec4 t = texture(uMap, vUv);
        if (t.a < 0.5) discard;
        vec3 c = t.rgb * vShade * bcLight(uLightSky, uLightBlock);
        c = mix(c, uTint.rgb, uTint.a);
        #ifdef USE_BCFOG
        c = bcFog(c, vDist);
        #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** Nearest-filtered RGBA DataTexture from pixels (row 0 = top row, like every Blockcraft texture). */
export function pixelTexture(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
