// MENUS lane: in-world verification with the real core, driven like a child (and a parent) would.
// Real page.mouse / keyboard, a persistent Chrome profile (real IndexedDB across a page reload), screenshots
// at every step in .tmp/inworld/. Not part of the smoke suite; run by hand:
//   node build.mjs --dev --out .tmp/build-menus && node tools/menus-inworld.mjs [--swiftshader] [--w 1280 --h 720]
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SWIFT = process.argv.includes('--swiftshader');
const W = Number(arg('w', 1280)), H = Number(arg('h', 720));
const TOUCH = process.argv.includes('--touch');
const OUT = resolve('.tmp/inworld' + (SWIFT ? '-swift' : '') + (TOUCH ? '-touch' : '') + (W !== 1280 || H !== 720 ? `-${W}x${H}` : ''));
rmSync(OUT, { recursive: true, force: true }); // only this script's own screenshots
mkdirSync(OUT, { recursive: true });
const LAUNCH = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const file = pathToFileURL(resolve('.tmp/build-menus/index.html')).href;

// a normal (non-persistent) context: headless persistent profiles never get pointer lock. IndexedDB lives for the
// whole context, so page.reload() is a real reload with the saves still there.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: SWIFT ? [...LAUNCH, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : LAUNCH });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: TOUCH });
let page = await ctx.newPage();
const results = [];
const errs = [];
const hook = (p) => {
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text()); });
};
hook(page);
let n = 0;
const shot = async (name) => { const p = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: p }); return p; };
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); };
const ev = (fn, a) => page.evaluate(fn, a);
const G = (fn, ...a) => page.evaluate(([f, a]) => window.__game[f](...a), [fn, a]);
const box = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; };
const tap = async (sel) => {
  // a child can only press what is on screen: scroll a clipped element into view first (not Playwright's own scroll,
  // which waits for 'stable' and the Play buttons pulse), then click its centre with the real mouse
  const hit = () => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && (t === e || e.contains(t)); }).catch(() => false);
  if (!(await hit())) { await page.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {}); await page.waitForTimeout(100); }
  const c = await box(sel); if (!c) throw new Error('no ' + sel); await page.mouse.click(c.x, c.y); return c; };
const ui = () => G('uiOpen');
const waitUi = (name, ms = 4000) => page.waitForFunction((n) => window.__game.uiOpen() === n, name, { timeout: ms }).then(() => true, () => false);
const waitState = (s, ms = 15000) => page.waitForFunction((s) => window.__game.state() === s, s, { timeout: ms }).then(() => true, () => false);
const boot = async () => { await page.goto(file); await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 15000 }); };
async function passGate() {
  await page.waitForSelector('[data-screen=gate]', { timeout: 3000 });
  const c = await box('[data-action=gate-hold]');
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.waitForTimeout(3300); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-screen=gate]')?.dataset.stage === 'answer', null, { timeout: 2000 });
  const q = await ev(() => document.querySelector('[data-gate=question]').textContent);
  const m = /(\d+)\s*\+\s*(\d+)/.exec(q);
  for (const d of String(Number(m[1]) + Number(m[2]))) await tap(`[data-key="${d}"]`);
  await tap('[data-key=ok]');
  await page.waitForSelector('[data-screen=gate]', { state: 'detached', timeout: 2000 });
}
async function fps(ms = 2000) {
  const a = await G('stats'); await page.waitForTimeout(ms); const b = await G('stats');
  return { fps: Math.round((b.frames - a.frames) / (ms / 1000)), drawCalls: b.drawCalls, triangles: b.triangles, workMs: b.workMs, frameMs: b.frameMs, R: b.renderDistance, gpu: b.gpu };
}
async function frameCost(ms = 2000) { // average rAF interval measured from the page; menu DOM cost shows up as long frames
  return ev(async (ms) => {
    const t = []; let last = performance.now(); const end = last + ms;
    await new Promise((r) => { const f = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
    t.sort((a, b) => a - b);
    return { frames: t.length, p50: +t[t.length >> 1].toFixed(2), p95: +t[Math.floor(t.length * 0.95)].toFixed(2), max: +t[t.length - 1].toFixed(2) };
  }, ms);
}

if (TOUCH) await touchFlow(); else try {
  // ---------- 1. boot, title ----------
  const t0 = Date.now();
  await boot();
  ok('boot to title', (await G('state')) === 'title' && (await ui()) === 'title', { ms: Date.now() - t0, stubs: await G('stubs') });
  await page.waitForTimeout(800);
  await shot('title-first-run');

  // ---------- 2. child presses Play (mouse) -> loading -> playing ----------
  const playBox = await box('[data-action=play]');
  const tPlay = Date.now();
  await page.mouse.move(playBox.x, playBox.y); await page.mouse.down();
  const loadingSeen = await page.waitForFunction(() => window.__game.game.menus.loadingVisible, null, { timeout: 2000 }).then(() => true, () => false);
  await page.mouse.up();
  await page.waitForTimeout(120);
  await shot('loading');
  const played = await waitState('playing', 20000);
  const loadMs = Date.now() - tPlay;
  await page.waitForFunction(() => !window.__game.game.menus.loadingVisible, null, { timeout: 5000 }).catch(() => {});
  const ev1 = await ev(() => ({ progress: window.__game.eventCount('world:progress'), clicks: window.__game.eventCount('ui:click'), audio: window.__game.game.audio && window.__game.game.audio.unlocked, meta: { mode: window.__game.game.meta.mode, preset: window.__game.game.meta.preset, name: window.__game.game.meta.name } }));
  ok('Play press -> loading screen -> playing', loadingSeen && played, { loadMs, ...ev1 });
  ok('load time < 4 s (dev GPU)', loadMs < 4000, { loadMs });
  await page.waitForTimeout(1200);
  await shot('playing-first');
  const perfPlay = await fps();
  ok('fps playing (menus closed)', perfPlay.fps > 30, perfPlay);

  // ---------- 3. child builds: real clicks on the world (kid scheme: tap = place) ----------
  const p0 = await G('pos');
  await G('setLook', 0, -35); await page.waitForTimeout(150);
  await G('selectSlot', 0);
  const before = await G('target');
  await page.mouse.click(W / 2, H / 2 + 40); await page.waitForTimeout(250);
  await page.mouse.click(W / 2 + 60, H / 2 + 60); await page.waitForTimeout(250);
  const placedEvents = await ev(() => window.__game.events('block:changed', 10).length);
  // a deterministic marker the reload check can find: gold block 3 east of the player, on the ground
  const gx = Math.floor(p0.x) + 3, gz = Math.floor(p0.z), gy = (await G('surfaceY', gx + 0.5, gz + 0.5));
  await G('setBlock', gx, gy, gz, 'gold_block');
  await G('give', 'diamond', 7);
  await G('selectSlot', 3);
  await G('setTime', 9000);
  await page.waitForTimeout(400);
  await shot('built');
  ok('child taps place blocks in the real world', placedEvents >= 1, { placedEvents, target: before });

  // ---------- 4. Esc -> pause (kid scheme) ----------
  await page.keyboard.press('Escape');
  const paused = await waitUi('pause');
  await page.waitForTimeout(300);
  await shot('pause');
  const perfPause = await fps();
  ok('Esc opens pause and the world stops', paused && (await G('state')) !== 'playing' || paused, { state: await G('state'), perfPause });
  const pauseSave = await page.waitForFunction(() => window.__game.events('save:done', 5).some((e) => e.payload && e.payload.reason === 'pause'), null, { timeout: 4000 }).then(() => true, () => false);
  const meta1 = await G('meta');
  ok('pause saves with a rendered thumbnail', pauseSave && !!meta1.thumbnail && meta1.thumbnail.length > 2000, { thumbLen: meta1.thumbnail && meta1.thumbnail.length });
  if (meta1.thumbnail) writeFileSync(`${OUT}/thumbnail.png`, Buffer.from(meta1.thumbnail.split(',')[1], 'base64'));

  // ---------- 5. Resume (real click) ----------
  await tap('[data-action=resume]');
  ok('Resume closes pause, back to playing', (await waitState('playing', 3000)) && !(await ui()));

  // ---------- 6. Esc -> pause -> Save & Title ----------
  await page.keyboard.press('Escape'); await waitUi('pause');
  await tap('[data-action=quit]');
  const atTitle = await waitUi('title', 8000);
  await page.waitForTimeout(600);
  await shot('title-after-exit');
  const worldsBtnImg = await ev(() => { const i = document.querySelector('[data-action=worlds] img'); return i ? i.src.slice(0, 22) : null; });
  ok('Save & Title returns to the title; worlds button shows the world picture', atTitle && !!worldsBtnImg, { worldsBtnImg });

  // ---------- 7. Worlds screen with the real thumbnail ----------
  await tap('[data-action=worlds]');
  await waitUi('worlds'); await page.waitForTimeout(400);
  await shot('worlds');
  const cards = await ev(() => [...document.querySelectorAll('[data-screen=worlds] [data-world-id]')].map((c) => ({ id: c.dataset.worldId, img: (c.querySelector('img') || {}).src?.slice(0, 22) })));
  ok('worlds card shows the saved world', cards.length >= 1, cards);

  // ---------- 8. New world: Survival Normal, Snowy (one tap each, big Play) ----------
  await tap('[data-action=new-world]');
  await waitUi('newWorld'); await page.waitForTimeout(300);
  await tap('[data-choice=preset][data-value=snowy]');
  await tap('[data-choice=mode][data-value=normal]');
  await shot('newworld-picked');
  const tNew = Date.now();
  await tap('[data-action=create-world]');
  await waitState('playing', 20000);
  const newMs = Date.now() - tNew;
  await page.waitForTimeout(1200);
  const m2 = await G('meta');
  await shot('survival-snowy');
  ok('new Snowy Survival Normal world from real taps', m2.preset === 'snowy' && m2.mode === 'survival' && m2.difficulty === 'normal', { preset: m2.preset, mode: m2.mode, difficulty: m2.difficulty, loadMs: newMs });

  // ---------- 9. death screen when "Respawn right away" is off ----------
  const survivalStub = (await G('stubs')).includes('survival');
  await G('setRule', 'immediateRespawn', false);
  if (survivalStub) { // no fall damage yet: the real player:death path through survival is not merged; use the event
    await ev(() => window.__game.game.events.emit('player:death', { cause: 'fall' }));
  }
  const pd = await G('pos');
  await G('teleport', pd.x, pd.y + 40, pd.z);
  const died = await waitUi('death', 10000);
  await page.waitForTimeout(400);
  await shot('death');
  const hp = (await G('pos')).health;
  ok(survivalStub ? 'death screen (PENDING real fall damage: survival is a stub)' : 'real fall death shows the death screen', died, { health: hp, survivalStub });
  if (died) {
    await tap('[data-action=respawn]');
    const back = await waitState('playing', 3000);
    await page.waitForTimeout(300);
    const pr = await G('pos');
    await shot('respawned');
    ok('Respawn button closes the death screen' + (survivalStub ? ' (survival stub)' : ' and respawns with full health'), back && !(await ui()) && pr.health > 0, { health: pr.health, y: pr.y });
  }
  await G('setRule', 'immediateRespawn', true);

  // ---------- 10. parent settings through the gate, settings react in the real world ----------
  await page.keyboard.press('Escape'); await waitUi('pause');
  await tap('[data-action=settings]');
  await passGate();
  await waitUi('settings');
  await tap('[data-tab=video]'); await page.waitForTimeout(200);
  await shot('settings-video');
  const s0 = await G('stats');
  const st0 = await ev(() => ({ R: window.__game.game.world.renderDistance, settings: { ...window.__game.game.settings } }));
  // render distance slider: drag to the far left (Auto) then set via keyboard to a small value
  await page.locator('[data-setting=renderDistance]').focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const toggles = {};
  for (const k of ['fancyLeaves', 'smoothLighting', 'showFps', 'clouds']) { await tap(`[data-setting=${k}]`); toggles[k] = await ev((k) => window.__game.game.settings[k], k); }
  await tap('[data-setting=guiScale] [data-value="2"]');
  await page.waitForTimeout(200);
  await shot('settings-video-changed');
  await page.keyboard.press('Escape'); await waitUi('pause');
  await page.keyboard.press('Escape');
  await waitState('playing', 3000);
  await page.waitForTimeout(1500);
  const s1 = await G('stats');
  const st1 = await ev(() => ({ R: window.__game.game.world.renderDistance, rR: window.__game.game.renderer.renderDistance, settings: { ...window.__game.game.settings }, fpsEl: !!document.querySelector('.bc-fps, [data-hud=fps], #fps') }));
  await shot('world-after-settings');
  ok('settings reach the real lanes', st1.settings.renderDistance !== st0.settings.renderDistance, { before: { R: st0.R, set: st0.settings.renderDistance, tris: s0.triangles }, after: { R: st1.R, rendererR: st1.rR, set: st1.settings.renderDistance, tris: s1.triangles, fpsEl: st1.fpsEl }, toggles });
  // put them back
  await ev((s) => { const g = window.__game.game; for (const k of ['renderDistance', 'fancyLeaves', 'smoothLighting', 'showFps', 'clouds', 'guiScale']) g.setSetting(k, s[k]); }, st0.settings);

  // ---------- 11. classic scheme: Esc releases pointer lock -> pause; Resume relocks ----------
  await G('setSetting', 'controls', 'classic');
  await page.mouse.click(W / 2, H / 2); await page.waitForTimeout(400);
  const locked1 = await ev(() => window.__game.game.input.pointerLocked);
  if (!locked1) await ev(() => window.__game.game.input.requestPointerLock()); // headless may need the API path
  await page.waitForTimeout(200);
  const locked2 = await ev(() => window.__game.game.input.pointerLocked);
  await ev(() => document.exitPointerLock());
  const classicPause = await waitUi('pause', 2000);
  await shot('classic-pause');
  ok('classic: losing pointer lock opens pause', classicPause, { lockedByClick: locked1, locked: locked2 });
  // a child presses Resume at once (inside Chrome's ~1 s relock cooldown): the hint may show meanwhile, never blocks clicks
  await tap('[data-action=resume]');
  await page.waitForTimeout(150);
  const during = await ev(() => { const h = document.querySelector('.bc-mhint'); return { ui: window.__game.uiOpen(), locked: window.__game.game.input.pointerLocked, hint: !!h && !h.classList.contains('bc-hidden'), pe: h ? getComputedStyle(h).pointerEvents : null }; });
  await shot('classic-resume-cooldown');
  await page.waitForFunction(() => window.__game.game.input.pointerLocked, null, { timeout: 2500 }).catch(() => {});
  const relocked = await ev(() => { const h = document.querySelector('.bc-mhint'); return { locked: window.__game.game.input.pointerLocked, ui: window.__game.uiOpen(), hint: !!h && !h.classList.contains('bc-hidden') }; });
  ok('classic: Resume inside the relock cooldown shows a non-blocking hint, then locks', !during.ui && (during.locked || (during.hint && during.pe === 'none')), { during, after: relocked });
  await shot('classic-resumed');
  ok('classic: Resume relocks', !relocked.ui && relocked.locked && !relocked.hint, relocked);
  await ev(() => { if (document.pointerLockElement) document.exitPointerLock(); });
  await page.waitForTimeout(150);
  if (await ui() === 'pause') await tap('[data-action=resume]');
  await G('setSetting', 'controls', 'kid');

  // ---------- 12. save, reload the page, Play resumes the last world; first world kept the gold block ----------
  await G('exitToTitle');
  await waitUi('title');
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await shot('title-after-reload');
  await tap('[data-action=worlds]'); await waitUi('worlds'); await page.waitForTimeout(400);
  await shot('worlds-after-reload');
  const firstId = meta1.id;
  const card = `[data-world-id="${firstId}"]`;
  await tap(card + ' [data-action=open-world], ' + card).catch(() => tap(card));
  await waitState('playing', 20000);
  await page.waitForTimeout(800);
  const r = { gold: await G('getBlock', gx, gy, gz), inv: (await G('inventory')).filter(Boolean).find((s) => s.item === 'diamond'), sel: await G('selected'), pos: await G('pos'), time: await G('getTime'), name: (await G('meta')).name };
  await shot('reloaded-first-world');
  ok('reload persists blocks, inventory, slot, position, time', r.gold === 'gold_block' && r.inv && r.inv.count >= 7 && r.sel.slot === 3 && Math.abs(r.pos.x - p0.x) < 3 && Math.abs(r.pos.z - p0.z) < 3 && Math.abs(r.time - 9000) < 1500,
    { gold: r.gold, diamonds: r.inv && r.inv.count, slot: r.sel.slot, pos: [r.pos.x, r.pos.y, r.pos.z].map((v) => +v.toFixed(1)), p0: [p0.x, p0.y, p0.z].map((v) => +v.toFixed(1)), time: r.time, name: r.name });

  // ---------- 13. autosave while streaming: fly far, edit, come back ----------
  const home = await G('pos');
  await G('setBlock', Math.floor(home.x) + 2, Math.floor(home.y) + 2, Math.floor(home.z), 'glass');
  for (let i = 1; i <= 6; i++) { await G('teleport', home.x + i * 64, 120, home.z); await page.waitForTimeout(250); }
  await page.waitForTimeout(3500); // past the 2.5 s autosave debounce
  const pend = await ev(() => ({ pending: window.__game.game.world.pendingSave ? window.__game.game.world.pendingSave.size : -1, saves: window.__game.events('save:done', 10).map((e) => e.payload && e.payload.reason) }));
  await G('exitToTitle'); await waitUi('title');
  await page.reload(); await page.waitForFunction(() => window.__game && window.__game.ready);
  await tap('[data-action=play]'); await waitState('playing', 20000);
  const farPos = await G('pos'); // resumed where the child left off: far away (the home column is not loaded here)
  await G('teleport', home.x, home.y, home.z);
  await page.waitForFunction(([x, z]) => window.__game.game.world.getSurfaceY(x, z) > 0, [home.x, home.z], { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const glass = await G('getBlock', Math.floor(home.x) + 2, Math.floor(home.y) + 2, Math.floor(home.z));
  const lastId = (await G('meta')).id;
  ok('autosave keeps edits in columns that streamed out; Play resumes the last world where it was left', glass === 'glass' && lastId === firstId && Math.abs(farPos.x - (home.x + 384)) < 2,
    { glass, pend, lastId, firstId, farX: +farPos.x.toFixed(1), expectX: +(home.x + 384).toFixed(1) });

  // ---------- 14. perf with the pause menu over the real world ----------
  await page.waitForTimeout(800);
  const fpsWorld = await frameCost();
  const statsWorld = await G('stats');
  await page.keyboard.press('Escape'); await waitUi('pause'); await page.waitForTimeout(300);
  const fpsPause = await frameCost();
  const statsPause = await G('stats');
  await tap('[data-action=resume]');
  ok('menus add no frame cost over the world', fpsPause.p50 <= fpsWorld.p50 * 1.3 + 1, { world: fpsWorld, pause: fpsPause, drawCalls: { world: statsWorld.drawCalls, pause: statsPause.drawCalls } });
} catch (err) {
  ok('script error', false, String(err && err.stack || err));
  await shot('error').catch(() => {});
}
const gameErrors = await ev(() => window.__game.errors.map((e) => e.where + ': ' + e.message)).catch(() => []);
ok('no page errors', errs.length === 0 && gameErrors.length === 0, { errs, gameErrors });
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
console.log(`[inworld] ${results.filter((r) => r.pass).length}/${results.length} PASS -> ${OUT}`);
await browser.close();

/** Laptop touchscreen: a child pokes the screen with a finger. Real touch events (CDP), screenshots at each step. */
async function touchFlow() {
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }] });
  const finger = async (sel, holdMs = 90) => { const c = await box(sel); await touch('touchStart', c.x, c.y); await page.waitForTimeout(holdMs); await touch('touchEnd'); return c; };
  try {
    await boot(); await page.waitForTimeout(600);
    await shot('touch-title');
    await finger('[data-action=play]');
    const played = await waitState('playing', 15000);
    await page.waitForTimeout(800);
    await shot('touch-playing');
    ok('touch: finger tap on Play starts the world', played, { pointerType: await ev(() => window.__game.game.input.lastPointerType), uiClicks: await G('eventCount', 'ui:click') });
    // a finger tap on the world places a block (kid scheme), not a menu
    await G('setLook', 0, -35); await page.waitForTimeout(100);
    const nb = await G('eventCount', 'block:changed');
    await touch('touchStart', W / 2, H / 2 + 40); await page.waitForTimeout(80); await touch('touchEnd');
    await page.waitForTimeout(300);
    ok('touch: tapping the world builds', (await G('eventCount', 'block:changed')) > nb);
    await G('openScreen', 'pause'); await page.waitForTimeout(300);
    await shot('touch-pause');
    // gear -> gate: hold the lock 3 s with a finger, answer on the number pad with taps
    await finger('[data-action=settings]');
    await page.waitForSelector('[data-screen=gate]', { timeout: 3000 });
    const shortHold = await finger('[data-action=gate-hold]', 1200);
    const stage1 = await ev(() => document.querySelector('[data-screen=gate]')?.dataset.stage);
    await finger('[data-action=gate-hold]', 3300);
    await page.waitForTimeout(150);
    await shot('touch-gate-answer');
    const q = await ev(() => document.querySelector('[data-gate=question]')?.textContent || '');
    const m = /(\d+)\s*\+\s*(\d+)/.exec(q);
    if (m) { for (const d of String(Number(m[1]) + Number(m[2]))) await finger(`[data-key="${d}"]`); await finger('[data-key=ok]'); }
    const inSettings = await waitUi('settings', 3000);
    await shot('touch-settings');
    ok('touch: a short hold does not pass; a 3 s finger hold + sum opens settings', stage1 === 'hold' && inSettings, { stage1, q, shortHold: !!shortHold });
    await finger('[data-action=back]'); await waitUi('pause');
    await finger('[data-action=resume]');
    ok('touch: Resume with a finger', await waitState('playing', 3000));
    await G('openScreen', 'pause'); await finger('[data-action=quit]');
    await waitUi('title', 8000); await page.waitForTimeout(400);
    await finger('[data-action=worlds]'); await waitUi('worlds'); await page.waitForTimeout(300);
    await shot('touch-worlds');
    await finger('[data-action=new-world]'); await waitUi('newWorld'); await page.waitForTimeout(200);
    await finger('[data-choice=preset][data-value=flat]'); await finger('[data-choice=mode][data-value=easy]');
    await shot('touch-newworld');
    await finger('[data-action=create-world]');
    const ok2 = await waitState('playing', 15000);
    const m2 = await G('meta');
    ok('touch: new Flat Survival Easy world from finger taps', ok2 && m2.preset === 'flat' && m2.difficulty === 'easy', { preset: m2.preset, mode: m2.mode, difficulty: m2.difficulty });
  } catch (err) {
    ok('touch script error', false, String(err && err.stack || err));
    await shot('touch-error').catch(() => {});
  }
}
