// OWNER LANE: FEATURE-FX (SPEC §3.1: src/render/celestial*.js). Sky objects drawn on top of CORE-D's sky colour:
// square sun, the moon with 8 phases, rotating stars and blocky drifting clouds. Positions come from
// renderer.sky (CORE-D computeSky: celestialAngle, sunDir, starBrightness, moonPhase, daylight, sunsetColor);
// when the renderer has not computed a sky yet we call the same pure computeSky().
//
// Draw order (renderOrder): stars -12, sun/moon -11, clouds -10 - all before water. Sun, moon and stars are
// additive, depth-tested (terrain hides them) but never write depth; they sit on a sphere of radius
// 0.8 * camera.far around the camera. Clouds: depth pre-pass + one blended pass (2 draw calls).
// INTERFACE ASSUMPTION (handoff): CORE-D's sky dome/background must not write depth (or must sit beyond
// camera.far * 0.8), otherwise it hides the sun and stars.

import * as THREE from 'three';
import { CLOUD_HEIGHT } from '../core/constants.js';
import { mulberry32 } from '../core/math.js';
import { computeSky } from './sky.js';
import {
  CLOUD_CELL, CLOUD_MAP_SIZE, buildCloudGeometry, buildFlatCloudGeometry, buildCloudMap, buildMoonTexture, buildSunTexture,
} from '../fx/sprites.js';
import { pixelTexture } from '../fx/fxmat.js';

const SKY_R = 100;            // build radius; the group is scaled to the camera range
const CLOUD_SPEED = 0.03 * 20; // blocks per second drifting +X (0.03 b/t)

const SKY_VERT = /* glsl */`
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function additiveMaterial(map, extraUniforms = {}, frag) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uAlpha: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) }, uUvRect: { value: new THREE.Vector4(0, 0, 1, 1) }, ...extraUniforms },
    vertexShader: SKY_VERT,
    fragmentShader: frag || /* glsl */`
      uniform sampler2D uMap;
      uniform float uAlpha;
      uniform vec3 uTint;
      uniform vec4 uUvRect;
      in vec2 vUv;
      void main() {
        vec3 c = texture(uMap, uUvRect.xy + vec2(vUv.x, 1.0 - vUv.y) * uUvRect.zw).rgb;
        gl_FragColor = vec4(c * uTint * uAlpha, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Square quad of half-size h in the XZ plane at height y, facing down (toward the centre). */
function skyQuad(h, y) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-h, y, -h, h, y, -h, h, y, h, -h, y, h]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Deterministic star field: n small quads on a sphere (one geometry, one draw call). */
export function buildStarGeometry(n = 1200, seed = 10842) {
  const rnd = mulberry32(seed);
  const pos = new Float32Array(n * 12), bright = new Float32Array(n * 4);
  const idx = new Uint32Array(n * 6);
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < n * 3 && k < n; i++) {
    v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    const l = v.length();
    if (l < 0.01 || l > 1) continue;
    v.multiplyScalar(SKY_R / l);
    const s = 0.12 + rnd() * 0.12;
    up.set(Math.abs(v.y) > 90 ? 1 : 0, Math.abs(v.y) > 90 ? 0 : 1, 0);
    a.crossVectors(v, up).normalize().multiplyScalar(s);
    b.crossVectors(v, a).normalize().multiplyScalar(s);
    const rot = rnd() * Math.PI;
    const c = Math.cos(rot), sn = Math.sin(rot);
    const ax = a.clone().multiplyScalar(c).addScaledVector(b, sn), bx = b.clone().multiplyScalar(c).addScaledVector(a, -sn);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const br = 0.5 + rnd() * 0.5;
    for (let q = 0; q < 4; q++) {
      const o = (k * 4 + q) * 3;
      pos[o] = v.x + ax.x * corners[q][0] + bx.x * corners[q][1];
      pos[o + 1] = v.y + ax.y * corners[q][0] + bx.y * corners[q][1];
      pos[o + 2] = v.z + ax.z * corners[q][0] + bx.z * corners[q][1];
      bright[k * 4 + q] = br;
    }
    const b4 = k * 4, i6 = k * 6;
    idx[i6] = b4; idx[i6 + 1] = b4 + 1; idx[i6 + 2] = b4 + 2; idx[i6 + 3] = b4; idx[i6 + 4] = b4 + 2; idx[i6 + 5] = b4 + 3;
    k++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 12), 3));
  g.setAttribute('aBright', new THREE.BufferAttribute(bright.subarray(0, k * 4), 1));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, k * 6), 1));
  return { geometry: g, count: k };
}

export class Celestial {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();      // follows the camera position
    this.group.name = 'fx-sky';
    this.rot = new THREE.Group();        // rotates with the celestial angle about Z (east-west arc)
    this.group.add(this.rot);
    // sun
    const sunImg = buildSunTexture();
    this.sunTex = pixelTexture(sunImg.data, sunImg.w, sunImg.h);
    this.sunMat = additiveMaterial(this.sunTex);
    this.sun = new THREE.Mesh(skyQuad(30, SKY_R), this.sunMat);
    this.sun.renderOrder = -11;
    this.sun.frustumCulled = false;
    // moon (8 phases, 4x2 atlas)
    const moonImg = buildMoonTexture();
    this.moonTex = pixelTexture(moonImg.data, moonImg.w, moonImg.h);
    this.moonMat = additiveMaterial(this.moonTex);
    this.moon = new THREE.Mesh(skyQuad(14, -SKY_R), this.moonMat);   // disc ~12 degrees, like the classic moon
    this.moon.renderOrder = -11;
    this.moon.frustumCulled = false;
    // stars
    const st = buildStarGeometry();
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: /* glsl */`
        in float aBright; out float vB;
        void main() { vB = aBright; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uAlpha; in float vB;
        void main() { gl_FragColor = vec4(vec3(vB * uAlpha), 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.stars = new THREE.Mesh(st.geometry, this.starMat);
    this.stars.renderOrder = -12;
    this.stars.frustumCulled = false;
    this.starCount = st.count;
    this.rot.add(this.stars, this.sun, this.moon);
    // clouds
    this.cloudMap = buildCloudMap();
    const cg = buildCloudGeometry(this.cloudMap, CLOUD_MAP_SIZE);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cg.position, 3));
    geo.setAttribute('aShade', new THREE.BufferAttribute(cg.shade, 1, true));
    geo.setIndex(new THREE.BufferAttribute(cg.index, 1));
    this.cloudQuads = cg.quads;
    this.cloudGeo = geo;
    this.cloudUniforms = {
      uCloudColor: { value: new THREE.Color(1, 1, 1) },
      uFogColor: { value: new THREE.Color(0.72, 0.83, 1) },
      uFadeNear: { value: 110 }, uFadeFar: { value: 180 },
      uAlpha: { value: 0.8 },
      uDepthFar: { value: 120 },
      // the renderer's fog cull (SPEC 5.5.6) hides fully fogged terrain past uFogFar + 0.5 where the sky behind is
      // the fog colour: clouds there must be invisible too, or hiding the terrain would reveal them (LEAD integration)
      uCullFar: { value: 1e9 }, uCullAll: { value: 0 },
    };
    const cloudVert = /* glsl */`
      uniform float uDepthFar;
      in float aShade; out float vShade; out float vDist; out vec3 vRel;
      void main() {
        vShade = aShade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vRel = wp.xyz - cameraPosition;
        vDist = length(vRel.xz);
        // Clouds reach past the camera's far plane (the terrain fog distance), which would cut them off in a hard
        // straight line. Pull far vertices in ALONG THE VIEW RAY (same pixel on screen) with a monotonic squeeze
        // into [0.6, 0.97] x far: near clouds keep their true depth, far ones keep their order.
        float d = length(mv.xyz);
        float d0 = uDepthFar * 0.6, room = uDepthFar * 0.37;
        if (d > d0) mv.xyz *= (d0 + room * (1.0 - exp(-(d - d0) / room))) / d;
        gl_Position = projectionMatrix * mv;
      }`;
    const cloudFrag = /* glsl */`
      uniform vec3 uCloudColor; uniform vec3 uFogColor; uniform float uFadeNear; uniform float uFadeFar; uniform float uAlpha;
      uniform float uCullFar; uniform float uCullAll;
      in float vShade; in float vDist; in vec3 vRel;
      void main() {
        // fully fogged like the terrain: past the fog, at or below the horizon (everywhere in water or lava)
        if (length(vRel.xz) > uCullFar + 0.5 && (vRel.y <= 0.0 || uCullAll > 0.5)) discard;
        float f = smoothstep(uFadeNear, uFadeFar, vDist);
        if (f >= 0.999) discard;
        vec3 c = mix(uCloudColor * vShade, uFogColor, f * 0.85);
        gl_FragColor = vec4(c, uAlpha * (1.0 - f));
      }`;
    this.cloudDepthMat = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms, vertexShader: cloudVert, fragmentShader: cloudFrag,
      colorWrite: false, depthWrite: true, side: THREE.DoubleSide,
    });
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms, vertexShader: cloudVert, fragmentShader: cloudFrag,
      transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide,
    });
    // flat variant for the low preset (weak GPUs): one layer, one pass
    const fg = buildFlatCloudGeometry(this.cloudMap, CLOUD_MAP_SIZE);
    const flatGeo = new THREE.BufferGeometry();
    flatGeo.setAttribute('position', new THREE.BufferAttribute(fg.position, 3));
    flatGeo.setAttribute('aShade', new THREE.BufferAttribute(fg.shade, 1, true));
    flatGeo.setIndex(new THREE.BufferAttribute(fg.index, 1));
    this.flatCloudGeo = flatGeo;
    this.flatCloudQuads = fg.quads;
    // the flat layer has no depth pre-pass: it writes depth itself, so far fogged water drawn after it can no longer
    // paint over a nearer cloud (that ordering also made the fog cull change pixels on the low preset; LEAD integration)
    this.cloudFlatMat = this.cloudMat.clone();
    this.cloudFlatMat.uniforms = this.cloudUniforms;
    this.cloudFlatMat.depthWrite = true;
    this.cloudFlat = new THREE.Mesh(flatGeo, this.cloudFlatMat);
    this.cloudFlat.renderOrder = -10;
    this.cloudFlat.visible = false;
    this.flat = false;
    this.cloudDepth = new THREE.Mesh(geo, this.cloudDepthMat);
    this.cloudDepth.renderOrder = -10;
    this.cloudColor = new THREE.Mesh(geo, this.cloudMat);
    this.cloudColor.renderOrder = -10;
    this.clouds = new THREE.Group();
    this.clouds.name = 'fx-clouds';
    this.clouds.add(this.cloudDepth, this.cloudColor, this.cloudFlat);
    for (const m of [this.cloudDepth, this.cloudColor, this.cloudFlat]) m.frustumCulled = false;
    this.cloudDrift = 0;
    this.attached = false;
    /** last values (tests / debug) */
    this.state = { angle: 0, phase: 0, stars: 0, sunVisible: false, cloudsVisible: false };
  }

  attach(renderer) {
    if (this.attached || !renderer || !renderer.addObject || !renderer.dynamicGroup) return;
    renderer.addObject(this.group);
    renderer.addObject(this.clouds);
    this.attached = true;
  }

  /** Per frame. rain 0..1 hides the sun/moon/stars and greys the clouds. */
  update(dt, rain = 0) {
    const g = this.game, r = g.renderer;
    const cam = r && r.camera;
    if (!cam) return;
    const sky = (r && r.sky) || computeSky(g.time ? g.time.dayTime : 6000, rain, g.time ? g.time.day : 0);
    this.group.position.copy(cam.position);
    const range = Math.max(40, Math.min(400, (cam.far || 120) * 0.8));
    this.group.scale.setScalar(range / SKY_R);
    // angle from sunDir (robust to CORE-D tweaks): sunDir = (-sin a, cos a, 0)
    const sd = sky.sunDir || [0, 1, 0];
    const angle = Math.atan2(-sd[0], sd[1]);
    this.rot.rotation.set(0, 0, angle);
    const clear = 1 - Math.min(1, Math.max(0, rain));
    this.sunMat.uniforms.uAlpha.value = clear;
    // low sun: warm orange instead of a white blob on the bright horizon
    const low = Math.min(1, Math.max(0, 1 - (sd[1] + 0.05) * 4));
    this.sunMat.uniforms.uTint.value.setRGB(1, 1 - 0.3 * low, 1 - 0.6 * low);
    const phase = ((sky.moonPhase | 0) % 8 + 8) % 8;
    // atlas: 4 columns x 2 rows, row 0 on top (uv y=0 is the top row since textures are not flipped)
    this.moonMat.uniforms.uUvRect.value.set((phase % 4) / 4, Math.floor(phase / 4) / 2, 0.25, 0.5);
    // additive: a bright dusk sky would wash a full-strength moon out into a white blob, so it fades in with dark
    this.moonMat.uniforms.uAlpha.value = clear * (0.95 - 0.75 * Math.min(1, sky.daylight ?? 0));
    // squared like the classic curve: barely there at sunset, full at night
    const sb = Math.min(1, Math.max(0, sky.starBrightness || 0));
    const stars = sb * sb * clear;
    this.starMat.uniforms.uAlpha.value = stars;
    this.stars.visible = stars > 0.01;
    // clouds
    const show = g.settings ? g.settings.clouds !== false : true;
    this.clouds.visible = show && !!g.meta;
    if (this.clouds.visible) {
      if (g.state === 'playing' || g.state === 'title') this.cloudDrift += dt * CLOUD_SPEED;
      const period = CLOUD_MAP_SIZE * CLOUD_CELL;
      if (this.cloudDrift > period * 1000) this.cloudDrift -= period * 1000;
      const ox = this.cloudDrift + Math.round((cam.position.x - this.cloudDrift) / period) * period;
      const oz = Math.round(cam.position.z / period) * period;
      this.clouds.position.set(ox, CLOUD_HEIGHT, oz);
      this.cloudUniforms.uDepthFar.value = cam.far || 120;
      if (r.uniforms && r.uniforms.uFogFar) {
        this.cloudUniforms.uCullFar.value = r.uniforms.uFogFar.value;
        this.cloudUniforms.uCullAll.value = r.uniforms.uFogSphere ? r.uniforms.uFogSphere.value : 0;
      }
      // low preset (SwiftShader, Intel HD): flat single-pass clouds cost ~1/4 of the fancy ones
      const flat = !!(r.quality && r.quality.preset === 'low');
      if (flat !== this.flat) {
        this.flat = flat;
        this.cloudFlat.visible = flat; this.cloudDepth.visible = !flat; this.cloudColor.visible = !flat;
      }
      // clouds fade into the sky's own horizon colour (computeSky.fogColor) - also correct while the eye is under water
      const fc = sky.fogColor;
      if (fc) this.cloudUniforms.uFogColor.value.setRGB(fc[0], fc[1], fc[2]);
      const d = sky.daylight ?? 1;
      const c = this.cloudUniforms.uCloudColor.value;
      const night = [0.1, 0.11, 0.17];
      const k = Math.min(1, Math.max(0, d));
      c.setRGB(night[0] + (1 - night[0]) * k, night[1] + (1 - night[1]) * k, night[2] + (1 - night[2]) * k);
      if (sky.sunsetColor) {
        const a = sky.sunsetColor[3] * 0.35 * Math.min(1, k * 2.5);   // no pink clouds once it is dark
        c.setRGB(c.r * (1 - a) + sky.sunsetColor[0] * a, c.g * (1 - a) + sky.sunsetColor[1] * a, c.b * (1 - a) + sky.sunsetColor[2] * a);
      }
      if (rain > 0) { const gr = 0.55; c.setRGB(c.r * (1 - rain * (1 - gr)), c.g * (1 - rain * (1 - gr)), c.b * (1 - rain * (1 - gr))); }
      // fade toward the horizon colour over a range well past the terrain fog (clouds stretch to the horizon like
      // the classic game); the cloud mesh always covers at least CLOUD_MAP_SIZE * CLOUD_CELL / 2 = 192 blocks
      const far = Math.max(150, Math.min(190, (r.renderFar || 88) * 2.2));
      this.cloudUniforms.uFadeFar.value = far;
      this.cloudUniforms.uFadeNear.value = far * 0.35;
    }
    this.state.angle = angle; this.state.phase = phase; this.state.stars = stars;
    this.state.sunVisible = sd[1] > -0.2 && clear > 0; this.state.cloudsVisible = this.clouds.visible;
    this.group.visible = !!g.meta;
  }

  dispose() {
    for (const o of [this.group, this.clouds]) if (o.parent) o.parent.remove(o);
    for (const m of [this.sun, this.moon, this.stars]) m.geometry.dispose();
    for (const m of [this.sunMat, this.moonMat, this.starMat, this.cloudMat, this.cloudFlatMat, this.cloudDepthMat]) m.dispose();
    this.cloudGeo.dispose(); this.flatCloudGeo.dispose(); this.sunTex.dispose(); this.moonTex.dispose();
  }
}
