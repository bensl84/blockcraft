// OWNER: FEATURE-INV. In-world play-through of the inventory lane on the REAL core (real terrain, renderer, input):
// drives the game like a child would (real mouse clicks / taps on the HUD, the picker, slots and blocks in the
// world), saves a screenshot per step to .tmp/play/inv-*.png and prints PASS/FAIL lines + perf numbers.
//
//   node tools/inv-play.mjs [--file .tmp/build-inv/index.html] [--touch] [--headed] [--size 1280x720]
//
// Not part of the smoke suite (it is slow and screenshot-heavy); the smoke scenarios in tools/scenarios/inv.mjs
// keep the regression asserts. Items that need other lanes (dropped item entities, survival damage, saves)
// print SKIP while those lanes are stubs.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.tmp', 'play');
const args = { file: join(ROOT, '.tmp', 'build-inv', 'index.html'), touch: false, headed: false, w: 1280, h: 720, only: null };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === '--file') args.file = resolve(ROOT, process.argv[++i]);
  else if (k === '--touch') args.touch = true;
  else if (k === '--headed') args.headed = true;
  else if (k === '--size') { const [w, h] = process.argv[++i].split('x').map(Number); args.w = w; args.h = h; }
  else if (k === '--only') args.only = process.argv[++i].split(',');
  else throw new Error('unknown argument ' + k);
}
if (!existsSync(args.file)) throw new Error('no build at ' + args.file + ' (node build.mjs --dev --out .tmp/build-inv)');
mkdirSync(OUT, { recursive: true });
const tag = (args.touch ? 'touch-' : '') + (args.w !== 1280 ? `${args.w}-` : '');

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: !args.headed,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const context = await browser.newContext({ viewport: { width: args.w, height: args.h }, deviceScaleFactor: 1, hasTouch: args.touch });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text()); });
await page.goto(pathToFileURL(args.file).href);
await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });

/* ------------------------------------------------------------------ helpers */
const results = [];
const perf = {};
const call = (m, ...a) => page.evaluate(({ m, a }) => window.__game[m](...a), { m, a });
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const p = join(OUT, `inv-${tag}${name}.png`); await page.screenshot({ path: p }); return p; };
const check = (name, ok, detail = '') => { results.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const skip = (name, why) => { results.push({ name, status: 'SKIP', detail: why }); console.log(`SKIP  ${name}  ${why}`); };
const waitUI = async (name, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await call('uiOpen')) === name) return true; await sleep(50); } return false; };
const stubs = await call('stubs');

/** A real tap (touchscreen) or click (mouse down/up, short) at a page pixel. */
async function tap(x, y) {
  if (args.touch) await page.touchscreen.tap(x, y);
  else { await page.mouse.move(x, y); await page.mouse.down(); await sleep(50); await page.mouse.up(); }
  await sleep(60);
}
async function tapSel(sel) {
  const r = await ev((sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
  if (!r) throw new Error('not on screen: ' + sel);
  await tap(r.x, r.y);
}
async function tapSlot(sid) {
  const r = await ev((sid) => window.__game.game.invui.slotRect(sid), sid);
  if (!r) throw new Error('slot not on screen: ' + sid);
  await tap(r.x + r.w / 2, r.y + r.h / 2);
}
/** Page pixel of a world point (null when behind the camera / off screen). */
async function worldPx(x, y, z) {
  const n = await call('worldToNdc', x, y, z);
  if (!n.onScreen) return null;
  return { x: ((n.x + 1) / 2) * args.w, y: ((1 - n.y) / 2) * args.h };
}
/** Page pixel of a world point; if it is off screen, turn to look at it first (what a child does). */
async function seePx(x, y, z) {
  let p = await worldPx(x, y, z);
  const inner = (q) => q && q.x > 40 && q.x < args.w - 40 && q.y > 40 && q.y < args.h - 160;
  if (!inner(p)) { await call('lookAt', x, y, z); await call('look', 0, 8); p = await worldPx(x, y, z); }
  return p;
}
/** Tap the top face of block cell (x,y,z) - kid scheme tap = "use". */
async function tapBlockTop(x, y, z) {
  const p = await seePx(x + 0.5, y + 1, z + 0.5);
  if (!p) throw new Error(`block ${x},${y},${z} not on screen`);
  await tap(p.x, p.y);
  await call('waitTicks', 3);
}
async function tapBlockFront(x, y, z) {
  // centre of the side face that looks at the player
  const me = await call('pos');
  const dx = me.x - (x + 0.5), dz = me.z - (z + 0.5);
  const fx = Math.abs(dx) >= Math.abs(dz) ? x + 0.5 + Math.sign(dx) * 0.5 : x + 0.5;
  const fz = Math.abs(dx) >= Math.abs(dz) ? z + 0.5 : z + 0.5 + Math.sign(dz) * 0.5;
  const p = await seePx(fx, y + 0.5, fz);
  if (!p) throw new Error(`block ${x},${y},${z} not on screen`);
  await tap(p.x, p.y);
  await call('waitTicks', 3);
}
const countOf = (item) => ev((item) => window.__game.game.inventory.slots.reduce((n, s) => n + (s && s.item === item ? s.count : 0), 0), item);
const run = async (name, fn) => {
  if (args.only && !args.only.includes(name)) return;
  try { await fn(); } catch (err) { check(name + ' (threw)', false, err.message); try { await shot(name + '-ERROR'); } catch { /* ignore */ } }
  try { await ev(async () => { if (window.__game.game.ui.current) window.__game.game.ui.close(); if (window.__game.game.meta) await window.__game.exitToTitle(); }); } catch { /* ignore */ }
};
/** Stand on the real terrain at spawn, find a flat-ish 5x5 patch in front (−Z) and return its ground cell. */
async function groundAhead(dz = -3) {
  const p = await call('pos');
  const x = Math.floor(p.x), z = Math.floor(p.z) + dz;
  const y = await call('surfaceY', x, z);
  return { x, y, z };
}
async function perfSample(label, frames = 120) {
  await call('waitFrames', 10);
  const a = await call('stats');
  await call('waitFrames', frames);
  const b = await call('stats');
  perf[label] = { fps: b.fps, frameMs: b.frameMs, workMs: b.workMs, tickMs: b.tickMs, drawCalls: b.drawCalls, triangles: b.triangles, dom: await ev(() => document.querySelectorAll('*').length), frames: b.frames - a.frames };
  console.log(`PERF  ${label}  ${JSON.stringify(perf[label])}`);
}

/* ------------------------------------------------------------------ 1. kid creative: HUD + picker on real terrain */
await run('creative', async () => {
  await call('startWorld', { preset: 'default', seed: 12345, mode: 'creative', difficulty: 'peaceful' });
  await call('waitFrames', 30);
  await shot('01-creative-hud');
  await perfSample('creative-hud');
  // backpack button -> picture picker
  await tapSel('#hud .inv-backpack');
  check('backpack tap opens the picture picker', await waitUI('creative'));
  await call('waitFrames', 5);
  await shot('02-picker-building');
  await perfSample('picker-open', 60);
  // every tab, look at the real icons
  const tabs = await ev(() => [...document.querySelectorAll('.inv-tab')].map((t) => t.dataset.tab));
  for (const tb of tabs) {
    await tapSel(`.inv-tab[data-tab="${tb}"]`);
    await call('waitFrames', 3);
    await shot('03-picker-' + tb);
  }
  const icons = await ev(() => [...document.querySelectorAll('.inv-tile .bc-icon')].map((c) => c.getBoundingClientRect().width));
  check('picker tiles draw real icon canvases', icons.length > 10, `${icons.length} icons, sizes ${[...new Set(icons)].join('/')}`);
  // pick 3 things a child wants: glass, red wool and a chest; tap slot 2 first to choose where they go
  await tapSel('.inv-tab[data-tab="building"]');
  await tapSel('.inv-pick-hotbar .inv-hb-slot[data-slot="1"]');
  for (const [tb, item] of [['functional', 'crafting_table'], ['colors', 'red_wool']]) {
    await tapSel(`.inv-tab[data-tab="${tb}"]`);
    if (item === 'red_wool') await tapSel('.inv-pick-hotbar .inv-hb-slot[data-slot="2"]');
    // page until the tile is visible
    for (let i = 0; i < 6; i++) {
      const vis = await ev((item) => !!document.querySelector(`.inv-tile[data-item="${item}"]`), item);
      if (vis) break;
      await tapSel('.inv-arrow-btn[data-action="next"]');
    }
    await tapSel(`.inv-tile[data-item="${item}"]`);
    await call('waitFrames', 20);
  }
  await shot('04-picker-picked');
  const hb = await ev(() => window.__game.game.inventory.slots.slice(0, 9).map((s) => s && s.item));
  check('picked items land in the hotbar', hb.includes('crafting_table') && hb.includes('red_wool'), hb.join(','));
  // tap the dim background to close
  await tap(8, 8);
  check('tap outside the picker closes it', await waitUI(null, 1500), String(await call('uiOpen')));
  // HUD taps never reach the world: select the crafting table slot by tapping the hotbar while blocks sit behind it
  const placedBefore = await call('eventCount', 'block:placed');
  const brokeBefore = await call('eventCount', 'block:broken');
  await call('setLook', 0, -60);              // ground behind the hotbar
  const tSlot = hb.indexOf('crafting_table');
  await tapSel(`#hud .inv-hb-slot[data-slot="${tSlot}"]`);
  await call('waitTicks', 4);
  await tapSel('#hud .inv-backpack'); await waitUI('creative'); await tap(8, 8); await waitUI(null);
  await call('waitTicks', 4);
  check('hotbar + backpack taps never place or break blocks', (await call('eventCount', 'block:placed')) === placedBefore && (await call('eventCount', 'block:broken')) === brokeBefore,
    `placed ${placedBefore}->${await call('eventCount', 'block:placed')}, broken ${brokeBefore}->${await call('eventCount', 'block:broken')}`);
  check('tapping a hotbar slot selects it', (await call('selected')).slot === tSlot);
  await shot('05-hotbar-selected-name');
  // place the table on the ground by tapping it, then tap the table: it must open, not place another block on it
  await call('setLook', 0, -35);
  const g = await groundAhead(-3);
  await tapBlockTop(g.x, g.y - 1, g.z);
  const placed = (await call('getBlock', g.x, g.y, g.z)) === 'crafting_table';
  check('tap on the ground places the crafting table', placed, `${g.x},${g.y},${g.z} = ${await call('getBlock', g.x, g.y, g.z)}`);
  await call('waitFrames', 10);
  await shot('06-table-placed');
  await tapBlockTop(g.x, g.y, g.z);
  check('tap on a crafting table (block in hand) opens the 3x3 screen', await waitUI('crafting'));
  check('...and does not stack a block on top', (await call('getBlock', g.x, g.y + 1, g.z)) !== 'crafting_table');
  await shot('07-creative-table-open');
  await tapSel('.inv-close');
  await waitUI(null);
});

/* ------------------------------------------------------------------ 2. survival: wood -> planks -> table -> tools -> furnace -> chest */
await run('survival', async () => {
  await call('startWorld', { preset: 'default', seed: 12345, mode: 'survival', difficulty: 'peaceful' });
  await call('waitFrames', 30);
  await call('setLook', 0, -30);
  await call('give', 'oak_log', 5);            // as if chopped from a tree (item pickups are the MOBS lane)
  await call('waitFrames', 5);
  await shot('10-survival-hud');
  const bubbles = await ev(() => [...document.querySelectorAll('#hud [data-hud="air"] .inv-sprite')].filter((e) => e.checkVisibility({ visibilityProperty: true })).length);
  check('no air bubbles on dry land', bubbles === 0, bubbles + ' visible');
  await perfSample('survival-hud');
  await tapSel('#hud .inv-backpack');
  check('backpack opens the survival inventory', await waitUI('inventory'));
  await call('waitFrames', 5);
  await shot('11-inventory-with-logs');
  // recipe book: planks picture
  const bookTile = async (item) => ev((item) => { const e = document.querySelector(`.inv-recipe[data-item="${item}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, dim: e.classList.contains('inv-needs-table') }; }, item);
  let t = await bookTile('oak_planks');
  check('recipe book shows planks with logs in the bag', !!t);
  for (let i = 0; i < 4 && t; i++) { await tap(t.x, t.y); await call('waitFrames', 8); }
  await call('sleep', 600);
  check('4 taps on planks -> 16 planks', (await countOf('oak_planks')) === 16, `${await countOf('oak_planks')} planks, ${await countOf('oak_log')} logs`);
  await shot('12-planks-crafted');
  t = await bookTile('stick'); if (t) { await tap(t.x, t.y); await call('sleep', 400); }
  t = await bookTile('crafting_table'); if (t) { await tap(t.x, t.y); await call('sleep', 400); }
  check('sticks + crafting table from the 2x2 book', (await countOf('stick')) >= 4 && (await countOf('crafting_table')) === 1);
  const pick = await bookTile('wooden_pickaxe');
  check('pickaxe shows "needs the table" in the 2x2', !!pick && pick.dim, JSON.stringify(pick));
  if (pick) { await tap(pick.x, pick.y); await call('waitFrames', 6); await shot('13-needs-table-toast'); }
  await shot('13b-inventory-after');
  await tapSel('.inv-close');
  await waitUI(null);
  // put the table in the hand (it went to the hotbar) and place it
  const slots = await call('inventory');
  const ti = slots.findIndex((s) => s && s.item === 'crafting_table');
  check('crafting table landed in the hotbar', ti >= 0 && ti < 9, 'slot ' + ti);
  await tapSel(`#hud .inv-hb-slot[data-slot="${ti}"]`);
  const g = await groundAhead(-3);
  await tapBlockTop(g.x, g.y - 1, g.z);
  check('survival tap places the table', (await call('getBlock', g.x, g.y, g.z)) === 'crafting_table');
  await tapBlockTop(g.x, g.y, g.z);
  check('tap opens the 3x3 crafting screen', await waitUI('crafting'));
  await call('waitFrames', 5);
  await shot('14-table-3x3');
  t = await bookTile('wooden_pickaxe');
  if (t) { await tap(t.x, t.y); await call('sleep', 600); }
  check('wooden pickaxe from the 3x3 recipe book', (await countOf('wooden_pickaxe')) === 1);
  await shot('15-pickaxe-crafted');
  // cobblestone (as if mined) -> furnace + stone pickaxe
  await call('give', 'cobblestone', 20);
  await call('give', 'coal', 6);
  await call('give', 'raw_iron', 3);
  await call('waitFrames', 5);
  await tapSel('.inv-close'); await waitUI(null);
  await tapBlockTop(g.x, g.y, g.z); await waitUI('crafting');
  await call('waitFrames', 5);
  await shot('16-book-with-cobble');
  for (const item of ['furnace', 'stone_pickaxe', 'chest']) {
    t = await bookTile(item);
    if (t) { await tap(t.x, t.y); await call('sleep', 500); }
  }
  check('furnace + stone pickaxe from the book', (await countOf('furnace')) === 1 && (await countOf('stone_pickaxe')) === 1, `furnace ${await countOf('furnace')} stone_pickaxe ${await countOf('stone_pickaxe')} chest ${await countOf('chest')}`);
  await shot('17-after-furnace');
  await tapSel('.inv-close'); await waitUI(null);
  // place the furnace next to the table, open it with a tap, smelt iron with coal
  const fslot = (await call('inventory')).findIndex((s) => s && s.item === 'furnace');
  if (fslot >= 9) await ev((i) => { const inv = window.__game.game.inventory; const a = inv.get(i); inv.set(i, inv.get(8)); inv.set(8, a); }, fslot);
  const fs = fslot >= 9 ? 8 : fslot;
  await tapSel(`#hud .inv-hb-slot[data-slot="${fs}"]`);
  const fx = g.x + 1, fz = g.z, fy = await call('surfaceY', fx, fz);
  await tapBlockTop(fx, fy - 1, fz);
  const fb = await call('getBlock', fx, fy, fz);
  check('furnace placed', fb === 'furnace', fb);
  await call('waitFrames', 6);
  await shot('18-furnace-placed');
  await tapBlockFront(fx, fy, fz);
  check('tap opens the furnace', await waitUI('furnace'));
  await call('waitFrames', 3);
  // shift-click is a grown-up move; a child drags: pick the iron up and put it in the top slot, coal in the bottom one
  const rawSlot = (await call('inventory')).findIndex((s) => s && s.item === 'raw_iron');
  await tapSlot('p' + rawSlot); await tapSlot('fi');
  const coalSlot = (await call('inventory')).findIndex((s) => s && s.item === 'coal');
  await tapSlot('p' + coalSlot); await tapSlot('ff');
  await call('waitTicks', 30);
  await shot('19-furnace-burning');
  const lit = await call('getBlock', fx, fy, fz);
  check('furnace lights (furnace_lit) when iron + coal go in', lit === 'furnace_lit', lit);
  await call('runTicks', 600);
  await call('waitFrames', 3);
  await shot('20-furnace-done');
  const out = await ev(() => { const s = window.__game.game.invui.screen.getSlot('fo'); return s && s.count; });
  check('3 iron ingots smelted', out === 3, String(out));
  await tapSlot('fo');
  await call('waitFrames', 3);
  check('take the ingots', (await countOf('iron_ingot')) === 3 || (await ev(() => window.__game.game.inventory.cursor && window.__game.game.inventory.cursor.item)) === 'iron_ingot');
  // drop the cursor stack back into the bag before closing
  await tapSel('.inv-close'); await waitUI(null);
  check('ingots end up in the bag after closing', (await countOf('iron_ingot')) === 3, String(await countOf('iron_ingot')));
  // night: the lit furnace glows
  await ev(([x, y, z]) => { const be = window.__game.game.world.getBlockEntity(x, y, z); be.input = { item: 'raw_iron', count: 1 }; be.fuel = { item: 'coal', count: 3 }; }, [fx, fy, fz]);
  await call('runTicks', 5);
  await call('setTime', 18000);
  await call('setLook', 0, -25);
  await call('waitFrames', 30);
  const light = await call('getLight', fx, fy + 1, fz);
  check('lit furnace emits block light', light.block >= 11, JSON.stringify(light));
  await shot('21-furnace-glow-night');
  await call('runTicks', 300);
  await call('waitFrames', 10);
  const after = await call('getBlock', fx, fy, fz);
  await call('runTicks', 2000);
  await call('waitFrames', 10);
  const unlit = await call('getBlock', fx, fy, fz);
  const light2 = await call('getLight', fx, fy + 1, fz);
  check('furnace goes back to unlit when the fuel is used up, light gone', unlit === 'furnace' && light2.block < 11, `${after} -> ${unlit} ${JSON.stringify(light2)}`);
  await shot('22-furnace-unlit-night');
  await call('setTime', 6000);
  // chest: place, open, put things in, close and reopen
  await call('give', 'chest', 1);
  const cs = (await call('inventory')).findIndex((s) => s && s.item === 'chest');
  if (cs >= 9) await ev((i) => { const inv = window.__game.game.inventory; const a = inv.get(i); inv.set(i, inv.get(7)); inv.set(7, a); }, cs);
  await tapSel(`#hud .inv-hb-slot[data-slot="${cs >= 9 ? 7 : cs}"]`);
  let cx = g.x - 1, cz = g.z, cy = await call('surfaceY', cx, cz);
  await tapBlockTop(cx, cy - 1, cz);
  // LEAD integration: with real animals around (they nudge the player) the terrain step next to the cell can be
  // what the tap hits; the chest goes where the tap pointed, as for a child, so follow it there
  const chestAt = await ev(([x, y, z]) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (window.__game.getBlock(x + dx, y + dy, z + dz) === 'chest') return [dx, dy, dz]; return null; }, [cx, cy, cz]);
  check('chest placed', !!chestAt, `chest at offset ${JSON.stringify(chestAt)} from ${cx},${cy},${cz}`);
  if (chestAt) { cx += chestAt[0]; cy += chestAt[1]; cz += chestAt[2]; }
  await call('waitFrames', 10);
  await shot('23-chest-placed');
  await tapBlockFront(cx, cy, cz);
  check('tap opens the chest', await waitUI('chest'));
  const ps = (await call('inventory')).findIndex((s) => s && s.item === 'oak_planks');
  if (ps >= 0) { await tapSlot('p' + ps); await tapSlot('k4'); }
  await call('waitFrames', 3);
  await shot('24-chest-open');
  await tapSel('.inv-close'); await waitUI(null);
  await tapBlockFront(cx, cy, cz); await waitUI('chest');
  const k4 = await ev(() => { const s = window.__game.game.invui.screen.getSlot('k4'); return s && `${s.item}x${s.count}`; });
  check('chest keeps what we put in', !!k4 && k4.startsWith('oak_planks'), String(k4));
  await tapSel('.inv-close'); await waitUI(null);
  // break the chest (kid hold); contents drop
  const before = await call('eventCount', 'block:broken');
  await call('setLook', 0, -20);
  const cpx = await seePx(cx + 0.5, cy + 0.5, cz + 1);
  if (cpx && !args.touch) {
    await page.mouse.move(cpx.x, cpx.y); await page.mouse.down(); await sleep(4500); await page.mouse.up();
    await call('waitTicks', 3);
  }
  const brokeChest = (await call('getBlock', cx, cy, cz)) !== 'chest';
  check('holding on the chest breaks it', brokeChest || args.touch, `broken events ${before} -> ${await call('eventCount', 'block:broken')}`);
  const dropped = await ev(() => window.__game.game.invui.lastDropped.map((s) => `${s.item}x${s.count}`));
  check('chest contents are dropped', !brokeChest || dropped.some((d) => d.startsWith('oak_planks')), dropped.join(','));
  if (!brokeChest) skip('dropped stacks become item entities (pop + magnet)', 'the chest was not broken (touch run: Playwright touch has no long press)');
  else check('dropped stacks become item entities', (await call('entities')).some((e) => e.type === 'item'));
  await shot('25-chest-broken');
  // survival HUD values (hearts/hunger/air move only once SURVIVAL/MOBS land)
  if (stubs.includes('survival')) skip('hearts/hunger move from real damage/hunger', 'survival lane is still a stub');
  if (stubs.includes('items')) skip('Q-drop throws the item forward', 'items lane is still a stub');
  if (stubs.includes('save') || stubs.includes('menus')) skip('chest survives save + load', 'save/menus lanes are still stubs');
  // furnace tick cost: 40 burning furnaces in loaded chunks
  await ev(([x, y, z]) => {
    const g = window.__game.game;
    for (let i = 0; i < 40; i++) {
      const bx = x + 2 + (i % 8), bz = z - 4 - Math.floor(i / 8), by = g.world.getSurfaceY(bx, bz);
      g.world.setBlock(bx, by, bz, window.__game.blockId('furnace'), 0, { cause: 'test' });
      g.invui.openContainer('furnace', bx, by, bz); g.ui.close();
      const be = g.world.getBlockEntity(bx, by, bz);
      if (be) { be.input = { item: 'cobblestone', count: 64 }; be.fuel = { item: 'coal', count: 64 }; }
    }
  }, [g.x, g.y, g.z]);
  await call('runTicks', 4);
  const litN = await ev(() => { let n = 0; window.__game.game.world.forEachBlockEntity((be, x, y, z) => { if (window.__game.getBlock(x, y, z) === 'furnace_lit') n++; }); return n; });
  check('40 furnaces burning at once', litN >= 40, litN + ' lit');
  await perfSample('40-furnaces-burning');
  await shot('26-forty-furnaces');
});

/* ------------------------------------------------------------------ 3. classic scheme (grown-up keyboard + mouse) */
await run('classic', async () => {
  if (args.touch) { skip('classic keyboard + mouse', 'touch run'); return; }
  await call('setSetting', 'controls', 'classic');
  try {
    await call('startWorld', { preset: 'default', seed: 12345, mode: 'survival', difficulty: 'peaceful' });
    await call('give', 'oak_log', 3); await call('give', 'cobblestone', 30); await call('give', 'torch', 12);
    await call('waitFrames', 20);
    await page.mouse.click(args.w / 2, args.h / 2);
    await sleep(300);
    const locked = await ev(() => window.__game.game.input.pointerLocked);
    check('classic: click locks the pointer', locked);
    check('classic: crosshair shown', await ev(() => { const c = document.querySelector('#hud .inv-crosshair'); return !!c && c.checkVisibility(); }));
    await page.keyboard.press('Digit3');
    await call('waitTicks', 2);
    check('classic: key 3 selects slot 3', (await call('selected')).slot === 2);
    await page.mouse.wheel(0, 120);
    await call('waitTicks', 2);
    check('classic: wheel down selects the next slot', (await call('selected')).slot === 3, 'slot ' + (await call('selected')).slot);
    check('classic: no item name over an empty slot', !(await ev(() => document.querySelector('#hud .inv-name-pop').classList.contains('inv-show'))));
    await sleep(300);
    await shot('30-classic-hud');
    await page.keyboard.press('KeyE');
    check('classic: E opens the inventory', await waitUI('inventory'));
    check('classic: pointer unlocked while the inventory is open', !(await ev(() => window.__game.game.input.pointerLocked)));
    // right-drag split, shift-click into the hotbar, the cursor follows the mouse
    const logI = (await call('inventory')).findIndex((s) => s && s.item === 'cobblestone');
    const r = await ev((sid) => window.__game.game.invui.slotRect(sid), 'p' + logI);
    await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2, { button: 'right' });
    await page.mouse.move(args.w / 2 + 40, args.h / 2 + 40);
    await call('waitFrames', 3);
    await shot('31-classic-holding-half');
    const cur = await ev(() => window.__game.game.inventory.cursor);
    check('classic: right click picks up half', !!cur && cur.count === 15, JSON.stringify(cur));
    await page.keyboard.press('KeyE');
    check('classic: E closes the inventory', await waitUI(null));
    check('classic: held stack returned to the bag on close', (await countOf('cobblestone')) === 30 && !(await ev(() => window.__game.game.inventory.cursor)));
    await sleep(1600);
    const relocked = await ev(() => window.__game.game.input.pointerLocked);
    results.push({ name: 'classic: pointer re-locks after closing the inventory', status: relocked ? 'PASS' : 'NOTE', detail: relocked ? '' : 'needs one click on the world (Java relocks on its own)' });
    console.log((relocked ? 'PASS' : 'NOTE') + '  classic: pointer re-locks after closing the inventory');
    await page.keyboard.press('KeyE');
    await waitUI('inventory');
    await sleep(1500);
    await page.keyboard.press('KeyE');
    await waitUI(null);
    await sleep(300);
    check('classic: E after a long look relocks at once', await ev(() => window.__game.game.input.pointerLocked));
    await page.keyboard.press('KeyE');
    await waitUI('inventory');
    await page.keyboard.press('Escape');
    check('classic: Esc closes the inventory', await waitUI(null));
  } finally {
    await call('setSetting', 'controls', 'kid');
  }
});

/* ------------------------------------------------------------------ report */
await browser.close();
const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
console.log(`\n[inv-play] ${JSON.stringify(counts)} page errors: ${pageErrors.length}`);
for (const e of pageErrors.slice(0, 10)) console.log('  ' + e);
writeFileSync(join(OUT, `inv-${tag}report.json`), JSON.stringify({ when: new Date().toISOString(), args, stubs, results, perf, pageErrors }, null, 2));
process.exit(results.some((r) => r.status === 'FAIL') || pageErrors.length ? 1 : 0);
