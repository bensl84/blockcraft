// OWNER: LEAD (shared, frozen). DOM helpers shared by every UI lane. See docs/SPEC.md §9 (UI style guide).

import { GUI } from './constants.js';

/**
 * Create an element. el('div', {class: 'bc-panel', style: {left: '4px'}, onclick: fn, dataset: {slot: 3}}, [children])
 * Children may be strings, nodes, null/false (skipped) or arrays.
 */
export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  appendChildren(e, children);
  return e;
}
function appendChildren(e, children) {
  if (children === null || children === undefined || children === false) return;
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(e, c);
    else e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/**
 * Get (or create) a lane's root layer inside #ui-root. Each UI lane owns exactly the layers it creates.
 * @param {object} game @param {string} id DOM id (e.g. 'hud') @param {number} z z-index from constants Z
 */
export function uiLayer(game, id, z) {
  let e = document.getElementById(id);
  if (!e) {
    e = el('div', { id, class: 'bc-layer', style: { zIndex: String(z) } });
    game.uiRoot.appendChild(e);
  }
  return e;
}

/** Integer GUI scale (Java rule): largest s with w/s >= 320 and h/s >= 240, clamped to [2, 6]. */
export function computeGuiScale(w, h, override = 0) {
  if (override > 0) return Math.max(1, Math.min(GUI.MAX_SCALE, Math.round(override)));
  let s = 1;
  while ((s + 1) <= GUI.MAX_SCALE && w / (s + 1) >= GUI.MIN_W && h / (s + 1) >= GUI.MIN_H) s++;
  return Math.max(GUI.MIN_SCALE, s);
}

/** Apply --gui (px per GUI unit) and helper CSS variables on :root. Called by main.js on resize/settings change. */
export function applyGuiScale(game) {
  const w = window.innerWidth, h = window.innerHeight;
  const s = computeGuiScale(w, h, game.settings.guiScale);
  game.guiScale = s;
  const root = document.documentElement.style;
  root.setProperty('--gui', s + 'px');
  const kid = game.settings.controls === 'kid';
  let hotbarSlot = Math.min(88, Math.max(kid ? 64 : 40, (kid ? GUI.KID_HOTBAR_SLOT : GUI.HOTBAR_SLOT) * s));
  // The 9 slots plus the backpack button beside them must fit the window (phone portrait, narrow windows):
  // room = width - 16 px margins - 10 px hotbar frame - 16 px gap; backpack = clamp(slot, 64, 96).
  const room = w - 42;
  let fit = Math.floor(room / 10);
  if (fit < 64) fit = Math.floor((room - 64) / 9);
  hotbarSlot = Math.max(24, Math.min(hotbarSlot, fit));
  root.setProperty('--hotbar-slot', Math.round(hotbarSlot) + 'px');
  root.setProperty('--slot', Math.round(Math.max(kid ? 48 : 36, GUI.CONTAINER_SLOT * s)) + 'px');
  root.setProperty('--touch-btn', ({ S: 80, M: 96, L: 112 })[game.settings.buttonSize] + 'px');
  return s;
}

/** True when the device's primary pointer is coarse (touchscreen). Lanes should prefer game.input.lastPointerType. */
export function isCoarsePointer() {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

/** Stop the browser from doing its own thing with an event (zoom, context menu, text select, back swipe). */
export function swallow(e) { e.preventDefault(); e.stopPropagation(); }
