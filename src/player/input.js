// OWNER LANE: CORE-E (player/physics/input/raycast/interaction). STUB written by LEAD - the API is FROZEN
// (SPEC §7.1); replace the internals: pointer events (kid tap/hold/drag gestures for mouse+touch+pen),
// pointer lock (classic) with relock cooldown + spike filter, wheel handling, double-tap detection,
// blur/visibility key reset, arrow-key turning ramp.
//
// Stub behaviour: keyboard keys map to actions (held state + 'input:action' events) using KEY_BINDINGS;
// virtual input (touch lane, tests) works; no mouse/pointer handling yet.

import { registerStub } from '../core/stubs.js';

registerStub('input');

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

/** @returns {object} Input system (game.input). */
export function createInputSystem(game) {
  const keyHeld = new Set();          // actions held via keyboard
  const virtualHeld = new Set();      // actions held via setVirtual (touch buttons, tests)
  let pressedQueue = new Set();       // actions pressed since the last tick
  let pressedThisTick = new Set();
  const captures = new Set();

  const input = {
    name: 'input',
    stub: true,
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
      game.events.on('settings:changed', (e) => { if (e.key === 'controls') { input.scheme = e.value === 'classic' ? 'classic' : 'kid'; input.releaseAll(); } });
      window.addEventListener('keydown', (e) => {
        const action = KEY_BINDINGS[input.scheme][e.code];
        if (!action) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        if (e.repeat) return;
        keyHeld.add(action);
        pressedQueue.add(action);
        game.events.emit('input:action', { action, down: true, source: 'key' });
      });
      window.addEventListener('keyup', (e) => {
        const action = KEY_BINDINGS[input.scheme][e.code];
        if (!action) return;
        keyHeld.delete(action);
        game.events.emit('input:action', { action, down: false, source: 'key' });
      });
      window.addEventListener('blur', () => input.releaseAll());
    },

    /** Snapshot edge-triggered presses for this tick; compute move vector. Runs FIRST in the tick order. */
    tick() {
      pressedThisTick = pressedQueue;
      pressedQueue = new Set();
      const captured = captures.size > 0;
      const f = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
      const s = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
      input.move.forward = captured ? 0 : Math.max(-1, Math.min(1, f + input.virtualMove.forward));
      input.move.strafe = captured ? 0 : Math.max(-1, Math.min(1, s + input.virtualMove.strafe));
    },

    frame() {},

    /** Held right now (keyboard, mouse buttons or virtual). Gameplay actions read false while captured. */
    isDown(action) {
      if (captures.size > 0 && !UI_ACTIONS.has(action)) return false;
      return keyHeld.has(action) || virtualHeld.has(action);
    },
    /** Pressed since the previous tick (valid inside tick()). */
    wasPressed(action) {
      if (captures.size > 0 && !UI_ACTIONS.has(action)) return false;
      return pressedThisTick.has(action);
    },

    /** Hold/release an action programmatically (touch buttons, tests). Emits 'input:action' on change. */
    setVirtual(action, down) {
      const had = virtualHeld.has(action);
      if (down && !had) { virtualHeld.add(action); pressedQueue.add(action); game.events.emit('input:action', { action, down: true, source: 'virtual' }); }
      if (!down && had) { virtualHeld.delete(action); game.events.emit('input:action', { action, down: false, source: 'virtual' }); }
    },
    /** One-shot press (down then up next tick). */
    press(action) { input.setVirtual(action, true); setTimeout(() => input.setVirtual(action, false), 60); },
    /** Virtual joystick: forward/strafe each -1..1; (0,0) releases. */
    setMoveVector(forward, strafe) { input.virtualMove.forward = forward; input.virtualMove.strafe = strafe; },
    /** Add look rotation in radians (+yaw turns left, +pitch looks up). */
    addLook(dyaw, dpitch) { input.lookDelta.yaw += dyaw; input.lookDelta.pitch += dpitch; input.noteManualLook(); },
    /** Reset the kid auto-pitch timer (any manual look, and the test API's setLook/lookAt). */
    noteManualLook() { input.lastManualLookMs = performance.now(); },
    /** Kid "tap" at a screen NDC point: aim there, then a one-shot 'use'. */
    tap(ndcX, ndcY) { input.aim.x = ndcX; input.aim.y = ndcY; input.aimActive = true; input.press('use'); },
    /** Kid "hold" at a screen NDC point: aim there and hold 'attack' for ms. */
    hold(ndcX, ndcY, ms = 400) {
      input.aim.x = ndcX; input.aim.y = ndcY; input.aimActive = true;
      input.setVirtual('attack', true);
      setTimeout(() => input.setVirtual('attack', false), ms);
    },
    /** Release every held key/button/virtual action and the virtual stick. */
    releaseAll() {
      for (const a of [...keyHeld, ...virtualHeld]) game.events.emit('input:action', { action: a, down: false, source: 'release' });
      keyHeld.clear(); virtualHeld.clear(); input.virtualMove.forward = 0; input.virtualMove.strafe = 0;
    },
    /** A UI owner captures/releases input. While captured: no movement/attack/use, pointer lock released. */
    setCaptured(owner, captured) {
      if (captured) { captures.add(owner); input.releaseAll(); if (document.pointerLockElement) document.exitPointerLock(); }
      else captures.delete(owner);
    },
    isCaptured() { return captures.size > 0; },
    /** Classic scheme: request pointer lock (must be called from a user gesture). Returns a Promise<boolean>. */
    requestPointerLock() { return Promise.resolve(false); },
  };
  return input;
}
