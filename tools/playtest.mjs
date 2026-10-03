// OWNER: LEAD (integration playtest). Scripted ~2-minute play session in real Chrome (Playwright), driven through
// REAL input wherever the CORE lanes own it: a mouse click on the Play button, arrow keys / Space / F / C / H
// on the keyboard, kid taps (click) and holds (mouse down/up) on the canvas, kid drag-to-look, and the classic
// pointer-lock scheme (click to lock, relative mouse motion, left = break, right = place).
// The test API (window.__game) is used only to place the camera where a scripted player cannot navigate
// (teleport next to a cave or a flat building spot, turn toward a face before a tap), to pick hotbar slots (the
// HUD that owns hotbar keys is a FEATURE lane) and to read state. Every block in the cave torches and the house
// is placed by a real click, and verified.
//
//   node tools/playtest.mjs                      build (minified, like the shipped file) into .tmp/integ-build, run
//   node tools/playtest.mjs --file index.html    run against an existing build (e.g. the root file)
//   node tools/playtest.mjs --swiftshader        CPU WebGL (weak-laptop proxy)
//   node tools/playtest.mjs --seed 12345|random  world seed (default 12345)
//   node tools/playtest.mjs --headed --tag name
//
// Screenshots: .tmp/<tag>-NN-<step>.png (tag default 'integ', 'integ-ss' with --swiftshader).
// Report: .tmp/<tag>-report.json. Exit code 1 when a check fails or any page/console/game error is recorded.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const W = 1280, H = 720;

function parseArgs(argv) {
  const a = { file: null, swiftshader: false, seed: '12345', headed: false, tag: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--file') a.file = resolve(ROOT, argv[++i]);
    else if (k === '--swiftshader') a.swiftshader = true;
    else if (k === '--seed') a.seed = argv[++i];
    else if (k === '--headed') a.headed = true;
    else if (k === '--tag') a.tag = argv[++i];
    else throw new Error(`playtest.mjs: unknown argument ${k}`);
  }
  if (!a.tag) a.tag = a.swiftshader ? 'integ-ss' : 'integ';
  return a;
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(TMP, { recursive: true });
// drop the previous run's numbered screenshots of this tag so the folder only shows this session
for (const f of readdirSync(TMP)) if (f.startsWith(`${args.tag}-`) && /^\d\d-.*\.png$/.test(f.slice(args.tag.length + 1))) unlinkSync(join(TMP, f));
const report = { when: new Date().toISOString(), args, steps: [], checks: [], screenshots: [], errors: [], perf: {} };
let shotN = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log('[playtest]', ...m);

function check(ok, name, detail) {
  report.checks.push({ ok: !!ok, name, detail: detail === undefined ? null : detail });
  log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ' ' + JSON.stringify(detail) : ''}`);
  return !!ok;
}

async function main() {
  let file = args.file;
  if (!file) {
    const out = join(TMP, 'integ-build');
    await build({ dev: false, out, quiet: false });
    file = join(out, 'index.html');
  }
  if (!existsSync(file)) throw new Error(`no build at ${file}`);
  const launchArgs = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'];
  if (args.swiftshader) launchArgs.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const browser = await chromium.launch({ executablePath: CHROME, headless: !args.headed, args: launchArgs });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console.error: ${m.text()}`); });
  page.on('crash', () => report.errors.push('page crashed'));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) report.errors.push(`network request: ${u}`); });

  const ev = (fn, a) => page.evaluate(fn, a);
  const api = (method, ...a) => page.evaluate(async ({ method, a }) => window.__game[method](...a), { method, a });
  const shot = async (name, note) => {
    const p = join(TMP, `${args.tag}-${String(++shotN).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: p });
    const s = await api('stats');
    report.screenshots.push({ path: p, note: note || null, fps: s.fps, drawCalls: s.drawCalls, pos: await api('pos').then((q) => ({ x: +q.x.toFixed(1), y: +q.y.toFixed(1), z: +q.z.toFixed(1), yaw: Math.round(q.yaw), pitch: Math.round(q.pitch) })) });
    log(`shot ${p}`);
  };
  const step = async (name, fn) => {
    const t0 = Date.now();
    log(`--- ${name}`);
    let error = null;
    try { await fn(); } catch (err) { error = err && err.message ? err.message : String(err); check(false, `${name} threw`, error); }
    const s = await api('stats').catch(() => null);
    report.steps.push({ name, ms: Date.now() - t0, error, fps: s && s.fps, drawCalls: s && s.drawCalls, frameMs: s && s.frameMs, workMs: s && s.workMs });
  };
  const key = async (code, ms = 60) => { await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code); };
  const holdKeys = async (codes, ms) => { for (const c of codes) await page.keyboard.down(c); await sleep(ms); for (const c of codes) await page.keyboard.up(c); };
  const ndcToPx = (n) => ({ x: Math.round((n.x + 1) / 2 * W), y: Math.round((1 - n.y) / 2 * H) });
  const waitTicks = (n) => api('waitTicks', n);
  /** Mouse leaves the game canvas: the kid cursor (and its outline) goes away, for clean scenery shots. */
  const hideCursor = () => ev(() => window.__game.game.canvas.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse', bubbles: false })));
  const waitFrames = (n) => api('waitFrames', n);
  const gameErrors = () => ev(() => window.__game.errors.map((e) => `${e.where}: ${e.message}`));

  /**
   * Kid tap on the face shared by solid cell `n` and the empty cell `c` (a real mouse click). Like a child, it
   * first hovers until the outline shows the right face (trying a few points on the face, then turning toward
   * it), and only then taps - so a mis-aimed tap never drops a block in the wrong place.
   */
  async function tapPlace(c, n, expect) {
    const d = [c[0] - n[0], c[1] - n[1], c[2] - n[2]];
    const axis = d[0] ? 0 : d[1] ? 1 : 2;
    const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3;
    const centre = [c[0] + 0.5 - d[0] * 0.5, c[1] + 0.5 - d[1] * 0.5, c[2] + 0.5 - d[2] * 0.5];
    const offs = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];
    const isAimed = (tg) => tg && ((tg.x === n[0] && tg.y === n[1] && tg.z === n[2] && tg.nx === d[0] && tg.ny === d[1] && tg.nz === d[2]) ||
      (tg.x === c[0] && tg.y === c[1] && tg.z === c[2])); // a replaceable plant in the target cell is fine too
    let tg = null, aimed = false;
    for (let attempt = 0; attempt < 2 && !aimed; attempt++) {
      if (attempt === 1) await api('lookAt', centre[0], centre[1], centre[2]);
      for (const [a, b] of offs) {
        const pnt = centre.slice();
        pnt[t1] += a; pnt[t2] += b;
        pnt[axis] += d[axis] * 0.01;
        const pt = await api('worldToNdc', pnt[0], pnt[1], pnt[2]);
        if (!pt.onScreen || Math.abs(pt.x) > 0.95 || Math.abs(pt.y) > 0.95) continue;
        const px = ndcToPx(pt);
        await page.mouse.move(px.x, px.y);
        await waitFrames(2);
        tg = await api('target');
        if (isAimed(tg)) { aimed = true; break; }
      }
    }
    if (!aimed) return { ok: false, got: await api('getBlock', c[0], c[1], c[2]), aimed: false, target: tg };
    await page.mouse.down(); await sleep(60); await page.mouse.up();
    await waitTicks(2);
    const got = await api('getBlock', c[0], c[1], c[2]);
    if (got !== expect) {
      const diag = await ev(() => ({ gestures: window.__game.events('input:gesture', 4).map((e) => e.payload.phase + '@' + e.tick), placed: window.__game.events('block:placed', 1), broken: window.__game.events('block:broken', 1), tick: window.__game.game.tickCount, target: window.__game.target() }));
      return { ok: false, got, aimed: true, target: tg, diag };
    }
    return { ok: got === expect, got, aimed: true, target: tg };
  }

  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });
    report.version = await ev(() => window.__game.version);
    report.perf.bootMs = await ev(() => Math.round(window.__game.game.bootMs));
    report.stubs = await api('stubs');
    // frame-time recorder (rAF deltas) for fps percentiles over the whole session
    await ev(() => {
      const g = window.__game.game;
      g.__pt = { dts: [], last: 0 };
      const f = (now) => { if (g.__pt.last) g.__pt.dts.push(now - g.__pt.last); g.__pt.last = now; requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    if (args.seed !== 'random') {
      const seed = Number(args.seed) >>> 0;
      await ev((seed) => { const g = window.__game.game; const orig = g.startWorld; g.startWorld = (o = {}) => orig(o.meta ? o : { ...o, seed }); }, seed);
    }

    await step('title', async () => {
      check(await api('uiOpen') === 'title', 'title screen is open');
      await shot('title');
    });

    await step('play', async () => {
      const t0 = Date.now();
      const btn = await page.$('[data-action="play"]');
      const box = await btn.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const ok = await page.waitForFunction(() => window.__game.worldReady === true, null, { timeout: 20000 }).then(() => true, () => false);
      report.perf.playToReadyMs = Date.now() - t0;
      check(ok, 'Play click -> playable world', { ms: report.perf.playToReadyMs });
      check(report.perf.playToReadyMs < 4000, 'playable within 4 s', report.perf.playToReadyMs);
      report.seed = await ev(() => window.__game.game.meta.seed);
      // how long until every column inside R-1 is meshed (the visible spawn area is complete)
      const t1 = Date.now();
      const full = await page.waitForFunction(() => window.__game.game.world.unmeshedWithin(window.__game.game.world.renderDistance - 1) === 0, null, { timeout: 20000 }).then(() => true, () => false);
      report.perf.spawnAreaCompleteMs = report.perf.playToReadyMs + (Date.now() - t1);
      check(full, 'spawn area (R-1) fully meshed', { ms: report.perf.spawnAreaCompleteMs });
      await waitTicks(3);
      const p = await api('pos');
      check(p.onGround && !p.inWater, 'spawned standing on dry ground', { x: p.x, y: p.y, z: p.z, onGround: p.onGround, inWater: p.inWater });
      await page.mouse.move(W / 2, H / 2);
      await waitFrames(5);
      await shot('spawn', `seed ${report.seed}`);
    });

    await step('walk-kid-keys', async () => {
      await page.keyboard.down('ArrowUp');
      await sleep(500);
      const a = await api('pos');
      await sleep(1000);
      const b = await api('pos');
      await page.keyboard.up('ArrowUp');
      const d1 = Math.hypot(b.x - a.x, b.z - a.z) / ((b.tick - a.tick) / 20);
      report.perf.walkSpeed = +d1.toFixed(2);
      check(d1 > 3.6 && d1 < 4.6, 'up arrow walks at ~4.3 blocks/s', d1.toFixed(2));
      await key('ArrowLeft', 80); // tap nudge
      const c = await api('pos');
      check(Math.abs(c.yaw - b.yaw) > 8 && Math.abs(c.yaw - b.yaw) < 20, 'left-arrow tap nudges the view ~12 deg', (c.yaw - b.yaw).toFixed(1));
      await holdKeys(['ArrowUp'], 1500);
      // jump
      const j0 = await api('pos');
      await page.keyboard.down('Space');
      let maxY = j0.y;
      for (let i = 0; i < 10; i++) { await waitTicks(1); maxY = Math.max(maxY, (await api('pos')).y); }
      await page.keyboard.up('Space');
      check(maxY - j0.y > 1.0, 'space jumps', (maxY - j0.y).toFixed(2));
      await holdKeys(['ArrowRight'], 900); // held turn ramps up
      await holdKeys(['ArrowUp'], 1500);
      await waitFrames(5);
      await shot('walk');
    });

    await step('drag-look', async () => {
      const a = await api('pos');
      await page.mouse.move(700, 400); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(700 + i * 25, 400 - i * 4); await sleep(16); }
      await page.mouse.up();
      await waitFrames(3);
      const b = await api('pos');
      check(Math.abs(b.yaw - a.yaw) > 20, 'kid drag turns the view', (b.yaw - a.yaw).toFixed(1));
      await shot('drag-look');
    });

    await step('fly-high', async () => {
      await key('KeyF');
      await waitTicks(2);
      let p = await api('pos');
      check(p.flying, 'F starts flying', p.flying);
      const y0 = p.y;
      await holdKeys(['Space'], 3500);
      p = await api('pos');
      check(p.y - y0 > 15, 'space flies up', (p.y - y0).toFixed(1));
      await hideCursor();
      for (const [i, yaw] of [0, 90, 180, 270].entries()) {
        await api('setLook', yaw, -18);
        await waitFrames(20);
        await shot(`fly-view-${['north', 'west', 'south', 'east'][i]}`);
      }
      await api('setLook', 30, -55);
      await waitFrames(10);
      await shot('fly-look-down');
    });

    await step('fly-stream', async () => {
      // fly forward (W + Space) through new terrain; sample streaming completeness and fps
      await api('setLook', 0, -15);
      const R = await ev(() => window.__game.game.world.renderDistance);
      const p0 = await api('pos');
      await page.keyboard.down('KeyW');
      let worst = 0, samples = 0, holes = 0;
      const tEnd = Date.now() + 6000;
      while (Date.now() < tEnd) {
        const u = await ev((r) => window.__game.game.world.unmeshedWithin(r), Math.max(1, R - 2));
        worst = Math.max(worst, u); samples++; if (u > 0) holes++;
        await sleep(200);
      }
      await page.keyboard.up('KeyW');
      const p1 = await api('pos');
      report.perf.flight = { distance: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1), R, worstUnmeshedWithinR2: worst, samplesWithHoles: holes, samples };
      check(report.perf.flight.distance > 40, 'flew forward through new terrain', report.perf.flight.distance);
      check(holes <= 2, 'streaming keeps up while flying (no unmeshed column within R-2 for > 0.4 s)', report.perf.flight);
      await waitFrames(10);
      await shot('fly-after-stream');
      // land: descend with C, then F off
      await holdKeys(['KeyC'], 1500);
      await key('KeyF');
      await page.waitForFunction(() => window.__game.pos().onGround || window.__game.pos().inWater, null, { timeout: 15000 }).catch(() => {});
      const pl = await api('pos');
      check(!pl.flying, 'F stops flying and the player lands', { flying: pl.flying, onGround: pl.onGround, inWater: pl.inWater });
    });

    let cave = null;
    await step('dig-to-cave', async () => {
      cave = await ev(() => {
        const g = window.__game.game, w = g.world, pl = g.player, ID = window.__game.blockId;
        const water = ID('water'), lava = ID('lava');
        const solid = (x, y, z) => { const id = w.getBlock(x, y, z); return id !== 0 && id !== water && id !== lava; };
        const px = Math.floor(pl.x), pz = Math.floor(pl.z);
        let best = null;
        for (let r = 0; r <= 40 && !best; r++) {
          for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = px + dx, z = pz + dz;
            if (!w.isColumnLoaded(x >> 4, z >> 4)) continue;
            const top = w.getSurfaceY(x, z);
            if (top < 50) continue;
            for (let y = 14; y < top - 10; y++) {
              if (w.getBlock(x, y, z) !== 0 || w.getBlock(x, y + 1, z) !== 0 || !solid(x, y - 1, z)) continue;
              if (w.getSkyLight(x, y, z) !== 0) continue;
              let air = 0;
              for (let ax = -3; ax <= 3; ax++) for (let az = -3; az <= 3; az++) for (let ay = 0; ay <= 2; ay++) if (w.getBlock(x + ax, y + ay, z + az) === 0) air++;
              if (air < 50) continue;
              let clean = true;
              for (let yy = y + 2; yy < top; yy++) { const id = w.getBlock(x, yy, z); if (id === water || id === lava) { clean = false; break; } }
              if (!clean) continue;
              best = { x, y, z, top, air, dist: Math.hypot(dx, dz) };
              break;
            }
            if (best) break;
          }
        }
        return best;
      });
      check(!!cave, 'found a cave under the surface near the player', cave);
      if (!cave) return;
      // stand on the surface above it and dig straight down with a kid HOLD (real mouse down at the centre)
      await api('teleport', cave.x + 0.5, cave.top, cave.z + 0.5);
      await waitTicks(5);
      await api('setLook', 0, -89);
      await page.mouse.move(W / 2, H / 2);
      await waitFrames(3);
      const broken0 = await api('eventCount', 'block:broken');
      const ceil = await ev(({ x, y, z }) => { let c = y + 2; while (window.__game.getBlockId(x, c, z) === 0) c++; return c; }, cave);
      await page.mouse.down();
      const tEnd = Date.now() + 25000;
      let q = await api('pos');
      while (Date.now() < tEnd) {
        await sleep(40);
        // the shaft opened into the cave: let go before the (8-block kid reach) ray digs the floor too
        if (await api('getBlockId', cave.x, ceil, cave.z) === 0) break;
      }
      await page.mouse.up();
      await page.waitForFunction((ceil) => { const p = window.__game.pos(); return p.onGround && p.y < ceil; }, ceil, { timeout: 5000 }).catch(() => {});
      q = await api('pos');
      const broken = (await api('eventCount', 'block:broken')) - broken0;
      check(Math.abs(q.y - cave.y) < 1.01, 'dug down into the cave with a kid hold', { y: q.y, caveY: cave.y, broken });
      cave.y = Math.floor(q.y);
      await api('setLook', 0, 85);
      await waitFrames(5);
      await shot('dig-shaft-up');
    });

    await step('cave-torches', async () => {
      if (!cave) return;
      // look around the dark cave first
      const dirs = await ev(({ x, y, z }) => {
        const w = window.__game.game.world;
        // pick the horizontal direction with the longest open run at eye height
        let best = [0, 0];
        for (let a = 0; a < 16; a++) {
          const ang = a / 16 * Math.PI * 2;
          let d = 0;
          for (; d < 12; d++) { if (w.getBlock(Math.floor(x + 0.5 + Math.sin(ang) * d), y + 1, Math.floor(z + 0.5 + Math.cos(ang) * d)) !== 0) break; }
          if (d > best[1]) best = [ang, d];
        }
        return best;
      }, cave);
      const yaw = Math.atan2(-Math.sin(dirs[0]), -Math.cos(dirs[0])) * 180 / Math.PI;
      await api('setLook', yaw, -12);
      await waitFrames(5);
      await shot('cave-dark');
      // candidate floor cells: air with an opaque block below, 2..6 blocks away, visible from the eye
      const spots = await ev(({ x, y, z }) => {
        const g = window.__game.game, w = g.world;
        const out = [];
        for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) for (let dy = -4; dy <= 3; dy++) {
          const cx = x + dx, cy = y + dy, cz = z + dz;
          const d = Math.hypot(dx, dz);
          if (d < 2 || d > 7) continue;
          if (w.getBlock(cx, cy, cz) !== 0 || w.getBlock(cx, cy + 1, cz) !== 0) continue;
          const below = w.getBlock(cx, cy - 1, cz);
          if (!below || below === window.__game.blockId('water') || below === window.__game.blockId('lava')) continue;
          if (w.getSkyLight(cx, cy, cz) > 8) continue;
          out.push({ x: cx, y: cy, z: cz, ang: Math.atan2(dx, dz), d });
        }
        // nearest first; the tap loop skips spots next to a torch it already placed
        out.sort((a, b) => a.d - b.d);
        return out.slice(0, 40);
      }, cave);
      await api('selectSlot', 5); // torch (KID_CREATIVE_HOTBAR slot 6)
      let placed = 0;
      const results = [];
      const torches = [];
      for (const s of spots) {
        if (torches.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 3)) continue;
        if (results.length >= 12) break;
        const r = await tapPlace([s.x, s.y, s.z], [s.x, s.y - 1, s.z], 'torch');
        results.push({ at: [s.x, s.y, s.z], ok: r.ok, got: r.got, aimed: r.aimed });
        if (r.ok) { placed++; torches.push(s); }
        if (placed >= 4) break;
      }
      check(placed >= 3 && results.every((r) => r.ok || !r.aimed), 'placed torches on the cave floor with kid taps (every aimed tap placed one)', { placed, tried: results.length, results });
      const lit = await ev((spots) => spots.map((s) => window.__game.getLight(s.x, s.y, s.z).block), torches);
      check(lit.every((b) => b === 14), 'torch cells carry block light 14', lit);
      if (torches.length) {
        const c = torches.reduce((a, t) => [a[0] + t.x / torches.length, a[1] + t.y / torches.length, a[2] + t.z / torches.length], [0, 0, 0]);
        await api('lookAt', c[0] + 0.5, c[1] + 0.3, c[2] + 0.5);
        await hideCursor(); // no hover outline in the way
        await waitFrames(5);
        await shot('cave-torches');
      }
    });

    let house = null;
    await step('home', async () => {
      await key('KeyH');
      await waitTicks(5);
      const p = await api('pos');
      const meta = await api('meta');
      check(Math.hypot(p.x - meta.spawn.x, p.z - meta.spawn.z) < 2, 'H brings the player home', { x: p.x, z: p.z });
      await waitFrames(5);
      await shot('home');
    });

    await step('build-house', async () => {
      // find a flat 7x7 grass spot near home (the 5x5 house + a ring around it)
      house = await ev(() => {
        const g = window.__game.game, w = g.world, ID = window.__game.blockId, pl = g.player;
        const okGround = new Set([ID('grass_block'), ID('dirt'), ID('sand'), ID('snow_block'), ID('podzol'), ID('coarse_dirt')].filter((x) => x !== undefined));
        const px = Math.floor(pl.x), pz = Math.floor(pl.z);
        const replaceable = (id) => id === 0 || (window.__game.blockId('short_grass') === id) || (window.__game.blockId('fern') === id) || ['poppy', 'dandelion', 'cornflower', 'oxeye_daisy', 'allium', 'blue_orchid', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'snow'].some((n) => window.__game.blockId(n) === id);
        for (let r = 3; r <= 28; r++) {
          for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const cx = px + dx, cz = pz + dz;
            const base = w.getSurfaceY(cx, cz);
            if (!(base > 48)) continue;
            let ok = true;
            for (let ax = -3; ax <= 3 && ok; ax++) for (let az = -3; az <= 3 && ok; az++) {
              const x = cx + ax, z = cz + az;
              if (!w.isColumnLoaded(x >> 4, z >> 4)) { ok = false; break; }
              if (w.getSurfaceY(x, z) !== base && !(replaceable(w.getBlock(x, base, z)) && okGround.has(w.getBlock(x, base - 1, z)))) ok = false;
              if (!okGround.has(w.getBlock(x, base - 1, z))) ok = false;
              for (let y = base; y < base + 6 && ok; y++) if (!replaceable(w.getBlock(x, y, z))) ok = false;
            }
            if (ok) return { cx, cz, base };
          }
        }
        return null;
      });
      check(!!house, 'found a flat building spot near home', house);
      if (!house) return;
      const { cx, cz, base } = house;
      // walk there is not scripted (pathing); stand in the middle of the footprint
      await api('setFlying', false);
      await api('teleport', cx + 0.5, base, cz + 0.5);
      await waitTicks(5);
      // clear the plants in the footprint with kid holds (a plant would catch the taps meant for the ground)
      let cleared = 0, plants = 0;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const x = cx + dx, z = cz + dz;
        if (await api('getBlockId', x, base, z) === 0) continue;
        plants++;
        let pt = await api('worldToNdc', x + 0.5, base + 0.25, z + 0.5);
        if (!pt.onScreen || Math.abs(pt.x) > 0.85 || Math.abs(pt.y) > 0.85) { await api('lookAt', x + 0.5, base + 0.25, z + 0.5); pt = await api('worldToNdc', x + 0.5, base + 0.25, z + 0.5); }
        const px = ndcToPx(pt);
        await page.mouse.move(px.x, px.y);
        await waitFrames(2);
        await page.mouse.down();
        const t0 = Date.now();
        while (Date.now() - t0 < 1500 && await api('getBlockId', x, base, z) !== 0) await sleep(20);
        await page.mouse.up();
        if (await api('getBlockId', x, base, z) === 0) cleared++;
        await waitTicks(1);
      }
      const groundOk = await ev(({ cx, cz, base }) => { let n = 0; for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (window.__game.getBlockId(cx + dx, base - 1, cz + dz) !== 0) n++; return n; }, house);
      check(cleared === plants && groundOk === 25, 'kid holds cleared the plants and left the ground intact', { cleared, plants, groundOk });
      const ring = [];
      for (let i = -2; i <= 2; i++) { ring.push([cx + i, cz - 2]); }
      for (let i = -1; i <= 2; i++) { ring.push([cx + 2, cz + i]); }
      for (let i = 1; i >= -2; i--) { ring.push([cx + i, cz + 2]); }
      for (let i = 1; i >= -1; i--) { ring.push([cx - 2, cz + i]); }
      const door = [cx, cz + 2];
      const windows = new Set([`${cx},${cz - 2}`, `${cx + 2},${cz}`, `${cx - 2},${cz}`]);
      const isDoor = (c) => c[0] === door[0] && c[1] === door[1];
      let ok = 0, total = 0, notAimed = 0;
      const fails = [];
      const place = async (c, n, item) => {
        const r = await tapPlace(c, n, item);
        total++; if (r.ok) ok++; else fails.push({ c, item, got: r.got, target: r.target, diag: r.diag });
        if (!r.aimed) notAimed++;
      };
      // layer 1 (standing): click the ground's top face
      await api('selectSlot', 1); // oak_planks
      for (const [x, z] of ring) if (!isDoor([x, z])) await place([x, base, z], [x, base - 1, z], 'oak_planks');
      await shot('house-layer1');
      // layer 2 (standing): planks, glass windows
      for (const [x, z] of ring) {
        if (isDoor([x, z])) continue;
        const glass = windows.has(`${x},${z}`);
        await api('selectSlot', glass ? 3 : 1);
        await place([x, base + 1, z], [x, base, z], glass ? 'glass' : 'oak_planks');
      }
      // layer 3 (hovering a bit higher so the top faces of layer 2 are visible)
      await api('selectSlot', 1);
      await api('setFlying', true);
      await api('teleport', cx + 0.5, base + 1.1, cz + 0.5);
      await waitTicks(3);
      for (let i = 0; i < ring.length; i++) {
        const [x, z] = ring[i];
        // above the door gap there is nothing below: attach the lintel to the wall block placed just before it
        const n = isDoor([x, z]) ? [ring[i - 1][0], base + 2, ring[i - 1][1]] : [x, base + 1, z];
        await place([x, base + 2, z], n, 'oak_planks');
      }
      // roof edge (hover higher)
      await api('teleport', cx + 0.5, base + 1.9, cz + 0.5);
      await waitTicks(3);
      for (const [x, z] of ring) await place([x, base + 3, z], [x, base + 2, z], 'oak_planks');
      // inner roof from below: click the inward side faces of the roof edge, then the centre
      await api('setFlying', false);
      await api('teleport', cx + 0.5, base, cz + 0.5);
      await page.waitForFunction(() => window.__game.pos().onGround, null, { timeout: 5000 }).catch(() => {});
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const c = [cx + dx, base + 3, cz + dz];
        const n = Math.abs(dx) === 1 && dz !== 0 ? [cx + dx * 2, base + 3, cz + dz] : (dx !== 0 ? [cx + dx * 2, base + 3, cz] : [cx, base + 3, cz + dz * 2]);
        await place(c, n, 'oak_planks');
      }
      await place([cx, base + 3, cz], [cx + 1, base + 3, cz], 'oak_planks');
      // door in the gap (oak_door, slot 7), from inside
      await api('selectSlot', 6);
      await place([door[0], base, door[1]], [door[0], base - 1, door[1]], 'oak_door');
      const upper = await api('getBlock', door[0], base + 1, door[1]);
      // the second (upper) door half is placed by the MECH lane's door placer hook (SPEC 8.6)
      if (report.stubs.includes('mechanics')) report.pending = [...(report.pending || []), `door upper half: MECH placer is a stub (upper cell = ${upper})`];
      else check(upper === 'oak_door', 'door fills the 2-high door space', upper);
      // a torch inside
      await api('selectSlot', 5);
      await place([cx - 1, base, cz - 1], [cx - 1, base - 1, cz - 1], 'torch');
      report.house = { ...house, placed: ok, total, notAimed, fails: fails.slice(0, 10) };
      check(ok === total, 'every house block placed by a kid tap', { ok, total, notAimed });
      // inside view
      await api('lookAt', cx - 2, base + 1.5, cz - 2);
      await waitFrames(5);
      await shot('house-inside');
      // outside views
      await api('setFlying', true);
      await api('teleport', cx + 0.5 + 4, base + 2, cz + 0.5 + 8);
      await waitTicks(3);
      await api('lookAt', cx + 0.5, base + 1.5, cz + 0.5);
      await hideCursor();
      await waitFrames(10);
      await shot('house-outside');
      await api('teleport', cx + 0.5 - 7, base + 6, cz + 0.5 - 6);
      await waitTicks(3);
      await api('lookAt', cx + 0.5, base + 1.5, cz + 0.5);
      await waitFrames(10);
      await shot('house-outside-2');
    });

    await step('day-night', async () => {
      if (!house) return;
      const { cx, cz, base } = house;
      await api('teleport', cx + 0.5 + 4, base + 2, cz + 0.5 + 8);
      await waitTicks(2);
      await api('lookAt', cx + 0.5, base + 1.5, cz + 0.5);
      await hideCursor();
      const remesh0 = await ev(() => window.__game.game.world.stats().urgentMeshes + window.__game.game.world.stats().syncMeshes);
      const lum = {};
      for (const [name, t] of [['sunset', 12500], ['night', 18000], ['sunrise', 23300], ['day', 6000]]) {
        await api('setTime', t);
        await waitFrames(6);
        lum[name] = (await api('pixelStats')).meanLuma;
        await shot(`house-${name}`);
      }
      const remesh1 = await ev(() => window.__game.game.world.stats().urgentMeshes + window.__game.game.world.stats().syncMeshes);
      check(lum.night < lum.day * 0.5, 'night is much darker than day', lum);
      check(remesh1 === remesh0, 'changing the time never remeshes', { remesh0, remesh1 });
      // daylight cycle rule: time advances
      await api('setRule', 'daylightCycle', true);
      const t0 = await api('getTime');
      await waitTicks(40);
      const t1 = await api('getTime');
      check(t1 !== t0, 'daylight cycle advances time when enabled', { t0, t1 });
      await api('setRule', 'daylightCycle', false);
      await api('setTime', 3000);
    });

    await step('border-light', async () => {
      // render check (blocks set through the test API): a closed room in the air centred on a column corner with
      // one torch next to the corner, so its light crosses into all four columns. The light must be symmetric
      // and the screenshot must show no seam or step where the columns meet.
      const room = await ev(() => {
        const api = window.__game, g = api.game, w = g.world, ID = api.blockId, p = g.player;
        const X = Math.round(p.x / 16) * 16, Z = Math.round(p.z / 16) * 16, Y = 96;
        const list = [];
        for (let x = X - 6; x <= X + 6; x++) for (let z = Z - 6; z <= Z + 6; z++) for (let y = Y - 1; y <= Y + 4; y++) {
          const shell = x === X - 6 || x === X + 6 || z === Z - 6 || z === Z + 6 || y === Y - 1 || y === Y + 4;
          list.push([x, y, z, shell ? (y === Y - 1 ? ID('stone') : ID('cobblestone')) : 0]);
        }
        list.push([X, Y, Z, ID('torch')]);
        w.setBlocks(list, { cause: 'test' });
        const prof = [];
        for (let d = -5; d <= 5; d++) prof.push(w.getBlockLight(X + d, Y, Z));
        const profZ = [];
        for (let d = -5; d <= 5; d++) profZ.push(w.getBlockLight(X, Y, Z + d));
        const diag = [];
        for (let d = 1; d <= 4; d++) diag.push([w.getBlockLight(X + d, Y, Z + d), w.getBlockLight(X - d, Y, Z - d), w.getBlockLight(X + d, Y, Z - d), w.getBlockLight(X - d, Y, Z + d)]);
        return { X, Y, Z, prof, profZ, diag };
      });
      const sym = (a) => a.every((v, i) => v === a[a.length - 1 - i]);
      check(sym(room.prof) && sym(room.profZ) && room.diag.every((q) => q.every((v) => v === q[0])) && room.prof[5] === 14, 'torch light is symmetric across the column borders', room);
      await api('setTime', 18000);
      await api('setFlying', true);
      await api('teleport', room.X - 4.5, room.Y, room.Z - 4.5);
      await waitTicks(3);
      await api('lookAt', room.X + 2, room.Y, room.Z + 2);
      await hideCursor();
      await waitFrames(8);
      await shot('border-light-room', `column corner at x ${room.X}, z ${room.Z}`);
      await api('teleport', room.X + 4.5, room.Y + 1.2, room.Z + 4.5);
      await waitTicks(3);
      await api('lookAt', room.X - 3, room.Y - 1, room.Z - 3);
      await waitFrames(8);
      await shot('border-light-room-2');
      await api('setTime', 3000);
    });

    await step('swim', async () => {
      const water = await ev(() => {
        const g = window.__game.game, w = g.world, pl = g.player, WATER = window.__game.blockId('water');
        const px = Math.floor(pl.x), pz = Math.floor(pl.z);
        for (let r = 0; r <= 90; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = px + dx, z = pz + dz;
          if (!w.isColumnLoaded(x >> 4, z >> 4)) continue;
          if (w.getBlock(x, 47, z) === WATER && w.getBlock(x, 46, z) === WATER) return { x, z, y: w.getBlock(x, 45, z) === WATER ? (w.getBlock(x, 44, z) === WATER ? 44 : 45) : 46 };
        }
        return null;
      });
      if (!water) { log('no deep water near: swim step skipped'); return; }
      await api('setFlying', false);
      await api('teleport', water.x + 0.5, water.y, water.z + 0.5);
      await api('setLook', 0, 10);
      await waitTicks(5);
      let p = await api('pos');
      check(p.inWater && p.eyeInWater, 'underwater', { inWater: p.inWater, eye: p.eyeInWater });
      await waitFrames(5);
      await shot('underwater');
      await holdKeys(['Space'], 2500);
      p = await api('pos');
      check(p.y > water.y + 0.8 || !p.eyeInWater, 'space swims up', p.y);
      await api('setLook', 0, -25);
      await waitFrames(5);
      await shot('swim-surface');
    });

    await step('classic-scheme', async () => {
      await api('setSetting', 'controls', 'classic');
      await key('KeyH');
      await waitTicks(5);
      await api('setFlying', false);
      await api('setLook', 0, -40);
      await waitFrames(3);
      await page.mouse.click(W / 2, H / 2);
      const locked = await page.waitForFunction(() => document.pointerLockElement != null, null, { timeout: 3000 }).then(() => true, () => false);
      check(locked, 'classic: a click locks the pointer', locked);
      await sleep(400); // the input lane drops motion for 150 ms after a lock change
      const a = await api('pos');
      for (let i = 1; i <= 10; i++) { await page.mouse.move(W / 2 + i * 20, H / 2); await sleep(16); }
      await waitFrames(4);
      const b = await api('pos');
      const lockEv = await ev(() => window.__game.events('input:pointerLock', 6).map((e) => `${e.payload.locked}@${e.tick}`));
      check(Math.abs(b.yaw - a.yaw) > 5, 'classic: mouse motion turns the view', { dyaw: +(b.yaw - a.yaw).toFixed(1), lockEvents: lockEv, locked: await ev(() => window.__game.game.input.pointerLocked) });
      await api('setLook', 0, -40);
      await waitFrames(3);
      const tg = await api('target');
      const br0 = await api('eventCount', 'block:broken');
      await page.mouse.down({ button: 'left' }); await sleep(120); await page.mouse.up({ button: 'left' });
      await waitTicks(3);
      const br1 = await api('eventCount', 'block:broken');
      check(br1 > br0, 'classic: left click breaks (creative)', { before: tg && tg.name, broken: br1 - br0 });
      await api('selectSlot', 2); // cobblestone
      const pl0 = await api('eventCount', 'block:placed');
      await page.mouse.down({ button: 'right' }); await sleep(80); await page.mouse.up({ button: 'right' });
      await waitTicks(3);
      const pl1 = await api('eventCount', 'block:placed');
      check(pl1 > pl0, 'classic: right click places', pl1 - pl0);
      await holdKeys(['KeyW'], 800);
      await waitFrames(3);
      await shot('classic');
      await key('Escape');
      await waitFrames(5);
      check(await ev(() => document.pointerLockElement == null), 'classic: Esc releases the pointer');
      const paused = await api('uiOpen');
      check(paused === 'pause', 'classic: Esc shows the pause screen', paused);
      await shot('pause');
      if (paused) {
        const box = await (await page.$('[data-action="resume"]')).boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await waitFrames(3);
        check(await api('uiOpen') === null && await api('state') === 'playing', 'resume button returns to the game');
      }
      await api('setSetting', 'controls', 'kid');
    });

    await step('wander', async () => {
      // the remaining time is free walking with auto-jump and some looking around
      await key('KeyH');
      await waitTicks(3);
      await api('setLook', 135, -5);
      for (let i = 0; i < 4; i++) {
        await holdKeys(['ArrowUp'], 2500);
        await holdKeys(['ArrowLeft'], 500);
      }
      await waitFrames(5);
      await shot('wander');
    });

    // perf summary
    const pt = await ev(() => {
      const d = window.__game.game.__pt.dts.slice(60).sort((a, b) => a - b);
      const q = (f) => d.length ? +d[Math.min(d.length - 1, Math.floor(d.length * f))].toFixed(2) : 0;
      return { frames: d.length, median: q(0.5), p90: q(0.9), p99: q(0.99), max: d.length ? +d[d.length - 1].toFixed(1) : 0, fpsMedian: d.length ? +(1000 / q(0.5)).toFixed(1) : 0, slowOver33: d.filter((x) => x > 33.4).length };
    });
    report.perf.frames = pt;
    const s = await api('stats');
    report.perf.final = s;
    report.perf.drawCallsMax = Math.max(...report.screenshots.map((x) => x.drawCalls || 0));
    report.perf.world = await ev(() => { const w = window.__game.game.world.stats(); return { workers: w.workers, genAvgMs: +w.genAvgMs.toFixed(2), lightAvgMs: +w.lightAvgMs.toFixed(2), meshAvgMs: +w.meshAvgMs.toFixed(2), streamMs: +w.streamMs.toFixed(2), urgentMeshes: w.urgentMeshes, droppedResults: w.droppedResults }; });
    const minFps = args.swiftshader ? 10 : 60;
    check(pt.fpsMedian >= minFps, `median frame rate >= ${minFps} fps`, pt);
    const ge = await gameErrors();
    for (const e of ge) report.errors.push(`game: ${e}`);
  } catch (err) {
    report.errors.push(`harness: ${err && err.stack ? err.stack : err}`);
  } finally {
    await browser.close().catch(() => {});
  }
  check(report.errors.length === 0, 'no page, console, network or game errors', report.errors.slice(0, 10));
  const failed = report.checks.filter((c) => !c.ok);
  report.summary = { checks: report.checks.length, failed: failed.length, seconds: report.steps.reduce((a, s) => a + s.ms, 0) / 1000 };
  writeFileSync(join(TMP, `${args.tag}-report.json`), JSON.stringify(report, null, 2));
  log(`summary ${JSON.stringify(report.summary)} perf ${JSON.stringify({ boot: report.perf.bootMs, ready: report.perf.playToReadyMs, spawnArea: report.perf.spawnAreaCompleteMs, frames: report.perf.frames, drawCallsMax: report.perf.drawCallsMax })}`);
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => { console.error('[playtest] harness error:', err); process.exit(1); });
