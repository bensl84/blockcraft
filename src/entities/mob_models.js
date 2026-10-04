// OWNER LANE: FEATURE-MOBS. Box models for every mob (SPEC §8.1 "Rendering"), as plain data + pure helpers:
//   - MODELS[type] = { parts: [{name, pivot}], boxes: [{part, from, to, skin, inflate?, variant?}], head, kind }
//     Units are model pixels (16 = 1 block), origin at the feet centre, the model faces -Z (yaw 0 = north).
//   - packModel(model): box-UV layout (each box's unfolded net packed into one skin), deterministic.
//   - buildModelArrays(model, variants): ONE merged vertex buffer per model+variant with a per-vertex part
//     index (aPart) so a whole mob is one draw call posed through uParts matrices (SPEC §5.5.5).
//   - poseModel(type, e, alpha, out): per-part rotations for the walk cycle, head look, sitting, wings...
// No three.js and no DOM here (Node unit tests cover the layout and buffers); mob_render.js wraps it in THREE.

export const PX = 1 / 16;

const P = (name, pivot, parent) => (parent === undefined ? { name, pivot } : { name, pivot, parent });
const B = (part, from, to, skin, extra = {}) => ({ part, from, to, skin, ...extra });

/** Quadruped helper: 4 legs (front-left, front-right, back-left, back-right) of size lw x lh x lw. */
function quadLegs(firstPart, lx, lw, lh, zFront, zBack, skin = 'leg') {
  const out = [];
  const xs = [-lx, lx];
  const zs = [zFront, zBack];
  let p = firstPart;
  for (const z of zs) for (const x of xs) {
    const x0 = x < 0 ? x - lw / 2 : x - lw / 2, z0 = z - lw / 2;
    out.push(B(p++, [x0, 0, z0], [x0 + lw, lh, z0 + lw], skin));
  }
  return out;
}
function quadLegParts(lx, lh, zFront, zBack) {
  return [P('legFL', [-lx, lh, zFront]), P('legFR', [lx, lh, zFront]), P('legBL', [-lx, lh, zBack]), P('legBR', [lx, lh, zBack])];
}

export const MODELS = {
  pig: {
    kind: 'quad', head: 1, legs: [2, 3, 4, 5], saddlePart: 6,
    parts: [P('body', [0, 10, 0]), P('head', [0, 12, -7]), ...quadLegParts(3, 6, -5, 5), P('saddle', [0, 10, 0])],
    boxes: [
      B(0, [-5, 6, -8], [5, 14, 8], 'body'),
      B(1, [-4, 8, -14], [4, 16, -6], 'head'),
      B(1, [-2, 9, -15], [2, 12, -14], 'snout'),
      B(0, [-1, 11, 8], [1, 13, 9], 'tail'),
      ...quadLegs(2, 3, 4, 6, -5, 5),
      B(6, [-5, 13.5, -5], [5, 14.5, 4], 'saddle', { inflate: 0.25 }),
    ],
  },
  cow: {
    kind: 'quad', head: 1, legs: [2, 3, 4, 5],
    parts: [P('body', [0, 17, 0]), P('head', [0, 18, -9]), ...quadLegParts(4, 12, -6, 6)],
    boxes: [
      B(0, [-6, 12, -9], [6, 22, 9], 'body'),
      B(0, [-2, 10, 4], [2, 12, 8], 'udder'),
      B(1, [-4, 14, -15], [4, 22, -9], 'head'),
      B(1, [-3, 14, -16], [3, 17, -15], 'muzzle'),
      B(1, [-5, 20, -13], [-4, 23, -12], 'horn'),
      B(1, [4, 20, -13], [5, 23, -12], 'horn'),
      ...quadLegs(2, 4, 4, 12, -6, 6),
    ],
  },
  sheep: {
    kind: 'quad', head: 1, legs: [2, 3, 4, 5],
    parts: [P('body', [0, 15, 0]), P('head', [0, 17, -6]), ...quadLegParts(2.5, 12, -5.5, 5.5)],
    boxes: [
      B(0, [-4, 12, -8], [4, 18, 8], 'body'),
      B(1, [-3, 14, -14], [3, 20, -6], 'head'),
      ...quadLegs(2, 2.5, 3, 12, -5.5, 5.5),
      B(0, [-4, 12, -8], [4, 18, 8], 'wool', { inflate: 1.75, variant: 'wool' }),
      B(1, [-3, 15, -12], [3, 20, -6], 'wool', { inflate: 0.6, variant: 'wool' }),
      ...quadLegs(2, 2.5, 3, 12, -5.5, 5.5, 'wool').map((b) => ({ ...b, from: [b.from[0], 6, b.from[2]], inflate: 0.5, variant: 'wool' })),
    ],
  },
  chicken: {
    kind: 'chicken', head: 1, legs: [2, 3], wings: [4, 5],
    parts: [P('body', [0, 8, 0]), P('head', [0, 10, -4]), P('legL', [-1.5, 5, 0.5]), P('legR', [1.5, 5, 0.5]), P('wingL', [-3, 10, 0]), P('wingR', [3, 10, 0])],
    boxes: [
      B(0, [-3, 5, -4], [3, 11, 4], 'body'),
      B(1, [-2, 9, -6], [2, 15, -3], 'head'),
      B(1, [-2, 11, -8], [2, 13, -6], 'beak'),
      B(1, [-1, 9, -7], [1, 11, -6], 'wattle'),
      B(2, [-2, 0, 0], [-1, 5, 1], 'leg'),
      B(2, [-3, 0, -1], [0, 0.5, 1], 'leg'),
      B(3, [1, 0, 0], [2, 5, 1], 'leg'),
      B(3, [0, 0, -1], [3, 0.5, 1], 'leg'),
      B(4, [-4, 6, -3], [-3, 10, 3], 'wing'),
      B(5, [3, 6, -3], [4, 10, 3], 'wing'),
    ],
  },
  wolf: {
    kind: 'quad', head: 1, legs: [2, 3, 4, 5], tail: 6,
    sit: { body: 0.5, bodyTy: -2.5, hindRx: -1.35, hindTy: -2.2, hindTz: -1.5, frontRx: -0.15, headTy: 0.5 },
    parts: [P('body', [0, 9, 2]), P('head', [0, 11, -6]), ...quadLegParts(2, 6, -4, 6), P('tail', [0, 10, 8], 0)],
    boxes: [
      B(0, [-3, 6, -1], [3, 12, 8], 'body'),
      B(0, [-4, 6, -6], [4, 13, -1], 'mane'),
      B(1, [-3, 8, -10], [3, 14, -6], 'head'),
      B(1, [-1.5, 8, -13], [1.5, 11, -10], 'snout'),
      B(1, [-3, 14, -8], [-1, 16, -7], 'ear'),
      B(1, [1, 14, -8], [3, 16, -7], 'ear'),
      ...quadLegs(2, 2, 2, 6, -4, 6),
      B(6, [-1, 8, 8], [1, 10, 14], 'tail'),
    ],
  },
  cat: {
    kind: 'quad', head: 1, legs: [2, 3, 4, 5], tail: 6,
    sit: { body: 0.7, bodyTy: 0.5, hindRx: -1.4, hindTy: -0.5, hindTz: -2.5, frontRx: -0.25, frontTy: 2.5, headTy: 4.5, headTz: 1 },
    parts: [P('body', [0, 6, 0]), P('head', [0, 8, -7]), ...quadLegParts(1, 4, -5, 4), P('tail', [0, 8, 6], 0)],
    boxes: [
      B(0, [-2, 4, -7], [2, 9, 6], 'body'),
      B(1, [-2.5, 6, -11], [2.5, 10, -7], 'head'),
      B(1, [-1.5, 6, -12], [1.5, 8, -11], 'nose'),
      B(1, [-2, 10, -9], [-1, 11, -8], 'ear'),
      B(1, [1, 10, -9], [2, 11, -8], 'ear'),
      ...quadLegs(2, 1, 2, 4, -5, 4),
      B(6, [-0.5, 7, 6], [0.5, 8, 14], 'tail'),
    ],
  },
  horse: {
    kind: 'quad', head: 1, legs: [2, 3, 4, 5], tail: 6, saddlePart: 7,
    parts: [P('body', [0, 16, 0]), P('head', [0, 20, -11]), ...quadLegParts(3, 11, -8, 8), P('tail', [0, 20, 11], 0), P('saddle', [0, 16, 0], 0)],
    boxes: [
      B(0, [-5, 11, -11], [5, 21, 11], 'body'),
      B(1, [-2, 18, -16], [2, 28, -11], 'neck'),
      B(1, [-2.5, 24, -22], [2.5, 29, -16], 'head'),
      B(1, [-1, 20, -11], [1, 30, -9], 'mane'),
      B(1, [-2, 29, -15], [-1, 31, -14], 'ear'),
      B(1, [1, 29, -15], [2, 31, -14], 'ear'),
      ...quadLegs(2, 3, 4, 11, -8, 8),
      B(6, [-1.5, 12, 11], [1.5, 20, 14], 'tail'),
      B(7, [-5, 20.5, -6], [5, 22.5, 4], 'saddle', { inflate: 0.3 }),
    ],
  },
  zombie: {
    kind: 'humanoid', head: 0, arms: [2, 3], legs: [4, 5],
    parts: [P('head', [0, 24, 0]), P('body', [0, 24, 0]), P('armR', [-6, 22, 0]), P('armL', [6, 22, 0]), P('legR', [-2, 12, 0]), P('legL', [2, 12, 0])],
    boxes: [
      B(0, [-4, 24, -4], [4, 32, 4], 'head'),
      B(1, [-4, 12, -2], [4, 24, 2], 'body'),
      B(2, [-8, 12, -2], [-4, 24, 2], 'arm'),
      B(3, [4, 12, -2], [8, 24, 2], 'arm'),
      B(4, [-4, 0, -2], [0, 12, 2], 'leg'),
      B(5, [0, 0, -2], [4, 12, 2], 'leg'),
    ],
  },
  skeleton: {
    kind: 'humanoid', head: 0, arms: [2, 3], legs: [4, 5], bowArm: 2,
    parts: [P('head', [0, 24, 0]), P('body', [0, 24, 0]), P('armR', [-5, 22, 0]), P('armL', [5, 22, 0]), P('legR', [-2, 12, 0]), P('legL', [2, 12, 0])],
    boxes: [
      B(0, [-4, 24, -4], [4, 32, 4], 'head'),
      B(1, [-4, 12, -2], [4, 24, 2], 'body'),
      B(2, [-6, 12, -1], [-4, 24, 1], 'arm'),
      B(3, [4, 12, -1], [6, 24, 1], 'arm'),
      B(2, [-5.5, 7, -2], [-4.5, 17, -1], 'bow'),
      B(4, [-3, 0, -1], [-1, 12, 1], 'leg'),
      B(5, [1, 0, -1], [3, 12, 1], 'leg'),
    ],
  },
  creeper: {
    kind: 'quad', head: 0, legs: [2, 3, 4, 5],
    parts: [P('head', [0, 18, 0]), P('body', [0, 6, 0]), ...quadLegParts(2, 6, -4, 4)],
    boxes: [
      B(0, [-4, 18, -4], [4, 26, 4], 'head'),
      B(1, [-4, 6, -2], [4, 18, 2], 'body'),
      ...quadLegs(2, 2, 4, 6, -4, 4),
    ],
  },
  spider: {
    kind: 'spider', head: 1, legGroups: [2, 3, 4, 5],
    parts: [P('body', [0, 8, 0]), P('head', [0, 8, -3]), P('legLA', [-3, 8, 0]), P('legLB', [-3, 8, 0]), P('legRA', [3, 8, 0]), P('legRB', [3, 8, 0])],
    boxes: [
      B(0, [-3, 5, -3], [3, 11, 3], 'thorax'),
      B(0, [-5, 4, 3], [5, 12, 15], 'abdomen'),
      B(1, [-4, 4, -11], [4, 12, -3], 'head'),
      // four legs per side, alternating phase groups A/B
      B(2, [-19, 7, -4], [-3, 9, -2], 'leg'), B(3, [-19, 7, -2], [-3, 9, 0], 'leg'),
      B(2, [-19, 7, 0], [-3, 9, 2], 'leg'), B(3, [-19, 7, 2], [-3, 9, 4], 'leg'),
      B(4, [3, 7, -4], [19, 9, -2], 'leg'), B(5, [3, 7, -2], [19, 9, 0], 'leg'),
      B(4, [3, 7, 0], [19, 9, 2], 'leg'), B(5, [3, 7, 2], [19, 9, 4], 'leg'),
    ],
  },
  boat: {
    kind: 'boat', head: -1,
    parts: [P('hull', [0, 0, 0]), P('paddleL', [-9, 9, -2]), P('paddleR', [9, 9, -2])],
    boxes: [
      B(0, [-10, 0, -14], [10, 3, 14], 'bottom'),
      B(0, [-11, 3, -14], [-9, 9, 14], 'side'),
      B(0, [9, 3, -14], [11, 9, 14], 'side'),
      B(0, [-9, 3, -15], [9, 9, -13], 'end'),
      B(0, [-9, 3, 13], [9, 9, 15], 'end'),
      B(0, [-9, 6, 2], [9, 7, 5], 'seat'),
      B(1, [-10, 9, -3], [-9, 10, 7], 'paddle'),
      B(1, [-10.5, 6, 5], [-8.5, 9, 9], 'paddle'),
      B(2, [9, 9, -3], [10, 10, 7], 'paddle'),
      B(2, [8.5, 6, 5], [10.5, 9, 9], 'paddle'),
    ],
  },
};

/* ------------------------------------------------------------------ UV layout */

/** Size of a box in model pixels. */
export function boxSize(b) { return [b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]]; }
/** Unfolded net size (classic box-UV): width 2d + 2w, height d + h, rounded up to whole texels. */
export function netSize(b) {
  const [w, h, d] = boxSize(b).map((v) => Math.ceil(v - 1e-6));
  return [2 * d + 2 * w, d + h, w, h, d];
}

/**
 * Pack every box net into one skin with a simple shelf packer (sorted by height, stable). Deterministic.
 * Returns {width, height, rects: [{u, v, w, h, d}] per box index}. width is 64 or 128, height a power of two.
 */
export function packModel(model) {
  if (model._pack) return model._pack;
  const items = model.boxes.map((b, i) => ({ i, n: netSize(b) }));
  const order = items.slice().sort((a, b) => (b.n[1] - a.n[1]) || (b.n[0] - a.n[0]) || (a.i - b.i));
  const maxW = Math.max(...items.map((x) => x.n[0]));
  const width = maxW > 64 ? 128 : 64;
  const rects = new Array(items.length);
  let x = 0, y = 0, shelfH = 0;
  for (const it of order) {
    const [nw, nh, w, h, d] = it.n;
    if (x + nw > width) { x = 0; y += shelfH; shelfH = 0; }
    rects[it.i] = { u: x, v: y, w, h, d };
    x += nw; shelfH = Math.max(shelfH, nh);
  }
  let height = 16;
  while (height < y + shelfH) height *= 2;
  model._pack = { width, height, rects };
  return model._pack;
}

/** Face rectangles of a packed box in skin pixels: {up, down, east, front, west, back} -> [x, y, w, h]. */
export function faceRects(r) {
  const { u, v, w, h, d } = r;
  return {
    up: [u + d, v, w, d], down: [u + d + w, v, w, d],
    east: [u, v + d, d, h], front: [u + d, v + d, w, h], west: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
  };
}

/* ------------------------------------------------------------------ merged buffers */

/** Which boxes a variant set includes: boxes without a variant always, boxes with one only when listed. */
export function boxesFor(model, variants = []) { return model.boxes.map((b, i) => [b, i]).filter(([b]) => !b.variant || variants.includes(b.variant)); }

/**
 * One merged buffer set for a model + variants: {position: Float32Array (blocks), uv: Float32Array,
 * part: Uint8Array, index: Uint16Array, vertices, triangles}. Faces wind counter-clockwise seen from outside;
 * uv v is flipped for a flipY canvas texture (v = 1 - y / height).
 */
export function buildModelArrays(model, variants = []) {
  const pack = packModel(model);
  const list = boxesFor(model, variants);
  const nV = list.length * 24;
  const position = new Float32Array(nV * 3), uv = new Float32Array(nV * 2), part = new Uint8Array(nV), index = new Uint16Array(list.length * 36);
  let vi = 0, ii = 0;
  const W = pack.width, H = pack.height;
  for (const [b, bi] of list) {
    const inf = b.inflate || 0;
    const x0 = (b.from[0] - inf) * PX, y0 = (b.from[1] - inf) * PX, z0 = (b.from[2] - inf) * PX;
    const x1 = (b.to[0] + inf) * PX, y1 = (b.to[1] + inf) * PX, z1 = (b.to[2] + inf) * PX;
    const fr = faceRects(pack.rects[bi]);
    // corners TL, TR, BR, BL as seen from outside the face
    const faces = [
      ['front', [x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]],
      ['back', [x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
      ['east', [x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
      ['west', [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
      ['up', [x1, y1, z1], [x0, y1, z1], [x0, y1, z0], [x1, y1, z0]],
      ['down', [x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1]],
    ];
    for (const [name, tl, tr, br, bl] of faces) {
      const [rx, ry, rw, rh] = fr[name];
      const corners = [tl, tr, br, bl];
      const uvs = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]];
      const base = vi;
      for (let k = 0; k < 4; k++) {
        position[vi * 3] = corners[k][0]; position[vi * 3 + 1] = corners[k][1]; position[vi * 3 + 2] = corners[k][2];
        uv[vi * 2] = uvs[k][0] / W; uv[vi * 2 + 1] = 1 - uvs[k][1] / H;
        part[vi] = b.part;
        vi++;
      }
      // (TL, BL, BR) + (TL, BR, TR): counter-clockwise from outside
      index[ii++] = base; index[ii++] = base + 3; index[ii++] = base + 2;
      index[ii++] = base; index[ii++] = base + 2; index[ii++] = base + 1;
    }
  }
  return { position, uv, part, index, vertices: nV, triangles: list.length * 12 };
}

/* ------------------------------------------------------------------ animation */

/**
 * Per-part pose for one frame. `out[i]` = {rx, ry, rz, s, tx, ty, tz} (radians, scale, translation in px).
 * `e` is the mob (render fields: limbSwing, limbAmount, headYaw, headPitch, baby, and type extras).
 * Walk: cos(p * 0.6662) * 1.4 * amt (SPEC §8.1). Head look clamped to +-50 degrees by the AI.
 */
export function poseModel(model, e, t, out) {
  for (let i = 0; i < model.parts.length; i++) {
    const o = out[i] || (out[i] = { rx: 0, ry: 0, rz: 0, s: 1, tx: 0, ty: 0, tz: 0 });
    o.rx = 0; o.ry = 0; o.rz = 0; o.s = 1; o.tx = 0; o.ty = 0; o.tz = 0;
  }
  const p = e.limbSwing || 0, amt = Math.min(1, e.limbAmount || 0);
  const swing = (ph) => Math.cos(p * 0.6662 + ph) * 1.4 * amt;
  const h = model.head >= 0 ? out[model.head] : null;
  if (h) { h.ry = e.headYaw || 0; h.rx = e.headPitch || 0; if (e.baby) h.s = 1.5; }

  if (model.kind === 'quad' && model.legs) {
    const [fl, fr, bl, br] = model.legs;
    out[fl].rx = swing(0); out[br].rx = swing(0); out[fr].rx = swing(Math.PI); out[bl].rx = swing(Math.PI);
    if (e.sitting && model.sit) {
      // hind legs fold forward, body tilts back, front legs straighten (tail follows the body: parent 0)
      const st = model.sit;
      out[bl].rx = out[br].rx = st.hindRx; out[bl].ty = out[br].ty = st.hindTy; out[bl].tz = out[br].tz = st.hindTz;
      out[fl].rx = out[fr].rx = st.frontRx; out[fl].ty = out[fr].ty = st.frontTy || 0;
      out[0].rx = st.body; out[0].ty = st.bodyTy;
      if (h) { h.ty = st.headTy || 0; h.tz = st.headTz || 0; }
    }
    if (e.eating > 0 && h) {
      // sheep grazing: head down to the grass
      const k = Math.min(1, e.eating / 6) * Math.min(1, (40 - e.eating) / 6 + 0.001);
      h.rx = -1.1 * Math.max(0, Math.min(1, k)); h.ty = -5 * Math.max(0, Math.min(1, k));
    }
  } else if (model.kind === 'humanoid') {
    const [ar, al] = model.arms, [lr, ll] = model.legs;
    out[lr].rx = swing(0); out[ll].rx = swing(Math.PI);
    if (e.armsUp) {
      out[ar].rx = out[al].rx = -Math.PI / 2 + Math.sin(t * 0.1) * 0.05;
      out[ar].rz = 0.08; out[al].rz = -0.08;
    } else { out[ar].rx = swing(Math.PI) * 0.8; out[al].rx = swing(0) * 0.8; }
    if (e.aiming && model.bowArm !== undefined) { out[ar].rx = -Math.PI / 2; out[ar].ry = -0.1 + (h ? h.ry : 0); out[al].rx = -Math.PI / 2; out[al].ry = 0.4; }
  } else if (model.kind === 'chicken') {
    const [lL, lR] = model.legs, [wL, wR] = model.wings;
    out[lL].rx = swing(0); out[lR].rx = swing(Math.PI);
    const flap = e.flap || 0;
    out[wL].rz = -flap; out[wR].rz = flap;
  } else if (model.kind === 'spider') {
    const [la, lb, ra, rb] = model.legGroups;
    const base = 0.42;
    const s = Math.sin(p * 0.6662 * 1.5) * 0.35 * amt, c = Math.abs(Math.cos(p * 0.6662 * 1.5)) * 0.2 * amt;
    out[la].rz = base + c; out[lb].rz = base + 0.15 - c;
    out[ra].rz = -base - c; out[rb].rz = -base - 0.15 + c;
    out[la].ry = s; out[lb].ry = -s; out[ra].ry = -s; out[rb].ry = s;
  } else if (model.kind === 'boat') {
    const a = e.paddle || 0;
    out[1].rx = Math.sin(a) * 0.6; out[2].rx = Math.sin(a) * 0.6;
  }
  if (model.tail !== undefined) {
    const tl = out[model.tail];
    if (e.type === 'wolf') {
      // tail height shows health for tamed wolves; wag when tamed and happy
      tl.rx = e.tailLift !== undefined ? e.tailLift : 0.35;
      if (e.wag) tl.ry = Math.sin(t * 0.5) * 0.5;
    } else if (e.type === 'cat') { tl.rx = -0.6 + Math.sin(t * 0.08) * 0.15; tl.ry = Math.sin(t * 0.05) * 0.3; }
    else if (e.type === 'horse') { tl.rx = -(0.15 + amt * 0.5); tl.ry = Math.sin(t * 0.07) * 0.15; }
  }
  if (model.saddlePart !== undefined) out[model.saddlePart].s = e.saddled ? 1 : 0;
  return out;
}
