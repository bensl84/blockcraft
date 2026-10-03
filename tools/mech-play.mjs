// OWNER LANE: FEATURE-MECH. In-world play-through of the block mechanics in real headless Chrome, driven the way a
// child plays: real page.mouse clicks (kid scheme: click = tap = use, empty-hand tap breaks in creative) on the
// projected screen point of a block, plus window.__game for setup (stages, hotbar) and measurements.
// Screenshots go to .tmp/mech/<NN>-<name>.png, a JSON report to .tmp/mech/report.json.
//
//   node build.mjs --dev --out .tmp/build-mech && node tools/mech-play.mjs [--only door,tnt] [--headed] [--file path]
//   [--swiftshader]  CPU WebGL (weak-laptop proxy; frame-time checks are reported, screenshots go to .tmp/mech-swiftshader)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.tmp', process.argv.includes('--swiftshader') ? 'mech-swiftshader' : 'mech');
mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ONLY = opt('--only') ? opt('--only').split(',') : null;
const FILE = resolve(ROOT, opt('--file') || '.tmp/build-mech/index.html');
const W = 1280, H = 720;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: !argv.includes('--headed'),
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required',
    ...(argv.includes('--swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
});
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ReadPixels|CONTEXT_LOST/i.test(m.text())) pageErrors.push(m.text()); });
await page.goto(pathToFileURL(FILE).href);
await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });

/* ------------------------------------------------------------------ helpers */
let shotN = 0;
const report = { checks: [], shots: [], notes: {} };
const g = (fn, arg) => page.evaluate(fn, arg);
const api = (m, ...a) => page.evaluate(([m, a]) => window.__game[m](...a), [m, a]);
const ticks = (n) => api('waitTicks', n);
async function shot(name) {
  await api('waitFrames', 3);
  const f = join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f });
  report.shots.push(f);
  return f;
}
function check(ok, what, extra) {
  report.checks.push({ ok: !!ok, what, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}
const block = (x, y, z) => api('getBlock', x, y, z);
const state = (x, y, z) => api('getState', x, y, z);
/** Hold `item` (count) in slot 0 like a kid picking it from the hotbar. */
async function hold(item, count = 1) { await api('setSlot', 0, item, count); await api('selectSlot', 0); }
async function empty() { await api('setSlot', 1, null); await api('selectSlot', 1); }
/** Click (tap) the world point with the real mouse. Returns false when it is off screen. */
async function clickAt(x, y, z, waitT = 3) {
  const n = await api('worldToNdc', x, y, z);
  if (!n.onScreen) return false;
  await page.mouse.click(Math.round((n.x + 1) / 2 * W), Math.round((1 - n.y) / 2 * H));
  await ticks(waitT);
  return true;
}
async function look(x, y, z) { await api('lookAt', x, y, z); }
async function stand(x, y, z, lx, ly, lz, fly = false) {
  await api('teleport', x, y, z);
  await api('setFlying', fly);
  await ticks(4);
  if (lx !== undefined) await look(lx, ly, lz);
}
/** Flat grass stage (radius r) at height gy with air above, centred on (cx, cz). */
async function stage(cx, cz, gy, r = 7, top = 'grass_block') {
  await g(([cx, cz, gy, r, top]) => {
    const G = window.__game.game, id = window.__game.blockId, w = G.world;
    w.beginBatch();
    try {
      for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
        for (let y = gy - 3; y < gy; y++) w.setBlock(x, y, z, id('dirt'), 0, { cause: 'test' });
        w.setBlock(x, gy, z, id(top), 0, { cause: 'test' });
        for (let y = gy + 1; y <= gy + 12; y++) if (w.getBlock(x, y, z)) w.setBlock(x, y, z, 0, 0, { cause: 'test' });
      }
    } finally { w.endBatch(); }
  }, [cx, cz, gy, r, top]);
  await ticks(4);
}
/** Go there, wait for the columns to stream in, then build the stage on the local surface. Returns its height. */
async function stageAt(cx, cz, r = 7) {
  await api('teleport', cx + 0.5, 100, cz + 8.5);
  await g(([cx, cz, r]) => window.__game.waitFor(() => { const w = window.__game.game.world; for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 9]]) if (!w.isColumnLoaded((cx + dx) >> 4, (cz + dz) >> 4)) return false; return true; }, 10000), [cx, cz, r]);
  const gy = Math.min(90, Math.max(40, await api('surfaceY', cx, cz)));
  await stage(cx, cz, gy, r);
  return gy;
}
/** Next unused dry-land site on a 26-block grid spiralling out from spawn (no water or lava near the stage). */
const usedSites = new Set();
const siteCentres = [];
async function site(r = 7) {
  const cand = [];
  for (let ring = 1; ring < 8; ring++) for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) if (Math.max(Math.abs(i), Math.abs(j)) === ring) cand.push([i, j]);
  for (const [i, j] of cand) {
    const key = i + ',' + j;
    if (usedSites.has(key)) continue;
    const cx = SX + i * 26, cz = SZ + j * 26;
    await api('teleport', cx + 0.5, 100, cz + 8.5);
    await g(([cx, cz, r]) => window.__game.waitFor(() => { const w = window.__game.game.world; for (const [dx, dz] of [[-r - 3, -r - 3], [r + 3, -r - 3], [-r - 3, r + 3], [r + 3, r + 3], [0, 9]]) if (!w.isColumnLoaded((cx + dx) >> 4, (cz + dz) >> 4)) return false; return true; }, 10000), [cx, cz, r]);
    const gy = await api('surfaceY', cx, cz);
    if (gy < 50 || gy > 85) continue;
    const wet = await g(([cx, cz, gy, r]) => { for (let x = cx - r - 3; x <= cx + r + 3; x++) for (let z = cz - r - 3; z <= cz + r + 3; z++) for (let y = gy - 3; y <= gy + 6; y++) { const b = window.__game.getBlock(x, y, z); if (b === 'water' || b === 'lava') return true; } return false; }, [cx, cz, gy, r]);
    if (wet) continue;
    usedSites.add(key);
    siteCentres.push([cx, cz]);
    await stage(cx, cz, gy, r);
    return { cx, cz, gy };
  }
  throw new Error('no dry site found');
}
async function setB(x, y, z, name, st = 0) { return api('setBlock', x, y, z, name, st); }
async function frameTimes(ms) {
  return g((ms) => new Promise((res) => {
    const out = []; let last = performance.now(); const t0 = last;
    const f = (t) => { out.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else res(out); };
    requestAnimationFrame(f);
  }), ms);
}
const summarise = (a) => { const s = [...a].sort((x, y) => x - y); return { frames: a.length, avg: +(a.reduce((p, c) => p + c, 0) / a.length).toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1) }; };

/* ------------------------------------------------------------------ world */
await api('startWorld', { preset: 'default', seed: 12345, mode: 'creative', difficulty: 'peaceful' });
await api('setRandomSeed', 777);
await page.waitForTimeout(2500);
const spawn = await api('pos');
const SX = Math.floor(spawn.x), SZ = Math.floor(spawn.z);
const GY = await api('surfaceY', SX, SZ);
report.notes.spawn = { SX, SZ, GY, scheme: await g(() => window.__game.game.input.scheme) };
report.notes.baseline = await api('stats');
console.log('baseline', JSON.stringify(report.notes.baseline));

const STATIONS = {
  /* ---------------- doors + gates + fences ---------------- */
  async door() {
    const { cx, cz, gy } = await site();
    await stand(cx + 0.5, gy + 1, cz + 4.5, cx + 0.5, gy + 1, cz + 0.5);
    await hold('oak_door', 1);
    await clickAt(cx + 0.5, gy + 1, cz + 0.5);
    check(await block(cx, gy + 1, cz) === 'oak_door' && await block(cx, gy + 2, cz) === 'oak_door', 'door: one tap on the grass places a two-high door');
    // the hinge partner: a second door to the right makes a double door
    await clickAt(cx + 1.5, gy + 1, cz + 0.5);
    check((await state(cx + 1, gy + 1, cz) & 16) === 16 || (await state(cx, gy + 1, cz) & 16) === 16, 'door: second door next to it gets the other hinge (double door)', [await state(cx, gy + 1, cz), await state(cx + 1, gy + 1, cz)]);
    await look(cx + 1, gy + 2, cz + 0.5);
    await shot('door-double-closed');
    await clickAt(cx + 0.5, gy + 1.5, cz + 0.6);
    await clickAt(cx + 1.5, gy + 1.5, cz + 0.6);
    check((await state(cx, gy + 1, cz) & 4) && (await state(cx, gy + 2, cz) & 4), 'door: tap opens both halves');
    await look(cx + 1, gy + 2, cz + 0.5);
    await shot('door-double-open');
    // walk through the open door (real movement keys)
    const before = await api('pos');
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1600); await page.keyboard.up('KeyW');
    await ticks(2);
    const after = await api('pos');
    check(after.z < cz, 'door: the kid walks through the open double door', { from: before.z.toFixed(2), to: after.z.toFixed(2) });
    // a fence pen with a gate
    const fx = cx - 4;
    await stand(fx + 0.5, gy + 1, cz + 5.5, fx + 0.5, gy + 1, cz + 0.5);
    await hold('oak_fence', 64);
    for (const [x, z] of [[fx - 2, cz - 2], [fx - 1, cz - 2], [fx, cz - 2], [fx + 1, cz - 2], [fx + 2, cz - 2], [fx - 2, cz - 1], [fx - 2, cz], [fx - 2, cz + 1], [fx + 2, cz - 1], [fx + 2, cz], [fx + 2, cz + 1], [fx - 2, cz + 2], [fx - 1, cz + 2], [fx + 1, cz + 2], [fx + 2, cz + 2]]) {
      await clickAt(x + 0.5, gy + 1, z + 0.5, 1);
    }
    await hold('oak_fence_gate', 1);
    await clickAt(fx + 0.5, gy + 1, cz + 2.5);
    await ticks(3);
    check(await block(fx, gy + 1, cz + 2) === 'oak_fence_gate', 'fence: gate placed in the pen wall');
    const conn = await state(fx - 1, gy + 1, cz + 2);
    check((conn & 2) === 2, 'fence: the fence next to the gate connects to it', conn);
    await look(fx + 0.5, gy + 1, cz);
    await shot('fence-pen-closed');
    await empty();
    await clickAt(fx + 0.5, gy + 1.5, cz + 2.5);
    check((await state(fx, gy + 1, cz + 2) & 4) === 4, 'fence: tapping the gate with an empty hand opens it (does not break it)');
    await shot('fence-pen-open');
  },

  /* ---------------- torch support ---------------- */
  async torch() {
    const { cx, cz, gy } = await site();
    for (let y = gy + 1; y <= gy + 3; y++) for (let x = cx - 1; x <= cx + 1; x++) await setB(x, y, cz - 1, 'cobblestone');
    await stand(cx + 0.5, gy + 1, cz + 3.5, cx + 0.5, gy + 2, cz);
    await hold('torch', 64);
    await clickAt(cx + 0.5, gy + 2.5, cz - 0.001);
    check(await block(cx, gy + 2, cz) === 'torch', 'torch: tap on a wall places a wall torch', await state(cx, gy + 2, cz));
    await clickAt(cx - 0.5, gy + 1, cz + 1.5);
    check(await block(cx - 1, gy + 1, cz + 1) === 'torch', 'torch: tap on the ground places a standing torch');
    await api('setTime', 18000);
    await ticks(3);
    await shot('torch-night');
    await api('setTime', 6000);
    await empty();
    const n0 = await api('eventCount', 'block:broken');
    await clickAt(cx + 0.9, gy + 2.1, cz - 0.001);   // the wall next to the torch, not the torch itself
    await ticks(3);
    check(await block(cx, gy + 2, cz - 1) === 'air' && await block(cx, gy + 2, cz) === 'air', 'torch: breaking the wall pops the torch off', { broken: (await api('eventCount', 'block:broken')) - n0 });
    await shot('torch-popped');
  },

  /* ---------------- falling sand / gravel ---------------- */
  async sand() {
    const { cx, cz, gy } = await site();
    for (let y = gy + 1; y <= gy + 4; y++) await setB(cx, y, cz, 'oak_planks');
    await stand(cx + 0.5, gy + 6, cz + 4.5, cx + 0.5, gy + 5, cz + 0.5, true);   // flying up high, like a kid in creative
    await hold('sand', 64);
    await clickAt(cx + 0.5, gy + 5, cz + 0.5);
    await clickAt(cx + 0.5, gy + 6, cz + 0.5);
    await hold('gravel', 64);
    await clickAt(cx + 0.5, gy + 7, cz + 0.5);
    check(await block(cx, gy + 5, cz) === 'sand' && await block(cx, gy + 7, cz) === 'gravel', 'sand: sand and gravel stack on a post');
    await empty();
    await stand(cx + 0.5, gy + 1, cz + 4.5, cx + 0.5, gy + 3, cz + 0.5);
    await look(cx + 0.5, gy + 4, cz + 0.5);
    await shot('sand-on-post');
    // knock the post out from under them, the way a kid would: tap the plank right under the sand, again and again
    let ents = [];
    for (let y = gy + 4; y >= gy + 1; y--) {
      const top = await g(([x, z, y0]) => { for (let y = y0; y > y0 - 6; y--) if (window.__game.getBlock(x, y, z) === 'oak_planks') return y; return -1; }, [cx, cz, y]);
      if (top < 0) break;
      await look(cx + 0.5, top + 0.5, cz + 0.5);
      await clickAt(cx + 0.5, top + 0.5, cz + 1.001, 1);
      const now = (await api('entities')).filter((e) => e.type === 'falling_block');
      if (now.length > ents.length) { const first = !ents.length; ents = now; if (first) { await look(cx + 0.5, top + 1, cz + 0.5); await shot('sand-falling'); } }
      await page.waitForTimeout(500);
    }
    check(ents.length >= 1, 'sand: the column falls as falling_block entities', ents.length);
    await page.waitForTimeout(2500);
    const col = [await block(cx, gy + 1, cz), await block(cx, gy + 2, cz), await block(cx, gy + 3, cz)];
    check(col[0] === 'sand' && col[1] === 'sand' && col[2] === 'gravel', 'sand: lands as a neat stack on the ground', col);
    check((await api('entities')).every((e) => e.type !== 'falling_block'), 'sand: no falling entities left over');
    await look(cx + 0.5, gy + 2, cz + 0.5);
    await shot('sand-landed');
  },

  /* ---------------- water + lava ---------------- */
  async water() {
    const { cx, cz, gy } = await site(9);
    await stand(cx + 0.5, gy + 1, cz + 7.5, cx + 0.5, gy, cz);
    await hold('water_bucket');
    await clickAt(cx + 0.5, gy + 1, cz + 0.5);
    check(await block(cx, gy + 1, cz) === 'water', 'water: tap with a water bucket pours a source');
    check((await api('selected')).item === 'bucket', 'water: the bucket in hand is now empty');
    await page.waitForTimeout(2600);
    const spread = await g(([cx, cz, y]) => { let n = 0; for (let x = cx - 9; x <= cx + 9; x++) for (let z = cz - 9; z <= cz + 9; z++) if (window.__game.getBlock(x, y, z) === 'water') n++; return n; }, [cx, cz, gy + 1]);
    check(spread >= 60 && spread <= 120, 'water: spreads 7 out in a diamond (~85 cells)', spread);
    await shot('water-spread');
    await look(cx + 4, gy + 1, cz + 3);
    await stand(cx + 3.5, gy + 1, cz + 1.5);
    const p0 = await api('pos');
    await page.waitForTimeout(1500);
    const p1 = await api('pos');
    check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.3, 'water: the current pushes the player away from the source', { dx: +(p1.x - p0.x).toFixed(2), dz: +(p1.z - p0.z).toFixed(2) });
    // pick the source back up: the water drains away
    await stand(cx + 0.5, gy + 1, cz + 6.5);
    await look(cx + 0.5, gy + 1, cz + 0.5);
    await clickAt(cx + 0.5, gy + 1.05, cz + 0.5);
    check((await api('selected')).item === 'water_bucket', 'water: tapping the source with the empty bucket fills it');
    await page.waitForTimeout(3500);
    const left = await g(([cx, cz, y]) => { let n = 0; for (let x = cx - 9; x <= cx + 9; x++) for (let z = cz - 9; z <= cz + 9; z++) if (window.__game.getBlock(x, y, z) === 'water') n++; return n; }, [cx, cz, gy + 1]);
    check(left === 0, 'water: flowing water drains once the source is gone', left);
    // lava meets water
    await hold('lava_bucket');
    await clickAt(cx - 2.5, gy + 1, cz + 0.5);
    await hold('water_bucket');
    await clickAt(cx + 2.5, gy + 1, cz + 0.5);
    await page.waitForTimeout(4000);
    const made = await g(([cx, cz, y]) => { const c = {}; for (let x = cx - 9; x <= cx + 9; x++) for (let z = cz - 9; z <= cz + 9; z++) { const b = window.__game.getBlock(x, y, z); if (b === 'cobblestone' || b === 'obsidian' || b === 'stone') c[b] = (c[b] || 0) + 1; } return c; }, [cx, cz, gy + 1]);
    check(Object.keys(made).length > 0, 'lava: water meets lava and makes cobblestone/obsidian', made);
    await look(cx, gy + 1, cz);
    await shot('lava-water');
    await api('setTime', 18000); await ticks(3);
    await shot('lava-night-glow');
    await api('setTime', 6000);
    // clean the area so later stations stay readable
    await stage(cx, cz, gy, 9);
  },

  /* ---------------- farming + bone meal + saplings ---------------- */
  async farm() {
    const { cx, cz, gy } = await site();
    await setB(cx, gy, cz + 1, 'water');
    await stand(cx + 0.5, gy + 1, cz + 5.5, cx + 0.5, gy, cz);
    await hold('wooden_hoe');
    for (const dx of [-1, 0, 1]) await clickAt(cx + dx + 0.5, gy + 1, cz + 0.5);
    check(await block(cx, gy, cz) === 'farmland', 'farm: hoe tap turns grass into farmland');
    await ticks(30);
    await hold('wheat_seeds', 64);
    for (const dx of [-1, 0, 1]) await clickAt(cx + dx + 0.5, gy + 15 / 16, cz + 0.5);
    check(await block(cx, gy + 1, cz) === 'wheat', 'farm: seeds tap plants wheat');
    await look(cx, gy + 0.5, cz);
    await shot('farm-planted');
    await hold('bone_meal', 64);
    for (let i = 0; i < 6; i++) await clickAt(cx + 0.5, gy + 1.2, cz + 0.5, 1);
    check((await state(cx, gy + 1, cz) & 7) === 7, 'farm: bone meal grows the wheat to ripe', await state(cx, gy + 1, cz));
    await shot('farm-bonemeal');
    // sapling + bone meal -> tree
    await hold('oak_sapling', 4);
    await clickAt(cx + 3.5, gy + 1, cz + 1.5);
    check(await block(cx + 3, gy + 1, cz + 1) === 'oak_sapling', 'tree: sapling planted');
    await look(cx + 3.5, gy + 1.3, cz + 1.5);
    await shot('farm-sapling');
    await hold('bone_meal', 64);
    let meals = 0;
    for (; meals < 15 && await block(cx + 3, gy + 1, cz + 1) === 'oak_sapling'; meals++) await clickAt(cx + 3.5, gy + 1.4, cz + 1.5, 1);
    check(await block(cx + 3, gy + 1, cz + 1) === 'oak_log', 'tree: bone meal grows the sapling into a tree', { taps: meals });
    await stand(cx + 0.5, gy + 1, cz + 7.5, cx + 2, gy + 3, cz - 2);
    await shot('farm-tree');
  },

  /* ---------------- bed + nap ---------------- */
  async bed() {
    const { cx, cz, gy } = await site();
    await stand(cx + 0.5, gy + 1, cz + 4.5, cx + 0.5, gy + 1, cz + 0.5);
    await hold('red_bed');
    await clickAt(cx + 0.5, gy + 1, cz + 0.5);
    check(await block(cx, gy + 1, cz) === 'bed' && await block(cx, gy + 1, cz - 1) === 'bed', 'bed: one tap places a two-long bed');
    await look(cx + 0.5, gy + 1, cz - 0.5);
    await shot('bed-placed');
    const t0 = await api('getTime');
    await empty();
    await clickAt(cx + 0.5, gy + 1.5, cz + 0.3);
    await ticks(10);
    const nap = await g(() => window.__game.game.mechanics.sleeping());
    check(nap && nap.nap, 'bed: tapping the bed starts a nap (kid default)', { nap, t0, now: await api('getTime') });
    await shot('bed-nap');
    await page.waitForTimeout(4500);
    check(!(await g(() => window.__game.game.mechanics.sleeping())), 'bed: wakes up again by itself', { time: await api('getTime') });
    await shot('bed-woke');
  },

  /* ---------------- paintings on four walls ---------------- */
  async painting() {
    const { cx, cz, gy } = await site();
    // a 9x9 room of stone bricks, 4 high
    await g(([cx, cz, gy]) => {
      const G = window.__game.game, id = window.__game.blockId, w = G.world;
      w.beginBatch();
      try { for (let x = cx - 4; x <= cx + 4; x++) for (let z = cz - 4; z <= cz + 4; z++) for (let y = gy + 1; y <= gy + 4; y++) if (Math.abs(x - cx) === 4 || Math.abs(z - cz) === 4) w.setBlock(x, y, z, id('stone_bricks'), 0, { cause: 'test' }); } finally { w.endBatch(); }
    }, [cx, cz, gy]);
    await hold('painting', 16);
    const walls = [['north', [cx, gy + 2.5, cz - 3.5 - 0.001], [0, 0, -1]], ['east', [cx + 3.5 + 0.001, gy + 2.5, cz], [1, 0, 0]], ['south', [cx, gy + 2.5, cz + 3.5 + 0.001], [0, 0, 1]], ['west', [cx - 3.5 - 0.001, gy + 2.5, cz], [-1, 0, 0]]];
    for (const [name, p, n] of walls) {
      await stand(cx + 0.5 - n[0] * 2, gy + 1, cz + 0.5 - n[2] * 2, p[0] + 0.5, p[1], p[2] + 0.5);
      const before = (await api('entities')).filter((e) => e.type === 'painting').length;
      await clickAt(p[0] + 0.5 * (1 - Math.abs(n[0])), p[1], p[2] + 0.5 * (1 - Math.abs(n[2])));
      const after = (await api('entities')).filter((e) => e.type === 'painting').length;
      check(after === before + 1, `painting: hangs on the ${name} wall`);
      await shot(`painting-${name}`);
    }
    report.notes.pictures = await g(() => window.__game.game.entities.ofType('painting').map((e) => e.data.index));
    const geoBefore = (await api('stats')).geometries;
    const count = async () => (await api('entities')).filter((e) => e.type === 'painting').length;
    await empty();
    // 1. a kid taps a painting with an empty hand (creative): it comes down, like a tapped block
    await stand(cx + 0.5, gy + 1, cz + 0.5, cx + 0.5, gy + 2.5, cz + 4);
    await clickAt(cx + 0.5, gy + 2.3, cz + 3.95);
    check(await count() === 3, 'painting: an empty-hand tap takes the south painting down', await count());
    // 2. hold (attack) on the east painting with the real mouse
    await look(cx + 4, gy + 2.5, cz + 0.5);
    const n = await api('worldToNdc', cx + 3.95, gy + 2.3, cz + 0.5);
    await page.mouse.move(Math.round((n.x + 1) / 2 * W), Math.round((1 - n.y) / 2 * H));
    await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
    await ticks(3);
    check(await count() === 2, 'painting: holding on the east painting takes it down', await count());
    // 3. break the wall behind the north painting from outside the room
    await stand(cx + 0.5, gy + 1, cz - 6.5, cx + 0.5, gy + 2.5, cz - 4);
    const north = await g(() => window.__game.game.entities.ofType('painting').find((e) => e.data.facing === 2) || window.__game.game.entities.ofType('painting')[0]);
    const nb = await g(() => { const e = window.__game.game.entities.ofType('painting').find((p) => p.data.facing === 2); return e ? { x: e.data.ax, y: e.data.ay, z: e.data.az } : null; });
    if (nb) await clickAt(nb.x + 0.5, nb.y + 0.5, nb.z - 1 - 0.001);
    await ticks(14);
    check(await count() === 1, 'painting: pops off when the wall behind it is broken', { left: await count(), anchor: nb, north: !!north });
    await shot('painting-wall-broken');
    report.notes.paintingGeometries = { before: geoBefore, after: (await api('stats')).geometries };
  },

  /* ---------------- cake ---------------- */
  async cake() {
    const { cx, cz, gy } = await site();
    await stand(cx + 0.5, gy + 1, cz + 3.5, cx + 0.5, gy + 1, cz + 0.5);
    await hold('cake');
    await clickAt(cx + 0.5, gy + 1, cz + 0.5);
    check(await block(cx, gy + 1, cz) === 'cake', 'cake: placed');
    await empty();
    for (let i = 0; i < 3; i++) await clickAt(cx + 0.5, gy + 1.4, cz + 0.5);
    check(await state(cx, gy + 1, cz) === 3, 'cake: three taps eat three slices (empty hand does not break it)', await state(cx, gy + 1, cz));
    await stand(cx - 1.5, gy + 1, cz + 2.5, cx + 0.5, gy + 1.2, cz + 0.5);
    await shot('cake-bites');
  },

  /* ---------------- TNT ---------------- */
  async tnt() {
    const { cx, cz, gy } = await site(12);
    // a little house to blow up + a TNT row
    await g(([cx, cz, gy]) => {
      const G = window.__game.game, id = window.__game.blockId, w = G.world;
      w.beginBatch();
      try {
        for (let x = cx - 3; x <= cx + 3; x++) for (let z = cz - 6; z <= cz - 2; z++) for (let y = gy + 1; y <= gy + 4; y++) if (Math.abs(x - cx) === 3 || z === cz - 6 || z === cz - 2 || y === gy + 4) w.setBlock(x, y, z, id('oak_planks'), 0, { cause: 'test' });
        for (let x = cx - 2; x <= cx + 2; x++) w.setBlock(x, gy + 1, cz - 4, id('tnt'), 0, { cause: 'test' });
        w.setBlock(cx, gy + 1, cz, id('tnt'), 0, { cause: 'test' });
        for (let k = 1; k <= 3; k++) w.setBlock(cx, gy + 1, cz - k, id('tnt'), 0, { cause: 'test' });
      } finally { w.endBatch(); }
    }, [cx, cz, gy]);
    await stand(cx + 0.5, gy + 1, cz + 6.5, cx + 0.5, gy + 2, cz - 2);
    await shot('tnt-before');
    const base = await api('stats');
    await hold('flint_and_steel');
    await clickAt(cx + 0.5, gy + 1.5, cz + 0.5);
    check(await block(cx, gy + 1, cz) === 'air' && (await api('entities')).some((e) => e.type === 'tnt'), 'tnt: flint and steel tap lights the TNT (it hops out as an entity)');
    await stand(cx + 0.5, gy + 1, cz + 10.5, cx + 0.5, gy + 2, cz - 2);   // step back like a sensible kid
    await page.waitForTimeout(300);
    await shot('tnt-primed-flash');
    await page.waitForTimeout(3150);
    await shot('tnt-swell');
    const ft = await frameTimes(5000);
    const fs = summarise(ft);
    report.notes.tntFrames = fs;
    const ex = await g(() => window.__game.game.mechanics.stats);
    report.notes.tntStats = { explosions: ex.explosions, last: ex.lastExplosion };
    check(ex.explosions >= 6, 'tnt: the chain sets off the whole row', ex.explosions);
    check(fs.max < (argv.includes('--swiftshader') ? 400 : 120), 'tnt: no long frame while the chain explodes', fs);
    await page.waitForTimeout(1500);
    await shot('tnt-crater');
    const after = await api('stats');
    report.notes.tntDrawCalls = { before: base.drawCalls, after: after.drawCalls, entitiesAfter: after.entities, fps: after.fps };
    await stand(cx + 0.5, gy + 6, cz + 8.5, cx + 0.5, gy - 1, cz - 3);
    await shot('tnt-crater-above');
  },

  /* ---------------- lava on its own ---------------- */
  async lava() {
    const { cx, cz, gy } = await site(9);
    await stand(cx + 0.5, gy + 1, cz + 7.5, cx + 0.5, gy, cz);
    await hold('lava_bucket');
    await clickAt(cx + 0.5, gy + 1, cz + 0.5);
    check(await block(cx, gy + 1, cz) === 'lava', 'lava: a lava bucket tap pours lava');
    await page.waitForTimeout(6000);
    const n = await g(([cx, cz, y]) => { let n = 0; for (let x = cx - 6; x <= cx + 6; x++) for (let z = cz - 6; z <= cz + 6; z++) if (window.__game.getBlock(x, y, z) === 'lava') n++; return n; }, [cx, cz, gy + 1]);
    check(n >= 5 && n <= 25, 'lava: spreads slowly and only 3 out (1-4 cells per direction after 6 s)', n);
    await shot('lava-spread');
    await api('setTime', 18000); await ticks(3);
    const light = await api('getLight', cx + 2, gy + 1, cz + 2);
    check(light.block >= 10, 'lava: glows (block light around it)', light);
    await shot('lava-night');
    await api('setTime', 6000);
    // tap the lava with an empty bucket to take it back
    await hold('bucket');
    await clickAt(cx + 0.5, gy + 1.05, cz + 0.5);
    check((await api('selected')).item === 'lava_bucket', 'lava: the empty bucket picks the source back up');
    await page.waitForTimeout(4000);
    await stage(cx, cz, gy, 9);
  },

  /* ---------------- natural growth with real light (random ticks, fast-forwarded) ---------------- */
  async growth() {
    const { cx, cz, gy } = await site();
    await g(([cx, cz, gy]) => {
      const a = window.__game, id = a.blockId, w = a.game.world;
      w.setBlock(cx, gy, cz, id('water'), 0, { cause: 'test' });
      for (const dx of [-2, -1, 1, 2]) { w.setBlock(cx + dx, gy, cz, id('farmland'), 7, { cause: 'test' }); w.setBlock(cx + dx, gy + 1, cz, id('wheat'), 0, { cause: 'test' }); }
      for (let dx = -2; dx <= 2; dx++) w.setBlock(cx + dx, gy, cz + 3, id('dirt'), 0, { cause: 'test' });
      w.setBlock(cx + 4, gy + 1, cz - 3, id('oak_sapling'), 0, { cause: 'test' });
      w.setBlock(cx - 4, gy, cz - 3, id('sand'), 0, { cause: 'test' });
      w.setBlock(cx - 4, gy + 1, cz - 3, id('sugar_cane'), 0, { cause: 'test' });
      w.setBlock(cx - 4, gy, cz - 2, id('water'), 0, { cause: 'test' });
    }, [cx, cz, gy]);
    await stand(cx + 0.5, gy + 1, cz + 7.5, cx + 0.5, gy + 1, cz);
    // leaves of real worldgen trees nearby (must never decay)
    // (skip the stage and its rim: the stage cut through trees there, and cut trees' leaves rightly decay)
    const leaves = () => g(([cx, cz, gy]) => { let n = 0; for (let x = cx - 40; x <= cx + 40; x++) for (let z = cz - 40; z <= cz + 40; z++) { if (Math.abs(x - cx) <= 14 && Math.abs(z - cz) <= 14) continue; for (let y = gy - 10; y < gy + 30; y++) { const b = window.__game.getBlock(x, y, z); if (b && b.endsWith('_leaves')) n++; } } return n; }, [cx, cz, gy]);
    const decayed = [];
    await g(() => { window.__mpDecay = []; window.__game.game.events.on('block:broken', (e) => { if (e.by === 'decay') window.__mpDecay.push([e.x, e.y, e.z]); }); });
    const l0 = await leaves();
    const t0 = Date.now();
    await api('runTicks', 30000);   // 25 game minutes (more than a day), synchronously
    report.notes.growthRunMs = Date.now() - t0;
    const ages = await g(([cx, cz, gy]) => [-2, -1, 1, 2].map((dx) => window.__game.getState(cx + dx, gy + 1, cz) & 7), [cx, cz, gy]);
    check(ages.every((a) => a >= 4), 'growth: wheat on wet farmland grows by itself in daylight', ages);
    const grass = await g(([cx, cz, gy]) => [-2, -1, 0, 1, 2].filter((dx) => window.__game.getBlock(cx + dx, gy, cz + 3) === 'grass_block').length, [cx, cz, gy]);
    check(grass >= 3, 'growth: grass spreads onto the bare dirt strip', grass);
    const tree = await block(cx + 4, gy + 1, cz - 3);
    check(tree === 'oak_log', 'growth: the sapling grows into a tree on its own', tree);
    const cane = [await block(cx - 4, gy + 1, cz - 3), await block(cx - 4, gy + 2, cz - 3), await block(cx - 4, gy + 3, cz - 3), await block(cx - 4, gy + 4, cz - 3)];
    // Java pace: one block per ~16 random ticks of the top cane (~22000 game ticks on average)
    report.notes.cane = cane;
    check(cane[0] === 'sugar_cane' && cane[3] !== 'sugar_cane', 'growth: sugar cane next to water stays and never grows above 3 (grown this run: ' + cane.filter((c) => c === 'sugar_cane').length + ')', cane);
    const l1 = await leaves();
    // decayed leaves far (> 22 blocks) from every stage this run built or blew up = worldgen trees nobody touched
    const dec = await g((sites) => window.__mpDecay.filter(([x, , z]) => sites.every(([sx, sz]) => Math.max(Math.abs(x - sx), Math.abs(z - sz)) > 22)), siteCentres);
    report.notes.decayedAway = dec.slice(0, 20);
    check(l1 >= l0 && dec.length === 0, 'growth: untouched worldgen trees keep all their leaves (no decay)', { before: l0, after: l1, decayedAway: dec.length, decayedTotal: await g(() => window.__mpDecay.length) });
    await look(cx, gy + 1, cz);
    await shot('growth-after-30000-ticks');
  },

  /* ---------------- survival: knockback, trampling, sleep lock ---------------- */
  async survival() {
    const { cx, cz, gy } = await site(9);
    await api('setMode', 'survival');
    await api('setRule', 'daylightCycle', true);
    // trampling: fall 3 blocks onto farmland
    await setB(cx, gy, cz, 'farmland', 0);
    await api('setRandomSeed', 3);
    await stand(cx + 0.5, gy + 4, cz + 0.5);
    await ticks(30);
    check(await block(cx, gy, cz) === 'dirt', 'survival: jumping onto farmland from high up tramples it to dirt', await block(cx, gy, cz));
    // explosion knockback on the player
    await stand(cx + 0.5, gy + 1, cz + 0.5);
    await ticks(5);
    const p0 = await api('pos');
    await g(([x, y, z]) => window.__game.game.mechanics.explode(x, y, z, 4, { source: 'test', now: true, breakBlocks: false }), [cx + 3.5, gy + 1, cz + 0.5]);
    await ticks(6);
    const p1 = await api('pos');
    check(p1.x < p0.x - 0.5, 'survival: an explosion pushes the player away', { dx: +(p1.x - p0.x).toFixed(2), health: [p0.health, p1.health] });
    // sleep: night, bed, no movement while asleep
    await api('setTime', 14000);
    await stand(cx + 0.5, gy + 1, cz + 4.5, cx + 0.5, gy + 1, cz + 0.5);
    await hold('red_bed');
    await clickAt(cx + 0.5, gy + 1, cz + 0.5);
    await empty();
    await clickAt(cx + 0.5, gy + 1.4, cz + 0.4);
    await ticks(5);
    const sl = await g(() => window.__game.game.mechanics.sleeping());
    check(sl && !sl.nap, 'survival: at night the bed sleeps for real', sl);
    const q0 = await api('pos');
    await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW');
    const q1 = await api('pos');
    check(Math.hypot(q1.x - q0.x, q1.z - q0.z) < 0.05, 'survival: no walking while asleep', { moved: +Math.hypot(q1.x - q0.x, q1.z - q0.z).toFixed(3) });
    await shot('survival-sleeping');
    await page.waitForTimeout(6000);
    const t = await api('getTime');
    check(t < 1000 || t > 23000, 'survival: wakes up in the morning', t);
    await api('setMode', 'creative');
    await api('setRule', 'daylightCycle', false);
    await api('setTime', 6000);
  },

  /* ---------------- performance of the mechanics tick ---------------- */
  async perf() {
    await stand(SX + 0.5, GY + 1, SZ + 0.5);
    const r = await g(async () => {
      const G = window.__game.game, m = G.mechanics;
      const orig = m.tick.bind(m);
      const times = [];
      m.tick = () => { const t = performance.now(); orig(); times.push(performance.now() - t); };
      const rt0 = m.stats.randomTicks, s0 = m.stats.schedMs, r0 = m.stats.randomMs, l0 = m.stats.leafChecks, n0 = m.stats.ticksRun;
      await window.__game.waitTicks(200);
      m.tick = orig;
      times.sort((a, b) => a - b);
      return { ticks: times.length, avgMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), p95: +times[Math.floor(times.length * 0.95)].toFixed(3), max: +times[times.length - 1].toFixed(3), randomTicksPerTick: +((m.stats.randomTicks - rt0) / times.length).toFixed(1), schedMsPerTick: +((m.stats.schedMs - s0) / times.length).toFixed(3), schedRunsPerTick: +((m.stats.ticksRun - n0) / times.length).toFixed(1), randomMsPerTick: +((m.stats.randomMs - r0) / times.length).toFixed(3), leafChecksPerTick: +((m.stats.leafChecks - l0) / times.length).toFixed(2), leafMsTotal: m.stats.leafMs, R: G.world.renderDistance, columns: G.world.stats().columns };
    });
    report.notes.mechTick = r;
    check(r.avgMs < 1.0, 'perf: the mechanics tick averages under 1 ms with the real world loaded', r);
    report.notes.end = await api('stats');
  },
};

for (const [name, fn] of Object.entries(STATIONS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  console.log(`--- ${name}`);
  try { await fn(); } catch (err) { check(false, `${name}: threw ${err.message}`); try { await shot(`${name}-ERROR`); } catch { /* ignore */ } }
}
const gameErrors = await g(() => window.__game.errors.map((e) => `${e.where}: ${e.message}`));
check(gameErrors.length === 0 && pageErrors.length === 0, 'no game or page errors', { gameErrors, pageErrors: pageErrors.slice(0, 5) });
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const fails = report.checks.filter((c) => !c.ok).length;
console.log(`\n[mech-play] ${report.checks.length - fails}/${report.checks.length} checks passed; ${report.shots.length} screenshots in ${OUT}`);
console.log(JSON.stringify(report.notes));
await browser.close();
process.exit(fails ? 1 : 0);
