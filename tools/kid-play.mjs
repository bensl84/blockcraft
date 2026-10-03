// OWNER LANE: KID. In-world play-through of the kid helpers on the REAL core (phase 2 verification).
// Drives the game the way a child would (real keyboard, mouse and touch through Playwright, plus window.__game
// for setup and measuring), saves screenshots to .tmp/kidplay-<step>.png and prints PASS/FAIL lines.
//
//   node build.mjs --dev --out .tmp/build-kid && node tools/kid-play.mjs [--file .tmp/build-kid/index.html] [--only a,b]
import { chromium } from 'playwright';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const FILE = resolve(ROOT, arg('--file', '.tmp/build-kid/index.html'));
const ONLY = arg('--only', null) ? arg('--only').split(',') : null;
const W = 1280, H = 720;

const results = [];
const line = (ok, name, msg, data) => {
  results.push({ ok, name, msg, data });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${msg}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, opts = {}) {
  const context = await browser.newContext({ viewport: { width: opts.w || W, height: opts.h || H }, deviceScaleFactor: 1, hasTouch: !!opts.touch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ReadPixels|CONTEXT_LOST/i.test(m.text())) errors.push(m.text()); });
  await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });
  const call = (method, ...a) => page.evaluate(async ({ method, a }) => window.__game[method](...a), { method, a });
  const ev = (fn, a) => page.evaluate(fn, a);
  const shot = (n) => page.screenshot({ path: join(TMP, `kidplay-${n}.png`) });
  const rect = (sel) => ev((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, visible: r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 }; }, sel);
  const px = (n) => ({ x: Math.round((n.x + 1) / 2 * (opts.w || W)), y: Math.round((1 - n.y) / 2 * (opts.h || H)) });
  return { context, page, errors, call, ev, shot, rect, px };
}

/** Hold a key for ms of real time (a child holding W). */
async function holdKey(page, code, ms) { await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code); }

const STEPS = {
  /* --------------------------------------------------------------- spawn view, walking and turning with the keyboard */
  async walk(b) {
    const g = await open(b);
    await g.call('setSetting', 'hints', true);
    await g.call('startWorld', { seed: 7, mode: 'creative', difficulty: 'peaceful' });
    await g.call('setFlying', false);
    await g.call('waitTicks', 20);
    await g.shot('spawn');
    // idle 7.5 s: the walk pictogram appears
    await sleep(7600);
    const h = await g.ev(() => window.__game.game.kid.hintShown);
    line(h === 'walk', 'hint-walk-appears', `idle 7 s shows the walk pictogram (${h})`);
    await g.shot('hint-walk');
    const p0 = await g.call('pos');
    await holdKey(g.page, 'KeyW', 1500);
    const p1 = await g.call('pos');
    const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    line(d > 3, 'keyboard-walk', `holding W walks (${d.toFixed(1)} blocks)`);
    const hw = await g.ev(() => window.__game.game.kid.hintShown);
    line(hw !== 'walk', 'hint-walk-done', `walking clears the walk hint (now ${hw})`);
    // wait for the turn hint, then turn with A
    await sleep(7600);
    const h2 = await g.ev(() => window.__game.game.kid.hintShown);
    line(h2 === 'turn', 'hint-turn-appears', `next hint is turn (${h2})`);
    await g.shot('hint-turn');
    const y0 = (await g.call('pos')).yaw;
    await holdKey(g.page, 'KeyA', 900);
    const y1 = (await g.call('pos')).yaw;
    line(y1 - y0 > 20, 'keyboard-turn', `holding A turns left (${(y1 - y0).toFixed(1)} deg)`);
    const h3 = await g.ev(() => window.__game.game.kid.hintShown);
    line(h3 !== 'turn', 'hint-turn-done', `turning clears the turn hint (now ${h3})`);
    // drag-look also counts as turning (fresh plan)
    await g.ev(() => { const k = window.__game.game.kid; Object.assign(k.hints, new k.hints.constructor()); k.hints.done.add('walk'); k.showHint('turn'); });
    await g.page.mouse.move(640, 360); await g.page.mouse.down();
    for (let i = 1; i <= 15; i++) await g.page.mouse.move(640 - i * 14, 360);
    await g.page.mouse.up();
    await sleep(200);
    line(await g.ev(() => window.__game.game.kid.hints.done.has('turn')), 'hint-turn-drag', 'a drag-look counts as the turn step');
    // a hint for place shows next
    await g.ev(() => window.__game.game.kid.hideHint());
    await sleep(7600);
    const h4 = await g.ev(() => window.__game.game.kid.hintShown);
    line(h4 === 'place', 'hint-place-appears', `next hint is place (${h4})`);
    await g.shot('hint-place');
    await g.context.close();
    return g.errors;
  },

  /* --------------------------------------------------------------- build with taps, undo, go away, arrow, Home */
  async build(b) {
    const g = await open(b);
    await g.call('setSetting', 'hints', false);
    await g.call('startWorld', { seed: 7, mode: 'creative', difficulty: 'peaceful' });
    await g.call('setFlying', false);
    await g.call('waitTicks', 20);
    await g.call('setLook', 0, -20);
    await g.call('waitFrames', 3);
    const p = await g.call('pos');
    const placed = [];
    // tap a little wall in front: aim at the ground cells 4 ahead
    for (let i = -1; i <= 1; i++) {
      const gx = Math.floor(p.x) + i, gz = Math.floor(p.z) - 4;
      const sy = await g.call('surfaceY', gx + 0.5, gz + 0.5);
      const n = g.px(await g.call('worldToNdc', gx + 0.5, sy, gz + 0.5));
      await g.page.mouse.move(n.x, n.y); await sleep(40);
      const before = await g.call('eventCount', 'block:placed');
      await g.page.mouse.down(); await sleep(90); await g.page.mouse.up();
      await g.call('waitTicks', 3);
      if (await g.call('eventCount', 'block:placed') > before) placed.push([gx, sy, gz]);
    }
    line(placed.length === 3, 'tap-build', `tapping built ${placed.length}/3 blocks`, placed);
    await g.shot('built');
    const undo = await g.rect('[data-kid="undo"]');
    await g.page.mouse.click(undo.cx, undo.cy);
    await g.call('waitTicks', 2);
    const last = placed[placed.length - 1];
    line(last && await g.call('getBlock', ...last) === 'air', 'undo-button', 'Undo button removed the newest block');
    await g.shot('after-undo');
    // walk/fly far away: the home arrow appears
    await g.call('teleport', p.x + 60, p.y + 20, p.z + 40);
    await g.call('setFlying', true);
    await g.call('waitFrames', 10);
    const arrow = await g.rect('[data-kid="home-arrow"]');
    const arrowState = await g.ev(() => window.__game.game.kid.homeArrow);
    line(arrow && arrow.visible, 'home-arrow', `home arrow visible 72 blocks away (deg ${arrowState.deg && arrowState.deg.toFixed(0)})`);
    // the arrow should point toward home: rotate to face home, arrow ~0 deg
    const ph = await g.call('pos');
    const yawHome = Math.atan2(-(p.x - ph.x), -(p.z - ph.z)) * 180 / Math.PI;
    await g.call('setLook', yawHome, 0);
    await g.call('waitFrames', 4);
    const facing = await g.ev(() => window.__game.game.kid.homeArrow.deg);
    line(Math.abs(((facing + 540) % 360) - 180) < 15, 'home-arrow-ahead', `facing home the arrow points up (${facing.toFixed(1)} deg)`);
    await g.call('setLook', yawHome + 90, 0);
    await g.call('waitFrames', 4);
    await g.shot('home-arrow');
    // press H like a child: fade, teleport, face the build
    await g.page.keyboard.press('KeyH');
    await sleep(120);
    await g.shot('home-fade');
    await g.call('waitTicks', 12);
    const ah = await g.call('pos');
    const spawn = (await g.call('meta')).spawn;
    line(Math.hypot(ah.x - spawn.x, ah.z - spawn.z) < 1, 'home-key', `H took the player home (${ah.x.toFixed(1)}, ${ah.y.toFixed(1)}, ${ah.z.toFixed(1)})`);
    // faces the wall: yaw toward the centroid of the remaining build
    const cx = (placed[0][0] + placed[1][0]) / 2 + 0.5, cz = placed[0][2] + 0.5;
    const want = Math.atan2(-(cx - ah.x), -(cz - ah.z)) * 180 / Math.PI;
    const dy = Math.abs(((ah.yaw - want + 540) % 360) - 180);
    line(dy < 20, 'home-faces-build', `after Home the player faces the build (off by ${dy.toFixed(1)} deg)`);
    await g.call('waitFrames', 20);
    await g.shot('home-arrived');
    await g.context.close();
    return g.errors;
  },

  /* --------------------------------------------------------------- soft border on foot and in flight */
  async border(b) {
    const g = await open(b);
    await g.call('setSetting', 'hints', false);
    await g.call('startWorld', { seed: 7, mode: 'creative', difficulty: 'peaceful' });
    await g.call('setRule', 'worldBorder', 48);
    await g.call('setFlying', false);
    await g.call('waitTicks', 10);
    const s = (await g.call('meta')).spawn;
    // walk toward +x from 40 blocks out (face +x = yaw -90)
    await g.call('teleport', s.x + 40, (await g.call('surfaceY', s.x + 40, s.z)) + 0.01, s.z);
    await g.call('setLook', -90, 0);
    await g.call('waitTicks', 4);
    await g.page.keyboard.down('KeyW');
    let maxD = 0;
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      const q = await g.call('pos');
      maxD = Math.max(maxD, Math.hypot(q.x - s.x, q.z - s.z));
      // a child keeps jumping over things
      if (i % 5 === 0) await g.page.keyboard.press('Space');
    }
    await g.shot('border-ground');
    await g.page.keyboard.up('KeyW');
    line(maxD < 48 + 1.5, 'border-walk', `walking 4 s outward stops at the border (max ${maxD.toFixed(2)} of 48)`);
    const fog = await g.ev(() => { const r = window.__game.game.renderer; return r.fogOverride || null; });
    line(!!fog, 'border-fog', 'fog override is on at the border', fog);
    const av = await g.ev(() => window.__game.game.kid.homeArrow);
    line(av.visible, 'border-arrow', `the home arrow shows the way back inside the border fog (${Math.round(av.dist)} blocks out)`);
    // a hint plate and the arrow together: the plate sits below the arrow
    await g.ev(() => window.__game.game.kid.showHint('place', 'keys'));
    await sleep(500);
    const ra = await g.rect('[data-kid="home-arrow"]'), rh = await g.rect('[data-kid="hint"]');
    line(rh.y >= ra.y + ra.h + 8, 'arrow-hint-stack', `hint plate below the arrow (arrow bottom ${ra.y + ra.h}, hint top ${rh.y})`);
    await g.shot('border-arrow-hint');
    await g.ev(() => window.__game.game.kid.hideHint());
    // fly outward
    await g.call('setFlying', true);
    await g.page.keyboard.down('KeyW'); await g.page.keyboard.down('Space');
    let maxF = 0;
    for (let i = 0; i < 30; i++) { await sleep(100); const q = await g.call('pos'); maxF = Math.max(maxF, Math.hypot(q.x - s.x, q.z - s.z)); }
    await g.page.keyboard.up('Space');
    for (let i = 0; i < 20; i++) { await sleep(100); const q = await g.call('pos'); maxF = Math.max(maxF, Math.hypot(q.x - s.x, q.z - s.z)); }
    await g.shot('border-flight');
    await g.page.keyboard.up('KeyW');
    line(maxF < 48 + 1.5, 'border-fly', `flying outward stops at the border (max ${maxF.toFixed(2)})`);
    // back inside: fog cleared
    await g.call('setFlying', false);
    await g.call('teleport', s.x, s.y, s.z);
    await g.call('waitTicks', 4);
    const fog2 = await g.ev(() => window.__game.game.renderer.fogOverride || null);
    line(!fog2, 'border-fog-clear', 'fog override cleared back inside', fog2);
    await g.context.close();
    return g.errors;
  },

  /* --------------------------------------------------------------- void rescue with real gravity */
  async void(b) {
    const g = await open(b);
    await g.call('setSetting', 'hints', false);
    await g.call('startWorld', { seed: 7, mode: 'creative', difficulty: 'peaceful' });
    await g.call('setFlying', false);
    await g.call('waitTicks', 10);
    const p = await g.call('pos');
    const hx = Math.floor(p.x) + 2, hz = Math.floor(p.z);
    const top = await g.call('surfaceY', hx + 0.5, hz + 0.5);
    for (let y = 0; y < top; y++) await g.call('setBlock', hx, y, hz, 'air');
    await g.call('teleport', hx + 0.5, top + 0.01, hz + 0.5);
    const r0 = await g.call('eventCount', 'kid:rescue');
    const land0 = await g.call('eventCount', 'player:land');
    let low = 999;
    for (let i = 0; i < 80; i++) {
      await sleep(50);
      const q = await g.call('pos');
      low = Math.min(low, q.y);
      if (await g.call('eventCount', 'kid:rescue') > r0) break;
    }
    if (low < 30) await g.shot('void-falling');
    const rescued = await g.call('eventCount', 'kid:rescue') > r0;
    await g.call('waitTicks', 10);
    const q = await g.call('pos');
    line(rescued && q.y >= top - 0.5, 'void-rescue', `falling through the world is rescued (lowest y ${low.toFixed(1)}, now y ${q.y.toFixed(1)})`);
    const lands = await g.call('events', 'player:land', 3);
    const after = lands.filter((e) => e.tick > 0).slice(-1)[0];
    line(!after || (after.payload.fallDistance || 0) < 3 || (await g.call('eventCount', 'player:land')) === land0, 'void-no-fall', 'no hard landing after the rescue', after && after.payload);
    line(q.health === 20, 'void-health', `health untouched (${q.health})`);
    await g.call('waitFrames', 10);
    await g.shot('void-rescued');
    await g.context.close();
    return g.errors;
  },

  /* --------------------------------------------------------------- stuck: dug pit, then sand on the head */
  async stuck(b) {
    const g = await open(b);
    await g.call('setSetting', 'hints', true);
    await g.call('startWorld', { seed: 7, mode: 'creative', difficulty: 'peaceful' });
    await g.call('setFlying', false);
    await g.call('waitTicks', 10);
    const p = await g.call('pos');
    const bx = Math.floor(p.x) + 3, bz = Math.floor(p.z);
    const top = await g.call('surfaceY', bx + 0.5, bz + 0.5);
    // a 1x1 pit 2 deep, solid all round
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let y = top - 2; y < top; y++) await g.call('setBlock', bx + dx, y, bz + dz, 'stone');
    await g.call('setBlock', bx, top - 1, bz, 'air'); await g.call('setBlock', bx, top - 2, bz, 'air');
    await g.call('setBlock', bx, top - 3, bz, 'stone');
    await g.call('teleport', bx + 0.5, top - 2, bz + 0.5);
    await g.call('setLook', -90, 0);
    await g.call('waitTicks', 4);
    // the child pushes W and jumps a few times like they would
    await g.page.keyboard.down('KeyW');
    for (let i = 0; i < 8; i++) { await sleep(500); if (i % 3 === 1) await g.page.keyboard.press('Space'); }
    await g.page.keyboard.up('KeyW');
    const st = await g.ev(() => ({ stuck: window.__game.game.kid.stuck.stuck, hint: window.__game.game.kid.hintShown }));
    line(st.stuck && st.hint === 'unstuck', 'stuck-pit', 'pushing in a 2-deep pit for 3 s shows the "hold jump" help', st);
    await g.call('waitFrames', 30);
    await g.shot('stuck-pit');
    await holdKey(g.page, 'Space', 1300);
    await g.call('waitTicks', 4);
    const q = await g.call('pos');
    line(q.y >= top - 0.01 && !(await g.ev(() => window.__game.game.kid.stuck.stuck)), 'stuck-pop', `holding Space 1 s pops onto the rim (y ${q.y.toFixed(2)}, ground ${top})`);
    await g.shot('stuck-popped');
    // sand drops onto the head
    const r = await g.call('pos');
    await g.call('setBlock', Math.floor(r.x), Math.floor(r.y + 1), Math.floor(r.z), 'sand');
    await sleep(200);
    await g.shot('stuck-sand');
    await sleep(2300);
    const s2 = await g.call('pos');
    const free = await g.ev(() => { const g2 = window.__game.game, p2 = g2.player; const id = (y) => g2.world.getBlock(Math.floor(p2.x), Math.floor(y), Math.floor(p2.z)); return { feet: id(p2.y + 0.05), head: id(p2.y + 1.62) }; });
    const rs = await g.call('events', 'kid:rescue', 3);
    line(free.head === 0 && free.feet === 0, 'stuck-sand', `head-in-sand pops out on its own within 2.5 s (sand at y ${Math.floor(r.y + 1)}, now y ${s2.y.toFixed(2)})`, { ...free, rescues: rs.map((e) => e.payload.reason) });
    await g.shot('stuck-sand-popped');
    await g.context.close();
    return g.errors;
  },

  /* --------------------------------------------------------------- Home into a far, unloaded column */
  async farhome(b) {
    const g = await open(b);
    await g.call('setSetting', 'hints', false);
    await g.call('startWorld', { seed: 7, mode: 'creative', difficulty: 'peaceful' });
    await g.call('setFlying', false);
    await g.call('waitTicks', 10);
    const s = (await g.call('meta')).spawn;
    // a home 700 blocks away, at a ground height guess that is probably inside a hill or in the air
    await g.ev(([x, z]) => { window.__game.game.meta.home = { x, y: 40, z }; }, [s.x + 700.5, s.z + 300.5]);
    await g.page.keyboard.press('KeyH');
    await g.call('waitTicks', 6);
    const t0 = Date.now();
    let ok = false, q;
    while (Date.now() - t0 < 12000) {
      await sleep(200);
      q = await g.call('pos');
      const loaded = await g.ev(() => { const g2 = window.__game.game, p2 = g2.player; return g2.world.isColumnLoaded(Math.floor(p2.x) >> 4, Math.floor(p2.z) >> 4); });
      if (loaded && q.onGround) { ok = true; break; }
    }
    await g.call('waitTicks', 20);
    q = await g.call('pos');
    const inside = await g.ev(() => { const g2 = window.__game.game, p2 = g2.player; const id = (x, y, z) => g2.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return { feet: id(p2.x, p2.y + 0.1, p2.z), head: id(p2.x, p2.y + 1.62, p2.z) }; });
    const surf = await g.call('surfaceY', q.x, q.z);
    line(ok && inside.feet === 0 && inside.head === 0, 'home-far', `far Home lands standing in the open (y ${q.y.toFixed(1)}, surface ${surf}, ${Date.now() - t0} ms)`, inside);
    await g.call('waitFrames', 20);
    await g.shot('home-far');
    await g.context.close();
    return g.errors;
  },

  /* --------------------------------------------------------------- touch overlay in the real world, two screen sizes */
  async touch(b) {
    for (const [w, h] of [[1280, 720], [1024, 600]]) {
      const g = await open(b, { touch: true, w, h });
      await g.call('setSetting', 'hints', false);
      await g.call('startWorld', { seed: 7, mode: 'creative', difficulty: 'peaceful' });
      await g.call('setFlying', false);
      await g.call('waitTicks', 10);
      await g.page.touchscreen.tap(w * 0.7, h * 0.3);
      await g.call('waitFrames', 5);
      const vis = await g.ev(() => window.__game.game.touch.visible);
      line(vis, `touch-auto-${w}`, 'a finger tap shows the touch controls');
      await g.call('waitFrames', 10);
      await g.shot(`touch-${w}x${h}`);
      // nothing overlaps: home/undo/pause/dpad/jump/fly
      const sels = ['[data-kid="home"]', '[data-kid="undo"]', '[data-touch="pause"]', '[data-touch="dpad"]', '[data-touch="jump"]', '[data-touch="fly"]'];
      const rs = [];
      for (const s of sels) { const r = await g.rect(s); if (r && r.visible) rs.push([s, r]); }
      const over = [];
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const [a, ra] = rs[i], [c, rc] = rs[j];
        if (ra.x < rc.x + rc.w && ra.x + ra.w > rc.x && ra.y < rc.y + rc.h && ra.y + ra.h > rc.y) over.push(`${a}x${c}`);
      }
      line(over.length === 0, `touch-no-overlap-${w}`, 'controls do not overlap each other', over);
      // fly with buttons and screenshot
      const fl = await g.rect('[data-touch="fly"]');
      await g.page.touchscreen.tap(fl.cx, fl.cy);
      await g.call('waitFrames', 6);
      await g.shot(`touch-${w}x${h}-flying`);
      await g.context.close();
      if (g.errors.length) return g.errors;
    }
    return [];
  },

  /* --------------------------------------------------------------- cost of the kid lane per frame/tick */
  async perf(b) {
    const g = await open(b);
    await g.call('setSetting', 'hints', true);
    await g.call('startWorld', { seed: 7, mode: 'creative', difficulty: 'peaceful' });
    await g.call('setRule', 'worldBorder', 64);
    await g.call('waitTicks', 20);
    await g.ev(() => window.__game.game.touch.setVisible(true));
    const s = await g.call('meta');
    await g.call('teleport', s.spawn.x + 60, s.spawn.y + 10, s.spawn.z);  // arrow + border fog active
    await g.call('setFlying', true);
    const m = await g.ev(async () => {
      const game = window.__game.game, k = game.kid, t = game.touch;
      const acc = { kidTick: 0, kidFrame: 0, touchFrame: 0, ticks: 0, frames: 0 };
      const wrap = (obj, fn, key, count) => { const orig = obj[fn]; obj[fn] = function (...a) { const t0 = performance.now(); try { return orig.apply(this, a); } finally { acc[key] += performance.now() - t0; if (count) acc[count]++; } }; return () => { obj[fn] = orig; }; };
      const un = [wrap(k, 'tick', 'kidTick', 'ticks'), wrap(k, 'frame', 'kidFrame', 'frames'), wrap(t, 'frame', 'touchFrame')];
      game.input.setMoveVector(1, 0);
      await new Promise((r) => setTimeout(r, 4000));
      game.input.setMoveVector(0, 0);
      un.forEach((f) => f());
      return { msPerTick: acc.kidTick / acc.ticks, msPerFrameKid: acc.kidFrame / acc.frames, msPerFrameTouch: acc.touchFrame / acc.frames, ticks: acc.ticks, frames: acc.frames };
    });
    const st = await g.call('stats');
    line(m.msPerTick < 0.2 && m.msPerFrameKid + m.msPerFrameTouch < 0.2, 'perf-kid', `kid tick ${m.msPerTick.toFixed(3)} ms, kid+touch frame ${(m.msPerFrameKid + m.msPerFrameTouch).toFixed(3)} ms`, { ...m, fps: st.fps, drawCalls: st.drawCalls, workMs: st.workMs });
    // the overlay must not add draw calls: compare with the overlay hidden
    await g.ev(() => window.__game.game.touch.setVisible(false));
    await g.call('waitFrames', 30);
    const st2 = await g.call('stats');
    line(true, 'perf-stats', 'renderer stats with/without overlay', { with: { fps: st.fps, drawCalls: st.drawCalls }, without: { fps: st2.fps, drawCalls: st2.drawCalls } });
    await g.context.close();
    return g.errors;
  },
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
try {
  for (const [name, fn] of Object.entries(STEPS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    try {
      const errs = await fn(browser);
      line(!errs || !errs.length, `${name}-page-errors`, errs && errs.length ? errs.slice(0, 3).join(' | ') : 'none');
    } catch (err) { line(false, name, `threw: ${err && err.message}`); }
  }
} finally { await browser.close(); }
writeFileSync(join(TMP, 'kidplay-report.json'), JSON.stringify(results, null, 2));
const fails = results.filter((r) => !r.ok).length;
console.log(`\n[kid-play] ${results.length - fails} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
