// OWNER LANE: FEATURE-MENUS. Small DOM widgets shared by the menu screens (SPEC §9 kid rules: react on
// pointerdown, emit 'ui:click', >= 48 px targets, selection never by colour alone).

import { el } from '../core/dom.js';
import { iconImg } from './menu_art.js';

/**
 * Make an element pressable. Feedback (pressed look + 'ui:click') happens on pointerdown. The action runs on
 * pointerdown for mouse/pen; for touch it runs on pointerup inside the element, because only touch *end* events
 * count as a user gesture (fullscreen, audio unlock). Keyboard (Enter/Space on a focused button) and synthetic
 * el.click() also work. opts.gesture: the action needs a user gesture (always true is fine).
 */
export function onPress(game, node, fn, opts = {}) {
  let downId = null;
  let skipClickUntil = 0;   // the 'click' that follows a press we already handled
  const fire = (e) => { try { fn(e); } catch (err) { game.reportError(err, 'menus press'); } };
  node.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    skipClickUntil = 0;
    node.classList.add('bc-pressed');
    game.events.emit('ui:click', {});
    if (e.pointerType === 'touch') { downId = e.pointerId; return; }
    skipClickUntil = performance.now() + 1500;
    fire(e);
  });
  const up = (e) => {
    node.classList.remove('bc-pressed');
    if (downId !== null && e.pointerId === downId) {
      downId = null;
      if (e.type === 'pointerup') {
        const r = node.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { skipClickUntil = performance.now() + 1500; fire(e); }
      }
    }
  };
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('pointerleave', () => node.classList.remove('bc-pressed'));
  node.addEventListener('click', (e) => {
    if (skipClickUntil && performance.now() < skipClickUntil) { skipClickUntil = 0; return; }
    skipClickUntil = 0;
    if (e.detail === 0 || !e.isTrusted) game.events.emit('ui:click', {});
    fire(e);
  });
  if (opts.label) node.setAttribute('aria-label', opts.label);
  return node;
}

/** A pressable button with a pixel icon (no text needed). */
export function iconButton(game, { icon, px = 48, cls = '', action, label, onPress: fn, text }) {
  const b = el('button', { class: `bc-btn bc-mbtn ${cls}`, type: 'button', 'data-action': action, 'aria-label': label || action }, [
    icon ? iconImg(icon, px) : null,
    text ? el('span', { class: 'bc-mbtn-text', text }) : null,
  ]);
  return onPress(game, b, fn);
}

/* ------------------------------------------------------------------ settings rows (parent area) */
export function row(label, control, hint) {
  return el('div', { class: 'bc-set-row' }, [
    el('div', { class: 'bc-set-label' }, [el('span', { text: label }), hint ? el('small', { text: hint }) : null]),
    el('div', { class: 'bc-set-ctl' }, [control]),
  ]);
}

/** On/off toggle. get() -> bool, set(bool). */
export function toggle(game, key, get, set, opts = {}) {
  const b = el('button', { class: 'bc-btn bc-toggle', type: 'button', 'data-setting': key, role: 'switch' });
  const sync = () => {
    const on = !!get();
    b.classList.toggle('bc-on', on);
    b.setAttribute('aria-checked', String(on));
    b.textContent = on ? 'ON' : 'OFF';
    b.disabled = !!(opts.disabled && opts.disabled());
  };
  onPress(game, b, () => { if (b.disabled) return; set(!get()); sync(); });
  sync();
  b._sync = sync;
  return b;
}

/** Segmented choice. options: [{value, label}] */
export function choice(game, key, options, get, set, opts = {}) {
  const wrap = el('div', { class: 'bc-choice', 'data-setting': key, role: 'radiogroup' });
  const btns = options.map((o) => {
    const b = el('button', { class: 'bc-btn bc-choice-btn', type: 'button', 'data-value': String(o.value), role: 'radio' }, [o.label]);
    onPress(game, b, () => { if (b.disabled) return; set(o.value); sync(); });
    return b;
  });
  const sync = () => {
    const v = get();
    btns.forEach((b, i) => {
      const sel = options[i].value === v;
      b.classList.toggle('bc-selected', sel);
      b.setAttribute('aria-checked', String(sel));
      b.disabled = !!(opts.disabled && opts.disabled(options[i].value));
    });
  };
  wrap.append(...btns);
  sync();
  wrap._sync = sync;
  return wrap;
}

/** Range slider with a value read-out. fmt(v) -> string. */
export function slider(game, key, min, max, step, get, set, fmt = (v) => String(v)) {
  const out = el('span', { class: 'bc-slider-val' });
  const input = el('input', { class: 'bc-slider', type: 'range', min: String(min), max: String(max), step: String(step), 'data-setting': key, 'aria-label': key });
  input.value = String(get());
  out.textContent = fmt(Number(input.value));
  input.addEventListener('input', () => { const v = Number(input.value); out.textContent = fmt(v); set(v); });
  input.addEventListener('pointerdown', () => game.events.emit('ui:click', {}));
  const wrap = el('div', { class: 'bc-slider-wrap' }, [input, out]);
  wrap._sync = () => { input.value = String(get()); out.textContent = fmt(Number(input.value)); };
  return wrap;
}

/** A text action button for the parent area. */
export function actionButton(game, text, fn, cls = '', action) {
  const b = el('button', { class: `bc-btn bc-set-action ${cls}`, type: 'button', 'data-action': action || null }, [text]);
  return onPress(game, b, fn);
}
