// OWNER LANE: FEATURE-FX. The player's own character (SPEC §8.7): an ORIGINAL blocky kid explorer with classic
// proportions (8px head, 8x12x4 body, 4x12x4 limbs), painted procedurally from settings.skin colours. One
// merged geometry + one draw call (per-part matrices in a uniform array, like mobs - SPEC §5.5.5). The same
// skin and arm box are used for the first-person arm (viewmodel.js).
//
// Model space: pixels (1/16 block), origin at the feet centre, facing -Z (yaw 0 = north), character's right = +X.

import * as THREE from 'three';
import { hexToRgb, mulberry32 } from '../core/math.js';
import { FACE_CORNERS, CORNER_UV } from '../world/mesher.js';

export const SKIN_W = 64, SKIN_H = 64;
/** Scale from model pixels to blocks (1.8-block-tall player from a 32 px model). */
export const MODEL_SCALE = 0.9375 / 16;

export const PART = Object.freeze({ HEAD: 0, BODY: 1, RIGHT_ARM: 2, LEFT_ARM: 3, RIGHT_LEG: 4, LEFT_LEG: 5 });

/** Part layout: pivot (model px), box relative to the pivot, box-UV origin {u, v} with w,h,d. */
export const PARTS = Object.freeze([
  { name: 'head', pivot: [0, 24, 0], box: [-4, 0, -4, 4, 8, 4], uv: [0, 0] },
  { name: 'body', pivot: [0, 12, 0], box: [-4, 0, -2, 4, 12, 2], uv: [16, 16] },
  { name: 'rightArm', pivot: [6, 22, 0], box: [-2, -10, -2, 2, 2, 2], uv: [40, 16] },
  { name: 'leftArm', pivot: [-6, 22, 0], box: [-2, -10, -2, 2, 2, 2], uv: [32, 48] },
  { name: 'rightLeg', pivot: [2, 12, 0], box: [-2, -12, -2, 2, 0, 2], uv: [0, 16] },
  { name: 'leftLeg', pivot: [-2, 12, 0], box: [-2, -12, -2, 2, 0, 2], uv: [16, 48] },
]);

const FACE_KEYS = ['east', 'west', 'up', 'down', 'south', 'north'];
const FACE_LIGHT = [0.72, 0.72, 1.0, 0.55, 0.86, 0.86];

/** Box-UV rectangles {east, north, west, south, up, down} for a w x h x d box at (u, v). */
export function boxUV(u, v, w, h, d) {
  return {
    east: [u, v + d, d, h],
    north: [u + d, v + d, w, h],
    west: [u + d + w, v + d, d, h],
    south: [u + d + w + d, v + d, w, h],
    up: [u + d, v, w, d],
    down: [u + d + w, v, w, d],
  };
}

/**
 * Merge boxes into one geometry: position (px, relative to each part's pivot), uv, aPart, aShade.
 * @param {Array<{box:number[], uv:number[], part:number}>} boxes
 */
export function buildPartsGeometry(boxes, texW = SKIN_W, texH = SKIN_H) {
  const pos = [], uvs = [], part = [], shade = [], idx = [];
  let q = 0;
  for (const b of boxes) {
    const [x0, y0, z0, x1, y1, z1] = b.box;
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const rects = boxUV(b.uv[0], b.uv[1], w, h, d);
    for (let f = 0; f < 6; f++) {
      const r = rects[FACE_KEYS[f]];
      const c = FACE_CORNERS[f];
      for (let k = 0; k < 4; k++) {
        pos.push(c[k][0] ? x1 : x0, c[k][1] ? y1 : y0, c[k][2] ? z1 : z0);
        uvs.push((r[0] + (CORNER_UV[k][0] / 256) * r[2]) / texW, (r[1] + (CORNER_UV[k][1] / 256) * r[3]) / texH);
        part.push(b.part);
        shade.push(Math.round(FACE_LIGHT[f] * 255));
      }
      idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
      q++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('aPart', new THREE.BufferAttribute(new Uint8Array(part), 1));
  g.setAttribute('aShade', new THREE.BufferAttribute(new Uint8Array(shade), 1, true));
  g.setIndex(idx);
  return g;
}

/** Full player geometry (6 parts). */
export function buildPlayerGeometry() {
  const g = buildPartsGeometry(PARTS.map((p, i) => ({ box: p.box, uv: p.uv, part: i })));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 16, 0), 24);
  return g;
}

/**
 * Paint the skin (pure). colours: {hair, shirt, pants, skin} as '#rrggbb' (settings.skin).
 * Original design: tousled hair with a side fringe, big friendly eyes, rolled sleeves, belt, sneakers.
 * @returns {{w:number, h:number, data: Uint8Array}}
 */
export function paintSkin(colors = {}) {
  const C = {
    hair: hexToRgb(colors.hair || '#5a3a1e'), shirt: hexToRgb(colors.shirt || '#2f8fd8'),
    pants: hexToRgb(colors.pants || '#3a3a8a'), skin: hexToRgb(colors.skin || '#e8b48a'),
  };
  const shoe = [70, 52, 40], sole = [235, 235, 230], white = [250, 250, 250], eye = [40, 60, 120];
  const data = new Uint8Array(SKIN_W * SKIN_H * 4);
  const rnd = mulberry32(0xb10c);
  const set = (x, y, rgb, k = 1) => {
    const n = (0.94 + rnd() * 0.1) * k;
    const i = (y * SKIN_W + x) * 4;
    data[i] = Math.min(255, rgb[0] * n); data[i + 1] = Math.min(255, rgb[1] * n); data[i + 2] = Math.min(255, rgb[2] * n); data[i + 3] = 255;
  };
  const fillRect = (r, fn) => { for (let y = 0; y < r[3]; y++) for (let x = 0; x < r[2]; x++) { const c = fn(x, y); if (c) set(r[0] + x, r[1] + y, c[0], c[1]); } };
  const paint = (p, fns) => {
    const [x0, y0, z0, x1, y1, z1] = p.box;
    const rects = boxUV(p.uv[0], p.uv[1], x1 - x0, y1 - y0, z1 - z0);
    for (const k of FACE_KEYS) fillRect(rects[k], (x, y) => fns(k, x, y));
  };
  // head
  paint(PARTS[0], (face, x, y) => {
    const S = [C.skin], H = [C.hair], Hd = [C.hair, 0.82];
    if (face === 'up') return (x + y) % 5 === 0 ? Hd : H;
    if (face === 'down') return S;
    if (face === 'south') return y < 7 ? ((x * 3 + y) % 7 === 0 ? Hd : H) : S;
    if (face === 'east') return y < 3 || (x < 3 && y < 6) || (x === 3 && y === 3) ? H : S;   // u grows toward the front
    if (face === 'west') return y < 3 || (x > 4 && y < 6) || (x === 4 && y === 3) ? H : S;
    // north = face (u grows toward the character's left)
    if (y < 2) return y === 1 && (x === 3 || x === 4) ? Hd : H;
    if (y === 2) return x === 0 || x === 1 || x === 2 || x === 5 || x === 7 ? H : S;   // side fringe
    if (y === 4) {
      if (x === 1 || x === 6) return [white];
      if (x === 2 || x === 5) return [eye];
    }
    if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return [C.skin, 0.9];  // soft brows/shadow
    if (y === 5 && (x === 0 || x === 7)) return [[240, 150, 140], 0.95];             // rosy cheeks
    if (y === 6 && (x === 3 || x === 4)) return [[170, 80, 70]];                      // smile
    if (y === 6 && (x === 2 || x === 5)) return [C.skin, 0.88];
    return S;
  });
  // body
  paint(PARTS[1], (face, x, y) => {
    const sh = [C.shirt];
    if (face === 'down') return [C.pants];
    if (face === 'up') return x >= 2 && x <= 5 && y >= 1 && y <= 2 ? [C.skin] : sh;
    if (y === 11) return [C.pants, 0.8];                                              // belt
    if (face === 'north') {
      if (y === 0 && (x === 3 || x === 4)) return [C.skin];                           // collar
      if (y === 1 && (x === 3 || x === 4)) return [C.shirt, 0.8];
      if ((y === 4 || y === 5) && (x === 5 || x === 6)) return [[255, 220, 90]];      // star badge
      if (y === 10) return [C.shirt, 0.88];
    }
    return sh;
  });
  // arms (sleeves on top, hands at the bottom)
  for (const ai of [2, 3]) {
    paint(PARTS[ai], (face, x, y) => {
      if (face === 'up') return [C.shirt];
      if (face === 'down') return [C.skin, 0.92];
      if (y < 4) return y === 3 ? [C.shirt, 0.85] : [C.shirt];
      return y >= 10 ? [C.skin, 0.95] : [C.skin];
    });
  }
  // legs (trousers, sneakers)
  for (const li of [4, 5]) {
    paint(PARTS[li], (face, x, y) => {
      if (face === 'up') return [C.pants];
      if (face === 'down') return [shoe, 0.8];
      if (y >= 11) return [sole];
      if (y >= 9) return [shoe];
      return [C.pants, y === 8 ? 0.85 : 1];
    });
  }
  return { w: SKIN_W, h: SKIN_H, data };
}

/* ------------------------------------------------------------------ animation */

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _e = new THREE.Euler();

/** Write part matrices for a pose. pose: {headYaw, headPitch, limbSwing, limbAmount, swing (0..1), rightArmUp} */
export function posePlayer(mats, pose) {
  const walk = pose.limbSwing * 0.6662;
  const amt = pose.limbAmount;
  const rot = [
    [pose.headPitch, pose.headYaw, 0],
    [0, 0, 0],
    [Math.cos(walk + Math.PI) * 1.4 * amt * 0.5, 0, 0.06],
    [Math.cos(walk) * 1.4 * amt * 0.5, 0, -0.06],
    [Math.cos(walk) * 1.4 * amt, 0, 0],
    [Math.cos(walk + Math.PI) * 1.4 * amt, 0, 0],
  ];
  if (pose.swing > 0) {
    const s = Math.sin(Math.sqrt(pose.swing) * Math.PI);
    const s2 = Math.sin(pose.swing * Math.PI);
    rot[2][0] += s * 1.6 + s2 * 0.4;
    rot[2][1] += -s2 * 0.4;
    rot[1][1] += Math.sin(Math.sqrt(pose.swing) * Math.PI * 2) * 0.2;
  }
  if (pose.holding) rot[2][0] += 0.3;
  if (pose.flying) { rot[2][2] += 0.25; rot[3][2] -= 0.25; }
  for (let i = 0; i < 6; i++) {
    const p = PARTS[i].pivot;
    _e.set(rot[i][0], rot[i][1], rot[i][2], 'YXZ');
    _r.makeRotationFromEuler(_e);
    _m.makeTranslation(p[0], p[1], p[2]).multiply(_r);
    mats[i].copy(_m);
  }
}
