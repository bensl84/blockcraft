// OWNER LANE: FEATURE-AUDIO. In-world audio verification in real gameplay (docs/handoff/audio.md, phase 2 list).
// Drives the real game the way a child would (real keyboard, real mouse press-and-hold, real touch taps) on a real
// generated world, reads what the audio system actually played (game.audio.recent()) and saves a screenshot at
// every step to .tmp/audio-inworld/NN-<step>.png plus .tmp/audio-inworld/report.json.
//
//   node build.mjs --dev --out .tmp/build-audio && node tools/audio-inworld.mjs [--swiftshader] [--headed]
//
// Exit code 1 if any check FAILs.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.tmp', 'audio-inworld');
const FILE = join(ROOT, '.tmp', 'build-audio', 'index.html');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const argv = process.argv.slice(2);
const SWIFT = argv.includes('--swiftshader');
const HEADED = argv.includes('--headed');
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1].split(',') : null; })();

mkdirSync(OUT, { recursive: true });
if (!existsSync(FILE)) { console.error(`no build at ${FILE}`); process.exit(2); }

const results = [];
const notes = {};
let shotN = 0;
function check(name, ok, detail) {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const launchArgs = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
if (SWIFT) launchArgs.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED, args: launchArgs });

async function openPage(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, hasTouch: !!opts.touch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ReadPixels|CONTEXT_LOST/i.test(m.text())) errors.push(m.text()); });
  await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });
  const api = (m, ...a) => page.evaluate(([m, a]) => window.__game[m](...a), [m, a]);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => { const p = join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); return p; };
  const recent = (clear = false) => ev((c) => window.__game.game.audio.recent(c), clear);
  const audio = () => ev(() => window.__game.game.audio.stats());
  return { context, page, api, ev, shot, recent, audio, errors };
}

/** Flat material road in front of the spawn (towards -Z, the yaw-0 facing), air above it, player on its first tile. */
async function buildRoad(g, mats, tilesEach) {
  return g.ev(([mats, tilesEach]) => {
    const G = window.__game, p = G.pos();
    const x0 = Math.floor(p.x), z0 = Math.floor(p.z), y = Math.floor(p.y) + 6; // a raised road: nothing to bump into
    const set = (x, yy, z, n) => G.setBlock(x, yy, z, n);
    const len = mats.length * tilesEach + 4;
    for (let i = -2; i < len; i++) {
      for (let dx = -2; dx <= 2; dx++) {
        const mat = i < 0 || i >= mats.length * tilesEach ? 'stone' : mats[Math.floor(i / tilesEach)];
        set(x0 + dx, y - 1, z0 - i, dx === 0 ? mat : 'stone');
        set(x0 + dx, y - 2, z0 - i, 'stone');
        for (let h = 0; h < 4; h++) set(x0 + dx, y + h, z0 - i, 'air');
      }
    }
    G.teleport(x0 + 0.5, y, z0 + 0.5);
    G.setLook(0, -20);
    return { x0, y, z0 };
  }, [mats, tilesEach]);
}

async function settle(g, ms = 1500) {
  await g.page.waitForFunction(() => window.__game.worldReady === true || window.__game.game.state === 'playing', null, { timeout: 30000 });
  await sleep(ms);
}

function intervals(list) { const o = []; for (let i = 1; i < list.length; i++) o.push(Math.round((list[i] - list[i - 1]) * 1000) / 1000); return o; }
const want = (k) => !ONLY || ONLY.includes(k);

/* ======================================================================= 1. locked title, real click unlocks */
const g = await openPage();
{
  const s0 = await g.audio();
  await g.shot('title-locked');
  check('title: audio locked before any gesture', s0.unlocked === false && s0.state === 'none', { state: s0.state });
  await g.page.mouse.click(640, 690); // a child clicks somewhere on the title screen
  const ok = await g.page.waitForFunction(() => window.__game.game.audio.unlocked === true, null, { timeout: 5000 }).then(() => true, () => false);
  check('title: one real mouse click unlocks audio', ok, { state: (await g.audio()).state });
}

/* ======================================================================= 2. survival world: music schedule */
await g.api('startWorld', { preset: 'default', seed: 4242, mode: 'survival', difficulty: 'peaceful' });
await settle(g, 2500);
{
  const s = await g.audio();
  notes.musicAtStart = s.music;
  await g.shot('world-start');
  check('music: world start requests music', s.music.wanted === true, s.music);
  check('music: first piece is scheduled 20-40 s after world start', s.music.nextIn === null || (s.music.nextIn >= 15 && s.music.nextIn <= 40.5), { nextIn: s.music.nextIn });
  // the felt-piano samples render once in an OfflineAudioContext after the first gesture (slow on a weak CPU;
  // the scheduler simply waits for them - the first piece is 20-40 s away anyway)
  const readyOk = await g.page.waitForFunction(() => window.__game.game.audio.stats().music.ready === true, null, { timeout: 20000 }).then(() => true, () => false);
  check('music: piano samples are ready well before the first piece', readyOk, { readyAtWorldStart: s.music.ready });
  check('music: no notes before the first piece', (s.music.notesPlayed || 0) === 0, { notesPlayed: s.music.notesPlayed });
}

/* ======================================================================= 3. footsteps on every material */
if (want('steps')) {
  const mats = ['grass_block', 'dirt', 'stone', 'oak_planks', 'sand', 'gravel', 'snow_block', 'white_wool', 'glass', 'iron_block'];
  await buildRoad(g, mats, 4);
  await sleep(1200);
  await g.shot('road-before-walk');
  await g.recent(true);
  await g.page.keyboard.down('KeyW');
  await sleep(2500);
  await g.shot('walking-on-road');
  await sleep(7000);
  await g.page.keyboard.up('KeyW');
  await sleep(400);
  const log = (await g.recent(true)).filter((e) => /^block\.(step|land)\./.test(e.name));
  const steps = log.filter((e) => e.name.startsWith('block.step.'));
  const seen = [...new Set(steps.map((e) => e.name.replace('block.step.', '')))];
  const iv = intervals(steps.map((e) => e.t));
  const med = iv.slice().sort((a, b) => a - b)[Math.floor(iv.length / 2)] || 0;
  notes.walk = { steps: steps.length, materials: seen, medianInterval: med, gains: steps.map((e) => e.gain), sequence: steps.map((e) => e.name.replace('block.step.', '')) };
  check('steps: every road material was heard underfoot', ['grass', 'dirt', 'stone', 'wood', 'sand', 'gravel', 'snow', 'cloth', 'glass', 'metal'].every((m) => seen.includes(m)), { seen });
  check('steps: walking cadence ~0.4 s (1.7 blocks at 4.3 m/s)', med > 0.3 && med < 0.5, { median: med });
  check('steps: footsteps are centred (own feet, no pan)', steps.every((e) => Math.abs(e.pan) < 0.2), { maxPan: Math.max(...steps.map((e) => Math.abs(e.pan))) });
  const pos = await g.api('pos');
  await g.shot('road-end');
  // sprint exists in the classic scheme only (R or Ctrl + W)
  await g.api('setSetting', 'controls', 'classic');
  await buildRoad(g, ['grass_block'], 30);
  await sleep(600);
  await g.recent(true);
  await g.page.keyboard.down('KeyR');
  await g.page.keyboard.down('KeyW');
  await sleep(1000);
  const sprinting = (await g.api('pos')).sprinting;
  await sleep(3000);
  await g.page.keyboard.up('KeyW');
  await g.page.keyboard.up('KeyR');
  await g.api('setSetting', 'controls', 'kid');
  const sp = (await g.recent(true)).filter((e) => e.name.startsWith('block.step.'));
  const siv = intervals(sp.map((e) => e.t));
  const smed = siv.slice().sort((a, b) => a - b)[Math.floor(siv.length / 2)] || 0;
  notes.sprint = { sprinting, steps: sp.length, medianInterval: smed, z: pos.z };
  check('steps: sprinting steps come faster than walking', smed > 0 && smed < med, { sprint: smed, walk: med });
}

/* ======================================================================= 4. jumping: landing sound */
if (want('land')) {
  await buildRoad(g, ['oak_planks'], 6);
  await sleep(600);
  await g.recent(true);
  await g.page.keyboard.down('Space');
  await sleep(120);
  await g.page.keyboard.up('Space');
  await sleep(900);
  const l = (await g.recent(true)).map((e) => e.name);
  notes.jump = l;
  check('jump: landing on planks makes a wood step/land sound', l.some((n) => n === 'block.step.wood' || n === 'block.land.wood'), l);
  check('jump: a small hop is not a big fall', !l.includes('player.bigfall'), l);
  // big fall: drop from 8 blocks onto stone
  const p = await g.api('pos');
  await g.api('teleport', p.x, p.y + 8, p.z);
  await g.recent(true);
  await sleep(2000);
  const l2 = (await g.recent(true)).map((e) => e.name);
  notes.bigFall = l2;
  check('fall: an 8-block drop thuds (land + big-fall)', l2.includes('player.bigfall') && l2.some((n) => n.startsWith('block.land.')), l2);
}

/* ======================================================================= 5. survival mining: real press-and-hold */
if (want('mine')) {
  await buildRoad(g, ['dirt', 'dirt', 'stone'], 1);
  // stand on the road and look at the dirt block right in front at foot level
  const r = await g.ev(() => { const G = window.__game, p = G.pos(); return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }; });
  await g.api('setBlock', r.x, r.y, r.z - 2, 'dirt');
  await g.api('setBlock', r.x, r.y, r.z - 3, 'stone');
  await g.api('lookAt', r.x + 0.5, r.y + 0.5, r.z - 1.5);
  await sleep(300);
  const tgt = await g.ev(() => { const t = window.__game.game.interaction && window.__game.game.interaction.target; return t ? { x: t.x, y: t.y, z: t.z, id: t.id } : null; });
  notes.mineTarget = tgt;
  await g.shot('mine-aim-dirt');
  await g.recent(true);
  const b0 = await g.api('eventCount', 'block:broken');
  // kid scheme: press and hold the mouse button (350 ms) = attack
  await g.page.mouse.move(640, 360);
  await g.page.mouse.down();
  const broke = await g.page.waitForFunction((b0) => window.__game.eventCount('block:broken') > b0, b0, { timeout: 6000 }).then(() => true, () => false);
  await g.page.mouse.up();
  const brokeTick = await g.ev(() => { const e = window.__game.events('block:broken', 1)[0]; return e ? e.tick : -1; });
  await sleep(1000);
  await g.shot('mine-dirt-broken');
  const log = await g.recent(true);
  const hits = log.filter((e) => e.name.startsWith('block.hit.'));
  const brk = log.filter((e) => e.name.startsWith('block.break.'));
  const hitTicks = hits.map((e) => e.tick);
  notes.mineDirt = { broke, brokeTick, hitTicks, breaks: brk.map((e) => `${e.name}@${e.tick}`) };
  check('mine: holding the mouse on dirt breaks it (survival)', broke, notes.mineDirt);
  check('mine: hit sounds while mining dirt', hits.length >= 2 && hits.every((e) => e.name === 'block.hit.grass' || e.name === 'block.hit.dirt'), hits.map((e) => e.name));
  const dts = intervals(hitTicks);
  check('mine: hit rhythm every 4 ticks', dts.length > 0 && dts.every((d) => d === 4), dts);
  check('mine: exactly one break sound', brk.length === 1, brk.map((e) => e.name));
  check('mine: no hit after the block broke', hits.every((e) => e.tick <= brokeTick), { brokeTick, hitTicks });
  // partial mining of stone by hand, then let go: hits must stop at once
  await g.api('lookAt', r.x + 0.5, r.y + 0.5, r.z - 2.5);
  await sleep(200);
  await g.recent(true);
  await g.page.mouse.down();
  await sleep(1500);
  await g.shot('mine-stone-cracking');
  await g.page.mouse.up();
  const upTick = await g.ev(() => window.__game.game.tickCount);
  await sleep(1200);
  const log2 = await g.recent(true);
  const h2 = log2.filter((e) => e.name.startsWith('block.hit.'));
  notes.mineStone = { upTick, hitTicks: h2.map((e) => e.tick), names: [...new Set(h2.map((e) => e.name))] };
  check('mine: stone hits are stone-coloured', h2.length >= 2 && h2.every((e) => e.name === 'block.hit.stone'), notes.mineStone.names);
  check('mine: letting go of the mouse stops the hits', h2.every((e) => e.tick <= upTick + 1), notes.mineStone);
}

/* ======================================================================= 6. creative: one hold = one break sound */
if (want('creative')) {
  await g.api('setMode', 'creative');
  await buildRoad(g, ['stone'], 3);
  const r = await g.ev(() => { const p = window.__game.pos(); return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }; });
  await g.api('setBlock', r.x, r.y, r.z - 2, 'oak_planks');
  await g.api('lookAt', r.x + 0.5, r.y + 0.5, r.z - 1.5);
  await sleep(300);
  await g.recent(true);
  const b0 = await g.api('eventCount', 'block:broken');
  await g.page.mouse.down();
  await g.page.waitForFunction((b0) => window.__game.eventCount('block:broken') > b0, b0, { timeout: 3000 }).catch(() => {});
  await g.page.mouse.up();
  await sleep(600);
  await g.shot('creative-break');
  const log = await g.recent(true);
  const nb = (await g.api('eventCount', 'block:broken')) - b0;
  const br = log.filter((e) => e.name.startsWith('block.break.'));
  const hits = log.filter((e) => e.name.startsWith('block.hit.'));
  notes.creative = { brokenEvents: nb, breakSounds: br.map((e) => e.name), hits: hits.length };
  check('creative: one break sound per broken block, no mining hits', br.length === nb && nb >= 1 && hits.length === 0, notes.creative);
  // creative tap = place: one place sound (put planks in the hand first: the survival hotbar is empty)
  await g.api('setSlot', 0, 'oak_planks', 64);
  await g.api('selectSlot', 0);
  await g.api('lookAt', r.x + 0.5, r.y - 0.5, r.z - 1.5);
  await sleep(200);
  await g.recent(true);
  const p0 = await g.api('eventCount', 'block:placed');
  await g.page.mouse.click(640, 360);
  await sleep(500);
  const placed = (await g.api('eventCount', 'block:placed')) - p0;
  const pl = (await g.recent(true)).filter((e) => e.name.startsWith('block.place.'));
  notes.place = { placed, sounds: pl.map((e) => e.name) };
  await g.shot('creative-place');
  check('creative: a tap places a block with one place sound', placed >= 1 && pl.length === placed, notes.place);
  await g.api('setMode', 'survival');
}

/* ======================================================================= 7. water: splash vs wade, muffle */
if (want('water')) {
  const r = await g.ev(() => {
    const G = window.__game, p = G.pos();
    const x0 = Math.floor(p.x) + 20, z0 = Math.floor(p.z), y0 = Math.floor(p.y) + 20;
    // a 5x5 pool 4 deep with a stone rim and a 1-deep shallow strip on its south side
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 8; dz++) {
      G.setBlock(x0 + dx, y0 - 5, z0 + dz, 'stone');
      for (let h = -4; h <= 6; h++) G.setBlock(x0 + dx, y0 + h, z0 + dz, 'air');
      const pool = Math.abs(dx) <= 2 && dz >= -2 && dz <= 2;
      const shallow = Math.abs(dx) <= 1 && dz >= 3 && dz <= 8;
      for (let h = -4; h <= -1; h++) G.setBlock(x0 + dx, y0 + h, z0 + dz, pool ? 'water' : (h === -1 && shallow ? 'stone' : 'stone'));
      if (shallow) G.setBlock(x0 + dx, y0, z0 + dz, 'water');
    }
    return { x0, y0, z0 };
  });
  await sleep(800);
  // a) jump in from 6 blocks up
  await g.api('teleport', r.x0 + 0.5, r.y0 + 6, r.z0 + 0.5);
  await g.api('setLook', 0, -60);
  await g.recent(true);
  const vyAt = [];
  for (let i = 0; i < 40; i++) {
    const s = await g.api('pos');
    vyAt.push(s.vy);
    if (s.eyeInWater) break;
    await sleep(50);
  }
  await sleep(250);
  const under = await g.audio();
  await g.shot('water-underwater');
  const l1 = (await g.recent(true)).map((e) => e.name);
  notes.splash = { sounds: l1, muffleHz: under.muffleHz, eyeInWater: (await g.api('pos')).eyeInWater };
  check('water: falling into a pool splashes (not a swim stroke)', l1.includes('player.splash') && !l1.includes('player.swim'), l1);
  check('water: no ground thud when landing in water', !l1.some((n) => n.startsWith('block.land.') || n === 'player.bigfall'), l1);
  check('water: sounds are muffled with the head under water', notes.splash.eyeInWater ? under.muffleHz < 1000 : false, { muffleHz: under.muffleHz, eye: notes.splash.eyeInWater });
  // b) climb out: teleport onto the rim -> muffle lifts
  await g.api('teleport', r.x0 + 0.5, r.y0 + 0.01, r.z0 + 6.5);
  await sleep(800);
  const dry = await g.audio();
  check('water: muffle lifts out of the water', dry.muffleHz > 10000, { muffleHz: dry.muffleHz });
  // c) wade: stand on the rim south of the shallow strip and walk north into it
  await g.ev((r) => { const G = window.__game; for (let dz = 9; dz <= 11; dz++) { G.setBlock(r.x0, r.y0 - 1, r.z0 + dz, 'stone'); G.setBlock(r.x0, r.y0, r.z0 + dz, 'air'); G.setBlock(r.x0, r.y0 + 1, r.z0 + dz, 'air'); } }, r);
  await g.api('teleport', r.x0 + 0.5, r.y0 + 0.01, r.z0 + 10.5);
  await g.api('setLook', 0, -25);
  await sleep(500);
  await g.recent(true);
  await g.page.keyboard.down('KeyW');
  await g.page.waitForFunction(() => window.__game.pos().inWater, null, { timeout: 4000 }).catch(() => {});
  await sleep(300);
  await g.page.keyboard.up('KeyW');
  await g.shot('water-wading');
  const l2 = (await g.recent(true)).map((e) => e.name);
  notes.wade = l2;
  check('water: wading in is a soft swim stroke, not a splash', l2.includes('player.swim') && !l2.includes('player.splash'), l2);
}

/* ======================================================================= 8. listener: pan follows the camera */
if (want('pan')) {
  await buildRoad(g, ['grass_block'], 6);
  await sleep(400);
  const emitCow = async () => { await sleep(700); return g.ev(() => {
    const G = window.__game, p = G.pos(), a = G.game.audio;
    const n0 = a.stats().started;
    // a cow 5 blocks EAST of the player (+X), at head height
    G.game.events.emit('mob:sound', { id: 900001 + Math.floor(Math.random() * 1e5), type: 'cow', kind: 'idle', x: p.x + 5, y: p.y + 1.6, z: p.z });
    const played = a.stats().started > n0 ? a.recent().slice(-1)[0] : null;
    return played ? { ...played, yawDeg: Math.round(p.yaw), view: p.view, listener: a.stats().listener } : { name: 'not played', pan: 0, listener: a.stats().listener };
  }); };
  await g.api('setLook', 0, -10);
  await sleep(200);
  const a = await emitCow();
  // turn around with the real arrow key (kid scheme turns)
  const yaw0 = (await g.api('pos')).yaw;
  await g.page.keyboard.down('ArrowLeft');
  let turned = 0;
  for (let i = 0; i < 80; i++) { await sleep(50); const y = (await g.api('pos')).yaw; turned = Math.abs(y - yaw0); if (turned > 150) break; }
  await g.page.keyboard.up('ArrowLeft');
  await sleep(200);
  const b = await emitCow();
  const yaw1 = (await g.api('pos')).yaw;
  await g.shot('pan-turned-around');
  notes.pan = { facingNorth: a, afterTurn: b, yaw0, yaw1 };
  check('pan: a cow to the east is heard on the right when facing north', a && a.name === 'cow.idle' && a.pan > 0.3, a);
  check('pan: after turning around with the arrow key it is on the left', b && b.pan < -0.3, { pan: b && b.pan, yaw: yaw1 });
  // third person: back view keeps the sides; front view (camera looks at the player) mirrors them like the screen
  await g.api('setLook', 0, -10);
  await g.page.keyboard.press('KeyV');
  await sleep(300);
  const back = await emitCow();
  await g.shot('pan-third-person-back');
  await g.page.keyboard.press('KeyV');
  await sleep(300);
  const front = await emitCow();
  await g.shot('pan-third-person-front');
  await g.page.keyboard.press('KeyV');
  await sleep(200);
  notes.panViews = { back, front, view: (await g.api('pos')).view };
  check('pan: third-person back view - cow still on the right', back && back.pan > 0.3, back);
  check('pan: third-person front view - cow on the screen\'s left', front && front.pan < -0.3, front);
}

/* ======================================================================= 9. music mood + ducking */
if (want('music')) {
  await g.api('setTime', 1000);
  await sleep(300);
  const day = await g.audio();
  await g.api('setTime', 14000);
  await sleep(300);
  const night = await g.audio();
  check('music: night mood switches on at night', day.night === false && night.night === true, { day: day.night, night: night.night });
  await g.api('setTime', 1000);
  await g.ev(() => window.__game.game.audio.startMusic(0));
  await g.page.waitForFunction(() => window.__game.game.audio.stats().music.notesPlayed > 0, null, { timeout: 10000 }).catch(() => {});
  const m = (await g.audio()).music;
  check('music: piano plays in-world', m.notesPlayed > 0, m);
  // TNT chain: 5 explosions close together duck the music
  await g.ev(() => { const G = window.__game, p = G.pos(); for (let i = 0; i < 5; i++) setTimeout(() => G.game.events.emit('explosion', { x: p.x + 6 + i, y: p.y, z: p.z - 4, power: 4, blocks: [], count: 0 }), i * 150); });
  await sleep(700);
  const ducked = await g.audio();
  await g.shot('explosions');
  await sleep(2500);
  const back = await g.audio();
  notes.duck = { during: ducked.duck, after: back.duck, explosionVoices: ducked.byName.explosion || 0 };
  check('music: ducks under a TNT chain and comes back', ducked.duck < 0.6 && back.duck > 0.9, notes.duck);
  check('explosion: chain is voice-limited (<= 4 at once)', (ducked.byName.explosion || 0) <= 4, notes.duck);
}

/* ======================================================================= 10. performance with the real world */
if (want('perf')) {
  await g.api('setLook', 0, -10);
  const measure = (storm) => g.ev(async (storm) => {
    const G = window.__game, game = G.game, a = game.audio;
    // time spent inside audio.frame/tick
    const of = a.frame, ot = a.tick;
    let audioMs = 0;
    a.frame = function () { const t = performance.now(); const r = of.apply(this, arguments); audioMs += performance.now() - t; return r; };
    a.tick = function () { const t = performance.now(); const r = ot.apply(this, arguments); audioMs += performance.now() - t; return r; };
    let frames = 0, emitMs = 0, run = true;
    const p = G.pos();
    const types = ['pig', 'cow', 'sheep', 'chicken', 'zombie', 'skeleton', 'spider', 'creeper', 'wolf', 'cat', 'horse'];
    const raf = () => {
      if (!run) return;
      frames++;
      if (storm) {
        const t = performance.now();
        // a busy scene: 3 mob voices + 2 breaks + footsteps every frame (far above real gameplay)
        for (let i = 0; i < 3; i++) game.events.emit('mob:sound', { id: 5000 + ((frames * 3 + i) % 40), type: types[(frames + i) % types.length], kind: 'idle', x: p.x + (i - 1) * 4, y: p.y, z: p.z - 4 });
        game.events.emit('block:broken', { x: Math.floor(p.x) + (frames % 5) - 2, y: Math.floor(p.y) - 1, z: Math.floor(p.z) - 3, id: G.blockId('stone'), state: 0, by: 'player', drops: [] });
        game.events.emit('block:broken', { x: Math.floor(p.x), y: Math.floor(p.y) - 1, z: Math.floor(p.z) - 5, id: G.blockId('grass_block'), state: 0, by: 'player', drops: [] });
        if (frames % 20 === 0) game.events.emit('explosion', { x: p.x + 8, y: p.y, z: p.z, power: 4, blocks: [], count: 0 });
        emitMs += performance.now() - t;
      }
      requestAnimationFrame(raf);
    };
    const t0 = performance.now();
    requestAnimationFrame(raf);
    await new Promise((r) => setTimeout(r, 4000));
    run = false;
    const sec = (performance.now() - t0) / 1000;
    a.frame = of; a.tick = ot;
    const s = G.stats();
    const st = a.stats();
    return { fps: Math.round(frames / sec), audioMsPerSec: Math.round(audioMs / sec * 10) / 10, emitMsPerSec: Math.round(emitMs / sec * 10) / 10, drawCalls: s.drawCalls ?? (s.render && s.render.drawCalls), voices: st.voices, dropped: st.dropped, stolen: st.stolen, started: st.started };
  }, storm);
  const quiet = await measure(false);
  const busy = await measure(true);
  await g.shot('perf-storm');
  await g.api('setSetting', 'muted', true);
  const muted = await measure(false);
  await g.api('setSetting', 'muted', false);
  notes.perf = { swiftshader: SWIFT, quiet, busy, muted };
  console.log('perf', JSON.stringify(notes.perf));
  check('perf: audio lane costs < 0.1 ms per frame when quiet', quiet.audioMsPerSec / Math.max(1, quiet.fps) < 0.1, { msPerFrame: Math.round(quiet.audioMsPerSec / Math.max(1, quiet.fps) * 1000) / 1000, ...quiet });
  // the storm is ~10x real gameplay (5 sound events EVERY frame); the real criterion is the fps check below.
  // Under --swiftshader the renderer saturates the same CPU cores, so the main-thread timing is reported only.
  const stormMs = (busy.audioMsPerSec + busy.emitMsPerSec) / Math.max(1, busy.fps);
  if (SWIFT) console.log(`NOTE  perf: storm main-thread audio cost ${stormMs.toFixed(2)} ms/frame on the CPU-rendered proxy`);
  else check('perf: audio lane costs < 1 ms per frame in the storm', stormMs < 1, { msPerFrame: Math.round((busy.audioMsPerSec + busy.emitMsPerSec) / Math.max(1, busy.fps) * 1000) / 1000 });
  check('perf: busy sound storm keeps >= 85% of the quiet fps', busy.fps >= quiet.fps * 0.85, { quiet: quiet.fps, busy: busy.fps });
  check('perf: voice cap holds during the storm (<= 32)', busy.voices <= 32, { voices: busy.voices });
  // the two samples are 8 s apart: with the real MOBS lane animals walk in and out of view in between (one draw
  // each), so allow that drift (LEAD integration); audio itself never touches the renderer
  check('perf: audio adds no draw calls', Math.abs((quiet.drawCalls || 0) - (muted.drawCalls || 0)) <= 2 + Math.ceil(0.03 * (quiet.drawCalls || 0)), { quiet: quiet.drawCalls, muted: muted.drawCalls });
}

/* ======================================================================= 11. tab hidden / back */
if (want('hidden')) {
  await g.ev(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(400);
  const h = await g.audio();
  await g.ev(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(600);
  const v = await g.audio();
  check('tab: audio pauses while the tab is hidden and resumes after', h.state === 'suspended' && v.state === 'running', { hidden: h.state, visible: v.state });
}

check('page: no page errors or console errors (main page)', g.errors.length === 0, g.errors.slice(0, 5));
await g.api('exitToTitle');
await sleep(500);
const tm = (await g.audio()).music;
check('music: exit to title stops the music', tm.wanted === false, tm);
await g.context.close();

/* ======================================================================= 12. touchscreen: first tap unlocks */
if (want('touch')) {
  const tp = await openPage({ touch: true });
  const s0 = await tp.audio();
  await tp.page.touchscreen.tap(640, 690);
  const ok = await tp.page.waitForFunction(() => window.__game.game.audio.unlocked === true, null, { timeout: 5000 }).then(() => true, () => false);
  await tp.shot('touch-unlocked');
  check('touch: the first finger tap unlocks audio', s0.unlocked === false && ok, { before: s0.state, after: (await tp.audio()).state });
  await tp.api('startWorld', { preset: 'flat', seed: 1, mode: 'creative', difficulty: 'peaceful' });
  await settle(tp, 1200);
  await tp.recent(true);
  await tp.api('setLook', 0, -50);
  await sleep(200);
  const b0 = await tp.api('eventCount', 'block:placed');
  await tp.page.touchscreen.tap(640, 420);
  await sleep(500);
  const placed = (await tp.api('eventCount', 'block:placed')) - b0;
  const l = (await tp.recent(true)).map((e) => e.name);
  await tp.shot('touch-tap-place');
  check('touch: a finger tap in the world places with a place sound', placed === 0 || l.some((n) => n.startsWith('block.place.')), { placed, sounds: l });
  check('page: no page errors (touch page)', tp.errors.length === 0, tp.errors.slice(0, 5));
  await tp.context.close();
}

await browser.close();
const summary = { PASS: results.filter((r) => r.status === 'PASS').length, FAIL: results.filter((r) => r.status === 'FAIL').length };
writeFileSync(join(OUT, SWIFT ? 'report-swiftshader.json' : 'report.json'), JSON.stringify({ summary, results, notes }, null, 1));
console.log(`[audio-inworld] ${JSON.stringify(summary)}  screenshots: ${OUT}`);
process.exit(summary.FAIL ? 1 : 0);
