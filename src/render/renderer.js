// OWNER LANE: CORE-D (renderer/sky). STUB written by LEAD - the API is FROZEN (SPEC §5.5.2); replace the
// internals: DataArrayTexture from game.textures, the 3 shared chunk ShaderMaterials (opaque/cutout/
// translucent) with per-vertex sky/block light + AO + daylight uniform + fog, section meshes, highlight
// outline, entity materials, view-model pass, dynamic quality, context-loss handling.
//
// Stub behaviour: a real THREE.WebGLRenderer that clears to the sky colour and renders the scene graph
// (dynamic objects only - section meshes are counted but not drawn).

import * as THREE from 'three';
import { registerStub } from '../core/stubs.js';
import { computeSky } from './sky.js';
import { RENDER } from '../core/constants.js';

registerStub('renderer');

/**
 * @param {object} game
 * @returns {object} Renderer system (game.renderer)
 */
export function createRendererSystem(game) {
  const sectionMeshes = new Map(); // "cx,sy,cz" -> mesh data (stub keeps only counts)
  const r = {
    name: 'renderer',
    stub: true,
    /** @type {THREE.WebGLRenderer|null} */ three: null,
    /** @type {THREE.Scene|null} */ scene: null,
    /** @type {THREE.PerspectiveCamera|null} */ camera: null,
    /** chunk meshes live here */ worldGroup: null,
    /** entities/particles/fx live here (addObject/removeObject) */ dynamicGroup: null,
    /** held item / hand: rendered after the world with a cleared depth buffer */ viewModelScene: null,
    viewModelCamera: null,
    /** Shared uniforms of every chunk/entity material (SPEC §5.5.3). */
    uniforms: {
      uTex: { value: null }, uDaylight: { value: 1 }, uSkyColor: { value: new THREE.Color(0.47, 0.65, 1) },
      uFogColor: { value: new THREE.Color(0.72, 0.83, 1) }, uFogNear: { value: 48 }, uFogFar: { value: 88 },
      uTime: { value: 0 }, uMinLight: { value: 0.2 }, uWave: { value: 1 },
    },
    /** {near, far} while the kid soft border (or another lane) overrides the fog, else null */
    fogOverride: null,
    sky: null,
    gpu: { renderer: 'unknown', vendor: 'unknown', maxLayers: 0 },
    quality: { preset: 'medium', dpr: 1 },

    init() {
      const three = new THREE.WebGLRenderer({ canvas: game.canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
      THREE.ColorManagement.enabled = false;
      three.outputColorSpace = THREE.LinearSRGBColorSpace;
      r.quality.dpr = Math.min(window.devicePixelRatio || 1, RENDER.DPR_CAP);
      three.setPixelRatio(r.quality.dpr);
      r.three = three;
      r.scene = new THREE.Scene();
      r.scene.background = new THREE.Color(0.47, 0.65, 1);
      r.worldGroup = new THREE.Group(); r.worldGroup.name = 'world';
      r.dynamicGroup = new THREE.Group(); r.dynamicGroup.name = 'dynamic';
      r.scene.add(r.worldGroup, r.dynamicGroup);
      r.camera = new THREE.PerspectiveCamera(70, 1, RENDER.NEAR, 1000);
      r.camera.rotation.order = 'YXZ';
      r.viewModelScene = new THREE.Scene();
      r.viewModelCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
      try {
        const gl = three.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        r.gpu.renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        r.gpu.vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        r.gpu.maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
      } catch { /* ignore */ }
      r.resize();
      window.addEventListener('resize', () => r.resize());
    },

    resize() {
      if (!r.three) return;
      const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
      r.three.setSize(w, h, false);
      r.camera.aspect = w / h; r.camera.updateProjectionMatrix();
      r.viewModelCamera.aspect = w / h; r.viewModelCamera.updateProjectionMatrix();
    },

    /**
     * Replace the mesh of one section (null = remove). Disposes the previous geometry.
     * @param {number} cx @param {number} sy @param {number} cz @param {import('../core/types.js').SectionMesh|null} mesh
     */
    setSectionMesh(cx, sy, cz, mesh) {
      const key = cx + ',' + sy + ',' + cz;
      if (mesh) sectionMeshes.set(key, mesh); else sectionMeshes.delete(key);
    },
    /** Remove (and dispose) all section meshes of a column. */
    removeColumnMeshes(cx, cz) {
      for (let sy = 0; sy < 8; sy++) sectionMeshes.delete(cx + ',' + sy + ',' + cz);
    },
    /** Remove every section mesh (world exit). */
    clearWorld() { sectionMeshes.clear(); },

    /**
     * Block selection outline. target = {x, y, z, boxes: number[][]} (boxes from registry.getSelectionBoxes) or null.
     * Classic scheme: thin black lines, alpha 0.4. Kid scheme: box edges drawn as camera-facing quad strips about
     * 0.03 blocks wide, white over a black border (WebGL lines cannot be thick). SPEC §5.5.2.
     */
    setHighlight(target) { r.highlight = target; },
    highlight: null,

    /** Fog/far plane for a render distance in chunks. */
    setRenderDistance(n) {
      const far = (n - 0.5) * 16;
      r.renderFar = far;
      if (!r.fogOverride) { r.uniforms.uFogFar.value = far; r.uniforms.uFogNear.value = far * 0.6; }
      if (r.camera) { r.camera.far = far + RENDER.FAR_PAD; r.camera.updateProjectionMatrix(); }
    },
    renderFar: 88,
    /**
     * Override fog distances (kid soft border: thickening fog), or pass null to return to the render-distance
     * fog. Underwater fog still wins while the eye is in water.
     */
    setFogOverride(near, far = null) {
      if (near === null || near === undefined || far === null) {
        r.fogOverride = null;
        r.uniforms.uFogFar.value = r.renderFar; r.uniforms.uFogNear.value = r.renderFar * 0.6;
        return;
      }
      r.fogOverride = { near, far };
      r.uniforms.uFogNear.value = near; r.uniforms.uFogFar.value = far;
    },

    /** Add/remove a dynamic Object3D (entities, particles, fx). */
    addObject(obj) { if (r.dynamicGroup) r.dynamicGroup.add(obj); },
    removeObject(obj) { if (obj && obj.parent) obj.parent.remove(obj); },

    /**
     * Material for entities/particles/held items that matches world lighting + fog (SPEC §5.5.5).
     * opts.map: THREE.Texture (box-UV skin / sprite) ; opts.atlas: true => sample the block array texture using
     * the chunk vertex format (position + aTex + aLight) ; opts.transparent ; opts.alphaTest.
     * The returned material has uniforms uLightSky (0..15), uLightBlock (0..15), uTint (vec4 rgba overlay)
     * that the caller updates per entity.
     * opts.parts: N (<= 8) => ONE draw call per mob: the geometry carries a per-vertex part index attribute
     * `aPart` (Uint8, 1 component, not normalised) and the material a `uParts` uniform (array of N Matrix4,
     * identity by default) that the caller sets per frame (head, legs, ... pose). SPEC §5.5.5.
     */
    createEntityMaterial(opts = {}) {
      const m = new THREE.MeshBasicMaterial({ map: opts.map || null, transparent: !!opts.transparent, alphaTest: opts.alphaTest ?? 0.1, color: opts.color || 0xffffff });
      m.userData.stub = true;
      m.uniforms = { uLightSky: { value: 15 }, uLightBlock: { value: 0 }, uTint: { value: new THREE.Vector4(0, 0, 0, 0) } };
      if (opts.parts) m.uniforms.uParts = { value: Array.from({ length: Math.min(8, opts.parts) }, () => new THREE.Matrix4()) };
      return m;
    },

    /** A ready-to-add mesh of one block (meshBlockModel geometry + atlas material). Caller disposes geometry. */
    createBlockModel(id, state = 0) {
      const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
      return new THREE.Mesh(g, r.createEntityMaterial({ color: 0x999999 }));
    },

    frame(g, dt) {
      if (!r.three) return;
      r.uniforms.uTime.value += dt;
      const sky = computeSky(game.time ? game.time.dayTime : 6000, 0, game.time ? game.time.day : 0);
      r.sky = sky;
      r.uniforms.uDaylight.value = sky.daylight;
      r.scene.background.setRGB(sky.skyColor[0], sky.skyColor[1], sky.skyColor[2]);
      r.three.render(r.scene, r.camera);
      if (r.viewModelScene.children.length) { r.three.clearDepth(); r.three.render(r.viewModelScene, r.viewModelCamera); }
    },

    /** Small JPEG of the current view for world thumbnails (renders a frame first). */
    captureThumbnail(w = 160, h = 100) {
      if (!r.three) return null;
      r.three.render(r.scene, r.camera);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(r.three.domElement, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.7);
    },

    getStats() {
      const info = r.three ? r.three.info : { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 }, programs: [] };
      return { drawCalls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : 0, sectionMeshes: sectionMeshes.size, dpr: r.quality.dpr };
    },

    dispose() { if (r.three) r.three.dispose(); },
  };
  return r;
}
