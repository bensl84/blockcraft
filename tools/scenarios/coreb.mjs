// OWNER LANE: CORE-B (worldgen). Smoke scenarios for the real worldgen in the real browser build (SPEC §5.2, §13.2).
// Shape: { name, requires, run(t) } - see tools/scenarios/lead.mjs for the t.* helpers.

/** Block colours for the in-page top-down map (block name -> #rrggbb). Anything else falls back to grey. */
const MAP_COLORS = {
  grass_block: '#68aa40', dirt: '#866043', stone: '#7d7d7d', sand: '#dbd3a0', sandstone: '#d8cb94', gravel: '#857f7c',
  water: '#3263c8', ice: '#9cc4f4', snow: '#f5f8fc', clay: '#a0a6b4', oak_leaves: '#3f7a24', birch_leaves: '#6a9a45',
  spruce_leaves: '#2f5236', oak_log: '#6b5131', birch_log: '#d7d3c8', spruce_log: '#3b2a17', short_grass: '#5a9a33',
  fern: '#4a7a3a', dead_bush: '#7a5a2a', dandelion: '#f5d214', poppy: '#d42a1e', cornflower: '#4a6ae0', blue_orchid: '#2ab4e6',
  allium: '#b45ad8', lily_of_the_valley: '#f0f0f0', orange_tulip: '#f08c1e', pink_tulip: '#f0a0c8', sugar_cane: '#8ac65a',
  cactus: '#2e7426', pumpkin: '#e08a1e', melon: '#7aa82a', brown_mushroom: '#9a7a5a', red_mushroom: '#c8302a', lava: '#ff7a10',
};

/** Draw a top-down map of the loaded world around the player into a fixed overlay canvas; returns stats. */
async function drawMap(t, radius, scale) {
  const ids = {};
  for (const name of Object.keys(MAP_COLORS)) ids[name] = await t.call('blockId', name);
  return t.eval(({ ids, colors, radius, scale }) => {
    const game = window.__game.game, w = game.world;
    const byId = new Map();
    for (const [n, id] of Object.entries(ids)) byId.set(id, colors[n]);
    const px = Math.floor(game.player.x), pz = Math.floor(game.player.z);
    const size = radius * 2 + 1;
    const cv = document.createElement('canvas');
    cv.id = 'coreb-map'; cv.width = size * scale; cv.height = size * scale;
    Object.assign(cv.style, { position: 'fixed', left: '0', top: '0', zIndex: 99999, imageRendering: 'pixelated', width: Math.min(720, size * scale) + 'px' });
    const g = cv.getContext('2d');
    const counts = {}, biomes = {};
    let prevH = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = px + dx, z = pz + dz;
        let y = 127;
        while (y > 0 && w.getBlock(x, y, z) === 0) y--;
        const id = w.getBlock(x, y, z);
        let col = byId.get(id) || '#999999';
        counts[id] = (counts[id] || 0) + 1;
        const c = w.getColumn(x >> 4, z >> 4);
        if (c) { const b = c.biomes[(x & 15) + (z & 15) * 16]; biomes[b] = (biomes[b] || 0) + 1; }
        // simple hill shading from the west neighbour
        const shade = Math.max(-40, Math.min(40, (y - prevH) * 14)); prevH = y;
        const n = parseInt(col.slice(1), 16);
        const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + shade)), gg = Math.max(0, Math.min(255, ((n >> 8) & 255) + shade)), b = Math.max(0, Math.min(255, (n & 255) + shade));
        g.fillStyle = `rgb(${r},${gg},${b})`;
        g.fillRect((dx + radius) * scale, (dz + radius) * scale, scale, scale);
      }
    }
    g.fillStyle = '#ff00ff';
    g.fillRect(radius * scale - scale, radius * scale - scale, scale * 3, scale * 3);
    document.body.appendChild(cv);
    return { counts, biomes };
  }, { ids, colors: MAP_COLORS, radius, scale });
}

async function removeMap(t) { await t.eval(() => { const c = document.getElementById('coreb-map'); if (c) c.remove(); }); }

/** Check the spawn cell in the live world: feet on grass (or snow on grass), head free, no water close by. */
async function checkSpawn(t, label) {
  const p = await t.call('pos');
  const bx = Math.floor(p.x), bz = Math.floor(p.z), fy = Math.floor(p.y + 0.01);
  const below = await t.call('getBlock', bx, fy - 1, bz);
  const feet = await t.call('getBlock', bx, fy, bz);
  const head = await t.call('getBlock', bx, fy + 1, bz);
  t.note(label + 'Spawn', { x: p.x, y: p.y, z: p.z, below, feet, head });
  t.assert(below === 'grass_block' || (below === 'snow' || feet === 'snow'), `${label}: spawn on grass (below=${below}, feet=${feet})`);
  t.assert(head === 'air', `${label}: head is free (${head})`);
  const water = await t.eval(([bx, fy, bz]) => {
    const w = window.__game.game.world, wid = window.__game.blockId('water');
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let y = fy - 3; y <= fy; y++) if (w.getBlock(bx + dx, y, bz + dz) === wid) return true;
    return false;
  }, [bx, fy, bz]);
  t.assert(!water, `${label}: no water within 3 blocks of the spawn`);
  return p;
}

export default [
  {
    name: 'coreb-default-world',
    requires: ['worldgen'],
    async run(t) {
      const t0 = Date.now();
      await t.call('startWorld', { preset: 'default', seed: 12345, mode: 'creative', difficulty: 'peaceful' });
      t.note('worldReadyMs', Date.now() - t0);
      const meta = await t.call('meta');
      t.assert(meta.spawn && meta.spawn.y > 48, `spawn above sea level (${JSON.stringify(meta.spawn)})`);
      await checkSpawn(t, 'default');
      const s = await t.call('stats');
      t.note('genAvgMs', await t.eval(() => { const st = window.__game.game.world.stats(); return Math.round(st.genAvgMs * 1000) / 1000; }));
      t.note('chunksLoaded', s.chunksLoaded);
      // bedrock floor, ores somewhere below, water at sea level somewhere around
      const under = await t.eval(() => {
        const w = window.__game.game.world, api = window.__game;
        const p = window.__game.game.player;
        const px = Math.floor(p.x), pz = Math.floor(p.z);
        const ores = new Set(['coal_ore', 'iron_ore', 'gold_ore', 'redstone_ore', 'diamond_ore', 'lapis_ore'].map((n) => api.blockId(n)));
        let bedrock = 0, ore = 0, cave = 0, cells = 0;
        for (let dx = -24; dx <= 24; dx++) for (let dz = -24; dz <= 24; dz++) {
          if (w.getBlock(px + dx, 0, pz + dz) === api.blockId('bedrock')) bedrock++;
          cells++;
          for (let y = 1; y < 50; y++) { const id = w.getBlock(px + dx, y, pz + dz); if (ores.has(id)) ore++; else if (id === 0 && y < 40) cave++; }
        }
        return { bedrock, cells, ore, cave };
      });
      t.note('underground', under);
      t.assert(under.bedrock === under.cells, 'bedrock floor everywhere at y 0');
      t.assert(under.ore > 20, `ores underground (${under.ore})`);
      t.assert(under.cave > 50, `caves underground (${under.cave})`);
      const map = await drawMap(t, 48, 6);
      t.note('biomesAroundSpawn', Object.keys(map.biomes).length);
      await t.shot('coreb-map-default');
      await removeMap(t);
    },
  },
  {
    name: 'coreb-presets',
    requires: ['worldgen'],
    async run(t) {
      await t.call('startWorld', { preset: 'flat', seed: 1, mode: 'creative', difficulty: 'peaceful' });
      const pf = await t.call('pos');
      t.assert(Math.abs(pf.y - 4) < 0.01, `flat spawn feet at y 4 (${pf.y})`);
      t.assert(await t.call('getBlock', 0, 3, 0) === 'grass_block' && await t.call('getBlock', 0, 0, 0) === 'bedrock', 'flat layout');
      await t.call('startWorld', { preset: 'snowy', seed: 7, mode: 'creative', difficulty: 'peaceful' });
      await checkSpawn(t, 'snowy');
      const snowMap = await drawMap(t, 40, 6);
      await t.shot('coreb-map-snowy');
      await removeMap(t);
      t.assert(Object.keys(snowMap.biomes).every((b) => b === '3'), 'snowy preset: every loaded cell is the snowy biome');
      await t.call('startWorld', { preset: 'islands', seed: 5, mode: 'creative', difficulty: 'peaceful' });
      await checkSpawn(t, 'islands');
      const isl = await drawMap(t, 48, 6);
      await t.shot('coreb-map-islands');
      await removeMap(t);
      const water = isl.counts[await t.call('blockId', 'water')] || 0;
      t.note('islandsWaterCells', water);
      t.assert(water > 200, 'islands: sea around the home island');
    },
  },
  {
    name: 'coreb-streaming-gen',
    requires: ['worldgen'],
    async run(t) {
      // generate a strip of fresh columns far away through the world API and time it in the real browser
      await t.call('startWorld', { preset: 'default', seed: 31337, mode: 'creative', difficulty: 'peaceful' });
      const r = await t.eval(() => {
        const w = window.__game.game.world;
        const t0 = performance.now();
        let n = 0;
        for (let i = 0; i < 40; i++) { if (w.ensureColumn(200 + i, 200)) n++; }
        return { n, ms: (performance.now() - t0) / 40, stats: w.stats().genAvgMs };
      });
      t.note('ensureColumnMs', Math.round(r.ms * 1000) / 1000);
      t.note('worldGenAvgMs', Math.round(r.stats * 1000) / 1000);
      t.assert(r.n === 40, 'columns generated');
    },
  },
  {
    // Visual check through the real renderer once CORE-A/C/D land (PENDING until then).
    name: 'coreb-terrain-view',
    requires: ['worldgen', 'textures', 'world', 'lighting', 'mesher', 'renderer'],
    async run(t) {
      await t.call('startWorld', { preset: 'default', seed: 12345, mode: 'creative', difficulty: 'peaceful' });
      await t.call('setLook', 20, -12);
      await t.call('waitFrames', 30);
      await t.shot('coreb-view-spawn');
      const p = await t.call('pos');
      await t.call('setFlying', true);
      await t.call('teleport', p.x, p.y + 18, p.z);
      await t.call('setLook', 200, -22);
      await t.call('waitFrames', 40);
      const px = await t.call('pixelStats');
      t.note('pixels', px);
      t.assert(px.uniqueColors > 60, 'varied terrain on screen');
      await t.shot('coreb-view-high');
    },
  },
];
