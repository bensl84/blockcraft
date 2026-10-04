// OWNER LANE: FEATURE-INV. Kid creative picker ('creative' screen, SPEC §8.2.4): 8 picture tabs (PICKER_TABS),
// a full-screen paged grid of 72-96 px tiles with big ◀ ▶ arrows (no scrolling, no search, no drag), the 9
// hotbar slots (tap = choose the slot to fill), a trash button (empties the chosen slot) and a small backpack
// button for grown-ups that switches to the survival-style inventory. Tapping a tile puts that item (64, or the
// item's max stack) into the chosen hotbar slot with a "fwoop" fly animation and a ui:click.

import { el } from '../core/dom.js';
import { HOTBAR_SIZE } from '../core/constants.js';
import { PICKER_TABS, creativePickerItems, getItem, maxStack } from '../data/items.js';
import { flyIcon } from './inv_screens.js';
import { iconPx, paintSlot } from './inv_slotview.js';
import { spriteEl } from './inv_sprites.js';

/** Remembered between openings (per page load). */
const memo = { tab: 0, pages: {} };

/** Items for one tab with the current world's rules. */
export function pickerItems(game, tabId) {
  const types = game.entities && game.entities.types;
  return creativePickerItems(tabId, {
    hostileMobs: !!(game.meta && game.meta.rules && game.meta.rules.hostileMobs),
    hasMob: (t) => !!(types && types.has && types.has(t)),
  });
}

/** Tile and grid sizes for the viewport. */
function layoutFor(vw, vh) {
  const tile = Math.max(72, Math.min(96, Math.floor(Math.min(vw / 12, vh / 8.2))));
  const gap = 8;
  const arrow = Math.max(64, Math.round(tile * 0.85));
  const hb = Math.max(64, Math.min(80, Math.round(tile * 0.85)));
  const tab = Math.max(64, Math.round(tile * 0.9));
  const usableW = Math.min(vw - 48, 1400) - 40 - 2 * (arrow + 12);
  const cols = Math.max(2, Math.floor((usableW + gap) / (tile + gap)));
  const usableH = vh - 48 - 36 - (tab + 18) - (hb + 22) - 30;
  const rows = Math.max(1, Math.floor((usableH + gap) / (tile + gap)));
  return { tile, gap, arrow, hb, tab, cols, rows };
}

/**
 * Build the picker screen.
 * @param {object} ctx { game, close(), openInventory() }
 */
export function buildPicker(ctx) {
  const { game } = ctx;
  const inv = game.inventory;
  const L = layoutFor(window.innerWidth, window.innerHeight);
  const per = L.cols * L.rows;
  const root = el('div', { class: 'bc-screen bc-dim inv-screen', 'data-screen': 'creative' });
  const screen = { kind: 'creative', root, lastVersion: -1, layout: L, refresh, frame, pick, setTab, flip, returnAll() {} };

  // tabs
  const tabsEl = el('div', { class: 'inv-tabs' });
  const tabBtns = PICKER_TABS.map((t, i) => {
    const b = el('button', { class: 'inv-tab', 'data-tab': t.id, 'aria-label': t.id, style: { width: L.tab + 'px', height: L.tab + 'px' } });
    if (game.icons) b.appendChild(game.icons.element(t.icon, iconPx(L.tab, 0.75)));
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {}); setTab(i); });
    tabsEl.appendChild(b);
    return b;
  });

  // tiles + arrows
  const tilesEl = el('div', { class: 'inv-tiles', style: { gridTemplateColumns: `repeat(${L.cols}, ${L.tile}px)`, gridAutoRows: L.tile + 'px', height: (L.rows * (L.tile + L.gap) - L.gap) + 'px' } });
  const arrowBtn = (dir) => {
    const b = el('button', { class: 'inv-btn-icon inv-arrow-btn', 'data-action': dir < 0 ? 'prev' : 'next', 'aria-label': dir < 0 ? 'Previous' : 'Next', style: { width: L.arrow + 'px', height: L.arrow + 'px', fontSize: Math.round(L.arrow * 0.45) + 'px' } }, [dir < 0 ? '◀' : '▶']);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {}); flip(dir); });
    return b;
  };
  const prev = arrowBtn(-1), next = arrowBtn(1);
  const dots = el('div', { class: 'inv-dots' });

  // bottom: hotbar + trash + grown-up inventory toggle
  const hbEl = el('div', { class: 'inv-pick-hotbar', 'data-picker': 'hotbar' });
  const hbSlots = [];
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const s = el('div', { class: 'inv-hb-slot', dataset: { slot: String(i) }, style: { width: L.hb + 'px', height: L.hb + 'px' } });
    s.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {}); inv.selectSlot(i); refresh(); });
    hbSlots.push(s); hbEl.appendChild(s);
  }
  const trash = el('button', { class: 'inv-btn-icon inv-trash', 'data-action': 'trash', 'aria-label': 'Trash', style: { width: L.hb + 'px', height: L.hb + 'px' } }, [spriteEl('trash', Math.max(2, Math.floor((L.hb * 0.7) / 16)))]);
  trash.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {});
    if (inv.getSelected()) { inv.set(inv.selected, null); refresh(); }
  });
  const invBtn = el('button', { class: 'inv-btn-icon', 'data-action': 'survival-inventory', 'aria-label': 'Inventory', style: { width: '56px', height: '56px' } }, [spriteEl('backpack', 3)]);
  invBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {}); ctx.openInventory(); });
  const closeBtn = el('button', { class: 'inv-close', 'aria-label': 'Close', 'data-action': 'close', style: { width: '64px', height: '64px' } }, [spriteEl('close', 3)]);
  closeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); game.events.emit('ui:click', {}); ctx.close(); });

  const panel = el('div', { class: 'bc-panel inv-panel inv-picker', 'data-panel': 'creative' }, [
    tabsEl,
    el('div', { class: 'inv-pick-body' }, [prev, tilesEl, next]),
    dots,
    el('div', { class: 'inv-pick-bottom' }, [hbEl, trash, invBtn]),
    closeBtn,
  ]);
  root.appendChild(panel);
  // tapping the dim background closes the picker (nothing is held, nothing is lost)
  root.addEventListener('pointerdown', (e) => { if (e.target === root) { e.preventDefault(); game.events.emit('ui:click', {}); ctx.close(); } });
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  let items = [];
  let tilesKey = '';
  function setTab(i) {
    memo.tab = Math.max(0, Math.min(PICKER_TABS.length - 1, i));
    tilesKey = '';
    refresh();
  }
  function pages() { return Math.max(1, Math.ceil(items.length / per)); }
  function flip(d) {
    const id = PICKER_TABS[memo.tab].id;
    memo.pages[id] = Math.max(0, Math.min(pages() - 1, (memo.pages[id] || 0) + d));
    tilesKey = '';
    refresh();
  }

  function buildTiles() {
    const id = PICKER_TABS[memo.tab].id;
    items = pickerItems(game, id);
    const page = Math.max(0, Math.min(pages() - 1, memo.pages[id] || 0));
    memo.pages[id] = page;
    const key = `${id}#${page}#${items.length}`;
    if (key === tilesKey) return;
    tilesKey = key;
    tilesEl.textContent = '';
    const ipx = iconPx(L.tile, 0.72);
    const slice = items.slice(page * per, page * per + per);
    for (const d of slice) {
      const t = el('button', { class: 'inv-tile', 'data-item': d.key, title: d.name, style: { width: L.tile + 'px', height: L.tile + 'px' } });
      if (game.icons) t.appendChild(game.icons.element(d.key, ipx));
      t.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pick(d.key, t); });
      tilesEl.appendChild(t);
    }
    tabBtns.forEach((b, i) => b.classList.toggle('inv-on', i === memo.tab));
    dots.textContent = '';
    const n = pages();
    if (n > 1) for (let k = 0; k < n; k++) dots.appendChild(el('i', { class: k === page ? 'inv-on' : '' }));
    prev.disabled = page <= 0;
    next.disabled = page >= n - 1;
    prev.style.visibility = page <= 0 ? 'hidden' : 'visible';
    next.style.visibility = page >= n - 1 ? 'hidden' : 'visible';
  }

  /** Put an item into the selected hotbar slot. Returns true. */
  function pick(itemKey, tileEl = null) {
    const d = getItem(itemKey);
    if (!d) return false;
    const slot = inv.selected;
    inv.set(slot, { item: itemKey, count: Math.min(64, maxStack(itemKey)) });
    game.events.emit('ui:click', {});
    if (tileEl) {
      tileEl.classList.remove('inv-pop'); void tileEl.offsetWidth; tileEl.classList.add('inv-pop');
      setTimeout(() => tileEl.classList.remove('inv-pop'), 120);
      flyIcon(game, itemKey, tileEl.getBoundingClientRect(), hbSlots[slot].getBoundingClientRect(), iconPx(L.hb, 0.8), root);
    }
    const s = hbSlots[slot];
    s.classList.remove('inv-landed'); void s.offsetWidth; s.classList.add('inv-landed');
    refresh();
    return true;
  }

  function refresh() {
    screen.lastVersion = inv.version;
    buildTiles();
    const px = iconPx(L.hb, 0.8);
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      paintSlot(game, hbSlots[i], inv.get(i), px);
      hbSlots[i].classList.toggle('inv-selected', i === inv.selected);
    }
    trash.disabled = !inv.getSelected();
  }
  function frame() { if (inv.version !== screen.lastVersion) refresh(); }

  /** Test/debug helpers. */
  screen.tileRect = (itemKey) => { const t = tilesEl.querySelector(`[data-item="${itemKey}"]`); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  screen.tabRect = (id) => { const b = tabBtns[PICKER_TABS.findIndex((t) => t.id === id)]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  screen.state = () => ({ tab: PICKER_TABS[memo.tab].id, page: memo.pages[PICKER_TABS[memo.tab].id] || 0, pages: pages(), perPage: per, items: items.length, visible: [...tilesEl.children].map((c) => c.dataset.item) });

  refresh();
  return screen;
}
