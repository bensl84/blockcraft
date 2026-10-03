// OWNER LANE: FEATURE-FX. Smoke scenarios for the FX lane (SPEC §8.7 acceptance + visual review shots).
// Scenarios that only make sense with the real core (terrain drawn by CORE-D, real targeting/mining by CORE-E)
// list those lanes in `requires`, so they report PENDING until the core lands. While the renderer is a stub the
// visual scenarios build a small "scenery" platform out of FX block meshes so screenshots show something.

const FLAT = { preset: 'flat', seed: 1, mode: 'creative', difficulty: 'peaceful' };

/** Stub renderer only: a 9x9 grass platform (plus a few blocks) drawn with FX block meshes at full light. */
async function scenery(t) {
  if (!t.stubs.includes('renderer')) return false;
  await t.eval(() => {
    const g = window.__game.game, fx = g.fx, p = g.player;
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    const add = (item, x, y, z) => {
      const o = fx.makeItemMesh(item);
      o.userData.fxMesh.scale.setScalar(o.userData.fxKind === 'block' ? 1 : 1);
      o.userData.fxMesh.userData.fxLight = { sky: 15, block: 0 };
      o.position.set(x + 0.5, y, z + 0.5);
      o.userData.scenery = true;
      g.renderer.addObject(o);
    };
    for (let dz = -8; dz <= 2; dz++) for (let dx = -5; dx <= 5; dx++) add('grass_block', bx + dx, 3, bz + dz);
    add('oak_planks', bx - 1, 4, bz - 4);
    add('stone', bx + 1, 4, bz - 4);
    add('cobblestone', bx + 1, 5, bz - 4);
    window.__fxScenery = true;
  });
  return true;
}

async function clearScenery(t) {
  await t.eval(() => {
    const g = window.__game.game;
    const list = [];
    g.renderer.dynamicGroup.traverse((o) => { if (o.userData && o.userData.scenery) list.push(o); });
    for (const o of list) g.fx.disposeItemMesh(o);
  });
}

const fxStats = (t) => t.eval(() => window.__game.game.fx.stats());

export default [
  {
    name: 'fx-break-particles',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const p = await t.call('pos');
      const x = Math.floor(p.x), z = Math.floor(p.z) - 3;
      t.assert(await t.call('setBlock', x, 4, z, 'stone'), 'stone placed');
      const before = (await fxStats(t)).particles;
      const ok = await t.eval(([x, z]) => window.__game.game.interaction.breakBlock(x, 4, z, { by: 'test' }), [x, z]);
      t.assert(ok, 'breakBlock succeeded');
      const s1 = await fxStats(t);
      t.note('afterBreak', s1.particles - before);
      t.assert(s1.particles - before > 10, `a break creates > 10 particles (got ${s1.particles - before})`);
      t.assert(s1.particles - before <= 32, `at most 32 particles per break (got ${s1.particles - before})`);
      await t.call('runTicks', 60);
      const s2 = await fxStats(t);
      t.assert(s2.particles === 0, `all particles gone within 60 ticks (left ${s2.particles})`);
      // cap: 2000
      await t.eval(() => { const fx = window.__game.game.fx; const p = window.__game.game.player; for (let i = 0; i < 200; i++) fx.spawnParticles('smoke', p.x, p.y + 2, p.z - 3, { count: 20 }); });
      const s3 = await fxStats(t);
      t.assert(s3.particles <= 2000, `particle cap (got ${s3.particles})`);
      t.note('capped', s3.particles);
      await t.call('runTicks', 60);
    },
  },
  {
    name: 'fx-itemmesh',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const res = await t.eval(async () => {
        const g = window.__game.game, fx = g.fx;
        const wait = () => new Promise((r) => requestAnimationFrame(() => r()));
        const keys = ['diamond', 'grass_block', 'stone_pickaxe', 'poppy', 'torch'];
        const cycle = async () => {
          const objs = keys.map((k, i) => { const o = fx.makeItemMesh(k); o.position.set(g.player.x + i * 0.4 - 0.8, g.player.y + 1.4, g.player.z - 2); g.renderer.addObject(o); return o; });
          await wait();
          for (const o of objs) fx.disposeItemMesh(o);
        };
        await cycle(); await wait();
        const g0 = g.renderer.getStats().geometries;
        for (let i = 0; i < 100; i++) await cycle();
        await wait();
        const g1 = g.renderer.getStats().geometries;
        const a = fx.makeItemMesh('diamond'), b = fx.makeItemMesh('diamond');
        const shared = a.userData.fxMesh.geometry === b.userData.fxMesh.geometry;
        fx.disposeItemMesh(a); fx.disposeItemMesh(b);
        return { g0, g1, shared, live: fx.stats().itemMeshesLive };
      });
      t.note('geometries', res);
      t.assert(res.shared, 'geometry is shared per item key');
      t.assert(res.g1 <= res.g0, `100 make/dispose cycles keep the geometry count flat (${res.g0} -> ${res.g1})`);
    },
  },
  {
    name: 'fx-sky',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await scenery(t);
      await t.call('setLook', 90, 25);
      await t.call('setTime', 1000);
      await t.call('waitFrames', 4);
      let s = await fxStats(t);
      t.assert(s.sky.sunVisible, 'sun is up in the morning');
      t.assert(s.clouds, 'clouds shown (settings.clouds default on)');
      await t.shot('fx-sky-morning');
      await t.call('setLook', 0, 70);
      await t.call('setTime', 6000);
      await t.call('waitFrames', 4);
      await t.shot('fx-sky-noon');
      await t.call('setLook', 270, 20);
      await t.call('setTime', 12300);
      await t.call('waitFrames', 4);
      await t.shot('fx-sky-sunset');
      await t.call('setLook', 270, 45);
      await t.call('setTime', 18000);
      await t.call('waitFrames', 4);
      s = await fxStats(t);
      t.assert(s.sky.stars > 0.3, `stars at midnight (${s.sky.stars})`);
      await t.shot('fx-sky-night');
      // moon phases: day 0..7 -> phase 0..7
      const phases = await t.eval(async () => {
        const g = window.__game.game; const out = [];
        for (let d = 0; d < 8; d++) { g.time.day = d; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); out.push(g.fx.stats().sky.phase); }
        g.time.day = 0; return out;
      });
      t.note('phases', phases);
      t.assert(phases.join(',') === '0,1,2,3,4,5,6,7', `moon phase follows the day (${phases})`);
      await t.call('setSetting', 'clouds', false);
      await t.call('waitFrames', 2);
      t.assert(!(await fxStats(t)).clouds, 'clouds toggle off with settings.clouds');
      await t.call('setSetting', 'clouds', true);
      await t.call('setTime', 3000);
      await clearScenery(t);
    },
  },
  {
    name: 'fx-viewmodel',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await scenery(t);
      await t.call('setLook', 0, -20);
      await t.call('selectSlot', 1);           // planks
      await t.call('waitFrames', 30);
      let s = await fxStats(t);
      t.assert(s.viewModel, 'view model visible in first person');
      t.assert(s.heldItem === 'oak_planks', `holds the selected block (${s.heldItem})`);
      await t.shot('fx-hand-block');
      await t.eval(() => window.__game.game.player.swing());
      await t.call('sleep', 90);
      await t.shot('fx-hand-swing');
      await t.call('setSlot', 2, 'diamond_pickaxe', 1);
      await t.call('selectSlot', 2);
      await t.call('waitFrames', 40);
      s = await fxStats(t);
      t.assert(s.heldItem === 'diamond_pickaxe', `equip swap to the tool (${s.heldItem})`);
      await t.shot('fx-hand-tool');
      await t.call('setSlot', 3, null);
      await t.call('selectSlot', 3);
      await t.call('waitFrames', 40);
      t.assert((await fxStats(t)).heldItem === null, 'empty hand shows the arm only');
      await t.shot('fx-hand-empty');
      await t.call('selectSlot', 0);
      await clearScenery(t);
    },
  },
  {
    name: 'fx-crack-ghost',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await scenery(t);
      await t.call('setLook', 0, -35);
      const p = await t.call('pos');
      const bx = Math.floor(p.x), bz = Math.floor(p.z) - 3;
      // crack from the block:mining event path (works without CORE-E)
      await t.eval(([x, z]) => {
        const g = window.__game.game;
        g.world.setBlock(x, 3, z, g.world.getBlock(x, 3, z) || 2, 0, { cause: 'test' });
        g.events.emit('block:mining', { x, y: 3, z, id: g.world.getBlock(x, 3, z), progress: 0.65, stage: 6 });
      }, [bx, bz]);
      await t.call('waitFrames', 3);
      let s = await fxStats(t);
      t.assert(s.crack === 6, `crack overlay shows stage 6 (got ${s.crack})`);
      // ghost: kid scheme + a target (set directly while interaction is a stub)
      await t.eval(([x, z]) => {
        const g = window.__game.game;
        g.input.aimActive = true;
        g.interaction.target = { x: x + 1, y: 3, z, face: 2, nx: 0, ny: 1, nz: 0, id: g.world.getBlock(x + 1, 3, z), state: 0, dist: 3, px: x + 1.5, py: 4, pz: z + 0.5 };
      }, [bx, bz]);
      await t.call('selectSlot', 4);  // red wool
      await t.call('waitFrames', 3);
      s = await fxStats(t);
      t.note('ghost', s.ghost);
      t.assert(s.ghost && s.ghost.x === bx + 1 && s.ghost.y === 4 && s.ghost.z === bz, `ghost block above the targeted top face (${JSON.stringify(s.ghost)})`);
      await t.shot('fx-crack-ghost');
      await t.eval(() => { const g = window.__game.game; g.events.emit('block:miningStop', { x: g.fx.debug.crack.evt.x, y: 3, z: g.fx.debug.crack.evt.z }); g.interaction.target = null; });
      await t.call('waitFrames', 2);
      s = await fxStats(t);
      t.assert(s.crack === -1 && !s.ghost, 'crack and ghost hide again');
      await clearScenery(t);
    },
  },
  {
    name: 'fx-player-model',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await scenery(t);
      await t.call('setLook', 30, -10);
      // stand-in for the player lane's third-person camera: 4 blocks behind the eye
      await t.eval(() => {
        const g = window.__game.game, p = g.player;
        p.view = 1;
        window.__fxOrigFrame = p.frame;
        p.frame = function (gg, dt, a) {
          window.__fxOrigFrame.call(this, gg, dt, a);
          const cam = g.renderer.camera, d = p.getLookDir({});
          cam.position.set(p.renderX - d.x * 4, p.renderY + p.eyeHeight - d.y * 4, p.renderZ - d.z * 4);
        };
      });
      await t.call('waitFrames', 5);
      let s = await fxStats(t);
      t.assert(s.playerModel && !s.viewModel, 'third person: body visible, hand hidden');
      await t.shot('fx-player-back');
      await t.eval(() => { window.__game.game.player.yaw += Math.PI; });
      await t.call('waitFrames', 30);
      await t.eval(() => { const p = window.__game.game.player; p.yaw -= Math.PI; });
      await t.eval(() => {
        const g = window.__game.game, p = g.player;
        p.view = 2;
        p.frame = function (gg, dt, a) {
          window.__fxOrigFrame.call(this, gg, dt, a);
          const cam = g.renderer.camera, d = p.getLookDir({});
          cam.position.set(p.renderX + d.x * 3.2, p.renderY + p.eyeHeight + d.y * 3.2, p.renderZ + d.z * 3.2);
          cam.lookAt(p.renderX, p.renderY + 1.3, p.renderZ);
        };
      });
      await t.call('waitFrames', 5);
      await t.shot('fx-player-front');
      await t.eval(() => { const p = window.__game.game.player; p.frame = window.__fxOrigFrame; p.view = 0; });
      await t.call('waitFrames', 2);
      s = await fxStats(t);
      t.assert(!s.playerModel && s.viewModel, 'first person again: body hidden, hand visible');
      await clearScenery(t);
    },
  },
  {
    name: 'fx-overlays',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const flashes = await t.eval(() => { const fx = window.__game.game.fx; let n = 0; for (let i = 0; i < 10; i++) if (fx.hurtFlash()) n++; return n; });
      t.assert(flashes === 3, `flash safety: at most 3 flashes per second (got ${flashes})`);
      await t.call('sleep', 120);
      await t.shot('fx-hurt');
      const f = await t.eval(async () => { const fx = window.__game.game.fx; await fx.fade(1, 100); const a = fx.stats().fade; await fx.fade(0, 50); return [a, fx.stats().fade]; });
      t.assert(f[0] === 1 && f[1] === 0, `fade resolves at its target (${f})`);
      // underwater tint: put water at the eye
      const p = await t.call('pos');
      await t.call('setBlock', Math.floor(p.x), 5, Math.floor(p.z), 'water');
      await t.call('waitFrames', 3);
      t.assert((await fxStats(t)).underwater, 'underwater tint while the eye is in water');
      const cls = await t.eval(() => document.querySelector('#fx-layer .fx-water').classList.contains('on'));
      t.assert(cls, 'blue overlay element shown');
      await t.shot('fx-underwater');
      await t.call('setBlock', Math.floor(p.x), 5, Math.floor(p.z), 'air');
      await t.call('waitFrames', 3);
      t.assert(!(await fxStats(t)).underwater, 'tint goes away above water');
      // kid hold ring on pointerdown
      await t.page.mouse.move(640, 360);
      await t.page.mouse.down();
      await t.call('waitFrames', 3);
      t.assert((await fxStats(t)).ring, 'kid hold ring appears on pointerdown');
      await t.shot('fx-ring');
      await t.page.mouse.up();
      await t.call('waitFrames', 2);
      t.assert(!(await fxStats(t)).ring, 'ring hides on release');
    },
  },
  {
    name: 'fx-particles-kinds',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await scenery(t);
      await t.call('setLook', 0, -15);
      await t.eval(() => {
        const g = window.__game.game, fx = g.fx, p = g.player;
        const z = p.z - 5;
        fx.spawnParticles('heart', p.x - 2, p.y + 1.5, z, { count: 6 });
        fx.spawnParticles('sparkle', p.x - 0.7, p.y + 0.8, z, { count: 14, spread: 0.5 });
        fx.spawnParticles('smoke', p.x + 0.7, p.y + 1, z, { count: 10 });
        fx.spawnParticles('flame', p.x + 2, p.y + 1, z, { count: 4, spread: 0.2 });
        fx.spawnParticles('crit', p.x, p.y + 2.2, z, { count: 10 });
        fx.spawnParticles('splash', p.x + 1.5, p.y + 0.2, z + 1, { count: 10 });
        fx.spawnParticles('item', p.x - 1.5, p.y + 0.3, z + 1, { count: 10, item: 'apple' });
        g.events.emit('explosion', { x: p.x + 4, y: p.y + 1, z: z - 2, power: 4, source: 'test', action: 0, count: 0, blocks: [] });
        fx.blockBreakParticles(Math.floor(p.x) - 1, Math.floor(p.y), Math.floor(z), window.__game.blockId('oak_planks'), 0);
      });
      await t.call('waitTicks', 3);
      const s = await fxStats(t);
      t.note('particles', s.particles);
      t.assert(s.particles > 60, `many kinds alive (${s.particles})`);
      const draws = await t.eval(() => window.__game.game.renderer.getStats().drawCalls);
      t.note('drawCalls', draws);
      await t.shot('fx-particles');
      await t.call('runTicks', 80);
      t.assert((await fxStats(t)).particles < 10, 'particles expire');
      await clearScenery(t);
    },
  },
  {
    name: 'fx-weather',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await scenery(t);
      await t.call('setLook', 0, 5);
      await t.eval(() => window.__game.game.fx.setWeather(1));
      await t.call('sleep', 2500);
      const s = await fxStats(t);
      t.note('weather', s.weather);
      t.assert(s.weather.rain > 0.3, `rain eases in (${s.weather.rain})`);
      t.assert((await t.call('eventCount', 'fx:weather')) >= 1, 'fx:weather emitted');
      await t.shot('fx-rain');
      await t.eval(() => window.__game.game.fx.setWeather(0));
      await clearScenery(t);
    },
  },
  {
    name: 'fx-events',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const n = await t.eval(() => {
        const g = window.__game.game, fx = g.fx, p = g.player;
        const c0 = fx.stats().particles;
        g.events.emit('bonemeal', { x: Math.floor(p.x), y: 4, z: Math.floor(p.z) - 2 });
        const c1 = fx.stats().particles;
        g.events.emit('mob:love', { id: -1, type: 'cow', x: p.x, y: p.y, z: p.z - 3 });
        const c2 = fx.stats().particles;
        g.events.emit('entity:spawn', { id: -2, type: 'pig', x: p.x, y: p.y, z: p.z - 3, reason: 'load' });
        const c3 = fx.stats().particles;
        g.events.emit('entity:spawn', { id: -3, type: 'pig', x: p.x, y: p.y, z: p.z - 3, reason: 'spawn' });
        const c4 = fx.stats().particles;
        return { sparkles: c1 - c0, hearts: c2 - c1, loadPoof: c3 - c2, spawnPoof: c4 - c3 };
      });
      t.note('events', n);
      t.assert(n.sparkles > 0 && n.hearts > 0, 'bone meal sparkles and love hearts');
      t.assert(n.loadPoof === 0, 'no poof for entity:spawn reason load');
      t.assert(n.spawnPoof > 0, 'poof for a real spawn');
    },
  },
  {
    // In-world checks that need the real core: terrain drawn, real mining and targeting.
    name: 'fx-inworld-break',
    requires: ['renderer', 'world', 'mesher', 'textures', 'input', 'player', 'raycast', 'interaction'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, mode: 'survival', difficulty: 'easy' });
      await t.call('setFlying', false);
      await t.call('waitTicks', 10);
      await t.call('setLook', 0, -50);
      await t.call('waitFrames', 3);
      const tg = await t.call('target');
      t.assert(tg, 'a block is targeted');
      await t.eval(() => window.__game.game.input.setVirtual('attack', true));
      await t.call('waitTicks', 8);
      const s = await fxStats(t);
      t.assert(s.crack >= 0, `crack overlay while mining (stage ${s.crack})`);
      await t.shot('fx-inworld-crack');
      await t.call('waitTicks', 12);
      await t.eval(() => window.__game.game.input.setVirtual('attack', false));
      await t.call('waitTicks', 2);
      await t.shot('fx-inworld-break');
      await t.call('setMode', 'creative');
      await t.call('setLook', 0, -40);
      await t.call('aimAt', 0.5, 4, -2.5);
      await t.call('waitFrames', 3);
      await t.shot('fx-inworld-ghost');
    },
  },
];
