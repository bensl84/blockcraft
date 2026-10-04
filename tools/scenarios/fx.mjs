// OWNER LANE: FEATURE-FX. Smoke scenarios for the FX lane (SPEC §8.7 acceptance + visual review shots).
// Scenarios that need lanes which may still be stubs (items, mobs) list them in `requires` and report PENDING.

const FLAT = { preset: 'flat', seed: 1, mode: 'creative', difficulty: 'peaceful' };

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
        // the real world streams columns in after startWorld: wait until the renderer's geometry count is steady
        let last = -1, steady = 0;
        for (let i = 0; i < 600 && steady < 30; i++) { await wait(); const n = g.renderer.getStats().geometries; steady = n === last ? steady + 1 : 0; last = n; }
        const keys = ['diamond', 'grass_block', 'stone_pickaxe', 'poppy', 'torch'];
        const cycle = async () => {
          const objs = keys.map((k, i) => { const o = fx.makeItemMesh(k); o.position.set(g.player.x + i * 0.4 - 0.8, g.player.y + 1.4, g.player.z - 2); g.renderer.addObject(o); return o; });
          await wait();
          for (const o of objs) fx.disposeItemMesh(o);
        };
        await cycle(); await wait();
        const g0 = g.renderer.getStats().geometries, i0 = fx.stats().itemGeometries;
        for (let i = 0; i < 100; i++) await cycle();
        await wait();
        const g1 = g.renderer.getStats().geometries, i1 = fx.stats().itemGeometries;
        const a = fx.makeItemMesh('diamond'), b = fx.makeItemMesh('diamond');
        const shared = a.userData.fxMesh.geometry === b.userData.fxMesh.geometry;
        fx.disposeItemMesh(a); fx.disposeItemMesh(b);
        return { g0, g1, i0, i1, shared, live: fx.stats().itemMeshesLive };
      });
      t.note('geometries', res);
      t.assert(res.shared, 'geometry is shared per item key');
      t.assert(res.i1 === res.i0, `100 make/dispose cycles keep the FX item geometry cache flat (${res.i0} -> ${res.i1})`);
      t.assert(res.g1 <= res.g0 + 2, `100 make/dispose cycles keep the renderer geometry count flat (${res.g0} -> ${res.g1})`);
    },
  },
  {
    name: 'fx-sky',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      // yaw 270 faces east (+X, sunrise), yaw 90 faces west (sunset); the sun/moon must be where we look
      const bodyOnScreen = (sign) => t.eval((sign) => {
        const g = window.__game.game, c = g.renderer.camera, d = g.renderer.sky.sunDir;
        return window.__game.worldToNdc(c.position.x + sign * d[0] * 60, c.position.y + sign * d[1] * 60, c.position.z + sign * d[2] * 60);
      }, sign);
      await t.call('setLook', 270, 25);
      await t.call('setTime', 1000);
      await t.call('waitFrames', 4);
      let s = await fxStats(t);
      t.assert(s.sky.sunVisible, 'sun is up in the morning');
      t.assert(s.clouds, 'clouds shown (settings.clouds default on)');
      let n = await bodyOnScreen(1);
      t.assert(n.onScreen && Math.abs(n.x) < 0.5, `morning sun in the east, in view (${JSON.stringify(n)})`);
      await t.shot('fx-sky-morning');
      await t.call('setLook', 0, 70);
      await t.call('setTime', 6000);
      await t.call('waitFrames', 4);
      await t.shot('fx-sky-noon');
      await t.call('setLook', 90, 8);
      await t.call('setTime', 12300);
      await t.call('waitFrames', 4);
      n = await bodyOnScreen(1);
      t.assert(n.onScreen && Math.abs(n.x) < 0.5, `setting sun in the west, in view (${JSON.stringify(n)})`);
      await t.shot('fx-sky-sunset');
      await t.call('setLook', 270, 80);
      await t.call('setTime', 18000);
      await t.call('waitFrames', 4);
      s = await fxStats(t);
      t.assert(s.sky.stars > 0.3, `stars at midnight (${s.sky.stars})`);
      n = await bodyOnScreen(-1);
      t.assert(n.onScreen, `moon overhead at midnight (${JSON.stringify(n)})`);
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
    },
  },
  {
    name: 'fx-viewmodel',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
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
    },
  },
  {
    name: 'fx-crack-ghost',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
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
      // ghost: kid scheme + a target (set directly while interaction is a stub; fx-inworld-break covers the real path)
      if (!t.stubs.includes('interaction')) {
        await t.eval(([x, z]) => window.__game.game.events.emit('block:miningStop', { x, y: 3, z }), [bx, bz]);
        await t.call('waitFrames', 2);
        t.assert((await fxStats(t)).crack === -1, 'crack hides on block:miningStop');
        return;
      }
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
    },
  },
  {
    name: 'fx-player-model',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('setLook', 30, -10);
      // the player lane's real third-person camera (V / F5): 0 first person -> 1 behind -> 2 in front
      await t.call('press', 'toggleView');
      await t.call('waitFrames', 5);
      let s = await fxStats(t);
      t.assert((await t.call('pos')).view === 1, 'V switches to the camera behind');
      t.assert(s.playerModel && !s.viewModel, 'third person: body visible, hand hidden');
      await t.shot('fx-player-back');
      await t.eval(() => { window.__game.game.player.yaw += Math.PI; });
      await t.call('waitFrames', 30);
      await t.eval(() => { const p = window.__game.game.player; p.yaw -= Math.PI; });
      await t.call('press', 'toggleView');
      await t.call('waitFrames', 5);
      await t.shot('fx-player-front');
      await t.call('press', 'toggleView');
      await t.call('waitFrames', 2);
      s = await fxStats(t);
      t.assert(!s.playerModel && s.viewModel, 'first person again: body hidden, hand visible');
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
    },
  },
  {
    name: 'fx-weather',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('setLook', 0, 5);
      await t.eval(() => window.__game.game.fx.setWeather(1));
      await t.call('sleep', 2500);
      const s = await fxStats(t);
      t.note('weather', s.weather);
      t.assert(s.weather.rain > 0.3, `rain eases in (${s.weather.rain})`);
      t.assert((await t.call('eventCount', 'fx:weather')) >= 1, 'fx:weather emitted');
      await t.shot('fx-rain');
      await t.eval(() => window.__game.game.fx.setWeather(0));
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
      await t.eval(() => { const i = window.__game.game.input; i.aim.x = 0; i.aim.y = 0; i.aimActive = true; i.setVirtual('attack', true); });
      await t.call('waitTicks', 8);
      let s = await fxStats(t);
      t.assert(s.crack >= 0, `crack overlay while mining (stage ${s.crack})`);
      await t.shot('fx-inworld-crack');
      const ok = await t.waitFor(() => window.__game.game.fx.stats().particles > 10, null, 3000);
      await t.eval(() => window.__game.game.input.setVirtual('attack', false));
      t.assert(ok, 'breaking the block bursts particles');
      await t.shot('fx-inworld-break');
      await t.call('runTicks', 60);
      t.assert((await fxStats(t)).particles < 10, 'particles settle and expire');
      // kid ghost block on the real cursor target
      await t.call('setMode', 'creative');
      await t.call('setSlot', 1, 'oak_planks', 64);   // the survival hotbar starts empty
      await t.call('selectSlot', 1);
      const p = await t.call('pos');
      const bx = Math.floor(p.x), bz = Math.floor(p.z) - 2;
      await t.call('setLook', 0, -40);
      const aim = await t.call('aimAt', bx + 0.5, 4, bz + 0.5);
      t.note('aim', aim);
      await t.call('waitFrames', 3);
      s = await fxStats(t);
      t.assert(s.ghost && s.ghost.x === bx && s.ghost.y === 4 && s.ghost.z === bz, `ghost on the cell a tap would fill (${JSON.stringify(s.ghost)})`);
      await t.shot('fx-inworld-ghost');
      // the sky over real terrain, and a third-person look (player lane camera)
      await t.call('setTime', 12500);
      await t.call('setLook', 90, 6);
      await t.call('waitFrames', 5);
      await t.shot('fx-inworld-sunset');
      await t.call('setTime', 3000);
      await t.call('press', 'toggleView');
      await t.call('waitFrames', 10);
      if ((await t.call('pos')).view === 1) {
        t.assert((await fxStats(t)).playerModel, 'third-person body visible after V');
        await t.shot('fx-inworld-thirdperson');
        await t.call('press', 'toggleView');
        await t.call('waitFrames', 3);
        await t.call('press', 'toggleView');
      }
    },
  },
  {
    // Dropped items are FX item meshes (MOBS item entity calls fx.makeItemMesh) and do not leak geometry.
    name: 'fx-inworld-drops',
    requires: ['renderer', 'world', 'interaction', 'items', 'mobs'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, mode: 'survival', difficulty: 'easy' });
      const p = await t.call('pos');
      const x = Math.floor(p.x) + 2, z = Math.floor(p.z) - 2;
      await t.call('setBlock', x, 4, z, 'oak_planks');
      await t.eval(([x, z]) => window.__game.game.interaction.breakBlock(x, 4, z, { by: 'test', drops: true }), [x, z]);
      await t.call('waitTicks', 5);
      const info = await t.eval(() => {
        const ents = window.__game.game.entities.ofType('item');
        const o = ents[0] && ents[0].object3d;
        return { n: ents.length, key: o && o.userData ? o.userData.itemKey : null, stats: window.__game.game.fx.stats() };
      });
      t.note('drops', info);
      t.assert(info.n >= 1 && info.key === 'oak_planks', 'the dropped item uses the FX item mesh');
      await t.call('setLook', 0, -30);
      await t.call('waitFrames', 5);
      await t.shot('fx-inworld-drop');
    },
  },
  {
    // FID-2 / POL-9: anything burning shows flames - the player's screen (first person), the player model (third
    // person) and burning monsters in daylight; smoke rises off them. Real lava sets the player alight.
    name: 'fx-burning',
    requires: [],
    async run(t) {
      await t.call('startWorld', { ...FLAT, mode: 'survival', difficulty: 'normal' });
      await t.call('setTime', 6000);
      const p = await t.call('pos');
      const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
      await t.call('setBlock', px, py, pz, 'lava');
      await t.call('waitTicks', 12);
      await t.call('setBlock', px, py, pz, 'air');
      await t.call('waitTicks', 3);
      const fire = await t.eval(() => window.__game.game.player.fireTicks);
      t.assert(fire > 0, `standing in lava sets the player on fire (fireTicks ${fire})`);
      await t.call('waitFrames', 3);
      let s = await fxStats(t);
      t.assert(s.playerFire, 'first-person flames over the lower screen while burning');
      t.assert(await t.eval(() => document.querySelector('#fx-layer .fx-fire').classList.contains('on')), 'fire overlay element shown');
      await t.shot('fx-burning-1p');
      await t.page.keyboard.press('KeyV');
      await t.call('waitFrames', 5);
      s = await fxStats(t);
      t.assert(!s.playerFire && s.burning >= 1, `third person: flames on the player model, not the screen (${s.burning})`);
      await t.shot('fx-burning-3p');
      await t.page.keyboard.press('KeyV'); await t.page.keyboard.press('KeyV');
      await t.eval(() => { window.__game.game.player.fireTicks = 0; });
      await t.call('waitFrames', 3);
      t.assert(!(await fxStats(t)).playerFire, 'flames go out with the fire');
      // monsters burning in the morning sun
      await t.call('setRandomSeed', 7);
      await t.call('spawn', 'zombie', px + 0.5, py, pz - 6.5);
      await t.call('spawn', 'skeleton', px + 2.5, py, pz - 6.5);
      await t.call('lookAt', px + 1.5, py + 1, pz - 6.5);
      await t.call('waitFor', '(() => { let n = 0; window.__game.game.entities.forEach((e) => { if (e.fireTicks > 0) n++; }); return n >= 2; })()', 4000);
      await t.call('waitFrames', 3);
      s = await fxStats(t);
      t.note('burning', s.burning);
      t.assert(s.burning >= 2, `burning monsters get flames (${s.burning})`);
      await t.shot('fx-burning-mobs');
      await t.call('setMode', 'creative');
      await t.call('setTime', 18000);
    },
  },
  {
    // FID-13: sleeping lies down on the pillow (camera low, along the bed) while the screen darkens, then stands
    // back up under the wake-up fade.
    name: 'fx-sleep-view',
    requires: [],
    async run(t) {
      await t.call('startWorld', { ...FLAT, mode: 'survival' });
      await t.call('setRule', 'daylightCycle', true);
      await t.call('setTime', 14000);
      const p = await t.call('pos');
      const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z) - 3;
      // both halves in one evaluation (LEAD integration): with two separate calls a game tick could run in between,
      // and MECH's bed rule then removed the lonely foot half (seen once under --http: "no_bed")
      const r = await t.eval(([x, y, z]) => {
        const api = window.__game;
        api.setBlock(x, y, z, 'bed', 0);
        api.setBlock(x, y, z - 1, 'bed', 4);
        return api.game.mechanics.trySleep(x, y, z);
      }, [bx, by, bz]);
      t.assert(r && r.ok, `sleep starts (${JSON.stringify(r)})`);
      await t.call('sleep', 900);
      const cam = await t.eval(() => { const c = window.__game.game.renderer.camera; return { y: c.position.y, z: c.position.z, s: window.__game.game.fx.stats() }; });
      t.note('camera', { y: cam.y, z: cam.z });
      t.assert(cam.s.sleepView, 'lying-down view active');
      t.assert(Math.abs(cam.y - (by + 0.78)) < 0.1 && cam.z < bz && cam.z > bz - 1, `camera on the pillow (${cam.y.toFixed(2)}, z ${cam.z.toFixed(2)})`);
      t.assert(cam.s.fade > 0.9, 'screen darkening toward black');
      await t.shot('fx-sleep-view');
      t.assert(await t.call('waitFor', '!window.__game.game.player.sleeping', 8000), 'wakes up');
      await t.call('sleep', 1300);
      const s = await fxStats(t);
      t.assert(!s.sleepView && s.fade === 0, `standing again, fade gone (${s.fade})`);
    },
  },
];
