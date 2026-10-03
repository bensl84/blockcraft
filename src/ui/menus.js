// OWNER LANE: FEATURE-MENUS (menus + title + save/load + settings). SPEC §8.4.
// Registers screens with game.ui: 'title' (original logo, parallax scenery, huge pulsing Play = resume the last
// world or create a kid world, a worlds picture button, a dull grown-ups gear), 'worlds' + 'newWorld'
// (menu_worlds.js), 'pause' (big Resume, Home, Save & Title, dull gear -> parent gate -> settings),
// 'settings' (menu_settings.js, parent area), 'death' (big Respawn; not used with rules.immediateRespawn).
// Own layers: the loading screen (Z.LOADING; shown on 'world:starting', progress from 'world:progress', hidden on
// 'world:ready') and the classic-scheme "click to play" hint. No reading needed on any kid path.

import './menu_styles.css';
import { el, uiLayer } from '../core/dom.js';
import { Z } from '../core/constants.js';
import { ICON_NAMES, Panorama, drawLogo, iconImg, iconURL, tileURL } from './menu_art.js';
import { iconButton, onPress } from './menu_widgets.js';
import { newWorldOptions } from './menu_logic.js';
import { cancelParentGate, isParentGateOpen, openParentGate } from './parentgate.js';
import { pictureURL, registerNewWorldScreen, registerWorldsScreen } from './menu_worlds.js';
import { registerSettingsScreen } from './menu_settings.js';

/** Screens that show the parallax scenery. */
const BACKDROP_SCREENS = new Set(['title', 'worlds', 'newWorld']);

/** @returns {object} Menus system (game.menus) */
export function createMenusSystem(game) {
  let root = null, panel = null;
  let panorama = null, logoURL = null;
  let loadingLayer = null, loadingEl = null, loadingBar = null, loadingPic = null;
  let hintLayer = null, hintEl = null;
  let busy = false;
  let time = 0;
  let loadingShownAt = 0;

  const ctx = {
    game,
    get root() { return root; },
    modal: null,
    show(node) {
      if (ctx.modal) ctx.modal.cancel();
      if (panel && panel !== node) panel.remove();
      panel = node;
      root.appendChild(node);
    },
    hide(node) {
      if (node && node !== panel) { node.remove(); return; }
      if (ctx.modal) ctx.modal.cancel();
      if (panel) panel.remove();
      panel = null;
    },
    /** Put the shared scenery canvas behind a menu screen. */
    attachBackdrop(node) {
      if (!panorama) panorama = new Panorama();
      panorama.resize(window.innerWidth, window.innerHeight);
      node.insertBefore(panorama.canvas, node.firstChild);
      panorama.draw(time);
    },
    /** Inside a user gesture: unlock audio and go fullscreen (SPEC §8.4.1). Never throws. */
    gesture() {
      try { const p = game.audio && game.audio.unlock && game.audio.unlock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
      try { const p = game.kid && game.kid.enterFullscreen && game.kid.enterFullscreen(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    },
    startNew: (opts) => menus.startNew(opts),
    loadWorld: (id) => menus.loadWorld(id),
  };

  const menus = {
    name: 'menus',
    /** (MENUS addition) the loading screen is visible */
    loadingVisible: false,
    /** (MENUS addition) last loading progress 0..1 */
    loadingProgress: 0,

    init() {
      root = uiLayer(game, 'screens', Z.SCREENS);
      loadingLayer = uiLayer(game, 'loading', Z.LOADING);
      hintLayer = uiLayer(game, 'menu-hint', Z.SCREENS);
      registerTitle();
      registerWorldsScreen(ctx);
      registerNewWorldScreen(ctx);
      registerPause();
      registerDeath();
      registerSettingsScreen(ctx);
      buildLoading();
      buildHint();

      game.events.on('game:ready', () => { if (!game.meta) game.ui.open('title'); });
      game.events.on('world:exit', () => {
        cancelParentGate();
        // exitToTitle sets state 'title' after this event; startWorld goes on to 'loading' - only the first wants the title
        setTimeout(() => { if (!game.meta && game.state !== 'loading' && !game.ui.current) game.ui.open('title'); }, 0);
      });
      game.events.on('ui:close', () => {
        // never leave an empty screen at the title (e.g. a screen closed by a test or another lane)
        setTimeout(() => { if (!game.meta && game.state === 'title' && !game.ui.current) game.ui.open('title'); }, 0);
      });
      game.events.on('world:starting', (e) => { cancelParentGate(); showLoading(e && e.meta); });
      game.events.on('world:progress', (e) => setProgress(e && e.total ? e.done / e.total : 0));
      game.events.on('world:ready', () => hideLoading());
      game.events.on('game:state', (e) => { if (e.to === 'title' || e.to === 'playing') hideLoading(); });
      game.events.on('player:death', () => {
        if (!game.meta || (game.meta.rules && game.meta.rules.immediateRespawn)) return;
        game.ui.open('death');
      });
      game.events.on('player:respawn', () => { if (game.ui.current === 'death') game.ui.close('death'); });
      game.events.on('input:pointerLock', (e) => {
        if (e && e.locked === false && game.settings.controls === 'classic' && game.state === 'playing' && !game.ui.current && !isParentGateOpen()) game.ui.open('pause');
      });
      window.addEventListener('resize', () => { if (panorama && BACKDROP_SCREENS.has(game.ui.current)) panorama.resize(window.innerWidth, window.innerHeight); });
      window.addEventListener('keydown', (e) => {
        if (game.ui.current !== 'title' || isParentGateOpen() || e.repeat) return;
        if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { e.preventDefault(); ctx.gesture(); menus.play(); }
      });
    },

    frame(g, dt) {
      time += dt;
      if (panorama && BACKDROP_SCREENS.has(game.ui.current) && panorama.canvas.isConnected) panorama.draw(time);
      if (hintEl) {
        const show = game.settings.controls === 'classic' && game.state === 'playing' && !game.ui.current && !(game.input && game.input.pointerLocked) && !menus.loadingVisible;
        hintEl.classList.toggle('bc-hidden', !show);
      }
    },

    /** Title Play: resume settings.lastWorldId if it still exists, else create the default kid world. */
    play() {
      if (busy || game.meta || game.state === 'loading') return Promise.resolve(false);
      busy = true;
      return (async () => {
        const worlds = await game.save.listWorlds().catch(() => []);
        const last = game.settings.lastWorldId && worlds.find((w) => w.id === game.settings.lastWorldId);
        if (last) return menus.loadWorld(last.id, true);
        return menus.startNew(newWorldOptions('default', 'creative', worlds.map((w) => w.name)), true);
      })().finally(() => { busy = false; });
    },

    /** Start a new world from startWorld options. Resolves true when playing. */
    async startNew(opts, inner = false) {
      if (!inner && (busy || game.state === 'loading')) return false;
      try { await game.startWorld(opts); return true; } catch (err) { return startFailed(err); }
    },

    /** Load a saved world by id. Resolves true when playing. */
    async loadWorld(id, inner = false) {
      if (!inner && (busy || game.state === 'loading')) return false;
      try {
        const data = await game.save.loadWorld(id);
        if (!data) { game.ui.open('worlds'); return false; }
        await game.startWorld(data);
        return true;
      } catch (err) { return startFailed(err); }
    },

    /** (MENUS addition) open the parent gate, then settings. */
    async openSettings(from = game.meta ? 'pause' : 'title') {
      if (!(await openParentGate(game))) return false;
      game.ui.open('settings', { from });
      return true;
    },
    /** (MENUS addition) the parent gate (also usable by other lanes for any link out). */
    gate: () => openParentGate(game),
    /** (MENUS addition) the menu pixel icons (data URLs), e.g. for an icon review sheet. */
    art: { iconURL, ICON_NAMES },
  };

  function startFailed(err) {
    game.reportError(err, 'menus start world');
    hideLoading();
    if (!game.meta) game.ui.open('title');
    return false;
  }

  /* ---------------------------------------------------------------- title */
  function registerTitle() {
    let node = null;
    game.ui.register('title', {
      owner: 'menus', escClose: false, pausesGame: false,
      open() {
        if (!logoURL) { try { logoURL = drawLogo().toDataURL('image/png'); } catch { logoURL = ''; } }
        const play = el('button', { class: 'bc-btn bc-btn-play bc-title-play', type: 'button', 'aria-label': 'Play', 'data-action': 'play' }, [iconImg('play', 88)]);
        onPress(game, play, () => { ctx.gesture(); menus.play(); }, { gesture: true });
        const worlds = el('button', { class: 'bc-btn bc-title-worlds', type: 'button', 'aria-label': 'Worlds', 'data-action': 'worlds' }, [iconImg('worlds', 56)]);
        onPress(game, worlds, () => game.ui.open('worlds'));
        const gear = iconButton(game, { icon: 'gear', px: 28, cls: 'bc-parent-btn bc-title-gear', action: 'settings', label: 'Grown-ups', onPress: () => menus.openSettings('title') });
        node = el('div', { class: 'bc-screen bc-mscreen bc-mtitle', 'data-screen': 'title' }, [
          el('div', { class: 'bc-mtitle-logo' }, [logoURL ? el('img', { class: 'bc-logo-img', src: logoURL, alt: 'Blockcraft', draggable: 'false' }) : el('div', { class: 'bc-logo', text: 'Blockcraft' })]),
          el('div', { class: 'bc-mtitle-play' }, [play]),
          el('div', { class: 'bc-mtitle-low' }, [worlds]),
          gear,
          el('div', { class: 'bc-mtitle-ver', text: `v${game.version}` }),
        ]);
        ctx.attachBackdrop(node);
        ctx.show(node);
        // the last world's picture on the worlds button (P1 thumbnails)
        game.save.listWorlds().then((list) => {
          if (!node || !node.isConnected || !list.length) return;
          const w = list[0];
          const img = el('img', { class: 'bc-title-worlds-pic', src: w.thumbnail || pictureURL('preset', w.preset || 'default'), alt: '', draggable: 'false' });
          worlds.insertBefore(img, worlds.firstChild);
        }).catch(() => {});
      },
      close() { ctx.hide(node); node = null; },
    });
  }

  /* ---------------------------------------------------------------- pause */
  function registerPause() {
    let node = null;
    game.ui.register('pause', {
      owner: 'menus', pausesGame: true,
      open() {
        const resume = iconButton(game, { icon: 'play', px: 80, cls: 'bc-btn-play bc-pause-resume', action: 'resume', label: 'Resume', onPress: () => {
          game.ui.close('pause');
          if (game.settings.controls === 'classic' && game.input && game.input.requestPointerLock) {
            try { const p = game.input.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
          }
        } });
        const home = iconButton(game, { icon: 'house', px: 56, cls: 'bc-btn-big bc-pause-home', action: 'home', label: 'Go home', onPress: () => {
          game.ui.close('pause');
          if (game.kid && game.kid.goHome) game.kid.goHome();
        } });
        const quit = iconButton(game, { icon: 'exit', px: 56, cls: 'bc-btn-big bc-pause-quit', action: 'quit', label: 'Save and go to the title', onPress: () => {
          if (quit.disabled) return;
          quit.disabled = true;
          game.exitToTitle().catch((err) => game.reportError(err, 'menus exitToTitle'));
        } });
        const gear = iconButton(game, { icon: 'gear', px: 28, cls: 'bc-parent-btn bc-pause-gear', action: 'settings', label: 'Grown-ups', onPress: () => menus.openSettings('pause') });
        node = el('div', { class: 'bc-screen bc-dim bc-mpause', 'data-screen': 'pause' }, [
          el('div', { class: 'bc-mpause-col' }, [resume, el('div', { class: 'bc-row bc-mpause-row' }, [home, quit])]),
          gear,
        ]);
        ctx.show(node);
      },
      close() { ctx.hide(node); node = null; },
    });
  }

  /* ---------------------------------------------------------------- death */
  function registerDeath() {
    let node = null;
    game.ui.register('death', {
      owner: 'menus', pausesGame: true, escClose: false,
      open() {
        const btn = iconButton(game, { icon: 'respawn', px: 88, cls: 'bc-btn-play bc-death-respawn', action: 'respawn', label: 'Respawn', onPress: () => {
          if (game.survival && game.survival.respawn) game.survival.respawn();
          game.ui.close('death');
        } });
        node = el('div', { class: 'bc-screen bc-mdeath', 'data-screen': 'death' }, [
          el('div', { class: 'bc-mdeath-col' }, [el('div', { class: 'bc-mdeath-hearts' }, [iconImg('heart', 48), iconImg('heart', 48), iconImg('heart', 48)]), btn]),
        ]);
        ctx.show(node);
      },
      close() { ctx.hide(node); node = null; },
    });
  }

  /* ---------------------------------------------------------------- loading */
  function buildLoading() {
    loadingBar = el('div', { class: 'bc-load-fill' });
    loadingPic = el('img', { class: 'bc-load-pic', alt: '', draggable: 'false' });
    const blocks = el('div', { class: 'bc-load-blocks' }, [0, 1, 2].map((i) => el('i', { style: { animationDelay: `${i * 0.18}s` } })));
    loadingEl = el('div', { class: 'bc-mloading bc-hidden', 'data-screen': 'loading', role: 'status', 'aria-label': 'Loading' }, [
      el('div', { class: 'bc-load-col' }, [loadingPic, blocks, el('div', { class: 'bc-load-bar' }, [loadingBar])]),
    ]);
    loadingLayer.appendChild(loadingEl);
  }
  function showLoading(meta) {
    if (!loadingEl.dataset.bg) {
      try {
        loadingEl.style.backgroundImage = `url(${tileURL('dirt', 4, 0.55)})`;
        const tiles = ['grass_side', 'planks', 'red_wool'];
        loadingEl.querySelectorAll('.bc-load-blocks i').forEach((b, i) => { b.style.backgroundImage = `url(${tileURL(tiles[i % tiles.length], 3)})`; });
        loadingEl.dataset.bg = '1';
      } catch { /* ignore */ }
    }
    const pic = meta && (meta.thumbnail || pictureURL('preset', meta.preset || 'default'));
    if (pic) loadingPic.src = pic;
    loadingPic.classList.toggle('bc-hidden', !pic);
    setProgress(0);
    loadingEl.classList.remove('bc-hidden');
    menus.loadingVisible = true;
    loadingShownAt = performance.now();
    loadingEl.dataset.shownAt = String(Math.round(loadingShownAt));
  }
  function setProgress(p) {
    menus.loadingProgress = Math.max(0, Math.min(1, p || 0));
    if (loadingBar) loadingBar.style.width = `${Math.round(menus.loadingProgress * 100)}%`;
    if (loadingEl) loadingEl.dataset.progress = menus.loadingProgress.toFixed(2);
  }
  function hideLoading() {
    if (!menus.loadingVisible) return;
    setProgress(1);
    loadingEl.classList.add('bc-hidden');
    menus.loadingVisible = false;
  }

  /* ---------------------------------------------------------------- classic "click to play" hint */
  function buildHint() {
    hintEl = el('div', { class: 'bc-mhint bc-hidden', 'data-screen': 'click-to-play' }, [el('div', { class: 'bc-mhint-plate' }, [iconImg('mouse', 64)])]);
    hintLayer.appendChild(hintEl);
  }

  return menus;
}
