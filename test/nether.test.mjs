// OWNER: LEAD (v1.7, judge FID-8). The Nether: portal frames, the link between the two places, the Nether's
// worldgen and the portal's support rule. Pure (no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';

import { ID } from '../src/core/registry.js';
import { COLUMN_VOLUME, colIndex } from '../src/core/constants.js';
import { NETHER_EDGE, NETHER_LAVA_Y, NETHER_X0, isNetherColumn, isNetherX, toNether, toOverworld } from '../src/core/nether.js';
import { findPortalFrame } from '../src/mechanics/nether.js';
import { supportStatus } from '../src/mechanics/rules.js';
import { generateColumn } from '../src/world/worldgen.js';
import { STATE } from '../src/data/blocks.js';

/** A tiny sparse world: Map 'x,y,z' -> raw. */
function fakeWorld() {
  const m = new Map();
  return {
    set: (x, y, z, id, st = 0) => m.set(`${x},${y},${z}`, id | (st << 8)),
    getRaw: (x, y, z) => m.get(`${x},${y},${z}`) || 0,
  };
}
/** An obsidian frame with an interior w x h, lowest interior cell at (x, y, z), along X (or Z). */
function frame(wd, x, y, z, w, h, axisZ = false) {
  const dx = axisZ ? 0 : 1, dz = axisZ ? 1 : 0;
  for (let i = -1; i <= w; i++) for (let j = -1; j <= h; j++) {
    const edge = i === -1 || i === w || j === -1 || j === h;
    const corner = (i === -1 || i === w) && (j === -1 || j === h);
    if (edge && !corner) wd.set(x + dx * i, y + j, z + dz * i, ID.obsidian);
  }
}

test('portal frames: 2x3 to 21x21 interiors along X or Z, corners optional, every side obsidian', () => {
  const wd = fakeWorld();
  frame(wd, 10, 5, 0, 2, 3);
  const f = findPortalFrame(wd.getRaw, 11, 6, 0);
  assert.deepEqual(f, { axisZ: false, x0: 10, y0: 5, z0: 0, w: 2, h: 3 });
  assert.deepEqual(findPortalFrame(wd.getRaw, 10, 5, 0), f, 'any interior cell finds the same frame');
  const z = fakeWorld();
  frame(z, 0, 5, 20, 3, 4, true);
  assert.deepEqual(findPortalFrame(z.getRaw, 0, 7, 22), { axisZ: true, x0: 0, y0: 5, z0: 20, w: 3, h: 4 });
  // a missing side block, a too-small or a blocked interior is not a portal
  const gap = fakeWorld(); frame(gap, 0, 5, 0, 2, 3); gap.set(-1, 6, 0, 0);
  assert.equal(findPortalFrame(gap.getRaw, 0, 5, 0), null, 'gap in the frame');
  const thin = fakeWorld(); frame(thin, 0, 5, 0, 1, 3);
  assert.equal(findPortalFrame(thin.getRaw, 0, 5, 0), null, 'one wide');
  const low = fakeWorld(); frame(low, 0, 5, 0, 2, 2);
  assert.equal(findPortalFrame(low.getRaw, 0, 5, 0), null, 'two high');
  const busy = fakeWorld(); frame(busy, 0, 5, 0, 2, 3); busy.set(1, 7, 0, ID.stone);
  assert.equal(findPortalFrame(busy.getRaw, 0, 5, 0), null, 'something inside');
  const fire = fakeWorld(); frame(fire, 0, 5, 0, 2, 3); fire.set(0, 5, 0, ID.fire);
  assert.ok(findPortalFrame(fire.getRaw, 0, 5, 0), 'fire inside is fine (it is what lights it)');
  const big = fakeWorld(); frame(big, 0, 1, 0, 21, 21);
  assert.equal(findPortalFrame(big.getRaw, 5, 5, 0).w, 21);
});

test('the Nether strip and the 1:8 link', () => {
  assert.ok(!isNetherX(2048) && !isNetherX(-30000) && isNetherX(NETHER_X0) && isNetherX(NETHER_EDGE));
  assert.ok(isNetherColumn(NETHER_X0 >> 4) && !isNetherColumn(127));
  assert.deepEqual(toNether(80, -64), { x: NETHER_X0 + 10, z: -8 });
  assert.deepEqual(toOverworld(NETHER_X0 + 10, -8), { x: 80, z: -64 });
  // the whole reachable overworld (border at most 2048 from a spawn near the origin) maps inside the strip
  assert.ok(isNetherX(toNether(-2600, 0).x) && !isNetherX(2600));
});

test('Nether worldgen: deterministic caverns, bedrock floor and roof, a lava sea, glowstone, no sky', () => {
  const gen = (seed, cx, cz) => generateColumn(seed, cx, cz, 'default', { blocks: new Uint16Array(COLUMN_VOLUME), biomes: new Uint8Array(256) });
  const cx = NETHER_X0 >> 4;
  const a = gen(12345, cx, 3), b = gen(12345, cx, 3);
  assert.deepEqual(a.blocks, b.blocks, 'same seed, same column');
  assert.notDeepEqual(gen(999, cx, 3).blocks, a.blocks, 'another seed, another Nether');
  const count = new Map();
  let lavaHigh = 0;
  for (let i = 0; i < 6; i++) {
    const c = gen(12345, cx + i, i - 3);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      assert.equal(c.blocks[colIndex(lx, 0, lz)] & 0xff, ID.bedrock, 'bedrock floor');
      assert.equal(c.blocks[colIndex(lx, 127, lz)] & 0xff, ID.bedrock, 'bedrock roof (no sky light)');
      for (let y = 0; y < 128; y++) {
        const id = c.blocks[colIndex(lx, y, lz)] & 0xff;
        count.set(id, (count.get(id) || 0) + 1);
        if (id === ID.lava && y > NETHER_LAVA_Y) lavaHigh++;
      }
    }
  }
  const total = 6 * COLUMN_VOLUME, share = (id) => (count.get(id) || 0) / total;
  assert.ok(share(0) > 0.2 && share(0) < 0.6, `open caverns (${(share(0) * 100).toFixed(1)}% air)`);
  assert.ok(share(ID.netherrack) > 0.3, 'mostly netherrack');
  assert.ok(share(ID.lava) > 0.02, 'a lava sea');
  assert.equal(lavaHigh, 0, 'lava only in the sea');
  assert.ok((count.get(ID.glowstone) || 0) > 0 && (count.get(ID.nether_quartz_ore) || 0) > 0, 'glowstone and quartz');
  assert.equal(count.get(ID.grass_block) || 0, 0, 'no overworld blocks');
  // an overworld column right next to the edge is still overworld
  const ow = gen(12345, (NETHER_EDGE >> 4) - 1, 0);
  assert.equal(ow.blocks[colIndex(0, 127, 0)] & 0xff, 0, 'overworld sky above');
});

test('a portal sheet holds only inside its frame (MECH support rule, cascade = no drops)', () => {
  const wd = fakeWorld();
  frame(wd, 0, 5, 0, 2, 3);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) wd.set(i, 5 + j, 0, ID.nether_portal, 0);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) assert.equal(supportStatus(wd.getRaw, i, 5 + j, 0), 'ok');
  wd.set(-1, 6, 0, 0);                                         // break one side block
  assert.equal(supportStatus(wd.getRaw, 0, 6, 0), 'cascade');
  assert.equal(supportStatus(wd.getRaw, 1, 6, 0), 'ok', 'the rest goes cell by cell as neighbours change');
  // a Z-axis sheet reads its Z neighbours
  const z = fakeWorld();
  frame(z, 0, 5, 0, 2, 3, true);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) z.set(0, 5 + j, i, ID.nether_portal, STATE.PORTAL_AXIS_Z);
  assert.equal(supportStatus(z.getRaw, 0, 6, 0), 'ok');
});
