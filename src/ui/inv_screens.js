// OWNER LANE: FEATURE-INV. Container screens: 'inventory' (armour + doll + 2x2 crafting + 27 + 9), 'crafting'
// (3x3 table), 'furnace' (input / flame / fuel / arrow / output), 'chest' (27 + player). Survival screens with a
// crafting grid also get the RECIPE BOOK: a paged picture grid of everything craftable right now - tapping a
// picture fills the grid from the inventory and crafts it (the child never has to read or remember a recipe).
// SPEC §8.2.4.

import { el } from '../core/dom.js';
import { getItem, maxStack } from '../data/items.js';
import { consumeCraft, craftableRecipes, fuelTicks, matchRecipe, planRecipe, smeltingResult } from '../inventory/crafting.js';
import { furnaceProgress } from '../inventory/containers.js';
import { arraySlot, fieldSlot, quickMove, stackable } from '../inventory/slots.js';
import { SlotController, iconPx, slotEl } from './inv_slotview.js';
import { spriteEl } from './inv_sprites.js';

export const ARMOR_SLOT_NAMES = Object.freeze(['head', 'chest', 'legs', 'feet']);

export function cssPx(name, fallback) {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** How far the close button sticks out above / right of its panel (px; inv.css .inv-close top/right). */
export const CLOSE_OVERHANG = 18;
/** Screen margins around the layout (inv.css .inv-screen padding): top leaves room for the close overhang. */
const MARGIN = { top: CLOSE_OVERHANG + 6, bottom: 16, side: CLOSE_OVERHANG + 4 };
const MIN_SLOT = 30;

const craftKind = (kind) => kind === 'inventory' || kind === 'crafting';
/** Recipe book picture size for slot size S. */
const bookTile = (S) => Math.max(64, Math.round(S * 1.2));

/**
 * Container slot size (px) that fits the window: the GUI-scale size from --slot when it fits, else the largest
 * size (down to MIN_SLOT) for which the panel, the recipe book beside it and the close button stay on screen
 * (landscape phones such as 667x375: every slot, the hotbar row and the close button must be reachable).
 */
export function slotSizeFor(kind, base, gui, vw, vh, book, headPx = 0) {
  const fits = (S) => {
    const u = Math.max(2, Math.round(S / 18));
    let topH, topW;
    if (kind === 'inventory') { topH = 4 * S; topW = Math.round(2.2 * S) + 4 * S + 31 * u + 9 * gui + 56; }
    else if (kind === 'crafting') { topH = 3 * S; topW = 3 * S + 22 * u + Math.round(S * 26 / 18) + 15 * gui + 56; }
    else if (kind === 'furnace') { topH = Math.max(Math.round(S * 26 / 18), 2 * S + 18 * u); topW = 0; }
    else { topH = 3 * S + 2 * gui + 4 + headPx; topW = 0; }
    const panelH = topH + 4 * S + 17 * gui;              // + player rows, section margin, hotbar gap, padding, border
    const panelW = Math.max(9 * S, topW) + 10 * gui + 4;
    const bookW = book ? 3 * bookTile(S) + 16 + 10 * gui + 16 : 0;
    return panelH <= vh - MARGIN.top - MARGIN.bottom && panelW + bookW <= vw - 2 * MARGIN.side;
  };
  let S = Math.max(MIN_SLOT, Math.round(base));
  while (S > MIN_SLOT && !fits(S)) S--;
  return S;
}

/** Fly an item icon from one screen rect to another ("fwoop"). */
export function flyIcon(game, item, from, to, px = 48, parent = null) {
  if (!from || !to || !game.icons || !document.body) return;
  const wrap = el('div', { class: 'inv-fly' });
  wrap.appendChild(game.icons.element(item, px));
  wrap.style.left = (from.x + from.width / 2 - px / 2) + 'px';
  wrap.style.top = (from.y + from.height / 2 - px / 2) + 'px';
  (parent || game.uiRoot || document.body).appendChild(wrap); // inside the screen: closing it removes the animation
  const dx = to.x + to.width / 2 - (from.x + from.width / 2), dy = to.y + to.height / 2 - (from.y + from.height / 2);
  requestAnimationFrame(() => requestAnimationFrame(() => { wrap.style.transform = `translate(${dx}px, ${dy}px) scale(0.7)`; wrap.style.opacity = '0.6'; }));
  setTimeout(() => wrap.remove(), 320);
}

/** Small original player figure (skin colours from settings.skin) for the inventory screen. */
function dollCanvas(skin, scale) {
  const c = document.createElement('canvas');
  c.width = 12; c.height = 26;
  const x = c.getContext('2d');
  const s = { hair: '#6a3a1a', shirt: '#f2c230', pants: '#2a7f7a', skin: '#e8b48a', ...(skin || {}) };
  const r = (col, a, b, w, h) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
  // round-ish head with a side-swept fringe, dot eyes, rosy cheeks and a smile (original kid-friendly face)
  r(s.skin, 2, 1, 8, 7); r(s.skin, 3, 0, 6, 1);
  r(s.hair, 3, 0, 6, 1); r(s.hair, 2, 1, 8, 2); r(s.hair, 2, 3, 1, 3); r(s.hair, 9, 3, 1, 2); r(s.hair, 6, 3, 3, 1);
  r('#1e2433', 4, 4, 1, 2); r('#1e2433', 7, 4, 1, 2);
  r('#f08a8a', 3, 6, 1, 1); r('#f08a8a', 8, 6, 1, 1);
  r('#8a3a3a', 4, 6, 1, 1); r('#8a3a3a', 7, 6, 1, 1); r('#8a3a3a', 5, 7, 2, 1);
  r(s.shirt, 2, 8, 8, 9); r(s.shirt, 0, 8, 2, 5); r(s.shirt, 10, 8, 2, 5); r(s.skin, 0, 13, 2, 4); r(s.skin, 10, 13, 2, 4);
  r(s.pants, 2, 17, 8, 7); r('#00000033', 6, 18, 1, 6); r('#3a2a1e', 2, 24, 4, 2); r('#3a2a1e', 6, 24, 4, 2);
  c.style.width = 12 * scale + 'px'; c.style.height = 26 * scale + 'px';
  return c;
}

/**
 * Build one container screen.
 * @param {object} ctx { game, kind, be (chest/furnace data or null), onDirty(), close(), dropStack(stack), book: bool }
 * @returns {object} screen { kind, root, ctl, craft, refresh(), frame(), returnAll(), clickSlot(), slotRect(), ... }
 */
export function buildContainerScreen(ctx) {
  const { game, kind, be } = ctx;
  const inv = game.inventory;
  const kid = game.settings.controls !== 'classic';
  const closePx = kid ? 64 : 48;
  const gui = cssPx('--gui', 3);
  // the chest has no free top-right corner (its grid is 9 wide): a header row keeps the close button off slot k8
  const headPx = kind === 'chest' ? Math.max(0, closePx - CLOSE_OVERHANG - 5 * gui) + 6 : 0;
  const S = slotSizeFor(kind, Math.round(cssPx('--slot', 54)), gui, window.innerWidth, window.innerHeight, !!(ctx.book && craftKind(kind)), headPx);
  const px = iconPx(S, 0.9);
  const u = Math.max(2, Math.round(S / 18));      // px per GUI unit inside the panel

  const root = el('div', { class: 'bc-screen bc-dim inv-screen', 'data-screen': kind });
  const screen = {
    kind, root, be, craft: null, book: null, lastVersion: -1, sig: '',
    refresh, frame, returnAll,
    /** programmatic slot click (tests / keyboard) */
    clickSlot: (sid, button = 'left', shift = false) => { const r = ctl.click(sid, button, shift); return r; },
    slotRect: (sid) => { const s = ctl.slots.get(sid); if (!s) return null; const r = s.el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; },
    slotIds: () => [...ctl.slots.keys()],
    getSlot: (sid) => { const s = ctl.slots.get(sid); return s ? s.slot.get() : null; },
  };

  const ctl = new SlotController(game, root, {
    onShift: (sid) => shiftClick(sid),
    onOutput: (sid, button, shift) => output(sid, button, shift),
    onChanged: () => { if (screen.craft) recompute(); if (ctx.onDirty) ctx.onDirty(); inv.notify(-1); },
    onOutside: () => outside(),
  });
  ctl.cursorPx = px;
  ctl.cursorEl.style.width = ctl.cursorEl.style.height = S + 'px';
  screen.ctl = ctl;

  /* ---------------- slot adapters */
  const invSlot = (i) => ({ get: () => inv.get(i), set: (s) => inv.set(i, s && s.count > 0 ? s : null) });
  const add = (sid, slot, cls = '', size = S, ipx = px) => ctl.add(sid, slot, slotEl(sid, size, cls), ipx);
  const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);
  const P = (a, b) => range(a, b).map((i) => ctl.slots.get('p' + i).slot);

  /* ---------------- crafting grid */
  let craftW = 0;
  if (kind === 'inventory') craftW = 2;
  if (kind === 'crafting') craftW = 3;
  if (craftW) {
    screen.craft = { w: craftW, h: craftW, grid: new Array(craftW * craftW).fill(null), result: null, match: null };
  }
  function recompute() {
    const c = screen.craft;
    c.match = matchRecipe(c.grid, c.w, c.h);
    c.result = c.match ? { ...c.match.result } : null;
    const out = ctl.slots.get('out');
    if (out) out.el.classList.toggle('inv-out-ready', !!c.result);
  }
  function give(stack) {
    if (!stack || stack.count <= 0) return;
    const left = inv.add(stack);
    if (left > 0 && ctx.dropStack) ctx.dropStack({ ...stack, count: left });
  }
  /** Return the crafting grid and the held stack to the inventory (screen close, recipe book). */
  function returnGrid() {
    const c = screen.craft;
    if (!c) return;
    for (let i = 0; i < c.grid.length; i++) { const s = c.grid[i]; c.grid[i] = null; give(s); }
    recompute();
  }
  function returnAll() {
    returnGrid();
    if (inv.cursor) { const s = inv.cursor; inv.cursor = null; give(s); }
  }
  function fits(stack) {
    let room = 0;
    const max = maxStack(stack.item);
    for (const s of inv.slots) {
      if (!s) room += max;
      else if (stackable(s, stack)) room += Math.max(0, max - s.count);
      if (room >= stack.count) return true;
    }
    return false;
  }
  function consumeOne() {
    const c = screen.craft;
    const res = c.result;
    const g = consumeCraft(c.grid, c.w, c.h, c.match.recipe);
    for (let i = 0; i < g.length; i++) c.grid[i] = g[i];
    recompute();
    game.events.emit('craft', { item: res.item, count: res.count });
  }
  /** Take the crafting result (click: onto the cursor; shift: as many as fit into the inventory). */
  function takeCraft(shift) {
    const c = screen.craft;
    if (!c || !c.result) return true;
    const r = c.result;
    if (!shift) {
      const cur = inv.cursor;
      if (cur && !(stackable(cur, r) && cur.count + r.count <= maxStack(r.item))) return true;
      inv.cursor = cur ? { ...cur, count: cur.count + r.count } : { ...r };
      consumeOne();
      return true;
    }
    let n = 0;
    while (c.result && c.result.item === r.item && n < 64 && fits(c.result)) {
      const made = { ...c.result };
      consumeOne();
      inv.add(made);
      n++;
    }
    return true;
  }

  function output(sid, button, shift) {
    if (sid === 'out') return takeCraft(shift);
    if (sid === 'fo' && shift) {
      const s = ctl.slots.get('fo').slot;
      quickMove(s, [...P(0, 9), ...P(9, 36)]);
      return true;
    }
    return false;
  }

  function shiftClick(sid) {
    const entry = ctl.slots.get(sid);
    if (!entry) return;
    const s = entry.slot, st = s.get();
    if (!st || s.output || s.craftOutput) return; // results are taken by output() (crafting consumes the grid)
    const hot = P(0, 9), main = P(9, 36);
    if (sid[0] === 'p') {
      const i = Number(sid.slice(1));
      if (kind === 'chest') { quickMove(s, range(0, 27).map((k) => ctl.slots.get('k' + k).slot)); return; }
      if (kind === 'furnace') {
        if (smeltingResult(st.item) && quickMove(s, [ctl.slots.get('fi').slot])) return;
        if (fuelTicks(st.item) > 0 && quickMove(s, [ctl.slots.get('ff').slot])) return;
      }
      if (kind === 'inventory') {
        const d = getItem(st.item);
        if (d && d.armor) { const k = ARMOR_SLOT_NAMES.indexOf(d.armor.slot); if (k >= 0 && quickMove(s, [ctl.slots.get('a' + k).slot])) return; }
      }
      quickMove(s, i < 9 ? main : hot);
      return;
    }
    // container / grid / armour slot -> player inventory (chest: hotbar first so it is ready to use)
    quickMove(s, sid[0] === 'k' ? [...hot, ...main] : [...main, ...hot]);
  }

  function outside() {
    if (inv.cursor) {
      const s = inv.cursor;
      inv.cursor = null;
      if (kid) give(s); else if (ctx.dropStack) ctx.dropStack(s, true);
      refresh();
      return;
    }
    if (kid && ctx.close) ctx.close();
  }

  /* ---------------- layout pieces */
  const playerSection = () => {
    const main = el('div', { class: 'inv-grid', style: { gridTemplateColumns: `repeat(9, ${S}px)` } });
    for (let i = 9; i < 36; i++) main.appendChild(add('p' + i, invSlot(i)));
    const hot = el('div', { class: 'inv-grid', style: { gridTemplateColumns: `repeat(9, ${S}px)` } });
    for (let i = 0; i < 9; i++) hot.appendChild(add('p' + i, invSlot(i)));
    return el('div', { class: 'inv-section' }, [main, el('div', { class: 'inv-gap' }), hot]);
  };
  const gridEl = (w, prefix, slotFor) => {
    const g = el('div', { class: 'inv-grid', style: { gridTemplateColumns: `repeat(${w}, ${S}px)` } });
    for (let k = 0; k < w * w; k++) g.appendChild(add(prefix + k, slotFor(k)));
    return g;
  };
  const arrowEl = () => spriteEl('arrow_off', u, 'inv-arrow');
  const bigOut = (sid, slot) => add(sid, slot, 'inv-big', Math.round(S * 26 / 18), iconPx(Math.round(S * 26 / 18), 0.75));
  const craftOutSlot = { get: () => (screen.craft && screen.craft.result) || null, set: () => {}, craftOutput: true };

  const closeBtn = el('button', { class: 'inv-close', 'aria-label': 'Close', 'data-action': 'close', style: { width: closePx + 'px', height: closePx + 'px' } },
    [spriteEl('close', Math.max(2, Math.floor((closePx * 0.6) / 16)))]);
  closeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {}); if (ctx.close) ctx.close(); });

  let top;
  let bookToggle = null;
  const bookHolder = el('div', { class: 'inv-book-holder' });
  /** Faint picture of what belongs in an empty slot (armour pieces, fuel) - a hint that needs no reading. */
  const hint = (slotElm, itemKey) => {
    if (game.icons && getItem(itemKey)) slotElm.insertBefore(el('span', { class: 'inv-slot-bg' }, [game.icons.element(itemKey, px)]), slotElm.firstChild);
    return slotElm;
  };
  if (kind === 'inventory') {
    const armor = el('div', { class: 'inv-col' });
    for (let k = 0; k < 4; k++) {
      armor.appendChild(hint(add('a' + k, {
        get: () => inv.armor[k] || null, set: (s) => inv.setArmor(k, s && s.count > 0 ? s : null), limit: 1,
        accept: (st) => { const d = getItem(st.item); return !!(d && d.armor && d.armor.slot === ARMOR_SLOT_NAMES[k]); },
      }), ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'][k]));
    }
    const doll = el('div', { class: 'inv-doll', style: { width: Math.round(2.2 * S) + 'px', height: 4 * S + 'px' } }, [dollCanvas(game.settings.skin, Math.max(2, Math.floor((4 * S - 12) / 26)))]);
    const grid = gridEl(2, 'c', (k) => arraySlot(screen.craft.grid, k));
    top = el('div', { class: 'inv-top' }, [armor, doll, el('div', { class: 'inv-spacer' }), el('div', { class: 'inv-col', style: { gap: '8px', alignItems: 'center' } }, [
      el('div', { class: 'inv-row', style: { gap: 3 * u + 'px' } }, [bookHolder, grid, arrowEl(), add('out', craftOutSlot, 'inv-big')]),
    ])]);
  } else if (kind === 'crafting') {
    const grid = gridEl(3, 'c', (k) => arraySlot(screen.craft.grid, k));
    top = el('div', { class: 'inv-top' }, [bookHolder, el('div', { class: 'inv-spacer' }), grid, arrowEl(), bigOut('out', craftOutSlot), el('div', { class: 'inv-spacer' })]);
  } else if (kind === 'furnace') {
    const flame = el('div', { class: 'inv-progress', style: { width: 14 * u + 'px', height: 14 * u + 'px' } }, [spriteEl('flame_off', u)]);
    const flameFill = el('div', { class: 'inv-fill', style: { width: 14 * u + 'px', height: 0 } }, [spriteEl('flame_on', u)]);
    flame.appendChild(flameFill);
    const arrow = el('div', { class: 'inv-progress', style: { width: 22 * u + 'px', height: 15 * u + 'px' } }, [spriteEl('arrow_off', u)]);
    const arrowFill = el('div', { class: 'inv-fill', style: { width: 0, height: 15 * u + 'px' } }, [spriteEl('arrow_on', u)]);
    arrow.appendChild(arrowFill);
    screen.flameFill = flameFill; screen.arrowFill = arrowFill;
    const col = el('div', { class: 'inv-col', style: { alignItems: 'center', gap: 2 * u + 'px' } }, [
      add('fi', fieldSlot(be, 'input')), flame, hint(add('ff', fieldSlot(be, 'fuel', { accept: (st) => fuelTicks(st.item) > 0 || st.item === 'bucket' })), 'coal'),
    ]);
    top = el('div', { class: 'inv-top inv-furnace' }, [el('div', { class: 'inv-spacer' }), col, arrow, bigOut('fo', fieldSlot(be, 'output', { output: true })), el('div', { class: 'inv-spacer' })]);
  } else if (kind === 'chest') {
    const g = el('div', { class: 'inv-grid', style: { gridTemplateColumns: `repeat(9, ${S}px)` } });
    for (let k = 0; k < 27; k++) g.appendChild(add('k' + k, arraySlot(be.items, k)));
    // header: a small chest picture ("this is the chest") in a strip the close button can overhang without
    // covering a slot; below it the wooden frame around the chest's own slots
    const head = el('div', { class: 'inv-chest-head', style: { height: headPx + 'px' } });
    if (game.icons && getItem('chest') && headPx >= 20) head.appendChild(game.icons.element('chest', headPx >= 32 ? 32 : 16));
    top = el('div', { class: 'inv-chest-top' }, [head, el('div', { class: 'inv-chest-box' }, [g])]);
  }
  const panel = el('div', { class: 'bc-panel inv-panel', 'data-panel': kind }, [top, playerSection(), closeBtn]);

  /* ---------------- recipe book */
  const layout = el('div', { class: 'inv-layout' });
  if (screen.craft && ctx.book) {
    const book = recipeBook();
    screen.book = book;
    bookToggle = el('button', { class: 'inv-btn-icon inv-on', 'aria-label': 'Recipe book', 'data-action': 'book', style: { width: '56px', height: '56px' } }, [spriteEl('book', 3)]);
    bookToggle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {});
      book.el.classList.toggle('bc-hidden');
      bookToggle.classList.toggle('inv-on', !book.el.classList.contains('bc-hidden'));
    });
    bookHolder.appendChild(bookToggle);
    layout.appendChild(book.el);
  }
  layout.appendChild(panel);
  root.appendChild(layout);

  function recipeBook() {
    const T = bookTile(S);
    const cols = 3;
    const panelH = (kind === 'inventory' ? 4 : 3) * S + 4 * S + 4 * u + 6 * u;
    const rows = Math.max(2, Math.floor((panelH - 70) / (T + 8)));
    const per = cols * rows;
    const gridSize = screen.craft.w;
    const tilesEl = el('div', { class: 'inv-book-grid', style: { gridTemplateColumns: `repeat(${cols}, ${T}px)`, gridAutoRows: T + 'px' } });
    const prev = el('button', { class: 'inv-btn-icon inv-arrow-btn', 'aria-label': 'Previous', 'data-action': 'book-prev', style: { width: '56px', height: '56px' } }, ['◀']);
    const next = el('button', { class: 'inv-btn-icon inv-arrow-btn', 'aria-label': 'Next', 'data-action': 'book-next', style: { width: '56px', height: '56px' } }, ['▶']);
    const dots = el('div', { class: 'inv-dots' });
    const bookEl = el('div', { class: 'bc-panel inv-book', 'data-panel': 'book' }, [tilesEl, el('div', { class: 'inv-pager' }, [prev, dots, next])]);
    const book = { el: bookEl, page: 0, entries: [], key: '', refresh, tap, tiles: tilesEl };
    const flip = (d) => { book.page += d; book.key = ''; refresh(); game.events.emit('ui:click', {}); };
    prev.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); flip(-1); });
    next.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); flip(1); });

    function compute() {
      // the held (cursor) stack counts too: a tap returns it to the bag before planning
      const stacks = inv.slots.concat(screen.craft.grid, inv.cursor ? [inv.cursor] : []);
      const now = [], table = [], seen = new Set();
      for (const e of craftableRecipes(stacks, 3)) {
        if (e.missing > 0 || seen.has(e.recipe.result.item)) continue;
        seen.add(e.recipe.result.item);
        (e.gridSize <= gridSize ? now : table).push(e);
      }
      return now.concat(table);
    }
    function refresh() {
      const entries = compute();
      const key = entries.map((e) => e.recipe.id).join(',') + '#' + book.page;
      if (key === book.key) return;
      book.entries = entries;
      const pages = Math.max(1, Math.ceil(entries.length / per));
      book.page = Math.max(0, Math.min(pages - 1, book.page));
      book.key = entries.map((e) => e.recipe.id).join(',') + '#' + book.page;
      tilesEl.textContent = '';
      const ipx = iconPx(T, 0.75);
      if (!entries.length) {
        // picture hint: "get wood" (log -> planks), dimmed, not tappable
        const hint = el('div', { class: 'inv-recipe inv-hint', 'data-hint': 'wood', style: { width: T + 'px', height: T + 'px' } });
        if (game.icons) hint.appendChild(game.icons.element('oak_log', ipx));
        tilesEl.appendChild(hint);
      }
      for (const e of entries.slice(book.page * per, book.page * per + per)) {
        const r = e.recipe.result;
        const needsTable = e.gridSize > gridSize;
        const tile = el('button', {
          class: `inv-recipe${needsTable ? ' inv-needs-table' : ''}`, 'data-recipe': e.recipe.id, 'data-item': r.item,
          title: (getItem(r.item) || {}).name || r.item, style: { width: T + 'px', height: T + 'px' },
        });
        if (game.icons) tile.appendChild(game.icons.element(r.item, ipx));
        if (r.count > 1) tile.appendChild(el('span', { class: 'bc-count', text: String(r.count) }));
        if (needsTable) tile.appendChild(spriteEl('table_badge', Math.max(2, Math.floor(T / 32)), 'inv-badge'));
        tile.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); tap(e, tile); });
        tilesEl.appendChild(tile);
      }
      dots.textContent = '';
      if (pages > 1) for (let k = 0; k < pages; k++) dots.appendChild(el('i', { class: k === book.page ? 'inv-on' : '' }));
      prev.disabled = book.page <= 0;
      next.disabled = book.page >= pages - 1;
      prev.style.visibility = next.style.visibility = pages > 1 ? 'visible' : 'hidden';
    }
    /** Tap a picture: fill the grid from the inventory and craft one (result goes into the inventory). */
    function tap(e, tile) {
      game.events.emit('ui:click', {});
      const nope = () => { if (tile) { tile.classList.remove('inv-nope'); void tile.offsetWidth; tile.classList.add('inv-nope'); } };
      if (e.gridSize > gridSize) {
        nope();
        game.events.emit('toast', { text: 'Needs a crafting table', icon: 'crafting_table' });
        return false;
      }
      returnGrid();
      if (inv.cursor) { const s = inv.cursor; inv.cursor = null; give(s); }
      const c = screen.craft;
      const plan = planRecipe(e.recipe, inv.slots, c.w, c.h);
      if (!plan) { nope(); refresh(); return false; }
      for (const [k, n] of plan.take) inv.removeItem(k, n);
      for (let i = 0; i < c.grid.length; i++) c.grid[i] = plan.grid[i];
      recompute();
      if (!c.result) { returnGrid(); nope(); return false; }
      const res = { ...c.result };
      ghost(plan.grid);
      consumeOne();
      const before = inv.slots.map((s) => (s ? s.count : 0));
      const left = inv.add(res);
      if (left > 0) { if (!inv.cursor) inv.cursor = { ...res, count: left }; else if (ctx.dropStack) ctx.dropStack({ ...res, count: left }); }
      returnGrid(); // remainders (empty buckets) back to the inventory
      const landed = inv.slots.findIndex((s, i) => s && s.item === res.item && s.count !== before[i]);
      const outEl = ctl.slots.get('out');
      const dest = landed >= 0 ? ctl.slots.get('p' + landed) : null;
      if (outEl && dest) flyIcon(game, res.item, (tile || outEl.el).getBoundingClientRect(), dest.el.getBoundingClientRect(), px, root);
      screen.refresh();
      return true;
    }
    return book;
  }

  /** Briefly show the ingredients in the grid (the picture recipe "fills" the grid). */
  function ghost(grid) {
    grid.forEach((s, k) => {
      const entry = ctl.slots.get('c' + k);
      if (!s || !entry || !game.icons) return;
      const g = el('span', { class: 'inv-ghost inv-fade' }, [game.icons.element(s.item, px)]);
      entry.el.appendChild(g);
      setTimeout(() => g.remove(), 520);
    });
  }

  function refresh() {
    screen.lastVersion = inv.version;
    if (screen.craft) recompute();
    ctl.refresh();
    if (screen.book) screen.book.refresh();
  }

  function frame() {
    const cur = inv.cursor ? inv.cursor.item + '*' + inv.cursor.count : '';
    if (inv.version !== screen.lastVersion || cur !== screen.lastCursor) { screen.lastCursor = cur; refresh(); }
    if (kind === 'furnace' && be) {
      const p = furnaceProgress(be);
      const sig = `${Math.round(p.burn * 14)}|${Math.round(p.cook * 22)}|${JSON.stringify([be.input, be.fuel, be.output])}`;
      if (sig !== screen.sig) {
        screen.sig = sig;
        const fh = Math.round(p.burn * 14) * u;
        screen.flameFill.style.top = (14 * u - fh) + 'px';
        screen.flameFill.style.height = fh + 'px';
        screen.flameFill.firstChild.style.marginTop = -(14 * u - fh) + 'px';
        screen.arrowFill.style.width = Math.round(p.cook * 22) * u + 'px';
        ctl.refresh();
      }
    }
  }

  refresh();
  return screen;
}
