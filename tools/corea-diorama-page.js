// OWNER LANE: CORE-A. Review-only page (never shipped): a hand-built voxel diorama rendered with three.js
// using the real TextureSet as a DataArrayTexture with the CORE-D sampling contract (Nearest mag,
// NearestMipmapLinear min, mipmaps, face shades from SPEC §3.7). Bundled by tools/corea-diorama.mjs.
import * as THREE from 'three';
import { buildTextures } from '../src/textures/textures.js';
import { bindTextures, faceLayer, ID, B_PASS, PASS, B_SHAPE, SHAPE, B_ANIM } from '../src/core/registry.js';
import { ANIM } from '../src/core/constants.js';

const params = new URLSearchParams(location.search);
const fast = params.has('fast');
const ts = buildTextures({ fastLeaves: fast });
bindTextures(ts);

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
THREE.ColorManagement.enabled = false;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setSize(1280, 720);
document.body.appendChild(renderer.domElement);

const tex = new THREE.DataArrayTexture(ts.data, 16, 16, ts.count);
tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapLinearFilter;
tex.generateMipmaps = true; tex.anisotropy = 4; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;

/* ---------------- world */
const N = 28, H = 20;
const world = new Uint8Array(N * N * H);
const at = (x, y, z) => (x < 0 || z < 0 || y < 0 || x >= N || z >= N || y >= H ? 0 : world[x + z * N + y * N * N]);
const set = (x, y, z, name) => { if (x >= 0 && z >= 0 && y >= 0 && x < N && z < N && y < H) world[x + z * N + y * N * N] = typeof name === 'number' ? name : ID[name]; };
const hgt = (x, z) => Math.round(5 + 2.2 * Math.sin(x * 0.35) + 1.8 * Math.cos(z * 0.3) + (x > 18 ? (x - 18) * 0.9 : 0));
for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
  const h = hgt(x, z);
  for (let y = 0; y <= h; y++) {
    let b = y === 0 ? 'bedrock' : y < h - 3 ? 'stone' : y < h ? 'dirt' : 'grass_block';
    if (b === 'stone') { const r = (x * 7 + y * 13 + z * 5) % 23; if (r === 1) b = 'coal_ore'; if (r === 4 && y < 4) b = 'iron_ore'; if (r === 9 && y < 3) b = 'diamond_ore'; if (r === 11) b = 'gravel'; if (r === 15 && y < 3) b = 'gold_ore'; if (r === 17) b = 'redstone_ore'; if (r === 20) b = 'lapis_ore'; }
    set(x, y, z, b);
  }
}
// pond + beach
for (let x = 3; x < 11; x++) for (let z = 14; z < 22; z++) {
  const d = Math.hypot(x - 7, z - 18);
  if (d > 4.3) continue;
  for (let y = 3; y < H; y++) set(x, y, z, 0);
  if (d < 3.4) { set(x, 2, z, 'sand'); set(x, 3, z, 'water'); set(x, 4, z, 'water'); } else { set(x, 3, z, 'sand'); set(x, 4, z, 'sand'); }
}
// cliff face cut to show stone + ores
for (let x = 20; x < N; x++) for (let z = 0; z < 6; z++) for (let y = 4; y < H; y++) set(x, y, z, 0);
// trees
function tree(x, z, log, leaves, tall = 4) {
  const y0 = hgt(x, z) + 1;
  for (let y = 0; y < tall; y++) set(x, y0 + y, z, log);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = tall - 2; dy <= tall + 1; dy++) {
    const r = dy >= tall ? 1 : 2;
    if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
    if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
    if (!at(x + dx, y0 + dy, z + dz)) set(x + dx, y0 + dy, z + dz, leaves);
  }
}
tree(14, 7, 'oak_log', 'oak_leaves'); tree(5, 6, 'birch_log', 'birch_leaves', 5); tree(16, 20, 'spruce_log', 'spruce_leaves', 5);
// little house corner
const hx = 11, hz = 12, hy = hgt(11, 12) + 1;
for (let i = 0; i < 5; i++) for (let y = 0; y < 4; y++) {
  set(hx + i, hy + y, hz, y === 0 ? 'cobblestone' : (i === 2 && y === 2) ? 'glass' : 'oak_planks');
  set(hx, hy + y, hz + i, y === 0 ? 'cobblestone' : (i === 2 && y >= 1 && y <= 2) ? 'oak_planks' : 'bricks');
}
set(hx + 2, hy + 1, hz + 1, 'crafting_table'); set(hx + 3, hy + 1, hz + 1, 'furnace');
set(hx + 1, hy + 1, hz + 3, 'bookshelf'); set(hx + 4, hy + 1, hz + 2, 'tnt'); set(hx + 4, hy + 2, hz + 2, 'tnt');
// wool row + storage blocks + misc on the grass
const row = ['white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool', 'yellow_wool', 'lime_wool', 'pink_wool', 'red_wool', 'blue_wool', 'black_wool'];
row.forEach((b, i) => set(1 + i, hgt(1 + i, 25) + 1, 25, b));
['iron_block', 'gold_block', 'diamond_block', 'emerald_block', 'lapis_block', 'redstone_block', 'coal_block', 'glowstone', 'pumpkin', 'melon', 'hay_block', 'stone_bricks', 'mossy_cobblestone', 'obsidian'].forEach((b, i) => set(13 + (i % 7), hgt(13 + (i % 7), 24 + (i >> 3) * 2) + 1, 24 + Math.floor(i / 7) * 2, b));
// plants
const plants = ['short_grass', 'dandelion', 'poppy', 'cornflower', 'blue_orchid', 'allium', 'lily_of_the_valley', 'orange_tulip', 'pink_tulip', 'fern', 'short_grass', 'short_grass', 'oak_sapling', 'red_mushroom', 'brown_mushroom'];
for (let i = 0; i < 40; i++) {
  const x = (i * 7 + 3) % N, z = (i * 11 + 5) % N;
  const y = hgt(x, z) + 1;
  if (at(x, y - 1, z) === ID.grass_block && !at(x, y, z)) set(x, y, z, plants[i % plants.length]);
}
// lava pool in the cliff
set(23, 3, 2, 'lava'); set(24, 3, 2, 'lava'); set(23, 3, 3, 'lava');
for (const [x, z] of [[23, 2], [24, 2], [23, 3]]) for (let y = 4; y < H; y++) set(x, y, z, 0);

/* ---------------- mesher (cubes + cross plants) */
const SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// corners per face: bottom-left, bottom-right, top-right, top-left seen from outside
const CORNERS = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const UV = [[0, 1], [1, 1], [1, 0], [0, 0]];
const passes = [[], [], []];
function quad(pass, pts, layer, shade, anim) {
  const P = passes[pass];
  for (const i of [0, 1, 2, 0, 2, 3]) P.push(...pts[i], UV[i][0], UV[i][1], layer, shade, anim);
}
for (let y = 0; y < H; y++) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
  const id = at(x, y, z);
  if (!id) continue;
  const pass = B_PASS[id] === PASS.TRANSLUCENT ? 2 : B_PASS[id] === PASS.CUTOUT ? 1 : 0;
  const anim = B_ANIM[id];
  if (B_SHAPE[id] === SHAPE.CROSS) {
    const L = faceLayer(id, 0, 0);
    const a = [[0.15, 0, 0.15], [0.85, 0, 0.85], [0.85, 0.9, 0.85], [0.15, 0.9, 0.15]];
    const b = [[0.85, 0, 0.15], [0.15, 0, 0.85], [0.15, 0.9, 0.85], [0.85, 0.9, 0.15]];
    for (const q of [a, b]) quad(1, q.map((p) => [x + p[0], y + p[1], z + p[2]]), L, 0.9, 0);
    continue;
  }
  const liquid = B_SHAPE[id] === SHAPE.LIQUID;
  for (let f = 0; f < 6; f++) {
    const n = at(x + DIRS[f][0], y + DIRS[f][1], z + DIRS[f][2]);
    if (n && B_PASS[n] === PASS.OPAQUE && B_SHAPE[n] === SHAPE.CUBE) continue;
    if (n === id && (pass !== 0 || liquid)) continue;
    if (n && pass === 2 && B_PASS[n] !== PASS.TRANSLUCENT && B_SHAPE[n] === SHAPE.CUBE && B_PASS[n] !== PASS.CUTOUT) continue;
    const top = liquid && !at(x, y + 1, z) ? 14 / 16 : 1;
    quad(pass, CORNERS[f].map((c) => [x + c[0], y + (c[1] ? top : 0), z + c[2]]), faceLayer(id, 0, f), SHADE[f], anim);
  }
}

const vs = `
in vec3 aData; out vec2 vUv; flat out float vLayer; out float vShade; out float vFog;
uniform float uTime; uniform vec3 uFrames; uniform vec3 uFps;
void main(){ vUv = uv; float a = aData.z; float L = aData.x;
 if (a > 0.5) { int i = int(a) - 1; L += mod(floor(uTime * uFps[i]), uFrames[i]); }
 vLayer = L; vShade = aData.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vFog = clamp((-mv.z - 30.0)/40.0, 0.0, 1.0); gl_Position = projectionMatrix * mv; }`;
const fs = `
precision highp sampler2DArray; uniform sampler2DArray uTex; uniform int uCut;
in vec2 vUv; flat in float vLayer; in float vShade; in float vFog; out vec4 oColor;
void main(){ vec4 t = texture(uTex, vec3(vUv, vLayer)); if (uCut == 1 && t.a < 0.5) discard; if (uCut == 0) t.a = 1.0;
 oColor = vec4(mix(t.rgb * vShade, vec3(0.62,0.78,1.0), vFog), t.a); }`;
const uniforms = {
  uTex: { value: tex }, uTime: { value: Number(params.get('t') || 0) },
  uFrames: { value: new THREE.Vector3(ts.animated.get('water').frames, ts.animated.get('lava').frames, ts.animated.get('fire').frames) },
  uFps: { value: new THREE.Vector3(ts.animated.get('water').fps, ts.animated.get('lava').fps, ts.animated.get('fire').fps) },
};
const scene = new THREE.Scene();
scene.background = new THREE.Color(0.62, 0.78, 1.0);
passes.forEach((arr, pass) => {
  if (!arr.length) return;
  const n = arr.length / 8;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos.set(arr.slice(i * 8, i * 8 + 3), i * 3); uv.set(arr.slice(i * 8 + 3, i * 8 + 5), i * 2); data.set(arr.slice(i * 8 + 5, i * 8 + 8), i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aData', new THREE.BufferAttribute(data, 3));
  const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vs, fragmentShader: fs, uniforms: { ...uniforms, uCut: { value: pass } }, transparent: pass === 2, depthWrite: pass !== 2, side: pass ? THREE.DoubleSide : THREE.FrontSide });
  scene.add(new THREE.Mesh(g, m));
});
const cam = new THREE.PerspectiveCamera(70, 1280 / 720, 0.05, 200);
const view = params.get('view') || 'wide';
if (view === 'wide') { cam.position.set(30, 22, 38); cam.lookAt(12, 3, 14); }
else if (view === 'close') { cam.position.set(9, 10, 22); cam.lookAt(13, 7, 13); }
else if (view === 'cliff') { cam.position.set(19, 12, 14); cam.lookAt(24, 3, 1); }
else if (view === 'ground') { cam.position.set(4, 7.6, 30); cam.lookAt(10, 5, 20); }
renderer.render(scene, cam);
window.__done = true;
void ANIM;
