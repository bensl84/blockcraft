// OWNER LANE: FEATURE-MENUS. 'worlds' (picture cards, paged with big arrows, a big "+" card; delete/rename
// behind the parent gate with a check/cross confirmation) and 'newWorld' (picture presets + mode cards, one tap
// each, then a big Play). SPEC §8.4.1. No reading needed: every choice is a picture.

import { el } from '../core/dom.js';
import { iconImg, modePicture, presetPicture } from './menu_art.js';
import { onPress, iconButton } from './menu_widgets.js';
import { DEFAULT_MODE, DEFAULT_PRESET, MODE_CHOICES, PRESET_CHOICES, agoLabel, modeKeyOf, newWorldOptions, pageSlice, pickerGrid } from './menu_logic.js';
import { openParentGate } from './parentgate.js';

const PIC_CACHE = new Map();
/** Cached data URL of a preset or mode picture. */
export function pictureURL(kind, key) {
  const k = kind + ':' + key;
  if (!PIC_CACHE.has(k)) PIC_CACHE.set(k, (kind === 'preset' ? presetPicture(key) : modePicture(key)).toDataURL('image/png'));
  return PIC_CACHE.get(k);
}
function picImg(url, cls) { const i = el('img', { class: cls, src: url, alt: '', draggable: 'false' }); return i; }

/** Big check / cross confirmation over the current screen. Resolves true for the check. */
export function confirmBox(ctx, iconName, text, picture) {
  const { game } = ctx;
  return new Promise((resolve) => {
    const done = (v) => { if (ctx.modal === modal) ctx.modal = null; box.remove(); resolve(v); };
    const modal = { cancel: () => done(false) };
    ctx.modal = modal;
    const box = el('div', { class: 'bc-screen bc-dim bc-confirm', 'data-screen': 'confirm' }, [
      el('div', { class: 'bc-panel bc-confirm-panel' }, [
        el('div', { class: 'bc-confirm-what' }, [picture ? picImg(picture, 'bc-confirm-pic') : null, iconImg(iconName, 64)]),
        text ? el('div', { class: 'bc-confirm-text', text }) : null,
        el('div', { class: 'bc-row bc-confirm-btns' }, [
          iconButton(game, { icon: 'check', px: 56, cls: 'bc-confirm-yes', action: 'confirm-yes', label: 'Yes', onPress: () => done(true) }),
          iconButton(game, { icon: 'cross', px: 56, cls: 'bc-confirm-no', action: 'confirm-no', label: 'No', onPress: () => done(false) }),
        ]),
      ]),
    ]);
    ctx.root.appendChild(box);
  });
}

/** Text prompt for renaming (parent area, behind the gate). Resolves the text or null. */
function renameBox(ctx, current, suggest) {
  const { game } = ctx;
  return new Promise((resolve) => {
    const input = el('input', { class: 'bc-rename-input', type: 'text', maxlength: '32', value: current, 'aria-label': 'World name', 'data-input': 'rename' });
    const done = (v) => { if (ctx.modal === modal) ctx.modal = null; box.remove(); resolve(v); };
    const modal = { cancel: () => done(null) };
    ctx.modal = modal;
    const box = el('div', { class: 'bc-screen bc-dim bc-confirm', 'data-screen': 'rename' }, [
      el('div', { class: 'bc-panel bc-confirm-panel' }, [
        el('div', { class: 'bc-confirm-what' }, [iconImg('pencil', 48)]),
        el('div', { class: 'bc-row bc-rename-row' }, [
          input,
          iconButton(game, { icon: 'dice', px: 40, action: 'rename-random', label: 'Random name', onPress: () => { input.value = suggest(); } }),
        ]),
        el('div', { class: 'bc-row bc-confirm-btns' }, [
          iconButton(game, { icon: 'check', px: 56, cls: 'bc-confirm-yes', action: 'confirm-yes', label: 'Save name', onPress: () => done(input.value) }),
          iconButton(game, { icon: 'cross', px: 56, cls: 'bc-confirm-no', action: 'confirm-no', label: 'Cancel', onPress: () => done(null) }),
        ]),
      ]),
    ]);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(input.value); if (e.key === 'Escape') done(null); });
    ctx.root.appendChild(box);
    setTimeout(() => { try { input.focus(); input.select(); } catch { /* ignore */ } }, 30);
  });
}

/* ------------------------------------------------------------------ worlds */
export function registerWorldsScreen(ctx) {
  const { game } = ctx;
  let node = null, state = null;

  const screen = {
    owner: 'menus', pausesGame: true, escClose: false,
    open(opts = {}) {
      state = { page: 0, edit: false, worlds: null, ...opts };
      node = el('div', { class: 'bc-screen bc-mscreen bc-worlds', 'data-screen': 'worlds' });
      ctx.attachBackdrop(node);
      ctx.show(node);
      render();
      game.save.listWorlds().then((list) => {
        if (!node) return;
        state.worlds = list;
        render();
      }).catch((err) => game.reportError(err, 'menus listWorlds'));
    },
    close() { ctx.hide(node); node = null; state = null; },
    /** (re)draw for the current size */
    render: () => render(),
    get state() { return state; },
  };
  game.ui.register('worlds', screen);

  function back() { game.ui.open('title'); }

  function render() {
    if (!node) return;
    const keep = node.querySelector('.bc-menu-panorama');
    node.textContent = '';
    if (keep) node.appendChild(keep);
    const vw = window.innerWidth, vh = window.innerHeight;
    const small = vw < 640;
    const cardW = small ? Math.min(272, vw - 48) : 256, cardH = small ? 180 : 212;
    const grid = pickerGrid(vw, vh, cardW, cardH, 16, { top: small ? 112 : 120, arrow: 96 });
    const worlds = state.worlds || [];
    const items = [{ plus: true }, ...worlds];
    const { page, pages, items: shown } = pageSlice(items, grid.perPage, state.page);
    state.page = page;

    const top = el('div', { class: 'bc-mtop' }, [
      iconButton(game, { icon: 'back', px: 48, cls: 'bc-mtop-back', action: 'back', label: 'Back', onPress: back }),
      el('div', { class: 'bc-mtop-title' }, [iconImg('worlds', 48)]),
      state.edit
        ? iconButton(game, { icon: 'check', px: 40, cls: 'bc-parent-btn bc-parent-on', action: 'edit-done', label: 'Done', onPress: () => { state.edit = false; render(); } })
        : iconButton(game, { icon: 'pencil', px: 28, cls: 'bc-parent-btn', action: 'edit-worlds', label: 'Grown-ups: edit worlds', onPress: async () => { if (await openParentGate(game)) { state.edit = true; render(); } } }),
    ]);
    const gridEl = el('div', { class: 'bc-wgrid', style: { width: `${grid.cols * cardW + (grid.cols - 1) * 16}px` } });
    for (const it of shown) gridEl.appendChild(it.plus ? plusCard(cardW, cardH) : worldCard(it, cardW, cardH));
    const prev = iconButton(game, { icon: 'left', px: 56, cls: 'bc-page-btn bc-page-prev', action: 'page-prev', label: 'Previous', onPress: () => { state.page--; render(); } });
    const next = iconButton(game, { icon: 'right', px: 56, cls: 'bc-page-btn bc-page-next', action: 'page-next', label: 'Next', onPress: () => { state.page++; render(); } });
    prev.disabled = page <= 0; next.disabled = page >= pages - 1;
    if (pages <= 1) { prev.classList.add('bc-invisible'); next.classList.add('bc-invisible'); }
    const dots = el('div', { class: 'bc-page-dots' }, pages > 1 && pages <= 12 ? Array.from({ length: pages }, (_, i) => el('i', { class: i === page ? 'bc-on' : '' })) : []);
    const body = grid.arrowsBelow
      ? el('div', { class: 'bc-wbody bc-wbody-below' }, [gridEl, dots, el('div', { class: 'bc-row bc-page-row' }, [prev, next])])
      : el('div', { class: 'bc-wbody' }, [prev, el('div', { class: 'bc-stack bc-wcenter' }, [gridEl, dots]), next]);
    node.append(top, body);
    node.dataset.page = String(page);
    node.dataset.pages = String(pages);
    node.dataset.edit = state.edit ? '1' : '0';
    node.dataset.loaded = state.worlds ? '1' : '0';
  }

  function plusCard(w, h) {
    const c = el('div', { class: 'bc-wcard bc-wcard-plus', role: 'button', tabindex: '0', 'data-action': 'new-world', 'aria-label': 'New world', style: { width: w + 'px', height: h + 'px' } }, [
      iconImg('plus', 96),
    ]);
    return onPress(game, c, () => game.ui.open('newWorld'));
  }

  function worldCard(meta, w, h) {
    const pic = meta.thumbnail || pictureURL('preset', meta.preset || 'default');
    const mk = modeKeyOf(meta);
    const c = el('div', { class: 'bc-wcard', role: 'button', tabindex: '0', 'data-world-id': meta.id, 'aria-label': meta.name, style: { width: w + 'px', height: h + 'px' } }, [
      el('div', { class: 'bc-wcard-pic' }, [picImg(pic, 'bc-wcard-img')]),
      el('div', { class: 'bc-wcard-foot' }, [
        iconImg(mk === 'creative' ? 'star' : 'sword', 28),
        mk === 'normal' ? iconImg('moon', 28) : mk === 'easy' ? iconImg('sun', 28) : null,
        el('span', { class: 'bc-wcard-name', text: meta.name }),
      ]),
      el('div', { class: 'bc-wcard-ago', text: agoLabel(meta.lastPlayed || meta.createdAt || Date.now()) }),
    ]);
    if (state.edit) {
      c.classList.add('bc-wcard-editing');
      const del = iconButton(game, { icon: 'trash', px: 36, cls: 'bc-wcard-del', action: 'delete-world', label: 'Delete world', onPress: async () => {
        if (!(await confirmBox(ctx, 'trash', meta.name, pic))) return;
        await game.save.deleteWorld(meta.id);
        state.worlds = await game.save.listWorlds();
        render();
      } });
      const ren = iconButton(game, { icon: 'pencil', px: 36, cls: 'bc-wcard-ren', action: 'rename-world', label: 'Rename world', onPress: async () => {
        const names = (state.worlds || []).map((x) => x.name);
        const name = await renameBox(ctx, meta.name, () => newWorldOptions(meta.preset, 'creative', names).name);
        if (name === null) return;
        await game.save.renameWorld(meta.id, name);
        state.worlds = await game.save.listWorlds();
        render();
      } });
      c.appendChild(el('div', { class: 'bc-wcard-edit' }, [ren, del]));
      return c;
    }
    return onPress(game, c, () => { ctx.gesture(); ctx.loadWorld(meta.id); }, { gesture: true });
  }

  window.addEventListener('resize', () => { if (game.ui.current === 'worlds') render(); });
  game.events.on('input:action', (e) => { if (e.down && e.action === 'pause' && game.ui.current === 'worlds') { if (ctx.modal) ctx.modal.cancel(); else back(); } });
  return screen;
}

/* ------------------------------------------------------------------ new world */
export function registerNewWorldScreen(ctx) {
  const { game } = ctx;
  let node = null, sel = null;

  const screen = {
    owner: 'menus', pausesGame: true, escClose: false,
    open() {
      sel = { preset: DEFAULT_PRESET, mode: DEFAULT_MODE };
      node = el('div', { class: 'bc-screen bc-mscreen bc-newworld', 'data-screen': 'newWorld' });
      ctx.attachBackdrop(node);
      const presetCards = PRESET_CHOICES.map((p) => choiceCard('preset', p.key, p.label, pictureURL('preset', p.key)));
      const modeCards = MODE_CHOICES.map((m) => choiceCard('mode', m.key, m.label, pictureURL('mode', m.key)));
      const go = iconButton(game, { icon: 'play', px: 72, cls: 'bc-btn-play bc-nw-go', action: 'create-world', label: 'Play', onPress: () => { ctx.gesture(); create(); } });
      node.append(
        el('div', { class: 'bc-mtop' }, [
          iconButton(game, { icon: 'back', px: 48, cls: 'bc-mtop-back', action: 'back', label: 'Back', onPress: () => game.ui.open('worlds') }),
          el('div', { class: 'bc-mtop-title' }, [iconImg('plus', 48)]),
          el('div', { class: 'bc-mtop-spacer' }),
        ]),
        el('div', { class: 'bc-nw-body' }, [
          el('div', { class: 'bc-nw-cards' }, [
            el('div', { class: 'bc-nw-row', 'data-row': 'preset' }, presetCards),
            el('div', { class: 'bc-nw-row bc-nw-modes', 'data-row': 'mode' }, modeCards),
          ]),
          el('div', { class: 'bc-nw-go-wrap' }, [go]),
        ]),
      );
      ctx.show(node);
      sync();
    },
    close() { ctx.hide(node); node = null; },
    get selection() { return sel ? { ...sel } : null; },
  };
  game.ui.register('newWorld', screen);

  function choiceCard(kind, key, label, url) {
    const c = el('div', { class: `bc-nw-card bc-nw-${kind}`, role: 'radio', tabindex: '0', 'data-choice': kind, 'data-value': key, 'aria-label': label }, [
      picImg(url, 'bc-nw-pic'),
      el('div', { class: 'bc-nw-label', text: label }),
      el('div', { class: 'bc-nw-check' }, [iconImg('check', 32)]),
    ]);
    return onPress(game, c, () => { sel[kind] = key; sync(); });
  }
  function sync() {
    if (!node) return;
    for (const c of node.querySelectorAll('.bc-nw-card')) {
      const on = sel[c.dataset.choice] === c.dataset.value;
      c.classList.toggle('bc-selected', on);
      c.setAttribute('aria-checked', String(on));
    }
  }
  async function create() {
    const pick = { ...sel };
    const worlds = await game.save.listWorlds().catch(() => []);
    ctx.startNew(newWorldOptions(pick.preset, pick.mode, worlds.map((w) => w.name)));
  }
  game.events.on('input:action', (e) => { if (e.down && e.action === 'pause' && game.ui.current === 'newWorld') game.ui.open('worlds'); });
  return screen;
}
