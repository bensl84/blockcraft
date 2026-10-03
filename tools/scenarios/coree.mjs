// CORE-E smoke scenarios (player / physics / input / raycast / interaction). SPEC §13.2 CORE-E row:
// kid tap/hold/drag with page.mouse, classic pointer-lock path, keys release on blur, notched wheel vs trackpad,
// ladder climb, swim up, step-up 0.5 slab, sneak edge - plus Java numbers (walk, jump), survival break times,
// placement rules, flight, camera FOV / third person. They only require CORE-E stubs to be gone: the LEAD stub
// world streams a working flat world, so these run before CORE-B/C land.
//
// Run: node tools/smoke.mjs --tag coree --scenario coree-move-jump,...   (all: --tag coree)

const FLAT = { preset: 'flat', seed: 5, mode: 'creative', difficulty: 'peaceful' };
const E = ['input', 'player', 'physics', 'raycast', 'interaction'];
const W = 1280, H = 720;

/** Start a flat world, stand still on the ground facing north. */
async function flat(t, opts = {}) {
  await t.call('startWorld', { ...FLAT, ...opts });
  await t.call('setFlying', false);
  await t.call('waitTicks', 8);
  await t.eval(() => { const i = window.__game.game.input; i.aim.x = 0; i.aim.y = 0; i.aimActive = true; });
  const p = await t.call('pos');
  t.assert(p.onGround && Math.abs(p.y - 4) < 1e-6, `standing on the flat ground (${JSON.stringify(p)})`);
  return p;
}
const px = (n) => ({ x: Math.round((n.x + 1) / 2 * W), y: Math.round((1 - n.y) / 2 * H) });
/** Run ticks synchronously in the page until fn(game) is true; returns the number of ticks (or -1). */
async function ticksUntil(t, src, max = 400) {
  return t.eval(({ src, max }) => {
    const g = window.__game.game;
    if (src.hold) g.input.setVirtual(src.hold, true);   // same task as the loop: no real-time tick sneaks in
    for (let n = 1; n <= max; n++) {
      g.stepTicks(1);
      if (src.kind === 'blockIs' && g.world.getBlock(src.x, src.y, src.z) === src.id) return n;
      if (src.kind === 'blockNot' && g.world.getBlock(src.x, src.y, src.z) !== src.id) return n;
    }
    return -1;
  }, { src, max });
}

export default [
  {
    name: 'coree-move-jump', requires: E,
    async run(t) {
      const before = await flat(t);
      await t.call('setLook', 0, 0);
      await t.eval(() => window.__game.game.input.setMoveVector(1, 0));
      const pts = await t.call('recordTicks', 40, { sync: true });
      await t.eval(() => window.__game.game.input.setMoveVector(0, 0));
      const speed = (pts[19].z - pts[39].z); // blocks in the last 20 ticks (1 s)
      t.note('walkMps', speed);
      t.assert(Math.abs(speed - 4.317) < 0.22, `walk 4.317 m/s (got ${speed.toFixed(3)})`);
      t.assert(pts[39].z < before.z, 'forward at yaw 0 goes north (-Z)');
      await t.call('runTicks', 20);
      const y0 = (await t.call('pos')).y;
      // press + record in one page task so no real-time tick lands between them
      const jump = await t.eval(() => {
        const g = window.__game.game, out = [];
        g.input.setVirtual('jump', true);
        for (let i = 0; i < 14; i++) { g.stepTicks(1); out.push({ y: g.player.y, onGround: g.player.onGround }); }
        g.input.setVirtual('jump', false);
        return out;
      });
      const apex = Math.max(...jump.map((s) => s.y)) - y0;
      const landTick = jump.findIndex((s, i) => i > 0 && s.onGround);
      t.note('apex', apex); t.note('jumpTicks', landTick + 1);
      t.assert(Math.abs(apex - 1.2522) < 0.01, `jump apex 1.2522 (got ${apex.toFixed(4)})`);
      t.assert(landTick + 1 === 12, `flat jump lasts 12 ticks (got ${landTick + 1})`);
      t.assert(await t.call('eventCount', 'player:jump') >= 1 && await t.call('eventCount', 'player:land') >= 1, 'jump + land events');
      // the built-in move() helper (real time) agrees (let the re-jump from the held key land first)
      await t.call('runTicks', 30);
      const a = await t.call('pos');
      const b = await t.call('move', 1, 0, 1000);
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      t.note('move1s', d);
      t.assert(d > 3.0 && d < 5.0, `walked ~4.3 blocks in 1 s real time (${d.toFixed(2)})`);
    },
  },
  {
    name: 'coree-break-place', requires: E,
    async run(t) {
      await flat(t);
      await t.call('setLook', 0, -55);
      await t.call('waitFrames', 3);
      const tg = await t.call('target');
      t.assert(tg && tg.name === 'grass_block' && tg.ny === 1, `targets the grass in front (${JSON.stringify(tg)})`);
      const hl = await t.eval(() => window.__game.game.renderer.highlight);
      t.assert(hl && hl.x === tg.x && hl.y === tg.y && hl.z === tg.z && hl.boxes && hl.boxes.length === 1, 'renderer.setHighlight got the target + boxes');
      const br = await t.call('breakTarget');
      t.assert(br.ok && br.after === 'air', `creative break (${JSON.stringify(br)})`);
      await t.call('setLook', 0, -55);
      await t.call('selectSlot', 1);
      const pl = await t.call('placeTarget');
      t.assert(pl.ok && pl.placed === 'oak_planks', `placed planks (${JSON.stringify(pl)})`);
      const ev = await t.call('events', 'block:placed', 1);
      t.assert(ev[0] && ev[0].payload.by === 'player' && ev[0].payload.action > 0 && ev[0].payload.item === 'oak_planks', 'block:placed payload');
      // never place inside the player: look straight down at the block under the feet
      const p = await t.call('pos');
      await t.call('setLook', 0, -89.9);
      await t.call('waitFrames', 2);
      const down = await t.call('target');
      t.assert(down && down.y === 3 && down.ny === 1, `targets the floor under the feet (${JSON.stringify(down)})`);
      const n0 = await t.call('eventCount', 'block:placed');
      await t.call('press', 'use');
      await t.call('waitTicks', 3);
      t.assert(await t.call('eventCount', 'block:placed') === n0, 'refused: the block would be inside the player');
      t.assert(await t.call('getBlock', Math.floor(p.x), 4, Math.floor(p.z)) === 'air', 'feet cell still air');
      await t.shot('break-place');
    },
  },
  {
    name: 'coree-kid-gestures', requires: E,
    async run(t) {
      await flat(t);
      await t.call('setLook', 0, -35);
      await t.call('waitFrames', 3);
      const p = await t.call('pos');
      const bx = Math.floor(p.x) + 1, bz = Math.floor(p.z) - 3;
      // TAP (mouse) on the top of grass block (bx,3,bz): places the held grass block above it
      await t.call('selectSlot', 0);
      const n = px(await t.call('worldToNdc', bx + 0.5, 4, bz + 0.5));
      await t.page.mouse.move(n.x, n.y);
      await t.call('waitFrames', 3);
      const hover = await t.call('target');
      t.assert(hover && hover.x === bx && hover.y === 3 && hover.z === bz, `hover aims the free cursor (${JSON.stringify(hover)})`);
      const g0 = await t.call('eventCount', 'input:gesture');
      await t.page.mouse.down();
      t.assert(await t.call('eventCount', 'input:gesture') > g0, 'pointerdown reacts at once (input:gesture down)');
      await t.call('sleep', 80);
      await t.page.mouse.up();
      await t.call('waitTicks', 3);
      t.assert(await t.call('getBlock', bx, 4, bz) === 'grass_block', 'tap placed a block');
      // HOLD on the placed block: breaks it (creative)
      const m = px(await t.call('worldToNdc', bx + 0.5, 4.6, bz + 0.98));
      await t.page.mouse.move(m.x, m.y);
      await t.call('waitFrames', 2);
      await t.page.mouse.down({ button: 'right' });   // every button means the same thing
      await t.call('sleep', 520);
      await t.page.mouse.up({ button: 'right' });
      await t.call('waitTicks', 2);
      t.assert(await t.call('getBlock', bx, 4, bz) === 'air', 'hold broke the block');
      // DRAG: looks around, places nothing
      const yaw0 = (await t.call('pos')).yaw, placed0 = await t.call('eventCount', 'block:placed');
      await t.page.mouse.move(640, 360);
      await t.page.mouse.down();
      for (let i = 1; i <= 10; i++) await t.page.mouse.move(640 - i * 12, 360);
      await t.page.mouse.up();
      await t.call('waitFrames', 3);
      const yaw1 = (await t.call('pos')).yaw;
      t.note('dragYawDeg', yaw1 - yaw0);
      t.assert(yaw1 - yaw0 > 10, `dragging left turns left (+yaw) (${(yaw1 - yaw0).toFixed(1)} deg)`);
      t.assert(await t.call('eventCount', 'block:placed') === placed0, 'a drag never places');
      // pointer leaves the canvas: no target (kid)
      await t.eval(() => window.__game.game.canvas.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })));
      await t.call('waitFrames', 2);
      t.assert(await t.call('target') === null, 'no target while the cursor is outside the canvas');
      await t.shot('kid-gestures');
    },
  },
  {
    name: 'coree-keys-blur', requires: E,
    async run(t) {
      await flat(t);
      await t.call('setLook', 0, 0);
      await t.page.keyboard.down('KeyW');
      await t.call('waitTicks', 6);
      t.assert(await t.eval(() => window.__game.game.input.move.forward) === 1, 'W walks');
      await t.eval(() => window.dispatchEvent(new Event('blur')));
      await t.call('waitTicks', 2);
      const a = await t.call('pos');
      t.assert(await t.eval(() => window.__game.game.input.move.forward) === 0, 'blur releases W');
      await t.call('waitTicks', 20);
      const b = await t.call('pos');
      t.assert(Math.abs(b.z - a.z) < 0.6, `stopped after blur (${(a.z - b.z).toFixed(2)})`);
      await t.page.keyboard.up('KeyW');
      // arrows turn in the kid scheme: a tap nudges 10-15 deg
      const y0 = (await t.call('pos')).yaw;
      await t.page.keyboard.down('ArrowLeft');
      await t.call('sleep', 60);
      await t.page.keyboard.up('ArrowLeft');
      await t.call('sleep', 250);
      const y1 = (await t.call('pos')).yaw;
      t.note('tapTurnDeg', y1 - y0);
      t.assert(y1 - y0 >= 10 && y1 - y0 <= 16, `ArrowLeft tap nudges left 10-15 deg (${(y1 - y0).toFixed(1)})`);
      // hold: ~100 deg/s after the ramp
      await t.page.keyboard.down('KeyD');
      await t.call('sleep', 1000);
      await t.page.keyboard.up('KeyD');
      await t.call('sleep', 150);
      const y2 = (await t.call('pos')).yaw;
      t.note('holdTurnDeg', y1 - y2);
      t.assert(y1 - y2 > 60 && y1 - y2 < 120, `D held 1 s turns right ~85-100 deg (${(y1 - y2).toFixed(1)})`);
      // Shift is never bound in the kid scheme
      await t.page.keyboard.down('ShiftLeft');
      await t.call('waitTicks', 3);
      t.assert(!(await t.call('pos')).sneaking, 'no sneaking in the kid scheme');
      await t.page.keyboard.up('ShiftLeft');
    },
  },
  {
    name: 'coree-wheel', requires: E,
    async run(t) {
      await flat(t);
      const wheel = (opts) => t.eval((o) => {
        const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...o });
        window.__game.game.canvas.dispatchEvent(ev);
        return ev.defaultPrevented;
      }, opts);
      const n0 = await t.eval(() => window.__game.events('input:action', 400).filter((e) => e.payload.action === 'hotbarNext').length);
      // trackpad: a stream of small pixel deltas never changes the hotbar, but is still prevented (no page zoom/scroll)
      let prevented = true;
      for (let i = 0; i < 30; i++) { prevented = (await wheel({ deltaY: 3.5 + (i % 5), deltaMode: 0 })) && prevented; await t.call('sleep', 8); }
      const n1 = await t.eval(() => window.__game.events('input:action', 400).filter((e) => e.payload.action === 'hotbarNext').length);
      t.assert(n1 === n0, `trackpad swipe ignored (${n1 - n0} hotbar steps)`);
      t.assert(prevented, 'wheel default prevented while playing');
      t.assert(await wheel({ deltaY: 120, ctrlKey: true }), 'pinch zoom prevented');
      // notched wheel: one step per notch, at most one per 150 ms
      await t.call('sleep', 200);
      const tick0 = (await t.call('stats')).ticks;
      await wheel({ deltaY: 120, deltaMode: 0 });
      await wheel({ deltaY: 120, deltaMode: 0 });
      await t.call('sleep', 200);
      await wheel({ deltaY: -100, deltaMode: 0 });
      const ev = (await t.call('events', 'input:action', 400)).filter((e) => e.tick >= tick0 && e.payload.down && /hotbar(Next|Prev)/.test(e.payload.action));
      t.assert(ev.length === 2 && ev[1].payload.action === 'hotbarPrev', `notched wheel steps the hotbar (${JSON.stringify(ev)})`);
      const nexts = ev.filter((e) => e.payload.action === 'hotbarNext').length;
      t.assert(nexts === 1, `rate-limited to one step per 150 ms (${nexts})`);
    },
  },
  {
    name: 'coree-classic-lock', requires: E,
    async run(t) {
      await t.call('setSetting', 'controls', 'classic');
      try {
        await flat(t);
        // pointer lock request from a click: must never throw or log, whatever headless Chrome decides
        await t.page.mouse.click(640, 360);
        await t.call('sleep', 300);
        const r = await t.eval(async () => { const ok = await window.__game.game.input.requestPointerLock(); return { ok, locked: window.__game.game.input.pointerLocked }; });
        t.note('lock', r);
        t.assert(typeof r.ok === 'boolean', 'requestPointerLock resolves to a boolean');
        // classic movement: WASD strafe, Shift sneak, sneak edge on a pillar
        await t.call('setLook', 0, 0);
        const p = await t.call('pos');
        await t.page.keyboard.down('KeyD');
        await t.call('waitTicks', 10);
        await t.page.keyboard.up('KeyD');
        const q = await t.call('pos');
        t.assert(q.x - p.x > 1, `D strafes right (+X at yaw 0) (${(q.x - p.x).toFixed(2)})`);
        // sneak edge: stand on a 1-block pillar at y 10, sneak and walk forward: never falls
        const bx = Math.floor(q.x) + 3, bz = Math.floor(q.z);
        await t.call('setBlock', bx, 9, bz, 'stone');
        await t.call('teleport', bx + 0.5, 10, bz + 0.5);
        await t.call('waitTicks', 4);
        await t.page.keyboard.down('ShiftLeft');
        await t.page.keyboard.down('KeyW');
        await t.call('waitTicks', 40);
        await t.page.keyboard.up('KeyW');
        const s = await t.call('pos');
        await t.page.keyboard.up('ShiftLeft');
        t.assert(s.sneaking && s.onGround && Math.abs(s.y - 10) < 1e-6, `sneak edge keeps the player on the pillar (${JSON.stringify(s)})`);
        t.assert(s.z < bz + 0.5 && s.z > bz - 0.36, `walked to the edge (${s.z})`);
        await t.call('waitTicks', 2);
        t.assert(!(await t.call('pos')).sneaking, 'releasing Shift stands up');
        // locked: mouse look, left = attack (break), right = use (place), middle = pick
        if (r.locked) {
          await t.call('teleport', q.x, 4, q.z);
          await t.call('setLook', 0, -55);
          await t.call('runTicks', 3);
          const yawA = (await t.call('pos')).yaw;
          await t.call('sleep', 200);                                   // past the 150 ms settle window
          await t.page.mouse.move(600, 360);
          await t.page.mouse.move(560, 360);
          await t.call('waitFrames', 3);
          const yawB = (await t.call('pos')).yaw;
          t.note('mouseLookDeg', yawB - yawA);
          t.assert(yawB !== yawA, 'locked mouse movement turns the view');
          await t.call('setLook', 0, -55);
          await t.call('waitFrames', 3);
          const tg = await t.call('target');
          t.assert(tg && tg.name === 'grass_block', `crosshair target (${JSON.stringify(tg)})`);
          await t.page.mouse.down({ button: 'left' });
          await t.call('waitTicks', 2);
          await t.page.mouse.up({ button: 'left' });
          t.assert(await t.call('getBlock', tg.x, tg.y, tg.z) === 'air', 'left click breaks (creative)');
          await t.call('selectSlot', 2);
          await t.call('waitFrames', 2);
          const tg2 = await t.call('target');
          await t.page.mouse.down({ button: 'right' });
          await t.call('waitTicks', 2);
          await t.page.mouse.up({ button: 'right' });
          t.assert(await t.call('getBlock', tg2.x + tg2.nx, tg2.y + tg2.ny, tg2.z + tg2.nz) === 'cobblestone', 'right click places the held block');
          await t.call('selectSlot', 4);
          await t.call('waitFrames', 2);
          await t.page.mouse.down({ button: 'middle' });
          await t.call('waitTicks', 2);
          await t.page.mouse.up({ button: 'middle' });
          const sel = await t.call('selected');
          t.assert(sel.slot === 2 && sel.item === 'cobblestone', `middle click picks the block into the hotbar (${JSON.stringify(sel)})`);
          // losing the lock releases everything and is announced (menus show the pause screen from it)
          const n = await t.call('eventCount', 'input:pointerLock');
          await t.page.mouse.down({ button: 'left' });
          await t.eval(() => document.exitPointerLock());
          await t.call('sleep', 100);
          t.assert(await t.call('eventCount', 'input:pointerLock') > n, 'input:pointerLock emitted on unlock');
          t.assert(!(await t.eval(() => window.__game.game.input.isDown('attack'))), 'attack released with the lock');
          await t.page.mouse.up({ button: 'left' });
          // an immediate relock lands in the cooldown: resolves quietly (true or false), never throws
          const re = await t.eval(async () => window.__game.game.input.requestPointerLock());
          t.note('relock', re);
        }
        t.assert(await t.call('state') === 'playing', 'still playing');
      } finally {
        await t.eval(() => { if (document.pointerLockElement) document.exitPointerLock(); });
        await t.call('setSetting', 'controls', 'kid');
      }
    },
  },
  {
    name: 'coree-ladder-swim-step', requires: E,
    async run(t) {
      const p = await flat(t);
      const x = Math.floor(p.x), z = Math.floor(p.z);
      // ladder: wall at z-3, ladder in z-2 facing south (state 2)
      for (let y = 4; y <= 12; y++) { await t.call('setBlock', x, y, z - 3, 'stone'); await t.call('setBlock', x, y, z - 2, 'ladder', 2); }
      await t.call('setLook', 0, 0);
      await t.eval(() => window.__game.game.input.setMoveVector(1, 0));
      const climb = await t.call('recordTicks', 60, { sync: true });
      await t.eval(() => window.__game.game.input.setMoveVector(0, 0));
      const onL = climb.filter((s) => s.onLadder);
      t.assert(onL.length > 20, 'on the ladder');
      const rate = (climb[59].y - climb[39].y);
      t.note('ladderMps', rate);
      t.assert(Math.abs(rate - 2.35) < 0.15, `ladder climbs 2.35 m/s (got ${rate.toFixed(3)})`);
      // swimming: a 3-deep pool next to spawn
      await t.call('teleport', p.x, 4, p.z);
      const px0 = x + 6, pz0 = z;
      await t.eval(({ x, z }) => {
        const g = window.__game.game, w = g.world, ID = window.__game.blockId;
        const list = [];
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { for (let y = 1; y <= 3; y++) list.push([x + dx, y, z + dz, ID('water'), 0]); }
        w.setBlocks(list, { cause: 'test' });
      }, { x: px0, z: pz0 });
      await t.call('teleport', px0 + 0.5, 1, pz0 + 0.5);
      await t.call('runTicks', 10);
      let s = await t.call('pos');
      t.assert(s.inWater && s.eyeInWater, `underwater (${JSON.stringify(s)})`);
      t.assert(await t.call('eventCount', 'player:water') >= 1, 'player:water emitted');
      await t.eval(() => window.__game.game.input.setVirtual('jump', true));
      await t.call('runTicks', 40);
      await t.eval(() => window.__game.game.input.setVirtual('jump', false));
      s = await t.call('pos');
      t.assert(s.y > 2.6, `swims up to the surface (${s.y.toFixed(2)})`);
      // swim to the edge and climb out (horizontal collision + jump = 0.3 boost)
      await t.call('setLook', 90, 0); // west
      await t.eval(() => { const i = window.__game.game.input; i.setVirtual('jump', true); i.setMoveVector(1, 0); });
      await t.call('runTicks', 60);
      await t.eval(() => { const i = window.__game.game.input; i.setVirtual('jump', false); i.setMoveVector(0, 0); });
      s = await t.call('pos');
      t.assert(!s.inWater && s.y >= 4 - 1e-6 && s.x < px0 - 2, `climbed out of the pool (${JSON.stringify(s)})`);
      // step-up a 0.5 slab while walking (auto-jump off so this is the 0.6 step, not a jump)
      await t.call('setSetting', 'autoJump', false);
      try {
        await t.call('teleport', p.x, 4, p.z + 6);
        await t.call('setLook', 0, 0);
        await t.call('runTicks', 3);
        const sp = await t.call('pos');
        await t.call('setBlock', Math.floor(sp.x), 4, Math.floor(sp.z) - 2, 'oak_slab', 0);
        await t.eval(() => window.__game.game.input.setMoveVector(1, 0));
        const walk = await t.call('recordTicks', 14, { sync: true });
        await t.eval(() => window.__game.game.input.setMoveVector(0, 0));
        t.assert(walk.some((w) => Math.abs(w.y - 4.5) < 1e-6 && w.onGround), `stepped up onto the slab (${walk.map((w) => w.y.toFixed(2)).join(' ')})`);
        t.assert(!walk.some((w) => w.y > 4.51), 'no jump needed');
      } finally {
        await t.call('setSetting', 'autoJump', true);
      }
    },
  },
  {
    name: 'coree-fly-camera', requires: E,
    async run(t) {
      await flat(t);
      const fov0 = await t.eval(() => window.__game.game.renderer.camera.fov);
      t.assert(Math.abs(fov0 - 70) < 0.5, `default FOV 70 (${fov0})`);
      await t.page.keyboard.press('KeyF');
      await t.call('waitTicks', 4);
      let p = await t.call('pos');
      t.assert(p.flying, 'F toggles flight (kid)');
      await t.call('sleep', 400);
      const fovFly = await t.eval(() => window.__game.game.renderer.camera.fov);
      t.assert(Math.abs(fovFly - 77) < 0.5, `fly FOV eases to 70 x 1.1 (${fovFly.toFixed(2)})`);
      await t.eval(() => window.__game.game.input.setVirtual('jump', true));
      await t.call('runTicks', 10);
      const up = await t.call('recordTicks', 20, { sync: true });
      await t.eval(() => window.__game.game.input.setVirtual('jump', false));
      const vUp = up[19].y - up[0].y;
      t.assert(Math.abs(vUp / 19 * 20 - 7.5) < 0.4, `fly up 7.5 m/s (${(vUp / 19 * 20).toFixed(2)})`);
      // horizontal flight in real time (streaming runs between ticks); the kid streaming guard caps it at 7 m/s
      // while more than 2 columns within R-1 are unmeshed
      await t.eval(() => window.__game.game.input.setMoveVector(1, 0));
      await t.call('sleep', 1500);
      const fl = await t.call('recordTicks', 21);
      const backlog = await t.eval(() => window.__game.game.world.unmeshedWithin(window.__game.game.world.renderDistance - 1));
      await t.eval(() => window.__game.game.input.setMoveVector(0, 0));
      const v = (fl[0].z - fl[20].z);
      t.note('flyMps', v); t.note('backlog', backlog);
      t.assert((Math.abs(v - 10.92) < 0.6) || (Math.abs(v - 7) < 0.4), `creative fly 10.92 m/s, or 7 m/s under the streaming cap (${v.toFixed(2)})`);
      await t.call('runTicks', 30);
      // C descends; touching the ground ends flight
      await t.eval(() => window.__game.game.input.setVirtual('descend', true));
      await t.call('runTicks', 120);
      await t.eval(() => window.__game.game.input.setVirtual('descend', false));
      p = await t.call('pos');
      t.assert(!p.flying && p.onGround, `descend lands and ends flight (${JSON.stringify(p)})`);
      // third person: V cycles the view; the camera sits behind the eye
      await t.page.keyboard.press('KeyV');
      await t.call('waitTicks', 2);
      await t.call('waitFrames', 2);
      const cam = await t.eval(() => { const g = window.__game.game, c = g.renderer.camera, pl = g.player; return { v: pl.view, dz: c.position.z - pl.renderZ, dy: c.position.y - (pl.renderY + pl.eyeHeight) }; });
      t.assert(cam.v === 1 && cam.dz > 3.5, `third person behind (${JSON.stringify(cam)})`);
      await t.page.keyboard.press('KeyV');
      await t.page.keyboard.press('KeyV');
      await t.call('waitTicks', 2);
      t.assert((await t.call('pos')).view === 0, 'back to first person');
      t.assert(await t.call('eventCount', 'player:view') >= 3, 'player:view emitted');
    },
  },
  {
    name: 'coree-survival-mining', requires: E,
    async run(t) {
      await flat(t, { mode: 'survival', difficulty: 'easy' });
      await t.call('setLook', 0, -55);
      await t.call('runTicks', 2);
      const tg = await t.call('target');
      t.assert(tg && tg.name === 'grass_block', `targets grass (${JSON.stringify(tg)})`);
      const ID = (n) => t.call('blockId', n);
      const mine = async (name, item) => {
        await t.call('setBlock', tg.x, tg.y, tg.z, name);
        await t.call('setSlot', 0, item, 1);
        await t.call('selectSlot', 0);
        await t.call('runTicks', 8);
        const n = await ticksUntil(t, { kind: 'blockNot', x: tg.x, y: tg.y, z: tg.z, id: await ID(name), hold: 'attack' }, 400);
        await t.eval(() => window.__game.game.input.setVirtual('attack', false));
        await t.call('runTicks', 8);
        return n;
      };
      const dirt = await mine('dirt', null);
      const stoneWood = await mine('stone', 'wooden_pickaxe');
      const logHand = await mine('oak_log', null);
      const logAxe = await mine('oak_log', 'wooden_axe');
      t.note('ticks', { dirt, stoneWood, logHand, logAxe });
      t.assert(dirt === 15, `dirt by hand 0.75 s = 15 ticks (${dirt})`);
      t.assert(stoneWood === 23, `stone with a wooden pickaxe 1.15 s = 23 ticks (${stoneWood})`);
      t.assert(logHand === 60, `log by hand 3 s = 60 ticks (${logHand})`);
      t.assert(logAxe === 30, `log with a wooden axe 1.5 s = 30 ticks (${logAxe})`);
      const stages = (await t.call('events', 'block:mining', 40)).map((e) => e.payload.stage);
      t.assert(stages.includes(0) && stages.includes(9), `crack stages 0..9 emitted (${stages.join(',')})`);
      t.assert(await t.call('eventCount', 'block:miningStop') >= 1, 'block:miningStop emitted');
      const inv = await t.call('inventory');
      t.assert(inv[0] && inv[0].item === 'wooden_axe', 'axe still in hand');
      const dmg = await t.eval(() => window.__game.game.inventory.get(0).damage || 0);
      t.assert(dmg === 1, `tool wear: 1 per block mined (${dmg})`);
      // bedrock: unbreakable in survival
      await t.call('setBlock', tg.x, tg.y, tg.z, 'bedrock');
      await t.eval(() => window.__game.game.input.setVirtual('attack', true));
      await t.call('runTicks', 100);
      await t.eval(() => window.__game.game.input.setVirtual('attack', false));
      t.assert(await t.call('getBlock', tg.x, tg.y, tg.z) === 'bedrock', 'bedrock stays in survival');
      // survival placement consumes the item
      await t.call('setBlock', tg.x, tg.y, tg.z, 'grass_block');
      await t.call('setSlot', 0, 'cobblestone', 3);
      await t.call('runTicks', 2);
      await t.call('press', 'use');
      await t.call('waitTicks', 3);
      t.assert(await t.call('getBlock', tg.x, tg.y + 1, tg.z) === 'cobblestone', 'placed cobblestone');
      t.assert((await t.call('selected')).count === 2, 'survival consumes one item');
    },
  },
  {
    name: 'coree-place-rules', requires: E,
    async run(t) {
      const p = await flat(t);
      const x = Math.floor(p.x), z = Math.floor(p.z) - 3;
      // a 2-high stone wall at (x, 4..5, z)
      await t.call('setBlock', x, 4, z, 'stone');
      await t.call('setBlock', x, 5, z, 'stone');
      const stand = async (sx, sz) => { await t.call('teleport', sx, 4, sz); await t.call('runTicks', 3); };
      const placeOn = async (item, ax, ay, az, slot = 8) => {
        await t.call('setSlot', slot, item, 64);
        await t.call('selectSlot', slot);
        await t.eval(() => { const i = window.__game.game.input; i.aim.x = 0; i.aim.y = 0; i.aimActive = true; });
        await t.call('lookAt', ax, ay, az);
        await t.call('press', 'use');
        await t.call('waitTicks', 3);
      };
      const block = (bx, by, bz) => t.call('getBlock', bx, by, bz);
      const state = (bx, by, bz) => t.call('getState', bx, by, bz);
      // from the south: wall torch on the south face (attached to the wall to its north: state 1 + 0)
      await stand(x + 0.5, z + 3.5);
      await placeOn('torch', x + 0.5, 4.5, z + 1.0);
      t.assert(await block(x, 4, z + 1) === 'torch' && await state(x, 4, z + 1) === 1, `wall torch state 1 (${await state(x, 4, z + 1)})`);
      // ladder on the south face of the upper stone: faces south (2), away from the wall
      await placeOn('ladder', x + 0.5, 5.5, z + 1.0);
      t.assert(await block(x, 5, z + 1) === 'ladder' && await state(x, 5, z + 1) === 2, 'ladder facing away from the wall');
      // a torch is never placed on a ceiling (down face)
      await t.call('setBlock', x + 2, 6, z + 2, 'stone');
      const n0 = await t.call('eventCount', 'block:placed');
      await placeOn('torch', x + 2.5, 6.0, z + 2.5);
      t.assert(await t.call('eventCount', 'block:placed') === n0, 'no torch under a ceiling');
      await t.call('setBlock', x + 2, 6, z + 2, 'air');
      // from the east: a log on the east face lies along X (axis 1); a furnace on the ground faces the player (east = 1)
      await stand(x + 3.5, z + 0.5);
      await placeOn('oak_log', x + 1.0, 4.5, z + 0.5);
      t.assert(await block(x + 1, 4, z) === 'oak_log' && await state(x + 1, 4, z) === 1, `log on the east face lies along X (${await state(x + 1, 4, z)})`);
      await placeOn('furnace', x + 2.5, 4.0, z + 0.5);
      const fs = await state(x + 2, 4, z);
      t.assert(await block(x + 2, 4, z) === 'furnace' && (fs & 3) === 1, `furnace front faces the player in the east (${fs})`);
      // a flower needs grass or dirt: refused on the log, accepted on grass
      const n1 = await t.call('eventCount', 'block:placed');
      await placeOn('poppy', x + 1.5, 5.0, z + 0.5);
      t.assert(await t.call('eventCount', 'block:placed') === n1, 'flower refused on a log');
      await placeOn('poppy', x + 2.5, 4.0, z + 1.5);
      t.assert(await block(x + 2, 4, z + 1) === 'poppy', 'flower placed on grass');
      // fence on top of the log joins the stone wall to its west (bit 3 = W)
      await placeOn('oak_fence', x + 1.5, 5.0, z + 0.5);
      const fence = await state(x + 1, 5, z);
      t.assert(await block(x + 1, 5, z) === 'oak_fence' && (fence & 8) === 8, `fence connects west to the wall (${fence})`);
      // slab merging: a bottom slab, then its top face -> double slab
      await placeOn('oak_slab', x + 2.5, 4.0, z + 2.5);
      t.assert(await block(x + 2, 4, z + 2) === 'oak_slab' && await state(x + 2, 4, z + 2) === 0, 'bottom slab');
      await placeOn('oak_slab', x + 2.5, 4.5, z + 2.5);
      t.assert(await state(x + 2, 4, z + 2) === 2, `slab merged into a double slab (${await state(x + 2, 4, z + 2)})`);
      // short grass is replaced in place
      await t.call('setBlock', x + 3, 4, z + 3, 'short_grass');
      await placeOn('cobblestone', x + 3.5, 4.3, z + 3.5);
      t.assert(await block(x + 3, 4, z + 3) === 'cobblestone', 'short grass replaced in place');
      const ev = await t.call('events', 'block:placed', 1);
      t.assert(ev[0].payload.oldId === await t.call('blockId', 'short_grass'), 'block:placed reports the replaced block');
      await t.shot('place-rules');
    },
  },
  {
    name: 'coree-auto-pitch', requires: E,
    async run(t) {
      await flat(t);
      await t.call('setLook', 0, 30);
      await t.eval(() => window.__game.game.input.setMoveVector(1, 0));
      await t.call('sleep', 1000);
      const early = (await t.call('pos')).pitch;
      await t.call('sleep', 1500);
      await t.eval(() => window.__game.game.input.setMoveVector(0, 0));
      await t.call('runTicks', 1);
      const late = (await t.call('pos')).pitch;
      t.note('pitch', { early, late });
      t.assert(Math.abs(early - 30) < 0.5, `no auto-pitch during the first 1.5 s (${early})`);
      t.assert(late < 10 && late > -12.5, `auto-pitch eases toward -12 deg while walking (${late.toFixed(1)})`);
      // a manual look (test setLook) restarts the timer
      await t.call('setLook', 0, 20);
      await t.eval(() => window.__game.game.input.setMoveVector(1, 0));
      await t.call('sleep', 600);
      await t.eval(() => window.__game.game.input.setMoveVector(0, 0));
      t.assert(Math.abs((await t.call('pos')).pitch - 20) < 0.5, 'manual look is not overridden');
    },
  },
  {
    name: 'coree-entities', requires: E,
    async run(t) {
      const p = await flat(t);
      const id = await t.eval(({ x, y, z }) => {
        const g = window.__game.game;
        if (!g.entities.types.has('coree_dummy')) {
          g.entities.types.set('coree_dummy', {
            persistent: false, category: 'creature', create: (game, x, y, z) => {
              const e = new g.entities.EntityClass('coree_dummy', x, y, z);
              e.category = 'creature'; e.width = 0.9; e.height = 0.9; e.health = e.maxHealth = 10;
              return e;
            },
          });
        }
        const e = g.entities.spawn('coree_dummy', x, y, z);
        return e ? e.id : null;
      }, { x: p.x, y: 4, z: p.z - 3 });
      t.assert(id !== null, 'dummy creature spawned');
      const r = await t.call('interactEntity', id, 'attack');
      t.note('attack', r);
      t.assert(r.targeted, 'the creature is targeted (nearer than the ground)');
      t.assert(r.health === 9, `a fist hit does 1 damage (${r.health})`);
      // cannot place a block into a living entity
      const n0 = await t.call('eventCount', 'block:placed');
      const placed = await t.eval(({ x, z }) => window.__game.game.interaction.placeBlock(Math.floor(x), 4, Math.floor(z), window.__game.blockId('stone'), 0, { by: 'test' }), { x: p.x, z: p.z - 3 });
      t.assert(placed === false && await t.call('eventCount', 'block:placed') === n0, 'placement refused inside a creature');
      const next = await t.eval(({ x, z }) => window.__game.game.interaction.placeBlock(Math.floor(x) + 2, 4, Math.floor(z), window.__game.blockId('stone'), 0, { by: 'test' }), { x: p.x, z: p.z - 3 });
      t.assert(next === true, 'placement beside it works');
      await t.eval((id) => { const g = window.__game.game; g.entities.remove(g.entities.get(id), 'test'); }, id);
    },
  },
  {
    name: 'coree-touch', requires: E, touchOnly: true,
    async run(t) {
      await flat(t);
      await t.call('setLook', 0, -35);
      await t.call('waitFrames', 3);
      const p = await t.call('pos');
      const bx = Math.floor(p.x), bz = Math.floor(p.z) - 3;
      const n = px(await t.call('worldToNdc', bx + 0.5, 4, bz + 0.5));
      const types = await t.call('eventCount', 'input:pointerType');
      await t.page.touchscreen.tap(n.x, n.y);
      await t.call('waitTicks', 3);
      t.assert(await t.eval(() => window.__game.game.input.lastPointerType) === 'touch', 'lastPointerType is touch');
      t.assert(await t.call('eventCount', 'input:pointerType') > types, 'input:pointerType emitted');
      t.assert(await t.call('getBlock', bx, 4, bz) === 'grass_block', 'touch tap places');
      await t.shot('touch-tap');
    },
  },
];
