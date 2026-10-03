// OWNER LANE: CORE-D (renderer/sky). API FROZEN (SPEC §5.5.2); internals are CORE-D's.
//
// WebGL2 renderer in the gamma-space pipeline (SPEC §3.7):
//   - one DataArrayTexture of every block texture (nearest magnification, per-layer mipmaps),
//   - three chunk ShaderMaterials (opaque / cutout / translucent) sharing ONE uniforms object
//     (sky*daylight + warm block light, AO, face shade, min-light floor, linear fog, waving, animated layers),
//   - opaque + cutout geometry MERGED per column per pass (one draw call each; SPEC §5.5.6) - an edit to an
//     already-merged column draws the edited section as its own small "hot" mesh (its old quads collapse to
//     degenerate triangles with a partial upload) and the column is re-merged 3 s after the last edit,
//   - translucent geometry per section (water, ice, stained glass), sorted back-to-front by three,
//   - sky gradient dome + sunrise/sunset glow, fog that matches the horizon (hides column pop-in),
//     underwater / lava fog, all from uniforms (setTime never remeshes),
//   - selection outline (classic thin lines, kid thick white-on-black ribbons),
//   - entity materials (one draw call per mob via uParts), block models, view-model pass,
//   - device presets, dynamic quality (DPR then render distance), context loss handling, F3 debug overlay.

import * as THREE from 'three';
import { SKY_PALETTE, computeSky } from './sky.js';
import { CHUNK_FRAG, CHUNK_VERT, SKY_FRAG, SKY_VERT } from './shaders.js';
import { degenerateSection, mergeColumnPass, quadCenters, quadIndices, sortQuadsBackToFront } from './chunkmerge.js';
import { DynamicScaler, detectPreset } from './quality.js';
import { Outline } from './outline.js';
import { makeEntityMaterial } from './entitymat.js';
import { ANIM, RENDER, WORLD_HEIGHT, Z } from '../core/constants.js';
import { B_LIQUID, B_PASS, PASS, bindTextures } from '../core/registry.js';
import { buildTextures } from '../textures/textures.js';
import { meshBlockModel } from '../world/mesher.js';

const PASS_KEYS = ['opaque', 'cutout', 'translucent'];
const SECTION_RADIUS = Math.sqrt(3) * 8; // 13.86
const COMPACT_DELAY_MS = 3000;
const FULL_MERGE_SECTIONS = 4;           // >= this many sections changed at once => re-merge (streaming / remeshAll)
const SORT_RADIUS = 48;                  // translucent sections closer than this get back-to-front quad sorting
const SORT_MOVE2 = 0.5 * 0.5;            // re-sort after the eye moved this far (squared)
const SORTS_PER_FRAME = 12;

/**
 * @param {object} game
 * @returns {object} Renderer system (game.renderer)
 */
export function createRendererSystem(game) {
  /** colKey -> column record (see newColumn) */
  const columns = new Map();
  /** columns with pending section meshes to apply this frame */
  const dirtyCols = new Set();
  /** translucent section meshes (per-quad back-to-front sorting near the camera) */
  const translucent = new Set();
  /** columns with hot (edited, not yet re-merged) sections */
  const hotCols = new Set();
  let sectionCount = 0;
  let chunkMats = null;          // [opaque, cutout, translucent]
  let arrayTex = null;
  let skyMesh = null;
  let outline = null;
  let preset = null;
  let forcedFastLeaves = false;
  let scaler = null;
  let lastFrameAt = 0;
  let lostTimer = 0;
  let lostOverlay = null;
  let debugEl = null, debugNext = 0;
  let warmMats = [];  // precompiled entity variants kept alive so their programs stay cached
  const blockModelMats = new Map();
  const tmpV = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const invViewProj = new THREE.Matrix4();
  const counters = { sectionSets: 0, merges: 0, hotUploads: 0, compactions: 0, textureUploads: 0, contextLosses: 0, contextRestores: 0, qualityChanges: 0, quadSorts: 0 };

  const r = {
    name: 'renderer',
    /** @type {THREE.WebGLRenderer|null} */ three: null,
    /** @type {THREE.Scene|null} */ scene: null,
    /** @type {THREE.PerspectiveCamera|null} */ camera: null,
    /** chunk meshes live here */ worldGroup: null,
    /** entities/particles/fx live here (addObject/removeObject) */ dynamicGroup: null,
    /** held item / hand: rendered after the world with a cleared depth buffer */ viewModelScene: null,
    viewModelCamera: null,
    /** Shared uniforms of every chunk material (and the shared part of entity materials). SPEC §5.5.3 */
    uniforms: {
      uTex: { value: null }, uDaylight: { value: 1 }, uSkyColor: { value: new THREE.Color(0.47, 0.65, 1) },
      uFogColor: { value: new THREE.Color(0.75, 0.85, 1) }, uFogNear: { value: 48 }, uFogFar: { value: 88 },
      uTime: { value: 0 }, uMinLight: { value: 0.155 }, uWave: { value: 1 },
      // CORE-D additions (not part of the frozen list, safe to read):
      uFogSphere: { value: 0 },
      uGamma: { value: 0.7 },   // integration: classic brightness curve strength = settings.brightness
      uAnimFrames: { value: new THREE.Vector4(0, ANIM.FRAMES[1], ANIM.FRAMES[2], ANIM.FRAMES[3]) },
      uAnimFps: { value: new THREE.Vector4(0, ANIM.FPS[1], ANIM.FPS[2], ANIM.FPS[3]) },
    },
    /** {near, far} while the kid soft border (or another lane) overrides the fog, else null */
    fogOverride: null,
    /** last computeSky() result (FX draws sun/moon/stars/clouds from it) */
    sky: computeSky(6000),
    gpu: { renderer: 'unknown', vendor: 'unknown', maxLayers: 0 },
    quality: { preset: 'medium', dpr: 1 },
    /** 'air' | 'water' | 'lava': what the camera eye is in (fog mode) */
    eyeMedium: 'air',
    highlight: null,
    renderFar: 88,
    contextLost: false,
    debugVisible: false,
    counters,

    /* ------------------------------------------------------------------ init */
    init() {
      const three = new THREE.WebGLRenderer({ canvas: game.canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
      THREE.ColorManagement.enabled = false;
      three.outputColorSpace = THREE.LinearSRGBColorSpace;
      three.info.autoReset = false;
      three.sortObjects = true;
      r.three = three;
      r.scene = new THREE.Scene();
      r.scene.background = new THREE.Color(0.75, 0.85, 1);
      r.scene.matrixWorldAutoUpdate = true;
      r.worldGroup = new THREE.Group(); r.worldGroup.name = 'world';
      r.worldGroup.matrixAutoUpdate = false;
      r.dynamicGroup = new THREE.Group(); r.dynamicGroup.name = 'dynamic';
      r.scene.add(r.worldGroup, r.dynamicGroup);
      r.camera = new THREE.PerspectiveCamera(game.settings.fov || 70, 1, RENDER.NEAR, 1000);
      r.camera.rotation.order = 'YXZ';
      r.viewModelScene = new THREE.Scene();
      r.viewModelCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);

      try {
        const gl = three.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        r.gpu.renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        r.gpu.vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
        r.gpu.maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) | 0;
      } catch { /* ignore */ }

      // ---- device preset (SPEC §5.5.6)
      preset = detectPreset(r.gpu.renderer, { touchPrimary: isTouchPrimary() });
      r.quality.preset = preset.preset;
      forcedFastLeaves = !!preset.fastLeaves;
      const needHalf = r.gpu.maxLayers > 0 && game.textures && r.gpu.maxLayers < game.textures.count;
      if (needHalf || (forcedFastLeaves && game.settings.fancyLeaves)) rebuildTextures({ halfAnim: needHalf });
      r.quality.fastLeaves = forcedFastLeaves || !game.settings.fancyLeaves; // integration: which leaf set is bound
      r.quality.dpr = targetDprMax();
      three.setPixelRatio(r.quality.dpr);

      // ---- shared texture + materials
      uploadArrayTexture();
      chunkMats = PASS_KEYS.map((k) => makeChunkMaterial(k));
      skyMesh = makeSky();
      r.scene.add(skyMesh);
      outline = new Outline();
      r.scene.add(outline.group);
      applyBrightness(game.settings.brightness ?? 0.7);
      r.uniforms.uWave.value = game.settings.waving === false ? 0 : 1;

      // ---- render distance (auto => preset) + dynamic quality
      const manualR = game.settings.renderDistance > 0;
      const R0 = manualR ? game.settings.renderDistance : preset.renderDistance;
      scaler = new DynamicScaler({ dpr: r.quality.dpr, dprMax: r.quality.dpr, r: R0, rMax: manualR ? R0 : preset.renderDistance, manualR });
      game.events.on('world:renderDistance', (e) => {
        if (!e || !Number.isFinite(e.distance)) return;
        r.setRenderDistance(e.distance);
        if (scaler) scaler.r = e.distance;
      });
      if (game.world && game.world.setRenderDistance) game.world.setRenderDistance(R0);
      r.setRenderDistance(game.world && game.world.renderDistance ? game.world.renderDistance : R0);

      // ---- events
      game.events.on('settings:changed', onSetting);
      game.events.on('world:ready', () => { if (scaler) scaler.reset(performance.now()); });
      game.events.on('input:action', (e) => { if (e && e.action === 'debug' && e.down) r.toggleDebug(); });
      game.events.on('world:exit', () => r.setHighlight(null));
      document.addEventListener('visibilitychange', () => { if (scaler) scaler.reset(performance.now()); });
      game.canvas.addEventListener('webglcontextlost', onContextLost, false);
      game.canvas.addEventListener('webglcontextrestored', onContextRestored, false);

      r.resize();
      window.addEventListener('resize', () => r.resize());
      precompile();
    },

    resize() {
      if (!r.three) return;
      const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
      r.three.setPixelRatio(r.quality.dpr);
      r.three.setSize(w, h, false);
      r.camera.aspect = w / h; r.camera.updateProjectionMatrix();
      r.viewModelCamera.aspect = w / h; r.viewModelCamera.updateProjectionMatrix();
    },

    /* ------------------------------------------------------------------ section meshes */
    /**
     * Replace the mesh of one section (null = remove). The previous geometry is disposed when the change is
     * applied (same frame, before rendering). SectionMesh arrays are kept CPU-side (context loss).
     */
    setSectionMesh(cx, sy, cz, mesh) {
      if (sy < 0 || sy >= 8) return;
      counters.sectionSets++;
      const key = cx + ',' + cz;
      let rec = columns.get(key);
      if (!rec) {
        if (!mesh) return;
        rec = newColumn(cx, cz);
        columns.set(key, rec);
      }
      const had = (rec.present >> sy) & 1;
      const has = mesh && (mesh.opaque || mesh.cutout || mesh.translucent) ? 1 : 0;
      if (had !== has) { sectionCount += has - had; rec.present ^= 1 << sy; }
      rec.pending[sy] = has ? mesh : null;
      dirtyCols.add(rec);
    },
    /** Remove (and dispose) all section meshes of a column. */
    removeColumnMeshes(cx, cz) {
      const key = cx + ',' + cz;
      const rec = columns.get(key);
      if (!rec) return;
      disposeColumn(rec);
      columns.delete(key);
      dirtyCols.delete(rec);
    },
    /** Remove every section mesh (world exit). */
    clearWorld() {
      for (const rec of columns.values()) disposeColumn(rec);
      columns.clear();
      dirtyCols.clear();
      sectionCount = 0;
      r.setHighlight(null);
      r.setFogOverride(null);
    },

    /**
     * Block selection outline. target = {x, y, z, boxes: number[][]} (boxes from registry.getSelectionBoxes) or null.
     * Classic scheme: thin black lines, alpha 0.4. Kid scheme: camera-facing ribbons ~0.03 blocks wide, white
     * over a black border. SPEC §5.5.2.
     */
    setHighlight(target) {
      r.highlight = target || null;
      if (outline) outline.set(r.highlight, isKid());
    },

    /** Fog/far plane for a render distance in chunks: fogFar = (n - 0.5) * 16, fogNear = 0.6 * fogFar. */
    setRenderDistance(n) {
      const far = (n - 0.5) * 16;
      r.renderFar = far;
      if (!r.fogOverride) { r.uniforms.uFogFar.value = far; r.uniforms.uFogNear.value = far * 0.6; }
      if (r.camera) { r.camera.far = far + RENDER.FAR_PAD; r.camera.updateProjectionMatrix(); }
    },
    /**
     * Override fog distances (kid soft border: thickening fog), or pass null to return to the render-distance
     * fog. Underwater fog still wins while the eye is in water.
     */
    setFogOverride(near, far = null) {
      if (near === null || near === undefined || far === null || far === undefined) {
        r.fogOverride = null;
        r.uniforms.uFogFar.value = r.renderFar; r.uniforms.uFogNear.value = r.renderFar * 0.6;
        return;
      }
      r.fogOverride = { near, far };
      r.uniforms.uFogNear.value = near; r.uniforms.uFogFar.value = far;
    },

    /** Add/remove a dynamic Object3D (entities, particles, fx). */
    addObject(obj) { if (r.dynamicGroup && obj) r.dynamicGroup.add(obj); },
    removeObject(obj) { if (obj && obj.parent) obj.parent.remove(obj); },

    /**
     * Material for entities/particles/held items with world lighting + fog (SPEC §5.5.5).
     * opts.map: THREE.Texture (box-UV skin / sprite; set to nearest + NoColorSpace) ; opts.atlas: true => sample
     * the block array texture with the chunk vertex format (position + aTex + aLight; aLight.z AO, .w shade) ;
     * opts.transparent ; opts.alphaTest (default 0.1) ; opts.color ; opts.side ; opts.opacity ; opts.fog (false
     * for the view model). Uniforms per material: uLightSky (0..15), uLightBlock (0..15), uTint (vec4 rgba
     * overlay: hurt red (1,0,0,0.4), TNT flash white), uColor, uOpacity.
     * opts.parts: N (<= 8) => ONE draw call per mob: geometry attribute `aPart` (Uint8, 1 component, not
     * normalised) picks uParts[aPart] (array of N Matrix4, identity by default), applied before modelMatrix.
     * material.clone() shares the global uniforms and the map texture; per-entity uniforms are copied.
     */
    createEntityMaterial(opts = {}) {
      return makeEntityMaterial(r.uniforms, opts);
    },

    /** A ready-to-add mesh of one block (meshBlockModel geometry + atlas material). Caller disposes geometry. */
    createBlockModel(id, state = 0) {
      const mb = meshBlockModel(id, state);
      const g = makeGeometry(mb.position, mb.tex, mb.light, mb.quads);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 0.9);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
      const pass = B_PASS[id & 0xff];
      let base = blockModelMats.get(pass);
      if (!base) {
        base = makeEntityMaterial(r.uniforms, pass === PASS.TRANSLUCENT ? { atlas: true, transparent: true, alphaTest: 0.02 }
          : pass === PASS.CUTOUT ? { atlas: true, alphaTest: 0.5 } : { atlas: true, alphaTest: 0.01, side: THREE.FrontSide });
        blockModelMats.set(pass, base);
      }
      const m = new THREE.Mesh(g, base.clone());
      m.name = 'block-model';
      return m;
    },

    /* ------------------------------------------------------------------ frame */
    frame(g, dt) {
      if (!r.three) return;
      const now = performance.now();
      const interval = lastFrameAt ? now - lastFrameAt : 0;
      lastFrameAt = now;
      r.uniforms.uTime.value += dt;
      updateSkyAndFog();
      flushPending(now);
      sortTranslucent();
      if (!r.contextLost && !r.three.getContext().isContextLost()) {
        render();
      }
      if (game.state === 'playing' && game.settings.dynamicQuality !== false && scaler) {
        const act = scaler.sample(now, interval, game.perf ? game.perf.workMs : 0);
        if (act) applyQuality(act);
      }
      if (r.debugVisible && now >= debugNext) { debugNext = now + 250; updateDebug(); }
    },

    /** Small JPEG of the current view for world thumbnails (renders a frame first). */
    captureThumbnail(w = 160, h = 100) {
      if (!r.three || r.contextLost || r.three.getContext().isContextLost()) return null;
      updateSkyAndFog();
      flushPending(performance.now());
      render();
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(r.three.domElement, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.8);
    },

    /**
     * CORE-D test helper: render now and return exact RGBA pixels of the view scaled to w x h
     * ({w, h, data: number[]}), or null while the context is lost.
     */
    capturePixels(w = 160, h = 90) {
      if (!r.three || r.contextLost || r.three.getContext().isContextLost()) return null;
      updateSkyAndFog();
      flushPending(performance.now());
      render();
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(r.three.domElement, 0, 0, w, h);
      return { w, h, data: Array.from(ctx.getImageData(0, 0, w, h).data) };
    },

    getStats() {
      const info = r.three ? r.three.info : null;
      let hot = 0, merged = 0, trans = 0;
      for (const rec of columns.values()) {
        for (const p of rec.passes) { if (p.mesh) merged++; for (const h of p.hot) if (h) hot++; }
        for (const t of rec.trans) if (t) trans++;
      }
      return {
        drawCalls: info ? info.render.calls : 0, triangles: info ? info.render.triangles : 0,
        geometries: info ? info.memory.geometries : 0, textures: info ? info.memory.textures : 0,
        programs: info && info.programs ? info.programs.length : 0,
        sectionMeshes: sectionCount, dpr: r.quality.dpr,
        // CORE-D extras
        columnMeshes: merged, hotSections: hot, translucentMeshes: trans, preset: r.quality.preset,
        renderFar: r.renderFar, eyeMedium: r.eyeMedium, contextLost: r.contextLost, ...counters,
      };
    },

    /** F3 debug overlay on/off. */
    toggleDebug(on = !r.debugVisible) {
      r.debugVisible = !!on;
      if (r.debugVisible && !debugEl) {
        debugEl = document.createElement('div');
        debugEl.id = 'bc-debug';
        Object.assign(debugEl.style, {
          position: 'fixed', left: '8px', top: '8px', zIndex: String(Z.DEBUG), pointerEvents: 'none', whiteSpace: 'pre',
          font: '13px/1.35 "Lucida Console", "Courier New", monospace', color: '#fff', background: 'rgba(0,0,0,0.45)',
          padding: '6px 8px', textShadow: '1px 1px 0 #000',
        });
        (game.uiRoot || document.body).appendChild(debugEl);
      }
      if (debugEl) debugEl.style.display = r.debugVisible ? 'block' : 'none';
      if (r.debugVisible) updateDebug();
      return r.debugVisible;
    },

    dispose() {
      r.clearWorld();
      if (outline) outline.dispose();
      if (chunkMats) for (const m of chunkMats) m.dispose();
      if (arrayTex) arrayTex.dispose();
      if (r.three) r.three.dispose();
    },
  };

  /* ================================================================== textures */

  function rebuildTextures(opts = {}) {
    const fast = forcedFastLeaves || !game.settings.fancyLeaves;
    const half = opts.halfAnim ?? (r.gpu.maxLayers > 0 && game.textures && r.gpu.maxLayers < game.textures.count);
    const ts = buildTextures({ fastLeaves: fast, halfAnim: !!half });
    r.quality.fastLeaves = fast;
    bindTextures(ts);
    game.textures = ts;
    return ts;
  }

  function uploadArrayTexture() {
    const ts = game.textures;
    if (!ts || !ts.data) return;
    const t = new THREE.DataArrayTexture(ts.data, ts.size || 16, ts.size || 16, ts.count);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4; // three applies it only with linear magnification; ANGLE/D3D11 anisotropy would force
    // linear magnification and blur the pixel art, so nearest-magnified layers stay crisp instead.
    t.flipY = false;
    t.unpackAlignment = 1;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    const old = arrayTex;
    arrayTex = t;
    r.uniforms.uTex.value = t;
    if (old) old.dispose();
    counters.textureUploads++;
    // animated frame counts follow the texture set (halfAnim => 8 water/lava frames)
    const fr = r.uniforms.uAnimFrames.value, fps = r.uniforms.uAnimFps.value;
    fr.set(0, ANIM.FRAMES[1], ANIM.FRAMES[2], ANIM.FRAMES[3]);
    fps.set(0, ANIM.FPS[1], ANIM.FPS[2], ANIM.FPS[3]);
    if (ts.animated && ts.animated.forEach) {
      ts.animated.forEach((a) => {
        if (!a || !(a.mode >= 1 && a.mode <= 3)) return;
        fr.setComponent(a.mode, a.frames || ANIM.FRAMES[a.mode]);
        fps.setComponent(a.mode, a.fps || ANIM.FPS[a.mode]);
      });
    }
  }

  /* ================================================================== materials */

  function makeChunkMaterial(kind) {
    const defines = {};
    if (kind === 'cutout') defines.CUTOUT = '';
    if (kind === 'translucent') defines.TRANSLUCENT = '';
    const m = new THREE.ShaderMaterial({
      name: 'bc-chunk-' + kind,
      glslVersion: THREE.GLSL3,
      vertexShader: CHUNK_VERT,
      fragmentShader: CHUNK_FRAG,
      uniforms: r.uniforms,
      defines,
      transparent: kind === 'translucent',
      depthWrite: kind !== 'translucent',
      side: kind === 'opaque' ? THREE.FrontSide : THREE.DoubleSide,
    });
    m.toneMapped = false;
    return m;
  }

  function makeSky() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const m = new THREE.ShaderMaterial({
      name: 'bc-sky',
      glslVersion: THREE.GLSL3,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uInvViewProj: { value: invViewProj },
        uSkyColor: r.uniforms.uSkyColor,
        uFogColor: r.uniforms.uFogColor,
        uSunset: { value: new THREE.Vector4(0, 0, 0, 0) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSkyFlat: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    m.toneMapped = false;
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'sky';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /** Compile every program used by world content before the first world frame (no hitch on Play). */
  function precompile() {
    try {
      const sc = new THREE.Scene();
      const g = makeGeometry(new Float32Array(12), new Uint16Array(16), new Uint8Array(16), 1);
      for (const m of chunkMats) sc.add(new THREE.Mesh(g, m));
      sc.add(skyMesh.clone());
      const common = [r.createEntityMaterial({ atlas: true, alphaTest: 0.5 }), r.createEntityMaterial({ color: 0xffffff }),
        r.createEntityMaterial({ map: new THREE.Texture(), parts: 8 })];
      for (const m of common) sc.add(new THREE.Mesh(g, m));
      r.three.compile(sc, r.camera);
      g.dispose();
      warmMats = common;
    } catch (err) { game.reportError(err, 'renderer.precompile'); }
  }

  /* ================================================================== geometry */

  function makeGeometry(position, tex, light, quads, ownIndex = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aTex', new THREE.BufferAttribute(tex, 4, false));
    g.setAttribute('aLight', new THREE.BufferAttribute(light, 4, false));
    // shared index view, except for translucent sections which re-order their quads (own copy)
    g.setIndex(new THREE.BufferAttribute(ownIndex ? quadIndices(quads).slice() : quadIndices(quads), 1));
    return g;
  }

  function newColumn(cx, cz) {
    return {
      cx, cz, present: 0,
      pending: new Array(8).fill(undefined),
      // opaque, cutout: merged column mesh + hot (edited) section meshes
      passes: [0, 1].map(() => ({ merged: null, mesh: null, hot: new Array(8).fill(null) })),
      trans: new Array(8).fill(null),
      hotCount: 0,
      compactAt: 0,
    };
  }

  function sectionMesh(rec, sy, buf, pass) {
    const g = makeGeometry(buf.position, buf.tex, buf.light, buf.quads, pass === 2);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.1, -0.1, -0.1), new THREE.Vector3(16.1, 16.1, 16.1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 8, 8), SECTION_RADIUS);
    const m = new THREE.Mesh(g, chunkMats[pass]);
    m.name = `s${rec.cx},${sy},${rec.cz}:${pass}`;
    m.matrixAutoUpdate = false;
    m.position.set(rec.cx * 16, sy * 16, rec.cz * 16);
    m.updateMatrix();
    r.worldGroup.add(m);
    if (pass === 2) {
      m.userData.centers = quadCenters(buf.position, buf.quads, rec.cx * 16, sy * 16, rec.cz * 16);
      m.userData.sortedAt = null;
      translucent.add(m);
    }
    return m;
  }

  /** Back-to-front quad order for translucent sections near the eye (water seen through water / glass). */
  function sortTranslucent() {
    if (!translucent.size) return;
    const e = r.camera.position;
    let budget = SORTS_PER_FRAME;
    for (const m of translucent) {
      const c = m.userData.centers;
      const px = m.position.x + 8 - e.x, py = m.position.y + 8 - e.y, pz = m.position.z + 8 - e.z;
      if (px * px + py * py + pz * pz > SORT_RADIUS * SORT_RADIUS) continue;
      const s = m.userData.sortedAt;
      if (s && (s[0] - e.x) ** 2 + (s[1] - e.y) ** 2 + (s[2] - e.z) ** 2 < SORT_MOVE2) continue;
      const idx = m.geometry.index;
      sortQuadsBackToFront(c, c.length / 3, e.x, e.y, e.z, idx.array);
      idx.needsUpdate = true;
      m.userData.sortedAt = [e.x, e.y, e.z];
      counters.quadSorts++;
      if (--budget <= 0) break;
    }
  }

  function columnMesh(rec, merged, pass) {
    const g = makeGeometry(merged.position, merged.tex, merged.light, merged.quads);
    const y0 = merged.minSy * 16, y1 = (merged.maxSy + 1) * 16;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.1, y0 - 0.1, -0.1), new THREE.Vector3(16.1, y1 + 0.1, 16.1));
    const c = new THREE.Vector3(8, (y0 + y1) / 2, 8);
    g.boundingSphere = new THREE.Sphere(c, Math.sqrt(128 + ((y1 - y0) / 2) ** 2) + 0.2);
    const m = new THREE.Mesh(g, chunkMats[pass]);
    m.name = `c${rec.cx},${rec.cz}:${pass}`;
    m.matrixAutoUpdate = false;
    m.position.set(rec.cx * 16, 0, rec.cz * 16);
    m.updateMatrix();
    r.worldGroup.add(m);
    return m;
  }

  function dropMesh(m) {
    if (!m) return;
    translucent.delete(m);
    r.worldGroup.remove(m);
    m.geometry.dispose();
  }

  function disposeColumn(rec) {
    for (const p of rec.passes) {
      dropMesh(p.mesh); p.mesh = null; p.merged = null;
      for (let sy = 0; sy < 8; sy++) { if (p.hot[sy]) { dropMesh(p.hot[sy].mesh); p.hot[sy] = null; } }
    }
    for (let sy = 0; sy < 8; sy++) { dropMesh(rec.trans[sy]); rec.trans[sy] = null; }
    sectionCount -= popcount(rec.present);
    rec.present = 0;
    rec.pending.fill(undefined);
    rec.hotCount = 0;
    hotCols.delete(rec);
  }

  /** Re-merge one pass of a column from its merged data + hot sections + pending replacements. */
  function fullMerge(rec, pi, pendingFor) {
    const p = rec.passes[pi];
    const sources = new Array(8);
    for (let sy = 0; sy < 8; sy++) {
      const pend = pendingFor ? pendingFor[sy] : undefined;
      if (pend !== undefined) sources[sy] = pend ? pend[PASS_KEYS[pi]] || null : null;
      else if (p.hot[sy]) sources[sy] = p.hot[sy].data;
      else sources[sy] = undefined;
    }
    const merged = mergeColumnPass(p.merged, sources);
    for (let sy = 0; sy < 8; sy++) if (p.hot[sy]) { dropMesh(p.hot[sy].mesh); p.hot[sy] = null; }
    dropMesh(p.mesh);
    p.merged = merged;
    p.mesh = merged ? columnMesh(rec, merged, pi) : null;
    counters.merges++;
  }

  /** Apply all pending section meshes (called before rendering, so edits show the same frame). */
  function flushPending(now) {
    if (dirtyCols.size) {
      for (const rec of dirtyCols) {
        let changed = 0;
        for (let sy = 0; sy < 8; sy++) if (rec.pending[sy] !== undefined) changed++;
        if (!changed) continue;
        const pend = rec.pending.slice();
        rec.pending.fill(undefined);
        for (let pi = 0; pi < 2; pi++) {
          const p = rec.passes[pi];
          if (!p.merged && !p.hot.some(Boolean)) { fullMerge(rec, pi, pend); continue; }
          if (changed >= FULL_MERGE_SECTIONS) { fullMerge(rec, pi, pend); continue; }
          // edit path: collapse the old quads of each changed section in place, draw the new ones separately
          for (let sy = 0; sy < 8; sy++) {
            if (pend[sy] === undefined) continue;
            const range = degenerateSection(p.merged, sy);
            if (range && p.mesh) {
              const attr = p.mesh.geometry.attributes.position;
              attr.addUpdateRange(range[0], range[1]);
              attr.needsUpdate = true;
              counters.hotUploads++;
            }
            if (p.hot[sy]) { dropMesh(p.hot[sy].mesh); p.hot[sy] = null; }
            const buf = pend[sy] ? pend[sy][PASS_KEYS[pi]] : null;
            if (buf && buf.quads > 0) p.hot[sy] = { mesh: sectionMesh(rec, sy, buf, pi), data: buf };
          }
        }
        // translucent: always per section (sorted individually)
        for (let sy = 0; sy < 8; sy++) {
          if (pend[sy] === undefined) continue;
          dropMesh(rec.trans[sy]); rec.trans[sy] = null;
          const buf = pend[sy] ? pend[sy].translucent : null;
          if (buf && buf.quads > 0) rec.trans[sy] = sectionMesh(rec, sy, buf, 2);
        }
        rec.hotCount = 0;
        for (const p of rec.passes) for (const h of p.hot) if (h) rec.hotCount++;
        if (rec.hotCount) { rec.compactAt = now + COMPACT_DELAY_MS; hotCols.add(rec); } else hotCols.delete(rec);
      }
      dirtyCols.clear();
    }
    // compaction: fold hot sections back into the column mesh, one column per frame, after edits settle
    for (const rec of hotCols) {
      if (now >= rec.compactAt) {
        for (let pi = 0; pi < 2; pi++) if (rec.passes[pi].hot.some(Boolean)) fullMerge(rec, pi, null);
        rec.hotCount = 0;
        hotCols.delete(rec);
        counters.compactions++;
        break;
      }
    }
  }

  /* ================================================================== sky, fog, render */

  function updateSkyAndFog() {
    const time = game.time;
    const rain = game.fx && game.fx.weather && Number.isFinite(game.fx.weather.rain) ? game.fx.weather.rain : 0;
    const sky = computeSky(time ? time.dayTime : 6000, rain, time ? time.day : 0);
    r.sky = sky;
    const u = r.uniforms;
    u.uDaylight.value = sky.daylight;
    u.uSkyColor.value.setRGB(sky.skyColor[0], sky.skyColor[1], sky.skyColor[2]);
    const cam = r.camera;
    cam.updateMatrixWorld();
    invViewProj.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    // fog colour: the horizon colour, tinted toward the sunset glow when looking at the sun (classic look)
    const fog = tmpColor.setRGB(sky.fogColor[0], sky.fogColor[1], sky.fogColor[2]);
    const sm = skyMesh ? skyMesh.material.uniforms : null;
    if (sky.sunsetColor) {
      cam.getWorldDirection(tmpV);
      const sl = Math.hypot(sky.sunDir[0], sky.sunDir[2]), ll = Math.hypot(tmpV.x, tmpV.z);
      const facing = sl > 1e-4 && ll > 1e-4 ? Math.max(0, (tmpV.x * sky.sunDir[0] + tmpV.z * sky.sunDir[2]) / (sl * ll)) : 0;
      const k = facing * facing * sky.sunsetColor[3] * 0.7;
      fog.r += (sky.sunsetColor[0] - fog.r) * k; fog.g += (sky.sunsetColor[1] - fog.g) * k; fog.b += (sky.sunsetColor[2] - fog.b) * k;
      if (sm) sm.uSunset.value.set(sky.sunsetColor[0], sky.sunsetColor[1], sky.sunsetColor[2], sky.sunsetColor[3]);
    } else if (sm) sm.uSunset.value.set(0, 0, 0, 0);
    if (sm) sm.uSunDir.value.set(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]);
    // what is the eye in?
    const medium = eyeMedium(cam.position.x, cam.position.y, cam.position.z);
    r.eyeMedium = medium;
    if (medium === 'water') {
      const d = 0.15 + 0.85 * sky.daylight;
      const c = SKY_PALETTE.UNDERWATER;
      fog.setRGB(c[0] * d, c[1] * d, c[2] * d);
      u.uFogNear.value = 0; u.uFogFar.value = 20; u.uFogSphere.value = 1;
      if (sm) sm.uSkyFlat.value = 1;
    } else if (medium === 'lava') {
      const c = SKY_PALETTE.LAVA;
      fog.setRGB(c[0], c[1], c[2]);
      u.uFogNear.value = 0; u.uFogFar.value = 2.5; u.uFogSphere.value = 1;
      if (sm) sm.uSkyFlat.value = 1;
    } else {
      const fo = r.fogOverride;
      u.uFogNear.value = fo ? fo.near : r.renderFar * 0.6;
      u.uFogFar.value = fo ? fo.far : r.renderFar;
      u.uFogSphere.value = 0;
      if (sm) sm.uSkyFlat.value = 0;
    }
    u.uFogColor.value.copy(fog);
    r.scene.background.copy(fog);
  }

  function eyeMedium(x, y, z) {
    const w = game.world;
    if (!w || !w.isOpen || y < 0 || y >= WORLD_HEIGHT || !w.getRaw) return 'air';
    const v = w.getRaw(Math.floor(x), Math.floor(y), Math.floor(z)), id = v & 0xff;
    const liq = B_LIQUID[id];
    if (!liq) return 'air';
    const st = v >> 8;
    let top = 1;
    if (!(st & 8)) {
      const above = w.getRaw(Math.floor(x), Math.floor(y) + 1, Math.floor(z)) & 0xff;
      if (B_LIQUID[above] !== liq) top = (14 / 16) * (8 - (st & 7)) / 8;
    }
    if (y - Math.floor(y) > top) return 'air';
    return liq === 2 ? 'lava' : 'water';
  }

  function render() {
    const three = r.three;
    three.info.reset();
    three.render(r.scene, r.camera);
    if (r.viewModelScene.children.length) {
      three.autoClear = false;
      three.clearDepth();
      three.render(r.viewModelScene, r.viewModelCamera);
      three.autoClear = true;
    }
  }

  /* ================================================================== quality */

  function isTouchPrimary() {
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches); } catch { return false; }
  }

  function targetDprMax() {
    const dev = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const capSetting = game.settings.pixelRatioCap > 0 ? game.settings.pixelRatioCap : 0;
    const cap = capSetting || Math.min(RENDER.DPR_CAP, preset ? preset.dprCap : RENDER.DPR_CAP);
    return Math.max(0.5, Math.min(dev, cap));
  }

  function setDpr(d) {
    r.quality.dpr = d;
    r.resize();
  }

  function applyQuality(act) {
    counters.qualityChanges++;
    if (act.type === 'dpr') setDpr(act.value);
    else if (act.type === 'r' && game.world && game.world.setRenderDistance) game.world.setRenderDistance(act.value);
  }

  /** settings.brightness 0..1: classic brightness curve (uGamma) + the cave floor light (uMinLight 0.05..0.20). */
  function applyBrightness(v) {
    const b = clamp01(Number.isFinite(v) ? v : 0.7);
    r.uniforms.uGamma.value = b;
    r.uniforms.uMinLight.value = 0.05 + 0.15 * b;
  }

  function onSetting(e) {
    if (!e) return;
    switch (e.key) {
      case 'brightness': applyBrightness(Number(e.value)); break;
      case 'waving': r.uniforms.uWave.value = e.value ? 1 : 0; break;
      case 'fov': if (r.camera) { r.camera.fov = Number(e.value) || 70; r.camera.updateProjectionMatrix(); } break;
      case 'pixelRatioCap': {
        const max = targetDprMax();
        if (scaler) { scaler.dprMax = max; scaler.dpr = max; scaler.reset(performance.now()); }
        setDpr(max);
        break;
      }
      case 'renderDistance': {
        const manual = e.value > 0;
        if (scaler) {
          scaler.manualR = manual;
          scaler.rMax = manual ? e.value : preset.renderDistance;
          scaler.reset(performance.now());
        }
        if (!manual && game.world && game.world.setRenderDistance) game.world.setRenderDistance(preset.renderDistance);
        break;
      }
      case 'dynamicQuality': if (scaler) scaler.reset(performance.now()); break;
      case 'controls': if (outline) { outline.key = ''; outline.set(r.highlight, isKid()); } break;
      case 'fancyLeaves': {
        rebuildTextures();
        uploadArrayTexture();
        if (game.world && game.world.remeshAll) game.world.remeshAll();
        break;
      }
      default: break;
    }
  }

  /* ================================================================== context loss */

  function onContextLost() {
    r.contextLost = true;
    counters.contextLosses++;
    clearTimeout(lostTimer);
    lostTimer = setTimeout(showLostOverlay, 5000);
  }

  function onContextRestored() {
    r.contextLost = false;
    counters.contextRestores++;
    clearTimeout(lostTimer);
    if (lostOverlay) { lostOverlay.remove(); lostOverlay = null; }
    try { r.three.info.autoReset = false; } catch { /* ignore */ }
    if (arrayTex) arrayTex.needsUpdate = true;
  }

  function showLostOverlay() {
    if (!r.contextLost || lostOverlay) return;
    const el = document.createElement('button');
    el.id = 'bc-context-lost';
    el.type = 'button';
    el.setAttribute('aria-label', 'Reload');
    el.textContent = '↻';
    Object.assign(el.style, {
      position: 'fixed', left: '50%', top: '50%', width: '160px', height: '160px', margin: '-80px 0 0 -80px',
      borderRadius: '50%', border: '6px solid #fff', background: 'rgba(40,60,120,0.85)', color: '#fff',
      font: 'bold 96px/1 sans-serif', cursor: 'pointer', zIndex: String(Z.DEBUG + 10), boxShadow: '0 6px 0 rgba(0,0,0,0.4)',
    });
    el.addEventListener('click', () => location.reload());
    el.addEventListener('touchend', () => location.reload());
    (game.uiRoot || document.body).appendChild(el);
    lostOverlay = el;
  }

  /* ================================================================== debug overlay */

  function updateDebug() {
    if (!debugEl) return;
    const s = r.getStats();
    const p = game.player;
    const w = game.world && game.world.stats ? game.world.stats() : {};
    const f = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : '-');
    debugEl.textContent = [
      `Blockcraft ${game.version}`,
      `${f(game.perf.fps, 0)} fps  frame ${f(game.perf.frameMs)} ms  work ${f(game.perf.workMs)} ms  tick ${f(game.perf.tickMs, 2)} ms`,
      `draws ${s.drawCalls}  tris ${s.triangles}  geo ${s.geometries}  tex ${s.textures}  prog ${s.programs}`,
      `sections ${s.sectionMeshes}  columns ${s.columnMeshes}  hot ${s.hotSections}  water ${s.translucentMeshes}`,
      `R ${w.renderDistance ?? '-'}  loaded ${w.columns ?? '-'}  meshed ${w.columnsMeshed ?? '-'}  dpr ${r.quality.dpr}  ${r.quality.preset}`,
      p ? `xyz ${f(p.x, 2)} ${f(p.y, 2)} ${f(p.z, 2)}  yaw ${f(p.yaw * 57.2958, 0)} pitch ${f(p.pitch * 57.2958, 0)}` : '',
      `time ${game.time ? game.time.dayTime : '-'}  daylight ${f(r.sky.daylight, 2)}  eye ${r.eyeMedium}`,
      `${r.gpu.renderer}`,
    ].join('\n');
  }

  function isKid() { return game.settings.controls !== 'classic'; }

  return r;
}

function clamp01(v) { return !(v > 0) ? 0 : v > 1 ? 1 : v; }
function popcount(v) { let n = 0; while (v) { n += v & 1; v >>>= 1; } return n; }
