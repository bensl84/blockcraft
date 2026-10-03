// OWNER LANE: FEATURE-MENUS. Unit tests for the pure parts of the menus lane: pixel font (TrueType bytes),
// parent-gate state machine, world names / paging, autosave cadence, the save system on the in-memory backend
// (save, retry, coalescing, list/load/delete/rename, backups, export/import) and the world file format.
import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/events.js';
import { COLUMN_VOLUME, DEFAULT_RULES, colKey } from '../src/core/constants.js';
import { mulberry32 } from '../src/core/math.js';
import { ID, bindTextures } from '../src/core/registry.js';
import { buildTextures } from '../src/textures/textures.js';
import { createWorldSystem } from '../src/world/world.js';
import { decodeColumn, encodeColumn } from '../src/save/codec.js';
import { FONT_EM, FONT_PX, GLYPHS, buildFontTTF, glyphWidth, ttfChecksum } from '../src/ui/pixelfont.js';
import {
  GATE_HOLD_MS, GateMachine, MODE_CHOICES, PRESET_CHOICES, cleanWorldName, makeSum, makeWorldName, modeKeyOf,
  newWorldOptions, pageCount, pageSlice, pickerGrid,
} from '../src/ui/menu_logic.js';
import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_MS, AutosaveScheduler } from '../src/save/autosave.js';
import { createMemoryBackend } from '../src/save/backends.js';
import { createSaveSystem } from '../src/save/storage.js';
import { decodeWorldFile, encodeWorldFile, fromBase64, toBase64, worldFileName } from '../src/save/worldfile.js';

/* ------------------------------------------------------------------ pixel font */
function parseTTF(buf) {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  const n = dv.getUint16(4);
  const tables = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    tables[tag] = { sum: dv.getUint32(o + 4), off: dv.getUint32(o + 8), len: dv.getUint32(o + 12), order: i };
  }
  return { b, dv, n, tables };
}

test('pixel font: every printable ASCII glyph is drawn, original-format bitmaps', () => {
  const chars = Object.keys(GLYPHS);
  assert.equal(chars.length, 95);
  for (let c = 32; c <= 126; c++) assert.ok(GLYPHS[String.fromCharCode(c)], `glyph for ${c}`);
  const seen = new Map();
  for (const [ch, rows] of Object.entries(GLYPHS)) {
    assert.ok(rows.length >= 1 && rows.length <= 9, `rows of ${ch}`);
    const w = rows[0].length;
    assert.ok(w >= 1 && w <= 5, `width of ${ch}`);
    for (const r of rows) { assert.equal(r.length, w, `ragged glyph ${ch}`); assert.match(r, /^[#.]+$/); }
    if (ch !== ' ') assert.ok(rows.some((r) => r.includes('#')), `glyph ${ch} has ink`);
    const key = rows.join('|');
    assert.ok(!seen.has(key), `glyph ${ch} duplicates ${seen.get(key)}`);
    seen.set(key, ch);
  }
  assert.equal(glyphWidth('i'), 1);
});

test('pixel font: TrueType bytes are well formed (directory, checksums, cmap, glyf/loca, metrics)', () => {
  const buf = buildFontTTF();
  const { b, dv, n, tables } = parseTTF(buf);
  assert.equal(dv.getUint32(0), 0x00010000);
  const want = ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'];
  assert.deepEqual(Object.keys(tables).sort(), [...want].sort());
  assert.equal(n, want.length);
  const ordered = Object.entries(tables).sort((x, y) => x[1].order - y[1].order).map(([t]) => t);
  assert.deepEqual(ordered, [...ordered].sort(), 'directory sorted by tag');
  for (const [tag, t] of Object.entries(tables)) {
    assert.equal(t.off % 4, 0, `${tag} aligned`);
    assert.ok(t.off + t.len <= b.length, `${tag} inside file`);
    if (tag === 'head') {
      const copy = b.slice(t.off, t.off + t.len);
      copy[8] = copy[9] = copy[10] = copy[11] = 0;
      assert.equal(ttfChecksum(copy, 0, copy.length), t.sum, 'head checksum (adjustment zeroed)');
    } else assert.equal(ttfChecksum(b, t.off, t.len), t.sum, `${tag} checksum`);
  }
  assert.equal(ttfChecksum(b, 0, b.length), 0xb1b0afba, 'whole-font checksum magic');
  const head = tables.head.off;
  assert.equal(dv.getUint32(head + 12), 0x5f0f3cf5, 'head magic');
  assert.equal(dv.getUint16(head + 18), FONT_EM);
  assert.equal(dv.getInt16(head + 50), 1, 'long loca');
  const numGlyphs = dv.getUint16(tables.maxp.off + 4);
  assert.equal(numGlyphs, 96);
  assert.equal(dv.getUint16(tables.hhea.off + 34), numGlyphs, 'hhea numberOfHMetrics');
  assert.equal(tables.hmtx.len, numGlyphs * 4);
  assert.equal(tables.loca.len, (numGlyphs + 1) * 4);
  const loca = [];
  for (let i = 0; i <= numGlyphs; i++) loca.push(dv.getUint32(tables.loca.off + i * 4));
  for (let i = 1; i < loca.length; i++) assert.ok(loca[i] >= loca[i - 1], 'loca monotonic');
  assert.equal(loca[numGlyphs], tables.glyf.len);
  // cmap format 4 lookup
  const cm = tables.cmap.off;
  assert.equal(dv.getUint16(cm + 4), 3); assert.equal(dv.getUint16(cm + 6), 1);
  const sub = cm + dv.getUint32(cm + 8);
  assert.equal(dv.getUint16(sub), 4);
  const segX2 = dv.getUint16(sub + 6), seg = segX2 / 2;
  const lookup = (code) => {
    for (let i = 0; i < seg; i++) {
      const end = dv.getUint16(sub + 14 + i * 2), start = dv.getUint16(sub + 16 + segX2 + i * 2);
      const delta = dv.getUint16(sub + 16 + segX2 * 2 + i * 2);
      if (code >= start && code <= end) return (code + delta) & 0xffff;
    }
    return 0;
  };
  assert.equal(lookup(65), 65 - 32 + 1, "'A' maps to its glyph");
  assert.equal(lookup(32), 1); assert.equal(lookup(126), 95); assert.equal(lookup(200), 0);
  // glyph A: contours inside the font bbox; space is empty
  const gA = tables.glyf.off + loca[34];
  assert.ok(dv.getInt16(gA) > 0, 'A has contours');
  assert.ok(dv.getInt16(gA + 2) >= dv.getInt16(head + 36) && dv.getInt16(gA + 8) <= dv.getInt16(head + 42));
  assert.equal(loca[2] - loca[1], 0, 'space glyph is empty');
  // advance widths = (glyph width + 1) * FONT_PX
  assert.equal(dv.getUint16(tables.hmtx.off + 34 * 4), (glyphWidth('A') + 1) * FONT_PX);
  // name table carries the family
  const nm = tables.name.off, count = dv.getUint16(nm + 2), so = dv.getUint16(nm + 4);
  let family = '';
  for (let i = 0; i < count; i++) {
    const r = nm + 6 + i * 12;
    if (dv.getUint16(r + 6) === 1) { const len = dv.getUint16(r + 8), off = dv.getUint16(r + 10); for (let k = 0; k < len; k += 2) family += String.fromCharCode(dv.getUint16(nm + so + off + k)); }
  }
  assert.equal(family, 'BlockcraftPixel');
});

/* ------------------------------------------------------------------ parent gate */
test('parent gate: random taps without the 3 s hold never pass (fuzz)', () => {
  const rnd = mulberry32(7);
  for (let trial = 0; trial < 2000; trial++) {
    const g = new GateMachine(mulberry32(trial));
    let t = 0;
    for (let i = 0; i < 3 + Math.floor(rnd() * 20); i++) {
      t += 50 + rnd() * 400;
      const r = rnd();
      if (r < 0.15) { g.pressHold(t); t += rnd() * (GATE_HOLD_MS - 100); g.releaseHold(t); } // short holds only
      else if (r < 0.75) g.digit(Math.floor(rnd() * 10));
      else if (r < 0.85) g.backspace();
      else g.submit();
      g.update(t);
    }
    assert.notEqual(g.stage, 'passed');
    assert.equal(g.stage, 'hold', 'never even reaches the sum without a full hold');
  }
});

test('parent gate: hold 3 s, then the right sum passes; wrong answers re-roll, 3 wrong go back to hold', () => {
  const g = new GateMachine(mulberry32(1));
  g.digit(5); g.submit();
  assert.equal(g.stage, 'hold');
  g.pressHold(1000);
  assert.equal(g.update(2000), false);
  assert.ok(Math.abs(g.holdProgress(2500) - 0.5) < 1e-9);
  g.releaseHold(2500);
  assert.equal(g.stage, 'hold', 'letting go early resets');
  assert.equal(g.holdProgress(2600), 0);
  g.pressHold(3000);
  assert.equal(g.update(3000 + GATE_HOLD_MS), true, 'completes while still held');
  assert.equal(g.stage, 'answer');
  const { a, b, answer } = g.sum;
  assert.ok(a >= 10 && a <= 99 && b >= 10 && b <= 99 && answer === a + b);
  for (const d of String(answer + 1)) g.digit(d);
  assert.equal(g.submit(), 'wrong');
  assert.equal(g.stage, 'answer');
  g.submit(); assert.equal(g.submit(), 'reset');
  assert.equal(g.stage, 'hold');
  g.pressHold(10000); g.releaseHold(10000 + GATE_HOLD_MS + 1);
  assert.equal(g.stage, 'answer', 'release after the full time also completes');
  for (const d of String(g.sum.answer)) g.digit(d);
  g.digit(1); g.backspace();
  assert.equal(g.submit(), 'passed');
  assert.ok(g.passed);
  for (let i = 0; i < 200; i++) { const s = makeSum(mulberry32(i)); assert.ok(s.a >= 11 && s.b <= 49 && s.answer >= 22 && s.answer <= 98); }
});

/* ------------------------------------------------------------------ names, choices, paging */
test('world names, new-world options and mode keys', () => {
  const rnd = mulberry32(3);
  const taken = [];
  for (let i = 0; i < 300; i++) {
    const n = makeWorldName('flat', taken, rnd);
    assert.ok(!taken.map((x) => x.toLowerCase()).includes(n.toLowerCase()), 'unique');
    taken.push(n);
  }
  assert.match(makeWorldName('snowy', [], rnd), /^[A-Z][A-Za-z ]+ \d+$/);
  assert.equal(cleanWorldName('  My\u0007   World  '), 'My World');
  assert.equal(cleanWorldName('x'.repeat(50)).length, 32);
  assert.deepEqual(PRESET_CHOICES.map((p) => p.key), ['flat', 'default', 'snowy'], 'Flat offered first');
  assert.equal(MODE_CHOICES.length, 3);
  const o = newWorldOptions('flat', 'easy', [], rnd);
  assert.equal(o.preset, 'flat'); assert.equal(o.mode, 'survival'); assert.equal(o.difficulty, 'easy');
  const d = newWorldOptions('bogus', 'bogus', [], rnd);
  assert.equal(d.preset, 'default'); assert.equal(d.mode, 'creative'); assert.equal(d.difficulty, 'peaceful');
  assert.equal(newWorldOptions('default', 'normal').difficulty, 'normal');
  assert.equal(modeKeyOf({ mode: 'creative' }), 'creative');
  assert.equal(modeKeyOf({ mode: 'survival', difficulty: 'normal' }), 'normal');
  assert.equal(modeKeyOf({ mode: 'survival', difficulty: 'easy' }), 'easy');
});

test('world picker paging: no scrolling, big arrows fit at 1280x720 and 375 px', () => {
  const wide = pickerGrid(1280, 720);
  assert.equal(wide.arrowsBelow, false);
  assert.ok(wide.cols >= 3 && wide.rows === 2, JSON.stringify(wide));
  const phone = pickerGrid(375, 667, 272, 180, 16, { top: 112, arrow: 96 });
  assert.equal(phone.arrowsBelow, true);
  assert.equal(phone.cols, 1);
  assert.equal(phone.rows, 2);
  assert.ok(112 + 2 * 180 + 16 + 28 + 16 + 96 <= 667 - 24, 'two rows + dots + arrows fit a 667 px phone');
  assert.equal(pageCount(0, 6), 1);
  assert.equal(pageCount(7, 6), 2);
  const s = pageSlice([1, 2, 3, 4, 5, 6, 7], 3, 9);
  assert.deepEqual(s, { page: 2, pages: 3, items: [7] });
});

/* ------------------------------------------------------------------ autosave cadence */
test('autosave: 2.5 s after the last block change, and at least every 30 s while changing', () => {
  const s = new AutosaveScheduler();
  assert.equal(s.due(0), null);
  s.noteBlockChange(1000);
  assert.equal(s.due(1000 + AUTOSAVE_DEBOUNCE_MS - 1), null);
  assert.equal(s.due(1000 + AUTOSAVE_DEBOUNCE_MS), 'debounce');
  s.saved();
  assert.equal(s.due(100000), null);
  // continuous building: debounce never settles, the 30 s cap still saves
  let t = 0;
  let saves = 0;
  for (; t < 95000; t += 500) { s.noteBlockChange(t); if (s.due(t)) { saves++; s.saved(); } }
  assert.equal(saves, 3, 'one save per 30 s');
  // soft changes only (walking around): saved within 30 s
  const s2 = new AutosaveScheduler();
  s2.noteSoftChange(0);
  assert.equal(s2.due(AUTOSAVE_MAX_MS - 1), null);
  assert.equal(s2.due(AUTOSAVE_MAX_MS), 'interval');
});

/* ------------------------------------------------------------------ save system (memory backend) */
function fakeWorld() {
  const cols = new Map();      // 'cx,cz' -> {blocks, be, dirty}
  const calls = [];
  const w = {
    isOpen: true,
    pendingSave: new Map(),
    savedColumns: new Map(),
    set(cx, cz, v) { const blocks = new Uint16Array(COLUMN_VOLUME).fill(v); cols.set(colKey(cx, cz), { cx, cz, blocks, be: [{ i: 5, data: { kind: 'chest', items: [] } }], dirty: true }); },
    getDirtyColumns() { return [...cols.values()].filter((c) => c.dirty).map((c) => [c.cx, c.cz]); },
    exportColumn(cx, cz) {
      calls.push(['export', cx, cz]);
      const c = cols.get(colKey(cx, cz));
      if (c) return { blocks: c.blocks.slice(), blockEntities: c.be };
      const p = w.pendingSave.get(colKey(cx, cz));
      return p ? { blocks: p.blocks, blockEntities: p.blockEntities || [] } : null;
    },
    markColumnSaved(cx, cz) {
      calls.push(['mark', cx, cz]);
      const c = cols.get(colKey(cx, cz));
      if (c) c.dirty = false;
      const p = w.pendingSave.get(colKey(cx, cz));
      if (p) { w.savedColumns.set(colKey(cx, cz), p); w.pendingSave.delete(colKey(cx, cz)); }
    },
    calls,
  };
  return w;
}

function fakeGame(backend) {
  const events = new EventBus();
  const game = {
    events, state: 'playing', version: 'test',
    settings: { lastWorldId: null },
    errors: [],
    setSetting(k, v) { game.settings[k] = v; events.emit('settings:changed', { key: k, value: v, settings: game.settings }); },
    reportError(err, where) { game.errors.push(`${where}: ${err && err.message}`); },
    meta: null,
    world: fakeWorld(),
    renderer: { captureThumbnail: () => 'data:image/jpeg;base64,' + 'A'.repeat(400) },
    systems: [],
  };
  game.systems.push({ name: 'player', serialize: () => ({ x: 1, y: 2, z: 3 }) });
  game.systems.push({ name: 'boom', serialize: () => { throw new Error('nope'); } });
  game.save = createSaveSystem(game, { backend });
  game.systems.push(game.save);
  game.exitToTitle = async () => { await game.save.saveNow('exit'); events.emit('world:exit', { meta: game.meta }); game.meta = null; };
  game.startWorld = async (d) => { game.meta = d.meta; game.loaded = d; events.emit('world:ready', { meta: d.meta, isNew: false }); };
  return game;
}

function openWorld(game, id = 'w1', extra = {}) {
  game.meta = { id, name: 'Test ' + id, seed: 5, preset: 'flat', mode: 'creative', difficulty: 'peaceful', rules: { ...DEFAULT_RULES }, createdAt: 1, lastPlayed: 1, playTicks: 0, spawn: { x: 0, y: 4, z: 0 }, home: null, thumbnail: null, formatVersion: 1, systems: {}, ...extra };
  game.events.emit('world:starting', { meta: game.meta, isNew: false });
  game.events.emit('world:ready', { meta: game.meta, isNew: false });
}

test('save: one transaction with meta + dirty columns; export and markColumnSaved together; events', async () => {
  const be = createMemoryBackend();
  const game = fakeGame(be);
  await game.save.init(game);
  assert.equal(game.save.backend, 'memory');
  assert.equal(await game.save.saveNow('test'), false, 'nothing open yet');
  openWorld(game);
  assert.equal(game.settings.lastWorldId, 'w1', 'opening a world remembers it');
  game.world.set(0, 0, ID.stone);
  game.world.set(1, 0, ID.dirt);
  game.world.pendingSave.set('5,5', { blocks: new Uint16Array(COLUMN_VOLUME).fill(ID.gold_block), blockEntities: [] });
  const done = [];
  game.events.on('save:done', (e) => done.push(e));
  const ok = await game.save.saveNow('test');
  assert.equal(ok, true);
  assert.deepEqual(game.world.calls.map((c) => c[0]), ['export', 'mark', 'export', 'mark', 'export', 'mark'], 'mark right after each export');
  assert.equal(game.world.pendingSave.size, 0);
  assert.equal(be.cols.size, 3);
  const rec = be.cols.get('w1:5:5');
  assert.equal(rec.worldId, 'w1'); assert.equal(rec.v, 1);
  assert.equal(decodeColumn(rec.data)[100], ID.gold_block);
  const m = be.worlds.get('w1');
  assert.deepEqual(m.systems.player, { x: 1, y: 2, z: 3 }, 'system serialize stored');
  assert.ok(game.errors.some((e) => e.startsWith('boom.serialize')), 'a throwing serialize is reported, not fatal');
  assert.equal(done.length, 1); assert.equal(done[0].ok, true); assert.equal(done[0].reason, 'test');
  assert.ok(game.save.lastSaveAt > 0);
  assert.equal(game.save.saving, false);
  // nothing dirty -> meta only
  game.world.calls.length = 0;
  await game.save.saveNow('test');
  assert.equal(game.world.calls.length, 0);
});

test('save: a failed transaction keeps its columns and writes them first next time', async () => {
  const be = createMemoryBackend();
  const game = fakeGame(be);
  await game.save.init(game);
  openWorld(game);
  game.world.set(2, 3, ID.stone);
  be.failNext(1);
  assert.equal(await game.save.saveNow('test'), false);
  assert.equal(game.save.retryCount, 1);
  assert.equal(be.cols.size, 0);
  const loaded = await game.save.loadWorld('w1');
  assert.equal(loaded, null, 'meta was never written');
  assert.equal(await game.save.saveNow('test'), true);
  assert.equal(game.save.retryCount, 0);
  assert.ok(be.cols.has('w1:2:3'), 'the retried column landed');
});

test('save: requests during a save coalesce into one more save', async () => {
  const be = createMemoryBackend();
  const game = fakeGame(be);
  await game.save.init(game);
  openWorld(game);
  let writes = 0;
  const orig = be.write;
  be.write = (x) => { writes++; return orig(x); };
  const p1 = game.save.saveNow('a');
  const p2 = game.save.saveNow('b');
  const p3 = game.save.saveNow('c');
  assert.equal(p2, p3, 'queued requests share one promise');
  await Promise.all([p1, p2, p3]);
  assert.equal(writes, 2);
  const reasons = game.events.recent('save:done', 10).map((e) => e.payload.reason);
  assert.deepEqual(reasons, ['a', 'c']);
});

test('save: list, load (encoded columns), rename, delete with backups', async () => {
  const be = createMemoryBackend();
  const game = fakeGame(be);
  await game.save.init(game);
  openWorld(game, 'wa');
  game.world.set(0, 0, ID.stone);
  await game.save.saveNow('test');
  await new Promise((r) => setTimeout(r, 5));
  openWorld(game, 'wb', { preset: 'snowy' });
  await game.save.saveNow('pause');
  await game.save.backupsIdle;
  const list = await game.save.listWorlds();
  assert.deepEqual(list.map((w) => w.id), ['wb', 'wa'], 'newest first, backups hidden');
  assert.ok(list[0].thumbnail && list[0].thumbnail.startsWith('data:image'), 'pause captures a thumbnail');
  const d = await game.save.loadWorld('wa');
  assert.ok(d.columns instanceof Map);
  const c = d.columns.get('0,0');
  assert.ok(c.data instanceof Uint8Array && c.data[0] === 0x42, 'columns stay encoded');
  assert.equal(decodeColumn(c.data)[7], ID.stone);
  assert.equal(c.blockEntities[0].data.kind, 'chest');
  assert.equal(await game.save.renameWorld('wa', '  Castle   Hill '), 'Castle Hill');
  assert.equal((await game.save.loadWorld('wa')).meta.name, 'Castle Hill');
  assert.equal(await game.save.deleteWorld('wb'), false, 'the open world cannot be deleted');
  game.meta = null; game.events.emit('world:exit', {});
  assert.ok((await game.save.listBackups('wb')).length >= 1);
  assert.equal(await game.save.deleteWorld('wb'), true);
  assert.deepEqual((await game.save.listWorlds()).map((w) => w.id), ['wa']);
  assert.equal([...be.worlds.keys()].some((k) => k.startsWith('wb')), false, 'backups deleted too');
  assert.equal([...be.cols.keys()].some((k) => k.startsWith('wb')), false);
  game.settings.lastWorldId = 'wa';
  await game.save.deleteWorld('wa');
  assert.equal(game.settings.lastWorldId, null);
});

test('save: backups (rolling meta + daily snapshot) restore', async () => {
  const be = createMemoryBackend();
  const game = fakeGame(be);
  await game.save.init(game);
  openWorld(game, 'wr');
  game.world.set(0, 0, ID.stone);
  await game.save.saveNow('pause');
  await game.save.backupsIdle;
  let bs = await game.save.listBackups('wr');
  assert.deepEqual(bs.map((b) => b.kind).sort(), ['daily', 'meta']);
  // change the world after the snapshot: a new column + an edited column
  game.world.set(0, 0, ID.dirt);
  game.world.set(9, 9, ID.gold_block);
  game.meta.playTicks = 999;
  await game.save.saveNow('test');
  assert.equal(be.cols.size, 2 + 1, 'two world columns + one daily copy');
  // a second pause right away does not add another meta backup (10 min spacing)
  await game.save.saveNow('pause');
  await game.save.backupsIdle;
  bs = await game.save.listBackups('wr');
  assert.equal(bs.filter((b) => b.kind === 'meta').length, 1);
  const daily = bs.find((b) => b.kind === 'daily');
  assert.equal(await game.save.restoreBackup('wr', daily.id), true);
  assert.equal(game.loaded.meta.id, 'wr', 'the open world was closed, restored and reopened');
  const d = await game.save.loadWorld('wr');
  assert.equal(decodeColumn(d.columns.get('0,0').data)[3], ID.stone, 'block edit rolled back');
  assert.ok(!d.columns.has('9,9'), 'column added after the snapshot is gone');
  assert.equal(d.meta.playTicks, 0);
  assert.equal(d.meta.backupOf, undefined);
  assert.equal(await game.save.restoreBackup('other', daily.id), false);
});

test('save: export and import round trip (P2)', async () => {
  const be = createMemoryBackend();
  const game = fakeGame(be);
  await game.save.init(game);
  openWorld(game, 'wx');
  game.world.set(-3, 4, ID.oak_planks);
  await game.save.saveNow('test');
  const blob = await game.save.exportWorld('wx');
  assert.ok(blob && blob.size > 50);
  assert.match(blob.filename, /^blockcraft-test-wx-\d{4}-\d{2}-\d{2}\.json$/);
  const meta = await game.save.importWorld(blob);
  assert.ok(meta && meta.id !== 'wx');
  assert.equal(meta.name, 'Test wx copy');
  const d = await game.save.loadWorld(meta.id);
  assert.equal(decodeColumn(d.columns.get('-3,4').data)[0], ID.oak_planks);
  assert.equal(await game.save.importWorld('{"format":"nope"}'), null);
  assert.equal(await game.save.importWorld('not json'), null);
});

test('world file: base64 + validation', () => {
  const rnd = mulberry32(11);
  for (let n = 0; n < 40; n++) {
    const a = new Uint8Array(n * 7 + (n % 3)).map(() => Math.floor(rnd() * 256));
    assert.deepEqual(fromBase64(toBase64(a)), a);
  }
  assert.equal(toBase64(new TextEncoder().encode('Man')), 'TWFu');
  assert.throws(() => fromBase64('@@@@'));
  const blocks = new Uint16Array(COLUMN_VOLUME).fill(3);
  const text = encodeWorldFile({ id: 'w', name: 'Hi', seed: 3, preset: 'flat' }, [{ cx: 1, cz: -2, data: encodeColumn(blocks), blockEntities: [] }]);
  const back = decodeWorldFile(text);
  assert.equal(back.meta.name, 'Hi');
  assert.deepEqual(decodeColumn(back.columns[0].data), blocks);
  const bad = JSON.parse(text); bad.columns[0].data = toBase64(Uint8Array.from([0x42, 0x43, 1, 5, 0, 0]));
  assert.throws(() => decodeWorldFile(JSON.stringify(bad)), /short|truncated|overflow/);
  assert.throws(() => decodeWorldFile(JSON.stringify({ ...JSON.parse(text), version: 9 })), /version/);
  assert.equal(worldFileName({ name: 'Sunny Meadow 12!' }, new Date('2026-10-03T12:00:00Z')), 'blockcraft-sunny-meadow-12-2026-10-03.json');
});

test('save + real world module: an edit survives save -> load -> reopen (CONTRACT with CORE-C)', async () => {
  bindTextures(buildTextures());
  const be = createMemoryBackend();
  const events = new EventBus();
  const game = {
    events, state: 'playing', settings: { fancyLeaves: true, smoothLighting: true, waving: true, lastWorldId: null }, renderer: null,
    player: { x: 8.5, y: 4, z: 8.5 }, perf: { frameMs: 16, workMs: 2 }, tickCount: 0, isCreative: () => true,
    setSetting(k, v) { game.settings[k] = v; }, reportError(err) { throw err; }, systems: [],
    meta: { id: 'wc', name: 'C', seed: 1, preset: 'flat', mode: 'creative', difficulty: 'peaceful', rules: { ...DEFAULT_RULES }, systems: {} },
  };
  const w = createWorldSystem(game);
  game.world = w;
  if (w.init) w.init(game);
  game.save = createSaveSystem(game, { backend: be });
  await game.save.init(game);
  w.open(game.meta, null);
  w.setRenderDistance(3);
  for (let i = 0; i < 3000 && !w.isColumnLoaded(0, 0); i++) w.frame(game, 0.016);
  events.emit('world:ready', { meta: game.meta, isNew: false });
  assert.ok(w.setBlock(2, 4, 2, ID.gold_block, 0, { cause: 'test' }));
  assert.equal(await game.save.saveNow('test'), true);
  assert.equal(w.getDirtyColumns().length, 0, 'saved columns are no longer dirty');
  w.close();
  const d = await game.save.loadWorld('wc');
  assert.ok(d.columns.has('0,0'));
  w.open(d.meta, d.columns);
  for (let i = 0; i < 3000 && !w.isColumnLoaded(0, 0); i++) w.frame(game, 0.016);
  assert.equal(w.getBlock(2, 4, 2), ID.gold_block, 'the edit came back from the save');
  w.close();
});
