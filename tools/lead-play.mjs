// OWNER: LEAD (integration). End-to-end play-through of the whole game the way a 5-year-old (and a parent) plays
// it, on the merged build: real mouse clicks, holds and keys through Playwright, a screenshot at every step in
// .tmp/lead-play/NN-<step>.png, PASS/FAIL lines and .tmp/lead-play/report.json.
//
//   node build.mjs --dev --out .tmp/lead-dev && node tools/lead-play.mjs [--file .tmp/lead-dev/index.html]
//        [--only kid,survival] [--headed] [--swiftshader] [--seed 12345|random] [--seed2 314|random]
//
// The test API (window.__game) is used to READ state, to find things on the map (where is the nearest pig or
// tree), and where a scripted player cannot do what a child does by eye: turn toward a thing before tapping
// it, skip the 10-minute day to the night, and stand in for a sheep hunt (3 wool). Everything else - menus,
// the picker, building, feeding, riding, TNT, Undo, Home, punching a tree, the recipe book, the crafting table,
// mining, the furnace and the bed - goes through real clicks, holds and keys.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const FILE = resolve(ROOT, opt('--file', '.tmp/lead-dev/index.html'));
const ONLY = opt('--only') ? opt('--only').split(',') : null;
// After the real title / New World flow has opened a world, the scripted play continues in a world with the same
// options and a FIXED seed, so the scripted taps land the same way every run ('random' keeps the menu's world).
const SEED = opt('--seed', '12345');
const SEED2 = opt('--seed2', '314');
const OUT = join(ROOT, '.tmp', argv.includes('--swiftshader') ? 'lead-play-ss' : 'lead-play');
if (!existsSync(FILE)) throw new Error(`no build at ${FILE} (node build.mjs --dev --out .tmp/lead-dev)`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const W = 1280, H = 720;
const launchArgs = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'];
if (argv.includes('--swiftshader')) launchArgs.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: !argv.includes('--headed'), args: launchArgs });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/GPU stall|CONTEXT_LOST/i.test(m.text())) pageErrors.push('console.error: ' + m.text()); });
await page.goto(pathToFileURL(FILE).href);
await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });

/* ------------------------------------------------------------------ helpers */
const results = [];
let shotN = 0;
const call = (m, ...a) => page.evaluate(({ m, a }) => window.__game[m](...a), { m, a });
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const p = join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); return p; };
const check = (name, ok, detail = '') => {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  return ok;
};
const note = (s) => console.log(`      ${s}`);
const waitUI = async (name, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await call('uiOpen')) === name) return true; await sleep(50); } return false; };
const waitFor = async (fn, arg, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(fn, arg)) return true; await sleep(80); } return false; };
const ticks = (n) => call('waitTicks', n);

/** A real click: mouse down, short pause, up (kid scheme: a tap = use). */
async function click(x, y) { await page.mouse.move(x, y); await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(80); }
/** A real hold at a pixel for ms (kid scheme: hold = hit / mine). */
async function hold(x, y, ms) { await page.mouse.move(x, y); await page.mouse.down(); await sleep(ms); await page.mouse.up(); await sleep(60); }
async function centreOf(sel) {
  return ev((sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); if (!b.width) return null; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
}
async function clickSel(sel) { const c = await centreOf(sel); if (!c) throw new Error('not on screen: ' + sel); await click(c.x, c.y); }
async function key(code, ms = 80) { await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code); await sleep(40); }
async function worldPx(x, y, z) {
  const n = await call('worldToNdc', x, y, z);
  if (!n.onScreen) return null;
  return { x: ((n.x + 1) / 2) * W, y: ((1 - n.y) / 2) * H };
}
/** Turn toward a point (what a child does by eye), then its pixel. */
async function look(x, y, z, pitchUp = 0) {
  await call('lookAt', x, y, z);
  if (pitchUp) await call('look', 0, pitchUp);
  await call('waitFrames', 2);
  return worldPx(x, y, z);
}
const inv = () => ev(() => window.__game.game.inventory.slots.map((s) => s && { item: s.item, count: s.count }));
const countOf = (item) => ev((item) => window.__game.game.inventory.slots.reduce((n, s) => n + (s && s.item === item ? s.count : 0), 0), item);
const countWhere = (re) => ev((src) => { const r = new RegExp(src); return window.__game.game.inventory.slots.reduce((n, s) => n + (s && r.test(s.item) ? s.count : 0), 0); }, re.source);
const pos = () => call('pos');
/** Where the last block went ({x, y, z, id} of the newest block:placed), or null. */
const lastPlaced = async () => { const e = await call('events', 'block:placed', 1); return e.length ? e[e.length - 1].payload : null; };
const ents = () => call('entities');
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Kid creative picker: open with the backpack, choose the hotbar slot, find the item on its tab, tap it, close. */
async function pick(item, slot) {
  if ((await call('uiOpen')) !== 'creative') {
    await clickSel('#hud .inv-backpack');
    if (!(await waitUI('creative'))) throw new Error('picker did not open');
  }
  await clickSel(`.inv-pick-hotbar .inv-hb-slot[data-slot="${slot}"]`);
  const tabs = await ev(() => [...document.querySelectorAll('.inv-tab')].map((t) => t.dataset.tab));
  let found = false;
  for (const tb of tabs) {
    await clickSel(`.inv-tab[data-tab="${tb}"]`);
    const tiles = () => ev(() => [...document.querySelectorAll('.inv-tile')].map((t) => t.dataset.item).join());
    for (let i = 0; i < 4; i++) {   // back to the first page (the picker remembers the page)
      const b = await tiles();
      if (!(await centreOf('.inv-arrow-btn[data-action="prev"]'))) break;
      await clickSel('.inv-arrow-btn[data-action="prev"]');
      if ((await tiles()) === b) break;
    }
    for (let i = 0; i < 6; i++) {
      if (await ev((item) => !!document.querySelector(`.inv-tile[data-item="${item}"]`), item)) { found = true; break; }
      if (!(await centreOf('.inv-arrow-btn[data-action="next"]'))) break;
      const before = await ev(() => [...document.querySelectorAll('.inv-tile')].map((t) => t.dataset.item).join());
      await clickSel('.inv-arrow-btn[data-action="next"]');
      if ((await ev(() => [...document.querySelectorAll('.inv-tile')].map((t) => t.dataset.item).join())) === before) break;
    }
    if (found) break;
  }
  if (!found) throw new Error('item not in the picker: ' + item);
  await clickSel(`.inv-tile[data-item="${item}"]`);
  await call('waitFrames', 6);
  return true;
}
async function closePicker() { await click(8, 8); await waitUI(null, 1500); }
async function selectHud(slot) { await clickSel(`#hud .inv-hb-slot[data-slot="${slot}"]`); await ticks(2); }
/** Tap the top face of the block at (x, y, z). */
async function tapTop(x, y, z) {
  const p = await look(x + 0.5, y + 1, z + 0.5, 6);
  if (!p) throw new Error(`top of ${x},${y},${z} not on screen`);
  const q = await worldPx(x + 0.5, y + 1, z + 0.5);
  await click(q.x, q.y);
  await ticks(3);
}
async function tapSide(x, y, z) {
  const me = await pos();
  const dx = me.x - (x + 0.5), dz = me.z - (z + 0.5);
  const fx = Math.abs(dx) >= Math.abs(dz) ? x + 0.5 + Math.sign(dx) * 0.5 : x + 0.5;
  const fz = Math.abs(dx) >= Math.abs(dz) ? z + 0.5 : z + 0.5 + Math.sign(dz) * 0.5;
  await look(fx, y + 0.5, fz);
  const q = await worldPx(fx, y + 0.5, fz);
  await click(q.x, q.y);
  await ticks(3);
}
/** Tap (or hold on) an entity's body. */
async function tapEntity(id, holdMs = 0) {
  let e = (await ents()).find((x) => x.id === id);
  if (!e) throw new Error('no entity ' + id);
  // animals wander: step up close first (taps reach animals 5 blocks away)
  const me0 = await pos();
  if (Math.hypot(e.x - me0.x, e.z - me0.z) > 3.2) { await walkTo(e.x, e.z, 2.2, 5000); e = (await ents()).find((x) => x.id === id) || e; }
  const hgt = await ev((id) => window.__game.game.entities.get(id).height, id);
  await look(e.x, e.y + hgt * 0.55, e.z);
  const e2 = (await ents()).find((x) => x.id === id);
  const q = await worldPx(e2.x, e2.y + hgt * 0.55, e2.z);
  await page.mouse.move(q.x, q.y);
  await call('waitFrames', 2);
  const aimed = await ev(() => { const t = window.__game.game.interaction.targetEntity; return t ? t.entity.id : null; });
  if (aimed !== id) {
    note(`tap on entity ${id}: the cursor is on ${aimed === null ? 'no entity' : 'entity ' + aimed} (${JSON.stringify(await call('target'))}, ${Math.hypot(e2.x - (await pos()).x, e2.z - (await pos()).z).toFixed(1)} blocks away, pixel ${q.x.toFixed(0)},${q.y.toFixed(0)}, under it: ${await ev(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className) : null; }, [q.x, q.y])}, aim ${JSON.stringify(await ev(() => window.__game.game.input.aim))})`);
    await shot(`miss-entity-${id}`);
  }
  if (holdMs) await hold(q.x, q.y, holdMs); else await click(q.x, q.y);
  await ticks(3);
  return aimed === id;
}
/** Walk toward a point with the real W key (kid scheme: W forward, the view turned toward it). */
async function walkTo(x, z, near = 2.5, maxMs = 12000) {
  const t0 = Date.now();
  let p = await pos();
  while (Date.now() - t0 < maxMs && Math.hypot(p.x - x, p.z - z) > near) {
    await call('lookAt', x, p.y + 1.62, z);
    await page.keyboard.down('KeyW');
    await sleep(500);
    await page.keyboard.up('KeyW');
    const q = await pos();
    if (Math.hypot(q.x - p.x, q.z - p.z) < 0.3) { await key('Space', 60); }   // a bump: hop like a child does
    p = q;
  }
  return Math.hypot(p.x - x, p.z - z) <= near;
}
/** Free standing cells 2-3 blocks from block (x, y, z) at about its height (feet y within 2, 2 cells of air). */
const standNear = async (x, y, z) => (await standCells(x, y, z))[0] || null;
const standCells = (x, y, z) => ev(([x, y, z]) => {
  const out = [];
  const w = window.__game.game.world, solid = (id) => id !== 0 && !/grass$|fern|flower|poppy|dandelion|tulip|orchid|allium|lily|cornflower|bush|sapling|torch/.test(window.__game.blockNameOf ? window.__game.blockNameOf(id) : '');
  for (const [dx, dz] of [[0, 2], [2, 0], [0, -2], [-2, 0], [2, 2], [-2, 2], [2, -2], [-2, -2], [0, 3], [3, 0], [0, -3], [-3, 0]]) {
    for (const fy of [y, y + 1, y - 1, y + 2, y - 2]) {
      const g = window.__game.getBlock(x + dx, fy - 1, z + dz), a = window.__game.getBlock(x + dx, fy, z + dz), b = window.__game.getBlock(x + dx, fy + 1, z + dz);
      const air = (n) => n === 'air' || /short_grass|fern|flower|poppy|dandelion|tulip|orchid|allium|lily|cornflower|dead_bush/.test(n);
      if (g !== 'air' && !air(g) && !/leaves|water|lava/.test(g) && air(a) && air(b)) { out.push({ x: x + dx + 0.5, y: fy, z: z + dz + 0.5 }); break; }
    }
  }
  return out;
}, [x, y, z]);
/** Put the held block down on the ground near the player: try free spots until one tap places it; if none works,
 *  step back a little (like a child making room) and try again. -> {x, y, z} | null */
async function placeNearby(retry = true) {
  const got = await placeNearbyOnce();
  if (got || !retry) return got;
  note('no room here: stepping back');
  await call('setLook', ((await pos()).yaw + 180) % 360, -10);
  await page.keyboard.down('KeyW'); await sleep(700); await page.keyboard.up('KeyW');
  await ticks(5);
  return placeNearbyOnce();
}
async function placeNearbyOnce() {
  const spots = await groundSpots();
  if (!spots.length) note('no free ground spot around the player');
  for (const gs of spots) {
    const before = await call('eventCount', 'block:placed');
    await tapTop(gs.x, gs.y, gs.z);
    if ((await call('uiOpen')) !== null) { note(`a tap at ${gs.x},${gs.y},${gs.z} opened ${await call('uiOpen')}`); await call('closeUI'); continue; }   // the tap hit a table or furnace
    if ((await call('eventCount', 'block:placed')) > before) return lastPlaced();
    note(`a tap on the ground at ${gs.x},${gs.y},${gs.z} placed nothing (cursor on ${JSON.stringify(await call('target'))})`);
  }
  return null;
}
async function groundSpot() { return (await groundSpots())[0]; }
/** Tops of ground blocks 2 blocks from the player at their own height with free air above (to put something on). */
async function groundSpots() {
  const p = await pos();
  return ev(([px, py, pz]) => {
    const out = [];
    const air = (n) => n === 'air' || /short_grass|fern|poppy|dandelion|tulip|orchid|allium|lily|cornflower|dead_bush/.test(n);
    const fx = Math.floor(px), fz = Math.floor(pz), fy = Math.round(py);
    for (const [dx, dz] of [[0, -2], [2, 0], [-2, 0], [0, 2], [2, -2], [-2, -2], [2, 2], [-2, 2], [0, -3], [3, 0], [-3, 0], [0, 3], [1, -2], [-1, -2], [2, 1], [-2, 1]]) {
      const g = window.__game.getBlock(fx + dx, fy - 1, fz + dz);
      if (!air(g) && !/leaves|water|lava|table|furnace|bed|chest/.test(g) && air(window.__game.getBlock(fx + dx, fy, fz + dz)) && air(window.__game.getBlock(fx + dx, fy + 1, fz + dz))) out.push({ x: fx + dx, y: fy - 1, z: fz + dz });
    }
    if (!out.length) out.push({ x: fx, y: fy - 1, z: fz - 2 });
    return out;
  }, [p.x, p.y, p.z]);
}
const section = async (name, fn) => {
  if (ONLY && !ONLY.includes(name)) return;
  console.log(`\n=== ${name}`);
  try { await fn(); } catch (err) { check(`${name}: ran to the end`, false, err.message); try { await shot(`${name}-ERROR`); } catch { /* ignore */ } }
};

/* ================================================================== 1. kid creative world */
await section('kid', async () => {
  await call('setSetting', 'lastWorldId', null);
  check('title screen at start', (await call('uiOpen')) === 'title');
  await shot('title');
  await clickSel('[data-screen=title] [data-action=play]');
  const ready = await waitFor(() => window.__game.state() === 'playing' && window.__game.worldReady, null, 15000);
  const meta = await call('meta');
  check('Play opens a kid creative world', ready && meta.mode === 'creative', `${meta.name} ${meta.preset} ${meta.mode}`);
  await call('waitFrames', 30);
  await shot('kid-world');
  if (SEED !== 'random') {
    note(`continuing in the same kind of world with the fixed seed ${SEED}`);
    await call('startWorld', { preset: meta.preset, mode: meta.mode, difficulty: meta.difficulty, name: meta.name, seed: Number(SEED) });
    await call('waitFrames', 30);
  }
  const home = await pos();

  // --- picker: two blocks a child wants
  await pick('yellow_wool', 1);
  await shot('kid-picker');
  await pick('glass', 2);
  await closePicker();
  const hb = (await inv()).slice(0, 9).map((s) => s && s.item);
  check('picker: yellow wool and glass land in the hotbar', hb[1] === 'yellow_wool' && hb[2] === 'glass', hb.join(','));

  // --- build: a little yellow wall with a glass window, tap by tap
  await selectHud(1);
  await key('Digit2');
  check('number key 2 selects slot 2', (await call('selected')).slot === 1);
  // two towers of yellow wool, three high, with a glass block on top: every tap lands on the top of the block the
  // last tap made (whatever the hills look like)
  // a child walks to an open, flat patch of grass first
  const flat = await ev(() => {
    const g = window.__game.game, w = g.world, p = g.player, sy = (x, z) => w.getSurfaceY(x + 0.5, z + 0.5);
    let best = null;
    for (let r = 2; r <= 30 && !best; r++) for (let dx = -r; dx <= r && !best; dx++) for (const dz of [-r, r]) {
      const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz, y = sy(x, z);
      let ok = Math.abs(y - p.y) <= 6 && !/water|lava/.test(window.__game.getBlock(x, y - 1, z));
      const grassy = new Set(['short_grass', 'fern', 'dandelion', 'poppy', 'cornflower'].map((n) => window.__game.blockId(n)));
      for (let ax = -1; ax <= 1 && ok; ax++) for (let az = -5; az <= 1 && ok; az++) {
        if (sy(x + ax, z + az) !== y) ok = false;
        for (let h = 0; h < 5 && ok; h++) { const id = w.getBlock(x + ax, y + h, z + az); if (id !== 0 && !(h === 0 && grassy.has(id))) ok = false; }
      }
      if (ok) best = { x, y, z };
    }
    return best;
  });
  if (flat) {
    await walkTo(flat.x + 0.5, flat.z + 0.5, 0.7, 10000);
    if (Math.hypot((await pos()).x - flat.x - 0.5, (await pos()).z - flat.z - 0.5) > 1) await call('teleport', flat.x + 0.5, flat.y, flat.z + 0.5);
    await call('setLook', 0, -20);
    await ticks(5);
  }
  note(`building spot ${JSON.stringify(flat)}`);
  const p0 = await pos();
  const placed0 = await call('eventCount', 'block:placed');
  let tops = [];
  for (const dx of [-1, 0, 1]) {
    await key('Digit2');
    const gx = Math.floor(p0.x) + dx, gz = Math.floor(p0.z) - 4;
    let cell = { x: gx, y: (await call('surfaceY', gx, gz)) - 1, z: gz };
    for (let k = 0; k < 2; k++) {   // the top of a 2-high stack is above the eye: a child cannot tap it
      if (k === 1) await key('Digit3');
      const before = await call('eventCount', 'block:placed');
      await tapTop(cell.x, cell.y, cell.z);
      if ((await call('eventCount', 'block:placed')) === before) { note(`tap on top of ${JSON.stringify(cell)} placed nothing; target ${JSON.stringify(await call('target'))}`); break; }
      cell = await lastPlaced();
    }
    tops.push(await call('getBlock', cell.x, cell.y, cell.z));
  }
  const placedN = (await call('eventCount', 'block:placed')) - placed0;
  check('tapping builds a little wall: yellow wool with glass on top (6 blocks)', placedN === 6 && tops.every((b) => b === 'glass'), `${placedN} placed, tops ${tops.join(',')}`);
  await call('setLook', 0, -10);
  await call('waitFrames', 10);
  await shot('kid-built-wall');

  // --- find an animal and feed it
  const me = await pos();
  const animals = (await ents()).filter((e) => ['cow', 'sheep', 'pig', 'chicken'].includes(e.type)).map((e) => ({ ...e, d: dist2(e, me) })).sort((a, b) => a.d - b.d);
  check('animals live near the spawn', animals.length > 0, animals.slice(0, 5).map((a) => `${a.type}@${a.d.toFixed(0)}`).join(' '));
  const target = animals.find((a) => a.type === 'cow' || a.type === 'sheep') || animals[0];
  if (target) {
    const food = { cow: 'wheat', sheep: 'wheat', pig: 'carrot', chicken: 'wheat_seeds' }[target.type];
    await pick(food, 3);
    await closePicker();
    await key('Digit4');
    const reached = await walkTo(target.x, target.z, 3, 15000);
    let t2 = (await ents()).find((e) => e.id === target.id);
    if (!reached) {
      note(`walk to the ${target.type} blocked by the terrain: hopping over in creative flight`);
      await key('KeyF');
      await call('teleport', t2.x + 2.5, t2.y + 0.2, t2.z);
      await ticks(10);
      t2 = (await ents()).find((e) => e.id === target.id);
    }
    check(`walked up to a ${target.type}`, reached || Math.hypot(t2.x - (await pos()).x, t2.z - (await pos()).z) < 4);
    await tapEntity(target.id);
    const fed = await ev((id) => { const e = window.__game.game.entities.get(id); return e ? { love: e.data.love || 0, baby: !!e.data.baby } : null; }, target.id);
    check(`a tap with ${food} feeds the ${target.type} (love)`, fed && fed.love > 0, fed);
    await call('waitFrames', 20);
    await shot(`kid-fed-${target.type}`);
  }

  // --- ride a pig: saddle tap, tap to get on, carrot on a stick to steer, C to get off
  let pig = (await ents()).filter((e) => e.type === 'pig').map((e) => ({ ...e, d: dist2(e, me) })).sort((a, b) => a.d - b.d)[0];
  if (!pig || pig.d > 60) {
    note('no pig within 60 blocks of the spawn: a pig spawn egg from the Animals tab');
    await pick('pig_spawn_egg', 5);
    await closePicker();
    await key('Digit6');
    const q = await pos();
    const sy = await call('surfaceY', Math.floor(q.x) + 2, Math.floor(q.z) - 3);
    const before = new Set((await ents()).map((e) => e.id));
    await tapTop(Math.floor(q.x) + 2, sy - 1, Math.floor(q.z) - 3);
    pig = (await ents()).find((e) => e.type === 'pig' && !before.has(e.id));
    check('a spawn egg tap makes a pig', !!pig);
  } else {
    const ok = await walkTo(pig.x, pig.z, 3, 15000);
    if (!ok) { const t = (await ents()).find((e) => e.id === pig.id); await call('teleport', t.x + 2.5, t.y + 0.2, t.z); await ticks(10); }
  }
  if (pig) {
    await pick('saddle', 4);
    await pick('carrot_on_a_stick', 5);
    await closePicker();
    await key('Digit5');
    for (let i = 0; i < 3; i++) { await tapEntity(pig.id); if ((await ents()).some((e) => e.type === 'pig' && e.data && e.data.saddled)) break; }
    // in a herd the tap may land on the pig next to it: that one gets the saddle, which is fine for a child
    const saddled = (await ents()).find((e) => e.type === 'pig' && e.data && e.data.saddled);
    if (saddled && saddled.id !== pig.id) { note(`the saddle went on pig ${saddled.id} (the one in front)`); pig = saddled; }
    check('a saddle tap saddles the pig', !!saddled);
    await key('Digit6');
    for (let i = 0; i < 3; i++) { await tapEntity(pig.id); if (await ev(() => window.__game.game.player.riding != null)) break; }
    const riding = await ev((id) => window.__game.game.player.riding === id || (window.__game.game.player.riding && window.__game.game.player.riding.id === id), pig.id);
    check('tapping the saddled pig gets the child on', riding);
    const r0 = (await ents()).find((e) => e.id === pig.id);
    await call('setLook', (await pos()).yaw, -5);
    await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
    const r1 = (await ents()).find((e) => e.id === pig.id);
    check('the carrot on a stick steers the pig forward', Math.hypot(r1.x - r0.x, r1.z - r0.z) > 0.8, `${Math.hypot(r1.x - r0.x, r1.z - r0.z).toFixed(1)} blocks in 2.5 s (hills and trees stop it)`);
    await shot('kid-riding-pig');
    await key('KeyV'); await call('waitFrames', 10); await shot('kid-riding-pig-3rd-person'); await key('KeyV'); await key('KeyV');
    await key('KeyC');
    await ticks(5);
    check('C gets off the pig', !(await ev(() => window.__game.game.player.riding)));
  }

  // --- TNT + Undo
  await pick('tnt', 6);
  await pick('flint_and_steel', 7);
  await closePicker();
  await key('Digit7');
  // a dry patch of ground (TNT under water breaks nothing, as in the original): the child goes back to the wall
  if (flat) { await walkTo(flat.x + 0.5, flat.z + 2.5, 1.0, 8000); await call('setLook', 0, -20); }
  let tp = null;
  for (const gs of await groundSpots()) {
    const wet = await ev(([x, y, z]) => { for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) if (/water|lava/.test(window.__game.getBlock(x + dx, y + dy, z + dz))) return true; return false; }, [gs.x, gs.y, gs.z]);
    if (wet) continue;
    const before = await call('eventCount', 'block:placed');
    await tapTop(gs.x, gs.y, gs.z);
    if ((await call('eventCount', 'block:placed')) > before) { tp = await lastPlaced(); break; }
  }
  if (!tp) throw new Error('no dry spot for the TNT');
  const tx = tp.x, ty = tp.y, tz = tp.z;
  check('TNT placed with a tap', (await call('getBlock', tx, ty, tz)) === 'tnt', `${tx},${ty},${tz}`);
  const snap = await ev(([x, y, z]) => { const w = window.__game.game.world, o = []; for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) o.push(w.getRaw(x + dx, y + dy, z + dz)); return o; }, [tx, ty, tz]);
  await call('waitFrames', 5);
  await shot('kid-tnt-placed');
  await key('Digit8');
  const boom0 = await call('eventCount', 'explosion');
  await tapSide(tx, ty, tz);
  if (!(await ents()).some((e) => e.type === 'tnt')) { note('the first flint tap missed the TNT: tapping its top'); await tapTop(tx, ty, tz); }
  check('flint and steel lights the TNT', (await ents()).some((e) => e.type === 'tnt'));
  await call('look', 0, 4);
  await sleep(1500);
  await shot('kid-tnt-fuse');
  const boomed = await waitFor((n) => window.__game.game.events.counts.get('explosion') > n, boom0, 8000);
  check('the TNT explodes', boomed);
  await call('waitFrames', 20);
  await shot('kid-tnt-crater');
  const diff1 = await ev(([x, y, z, snap]) => { const w = window.__game.game.world; let i = 0, n = 0; for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) if (w.getRaw(x + dx, y + dy, z + dz) !== snap[i++]) n++; return n; }, [tx, ty, tz, snap]);
  check('the blast makes a crater', diff1 > 10, `${diff1} cells changed`);
  await clickSel('[data-kid=undo]');
  await ticks(5);
  await call('waitFrames', 10);
  const diff2 = await ev(([x, y, z, snap]) => { const w = window.__game.game.world; let i = 0, n = 0; for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) if (w.getRaw(x + dx, y + dy, z + dz) !== snap[i++]) n++; return n; }, [tx, ty, tz, snap]);
  await shot('kid-tnt-undone');
  check('one Undo tap puts the whole crater back', diff2 <= 1, `${diff2} cells still different (the TNT block itself is gone)`);

  // --- Home
  await key('KeyF');
  await page.keyboard.down('Space'); await sleep(1200); await page.keyboard.up('Space');
  await call('setLook', 180, 0);
  await page.keyboard.down('KeyW'); await sleep(4000); await page.keyboard.up('KeyW');
  const away = await pos();
  await shot('kid-far-away');
  await clickSel('[data-kid=home]');
  await sleep(900);
  const back = await pos();
  check('the Home button brings the child home', Math.hypot(back.x - home.x, back.z - home.z) < 3, `away ${dist2(away, home).toFixed(0)} -> ${dist2(back, home).toFixed(1)}`);
  await call('waitFrames', 10);
  await shot('kid-home');
});

/* ================================================================== 2. survival easy world */
await section('survival', async () => {
  // to the title through the pause screen, then Worlds -> + -> pictures
  if (await ev(() => !!window.__game.game.meta)) {
    await key('Escape');
    check('Esc opens the pause screen', await waitUI('pause'));
    await shot('pause');
    await clickSel('[data-screen=pause] [data-action=quit]');
    check('the door button saves and goes to the title', await waitUI('title', 8000));
  }
  await clickSel('[data-screen=title] [data-action=worlds]');
  await waitUI('worlds');
  await waitFor(() => document.querySelector('[data-screen=worlds]')?.dataset.loaded === '1', null, 3000);
  await shot('worlds');
  await clickSel('[data-screen=worlds] [data-action=new-world]');
  await waitUI('newWorld');
  await clickSel('[data-choice=preset][data-value=default]');
  await clickSel('[data-choice=mode][data-value=easy]');
  await shot('new-world-survival-easy');
  await clickSel('[data-action=create-world]');
  const ready = await waitFor(() => window.__game.state() === 'playing' && window.__game.worldReady, null, 15000);
  const meta = await call('meta');
  check('a Survival Easy world starts', ready && meta.mode === 'survival' && meta.difficulty === 'easy', `${meta.name} seed ${meta.seed}`);
  if (SEED2 !== 'random') {
    note(`continuing in the same kind of world with the fixed seed ${SEED2}`);
    await call('startWorld', { preset: meta.preset, mode: meta.mode, difficulty: meta.difficulty, name: meta.name, seed: Number(SEED2) });
  }
  await call('waitFrames', 30);
  await shot('survival-start');
  check('survival starts with an empty bag', (await inv()).every((s) => !s));

  // --- punch a tree
  const tree = await ev(() => {
    const g = window.__game.game, w = g.world, p = g.player;
    const logs = new Set(['oak_log', 'birch_log', 'spruce_log'].map((n) => window.__game.blockId(n)));
    let best = null;
    for (let dx = -40; dx <= 40; dx++) for (let dz = -40; dz <= 40; dz++) {
      const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz;
      const top = w.getSurfaceY ? w.getSurfaceY(x + 0.5, z + 0.5) : -1;
      for (let y = Math.max(1, Math.floor(p.y) - 12); y < Math.floor(p.y) + 12; y++) {
        const id = w.getBlock(x, y, z);
        if (!logs.has(id) || logs.has(w.getBlock(x, y - 1, z))) continue;
        let h = 0; while (logs.has(w.getBlock(x, y + h, z))) h++;
        // a child picks a tree standing on open, level grass
        let flat = 0;
        for (let ax = -3; ax <= 3; ax++) for (let az = -3; az <= 3; az++) {
          if (!ax && !az) continue;
          if (window.__game.getBlock(x + ax, y - 1, z + az) === 'grass_block' && /^(air|short_grass|fern|poppy|dandelion|cornflower)$/.test(window.__game.getBlock(x + ax, y, z + az))) flat++;
        }
        const d = Math.hypot(dx, dz) + Math.abs(y - p.y) * 2 + (flat >= 24 ? 0 : 100);
        if (h >= 4 && (!best || d < best.d)) best = { x, y, z, h, d: Math.round(d), top, flat };
      }
    }
    return best;
  });
  check('a tree near the spawn', !!tree, tree);
  if (!tree) throw new Error('no tree');
  const logName = await call('getBlock', tree.x, tree.y, tree.z);
  const planks = logName.replace('_log', '_planks');
  // stand next to the trunk (walk there; hop over in a pinch)
  let stand = await standNear(tree.x, tree.y, tree.z);
  if (!stand) stand = { x: tree.x + 2.5, y: await call('surfaceY', tree.x + 2, tree.z), z: tree.z + 0.5 };
  const walked = await walkTo(stand.x, stand.z, 0.8, 20000);
  if (!walked) { note('walking to the tree was blocked: stepping next to it'); await call('teleport', stand.x, stand.y, stand.z); await ticks(10); }
  note(`${walked ? 'walked' : 'stepped'} to a ${logName} tree at ${tree.x},${tree.y},${tree.z} (${tree.h} high)`);
  let logsGot = 0;
  /** Hold the mouse on whatever the cursor shows until that block is gone (a child punches leaves in the way too). */
  const punchTarget = async () => {
    const tg = await call('target');
    if (!tg) return null;
    const q = await worldPx(tg.x + 0.5 + tg.nx * 0.5, tg.y + 0.5 + tg.ny * 0.5, tg.z + 0.5 + tg.nz * 0.5);
    if (!q) return null;
    await page.mouse.move(q.x, q.y);
    await page.mouse.down();
    const gone = await waitFor(([x, y, z, name]) => window.__game.getBlock(x, y, z) !== name, [tg.x, tg.y, tg.z, tg.name], 6000);
    await page.mouse.up();
    await ticks(8);
    return gone ? tg : null;
  };
  for (let k = 0; k < 5 && k < tree.h && logsGot < 4; k++) {
    const y = tree.y + k;
    for (let tries = 0; tries < 4; tries++) {
      await call('lookAt', tree.x + 0.5, y + 0.5, tree.z + 0.5);
      await call('waitFrames', 2);
      const tg = await call('target');
      if (!tg) { note(`log at y ${y} out of reach`); break; }
      const isLog = tg.x === tree.x && tg.y === y && tg.z === tree.z;
      if (!isLog && !/leaves|_log/.test(tg.name)) { note(`log at y ${y} hidden by ${tg.name}`); break; }
      const broke = await punchTarget();
      if (k === 0 && tries === 0) await shot('survival-punching-tree');
      if (isLog) { if (broke) logsGot++; break; }
    }
  }
  // the logs pop out as items: walk over each one (they pull in from 1.5 blocks)
  for (let i = 0; i < 6; i++) {
    const me3 = await pos();
    const it = (await ents()).filter((e) => e.type === 'item' && Math.hypot(e.x - me3.x, e.z - me3.z) < 10 && Math.abs(e.y - me3.y) < 4).sort((a, b) => Math.hypot(a.x - me3.x, a.z - me3.z) - Math.hypot(b.x - me3.x, b.z - me3.z))[0];
    if (!it) break;
    await walkTo(it.x, it.z, 0.4, 3000);
    await ticks(10);
  }
  await ticks(20);
  const logs = await countOf(logName);
  check('punching the trunk gives logs (held mouse, about 3 s each)', logs >= 3, `${logsGot} broken, ${logs} ${logName} in the bag`);
  await shot('survival-logs');

  // --- recipe book: planks, sticks, crafting table
  await clickSel('#hud .inv-backpack');
  check('the backpack opens the survival inventory', await waitUI('inventory'));
  const book = (item) => ev((item) => { const e = document.querySelector(`.inv-recipe[data-item="${item}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, dim: e.classList.contains('inv-needs-table') }; }, item);
  await call('waitFrames', 3);
  await shot('survival-recipe-book');
  for (let i = 0; i < logs; i++) { const t = await book(planks); if (!t) break; await click(t.x, t.y); await sleep(250); }
  check('recipe book: logs -> planks', (await countOf(planks)) >= 12, `${await countOf(planks)} ${planks}`);
  let t = await book('crafting_table'); if (t) { await click(t.x, t.y); await sleep(300); }
  t = await book('stick'); if (t) { await click(t.x, t.y); await sleep(300); }
  check('recipe book: a crafting table and sticks', (await countOf('crafting_table')) === 1 && (await countOf('stick')) >= 4, `table ${await countOf('crafting_table')} sticks ${await countOf('stick')}`);
  const pk = await book('wooden_pickaxe');
  check('the pickaxe shows it needs the table', !!pk && pk.dim);
  await shot('survival-crafted-table');
  await clickSel('.inv-close'); await waitUI(null);
  // place the table and open it
  let slots = await inv();
  const ti = slots.findIndex((s) => s && s.item === 'crafting_table');
  await selectHud(ti);
  const tpl = await placeNearby();
  const tbx = tpl ? tpl.x : 0, tby = tpl ? tpl.y : 0, tbz = tpl ? tpl.z : 0;
  check('a tap places the crafting table', (await call('getBlock', tbx, tby, tbz)) === 'crafting_table', `${tbx},${tby},${tbz}`);
  /** Walk back to the table and tap it (step next to it when the hills are in the way). */
  async function openTable() {
    const cells = await standCells(tbx, tby, tbz);
    for (let attempt = 0; attempt <= cells.length; attempt++) {
      const me2 = await pos();
      if (Math.hypot(me2.x - tbx - 0.5, me2.z - tbz - 0.5) > 3.5 || attempt > 0) {
        const st = cells[Math.max(0, attempt - 1)];
        if (!st) break;
        const ok = attempt === 0 && await walkTo(st.x, st.z, 1.0, 8000);
        if (!ok) { note('the way back to the table is blocked: stepping next to it'); await call('teleport', st.x, st.y, st.z); await ticks(5); }
      }
      await call('lookAt', tbx + 0.5, tby + 0.5, tbz + 0.5);
      await call('waitFrames', 2);
      const tg = await call('target');
      if (tg && tg.name === 'crafting_table') { await click(W / 2, H / 2); await ticks(3); if (await waitUI('crafting')) return true; }
      note(`table not reached from ${JSON.stringify(await pos().then((q) => [q.x.toFixed(1), q.y.toFixed(1), q.z.toFixed(1)]))}: cursor on ${JSON.stringify(tg)}`);
    }
    return false;
  }
  check('a tap on the table opens the 3x3 grid', await openTable());
  t = await book('wooden_pickaxe'); if (t) { await click(t.x, t.y); await sleep(400); }
  check('wooden pickaxe from the 3x3 recipe book', (await countOf('wooden_pickaxe')) === 1);
  await shot('survival-wooden-pickaxe');
  await clickSel('.inv-close'); await waitUI(null);

  // --- dig down for stone with the pickaxe (hold the mouse, looking straight down)
  slots = await inv();
  await selectHud(slots.findIndex((s) => s && s.item === 'wooden_pickaxe'));
  const shaft = await pos();
  await call('teleport', Math.floor(shaft.x) - 1.5, (await call('surfaceY', Math.floor(shaft.x) - 2, Math.floor(shaft.z))), Math.floor(shaft.z) + 0.5);
  await ticks(5);
  await call('setLook', (await pos()).yaw, -89);
  await page.keyboard.down('PageDown'); await sleep(300); await page.keyboard.up('PageDown');
  const y0 = (await pos()).y;
  await page.mouse.move(W / 2, H / 2);
  await page.mouse.down();
  const t0 = Date.now();
  while (Date.now() - t0 < 45000 && (await countOf('cobblestone')) < 9) await sleep(400);
  await page.mouse.up();
  const cob = await countOf('cobblestone');
  const dug = y0 - (await pos()).y;
  check('holding with the pickaxe digs down and collects cobblestone', cob >= 8, `${cob} cobblestone, ${dug.toFixed(1)} blocks down, ${await countOf('dirt')} dirt`);
  await call('setLook', (await pos()).yaw, -20);
  await call('waitFrames', 5);
  await shot('survival-in-the-shaft');
  // get out like a child: push forward against the wall (after 3 s the 'hold jump' picture comes up), then hold Jump
  await page.keyboard.down('KeyW');
  const hint = await waitFor(() => window.__game.game.kid && window.__game.game.kid.stuck && window.__game.game.kid.stuck.stuck, null, 6000);
  await page.keyboard.up('KeyW');
  await shot('survival-stuck-hint');
  note(`stuck hint shown: ${hint}`);
  await page.keyboard.down('Space');
  const bottom = y0 - dug;
  const out = await waitFor((b) => window.__game.pos().y >= b + 4, bottom, 6000);
  await page.keyboard.up('Space');
  await waitFor(() => window.__game.pos().onGround, null, 3000);
  const po = await pos();
  check('holding Jump in the shaft gets the child out onto the ground', out && po.onGround, `y ${po.y.toFixed(1)} (shaft top ${y0}, bottom ${bottom.toFixed(0)})`);
  await shot('survival-out-of-the-shaft');

  // --- furnace: craft at the table, place it, cook cobblestone into stone with planks
  await openTable();
  t = await book('furnace'); if (t) { await click(t.x, t.y); await sleep(400); }
  check('a furnace from 8 cobblestone at the table', (await countOf('furnace')) === 1);
  await clickSel('.inv-close'); await waitUI(null);
  slots = await inv();
  let fs = slots.findIndex((s) => s && s.item === 'furnace');
  if (fs >= 9) { await ev((i) => { const v = window.__game.game.inventory; const a = v.get(i); v.set(i, v.get(8)); v.set(8, a); }, fs); fs = 8; }
  await selectHud(fs);
  const fpl = await placeNearby();
  if (!fpl) throw new Error('nowhere to put the furnace');
  const fx = fpl.x, fy = fpl.y, fz = fpl.z;
  check('a tap places the furnace', (await call('getBlock', fx, fy, fz)) === 'furnace', `${fx},${fy},${fz}`);
  await tapSide(fx, fy, fz);
  check('a tap opens the furnace', await waitUI('furnace'));
  const tapSlot = async (sid) => { const r = await ev((sid) => window.__game.game.invui.slotRect(sid), sid); await click(r.x + r.w / 2, r.y + r.h / 2); };
  const rightSlot = async (sid) => { const r = await ev((sid) => window.__game.game.invui.slotRect(sid), sid); await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2, { button: 'right' }); await sleep(80); };
  slots = await inv();
  const cs = slots.findIndex((s) => s && s.item === 'cobblestone');
  await tapSlot('p' + cs); await rightSlot('fi'); await tapSlot('p' + cs);   // one cobblestone in, the rest back
  slots = await inv();
  const ps = slots.findIndex((s) => s && s.item === planks);
  await tapSlot('p' + ps); await rightSlot('ff'); await rightSlot('ff'); await tapSlot('p' + ps);
  await ticks(10);
  const lit = await call('getBlock', fx, fy, fz);
  check('the furnace lights with planks as fuel', lit === 'furnace_lit', lit);
  await shot('survival-furnace-burning');
  const cooked = await waitFor(() => { const s = window.__game.game.invui.screen && window.__game.game.invui.screen.getSlot('fo'); return s && s.item === 'stone'; }, null, 15000);
  check('cobblestone cooks into stone (10 s)', cooked);
  await tapSlot('fo');
  await shot('survival-furnace-done');
  await clickSel('.inv-close'); await waitUI(null);
  check('the stone ends up in the bag', (await countOf('stone')) >= 1);

  // --- night with monsters, then a bed
  note('skipping the 10-minute day: setTime(13000)');
  await call('setTime', 13000);
  await call('setLook', (await pos()).yaw, -5);
  await call('waitFrames', 20);
  await shot('survival-dusk');
  const t1 = Date.now();
  await waitFor(() => window.__game.game.entities.all().some((e) => ['zombie', 'skeleton', 'creeper', 'spider'].includes(e.type)), null, 20000);
  const mons = (await ents()).filter((e) => ['zombie', 'skeleton', 'creeper', 'spider'].includes(e.type));
  check('monsters come out at night', mons.length > 0, `${mons.map((m) => m.type).join(',')} after ${((Date.now() - t1) / 1000).toFixed(1)} s (monsters in dark caves were already about)`);
  if (mons.length) {
    const meNow = await pos();
    const nearest = mons.map((e) => ({ ...e, d: Math.hypot(e.x - meNow.x, e.z - meNow.z) })).sort((a, b) => a.d - b.d)[0];
    await call('lookAt', nearest.x, nearest.y + 1, nearest.z);
    await call('look', 0, -2);
    await call('waitFrames', 10);
    await shot(`survival-night-${nearest.type}`);
    note(`nearest monster: ${nearest.type} ${nearest.d.toFixed(0)} blocks away`);
  }
  // a bed: 3 wool (standing in for a sheep hunt) + 3 planks at the table
  await call('give', 'white_wool', 3);
  await openTable();
  t = await book('white_bed'); if (t) { await click(t.x, t.y); await sleep(400); }
  check('a bed from 3 wool + 3 planks', (await countOf('white_bed')) === 1);
  await clickSel('.inv-close'); await waitUI(null);
  slots = await inv();
  let bs = slots.findIndex((s) => s && s.item === 'white_bed');
  if (bs >= 9) { await ev((i) => { const v = window.__game.game.inventory; const a = v.get(i); v.set(i, v.get(7)); v.set(7, a); }, bs); bs = 7; }
  await selectHud(bs);
  let bed = null;
  {
    const bp = await placeNearby();
    if (bp && /bed/.test(await call('getBlock', bp.x, bp.y, bp.z))) bed = { x: bp.x, y: bp.y, z: bp.z };
  }
  check('a tap places the bed', !!bed && (await countOf('white_bed')) === 0);
  await call('setTime', 13800);
  await call('waitFrames', 5);
  if (bed) {
    const bedCell = await ev(([x, y, z]) => { for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (/bed/.test(window.__game.getBlock(x + dx, y, z + dz))) return [x + dx, y, z + dz]; return null; }, [bed.x, bed.y, bed.z]);
    const sleepT0 = await call('getTime');
    await tapTop(bedCell[0], bedCell[1] - 1, bedCell[2]);   // that pixel is on the bed's top
    const asleep = await waitFor(() => window.__game.game.player.sleeping, null, 2000);
    await sleep(800);
    await shot('survival-sleeping');
    check('a tap on the bed at night: the child goes to sleep', asleep, `time ${sleepT0}`);
    const woke = await waitFor(() => !window.__game.game.player.sleeping, null, 12000);
    const tm = await call('getTime');
    check('morning comes and the child wakes up', woke && (tm < 2000 || tm > 23000), `time ${tm}`);
    await sleep(1500);   // the wake-up fade (black, then 0.7 s back to the world)
    await call('setLook', 90, 2);   // west... and turn toward the sunrise in the east
    await call('setLook', -90, 4);
    await call('waitFrames', 10);
    const fade = await ev(() => window.__game.game.fx.stats().fade);
    check('the wake-up fade is gone', fade === 0, `fade ${fade}`);
    await shot('survival-morning');
  }
  const p = await pos();
  check('still alive after the night', p.health > 0, `health ${p.health} food ${p.food}`);
});

/* ------------------------------------------------------------------ report */
const errs = await ev(() => window.__game.errors.map((e) => `${e.where}: ${e.message}`)).catch(() => ['page gone']);
check('no game errors', errs.length === 0, errs.slice(0, 5).join(' | '));
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
const stats = await call('stats').catch(() => ({}));
const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
console.log(`\n[lead-play] ${JSON.stringify(counts)}  fps ${stats.fps}  draws ${stats.drawCalls}  screenshots ${OUT}`);
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), file: FILE, results, counts, stats, pageErrors }, null, 2));
await browser.close();
process.exit(counts.FAIL ? 1 : 0);
