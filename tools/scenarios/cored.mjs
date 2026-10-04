// OWNER LANE: CORE-D. Smoke scenarios for the renderer and sky (SPEC §13.2 CORE-D row):
// day vs night luma, fog hides pop-in (no seam at the horizon), outline visible (classic + kid), no remesh on
// setTime, context loss, draw-call budget + no geometry leak, entity materials (one draw per mob), edits
// visible in the same frame, underwater fog, settings reactions. Screenshots: .tmp/smoke-<tag>-cored-*.png
//
// These run against whatever world/worldgen/mesher are in the tree (stubs today), so they only require the
// renderer and sky lanes.

const REQ = ['renderer', 'sky'];
const FLAT = { preset: 'flat', seed: 1, mode: 'creative', difficulty: 'peaceful' };
const HILLS = { preset: 'default', seed: 12345, mode: 'creative', difficulty: 'peaceful' };
// spawn faces a lake with a tall mountain beyond the fog at yaw 0 (review CORE-R11: fogged silhouettes)
const PEAKS = { preset: 'default', seed: 4242, mode: 'creative', difficulty: 'peaceful' };

/** Wait until streaming has settled: no new section meshes for `quietMs`. */
async function settle(t, quietMs = 400, maxMs = 20000) {
  const end = Date.now() + maxMs;
  let last = -1, since = Date.now();
  while (Date.now() < end) {
    // quiet = no section uploads, no column re-merges, and no hot (edited) sections still waiting for the 3 s
    // fold back into their column (on a slow renderer streaming border updates keep folding for a while)
    const q = await t.eval(() => { const s = window.__game.game.renderer.getStats(); return { n: s.sectionSets * 100000 + s.merges, hot: s.hotSections || 0 }; });
    const n = q.n;
    if (n !== last || q.hot > 0) { last = n; since = Date.now(); } else if (Date.now() - since >= quietMs) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

/**
 * Freeze background block changes (MECH random ticks: growth, grass spreading under generated pumpkins...) so a
 * scenario that counts remeshes only sees its own. Returns a restore function. (LEAD integration: cross-lane
 * defect from MECH/FX/AUDIO/KID/INV - cored-daynight and cored-edit flaked with growth ticks on.)
 */
async function freezeWorld(t) {
  await t.eval(() => { const m = window.__game.game.mechanics; if (m && m.setRandomTicks) m.setRandomTicks(false); });
  return () => t.eval(() => { const m = window.__game.game.mechanics; if (m && m.setRandomTicks) m.setRandomTicks(true); });
}

/** Exact pixels of the current view (renderer.capturePixels) + summary stats. */
async function capture(t, w = 160, h = 90) {
  return t.eval(([w, h]) => {
    const c = window.__game.game.renderer.capturePixels(w, h);
    if (!c) return null;
    const d = c.data;
    let sum = 0, sum2 = 0, r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l; sum2 += l * l; r += d[i]; g += d[i + 1]; b += d[i + 2];
    }
    const n = d.length / 4;
    return { w, h, data: d, luma: sum / n, std: Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2)), rgb: [r / n, g / n, b / n] };
  }, [w, h]);
}

const uniform = (t, name) => t.eval((n) => {
  const u = window.__game.game.renderer.uniforms[n].value;
  return typeof u === 'number' ? u : u && u.isColor ? [u.r, u.g, u.b] : null;
}, name);

export default [
  {
    name: 'cored-render', requires: REQ,
    async run(t) {
      await t.call('startWorld', HILLS);
      await t.call('setTime', 6000);
      await t.call('setLook', 30, -20);
      await settle(t);
      await t.call('waitFrames', 5);
      const s = await t.call('stats');
      t.note('stats', { drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs, sectionMeshes: s.sectionMeshes, geometries: s.geometries, R: s.renderDistance });
      t.assert(s.drawCalls > 0, 'draw calls > 0');
      t.assert(s.triangles > 1000, `triangles > 1000 (got ${s.triangles})`);
      t.assert(s.sectionMeshes > 0, 'section meshes registered');
      const ex = await t.eval(() => window.__game.game.renderer.getStats());
      t.assert(ex.columnMeshes > 0, 'opaque/cutout merged per column');
      const px = await t.call('pixelStats');
      t.note('pixels', px);
      t.assert(px.uniqueColors > 40 && px.stdLuma > 8, `screen is not blank (${JSON.stringify(px)})`);
      await t.shot('cored-noon');
    },
  },
  {
    name: 'cored-daynight', requires: REQ,
    async run(t) {
      await t.call('startWorld', HILLS);
      const thaw = await freezeWorld(t);
      try {
      await t.call('setLook', 90, 5); // look west-ish over the hills with sky in view
      await settle(t);
      const before = await t.eval(() => { const s = window.__game.game.renderer.getStats(); return { sets: s.sectionSets, merges: s.merges }; });
      const out = {};
      for (const [name, time] of [['morning', 23500], ['noon', 6000], ['sunset', 12300], ['night', 18000]]) {
        await t.call('setTime', time);
        await t.call('waitFrames', 3);
        const c = await capture(t);
        out[name] = { luma: Math.round(c.luma), daylight: Math.round((await uniform(t, 'uDaylight')) * 100) / 100 };
        await t.shot(`cored-${name}`);
      }
      // sunset looking toward the sun (west) shows the glow
      await t.call('setTime', 12300);
      await t.call('setLook', 90, 8);
      await t.call('waitFrames', 3);
      await t.shot('cored-sunset-west');
      t.note('luma', out);
      t.assert(out.noon.daylight === 1 && out.night.daylight === 0, `daylight noon 1 / night 0 (${JSON.stringify(out)})`);
      t.assert(out.night.luma < out.noon.luma * 0.5, `night clearly darker than noon (${out.night.luma} vs ${out.noon.luma})`);
      t.assert(out.morning.luma > out.night.luma && out.morning.luma < out.noon.luma + 5, 'morning between night and noon');
      const after = await t.eval(() => { const s = window.__game.game.renderer.getStats(); return { sets: s.sectionSets, merges: s.merges }; });
      t.note('remesh', { before, after });
      t.assert(after.sets === before.sets && after.merges === before.merges, `setTime never remeshes (${JSON.stringify({ before, after })})`);
      await t.call('setTime', 6000);
      } finally { await thaw(); }
    },
  },
  {
    name: 'cored-fog', requires: REQ,
    async run(t) {
      await t.call('startWorld', HILLS);
      await settle(t);
      const f = await t.eval(() => {
        const g = window.__game.game, r = g.renderer, w = g.world;
        const R = w.renderDistance, near = r.uniforms.uFogNear.value, far = r.uniforms.uFogFar.value;
        // For every render distance 3..12: the nearest point of any column that is NOT meshed (outside the circular
        // mesh radius R + MESH_MARGIN) seen from the WORST player position inside its column, and how fogged it is
        // (the shader's linear land ramp from FOG_START * fogFar to fogFar).
        const lin = (d, n, fa) => Math.min(1, Math.max(0, (d - n) / (fa - n)));
        const worst = {};
        let minFog = 1;
        for (let RR = 3; RR <= 12; RR++) {
          const fa = (RR - 0.5) * 16, n = fa * 0.8, M = RR + 1;
          let dMin = Infinity;
          for (const [px, pz] of [[0, 0], [16, 0], [0, 16], [16, 16], [8, 8]]) {
            for (let dx = -M - 2; dx <= M + 2; dx++) for (let dz = -M - 2; dz <= M + 2; dz++) {
              if (dx * dx + dz * dz <= M * M) continue;
              const x0 = dx * 16, z0 = dz * 16;
              const nx = Math.max(x0, Math.min(px, x0 + 16)), nz = Math.max(z0, Math.min(pz, z0 + 16));
              dMin = Math.min(dMin, Math.hypot(nx - px, nz - pz));
            }
          }
          worst[RR] = Math.round(lin(dMin, n, fa) * 100) / 100;
          minFog = Math.min(minFog, worst[RR]);
        }
        return { R, near, far, camFar: r.camera.far, worst, fogAtGap: minFog };
      });
      t.note('fog', f);
      t.assert(Math.abs(f.far - (f.R - 0.5) * 16) < 1e-6 && Math.abs(f.near - f.far * 0.8) < 1e-6, 'fog distances follow the render distance (linear from 0.8 * fogFar)');
      t.assert(Math.abs(f.camFar - (f.far + 32)) < 1e-6, 'camera far = fogFar + 32');
      t.assert(f.fogAtGap >= 0.999, `for every R the nearest missing column lies past fogFar, fully fogged (${JSON.stringify(f.worst)})`);
      // the live world really meshes one ring beyond R: the columns between R and R + 1 are meshed once settled
      const ring = await t.eval(() => {
        const g = window.__game.game, w = g.world, R = w.renderDistance;
        const pcx = Math.floor(g.player.x) >> 4, pcz = Math.floor(g.player.z) >> 4;
        let n = 0, meshed = 0;
        for (let dx = -R - 1; dx <= R + 1; dx++) for (let dz = -R - 1; dz <= R + 1; dz++) {
          const d2 = dx * dx + dz * dz;
          if (d2 <= R * R || d2 > (R + 1) * (R + 1)) continue;
          n++;
          const c = w.getColumn(pcx + dx, pcz + dz);
          if (c && c.state === 3) meshed++;
        }
        return { n, meshed };
      });
      t.note('ringBeyondR', ring);
      t.assert(ring.n > 0 && ring.meshed >= ring.n * 0.9, `the ring just beyond R is meshed (${ring.meshed}/${ring.n})`);
      // fog cull (reviews CORE-R10, CORE-R11): fully fogged geometry past fogFar is hidden only where the sky behind
      // it is the fog colour, so the picture never changes; fogged silhouettes rising above the horizon stay
      const fogCull = () => t.eval(() => {
        const g = window.__game.game, r = g.renderer;
        // same frame, same uTime: the picture with the cull must equal the picture without it. Streaming between the
        // two captures would also change pixels, so the section / merge counters must not move in between.
        const cnt = () => { const st = r.getStats(); return st.sectionSets * 100000 + st.merges; };
        const c0 = cnt();
        r.fogCull = false;
        const W = 640, H = 360;
        const off = r.capturePixels(W, H);
        const drawsOff = r.getStats().drawCalls;
        r.fogCull = true;
        const on = r.capturePixels(W, H);
        const st = r.getStats();
        const streamed = cnt() !== c0;
        const fc = r.uniforms.uFogColor.value, fog = [fc.r * 255, fc.g * 255, fc.b * 255];
        const isFog = (d, i) => Math.abs(d[i] - fog[0]) <= 1.01 && Math.abs(d[i + 1] - fog[1]) <= 1.01 && Math.abs(d[i + 2] - fog[2]) <= 1.01;
        // the horizon row on screen; pure fog-colour pixels well above it can only be fully fogged silhouettes
        const cam = r.camera, e = cam.matrixWorld.elements, far = r.uniforms.uFogFar.value;
        const fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz) || 1;
        const v = cam.position.clone().set(e[12] + fx / fl * 1000, e[13], e[14] + fz / fl * 1000).project(cam);
        const horizonRow = Math.round((1 - v.y) / 2 * H);
        let diff = 0, silhouette = 0;
        for (let i = 0; i < on.data.length; i += 4) {
          if (Math.floor(i / 4 / W) < horizonRow - 12 && isFog(off.data, i)) silhouette++;
          if (on.data[i] !== off.data[i] || on.data[i + 1] !== off.data[i + 1] || on.data[i + 2] !== off.data[i + 2]) diff++;
        }
        let keptBeyond = 0, hiddenNear = 0, meshes = 0, hidden = 0;
        r.worldGroup.traverse((o) => {
          if (!o.isMesh) return;
          meshes++;
          const x0 = o.matrixWorld.elements[12], z0 = o.matrixWorld.elements[14];
          const dx = Math.max(x0 - e[12], 0, e[12] - x0 - 16), dz = Math.max(z0 - e[14], 0, e[14] - z0 - 16);
          const d = Math.hypot(dx, dz);
          if (!o.visible) hidden++;
          if (o.visible && d > far + 0.501) keptBeyond++;
          if ((!o.visible || o.geometry.drawRange.start > 0) && d < far) hiddenNear++;
        });
        return { far, streamed, meshes, hidden, keptBeyond, hiddenNear, fogCulled: st.fogCulled, fogTrimmed: st.fogTrimmed, drawsOff, drawsOn: st.drawCalls, diffPixels: diff, horizonRow, silhouettePx: silhouette };
      });
      const fogCullSettled = async () => {
        let c = await fogCull();
        for (let k = 0; k < 5 && c.streamed; k++) { await settle(t); c = await fogCull(); }
        return c;
      };
      const cull = await fogCullSettled();
      t.note('fogCull', cull);
      t.assert(!cull.streamed, 'nothing streamed between the two captures');
      t.assert(cull.fogCulled + cull.fogTrimmed > 0 && cull.hiddenNear === 0, `columns past the fog are cut (${cull.fogCulled} hidden, ${cull.fogTrimmed} trimmed), nothing inside fogFar is (${cull.hiddenNear})`);
      t.assert(cull.diffPixels === 0, `the fog cull does not change the picture at ground level (${cull.diffPixels} pixels changed)`);
      // no seam at the horizon: from high up, the band around the horizon is the fog colour (terrain and sky)
      const p = await t.call('pos');
      await t.call('teleport', p.x, 120, p.z);
      await t.call('setLook', 45, 0);
      await t.call('waitFrames', 4);
      const fog = (await uniform(t, 'uFogColor')).map((v) => v * 255);
      const c = await capture(t, 160, 90);
      let dev = 0, n = 0;
      for (let y = 43; y <= 46; y++) for (let x = 0; x < 160; x++) {
        const i = (y * 160 + x) * 4;
        dev += Math.abs(c.data[i] - fog[0]) + Math.abs(c.data[i + 1] - fog[1]) + Math.abs(c.data[i + 2] - fog[2]); n += 3;
      }
      t.note('horizonDev', Math.round((dev / n) * 10) / 10);
      t.assert(dev / n < 6, `horizon band matches the fog colour (mean dev ${(dev / n).toFixed(1)})`);
      // looking down from high up the far columns lie below the horizon: they are not drawn, and no pixel changes
      await t.call('setLook', 45, -20);
      await t.call('waitFrames', 4);
      const cullHigh = await fogCullSettled();
      t.note('fogCullHigh', cullHigh);
      t.assert(cullHigh.hidden > 0 && cullHigh.drawsOn < cullHigh.drawsOff && cullHigh.hiddenNear === 0, `from high up columns past the fog are not drawn (${cullHigh.hidden} of ${cullHigh.meshes} meshes hidden, draws ${cullHigh.drawsOff} -> ${cullHigh.drawsOn})`);
      t.assert(cullHigh.diffPixels === 0, `fog cull from high up: no pixel changed (${cullHigh.diffPixels})`);
      await t.call('setLook', 45, 0);
      await t.call('waitFrames', 2);
      await t.shot('cored-horizon');
      // ground level: distant terrain melts into the sky
      await t.call('teleport', p.x, p.y, p.z);
      await t.call('setLook', 135, 2);
      await t.call('waitFrames', 4);
      await t.shot('cored-fog-ground');
      // review CORE-R11: a view WITH fogged silhouettes (a tall mountain past fogFar against the sunset sky, looking
      // toward the sun). They must stay, and the cull must still change no pixel.
      await t.call('startWorld', PEAKS);
      await t.call('setFlying', true);
      const sp = await t.call('pos');
      await t.call('teleport', sp.x, sp.y + 0.2, sp.z);
      await t.call('setTime', 12300);
      await t.call('setLook', 0, 2);
      await t.waitFor(() => window.__game.game.world.unmeshedWithin(window.__game.game.world.renderDistance + 1) === 0, null, 40000);
      await settle(t);
      const cullPeak = await fogCullSettled();
      t.note('fogCullSilhouette', cullPeak);
      t.assert(cullPeak.silhouettePx > 500 && cullPeak.keptBeyond > 0, `the view has fully fogged silhouettes above the horizon (${cullPeak.silhouettePx} px, ${cullPeak.keptBeyond} meshes past fogFar kept)`);
      t.assert(!cullPeak.streamed && cullPeak.hiddenNear === 0 && cullPeak.diffPixels === 0, `the fog cull keeps them: ${cullPeak.diffPixels} pixels changed`);
      await t.shot('cored-fog-silhouette');
      await t.call('setTime', 6000);
    },
  },
  {
    name: 'cored-outline', requires: REQ,
    async run(t) {
      await t.call('startWorld', FLAT);
      const p = await t.call('pos');
      const bx = Math.floor(p.x), bz = Math.floor(p.z) - 3;
      await t.call('lookAt', bx + 0.5, 3.5, bz + 0.5);
      await t.call('waitFrames', 3);
      // capture without / with the highlight in ONE page task so nothing else moves between the two frames
      const diff = (controls) => t.eval(([controls, x, z]) => {
        const api = window.__game, R = api.game.renderer;
        api.setSetting('controls', controls);
        R.setHighlight(null);
        // full canvas resolution: a 1 px classic line is easily skipped by a nearest-neighbour downscale
        const cw = R.three.domElement.width, chh = R.three.domElement.height;
        const a = R.capturePixels(cw, chh);
        R.setHighlight({ x, y: 3, z, boxes: [[0, 0, 0, 1, 1, 1]] });
        const b = R.capturePixels(cw, chh);
        let changed = 0, white = 0, dark = 0;
        for (let i = 0; i < a.data.length; i += 4) {
          const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
          if (d > 24) {
            changed++;
            if (b.data[i] > 235 && b.data[i + 1] > 235 && b.data[i + 2] > 235) white++;
            if (b.data[i] + b.data[i + 1] + b.data[i + 2] < a.data[i] + a.data[i + 1] + a.data[i + 2]) dark++;
          }
        }
        return { changed, white, dark };
      }, [controls, bx, bz]);
      const classic = await diff('classic');
      await t.shot('cored-outline-classic');
      const kid = await diff('kid');
      await t.shot('cored-outline-kid');
      t.note('outline', { classic, kid });
      t.assert(classic.changed > 40 && classic.dark > classic.changed * 0.8, `classic outline: thin dark lines (${JSON.stringify(classic)})`);
      t.assert(kid.changed > classic.changed * 2 && kid.white > 60, `kid outline: thick white-on-black (${JSON.stringify(kid)})`);
      await t.eval(() => window.__game.game.renderer.setHighlight(null));
    },
  },
  {
    name: 'cored-edit', requires: REQ,
    async run(t) {
      await t.call('startWorld', FLAT);
      const thaw = await freezeWorld(t);
      try {
      await settle(t);
      const p = await t.call('pos');
      const bx = Math.floor(p.x) + 1, bz = Math.floor(p.z) - 4;
      await t.call('lookAt', bx + 0.5, 4.5, bz + 0.5);
      await t.call('waitFrames', 3);
      const a = await capture(t, 160, 90);
      // edit + ONE synchronous frame (runTicks(0) = world.frame remesh + renderer.frame): visible immediately
      const s = await t.eval(([x, z]) => {
        const g = window.__game.game;
        g.world.setBlock(x, 4, z, window.__game.blockId('gold_block'), 0, { cause: 'test' });
        g.stepTicks(0);
        return g.renderer.getStats();
      }, [bx, bz]);
      const b = await capture(t, 160, 90);
      let changed = 0;
      for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 30) changed++;
      t.note('edit', { changed, hot: s.hotSections, hotUploads: s.hotUploads });
      t.assert(changed > 30, `the placed block is visible in the same frame (${changed} px changed)`);
      t.assert(s.hotSections >= 1 && s.hotUploads >= 1, 'edited section drawn as a hot mesh with a partial upload');
      await t.shot('cored-edit');
      const ok = await t.waitFor(() => window.__game.game.renderer.getStats().hotSections === 0, null, 6000);
      t.assert(ok, 'hot sections are folded back into the column mesh after the edit settles');
      const c = await capture(t, 160, 90);
      let diff2 = 0;
      for (let i = 0; i < b.data.length; i++) diff2 += Math.abs(b.data[i] - c.data[i]);
      t.note('afterCompaction', diff2 / b.data.length);
      t.assert(diff2 / b.data.length < 1, 'compaction does not change the picture');
      } finally { await thaw(); }
    },
  },
  {
    name: 'cored-underwater', requires: REQ,
    async run(t) {
      await t.call('startWorld', FLAT);
      const p = await t.call('pos');
      const x0 = Math.floor(p.x), z0 = Math.floor(p.z);
      // a 13x13 pool, 6 deep, dug into raised sand walls so the camera can sit inside the water
      await t.eval(([x0, z0]) => {
        const g = window.__game.game, W = window.__game;
        const water = W.blockId('water'), sand = W.blockId('sand'), stone = W.blockId('stone');
        const list = [];
        for (let x = x0 - 8; x <= x0 + 8; x++) for (let z = z0 - 8; z <= z0 + 8; z++) {
          const edge = Math.abs(x - x0) > 6 || Math.abs(z - z0) > 6;
          list.push([x, 3, z, sand]);
          for (let y = 4; y <= 9; y++) list.push([x, y, z, edge ? stone : water]);
        }
        g.world.setBlocks(list, { cause: 'test' });
      }, [x0, z0]);
      await t.call('teleport', p.x, 6, p.z);
      await t.call('setLook', 20, -10);
      await settle(t, 300, 8000);
      await t.call('waitFrames', 4);
      const st = await t.eval(() => { const r = window.__game.game.renderer; return { medium: r.eyeMedium, far: r.uniforms.uFogFar.value, trans: r.getStats().translucentMeshes }; });
      const c = await capture(t);
      t.note('underwater', { ...st, rgb: c.rgb.map(Math.round) });
      t.assert(st.medium === 'water' && st.far === 20, `underwater fog active (${JSON.stringify(st)})`);
      if (!t.stubs.includes('mesher')) t.assert(st.trans > 0, 'water is drawn in the translucent pass');
      else t.note('translucent', 'mesher stub does not mesh liquids yet');
      t.assert(c.rgb[2] > c.rgb[0] * 1.5, 'the view is blue underwater');
      await t.shot('cored-underwater');
      // from above: the surface is translucent and the pool floor shows through
      await t.call('teleport', p.x, 13, p.z + 9);
      await t.call('setLook', 0, -40);
      await t.call('waitFrames', 4);
      const above = await t.eval(() => window.__game.game.renderer.eyeMedium);
      t.assert(above === 'air', 'fog back to normal above the water');
      await t.shot('cored-water');
    },
  },
  {
    name: 'cored-translucent', requires: REQ,
    async run(t) {
      // A synthetic translucent section (two stacked water sheets + a stained-glass wall) through the frozen
      // setSectionMesh contract: drawn in the translucent pass, quads sorted back to front near the eye.
      await t.call('startWorld', FLAT);
      await settle(t);
      const r = await t.eval(async () => {
        const api = window.__game, g = api.game, R = g.renderer, p = g.player;
        const cx = Math.floor(p.x) >> 4, cz = Math.floor(p.z) >> 4;
        const quads = [];
        const water = g.textures.layer('water'), glass = g.textures.layer('red_stained_glass');
        for (const y of [4, 6]) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
          quads.push({ c: [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], [x, y, z]], layer: water, flags: 2 | (1 << 3) | (3 << 5), shade: 255 });
        }
        for (let x = 4; x < 12; x++) for (let y = 0; y < 3; y++) quads.push({ c: [[x, y, 12], [x + 1, y, 12], [x + 1, y + 1, 12], [x, y + 1, 12]], layer: glass, flags: 4, shade: 204 });
        const n = quads.length;
        const mb = { position: new Float32Array(n * 12), tex: new Uint16Array(n * 16), light: new Uint8Array(n * 16), quads: n };
        const uv = [[0, 256], [256, 256], [256, 0], [0, 0]];
        quads.forEach((q, i) => q.c.forEach((v, k) => {
          mb.position.set(v, i * 12 + k * 3);
          mb.tex.set([q.layer, uv[k][0], uv[k][1], q.flags], i * 16 + k * 4);
          mb.light.set([240, 0, 3, q.shade], i * 16 + k * 4);
        }));
        R.setSectionMesh(cx, 1, cz, { opaque: null, cutout: null, translucent: mb });
        api.teleport(cx * 16 + 8, 24, cz * 16 - 6);
        api.setLook(180, -35);
        await api.waitFrames(3);
        const st = R.getStats();
        const m = R.worldGroup.children.find((o) => o.name === `s${cx},1,${cz}:2`);
        const idx = m ? m.geometry.index.array : null;
        // first drawn quad must be on the lower sheet (y 4 => world 20) and farther than the last one
        const cy = (q) => m.userData.centers[q * 3 + 1];
        const first = idx ? idx[0] / 4 : -1, last = idx ? idx[idx.length - 6] / 4 : -1;
        return { trans: st.translucentMeshes, sorts: st.quadSorts, firstY: m ? cy(first) : null, lastY: m ? cy(last) : null, transparent: m ? m.material.transparent : null, depthWrite: m ? m.material.depthWrite : null };
      });
      t.note('translucent', r);
      t.assert(r.trans >= 1 && r.transparent === true && r.depthWrite === false, `translucent pass mesh (${JSON.stringify(r)})`);
      t.assert(r.sorts >= 1, 'quads sorted near the eye');
      t.assert(r.firstY < r.lastY, 'farther (lower) sheet drawn first when seen from above');
      await t.shot('cored-translucent');
    },
  },
  {
    name: 'cored-context', requires: REQ,
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('waitFrames', 5);
      t.assert(await t.call('contextLossTest'), 'context loss/restore ran');
      const f0 = (await t.call('stats')).frames;
      await t.call('waitFrames', 10);
      t.assert((await t.call('stats')).frames > f0, 'frames continue after restore');
      const s = await t.eval(() => window.__game.game.renderer.getStats());
      t.assert(s.contextLosses >= 1 && s.contextRestores >= 1 && s.contextLost === false, 'loss and restore observed');
      t.assert(!(await t.eval(() => window.__game.game.renderer.contextLost)), 'renderer resumed');
      const px = await t.call('pixelStats');
      t.note('pixels', px);
      t.assert(px.uniqueColors > 10 && px.stdLuma > 4, 'still rendering terrain after restore');
      t.assert(!(await t.eval(() => !!document.getElementById('bc-context-lost'))), 'no reload overlay after a quick restore');
      await t.shot('cored-context');
    },
  },
  {
    name: 'cored-perf', requires: REQ,
    async run(t) {
      await t.call('startWorld', { preset: 'default', seed: 777, mode: 'creative' });
      await t.eval(() => window.__game.game.world.setRenderDistance(6));
      await t.call('setLook', 0, -10);
      await settle(t, 600);
      await t.call('waitFrames', 10);
      const s6 = await t.call('stats');
      t.note('R6', { drawCalls: s6.drawCalls, triangles: s6.triangles, sections: s6.sectionMeshes, geometries: s6.geometries, workMs: s6.workMs, fps: s6.fps });
      t.assert(s6.drawCalls <= 300, `draw calls at R 6 within budget (${s6.drawCalls})`);
      // leak check: 20 columns away and back
      const p = await t.call('pos');
      await t.call('teleport', p.x + 320, p.y, p.z);
      await settle(t, 600);
      await t.call('teleport', p.x, p.y, p.z);
      await settle(t, 600);
      await t.call('waitFrames', 10);
      const back = await t.call('stats');
      t.note('back', { geometries: back.geometries, sections: back.sectionMeshes, drawCalls: back.drawCalls });
      t.assert(back.geometries <= s6.geometries * 1.15 + 10, `no geometry leak after streaming away and back (${s6.geometries} -> ${back.geometries})`);
    },
  },
  {
    name: 'cored-entity', requires: REQ,
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('setLook', 0, -10);
      await t.call('waitFrames', 3);
      const r = await t.eval(async () => {
        const g = window.__game.game, R = g.renderer;
        const geoCtor = R.worldGroup.children[0].geometry.constructor;
        const attrCtor = R.worldGroup.children[0].geometry.attributes.position.constructor;
        const meshCtor = R.worldGroup.children[0].constructor;
        // 4 boxes (24 verts each) merged into ONE geometry with a per-vertex part index
        const pos = [], norm = [], part = [], idx = [];
        for (let b = 0; b < 4; b++) {
          const ox = b * 0.6;
          const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
          for (const n of faces) {
            const base = pos.length / 3;
            const u = n[0] ? [0, 1, 0] : [1, 0, 0], v = n[2] ? [0, 1, 0] : n[1] ? [0, 0, 1] : [0, 0, 1];
            for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
              pos.push(ox + 0.25 * (n[0] + su * u[0] + sv * v[0]), 0.25 * (n[1] + su * u[1] + sv * v[1]) + 0.5, 0.25 * (n[2] + su * u[2] + sv * v[2]));
              norm.push(...n); part.push(b);
            }
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
        const geo = new geoCtor();
        geo.setAttribute('position', new attrCtor(new Float32Array(pos), 3));
        geo.setAttribute('normal', new attrCtor(new Float32Array(norm), 3));
        geo.setAttribute('aPart', new attrCtor(new Uint8Array(part), 1));
        geo.setIndex(idx);
        const mat = R.createEntityMaterial({ color: 0xf0a0a0, parts: 4 });
        const clone = mat.clone();
        const shares = clone.uniforms.uDaylight === R.uniforms.uDaylight && clone.uniforms.uFogColor === R.uniforms.uFogColor;
        const own = clone.uniforms.uLightSky !== mat.uniforms.uLightSky && clone.uniforms.uParts.value[0] !== mat.uniforms.uParts.value[0];
        const p = g.player;
        const before = R.capturePixels(8, 8) && R.getStats().drawCalls;
        const mob = new meshCtor(geo, clone);
        mob.position.set(p.x - 0.6, p.y, p.z - 3);
        clone.uniforms.uParts.value[1].makeTranslation(0, 0.4, 0);
        clone.uniforms.uTint.value.set(1, 0, 0, 0.4);
        R.addObject(mob);
        R.capturePixels(8, 8);
        const after = R.getStats().drawCalls;
        const block = R.createBlockModel(window.__game.blockId('oak_log'));
        block.position.set(p.x + 1.5, p.y, p.z - 3);
        R.addObject(block);
        R.capturePixels(8, 8);
        const withBlock = R.getStats().drawCalls;
        g.__coredEntityTest = [mob, block];
        return { shares, own, before, after, withBlock, keep: true };
      });
      t.note('entity', r);
      t.assert(r.shares && r.own, 'material clones share global uniforms and own their light/pose');
      t.assert(r.after - r.before === 1, `a 4-part mob is ONE draw call (${r.before} -> ${r.after})`);
      t.assert(r.withBlock - r.after === 1, 'a block model is one draw call');
      await t.call('waitFrames', 3);
      await t.shot('cored-entity');
      // integration: take the test objects out again (the renderer never clears dynamic objects on world exit -
      // their owner does), so later scenarios do not see a red test mob and a floating log
      await t.eval(() => {
        const g = window.__game.game;
        for (const o of g.__coredEntityTest || []) { g.renderer.removeObject(o); o.geometry.dispose(); o.material.dispose(); }
        g.__coredEntityTest = null;
      });
    },
  },
  {
    name: 'cored-settings', requires: REQ,
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('setSetting', 'brightness', 1);
      t.assert(Math.abs((await uniform(t, 'uMinLight')) - 0.2) < 1e-6 && (await uniform(t, 'uGamma')) === 1, 'brightness 1 => min light 0.20, full brightness curve');
      await t.call('setSetting', 'brightness', 0.7);
      t.assert(Math.abs((await uniform(t, 'uMinLight')) - 0.155) < 1e-6 && Math.abs((await uniform(t, 'uGamma')) - 0.7) < 1e-6, 'brightness 0.7 => min light 0.155, curve 0.7');
      await t.call('setSetting', 'waving', false);
      t.assert((await uniform(t, 'uWave')) === 0, 'waving off');
      await t.call('setSetting', 'waving', true);
      t.assert((await uniform(t, 'uWave')) === 1, 'waving on');
      const up0 = await t.eval(() => window.__game.game.renderer.getStats().textureUploads);
      await t.call('setSetting', 'fancyLeaves', false);
      await t.call('waitFrames', 5);
      await t.call('setSetting', 'fancyLeaves', true);
      await t.call('waitFrames', 5);
      const up1 = await t.eval(() => window.__game.game.renderer.getStats().textureUploads);
      t.assert(up1 === up0 + 2, `fancyLeaves rebuilds and re-uploads the array texture (${up0} -> ${up1})`);
      const dbg = await t.eval(() => { const r = window.__game.game.renderer; const on = r.toggleDebug(true); const txt = document.getElementById('bc-debug').textContent; r.toggleDebug(false); return { on, txt }; });
      t.assert(dbg.on && /draws \d+/.test(dbg.txt), 'F3 debug overlay shows stats');
    },
  },
];
