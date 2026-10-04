// OWNER LANE: CORE-E (player/physics/input/raycast/interaction). The API is FROZEN (SPEC §7.1).
//
// Keyboard (per-scheme KEY_BINDINGS, held state counted per key code so W + ArrowUp never stick), kid pointer
// gestures on the canvas for mouse + touch + pen (tap = use, hold 350 ms = attack, drag > 12 px = look; every
// button means the same thing; first pointer only; palms > 40 px ignored), classic pointer lock (unadjustedMovement
// with plain fallback, silent relock cooldown, 150 ms motion drop after lock changes, > 400 px spike filter),
// notched-wheel-only hotbar scrolling (trackpad swipes ignored, wheel always preventDefault in play = no pinch
// zoom), kid keyboard turning (12 deg tap nudge, ramp over 200 ms to 60 + 80*turnSpeed deg/s), PageUp/PageDown
// pitch, and releaseAll on blur / hidden / pointer-lock change / fullscreen change / setCaptured(true).
//
// Must stay importable in Node (test/foundation.test.mjs imports KEY_BINDINGS): no DOM access at module level.
//
// Lane events (documented in docs/handoff/coree.md): 'input:gesture' {phase: 'down'|'hold'|'tap'|'drag'|'up'|
// 'cancel', x, y (NDC), pointerType} - lets FX/AUDIO react on pointerdown within 50 ms (ring / crack start).

import { KID_GESTURE } from '../core/constants.js';

/** Every action name the game understands. */
export const ACTIONS = Object.freeze([
  'forward', 'back', 'left', 'right', 'turnLeft', 'turnRight', 'lookUp', 'lookDown',
  'jump', 'sneak', 'descend', 'sprint', 'attack', 'use', 'pick', 'drop',
  'inventory', 'pause', 'hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6', 'hotbar7', 'hotbar8', 'hotbar9',
  'hotbarNext', 'hotbarPrev', 'toggleFly', 'toggleView', 'home', 'undo', 'toggleHud', 'debug',
]);

/** Actions that are UI/one-shot (fire 'input:action' immediately, also while a screen captures input). */
export const UI_ACTIONS = Object.freeze(new Set(['inventory', 'pause', 'hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5',
  'hotbar6', 'hotbar7', 'hotbar8', 'hotbar9', 'hotbarNext', 'hotbarPrev', 'toggleView', 'home', 'undo', 'toggleHud', 'debug', 'toggleFly', 'drop', 'pick']));

/**
 * KeyboardEvent.code -> action, per control scheme. Never bind Ctrl/Alt/Meta/Tab/F-keys in the kid scheme
 * (Ctrl+W closes the tab) - nor Shift: five quick Shift presses open the Windows Sticky Keys dialog and drop
 * fullscreen. Kid fly-down is 'descend' on C / Z (and the touch ▼ button). SPEC §10.1.
 */
export const KEY_BINDINGS = Object.freeze({
  kid: Object.freeze({
    KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
    KeyA: 'turnLeft', ArrowLeft: 'turnLeft', KeyD: 'turnRight', ArrowRight: 'turnRight',
    PageUp: 'lookUp', PageDown: 'lookDown',
    Space: 'jump', KeyC: 'descend', KeyZ: 'descend',
    KeyE: 'inventory', Escape: 'pause', KeyF: 'toggleFly', KeyH: 'home', KeyU: 'undo', KeyV: 'toggleView',
    Digit1: 'hotbar1', Digit2: 'hotbar2', Digit3: 'hotbar3', Digit4: 'hotbar4', Digit5: 'hotbar5',
    Digit6: 'hotbar6', Digit7: 'hotbar7', Digit8: 'hotbar8', Digit9: 'hotbar9',
  }),
  classic: Object.freeze({
    KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
    ArrowUp: 'lookUp', ArrowDown: 'lookDown', ArrowLeft: 'turnLeft', ArrowRight: 'turnRight',
    Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak', ControlLeft: 'sprint', KeyR: 'sprint',
    KeyE: 'inventory', KeyQ: 'drop', Escape: 'pause', KeyF: 'toggleFly', KeyH: 'home', KeyU: 'undo',
    F5: 'toggleView', KeyV: 'toggleView', F1: 'toggleHud', F3: 'debug',
    Digit1: 'hotbar1', Digit2: 'hotbar2', Digit3: 'hotbar3', Digit4: 'hotbar4', Digit5: 'hotbar5',
    Digit6: 'hotbar6', Digit7: 'hotbar7', Digit8: 'hotbar8', Digit9: 'hotbar9',
  }),
});

/* ------------------------------------------------------------------ tunables (SPEC §7.1) */
const DEG = Math.PI / 180;
export const INPUT_TUNING = Object.freeze({
  DRAG_K: 0.0035,            // kid drag look: rad/px x (0.5 + lookSensitivity)
  MOUSE_K: 0.0022,           // classic pointer-lock look: rad/count x (0.5 + lookSensitivity)
  LOCK_SETTLE_MS: 150,       // drop mouse motion for this long after a lock change
  SPIKE_PX: 400,             // discard motion events larger than this on either axis
  RELOCK_COOLDOWN_MS: 1100,  // browsers refuse a relock for ~1 s after Esc
  TURN_NUDGE_DEG: 12,        // tap on turn keys
  TURN_NUDGE_MS: 90,         // nudge is applied over this long (smooth, still < 50 ms to first motion)
  TURN_HOLD_MS: 150,         // a turn key held longer than this starts the continuous turn...
  TURN_RAMP_MS: 200,         // ...which ramps to full rate over this long
  PITCH_KEY_DEG_S: 60,       // PageUp / PageDown
  WHEEL_MIN_MS: 150,         // at most one hotbar step per 150 ms
  PALM_PX: 40,               // touch contacts larger than this are palms
  PRESS_MS: 60,              // one-shot press() duration
  SWIPE_SCALE: 0.6,          // kid trackpad two-finger swipe: look rate relative to the drag rate (~0.12 deg/px)
  SWIPE_MAX_PX: 120,         // clamp of one swipe event's delta (px) per axis
});
/** A hold timer this late means the main thread stalled: give a queued pointerup this long to arrive first. */
const HOLD_STALL_MS = 50;
const HOLD_GRACE_MS = 120;

/** True when a wheel event looks like a notched mouse wheel (not a trackpad swipe or pinch). Exported for tests. */
export function isNotchedWheel(e) {
  if (!e || e.ctrlKey) return false;                 // pinch-zoom gesture on trackpads arrives as ctrl+wheel
  const dy = e.deltaY || 0;
  if (dy === 0) return false;
  if (e.deltaMode === 1 || e.deltaMode === 2) return true; // lines / pages: always a wheel
  const wd = e.wheelDeltaY;
  if (typeof wd === 'number' && wd !== 0 && Math.abs(wd) % 120 === 0) return true;
  const a = Math.abs(dy);
  // Chrome on Windows reports 100 px per notch (x display scale in some versions); others 120 / 53*n.
  return a % 120 === 0 || (a >= 100 && a % 100 === 0);
}

/** @returns {object} Input system (game.input). */
export function createInputSystem(game) {
  const codesDown = new Map();        // KeyboardEvent.code -> action
  const keyCount = new Map();         // action -> number of keys holding it
  const pointerHeld = new Set();      // actions held by mouse buttons / kid hold gesture
  const virtualHeld = new Set();      // actions held via setVirtual (touch buttons, tests)
  let pressedQueue = new Set();       // actions pressed since the last tick
  let pressedThisTick = new Set();
  const captures = new Set();
  const pressTimers = new Map();      // action -> timeout id of a pending press() release

  // kid gesture on the canvas (first pointer only)
  // {id, type, x0, y0, lastX, lastY, t0 (handler time), tDown (event time), mode: 'pending'|'holdPending'|'hold'|'drag', timer, commitAt}
  let gesture = null;
  // classic pointer lock bookkeeping
  let lockChangeAt = -1e9, lastUnlockAt = -1e9;
  let lastWheelAt = -1e9;
  // keyboard turning
  const turn = { left: { held: false, t0: 0 }, right: { held: false, t0: 0 }, nudge: 0 };

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const emit = (action, down, source) => game.events.emit('input:action', { action, down, source });
  const isPlaying = () => game.state === 'playing';

  function anyHeld(action) {
    return (keyCount.get(action) || 0) > 0 || pointerHeld.has(action) || virtualHeld.has(action);
  }

  /** NDC of a client point on the canvas. */
  function toNdc(clientX, clientY, out) {
    const c = game.canvas;
    const r = c && c.getBoundingClientRect ? c.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const w = r.width || 1, h = r.height || 1;
    out.x = Math.max(-1, Math.min(1, ((clientX - r.left) / w) * 2 - 1));
    out.y = Math.max(-1, Math.min(1, -(((clientY - r.top) / h) * 2 - 1)));
    return out;
  }
  function setAimFromClient(clientX, clientY) { toNdc(clientX, clientY, input.aim); input.aimActive = true; }

  function holdPointerAction(action, source) {
    if (pointerHeld.has(action)) return;
    pointerHeld.add(action);
    pressedQueue.add(action);
    emit(action, true, source);
  }
  function releasePointerAction(action, source) {
    if (!pointerHeld.delete(action)) return;
    emit(action, false, source);
  }
  /** One-shot press from a pointer (kid tap): queued for the next tick, down + up events. */
  function tapAction(action, source) {
    pressedQueue.add(action);
    emit(action, true, source);
    emit(action, false, source);
  }

  function setPointerType(type) {
    const t = type === 'touch' || type === 'pen' ? type : 'mouse';
    if (t === input.lastPointerType) return;
    input.lastPointerType = t;
    game.events.emit('input:pointerType', { type: t });
  }

  function gestureEvent(phase, x, y, pointerType) {
    game.events.emit('input:gesture', { phase, x, y, pointerType });
  }

  function cancelGesture(reason = 'cancel') {
    if (!gesture) return;
    if (gesture.timer) clearTimeout(gesture.timer);
    if (gesture.mode === 'hold') releasePointerAction('attack', gesture.type);
    const g = gesture;
    gesture = null;
    gestureEvent(reason, input.aim.x, input.aim.y, g.type);
  }

  /* ---------------- keyboard ---------------- */
  function onKeyDown(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const action = KEY_BINDINGS[input.scheme][e.code];
    if (!action) return;
    if (input.scheme === 'kid' && (e.ctrlKey || e.altKey || e.metaKey)) return; // Ctrl+W etc. are never ours
    e.preventDefault();
    if (e.repeat || codesDown.has(e.code)) return;
    codesDown.set(e.code, action);
    const n = (keyCount.get(action) || 0) + 1;
    keyCount.set(action, n);
    if (n === 1) { pressedQueue.add(action); emit(action, true, 'key'); }
  }
  function onKeyUp(e) {
    const action = codesDown.get(e.code);
    if (!action) return;
    codesDown.delete(e.code);
    const n = Math.max(0, (keyCount.get(action) || 0) - 1);
    if (n === 0) keyCount.delete(action); else keyCount.set(action, n);
    if (n === 0) emit(action, false, 'key');
  }

  /* ---------------- pointer: kid gestures (mouse + touch + pen), classic touch ---------------- */
  function onPointerDownAny(e) { setPointerType(e.pointerType); }

  function onPointerDown(e) {
    const type = e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse';
    if (input.scheme === 'classic' && type === 'mouse') return;            // classic mouse: mousedown handler
    if (type === 'touch' && (e.width > INPUT_TUNING.PALM_PX || e.height > INPUT_TUNING.PALM_PX)) return; // palm
    if (!isPlaying() || captures.size > 0) return;
    if (gesture) return;                                                    // only the first pointer acts / looks
    if (e.cancelable) e.preventDefault();
    try { game.canvas.focus({ preventScroll: true }); } catch { /* ignore */ }
    setAimFromClient(e.clientX, e.clientY);
    const t0 = now();
    gesture = { id: e.pointerId, type, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, t0, tDown: eventTime(e, t0), mode: 'pending', timer: 0, commitAt: 0 };
    try { game.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    gesture.timer = setTimeout(() => {
      if (!gesture || gesture.mode !== 'pending') return;
      // Not a hold yet: the attack is pressed by the next tick (commitHold). When this timer ran late, the main
      // thread stalled, and a quick release may still be queued behind it: wait a short grace period so that
      // pointerup (classified by its own timestamp) can turn the gesture back into a tap.
      const t = now();
      const late = t - (gesture.t0 + KID_GESTURE.HOLD_MS);
      gesture.mode = 'holdPending';
      gesture.timer = 0;
      gesture.commitAt = late > HOLD_STALL_MS ? t + HOLD_GRACE_MS : t;
    }, KID_GESTURE.HOLD_MS);
    gestureEvent('down', input.aim.x, input.aim.y, type);
  }

  /** Event time in the performance.now() timebase (falls back to the handler time). */
  function eventTime(e, fallback) {
    const ts = e && e.timeStamp;
    return Number.isFinite(ts) && ts > 0 && ts <= fallback + 1000 ? ts : fallback;
  }

  /** Turn a pending hold into a real hold (attack pressed): run first in every tick, never from a timer. */
  function commitHold(force = false) {
    const g = gesture;
    if (!g || g.mode !== 'holdPending' || (!force && now() < g.commitAt)) return;
    g.mode = 'hold';
    holdPointerAction('attack', g.type);
    gestureEvent('hold', input.aim.x, input.aim.y, g.type);
  }

  function onPointerMove(e) {
    if (gesture && e.pointerId === gesture.id) {
      const dx = e.clientX - gesture.lastX, dy = e.clientY - gesture.lastY;
      gesture.lastX = e.clientX; gesture.lastY = e.clientY;
      // a pending hold whose move happened (by event time) within the first HOLD_MS can still become a drag
      const early = gesture.mode === 'pending' || (gesture.mode === 'holdPending' && eventTime(e, now()) - gesture.tDown < KID_GESTURE.HOLD_MS);
      if (early) {
        const moved = Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0);
        if (moved > KID_GESTURE.DRAG_PX) {
          if (gesture.timer) clearTimeout(gesture.timer);
          gesture.timer = 0;
          gesture.mode = 'drag';
          gestureEvent('drag', input.aim.x, input.aim.y, gesture.type);
          dragLook(e.clientX - gesture.x0, e.clientY - gesture.y0);
        }
      } else if (gesture.mode === 'drag') {
        dragLook(dx, dy);
      } else if (gesture.mode === 'hold' || gesture.mode === 'holdPending') {
        setAimFromClient(e.clientX, e.clientY);                            // the aim follows small moves
      }
      return;
    }
    // kid hover: the free cursor aims (mouse / pen only)
    if (input.scheme === 'kid' && e.pointerType !== 'touch' && !gesture) setAimFromClient(e.clientX, e.clientY);
  }

  function dragLook(dx, dy) {
    const k = INPUT_TUNING.DRAG_K * (0.5 + (game.settings.lookSensitivity ?? 0.5));
    const inv = game.settings.invertY ? -1 : 1;
    input.lookDelta.yaw += -dx * k;
    input.lookDelta.pitch += -dy * k * inv;
    input.noteManualLook();
  }

  function onPointerUp(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    if (g.timer) clearTimeout(g.timer);
    // Classify by the events' own timestamps, not by when the handlers ran: after a main-thread stall a quick
    // tap must stay a tap (never a break), even when the hold timer already fired.
    const dur = eventTime(e, now()) - g.tDown;
    const tap = (g.mode === 'pending' && dur < KID_GESTURE.TAP_MAX_MS + 50) || (g.mode === 'holdPending' && dur < KID_GESTURE.HOLD_MS);
    if (tap) {
      setAimFromClient(e.clientX, e.clientY);
      tapAction('use', g.type);
      gestureEvent('tap', input.aim.x, input.aim.y, g.type);
    } else if (g.mode === 'pending' || g.mode === 'holdPending') {
      // a real hold released before the next tick: still one attack press (the tick sees wasPressed)
      gesture = g; commitHold(true); gesture = null;
      releasePointerAction('attack', g.type);
    } else if (g.mode === 'hold') {
      releasePointerAction('attack', g.type);
    }
    gestureEvent('up', input.aim.x, input.aim.y, g.type);
    try { game.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onPointerCancel(e) { if (gesture && e.pointerId === gesture.id) cancelGesture('cancel'); }

  function onPointerLeave(e) {
    if (e.pointerType === 'mouse' && !gesture && input.scheme === 'kid') input.aimActive = false;
  }

  /* ---------------- classic: pointer lock + mouse buttons ---------------- */
  const BUTTON_ACTION = ['attack', 'pick', 'use'];
  function onMouseDown(e) {
    if (input.scheme !== 'classic') return;
    if (!input.pointerLocked) {
      if (e.target === game.canvas && isPlaying() && captures.size === 0 && e.button === 0) input.requestPointerLock();
      return;
    }
    const action = BUTTON_ACTION[e.button];
    if (!action) return;
    e.preventDefault();
    holdPointerAction(action, 'mouse');
  }
  function onMouseUp(e) {
    const action = BUTTON_ACTION[e.button];
    if (action) releasePointerAction(action, 'mouse');
  }
  function onMouseMove(e) {
    if (!input.pointerLocked) return;
    if (now() - lockChangeAt < INPUT_TUNING.LOCK_SETTLE_MS) return;
    const mx = e.movementX || 0, my = e.movementY || 0;
    if (Math.abs(mx) > INPUT_TUNING.SPIKE_PX || Math.abs(my) > INPUT_TUNING.SPIKE_PX) return;
    if (!isPlaying() || captures.size > 0) return;
    const k = INPUT_TUNING.MOUSE_K * (0.5 + (game.settings.lookSensitivity ?? 0.5));
    const inv = game.settings.invertY ? -1 : 1;
    input.lookDelta.yaw += -mx * k;
    input.lookDelta.pitch += -my * k * inv;
    input.noteManualLook();
  }
  function onPointerLockChange() {
    const locked = !!game.canvas && document.pointerLockElement === game.canvas;
    if (locked === input.pointerLocked) return;
    input.pointerLocked = locked;
    lockChangeAt = now();
    if (!locked) lastUnlockAt = lockChangeAt;
    input.releaseAll();
    if (locked) { input.aim.x = 0; input.aim.y = 0; input.aimActive = true; }
    game.events.emit('input:pointerLock', { locked });
  }

  /* ---------------- wheel ---------------- */
  function onWheel(e) {
    const onCanvas = e.target === game.canvas;
    if (e.ctrlKey) { e.preventDefault(); return; }                       // pinch zoom: never zoom the page
    if (captures.size > 0 && !onCanvas) return;                          // let open screens scroll their lists
    e.preventDefault();
    if (!isPlaying()) return;
    if (!isNotchedWheel(e)) {                                            // trackpad swipes never spin the hotbar...
      // ...in the kid scheme a two-finger swipe over the world looks around instead (judge KID-5: looking up at a
      // tower while standing needed a click-and-slide on the pad). Swipe left/right turns, up/down tilts.
      if (input.scheme === 'kid' && onCanvas && captures.size === 0 && !input.pointerLocked) swipeLook(e);
      return;
    }
    const t = now();
    if (t - lastWheelAt < INPUT_TUNING.WHEEL_MIN_MS) return;
    lastWheelAt = t;
    const action = e.deltaY > 0 ? 'hotbarNext' : 'hotbarPrev';
    pressedQueue.add(action);
    emit(action, true, 'mouse');
    emit(action, false, 'mouse');
  }

  /** Kid trackpad pan (pixel wheel deltas) -> look, at the drag rate scaled by SWIPE_SCALE. */
  function swipeLook(e) {
    const unit = e.deltaMode === 0 ? 1 : 0;                              // only pixel deltas are trackpad pans
    if (!unit) return;
    let dx = +e.deltaX || 0, dy = +e.deltaY || 0;
    if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }                     // shift + wheel = horizontal on some pads
    const cap = INPUT_TUNING.SWIPE_MAX_PX;                               // one runaway event never spins the view
    dx = Math.max(-cap, Math.min(cap, dx)); dy = Math.max(-cap, Math.min(cap, dy));
    if (dx === 0 && dy === 0) return;
    const k = INPUT_TUNING.DRAG_K * INPUT_TUNING.SWIPE_SCALE * (0.5 + (game.settings.lookSensitivity ?? 0.5));
    const inv = game.settings.invertY ? -1 : 1;
    input.lookDelta.yaw += -dx * k;
    input.lookDelta.pitch += -dy * k * inv;
    input.noteManualLook();
  }

  /* ---------------- kid cursor ---------------- */
  // A large white arrow with a thick dark outline: the default OS arrow is small and easy for a five-year-old to lose
  // over busy terrain on a 1080p laptop (judge KID-11). Hotspot at the tip. Classic play hides it under pointer lock.
  const KID_CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 40 40">'
    + '<path d="M4 3 L4 33 L12 25.5 L17.5 37 L23.5 34.2 L18 23 L29 23 Z" fill="#fff" stroke="#1b1b1b" stroke-width="3" stroke-linejoin="round"/>'
    + '<path d="M8 11 L8 24" stroke="#ffd23a" stroke-width="2.5" stroke-linecap="round"/></svg>';
  const KID_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(KID_CURSOR_SVG)}") 5 4, auto`;
  function applyCursor() {
    const c = game.canvas;
    if (!c || !c.style) return;
    c.style.cursor = input.scheme === 'kid' ? KID_CURSOR : '';
  }

  /* ---------------- keyboard turning (frame) ---------------- */
  function updateTurn(side, held, t) {
    if (held && !side.held) { side.held = true; side.t0 = t; turn.nudge += INPUT_TUNING.TURN_NUDGE_DEG * DEG * (side === turn.left ? 1 : -1); }
    else if (!held) side.held = false;
  }

  const input = {
    name: 'input',
    /** 'kid' | 'classic' (from settings.controls) */
    scheme: 'kid',
    /** 'mouse' | 'touch' | 'pen' - last pointer type used (touch lane shows its UI for 'touch') */
    lastPointerType: 'mouse',
    pointerLocked: false,
    /** Movement intent for this tick, each -1..1: forward (+ = forward), strafe (+ = right). */
    move: { forward: 0, strafe: 0 },
    /** Virtual stick (touch joystick / tests) */
    virtualMove: { forward: 0, strafe: 0 },
    /** Interaction ray through this NDC point (0,0 = centre / crosshair). */
    aim: { x: 0, y: 0 },
    /** true when the aim point is meaningful (cursor over canvas, or pointer locked, or touch target) */
    aimActive: true,
    /** Pending look deltas (radians) applied by the player system each frame. */
    lookDelta: { yaw: 0, pitch: 0 },
    /** performance.now() of the last manual look input (drag, keys, addLook, test setLook) - auto-pitch waits on it */
    lastManualLookMs: 0,

    init() {
      input.scheme = game.settings.controls === 'classic' ? 'classic' : 'kid';
      game.events.on('settings:changed', (e) => {
        if (e.key !== 'controls') return;
        input.scheme = e.value === 'classic' ? 'classic' : 'kid';
        input.releaseAll();
        applyCursor();
        if (input.scheme === 'kid' && document.pointerLockElement) { try { document.exitPointerLock(); } catch { /* ignore */ } }
      });
      game.events.on('world:exit', () => input.releaseAll());
      // a new or loaded world starts with the kid cursor in the middle of the screen (the next mouse move or
      // tap places it again), so a previous world's cursor position never decides the first target
      game.events.on('world:ready', () => { input.aim.x = 0; input.aim.y = 0; input.aimActive = true; });
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', () => input.releaseAll());
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') input.releaseAll(); });
      document.addEventListener('fullscreenchange', () => input.releaseAll());
      document.addEventListener('pointerlockchange', onPointerLockChange);
      document.addEventListener('pointerlockerror', () => { /* silent: the click-to-play overlay stays up */ });
      window.addEventListener('pointerdown', onPointerDownAny, true);
      window.addEventListener('wheel', onWheel, { passive: false });
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('mousemove', onMouseMove);
      const c = game.canvas;
      applyCursor();
      if (c) {
        c.addEventListener('pointerdown', onPointerDown);
        c.addEventListener('pointermove', onPointerMove);
        c.addEventListener('pointerup', onPointerUp);
        c.addEventListener('pointercancel', onPointerCancel);
        c.addEventListener('pointerleave', onPointerLeave);
        c.addEventListener('contextmenu', (e) => e.preventDefault());
        c.addEventListener('dragstart', (e) => e.preventDefault());
      }
    },

    /** Snapshot edge-triggered presses for this tick; compute move vector. Runs FIRST in the tick order. */
    tick() {
      commitHold();
      const t = pressedThisTick;
      t.clear();
      pressedThisTick = pressedQueue;
      pressedQueue = t;
      const captured = captures.size > 0;
      const f = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
      const s = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
      input.move.forward = captured ? 0 : Math.max(-1, Math.min(1, f + input.virtualMove.forward));
      input.move.strafe = captured ? 0 : Math.max(-1, Math.min(1, s + input.virtualMove.strafe));
    },

    /** Keyboard turning + pitch keys into lookDelta (player.frame consumes it). */
    frame(g, dt) {
      const t = now();
      const active = isPlaying() && captures.size === 0;
      updateTurn(turn.left, active && input.isDown('turnLeft'), t);
      updateTurn(turn.right, active && input.isDown('turnRight'), t);
      if (!active) { turn.nudge = 0; return; }
      // tap nudge, applied smoothly
      if (turn.nudge !== 0) {
        const stepMax = (INPUT_TUNING.TURN_NUDGE_DEG * DEG) * (dt / (INPUT_TUNING.TURN_NUDGE_MS / 1000));
        const step = Math.sign(turn.nudge) * Math.min(Math.abs(turn.nudge), stepMax);
        input.lookDelta.yaw += step;
        turn.nudge -= step;
      }
      // continuous turn after the hold threshold, ramping to full rate
      const rate = (60 + 80 * (game.settings.turnSpeed ?? 0.5)) * DEG;
      for (const side of [turn.left, turn.right]) {
        if (!side.held) continue;
        const held = t - side.t0 - INPUT_TUNING.TURN_HOLD_MS;
        if (held <= 0) continue;
        const ramp = Math.min(1, held / INPUT_TUNING.TURN_RAMP_MS);
        input.lookDelta.yaw += (side === turn.left ? 1 : -1) * rate * ramp * dt;
      }
      const pitchKeys = (input.isDown('lookUp') ? 1 : 0) - (input.isDown('lookDown') ? 1 : 0);
      if (pitchKeys !== 0) { input.lookDelta.pitch += pitchKeys * INPUT_TUNING.PITCH_KEY_DEG_S * DEG * dt; input.noteManualLook(); }
    },

    /** Held right now (keyboard, mouse buttons or virtual). Gameplay actions read false while captured. */
    isDown(action) {
      if (captures.size > 0 && !UI_ACTIONS.has(action)) return false;
      return anyHeld(action);
    },
    /** Pressed since the previous tick (valid inside tick()). */
    wasPressed(action) {
      if (captures.size > 0 && !UI_ACTIONS.has(action)) return false;
      return pressedThisTick.has(action);
    },

    /** Hold/release an action programmatically (touch buttons, tests). Emits 'input:action' on change. */
    setVirtual(action, down) {
      const had = virtualHeld.has(action);
      if (down && !had) { virtualHeld.add(action); pressedQueue.add(action); emit(action, true, 'virtual'); }
      if (!down && had) { virtualHeld.delete(action); emit(action, false, 'virtual'); }
    },
    /** One-shot press (down then up ~60 ms later; the next tick always sees it via wasPressed). */
    press(action) {
      const prev = pressTimers.get(action);
      if (prev) { clearTimeout(prev); input.setVirtual(action, false); }
      input.setVirtual(action, true);
      pressTimers.set(action, setTimeout(() => { pressTimers.delete(action); input.setVirtual(action, false); }, INPUT_TUNING.PRESS_MS));
    },
    /** Virtual joystick: forward/strafe each -1..1; (0,0) releases. */
    setMoveVector(forward, strafe) {
      input.virtualMove.forward = Math.max(-1, Math.min(1, +forward || 0));
      input.virtualMove.strafe = Math.max(-1, Math.min(1, +strafe || 0));
    },
    /** Add look rotation in radians (+yaw turns left, +pitch looks up). */
    addLook(dyaw, dpitch) { input.lookDelta.yaw += dyaw; input.lookDelta.pitch += dpitch; input.noteManualLook(); },
    /** Reset the kid auto-pitch timer (any manual look, and the test API's setLook/lookAt). */
    noteManualLook() { input.lastManualLookMs = now(); },
    /** Kid "tap" at a screen NDC point: aim there, then a one-shot 'use'. */
    tap(ndcX, ndcY) { input.aim.x = ndcX; input.aim.y = ndcY; input.aimActive = true; input.press('use'); },
    /** Kid "hold" at a screen NDC point: aim there and hold 'attack' for ms. */
    hold(ndcX, ndcY, ms = 400) {
      input.aim.x = ndcX; input.aim.y = ndcY; input.aimActive = true;
      input.setVirtual('attack', true);
      setTimeout(() => input.setVirtual('attack', false), ms);
    },
    /** Release every held key/button/virtual action, any gesture and the virtual stick. */
    releaseAll() {
      if (gesture) { if (gesture.timer) clearTimeout(gesture.timer); gesture = null; }
      for (const a of keyCount.keys()) emit(a, false, 'release');
      for (const a of pointerHeld) emit(a, false, 'release');
      for (const a of virtualHeld) emit(a, false, 'release');
      for (const id of pressTimers.values()) clearTimeout(id);
      pressTimers.clear();
      codesDown.clear(); keyCount.clear(); pointerHeld.clear(); virtualHeld.clear();
      input.virtualMove.forward = 0; input.virtualMove.strafe = 0;
      input.move.forward = 0; input.move.strafe = 0;
      turn.left.held = false; turn.right.held = false; turn.nudge = 0;
    },
    /** A UI owner captures/releases input. While captured: no movement/attack/use, pointer lock released. */
    setCaptured(owner, captured) {
      if (captured) {
        const was = captures.size;
        captures.add(owner);
        if (was === 0) input.releaseAll();
        if (typeof document !== 'undefined' && document.pointerLockElement) { try { document.exitPointerLock(); } catch { /* ignore */ } }
      } else captures.delete(owner);
    },
    isCaptured() { return captures.size > 0; },
    /**
     * Classic scheme: request pointer lock (must be called from a user gesture). Tries {unadjustedMovement: true}
     * first and falls back to a plain request; never throws, never logs. Inside the ~1 s relock cooldown after Esc
     * it retries once when the cooldown ends. Returns a Promise<boolean>.
     */
    requestPointerLock() {
      const c = game.canvas;
      if (!c || !c.requestPointerLock) return Promise.resolve(false);
      if (document.pointerLockElement === c) return Promise.resolve(true);
      const wait = lastUnlockAt + INPUT_TUNING.RELOCK_COOLDOWN_MS - now();
      if (wait > 0) {
        return new Promise((resolve) => setTimeout(() => {
          if (game.state !== 'playing' || captures.size > 0 || input.scheme !== 'classic') { resolve(false); return; }
          lockOnce(c).then(resolve);
        }, wait));
      }
      return lockOnce(c);
    },
  };

  function lockOnce(c) {
    return new Promise((resolve) => {
      let done = false, timer = 0;
      const finish = (v) => {
        if (done) return;
        done = true; clearTimeout(timer);
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        resolve(v);
      };
      const onChange = () => { if (document.pointerLockElement === c) finish(true); };
      const onError = () => finish(false);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      timer = setTimeout(() => finish(document.pointerLockElement === c), 1500);
      const plain = () => {
        try {
          const r = c.requestPointerLock();
          if (r && typeof r.catch === 'function') r.catch(() => finish(false));
        } catch { finish(false); }
      };
      try {
        const r = c.requestPointerLock({ unadjustedMovement: true });
        if (r && typeof r.then === 'function') {
          r.catch((err) => { if (err && err.name === 'NotSupportedError') plain(); else finish(false); });
        }
      } catch { plain(); }
    });
  }

  return input;
}
