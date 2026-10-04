// OWNER LANE: FEATURE-FX. Things that are on fire show flames (judge findings FID-2 / POL-9):
//   EntityFire     camera-facing animated fire quads over every burning entity (mobs with fireTicks > 0, and the
//                  player model in third person), ONE instanced draw call, sampling the block array texture's
//                  animated 'fire' frames, full bright.
//   fireStripURL() the same fire frames as one vertical PNG strip for the first-person DOM fire overlay
//                  (overlays.js), so the burning player sees flames licking up the bottom of the screen.
//   burningEntities() the pure list of what burns this frame (unit tested).

import * as THREE from 'three';
import { GLSL_LIGHT } from './fxmat.js';

/** Most burning entities drawn at once (two quads each). */
export const MAX_BURNING = 48;

/**
 * Burning entities this frame as [{x, y, z, w, h, id}] (interpolated feet position, hitbox size), the player
 * included only in third person (first person uses the screen overlay) and never in creative.
 * @param {object} game @param {number} alpha @param {Array} [out]
 */
export function burningEntities(game, alpha = 1, out = []) {
  out.length = 0;
  const ents = game.entities;
  if (ents && ents.forEach) {
    ents.forEach((e) => {
      if (out.length >= MAX_BURNING || !(e.fireTicks > 0) || e.removed) return;
      const px = Number.isFinite(e.prevX) ? e.prevX : e.x, py = Number.isFinite(e.prevY) ? e.prevY : e.y, pz = Number.isFinite(e.prevZ) ? e.prevZ : e.z;
      out.push({ x: px + (e.x - px) * alpha, y: py + (e.y - py) * alpha, z: pz + (e.z - pz) * alpha, w: e.width || 0.6, h: e.height || 1.8, id: e.id | 0 });
    });
  }
  const p = game.player;
  if (p && p.view && !p.dead && !p.sleeping && p.fireTicks > 0 && !(game.isCreative && game.isCreative()) && out.length < MAX_BURNING) {
    out.push({ x: p.renderX ?? p.x, y: p.renderY ?? p.y, z: p.renderZ ?? p.z, w: p.width || 0.6, h: p.height || 1.8, id: -1 });
  }
  return out;
}

/** The fire texture's array layer, frame count and frame rate (from the block texture set). */
export function fireFrames(textures) {
  if (!textures || !textures.layer) return null;
  const a = textures.animated && textures.animated.get ? textures.animated.get('fire') : null;
  return { layer: textures.layer('fire'), frames: a ? a.frames : 1, fps: a ? a.fps : 0 };
}

/** Every fire frame stacked top to bottom in one 16 x (16 * frames) PNG data URL (DOM only; '' on failure). */
export function fireStripURL(textures) {
  try {
    const f = fireFrames(textures);
    if (!f || typeof document === 'undefined') return { url: '', frames: 1, fps: 0 };
    const S = textures.size || 16;
    const c = document.createElement('canvas'); c.width = S; c.height = S * f.frames;
    const cx = c.getContext('2d'), img = cx.createImageData(S, S * f.frames);
    img.data.set(textures.data.subarray(f.layer * S * S * 4, (f.layer + f.frames) * S * S * 4));
    cx.putImageData(img, 0, 0);
    return { url: c.toDataURL('image/png'), frames: f.frames, fps: f.fps };
  } catch { return { url: '', frames: 1, fps: 0 }; }
}

/**
 * Animated flames over burning entities: per entity two quads that turn about the vertical axis to face the
 * camera and sit just in front of the hitbox (like the classic burning look): a big one covering the body and a
 * smaller one higher up, each on its own frame phase so the flames flicker independently.
 */
export class EntityFire {
  constructor(game, shared, texRef) {
    this.game = game;
    const max = MAX_BURNING * 2;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.iPos = inst(4);   // feet centre xyz, forward push toward the camera
    this.iSize = inst(4);  // quad width, height, layer, unused
    g.setAttribute('iPos', this.iPos); g.setAttribute('iSize', this.iSize);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...shared, uTex: texRef.uniform },
      vertexShader: /* glsl */`
        in vec4 iPos;
        in vec4 iSize;
        out vec2 vUv;
        flat out float vLayer;
        out float vDist;
        void main() {
          vec3 base = iPos.xyz;
          vec2 toCam = cameraPosition.xz - base.xz;
          float l = length(toCam);
          toCam = l > 1e-4 ? toCam / l : vec2(0.0, 1.0);
          vec3 right = vec3(-toCam.y, 0.0, toCam.x);
          vec3 wp = base + vec3(toCam.x, 0.0, toCam.y) * iPos.w + right * position.x * iSize.x + vec3(0.0, position.y * iSize.y, 0.0);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vDist = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
          vUv = vec2(position.x + 0.5, 1.0 - position.y);
          vLayer = iSize.z;
        }`,
      fragmentShader: /* glsl */`
        precision highp sampler2DArray;
        uniform sampler2DArray uTex;
        in vec2 vUv;
        flat in float vLayer;
        in float vDist;
        ${GLSL_LIGHT}
        void main() {
          vec4 t = texture(uTex, vec3(clamp(vUv, 0.001, 0.999), vLayer));
          if (t.a < 0.5) discard;
          gl_FragColor = vec4(bcFog(t.rgb, vDist), 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'fx-entity-fire';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.list = [];
    this.count = 0;   // burning entities drawn this frame (stats/tests)
    this.time = 0;
  }

  update(dt, alpha) {
    const g = this.game;
    this.time += dt;
    const f = fireFrames(g.textures);
    const inWorld = !!(g.meta && (g.state === 'playing' || g.state === 'paused'));
    const list = inWorld && f ? burningEntities(g, alpha, this.list) : (this.list.length = 0, this.list);
    const P = this.iPos.array, Z = this.iSize.array;
    let n = 0;
    const tick = Math.floor(this.time * (f && f.fps ? f.fps : 12));
    for (const b of list) {
      const ph = (b.id * 5 + 3) & 7;
      // big flame sheet over the body, pushed out to the front of the hitbox
      let o = n * 4;
      P[o] = b.x; P[o + 1] = b.y - 0.05; P[o + 2] = b.z; P[o + 3] = b.w * 0.55 + 0.02;
      Z[o] = b.w * 1.45 + 0.1; Z[o + 1] = b.h * 1.1; Z[o + 2] = f.layer + ((tick + ph) % f.frames); Z[o + 3] = 0;
      n++;
      // a second, smaller sheet a bit higher and nearer the camera, on another frame
      o = n * 4;
      P[o] = b.x; P[o + 1] = b.y + b.h * 0.35; P[o + 2] = b.z; P[o + 3] = b.w * 0.55 + 0.08;
      Z[o] = b.w * 1.1 + 0.05; Z[o + 1] = b.h * 0.8; Z[o + 2] = f.layer + ((tick + ph + 3) % f.frames); Z[o + 3] = 0;
      n++;
    }
    this.count = list.length;
    if (n) {
      for (const a of [this.iPos, this.iSize]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    }
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); if (this.mesh.parent) this.mesh.parent.remove(this.mesh); }
}
