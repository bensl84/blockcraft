// OWNER LANE: FEATURE-MOBS. In-world playtest of mobs / entities / survival through the REAL core, driven the
// way a child plays: real page.mouse taps and holds on the animal's pixels (kid scheme: tap = use, hold = hit),
// real keyboard (W to walk, digits for the hotbar, C to get off, Space to jump), plus window.__game for setup
// and checks. Screenshots go to .tmp/mobs-play/<section>-<step>.png.
//
//   node build.mjs --dev --out .tmp/build-mobs
//   node tools/mobs-play.mjs                 all sections
//   node tools/mobs-play.mjs gallery taps    some sections
//   node tools/mobs-play.mjs --swiftshader perf
//   node tools/mobs-play.mjs --touch touch    (touchscreen taps; the touch section is skipped without --touch)
import { open } from './mobs-play-lib.mjs';

const argv = process.argv.slice(2);
const swiftshader = argv.includes('--swiftshader');
const touch = argv.includes('--touch');
const only = argv.filter((a) => !a.startsWith('--'));
const g = await open({ swiftshader, touch });
const { call, ev, shot, check, page } = g;
const W = 1280, H = 720;

const FLAT = { preset: 'flat', seed: 1, mode: 'creative', difficulty: 'peaceful', rules: { passiveMobs: false } };

/* ------------------------------------------------------------------ helpers */
const spawn = (type, dx, dz, opts = {}) => ev(({ type, dx, dz, opts }) => {
  const gm = window.__game.game, p = gm.player;
  const e = gm.mobs.spawnMob(type, p.x + dx, p.y, p.z + dz, opts);
  return e ? e.id : null;
}, { type, dx, dz, opts });
const ent = (id) => ev((id) => { const e = window.__game.game.entities.get(id); return e ? { id, type: e.type, x: e.x, y: e.y, z: e.z, h: e.height, health: e.health, hurtTime: e.hurtTime, vy: e.vy, onGround: e.onGround, removed: e.removed, data: JSON.parse(JSON.stringify(e.data)) } : null; }, id);
const freezeAll = () => ev(() => { for (const e of window.__game.game.entities.all()) if (e.data) { e.__tick = e.tick; e.tick = function () { this.age++; }; } });
const evCount = (n) => call('eventCount', n);
/** Pixel position of an entity's middle on the canvas (or null when off screen). */
async function screenOf(id, fy = 0.5) {
  const e = await ent(id);
  if (!e) return null;
  const n = await call('worldToNdc', e.x, e.y + e.h * fy, e.z);
  if (!n.onScreen) return null;
  return { x: Math.round((n.x + 1) / 2 * W), y: Math.round((1 - n.y) / 2 * H) };
}
/** Child taps the animal (kid scheme: a short click = use). */
async function tapEntity(id, fy = 0.5) {
  const s = await screenOf(id, fy);
  if (!s) { console.log(`  (tap: entity ${id} is off screen)`); return false; }
  await page.mouse.click(s.x, s.y, { delay: 60 });
  await call('waitTicks', 3);
  if (process.env.MOBS_PLAY_DEBUG) console.log('  tap', id, s, JSON.stringify(await ev(() => { const gm = window.__game.game, te = gm.interaction.targetEntity; return { te: te && te.entity.id, type: te && te.entity.type, sel: gm.inventory.getSelected(), pos: [gm.player.x, gm.player.y, gm.player.z].map((v) => +v.toFixed(2)) }; })));
  return true;
}
/** Child holds the mouse on the animal (kid scheme: hold = hit). */
async function holdEntity(id, ms = 600) {
  const s = await screenOf(id);
  if (!s) return false;
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await call('waitTicks', 2);
  return true;
}
async function key(code, ms = 80) { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); await call('waitTicks', 1); }
async function holdKey(code, ms) { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); await call('waitTicks', 1); }
// number keys select the hotbar through the HUD lane (a stub today), so the slot is also selected via the API
async function hotbar(slot, item, count = 1) { await call('setSlot', slot, item, count); await key('Digit' + (slot + 1)); await call('selectSlot', slot); }
async function face(id, dist = 3, yawDeg = 0, fy = 0.5) {
  // stand dist blocks away from the entity, looking at it
  const e = await ent(id);
  const yaw = yawDeg * Math.PI / 180;
  await call('teleport', e.x + Math.sin(yaw) * dist, e.y, e.z + Math.cos(yaw) * dist);
  await call('waitTicks', 2);
  await call('lookAt', e.x, e.y + e.h * fy, e.z);
}
/** New clean patch of the flat world for the next mini-test: other entities removed, player moved 40 blocks east. */
let freshX = 0;
async function fresh() {
  freshX += 40;
  await ev(() => { const gm = window.__game.game; if (gm.player.riding) gm.player.riding = null; for (const e of gm.entities.all()) gm.entities.remove(e, 'test'); });
  // the flat preset has trees and flowers: clear a 17 x 17 patch so nothing stands between the child and the animal
  await ev((X) => { const gm = window.__game.game, G = window.__game.blockId('grass_block');
    for (let x = X - 8; x <= X + 8; x++) for (let z = -8; z <= 8; z++) { gm.world.setBlock(x, 3, z, G, 0, { cause: 'test' }); for (let y = 4; y <= 12; y++) if (gm.world.getBlock(x, y, z)) gm.world.setBlock(x, y, z, 0, 0, { cause: 'test' }); } }, freshX);
  await call('teleport', freshX + 0.5, 4, 0.5);
  await call('waitTicks', 5); await call('setLook', 0, 0);
}
async function settle(n = 6) { await call('waitFrames', n); }
async function startFlat(extra = {}) {
  await call('startWorld', { ...FLAT, ...extra, rules: { ...FLAT.rules, ...(extra.rules || {}) } });
  await call('setFlying', false);
  await call('waitTicks', 5);
  await call('setTime', 6000);
}
async function drawDelta() {
  const vis = (v) => ev((v) => { for (const e of window.__game.game.entities.all()) if (e.object3d) e.object3d.visible = v; }, v);
  await vis(false); await settle(3);
  const a = (await call('stats')).drawCalls;
  await vis(true); await settle(3);
  const b = (await call('stats')).drawCalls;
  return b - a;
}

/* ------------------------------------------------------------------ sections */
const SECTIONS = {
  /** All mobs in the real world: day, night, torch-lit night, babies close up, draw calls. */
  async gallery() {
    await startFlat({ difficulty: 'easy', rules: { hostileMobs: true } });
    const p = await call('pos');
    const ids = await ev(({ x, y, z }) => {
      const gm = window.__game.game;
      const row = [['pig', { saddled: true }], ['cow', {}], ['sheep', { color: 'white' }], ['sheep', { color: 'pink' }], ['chicken', {}], ['wolf', {}], ['wolf', { tamedBy: 'player', sitting: true }],
        ['cat', {}], ['horse', { coat: 'chestnut' }], ['zombie', {}], ['skeleton', {}], ['creeper', {}], ['spider', {}]];
      const out = [];
      row.forEach(([type, o], i) => { const e = gm.mobs.spawnMob(type, x - 15 + i * 2.5, y, z - 9, o); if (e) out.push(e.id); });
      const babies = [['pig', {}], ['cow', {}], ['sheep', { color: 'light_blue' }], ['chicken', {}], ['wolf', {}]];
      babies.forEach(([type, o], i) => { const e = gm.mobs.spawnMob(type, x - 5 + i * 2.5, y, z - 5, { ...o, baby: true }); if (e) out.push(e.id); });
      return out;
    }, p);
    await freezeAll();
    await ev(() => { for (const e of window.__game.game.entities.all()) { e.yaw = e.prevYaw = Math.PI; e.headYaw = 0; } });
    await call('setLook', 0, -12);
    await call('waitTicks', 4); await settle();
    check(ids.length === 18, 'gallery: 18 mobs spawned in the real world', ids.length);
    const d = await drawDelta();
    check(d >= 1 && d <= ids.length, 'gallery: at most one draw call per mob with the real renderer (off-screen mobs are culled)', { entityDraws: d, mobs: ids.length });
    await shot('gallery-day');
    // close-ups: farm animals (left) and monsters (right)
    await call('teleport', p.x - 9, p.y, p.z - 4); await call('setLook', 0, -15); await settle(); await shot('gallery-closeup-farm');
    await call('teleport', p.x + 6, p.y, p.z - 4); await call('setLook', 0, -10); await settle(); await shot('gallery-closeup-monsters');
    await call('teleport', p.x, p.y, p.z + 4); await call('setLook', 0, -8); await settle(); await shot('gallery-all');
    await call('teleport', p.x, p.y, p.z); await call('setLook', 0, -12); await settle();
    const lumDay = await call('pixelStats');
    await call('setTime', 18000); await call('waitTicks', 4); await settle();
    await shot('gallery-night');
    const sky = await ev((id) => { const e = window.__game.game.entities.get(id); return e.object3d.material.uniforms.uLightSky.value; }, ids[1]);
    const dl = await ev(() => window.__game.game.renderer.uniforms.uDaylight.value);
    check(sky === 15 && dl < 0.2, 'gallery: night darkens mobs through the shared daylight uniform', { uLightSky: sky, uDaylight: dl });
    // torches next to the cow and the creeper: block light shows on them at night
    await ev(({ x, y, z }) => { const gm = window.__game.game, T = window.__game.blockId('torch'); gm.world.setBlock(Math.floor(x) - 12, Math.floor(y), Math.floor(z) - 8, T, 0, { cause: 'test' }); gm.world.setBlock(Math.floor(x) + 12, Math.floor(y), Math.floor(z) - 8, T, 0, { cause: 'test' }); }, p);
    await call('waitTicks', 4); await settle(10);
    const bl = await ev((id) => window.__game.game.entities.get(id).object3d.material.uniforms.uLightBlock.value, ids[1]);
    check(bl >= 10, 'gallery: torch light reaches the cow at night (uLightBlock)', bl);
    await shot('gallery-night-torches');
    await call('setTime', 6000);
    // babies close up
    await call('teleport', p.x, p.y, p.z - 1.5); await call('setLook', 0, -25); await settle();
    await shot('gallery-babies');
    return { lumDay };
  },

  /** Child-style taps with the real kid input: breeding, taming, shearing, dyeing, riding, boat, lead, spawn eggs. */
  async taps() {
    await startFlat();
    // --- breeding: wheat in slot 1, tap each cow
    const a = await spawn('cow', 1.5, -4), b = await spawn('cow', -1.5, -4);
    await freezeAll();
    await hotbar(0, 'wheat', 8);
    await call('teleport', 0.5, 4, 0.5); await call('lookAt', 0, 4.6, -4);
    const loveBefore = await evCount('mob:love');
    await tapEntity(a); await tapEntity(b);
    const loveN = (await evCount('mob:love')) - loveBefore;
    check(loveN === 2, 'taps: tapping two cows with wheat puts both in love (real mouse click, kid scheme)', loveN);
    await shot('taps-cows-in-love');
    await ev(() => { for (const e of window.__game.game.entities.all()) if (e.__tick) { e.tick = e.__tick; delete e.__tick; } });
    const bredBefore = await evCount('mob:bred');
    await call('runTicks', 200);
    check((await evCount('mob:bred')) - bredBefore === 1, 'taps: the two cows made a baby within 200 ticks');
    const baby = await ev(() => { const c = window.__game.game.entities.ofType('cow').find((e) => e.data.baby); return c ? c.id : null; });
    if (baby) { await face(baby, 3.5, 0, 0.3); await settle(); await shot('taps-baby-cow'); }

    await fresh();
    // --- wolf: bones until tamed, sits, tap to stand, follows when the child walks away
    await call('setRandomSeed', 99);
    const w = await spawn('wolf', 0, -3);
    await face(w, 3);
    await hotbar(1, 'bone', 16);
    let tamed = false, taps = 0;
    for (; taps < 16 && !tamed; taps++) { await tapEntity(w); tamed = (await ent(w)).data.tamed; }
    check(tamed, 'taps: wolf tamed by tapping it with bones', { taps });
    const wd = (await ent(w)).data;
    check(wd.sitting, 'taps: tamed wolf sits');
    await settle(); await shot('taps-wolf-tamed-sitting');
    await hotbar(1, null);
    await tapEntity(w, 0.6);
    check(!(await ent(w)).data.sitting, 'taps: tapping with an empty hand makes the wolf stand up');
    const w0 = await ent(w);
    await call('setLook', 180, 0);   // turn round and walk off (W held 2.5 s)
    await holdKey('KeyW', 2500);
    await call('runTicks', 40);
    const pw = await call('pos'), w1 = await ent(w);
    check(Math.hypot(w1.x - pw.x, w1.z - pw.z) < 6, 'taps: the wolf follows the child who walked away', { dist: +Math.hypot(w1.x - pw.x, w1.z - pw.z).toFixed(1), moved: +Math.hypot(w1.x - w0.x, w1.z - w0.z).toFixed(1) });
    await call('lookAt', w1.x, w1.y + 0.4, w1.z); await settle(); await shot('taps-wolf-follows');

    await fresh();
    // --- sheep: shears -> wool on the ground (real item meshes), walk over it to pick it up, dye it
    const s = await spawn('sheep', 0, -3, { color: 'white' });
    await face(s, 2.5);
    await hotbar(2, 'shears', 1);
    await tapEntity(s);
    const woolItems = await ev(() => window.__game.game.entities.ofType('item').length);
    check((await ent(s)).data.sheared && woolItems >= 1, 'taps: shears tap shears the sheep and drops wool items', woolItems);
    await call('runTicks', 15); await settle(); await shot('taps-sheep-sheared-wool');
    const woolBefore = await ev(() => window.__game.game.inventory.count('white_wool'));
    const sp = await ent(s);
    await call('lookAt', sp.x, sp.y, sp.z);
    await call('setLook', (await call('pos')).yaw, 0);
    await holdKey('KeyW', 1500);
    await call('runTicks', 30);
    const woolAfter = await ev(() => window.__game.game.inventory.count('white_wool'));
    check(woolAfter > woolBefore, 'taps: walking over the wool picks it up', { before: woolBefore, after: woolAfter });
    await ev((id) => { window.__game.game.entities.get(id).data.sheared = false; }, s);
    for (const c of ['red', 'yellow', 'blue']) { await face(s, 2.5); await hotbar(3, c + '_dye', 1); await tapEntity(s); await call('runTicks', 3); }
    check((await ent(s)).data.rainbow, 'taps: red + yellow + blue dye makes a rainbow sheep');
    await face(s, 3); await call('runTicks', 10); await settle(); await shot('taps-rainbow-sheep');

    await fresh();
    // --- pig: saddle, tap to ride, carrot on a stick steers, C gets off, tapping the pig also gets off
    const pig = await spawn('pig', 0, -3);
    await face(pig, 2.5);
    await hotbar(4, 'saddle', 1);
    await tapEntity(pig);
    check((await ent(pig)).data.saddled, 'taps: saddle tap saddles the pig');
    await hotbar(4, 'carrot_on_a_stick', 1);
    await tapEntity(pig, 0.7);
    check(await ev(() => window.__game.game.player.riding) === pig, 'taps: tapping the saddled pig gets the child on');
    await call('setLook', 90, -5);
    const r0 = await ent(pig);
    await call('waitTicks', 60);
    const r1 = await ent(pig), pr = await call('pos');
    check(Math.hypot(r1.x - r0.x, r1.z - r0.z) > 2, 'taps: carrot on a stick steers the pig where the child looks', +Math.hypot(r1.x - r0.x, r1.z - r0.z).toFixed(2));
    check(Math.abs(pr.x - r1.x) < 0.05 && Math.abs(pr.z - r1.z) < 0.05, 'taps: the rider sits exactly on the pig (no one-tick lag)', { dx: +(pr.x - r1.x).toFixed(3), dz: +(pr.z - r1.z).toFixed(3) });
    await settle(); await shot('taps-riding-pig');
    await call('setLook', (await call('pos')).yaw, -35); await settle(); await shot('taps-riding-pig-lookdown'); await call('setLook', (await call('pos')).yaw, -5);
    await key('KeyC', 120);
    check(await ev(() => window.__game.game.player.riding) === null, 'taps: C gets the child off the pig');
    await face(pig, 2.5); await tapEntity(pig, 0.7);
    const onAgain = await ev(() => window.__game.game.player.riding) === pig;
    await call('setLook', (await call('pos')).yaw, -60);
    await settle();
    await page.mouse.click(640, 600, { delay: 60 }); await call('waitTicks', 3);
    const offByTap = await ev(() => window.__game.game.player.riding) === null;
    check(onAgain && offByTap, 'taps: tapping the pig you ride (looking down at it) gets you off', { onAgain, offByTap });
    await key('Space'); await call('waitTicks', 10);

    await fresh();
    // --- horse: tap empty-handed to ride (temper taming), Space jumps, saddle, steer with W
    await call('setRandomSeed', 5);
    const hz = await spawn('horse', 0, -3, { coat: 'white' });
    await face(hz, 2.5);
    await hotbar(5, null);
    let horseTamed = false;
    for (let i = 0; i < 12 && !horseTamed; i++) {
      await face(hz, 2.5); await tapEntity(hz, 0.6); await call('runTicks', 60);
      horseTamed = (await ent(hz)).data.tamed;
    }
    check(horseTamed, 'taps: the horse is tamed by getting on it a few times');
    const stillOn = await ev(() => window.__game.game.player.riding) === hz;
    if (!stillOn) await face(hz, 2.5); else await call('setLook', (await call('pos')).yaw, -70);
    await hotbar(5, 'saddle', 1);
    if (stillOn) { await page.mouse.click(640, 560, { delay: 60 }); await call('waitTicks', 3); } else await tapEntity(hz, 0.6);
    check((await ent(hz)).data.saddled, 'taps: the tamed horse takes a saddle (tapped while sitting on it)', { stillOn });
    if (await ev(() => window.__game.game.player.riding) !== hz) { await hotbar(5, null); await face(hz, 2.5); await tapEntity(hz, 0.6); }
    check(await ev(() => window.__game.game.player.riding) === hz, 'taps: riding the saddled horse');
    await call('setLook', -90, -5);
    const h0 = await ent(hz);
    await holdKey('KeyW', 1500);
    const h1 = await ent(hz);
    check(Math.hypot(h1.x - h0.x, h1.z - h0.z) > 3, 'taps: W rides the horse forward', +Math.hypot(h1.x - h0.x, h1.z - h0.z).toFixed(2));
    await settle(); await shot('taps-riding-horse');
    await call('setLook', (await call('pos')).yaw, -30); await settle(); await shot('taps-riding-horse-lookdown'); await call('setLook', (await call('pos')).yaw, -5);
    await page.keyboard.down('Space'); await page.waitForTimeout(500); await page.keyboard.up('Space');
    let maxY = h1.y; for (let i = 0; i < 12; i++) { await call('waitTicks', 1); maxY = Math.max(maxY, (await ent(hz)).y); }
    check(maxY > h1.y + 0.8, 'taps: holding Space makes the horse jump', +(maxY - h1.y).toFixed(2));
    await key('KeyC', 120); await call('waitTicks', 10);

    await fresh();
    // --- boat on a pond: tap the water with the boat, tap the boat to get in, W paddles
    const q = await call('pos');
    const water = await call('blockId', 'water');
    await ev(({ x, z, water }) => { const gm = window.__game.game; for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) gm.world.setBlock(Math.floor(x) + i, 3, Math.floor(z) - 8 + j, water, 0, { cause: 'test' }); }, { ...q, water });
    await call('waitTicks', 3); await settle(4);
    await call('lookAt', Math.floor(q.x) + 0.5, 3.9, Math.floor(q.z) - 5.5);
    await hotbar(6, 'oak_boat', 1);
    const boatsBefore = await ev(() => window.__game.game.entities.ofType('boat').length);
    await page.mouse.click(640, 360, { delay: 60 }); await call('waitTicks', 3);
    const boatId = await ev(() => { const b = window.__game.game.entities.ofType('boat'); return b.length ? b[b.length - 1].id : null; });
    check(boatId && (await ev(() => window.__game.game.entities.ofType('boat').length)) === boatsBefore + 1, 'taps: tapping the water with a boat puts a boat on it');
    await call('runTicks', 30);
    const bt = await ent(boatId);
    check(bt && Math.abs(bt.y - 3.88) < 0.25, 'taps: the boat floats on the water surface', bt && +bt.y.toFixed(2));
    await settle(); await shot('taps-boat-on-water');
    await hotbar(6, null);
    await face(boatId, 2.5, 0, 0.5); await tapEntity(boatId, 0.5);
    check(await ev(() => window.__game.game.player.riding) === boatId, 'taps: tapping the boat gets the child in');
    await call('setLook', 0, -5);
    const b0 = await ent(boatId);
    await holdKey('KeyW', 1200);
    const b1 = await ent(boatId);
    check(Math.hypot(b1.x - b0.x, b1.z - b0.z) > 1, 'taps: W paddles the boat', +Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(2));
    await settle(); await shot('taps-in-boat');
    await call('setLook', (await call('pos')).yaw, -30); await settle(); await shot('taps-in-boat-lookdown'); await call('setLook', (await call('pos')).yaw, -5);
    await key('Space', 120);
    check(await ev(() => window.__game.game.player.riding) === null, 'taps: Space gets the child out of the boat');
    await call('waitTicks', 10);
    // classic scheme: Shift (sneak) gets off a pig
    await call('setSetting', 'controls', 'classic');
    const cp = await spawn('pig', 2, 2, { saddled: true });
    await ev((id) => window.__game.game.entities.get(id).mount(), cp);
    await call('waitTicks', 2);
    await key('ShiftLeft', 150);
    check(await ev(() => window.__game.game.player.riding) === null, 'taps: classic controls: Shift gets off the pig');
    await call('setSetting', 'controls', 'kid'); await call('waitTicks', 2);

    await fresh();
    // --- lead
    const cow2 = await spawn('cow', 3, 3);
    await face(cow2, 2.5);
    await hotbar(7, 'lead', 1);
    await tapEntity(cow2);
    check((await ent(cow2)).data.leashed, 'taps: lead tap ties the cow to the child');
    await call('setLook', 0, 0);
    await holdKey('KeyW', 1500); await call('runTicks', 20);
    const pc = await call('pos'), c2 = await ent(cow2);
    check(Math.hypot(c2.x - pc.x, c2.z - pc.z) < 6, 'taps: the leashed cow follows', +Math.hypot(c2.x - pc.x, c2.z - pc.z).toFixed(1));
    await call('setLook', 180, -10); await settle(); await shot('taps-lead');

    await fresh();
    // --- spawn eggs: on a block face and into the air
    await call('setLook', 0, -40); await settle(3);
    await hotbar(8, 'chicken_spawn_egg', 4);
    const chBefore = await ev(() => window.__game.game.entities.ofType('chicken').length);
    await page.mouse.click(640, 360, { delay: 60 }); await call('waitTicks', 3);
    await call('setLook', 0, 30); await settle(3);
    await page.mouse.click(640, 360, { delay: 60 }); await call('waitTicks', 3);
    const chAfter = await ev(() => window.__game.game.entities.ofType('chicken').length);
    check(chAfter === chBefore + 2, 'taps: a spawn egg tapped on the ground and into the sky makes a chicken each time', { chBefore, chAfter });
    await call('runTicks', 40); await call('setLook', 0, -20); await settle(); await shot('taps-spawn-egg-chickens');
  },

  /** Kid world: holding the mouse on an animal hits it: hop + squeak, never hurt, never dies. */
  async kidhit() {
    await startFlat();
    const pig = await spawn('pig', 0, -2.5);
    await face(pig, 2.5);
    await hotbar(0, null);
    const hurtBefore = await evCount('mob:hurt'), deathBefore = await evCount('mob:death'), brokeBefore = await evCount('block:broken');
    let hopped = false;
    for (let i = 0; i < 12; i++) {
      await face(pig, 2.5);
      const s = await screenOf(pig);
      await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.waitForTimeout(450);
      const e = await ent(pig); if (e.vy > 0.1 || !e.onGround) hopped = true;
      if (i === 2) { await settle(1); await shot('kidhit-pig-hop'); }
      // let the panic (100 ticks) run out so every hold starts on a calm pig (a panicking pig can run out from under
      // the cursor before the hold registers - a timing flake, not a mob defect)
      await page.mouse.up(); await call('waitTicks', 4); await call('runTicks', 100);
    }
    const e = await ent(pig);
    check(e && e.health === 10, 'kidhit: 12 holds on a pig in a kid world: health stays 10', e && e.health);
    check((await evCount('mob:hurt')) - hurtBefore >= 8, 'kidhit: the holds register as hits (squeak / panic)', (await evCount('mob:hurt')) - hurtBefore);
    check((await evCount('mob:death')) - deathBefore === 0, 'kidhit: no animal died');
    check(hopped, 'kidhit: the pig hops when hit');
    // CORE-E observation (not this lane): a hold that started on the animal keeps going after it hops away and
    // then breaks the ground under the cursor (kid creative breaks instantly)
    const broke = (await evCount('block:broken')) - brokeBefore;
    console.log(`  note: blocks broken by holds that started on the pig: ${broke}`);
  },

  /** Survival through the real player: fall damage, drowning, lava, eating with a tap, death + respawn. */
  async survival() {
    await call('startWorld', { preset: 'flat', seed: 1, mode: 'survival', difficulty: 'easy', rules: { passiveMobs: false, hostileMobs: false } });
    await call('setFlying', false); await call('waitTicks', 5);
    const p = await call('pos');
    // fall: 10 blocks onto grass -> 7 HP (read straight after landing, before regeneration)
    await ev(() => { const gm = window.__game.game; gm.__hurts = []; gm.events.on('player:hurt', (e) => gm.__hurts.push({ amount: e.amount, cause: e.cause, tick: gm.tickCount })); });
    await call('teleport', p.x, p.y + 10, p.z);
    await call('runTicks', 40);
    let hurts = await ev(() => window.__game.game.__hurts);
    check(hurts.some((h) => h.cause === 'fall' && h.amount === 7), 'survival: a real 10-block fall costs 7 HP', hurts);
    // hay bale softens
    await ev(() => { window.__game.game.__hurts.length = 0; window.__game.game.player.health = 20; });
    await call('setBlock', Math.floor(p.x), 3, Math.floor(p.z), 'hay_block');
    await call('teleport', p.x, p.y + 10, p.z); await call('runTicks', 40);
    hurts = await ev(() => window.__game.game.__hurts);
    check(hurts.some((h) => h.cause === 'fall' && h.amount === 2), 'survival: landing on hay costs 2 instead of 7', hurts);
    // drowning: 3 deep water column, stand at the bottom
    await ev(() => { window.__game.game.__hurts.length = 0; window.__game.game.player.health = 20; });
    const W0 = { x: Math.floor(p.x) + 10, z: Math.floor(p.z) };
    await ev(({ x, z }) => { const gm = window.__game.game, Wt = window.__game.blockId('water'), S = window.__game.blockId('stone');
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let y = 1; y <= 7; y++) gm.world.setBlock(x + i, y, z + j, (Math.abs(i) === 2 || Math.abs(j) === 2) ? S : Wt, 0, { cause: 'test' }); }, W0);
    await call('teleport', W0.x + 0.5, 1, W0.z + 0.5);
    await call('runTicks', 2);
    const under = await call('pos');
    check(under.eyeInWater, 'survival: player eye is under water at the bottom of the pool', { eyeInWater: under.eyeInWater, y: under.y });
    await call('runTicks', 340);
    const drown = await call('pos');
    hurts = await ev(() => window.__game.game.__hurts);
    check(drown.air <= 0 && hurts.some((h) => h.cause === 'drown'), 'survival: air runs out after ~15 s and then drowning hurts', { air: drown.air, health: drown.health });
    await settle(); await shot('survival-underwater');
    // lava
    await ev(() => { window.__game.game.__hurts.length = 0; window.__game.game.player.health = 20; });
    const L = { x: Math.floor(p.x) - 10, z: Math.floor(p.z) };
    await ev(({ x, z }) => { const gm = window.__game.game, Lv = window.__game.blockId('lava'); gm.world.setBlock(x, 3, z, Lv, 0, { cause: 'test' }); }, L);
    await call('teleport', L.x + 0.5, 3.2, L.z + 0.5);
    await call('runTicks', 20);
    hurts = await ev(() => window.__game.game.__hurts);
    const lp = await call('pos');
    check(lp.inLava && hurts.some((h) => h.cause === 'lava'), 'survival: standing in lava hurts', { inLava: lp.inLava, causes: [...new Set(hurts.map((h) => h.cause))] });
    await ev(({ x, z }) => window.__game.game.world.setBlock(x, 3, z, window.__game.blockId('grass_block'), 0, { cause: 'test' }), L);
    await call('teleport', p.x, 4, p.z); await call('runTicks', 200);
    // eat bread with one tap in the air
    await ev(() => { const gm = window.__game.game; gm.player.food = 10; gm.player.saturation = 0; gm.player.fireTicks = 0; });
    await hotbar(0, 'bread', 2);
    await call('setLook', 0, 30); await settle(2);
    const ateBefore = await evCount('player:ate');
    await page.mouse.click(640, 200, { delay: 60 });
    await call('runTicks', 40);
    const fed = await call('pos');
    check((await evCount('player:ate')) - ateBefore === 1 && fed.food === 15, 'survival: one tap with bread eats it (+5 hunger)', { food: fed.food });
    // death + respawn
    await ev(() => { const gm = window.__game.game; gm.inventory.set(5, { item: 'diamond', count: 2 }); gm.survival.damage(99, 'mob'); });
    await settle(2); await shot('survival-death');
    await call('runTicks', 30);
    const rp = await call('pos');
    check(rp.health === 20 && !(await ev(() => window.__game.game.player.dead)) && (await ev(() => window.__game.game.inventory.count('diamond'))) === 2, 'survival: death -> respawn full, inventory kept', { health: rp.health, y: rp.y });
    await settle(); await shot('survival-respawned');
  },

  /** Natural spawning with real worldgen + lighting: biomes, light rules, monsters at night and in caves, sun burning. */
  async spawning() {
    await call('startWorld', { preset: 'default', seed: 12345, mode: 'survival', difficulty: 'easy' });
    await call('waitTicks', 20);
    const animals = await ev(() => {
      const gm = window.__game.game, out = {}, bad = [];
      for (const e of gm.entities.all()) {
        if (!e.data || e.category === 'monster') continue;
        out[e.type] = (out[e.type] || 0) + 1;
        const below = gm.world.getBlock(Math.floor(e.x), Math.floor(e.y - 0.01), Math.floor(e.z));
        const light = gm.world.getSkyLight(Math.floor(e.x), Math.floor(e.y + 0.5), Math.floor(e.z));
        const col = gm.world.getColumn(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4);
        if (e.data.wild && e.age < 100 && light < 9 && !(e.def && e.def.water)) bad.push({ type: e.type, light });   // fish live under water
        void below; void col;
      }
      return { out, bad };
    });
    check(Object.keys(animals.out).length >= 3 && animals.bad.length === 0, 'spawning: chunk-gen animals of several kinds, land animals all on sky-lit ground', animals);
    // biome check: where did wolves / horses spawn
    const byBiome = await ev(() => {
      const gm = window.__game.game, r = {};
      for (const e of gm.entities.all()) {
        if (!e.data || !e.data.wild) continue;
        const col = gm.world.getColumn(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4);
        const bi = col && col.biomes ? col.biomes[(Math.floor(e.z) & 15) * 16 + (Math.floor(e.x) & 15)] : -1;
        const k = e.type; (r[k] = r[k] || new Set()).add(bi);
      }
      const o = {}; for (const k in r) o[k] = [...r[k]]; return o;
    });
    console.log('  animals by biome id', JSON.stringify(byBiome));
    // night: monsters spawn in the dark around the player (positions and light recorded at the moment of spawning)
    await ev(() => { const gm = window.__game.game; gm.__nat = []; gm.events.on('entity:spawn', (e) => { if (e.reason !== 'natural') return; const en = gm.entities.get(e.id), p = gm.player; if (!en || en.category !== 'monster') return;
      const l = gm.world.getLight(Math.floor(en.x), Math.floor(en.y), Math.floor(en.z)); gm.__nat.push({ type: en.type, d: Math.round(Math.hypot(en.x - p.x, en.y - p.y, en.z - p.z)), sky: l >> 4, block: l & 15, t: gm.time.dayTime }); }); });
    await call('setTime', 18000);
    let mons = 0;
    for (let i = 0; i < 20 && mons < 6; i++) { await call('runTicks', 100); mons = await ev(() => window.__game.game.mobs.counts().monster); }
    const nat = await ev(() => window.__game.game.__nat);
    check(nat.length > 0 && nat.every((m) => m.d >= 24 && m.block === 0), 'spawning: at night monsters appear 24+ blocks away, never in block light', { n: nat.length, sample: nat.slice(0, 6) });
    // bring one zombie close and look at it at night
    const z = await ev(() => { const gm = window.__game.game, p = gm.player; const e = gm.mobs.spawnMob('zombie', p.x, p.y, p.z - 5, {}); return e ? e.id : null; });
    if (z) { await call('lookAt', ...(await ev((id) => { const e = window.__game.game.entities.get(id); return [e.x, e.y + 1.2, e.z]; }, z))); await settle(); await shot('spawning-zombie-night'); }
    // morning: zombies and skeletons under the open sky catch fire; ones in the shade do not
    // morning: record every ignition with the sky light at the mob's eye at that very tick
    await ev(() => { const gm = window.__game.game; gm.__ign = [];
      for (const e of gm.entities.all()) if (e.def && e.def.burnsInSun) { const orig = e.tickEnvironment.bind(e);
        e.tickEnvironment = function () { const f0 = this.fireTicks; orig(); if (this.fireTicks > f0 + 1 && !this.inLava) gm.__ign.push({ type: this.type, sky: gm.world.getSkyLight(Math.floor(this.x), Math.floor(this.y + this.eyeHeight), Math.floor(this.z)) }); }; } });
    const undead = await ev(() => window.__game.game.entities.all().filter((e) => e.def && e.def.burnsInSun && !e.inWater).map((e) => window.__game.game.world.getSkyLight(Math.floor(e.x), Math.floor(e.y + e.eyeHeight), Math.floor(e.z))));
    await call('setTime', 1000);
    await call('runTicks', 60);
    const ign = await ev(() => window.__game.game.__ign);
    check(ign.length > 0 && ign.every((i) => i.sky >= 15), 'spawning: in the morning undead catch fire only under the open sky (sky light 15 at the eye)', { undead: undead.length, underOpenSky: undead.filter((v) => v >= 15).length, ignitions: ign.length, skies: ign.map((i) => i.sky) });
    const left = await ev(() => window.__game.game.mobs.counts().monster);
    console.log('  monsters left after a sunny morning', left);
  },

  /** Cave: monster light rule, mobs dark in caves, torches light mobs. */
  async cave() {
    await call('startWorld', { preset: 'flat', seed: 1, mode: 'creative', difficulty: 'easy', rules: { passiveMobs: false, hostileMobs: false } });
    await call('setFlying', false); await call('waitTicks', 5);
    const p = await call('pos');
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    // a closed stone room 9x4x9 on the ground
    await ev(({ bx, bz }) => { const gm = window.__game.game, S = window.__game.blockId('stone');
      for (let x = -5; x <= 5; x++) for (let z = -12; z <= -2; z++) for (let y = 4; y <= 8; y++) {
        const wall = x === -5 || x === 5 || z === -12 || z === -2 || y === 8;
        gm.world.setBlock(bx + x, y, bz + z, wall ? S : 0, 0, { cause: 'test' });
      } }, { bx, bz });
    await call('waitTicks', 5);
    const cow = await ev(({ bx, bz }) => window.__game.game.mobs.spawnMob('cow', bx + 0.5, 4, bz - 7.5, {}).id, { bx, bz });
    await freezeAll();
    await call('teleport', bx + 0.5, 4, bz - 3.5); await call('lookAt', bx + 0.5, 4.7, bz - 7.5);
    await call('waitTicks', 3); await settle(8);
    const dark = await ev((id) => { const u = window.__game.game.entities.get(id).object3d.material.uniforms; return { sky: u.uLightSky.value, block: u.uLightBlock.value }; }, cow);
    check(dark.sky === 0 && dark.block === 0, 'cave: a cow in a closed room gets no light', dark);
    await shot('cave-dark-cow');
    await call('setBlock', bx + 2, 4, bz - 7, 'torch'); await call('waitTicks', 3); await settle(8);
    const lit = await ev((id) => { const u = window.__game.game.entities.get(id).object3d.material.uniforms; return { sky: u.uLightSky.value, block: u.uLightBlock.value }; }, cow);
    check(lit.block >= 9, 'cave: a torch 3 blocks away lights the cow (torch 14 - distance)', lit);
    await shot('cave-torch-cow');
  },

  /** Real block shapes: a fence pen holds animals, mobs walk up slabs and stairs, float in water, slide on ice. Bow. */
  async terrain() {
    await startFlat();
    await fresh();
    const X = freshX;
    // fence ring 9 x 9 (connection bits computed like CORE-E's placement: bit 1 << FACING per fence neighbour)
    await ev((X) => {
      const gm = window.__game.game, F = window.__game.blockId('oak_fence');
      const cells = [];
      for (let i = -4; i <= 4; i++) { cells.push([X + i, -4], [X + i, 4]); if (Math.abs(i) < 4) cells.push([X - 4, i], [X + 4, i]); }
      for (const [x, z] of cells) gm.world.setBlock(x, 4, z, F, 0, { cause: 'test' });
      const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      for (const [x, z] of cells) { let st = 0; D.forEach(([dx, dz], f) => { if (gm.world.getBlock(x + dx, 4, z + dz) === F) st |= 1 << f; }); gm.world.setBlock(x, 4, z, F, st, { cause: 'test' }); }
    }, X);
    const pen = await ev((X) => { const gm = window.__game.game; return ['cow', 'sheep', 'pig', 'chicken', 'cow', 'sheep'].map((t, i) => gm.mobs.spawnMob(t, X - 2 + (i % 3) * 2, 4, -1 + Math.floor(i / 3) * 2, {}).id); }, X);
    await call('teleport', X + 0.5, 4, 7.5); await call('setLook', 0, -25);
    let escaped = 0, maxR = 0;
    for (let k = 0; k < 20; k++) {
      await call('runTicks', 150);
      const r = await ev(({ ids, X }) => ids.map((id) => { const e = window.__game.game.entities.get(id); return e ? Math.max(Math.abs(e.x - (X + 0.5)), Math.abs(e.z - 0.5)) : 0; }), { ids: pen, X });
      maxR = Math.max(maxR, ...r); escaped = Math.max(escaped, r.filter((v) => v > 4).length);
    }
    check(escaped === 0, 'terrain: 6 animals stay inside a fence pen for 3000 ticks (1.5-high fence collision)', { escaped, maxDistFromCentre: +maxR.toFixed(2) });
    await settle(); await shot('terrain-fence-pen');

    // slab + stairs: a pig follows a carrot up a slab step and a stairs step onto a 1-block platform
    await fresh();
    const Y = freshX;
    await ev((Y) => { const gm = window.__game.game, S = window.__game.blockId('oak_slab'), T = window.__game.blockId('oak_stairs'), P = window.__game.blockId('oak_planks');
      for (let x = Y - 2; x <= Y + 2; x++) { gm.world.setBlock(x, 4, -3, S, 0, { cause: 'test' }); for (let z = -7; z <= -4; z++) gm.world.setBlock(x, 4, z, P, 0, { cause: 'test' }); }
    }, Y);
    const pig = await ev((Y) => window.__game.game.mobs.spawnMob('pig', Y + 0.5, 4, 0.5, {}).id, Y);
    await call('teleport', Y + 0.5, 5, -6.5);
    await hotbar(0, 'carrot', 4);
    let up = false;
    for (let i = 0; i < 20 && !up; i++) { await call('runTicks', 10); up = (await ent(pig)).y >= 4.99; }
    check(up, 'terrain: a pig follows a carrot up a slab onto a 1-block platform', (await ent(pig)).y);
    await call('setLook', 180, -30); await settle(); await shot('terrain-slab-step');

    // water: a cow dropped in a deep pool floats up and swims out
    await fresh();
    const Z = freshX;
    await ev((Z) => { const gm = window.__game.game, W = window.__game.blockId('water');
      for (let x = Z - 3; x <= Z + 3; x++) for (let z = -8; z <= -2; z++) for (let y = 1; y <= 3; y++) gm.world.setBlock(x, y, z, W, 0, { cause: 'test' }); }, Z);
    const cow = await ev((Z) => window.__game.game.mobs.spawnMob('cow', Z + 0.5, 1.2, -4.5, {}).id, Z);
    let topY = -1;
    for (let i = 0; i < 10; i++) { await call('runTicks', 10); topY = Math.max(topY, (await ent(cow)).y); }
    check(topY > 2.6, 'terrain: a cow in 3-deep water floats up to the surface (real fluidState)', +topY.toFixed(2));
    await call('teleport', Z + 0.5, 4, 1.5); await call('lookAt', Z + 0.5, 3.5, -4.5); await settle(); await shot('terrain-cow-swims');
    let out = false;
    for (let i = 0; i < 60 && !out; i++) { await call('runTicks', 20); const c = await ent(cow); out = c.y >= 3.99 && c.onGround; }
    check(out, 'terrain: the cow climbs out of the pool onto the grass within 60 s');

    // ice: a pig on ice keeps sliding (slip 0.98)
    await fresh();
    const I = freshX;
    await ev((I) => { const gm = window.__game.game, C = window.__game.blockId('ice'); for (let x = I - 6; x <= I + 6; x++) for (let z = -6; z <= 6; z++) gm.world.setBlock(x, 3, z, C, 0, { cause: 'test' }); }, I);
    const ip = await ev((I) => { const gm = window.__game.game, e = gm.mobs.spawnMob('pig', I + 0.5, 4, 0.5, {}); e.vx = 0.4; return e.id; }, I);
    await call('runTicks', 1);
    const i0 = await ent(ip);
    await call('runTicks', 20);
    const i1 = await ent(ip);
    check(Math.abs(i1.x - i0.x) > 1.5 && i1.onGround, 'terrain: a pushed pig slides on ice', +(i1.x - i0.x).toFixed(2));

    // bow in survival: arrows fly along the aim ray and hurt a zombie
    await call('startWorld', { preset: 'flat', seed: 1, mode: 'survival', difficulty: 'easy', rules: { passiveMobs: false, hostileMobs: true } });
    await call('setFlying', false); await call('waitTicks', 5); freshX = 0; await fresh();
    await call('setTime', 18000);
    const zb = await ev(() => { const gm = window.__game.game, p = gm.player; const e = gm.mobs.spawnMob('zombie', p.x, p.y, p.z - 8, {}); e.tick = function () { this.age++; if (this.hurtTime > 0) this.hurtTime--; if (this.invuln > 0) this.invuln--; }; return e.id; });
    await call('setSlot', 1, 'arrow', 16);
    await hotbar(0, 'bow', 1);
    const zb0 = await ent(zb);
    await call('lookAt', zb0.x, zb0.y + 1.4, zb0.z);
    await page.mouse.click(640, 360, { delay: 60 });
    let hitZ = false;
    for (let i = 0; i < 10 && !hitZ; i++) { await call('runTicks', 2); const z1 = await ent(zb); hitZ = !z1 || z1.health < 20; }
    check(hitZ, 'terrain: a bow tap shoots an arrow along the aim and hits the zombie 8 blocks away');
    check(await ev(() => window.__game.game.inventory.count('arrow')) === 15, 'terrain: the shot used one arrow');
  },

  /** Touchscreen: finger taps feed and ride, a long press hits (kid gestures accept touch pointers). */
  async touch() {
    if (!touch) { console.log('  (skipped: run with --touch)'); return; }
    await startFlat();
    await fresh();
    const a = await spawn('cow', 1.5, -4), b = await spawn('cow', -1.5, -4);
    await freezeAll();
    await hotbar(0, 'wheat', 8);
    await call('lookAt', freshX + 0.5, 4.6, -3.5);
    const love0 = await evCount('mob:love');
    for (const id of [a, b]) { const s = await screenOf(id); await page.touchscreen.tap(s.x, s.y); await call('waitTicks', 3); }
    check((await evCount('mob:love')) - love0 === 2, 'touch: finger taps feed both cows');
    const pig = await spawn('pig', 0, -2.5, { saddled: true });
    await face(pig, 2.5);
    await hotbar(1, null);
    const s = await screenOf(pig, 0.7);
    await page.touchscreen.tap(s.x, s.y); await call('waitTicks', 3);
    check(await ev(() => window.__game.game.player.riding) === pig, 'touch: a finger tap on a saddled pig gets the child on');
    await call('setLook', (await call('pos')).yaw, -60); await settle(3);
    await page.touchscreen.tap(640, 600); await call('waitTicks', 3);
    check(await ev(() => window.__game.game.player.riding) === null, 'touch: tapping the pig you ride gets you off (no Down button needed)');
    await shot('touch-after-ride');
  },

  /** Performance with the real world: R 8 default world, 24 animals, mob tick and draw calls. */
  /** Judge round-1 findings, played like a child (real mouse taps, real keys). */
  async judge1() {
    await startFlat();
    const unfreeze = () => ev(() => { for (const e of window.__game.game.entities.all()) if (e.__tick) { e.tick = e.__tick; delete e.__tick; } });
    // KID-3: saddle a pig, then keep tapping with the saddle still in her hand -> she rides
    const pig = await spawn('pig', 0, -3);
    await freezeAll();
    await face(pig, 2.5);
    await hotbar(0, 'saddle', 1);
    await tapEntity(pig);
    check((await ent(pig)).data.saddled && (await ev(() => window.__game.game.player.riding)) === null, 'KID-3: first saddle tap saddles the pig (no ride yet)');
    await tapEntity(pig);
    check((await ev(() => window.__game.game.player.riding)) === pig, 'KID-3: second tap with the saddle still in hand rides the saddled pig');
    await unfreeze(); await settle(); await shot('judge1-kid3-riding-saddle-in-hand');
    await key('KeyC', 150);
    check((await ev(() => window.__game.game.player.riding)) === null, 'KID-3: C gets off again');

    // KID-6: petting with an empty hand (and with a block) -> idle voice, a heart, it looks at her; no love mode
    await fresh();
    const sheep = await spawn('sheep', 0, -2.5, { color: 'white' });
    await freezeAll();
    await face(sheep, 2.5);
    await hotbar(0, null);
    const pet0 = await evCount('mob:petted'), snd0 = await ev(() => window.__game.game.events.recent('mob:sound', 50).filter((e) => e.payload.kind === 'idle').length);
    await unfreeze();
    await tapEntity(sheep);
    const sd = await ent(sheep);
    check((await evCount('mob:petted')) - pet0 === 1 && !(sd.data.love > 0) && sd.health === 8, 'KID-6: empty-hand tap pets the sheep (event, no love, no hurt)', { love: sd.data.love || 0, health: sd.health });
    check((await ev(() => window.__game.game.events.recent('mob:sound', 50).filter((e) => e.payload.kind === 'idle').length)) > snd0, 'KID-6: petting plays the idle voice');
    await settle(4); await shot('judge1-kid6-pet-sheep');
    const looks = await ev((id) => { const e = window.__game.game.entities.get(id); return { petTicks: e.petTicks, target: e.target }; }, sheep);
    check(looks.petTicks > 0 && looks.target === null, 'KID-6: the petted sheep stops and looks at her', looks);
    await call('runTicks', 20);
    await hotbar(0, 'dirt', 8);
    const pet1 = await evCount('mob:petted');
    await tapEntity(sheep);
    check((await evCount('mob:petted')) - pet1 === 1, 'KID-6: tapping with a block in hand pets too (no block placed behind it)');

    // KID-7: horse in a kid world - tamed on the first tap, saddle picture, Space gets off, then saddle + ride
    await fresh();
    const horse = await spawn('horse', 0, -3.5, { coat: 'white' });
    await freezeAll();
    await face(horse, 3.5);
    await hotbar(0, null);
    await tapEntity(horse);
    let hd = await ent(horse);
    check(hd.data.tamed && (await ev(() => window.__game.game.player.riding)) === horse, 'KID-7: first tap with an empty hand tames and mounts the horse (no bucking)', hd.data);
    await unfreeze(); await call('runTicks', 4); await settle(4);
    const wish = await ev((id) => { const e = window.__game.game.entities.get(id); return !!(e.wish && e.wishTicks > 0); }, horse);
    check(wish, 'KID-7: a tamed horse without a saddle shows the floating saddle picture');
    await shot('judge1-kid7-saddle-picture');
    await key('Space', 150);
    check((await ev(() => window.__game.game.player.riding)) === null, 'KID-7: Space gets her off a horse without a saddle');
    await freezeAll(); await face(horse, 3.5); await unfreeze();
    await hotbar(0, 'saddle', 1);
    await tapEntity(horse);   // saddles it (tamed)
    hd = await ent(horse);
    check(hd.data.saddled, 'KID-7: saddle tap saddles the tamed horse');
    await tapEntity(horse);   // and gets on
    check((await ev(() => window.__game.game.player.riding)) === horse, 'KID-7: tap again rides it');
    const h0 = await ent(horse);
    await holdKey('ArrowUp', 2000);
    const h1 = await ent(horse);
    check(Math.hypot(h1.x - h0.x, h1.z - h0.z) > 4, 'KID-7: the saddled horse walks forward with the up arrow', +Math.hypot(h1.x - h0.x, h1.z - h0.z).toFixed(1));
    await key('Space', 150);
    check((await ev(() => window.__game.game.player.riding)) === horse, 'KID-7: Space jumps a saddled horse (she stays on)');
    await key('KeyC', 150);

    // FID-10: a sheared sheep takes the dye; its stubble shows the colour and the wool grows back in it
    await fresh();
    const s2 = await spawn('sheep', 0, -2.5, { color: 'white' });
    await freezeAll();
    await face(s2, 2.5);
    await hotbar(0, 'shears', 1);
    await tapEntity(s2);
    await hotbar(0, 'blue_dye', 4);
    await tapEntity(s2);
    let s2d = await ent(s2);
    check(s2d.data.sheared && s2d.data.color === 'blue', 'FID-10: dyeing a sheared sheep turns it blue', s2d.data);
    await settle(4); await shot('judge1-fid10-sheared-dyed-blue');
    await unfreeze();
    for (let i = 0; i < 12 && (await ent(s2)).data.sheared; i++) await call('runTicks', 400);
    s2d = await ent(s2);
    check(!s2d.data.sheared && s2d.data.color === 'blue', 'FID-10: the wool grows back blue', s2d.data);
    await face(s2, 3); await settle(4); await shot('judge1-fid10-regrown-blue');

    // ROB-8: mashing the pig egg on the ground keeps the creature count capped
    await fresh();
    await hotbar(0, 'pig_spawn_egg', 1);
    await call('setLook', 0, -35); await settle(2);
    const ref0 = await evCount('mobs:eggRefused');
    for (let i = 0; i < 300; i++) { await page.mouse.click(400 + ((i * 97) % 480), 430 + ((i * 53) % 180), { delay: 5 }); if (i % 50 === 49) await call('waitTicks', 1); }
    await call('waitTicks', 10);
    const mobsNow = await ev(() => window.__game.game.entities.all().filter((e) => e.def && !e.removed).length);
    check(mobsNow <= 64 && mobsNow >= 40, 'ROB-8: 300 egg taps keep the living mobs at or under 64', mobsNow);
    check((await evCount('mobs:eggRefused')) - ref0 > 0, 'ROB-8: extra eggs are refused with a puff');
    const mobMs = await ev(() => {
      const gm = window.__game.game; const t0 = performance.now(); const n = 200;
      for (let i = 0; i < n; i++) { gm.entities.tick(gm); gm.mobs.tick(gm); }
      return (performance.now() - t0) / n;
    });
    check(mobMs <= 3, 'ROB-8: mob tick <= 3 ms with the capped herd', +mobMs.toFixed(3));
    await settle(); await shot('judge1-rob8-capped-pigs');

    // FID-12: XP from ores, breeding and smelting (survival)
    await call('exitToTitle');
    await call('startWorld', { preset: 'flat', seed: 1, mode: 'survival', difficulty: 'peaceful', rules: { passiveMobs: false } });
    await call('setFlying', false); await call('waitTicks', 5); await call('setTime', 6000);
    const xp = () => ev(() => { const p = window.__game.game.player; return { xp: p.xp || 0, level: p.xpLevel || 0, total: (p.xpTotal || 0) }; });
    const q = await call('pos');
    const X = Math.floor(q.x), Z = Math.floor(q.z);
    // a wall of diamond ore in front of her, mined with an iron pickaxe by holding the mouse
    await ev(({ X, Z }) => { const gm = window.__game.game, D = window.__game.blockId('diamond_ore'); gm.world.setBlock(X, 4, Z - 2, D, 0, { cause: 'test' }); gm.world.setBlock(X, 5, Z - 2, D, 0, { cause: 'test' }); }, { X, Z });
    await hotbar(0, 'iron_pickaxe', 1);
    const xp0 = await xp();
    await call('lookAt', X + 0.5, 4.5, Z - 1.6);
    await page.mouse.move(640, 360); await page.mouse.down(); await page.waitForTimeout(3500); await page.mouse.up();
    await call('runTicks', 60);
    const xp1 = await xp();
    check((await call('getBlock', X, 4, Z - 2)) === 'air' && (xp1.xp > xp0.xp || xp1.level > xp0.level), 'FID-12: mining diamond ore with an iron pickaxe gives XP', { before: xp0, after: xp1 });
    // breeding: two cows + wheat taps -> baby + 1-7 XP
    const c1 = await spawn('cow', 1.5, -3.5), c2 = await spawn('cow', -1.5, -3.5);
    await freezeAll();
    await hotbar(1, 'wheat', 4);
    await call('lookAt', q.x, 4.6, q.z - 3.5);
    await tapEntity(c1); await tapEntity(c2);
    await unfreeze();
    const xp2 = await xp(), bred0 = await evCount('mob:bred');
    await call('runTicks', 260);
    const xp3 = await xp();
    check((await evCount('mob:bred')) - bred0 === 1 && (xp3.xp > xp2.xp || xp3.level > xp2.level), 'FID-12: breeding two cows gives XP', { before: xp2, after: xp3 });
    // smelting: 4 raw iron cooked in a furnace, taken out by a click -> 0.7 x 4 = 2.8 XP pops at the player
    await ev(({ X, Z }) => { const gm = window.__game.game; gm.world.setBlock(X + 2, 4, Z, window.__game.blockId('furnace'), 0, { cause: 'test' }); }, { X, Z });
    await hotbar(2, null);
    await call('lookAt', X + 2.5, 4.5, Z + 0.5);
    await page.mouse.click(640, 360, { delay: 60 });
    await call('waitFrames', 6);
    const opened = await call('uiOpen');
    const be = await ev(({ X, Z }) => { const b = window.__game.game.world.getBlockEntity(X + 2, 4, Z); if (b) { b.input = { item: 'raw_iron', count: 4 }; b.fuel = { item: 'coal', count: 2 }; } return !!b; }, { X, Z });
    await call('runTicks', 850);
    const be2 = await ev(({ X, Z }) => { const b = window.__game.game.world.getBlockEntity(X + 2, 4, Z); return b ? { out: b.output, xp: b.xp } : null; }, { X, Z });
    check(opened === 'furnace' && be && be2 && be2.out && be2.out.count === 4, 'FID-12: furnace opened by a tap and smelted 4 iron', { opened, be2 });
    const xp4 = await xp();
    await call('waitFrames', 4);
    await shot('judge1-fid12-furnace-done');
    // shift-click the output slot (moves the iron into the inventory)
    const outSel = await ev(() => { const el = document.querySelector('[data-slot="fo"]') || document.querySelector('[data-sid="fo"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (outSel) { await page.keyboard.down('Shift'); await page.mouse.click(outSel.x, outSel.y, { delay: 40 }); await page.keyboard.up('Shift'); }
    else await ev(({ X, Z }) => { const b = window.__game.game.world.getBlockEntity(X + 2, 4, Z); window.__game.game.inventory.add(b.output); b.output = null; }, { X, Z });
    await call('runTicks', 40);
    const xp5 = await xp();
    check(xp5.xp + xp5.level * 100 > xp4.xp + xp4.level * 100 && (await ev(() => window.__game.game.inventory.count('iron_ingot'))) === 4, 'FID-12: taking the iron out of the furnace gives the smelting XP', { before: xp4, after: xp5, realClick: !!outSel });
    await call('closeUI');
  },

  /** Judge FID-6: the ten new mob kinds in the real world (models, behaviour, spawning, picker eggs). */
  async newmobs() {
    const unfreeze = () => ev(() => { for (const e of window.__game.game.entities.all()) if (e.__tick) { e.tick = e.__tick; delete e.__tick; } });
    const G = (fn, arg) => ev(fn, arg);
    await startFlat({ difficulty: 'easy', rules: { hostileMobs: true } });
    // --- gallery: every new kind side by side (frozen), day
    const p = await call('pos');
    const ids = await G(({ x, y, z }) => {
      const gm = window.__game.game, W = window.__game.blockId('water');
      // a little pond for the water mobs
      for (let i = -3; i <= 3; i++) for (let k = -2; k <= 1; k++) for (let yy = 1; yy <= 3; yy++) gm.world.setBlock(Math.floor(x) - 12 + i, yy, Math.floor(z) - 8 + k, W, 0, { cause: 'test' });
      const row = [['cod', -14, 2.2, -8], ['tropical_fish', -12.5, 2.4, -8, { variant: 1 }], ['squid', -10.5, 1.4, -8.5],
        ['rabbit', -7, 4, -7, { coat: 'brown' }], ['rabbit', -6, 4, -6, { coat: 'white' }], ['fox', -4, 4, -7], ['fox', -2.5, 4, -6, { variant: 'snow' }], ['bee', -0.5, 5.2, -7],
        ['enderman', 2, 4, -9, { carried: 'grass_block' }], ['slime', 4.5, 4, -7, { size: 2 }], ['slime', 6, 4, -6, { size: 1 }], ['villager', 8, 4, -8, { variant: 'farmer' }], ['villager', 10, 4, -8, { variant: 'librarian' }], ['iron_golem', 13, 4, -9]];
      const out = [];
      for (const [type, dx, yy, dz, o] of row) { const e = gm.mobs.spawnMob(type, x + dx, yy, z + dz, o || {}); if (e) out.push(e.id); }
      return out;
    }, p);
    check(ids.length === 14, 'newmobs: 14 new-kind mobs spawned (cod, tropical fish, squid, rabbits, foxes, bee, enderman, slimes, villagers, golem)', ids.length);
    await call('runTicks', 2);
    await freezeAll();
    await settle(40);   // the spawn puffs clear
    await G(() => { for (const e of window.__game.game.entities.all()) { e.yaw = e.prevYaw = Math.PI * 0.82; e.headYaw = 0; } });
    await call('teleport', p.x, p.y, p.z + 4); await call('setLook', 0, -14);
    await settle(8); await shot('newmobs-gallery');
    await call('teleport', p.x - 3, p.y, p.z - 2); await call('lookAt', p.x - 5, 4.6, p.z - 7); await settle(6); await shot('newmobs-close-rabbit-fox-bee');
    await call('teleport', p.x + 8, p.y, p.z - 3); await call('lookAt', p.x + 8, 5.5, p.z - 8); await settle(6); await shot('newmobs-close-villager-slime-enderman');
    await call('teleport', p.x - 12, p.y, p.z - 5.2); await call('lookAt', p.x - 12, 2.2, p.z - 8); await settle(6); await shot('newmobs-close-pond');
    await call('setFlying', true); await call('teleport', Math.floor(p.x) - 9 + 0.5, 1, Math.floor(p.z) - 8 + 0.5); await call('lookAt', p.x - 13, 2.0, p.z - 8.2); await settle(6); await shot('newmobs-pond-underwater'); await call('setFlying', false);
    await call('teleport', p.x + 2, p.y, p.z - 6); await call('lookAt', p.x + 2, 5.6, p.z - 9); await settle(6); await shot('newmobs-close-enderman-block');
    await unfreeze();

    // --- water: fish and squid stay in the pond and swim about; a fish on land flops and (kid world) never dies
    const pond = await G(({ x, z }) => {
      const gm = window.__game.game;
      return gm.entities.all().filter((e) => e.def && e.def.water).map((e) => ({ id: e.id, x: e.x, y: e.y, z: e.z }));
    }, p);
    await call('runTicks', 300);
    const pond2 = await G((list) => list.map((a) => { const e = window.__game.game.entities.get(a.id); return e ? { moved: Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z), inWater: e.inWater } : null; }), pond);
    check(pond2.every((q) => q && q.inWater) && pond2.some((q) => q.moved > 0.8), 'newmobs: fish and squid stay in the water and swim', pond2.map((q) => q && +q.moved.toFixed(1)));
    const flop = await spawn('cod', 2, -2);
    const f0 = await ent(flop);
    let maxY = f0.y;
    for (let i = 0; i < 40; i++) { await call('runTicks', 2); const e = await ent(flop); maxY = Math.max(maxY, e.y); }
    const f1 = await ent(flop);
    check(maxY > f0.y + 0.3 && f1 && f1.health === 3, 'newmobs: a fish on land flops about (and is not hurt in a kid world)', { jump: +(maxY - f0.y).toFixed(2), health: f1 && f1.health });

    // --- fox naps in the daytime; a tap wakes it (petting)
    await fresh();
    const fox = await spawn('fox', 0, -3);
    let slept = false;
    for (let i = 0; i < 30 && !slept; i++) { await call('runTicks', 50); slept = await G((id) => !!window.__game.game.entities.get(id).sleeping, fox); }
    check(slept, 'newmobs: a fox curls up for a nap in the daytime');
    await freezeAll(); await face(fox, 2.5, 0, 0.3); await settle(4); await shot('newmobs-fox-asleep');
    await unfreeze(); await hotbar(0, null);
    await tapEntity(fox, 0.3);
    check(!(await G((id) => window.__game.game.entities.get(id).sleeping, fox)), 'newmobs: tapping the sleeping fox wakes it up');

    // --- rabbits hop toward a carrot
    await fresh();
    const rb = await spawn('rabbit', 0, -7);
    await hotbar(0, 'carrot', 4);
    const r0 = await ent(rb);
    const hops = await G((id) => { const gm = window.__game.game, e = gm.entities.get(id); let n = 0, prev = true; for (let i = 0; i < 120; i++) { gm.stepTicks(1); if (prev && !e.onGround && e.vy > 0) n++; prev = e.onGround; } return n; }, rb);
    const r1 = await ent(rb);
    const pp = await call('pos');
    check(hops >= 3 && Math.hypot(r1.x - pp.x, r1.z - pp.z) < Math.hypot(r0.x - pp.x, r0.z - pp.z) - 2, 'newmobs: a rabbit hops over to the child holding a carrot', { hops, from: +Math.hypot(r0.x - pp.x, r0.z - pp.z).toFixed(1), to: +Math.hypot(r1.x - pp.x, r1.z - pp.z).toFixed(1) });

    // --- bees fly from flower to flower
    await fresh();
    const q = await call('pos');
    await G(({ x, z }) => { const gm = window.__game.game; for (const [dx, dz, n] of [[3, -4, 'poppy'], [-3, -5, 'dandelion'], [0, -8, 'cornflower']]) gm.world.setBlock(Math.floor(x) + dx, 4, Math.floor(z) + dz, window.__game.blockId(n), 0, { cause: 'test' }); }, q);
    const bee = await spawn('bee', 0, -4);
    let hovered = false, minAbove = 9;
    for (let i = 0; i < 60 && !hovered; i++) { await call('runTicks', 10); const b = await G((id) => { const e = window.__game.game.entities.get(id); return { hover: e.hover, y: e.y }; }, bee); hovered = b.hover > 0; minAbove = Math.min(minAbove, b.y - 4); }
    check(hovered && minAbove > -0.05, 'newmobs: the bee flies to a flower and hovers over it (never lands)', { minAbove: +minAbove.toFixed(2) });
    await freezeAll(); await face(bee, 2.5, 20, 0.5); await settle(4); await shot('newmobs-bee-on-flower'); await unfreeze();

    // --- villager: an emerald buys a gift; anything else gets a head shake and the emerald picture
    await fresh();
    const vil = await spawn('villager', 0, -3, { variant: 'farmer' });
    await freezeAll(); await face(vil, 3, 0, 0.6); await unfreeze();
    await hotbar(0, null);
    await tapEntity(vil, 0.6);
    await call('runTicks', 3); await settle(4);
    check(await G((id) => window.__game.game.entities.get(id).wishTicks > 0, vil), 'newmobs: an empty-hand tap makes the villager shake its head and show an emerald');
    await shot('newmobs-villager-wants-emerald');
    await hotbar(0, 'emerald', 3);
    const tr0 = await evCount('mobs:trade');
    await face(vil, 3, 0, 0.6); await tapEntity(vil, 0.6);
    check((await evCount('mobs:trade')) - tr0 === 1, 'newmobs: tapping the villager with an emerald trades it for a gift');
    await call('runTicks', 30);
    check((await G(() => ['bread', 'carrot', 'apple'].reduce((n, k) => n + window.__game.game.inventory.count(k), 0))) > 0, 'newmobs: the gift lands in her inventory');

    // --- iron golem hands her a poppy
    await fresh();
    const golem = await spawn('iron_golem', 0, -4);
    await freezeAll(); await face(golem, 4, 0, 0.6); await unfreeze();
    await hotbar(0, null);
    const poppies0 = await G(() => window.__game.game.inventory.count('poppy'));
    await tapEntity(golem, 0.6);
    await call('runTicks', 4); await settle(4); await shot('newmobs-golem-offers-poppy');
    await call('runTicks', 40);
    check((await G(() => window.__game.game.inventory.count('poppy'))) > poppies0, 'newmobs: tapping the iron golem gives her a poppy');

    // --- survival night: golem fights a zombie; enderman gets angry when stared at and dodges arrows; slime splits
    await call('exitToTitle');
    await call('startWorld', { preset: 'flat', seed: 3, mode: 'survival', difficulty: 'normal', rules: { passiveMobs: false, hostileMobs: true, daylightCycle: false } });
    await call('setFlying', false); await call('waitTicks', 5); await call('setTime', 18000);
    await G(() => { const gm = window.__game.game; gm.player.health = 20; });
    const s0 = await call('pos');
    const gol = await spawn('iron_golem', 4, -6), zom = await spawn('zombie', 6, -10);
    let zgone = false;
    for (let i = 0; i < 30 && !zgone; i++) { await call('runTicks', 10); const z = await ent(zom); zgone = !z || z.health <= 0; await G(() => { window.__game.game.player.health = 20; }); }
    check(zgone, 'newmobs: the iron golem fights off a zombie');
    await G(() => { const gm = window.__game.game; for (const e of gm.entities.all()) if (e.type !== 'iron_golem') gm.entities.remove(e, 'test'); });
    await G((id) => window.__game.game.entities.remove(window.__game.game.entities.get(id), 'test'), gol);
    const end = await spawn('enderman', 0, -10);
    await call('runTicks', 2);
    await G(() => { window.__game.game.time.setTime(18000); });
    // look straight at its head
    const ee = await ent(end);
    await call('lookAt', ee.x, ee.y + 2.55, ee.z);
    let angry = false;
    for (let i = 0; i < 20 && !angry; i++) { await call('runTicks', 2); angry = await G((id) => { const e = window.__game.game.entities.get(id); return !!(e && e.angryTicks > 0); }, end); }
    check(angry, 'newmobs: staring at an enderman makes it angry');
    await settle(3); await shot('newmobs-enderman-angry');
    const tp0 = await evCount('mobs:teleport');
    const h0 = (await ent(end)).health;
    await G((id) => { const gm = window.__game.game, e = gm.entities.get(id), p = gm.player; const dx = e.x - p.x, dy = e.y + 1.5 - (p.y + 1.5), dz = e.z - p.z, l = Math.hypot(dx, dy, dz);
      gm.entities.spawn('arrow', p.x + dx / l, p.y + 1.5 + dy / l, p.z + dz / l, { vx: dx / l * 3, vy: dy / l * 3, vz: dz / l * 3, shooter: p, damage: 6, fromPlayer: true }); }, end);
    await call('runTicks', 10);
    const e2 = await ent(end);
    check((await evCount('mobs:teleport')) > tp0 && e2 && e2.health === h0, 'newmobs: an arrow never hits an enderman - it teleports away', { teleports: (await evCount('mobs:teleport')) - tp0, health: e2 && e2.health });
    await G(() => { const gm = window.__game.game; for (const e of gm.entities.all()) gm.entities.remove(e, 'test'); gm.player.health = 20; });
    const sl = await spawn('slime', 0, -4, { size: 4 });
    for (let i = 0; i < 12; i++) { await G((id) => window.__game.game.mobs.hit(id, 4), sl); await call('runTicks', 11); }
    await call('runTicks', 25);
    const kids = await G(() => { const p = window.__game.game.player; return window.__game.game.entities.all().filter((e) => e.type === 'slime' && !e.deathTime && Math.hypot(e.x - p.x, e.z - p.z) < 12).map((e) => e.data.size); });
    check(kids.length >= 2 && kids.every((s) => s === 2), 'newmobs: a big slime splits into 2-4 smaller slimes', kids);
    await call('lookAt', s0.x, 4.4, s0.z - 4); await settle(3); await shot('newmobs-slime-split');

    // --- natural spawning: water mobs in the islands preset, rabbits / foxes in the snowy preset
    await call('exitToTitle');
    await call('startWorld', { preset: 'islands', seed: 4242, mode: 'creative', difficulty: 'peaceful' });
    await call('waitTicks', 60);
    const wc = await G(() => { const gm = window.__game.game; const c = gm.mobs.counts(); const types = {}; for (const e of gm.entities.all()) if (e.def && e.def.water) types[e.type] = (types[e.type] || 0) + 1; return { ...c, types, allInWater: gm.entities.all().filter((e) => e.def && e.def.water).every((e) => e.inWater) }; });
    check(wc.water > 0 && wc.water <= 12 && wc.allInWater, 'newmobs: the islands world has fish / squid in its water (own cap 12)', wc);
    const fish = await G(() => { const gm = window.__game.game, p = gm.player; let best = null, bd = 1e9; for (const e of gm.entities.all()) if (e.def && e.def.water) { const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < bd) { bd = d; best = e; } } return best ? { x: best.x, y: best.y, z: best.z, type: best.type } : null; });
    if (fish) { await call('setFlying', true); await call('teleport', fish.x + 2.5, fish.y + 3, fish.z + 2.5); await call('lookAt', fish.x, fish.y, fish.z); await settle(8); await shot('newmobs-wild-water-' + fish.type); }
    await call('exitToTitle');
    await call('startWorld', { preset: 'snowy', seed: 77, mode: 'creative', difficulty: 'peaceful' });
    await call('waitTicks', 60);
    const snow = await G(() => { const out = {}; for (const e of window.__game.game.entities.all()) if (e.def) out[e.type] = (out[e.type] || 0) + 1; return out; });
    console.log('  snowy world animals', JSON.stringify(snow));
    check((snow.rabbit || 0) + (snow.fox || 0) > 0, 'newmobs: rabbits or foxes live in the snowy world', snow);

    // --- creative picker: the new eggs are in the Animals tab
    await call('exitToTitle');
    await startFlat();
    const shown = await G(() => { const gm = window.__game.game; return ['cod', 'tropical_fish', 'squid', 'rabbit', 'fox', 'bee', 'villager', 'iron_golem'].filter((t) => window.__game.game.entities && true); });
    void shown;
    await call('openInventory'); await settle(6);
    const tab = await G(() => { const b = [...document.querySelectorAll('[data-tab], [data-picker-tab], button')].find((el) => /animals/i.test(el.dataset.tab || el.dataset.pickerTab || el.getAttribute('aria-label') || '')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (tab) { await page.mouse.click(tab.x, tab.y, { delay: 40 }); await settle(6); }
    const eggs = await G(() => [...document.querySelectorAll('[data-item]')].map((el) => el.dataset.item).filter((k) => /_spawn_egg$/.test(k)));
    check(['cod', 'tropical_fish', 'squid', 'rabbit', 'fox', 'bee', 'villager', 'iron_golem'].every((t) => eggs.includes(t + '_spawn_egg')), 'newmobs: the picker Animals tab shows the new spawn eggs', eggs);
    await shot('newmobs-picker-animals');
    await call('closeUI');
  },

  async perf() {
    await call('startWorld', { preset: 'default', seed: 777, mode: 'creative', difficulty: 'peaceful' });
    await call('waitTicks', 40);
    const sample = async (label) => {
      await call('setLook', 0, -10);
      const s0 = await call('stats');
      await page.waitForTimeout(2500);
      const s = await call('stats');
      const t = await ev(() => { const gm = window.__game.game; const n = gm.entities.all(); return { entities: n.length, creatures: gm.mobs.counts().creature }; });
      return { label, fps: s.fps, frameMs: s.frameMs, workMs: s.workMs, tickMs: s.tickMs, drawCalls: s.drawCalls, ...t, frames: s.frames - s0.frames };
    };
    // fill to the creature cap near the player so they are on screen
    await ev(() => { const gm = window.__game.game, p = gm.player; const types = ['pig', 'cow', 'sheep', 'chicken'];
      for (let i = gm.mobs.counts().creature; i < 24; i++) { const a = (i / 24) * Math.PI - Math.PI; gm.mobs.spawnMob(types[i % 4], p.x + Math.sin(a) * 8, p.y + 2, p.z - 6 - Math.cos(a) * 3, {}); } });
    await call('waitTicks', 40);
    const withMobs = await sample('24 animals');
    const d = await drawDelta();
    // per-tick cost of the mob systems
    const mobMs = await ev(() => {
      const gm = window.__game.game; const t0 = performance.now(); const n = 200;
      for (let i = 0; i < n; i++) { gm.entities.tick(gm); gm.mobs.tick(gm); }
      return (performance.now() - t0) / n;
    });
    await ev(() => { const gm = window.__game.game; for (const e of gm.entities.all()) gm.entities.remove(e, 'test'); gm.setRule('passiveMobs', false); });
    await call('waitTicks', 10);
    const without = await sample('no entities');
    console.log('  ', JSON.stringify(withMobs)); console.log('  ', JSON.stringify(without));
    check(d <= withMobs.entities, 'perf: one draw call per on-screen entity', { entityDraws: d, entities: withMobs.entities });
    check(mobMs < 1, 'perf: entities + mobs tick < 1 ms with 24 animals in the real world', +mobMs.toFixed(3));
    return { withMobs, without, mobTickMs: mobMs, entityDraws: d };
  },
};

const out = {};
try {
  for (const [name, fn] of Object.entries(SECTIONS)) {
    if (only.length && !only.includes(name)) continue;
    console.log(`--- ${name}`);
    try { out[name] = await fn(); } catch (err) { check(false, `${name}: threw ${err && err.message}`); console.error(err); await shot(name + '-ERROR'); }
    const errs = await g.gameErrors();
    check(errs.length === 0, `${name}: no game errors`, errs.slice(0, 5));
    await ev(() => { window.__game.game.errors.length = 0; });
    try { await call('exitToTitle'); } catch { /* ignore */ }
  }
} finally {
  check(g.errors.length === 0, 'no page errors', g.errors.slice(0, 5));
  await g.close();
}
const failed = g.results.filter((r) => !r.ok);
console.log(`\n[mobs-play] ${g.results.length - failed.length} PASS, ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
