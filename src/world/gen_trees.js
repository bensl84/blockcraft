// OWNER LANE: CORE-B (worldgen). SPEC §5.2.
// Tree shapes shared by worldgen (pull model, column-clipped writes) and placeTree (saplings / bone meal).
// A shape is produced by calling emit(dx, dy, dz, isLog) for every cell, relative to the trunk base.
// Every random choice comes from the `rand` passed in, in a fixed order, so a given rand stream always
// gives the same tree. Maximum horizontal radius is TREE_MAX_RADIUS (pull-model search distance).

export const TREE_MAX_RADIUS = 3;
export const TREE_MAX_HEIGHT = 11; // highest dy written (spruce 9 + top leaf)

/**
 * @param {'oak'|'birch'|'spruce'} kind
 * @param {() => number} rand deterministic [0,1)
 * @param {(dx:number, dy:number, dz:number, isLog:boolean) => void} emit
 * @returns {number} trunk height
 */
export function buildTree(kind, rand, emit) {
  if (kind === 'spruce') return spruce(rand, emit);
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
