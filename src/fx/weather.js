// OWNER LANE: FEATURE-FX. Rain and snow (P2, SPEC §2.0 / §8.7). One GPU-animated mesh of falling streaks
// around the camera (world-anchored columns that wrap, so walking through rain looks right), hidden under roofs
// and trees with a small heightmap texture (world.getHeight), plus tiny splash particles on the ground.
// fx.weather.rain (0..1) is what CORE-D reads to darken the sky (computeSky(dayTime, rain)).

import * as THREE from 'three';
import { BIOME_BY_NAME } from '../world/worldgen.js';
import { mulberry32 } from '../core/math.js';
import { GLSL_LIGHT, pixelTexture } from './fxmat.js';
import { buildWeatherTexture } from './sprites.js';

const N = 1400;          // streak quads
const AREA = 28;         // blocks around the camera
const HEIGHT = 22;       // vertical wrap range
const HM = 32;           // heightmap size (cells)
const SNOWY = BIOME_BY_NAME.snowy ?? 3;

export class Weather {
  constructor(game, shared) {
    this.game = game;
    /** public state read by the renderer: rain 0..1 (eased), snow (current biome is snowy) */
    this.state = { rain: 0, target: 0, snow: false };
    const seed = new Float32Array(N * 4 * 3), corner = new Float32Array(N * 4 * 2);
    const rnd = mulberry32(0x7a1);
    const idx = new Uint32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const sx = rnd(), sz = rnd(), sp = rnd();
      const cs = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
      for (let k = 0; k < 4; k++) {
        seed.set([sx, sz, sp], (i * 4 + k) * 3);
        corner.set(cs[k], (i * 4 + k) * 2);
      }
      const b = i * 4, o = i * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 4 * 3), 3)); // unused (shader-placed)
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    const wt = buildWeatherTexture();
    this.tex = pixelTexture(wt.data, wt.w, wt.h);
    this.hmData = new Uint8Array(HM * HM * 4);
    this.hmTex = pixelTexture(this.hmData, HM, HM);
    this.hmOrigin = { x: 1e9, z: 1e9 };
    this.uniforms = {
      ...shared,
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSnow: { value: 0 }, uAlpha: { value: 0 },
      uWeather: { value: this.tex }, uHeight: { value: this.hmTex }, uHmOrigin: { value: new THREE.Vector2() },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: { AREA: AREA.toFixed(1), HEIGHT: HEIGHT.toFixed(1), HM: HM.toFixed(1) },
      vertexShader: /* glsl */`
        in vec3 aSeed;
        in vec2 aCorner;
        uniform float uTime;
        uniform vec3 uCam;
        uniform float uSnow;
        out vec2 vUv;
        out vec3 vWorld;
        out float vDist;
        void main() {
          float half_ = AREA * 0.5;
          float wx = uCam.x + mod(aSeed.x * AREA - uCam.x + half_, AREA) - half_;
          float wz = uCam.z + mod(aSeed.y * AREA - uCam.z + half_, AREA) - half_;
          wx = floor(wx) + 0.5 + (fract(aSeed.x * 97.0) - 0.5) * 0.6;
          wz = floor(wz) + 0.5 + (fract(aSeed.y * 89.0) - 0.5) * 0.6;
          float speed = mix(11.0, 1.6, uSnow) * (0.85 + aSeed.z * 0.3);
          float top = uCam.y + HEIGHT * 0.5;
          float wy = top - mod(uTime * speed + aSeed.z * HEIGHT, HEIGHT);
          wx += uSnow * sin(uTime * 1.3 + aSeed.z * 20.0) * 0.4;
          vec2 dir = vec2(wx - uCam.x, wz - uCam.z);
          float len = max(0.001, length(dir));
          vec2 right = vec2(-dir.y, dir.x) / len;
          float w = mix(0.55, 0.6, uSnow), h = mix(2.6, 2.4, uSnow);
          vec3 p = vec3(wx + right.x * aCorner.x * w, wy + aCorner.y * h, wz + right.y * aCorner.x * w);
          vWorld = p;
          vUv = vec2((aCorner.x + 0.5) * 0.5 + uSnow * 0.5, 1.0 - aCorner.y);
          vUv.y = fract(vUv.y * 0.5 + aSeed.z);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vDist = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uWeather;
        uniform sampler2D uHeight;
        uniform vec2 uHmOrigin;
        uniform float uAlpha;
        in vec2 vUv;
        in vec3 vWorld;
        in float vDist;
        ${GLSL_LIGHT}
        void main() {
          vec2 hc = (floor(vWorld.xz) - uHmOrigin + 0.5) / HM;
          if (hc.x >= 0.0 && hc.y >= 0.0 && hc.x <= 1.0 && hc.y <= 1.0) {
            float hgt = texture(uHeight, hc).r * 255.0;
            if (vWorld.y < hgt) discard;
          }
          vec4 t = texture(uWeather, vUv);
          if (t.a < 0.05) discard;
          float fade = (1.0 - smoothstep(10.0, 14.0, vDist)) * smoothstep(0.8, 2.5, vDist);
          vec3 c = t.rgb * max(0.25, uDaylight);
          gl_FragColor = vec4(bcFog(c, vDist), t.a * uAlpha * fade);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'fx-weather';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.rng = mulberry32(1);
    this.timer = 0;
    this.frames = 0;
    this.attached = false;
  }

  attach(renderer) {
    if (this.attached || !renderer || !renderer.addObject || !renderer.dynamicGroup) return;
    renderer.addObject(this.mesh);
    this.attached = true;
  }

  /** Set the target rain strength (0..1); it eases there over a few seconds. */
  set(target) {
    const t = Math.max(0, Math.min(1, Number(target) || 0));
    if (t === this.state.target) return;
    this.state.target = t;
    this.game.events.emit('fx:weather', { rain: t, snow: this.state.snow });
  }

  /** New world: seed the cycle from the world seed (deterministic, independent of game.rand). */
  reset(meta) {
    this.rng = mulberry32(((meta && meta.seed) || 1) ^ 0x5eaf00d);
    this.timer = 6000 + Math.floor(this.rng() * 12000);
    this.state.rain = 0; this.state.target = 0;
  }

  /** Per tick: weather cycle (only while rules.weatherCycle) and ground splashes. */
  tick(fx) {
    const g = this.game, rules = g.meta && g.meta.rules;
    if (rules && rules.weatherCycle) {
      if (--this.timer <= 0) {
        const raining = this.state.target > 0;
        this.set(raining ? 0 : 0.6 + this.rng() * 0.4);
        this.timer = raining ? 6000 + Math.floor(this.rng() * 12000) : 2400 + Math.floor(this.rng() * 4800);
      }
    }
    const rain = this.state.rain;
    if (rain > 0.05 && !this.state.snow && g.player && g.world && g.world.getHeight) {
      const p = g.player;
      const n = Math.floor(rain * 4 + this.rng());
      for (let i = 0; i < n; i++) {
        const x = Math.floor(p.x + (this.rng() - 0.5) * 20), z = Math.floor(p.z + (this.rng() - 0.5) * 20);
        const y = g.world.getHeight(x, z);
        if (y >= 128 || y <= 0 || Math.abs(y - p.y) > 12) continue;
        fx.spawnParticles('drip', x + this.rng(), y + 0.05, z + this.rng(), { count: 1, spread: 0 });
      }
    }
  }

  update(dt) {
    const g = this.game, s = this.state;
    const k = Math.min(1, dt * 0.4);
    s.rain += (s.target - s.rain) * k;
    if (Math.abs(s.target - s.rain) < 0.002) s.rain = s.target;
    const cam = g.renderer && g.renderer.camera;
    const show = !!(g.meta && cam && s.rain > 0.01);
    this.mesh.visible = show;
    if (!show) { this.geometry.setDrawRange(0, 0); return; }
    this.uniforms.uTime.value += dt;
    this.uniforms.uCam.value.copy(cam.position);
    // snow in snowy biomes / the snowy preset
    const cx = Math.floor(cam.position.x), cz = Math.floor(cam.position.z);
    let snow = g.meta.preset === 'snowy';
    const col = g.world && g.world.getColumn ? g.world.getColumn(cx >> 4, cz >> 4) : null;
    if (col && col.biomes) snow = col.biomes[(cx & 15) | ((cz & 15) << 4)] === SNOWY || snow;
    if (snow !== s.snow) { s.snow = snow; }
    this.uniforms.uSnow.value = snow ? 1 : 0;
    this.uniforms.uAlpha.value = Math.min(1, s.rain * 1.2);
    this.geometry.setDrawRange(0, Math.floor(N * Math.min(1, s.rain)) * 6);
    // heightmap around the camera (refresh on a cell change or every 20 frames)
    const ox = cx - HM / 2, oz = cz - HM / 2;
    if (ox !== this.hmOrigin.x || oz !== this.hmOrigin.z || (++this.frames % 20) === 0) {
      this.hmOrigin.x = ox; this.hmOrigin.z = oz;
      const w = g.world;
      for (let j = 0; j < HM; j++) for (let i = 0; i < HM; i++) {
        const h = w && w.getHeight ? w.getHeight(ox + i, oz + j) : 0;
        this.hmData[(j * HM + i) * 4] = Math.max(0, Math.min(255, h | 0));
      }
      this.hmTex.needsUpdate = true;
      this.uniforms.uHmOrigin.value.set(ox, oz);
    }
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose(); this.material.dispose(); this.tex.dispose(); this.hmTex.dispose();
  }
}
