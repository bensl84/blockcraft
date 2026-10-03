// OWNER LANE: CORE-B (worldgen). SPEC §5.2.
// Tree shapes shared by worldgen (pull model, column-clipped writes) and placeTree (saplings / bone meal).
// A shape is produced by calling emit(dx, dy, dz, isLog, axis?) for every cell, relative to the trunk base.
// Every random choice comes from the `rand` passed in, in a fixed order, so a given rand stream always
// gives the same tree. Maximum horizontal radius is TREE_MAX_RADIUS (pull-model search distance).

export const TREE_MAX_RADIUS = 3;
export const TREE_MAX_HEIGHT = 11; // highest dy written (spruce 9 + top leaf)

/**
 * @param {'oak'|'birch'|'spruce'|'fancy_oak'} kind  ('fancy_oak' = worldgen-only branching oak)
 * @param {() => number} rand deterministic [0,1)
 * @param {(dx:number, dy:number, dz:number, isLog:boolean, axis?:number) => void} emit  axis: log AXIS (0 Y, 1 X, 2 Z)
 * @returns {number} trunk height
 */
export function buildTree(kind, rand, emit) {
  if (kind === 'spruce') return spruce(rand, emit);
  if (kind === 'fancy_oak') return fancyOak(rand, emit);
  return roundTree(kind === 'birch' ? 5 : 4, rand, emit);
}

/** Oak (trunk 4-6) and birch (5-7): two wide layers (radius 2) under two narrow layers (radius 1). */
function roundTree(minH, rand, emit) {
  const h = minH + Math.floor(rand() * 3);
  for (let dy = h - 3; dy <= h; dy++) {
    const r = dy >= h - 1 ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const corner = (dx === r || dx === -r) && (dz === r || dz === -r);
        if (corner) {
          if (dy === h) continue;                 // top layer is a plus shape
          if (rand() < 0.5) continue;             // ragged corners below
        }
        if (dx === 0 && dz === 0 && dy < h) continue; // trunk goes there
        emit(dx, dy, dz, false);
      }
    }
  }
  for (let dy = 0; dy < h; dy++) emit(0, dy, 0, true);
  return h;
}

/** Spruce (trunk 6-9): a ruffled cone, single leaf on top, 1-2 bare logs at the bottom. */
function spruce(rand, emit) {
  const h = 6 + Math.floor(rand() * 4);
  const bare = 1 + Math.floor(rand() * 2);
  const maxR = h >= 8 ? 3 : 2;
  for (let dy = h; dy >= bare; dy--) {
    const k = h - dy;
    let r;
    if (k === 0) r = 0;
    else {
      const j = k - 1;
      r = Math.min(maxR, 1 + (j >> 1));
      if (j & 1) r = Math.max(1, r - 1);
    }
    const lim = r * r + 0.5;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > lim) continue;
        if (dx === 0 && dz === 0 && dy < h) continue;
        emit(dx, dy, dz, false);
      }
    }
  }
  for (let dy = 0; dy < h; dy++) emit(0, dy, 0, true);
  return h;
}

/**
 * Fancy oak (trunk 6-8): a round crown on top plus one or two side branches, each ending in a smaller
 * leaf blob. Branch logs lie sideways (axis X or Z). Stays within TREE_MAX_RADIUS horizontally.
 */
function fancyOak(rand, emit) {
  const h = 6 + Math.floor(rand() * 3);
  const blobs = [[0, h - 1, 0, 2.6]];
  const nBranch = 1 + Math.floor(rand() * 2);
  const first = Math.floor(rand() * 4);
  const branchLogs = [];
  for (let b = 0; b < nBranch; b++) {
    const dir = (first + b * 2) & 3;          // opposite sides when there are two
    const ux = dir === 1 ? 1 : dir === 3 ? -1 : 0, uz = dir === 2 ? 1 : dir === 0 ? -1 : 0;
    const by = h - 3 - Math.floor(rand() * 2);
    branchLogs.push(ux, by, uz, ux !== 0 ? 1 : 2);
    blobs.push([ux, by + 1, uz, 1.9]);
  }
  const seen = new Set();
  for (const [cx, cy, cz, r] of blobs) {
    const ri = Math.ceil(r);
    for (let dy = -1; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        for (let dz = -ri; dz <= ri; dz++) {
          const x = cx + dx, y = cy + dy, z = cz + dz;
          if (x < -3 || x > 3 || z < -3 || z > 3) continue;
          const d = dx * dx + dz * dz + (dy < 0 ? dy * dy * 2.5 : dy * dy * 1.6);
          if (d > r * r) continue;
          if (d > (r - 1) * (r - 1) && rand() < 0.22) continue; // ragged edge
          if (x === 0 && z === 0 && y < h) continue;
          const k = (x + 8) | ((y + 8) << 5) | ((z + 8) << 10);
          if (seen.has(k)) continue;
          seen.add(k);
          emit(x, y, z, false, 0);
        }
      }
    }
  }
  for (let dy = 0; dy < h; dy++) emit(0, dy, 0, true, 0);
  for (let i = 0; i < branchLogs.length; i += 4) emit(branchLogs[i], branchLogs[i + 1], branchLogs[i + 2], true, branchLogs[i + 3]);
  return h;
}
