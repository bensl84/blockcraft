// OWNER LANE: CORE-C. Smoke scenarios for world storage, streaming, lighting, meshing and workers.
// Run: node tools/smoke.mjs --tag corec --scenario corec-workers,corec-light-border,...
// Each scenario starts its own world (the harness returns to the title between scenarios).

const FLAT = { preset: 'flat', seed: 3, mode: 'creative', difficulty: 'peaceful' };
const HILLS = { preset: 'default', seed: 12345, mode: 'creative', difficulty: 'peaceful' };

/**
 * Debug view (CORE-C only): draws the world's section meshes with three.js objects reached through the live
 * renderer (no three import in the page), coloured by the average texel colour of each face's layer x shade x
 * AO x light - so meshing, AO and smooth light can be judged in screenshots even while CORE-D is a stub.
 * Returns the number of quads drawn. Call corecDebugViewOff to remove it.
 */
async function debugViewOn(t, opts = {}) {
  return t.eval((opts) => {
    const g = window.__game.game, r = g.renderer, w = g.world;
    if (!r || !r.scene || !r.createBlockModel) return -1;
    // three.js classes reached through instances the renderer owns
    const probe = r.createBlockModel(1, 0);
    const BoxGeometry = probe.geometry.constructor;
    const BufferGeometry = Object.getPrototypeOf(BoxGeometry);
    const BufferAttribute = Object.getPrototypeOf(probe.geometry.attributes.position.constructor);
    const Mesh = probe.constructor, Material = probe.material.constructor, Group = r.worldGroup.constructor;
    probe.geometry.dispose();
    const tex = g.textures;
    const avg = new Float32Array(tex.count * 3);
    for (let l = 0; l < tex.count; l++) {
      let rr = 0, gg = 0, bb = 0, n = 0;
      for (let i = 0; i < 256; i++) { const o = (l * 256 + i) * 4; if (tex.data[o + 3] < 128) continue; rr += tex.data[o]; gg += tex.data[o + 1]; bb += tex.data[o + 2]; n++; }
      avg[l * 3] = n ? rr / n / 255 : 1; avg[l * 3 + 1] = n ? gg / n / 255 : 0; avg[l * 3 + 2] = n ? bb / n / 255 : 1;
    }
    const AO = [0.5, 0.7, 0.85, 1.0];
    const daylight = opts.daylight ?? 1;
    const group = new Group();
    group.name = 'corec-debug';
    const mat = new Material({ vertexColors: true, transparent: false });
    let quads = 0;
    const pcx = Math.floor(g.player.x) >> 4, pcz = Math.floor(g.player.z) >> 4;
    const R = opts.radius ?? 3;
    const padB = new Uint16Array(5832), padL = new Uint8Array(5832);
    w.forEachColumn((c) => {
      if (Math.abs(c.cx - pcx) > R || Math.abs(c.cz - pcz) > R || c.state < 3) return;
      for (let sy = 0; sy < 8; sy++) {
        if (!(c.meshedMask & (1 << sy))) continue;
        const m = g.__corecMesh(c.cx, sy, c.cz, padB, padL);
        if (!m) continue;
        for (const pass of ['opaque', 'cutout', 'translucent']) {
          const b = m[pass];
          if (!b) continue;
          const geo = new BufferGeometry();
          geo.setAttribute('position', new BufferAttribute(b.position, 3));
          const col = new Float32Array(b.quads * 12);
          for (let v = 0; v < b.quads * 4; v++) {
            const layer = b.tex[v * 4];
            const sky = Math.max(0, b.light[v * 4] / 16 - (1 - daylight) * 11), blk = b.light[v * 4 + 1] / 16;
            const L = Math.max(Math.pow(0.8, 15 - sky), Math.pow(0.8, 15 - blk), 0.23);
            const k = (b.light[v * 4 + 3] / 255) * AO[b.light[v * 4 + 2]] * L;
            const warm = blk > sky;
            col[v * 3] = avg[layer * 3] * k; col[v * 3 + 1] = avg[layer * 3 + 1] * k * (warm ? 0.92 : 1); col[v * 3 + 2] = avg[layer * 3 + 2] * k * (warm ? 0.78 : 1);
          }
          geo.setAttribute('color', new BufferAttribute(col, 3));
          const idx = new Uint32Array(b.quads * 6);
          for (let q = 0; q < b.quads; q++) { idx[q * 6] = q * 4; idx[q * 6 + 1] = q * 4 + 1; idx[q * 6 + 2] = q * 4 + 2; idx[q * 6 + 3] = q * 4; idx[q * 6 + 4] = q * 4 + 2; idx[q * 6 + 5] = q * 4 + 3; }
          geo.setIndex(new BufferAttribute(idx, 1));
          const mesh = new Mesh(geo, mat);
          mesh.position.set(c.cx * 16, sy * 16, c.cz * 16);
          group.add(mesh);
          quads += b.quads;
        }
      }
    });
    r.addObject(group);
    g.__corecDebug = group;
    return quads;
  }, opts);
}
async function debugViewOff(t) {
  await t.eval(() => {
    const g = window.__game.game;
    const grp = g.__corecDebug;
    if (!grp) return;
    g.renderer.removeObject(grp);
    grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    g.__corecDebug = null;
  });
}
/** Install a page helper that meshes one section on demand with the real mesher (via the world's own path). */
async function installMeshHelper(t) {
  await t.eval(() => {
    const g = window.__game.game;
    // capture the meshes the world hands to the renderer (works with the stub and the real renderer)
    if (!g.__corecMeshes) {
      g.__corecMeshes = new Map();
      const r = g.renderer;
      const orig = r.setSectionMesh.bind(r);
      const origRemove = r.removeColumnMeshes.bind(r);
      const origClear = r.clearWorld.bind(r);
      r.setSectionMesh = (cx, sy, cz, mesh) => { if (mesh) g.__corecMeshes.set(cx + ',' + sy + ',' + cz, { mesh, frame: g.frameCount }); else g.__corecMeshes.delete(cx + ',' + sy + ',' + cz); return orig(cx, sy, cz, mesh); };
      r.removeColumnMeshes = (cx, cz) => { for (let s = 0; s < 8; s++) g.__corecMeshes.delete(cx + ',' + s + ',' + cz); return origRemove(cx, cz); };
      r.clearWorld = () => { g.__corecMeshes.clear(); return origClear(); };
      g.__corecMesh = (cx, sy, cz) => { const e = g.__corecMeshes.get(cx + ',' + sy + ',' + cz); return e ? e.mesh : null; };
    }
  });
}

/** Block shape gallery on a flat world: [name, state] per cell along rows. */
const GALLERY = [
  [['oak_slab', 0], ['oak_slab', 1], ['oak_stairs', 0], ['oak_stairs', 1], ['oak_stairs', 2], ['oak_stairs', 4], ['cobblestone_stairs', 3], ['oak_fence', 0], ['oak_fence', 10], ['oak_fence', 5]],
  [['torch', 0], ['torch', 1], ['torch', 2], ['torch', 3], ['torch', 4], ['ladder', 2], ['oak_door', 0], ['oak_door', 4], ['glass_pane', 10], ['glass_pane', 5]],
  [['oak_fence_gate', 0], ['oak_fence_gate', 4], ['oak_fence_gate', 1], ['bed', 2], ['bed', 6], ['chest', 2], ['cake', 0], ['cake', 3], ['cactus', 0], ['white_carpet', 0]],
  [['snow', 0], ['snow', 3], ['snow', 7], ['farmland', 7], ['wheat', 7], ['carrots', 3], ['fire', 0], ['poppy', 0], ['sugar_cane', 0], ['oak_sapling', 0]],
  [['water', 0], ['water', 2], ['water', 5], ['lava', 0], ['lava', 4], ['oak_log', 1], ['oak_log', 2], ['hay_block', 1], ['glass', 0], ['oak_leaves', 0]],
];

const SCENARIOS = [
  {
    name: 'corec-workers',
    requires: ['world', 'lighting', 'mesher'],
    async run(t) {
      await t.call('startWorld', HILLS);
      const ok = await t.waitFor(() => window.__game.game.world.unmeshedWithin(4) === 0, null, 15000);
      const s = await t.eval(() => window.__game.game.world.stats());
      t.note('world', { workers: s.workers, reason: s.workerReason, workerGens: s.workerGens, workerMeshes: s.workerMeshes, syncMeshes: s.syncMeshes, genAvgMs: +s.genAvgMs.toFixed(2), lightAvgMs: +s.lightAvgMs.toFixed(2), meshAvgMs: +s.meshAvgMs.toFixed(2), dropped: s.droppedResults });
      t.assert(ok, 'columns within 4 meshed');
      t.assert(s.workers > 0, `blob workers run from ${t.args.http ? 'http' : 'file://'} (${s.workerReason})`);
      t.assert(s.workerGens > 0 && s.workerMeshes > 0, 'generation and meshing ran in workers');
    },
  },
  {
    name: 'corec-light-border',
    requires: ['world', 'lighting'],
    async run(t) {
      await t.call('startWorld', FLAT);
      const p = await t.call('pos');
      const cx = Math.floor(p.x) >> 4;
      const tx = cx * 16 + 15, ty = 6, tz = Math.floor(p.z);   // last cell of the player's column, next to the border
      t.assert(await t.call('setBlock', tx, ty, tz, 'torch'), 'torch placed');
      const read = () => t.eval(({ tx, ty, tz }) => { const w = window.__game.game.world; const out = []; for (let d = 0; d <= 14; d++) out.push([w.getBlockLight(tx - d, ty, tz), w.getBlockLight(tx + d, ty, tz)]); return out; }, { tx, ty, tz });
      const lit = await read();
      t.note('litWestEast', lit.slice(0, 6).map(([a, b]) => `${a}/${b}`).join(' '));
      for (let d = 0; d <= 14; d++) t.assert(lit[d][0] === Math.max(0, 14 - d) && lit[d][1] === Math.max(0, 14 - d), `symmetric light at distance ${d}: ${lit[d]}`);
      t.assert(await t.call('setBlock', tx, ty, tz, 'air'), 'torch removed');
      const dark = await read();
      t.assert(dark.every(([a, b]) => a === 0 && b === 0), 'all block light back to 0');
      t.assert(await t.call('setBlock', tx, ty, tz, 'torch'), 'torch re-added');
      const again = await read();
      t.assert(JSON.stringify(again) === JSON.stringify(lit), 'same light after re-adding');
      const roof = await t.eval(({ tx, tz }) => {
        const g = window.__game.game, w = g.world, stone = window.__game.blockId('stone');
        const list = [];
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) list.push([tx + 20 + dx, 12, tz + dz, stone]);
        w.setBlocks(list, { cause: 'test' });
        return { edge: w.getSkyLight(tx + 19, 11, tz), centre: w.getSkyLight(tx + 20, 11, tz), below: w.getSkyLight(tx + 20, 5, tz), open: w.getSkyLight(tx + 25, 5, tz) };
      }, { tx, tz });
      t.note('roof', roof);
      t.assert(roof.edge === 14 && roof.centre === 13 && roof.below === 13 && roof.open === 15, `sky under a 3x3 roof: ${JSON.stringify(roof)}`);
    },
  },
  {
    name: 'corec-edit-same-frame',
    requires: ['world', 'lighting', 'mesher'],
    async run(t) {
      await t.call('startWorld', FLAT);
      await installMeshHelper(t);
      await t.waitFor(() => window.__game.game.world.unmeshedWithin(3) === 0, null, 10000);
      await t.call('waitFrames', 5);
      const p = await t.call('pos');
      const res = [];
      for (const [name, dx] of [['gold_block', 2], ['torch', 15], ['glass', -3]]) {
        const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + 1;
        const r = await t.eval(async ({ x, z, name }) => {
          const g = window.__game.game, api = window.__game;
          const f0 = g.frameCount;
          const t0 = performance.now();
          g.world.setBlock(x, 4, z, api.blockId(name), 0, { cause: 'test' });
          await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
          const key = (x >> 4) + ',0,' + (z >> 4);
          const e = g.__corecMeshes.get(key);
          return { editFrame: f0, meshFrame: e ? e.frame : null, ms: Math.round(performance.now() - t0) };
        }, { x, z, name });
        res.push({ name, ...r });
        t.assert(r.meshFrame === r.editFrame + 1, `${name}: remeshed in the first frame after the edit (${JSON.stringify(r)})`);
      }
      t.note('edits', res);
      const st = await t.eval(() => window.__game.game.world.stats());
      t.note('urgentMeshes', st.urgentMeshes);
    },
  },
  {
    name: 'corec-stream-leak',
    requires: ['world', 'lighting', 'mesher'],
    async run(t) {
      await t.call('startWorld', HILLS);
      await t.call('setRenderDistance', 6);
      const home = await t.call('pos');
      // wait until the world has seen the new position (center) AND everything within R is meshed
      const meshed = () => t.waitFor(() => { const g = window.__game.game, w = g.world; return w.center.cx === (Math.floor(g.player.x) >> 4) && w.center.cz === (Math.floor(g.player.z) >> 4) && w.unmeshedWithin(6) === 0; }, null, 20000);
      const counts = () => t.eval(() => { const g = window.__game.game; const s = g.world.stats(); const r = g.renderer.getStats(); return { columns: s.columns, sections: s.sectionMeshes, rendererSections: r.sectionMeshes, geometries: r.geometries }; });
      t.assert(await meshed(), 'home area meshed');
      await t.call('waitFrames', 30);
      const a = await counts();
      await t.call('teleport', home.x + 320, home.y + 20, home.z);
      t.assert(await meshed(), 'far area meshed');
      await t.call('waitFrames', 30);
      const b = await counts();
      await t.call('teleport', home.x, home.y, home.z);
      t.assert(await meshed(), 'home area meshed again');
      await t.call('waitFrames', 30);
      const c = await counts();
      t.note('counts', { home: a, away: b, back: c });
      const maxSections = Math.ceil(Math.PI * 7 * 7 + 30) * 8;
      for (const s of [a, b, c]) {
        t.assert(s.sections === s.rendererSections, `world and renderer agree on live sections (${JSON.stringify(s)})`);
        t.assert(s.sections <= maxSections, `section meshes bounded (${s.sections} <= ${maxSections})`);
        t.assert(s.columns <= Math.ceil(Math.PI * 10.5 * 10.5) + 40, `columns bounded by R+4 (${s.columns})`);
      }
      t.assert(Math.abs(c.sections - a.sections) <= 16, `no leak: ${a.sections} -> ${c.sections}`);
      t.assert(c.geometries <= a.geometries + 16, `renderer geometries do not grow (${a.geometries} -> ${c.geometries})`);
    },
  },
  {
    name: 'corec-flight-stream',
    requires: ['world', 'lighting', 'mesher'],
    async run(t) {
      await t.call('startWorld', HILLS);
      await t.call('setRenderDistance', 6);
      await t.waitFor(() => window.__game.game.world.unmeshedWithin(6) === 0, null, 20000);
      // fly east at the creative cap (10.9 m/s) for 8 s; sample the backlog within R-1 every frame
      const r = await t.eval(async () => {
        const g = window.__game.game, w = g.world, p = g.player;
        const speed = 10.9, start = performance.now();
        let last = start, worstRun = 0, runStart = null, maxBacklog = 0, frames = 0;
        p.yaw = -Math.PI / 2; // look east (+X): yaw 0 = north, + turns left
        await new Promise((resolve) => {
          const step = (now) => {
            const dt = Math.min(0.1, (now - last) / 1000); last = now; frames++;
            p.prevX = p.x; p.x += speed * dt; p.y = 90;
            const backlog = w.unmeshedWithin(w.renderDistance - 1);
            maxBacklog = Math.max(maxBacklog, backlog);
            if (backlog > 0) { if (runStart === null) runStart = now; worstRun = Math.max(worstRun, now - runStart); } else runStart = null;
            if (now - start < 8000) requestAnimationFrame(step); else resolve();
          };
          requestAnimationFrame(step);
        });
        return { worstRunMs: Math.round(worstRun), maxBacklog, frames, distance: Math.round(p.x), fps: Math.round(frames / 8), stats: w.stats() };
      });
      t.note('flight', { worstRunMs: r.worstRunMs, maxBacklog: r.maxBacklog, fps: r.fps, distance: r.distance, streamMs: r.stats.streamMs, workers: r.stats.workers });
      await t.shot('corec-flight');
      t.assert(r.worstRunMs <= 1000, `no unmeshed column within R-1 for more than 1 s (worst ${r.worstRunMs} ms, max backlog ${r.maxBacklog})`);
    },
  },
  {
    name: 'corec-shapes',
    requires: ['world', 'lighting', 'mesher'],
    async run(t) {
      await installMeshHelper(t);
      await t.call('startWorld', FLAT);
      await t.waitFor(() => window.__game.game.world.unmeshedWithin(3) === 0, null, 10000);
      const p = await t.call('pos');
      const base = await t.eval(({ x, z, rows }) => {
        const g = window.__game.game, w = g.world, ID = window.__game.blockId;
        const bx = Math.floor(x) + 3, bz = Math.floor(z) - 12;
        const list = [];
        rows.forEach((row, r) => row.forEach(([name, state], i) => {
          const cx = bx + i * 2, cz = bz + r * 3;
          if (name === 'ladder') list.push([cx, 4, cz - 1, ID('stone')]);
          if (name === 'torch' && state > 0) { const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][state - 1]; list.push([cx + d[0], 4, cz + d[1], ID('stone')]); }
          if (name === 'oak_door') list.push([cx, 5, cz, ID('oak_door'), state | 8]);
          if (name === 'bed') { const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][state & 3]; if (!(state & 4)) list.push([cx + d[0], 4, cz + d[1], ID('bed'), state | 4]); }
          if (name === 'wheat' || name === 'carrots') list.push([cx, 3, cz, ID('farmland'), 7]);
          if (name === 'fire') list.push([cx, 3, cz, ID('stone')]);
          list.push([cx, 4, cz, ID(name), state]);
        }));
        w.setBlocks(list, { cause: 'test' });
        return { bx, bz };
      }, { x: p.x, z: p.z, rows: GALLERY });
      await t.call('waitFrames', 3);
      await t.call('teleport', base.bx + 9, 9.5, base.bz + 20);
      await t.call('lookAt', base.bx + 9, 4, base.bz + 6);
      await t.call('waitFrames', 3);
      const quads = await debugViewOn(t, { radius: 3 });
      await t.call('waitFrames', 3);
      await t.shot('corec-shapes');
      // close-ups: torches/ladder/doors (row 1) and stairs/fences (row 0)
      await t.call('teleport', base.bx + 6, 5.2, base.bz + 7);
      await t.call('lookAt', base.bx + 6, 4.5, base.bz + 3);
      await t.call('waitFrames', 3);
      await t.shot('corec-shapes-row1');
      await t.call('teleport', base.bx + 8, 6.5, base.bz + 4.5);
      await t.call('lookAt', base.bx + 8, 4.3, base.bz);
      await t.call('waitFrames', 3);
      await t.shot('corec-shapes-row0');
      await debugViewOff(t);
      t.assert(quads > 500, `gallery meshed (${quads} quads)`);
    },
  },
  {
    name: 'corec-debug-view',
    requires: ['world', 'lighting', 'mesher'],
    async run(t) {
      await installMeshHelper(t);
      await t.call('startWorld', HILLS);
      await t.waitFor(() => window.__game.game.world.unmeshedWithin(4) === 0, null, 15000);
      const p = await t.call('pos');
      // a little build: torches in a dark stone hut across a column border, glass, slabs, stairs, a fence, water
      await t.eval(({ x, y, z }) => {
        const g = window.__game.game, w = g.world, ID = window.__game.blockId;
        const bx = (Math.floor(x) & ~15) + 12, by = Math.floor(y) + 6, bz = Math.floor(z) + 6;
        const list = [];
        for (let dx = 0; dx < 8; dx++) for (let dz = 0; dz < 6; dz++) for (let dy = 0; dy < 5; dy++) {
          const wall = dx === 0 || dx === 7 || dz === 0 || dz === 5 || dy === 0 || dy === 4;
          list.push([bx + dx, by + dy, bz + dz, wall ? ID('cobblestone') : ID('air')]);
        }
        list.push([bx + 2, by + 1, bz + 2, ID('torch')]);
        list.push([bx + 3, by + 2, bz + 0, ID('glass')]);
        list.push([bx + 4, by + 2, bz + 0, ID('glass')]);
        for (let dx = 0; dx < 8; dx++) list.push([bx + dx, by + 5, bz + 2, ID('oak_slab')]);
        for (let dx = 0; dx < 4; dx++) list.push([bx + dx, by + 1, bz - 2, ID('oak_stairs'), 0]);
        for (let dx = 0; dx < 5; dx++) list.push([bx + dx, by + 1, bz - 4, ID('oak_fence'), 10]);
        list.push([bx - 3, by + 1, bz + 2, ID('glowstone')]);
        list.push([bx - 3, by + 2, bz + 4, ID('water')]);
        list.push([bx - 2, by + 1, bz + 4, ID('poppy')]);
        w.setBlocks(list, { cause: 'test' });
        g.__corecHut = { bx, by, bz };
      }, p);
      await t.call('waitFrames', 3);
      const hut = await t.eval(() => window.__game.game.__corecHut);
      await t.call('teleport', hut.bx - 9, hut.by + 4, hut.bz - 9);
      await t.call('lookAt', hut.bx + 3, hut.by + 1, hut.bz + 3);
      await t.call('waitFrames', 3);
      const quads = await debugViewOn(t, { radius: 4 });
      t.note('quads', quads);
      t.assert(quads > 1000, `debug view drew ${quads} quads`);
      await t.call('waitFrames', 3);
      await t.shot('corec-debug-outside');
      // inside the hut (torch-lit) and at night
      await debugViewOff(t);
      await t.call('teleport', hut.bx + 6, hut.by + 1, hut.bz + 4);
      await t.call('lookAt', hut.bx + 1, hut.by + 1, hut.bz + 1);
      await debugViewOn(t, { radius: 2, daylight: 0 });
      await t.call('waitFrames', 3);
      await t.shot('corec-debug-inside-night');
      await debugViewOff(t);
      await t.call('teleport', p.x, p.y + 30, p.z);
      await t.call('setLook', 45, -35);
      await debugViewOn(t, { radius: 5 });
      await t.call('waitFrames', 3);
      await t.shot('corec-debug-hills');
      await debugViewOff(t);
      const light = await t.eval(() => { const g = window.__game.game, h = g.__corecHut; return { inside: g.world.getLight(h.bx + 2, h.by + 2, h.bz + 2), corner: g.world.getLight(h.bx + 6, h.by + 3, h.bz + 4) }; });
      t.note('hutLight', light);
      t.assert((light.inside & 15) === 13 && (light.inside >> 4) < 15, `torch-lit hut: block light 13, sky only through the windows (${light.inside.toString(16)})`);
    },
  },
];

// Main-thread fallback (no workers): the same world streams, lights and meshes with sync work only.
SCENARIOS.push({
  name: 'corec-fallback',
  requires: ['world', 'lighting', 'mesher'],
  async run(t) {
    await t.eval(() => window.__game.game.world.disableWorkers('test: fallback'));
    await t.call('startWorld', HILLS);
    const ok = await t.waitFor(() => window.__game.game.world.unmeshedWithin(5) === 0, null, 20000);
    const s = await t.eval(() => window.__game.game.world.stats());
    t.note('world', { workers: s.workers, reason: s.workerReason, syncMeshes: s.syncMeshes, genAvgMs: +s.genAvgMs.toFixed(2), lightAvgMs: +s.lightAvgMs.toFixed(2), meshAvgMs: +s.meshAvgMs.toFixed(2), streamMs: s.streamMs });
    t.assert(ok, 'columns within 5 meshed on the main thread');
    t.assert(s.workers === 0 && s.syncMeshes > 0, 'fallback path used');
    const p = await t.call('pos');
    t.assert(await t.call('setBlock', Math.floor(p.x) + 2, Math.floor(p.y) + 3, Math.floor(p.z), 'glowstone'), 'edit works');
    await t.call('waitFrames', 2);
    await t.eval(() => window.__game.game.world.enableWorkers());
  },
});

export default SCENARIOS;
