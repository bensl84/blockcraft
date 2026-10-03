// OWNER LANE: FEATURE-INV. Slot DOM helpers + the pointer controller shared by the container screens.
//
// paintSlot(game, el, stack, px)  draws icon / count / durability bar, rebuilding only when the stack changed.
// SlotController                  one per open container screen: slot table, held (cursor) stack shown under the
//                                 pointer, Java click semantics from src/inventory/slots.js on pointer events:
//                                 left/right click, left/right drag-distribute, shift-click quick move, double
//                                 click gather, keys 1-9 swap with the hotbar while hovering a slot.

import { el } from '../core/dom.js';
import { getItem } from '../data/items.js';
import { clickSlot, dragDistribute, gatherToCursor } from '../inventory/slots.js';

/** Icon size (multiple of 16) for a slot of `slotPx`. */
export function iconPx(slotPx, fill = 0.9) { return Math.max(16, Math.floor((slotPx * fill) / 16) * 16); }

/** Durability fraction left (0..1) or -1 when the stack has no durability bar. */
export function durabilityLeft(stack) {
  if (!stack || !stack.damage) return -1;
  const d = getItem(stack.item);
  const max = d && (d.tool ? d.tool.durability : d.armor ? d.armor.durability : 0);
  if (!max) return -1;
  return Math.max(0, Math.min(1, 1 - stack.damage / max));
}

/** Paint a stack into a slot element (icon + count + durability). Cheap when nothing changed. */
export function paintSlot(game, slotEl, stack, px) {
  const key = stack ? `${stack.item}|${stack.count}|${stack.damage || 0}|${px}` : `|${px}`;
  if (slotEl._invKey === key) return;
  slotEl._invKey = key;
  let holder = slotEl._invHolder;
  if (!holder) {
    holder = el('span', { class: 'inv-slot-content' });
    slotEl.appendChild(holder);
    slotEl._invHolder = holder;
  }
  holder.textContent = '';
  if (!stack) { slotEl.removeAttribute('data-item'); slotEl.removeAttribute('title'); return; }
  slotEl.dataset.item = stack.item;
  const def = getItem(stack.item);
  if (def) slotEl.title = def.name; // parent-facing tooltip only; never needed by the child
  if (game.icons && game.icons.element) holder.appendChild(game.icons.element(stack.item, px));
  if (stack.count > 1) holder.appendChild(el('span', { class: 'bc-count', text: String(stack.count) }));
  const f = durabilityLeft(stack);
  if (f >= 0) {
    const bar = el('span', { class: 'bc-durability' }, [el('i')]);
    bar.firstChild.style.width = Math.round(f * 100) + '%';
    bar.firstChild.style.background = `hsl(${Math.round(f * 120)}, 85%, 45%)`;
    holder.appendChild(bar);
  }
}

/** A slot element. `size` px. */
export function slotEl(sid, size, cls = '') {
  return el('div', { class: `bc-slot inv-slot ${cls}`, dataset: { sid }, style: { width: size + 'px', height: size + 'px' } });
}

const DOUBLE_MS = 300;

/**
 * Pointer controller for one open screen.
 * @param {object} game
 * @param {HTMLElement} root   the screen root (receives pointer events)
 * @param {object} hooks       { onShift(sid), onOutput(sid, button, shift) -> handled, onChanged(), onOutside(e) }
 */
export class SlotController {
  constructor(game, root, hooks = {}) {
    this.game = game;
    this.root = root;
    this.hooks = hooks;
    /** sid -> {slot (adapter), el, px} */
    this.slots = new Map();
    this.hovered = null;
    this.drag = null;
    this.last = { sid: null, t: 0 };
    this.cursorEl = el('div', { class: 'inv-cursor' });
    this.cursorEl.style.display = 'none';
    root.appendChild(this.cursorEl);
    this.cursorPx = 48;
    this._onDown = (e) => this.down(e);
    this._onMove = (e) => this.move(e);
    this._onUp = (e) => this.up(e);
    this._onCtx = (e) => e.preventDefault();
    root.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
    root.addEventListener('contextmenu', this._onCtx);
  }

  get inv() { return this.game.inventory; }
  get cursor() { return this.inv.cursor; }
  set cursor(s) { this.inv.cursor = s && s.count > 0 ? s : null; }

  add(sid, slot, elm, px) { this.slots.set(sid, { slot, el: elm, px }); return elm; }

  /** Repaint every slot (cached per slot) and the held stack. */
  refresh() {
    for (const s of this.slots.values()) paintSlot(this.game, s.el, s.slot.get(), s.px);
    const c = this.cursor;
    if (c) {
      paintSlot(this.game, this.cursorEl, c, this.cursorPx);
      this.cursorEl.style.display = '';
    } else this.cursorEl.style.display = 'none';
    if (this.drag) for (const sid of this.drag.sids) { const s = this.slots.get(sid); if (s) s.el.classList.add('inv-drag'); }
  }

  sidAt(x, y) {
    const t = document.elementFromPoint(x, y);
    const s = t && t.closest ? t.closest('[data-sid]') : null;
    return s && this.root.contains(s) && this.slots.has(s.dataset.sid) ? s.dataset.sid : null;
  }

  placeCursor(x, y) {
    this.cursorEl.style.left = x + 'px';
    this.cursorEl.style.top = y + 'px';
  }

  changed() {
    if (this.hooks.onChanged) this.hooks.onChanged();
    this.refresh();
  }

  down(e) {
    this.placeCursor(e.clientX, e.clientY);
    const target = e.target && e.target.closest ? e.target.closest('[data-sid]') : null;
    const sid = target && this.slots.has(target.dataset.sid) ? target.dataset.sid : null;
    if (!sid) {
      // background (not a slot): buttons handle themselves; the dim area is "outside the panel"
      if (this.hooks.onOutside && !(e.target.closest && e.target.closest('.bc-panel, button, [data-interactive]'))) this.hooks.onOutside(e);
      return;
    }
    e.preventDefault();
    const button = e.button === 2 ? 'right' : 'left';
    const entry = this.slots.get(sid);
    this.game.events.emit('ui:click', {});
    const now = performance.now();
    const dbl = this.last.sid === sid && now - this.last.t < DOUBLE_MS && button === 'left';
    this.last = { sid, t: now };
    if (e.shiftKey && !entry.slot.output && !entry.slot.craftOutput) {
      if (this.hooks.onShift) this.hooks.onShift(sid);
      this.changed();
      return;
    }
    if (entry.slot.craftOutput || entry.slot.output) {
      if (this.hooks.onOutput && this.hooks.onOutput(sid, button, e.shiftKey)) { this.changed(); return; }
    }
    if (dbl && this.cursor && !entry.slot.get()) {
      const all = [...this.slots.values()].map((s) => s.slot).filter((s) => !s.output && !s.craftOutput);
      const r = gatherToCursor(all, this.cursor);
      this.cursor = r.cursor;
      this.changed();
      return;
    }
    if (!this.cursor) {
      const r = clickSlot(entry.slot, null, button);
      this.cursor = r.cursor;
      if (r.changed) this.changed();
      return;
    }
    // holding a stack: wait for pointerup (it may become a drag across slots)
    this.drag = { button, sids: [sid], pointerId: e.pointerId };
    entry.el.classList.add('inv-drag');
  }

  move(e) {
    this.placeCursor(e.clientX, e.clientY);
    const sid = this.sidAt(e.clientX, e.clientY);
    this.hovered = sid;
    if (!this.drag || e.pointerId !== this.drag.pointerId || !sid) return;
    if (!this.drag.sids.includes(sid)) {
      const entry = this.slots.get(sid);
      if (entry.slot.output || entry.slot.craftOutput) return;
      this.drag.sids.push(sid);
      entry.el.classList.add('inv-drag');
    }
  }

  up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    for (const s of this.slots.values()) s.el.classList.remove('inv-drag');
    if (!this.cursor) return;
    if (d.sids.length > 1) {
      const r = dragDistribute(d.sids.map((sid) => this.slots.get(sid).slot), this.cursor, d.button);
      this.cursor = r.cursor;
    } else {
      const r = clickSlot(this.slots.get(d.sids[0]).slot, this.cursor, d.button);
      this.cursor = r.cursor;
    }
    this.changed();
  }

  /** Programmatic click (tests, keyboard): same rules as a tap. */
  click(sid, button = 'left', shift = false) {
    const entry = this.slots.get(sid);
    if (!entry) return false;
    if (shift && !entry.slot.output && !entry.slot.craftOutput) { if (this.hooks.onShift) this.hooks.onShift(sid); this.changed(); return true; }
    if ((entry.slot.craftOutput || entry.slot.output) && this.hooks.onOutput && this.hooks.onOutput(sid, button, shift)) { this.changed(); return true; }
    const r = clickSlot(entry.slot, this.cursor, button);
    this.cursor = r.cursor;
    this.changed();
    return r.changed;
  }

  /** Swap the hovered slot with hotbar slot i (keys 1-9 inside a container). */
  swapHovered(i) {
    const sid = this.hovered;
    if (!sid || this.cursor) return false;
    const entry = this.slots.get(sid);
    if (!entry || entry.slot.output || entry.slot.craftOutput) return false;
    const a = entry.slot.get(), b = this.inv.get(i);
    if (b && entry.slot.accept && !entry.slot.accept(b)) return false;
    entry.slot.set(b ? { ...b } : null);
    this.inv.set(i, a ? { ...a } : null);
    this.changed();
    return true;
  }

  dispose() {
    this.root.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    this.root.removeEventListener('contextmenu', this._onCtx);
    this.slots.clear();
  }
}
