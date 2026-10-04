// OWNER LANE: FEATURE-MECH. Grid DDA (Amanatides & Woo) used by the bucket handlers, which need to see fluid
// sources (SPEC §7.4: "Bucket and flint handlers do their own raycast with fluids when needed"). Cell-level
// only (non-cube shapes count as their whole cell) - good enough for picking a fluid or a face to pour on.

/**
 * Walk the cells along a ray until stop(raw, x, y, z) returns true.
 * @returns {{x:number,y:number,z:number,nx:number,ny:number,nz:number,raw:number,dist:number}|null}
 */
export function rayCells(getRaw, ox, oy, oz, dx, dy, dz, maxDist, stop) {
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0, sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
  let ty = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
  let tz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    if (y >= 0 && y < 128) {
      const raw = getRaw(x, y, z);
      if (stop(raw, x, y, z)) return { x, y, z, nx, ny, nz, raw, dist: t };
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}
