// OWNER LANE: FEATURE-AUDIO. Real-browser verification of the judge polish findings POL-5..POL-8 (round 1):
//   POL-6 title music after the first gesture, fading out when Play is pressed (real mouse clicks)
//   POL-5 rain bed (open vs under a roof), lit furnace crackle, water lapping, cave air + drips
//   POL-7 lighting TNT with flint and steel (real mouse click) = fuse + ignite, no block-break crunch
//   POL-8 the explosion is clearly louder than a block break (offline renders through the real graph + live log)
// Screenshots: .tmp/audio-polish/NN-<step>.png, report .tmp/audio-polish/report.json. Exit 1 on any FAIL.
//
//   node build.mjs --dev --out .tmp/build-audio && node tools/audio-polish-play.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.tmp', 'audio-polish');
const FILE = join(ROOT, '.tmp', 'build-audio', 'index.html');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });
if (!existsSync(FILE)) { console.error(`no build at ${FILE}`); process.exit(2); }

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};
const W = 1366, H = 768;
const browser = await chromium.launch({ executablePath: CHROME, headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ReadPixels|CONTEXT_LOST/i.test(m.text())) errors.push(m.text()); });
let n = 0;
const shot = async (name) => { const p = join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); return p; };
const G = (m, ...a) => page.evaluate(([m, a]) => window.__game[m](...a), [m, a]);
const ev = (fn, a) => page.evaluate(fn, a);
const sleep = (ms) => page.waitForTimeout(ms);
const stats = () => ev(() => window.__game.game.audio.stats());
const recent = (clear = true) => ev((c) => window.__game.game.audio.recent(c).map((r) => r.name), clear);
const listen = (ms = 1500) => ev((ms) => window.__game.game.audio.listenPeak(ms), ms);
const scr = (p) => ({ x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H });

try {
  await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });

  /* ---------------- POL-6 title music ---------------- */
  const before = await stats();
  check('title: locked and silent before any gesture', !before.unlocked && !before.music.enabled, before.music);
  await page.mouse.click(40, H - 40); // a child's first click on the title backdrop
  await sleep(4000);
  let s = await stats();
  const tl = await listen(2000);
  check('title: first click starts soft title music within ~4 s', s.music.title && s.music.playing && s.music.notesPlayed > 0,
    { ...s.music, rmsDb: tl.rmsDb, peakDb: Math.round(tl.peakDb * 10) / 10 });
  check('title: title music is -6 dB under the in-world level', s.music.level === 0.5, s.music.level);
  await shot('title-music');
  const play = await page.locator('[data-action=play]').first().boundingBox();
  await page.mouse.click(play.x + play.width / 2, play.y + play.height / 2); // real Play press
  await sleep(300);
  s = await stats();
  check('title: Play fades the title music out', !s.music.title && !s.music.enabled || s.music.wanted, s.music);
  await page.waitForFunction(() => window.__game.state() === 'playing', null, { timeout: 30000 });
  await sleep(2000);
  s = await stats();
  check('world: world music schedule starts fresh (first piece 20-40 s away, full level)', s.music.wanted && !s.music.title && s.music.level === 1 && s.music.nextIn >= 15 && s.music.nextIn <= 40, s.music);
  await shot('world-after-play');
  await G('setSetting', 'hints', false);
  await G('setSetting', 'musicVolume', 0); // isolate the effects bus for level checks

  /* ---------------- POL-5 rain ---------------- */
  await recent();
  await ev(() => window.__game.game.fx.setWeather(1));
  await sleep(6000);
  await G('setLook', 20, 0);
  const rainOpen = await listen(1500);
  let amb = (await stats()).ambience;
  const r1 = await recent();
  check('rain: heavy rain is heard in the open (soft bed ~ -33 dBFS RMS)', amb.rainBed && r1.includes('ambient.rain') && rainOpen.rmsDb > -40 && rainOpen.rmsDb < -28, { rmsDb: rainOpen.rmsDb, amb });
  await shot('rain-open');
  const p = await G('pos');
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) await G('setBlock', x + dx, y + 3, z + dz, 'oak_planks');
  await sleep(2500);
  const rainRoof = await listen(1500);
  amb = (await stats()).ambience;
  check('rain: under a roof it is quieter and muffled', amb.covered && rainRoof.rmsDb < rainOpen.rmsDb - 6, { open: rainOpen.rmsDb, roof: rainRoof.rmsDb, amb });
  await G('setLook', -10, 25);
  await shot('rain-under-roof');
  await ev(() => window.__game.game.fx.setWeather(0));
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) await G('setBlock', x + dx, y + 3, z + dz, 'air');
  await sleep(10000); // FX eases the rain out over several seconds; the bed follows it
  amb = (await stats()).ambience;
  check('rain: the bed fades away when the rain stops', amb.rain < 0.003, amb);

  /* ---------------- POL-5 furnace + water ---------------- */
  await G('setBlock', x + 2, y, z - 2, 'furnace_lit');
  await G('setBlock', x - 2, y, z - 2, 'furnace');
  for (let dx = -1; dx <= 1; dx++) for (let dz = 2; dz <= 4; dz++) { await G('setBlock', x + dx, y - 1, z + dz, 'water'); await G('setBlock', x + dx, y, z + dz, 'air'); }
  await recent();
  await G('lookAt', x + 2.5, y + 0.5, z - 1.5);
  await sleep(12000);
  const r2 = await recent();
  const crackles = r2.filter((k) => k === 'furnace.crackle').length;
  check('furnace: a lit furnace crackles now and then', crackles >= 2 && crackles <= 30, { crackles, heard: [...new Set(r2)] });
  check('water: open water laps now and then', r2.includes('water.ambient'), [...new Set(r2)]);
  await shot('furnace-and-pond');

  /* ---------------- POL-5 cave ---------------- */
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy < 4; dy++) await G('setBlock', x + dx, 20 + dy, z + dz, 'air');
  await G('teleport', x + 0.5, 20, z + 0.5);
  await recent();
  await sleep(9000);
  const caveL = await listen(1500);
  amb = (await stats()).ambience;
  const r3 = await recent();
  check('cave: very quiet cave air underground (~ -44 dBFS RMS) and soft drips', amb.cave === 1 && amb.caveBed && r3.includes('cave.drip') && caveL.rmsDb < -38, { rmsDb: caveL.rmsDb, amb, heard: [...new Set(r3)] });
  await shot('cave');
  await G('teleport', p.x, p.y + 1, p.z);
  await sleep(4000);
  amb = (await stats()).ambience;
  check('cave: the drone fades out back on the surface', amb.cave === 0, amb);

  /* ---------------- POL-7 TNT with flint and steel ---------------- */
  const q = await G('pos');
  const bx = Math.floor(q.x), by = Math.floor(q.y), bz = Math.floor(q.z) - 4;
  await G('setBlock', bx, by, bz, 'tnt');
  await G('setSlot', 5, 'flint_and_steel', 1); await G('selectSlot', 5);
  await G('lookAt', bx + 0.5, by + 0.5, bz + 0.5);
  await sleep(300);
  await recent();
  const c = scr(await G('worldToNdc', bx + 0.5, by + 0.5, bz + 1));
  await page.mouse.click(c.x, c.y); // real tap with flint and steel
  await sleep(700);
  await shot('tnt-lit');
  const r4 = await recent();
  check('tnt: lighting TNT = fuse + ignite only, no block-break crunch', r4.includes('tnt.fuse') && !r4.some((k) => k.startsWith('block.break')), r4);
  await sleep(4000);
  const r5 = await ev(() => window.__game.game.audio.recent(true));
  const ex = r5.find((r) => r.name === 'explosion');
  check('tnt: the explosion plays', !!ex, r5.map((r) => r.name));
  await shot('tnt-after');

  /* ---------------- POL-8 explosion vs block breaks ---------------- */
  const lv = {};
  for (const k of ['explosion', 'block.break.grass', 'block.break.stone']) {
    const o = await ev((k) => window.__game.game.audio.renderOffline(k, { seed: 3 }), k);
    lv[k] = { peakDb: o.peakDb, rmsDb: o.rmsDb, seconds: Math.round(o.seconds * 100) / 100 };
  }
  for (const [label, master, kid] of [['kid-max', 1, true], ['survival-max', 1, false]]) {
    const o = await ev(([kid, master]) => window.__game.game.audio.renderOffline('explosion', { kid, settings: { masterVolume: master }, seed: 3 }), [kid, master]);
    lv['explosion-' + label] = { peakDb: o.peakDb, rmsDb: o.rmsDb };
  }
  check('explosion: >= 5 dB louder (RMS) than a grass break, >= 4 dB over stone; peak above both',
    lv.explosion.rmsDb - lv['block.break.grass'].rmsDb >= 5 && lv.explosion.rmsDb - lv['block.break.stone'].rmsDb >= 4 &&
    lv.explosion.peakDb > lv['block.break.grass'].peakDb, lv);
  check('explosion: long rumble tail (>= 3 s) and still <= -6 dBFS peak at max volume',
    lv.explosion.seconds >= 3 && lv['explosion-kid-max'].peakDb <= -6 && lv['explosion-survival-max'].peakDb <= -6, lv);
} catch (e) {
  check('script ran', false, e.stack);
  await shot('error').catch(() => {});
}
check('no page/console errors', errors.length === 0, errors.slice(0, 5));
writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 1));
const sum = { PASS: results.filter((r) => r.status === 'PASS').length, FAIL: results.filter((r) => r.status === 'FAIL').length };
console.log(`[audio-polish] ${JSON.stringify(sum)}`);
await browser.close();
process.exit(sum.FAIL ? 1 : 0);
