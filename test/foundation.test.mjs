// OWNER: LEAD. Unit tests for the frozen foundation (data registries, registry rules, event bus, inventory)
// and the cross-lane CONTRACTS (texture coverage, worldgen determinism, mesher output format). Lanes add
// their own test/<lane>.test.mjs files; these must keep passing as stubs are replaced.
import test from 'node:test';
import assert from 'node:assert/strict';

import { BLOCKS, BLOCK_BY_NAME } from '../src/data/blocks.js';
import { ITEMS, ITEM_LIST, PICKER_TABS, creativePickerItems, requiredSprites } from '../src/data/items.js';
import { RECIPES, SMELTING, TAGS, ingredientItems } from '../src/data/recipes.js';
import { MOBS, mobsForBiome } from '../src/data/mobs.js';
import {
  ID, REQUIRED_TEXTURE_KEYS, bindTextures, breakTicks, faceLayer, faceTexKey, getCollisionBoxes, getSelectionBoxes,
  rollDrops, B_OPAQUE, B_EMIT, B_FILTER, itemPlaces, connectionState,
} from '../src/core/registry.js';
import { COLUMN_VOLUME, DEFAULT_RULES, FACE, PHYS, SURVIVAL_RULES, colIndex, colKey, packBlock } from '../src/core/constants.js';
import { KEY_BINDINGS } from '../src/player/input.js';
import { createWorldSystem } from '../src/world/world.js';
import { EventBus } from '../src/core/events.js';
import { Inventory } from '../src/inventory/inventory.js';
import { buildTextures } from '../src/textures/textures.js';
import { generateColumn, findSpawn, BIOMES } from '../src/world/worldgen.js';
import { meshSection, meshBlockModel, PADDED_VOLUME } from '../src/world/mesher.js';
import { padIndex } from '../src/core/constants.js';
import { hashString } from '../src/core/math.js';
import { encodeColumn, decodeColumn } from '../src/save/codec.js';

const isItemOrTag = (k) => (k.startsWith('#') ? !!TAGS[k.slice(1)] : ITEMS.has(k));

test('block ids/names are unique and every block has a display name', () => {
  const ids = new Set();
  for (const b of BLOCKS) {
    if (!b) continue;
    assert.ok(!ids.has(b.id), `dup id ${b.id}`);
    ids.add(b.id);
    assert.equal(BLOCK_BY_NAME.get(b.name), b);
    assert.ok(b.display && b.display.length > 0);
    assert.ok(b.id < 256);
  }
  assert.ok(ids.size >= 130, `about 140 blocks expected, got ${ids.size}`);
  assert.equal(ID.air, 0);
});

test('item references are valid (blocks, drops, recipes, smelting, mobs)', () => {
  for (const it of ITEM_LIST) {
    if (it.block) assert.ok(BLOCK_BY_NAME.has(it.block), `${it.key} places unknown block ${it.block}`);
    assert.ok(/^(iso|tex|sprite):/.test(it.icon), `${it.key} icon ${it.icon}`);
    if (it.icon.startsWith('iso:')) assert.ok(BLOCK_BY_NAME.has(it.icon.slice(4)), `${it.key} iso icon`);
    if (it.icon.startsWith('tex:')) assert.ok(REQUIRED_TEXTURE_KEYS.includes(it.icon.slice(4)), `${it.key} tex icon ${it.icon}`);
  }
  for (const b of BLOCKS) {
    if (!b) continue;
    for (let s = 0; s < 256; s += 17) {
      for (const d of rollDrops(b.id, s, () => 0.001, { type: 'pickaxe', level: 4, speed: 8 })) assert.ok(ITEMS.has(d.item), `${b.name} drops unknown ${d.item}`);
      for (const d of rollDrops(b.id, s, () => 0.999, { type: 'pickaxe', level: 4, speed: 8 })) assert.ok(ITEMS.has(d.item), `${b.name} drops unknown ${d.item}`);
    }
  }
  for (const r of RECIPES) {
    assert.ok(ITEMS.has(r.result.item), `recipe result ${r.result.item}`);
    const ings = r.type === 'shaped' ? Object.values(r.key) : r.ingredients;
    for (const k of ings) { assert.ok(isItemOrTag(k), `recipe ${r.id} ingredient ${k}`); ingredientItems(k).forEach((i) => assert.ok(ITEMS.has(i), i)); }
    if (r.type === 'shaped') {
      const keys = new Set(r.pattern.join('').replace(/ /g, ''));
      for (const ch of keys) assert.ok(r.key[ch], `recipe ${r.id} pattern char ${ch} has no key`);
      assert.ok(r.pattern.length <= 3 && r.pattern.every((row) => row.length <= 3 && row.length === r.pattern[0].length), `recipe ${r.id} pattern shape`);
    } else assert.ok(r.ingredients.length >= 1 && r.ingredients.length <= 9);
  }
  for (const s of SMELTING) { assert.ok(isItemOrTag(s.input), s.input); assert.ok(ITEMS.has(s.result), s.result); }
  for (const [name, m] of Object.entries(MOBS)) {
    for (const d of m.drops || []) if (d.item !== 'wool') assert.ok(ITEMS.has(d.item), `${name} drop ${d.item}`);
    assert.ok(ITEMS.has(name + '_spawn_egg'), `${name} spawn egg`);
  }
});

test('every block face resolves to a required texture key; boxes are well-formed', () => {
  const keys = new Set(REQUIRED_TEXTURE_KEYS);
  for (const b of BLOCKS) {
    if (!b || b.id === 0) continue;
    for (let s = 0; s < 256; s++) {
      for (let f = 0; f < 6; f++) assert.ok(keys.has(faceTexKey(b.id, s, f)), `${b.name} state ${s} face ${f} -> ${faceTexKey(b.id, s, f)}`);
      for (const box of [...getCollisionBoxes(b.id, s), ...getSelectionBoxes(b.id, s)]) {
        assert.equal(box.length, 6);
        assert.ok(box[0] < box[3] && box[1] < box[4] && box[2] < box[5], `${b.name} box ${box}`);
      }
    }
  }
  assert.equal(faceTexKey(ID.grass_block, 0, FACE.UP), 'grass_top');
  assert.equal(faceTexKey(ID.grass_block, 0, FACE.NORTH), 'grass_side');
  assert.equal(faceTexKey(ID.oak_log, 1, FACE.EAST), 'oak_log_top');
  assert.equal(faceTexKey(ID.furnace, 2, FACE.SOUTH), 'furnace_front');
  assert.equal(getCollisionBoxes(ID.short_grass, 0).length, 0);
  assert.equal(getSelectionBoxes(ID.water, 0).length, 0);
  assert.ok(B_OPAQUE[ID.stone] && !B_OPAQUE[ID.glass] && !B_OPAQUE[ID.oak_leaves]);
  assert.equal(B_EMIT[ID.torch], 14);
  assert.deepEqual(itemPlaces('red_bed'), { id: ID.bed, state: 14 << 4 });
});

test('break times match Java (ticks)', () => {
  const tool = (k) => ITEMS.get(k).tool;
  assert.equal(breakTicks(ID.dirt, null), 15);                        // 0.75 s
  assert.equal(breakTicks(ID.oak_log, null), 60);                     // 3.0 s
  assert.equal(breakTicks(ID.oak_log, tool('wooden_axe')), 30);       // 1.5 s
  assert.equal(breakTicks(ID.stone, null), 150);                      // 7.5 s, no drop
  assert.equal(breakTicks(ID.stone, tool('wooden_pickaxe')), 23);     // ~1.15 s
  assert.equal(breakTicks(ID.obsidian, tool('diamond_pickaxe')), 188); // ~9.4 s
  assert.equal(breakTicks(ID.torch, null), 0);
  assert.equal(breakTicks(ID.bedrock, tool('diamond_pickaxe')), Infinity);
  assert.deepEqual(rollDrops(ID.stone, 0, () => 0.5, null), []);
  assert.deepEqual(rollDrops(ID.stone, 0, () => 0.5, tool('wooden_pickaxe')), [{ item: 'cobblestone', count: 1 }]);
  assert.deepEqual(rollDrops(ID.wheat, 7, () => 0, null).map((d) => d.item), ['wheat', 'wheat_seeds']);
});

test('event bus: ordering, unsubscribe, error isolation, log', () => {
  const bus = new EventBus();
  const seen = [];
  const errors = [];
  bus.onError = (e, n) => errors.push(n);
  const off = bus.on('a', (p) => seen.push(['1', p.v]));
  bus.on('a', () => { throw new Error('boom'); });
  bus.on('a', (p) => seen.push(['3', p.v]));
  bus.emit('a', { v: 1 });
  off();
  bus.emit('a', { v: 2 });
  assert.deepEqual(seen, [['1', 1], ['3', 1], ['3', 2]]);
  assert.deepEqual(errors, ['a', 'a']);
  assert.equal(bus.counts.get('a'), 2);
  assert.equal(bus.recent('a').length, 2);
});

test('inventory: stacking, hotbar-first, remove, durability, json round trip', () => {
  const events = new EventBus();
  const inv = new Inventory(events);
  assert.equal(inv.add({ item: 'stone', count: 100 }), 0);
  assert.deepEqual(inv.slots.slice(0, 2).map((s) => s && s.count), [64, 36]);
  assert.equal(inv.add({ item: 'wooden_pickaxe', count: 1 }), 0);
  assert.equal(inv.get(2).item, 'wooden_pickaxe');
  inv.selectSlot(2);
  for (let i = 0; i < 58; i++) assert.equal(inv.damageSelected(1), false);
  assert.equal(inv.damageSelected(1), true);
  assert.equal(inv.get(2), null);
  assert.equal(inv.removeItem('stone', 70), 70);
  assert.equal(inv.count('stone'), 30);
  const copy = new Inventory();
  copy.fromJSON(JSON.parse(JSON.stringify(inv.toJSON())));
  assert.equal(copy.count('stone'), 30);
  assert.equal(inv.add({ item: 'no_such_item', count: 1 }), 1);
  assert.ok(events.counts.get('inventory:changed') > 0);
});

test('CONTRACT textures: every required key present, data sized, animated frames', () => {
  const t = buildTextures();
  assert.equal(t.size, 16);
  assert.equal(t.data.length, 16 * 16 * 4 * t.count);
  for (const k of REQUIRED_TEXTURE_KEYS) assert.ok(t.index.has(k), `missing texture ${k}`);
  assert.equal(t.animated.get('water').frames, 16);
  assert.equal(t.animated.get('lava').frames, 16);
  assert.equal(t.animated.get('fire').frames, 8);
  // SPEC D5 (v1.7): WebGL2 guarantees 256 array layers; the full set may pass that, the half-animation set may not
  assert.ok(buildTextures({ halfAnim: true }).count <= 256, `layer budget: the half-animation set fits 256 array layers (full ${t.count})`);
  bindTextures(t);
  assert.equal(faceLayer(ID.stone, 0, FACE.UP), t.layer('stone'));
  const t2 = buildTextures();
  assert.equal(hashString(Buffer.from(t.data).toString('latin1')), hashString(Buffer.from(t2.data).toString('latin1')), 'textures are deterministic');
  assert.ok(requiredSprites().length > 50);
});

test('CONTRACT worldgen: deterministic, sized, bedrock floor, flat preset layout, spawn', () => {
  const mk = () => ({ blocks: new Uint16Array(COLUMN_VOLUME), biomes: new Uint8Array(256) });
  const a = generateColumn(42, 3, -2, 'default', mk());
  const b = generateColumn(42, 3, -2, 'default', mk());
  assert.deepEqual(a.blocks, b.blocks);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) assert.equal(a.blocks[colIndex(x, 0, z)] & 0xff, ID.bedrock);
  const f = generateColumn(1, 0, 0, 'flat', mk());
  assert.equal(f.blocks[colIndex(5, 0, 5)] & 0xff, ID.bedrock);
  assert.equal(f.blocks[colIndex(5, 1, 5)] & 0xff, ID.dirt);
  assert.equal(f.blocks[colIndex(5, 2, 5)] & 0xff, ID.dirt);
  assert.equal(f.blocks[colIndex(5, 3, 5)] & 0xff, ID.grass_block);
  assert.equal(f.blocks[colIndex(5, 4, 5)] & 0xff, ID.air);
  assert.deepEqual(findSpawn(1, 'flat'), findSpawn(1, 'flat'));
  assert.equal(findSpawn(1, 'flat').y, 4);
  for (const v of a.biomes) assert.ok(BIOMES[v], `biome id ${v}`);
});

test('CONTRACT mesher: output format', () => {
  const t = buildTextures();
  bindTextures(t);
  const blocks = new Uint16Array(PADDED_VOLUME);
  const light = new Uint8Array(PADDED_VOLUME).fill(0xf0);
  blocks[padIndex(4, 4, 4)] = ID.stone;
  blocks[padIndex(5, 4, 4)] = ID.stone;
  const m = meshSection(blocks, light, {});
  assert.ok(m && m.opaque, 'opaque buffers');
  const o = m.opaque;
  assert.equal(o.quads, 10, 'two touching cubes = 10 visible faces');
  assert.equal(o.position.length, o.quads * 12);
  assert.equal(o.tex.length, o.quads * 16);
  assert.equal(o.light.length, o.quads * 16);
  assert.ok(o.position instanceof Float32Array && o.tex instanceof Uint16Array && o.light instanceof Uint8Array);
  for (let v = 0; v < o.quads * 4; v++) {
    assert.ok(o.tex[v * 4 + 1] <= 256 && o.tex[v * 4 + 2] <= 256, 'uv in 0..256');
    assert.ok((o.tex[v * 4 + 3] & 7) <= 6, 'face bits');
    assert.ok(o.light[v * 4] <= 240 && o.light[v * 4 + 1] <= 240 && o.light[v * 4 + 2] <= 3, 'light ranges');
  }
  assert.equal(meshSection(new Uint16Array(PADDED_VOLUME), light, {}), null, 'empty section -> null');
  const bm = meshBlockModel(ID.oak_planks, 0);
  assert.equal(bm.quads, 6);
});

test('critique fixes: data rules (P0 item sources, roofs, picker tabs, bedrock, cake, biomes, rules, keys)', () => {
  // P0 item sources in survival before the P1 hostile mobs exist
  const gravelLow = rollDrops(ID.gravel, 0, () => 0.01, null).map((d) => d.item);
  assert.deepEqual(gravelLow, ['flint', 'bone'], 'gravel: flint 10% + extra bone 5%');
  assert.deepEqual(rollDrops(ID.gravel, 0, () => 0.5, null).map((d) => d.item), ['gravel']);
  assert.ok(rollDrops(ID.oak_leaves, 0, () => 0.001, null).some((d) => d.item === 'string'), 'oak leaves can drop string');
  assert.ok(rollDrops(ID.birch_leaves, 0, () => 0.001, null).some((d) => d.item === 'string'), 'birch leaves can drop string');
  // slab / stair roofs keep sky light out but stay non-opaque (no culling/AO)
  for (const n of ['oak_slab', 'cobblestone_slab', 'stone_brick_slab', 'oak_stairs', 'cobblestone_stairs']) {
    assert.equal(B_FILTER[ID[n]], 15, `${n} filter 15`);
    assert.equal(B_OPAQUE[ID[n]], 0, `${n} not opaque`);
  }
  // creative picker: 8 tabs, every breeding/taming item reachable, hostile + bedrock hidden
  assert.equal(PICKER_TABS.length, 8);
  const shown = new Set(PICKER_TABS.flatMap((t) => creativePickerItems(t.id).map((d) => d.key)));
  for (const k of ['wheat', 'wheat_seeds', 'carrot', 'bone', 'bone_meal', 'string', 'egg', 'shears', 'bucket', 'red_dye', 'saddle', 'wooden_sword'])
    assert.ok(shown.has(k), `picker shows ${k}`);
  const animals = creativePickerItems('animals').map((d) => d.key);
  for (const k of ['wheat', 'bone', 'bone_meal', 'shears', 'red_dye']) assert.ok(animals.includes(k), `animals tab has ${k}`);
  assert.ok(!shown.has('bedrock'), 'bedrock is not in the picker');
  assert.ok(!animals.includes('creeper_spawn_egg'), 'hostile eggs hidden while hostile mobs are off');
  assert.ok(creativePickerItems('animals', { hostileMobs: true }).some((d) => d.key === 'creeper_spawn_egg'));
  assert.ok(!creativePickerItems('animals', { hasMob: (m) => m !== 'cat' }).some((d) => d.key === 'cat_spawn_egg'), 'unimplemented mobs hidden');
  for (const it of ITEM_LIST) if (it.creative !== false && !it.mob) assert.ok(shown.has(it.key), `${it.key} reachable in the picker`);
  // small data fixes
  assert.equal(ITEMS.get('cake').stack, 1);
  for (const [name, m] of Object.entries(MOBS)) if (m.attack !== undefined) assert.equal(typeof m.attack, 'object', `${name}.attack is {easy, normal}`);
  for (const b of BIOMES) assert.ok(!('animals' in b), 'BIOMES carry no animal list (MOBS[].biomes is authoritative)');
  assert.deepEqual(mobsForBiome('plains', (t) => MOBS[t].priority === 'P0'), ['pig', 'cow', 'sheep', 'chicken']);
  // new blocks + recipes
  for (const k of ['oak_fence_gate', 'glass_pane', 'painting']) assert.ok(ITEMS.has(k), `item ${k}`);
  assert.ok(RECIPES.some((r) => r.result.item === 'glass_pane' && r.result.count === 16));
  assert.ok(RECIPES.some((r) => r.result.item === 'oak_fence_gate' && r.pattern && r.pattern.join('/') === 'SPS/SPS'));
  // rules, physics constants, kid keys
  assert.equal(DEFAULT_RULES.voidRescue, true);
  assert.notEqual(SURVIVAL_RULES.voidRescue, false, 'survival keeps the void rescue');
  assert.equal(PHYS.VEL_EPS, 0.003);
  for (const code of Object.keys(KEY_BINDINGS.kid)) assert.ok(!/^(Shift|Control|Alt|Meta|Tab|F\d)/.test(code), `kid scheme never binds ${code}`);
  assert.equal(KEY_BINDINGS.kid.KeyC, 'descend');
});

test('critique fixes: fence / pane / gate boxes and connections', () => {
  const fence = ID.oak_fence;
  assert.equal(getCollisionBoxes(fence, 0).length, 1, 'lone post');
  assert.equal(getCollisionBoxes(fence, 15).length, 5, 'post + 4 bars');
  for (const b of getCollisionBoxes(fence, 15)) assert.equal(b[4], 1.5, 'fence collision is 1.5 high');
  const world = new Map([[`1,0,0`, ID.oak_fence], [`0,0,-1`, ID.stone], [`-1,0,0`, ID.oak_fence_gate], [`0,0,1`, ID.short_grass]]);
  const get = (x, y, z) => world.get(`${x},${y},${z}`) || 0;
  assert.equal(connectionState(get, 0, 0, 0, fence), 1 | 2 | 8, 'fence joins stone (N), fence (E), gate (W), not grass (S)');
  const paneWorld = new Map([[`1,0,0`, ID.glass], [`0,0,1`, ID.glass_pane], [`0,0,-1`, ID.oak_leaves]]);
  assert.equal(connectionState((x, y, z) => paneWorld.get(`${x},${y},${z}`) || 0, 0, 0, 0, ID.glass_pane), 2 | 4, 'pane joins glass and panes, not leaves');
  const gate = ID.oak_fence_gate;
  assert.equal(getCollisionBoxes(gate, 0)[0][4], 1.5, 'closed gate blocks like a fence');
  assert.equal(getCollisionBoxes(gate, 4).length, 0, 'open gate is walk-through');
  assert.equal(getSelectionBoxes(gate, 4).length, 1, 'open gate is still clickable');
  assert.equal(getCollisionBoxes(ID.oak_slab, 2)[0][4], 1, 'double slab is a full block');
});

test('CONTRACT world: modified columns survive save + unload + reload; batches relight once', () => {
  bindTextures(buildTextures());
  const events = new EventBus();
  const game = {
    events, settings: { fancyLeaves: true, smoothLighting: true, waving: true }, renderer: null, state: 'playing',
    player: { x: 8.5, y: 4, z: 8.5 }, perf: { frameMs: 16, workMs: 2 }, tickCount: 0, isCreative: () => true,
    meta: { seed: 1, preset: 'flat', rules: { ...DEFAULT_RULES } },
  };
  const w = createWorldSystem(game);
  if (w.init) w.init(game);
  w.open(game.meta, null);
  w.setRenderDistance(3);
  const pumpUntil = (cond, msg) => { for (let i = 0; i < 3000 && !cond(); i++) w.frame(game, 0.016); assert.ok(cond(), msg); };
  pumpUntil(() => w.isColumnLoaded(0, 0), 'spawn column loads');
  assert.ok(w.setBlock(2, 4, 2, ID.gold_block, 0, { cause: 'test' }));
  for (const [cx, cz] of w.getDirtyColumns()) { w.exportColumn(cx, cz); w.markColumnSaved(cx, cz); }
  game.player.x = 8.5 + 16 * 20;
  pumpUntil(() => !w.getColumn(0, 0), 'column unloads 20 columns away');
  assert.ok(w.savedColumns.has(colKey(0, 0)), 'a saved, modified column stays in savedColumns after unload');
  game.player.x = 8.5;
  pumpUntil(() => w.isColumnLoaded(0, 0), 'column reloads');
  assert.equal(w.getBlock(2, 4, 2), ID.gold_block, 'the edit survived unload -> reload');
  // unsaved edit -> pendingSave, restored still dirty; markColumnSaved moves (never drops) the record
  assert.ok(w.setBlock(3, 4, 3, ID.diamond_block, 0, { cause: 'test' }));
  game.player.x = 8.5 + 16 * 20;
  pumpUntil(() => !w.getColumn(0, 0), 'unloads again');
  assert.ok(w.pendingSave.has(colKey(0, 0)), 'unsaved column waits in pendingSave');
  w.exportColumn(0, 0); w.markColumnSaved(0, 0);
  assert.ok(!w.pendingSave.has(colKey(0, 0)) && w.savedColumns.has(colKey(0, 0)), 'markColumnSaved moves pendingSave -> savedColumns');
  game.player.x = 8.5;
  pumpUntil(() => w.isColumnLoaded(0, 0), 'reloads again');
  assert.equal(w.getBlock(3, 4, 3), ID.diamond_block);
  // batch: per-cell events, light right after endBatch, action passed through
  const seen = [];
  const off = events.on('block:changed', (e) => seen.push(e));
  const n = w.setBlocks([[5, 10, 5, ID.stone], [6, 10, 5, ID.stone], [5, 10, 6, ID.stone]], { cause: 'test', action: 42 });
  off();
  assert.equal(n, 3);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((e) => e.action === 42 && e.cause === 'test'));
  // L-shaped roof at y 10: (5,6,5) is one step from open sky, so real lighting gives 14 (SPEC §5.3.4)
  assert.equal(w.getSkyLight(5, 6, 5), 14, 'relit at endBatch (one step from open sky under the roof)');
  assert.equal(w.getSkyLight(5, 11, 5), 15, 'open sky above the roof');
  assert.equal(w.inBatch(), false);
  assert.equal(w.getRaw(5, 10, 5), packBlock(ID.stone, 0));
  w.close();
});

test('save codec: RLE round trip + corruption detection', () => {
  const mk = () => ({ blocks: new Uint16Array(COLUMN_VOLUME), biomes: new Uint8Array(256) });
  for (const preset of ['flat', 'default']) {
    const col = generateColumn(9, 1, 1, preset, mk());
    col.blocks[colIndex(3, 100, 3)] = ID.oak_door | (13 << 8);
    const bytes = encodeColumn(col.blocks);
    assert.deepEqual(decodeColumn(bytes), col.blocks);
    if (preset === 'flat') assert.ok(bytes.length < 200, `flat column compresses (${bytes.length} B)`);
  }
  assert.throws(() => decodeColumn(Uint8Array.from([1, 2, 3])));
  assert.throws(() => decodeColumn(encodeColumn(new Uint16Array(COLUMN_VOLUME)).slice(0, 4)));
});

test('world rules (judge FID-3, FID-11): difficulty never rewrites a switch; survival weather, Normal death screen', async () => {
  const { newWorldRules, ruleInEffect, PEACEFUL_OFF } = await import('../src/core/worldrules.js');
  const kid = newWorldRules('creative', 'peaceful');
  assert.equal(kid.hostileMobs, false, 'the kid world has no monsters');
  assert.equal(kid.weatherCycle, false, 'the kid world never rains by itself');
  assert.equal(kid.immediateRespawn, true);
  const easy = newWorldRules('survival', 'easy');
  assert.equal(easy.weatherCycle, true, 'survival worlds have weather');
  assert.equal(easy.immediateRespawn, true, 'Survival Easy respawns at once');
  assert.equal(easy.keepInventory, true, 'items are kept (5-year-old)');
  const normal = newWorldRules('survival', 'normal');
  assert.equal(normal.immediateRespawn, false, 'Survival Normal shows the death screen');
  assert.equal(normal.weatherCycle, true);
  assert.equal(newWorldRules('survival', 'normal', { immediateRespawn: true }).immediateRespawn, true, 'explicit rules win');
  // Survival Peaceful keeps the switches; Peaceful only blocks them while it lasts
  const peace = newWorldRules('survival', 'peaceful');
  assert.equal(peace.hostileMobs, true);
  const meta = { difficulty: 'peaceful', rules: peace };
  for (const k of PEACEFUL_OFF) assert.equal(ruleInEffect(meta, k), false, `${k} is off on Peaceful`);
  // what game.setDifficulty does: only the difficulty changes (main.js); Peaceful -> Easy brings monsters back
  meta.difficulty = 'easy';
  assert.equal(ruleInEffect(meta, 'hostileMobs'), true, 'monsters come back on Easy');
  assert.equal(ruleInEffect(meta, 'hunger'), true, 'hunger comes back on Easy');
  meta.rules.hostileMobs = false;
  assert.equal(ruleInEffect(meta, 'hostileMobs'), false, 'the Monsters switch still turns them off');
  // main.js setDifficulty must not write any rule (it used to set hostileMobs = false on Peaceful for good)
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('setDifficulty(d) {'), src.indexOf('setRule(key, value) {'));
  assert.ok(body.length > 0 && !/rules\.\w+\s*=/.test(body), 'setDifficulty does not rewrite rules');
});

test('building palette (judge FID-7): new blocks, shapes, drops, recipes and picker pages', async () => {
  const { matchRecipe } = await import('../src/inventory/crafting.js');
  const { POT_PLANTS, STATE } = await import('../src/data/blocks.js');
  const names = ['stone_slab', 'brick_slab', 'sandstone_slab', 'birch_slab', 'spruce_slab', 'stone_stairs', 'brick_stairs', 'sandstone_stairs',
    'stone_brick_stairs', 'birch_stairs', 'spruce_stairs', 'birch_door', 'spruce_door', 'birch_fence', 'spruce_fence', 'birch_fence_gate',
    'spruce_fence_gate', 'oak_trapdoor', 'birch_trapdoor', 'spruce_trapdoor', 'lantern', 'flower_pot', 'oak_sign', 'quartz_block', 'prismarine',
    ...['white', 'red', 'black'].map((c) => c + '_concrete')];
  for (const n of names) {
    assert.ok(BLOCK_BY_NAME.has(n), `${n} block`);
    assert.ok(ITEMS.has(n), `${n} item`);
  }
  // every new item is on a kid picker page
  const picked = new Set(PICKER_TABS.flatMap((t) => creativePickerItems(t.id).map((d) => d.key)));
  for (const n of names) assert.ok(picked.has(n), `${n} is in the picker`);
  // shapes: closed trapdoor 3/16 on the floor or the ceiling, open = an edge panel; lantern hangs 1 px higher
  const top = (n, s) => getSelectionBoxes(ID[n], s)[0];
  assert.deepEqual([...top('oak_trapdoor', 0)], [0, 0, 0, 1, 3 / 16, 1]);
  assert.equal(top('oak_trapdoor', STATE.TRAPDOOR_TOP)[1], 13 / 16);
  assert.deepEqual([...top('oak_trapdoor', 1 | STATE.TRAPDOOR_OPEN)], [1 - 3 / 16, 0, 0, 1, 1, 1], 'open hatch stands on its east hinge edge');
  assert.ok(getCollisionBoxes(ID.oak_trapdoor, 0).length === 1, 'a closed hatch can be walked on');
  assert.equal(getCollisionBoxes(ID.oak_sign, 0).length, 0, 'signs have no collision');
  assert.ok(getSelectionBoxes(ID.oak_sign, 2 | STATE.SIGN_WALL).length === 1, 'wall sign board');
  assert.equal(top('lantern', STATE.LANTERN_HANGING)[1], 1 / 16);
  assert.equal(getCollisionBoxes(ID.nether_portal, 0).length, 0, 'the portal sheet is walk-through');
  // a double slab drops two; a planted pot drops the pot and the plant
  assert.deepEqual(rollDrops(ID.stone_slab, STATE.SLAB_DOUBLE, () => 0.5, { type: 'pickaxe', level: 1 }), [{ item: 'stone_slab', count: 2 }]);
  assert.deepEqual(rollDrops(ID.oak_slab, 0, () => 0.5, null), [{ item: 'oak_slab', count: 1 }]);
  assert.deepEqual(rollDrops(ID.flower_pot, POT_PLANTS.indexOf('poppy')).map((s) => s.item), ['flower_pot', 'poppy']);
  // recipes: six birch planks make a birch door; mixed planks still make an oak door; concrete from dye + sand + gravel
  const g = (rows) => rows.flat().map((k) => (k ? { item: k, count: 1 } : null));
  const B = 'birch_planks', O = 'oak_planks';
  assert.equal(matchRecipe(g([[B, B, null], [B, B, null], [B, B, null]]), 3, 3).result.item, 'birch_door');
  assert.equal(matchRecipe(g([[B, O, null], [B, B, null], [B, B, null]]), 3, 3).result.item, 'oak_door');
  const conc = matchRecipe(g([['red_dye', 'sand', 'sand'], ['sand', 'sand', 'gravel'], ['gravel', 'gravel', 'gravel']]), 3, 3);
  assert.equal(conc.result.item, 'red_concrete'); assert.equal(conc.result.count, 8);
  assert.equal(matchRecipe(g([['iron_ingot', null, null], ['torch', null, null], [null, null, null]]), 3, 3).result.item, 'lantern');
  assert.equal(matchRecipe(g([['spruce_planks', 'spruce_planks', 'spruce_planks'], ['spruce_planks', 'spruce_planks', 'spruce_planks'], [null, null, null]]), 3, 3).result.item, 'spruce_trapdoor');
  // the block id space still fits a byte
  assert.ok(BLOCKS.length <= 256);
});
