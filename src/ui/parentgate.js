// OWNER LANE: FEATURE-MENUS. SPEC §8.4.4.
// Parent gate: press and hold the lock button for 3 s, then answer a random two-digit sum on an on-screen number
// pad. Digits do nothing before the hold completes, so random taps never pass. Used before settings, world
// delete/rename, export/import, the controls-scheme change and any link out. Sits at Z.GATE above every screen.
// The decision logic is the pure GateMachine (menu_logic.js); this file is the DOM around it.

import { el, uiLayer } from '../core/dom.js';
import { Z } from '../core/constants.js';
import { GATE_HOLD_MS, GateMachine } from './menu_logic.js';
import { iconImg } from './menu_art.js';

let current = null;

/**
 * Show the gate over everything (Z.GATE). Resolves true if passed, false if cancelled.
 * @param {object} game @param {{holdMs?: number}} [opts] @returns {Promise<boolean>}
 */
export function openParentGate(game, opts = {}) {
  if (current) return current.promise;
  const layer = uiLayer(game, 'gate', Z.GATE);
  const machine = new GateMachine(Math.random, opts.holdMs || GATE_HOLD_MS);
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  let raf = 0;
  const click = () => game.events.emit('ui:click', {});

  const ring = el('div', { class: 'bc-gate-ring' });
  const holdBtn = el('button', { class: 'bc-btn bc-gate-hold', type: 'button', 'data-action': 'gate-hold', 'aria-label': 'Press and hold' }, [ring, iconImg('lock', 64)]);
  const entry = el('span', { class: 'bc-gate-entry', 'data-gate': 'entry' });
  const question = el('div', { class: 'bc-gate-q', 'data-gate': 'question' });
  const pad = el('div', { class: 'bc-gate-pad' });
  const msg = el('div', { class: 'bc-gate-msg', text: 'Grown-ups: press and hold the lock for 3 seconds.' });
  const holdStage = el('div', { class: 'bc-gate-stage', 'data-stage': 'hold' }, [holdBtn, msg]);
  const answerStage = el('div', { class: 'bc-gate-stage bc-hidden', 'data-stage': 'answer' }, [question, pad]);
  const cancel = el('button', { class: 'bc-btn bc-gate-cancel', type: 'button', 'data-action': 'gate-cancel', 'aria-label': 'Close' }, [iconImg('cross', 40)]);
  const root = el('div', { class: 'bc-screen bc-gate', 'data-screen': 'gate', 'data-stage': 'hold' }, [
    el('div', { class: 'bc-panel bc-gate-panel' }, [
      el('div', { class: 'bc-gate-head' }, [iconImg('lock', 32), el('span', { text: 'Grown-ups only' })]),
      holdStage, answerStage, cancel,
    ]),
  ]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  for (const k of keys) {
    const b = el('button', { class: `bc-btn bc-gate-key${k === 'ok' ? ' bc-gate-ok' : ''}`, type: 'button', 'data-key': k, 'aria-label': k },
      [k === 'del' ? iconImg('backspace', 32) : k === 'ok' ? iconImg('check', 32) : k]);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); click(); key(k); });
    b.addEventListener('click', (e) => { if (e.detail === 0 || !e.isTrusted) key(k); });
    pad.appendChild(b);
  }

  function render() {
    root.dataset.stage = machine.stage;
    holdStage.classList.toggle('bc-hidden', machine.stage !== 'hold');
    answerStage.classList.toggle('bc-hidden', machine.stage !== 'answer');
    if (machine.stage === 'answer') {
      question.textContent = `${machine.sum.a} + ${machine.sum.b} = `;
      entry.textContent = machine.entry || '?';
      question.appendChild(entry);
    }
  }
  function key(k) {
    if (k === 'del') machine.backspace();
    else if (k === 'ok') {
      const r = machine.submit();
      if (r === 'passed') { finish(true); return; }
      if (r === 'wrong' || r === 'reset') {
        root.classList.remove('bc-shake'); void root.offsetWidth; root.classList.add('bc-shake');
        if (r === 'reset') msg.textContent = 'Grown-ups: press and hold the lock for 3 seconds.';
      }
    } else machine.digit(k);
    render();
  }
  function loop() {
    const now = performance.now();
    if (machine.update(now)) { click(); render(); }
    const p = machine.holdProgress(now);
    ring.style.setProperty('--p', String(p));
    holdBtn.classList.toggle('bc-holding', machine.holdStart >= 0);
    raf = requestAnimationFrame(loop);
  }

  holdBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    click();
    try { holdBtn.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    machine.pressHold(performance.now());
  });
  const release = () => { machine.releaseHold(performance.now()); render(); };
  holdBtn.addEventListener('pointerup', release);
  holdBtn.addEventListener('pointercancel', release);
  holdBtn.addEventListener('lostpointercapture', release);
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  cancel.addEventListener('pointerdown', (e) => { e.preventDefault(); click(); finish(false); });
  cancel.addEventListener('click', (e) => { if (e.detail === 0 || !e.isTrusted) finish(false); });

  /** Keys go to the gate only (Esc must not also close the screen underneath; digits must not pick hotbar slots). */
  const onKey = (e) => {
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type !== 'keydown') return;
    if (e.key === 'Escape') { e.preventDefault(); finish(false); return; }
    if (/^[0-9]$/.test(e.key)) { key(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { key('del'); e.preventDefault(); }
    else if (e.key === 'Enter') { key('ok'); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);

  function finish(ok) {
    if (!current) return;
    current = null;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    root.remove();
    game.events.emit('menus:gate', { passed: ok });
    resolve(ok);
  }

  layer.appendChild(root);
  current = { promise, finish, machine, root };
  render();
  raf = requestAnimationFrame(loop);
  game.events.emit('menus:gate', { open: true });
  return promise;
}

/** (MENUS addition) Is the gate showing? */
export function isParentGateOpen() { return !!current; }
/** (MENUS addition) Close the gate as cancelled (e.g. the world closed underneath it). */
export function cancelParentGate() { if (current) current.finish(false); }
