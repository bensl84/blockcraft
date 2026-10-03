// OWNER LANE: FEATURE-INV (inventory + crafting + furnace + chest UI). Signature FROZEN: createHudSystem(game).
// HUD (SPEC §8.2.5, §9): hotbar (tappable, big in the kid scheme, selected slot = 4 px yellow border + 1.15x
// scale + 6 px lift), backpack button (opens the picker / inventory), item-name popup (2 s, optional speech),
// survival rows (10 hearts that shake at <= 4 HP and flash on damage, 10 hunger shanks right-aligned, armour
// row (P1), air bubbles only underwater, XP bar + level (P1)), crosshair in the classic scheme, picture toasts.
// Lives in uiLayer(game, 'hud', Z.HUD) (+ uiLayer 'toast' at Z.TOAST). Re-renders only when inventory.version,
// player stats, mode, scheme or size change - never per-frame DOM churn. Hotbar keys select a slot only while no
// container screen is open; inside a container they swap the hovered slot (game.invui.hotbarKey).

import './hud.css';
import { el, uiLayer } from '../core/dom.js';
import { HOTBAR_SIZE, SURVIVAL, Z } from '../core/constants.js';
import { getItem } from '../data/items.js';
import { iconPx, paintSlot } from './inv_slotview.js';
import { setSprite, spriteEl } from './inv_sprites.js';

const CONTAINERS = new Set(['inventory', 'creative', 'crafting', 'furnace', 'chest']);
const FLASH_MS = 150;

function cssPx(name, fallback) {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** @returns {object} HUD system (game.hud) */
export function createHudSystem(game) {
  let root = null, toastLayer = null, toastEl = null, toastTimer = 0;
  let bottom, statsEl, hotbarEl, backpackBtn, nameEl, crossEl, xpEl, xpFill, xpLevel;
  const slotEls = [];
  const rows = {};           // name -> {wrap, icons: [span]}
  let hs = 72, g = 3;        // hotbar slot px, sprite scale
  const last = { version: -1, selected: -1, item: null, layoutDirty: true, visible: null };
  // last painted survival values (compared field by field each frame: no per-frame strings or style reads)
  const ps = { survival: null, health: NaN, maxHealth: NaN, food: NaN, sat: NaN, air: NaN, eye: null, lvl: NaN, prog: NaN, armor: NaN, flash: NaN };
  let hurtAt = -1e9;

  const hud = {
    name: 'hud',
    /** false hides the HUD (F1 / screenshots) */
    visible: true,

    init() {
      root = uiLayer(game, 'hud', Z.HUD);
      root.classList.add('inv-hud');
      toastLayer = uiLayer(game, 'toast', Z.TOAST);
      game.events.on('input:action', onAction);
      game.events.on('toast', (e) => hud.toast(e && e.text, e && (e.icon || e.iconItem)));
      game.events.on('player:hurt', () => { hurtAt = performance.now(); });
      game.events.on('settings:changed', (e) => { if (['controls', 'guiScale', 'buttonSize'].includes(e.key)) last.layoutDirty = true; });
      game.events.on('mode:changed', () => { ps.survival = null; });
      game.events.on('world:ready', () => { last.layoutDirty = true; last.item = undefined; });
      game.events.on('world:exit', () => { clearTimeout(toastTimer); if (toastEl) toastEl.classList.remove('inv-show'); });
      // a screen toast ("Needs a crafting table") belongs to that screen: it goes when the screen closes
      game.events.on('ui:close', () => { if (toastEl && toastEl.classList.contains('inv-toast-low')) { clearTimeout(toastTimer); toastEl.classList.remove('inv-show'); } });
      window.addEventListener('resize', () => { last.layoutDirty = true; });
    },

    frame() {
      if (!root) return;
      const show = hud.visible && !!game.meta && (game.state === 'playing' || game.state === 'paused')
        && !(game.ui && CONTAINERS.has(game.ui.current));
      if (show !== last.visible) { root.classList.toggle('inv-off', !show); last.visible = show; }
      if (!show) return;
      if (last.layoutDirty) build();
      const inv = game.inventory;
      if (inv.version !== last.version || inv.selected !== last.selected) paintHotbar();
      const survival = !game.isCreative();
      const p = game.player || {};
      const now = performance.now();
      const flashPhase = now - hurtAt < FLASH_MS * 3 ? Math.floor((now - hurtAt) / FLASH_MS) % 2 : -1;
      if (survival !== ps.survival || (survival && (p.health !== ps.health || p.maxHealth !== ps.maxHealth || p.food !== ps.food
        || p.saturation !== ps.sat || p.air !== ps.air || !!p.eyeInWater !== ps.eye || p.xpLevel !== ps.lvl || p.xpProgress !== ps.prog
        || flashPhase !== ps.flash || inv.armorPoints() !== ps.armor))) paintStats(survival, p, flashPhase);
    },

    /** Show a short picture toast (centred, 2 s), e.g. "Respawn point set" with a bed icon. */
    toast(text, iconItem = null) {
      if (!toastLayer) return;
      if (!toastEl) { toastEl = el('div', { class: 'inv-toast', 'data-hud': 'toast' }); toastLayer.appendChild(toastEl); }
      toastEl.textContent = '';
      if (iconItem && getItem(iconItem) && game.icons) toastEl.appendChild(game.icons.element(iconItem, 48));
      if (text) toastEl.appendChild(el('span', { text: String(text) }));
      toastEl.classList.toggle('inv-toast-low', !!(game.ui && game.ui.current));
      toastEl.classList.add('inv-show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl && toastEl.classList.remove('inv-show'), 2000);
    },

    /** Restart the item-name popup for the selected item (also speaks it when settings.speakNames). */
    showName(itemKey) {
      const d = itemKey && getItem(itemKey);
      if (!nameEl) return;
      nameEl.classList.remove('inv-show');
      if (!d) return;
      nameEl.textContent = d.name;
      void nameEl.offsetWidth; // restart the CSS animation
      nameEl.classList.add('inv-show');
      speak(d.name);
    },

    /** Debug/test: DOM rect of hotbar slot i (screen px). */
    slotRect(i) { const s = slotEls[i]; if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; },
  };

  function onAction(e) {
    if (!e.down) return;
    const a = e.action;
    const inContainer = game.ui && CONTAINERS.has(game.ui.current);
    if (a === 'toggleHud') { hud.visible = !hud.visible; return; }
    if (!game.meta) return;
    if (game.ui && game.ui.current && !inContainer) return; // pause / settings / death screens: keys do nothing here
    if (a.startsWith('hotbar') && a.length === 7) {
      const i = Number(a.slice(6)) - 1;
      if (inContainer) { if (game.invui && game.invui.hotbarKey) game.invui.hotbarKey(i); }
      else game.inventory.selectSlot(i);
    } else if (a === 'hotbarNext' || a === 'hotbarPrev') {
      if (inContainer) return;
      game.inventory.selectSlot(game.inventory.selected + (a === 'hotbarNext' ? 1 : -1));
    }
  }

  function build() {
    last.layoutDirty = false;
    last.version = -1; last.selected = -1; ps.survival = null;
    root.textContent = '';
    slotEls.length = 0;
    hs = Math.round(cssPx('--hotbar-slot', 72));
    g = Math.max(2, game.guiScale || 2, Math.floor(hs / 24));
    const hotbarW = hs * HOTBAR_SIZE + 6 + 4;

    // hotbar
    hotbarEl = el('div', { class: 'inv-hotbar', 'data-hud': 'hotbar' });
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = el('div', { class: 'inv-hb-slot', dataset: { slot: String(i) }, style: { width: hs + 'px', height: hs + 'px' } });
      s.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        game.inventory.selectSlot(i);
        game.events.emit('ui:click', {});
      });
      slotEls.push(s);
      hotbarEl.appendChild(s);
    }
    const bp = Math.max(64, Math.min(96, hs));
    backpackBtn = el('button', {
      class: 'bc-plate-btn inv-backpack', 'data-action': 'inventory', 'aria-label': 'Inventory',
      style: { width: bp + 'px', height: bp + 'px' },
    }, [spriteEl('backpack', Math.max(2, Math.floor((bp * 0.7) / 16)))]);
    backpackBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      game.events.emit('ui:click', {});
      if (game.ui && !game.ui.current && game.state === 'playing') game.ui.open(game.isCreative() ? 'creative' : 'inventory');
    });
    const hotbarWrap = el('div', { class: 'inv-hotbar-wrap' }, [hotbarEl, backpackBtn]);

    // survival rows: [armour | air] above [hearts | hunger]
    const rowW = 81 * g;
    const mk = (name, n, rtl) => {
      const icons = [];
      const wrap = el('div', { class: `inv-icons${rtl ? ' inv-rtl' : ''}`, dataset: { hud: name } });
      for (let i = 0; i < n; i++) {
        const sp = spriteEl('heart_empty', g);
        if (i < n - 1) sp.style[rtl ? 'marginLeft' : 'marginRight'] = -g + 'px';
        icons.push(sp); wrap.appendChild(sp);
      }
      wrap.style.width = rowW + 'px';
      rows[name] = { wrap, icons };
      return wrap;
    };
    statsEl = el('div', { class: 'inv-stats', style: { width: (hotbarW - 8) + 'px' } }, [
      el('div', { class: 'inv-stat-row' }, [mk('armor', 10, false), mk('air', 10, true)]),
      el('div', { class: 'inv-stat-row' }, [mk('hearts', 10, false), mk('food', 10, true)]),
    ]);
    xpFill = el('div', { class: 'inv-xp-fill' });
    xpLevel = el('div', { class: 'inv-xp-level' });
    xpEl = el('div', { class: 'inv-xp', 'data-hud': 'xp', style: { width: (hotbarW - 8) + 'px', height: 5 * g + 'px' } }, [
      el('div', { class: 'inv-xp-bar' }, [xpFill]), xpLevel,
    ]);
    nameEl = el('div', { class: 'inv-name-pop', 'data-hud': 'name' });
    bottom = el('div', { class: 'inv-hud-bottom' }, [nameEl, statsEl, xpEl, hotbarWrap]);
    root.appendChild(bottom);
    nameEl.style.bottom = '100%';

    // crosshair: classic scheme only, 15 GUI px
    if (game.settings.controls === 'classic') {
      const c = 15 * (game.guiScale || 2), t = Math.max(2, game.guiScale || 2);
      crossEl = el('div', { class: 'inv-crosshair', 'data-hud': 'crosshair', style: { width: c + 'px', height: c + 'px' } }, [
        el('i', { style: { left: 0, top: (c - t) / 2 + 'px', width: c + 'px', height: t + 'px' } }),
        el('i', { style: { left: (c - t) / 2 + 'px', top: 0, width: t + 'px', height: (c - t) / 2 + 'px' } }),
        el('i', { style: { left: (c - t) / 2 + 'px', top: (c + t) / 2 + 'px', width: t + 'px', height: (c - t) / 2 + 'px' } }),
      ]);
      root.appendChild(crossEl);
    } else crossEl = null;
  }

  function paintHotbar() {
    const inv = game.inventory;
    last.version = inv.version;
    last.selected = inv.selected;
    const px = iconPx(hs, 0.8);
    for (let i = 0; i < slotEls.length; i++) {
      paintSlot(game, slotEls[i], inv.get(i), px);
      slotEls[i].classList.toggle('inv-selected', i === inv.selected);
    }
    const sel = inv.getSelected();
    const key = sel ? sel.item : null;
    if (key !== last.item) {
      const first = last.item === undefined;
      last.item = key;
      if (!first) hud.showName(key); // an empty slot clears the name (showName(null) just hides it)
    }
    if (backpackBtn) backpackBtn.classList.toggle('inv-idle', inv.slots.every((s, i) => i >= HOTBAR_SIZE || !s));
  }

  function paintStats(survival, p, flashPhase) {
    Object.assign(ps, { survival, health: p.health, maxHealth: p.maxHealth, food: p.food, sat: p.saturation, air: p.air, eye: !!p.eyeInWater,
      lvl: p.xpLevel, prog: p.xpProgress, flash: flashPhase, armor: game.inventory.armorPoints() });
    statsEl.style.display = survival ? '' : 'none';
    xpEl.style.display = survival ? '' : 'none';
    if (!survival) return;
    const inv = game.inventory;
    const hp = Math.max(0, Math.round(p.health ?? SURVIVAL.MAX_HEALTH));
    const maxHp = Math.max(2, p.maxHealth || SURVIVAL.MAX_HEALTH);
    const flash = flashPhase === 0;
    fill(rows.hearts, hp, maxHp, flash ? 'heart_flash' : 'heart_full', 'heart_half', flash ? 'heart_flash' : 'heart_empty');
    rows.hearts.wrap.classList.toggle('inv-low', hp <= 4 && hp > 0);
    const food = Math.max(0, Math.round(p.food ?? SURVIVAL.MAX_FOOD));
    fill(rows.food, food, 20, 'food_full', 'food_half', 'food_empty');
    rows.food.wrap.classList.toggle('inv-low', (p.saturation ?? 5) <= 0 && food <= 6);
    const armor = inv.armorPoints ? inv.armorPoints() : 0;
    fill(rows.armor, armor, 20, 'armor_full', 'armor_half', 'armor_empty');
    rows.armor.wrap.classList.toggle('inv-hidden-row', armor <= 0);
    const air = p.air ?? SURVIVAL.MAX_AIR;
    const showAir = !!p.eyeInWater; // SPEC §8.2.5: bubbles only while the eye is in water
    const bubbles = Math.max(0, Math.ceil(((air - 2) * 10) / SURVIVAL.MAX_AIR));
    rows.air.icons.forEach((sp, i) => { setSprite(sp, 'bubble', g); sp.style.visibility = i < bubbles ? '' : 'hidden'; }); // '' inherits the row's hidden state
    rows.air.wrap.classList.toggle('inv-hidden-row', !showAir);
    const prog = Math.max(0, Math.min(1, p.xpProgress || 0));
    xpFill.style.width = Math.round(prog * 100) + '%';
    xpLevel.textContent = p.xpLevel > 0 ? String(p.xpLevel) : '';
  }

  /** 10 icons for a 0..max value: full / half / empty (row reads left-to-right, or right-to-left for hunger). */
  function fill(row, value, max, full, half, empty) {
    const n = row.icons.length;
    const per = max / n;
    for (let i = 0; i < n; i++) {
      const v = value - i * per;
      setSprite(row.icons[i], v >= per ? full : v >= per / 2 ? half : empty, g);
    }
  }

  let voice = null;
  function speak(text) {
    if (!game.settings.speakNames || typeof speechSynthesis === 'undefined') return;
    try {
      if (!voice) voice = speechSynthesis.getVoices().find((v) => v.localService && /^en/i.test(v.lang)) || speechSynthesis.getVoices().find((v) => v.localService) || null;
      if (!voice) return; // local voices only (offline, no network)
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice; u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch { /* speech is optional */ }
  }

  return hud;
}

