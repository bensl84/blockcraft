// OWNER LANE: KID (touch). SPEC §8.5.1, §10.3. API FROZEN: visible, setVisible(bool) (+ additive members below).
// On-screen controls in uiLayer(game, 'touch', Z.TOUCH), shown when settings.touchControls === 'on', or 'auto'
// and the last pointer was a touch (input.lastPointerType, kept by CORE-E's window pointerdown listener):
//   - D-pad bottom left (▲ forward, ▼ back, ◀ ▶ TURN via setVirtual('turnLeft'/'turnRight')), one capture
//     area with a 12 px safe ring; the finger may slide between the 8 sectors (diagonals = walk + turn).
//     Optional fixed joystick (160 px base, 64 px knob) via setMoveVector: setStyle('joystick').
//   - Jump / Up (112 px at size M) bottom right, Fly toggle above it (creative only), Down ▼ left of it
//     (only while flying, setVirtual('descend')). Pause top right. Home + Undo live in kid.js (top left).
//   - Hotbar + inventory button: FEATURE-INV (HUD). The world area (tap / hold / drag look) is CORE-E's.
// Buttons act on pointerdown, capture their pointer, track pointers by id and ignore palms (> 40 px contacts).
// Mirrored when settings.leftHanded. Plates rgba(0,0,0,0.55), white glyphs, opacity settings.touchOpacity.

import './touch.css';
import { el, uiLayer } from '../core/dom.js';
import { Z } from '../core/constants.js';
import { ICONS } from '../kid/pixelicons.js';
import { dpadActions, dpadRects, isPalm, joystickVector, touchLayout, wantTouch } from './touch_logic.js';

const STYLE_KEY = 'blockcraft:touchStyle';
const DPAD_ACTIONS = ['forward', 'back', 'turnLeft', 'turnRight'];

/** @returns {object} Touch system (game.touch) */
export function createTouchSystem(game) {
  let layer = null;
  const els = {};
  /** actions currently held by the overlay (released when it hides) */
  const held = new Set();
  let forced = null;            // setVisible override (true/false) or null = automatic
  let layoutKey = '';
  let style = 'dpad';
  let joyTurn = 0;              // joystick turning (-1..1) applied per frame in the kid scheme
  let joyActive = false;
  const dp = {};
  const jv = {};

  const touch = {
    name: 'touch',
    /** true while the on-screen controls are visible */
    visible: false,
    /** 'dpad' | 'joystick' (per device, localStorage; LEAD request: a settings key) */
    get style() { return style; },
    /** the last computed layout (tests) */
    layout: null,

    init() {
      try { const s = localStorage.getItem(STYLE_KEY); if (s === 'joystick' || s === 'dpad') style = s; } catch { /* private mode */ }
      build();
      game.events.on('settings:changed', (e) => {
        if (e.key === 'buttonSize' || e.key === 'leftHanded') layoutKey = '';
        if (e.key === 'touchOpacity') applyOpacity();
        if (e.key === 'controls') releaseAll();
      });
      game.events.on('kid:stuck', (e) => { if (els.jump) els.jump.classList.toggle('touch-pulse', !!(e && e.stuck)); });
      game.events.on('world:exit', () => { releaseAll(); if (els.jump) els.jump.classList.remove('touch-pulse'); });
      window.addEventListener('blur', () => releaseAll());
      document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
      window.addEventListener('resize', () => { layoutKey = ''; });
      applyOpacity();
    },

    frame(g, dt) {
      const want = forced !== null ? forced
        : wantTouch(game.settings.touchControls, game.input ? game.input.lastPointerType : 'mouse');
      const show = !!want && game.state === 'playing' && !!game.meta && !game.ui.current;
      if (show !== touch.visible) {
        touch.visible = show;
        layer.classList.toggle('touch-off', !show);
        if (!show) releaseAll();
      }
      if (!show) return;
      relayout();
      const p = game.player;
      const canFly = p && p.canFly ? p.canFly() : false;
      setShown(els.fly, canFly);
      setShown(els.down, !!(p && p.flying));
      els.jump.classList.toggle('touch-flying', !!(p && p.flying));
      // joystick turning in the kid scheme (no strafe there): yaw rate like held arrow keys
      if (joyActive && joyTurn !== 0 && game.input && game.input.addLook) {
        const degPerSec = 60 + 80 * (game.settings.turnSpeed ?? 0.5);
        game.input.addLook(-joyTurn * degPerSec * (Math.PI / 180) * Math.min(dt || 0, 0.1), 0);
      }
    },

    /** Force show/hide (tests: --touch scenario). null returns to automatic. */
    setVisible(v) { forced = v === null || v === undefined ? null : !!v; },

    /** 'dpad' or 'joystick' (stored per device). */
    setStyle(s) {
      if (s !== 'dpad' && s !== 'joystick') return style;
      releaseAll();
      style = s;
      try { localStorage.setItem(STYLE_KEY, s); } catch { /* ignore */ }
      layoutKey = '';
      return style;
    },

    /** Actions the overlay holds right now (tests). */
    held() { return [...held]; },
    releaseAll() { releaseAll(); },
  };

  /* ------------------------------------------------------------------ DOM */
  function build() {
    layer = uiLayer(game, 'touch', Z.TOUCH);
    layer.classList.add('touch-layer', 'touch-off');
    layer.addEventListener('contextmenu', (e) => e.preventDefault());

    // D-pad: one capture area + 4 visual buttons
    els.dpad = el('div', { class: 'touch-dpad', 'data-interactive': '', 'data-touch': 'dpad', role: 'group', 'aria-label': 'Move' });
    els.dpadBtns = {};
    for (const a of DPAD_ACTIONS) {
      const b = el('div', { class: 'bc-plate-btn touch-btn touch-dpad-btn', 'data-touch': a, html: ICONS[a]() });
      els.dpadBtns[a] = b;
      els.dpad.appendChild(b);
    }
    bindDpad(els.dpad);

    // joystick
    els.joyKnob = el('div', { class: 'touch-joy-knob' });
    els.joy = el('div', { class: 'touch-joy', 'data-interactive': '', 'data-touch': 'joystick', role: 'group', 'aria-label': 'Move' }, [els.joyKnob]);
    bindJoystick(els.joy);

    els.jump = holdButton('jump', 'jump', ICONS.jump(), 'Jump');
    els.jump.querySelector('svg').insertAdjacentHTML('afterend', `<span class="touch-up-glyph">${ICONS.up()}</span>`);
    els.down = holdButton('down', 'descend', ICONS.down(), 'Fly down');
    els.fly = tapButton('fly', () => game.input.press('toggleFly'), ICONS.fly(), 'Fly');
    els.pause = tapButton('pause', () => game.input.press('pause'), ICONS.pause(), 'Pause');
    layer.append(els.dpad, els.joy, els.jump, els.down, els.fly, els.pause);
  }

  function setShown(e, v) { if (e && e.classList.contains('touch-hidden') === v) e.classList.toggle('touch-hidden', !v); }
  function applyOpacity() { if (layer) layer.style.setProperty('--touch-opacity', String(game.settings.touchOpacity ?? 0.85)); }

  function place(e, r) { Object.assign(e.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }); }

  /** The HUD's bottom block (hotbar + backpack + survival rows) in CSS px, or null before it is built. */
  function hudBox() {
    const b = document.querySelector('#hud .inv-hud-bottom');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    let left = r.left, right = r.right, top = r.top;
    const bp = document.querySelector('#hud .inv-backpack');
    if (bp) { const q = bp.getBoundingClientRect(); if (q.width > 0) { left = Math.min(left, q.left); right = Math.max(right, q.right); top = Math.min(top, q.top); } }
    return { left, right, top };
  }

  function relayout() {
    const W = window.innerWidth, H = window.innerHeight;
    // the HUD block depends on the window, GUI scale and mode (survival rows): measure it again when they change
    const key = `${W}x${H}:${game.settings.buttonSize}:${game.settings.leftHanded}:${style}:${game.settings.guiScale}:${game.meta ? game.meta.mode : ''}`;
    if (key === layoutKey) return;
    layoutKey = key;
    const L = touchLayout(W, H, game.settings.buttonSize, !!game.settings.leftHanded, hudBox());
    touch.layout = L;
    const d = L.dpad, hit = d.hit;
    place(els.dpad, { x: d.cx - hit, y: d.cy - hit, w: hit * 2, h: hit * 2 });
    const rects = dpadRects(d);
    for (const a of DPAD_ACTIONS) {
      const r = rects[a];
      place(els.dpadBtns[a], { x: r.x - (d.cx - hit), y: r.y - (d.cy - hit), w: r.w, h: r.h });
    }
    const j = L.joystick;
    place(els.joy, { x: j.cx - j.base / 2, y: j.cy - j.base / 2, w: j.base, h: j.base });
    place(els.jump, L.jump); place(els.fly, L.fly); place(els.down, L.down); place(els.pause, L.pause);
    setShown(els.dpad, style === 'dpad');
    setShown(els.joy, style === 'joystick');
  }

  /* ------------------------------------------------------------------ input plumbing */
  function hold(action, down) {
    const inp = game.input;
    if (!inp) return;
    if (down && !held.has(action)) { held.add(action); inp.setVirtual(action, true); }
    else if (!down && held.has(action)) { held.delete(action); inp.setVirtual(action, false); }
  }
  function releaseAll() {
    for (const a of [...held]) hold(a, false);
    if (joyActive && game.input) game.input.setMoveVector(0, 0);
    joyActive = false; joyTurn = 0;
    if (els.joyKnob) els.joyKnob.style.transform = 'translate(-50%, -50%)';
    if (els.dpadBtns) for (const a of DPAD_ACTIONS) els.dpadBtns[a].classList.remove('bc-pressed');
    if (layer) for (const b of layer.querySelectorAll('.bc-pressed')) b.classList.remove('bc-pressed');
  }

  /** Pointer tracking for one element: first non-palm pointer owns it; captures; calls cb on down/move/up. */
  function track(target, { down, move, up }) {
    const ptrs = new Set();
    target.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (isPalm(e.width, e.height)) return;
      try { target.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      ptrs.add(e.pointerId);
      down(e, ptrs.size);
    });
    target.addEventListener('pointermove', (e) => { if (ptrs.has(e.pointerId) && move) { e.preventDefault(); move(e); } });
    const end = (e) => { if (!ptrs.delete(e.pointerId)) return; up(e, ptrs.size); };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('lostpointercapture', end);
  }

  function holdButton(id, action, icon, label) {
    const b = el('div', { class: 'bc-plate-btn touch-btn', role: 'button', 'aria-label': label, 'data-interactive': '', 'data-touch': id, html: icon });
    track(b, {
      down: () => { b.classList.add('bc-pressed'); hold(action, true); },
      up: (e, left) => { if (left === 0) { b.classList.remove('bc-pressed'); hold(action, false); } },
    });
    return b;
  }

  function tapButton(id, fn, icon, label) {
    const b = el('div', { class: 'bc-plate-btn touch-btn', role: 'button', 'aria-label': label, 'data-interactive': '', 'data-touch': id, html: icon });
    track(b, {
      down: (e, n) => { b.classList.add('bc-pressed'); if (n === 1) { game.events.emit('ui:click', {}); fn(); } },
      up: (e, left) => { if (left === 0) b.classList.remove('bc-pressed'); },
    });
    return b;
  }

  function bindDpad(area) {
    let owner = null;
    const apply = (e) => {
      const r = area.getBoundingClientRect();
      const d = touch.layout ? touch.layout.dpad : null;
      const dead = d ? d.btn * 0.32 : 28;
      dpadActions(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), dead, dp);
      for (const a of DPAD_ACTIONS) {
        hold(a, dp[a]);
        els.dpadBtns[a].classList.toggle('bc-pressed', dp[a]);
      }
    };
    area.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (owner !== null || isPalm(e.width, e.height)) return;
      owner = e.pointerId;
      try { area.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      apply(e);
    });
    area.addEventListener('pointermove', (e) => { if (e.pointerId === owner) { e.preventDefault(); apply(e); } });
    const end = (e) => {
      if (e.pointerId !== owner) return;
      owner = null;
      for (const a of DPAD_ACTIONS) { hold(a, false); els.dpadBtns[a].classList.remove('bc-pressed'); }
    };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
    area.addEventListener('lostpointercapture', end);
  }

  function bindJoystick(area) {
    let owner = null;
    const apply = (e) => {
      const r = area.getBoundingClientRect();
      const L = touch.layout;
      joystickVector(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), L ? L.joystick.travel : 48, jv);
      els.joyKnob.style.transform = `translate(calc(-50% + ${jv.kx}px), calc(-50% + ${jv.ky}px))`;
      const kidScheme = game.settings.controls !== 'classic';
      game.input.setMoveVector(jv.fx, kidScheme ? 0 : jv.sx);
      joyTurn = kidScheme ? jv.sx : 0;
      joyActive = true;
    };
    area.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (owner !== null || isPalm(e.width, e.height)) return;
      owner = e.pointerId;
      try { area.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      area.classList.add('bc-pressed');
      apply(e);
    });
    area.addEventListener('pointermove', (e) => { if (e.pointerId === owner) { e.preventDefault(); apply(e); } });
    const end = (e) => {
      if (e.pointerId !== owner) return;
      owner = null;
      area.classList.remove('bc-pressed');
      els.joyKnob.style.transform = 'translate(-50%, -50%)';
      if (game.input) game.input.setMoveVector(0, 0);
      joyActive = false; joyTurn = 0;
    };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
    area.addEventListener('lostpointercapture', end);
  }

  return touch;
}
