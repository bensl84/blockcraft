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
    const hurtBefore = await evCount('mob:hurt'), deathBefore = await evCount('mob:death');
    let hopped = false;
    for (let i = 0; i < 12; i++) {
      await face(pig, 2.5);
      const s = await screenOf(pig);
      await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.waitForTimeout(450);
      const e = await ent(pig); if (e.vy > 0.1 || !e.onGround) hopped = true;
      if (i === 2) { await settle(1); await shot('kidhit-pig-hop'); }
      await page.mouse.up(); await call('waitTicks', 12);
    }
    const e = await ent(pig);
    check(e && e.health === 10, 'kidhit: 12 holds on a pig in a kid world: health stays 10', e && e.health);
    check((await evCount('mob:hurt')) - hurtBefore >= 8, 'kidhit: the holds register as hits (squeak / panic)', (await evCount('mob:hurt')) - hurtBefore);
    check((await evCount('mob:death')) - deathBefore === 0, 'kidhit: no animal died');
    check(hopped, 'kidhit: the pig hops when hit');
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
        if (e.data.wild && e.age < 100 && light < 9) bad.push({ type: e.type, light });
        void below; void col;
      }
      return { out, bad };
    });
    check(Object.keys(animals.out).length >= 3 && animals.bad.length === 0, 'spawning: chunk-gen animals of several kinds, all on sky-lit ground', animals);
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
    await call('setTime', 1000);
    await call('runTicks', 60);
    const sun = await ev(() => { const gm = window.__game.game; return gm.entities.all().filter((e) => e.def && e.def.burnsInSun && !e.inWater).map((e) => ({ type: e.type, sky: gm.world.getSkyLight(Math.floor(e.x), Math.floor(e.y + e.eyeHeight), Math.floor(e.z)), fire: e.fireTicks > 0, hp: e.health })); });
    const open = sun.filter((m) => m.sky >= 15), shade = sun.filter((m) => m.sky < 15);
    check(open.length > 0 && open.every((m) => m.fire) && shade.every((m) => !m.fire), 'spawning: in the morning undead under the open sky burn, ones in the shade do not', { open: open.length, burning: open.filter((m) => m.fire).length, shade: shade.length });
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
