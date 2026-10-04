// OWNER LANE: KID (touch + kid controls). SPEC §2.7, §8.5.2. API FROZEN: goHome, setHome, undo, enterFullscreen,
// tick, frame, serialize, deserialize (additive members below are documented in docs/handoff/kid.md).
//
// Kid helpers:
//  - Home (H key / 'home' action / 80 px button top left): fade + whoosh, teleport to meta.home (or meta.spawn)
//    facing the latest build, sparkle. Home arrow (top centre) when more than KID.HOME_ARROW_DIST away.
//  - Void rescue (rules.voidRescue): feet below KID.VOID_RESCUE_Y (0) or 10 below the lowest terrain ->
//    silent teleport to the surface, no damage (survival never sees 'void' while the rule is on).
//  - Stuck rescue: pushing move for 3 s without moving while enclosed at head height (or the head inside an
//    opaque block) -> 'kid:stuck' (the touch Up button pulses; keyboard players get a pictogram); holding Jump
//    for 1 s pops to free space. Head-in-block pops on its own after 2 s.
//  - Soft border: rules.worldBorder from spawn, pushed back 0.1 b/t inside thickening fog (renderer.setFogOverride).
//  - Undo (U / button): see undo.js. Last KID.UNDO_ENTRIES actions. After an undo a Redo button appears beside
//    Undo for REDO_SHOW_MS (KID-8: mashing Undo could erase a whole build for good); the next new action clears it.
//  - Home / Undo / Redo / home arrow / hints hide while a menu or container screen is open (POL-11).
//  - Onboarding hints (P1): animated pictograms after 7 s without progress, optional local speech.
//  - Speak block names on hotbar selection (settings.speakNames, local voices only).
//  - Exit guards: see guards.js.

import { isNetherX, toNether } from '../core/nether.js';
import './kid.css';
import { el, uiLayer } from '../core/dom.js';
import { DEG } from '../core/math.js';
import { KID, WORLD_HEIGHT, Z } from '../core/constants.js';
import { B_OPAQUE, B_SOLID } from '../core/registry.js';
import { getItem } from '../data/items.js';
import { boxCollides as physicsBoxCollides, findFreeY as physicsFindFreeY, moveAndCollide } from '../player/physics.js';
import { UndoLog } from './undo.js';
import {
  BORDER_PUSH, HintPlan, StuckDetector, borderFog, borderState, dist2d, homeArrowAngle, needsVoidRescue, wrapAngle, yawToward,
} from './logic.js';
import { createGuards } from './guards.js';
import { createSpeech } from './speech.js';
import { ICONS } from './pixelicons.js';
import { HINT_LINES, hintHtml } from './hints.js';

/** Ticks from the Home press to the teleport (fade out first; the kid-home scenario allows 5). */
export const HOME_TELEPORT_TICK = 3;
const HOME_SEQ_TICKS = 12;
/** How long the Redo button stays after the last undo (ms of real time). */
export const REDO_SHOW_MS = 10000;

/** @returns {object} Kid system (game.kid) */
export function createKidSystem(game) {
  const undoLog = new UndoLog(KID.UNDO_ENTRIES);
  const stuck = new StuckDetector();
  const hints = new HintPlan();
  const guards = createGuards(game);
  let speech = null;
  const bs = {};
  const fogTmp = {};
  const cellsTmp = [];
  let layer = null, homeBtn = null, undoBtn = null, redoBtn = null, arrowEl = null, arrowRot = null, hintEl = null, sparkLayer = null;
  let homeSeq = -1;             // ticks since the Home press, -1 = idle
  let lastFogT = 0;
  let buttonsShown = null;
  let underScreen = null;       // a menu / container screen is open (the kid layer hides under it)
  let redoUntil = 0;            // performance.now() until which the Redo button may show
  let redoShown = null;
  let arrowShown = null, arrowDeg = 1e9;
  let hintShown = null;         // name of the pictogram on screen
  let stuckHintShown = false;
  let lastYaw = 0, turnAccum = 0, walkTicks = 0, teleported = false;
  let lowestCache = { x: NaN, z: NaN, y: -1, tick: -100 };
  let groundY = null;           // feet y of the last floor stood on (stuck detection)
  let settleAt = null;          // {x, z, ticks}: a Home into an unloaded column, fixed up once it loads

  const playing = () => game.state === 'playing' && !!game.meta;
  const touchVariant = () => (game.touch && game.touch.visible ? 'touch' : 'keys');

  const kid = {
    name: 'kid',
    undoLog,
    stuck,
    hints,
    guards,
    get speech() { return speech; },
    /** live state for tests: {visible, deg} */
    homeArrow: { visible: false, deg: 0 },
    /** soft border state for tests: {dist, over, fogT} */
    border: { dist: 0, over: 0, fogT: 0 },
    homeSeqActive: false,

    init() {
      speech = createSpeech(game);
      buildDom();
      guards.install();
      const ev = game.events;
      ev.on('input:action', (e) => {
        if (!e.down || !playing() || game.ui.current) return;
        if (e.action === 'home') kid.requestHome();
        else if (e.action === 'undo') kid.undo();
        else if (e.action === 'turnLeft' || e.action === 'turnRight') completeHint('turn');
        else if (e.action === 'toggleFly') { /* fly hint completes on player:fly */ }
      });
      ev.on('block:changed', (e) => { if (game.meta) undoLog.record(e, game.tickCount); });
      ev.on('block:placed', (e) => { if (e.by === 'player') { completeHint('place'); hints.activity(); } });
      ev.on('block:broken', (e) => { if (e.by === 'player') { completeHint('break'); hints.activity(); } });
      ev.on('player:hotbar', (e) => {
        if (game.meta) completeHint('pick');
        if (game.settings.speakNames && e && e.item && game.meta) {
          const d = getItem(e.item);
          speech.say(d ? d.name : String(e.item).replace(/_/g, ' '), 250);
        }
      });
      ev.on('ui:open', (e) => { if (e.screen === 'creative' || e.screen === 'inventory') completeHint('pick'); });
      ev.on('player:fly', (e) => { if (e.flying) completeHint('fly'); });
      ev.on('player:teleport', () => { teleported = true; });
      ev.on('world:starting', () => resetWorldState());
      ev.on('world:exit', () => { resetWorldState(); clearFog(); });
      ev.on('settings:changed', (e) => {
        if (e.key === 'hints' && !e.value) hideHint();
        if (e.key === 'speakNames' && !e.value && speech) speech.cancel();
      });
    },

    /* ---------------------------------------------------------------- Home */
    /** Animated Home (button / H): fade out, teleport on tick HOME_TELEPORT_TICK, fade in + sparkle. */
    requestHome() {
      if (!playing() || homeSeq >= 0) return false;
      homeSeq = 0;
      kid.homeSeqActive = true;
      press(homeBtn);
      fade(1, 140);
      return true;
    },
    /** Teleport to home (meta.home) or world spawn right now, facing the latest build. Emits 'kid:home'. */
    goHome() {
      const m = game.meta;
      const h = (m && (m.home || m.spawn)) || { x: 0.5, y: 64, z: 0.5 };
      const p = game.player;
      const y = freeY(h.x, h.y, h.z);
      p.teleport(h.x, y, h.z, 'home');
      // far home: the column is not loaded yet (the player waits frozen on "unloaded = solid"); place them in
      // free space as soon as it streams in instead of leaving them inside a hill
      settleAt = columnLoaded(h.x, h.z) ? null : { x: h.x, z: h.z, ticks: 0 };
      const yaw = facingYaw(h);
      if (yaw !== null) { p.yaw = yaw; p.pitch = -12 * DEG; }
      game.events.emit('kid:home', { x: h.x, y, z: h.z });
    },
    /** Set home to the player's position (parent area / home flag). */
    setHome() {
      if (!game.meta) return;
      const p = game.player;
      game.meta.home = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
      game.events.emit('kid:homeSet', { x: p.x, y: p.y, z: p.z });
    },

    /* ---------------------------------------------------------------- Undo */
    /** Undo the newest recorded action that can still be restored. Returns true if something was undone. */
    undo() {
      if (!game.world || !game.world.isOpen) return false;
      const r = undoLog.undo(game.world);
      if (r.count > 0) {
        game.events.emit('kid:undo', { count: r.count });
        game.events.emit('sound', { name: 'ui.whoosh', volume: 0.5, pitch: 1.4 });
        spin(undoBtn);
        redoUntil = now() + REDO_SHOW_MS;
        liftOut();
        return true;
      }
      game.events.emit('sound', { name: 'ui.error' });
      shake(undoBtn);
      return false;
    },
    /** Put back the newest undone action (Redo button). Returns true if something was redone. */
    redo() {
      if (!game.world || !game.world.isOpen) return false;
      const r = undoLog.redo(game.world);
      if (r.count > 0) {
        game.events.emit('kid:redo', { count: r.count });
        game.events.emit('sound', { name: 'ui.whoosh', volume: 0.5, pitch: 1.0 });
        spin(redoBtn);
        redoUntil = now() + REDO_SHOW_MS;
        liftOut();
        return true;
      }
      game.events.emit('sound', { name: 'ui.error' });
      shake(redoBtn);
      return false;
    },
    /** True while the Redo button is offered (tests). */
    get redoVisible() { return !!redoShown; },

    /* ---------------------------------------------------------------- guards */
    /** Request fullscreen + keyboard lock. MUST be called inside a user-gesture handler (Play button). */
    enterFullscreen() { return guards.enterFullscreen(); },

    /* ---------------------------------------------------------------- hints (tests / debug) */
    /** Show a pictogram now (tests, screenshots). variant 'keys' | 'touch' (default: from touch.visible). */
    showHint(name, variant) { renderHint(name, variant || touchVariant()); return hintShown; },
    hideHint() { hideHint(); },
    get hintShown() { return hintShown; },
    /** Burst of sparkles at a screen point (default: centre). */
    sparkle(x, y, n = 14) { sparkle(x, y, n); },

    /* ---------------------------------------------------------------- loop */
    tick() {
      if (!playing()) return;
      const p = game.player;
      // Home sequence
      if (homeSeq >= 0) {
        homeSeq++;
        if (homeSeq === HOME_TELEPORT_TICK) {
          kid.goHome();
          fade(0, 320);
          if (game.fx && game.fx.spawnParticles) game.fx.spawnParticles('sparkle', p.x, p.y + 1, p.z, { count: 24, spread: 1.2 });
          sparkle(null, null, 16);
        }
        if (homeSeq >= HOME_SEQ_TICKS) { homeSeq = -1; kid.homeSeqActive = false; }
      }
      if (settleAt) tickSettle();
      const rules = game.meta.rules || {};
      // Void rescue
      if (rules.voidRescue !== false && !p.dead) {
        const low = p.y < 24 ? lowestSolid(p.x, p.z) : -1;
        if (needsVoidRescue(p.y, low)) voidRescue();
      }
      // Stuck rescue
      tickStuck();
      // Soft border
      tickBorder(rules.worldBorder | 0);
      // Hints progress + scheduling
      tickHints();
      lastYaw = p.yaw;
      teleported = false;
    },

    frame() {
      const show = !!game.meta && (game.state === 'playing' || game.state === 'paused');
      if (show !== buttonsShown) {
        buttonsShown = show;
        layer.classList.toggle('kid-off', !show);
        if (!show) hideHint();
      }
      // menus and container screens cover the world: the kid buttons hide under them instead of peeking out
      const under = show && !!game.ui.current;
      if (under !== underScreen) { underScreen = under; layer.classList.toggle('kid-under-screen', under); }
      if (show) {
        const empty = undoLog.size === 0;
        if (undoBtn.classList.contains('kid-empty') !== empty) undoBtn.classList.toggle('kid-empty', empty);
      }
      const redo = show && undoLog.redoSize > 0 && now() < redoUntil;
      if (redo !== redoShown) { redoShown = redo; redoBtn.classList.toggle('kid-hidden', !redo); }
      updateArrow(show);
    },

    serialize() { return { v: 1 }; },
    deserialize() { resetWorldState(); },
  };

  /* ------------------------------------------------------------------ DOM */
  function buildDom() {
    layer = uiLayer(game, 'kid', Z.KID);
    layer.classList.add('kid-layer', 'kid-off');
    homeBtn = el('div', {
      class: 'bc-plate-btn kid-btn kid-home', role: 'button', 'aria-label': 'Home', 'data-interactive': '', 'data-kid': 'home',
      html: ICONS.home(),
      onpointerdown: (e) => { e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {}); kid.requestHome(); },
    });
    undoBtn = el('div', {
      class: 'bc-plate-btn kid-btn kid-undo', role: 'button', 'aria-label': 'Undo', 'data-interactive': '', 'data-kid': 'undo',
      html: ICONS.undo(),
      onpointerdown: (e) => { e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {}); if (playing()) kid.undo(); },
    });
    redoBtn = el('div', {
      class: 'bc-plate-btn kid-btn kid-redo kid-hidden', role: 'button', 'aria-label': 'Redo', 'data-interactive': '', 'data-kid': 'redo',
      html: ICONS.redo(),
      onpointerdown: (e) => { e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {}); if (playing()) kid.redo(); },
    });
    arrowRot = el('div', { class: 'kid-arrow-rot' }, [el('div', { class: 'kid-arrow-tip', html: ICONS.compass() })]);
    arrowEl = el('div', { class: 'kid-arrow kid-hidden', 'data-kid': 'home-arrow', 'aria-hidden': 'true' }, [
      el('div', { class: 'kid-arrow-house', html: ICONS.home() }), arrowRot,
    ]);
    hintEl = el('div', { class: 'kid-hint kid-hidden', 'data-kid': 'hint', 'aria-hidden': 'true' });
    sparkLayer = el('div', { class: 'kid-sparks' });
    for (const b of [homeBtn, undoBtn, redoBtn]) {
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b.addEventListener('pointerup', () => b.classList.remove('bc-pressed'));
      b.addEventListener('pointercancel', () => b.classList.remove('bc-pressed'));
      b.addEventListener('pointerdown', () => b.classList.add('bc-pressed'));
    }
    layer.append(homeBtn, undoBtn, redoBtn, arrowEl, hintEl, sparkLayer);
  }

  function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  /** A restored block may now hold the player: lift them out silently. */
  function liftOut() {
    const p = game.player;
    if (playerCollides(p.x, p.y, p.z)) { const ty = freeY(p.x, p.y, p.z); p.y = p.prevY = ty; p.vy = 0; }
  }

  function press(b) { if (!b) return; b.classList.add('bc-pressed'); setTimeout(() => b.classList.remove('bc-pressed'), 160); }
  // one-shot animations: the class is removed when it ends, so re-showing the button never replays it
  function oneShot(b, cls) {
    if (!b) return;
    b.classList.remove(cls); void b.offsetWidth; b.classList.add(cls);
    setTimeout(() => b.classList.remove(cls), 500);
  }
  function spin(b) { oneShot(b, 'kid-spin'); }
  function shake(b) { oneShot(b, 'kid-shake'); }

  /** Full-screen fade: FX owns fades (the kid lane's own stub-era fade layer was removed on merge). */
  function fade(to, ms) {
    if (game.fx && game.fx.fade) { try { game.fx.fade(to, ms); } catch (err) { game.reportError(err, 'kid fade'); } }
  }

  /** Screen-space sparkle burst (DOM), centre by default. */
  function sparkle(x, y, n = 14) {
    if (!sparkLayer) return;
    const cx = x ?? window.innerWidth / 2, cy = y ?? window.innerHeight / 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 2) * 0.3;
      const r = 70 + (i % 3) * 45;
      const s = el('div', { class: 'kid-spark', html: ICONS.star() });
      s.style.left = cx + 'px'; s.style.top = cy + 'px';
      s.style.setProperty('--dx', Math.round(Math.cos(a) * r) + 'px');
      s.style.setProperty('--dy', Math.round(Math.sin(a) * r) + 'px');
      s.style.animationDelay = (i % 4) * 40 + 'ms';
      sparkLayer.appendChild(s);
      setTimeout(() => s.remove(), 1100);
    }
  }

  function renderHint(name, variant) {
    if (!hintEl) return;
    hintEl.innerHTML = hintHtml(name, variant);
    hintEl.dataset.hint = name;
    hintEl.dataset.variant = variant;
    hintEl.classList.remove('kid-hidden');
    hintShown = name;
  }
  function hideHint() {
    if (!hintEl || !hintShown) return;
    hintEl.classList.add('kid-hidden');
    hintEl.innerHTML = '';
    delete hintEl.dataset.hint;
    hintShown = null;
    stuckHintShown = false;
  }

  function updateArrow(show) {
    const m = game.meta, p = game.player;
    const h = m && (m.home || m.spawn);
    let vis = false;
    if (show && h && game.state === 'playing') {
      const d = dist2d(p.renderX ?? p.x, p.renderZ ?? p.z, h.x, h.z);
      // far away, or deep in the border fog (where nothing else shows the way back)
      vis = d > KID.HOME_ARROW_DIST || kid.border.fogT > 0.3;
      kid.homeArrow.dist = d;
      if (vis) {
        const deg = -homeArrowAngle(p.renderX ?? p.x, p.renderZ ?? p.z, p.yaw, h.x, h.z) / DEG;
        kid.homeArrow.deg = deg;
        if (Math.abs(deg - arrowDeg) > 0.75) { arrowDeg = deg; arrowRot.style.transform = `rotate(${deg.toFixed(1)}deg)`; }
      }
    }
    if (vis !== arrowShown) {
      arrowShown = vis; arrowEl.classList.toggle('kid-hidden', !vis); kid.homeArrow.visible = vis;
      layer.classList.toggle('kid-arrow-on', vis);   // hint plates move down below the arrow
    }
  }

  /* ------------------------------------------------------------------ world helpers */
  /** The player's box (shrunk by 0.02 so resting on or touching a block never counts) overlaps a solid block. */
  function bodyInBlock(p) {
    const hw = (p.width || 0.6) / 2 - 0.02, hh = (p.height || 1.8) - 0.04;
    return physicsBoxCollides(game.world, p.x - hw, p.y + 0.02, p.z - hw, p.x + hw, p.y + 0.02 + hh, p.z + hw);
  }
  function playerCollides(x, y, z) {
    const p = game.player, hw = (p.width || 0.6) / 2, hh = p.height || 1.8;
    return physicsBoxCollides(game.world, x - hw, y, z - hw, x + hw, y + hh, z + hw);
  }
  function columnLoaded(x, z) {
    const w = game.world;
    return !!(w && w.isColumnLoaded && w.isColumnLoaded(Math.floor(x) >> 4, Math.floor(z) >> 4));
  }
  function tickSettle() {
    const p = game.player;
    // the player moved away on their own (or another teleport), or it took too long: stop watching
    if (++settleAt.ticks > 20 * 30 || Math.abs(p.x - settleAt.x) > 1.5 || Math.abs(p.z - settleAt.z) > 1.5) { settleAt = null; return; }
    if (!columnLoaded(p.x, p.z)) return;
    settleAt = null;
    if (playerCollides(p.x, p.y, p.z)) {
      // buried: come out on top (findFreeY alone could stop in a cave pocket inside the hill)
      const sy = game.world.getSurfaceY(p.x, p.z);
      const y = freeY(p.x, sy >= 0 ? Math.max(sy, p.y) : p.y, p.z);
      p.teleport(p.x, y, p.z, 'home');
    }
  }
  /** Nearest y >= y where the player's box is free (physics.findFreeY; plain upward scan as a last resort). */
  function freeY(x, y, z) {
    const w = game.world;
    if (!w || !w.isColumnLoaded || !w.isColumnLoaded(Math.floor(x) >> 4, Math.floor(z) >> 4)) return y;
    if (!playerCollides(x, y, z)) return y;
    const p = game.player;
    const fy = physicsFindFreeY(w, x, y, z, p.width || 0.6, p.height || 1.8);
    if (fy < WORLD_HEIGHT && !playerCollides(x, fy, z)) return fy;
    for (let yy = Math.floor(y) + 1; yy < WORLD_HEIGHT; yy++) if (!playerCollides(x, yy, z)) return yy;
    return WORLD_HEIGHT;
  }
  /** Lowest y with a solid block in the column at (x, z); -1 when unloaded/none. Cached for 10 ticks per cell. */
  function lowestSolid(x, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    if (lowestCache.x === bx && lowestCache.z === bz && game.tickCount - lowestCache.tick < 10) return lowestCache.y;
    let y = -1;
    const w = game.world;
    if (w.isColumnLoaded(bx >> 4, bz >> 4)) {
      for (let yy = 0; yy < WORLD_HEIGHT; yy++) if (B_SOLID[w.getBlock(bx, yy, bz)]) { y = yy; break; }
    }
    lowestCache = { x: bx, z: bz, y, tick: game.tickCount };
    return y;
  }
  /** Yaw facing the latest build seen from home (within 96 blocks), else the stored home yaw, else null. */
  function facingYaw(h) {
    if (h && typeof h.yaw === 'number') return h.yaw;
    const cells = undoLog.recentCells(5, cellsTmp);
    if (!cells.length) return null;
    let sx = 0, sz = 0, n = 0;
    for (const c of cells) { sx += c.x + 0.5; sz += c.z + 0.5; n++; }
    sx /= n; sz /= n;
    const d = dist2d(h.x, h.z, sx, sz);
    if (d < 1.5 || d > 96) return null;
    return yawToward(h.x, h.z, sx, sz);
  }

  function voidRescue() {
    const p = game.player, w = game.world;
    let x = p.x, z = p.z;
    let sy = w.getSurfaceY(x, z);
    if (!(sy >= 0)) {
      const h = (game.meta.home || game.meta.spawn) || { x: 0.5, y: 64, z: 0.5 };
      x = h.x; z = h.z;
      sy = w.getSurfaceY(x, z);
      if (!(sy >= 0)) sy = h.y;
    }
    sy = freeY(x, sy, z);
    p.teleport(x, sy, z, 'void');
    p.fallDistance = 0;
    game.events.emit('kid:rescue', { reason: 'void' });
  }

  function tickStuck() {
    const p = game.player, w = game.world, inp = game.input;
    if (!w.isColumnLoaded(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4)) return;
    const hx = Math.floor(p.x), hz = Math.floor(p.z);
    const headId = w.getBlock(hx, Math.floor(p.y + (p.eyeHeight || 1.62)), hz);
    // head inside an opaque block, or the body inside any solid block (sand or gravel that fell on the child lands
    // in the feet cell; LEAD integration once falling blocks were real)
    const headInBlock = !!(B_OPAQUE[headId] && B_SOLID[headId]) || bodyInBlock(p);
    // enclosure is judged from the floor the player last stood on, so a hopeless jump inside a pit does not
    // count as "free" (the head clears the rim for a moment at the top of the jump)
    if (p.onGround || p.flying || p.inWater || p.onLadder || teleported || groundY === null) groundY = p.y;
    const ly = Math.floor(groundY + 1.2);
    const enclosed = !!(B_SOLID[w.getBlock(hx + 1, ly, hz)] && B_SOLID[w.getBlock(hx - 1, ly, hz)]
      && B_SOLID[w.getBlock(hx, ly, hz + 1)] && B_SOLID[w.getBlock(hx, ly, hz - 1)]);
    const mv = inp && inp.move ? inp.move : { forward: 0, strafe: 0 };
    const pushing = Math.abs(mv.forward) > 0.1 || Math.abs(mv.strafe) > 0.1;
    const jumpDown = !!(inp && inp.isDown && inp.isDown('jump'));
    const r = stuck.update({ x: p.x, z: p.z, pushing, enclosed, headInBlock, jumpDown });
    if (r === 'stuck') {
      game.events.emit('kid:stuck', { stuck: true, reason: stuck.reason });
      renderHint('unstuck', touchVariant());
      stuckHintShown = true;
    } else if (r === 'free') {
      game.events.emit('kid:stuck', { stuck: false, reason: null });
      if (stuckHintShown) hideHint();
    } else if (r === 'pop') {
      popOut(stuck.reason);
    }
  }

  function popOut(reason) {
    const p = game.player, w = game.world;
    let tx = p.x, tz = p.z, ty;
    if (reason === 'enclosed' && !playerCollides(p.x, p.y, p.z)) {
      // In a pit the player is not inside anything, so findFreeY would leave them there: climb onto the
      // lowest rim cell around them instead (the smallest climb that gets out).
      const bx = Math.floor(p.x), bz = Math.floor(p.z);
      let best = Infinity;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const sy = w.getSurfaceY(bx + dx + 0.5, bz + dz + 0.5);
        if (sy >= (groundY ?? p.y) - 1e-6 && sy < best) { best = sy; tx = bx + dx + 0.5; tz = bz + dz + 0.5; }
      }
      ty = best < Infinity ? freeY(tx, best, tz) : freeY(p.x, p.y + 1, p.z);
      if (best === Infinity) { tx = p.x; tz = p.z; }
    } else ty = freeY(p.x, p.y, p.z);
    p.teleport(tx, ty, tz, 'stuck');
    stuck.reset();
    game.events.emit('kid:rescue', { reason: 'stuck' });
    game.events.emit('kid:stuck', { stuck: false, reason: null });
    if (stuckHintShown) hideHint();
    sparkle(null, null, 10);
  }

  function tickBorder(radius) {
    const p = game.player;
    let s = game.meta.spawn;
    if (!(radius > 0) || !s) { clearFog(); kid.border.over = 0; kid.border.fogT = 0; return; }
    // LEAD v1.7 (FID-8): in the Nether the border is around the spawn's Nether point, 1:8 (at least 64 blocks)
    if (isNetherX(p.x)) { s = toNether(s.x, s.z); radius = Math.max(64, radius / 8); }
    borderState(p.x, p.z, s.x, s.z, radius, bs);
    kid.border.dist = bs.dist; kid.border.over = bs.over; kid.border.fogT = bs.fogT;
    if (bs.over > 0) {
      // remove the outward part of the velocity, then push back 0.1 b/t toward the spawn
      const out = -(p.vx * bs.nx + p.vz * bs.nz);
      if (out > 0) { p.vx += out * bs.nx; p.vz += out * bs.nz; }
      const dx = bs.nx * BORDER_PUSH, dz = bs.nz * BORDER_PUSH;
      const og = p.onGround, ch = p.collidedH, cv = p.collidedV;
      moveAndCollide(game.world, p, dx, 0, dz, {});
      p.onGround = og; p.collidedH = ch; p.collidedV = cv;
    }
    const r = game.renderer;
    if (!r || !r.setFogOverride) return;
    const t = bs.fogT;
    if (t <= 0) { if (lastFogT > 0) clearFog(); return; }
    if (Math.abs(t - lastFogT) > 0.02 || (t >= 1 && lastFogT < 1)) {
      const base = typeof r.renderFar === 'number' ? r.renderFar : (game.world.renderDistance || 6) * 16;
      borderFog(t, base, fogTmp);
      r.setFogOverride(fogTmp.near, fogTmp.far);
      lastFogT = t;
    }
  }
  function clearFog() {
    if (lastFogT > 0 && game.renderer && game.renderer.setFogOverride) game.renderer.setFogOverride(null);
    lastFogT = 0;
  }

  /* ------------------------------------------------------------------ hints */
  function completeHint(name) {
    const r = hints.complete(name);
    if (r.hide && hintShown === name) hideHint();
    if (r.first && r.wasShown) {
      game.events.emit('sound', { name: 'ui.success' });
      sparkle(null, window.innerHeight * 0.3, 12);
    }
  }
  function tickHints() {
    const p = game.player, inp = game.input;
    // progress detection that has no event: walking and turning by drag/joystick
    if (inp && inp.move && Math.abs(inp.move.forward) > 0.1) { if (++walkTicks >= 6) completeHint('walk'); } else walkTicks = 0;
    if (!teleported) {
      turnAccum += Math.abs(wrapAngle(p.yaw - lastYaw));
      if (turnAccum > 30 * DEG) completeHint('turn');
    }
    const allowed = !!game.settings.hints && game.settings.controls !== 'classic' && !game.ui.current && !stuckHintShown;
    const r = hints.tick(allowed, game.player.canFly ? game.player.canFly() : true);
    if (r.hide && hintShown && !stuckHintShown) hideHint();
    if (r.show) {
      const v = touchVariant();
      renderHint(r.show, v);
      game.events.emit('hint', { name: r.show });
      if (game.settings.speakNames && HINT_LINES[r.show]) speech.say(HINT_LINES[r.show][v === 'touch' ? 'touch' : 'keys'], 0);
    }
  }

  function resetWorldState() {
    undoLog.clear();
    redoUntil = 0;
    stuck.reset();
    homeSeq = -1;
    kid.homeSeqActive = false;
    walkTicks = 0; turnAccum = 0;
    lowestCache = { x: NaN, z: NaN, y: -1, tick: -100 };
    groundY = null;
    settleAt = null;
    fade(0, 0);
    hideHint();
    if (game.player) lastYaw = game.player.yaw;
  }

  return kid;
}
