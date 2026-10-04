// OWNER: LEAD (integration). End-to-end play-through of the whole game the way a 5-year-old (and a parent) plays
// it, on the merged build: real mouse clicks, holds and keys through Playwright, a screenshot at every step in
// .tmp/lead-play/NN-<step>.png, PASS/FAIL lines and .tmp/lead-play/report.json.
//
//   node build.mjs --dev --out .tmp/lead-dev && node tools/lead-play.mjs [--file .tmp/lead-dev/index.html]
//        [--only kid,survival] [--headed] [--swiftshader] [--seed 12345]
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
const SEED = Number(opt('--seed', '12345'));
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
  const e = (await ents()).find((x) => x.id === id);
  if (!e) throw new Error('no entity ' + id);
  const hgt = await ev((id) => window.__game.game.entities.get(id).height, id);
  await look(e.x, e.y + hgt * 0.55, e.z);
  const e2 = (await ents()).find((x) => x.id === id);
  const q = await worldPx(e2.x, e2.y + hgt * 0.55, e2.z);
  if (holdMs) await hold(q.x, q.y, holdMs); else await click(q.x, q.y);
  await ticks(3);
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
  const p0 = await pos();
  const gx = Math.floor(p0.x), gz = Math.floor(p0.z) - 4;
  const placed0 = await call('eventCount', 'block:placed');
  for (let dx = -1; dx <= 1; dx++) {
    const gy = (await call('surfaceY', gx + dx, gz)) - 1;
    await tapTop(gx + dx, gy, gz);
    await tapTop(gx + dx, gy + 1, gz);
  }
  await key('Digit3');
  const gyc = await call('surfaceY', gx, gz);
  await tapTop(gx, gyc - 1, gz);
  const placedN = (await call('eventCount', 'block:placed')) - placed0;
  check('tapping builds a wall (7 blocks, glass on top)', placedN === 7 && (await call('getBlock', gx, gyc - 1, gz)) === 'glass', `${placedN} placed`);
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
    await tapEntity(pig.id);
    check('a saddle tap saddles the pig', await ev((id) => !!window.__game.game.entities.get(id).data.saddled, pig.id));
    await key('Digit6');
    await tapEntity(pig.id);
    const riding = await ev((id) => window.__game.game.player.riding === id || (window.__game.game.player.riding && window.__game.game.player.riding.id === id), pig.id);
    check('tapping the saddled pig gets the child on', riding);
    const r0 = (await ents()).find((e) => e.id === pig.id);
    await call('setLook', (await pos()).yaw, -5);
    await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
    const r1 = (await ents()).find((e) => e.id === pig.id);
    check('the carrot on a stick steers the pig forward', Math.hypot(r1.x - r0.x, r1.z - r0.z) > 1.5, Math.hypot(r1.x - r0.x, r1.z - r0.z).toFixed(1));
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
  const q = await pos();
  const tx = Math.floor(q.x), tz = Math.floor(q.z) - 5;
  const ty = await call('surfaceY', tx, tz);
  await tapTop(tx, ty - 1, tz);
  check('TNT placed with a tap', (await call('getBlock', tx, ty, tz)) === 'tnt');
  const snap = await ev(([x, y, z]) => { const w = window.__game.game.world, o = []; for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) o.push(w.getRaw(x + dx, y + dy, z + dz)); return o; }, [tx, ty, tz]);
  await call('waitFrames', 5);
  await shot('kid-tnt-placed');
  await key('Digit8');
  const boom0 = await call('eventCount', 'explosion');
  await tapSide(tx, ty, tz);
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
        const d = Math.hypot(dx, dz) + Math.abs(y - p.y) * 2;
        if (h >= 4 && (!best || d < best.d)) best = { x, y, z, h, d: Math.round(d), top };
      }
    }
    return best;
  });
  check('a tree near the spawn', !!tree, tree);
  if (!tree) throw new Error('no tree');
  const logName = await call('getBlock', tree.x, tree.y, tree.z);
  const planks = logName.replace('_log', '_planks');
  // stand next to the trunk (walk there; hop over in a pinch)
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let stand = null;
  for (const [sx, sz] of sides) {
    const x = tree.x + sx * 2, z = tree.z + sz * 2;
    const y = await call('surfaceY', x, z);
    if (Math.abs(y - tree.y) <= 1) { stand = { x: x + 0.5, y, z: z + 0.5 }; break; }
  }
  if (!stand) stand = { x: tree.x + 2.5, y: await call('surfaceY', tree.x + 2, tree.z), z: tree.z + 0.5 };
  const walked = await walkTo(stand.x, stand.z, 0.8, 20000);
  if (!walked) { note('walking to the tree was blocked: stepping next to it'); await call('teleport', stand.x, stand.y, stand.z); await ticks(10); }
  check('walked to a tree', walked, `${logName} at ${tree.x},${tree.y},${tree.z} (${tree.h} high)`);
  let logsGot = 0;
  for (let k = 0; k < 4 && k < tree.h; k++) {
    const y = tree.y + k;
    await call('lookAt', tree.x + 0.5, y + 0.5, tree.z + 0.5);
    await call('waitFrames', 2);
    const tg = await call('target');
    if (!tg || tg.x !== tree.x || tg.y !== y || tg.z !== tree.z) { note(`log ${y} not in reach (${JSON.stringify(tg)})`); continue; }
    const q = await worldPx(tree.x + 0.5, y + 0.5, tree.z + 0.5);
    await page.mouse.move(q.x, q.y);
    await page.mouse.down();
    const broke = await waitFor(([x, y, z, name]) => window.__game.getBlock(x, y, z) !== name, [tree.x, y, tree.z, logName], 6000);
    if (k === 0) await shot('survival-punching-tree');
    await page.mouse.up();
    if (broke) logsGot++;
    await ticks(12);
  }
  // the logs pop out as items; walk over them
  await walkTo(tree.x + 0.5, tree.z + 0.5, 0.6, 3000);
  await ticks(30);
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
  const me = await pos();
  const tbx = Math.floor(me.x) + 1, tbz = Math.floor(me.z) - 2;
  const tby = await call('surfaceY', tbx, tbz);
  await tapTop(tbx, tby - 1, tbz);
  check('a tap places the crafting table', (await call('getBlock', tbx, tby, tbz)) === 'crafting_table');
  await tapSide(tbx, tby, tbz);
  check('a tap on the table opens the 3x3 grid', await waitUI('crafting'));
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
  // get out like a child: hold Jump (the kid helper pops a stuck child out of a pit)
  await page.keyboard.down('Space');
  const out = await waitFor((y) => window.__game.pos().y >= y - 0.5, y0, 9000);
  await page.keyboard.up('Space');
  check('holding Jump in the shaft gets the child out', out, `y ${(await pos()).y.toFixed(1)} (top ${y0})`);
  await shot('survival-out-of-the-shaft');

  // --- furnace: craft at the table, place it, cook cobblestone into stone with planks
  const near = await walkTo(tbx + 0.5, tbz + 2.5, 1.5, 8000);
  if (!near) await call('teleport', tbx + 0.5, await call('surfaceY', tbx, tbz + 2), tbz + 2.5);
  await tapSide(tbx, tby, tbz);
  await waitUI('crafting');
  t = await book('furnace'); if (t) { await click(t.x, t.y); await sleep(400); }
  check('a furnace from 8 cobblestone at the table', (await countOf('furnace')) === 1);
  await clickSel('.inv-close'); await waitUI(null);
  slots = await inv();
  let fs = slots.findIndex((s) => s && s.item === 'furnace');
  if (fs >= 9) { await ev((i) => { const v = window.__game.game.inventory; const a = v.get(i); v.set(i, v.get(8)); v.set(8, a); }, fs); fs = 8; }
  await selectHud(fs);
  const fx = tbx - 1, fz = tbz, fy = await call('surfaceY', fx, fz);
  await tapTop(fx, fy - 1, fz);
  check('a tap places the furnace', (await call('getBlock', fx, fy, fz)) === 'furnace');
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
  check('monsters come out at night', mons.length > 0, `${mons.map((m) => m.type).join(',')} after ${((Date.now() - t1) / 1000).toFixed(1)} s`);
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
  await tapSide(tbx, tby, tbz);
  await waitUI('crafting');
  t = await book('white_bed'); if (t) { await click(t.x, t.y); await sleep(400); }
  check('a bed from 3 wool + 3 planks', (await countOf('white_bed')) === 1);
  await clickSel('.inv-close'); await waitUI(null);
  slots = await inv();
  let bs = slots.findIndex((s) => s && s.item === 'white_bed');
  if (bs >= 9) { await ev((i) => { const v = window.__game.game.inventory; const a = v.get(i); v.set(i, v.get(7)); v.set(7, a); }, bs); bs = 7; }
  await selectHud(bs);
  const p2 = await pos();
  let bed = null;
  for (const [dx, dz] of [[0, -3], [3, 0], [-3, 0], [0, 3], [2, -2], [-2, 2]]) {
    const bx = Math.floor(p2.x) + dx, bz = Math.floor(p2.z) + dz, by = await call('surfaceY', bx, bz);
    await call('setLook', 0, -30);
    await tapTop(bx, by - 1, bz);
    if ((await call('getBlock', bx, by, bz)) === 'white_bed' || (await countOf('white_bed')) === 0) { bed = { x: bx, y: by, z: bz }; break; }
  }
  check('a tap places the bed', !!bed && (await countOf('white_bed')) === 0);
  await call('setTime', 13800);
  await call('waitFrames', 5);
  if (bed) {
    const bedCell = await ev(([x, y, z]) => { for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (window.__game.getBlock(x + dx, y, z + dz) === 'white_bed') return [x + dx, y, z + dz]; return null; }, [bed.x, bed.y, bed.z]);
    const sleepT0 = await call('getTime');
    await tapTop(bedCell[0], bedCell[1] - 1, bedCell[2]);   // that pixel is on the bed's top
    const asleep = await waitFor(() => window.__game.game.player.sleeping, null, 2000);
    await sleep(800);
    await shot('survival-sleeping');
    check('a tap on the bed at night: the child goes to sleep', asleep, `time ${sleepT0}`);
    const woke = await waitFor(() => !window.__game.game.player.sleeping, null, 12000);
    const tm = await call('getTime');
    check('morning comes and the child wakes up', woke && (tm < 2000 || tm > 23000), `time ${tm}`);
    await call('setLook', (await pos()).yaw, 0);
    await call('waitFrames', 20);
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
