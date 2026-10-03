// OWNER LANE: CORE-D. Block selection outline (SPEC §5.5.2 setHighlight).
//   classic: thin black lines, alpha 0.4 (box grown by 0.002 so it never z-fights the faces)
//   kid:     each box edge is a camera-facing ribbon ~0.03 blocks wide, white over a wider black border,
//            widened with distance so it stays >= ~2 px (WebGL lines cannot be thick).
// Geometry is rebuilt only when the target cell, its boxes or the scheme change.

import * as THREE from 'three';
import { OUTLINE_RIBBON_FRAG, OUTLINE_RIBBON_VERT } from './shaders.js';

const EDGES = [
  [0, 1], [1, 3], [3, 2], [2, 0], // bottom (corner bits: x=1, z=2, y=4)
  [4, 5], [5, 7], [7, 6], [6, 4], // top
  [0, 4], [1, 5], [2, 6], [3, 7], // verticals
];

function corner(b, c, grow) {
  return [
    (c & 1 ? b[3] : b[0]) + (c & 1 ? grow : -grow),
    (c & 4 ? b[4] : b[1]) + (c & 4 ? grow : -grow),
    (c & 2 ? b[5] : b[2]) + (c & 2 ? grow : -grow),
  ];
}

/** Line-segment positions (classic) for a list of boxes. */
export function lineSegmentsFor(boxes, grow = 0.002) {
  const out = new Float32Array(boxes.length * 12 * 6);
  let o = 0;
  for (const b of boxes) {
    for (const [a, c] of EDGES) {
      const p = corner(b, a, grow), q = corner(b, c, grow);
      out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2];
      out[o++] = q[0]; out[o++] = q[1]; out[o++] = q[2];
    }
  }
  return out;
}

/** Ribbon attributes (kid) for a list of boxes: 4 vertices + 6 indices per edge. */
export function ribbonFor(boxes, grow = 0.004) {
  const edges = boxes.length * 12;
  const start = new Float32Array(edges * 4 * 3);
  const end = new Float32Array(edges * 4 * 3);
  const side = new Float32Array(edges * 4);
  const along = new Float32Array(edges * 4);
  const index = new Uint16Array(edges * 6);
  let e = 0;
  for (const b of boxes) {
    for (const [a, c] of EDGES) {
      const p = corner(b, a, grow), q = corner(b, c, grow);
      for (let k = 0; k < 4; k++) {
        const v = e * 4 + k;
        start.set(p, v * 3); end.set(q, v * 3);
        side[v] = k === 0 || k === 3 ? -1 : 1;
        along[v] = k >= 2 ? 1 : 0;
      }
      const v0 = e * 4, i0 = e * 6;
      index[i0] = v0; index[i0 + 1] = v0 + 1; index[i0 + 2] = v0 + 2;
      index[i0 + 3] = v0; index[i0 + 4] = v0 + 2; index[i0 + 5] = v0 + 3;
      e++;
    }
  }
  return { start, end, side, along, index };
}

export class Outline {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'outline';
    this.group.visible = false;
    this.group.matrixAutoUpdate = false;
    this.key = '';
    this.boxesRef = null;
    this.lineMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false, fog: false });
    const ribbon = (color, width, minPx, order) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: OUTLINE_RIBBON_VERT,
      fragmentShader: OUTLINE_RIBBON_FRAG,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uWidth: { value: width }, uMinPx: { value: minPx } },
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.borderMat = ribbon(0x000000, 0.056, 0.0078, 0);
    this.coreMat = ribbon(0xffffff, 0.03, 0.0042, 1);
    this.lines = null;
    this.border = null;
    this.core = null;
  }

  /** @param {{x:number,y:number,z:number,boxes:number[][]}|null} target @param {boolean} kid */
  set(target, kid) {
    if (!target || !target.boxes || !target.boxes.length) { this.group.visible = false; return; }
    const key = `${kid ? 'k' : 'c'}${target.x},${target.y},${target.z}`;
    if (key !== this.key || target.boxes !== this.boxesRef) {
      this.key = key;
      this.boxesRef = target.boxes;
      this.rebuild(target.boxes, kid);
      this.group.position.set(target.x, target.y, target.z);
      this.group.updateMatrix();
      this.group.updateMatrixWorld(true);
    }
    this.group.visible = true;
  }

  rebuild(boxes, kid) {
    this.clear();
    if (kid) {
      const r = ribbonFor(boxes);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(r.start, 3));
      g.setAttribute('aEnd', new THREE.BufferAttribute(r.end, 3));
      g.setAttribute('aSide', new THREE.BufferAttribute(r.side, 1));
      g.setAttribute('aAlong', new THREE.BufferAttribute(r.along, 1));
      g.setIndex(new THREE.BufferAttribute(r.index, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0.5, 0.5), 2);
      this.border = new THREE.Mesh(g, this.borderMat);
      this.core = new THREE.Mesh(g, this.coreMat);
      for (const [m, o] of [[this.border, 50], [this.core, 51]]) {
        m.renderOrder = o; m.frustumCulled = false; m.matrixAutoUpdate = false;
        this.group.add(m);
      }
    } else {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(lineSegmentsFor(boxes), 3));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0.5, 0.5), 2);
      this.lines = new THREE.LineSegments(g, this.lineMat);
      this.lines.renderOrder = 50; this.lines.frustumCulled = false; this.lines.matrixAutoUpdate = false;
      this.group.add(this.lines);
    }
  }

  clear() {
    if (this.lines) { this.group.remove(this.lines); this.lines.geometry.dispose(); this.lines = null; }
    if (this.border) { this.group.remove(this.border, this.core); this.border.geometry.dispose(); this.border = null; this.core = null; }
  }

  dispose() {
    this.clear();
    this.lineMat.dispose(); this.borderMat.dispose(); this.coreMat.dispose();
  }
}
